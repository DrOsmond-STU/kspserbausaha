/**
 * Uji jurnal otomatis lintas modul.
 *
 * Setiap alur bisnis dijalankan lewat service yang sama dengan yang dipakai
 * antarmuka, lalu buku pembantu (saldo simpanan, outstanding pinjaman, nilai
 * stok, register aset, hutang/piutang) dicocokkan dengan buku besar. Bila ada
 * transaksi yang lupa menjurnal - atau menjurnal ke akun yang keliru -
 * rekonsiliasi ini langsung memperlihatkan selisihnya.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ECMS_DATA_DIR = mkdtempSync(join(tmpdir(), 'ecms-uji-jurnal-'));
process.env.ECMS_DB = join(process.env.ECMS_DATA_DIR, 'uji.db');

const { migrate, run, get, all, scalar, setting, setSetting } = await import('../server/db.js');
const { pastikanDataAwal } = await import('../server/seed.js');
const acc = await import('../server/services/accounting.js');
const savings = await import('../server/services/savings.js');
const loans = await import('../server/services/loans.js');
const trade = await import('../server/services/trade.js');
const inv = await import('../server/services/inventory.js');
const assets = await import('../server/services/assets.js');

const TGL = '2026-02-10';
const ctx = { user: { username: 'uji', role: 'super_admin' } };
const saldo = (kode) => acc.saldoAkun(kode).saldo;

/** Mencocokkan seluruh buku pembantu dengan buku besar. */
function rekonsiliasi() {
  const tb = acc.trialBalance({});
  assert.equal(tb.total_debit, tb.total_kredit, 'neraca saldo seimbang');
  const n = acc.neraca({ sampai: '2026-12-31' });
  assert.equal(n.selisih, 0, 'aset = kewajiban + ekuitas');

  for (const r of all(`SELECT p.coa_kode, SUM(r.saldo) AS s FROM rekening_simpanan r
                         JOIN produk_simpanan p ON p.id = r.produk_id GROUP BY p.coa_kode`)) {
    assert.equal(saldo(r.coa_kode), r.s, `simpanan ${r.coa_kode}`);
  }
  const outstanding = scalar(`SELECT COALESCE(SUM(outstanding_pokok),0) FROM pinjaman
                               WHERE status IN ('dicairkan','restrukturisasi')`);
  assert.equal(saldo(setting('coa.piutang_pinjaman')), outstanding, 'piutang pinjaman');
  const stok = scalar('SELECT COALESCE(SUM(nilai_persediaan),0) FROM barang');
  assert.equal(saldo(setting('coa.persediaan')), stok, 'persediaan');
  const hutang = scalar("SELECT COALESCE(SUM(nominal - terbayar),0) FROM hutang_piutang WHERE jenis = 'hutang'");
  assert.equal(saldo(setting('coa.hutang_usaha')), hutang, 'hutang usaha');
  const piutang = scalar("SELECT COALESCE(SUM(nominal - terbayar),0) FROM hutang_piutang WHERE jenis = 'piutang'");
  assert.equal(saldo(setting('coa.piutang_usaha')), piutang, 'piutang usaha');
  const aset = scalar("SELECT COALESCE(SUM(harga_perolehan),0) FROM aset_tetap WHERE status <> 'dilepas'");
  assert.equal(saldo(setting('coa.aset_tetap')), aset, 'aset tetap');
  const akum = scalar("SELECT COALESCE(SUM(akumulasi_penyusutan),0) FROM aset_tetap WHERE status <> 'dilepas'");
  assert.equal(saldo(setting('coa.akumulasi_penyusutan')) + akum, 0, 'akumulasi penyusutan');
}

let anggotaId;
let anggota2Id;
let barangId;
let rekSukarela;

before(() => {
  migrate();
  pastikanDataAwal();
  const tambahAnggota = (no, nik) => run(
    `INSERT INTO anggota(nomor_anggota, nik, nama, status, tanggal_gabung, penghasilan, cabang_id)
     VALUES(?,?,?, 'aktif', '2020-01-01', 20000000, 1)`, [no, nik, `Anggota ${no}`]).lastInsertRowid;
  anggotaId = tambahAnggota('A-001', '3170000000000001');
  anggota2Id = tambahAnggota('A-002', '3170000000000002');
  barangId = run(`INSERT INTO barang(kode, nama, satuan, harga_jual, harga_anggota)
                  VALUES('BRG1','Beras 5 kg','KRG', 80000, 78000)`).lastInsertRowid;
  // Modal awal supaya kas cukup untuk pencairan & pembelian
  acc.postJournal({ tanggal: '2026-01-01', tipe: 'pembuka', sumber: 'manual', keterangan: 'Saldo awal',
    lines: [{ coa_kode: setting('coa.kas'), debit: 500_000_000 },
      { coa_kode: setting('coa.cadangan'), kredit: 500_000_000 }] });
});

