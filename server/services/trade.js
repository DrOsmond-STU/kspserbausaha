/**
 * Modul 12, 13 & 14 - Toko Koperasi (POS), Pembelian, dan Penjualan.
 *
 * Pencatatan persediaan perpetual: setiap penjualan langsung mengakui
 * pendapatan dan harga pokok penjualan (HPP) pada saat transaksi.
 */
import { all, get, run, scalar, nextNumber, tx, settingNum } from '../db.js';
import { badRequest, notFound, conflict } from '../lib/http.js';
import { logAudit } from '../lib/audit.js';
import { postJournal, AKUN } from './accounting.js';
import { mutasi, stokBarang } from './inventory.js';
import { rupiah, today, addDays } from '../lib/util.js';

// ------------------------------ PENJUALAN ------------------------------

/**
 * Transaksi penjualan / POS.
 *
 * Jurnal:
 *   D Kas/Piutang        K Penjualan (+ Hutang Pajak bila ada PPN)
 *   D HPP               K Persediaan
 */
export function jual(data, ctx) {
  const items = data.items || [];
  if (!items.length) throw badRequest('Transaksi penjualan minimal berisi 1 barang');
  const tgl = data.tanggal || today();
  const gudangId = data.gudang_id || scalar("SELECT id FROM gudang WHERE status = 'aktif' ORDER BY id LIMIT 1", [], null);
  if (!gudangId) throw badRequest('Gudang belum dikonfigurasi');

  const anggota = data.anggota_id ? get('SELECT * FROM anggota WHERE id = ?', [data.anggota_id]) : null;
  if (data.anggota_id && !anggota) throw notFound('Anggota tidak ditemukan');

  return tx(() => {
    let subtotal = 0;
    let totalHpp = 0;
    let totalDiskonItem = 0;
    const baris = [];

    for (const it of items) {
      const barang = get("SELECT * FROM barang WHERE id = ? AND status = 'aktif'", [it.barang_id]);
      if (!barang) throw notFound(`Barang id ${it.barang_id} tidak ditemukan atau tidak aktif`);
      const qty = Number(it.qty);
      if (!(qty > 0)) throw badRequest(`Kuantitas ${barang.nama} harus lebih besar dari nol`);
      const tersedia = stokBarang(barang.id, gudangId);
      if (qty > tersedia) {
        throw conflict(`Stok ${barang.nama} tidak mencukupi`,
          `Tersedia ${tersedia} ${barang.satuan}, diminta ${qty} ${barang.satuan}`);
      }
      // Harga khusus anggota (member price) bila tersedia
      const hargaDasar = it.harga !== undefined && it.harga !== null ? rupiah(it.harga)
        : (anggota && barang.harga_anggota > 0 ? barang.harga_anggota : barang.harga_jual);
      const diskon = rupiah(it.diskon || 0);
      const sub = rupiah(hargaDasar * qty - diskon);
      if (sub < 0) throw badRequest(`Diskon ${barang.nama} melebihi nilai barang`);
      subtotal += sub;
      totalDiskonItem += diskon;
      totalHpp += rupiah(barang.harga_beli * qty);
      baris.push({ barang, qty, harga: hargaDasar, diskon, subtotal: sub, hpp_satuan: barang.harga_beli });
    }

    const diskonNota = rupiah(data.diskon || 0);
    const pajak = rupiah(data.pajak || 0);
    const poinDipakai = rupiah(data.poin_dipakai || 0);
    const nilaiPoin = poinDipakai * settingNum('loyalty.nilai_per_poin', 100);
    const total = subtotal - diskonNota + pajak - nilaiPoin;
    if (total < 0) throw badRequest('Total transaksi menjadi negatif, periksa diskon dan poin');

    const metode = data.metode_bayar || 'tunai';
    const bayar = metode === 'piutang' ? 0 : rupiah(data.bayar ?? total);
    if (metode !== 'piutang' && bayar < total) {
      throw badRequest('Pembayaran kurang dari total belanja',
        `Total Rp ${total.toLocaleString('id-ID')}, dibayar Rp ${bayar.toLocaleString('id-ID')}`);
    }
    if (metode === 'piutang' && !data.anggota_id && !data.customer_id) {
      throw badRequest('Penjualan kredit memerlukan data anggota atau pelanggan');
    }
    if (poinDipakai > 0) {
      if (!anggota) throw badRequest('Penukaran poin hanya berlaku untuk anggota');
      const saldoPoin = scalar('SELECT COALESCE(SUM(poin),0) FROM loyalty_poin WHERE anggota_id = ?', [anggota.id]);
      if (poinDipakai > saldoPoin) throw conflict(`Poin tidak mencukupi (saldo ${saldoPoin} poin)`);
    }

    const nomor = nextNumber(data.tipe === 'sales_order' ? 'SO' : 'POS', tgl);
    const { lastInsertRowid: id } = run(
      `INSERT INTO penjualan(nomor, tanggal, tipe, anggota_id, customer_id, gudang_id, unit_usaha_id,
         cabang_id, subtotal, diskon, pajak, total, hpp, bayar, kembali, metode_bayar,
         poin_dipakai, status, kasir)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [nomor, tgl, data.tipe || 'pos', data.anggota_id || null, data.customer_id || null, gudangId,
        data.unit_usaha_id || null, data.cabang_id || null, subtotal, diskonNota + totalDiskonItem,
        pajak, total, totalHpp, bayar, Math.max(0, bayar - total), metode, poinDipakai,
        data.status || 'selesai', ctx?.user?.username || 'kasir'],
    );

    for (const b of baris) {
      run(`INSERT INTO penjualan_detail(penjualan_id, barang_id, qty, harga, diskon, subtotal, hpp_satuan)
           VALUES(?,?,?,?,?,?,?)`,
      [id, b.barang.id, b.qty, b.harga, b.diskon, b.subtotal, b.hpp_satuan]);
      mutasi({ barang_id: b.barang.id, gudang_id: gudangId, tanggal: tgl, jenis: 'keluar',
        qty: -b.qty, referensi: `penjualan:${id}`, keterangan: `Penjualan ${nomor}` }, ctx);
    }

    // ---- Jurnal ----
    const akunTerima = metode === 'piutang' ? AKUN.piutang_usaha()
      : metode === 'transfer' || metode === 'qris' ? AKUN.bank() : AKUN.kas();
    const lines = [];
    if (metode === 'potong_simpanan') {
      if (!anggota) throw badRequest('Pemotongan simpanan hanya berlaku untuk anggota');
      const rek = get(
        `SELECT r.*, p.coa_kode FROM rekening_simpanan r JOIN produk_simpanan p ON p.id = r.produk_id
          WHERE r.anggota_id = ? AND p.jenis = 'sukarela' AND r.status = 'aktif' LIMIT 1`, [anggota.id]);
      if (!rek) throw badRequest('Anggota belum memiliki rekening simpanan sukarela');
      if (rek.saldo - rek.saldo_blokir < total) throw conflict('Saldo simpanan sukarela tidak mencukupi');
      run('UPDATE rekening_simpanan SET saldo = saldo - ? WHERE id = ?', [total, rek.id]);
      run(`INSERT INTO transaksi_simpanan(nomor, rekening_id, tanggal, jenis, debit, saldo_akhir,
             keterangan, metode, petugas)
           VALUES(?,?,?,'penarikan',?,?,?,'pindah_buku',?)`,
      [nextNumber('TSP', tgl), rek.id, tgl, total, rek.saldo - total,
        `Pembayaran belanja ${nomor}`, ctx?.user?.username || 'kasir']);
      lines.push({ coa_kode: rek.coa_kode, debit: total, anggota_id: anggota.id,
        keterangan: `Potong simpanan untuk ${nomor}` });
    } else {
      lines.push({ coa_kode: akunTerima, debit: total, anggota_id: data.anggota_id || null,
        keterangan: `Penjualan ${nomor}` });
    }
    lines.push({ coa_kode: AKUN.penjualan(), kredit: total - pajak, keterangan: `Penjualan ${nomor}` });
    if (pajak > 0) lines.push({ coa_kode: AKUN.hutang_pajak(), kredit: pajak, keterangan: 'PPN keluaran' });
    if (totalHpp > 0) {
      lines.push({ coa_kode: AKUN.hpp(), debit: totalHpp, keterangan: `HPP ${nomor}` });
      lines.push({ coa_kode: AKUN.persediaan(), kredit: totalHpp, keterangan: `Pengurangan persediaan ${nomor}` });
    }
    const jurnal = postJournal({
      tanggal: tgl, tipe: 'penjualan', referensi: `penjualan:${id}`,
      keterangan: `Penjualan ${nomor}${anggota ? ` - ${anggota.nama}` : ''}`,
      cabang_id: data.cabang_id, unit_usaha_id: data.unit_usaha_id, lines,
    }, ctx);
    run('UPDATE penjualan SET jurnal_id = ? WHERE id = ?', [jurnal.id, id]);

    // ---- Piutang & loyalty ----
    if (metode === 'piutang') {
      const termin = data.customer_id
        ? (get('SELECT termin_hari FROM customer WHERE id = ?', [data.customer_id])?.termin_hari || 30) : 30;
      run(`INSERT INTO hutang_piutang(jenis, referensi, pihak, customer_id, anggota_id, tanggal,
             jatuh_tempo, nominal) VALUES('piutang',?,?,?,?,?,?,?)`,
      [`penjualan:${id}`, anggota?.nama || null, data.customer_id || null, data.anggota_id || null,
        tgl, addDays(tgl, termin), total]);
    }
    let poinDidapat = 0;
    if (anggota) {
      const rasio = settingNum('loyalty.rupiah_per_poin', 10_000);
      poinDidapat = rasio > 0 ? Math.floor(total / rasio) : 0;
      const saldoSblm = scalar('SELECT COALESCE(SUM(poin),0) FROM loyalty_poin WHERE anggota_id = ?', [anggota.id]);
      if (poinDipakai > 0) {
        run(`INSERT INTO loyalty_poin(anggota_id, tanggal, poin, saldo, referensi, keterangan)
             VALUES(?,?,?,?,?,?)`,
        [anggota.id, tgl, -poinDipakai, saldoSblm - poinDipakai, `penjualan:${id}`, `Penukaran poin pada ${nomor}`]);
      }
      if (poinDidapat > 0) {
        run(`INSERT INTO loyalty_poin(anggota_id, tanggal, poin, saldo, referensi, keterangan)
             VALUES(?,?,?,?,?,?)`,
        [anggota.id, tgl, poinDidapat, saldoSblm - poinDipakai + poinDidapat, `penjualan:${id}`,
          `Poin belanja ${nomor}`]);
        run('UPDATE penjualan SET poin_didapat = ? WHERE id = ?', [poinDidapat, id]);
      }
    }

    logAudit(ctx, { aksi: 'create', modul: 'pos', entitas_id: id,
      keterangan: `Penjualan ${nomor} Rp ${total.toLocaleString('id-ID')} (${metode})`,
      after: { nomor, total, items: baris.length } });

    return {
      id, nomor, tanggal: tgl, subtotal, diskon: diskonNota + totalDiskonItem, pajak, total,
      bayar, kembali: Math.max(0, bayar - total), metode_bayar: metode,
      poin_didapat: poinDidapat, poin_dipakai: poinDipakai, hpp: totalHpp,
      items: baris.map((b) => ({ kode: b.barang.kode, nama: b.barang.nama, qty: b.qty,
        satuan: b.barang.satuan, harga: b.harga, diskon: b.diskon, subtotal: b.subtotal })),
      anggota: anggota ? { nama: anggota.nama, nomor_anggota: anggota.nomor_anggota } : null,
      jurnal,
    };
  });
}

/** Retur penjualan: barang kembali ke gudang, jurnal dibalik. */
export function returPenjualan({ penjualan_id, tanggal, items, alasan }, ctx) {
  const p = get('SELECT * FROM penjualan WHERE id = ?', [penjualan_id]);
  if (!p) throw notFound('Transaksi penjualan tidak ditemukan');
  if (p.status === 'retur') throw conflict('Transaksi ini sudah pernah diretur seluruhnya');
  const tgl = tanggal || today();

  return tx(() => {
    let nilaiRetur = 0;
    let hppRetur = 0;
    const detail = all('SELECT * FROM penjualan_detail WHERE penjualan_id = ?', [penjualan_id]);
    const target = items?.length ? items : detail.map((d) => ({ barang_id: d.barang_id, qty: d.qty }));

    for (const it of target) {
      const d = detail.find((x) => x.barang_id === Number(it.barang_id));
      if (!d) throw badRequest(`Barang id ${it.barang_id} tidak ada pada transaksi ini`);
      const qty = Number(it.qty);
      if (!(qty > 0) || qty > d.qty) throw badRequest('Kuantitas retur tidak valid');
      const nilai = rupiah((d.subtotal / d.qty) * qty);
      nilaiRetur += nilai;
      hppRetur += rupiah(d.hpp_satuan * qty);
      mutasi({ barang_id: d.barang_id, gudang_id: p.gudang_id, tanggal: tgl, jenis: 'retur_masuk',
        qty, harga: d.hpp_satuan, referensi: `retur:${penjualan_id}`, keterangan: `Retur ${p.nomor}` }, ctx);
    }

    const akunBayar = p.metode_bayar === 'piutang' ? AKUN.piutang_usaha()
      : p.metode_bayar === 'transfer' || p.metode_bayar === 'qris' ? AKUN.bank() : AKUN.kas();
    const lines = [
      { coa_kode: AKUN.penjualan(), debit: nilaiRetur, keterangan: `Retur penjualan ${p.nomor}` },
      { coa_kode: akunBayar, kredit: nilaiRetur, keterangan: `Pengembalian dana retur ${p.nomor}` },
    ];
    if (hppRetur > 0) {
      lines.push({ coa_kode: AKUN.persediaan(), debit: hppRetur, keterangan: 'Barang retur masuk gudang' });
      lines.push({ coa_kode: AKUN.hpp(), kredit: hppRetur, keterangan: 'Koreksi HPP retur' });
    }
    const jurnal = postJournal({
      tanggal: tgl, tipe: 'penjualan', referensi: `retur:${penjualan_id}`,
      keterangan: `Retur penjualan ${p.nomor} - ${alasan || 'tanpa keterangan'}`,
      cabang_id: p.cabang_id, unit_usaha_id: p.unit_usaha_id, lines,
    }, ctx);

    const returPenuh = nilaiRetur >= p.total;
    if (returPenuh) run("UPDATE penjualan SET status = 'retur' WHERE id = ?", [penjualan_id]);
    logAudit(ctx, { aksi: 'update', modul: 'penjualan', entitas_id: penjualan_id,
      keterangan: `Retur ${p.nomor} senilai Rp ${nilaiRetur.toLocaleString('id-ID')}: ${alasan || '-'}` });
    return { nilai_retur: nilaiRetur, hpp_retur: hppRetur, retur_penuh: returPenuh, jurnal };
  });
}

// ------------------------------ PEMBELIAN ------------------------------

/** Membuat dokumen pembelian (PR / PO). Belum menimbulkan jurnal. */
export function buatPembelian(data, ctx) {
  const items = data.items || [];
  if (!items.length) throw badRequest('Dokumen pembelian minimal berisi 1 barang');
  const tgl = data.tanggal || today();
  const supplier = data.supplier_id ? get('SELECT * FROM supplier WHERE id = ?', [data.supplier_id]) : null;
  if (data.supplier_id && !supplier) throw notFound('Supplier tidak ditemukan');

  return tx(() => {
    let subtotal = 0;
    const baris = [];
    for (const it of items) {
      const barang = get('SELECT * FROM barang WHERE id = ?', [it.barang_id]);
      if (!barang) throw notFound(`Barang id ${it.barang_id} tidak ditemukan`);
      const qty = Number(it.qty);
      const harga = rupiah(it.harga);
      if (!(qty > 0)) throw badRequest(`Kuantitas ${barang.nama} harus lebih besar dari nol`);
      if (harga < 0) throw badRequest(`Harga ${barang.nama} tidak boleh negatif`);
      const diskon = rupiah(it.diskon || 0);
      const sub = rupiah(qty * harga - diskon);
      subtotal += sub;
      baris.push({ barang, qty, harga, diskon, subtotal: sub });
    }
    const diskonNota = rupiah(data.diskon || 0);
    const pajak = rupiah(data.pajak || 0);
    const total = subtotal - diskonNota + pajak;
    const tipe = data.tipe || 'po';
    const nomor = nextNumber(tipe === 'pr' ? 'PR' : 'PO', tgl);
    const termin = supplier?.termin_hari ?? 0;

    const { lastInsertRowid: id } = run(
      `INSERT INTO pembelian(nomor, tanggal, tipe, supplier_id, gudang_id, unit_usaha_id, cabang_id,
         subtotal, diskon, pajak, total, jatuh_tempo, status, dibuat_oleh)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [nomor, tgl, tipe, data.supplier_id || null, data.gudang_id || null, data.unit_usaha_id || null,
        data.cabang_id || null, subtotal, diskonNota, pajak, total, addDays(tgl, termin),
        data.status || 'draft', ctx?.user?.username || 'sistem'],
    );
    for (const b of baris) {
      run(`INSERT INTO pembelian_detail(pembelian_id, barang_id, qty, harga, diskon, subtotal)
           VALUES(?,?,?,?,?,?)`, [id, b.barang.id, b.qty, b.harga, b.diskon, b.subtotal]);
    }
    logAudit(ctx, { aksi: 'create', modul: 'pembelian', entitas_id: id,
      keterangan: `${tipe.toUpperCase()} ${nomor} senilai Rp ${total.toLocaleString('id-ID')}`,
      after: { nomor, total, items: baris.length } });
    return { id, nomor, subtotal, total, items: baris.length };
  });
}

