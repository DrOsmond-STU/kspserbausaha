/**
 * Uji Pusat Laporan & Setup Koperasi: katalog menurut izin, validasi filter,
 * unduhan Excel/Word, profil & logo koperasi, aktivasi, dan tanda tangan
 * cetakan (termasuk data cetak yang dipakai seluruh bukti transaksi).
 *
 * Diuji lewat HTTP sungguhan supaya pemeriksaan izin (RBAC) ikut teruji.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ECMS_DATA_DIR = mkdtempSync(join(tmpdir(), 'ecms-uji-laporan-'));
process.env.ECMS_DB = join(process.env.ECMS_DATA_DIR, 'uji.db');
process.env.HOST = '127.0.0.1';
process.env.PORT = '0';
process.env.ECMS_ADMIN_PASSWORD = 'Rahasia!2026uji';

const server = (await import('../server/index.js')).default;
const { run } = await import('../server/db.js');

const SANDI = 'Rahasia!2026uji';
// PNG 1x1 piksel yang sah
const LOGO_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

let asal;
let kukiAdmin;
let kukiGudang;
let kukiPengawas;

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

/** Mengunduh berkas mentah; mengembalikan { status, jenis, disposisi, buf }. */
async function unduh(jalur, kuki = kukiAdmin) {
  const r = await fetch(`${asal}${jalur}`, { headers: { Cookie: kuki } });
  return { status: r.status, jenis: r.headers.get('content-type'), disposisi: r.headers.get('content-disposition'),
    buf: Buffer.from(await r.arrayBuffer()) };
}

before(async () => {
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  asal = `http://127.0.0.1:${server.address().port}`;
  kukiAdmin = await masuk('admin', SANDI);
  for (const [username, role] of [['gudang.lap', 'staf_gudang'], ['pengawas.lap', 'pengawas']]) {
    const r = await panggil('POST', '/api/admin/users', { username, nama: `Uji ${role}`, role, password: SANDI });
    assert.ok(r.status < 300, `buat pengguna ${username}`);
  }
  kukiGudang = await masuk('gudang.lap', SANDI);
  kukiPengawas = await masuk('pengawas.lap', SANDI);
  for (let i = 1; i <= 4; i += 1) {
    run(`INSERT INTO anggota(nomor_anggota, nik, nama, cabang_id, tanggal_daftar, tanggal_gabung, status)
         VALUES(?,?,?,1,?,?,'aktif')`,
    [`LAP${i}`, `31710000000077${String(i).padStart(2, '0')}`, `Anggota Laporan ${i}`, `2025-0${i}-10`, `2025-0${i}-10`]);
  }
});

after(() => server.close());

describe('Katalog & hak akses laporan', () => {
  test('katalog disaring menurut izin; laporan tanpa izin ditolak 403', async () => {
    const admin = await panggil('GET', '/api/pusat-laporan');
    assert.equal(admin.status, 200);
    assert.ok(Array.isArray(admin.isi.kelompok) && admin.isi.kelompok.length > 0);
    const daftar = admin.isi.data.find((l) => l.kode === 'daftar-anggota');
    assert.ok(daftar, 'admin melihat laporan daftar anggota');
    assert.ok(daftar.filter.some((f) => f.kunci === 'dari' && f.tipe === 'tanggal'), 'spesifikasi filter ikut dikirim');
    assert.ok(daftar.filter.find((f) => f.kunci === 'status').opsi.length > 0, 'filter pilihan membawa opsi');

    // Staf gudang tidak memiliki anggota.view
    const gudang = await panggil('GET', '/api/pusat-laporan', undefined, kukiGudang);
    assert.equal(gudang.status, 200);
    assert.ok(!gudang.isi.data.some((l) => l.kode === 'daftar-anggota'));
    assert.ok(gudang.isi.data.length < admin.isi.data.length);
    assert.equal((await panggil('GET', '/api/pusat-laporan/daftar-anggota', undefined, kukiGudang)).status, 403);
    assert.equal((await unduh('/api/pusat-laporan/daftar-anggota/unduh?format=xlsx', kukiGudang)).status, 403);

    assert.equal((await panggil('GET', '/api/pusat-laporan/tidak-ada')).status, 404);
  });

  test('laporan tersusun sebagai model dokumen yang siap cetak', async () => {
    const r = await panggil('GET', '/api/pusat-laporan/daftar-anggota?dari=2025-02-01&sampai=2025-03-31&status=aktif');
    assert.equal(r.status, 200);
    assert.equal(r.isi.judul, 'Daftar Anggota');
    assert.equal(r.isi.jenis_ttd, 'laporan');
    const baris = r.isi.bagian[0].baris;
    assert.deepEqual(baris.map((b) => b.nomor_anggota).sort(), ['LAP2', 'LAP3']);
    assert.ok(r.isi.keterangan.some((k) => /Status: aktif/.test(k)), 'filter aktif dicantumkan pada keterangan');
  });
});

