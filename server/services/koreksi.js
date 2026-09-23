/**
 * Koreksi transaksi yang sudah tersimpan: UBAH dan BATAL.
 *
 * Prinsip (UU ITE & praktik akuntansi): transaksi terjurnal tidak pernah
 * dihapus atau ditimpa. Pembatalan membentuk jurnal balik atas jurnal asli dan
 * mengembalikan buku pembantunya (stok, saldo simpanan, jadwal pinjaman,
 * utang/piutang); "ubah" = batal + transaksi pengganti bernomor baru.
 * Semuanya dalam satu transaksi basis data, sehingga jurnal, buku besar, dan
 * neraca selalu ikut terkoreksi atau tidak sama sekali.
 *
 * Hak akses: aksi "<modul>.koreksi" (lihat server/lib/rbac.js).
 */
import { all, get, run, scalar, nextNumber, tx } from '../db.js';
import { badRequest, notFound, conflict } from '../lib/http.js';
import { logAudit } from '../lib/audit.js';
import { rupiah, today } from '../lib/util.js';
import { postJournal, voidJournal, sumberJurnal, tanggalKoreksi } from './accounting.js';
import { mutasi, keluarkanSenilai } from './inventory.js';
import { jual } from './trade.js';
import { batalTransaksi, setoran, penarikan, setBlokir } from './savings.js';
import { bayarAngsuran, perbaruiKolektibilitas } from './loans.js';

const wajibAlasan = (alasan) => {
  if (!String(alasan || '').trim()) throw badRequest('Alasan koreksi wajib diisi');
  return String(alasan).trim();
};

/** Seluruh jurnal berstatus posted dengan referensi tertentu (bukan jurnal balik). */
const jurnalAktif = (referensi) => all(
  "SELECT * FROM jurnal WHERE referensi = ? AND status = 'posted' ORDER BY id", [referensi]);

// ------------------------------ Jurnal umum ------------------------------

/**
 * Mengubah jurnal umum yang diinput manual (atau hasil jurnal berulang):
 * jurnal lama dibatalkan dengan jurnal balik, lalu jurnal pengganti diposting.
 * Jurnal otomatis modul dikoreksi lewat dokumen sumbernya.
 */
export function ubahJurnal(id, data, alasan, ctx) {
  alasan = wajibAlasan(alasan);
  const j = get('SELECT * FROM jurnal WHERE id = ?', [id]);
  if (!j) throw notFound('Jurnal tidak ditemukan');
  if (j.status !== 'posted') throw conflict('Hanya jurnal berstatus posted yang dapat diubah');
  if (String(j.referensi || '').startsWith('void:')) throw conflict('Jurnal balik tidak dapat diubah');
  const sumber = sumberJurnal(j);
  if (sumber === 'sistem' || j.tipe === 'penutup') {
    throw conflict(`Jurnal ${j.nomor} dibentuk otomatis oleh modul dan tidak dapat diubah dari buku besar`,
      'Ubah atau batalkan dokumen sumbernya (bukti kas, penjualan, simpanan, dsb.).');
  }
  return tx(() => {
    const balik = voidJournal(id, `Diubah: ${alasan}`, ctx);
    const baru = postJournal({
      tanggal: data.tanggal || j.tanggal,
      tipe: ['umum', 'penyesuaian', 'pembuka'].includes(data.tipe) ? data.tipe : j.tipe,
      referensi: data.referensi ?? (j.referensi || `koreksi:${j.id}`),
      keterangan: data.keterangan || j.keterangan,
      cabang_id: data.cabang_id ?? j.cabang_id,
      unit_usaha_id: data.unit_usaha_id ?? j.unit_usaha_id,
      sumber: 'manual',
      lines: data.lines,
    }, ctx);
    logAudit(ctx, { aksi: 'update', modul: 'akuntansi', entitas_id: id,
      keterangan: `Jurnal ${j.nomor} diubah → ${baru.nomor}: ${alasan}` });
    return { dibatalkan: j.nomor, jurnal_balik: balik, pengganti: baru };
  });
}

// ------------------------------- Penjualan -------------------------------

