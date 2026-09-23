/**
 * Uji tata kelola: RAT (ubah, hapus, selesai), rencana audit, alur persetujuan,
 * persuratan, versi dokumen, dan izin pencatatan suara RAT.
 *
 * Diuji lewat HTTP sungguhan supaya pemeriksaan izin (RBAC) ikut teruji.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ECMS_DATA_DIR = mkdtempSync(join(tmpdir(), 'ecms-uji-gcg-'));
process.env.ECMS_DB = join(process.env.ECMS_DATA_DIR, 'uji.db');
process.env.HOST = '127.0.0.1';
process.env.PORT = '0';
process.env.ECMS_ADMIN_PASSWORD = 'Rahasia!2026uji';

const server = (await import('../server/index.js')).default;
const { run, get, scalar } = await import('../server/db.js');

let asal;
let kukiAdmin;

async function masuk(username, password) {
  const r = await fetch(`${asal}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  assert.ok(r.ok, `login ${username} gagal`);
  return r.headers.get('set-cookie').split(';')[0];
}

/** Memanggil API; mengembalikan { status, isi }. */
async function panggil(metode, jalur, isi, kuki = kukiAdmin) {
  const r = await fetch(`${asal}${jalur}`, {
    method: metode,
    headers: { 'Content-Type': 'application/json', Cookie: kuki },
    body: isi === undefined ? undefined : JSON.stringify(isi),
  });
  return { status: r.status, isi: await r.json().catch(() => null) };
}

before(async () => {
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  asal = `http://127.0.0.1:${server.address().port}`;
  kukiAdmin = await masuk('admin', process.env.ECMS_ADMIN_PASSWORD);
  for (let i = 1; i <= 3; i += 1) {
    run(`INSERT INTO anggota(nomor_anggota, nik, nama, cabang_id, tanggal_daftar, tanggal_gabung, status)
         VALUES(?,?,?,1,'2024-01-01','2024-01-01','aktif')`,
    [`GCG${i}`, `31710000000009${i.toString().padStart(2, '0')}`, `Anggota Uji ${i}`]);
  }
});

after(() => server.close());

describe('RAT: ubah, hapus, dan selesai', () => {
  test('RAT rencana dapat diubah dan dihapus beserta agendanya', async () => {
    const buat = await panggil('POST', '/api/rat', { tahun_buku: 2025, judul: 'RAT Uji', tanggal: '2026-03-01' });
    assert.ok(buat.status < 300);
    const id = buat.isi.id;
    assert.ok(scalar('SELECT COUNT(*) FROM rat_agenda WHERE rat_id = ?', [id]) > 0);

    const ubah = await panggil('PUT', `/api/rat/${id}`, { judul: 'RAT Uji Diubah', kuorum_persen: 60, tempat: 'Aula' });
    assert.ok(ubah.status < 300);
    assert.equal(ubah.isi.judul, 'RAT Uji Diubah');
    assert.equal(ubah.isi.kuorum_persen, 60);

    const kosong = await panggil('PUT', `/api/rat/${id}`, { judul: '' });
    assert.equal(kosong.status, 400, 'judul tidak boleh dikosongkan');

    const hapus = await panggil('DELETE', `/api/rat/${id}`);
    assert.ok(hapus.status < 300);
    assert.equal(get('SELECT id FROM rat WHERE id = ?', [id]), undefined);
    assert.equal(scalar('SELECT COUNT(*) FROM rat_agenda WHERE rat_id = ?', [id]), 0);
  });

  test('RAT yang undangannya terkirim tidak dapat dihapus; selesai mengunci perubahan', async () => {
    const { isi: r } = await panggil('POST', '/api/rat', { tahun_buku: 2025, judul: 'RAT Kedua', tanggal: '2026-03-02' });
    assert.ok((await panggil('POST', `/api/rat/${r.id}/undangan`, {})).status < 300);
    const hapus = await panggil('DELETE', `/api/rat/${r.id}`);
    assert.equal(hapus.status, 409);

    // Kuorum dihitung ulang saat syarat kuorum diubah
    const anggota = get("SELECT anggota_id FROM rat_peserta WHERE rat_id = ? LIMIT 1", [r.id]);
    assert.ok((await panggil('POST', `/api/rat/${r.id}/hadir`, { anggota_id: anggota.anggota_id })).status < 300);
    const turun = await panggil('PUT', `/api/rat/${r.id}`, { kuorum_persen: 1 });
    assert.equal(turun.isi.kuorum_tercapai, 1);

    // Voting yang masih dibuka menahan penyelesaian RAT
    const { isi: v } = await panggil('POST', `/api/rat/${r.id}/voting`, { judul: 'Pengesahan LK' });
    assert.ok((await panggil('POST', `/api/rat/voting/${v.id}/status`, { status: 'dibuka' })).status < 300);
    assert.equal((await panggil('POST', `/api/rat/${r.id}/selesai`, {})).status, 409);
    await panggil('POST', `/api/rat/voting/${v.id}/status`, { status: 'ditutup' });

    const selesai = await panggil('POST', `/api/rat/${r.id}/selesai`, { berita_acara: 'Rapat berjalan lancar' });
    assert.ok(selesai.status < 300);
    assert.equal(selesai.isi.status, 'selesai');
    assert.equal((await panggil('PUT', `/api/rat/${r.id}`, { judul: 'Tidak boleh' })).status, 409);
    assert.equal((await panggil('POST', `/api/rat/${r.id}/selesai`, {})).status, 409);
  });

  test('pencatatan suara oleh petugas memerlukan rat.update, bukan sekadar rat.view', async () => {
    const buat = await panggil('POST', '/api/admin/users', {
      username: 'pengawas.uji', nama: 'Pengawas Uji', role: 'pengawas', password: 'Rahasia!2026uji' });
    assert.ok(buat.status < 300);
    const kuki = await masuk('pengawas.uji', 'Rahasia!2026uji');
    const r = await panggil('POST', '/api/rat/voting/1/suara', { anggota_id: 1, pilihan: 'Setuju' }, kuki);
    assert.equal(r.status, 403);
    assert.match(r.isi.detail || '', /rat\.update/, 'penolakan harus karena izin rat.update');
    // Pengawas tetap dapat melihat data RAT
    assert.ok((await panggil('GET', '/api/rat', undefined, kuki)).status < 300);
  });
});

