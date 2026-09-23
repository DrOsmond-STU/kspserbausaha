/**
 * Uji rute baca pendukung antarmuka koreksi perdagangan: daftar penyesuaian
 * stok dengan penanda "dibatalkan" dan jumlah penjualan batal pada daftar
 * penjualan (omzet tidak menghitung transaksi batal).
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ECMS_DATA_DIR = mkdtempSync(join(tmpdir(), 'ecms-uji-koreksi-dagang-'));
process.env.ECMS_DB = join(process.env.ECMS_DATA_DIR, 'uji.db');
process.env.HOST = '127.0.0.1';
process.env.PORT = '0';
process.env.ECMS_ADMIN_PASSWORD = 'Rahasia!2026dagang';

const server = (await import('../server/index.js')).default;
const { run, scalar } = await import('../server/db.js');

let asal;
let cookie;
let barangId;
let gudangId;

async function panggil(metode, path, body) {
  const res = await fetch(`${asal}${path}`, {
    method: metode,
    headers: { cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.ok ? 200 : res.status, isi: await res.json().catch(() => null) };
}

before(async () => {
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  asal = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${asal}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: process.env.ECMS_ADMIN_PASSWORD }),
  });
  assert.ok(res.ok, 'admin dapat masuk');
  cookie = res.headers.get('set-cookie').split(';')[0];
  gudangId = scalar('SELECT id FROM gudang ORDER BY id LIMIT 1');
  barangId = run(`INSERT INTO barang(kode, nama, satuan, harga_jual, harga_anggota)
                  VALUES('UJI-KRK','Minyak 1 L','BTL', 20000, 19000)`).lastInsertRowid;
});

after(() => server.close());

describe('Daftar penyesuaian stok untuk koreksi', () => {
  test('penanda dibatalkan berubah sesudah penyesuaian dibatalkan', async () => {
    const h = await panggil('POST', '/api/persediaan/penyesuaian', {
      barang_id: barangId, gudang_id: gudangId, jenis: 'masuk', qty: 10, harga: 15000 });
    assert.equal(h.status, 200, JSON.stringify(h.isi));

    let d = await panggil('GET', '/api/persediaan/penyesuaian');
    assert.equal(d.status, 200, JSON.stringify(d.isi));
    const baris = d.isi.data.find((m) => m.id === h.isi.id);
    assert.ok(baris, 'penyesuaian tampil di daftar');
    assert.equal(baris.dibatalkan, 0);
    assert.equal(baris.kode, 'UJI-KRK');
    assert.equal(baris.jurnal_nomor, h.isi.jurnal.nomor);

    const b = await panggil('POST', `/api/koreksi/stok/${h.isi.id}/batal`, { alasan: 'Salah input' });
    assert.equal(b.status, 200, JSON.stringify(b.isi));
    d = await panggil('GET', '/api/persediaan/penyesuaian');
    assert.equal(d.isi.data.find((m) => m.id === h.isi.id).dibatalkan, 1);
    assert.ok(d.isi.data.every((m) => ['penyesuaian_masuk', 'penyesuaian_keluar'].includes(m.jenis)),
      'mutasi pembatalan tidak ikut terdaftar');
    assert.equal((await panggil('GET', `/api/persediaan/penyesuaian/${h.isi.id}`)).isi.dibatalkan, true);
  });
});

describe('Daftar penjualan dengan transaksi batal', () => {
  test('jumlah_batal dihitung dan omzet tidak memuat transaksi batal', async () => {
    const jual = async () => {
      const r = await panggil('POST', '/api/pos/jual', {
        gudang_id: gudangId, metode_bayar: 'tunai', bayar: 50000, items: [{ barang_id: barangId, qty: 1 }] });
      assert.equal(r.status, 200, JSON.stringify(r.isi));
      return r.isi;
    };
    const stok = await panggil('POST', '/api/persediaan/penyesuaian', {
      barang_id: barangId, gudang_id: gudangId, jenis: 'masuk', qty: 10, harga: 15000 });
    assert.equal(stok.status, 200, JSON.stringify(stok.isi));
    await jual();
    await jual();
    const batal = await jual();
    const b = await panggil('POST', `/api/koreksi/penjualan/${batal.id}/batal`, { alasan: 'Uji' });
    assert.equal(b.status, 200, JSON.stringify(b.isi));
    const d = await panggil('GET', '/api/penjualan?q=POS');
    assert.equal(d.status, 200, JSON.stringify(d.isi));
    assert.equal(d.isi.total, 3);
    assert.equal(d.isi.jumlah_batal, 1);
    assert.equal(d.isi.omzet, 40000);
    assert.equal(d.isi.data.find((p) => p.id === batal.id).alasan_batal, 'Uji');
    const tanpaFilter = await panggil('GET', '/api/penjualan');
    assert.equal(tanpaFilter.isi.jumlah_batal, 1);
  });
});
