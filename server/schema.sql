-- =====================================================================
-- ECMS - Enterprise Cooperative Management System
-- Koperasi Serba Usaha (KSU)
--
-- Acuan regulasi:
--   * UU No. 25 Tahun 1992 tentang Perkoperasian
--   * Permenkop UKM No. 2 Tahun 2024 (Kebijakan Akuntansi Koperasi)
--   * SAK Entitas Privat (SAK EP)
--   * UU ITE No. 11/2008 jo. UU No. 19/2016 (audit trail & tanda tangan elektronik)
--
-- Konvensi:
--   * Seluruh nilai uang disimpan sebagai INTEGER dalam satuan Rupiah penuh
--     (IDR tidak memiliki sub-satuan yang dipakai dalam praktik akuntansi koperasi).
--   * Seluruh tanggal disimpan sebagai TEXT ISO-8601 ('YYYY-MM-DD' / RFC3339).
--   * Setiap transaksi finansial WAJIB memiliki jurnal (double entry) - lihat
--     server/services/accounting.js
-- =====================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------
-- 26. ADMINISTRATOR : organisasi, pengguna, keamanan
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cabang (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kode          TEXT NOT NULL UNIQUE,
  nama          TEXT NOT NULL,
  alamat        TEXT,
  kota          TEXT,
  telepon       TEXT,
  is_pusat      INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'aktif',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS unit_usaha (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kode          TEXT NOT NULL UNIQUE,
  nama          TEXT NOT NULL,
  jenis         TEXT NOT NULL,          -- simpan_pinjam|retail|pertanian|perikanan|peternakan|jasa|transportasi|wisata|apotek|spbu|lainnya
  cabang_id     INTEGER REFERENCES cabang(id),
  penanggung_jawab TEXT,
  status        TEXT NOT NULL DEFAULT 'aktif',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  nama          TEXT NOT NULL,
  email         TEXT,
  password_hash TEXT NOT NULL,          -- pbkdf2-sha512
  password_salt TEXT NOT NULL,
  role          TEXT NOT NULL,          -- lihat server/lib/rbac.js
  cabang_id     INTEGER REFERENCES cabang(id),
  unit_usaha_id INTEGER REFERENCES unit_usaha(id),
  anggota_id    INTEGER,                -- diisi bila user adalah anggota (portal/mobile)
  mfa_secret    TEXT,                   -- 26. MFA (TOTP base32)
  mfa_enabled   INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'aktif',
  last_login_at TEXT,
  gagal_login   INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token         TEXT PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip            TEXT,
  user_agent    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at    TEXT NOT NULL
);

-- UU ITE: jejak audit elektronik yang tidak dapat disangkal
CREATE TABLE IF NOT EXISTS audit_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  waktu         TEXT NOT NULL DEFAULT (datetime('now')),
  user_id       INTEGER,
  username      TEXT,
  aksi          TEXT NOT NULL,          -- create|update|delete|login|logout|approve|post|void|export
  modul         TEXT NOT NULL,
  entitas_id    TEXT,
  keterangan    TEXT,
  data_before   TEXT,
  data_after    TEXT,
  ip            TEXT,
  hash          TEXT                    -- rantai hash sha256(prev_hash + payload)
);
CREATE INDEX IF NOT EXISTS idx_audit_waktu ON audit_log(waktu);
CREATE INDEX IF NOT EXISTS idx_audit_modul ON audit_log(modul, entitas_id);

