/**
 * Definisi menu navigasi dan pemetaan rute ke modul tampilan.
 * Modul dimuat secara malas (lazy) agar waktu muat awal tetap ringan.
 */

export const MENU = [
  {
    judul: 'Ikhtisar',
    item: [
      { rute: '/', nama: 'Dasbor Eksekutif', ikon: 'dasbor', izin: 'dashboard.view' },
      { rute: '/bi', nama: 'Business Intelligence', ikon: 'analitik', izin: 'bi.view' },
      { rute: '/portal', nama: 'Portal Anggota', ikon: 'ponsel', izin: 'portal.view' },
    ],
  },
  {
    judul: 'Keanggotaan & Simpan Pinjam',
    item: [
      { rute: '/anggota', nama: 'Keanggotaan', ikon: 'anggota', izin: 'anggota.view' },
      { rute: '/simpanan', nama: 'Simpanan', ikon: 'dompet', izin: 'simpanan.view' },
      { rute: '/pinjaman', nama: 'Pinjaman', ikon: 'kartu', izin: 'pinjaman.view' },
      { rute: '/shu', nama: 'SHU', ikon: 'bagan', izin: 'shu.view' },
    ],
  },
  {
    judul: 'Usaha & Perdagangan',
    item: [
      { rute: '/pos', nama: 'Kasir Toko (POS)', ikon: 'keranjang', izin: 'pos.view' },
      { rute: '/persediaan', nama: 'Persediaan', ikon: 'kotak', izin: 'persediaan.view' },
      { rute: '/pembelian', nama: 'Pembelian', ikon: 'truk', izin: 'pembelian.view' },
      { rute: '/penjualan', nama: 'Penjualan', ikon: 'struk', izin: 'penjualan.view' },
      { rute: '/unit-usaha', nama: 'Unit Usaha', ikon: 'gedung', izin: 'unit.view' },
    ],
  },
  {
    judul: 'Keuangan',
    item: [
      { rute: '/akuntansi', nama: 'Akuntansi', ikon: 'buku', izin: 'akuntansi.view' },
      { rute: '/laporan', nama: 'Laporan Keuangan', ikon: 'laporan', izin: 'laporan.view' },
      { rute: '/kas', nama: 'Kas & Bank', ikon: 'uang', izin: 'kas.view' },
      { rute: '/anggaran', nama: 'Anggaran (RKAP)', ikon: 'sasaran', izin: 'anggaran.view' },
      { rute: '/aset', nama: 'Aset Tetap', ikon: 'lapis', izin: 'aset.view' },
    ],
  },
  {
    judul: 'Organisasi & Tata Kelola',
    item: [
      { rute: '/rat', nama: 'RAT', ikon: 'papan', izin: 'rat.view' },
      { rute: '/approval', nama: 'Persetujuan', ikon: 'centang', izin: 'approval.view' },
      { rute: '/dokumen', nama: 'Dokumen & Surat', ikon: 'map', izin: 'dokumen.view' },
      { rute: '/compliance', nama: 'Kepatuhan', ikon: 'neraca', izin: 'compliance.view' },
      { rute: '/audit', nama: 'Audit Internal', ikon: 'kaca', izin: 'audit.view' },
      { rute: '/risiko', nama: 'Manajemen Risiko', ikon: 'waspada', izin: 'risiko.view' },
      { rute: '/crm', nama: 'CRM Anggota', ikon: 'obrol', izin: 'crm.view' },
    ],
  },
  {
    judul: 'Sistem',
    item: [
      { rute: '/master', nama: 'Master Data', ikon: 'basis', izin: 'master.view' },
      { rute: '/admin', nama: 'Administrator', ikon: 'roda', izin: 'admin.view' },
    ],
  },
];

