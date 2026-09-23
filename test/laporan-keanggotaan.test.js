/**
 * Uji kebenaran angka laporan kelompok keanggotaan, simpanan, pinjaman & SHU
 * (server/laporan/keanggotaan.js) pada basis data uji kecil: saldo per
 * tanggal, pembatalan transaksi, rekap per produk, outstanding &
 * kolektibilitas, serta mutasi keanggotaan.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ECMS_DATA_DIR = mkdtempSync(join(tmpdir(), 'ecms-uji-lapagt-'));
process.env.ECMS_DB = join(process.env.ECMS_DATA_DIR, 'uji.db');

const { migrate, run, get, scalar } = await import('../server/db.js');
const { pastikanDataAwal } = await import('../server/seed.js');
const simpanan = await import('../server/services/savings.js');
const pinjaman = await import('../server/services/loans.js');
const acc = await import('../server/services/accounting.js');
const { default: LAPORAN } = await import('../server/laporan/keanggotaan.js');
const { today } = await import('../server/lib/util.js');

/** Menjalankan susun() sebuah laporan dengan nilai bawaan filter seperti rute Pusat Laporan. */
function laporan(kode, filter = {}) {
  const d = LAPORAN.find((l) => l.kode === kode);
  assert.ok(d, `laporan ${kode} terdaftar`);
  const f = {};
  for (const x of d.filter || []) {
    if (filter[x.kunci] !== undefined) f[x.kunci] = filter[x.kunci];
    else if (x.bawaan !== undefined) f[x.kunci] = typeof x.bawaan === 'function' ? x.bawaan() : x.bawaan;
  }
  return d.susun(f, {});
}
const nilai = (dok, label) => dok.ringkasan.find((r) => r.label === label)?.nilai;

let budi;
let rekSukarela;
let coaSukarela;
let coaPiutang;
let pinjamanId;
let jadwal1;

before(() => {
  migrate();
  pastikanDataAwal();
  budi = run(
    `INSERT INTO anggota(nomor_anggota, nik, nama, jenis_kelamin, penghasilan, cabang_id, tanggal_daftar, tanggal_gabung, status)
     VALUES('U0001','3171000000009001','Budi Laporan','L',5000000,1,'2024-01-01','2024-01-01','aktif')`,
  ).lastInsertRowid;
  // Anggota yang masuk lalu keluar di tahun 2026
  run(`INSERT INTO anggota(nomor_anggota, nik, nama, jenis_kelamin, penghasilan, cabang_id, tanggal_daftar,
         tanggal_gabung, tanggal_keluar, alasan_keluar, status)
       VALUES('U0002','3171000000009002','Sari Keluar','P',3000000,1,'2026-02-01','2026-02-01','2026-03-15',
         'mengundurkan_diri','keluar')`);

  const produk = get("SELECT id, coa_kode FROM produk_simpanan WHERE jenis = 'sukarela'");
  coaSukarela = produk.coa_kode;
  rekSukarela = simpanan.bukaRekening({ anggota_id: budi, produk_id: produk.id, tanggal_buka: '2026-01-02',
    setoran_awal: 1_000_000 }).id;
  simpanan.penarikan({ rekening_id: rekSukarela, tanggal: '2026-01-10', nominal: 400_000 });
  // Setoran salah input lalu dibatalkan: tersimpan "batal" + mutasi "koreksi" bertanggal hari ini
  const salah = simpanan.setoran({ rekening_id: rekSukarela, tanggal: '2026-02-01', nominal: 300_000 });
  simpanan.batalTransaksi(salah.id, 'salah input nominal', { user: { username: 'uji' } });

  const pk = get("SELECT id, coa_piutang FROM produk_pinjaman WHERE kode = 'PK'");
  coaPiutang = pk.coa_piutang;
  pinjamanId = pinjaman.ajukan({ anggota_id: budi, produk_id: pk.id, pokok: 3_000_000, tenor: 12,
    tanggal_pengajuan: '2026-01-03', tujuan: 'uji laporan' }).id;
  pinjaman.putuskan(pinjamanId, { setuju: true });
  pinjaman.cairkan(pinjamanId, { tanggal: '2026-01-05' });
  jadwal1 = get('SELECT * FROM pinjaman_jadwal WHERE pinjaman_id = ? AND angsuran_ke = 1', [pinjamanId]);
  pinjaman.bayarAngsuran({ pinjaman_id: pinjamanId, tanggal: jadwal1.jatuh_tempo, nominal: jadwal1.total });
});

