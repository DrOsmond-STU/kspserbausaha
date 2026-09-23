/**
 * Pusat Laporan - kelompok organisasi: master data, RAT, dokumen & surat,
 * approval, kepatuhan, audit internal, risiko, CRM, dan administrator.
 * Lihat server/laporan/bantu.js untuk format definisi laporan.
 */
import { all } from '../db.js';
import { ROLES, MODULES } from '../lib/rbac.js';
import { diffDays, addDays } from '../lib/util.js';
import { tanggalPanjang } from '../lib/profil.js';
import { periode, rentang, pilih, kondisi, teksPeriode, jumlahkan, bernomor, KOLOM_NO, opsiCabang, opsiUnit } from './bantu.js';

// ------------------------------ Alat bantu ------------------------------

const hariIni = () => new Date().toISOString().slice(0, 10);
const persen = (a, b) => (b ? Number((a / b * 100).toFixed(2)) : 0);
const yaTidak = (v) => (Number(v) ? 'Ya' : '-');
const OPSI_STATUS = ['aktif', 'nonaktif'];

/** Menetapkan nilai bawaan sebuah filter. */
const dgnBawaan = (f, bawaan) => ({ ...f, bawaan });

/**
 * Membungkus definisi laporan: setiap baris dipangkas hanya ke kolom yang
 * ditampilkan, sehingga kolom bantu/internal tidak ikut terkirim ke peramban.
 */
function rapikan(def) {
  const susun = def.susun;
  return {
    ...def,
    susun(f, ctx) {
      const hasil = susun(f, ctx);
      hasil.bagian = (hasil.bagian || []).map((b) => ({
        ...b, baris: b.baris.map((r) => Object.fromEntries(b.kolom.map((k) => [k.kunci, r[k.kunci] ?? null]))),
      }));
      return hasil;
    },
  };
}

/**
 * Filter rentang tanggal pada kolom waktu (datetime/ISO): batas akhir dibuat
 * eksklusif hari berikutnya supaya indeks kolom tetap terpakai.
 */
function rentangWaktu(w, kolom, f) {
  if (f.dari) w.tambah(`${kolom} >= ?`, f.dari);
  if (f.sampai) w.tambah(`${kolom} < ?`, addDays(f.sampai, 1));
  return w;
}

/** Jumlah per nilai sebuah kunci, untuk ringkasan. */
function hitungPer(baris, kunci) {
  const m = new Map();
  for (const r of baris) m.set(r[kunci] ?? '-', (m.get(r[kunci] ?? '-') || 0) + 1);
  return [...m].map(([k, n]) => `${k}: ${n}`).join(', ');
}

const namaPeran = (kode) => ROLES[kode]?.nama || kode || '-';
const opsiKategori = () => all('SELECT id AS nilai, nama AS teks FROM kategori_barang ORDER BY kode');
const opsiRat = () => all("SELECT id AS nilai, nomor || ' - ' || judul AS teks FROM rat ORDER BY tanggal DESC, id DESC");

/** Kolom status sederhana & kode dari-sampai yang dipakai laporan master. */
const filterMaster = (label = 'Kode') => [...rentang('kode', label), pilih('status', 'Status', OPSI_STATUS)];

/** Laporan daftar master data sederhana (satu tabel, urut kode). */
function laporanMaster({ kode, judul, deskripsi, orientasi = 'portrait', filter, sql, kolom, ringkas, catatan, where, penanda = {} }) {
  return {
    kode, judul, izin: 'master.view', orientasi, deskripsi, filter,
    susun(f) {
      const w = where(kondisi(), f);
      const baris = bernomor(all(sql(w), w.params));
      return {
        subjudul: `Per ${tanggalPanjang(hariIni())}`,
        ringkasan: [{ label: 'Jumlah data', nilai: baris.length, tipe: 'angka' }, ...(ringkas ? ringkas(baris) : [])],
        // penanda: { kolom_tampil: 'kolom_0/1' } diubah menjadi Ya / -
        bagian: [{
          kolom: [KOLOM_NO, ...kolom],
          baris: baris.map((r) => ({ ...r, ...Object.fromEntries(Object.entries(penanda).map(([k, asal]) => [k, yaTidak(r[asal])])) })),
        }],
        catatan,
      };
    },
  };
}

const LEVEL_RISIKO = (skor) => (skor >= 20 ? 'ekstrem' : skor >= 12 ? 'tinggi' : skor >= 6 ? 'sedang' : 'rendah');

// ------------------------------ Definisi ------------------------------

