/**
 * Data awal (bootstrap) dan data contoh untuk demonstrasi.
 *
 * Dijalankan otomatis saat server pertama kali dinyalakan:
 *   - Bagan akun standar koperasi (Permenkop UKM No. 2/2024)
 *   - Parameter sistem & persentase pembagian SHU (AD/ART)
 *   - Akun Super Administrator
 *   - Alur persetujuan bawaan
 *
 * Perintah manual:
 *   node server/seed.js          -> memastikan data awal ada
 *   node server/seed.js --demo   -> menambah data contoh (anggota, transaksi)
 *   node server/seed.js --reset  -> menghapus data lalu isi ulang + demo
 */
import { db, all, get, run, scalar, tx, setSetting, setting, migrate, nextNumber } from './db.js';
import crypto from 'node:crypto';
import { hashPassword } from './lib/auth.js';
import { logAudit } from './lib/audit.js';

// ---------------------------------------------------------------------
// Bagan Akun standar
// Catatan: akun kontra (akumulasi penyusutan, cadangan kerugian piutang)
// diberi saldo_normal 'D' agar saldonya tersaji negatif sebagai pengurang
// kelompok aset - sesuai penyajian lazim pada laporan posisi keuangan.
// ---------------------------------------------------------------------
const COA = [
  ['1', 'ASET', 'aset', 'D', null, 1, 0],
  ['1-1', 'Aset Lancar', 'aset', 'D', '1', 2, 0],
  ['1-1101', 'Kas', 'aset', 'D', '1-1', 3, 1, { is_kas: 1 }],
  ['1-1102', 'Kas Kecil (Petty Cash)', 'aset', 'D', '1-1', 3, 1, { is_kas: 1 }],
  ['1-1201', 'Bank', 'aset', 'D', '1-1', 3, 1, { is_bank: 1 }],
  ['1-1301', 'Piutang Usaha', 'aset', 'D', '1-1', 3, 1],
  ['1-1310', 'Piutang Pinjaman Anggota', 'aset', 'D', '1-1', 3, 1],
  ['1-1319', 'Cadangan Kerugian Piutang', 'aset', 'D', '1-1', 3, 1],
  ['1-1401', 'Persediaan Barang Dagang', 'aset', 'D', '1-1', 3, 1],
  ['1-1501', 'Biaya Dibayar di Muka', 'aset', 'D', '1-1', 3, 1],
  ['1-16', 'Aset Tetap', 'aset', 'D', '1', 2, 0],
  ['1-1601', 'Tanah', 'aset', 'D', '1-16', 3, 1],
  ['1-1602', 'Bangunan', 'aset', 'D', '1-16', 3, 1],
  ['1-1603', 'Kendaraan', 'aset', 'D', '1-16', 3, 1],
  ['1-1604', 'Inventaris & Peralatan Kantor', 'aset', 'D', '1-16', 3, 1],
  ['1-1699', 'Akumulasi Penyusutan Aset Tetap', 'aset', 'D', '1-16', 3, 1],

  ['2', 'LIABILITAS', 'kewajiban', 'K', null, 1, 0],
  ['2-1', 'Liabilitas Jangka Pendek', 'kewajiban', 'K', '2', 2, 0],
  ['2-1101', 'Utang Usaha', 'kewajiban', 'K', '2-1', 3, 1],
  ['2-1201', 'Simpanan Sukarela', 'kewajiban', 'K', '2-1', 3, 1],
  ['2-1202', 'Simpanan Berjangka', 'kewajiban', 'K', '2-1', 3, 1],
  ['2-1203', 'Deposito Koperasi', 'kewajiban', 'K', '2-1', 3, 1],
  ['2-1301', 'Utang Pajak', 'kewajiban', 'K', '2-1', 3, 1],
  ['2-1401', 'SHU Yang Akan Dibagikan', 'kewajiban', 'K', '2-1', 3, 1],
  ['2-1402', 'Dana Pengurus & Pengawas', 'kewajiban', 'K', '2-1', 3, 1],
  ['2-1403', 'Dana Kesejahteraan Karyawan', 'kewajiban', 'K', '2-1', 3, 1],
  ['2-1404', 'Dana Pendidikan', 'kewajiban', 'K', '2-1', 3, 1],
  ['2-1405', 'Dana Sosial', 'kewajiban', 'K', '2-1', 3, 1],
  ['2-1406', 'Dana Pembangunan Daerah Kerja', 'kewajiban', 'K', '2-1', 3, 1],
  ['2-2', 'Liabilitas Jangka Panjang', 'kewajiban', 'K', '2', 2, 0],
  ['2-2101', 'Utang Bank Jangka Panjang', 'kewajiban', 'K', '2-2', 3, 1],

  ['3', 'EKUITAS', 'ekuitas', 'K', null, 1, 0],
  ['3-1', 'Modal Koperasi', 'ekuitas', 'K', '3', 2, 0],
  ['3-1101', 'Simpanan Pokok', 'ekuitas', 'K', '3-1', 3, 1],
  ['3-1102', 'Simpanan Wajib', 'ekuitas', 'K', '3-1', 3, 1],
  ['3-1103', 'Modal Penyertaan', 'ekuitas', 'K', '3-1', 3, 1],
  ['3-1104', 'Hibah / Donasi', 'ekuitas', 'K', '3-1', 3, 1],
  ['3-1201', 'Dana Cadangan', 'ekuitas', 'K', '3-1', 3, 1],
  ['3-1301', 'SHU Tahun Berjalan', 'ekuitas', 'K', '3-1', 3, 1],
  ['3-1302', 'SHU Tahun Lalu (Ditahan)', 'ekuitas', 'K', '3-1', 3, 1],

  ['4', 'PENDAPATAN', 'pendapatan', 'K', null, 1, 0],
  ['4-1', 'Pendapatan Usaha', 'pendapatan', 'K', '4', 2, 0],
  ['4-1101', 'Penjualan Barang Dagang', 'pendapatan', 'K', '4-1', 3, 1],
  ['4-1201', 'Pendapatan Jasa Pinjaman', 'pendapatan', 'K', '4-1', 3, 1],
  ['4-1202', 'Pendapatan Administrasi & Provisi', 'pendapatan', 'K', '4-1', 3, 1],
  ['4-1203', 'Pendapatan Denda', 'pendapatan', 'K', '4-1', 3, 1],
  ['4-1301', 'Pendapatan Lain-lain', 'pendapatan', 'K', '4-1', 3, 1],

  ['5', 'BEBAN', 'beban', 'D', null, 1, 0],
  ['5-1', 'Harga Pokok Penjualan', 'beban', 'D', '5', 2, 0],
  ['5-1101', 'Harga Pokok Penjualan', 'beban', 'D', '5-1', 3, 1],
  ['5-2', 'Beban Operasional', 'beban', 'D', '5', 2, 0],
  ['5-2101', 'Beban Jasa Simpanan', 'beban', 'D', '5-2', 3, 1],
  ['5-2201', 'Beban Gaji & Tunjangan', 'beban', 'D', '5-2', 3, 1],
  ['5-2202', 'Beban Listrik, Air & Telekomunikasi', 'beban', 'D', '5-2', 3, 1],
  ['5-2203', 'Beban Alat Tulis Kantor', 'beban', 'D', '5-2', 3, 1],
  ['5-2204', 'Beban Sewa', 'beban', 'D', '5-2', 3, 1],
  ['5-2301', 'Beban Penyusutan Aset Tetap', 'beban', 'D', '5-2', 3, 1],
  ['5-2401', 'Beban Organisasi & RAT', 'beban', 'D', '5-2', 3, 1],
  ['5-2402', 'Beban Pendidikan & Pelatihan', 'beban', 'D', '5-2', 3, 1],
  ['5-2501', 'Beban Penyisihan Kerugian Piutang', 'beban', 'D', '5-2', 3, 1],
  ['5-2901', 'Beban Selisih Kas & Persediaan', 'beban', 'D', '5-2', 3, 1],
  ['5-2902', 'Beban Lain-lain', 'beban', 'D', '5-2', 3, 1],
];

const PENGATURAN = [
  ['koperasi.nama', 'Koperasi Serba Usaha Sejahtera Bersama', 'Nama koperasi'],
  ['koperasi.badan_hukum', '518/BH/XIV.4/2018', 'Nomor badan hukum koperasi'],
  ['koperasi.npwp', '01.234.567.8-901.000', 'NPWP koperasi'],
  ['koperasi.nib', '1234567890123', 'Nomor Induk Berusaha (OSS)'],
  ['koperasi.alamat', 'Jl. Koperasi No. 1, Jakarta', 'Alamat kantor pusat'],
  ['koperasi.telepon', '(021) 1234567', 'Telepon'],
  ['koperasi.email', 'info@ksusejahtera.co.id', 'Surel resmi'],
  ['koperasi.tahun_berdiri', '2018', 'Tahun pendirian'],

  ['shu.cadangan', '25', 'Persentase SHU untuk dana cadangan (AD/ART)'],
  ['shu.jasa_modal', '20', 'Persentase SHU untuk jasa modal (simpanan)'],
  ['shu.jasa_usaha', '30', 'Persentase SHU untuk jasa usaha (transaksi)'],
  ['shu.dana_pengurus', '10', 'Persentase SHU untuk pengurus & pengawas'],
  ['shu.dana_karyawan', '5', 'Persentase SHU untuk kesejahteraan karyawan'],
  ['shu.dana_pendidikan', '5', 'Persentase SHU untuk dana pendidikan'],
  ['shu.dana_sosial', '3', 'Persentase SHU untuk dana sosial'],
  ['shu.dana_pembangunan', '2', 'Persentase SHU untuk pembangunan daerah kerja'],

  ['pinjaman.maks_aktif_per_anggota', '2', 'Jumlah maksimal pinjaman berjalan per anggota'],
  ['pinjaman.grace_period_hari', '3', 'Masa tenggang sebelum denda dikenakan'],
  ['pinjaman.penalti_pelunasan_persen', '1', 'Penalti pelunasan dipercepat (% dari sisa pokok)'],

  ['loyalty.rupiah_per_poin', '10000', 'Nilai belanja untuk memperoleh 1 poin'],
  ['loyalty.nilai_per_poin', '100', 'Nilai tukar 1 poin dalam rupiah'],

  ['coa.kas', '1-1101', 'Akun kas default'],
  ['coa.bank', '1-1201', 'Akun bank default'],
  ['coa.piutang_usaha', '1-1301', 'Akun piutang usaha'],
  ['coa.piutang_pinjaman', '1-1310', 'Akun piutang pinjaman anggota'],
  ['coa.persediaan', '1-1401', 'Akun persediaan'],
  ['coa.hutang_usaha', '2-1101', 'Akun utang usaha'],
  ['coa.hutang_pajak', '2-1301', 'Akun utang pajak'],
  ['coa.shu_dibagikan', '2-1401', 'Akun SHU yang akan dibagikan'],
  ['coa.cadangan', '3-1201', 'Akun dana cadangan'],
  ['coa.shu_berjalan', '3-1301', 'Akun SHU tahun berjalan'],
  ['coa.penjualan', '4-1101', 'Akun penjualan'],
  ['coa.pendapatan_bunga', '4-1201', 'Akun pendapatan jasa pinjaman'],
  ['coa.pendapatan_admin', '4-1202', 'Akun pendapatan administrasi'],
  ['coa.pendapatan_denda', '4-1203', 'Akun pendapatan denda'],
  ['coa.pendapatan_lain', '4-1301', 'Akun pendapatan lain-lain'],
  ['coa.hpp', '5-1101', 'Akun harga pokok penjualan'],
  ['coa.beban_bunga_simpanan', '5-2101', 'Akun beban jasa simpanan'],
  ['coa.beban_penyusutan', '5-2301', 'Akun beban penyusutan'],
  ['coa.beban_selisih', '5-2901', 'Akun beban selisih'],
  ['coa.beban_lain', '5-2902', 'Akun beban lain-lain'],
  ['coa.dana_pengurus', '2-1402', 'Akun dana pengurus'],
  ['coa.dana_karyawan', '2-1403', 'Akun dana karyawan'],
  ['coa.dana_pendidikan', '2-1404', 'Akun dana pendidikan'],
  ['coa.dana_sosial', '2-1405', 'Akun dana sosial'],
  ['coa.dana_pembangunan', '2-1406', 'Akun dana pembangunan'],
];

