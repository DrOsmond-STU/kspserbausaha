/**
 * Modul 11 - Persediaan.
 *
 * Penilaian persediaan memakai metode RATA-RATA BERGERAK (moving average)
 * sesuai SAK EP (PSAK 14 - Persediaan). Sistem pencatatan: PERPETUAL,
 * sehingga setiap mutasi barang langsung membentuk jurnal.
 */
import { all, get, run, scalar, nextNumber, tx } from '../db.js';
import { badRequest, notFound, conflict } from '../lib/http.js';
import { logAudit, notify } from '../lib/audit.js';
import { postJournal, AKUN } from './accounting.js';
import { rupiah, today } from '../lib/util.js';

/**
 * Akun persediaan, penjualan, dan HPP sebuah barang. Akun yang diisi pada
 * master barang diutamakan; bila kosong memakai pemetaan di Parameter Sistem.
 */
export function akunBarang(barang) {
  return {
    persediaan: barang?.coa_persediaan || AKUN.persediaan(),
    penjualan: barang?.coa_penjualan || AKUN.penjualan(),
    hpp: barang?.coa_hpp || AKUN.hpp(),
  };
}

/** Menambah nominal ke peta akun → nilai (untuk menyusun baris jurnal per akun). */
export function tambahNilai(peta, kode, nilai) {
  if (nilai) peta.set(kode, (peta.get(kode) || 0) + nilai);
  return peta;
}

/** Stok barang pada satu gudang (0 bila belum pernah ada mutasi). */
export function stokBarang(barang_id, gudang_id) {
  return scalar('SELECT COALESCE(qty,0) FROM stok WHERE barang_id = ? AND gudang_id = ?',
    [barang_id, gudang_id]);
}

export function totalStok(barang_id) {
  return scalar('SELECT COALESCE(SUM(qty),0) FROM stok WHERE barang_id = ?', [barang_id]);
}

/**
 * Mencatat mutasi stok dan memperbarui nilai persediaan rata-rata bergerak.
 *
 * Nilai persediaan setiap barang disimpan utuh (kolom nilai_persediaan).
 * Barang keluar dinilai sebanding porsinya terhadap nilai itu - dan barang
 * terakhir mengambil seluruh sisanya - sehingga jumlah nilai di kartu stok
 * selalu sama persis dengan saldo akun persediaan, tanpa selisih pembulatan.
 * Nilai mutasi dikembalikan (`nilai`) dan WAJIB dipakai pemanggil untuk jurnal.
 *
 * @param {number} qty (+) masuk / (-) keluar
 * @param {number} harga harga satuan barang masuk (0 = HPP rata-rata saat ini)
 * @param {number} [nilai] nilai mutasi yang ditentukan pemanggil (mis. pembatalan)
 * @param {boolean} [pindah] perpindahan antar gudang - nilai total tidak berubah
 */
