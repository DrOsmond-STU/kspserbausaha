/**
 * Uji Pusat Laporan kelompok usaha & organisasi lewat HTTP sungguhan:
 * angka penjualan/retur/stok/penerimaan mengikuti transaksi yang dibuat,
 * stok per tanggal dihitung dari mutasi, hak akses per laporan, dan data
 * rahasia pengguna tidak pernah ikut keluar.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ECMS_DATA_DIR = mkdtempSync(join(tmpdir(), 'ecms-uji-lap-usaha-'));
process.env.ECMS_DB = join(process.env.ECMS_DATA_DIR, 'uji.db');
process.env.HOST = '127.0.0.1';
process.env.PORT = '0';
process.env.ECMS_ADMIN_PASSWORD = 'Rahasia!2026lapusaha';

const server = (await import('../server/index.js')).default;
const { run, scalar } = await import('../server/db.js');
const { today, addDays } = await import('../server/lib/util.js');

let asal;
let cookieAdmin;
let barangId;
let gudangId;
const KODE = 'UJI-LAP-01';
const hari = today();
const tAwal = addDays(hari, -10);
const tJual = addDays(hari, -5);
const tKedaluwarsa = addDays(hari, 30);

async function masuk(username, password) {
  const res = await fetch(`${asal}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }),
  });
  assert.ok(res.ok, `${username} dapat masuk`);
  return res.headers.get('set-cookie').split(';')[0];
}

async function panggil(metode, path, body, cookie = cookieAdmin) {
  const res = await fetch(`${asal}${path}`, {
    method: metode,
    headers: { cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const isi = await res.json().catch(() => null);
  assert.ok(res.ok, `${metode} ${path} → ${res.status} ${JSON.stringify(isi)}`);
  return isi;
}

const laporan = (kode, filter = {}, cookie = cookieAdmin) =>
  fetch(`${asal}/api/pusat-laporan/${kode}?${new URLSearchParams(filter)}`, { headers: { cookie } });

async function lap(kode, filter) {
  const res = await laporan(kode, filter);
  const isi = await res.json();
  assert.equal(res.status, 200, JSON.stringify(isi));
  return isi;
}

before(async () => {
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  asal = `http://127.0.0.1:${server.address().port}`;
  cookieAdmin = await masuk('admin', process.env.ECMS_ADMIN_PASSWORD);
  gudangId = scalar("SELECT id FROM gudang WHERE status = 'aktif' ORDER BY id LIMIT 1");
  assert.ok(gudangId, 'gudang bawaan tersedia');
  barangId = run(`INSERT INTO barang(kode, nama, satuan, harga_jual, harga_anggota)
                  VALUES(?, 'Teh Celup Uji', 'PCS', 20000, 19000)`, [KODE]).lastInsertRowid;

  // Saldo awal 10 @15.000, jual 3, retur 1
  await panggil('POST', '/api/persediaan/penyesuaian',
    { barang_id: barangId, gudang_id: gudangId, jenis: 'masuk', qty: 10, harga: 15000, tanggal: tAwal });
  const jual = await panggil('POST', '/api/pos/jual', {
    tanggal: tJual, gudang_id: gudangId, metode_bayar: 'tunai', items: [{ barang_id: barangId, qty: 3 }],
  });
  await panggil('POST', '/api/pos/retur',
    { penjualan_id: jual.id, tanggal: hari, items: [{ barang_id: barangId, qty: 1 }], alasan: 'Kemasan sobek' });

  // Pembelian 5 unit berbatch & berkedaluwarsa, diterima hari ini (hutang)
  const sup = await panggil('POST', '/api/master/supplier', { kode: 'SUP-UJI-LAP', nama: 'CV Pemasok Uji', termin_hari: 14 });
  const po = await panggil('POST', '/api/pembelian', {
    tanggal: hari, supplier_id: sup.id, gudang_id: gudangId, items: [{ barang_id: barangId, qty: 5, harga: 16000 }],
  });
  await panggil('POST', `/api/pembelian/${po.id}/terima`, {
    tanggal: hari, items: [{ barang_id: barangId, qty: 5, batch: 'BT-01', expired: tKedaluwarsa }],
  });
});

after(() => server.close());

describe('Laporan penjualan', () => {
  test('penjualan per barang memuat qty jual, retur, dan HPP bersih', async () => {
    const d = await lap('penjualan-per-barang', { kode_dari: KODE, kode_sampai: KODE });
    const [b] = d.bagian[0].baris;
    assert.equal(d.bagian[0].baris.length, 1);
    assert.equal(b.qty, 3);
    assert.equal(b.qty_retur, 1);
    assert.equal(b.qty_bersih, 2);
    assert.equal(b.nilai, 60000);
    assert.equal(b.nilai_retur, 20000);
    assert.equal(b.bersih, 40000);
    assert.equal(b.hpp, 30000, 'HPP bersih = 2 x 15.000');
    assert.equal(b.laba_kotor, 10000);
  });

  test('retur penjualan mencantumkan alasan dari jurnal retur', async () => {
    const d = await lap('penjualan-retur', { dari: hari, sampai: hari, kode_dari: KODE, kode_sampai: KODE });
    assert.equal(d.bagian[0].baris.length, 1);
    assert.equal(d.bagian[0].baris[0].alasan, 'Kemasan sobek');
    assert.equal(d.bagian[0].baris[0].nilai_retur, 20000);
  });

  test('filter pilihan yang tidak tersedia ditolak', async () => {
    const res = await laporan('penjualan-daftar', { metode: 'barter' });
    assert.equal(res.status, 400);
  });
});

describe('Laporan persediaan & pembelian', () => {
  test('posisi stok per tanggal dihitung dari mutasi, bukan saldo terkini', async () => {
    const lalu = await lap('persediaan-posisi', { per_tanggal: tAwal, kode_dari: KODE, kode_sampai: KODE });
    assert.equal(lalu.bagian[0].baris[0].qty, 10);
    const kini = await lap('persediaan-posisi', { kode_dari: KODE, kode_sampai: KODE });
    assert.equal(kini.bagian[0].baris[0].qty, 13, '10 - 3 + 1 + 5');
    assert.equal(kini.bagian[0].baris[0].qty, scalar('SELECT SUM(qty) FROM stok WHERE barang_id = ?', [barangId]));
  });

  test('kartu stok: saldo awal + mutasi berjalan sampai saldo akhir', async () => {
    const d = await lap('kartu-stok', { dari: tJual, sampai: hari, kode_dari: KODE, kode_sampai: KODE });
    const b = d.bagian[0];
    assert.equal(b.baris[0].jenis, 'Saldo awal');
    assert.equal(b.baris[0].saldo, 10);
    assert.deepEqual(b.baris.slice(1).map((r) => r.saldo), [7, 8, 13]);
    assert.equal(b.total.saldo, 13);
    assert.equal(b.total.masuk, 6);
    assert.equal(b.total.keluar, 3);
  });

  test('penerimaan barang, hutang supplier, dan batch akan kedaluwarsa', async () => {
    const terima = await lap('pembelian-penerimaan', { dari: hari, kode_dari: KODE, kode_sampai: KODE });
    assert.equal(terima.bagian[0].baris.length, 1);
    assert.equal(terima.bagian[0].baris[0].nilai, 80000);
    assert.equal(terima.bagian[0].baris[0].batch, 'BT-01');

    const hutang = await lap('hutang-supplier', {});
    const rekap = hutang.bagian[0].baris.find((r) => r.kode === 'SUP-UJI-LAP');
    assert.equal(rekap.sisa, 80000);
    assert.equal(rekap.belum_jt, 80000);

    const exp = await lap('persediaan-kedaluwarsa', { kode_dari: KODE, kode_sampai: KODE });
    assert.equal(exp.bagian[0].baris.length, 1);
    assert.equal(exp.bagian[0].baris[0].qty_sisa, 5, 'FIFO: stok 13 mencakup seluruh batch terakhir');
    assert.equal(exp.bagian[0].baris[0].status, 'Akan kedaluwarsa');
  });
});

describe('Laporan organisasi & hak akses', () => {
  test('daftar pengguna tidak pernah memuat sandi/rahasia MFA; unduhan Excel & Word tersedia', async () => {
    const d = await lap('admin-pengguna', {});
    const teks = JSON.stringify(d);
    assert.ok(!/password|salt|mfa_secret/i.test(teks), 'tidak ada kolom rahasia');
    assert.ok(d.bagian[0].baris.some((r) => r.username === 'admin'));
    for (const format of ['xlsx', 'docx']) {
      const res = await fetch(`${asal}/api/pusat-laporan/admin-pengguna/unduh?format=${format}`, { headers: { cookie: cookieAdmin } });
      assert.equal(res.status, 200);
      const buf = Buffer.from(await res.arrayBuffer());
      assert.equal(buf.subarray(0, 2).toString(), 'PK', `${format} berupa arsip OOXML`);
    }
  });

  test('audit trail tersaring per modul & aksi', async () => {
    const d = await lap('admin-audit-trail', { dari: hari, sampai: hari, modul: 'pos', aksi: 'create' });
    assert.ok(d.bagian[0].baris.length >= 1);
    assert.ok(d.bagian[0].baris.every((r) => r.modul === 'pos' && r.aksi === 'create'));
    assert.ok(!('data_before' in d.bagian[0].baris[0]));
  });

  test('kasir toko hanya melihat laporan sesuai izinnya', async () => {
    await panggil('POST', '/api/admin/users',
      { username: 'kasir.lap', nama: 'Kasir Laporan', password: 'KasirLap2026', role: 'kasir_toko' });
    const cookie = await masuk('kasir.lap', 'KasirLap2026');
    const kat = await (await fetch(`${asal}/api/pusat-laporan`, { headers: { cookie } })).json();
    const kode = kat.data.map((l) => l.kode);
    assert.ok(kode.includes('penjualan-tutup-kasir'));
    assert.ok(kode.includes('persediaan-posisi'));
    assert.ok(!kode.includes('admin-pengguna'));
    assert.ok(!kode.includes('pembelian-daftar'));
    assert.equal((await laporan('admin-pengguna', {}, cookie)).status, 403);

    // Rekap tutup kasir dibatasi pada transaksi kasir itu sendiri (belum ada transaksi)
    const res = await laporan('penjualan-tutup-kasir', { dari: tJual, sampai: tJual }, cookie);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).bagian[0].baris.length, 0);
  });
});
