/**
 * Modul 12, 13 & 14 - Toko Koperasi (POS), Pembelian, dan Penjualan.
 *
 * Pencatatan persediaan perpetual: setiap penjualan langsung mengakui
 * pendapatan dan harga pokok penjualan (HPP) pada saat transaksi.
 */
import { all, get, run, scalar, nextNumber, tx, settingNum } from '../db.js';
import { badRequest, notFound, conflict } from '../lib/http.js';
import { logAudit } from '../lib/audit.js';
import { postJournal, AKUN, akunKasMetode } from './accounting.js';
import { mutasi, stokBarang, akunBarang, tambahNilai } from './inventory.js';
import { rupiah, today, addDays } from '../lib/util.js';

// ------------------------------ PENJUALAN ------------------------------

/**
 * Membagi `total` ke beberapa akun sebanding bobotnya, dengan sisa
 * pembulatan dititipkan pada akun berbobot terbesar agar jumlahnya persis.
 * @param {Map<string, number>} bobot kode akun → bobot
 * @returns {Map<string, number>}
 */
function alokasi(bobot, total) {
  const jumlah = [...bobot.values()].reduce((s, v) => s + v, 0);
  const hasil = new Map();
  if (!bobot.size) return hasil;
  for (const [k, v] of bobot) hasil.set(k, jumlah ? rupiah(total * v / jumlah) : 0);
  const selisih = total - [...hasil.values()].reduce((s, v) => s + v, 0);
  if (selisih) {
    const terbesar = [...bobot.entries()].reduce((a, b) => (b[1] > a[1] ? b : a))[0];
    hasil.set(terbesar, hasil.get(terbesar) + selisih);
  }
  return hasil;
}

/** Rekening simpanan sukarela aktif seorang anggota (untuk potong simpanan). */
function rekeningSukarela(anggota_id) {
  return get(
    `SELECT r.*, p.coa_kode FROM rekening_simpanan r JOIN produk_simpanan p ON p.id = r.produk_id
      WHERE r.anggota_id = ? AND p.jenis = 'sukarela' AND r.status = 'aktif' ORDER BY r.id LIMIT 1`, [anggota_id]);
}

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

    // HPP diambil dari nilai yang benar-benar keluar dari kartu stok (rata-rata
    // bergerak tanpa selisih pembulatan), lalu dipakai apa adanya pada jurnal.
    totalHpp = 0;
    for (const b of baris) {
      const m = mutasi({ barang_id: b.barang.id, gudang_id: gudangId, tanggal: tgl, jenis: 'keluar',
        qty: -b.qty, referensi: `penjualan:${id}`, keterangan: `Penjualan ${nomor}` }, ctx);
      b.hpp_nilai = m.nilai;
      b.hpp_satuan = rupiah(m.nilai / b.qty);
      totalHpp += m.nilai;
      run(`INSERT INTO penjualan_detail(penjualan_id, barang_id, qty, harga, diskon, subtotal, hpp_satuan, hpp_nilai)
           VALUES(?,?,?,?,?,?,?,?)`,
      [id, b.barang.id, b.qty, b.harga, b.diskon, b.subtotal, b.hpp_satuan, b.hpp_nilai]);
    }
    run('UPDATE penjualan SET hpp = ? WHERE id = ?', [totalHpp, id]);

    // ---- Jurnal ----
    // Pendapatan, HPP, dan persediaan dibukukan ke akun masing-masing barang
    // (master barang), atau ke pemetaan di Parameter Sistem bila kosong.
    const lines = [];
    let rekPotong = null;
    if (metode === 'potong_simpanan') {
      if (!anggota) throw badRequest('Pemotongan simpanan hanya berlaku untuk anggota');
      rekPotong = rekeningSukarela(anggota.id);
      if (!rekPotong) throw badRequest('Anggota belum memiliki rekening simpanan sukarela');
      if (rekPotong.saldo - rekPotong.saldo_blokir < total) throw conflict('Saldo simpanan sukarela tidak mencukupi');
      lines.push({ coa_kode: rekPotong.coa_kode, debit: total, anggota_id: anggota.id,
        keterangan: `Potong simpanan untuk ${nomor}` });
    } else {
      const akunTerima = metode === 'piutang' ? AKUN.piutang_usaha() : akunKasMetode(metode, data.bank_account_id);
      lines.push({ coa_kode: akunTerima, debit: total, anggota_id: data.anggota_id || null,
        keterangan: `Penjualan ${nomor}` });
    }
    const bobotPendapatan = new Map();
    const hppPerAkun = new Map();
    const sediaanPerAkun = new Map();
    for (const b of baris) {
      const akun = akunBarang(b.barang);
      tambahNilai(bobotPendapatan, akun.penjualan, b.subtotal);
      const nilaiHpp = b.hpp_nilai;
      tambahNilai(hppPerAkun, akun.hpp, nilaiHpp);
      tambahNilai(sediaanPerAkun, akun.persediaan, nilaiHpp);
    }
    for (const [kode, nilai] of alokasi(bobotPendapatan, total - pajak)) {
      if (nilai) lines.push({ coa_kode: kode, kredit: nilai, keterangan: `Penjualan ${nomor}` });
    }
    if (pajak > 0) lines.push({ coa_kode: AKUN.hutang_pajak(), kredit: pajak, keterangan: 'PPN keluaran' });
    for (const [kode, nilai] of hppPerAkun) lines.push({ coa_kode: kode, debit: nilai, keterangan: `HPP ${nomor}` });
    for (const [kode, nilai] of sediaanPerAkun) {
      lines.push({ coa_kode: kode, kredit: nilai, keterangan: `Pengurangan persediaan ${nomor}` });
    }
    const jurnal = postJournal({
      tanggal: tgl, tipe: 'penjualan', referensi: `penjualan:${id}`,
      keterangan: `Penjualan ${nomor}${anggota ? ` - ${anggota.nama}` : ''}`,
      cabang_id: data.cabang_id, unit_usaha_id: data.unit_usaha_id, lines,
    }, ctx);
    run('UPDATE penjualan SET jurnal_id = ? WHERE id = ?', [jurnal.id, id]);
    if (rekPotong) {
      run('UPDATE rekening_simpanan SET saldo = saldo - ? WHERE id = ?', [total, rekPotong.id]);
      run(`INSERT INTO transaksi_simpanan(nomor, rekening_id, tanggal, jenis, debit, saldo_akhir,
             keterangan, jurnal_id, metode, petugas)
           VALUES(?,?,?,'penarikan',?,?,?,?,'pindah_buku',?)`,
      [nextNumber('TSP', tgl), rekPotong.id, tgl, total, rekPotong.saldo - total,
        `Pembayaran belanja ${nomor}`, jurnal.id, ctx?.user?.username || 'kasir']);
    }

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

