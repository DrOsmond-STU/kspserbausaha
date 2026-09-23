/**
 * Uji modul perdagangan (persediaan, stock opname, penjualan/retur, pembelian)
 * lewat HTTP sungguhan: validasi rute, kode status, dan bentuk respons yang
 * dipakai antarmuka.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ECMS_DATA_DIR = mkdtempSync(join(tmpdir(), 'ecms-uji-dagang-'));
process.env.ECMS_DB = join(process.env.ECMS_DATA_DIR, 'uji.db');
process.env.HOST = '127.0.0.1';
process.env.PORT = '0';
process.env.ECMS_ADMIN_PASSWORD = 'Rahasia!2026dagang';

const server = (await import('../server/index.js')).default;
const { run, get, scalar, setting } = await import('../server/db.js');
const acc = await import('../server/services/accounting.js');

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
  // Rute POST pembuat data menjawab 201; bagi uji ini seluruh 2xx dianggap 200.
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
  assert.ok(gudangId, 'gudang bawaan tersedia');
  barangId = run(`INSERT INTO barang(kode, nama, satuan, harga_jual, harga_anggota)
                  VALUES('UJI-DAGANG','Gula 1 kg','PCS', 20000, 19000)`).lastInsertRowid;
});

after(() => server.close());

describe('Penyesuaian stok', () => {
  test('kuantitas positif + jenis menentukan arah, dan jurnal otomatis dikembalikan', async () => {
    const sebelum = acc.saldoAkun(setting('coa.persediaan')).saldo;
    const masuk = await panggil('POST', '/api/persediaan/penyesuaian', {
      barang_id: barangId, gudang_id: gudangId, jenis: 'masuk', qty: 10, harga: 15000 });
    assert.equal(masuk.status, 200, JSON.stringify(masuk.isi));
    assert.equal(masuk.isi.stok_sesudah, 10);
    assert.ok(masuk.isi.jurnal?.nomor, 'nomor jurnal tersedia untuk ditampilkan');

    const keluar = await panggil('POST', '/api/persediaan/penyesuaian', {
      barang_id: barangId, gudang_id: gudangId, jenis: 'keluar', qty: 2 });
    assert.equal(keluar.status, 200, JSON.stringify(keluar.isi));
    assert.equal(keluar.isi.stok_sesudah, 8);
    assert.equal(acc.saldoAkun(setting('coa.persediaan')).saldo - sebelum, 8 * 15000);
  });
});

describe('Pembatalan stock opname', () => {
  test('draft dapat dibatalkan dengan alasan, lalu tidak dapat diselesaikan', async () => {
    const buat = await panggil('POST', '/api/persediaan/opname', { gudang_id: gudangId });
    assert.equal(buat.status, 200, JSON.stringify(buat.isi));
    const id = buat.isi.id;

    const tanpaAlasan = await panggil('POST', `/api/persediaan/opname/${id}/batal`, {});
    assert.equal(tanpaAlasan.status, 400);

    const stokSebelum = scalar('SELECT qty FROM stok WHERE barang_id = ? AND gudang_id = ?', [barangId, gudangId]);
    const batal = await panggil('POST', `/api/persediaan/opname/${id}/batal`, { alasan: 'Salah pilih gudang' });
    assert.equal(batal.status, 200, JSON.stringify(batal.isi));
    const o = get('SELECT * FROM stock_opname WHERE id = ?', [id]);
    assert.equal(o.status, 'batal');
    assert.equal(o.alasan_batal, 'Salah pilih gudang');
    assert.equal(o.jurnal_id, null, 'pembatalan tidak membentuk jurnal');
    assert.equal(scalar('SELECT qty FROM stok WHERE barang_id = ? AND gudang_id = ?', [barangId, gudangId]),
      stokSebelum, 'pembatalan tidak mengubah stok');

    assert.equal((await panggil('POST', `/api/persediaan/opname/${id}/batal`, { alasan: 'lagi' })).status, 409);
    assert.equal((await panggil('POST', `/api/persediaan/opname/${id}/selesai`, { detail: [] })).status, 409);
  });

  test('opname yang sudah selesai tidak dapat dibatalkan', async () => {
    const buat = await panggil('POST', '/api/persediaan/opname', { gudang_id: gudangId });
    const id = buat.isi.id;
    assert.equal((await panggil('POST', `/api/persediaan/opname/${id}/selesai`, { detail: [] })).status, 200);
    const batal = await panggil('POST', `/api/persediaan/opname/${id}/batal`, { alasan: 'terlambat' });
    assert.equal(batal.status, 409);
  });
});

describe('Retur penjualan sebagian', () => {
  test('detail penjualan memuat qty_retur dan retur berlebih ditolak', async () => {
    const jual = await panggil('POST', '/api/pos/jual', {
      gudang_id: gudangId, metode_bayar: 'tunai', bayar: 100000,
      items: [{ barang_id: barangId, qty: 3, harga: 20000 }] });
    assert.equal(jual.status, 200, JSON.stringify(jual.isi));
    const id = jual.isi.id;

    const retur = await panggil('POST', '/api/pos/retur', {
      penjualan_id: id, alasan: 'Kemasan rusak', items: [{ barang_id: barangId, qty: 1 }] });
    assert.equal(retur.status, 200, JSON.stringify(retur.isi));
    assert.equal(retur.isi.nilai_retur, 20000);
    assert.equal(retur.isi.retur_penuh, false);

    const detail = await panggil('GET', `/api/penjualan/${id}`);
    assert.equal(detail.isi.detail[0].qty_retur, 1);

    const lebih = await panggil('POST', '/api/pos/retur', {
      penjualan_id: id, alasan: 'uji', items: [{ barang_id: barangId, qty: 3 }] });
    assert.equal(lebih.status, 400);
  });
});

describe('Ubah & batal dokumen pembelian', () => {
  test('dokumen tanpa penerimaan dapat diubah lalu dibatalkan dengan alasan', async () => {
    const buat = await panggil('POST', '/api/pembelian', {
      tipe: 'po', gudang_id: gudangId, status: 'diajukan',
      items: [{ barang_id: barangId, qty: 5, harga: 15000 }] });
    assert.equal(buat.status, 200, JSON.stringify(buat.isi));
    const id = buat.isi.id;

    const ubah = await panggil('PUT', `/api/pembelian/${id}`, {
      gudang_id: gudangId, items: [{ barang_id: barangId, qty: 4, harga: 16000 }] });
    assert.equal(ubah.status, 200, JSON.stringify(ubah.isi));
    assert.equal(ubah.isi.total, 64000);

    const batal = await panggil('POST', `/api/pembelian/${id}/batal`, { alasan: 'Supplier tidak sanggup' });
    assert.equal(batal.status, 200, JSON.stringify(batal.isi));
    const lihat = await panggil('GET', `/api/pembelian/${id}`);
    assert.equal(lihat.isi.status, 'batal');
    assert.equal(lihat.isi.alasan_batal, 'Supplier tidak sanggup');
  });
});
