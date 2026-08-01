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
import { db, all, get, run, scalar, tx, setSetting, setting, migrate } from './db.js';
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

export async function seedDemo() {
  const rand = rng(20260801);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const tahun = new Date().getFullYear();

  const { bukaRekening, setoran } = await import('./services/savings.js');
  const loans = await import('./services/loans.js');
  const trade = await import('./services/trade.js');
  const { postJournal } = await import('./services/accounting.js');

  const ctx = { user: { id: 1, username: 'admin', nama: 'Administrator Sistem', role: 'super_admin' } };

  if (scalar('SELECT COUNT(*) FROM anggota') > 0) {
    console.log('  ⚠ Data contoh sudah ada, dilewati. Gunakan --reset untuk mengisi ulang.');
    return;
  }

  console.log('  → Mencatat neraca pembuka (modal awal koperasi)…');
  // Tanpa saldo pembuka, koperasi tidak memiliki dana untuk menyalurkan pinjaman
  // sehingga kas akan tersaji negatif. Modal awal mencerminkan akumulasi
  // permodalan koperasi sejak berdiri tahun 2018.
  postJournal({
    tanggal: `${tahun}-01-01`, tipe: 'pembuka', referensi: `pembuka:${tahun}`,
    keterangan: `Saldo pembuka tahun buku ${tahun}`,
    lines: [
      { coa_kode: '1-1101', debit: 150_000_000, keterangan: 'Saldo kas awal' },
      { coa_kode: '1-1201', debit: 250_000_000, keterangan: 'Saldo bank awal' },
      { coa_kode: '3-1103', kredit: 150_000_000, keterangan: 'Modal penyertaan anggota' },
      { coa_kode: '3-1104', kredit: 30_000_000, keterangan: 'Hibah pembinaan koperasi' },
      { coa_kode: '3-1201', kredit: 130_000_000, keterangan: 'Akumulasi dana cadangan' },
      { coa_kode: '3-1302', kredit: 90_000_000, keterangan: 'SHU tahun lalu yang ditahan' },
    ],
  }, ctx);

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

  console.log('  → Membuat pengurus & pengawas…');
  run(`INSERT INTO karyawan(nik, nama, jabatan_id, cabang_id, tgl_masuk, periode_mulai, periode_akhir) VALUES
       ('3171010101800001','Hj. Sumarni',1,1,'2018-01-01','${tahun - 1}-01-01','${tahun + 2}-12-31'),
       ('3171010101800002','Muhammad Ridwan',2,1,'2018-01-01','${tahun - 1}-01-01','${tahun + 2}-12-31'),
       ('3171010101800003','Yuni Astuti',3,1,'2018-01-01','${tahun - 1}-01-01','${tahun + 2}-12-31'),
       ('3171010101800004','Drs. Hartono',4,1,'2018-01-01','${tahun - 1}-01-01','${tahun + 2}-12-31'),
       ('3171010101800005','Endang Susilowati',5,1,'2018-01-01','${tahun - 1}-01-01','${tahun + 2}-12-31')`);

  console.log('  → Membuat 40 anggota…');
  const anggotaIds = [];
  for (let i = 1; i <= 40; i++) {
    const nama = `${pick(NAMA_DEPAN)} ${pick(NAMA_BELAKANG)}`;
    const nomor = `A${tahun}${String(i).padStart(4, '0')}`;
    const nik = `3171${String(10_000_000_000 + i * 7919).slice(0, 12)}`;
    const gabung = `${tahun - (i % 3)}-${String((i % 12) + 1).padStart(2, '0')}-10`;
    const { lastInsertRowid: id } = run(
      `INSERT INTO anggota(nomor_anggota, nik, nama, jenis_kelamin, tanggal_lahir, alamat, kota,
         telepon, pekerjaan, penghasilan, pendidikan, cabang_id, tanggal_daftar, tanggal_gabung, status)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,1,?,?,'aktif')`,
      [nomor, nik, nama, i % 2 === 0 ? 'L' : 'P',
        `19${70 + (i % 30)}-${String((i % 12) + 1).padStart(2, '0')}-15`,
        `Jl. Melati No. ${i}`, 'Jakarta', `0812${String(10_000_000 + i * 137).slice(0, 8)}`,
        pick(PEKERJAAN), 3_000_000 + (i % 10) * 750_000, i % 3 === 0 ? 'S1' : 'SMA',
        gabung, gabung],
    );
    anggotaIds.push(id);
  }
  // 3 calon anggota menunggu persetujuan
  for (let i = 41; i <= 43; i++) {
    run(`INSERT INTO anggota(nomor_anggota, nik, nama, jenis_kelamin, alamat, kota, telepon,
           pekerjaan, penghasilan, cabang_id, tanggal_daftar, status)
         VALUES(?,?,?,?,?,?,?,?,?,1,date('now'),'calon')`,
    [`A${tahun}${String(i).padStart(4, '0')}`, `3171${String(10_000_000_000 + i * 7919).slice(0, 12)}`,
      `${pick(NAMA_DEPAN)} ${pick(NAMA_BELAKANG)}`, 'L', `Jl. Anggrek No. ${i}`, 'Jakarta',
      `0813${String(20_000_000 + i * 91).slice(0, 8)}`, pick(PEKERJAAN), 4_000_000]);
  }

  console.log('  → Membuka rekening & setoran simpanan…');
  const produkPokok = get("SELECT id FROM produk_simpanan WHERE jenis = 'pokok'").id;
  const produkWajib = get("SELECT id FROM produk_simpanan WHERE jenis = 'wajib'").id;
  const produkSukarela = get("SELECT id FROM produk_simpanan WHERE jenis = 'sukarela'").id;

  for (const [idx, aid] of anggotaIds.entries()) {
    const tglBuka = `${tahun}-01-05`;
    bukaRekening({ anggota_id: aid, produk_id: produkPokok, tanggal_buka: tglBuka, setoran_awal: 500_000 }, ctx);
    const rekW = bukaRekening({ anggota_id: aid, produk_id: produkWajib, tanggal_buka: tglBuka }, ctx);
    // Simpanan wajib disetor setiap bulan
    for (let b = 1; b <= 6; b++) {
      setoran({ rekening_id: rekW.id, tanggal: `${tahun}-${String(b).padStart(2, '0')}-10`,
        nominal: 50_000, keterangan: `Simpanan wajib bulan ${b}` }, ctx);
    }
    if (idx % 2 === 0) {
      const rekS = bukaRekening({ anggota_id: aid, produk_id: produkSukarela, tanggal_buka: tglBuka }, ctx);
      setoran({ rekening_id: rekS.id, tanggal: `${tahun}-02-15`,
        nominal: 250_000 + (idx % 8) * 100_000, keterangan: 'Setoran sukarela' }, ctx);
    }
  }

  console.log('  → Menyiapkan barang & persediaan toko…');
  run(`INSERT INTO kategori_barang(kode, nama) VALUES
       ('SMB','Sembako'),('MNM','Minuman'),('ATK','Alat Tulis'),('RMT','Kebutuhan Rumah Tangga')`);
  const barang = [
    ['BRG001', '8991234567890', 'Beras Premium 5 kg', 1, 'SAK', 62_000, 72_000, 69_000, 10, 20],
    ['BRG002', '8991234567891', 'Minyak Goreng 2 L', 1, 'PCS', 32_000, 38_000, 36_500, 12, 24],
    ['BRG003', '8991234567892', 'Gula Pasir 1 kg', 1, 'KG', 14_000, 17_000, 16_000, 15, 30],
    ['BRG004', '8991234567893', 'Tepung Terigu 1 kg', 1, 'KG', 11_000, 14_000, 13_000, 15, 30],
    ['BRG005', '8991234567894', 'Kopi Bubuk 200 g', 2, 'PCS', 18_000, 24_000, 22_500, 10, 20],
    ['BRG006', '8991234567895', 'Teh Celup 25 s', 2, 'BOX', 8_000, 11_000, 10_500, 10, 20],
    ['BRG007', '8991234567896', 'Buku Tulis 38 lbr', 3, 'PCS', 3_500, 5_000, 4_500, 24, 48],
    ['BRG008', '8991234567897', 'Pulpen Hitam', 3, 'PCS', 2_000, 3_500, 3_000, 30, 60],
    ['BRG009', '8991234567898', 'Sabun Mandi Batang', 4, 'PCS', 3_800, 5_500, 5_000, 20, 40],
    ['BRG010', '8991234567899', 'Deterjen 800 g', 4, 'PCS', 16_000, 21_000, 20_000, 12, 24],
  ];
  for (const [kode, bc, nama, kat, sat, beli, jual, anggota, min, rop] of barang) {
    run(`INSERT INTO barang(kode, barcode, nama, kategori_id, satuan, harga_beli, harga_jual,
           harga_anggota, stok_minimum, reorder_point, coa_persediaan, coa_penjualan, coa_hpp)
         VALUES(?,?,?,?,?,?,?,?,?,?,'1-1401','4-1101','5-1101')`,
    [kode, bc, nama, kat, sat, beli, jual, anggota, min, rop]);
  }
  run(`INSERT INTO supplier(kode, nama, alamat, telepon, termin_hari, rating) VALUES
       ('SUP001','PT Sumber Pangan Sejahtera','Jl. Industri No. 12, Bekasi','0218881234',30,4.5),
       ('SUP002','CV Aneka Kebutuhan','Jl. Raya Bogor KM 20','0217772345',14,4.0)`);

  // Pembelian awal untuk mengisi stok (pembelian berikutnya dilakukan tiap bulan)
  const po = trade.buatPembelian({
    tanggal: `${tahun}-01-08`, tipe: 'po', supplier_id: 1, gudang_id: 1, unit_usaha_id: 2, cabang_id: 1,
    items: barang.map((b, i) => ({ barang_id: i + 1, qty: 400, harga: b[5] })),
  }, ctx);
  trade.terimaBarang({ pembelian_id: po.id, tanggal: `${tahun}-01-10`, metode_bayar: 'hutang' }, ctx);

  console.log('  → Membuat pinjaman & angsuran…');
  const produkKonsumtif = get("SELECT id FROM produk_pinjaman WHERE kode = 'PK'").id;
  const produkProduktif = get("SELECT id FROM produk_pinjaman WHERE kode = 'PP'").id;
  for (let i = 0; i < 14; i++) {
    const aid = anggotaIds[i];
    const konsumtif = i % 2 === 0;
    const pokok = konsumtif ? 3_000_000 + (i % 5) * 1_000_000 : 10_000_000 + (i % 4) * 5_000_000;
    const p = loans.ajukan({
      anggota_id: aid, produk_id: konsumtif ? produkKonsumtif : produkProduktif,
      pokok, tenor: konsumtif ? 12 : 24, tujuan: konsumtif ? 'Kebutuhan keluarga' : 'Tambahan modal usaha',
      tanggal_pengajuan: `${tahun}-01-15`, cabang_id: 1, unit_usaha_id: 1,
    }, ctx);
    if (i >= 12) continue;                       // 2 pengajuan dibiarkan menunggu keputusan
    loans.putuskan(p.id, { setuju: true }, ctx);
    if (i >= 11) continue;                       // 1 disetujui namun belum dicairkan
    loans.cairkan(p.id, { tanggal: `${tahun}-01-20`, metode: 'tunai' }, ctx);

    // Angsuran dibuat bervariasi agar seluruh tingkat kolektibilitas terwakili:
    // sebagian besar lancar, satu kurang lancar, dan satu diragukan (NPL ±6%).
    const jumlahAngsuran = i === 8 ? 3 : i === 10 ? 2 : 6;
    const jadwal = all('SELECT * FROM pinjaman_jadwal WHERE pinjaman_id = ? ORDER BY angsuran_ke', [p.id]);
    for (let k = 0; k < jumlahAngsuran && k < jadwal.length; k++) {
      loans.bayarAngsuran({ pinjaman_id: p.id, tanggal: jadwal[k].jatuh_tempo,
        nominal: jadwal[k].total, metode: 'tunai' }, ctx);
    }
  }
  loans.refreshSemuaKolektibilitas();

  console.log('  → Membuat transaksi penjualan toko (dengan pembelian rutin bulanan)…');
  const hariIni = new Date().toISOString().slice(0, 10);
  let bulanTerakhirRestok = 1;
  let jumlahPenjualan = 0;
  for (let hari = 1; hari <= 340; hari++) {
    const tgl = new Date(Date.UTC(tahun, 0, 15 + hari)).toISOString().slice(0, 10);
    if (tgl > hariIni) break;

    // Pembelian rutin ke supplier pada awal setiap bulan agar stok toko terjaga
    const bulan = Number(tgl.slice(5, 7));
    if (bulan !== bulanTerakhirRestok) {
      bulanTerakhirRestok = bulan;
      const poRutin = trade.buatPembelian({
        tanggal: tgl, tipe: 'po', supplier_id: 1 + (bulan % 2), gudang_id: 1,
        unit_usaha_id: 2, cabang_id: 1,
        items: barang.map((b, i) => ({ barang_id: i + 1, qty: 200, harga: b[5] })),
      }, ctx);
      trade.terimaBarang({ pembelian_id: poRutin.id, tanggal: tgl, metode_bayar: 'hutang' }, ctx);
    }

    // Toko tutup pada hari Minggu
    if (new Date(`${tgl}T00:00:00Z`).getUTCDay() === 0) continue;

    const jumlahTrx = 12 + Math.floor(rand() * 9);
    for (let t = 0; t < jumlahTrx; t++) {
      const pakaiAnggota = rand() > 0.35;
      const items = [];
      const dipakai = new Set();
      const n = 1 + Math.floor(rand() * 4);
      for (let x = 0; x < n; x++) {
        const bid = 1 + Math.floor(rand() * barang.length);
        if (dipakai.has(bid)) continue;
        dipakai.add(bid);
        items.push({ barang_id: bid, qty: 1 + Math.floor(rand() * 4) });
      }
      if (!items.length) continue;
      try {
        trade.jual({
          tanggal: tgl, tipe: 'pos', gudang_id: 1, unit_usaha_id: 2, cabang_id: 1,
          anggota_id: pakaiAnggota ? anggotaIds[Math.floor(rand() * anggotaIds.length)] : null,
          items, metode_bayar: rand() > 0.8 ? 'qris' : 'tunai',
        }, ctx);
        jumlahPenjualan++;
      } catch { /* stok tidak mencukupi - transaksi dilewati */ }
    }
  }
  console.log(`    ${jumlahPenjualan} transaksi penjualan dibuat.`);

  console.log('  → Mencatat aset tetap & beban operasional…');
  const assets = await import('./services/assets.js');
  assets.tambah({ kode: 'AST001', nama: 'Kendaraan Operasional', kategori: 'kendaraan',
    tanggal_perolehan: `${tahun - 1}-06-01`, harga_perolehan: 120_000_000, nilai_residu: 20_000_000,
    umur_manfaat: 8, coa_aset: '1-1603', coa_akumulasi: '1-1699', coa_beban: '5-2301',
    cabang_id: 1 }, ctx);
  assets.tambah({ kode: 'AST002', nama: 'Perangkat Komputer & Server', kategori: 'inventaris',
    tanggal_perolehan: `${tahun}-01-05`, harga_perolehan: 30_000_000, nilai_residu: 5_000_000,
    umur_manfaat: 4, coa_aset: '1-1604', coa_akumulasi: '1-1699', coa_beban: '5-2301',
    cabang_id: 1 }, ctx);
  assets.tambah({ kode: 'AST003', nama: 'Etalase & Rak Toko', kategori: 'inventaris',
    tanggal_perolehan: `${tahun}-01-05`, harga_perolehan: 18_000_000, nilai_residu: 2_000_000,
    umur_manfaat: 5, coa_aset: '1-1604', coa_akumulasi: '1-1699', coa_beban: '5-2301',
    cabang_id: 1, unit_usaha_id: 2 }, ctx);

  // Beban operasional dibukukan untuk bulan-bulan yang sudah berjalan penuh,
  // sebanding dengan periode pendapatan yang tercatat (matching cost against
  // revenue). Bulan berjalan belum dibebani agar tidak timpang.
  const bulanSekarang = new Date().getMonth() + 1;
  for (let b = 1; b < bulanSekarang; b++) {
    const p = `${tahun}-${String(b).padStart(2, '0')}`;
    const akhir = new Date(Date.UTC(tahun, b, 0)).toISOString().slice(0, 10);
    postJournal({
      tanggal: akhir, tipe: 'umum', keterangan: `Beban operasional bulan ${p}`,
      lines: [
        { coa_kode: '5-2201', debit: 3_600_000, keterangan: 'Gaji & tunjangan karyawan' },
        { coa_kode: '5-2202', debit: 550_000, keterangan: 'Listrik, air & telekomunikasi' },
        { coa_kode: '5-2203', debit: 180_000, keterangan: 'Alat tulis kantor' },
        { coa_kode: '5-2204', debit: 800_000, keterangan: 'Sewa ruang usaha' },
        { coa_kode: '1-1101', kredit: 5_130_000, keterangan: 'Pembayaran beban operasional' },
      ],
    }, ctx);
    assets.jalankanPenyusutan(p, ctx);
  }

  // Sebagian utang kepada supplier dilunasi agar posisi utang usaha wajar
  console.log('  → Melunasi sebagian utang supplier…');
  // Pembayaran dilakukan bergantian dari kas toko dan rekening bank
  let urutBayar = 0;
  for (const h of all(
    "SELECT * FROM hutang_piutang WHERE jenis = 'hutang' AND status = 'terbuka' ORDER BY jatuh_tempo")) {
    if (h.jatuh_tempo >= hariIni) continue;
    try {
      trade.bayarHutangPiutang({ id: h.id, tanggal: h.jatuh_tempo,
        nominal: h.nominal - h.terbayar, metode: urutBayar++ % 2 === 0 ? 'tunai' : 'transfer' }, ctx);
    } catch { /* dilewati bila periode sudah ditutup */ }
  }

  console.log('  → Mengisi data tata kelola (compliance, audit, risiko)…');
  run(`INSERT INTO compliance_item(kategori, nama, dasar_hukum, nomor, penerbit, tanggal_terbit,
         tanggal_kadaluarsa, pic, status) VALUES
       ('legalitas','Akta Pendirian & Badan Hukum Koperasi','UU No. 25 Tahun 1992','518/BH/XIV.4/2018',
        'Kementerian Koperasi dan UKM','2018-03-15',NULL,'Sekretaris','patuh'),
       ('oss','Nomor Induk Berusaha (NIB)','PP No. 5 Tahun 2021','1234567890123','OSS RBA',
        '2021-06-10',NULL,'Sekretaris','patuh'),
       ('perpajakan','Surat Keterangan Terdaftar NPWP','UU KUP','01.234.567.8-901.000',
        'Direktorat Jenderal Pajak','2018-04-01',NULL,'Bendahara','patuh'),
       ('perpajakan','Pelaporan SPT Tahunan PPh Badan','UU No. 7 Tahun 2021','SPT-${tahun - 1}',
        'DJP','${tahun}-04-30','${tahun}-04-30','Bendahara','patuh'),
       ('perkoperasian','Laporan RAT ke Dinas Koperasi','UU No. 25 Tahun 1992 Pasal 30','RAT-${tahun - 1}',
        'Dinas Koperasi','${tahun}-03-31','${tahun}-06-30','Sekretaris','perlu_perhatian'),
       ('ketenagakerjaan','Kepesertaan BPJS Ketenagakerjaan','UU No. 24 Tahun 2011','BPJS-TK-001',
        'BPJS Ketenagakerjaan','2019-01-01',NULL,'Manajer','patuh'),
       ('legalitas','Izin Usaha Toko Koperasi','Perda setempat','IUMK-2023-455','Pemerintah Daerah',
        '2023-05-01','${tahun}-12-31','Manajer Unit','patuh')`);

  run(`INSERT INTO audit_plan(nomor, judul, tahun, objek, auditor, tanggal_mulai, tanggal_selesai,
         ruang_lingkup, status) VALUES
       ('AUD/${tahun}/01/00001','Audit Internal Unit Simpan Pinjam',${tahun},'Unit Simpan Pinjam',
        'Ir. Bagus Prakoso','${tahun}-04-01','${tahun}-04-15',
        'Prosedur pemberian pinjaman, penilaian kolektibilitas, dan penagihan','selesai'),
       ('AUD/${tahun}/05/00002','Audit Persediaan & Kas Toko Koperasi',${tahun},'Unit Toko',
        'Ir. Bagus Prakoso','${tahun}-05-02','${tahun}-05-10',
        'Pengelolaan persediaan, stock opname, dan penerimaan kas','berjalan')`);

  run(`INSERT INTO audit_temuan(plan_id, kode, judul, deskripsi, kriteria, sebab, akibat, rekomendasi,
         risk_rating, capa, pic, batas_waktu, status) VALUES
       (1,'TMN-001','Dokumen agunan tidak lengkap pada 3 berkas pinjaman',
        'Tiga berkas pinjaman produktif tidak dilengkapi salinan bukti kepemilikan agunan.',
        'SOP Pinjaman butir 4.2 mewajibkan salinan agunan diarsipkan sebelum pencairan.',
        'Pengendalian kelengkapan berkas belum dijalankan konsisten.',
        'Potensi kesulitan eksekusi agunan bila terjadi gagal bayar.',
        'Melengkapi berkas dan menerapkan checklist wajib sebelum pencairan.',
        'tinggi','Checklist kelengkapan berkas diterapkan pada sistem sejak ${tahun}-05-01',
        'Petugas Pinjaman','${tahun}-06-30','selesai'),
       (1,'TMN-002','Keterlambatan penagihan angsuran tertunggak',
        'Penagihan atas angsuran yang telah lewat jatuh tempo baru dilakukan setelah 30 hari.',
        'SOP Penagihan mewajibkan pengingat pada H-3 dan H+1 jatuh tempo.',
        'Belum ada mekanisme pengingat otomatis.',
        'Meningkatnya rasio kredit bermasalah (NPL).',
        'Mengaktifkan pengingat otomatis dan laporan tagihan harian.',
        'sedang','Modul Collection dengan daftar tagihan harian diaktifkan.',
        'Petugas Pinjaman','${tahun}-07-31','proses'),
       (2,'TMN-003','Selisih stok pada barang cepat laku',
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
        'Insiden keamanan per tahun',0,0)`);

  console.log('  → Membuat dokumen & persuratan…');
  run(`INSERT INTO dokumen(nomor, judul, kategori, deskripsi, status, pemilik, retensi_tahun) VALUES
       ('AD/2018/01','Anggaran Dasar Koperasi','ad_art','Anggaran Dasar yang disahkan pada rapat pendirian','disetujui','Sekretaris',30),
       ('ART/2018/01','Anggaran Rumah Tangga','ad_art','Aturan pelaksanaan Anggaran Dasar','disetujui','Sekretaris',30),
       ('SOP/SP/01','SOP Pemberian Pinjaman','sop','Prosedur pengajuan hingga pencairan pinjaman','disetujui','Manajer',10),
       ('SOP/TK/01','SOP Operasional Toko Koperasi','sop','Prosedur kasir, penerimaan barang, dan stock opname','disetujui','Manajer',10),
       ('KEB/AKT/01','Kebijakan Akuntansi Koperasi','kebijakan','Mengacu Permenkop UKM No. 2 Tahun 2024 dan SAK EP','disetujui','Bendahara',10)`);
  run(`INSERT INTO surat(nomor, jenis, tanggal, perihal, dari, kepada, sifat, status) VALUES
       ('001/KSU/${tahun}','keluar','${tahun}-02-10','Undangan Rapat Anggota Tahunan','Pengurus Koperasi','Seluruh Anggota','penting','selesai'),
       ('002/KSU/${tahun}','keluar','${tahun}-03-05','Laporan Tahunan kepada Dinas Koperasi','Pengurus Koperasi','Dinas Koperasi dan UKM','penting','selesai'),
       ('015/DK/${tahun}','masuk','${tahun}-03-20','Pemberitahuan Pembinaan Koperasi','Dinas Koperasi dan UKM','Pengurus Koperasi','biasa','diproses')`);

  console.log('  → Menyiapkan RAT & anggaran…');
  const totalAnggota = scalar("SELECT COUNT(*) FROM anggota WHERE status = 'aktif'");
  run(`INSERT INTO rat(nomor, tahun_buku, judul, tanggal, waktu, tempat, jenis, total_anggota, kuorum_persen, status)
       VALUES('RAT/${tahun}/02/00001',${tahun - 1},'Rapat Anggota Tahunan Tahun Buku ${tahun - 1}',
       '${tahun}-02-25','09.00 WIB','Aula Koperasi','tahunan',?,50,'rencana')`, [totalAnggota]);
  const ratId = scalar('SELECT id FROM rat ORDER BY id DESC LIMIT 1');
  const agenda = ['Pembukaan dan pengesahan kuorum', `Laporan Pertanggungjawaban Pengurus Tahun Buku ${tahun - 1}`,
    'Laporan Pengawas', 'Pengesahan Laporan Keuangan', 'Pembagian SHU',
    `Rencana Kerja & RAPB Tahun ${tahun}`, 'Lain-lain dan penutup'];
  agenda.forEach((j, i) => run(
    'INSERT INTO rat_agenda(rat_id, urut, judul, jenis) VALUES(?,?,?,?)',
    [ratId, i + 1, j, [3, 4, 5].includes(i) ? 'voting' : i === 1 || i === 2 ? 'laporan' : 'pembahasan']));

  const anggaranId = run(
    `INSERT INTO anggaran(tahun, nama, cabang_id, status, keterangan)
     VALUES(?,?,1,'disetujui','Rencana Kerja dan Anggaran Pendapatan Belanja Koperasi')`,
    [tahun, `RKAP Tahun ${tahun}`]).lastInsertRowid;
  const rkap = [
    ['4-1101', 900_000_000], ['4-1201', 180_000_000], ['4-1202', 12_000_000],
    ['5-1101', 720_000_000], ['5-2201', 222_000_000], ['5-2202', 28_800_000],
    ['5-2203', 7_800_000], ['5-2204', 36_000_000], ['5-2301', 30_000_000], ['5-2401', 25_000_000],
  ];
  for (const [kode, nominal] of rkap) {
    run('INSERT INTO anggaran_detail(anggaran_id, coa_kode, bulan, nominal) VALUES(?,?,0,?)',
      [anggaranId, kode, nominal]);
  }

  console.log('  → Membuat tiket layanan anggota…');
  run(`INSERT INTO tiket(nomor, anggota_id, kategori, prioritas, judul, isi, kanal, status) VALUES
       ('TKT/${tahun}/03/00001',1,'pertanyaan','normal','Cara mengajukan pinjaman produktif',
        'Mohon penjelasan syarat dan dokumen yang diperlukan.','aplikasi','selesai'),
       ('TKT/${tahun}/04/00002',2,'pengaduan','tinggi','Saldo simpanan sukarela belum bertambah',
        'Setoran tanggal 15 belum terlihat pada aplikasi.','whatsapp','diproses'),
       ('TKT/${tahun}/05/00003',3,'saran','rendah','Usulan penambahan jenis barang di toko',
        'Mohon disediakan produk kebutuhan bayi.','langsung','baru')`);

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
