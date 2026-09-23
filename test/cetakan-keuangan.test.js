/**
 * Uji rute baca untuk cetakan bukti keuangan & perdagangan: bukti kas,
 * berita acara cash opname, penerimaan barang, pembayaran utang, retur,
 * penyesuaian stok, dan pelepasan aset.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ECMS_DATA_DIR = mkdtempSync(join(tmpdir(), 'ecms-uji-cetak-'));
process.env.ECMS_DB = join(process.env.ECMS_DATA_DIR, 'uji.db');
process.env.HOST = '127.0.0.1';
process.env.PORT = '0';
process.env.ECMS_ADMIN_PASSWORD = 'Rahasia!2026cetak';

const server = (await import('../server/index.js')).default;
const { run, scalar, setting } = await import('../server/db.js');

let asal;
let cookie;
let barangId;
let gudangId;
let supplierId;

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
                  VALUES('UJI-CETAK','Beras 5 kg','SAK', 80000, 78000)`).lastInsertRowid;
  supplierId = run("INSERT INTO supplier(kode, nama, termin_hari) VALUES('SUP-CETAK','CV Sumber Pangan', 30)")
    .lastInsertRowid;
});

after(() => server.close());

describe('Bukti kas & cash opname', () => {
  test('bukti kas masuk memuat nama akun, pihak, jurnal, dan terbilang; tetap terbaca setelah batal', async () => {
    const kas = setting('coa.kas');
    const lawan = setting('coa.pendapatan_lain');
    const h = await panggil('POST', '/api/kas', {
      jenis: 'kas_masuk', nominal: 1250000, coa_kas: kas, coa_lawan: lawan,
      keterangan: 'Sewa aula', pihak: 'Budi Santoso' });
    assert.equal(h.status, 200, JSON.stringify(h.isi));

    const b = await panggil('GET', `/api/kas/${h.isi.id}`);
    assert.equal(b.status, 200, JSON.stringify(b.isi));
    assert.equal(b.isi.nomor, h.isi.nomor);
    assert.equal(b.isi.pihak, 'Budi Santoso');
    assert.ok(b.isi.akun_kas_nama && b.isi.akun_lawan_nama, 'nama akun tersedia');
    assert.equal(b.isi.jurnal_nomor, h.isi.nomor);
    assert.equal(b.isi.terbilang, 'satu juta dua ratus lima puluh ribu rupiah');

    assert.equal((await panggil('POST', `/api/kas/${h.isi.id}/batal`, { alasan: 'Salah input' })).status, 200);
    const batal = await panggil('GET', `/api/kas/${h.isi.id}`);
    assert.equal(batal.isi.status, 'batal');
    assert.equal(batal.isi.alasan_batal, 'Salah input');

    assert.equal((await panggil('GET', '/api/kas/999999')).status, 404);
    assert.equal((await panggil('GET', '/api/kas/posisi')).status, 200, 'rute posisi tidak tertutup rute :id');
    assert.equal((await panggil('GET', '/api/kas/opname')).status, 200, 'rute daftar opname tidak tertutup rute :id');
  });

  test('bukti transfer memuat akun tujuan; berita acara cash opname memuat nama akun & terbilang', async () => {
    const kas = setting('coa.kas');
    const bank = setting('coa.bank');
    const t = await panggil('POST', '/api/kas/transfer', { coa_kas: kas, coa_tujuan: bank, nominal: 500000 });
    assert.equal(t.status, 200, JSON.stringify(t.isi));
    const b = await panggil('GET', `/api/kas/${t.isi.id}`);
    assert.equal(b.isi.jenis, 'transfer');
    assert.ok(b.isi.akun_tujuan_nama);

    const o = await panggil('POST', '/api/kas/opname', { coa_kas: kas, saldo_fisik: 0 });
    assert.equal(o.status, 200, JSON.stringify(o.isi));
    const ba = await panggil('GET', `/api/kas/opname/${o.isi.id}`);
    assert.equal(ba.status, 200, JSON.stringify(ba.isi));
    assert.ok(ba.isi.akun_kas_nama);
    assert.equal(ba.isi.terbilang_fisik, 'nol rupiah');
    if (o.isi.selisih !== 0) assert.equal(ba.isi.jurnal_nomor, o.isi.jurnal.nomor);
  });
});

describe('Bukti pembelian', () => {
  test('penerimaan parsial menghasilkan dua bukti penerimaan dengan jurnal masing-masing', async () => {
    const po = await panggil('POST', '/api/pembelian', {
      tipe: 'po', supplier_id: supplierId, gudang_id: gudangId, status: 'diajukan',
      items: [{ barang_id: barangId, qty: 5, harga: 60000 }] });
    assert.equal(po.status, 200, JSON.stringify(po.isi));
    const id = po.isi.id;

    const detail = await panggil('GET', `/api/pembelian/${id}`);
    assert.equal(detail.isi.terbilang, 'tiga ratus ribu rupiah');
    const detailId = detail.isi.detail[0].id;

    const t1 = await panggil('POST', `/api/pembelian/${id}/terima`, { items: [{ detail_id: detailId, qty: 2 }] });
    assert.equal(t1.status, 200, JSON.stringify(t1.isi));
    const t2 = await panggil('POST', `/api/pembelian/${id}/terima`, { items: [{ detail_id: detailId, qty: 3 }] });
    assert.equal(t2.status, 200, JSON.stringify(t2.isi));

    const r = await panggil('GET', `/api/pembelian/${id}/penerimaan`);
    assert.equal(r.status, 200, JSON.stringify(r.isi));
    assert.equal(r.isi.pembelian.supplier_nama, 'CV Sumber Pangan');
    assert.equal(r.isi.penerimaan.length, 2);
    assert.deepEqual(r.isi.penerimaan.map((x) => x.items[0].qty), [2, 3]);
    assert.deepEqual(r.isi.penerimaan.map((x) => x.jurnal?.id), [t1.isi.jurnal.id, t2.isi.jurnal.id]);
    assert.equal(r.isi.penerimaan[0].items[0].qty_pesan, 5);
    assert.equal(r.isi.penerimaan[0].nilai, 120000);
    assert.equal((await panggil('GET', '/api/pembelian/evaluasi/supplier')).status, 200);
  });

  test('bukti pembayaran utang memuat pihak, dokumen sumber, dan jurnal pembayaran', async () => {
    const hp = scalar("SELECT id FROM hutang_piutang WHERE jenis = 'hutang' AND supplier_id = ? ORDER BY id LIMIT 1",
      [supplierId]);
    assert.ok(hp, 'utang terbentuk dari penerimaan');
    const bayar = await panggil('POST', '/api/hutang-piutang/bayar', { id: hp, nominal: 50000 });
    assert.equal(bayar.status, 200, JSON.stringify(bayar.isi));

    const d = await panggil('GET', `/api/hutang-piutang/${hp}`);
    assert.equal(d.status, 200, JSON.stringify(d.isi));
    assert.equal(d.isi.pihak_nama, 'CV Sumber Pangan');
    assert.equal(d.isi.sumber.jenis, 'pembelian');
    assert.equal(d.isi.pembayaran.length, 1);
    assert.equal(d.isi.pembayaran[0].id, bayar.isi.jurnal.id);
    assert.equal(d.isi.pembayaran[0].nominal, 50000);
    assert.equal(d.isi.pembayaran[0].terbilang, 'lima puluh ribu rupiah');
    assert.equal(d.isi.pembayaran[0].akun.length, 2);
  });
});

describe('Bukti retur, penyesuaian stok, dan pelepasan aset', () => {
  test('dua retur sebagian menghasilkan dua bukti retur', async () => {
    const jual = await panggil('POST', '/api/pos/jual', {
      gudang_id: gudangId, metode_bayar: 'tunai', bayar: 400000,
      items: [{ barang_id: barangId, qty: 3, harga: 80000 }] });
    assert.equal(jual.status, 200, JSON.stringify(jual.isi));
    const id = jual.isi.id;
    assert.equal((await panggil('GET', `/api/penjualan/${id}`)).isi.terbilang, 'dua ratus empat puluh ribu rupiah');

    for (const qty of [1, 2]) {
      const r = await panggil('POST', '/api/pos/retur', {
        penjualan_id: id, alasan: 'Kemasan sobek', items: [{ barang_id: barangId, qty }] });
      assert.equal(r.status, 200, JSON.stringify(r.isi));
    }
    const d = await panggil('GET', `/api/penjualan/${id}/retur`);
    assert.equal(d.status, 200, JSON.stringify(d.isi));
    assert.equal(d.isi.retur.length, 2);
    assert.deepEqual(d.isi.retur.map((r) => r.items[0].qty), [1, 2]);
    assert.deepEqual(d.isi.retur.map((r) => r.nilai_retur), [80000, 160000]);
    assert.ok(d.isi.retur.every((r) => r.jurnal?.nomor));
  });

  test('bukti penyesuaian stok memuat barang, gudang, dan jurnal', async () => {
    const h = await panggil('POST', '/api/persediaan/penyesuaian', {
      barang_id: barangId, gudang_id: gudangId, jenis: 'masuk', qty: 4, harga: 60000 });
    assert.equal(h.status, 200, JSON.stringify(h.isi));
    const d = await panggil('GET', `/api/persediaan/penyesuaian/${h.isi.id}`);
    assert.equal(d.status, 200, JSON.stringify(d.isi));
    assert.equal(d.isi.kode, 'UJI-CETAK');
    assert.ok(d.isi.gudang_nama);
    assert.equal(d.isi.jurnal.nomor, h.isi.jurnal.nomor);
    assert.equal(d.isi.nilai, 240000);
    assert.equal(d.isi.jurnal.detail.length, 2);

    const bukanPenyesuaian = scalar("SELECT id FROM mutasi_stok WHERE jenis = 'masuk' ORDER BY id LIMIT 1");
    assert.equal((await panggil('GET', `/api/persediaan/penyesuaian/${bukanPenyesuaian}`)).status, 404);
  });

  test('bukti pelepasan aset hanya untuk aset yang sudah dilepas', async () => {
    const a = await panggil('POST', '/api/aset', {
      kode: 'AST-CETAK', nama: 'Laptop kasir', kategori: 'inventaris', harga_perolehan: 12000000,
      umur_manfaat: 4, sumber_perolehan: 'kas' });
    assert.equal(a.status, 200, JSON.stringify(a.isi));
    const id = a.isi.id ?? scalar("SELECT id FROM aset_tetap WHERE kode = 'AST-CETAK'");
    assert.equal((await panggil('GET', `/api/aset/${id}/pelepasan`)).status, 409);

    const lepas = await panggil('POST', `/api/aset/${id}/disposal`, { nilai_jual: 10000000 });
    assert.equal(lepas.status, 200, JSON.stringify(lepas.isi));
    const d = await panggil('GET', `/api/aset/${id}/pelepasan`);
    assert.equal(d.status, 200, JSON.stringify(d.isi));
    assert.equal(d.isi.hasil, 10000000);
    assert.equal(d.isi.laba_rugi, 10000000 - 12000000);
    assert.equal(d.isi.jurnal.nomor, lepas.isi.jurnal.nomor);
    assert.equal(d.isi.terbilang, 'sepuluh juta rupiah');
  });
});