export function mutasi({ barang_id, gudang_id, tanggal, jenis, qty, harga = 0, nilai = null, pindah = false, batch, serial_number, expired, referensi, keterangan }, ctx) {
  const barang = get('SELECT * FROM barang WHERE id = ?', [barang_id]);
  if (!barang) throw notFound(`Barang id ${barang_id} tidak ditemukan`);
  const gudangRow = get('SELECT * FROM gudang WHERE id = ?', [gudang_id]);
  if (!gudangRow) throw notFound('Gudang tidak ditemukan');
  if (qty === 0) throw badRequest('Kuantitas mutasi tidak boleh nol');

  const stokLama = stokBarang(barang_id, gudang_id);
  const stokBaru = stokLama + qty;
  if (stokBaru < 0) {
    throw conflict(`Stok ${barang.nama} tidak mencukupi di ${gudangRow.nama}`,
      `Stok tersedia ${stokLama} ${barang.satuan}, diminta ${Math.abs(qty)} ${barang.satuan}`);
  }

  const totalGlobal = totalStok(barang_id);
  const nilaiLama = barang.nilai_persediaan ?? rupiah(totalGlobal * barang.harga_beli);
  const totalBaru = totalGlobal + (pindah ? 0 : qty);
  let nilaiMutasi = 0;
  let hpp = barang.harga_beli;
  if (!pindah) {
    if (qty > 0) {
      nilaiMutasi = nilai !== null ? rupiah(nilai) : rupiah(qty * (harga > 0 ? harga : barang.harga_beli));
    } else if (nilai !== null) {
      nilaiMutasi = rupiah(nilai);
    } else {
      nilaiMutasi = totalBaru <= 0 ? nilaiLama : rupiah(nilaiLama * (-qty) / totalGlobal);
    }
    const nilaiBaru = qty > 0 ? nilaiLama + nilaiMutasi : nilaiLama - nilaiMutasi;
    if (totalBaru > 0) hpp = rupiah(nilaiBaru / totalBaru);
    else if (qty > 0) hpp = rupiah(nilaiMutasi / qty);
    run('UPDATE barang SET harga_beli = ?, nilai_persediaan = ? WHERE id = ?',
      [Math.max(0, hpp), totalBaru <= 0 ? 0 : nilaiBaru, barang_id]);
  }

  run(
    `INSERT INTO stok(barang_id, gudang_id, qty) VALUES(?,?,?)
     ON CONFLICT(barang_id, gudang_id) DO UPDATE SET qty = ?`,
    [barang_id, gudang_id, stokBaru, stokBaru],
  );
  const { lastInsertRowid: id } = run(
    `INSERT INTO mutasi_stok(tanggal, barang_id, gudang_id, jenis, qty, harga, saldo_qty,
       batch, serial_number, expired, referensi, keterangan, nilai)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [tanggal || today(), barang_id, gudang_id, jenis, qty, qty > 0 && harga > 0 ? harga : barang.harga_beli, stokBaru,
      batch || null, serial_number || null, expired || null, referensi || null, keterangan || null,
      pindah ? 0 : (qty > 0 ? nilaiMutasi : -nilaiMutasi)],
  );

  // Peringatan stok minimum / reorder point
  const totalSesudah = totalStok(barang_id);
  if (qty < 0 && barang.reorder_point > 0 && totalSesudah <= barang.reorder_point) {
    notify({ role: 'staf_gudang', judul: 'Stok mencapai titik pemesanan ulang',
      pesan: `${barang.kode} - ${barang.nama}: sisa ${totalSesudah} ${barang.satuan} (ROP ${barang.reorder_point})`,
      tipe: 'warning', link: '#/persediaan' });
  }
  return { id, stok_sebelum: stokLama, stok_sesudah: stokBaru, hpp, nilai: nilaiMutasi };
}

/**
 * Penyesuaian stok manual (barang ditemukan / rusak / hilang / saldo awal).
 * Setiap penyesuaian langsung dijurnal agar nilai persediaan di buku besar
 * selalu sama dengan kartu stok:
 *   masuk   D Persediaan         K Akun lawan (bawaan: Pendapatan lain-lain)
 *   keluar  D Akun lawan (bawaan: Beban selisih)   K Persediaan
 */
export function penyesuaianStok({ barang_id, gudang_id, tanggal, jenis = 'masuk', qty, harga, akun_lawan, keterangan }, ctx) {
  const barang = get('SELECT * FROM barang WHERE id = ?', [barang_id]);
  if (!barang) throw notFound('Barang tidak ditemukan');
  const q = Math.abs(Number(qty));
  if (!(q > 0)) throw badRequest('Kuantitas penyesuaian harus lebih besar dari nol');
  if (!['masuk', 'keluar'].includes(jenis)) throw badRequest('Jenis penyesuaian harus masuk atau keluar');
  const tgl = tanggal || today();
  const masuk = jenis === 'masuk';
  const hargaSatuan = masuk ? rupiah(harga || barang.harga_beli) : barang.harga_beli;
  if (masuk && hargaSatuan <= 0) throw badRequest('Harga satuan wajib diisi untuk barang yang belum memiliki HPP');
  const lawan = akun_lawan || (masuk ? AKUN.pendapatan_lain() : AKUN.beban_selisih());

  return tx(() => {
    const m = mutasi({ barang_id, gudang_id, tanggal: tgl, jenis: masuk ? 'penyesuaian_masuk' : 'penyesuaian_keluar',
      qty: masuk ? q : -q, harga: masuk ? hargaSatuan : 0,
      referensi: 'penyesuaian', keterangan }, ctx);
    const nilai = m.nilai;
    let jurnal = null;
    if (nilai > 0) {
      const akunSediaan = akunBarang(barang).persediaan;
      const ket = `Penyesuaian stok ${barang.kode} ${masuk ? '+' : '-'}${q} ${barang.satuan}`;
      jurnal = postJournal({
        tanggal: tgl, tipe: 'penyesuaian', referensi: `stok:${m.id}`,
        keterangan: keterangan ? `${ket} - ${keterangan}` : ket,
        lines: masuk
          ? [{ coa_kode: akunSediaan, debit: nilai }, { coa_kode: lawan, kredit: nilai }]
          : [{ coa_kode: lawan, debit: nilai }, { coa_kode: akunSediaan, kredit: nilai }],
      }, ctx);
    }
    logAudit(ctx, { aksi: 'create', modul: 'persediaan', entitas_id: barang_id,
      keterangan: `Penyesuaian stok ${barang.kode} ${masuk ? 'masuk' : 'keluar'} ${q} senilai Rp ${nilai.toLocaleString('id-ID')}` });
    return { ...m, nilai, jurnal };
  });
}

/**
 * Mengeluarkan stok dengan nilai tertentu (bukan nilai rata-rata saat ini).
 * Dipakai ketika membatalkan barang masuk: nilai yang dikeluarkan harus sama
 * dengan nilai saat barang itu dicatat masuk, supaya persediaan di kartu stok
 * tetap sama dengan saldo akun persediaan sesudah jurnalnya dibalik.
 */
export function keluarkanSenilai({ barang_id, gudang_id, tanggal, qty, nilai, jenis, referensi, keterangan }, ctx) {
  return mutasi({ barang_id, gudang_id, tanggal, jenis, qty: -Math.abs(Number(qty)), nilai,
    referensi, keterangan }, ctx);
}

/** Transfer stok antar gudang (tanpa jurnal karena nilai persediaan tidak berubah). */
export function transferGudang({ barang_id, dari_gudang_id, ke_gudang_id, qty, tanggal, keterangan }, ctx) {
  if (dari_gudang_id === ke_gudang_id) throw badRequest('Gudang asal dan tujuan tidak boleh sama');
  const q = Number(qty);
  if (!(q > 0)) throw badRequest('Kuantitas transfer harus lebih besar dari nol');
  const tgl = tanggal || today();
  return tx(() => {
    const keluar = mutasi({ barang_id, gudang_id: dari_gudang_id, tanggal: tgl, jenis: 'transfer_keluar', pindah: true,
      qty: -q, referensi: `transfer:${ke_gudang_id}`, keterangan }, ctx);
    const masuk = mutasi({ barang_id, gudang_id: ke_gudang_id, tanggal: tgl, jenis: 'transfer_masuk', pindah: true,
      qty: q, referensi: `transfer:${dari_gudang_id}`, keterangan }, ctx);
    logAudit(ctx, { aksi: 'create', modul: 'persediaan', entitas_id: barang_id,
      keterangan: `Transfer ${q} unit barang #${barang_id}: gudang ${dari_gudang_id} → ${ke_gudang_id}` });
    return { keluar, masuk };
  });
}

