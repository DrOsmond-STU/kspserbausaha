/**
 * Pusat Laporan - kelompok keanggotaan, simpanan, pinjaman & SHU.
 * Lihat server/laporan/bantu.js untuk format definisi laporan.
 *
 * Catatan perhitungan:
 * - Saldo simpanan "per tanggal" dihitung mundur dari saldo rekening saat ini
 *   dikurangi mutasi sesudah tanggal tersebut. Dengan begitu saldo per hari ini
 *   selalu sama dengan saldo rekening (termasuk saldo awal hasil migrasi yang
 *   tidak memiliki riwayat transaksi).
 * - Transaksi simpanan yang dibatalkan tetap tersimpan berstatus 'batal' dan
 *   dinetralkan oleh mutasi 'koreksi' bertanggal hari pembatalan, sedangkan
 *   jurnal pembaliknya bertanggal sama dengan transaksi asal. Agar sejalan
 *   dengan buku besar, pasangan batal + koreksi dikeluarkan dari perhitungan
 *   saldo dan rekap (dampak bersihnya memang nol).
 * - Outstanding pinjaman per tanggal = pokok - angsuran pokok s.d. tanggal itu;
 *   pinjaman yang lunas / dialihkan (restrukturisasi) sebelum tanggal itu
 *   bernilai nol. Kolektibilitas dihitung ulang dari angsuran tertua yang
 *   belum lunas pada tanggal tersebut (aturan yang sama dengan modul pinjaman).
 */
import { all } from '../db.js';
import { badRequest } from '../lib/http.js';
import { today } from '../lib/util.js';
import { tanggalPanjang } from '../lib/profil.js';
import { LABEL_KOLEKTIBILITAS } from '../services/loans.js';
import { KOMPONEN } from '../services/shu.js';
import { periode, rentang, pilih, kondisi, teksPeriode, jumlahkan, bernomor, KOLOM_NO, opsiCabang } from './bantu.js';

// ------------------------------ Alat bantu ------------------------------

const kol = (kunci, label, tipe) => (tipe ? { kunci, label, tipe } : { kunci, label });
const uang = (kunci, label) => kol(kunci, label, 'uang');
const angka = (kunci, label) => kol(kunci, label, 'angka');
const tgl = (kunci, label) => kol(kunci, label, 'tanggal');

/** "mengundurkan_diri" → "Mengundurkan diri". */
const teks = (s) => (s === null || s === undefined || s === '' ? '-'
  : String(s).charAt(0).toUpperCase() + String(s).slice(1).replace(/_/g, ' '));

const persen = (bagian, total) => (total ? Math.round((bagian / total) * 10_000) / 100 : 0);
const jumlah = (baris, kunci) => baris.reduce((s, r) => s + (Number(r[kunci]) || 0), 0);

/** Batas bawah/atas tanggal bila filter periode dikosongkan. */
const AWAL = '0000-01-01';
const AKHIR = '9999-12-31';

/** Filter tanggal tunggal "per tanggal" (bawaan hari ini). Memakai kunci `sampai`. */
const perTanggal = (label = 'Per tanggal') => ({ kunci: 'sampai', label, tipe: 'tanggal', bawaan: today });
const teksPer = (t) => `Per ${tanggalPanjang(t)}`;

const YA_TIDAK = [{ nilai: 'ya', teks: 'Ya' }, { nilai: 'tidak', teks: 'Tidak' }];
const filterTanpaNol = (label = 'Sembunyikan saldo nol') => pilih('tanpa_nol', label, YA_TIDAK);

const STATUS_ANGGOTA = ['calon', 'aktif', 'nonaktif', 'keluar', 'meninggal', 'ditolak'];
const JENIS_KELAMIN = [{ nilai: 'L', teks: 'Laki-laki' }, { nilai: 'P', teks: 'Perempuan' }];
const ALASAN_KELUAR = { mengundurkan_diri: 'Mengundurkan diri', meninggal: 'Meninggal dunia', diberhentikan: 'Diberhentikan' };

const JENIS_SIMPANAN = ['pokok', 'wajib', 'sukarela', 'berjangka', 'deposito'];
const JENIS_TRX_SIMPANAN = ['setoran', 'penarikan', 'bunga', 'pindah_buku', 'koreksi'];
const LABEL_TRX_SIMPANAN = { bunga: 'Jasa simpanan', pindah_buku: 'Pindah buku' };
const STATUS_PINJAMAN = ['diajukan', 'survey', 'dianalisis', 'disetujui', 'ditolak', 'batal', 'dicairkan',
  'lunas', 'restrukturisasi', 'hapus_buku'];

const opsiProdukSimpanan = () => all('SELECT id AS nilai, nama AS teks FROM produk_simpanan ORDER BY kode');
const opsiProdukPinjaman = () => all('SELECT id AS nilai, nama AS teks FROM produk_pinjaman ORDER BY kode');
const opsiTahunShu = () => all('SELECT tahun AS nilai, tahun AS teks FROM shu_periode ORDER BY tahun DESC');
const opsiKolektibilitas = () => [1, 2, 3, 4, 5].map((k) => ({ nilai: k, teks: `${k} - ${LABEL_KOLEKTIBILITAS[k]}` }));
const tahunShuTerakhir = () => opsiTahunShu()[0]?.nilai;

/** Transaksi simpanan yang diperhitungkan (tanpa pasangan batal + koreksinya). */
const TRX_BERLAKU = "t.status <> 'batal' AND t.jenis <> 'koreksi'";

/**
 * Subkueri mutasi bersih simpanan per rekening SESUDAH tanggal tertentu
 * (parameter: tanggal). Saldo per tanggal = r.saldo - mutasi_sesudah.
 */
const MUTASI_SESUDAH = `(SELECT t.rekening_id, SUM(t.kredit - t.debit) AS mutasi
    FROM transaksi_simpanan t WHERE t.tanggal > ? AND ${TRX_BERLAKU} GROUP BY t.rekening_id)`;

/** Kolektibilitas dari jumlah hari tunggakan (sama dengan services/loans.js). */
const kolektibilitas = (hari) => (hari <= 0 ? 1 : hari <= 90 ? 2 : hari <= 180 ? 3 : hari <= 270 ? 4 : 5);

/** Filter umum pinjaman: produk, cabang, rentang nomor pinjaman & nomor anggota. */
const filterPinjaman = () => [
  pilih('produk_id', 'Produk pinjaman', opsiProdukPinjaman),
  pilih('cabang_id', 'Cabang', opsiCabang),
  ...rentang('pinjaman', 'Nomor pinjaman'),
  ...rentang('anggota', 'Nomor anggota'),
];
const kondisiPinjaman = (w, f) => w.sama('p.produk_id', f.produk_id).sama('p.cabang_id', f.cabang_id)
  .rentang('p.nomor', f, 'pinjaman').rentang('a.nomor_anggota', f, 'anggota');

/**
 * Portofolio pinjaman per tanggal: outstanding pokok, tunggakan, hari
 * tunggakan, dan kolektibilitas setiap pinjaman yang masih berjalan pada
 * tanggal `per`. Satu kueri (angsuran & jadwal diagregasi sekali jalan).
 */
function portofolioPer(per, f) {
  const w = kondisiPinjaman(kondisi(), f)
    .tambah('p.tanggal_cair IS NOT NULL AND p.tanggal_cair <= ?', per)
    .tambah("p.status IN ('dicairkan','lunas','restrukturisasi','hapus_buku')")
    .tambah('(p.tanggal_lunas IS NULL OR p.tanggal_lunas > ?)', per);
  const baris = all(
    `SELECT p.nomor, p.produk_id, a.nomor_anggota, a.nama, pr.nama AS produk, c.nama AS cabang,
            p.tanggal_cair, j.akhir AS jatuh_tempo_akhir, p.pokok, p.tenor, p.bunga_tahunan,
            p.pokok - COALESCE(b.pokok, 0) AS outstanding,
            MAX(0, COALESCE(j.kewajiban, 0) - COALESCE(b.pokok, 0) - COALESCE(b.bunga, 0)) AS tunggakan,
            CASE WHEN j.tertua IS NULL THEN 0
                 ELSE CAST(julianday(?) - julianday(j.tertua) AS INTEGER) END AS hari_tunggak
       FROM pinjaman p
       JOIN anggota a ON a.id = p.anggota_id
       JOIN produk_pinjaman pr ON pr.id = p.produk_id
       LEFT JOIN cabang c ON c.id = p.cabang_id
       LEFT JOIN (SELECT pinjaman_id, SUM(bayar_pokok) AS pokok, SUM(bayar_bunga) AS bunga
                    FROM pinjaman_angsuran WHERE tanggal <= ? AND status <> 'batal' GROUP BY pinjaman_id) b ON b.pinjaman_id = p.id
       LEFT JOIN (SELECT pinjaman_id,
                         SUM(CASE WHEN jatuh_tempo < ? THEN total ELSE 0 END) AS kewajiban,
                         MIN(CASE WHEN jatuh_tempo < ?
                                   AND NOT (status = 'lunas' AND (tanggal_bayar IS NULL OR tanggal_bayar <= ?))
                                  THEN jatuh_tempo END) AS tertua,
                         MAX(jatuh_tempo) AS akhir
                    FROM pinjaman_jadwal GROUP BY pinjaman_id) j ON j.pinjaman_id = p.id
      ${w.where()}
      ORDER BY p.nomor`,
    [per, per, per, per, per, ...w.params],
  ).filter((r) => r.outstanding > 0);
  for (const r of baris) {
    r.kolektibilitas = kolektibilitas(r.hari_tunggak);
    r.kategori = LABEL_KOLEKTIBILITAS[r.kolektibilitas];
  }
  return f.kolektibilitas ? baris.filter((r) => String(r.kolektibilitas) === String(f.kolektibilitas)) : baris;
}

/** Status kesehatan portofolio menurut rasio NPL (sama dengan statistik modul pinjaman). */
const kesehatanNpl = (rasio, total) => (total === 0 ? 'Belum ada pinjaman'
  : rasio < 5 ? 'Sehat' : rasio < 10 ? 'Cukup sehat' : 'Perlu perhatian');

/** Mengelompokkan baris anggota menurut fungsi kunci (untuk rekap). */
function rekapAnggota(data, kunci, urut) {
  const peta = new Map();
  for (const a of data) {
    const k = kunci(a);
    const r = peta.get(k) || { kelompok: k, jumlah: 0, laki: 0, perempuan: 0, aktif: 0 };
    r.jumlah += 1;
    if (a.jenis_kelamin === 'L') r.laki += 1;
    if (a.jenis_kelamin === 'P') r.perempuan += 1;
    if (a.status === 'aktif') r.aktif += 1;
    peta.set(k, r);
  }
  const baris = [...peta.values()];
  baris.sort(urut || ((x, y) => y.jumlah - x.jumlah || String(x.kelompok).localeCompare(String(y.kelompok))));
  for (const r of baris) r.persen = persen(r.jumlah, data.length);
  return baris;
}