/**
 * Membatalkan seluruh transaksi penjualan / POS:
 * jurnal penjualan (pendapatan, PPN, HPP, persediaan, kas/piutang/simpanan)
 * dibalik, barang kembali ke gudang pada HPP semula, piutang dihapus, dana
 * potong simpanan dikembalikan, dan poin loyalti dibatalkan.
 */
export function batalPenjualan(id, alasan, ctx) {
  alasan = wajibAlasan(alasan);
  const p = get('SELECT * FROM penjualan WHERE id = ?', [id]);
  if (!p) throw notFound('Transaksi penjualan tidak ditemukan');
  if (p.status === 'batal') throw conflict('Transaksi ini sudah dibatalkan');
  if (p.status === 'retur') throw conflict('Transaksi yang sudah diretur penuh tidak perlu dibatalkan');
  if (scalar("SELECT COUNT(*) FROM mutasi_stok WHERE referensi = ? AND jenis = 'retur_masuk'", [`retur:${id}`]) > 0) {
    throw conflict('Sebagian barang pada transaksi ini sudah diretur',
      'Gunakan retur penjualan untuk sisa barang yang ingin dibatalkan.');
  }
  const hp = get("SELECT * FROM hutang_piutang WHERE jenis = 'piutang' AND referensi = ?", [`penjualan:${id}`]);
  if (hp && hp.terbayar > 0) {
    throw conflict('Piutang penjualan ini sudah dibayar sebagian',
      'Batalkan pembayaran piutangnya terlebih dahulu di menu Penjualan → Piutang.');
  }

  return tx(() => {
    const tgl = today();
    const jurnal = p.jurnal_id
      ? voidJournal(p.jurnal_id, `Pembatalan penjualan ${p.nomor}: ${alasan}`, ctx, { sistem: true }) : null;

    // Barang kembali ke gudang pada HPP saat dijual
    for (const d of all('SELECT * FROM penjualan_detail WHERE penjualan_id = ?', [id])) {
      mutasi({ barang_id: d.barang_id, gudang_id: p.gudang_id, tanggal: tgl, jenis: 'batal_jual',
        qty: d.qty, harga: d.hpp_satuan, nilai: d.hpp_nilai ?? rupiah(d.hpp_satuan * d.qty), referensi: `batal:penjualan:${id}`,
        keterangan: `Pembatalan ${p.nomor}` }, ctx);
    }
    if (hp) run('DELETE FROM hutang_piutang WHERE id = ?', [hp.id]);

    // Dana potong simpanan dikembalikan ke rekening yang sama
    if (p.metode_bayar === 'potong_simpanan') {
      const t = get(`SELECT t.*, r.saldo FROM transaksi_simpanan t JOIN rekening_simpanan r ON r.id = t.rekening_id
                      WHERE (t.jurnal_id = ? OR t.keterangan = ?) AND t.jenis = 'penarikan' ORDER BY t.id LIMIT 1`,
      [p.jurnal_id, `Pembayaran belanja ${p.nomor}`]);
      if (t) {
        const saldo = t.saldo + t.debit;
        run('UPDATE rekening_simpanan SET saldo = ? WHERE id = ?', [saldo, t.rekening_id]);
        run(`INSERT INTO transaksi_simpanan(nomor, rekening_id, tanggal, jenis, kredit, saldo_akhir, keterangan,
               jurnal_id, metode, petugas) VALUES(?,?,?,'koreksi',?,?,?,?,'pindah_buku',?)`,
        [nextNumber('TSP', tgl), t.rekening_id, tgl, t.debit, saldo, `Pembatalan belanja ${p.nomor}`,
          jurnal?.id || null, ctx?.user?.username || 'sistem']);
        run("UPDATE transaksi_simpanan SET status = 'batal' WHERE id = ?", [t.id]);
      }
    }

    // Poin loyalti yang didapat/dipakai pada transaksi ini dibalik
    if (p.anggota_id) {
      for (const lp of all('SELECT * FROM loyalty_poin WHERE referensi = ?', [`penjualan:${id}`])) {
        const saldoPoin = scalar('SELECT COALESCE(SUM(poin),0) FROM loyalty_poin WHERE anggota_id = ?', [p.anggota_id]);
        run(`INSERT INTO loyalty_poin(anggota_id, tanggal, poin, saldo, referensi, keterangan) VALUES(?,?,?,?,?,?)`,
          [p.anggota_id, tgl, -lp.poin, saldoPoin - lp.poin, `batal:penjualan:${id}`, `Pembatalan ${p.nomor}`]);
      }
    }
    run("UPDATE penjualan SET status = 'batal', alasan_batal = ? WHERE id = ?", [alasan, id]);
    logAudit(ctx, { aksi: 'void', modul: 'penjualan', entitas_id: id,
      keterangan: `Penjualan ${p.nomor} Rp ${p.total.toLocaleString('id-ID')} dibatalkan: ${alasan}`, before: p });
    return { id, nomor: p.nomor, status: 'batal', jurnal_balik: jurnal };
  });
}

