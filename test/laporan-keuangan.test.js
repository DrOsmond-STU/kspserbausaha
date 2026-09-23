/**
 * Uji laporan keuangan Pusat Laporan (server/laporan/keuangan.js) pada data
 * uji kecil: neraca seimbang, SHU laba rugi = SHU pada neraca, kenaikan arus
 * kas = mutasi kas/bank, neraca lajur, perubahan ekuitas, buku besar, bukti
 * kas (termasuk yang dibatalkan), aset per tanggal, dan umur hutang.
 *
 * Kode akun tidak ditanam: akun diambil dari bagan akun (penanda kas/bank)
 * dan pemetaan akun pada Parameter Sistem.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ECMS_DATA_DIR = mkdtempSync(join(tmpdir(), 'ecms-uji-lapkeu-'));
process.env.ECMS_DB = join(process.env.ECMS_DATA_DIR, 'uji.db');
process.env.HOST = '127.0.0.1';
process.env.PORT = '0';
process.env.ECMS_ADMIN_PASSWORD = 'Rahasia!2026lapkeu';

const server = (await import('../server/index.js')).default;

let asal;
let cookie;
const akun = {};

async function panggil(metode, path, data) {
  const res = await fetch(`${asal}${path}`, {
    method: metode,
    headers: { cookie, ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: data !== undefined ? JSON.stringify(data) : undefined,
  });
  let isi = null;
  try { isi = await res.json(); } catch { /* bukan JSON */ }
  return { status: res.status, isi };
}

const sukses = (r) => assert.ok(r.status >= 200 && r.status < 300, `status ${r.status}: ${r.isi?.pesan || ''}`);

/** Model dokumen sebuah laporan. */
async function laporan(kode, filter = {}) {
  const r = await panggil('GET', `/api/pusat-laporan/${kode}?${new URLSearchParams(filter)}`);
  sukses(r);
  return r.isi;
}
const ringkas = (dok, awal) => dok.ringkasan.find((x) => x.label.startsWith(awal))?.nilai;
const bagian = (dok, judul) => dok.bagian.find((b) => b.judul === judul);

async function jurnal(tanggal, debit, kredit, nominal, tipe = 'umum') {
  sukses(await panggil('POST', '/api/akuntansi/jurnal', {
    tanggal, tipe, keterangan: `Uji ${tanggal}`,
    lines: [{ coa_kode: debit, debit: nominal }, { coa_kode: kredit, kredit: nominal }],
  }));
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
  const coa = (await panggil('GET', '/api/master/coa')).isi.data.filter((c) => c.is_postable && c.status === 'aktif');
  const map = (await panggil('GET', '/api/admin/settings')).isi.map;
  akun.kas = coa.find((c) => c.is_kas).kode;
  akun.bank = coa.find((c) => c.is_bank).kode;
  akun.modal = map['coa.simpanan_pokok'];
  akun.pendapatan = map['coa.pendapatan_lain'];
  akun.beban = map['coa.beban_lain'];
  akun.hpp = map['coa.hpp'];
  akun.persediaan = map['coa.persediaan'];
  assert.ok(Object.values(akun).every(Boolean), 'akun uji tersedia');

  // 2019: modal 10 jt, pendapatan 3 jt, beban 1 jt → SHU 2 jt (tahun buku belum ditutup)
  await jurnal('2019-01-10', akun.kas, akun.modal, 10_000_000, 'pembuka');
  await jurnal('2019-03-05', akun.kas, akun.pendapatan, 3_000_000);
  await jurnal('2019-04-01', akun.beban, akun.kas, 1_000_000);
  // 2020: pendapatan 2 jt ke bank, beban 0,5 jt, beli persediaan 0,8 jt, HPP 0,3 jt → SHU 1,2 jt
  await jurnal('2020-02-01', akun.bank, akun.pendapatan, 2_000_000);
  await jurnal('2020-02-15', akun.beban, akun.kas, 500_000);
  await jurnal('2020-02-20', akun.persediaan, akun.kas, 800_000);
  await jurnal('2020-02-28', akun.hpp, akun.persediaan, 300_000);
  sukses(await panggil('POST', '/api/kas/transfer', {
    tanggal: '2020-03-01', coa_kas: akun.kas, coa_tujuan: akun.bank, nominal: 1_000_000, keterangan: 'Setor ke bank',
  }));
  const bkm = await panggil('POST', '/api/kas', {
    tanggal: '2020-03-10', jenis: 'kas_masuk', nominal: 400_000, coa_kas: akun.kas, coa_lawan: akun.pendapatan,
    keterangan: 'Salah input',
  });
  sukses(bkm);
  sukses(await panggil('POST', `/api/kas/${bkm.isi.id}/batal`, { alasan: 'Salah input' }));
});

