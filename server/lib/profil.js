/**
 * Profil koperasi, aktivasi aplikasi, dan pengaturan tanda tangan cetakan.
 *
 * Seluruh cetakan (bukti transaksi, laporan, ekspor Excel/Word) mengambil kop
 * surat dan blok tanda tangan dari sini, sehingga cukup diubah sekali pada
 * menu Setup Koperasi.
 */
import { all, get, setting } from '../db.js';

/** Isian profil koperasi (kunci pengaturan `koperasi.<kunci>`). */
export const ISIAN_PROFIL = [
  { kunci: 'nama', label: 'Nama koperasi', wajib: true },
  { kunci: 'singkatan', label: 'Nama singkat / singkatan' },
  { kunci: 'badan_hukum', label: 'Nomor badan hukum' },
  { kunci: 'tanggal_badan_hukum', label: 'Tanggal badan hukum', tipe: 'date' },
  { kunci: 'nib', label: 'Nomor Induk Berusaha (NIB)' },
  { kunci: 'npwp', label: 'NPWP' },
  { kunci: 'nik_koperasi', label: 'Nomor Induk Koperasi (NIK)' },
  { kunci: 'alamat', label: 'Alamat kantor pusat' },
  { kunci: 'kota', label: 'Kota / kabupaten (dipakai pada tanggal tanda tangan)' },
  { kunci: 'provinsi', label: 'Provinsi' },
  { kunci: 'kode_pos', label: 'Kode pos' },
  { kunci: 'telepon', label: 'Telepon' },
  { kunci: 'email', label: 'Surel resmi', tipe: 'email' },
  { kunci: 'website', label: 'Situs web' },
  { kunci: 'tahun_berdiri', label: 'Tahun berdiri', tipe: 'number' },
  { kunci: 'ketua', label: 'Nama ketua pengurus' },
  { kunci: 'sekretaris', label: 'Nama sekretaris' },
  { kunci: 'bendahara', label: 'Nama bendahara' },
  { kunci: 'ketua_pengawas', label: 'Nama ketua pengawas' },
  { kunci: 'manajer', label: 'Nama manajer' },
];

/**
 * Jenis cetakan yang tanda tangannya dapat diatur. Jenis yang belum diatur
 * memakai pengaturan "default".
 */
export const JENIS_CETAKAN = [
  { kode: 'default', nama: 'Bawaan (dipakai bila jenis cetakan belum diatur)' },
  { kode: 'laporan', nama: 'Laporan (Pusat Laporan)' },
  { kode: 'laporan_keuangan', nama: 'Laporan keuangan (neraca, laba rugi, arus kas, CALK)' },
  { kode: 'jurnal_memorial', nama: 'Bukti jurnal memorial / jurnal umum' },
  { kode: 'bukti_kas_masuk', nama: 'Bukti penerimaan kas (BKM)' },
  { kode: 'bukti_kas_keluar', nama: 'Bukti pengeluaran kas (BKK)' },
  { kode: 'transfer_kas', nama: 'Bukti transfer kas / bank' },
  { kode: 'cash_opname', nama: 'Berita acara cash opname' },
  { kode: 'pesanan_pembelian', nama: 'Bukti pesanan pembelian (PO)' },
  { kode: 'penerimaan_barang', nama: 'Bukti penerimaan barang' },
  { kode: 'pembayaran_hutang', nama: 'Bukti pembayaran utang / penerimaan piutang' },
  { kode: 'faktur_penjualan', nama: 'Faktur / nota penjualan' },
  { kode: 'struk_pos', nama: 'Struk kasir (POS)' },
  { kode: 'retur_penjualan', nama: 'Bukti retur penjualan' },
  { kode: 'stock_opname', nama: 'Berita acara stock opname' },
  { kode: 'penyesuaian_stok', nama: 'Bukti penyesuaian / mutasi stok' },
  { kode: 'setoran_simpanan', nama: 'Bukti setoran simpanan' },
  { kode: 'penarikan_simpanan', nama: 'Bukti penarikan simpanan' },
  { kode: 'buku_tabungan', nama: 'Buku / rekening koran simpanan' },
  { kode: 'pengajuan_pinjaman', nama: 'Formulir pengajuan & analisis pinjaman' },
  { kode: 'pencairan_pinjaman', nama: 'Bukti pencairan pinjaman & jadwal angsuran' },
  { kode: 'angsuran', nama: 'Bukti angsuran / pelunasan anggota' },
  { kode: 'kartu_anggota', nama: 'Kartu anggota' },
  { kode: 'anggota', nama: 'Formulir / data anggota' },
  { kode: 'shu', nama: 'Rincian pembagian SHU' },
  { kode: 'rat', nama: 'Berita acara RAT' },
  { kode: 'anggaran', nama: 'Rencana kerja & anggaran (RKAP)' },
  { kode: 'aset', nama: 'Kartu / pelepasan aset tetap' },
  { kode: 'surat', nama: 'Surat keluar & disposisi' },
];