/** Mengubah penjualan: transaksi lama dibatalkan, transaksi pengganti dibuat. */
export function ubahPenjualan(id, data, alasan, ctx) {
  const p = get('SELECT * FROM penjualan WHERE id = ?', [id]);
  if (!p) throw notFound('Transaksi penjualan tidak ditemukan');
  return tx(() => {
    batalPenjualan(id, alasan || 'Diubah', ctx);
    const baru = jual({
      tanggal: p.tanggal, tipe: p.tipe, anggota_id: p.anggota_id, customer_id: p.customer_id,
      gudang_id: p.gudang_id, unit_usaha_id: p.unit_usaha_id, cabang_id: p.cabang_id,
      metode_bayar: p.metode_bayar, ...data,
    }, ctx);
    return { dibatalkan: p.nomor, pengganti: baru };
  });
}

// ------------------------------- Pembelian -------------------------------

/**
 * Membatalkan penerimaan barang sebuah PO: stok keluar senilai saat diterima,
 * jurnal penerimaan dibalik, utang dihapus, PO kembali siap diterima/dibatalkan.
 */
export function batalPenerimaan(pembelian_id, alasan, ctx) {
  alasan = wajibAlasan(alasan);
  const pb = get('SELECT * FROM pembelian WHERE id = ?', [pembelian_id]);
  if (!pb) throw notFound('Dokumen pembelian tidak ditemukan');
  if (!['diterima', 'selesai'].includes(pb.status)) throw conflict('Dokumen ini belum memiliki penerimaan barang');
  const hutang = all("SELECT * FROM hutang_piutang WHERE jenis = 'hutang' AND referensi = ?", [`pembelian:${pembelian_id}`]);
  if (hutang.some((h) => h.terbayar > 0)) {
    throw conflict('Utang atas pembelian ini sudah dibayar',
      'Batalkan pembayaran utangnya terlebih dahulu di menu Pembelian → Utang.');
  }
  return tx(() => {
    const tgl = today();
    const masuk = all(`SELECT * FROM mutasi_stok WHERE referensi = ? AND jenis = 'masuk' ORDER BY id`,
      [`pembelian:${pembelian_id}`]);
    for (const m of masuk) {
      keluarkanSenilai({ barang_id: m.barang_id, gudang_id: m.gudang_id, tanggal: tgl, qty: m.qty,
        nilai: m.nilai ?? rupiah(m.qty * m.harga), jenis: 'batal_terima', referensi: `batal:pembelian:${pembelian_id}`,
        keterangan: `Pembatalan penerimaan ${pb.nomor}` }, ctx);
    }
    const balik = jurnalAktif(`pembelian:${pembelian_id}`)
      .map((j) => voidJournal(j.id, `Pembatalan penerimaan ${pb.nomor}: ${alasan}`, ctx, { sistem: true }));
    for (const h of hutang) run('DELETE FROM hutang_piutang WHERE id = ?', [h.id]);
    run('UPDATE pembelian_detail SET qty_diterima = 0 WHERE pembelian_id = ?', [pembelian_id]);
    run("UPDATE pembelian SET status = 'disetujui', terbayar = 0, jurnal_id = NULL WHERE id = ?", [pembelian_id]);
    logAudit(ctx, { aksi: 'void', modul: 'pembelian', entitas_id: pembelian_id,
      keterangan: `Penerimaan barang ${pb.nomor} dibatalkan: ${alasan}`, before: pb });
    return { id: pembelian_id, nomor: pb.nomor, jurnal_balik: balik };
  });
}