after(() => server.close());

describe('Laporan keuangan saling cocok', () => {
  test('katalog memuat laporan keuangan', async () => {
    const kat = (await panggil('GET', '/api/pusat-laporan')).isi.data.map((l) => l.kode);
    for (const k of ['jurnal-umum', 'buku-besar', 'neraca-saldo', 'neraca-lajur', 'neraca', 'laba-rugi', 'arus-kas',
      'perubahan-ekuitas', 'rasio-keuangan', 'rekap-pajak', 'bukti-kas', 'buku-kas', 'posisi-kas', 'rekonsiliasi-bank',
      'cash-opname', 'umur-hutang-piutang', 'pembayaran-hutang-piutang', 'realisasi-anggaran', 'register-aset',
      'penyusutan-aset', 'pemeliharaan-aset', 'pelepasan-aset']) {
      assert.ok(kat.includes(k), `laporan ${k} tersedia`);
    }
  });

  test('neraca seimbang dan SHU sama dengan laba rugi (tahun lalu belum ditutup)', async () => {
    const n = await laporan('neraca', { sampai: '2020-12-31' });
    assert.equal(ringkas(n, 'Selisih'), 0);
    assert.equal(ringkas(n, 'Jumlah aset'), 13_200_000);
    const ek = bagian(n, 'EKUITAS').baris;
    assert.equal(ek.find((r) => r.nama === 'SHU tahun lalu yang belum ditutup').nilai, 2_000_000);
    assert.equal(ek.find((r) => r.nama === 'SHU tahun berjalan').nilai, 1_200_000);
    const lr = await laporan('laba-rugi', { dari: '2020-01-01', sampai: '2020-12-31' });
    assert.equal(ringkas(lr, 'SHU'), 1_200_000);
    assert.equal(ringkas(n, 'SHU tahun 2020'), ringkas(lr, 'SHU'));
    assert.equal(bagian(lr, 'HARGA POKOK PENJUALAN').total.nilai, 300_000);
  });

  test('laba rugi dengan periode pembanding', async () => {
    const lr = await laporan('laba-rugi', {
      dari: '2020-01-01', sampai: '2020-12-31', banding_dari: '2019-01-01', banding_sampai: '2019-12-31',
    });
    const shu = bagian(lr, 'HASIL USAHA').baris.at(-1);
    assert.deepEqual([shu.nilai, shu.banding, shu.perubahan], [1_200_000, 2_000_000, -800_000]);
  });

  test('arus kas: kenaikan kas sama dengan mutasi kas & bank', async () => {
    const ak = await laporan('arus-kas', { dari: '2020-01-01', sampai: '2020-12-31' });
    assert.equal(ringkas(ak, 'Kenaikan'), 700_000);
    assert.equal(ringkas(ak, 'Saldo kas awal'), 12_000_000);
    assert.equal(ringkas(ak, 'Selisih dengan buku besar'), 0);
    const pos = await laporan('posisi-kas', { sampai: '2020-12-31' });
    assert.equal(ringkas(pos, 'Total kas & bank'), ringkas(ak, 'Saldo kas akhir'));
  });

  test('neraca lajur, neraca saldo, dan perubahan ekuitas seimbang', async () => {
    const nl = await laporan('neraca-lajur', { sampai: '2020-12-31' });
    assert.equal(ringkas(nl, 'SHU tahun berjalan'), 1_200_000);
    assert.equal(ringkas(nl, 'Selisih neraca saldo'), 0);
    assert.equal(ringkas(nl, 'Selisih neraca'), 0);
    const t = nl.bagian[0].total;
    assert.equal(t.lr_debit, t.lr_kredit);
    const ns = await laporan('neraca-saldo', { dari: '2020-01-01', sampai: '2020-12-31' });
    assert.equal(ringkas(ns, 'Selisih'), 0);
    const pe = await laporan('perubahan-ekuitas', { dari: '2020-01-01', sampai: '2020-12-31' });
    assert.equal(ringkas(pe, 'Selisih dengan neraca'), 0);
    assert.equal(ringkas(pe, 'Ekuitas akhir'), 13_200_000);
    assert.equal(ringkas(pe, 'Ekuitas awal'), 12_000_000);
  });

  test('buku besar per rentang akun dengan saldo berjalan', async () => {
    const bb = await laporan('buku-besar', { dari: '2020-01-01', sampai: '2020-12-31', kode_dari: akun.kas, kode_sampai: akun.kas });
    assert.equal(bb.bagian.length, 1);
    const b = bb.bagian[0];
    assert.equal(b.baris[0].saldo, 12_000_000);
    assert.equal(b.total.saldo, 12_000_000 - 500_000 - 800_000 - 1_000_000);
    assert.equal(b.baris.at(-1).saldo, b.total.saldo);
    const salah = await panggil('GET', '/api/pusat-laporan/buku-besar?kode_dari=TIDAK-ADA');
    assert.equal(salah.status, 400);
  });

  test('jurnal umum menyaring asal jurnal dan seimbang', async () => {
    const ju = await laporan('jurnal-umum', { dari: '2020-01-01', sampai: '2020-12-31', sumber: 'manual' });
    assert.equal(ringkas(ju, 'Jumlah jurnal'), 4);
    assert.equal(ringkas(ju, 'Total debit'), ringkas(ju, 'Total kredit'));
    const semua = await laporan('jurnal-umum', { dari: '2020-01-01', sampai: '2020-12-31' });
    // 4 manual + transfer + bukti kas masuk + jurnal balik pembatalannya
    assert.equal(ringkas(semua, 'Jumlah jurnal'), 7);
  });

  test('bukti kas memisahkan transfer dan bukti yang dibatalkan', async () => {
    const bk = await laporan('bukti-kas', { dari: '2020-01-01', sampai: '2020-12-31' });
    assert.equal(ringkas(bk, 'Jumlah bukti'), 2);
    assert.equal(ringkas(bk, 'Total transfer'), 1_000_000);
    assert.equal(ringkas(bk, 'Total kas masuk'), 0);
    assert.equal(ringkas(bk, 'Total dibatalkan'), 400_000);
    const rk = await laporan('rekonsiliasi-bank', { akun: akun.bank, sampai: '2020-12-31' });
    assert.equal(ringkas(rk, 'Penerimaan belum'), 1_000_000);
  });

  test('ekspor Excel dan Word', async () => {
    for (const format of ['xlsx', 'docx']) {
      const res = await fetch(`${asal}/api/pusat-laporan/neraca/unduh?format=${format}&sampai=2020-12-31`, { headers: { cookie } });
      assert.equal(res.status, 200);
      const buf = Buffer.from(await res.arrayBuffer());
      assert.equal(buf.subarray(0, 2).toString(), 'PK');
    }
  });
});

