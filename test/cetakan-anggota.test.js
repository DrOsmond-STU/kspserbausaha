/**
 * Uji data cetakan modul keanggotaan, simpanan, pinjaman, RAT, dan portal:
 * rincian bukti setoran/penarikan, buku tabungan, bukti angsuran, bukti
 * keluar anggota, serta akses portal anggota ke kop & bukti miliknya sendiri
 * (dan penolakan atas bukti milik anggota lain).
 *
 * Diuji lewat HTTP sungguhan supaya pemeriksaan izin (RBAC) ikut teruji.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ECMS_DATA_DIR = mkdtempSync(join(tmpdir(), 'ecms-uji-cetak-agt-'));
process.env.ECMS_DB = join(process.env.ECMS_DATA_DIR, 'uji.db');
process.env.HOST = '127.0.0.1';
process.env.PORT = '0';
process.env.ECMS_ADMIN_PASSWORD = 'Rahasia!2026uji';

const server = (await import('../server/index.js')).default;
const { run, get } = await import('../server/db.js');
const { hashPassword } = await import('../server/lib/auth.js');
const loans = await import('../server/services/loans.js');

const SANDI = 'Rahasia!2026uji';
const ctx = { user: { username: 'admin', nama: 'Administrator', role: 'super_admin' } };

let asal;
let kukiAdmin;
let kukiAnggota;
let anggotaA;
let anggotaB;
let rekA;
let rekB;

async function masuk(username, password) {
  const r = await fetch(`${asal}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  assert.ok(r.ok, `login ${username} gagal`);
  return r.headers.get('set-cookie').split(';')[0];
}

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
  kukiAdmin = await masuk('admin', SANDI);
  const buat = (no, nik, nama) => run(
    `INSERT INTO anggota(nomor_anggota, nik, nama, penghasilan, cabang_id, tanggal_daftar, tanggal_gabung, status)
     VALUES(?,?,?,8000000,1,'2023-01-01','2023-01-01','aktif')`, [no, nik, nama]).lastInsertRowid;
  anggotaA = buat('CTK1', '3171000000008801', 'Siti Cetak');
  anggotaB = buat('CTK2', '3171000000008802', 'Joko Lain');
  const sukarela = get("SELECT id FROM produk_simpanan WHERE jenis = 'sukarela'").id;
  rekA = (await panggil('POST', '/api/simpanan/rekening', { anggota_id: anggotaA, produk_id: sukarela })).isi.id;
  rekB = (await panggil('POST', '/api/simpanan/rekening', { anggota_id: anggotaB, produk_id: sukarela })).isi.id;
  const { hash, salt } = hashPassword(SANDI);
  run(`INSERT INTO users(username, nama, password_hash, password_salt, role, anggota_id)
       VALUES('siti.portal','Siti Cetak',?,?,'anggota',?)`, [hash, salt, anggotaA]);
  kukiAnggota = await masuk('siti.portal', SANDI);
});

after(() => server.close());

describe('Bukti simpanan', () => {
  test('rincian setoran memuat anggota, produk, saldo akhir, terbilang, dan petugas', async () => {
    const s = await panggil('POST', '/api/simpanan/setoran', { rekening_id: rekA, nominal: 1_250_000, metode: 'tunai' });
    assert.equal(s.status, 201);
    const t = await panggil('GET', `/api/simpanan/transaksi/${s.isi.id}`);
    assert.equal(t.status, 200);
    assert.equal(t.isi.nomor, s.isi.nomor);
    assert.equal(t.isi.anggota_nama, 'Siti Cetak');
    assert.equal(t.isi.nomor_anggota, 'CTK1');
    assert.equal(t.isi.nominal, 1_250_000);
    assert.equal(t.isi.saldo_akhir, 1_250_000);
    assert.equal(t.isi.terbilang, 'satu juta dua ratus lima puluh ribu rupiah');
    assert.equal(t.isi.petugas, 'admin');
    assert.ok(t.isi.petugas_nama, 'nama petugas diambil dari data pengguna');
    assert.ok(t.isi.jurnal_nomor, 'nomor jurnal ikut tercantum');
  });

  test('transaksi yang dibatalkan tetap dapat dicetak dengan status batal', async () => {
    const s = await panggil('POST', '/api/simpanan/setoran', { rekening_id: rekA, nominal: 100_000 });
    const b = await panggil('POST', `/api/simpanan/transaksi/${s.isi.id}/batal`, { alasan: 'Salah input' });
    assert.equal(b.status, 201);
    const t = await panggil('GET', `/api/simpanan/transaksi/${s.isi.id}`);
    assert.equal(t.isi.status, 'batal');
  });

  test('buku tabungan per rentang tanggal', async () => {
    const b = await panggil('GET', `/api/simpanan/rekening/${rekA}/buku?dari=2000-01-01&sampai=2999-12-31`);
    assert.equal(b.status, 200);
    assert.equal(b.isi.rekening.anggota_nama, 'Siti Cetak');
    assert.equal(b.isi.saldo_awal, 0);
    assert.equal(b.isi.saldo_akhir, 1_250_000);
    const kosong = await panggil('GET', `/api/simpanan/rekening/${rekA}/buku?dari=2000-01-01&sampai=2000-12-31`);
    assert.equal(kosong.isi.mutasi.length, 0);
  });

  test('transaksi yang tidak ada → 404', async () => {
    assert.equal((await panggil('GET', '/api/simpanan/transaksi/999999')).status, 404);
  });
});

describe('Bukti angsuran & pinjaman', () => {
  let pinjamanId;
  let angsuranId;

  test('detail angsuran memuat angsuran ke, rincian, sisa pokok, dan terbilang', async () => {
    const produk = get("SELECT id FROM produk_pinjaman WHERE kode = 'PK'").id;
    const h = loans.ajukan({ anggota_id: anggotaA, produk_id: produk, pokok: 6_000_000, tenor: 6,
      tanggal_pengajuan: '2026-01-05', agunan: [] }, ctx);
    pinjamanId = h.id;
    loans.putuskan(pinjamanId, { setuju: true }, ctx);
    loans.cairkan(pinjamanId, { tanggal: '2026-01-10' }, ctx);
    const p = await panggil('GET', `/api/pinjaman/${pinjamanId}`);
    assert.ok(p.isi.terbilang_cair.endsWith('rupiah'));
    assert.equal(p.isi.terbilang_pokok, 'enam juta rupiah');
    const bayar = await panggil('POST', '/api/pinjaman/angsuran', { pinjaman_id: pinjamanId, nominal: p.isi.jadwal[0].total,
      tanggal: '2026-02-10' });
    assert.equal(bayar.status, 201);
    angsuranId = bayar.isi.id;
    const a = await panggil('GET', `/api/pinjaman/angsuran/${angsuranId}`);
    assert.equal(a.status, 200);
    assert.equal(a.isi.angsuran_ke, 1);
    assert.equal(a.isi.nomor_pinjaman, p.isi.nomor);
    assert.equal(a.isi.anggota_nama, 'Siti Cetak');
    assert.equal(a.isi.bayar_pokok + a.isi.bayar_bunga + a.isi.bayar_denda, a.isi.total_bayar);
    assert.equal(a.isi.sisa_pokok, 6_000_000 - a.isi.bayar_pokok);
    assert.ok(a.isi.jatuh_tempo, 'jatuh tempo angsuran ikut tercantum');
    assert.match(a.isi.terbilang, /rupiah$/);
  });

  test('angsuran yang tidak ada → 404; rute detail pinjaman tetap berfungsi', async () => {
    assert.equal((await panggil('GET', '/api/pinjaman/angsuran/999999')).status, 404);
    assert.equal((await panggil('GET', `/api/pinjaman/${pinjamanId}/denda`)).status, 200);
  });

  test('portal: anggota dapat mengambil bukti angsurannya sendiri', async () => {
    const a = await panggil('GET', `/api/portal/angsuran/${angsuranId}`, undefined, kukiAnggota);
    assert.equal(a.status, 200);
    assert.equal(a.isi.anggota_id, anggotaA);
  });
});

describe('Portal anggota: kop & bukti milik sendiri', () => {
  test('kop & tanda tangan cetakan tersedia lewat rute portal, bukan /api/cetak/profil', async () => {
    const p = await panggil('GET', '/api/portal/cetak-profil', undefined, kukiAnggota);
    assert.equal(p.status, 200);
    assert.ok(p.isi.profil.nama);
    assert.ok(p.isi.ttd.buku_tabungan && p.isi.ttd.angsuran && p.isi.ttd.setoran_simpanan);
    assert.equal((await panggil('GET', '/api/cetak/profil', undefined, kukiAnggota)).status, 403);
  });

  test('buku tabungan & bukti transaksi sendiri dapat dicetak', async () => {
    const b = await panggil('GET', `/api/portal/simpanan/${rekA}/buku?dari=2000-01-01`, undefined, kukiAnggota);
    assert.equal(b.status, 200);
    assert.equal(b.isi.rekening.id, rekA);
    const setor = b.isi.mutasi.find((m) => m.jenis === 'setoran');
    const t = await panggil('GET', `/api/portal/transaksi-simpanan/${setor.id}`, undefined, kukiAnggota);
    assert.equal(t.status, 200);
    assert.equal(t.isi.anggota_nama, 'Siti Cetak');
  });

  test('data milik anggota lain ditolak', async () => {
    const s = await panggil('POST', '/api/simpanan/setoran', { rekening_id: rekB, nominal: 50_000 });
    assert.equal((await panggil('GET', `/api/portal/simpanan/${rekB}/buku`, undefined, kukiAnggota)).status, 403);
    assert.equal((await panggil('GET', `/api/portal/transaksi-simpanan/${s.isi.id}`, undefined, kukiAnggota)).status, 403);
    assert.equal((await panggil('GET', `/api/simpanan/transaksi/${s.isi.id}`, undefined, kukiAnggota)).status, 403);
  });

  test('tanggal tidak sah pada buku tabungan portal → 400', async () => {
    const r = await panggil('GET', `/api/portal/simpanan/${rekA}/buku?dari=kemarin`, undefined, kukiAnggota);
    assert.equal(r.status, 400);
  });
});

describe('Bukti keluar anggota & berita acara RAT', () => {
  test('bukti keluar merinci pengembalian simpanan', async () => {
    const pokok = get("SELECT id FROM produk_simpanan WHERE jenis = 'pokok'").id;
    const id = run(`INSERT INTO anggota(nomor_anggota, nik, nama, cabang_id, tanggal_daftar, tanggal_gabung, status)
      VALUES('CTK3','3171000000008803','Rudi Keluar',1,'2023-01-01','2023-01-01','aktif')`).lastInsertRowid;
    await panggil('POST', '/api/simpanan/rekening', { anggota_id: id, produk_id: pokok, setoran_awal: 500_000 });
    assert.equal((await panggil('GET', `/api/anggota/${id}/bukti-keluar`)).status, 409, 'belum keluar');
    const k = await panggil('POST', `/api/anggota/${id}/keluar`, { alasan_keluar: 'mengundurkan_diri' });
    assert.equal(k.status, 201);
    const b = await panggil('GET', `/api/anggota/${id}/bukti-keluar`);
    assert.equal(b.status, 200);
    assert.equal(b.isi.pengembalian.length, 1);
    assert.equal(b.isi.total, 500_000);
    assert.equal(b.isi.terbilang, 'lima ratus ribu rupiah');
    assert.equal(b.isi.sisa_saldo, 0);
  });

  test('berita acara RAT memuat catatan penutup dan syarat kuorum', async () => {
    const r = await panggil('POST', '/api/rat', { tahun_buku: 2025, judul: 'RAT Uji Cetak', tanggal: '2026-03-01',
      kuorum_persen: 50, tempat: 'Aula' });
    assert.equal(r.status, 201);
    await panggil('POST', `/api/rat/${r.isi.id}/selesai`, { berita_acara: 'Rapat ditutup pukul 12.00.' });
    const b = await panggil('GET', `/api/rat/${r.isi.id}/berita-acara`);
    assert.equal(b.status, 200);
    assert.equal(b.isi.catatan, 'Rapat ditutup pukul 12.00.');
    assert.equal(b.isi.kehadiran.kuorum_persen, 50);
  });
});
