/**
 * Uji alur keuangan lewat HTTP: revisi/penolakan anggaran (RKAP), asal jurnal
 * (sumber) pada daftar & detail jurnal, dan pembatalan bukti kas.
 *
 * Kode akun tidak ditanam: akun diambil dari bagan akun menurut tipe/penanda.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ECMS_DATA_DIR = mkdtempSync(join(tmpdir(), 'ecms-uji-keuangan-'));
process.env.ECMS_DB = join(process.env.ECMS_DATA_DIR, 'uji.db');
process.env.HOST = '127.0.0.1';
process.env.PORT = '0';
process.env.ECMS_ADMIN_PASSWORD = 'Rahasia!2026keu';

const server = (await import('../server/index.js')).default;

let asal;
let cookie;
let akunBeban;
let akunPendapatan;
let akunKas;

async function panggil(metode, path, data) {
  const res = await fetch(`${asal}${path}`, {
    method: metode,
    headers: { cookie, ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: data !== undefined ? JSON.stringify(data) : undefined,
  });
  let isi = null;
  try { isi = await res.json(); } catch { /* kosong */ }
  return { status: res.status, isi };
}

/** Respons 2xx (POST membuat data menjawab 201). */
const sukses = (r) => assert.ok(r.status >= 200 && r.status < 300, `status ${r.status}: ${r.isi?.pesan || ''}`);

before(async () => {
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  asal = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${asal}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: process.env.ECMS_ADMIN_PASSWORD }),
  });
  assert.ok(res.ok, 'admin dapat masuk');
  cookie = res.headers.get('set-cookie').split(';')[0];
  const coa = (await panggil('GET', '/api/master/coa')).isi.data
    .filter((c) => c.is_postable && c.status === 'aktif');
  akunBeban = coa.filter((c) => c.tipe === 'beban').map((c) => c.kode);
  akunPendapatan = coa.find((c) => c.tipe === 'pendapatan').kode;
  akunKas = coa.find((c) => c.is_kas).kode;
  assert.ok(akunBeban.length >= 2 && akunPendapatan && akunKas, 'bagan akun contoh tersedia');
});

after(() => server.close());

describe('Anggaran: revisi, penolakan, dan penghapusan', () => {
  const rkap = () => ({
    tahun: 2027, nama: 'RKAP Uji',
    detail: [{ coa_kode: akunBeban[0], nominal: 1_000_000 }, { coa_kode: akunPendapatan, nominal: 5_000_000 }],
  });

  test('anggaran draft dapat direvisi; rincian diganti seluruhnya', async () => {
    const a = (await panggil('POST', '/api/anggaran', rkap())).isi;
    const r = await panggil('PUT', `/api/anggaran/${a.id}`, {
      ...rkap(), nama: 'RKAP Uji Revisi', detail: [{ coa_kode: akunBeban[1], bulan: 3, nominal: 750_000 }],
    });
    sukses(r);
    assert.equal(r.isi.nama, 'RKAP Uji Revisi');
    const d = (await panggil('GET', `/api/anggaran/${a.id}`)).isi;
    assert.equal(d.detail.length, 1);
    assert.equal(d.detail[0].coa_kode, akunBeban[1]);
    assert.equal(d.detail[0].bulan, 3);
    assert.equal(d.total, 750_000);
  });

  test('revisi divalidasi seperti penyusunan baru', async () => {
    const a = (await panggil('POST', '/api/anggaran', rkap())).isi;
    assert.equal((await panggil('PUT', `/api/anggaran/${a.id}`, { ...rkap(), detail: [] })).status, 400);
    const salah = await panggil('PUT', `/api/anggaran/${a.id}`, { ...rkap(), detail: [{ coa_kode: 'TIDAK-ADA', nominal: 1 }] });
    assert.equal(salah.status, 400);
    // Rincian lama tidak ikut terhapus oleh revisi yang gagal.
    assert.equal((await panggil('GET', `/api/anggaran/${a.id}`)).isi.detail.length, 2);
  });

  test('tolak menyimpan catatan revisi; revisi mengembalikan status ke draft', async () => {
    const a = (await panggil('POST', '/api/anggaran', rkap())).isi;
    assert.equal((await panggil('POST', `/api/anggaran/${a.id}/tolak`, {})).status, 400, 'catatan wajib');
    const t = await panggil('POST', `/api/anggaran/${a.id}/tolak`, { catatan: 'Beban terlalu besar' });
    sukses(t);
    assert.equal(t.isi.status, 'ditolak');
    assert.equal(t.isi.catatan_revisi, 'Beban terlalu besar');
    assert.equal((await panggil('POST', `/api/anggaran/${a.id}/tolak`, { catatan: 'lagi' })).status, 409);

    const r = await panggil('PUT', `/api/anggaran/${a.id}`, rkap());
    sukses(r);
    assert.equal(r.isi.status, 'draft');
  });

  test('anggaran yang sudah disetujui terkunci', async () => {
    const a = (await panggil('POST', '/api/anggaran', rkap())).isi;
    sukses(await panggil('POST', `/api/anggaran/${a.id}/setujui`, {}));
    assert.equal((await panggil('PUT', `/api/anggaran/${a.id}`, rkap())).status, 409);
    assert.equal((await panggil('DELETE', `/api/anggaran/${a.id}`)).status, 409);
    assert.equal((await panggil('POST', `/api/anggaran/${a.id}/tolak`, { catatan: 'x' })).status, 409);
  });

  test('hapus anggaran draft beserta rinciannya', async () => {
    const a = (await panggil('POST', '/api/anggaran', rkap())).isi;
    const h = await panggil('DELETE', `/api/anggaran/${a.id}`);
    sukses(h);
    assert.equal((await panggil('GET', `/api/anggaran/${a.id}`)).status, 404);
  });
});