describe('Rencana audit', () => {
  test('rencana tanpa temuan dapat dihapus; yang bertemuan ditolak', async () => {
    const { isi: p1 } = await panggil('POST', '/api/audit/plan', { tahun: 2026, judul: 'Audit Kas' });
    const ubah = await panggil('PUT', `/api/audit/plan/${p1.id}`, { judul: 'Audit Kas Kecil', tahun: 2025, status: 'berjalan' });
    assert.ok(ubah.status < 300);
    assert.equal(ubah.isi.tahun, 2025);
    assert.equal((await panggil('PUT', `/api/audit/plan/${p1.id}`, { status: 'ngawur' })).status, 400);
    assert.ok((await panggil('DELETE', `/api/audit/plan/${p1.id}`)).status < 300);

    const { isi: p2 } = await panggil('POST', '/api/audit/plan', { tahun: 2026, judul: 'Audit Toko' });
    const { isi: t } = await panggil('POST', '/api/audit/temuan', { plan_id: p2.id, judul: 'Selisih stok' });
    assert.equal((await panggil('DELETE', `/api/audit/plan/${p2.id}`)).status, 409);
    assert.ok((await panggil('DELETE', `/api/audit/temuan/${t.id}`)).status < 300);
    assert.ok((await panggil('DELETE', `/api/audit/plan/${p2.id}`)).status < 300);
  });
});

describe('Alur persetujuan', () => {
  test('tahapan divalidasi dan disimpan sebagai JSON terurut', async () => {
    const salah = await panggil('POST', '/api/approval-flow', {
      modul: 'dokumen', nama: 'Alur Salah', tahapan: [{ urut: 1, role: 'bukan_peran', tipe: 'berjenjang' }] });
    assert.equal(salah.status, 400);
    const kosong = await panggil('POST', '/api/approval-flow', { modul: 'dokumen', nama: 'Kosong', tahapan: [] });
    assert.equal(kosong.status, 400);

    const ok = await panggil('POST', '/api/approval-flow', {
      modul: 'dokumen', nama: 'Dokumen Penting', batas_min: 0, batas_max: 0,
      tahapan: [
        { urut: 2, role: 'pengurus', tipe: 'parallel', sla_hari: 5 },
        { urut: 1, role: 'manajer_unit', tipe: 'berjenjang', sla_hari: 2 },
        { urut: 2, role: 'pengawas', tipe: 'parallel', sla_hari: 5 },
      ] });
    assert.ok(ok.status < 300);
    const t = JSON.parse(ok.isi.tahapan);
    assert.deepEqual(t.map((x) => x.urut), [1, 2, 2]);

    const ubah = await panggil('PUT', `/api/approval-flow/${ok.isi.id}`, { status: 'nonaktif' });
    assert.ok(ubah.status < 300);
    assert.ok((await panggil('DELETE', `/api/approval-flow/${ok.isi.id}`)).status < 300);
  });
});

describe('Persuratan & dokumen', () => {
  test('surat dapat diubah dan dihapus; kolom wajib tidak boleh dikosongkan', async () => {
    const { isi: s } = await panggil('POST', '/api/surat',
      { nomor: '01/UJI', jenis: 'masuk', tanggal: '2026-01-05', perihal: 'Uji' });
    assert.equal((await panggil('PUT', `/api/surat/${s.id}`, { perihal: '' })).status, 400);
    assert.equal((await panggil('PUT', `/api/surat/${s.id}`, { jenis: 'lain' })).status, 400);
    const ubah = await panggil('PUT', `/api/surat/${s.id}`, { perihal: 'Uji diubah', status: 'selesai' });
    assert.equal(ubah.isi.perihal, 'Uji diubah');
    assert.ok((await panggil('DELETE', `/api/surat/${s.id}`)).status < 300);
  });

  test('versi baru melepas tanda tangan versi lama', async () => {
    const b64 = (t) => `data:text/plain;base64,${Buffer.from(t).toString('base64')}`;
    const { isi: d } = await panggil('POST', '/api/dokumen', {
      judul: 'SOP Kas', kategori: 'sop', file_data: b64('versi satu'), file_nama: 'sop.txt', file_mime: 'text/plain' });
    assert.ok((await panggil('POST', `/api/dokumen/${d.id}/tandatangani`, {})).status < 300);
    const sama = await panggil('POST', `/api/dokumen/${d.id}/versi`, { file_data: b64('versi satu') });
    assert.equal(sama.status, 409);
    const v2 = await panggil('POST', `/api/dokumen/${d.id}/versi`,
      { file_data: b64('versi dua'), file_nama: 'sop-v2.txt', file_mime: 'text/plain', catatan: 'Revisi' });
    assert.ok(v2.status < 300);
    assert.equal(v2.isi.versi, 2);
    const detail = await panggil('GET', `/api/dokumen/${d.id}`);
    assert.equal(detail.isi.ttd_elektronik, null);
    assert.equal(detail.isi.status, 'review');
    assert.equal(detail.isi.versi_riwayat.length, 2);
    assert.match(detail.isi.isi_teks, /versi dua/);
  });
});
