/**
 * Autentikasi: kata sandi (PBKDF2-SHA512), sesi berbasis cookie HttpOnly,
 * dan MFA TOTP (RFC 6238) - seluruhnya memakai node:crypto.
 */
import crypto from 'node:crypto';
import { get, run, all } from '../db.js';
import { AppError, unauthorized } from './http.js';

const PBKDF2_ITER = 210_000;
const SESSION_HOURS = 12;
export const COOKIE_NAME = 'ecms_sid';

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, PBKDF2_ITER, 64, 'sha512').toString('hex');
  return { hash, salt };
}

export function verifyPassword(password, hash, salt) {
  const calc = crypto.pbkdf2Sync(password, salt, PBKDF2_ITER, 64, 'sha512').toString('hex');
  const a = Buffer.from(calc, 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Kebijakan kata sandi minimal (GCG / keamanan informasi). */
export function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) {
    throw new AppError(400, 'Kata sandi minimal 8 karakter');
  }
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) {
    throw new AppError(400, 'Kata sandi harus mengandung huruf dan angka');
  }
}

export function createSession(userId, ip, userAgent) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_HOURS * 3600_000).toISOString();
  run(
    'INSERT INTO sessions(token, user_id, ip, user_agent, expires_at) VALUES(?,?,?,?,?)',
    [token, userId, ip || null, (userAgent || '').slice(0, 250), expires],
  );
  return { token, expires };
}

export function destroySession(token) {
  if (token) run('DELETE FROM sessions WHERE token = ?', [token]);
}

export function purgeExpiredSessions() {
  run("DELETE FROM sessions WHERE expires_at < datetime('now')");
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function sessionCookie(token, expires) {
  const attrs = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Expires=${new Date(expires).toUTCString()}`,
  ];
  if (process.env.ECMS_SECURE_COOKIE === '1') attrs.push('Secure');
  return attrs.join('; ');
}

export function clearCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

/** Mengembalikan user dari token sesi, atau melempar 401. */
export function requireUser(token) {
  if (!token) throw unauthorized();
  const row = get(
    `SELECT u.*, s.token, s.expires_at, c.nama AS cabang_nama, uu.nama AS unit_nama
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN cabang c ON c.id = u.cabang_id
       LEFT JOIN unit_usaha uu ON uu.id = u.unit_usaha_id
      WHERE s.token = ? AND s.expires_at > datetime('now')`,
    [token],
  );
  if (!row) throw unauthorized();
  if (row.status !== 'aktif') throw new AppError(403, 'Akun Anda tidak aktif. Hubungi administrator.');
  delete row.password_hash;
  delete row.password_salt;
  delete row.mfa_secret;
  return row;
}

// ------------------------- MFA (TOTP RFC 6238) -------------------------

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateTotpSecret(length = 20) {
  const buf = crypto.randomBytes(length);
  let bits = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

function base32Decode(secret) {
  const clean = secret.replace(/=+$/, '').toUpperCase().replace(/\s/g, '');
  let bits = '';
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new AppError(400, 'Kunci MFA tidak valid');
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function totpCode(secret, counter) {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16)
    | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(code % 1_000_000).padStart(6, '0');
}

/** Verifikasi kode TOTP dengan toleransi +/- 1 slot (30 detik). */
export function verifyTotp(secret, code, now = Date.now()) {
  if (!secret || !/^\d{6}$/.test(String(code || ''))) return false;
  const counter = Math.floor(now / 30_000);
  for (let d = -1; d <= 1; d++) {
    if (totpCode(secret, counter + d) === String(code)) return true;
  }
  return false;
}

export function otpauthUrl(secret, username, issuer = 'ECMS Koperasi') {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(username)}`
    + `?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

/** Daftar sesi aktif (untuk panel administrator). */
export function activeSessions() {
  return all(
    `SELECT s.token, s.ip, s.created_at, s.expires_at, u.username, u.nama, u.role
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.expires_at > datetime('now') ORDER BY s.created_at DESC`,
  ).map((s) => ({ ...s, token: `${s.token.slice(0, 8)}…` }));
}
