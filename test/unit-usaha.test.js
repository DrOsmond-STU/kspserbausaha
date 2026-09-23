/**
 * Uji transaksi unit usaha (pendapatan & biaya per unit): akun bawaan dari
 * Master Data, validasi tipe akun, jurnal bertanda unit, laporan kinerja per
 * unit, koreksi ubah/batal, dan hak akses.
 *
 * Diuji lewat HTTP sungguhan supaya pemeriksaan izin (RBAC) ikut teruji.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ECMS_DATA_DIR = mkdtempSync(join(tmpdir(), 'ecms-uji-unit-'));
process.env.ECMS_DB = join(process.env.ECMS_DATA_DIR, 'uji.db');
process.env.HOST = '127.0.0.1';
process.env.PORT = '0';
process.env.ECMS_ADMIN_PASSWORD = 'Rahasia!2026uji';

const server = (await import('../server/index.js')).default;
const { get, all } = await import('../server/db.js');

const SANDI = 'Rahasia!2026uji';
const TAHUN = new Date().getFullYear();
const HARI_INI = new Date().toISOString().slice(0, 10);

let asal;
const kuki = {};

async function masuk(username) {
  const r = await fetch(`${asal}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: SANDI }),
  });
  assert.ok(r.ok, `login ${username} gagal`);
  return r.headers.get('set-cookie').split(';')[0];
}

async function panggil(metode, jalur, isi, siapa = 'admin') {
  const r = await fetch(`${asal}${jalur}`, {
    method: metode,
    headers: { 'Content-Type': 'application/json', Cookie: kuki[siapa] },
    body: isi === undefined ? undefined : JSON.stringify(isi),
  });
  return { status: r.status, isi: await r.json().catch(() => null) };
}

const unitJasa = () => get("SELECT * FROM unit_usaha WHERE kode = 'JSA'");
const kinerjaJasa = async () => (await panggil('GET', `/api/unit-usaha/kinerja?tahun=${TAHUN}`))
  .isi.per_unit.find((u) => u.kode === 'JSA');

/** Baris jurnal sebuah bukti kas: [{coa_kode, debit, kredit, unit_usaha_id}]. */
const barisJurnal = (nomor) => all(
  `SELECT d.coa_kode, d.debit, d.kredit, COALESCE(d.unit_usaha_id, j.unit_usaha_id) AS unit_usaha_id
     FROM jurnal_detail d JOIN jurnal j ON j.id = d.jurnal_id WHERE j.nomor = ? ORDER BY d.urut`, [nomor]);

before(async () => {
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  asal = `http://127.0.0.1:${server.address().port}`;
  kuki.admin = await masuk('admin');
  for (const [username, role] of [['manajer.unit', 'manajer_unit'], ['pengawas.unit', 'pengawas'],
    ['kasir.unit', 'kasir_toko']]) {
    const r = await panggil('POST', '/api/admin/users', { username, nama: `Uji ${role}`, role, password: SANDI });
    assert.ok(r.status < 300, `buat pengguna ${username}`);
    kuki[role] = await masuk(username);
  }
});

after(() => server.close());