describe('Validasi filter', () => {
  test('tanggal tidak sah, rentang terbalik, dan pilihan tak dikenal ditolak 400', async () => {
    assert.equal((await panggil('GET', '/api/pusat-laporan/daftar-anggota?dari=2025-13')).status, 400);
    assert.equal((await panggil('GET', '/api/pusat-laporan/daftar-anggota?dari=kemarin')).status, 400);
    const terbalik = await panggil('GET', '/api/pusat-laporan/daftar-anggota?dari=2025-06-01&sampai=2025-01-01');
    assert.equal(terbalik.status, 400);
    assert.match(terbalik.isi.pesan, /awal/i);
    assert.equal((await panggil('GET', '/api/pusat-laporan/daftar-anggota?status=entah')).status, 400);
    assert.equal((await unduh('/api/pusat-laporan/daftar-anggota/unduh?format=pdf')).status, 400);
  });
});

describe('Unduhan Excel & Word', () => {
  for (const [format, jenis] of [['xlsx', /spreadsheetml/], ['docx', /wordprocessingml/]]) {
    test(`${format}: jenis konten benar dan berkas berupa arsip ZIP`, async () => {
      const r = await unduh(`/api/pusat-laporan/daftar-anggota/unduh?format=${format}&dari=2025-01-01`);
      assert.equal(r.status, 200);
      assert.match(r.jenis, jenis);
      assert.match(r.disposisi, new RegExp(`attachment; filename=".+\\.${format}"`));
      assert.equal(r.buf.subarray(0, 2).toString('latin1'), 'PK');
      assert.ok(r.buf.length > 500);
    });
  }

  test('ekspor model dokumen dari layar (POST /api/cetak/ekspor)', async () => {
    const r = await fetch(`${asal}/api/cetak/ekspor`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: kukiGudang },
      body: JSON.stringify({ format: 'docx', dokumen: { judul: 'Bukti Uji', jenis_ttd: 'bukti_kas_keluar',
        bagian: [{ kolom: [{ kunci: 'a', label: 'A' }], baris: [{ a: 'x' }] }] } }),
    });
    assert.equal(r.status, 200);
    assert.equal(Buffer.from(await r.arrayBuffer()).subarray(0, 2).toString('latin1'), 'PK');
  });
});