/**
 * Penerimaan barang atas dokumen pembelian.
 *
 * Jurnal:  D Persediaan (+ PPN Masukan)   K Hutang Usaha / Kas
 */
export function terimaBarang({ pembelian_id, tanggal, items, metode_bayar = 'hutang' }, ctx) {
  const pb = get('SELECT * FROM pembelian WHERE id = ?', [pembelian_id]);
  if (!pb) throw notFound('Dokumen pembelian tidak ditemukan');
  if (['selesai', 'batal'].includes(pb.status)) throw conflict(`Dokumen berstatus "${pb.status}"`);
  if (!pb.gudang_id) throw badRequest('Gudang penerimaan belum ditentukan pada dokumen pembelian');
  const tgl = tanggal || today();

  return tx(() => {
    const detail = all('SELECT * FROM pembelian_detail WHERE pembelian_id = ?', [pembelian_id]);
    const target = items?.length ? items
      : detail.map((d) => ({ detail_id: d.id, qty: d.qty - d.qty_diterima }));
    let nilaiTerima = 0;

    for (const it of target) {
      const d = detail.find((x) => x.id === Number(it.detail_id))
        || detail.find((x) => x.barang_id === Number(it.barang_id));
      if (!d) throw badRequest('Baris penerimaan tidak sesuai dengan dokumen pembelian');
      const qty = Number(it.qty);
      if (qty <= 0) continue;
      const sisa = d.qty - d.qty_diterima;
      if (qty > sisa) {
        throw badRequest('Kuantitas penerimaan melebihi pesanan',
          `Sisa yang belum diterima: ${sisa}`);
      }
      const hargaNetto = rupiah(d.subtotal / d.qty);
      nilaiTerima += rupiah(hargaNetto * qty);
      mutasi({ barang_id: d.barang_id, gudang_id: pb.gudang_id, tanggal: tgl, jenis: 'masuk',
        qty, harga: hargaNetto, batch: it.batch, serial_number: it.serial_number, expired: it.expired,
        referensi: `pembelian:${pembelian_id}`, keterangan: `Penerimaan ${pb.nomor}` }, ctx);
      run('UPDATE pembelian_detail SET qty_diterima = qty_diterima + ? WHERE id = ?', [qty, d.id]);
    }
    if (nilaiTerima === 0) throw badRequest('Tidak ada barang yang diterima');

    const pajakProporsi = pb.subtotal > 0 ? rupiah(pb.pajak * nilaiTerima / pb.subtotal) : 0;
    const totalTagih = nilaiTerima + pajakProporsi;
    const akunLawan = metode_bayar === 'tunai' ? AKUN.kas()
      : metode_bayar === 'transfer' ? AKUN.bank() : AKUN.hutang_usaha();
    const lines = [{ coa_kode: AKUN.persediaan(), debit: nilaiTerima, keterangan: `Penerimaan ${pb.nomor}` }];
    if (pajakProporsi > 0) {
      lines.push({ coa_kode: AKUN.hutang_pajak(), debit: pajakProporsi, keterangan: 'PPN masukan' });
    }
    lines.push({ coa_kode: akunLawan, kredit: totalTagih, keterangan: `Pembelian ${pb.nomor}` });

    const jurnal = postJournal({
      tanggal: tgl, tipe: 'pembelian', referensi: `pembelian:${pembelian_id}`,
      keterangan: `Penerimaan barang ${pb.nomor}`,
      cabang_id: pb.cabang_id, unit_usaha_id: pb.unit_usaha_id, lines,
    }, ctx);

    if (metode_bayar === 'hutang') {
      run(`INSERT INTO hutang_piutang(jenis, referensi, supplier_id, tanggal, jatuh_tempo, nominal)
           VALUES('hutang',?,?,?,?,?)`,
      [`pembelian:${pembelian_id}`, pb.supplier_id, tgl, pb.jatuh_tempo || addDays(tgl, 30), totalTagih]);
    } else {
      run('UPDATE pembelian SET terbayar = terbayar + ? WHERE id = ?', [totalTagih, pembelian_id]);
    }

    const sisaTotal = scalar(
      'SELECT COALESCE(SUM(qty - qty_diterima),0) FROM pembelian_detail WHERE pembelian_id = ?', [pembelian_id]);
    run('UPDATE pembelian SET status = ?, jurnal_id = COALESCE(jurnal_id, ?) WHERE id = ?',
      [sisaTotal <= 0 ? 'selesai' : 'diterima', jurnal.id, pembelian_id]);

    logAudit(ctx, { aksi: 'post', modul: 'pembelian', entitas_id: pembelian_id,
      keterangan: `Penerimaan ${pb.nomor} senilai Rp ${totalTagih.toLocaleString('id-ID')}` });
    return { nilai_terima: nilaiTerima, pajak: pajakProporsi, total: totalTagih,
      selesai: sisaTotal <= 0, jurnal };
  });
}

