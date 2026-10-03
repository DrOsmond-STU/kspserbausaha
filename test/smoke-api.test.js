/**
 * Uji asap seluruh endpoint baca (GET).
 *
 * Setiap rute GET yang terdaftar dipanggil sebagai Super Administrator lewat
 * HTTP sungguhan. Jawaban 4xx wajar (parameter wajib tidak diisi, data id 1
 * tidak ada), tetapi 5xx berarti ada fitur yang rusak - misalnya kueri SQL
 * yang merujuk kolom yang tidak ada atau pemetaan akun yang hilang.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ECMS_DATA_DIR = mkdtempSync(join(tmpdir(), 'ecms-uji-asap-'));
process.env.ECMS_DB = join(process.env.ECMS_DATA_DIR, 'uji.db');
process.env.HOST = '127.0.0.1';
process.env.PORT = '0';
process.env.ECMS_ADMIN_PASSWORD = 'Rahasia!2026asap';
process.env.ECMS_DEBUG = '1'; // pesan teknis 5xx ikut dikirim agar kegagalan mudah dibaca

const server = (await import('../server/index.js')).default;
const folderRute = join(dirname(fileURLToPath(import.meta.url)), '..', 'server', 'routes');
const rute = [];
for (const f of readdirSync(folderRute).filter((x) => x.endsWith('.js'))) {
  const r = (await import(join(folderRute, f))).default;
  for (const x of r.routes) if (x.method === 'GET') rute.push(x.pattern);
}

let asal;
let cookie;

before(async () => {
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  asal = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${asal}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: process.env.ECMS_ADMIN_PASSWORD }),
  });
  assert.ok(res.ok, 'admin dapat masuk');
  cookie = res.headers.get('set-cookie').split(';')[0];
});

after(() => server.close());

test('tidak ada endpoint GET yang menghasilkan galat server', async () => {
  assert.ok(rute.length > 50, 'seluruh rute terbaca');
  const gagal = [];
  for (const pola of rute) {
    const url = pola.replace(/:[a-z_]+/g, '1');
    const res = await fetch(`${asal}${url}`, { headers: { cookie } });
    if (res.status >= 500) gagal.push(`${pola} → ${res.status} ${(await res.json()).debug || ''}`);
  }
  assert.deepEqual(gagal, []);
});

test('nilai JSON berbentuk objek ditolak 400, tidak menggeser parameter SQL', async () => {
  const kirim = (method, url, body) => fetch(`${asal}${url}`, {
    method, headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const sebelum = await (await fetch(`${asal}/api/admin/users`, { headers: { cookie } })).json();
  const admin = sebelum.data.find((u) => u.username === 'admin');
  for (const nilai of [{}, [], { id: 1 }]) {
    const res = await kirim('PUT', `/api/admin/users/${admin.id}`, { nama: nilai, email: 'x@contoh.id' });
    assert.equal(res.status, 400, `nama=${JSON.stringify(nilai)} ditolak`);
  }
  const sesudah = await (await fetch(`${asal}/api/admin/users`, { headers: { cookie } })).json();
  assert.deepEqual(sesudah.data.find((u) => u.id === admin.id), admin, 'data pengguna tidak berubah');
});

test('berkas di luar folder public tidak dapat dibaca', async () => {
  for (const jalur of ['/..%2f..%2fpackage.json', '/%2e%2e/%2e%2e/package.json', '/v/abc/..%2f..%2fserver/db.js']) {
    const res = await fetch(`${asal}${jalur}`);
    const isi = await res.text();
    assert.ok(!isi.includes('"name"') && !isi.includes('DatabaseSync'), `${jalur} tidak membocorkan berkas`);
  }
});