const ALUR_APPROVAL = [
  ['pinjaman', 'Pinjaman s.d. Rp 5.000.000', 0, 5_000_000,
    JSON.stringify([{ urut: 1, role: 'petugas_pinjaman', tipe: 'berjenjang', sla_hari: 2 }])],
  ['pinjaman', 'Pinjaman Rp 5.000.001 - Rp 50.000.000', 5_000_001, 50_000_000,
    JSON.stringify([
      { urut: 1, role: 'petugas_pinjaman', tipe: 'berjenjang', sla_hari: 2 },
      { urut: 2, role: 'manajer_unit', tipe: 'berjenjang', sla_hari: 3 },
    ])],
  ['pinjaman', 'Pinjaman di atas Rp 50.000.000', 50_000_001, 0,
    JSON.stringify([
      { urut: 1, role: 'petugas_pinjaman', tipe: 'berjenjang', sla_hari: 2 },
      { urut: 2, role: 'manajer_unit', tipe: 'berjenjang', sla_hari: 3 },
      { urut: 3, role: 'pengurus', tipe: 'parallel', sla_hari: 5 },
      { urut: 3, role: 'pengawas', tipe: 'parallel', sla_hari: 5 },
    ])],
  ['pembelian', 'Pembelian di atas Rp 10.000.000', 10_000_001, 0,
    JSON.stringify([
      { urut: 1, role: 'manajer_unit', tipe: 'berjenjang', sla_hari: 2 },
      { urut: 2, role: 'bendahara', tipe: 'berjenjang', sla_hari: 3 },
      { urut: 3, role: 'pengurus', tipe: 'berjenjang', sla_hari: 5 },
    ])],
  ['anggaran', 'Pengesahan RKAP', 0, 0,
    JSON.stringify([
      { urut: 1, role: 'bendahara', tipe: 'berjenjang', sla_hari: 5 },
      { urut: 2, role: 'pengurus', tipe: 'berjenjang', sla_hari: 7 },
      { urut: 3, role: 'pengawas', tipe: 'berjenjang', sla_hari: 7 },
    ])],
];

/** Memastikan data awal tersedia. Idempoten - aman dipanggil setiap start-up. */
export function pastikanDataAwal() {
  return tx(() => {
    let dibuat = 0;

    for (const [kode, nama, tipe, saldo, parent, level, postable, extra = {}] of COA) {
      if (get('SELECT kode FROM coa WHERE kode = ?', [kode])) continue;
      run(`INSERT INTO coa(kode, nama, tipe, saldo_normal, parent_kode, level, is_postable, is_kas, is_bank)
           VALUES(?,?,?,?,?,?,?,?,?)`,
      [kode, nama, tipe, saldo, parent, level, postable, extra.is_kas || 0, extra.is_bank || 0]);
      dibuat++;
    }

    for (const [key, value, ket] of PENGATURAN) {
      if (setting(key, null) === null) setSetting(key, value, ket);
    }

    if (!scalar('SELECT COUNT(*) FROM cabang')) {
      run(`INSERT INTO cabang(kode, nama, alamat, kota, is_pusat)
           VALUES('PST','Kantor Pusat','Jl. Koperasi No. 1','Jakarta',1)`);
    }
    if (!scalar('SELECT COUNT(*) FROM unit_usaha')) {
      run(`INSERT INTO unit_usaha(kode, nama, jenis, cabang_id) VALUES
           ('USP','Unit Simpan Pinjam','simpan_pinjam',1),
           ('TOK','Unit Toko Koperasi','retail',1),
           ('JSA','Unit Jasa','jasa',1)`);
    }
    if (!scalar('SELECT COUNT(*) FROM gudang')) {
      run(`INSERT INTO gudang(kode, nama, alamat, cabang_id, unit_usaha_id)
           VALUES('GD01','Gudang Toko Utama','Jl. Koperasi No. 1',1,2)`);
    }

    if (!scalar('SELECT COUNT(*) FROM jabatan')) {
      run(`INSERT INTO jabatan(kode, nama, kelompok) VALUES
           ('KET','Ketua','pengurus'),('SEK','Sekretaris','pengurus'),('BEN','Bendahara','pengurus'),
           ('KPW','Ketua Pengawas','pengawas'),('APW','Anggota Pengawas','pengawas'),
           ('MGR','Manajer','karyawan'),('STF','Staf','karyawan'),('KSR','Kasir','karyawan')`);
    }

    if (!scalar('SELECT COUNT(*) FROM produk_simpanan')) {
      run(`INSERT INTO produk_simpanan(kode, nama, jenis, coa_kode, coa_beban_bunga, setoran_minimal,
             setoran_wajib, bunga_tahunan, boleh_tarik, tenor_bulan, masuk_shu) VALUES
           ('SP','Simpanan Pokok','pokok','3-1101',NULL,500000,0,0,0,0,1),
           ('SW','Simpanan Wajib','wajib','3-1102',NULL,50000,50000,0,0,0,1),
           ('SS','Simpanan Sukarela','sukarela','2-1201','5-2101',10000,0,3,1,0,1),
           ('SB','Simpanan Berjangka 12 Bulan','berjangka','2-1202','5-2101',1000000,0,6,1,12,1),
           ('DP','Deposito Koperasi 6 Bulan','deposito','2-1203','5-2101',5000000,0,5,1,6,1)`);
    }

    if (!scalar('SELECT COUNT(*) FROM produk_pinjaman')) {
      run(`INSERT INTO produk_pinjaman(kode, nama, jenis, metode_bunga, bunga_tahunan, tenor_min,
             tenor_max, plafon_min, plafon_max, biaya_admin, biaya_provisi, denda_harian,
             coa_piutang, coa_pendapatan_bunga, coa_pendapatan_admin, coa_pendapatan_denda, wajib_agunan) VALUES
           ('PK','Pinjaman Konsumtif','konsumtif','flat',18,3,24,500000,25000000,1,0,0.1,
            '1-1310','4-1201','4-1202','4-1203',0),
           ('PP','Pinjaman Produktif','produktif','menurun',15,6,36,2000000,100000000,1,0.5,0.1,
            '1-1310','4-1201','4-1202','4-1203',0),
           ('PM','Pinjaman Modal Usaha','modal_usaha','anuitas',16,12,60,10000000,500000000,1.5,1,0.15,
            '1-1310','4-1201','4-1202','4-1203',1)`);
    }

    if (!scalar('SELECT COUNT(*) FROM approval_flow')) {
      for (const [modul, nama, min, max, tahapan] of ALUR_APPROVAL) {
        run('INSERT INTO approval_flow(modul, nama, batas_min, batas_max, tahapan) VALUES(?,?,?,?,?)',
          [modul, nama, min, max, tahapan]);
      }
    }

    if (!scalar('SELECT COUNT(*) FROM users')) {
      // Kata sandi awal dapat ditentukan lewat ECMS_ADMIN_PASSWORD saat pemasangan
      // di server produksi, sehingga kata sandi bawaan yang tercantum pada
      // dokumentasi tidak pernah dipakai di lingkungan yang terbuka ke internet.
      const sandiAwal = process.env.ECMS_ADMIN_PASSWORD || 'Admin12345';
      const { hash, salt } = hashPassword(sandiAwal);
      run(`INSERT INTO users(username, nama, email, password_hash, password_salt, role, cabang_id)
           VALUES('admin','Administrator Sistem','admin@koperasi.id',?,?,'super_admin',1)`, [hash, salt]);
      // Halaman masuk hanya menampilkan daftar akun contoh bila kata sandi yang
      // dipakai memang kata sandi bawaan. Di server sungguhan daftar itu bukan
      // sekadar salah, tetapi mengundang orang mencoba dan mengunci akun admin.
      setSetting('mode_demo', process.env.ECMS_ADMIN_PASSWORD ? '0' : '1',
        'Menampilkan daftar akun contoh pada halaman masuk');
      dibuat++;
    }

    if (dibuat) {
      logAudit(null, { aksi: 'create', modul: 'admin',
        keterangan: 'Inisialisasi data awal sistem (bagan akun, parameter, akun administrator)' });
    }
    return { dibuat };
  });
}

// ---------------------------------------------------------------------
// Data contoh (opsional)
// ---------------------------------------------------------------------

const NAMA_DEPAN = ['Budi', 'Siti', 'Ahmad', 'Dewi', 'Eko', 'Rina', 'Joko', 'Sri', 'Agus', 'Ani',
  'Hendra', 'Maya', 'Rudi', 'Lestari', 'Bambang', 'Fitri', 'Dedi', 'Nurul', 'Wahyu', 'Indah'];
const NAMA_BELAKANG = ['Santoso', 'Wijaya', 'Kusuma', 'Pratama', 'Hidayat', 'Nugroho', 'Saputra',
  'Rahayu', 'Permana', 'Utami'];
const PEKERJAAN = ['Pegawai Negeri', 'Karyawan Swasta', 'Wiraswasta', 'Guru', 'Petani', 'Pedagang'];

/** Bilangan pseudo-acak deterministik agar data contoh selalu sama. */
function rng(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}

// ------------------------------ Bantuan tanggal ------------------------------

const iso = (d) => d.toISOString().slice(0, 10);
const hariKe = (t, n) => iso(new Date(Date.parse(`${t}T00:00:00Z`) + n * 86_400_000));
const selisihHari = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const akhirBulan = (p) => {
  const [y, m] = p.split('-').map(Number);
  return iso(new Date(Date.UTC(y, m, 0)));
};
/** Daftar periode 'YYYY-MM' dari bulan `dari` sampai bulan `sampai` (inklusif). */
function deretPeriode(dari, sampai) {
  const hasil = [];
  let [y, m] = dari.slice(0, 7).split('-').map(Number);
  const [ya, ma] = sampai.slice(0, 7).split('-').map(Number);
  while (y < ya || (y === ya && m <= ma)) {
    hasil.push(`${y}-${String(m).padStart(2, '0')}`);
    if (++m > 12) { m = 1; y += 1; }
  }
  return hasil;
}

/**
 * Membangun data contoh selama kurang lebih dua tahun buku.
 *
 * Rentangnya sengaja dimulai 1 Januari tahun lalu, bukan awal tahun berjalan.
 * Dengan begitu grafik tren dua belas bulan pada dasbor terisi penuh, dan yang
 * lebih penting: ada satu tahun buku yang benar-benar selesai sehingga jurnal
 * penutup, pembagian SHU, dan RAT dapat dijalankan lewat alur yang sesungguhnya
 * - bukan ditanam sebagai baris tabel yang tidak berjejak di buku besar.
 *
 * Seluruh transaksi keuangan dibuat melalui service yang sama dengan yang
 * dipakai antarmuka, sehingga setiap angka pada laporan benar-benar berasal
 * dari buku besar dan neraca dijamin seimbang.
 */
