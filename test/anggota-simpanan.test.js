/**
 * Uji rute keanggotaan & pinjaman lewat HTTP: ubah ahli waris dan
 * pembatalan pengajuan pinjaman yang belum dicairkan.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ECMS_DATA_DIR = mkdtempSync(join(tmpdir(), 'ecms-uji-agt-'));
process.env.ECMS_DB = join(process.env.ECMS_DATA_DIR, 'uji.db');
process.env.HOST = '127.0.0.1';
process.env.PORT = '0';
process.env.ECMS_ADMIN_PASSWORD = 'Rahasia!2026uji';

const server = (await import('../server/index.js')).default;
const { run, get, scalar } = await import('../server/db.js');

let asal;
let kuki;
let anggotaId;

before(async () => {
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  asal = `http://127.0.0.1:${server.address().port}`;
  const r = await fetch(`${asal}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'Rahasia!2026uji' }),
  });
  assert.ok(r.ok, `login gagal (${r.status})`);
  kuki = r.headers.get('set-cookie').split(';')[0];
  anggotaId = run(
    `INSERT INTO anggota(nomor_anggota, nik, nama, penghasilan, cabang_id, tanggal_daftar,
       tanggal_gabung, status)
     VALUES('A9001','3171000000009001','Sari Uji',8000000,1,'2024-01-01','2024-01-01','aktif')`,
  ).lastInsertRowid;
});

after(() => server.close());

async function panggil(metode, path, data) {
  const r = await fetch(`${asal}${path}`, {
    method: metode,
    headers: { Cookie: kuki, ...(data ? { 'Content-Type': 'application/json' } : {}) },
    body: data ? JSON.stringify(data) : undefined,
  });
  let isi = null;
  try { isi = await r.json(); } catch { /* kosong */ }
  // 201 (dibuat) disamakan dengan 200 agar pemeriksaan cukup membedakan sukses/gagal
  return { status: r.status === 201 ? 200 : r.status, isi };
}

describe('Ahli waris', () => {
  let w1;

  test('menambah dua ahli waris', async () => {
    const a = await panggil('POST', `/api/anggota/${anggotaId}/ahli-waris`,
      { nama: 'Andi', hubungan: 'anak', persentase: 60 });
    assert.equal(a.status, 200);
    w1 = a.isi.id;
    const b = await panggil('POST', `/api/anggota/${anggotaId}/ahli-waris`,
      { nama: 'Rina', hubungan: 'istri', persentase: 30 });
    assert.equal(b.status, 200);
  });

  test('ubah ahli waris menghitung total tanpa baris yang diubah', async () => {
    const r = await panggil('PUT', `/api/anggota/ahli-waris/${w1}`,
      { nama: 'Andi Pratama', hubungan: 'anak', telepon: '0812', persentase: 70 });
    assert.equal(r.status, 200);
    assert.equal(r.isi.nama, 'Andi Pratama');
    assert.equal(r.isi.persentase, 70);
    assert.equal(r.isi.telepon, '0812');
    const log = get("SELECT * FROM audit_log WHERE modul = 'anggota' AND aksi = 'update' AND keterangan LIKE '%Andi Pratama%'");
    assert.ok(log, 'perubahan ahli waris harus tercatat di audit log');
  });

  test('ubah ahli waris menolak total di atas 100%', async () => {
    const r = await panggil('PUT', `/api/anggota/ahli-waris/${w1}`, { nama: 'Andi', persentase: 80 });
    assert.equal(r.status, 400);
    assert.match(r.isi.pesan, /100%/);
  });

  test('ubah ahli waris memvalidasi nama & keberadaan', async () => {
    assert.equal((await panggil('PUT', `/api/anggota/ahli-waris/${w1}`, { nama: '', persentase: 10 })).status, 400);
    assert.equal((await panggil('PUT', '/api/anggota/ahli-waris/999999', { nama: 'X' })).status, 404);
  });
});