describe('Aset tetap dan hutang per tanggal', () => {
  let asetId;

  test('register aset memakai akumulasi penyusutan per tanggal', async () => {
    const r = await panggil('POST', '/api/aset', {
      kode: 'UJI-01', nama: 'Laptop Uji', kategori: 'inventaris', tanggal_perolehan: '2021-01-15',
      harga_perolehan: 1_200_000, umur_manfaat: 1, sumber_perolehan: 'kas',
    });
    sukses(r);
    asetId = r.isi.id;
    for (const periode of ['2021-01', '2021-02', '2021-03']) sukses(await panggil('POST', '/api/aset/penyusutan', { periode }));
    const tengah = await laporan('register-aset', { sampai: '2021-02-15', kode_dari: 'UJI-01', kode_sampai: 'UJI-01' });
    assert.equal(tengah.bagian[0].baris[0].akumulasi, 100_000);
    const akhir = await laporan('register-aset', { sampai: '2021-03-31', kode_dari: 'UJI-01', kode_sampai: 'UJI-01' });
    assert.equal(akhir.bagian[0].baris[0].nilai_buku, 900_000);
    const susut = await laporan('penyusutan-aset', { bulan_dari: '2021-01', bulan_sampai: '2021-12', rincian: 'aset' });
    assert.equal(susut.bagian[0].total.nominal, 300_000);
    const ak = await laporan('arus-kas', { dari: '2021-01-01', sampai: '2021-03-31' });
    assert.equal(ringkas(ak, 'Kenaikan'), -1_200_000);
    assert.equal(ringkas(ak, 'Selisih dengan buku besar'), 0);
  });

  test('pelepasan aset: laba/rugi dan keluar dari register', async () => {
    sukses(await panggil('POST', `/api/aset/${asetId}/disposal`, { tanggal: '2021-04-10', nilai_jual: 1_000_000 }));
    const lp = await laporan('pelepasan-aset', { dari: '2021-01-01', sampai: '2021-12-31' });
    assert.equal(lp.bagian[0].total.laba_rugi, 100_000);
    const sebelum = await laporan('register-aset', { sampai: '2021-04-09', kode_dari: 'UJI-01', kode_sampai: 'UJI-01' });
    assert.equal(sebelum.bagian[0].baris.length, 1);
    const sesudah = await laporan('register-aset', { sampai: '2021-04-30', kode_dari: 'UJI-01', kode_sampai: 'UJI-01' });
    assert.equal(sesudah.bagian[0].baris.length, 0);
    const n = await laporan('neraca', { sampai: '2021-12-31' });
    assert.equal(ringkas(n, 'Selisih'), 0);
  });

  test('umur hutang per tanggal dan pembayaran', async () => {
    sukses(await panggil('POST', '/api/aset', {
      kode: 'UJI-02', nama: 'Meja Uji', tanggal_perolehan: '2022-01-10', harga_perolehan: 600_000,
      umur_manfaat: 4, sumber_perolehan: 'hutang', pemasok: 'CV Uji', jatuh_tempo: '2022-02-10',
    }));
    const hp = (await panggil('GET', '/api/hutang-piutang?jenis=hutang')).isi.data.find((h) => h.referensi.startsWith('aset:'));
    sukses(await panggil('POST', '/api/hutang-piutang/bayar', { id: hp.id, tanggal: '2022-03-01', nominal: 200_000 }));
    const a1 = await laporan('umur-hutang-piutang', { jenis: 'hutang', sampai: '2022-02-20' });
    assert.deepEqual([a1.bagian[0].total.sisa, a1.bagian[0].total.u30], [600_000, 600_000]);
    const a2 = await laporan('umur-hutang-piutang', { jenis: 'hutang', sampai: '2022-03-15' });
    assert.deepEqual([a2.bagian[0].total.sisa, a2.bagian[0].total.u60], [400_000, 400_000]);
    const bayar = await laporan('pembayaran-hutang-piutang', { dari: '2022-01-01', sampai: '2022-12-31' });
    assert.equal(ringkas(bayar, 'Total pembayaran hutang'), 200_000);
  });
});