/** Pembayaran hutang / penerimaan piutang. */
export function bayarHutangPiutang({ id, tanggal, nominal, metode = 'tunai' }, ctx) {
  const hp = get('SELECT * FROM hutang_piutang WHERE id = ?', [id]);
  if (!hp) throw notFound('Data hutang/piutang tidak ditemukan');
  if (hp.status === 'lunas') throw conflict('Tagihan ini sudah lunas');
  const nom = rupiah(nominal);
  const sisa = hp.nominal - hp.terbayar;
  if (nom <= 0) throw badRequest('Nominal pembayaran harus lebih besar dari nol');
  if (nom > sisa) throw badRequest(`Nominal melebihi sisa tagihan Rp ${sisa.toLocaleString('id-ID')}`);
  const tgl = tanggal || today();
  const akunKas = metode === 'transfer' ? AKUN.bank() : AKUN.kas();

  return tx(() => {
    const lines = hp.jenis === 'hutang'
      ? [{ coa_kode: AKUN.hutang_usaha(), debit: nom, keterangan: 'Pembayaran hutang usaha' },
        { coa_kode: akunKas, kredit: nom, keterangan: `Pembayaran ${hp.referensi}` }]
      : [{ coa_kode: akunKas, debit: nom, keterangan: `Penerimaan ${hp.referensi}` },
        { coa_kode: AKUN.piutang_usaha(), kredit: nom, anggota_id: hp.anggota_id,
          keterangan: 'Pelunasan piutang usaha' }];
    const jurnal = postJournal({
      tanggal: tgl, tipe: hp.jenis === 'hutang' ? 'kas_keluar' : 'kas_masuk',
      referensi: `hp:${id}`, keterangan: `${hp.jenis === 'hutang' ? 'Pembayaran hutang' : 'Penerimaan piutang'} ${hp.referensi}`,
      lines,
    }, ctx);
    const terbayar = hp.terbayar + nom;
    run('UPDATE hutang_piutang SET terbayar = ?, status = ? WHERE id = ?',
      [terbayar, terbayar >= hp.nominal ? 'lunas' : 'terbuka', id]);
    if (hp.referensi.startsWith('pembelian:')) {
      run('UPDATE pembelian SET terbayar = terbayar + ? WHERE id = ?',
        [nom, Number(hp.referensi.split(':')[1])]);
    }
    logAudit(ctx, { aksi: 'create', modul: hp.jenis === 'hutang' ? 'pembelian' : 'penjualan', entitas_id: id,
      keterangan: `${hp.jenis} ${hp.referensi} dibayar Rp ${nom.toLocaleString('id-ID')}` });
    return { terbayar, sisa: hp.nominal - terbayar, jurnal };
  });
}

