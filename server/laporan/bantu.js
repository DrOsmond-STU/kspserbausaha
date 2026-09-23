/**
 * Alat bantu penyusunan definisi laporan Pusat Laporan.
 *
 * Definisi laporan:
 *   {
 *     kode, judul, kelompok, izin, orientasi?, jenis_ttd?, deskripsi?,
 *     filter: [{ kunci, label, tipe: 'tanggal'|'teks'|'angka'|'pilih'|'bulan', opsi?, wajib?, bawaan? }],
 *     susun(f, ctx) → { subjudul?, keterangan?, ringkasan?, bagian: [{ judul?, kolom, baris, total? }], catatan? }
 *   }
 * `f` berisi nilai filter yang sudah dibersihkan (string kosong → undefined).
 */
import { all } from '../db.js';
import { tanggalPanjang } from '../lib/profil.js';

/** Filter rentang dua tanggal (dari–sampai). */
export const periode = ({ wajib = false, label = 'Tanggal' } = {}) => [
  { kunci: 'dari', label: `${label} dari`, tipe: 'tanggal', wajib },
  { kunci: 'sampai', label: `${label} sampai`, tipe: 'tanggal', wajib },
];

/** Filter rentang data (mis. nomor anggota dari–sampai, kode akun dari–sampai). */
export const rentang = (kunci, label, tipe = 'teks') => [
  { kunci: `${kunci}_dari`, label: `${label} dari`, tipe },
  { kunci: `${kunci}_sampai`, label: `${label} sampai`, tipe },
];

/** Filter pilihan tunggal. `opsi` boleh array nilai, [{nilai, teks}], atau fungsi yang mengembalikannya. */
export const pilih = (kunci, label, opsi) => ({ kunci, label, tipe: 'pilih', opsi });

/** Opsi cabang & unit usaha dari basis data (dipakai sebagai fungsi agar selalu terbaru). */
export const opsiCabang = () => all('SELECT id AS nilai, nama AS teks FROM cabang ORDER BY kode');
export const opsiUnit = () => all('SELECT id AS nilai, nama AS teks FROM unit_usaha ORDER BY kode');

/**
 * Penyusun klausa WHERE untuk filter umum.
 *   const w = kondisi();
 *   w.periode('t.tanggal', f); w.rentang('a.nomor_anggota', f, 'nomor'); w.sama('t.status', f.status);
 *   all(`SELECT ... ${w.where()}`, w.params)
 */
export function kondisi() {
  const klausa = [];
  const params = [];
  const api = {
    params,
    tambah(sql, ...p) { klausa.push(sql); params.push(...p); return api; },
    sama(kolom, nilai) {
      if (nilai !== undefined && nilai !== null && nilai !== '') { klausa.push(`${kolom} = ?`); params.push(nilai); }
      return api;
    },
    periode(kolom, f) {
      if (f.dari) { klausa.push(`substr(${kolom},1,10) >= ?`); params.push(f.dari); }
      if (f.sampai) { klausa.push(`substr(${kolom},1,10) <= ?`); params.push(f.sampai); }
      return api;
    },
    rentang(kolom, f, kunci) {
      if (f[`${kunci}_dari`] !== undefined) { klausa.push(`${kolom} >= ?`); params.push(f[`${kunci}_dari`]); }
      if (f[`${kunci}_sampai`] !== undefined) { klausa.push(`${kolom} <= ?`); params.push(f[`${kunci}_sampai`]); }
      return api;
    },
    cari(kolomList, q) {
      if (q) { klausa.push(`(${kolomList.map((k) => `${k} LIKE ?`).join(' OR ')})`); params.push(...kolomList.map(() => `%${q}%`)); }
      return api;
    },
    where: () => (klausa.length ? `WHERE ${klausa.join(' AND ')}` : ''),
    and: () => (klausa.length ? `AND ${klausa.join(' AND ')}` : ''),
  };
  return api;
}

/** Teks periode untuk subjudul. */
export function teksPeriode(f, awalan = 'Periode') {
  if (f.dari && f.sampai) return `${awalan} ${tanggalPanjang(f.dari)} s.d. ${tanggalPanjang(f.sampai)}`;
  if (f.dari) return `${awalan} sejak ${tanggalPanjang(f.dari)}`;
  if (f.sampai) return `${awalan} s.d. ${tanggalPanjang(f.sampai)}`;
  return 'Seluruh periode';
}

/** Menjumlahkan kolom-kolom tertentu dari baris. */
export function jumlahkan(baris, kunci, label = 'TOTAL') {
  const t = { _label: label };
  for (const k of kunci) t[k] = baris.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  return t;
}

/** Menambahkan nomor urut (kolom "no") pada baris. */
export const bernomor = (baris) => baris.map((r, i) => ({ no: i + 1, ...r }));
export const KOLOM_NO = { kunci: 'no', label: 'No', tipe: 'angka' };