function kelompokUsia(tanggalLahir, acuan) {
  if (!tanggalLahir) return 'Tidak diketahui';
  const [ty, tm, td] = tanggalLahir.slice(0, 10).split('-').map(Number);
  const [ay, am, ad] = acuan.split('-').map(Number);
  const usia = ay - ty - (am < tm || (am === tm && ad < td) ? 1 : 0);
  if (!Number.isFinite(usia) || usia < 0) return 'Tidak diketahui';
  if (usia < 25) return '< 25 tahun';
  if (usia < 35) return '25 - 34 tahun';
  if (usia < 45) return '35 - 44 tahun';
  if (usia < 55) return '45 - 54 tahun';
  return '≥ 55 tahun';
}

const KOLOM_REKAP = (judul) => [
  KOLOM_NO, kol('kelompok', judul), angka('jumlah', 'Jumlah'), angka('laki', 'Laki-laki'),
  angka('perempuan', 'Perempuan'), angka('aktif', 'Aktif'), kol('persen', '% dari total', 'persen'),
];

// ------------------------------- Definisi -------------------------------

export default [
  // ============================ KEANGGOTAAN ============================
  {
    kode: 'daftar-anggota',
    judul: 'Daftar Anggota',
    izin: 'anggota.view',
    jenis_ttd: 'laporan',
    orientasi: 'landscape',
    deskripsi: 'Data anggota menurut tanggal bergabung, rentang nomor anggota, status, jenis kelamin, dan cabang.',
    filter: [
      ...periode({ label: 'Tanggal bergabung' }),
      ...rentang('nomor', 'Nomor anggota'),
      pilih('status', 'Status', STATUS_ANGGOTA),
      pilih('jenis_kelamin', 'Jenis kelamin', JENIS_KELAMIN),
      pilih('cabang_id', 'Cabang', opsiCabang),
    ],
    susun(f) {
      const w = kondisi().periode('a.tanggal_gabung', f).rentang('a.nomor_anggota', f, 'nomor')
        .sama('a.status', f.status).sama('a.jenis_kelamin', f.jenis_kelamin).sama('a.cabang_id', f.cabang_id);
      const baris = bernomor(all(
        `SELECT a.nomor_anggota, a.nama, a.nik, a.jenis_kelamin, a.telepon, a.alamat, a.pekerjaan,
                a.tanggal_gabung, a.status, c.nama AS cabang
           FROM anggota a LEFT JOIN cabang c ON c.id = a.cabang_id ${w.where()}
          ORDER BY a.nomor_anggota`, w.params));
      return {
        subjudul: teksPeriode(f, 'Bergabung'),
        ringkasan: [
          { label: 'Jumlah anggota', nilai: baris.length, tipe: 'angka' },
          { label: 'Anggota aktif', nilai: baris.filter((r) => r.status === 'aktif').length, tipe: 'angka' },
        ],
        bagian: [{
          kolom: [KOLOM_NO, { kunci: 'nomor_anggota', label: 'No. Anggota' }, { kunci: 'nama', label: 'Nama' },
            { kunci: 'nik', label: 'NIK' }, { kunci: 'jenis_kelamin', label: 'L/P' }, { kunci: 'telepon', label: 'Telepon' },
            { kunci: 'pekerjaan', label: 'Pekerjaan' }, { kunci: 'cabang', label: 'Cabang' },
            { kunci: 'tanggal_gabung', label: 'Tgl Gabung', tipe: 'tanggal' }, { kunci: 'status', label: 'Status' }],
          baris,
        }],
      };
    },
  },

  {
    kode: 'mutasi-anggota',
    judul: 'Mutasi Keanggotaan (Anggota Masuk & Keluar)',
    izin: 'anggota.view',
    jenis_ttd: 'laporan',
    orientasi: 'landscape',
    deskripsi: 'Anggota yang bergabung dan keluar dalam suatu periode beserta alasan keluar, '
      + 'jumlah anggota awal/akhir periode, dan rekap per bulan.',
    filter: [...periode(), pilih('cabang_id', 'Cabang', opsiCabang)],
    susun(f) {
      const dari = f.dari || AWAL;
      const sampai = f.sampai || AKHIR;
      const cab = kondisi().sama('a.cabang_id', f.cabang_id);
      const pilihan = `SELECT a.nomor_anggota, a.nama, a.jenis_kelamin, a.pekerjaan, c.nama AS cabang,
                              a.tanggal_daftar, a.tanggal_gabung, a.tanggal_keluar, a.alasan_keluar, a.status
                         FROM anggota a LEFT JOIN cabang c ON c.id = a.cabang_id`;
      const masuk = all(`${pilihan} WHERE a.tanggal_gabung BETWEEN ? AND ? ${cab.and()}
                          ORDER BY a.tanggal_gabung, a.nomor_anggota`, [dari, sampai, ...cab.params]);
      const keluar = all(`${pilihan} WHERE a.tanggal_keluar BETWEEN ? AND ? ${cab.and()}
                           ORDER BY a.tanggal_keluar, a.nomor_anggota`, [dari, sampai, ...cab.params])
        .map((r) => ({ ...r, alasan: ALASAN_KELUAR[r.alasan_keluar] || r.alasan_keluar || '-', status: teks(r.status) }));
      // Anggota terdaftar pada suatu tanggal: sudah bergabung dan belum keluar
      const hitungPer = (t, inklusif) => all(
        `SELECT COUNT(*) AS n FROM anggota a WHERE a.tanggal_gabung IS NOT NULL AND a.tanggal_gabung ${inklusif ? '<=' : '<'} ?
            AND (a.tanggal_keluar IS NULL OR a.tanggal_keluar ${inklusif ? '>' : '>='} ?) ${cab.and()}`,
        [t, t, ...cab.params])[0].n;

      const perBulan = new Map();
      const tambahBulan = (t, k) => {
        const b = t.slice(0, 7);
        const r = perBulan.get(b) || { bulan: b, masuk: 0, keluar: 0 };
        r[k] += 1;
        perBulan.set(b, r);
      };
      masuk.forEach((r) => tambahBulan(r.tanggal_gabung, 'masuk'));
      keluar.forEach((r) => tambahBulan(r.tanggal_keluar, 'keluar'));
      const rekap = [...perBulan.values()].sort((a, b) => a.bulan.localeCompare(b.bulan))
        .map((r) => ({ ...r, neto: r.masuk - r.keluar }));

      return {
        subjudul: teksPeriode(f),
        ringkasan: [
          { label: 'Anggota awal periode', nilai: f.dari ? hitungPer(dari, false) : 0, tipe: 'angka' },
          { label: 'Anggota masuk', nilai: masuk.length, tipe: 'angka' },
          { label: 'Anggota keluar', nilai: keluar.length, tipe: 'angka' },
          { label: 'Anggota akhir periode', nilai: hitungPer(f.sampai || today(), true), tipe: 'angka' },
        ],
        bagian: [
          {
            judul: 'Anggota Masuk',
            kolom: [KOLOM_NO, kol('nomor_anggota', 'No. Anggota'), kol('nama', 'Nama'), kol('jenis_kelamin', 'L/P'),
              kol('pekerjaan', 'Pekerjaan'), kol('cabang', 'Cabang'), tgl('tanggal_daftar', 'Tgl Daftar'),
              tgl('tanggal_gabung', 'Tgl Gabung'), kol('status', 'Status Saat Ini')],
            baris: bernomor(masuk.map((r) => ({ ...r, status: teks(r.status) }))),
          },
          {
            judul: 'Anggota Keluar',
            kolom: [KOLOM_NO, kol('nomor_anggota', 'No. Anggota'), kol('nama', 'Nama'), kol('cabang', 'Cabang'),
              tgl('tanggal_gabung', 'Tgl Gabung'), tgl('tanggal_keluar', 'Tgl Keluar'), kol('alasan', 'Alasan Keluar'),
              kol('status', 'Status')],
            baris: bernomor(keluar),
          },
          {
            judul: 'Rekap per Bulan',
            kolom: [kol('bulan', 'Bulan'), angka('masuk', 'Masuk'), angka('keluar', 'Keluar'), angka('neto', 'Pertambahan Bersih')],
            baris: rekap,
            total: jumlahkan(rekap, ['masuk', 'keluar', 'neto']),
          },
        ],
      };
    },
  },

  {
    kode: 'ahli-waris',
    judul: 'Daftar Ahli Waris Anggota',
    izin: 'anggota.view',
    jenis_ttd: 'laporan',
    orientasi: 'landscape',
    deskripsi: 'Ahli waris setiap anggota beserta hubungan dan porsi; dapat menampilkan anggota yang belum mendaftarkan ahli waris.',
    filter: [
      { ...pilih('tampil', 'Tampilkan', [
        { nilai: 'ada', teks: 'Anggota yang memiliki ahli waris' },
        { nilai: 'tanpa', teks: 'Anggota tanpa ahli waris' },
        { nilai: 'semua', teks: 'Semua anggota' },
      ]), bawaan: 'ada' },
      ...rentang('nomor', 'Nomor anggota'),
      pilih('status', 'Status anggota', STATUS_ANGGOTA),
      pilih('cabang_id', 'Cabang', opsiCabang),
    ],
    susun(f) {
      const w = kondisi().rentang('a.nomor_anggota', f, 'nomor').sama('a.status', f.status).sama('a.cabang_id', f.cabang_id);
      if (f.tampil === 'ada') w.tambah('w.id IS NOT NULL');
      if (f.tampil === 'tanpa') w.tambah('w.id IS NULL');
      const data = all(
        `SELECT a.id AS anggota_id, a.nomor_anggota, a.nama AS anggota, a.status, c.nama AS cabang,
                w.id AS waris_id, w.nama, w.nik, w.hubungan, w.telepon, w.alamat, w.persentase
           FROM anggota a
           LEFT JOIN anggota_ahli_waris w ON w.anggota_id = a.id
           LEFT JOIN cabang c ON c.id = a.cabang_id
          ${w.where()}
          ORDER BY a.nomor_anggota, w.persentase DESC, w.id`, w.params);
      const porsi = new Map();
      for (const r of data) if (r.waris_id) porsi.set(r.anggota_id, (porsi.get(r.anggota_id) || 0) + (r.persentase || 0));
      const tidakPenuh = [...porsi.values()].filter((p) => Math.abs(p - 100) > 0.001).length;
      return {
        subjudul: 'Keadaan data saat ini',
        ringkasan: [
          { label: 'Jumlah anggota', nilai: new Set(data.map((r) => r.anggota_id)).size, tipe: 'angka' },
          { label: 'Jumlah ahli waris', nilai: data.filter((r) => r.waris_id).length, tipe: 'angka' },
          { label: 'Anggota dengan total porsi ≠ 100%', nilai: tidakPenuh, tipe: 'angka' },
        ],
        bagian: [{
          kolom: [KOLOM_NO, kol('nomor_anggota', 'No. Anggota'), kol('anggota', 'Nama Anggota'), kol('status', 'Status'),
            kol('cabang', 'Cabang'), kol('nama', 'Ahli Waris'), kol('hubungan', 'Hubungan'), kol('nik', 'NIK'),
            kol('telepon', 'Telepon'), kol('alamat', 'Alamat'), kol('persentase', 'Porsi', 'persen')],
          baris: bernomor(data.map((r) => ({ ...r, status: teks(r.status),
            nama: r.nama || '(belum ada ahli waris)', persentase: r.waris_id ? r.persentase : null }))),
        }],
        catatan: tidakPenuh ? 'Terdapat anggota yang total porsi ahli warisnya tidak 100%; mohon diperiksa.' : undefined,
      };
    },
  },

  {
    kode: 'rekap-anggota',
    judul: 'Rekapitulasi Anggota',
    izin: 'anggota.view',
    jenis_ttd: 'laporan',
    deskripsi: 'Jumlah anggota menurut status, cabang, jenis kelamin, jenis anggota, pekerjaan, dan kelompok usia.',
    filter: [
      pilih('status', 'Status', STATUS_ANGGOTA),
      pilih('cabang_id', 'Cabang', opsiCabang),
    ],
    susun(f) {
      const w = kondisi().sama('a.status', f.status).sama('a.cabang_id', f.cabang_id);
      const data = all(
        `SELECT a.status, a.jenis_kelamin, a.jenis_anggota, a.pekerjaan, a.tanggal_lahir,
                COALESCE(c.nama, '(tanpa cabang)') AS cabang
           FROM anggota a LEFT JOIN cabang c ON c.id = a.cabang_id ${w.where()}`, w.params);
      const hariIni = today();
      const perStatus = rekapAnggota(data, (a) => a.status,
        (x, y) => STATUS_ANGGOTA.indexOf(x.kelompok) - STATUS_ANGGOTA.indexOf(y.kelompok))
        .map((r) => ({ ...r, kelompok: teks(r.kelompok) }));
      const perUsia = rekapAnggota(data, (a) => kelompokUsia(a.tanggal_lahir, hariIni),
        (x, y) => String(x.kelompok).localeCompare(String(y.kelompok), 'id', { numeric: true }));
      const bagian = [
        ['Menurut Status', 'Status', perStatus],
        ['Menurut Cabang', 'Cabang', rekapAnggota(data, (a) => a.cabang)],
        ['Menurut Jenis Kelamin', 'Jenis Kelamin', rekapAnggota(data,
          (a) => (a.jenis_kelamin === 'L' ? 'Laki-laki' : a.jenis_kelamin === 'P' ? 'Perempuan' : 'Tidak diisi'))],
        ['Menurut Jenis Anggota', 'Jenis Anggota', rekapAnggota(data, (a) => teks(a.jenis_anggota))],
        ['Menurut Pekerjaan', 'Pekerjaan', rekapAnggota(data, (a) => a.pekerjaan || 'Tidak diisi')],
        ['Menurut Kelompok Usia', 'Kelompok Usia', perUsia],
      ].map(([judul, label, baris]) => ({
        judul, kolom: KOLOM_REKAP(label), baris: bernomor(baris),
        total: { ...jumlahkan(baris, ['jumlah', 'laki', 'perempuan', 'aktif']), persen: data.length ? 100 : 0 },
      }));
      return {
        subjudul: `Keadaan per ${tanggalPanjang(hariIni)}`,
        ringkasan: [
          { label: 'Jumlah anggota', nilai: data.length, tipe: 'angka' },
          { label: 'Anggota aktif', nilai: data.filter((a) => a.status === 'aktif').length, tipe: 'angka' },
          { label: 'Laki-laki', nilai: data.filter((a) => a.jenis_kelamin === 'L').length, tipe: 'angka' },
          { label: 'Perempuan', nilai: data.filter((a) => a.jenis_kelamin === 'P').length, tipe: 'angka' },
        ],
        bagian,
      };
    },
  },

  {
    kode: 'poin-loyalitas',
    judul: 'Poin Loyalitas Anggota',
    izin: 'anggota.view',
    jenis_ttd: 'laporan',
    deskripsi: 'Saldo awal, poin diperoleh dari belanja, poin ditukar, dan saldo akhir poin loyalitas setiap anggota dalam suatu periode.',
    filter: [
      ...periode(),
      ...rentang('anggota', 'Nomor anggota'),
      pilih('cabang_id', 'Cabang', opsiCabang),
      pilih('status', 'Status anggota', STATUS_ANGGOTA),
    ],
    susun(f) {
      const dari = f.dari || AWAL;
      const sampai = f.sampai || AKHIR;
      const w = kondisi().rentang('a.nomor_anggota', f, 'anggota').sama('a.cabang_id', f.cabang_id).sama('a.status', f.status);
      const baris = all(
        `SELECT a.nomor_anggota, a.nama, c.nama AS cabang,
                SUM(CASE WHEN l.tanggal < ? THEN l.poin ELSE 0 END) AS saldo_awal,
                SUM(CASE WHEN l.tanggal BETWEEN ? AND ? AND l.poin > 0 THEN l.poin ELSE 0 END) AS diperoleh,
                SUM(CASE WHEN l.tanggal BETWEEN ? AND ? AND l.poin < 0 THEN -l.poin ELSE 0 END) AS ditukar,
                SUM(CASE WHEN l.tanggal <= ? THEN l.poin ELSE 0 END) AS saldo_akhir,
                MAX(CASE WHEN l.tanggal <= ? THEN l.tanggal END) AS terakhir
           FROM loyalty_poin l
           JOIN anggota a ON a.id = l.anggota_id
           LEFT JOIN cabang c ON c.id = a.cabang_id
          ${w.where()}
          GROUP BY a.id ORDER BY a.nomor_anggota`,
        [dari, dari, sampai, dari, sampai, sampai, sampai, ...w.params],
      ).filter((r) => r.saldo_awal || r.diperoleh || r.ditukar || r.saldo_akhir);
      const nomor = bernomor(baris);
      return {
        subjudul: teksPeriode(f),
        ringkasan: [
          { label: 'Jumlah anggota', nilai: baris.length, tipe: 'angka' },
          { label: 'Poin diperoleh', nilai: jumlah(baris, 'diperoleh'), tipe: 'angka' },
          { label: 'Poin ditukar', nilai: jumlah(baris, 'ditukar'), tipe: 'angka' },
          { label: 'Saldo poin akhir', nilai: jumlah(baris, 'saldo_akhir'), tipe: 'angka' },
        ],
        bagian: [{
          kolom: [KOLOM_NO, kol('nomor_anggota', 'No. Anggota'), kol('nama', 'Nama'), kol('cabang', 'Cabang'),
            angka('saldo_awal', 'Saldo Awal'), angka('diperoleh', 'Diperoleh'), angka('ditukar', 'Ditukar'),
            angka('saldo_akhir', 'Saldo Akhir'), tgl('terakhir', 'Transaksi Terakhir')],
          baris: nomor,
          total: jumlahkan(baris, ['saldo_awal', 'diperoleh', 'ditukar', 'saldo_akhir']),
        }],
      };
    },
  },

  // ============================== SIMPANAN ==============================
  {
    kode: 'saldo-simpanan',
    judul: 'Daftar Rekening & Saldo Simpanan',
    izin: 'simpanan.view',
    jenis_ttd: 'laporan',
    orientasi: 'landscape',
    deskripsi: 'Saldo setiap rekening simpanan per tanggal tertentu (dihitung dari mutasi), menurut produk, jenis, cabang, '
      + 'rentang nomor rekening/anggota, dan status rekening.',
    filter: [
      perTanggal('Saldo per tanggal'),
      pilih('produk_id', 'Produk simpanan', opsiProdukSimpanan),
      pilih('jenis', 'Jenis simpanan', JENIS_SIMPANAN),
      pilih('cabang_id', 'Cabang', opsiCabang),
      pilih('status', 'Status rekening', ['aktif', 'blokir', 'tutup']),
      ...rentang('rekening', 'Nomor rekening'),
      ...rentang('anggota', 'Nomor anggota'),
      filterTanpaNol(),
    ],
    susun(f) {
      const per = f.sampai;
      const w = kondisi()
        .sama('r.produk_id', f.produk_id).sama('p.jenis', f.jenis).sama('r.cabang_id', f.cabang_id).sama('r.status', f.status)
        .rentang('r.nomor_rekening', f, 'rekening').rentang('a.nomor_anggota', f, 'anggota');
      const data = all(
        `SELECT r.nomor_rekening, a.nomor_anggota, a.nama, p.nama AS produk, p.jenis, c.nama AS cabang,
                r.tanggal_buka, r.tanggal_jatuh_tempo, r.status, r.saldo - COALESCE(s.mutasi, 0) AS saldo
           FROM rekening_simpanan r
           JOIN anggota a ON a.id = r.anggota_id
           JOIN produk_simpanan p ON p.id = r.produk_id
           LEFT JOIN cabang c ON c.id = r.cabang_id
           LEFT JOIN ${MUTASI_SESUDAH} s ON s.rekening_id = r.id
          ${w.where()}
          ORDER BY r.nomor_rekening`, [per, ...w.params])
        // Rekening yang dibuka sesudah tanggal laporan tidak ditampilkan, kecuali
        // sudah bersaldo (mis. jasa periode lampau yang dibukukan belakangan)
        // agar total tetap sama dengan buku besar.
        .filter((r) => (r.tanggal_buka <= per || r.saldo !== 0) && (f.tanpa_nol !== 'ya' || r.saldo !== 0));
      const perJenis = JENIS_SIMPANAN.map((j) => ({ j, n: jumlah(data.filter((r) => r.jenis === j), 'saldo') }))
        .filter((x) => x.n !== 0)
        .map((x) => ({ label: `Simpanan ${x.j}`, nilai: x.n, tipe: 'uang' }));
      return {
        subjudul: teksPer(per),
        ringkasan: [
          { label: 'Jumlah rekening', nilai: data.length, tipe: 'angka' },
          { label: 'Jumlah penyimpan', nilai: new Set(data.map((r) => r.nomor_anggota)).size, tipe: 'angka' },
          ...perJenis,
          { label: 'Total saldo', nilai: jumlah(data, 'saldo'), tipe: 'uang' },
        ],
        bagian: [{
          kolom: [KOLOM_NO, kol('nomor_rekening', 'No. Rekening'), kol('nomor_anggota', 'No. Anggota'), kol('nama', 'Nama'),
            kol('produk', 'Produk'), kol('cabang', 'Cabang'), tgl('tanggal_buka', 'Tgl Buka'),
            tgl('tanggal_jatuh_tempo', 'Jatuh Tempo'), kol('status', 'Status'), uang('saldo', 'Saldo')],
          baris: bernomor(data.map((r) => ({ ...r, status: teks(r.status) }))),
          total: jumlahkan(data, ['saldo']),
        }],
      };
    },
  },

  {
    kode: 'mutasi-simpanan',
    judul: 'Mutasi Transaksi Simpanan',
    izin: 'simpanan.view',
    jenis_ttd: 'laporan',
    orientasi: 'landscape',
    deskripsi: 'Setoran, penarikan, jasa, pindah buku, dan koreksi simpanan per periode, beserta rekap per jenis transaksi.',
    filter: [
      ...periode(),
      pilih('jenis', 'Jenis transaksi', JENIS_TRX_SIMPANAN.map((j) => ({ nilai: j, teks: LABEL_TRX_SIMPANAN[j] || teks(j) }))),
      { ...pilih('tampil', 'Status transaksi', [
        { nilai: 'berlaku', teks: 'Berlaku (tanpa batal & koreksinya)' },
        { nilai: 'semua', teks: 'Semua, termasuk batal & koreksi' },
        { nilai: 'batal', teks: 'Hanya batal & koreksi' },
      ]), bawaan: 'berlaku' },
      pilih('metode', 'Metode', ['tunai', 'transfer', 'potong_gaji', 'pindah_buku']),
      pilih('produk_id', 'Produk simpanan', opsiProdukSimpanan),
      pilih('cabang_id', 'Cabang', opsiCabang),
      ...rentang('rekening', 'Nomor rekening'),
      ...rentang('anggota', 'Nomor anggota'),
    ],
    susun(f) {
      const w = kondisi().periode('t.tanggal', f).sama('t.jenis', f.jenis).sama('t.metode', f.metode)
        .sama('r.produk_id', f.produk_id).sama('r.cabang_id', f.cabang_id)
        .rentang('r.nomor_rekening', f, 'rekening').rentang('a.nomor_anggota', f, 'anggota');
      if (f.tampil === 'berlaku') w.tambah(TRX_BERLAKU);
      if (f.tampil === 'batal') w.tambah(`NOT (${TRX_BERLAKU})`);
      const data = all(
        `SELECT t.tanggal, t.nomor, r.nomor_rekening, a.nomor_anggota, a.nama, p.nama AS produk,
                t.jenis, t.metode, t.kredit, t.debit, t.status, t.petugas, t.keterangan
           FROM transaksi_simpanan t
           JOIN rekening_simpanan r ON r.id = t.rekening_id
           JOIN anggota a ON a.id = r.anggota_id
           JOIN produk_simpanan p ON p.id = r.produk_id
          ${w.where()}
          ORDER BY t.tanggal, t.id`, w.params);
      const rekap = JENIS_TRX_SIMPANAN.map((j) => {
        const b = data.filter((r) => r.jenis === j);
        return { jenis: LABEL_TRX_SIMPANAN[j] || teks(j), jumlah: b.length, kredit: jumlah(b, 'kredit'), debit: jumlah(b, 'debit') };
      }).filter((r) => r.jumlah);
      const masuk = jumlah(data, 'kredit');
      const keluar = jumlah(data, 'debit');
      return {
        subjudul: teksPeriode(f),
        ringkasan: [
          { label: 'Jumlah transaksi', nilai: data.length, tipe: 'angka' },
          { label: 'Total masuk (kredit)', nilai: masuk, tipe: 'uang' },
          { label: 'Total keluar (debit)', nilai: keluar, tipe: 'uang' },
          { label: 'Mutasi bersih', nilai: masuk - keluar, tipe: 'uang' },
        ],
        bagian: [
          {
            kolom: [KOLOM_NO, tgl('tanggal', 'Tanggal'), kol('nomor', 'No. Transaksi'), kol('nomor_rekening', 'No. Rekening'),
              kol('nama', 'Anggota'), kol('produk', 'Produk'), kol('jenis', 'Jenis'), kol('metode', 'Metode'),
              uang('kredit', 'Masuk'), uang('debit', 'Keluar'), kol('status', 'Status'), kol('petugas', 'Petugas'),
              kol('keterangan', 'Keterangan')],
            baris: bernomor(data.map((r) => ({ ...r, jenis: LABEL_TRX_SIMPANAN[r.jenis] || teks(r.jenis),
              metode: teks(r.metode), status: r.status === 'batal' ? 'Batal' : 'Posted' }))),
            total: jumlahkan(data, ['kredit', 'debit']),
          },
          {
            judul: 'Rekap per Jenis Transaksi',
            kolom: [kol('jenis', 'Jenis'), angka('jumlah', 'Jumlah Transaksi'), uang('kredit', 'Masuk'), uang('debit', 'Keluar')],
            baris: rekap,
            total: jumlahkan(rekap, ['jumlah', 'kredit', 'debit']),
          },
        ],
        catatan: f.tampil === 'berlaku' ? undefined
          : 'Transaksi batal dinetralkan oleh transaksi koreksi; keduanya bersama-sama tidak mengubah saldo.',
      };
    },
  },

  {
    kode: 'rekap-simpanan-produk',
    judul: 'Rekapitulasi Simpanan per Produk',
    izin: 'simpanan.view',
    jenis_ttd: 'laporan',
    orientasi: 'landscape',
    deskripsi: 'Saldo awal, setoran, penarikan, jasa, pindah buku, dan saldo akhir setiap produk simpanan dalam suatu periode.',
    filter: [
      ...periode(),
      pilih('jenis', 'Jenis simpanan', JENIS_SIMPANAN),
      pilih('cabang_id', 'Cabang', opsiCabang),
    ],
    susun(f) {
      const dari = f.dari || AWAL;
      const sampai = f.sampai || AKHIR;
      const w = kondisi().sama('p.jenis', f.jenis);
      const cab = f.cabang_id ? 'AND r.cabang_id = ?' : '';
      const baris = all(
        `SELECT p.kode, p.nama AS produk, p.jenis,
                COUNT(CASE WHEN r.tanggal_buka <= ? THEN 1 END) AS rekening,
                COALESCE(SUM(r.saldo - COALESCE(x.sejak_dari, 0)), 0) AS saldo_awal,
                COALESCE(SUM(x.setoran), 0) AS setoran,
                COALESCE(SUM(x.penarikan), 0) AS penarikan,
                COALESCE(SUM(x.jasa), 0) AS jasa,
                COALESCE(SUM(x.neto - x.setoran + x.penarikan - x.jasa), 0) AS lainnya,
                COALESCE(SUM(r.saldo - COALESCE(x.sesudah, 0)), 0) AS saldo_akhir
           FROM produk_simpanan p
           LEFT JOIN rekening_simpanan r ON r.produk_id = p.id ${cab}
           LEFT JOIN (
             SELECT t.rekening_id,
                    SUM(CASE WHEN t.tanggal >= ? THEN t.kredit - t.debit ELSE 0 END) AS sejak_dari,
                    SUM(CASE WHEN t.tanggal > ? THEN t.kredit - t.debit ELSE 0 END) AS sesudah,
                    SUM(CASE WHEN t.tanggal BETWEEN ? AND ? AND t.jenis = 'setoran' THEN t.kredit ELSE 0 END) AS setoran,
                    SUM(CASE WHEN t.tanggal BETWEEN ? AND ? AND t.jenis = 'penarikan' THEN t.debit ELSE 0 END) AS penarikan,
                    SUM(CASE WHEN t.tanggal BETWEEN ? AND ? AND t.jenis = 'bunga' THEN t.kredit ELSE 0 END) AS jasa,
                    SUM(CASE WHEN t.tanggal BETWEEN ? AND ? THEN t.kredit - t.debit ELSE 0 END) AS neto
               FROM transaksi_simpanan t WHERE ${TRX_BERLAKU} GROUP BY t.rekening_id
           ) x ON x.rekening_id = r.id
          ${w.where()}
          GROUP BY p.id ORDER BY p.kode`,
        [sampai, ...(f.cabang_id ? [f.cabang_id] : []), dari, sampai, dari, sampai, dari, sampai, dari, sampai,
          dari, sampai, ...w.params],
      ).map((r) => ({ ...r, jenis: teks(r.jenis) }));
      const t = jumlahkan(baris, ['rekening', 'saldo_awal', 'setoran', 'penarikan', 'jasa', 'lainnya', 'saldo_akhir']);
      return {
        subjudul: teksPeriode(f),
        ringkasan: [
          { label: 'Saldo awal', nilai: t.saldo_awal, tipe: 'uang' },
          { label: 'Setoran', nilai: t.setoran, tipe: 'uang' },
          { label: 'Penarikan', nilai: t.penarikan, tipe: 'uang' },
          { label: 'Jasa simpanan', nilai: t.jasa, tipe: 'uang' },
          { label: 'Saldo akhir', nilai: t.saldo_akhir, tipe: 'uang' },
        ],
        bagian: [{
          kolom: [KOLOM_NO, kol('kode', 'Kode'), kol('produk', 'Produk'), kol('jenis', 'Jenis'), angka('rekening', 'Rekening'),
            uang('saldo_awal', 'Saldo Awal'), uang('setoran', 'Setoran'), uang('penarikan', 'Penarikan'),
            uang('jasa', 'Jasa'), uang('lainnya', 'Pindah Buku/Lain'), uang('saldo_akhir', 'Saldo Akhir')],
          baris: bernomor(baris),
          total: t,
        }],
        catatan: 'Saldo akhir = saldo awal + setoran - penarikan + jasa ± pindah buku/lain. '
          + 'Transaksi yang dibatalkan beserta koreksinya tidak diperhitungkan.',
      };
    },
  },

  {
    kode: 'simpanan-anggota',
    judul: 'Rekap Simpanan per Anggota',
    izin: 'simpanan.view',
    jenis_ttd: 'laporan',
    orientasi: 'landscape',
    deskripsi: 'Saldo simpanan pokok, wajib, sukarela, berjangka, dan deposito setiap anggota per tanggal tertentu.',
    filter: [
      perTanggal('Saldo per tanggal'),
      ...rentang('anggota', 'Nomor anggota'),
      pilih('status', 'Status anggota', STATUS_ANGGOTA),
      pilih('cabang_id', 'Cabang', opsiCabang),
      filterTanpaNol('Sembunyikan anggota bersaldo nol'),
    ],
    susun(f) {
      const per = f.sampai;
      const w = kondisi().rentang('a.nomor_anggota', f, 'anggota')
        .sama('a.status', f.status).sama('a.cabang_id', f.cabang_id);
      const kolomJenis = JENIS_SIMPANAN.map((j) =>
        `SUM(CASE WHEN p.jenis = '${j}' THEN r.saldo - COALESCE(s.mutasi, 0) ELSE 0 END) AS ${j}`).join(',\n');
      let data = all(
        `SELECT a.nomor_anggota, a.nama, a.status, c.nama AS cabang, ${kolomJenis},
                SUM(r.saldo - COALESCE(s.mutasi, 0)) AS total
           FROM rekening_simpanan r
           JOIN anggota a ON a.id = r.anggota_id
           JOIN produk_simpanan p ON p.id = r.produk_id
           LEFT JOIN cabang c ON c.id = a.cabang_id
           LEFT JOIN ${MUTASI_SESUDAH} s ON s.rekening_id = r.id
          ${w.where()}
          GROUP BY a.id
         HAVING MIN(r.tanggal_buka) <= ? OR total <> 0
          ORDER BY a.nomor_anggota`, [per, ...w.params, per]);
      if (f.tanpa_nol === 'ya') data = data.filter((r) => r.total !== 0);
      const kunci = [...JENIS_SIMPANAN, 'total'];
      const t = jumlahkan(data, kunci);
      return {
        subjudul: teksPer(per),
        ringkasan: [
          { label: 'Jumlah anggota', nilai: data.length, tipe: 'angka' },
          ...JENIS_SIMPANAN.filter((j) => t[j]).map((j) => ({ label: `Simpanan ${j}`, nilai: t[j], tipe: 'uang' })),
          { label: 'Total simpanan', nilai: t.total, tipe: 'uang' },
        ],
        bagian: [{
          kolom: [KOLOM_NO, kol('nomor_anggota', 'No. Anggota'), kol('nama', 'Nama'), kol('cabang', 'Cabang'),
            kol('status', 'Status'), ...JENIS_SIMPANAN.map((j) => uang(j, teks(j))), uang('total', 'Total')],
          baris: bernomor(data.map((r) => ({ ...r, status: teks(r.status) }))),
          total: t,
        }],
      };
    },
  },

  {
    kode: 'jasa-simpanan',
    judul: 'Jasa Simpanan',
    izin: 'simpanan.view',
    jenis_ttd: 'laporan',
    orientasi: 'landscape',
    deskripsi: 'Jasa (bunga) simpanan yang dibukukan ke rekening anggota dalam suatu periode, per rekening dan per bulan.',
    filter: [
      ...periode(),
      pilih('produk_id', 'Produk simpanan', opsiProdukSimpanan),
      pilih('cabang_id', 'Cabang', opsiCabang),
      ...rentang('anggota', 'Nomor anggota'),
    ],
    susun(f) {
      const w = kondisi().tambah("t.jenis = 'bunga'").tambah(TRX_BERLAKU).periode('t.tanggal', f)
        .sama('r.produk_id', f.produk_id).sama('r.cabang_id', f.cabang_id).rentang('a.nomor_anggota', f, 'anggota');
      const dari = `FROM transaksi_simpanan t
           JOIN rekening_simpanan r ON r.id = t.rekening_id
           JOIN anggota a ON a.id = r.anggota_id
           JOIN produk_simpanan p ON p.id = r.produk_id
          ${w.where()}`;
      const perRekening = all(
        `SELECT r.nomor_rekening, a.nomor_anggota, a.nama, p.nama AS produk, p.bunga_tahunan,
                COUNT(*) AS kali, SUM(t.kredit) AS jasa
           ${dari} GROUP BY r.id ORDER BY r.nomor_rekening`, w.params);
      const perBulan = all(
        `SELECT substr(t.tanggal, 1, 7) AS bulan, p.nama AS produk, COUNT(DISTINCT r.id) AS rekening, SUM(t.kredit) AS jasa
           ${dari} GROUP BY bulan, p.id ORDER BY bulan, p.kode`, w.params);
      return {
        subjudul: teksPeriode(f),
        ringkasan: [
          { label: 'Rekening penerima jasa', nilai: perRekening.length, tipe: 'angka' },
          { label: 'Anggota penerima jasa', nilai: new Set(perRekening.map((r) => r.nomor_anggota)).size, tipe: 'angka' },
          { label: 'Total jasa simpanan', nilai: jumlah(perRekening, 'jasa'), tipe: 'uang' },
        ],
        bagian: [
          {
            judul: 'Per Rekening',
            kolom: [KOLOM_NO, kol('nomor_rekening', 'No. Rekening'), kol('nomor_anggota', 'No. Anggota'), kol('nama', 'Nama'),
              kol('produk', 'Produk'), kol('bunga_tahunan', 'Jasa p.a.', 'persen'), angka('kali', 'Kali Posting'),
              uang('jasa', 'Jumlah Jasa')],
            baris: bernomor(perRekening),
            total: jumlahkan(perRekening, ['kali', 'jasa']),
          },
          {
            judul: 'Per Bulan & Produk',
            kolom: [kol('bulan', 'Bulan'), kol('produk', 'Produk'), angka('rekening', 'Rekening'), uang('jasa', 'Jumlah Jasa')],
            baris: perBulan,
            total: jumlahkan(perBulan, ['jasa']),
          },
        ],
      };
    },
  },

  {
    kode: 'simpanan-jatuh-tempo',
    judul: 'Simpanan Berjangka & Deposito Jatuh Tempo',
    izin: 'simpanan.view',
    jenis_ttd: 'laporan',
    orientasi: 'landscape',
    deskripsi: 'Rekening simpanan berjangka/deposito menurut tanggal jatuh tempo, lengkap dengan sisa hari dan saldo.',
    filter: [
      ...periode({ label: 'Jatuh tempo' }),
      pilih('produk_id', 'Produk simpanan', opsiProdukSimpanan),
      pilih('cabang_id', 'Cabang', opsiCabang),
      pilih('status', 'Status rekening', ['aktif', 'blokir', 'tutup']),
      ...rentang('anggota', 'Nomor anggota'),
    ],
    susun(f) {
      const hariIni = today();
      const w = kondisi().tambah('r.tanggal_jatuh_tempo IS NOT NULL').periode('r.tanggal_jatuh_tempo', f)
        .sama('r.produk_id', f.produk_id).sama('r.cabang_id', f.cabang_id).sama('r.status', f.status)
        .rentang('a.nomor_anggota', f, 'anggota');
      const data = all(
        `SELECT r.nomor_rekening, a.nomor_anggota, a.nama, a.telepon, p.nama AS produk, p.bunga_tahunan,
                r.tanggal_buka, r.tanggal_jatuh_tempo, r.saldo, r.saldo_blokir, r.status,
                CAST(julianday(r.tanggal_jatuh_tempo) - julianday(?) AS INTEGER) AS sisa_hari
           FROM rekening_simpanan r
           JOIN anggota a ON a.id = r.anggota_id
           JOIN produk_simpanan p ON p.id = r.produk_id
          ${w.where()}
          ORDER BY r.tanggal_jatuh_tempo, r.nomor_rekening`, [hariIni, ...w.params]);
      return {
        subjudul: teksPeriode(f, 'Jatuh tempo'),
        ringkasan: [
          { label: 'Jumlah rekening', nilai: data.length, tipe: 'angka' },
          { label: 'Sudah jatuh tempo', nilai: data.filter((r) => r.sisa_hari <= 0).length, tipe: 'angka' },
          { label: 'Total saldo', nilai: jumlah(data, 'saldo'), tipe: 'uang' },
        ],
        bagian: [{
          kolom: [KOLOM_NO, kol('nomor_rekening', 'No. Rekening'), kol('nomor_anggota', 'No. Anggota'), kol('nama', 'Nama'),
            kol('telepon', 'Telepon'), kol('produk', 'Produk'), kol('bunga_tahunan', 'Jasa p.a.', 'persen'),
            tgl('tanggal_buka', 'Tgl Buka'), tgl('tanggal_jatuh_tempo', 'Jatuh Tempo'), angka('sisa_hari', 'Sisa Hari'),
            uang('saldo_blokir', 'Diblokir'), uang('saldo', 'Saldo'), kol('status', 'Status')],
          baris: bernomor(data.map((r) => ({ ...r, status: teks(r.status) }))),
          total: jumlahkan(data, ['saldo_blokir', 'saldo']),
        }],
        catatan: `Sisa hari dihitung terhadap ${tanggalPanjang(hariIni)}; nilai negatif berarti sudah lewat jatuh tempo. `
          + 'Saldo adalah saldo rekening saat ini.',
      };
    },
  },

  // ============================== PINJAMAN ==============================
  {
    kode: 'register-pinjaman',
    judul: 'Register Pinjaman',
    izin: 'pinjaman.view',
    jenis_ttd: 'laporan',
    orientasi: 'landscape',
    deskripsi: 'Daftar pengajuan atau pencairan pinjaman per periode menurut status, produk, cabang, dan rentang nomor.',
    filter: [
      { ...pilih('dasar', 'Dasar tanggal', [
        { nilai: 'pengajuan', teks: 'Tanggal pengajuan' }, { nilai: 'pencairan', teks: 'Tanggal pencairan' },
      ]), bawaan: 'pengajuan' },
      ...periode(),
      pilih('status', 'Status', STATUS_PINJAMAN),
      ...filterPinjaman(),
    ],
    susun(f) {
      const kolomTgl = f.dasar === 'pencairan' ? 'p.tanggal_cair' : 'p.tanggal_pengajuan';
      const w = kondisiPinjaman(kondisi(), f).periode(kolomTgl, f).sama('p.status', f.status);
      if (f.dasar === 'pencairan') w.tambah('p.tanggal_cair IS NOT NULL');
      const data = all(
        `SELECT p.nomor, p.tanggal_pengajuan, p.tanggal_cair, a.nomor_anggota, a.nama, pr.nama AS produk,
                c.nama AS cabang, p.pokok, p.tenor, p.bunga_tahunan, p.metode_bunga, p.angsuran_total,
                p.status, p.outstanding_pokok, p.tujuan
           FROM pinjaman p
           JOIN anggota a ON a.id = p.anggota_id
           JOIN produk_pinjaman pr ON pr.id = p.produk_id
           LEFT JOIN cabang c ON c.id = p.cabang_id
          ${w.where()}
          ORDER BY ${kolomTgl}, p.nomor`, w.params);
      const cair = data.filter((r) => r.tanggal_cair);
      return {
        subjudul: teksPeriode(f, f.dasar === 'pencairan' ? 'Pencairan' : 'Pengajuan'),
        ringkasan: [
          { label: 'Jumlah pinjaman', nilai: data.length, tipe: 'angka' },
          { label: 'Total plafon', nilai: jumlah(data, 'pokok'), tipe: 'uang' },
          { label: 'Sudah dicairkan', nilai: cair.length, tipe: 'angka' },
          { label: 'Nilai pencairan', nilai: jumlah(cair, 'pokok'), tipe: 'uang' },
          { label: 'Ditolak / batal', nilai: data.filter((r) => ['ditolak', 'batal'].includes(r.status)).length, tipe: 'angka' },
          { label: 'Sisa pokok saat ini', nilai: jumlah(data, 'outstanding_pokok'), tipe: 'uang' },
        ],
        bagian: [{
          kolom: [KOLOM_NO, kol('nomor', 'No. Pinjaman'), tgl('tanggal_pengajuan', 'Tgl Pengajuan'), tgl('tanggal_cair', 'Tgl Cair'),
            kol('nomor_anggota', 'No. Anggota'), kol('nama', 'Nama'), kol('produk', 'Produk'), uang('pokok', 'Plafon'),
            angka('tenor', 'Tenor (bln)'), kol('bunga_tahunan', 'Bunga p.a.', 'persen'), kol('metode_bunga', 'Metode'),
            uang('angsuran_total', 'Angsuran/bln'), kol('status', 'Status'), uang('outstanding_pokok', 'Sisa Pokok')],
          baris: bernomor(data.map((r) => ({ ...r, status: teks(r.status), metode_bunga: teks(r.metode_bunga) }))),
          total: jumlahkan(data, ['pokok', 'outstanding_pokok']),
        }],
      };
    },
  },

  {
    kode: 'outstanding-pinjaman',
    judul: 'Outstanding & Kolektibilitas Pinjaman',
    izin: 'pinjaman.view',
    jenis_ttd: 'laporan',
    orientasi: 'landscape',
    deskripsi: 'Sisa pokok, tunggakan, hari tunggakan, dan kolektibilitas setiap pinjaman berjalan per tanggal tertentu.',
    filter: [
      perTanggal(),
      pilih('kolektibilitas', 'Kolektibilitas', opsiKolektibilitas),
      ...filterPinjaman(),
    ],
    susun(f) {
      const data = portofolioPer(f.sampai, f);
      const total = jumlah(data, 'outstanding');
      const npl = jumlah(data.filter((r) => r.kolektibilitas >= 3), 'outstanding');
      return {
        subjudul: teksPer(f.sampai),
        ringkasan: [
          { label: 'Jumlah pinjaman', nilai: data.length, tipe: 'angka' },
          { label: 'Total outstanding pokok', nilai: total, tipe: 'uang' },
          { label: 'Total tunggakan', nilai: jumlah(data, 'tunggakan'), tipe: 'uang' },
          { label: 'NPL (kolektibilitas 3-5)', nilai: npl, tipe: 'uang' },
          { label: 'Rasio NPL', nilai: persen(npl, total), tipe: 'persen' },
        ],
        bagian: [{
          kolom: [KOLOM_NO, kol('nomor', 'No. Pinjaman'), kol('nomor_anggota', 'No. Anggota'), kol('nama', 'Nama'),
            kol('produk', 'Produk'), tgl('tanggal_cair', 'Tgl Cair'), tgl('jatuh_tempo_akhir', 'Jatuh Tempo Akhir'),
            uang('pokok', 'Plafon'), uang('outstanding', 'Outstanding Pokok'), uang('tunggakan', 'Tunggakan'),
            angka('hari_tunggak', 'Hari Tunggak'), angka('kolektibilitas', 'Kol.'), kol('kategori', 'Kategori')],
          baris: bernomor(data),
          total: jumlahkan(data, ['pokok', 'outstanding', 'tunggakan']),
        }],
        catatan: 'Tunggakan = angsuran pokok + jasa yang jatuh tempo sebelum tanggal laporan dikurangi pembayaran s.d. tanggal laporan. '
          + 'Kolektibilitas: 1 Lancar (0 hari), 2 DPK (1-90), 3 Kurang Lancar (91-180), 4 Diragukan (181-270), 5 Macet (>270).',
      };
    },
  },

  {
    kode: 'npl-kolektibilitas',
    judul: 'Rekapitulasi Kolektibilitas & NPL',
    izin: 'pinjaman.view',
    jenis_ttd: 'laporan',
    deskripsi: 'Outstanding pinjaman per kolektibilitas dan per produk beserta rasio NPL pada tanggal tertentu.',
    filter: [perTanggal(), pilih('produk_id', 'Produk pinjaman', opsiProdukPinjaman), pilih('cabang_id', 'Cabang', opsiCabang)],
    susun(f) {
      const data = portofolioPer(f.sampai, f);
      const total = jumlah(data, 'outstanding');
      const npl = jumlah(data.filter((r) => r.kolektibilitas >= 3), 'outstanding');
      const perKol = [1, 2, 3, 4, 5].map((k) => {
        const b = data.filter((r) => r.kolektibilitas === k);
        const o = jumlah(b, 'outstanding');
        return { kolektibilitas: k, kategori: LABEL_KOLEKTIBILITAS[k], jumlah: b.length, outstanding: o,
          tunggakan: jumlah(b, 'tunggakan'), persen: persen(o, total) };
      });
      const produk = [...new Set(data.map((r) => r.produk))].sort().map((nama) => {
        const b = data.filter((r) => r.produk === nama);
        const o = jumlah(b, 'outstanding');
        const n = jumlah(b.filter((r) => r.kolektibilitas >= 3), 'outstanding');
        return { produk: nama, jumlah: b.length, outstanding: o,
          lancar: jumlah(b.filter((r) => r.kolektibilitas === 1), 'outstanding'),
          dpk: jumlah(b.filter((r) => r.kolektibilitas === 2), 'outstanding'),
          npl: n, rasio: persen(n, o) };
      });
      const rasio = persen(npl, total);
      return {
        subjudul: teksPer(f.sampai),
        ringkasan: [
          { label: 'Jumlah pinjaman berjalan', nilai: data.length, tipe: 'angka' },
          { label: 'Total outstanding pokok', nilai: total, tipe: 'uang' },
          { label: 'NPL (kolektibilitas 3-5)', nilai: npl, tipe: 'uang' },
          { label: 'Rasio NPL', nilai: rasio, tipe: 'persen' },
          { label: 'Status kesehatan', nilai: kesehatanNpl(rasio, total) },
        ],
        bagian: [
          {
            judul: 'Per Kolektibilitas',
            kolom: [angka('kolektibilitas', 'Kol.'), kol('kategori', 'Kategori'), angka('jumlah', 'Jumlah Pinjaman'),
              uang('outstanding', 'Outstanding Pokok'), uang('tunggakan', 'Tunggakan'), kol('persen', '% Outstanding', 'persen')],
            baris: perKol,
            total: { ...jumlahkan(perKol, ['jumlah', 'outstanding', 'tunggakan']), persen: total ? 100 : 0 },
          },
          {
            judul: 'Per Produk',
            kolom: [KOLOM_NO, kol('produk', 'Produk'), angka('jumlah', 'Jumlah'), uang('outstanding', 'Outstanding'),
              uang('lancar', 'Lancar'), uang('dpk', 'DPK'), uang('npl', 'NPL'), kol('rasio', 'Rasio NPL', 'persen')],
            baris: bernomor(produk),
            total: { ...jumlahkan(produk, ['jumlah', 'outstanding', 'lancar', 'dpk', 'npl']), rasio },
          },
        ],
        catatan: 'NPL (non performing loan) = outstanding berkolektibilitas Kurang Lancar, Diragukan, dan Macet. '
          + 'Sehat bila rasio NPL < 5%, cukup sehat < 10%.',
      };
    },
  },

  {
    kode: 'angsuran-diterima',
    judul: 'Penerimaan Angsuran Pinjaman',
    izin: 'pinjaman.view',
    jenis_ttd: 'laporan',
    orientasi: 'landscape',
    deskripsi: 'Angsuran dan pelunasan yang diterima per periode, dirinci atas pokok, jasa, dan denda.',
    filter: [
      ...periode(),
      pilih('jenis', 'Jenis pembayaran', [{ nilai: 'angsuran', teks: 'Angsuran' },
        { nilai: 'pelunasan_dipercepat', teks: 'Pelunasan dipercepat' }]),
      pilih('metode', 'Metode', ['tunai', 'transfer', 'potong_gaji', 'pindah_buku']),
      ...filterPinjaman(),
    ],
    susun(f) {
      const w = kondisiPinjaman(kondisi(), f).periode('g.tanggal', f).sama('g.jenis', f.jenis).sama('g.metode', f.metode)
        .tambah("g.status <> 'batal'");
      const data = all(
        `SELECT g.tanggal, g.nomor AS bukti, p.nomor, a.nomor_anggota, a.nama, pr.nama AS produk, g.angsuran_ke,
                g.bayar_pokok, g.bayar_bunga, g.bayar_denda, g.total_bayar, g.metode, g.jenis, g.petugas
           FROM pinjaman_angsuran g
           JOIN pinjaman p ON p.id = g.pinjaman_id
           JOIN anggota a ON a.id = p.anggota_id
           JOIN produk_pinjaman pr ON pr.id = p.produk_id
          ${w.where()}
          ORDER BY g.tanggal, g.id`, w.params);
      const t = jumlahkan(data, ['bayar_pokok', 'bayar_bunga', 'bayar_denda', 'total_bayar']);
      return {
        subjudul: teksPeriode(f),
        ringkasan: [
          { label: 'Jumlah transaksi', nilai: data.length, tipe: 'angka' },
          { label: 'Jumlah peminjam', nilai: new Set(data.map((r) => r.nomor_anggota)).size, tipe: 'angka' },
          { label: 'Pokok', nilai: t.bayar_pokok, tipe: 'uang' },
          { label: 'Jasa pinjaman', nilai: t.bayar_bunga, tipe: 'uang' },
          { label: 'Denda', nilai: t.bayar_denda, tipe: 'uang' },
          { label: 'Total diterima', nilai: t.total_bayar, tipe: 'uang' },
        ],
        bagian: [{
          kolom: [KOLOM_NO, tgl('tanggal', 'Tanggal'), kol('bukti', 'No. Bukti'), kol('nomor', 'No. Pinjaman'),
            kol('nama', 'Anggota'), kol('produk', 'Produk'), angka('angsuran_ke', 'Ke'), uang('bayar_pokok', 'Pokok'),
            uang('bayar_bunga', 'Jasa'), uang('bayar_denda', 'Denda'), uang('total_bayar', 'Total'),
            kol('metode', 'Metode'), kol('jenis', 'Jenis'), kol('petugas', 'Petugas')],
          baris: bernomor(data.map((r) => ({ ...r, metode: teks(r.metode), jenis: teks(r.jenis) }))),
          total: t,
        }],
      };
    },
  },

  {
    kode: 'tagihan-tunggakan',
    judul: 'Tagihan Jatuh Tempo & Tunggakan Angsuran',
    izin: 'pinjaman.view',
    jenis_ttd: 'laporan',
    orientasi: 'landscape',
    deskripsi: 'Angsuran yang belum lunas dengan jatuh tempo s.d. tanggal tertentu, untuk penagihan: sisa tagihan, hari telat, dan kolektibilitas.',
    filter: [
      { kunci: 'dari', label: 'Jatuh tempo dari', tipe: 'tanggal' },
      { kunci: 'sampai', label: 'Jatuh tempo s.d.', tipe: 'tanggal', bawaan: today },
      pilih('kategori', 'Kategori', [{ nilai: 'tertunggak', teks: 'Tertunggak' },
        { nilai: 'akan_jatuh_tempo', teks: 'Belum / hari ini jatuh tempo' }]),
      pilih('kolektibilitas', 'Kolektibilitas', opsiKolektibilitas),
      ...filterPinjaman(),
    ],
    susun(f) {
      const hariIni = today();
      const w = kondisiPinjaman(kondisi(), f)
        .tambah("j.status <> 'lunas' AND p.status IN ('dicairkan','restrukturisasi')")
        .periode('j.jatuh_tempo', f).sama('p.kolektibilitas', f.kolektibilitas);
      if (f.kategori === 'tertunggak') w.tambah('j.jatuh_tempo < ?', hariIni);
      if (f.kategori === 'akan_jatuh_tempo') w.tambah('j.jatuh_tempo >= ?', hariIni);
      const data = all(
        `SELECT p.nomor, a.nomor_anggota, a.nama, a.telepon, pr.nama AS produk, j.angsuran_ke, j.jatuh_tempo,
                j.pokok, j.bunga, j.total, j.bayar_pokok + j.bayar_bunga AS dibayar,
                j.total - j.bayar_pokok - j.bayar_bunga AS sisa,
                MAX(0, CAST(julianday(?) - julianday(j.jatuh_tempo) AS INTEGER)) AS hari_telat,
                p.kolektibilitas
           FROM pinjaman_jadwal j
           JOIN pinjaman p ON p.id = j.pinjaman_id
           JOIN anggota a ON a.id = p.anggota_id
           JOIN produk_pinjaman pr ON pr.id = p.produk_id
          ${w.where()}
          ORDER BY j.jatuh_tempo, a.nama, j.angsuran_ke`, [hariIni, ...w.params])
        .map((r) => ({ ...r, kategori: r.jatuh_tempo < hariIni ? 'Tertunggak' : 'Jatuh tempo' }));
      const tertunggak = data.filter((r) => r.jatuh_tempo < hariIni);
      return {
        subjudul: teksPeriode(f, 'Jatuh tempo'),
        ringkasan: [
          { label: 'Jumlah angsuran', nilai: data.length, tipe: 'angka' },
          { label: 'Jumlah peminjam', nilai: new Set(data.map((r) => r.nomor_anggota)).size, tipe: 'angka' },
          { label: 'Total sisa tagihan', nilai: jumlah(data, 'sisa'), tipe: 'uang' },
          { label: 'Di antaranya tertunggak', nilai: jumlah(tertunggak, 'sisa'), tipe: 'uang' },
        ],
        bagian: [{
          kolom: [KOLOM_NO, kol('nomor', 'No. Pinjaman'), kol('nomor_anggota', 'No. Anggota'), kol('nama', 'Nama'),
            kol('telepon', 'Telepon'), kol('produk', 'Produk'), angka('angsuran_ke', 'Ke'), tgl('jatuh_tempo', 'Jatuh Tempo'),
            uang('pokok', 'Pokok'), uang('bunga', 'Jasa'), uang('total', 'Angsuran'), uang('dibayar', 'Dibayar'),
            uang('sisa', 'Sisa Tagihan'), angka('hari_telat', 'Hari Telat'), kol('kategori', 'Kategori'),
            angka('kolektibilitas', 'Kol.')],
          baris: bernomor(data),
          total: jumlahkan(data, ['pokok', 'bunga', 'total', 'dibayar', 'sisa']),
        }],
        catatan: `Hari telat dihitung terhadap ${tanggalPanjang(hariIni)}. Denda keterlambatan dihitung saat pembayaran.`,
      };
    },
  },

  {
    kode: 'pinjaman-lunas',
    judul: 'Pinjaman Lunas',
    izin: 'pinjaman.view',
    jenis_ttd: 'laporan',
    orientasi: 'landscape',
    deskripsi: 'Pinjaman yang lunas (normal/dipercepat) atau dialihkan karena restrukturisasi dalam suatu periode.',
    filter: [
      ...periode({ label: 'Tanggal lunas' }),
      pilih('cara', 'Cara pelunasan', [{ nilai: 'normal', teks: 'Lunas normal' },
        { nilai: 'dipercepat', teks: 'Pelunasan dipercepat' }, { nilai: 'restrukturisasi', teks: 'Dialihkan (restrukturisasi)' }]),
      ...filterPinjaman(),
    ],
    susun(f) {
      const w = kondisiPinjaman(kondisi(), f).tambah("p.status IN ('lunas','restrukturisasi') AND p.tanggal_lunas IS NOT NULL")
        .periode('p.tanggal_lunas', f);
      let data = all(
        `SELECT p.nomor, a.nomor_anggota, a.nama, pr.nama AS produk, p.tanggal_cair, p.tanggal_lunas, p.pokok, p.tenor,
                p.status, COALESCE(b.pokok, 0) AS bayar_pokok, COALESCE(b.bunga, 0) AS bayar_bunga,
                COALESCE(b.denda, 0) AS bayar_denda, COALESCE(b.dipercepat, 0) AS dipercepat
           FROM pinjaman p
           JOIN anggota a ON a.id = p.anggota_id
           JOIN produk_pinjaman pr ON pr.id = p.produk_id
           LEFT JOIN (SELECT pinjaman_id, SUM(bayar_pokok) AS pokok, SUM(bayar_bunga) AS bunga, SUM(bayar_denda) AS denda,
                             MAX(jenis = 'pelunasan_dipercepat') AS dipercepat
                        FROM pinjaman_angsuran WHERE status <> 'batal' GROUP BY pinjaman_id) b ON b.pinjaman_id = p.id
          ${w.where()}
          ORDER BY p.tanggal_lunas, p.nomor`, w.params)
        .map((r) => {
          const cara = r.status === 'restrukturisasi' ? 'restrukturisasi' : r.dipercepat ? 'dipercepat' : 'normal';
          return { ...r, cara, teks_cara: { normal: 'Lunas normal', dipercepat: 'Pelunasan dipercepat',
            restrukturisasi: 'Dialihkan (restrukturisasi)' }[cara],
          dialihkan: cara === 'restrukturisasi' ? r.pokok - r.bayar_pokok : 0 };
        });
      if (f.cara) data = data.filter((r) => r.cara === f.cara);
      const t = jumlahkan(data, ['pokok', 'bayar_pokok', 'bayar_bunga', 'bayar_denda', 'dialihkan']);
      return {
        subjudul: teksPeriode(f, 'Lunas'),
        ringkasan: [
          { label: 'Jumlah pinjaman', nilai: data.length, tipe: 'angka' },
          { label: 'Total plafon', nilai: t.pokok, tipe: 'uang' },
          { label: 'Jasa diterima', nilai: t.bayar_bunga, tipe: 'uang' },
          { label: 'Denda diterima', nilai: t.bayar_denda, tipe: 'uang' },
        ],
        bagian: [{
          kolom: [KOLOM_NO, kol('nomor', 'No. Pinjaman'), kol('nomor_anggota', 'No. Anggota'), kol('nama', 'Nama'),
            kol('produk', 'Produk'), tgl('tanggal_cair', 'Tgl Cair'), tgl('tanggal_lunas', 'Tgl Lunas'), uang('pokok', 'Plafon'),
            angka('tenor', 'Tenor'), uang('bayar_pokok', 'Pokok Dibayar'), uang('bayar_bunga', 'Jasa Dibayar'),
            uang('bayar_denda', 'Denda'), uang('dialihkan', 'Dialihkan'), kol('teks_cara', 'Cara')],
          baris: bernomor(data),
          total: t,
        }],
      };
    },
  },

  {
    kode: 'jadwal-angsuran',
    judul: 'Jadwal Angsuran Pinjaman',
    izin: 'pinjaman.view',
    jenis_ttd: 'laporan',
    orientasi: 'landscape',
    deskripsi: 'Jadwal angsuran dan realisasi pembayaran per pinjaman (isi nomor pinjaman; isi juga "s.d." untuk beberapa pinjaman).',
    filter: [
      { kunci: 'pinjaman_dari', label: 'Nomor pinjaman', tipe: 'teks', wajib: true },
      { kunci: 'pinjaman_sampai', label: 'S.d. nomor pinjaman', tipe: 'teks' },
    ],
    susun(f) {
      const w = kondisi();
      if (f.pinjaman_sampai) w.rentang('p.nomor', f, 'pinjaman');
      else w.sama('p.nomor', f.pinjaman_dari);
      const pinjaman = all(
        `SELECT p.id, p.nomor, a.nomor_anggota, a.nama, pr.nama AS produk, p.pokok, p.tenor, p.bunga_tahunan,
                p.metode_bunga, p.tanggal_cair, p.status, p.outstanding_pokok
           FROM pinjaman p JOIN anggota a ON a.id = p.anggota_id JOIN produk_pinjaman pr ON pr.id = p.produk_id
          ${w.where()} ORDER BY p.nomor`, w.params);
      if (pinjaman.length > 200) {
        throw badRequest(`Rentang nomor mencakup ${pinjaman.length} pinjaman`, 'Persempit rentang (maksimal 200 pinjaman).');
      }
      const jadwal = all(
        `SELECT j.pinjaman_id, j.angsuran_ke, j.jatuh_tempo, j.pokok, j.bunga, j.total, j.sisa_pokok,
                j.bayar_pokok, j.bayar_bunga, j.tanggal_bayar, j.status
           FROM pinjaman_jadwal j JOIN pinjaman p ON p.id = j.pinjaman_id
          ${w.where()} ORDER BY p.nomor, j.angsuran_ke`, w.params);
      const perPinjaman = new Map(pinjaman.map((p) => [p.id, []]));
      for (const j of jadwal) perPinjaman.get(j.pinjaman_id)?.push({ ...j, status: teks(j.status) });
      const rp = (n) => `Rp ${Number(n || 0).toLocaleString('id-ID')}`;
      const bagian = pinjaman.map((p) => {
        const baris = perPinjaman.get(p.id);
        return {
          judul: `${p.nomor} — ${p.nama} (${p.nomor_anggota}) · ${p.produk} · ${rp(p.pokok)} · ${p.tenor} bln · `
            + `${p.bunga_tahunan}% p.a. ${teks(p.metode_bunga).toLowerCase()} · ${teks(p.status)}`,
          kolom: [angka('angsuran_ke', 'Ke'), tgl('jatuh_tempo', 'Jatuh Tempo'), uang('pokok', 'Pokok'), uang('bunga', 'Jasa'),
            uang('total', 'Angsuran'), uang('sisa_pokok', 'Sisa Pokok (rencana)'), uang('bayar_pokok', 'Bayar Pokok'),
            uang('bayar_bunga', 'Bayar Jasa'), tgl('tanggal_bayar', 'Tgl Lunas'), kol('status', 'Status')],
          baris,
          total: { ...jumlahkan(baris, ['pokok', 'bunga', 'total', 'bayar_pokok', 'bayar_bunga']), _label: 'TOTAL' },
        };
      });
      const satu = pinjaman.length === 1 ? pinjaman[0] : null;
      return {
        subjudul: satu ? `Pinjaman ${satu.nomor}` : `${pinjaman.length} pinjaman`,
        ringkasan: satu ? [
          { label: 'Nomor pinjaman', nilai: satu.nomor },
          { label: 'Anggota', nilai: `${satu.nama} (${satu.nomor_anggota})` },
          { label: 'Produk', nilai: satu.produk },
          { label: 'Plafon', nilai: satu.pokok, tipe: 'uang' },
          { label: 'Tenor', nilai: `${satu.tenor} bulan` },
          { label: 'Jasa', nilai: `${satu.bunga_tahunan}% p.a. (${teks(satu.metode_bunga).toLowerCase()})` },
          { label: 'Tanggal pencairan', nilai: satu.tanggal_cair || '-', tipe: satu.tanggal_cair ? 'tanggal' : undefined },
          { label: 'Status', nilai: teks(satu.status) },
          { label: 'Sisa pokok saat ini', nilai: satu.outstanding_pokok, tipe: 'uang' },
        ] : [{ label: 'Jumlah pinjaman', nilai: pinjaman.length, tipe: 'angka' }],
        bagian: bagian.length ? bagian : [{ kolom: [kol('info', 'Keterangan')], baris: [] }],
        catatan: pinjaman.length ? undefined : 'Pinjaman dengan nomor tersebut tidak ditemukan.',
      };
    },
  },

  // ================================= SHU =================================
  {
    kode: 'shu-anggota',
    judul: 'Rincian SHU per Anggota',
    izin: 'shu.view',
    jenis_ttd: 'shu',
    orientasi: 'landscape',
    deskripsi: 'Pembagian SHU setiap anggota per tahun buku: dasar simpanan & transaksi, jasa modal, jasa usaha, dan status pembayaran.',
    filter: [
      { ...pilih('tahun', 'Tahun buku', opsiTahunShu), bawaan: tahunShuTerakhir },
      pilih('dibayar', 'Status pembayaran', [{ nilai: '1', teks: 'Sudah dibayar' }, { nilai: '0', teks: 'Belum dibayar' }]),
      ...rentang('anggota', 'Nomor anggota'),
      pilih('cabang_id', 'Cabang', opsiCabang),
    ],
    susun(f) {
      const w = kondisi().sama('sp.tahun', f.tahun).sama('s.dibayar', f.dibayar)
        .rentang('a.nomor_anggota', f, 'anggota').sama('a.cabang_id', f.cabang_id);
      const data = all(
        `SELECT sp.tahun, a.nomor_anggota, a.nama, c.nama AS cabang, s.simpanan_rata, s.nilai_transaksi,
                s.shu_jasa_modal, s.shu_jasa_usaha, s.shu_total, s.metode_bayar, s.dibayar, s.tanggal_bayar
           FROM shu_anggota s
           JOIN shu_periode sp ON sp.id = s.periode_id
           JOIN anggota a ON a.id = s.anggota_id
           LEFT JOIN cabang c ON c.id = a.cabang_id
          ${w.where()}
          ORDER BY sp.tahun DESC, a.nomor_anggota`, w.params)
        .map((r) => ({ ...r, dibayar: r.dibayar ? 'Sudah' : 'Belum', metode_bayar: r.metode_bayar ? teks(r.metode_bayar) : '-' }));
      const periodeShu = f.tahun ? all('SELECT * FROM shu_periode WHERE tahun = ?', [f.tahun])[0] : null;
      const alokasi = periodeShu
        ? Object.fromEntries(all('SELECT komponen, nominal FROM shu_alokasi WHERE periode_id = ?', [periodeShu.id])
          .map((x) => [x.komponen, x.nominal]))
        : {};
      const t = jumlahkan(data, ['simpanan_rata', 'nilai_transaksi', 'shu_jasa_modal', 'shu_jasa_usaha', 'shu_total']);
      return {
        subjudul: f.tahun ? `Tahun Buku ${f.tahun}` : 'Seluruh tahun buku',
        ringkasan: [
          ...(periodeShu ? [
            { label: 'Status periode', nilai: teks(periodeShu.status) },
            { label: 'SHU bersih', nilai: periodeShu.shu_bersih, tipe: 'uang' },
            { label: 'Alokasi jasa modal', nilai: alokasi.jasa_modal || 0, tipe: 'uang' },
            { label: 'Alokasi jasa usaha', nilai: alokasi.jasa_usaha || 0, tipe: 'uang' },
          ] : []),
          { label: 'Jumlah anggota penerima', nilai: data.length, tipe: 'angka' },
          { label: 'Total SHU anggota', nilai: t.shu_total, tipe: 'uang' },
          { label: 'Sudah dibayar', nilai: jumlah(data.filter((r) => r.dibayar === 'Sudah'), 'shu_total'), tipe: 'uang' },
        ],
        bagian: [{
          kolom: [KOLOM_NO, ...(f.tahun ? [] : [kol('tahun', 'Tahun')]), kol('nomor_anggota', 'No. Anggota'), kol('nama', 'Nama'),
            kol('cabang', 'Cabang'), uang('simpanan_rata', 'Simpanan Rata-rata'), uang('nilai_transaksi', 'Nilai Transaksi'),
            uang('shu_jasa_modal', 'Jasa Modal'), uang('shu_jasa_usaha', 'Jasa Usaha'), uang('shu_total', 'Total SHU'),
            kol('metode_bayar', 'Dibayar Via'), kol('dibayar', 'Dibayar'), tgl('tanggal_bayar', 'Tgl Bayar')],
          baris: bernomor(data),
          total: t,
        }],
        catatan: opsiTahunShu().length ? undefined : 'Belum ada perhitungan SHU yang tersimpan.',
      };
    },
  },

  {
    kode: 'alokasi-shu',
    judul: 'Alokasi Pembagian SHU',
    izin: 'shu.view',
    jenis_ttd: 'shu',
    deskripsi: 'SHU bersih setiap tahun buku dan pembagiannya per komponen (cadangan, jasa modal, jasa usaha, dana-dana).',
    filter: [pilih('tahun', 'Tahun buku', opsiTahunShu)],
    susun(f) {
      const w = kondisi().sama('sp.tahun', f.tahun);
      const periodeShu = all(
        `SELECT sp.id, sp.tahun, sp.shu_bersih, sp.total_simpanan, sp.total_transaksi, sp.status, sp.disetujui_oleh,
                substr(sp.disetujui_pada, 1, 10) AS disetujui_pada
           FROM shu_periode sp ${w.where()} ORDER BY sp.tahun DESC`, w.params);
      const urutan = Object.fromEntries(KOMPONEN.map((k, i) => [k.kode, i]));
      const namaKomponen = Object.fromEntries(KOMPONEN.map((k) => [k.kode, k.nama]));
      const alokasi = all(
        `SELECT sp.tahun, s.komponen, s.persentase, s.nominal
           FROM shu_alokasi s JOIN shu_periode sp ON sp.id = s.periode_id ${w.where()}`, w.params)
        .sort((a, b) => b.tahun - a.tahun || (urutan[a.komponen] ?? 99) - (urutan[b.komponen] ?? 99))
        .map((r) => ({ ...r, komponen: namaKomponen[r.komponen] || teks(r.komponen) }));
      const satu = periodeShu.length === 1 ? periodeShu[0] : null;
      return {
        subjudul: f.tahun ? `Tahun Buku ${f.tahun}` : 'Seluruh tahun buku',
        ringkasan: satu ? [
          { label: 'SHU bersih', nilai: satu.shu_bersih, tipe: 'uang' },
          { label: 'Status', nilai: teks(satu.status) },
          { label: 'Total dialokasikan', nilai: jumlah(alokasi, 'nominal'), tipe: 'uang' },
        ] : [{ label: 'Jumlah tahun buku', nilai: periodeShu.length, tipe: 'angka' }],
        bagian: [
          {
            judul: 'Periode SHU',
            kolom: [kol('tahun', 'Tahun'), uang('shu_bersih', 'SHU Bersih'), uang('total_simpanan', 'Dasar Simpanan'),
              uang('total_transaksi', 'Dasar Transaksi'), kol('status', 'Status'), kol('disetujui_oleh', 'Disetujui Oleh'),
              tgl('disetujui_pada', 'Tgl Disetujui')],
            baris: periodeShu.map((r) => ({ ...r, status: teks(r.status) })),
          },
          {
            judul: 'Alokasi per Komponen',
            kolom: [...(satu ? [] : [kol('tahun', 'Tahun')]), kol('komponen', 'Komponen'), kol('persentase', 'Persentase', 'persen'),
              uang('nominal', 'Nominal')],
            baris: alokasi,
            total: satu ? jumlahkan(alokasi, ['persentase', 'nominal']) : undefined,
          },
        ],
      };
    },
  },
];
