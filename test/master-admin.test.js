/**
 * Uji master data & administrator: validasi akun pada master, parameter
 * pemetaan akun, dan reset MFA pengguna oleh administrator.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ECMS_DATA_DIR = mkdtempSync(join(tmpdir(), 'ecms-uji-master-'));
process.env.ECMS_DB = join(process.env.ECMS_DATA_DIR, 'uji.db');
process.env.HOST = '127.0.0.1';
process.env.PORT = '0';
process.env.ECMS_ADMIN_PASSWORD = 'Rahasia!2026master';

const server = (await import('../server/index.js')).default;
const { run, get, scalar } = await import('../server/db.js');

let asal;
let cookieAdmin;

async function masuk(username, password) {
  const res = await fetch(`${asal}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  assert.ok(res.ok, `${username} dapat masuk`);
  return res.headers.get('set-cookie').split(';')[0];
}

async function minta(metode, path, body, cookie = cookieAdmin) {
  const res = await fetch(`${asal}${path}`, {
    method: metode,
    headers: { cookie, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let isi = null;
  try { isi = await res.json(); } catch { /* kosong */ }
  return { status: res.status, isi };
}

/** Kode akun pertama yang memenuhi syarat - tanpa menanam kode akun di uji. */
const akun = (where) => get(`SELECT kode FROM coa WHERE is_postable = 1 AND status = 'aktif' AND ${where} ORDER BY kode`)?.kode;

before(async () => {
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  asal = `http://127.0.0.1:${server.address().port}`;
  cookieAdmin = await masuk('admin', process.env.ECMS_ADMIN_PASSWORD);
});

after(() => server.close());

describe('Master data', () => {
  test('menolak akun simpanan bertipe beban dan menerima akun kewajiban/ekuitas', async () => {
    const salah = await minta('POST', '/api/master/produk-simpanan',
      { kode: 'UJI-S1', nama: 'Uji', jenis: 'sukarela', coa_kode: akun("tipe = 'beban'") });
    assert.equal(salah.status, 400);
    assert.match(salah.isi.pesan, /bertipe beban/);

    const benar = await minta('POST', '/api/master/produk-simpanan',
      { kode: 'UJI-S1', nama: 'Uji', jenis: 'sukarela', coa_kode: akun("tipe = 'ekuitas'"),
        masuk_shu: '0', status: 'nonaktif' });
    assert.equal(benar.status, 201, JSON.stringify(benar.isi));
    assert.equal(benar.isi.masuk_shu, 0);
    assert.equal(benar.isi.status, 'nonaktif');
  });

  test('rekening bank hanya menerima akun kas/bank', async () => {
    const r = await minta('POST', '/api/master/bank', { nama_bank: 'Bank Uji', nomor_rekening: '999-1',
      atas_nama: 'Koperasi', coa_kode: akun("tipe = 'aset' AND is_kas = 0 AND is_bank = 0") });
    assert.equal(r.status, 400);
    assert.match(r.isi.pesan, /bukan akun kas\/bank/);
  });

  test('akun barang boleh dikosongkan (mengikuti Parameter Sistem)', async () => {
    const r = await minta('POST', '/api/master/barang', { kode: 'UJI-B1', nama: 'Barang Uji',
      pakai_batch: '1', coa_persediaan: '', coa_penjualan: '', coa_hpp: '' });
    assert.equal(r.status, 201, JSON.stringify(r.isi));
    assert.equal(r.isi.coa_persediaan, null);
    assert.equal(r.isi.pakai_batch, 1);
  });

  test('akun yang dipakai pemetaan tidak dapat dinonaktifkan', async () => {
    const kode = get("SELECT value FROM settings WHERE key = 'coa.kas'").value;
    const id = get('SELECT id FROM coa WHERE kode = ?', [kode]).id;
    const r = await minta('PUT', `/api/master/coa/${id}`, { status: 'nonaktif' });
    assert.equal(r.status, 409);
  });
});

describe('Parameter sistem', () => {
  test('GET menyertakan metadata pemetaan akun', async () => {
    const r = await minta('GET', '/api/admin/settings');
    assert.equal(r.status, 200);
    assert.ok(r.isi.pemetaan_akun.some((p) => p.key === 'coa.kas' && p.tipe));
    assert.ok(r.isi.kelompok_akun.length > 0);
    assert.ok(r.isi.daftar_akun.every((a) => a.kode && a.tipe));
  });

  test('menolak pemetaan akun bertipe salah dengan pesan yang jelas', async () => {
    const r = await minta('PUT', '/api/admin/settings', { settings: { 'coa.penjualan': akun("tipe = 'beban'") } });
    assert.equal(r.status, 400);
    assert.match(r.isi.pesan, /memerlukan akun bertipe pendapatan/);
  });
});

describe('Reset MFA oleh administrator', () => {
  let idUji;
  before(async () => {
    const r = await minta('POST', '/api/admin/users', { username: 'uji.mfa', nama: 'Uji MFA',
      role: 'kasir_toko', password: 'SandiUji2026' });
    assert.equal(r.status, 201, JSON.stringify(r.isi));
    idUji = r.isi.id;
  });

  test('menonaktifkan MFA dan mencatat jejak audit', async () => {
    run("UPDATE users SET mfa_enabled = 1, mfa_secret = 'JBSWY3DPEHPK3PXP' WHERE id = ?", [idUji]);
    const auditSebelum = scalar('SELECT COUNT(*) FROM audit_log');
    const r = await minta('POST', `/api/admin/users/${idUji}/reset-mfa`, {});
    assert.equal(r.status, 201, JSON.stringify(r.isi));
    const u = get('SELECT mfa_enabled, mfa_secret FROM users WHERE id = ?', [idUji]);
    assert.equal(u.mfa_enabled, 0);
    assert.equal(u.mfa_secret, null);
    assert.ok(scalar('SELECT COUNT(*) FROM audit_log') > auditSebelum);
    assert.ok(get("SELECT 1 FROM audit_log WHERE keterangan LIKE '%MFA pengguna \"uji.mfa\"%'"));
  });

  test('menolak bila MFA memang belum aktif', async () => {
    const r = await minta('POST', `/api/admin/users/${idUji}/reset-mfa`, {});
    assert.equal(r.status, 409);
  });

  test('menolak reset MFA akun sendiri (harus lewat kata sandi)', async () => {
    const idAdmin = get("SELECT id FROM users WHERE username = 'admin'").id;
    run('UPDATE users SET mfa_enabled = 1 WHERE id = ?', [idAdmin]);
    try {
      const r = await minta('POST', `/api/admin/users/${idAdmin}/reset-mfa`, {});
      assert.equal(r.status, 409);
    } finally {
      run('UPDATE users SET mfa_enabled = 0 WHERE id = ?', [idAdmin]);
    }
  });

  test('pengguna tanpa izin admin.update ditolak', async () => {
    const cookieKasir = await masuk('uji.mfa', 'SandiUji2026');
    const r = await minta('POST', `/api/admin/users/${idUji}/reset-mfa`, {}, cookieKasir);
    assert.equal(r.status, 403);
  });
});