describe('Setup Koperasi', () => {
  test('profil & logo: validasi, penyimpanan, dan tampil pada data cetak', async () => {
    assert.equal((await panggil('PUT', '/api/setup/koperasi', { nama: '' })).status, 400, 'nama wajib');
    const bukanGambar = await panggil('PUT', '/api/setup/koperasi', { logo: 'data:text/html;base64,PGgxPng8L2gxPg==' });
    assert.equal(bukanGambar.status, 400);
    assert.match(bukanGambar.isi.pesan, /PNG|JPEG/);
    assert.equal((await panggil('PUT', '/api/setup/koperasi', { logo: 'data:image/svg+xml;base64,PHN2Zy8+' })).status, 400);
    const besar = `data:image/png;base64,${'A'.repeat(800 * 1024)}`;
    assert.equal((await panggil('PUT', '/api/setup/koperasi', { logo: besar })).status, 400, 'logo di atas 512 KB ditolak');

    const simpan = await panggil('PUT', '/api/setup/koperasi', {
      nama: 'KSU Uji Laporan', kota: 'Bandung', ketua: 'Ketua Uji', bendahara: 'Bendahara Uji', logo: LOGO_PNG });
    assert.equal(simpan.status, 200);
    assert.equal(simpan.isi.profil.nama, 'KSU Uji Laporan');
    assert.equal(simpan.isi.profil.logo, LOGO_PNG);

    // Profil cetak dapat dibaca pengguna mana pun yang sudah masuk
    const cetak = await panggil('GET', '/api/cetak/profil', undefined, kukiGudang);
    assert.equal(cetak.status, 200);
    assert.equal(cetak.isi.profil.nama, 'KSU Uji Laporan');
    assert.equal(cetak.isi.profil.logo, LOGO_PNG);
    assert.ok(cetak.isi.ttd.default && cetak.isi.ttd.laporan);

    // Logo dapat dihapus tanpa mengubah isian lain
    const hapus = await panggil('PUT', '/api/setup/koperasi', { logo: '' });
    assert.equal(hapus.isi.profil.logo, '');
    assert.equal(hapus.isi.profil.nama, 'KSU Uji Laporan');
  });

  test('hak akses: pengawas hanya dapat melihat; staf gudang tidak dapat membuka', async () => {
    assert.equal((await panggil('GET', '/api/setup/koperasi', undefined, kukiPengawas)).status, 200);
    assert.equal((await panggil('PUT', '/api/setup/koperasi', { nama: 'X' }, kukiPengawas)).status, 403);
    assert.equal((await panggil('PUT', '/api/setup/aktivasi', { nomor: 'ABCDEFGH-1' }, kukiPengawas)).status, 403);
    assert.equal((await panggil('GET', '/api/setup/koperasi', undefined, kukiGudang)).status, 403);
    assert.equal((await panggil('GET', '/api/setup/tanda-tangan', undefined, kukiGudang)).status, 403);
  });

  test('aktivasi: validasi nomor & tanggal, status aktif / kedaluwarsa / belum', async () => {
    assert.equal((await panggil('PUT', '/api/setup/aktivasi', { nomor: 'abc' })).status, 400);
    assert.equal((await panggil('PUT', '/api/setup/aktivasi', { nomor: 'KSU 2026 0001' })).status, 400);
    assert.equal((await panggil('PUT', '/api/setup/aktivasi', { nomor: 'KSU-2026-0001', berlaku_sampai: '31-12-2030' })).status, 400);

    const aktif = await panggil('PUT', '/api/setup/aktivasi', { nomor: 'KSU-2026-0001', atas_nama: 'KSU Uji', berlaku_sampai: '2099-12-31' });
    assert.equal(aktif.status, 200);
    assert.equal(aktif.isi.status, 'aktif');
    assert.match(aktif.isi.tanggal, /^\d{4}-\d{2}-\d{2}$/);

    const lewat = await panggil('PUT', '/api/setup/aktivasi', { nomor: 'KSU-2026-0001', berlaku_sampai: '2020-01-01' });
    assert.equal(lewat.isi.status, 'kedaluwarsa');
    assert.equal(lewat.isi.tanggal, aktif.isi.tanggal, 'tanggal aktivasi tetap bila nomor tidak berganti');
    assert.equal((await panggil('GET', '/api/cetak/profil')).isi.aktivasi.status, 'kedaluwarsa');

    const kosong = await panggil('PUT', '/api/setup/aktivasi', { nomor: '' });
    assert.equal(kosong.isi.status, 'belum');
  });

  test('tanda tangan: simpan, tercermin pada data cetak, lalu kembali ke bawaan', async () => {
    const awal = await panggil('GET', '/api/setup/tanda-tangan');
    assert.equal(awal.status, 200);
    assert.ok(awal.isi.sumber_nama.some((s) => s.kunci === 'ketua'));
    const bawaan = awal.isi.data.find((j) => j.kode === 'bukti_kas_keluar');
    assert.equal(bawaan.diatur, 0);

    // Validasi
    const tujuh = Array.from({ length: 7 }, (_, i) => ({ label: `K${i}` }));
    assert.equal((await panggil('PUT', '/api/setup/tanda-tangan/bukti_kas_keluar', { penanda: tujuh })).status, 400);
    assert.equal((await panggil('PUT', '/api/setup/tanda-tangan/bukti_kas_keluar', { penanda: [{ nama: 'Tanpa label' }] })).status, 400);
    assert.equal((await panggil('PUT', '/api/setup/tanda-tangan/tidak_dikenal', { penanda: [] })).status, 404);
    assert.equal((await panggil('PUT', '/api/setup/tanda-tangan/bukti_kas_keluar', { penanda: [] }, kukiPengawas)).status, 403);

    const simpan = await panggil('PUT', '/api/setup/tanda-tangan/bukti_kas_keluar', {
      tampil_tanggal: false,
      penanda: [
        { label: 'Dibuat oleh', jabatan: 'Kasir', pengguna: true },
        { label: 'Mengetahui', jabatan: 'Ketua Pengurus', sumber: 'ketua' },
        { label: 'Penerima', jabatan: 'Penerima', nama: 'Nama Tetap' },
      ],
    });
    assert.equal(simpan.status, 200);

    const daftar = await panggil('GET', '/api/setup/tanda-tangan');
    const diatur = daftar.isi.data.find((j) => j.kode === 'bukti_kas_keluar');
    assert.equal(diatur.diatur, 1);
    assert.equal(diatur.penanda.length, 3);

    // Nama pengguna pencetak mengikuti pengguna yang meminta data cetak
    const cetakAdmin = (await panggil('GET', '/api/cetak/profil')).isi.ttd.bukti_kas_keluar;
    assert.equal(cetakAdmin.kota_tanggal, null, 'kota & tanggal disembunyikan');
    assert.deepEqual(cetakAdmin.penanda.map((p) => p.jabatan), ['Kasir', 'Ketua Pengurus', 'Penerima']);
    assert.equal(cetakAdmin.penanda[1].nama, 'Ketua Uji');
    assert.equal(cetakAdmin.penanda[2].nama, 'Nama Tetap');
    const cetakGudang = (await panggil('GET', '/api/cetak/profil', undefined, kukiGudang)).isi.ttd.bukti_kas_keluar;
    assert.equal(cetakGudang.penanda[0].nama, 'Uji staf_gudang');
    assert.notEqual(cetakAdmin.penanda[0].nama, cetakGudang.penanda[0].nama);

    // Kembali ke bawaan
    const reset = await panggil('DELETE', '/api/setup/tanda-tangan/bukti_kas_keluar');
    assert.equal(reset.status, 200);
    assert.deepEqual(reset.isi.penanda, bawaan.penanda);
    const cetakBawaan = (await panggil('GET', '/api/cetak/profil')).isi.ttd.bukti_kas_keluar;
    assert.equal(cetakBawaan.penanda.length, bawaan.penanda.length);
    assert.match(cetakBawaan.kota_tanggal, /^Bandung, /);
    assert.equal((await panggil('GET', '/api/setup/tanda-tangan')).isi.data.find((j) => j.kode === 'bukti_kas_keluar').diatur, 0);
  });

  test('pengaturan umum administrator tidak lagi memuat profil, aktivasi, dan tanda tangan', async () => {
    await panggil('PUT', '/api/setup/tanda-tangan/laporan', { penanda: [{ label: 'Disiapkan oleh', jabatan: 'Bendahara' }] });
    await panggil('PUT', '/api/setup/aktivasi', { nomor: 'KSU-2026-0002' });
    const r = await panggil('GET', '/api/admin/settings');
    assert.equal(r.status, 200);
    const kunci = r.isi.data.map((s) => s.key);
    assert.ok(kunci.length > 0);
    assert.ok(!kunci.some((k) => /^(koperasi|ttd|aktivasi)\./.test(k)), `kunci bocor: ${kunci.filter((k) => /^(koperasi|ttd|aktivasi)\./.test(k))}`);
    assert.equal((await panggil('GET', '/api/admin/settings?prefix=koperasi.')).isi.data.length, 0);
    await panggil('DELETE', '/api/setup/tanda-tangan/laporan');
  });
});