describe('Laporan simpanan', () => {
  test('saldo per tanggal mengabaikan pasangan transaksi batal + koreksi dan cocok dengan buku besar', () => {
    for (const t of ['2026-01-05', '2026-01-31', '2026-02-15', today()]) {
      const dok = laporan('saldo-simpanan', { sampai: t, jenis: 'sukarela' });
      const saldo = nilai(dok, 'Total saldo');
      const gl = acc.saldoAkun(coaSukarela, { sampai: t }).saldo;
      assert.equal(saldo, gl, `saldo simpanan per ${t} harus sama dengan buku besar`);
    }
    assert.equal(nilai(laporan('saldo-simpanan', { sampai: '2026-01-05', jenis: 'sukarela' }), 'Total saldo'), 1_000_000);
    assert.equal(nilai(laporan('saldo-simpanan', { sampai: '2026-02-15', jenis: 'sukarela' }), 'Total saldo'), 600_000);
  });

  test('saldo per hari ini sama dengan saldo rekening saat ini', () => {
    const dok = laporan('saldo-simpanan');
    assert.equal(nilai(dok, 'Total saldo'), scalar('SELECT SUM(saldo) FROM rekening_simpanan'));
    const perAnggota = laporan('simpanan-anggota');
    assert.equal(perAnggota.bagian[0].total.total, nilai(dok, 'Total saldo'));
    assert.equal(perAnggota.bagian[0].total.sukarela, 600_000);
  });

  test('rekening yang belum dibuka pada tanggal laporan tidak tampil', () => {
    const dok = laporan('saldo-simpanan', { sampai: '2025-12-31' });
    assert.equal(dok.bagian[0].baris.length, 0);
  });

  test('rekap per produk: saldo awal + setoran - penarikan + jasa = saldo akhir', () => {
    const dok = laporan('rekap-simpanan-produk', { dari: '2026-01-01', sampai: '2026-01-31', jenis: 'sukarela' });
    const [r] = dok.bagian[0].baris;
    assert.equal(r.saldo_awal, 0);
    assert.equal(r.setoran, 1_000_000);
    assert.equal(r.penarikan, 400_000);
    assert.equal(r.saldo_akhir, 600_000);
    const feb = laporan('rekap-simpanan-produk', { dari: '2026-02-01', sampai: '2026-02-28', jenis: 'sukarela' });
    assert.equal(feb.bagian[0].baris[0].setoran, 0, 'setoran yang dibatalkan tidak dihitung');
    assert.equal(feb.bagian[0].baris[0].saldo_awal, feb.bagian[0].baris[0].saldo_akhir);
  });

  test('mutasi simpanan menyembunyikan batal & koreksi kecuali diminta', () => {
    const nomorRek = get('SELECT nomor_rekening FROM rekening_simpanan WHERE id = ?', [rekSukarela]).nomor_rekening;
    const w = { rekening_dari: nomorRek, rekening_sampai: nomorRek };
    const berlaku = laporan('mutasi-simpanan', w);
    assert.equal(berlaku.bagian[0].baris.length, 2);
    assert.equal(nilai(berlaku, 'Mutasi bersih'), 600_000);
    const semua = laporan('mutasi-simpanan', { ...w, tampil: 'semua' });
    assert.equal(semua.bagian[0].baris.length, 4);
    assert.equal(nilai(semua, 'Mutasi bersih'), 600_000, 'batal + koreksi bernilai bersih nol');
    assert.equal(laporan('mutasi-simpanan', { ...w, tampil: 'batal' }).bagian[0].baris.length, 2);
  });
});