// ---------------------------- Utang & piutang ----------------------------

/** Riwayat pembayaran sebuah utang/piutang (dari jurnalnya). */
export function riwayatPembayaran(hp_id) {
  return all(`SELECT id AS jurnal_id, nomor, tanggal, total_debit AS nominal, status, keterangan
                FROM jurnal WHERE referensi = ? ORDER BY tanggal, id`, [`hp:${hp_id}`]);
}

/** Membatalkan satu pembayaran utang / penerimaan piutang. */
export function batalPembayaranHP(jurnal_id, alasan, ctx) {
  alasan = wajibAlasan(alasan);
  const j = get('SELECT * FROM jurnal WHERE id = ?', [jurnal_id]);
  if (!j || !String(j.referensi || '').startsWith('hp:')) throw notFound('Pembayaran tidak ditemukan');
  if (j.status !== 'posted') throw conflict('Pembayaran ini sudah dibatalkan');
  const hp = get('SELECT * FROM hutang_piutang WHERE id = ?', [Number(j.referensi.slice(3))]);
  if (!hp) throw notFound('Data utang/piutang tidak ditemukan');
  return tx(() => {
    const balik = voidJournal(j.id, `Pembatalan pembayaran ${hp.referensi}: ${alasan}`, ctx, { sistem: true });
    const terbayar = Math.max(0, hp.terbayar - j.total_debit);
    run("UPDATE hutang_piutang SET terbayar = ?, status = 'terbuka' WHERE id = ?", [terbayar, hp.id]);
    if (hp.referensi.startsWith('pembelian:')) {
      run('UPDATE pembelian SET terbayar = MAX(0, terbayar - ?) WHERE id = ?', [j.total_debit, Number(hp.referensi.split(':')[1])]);
    }
    logAudit(ctx, { aksi: 'void', modul: hp.jenis === 'hutang' ? 'pembelian' : 'penjualan', entitas_id: hp.id,
      keterangan: `Pembayaran ${j.nomor} atas ${hp.referensi} dibatalkan: ${alasan}` });
    return { hutang_piutang_id: hp.id, terbayar, jurnal_balik: balik };
  });
}

// -------------------------------- Simpanan --------------------------------

/** Mengubah setoran/penarikan: transaksi lama dibatalkan, pengganti dibuat. */
export function ubahTransaksiSimpanan(id, data, alasan, ctx) {
  const t = get('SELECT * FROM transaksi_simpanan WHERE id = ?', [id]);
  if (!t) throw notFound('Transaksi simpanan tidak ditemukan');
  return tx(() => {
    batalTransaksi(id, alasan || 'Diubah', ctx);
    const d = {
      rekening_id: data.rekening_id || t.rekening_id,
      tanggal: data.tanggal || t.tanggal,
      nominal: data.nominal ?? (t.kredit || t.debit),
      keterangan: data.keterangan ?? t.keterangan,
      metode: data.metode || t.metode,
      bank_account_id: data.bank_account_id ?? t.bank_account_id,
    };
    const baru = t.jenis === 'setoran' ? setoran(d, ctx) : penarikan(d, ctx);
    return { dibatalkan: t.nomor, pengganti: baru };
  });
}

// -------------------------------- Pinjaman --------------------------------

/**
 * Menyusun ulang alokasi pembayaran pada jadwal angsuran dari seluruh
 * angsuran yang masih berlaku, dengan urutan & aturan yang sama seperti saat
 * pembayaran diterima (bunga lalu pokok per jadwal; kelebihan mengurangi
 * pokok jadwal terakhir). Dipakai sesudah angsuran terakhir dibatalkan.
 */
