/**
 * Mesin akuntansi double entry (Permenkop UKM No. 2/2024 & SAK EP).
 *
 * SELURUH modul finansial memposting melalui postJournal() sehingga
 * buku besar selalu menjadi sumber kebenaran tunggal (single source of truth).
 */
import { all, get, run, scalar, nextNumber, tx, setting } from '../db.js';
import { badRequest, notFound, conflict } from '../lib/http.js';
import { logAudit } from '../lib/audit.js';
import { rupiah, yearOf, monthOf, endOfMonth } from '../lib/util.js';

/**
 * Pemetaan akun yang dipakai jurnal otomatis lintas modul.
 *
 * Tidak ada kode akun yang ditanam di dalam kode program: setiap jurnal
 * otomatis membaca akun dari pengaturan `coa.<kunci>` yang diubah melalui
 * Administrator → Parameter Sistem → Pemetaan Akun. Bila pemetaan belum
 * diisi, transaksi ditolak dengan pesan yang jelas alih-alih diam-diam
 * memposting ke akun tebakan.
 *
 * `tipe` adalah tipe akun yang sah untuk pemetaan tersebut dan dipakai untuk
 * memvalidasi isian pengaturan.
 */
export const PEMETAAN_AKUN = [
  { kunci: 'kas', label: 'Kas (penerimaan & pembayaran tunai)', tipe: 'aset' },
  { kunci: 'bank', label: 'Bank (transfer / QRIS bila rekening tidak dipilih)', tipe: 'aset' },
  { kunci: 'piutang_usaha', label: 'Piutang usaha (penjualan kredit)', tipe: 'aset' },
  { kunci: 'piutang_pinjaman', label: 'Piutang pinjaman anggota (bila produk tidak menentukan)', tipe: 'aset' },
  { kunci: 'cadangan_kerugian', label: 'Cadangan kerugian piutang', tipe: 'aset' },
  { kunci: 'persediaan', label: 'Persediaan barang dagang (bila barang tidak menentukan)', tipe: 'aset' },
  { kunci: 'ppn_masukan', label: 'PPN masukan (pajak pembelian)', tipe: 'aset' },
  { kunci: 'aset_tetap', label: 'Aset tetap (bila aset tidak menentukan)', tipe: 'aset' },
  { kunci: 'akumulasi_penyusutan', label: 'Akumulasi penyusutan aset tetap', tipe: 'aset' },
  { kunci: 'hutang_usaha', label: 'Utang usaha (pembelian kredit)', tipe: 'kewajiban' },
  { kunci: 'hutang_pajak', label: 'Utang pajak / PPN keluaran', tipe: 'kewajiban' },
  { kunci: 'shu_dibagikan', label: 'SHU yang akan dibagikan (jasa modal & jasa usaha)', tipe: 'kewajiban' },
  { kunci: 'dana_pengurus', label: 'Dana pengurus & pengawas', tipe: 'kewajiban' },
  { kunci: 'dana_karyawan', label: 'Dana kesejahteraan karyawan', tipe: 'kewajiban' },
  { kunci: 'dana_pendidikan', label: 'Dana pendidikan', tipe: 'kewajiban' },
  { kunci: 'dana_sosial', label: 'Dana sosial', tipe: 'kewajiban' },
  { kunci: 'dana_pembangunan', label: 'Dana pembangunan daerah kerja', tipe: 'kewajiban' },
  { kunci: 'simpanan_pokok', label: 'Simpanan pokok', tipe: 'ekuitas' },
  { kunci: 'simpanan_wajib', label: 'Simpanan wajib', tipe: 'ekuitas' },
  { kunci: 'cadangan', label: 'Dana cadangan', tipe: 'ekuitas' },
  { kunci: 'shu_berjalan', label: 'SHU tahun berjalan (tujuan jurnal penutup)', tipe: 'ekuitas' },
  { kunci: 'shu_ditahan', label: 'SHU tahun lalu yang ditahan', tipe: 'ekuitas' },
  { kunci: 'penjualan', label: 'Penjualan (bila barang tidak menentukan)', tipe: 'pendapatan' },
  { kunci: 'pendapatan_bunga', label: 'Pendapatan jasa pinjaman (bila produk tidak menentukan)', tipe: 'pendapatan' },
  { kunci: 'pendapatan_admin', label: 'Pendapatan administrasi & provisi (bila produk tidak menentukan)', tipe: 'pendapatan' },
  { kunci: 'pendapatan_denda', label: 'Pendapatan denda (bila produk tidak menentukan)', tipe: 'pendapatan' },
  { kunci: 'pendapatan_lain', label: 'Pendapatan lain-lain (selisih lebih, laba pelepasan aset)', tipe: 'pendapatan' },
  { kunci: 'hpp', label: 'Harga pokok penjualan (bila barang tidak menentukan)', tipe: 'beban' },
  { kunci: 'beban_bunga_simpanan', label: 'Beban jasa simpanan (bila produk tidak menentukan)', tipe: 'beban' },
  { kunci: 'beban_penyusutan', label: 'Beban penyusutan (bila aset tidak menentukan)', tipe: 'beban' },
  { kunci: 'beban_pemeliharaan', label: 'Beban pemeliharaan aset', tipe: 'beban' },
  { kunci: 'beban_selisih', label: 'Beban selisih kas & persediaan', tipe: 'beban' },
  { kunci: 'beban_lain', label: 'Beban lain-lain (rugi pelepasan aset)', tipe: 'beban' },
];

function akunDariPengaturan({ kunci, label }) {
  const kode = String(setting(`coa.${kunci}`, '') || '').trim();
  if (!kode) {
    throw badRequest(`Pemetaan akun "${label}" belum diatur`,
      `Isi pengaturan coa.${kunci} melalui Administrator → Parameter Sistem → Pemetaan Akun.`);
  }
  return kode;
}