describe('Pemetaan akun dari Parameter Sistem', () => {
  test('tidak ada nilai bawaan tersembunyi: pemetaan kosong ditolak dengan pesan jelas', () => {
    const asli = setting('coa.kas');
    run("DELETE FROM settings WHERE key = 'coa.kas'");
    try {
      assert.throws(() => acc.AKUN.kas(), /Pemetaan akun .* belum diatur/);
    } finally {
      setSetting('coa.kas', asli);
    }
  });

  test('mengganti pemetaan langsung mengubah akun jurnal otomatis', () => {
    const asli = setting('coa.pendapatan_lain');
    setSetting('coa.pendapatan_lain', '4-1203');
    try {
      assert.equal(acc.AKUN.pendapatan_lain(), '4-1203');
    } finally {
      setSetting('coa.pendapatan_lain', asli);
    }
  });
});

describe('Simpanan', () => {
  test('setoran, penarikan, dan pembatalan transaksi tetap sejalan dengan buku besar', () => {
    const produk = get("SELECT id FROM produk_simpanan WHERE jenis = 'sukarela'");
    const rek = savings.bukaRekening({ anggota_id: anggotaId, produk_id: produk.id, tanggal_buka: TGL,
      setoran_awal: 2_000_000 }, ctx);
    rekSukarela = rek.id;
    savings.setoran({ rekening_id: rek.id, tanggal: TGL, nominal: 500_000 }, ctx);
    const tarik = savings.penarikan({ rekening_id: rek.id, tanggal: TGL, nominal: 300_000 }, ctx);
    rekonsiliasi();

    savings.batalTransaksi(tarik.id, 'salah nominal', ctx);
    assert.equal(get('SELECT saldo FROM rekening_simpanan WHERE id = ?', [rek.id]).saldo, 2_500_000);
    assert.equal(get('SELECT status FROM transaksi_simpanan WHERE id = ?', [tarik.id]).status, 'batal');
    rekonsiliasi();
  });

  test('jurnal setoran tidak dapat dibatalkan dari buku besar', () => {
    const t = get("SELECT jurnal_id FROM transaksi_simpanan WHERE jenis = 'setoran' AND status = 'posted' LIMIT 1");
    assert.throws(() => acc.voidJournal(t.jurnal_id, 'coba'), /dibentuk otomatis/);
  });
});

describe('Pinjaman', () => {
  test('pencairan & angsuran menjurnal piutang, pendapatan jasa, dan biaya admin', () => {
    const produk = get("SELECT id FROM produk_pinjaman WHERE kode = 'PK'");
    const p = loans.ajukan({ anggota_id: anggotaId, produk_id: produk.id, pokok: 6_000_000, tenor: 6,
      tanggal_pengajuan: TGL }, ctx);
    loans.putuskan(p.id, { setuju: true }, ctx);
    loans.cairkan(p.id, { tanggal: TGL }, ctx);
    rekonsiliasi();
    const jadwal = get('SELECT total FROM pinjaman_jadwal WHERE pinjaman_id = ? AND angsuran_ke = 1', [p.id]);
    loans.bayarAngsuran({ pinjaman_id: p.id, tanggal: '2026-03-10', nominal: jadwal.total }, ctx);
    rekonsiliasi();
    assert.ok(saldo(setting('coa.pendapatan_bunga')) > 0, 'pendapatan jasa terbentuk');
    assert.ok(saldo(setting('coa.pendapatan_admin')) > 0, 'pendapatan administrasi terbentuk');
  });
});

describe('Persediaan, pembelian & penjualan', () => {
  test('penerimaan barang menjurnal persediaan, PPN masukan, dan utang', () => {
    const po = trade.buatPembelian({ tanggal: TGL, gudang_id: 1, pajak: 110_000,
      items: [{ barang_id: barangId, qty: 20, harga: 50_000 }] }, ctx);
    trade.terimaBarang({ pembelian_id: po.id, tanggal: TGL }, ctx);
    assert.equal(saldo(setting('coa.ppn_masukan')), 110_000);
    rekonsiliasi();
  });

  test('pembelian yang belum diterima dapat diubah dan dibatalkan tanpa jurnal', () => {
    const po = trade.buatPembelian({ tanggal: TGL, gudang_id: 1,
      items: [{ barang_id: barangId, qty: 5, harga: 50_000 }] }, ctx);
    const ubah = trade.ubahPembelian(po.id, { items: [{ barang_id: barangId, qty: 7, harga: 50_000 }] }, ctx);
    assert.equal(ubah.total, 350_000);
    trade.batalPembelian(po.id, 'tidak jadi', ctx);
    assert.throws(() => trade.terimaBarang({ pembelian_id: po.id }, ctx), /batal/);
    rekonsiliasi();
  });

  test('penyesuaian stok manual kini selalu dijurnal', () => {
    inv.penyesuaianStok({ barang_id: barangId, gudang_id: 1, tanggal: TGL, jenis: 'keluar', qty: 1 }, ctx);
    inv.penyesuaianStok({ barang_id: barangId, gudang_id: 1, tanggal: TGL, jenis: 'masuk', qty: 2, harga: 50_000 }, ctx);
    rekonsiliasi();
  });

  test('penjualan kredit, potong simpanan, lalu retur membalik piutang & simpanan', () => {
    const kredit = trade.jual({ tanggal: TGL, gudang_id: 1, anggota_id: anggotaId, metode_bayar: 'piutang',
      pajak: 11_000, items: [{ barang_id: barangId, qty: 2 }] }, ctx);
    const potong = trade.jual({ tanggal: TGL, gudang_id: 1, anggota_id: anggotaId,
      metode_bayar: 'potong_simpanan', items: [{ barang_id: barangId, qty: 1 }] }, ctx);
    rekonsiliasi();

    const saldoSblm = get('SELECT saldo FROM rekening_simpanan WHERE id = ?', [rekSukarela]).saldo;
    trade.returPenjualan({ penjualan_id: potong.id, tanggal: TGL }, ctx);
    assert.equal(get('SELECT saldo FROM rekening_simpanan WHERE id = ?', [rekSukarela]).saldo,
      saldoSblm + potong.total, 'dana retur kembali ke simpanan');

    const r = trade.returPenjualan({ penjualan_id: kredit.id, tanggal: TGL,
      items: [{ barang_id: barangId, qty: 1 }] }, ctx);
    assert.equal(r.pajak_retur, 5_500, 'PPN ikut dibalik secara proporsional');
    assert.throws(() => trade.returPenjualan({ penjualan_id: kredit.id, tanggal: TGL,
      items: [{ barang_id: barangId, qty: 2 }] }, ctx), /tidak valid/, 'retur melebihi sisa ditolak');
    rekonsiliasi();
  });
});

