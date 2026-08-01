/**
 * Uji mesin akuntansi: keseimbangan double entry, penyaringan periode,
 * dan integritas laporan keuangan.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ECMS_DATA_DIR = mkdtempSync(join(tmpdir(), 'ecms-uji-'));
process.env.ECMS_DB = join(process.env.ECMS_DATA_DIR, 'uji.db');

const { migrate, run, get, scalar } = await import('../server/db.js');
const { pastikanDataAwal } = await import('../server/seed.js');
const acc = await import('../server/services/accounting.js');

before(() => { migrate(); pastikanDataAwal(); });

describe('Jurnal double entry', () => {
  test('menolak jurnal yang tidak seimbang', () => {
    assert.throws(() => acc.postJournal({
      tanggal: '2026-01-10', keterangan: 'tidak seimbang',
      lines: [{ coa_kode: '1-1101', debit: 1000 }, { coa_kode: '4-1101', kredit: 900 }],
    }), /tidak seimbang/i);
  });

  test('menolak jurnal ke akun induk yang tidak boleh dijurnal', () => {
    assert.throws(() => acc.postJournal({
      tanggal: '2026-01-10', keterangan: 'akun induk',
      lines: [{ coa_kode: '1', debit: 1000 }, { coa_kode: '4-1101', kredit: 1000 }],
    }), /akun induk/i);
  });

  test('menolak akun yang tidak terdaftar', () => {
    assert.throws(() => acc.postJournal({
      tanggal: '2026-01-10', keterangan: 'akun fiktif',
      lines: [{ coa_kode: '9-9999', debit: 1000 }, { coa_kode: '4-1101', kredit: 1000 }],
    }), /tidak terdaftar/i);
  });

  test('menolak satu baris berisi debit dan kredit sekaligus', () => {
    assert.throws(() => acc.postJournal({
      tanggal: '2026-01-10', keterangan: 'debit dan kredit',
      lines: [{ coa_kode: '1-1101', debit: 1000, kredit: 1000 },
        { coa_kode: '4-1101', kredit: 1000 }],
    }), /debit dan kredit sekaligus/i);
  });

  test('memposting jurnal seimbang dan menomori otomatis', () => {
    const j = acc.postJournal({
      tanggal: '2026-01-15', keterangan: 'penjualan tunai',
      lines: [{ coa_kode: '1-1101', debit: 500_000 }, { coa_kode: '4-1101', kredit: 500_000 }],
    });
    assert.ok(j.id > 0);
    assert.match(j.nomor, /^JV\/2026\/01\/\d{5}$/);
    assert.equal(j.total, 500_000);
  });
});

describe('Penyaringan periode laporan', () => {
  before(() => {
    acc.postJournal({
      tanggal: '2026-03-05', keterangan: 'pendapatan Maret',
      lines: [{ coa_kode: '1-1101', debit: 2_000_000 }, { coa_kode: '4-1101', kredit: 2_000_000 }],
    });
    acc.postJournal({
      tanggal: '2026-04-05', keterangan: 'pendapatan April',
      lines: [{ coa_kode: '1-1101', debit: 7_000_000 }, { coa_kode: '4-1101', kredit: 7_000_000 }],
    });
  });

  test('laba rugi hanya menghitung transaksi dalam periode', () => {
    const maret = acc.labaRugi({ dari: '2026-03-01', sampai: '2026-03-31' });
    const april = acc.labaRugi({ dari: '2026-04-01', sampai: '2026-04-30' });
    assert.equal(maret.total_pendapatan, 2_000_000);
    assert.equal(april.total_pendapatan, 7_000_000);
  });

  test('periode berbeda menghasilkan angka berbeda (bukan total sepanjang masa)', () => {
    const maret = acc.labaRugi({ dari: '2026-03-01', sampai: '2026-03-31' });
    const ytd = acc.labaRugi({ dari: '2026-01-01', sampai: '2026-12-31' });
    assert.notEqual(maret.total_pendapatan, ytd.total_pendapatan);
    assert.equal(ytd.total_pendapatan, 9_500_000); // 500rb + 2jt + 7jt
  });

  test('periode tanpa transaksi menghasilkan nol', () => {
    const kosong = acc.labaRugi({ dari: '2026-06-01', sampai: '2026-06-30' });
    assert.equal(kosong.total_pendapatan, 0);
    assert.equal(kosong.total_beban, 0);
  });
});

describe('Integritas laporan', () => {
  test('neraca saldo selalu seimbang', () => {
    const tb = acc.trialBalance({ dari: '2026-01-01', sampai: '2026-12-31' });
    assert.equal(tb.total_debit, tb.total_kredit);
  });

  test('neraca memenuhi persamaan akuntansi aset = kewajiban + ekuitas', () => {
    const n = acc.neraca({ sampai: '2026-12-31' });
    assert.equal(n.seimbang, true);
    assert.equal(n.selisih, 0);
    assert.equal(n.total_aset, n.total_kewajiban + n.total_ekuitas);
  });

  test('arus kas sama dengan mutasi kas sesungguhnya', () => {
    const ak = acc.arusKas({ dari: '2026-01-01', sampai: '2026-12-31' });
    const kasNyata = acc.saldoAkun('1-1101', { dari: '2026-01-01', sampai: '2026-12-31' }).saldo
      + acc.saldoAkun('1-1102', { dari: '2026-01-01', sampai: '2026-12-31' }).saldo
      + acc.saldoAkun('1-1201', { dari: '2026-01-01', sampai: '2026-12-31' }).saldo;
    assert.equal(ak.kenaikan_kas, kasNyata,
      'total arus kas harus persis sama dengan perubahan saldo akun kas & bank');
  });
});

describe('Pembatalan jurnal', () => {
  test('membuat jurnal balik dan tidak menghapus jurnal asli', () => {
    const j = acc.postJournal({
      tanggal: '2026-05-10', keterangan: 'akan dibatalkan',
      lines: [{ coa_kode: '1-1101', debit: 1_500_000 }, { coa_kode: '4-1101', kredit: 1_500_000 }],
    });
    const sebelum = acc.labaRugi({ dari: '2026-05-01', sampai: '2026-05-31' }).total_pendapatan;
    assert.equal(sebelum, 1_500_000);

    acc.voidJournal(j.id, 'salah input');

    const asli = get('SELECT status, void_alasan FROM jurnal WHERE id = ?', [j.id]);
    assert.equal(asli.status, 'void', 'jurnal asli tetap ada dengan status void');
    assert.equal(asli.void_alasan, 'salah input');

    const sesudah = acc.labaRugi({ dari: '2026-05-01', sampai: '2026-05-31' }).total_pendapatan;
    assert.equal(sesudah, 0, 'jurnal balik menetralkan dampak jurnal asli');
  });

  test('menolak pembatalan ganda', () => {
    const j = acc.postJournal({
      tanggal: '2026-05-12', keterangan: 'batal dua kali',
      lines: [{ coa_kode: '1-1101', debit: 100_000 }, { coa_kode: '4-1101', kredit: 100_000 }],
    });
    acc.voidJournal(j.id, 'pertama');
    assert.throws(() => acc.voidJournal(j.id, 'kedua'), /sudah dibatalkan/i);
  });
});

describe('Tutup buku tahunan', () => {
  // Tahun 2024 dipakai supaya tidak bertabrakan dengan data uji tahun lain.
  before(() => {
    acc.postJournal({
      tanggal: '2024-04-10', keterangan: 'penjualan tahun 2024',
      lines: [{ coa_kode: '1-1101', debit: 40_000_000 }, { coa_kode: '4-1101', kredit: 40_000_000 }],
    });
    acc.postJournal({
      tanggal: '2024-06-20', keterangan: 'beban tahun 2024',
      lines: [{ coa_kode: '5-2201', debit: 15_000_000 }, { coa_kode: '1-1101', kredit: 15_000_000 }],
    });
  });

  test('laba rugi tahun yang sudah ditutup tetap menampilkan hasil usahanya', () => {
    const sebelum = acc.labaRugi({ dari: '2024-01-01', sampai: '2024-12-31' });
    assert.equal(sebelum.total_pendapatan, 40_000_000);
    assert.equal(sebelum.shu_bersih, 25_000_000);

    acc.jurnalPenutup(2024, null);

    // Inti perbaikan: jurnal penutup memindahkan saldo nominal ke ekuitas,
    // tetapi laporan hasil usaha tahun itu tidak boleh ikut menjadi nol.
    const sesudah = acc.labaRugi({ dari: '2024-01-01', sampai: '2024-12-31' });
    assert.equal(sesudah.total_pendapatan, 40_000_000, 'pendapatan tetap terbaca sesudah tutup buku');
    assert.equal(sesudah.total_beban, 15_000_000, 'beban tetap terbaca sesudah tutup buku');
    assert.equal(sesudah.shu_bersih, 25_000_000, 'SHU tahun buku tetap terbaca sesudah tutup buku');
  });

  test('hasil usaha yang sudah ditutup tidak terhitung dua kali pada neraca', () => {
    const n = acc.neraca({ sampai: '2024-12-31' });
    assert.equal(n.seimbang, true, 'neraca tetap seimbang sesudah tutup buku');
    assert.equal(n.selisih, 0);
  });

  test('menolak penutupan tahun yang sama dua kali', () => {
    assert.throws(() => acc.jurnalPenutup(2024, null), /sudah pernah dibuat/i);
  });
});

describe('Penutupan periode', () => {
  test('menolak posting pada periode yang sudah ditutup', () => {
    acc.tutupPeriode(2025, 12, null);
    assert.throws(() => acc.postJournal({
      tanggal: '2025-12-20', keterangan: 'terlambat',
      lines: [{ coa_kode: '1-1101', debit: 1000 }, { coa_kode: '4-1101', kredit: 1000 }],
    }), /sudah ditutup/i);
  });

  test('periode dapat dibuka kembali untuk koreksi', () => {
    acc.bukaPeriode(2025, 12, null);
    const j = acc.postJournal({
      tanggal: '2025-12-20', keterangan: 'koreksi setelah dibuka',
      lines: [{ coa_kode: '1-1101', debit: 1000 }, { coa_kode: '4-1101', kredit: 1000 }],
    });
    assert.ok(j.id > 0);
  });
});