describe('Asal jurnal dan pembatalan bukti kas', () => {
  test('jurnal bukti kas bersumber sistem dan tidak dapat dibatalkan dari buku besar', async () => {
    const k = await panggil('POST', '/api/kas', {
      jenis: 'kas_masuk', nominal: 250_000, coa_kas: akunKas, coa_lawan: akunPendapatan, keterangan: 'Uji kas',
    });
    sukses(k);
    const j = (await panggil('GET', `/api/akuntansi/jurnal/${k.isi.jurnal.id}`)).isi;
    assert.equal(j.sumber, 'sistem');
    assert.equal(j.dapat_dibatalkan, false);
    assert.equal((await panggil('POST', `/api/akuntansi/jurnal/${j.id}/batal`, { alasan: 'uji' })).status, 409);

    const daftar = (await panggil('GET', '/api/akuntansi/jurnal?limit=500')).isi.data;
    assert.ok(daftar.every((x) => ['manual', 'recurring', 'sistem'].includes(x.sumber)), 'setiap jurnal punya sumber');

    const sebelum = (await panggil('GET', '/api/kas')).isi.total_masuk;
    const b = await panggil('POST', `/api/kas/${k.isi.id}/batal`, { alasan: 'Salah input' });
    sukses(b);
    assert.equal(b.isi.status, 'batal');
    const sesudah = (await panggil('GET', '/api/kas')).isi;
    assert.equal(sesudah.total_masuk, sebelum - 250_000, 'bukti batal tidak dihitung dalam total');
    assert.equal(sesudah.data.find((x) => x.id === k.isi.id).alasan_batal, 'Salah input');
  });

  test('jurnal manual dapat dibatalkan dari buku besar', async () => {
    const j = await panggil('POST', '/api/akuntansi/jurnal', {
      keterangan: 'Uji manual',
      lines: [{ coa_kode: akunBeban[0], debit: 10_000 }, { coa_kode: akunKas, kredit: 10_000 }],
    });
    sukses(j);
    const d = (await panggil('GET', `/api/akuntansi/jurnal/${j.isi.id}`)).isi;
    assert.equal(d.sumber, 'manual');
    assert.equal(d.dapat_dibatalkan, true);
    sukses(await panggil('POST', `/api/akuntansi/jurnal/${j.isi.id}/batal`, { alasan: 'uji' }));
    assert.equal((await panggil('GET', `/api/akuntansi/jurnal/${j.isi.id}`)).isi.dapat_dibatalkan, false);
  });
});