describe('Laporan pinjaman', () => {
  test('outstanding per tanggal cocok dengan buku besar piutang', () => {
    for (const t of ['2026-01-04', '2026-01-10', jadwal1.jatuh_tempo, '2026-06-30', today()]) {
      const dok = laporan('outstanding-pinjaman', { sampai: t });
      const gl = acc.saldoAkun(coaPiutang, { sampai: t }).saldo;
      assert.equal(nilai(dok, 'Total outstanding pokok'), gl, `outstanding per ${t}`);
    }
    assert.equal(laporan('outstanding-pinjaman', { sampai: '2026-01-04' }).bagian[0].baris.length, 0);
    assert.equal(nilai(laporan('outstanding-pinjaman', { sampai: jadwal1.jatuh_tempo }), 'Total outstanding pokok'),
      3_000_000 - jadwal1.pokok);
  });

  test('kolektibilitas per tanggal sama dengan aturan modul pinjaman', () => {
    for (const t of ['2026-03-01', '2026-06-30', '2026-12-31']) {
      const [baris] = laporan('outstanding-pinjaman', { sampai: t }).bagian[0].baris;
      const k = pinjaman.perbaruiKolektibilitas(pinjamanId, t);
      assert.equal(baris.hari_tunggak, k.tunggakan_hari, `hari tunggak per ${t}`);
      assert.equal(baris.kolektibilitas, k.kolektibilitas, `kolektibilitas per ${t}`);
    }
    const npl = laporan('npl-kolektibilitas', { sampai: '2026-12-31' });
    assert.equal(nilai(npl, 'Rasio NPL'), 100, 'satu-satunya pinjaman sudah macet/diragukan');
  });

  test('angsuran diterima dan jadwal angsuran', () => {
    const dok = laporan('angsuran-diterima', { dari: '2026-01-01', sampai: '2026-12-31' });
    assert.equal(nilai(dok, 'Pokok'), jadwal1.pokok);
    assert.equal(nilai(dok, 'Total diterima'), jadwal1.total);
    const nomor = get('SELECT nomor FROM pinjaman WHERE id = ?', [pinjamanId]).nomor;
    const jd = laporan('jadwal-angsuran', { pinjaman_dari: nomor });
    assert.equal(jd.bagian.length, 1);
    assert.equal(jd.bagian[0].baris.length, 12);
    assert.equal(jd.bagian[0].total.pokok, 3_000_000);
    assert.equal(jd.bagian[0].total.bayar_pokok, jadwal1.pokok);
  });
});

describe('Laporan keanggotaan', () => {
  test('mutasi keanggotaan: awal + masuk - keluar = akhir', () => {
    const dok = laporan('mutasi-anggota', { dari: '2026-01-01', sampai: '2026-12-31' });
    assert.equal(nilai(dok, 'Anggota awal periode'), 1);
    assert.equal(nilai(dok, 'Anggota masuk'), 1);
    assert.equal(nilai(dok, 'Anggota keluar'), 1);
    assert.equal(nilai(dok, 'Anggota akhir periode'), 1);
    assert.equal(dok.bagian[1].baris[0].alasan, 'Mengundurkan diri');
  });

  test('seluruh laporan kelompok ini dapat disusun tanpa filter', () => {
    for (const d of LAPORAN) {
      if (d.filter.some((x) => x.wajib)) continue;
      const dok = laporan(d.kode);
      assert.ok(Array.isArray(dok.bagian) && dok.bagian.length, `${d.kode} menghasilkan bagian`);
      for (const b of dok.bagian) assert.ok(Array.isArray(b.baris) && Array.isArray(b.kolom), d.kode);
    }
  });
});