describe('Sesudah tutup buku', () => {
  test('neraca tetap seimbang dan SHU tahun tertutup tetap tersaji', async () => {
    sukses(await panggil('POST', '/api/akuntansi/tutup-tahun', { tahun: 2019 }));
    const n19 = await laporan('neraca', { sampai: '2019-12-31' });
    assert.equal(ringkas(n19, 'Selisih'), 0);
    assert.equal(ringkas(n19, 'SHU tahun 2019'), 2_000_000);
    assert.equal(bagian(n19, 'EKUITAS').baris.find((r) => r.nama === 'SHU tahun berjalan').nilai, 0);
    const lr19 = await laporan('laba-rugi', { dari: '2019-01-01', sampai: '2019-12-31' });
    assert.equal(ringkas(lr19, 'SHU'), 2_000_000);
    const n20 = await laporan('neraca', { sampai: '2020-12-31' });
    assert.equal(ringkas(n20, 'Selisih'), 0);
    assert.ok(!bagian(n20, 'EKUITAS').baris.some((r) => r.nama === 'SHU tahun lalu yang belum ditutup'));
    const pe = await laporan('perubahan-ekuitas', { dari: '2019-01-01', sampai: '2019-12-31' });
    assert.equal(ringkas(pe, 'Selisih dengan neraca'), 0);
    const nl = await laporan('neraca-lajur', { sampai: '2019-12-31' });
    assert.equal(ringkas(nl, 'SHU tahun berjalan'), 2_000_000);
    assert.equal(ringkas(nl, 'Selisih neraca'), 0);
  });
});
