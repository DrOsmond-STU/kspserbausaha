/**
 * Modul 15 - Transaksi unit usaha: pendapatan & biaya per segmen.
 *
 * Unit toko dan simpan pinjam sudah mendapat pendapatan dari transaksinya
 * sendiri (POS, penjualan, angsuran). Unit lain - jasa, pertanian,
 * transportasi, dan sebagainya - mencatat pendapatan dan biayanya di sini.
 *
 * Setiap transaksi adalah bukti kas masuk/keluar biasa yang ditandai unit
 * usaha, sehingga ia ikut buku kas, buku besar, laba rugi konsolidasi, laporan
 * kinerja per unit, dan dapat diubah/dibatalkan lewat jalur koreksi kas.
 * Akun pendapatan/biaya dipilih dari bagan akun (bawaannya diatur per unit
 * pada Master Data), tidak ada kode akun yang ditanam.
 */
import { all, get } from '../db.js';
import { badRequest, notFound, conflict } from '../lib/http.js';
import { buatBuktiKas, batalBuktiKas, ubahBuktiKas } from './kas.js';

/** Jenis transaksi unit → jenis bukti kas & tipe akun lawan yang sah. */
export const JENIS_TRANSAKSI_UNIT = {
  pendapatan: { bukti: 'kas_masuk', tipeAkun: 'pendapatan', label: 'Pendapatan', kolomBawaan: 'coa_pendapatan' },
  biaya: { bukti: 'kas_keluar', tipeAkun: 'beban', label: 'Biaya', kolomBawaan: 'coa_beban' },
};

const jenisDariBukti = (bukti) => (bukti === 'kas_masuk' ? 'pendapatan' : 'biaya');

function unitAktif(id) {
  const u = get('SELECT * FROM unit_usaha WHERE id = ?', [Number(id) || 0]);
  if (!u) throw badRequest('Unit usaha wajib dipilih');
  if (u.status !== 'aktif') throw badRequest(`Unit usaha ${u.nama} tidak aktif`);
  return u;
}

/** Akun pendapatan/beban yang dapat dijurnal; bila kosong memakai bawaan unit. */
function akunTransaksi(kode, unit, jenis) {
  const j = JENIS_TRANSAKSI_UNIT[jenis];
  const dipakai = kode || unit[j.kolomBawaan];
  if (!dipakai) {
    throw badRequest(`Akun ${j.label.toLowerCase()} wajib dipilih`,
      `Pilih akun pada formulir, atau atur akun ${j.label.toLowerCase()} bawaan unit ${unit.nama} di Master Data → Unit Usaha.`);
  }
  const a = get('SELECT kode, nama, tipe, is_postable, status FROM coa WHERE kode = ?', [dipakai]);
  if (!a) throw badRequest(`Akun ${dipakai} tidak terdaftar dalam bagan akun`);
  if (!a.is_postable) throw badRequest(`Akun ${a.kode} - ${a.nama} adalah akun induk`);
  if (a.status !== 'aktif') throw badRequest(`Akun ${a.kode} - ${a.nama} tidak aktif`);
  if (a.tipe !== j.tipeAkun) {
    throw badRequest(`Akun ${a.kode} - ${a.nama} bertipe ${a.tipe}; transaksi ${j.label.toLowerCase()} `
      + `memerlukan akun bertipe ${j.tipeAkun}`);
  }
  return a.kode;
}

/** Mencatat pendapatan / biaya unit usaha sebagai bukti kas bertanda unit. */
export function catatTransaksiUnit(d, ctx) {
  const jenis = d.jenis;
  if (!JENIS_TRANSAKSI_UNIT[jenis]) throw badRequest('Jenis transaksi harus pendapatan atau biaya');
  const unit = unitAktif(d.unit_usaha_id);
  const coaLawan = akunTransaksi(d.coa_akun, unit, jenis);
  const keterangan = String(d.keterangan || '').trim()
    || `${JENIS_TRANSAKSI_UNIT[jenis].label} ${unit.nama}`;
  const h = buatBuktiKas({
    jenis: JENIS_TRANSAKSI_UNIT[jenis].bukti, coa_kas: d.coa_kas, coa_lawan: coaLawan,
    nominal: d.nominal, tanggal: d.tanggal, keterangan, pihak: d.pihak,
    cabang_id: unit.cabang_id || null, unit_usaha_id: unit.id,
  }, ctx);
  return { ...h, jenis, unit: { id: unit.id, kode: unit.kode, nama: unit.nama } };
}

