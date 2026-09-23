/**
 * Uji koreksi (ubah & batal) transaksi yang sudah tersimpan.
 *
 * Setiap koreksi harus membalik jurnal asli dan mengembalikan buku pembantu,
 * sehingga buku besar, neraca, dan seluruh buku pembantu tetap cocok.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ECMS_DATA_DIR = mkdtempSync(join(tmpdir(), 'ecms-uji-koreksi-'));
process.env.ECMS_DB = join(process.env.ECMS_DATA_DIR, 'uji.db');

const { migrate, run, get, all, scalar, setting } = await import('../server/db.js');
const { pastikanDataAwal } = await import('../server/seed.js');
const acc = await import('../server/services/accounting.js');
const savings = await import('../server/services/savings.js');
const loans = await import('../server/services/loans.js');
const trade = await import('../server/services/trade.js');
const inv = await import('../server/services/inventory.js');
const kas = await import('../server/services/kas.js');
const koreksi = await import('../server/services/koreksi.js');
const { can, cocok } = await import('../server/lib/rbac.js');

const TGL = '2026-02-10';
const ctx = { user: { username: 'uji', role: 'super_admin' } };
const saldo = (kode) => acc.saldoAkun(kode).saldo;

function rekonsiliasi() {
  const tb = acc.trialBalance({});
  assert.equal(tb.total_debit, tb.total_kredit, 'neraca saldo seimbang');
  assert.equal(acc.neraca({ sampai: '2026-12-31' }).selisih, 0, 'neraca seimbang');
  for (const r of all(`SELECT p.coa_kode, SUM(r.saldo) AS s FROM rekening_simpanan r
                         JOIN produk_simpanan p ON p.id = r.produk_id GROUP BY p.coa_kode`)) {
    assert.equal(saldo(r.coa_kode), r.s, `simpanan ${r.coa_kode}`);
  }
  assert.equal(saldo(setting('coa.piutang_pinjaman')),
    scalar("SELECT COALESCE(SUM(outstanding_pokok),0) FROM pinjaman WHERE status IN ('dicairkan','restrukturisasi')"),
    'piutang pinjaman');
  assert.equal(saldo(setting('coa.persediaan')),
    scalar('SELECT COALESCE(SUM(nilai_persediaan),0) FROM barang'), 'persediaan');
  assert.equal(saldo(setting('coa.hutang_usaha')),
    scalar("SELECT COALESCE(SUM(nominal - terbayar),0) FROM hutang_piutang WHERE jenis = 'hutang'"), 'hutang');
  assert.equal(saldo(setting('coa.piutang_usaha')),
    scalar("SELECT COALESCE(SUM(nominal - terbayar),0) FROM hutang_piutang WHERE jenis = 'piutang'"), 'piutang usaha');
}

let anggotaId;
let barangId;
let rekSukarela;

before(() => {
  migrate();
  pastikanDataAwal();
  anggotaId = run(`INSERT INTO anggota(nomor_anggota, nik, nama, status, tanggal_gabung, penghasilan, cabang_id)
                   VALUES('K-001','3170000000000101','Anggota Koreksi','aktif','2020-01-01',20000000,1)`).lastInsertRowid;
  barangId = run(`INSERT INTO barang(kode, nama, satuan, harga_jual) VALUES('KRS1','Gula 1 kg','PCS', 20000)`).lastInsertRowid;
  acc.postJournal({ tanggal: '2026-01-01', tipe: 'pembuka', sumber: 'manual', keterangan: 'Saldo awal',
    lines: [{ coa_kode: setting('coa.kas'), debit: 500_000_000 }, { coa_kode: setting('coa.cadangan'), kredit: 500_000_000 }] });
  const po = trade.buatPembelian({ tanggal: TGL, gudang_id: 1, items: [{ barang_id: barangId, qty: 100, harga: 15_000 }] }, ctx);
  trade.terimaBarang({ pembelian_id: po.id, tanggal: TGL }, ctx);
  const produk = get("SELECT id FROM produk_simpanan WHERE jenis = 'sukarela'");
  rekSukarela = savings.bukaRekening({ anggota_id: anggotaId, produk_id: produk.id, tanggal_buka: TGL,
    setoran_awal: 1_000_000 }, ctx).id;
});

describe('Hak akses koreksi', () => {
  test('koreksi tidak terbawa wildcard modul; hanya eksplisit atau *', () => {
    assert.equal(cocok(['pos.*'], 'pos.create'), true);
    assert.equal(cocok(['pos.*'], 'pos.koreksi'), false, 'kasir dengan pos.* tidak boleh membatalkan');
    assert.equal(cocok(['pos.koreksi'], 'pos.koreksi'), true);
    assert.equal(cocok(['*'], 'pos.koreksi'), true);
    assert.equal(can('kasir_toko', 'pos.koreksi'), false);
    assert.equal(can('manajer_unit', 'pos.koreksi'), true);
    assert.equal(can('pengurus', 'akuntansi.koreksi'), true);
  });
});

describe('Jurnal umum', () => {
  test('ubah jurnal manual: jurnal lama dibalik, jurnal pengganti terposting', () => {
    const j = acc.postJournal({ tanggal: TGL, sumber: 'manual', keterangan: 'Beban listrik',
      lines: [{ coa_kode: '5-2202', debit: 300_000 }, { coa_kode: setting('coa.kas'), kredit: 300_000 }] });
    const h = koreksi.ubahJurnal(j.id, { lines: [{ coa_kode: '5-2202', debit: 350_000 },
      { coa_kode: setting('coa.kas'), kredit: 350_000 }] }, 'salah nominal', ctx);
    assert.equal(get('SELECT status FROM jurnal WHERE id = ?', [j.id]).status, 'void');
    assert.equal(acc.saldoAkun('5-2202', { dari: TGL, sampai: TGL }).saldo, 350_000);
    assert.ok(h.pengganti.nomor);
    rekonsiliasi();
  });

  test('jurnal otomatis modul tidak dapat diubah dari buku besar', () => {
    const t = get("SELECT jurnal_id FROM transaksi_simpanan WHERE status = 'posted' LIMIT 1");
    assert.throws(() => koreksi.ubahJurnal(t.jurnal_id, { lines: [] }, 'x', ctx), /otomatis/);
  });

  test('pembatalan jurnal di periode tertutup dibukukan pada tanggal koreksi', () => {
    const j = acc.postJournal({ tanggal: '2026-01-20', sumber: 'manual', keterangan: 'Jurnal Januari',
      lines: [{ coa_kode: '5-2203', debit: 100_000 }, { coa_kode: setting('coa.kas'), kredit: 100_000 }] });
    acc.tutupPeriode(2026, 1, ctx);
    try {
      const balik = acc.voidJournal(j.id, 'salah akun', ctx);
      const jb = get('SELECT tanggal FROM jurnal WHERE id = ?', [balik.id]);
      assert.notEqual(jb.tanggal.slice(0, 7), '2026-01', 'jurnal balik tidak masuk periode tertutup');
      assert.equal(acc.saldoAkun('5-2203', { dari: '2026-01-01', sampai: '2026-01-31' }).saldo, 100_000,
        'laporan periode tertutup tidak berubah');
    } finally {
      acc.bukaPeriode(2026, 1, ctx);
    }
    rekonsiliasi();
  });
});

describe('Kas & bank', () => {
  test('ubah bukti kas: lama batal, pengganti bernomor baru', () => {
    const b = kas.buatBuktiKas({ jenis: 'kas_keluar', coa_kas: setting('coa.kas'), coa_lawan: '5-2203',
      nominal: 120_000, tanggal: TGL, keterangan: 'ATK' }, ctx);
    const h = kas.ubahBuktiKas(b.id, { nominal: 150_000 }, 'salah nominal', ctx);
    assert.equal(get('SELECT status FROM kas_bank WHERE id = ?', [b.id]).status, 'batal');
    assert.notEqual(h.pengganti.nomor, b.nomor);
    assert.equal(get('SELECT nominal FROM kas_bank WHERE id = ?', [h.pengganti.id]).nominal, 150_000);
    rekonsiliasi();
  });
});

describe('Penjualan POS', () => {
  test('batal penjualan: stok, piutang, simpanan, poin & jurnal kembali', () => {
    const stokAwal = inv.totalStok(barangId);
    const nilaiAwal = saldo(setting('coa.persediaan'));
    const saldoRek = get('SELECT saldo FROM rekening_simpanan WHERE id = ?', [rekSukarela]).saldo;
    const a = trade.jual({ tanggal: TGL, gudang_id: 1, anggota_id: anggotaId, metode_bayar: 'piutang',
      items: [{ barang_id: barangId, qty: 3 }] }, ctx);
    const b = trade.jual({ tanggal: TGL, gudang_id: 1, anggota_id: anggotaId, metode_bayar: 'potong_simpanan',
      items: [{ barang_id: barangId, qty: 2 }] }, ctx);
    rekonsiliasi();
    koreksi.batalPenjualan(a.id, 'salah input', ctx);
    koreksi.batalPenjualan(b.id, 'salah input', ctx);
    assert.equal(inv.totalStok(barangId), stokAwal, 'stok kembali');
    assert.equal(saldo(setting('coa.persediaan')), nilaiAwal, 'nilai persediaan kembali');
    assert.equal(get('SELECT saldo FROM rekening_simpanan WHERE id = ?', [rekSukarela]).saldo, saldoRek, 'simpanan kembali');
    assert.equal(scalar('SELECT COALESCE(SUM(poin),0) FROM loyalty_poin WHERE anggota_id = ?', [anggotaId]), 0, 'poin dibatalkan');
    assert.equal(get('SELECT status FROM penjualan WHERE id = ?', [a.id]).status, 'batal');
    assert.throws(() => koreksi.batalPenjualan(a.id, 'lagi', ctx), /sudah dibatalkan/);
    assert.throws(() => trade.returPenjualan({ penjualan_id: a.id }, ctx), /dibatalkan/);
    rekonsiliasi();
  });

  test('ubah penjualan membuat transaksi pengganti', () => {
    const a = trade.jual({ tanggal: TGL, gudang_id: 1, items: [{ barang_id: barangId, qty: 1 }] }, ctx);
    const h = koreksi.ubahPenjualan(a.id, { items: [{ barang_id: barangId, qty: 4 }] }, 'jumlah salah', ctx);
    assert.equal(get('SELECT total FROM penjualan WHERE id = ?', [h.pengganti.id]).total, 80_000);
    rekonsiliasi();
  });
});

describe('Pembelian & persediaan', () => {
  test('batal penerimaan barang & pembayaran utang', () => {
    const po = trade.buatPembelian({ tanggal: TGL, gudang_id: 1, items: [{ barang_id: barangId, qty: 10, harga: 18_000 }] }, ctx);
    trade.terimaBarang({ pembelian_id: po.id, tanggal: TGL }, ctx);
    const hp = get("SELECT id FROM hutang_piutang WHERE referensi = ?", [`pembelian:${po.id}`]);
    trade.bayarHutangPiutang({ id: hp.id, tanggal: TGL, nominal: 50_000 }, ctx);
    rekonsiliasi();
    assert.throws(() => koreksi.batalPenerimaan(po.id, 'x', ctx), /sudah dibayar/);
    const bayar = koreksi.riwayatPembayaran(hp.id).find((r) => r.status === 'posted');
    koreksi.batalPembayaranHP(bayar.jurnal_id, 'salah transfer', ctx);
    rekonsiliasi();
    koreksi.batalPenerimaan(po.id, 'barang dikembalikan', ctx);
    assert.equal(get('SELECT status FROM pembelian WHERE id = ?', [po.id]).status, 'disetujui');
    rekonsiliasi();
  });

  test('batal penyesuaian stok', () => {
    const m = inv.penyesuaianStok({ barang_id: barangId, gudang_id: 1, tanggal: TGL, jenis: 'masuk', qty: 5, harga: 16_000 }, ctx);
    koreksi.batalPenyesuaianStok(m.id, 'salah hitung', ctx);
    const k = inv.penyesuaianStok({ barang_id: barangId, gudang_id: 1, tanggal: TGL, jenis: 'keluar', qty: 2 }, ctx);
    koreksi.batalPenyesuaianStok(k.id, 'barang ditemukan', ctx);
    assert.throws(() => koreksi.batalPenyesuaianStok(k.id, 'lagi', ctx), /sudah dibatalkan/);
    rekonsiliasi();
  });
});

describe('Simpanan', () => {
  test('ubah setoran', () => {
    const s = savings.setoran({ rekening_id: rekSukarela, tanggal: TGL, nominal: 200_000 }, ctx);
    const h = koreksi.ubahTransaksiSimpanan(s.id, { nominal: 250_000 }, 'salah nominal', ctx);
    assert.equal(get('SELECT kredit FROM transaksi_simpanan WHERE id = ?', [h.pengganti.id]).kredit, 250_000);
    rekonsiliasi();
  });
});

describe('Pinjaman', () => {
  test('batal angsuran terakhir mengembalikan jadwal persis seperti sebelum dibayar', () => {
    const produk = get("SELECT id FROM produk_pinjaman WHERE kode = 'PP'");
    const p = loans.ajukan({ anggota_id: anggotaId, produk_id: produk.id, pokok: 12_000_000, tenor: 12,
      tanggal_pengajuan: TGL }, ctx);
    loans.putuskan(p.id, { setuju: true }, ctx);
    loans.cairkan(p.id, { tanggal: TGL }, ctx);
    const jadwal = () => all(`SELECT angsuran_ke, bayar_pokok, bayar_bunga, status FROM pinjaman_jadwal
                                WHERE pinjaman_id = ? ORDER BY angsuran_ke`, [p.id]);
    const pin = () => get('SELECT outstanding_pokok, outstanding_bunga, status FROM pinjaman WHERE id = ?', [p.id]);
    loans.bayarAngsuran({ pinjaman_id: p.id, tanggal: '2026-03-10', nominal: 1_150_000 }, ctx);
    const sebelum = { jadwal: jadwal(), pin: pin() };
    // Pembayaran besar yang juga mengurangi pokok jadwal terakhir
    const a2 = loans.bayarAngsuran({ pinjaman_id: p.id, tanggal: '2026-04-10', nominal: 3_000_000 }, ctx);
    rekonsiliasi();
    const a1 = get("SELECT id FROM pinjaman_angsuran WHERE pinjaman_id = ? ORDER BY id LIMIT 1", [p.id]);
    assert.throws(() => koreksi.batalAngsuran(a1.id, 'x', ctx), /terakhir/);
    koreksi.batalAngsuran(a2.id, 'salah nominal', ctx);
    assert.deepEqual(jadwal(), sebelum.jadwal);
    assert.deepEqual(pin(), sebelum.pin);
    rekonsiliasi();

    const h = koreksi.ubahAngsuran(a1.id, { nominal: 1_200_000 }, 'nominal kurang', ctx);
    assert.equal(h.pengganti.total_bayar, 1_200_000);
    rekonsiliasi();
  });

  test('batal pelunasan dipercepat mengembalikan pinjaman berjalan', () => {
    const produk = get("SELECT id FROM produk_pinjaman WHERE kode = 'PK'");
    const p = loans.ajukan({ anggota_id: anggotaId, produk_id: produk.id, pokok: 3_000_000, tenor: 6,
      tanggal_pengajuan: TGL }, ctx);
    loans.putuskan(p.id, { setuju: true }, ctx);
    loans.cairkan(p.id, { tanggal: TGL }, ctx);
    const l = loans.pelunasanDipercepat({ pinjaman_id: p.id, tanggal: '2026-03-01' }, ctx);
    assert.equal(get('SELECT status FROM pinjaman WHERE id = ?', [p.id]).status, 'lunas');
    rekonsiliasi();
    const ang = get('SELECT id FROM pinjaman_angsuran WHERE nomor = ?', [l.nomor]);
    koreksi.batalAngsuran(ang.id, 'salah anggota', ctx);
    const sesudah = get('SELECT status, outstanding_pokok FROM pinjaman WHERE id = ?', [p.id]);
    assert.equal(sesudah.status, 'dicairkan');
    assert.equal(sesudah.outstanding_pokok, 3_000_000);
    rekonsiliasi();
    koreksi.batalPencairan(p.id, 'batal cair', ctx);
    assert.equal(get('SELECT status FROM pinjaman WHERE id = ?', [p.id]).status, 'disetujui');
    rekonsiliasi();
  });
});

describe('Rute koreksi & hak akses', () => {
  test('kasir tidak dapat membatalkan penjualan, manajer dapat', async () => {
    process.env.HOST = '127.0.0.1';
    process.env.PORT = '0';
    const server = (await import('../server/index.js')).default;
    if (!server.listening) await new Promise((r) => server.once('listening', r));
    const asal = `http://127.0.0.1:${server.address().port}`;
    const { hashPassword } = await import('../server/lib/auth.js');
    const buat = (username, role) => {
      const { hash, salt } = hashPassword('Rahasia!2026uji');
      run(`INSERT INTO users(username, nama, email, password_hash, password_salt, role, status)
           VALUES(?,?,?,?,?,?,'aktif')`, [username, username, `${username}@uji.id`, hash, salt, role]);
    };
    buat('kasir.uji', 'kasir_toko');
    buat('manajer.uji', 'manajer_unit');
    const masuk = async (u) => {
      const r = await fetch(`${asal}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, password: 'Rahasia!2026uji' }) });
      return r.headers.get('set-cookie')?.split(';')[0];
    };
    const jualan = trade.jual({ tanggal: TGL, gudang_id: 1, items: [{ barang_id: barangId, qty: 1 }] }, ctx);
    const batal = (kuki) => fetch(`${asal}/api/koreksi/penjualan/${jualan.id}/batal`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: kuki },
      body: JSON.stringify({ alasan: 'uji hak akses' }) });
    try {
      const kasir = await masuk('kasir.uji');
      const manajer = await masuk('manajer.uji');
      assert.ok(kasir && manajer, 'kedua pengguna uji dapat masuk');
      assert.equal((await batal(kasir)).status, 403, 'kasir ditolak');
      assert.equal((await batal(manajer)).status, 201, 'manajer boleh membatalkan');
      assert.equal(get('SELECT status FROM penjualan WHERE id = ?', [jualan.id]).status, 'batal');
      rekonsiliasi();
    } finally {
      server.close();
    }
  });
});