/** Akun hasil pemetaan, mis. AKUN.kas() → kode akun kas yang sedang berlaku. */
export const AKUN = Object.fromEntries(PEMETAAN_AKUN.map((p) => [p.kunci, () => akunDariPengaturan(p)]));

/**
 * Kelompok akun untuk penyajian laporan (HPP, aset lancar, arus kas, CALK).
 * Nilainya awalan kode akun, dipisah koma, dan diubah lewat Parameter Sistem
 * sehingga susunan laporan mengikuti bagan akun yang dipakai koperasi.
 */
export const KELOMPOK_AKUN = [
  { kunci: 'hpp', label: 'Harga pokok penjualan (laba rugi)' },
  { kunci: 'aset_lancar', label: 'Aset lancar (rasio likuiditas)' },
  { kunci: 'kewajiban_lancar', label: 'Kewajiban jangka pendek (rasio likuiditas)' },
  { kunci: 'piutang', label: 'Piutang (CALK)' },
  { kunci: 'persediaan', label: 'Persediaan (CALK)' },
  { kunci: 'aset_tetap', label: 'Aset tetap (CALK)' },
  { kunci: 'arus_investasi', label: 'Arus kas investasi (akun lawan)' },
  { kunci: 'arus_pendanaan', label: 'Arus kas pendanaan (akun lawan, selain ekuitas)' },
  { kunci: 'pajak', label: 'Akun pajak (rekap pajak)' },
];

/** Daftar awalan kode akun untuk satu kelompok laporan. */
export function awalanKelompok(kunci) {
  return String(setting(`kelompok.${kunci}`, '') || '')
    .split(',').map((x) => x.trim()).filter(Boolean);
}

/** Apakah kode akun termasuk kelompok laporan tertentu. */
export function termasukKelompok(kode, kunci) {
  return awalanKelompok(kunci).some((a) => kode === a || kode.startsWith(a));
}

/** Kode seluruh akun kas & setara kas (ditandai is_kas / is_bank pada bagan akun). */
export function akunKasBank() {
  return all('SELECT kode FROM coa WHERE is_kas = 1 OR is_bank = 1').map((r) => r.kode);
}

/** Memastikan kode akun adalah akun kas/bank yang dapat dijurnal. */
export function assertAkunKas(kode, label = 'Akun kas/bank') {
  const a = get('SELECT kode, nama, is_kas, is_bank FROM coa WHERE kode = ?', [kode]);
  if (!a) throw badRequest(`${label} ${kode} tidak terdaftar dalam bagan akun`);
  if (!a.is_kas && !a.is_bank) {
    throw badRequest(`${label} ${kode} - ${a.nama} bukan akun kas/bank`,
      'Tandai akun sebagai kas atau bank pada Master Data → Bagan Akun bila memang demikian.');
  }
  return a;
}

/**
 * Akun kas/bank penerima atau pembayar sebuah transaksi.
 * Urutan: rekening bank terpilih → metode transfer/QRIS → kas.
 */
export function akunKasMetode(metode, bank_account_id = null) {
  if (bank_account_id) {
    const b = get('SELECT coa_kode, status FROM bank_account WHERE id = ?', [bank_account_id]);
    if (!b) throw badRequest('Rekening bank tidak ditemukan');
    if (!b.coa_kode) throw badRequest('Rekening bank belum dipetakan ke akun pada bagan akun');
    return b.coa_kode;
  }
  return ['transfer', 'qris', 'bank'].includes(metode) ? AKUN.bank() : AKUN.kas();
}

/** Memastikan periode akuntansi tanggal tersebut masih terbuka. */
export function assertPeriodeTerbuka(tanggal) {
  const p = get('SELECT status FROM periode_akuntansi WHERE tahun = ? AND bulan = ?',
    [yearOf(tanggal), monthOf(tanggal)]);
  if (p && p.status === 'tutup') {
    throw conflict(`Periode ${tanggal.slice(0, 7)} sudah ditutup`,
      'Buka kembali periode melalui modul Akuntansi bila koreksi memang diperlukan.');
  }
}

function assertAkun(kode) {
  const akun = get('SELECT kode, nama, is_postable, status FROM coa WHERE kode = ?', [kode]);
  if (!akun) throw badRequest(`Akun ${kode} tidak terdaftar dalam bagan akun`);
  if (!akun.is_postable) throw badRequest(`Akun ${kode} - ${akun.nama} adalah akun induk dan tidak dapat dijurnal`);
  if (akun.status !== 'aktif') throw badRequest(`Akun ${kode} - ${akun.nama} tidak aktif`);
  return akun;
}

/**
 * Memposting jurnal. Wajib seimbang (total debit = total kredit).
 *
 * @param {object} j
 * @param {string} j.tanggal
 * @param {string} j.tipe
 * @param {Array<{coa_kode, debit?, kredit?, keterangan?, unit_usaha_id?, cabang_id?, anggota_id?}>} j.lines
 * @returns {{id:number, nomor:string, total:number}}
 */