export async function seedDemo() {
  const rand = rng(20260801);
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const antara = (a, b) => a + Math.floor(rand() * (b - a + 1));

  const { bukaRekening, setoran, penarikan, posBungaBulanan } = await import('./services/savings.js');
  const loans = await import('./services/loans.js');
  const trade = await import('./services/trade.js');
  const inventory = await import('./services/inventory.js');
  const assets = await import('./services/assets.js');
  const shu = await import('./services/shu.js');
  const approval = await import('./services/approval.js');
  const { postJournal, jurnalPenutup, tutupPeriode, saldoAkun } = await import('./services/accounting.js');

  const ctx = { user: { id: 1, username: 'admin', nama: 'Administrator Sistem', role: 'super_admin' } };

  if (scalar('SELECT COUNT(*) FROM anggota') > 0) {
    console.log('  ⚠ Data contoh sudah ada, dilewati. Gunakan --reset untuk mengisi ulang.');
    return;
  }

  const hariIni = iso(new Date());
  const tahun = Number(hariIni.slice(0, 4));
  const tahunLalu = tahun - 1;
  const mulai = `${tahunLalu}-01-01`;
  const periodeSemua = deretPeriode(mulai, hariIni);
  // Bulan berjalan belum lengkap, jadi beban bulanan hanya dibukukan sampai
  // bulan sebelumnya agar pendapatan dan beban tetap sebanding.
  const periodeLengkap = periodeSemua.slice(0, -1);

  console.log(`  → Rentang data contoh: ${mulai} s.d. ${hariIni} (${periodeSemua.length} bulan)`);

  // ----------------------------------------------------------------------
  // Neraca pembuka
  // ----------------------------------------------------------------------
  console.log('  → Mencatat neraca pembuka (modal awal koperasi)…');
  // Tanpa saldo pembuka, koperasi tidak memiliki dana untuk menyalurkan pinjaman
  // sehingga kas akan tersaji negatif. Modal awal mencerminkan akumulasi
  // permodalan koperasi sejak berdiri tahun 2018.
  postJournal({
    tanggal: mulai, tipe: 'pembuka', referensi: `pembuka:${tahunLalu}`,
    keterangan: `Saldo pembuka tahun buku ${tahunLalu}`,
    lines: [
      { coa_kode: '1-1101', debit: 180_000_000, keterangan: 'Saldo kas awal' },
      { coa_kode: '1-1102', debit: 10_000_000, keterangan: 'Kas kecil unit toko' },
      { coa_kode: '1-1201', debit: 420_000_000, keterangan: 'Saldo bank awal' },
      { coa_kode: '1-1602', debit: 240_000_000, keterangan: 'Bangunan kantor koperasi' },
      { coa_kode: '1-1699', kredit: 40_000_000, keterangan: 'Akumulasi penyusutan bangunan' },
      { coa_kode: '3-1103', kredit: 300_000_000, keterangan: 'Modal penyertaan anggota' },
      { coa_kode: '3-1104', kredit: 60_000_000, keterangan: 'Hibah pembinaan koperasi' },
      { coa_kode: '3-1201', kredit: 320_000_000, keterangan: 'Akumulasi dana cadangan' },
      { coa_kode: '3-1302', kredit: 130_000_000, keterangan: 'SHU tahun lalu yang ditahan' },
    ],
  }, ctx);

  // ----------------------------------------------------------------------
  // Struktur organisasi
  // ----------------------------------------------------------------------
  console.log('  → Melengkapi cabang, gudang, dan rekening bank…');
  run(`INSERT INTO cabang(kode, nama, alamat, kota, telepon, is_pusat) VALUES
       ('CBG','Cabang Bekasi','Jl. Ahmad Yani No. 45','Bekasi','0218812345',0),
       ('CDP','Cabang Depok','Jl. Margonda Raya No. 210','Depok','0217761234',0)`);
  run(`INSERT INTO gudang(kode, nama, alamat, cabang_id, unit_usaha_id) VALUES
       ('GD02','Gudang Cabang Bekasi','Jl. Ahmad Yani No. 45',2,2),
       ('GD03','Gudang Transit','Jl. Koperasi No. 3',1,2)`);
  run(`INSERT INTO bank_account(nama_bank, nomor_rekening, atas_nama, cabang_id, coa_kode, saldo_awal) VALUES
       ('Bank BRI','0123-01-000456-30-7','Koperasi Serba Usaha Sejahtera',1,'1-1201',300000000),
       ('Bank Mandiri','137-00-1234567-8','Koperasi Serba Usaha Sejahtera',1,'1-1201',120000000),
       ('Bank BJB','0051234567890','KSU Sejahtera Cabang Bekasi',2,'1-1201',0)`);
  run(`INSERT INTO pajak(kode, nama, tarif, coa_kode) VALUES
       ('PPH21','PPh Pasal 21 Karyawan',5,'2-1301'),
       ('PPH23','PPh Pasal 23 Jasa',2,'2-1301'),
       ('PPHFINAL','PPh Final UMKM 0,5%',0.5,'2-1301'),
       ('PPN','PPN Keluaran',11,'2-1301')`);

  console.log('  → Membuat pengguna contoh untuk setiap peran…');
  const peran = [
    ['pengurus1', 'Hj. Sumarni (Ketua)', 'pengurus'],
    ['pengawas1', 'Drs. Hartono (Ketua Pengawas)', 'pengawas'],
    ['bendahara1', 'Yuni Astuti', 'bendahara'],
    ['manajer1', 'Rizal Fadhilah', 'manajer_unit'],
    ['simpanan1', 'Nia Ramadhani', 'petugas_simpanan'],
    ['pinjaman1', 'Doni Setiawan', 'petugas_pinjaman'],
    ['kasir1', 'Putri Ayu', 'kasir_toko'],
    ['gudang1', 'Slamet Riyadi', 'staf_gudang'],
    ['auditor1', 'Ir. Bagus Prakoso', 'auditor_internal'],
  ];
  for (const [u, n, r] of peran) {
    if (get('SELECT id FROM users WHERE username = ?', [u])) continue;
    const { hash, salt } = hashPassword('Demo12345');
    run(`INSERT INTO users(username, nama, password_hash, password_salt, role, cabang_id, unit_usaha_id)
         VALUES(?,?,?,?,?,1,?)`, [u, n, hash, salt, r, r === 'manajer_unit' ? 2 : null]);
  }
  /** Konteks pengguna sesuai peran, dipakai agar persetujuan diputus oleh peran yang berwenang. */
  const ctxPeran = (role) => {
    const u = get('SELECT id, username, nama, role FROM users WHERE role = ? LIMIT 1', [role]);
    return u ? { user: u } : ctx;
  };

  console.log('  → Membuat pengurus, pengawas & karyawan…');
  run(`INSERT INTO karyawan(nik, nama, jabatan_id, cabang_id, tgl_masuk, periode_mulai, periode_akhir) VALUES
       ('3171010101800001','Hj. Sumarni',1,1,'2018-01-01','${tahunLalu}-01-01','${tahun + 2}-12-31'),
       ('3171010101800002','Muhammad Ridwan',2,1,'2018-01-01','${tahunLalu}-01-01','${tahun + 2}-12-31'),
       ('3171010101800003','Yuni Astuti',3,1,'2018-01-01','${tahunLalu}-01-01','${tahun + 2}-12-31'),
       ('3171010101800004','Drs. Hartono',4,1,'2018-01-01','${tahunLalu}-01-01','${tahun + 2}-12-31'),
       ('3171010101800005','Endang Susilowati',5,1,'2018-01-01','${tahunLalu}-01-01','${tahun + 2}-12-31'),
       ('3171010101800006','Rizal Fadhilah',6,1,'2019-03-01',NULL,NULL),
       ('3171010101800007','Putri Ayu',8,1,'2021-07-01',NULL,NULL),
       ('3171010101800008','Slamet Riyadi',7,1,'2021-07-01',NULL,NULL),
       ('3171010101800009','Nia Ramadhani',7,1,'2022-02-01',NULL,NULL),
       ('3171010101800010','Doni Setiawan',7,2,'2022-02-01',NULL,NULL)`);

  // ----------------------------------------------------------------------
  // Keanggotaan
  // ----------------------------------------------------------------------
  const JUMLAH_ANGGOTA = 100;
  console.log(`  → Membuat ${JUMLAH_ANGGOTA} anggota aktif…`);
  const anggotaIds = [];
  const anggotaGabung = new Map();
  for (let i = 1; i <= JUMLAH_ANGGOTA; i++) {
    const nama = `${pick(NAMA_DEPAN)} ${pick(NAMA_BELAKANG)}`;
    const nomor = `A${tahunLalu}${String(i).padStart(4, '0')}`;
    const nik = `3171${String(10_000_000_000 + i * 7919).slice(0, 12)}`;
    // Separuh anggota lama (bergabung sebelum rentang data), separuh bergabung
    // di sepanjang rentang agar grafik pertumbuhan anggota bergerak.
    const gabung = i <= 55 ? `${tahunLalu - antara(1, 5)}-${String(antara(1, 12)).padStart(2, '0')}-10`
      : hariKe(mulai, antara(20, Math.max(21, selisihHari(mulai, hariIni) - 25)));
    const { lastInsertRowid: id } = run(
      `INSERT INTO anggota(nomor_anggota, nik, nama, jenis_kelamin, tanggal_lahir, alamat, kota,
         telepon, email, pekerjaan, penghasilan, pendidikan, cabang_id, tanggal_daftar, tanggal_gabung, status)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'aktif')`,
      [nomor, nik, nama, i % 2 === 0 ? 'L' : 'P',
        `19${70 + (i % 30)}-${String((i % 12) + 1).padStart(2, '0')}-15`,
        `Jl. ${pick(['Melati', 'Anggrek', 'Kenanga', 'Cempaka', 'Dahlia'])} No. ${i}`,
        pick(['Jakarta', 'Bekasi', 'Depok']),
        `0812${String(10_000_000 + i * 137).slice(0, 8)}`,
        `anggota${i}@contoh.id`,
        pick(PEKERJAAN), 3_000_000 + (i % 12) * 650_000, i % 3 === 0 ? 'S1' : 'SMA',
        i % 5 === 0 ? 2 : i % 7 === 0 ? 3 : 1, gabung, gabung],
    );
    anggotaIds.push(id);
    anggotaGabung.set(id, gabung < mulai ? mulai : gabung);
  }
  // Calon anggota yang menunggu verifikasi
  for (let i = 1; i <= 5; i++) {
    run(`INSERT INTO anggota(nomor_anggota, nik, nama, jenis_kelamin, alamat, kota, telepon,
           pekerjaan, penghasilan, cabang_id, tanggal_daftar, status)
         VALUES(?,?,?,?,?,?,?,?,?,1,?,'calon')`,
    [`A${tahun}${String(900 + i).padStart(4, '0')}`, `3172${String(20_000_000_000 + i * 7919).slice(0, 12)}`,
      `${pick(NAMA_DEPAN)} ${pick(NAMA_BELAKANG)}`, 'L', `Jl. Anggrek No. ${i}`, 'Jakarta',
      `0813${String(20_000_000 + i * 91).slice(0, 8)}`, pick(PEKERJAAN), 4_000_000,
      hariKe(hariIni, -antara(3, 40))]);
  }
  // Anggota yang keluar - agar laporan mutasi keanggotaan tidak nol
  for (let i = 1; i <= 3; i++) {
    const keluar = hariKe(hariIni, -antara(30, 300));
    run(`INSERT INTO anggota(nomor_anggota, nik, nama, jenis_kelamin, alamat, kota, telepon,
           pekerjaan, penghasilan, cabang_id, tanggal_daftar, tanggal_gabung, tanggal_keluar,
           alasan_keluar, status)
         VALUES(?,?,?,?,?,?,?,?,?,1,?,?,?,?,'keluar')`,
    [`A${tahunLalu}${String(800 + i).padStart(4, '0')}`, `3173${String(30_000_000_000 + i * 7919).slice(0, 12)}`,
      `${pick(NAMA_DEPAN)} ${pick(NAMA_BELAKANG)}`, 'P', `Jl. Kamboja No. ${i}`, 'Jakarta',
      `0857${String(30_000_000 + i * 71).slice(0, 8)}`, pick(PEKERJAAN), 3_500_000,
      `${tahunLalu - 2}-05-01`, `${tahunLalu - 2}-05-01`, keluar,
      pick(['Pindah domisili', 'Mengundurkan diri', 'Alih pekerjaan ke luar kota'])]);
  }

  console.log('  → Mencatat ahli waris & riwayat keanggotaan…');
  const HUBUNGAN = ['Istri', 'Suami', 'Anak', 'Orang Tua', 'Saudara Kandung'];
  for (const [idx, aid] of anggotaIds.entries()) {
    if (idx % 2) continue;                                   // separuh anggota mendaftarkan ahli waris
    run(`INSERT INTO anggota_ahli_waris(anggota_id, nama, nik, hubungan, telepon, alamat, persentase)
         VALUES(?,?,?,?,?,?,100)`,
    [aid, `${pick(NAMA_DEPAN)} ${pick(NAMA_BELAKANG)}`,
      `3171${String(40_000_000_000 + idx * 3571).slice(0, 12)}`, pick(HUBUNGAN),
      `0821${String(40_000_000 + idx * 211).slice(0, 8)}`, 'Alamat sesuai kartu keluarga']);
  }
  for (const aid of anggotaIds) {
    const g = anggotaGabung.get(aid);
    run(`INSERT INTO anggota_riwayat(anggota_id, jenis, keterangan, mulai, status_lama, status_baru, oleh)
         VALUES(?,'status','Verifikasi berkas selesai, anggota disahkan',?,'calon','aktif','simpanan1')`,
    [aid, g]);
  }

  // ----------------------------------------------------------------------
  // Simpanan
  // ----------------------------------------------------------------------
  console.log('  → Membuka rekening & mencatat setoran simpanan…');
  const produkPokok = get("SELECT id FROM produk_simpanan WHERE jenis = 'pokok'").id;
  const produkWajib = get("SELECT id FROM produk_simpanan WHERE jenis = 'wajib'").id;
  const produkSukarela = get("SELECT id FROM produk_simpanan WHERE jenis = 'sukarela'").id;
  const produkBerjangka = get("SELECT id FROM produk_simpanan WHERE jenis = 'berjangka'").id;
  const produkDeposito = get("SELECT id FROM produk_simpanan WHERE jenis = 'deposito'").id;

  const rekSukarela = [];
  for (const [idx, aid] of anggotaIds.entries()) {
    const tglBuka = anggotaGabung.get(aid);
    bukaRekening({ anggota_id: aid, produk_id: produkPokok, tanggal_buka: tglBuka, setoran_awal: 500_000 }, ctx);
    const rekW = bukaRekening({ anggota_id: aid, produk_id: produkWajib, tanggal_buka: tglBuka }, ctx);

    // Simpanan wajib disetor setiap bulan sejak bergabung.
    for (const p of deretPeriode(tglBuka, hariIni)) {
      const tgl = `${p}-10`;
      if (tgl < tglBuka || tgl > hariIni) continue;
      // Beberapa anggota menunggak satu-dua bulan terakhir, seperti kenyataannya.
      if (idx % 9 === 0 && p >= periodeSemua[periodeSemua.length - 2]) continue;
      setoran({ rekening_id: rekW.id, tanggal: tgl, nominal: 50_000,
        keterangan: `Simpanan wajib ${p}` }, ctx);
    }

    if (idx % 2 === 0) {
      const rekS = bukaRekening({ anggota_id: aid, produk_id: produkSukarela, tanggal_buka: tglBuka }, ctx);
      rekSukarela.push(rekS.id);
      const setoranSukarela = antara(2, 6);
      for (let s = 0; s < setoranSukarela; s++) {
        const tgl = hariKe(tglBuka, 25 + s * antara(45, 120));
        if (tgl > hariIni) break;
        setoran({ rekening_id: rekS.id, tanggal: tgl,
          nominal: antara(2, 12) * 100_000, metode: rand() > 0.6 ? 'transfer' : 'tunai',
          keterangan: 'Setoran sukarela' }, ctx);
      }
      // Sebagian anggota menarik sebagian simpanan sukarelanya
      if (idx % 6 === 0) {
        const tgl = hariKe(hariIni, -antara(10, 200));
        try {
          penarikan({ rekening_id: rekS.id, tanggal: tgl, nominal: 200_000,
            keterangan: 'Penarikan simpanan sukarela' }, ctx);
        } catch { /* saldo tidak mencukupi - dilewati */ }
      }
    }
    // Simpanan berjangka & deposito untuk anggota dengan penghasilan lebih besar
    if (idx % 11 === 0) {
      const rekB = bukaRekening({ anggota_id: aid, produk_id: produkBerjangka,
        tanggal_buka: hariKe(tglBuka, 40) > hariIni ? tglBuka : hariKe(tglBuka, 40) }, ctx);
      setoran({ rekening_id: rekB.id, tanggal: hariKe(tglBuka, 41) > hariIni ? hariIni : hariKe(tglBuka, 41),
        nominal: antara(3, 10) * 1_000_000, metode: 'transfer', keterangan: 'Penempatan simpanan berjangka' }, ctx);
    }
    if (idx % 17 === 0) {
      const rekD = bukaRekening({ anggota_id: aid, produk_id: produkDeposito,
        tanggal_buka: hariKe(tglBuka, 60) > hariIni ? tglBuka : hariKe(tglBuka, 60) }, ctx);
      setoran({ rekening_id: rekD.id, tanggal: hariKe(tglBuka, 61) > hariIni ? hariIni : hariKe(tglBuka, 61),
        nominal: antara(5, 15) * 1_000_000, metode: 'transfer', keterangan: 'Penempatan deposito koperasi' }, ctx);
    }
  }

  // ----------------------------------------------------------------------
  // Toko: barang, pemasok, persediaan
  // ----------------------------------------------------------------------
  console.log('  → Menyiapkan barang, pemasok & persediaan toko…');
  run(`INSERT INTO kategori_barang(kode, nama) VALUES
       ('SMB','Sembako'),('MNM','Minuman'),('ATK','Alat Tulis'),('RMT','Kebutuhan Rumah Tangga'),
       ('SNK','Makanan Ringan'),('KES','Kesehatan & Kebersihan')`);
  // Harga jual disusun pada marjin kotor sekitar 22-27% dari harga jual, dengan
  // harga khusus anggota kira-kira 4% lebih murah - kisaran yang lazim pada
  // toko koperasi dan cukup untuk menutup beban operasional serta menyisakan SHU.
  const barang = [
    ['BRG001', 'Beras Premium 5 kg', 1, 'SAK', 62_000, 80_000, 77_000, 10, 20],
    ['BRG002', 'Minyak Goreng 2 L', 1, 'PCS', 32_000, 42_000, 40_500, 12, 24],
    ['BRG003', 'Gula Pasir 1 kg', 1, 'KG', 14_000, 18_500, 17_800, 15, 30],
    ['BRG004', 'Tepung Terigu 1 kg', 1, 'KG', 11_000, 14_500, 14_000, 15, 30],
    ['BRG005', 'Telur Ayam 1 kg', 1, 'KG', 26_000, 34_000, 32_500, 10, 20],
    ['BRG006', 'Mie Instan (dus)', 1, 'DUS', 98_000, 126_000, 121_000, 6, 12],
    ['BRG007', 'Kopi Bubuk 200 g', 2, 'PCS', 18_000, 25_000, 24_000, 10, 20],
    ['BRG008', 'Teh Celup 25 s', 2, 'BOX', 8_000, 11_500, 11_000, 10, 20],
    ['BRG009', 'Air Mineral 600 ml (dus)', 2, 'DUS', 38_000, 50_000, 48_000, 8, 16],
    ['BRG010', 'Susu Kental Manis', 2, 'KLG', 11_500, 15_500, 14_800, 12, 24],
    ['BRG011', 'Sirup Buah 600 ml', 2, 'BTL', 16_000, 22_000, 21_000, 8, 16],
    ['BRG012', 'Buku Tulis 38 lbr', 3, 'PCS', 3_500, 5_000, 4_800, 24, 48],
    ['BRG013', 'Pulpen Hitam', 3, 'PCS', 2_000, 3_000, 2_800, 30, 60],
    ['BRG014', 'Pensil 2B', 3, 'PCS', 1_800, 2_600, 2_500, 30, 60],
    ['BRG015', 'Kertas HVS A4 70 g', 3, 'RIM', 48_000, 63_000, 60_500, 6, 12],
    ['BRG016', 'Map Plastik', 3, 'PCS', 2_500, 3_500, 3_400, 20, 40],
    ['BRG017', 'Sabun Mandi Batang', 4, 'PCS', 3_800, 5_200, 5_000, 20, 40],
    ['BRG018', 'Deterjen 800 g', 4, 'PCS', 16_000, 21_500, 20_500, 12, 24],
    ['BRG019', 'Pewangi Pakaian 800 ml', 4, 'BTL', 14_000, 19_000, 18_200, 10, 20],
    ['BRG020', 'Sabun Cuci Piring 750 ml', 4, 'BTL', 12_000, 16_500, 15_800, 10, 20],
    ['BRG021', 'Biskuit Kaleng', 5, 'KLG', 32_000, 43_000, 41_000, 8, 16],
    ['BRG022', 'Keripik Singkong 200 g', 5, 'PCS', 9_000, 12_500, 12_000, 12, 24],
    ['BRG023', 'Masker Medis (box)', 6, 'BOX', 22_000, 30_000, 28_500, 8, 16],
    ['BRG024', 'Minyak Kayu Putih 60 ml', 6, 'BTL', 17_000, 23_500, 22_500, 8, 16],
  ];
  barang.forEach(([kode, nama, kat, sat, beli, jual, hAnggota, min, rop], i) => {
    run(`INSERT INTO barang(kode, barcode, nama, kategori_id, satuan, harga_beli, harga_jual,
           harga_anggota, stok_minimum, reorder_point, coa_persediaan, coa_penjualan, coa_hpp)
         VALUES(?,?,?,?,?,?,?,?,?,?,'1-1401','4-1101','5-1101')`,
    [kode, `899123456${String(7890 + i).padStart(4, '0')}`, nama, kat, sat, beli, jual, hAnggota, min, rop]);
  });
  run(`INSERT INTO supplier(kode, nama, alamat, telepon, email, npwp, termin_hari, rating) VALUES
       ('SUP001','PT Sumber Pangan Sejahtera','Jl. Industri No. 12, Bekasi','0218881234','sales@sumberpangan.co.id','01.111.222.3-401.000',30,4.5),
       ('SUP002','CV Aneka Kebutuhan','Jl. Raya Bogor KM 20','0217772345','order@anekakebutuhan.co.id','02.222.333.4-402.000',14,4.0),
       ('SUP003','PT Mitra Minuman Nusantara','Jl. Pahlawan No. 88, Tangerang','0215553456','po@mitraminuman.co.id','03.333.444.5-403.000',30,4.2),
       ('SUP004','UD Berkah Alat Tulis','Jl. Pasar Baru No. 7, Jakarta','0213334567',NULL,NULL,7,3.8),
       ('SUP005','PT Higienis Rumah Tangga','Kawasan Industri MM2100, Cikarang','0218896789','sales@higienis.co.id','05.555.666.7-405.000',30,4.6)`);
  run(`INSERT INTO customer(kode, nama, alamat, telepon, npwp, termin_hari, limit_piutang) VALUES
       ('CUS001','Kantin Sekolah Harapan','Jl. Pendidikan No. 5, Jakarta','0218123456',NULL,14,15000000),
       ('CUS002','Warung Bu Tini','Jl. Melati No. 88, Bekasi','0812345678',NULL,7,5000000),
       ('CUS003','PT Mitra Sejahtera Abadi','Jl. Industri No. 3, Bekasi','0218887777','09.999.888.7-409.000',30,40000000)`);

  // Pembelian pembuka untuk mengisi stok awal
  const stokAwal = trade.buatPembelian({
    tanggal: hariKe(mulai, 3), tipe: 'po', supplier_id: 1, gudang_id: 1, unit_usaha_id: 2, cabang_id: 1,
    items: barang.map((b, i) => ({ barang_id: i + 1, qty: 380, harga: b[4] })),
  }, ctx);
  trade.terimaBarang({ pembelian_id: stokAwal.id, tanggal: hariKe(mulai, 5), metode_bayar: 'hutang' }, ctx);

  // ----------------------------------------------------------------------
  // Pinjaman
  // ----------------------------------------------------------------------
  console.log('  → Membuat pinjaman, angsuran & agunan…');
  const produkKonsumtif = get("SELECT id FROM produk_pinjaman WHERE kode = 'PK'").id;
  const produkProduktif = get("SELECT id FROM produk_pinjaman WHERE kode = 'PP'").id;
  const produkModal = get("SELECT id FROM produk_pinjaman WHERE kode = 'PM'").id;
  const TUJUAN = ['Kebutuhan keluarga', 'Biaya pendidikan anak', 'Renovasi rumah', 'Biaya kesehatan',
    'Tambahan modal usaha', 'Pembelian peralatan usaha', 'Modal kerja dagang'];
  const rentangHari = selisihHari(mulai, hariIni);
  const pinjamanDicairkan = [];

  // Berkas yang menunggak, beserta jumlah angsuran yang terlewat. Ditulis
  // eksplisit supaya rasio NPL yang muncul di dasbor dapat dikendalikan:
  // nilainya sengaja kecil, sebagaimana tunggakan pada koperasi yang sehat.
  const MENUNGGAK = { 9: 10, 21: 7, 33: 4 };

  const JUMLAH_PINJAMAN = 72;
  for (let i = 0; i < JUMLAH_PINJAMAN; i++) {
    const aid = anggotaIds[i * 2 % anggotaIds.length];
    const gabung = anggotaGabung.get(aid);
    // Sepertiga berkas pertama diajukan pada awal rentang - menggambarkan
    // portofolio yang sudah berjalan sejak awal tahun buku, bukan koperasi yang
    // baru mulai menyalurkan pinjaman. Sisanya tersebar sampai hari ini, dan
    // beberapa yang terakhir dibuat berdekatan dengan hari ini agar selalu ada
    // berkas yang sedang dalam proses.
    const tglAjukan = i >= JUMLAH_PINJAMAN - 4
      ? hariKe(hariIni, -antara(1, 20))
      : i < 24
        ? hariKe(mulai, 8 + i * antara(1, 2))
        : hariKe(mulai, Math.max(40, Math.floor(rentangHari * (i - 23) / (JUMLAH_PINJAMAN - 27)) + antara(0, 12)));
    if (tglAjukan < gabung) continue;

    // Berkas yang dirancang menunggak dibuat kecil: kredit bermasalah pada
    // koperasi sehat umumnya berupa pinjaman konsumtif bernilai rendah.
    const bermasalah = MENUNGGAK[i] !== undefined;
    const jenis = bermasalah ? 'konsumtif' : i % 5 === 0 ? 'modal' : i % 2 === 0 ? 'konsumtif' : 'produktif';
    const produkId = jenis === 'modal' ? produkModal : jenis === 'konsumtif' ? produkKonsumtif : produkProduktif;
    const pokok = bermasalah ? antara(2, 4) * 1_000_000
      : jenis === 'modal' ? antara(10, 26) * 1_000_000
        : jenis === 'konsumtif' ? antara(2, 12) * 1_000_000
          : antara(5, 30) * 1_000_000;
    const tenor = jenis === 'modal' ? 24 : jenis === 'konsumtif' ? antara(9, 18) : antara(12, 30);
    // Produk modal usaha mewajibkan agunan.
    const agunan = jenis === 'modal' ? [{
      jenis: pick(['bpkb', 'shm']), deskripsi: 'Agunan sesuai berkas pengajuan',
      nomor_dokumen: `AG-${tahunLalu}-${String(1000 + i)}`,
      nilai_taksiran: Math.round(pokok * 1.6), lokasi_simpan: 'Brankas Kantor Pusat',
    }] : [];

    let p;
    try {
      p = loans.ajukan({ anggota_id: aid, produk_id: produkId, pokok, tenor,
        tujuan: pick(TUJUAN), tanggal_pengajuan: tglAjukan, cabang_id: 1, unit_usaha_id: 1, agunan }, ctx);
    } catch { continue; }                     // batas pinjaman aktif tercapai

    if (i >= JUMLAH_PINJAMAN - 3) continue;   // 3 pengajuan menunggu keputusan
    loans.survey(p.id, { hasil_survey: 'Kondisi usaha dan tempat tinggal sesuai berkas pengajuan.',
      catatan_analis: 'Kemampuan bayar memadai, direkomendasikan untuk disetujui.' }, ctx);
    if (i === JUMLAH_PINJAMAN - 5) {          // 1 pengajuan ditolak
      loans.putuskan(p.id, { setuju: false,
        alasan: 'Rasio angsuran terhadap penghasilan melampaui batas kebijakan.' }, ctx);
      continue;
    }
    loans.putuskan(p.id, { setuju: true }, ctx);
    if (i >= JUMLAH_PINJAMAN - 6) continue;   // 2 disetujui namun belum dicairkan

    const tglCair = hariKe(tglAjukan, antara(3, 8));
    if (tglCair > hariIni) continue;
    loans.cairkan(p.id, { tanggal: tglCair, metode: i % 3 === 0 ? 'transfer' : 'tunai' }, ctx);
    pinjamanDicairkan.push(p.id);

    // Pembayaran angsuran: sebagian besar tertib, sebagian menunggak dengan
    // tingkat keparahan berbeda sehingga seluruh kolektibilitas 1-5 terwakili.
    const jadwal = all('SELECT * FROM pinjaman_jadwal WHERE pinjaman_id = ? ORDER BY angsuran_ke', [p.id]);
    const jatuhTempoLewat = jadwal.filter((j) => j.jatuh_tempo <= hariIni).length;
    // Sebaran kolektibilitas dipilih eksplisit, bukan lewat sisa bagi yang
    // saling bertumpuk: rasio NPL adalah angka yang dibaca pengawas dan harus
    // masuk akal (di bawah 5%), jadi hanya tiga berkas yang menunggak berat.
    // Jumlah angsuran yang terlewat menentukan kelasnya - lihat ambang hari
    // tunggakan pada perbaruiKolektibilitas().
    const dibayar = bermasalah
      ? Math.max(0, jatuhTempoLewat - MENUNGGAK[i])
      : i % 8 === 3 ? Math.max(0, jatuhTempoLewat - 1)   // dalam perhatian khusus
        : jatuhTempoLewat;                               // lancar

    for (let k = 0; k < dibayar && k < jadwal.length; k++) {
      // Anggota tertib membayar pada atau sebelum jatuh tempo; hanya kelompok
      // "dalam perhatian khusus" yang terlambat.
      const telat = i % 8 === 3 ? antara(4, 20) : antara(-3, 0);
      const tglBayar = hariKe(jadwal[k].jatuh_tempo, telat);
      if (tglBayar > hariIni) break;
      try {
        // Denda ikut dibayar. Bila hanya angsuran pokok+bunga yang disetor,
        // alokasi denda→bunga→pokok membuat angsuran tidak pernah lunas dan
        // seluruh berkas yang pernah telat sehari pun ikut memburuk.
        const denda = loans.hitungDenda(p.id, tglBayar).total;
        loans.bayarAngsuran({ pinjaman_id: p.id, tanggal: tglBayar,
          nominal: jadwal[k].total + denda,
          metode: i % 4 === 0 ? 'transfer' : 'tunai' }, ctx);
      } catch { break; }
    }
  }

  // Satu pinjaman dilunasi dipercepat dan satu direstrukturisasi, agar kedua
  // alur tersebut memiliki jejak pada laporan.
  if (pinjamanDicairkan.length > 6) {
    try {
      loans.pelunasanDipercepat({ pinjaman_id: pinjamanDicairkan[2],
        tanggal: hariKe(hariIni, -antara(20, 90)), metode: 'tunai' }, ctx);
    } catch { /* jadwal sudah lunas - dilewati */ }
    try {
      loans.restrukturisasi({ pinjaman_id: pinjamanDicairkan[5], tenor_baru: 24, bunga_baru: 12,
        tanggal: hariKe(hariIni, -antara(30, 120)),
        alasan: 'Penurunan penghasilan anggota akibat pergantian pekerjaan.' }, ctx);
    } catch { /* dilewati */ }
  }
  loans.refreshSemuaKolektibilitas();

  // ----------------------------------------------------------------------
  // Operasional toko sepanjang rentang
  // ----------------------------------------------------------------------
  console.log('  → Membuat transaksi toko harian & pembelian rutin…');
  let bulanTerakhirRestok = '';
  let jumlahPenjualan = 0;
  const TARGET_STOK = 340;

  for (let hari = 0; hari <= rentangHari; hari++) {
    const tgl = hariKe(mulai, hari);
    if (tgl > hariIni) break;
    const periode = tgl.slice(0, 7);

    // Pembelian rutin awal bulan: memesan sampai stok kembali ke tingkat par.
    if (periode !== bulanTerakhirRestok && hari > 6) {
      bulanTerakhirRestok = periode;
      const items = barang.map((b, i) => {
        const kurang = TARGET_STOK - inventory.totalStok(i + 1);
        return kurang > 0 ? { barang_id: i + 1, qty: kurang, harga: b[4] } : null;
      }).filter(Boolean);
      if (items.length) {
        const supplierId = 1 + (Number(periode.slice(5)) % 5);
        const poRutin = trade.buatPembelian({ tanggal: tgl, tipe: 'po', supplier_id: supplierId,
          gudang_id: 1, unit_usaha_id: 2, cabang_id: 1, items }, ctx);
        trade.terimaBarang({ pembelian_id: poRutin.id, tanggal: hariKe(tgl, 2) > hariIni ? tgl : hariKe(tgl, 2),
          metode_bayar: rand() > 0.75 ? 'tunai' : 'hutang' }, ctx);
      }
    }

    if (new Date(`${tgl}T00:00:00Z`).getUTCDay() === 0) continue;      // toko tutup hari Minggu

    // Jumlah transaksi tumbuh perlahan sepanjang rentang - toko yang berkembang.
    const pertumbuhan = 12 + Math.round((hari / rentangHari) * 9);
    const jumlahTrx = pertumbuhan + antara(0, 5);
    for (let t = 0; t < jumlahTrx; t++) {
      const items = [];
      const dipakai = new Set();
      const n = 1 + Math.floor(rand() * 5);
      for (let x = 0; x < n; x++) {
        const bid = 1 + Math.floor(rand() * barang.length);
        if (dipakai.has(bid)) continue;
        dipakai.add(bid);
        items.push({ barang_id: bid, qty: 1 + Math.floor(rand() * 4) });
      }
      if (!items.length) continue;
      const r = rand();
      try {
        trade.jual({
          tanggal: tgl, tipe: 'pos', gudang_id: 1, unit_usaha_id: 2, cabang_id: 1,
          anggota_id: rand() > 0.35 ? anggotaIds[Math.floor(rand() * anggotaIds.length)] : null,
          items, metode_bayar: r > 0.86 ? 'qris' : r > 0.8 ? 'debit' : 'tunai',
        }, ctx);
        jumlahPenjualan++;
      } catch { /* stok tidak mencukupi - transaksi dilewati */ }
    }
  }
  console.log(`    ${jumlahPenjualan} transaksi penjualan dibuat.`);

  // Penjualan kredit kepada pelanggan non-anggota, agar piutang usaha terisi
  console.log('  → Mencatat penjualan kredit & retur…');
  for (let i = 0; i < 6; i++) {
    const tgl = hariKe(hariIni, -antara(5, 120));
    try {
      trade.jual({
        tanggal: tgl, tipe: 'kredit', gudang_id: 1, unit_usaha_id: 2, cabang_id: 1,
        customer_id: 1 + (i % 3), metode_bayar: 'kredit', jatuh_tempo: hariKe(tgl, 30),
        items: [{ barang_id: 1 + (i % barang.length), qty: antara(10, 30) },
          { barang_id: 1 + ((i + 5) % barang.length), qty: antara(5, 20) }],
      }, ctx);
    } catch { /* stok tidak mencukupi - dilewati */ }
  }
  const penjualanTerakhir = all(
    "SELECT id FROM penjualan WHERE tipe = 'pos' AND status = 'selesai' ORDER BY id DESC LIMIT 40");
  for (let i = 0; i < 3 && i < penjualanTerakhir.length; i++) {
    const pj = get('SELECT * FROM penjualan WHERE id = ?', [penjualanTerakhir[i * 7]?.id || penjualanTerakhir[i].id]);
    if (!pj) continue;
    const det = all('SELECT * FROM penjualan_detail WHERE penjualan_id = ? LIMIT 1', [pj.id]);
    if (!det.length) continue;
    try {
      trade.returPenjualan({ penjualan_id: pj.id, tanggal: pj.tanggal,
        items: [{ barang_id: det[0].barang_id, qty: 1 }],
        alasan: pick(['Kemasan rusak', 'Salah ukuran', 'Barang kedaluwarsa']) }, ctx);
    } catch { /* dilewati */ }
  }

  // ----------------------------------------------------------------------
  // Aset tetap
  // ----------------------------------------------------------------------
  console.log('  → Mencatat aset tetap, penyusutan & pemeliharaan…');
  const daftarAset = [
    ['AST001', 'Kendaraan Operasional (Pick Up)', 'kendaraan', `${tahunLalu - 2}-06-01`, 120_000_000, 24_000_000, 10, '1-1603', null],
    ['AST002', 'Sepeda Motor Petugas Lapangan', 'kendaraan', `${tahunLalu}-02-10`, 24_000_000, 4_000_000, 6, '1-1603', 1],
    ['AST003', 'Perangkat Komputer & Server', 'inventaris', `${tahunLalu}-01-05`, 36_000_000, 6_000_000, 5, '1-1604', null],
    ['AST004', 'Etalase & Rak Toko', 'inventaris', `${tahunLalu}-01-05`, 28_000_000, 3_000_000, 5, '1-1604', 2],
    ['AST005', 'Mesin Kasir & Barcode Scanner', 'inventaris', `${tahunLalu}-03-15`, 16_000_000, 2_000_000, 5, '1-1604', 2],
    ['AST006', 'Pendingin Ruangan Kantor', 'inventaris', `${tahunLalu}-05-20`, 22_000_000, 2_500_000, 5, '1-1604', null],
    ['AST007', 'Meja & Kursi Kantor', 'inventaris', `${tahunLalu}-01-20`, 19_000_000, 2_000_000, 5, '1-1604', null],
    ['AST008', 'Genset Cadangan', 'inventaris', `${tahun}-02-08`, 34_000_000, 5_000_000, 8, '1-1604', null],
  ];
  for (const [kode, nama, kategori, tglPerolehan, harga, residu, umur, coaAset, unit] of daftarAset) {
    if (tglPerolehan > hariIni) continue;
    assets.tambah({ kode, nama, kategori, tanggal_perolehan: tglPerolehan, harga_perolehan: harga,
      nilai_residu: residu, umur_manfaat: umur, coa_aset: coaAset, coa_akumulasi: '1-1699',
      coa_beban: '5-2301', cabang_id: 1, unit_usaha_id: unit }, ctx);
  }
  const asetIds = all('SELECT id, kode FROM aset_tetap ORDER BY id');
  for (const a of asetIds.slice(0, 5)) {
    const tgl = hariKe(hariIni, -antara(20, 400));
    try {
      assets.maintenance(a.id, { tanggal: tgl, jenis: pick(['servis_berkala', 'perbaikan', 'kalibrasi']),
        biaya: antara(3, 25) * 100_000, vendor: pick(['Bengkel Mitra Jaya', 'CV Teknik Sejahtera', 'PT Servis Andalan']),
        keterangan: 'Pemeliharaan rutin sesuai jadwal', jadwal_berikutnya: hariKe(tgl, 180) }, ctx);
    } catch { /* dilewati */ }
  }

  // ----------------------------------------------------------------------
  // Beban operasional bulanan
  // ----------------------------------------------------------------------
  console.log('  → Membukukan beban operasional & jasa simpanan bulanan…');
  for (const p of periodeLengkap) {
    const akhir = akhirBulan(p);
    // Gaji tumbuh sedikit pada tahun berjalan, seperti kenaikan berkala.
    const faktor = p.startsWith(String(tahun)) ? 1.08 : 1;
    postJournal({
      tanggal: akhir, tipe: 'umum', keterangan: `Beban operasional bulan ${p}`,
      lines: [
        { coa_kode: '5-2201', debit: Math.round(9_600_000 * faktor), keterangan: 'Gaji & tunjangan karyawan' },
        { coa_kode: '5-2202', debit: Math.round(1_250_000 * faktor), keterangan: 'Listrik, air & telekomunikasi' },
        { coa_kode: '5-2203', debit: 420_000, keterangan: 'Alat tulis kantor' },
        // Gedung kantor milik sendiri; sewa hanya untuk ruang usaha toko.
        { coa_kode: '5-2204', debit: 1_500_000, keterangan: 'Sewa ruang usaha toko' },
        { coa_kode: '1-1101', kredit: Math.round(9_600_000 * faktor) + 420_000,
          keterangan: 'Pembayaran tunai beban operasional' },
        { coa_kode: '1-1201', kredit: Math.round(1_250_000 * faktor) + 1_500_000,
          keterangan: 'Pembayaran beban melalui bank' },
      ],
    }, ctx);
    assets.jalankanPenyusutan(p, ctx);
    try {
      posBungaBulanan({ periode: p, tanggal: akhir }, ctx);
    } catch { /* tidak ada rekening berbunga pada periode ini */ }
  }

  // Beban organisasi & pendidikan - tidak setiap bulan
  for (const p of periodeLengkap.filter((_, i) => i % 4 === 1)) {
    postJournal({
      tanggal: akhirBulan(p), tipe: 'umum', keterangan: `Beban organisasi & pendidikan ${p}`,
      lines: [
        { coa_kode: '5-2401', debit: 2_200_000, keterangan: 'Rapat pengurus & pengawas' },
        { coa_kode: '5-2402', debit: 1_800_000, keterangan: 'Pendidikan & pelatihan anggota' },
        { coa_kode: '1-1101', kredit: 4_000_000, keterangan: 'Pembayaran tunai' },
      ],
    }, ctx);
  }

  // Penyisihan kerugian piutang pinjaman pada akhir tiap tahun buku
  for (const th of [tahunLalu]) {
    postJournal({
      tanggal: `${th}-12-31`, tipe: 'penyesuaian', keterangan: `Penyisihan kerugian piutang tahun ${th}`,
      lines: [
        { coa_kode: '5-2501', debit: 6_500_000, keterangan: 'Pembentukan cadangan kerugian piutang' },
        { coa_kode: '1-1319', kredit: 6_500_000, keterangan: 'Cadangan kerugian piutang' },
      ],
    }, ctx);
  }

  // ----------------------------------------------------------------------
  // Kas & bank
  // ----------------------------------------------------------------------
  console.log('  → Mencatat bukti kas, transfer & cash opname…');
  /** Bukti kas masuk/keluar beserta jurnalnya, mengikuti alur modul Kas & Bank. */
  function buktiKas({ jenis, tanggal, coaKas, coaLawan, nominal, keterangan, pihak, unitUsaha = null }) {
    const masuk = jenis === 'kas_masuk';
    const nomor = nextNumber(masuk ? 'BKM' : 'BKK', tanggal);
    const jurnal = postJournal({
      nomor, tanggal, tipe: masuk ? 'kas_masuk' : 'kas_keluar', keterangan,
      cabang_id: 1, unit_usaha_id: unitUsaha,
      lines: masuk
        ? [{ coa_kode: coaKas, debit: nominal }, { coa_kode: coaLawan, kredit: nominal }]
        : [{ coa_kode: coaLawan, debit: nominal }, { coa_kode: coaKas, kredit: nominal }],
    }, ctx);
    run(`INSERT INTO kas_bank(nomor, tanggal, jenis, coa_kas, coa_lawan, nominal, keterangan, pihak,
           cabang_id, unit_usaha_id, jurnal_id, rekonsiliasi, tanggal_rekon, dibuat_oleh)
         VALUES(?,?,?,?,?,?,?,?,1,?,?,?,?,'bendahara1')`,
    [nomor, tanggal, jenis, coaKas, coaLawan, nominal, keterangan, pihak || null, unitUsaha,
      jurnal.id, tanggal < hariKe(hariIni, -20) ? 1 : 0,
      tanggal < hariKe(hariIni, -20) ? hariKe(tanggal, 5) : null]);
  }

  for (const p of periodeLengkap) {
    const akhir = akhirBulan(p);
    // Setoran hasil penjualan toko dari kas ke bank
    buktiKas({ jenis: 'kas_keluar', tanggal: hariKe(akhir, -3), coaKas: '1-1101', coaLawan: '1-1501',
      nominal: 1_500_000, keterangan: `Pembayaran asuransi dibayar di muka ${p}`, pihak: 'PT Asuransi Mitra' });
    if (Number(p.slice(5)) % 3 === 0) {
      buktiKas({ jenis: 'kas_masuk', tanggal: hariKe(akhir, -5), coaKas: '1-1201', coaLawan: '4-1301',
        nominal: antara(8, 24) * 100_000, keterangan: `Jasa giro bank ${p}`, pihak: 'Bank BRI' });
    }
  }
  // Transfer antar kas & bank
  for (const p of periodeLengkap.filter((_, i) => i % 2 === 0)) {
    const tgl = hariKe(akhirBulan(p), -8);
    const nominal = antara(15, 45) * 1_000_000;
    const nomor = nextNumber('TRF', tgl);
    const jurnal = postJournal({
      nomor, tanggal: tgl, tipe: 'umum', keterangan: 'Setoran kas toko ke rekening bank',
      lines: [{ coa_kode: '1-1201', debit: nominal }, { coa_kode: '1-1101', kredit: nominal }],
    }, ctx);
    run(`INSERT INTO kas_bank(nomor, tanggal, jenis, coa_kas, coa_lawan, coa_tujuan, nominal,
           keterangan, cabang_id, jurnal_id, rekonsiliasi, tanggal_rekon, dibuat_oleh)
         VALUES(?,?,'transfer','1-1101','1-1201','1-1201',?,?,1,?,?,?,'bendahara1')`,
    [nomor, tgl, nominal, 'Setoran kas toko ke rekening bank', jurnal.id,
      tgl < hariKe(hariIni, -20) ? 1 : 0, tgl < hariKe(hariIni, -20) ? hariKe(tgl, 4) : null]);
  }
  // Cash opname triwulanan; sesekali ada selisih kecil yang langsung dibukukan
  for (const p of periodeLengkap.filter((_, i) => i % 3 === 2)) {
    const tgl = akhirBulan(p);
    const sistem = saldoAkun('1-1101', { sampai: tgl }).saldo;
    const selisih = rand() > 0.7 ? -antara(5, 60) * 1_000 : 0;
    const fisik = sistem + selisih;
    let jurnalOpname = null;
    if (selisih !== 0) {
      jurnalOpname = postJournal({
        tanggal: tgl, tipe: 'penyesuaian', referensi: `opname_kas:1-1101:${p}`,
        keterangan: `Penyesuaian cash opname 1-1101 per ${tgl}`,
        lines: [{ coa_kode: '5-2901', debit: -selisih, keterangan: 'Selisih kurang kas' },
          { coa_kode: '1-1101', kredit: -selisih, keterangan: 'Selisih kurang kas' }],
      }, ctx);
    }
    run(`INSERT INTO cash_opname(tanggal, coa_kas, saldo_sistem, saldo_fisik, selisih, keterangan,
           jurnal_id, petugas) VALUES(?,'1-1101',?,?,?,?,?,'bendahara1')`,
    [tgl, sistem, fisik, selisih,
      selisih === 0 ? 'Saldo fisik sesuai catatan' : 'Selisih kurang, ditelusuri ke transaksi kasir',
      jurnalOpname?.id || null]);
  }

  // ----------------------------------------------------------------------
  // Stock opname
  // ----------------------------------------------------------------------
  console.log('  → Melaksanakan stock opname berkala…');
  for (const p of periodeLengkap.filter((_, i) => i % 4 === 3)) {
    const tgl = akhirBulan(p);
    try {
      const op = inventory.mulaiOpname({ gudang_id: 1, tanggal: tgl,
        keterangan: `Stock opname periode ${p}` }, ctx);
      const detail = op.detail.map((d) => {
        // Selisih kecil pada sebagian item, sisanya cocok.
        const beda = rand() > 0.82 ? -antara(1, 3) : 0;
        return { barang_id: d.barang_id, qty_fisik: Math.max(0, d.qty_sistem + beda) };
      });
      inventory.selesaikanOpname(op.id, detail, ctx);
    } catch { /* dilewati bila periode sudah ditutup */ }
  }

  // Transfer antar gudang
  try {
    inventory.transferGudang({ barang_id: 1, dari_gudang_id: 1, ke_gudang_id: 2, qty: 20,
      tanggal: hariKe(hariIni, -30), keterangan: 'Pemenuhan stok cabang Bekasi' }, ctx);
  } catch { /* dilewati */ }

  // ----------------------------------------------------------------------
  // Pelunasan utang pemasok
  // ----------------------------------------------------------------------
  console.log('  → Melunasi utang pemasok yang telah jatuh tempo…');
  let urutBayar = 0;
  for (const h of all(
    "SELECT * FROM hutang_piutang WHERE jenis = 'hutang' AND status = 'terbuka' ORDER BY jatuh_tempo")) {
    if (h.jatuh_tempo >= hariIni) continue;
    try {
      trade.bayarHutangPiutang({ id: h.id, tanggal: h.jatuh_tempo,
        nominal: h.nominal - h.terbayar, metode: urutBayar++ % 2 === 0 ? 'tunai' : 'transfer' }, ctx);
    } catch { /* dilewati bila periode sudah ditutup */ }
  }
  // Sebagian piutang usaha pelanggan dilunasi
  for (const h of all(
    "SELECT * FROM hutang_piutang WHERE jenis = 'piutang' AND status = 'terbuka' ORDER BY jatuh_tempo LIMIT 4")) {
    if (h.jatuh_tempo >= hariIni) continue;
    try {
      trade.bayarHutangPiutang({ id: h.id, tanggal: h.jatuh_tempo,
        nominal: h.nominal - h.terbayar, metode: 'transfer' }, ctx);
    } catch { /* dilewati */ }
  }

  // ----------------------------------------------------------------------
  // Tutup buku tahun lalu, RAT, dan pembagian SHU
  // ----------------------------------------------------------------------
  console.log(`  → Menutup tahun buku ${tahunLalu} & membagikan SHU…`);
  jurnalPenutup(tahunLalu, ctx);

  const totalAnggota = scalar("SELECT COUNT(*) FROM anggota WHERE status = 'aktif'");
  run(`INSERT INTO rat(nomor, tahun_buku, judul, tanggal, waktu, tempat, jenis, total_anggota,
         kuorum_persen, status, berita_acara)
       VALUES('RAT/${tahun}/02/00001',${tahunLalu},'Rapat Anggota Tahunan Tahun Buku ${tahunLalu}',
       '${tahun}-02-25','09.00 WIB','Aula Koperasi','tahunan',?,50,'selesai',
       'Rapat dibuka pukul 09.15 WIB setelah kuorum terpenuhi. Seluruh agenda dibahas dan '
       || 'disahkan, termasuk pengesahan laporan keuangan dan pembagian SHU tahun buku ${tahunLalu}.')`,
  [totalAnggota]);
  const ratId = scalar('SELECT id FROM rat ORDER BY id DESC LIMIT 1');
  const agenda = ['Pembukaan dan pengesahan kuorum',
    `Laporan Pertanggungjawaban Pengurus Tahun Buku ${tahunLalu}`,
    'Laporan Pengawas', 'Pengesahan Laporan Keuangan', 'Pembagian SHU',
    `Rencana Kerja & RAPB Tahun ${tahun}`, 'Lain-lain dan penutup'];
  const agendaIds = agenda.map((j, i) => run(
    'INSERT INTO rat_agenda(rat_id, urut, judul, jenis, status) VALUES(?,?,?,?,?)',
    [ratId, i + 1, j, [3, 4, 5].includes(i) ? 'voting' : i === 1 || i === 2 ? 'laporan' : 'pembahasan',
      'selesai']).lastInsertRowid);

  // Kehadiran: 78% hadir, sebagian di antaranya memberi kuasa kepada anggota lain.
  const hadirIds = [];
  for (const [idx, aid] of anggotaIds.entries()) {
    const hadir = rand() < 0.78;
    if (hadir) hadirIds.push(aid);
    run(`INSERT INTO rat_peserta(rat_id, anggota_id, hadir, waktu_hadir, kuasa_kepada, ttd_elektronik)
         VALUES(?,?,?,?,?,?)`,
    [ratId, aid, hadir ? 1 : 0,
      hadir ? `${tahun}-02-25 0${antara(8, 9)}:${String(antara(10, 59)).padStart(2, '0')}:00` : null,
      !hadir && idx % 4 === 0 ? anggotaIds[(idx + 1) % anggotaIds.length] : null,
      hadir ? crypto.createHash('sha256').update(`rat:${ratId}:${aid}`).digest('hex') : null]);
  }

  // Voting dua agenda: pengesahan laporan keuangan dan pembagian SHU.
  const votingDef = [
    [agendaIds[3], 'Pengesahan Laporan Keuangan Tahun Buku ' + tahunLalu, 0.94],
    [agendaIds[4], 'Persetujuan Pembagian SHU Tahun Buku ' + tahunLalu, 0.91],
  ];
  for (const [agendaId, judulVoting, dukungan] of votingDef) {
    const votingId = run(
      `INSERT INTO rat_voting(rat_id, agenda_id, judul, opsi, mulai, selesai, status)
       VALUES(?,?,?,?,?,?,'ditutup')`,
      [ratId, agendaId, judulVoting, JSON.stringify(['setuju', 'tidak_setuju', 'abstain']),
        `${tahun}-02-25 10:00:00`, `${tahun}-02-25 10:30:00`]).lastInsertRowid;
    const rekap = { setuju: 0, tidak_setuju: 0, abstain: 0 };
    for (const aid of hadirIds) {
      const r = rand();
      const pilihan = r < dukungan ? 'setuju' : r < dukungan + 0.05 ? 'abstain' : 'tidak_setuju';
      rekap[pilihan] += 1;
      run('INSERT INTO rat_suara(voting_id, anggota_id, pilihan, waktu) VALUES(?,?,?,?)',
        [votingId, aid, pilihan, `${tahun}-02-25 10:${String(antara(1, 29)).padStart(2, '0')}:00`]);
    }
    run('UPDATE rat_voting SET hasil = ? WHERE id = ?', [JSON.stringify(rekap), votingId]);
  }

  const usulan = shu.simpanUsulan(tahunLalu, null, ctx);
  shu.sahkan(usulan.periode_id, { rat_id: ratId, tanggal: `${tahun}-02-25` }, ctx);
  shu.bagikan(usulan.periode_id, { metode: 'simpanan', tanggal: `${tahun}-03-10` }, ctx);
  console.log(`    SHU tahun ${tahunLalu}: Rp ${usulan.shu_bersih.toLocaleString('id-ID')} `
    + `dibagikan kepada ${usulan.per_anggota.length} anggota.`);

  // ----------------------------------------------------------------------
  // Anggaran (RKAP) dua tahun
  // ----------------------------------------------------------------------
  console.log('  → Menyusun RKAP…');
  const rkapPos = [
    ['4-1101', 1_400_000_000], ['4-1201', 220_000_000], ['4-1202', 18_000_000],
    ['4-1203', 4_000_000], ['4-1301', 6_000_000],
    ['5-1101', 1_120_000_000], ['5-2101', 14_000_000], ['5-2201', 120_000_000],
    ['5-2202', 15_000_000], ['5-2203', 5_000_000], ['5-2204', 30_000_000],
    ['5-2301', 45_000_000], ['5-2401', 12_000_000], ['5-2402', 9_000_000],
  ];
  for (const th of [tahunLalu, tahun]) {
    const anggaranId = run(
      `INSERT INTO anggaran(tahun, nama, cabang_id, status, keterangan)
       VALUES(?,?,1,'disetujui','Rencana Kerja dan Anggaran Pendapatan Belanja Koperasi')`,
      [th, `RKAP Tahun ${th}`]).lastInsertRowid;
    for (const [kode, nominal] of rkapPos) {
      // Anggaran tahun berjalan naik 12% dari tahun sebelumnya.
      const nilai = th === tahun ? Math.round(nominal * 1.12) : nominal;
      run('INSERT INTO anggaran_detail(anggaran_id, coa_kode, bulan, nominal) VALUES(?,?,0,?)',
        [anggaranId, kode, nilai]);
    }
  }

  // ----------------------------------------------------------------------
  // Tata kelola: kepatuhan, audit, risiko
  // ----------------------------------------------------------------------
  console.log('  → Mengisi data tata kelola (kepatuhan, audit, risiko)…');
  run(`INSERT INTO compliance_item(kategori, nama, dasar_hukum, nomor, penerbit, tanggal_terbit,
         tanggal_kadaluarsa, pic, status) VALUES
       ('legalitas','Akta Pendirian & Badan Hukum Koperasi','UU No. 25 Tahun 1992','518/BH/XIV.4/2018',
        'Kementerian Koperasi dan UKM','2018-03-15',NULL,'Sekretaris','patuh'),
       ('oss','Nomor Induk Berusaha (NIB)','PP No. 5 Tahun 2021','1234567890123','OSS RBA',
        '2021-06-10',NULL,'Sekretaris','patuh'),
       ('perpajakan','Surat Keterangan Terdaftar NPWP','UU KUP','01.234.567.8-901.000',
        'Direktorat Jenderal Pajak','2018-04-01',NULL,'Bendahara','patuh'),
       ('perpajakan','Pelaporan SPT Tahunan PPh Badan','UU No. 7 Tahun 2021','SPT-${tahunLalu}',
        'DJP','${tahun}-04-30','${tahun + 1}-04-30','Bendahara','patuh'),
       ('perkoperasian','Laporan RAT ke Dinas Koperasi','UU No. 25 Tahun 1992 Pasal 30','RAT-${tahunLalu}',
        'Dinas Koperasi','${tahun}-03-31','${tahun}-06-30','Sekretaris','perlu_perhatian'),
       ('ketenagakerjaan','Kepesertaan BPJS Ketenagakerjaan','UU No. 24 Tahun 2011','BPJS-TK-001',
        'BPJS Ketenagakerjaan','2019-01-01',NULL,'Manajer','patuh'),
       ('ketenagakerjaan','Kepesertaan BPJS Kesehatan','UU No. 24 Tahun 2011','BPJS-KS-001',
        'BPJS Kesehatan','2019-01-01',NULL,'Manajer','patuh'),
       ('legalitas','Izin Usaha Toko Koperasi','Perda setempat','IUMK-${tahunLalu}-455','Pemerintah Daerah',
        '${tahunLalu}-05-01','${tahun}-12-31','Manajer Unit','patuh'),
       ('perlindungan_data','Kebijakan Pelindungan Data Anggota','UU No. 27 Tahun 2022','KEB/PDP/01',
        'Pengurus Koperasi','${tahunLalu}-09-01',NULL,'Super Administrator','patuh')`);

  run(`INSERT INTO audit_plan(nomor, judul, tahun, objek, auditor, tanggal_mulai, tanggal_selesai,
         ruang_lingkup, status) VALUES
       ('AUD/${tahunLalu}/09/00001','Audit Internal Unit Toko Koperasi',${tahunLalu},'Unit Toko',
        'Ir. Bagus Prakoso','${tahunLalu}-09-01','${tahunLalu}-09-12',
        'Pengelolaan kas kasir, persediaan, dan penerimaan barang','selesai'),
       ('AUD/${tahun}/04/00002','Audit Internal Unit Simpan Pinjam',${tahun},'Unit Simpan Pinjam',
        'Ir. Bagus Prakoso','${tahun}-04-01','${tahun}-04-15',
        'Prosedur pemberian pinjaman, penilaian kolektibilitas, dan penagihan','selesai'),
       ('AUD/${tahun}/05/00003','Audit Persediaan & Kas Toko Koperasi',${tahun},'Unit Toko',
        'Ir. Bagus Prakoso','${tahun}-05-02','${tahun}-05-10',
        'Pengelolaan persediaan, stock opname, dan penerimaan kas','berjalan')`);

  run(`INSERT INTO audit_temuan(plan_id, kode, judul, deskripsi, kriteria, sebab, akibat, rekomendasi,
         risk_rating, capa, pic, batas_waktu, status) VALUES
       (1,'TMN-${tahunLalu}-01','Bukti serah terima barang tidak selalu diarsipkan',
        'Sebagian penerimaan barang dari pemasok tidak dilengkapi surat jalan yang ditandatangani.',
        'SOP Pembelian butir 5.1 mewajibkan arsip surat jalan bertanda tangan.',
        'Petugas gudang menerima barang tanpa pendampingan administrasi.',
        'Selisih penerimaan sulit ditelusuri bila terjadi sengketa dengan pemasok.',
        'Mewajibkan tanda tangan dua pihak dan pemindaian surat jalan ke sistem.',
        'sedang','Prosedur penerimaan diperbarui dan disosialisasikan.',
        'Staf Gudang','${tahunLalu}-11-30','selesai'),
       (2,'TMN-${tahun}-01','Dokumen agunan tidak lengkap pada 3 berkas pinjaman',
        'Tiga berkas pinjaman produktif tidak dilengkapi salinan bukti kepemilikan agunan.',
        'SOP Pinjaman butir 4.2 mewajibkan salinan agunan diarsipkan sebelum pencairan.',
        'Pengendalian kelengkapan berkas belum dijalankan konsisten.',
        'Potensi kesulitan eksekusi agunan bila terjadi gagal bayar.',
        'Melengkapi berkas dan menerapkan checklist wajib sebelum pencairan.',
        'tinggi','Checklist kelengkapan berkas diterapkan pada sistem sejak ${tahun}-05-01',
        'Petugas Pinjaman','${tahun}-06-30','selesai'),
       (2,'TMN-${tahun}-02','Keterlambatan penagihan angsuran tertunggak',
        'Penagihan atas angsuran yang telah lewat jatuh tempo baru dilakukan setelah 30 hari.',
        'SOP Penagihan mewajibkan pengingat pada H-3 dan H+1 jatuh tempo.',
        'Belum ada mekanisme pengingat otomatis.',
        'Meningkatnya rasio kredit bermasalah (NPL).',
        'Mengaktifkan pengingat otomatis dan laporan tagihan harian.',
        'sedang','Modul Collection dengan daftar tagihan harian diaktifkan.',
        'Petugas Pinjaman','${tahun}-07-31','proses'),
       (3,'TMN-${tahun}-03','Selisih stok pada barang cepat laku',
        'Ditemukan selisih kurang pada beberapa item sembako saat uji petik.',
        'Kebijakan persediaan: selisih maksimal 0,5% dari nilai persediaan.',
        'Pencatatan mutasi keluar tidak selalu bersamaan dengan penyerahan barang.',
        'Nilai persediaan pada laporan keuangan berpotensi lebih saji.',
        'Melaksanakan stock opname bulanan dan penerapan barcode pada seluruh item.',
        'sedang',NULL,'Staf Gudang','${tahun}-08-31','terbuka')`);

  run(`INSERT INTO risiko(kode, nama, kategori, deskripsi, penyebab, dampak_deskripsi, unit_usaha_id,
         likelihood, impact, skor_inheren, kontrol, efektivitas_kontrol, likelihood_residu,
         impact_residu, skor_residu, mitigasi, pic, kri_nama, kri_ambang, kri_nilai) VALUES
       ('RSK-001','Gagal bayar pinjaman anggota','kredit',
        'Anggota tidak mampu melunasi angsuran sesuai jadwal.',
        'Penurunan penghasilan anggota, analisis kelayakan yang kurang mendalam.',
        'Penurunan pendapatan jasa dan meningkatnya kebutuhan penyisihan kerugian.',
        1,4,4,16,'Credit scoring 5C, verifikasi agunan, dan pemantauan kolektibilitas.','sedang',3,3,9,
        'Memperketat batas DSR maksimal 40% dan mewajibkan agunan di atas plafon tertentu.',
        'Manajer Unit Simpan Pinjam','Rasio NPL (%)',5,0),
       ('RSK-002','Ketidakcukupan likuiditas saat penarikan simpanan','likuiditas',
        'Permintaan penarikan simpanan melebihi ketersediaan kas.',
        'Konsentrasi jatuh tempo simpanan berjangka dan penyaluran pinjaman yang agresif.',
        'Koperasi tidak dapat memenuhi kewajiban kepada anggota tepat waktu.',
        1,3,5,15,'Proyeksi arus kas bulanan dan batas minimum kas operasional.','kuat',2,4,8,
        'Menjaga cadangan likuiditas minimal 10% dari total simpanan.','Bendahara',
        'Rasio kas terhadap simpanan (%)',10,0),
       ('RSK-003','Selisih dan kehilangan persediaan toko','operasional',
        'Barang hilang, rusak, atau tidak tercatat pada sistem.',
        'Pengendalian fisik gudang lemah dan pencatatan manual.',
        'Kerugian langsung serta salah saji nilai persediaan.',
        2,3,3,9,'Stock opname berkala, barcode, dan pemisahan tugas gudang-kasir.','sedang',2,2,4,
        'Stock opname bulanan dan rekonsiliasi harian kasir.','Manajer Unit Toko',
        'Selisih opname terhadap nilai persediaan (%)',0.5,0),
       ('RSK-004','Ketidakpatuhan pelaporan kepada Dinas Koperasi','kepatuhan',
        'Laporan RAT dan laporan tahunan terlambat disampaikan.',
        'Belum adanya pemantauan tenggat kewajiban pelaporan.',
        'Sanksi administratif hingga pembekuan izin usaha.',
        NULL,2,4,8,'Modul Compliance dengan pengingat masa berlaku dokumen.','kuat',1,4,4,
        'Menetapkan PIC dan tenggat internal satu bulan lebih awal.','Sekretaris',
        'Jumlah kewajiban terlambat',0,0),
       ('RSK-005','Kebocoran data pribadi anggota','teknologi',
        'Akses tidak sah terhadap basis data anggota.',
        'Pengelolaan hak akses yang longgar dan tidak adanya MFA.',
        'Pelanggaran UU PDP serta hilangnya kepercayaan anggota.',
        NULL,2,5,10,'RBAC berlapis, MFA, audit trail berantai, dan pencadangan berkala.','kuat',1,4,4,
        'Mewajibkan MFA bagi seluruh pengguna dengan hak akses transaksi.','Super Administrator',
        'Insiden keamanan per tahun',0,0),
       ('RSK-006','Ketergantungan pada pemasok tunggal','operasional',
        'Sebagian besar pasokan sembako berasal dari satu pemasok.',
        'Belum adanya kebijakan diversifikasi pemasok.',
        'Gangguan pasokan langsung menghentikan penjualan toko.',
        2,3,4,12,'Evaluasi pemasok berkala dan kontrak dengan dua pemasok cadangan.','sedang',2,3,6,
        'Menetapkan porsi maksimal 60% pembelian dari satu pemasok.','Manajer Unit Toko',
        'Porsi pembelian pemasok terbesar (%)',60,0)`);

  // ----------------------------------------------------------------------
  // Dokumen & persuratan
  // ----------------------------------------------------------------------
  console.log('  → Membuat dokumen, versi & persuratan…');
  const dokumen = [
    ['AD/2018/01', 'Anggaran Dasar Koperasi', 'ad_art', 'Anggaran Dasar yang disahkan pada rapat pendirian', 'Sekretaris', 30],
    ['ART/2018/01', 'Anggaran Rumah Tangga', 'ad_art', 'Aturan pelaksanaan Anggaran Dasar', 'Sekretaris', 30],
    ['SOP/SP/01', 'SOP Pemberian Pinjaman', 'sop', 'Prosedur pengajuan hingga pencairan pinjaman', 'Manajer', 10],
    ['SOP/TK/01', 'SOP Operasional Toko Koperasi', 'sop', 'Prosedur kasir, penerimaan barang, dan stock opname', 'Manajer', 10],
    ['SOP/KAS/01', 'SOP Pengelolaan Kas & Bank', 'sop', 'Prosedur bukti kas, transfer, dan cash opname', 'Bendahara', 10],
    ['KEB/AKT/01', 'Kebijakan Akuntansi Koperasi', 'kebijakan', 'Mengacu Permenkop UKM No. 2 Tahun 2024 dan SAK EP', 'Bendahara', 10],
    ['KEB/PDP/01', 'Kebijakan Pelindungan Data Anggota', 'kebijakan', 'Penerapan UU No. 27 Tahun 2022', 'Super Administrator', 10],
    [`LAP/RAT/${tahunLalu}`, `Laporan Pertanggungjawaban Pengurus ${tahunLalu}`, 'laporan', 'Disahkan pada RAT tahun buku ' + tahunLalu, 'Pengurus', 10],
  ];
  dokumen.forEach(([nomor, judulDok, kategori, deskripsi, pemilik, retensi], i) => {
    const id = run(`INSERT INTO dokumen(nomor, judul, kategori, deskripsi, status, pemilik, retensi_tahun)
                    VALUES(?,?,?,?,'disetujui',?,?)`,
    [nomor, judulDok, kategori, deskripsi, pemilik, retensi]).lastInsertRowid;
    // Dua versi untuk dokumen yang pernah direvisi
    const versi = i % 3 === 0 ? 2 : 1;
    for (let v = 1; v <= versi; v++) {
      run(`INSERT INTO dokumen_versi(dokumen_id, versi, file_path, hash_sha256, catatan, oleh)
           VALUES(?,?,?,?,?,?)`,
      [id, v, `dokumen/${nomor.replace(/\//g, '-')}-v${v}.pdf`,
        crypto.createHash('sha256').update(`${nomor}|v${v}`).digest('hex'),
        v === 1 ? 'Versi awal' : 'Revisi menyesuaikan peraturan terbaru', pemilik]);
    }
  });
  run(`INSERT INTO surat(nomor, jenis, tanggal, perihal, dari, kepada, sifat, status) VALUES
       ('001/KSU/${tahun}','keluar','${tahun}-02-10','Undangan Rapat Anggota Tahunan','Pengurus Koperasi','Seluruh Anggota','penting','selesai'),
       ('002/KSU/${tahun}','keluar','${tahun}-03-05','Laporan Tahunan kepada Dinas Koperasi','Pengurus Koperasi','Dinas Koperasi dan UKM','penting','selesai'),
       ('003/KSU/${tahun}','keluar','${tahun}-04-18','Permohonan Kerja Sama Pemasok','Manajer Unit Toko','PT Sumber Pangan Sejahtera','biasa','selesai'),
       ('015/DK/${tahun}','masuk','${tahun}-03-20','Pemberitahuan Pembinaan Koperasi','Dinas Koperasi dan UKM','Pengurus Koperasi','biasa','diproses'),
       ('022/BPR/${tahun}','masuk','${tahun}-05-14','Penawaran Kerja Sama Pembiayaan','BPR Mitra Usaha','Pengurus Koperasi','biasa','baru')`);

  // ----------------------------------------------------------------------
  // Jurnal berulang & pajak
  // ----------------------------------------------------------------------
  run(`INSERT INTO jurnal_recurring(nama, frekuensi, tanggal_mulai, template, terakhir_dibuat) VALUES
       ('Beban sewa ruang usaha','bulanan','${mulai}',?,?),
       ('Amortisasi asuransi dibayar di muka','bulanan','${mulai}',?,?)`,
  [JSON.stringify([{ coa_kode: '5-2204', debit: 1_500_000, keterangan: 'Sewa ruang usaha toko' },
    { coa_kode: '1-1201', kredit: 1_500_000, keterangan: 'Pembayaran sewa' }]),
  akhirBulan(periodeLengkap[periodeLengkap.length - 1] || mulai.slice(0, 7)),
  JSON.stringify([{ coa_kode: '5-2902', debit: 1_500_000, keterangan: 'Amortisasi asuransi' },
    { coa_kode: '1-1501', kredit: 1_500_000, keterangan: 'Asuransi dibayar di muka' }]),
  akhirBulan(periodeLengkap[periodeLengkap.length - 1] || mulai.slice(0, 7))]);

  // ----------------------------------------------------------------------
  // Persetujuan berjenjang
  // ----------------------------------------------------------------------
  console.log('  → Membuat permintaan persetujuan…');
  const menungguKeputusan = all(
    "SELECT id, nomor, pokok, anggota_id FROM pinjaman WHERE status = 'diajukan' ORDER BY id DESC");
  for (const [i, p] of menungguKeputusan.entries()) {
    const a = get('SELECT nama FROM anggota WHERE id = ?', [p.anggota_id]);
    try {
      const req = approval.ajukan({ modul: 'pinjaman', entitas_id: p.id,
        judul: `Persetujuan pinjaman ${p.nomor}`, nominal: p.pokok,
        ringkasan: `Pengajuan a.n. ${a?.nama} sebesar Rp ${p.pokok.toLocaleString('id-ID')}`,
        pemohon_id: 1 }, ctx);
      // Satu permintaan sudah melewati tahap pertama agar alurnya terlihat.
      if (req && i === 0) {
        approval.putuskan(req.id, { keputusan: 'setuju',
          catatan: 'Analisis kelayakan memadai, dilanjutkan ke tahap berikutnya.' },
        ctxPeran('petugas_pinjaman'));
      }
    } catch { /* dilewati */ }
  }
  // Beberapa permintaan yang sudah selesai, untuk mengisi riwayat
  const sudahCair = all("SELECT id, nomor, pokok FROM pinjaman WHERE status = 'dicairkan' ORDER BY id LIMIT 4");
  for (const p of sudahCair) {
    try {
      const req = approval.ajukan({ modul: 'pinjaman', entitas_id: p.id,
        judul: `Persetujuan pinjaman ${p.nomor}`, nominal: p.pokok,
        ringkasan: 'Permintaan telah diselesaikan', pemohon_id: 1 }, ctx);
      if (!req) continue;
      for (const role of ['petugas_pinjaman', 'manajer_unit', 'pengurus', 'pengawas']) {
        try {
          approval.putuskan(req.id, { keputusan: 'setuju', catatan: 'Disetujui sesuai kewenangan.' },
            ctxPeran(role));
        } catch { /* tahap tidak lagi menunggu peran ini */ }
      }
    } catch { /* dilewati */ }
  }

  // ----------------------------------------------------------------------
  // CRM: tiket, balasan, broadcast, survei
  // ----------------------------------------------------------------------
  console.log('  → Mengisi layanan anggota (tiket, broadcast, survei)…');
  const tiketDef = [
    ['pertanyaan', 'normal', 'Cara mengajukan pinjaman produktif',
      'Mohon penjelasan syarat dan dokumen yang diperlukan.', 'aplikasi', 'selesai', 5],
    ['pengaduan', 'tinggi', 'Saldo simpanan sukarela belum bertambah',
      'Setoran tanggal 15 belum terlihat pada aplikasi.', 'whatsapp', 'selesai', 4],
    ['saran', 'rendah', 'Usulan penambahan jenis barang di toko',
      'Mohon disediakan produk kebutuhan bayi.', 'langsung', 'diproses', 5],
    ['pengaduan', 'normal', 'Struk belanja tidak tercetak',
      'Transaksi berhasil namun struk tidak keluar dari mesin kasir.', 'aplikasi', 'selesai', 4],
    ['pertanyaan', 'normal', 'Kapan SHU dibagikan?',
      'Ingin memastikan jadwal pembagian SHU tahun buku lalu.', 'whatsapp', 'selesai', 5],
    ['pengaduan', 'tinggi', 'Angsuran sudah dibayar tetapi masih tercatat tertunggak',
      'Pembayaran melalui transfer tanggal 3, mohon dicek kembali.', 'telepon', 'diproses', null],
    ['saran', 'rendah', 'Permintaan layanan setoran via transfer',
      'Agar tidak perlu datang ke kantor setiap bulan.', 'aplikasi', 'baru', null],
  ];
  tiketDef.forEach(([kategori, prioritas, judulTiket, isi, kanal, status, rating], i) => {
    const dibuat = hariKe(hariIni, -antara(3, 200));
    const tid = run(`INSERT INTO tiket(nomor, anggota_id, kategori, prioritas, judul, isi, kanal, status,
           rating, petugas, created_at, selesai_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    [`TKT/${tahun}/${String(antara(1, 8)).padStart(2, '0')}/${String(i + 1).padStart(5, '0')}`,
      anggotaIds[i * 3 % anggotaIds.length], kategori, prioritas, judulTiket, isi, kanal, status,
      rating, status === 'baru' ? null : 'crm1', dibuat,
      status === 'selesai' ? hariKe(dibuat, antara(1, 4)) : null]).lastInsertRowid;
    if (status !== 'baru') {
      run(`INSERT INTO tiket_balasan(tiket_id, oleh, is_petugas, isi, created_at) VALUES(?,?,?,?,?)`,
        [tid, 'Putri Ayu', 1,
          'Terima kasih atas laporannya. Kami sedang menindaklanjuti dan akan mengabari kembali.',
          hariKe(dibuat, 1)]);
    }
    if (status === 'selesai') {
      run(`INSERT INTO tiket_balasan(tiket_id, oleh, is_petugas, isi, created_at) VALUES(?,?,?,?,?)`,
        [tid, 'Putri Ayu', 1, 'Permasalahan sudah kami selesaikan. Mohon dicek kembali pada aplikasi.',
          hariKe(dibuat, antara(1, 3))]);
    }
  });

  run(`INSERT INTO broadcast(judul, pesan, kanal, target, jumlah_target, status, dikirim_pada, created_at) VALUES
       ('Undangan Rapat Anggota Tahunan','Pengurus mengundang seluruh anggota menghadiri RAT tahun buku ${tahunLalu} pada 25 Februari.','whatsapp','aktif',?, 'terkirim','${tahun}-02-10 09:00:00','${tahun}-02-08 14:00:00'),
       ('Pembagian SHU telah dilakukan','SHU tahun buku ${tahunLalu} telah ditambahkan ke simpanan sukarela Anda.','aplikasi','aktif',?, 'terkirim','${tahun}-03-10 16:00:00','${tahun}-03-10 15:30:00'),
       ('Promo Sembako Akhir Pekan','Diskon khusus anggota untuk beras, minyak goreng, dan gula pasir.','whatsapp','aktif',?, 'terkirim',?,?),
       ('Pengingat Simpanan Wajib','Mohon menyelesaikan simpanan wajib bulan berjalan sebelum tanggal 10.','sms','aktif',?, 'terjadwal',NULL,?)`,
  [totalAnggota, totalAnggota, totalAnggota, hariKe(hariIni, -12), hariKe(hariIni, -14),
    totalAnggota, hariKe(hariIni, -2)]);

  // Survei kepuasan: dipakai modul CRM untuk menghitung NPS.
  for (const [idx, aid] of anggotaIds.entries()) {
    if (idx % 2) continue;                                  // separuh anggota mengisi survei
    const r = rand();
    const nps = r < 0.62 ? antara(9, 10) : r < 0.85 ? antara(7, 8) : antara(3, 6);
    run(`INSERT INTO survey_kepuasan(anggota_id, periode, skor_layanan, skor_produk, skor_petugas,
           nps, saran, created_at) VALUES(?,?,?,?,?,?,?,?)`,
    [aid, `${tahun}-S1`, antara(3, 5), antara(3, 5), antara(3, 5), nps,
      nps >= 9 ? pick(['Pelayanan cepat dan ramah.', 'Sangat terbantu dengan pinjaman koperasi.', null])
        : nps >= 7 ? pick(['Cukup baik, semoga antrean bisa lebih cepat.', null])
          : pick(['Mohon jam layanan diperpanjang.', 'Proses pencairan terlalu lama.']),
      hariKe(hariIni, -antara(20, 150))]);
  }

  // ----------------------------------------------------------------------
  // Penutupan periode akuntansi tahun lalu
  // ----------------------------------------------------------------------
  // Dijalankan paling akhir: setelah periode ditutup, tidak ada lagi jurnal
  // yang boleh masuk ke bulan tersebut.
  console.log('  → Menutup periode akuntansi tahun lalu…');
  for (let b = 1; b <= 12; b++) {
    try { tutupPeriode(tahunLalu, b, ctx); } catch { /* sudah tertutup */ }
  }

  // Akun portal untuk anggota pertama
  if (!get("SELECT id FROM users WHERE username = 'anggota1'")) {
    const { hash, salt } = hashPassword('Demo12345');
    const a = get('SELECT id, nama FROM anggota WHERE id = ?', [anggotaIds[0]]);
    run(`INSERT INTO users(username, nama, password_hash, password_salt, role, cabang_id, anggota_id)
         VALUES('anggota1',?,?,?,'anggota',1,?)`, [a.nama, hash, salt, a.id]);
  }

  console.log('');
  console.log('  ✓ Data contoh berhasil dibuat.');
}

function resetDatabase() {
  const tabel = all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
  db.exec('PRAGMA foreign_keys = OFF');
  for (const t of tabel) db.exec(`DROP TABLE IF EXISTS ${t.name}`);
  db.exec('PRAGMA foreign_keys = ON');
  migrate();
  console.log('  ✓ Basis data dikosongkan dan skema dibangun ulang.');
}

// -------------------------- Eksekusi langsung --------------------------
const dijalankanLangsung = process.argv[1] && process.argv[1].endsWith('seed.js');
if (dijalankanLangsung) {
  const args = process.argv.slice(2);
  console.log('');
  if (args.includes('--reset')) resetDatabase();
  migrate();
  const hasil = pastikanDataAwal();
  console.log(`  ✓ Data awal siap (${hasil.dibuat} entri baru).`);
  if (args.includes('--demo') || args.includes('--reset')) {
    await seedDemo();
  }
  console.log('');
  console.log('  Akun yang tersedia:');
  console.log('    admin      / Admin12345  → Super Administrator');
  for (const u of all("SELECT username, role FROM users WHERE username <> 'admin' ORDER BY id")) {
    console.log(`    ${u.username.padEnd(10)} / Demo12345   → ${u.role}`);
  }
  console.log('');
}