function susunUlangJadwal(pinjaman_id) {
  run(`UPDATE pinjaman_jadwal SET bayar_pokok = 0, bayar_bunga = 0, status = 'belum', tanggal_bayar = NULL
        WHERE pinjaman_id = ?`, [pinjaman_id]);
  const p = get('SELECT * FROM pinjaman WHERE id = ?', [pinjaman_id]);
  let outstanding = p.pokok;
  for (const a of all(`SELECT * FROM pinjaman_angsuran WHERE pinjaman_id = ? AND status <> 'batal' ORDER BY id`,
    [pinjaman_id])) {
    if (a.jenis === 'pelunasan_dipercepat') {
      run(`UPDATE pinjaman_jadwal SET bayar_pokok = pokok, bayar_bunga = bunga, status = 'lunas', tanggal_bayar = ?
            WHERE pinjaman_id = ? AND status <> 'lunas'`, [a.tanggal, pinjaman_id]);
      outstanding = 0;
      continue;
    }
    let sisa = a.bayar_pokok + a.bayar_bunga;
    let pokokDibayar = 0;
    for (const j of all("SELECT * FROM pinjaman_jadwal WHERE pinjaman_id = ? AND status <> 'lunas' ORDER BY angsuran_ke",
      [pinjaman_id])) {
      if (sisa <= 0) break;
      const bB = Math.min(j.bunga - j.bayar_bunga, sisa);
      sisa -= bB;
      const bP = Math.min(j.pokok - j.bayar_pokok, sisa);
      sisa -= bP;
      pokokDibayar += bP;
      const total = j.bayar_pokok + bP + j.bayar_bunga + bB;
      const st = total >= j.total ? 'lunas' : total > 0 ? 'sebagian' : 'belum';
      run(`UPDATE pinjaman_jadwal SET bayar_pokok = ?, bayar_bunga = ?, status = ?,
             tanggal_bayar = CASE WHEN ? = 'lunas' THEN ? ELSE tanggal_bayar END WHERE id = ?`,
      [j.bayar_pokok + bP, j.bayar_bunga + bB, st, st, a.tanggal, j.id]);
    }
    if (sisa > 0) {
      let extra = Math.min(sisa, outstanding - pokokDibayar);
      pokokDibayar += extra;
      for (const j of all("SELECT * FROM pinjaman_jadwal WHERE pinjaman_id = ? AND status <> 'lunas' ORDER BY angsuran_ke DESC",
        [pinjaman_id])) {
        if (extra <= 0) break;
        const amb = Math.min(j.pokok - j.bayar_pokok, extra);
        extra -= amb;
        run('UPDATE pinjaman_jadwal SET bayar_pokok = ?, status = ? WHERE id = ?',
          [j.bayar_pokok + amb, j.bayar_pokok + amb + j.bayar_bunga >= j.total ? 'lunas' : 'sebagian', j.id]);
      }
    }
    outstanding -= pokokDibayar;
  }
}

/** Menahan kembali agunan bila pinjaman yang sempat lunas kembali berjalan. */
function tahanAgunanLagi(pinjaman_id, ctx) {
  run("UPDATE pinjaman_agunan SET status = 'ditahan' WHERE pinjaman_id = ? AND status = 'dikembalikan'", [pinjaman_id]);
  for (const ag of all("SELECT * FROM pinjaman_agunan WHERE pinjaman_id = ? AND jenis IN ('simpanan','deposito')", [pinjaman_id])) {
    const rek = get('SELECT id, saldo, saldo_blokir FROM rekening_simpanan WHERE nomor_rekening = ?', [ag.nomor_dokumen]);
    if (rek) setBlokir(rek.id, Math.min(rek.saldo, rek.saldo_blokir + ag.nilai_taksiran), ctx);
  }
}

/**
 * Membatalkan angsuran / pelunasan. Hanya pembayaran TERAKHIR yang dapat
 * dibatalkan, karena alokasi pembayaran berikutnya bergantung padanya.
 */
