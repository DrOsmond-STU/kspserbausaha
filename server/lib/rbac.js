/**
 * Role Based Access Control.
 *
 * Format izin: "<modul>.<aksi>"  contoh: "pinjaman.approve"
 * Wildcard   : "*" (seluruh sistem) atau "pinjaman.*" (seluruh aksi pada modul)
 *
 * Aksi baku: view | create | update | delete | approve | post | export
 */

export const MODULES = [
  'dashboard', 'master', 'anggota', 'simpanan', 'pinjaman', 'shu', 'akuntansi',
  'laporan', 'kas', 'anggaran', 'persediaan', 'pos', 'pembelian', 'penjualan',
  'unit', 'aset', 'rat', 'dokumen', 'surat', 'approval', 'compliance',
  'audit', 'risiko', 'crm', 'bi', 'admin',
];

const viewAll = MODULES.filter((m) => m !== 'admin').map((m) => `${m}.view`);

export const ROLES = {
  super_admin: {
    nama: 'Super Administrator',
    deskripsi: 'Konfigurasi sistem, keamanan, integrasi, dan seluruh modul',
    permissions: ['*'],
  },
  pengurus: {
    nama: 'Pengurus Koperasi',
    deskripsi: 'Monitoring operasional, persetujuan transaksi, laporan strategis',
    permissions: [
      ...viewAll, 'laporan.export', 'bi.*',
      'pinjaman.approve', 'pembelian.approve', 'anggaran.approve', 'shu.approve',
      'jurnal.approve', 'approval.*', 'anggota.approve', 'rat.*', 'dokumen.*',
      'surat.*', 'unit.*', 'risiko.update', 'compliance.update', 'crm.update',
      'master.update', 'anggaran.create', 'anggaran.update',
    ],
  },
  pengawas: {
    nama: 'Pengawas',
    deskripsi: 'Akses audit, laporan keuangan, kepatuhan, dan monitoring tanpa mengubah data',
    // Read-only by design (GCG: fungsi pengawasan terpisah dari eksekusi)
    permissions: [...viewAll, 'laporan.export', 'audit.view', 'audit.create',
      'audit.update', 'risiko.view', 'compliance.view', 'admin.view'],
  },
  manajer_unit: {
    nama: 'Manajer Unit Usaha',
    deskripsi: 'Mengelola transaksi dan operasional unit usaha masing-masing',
    permissions: [
      'dashboard.view', 'unit.*', 'persediaan.*', 'pos.*', 'penjualan.*',
      'pembelian.create', 'pembelian.update', 'pembelian.view', 'pembelian.approve',
      'anggaran.view', 'anggaran.create', 'anggaran.update', 'laporan.view',
      'laporan.export', 'master.view', 'anggota.view', 'aset.view', 'bi.view',
      'crm.view', 'crm.update', 'approval.view', 'dokumen.view', 'akuntansi.view',
    ],
  },
  bendahara: {
    nama: 'Bendahara',
    deskripsi: 'Kas, bank, akuntansi, pembayaran, dan rekonsiliasi',
    permissions: [
      'dashboard.view', 'kas.*', 'akuntansi.*', 'laporan.*', 'anggaran.*',
      'aset.*', 'pembelian.view', 'pembelian.update', 'penjualan.view',
      'simpanan.view', 'pinjaman.view', 'shu.view', 'shu.create', 'master.view',
      'master.update', 'anggota.view', 'approval.view', 'bi.view', 'unit.view',
      'dokumen.view', 'persediaan.view',
    ],
  },
  petugas_simpanan: {
    nama: 'Petugas Simpanan',
    deskripsi: 'Mengelola simpanan anggota',
    permissions: [
      'dashboard.view', 'simpanan.*', 'anggota.view', 'anggota.create',
      'anggota.update', 'master.view', 'laporan.view', 'kas.view', 'crm.view',
      'crm.update', 'approval.view',
    ],
  },
  petugas_pinjaman: {
    nama: 'Petugas Pinjaman',
    deskripsi: 'Pengajuan, analisis, pencairan, dan penagihan pinjaman',
    permissions: [
      'dashboard.view', 'pinjaman.view', 'pinjaman.create', 'pinjaman.update',
      'pinjaman.post', 'anggota.view', 'simpanan.view', 'master.view',
      'laporan.view', 'kas.view', 'crm.view', 'crm.update', 'approval.view',
    ],
  },
  kasir_toko: {
    nama: 'Kasir Toko',
    deskripsi: 'Penjualan POS, penerimaan pembayaran, dan retur',
    permissions: [
      'dashboard.view', 'pos.*', 'penjualan.view', 'penjualan.create',
      'persediaan.view', 'anggota.view', 'master.view', 'kas.view',
    ],
  },
  staf_gudang: {
    nama: 'Staf Gudang',
    deskripsi: 'Persediaan, mutasi stok, dan stock opname',
    permissions: [
      'dashboard.view', 'persediaan.*', 'pembelian.view', 'pembelian.update',
      'penjualan.view', 'master.view', 'laporan.view',
    ],
  },
  auditor_internal: {
    nama: 'Auditor Internal',
    deskripsi: 'Audit, temuan, CAPA, dan pelaporan',
    permissions: [...viewAll, 'audit.*', 'risiko.*', 'compliance.*',
      'laporan.export', 'admin.view'],
  },
  anggota: {
    nama: 'Anggota',
    deskripsi: 'Melihat data pribadi, simpanan, pinjaman, SHU, RAT, dan layanan mandiri',
    permissions: ['portal.*'],
  },
};

/** Daftar kode role yang valid. */
export const ROLE_CODES = Object.keys(ROLES);

/** Apakah role memiliki izin tertentu. */
export function can(role, permission) {
  const def = ROLES[role];
  if (!def) return false;
  const [modul] = permission.split('.');
  return def.permissions.some(
    (p) => p === '*' || p === permission || p === `${modul}.*`,
  );
}

/** Daftar modul yang boleh dilihat oleh sebuah role (untuk menu navigasi). */
export function visibleModules(role) {
  if (role === 'anggota') return ['portal'];
  return MODULES.filter((m) => can(role, `${m}.view`));
}

/** Ringkasan role untuk ditampilkan di UI. */
export function roleInfo(role) {
  const def = ROLES[role];
  return def ? { kode: role, nama: def.nama, deskripsi: def.deskripsi } : null;
}