/** Evaluasi kinerja supplier (ketepatan & nilai transaksi). */
export function evaluasiSupplier() {
  return all(
    `SELECT s.id, s.kode, s.nama, s.rating, s.termin_hari,
            COUNT(p.id) AS jumlah_transaksi,
            COALESCE(SUM(p.total),0) AS nilai_transaksi,
            COALESCE(SUM(CASE WHEN p.status = 'selesai' THEN 1 ELSE 0 END),0) AS selesai,
            COALESCE(SUM(p.total - p.terbayar),0) AS hutang_terbuka
       FROM supplier s LEFT JOIN pembelian p ON p.supplier_id = s.id
      GROUP BY s.id ORDER BY nilai_transaksi DESC`,
  ).map((r) => ({
    ...r,
    tingkat_penyelesaian: r.jumlah_transaksi ? Number((r.selesai / r.jumlah_transaksi * 100).toFixed(1)) : 0,
  }));
}

/** Ringkasan penjualan harian untuk tutup kasir. */
export function rekapKasir({ tanggal = today(), kasir = null } = {}) {
  const w = ['tanggal = ?', "status = 'selesai'"];
  const p = [tanggal];
  if (kasir) { w.push('kasir = ?'); p.push(kasir); }
  const ringkas = get(
    `SELECT COUNT(*) AS jumlah_transaksi, COALESCE(SUM(total),0) AS total,
            COALESCE(SUM(hpp),0) AS hpp, COALESCE(SUM(diskon),0) AS diskon
       FROM penjualan WHERE ${w.join(' AND ')}`, p);
  const perMetode = all(
    `SELECT metode_bayar, COUNT(*) AS jumlah, COALESCE(SUM(total),0) AS total
       FROM penjualan WHERE ${w.join(' AND ')} GROUP BY metode_bayar`, p);
  const terlaris = all(
    `SELECT b.kode, b.nama, SUM(d.qty) AS qty, SUM(d.subtotal) AS nilai
       FROM penjualan_detail d JOIN penjualan j ON j.id = d.penjualan_id
       JOIN barang b ON b.id = d.barang_id
      WHERE ${w.map((x) => `j.${x}`).join(' AND ')}
      GROUP BY b.id ORDER BY qty DESC LIMIT 10`, p);
  return { tanggal, ...ringkas, laba_kotor: (ringkas?.total || 0) - (ringkas?.hpp || 0), per_metode: perMetode, terlaris };
}