describe('Transaksi unit usaha', () => {
  let idPendapatan;
  let nomorPendapatan;

  test('pilihan formulir: unit dengan akun bawaan dan akun dari bagan akun', async () => {
    const { status, isi } = await panggil('GET', '/api/unit-usaha/opsi');
    assert.equal(status, 200);
    const jasa = isi.unit.find((u) => u.kode === 'JSA');
    assert.equal(jasa.coa_pendapatan, '4-1401');
    assert.equal(jasa.coa_beban, '5-2601');
    assert.ok(isi.akun_pendapatan.every((a) => a.tipe === 'pendapatan'));
    assert.ok(isi.akun_beban.every((a) => a.tipe === 'beban'));
    assert.ok(isi.akun_kas.some((a) => a.kode === '1-1101'));
  });

  test('pendapatan memakai akun bawaan unit dan terjurnal bertanda unit', async () => {
    const sebelum = (await kinerjaJasa()).pendapatan;
    const { status, isi } = await panggil('POST', '/api/unit-usaha/transaksi', {
      jenis: 'pendapatan', unit_usaha_id: unitJasa().id, coa_kas: '1-1101', nominal: 750_000,
      tanggal: HARI_INI, keterangan: 'Sewa tenda acara', pihak: 'Bapak Uji' }, 'manajer_unit');
    assert.equal(status, 201, JSON.stringify(isi));
    assert.match(isi.nomor, /^BKM/);
    idPendapatan = isi.id;
    nomorPendapatan = isi.nomor;

    const baris = barisJurnal(isi.nomor);
    assert.deepEqual(baris.map((b) => [b.coa_kode, b.debit, b.kredit]), [['1-1101', 750_000, 0], ['4-1401', 0, 750_000]]);
    assert.ok(baris.every((b) => b.unit_usaha_id === unitJasa().id), 'setiap baris jurnal bertanda unit');
    assert.equal((await kinerjaJasa()).pendapatan, sebelum + 750_000);
  });

  test('biaya memakai akun beban bawaan dan mengurangi SHU unit', async () => {
    const sebelum = await kinerjaJasa();
    const { status, isi } = await panggil('POST', '/api/unit-usaha/transaksi', {
      jenis: 'biaya', unit_usaha_id: unitJasa().id, coa_kas: '1-1101', nominal: 200_000,
      keterangan: 'Perawatan peralatan' }, 'manajer_unit');
    assert.equal(status, 201, JSON.stringify(isi));
    assert.match(isi.nomor, /^BKK/);
    assert.deepEqual(barisJurnal(isi.nomor).map((b) => [b.coa_kode, b.debit, b.kredit]),
      [['5-2601', 200_000, 0], ['1-1101', 0, 200_000]]);
    const sesudah = await kinerjaJasa();
    assert.equal(sesudah.beban, sebelum.beban + 200_000);
    assert.equal(sesudah.shu, sebelum.shu - 200_000);
  });

  test('akun yang tidak sesuai jenis, akun kas palsu, dan unit kosong ditolak', async () => {
    const dasar = { unit_usaha_id: unitJasa().id, coa_kas: '1-1101', nominal: 1000 };
    const bebanUntukPendapatan = await panggil('POST', '/api/unit-usaha/transaksi',
      { ...dasar, jenis: 'pendapatan', coa_akun: '5-2601' });
    assert.equal(bebanUntukPendapatan.status, 400);
    assert.match(bebanUntukPendapatan.isi.pesan, /bertipe beban/);
    assert.equal((await panggil('POST', '/api/unit-usaha/transaksi',
      { ...dasar, jenis: 'biaya', coa_akun: '4-1401' })).status, 400);
    assert.equal((await panggil('POST', '/api/unit-usaha/transaksi',
      { ...dasar, jenis: 'pendapatan', coa_kas: '4-1101' })).status, 400, 'akun kas harus kas/bank');
    assert.equal((await panggil('POST', '/api/unit-usaha/transaksi',
      { ...dasar, jenis: 'pendapatan', unit_usaha_id: '' })).status, 400, 'unit wajib');
    assert.equal((await panggil('POST', '/api/unit-usaha/transaksi',
      { ...dasar, jenis: 'hibah' })).status, 400);
  });

  test('unit tanpa akun bawaan meminta akun dipilih', async () => {
    const toko = get("SELECT id FROM unit_usaha WHERE kode = 'TOK'").id;
    const r = await panggil('POST', '/api/unit-usaha/transaksi',
      { jenis: 'pendapatan', unit_usaha_id: toko, coa_kas: '1-1101', nominal: 1000 });
    assert.equal(r.status, 400);
    assert.match(r.isi.pesan, /wajib dipilih/);
    const ok = await panggil('POST', '/api/unit-usaha/transaksi',
      { jenis: 'pendapatan', unit_usaha_id: toko, coa_kas: '1-1101', coa_akun: '4-1301', nominal: 1000 });
    assert.equal(ok.status, 201);
  });

  test('daftar & ringkasan transaksi unit', async () => {
    const { status, isi } = await panggil('GET', `/api/unit-usaha/transaksi?unit_usaha_id=${unitJasa().id}&dari=${HARI_INI}`,
      undefined, 'pengawas');
    assert.equal(status, 200);
    assert.ok(isi.data.some((k) => k.nomor === nomorPendapatan && k.jenis_unit === 'pendapatan' && k.unit_nama === 'Unit Jasa'));
    assert.equal(isi.ringkasan.pendapatan, 750_000);
    assert.equal(isi.ringkasan.biaya, 200_000);
    const cetak = await panggil('GET', `/api/unit-usaha/transaksi/${idPendapatan}`, undefined, 'manajer_unit');
    assert.equal(cetak.status, 200);
    assert.equal(cetak.isi.akun_lawan_nama, 'Pendapatan Jasa Unit Usaha');
    assert.match(cetak.isi.terbilang, /tujuh ratus lima puluh ribu/i);
  });

  test('ubah: bukti lama dibatalkan, pengganti bernomor baru, kinerja ikut terkoreksi', async () => {
    const sebelum = (await kinerjaJasa()).pendapatan;
    const { status, isi } = await panggil('PUT', `/api/unit-usaha/transaksi/${idPendapatan}`,
      { nominal: 900_000, alasan: 'Salah nominal' }, 'manajer_unit');
    assert.equal(status, 200, JSON.stringify(isi));
    assert.equal(isi.dibatalkan, nomorPendapatan);
    assert.notEqual(isi.pengganti.nomor, nomorPendapatan);
    assert.equal(get('SELECT status FROM kas_bank WHERE id = ?', [idPendapatan]).status, 'batal');
    const baru = get('SELECT * FROM kas_bank WHERE id = ?', [isi.pengganti.id]);
    assert.equal(baru.unit_usaha_id, unitJasa().id, 'unit tetap terbawa');
    assert.equal(baru.coa_lawan, '4-1401');
    assert.equal((await kinerjaJasa()).pendapatan, sebelum + 150_000);
    idPendapatan = isi.pengganti.id;
  });

  test('batal: jurnal dibalik dan pendapatan unit kembali', async () => {
    const sebelum = (await kinerjaJasa()).pendapatan;
    const { status } = await panggil('POST', `/api/unit-usaha/transaksi/${idPendapatan}/batal`,
      { alasan: 'Transaksi ganda' }, 'manajer_unit');
    assert.equal(status, 201);
    assert.equal((await kinerjaJasa()).pendapatan, sebelum - 900_000);
    const lagi = await panggil('POST', `/api/unit-usaha/transaksi/${idPendapatan}/batal`, { alasan: 'x' });
    assert.equal(lagi.status, 409);
  });

  test('buku besar tetap seimbang', () => {
    const t = get('SELECT SUM(debit) AS d, SUM(kredit) AS k FROM jurnal_detail');
    assert.equal(t.d, t.k);
  });

  test('hak akses: pengawas hanya melihat, kasir tidak membuka unit usaha', async () => {
    const dasar = { jenis: 'pendapatan', unit_usaha_id: unitJasa().id, coa_kas: '1-1101', nominal: 1000 };
    assert.equal((await panggil('POST', '/api/unit-usaha/transaksi', dasar, 'pengawas')).status, 403);
    assert.equal((await panggil('GET', '/api/unit-usaha/transaksi', undefined, 'kasir_toko')).status, 403);
    const buat = await panggil('POST', '/api/unit-usaha/transaksi', dasar);
    assert.equal((await panggil('POST', `/api/unit-usaha/transaksi/${buat.isi.id}/batal`,
      { alasan: 'coba' }, 'pengawas')).status, 403);
  });

  test('bukti kas biasa dapat ditandai unit dan muncul di transaksi unit', async () => {
    const { status, isi } = await panggil('POST', '/api/kas', {
      jenis: 'kas_masuk', coa_kas: '1-1101', coa_lawan: '4-1401', nominal: 123_000,
      keterangan: 'Jasa fotokopi', unit_usaha_id: unitJasa().id });
    assert.equal(status, 201);
    const daftar = await panggil('GET', `/api/unit-usaha/transaksi?unit_usaha_id=${unitJasa().id}`);
    assert.ok(daftar.isi.data.some((k) => k.nomor === isi.nomor));
    const kas = await panggil('GET', '/api/kas?limit=5');
    assert.equal(kas.isi.data.find((k) => k.nomor === isi.nomor).unit_nama, 'Unit Jasa');
  });

  test('akun bawaan pada Master Data divalidasi tipenya', async () => {
    const id = unitJasa().id;
    const salah = await panggil('PUT', `/api/master/unit-usaha/${id}`, { coa_pendapatan: '5-2601' });
    assert.equal(salah.status, 400);
    assert.match(salah.isi.pesan, /bertipe beban/);
    assert.equal((await panggil('PUT', `/api/master/unit-usaha/${id}`, { coa_beban: '4-1401' })).status, 400);
    assert.equal((await panggil('PUT', `/api/master/unit-usaha/${id}`, { coa_pendapatan: '4-1301' })).status, 200);
    assert.equal(unitJasa().coa_pendapatan, '4-1301');
  });
});