/** Membuat dokumen stock opname berisi seluruh barang bersaldo pada gudang. */
export function mulaiOpname({ gudang_id, tanggal, keterangan }, ctx) {
  const g = get('SELECT * FROM gudang WHERE id = ?', [gudang_id]);
  if (!g) throw notFound('Gudang tidak ditemukan');
  const tgl = tanggal || today();
  return tx(() => {
    const nomor = nextNumber('SO', tgl);
    const { lastInsertRowid: id } = run(
      `INSERT INTO stock_opname(nomor, tanggal, gudang_id, keterangan, petugas)
       VALUES(?,?,?,?,?)`,
      [nomor, tgl, gudang_id, keterangan || null, ctx?.user?.username || 'sistem'],
    );
    const items = all(
      `SELECT s.barang_id, s.qty FROM stok s WHERE s.gudang_id = ? AND s.qty <> 0`, [gudang_id]);
    for (const it of items) {
      run(`INSERT INTO stock_opname_detail(opname_id, barang_id, qty_sistem, qty_fisik, selisih)
           VALUES(?,?,?,?,0)`, [id, it.barang_id, it.qty, it.qty]);
    }
    logAudit(ctx, { aksi: 'create', modul: 'persediaan', entitas_id: id,
      keterangan: `Stock opname ${nomor} di ${g.nama} (${items.length} item)` });
    return { id, nomor, jumlah_item: items.length };
  });
}

