/**
 * Rute autentikasi & profil pengguna.
 */
import { createRouter, badRequest, unauthorized, AppError } from '../lib/http.js';
import { all, get, run, scalar } from '../db.js';
import {
  hashPassword, verifyPassword, validatePassword, createSession, destroySession,
  generateTotpSecret, verifyTotp, otpauthUrl,
} from '../lib/auth.js';
import { logAudit, unreadCount } from '../lib/audit.js';
import { ROLES, visibleModules, roleInfo } from '../lib/rbac.js';

const router = createRouter();
const MAKS_GAGAL = 5;

router.post('/api/auth/login', null, async ({ body, req, res, setCookie }) => {
  const username = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!username || !password) throw badRequest('Nama pengguna dan kata sandi wajib diisi');

  const user = get('SELECT * FROM users WHERE lower(username) = ?', [username]);
  const gagal = () => {
    logAudit({ ip: req.socket.remoteAddress }, { aksi: 'login', modul: 'admin',
      keterangan: `Percobaan masuk GAGAL untuk "${username}"` });
    throw new AppError(401, 'Nama pengguna atau kata sandi salah');
  };
  if (!user) gagal();
  if (user.status !== 'aktif') {
    throw new AppError(403, 'Akun Anda tidak aktif. Silakan hubungi administrator koperasi.');
  }
  if (user.gagal_login >= MAKS_GAGAL) {
    throw new AppError(423, 'Akun terkunci setelah 5 kali gagal masuk',
      'Hubungi Super Administrator untuk membuka kembali akun Anda.');
  }
  if (!verifyPassword(password, user.password_hash, user.password_salt)) {
    run('UPDATE users SET gagal_login = gagal_login + 1 WHERE id = ?', [user.id]);
    gagal();
  }
  if (user.mfa_enabled) {
    if (!body.kode_mfa) {
      return { perlu_mfa: true, pesan: 'Masukkan kode 6 digit dari aplikasi autentikator Anda' };
    }
    if (!verifyTotp(user.mfa_secret, body.kode_mfa)) {
      logAudit({ ip: req.socket.remoteAddress }, { aksi: 'login', modul: 'admin',
        keterangan: `Kode MFA salah untuk "${username}"` });
      throw new AppError(401, 'Kode MFA tidak valid atau sudah kedaluwarsa');
    }
  }

  run("UPDATE users SET gagal_login = 0, last_login_at = datetime('now') WHERE id = ?", [user.id]);
  const sesi = createSession(user.id, req.socket.remoteAddress, req.headers['user-agent']);
  setCookie(sesi.token, sesi.expires);
  logAudit({ user, ip: req.socket.remoteAddress }, { aksi: 'login', modul: 'admin', entitas_id: user.id,
    keterangan: `${user.nama} (${user.role}) berhasil masuk` });
  return { berhasil: true, user: profil(user.id) };
});

router.post('/api/auth/logout', null, ({ ctx, token, clear }) => {
  if (ctx?.user) {
    logAudit(ctx, { aksi: 'logout', modul: 'admin', entitas_id: ctx.user.id,
      keterangan: `${ctx.user.nama} keluar dari sistem` });
  }
  destroySession(token);
  clear();
  return { berhasil: true };
});

function profil(userId) {
  const u = get(
    `SELECT u.id, u.username, u.nama, u.email, u.role, u.cabang_id, u.unit_usaha_id, u.anggota_id,
            u.mfa_enabled, u.last_login_at, c.nama AS cabang_nama, uu.nama AS unit_nama,
            a.nomor_anggota, a.nama AS anggota_nama
       FROM users u
       LEFT JOIN cabang c ON c.id = u.cabang_id
       LEFT JOIN unit_usaha uu ON uu.id = u.unit_usaha_id
       LEFT JOIN anggota a ON a.id = u.anggota_id
      WHERE u.id = ?`, [userId]);
  if (!u) throw unauthorized();
  return {
    ...u,
    role_info: roleInfo(u.role),
    izin: ROLES[u.role]?.permissions || [],
    modul: visibleModules(u.role),
    notifikasi_belum_dibaca: unreadCount(u),
  };
}

router.get('/api/auth/saya', null, ({ ctx }) => {
  if (!ctx?.user) throw unauthorized();
  return profil(ctx.user.id);
});