describe('Pembatalan pengajuan pinjaman', () => {
  const produkId = () => get("SELECT id FROM produk_pinjaman WHERE kode = 'PK'").id;

  test('pengajuan berstatus diajukan dapat dibatalkan dan approval ikut ditutup', async () => {
    const aj = await panggil('POST', '/api/pinjaman', { anggota_id: anggotaId, produk_id: produkId(),
      pokok: 3_000_000, tenor: 6, tujuan: 'uji batal' });
    assert.equal(aj.status, 200, JSON.stringify(aj.isi));
    const id = aj.isi.id;
    assert.ok(aj.isi.approval, 'alur persetujuan pinjaman tersedia dari data awal');

    const tanpaAlasan = await panggil('POST', `/api/pinjaman/${id}/batal`, {});
    assert.equal(tanpaAlasan.status, 400);

    const b = await panggil('POST', `/api/pinjaman/${id}/batal`, { alasan: 'Anggota mengurungkan niat' });
    assert.equal(b.status, 200, JSON.stringify(b.isi));
    assert.equal(b.isi.status, 'batal');
    assert.match(b.isi.alasan_tolak, /mengurungkan/);
    assert.equal(b.isi.approval_ditutup, 1);
    assert.equal(scalar("SELECT status FROM approval_request WHERE modul = 'pinjaman' AND entitas_id = ?", [id]), 'dibatalkan');
    assert.equal(scalar("SELECT COUNT(*) FROM approval_step s JOIN approval_request r ON r.id = s.request_id WHERE r.entitas_id = ? AND r.modul = 'pinjaman' AND s.status = 'menunggu'", [id]), 0);
    assert.equal(scalar('SELECT COUNT(*) FROM jurnal WHERE referensi = ?', [`pinjaman:${id}`]), 0,
      'pembatalan sebelum pencairan tidak membentuk jurnal');
    assert.ok(get("SELECT id FROM audit_log WHERE modul = 'pinjaman' AND aksi = 'void' AND CAST(entitas_id AS TEXT) = ?",
      [String(id)]), 'pembatalan harus tercatat di audit log');

    const lagi = await panggil('POST', `/api/pinjaman/${id}/batal`, { alasan: 'dua kali' });
    assert.equal(lagi.status, 409);
  });

  test('pengajuan disetujui masih dapat dibatalkan, yang sudah cair tidak', async () => {
    const aj = await panggil('POST', '/api/pinjaman', { anggota_id: anggotaId, produk_id: produkId(),
      pokok: 2_000_000, tenor: 6 });
    const id = aj.isi.id;
    assert.equal((await panggil('POST', `/api/pinjaman/${id}/putuskan`, { setuju: true })).status, 200);
    const b = await panggil('POST', `/api/pinjaman/${id}/batal`, { alasan: 'Batal setelah disetujui' });
    assert.equal(b.status, 200);
    assert.equal(b.isi.status, 'batal');

    const aj2 = await panggil('POST', '/api/pinjaman', { anggota_id: anggotaId, produk_id: produkId(),
      pokok: 2_000_000, tenor: 6 });
    const id2 = aj2.isi.id;
    await panggil('POST', `/api/pinjaman/${id2}/putuskan`, { setuju: true });
    const cair = await panggil('POST', `/api/pinjaman/${id2}/cairkan`, { metode: 'tunai' });
    assert.equal(cair.status, 200, JSON.stringify(cair.isi));
    const tolak = await panggil('POST', `/api/pinjaman/${id2}/batal`, { alasan: 'terlambat' });
    assert.equal(tolak.status, 409);
    assert.equal(get('SELECT status FROM pinjaman WHERE id = ?', [id2]).status, 'dicairkan');
  });

  test('pinjaman batal tidak dihitung sebagai pinjaman aktif', async () => {
    const aktif = scalar(
      "SELECT COUNT(*) FROM pinjaman WHERE anggota_id = ? AND status IN ('dicairkan','disetujui','restrukturisasi')",
      [anggotaId]);
    assert.equal(aktif, 1, 'hanya pinjaman yang dicairkan yang tersisa');
  });
});