export function batalAngsuran(angsuran_id, alasan, ctx) {
  alasan = wajibAlasan(alasan);
  const a = get('SELECT * FROM pinjaman_angsuran WHERE id = ?', [angsuran_id]);
  if (!a) throw notFound('Data angsuran tidak ditemukan');
  if (a.status === 'batal') throw conflict('Angsuran ini sudah dibatalkan');
  const terakhir = get(`SELECT id, nomor FROM pinjaman_angsuran WHERE pinjaman_id = ? AND status <> 'batal'
                         ORDER BY id DESC LIMIT 1`, [a.pinjaman_id]);
  if (terakhir.id !== a.id) {
    throw conflict('Hanya pembayaran terakhir yang dapat dibatalkan',
      `Batalkan terlebih dahulu pembayaran ${terakhir.nomor} yang lebih baru.`);
  }
  const p = get('SELECT * FROM pinjaman WHERE id = ?', [a.pinjaman_id]);
  if (!['dicairkan', 'lunas'].includes(p.status)) {
    throw conflict(`Pinjaman berstatus "${p.status}" tidak dapat dikoreksi pembayarannya`);
  }
  return tx(() => {
    const balik = a.jurnal_id
      ? voidJournal(a.jurnal_id, `Pembatalan ${a.nomor}: ${alasan}`, ctx, { sistem: true }) : null;
    run("UPDATE pinjaman_angsuran SET status = 'batal', alasan_batal = ? WHERE id = ?", [alasan, a.id]);
    susunUlangJadwal(a.pinjaman_id);
    const bayar = get(`SELECT COALESCE(SUM(bayar_pokok),0) AS pokok, COALESCE(SUM(bayar_bunga),0) AS bunga
                         FROM pinjaman_angsuran WHERE pinjaman_id = ? AND status <> 'batal'`, [a.pinjaman_id]);
    const outPokok = Math.max(0, p.pokok - bayar.pokok);
    const outBunga = Math.max(0, p.total_bunga - bayar.bunga);
    const kembaliBerjalan = p.status === 'lunas' && outPokok > 0;
    run(`UPDATE pinjaman SET outstanding_pokok = ?, outstanding_bunga = ?,
           status = CASE WHEN ? THEN 'dicairkan' ELSE status END,
           tanggal_lunas = CASE WHEN ? THEN NULL ELSE tanggal_lunas END WHERE id = ?`,
    [outPokok, outBunga, kembaliBerjalan ? 1 : 0, kembaliBerjalan ? 1 : 0, a.pinjaman_id]);
    if (kembaliBerjalan) tahanAgunanLagi(a.pinjaman_id, ctx);
    perbaruiKolektibilitas(a.pinjaman_id);
    logAudit(ctx, { aksi: 'void', modul: 'pinjaman', entitas_id: a.pinjaman_id,
      keterangan: `Pembayaran ${a.nomor} Rp ${a.total_bayar.toLocaleString('id-ID')} atas ${p.nomor} dibatalkan: ${alasan}`,
      before: a });
    return { id: a.id, nomor: a.nomor, outstanding_pokok: outPokok, jurnal_balik: balik };
  });
}

/** Mengubah angsuran terakhir: dibatalkan lalu dicatat ulang dengan nilai baru. */
export function ubahAngsuran(angsuran_id, data, alasan, ctx) {
  const a = get('SELECT * FROM pinjaman_angsuran WHERE id = ?', [angsuran_id]);
  if (!a) throw notFound('Data angsuran tidak ditemukan');
  if (a.jenis !== 'angsuran') throw conflict('Pelunasan dipercepat dibatalkan lalu dicatat ulang dari menu pelunasan');
  return tx(() => {
    batalAngsuran(angsuran_id, alasan || 'Diubah', ctx);
    const baru = bayarAngsuran({
      pinjaman_id: a.pinjaman_id, tanggal: data.tanggal || a.tanggal, nominal: data.nominal ?? a.total_bayar,
      metode: data.metode || a.metode, bank_account_id: data.bank_account_id ?? a.bank_account_id,
      keterangan: data.keterangan ?? a.keterangan,
    }, ctx);
    return { dibatalkan: a.nomor, pengganti: baru };
  });
}

/**
 * Membatalkan pencairan pinjaman yang belum menerima angsuran: jurnal
 * pencairan dibalik, pinjaman kembali berstatus "disetujui".
 */