export default [
  // ============================== MASTER DATA ==============================
  laporanMaster({
    kode: 'master-cabang',
    judul: 'Daftar Cabang',
    deskripsi: 'Master cabang beserta jumlah anggota aktif.',
    filter: filterMaster('Kode cabang'),
    where: (w, f) => w.rentang('c.kode', f, 'kode').sama('c.status', f.status),
    sql: (w) => `SELECT c.kode, c.nama, c.alamat, c.kota, c.telepon, CASE WHEN c.is_pusat = 1 THEN 'Pusat' ELSE 'Cabang' END AS jenis,
                        (SELECT COUNT(*) FROM anggota a WHERE a.cabang_id = c.id AND a.status = 'aktif') AS anggota, c.status
                   FROM cabang c ${w.where()} ORDER BY c.kode`,
    kolom: [{ kunci: 'kode', label: 'Kode' }, { kunci: 'nama', label: 'Nama' }, { kunci: 'jenis', label: 'Jenis' },
      { kunci: 'alamat', label: 'Alamat' }, { kunci: 'kota', label: 'Kota' }, { kunci: 'telepon', label: 'Telepon' },
      { kunci: 'anggota', label: 'Anggota Aktif', tipe: 'angka' }, { kunci: 'status', label: 'Status' }],
  }),
  laporanMaster({
    kode: 'master-unit-usaha',
    judul: 'Daftar Unit Usaha',
    deskripsi: 'Master unit usaha per jenis dan cabang.',
    filter: [...filterMaster('Kode unit'),
      pilih('jenis', 'Jenis', ['simpan_pinjam', 'retail', 'pertanian', 'perikanan', 'peternakan', 'jasa', 'transportasi',
        'wisata', 'apotek', 'spbu', 'lainnya']),
      pilih('cabang_id', 'Cabang', opsiCabang)],
    where: (w, f) => w.rentang('u.kode', f, 'kode').sama('u.status', f.status).sama('u.jenis', f.jenis).sama('u.cabang_id', f.cabang_id),
    sql: (w) => `SELECT u.kode, u.nama, u.jenis, c.nama AS cabang, u.penanggung_jawab, u.status
                   FROM unit_usaha u LEFT JOIN cabang c ON c.id = u.cabang_id ${w.where()} ORDER BY u.kode`,
    kolom: [{ kunci: 'kode', label: 'Kode' }, { kunci: 'nama', label: 'Nama Unit' }, { kunci: 'jenis', label: 'Jenis' },
      { kunci: 'cabang', label: 'Cabang' }, { kunci: 'penanggung_jawab', label: 'Penanggung Jawab' }, { kunci: 'status', label: 'Status' }],
  }),
  laporanMaster({
    kode: 'master-coa',
    judul: 'Bagan Akun (Chart of Accounts)',
    orientasi: 'landscape',
    deskripsi: 'Daftar akun dengan tipe, saldo normal, induk, level, dan penanda akun transaksi/kas/bank.',
    filter: [...filterMaster('Kode akun'),
      pilih('tipe', 'Tipe akun', ['aset', 'kewajiban', 'ekuitas', 'pendapatan', 'beban']),
      pilih('postable', 'Jenis akun', [{ nilai: '1', teks: 'Akun transaksi (postable)' }, { nilai: '0', teks: 'Akun induk/header' }]),
      pilih('kas_bank', 'Akun kas/bank', [{ nilai: 'kas', teks: 'Akun kas' }, { nilai: 'bank', teks: 'Akun bank' },
        { nilai: 'kas_bank', teks: 'Kas atau bank' }, { nilai: 'bukan', teks: 'Bukan kas/bank' }])],
    where: (w, f) => {
      w.rentang('c.kode', f, 'kode').sama('c.status', f.status).sama('c.tipe', f.tipe);
      if (f.postable !== undefined) w.tambah('c.is_postable = ?', Number(f.postable));
      if (f.kas_bank === 'kas') w.tambah('c.is_kas = 1');
      else if (f.kas_bank === 'bank') w.tambah('c.is_bank = 1');
      else if (f.kas_bank === 'kas_bank') w.tambah('(c.is_kas = 1 OR c.is_bank = 1)');
      else if (f.kas_bank === 'bukan') w.tambah('c.is_kas = 0 AND c.is_bank = 0');
      return w;
    },
    sql: (w) => `SELECT c.kode, c.nama, c.tipe, CASE c.saldo_normal WHEN 'D' THEN 'Debit' ELSE 'Kredit' END AS saldo_normal,
                        c.parent_kode, c.level, c.is_postable, c.is_kas, c.is_bank, c.status
                   FROM coa c ${w.where()} ORDER BY c.kode`,
    kolom: [{ kunci: 'kode', label: 'Kode' }, { kunci: 'nama', label: 'Nama Akun' }, { kunci: 'tipe', label: 'Tipe' },
      { kunci: 'saldo_normal', label: 'Saldo Normal' }, { kunci: 'parent_kode', label: 'Induk' },
      { kunci: 'level', label: 'Level', tipe: 'angka' }, { kunci: 'postable', label: 'Postable' },
      { kunci: 'kas', label: 'Kas' }, { kunci: 'bank', label: 'Bank' }, { kunci: 'status', label: 'Status' }],
    ringkas: (b) => [{ label: 'Akun transaksi', nilai: b.filter((r) => r.is_postable).length, tipe: 'angka' }],
    penanda: { postable: 'is_postable', kas: 'is_kas', bank: 'is_bank' },
  }),
  laporanMaster({
    kode: 'master-produk-simpanan',
    judul: 'Daftar Produk Simpanan',
    orientasi: 'landscape',
    deskripsi: 'Produk simpanan beserta akun, ketentuan setoran, jasa, dan jumlah rekening aktif.',
    filter: [...filterMaster('Kode produk'), pilih('jenis', 'Jenis', ['pokok', 'wajib', 'sukarela', 'berjangka', 'deposito'])],
    where: (w, f) => w.rentang('p.kode', f, 'kode').sama('p.status', f.status).sama('p.jenis', f.jenis),
    sql: (w) => `SELECT p.kode, p.nama, p.jenis, p.coa_kode, p.coa_beban_bunga, p.setoran_minimal, p.setoran_wajib,
                        p.bunga_tahunan, p.boleh_tarik, p.tenor_bulan, p.masuk_shu, p.status,
                        (SELECT COUNT(*) FROM rekening_simpanan r WHERE r.produk_id = p.id AND r.status <> 'tutup') AS rekening,
                        (SELECT COALESCE(SUM(r.saldo),0) FROM rekening_simpanan r WHERE r.produk_id = p.id AND r.status <> 'tutup') AS saldo
                   FROM produk_simpanan p ${w.where()} ORDER BY p.kode`,
    kolom: [{ kunci: 'kode', label: 'Kode' }, { kunci: 'nama', label: 'Nama Produk' }, { kunci: 'jenis', label: 'Jenis' },
      { kunci: 'coa_kode', label: 'Akun Simpanan' }, { kunci: 'coa_beban_bunga', label: 'Akun Beban Jasa' },
      { kunci: 'setoran_minimal', label: 'Setoran Min.', tipe: 'uang' }, { kunci: 'setoran_wajib', label: 'Setoran Wajib', tipe: 'uang' },
      { kunci: 'bunga_tahunan', label: 'Jasa p.a.', tipe: 'persen' }, { kunci: 'tarik', label: 'Boleh Tarik' },
      { kunci: 'tenor_bulan', label: 'Tenor (bln)', tipe: 'angka' }, { kunci: 'shu', label: 'Masuk SHU' },
      { kunci: 'rekening', label: 'Rekening', tipe: 'angka' }, { kunci: 'saldo', label: 'Saldo', tipe: 'uang' },
      { kunci: 'status', label: 'Status' }],
    penanda: { tarik: 'boleh_tarik', shu: 'masuk_shu' },
  }),
  laporanMaster({
    kode: 'master-produk-pinjaman',
    judul: 'Daftar Produk Pinjaman',
    orientasi: 'landscape',
    deskripsi: 'Produk pinjaman beserta metode jasa, tenor, plafon, biaya, denda, dan akun.',
    filter: [...filterMaster('Kode produk'), pilih('jenis', 'Jenis', ['konsumtif', 'produktif', 'modal_usaha', 'syariah'])],
    where: (w, f) => w.rentang('p.kode', f, 'kode').sama('p.status', f.status).sama('p.jenis', f.jenis),
    sql: (w) => `SELECT p.kode, p.nama, p.jenis, p.metode_bunga, p.bunga_tahunan, p.tenor_min || ' - ' || p.tenor_max AS tenor,
                        p.plafon_min, p.plafon_max, p.biaya_admin, p.biaya_provisi, p.denda_harian, p.coa_piutang,
                        p.coa_pendapatan_bunga, p.wajib_agunan, p.status
                   FROM produk_pinjaman p ${w.where()} ORDER BY p.kode`,
    kolom: [{ kunci: 'kode', label: 'Kode' }, { kunci: 'nama', label: 'Nama Produk' }, { kunci: 'jenis', label: 'Jenis' },
      { kunci: 'metode_bunga', label: 'Metode' }, { kunci: 'bunga_tahunan', label: 'Jasa p.a.', tipe: 'persen' },
      { kunci: 'tenor', label: 'Tenor (bln)' }, { kunci: 'plafon_min', label: 'Plafon Min.', tipe: 'uang' },
      { kunci: 'plafon_max', label: 'Plafon Maks.', tipe: 'uang' }, { kunci: 'biaya_admin', label: 'Admin', tipe: 'persen' },
      { kunci: 'biaya_provisi', label: 'Provisi', tipe: 'persen' }, { kunci: 'denda_harian', label: 'Denda/hari', tipe: 'persen' },
      { kunci: 'coa_piutang', label: 'Akun Piutang' }, { kunci: 'coa_pendapatan_bunga', label: 'Akun Pendapatan Jasa' },
      { kunci: 'agunan', label: 'Wajib Agunan' }, { kunci: 'status', label: 'Status' }],
    penanda: { agunan: 'wajib_agunan' },
  }),
  laporanMaster({
    kode: 'master-kategori-barang',
    judul: 'Daftar Kategori Barang',
    deskripsi: 'Kategori barang dan jumlah barang aktif di dalamnya.',
    filter: rentang('kode', 'Kode kategori'),
    where: (w, f) => w.rentang('k.kode', f, 'kode'),
    sql: (w) => `SELECT k.kode, k.nama,
                        (SELECT COUNT(*) FROM barang b WHERE b.kategori_id = k.id AND b.status = 'aktif') AS barang
                   FROM kategori_barang k ${w.where()} ORDER BY k.kode`,
    kolom: [{ kunci: 'kode', label: 'Kode' }, { kunci: 'nama', label: 'Nama Kategori' },
      { kunci: 'barang', label: 'Barang Aktif', tipe: 'angka' }],
  }),
  laporanMaster({
    kode: 'master-barang',
    judul: 'Daftar Barang & Harga',
    orientasi: 'landscape',
    deskripsi: 'Master barang dengan harga beli (HPP), harga jual, harga anggota, margin, stok, dan batas stok.',
    filter: [...filterMaster('Kode barang'), pilih('kategori_id', 'Kategori', opsiKategori)],
    where: (w, f) => w.rentang('b.kode', f, 'kode').sama('b.status', f.status).sama('b.kategori_id', f.kategori_id),
    sql: (w) => `SELECT b.kode, b.barcode, b.nama, k.nama AS kategori, b.satuan, b.harga_beli, b.harga_jual, b.harga_anggota,
                        CASE WHEN b.harga_jual > 0 THEN ROUND((b.harga_jual - b.harga_beli) * 100.0 / b.harga_jual, 2) ELSE 0 END AS margin,
                        b.stok_minimum, b.reorder_point,
                        COALESCE((SELECT SUM(s.qty) FROM stok s WHERE s.barang_id = b.id), 0) AS stok,
                        p.nama AS pajak, b.status
                   FROM barang b LEFT JOIN kategori_barang k ON k.id = b.kategori_id LEFT JOIN pajak p ON p.id = b.pajak_id
                   ${w.where()} ORDER BY b.kode`,
    kolom: [{ kunci: 'kode', label: 'Kode' }, { kunci: 'barcode', label: 'Barcode' }, { kunci: 'nama', label: 'Nama Barang' },
      { kunci: 'kategori', label: 'Kategori' }, { kunci: 'satuan', label: 'Satuan' },
      { kunci: 'harga_beli', label: 'HPP', tipe: 'uang' }, { kunci: 'harga_jual', label: 'Harga Jual', tipe: 'uang' },
      { kunci: 'harga_anggota', label: 'Harga Anggota', tipe: 'uang' }, { kunci: 'margin', label: 'Margin', tipe: 'persen' },
      { kunci: 'stok', label: 'Stok', tipe: 'angka' }, { kunci: 'stok_minimum', label: 'Stok Min.', tipe: 'angka' },
      { kunci: 'reorder_point', label: 'ROP', tipe: 'angka' }, { kunci: 'pajak', label: 'Pajak' }, { kunci: 'status', label: 'Status' }],
    catatan: 'HPP = harga pokok rata-rata bergerak terkini. Margin dihitung terhadap harga jual umum.',
  }),
  laporanMaster({
    kode: 'master-gudang',
    judul: 'Daftar Gudang',
    deskripsi: 'Master gudang beserta jumlah item bersaldo dan nilai persediaannya saat ini.',
    filter: [...filterMaster('Kode gudang'), pilih('cabang_id', 'Cabang', opsiCabang), pilih('unit_usaha_id', 'Unit usaha', opsiUnit)],
    where: (w, f) => w.rentang('g.kode', f, 'kode').sama('g.status', f.status).sama('g.cabang_id', f.cabang_id)
      .sama('g.unit_usaha_id', f.unit_usaha_id),
    sql: (w) => `SELECT g.kode, g.nama, g.alamat, c.nama AS cabang, u.nama AS unit,
                        (SELECT COUNT(*) FROM stok s WHERE s.gudang_id = g.id AND s.qty <> 0) AS item,
                        (SELECT COALESCE(SUM(ROUND(s.qty * b.harga_beli)),0) FROM stok s JOIN barang b ON b.id = s.barang_id
                          WHERE s.gudang_id = g.id) AS nilai, g.status
                   FROM gudang g LEFT JOIN cabang c ON c.id = g.cabang_id LEFT JOIN unit_usaha u ON u.id = g.unit_usaha_id
                   ${w.where()} ORDER BY g.kode`,
    kolom: [{ kunci: 'kode', label: 'Kode' }, { kunci: 'nama', label: 'Nama Gudang' }, { kunci: 'alamat', label: 'Alamat' },
      { kunci: 'cabang', label: 'Cabang' }, { kunci: 'unit', label: 'Unit Usaha' }, { kunci: 'item', label: 'Item Bersaldo', tipe: 'angka' },
      { kunci: 'nilai', label: 'Nilai Persediaan', tipe: 'uang' }, { kunci: 'status', label: 'Status' }],
    ringkas: (b) => [{ label: 'Total nilai persediaan', nilai: b.reduce((s, r) => s + r.nilai, 0), tipe: 'uang' }],
  }),
  laporanMaster({
    kode: 'master-supplier',
    judul: 'Daftar Supplier',
    orientasi: 'landscape',
    deskripsi: 'Master supplier dengan NPWP, kontak, termin pembayaran, dan rating.',
    filter: filterMaster('Kode supplier'),
    where: (w, f) => w.rentang('s.kode', f, 'kode').sama('s.status', f.status),
    sql: (w) => `SELECT s.kode, s.nama, s.npwp, s.alamat, s.telepon, s.email, s.termin_hari, s.rating, s.status
                   FROM supplier s ${w.where()} ORDER BY s.kode`,
    kolom: [{ kunci: 'kode', label: 'Kode' }, { kunci: 'nama', label: 'Nama Supplier' }, { kunci: 'npwp', label: 'NPWP' },
      { kunci: 'alamat', label: 'Alamat' }, { kunci: 'telepon', label: 'Telepon' }, { kunci: 'email', label: 'Email' },
      { kunci: 'termin_hari', label: 'Termin (hari)', tipe: 'angka' }, { kunci: 'rating', label: 'Rating', tipe: 'angka' },
      { kunci: 'status', label: 'Status' }],
  }),
  laporanMaster({
    kode: 'master-customer',
    judul: 'Daftar Pelanggan (Customer)',
    orientasi: 'landscape',
    deskripsi: 'Master pelanggan dengan termin, limit piutang, dan piutang terbuka.',
    filter: filterMaster('Kode pelanggan'),
    where: (w, f) => w.rentang('c.kode', f, 'kode').sama('c.status', f.status),
    sql: (w) => `SELECT c.kode, c.nama, a.nomor_anggota, c.alamat, c.telepon, c.npwp, c.termin_hari, c.limit_piutang,
                        (SELECT COALESCE(SUM(h.nominal - h.terbayar),0) FROM hutang_piutang h
                          WHERE h.customer_id = c.id AND h.jenis = 'piutang' AND h.status = 'terbuka') AS piutang, c.status
                   FROM customer c LEFT JOIN anggota a ON a.id = c.anggota_id ${w.where()} ORDER BY c.kode`,
    kolom: [{ kunci: 'kode', label: 'Kode' }, { kunci: 'nama', label: 'Nama Pelanggan' }, { kunci: 'nomor_anggota', label: 'No. Anggota' },
      { kunci: 'alamat', label: 'Alamat' }, { kunci: 'telepon', label: 'Telepon' }, { kunci: 'npwp', label: 'NPWP' },
      { kunci: 'termin_hari', label: 'Termin (hari)', tipe: 'angka' }, { kunci: 'limit_piutang', label: 'Limit Piutang', tipe: 'uang' },
      { kunci: 'piutang', label: 'Piutang Terbuka', tipe: 'uang' }, { kunci: 'status', label: 'Status' }],
  }),
  laporanMaster({
    kode: 'master-rekening-bank',
    judul: 'Daftar Rekening Bank',
    orientasi: 'landscape',
    deskripsi: 'Rekening bank koperasi beserta akun buku besar dan saldo awal.',
    filter: [pilih('status', 'Status', OPSI_STATUS), pilih('cabang_id', 'Cabang', opsiCabang)],
    where: (w, f) => w.sama('r.status', f.status).sama('r.cabang_id', f.cabang_id),
    sql: (w) => `SELECT r.nama_bank, r.nomor_rekening, r.atas_nama, c.nama AS cabang, r.coa_kode, k.nama AS coa_nama,
                        r.saldo_awal, r.status
                   FROM bank_account r LEFT JOIN cabang c ON c.id = r.cabang_id LEFT JOIN coa k ON k.kode = r.coa_kode
                   ${w.where()} ORDER BY r.nama_bank, r.nomor_rekening`,
    kolom: [{ kunci: 'nama_bank', label: 'Bank' }, { kunci: 'nomor_rekening', label: 'No. Rekening' },
      { kunci: 'atas_nama', label: 'Atas Nama' }, { kunci: 'cabang', label: 'Cabang' }, { kunci: 'coa_kode', label: 'Kode Akun' },
      { kunci: 'coa_nama', label: 'Nama Akun' }, { kunci: 'saldo_awal', label: 'Saldo Awal', tipe: 'uang' },
      { kunci: 'status', label: 'Status' }],
  }),
  laporanMaster({
    kode: 'master-pajak',
    judul: 'Daftar Pajak',
    deskripsi: 'Master jenis pajak, tarif, dan akunnya.',
    filter: filterMaster('Kode pajak'),
    where: (w, f) => w.rentang('p.kode', f, 'kode').sama('p.status', f.status),
    sql: (w) => `SELECT p.kode, p.nama, p.tarif, p.coa_kode, k.nama AS coa_nama, p.status
                   FROM pajak p LEFT JOIN coa k ON k.kode = p.coa_kode ${w.where()} ORDER BY p.kode`,
    kolom: [{ kunci: 'kode', label: 'Kode' }, { kunci: 'nama', label: 'Nama Pajak' }, { kunci: 'tarif', label: 'Tarif', tipe: 'persen' },
      { kunci: 'coa_kode', label: 'Kode Akun' }, { kunci: 'coa_nama', label: 'Nama Akun' }, { kunci: 'status', label: 'Status' }],
  }),
  laporanMaster({
    kode: 'master-jabatan',
    judul: 'Daftar Jabatan',
    deskripsi: 'Master jabatan per kelompok (pengurus, pengawas, karyawan) dan jumlah personel aktif.',
    filter: [...rentang('kode', 'Kode jabatan'), pilih('kelompok', 'Kelompok', ['pengurus', 'pengawas', 'karyawan'])],
    where: (w, f) => w.rentang('j.kode', f, 'kode').sama('j.kelompok', f.kelompok),
    sql: (w) => `SELECT j.kode, j.nama, j.kelompok,
                        (SELECT COUNT(*) FROM karyawan k WHERE k.jabatan_id = j.id AND k.status = 'aktif') AS personel
                   FROM jabatan j ${w.where()} ORDER BY j.kode`,
    kolom: [{ kunci: 'kode', label: 'Kode' }, { kunci: 'nama', label: 'Nama Jabatan' }, { kunci: 'kelompok', label: 'Kelompok' },
      { kunci: 'personel', label: 'Personel Aktif', tipe: 'angka' }],
  }),
  {
    kode: 'master-karyawan',
    judul: 'Daftar Karyawan, Pengurus & Pengawas',
    izin: 'master.view',
    orientasi: 'landscape',
    deskripsi: 'Personel koperasi per kelompok jabatan, cabang, dan unit, termasuk masa bakti pengurus/pengawas.',
    filter: [
      ...periode({ label: 'Tanggal masuk' }),
      pilih('kelompok', 'Kelompok', ['pengurus', 'pengawas', 'karyawan']),
      pilih('status', 'Status', OPSI_STATUS),
      pilih('cabang_id', 'Cabang', opsiCabang),
      pilih('unit_usaha_id', 'Unit usaha', opsiUnit),
    ],
    susun(f) {
      const w = kondisi().periode('k.tgl_masuk', f).sama('j.kelompok', f.kelompok).sama('k.status', f.status)
        .sama('k.cabang_id', f.cabang_id).sama('k.unit_usaha_id', f.unit_usaha_id);
      const baris = bernomor(all(
        `SELECT k.nik, k.nama, j.nama AS jabatan, j.kelompok, c.nama AS cabang, u.nama AS unit, k.telepon, k.email,
                k.tgl_masuk, k.tgl_keluar,
                CASE WHEN k.periode_mulai IS NOT NULL OR k.periode_akhir IS NOT NULL
                     THEN COALESCE(k.periode_mulai,'') || ' s.d. ' || COALESCE(k.periode_akhir,'') END AS masa_bakti,
                k.status
           FROM karyawan k LEFT JOIN jabatan j ON j.id = k.jabatan_id LEFT JOIN cabang c ON c.id = k.cabang_id
           LEFT JOIN unit_usaha u ON u.id = k.unit_usaha_id
           ${w.where()} ORDER BY CASE j.kelompok WHEN 'pengurus' THEN 1 WHEN 'pengawas' THEN 2 ELSE 3 END, j.kode, k.nama`, w.params));
      return {
        subjudul: f.dari || f.sampai ? teksPeriode(f, 'Masuk') : `Per ${tanggalPanjang(hariIni())}`,
        ringkasan: [
          { label: 'Jumlah personel', nilai: baris.length, tipe: 'angka' },
          { label: 'Pengurus', nilai: baris.filter((r) => r.kelompok === 'pengurus').length, tipe: 'angka' },
          { label: 'Pengawas', nilai: baris.filter((r) => r.kelompok === 'pengawas').length, tipe: 'angka' },
          { label: 'Karyawan', nilai: baris.filter((r) => !['pengurus', 'pengawas'].includes(r.kelompok)).length, tipe: 'angka' },
        ],
        bagian: [{
          kolom: [KOLOM_NO, { kunci: 'nik', label: 'NIK' }, { kunci: 'nama', label: 'Nama' }, { kunci: 'jabatan', label: 'Jabatan' },
            { kunci: 'kelompok', label: 'Kelompok' }, { kunci: 'cabang', label: 'Cabang' }, { kunci: 'unit', label: 'Unit' },
            { kunci: 'telepon', label: 'Telepon' }, { kunci: 'email', label: 'Email' },
            { kunci: 'tgl_masuk', label: 'Tgl Masuk', tipe: 'tanggal' }, { kunci: 'tgl_keluar', label: 'Tgl Keluar', tipe: 'tanggal' },
            { kunci: 'masa_bakti', label: 'Masa Bakti' }, { kunci: 'status', label: 'Status' }],
          baris,
        }],
      };
    },
  },

  // ================================== RAT ==================================
  {
    kode: 'rat-daftar',
    judul: 'Daftar Rapat Anggota',
    izin: 'rat.view',
    orientasi: 'landscape',
    jenis_ttd: 'rat',
    deskripsi: 'Rapat anggota per periode dengan kehadiran, kuorum, dan jumlah voting.',
    filter: [
      ...periode({ label: 'Tanggal rapat' }),
      ...rentang('tahun', 'Tahun buku', 'angka'),
      pilih('jenis', 'Jenis', [{ nilai: 'tahunan', teks: 'RAT tahunan' }, { nilai: 'luar_biasa', teks: 'Rapat anggota luar biasa' }]),
      pilih('status', 'Status', ['rencana', 'undangan', 'berlangsung', 'selesai', 'batal']),
    ],
    susun(f) {
      const w = kondisi().periode('r.tanggal', f).rentang('r.tahun_buku', f, 'tahun').sama('r.jenis', f.jenis).sama('r.status', f.status);
      const baris = bernomor(all(
        `SELECT r.nomor, r.tahun_buku, r.judul, r.tanggal, r.tempat, r.jenis, r.total_anggota, r.hadir,
                r.kuorum_persen, r.kuorum_tercapai, r.status,
                (SELECT COUNT(*) FROM rat_voting v WHERE v.rat_id = r.id) AS voting
           FROM rat r ${w.where()} ORDER BY r.tanggal, r.id`, w.params)
        .map((r) => ({ ...r, persen_hadir: persen(r.hadir, r.total_anggota), kuorum: r.kuorum_tercapai ? 'Tercapai' : 'Belum' })));
      return {
        subjudul: teksPeriode(f),
        ringkasan: [{ label: 'Jumlah rapat', nilai: baris.length, tipe: 'angka' },
          { label: 'Kuorum tercapai', nilai: baris.filter((r) => r.kuorum_tercapai).length, tipe: 'angka' }],
        bagian: [{
          kolom: [KOLOM_NO, { kunci: 'nomor', label: 'Nomor' }, { kunci: 'tahun_buku', label: 'Tahun Buku' },
            { kunci: 'judul', label: 'Judul' }, { kunci: 'tanggal', label: 'Tanggal', tipe: 'tanggal' },
            { kunci: 'tempat', label: 'Tempat' }, { kunci: 'jenis', label: 'Jenis' },
            { kunci: 'total_anggota', label: 'Anggota', tipe: 'angka' }, { kunci: 'hadir', label: 'Hadir', tipe: 'angka' },
            { kunci: 'persen_hadir', label: '% Hadir', tipe: 'persen' }, { kunci: 'kuorum_persen', label: 'Syarat Kuorum', tipe: 'persen' },
            { kunci: 'kuorum', label: 'Kuorum' }, { kunci: 'voting', label: 'Voting', tipe: 'angka' }, { kunci: 'status', label: 'Status' }],
          baris: baris.map(({ kuorum_tercapai: _, ...r }) => r),
        }],
      };
    },
  },
  {
    kode: 'rat-kehadiran',
    judul: 'Daftar Hadir Rapat Anggota',
    izin: 'rat.view',
    jenis_ttd: 'rat',
    deskripsi: 'Peserta rapat anggota beserta status dan waktu kehadiran, kuasa, dan tanda tangan elektronik.',
    filter: [
      { ...pilih('rat_id', 'Rapat anggota', opsiRat), wajib: true },
      pilih('hadir', 'Kehadiran', [{ nilai: '1', teks: 'Hadir' }, { nilai: '0', teks: 'Tidak hadir' }]),
      ...rentang('nomor', 'Nomor anggota'),
    ],
    susun(f) {
      const r = all('SELECT * FROM rat WHERE id = ?', [f.rat_id])[0];
      const w = kondisi().tambah('p.rat_id = ?', f.rat_id).rentang('a.nomor_anggota', f, 'nomor');
      if (f.hadir !== undefined) w.tambah('p.hadir = ?', Number(f.hadir));
      const baris = bernomor(all(
        `SELECT a.nomor_anggota, a.nama, CASE WHEN p.hadir = 1 THEN 'Hadir' ELSE 'Tidak hadir' END AS kehadiran,
                p.waktu_hadir, k.nama AS kuasa, CASE WHEN p.ttd_elektronik IS NOT NULL THEN substr(p.ttd_elektronik, 1, 16) END AS ttd
           FROM rat_peserta p JOIN anggota a ON a.id = p.anggota_id LEFT JOIN anggota k ON k.id = p.kuasa_kepada
           ${w.where()} ORDER BY a.nomor_anggota`, w.params));
      return {
        judul: `Daftar Hadir ${r.judul}`,
        subjudul: `${r.nomor} — ${tanggalPanjang(r.tanggal)}${r.tempat ? `, ${r.tempat}` : ''}`,
        ringkasan: [
          { label: 'Anggota terdaftar', nilai: r.total_anggota, tipe: 'angka' },
          { label: 'Hadir', nilai: r.hadir, tipe: 'angka' },
          { label: 'Persentase hadir', nilai: persen(r.hadir, r.total_anggota), tipe: 'persen' },
          { label: 'Kuorum', nilai: `${r.kuorum_tercapai ? 'Tercapai' : 'Belum tercapai'} (syarat ${r.kuorum_persen}%)` },
        ],
        bagian: [{
          kolom: [KOLOM_NO, { kunci: 'nomor_anggota', label: 'No. Anggota' }, { kunci: 'nama', label: 'Nama' },
            { kunci: 'kehadiran', label: 'Kehadiran' }, { kunci: 'waktu_hadir', label: 'Waktu Hadir' },
            { kunci: 'kuasa', label: 'Kuasa Kepada' }, { kunci: 'ttd', label: 'TTE (hash)' }],
          baris,
        }],
        catatan: 'TTE = cuplikan hash SHA-256 tanda tangan elektronik kehadiran (UU ITE).',
      };
    },
  },
  {
    kode: 'rat-voting',
    judul: 'Hasil Voting Rapat Anggota',
    izin: 'rat.view',
    jenis_ttd: 'rat',
    deskripsi: 'Rekap suara per mata acara voting dan keputusan rapat.',
    filter: [...periode({ label: 'Tanggal rapat' }), pilih('rat_id', 'Rapat anggota', opsiRat),
      pilih('status', 'Status voting', ['draft', 'dibuka', 'ditutup'])],
    susun(f) {
      const w = kondisi().periode('r.tanggal', f).sama('v.rat_id', f.rat_id).sama('v.status', f.status);
      const voting = all(
        `SELECT v.id, v.judul, v.opsi, v.status, v.hasil, r.nomor, r.judul AS rat
           FROM rat_voting v JOIN rat r ON r.id = v.rat_id ${w.where()} ORDER BY r.tanggal, v.id`, w.params);
      const ids = voting.map((v) => v.id);
      const suara = ids.length ? all(
        `SELECT voting_id, pilihan, COUNT(*) AS jumlah FROM rat_suara
          WHERE voting_id IN (${ids.map(() => '?').join(',')}) GROUP BY voting_id, pilihan`, ids) : [];
      const baris = [];
      for (const v of voting) {
        let opsi = [];
        try { opsi = JSON.parse(v.opsi || '[]'); } catch { opsi = []; }
        const s = suara.filter((x) => x.voting_id === v.id);
        for (const x of s) if (!opsi.includes(x.pilihan)) opsi.push(x.pilihan);
        const total = s.reduce((n, x) => n + x.jumlah, 0);
        const maks = Math.max(0, ...s.map((x) => x.jumlah));
        for (const o of opsi) {
          const n = s.find((x) => x.pilihan === o)?.jumlah || 0;
          baris.push({ rat: v.nomor, voting: v.judul, status: v.status, pilihan: o, jumlah: n, persen: persen(n, total),
            keputusan: v.status === 'ditutup' && n > 0 && n === maks ? 'Terpilih' : '' });
        }
      }
      return {
        subjudul: teksPeriode(f),
        ringkasan: [{ label: 'Jumlah voting', nilai: voting.length, tipe: 'angka' },
          { label: 'Total suara', nilai: suara.reduce((n, x) => n + x.jumlah, 0), tipe: 'angka' }],
        bagian: [{
          kolom: [{ kunci: 'rat', label: 'RAT' }, { kunci: 'voting', label: 'Mata Acara Voting' }, { kunci: 'status', label: 'Status' },
            { kunci: 'pilihan', label: 'Pilihan' }, { kunci: 'jumlah', label: 'Suara', tipe: 'angka' },
            { kunci: 'persen', label: 'Persentase', tipe: 'persen' }, { kunci: 'keputusan', label: 'Keputusan' }],
          baris,
        }],
        catatan: 'Keputusan hanya ditandai untuk voting yang sudah ditutup (suara terbanyak).',
      };
    },
  },

  // ============================ DOKUMEN & SURAT ============================
  {
    kode: 'dokumen-register',
    judul: 'Register Dokumen',
    izin: 'dokumen.view',
    orientasi: 'landscape',
    deskripsi: 'Register dokumen per kategori & status beserta riwayat versinya.',
    filter: [
      ...periode({ label: 'Tanggal dibuat' }),
      pilih('kategori', 'Kategori', ['ad_art', 'sop', 'kebijakan', 'notulen', 'kontrak', 'legalitas', 'sertifikat', 'rat', 'surat', 'lainnya']),
      pilih('status', 'Status', ['draft', 'review', 'disetujui', 'kadaluarsa', 'arsip']),
      dgnBawaan(pilih('versi', 'Riwayat versi', [{ nilai: 'ya', teks: 'Sertakan' }, { nilai: 'tidak', teks: 'Tidak' }]), 'ya'),
    ],
    susun(f) {
      const w = rentangWaktu(kondisi(), 'd.created_at', f).sama('d.kategori', f.kategori).sama('d.status', f.status);
      const dok = all(
        `SELECT d.id, d.nomor, d.judul, d.kategori, d.versi, d.pemilik, d.file_nama, d.file_ukuran, d.ttd_oleh,
                d.ttd_pada, d.status, substr(d.created_at, 1, 10) AS dibuat, d.tanggal_kadaluarsa, d.retensi_tahun,
                date(d.created_at, '+' || d.retensi_tahun || ' years') AS batas_retensi,
                (SELECT COUNT(*) FROM dokumen_versi v WHERE v.dokumen_id = d.id) AS jumlah_versi
           FROM dokumen d ${w.where()} ORDER BY d.created_at, d.id`, w.params);
      const bagian = [{
        judul: 'Register dokumen',
        kolom: [KOLOM_NO, { kunci: 'nomor', label: 'Nomor' }, { kunci: 'judul', label: 'Judul' }, { kunci: 'kategori', label: 'Kategori' },
          { kunci: 'versi', label: 'Versi', tipe: 'angka' }, { kunci: 'jumlah_versi', label: 'Riwayat', tipe: 'angka' },
          { kunci: 'pemilik', label: 'Pemilik' }, { kunci: 'ttd_oleh', label: 'Ditandatangani' },
          { kunci: 'status', label: 'Status' }, { kunci: 'dibuat', label: 'Dibuat', tipe: 'tanggal' },
          { kunci: 'tanggal_kadaluarsa', label: 'Kedaluwarsa', tipe: 'tanggal' }, { kunci: 'batas_retensi', label: 'Batas Retensi', tipe: 'tanggal' }],
        baris: bernomor(dok.map(({ id: _, ...r }) => r)),
      }];
      if (f.versi === 'ya' && dok.length) {
        const versi = all(
          `SELECT d.nomor, d.judul, v.versi, v.catatan, v.oleh, substr(v.created_at, 1, 10) AS tanggal, substr(v.hash_sha256, 1, 16) AS hash
             FROM dokumen_versi v JOIN dokumen d ON d.id = v.dokumen_id
            WHERE v.dokumen_id IN (SELECT d.id FROM dokumen d ${w.where()})
            ORDER BY d.created_at, d.id, v.versi`, w.params);
        bagian.push({
          judul: 'Riwayat versi',
          kolom: [{ kunci: 'nomor', label: 'Nomor Dokumen' }, { kunci: 'judul', label: 'Judul' }, { kunci: 'versi', label: 'Versi', tipe: 'angka' },
            { kunci: 'tanggal', label: 'Tanggal', tipe: 'tanggal' }, { kunci: 'oleh', label: 'Oleh' }, { kunci: 'catatan', label: 'Catatan' },
            { kunci: 'hash', label: 'Hash SHA-256 (awal)' }],
          baris: versi,
        });
      }
      return {
        subjudul: teksPeriode(f, 'Dibuat'),
        ringkasan: [{ label: 'Jumlah dokumen', nilai: dok.length, tipe: 'angka' },
          { label: 'Sudah ditandatangani', nilai: dok.filter((d) => d.ttd_oleh).length, tipe: 'angka' }],
        bagian,
      };
    },
  },
  {
    kode: 'dokumen-retensi',
    judul: 'Masa Berlaku & Retensi Dokumen',
    izin: 'dokumen.view',
    orientasi: 'landscape',
    deskripsi: 'Dokumen yang sudah/akan kedaluwarsa dan dokumen yang melewati masa retensi per tanggal acuan.',
    filter: [
      { kunci: 'per_tanggal', label: 'Per tanggal', tipe: 'tanggal', bawaan: hariIni },
      { kunci: 'hari', label: 'Akan kedaluwarsa dalam (hari)', tipe: 'angka', bawaan: 90 },
      pilih('kategori', 'Kategori', ['ad_art', 'sop', 'kebijakan', 'notulen', 'kontrak', 'legalitas', 'sertifikat', 'rat', 'surat', 'lainnya']),
    ],
    susun(f) {
      const acuan = f.per_tanggal;
      const batas = addDays(acuan, Math.max(0, Math.floor(Number(f.hari) || 0)));
      const kat = f.kategori ? 'AND kategori = ?' : '';
      const pk = f.kategori ? [f.kategori] : [];
      const kadaluarsa = bernomor(all(
        `SELECT nomor, judul, kategori, status, pemilik, tanggal_kadaluarsa FROM dokumen
          WHERE tanggal_kadaluarsa IS NOT NULL AND tanggal_kadaluarsa <> '' AND tanggal_kadaluarsa <= ? ${kat}
          ORDER BY tanggal_kadaluarsa`, [batas, ...pk])
        .map((r) => {
          const sisa = diffDays(r.tanggal_kadaluarsa, acuan);
          return { ...r, sisa_hari: sisa, keadaan: sisa < 0 ? 'Kedaluwarsa' : 'Akan kedaluwarsa' };
        }));
      const retensi = bernomor(all(
        `SELECT nomor, judul, kategori, status, substr(created_at, 1, 10) AS dibuat, retensi_tahun,
                date(created_at, '+' || retensi_tahun || ' years') AS batas_retensi
           FROM dokumen WHERE date(created_at, '+' || retensi_tahun || ' years') <= ? ${kat}
          ORDER BY batas_retensi`, [batas, ...pk])
        .map((r) => ({ ...r, keadaan: r.batas_retensi < acuan ? 'Melewati retensi' : 'Segera berakhir' })));
      return {
        subjudul: `Per ${tanggalPanjang(acuan)} — batas pantau s.d. ${tanggalPanjang(batas)}`,
        ringkasan: [
          { label: 'Kedaluwarsa', nilai: kadaluarsa.filter((r) => r.sisa_hari < 0).length, tipe: 'angka' },
          { label: 'Akan kedaluwarsa', nilai: kadaluarsa.filter((r) => r.sisa_hari >= 0).length, tipe: 'angka' },
          { label: 'Melewati/segera akhir retensi', nilai: retensi.length, tipe: 'angka' },
        ],
        bagian: [
          {
            judul: 'Masa berlaku dokumen',
            kolom: [KOLOM_NO, { kunci: 'nomor', label: 'Nomor' }, { kunci: 'judul', label: 'Judul' }, { kunci: 'kategori', label: 'Kategori' },
              { kunci: 'pemilik', label: 'Pemilik' }, { kunci: 'status', label: 'Status' },
              { kunci: 'tanggal_kadaluarsa', label: 'Kedaluwarsa', tipe: 'tanggal' }, { kunci: 'sisa_hari', label: 'Sisa Hari', tipe: 'angka' },
              { kunci: 'keadaan', label: 'Keadaan' }],
            baris: kadaluarsa,
          },
          {
            judul: 'Masa retensi arsip',
            kolom: [KOLOM_NO, { kunci: 'nomor', label: 'Nomor' }, { kunci: 'judul', label: 'Judul' }, { kunci: 'kategori', label: 'Kategori' },
              { kunci: 'status', label: 'Status' }, { kunci: 'dibuat', label: 'Dibuat', tipe: 'tanggal' },
              { kunci: 'retensi_tahun', label: 'Retensi (thn)', tipe: 'angka' }, { kunci: 'batas_retensi', label: 'Batas Retensi', tipe: 'tanggal' },
              { kunci: 'keadaan', label: 'Keadaan' }],
            baris: retensi,
          },
        ],
      };
    },
  },
  {
    kode: 'surat-register',
    judul: 'Agenda Surat Masuk & Keluar',
    izin: 'surat.view',
    orientasi: 'landscape',
    jenis_ttd: 'surat',
    deskripsi: 'Register surat masuk/keluar per periode beserta sifat, status, dan disposisi.',
    filter: [
      ...periode({ label: 'Tanggal surat' }),
      pilih('jenis', 'Jenis', [{ nilai: 'masuk', teks: 'Surat masuk' }, { nilai: 'keluar', teks: 'Surat keluar' }]),
      pilih('sifat', 'Sifat', ['biasa', 'penting', 'segera', 'rahasia']),
      pilih('status', 'Status', ['baru', 'diproses', 'selesai', 'arsip']),
      pilih('disposisi', 'Disposisi', [{ nilai: 'ada', teks: 'Sudah didisposisi' }, { nilai: 'belum', teks: 'Belum didisposisi' }]),
      ...rentang('nomor', 'Nomor surat'),
    ],
    susun(f) {
      const w = kondisi().periode('s.tanggal', f).sama('s.jenis', f.jenis).sama('s.sifat', f.sifat).sama('s.status', f.status)
        .rentang('s.nomor', f, 'nomor');
      if (f.disposisi === 'ada') w.tambah("COALESCE(s.disposisi_kepada, '') <> ''");
      else if (f.disposisi === 'belum') w.tambah("COALESCE(s.disposisi_kepada, '') = ''");
      const baris = bernomor(all(
        `SELECT s.nomor, s.tanggal, CASE s.jenis WHEN 'masuk' THEN 'Masuk' ELSE 'Keluar' END AS jenis, s.perihal,
                s.dari, s.kepada, s.sifat, s.lampiran, s.status, s.disposisi_kepada, s.disposisi
           FROM surat s ${w.where()} ORDER BY s.tanggal, s.id`, w.params));
      return {
        subjudul: teksPeriode(f),
        ringkasan: [
          { label: 'Surat masuk', nilai: baris.filter((r) => r.jenis === 'Masuk').length, tipe: 'angka' },
          { label: 'Surat keluar', nilai: baris.filter((r) => r.jenis === 'Keluar').length, tipe: 'angka' },
          { label: 'Belum selesai', nilai: baris.filter((r) => ['baru', 'diproses'].includes(r.status)).length, tipe: 'angka' },
        ],
        bagian: [{
          kolom: [KOLOM_NO, { kunci: 'nomor', label: 'Nomor' }, { kunci: 'tanggal', label: 'Tanggal', tipe: 'tanggal' },
            { kunci: 'jenis', label: 'Jenis' }, { kunci: 'perihal', label: 'Perihal' }, { kunci: 'dari', label: 'Dari' },
            { kunci: 'kepada', label: 'Kepada' }, { kunci: 'sifat', label: 'Sifat' }, { kunci: 'lampiran', label: 'Lampiran' },
            { kunci: 'status', label: 'Status' }, { kunci: 'disposisi_kepada', label: 'Disposisi Kepada' },
            { kunci: 'disposisi', label: 'Isi Disposisi' }],
          baris,
        }],
      };
    },
  },

  // ================================ APPROVAL ================================
  {
    kode: 'approval-permintaan',
    judul: 'Permintaan Persetujuan & SLA',
    izin: 'approval.view',
    orientasi: 'landscape',
    deskripsi: 'Permintaan persetujuan per periode dan status, tahap aktif, lama proses, dan kepatuhan SLA.',
    filter: [
      ...periode({ label: 'Tanggal pengajuan' }),
      pilih('status', 'Status', ['menunggu', 'disetujui', 'ditolak', 'dibatalkan']),
      pilih('modul', 'Modul', () => all(
        'SELECT modul AS nilai, modul AS teks FROM approval_request UNION SELECT modul, modul FROM approval_flow ORDER BY 1')),
      pilih('sla', 'SLA', ['Tepat waktu', 'Terlambat', 'Dalam SLA', 'Lewat batas']),
      dgnBawaan(pilih('rinci', 'Rincian tahapan', [{ nilai: 'ya', teks: 'Sertakan' }, { nilai: 'tidak', teks: 'Tidak' }]), 'tidak'),
    ],
    susun(f) {
      const acuan = hariIni();
      const w = rentangWaktu(kondisi(), 'r.created_at', f).sama('r.status', f.status).sama('r.modul', f.modul);
      const req = all(
        `SELECT r.id, r.nomor, substr(r.created_at, 1, 10) AS tanggal, r.modul, r.judul, r.nominal, r.pemohon,
                r.tahap_aktif, r.status, substr(r.selesai_at, 1, 10) AS selesai
           FROM approval_request r ${w.where()} ORDER BY r.created_at, r.id`, w.params);
      const langkah = all(
        `SELECT s.*, r.nomor FROM approval_step s JOIN approval_request r ON r.id = s.request_id
          WHERE s.request_id IN (SELECT r.id FROM approval_request r ${w.where()}) ORDER BY s.request_id, s.urut, s.id`, w.params);
      const perReq = new Map();
      for (const s of langkah) {
        if (!perReq.has(s.request_id)) perReq.set(s.request_id, []);
        perReq.get(s.request_id).push(s);
      }
      const telat = (s) => s.waktu && s.batas_waktu && String(s.waktu).slice(0, 10) > s.batas_waktu;
      const baris = req.map((r) => {
        const st = perReq.get(r.id) || [];
        const aktif = st.filter((s) => s.urut === r.tahap_aktif);
        let sla = '-';
        if (r.status === 'menunggu') {
          sla = aktif.some((s) => s.status === 'menunggu' && s.batas_waktu && acuan > s.batas_waktu) ? 'Lewat batas' : 'Dalam SLA';
        } else if (r.status !== 'dibatalkan') {
          sla = st.some(telat) ? 'Terlambat' : 'Tepat waktu';
        }
        return {
          nomor: r.nomor, tanggal: r.tanggal, modul: r.modul, judul: r.judul, nominal: r.nominal, pemohon: r.pemohon,
          tahap: r.status === 'menunggu' ? `${r.tahap_aktif}. ${aktif.map((s) => namaPeran(s.role)).join(' / ') || '-'}` : '',
          batas: r.status === 'menunggu' ? aktif.map((s) => s.batas_waktu).filter(Boolean).sort()[0] || null : null,
          status: r.status, selesai: r.selesai, lama: diffDays(r.selesai || acuan, r.tanggal), sla,
        };
      }).filter((r) => !f.sla || r.sla === f.sla);
      const nomorTampil = new Set(baris.map((r) => r.nomor));
      const bagian = [{
        judul: 'Permintaan persetujuan',
        kolom: [KOLOM_NO, { kunci: 'nomor', label: 'Nomor' }, { kunci: 'tanggal', label: 'Diajukan', tipe: 'tanggal' },
          { kunci: 'modul', label: 'Modul' }, { kunci: 'judul', label: 'Perihal' }, { kunci: 'nominal', label: 'Nominal', tipe: 'uang' },
          { kunci: 'pemohon', label: 'Pemohon' }, { kunci: 'tahap', label: 'Tahap Aktif' },
          { kunci: 'batas', label: 'Batas Tahap', tipe: 'tanggal' }, { kunci: 'status', label: 'Status' },
          { kunci: 'selesai', label: 'Selesai', tipe: 'tanggal' }, { kunci: 'lama', label: 'Lama (hari)', tipe: 'angka' },
          { kunci: 'sla', label: 'SLA' }],
        baris: bernomor(baris),
        total: jumlahkan(baris, ['nominal']),
      }];
      if (f.rinci === 'ya') {
        const rinci = langkah.filter((s) => nomorTampil.has(s.nomor)).map((s) => ({
          nomor: s.nomor, urut: s.urut, peran: namaPeran(s.role), tipe: s.tipe, status: s.status, oleh: s.oleh,
          delegasi_ke: s.delegasi_ke, waktu: s.waktu, batas_waktu: s.batas_waktu, catatan: s.catatan,
          tepat: s.waktu ? (telat(s) ? 'Terlambat' : 'Tepat waktu') : '',
        }));
        bagian.push({
          judul: 'Rincian tahapan',
          kolom: [{ kunci: 'nomor', label: 'Nomor' }, { kunci: 'urut', label: 'Tahap', tipe: 'angka' }, { kunci: 'peran', label: 'Peran' },
            { kunci: 'tipe', label: 'Tipe' }, { kunci: 'status', label: 'Status' }, { kunci: 'oleh', label: 'Oleh' },
            { kunci: 'delegasi_ke', label: 'Delegasi' }, { kunci: 'waktu', label: 'Waktu' },
            { kunci: 'batas_waktu', label: 'Batas', tipe: 'tanggal' }, { kunci: 'tepat', label: 'SLA' }, { kunci: 'catatan', label: 'Catatan' }],
          baris: rinci,
        });
      }
      const selesai = baris.filter((r) => ['Tepat waktu', 'Terlambat'].includes(r.sla));
      return {
        subjudul: teksPeriode(f, 'Diajukan'),
        ringkasan: [
          { label: 'Jumlah permintaan', nilai: baris.length, tipe: 'angka' },
          { label: 'Per status', nilai: hitungPer(baris, 'status') || '-' },
          { label: 'Kepatuhan SLA (yang sudah diputus)', nilai: persen(selesai.filter((r) => r.sla === 'Tepat waktu').length, selesai.length), tipe: 'persen' },
          { label: 'Menunggu lewat batas', nilai: baris.filter((r) => r.sla === 'Lewat batas').length, tipe: 'angka' },
        ],
        bagian,
        catatan: 'SLA tiap tahap mengikuti batas waktu pada alur persetujuan. Lama proses dihitung sampai tanggal selesai atau hari ini.',
      };
    },
  },

  // =============================== COMPLIANCE ===============================
  {
    kode: 'compliance-masa-berlaku',
    judul: 'Kepatuhan & Masa Berlaku Perizinan',
    izin: 'compliance.view',
    orientasi: 'landscape',
    deskripsi: 'Item kepatuhan (legalitas, perpajakan, dll.) dengan masa berlaku dan status terhitung per tanggal acuan.',
    filter: [
      { kunci: 'per_tanggal', label: 'Per tanggal', tipe: 'tanggal', bawaan: hariIni },
      ...periode({ label: 'Tanggal kedaluwarsa' }),
      pilih('kategori', 'Kategori', () => all(
        "SELECT DISTINCT kategori AS nilai, kategori AS teks FROM compliance_item UNION SELECT k, k FROM (SELECT 'legalitas' AS k UNION SELECT 'perpajakan' UNION SELECT 'ketenagakerjaan' UNION SELECT 'perkoperasian' UNION SELECT 'oss') ORDER BY 1")),
      pilih('status', 'Status terhitung', [{ nilai: 'patuh', teks: 'Patuh' }, { nilai: 'perlu_perhatian', teks: 'Perlu perhatian' },
        { nilai: 'tidak_patuh', teks: 'Tidak patuh' }, { nilai: 'kadaluarsa', teks: 'Kedaluwarsa' }]),
    ],
    susun(f) {
      const acuan = f.per_tanggal;
      const w = kondisi().periode('c.tanggal_kadaluarsa', f).sama('c.kategori', f.kategori);
      const baris = all(
        `SELECT c.kategori, c.nama, c.nomor, c.penerbit, c.dasar_hukum, c.tanggal_terbit, c.tanggal_kadaluarsa, c.pic,
                c.status, d.nomor AS dokumen
           FROM compliance_item c LEFT JOIN dokumen d ON d.id = c.dokumen_id
           ${w.where()} ORDER BY c.tanggal_kadaluarsa IS NULL, c.tanggal_kadaluarsa, c.kategori, c.nama`, w.params)
        .map((c) => {
          // Aturan sama dengan /api/compliance/dashboard/ringkasan
          const sisa = c.tanggal_kadaluarsa ? diffDays(c.tanggal_kadaluarsa, acuan) : null;
          let hitung = c.status;
          if (sisa !== null) {
            if (sisa < 0) hitung = 'kadaluarsa';
            else if (sisa <= 90) hitung = 'perlu_perhatian';
          }
          return { ...c, sisa_hari: sisa, status_hitung: hitung };
        })
        .filter((c) => !f.status || c.status_hitung === f.status);
      return {
        subjudul: `Per ${tanggalPanjang(acuan)}`,
        ringkasan: [
          { label: 'Jumlah item', nilai: baris.length, tipe: 'angka' },
          { label: 'Patuh', nilai: baris.filter((c) => c.status_hitung === 'patuh').length, tipe: 'angka' },
          { label: 'Perlu perhatian', nilai: baris.filter((c) => c.status_hitung === 'perlu_perhatian').length, tipe: 'angka' },
          { label: 'Kedaluwarsa / tidak patuh', nilai: baris.filter((c) => ['kadaluarsa', 'tidak_patuh'].includes(c.status_hitung)).length, tipe: 'angka' },
        ],
        bagian: [{
          kolom: [KOLOM_NO, { kunci: 'kategori', label: 'Kategori' }, { kunci: 'nama', label: 'Nama Izin/Kewajiban' },
            { kunci: 'nomor', label: 'Nomor' }, { kunci: 'penerbit', label: 'Penerbit' }, { kunci: 'dasar_hukum', label: 'Dasar Hukum' },
            { kunci: 'tanggal_terbit', label: 'Terbit', tipe: 'tanggal' }, { kunci: 'tanggal_kadaluarsa', label: 'Berlaku s.d.', tipe: 'tanggal' },
            { kunci: 'sisa_hari', label: 'Sisa Hari', tipe: 'angka' }, { kunci: 'pic', label: 'PIC' },
            { kunci: 'status', label: 'Status Tercatat' }, { kunci: 'status_hitung', label: 'Status Terhitung' }],
          baris: bernomor(baris),
        }],
        catatan: 'Status terhitung: kedaluwarsa bila masa berlaku lewat, perlu perhatian bila berakhir dalam 90 hari.',
      };
    },
  },

  // ============================= AUDIT INTERNAL =============================
  {
    kode: 'audit-rencana',
    judul: 'Rencana Audit Internal',
    izin: 'audit.view',
    orientasi: 'landscape',
    deskripsi: 'Program audit per tahun dan status beserta jumlah temuan.',
    filter: [...rentang('tahun', 'Tahun', 'angka'), pilih('status', 'Status', ['rencana', 'berjalan', 'selesai'])],
    susun(f) {
      const w = kondisi().rentang('p.tahun', f, 'tahun').sama('p.status', f.status);
      const baris = bernomor(all(
        `SELECT p.nomor, p.judul, p.tahun, p.objek, p.auditor, p.tanggal_mulai, p.tanggal_selesai, p.ruang_lingkup, p.status,
                (SELECT COUNT(*) FROM audit_temuan t WHERE t.plan_id = p.id) AS temuan,
                (SELECT COUNT(*) FROM audit_temuan t WHERE t.plan_id = p.id AND t.status IN ('terbuka','proses')) AS terbuka
           FROM audit_plan p ${w.where()} ORDER BY p.tahun, p.tanggal_mulai, p.id`, w.params));
      return {
        subjudul: f.tahun_dari || f.tahun_sampai ? `Tahun ${f.tahun_dari ?? '...'} s.d. ${f.tahun_sampai ?? '...'}` : 'Seluruh tahun',
        ringkasan: [{ label: 'Jumlah program', nilai: baris.length, tipe: 'angka' },
          { label: 'Per status', nilai: hitungPer(baris, 'status') || '-' }],
        bagian: [{
          kolom: [KOLOM_NO, { kunci: 'nomor', label: 'Nomor' }, { kunci: 'judul', label: 'Judul' }, { kunci: 'tahun', label: 'Tahun' },
            { kunci: 'objek', label: 'Objek' }, { kunci: 'auditor', label: 'Auditor' },
            { kunci: 'tanggal_mulai', label: 'Mulai', tipe: 'tanggal' }, { kunci: 'tanggal_selesai', label: 'Selesai', tipe: 'tanggal' },
            { kunci: 'ruang_lingkup', label: 'Ruang Lingkup' }, { kunci: 'status', label: 'Status' },
            { kunci: 'temuan', label: 'Temuan', tipe: 'angka' }, { kunci: 'terbuka', label: 'Belum Selesai', tipe: 'angka' }],
          baris,
          total: jumlahkan(baris, ['temuan', 'terbuka']),
        }],
      };
    },
  },
  {
    kode: 'audit-temuan',
    judul: 'Temuan Audit & Tindak Lanjut',
    izin: 'audit.view',
    orientasi: 'landscape',
    deskripsi: 'Temuan audit per status dan tingkat risiko beserta rekomendasi, CAPA, PIC, dan batas waktu.',
    filter: [
      ...periode({ label: 'Tanggal dicatat' }),
      pilih('plan_id', 'Program audit', () => all("SELECT id AS nilai, nomor || ' - ' || judul AS teks FROM audit_plan ORDER BY tahun DESC, id DESC")),
      pilih('risk_rating', 'Tingkat risiko', ['rendah', 'sedang', 'tinggi', 'kritis']),
      pilih('status', 'Status', ['terbuka', 'proses', 'selesai', 'dibatalkan']),
    ],
    susun(f) {
      const acuan = hariIni();
      const w = rentangWaktu(kondisi(), 't.created_at', f).sama('t.plan_id', f.plan_id)
        .sama('t.risk_rating', f.risk_rating).sama('t.status', f.status);
      const baris = bernomor(all(
        `SELECT t.kode, t.judul, p.nomor AS program, t.risk_rating, t.pic, t.batas_waktu, t.status, t.rekomendasi, t.capa,
                substr(t.created_at, 1, 10) AS dicatat
           FROM audit_temuan t LEFT JOIN audit_plan p ON p.id = t.plan_id
           ${w.where()} ORDER BY CASE t.risk_rating WHEN 'kritis' THEN 1 WHEN 'tinggi' THEN 2 WHEN 'sedang' THEN 3 ELSE 4 END,
                    t.batas_waktu IS NULL, t.batas_waktu, t.id`, w.params)
        .map((r) => ({ ...r, lewat: ['terbuka', 'proses'].includes(r.status) && r.batas_waktu && r.batas_waktu < acuan ? 'Ya' : '' })));
      return {
        subjudul: teksPeriode(f, 'Dicatat'),
        ringkasan: [
          { label: 'Jumlah temuan', nilai: baris.length, tipe: 'angka' },
          { label: 'Per tingkat risiko', nilai: hitungPer(baris, 'risk_rating') || '-' },
          { label: 'Per status', nilai: hitungPer(baris, 'status') || '-' },
          { label: 'Lewat batas waktu', nilai: baris.filter((r) => r.lewat).length, tipe: 'angka' },
        ],
        bagian: [{
          kolom: [KOLOM_NO, { kunci: 'kode', label: 'Kode' }, { kunci: 'judul', label: 'Temuan' }, { kunci: 'program', label: 'Program' },
            { kunci: 'risk_rating', label: 'Risiko' }, { kunci: 'pic', label: 'PIC' },
            { kunci: 'batas_waktu', label: 'Batas Waktu', tipe: 'tanggal' }, { kunci: 'status', label: 'Status' },
            { kunci: 'lewat', label: 'Lewat Batas' }, { kunci: 'rekomendasi', label: 'Rekomendasi' }, { kunci: 'capa', label: 'CAPA' }],
          baris,
        }],
      };
    },
  },

  // ================================= RISIKO =================================
  {
    kode: 'risiko-register',
    judul: 'Register Risiko',
    izin: 'risiko.view',
    orientasi: 'landscape',
    deskripsi: 'Risk register dengan skor & level risiko inheren dan residual, kontrol, PIC, dan KRI.',
    filter: [
      pilih('kategori', 'Kategori', ['kredit', 'likuiditas', 'operasional', 'kepatuhan', 'strategis', 'reputasi', 'teknologi']),
      pilih('unit_usaha_id', 'Unit usaha', opsiUnit),
      pilih('status', 'Status', () => all("SELECT DISTINCT status AS nilai, status AS teks FROM risiko UNION SELECT 'aktif', 'aktif' ORDER BY 1")),
      pilih('level', 'Level inheren', ['ekstrem', 'tinggi', 'sedang', 'rendah']),
      ...rentang('kode', 'Kode risiko'),
    ],
    susun(f) {
      const w = kondisi().sama('r.kategori', f.kategori).sama('r.unit_usaha_id', f.unit_usaha_id).sama('r.status', f.status)
        .rentang('r.kode', f, 'kode');
      const baris = all(
        `SELECT r.kode, r.nama, r.kategori, u.nama AS unit, r.likelihood, r.impact, r.skor_inheren, r.efektivitas_kontrol,
                r.likelihood_residu, r.impact_residu, r.skor_residu, r.pic, r.kri_nama, r.kri_ambang, r.kri_nilai,
                r.mitigasi, r.status, r.review_terakhir
           FROM risiko r LEFT JOIN unit_usaha u ON u.id = r.unit_usaha_id
           ${w.where()} ORDER BY r.skor_inheren DESC, r.kode`, w.params)
        .map((r) => ({
          ...r, level_inheren: LEVEL_RISIKO(r.skor_inheren), level_residu: LEVEL_RISIKO(r.skor_residu),
          kri: r.kri_nama ? `${r.kri_nama}: ${r.kri_nilai ?? '-'} / ${r.kri_ambang ?? '-'}` : '',
          kri_lewat: r.kri_ambang !== null && r.kri_nilai !== null && r.kri_nilai > r.kri_ambang ? 'Ya' : '',
        }))
        .filter((r) => !f.level || r.level_inheren === f.level);
      return {
        subjudul: `Per ${tanggalPanjang(hariIni())}`,
        ringkasan: [
          { label: 'Jumlah risiko', nilai: baris.length, tipe: 'angka' },
          { label: 'Level inheren', nilai: hitungPer(baris, 'level_inheren') || '-' },
          { label: 'Level residual', nilai: hitungPer(baris, 'level_residu') || '-' },
          { label: 'KRI terlampaui', nilai: baris.filter((r) => r.kri_lewat).length, tipe: 'angka' },
        ],
        bagian: [{
          kolom: [KOLOM_NO, { kunci: 'kode', label: 'Kode' }, { kunci: 'nama', label: 'Risiko' }, { kunci: 'kategori', label: 'Kategori' },
            { kunci: 'unit', label: 'Unit' }, { kunci: 'likelihood', label: 'L', tipe: 'angka' }, { kunci: 'impact', label: 'I', tipe: 'angka' },
            { kunci: 'skor_inheren', label: 'Skor Inheren', tipe: 'angka' }, { kunci: 'level_inheren', label: 'Level Inheren' },
            { kunci: 'efektivitas_kontrol', label: 'Kontrol' }, { kunci: 'likelihood_residu', label: 'L Res.', tipe: 'angka' },
            { kunci: 'impact_residu', label: 'I Res.', tipe: 'angka' }, { kunci: 'skor_residu', label: 'Skor Residual', tipe: 'angka' },
            { kunci: 'level_residu', label: 'Level Residual' }, { kunci: 'pic', label: 'PIC' }, { kunci: 'kri', label: 'KRI (nilai/ambang)' },
            { kunci: 'kri_lewat', label: 'KRI Lewat' }, { kunci: 'review_terakhir', label: 'Review', tipe: 'tanggal' }],
          baris: bernomor(baris.map(({ mitigasi: _m, kri_nama: _k, kri_ambang: _a, kri_nilai: _n, ...r }) => r)),
        }],
        catatan: 'Skor = likelihood x impact (1-5). Level: ≥ 20 ekstrem, ≥ 12 tinggi, ≥ 6 sedang, selebihnya rendah.',
      };
    },
  },

  // =================================== CRM ===================================
  {
    kode: 'crm-tiket',
    judul: 'Tiket Layanan Anggota',
    izin: 'crm.view',
    orientasi: 'landscape',
    deskripsi: 'Tiket pengaduan/pertanyaan per periode dengan status, kategori, waktu penyelesaian, dan rating.',
    filter: [
      ...periode({ label: 'Tanggal tiket' }),
      pilih('status', 'Status', ['baru', 'diproses', 'menunggu', 'selesai', 'ditutup']),
      pilih('kategori', 'Kategori', ['pengaduan', 'pertanyaan', 'saran', 'klaim']),
      pilih('prioritas', 'Prioritas', ['rendah', 'normal', 'tinggi', 'urgent']),
      pilih('kanal', 'Kanal', ['aplikasi', 'whatsapp', 'telepon', 'email', 'langsung']),
    ],
    susun(f) {
      const w = rentangWaktu(kondisi(), 't.created_at', f).sama('t.status', f.status).sama('t.kategori', f.kategori)
        .sama('t.prioritas', f.prioritas).sama('t.kanal', f.kanal);
      const baris = all(
        `SELECT t.nomor, substr(t.created_at, 1, 10) AS tanggal, a.nomor_anggota, a.nama AS anggota, t.kategori, t.prioritas,
                t.kanal, t.judul, t.petugas, t.status, substr(t.selesai_at, 1, 10) AS selesai,
                CASE WHEN t.selesai_at IS NOT NULL THEN ROUND(julianday(t.selesai_at) - julianday(t.created_at), 1) END AS durasi,
                t.rating, (SELECT COUNT(*) FROM tiket_balasan b WHERE b.tiket_id = t.id) AS balasan
           FROM tiket t LEFT JOIN anggota a ON a.id = t.anggota_id
           ${w.where()} ORDER BY t.created_at, t.id`, w.params);
      const rata = (arr, k) => {
        const v = arr.filter((r) => r[k] !== null && r[k] !== undefined);
        return v.length ? Number((v.reduce((s, r) => s + Number(r[k]), 0) / v.length).toFixed(2)) : 0;
      };
      const perKat = new Map();
      for (const r of baris) {
        if (!perKat.has(r.kategori)) perKat.set(r.kategori, []);
        perKat.get(r.kategori).push(r);
      }
      const rekap = [...perKat].map(([kategori, arr]) => ({
        kategori, jumlah: arr.length, selesai: arr.filter((r) => ['selesai', 'ditutup'].includes(r.status)).length,
        terbuka: arr.filter((r) => !['selesai', 'ditutup'].includes(r.status)).length,
        durasi: rata(arr, 'durasi'), rating: rata(arr, 'rating'),
      }));
      return {
        subjudul: teksPeriode(f),
        ringkasan: [
          { label: 'Jumlah tiket', nilai: baris.length, tipe: 'angka' },
          { label: 'Selesai/ditutup', nilai: baris.filter((r) => ['selesai', 'ditutup'].includes(r.status)).length, tipe: 'angka' },
          { label: 'Rata-rata penyelesaian (hari)', nilai: rata(baris, 'durasi'), tipe: 'angka' },
          { label: 'Rata-rata rating', nilai: rata(baris, 'rating'), tipe: 'angka' },
        ],
        bagian: [
          {
            judul: 'Daftar tiket',
            kolom: [KOLOM_NO, { kunci: 'nomor', label: 'Nomor' }, { kunci: 'tanggal', label: 'Tanggal', tipe: 'tanggal' },
              { kunci: 'nomor_anggota', label: 'No. Anggota' }, { kunci: 'anggota', label: 'Anggota' },
              { kunci: 'kategori', label: 'Kategori' }, { kunci: 'prioritas', label: 'Prioritas' }, { kunci: 'kanal', label: 'Kanal' },
              { kunci: 'judul', label: 'Judul' }, { kunci: 'petugas', label: 'Petugas' }, { kunci: 'status', label: 'Status' },
              { kunci: 'selesai', label: 'Selesai', tipe: 'tanggal' }, { kunci: 'durasi', label: 'Durasi (hari)', tipe: 'angka' },
              { kunci: 'rating', label: 'Rating', tipe: 'angka' }, { kunci: 'balasan', label: 'Balasan', tipe: 'angka' }],
            baris: bernomor(baris),
          },
          {
            judul: 'Rekap per kategori',
            kolom: [{ kunci: 'kategori', label: 'Kategori' }, { kunci: 'jumlah', label: 'Jumlah', tipe: 'angka' },
              { kunci: 'selesai', label: 'Selesai', tipe: 'angka' }, { kunci: 'terbuka', label: 'Belum Selesai', tipe: 'angka' },
              { kunci: 'durasi', label: 'Rata-rata Durasi (hari)', tipe: 'angka' }, { kunci: 'rating', label: 'Rata-rata Rating', tipe: 'angka' }],
            baris: rekap,
            total: jumlahkan(rekap, ['jumlah', 'selesai', 'terbuka']),
          },
        ],
      };
    },
  },
  {
    kode: 'crm-survei',
    judul: 'Survei Kepuasan & NPS',
    izin: 'crm.view',
    orientasi: 'landscape',
    deskripsi: 'Skor kepuasan layanan, produk, petugas, dan Net Promoter Score per periode survei beserta saran anggota.',
    filter: [
      ...periode({ label: 'Tanggal isi' }),
      pilih('periode', 'Periode survei', () => all(
        'SELECT DISTINCT periode AS nilai, periode AS teks FROM survey_kepuasan WHERE periode IS NOT NULL ORDER BY periode DESC')),
      dgnBawaan(pilih('saran', 'Daftar saran', [{ nilai: 'ya', teks: 'Sertakan' }, { nilai: 'tidak', teks: 'Tidak' }]), 'ya'),
    ],
    susun(f) {
      const w = rentangWaktu(kondisi(), 's.created_at', f).sama('s.periode', f.periode);
      const data = all(
        `SELECT s.periode, s.skor_layanan, s.skor_produk, s.skor_petugas, s.nps, s.saran, substr(s.created_at, 1, 10) AS tanggal,
                a.nomor_anggota, a.nama
           FROM survey_kepuasan s LEFT JOIN anggota a ON a.id = s.anggota_id ${w.where()} ORDER BY s.created_at, s.id`, w.params);
      const ringkas = (arr) => {
        const avg = (k) => {
          const v = arr.filter((r) => r[k] !== null);
          return v.length ? Number((v.reduce((s, r) => s + r[k], 0) / v.length).toFixed(2)) : 0;
        };
        const n = arr.filter((r) => r.nps !== null);
        const promoter = n.filter((r) => r.nps >= 9).length;
        const detraktor = n.filter((r) => r.nps <= 6).length;
        return { responden: arr.length, layanan: avg('skor_layanan'), produk: avg('skor_produk'), petugas: avg('skor_petugas'),
          promoter, pasif: n.length - promoter - detraktor, detraktor,
          nps: n.length ? Number(((promoter - detraktor) / n.length * 100).toFixed(1)) : 0 };
      };
      const perPeriode = new Map();
      for (const r of data) {
        const k = r.periode || '-';
        if (!perPeriode.has(k)) perPeriode.set(k, []);
        perPeriode.get(k).push(r);
      }
      const rekap = [...perPeriode].sort(([a], [b]) => a.localeCompare(b)).map(([p, arr]) => ({ periode: p, ...ringkas(arr) }));
      const semua = ringkas(data);
      const bagian = [{
        judul: 'Rekap per periode survei',
        kolom: [{ kunci: 'periode', label: 'Periode' }, { kunci: 'responden', label: 'Responden', tipe: 'angka' },
          { kunci: 'layanan', label: 'Skor Layanan', tipe: 'angka' }, { kunci: 'produk', label: 'Skor Produk', tipe: 'angka' },
          { kunci: 'petugas', label: 'Skor Petugas', tipe: 'angka' }, { kunci: 'promoter', label: 'Promoter', tipe: 'angka' },
          { kunci: 'pasif', label: 'Pasif', tipe: 'angka' }, { kunci: 'detraktor', label: 'Detraktor', tipe: 'angka' },
          { kunci: 'nps', label: 'NPS', tipe: 'angka' }],
        baris: rekap,
        total: { _label: 'KESELURUHAN', ...semua },
      }];
      if (f.saran === 'ya') {
        bagian.push({
          judul: 'Saran & masukan anggota',
          kolom: [KOLOM_NO, { kunci: 'tanggal', label: 'Tanggal', tipe: 'tanggal' }, { kunci: 'nomor_anggota', label: 'No. Anggota' },
            { kunci: 'nama', label: 'Nama' }, { kunci: 'nps', label: 'NPS', tipe: 'angka' }, { kunci: 'saran', label: 'Saran' }],
          baris: bernomor(data.filter((r) => r.saran).map(({ tanggal, nomor_anggota, nama, nps, saran }) =>
            ({ tanggal, nomor_anggota, nama, nps, saran }))),
        });
      }
      return {
        subjudul: teksPeriode(f, 'Diisi'),
        ringkasan: [
          { label: 'Responden', nilai: semua.responden, tipe: 'angka' },
          { label: 'Net Promoter Score', nilai: semua.nps, tipe: 'angka' },
          { label: 'Skor layanan (1-5)', nilai: semua.layanan, tipe: 'angka' },
        ],
        bagian,
        catatan: 'NPS = % promoter (skor 9-10) - % detraktor (skor 0-6). Skor layanan/produk/petugas berskala 1-5.',
      };
    },
  },
  {
    kode: 'crm-broadcast',
    judul: 'Riwayat Broadcast Anggota',
    izin: 'crm.view',
    orientasi: 'landscape',
    deskripsi: 'Pesan broadcast per periode menurut kanal, target, dan status pengiriman.',
    filter: [
      ...periode(),
      pilih('kanal', 'Kanal', ['aplikasi', 'whatsapp', 'sms', 'email']),
      pilih('target', 'Target', ['semua', 'aktif', 'cabang', 'punya_pinjaman', 'kustom']),
      pilih('status', 'Status', ['draft', 'terjadwal', 'terkirim', 'gagal']),
    ],
    susun(f) {
      const w = rentangWaktu(kondisi(), 'b.created_at', f).sama('b.kanal', f.kanal).sama('b.target', f.target).sama('b.status', f.status);
      const baris = bernomor(all(
        `SELECT substr(b.created_at, 1, 10) AS tanggal, b.judul, b.pesan, b.kanal, b.target, b.jumlah_target, b.status,
                b.dikirim_pada FROM broadcast b ${w.where()} ORDER BY b.created_at, b.id`, w.params)
        .map((r) => ({ ...r, pesan: r.pesan && r.pesan.length > 200 ? `${r.pesan.slice(0, 200)}…` : r.pesan })));
      return {
        subjudul: teksPeriode(f),
        ringkasan: [{ label: 'Jumlah broadcast', nilai: baris.length, tipe: 'angka' },
          { label: 'Total penerima', nilai: baris.reduce((s, r) => s + (r.jumlah_target || 0), 0), tipe: 'angka' }],
        bagian: [{
          kolom: [KOLOM_NO, { kunci: 'tanggal', label: 'Tanggal', tipe: 'tanggal' }, { kunci: 'judul', label: 'Judul' },
            { kunci: 'pesan', label: 'Pesan' }, { kunci: 'kanal', label: 'Kanal' }, { kunci: 'target', label: 'Target' },
            { kunci: 'jumlah_target', label: 'Penerima', tipe: 'angka' }, { kunci: 'status', label: 'Status' },
            { kunci: 'dikirim_pada', label: 'Dikirim' }],
          baris,
          total: jumlahkan(baris, ['jumlah_target']),
        }],
      };
    },
  },

  // ============================== ADMINISTRATOR ==============================
  {
    kode: 'admin-pengguna',
    judul: 'Daftar Pengguna & Peran',
    izin: 'admin.view',
    orientasi: 'landscape',
    deskripsi: 'Akun pengguna aplikasi beserta peran, cabang/unit, status MFA, dan login terakhir (tanpa data rahasia).',
    filter: [
      pilih('role', 'Peran', () => Object.entries(ROLES).map(([nilai, r]) => ({ nilai, teks: r.nama }))),
      pilih('status', 'Status', () => all("SELECT DISTINCT status AS nilai, status AS teks FROM users UNION SELECT 'aktif', 'aktif' ORDER BY 1")),
      pilih('cabang_id', 'Cabang', opsiCabang),
      pilih('mfa', 'MFA', [{ nilai: '1', teks: 'Aktif' }, { nilai: '0', teks: 'Tidak aktif' }]),
    ],
    susun(f) {
      const w = kondisi().sama('u.role', f.role).sama('u.status', f.status).sama('u.cabang_id', f.cabang_id);
      if (f.mfa !== undefined) w.tambah('u.mfa_enabled = ?', Number(f.mfa));
      // Kolom dipilih eksplisit: password_hash, password_salt, dan mfa_secret TIDAK pernah dikeluarkan.
      const baris = bernomor(all(
        `SELECT u.username, u.nama, u.email, u.role, c.nama AS cabang, uu.nama AS unit, a.nomor_anggota,
                u.mfa_enabled, u.status, u.last_login_at, u.gagal_login, u.terkunci_sampai, substr(u.created_at, 1, 10) AS dibuat
           FROM users u LEFT JOIN cabang c ON c.id = u.cabang_id LEFT JOIN unit_usaha uu ON uu.id = u.unit_usaha_id
           LEFT JOIN anggota a ON a.id = u.anggota_id
           ${w.where()} ORDER BY u.username`, w.params)
        .map((r) => ({ ...r, peran: namaPeran(r.role), mfa: r.mfa_enabled ? 'Aktif' : '-' })));
      const perPeran = Object.entries(ROLES).map(([kode, r]) => ({
        kode, nama: r.nama, deskripsi: r.deskripsi, jumlah: baris.filter((u) => u.role === kode).length,
      })).filter((r) => !f.role || r.kode === f.role);
      return {
        subjudul: `Per ${tanggalPanjang(hariIni())}`,
        ringkasan: [
          { label: 'Jumlah pengguna', nilai: baris.length, tipe: 'angka' },
          { label: 'MFA aktif', nilai: baris.filter((r) => r.mfa_enabled).length, tipe: 'angka' },
          { label: 'Tidak aktif / terkunci', nilai: baris.filter((r) => r.status !== 'aktif' || r.terkunci_sampai).length, tipe: 'angka' },
        ],
        bagian: [
          {
            judul: 'Daftar pengguna',
            kolom: [KOLOM_NO, { kunci: 'username', label: 'Username' }, { kunci: 'nama', label: 'Nama' },
              { kunci: 'email', label: 'Email' }, { kunci: 'peran', label: 'Peran' }, { kunci: 'cabang', label: 'Cabang' },
              { kunci: 'unit', label: 'Unit' }, { kunci: 'nomor_anggota', label: 'No. Anggota' }, { kunci: 'mfa', label: 'MFA' },
              { kunci: 'status', label: 'Status' }, { kunci: 'last_login_at', label: 'Login Terakhir' },
              { kunci: 'gagal_login', label: 'Gagal Login', tipe: 'angka' }, { kunci: 'terkunci_sampai', label: 'Terkunci s.d.' },
              { kunci: 'dibuat', label: 'Dibuat', tipe: 'tanggal' }],
            baris: baris.map(({ role: _r, mfa_enabled: _m, ...r }) => r),
          },
          {
            judul: 'Ringkasan peran',
            kolom: [{ kunci: 'kode', label: 'Kode Peran' }, { kunci: 'nama', label: 'Nama Peran' },
              { kunci: 'deskripsi', label: 'Deskripsi' }, { kunci: 'jumlah', label: 'Pengguna', tipe: 'angka' }],
            baris: perPeran,
            total: jumlahkan(perPeran, ['jumlah']),
          },
        ],
      };
    },
  },
  {
    kode: 'admin-audit-trail',
    judul: 'Jejak Audit (Audit Trail)',
    izin: 'admin.view',
    orientasi: 'landscape',
    deskripsi: 'Rekaman aktivitas pengguna per periode (tanpa tanggal: bulan berjalan) dengan filter modul, aksi, dan username.',
    filter: [
      ...periode(),
      pilih('modul', 'Modul', () => [...new Set([...all('SELECT DISTINCT modul AS m FROM audit_log').map((r) => r.m), ...MODULES, 'auth'])]
        .filter(Boolean).sort().map((m) => ({ nilai: m, teks: m }))),
      pilih('aksi', 'Aksi', ['create', 'update', 'delete', 'login', 'logout', 'approve', 'post', 'void', 'export']),
      { kunci: 'username', label: 'Username', tipe: 'teks' },
      { kunci: 'cari', label: 'Keterangan memuat', tipe: 'teks' },
    ],
    susun(f0) {
      // Tanpa tanggal: bulan berjalan (audit trail dapat sangat besar)
      const sampai = f0.sampai || (f0.dari && f0.dari > hariIni() ? f0.dari : hariIni());
      const f = { ...f0, sampai, dari: f0.dari || `${sampai.slice(0, 7)}-01` };
      const w = rentangWaktu(kondisi(), 'l.waktu', f).sama('l.modul', f.modul).sama('l.aksi', f.aksi).sama('l.username', f.username);
      if (f.cari) w.tambah('l.keterangan LIKE ?', `%${f.cari}%`);
      // data_before/data_after tidak dikeluarkan karena dapat memuat data sensitif.
      const baris = all(
        `SELECT l.id, l.waktu, l.username, l.aksi, l.modul, l.entitas_id, l.keterangan, l.ip
           FROM audit_log l ${w.where()} ORDER BY l.id`, w.params)
        .map((r) => ({ ...r, waktu: String(r.waktu).replace('T', ' ').replace(/\.\d+Z$|Z$/, '') }));
      const perAksi = new Map();
      for (const r of baris) perAksi.set(r.aksi, (perAksi.get(r.aksi) || 0) + 1);
      const perModul = new Map();
      for (const r of baris) perModul.set(r.modul, (perModul.get(r.modul) || 0) + 1);
      const rekap = [...perModul].sort((a, b) => b[1] - a[1]).map(([modul, jumlah]) => ({ modul, jumlah }));
      return {
        subjudul: teksPeriode(f),
        ringkasan: [
          { label: 'Jumlah rekaman', nilai: baris.length, tipe: 'angka' },
          { label: 'Per aksi', nilai: [...perAksi].map(([k, n]) => `${k}: ${n}`).join(', ') || '-' },
          { label: 'Pengguna', nilai: new Set(baris.map((r) => r.username)).size, tipe: 'angka' },
        ],
        bagian: [
          {
            judul: 'Rekaman aktivitas',
            kolom: [{ kunci: 'id', label: 'ID', tipe: 'angka' }, { kunci: 'waktu', label: 'Waktu (UTC)' },
              { kunci: 'username', label: 'Username' }, { kunci: 'aksi', label: 'Aksi' }, { kunci: 'modul', label: 'Modul' },
              { kunci: 'entitas_id', label: 'Entitas' }, { kunci: 'keterangan', label: 'Keterangan' }, { kunci: 'ip', label: 'IP' }],
            baris,
          },
          {
            judul: 'Rekap per modul',
            kolom: [{ kunci: 'modul', label: 'Modul' }, { kunci: 'jumlah', label: 'Jumlah', tipe: 'angka' }],
            baris: rekap,
            total: jumlahkan(rekap, ['jumlah']),
          },
        ],
        catatan: 'Isi data sebelum/sesudah tidak dicantumkan. Keutuhan rantai hash dapat diverifikasi pada menu Administrator.',
      };
    },
  },
].map(rapikan);
