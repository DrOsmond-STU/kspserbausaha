/**
 * Uji modul simpanan, pinjaman, persediaan, dan SHU.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ECMS_DATA_DIR = mkdtempSync(join(tmpdir(), 'ecms-uji-sp-'));
process.env.ECMS_DB = join(process.env.ECMS_DATA_DIR, 'uji.db');

const { migrate, run, get, scalar } = await import('../server/db.js');
const { pastikanDataAwal } = await import('../server/seed.js');
const simpanan = await import('../server/services/savings.js');
const pinjaman = await import('../server/services/loans.js');
const inventory = await import('../server/services/inventory.js');
const acc = await import('../server/services/accounting.js');

let anggotaId;

before(() => {
  migrate();
  pastikanDataAwal();
  anggotaId = run(
    `INSERT INTO anggota(nomor_anggota, nik, nama, penghasilan, cabang_id, tanggal_daftar,
       tanggal_gabung, status)
     VALUES('A0001','3171000000000001','Budi Uji',5000000,1,'2024-01-01','2024-01-01','aktif')`,
  ).lastInsertRowid;
});

// ------------------------------ Amortisasi ------------------------------

describe('Perhitungan jadwal angsuran', () => {
  test('metode flat: bunga tetap tiap bulan', () => {
    const h = pinjaman.hitungJadwal({ pokok: 12_000_000, tenor: 12, bunga_tahunan: 12,
      metode: 'flat', tanggal_mulai: '2026-01-01' });
    assert.equal(h.jadwal.length, 12);
    assert.equal(h.jadwal[0].bunga, 120_000);   // 12jt × 12% ÷ 12
    assert.equal(h.jadwal[11].bunga, 120_000);
    assert.equal(h.total_bunga, 1_440_000);
    assert.equal(h.jadwal[11].sisa_pokok, 0, 'pokok harus lunas di akhir tenor');
  });

  test('metode menurun: bunga mengecil mengikuti sisa pokok', () => {
    const h = pinjaman.hitungJadwal({ pokok: 12_000_000, tenor: 12, bunga_tahunan: 12,
      metode: 'menurun', tanggal_mulai: '2026-01-01' });
    assert.equal(h.jadwal[0].bunga, 120_000);
    assert.ok(h.jadwal[11].bunga < h.jadwal[0].bunga, 'bunga akhir lebih kecil');
    assert.ok(h.total_bunga < 1_440_000, 'total bunga menurun lebih kecil daripada flat');
    assert.equal(h.jadwal[11].sisa_pokok, 0);
  });

  test('metode anuitas: angsuran total tetap dan pokok lunas', () => {
    const h = pinjaman.hitungJadwal({ pokok: 24_000_000, tenor: 24, bunga_tahunan: 15,
      metode: 'anuitas', tanggal_mulai: '2026-01-01' });
    assert.equal(h.jadwal.length, 24);
    assert.equal(h.jadwal[23].sisa_pokok, 0, 'sisa pokok harus nol di akhir');
    const totalPokok = h.jadwal.reduce((s, j) => s + j.pokok, 0);
    assert.equal(totalPokok, 24_000_000, 'jumlah pokok harus sama dengan plafon');
  });

  test('jumlah pokok seluruh angsuran selalu sama dengan plafon', () => {
    for (const metode of ['flat', 'menurun', 'anuitas']) {
      for (const tenor of [3, 7, 11, 36]) {
        const h = pinjaman.hitungJadwal({ pokok: 10_000_000, tenor, bunga_tahunan: 18,
          metode, tanggal_mulai: '2026-01-01' });
        const total = h.jadwal.reduce((s, j) => s + j.pokok, 0);
        assert.equal(total, 10_000_000, `metode ${metode} tenor ${tenor} tidak menjumlah tepat`);
      }
    }
  });

  test('menolak tenor tidak valid', () => {
    assert.throws(() => pinjaman.hitungJadwal({ pokok: 1_000_000, tenor: 0,
      bunga_tahunan: 12, metode: 'flat', tanggal_mulai: '2026-01-01' }), /Tenor minimal/i);
  });
});

// ------------------------------- Simpanan -------------------------------

describe('Simpanan', () => {
  let rekId;

  test('membuka rekening dan menyetor menambah saldo', () => {
    const produk = get("SELECT id FROM produk_simpanan WHERE jenis = 'sukarela'");
    const rek = simpanan.bukaRekening({ anggota_id: anggotaId, produk_id: produk.id,
      tanggal_buka: '2026-01-02', setoran_awal: 1_000_000 });
    rekId = rek.id;
    const saldo = scalar('SELECT saldo FROM rekening_simpanan WHERE id = ?', [rekId]);
    assert.equal(saldo, 1_000_000);
  });

  test('penarikan mengurangi saldo', () => {
    simpanan.penarikan({ rekening_id: rekId, tanggal: '2026-01-10', nominal: 400_000 });
    assert.equal(scalar('SELECT saldo FROM rekening_simpanan WHERE id = ?', [rekId]), 600_000);
  });

  test('menolak penarikan melebihi saldo', () => {
    assert.throws(() => simpanan.penarikan({ rekening_id: rekId, tanggal: '2026-01-11',
      nominal: 99_000_000 }), /tidak mencukupi/i);
  });

  test('menolak penarikan simpanan pokok', () => {
    const pokok = get("SELECT id FROM produk_simpanan WHERE jenis = 'pokok'");
    const rek = simpanan.bukaRekening({ anggota_id: anggotaId, produk_id: pokok.id,
      tanggal_buka: '2026-01-02', setoran_awal: 500_000 });
    assert.throws(() => simpanan.penarikan({ rekening_id: rek.id, tanggal: '2026-01-12',
      nominal: 100_000 }), /tidak dapat ditarik/i);
  });

  test('simpanan pokok tidak boleh berganda', () => {
    const pokok = get("SELECT id FROM produk_simpanan WHERE jenis = 'pokok'");
    assert.throws(() => simpanan.bukaRekening({ anggota_id: anggotaId, produk_id: pokok.id,
      tanggal_buka: '2026-01-03' }), /sudah memiliki/i);
  });

  test('saldo rekening sama dengan saldo buku besar akun simpanan', () => {
    const saldoRek = scalar(
      `SELECT COALESCE(SUM(r.saldo),0) FROM rekening_simpanan r
         JOIN produk_simpanan p ON p.id = r.produk_id WHERE p.jenis = 'sukarela'`);
    const bukuBesar = acc.saldoAkun('2-1201', { sampai: '2026-12-31' }).saldo;
    assert.equal(saldoRek, bukuBesar, 'sub-ledger simpanan harus cocok dengan buku besar');
  });
});

// ------------------------------- Pinjaman -------------------------------

describe('Siklus pinjaman', () => {
  let pinjamanId;

  test('pengajuan menghitung skor kredit', () => {
    const produk = get("SELECT id FROM produk_pinjaman WHERE kode = 'PK'");
    const p = pinjaman.ajukan({ anggota_id: anggotaId, produk_id: produk.id,
      pokok: 6_000_000, tenor: 12, tanggal_pengajuan: '2026-02-01', tujuan: 'uji' });
    pinjamanId = p.id;
    assert.ok(p.skoring.skor >= 0 && p.skoring.skor <= 100);
    assert.equal(p.jadwal.length, 12);
  });

  test('pinjaman belum disetujui tidak dapat dicairkan', () => {
    assert.throws(() => pinjaman.cairkan(pinjamanId, { tanggal: '2026-02-02' }),
      /hanya pinjaman berstatus "disetujui"/i);
  });

  test('pencairan membentuk piutang di buku besar', () => {
    pinjaman.putuskan(pinjamanId, { setuju: true });
    const sebelum = acc.saldoAkun('1-1310', { sampai: '2026-12-31' }).saldo;
    pinjaman.cairkan(pinjamanId, { tanggal: '2026-02-05', metode: 'tunai' });
    const sesudah = acc.saldoAkun('1-1310', { sampai: '2026-12-31' }).saldo;
    assert.equal(sesudah - sebelum, 6_000_000, 'piutang bertambah sebesar pokok');
    const p = get('SELECT status, outstanding_pokok FROM pinjaman WHERE id = ?', [pinjamanId]);
    assert.equal(p.status, 'dicairkan');
    assert.equal(p.outstanding_pokok, 6_000_000);
  });

  test('angsuran dialokasikan denda lalu jasa lalu pokok', () => {
    const jadwal = get(
      'SELECT * FROM pinjaman_jadwal WHERE pinjaman_id = ? ORDER BY angsuran_ke LIMIT 1', [pinjamanId]);
    const h = pinjaman.bayarAngsuran({ pinjaman_id: pinjamanId, tanggal: jadwal.jatuh_tempo,
      nominal: jadwal.total });
    assert.equal(h.bayar_bunga, jadwal.bunga);
    assert.equal(h.bayar_pokok, jadwal.pokok);
    assert.equal(h.outstanding_pokok, 6_000_000 - jadwal.pokok);
  });

  test('menolak pembayaran melebihi total kewajiban', () => {
    assert.throws(() => pinjaman.bayarAngsuran({ pinjaman_id: pinjamanId,
      tanggal: '2026-03-05', nominal: 999_000_000 }), /melebihi total kewajiban/i);
  });

  test('pelunasan dipercepat menutup pinjaman', () => {
    pinjaman.pelunasanDipercepat({ pinjaman_id: pinjamanId, tanggal: '2026-04-01' });
    const p = get('SELECT status, outstanding_pokok FROM pinjaman WHERE id = ?', [pinjamanId]);
    assert.equal(p.status, 'lunas');
    assert.equal(p.outstanding_pokok, 0);
    const belum = scalar(
      "SELECT COUNT(*) FROM pinjaman_jadwal WHERE pinjaman_id = ? AND status <> 'lunas'", [pinjamanId]);
    assert.equal(belum, 0, 'seluruh jadwal harus berstatus lunas');
  });

  test('kolektibilitas mengikuti lama tunggakan', () => {
    const produk = get("SELECT id FROM produk_pinjaman WHERE kode = 'PK'");
    const p = pinjaman.ajukan({ anggota_id: anggotaId, produk_id: produk.id,
      pokok: 3_000_000, tenor: 12, tanggal_pengajuan: '2026-01-01' });
    pinjaman.putuskan(p.id, { setuju: true });
    pinjaman.cairkan(p.id, { tanggal: '2026-01-05' });

    // Belum jatuh tempo -> lancar
    assert.equal(pinjaman.perbaruiKolektibilitas(p.id, '2026-01-20').kolektibilitas, 1);
    // Tertunggak 100 hari -> kurang lancar (3)
    const k = pinjaman.perbaruiKolektibilitas(p.id, '2026-05-16');
    assert.equal(k.kolektibilitas, 3, `tunggakan ${k.tunggakan_hari} hari seharusnya kolektibilitas 3`);
    // Tertunggak lebih dari 270 hari -> macet (5)
    assert.equal(pinjaman.perbaruiKolektibilitas(p.id, '2027-06-01').kolektibilitas, 5);
  });

  test('batas jumlah pinjaman aktif per anggota ditegakkan', () => {
    const produk = get("SELECT id FROM produk_pinjaman WHERE kode = 'PK'");
    const p2 = pinjaman.ajukan({ anggota_id: anggotaId, produk_id: produk.id,
      pokok: 2_000_000, tenor: 6, tanggal_pengajuan: '2026-01-02' });
    pinjaman.putuskan(p2.id, { setuju: true });
    assert.throws(() => pinjaman.ajukan({ anggota_id: anggotaId, produk_id: produk.id,
      pokok: 1_000_000, tenor: 6, tanggal_pengajuan: '2026-01-03' }), /maksimal/i);
  });
});

// ------------------------------ Persediaan ------------------------------

describe('Persediaan rata-rata bergerak', () => {
  let barangId;
  let gudangId;

  before(() => {
    gudangId = scalar('SELECT id FROM gudang LIMIT 1');
    barangId = run(
      `INSERT INTO barang(kode, nama, satuan, harga_beli, harga_jual)
       VALUES('UJI01','Barang Uji','PCS',0,15000)`).lastInsertRowid;
  });

  test('HPP dihitung sebagai rata-rata bergerak', () => {
    inventory.mutasi({ barang_id: barangId, gudang_id: gudangId, tanggal: '2026-01-01',
      jenis: 'masuk', qty: 100, harga: 10_000 });
    assert.equal(scalar('SELECT harga_beli FROM barang WHERE id = ?', [barangId]), 10_000);

    // 100 unit @10.000 + 100 unit @12.000 -> rata-rata 11.000
    inventory.mutasi({ barang_id: barangId, gudang_id: gudangId, tanggal: '2026-01-05',
      jenis: 'masuk', qty: 100, harga: 12_000 });
    assert.equal(scalar('SELECT harga_beli FROM barang WHERE id = ?', [barangId]), 11_000);
  });

  test('menolak pengeluaran melebihi stok', () => {
    assert.throws(() => inventory.mutasi({ barang_id: barangId, gudang_id: gudangId,
      tanggal: '2026-01-06', jenis: 'keluar', qty: -9999 }), /tidak mencukupi/i);
  });

  test('saldo stok mengikuti mutasi', () => {
    inventory.mutasi({ barang_id: barangId, gudang_id: gudangId, tanggal: '2026-01-07',
      jenis: 'keluar', qty: -50 });
    assert.equal(inventory.stokBarang(barangId, gudangId), 150);
  });
});

// --------------------------------- SHU ---------------------------------

describe('Pembagian SHU', () => {
  test('total persentase alokasi tepat 100%', async () => {
    const shu = await import('../server/services/shu.js');
    const total = shu.persentaseAlokasi().reduce((s, a) => s + a.persentase, 0);
    assert.equal(total, 100);
  });

  test('simulasi membagi sesuai jasa modal dan jasa usaha', async () => {
    const shu = await import('../server/services/shu.js');
    const hasil = shu.simulasi(2026, 100_000_000);
    assert.equal(hasil.shu_bersih, 100_000_000);
    const cadangan = hasil.alokasi.find((a) => a.komponen === 'cadangan');
    assert.equal(cadangan.nominal, 25_000_000, 'dana cadangan 25% sesuai AD/ART bawaan');
    const totalAlokasi = hasil.alokasi.reduce((s, a) => s + a.nominal, 0);
    assert.equal(totalAlokasi, 100_000_000, 'alokasi menjumlah persis sama dengan SHU bersih');
  });

  test('alokasi tetap menjumlah persis pada nilai yang tidak habis dibagi', async () => {
    const shu = await import('../server/services/shu.js');
    // Nilai-nilai ini menyisakan pecahan rupiah pada hampir setiap komponen.
    // Bila selisih pembulatan dibiarkan, jurnal pengesahan SHU menjadi tidak
    // seimbang dan pembagian tidak pernah dapat diposting.
    for (const nilai of [93_118_107, 1, 7, 999_999_999, 12_345_679]) {
      const h = shu.simulasi(2026, nilai);
      const total = h.alokasi.reduce((s, a) => s + a.nominal, 0);
      assert.equal(total, nilai, `alokasi harus menjumlah persis untuk SHU ${nilai}`);
      assert.ok(h.alokasi.every((a) => a.nominal >= 0), 'tidak ada komponen bernilai negatif');
    }
  });

  test('pembagian per anggota menjumlah persis sama dengan pool jasa', async () => {
    const shu = await import('../server/services/shu.js');
    const h = shu.simulasi(2026, 93_118_107);
    if (!h.per_anggota.length) return;      // belum ada anggota bertransaksi pada data uji
    const poolModal = h.alokasi.find((a) => a.komponen === 'jasa_modal').nominal;
    const poolUsaha = h.alokasi.find((a) => a.komponen === 'jasa_usaha').nominal;
    const jm = h.per_anggota.reduce((s, r) => s + r.shu_jasa_modal, 0);
    const ju = h.per_anggota.reduce((s, r) => s + r.shu_jasa_usaha, 0);
    // Pool hanya terbagi habis bila ada dasar pembagiannya; bila dasar nol,
    // seluruh pool memang tidak dibagikan.
    if (h.dasar.total_simpanan > 0) assert.equal(jm, poolModal, 'jasa modal terbagi habis');
    if (h.dasar.total_transaksi > 0) assert.equal(ju, poolUsaha, 'jasa usaha terbagi habis');
    assert.equal(h.per_anggota.reduce((s, r) => s + r.shu_total, 0), jm + ju);
  });
});
