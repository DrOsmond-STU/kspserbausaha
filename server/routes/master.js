/**
 * Modul 2 - Master Data.
 */
import { createRouter, badRequest, conflict } from '../lib/http.js';
import { crud, mountCrud } from '../lib/crud.js';
import { all, get, run, scalar } from '../db.js';
import { logAudit } from '../lib/audit.js';

const router = createRouter();

// ------------------------------ Cabang ------------------------------
mountCrud(router, '/api/master/cabang', 'master', crud({
  table: 'cabang', modul: 'master',
  fields: ['kode', 'nama', 'alamat', 'kota', 'telepon', 'is_pusat', 'status'],
  required: ['kode', 'nama'], unique: ['kode'], search: ['kode', 'nama', 'kota'], orderBy: 'kode ASC',
}));

// ---------------------------- Unit Usaha ----------------------------
mountCrud(router, '/api/master/unit-usaha', 'master', crud({
  table: 'unit_usaha', modul: 'master',
  fields: ['kode', 'nama', 'jenis', 'cabang_id', 'penanggung_jawab', 'status'],
  required: ['kode', 'nama', 'jenis'], unique: ['kode'], search: ['kode', 'nama'], orderBy: 'kode ASC',
  selectSql: `SELECT t.*, c.nama AS cabang_nama FROM unit_usaha t LEFT JOIN cabang c ON c.id = t.cabang_id`,
  filters: ['jenis', 'cabang_id'],
}));

// ------------------------ Chart of Account --------------------------
const coaResource = crud({
  table: 'coa', modul: 'master',
  fields: ['kode', 'nama', 'tipe', 'saldo_normal', 'parent_kode', 'level', 'is_kas', 'is_bank',
    'is_postable', 'status'],
  required: ['kode', 'nama', 'tipe', 'saldo_normal'], unique: ['kode'],
  search: ['kode', 'nama'], orderBy: 'kode ASC', filters: ['tipe'],
});
router.get('/api/master/coa', 'master.view', ({ query }) => {
  const res = coaResource.list({ ...query, limit: query.limit || 1000 });
  return res;
});
router.get('/api/master/coa/pohon', 'master.view', () => {
  const rows = all('SELECT * FROM coa ORDER BY kode');
  const map = new Map(rows.map((r) => [r.kode, { ...r, anak: [] }]));
  const akar = [];
  for (const r of map.values()) {
    if (r.parent_kode && map.has(r.parent_kode)) map.get(r.parent_kode).anak.push(r);
    else akar.push(r);
  }
  return { data: akar };
});
router.get('/api/master/coa/:id', 'master.view', ({ params }) => coaResource.detail(Number(params.id)));
router.post('/api/master/coa', 'master.create', ({ body, ctx }) => coaResource.create(body, ctx));
router.put('/api/master/coa/:id', 'master.update', ({ params, body, ctx }) =>
  coaResource.update(Number(params.id), body, ctx));
router.delete('/api/master/coa/:id', 'master.delete', ({ params, ctx }) => {
  const akun = get('SELECT kode FROM coa WHERE id = ?', [params.id]);
  if (akun) {
    const dipakai = scalar('SELECT COUNT(*) FROM jurnal_detail WHERE coa_kode = ?', [akun.kode]);
    if (dipakai > 0) {
      throw conflict(`Akun ${akun.kode} sudah memiliki ${dipakai} baris jurnal dan tidak dapat dihapus`,
        'Ubah status akun menjadi "nonaktif" agar tidak dapat dipakai pada transaksi baru.');
    }
  }
  return coaResource.remove(Number(params.id), ctx);
});

// ------------------------- Produk Simpanan --------------------------
mountCrud(router, '/api/master/produk-simpanan', 'master', crud({
  table: 'produk_simpanan', modul: 'master',
  fields: ['kode', 'nama', 'jenis', 'coa_kode', 'coa_beban_bunga', 'setoran_minimal', 'setoran_wajib',
    'bunga_tahunan', 'boleh_tarik', 'tenor_bulan', 'masuk_shu', 'status'],
  required: ['kode', 'nama', 'jenis', 'coa_kode'], unique: ['kode'],
  search: ['kode', 'nama'], orderBy: 'kode ASC', filters: ['jenis'],
}));

// ------------------------- Produk Pinjaman --------------------------
mountCrud(router, '/api/master/produk-pinjaman', 'master', crud({
  table: 'produk_pinjaman', modul: 'master',
  fields: ['kode', 'nama', 'jenis', 'metode_bunga', 'bunga_tahunan', 'tenor_min', 'tenor_max',
    'plafon_min', 'plafon_max', 'biaya_admin', 'biaya_provisi', 'denda_harian', 'coa_piutang',
    'coa_pendapatan_bunga', 'coa_pendapatan_admin', 'coa_pendapatan_denda', 'wajib_agunan', 'status'],
  required: ['kode', 'nama', 'jenis', 'coa_piutang', 'coa_pendapatan_bunga'], unique: ['kode'],
  search: ['kode', 'nama'], orderBy: 'kode ASC', filters: ['jenis'],
}));

// ---------------------------- Kategori & Barang ---------------------
mountCrud(router, '/api/master/kategori-barang', 'master', crud({
  table: 'kategori_barang', modul: 'master', fields: ['kode', 'nama'],
  required: ['kode', 'nama'], unique: ['kode'], search: ['kode', 'nama'], orderBy: 'kode ASC',
}));