/**
 * Susunan tanda tangan bawaan. `pengguna: true` berarti nama diisi otomatis
 * dengan pengguna yang mencetak; `sumber` mengambil nama dari profil koperasi.
 */
const TTD_BAWAAN = {
  default: [
    { label: 'Dibuat oleh', jabatan: 'Petugas', pengguna: true },
    { label: 'Diperiksa oleh', jabatan: 'Manajer', sumber: 'manajer' },
    { label: 'Disetujui oleh', jabatan: 'Ketua Pengurus', sumber: 'ketua' },
  ],
  laporan: [
    { label: 'Disiapkan oleh', jabatan: 'Bendahara', sumber: 'bendahara' },
    { label: 'Mengetahui', jabatan: 'Ketua Pengurus', sumber: 'ketua' },
  ],
  laporan_keuangan: [
    { label: 'Disiapkan oleh', jabatan: 'Bendahara', sumber: 'bendahara' },
    { label: 'Diperiksa oleh', jabatan: 'Ketua Pengawas', sumber: 'ketua_pengawas' },
    { label: 'Disahkan oleh', jabatan: 'Ketua Pengurus', sumber: 'ketua' },
  ],
  bukti_kas_masuk: [
    { label: 'Diterima oleh', jabatan: 'Kasir', pengguna: true },
    { label: 'Disetor oleh', jabatan: 'Penyetor' },
    { label: 'Disetujui oleh', jabatan: 'Bendahara', sumber: 'bendahara' },
  ],
  bukti_kas_keluar: [
    { label: 'Dibuat oleh', jabatan: 'Kasir', pengguna: true },
    { label: 'Disetujui oleh', jabatan: 'Bendahara', sumber: 'bendahara' },
    { label: 'Diterima oleh', jabatan: 'Penerima' },
  ],
  setoran_simpanan: [
    { label: 'Penyetor', jabatan: 'Anggota' },
    { label: 'Petugas', jabatan: 'Petugas Simpanan', pengguna: true },
  ],
  penarikan_simpanan: [
    { label: 'Penerima', jabatan: 'Anggota' },
    { label: 'Petugas', jabatan: 'Petugas Simpanan', pengguna: true },
    { label: 'Disetujui oleh', jabatan: 'Bendahara', sumber: 'bendahara' },
  ],
  angsuran: [
    { label: 'Penyetor', jabatan: 'Anggota' },
    { label: 'Petugas', jabatan: 'Petugas Pinjaman', pengguna: true },
  ],
  pencairan_pinjaman: [
    { label: 'Penerima', jabatan: 'Anggota' },
    { label: 'Petugas', jabatan: 'Petugas Pinjaman', pengguna: true },
    { label: 'Disetujui oleh', jabatan: 'Ketua Pengurus', sumber: 'ketua' },
  ],
  pesanan_pembelian: [
    { label: 'Dibuat oleh', jabatan: 'Staf Pembelian', pengguna: true },
    { label: 'Disetujui oleh', jabatan: 'Manajer', sumber: 'manajer' },
    { label: 'Pemasok', jabatan: 'Pemasok' },
  ],
  penerimaan_barang: [
    { label: 'Diterima oleh', jabatan: 'Staf Gudang', pengguna: true },
    { label: 'Diserahkan oleh', jabatan: 'Pemasok / Pengirim' },
    { label: 'Mengetahui', jabatan: 'Manajer', sumber: 'manajer' },
  ],
  struk_pos: [],
  kartu_anggota: [{ label: '', jabatan: 'Ketua Pengurus', sumber: 'ketua' }],
  rat: [
    { label: 'Pimpinan Rapat', jabatan: 'Ketua Pengurus', sumber: 'ketua' },
    { label: 'Notulis', jabatan: 'Sekretaris', sumber: 'sekretaris' },
    { label: 'Mengetahui', jabatan: 'Ketua Pengawas', sumber: 'ketua_pengawas' },
  ],
};