/**
 * Retur penjualan: barang kembali ke gudang dan jurnal penjualannya dibalik
 * secara proporsional (pendapatan, PPN, HPP, persediaan). Dana dikembalikan
 * lewat jalur pembayaran semula: kas/bank, pengurangan piutang, atau
 * dikreditkan kembali ke simpanan sukarela.
 */
export function returPenjualan({ penjualan_id, tanggal, items, alasan, bank_account_id }, ctx) {
  const p = get('SELECT * FROM penjualan WHERE id = ?', [penjualan_id]);
  if (!p) throw notFound('Transaksi penjualan tidak ditemukan');
  if (p.status === 'retur') throw conflict('Transaksi ini sudah pernah diretur seluruhnya');
  if (p.status === 'batal') throw conflict('Transaksi yang sudah dibatalkan tidak dapat diretur');
  const tgl = tanggal || today();

  return tx(() => {
    const detail = all('SELECT * FROM penjualan_detail WHERE penjualan_id = ?', [penjualan_id]);
    const sudahRetur = new Map(all(
      `SELECT barang_id, SUM(qty) AS qty FROM mutasi_stok WHERE referensi = ? AND jenis = 'retur_masuk'
        GROUP BY barang_id`, [`retur:${penjualan_id}`]).map((r) => [r.barang_id, r.qty]));
    const target = items?.length ? items
      : detail.map((d) => ({ barang_id: d.barang_id, qty: d.qty - (sudahRetur.get(d.barang_id) || 0) }))
        .filter((x) => x.qty > 0);
    if (!target.length) throw conflict('Seluruh barang pada transaksi ini sudah diretur');

    let nilaiItem = 0;
    const bobotPendapatan = new Map();
    const hppPerAkun = new Map();
    const sediaanPerAkun = new Map();
    for (const it of target) {
      const d = detail.find((x) => x.barang_id === Number(it.barang_id));
      if (!d) throw badRequest(`Barang id ${it.barang_id} tidak ada pada transaksi ini`);
      const qty = Number(it.qty);
      const sisa = d.qty - (sudahRetur.get(d.barang_id) || 0);
      if (!(qty > 0) || qty > sisa) {
        throw badRequest('Kuantitas retur tidak valid', `Sisa yang dapat diretur: ${sisa}`);
      }
      const barang = get('SELECT * FROM barang WHERE id = ?', [d.barang_id]);
      const akun = akunBarang(barang);
      const nilai = rupiah((d.subtotal / d.qty) * qty);
      const hppTotal = d.hpp_nilai ?? rupiah(d.hpp_satuan * d.qty);
      const hpp = qty === d.qty ? hppTotal : rupiah(hppTotal * qty / d.qty);
      nilaiItem += nilai;
      tambahNilai(bobotPendapatan, akun.penjualan, nilai);
      tambahNilai(hppPerAkun, akun.hpp, hpp);
      tambahNilai(sediaanPerAkun, akun.persediaan, hpp);
      mutasi({ barang_id: d.barang_id, gudang_id: p.gudang_id, tanggal: tgl, jenis: 'retur_masuk',
        qty, harga: d.hpp_satuan, nilai: hpp, referensi: `retur:${penjualan_id}`, keterangan: `Retur ${p.nomor}` }, ctx);
    }

    // Nilai yang dikembalikan sebanding porsi barang terhadap subtotal nota,
    // sehingga diskon nota, poin, dan PPN ikut terkoreksi secara proporsional.
    const porsi = p.subtotal > 0 ? nilaiItem / p.subtotal : 1;
    const nilaiRetur = Math.min(rupiah(p.total * porsi), p.total);
    const pajakRetur = Math.min(rupiah(p.pajak * porsi), nilaiRetur);
    const hppRetur = [...hppPerAkun.values()].reduce((a, b) => a + b, 0);

    const lines = [];
    for (const [kode, nilai] of alokasi(bobotPendapatan, nilaiRetur - pajakRetur)) {
      if (nilai) lines.push({ coa_kode: kode, debit: nilai, keterangan: `Retur penjualan ${p.nomor}` });
    }
    if (pajakRetur > 0) lines.push({ coa_kode: AKUN.hutang_pajak(), debit: pajakRetur, keterangan: 'Koreksi PPN keluaran retur' });

    // Sisi pengembalian dana mengikuti cara bayar semula.
    let rekSimpanan = null;
    if (p.metode_bayar === 'piutang') {
      const hp = get("SELECT * FROM hutang_piutang WHERE jenis = 'piutang' AND referensi = ?", [`penjualan:${penjualan_id}`]);
      const sisaPiutang = hp ? hp.nominal - hp.terbayar : 0;
      const kurangiPiutang = Math.min(nilaiRetur, Math.max(0, sisaPiutang));
      if (kurangiPiutang > 0) {
        lines.push({ coa_kode: AKUN.piutang_usaha(), kredit: kurangiPiutang, anggota_id: p.anggota_id,
          keterangan: `Pengurangan piutang retur ${p.nomor}` });
        const nominalBaru = hp.nominal - kurangiPiutang;
        run('UPDATE hutang_piutang SET nominal = ?, status = ? WHERE id = ?',
          [nominalBaru, hp.terbayar >= nominalBaru ? 'lunas' : 'terbuka', hp.id]);
      }
      if (nilaiRetur - kurangiPiutang > 0) {
        lines.push({ coa_kode: akunKasMetode('tunai', bank_account_id), kredit: nilaiRetur - kurangiPiutang,
          keterangan: `Pengembalian dana retur ${p.nomor}` });
      }
    } else if (p.metode_bayar === 'potong_simpanan') {
      rekSimpanan = get(
        `SELECT r.*, pr.coa_kode FROM transaksi_simpanan t JOIN rekening_simpanan r ON r.id = t.rekening_id
           JOIN produk_simpanan pr ON pr.id = r.produk_id
          WHERE (t.jurnal_id = ? OR t.keterangan = ?) ORDER BY t.id LIMIT 1`,
        [p.jurnal_id, `Pembayaran belanja ${p.nomor}`])
        || (p.anggota_id ? rekeningSukarela(p.anggota_id) : null);
      if (!rekSimpanan) throw conflict('Rekening simpanan pembayar tidak ditemukan untuk menampung dana retur');
      lines.push({ coa_kode: rekSimpanan.coa_kode, kredit: nilaiRetur, anggota_id: rekSimpanan.anggota_id,
        keterangan: `Pengembalian dana retur ${p.nomor} ke simpanan` });
    } else {
      lines.push({ coa_kode: akunKasMetode(p.metode_bayar, bank_account_id), kredit: nilaiRetur,
        keterangan: `Pengembalian dana retur ${p.nomor}` });
    }
    for (const [kode, nilai] of sediaanPerAkun) {
      if (nilai) lines.push({ coa_kode: kode, debit: nilai, keterangan: 'Barang retur masuk gudang' });
    }
    for (const [kode, nilai] of hppPerAkun) {
      if (nilai) lines.push({ coa_kode: kode, kredit: nilai, keterangan: 'Koreksi HPP retur' });
    }
    const jurnal = postJournal({
      tanggal: tgl, tipe: 'penjualan', referensi: `retur:${penjualan_id}`,
      keterangan: `Retur penjualan ${p.nomor} - ${alasan || 'tanpa keterangan'}`,
      cabang_id: p.cabang_id, unit_usaha_id: p.unit_usaha_id, lines,
    }, ctx);

    if (rekSimpanan && nilaiRetur > 0) {
      const saldo = scalar('SELECT saldo FROM rekening_simpanan WHERE id = ?', [rekSimpanan.id]);
      run('UPDATE rekening_simpanan SET saldo = ? WHERE id = ?', [saldo + nilaiRetur, rekSimpanan.id]);
      run(`INSERT INTO transaksi_simpanan(nomor, rekening_id, tanggal, jenis, kredit, saldo_akhir,
             keterangan, jurnal_id, metode, petugas)
           VALUES(?,?,?,'setoran',?,?,?,?,'pindah_buku',?)`,
      [nextNumber('TSP', tgl), rekSimpanan.id, tgl, nilaiRetur, saldo + nilaiRetur,
        `Pengembalian dana retur ${p.nomor}`, jurnal.id, ctx?.user?.username || 'kasir']);
    }

    const sisaQty = detail.reduce((s, d) => s + d.qty, 0)
      - scalar(`SELECT COALESCE(SUM(qty),0) FROM mutasi_stok WHERE referensi = ? AND jenis = 'retur_masuk'`,
        [`retur:${penjualan_id}`]);
    const returPenuh = sisaQty <= 0;
    if (returPenuh) run("UPDATE penjualan SET status = 'retur' WHERE id = ?", [penjualan_id]);
    logAudit(ctx, { aksi: 'update', modul: 'penjualan', entitas_id: penjualan_id,
      keterangan: `Retur ${p.nomor} senilai Rp ${nilaiRetur.toLocaleString('id-ID')}: ${alasan || '-'}` });
    return { nilai_retur: nilaiRetur, pajak_retur: pajakRetur, hpp_retur: hppRetur, retur_penuh: returPenuh, jurnal };
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

/** Status pembelian yang masih dapat diubah / dibatalkan (belum ada barang diterima). */
const PEMBELIAN_TERBUKA = ['draft', 'diajukan', 'disetujui'];

function pembelianBelumDiterima(pb) {
  if (!PEMBELIAN_TERBUKA.includes(pb.status)) {
    throw conflict(`Dokumen ${pb.nomor} berstatus "${pb.status}" dan tidak dapat diubah`);
  }
  if (scalar('SELECT COALESCE(SUM(qty_diterima),0) FROM pembelian_detail WHERE pembelian_id = ?', [pb.id]) > 0) {
    throw conflict(`Sebagian barang pada ${pb.nomor} sudah diterima sehingga dokumen tidak dapat diubah`);
  }
}

/** Mengubah dokumen pembelian yang belum menerima barang (belum ada jurnal). */
export function ubahPembelian(id, data, ctx) {
  const pb = get('SELECT * FROM pembelian WHERE id = ?', [id]);
  if (!pb) throw notFound('Dokumen pembelian tidak ditemukan');
  pembelianBelumDiterima(pb);
  const items = data.items || [];
  if (!items.length) throw badRequest('Dokumen pembelian minimal berisi 1 barang');
  const supplierId = data.supplier_id !== undefined ? (data.supplier_id || null) : pb.supplier_id;
  const supplier = supplierId ? get('SELECT * FROM supplier WHERE id = ?', [supplierId]) : null;
  if (supplierId && !supplier) throw notFound('Supplier tidak ditemukan');
  const tgl = data.tanggal || pb.tanggal;

  return tx(() => {
    let subtotal = 0;
    run('DELETE FROM pembelian_detail WHERE pembelian_id = ?', [id]);
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
      run(`INSERT INTO pembelian_detail(pembelian_id, barang_id, qty, harga, diskon, subtotal)
           VALUES(?,?,?,?,?,?)`, [id, barang.id, qty, harga, diskon, sub]);
    }
    const diskonNota = rupiah(data.diskon ?? pb.diskon ?? 0);
    const pajak = rupiah(data.pajak ?? pb.pajak ?? 0);
    const total = subtotal - diskonNota + pajak;
    run(`UPDATE pembelian SET tanggal = ?, supplier_id = ?, gudang_id = ?, unit_usaha_id = ?, cabang_id = ?,
           subtotal = ?, diskon = ?, pajak = ?, total = ?, jatuh_tempo = ? WHERE id = ?`,
    [tgl, supplierId, data.gudang_id !== undefined ? (data.gudang_id || null) : pb.gudang_id,
      data.unit_usaha_id !== undefined ? (data.unit_usaha_id || null) : pb.unit_usaha_id,
      data.cabang_id !== undefined ? (data.cabang_id || null) : pb.cabang_id,
      subtotal, diskonNota, pajak, total, addDays(tgl, supplier?.termin_hari ?? 0), id]);
    const sesudah = get('SELECT * FROM pembelian WHERE id = ?', [id]);
    logAudit(ctx, { aksi: 'update', modul: 'pembelian', entitas_id: id,
      keterangan: `Dokumen ${pb.nomor} diubah (total Rp ${total.toLocaleString('id-ID')})`, before: pb, after: sesudah });
    return sesudah;
  });
}

/** Membatalkan dokumen pembelian yang belum menerima barang. */
export function batalPembelian(id, alasan, ctx) {
  const pb = get('SELECT * FROM pembelian WHERE id = ?', [id]);
  if (!pb) throw notFound('Dokumen pembelian tidak ditemukan');
  pembelianBelumDiterima(pb);
  if (!String(alasan || '').trim()) throw badRequest('Alasan pembatalan wajib diisi');
  run("UPDATE pembelian SET status = 'batal', alasan_batal = ? WHERE id = ?", [alasan, id]);
  logAudit(ctx, { aksi: 'void', modul: 'pembelian', entitas_id: id,
    keterangan: `Dokumen ${pb.nomor} dibatalkan: ${alasan}`, before: pb });
  return get('SELECT * FROM pembelian WHERE id = ?', [id]);
}

/**
 * Penerimaan barang atas dokumen pembelian.
 *
 * Jurnal:  D Persediaan (+ PPN Masukan)   K Hutang Usaha / Kas
 */
export function terimaBarang({ pembelian_id, tanggal, items, metode_bayar = 'hutang', bank_account_id }, ctx) {
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
    const sediaanPerAkun = new Map();

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
      tambahNilai(sediaanPerAkun, akunBarang(get('SELECT * FROM barang WHERE id = ?', [d.barang_id])).persediaan,
        rupiah(hargaNetto * qty));
      mutasi({ barang_id: d.barang_id, gudang_id: pb.gudang_id, tanggal: tgl, jenis: 'masuk',
        qty, harga: hargaNetto, batch: it.batch, serial_number: it.serial_number, expired: it.expired,
        referensi: `pembelian:${pembelian_id}`, keterangan: `Penerimaan ${pb.nomor}` }, ctx);
      run('UPDATE pembelian_detail SET qty_diterima = qty_diterima + ? WHERE id = ?', [qty, d.id]);
    }
    if (nilaiTerima === 0) throw badRequest('Tidak ada barang yang diterima');

    const pajakProporsi = pb.subtotal > 0 ? rupiah(pb.pajak * nilaiTerima / pb.subtotal) : 0;
    const totalTagih = nilaiTerima + pajakProporsi;
    const akunLawan = metode_bayar === 'hutang' ? AKUN.hutang_usaha() : akunKasMetode(metode_bayar, bank_account_id);
    const lines = [...sediaanPerAkun].map(([kode, nilai]) =>
      ({ coa_kode: kode, debit: nilai, keterangan: `Penerimaan ${pb.nomor}` }));
    if (pajakProporsi > 0) {
      lines.push({ coa_kode: AKUN.ppn_masukan(), debit: pajakProporsi, keterangan: 'PPN masukan' });
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
export function bayarHutangPiutang({ id, tanggal, nominal, metode = 'tunai', bank_account_id }, ctx) {
  const hp = get('SELECT * FROM hutang_piutang WHERE id = ?', [id]);
  if (!hp) throw notFound('Data hutang/piutang tidak ditemukan');
  if (hp.status === 'lunas') throw conflict('Tagihan ini sudah lunas');
  const nom = rupiah(nominal);
  const sisa = hp.nominal - hp.terbayar;
  if (nom <= 0) throw badRequest('Nominal pembayaran harus lebih besar dari nol');
  if (nom > sisa) throw badRequest(`Nominal melebihi sisa tagihan Rp ${sisa.toLocaleString('id-ID')}`);
  const tgl = tanggal || today();
  const akunKas = akunKasMetode(metode, bank_account_id);

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