const SELECT_TRANSAKSI = `
  SELECT k.*, u.kode AS unit_kode, u.nama AS unit_nama, cl.nama AS akun_lawan_nama, cl.tipe AS akun_lawan_tipe,
         ck.nama AS akun_kas_nama, j.nomor AS jurnal_nomor
    FROM kas_bank k JOIN unit_usaha u ON u.id = k.unit_usaha_id
    LEFT JOIN coa cl ON cl.kode = k.coa_lawan LEFT JOIN coa ck ON ck.kode = k.coa_kas
    LEFT JOIN jurnal j ON j.id = k.jurnal_id`;

/** Daftar transaksi unit (bukti kas bertanda unit) beserta ringkasannya. */
export function daftarTransaksiUnit(f = {}) {
  const w = ["k.jenis IN ('kas_masuk', 'kas_keluar', 'petty_cash')"];
  const p = [];
  if (f.unit_usaha_id) { w.push('k.unit_usaha_id = ?'); p.push(Number(f.unit_usaha_id)); }
  if (f.dari) { w.push('k.tanggal >= ?'); p.push(f.dari); }
  if (f.sampai) { w.push('k.tanggal <= ?'); p.push(f.sampai); }
  if (f.jenis && JENIS_TRANSAKSI_UNIT[f.jenis]) { w.push('k.jenis = ?'); p.push(JENIS_TRANSAKSI_UNIT[f.jenis].bukti); }
  if (f.q) {
    w.push('(k.nomor LIKE ? OR k.keterangan LIKE ? OR k.pihak LIKE ?)');
    p.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`);
  }
  const limit = Math.min(Number(f.limit) || 200, 1000);
  const offset = Math.max(Number(f.offset) || 0, 0);
  const data = all(`${SELECT_TRANSAKSI} WHERE ${w.join(' AND ')} ORDER BY k.tanggal DESC, k.id DESC LIMIT ? OFFSET ?`,
    [...p, limit, offset]).map((r) => ({ ...r, jenis_unit: jenisDariBukti(r.jenis) }));
  // Ringkasan atas seluruh transaksi yang cocok dengan saringan, bukan hanya halaman ini.
  const r = get(`SELECT COUNT(*) AS total,
       COALESCE(SUM(CASE WHEN k.status <> 'batal' AND k.jenis = 'kas_masuk' THEN k.nominal END), 0) AS pendapatan,
       COALESCE(SUM(CASE WHEN k.status <> 'batal' AND k.jenis <> 'kas_masuk' THEN k.nominal END), 0) AS biaya,
       COALESCE(SUM(CASE WHEN k.status <> 'batal' THEN 1 END), 0) AS berlaku
     FROM kas_bank k JOIN unit_usaha u ON u.id = k.unit_usaha_id WHERE ${w.join(' AND ')}`, p);
  return {
    data, total: r.total, limit, offset,
    ringkasan: { pendapatan: r.pendapatan, biaya: r.biaya, selisih: r.pendapatan - r.biaya, jumlah: r.berlaku },
  };
}

/** Satu transaksi unit (untuk dicetak / diubah). */
export function transaksiUnit(id) {
  const k = get(`${SELECT_TRANSAKSI} WHERE k.id = ?`, [id]);
  if (!k || !['kas_masuk', 'kas_keluar', 'petty_cash'].includes(k.jenis)) {
    throw notFound('Transaksi unit usaha tidak ditemukan');
  }
  return { ...k, jenis_unit: jenisDariBukti(k.jenis) };
}

/**
 * Mengubah transaksi unit: bukti lama dibatalkan (jurnal dibalik) dan bukti
 * pengganti bernomor baru dibuat, sama seperti koreksi bukti kas.
 */
export function ubahTransaksiUnit(id, d, alasan, ctx) {
  const lama = transaksiUnit(id);
  if (lama.status === 'batal') throw conflict('Transaksi ini sudah dibatalkan');
  const jenis = lama.jenis_unit;
  const unit = unitAktif(d.unit_usaha_id ?? lama.unit_usaha_id);
  const data = {
    unit_usaha_id: unit.id, cabang_id: unit.cabang_id || null,
    coa_lawan: akunTransaksi(d.coa_akun ?? lama.coa_lawan, unit, jenis),
  };
  for (const k of ['coa_kas', 'nominal', 'tanggal', 'pihak']) if (d[k] !== undefined) data[k] = d[k];
  if (d.keterangan !== undefined) data.keterangan = String(d.keterangan || '').trim() || lama.keterangan;
  return ubahBuktiKas(id, data, alasan, ctx);
}

/** Membatalkan transaksi unit: bukti tetap tersimpan berstatus batal, jurnalnya dibalik. */
export function batalTransaksiUnit(id, alasan, ctx) {
  transaksiUnit(id);
  return batalBuktiKas(id, alasan, ctx);
}