mountCrud(router, '/api/master/barang', 'master', crud({
  table: 'barang', modul: 'master',
  fields: ['kode', 'barcode', 'nama', 'kategori_id', 'satuan', 'harga_beli', 'harga_jual',
    'harga_anggota', 'stok_minimum', 'reorder_point', 'pakai_batch', 'pajak_id',
    'coa_persediaan', 'coa_penjualan', 'coa_hpp', 'status'],
  required: ['kode', 'nama'], unique: ['kode'], search: ['kode', 'nama', 'barcode'], orderBy: 'kode ASC',
  filters: ['kategori_id'],
  selectSql: `SELECT t.*, k.nama AS kategori_nama,
                     (SELECT COALESCE(SUM(qty),0) FROM stok WHERE barang_id = t.id) AS stok
                FROM barang t LEFT JOIN kategori_barang k ON k.id = t.kategori_id`,
}));

// ---------------------------- Gudang --------------------------------
mountCrud(router, '/api/master/gudang', 'master', crud({
  table: 'gudang', modul: 'master',
  fields: ['kode', 'nama', 'alamat', 'cabang_id', 'unit_usaha_id', 'status'],
  required: ['kode', 'nama'], unique: ['kode'], search: ['kode', 'nama'], orderBy: 'kode ASC',
}));

// ---------------------------- Supplier ------------------------------
mountCrud(router, '/api/master/supplier', 'master', crud({
  table: 'supplier', modul: 'master',
  fields: ['kode', 'nama', 'npwp', 'alamat', 'telepon', 'email', 'termin_hari', 'rating', 'status'],
  required: ['kode', 'nama'], unique: ['kode'], search: ['kode', 'nama', 'telepon'], orderBy: 'kode ASC',
}));

// ---------------------------- Customer ------------------------------
mountCrud(router, '/api/master/customer', 'master', crud({
  table: 'customer', modul: 'master',
  fields: ['kode', 'nama', 'anggota_id', 'alamat', 'telepon', 'npwp', 'termin_hari', 'limit_piutang', 'status'],
  required: ['kode', 'nama'], unique: ['kode'], search: ['kode', 'nama', 'telepon'], orderBy: 'kode ASC',
}));

// -------------------------- Rekening Bank ---------------------------
mountCrud(router, '/api/master/bank', 'master', crud({
  table: 'bank_account', modul: 'master',
  fields: ['nama_bank', 'nomor_rekening', 'atas_nama', 'cabang_id', 'coa_kode', 'saldo_awal', 'status'],
  required: ['nama_bank', 'nomor_rekening', 'atas_nama', 'coa_kode'], unique: ['nomor_rekening'],
  search: ['nama_bank', 'nomor_rekening', 'atas_nama'], orderBy: 'nama_bank ASC', label: 'nama_bank',
}));

// ------------------------------ Pajak -------------------------------
mountCrud(router, '/api/master/pajak', 'master', crud({
  table: 'pajak', modul: 'master', fields: ['kode', 'nama', 'tarif', 'coa_kode', 'status'],
  required: ['kode', 'nama'], unique: ['kode'], search: ['kode', 'nama'], orderBy: 'kode ASC',
}));

// ----------------------------- Jabatan ------------------------------
mountCrud(router, '/api/master/jabatan', 'master', crud({
  table: 'jabatan', modul: 'master', fields: ['kode', 'nama', 'kelompok'],
  required: ['kode', 'nama'], unique: ['kode'], search: ['kode', 'nama'], orderBy: 'kode ASC',
  filters: ['kelompok'],
}));

// ---------------------- Karyawan / Pengurus / Pengawas ---------------
mountCrud(router, '/api/master/karyawan', 'master', crud({
  table: 'karyawan', modul: 'master',
  fields: ['nik', 'nama', 'jabatan_id', 'cabang_id', 'unit_usaha_id', 'telepon', 'email',
    'tgl_masuk', 'tgl_keluar', 'periode_mulai', 'periode_akhir', 'status'],
  required: ['nik', 'nama'], unique: ['nik'], search: ['nik', 'nama'], orderBy: 'nama ASC',
  selectSql: `SELECT t.*, j.nama AS jabatan_nama, j.kelompok, c.nama AS cabang_nama
                FROM karyawan t LEFT JOIN jabatan j ON j.id = t.jabatan_id
                LEFT JOIN cabang c ON c.id = t.cabang_id`,
  filters: ['cabang_id', 'unit_usaha_id'],
}));

/** Susunan pengurus & pengawas aktif (untuk laporan RAT). */
router.get('/api/master/perangkat-organisasi', 'master.view', () => {
  const rows = all(
    `SELECT k.*, j.nama AS jabatan_nama, j.kelompok FROM karyawan k
       JOIN jabatan j ON j.id = k.jabatan_id
      WHERE k.status = 'aktif' AND j.kelompok IN ('pengurus','pengawas')
      ORDER BY j.kelompok, j.kode`);
  return {
    pengurus: rows.filter((r) => r.kelompok === 'pengurus'),
    pengawas: rows.filter((r) => r.kelompok === 'pengawas'),
  };
});

export default router;
