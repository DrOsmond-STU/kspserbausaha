/**
 * Modul 26 - Administrator: pengguna, RBAC, pengaturan, audit trail, backup.
 */
import { createRouter, notFound, badRequest, conflict, forbidden } from '../lib/http.js';
import { all, get, run, scalar, setSetting, setting, tx, DB_PATH, db } from '../db.js';
import { hashPassword, validatePassword, activeSessions } from '../lib/auth.js';
import { logAudit, verifyChain } from '../lib/audit.js';
import {
  ROLES, ROLE_CODES, MODULES, AKSI, PERAN_TETAP, roleInfo, izinPeran, diaturUlang, segarkanIzin,
} from '../lib/rbac.js';
import { idParam, num, str, oneOf, today } from '../lib/util.js';
import { KOMPONEN } from '../services/shu.js';
import { PEMETAAN_AKUN, KELOMPOK_AKUN } from '../services/accounting.js';
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const router = createRouter();

// ---------------------------- Pengguna ----------------------------

router.get('/api/admin/users', 'admin.view', ({ query }) => ({
  data: all(
    `SELECT u.id, u.username, u.nama, u.email, u.role, u.cabang_id, u.unit_usaha_id, u.anggota_id,
            u.mfa_enabled, u.status, u.last_login_at, u.gagal_login, u.created_at,
            c.nama AS cabang_nama, uu.nama AS unit_nama
       FROM users u LEFT JOIN cabang c ON c.id = u.cabang_id
       LEFT JOIN unit_usaha uu ON uu.id = u.unit_usaha_id
      ${query.role ? 'WHERE u.role = ?' : ''} ORDER BY u.username`,
    query.role ? [query.role] : []),
}));

router.post('/api/admin/users', 'admin.create', ({ body, ctx }) => {
  const username = str(body, 'username', { max: 50, min: 3, label: 'Nama pengguna' }).toLowerCase();
  if (!/^[a-z0-9._-]+$/.test(username)) {
    throw badRequest('Nama pengguna hanya boleh berisi huruf kecil, angka, titik, garis bawah, dan strip');
  }
  if (get('SELECT id FROM users WHERE lower(username) = ?', [username])) {
    throw conflict(`Nama pengguna "${username}" sudah digunakan`);
  }
  const role = oneOf(body, 'role', ROLE_CODES, { label: 'Peran' });
  const sandi = str(body, 'password', { max: 100, label: 'Kata sandi' });
  validatePassword(sandi);
  if (role === 'anggota' && !body.anggota_id) {
    throw badRequest('Pengguna dengan peran Anggota harus ditautkan ke data anggota');
  }
  const { hash, salt } = hashPassword(sandi);
  const { lastInsertRowid: id } = run(
    `INSERT INTO users(username, nama, email, password_hash, password_salt, role, cabang_id,
       unit_usaha_id, anggota_id) VALUES(?,?,?,?,?,?,?,?,?)`,
    [username, str(body, 'nama', { max: 120 }), body.email || null, hash, salt, role,
      body.cabang_id || null, body.unit_usaha_id || null, body.anggota_id || null],
  );
  logAudit(ctx, { aksi: 'create', modul: 'admin', entitas_id: id,
    keterangan: `Pengguna "${username}" dibuat dengan peran ${ROLES[role].nama}` });
  return get('SELECT id, username, nama, role, status FROM users WHERE id = ?', [id]);
});