CREATE TABLE IF NOT EXISTS settings (
  key           TEXT PRIMARY KEY,
  value         TEXT,
  keterangan    TEXT,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Penomoran dokumen otomatis (per prefix per periode)
CREATE TABLE IF NOT EXISTS sequences (
  scope         TEXT PRIMARY KEY,       -- contoh: 'JV-2026-08'
  last_number   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS notifications (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
  role          TEXT,                   -- notifikasi berbasis peran bila user_id NULL
  judul         TEXT NOT NULL,
  pesan         TEXT,
  tipe          TEXT NOT NULL DEFAULT 'info',  -- info|warning|danger|success
  link          TEXT,
  dibaca        INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, dibaca);

-- ---------------------------------------------------------------------
-- 2. MASTER DATA
-- ---------------------------------------------------------------------

-- Bagan Akun / Chart of Account (Permenkop 2/2024)
CREATE TABLE IF NOT EXISTS coa (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kode          TEXT NOT NULL UNIQUE,
  nama          TEXT NOT NULL,
  tipe          TEXT NOT NULL,          -- aset|kewajiban|ekuitas|pendapatan|beban
  saldo_normal  TEXT NOT NULL,          -- D|K
  parent_kode   TEXT,
  level         INTEGER NOT NULL DEFAULT 1,
  is_kas        INTEGER NOT NULL DEFAULT 0,
  is_bank       INTEGER NOT NULL DEFAULT 0,
  is_postable   INTEGER NOT NULL DEFAULT 1,   -- akun header tidak boleh dijurnal
  status        TEXT NOT NULL DEFAULT 'aktif',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_coa_parent ON coa(parent_kode);

CREATE TABLE IF NOT EXISTS pajak (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kode          TEXT NOT NULL UNIQUE,
  nama          TEXT NOT NULL,
  tarif         REAL NOT NULL DEFAULT 0,      -- persen
  coa_kode      TEXT,
  status        TEXT NOT NULL DEFAULT 'aktif'
);

CREATE TABLE IF NOT EXISTS jabatan (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kode          TEXT NOT NULL UNIQUE,
  nama          TEXT NOT NULL,
  kelompok      TEXT NOT NULL DEFAULT 'karyawan'  -- pengurus|pengawas|karyawan
);

CREATE TABLE IF NOT EXISTS karyawan (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nik           TEXT NOT NULL UNIQUE,
  nama          TEXT NOT NULL,
  jabatan_id    INTEGER REFERENCES jabatan(id),
  cabang_id     INTEGER REFERENCES cabang(id),
  unit_usaha_id INTEGER REFERENCES unit_usaha(id),
  telepon       TEXT,
  email         TEXT,
  tgl_masuk     TEXT,
  tgl_keluar    TEXT,
  periode_mulai TEXT,                   -- untuk pengurus/pengawas (masa bakti)
  periode_akhir TEXT,
  status        TEXT NOT NULL DEFAULT 'aktif'
);

CREATE TABLE IF NOT EXISTS bank_account (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nama_bank     TEXT NOT NULL,
  nomor_rekening TEXT NOT NULL,
  atas_nama     TEXT NOT NULL,
  cabang_id     INTEGER REFERENCES cabang(id),
  coa_kode      TEXT NOT NULL,
  saldo_awal    INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'aktif'
);

CREATE TABLE IF NOT EXISTS supplier (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kode          TEXT NOT NULL UNIQUE,
  nama          TEXT NOT NULL,
  npwp          TEXT,
  alamat        TEXT,
  telepon       TEXT,
  email         TEXT,
  termin_hari   INTEGER NOT NULL DEFAULT 0,
  rating        REAL NOT NULL DEFAULT 0,     -- 13. evaluasi supplier (0-5)
  status        TEXT NOT NULL DEFAULT 'aktif',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customer (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kode          TEXT NOT NULL UNIQUE,
  nama          TEXT NOT NULL,
  anggota_id    INTEGER,
  alamat        TEXT,
  telepon       TEXT,
  npwp          TEXT,
  termin_hari   INTEGER NOT NULL DEFAULT 0,
  limit_piutang INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'aktif'
);

-- ---------------------------------------------------------------------
-- 3. KEANGGOTAAN (UU 25/1992 Bab V)
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS anggota (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  nomor_anggota   TEXT NOT NULL UNIQUE,
  nik             TEXT NOT NULL UNIQUE,
  no_kk           TEXT,
  npwp            TEXT,
  nama            TEXT NOT NULL,
  jenis_kelamin   TEXT,                 -- L|P
  tempat_lahir    TEXT,
  tanggal_lahir   TEXT,
  alamat          TEXT,
  kelurahan       TEXT,
  kecamatan       TEXT,
  kota            TEXT,
  provinsi        TEXT,
  kode_pos        TEXT,
  telepon         TEXT,
  email           TEXT,
  pekerjaan       TEXT,
  nama_instansi   TEXT,
  penghasilan     INTEGER NOT NULL DEFAULT 0,
  pendidikan      TEXT,
  foto            TEXT,                 -- data URI / path
  tanda_tangan    TEXT,                 -- UU ITE: spesimen tanda tangan elektronik
  cabang_id       INTEGER REFERENCES cabang(id),
  tanggal_daftar  TEXT,
  tanggal_gabung  TEXT,                 -- tanggal disetujui menjadi anggota
  tanggal_keluar  TEXT,
  alasan_keluar   TEXT,                 -- mengundurkan_diri|meninggal|diberhentikan
  status          TEXT NOT NULL DEFAULT 'calon',  -- calon|aktif|nonaktif|keluar|meninggal|ditolak
  jenis_anggota   TEXT NOT NULL DEFAULT 'biasa',  -- biasa|luar_biasa
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_anggota_status ON anggota(status);
CREATE INDEX IF NOT EXISTS idx_anggota_nama ON anggota(nama);

CREATE TABLE IF NOT EXISTS anggota_ahli_waris (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  anggota_id    INTEGER NOT NULL REFERENCES anggota(id) ON DELETE CASCADE,
  nama          TEXT NOT NULL,
  nik           TEXT,
  hubungan      TEXT,
  telepon       TEXT,
  alamat        TEXT,
  persentase    REAL NOT NULL DEFAULT 100
);

CREATE TABLE IF NOT EXISTS anggota_riwayat (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  anggota_id    INTEGER NOT NULL REFERENCES anggota(id) ON DELETE CASCADE,
  jenis         TEXT NOT NULL,          -- pendidikan|pekerjaan|status
  keterangan    TEXT,
  mulai         TEXT,
  selesai       TEXT,
  status_lama   TEXT,
  status_baru   TEXT,
  oleh          TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------
-- 4. SIMPANAN
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS produk_simpanan (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  kode            TEXT NOT NULL UNIQUE,
  nama            TEXT NOT NULL,
  jenis           TEXT NOT NULL,        -- pokok|wajib|sukarela|berjangka|deposito
  coa_kode        TEXT NOT NULL,        -- akun kewajiban/ekuitas simpanan
  coa_beban_bunga TEXT,                 -- beban jasa simpanan
  setoran_minimal INTEGER NOT NULL DEFAULT 0,
  setoran_wajib   INTEGER NOT NULL DEFAULT 0,   -- nominal wajib per bulan
  bunga_tahunan   REAL NOT NULL DEFAULT 0,      -- persen p.a.
  boleh_tarik     INTEGER NOT NULL DEFAULT 1,
  tenor_bulan     INTEGER NOT NULL DEFAULT 0,   -- untuk berjangka/deposito
  masuk_shu       INTEGER NOT NULL DEFAULT 1,   -- diperhitungkan dalam jasa modal SHU
  status          TEXT NOT NULL DEFAULT 'aktif'
);

CREATE TABLE IF NOT EXISTS rekening_simpanan (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  nomor_rekening  TEXT NOT NULL UNIQUE,
  anggota_id      INTEGER NOT NULL REFERENCES anggota(id),
  produk_id       INTEGER NOT NULL REFERENCES produk_simpanan(id),
  cabang_id       INTEGER REFERENCES cabang(id),
  saldo           INTEGER NOT NULL DEFAULT 0,
  saldo_blokir    INTEGER NOT NULL DEFAULT 0,   -- ditahan sebagai agunan pinjaman
  tanggal_buka    TEXT NOT NULL,
  tanggal_jatuh_tempo TEXT,                     -- deposito/berjangka
  tanggal_tutup   TEXT,
  status          TEXT NOT NULL DEFAULT 'aktif', -- aktif|blokir|tutup
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rek_anggota ON rekening_simpanan(anggota_id);

CREATE TABLE IF NOT EXISTS transaksi_simpanan (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  nomor           TEXT NOT NULL UNIQUE,
  rekening_id     INTEGER NOT NULL REFERENCES rekening_simpanan(id),
  tanggal         TEXT NOT NULL,
  jenis           TEXT NOT NULL,        -- setoran|penarikan|bunga|koreksi|pindah_buku
  debit           INTEGER NOT NULL DEFAULT 0,   -- mengurangi saldo simpanan (penarikan)
  kredit          INTEGER NOT NULL DEFAULT 0,   -- menambah saldo simpanan (setoran)
  saldo_akhir     INTEGER NOT NULL DEFAULT 0,
  keterangan      TEXT,
  jurnal_id       INTEGER,
  metode          TEXT NOT NULL DEFAULT 'tunai', -- tunai|transfer|potong_gaji|pindah_buku
  bank_account_id INTEGER REFERENCES bank_account(id),
  petugas         TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_trxsim_rek ON transaksi_simpanan(rekening_id, tanggal);

-- ---------------------------------------------------------------------
-- 5. PINJAMAN
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS produk_pinjaman (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  kode            TEXT NOT NULL UNIQUE,
  nama            TEXT NOT NULL,
  jenis           TEXT NOT NULL,        -- konsumtif|produktif|modal_usaha|syariah
  metode_bunga    TEXT NOT NULL DEFAULT 'flat', -- flat|efektif|anuitas|menurun|margin_murabahah
  bunga_tahunan   REAL NOT NULL DEFAULT 0,
  tenor_min       INTEGER NOT NULL DEFAULT 1,
  tenor_max       INTEGER NOT NULL DEFAULT 36,
  plafon_min      INTEGER NOT NULL DEFAULT 0,
  plafon_max      INTEGER NOT NULL DEFAULT 0,
  biaya_admin     REAL NOT NULL DEFAULT 0,       -- persen dari pokok
  biaya_provisi   REAL NOT NULL DEFAULT 0,
  denda_harian    REAL NOT NULL DEFAULT 0,       -- persen per hari dari angsuran tertunggak
  coa_piutang     TEXT NOT NULL,
  coa_pendapatan_bunga TEXT NOT NULL,
  coa_pendapatan_admin TEXT,
  coa_pendapatan_denda TEXT,
  wajib_agunan    INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'aktif'
);

CREATE TABLE IF NOT EXISTS pinjaman (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  nomor           TEXT NOT NULL UNIQUE,
  anggota_id      INTEGER NOT NULL REFERENCES anggota(id),
  produk_id       INTEGER NOT NULL REFERENCES produk_pinjaman(id),
  cabang_id       INTEGER REFERENCES cabang(id),
  unit_usaha_id   INTEGER REFERENCES unit_usaha(id),
  tanggal_pengajuan TEXT NOT NULL,
  tanggal_persetujuan TEXT,
  tanggal_cair    TEXT,
  tanggal_lunas   TEXT,
  pokok           INTEGER NOT NULL,
  tenor           INTEGER NOT NULL,             -- bulan
  bunga_tahunan   REAL NOT NULL,
  metode_bunga    TEXT NOT NULL,
  tujuan          TEXT,
  biaya_admin     INTEGER NOT NULL DEFAULT 0,
  biaya_provisi   INTEGER NOT NULL DEFAULT 0,
  total_bunga     INTEGER NOT NULL DEFAULT 0,
  angsuran_pokok  INTEGER NOT NULL DEFAULT 0,
  angsuran_bunga  INTEGER NOT NULL DEFAULT 0,
  angsuran_total  INTEGER NOT NULL DEFAULT 0,
  outstanding_pokok INTEGER NOT NULL DEFAULT 0,
  outstanding_bunga INTEGER NOT NULL DEFAULT 0,
  tunggakan_hari  INTEGER NOT NULL DEFAULT 0,
  kolektibilitas  INTEGER NOT NULL DEFAULT 1,   -- 1 lancar .. 5 macet
  skor_kredit     INTEGER,
  rekomendasi_skor TEXT,
  hasil_survey    TEXT,
  catatan_analis  TEXT,
  disetujui_oleh  TEXT,
  alasan_tolak    TEXT,
  status          TEXT NOT NULL DEFAULT 'diajukan',
  -- diajukan|survey|dianalisis|disetujui|ditolak|dicairkan|lunas|restrukturisasi|hapus_buku
  restruktur_dari INTEGER REFERENCES pinjaman(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pinjaman_anggota ON pinjaman(anggota_id);
CREATE INDEX IF NOT EXISTS idx_pinjaman_status ON pinjaman(status);

CREATE TABLE IF NOT EXISTS pinjaman_jadwal (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  pinjaman_id     INTEGER NOT NULL REFERENCES pinjaman(id) ON DELETE CASCADE,
  angsuran_ke     INTEGER NOT NULL,
  jatuh_tempo     TEXT NOT NULL,
  pokok           INTEGER NOT NULL DEFAULT 0,
  bunga           INTEGER NOT NULL DEFAULT 0,
  total           INTEGER NOT NULL DEFAULT 0,
  sisa_pokok      INTEGER NOT NULL DEFAULT 0,
  bayar_pokok     INTEGER NOT NULL DEFAULT 0,
  bayar_bunga     INTEGER NOT NULL DEFAULT 0,
  bayar_denda     INTEGER NOT NULL DEFAULT 0,
  tanggal_bayar   TEXT,
  status          TEXT NOT NULL DEFAULT 'belum'  -- belum|sebagian|lunas
);
CREATE INDEX IF NOT EXISTS idx_jadwal_pinjaman ON pinjaman_jadwal(pinjaman_id, angsuran_ke);
CREATE INDEX IF NOT EXISTS idx_jadwal_tempo ON pinjaman_jadwal(jatuh_tempo, status);

CREATE TABLE IF NOT EXISTS pinjaman_angsuran (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  nomor           TEXT NOT NULL UNIQUE,
  pinjaman_id     INTEGER NOT NULL REFERENCES pinjaman(id),
  tanggal         TEXT NOT NULL,
  angsuran_ke     INTEGER,
  bayar_pokok     INTEGER NOT NULL DEFAULT 0,
  bayar_bunga     INTEGER NOT NULL DEFAULT 0,
  bayar_denda     INTEGER NOT NULL DEFAULT 0,
  total_bayar     INTEGER NOT NULL DEFAULT 0,
  metode          TEXT NOT NULL DEFAULT 'tunai',
  jenis           TEXT NOT NULL DEFAULT 'angsuran', -- angsuran|pelunasan_dipercepat
  keterangan      TEXT,
  jurnal_id       INTEGER,
  petugas         TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_angsuran_pinjaman ON pinjaman_angsuran(pinjaman_id);

CREATE TABLE IF NOT EXISTS pinjaman_agunan (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  pinjaman_id     INTEGER NOT NULL REFERENCES pinjaman(id) ON DELETE CASCADE,
  jenis           TEXT NOT NULL,        -- bpkb|shm|simpanan|deposito|lainnya
  deskripsi       TEXT,
  nomor_dokumen   TEXT,
  nilai_taksiran  INTEGER NOT NULL DEFAULT 0,
  lokasi_simpan   TEXT,
  status          TEXT NOT NULL DEFAULT 'ditahan'  -- ditahan|dikembalikan|dieksekusi
);

-- ---------------------------------------------------------------------
-- 7. AKUNTANSI - General Ledger (double entry)
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS periode_akuntansi (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tahun         INTEGER NOT NULL,
  bulan         INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'terbuka',  -- terbuka|tutup
  ditutup_oleh  TEXT,
  ditutup_pada  TEXT,
  UNIQUE(tahun, bulan)
);

CREATE TABLE IF NOT EXISTS jurnal (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nomor         TEXT NOT NULL UNIQUE,
  tanggal       TEXT NOT NULL,
  tipe          TEXT NOT NULL DEFAULT 'umum',
  -- umum|kas_masuk|kas_keluar|simpanan|pinjaman|penjualan|pembelian|penyusutan|penutup|pembuka|shu|penyesuaian
  referensi     TEXT,                   -- modul:id sumber transaksi
  keterangan    TEXT,
  cabang_id     INTEGER REFERENCES cabang(id),
  unit_usaha_id INTEGER REFERENCES unit_usaha(id),
  total_debit   INTEGER NOT NULL DEFAULT 0,
  total_kredit  INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'posted',  -- draft|posted|void
  is_recurring  INTEGER NOT NULL DEFAULT 0,
  dibuat_oleh   TEXT,
  void_alasan   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_jurnal_tanggal ON jurnal(tanggal);
CREATE INDEX IF NOT EXISTS idx_jurnal_ref ON jurnal(referensi);

CREATE TABLE IF NOT EXISTS jurnal_detail (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  jurnal_id     INTEGER NOT NULL REFERENCES jurnal(id) ON DELETE CASCADE,
  coa_kode      TEXT NOT NULL,
  debit         INTEGER NOT NULL DEFAULT 0,
  kredit        INTEGER NOT NULL DEFAULT 0,
  keterangan    TEXT,
  cabang_id     INTEGER,
  unit_usaha_id INTEGER,               -- cost center / segmen unit usaha
  anggota_id    INTEGER,               -- sub ledger anggota
  urut          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_jd_jurnal ON jurnal_detail(jurnal_id);
CREATE INDEX IF NOT EXISTS idx_jd_coa ON jurnal_detail(coa_kode);

-- Jurnal berulang (recurring)
CREATE TABLE IF NOT EXISTS jurnal_recurring (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nama          TEXT NOT NULL,
  frekuensi     TEXT NOT NULL DEFAULT 'bulanan',
  tanggal_mulai TEXT NOT NULL,
  tanggal_akhir TEXT,
  template      TEXT NOT NULL,          -- JSON lines
  terakhir_dibuat TEXT,
  status        TEXT NOT NULL DEFAULT 'aktif'
);

-- ---------------------------------------------------------------------
-- 9. KAS & BANK
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS kas_bank (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nomor         TEXT NOT NULL UNIQUE,
  tanggal       TEXT NOT NULL,
  jenis         TEXT NOT NULL,          -- kas_masuk|kas_keluar|transfer|petty_cash
  coa_kas       TEXT NOT NULL,          -- akun kas/bank yang bergerak
  coa_lawan     TEXT NOT NULL,
  coa_tujuan    TEXT,                   -- untuk transfer
  nominal       INTEGER NOT NULL,
  keterangan    TEXT,
  pihak         TEXT,
  cabang_id     INTEGER REFERENCES cabang(id),
  unit_usaha_id INTEGER REFERENCES unit_usaha(id),
  jurnal_id     INTEGER,
  rekonsiliasi  INTEGER NOT NULL DEFAULT 0,
  tanggal_rekon TEXT,
  dibuat_oleh   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cash_opname (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tanggal       TEXT NOT NULL,
  coa_kas       TEXT NOT NULL,
  saldo_sistem  INTEGER NOT NULL,
  saldo_fisik   INTEGER NOT NULL,
  selisih       INTEGER NOT NULL,
  keterangan    TEXT,
  jurnal_id     INTEGER,
  petugas       TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------
-- 10. ANGGARAN (RKAP)
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS anggaran (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tahun         INTEGER NOT NULL,
  nama          TEXT NOT NULL,
  unit_usaha_id INTEGER REFERENCES unit_usaha(id),
  cabang_id     INTEGER REFERENCES cabang(id),
  status        TEXT NOT NULL DEFAULT 'draft',  -- draft|diajukan|disetujui|ditolak
  disetujui_oleh TEXT,
  disetujui_pada TEXT,
  keterangan    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS anggaran_detail (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  anggaran_id   INTEGER NOT NULL REFERENCES anggaran(id) ON DELETE CASCADE,
  coa_kode      TEXT NOT NULL,
  bulan         INTEGER NOT NULL DEFAULT 0,     -- 0 = tahunan
  nominal       INTEGER NOT NULL DEFAULT 0,
  keterangan    TEXT
);

-- ---------------------------------------------------------------------
-- 11. PERSEDIAAN
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS kategori_barang (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kode          TEXT NOT NULL UNIQUE,
  nama          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gudang (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kode          TEXT NOT NULL UNIQUE,
  nama          TEXT NOT NULL,
  alamat        TEXT,
  cabang_id     INTEGER REFERENCES cabang(id),
  unit_usaha_id INTEGER REFERENCES unit_usaha(id),
  status        TEXT NOT NULL DEFAULT 'aktif'
);

CREATE TABLE IF NOT EXISTS barang (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kode          TEXT NOT NULL UNIQUE,
  barcode       TEXT,
  nama          TEXT NOT NULL,
  kategori_id   INTEGER REFERENCES kategori_barang(id),
  satuan        TEXT NOT NULL DEFAULT 'PCS',
  harga_beli    INTEGER NOT NULL DEFAULT 0,     -- HPP rata-rata bergerak
  harga_jual    INTEGER NOT NULL DEFAULT 0,
  harga_anggota INTEGER NOT NULL DEFAULT 0,     -- 12. member price
  stok_minimum  INTEGER NOT NULL DEFAULT 0,
  reorder_point INTEGER NOT NULL DEFAULT 0,
  pakai_batch   INTEGER NOT NULL DEFAULT 0,
  pajak_id      INTEGER REFERENCES pajak(id),
  coa_persediaan TEXT,
  coa_penjualan TEXT,
  coa_hpp       TEXT,
  status        TEXT NOT NULL DEFAULT 'aktif',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_barang_barcode ON barang(barcode);

CREATE TABLE IF NOT EXISTS stok (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  barang_id     INTEGER NOT NULL REFERENCES barang(id),
  gudang_id     INTEGER NOT NULL REFERENCES gudang(id),
  qty           REAL NOT NULL DEFAULT 0,
  UNIQUE(barang_id, gudang_id)
);

CREATE TABLE IF NOT EXISTS mutasi_stok (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tanggal       TEXT NOT NULL,
  barang_id     INTEGER NOT NULL REFERENCES barang(id),
  gudang_id     INTEGER NOT NULL REFERENCES gudang(id),
  jenis         TEXT NOT NULL,          -- masuk|keluar|transfer_masuk|transfer_keluar|opname|retur_masuk|retur_keluar
  qty           REAL NOT NULL,          -- (+) menambah, (-) mengurangi
  harga         INTEGER NOT NULL DEFAULT 0,
  saldo_qty     REAL NOT NULL DEFAULT 0,
  batch         TEXT,
  serial_number TEXT,
  expired       TEXT,
  referensi     TEXT,
  keterangan    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mutasi_barang ON mutasi_stok(barang_id, tanggal);

CREATE TABLE IF NOT EXISTS stock_opname (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nomor         TEXT NOT NULL UNIQUE,
  tanggal       TEXT NOT NULL,
  gudang_id     INTEGER NOT NULL REFERENCES gudang(id),
  status        TEXT NOT NULL DEFAULT 'draft',  -- draft|selesai
  keterangan    TEXT,
  jurnal_id     INTEGER,
  petugas       TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stock_opname_detail (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  opname_id     INTEGER NOT NULL REFERENCES stock_opname(id) ON DELETE CASCADE,
  barang_id     INTEGER NOT NULL REFERENCES barang(id),
  qty_sistem    REAL NOT NULL DEFAULT 0,
  qty_fisik     REAL NOT NULL DEFAULT 0,
  selisih       REAL NOT NULL DEFAULT 0,
  nilai_selisih INTEGER NOT NULL DEFAULT 0,
  keterangan    TEXT
);

-- ---------------------------------------------------------------------
-- 12 & 14. PENJUALAN / POS TOKO KOPERASI
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS penjualan (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nomor         TEXT NOT NULL UNIQUE,
  tanggal       TEXT NOT NULL,
  tipe          TEXT NOT NULL DEFAULT 'pos',   -- pos|sales_order|invoice
  anggota_id    INTEGER REFERENCES anggota(id),
  customer_id   INTEGER REFERENCES customer(id),
  gudang_id     INTEGER REFERENCES gudang(id),
  unit_usaha_id INTEGER REFERENCES unit_usaha(id),
  cabang_id     INTEGER REFERENCES cabang(id),
  subtotal      INTEGER NOT NULL DEFAULT 0,
  diskon        INTEGER NOT NULL DEFAULT 0,
  pajak         INTEGER NOT NULL DEFAULT 0,
  total         INTEGER NOT NULL DEFAULT 0,
  hpp           INTEGER NOT NULL DEFAULT 0,
  bayar         INTEGER NOT NULL DEFAULT 0,
  kembali       INTEGER NOT NULL DEFAULT 0,
  metode_bayar  TEXT NOT NULL DEFAULT 'tunai', -- tunai|qris|transfer|piutang|potong_simpanan
  poin_didapat  INTEGER NOT NULL DEFAULT 0,
  poin_dipakai  INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'selesai', -- draft|dipesan|selesai|batal|retur
  jurnal_id     INTEGER,
  kasir         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_jual_tanggal ON penjualan(tanggal);

CREATE TABLE IF NOT EXISTS penjualan_detail (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  penjualan_id  INTEGER NOT NULL REFERENCES penjualan(id) ON DELETE CASCADE,
  barang_id     INTEGER NOT NULL REFERENCES barang(id),
  qty           REAL NOT NULL,
  harga         INTEGER NOT NULL,
  diskon        INTEGER NOT NULL DEFAULT 0,
  subtotal      INTEGER NOT NULL,
  hpp_satuan    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS loyalty_poin (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  anggota_id    INTEGER NOT NULL REFERENCES anggota(id),
  tanggal       TEXT NOT NULL,
  poin          INTEGER NOT NULL,       -- (+) dapat, (-) tukar
  saldo         INTEGER NOT NULL DEFAULT 0,
  referensi     TEXT,
  keterangan    TEXT
);

-- ---------------------------------------------------------------------
-- 13. PEMBELIAN
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pembelian (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nomor         TEXT NOT NULL UNIQUE,
  tanggal       TEXT NOT NULL,
  tipe          TEXT NOT NULL DEFAULT 'po',    -- pr|po|penerimaan|invoice
  supplier_id   INTEGER REFERENCES supplier(id),
  gudang_id     INTEGER REFERENCES gudang(id),
  unit_usaha_id INTEGER REFERENCES unit_usaha(id),
  cabang_id     INTEGER REFERENCES cabang(id),
  subtotal      INTEGER NOT NULL DEFAULT 0,
  diskon        INTEGER NOT NULL DEFAULT 0,
  pajak         INTEGER NOT NULL DEFAULT 0,
  total         INTEGER NOT NULL DEFAULT 0,
  terbayar      INTEGER NOT NULL DEFAULT 0,
  jatuh_tempo   TEXT,
  status        TEXT NOT NULL DEFAULT 'draft',
  -- draft|diajukan|disetujui|diterima|selesai|batal
  jurnal_id     INTEGER,
  dibuat_oleh   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pembelian_detail (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  pembelian_id  INTEGER NOT NULL REFERENCES pembelian(id) ON DELETE CASCADE,
  barang_id     INTEGER NOT NULL REFERENCES barang(id),
  qty           REAL NOT NULL,
  qty_diterima  REAL NOT NULL DEFAULT 0,
  harga         INTEGER NOT NULL,
  diskon        INTEGER NOT NULL DEFAULT 0,
  subtotal      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS hutang_piutang (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  jenis         TEXT NOT NULL,          -- hutang|piutang
  referensi     TEXT NOT NULL,          -- pembelian:id / penjualan:id
  pihak         TEXT,
  supplier_id   INTEGER REFERENCES supplier(id),
  customer_id   INTEGER REFERENCES customer(id),
  anggota_id    INTEGER REFERENCES anggota(id),
  tanggal       TEXT NOT NULL,
  jatuh_tempo   TEXT,
  nominal       INTEGER NOT NULL,
  terbayar      INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'terbuka',  -- terbuka|lunas
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------
-- 16. ASET TETAP (PSAK 16)
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS aset_tetap (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  kode            TEXT NOT NULL UNIQUE,
  nama            TEXT NOT NULL,
  kategori        TEXT,                 -- tanah|bangunan|kendaraan|inventaris|mesin
  tanggal_perolehan TEXT NOT NULL,
  harga_perolehan INTEGER NOT NULL,
  nilai_residu    INTEGER NOT NULL DEFAULT 0,
  umur_manfaat    INTEGER NOT NULL DEFAULT 4,   -- tahun
  metode          TEXT NOT NULL DEFAULT 'garis_lurus', -- garis_lurus|saldo_menurun
  akumulasi_penyusutan INTEGER NOT NULL DEFAULT 0,
  nilai_buku      INTEGER NOT NULL DEFAULT 0,
  lokasi          TEXT,
  cabang_id       INTEGER REFERENCES cabang(id),
  unit_usaha_id   INTEGER REFERENCES unit_usaha(id),
  penanggung_jawab TEXT,
  coa_aset        TEXT,
  coa_akumulasi   TEXT,
  coa_beban       TEXT,
  barcode         TEXT,
  tanggal_disposal TEXT,
  nilai_disposal  INTEGER,
  status          TEXT NOT NULL DEFAULT 'aktif',  -- aktif|maintenance|dilepas|rusak
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS aset_penyusutan (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  aset_id       INTEGER NOT NULL REFERENCES aset_tetap(id) ON DELETE CASCADE,
  periode       TEXT NOT NULL,          -- YYYY-MM
  nominal       INTEGER NOT NULL,
  akumulasi     INTEGER NOT NULL,
  nilai_buku    INTEGER NOT NULL,
  jurnal_id     INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(aset_id, periode)
);

CREATE TABLE IF NOT EXISTS aset_maintenance (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  aset_id       INTEGER NOT NULL REFERENCES aset_tetap(id) ON DELETE CASCADE,
  tanggal       TEXT NOT NULL,
  jenis         TEXT,
  biaya         INTEGER NOT NULL DEFAULT 0,
  vendor        TEXT,
  keterangan    TEXT,
  jadwal_berikutnya TEXT
);

-- ---------------------------------------------------------------------
-- 6. SHU (Sisa Hasil Usaha) - UU 25/1992 Pasal 45
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS shu_periode (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  tahun             INTEGER NOT NULL UNIQUE,
  shu_bersih        INTEGER NOT NULL DEFAULT 0,
  total_simpanan    INTEGER NOT NULL DEFAULT 0,   -- dasar jasa modal
  total_transaksi   INTEGER NOT NULL DEFAULT 0,   -- dasar jasa usaha
  status            TEXT NOT NULL DEFAULT 'simulasi', -- simulasi|diajukan|disetujui|dibagikan
  disetujui_oleh    TEXT,
  disetujui_pada    TEXT,
  rat_id            INTEGER,
  jurnal_id         INTEGER,
  keterangan        TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS shu_alokasi (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  periode_id    INTEGER NOT NULL REFERENCES shu_periode(id) ON DELETE CASCADE,
  komponen      TEXT NOT NULL,          -- cadangan|jasa_modal|jasa_usaha|dana_pengurus|dana_karyawan|dana_pendidikan|dana_sosial|dana_pembangunan
  persentase    REAL NOT NULL DEFAULT 0,
  nominal       INTEGER NOT NULL DEFAULT 0,
  coa_kode      TEXT
);

CREATE TABLE IF NOT EXISTS shu_anggota (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  periode_id        INTEGER NOT NULL REFERENCES shu_periode(id) ON DELETE CASCADE,
  anggota_id        INTEGER NOT NULL REFERENCES anggota(id),
  simpanan_rata     INTEGER NOT NULL DEFAULT 0,
  nilai_transaksi   INTEGER NOT NULL DEFAULT 0,
  shu_jasa_modal    INTEGER NOT NULL DEFAULT 0,
  shu_jasa_usaha    INTEGER NOT NULL DEFAULT 0,
  shu_total         INTEGER NOT NULL DEFAULT 0,
  metode_bayar      TEXT,               -- tunai|simpanan
  dibayar           INTEGER NOT NULL DEFAULT 0,
  tanggal_bayar     TEXT,
  UNIQUE(periode_id, anggota_id)
);

-- ---------------------------------------------------------------------
-- 17. RAT (Rapat Anggota Tahunan) - UU 25/1992 Pasal 22-27
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS rat (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  nomor           TEXT NOT NULL UNIQUE,
  tahun_buku      INTEGER NOT NULL,
  judul           TEXT NOT NULL,
  tanggal         TEXT NOT NULL,
  waktu           TEXT,
  tempat          TEXT,
  jenis           TEXT NOT NULL DEFAULT 'tahunan',  -- tahunan|luar_biasa
  total_anggota   INTEGER NOT NULL DEFAULT 0,
  hadir           INTEGER NOT NULL DEFAULT 0,
  kuorum_persen   REAL NOT NULL DEFAULT 50,
  kuorum_tercapai INTEGER NOT NULL DEFAULT 0,
  berita_acara    TEXT,
  status          TEXT NOT NULL DEFAULT 'rencana',  -- rencana|undangan|berlangsung|selesai|batal
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rat_agenda (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  rat_id        INTEGER NOT NULL REFERENCES rat(id) ON DELETE CASCADE,
  urut          INTEGER NOT NULL DEFAULT 0,
  judul         TEXT NOT NULL,
  keterangan    TEXT,
  jenis         TEXT NOT NULL DEFAULT 'pembahasan',  -- pembahasan|laporan|voting
  dokumen_id    INTEGER,
  status        TEXT NOT NULL DEFAULT 'terbuka'
);

CREATE TABLE IF NOT EXISTS rat_peserta (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  rat_id        INTEGER NOT NULL REFERENCES rat(id) ON DELETE CASCADE,
  anggota_id    INTEGER NOT NULL REFERENCES anggota(id),
  hadir         INTEGER NOT NULL DEFAULT 0,
  waktu_hadir   TEXT,
  kuasa_kepada  INTEGER,
  ttd_elektronik TEXT,                  -- UU ITE
  UNIQUE(rat_id, anggota_id)
);

CREATE TABLE IF NOT EXISTS rat_voting (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  rat_id        INTEGER NOT NULL REFERENCES rat(id) ON DELETE CASCADE,
  agenda_id     INTEGER REFERENCES rat_agenda(id),
  judul         TEXT NOT NULL,
  opsi          TEXT NOT NULL,          -- JSON array
  mulai         TEXT,
  selesai       TEXT,
  status        TEXT NOT NULL DEFAULT 'draft',  -- draft|dibuka|ditutup
  hasil         TEXT
);

CREATE TABLE IF NOT EXISTS rat_suara (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  voting_id     INTEGER NOT NULL REFERENCES rat_voting(id) ON DELETE CASCADE,
  anggota_id    INTEGER NOT NULL REFERENCES anggota(id),
  pilihan       TEXT NOT NULL,
  waktu         TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(voting_id, anggota_id)
);

-- ---------------------------------------------------------------------
-- 18. DOCUMENT MANAGEMENT SYSTEM
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS dokumen (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nomor         TEXT,
  judul         TEXT NOT NULL,
  kategori      TEXT NOT NULL,          -- ad_art|sop|kebijakan|notulen|kontrak|legalitas|sertifikat|rat|surat|lainnya
  deskripsi     TEXT,
  versi         INTEGER NOT NULL DEFAULT 1,
  file_nama     TEXT,
  file_mime     TEXT,
  file_ukuran   INTEGER,
  file_path     TEXT,
  hash_sha256   TEXT,                   -- integritas dokumen (UU ITE)
  tag           TEXT,
  isi_teks      TEXT,                   -- hasil OCR / teks untuk pencarian
  retensi_tahun INTEGER NOT NULL DEFAULT 10,
  tanggal_kadaluarsa TEXT,
  ttd_elektronik TEXT,
  ttd_oleh      TEXT,
  ttd_pada      TEXT,
  status        TEXT NOT NULL DEFAULT 'draft',  -- draft|review|disetujui|kadaluarsa|arsip
  pemilik       TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dok_kategori ON dokumen(kategori);

CREATE TABLE IF NOT EXISTS dokumen_versi (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  dokumen_id    INTEGER NOT NULL REFERENCES dokumen(id) ON DELETE CASCADE,
  versi         INTEGER NOT NULL,
  file_path     TEXT,
  hash_sha256   TEXT,
  catatan       TEXT,
  oleh          TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Persuratan (surat masuk & keluar)
CREATE TABLE IF NOT EXISTS surat (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nomor         TEXT NOT NULL,
  jenis         TEXT NOT NULL,          -- masuk|keluar
  tanggal       TEXT NOT NULL,
  perihal       TEXT NOT NULL,
  dari          TEXT,
  kepada        TEXT,
  sifat         TEXT DEFAULT 'biasa',   -- biasa|penting|segera|rahasia
  isi           TEXT,
  lampiran      TEXT,
  disposisi     TEXT,
  disposisi_kepada TEXT,
  dokumen_id    INTEGER REFERENCES dokumen(id),
  status        TEXT NOT NULL DEFAULT 'baru',   -- baru|diproses|selesai|arsip
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------
-- 19. WORKFLOW APPROVAL
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS approval_flow (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  modul         TEXT NOT NULL,          -- pinjaman|pembelian|anggaran|jurnal|shu|dokumen
  nama          TEXT NOT NULL,
  batas_min     INTEGER NOT NULL DEFAULT 0,
  batas_max     INTEGER NOT NULL DEFAULT 0,   -- 0 = tak terbatas
  tahapan       TEXT NOT NULL,          -- JSON: [{"urut":1,"role":"manajer_unit","tipe":"berjenjang"}]
  status        TEXT NOT NULL DEFAULT 'aktif'
);

CREATE TABLE IF NOT EXISTS approval_request (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nomor         TEXT NOT NULL UNIQUE,
  modul         TEXT NOT NULL,
  entitas_id    INTEGER NOT NULL,
  judul         TEXT NOT NULL,
  nominal       INTEGER NOT NULL DEFAULT 0,
  ringkasan     TEXT,
  pemohon       TEXT,
  pemohon_id    INTEGER,
  tahap_aktif   INTEGER NOT NULL DEFAULT 1,
  status        TEXT NOT NULL DEFAULT 'menunggu',  -- menunggu|disetujui|ditolak|dibatalkan
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  selesai_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_appr_status ON approval_request(status);

CREATE TABLE IF NOT EXISTS approval_step (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id    INTEGER NOT NULL REFERENCES approval_request(id) ON DELETE CASCADE,
  urut          INTEGER NOT NULL,
  role          TEXT NOT NULL,
  tipe          TEXT NOT NULL DEFAULT 'berjenjang',  -- berjenjang|parallel
  status        TEXT NOT NULL DEFAULT 'menunggu',    -- menunggu|disetujui|ditolak|dilewati
  oleh          TEXT,
  delegasi_ke   TEXT,
  catatan       TEXT,
  ttd_elektronik TEXT,
  waktu         TEXT,
  batas_waktu   TEXT
);

-- ---------------------------------------------------------------------
-- 20. COMPLIANCE (perizinan & kepatuhan)
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS compliance_item (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kategori      TEXT NOT NULL,          -- legalitas|perpajakan|ketenagakerjaan|perkoperasian|oss
  nama          TEXT NOT NULL,
  dasar_hukum   TEXT,
  nomor         TEXT,
  penerbit      TEXT,
  tanggal_terbit TEXT,
  tanggal_kadaluarsa TEXT,
  pic           TEXT,
  dokumen_id    INTEGER REFERENCES dokumen(id),
  status        TEXT NOT NULL DEFAULT 'patuh',  -- patuh|perlu_perhatian|tidak_patuh|kadaluarsa
  catatan       TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------
-- 21. INTERNAL AUDIT
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_plan (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nomor         TEXT NOT NULL UNIQUE,
  judul         TEXT NOT NULL,
  tahun         INTEGER NOT NULL,
  objek         TEXT,                   -- unit/modul yang diaudit
  auditor       TEXT,
  tanggal_mulai TEXT,
  tanggal_selesai TEXT,
  ruang_lingkup TEXT,
  status        TEXT NOT NULL DEFAULT 'rencana',  -- rencana|berjalan|selesai
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_temuan (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id       INTEGER REFERENCES audit_plan(id) ON DELETE CASCADE,
  kode          TEXT,
  judul         TEXT NOT NULL,
  deskripsi     TEXT,
  kriteria      TEXT,
  sebab         TEXT,
  akibat        TEXT,
  rekomendasi   TEXT,
  risk_rating   TEXT NOT NULL DEFAULT 'sedang',  -- rendah|sedang|tinggi|kritis
  capa          TEXT,                   -- corrective & preventive action
  pic           TEXT,
  batas_waktu   TEXT,
  bukti         TEXT,
  status        TEXT NOT NULL DEFAULT 'terbuka',  -- terbuka|proses|selesai|dibatalkan
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------
-- 22. ENTERPRISE RISK MANAGEMENT
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS risiko (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  kode            TEXT NOT NULL UNIQUE,
  nama            TEXT NOT NULL,
  kategori        TEXT NOT NULL,        -- kredit|likuiditas|operasional|kepatuhan|strategis|reputasi|teknologi
  deskripsi       TEXT,
  penyebab        TEXT,
  dampak_deskripsi TEXT,
  unit_usaha_id   INTEGER REFERENCES unit_usaha(id),
  likelihood      INTEGER NOT NULL DEFAULT 3,   -- 1-5
  impact          INTEGER NOT NULL DEFAULT 3,   -- 1-5
  skor_inheren    INTEGER NOT NULL DEFAULT 9,
  kontrol         TEXT,
  efektivitas_kontrol TEXT DEFAULT 'sedang',    -- lemah|sedang|kuat
  likelihood_residu INTEGER NOT NULL DEFAULT 2,
  impact_residu   INTEGER NOT NULL DEFAULT 2,
  skor_residu     INTEGER NOT NULL DEFAULT 4,
  mitigasi        TEXT,
  pic             TEXT,
  kri_nama        TEXT,                 -- key risk indicator
  kri_ambang      REAL,
  kri_nilai       REAL,
  status          TEXT NOT NULL DEFAULT 'aktif',
  review_terakhir TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------
-- 23. CRM ANGGOTA
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tiket (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nomor         TEXT NOT NULL UNIQUE,
  anggota_id    INTEGER REFERENCES anggota(id),
  kategori      TEXT NOT NULL DEFAULT 'pertanyaan',  -- pengaduan|pertanyaan|saran|klaim
  prioritas     TEXT NOT NULL DEFAULT 'normal',      -- rendah|normal|tinggi|urgent
  judul         TEXT NOT NULL,
  isi           TEXT,
  kanal         TEXT DEFAULT 'aplikasi',             -- aplikasi|whatsapp|telepon|email|langsung
  petugas       TEXT,
  status        TEXT NOT NULL DEFAULT 'baru',        -- baru|diproses|menunggu|selesai|ditutup
  rating        INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  selesai_at    TEXT
);

CREATE TABLE IF NOT EXISTS tiket_balasan (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tiket_id      INTEGER NOT NULL REFERENCES tiket(id) ON DELETE CASCADE,
  oleh          TEXT,
  is_petugas    INTEGER NOT NULL DEFAULT 0,
  isi           TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS broadcast (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  judul         TEXT NOT NULL,
  pesan         TEXT NOT NULL,
  kanal         TEXT NOT NULL DEFAULT 'aplikasi',   -- aplikasi|whatsapp|sms|email
  target        TEXT NOT NULL DEFAULT 'semua',      -- semua|aktif|cabang|punya_pinjaman|kustom
  target_param  TEXT,
  jumlah_target INTEGER NOT NULL DEFAULT 0,
  jadwal        TEXT,
  status        TEXT NOT NULL DEFAULT 'draft',      -- draft|terjadwal|terkirim|gagal
  dikirim_pada  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS survey_kepuasan (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  anggota_id    INTEGER REFERENCES anggota(id),
  periode       TEXT,
  skor_layanan  INTEGER,
  skor_produk   INTEGER,
  skor_petugas  INTEGER,
  nps           INTEGER,
  saran         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
