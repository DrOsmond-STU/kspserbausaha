/**
 * Utilitas umum: validasi input, tanggal, dan pembulatan uang.
 */
import { badRequest } from './http.js';

// ------------------------------- Validasi -------------------------------

export function str(body, field, { required = true, max = 255, min = 0, label } = {}) {
  const v = body?.[field];
  const name = label || field;
  if (v === undefined || v === null || String(v).trim() === '') {
    if (required) throw badRequest(`Kolom "${name}" wajib diisi`);
    return null;
  }
  const s = String(v).trim();
  if (s.length > max) throw badRequest(`Kolom "${name}" maksimal ${max} karakter`);
  if (s.length < min) throw badRequest(`Kolom "${name}" minimal ${min} karakter`);
  return s;
}

export function num(body, field, { required = true, min = null, max = null, label, integer = true } = {}) {
  const v = body?.[field];
  const name = label || field;
  if (v === undefined || v === null || v === '') {
    if (required) throw badRequest(`Kolom "${name}" wajib diisi`);
    return 0;
  }
  const n = Number(v);
  if (!Number.isFinite(n)) throw badRequest(`Kolom "${name}" harus berupa angka`);
  if (min !== null && n < min) throw badRequest(`Kolom "${name}" minimal ${min}`);
  if (max !== null && n > max) throw badRequest(`Kolom "${name}" maksimal ${max}`);
  return integer ? Math.round(n) : n;
}

export function int(body, field, opts = {}) {
  return num(body, field, { ...opts, integer: true });
}

export function bool(body, field, dflt = false) {
  const v = body?.[field];
  if (v === undefined || v === null || v === '') return dflt ? 1 : 0;
  return (v === true || v === 1 || v === '1' || v === 'true' || v === 'ya') ? 1 : 0;
}

export function oneOf(body, field, allowed, { required = true, dflt = null, label } = {}) {
  const v = body?.[field];
  const name = label || field;
  if (v === undefined || v === null || v === '') {
    if (required && dflt === null) throw badRequest(`Kolom "${name}" wajib diisi`);
    return dflt;
  }
  const s = String(v).trim();
  if (!allowed.includes(s)) {
    throw badRequest(`Nilai "${name}" tidak valid`, `Pilihan yang tersedia: ${allowed.join(', ')}`);
  }
  return s;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function date(body, field, { required = true, dflt = null, label } = {}) {
  const v = body?.[field];
  const name = label || field;
  if (v === undefined || v === null || v === '') {
    if (required) return dflt ?? today();
    return dflt;
  }
  const s = String(v).slice(0, 10);
  if (!DATE_RE.test(s) || Number.isNaN(Date.parse(s))) {
    throw badRequest(`Kolom "${name}" harus berformat tanggal YYYY-MM-DD`);
  }
  return s;
}

export function idParam(params, key = 'id') {
  const n = Number(params[key]);
  if (!Number.isInteger(n) || n <= 0) throw badRequest('ID tidak valid');
  return n;
}

/** Membaca daftar baris (detail transaksi) dan memastikan tidak kosong. */
export function rows(body, field, { min = 1, label } = {}) {
  const v = body?.[field];
  if (!Array.isArray(v) || v.length < min) {
    throw badRequest(`${label || field} minimal berisi ${min} baris`);
  }
  return v;
}

// ------------------------------- Tanggal -------------------------------

export const today = () => new Date().toISOString().slice(0, 10);

export const nowIso = () => new Date().toISOString();

/** Menambah n bulan pada tanggal, dengan penyesuaian akhir bulan. */
export function addMonths(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

export function addDays(dateStr, n) {
  const t = new Date(`${dateStr}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** Selisih hari (a - b). */
export function diffDays(a, b) {
  return Math.floor((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}

export const periodOf = (dateStr) => dateStr.slice(0, 7);          // YYYY-MM
export const yearOf = (dateStr) => Number(dateStr.slice(0, 4));
export const monthOf = (dateStr) => Number(dateStr.slice(5, 7));

/** Tanggal akhir bulan dari sebuah periode YYYY-MM. */
export function endOfMonth(period) {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export function startOfMonth(period) {
  return `${period}-01`;
}

// -------------------------------- Uang ---------------------------------

/** Pembulatan ke rupiah penuh (setengah ke atas). */
export const rupiah = (n) => Math.round(Number(n) || 0);

export function formatRupiah(n) {
  return `Rp ${new Intl.NumberFormat('id-ID').format(Math.round(Number(n) || 0))}`;
}

/** Membagi total ke n bagian secara merata; sisa pembulatan masuk ke bagian pertama. */
export function splitEvenly(total, n) {
  const base = Math.floor(total / n);
  const out = Array(n).fill(base);
  out[0] += total - base * n;
  return out;
}

/** Terbilang (untuk kuitansi & berita acara). */
export function terbilang(n) {
  const angka = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];
  const konversi = (x) => {
    x = Math.floor(Math.abs(x));
    if (x < 12) return angka[x];
    if (x < 20) return `${konversi(x - 10)} belas`;
    if (x < 100) return `${konversi(Math.floor(x / 10))} puluh ${konversi(x % 10)}`;
    if (x < 200) return `seratus ${konversi(x - 100)}`;
    if (x < 1000) return `${konversi(Math.floor(x / 100))} ratus ${konversi(x % 100)}`;
    if (x < 2000) return `seribu ${konversi(x - 1000)}`;
    if (x < 1_000_000) return `${konversi(Math.floor(x / 1000))} ribu ${konversi(x % 1000)}`;
    if (x < 1_000_000_000) return `${konversi(Math.floor(x / 1_000_000))} juta ${konversi(x % 1_000_000)}`;
    return `${konversi(Math.floor(x / 1_000_000_000))} miliar ${konversi(x % 1_000_000_000)}`;
  };
  const hasil = konversi(n).replace(/\s+/g, ' ').trim();
  return hasil ? `${hasil} rupiah` : 'nol rupiah';
}
