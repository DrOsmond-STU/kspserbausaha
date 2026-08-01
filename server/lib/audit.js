/**
 * Audit trail berantai (hash chain) - UU ITE No. 11/2008 jo. UU No. 19/2016.
 *
 * Setiap baris audit menyimpan sha256(hash_sebelumnya + payload) sehingga
 * penghapusan / perubahan baris di tengah rantai dapat terdeteksi.
 */
import crypto from 'node:crypto';
import { get, run, all, scalar } from '../db.js';

function lastHash() {
  const row = get('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1');
  return row ? row.hash || '' : '';
}

/**
 * Mencatat aktivitas.
 * @param {object} ctx  { user, ip } - boleh null untuk aksi sistem
 */
export function logAudit(ctx, { aksi, modul, entitas_id = null, keterangan = null, before = null, after = null }) {
  const waktu = new Date().toISOString();
  const username = ctx?.user?.username || 'sistem';
  const userId = ctx?.user?.id || null;
  const b = before ? JSON.stringify(before) : null;
  const a = after ? JSON.stringify(after) : null;
  const payload = [waktu, username, aksi, modul, entitas_id, keterangan, b, a].join('|');
  const hash = crypto.createHash('sha256').update(lastHash() + payload).digest('hex');
  run(
    `INSERT INTO audit_log(waktu, user_id, username, aksi, modul, entitas_id, keterangan,
                           data_before, data_after, ip, hash)
     VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    [waktu, userId, username, aksi, modul, entitas_id == null ? null : String(entitas_id),
      keterangan, b, a, ctx?.ip || null, hash],
  );
  return hash;
}

/** Memverifikasi integritas seluruh rantai audit. */
export function verifyChain() {
  const rows = all('SELECT * FROM audit_log ORDER BY id ASC');
  let prev = '';
  for (const r of rows) {
    const payload = [r.waktu, r.username, r.aksi, r.modul, r.entitas_id, r.keterangan,
      r.data_before, r.data_after].join('|');
    const expect = crypto.createHash('sha256').update(prev + payload).digest('hex');
    if (expect !== r.hash) {
      return { valid: false, rusak_pada_id: r.id, waktu: r.waktu, total: rows.length };
    }
    prev = r.hash;
  }
  return { valid: true, total: rows.length };
}

/** Membuat notifikasi untuk user tertentu atau seluruh pemegang role. */
export function notify({ user_id = null, role = null, judul, pesan = null, tipe = 'info', link = null }) {
  run(
    'INSERT INTO notifications(user_id, role, judul, pesan, tipe, link) VALUES(?,?,?,?,?,?)',
    [user_id, role, judul, pesan, tipe, link],
  );
}

export function unreadCount(user) {
  return scalar(
    'SELECT COUNT(*) FROM notifications WHERE dibaca = 0 AND (user_id = ? OR role = ?)',
    [user.id, user.role],
  );
}