/**
 * Menyelesaikan stock opname: menyesuaikan stok & membukukan selisih.
 * Selisih kurang → beban; selisih lebih → pendapatan lain-lain.
 */
export function selesaikanOpname(opname_id, detail, ctx) {
  const op = get('SELECT * FROM stock_opname WHERE id = ?', [opname_id]);
  if (!op) throw notFound('Dokumen opname tidak ditemukan');
  if (op.status === 'selesai') throw conflict('Stock opname ini sudah diselesaikan');
  if (op.status === 'batal') throw conflict('Stock opname ini sudah dibatalkan');

  return tx(() => {
    let nilaiKurang = 0;
    let nilaiLebih = 0;
    const perAkun = new Map();
    for (const d of detail || []) {
      const row = get('SELECT * FROM stock_opname_detail WHERE id = ? AND opname_id = ?', [d.id, opname_id]);
      if (!row) continue;
      const fisik = Number(d.qty_fisik);
      if (!Number.isFinite(fisik) || fisik < 0) throw badRequest('Kuantitas fisik tidak valid');
      const selisih = fisik - row.qty_sistem;
      const barang = get('SELECT * FROM barang WHERE id = ?', [row.barang_id]);
      let nilai = 0;
      if (selisih !== 0) {
        // Nilai selisih diambil dari mutasi stok supaya jurnal = kartu stok
        const m = mutasi({ barang_id: row.barang_id, gudang_id: op.gudang_id, tanggal: op.tanggal, jenis: 'opname',
          qty: selisih, referensi: `opname:${opname_id}`, keterangan: 'Penyesuaian stock opname' }, ctx);
        nilai = selisih > 0 ? m.nilai : -m.nilai;
      }
      run(`UPDATE stock_opname_detail SET qty_fisik = ?, selisih = ?, nilai_selisih = ?, keterangan = ?
             WHERE id = ?`, [fisik, selisih, nilai, d.keterangan || null, row.id]);
      if (selisih !== 0) {
        if (nilai < 0) nilaiKurang += -nilai; else nilaiLebih += nilai;
        tambahNilai(perAkun, akunBarang(barang).persediaan, nilai);
      }
    }

    // Selisih dibukukan per akun persediaan barang: selisih lebih menambah
    // persediaan (K pendapatan lain), selisih kurang menguranginya (D beban selisih).
    let jurnal = null;
    const lines = [];
    for (const [kode, nilai] of perAkun) {
      if (nilai > 0) {
        lines.push({ coa_kode: kode, debit: nilai, keterangan: 'Selisih lebih opname' });
        lines.push({ coa_kode: AKUN.pendapatan_lain(), kredit: nilai, keterangan: 'Selisih lebih persediaan' });
      } else if (nilai < 0) {
        lines.push({ coa_kode: AKUN.beban_selisih(), debit: -nilai, keterangan: 'Selisih kurang persediaan' });
        lines.push({ coa_kode: kode, kredit: -nilai, keterangan: 'Selisih kurang opname' });
      }
    }
    if (lines.length) {
      jurnal = postJournal({
        tanggal: op.tanggal, tipe: 'penyesuaian', referensi: `opname:${opname_id}`,
        keterangan: `Penyesuaian stock opname ${op.nomor}`, lines,
      }, ctx);
    }
    run("UPDATE stock_opname SET status = 'selesai', jurnal_id = ? WHERE id = ?", [jurnal?.id || null, opname_id]);
    logAudit(ctx, { aksi: 'post', modul: 'persediaan', entitas_id: opname_id,
      keterangan: `Stock opname ${op.nomor} selesai (kurang Rp ${nilaiKurang.toLocaleString('id-ID')}, lebih Rp ${nilaiLebih.toLocaleString('id-ID')})` });
    return { opname_id, nilai_kurang: nilaiKurang, nilai_lebih: nilaiLebih, jurnal };
  });
}

