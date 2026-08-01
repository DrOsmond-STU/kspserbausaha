/**
 * Uji autentikasi: penguncian akun dan penampilan akun contoh.
 *
 * Penguncian diuji lewat HTTP sungguhan, bukan lewat pemanggilan fungsi, karena
 * yang ingin dijamin adalah perilaku yang benar-benar dilihat penyerang dari
 * luar - termasuk kode status dan pesan yang dikembalikan.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ECMS_DATA_DIR = mkdtempSync(join(tmpdir(), 'ecms-uji-auth-'));
process.env.ECMS_DB = join(process.env.ECMS_DATA_DIR, 'uji.db');
process.env.HOST = '127.0.0.1';
process.env.PORT = '0';
process.env.ECMS_ADMIN_PASSWORD = 'Rahasia!2026uji';

const server = (await import('../server/index.js')).default;
const { run, get } = await import('../server/db.js');

let asal;

before(async () => {
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  asal = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

const masuk = (password, username = 'admin') => fetch(`${asal}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username, password }),
});

/** Mengembalikan akun ke keadaan bersih supaya urutan uji tidak saling merusak. */
const bukaKunci = () => run("UPDATE users SET gagal_login = 0, terkunci_sampai = NULL WHERE username = 'admin'");

describe('Penguncian akun', () => {
  test('lima kali salah mengunci akun, bukan pada percobaan keempat', async () => {
    bukaKunci();
    for (let i = 1; i <= 4; i += 1) {
      const r = await masuk('SalahSekali1');
      assert.equal(r.status, 401, `percobaan ke-${i} seharusnya masih 401`);
    }
    const kelima = await masuk('SalahSekali1');
    assert.equal(kelima.status, 401, 'percobaan kelima masih menolak sebagai sandi salah');

    const terkunci = await masuk('SalahSekali1');
    assert.equal(terkunci.status, 423);
    const isi = await terkunci.json();
    assert.match(isi.pesan, /terkunci/i);
    assert.match(isi.detail, /menit/i, 'pesan harus memberi tahu berapa lama harus menunggu');
  });

  test('kunci memakai kata sandi yang benar pun tetap ditolak selama masa kunci', async () => {
    bukaKunci();
    for (let i = 0; i < 5; i += 1) await masuk('SalahSekali1');
    const r = await masuk('Rahasia!2026uji');
    assert.equal(r.status, 423);
  });

  test('kunci terbuka sendiri sesudah masa tunggu lewat', async () => {
    bukaKunci();
    for (let i = 0; i < 5; i += 1) await masuk('SalahSekali1');
    assert.equal((await masuk('Rahasia!2026uji')).status, 423);

    // Memundurkan waktu kunci menirukan berlalunya masa tunggu tanpa menunggu
    // 15 menit sungguhan di dalam uji.
    run("UPDATE users SET terkunci_sampai = datetime('now', '-1 minute') WHERE username = 'admin'");

    const r = await masuk('Rahasia!2026uji');
    assert.equal(r.status, 201, 'sesudah masa kunci lewat, kata sandi benar harus diterima');
    const baris = get("SELECT gagal_login, terkunci_sampai FROM users WHERE username = 'admin'");
    assert.equal(baris.gagal_login, 0);
    assert.equal(baris.terkunci_sampai, null);
  });

  test('hitungan gagal kembali nol sesudah berhasil masuk', async () => {
    bukaKunci();
    for (let i = 0; i < 3; i += 1) await masuk('SalahSekali1');
    assert.equal(get("SELECT gagal_login FROM users WHERE username = 'admin'").gagal_login, 3);
    assert.equal((await masuk('Rahasia!2026uji')).status, 201);
    assert.equal(get("SELECT gagal_login FROM users WHERE username = 'admin'").gagal_login, 0);
  });

  test('nama pengguna yang tidak ada tetap ditolak tanpa membocorkan keberadaannya', async () => {
    const r = await masuk('apa saja', 'tidak-ada-orang-ini');
    assert.equal(r.status, 401);
    const isi = await r.json();
    assert.match(isi.pesan, /Nama pengguna atau kata sandi salah/);
  });
});

describe('Penyajian berkas statis', () => {
  test('rute aplikasi dilayani kerangka halaman', async () => {
    const r = await fetch(`${asal}/anggota/12`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/html/);
  });

  test('berkas yang tidak ada menjawab 404, bukan HTML bersandi 200', async () => {
    for (const jalur of ['/ecms.db', '/.env', '/js/tidak-ada.js', '/gaya-hilang.css']) {
      const r = await fetch(`${asal}${jalur}`);
      assert.equal(r.status, 404, `${jalur} seharusnya 404`);
    }
  });

  test('naik folder tidak dapat keluar dari direktori publik', async () => {
    const r = await fetch(`${asal}/../server/db.js`);
    assert.ok(r.status >= 400, `seharusnya ditolak, bukan ${r.status}`);
  });
});

describe('Akun contoh pada halaman masuk', () => {
  test('tidak diumumkan bila kata sandi administrator ditentukan sendiri', async () => {
    const info = await (await fetch(`${asal}/api/info`)).json();
    assert.equal(info.demo, false,
      'pemasangan dengan ECMS_ADMIN_PASSWORD bukan pemasangan demonstrasi');
  });
});