export const TAMPILAN = {
  '/': { judul: 'Dasbor Eksekutif', sub: 'Ringkasan kinerja koperasi', izin: 'dashboard.view', muat: () => import('./tampilan/dasbor.js') },
  '/bi': { judul: 'Business Intelligence', sub: 'Analitik & proyeksi', izin: 'bi.view', muat: () => import('./tampilan/bi.js') },
  '/portal': { judul: 'Portal Anggota', sub: 'Layanan mandiri anggota', izin: 'portal.view', muat: () => import('./tampilan/portal.js') },

  '/anggota': { judul: 'Manajemen Keanggotaan', sub: 'UU No. 25 Tahun 1992', izin: 'anggota.view', muat: () => import('./tampilan/anggota.js') },
  '/simpanan': { judul: 'Simpanan', sub: 'Pokok, wajib, sukarela & berjangka', izin: 'simpanan.view', muat: () => import('./tampilan/simpanan.js') },
  '/pinjaman': { judul: 'Pinjaman', sub: 'Pengajuan hingga pelunasan', izin: 'pinjaman.view', muat: () => import('./tampilan/pinjaman.js') },
  '/shu': { judul: 'Sisa Hasil Usaha', sub: 'UU No. 25 Tahun 1992 Pasal 45', izin: 'shu.view', muat: () => import('./tampilan/shu.js') },

  '/pos': { judul: 'Kasir Toko Koperasi', sub: 'Point of Sale', izin: 'pos.view', muat: () => import('./tampilan/pos.js') },
  '/persediaan': { judul: 'Persediaan', sub: 'Perpetual · rata-rata bergerak', izin: 'persediaan.view', muat: () => import('./tampilan/persediaan.js') },
  '/pembelian': { judul: 'Pembelian', sub: 'PR, PO, penerimaan & utang', izin: 'pembelian.view', muat: () => import('./tampilan/pembelian.js') },
  '/penjualan': { judul: 'Penjualan', sub: 'Riwayat transaksi & piutang', izin: 'penjualan.view', muat: () => import('./tampilan/penjualan.js') },
  '/unit-usaha': { judul: 'Unit Usaha', sub: 'Kinerja per segmen usaha', izin: 'unit.view', muat: () => import('./tampilan/unit.js') },

  '/akuntansi': { judul: 'Akuntansi', sub: 'Permenkop UKM No. 2 Tahun 2024', izin: 'akuntansi.view', muat: () => import('./tampilan/akuntansi.js') },
  '/laporan': { judul: 'Laporan Keuangan', sub: 'SAK Entitas Privat', izin: 'laporan.view', muat: () => import('./tampilan/laporan.js') },
  '/kas': { judul: 'Kas & Bank', sub: 'Penerimaan, pengeluaran & rekonsiliasi', izin: 'kas.view', muat: () => import('./tampilan/kas.js') },
  '/anggaran': { judul: 'Anggaran (RKAP)', sub: 'Rencana kerja & anggaran', izin: 'anggaran.view', muat: () => import('./tampilan/anggaran.js') },
  '/aset': { judul: 'Aset Tetap', sub: 'PSAK 16 · penyusutan', izin: 'aset.view', muat: () => import('./tampilan/aset.js') },

  '/rat': { judul: 'Rapat Anggota Tahunan', sub: 'Agenda, kuorum & voting', izin: 'rat.view', muat: () => import('./tampilan/rat.js') },
  '/approval': { judul: 'Workflow Persetujuan', sub: 'Berjenjang & paralel', izin: 'approval.view', muat: () => import('./tampilan/approval.js') },
  '/dokumen': { judul: 'Dokumen & Persuratan', sub: 'DMS · UU ITE', izin: 'dokumen.view', muat: () => import('./tampilan/dokumen.js') },
  '/compliance': { judul: 'Kepatuhan', sub: 'Legalitas, pajak & perizinan', izin: 'compliance.view', muat: () => import('./tampilan/compliance.js') },
  '/audit': { judul: 'Audit Internal', sub: 'Temuan & CAPA', izin: 'audit.view', muat: () => import('./tampilan/audit.js') },
  '/risiko': { judul: 'Enterprise Risk Management', sub: 'Risk register & matriks', izin: 'risiko.view', muat: () => import('./tampilan/risiko.js') },
  '/crm': { judul: 'CRM Anggota', sub: 'Tiket, broadcast & survei', izin: 'crm.view', muat: () => import('./tampilan/crm.js') },

  '/master': { judul: 'Master Data', sub: 'Data acuan sistem', izin: 'master.view', muat: () => import('./tampilan/master.js') },
  '/admin': { judul: 'Administrator', sub: 'Pengguna, RBAC & keamanan', izin: 'admin.view', muat: () => import('./tampilan/admin.js') },
};