router.post('/api/auth/ganti-sandi', null, ({ body, ctx }) => {
  if (!ctx?.user) throw unauthorized();
  const user = get('SELECT * FROM users WHERE id = ?', [ctx.user.id]);
  if (!verifyPassword(String(body.sandi_lama || ''), user.password_hash, user.password_salt)) {
    throw badRequest('Kata sandi lama tidak sesuai');
  }
  const baru = String(body.sandi_baru || '');
  validatePassword(baru);
  if (baru === String(body.sandi_lama)) throw badRequest('Kata sandi baru harus berbeda dari yang lama');
  const { hash, salt } = hashPassword(baru);
  run('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?', [hash, salt, user.id]);
  run('DELETE FROM sessions WHERE user_id = ? AND token <> ?', [user.id, ctx.token]);
  logAudit(ctx, { aksi: 'update', modul: 'admin', entitas_id: user.id,
    keterangan: `${user.nama} mengubah kata sandi` });
  return { berhasil: true, pesan: 'Kata sandi berhasil diubah. Sesi lain telah dikeluarkan.' };
});

// ------------------------------- MFA -------------------------------

router.post('/api/auth/mfa/siapkan', null, ({ ctx }) => {
  if (!ctx?.user) throw unauthorized();
  const secret = generateTotpSecret();
  run('UPDATE users SET mfa_secret = ? WHERE id = ?', [secret, ctx.user.id]);
  return {
    secret,
    otpauth: otpauthUrl(secret, ctx.user.username),
    petunjuk: 'Pindai QR / masukkan kunci pada Google Authenticator, lalu verifikasi dengan kode 6 digit.',
  };
});

router.post('/api/auth/mfa/aktifkan', null, ({ body, ctx }) => {
  if (!ctx?.user) throw unauthorized();
  const u = get('SELECT mfa_secret FROM users WHERE id = ?', [ctx.user.id]);
  if (!u?.mfa_secret) throw badRequest('Jalankan proses penyiapan MFA terlebih dahulu');
  if (!verifyTotp(u.mfa_secret, body.kode)) throw badRequest('Kode verifikasi tidak sesuai');
  run('UPDATE users SET mfa_enabled = 1 WHERE id = ?', [ctx.user.id]);
  logAudit(ctx, { aksi: 'update', modul: 'admin', entitas_id: ctx.user.id, keterangan: 'MFA diaktifkan' });
  return { berhasil: true, mfa_enabled: 1 };
});

router.post('/api/auth/mfa/nonaktifkan', null, ({ body, ctx }) => {
  if (!ctx?.user) throw unauthorized();
  const user = get('SELECT * FROM users WHERE id = ?', [ctx.user.id]);
  if (!verifyPassword(String(body.sandi || ''), user.password_hash, user.password_salt)) {
    throw badRequest('Kata sandi tidak sesuai');
  }
  run('UPDATE users SET mfa_enabled = 0, mfa_secret = NULL WHERE id = ?', [ctx.user.id]);
  logAudit(ctx, { aksi: 'update', modul: 'admin', entitas_id: ctx.user.id, keterangan: 'MFA dinonaktifkan' });
  return { berhasil: true, mfa_enabled: 0 };
});

// --------------------------- Notifikasi ---------------------------

router.get('/api/notifikasi', null, ({ ctx, query }) => {
  if (!ctx?.user) throw unauthorized();
  const rows = all(
    `SELECT * FROM notifications WHERE (user_id = ? OR role = ?) ${query.belum ? 'AND dibaca = 0' : ''}
      ORDER BY created_at DESC LIMIT 50`, [ctx.user.id, ctx.user.role]);
  return { data: rows, belum_dibaca: unreadCount(ctx.user) };
});

router.post('/api/notifikasi/baca', null, ({ body, ctx }) => {
  if (!ctx?.user) throw unauthorized();
  if (body.id) run('UPDATE notifications SET dibaca = 1 WHERE id = ? AND (user_id = ? OR role = ?)',
    [body.id, ctx.user.id, ctx.user.role]);
  else run('UPDATE notifications SET dibaca = 1 WHERE user_id = ? OR role = ?', [ctx.user.id, ctx.user.role]);
  return { berhasil: true, belum_dibaca: unreadCount(ctx.user) };
});

export default router;