describe('Aset tetap', () => {
  test('perolehan, pemeliharaan, penyusutan, dan hapus aset dijurnal otomatis', () => {
    const a = assets.tambah({ kode: 'AST-U1', nama: 'Laptop', kategori: 'inventaris', tanggal_perolehan: TGL,
      harga_perolehan: 12_000_000, umur_manfaat: 4, sumber_perolehan: 'kas' }, ctx);
    assert.ok(a.jurnal, 'perolehan dijurnal');
    const m = assets.maintenance(a.id, { tanggal: TGL, biaya: 250_000, jenis: 'servis' }, ctx);
    assert.ok(m.jurnal, 'biaya pemeliharaan dijurnal');
    assert.equal(saldo(setting('coa.beban_pemeliharaan')), 250_000);
    assets.jalankanPenyusutan('2026-02', ctx);
    rekonsiliasi();
    assert.throws(() => assets.hapus(a.id, ctx), /sudah disusutkan/);

    const salah = assets.tambah({ kode: 'AST-U2', nama: 'Salah input', tanggal_perolehan: TGL,
      harga_perolehan: 5_000_000, sumber_perolehan: 'hutang' }, ctx);
    rekonsiliasi();
    assets.hapus(salah.id, ctx);
    rekonsiliasi();
  });
});

describe('Anggota keluar', () => {
  test('seluruh simpanan dikembalikan dan dijurnal otomatis', () => {
    const pokok = get("SELECT id FROM produk_simpanan WHERE jenis = 'pokok'");
    const rek = savings.bukaRekening({ anggota_id: anggota2Id, produk_id: pokok.id, tanggal_buka: TGL,
      setoran_awal: 500_000 }, ctx);
    assert.throws(() => savings.tutupRekening(rek.id, {}, ctx), /anggota keluar/);
    run("UPDATE anggota SET status = 'keluar' WHERE id = ?", [anggota2Id]);
    const t = savings.tutupRekening(rek.id, { tanggal: TGL }, ctx);
    assert.equal(t.dikembalikan, 500_000);
    assert.equal(get('SELECT status FROM rekening_simpanan WHERE id = ?', [rek.id]).status, 'tutup');
    rekonsiliasi();
  });
});

describe('Jurnal berulang', () => {
  test('diposting otomatis saat jatuh tempo, sekali per jadwal', () => {
    const template = JSON.stringify(acc.validasiTemplate([
      { coa_kode: '5-2204', debit: 1_000_000 }, { coa_kode: setting('coa.kas'), kredit: 1_000_000 }]));
    const id = run(`INSERT INTO jurnal_recurring(nama, frekuensi, tanggal_mulai, template)
                    VALUES('Sewa uji','bulanan','2026-01-31',?)`, [template]).lastInsertRowid;
    const h = acc.jalankanRecurring({ sampai: '2026-04-15', id });
    assert.deepEqual(h.template[0].dibuat.map((d) => d.tanggal), ['2026-01-31', '2026-02-28', '2026-03-31']);
    const ulang = acc.jalankanRecurring({ sampai: '2026-04-15', id });
    assert.equal(ulang.jumlah_jurnal, 0, 'tidak terposting dua kali');
    assert.equal(acc.jadwalBerikutnya(get('SELECT * FROM jurnal_recurring WHERE id = ?', [id])), '2026-04-30');
  });

  test('template tidak seimbang ditolak', () => {
    assert.throws(() => acc.validasiTemplate([
      { coa_kode: '5-2204', debit: 1_000 }, { coa_kode: setting('coa.kas'), kredit: 900 }]), /tidak seimbang/);
  });
});
