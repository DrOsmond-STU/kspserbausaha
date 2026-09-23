/**
 * Registri Pusat Laporan: seluruh definisi laporan dari setiap kelompok.
 */
import keanggotaan from './keanggotaan.js';
import keuangan from './keuangan.js';
import usaha from './usaha.js';
import organisasi from './organisasi.js';

export const KELOMPOK = [
  { kode: 'keanggotaan', nama: 'Keanggotaan, Simpanan, Pinjaman & SHU' },
  { kode: 'keuangan', nama: 'Keuangan & Akuntansi' },
  { kode: 'usaha', nama: 'Usaha, Persediaan & Perdagangan' },
  { kode: 'organisasi', nama: 'Organisasi, Tata Kelola & Master Data' },
];

export const LAPORAN = [
  ...keanggotaan.map((l) => ({ kelompok: 'keanggotaan', ...l })),
  ...keuangan.map((l) => ({ kelompok: 'keuangan', ...l })),
  ...usaha.map((l) => ({ kelompok: 'usaha', ...l })),
  ...organisasi.map((l) => ({ kelompok: 'organisasi', ...l })),
];

const kodeGanda = LAPORAN.map((l) => l.kode).filter((k, i, a) => a.indexOf(k) !== i);
if (kodeGanda.length) throw new Error(`Kode laporan ganda: ${kodeGanda.join(', ')}`);