export function postJournal(j, ctx = null) {
  const tanggal = j.tanggal;
  if (!tanggal) throw badRequest('Tanggal jurnal wajib diisi');
  assertPeriodeTerbuka(tanggal);

  const lines = (j.lines || [])
    .map((l) => ({
      coa_kode: String(l.coa_kode || '').trim(),
      debit: rupiah(l.debit || 0),
      kredit: rupiah(l.kredit || 0),
      keterangan: l.keterangan || null,
      cabang_id: l.cabang_id ?? j.cabang_id ?? null,
      unit_usaha_id: l.unit_usaha_id ?? j.unit_usaha_id ?? null,
      anggota_id: l.anggota_id ?? null,
    }))
    .filter((l) => l.debit !== 0 || l.kredit !== 0);

  if (lines.length < 2) throw badRequest('Jurnal minimal terdiri dari 2 baris (debit dan kredit)');

  let totalD = 0;
  let totalK = 0;
  for (const l of lines) {
    if (l.debit < 0 || l.kredit < 0) throw badRequest('Nilai debit/kredit tidak boleh negatif');
    if (l.debit > 0 && l.kredit > 0) {
      throw badRequest(`Baris akun ${l.coa_kode} tidak boleh diisi debit dan kredit sekaligus`);
    }
    assertAkun(l.coa_kode);
    totalD += l.debit;
    totalK += l.kredit;
  }
  if (totalD !== totalK) {
    throw badRequest('Jurnal tidak seimbang',
      `Total debit ${totalD.toLocaleString('id-ID')} tidak sama dengan total kredit ${totalK.toLocaleString('id-ID')}`);
  }
  if (totalD === 0) throw badRequest('Nilai jurnal tidak boleh nol');

  return tx(() => {
    const nomor = j.nomor || nextNumber(prefixOf(j.tipe), tanggal);
    const { lastInsertRowid: id } = run(
      `INSERT INTO jurnal(nomor, tanggal, tipe, referensi, keterangan, cabang_id, unit_usaha_id,
                          total_debit, total_kredit, status, dibuat_oleh, sumber)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      [nomor, tanggal, j.tipe || 'umum', j.referensi || null, j.keterangan || null,
        j.cabang_id ?? null, j.unit_usaha_id ?? null, totalD, totalK,
        j.status || 'posted', ctx?.user?.username || 'sistem', j.sumber || 'sistem'],
    );
    lines.forEach((l, i) => {
      run(
        `INSERT INTO jurnal_detail(jurnal_id, coa_kode, debit, kredit, keterangan,
                                   cabang_id, unit_usaha_id, anggota_id, urut)
         VALUES(?,?,?,?,?,?,?,?,?)`,
        [id, l.coa_kode, l.debit, l.kredit, l.keterangan, l.cabang_id, l.unit_usaha_id, l.anggota_id, i + 1],
      );
    });
    logAudit(ctx, {
      aksi: 'post', modul: 'akuntansi', entitas_id: id,
      keterangan: `Jurnal ${nomor} - ${j.keterangan || j.tipe} sebesar ${totalD}`,
      after: { nomor, tanggal, total: totalD, lines },
    });
    return { id, nomor, total: totalD };
  });
}

function prefixOf(tipe) {
  return {
    kas_masuk: 'BKM', kas_keluar: 'BKK', simpanan: 'JSP', pinjaman: 'JPJ',
    penjualan: 'JPN', pembelian: 'JPB', penyusutan: 'JPY', penutup: 'JTP',
    pembuka: 'JBK', shu: 'JSHU', penyesuaian: 'JPS',
  }[tipe] || 'JV';
}

/** Awalan referensi jurnal yang dibentuk otomatis oleh modul (untuk jurnal lama tanpa kolom sumber). */
const REFERENSI_SISTEM = ['simpanan:', 'pindahbuku:', 'bunga:', 'pinjaman:', 'angsuran:', 'pelunasan:',
  'restrukturisasi:', 'penjualan:', 'retur:', 'pembelian:', 'hp:', 'aset:', 'disposal:', 'penyusutan:',
  'maintenance:', 'opname:', 'opname_kas:', 'stok:', 'shu:', 'distribusi:', 'keluar:'];

/** Asal jurnal: 'manual', 'recurring', atau 'sistem'. */
export function sumberJurnal(j) {
  if (j.sumber) return j.sumber;
  if (j.referensi?.startsWith('recurring:')) return 'recurring';
  if (j.referensi && REFERENSI_SISTEM.some((p) => j.referensi.startsWith(p))) return 'sistem';
  if (get('SELECT 1 FROM kas_bank WHERE jurnal_id = ?', [j.id])) return 'sistem';
  return 'manual';
}

/**
 * Membatalkan jurnal dengan membuat jurnal balik (reversing entry).
 * Jurnal asli tidak dihapus - prinsip audit trail yang tidak dapat disangkal.
 *
 * Jurnal yang dibentuk otomatis oleh modul (setoran simpanan, bukti kas,
 * penjualan, dsb.) tidak boleh dibatalkan langsung dari buku besar: saldo
 * rekening, stok, atau dokumen sumbernya akan tertinggal. Pembatalannya
 * lewat dokumen sumber, yang memanggil fungsi ini dengan { sistem: true }.
 */
export function voidJournal(jurnalId, alasan, ctx, { sistem = false } = {}) {
  const j = get('SELECT * FROM jurnal WHERE id = ?', [jurnalId]);
  if (!j) throw notFound('Jurnal tidak ditemukan');
  if (j.status === 'void') throw conflict('Jurnal ini sudah dibatalkan');
  if (String(j.referensi || '').startsWith('void:')) throw conflict('Jurnal balik tidak dapat dibatalkan lagi');
  // Jurnal penutup hanya menyentuh buku besar, sehingga boleh dibatalkan
  // langsung (mis. untuk menutup ulang tahun buku sesudah koreksi).
  if (!sistem && j.tipe !== 'penutup' && sumberJurnal(j) === 'sistem') {
    throw conflict(`Jurnal ${j.nomor} dibentuk otomatis oleh modul dan tidak dapat dibatalkan dari buku besar`,
      'Batalkan melalui dokumen sumbernya (mis. bukti kas, transaksi simpanan, retur penjualan) '
      + 'agar saldo buku pembantu ikut terkoreksi.');
  }
  if (!String(alasan || '').trim()) throw badRequest('Alasan pembatalan wajib diisi');
  const lines = all('SELECT * FROM jurnal_detail WHERE jurnal_id = ? ORDER BY urut', [jurnalId]);

  return tx(() => {
    const balik = postJournal({
      tanggal: j.tanggal,
      tipe: j.tipe,
      referensi: `void:${j.id}`,
      keterangan: `PEMBATALAN ${j.nomor} - ${alasan}`,
      cabang_id: j.cabang_id,
      unit_usaha_id: j.unit_usaha_id,
      sumber: sumberJurnal(j),
      lines: lines.map((l) => ({ ...l, debit: l.kredit, kredit: l.debit })),
    }, ctx);
    run('UPDATE jurnal SET status = ?, void_alasan = ? WHERE id = ?', ['void', alasan, jurnalId]);
    logAudit(ctx, {
      aksi: 'void', modul: 'akuntansi', entitas_id: jurnalId,
      keterangan: `Jurnal ${j.nomor} dibatalkan: ${alasan}`, before: j,
    });
    return balik;
  });
}

// ------------------------------ Pelaporan ------------------------------

/**
 * Jurnal yang diperhitungkan dalam buku besar.
 *
 * Jurnal berstatus 'void' TETAP diikutsertakan karena pembatalan dilakukan
 * dengan membuat jurnal balik (reversing entry), bukan dengan menghapus data -
 * lihat voidJournal(). Bila jurnal asli dikeluarkan sekaligus jurnal baliknya
 * diposting, dampaknya akan terhitung dua kali dengan arah berlawanan.
 * Hanya jurnal 'draft' yang belum berpengaruh pada buku besar.
 */
const WHERE_POSTED = "j.status IN ('posted','void')";

function filterSql(f = {}) {
  const w = [WHERE_POSTED];
  const p = [];
  // Jurnal penutup memindahkan seluruh saldo pendapatan dan beban ke ekuitas.
  // Untuk laporan posisi keuangan pemindahan itu memang harus ikut terhitung,
  // tetapi untuk laporan hasil usaha tidak: kalau ikut, tahun buku yang sudah
  // ditutup akan tersaji berpendapatan nol dan berbeban nol - dan seluruh
  // turunannya (rasio, realisasi anggaran, dasar pembagian SHU) ikut nol.
  if (f.tanpa_penutup) w.push("j.tipe <> 'penutup'");
  if (f.dari) { w.push('j.tanggal >= ?'); p.push(f.dari); }
  if (f.sampai) { w.push('j.tanggal <= ?'); p.push(f.sampai); }
  if (f.cabang_id) { w.push('COALESCE(d.cabang_id, j.cabang_id) = ?'); p.push(Number(f.cabang_id)); }
  if (f.unit_usaha_id) { w.push('COALESCE(d.unit_usaha_id, j.unit_usaha_id) = ?'); p.push(Number(f.unit_usaha_id)); }
  return { where: w.join(' AND '), params: p };
}

/** Saldo satu akun pada rentang tanggal. */
export function saldoAkun(kode, f = {}) {
  const { where, params } = filterSql(f);
  const row = get(
    `SELECT COALESCE(SUM(d.debit),0) AS debit, COALESCE(SUM(d.kredit),0) AS kredit
       FROM jurnal_detail d JOIN jurnal j ON j.id = d.jurnal_id
      WHERE ${where} AND d.coa_kode = ?`,
    [...params, kode],
  );
  const akun = get('SELECT saldo_normal FROM coa WHERE kode = ?', [kode]);
  const debit = row?.debit || 0;
  const kredit = row?.kredit || 0;
  const saldo = akun?.saldo_normal === 'K' ? kredit - debit : debit - kredit;
  return { kode, debit, kredit, saldo };
}

/** Neraca saldo (trial balance). */
export function trialBalance(f = {}) {
  const { where, params } = filterSql(f);
  // Penjumlahan mutasi dilakukan di subkueri ber-INNER JOIN agar filter periode
  // benar-benar menyaring baris. Bila filter diletakkan pada klausa ON sebuah
  // LEFT JOIN, baris jurnal di luar periode tetap ikut terjumlah - laporan akan
  // selalu menampilkan angka sepanjang masa.
  const rowsData = all(
    `SELECT c.kode, c.nama, c.tipe, c.saldo_normal,
            COALESCE(m.debit, 0)  AS debit,
            COALESCE(m.kredit, 0) AS kredit
       FROM coa c
       LEFT JOIN (
         SELECT d.coa_kode,
                SUM(d.debit)  AS debit,
                SUM(d.kredit) AS kredit
           FROM jurnal_detail d
           JOIN jurnal j ON j.id = d.jurnal_id
          WHERE ${where}
          GROUP BY d.coa_kode
       ) m ON m.coa_kode = c.kode
      WHERE c.is_postable = 1
      ORDER BY c.kode`,
    params,
  ).map((r) => {
    const saldo = r.saldo_normal === 'K' ? r.kredit - r.debit : r.debit - r.kredit;
    return { ...r, saldo, saldo_debit: saldo > 0 && r.saldo_normal === 'D' ? saldo : 0,
      saldo_kredit: saldo > 0 && r.saldo_normal === 'K' ? saldo : 0 };
  });
  const aktif = rowsData.filter((r) => r.debit || r.kredit);
  return {
    baris: aktif,
    total_debit: aktif.reduce((s, r) => s + r.debit, 0),
    total_kredit: aktif.reduce((s, r) => s + r.kredit, 0),
  };
}

/** Buku besar satu akun (dengan saldo berjalan). */
export function bukuBesar(kode, f = {}) {
  const akun = get('SELECT * FROM coa WHERE kode = ?', [kode]);
  if (!akun) throw notFound(`Akun ${kode} tidak ditemukan`);
  const awal = f.dari ? saldoAkun(kode, { sampai: prevDay(f.dari), cabang_id: f.cabang_id, unit_usaha_id: f.unit_usaha_id }).saldo : 0;
  const { where, params } = filterSql(f);
  const mutasi = all(
    `SELECT j.id AS jurnal_id, j.nomor, j.tanggal, j.tipe, j.keterangan AS jurnal_ket,
            d.debit, d.kredit, d.keterangan
       FROM jurnal_detail d JOIN jurnal j ON j.id = d.jurnal_id
      WHERE ${where} AND d.coa_kode = ?
      ORDER BY j.tanggal, j.id, d.urut`,
    [...params, kode],
  );
  let saldo = awal;
  const baris = mutasi.map((m) => {
    saldo += akun.saldo_normal === 'K' ? m.kredit - m.debit : m.debit - m.kredit;
    return { ...m, saldo };
  });
  return { akun, saldo_awal: awal, baris, saldo_akhir: saldo };
}

const prevDay = (d) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
};

/**
 * Laporan Laba Rugi (Perhitungan Hasil Usaha).
 *
 * Jurnal penutup selalu dikeluarkan: yang ingin dibaca adalah hasil usaha
 * periode tersebut, bukan sisa saldo akun nominal sesudah dipindahkan ke
 * ekuitas. Tanpa ini, laporan tahun buku yang sudah ditutup akan nol.
 */
export function labaRugi(f = {}) {
  const tb = trialBalance({ ...f, tanpa_penutup: true });
  const pendapatan = tb.baris.filter((r) => r.tipe === 'pendapatan');
  const beban = tb.baris.filter((r) => r.tipe === 'beban');
  const totalPendapatan = pendapatan.reduce((s, r) => s + r.saldo, 0);
  const totalBeban = beban.reduce((s, r) => s + r.saldo, 0);
  const hpp = beban.filter((r) => termasukKelompok(r.kode, 'hpp')).reduce((s, r) => s + r.saldo, 0);
  const operasional = totalBeban - hpp;
  return {
    periode: { dari: f.dari, sampai: f.sampai },
    pendapatan, beban,
    total_pendapatan: totalPendapatan,
    hpp,
    laba_kotor: totalPendapatan - hpp,
    beban_operasional: operasional,
    total_beban: totalBeban,
    shu_sebelum_pajak: totalPendapatan - totalBeban,
    shu_bersih: totalPendapatan - totalBeban,
  };
}

/**
 * Nilai hasil usaha satu tahun buku yang sudah dipindahkan ke akun SHU Tahun
 * Berjalan melalui jurnal penutup, sampai dengan tanggal tertentu.
 */
function labaDipindahKeEkuitas(tahun, sampai, f = {}) {
  const { where, params } = filterSql({
    dari: `${tahun}-01-01`, sampai, cabang_id: f.cabang_id, unit_usaha_id: f.unit_usaha_id,
  });
  const row = get(
    `SELECT COALESCE(SUM(d.kredit), 0) - COALESCE(SUM(d.debit), 0) AS n
       FROM jurnal_detail d JOIN jurnal j ON j.id = d.jurnal_id
      WHERE ${where} AND j.tipe = 'penutup' AND d.coa_kode = ?`,
    [...params, AKUN.shu_berjalan()],
  );
  return row?.n || 0;
}

/** Neraca (Laporan Posisi Keuangan). */
export function neraca(f = {}) {
  const sampai = f.sampai || new Date().toISOString().slice(0, 10);
  const tb = trialBalance({ ...f, dari: null, sampai });
  const aset = tb.baris.filter((r) => r.tipe === 'aset');
  const kewajiban = tb.baris.filter((r) => r.tipe === 'kewajiban');
  const ekuitas = tb.baris.filter((r) => r.tipe === 'ekuitas');
  const totalAset = aset.reduce((s, r) => s + r.saldo, 0);
  const totalKewajiban = kewajiban.reduce((s, r) => s + r.saldo, 0);
  const totalEkuitasTercatat = ekuitas.reduce((s, r) => s + r.saldo, 0);

  // Hasil usaha tahun berjalan adalah bagian dari ekuitas walaupun belum
  // dipindahkan lewat jurnal penutup. Begitu jurnal penutup dibuat, nilainya
  // sudah duduk pada akun SHU Tahun Berjalan dan ikut terhitung pada
  // totalEkuitasTercatat - karena itu bagian yang sudah dipindahkan dikurangkan
  // kembali, supaya tidak terhitung dua kali dan neraca tetap seimbang.
  const lr = labaRugi({ ...f, dari: `${sampai.slice(0, 4)}-01-01`, sampai });
  const sudahDitutup = labaDipindahKeEkuitas(sampai.slice(0, 4), sampai, f);
  const totalEkuitas = totalEkuitasTercatat + lr.shu_bersih - sudahDitutup;
  return {
    per_tanggal: sampai,
    aset, kewajiban, ekuitas,
    shu_berjalan: lr.shu_bersih,
    total_aset: totalAset,
    total_kewajiban: totalKewajiban,
    total_ekuitas: totalEkuitas,
    total_pasiva: totalKewajiban + totalEkuitas,
    seimbang: totalAset === totalKewajiban + totalEkuitas,
    selisih: totalAset - (totalKewajiban + totalEkuitas),
  };
}

/** Laporan Arus Kas (metode langsung, berbasis mutasi akun kas & bank). */
export function arusKas(f = {}) {
  const kasAkun = akunKasBank();
  if (!kasAkun.length) return { operasi: [], investasi: [], pendanaan: [], saldo_awal: 0, saldo_akhir: 0 };
  const ph = kasAkun.map(() => '?').join(',');

  const saldoAwal = f.dari
    ? kasAkun.reduce((s, k) => s + saldoAkun(k, { sampai: prevDay(f.dari) }).saldo, 0)
    : 0;

  const { where, params } = filterSql(f);

  // Pergerakan kas bersih PER JURNAL. Dihitung per jurnal (bukan per pasangan
  // baris) agar satu baris kas tidak terhitung berulang ketika jurnal memiliki
  // banyak akun lawan - misalnya jurnal penjualan yang sekaligus mencatat
  // pendapatan, PPN, HPP, dan persediaan.
  const arusPerJurnal = all(
    `SELECT j.id, SUM(d.debit - d.kredit) AS arus
       FROM jurnal_detail d JOIN jurnal j ON j.id = d.jurnal_id
      WHERE ${where} AND d.coa_kode IN (${ph})
      GROUP BY j.id HAVING arus <> 0`,
    [...params, ...kasAkun],
  );
  if (!arusPerJurnal.length) {
    return { operasi: [], investasi: [], pendanaan: [], arus_operasi: 0, arus_investasi: 0,
      arus_pendanaan: 0, kenaikan_kas: 0, saldo_awal: saldoAwal, saldo_akhir: saldoAwal };
  }

  // Akun lawan (non-kas) pada jurnal-jurnal tersebut.
  const lawan = all(
    `SELECT d.jurnal_id, d.coa_kode, c.nama, c.tipe, SUM(d.debit + d.kredit) AS nilai
       FROM jurnal_detail d JOIN jurnal j ON j.id = d.jurnal_id
       JOIN coa c ON c.kode = d.coa_kode
      WHERE ${where} AND d.coa_kode NOT IN (${ph})
      GROUP BY d.jurnal_id, d.coa_kode, c.nama, c.tipe`,
    [...params, ...kasAkun],
  );
  const perJurnal = new Map();
  for (const l of lawan) {
    const arr = perJurnal.get(l.jurnal_id);
    if (arr) arr.push(l); else perJurnal.set(l.jurnal_id, [l]);
  }

  /**
   * Klasifikasi PSAK 2 / SAK EP:
   *   investasi - perolehan & pelepasan aset tetap
   *   pendanaan - simpanan anggota, modal, dan pinjaman jangka panjang
   *   operasi   - selebihnya (penjualan, pembelian, beban, jasa pinjaman)
   * Akun yang masuk kelompok investasi & pendanaan diatur pada Parameter
   * Sistem (kelompok.arus_investasi, kelompok.arus_pendanaan).
   */
  const klasifikasi = (kode, tipe) => {
    if (termasukKelompok(kode, 'arus_investasi')) return 'investasi';
    if (tipe === 'ekuitas' || termasukKelompok(kode, 'arus_pendanaan')) return 'pendanaan';
    return 'operasi';
  };

  // Setiap jurnal diklasifikasikan berdasarkan akun lawan bernilai terbesar,
  // sehingga penjumlahan seluruh kelompok selalu sama dengan mutasi kas riil.
  const akumulasi = new Map();
  const grup = { operasi: 0, investasi: 0, pendanaan: 0 };
  for (const j of arusPerJurnal) {
    const kandidat = perJurnal.get(j.id) || [];
    if (!kandidat.length) continue;
    const utama = kandidat.reduce((a, b) => (b.nilai > a.nilai ? b : a));
    const kel = klasifikasi(utama.coa_kode, utama.tipe);
    grup[kel] += j.arus;
    const kunci = `${kel}|${utama.coa_kode}`;
    const ada = akumulasi.get(kunci);
    if (ada) ada.arus += j.arus;
    else akumulasi.set(kunci, { coa_kode: utama.coa_kode, nama: utama.nama, tipe: utama.tipe, arus: j.arus });
  }

  const ambil = (kel) => [...akumulasi.entries()]
    .filter(([k, v]) => k.startsWith(`${kel}|`) && v.arus !== 0)
    .map(([, v]) => v)
    .sort((a, b) => a.coa_kode.localeCompare(b.coa_kode));

  const kasBersih = grup.operasi + grup.investasi + grup.pendanaan;
  return {
    operasi: ambil('operasi'),
    investasi: ambil('investasi'),
    pendanaan: ambil('pendanaan'),
    arus_operasi: grup.operasi,
    arus_investasi: grup.investasi,
    arus_pendanaan: grup.pendanaan,
    kenaikan_kas: kasBersih,
    saldo_awal: saldoAwal,
    saldo_akhir: saldoAwal + kasBersih,
  };
}

/** Laporan Perubahan Ekuitas. */
export function perubahanEkuitas(f = {}) {
  const dari = f.dari || `${new Date().getFullYear()}-01-01`;
  const sampai = f.sampai || new Date().toISOString().slice(0, 10);
  const akun = all("SELECT kode, nama FROM coa WHERE tipe = 'ekuitas' AND is_postable = 1 ORDER BY kode");
  const baris = akun.map((a) => {
    const awal = saldoAkun(a.kode, { sampai: prevDay(dari) }).saldo;
    const mut = saldoAkun(a.kode, { dari, sampai });
    return { ...a, saldo_awal: awal, penambahan: mut.kredit, pengurangan: mut.debit, saldo_akhir: awal + mut.saldo };
  });
  const lr = labaRugi({ dari, sampai });
  // Sama seperti pada neraca: bagian hasil usaha yang sudah dipindahkan ke
  // ekuitas lewat jurnal penutup tidak boleh dijumlahkan dua kali.
  const sudahDitutup = labaDipindahKeEkuitas(dari.slice(0, 4), sampai);
  return {
    periode: { dari, sampai },
    baris,
    shu_periode_berjalan: lr.shu_bersih,
    total_awal: baris.reduce((s, r) => s + r.saldo_awal, 0),
    total_akhir: baris.reduce((s, r) => s + r.saldo_akhir, 0) + lr.shu_bersih - sudahDitutup,
  };
}

/** Analisis rasio keuangan koperasi (acuan penilaian kesehatan KSP). */
export function rasioKeuangan(f = {}) {
  const n = neraca(f);
  const lr = labaRugi({ dari: `${(f.sampai || '').slice(0, 4) || new Date().getFullYear()}-01-01`, sampai: f.sampai });
  const kasBank = new Set(akunKasBank());
  const lancar = n.aset.filter((r) => termasukKelompok(r.kode, 'aset_lancar')).reduce((s, r) => s + r.saldo, 0);
  const hutangLancar = n.kewajiban.filter((r) => termasukKelompok(r.kode, 'kewajiban_lancar'))
    .reduce((s, r) => s + r.saldo, 0);
  const kas = n.aset.filter((r) => kasBank.has(r.kode)).reduce((s, r) => s + r.saldo, 0);
  const piutang = scalar("SELECT COALESCE(SUM(outstanding_pokok),0) FROM pinjaman WHERE status = 'dicairkan'");
  const npl = scalar("SELECT COALESCE(SUM(outstanding_pokok),0) FROM pinjaman WHERE status = 'dicairkan' AND kolektibilitas >= 3");
  const pct = (a, b) => (b ? Number(((a / b) * 100).toFixed(2)) : 0);
  return {
    likuiditas: {
      rasio_lancar: pct(lancar, hutangLancar),
      rasio_kas: pct(kas, hutangLancar),
      keterangan: 'Rasio lancar sehat pada kisaran 175% - 200%',
    },
    solvabilitas: {
      rasio_hutang_aset: pct(n.total_kewajiban, n.total_aset),
      rasio_modal_sendiri: pct(n.total_ekuitas, n.total_aset),
    },
    rentabilitas: {
      roa: pct(lr.shu_bersih, n.total_aset),
      roe: pct(lr.shu_bersih, n.total_ekuitas),
      margin_shu: pct(lr.shu_bersih, lr.total_pendapatan),
    },
    kualitas_pinjaman: {
      outstanding: piutang,
      npl_nominal: npl,
      npl_ratio: pct(npl, piutang),
      keterangan: 'NPL di bawah 5% dikategorikan sehat',
    },
  };
}

/** Menutup periode akuntansi (bulanan). */
export function tutupPeriode(tahun, bulan, ctx) {
  const existing = get('SELECT * FROM periode_akuntansi WHERE tahun = ? AND bulan = ?', [tahun, bulan]);
  if (existing?.status === 'tutup') throw conflict('Periode ini sudah ditutup');
  const tb = trialBalance({ sampai: endOfMonth(`${tahun}-${String(bulan).padStart(2, '0')}`) });
  if (tb.total_debit !== tb.total_kredit) {
    throw conflict('Neraca saldo tidak seimbang, periode tidak dapat ditutup',
      `Selisih ${(tb.total_debit - tb.total_kredit).toLocaleString('id-ID')}`);
  }
  run(
    `INSERT INTO periode_akuntansi(tahun, bulan, status, ditutup_oleh, ditutup_pada)
     VALUES(?,?,'tutup',?,datetime('now'))
     ON CONFLICT(tahun, bulan) DO UPDATE SET status='tutup', ditutup_oleh=excluded.ditutup_oleh,
       ditutup_pada=excluded.ditutup_pada`,
    [tahun, bulan, ctx?.user?.username || 'sistem'],
  );
  logAudit(ctx, { aksi: 'update', modul: 'akuntansi', entitas_id: `${tahun}-${bulan}`,
    keterangan: `Periode ${tahun}-${String(bulan).padStart(2, '0')} ditutup` });
  return { tahun, bulan, status: 'tutup' };
}

export function bukaPeriode(tahun, bulan, ctx) {
  run(
    `INSERT INTO periode_akuntansi(tahun, bulan, status) VALUES(?,?,'terbuka')
     ON CONFLICT(tahun, bulan) DO UPDATE SET status='terbuka', ditutup_oleh=NULL, ditutup_pada=NULL`,
    [tahun, bulan],
  );
  logAudit(ctx, { aksi: 'update', modul: 'akuntansi', entitas_id: `${tahun}-${bulan}`,
    keterangan: `Periode ${tahun}-${String(bulan).padStart(2, '0')} dibuka kembali` });
  return { tahun, bulan, status: 'terbuka' };
}

/**
 * Jurnal penutup akhir tahun: menutup pendapatan & beban ke SHU tahun berjalan.
 */
export function jurnalPenutup(tahun, ctx) {
  const dari = `${tahun}-01-01`;
  const sampai = `${tahun}-12-31`;
  const sudah = get("SELECT id FROM jurnal WHERE tipe = 'penutup' AND referensi = ? AND status = 'posted'",
    [`penutup:${tahun}`]);
  if (sudah) throw conflict(`Jurnal penutup tahun ${tahun} sudah pernah dibuat`);

  // Jurnal penutup sebelumnya dikeluarkan agar penutupan ulang - misalnya
  // sesudah jurnal penutup lama dibatalkan - tidak menutup saldo yang sama dua kali.
  const tb = trialBalance({ dari, sampai, tanpa_penutup: true });
  const lines = [];
  let laba = 0;
  for (const r of tb.baris) {
    if (r.tipe === 'pendapatan' && r.saldo !== 0) {
      lines.push({ coa_kode: r.kode, debit: r.saldo, keterangan: 'Menutup pendapatan' });
      laba += r.saldo;
    } else if (r.tipe === 'beban' && r.saldo !== 0) {
      lines.push({ coa_kode: r.kode, kredit: r.saldo, keterangan: 'Menutup beban' });
      laba -= r.saldo;
    }
  }
  if (!lines.length) throw badRequest('Tidak ada pendapatan/beban untuk ditutup pada tahun ini');
  if (laba >= 0) lines.push({ coa_kode: AKUN.shu_berjalan(), kredit: laba, keterangan: 'SHU tahun berjalan' });
  else lines.push({ coa_kode: AKUN.shu_berjalan(), debit: -laba, keterangan: 'Defisit tahun berjalan' });

  return postJournal({
    tanggal: sampai, tipe: 'penutup', referensi: `penutup:${tahun}`,
    keterangan: `Jurnal penutup tahun buku ${tahun}`, lines,
  }, ctx);
}

// --------------------------- Jurnal berulang ---------------------------

/** Frekuensi jurnal berulang dan jarak antarjadwalnya. */
export const FREKUENSI_RECURRING = {
  mingguan: { hari: 7 },
  bulanan: { bulan: 1 },
  triwulanan: { bulan: 3 },
  semesteran: { bulan: 6 },
  tahunan: { bulan: 12 },
};

/** Validasi template jurnal berulang: akun sah, seimbang, minimal 2 baris. */
export function validasiTemplate(lines) {
  if (!Array.isArray(lines) || lines.length < 2) throw badRequest('Template jurnal minimal 2 baris');
  let d = 0;
  let k = 0;
  const bersih = lines.map((l) => {
    const baris = { coa_kode: String(l.coa_kode || '').trim(), debit: rupiah(l.debit || 0),
      kredit: rupiah(l.kredit || 0), keterangan: l.keterangan || null };
    if (!baris.coa_kode) throw badRequest('Setiap baris template wajib memiliki akun');
    if (baris.debit < 0 || baris.kredit < 0) throw badRequest('Nilai debit/kredit tidak boleh negatif');
    if (baris.debit > 0 && baris.kredit > 0) throw badRequest(`Baris akun ${baris.coa_kode} tidak boleh berisi debit dan kredit sekaligus`);
    assertAkun(baris.coa_kode);
    d += baris.debit;
    k += baris.kredit;
    return baris;
  }).filter((l) => l.debit || l.kredit);
  if (d !== k) throw badRequest('Template jurnal tidak seimbang', `Debit ${d.toLocaleString('id-ID')} ≠ kredit ${k.toLocaleString('id-ID')}`);
  if (d === 0) throw badRequest('Nilai template jurnal tidak boleh nol');
  return bersih;
}

function tanggalKe(r, k) {
  const f = FREKUENSI_RECURRING[r.frekuensi] || FREKUENSI_RECURRING.bulanan;
  if (f.hari) {
    const t = new Date(`${r.tanggal_mulai}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() + f.hari * k);
    return t.toISOString().slice(0, 10);
  }
  // Dihitung dari tanggal mulai (bukan dari jadwal sebelumnya) supaya jadwal
  // akhir bulan tidak bergeser 31 → 30 → 28.
  const [y, m, d] = r.tanggal_mulai.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + f.bulan * k, 1));
  const akhir = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, akhir));
  return target.toISOString().slice(0, 10);
}

