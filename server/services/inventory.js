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

/** Stok barang pada satu gudang (0 bila belum pernah ada mutasi). */
export function stokBarang(barang_id, gudang_id) {
  return scalar('SELECT COALESCE(qty,0) FROM stok WHERE barang_id = ? AND gudang_id = ?',
    [barang_id, gudang_id]);
}

export function totalStok(barang_id) {
  return scalar('SELECT COALESCE(SUM(qty),0) FROM stok WHERE barang_id = ?', [barang_id]);
}

/**
 * Mencatat mutasi stok dan (untuk barang masuk) memperbarui HPP rata-rata bergerak.
 *
 * @param {number} qty (+) masuk / (-) keluar
 * @param {number} harga harga satuan untuk mutasi masuk; diabaikan saat keluar
 */
export function mutasi({ barang_id, gudang_id, tanggal, jenis, qty, harga = 0, batch, serial_number, expired, referensi, keterangan }, ctx) {
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

  // HPP rata-rata bergerak hanya dihitung ulang saat barang masuk dengan harga
  let hpp = barang.harga_beli;
  if (qty > 0 && harga > 0) {
    const totalGlobal = totalStok(barang_id);
    const nilaiLama = totalGlobal * barang.harga_beli;
    const nilaiBaru = qty * harga;
    const qtyTotal = totalGlobal + qty;
    hpp = qtyTotal > 0 ? rupiah((nilaiLama + nilaiBaru) / qtyTotal) : harga;
    run('UPDATE barang SET harga_beli = ? WHERE id = ?', [hpp, barang_id]);
  }

  run(
    `INSERT INTO stok(barang_id, gudang_id, qty) VALUES(?,?,?)
     ON CONFLICT(barang_id, gudang_id) DO UPDATE SET qty = ?`,
    [barang_id, gudang_id, stokBaru, stokBaru],
  );
  const { lastInsertRowid: id } = run(
    `INSERT INTO mutasi_stok(tanggal, barang_id, gudang_id, jenis, qty, harga, saldo_qty,
       batch, serial_number, expired, referensi, keterangan)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    [tanggal || today(), barang_id, gudang_id, jenis, qty, qty > 0 ? harga : hpp, stokBaru,
      batch || null, serial_number || null, expired || null, referensi || null, keterangan || null],
  );

  // Peringatan stok minimum / reorder point
  const totalSesudah = totalStok(barang_id);
  if (qty < 0 && barang.reorder_point > 0 && totalSesudah <= barang.reorder_point) {
    notify({ role: 'staf_gudang', judul: 'Stok mencapai titik pemesanan ulang',
      pesan: `${barang.kode} - ${barang.nama}: sisa ${totalSesudah} ${barang.satuan} (ROP ${barang.reorder_point})`,
      tipe: 'warning', link: '#/persediaan' });
  }
  return { id, stok_sebelum: stokLama, stok_sesudah: stokBaru, hpp };
}

/** Transfer stok antar gudang (tanpa jurnal karena nilai persediaan tidak berubah). */
export function transferGudang({ barang_id, dari_gudang_id, ke_gudang_id, qty, tanggal, keterangan }, ctx) {
  if (dari_gudang_id === ke_gudang_id) throw badRequest('Gudang asal dan tujuan tidak boleh sama');
  const q = Number(qty);
  if (!(q > 0)) throw badRequest('Kuantitas transfer harus lebih besar dari nol');
  const tgl = tanggal || today();
  return tx(() => {
    const keluar = mutasi({ barang_id, gudang_id: dari_gudang_id, tanggal: tgl, jenis: 'transfer_keluar',
      qty: -q, referensi: `transfer:${ke_gudang_id}`, keterangan }, ctx);
    const masuk = mutasi({ barang_id, gudang_id: ke_gudang_id, tanggal: tgl, jenis: 'transfer_masuk',
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

  return tx(() => {
    let nilaiKurang = 0;
    let nilaiLebih = 0;
    for (const d of detail || []) {
      const row = get('SELECT * FROM stock_opname_detail WHERE id = ? AND opname_id = ?', [d.id, opname_id]);
      if (!row) continue;
      const fisik = Number(d.qty_fisik);
      if (!Number.isFinite(fisik) || fisik < 0) throw badRequest('Kuantitas fisik tidak valid');
      const selisih = fisik - row.qty_sistem;
      const barang = get('SELECT harga_beli FROM barang WHERE id = ?', [row.barang_id]);
      const nilai = rupiah(selisih * (barang?.harga_beli || 0));
      run(`UPDATE stock_opname_detail SET qty_fisik = ?, selisih = ?, nilai_selisih = ?, keterangan = ?
             WHERE id = ?`, [fisik, selisih, nilai, d.keterangan || null, row.id]);
      if (selisih !== 0) {
        mutasi({ barang_id: row.barang_id, gudang_id: op.gudang_id, tanggal: op.tanggal, jenis: 'opname',
          qty: selisih, referensi: `opname:${opname_id}`, keterangan: 'Penyesuaian stock opname' }, ctx);
        if (nilai < 0) nilaiKurang += -nilai; else nilaiLebih += nilai;
      }
    }

    let jurnal = null;
    if (nilaiKurang > 0 || nilaiLebih > 0) {
      const lines = [];
      const selisihBersih = nilaiLebih - nilaiKurang;
      if (selisihBersih > 0) {
        lines.push({ coa_kode: AKUN.persediaan(), debit: selisihBersih, keterangan: 'Selisih lebih opname' });
        lines.push({ coa_kode: AKUN.pendapatan_lain(), kredit: selisihBersih, keterangan: 'Selisih lebih persediaan' });
      } else if (selisihBersih < 0) {
        lines.push({ coa_kode: AKUN.beban_selisih(), debit: -selisihBersih, keterangan: 'Selisih kurang persediaan' });
        lines.push({ coa_kode: AKUN.persediaan(), kredit: -selisihBersih, keterangan: 'Selisih kurang opname' });
      }
      if (lines.length) {
        jurnal = postJournal({
          tanggal: op.tanggal, tipe: 'penyesuaian', referensi: `opname:${opname_id}`,
          keterangan: `Penyesuaian stock opname ${op.nomor}`, lines,
        }, ctx);
      }
    }
    run("UPDATE stock_opname SET status = 'selesai', jurnal_id = ? WHERE id = ?", [jurnal?.id || null, opname_id]);
    logAudit(ctx, { aksi: 'post', modul: 'persediaan', entitas_id: opname_id,
      keterangan: `Stock opname ${op.nomor} selesai (kurang Rp ${nilaiKurang.toLocaleString('id-ID')}, lebih Rp ${nilaiLebih.toLocaleString('id-ID')})` });
    return { opname_id, nilai_kurang: nilaiKurang, nilai_lebih: nilaiLebih, jurnal };
  });
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
    `SELECT b.id, b.kode, b.nama, b.satuan, b.harga_beli, b.stok_minimum, b.reorder_point,
            COALESCE(SUM(s.qty),0) AS qty
       FROM barang b LEFT JOIN stok s ON s.barang_id = b.id ${gudang_id ? 'AND s.gudang_id = ?' : ''}
      WHERE b.status = 'aktif'
      GROUP BY b.id ORDER BY b.kode`,
    gudang_id ? [gudang_id] : [],
  ).map((r) => ({ ...r, nilai: rupiah(r.qty * r.harga_beli),
    status_stok: r.qty <= 0 ? 'habis' : r.qty <= r.stok_minimum ? 'kritis'
      : r.qty <= r.reorder_point ? 'perlu_order' : 'aman' }));
  return { baris: rows, total_nilai: rows.reduce((s, r) => s + r.nilai, 0) };
}

/** Barang yang perlu dipesan ulang. */
export function daftarReorder() {
  return nilaiPersediaan().baris.filter((r) => ['habis', 'kritis', 'perlu_order'].includes(r.status_stok));
}