router.put('/api/admin/users/:id', 'admin.update', ({ params, body, ctx }) => {
  const id = idParam(params);
  const before = get('SELECT * FROM users WHERE id = ?', [id]);
  if (!before) throw notFound('Pengguna tidak ditemukan');
  const data = {};
  for (const f of ['nama', 'email', 'cabang_id', 'unit_usaha_id', 'anggota_id']) {
    if (body[f] !== undefined) data[f] = body[f] === '' ? null : body[f];
  }
  if (body.role !== undefined) {
    if (before.role === 'super_admin' && body.role !== 'super_admin'
      && scalar("SELECT COUNT(*) FROM users WHERE role = 'super_admin' AND status = 'aktif'") <= 1) {
      throw conflict('Tidak dapat mengubah peran Super Administrator terakhir');
    }
    data.role = oneOf(body, 'role', ROLE_CODES, { label: 'Peran' });
  }
  if (body.status !== undefined) {
    if (before.id === ctx?.user?.id && body.status !== 'aktif') {
      throw conflict('Anda tidak dapat menonaktifkan akun Anda sendiri');
    }
    data.status = oneOf(body, 'status', ['aktif', 'nonaktif'], { label: 'Status' });
  }
  const cols = Object.keys(data);
  if (!cols.length) throw badRequest('Tidak ada perubahan yang dikirim');
  run(`UPDATE users SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
    [...cols.map((c) => data[c]), id]);
  if (data.status === 'nonaktif') run('DELETE FROM sessions WHERE user_id = ?', [id]);
  logAudit(ctx, { aksi: 'update', modul: 'admin', entitas_id: id,
    keterangan: `Pengguna "${before.username}" diperbarui`,
    before: { role: before.role, status: before.status }, after: data });
  return get('SELECT id, username, nama, role, status FROM users WHERE id = ?', [id]);
});

/** Reset kata sandi & buka kunci akun. */
router.post('/api/admin/users/:id/reset-sandi', 'admin.update', ({ params, body, ctx }) => {
  const id = idParam(params);
  const u = get('SELECT * FROM users WHERE id = ?', [id]);
  if (!u) throw notFound('Pengguna tidak ditemukan');
  const sandi = str(body, 'password', { max: 100, label: 'Kata sandi baru' });
  validatePassword(sandi);
  const { hash, salt } = hashPassword(sandi);
  run(`UPDATE users SET password_hash = ?, password_salt = ?, gagal_login = 0,
         terkunci_sampai = NULL WHERE id = ?`, [hash, salt, id]);
  run('DELETE FROM sessions WHERE user_id = ?', [id]);
  logAudit(ctx, { aksi: 'update', modul: 'admin', entitas_id: id,
    keterangan: `Kata sandi pengguna "${u.username}" direset oleh administrator` });
  return { berhasil: true, pesan: `Kata sandi ${u.username} berhasil direset dan seluruh sesinya dikeluarkan.` };
});

/**
 * Menonaktifkan MFA pengguna lain (mis. perangkat autentikator hilang).
 * Kolom yang dikosongkan sama dengan /api/auth/mfa/nonaktifkan. Akun sendiri
 * harus lewat jalur tersebut karena mensyaratkan kata sandi.
 */
router.post('/api/admin/users/:id/reset-mfa', 'admin.update', ({ params, ctx }) => {
  const id = idParam(params);
  const u = get('SELECT id, username, mfa_enabled, mfa_secret FROM users WHERE id = ?', [id]);
  if (!u) throw notFound('Pengguna tidak ditemukan');
  if (u.id === ctx?.user?.id) {
    throw conflict('MFA akun Anda sendiri dinonaktifkan melalui menu Keamanan Akun Anda',
      'Menu tersebut meminta kata sandi Anda sebagai konfirmasi.');
  }
  if (!u.mfa_enabled && !u.mfa_secret) throw conflict(`MFA pengguna "${u.username}" memang belum aktif`);
  run('UPDATE users SET mfa_enabled = 0, mfa_secret = NULL WHERE id = ?', [id]);
  logAudit(ctx, { aksi: 'update', modul: 'admin', entitas_id: id,
    keterangan: `MFA pengguna "${u.username}" dinonaktifkan oleh administrator`,
    before: { mfa_enabled: u.mfa_enabled }, after: { mfa_enabled: 0 } });
  return { berhasil: true, mfa_enabled: 0,
    pesan: `MFA ${u.username} dinonaktifkan. Minta pengguna mengaktifkannya kembali setelah masuk.` };
});

router.delete('/api/admin/users/:id', 'admin.delete', ({ params, ctx }) => {
  const id = idParam(params);
  const u = get('SELECT * FROM users WHERE id = ?', [id]);
  if (!u) throw notFound('Pengguna tidak ditemukan');
  if (u.id === ctx?.user?.id) throw conflict('Anda tidak dapat menghapus akun Anda sendiri');
  if (u.role === 'super_admin'
    && scalar("SELECT COUNT(*) FROM users WHERE role = 'super_admin'") <= 1) {
    throw conflict('Super Administrator terakhir tidak dapat dihapus');
  }
  run('DELETE FROM users WHERE id = ?', [id]);
  logAudit(ctx, { aksi: 'delete', modul: 'admin', entitas_id: id,
    keterangan: `Pengguna "${u.username}" dihapus`, before: { username: u.username, role: u.role } });
  return { dihapus: true };
});

// ------------------------------ RBAC ------------------------------

router.get('/api/admin/roles', 'admin.view', () => ({
  data: ROLE_CODES.map((k) => ({
    ...roleInfo(k),
    permissions: izinPeran(k),
    bawaan: ROLES[k].permissions,
    diatur: diaturUlang(k),
    tetap: PERAN_TETAP.has(k),
    jumlah_pengguna: scalar('SELECT COUNT(*) FROM users WHERE role = ?', [k]),
  })),
  modul: MODULES,
  aksi: AKSI,
}));

/**
 * Mengatur ulang izin sebuah peran. Super Administrator (selalu seluruh
 * akses) dan Anggota (hanya portal) tidak dapat diubah supaya sistem tidak
 * pernah kehilangan administrator dan anggota tidak pernah masuk ke back office.
 */
router.put('/api/admin/roles/:kode', 'admin.update', ({ params, body, ctx }) => {
  const kode = params.kode;
  if (!ROLES[kode]) throw notFound('Peran tidak ditemukan');
  if (PERAN_TETAP.has(kode)) throw conflict(`Izin peran ${ROLES[kode].nama} tidak dapat diubah`);
  if (!Array.isArray(body.permissions)) throw badRequest('Daftar izin wajib berupa array');
  const sah = new Set([...MODULES, 'portal']);
  const aksiSah = new Set([...AKSI.map((a) => a.kode), '*']);
  const bersih = [...new Set(body.permissions.map((p) => String(p).trim()).filter(Boolean))];
  for (const p of bersih) {
    const [m, a] = p.split('.');
    if (p === '*' || !sah.has(m) || !aksiSah.has(a) || m === 'portal') {
      throw badRequest(`Izin "${p}" tidak valid`, 'Format: modul.aksi, mis. pos.koreksi atau kas.*');
    }
  }
  const sebelum = izinPeran(kode);
  setSetting(`rbac.${kode}`, JSON.stringify(bersih.sort()), `Hak akses peran ${ROLES[kode].nama}`);
  segarkanIzin();
  logAudit(ctx, { aksi: 'update', modul: 'admin', entitas_id: kode,
    keterangan: `Hak akses peran ${ROLES[kode].nama} diubah`, before: sebelum, after: bersih });
  return { kode, permissions: izinPeran(kode), diatur: true };
});

/** Mengembalikan izin peran ke susunan bawaan. */
router.delete('/api/admin/roles/:kode', 'admin.update', ({ params, ctx }) => {
  const kode = params.kode;
  if (!ROLES[kode]) throw notFound('Peran tidak ditemukan');
  const sebelum = izinPeran(kode);
  run('DELETE FROM settings WHERE key = ?', [`rbac.${kode}`]);
  segarkanIzin();
  logAudit(ctx, { aksi: 'update', modul: 'admin', entitas_id: kode,
    keterangan: `Hak akses peran ${ROLES[kode].nama} dikembalikan ke bawaan`, before: sebelum });
  return { kode, permissions: izinPeran(kode), diatur: false };
});

// --------------------------- Pengaturan ---------------------------

router.get('/api/admin/settings', 'admin.view', ({ query }) => {
  // Profil koperasi, aktivasi, dan tanda tangan dikelola di menu Setup
  // Koperasi (logo berupa data URI besar tidak pantas tampil sebagai isian teks).
  const rows = all(
    `SELECT * FROM settings WHERE key NOT LIKE 'koperasi.%' AND key NOT LIKE 'aktivasi.%' AND key NOT LIKE 'ttd.%'
       AND key NOT LIKE 'rbac.%'
       ${query.prefix ? 'AND key LIKE ?' : ''} ORDER BY key`,
    query.prefix ? [`${query.prefix}%`] : []);
  return {
    data: rows,
    map: Object.fromEntries(rows.map((r) => [r.key, r.value])),
    komponen_shu: KOMPONEN.map((k) => ({ kode: k.kode, nama: k.nama, default: k.default })),
    // Metadata supaya antarmuka menampilkan pemetaan akun sebagai pilihan
    // akun (bukan isian bebas) dan menyaring menurut tipe akun yang sah.
    pemetaan_akun: PEMETAAN_AKUN.map((p) => ({ key: `coa.${p.kunci}`, label: p.label, tipe: p.tipe })),
    kelompok_akun: KELOMPOK_AKUN.map((k) => ({ key: `kelompok.${k.kunci}`, label: k.label })),
    daftar_akun: all(`SELECT kode, nama, tipe, is_kas, is_bank FROM coa
                       WHERE is_postable = 1 AND status = 'aktif' ORDER BY kode`),
  };
});

/**
 * Validasi pengaturan pemetaan akun & kelompok akun. Pemetaan yang salah
 * membuat seluruh jurnal otomatis modul terkait gagal, jadi ditolak sejak
 * disimpan - bukan saat transaksi pertama kali dicoba.
 */
function validasiPengaturan(key, value) {
  const v = String(value ?? '').trim();
  if (/^(rbac|koperasi|aktivasi|ttd)\./.test(key)) {
    throw badRequest(`Pengaturan "${key}" diubah melalui menu khususnya (Peran & Hak Akses / Setup Koperasi)`);
  }
  if (key.startsWith('coa.')) {
    const p = PEMETAAN_AKUN.find((x) => `coa.${x.kunci}` === key);
    if (!p) throw badRequest(`Pemetaan akun "${key}" tidak dikenal`);
    if (!v) throw badRequest(`Pemetaan akun "${p.label}" wajib diisi`);
    const akun = get('SELECT kode, nama, tipe, is_postable, status FROM coa WHERE kode = ?', [v]);
    if (!akun) throw badRequest(`Akun ${v} untuk "${p.label}" tidak terdaftar dalam bagan akun`);
    if (!akun.is_postable) throw badRequest(`Akun ${v} - ${akun.nama} adalah akun induk dan tidak dapat dipakai untuk "${p.label}"`);
    if (akun.status !== 'aktif') throw badRequest(`Akun ${v} - ${akun.nama} tidak aktif`);
    if (akun.tipe !== p.tipe) {
      throw badRequest(`Akun ${v} - ${akun.nama} bertipe ${akun.tipe}, sedangkan "${p.label}" memerlukan akun bertipe ${p.tipe}`);
    }
    if ((key === 'coa.kas' || key === 'coa.bank')
      && !get('SELECT 1 FROM coa WHERE kode = ? AND (is_kas = 1 OR is_bank = 1)', [v])) {
      throw badRequest(`Akun ${v} - ${akun.nama} belum ditandai sebagai akun kas/bank pada bagan akun`);
    }
    return v;
  }
  if (key.startsWith('kelompok.')) {
    if (!KELOMPOK_AKUN.some((k) => `kelompok.${k.kunci}` === key)) {
      throw badRequest(`Kelompok akun "${key}" tidak dikenal`);
    }
    const awalan = v.split(',').map((x) => x.trim()).filter(Boolean);
    if (awalan.some((a) => !/^[0-9A-Za-z.-]+$/.test(a))) {
      throw badRequest(`Isian "${key}" harus berupa awalan kode akun dipisah koma, mis. 1-11,1-12`);
    }
    return awalan.join(',');
  }
  return value;
}

router.put('/api/admin/settings', 'admin.update', ({ body, ctx }) => {
  const entries = Object.entries(body.settings || body || {});
  if (!entries.length) throw badRequest('Tidak ada pengaturan yang dikirim');
  return tx(() => {
    const before = {};
    for (const [k] of entries) before[k] = setting(k, null);
    for (const [k, v] of entries) setSetting(k, validasiPengaturan(k, v));
    // Validasi khusus: total alokasi SHU harus 100%
    const totalShu = KOMPONEN.reduce((s, k) => s + Number(setting(`shu.${k.kode}`, k.default)), 0);
    if (entries.some(([k]) => k.startsWith('shu.')) && Math.abs(totalShu - 100) > 0.01) {
      throw badRequest(`Total persentase alokasi SHU harus tepat 100% (saat ini ${totalShu}%)`);
    }
    logAudit(ctx, { aksi: 'update', modul: 'admin',
      keterangan: `Pengaturan diperbarui: ${entries.map(([k]) => k).join(', ')}`,
      before, after: Object.fromEntries(entries) });
    return { berhasil: true, diperbarui: entries.length };
  });
});

// --------------------------- Audit Trail ---------------------------

router.get('/api/admin/audit-log', 'admin.view', ({ query }) => {
  const w = [];
  const p = [];
  if (query.modul) { w.push('modul = ?'); p.push(query.modul); }
  if (query.aksi) { w.push('aksi = ?'); p.push(query.aksi); }
  if (query.username) { w.push('username = ?'); p.push(query.username); }
  if (query.dari) { w.push('waktu >= ?'); p.push(query.dari); }
  if (query.sampai) { w.push('waktu <= ?'); p.push(`${query.sampai}T23:59:59Z`); }
  if (query.q) { w.push('keterangan LIKE ?'); p.push(`%${query.q}%`); }
  const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
  const limit = Math.min(Number(query.limit) || 100, 1000);
  const offset = Math.max(Number(query.offset) || 0, 0);
  return {
    data: all(`SELECT * FROM audit_log ${where} ORDER BY id DESC LIMIT ? OFFSET ?`, [...p, limit, offset]),
    total: scalar(`SELECT COUNT(*) FROM audit_log ${where}`, p),
    limit, offset,
  };
});

/** Verifikasi rantai hash audit (deteksi manipulasi data). */
router.get('/api/admin/audit-log/verifikasi', 'admin.view', ({ ctx }) => {
  const hasil = verifyChain();
  logAudit(ctx, { aksi: 'export', modul: 'admin',
    keterangan: `Verifikasi integritas audit trail: ${hasil.valid ? 'VALID' : 'TERDAPAT ANOMALI'}` });
  return {
    ...hasil,
    dasar_hukum: 'UU No. 11 Tahun 2008 jo. UU No. 19 Tahun 2016 tentang Informasi dan Transaksi Elektronik',
    penjelasan: hasil.valid
      ? 'Seluruh rekaman audit membentuk rantai hash yang utuh; tidak terdeteksi penyisipan, '
        + 'penghapusan, maupun perubahan data.'
      : `Rantai hash terputus pada rekaman ID ${hasil.rusak_pada_id}. Data audit setelah titik tersebut `
        + 'perlu diverifikasi secara manual.',
  };
});

// -------------------------- Sesi & Keamanan --------------------------

router.get('/api/admin/sesi', 'admin.view', () => ({ data: activeSessions() }));

// ---------------------------- Backup ----------------------------

router.post('/api/admin/backup', 'admin.create', ({ ctx }) => {
  if (ctx?.user?.role !== 'super_admin') throw forbidden('Hanya Super Administrator yang dapat membuat cadangan');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = join(dirname(DB_PATH), `backup-ecms-${stamp}.db`);
  // Checkpoint WAL agar salinan berisi seluruh transaksi yang sudah di-commit
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  copyFileSync(DB_PATH, target);
  logAudit(ctx, { aksi: 'export', modul: 'admin', keterangan: `Cadangan basis data dibuat: ${target}` });
  return { berhasil: true, berkas: target, waktu: new Date().toISOString() };
});

/** Statistik sistem untuk panel administrator. */
router.get('/api/admin/sistem', 'admin.view', () => {
  const tabel = all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  return {
    versi_aplikasi: '1.0.0',
    node: process.version,
    basis_data: DB_PATH,
    ukuran_db: existsSync(DB_PATH) ? scalar('SELECT page_count * page_size FROM pragma_page_count(), pragma_page_size()') : 0,
    jumlah_tabel: tabel.length,
    statistik: {
      pengguna: scalar('SELECT COUNT(*) FROM users'),
      anggota: scalar('SELECT COUNT(*) FROM anggota'),
      jurnal: scalar('SELECT COUNT(*) FROM jurnal'),
      baris_jurnal: scalar('SELECT COUNT(*) FROM jurnal_detail'),
      audit_log: scalar('SELECT COUNT(*) FROM audit_log'),
      sesi_aktif: scalar("SELECT COUNT(*) FROM sessions WHERE expires_at > datetime('now')"),
    },
    uptime_detik: Math.round(process.uptime()),
    memori_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
  };
});

export default router;