/** Profil koperasi lengkap sebagai objek sederhana. */
export function profilKoperasi() {
  const peta = Object.fromEntries(
    all("SELECT key, value FROM settings WHERE key LIKE 'koperasi.%'").map((r) => [r.key.slice(9), r.value]));
  const profil = {};
  for (const i of ISIAN_PROFIL) profil[i.kunci] = peta[i.kunci] ?? '';
  profil.nama = profil.nama || 'Koperasi Serba Usaha';
  profil.logo = peta.logo || '';
  return profil;
}

/** Status aktivasi aplikasi. */
export function aktivasi() {
  const nomor = setting('aktivasi.nomor', '') || '';
  const berlaku = setting('aktivasi.berlaku_sampai', '') || '';
  const hariIni = new Date().toISOString().slice(0, 10);
  let status = 'belum';
  if (nomor) status = berlaku && berlaku < hariIni ? 'kedaluwarsa' : 'aktif';
  return {
    nomor,
    atas_nama: setting('aktivasi.atas_nama', '') || '',
    tanggal: setting('aktivasi.tanggal', '') || '',
    berlaku_sampai: berlaku,
    status,
  };
}

function bacaJson(teks, cadangan) {
  try { const v = JSON.parse(teks); return v ?? cadangan; } catch { return cadangan; }
}

/** Konfigurasi tanda tangan mentah satu jenis cetakan (tanpa mengisi nama). */
export function konfigTtd(jenis) {
  const simpanan = setting(`ttd.${jenis}`, null);
  if (simpanan !== null) return bacaJson(simpanan, null) || { penanda: [] };
  if (TTD_BAWAAN[jenis]) return { tampil_tanggal: true, penanda: TTD_BAWAAN[jenis] };
  const bawaan = setting('ttd.default', null);
  if (bawaan !== null) return bacaJson(bawaan, null) || { penanda: [] };
  return { tampil_tanggal: true, penanda: TTD_BAWAAN.default };
}

const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September',
  'Oktober', 'November', 'Desember'];

export function tanggalPanjang(iso) {
  const [y, m, d] = String(iso || new Date().toISOString().slice(0, 10)).slice(0, 10).split('-').map(Number);
  return `${d} ${BULAN[m - 1]} ${y}`;
}

/**
 * Blok tanda tangan siap cetak: nama diisi dari pengguna pencetak atau dari
 * profil koperasi sesuai pengaturan.
 * @returns {{kota_tanggal:string|null, penanda:Array<{label,jabatan,nama}>}}
 */
export function tandaTangan(jenis, { pengguna = null, tanggal = null } = {}) {
  const k = konfigTtd(jenis);
  const profil = profilKoperasi();
  const penanda = (k.penanda || []).map((p) => ({
    label: p.label || '',
    jabatan: p.jabatan || '',
    nama: p.nama || (p.pengguna ? (pengguna?.nama || pengguna?.username || '') : '')
      || (p.sumber ? profil[p.sumber] || '' : ''),
  }));
  return {
    kota_tanggal: k.tampil_tanggal === false ? null
      : `${profil.kota || ''}${profil.kota ? ', ' : ''}${tanggalPanjang(tanggal)}`,
    penanda,
  };
}

/** Seluruh data yang dibutuhkan klien untuk mencetak (kop, aktivasi, tanda tangan). */
export function dataCetak(pengguna = null) {
  const ttd = {};
  for (const j of JENIS_CETAKAN) ttd[j.kode] = tandaTangan(j.kode, { pengguna });
  return { profil: profilKoperasi(), aktivasi: aktivasi(), ttd, jenis: JENIS_CETAKAN };
}

/** Pengaturan tanda tangan seluruh jenis cetakan untuk halaman pengaturan. */
export function daftarKonfigTtd() {
  return JENIS_CETAKAN.map((j) => ({ ...j, ...konfigTtd(j.kode),
    diatur: get('SELECT 1 FROM settings WHERE key = ?', [`ttd.${j.kode}`]) ? 1 : 0 }));
}