/** Tanggal jadwal berikutnya yang belum diposting (null bila sudah berakhir). */
export function jadwalBerikutnya(r) {
  for (let k = 0; k < 5000; k++) {
    const t = tanggalKe(r, k);
    if (r.tanggal_akhir && t > r.tanggal_akhir) return null;
    if (!r.terakhir_dibuat || t > r.terakhir_dibuat) return t;
  }
  return null;
}

/**
 * Memposting seluruh jadwal jurnal berulang yang sudah jatuh tempo sampai
 * tanggal tertentu. Idempoten: jadwal yang sudah diposting dilewati.
 * Kegagalan satu template (mis. periode ditutup) tidak menghentikan yang lain.
 */
export function jalankanRecurring({ sampai, id = null } = {}, ctx = null) {
  const batas = sampai || new Date().toISOString().slice(0, 10);
  const daftar = id
    ? all('SELECT * FROM jurnal_recurring WHERE id = ?', [id])
    : all("SELECT * FROM jurnal_recurring WHERE status = 'aktif' ORDER BY id");
  const hasil = [];
  for (const r of daftar) {
    const dibuat = [];
    let galat = null;
    let rr = { ...r };
    try {
      for (let n = 0; n < 400; n++) {
        const due = jadwalBerikutnya(rr);
        if (!due || due > batas) break;
        tx(() => {
          const ada = get("SELECT id FROM jurnal WHERE referensi = ? AND tanggal = ? AND status = 'posted'",
            [`recurring:${r.id}`, due]);
          if (!ada) {
            const j = postJournal({
              tanggal: due, tipe: 'umum', referensi: `recurring:${r.id}`, sumber: 'recurring',
              keterangan: `${r.nama} (jurnal berulang ${due})`,
              lines: JSON.parse(r.template),
            }, ctx);
            dibuat.push({ tanggal: due, nomor: j.nomor, jurnal_id: j.id });
          }
          run('UPDATE jurnal_recurring SET terakhir_dibuat = ? WHERE id = ?', [due, r.id]);
        });
        rr = { ...rr, terakhir_dibuat: due };
      }
    } catch (err) {
      galat = err.message;
    }
    hasil.push({ id: r.id, nama: r.nama, dibuat, galat, jadwal_berikutnya: jadwalBerikutnya(rr) });
  }
  return {
    sampai: batas,
    jumlah_jurnal: hasil.reduce((s, h) => s + h.dibuat.length, 0),
    template: hasil,
  };
}
