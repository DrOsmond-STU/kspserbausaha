/**
 * Lapisan akses database (SQLite via node:sqlite - tanpa dependensi eksternal).
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.ECMS_DATA_DIR || join(__dirname, '..', 'data');
export const DB_PATH = process.env.ECMS_DB || join(DATA_DIR, 'ecms.db');

mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

/**
 * Kolom yang ditambahkan sesudah skema awal dirilis.
 *
 * schema.sql memakai CREATE TABLE IF NOT EXISTS, sehingga kolom baru tidak
 * pernah sampai ke basis data yang sudah terlanjur dibuat di server produksi.
 * Daftar ini menutup celah tersebut tanpa perlu memuat ulang data.
 */
const KOLOM_SUSULAN = [
  ['users', 'terkunci_sampai', 'TEXT'],
  // Asal jurnal: 'manual' (jurnal umum), 'recurring', atau 'sistem' (dibuat
  // otomatis oleh modul). Jurnal sistem hanya boleh dibatalkan lewat dokumen
  // sumbernya agar buku pembantu (simpanan, kas, stok) tetap sejalan.
  ['jurnal', 'sumber', 'TEXT'],
  ['kas_bank', 'status', "TEXT NOT NULL DEFAULT 'posted'"],
  ['kas_bank', 'alasan_batal', 'TEXT'],
  ['transaksi_simpanan', 'status', "TEXT NOT NULL DEFAULT 'posted'"],
  ['pembelian', 'alasan_batal', 'TEXT'],
  ['anggaran', 'catatan_revisi', 'TEXT'],
];

/** Menjalankan skema (idempoten - seluruh DDL memakai IF NOT EXISTS). */
export function migrate() {
  db.exec(readFileSync(join(__dirname, 'schema.sql'), 'utf8'));
  for (const [tabel, kolom, tipe] of KOLOM_SUSULAN) {
    const ada = db.prepare(`PRAGMA table_info(${tabel})`).all().some((k) => k.name === kolom);
    if (!ada) db.exec(`ALTER TABLE ${tabel} ADD COLUMN ${kolom} ${tipe}`);
  }
}

const plain = (row) => (row ? { ...row } : row);

/** SELECT banyak baris. */
export function all(sql, params = []) {
  return db.prepare(sql).all(...params).map(plain);
}

/** SELECT satu baris (atau undefined). */
export function get(sql, params = []) {
  return plain(db.prepare(sql).get(...params));
}

/** INSERT/UPDATE/DELETE. Mengembalikan { changes, lastInsertRowid }. */
export function run(sql, params = []) {
  const r = db.prepare(sql).run(...params);
  return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
}

/** Nilai skalar kolom pertama baris pertama. */
export function scalar(sql, params = [], fallback = 0) {
  const row = db.prepare(sql).get(...params);
  if (!row) return fallback;
  const v = Object.values(row)[0];
  return v === null || v === undefined ? fallback : v;
}

let txDepth = 0;

/**
 * Menjalankan fn dalam transaksi (mendukung nested via SAVEPOINT).
 * Seluruh mutasi multi-tabel WAJIB dibungkus di sini agar atomik.
 */
export function tx(fn) {
  const depth = txDepth++;
  const sp = `sp_${depth}`;
  db.exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
  try {
    const result = fn();
    db.exec(depth === 0 ? 'COMMIT' : `RELEASE ${sp}`);
    return result;
  } catch (err) {
    try {
      db.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}`);
      if (depth > 0) db.exec(`RELEASE ${sp}`);
    } catch { /* rollback gagal - biarkan error asli yang naik */ }
    throw err;
  } finally {
    txDepth = depth;
  }
}

/**
 * Membangkitkan nomor dokumen berurut, contoh: KWT/2026/08/00001
 * Aman dari race karena seluruh proses berjalan dalam satu transaksi SQLite.
 */
export function nextNumber(prefix, tanggal = new Date().toISOString().slice(0, 10)) {
  const [th, bl] = tanggal.split('-');
  const scope = `${prefix}-${th}-${bl}`;
  run(
    `INSERT INTO sequences(scope, last_number) VALUES(?, 1)
     ON CONFLICT(scope) DO UPDATE SET last_number = last_number + 1`,
    [scope],
  );
  const n = scalar('SELECT last_number FROM sequences WHERE scope = ?', [scope]);
  return `${prefix}/${th}/${bl}/${String(n).padStart(5, '0')}`;
}

/** Nilai pengaturan (settings) dengan fallback. */
export function setting(key, fallback = null) {
  const row = get('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? row.value : fallback;
}

export function settingNum(key, fallback = 0) {
  const v = setting(key, null);
  return v === null ? fallback : Number(v);
}

export function setSetting(key, value, keterangan = null) {
  run(
    `INSERT INTO settings(key, value, keterangan, updated_at) VALUES(?,?,?,datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [key, String(value), keterangan],
  );
}