export function batalPencairan(pinjaman_id, alasan, ctx) {
  alasan = wajibAlasan(alasan);
  const p = get('SELECT * FROM pinjaman WHERE id = ?', [pinjaman_id]);
  if (!p) throw notFound('Pinjaman tidak ditemukan');
  if (p.status !== 'dicairkan') throw conflict('Hanya pinjaman berstatus dicairkan yang pencairannya dapat dibatalkan');
  if (p.restruktur_dari) throw conflict('Pinjaman hasil restrukturisasi tidak memiliki pencairan kas untuk dibatalkan');
  if (scalar("SELECT COUNT(*) FROM pinjaman_angsuran WHERE pinjaman_id = ? AND status <> 'batal'", [pinjaman_id]) > 0) {
    throw conflict('Pinjaman ini sudah menerima angsuran', 'Batalkan seluruh angsurannya terlebih dahulu.');
  }
  return tx(() => {
    const balik = jurnalAktif(`pinjaman:${pinjaman_id}`)
      .map((j) => voidJournal(j.id, `Pembatalan pencairan ${p.nomor}: ${alasan}`, ctx, { sistem: true }));
    run(`UPDATE pinjaman_jadwal SET bayar_pokok = 0, bayar_bunga = 0, status = 'belum', tanggal_bayar = NULL
          WHERE pinjaman_id = ?`, [pinjaman_id]);
    run(`UPDATE pinjaman SET status = 'disetujui', tanggal_cair = NULL, outstanding_pokok = 0, outstanding_bunga = 0,
           kolektibilitas = 1, tunggakan_hari = 0 WHERE id = ?`, [pinjaman_id]);
    for (const ag of all("SELECT * FROM pinjaman_agunan WHERE pinjaman_id = ? AND jenis IN ('simpanan','deposito')", [pinjaman_id])) {
      const rek = get('SELECT id, saldo_blokir FROM rekening_simpanan WHERE nomor_rekening = ?', [ag.nomor_dokumen]);
      if (rek) setBlokir(rek.id, Math.max(0, rek.saldo_blokir - ag.nilai_taksiran), ctx);
    }
    logAudit(ctx, { aksi: 'void', modul: 'pinjaman', entitas_id: pinjaman_id,
      keterangan: `Pencairan ${p.nomor} dibatalkan: ${alasan}`, before: p });
    return { id: pinjaman_id, nomor: p.nomor, status: 'disetujui', jurnal_balik: balik };
  });
}

// ------------------------------- Persediaan -------------------------------

/** Membatalkan penyesuaian stok manual beserta jurnalnya. */
export function batalPenyesuaianStok(mutasi_id, alasan, ctx) {
  alasan = wajibAlasan(alasan);
  const m = get('SELECT * FROM mutasi_stok WHERE id = ?', [mutasi_id]);
  if (!m || !['penyesuaian_masuk', 'penyesuaian_keluar'].includes(m.jenis)) {
    throw notFound('Penyesuaian stok tidak ditemukan');
  }
  if (scalar('SELECT COUNT(*) FROM mutasi_stok WHERE referensi = ?', [`batal:stok:${mutasi_id}`]) > 0) {
    throw conflict('Penyesuaian ini sudah dibatalkan');
  }
  return tx(() => {
    const tgl = today();
    const qty = Math.abs(m.qty);
    if (m.jenis === 'penyesuaian_masuk') {
      keluarkanSenilai({ barang_id: m.barang_id, gudang_id: m.gudang_id, tanggal: tgl, qty,
        nilai: m.nilai ?? rupiah(qty * m.harga), jenis: 'batal_penyesuaian', referensi: `batal:stok:${mutasi_id}`,
        keterangan: `Pembatalan penyesuaian: ${alasan}` }, ctx);
    } else {
      mutasi({ barang_id: m.barang_id, gudang_id: m.gudang_id, tanggal: tgl, jenis: 'batal_penyesuaian', qty,
        harga: m.harga, nilai: m.nilai !== null && m.nilai !== undefined ? Math.abs(m.nilai) : null, referensi: `batal:stok:${mutasi_id}`, keterangan: `Pembatalan penyesuaian: ${alasan}` }, ctx);
    }
    const balik = jurnalAktif(`stok:${mutasi_id}`)
      .map((j) => voidJournal(j.id, `Pembatalan penyesuaian stok: ${alasan}`, ctx, { sistem: true }));
    logAudit(ctx, { aksi: 'void', modul: 'persediaan', entitas_id: mutasi_id,
      keterangan: `Penyesuaian stok #${mutasi_id} dibatalkan: ${alasan}`, before: m });
    return { id: mutasi_id, jurnal_balik: balik };
  });
}

export { tanggalKoreksi };