/**
 * Membatalkan dokumen stock opname yang belum diselesaikan. Dokumen draft
 * belum mengubah stok maupun membentuk jurnal, sehingga cukup ditandai batal.
 */
export function batalOpname(opname_id, alasan, ctx) {
  const op = get('SELECT * FROM stock_opname WHERE id = ?', [opname_id]);
  if (!op) throw notFound('Dokumen opname tidak ditemukan');
  if (op.status === 'selesai') {
    throw conflict('Stock opname yang sudah diselesaikan tidak dapat dibatalkan',
      'Koreksi selisih memakai penyesuaian stok');
  }
  if (op.status === 'batal') throw conflict('Stock opname ini sudah dibatalkan');
  const ket = String(alasan || '').trim();
  if (!ket) throw badRequest('Alasan pembatalan wajib diisi');
  run("UPDATE stock_opname SET status = 'batal', alasan_batal = ? WHERE id = ?", [ket, opname_id]);
  logAudit(ctx, { aksi: 'void', modul: 'persediaan', entitas_id: opname_id,
    keterangan: `Stock opname ${op.nomor} dibatalkan: ${ket}` });
  return { opname_id, nomor: op.nomor, status: 'batal' };
}

/** Kartu stok (riwayat mutasi) satu barang. */
export function kartuStok(barang_id, { gudang_id, dari, sampai } = {}) {
  const w = ['m.barang_id = ?'];
  const p = [barang_id];
  if (gudang_id) { w.push('m.gudang_id = ?'); p.push(gudang_id); }
  if (dari) { w.push('m.tanggal >= ?'); p.push(dari); }
  if (sampai) { w.push('m.tanggal <= ?'); p.push(sampai); }
  return all(
    `SELECT m.*, g.nama AS gudang_nama FROM mutasi_stok m
       JOIN gudang g ON g.id = m.gudang_id
      WHERE ${w.join(' AND ')} ORDER BY m.tanggal, m.id`, p);
}

/** Nilai persediaan per barang (untuk laporan & rekonsiliasi neraca). */
export function nilaiPersediaan({ gudang_id } = {}) {
  const rows = all(
    `SELECT b.id, b.kode, b.nama, b.satuan, b.harga_beli, b.nilai_persediaan, b.stok_minimum, b.reorder_point,
            COALESCE(SUM(s.qty),0) AS qty
       FROM barang b LEFT JOIN stok s ON s.barang_id = b.id ${gudang_id ? 'AND s.gudang_id = ?' : ''}
      WHERE b.status = 'aktif'
      GROUP BY b.id ORDER BY b.kode`,
    gudang_id ? [gudang_id] : [],
  ).map((r) => ({ ...r, nilai: !gudang_id && r.nilai_persediaan !== null ? r.nilai_persediaan : rupiah(r.qty * r.harga_beli),
    status_stok: r.qty <= 0 ? 'habis' : r.qty <= r.stok_minimum ? 'kritis'
      : r.qty <= r.reorder_point ? 'perlu_order' : 'aman' }));
  return { baris: rows, total_nilai: rows.reduce((s, r) => s + r.nilai, 0) };
}

/** Barang yang perlu dipesan ulang. */
export function daftarReorder() {
  return nilaiPersediaan().baris.filter((r) => ['habis', 'kritis', 'perlu_order'].includes(r.status_stok));
}
