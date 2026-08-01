/**
 * Modul 4 - Simpanan (rute API).
 */
import { createRouter, notFound } from '../lib/http.js';
import { all, get, scalar } from '../db.js';
import { idParam, num, str, date, oneOf, today } from '../lib/util.js';
import * as svc from '../services/savings.js';

const router = createRouter();

router.get('/api/simpanan/rekening', 'simpanan.view', ({ query }) => {
  const w = [];
  const p = [];
  if (query.q) {
    w.push('(r.nomor_rekening LIKE ? OR a.nama LIKE ? OR a.nomor_anggota LIKE ?)');
    p.push(`%${query.q}%`, `%${query.q}%`, `%${query.q}%`);
  }
  if (query.anggota_id) { w.push('r.anggota_id = ?'); p.push(Number(query.anggota_id)); }
  if (query.produk_id) { w.push('r.produk_id = ?'); p.push(Number(query.produk_id)); }
  if (query.status) { w.push('r.status = ?'); p.push(query.status); }
  const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
  const limit = Math.min(Number(query.limit) || 50, 500);
  const offset = Math.max(Number(query.offset) || 0, 0);
  const data = all(
    `SELECT r.*, a.nama AS anggota_nama, a.nomor_anggota, p.nama AS produk_nama, p.jenis,
            p.bunga_tahunan, p.boleh_tarik
       FROM rekening_simpanan r
       JOIN anggota a ON a.id = r.anggota_id
       JOIN produk_simpanan p ON p.id = r.produk_id
       ${where} ORDER BY r.id DESC LIMIT ? OFFSET ?`, [...p, limit, offset]);
  const total = scalar(
    `SELECT COUNT(*) FROM rekening_simpanan r JOIN anggota a ON a.id = r.anggota_id ${where}`, p);
  return { data, total, limit, offset };
});

router.get('/api/simpanan/ringkasan', 'simpanan.view', () => {
  const perProduk = all(
    `SELECT p.id, p.kode, p.nama, p.jenis, COUNT(r.id) AS jumlah_rekening,
            COALESCE(SUM(r.saldo),0) AS saldo
       FROM produk_simpanan p LEFT JOIN rekening_simpanan r ON r.produk_id = p.id AND r.status <> 'tutup'
      GROUP BY p.id ORDER BY p.kode`);
  const mutasiBulan = all(
    `SELECT substr(tanggal,1,7) AS periode, SUM(kredit) AS setoran, SUM(debit) AS penarikan
       FROM transaksi_simpanan GROUP BY periode ORDER BY periode DESC LIMIT 12`).reverse();
  return {
    total_simpanan: svc.totalSimpanan(),
    jumlah_rekening: scalar("SELECT COUNT(*) FROM rekening_simpanan WHERE status <> 'tutup'"),
    jumlah_penyimpan: scalar("SELECT COUNT(DISTINCT anggota_id) FROM rekening_simpanan WHERE status <> 'tutup'"),
    per_produk: perProduk,
    mutasi_bulanan: mutasiBulan,
  };
});

router.get('/api/simpanan/rekening/:id', 'simpanan.view', ({ params, query }) => {
  const id = idParam(params);
  const rek = get(
    `SELECT r.*, a.nama AS anggota_nama, a.nomor_anggota, a.telepon, p.nama AS produk_nama,
            p.jenis, p.bunga_tahunan, p.boleh_tarik, p.setoran_minimal
       FROM rekening_simpanan r
       JOIN anggota a ON a.id = r.anggota_id
       JOIN produk_simpanan p ON p.id = r.produk_id WHERE r.id = ?`, [id]);
  if (!rek) throw notFound('Rekening simpanan tidak ditemukan');
  const limit = Math.min(Number(query.limit) || 100, 1000);
  return {
    ...rek,
    saldo_tersedia: rek.saldo - rek.saldo_blokir,
    mutasi: all(
      `SELECT * FROM transaksi_simpanan WHERE rekening_id = ? ORDER BY tanggal DESC, id DESC LIMIT ?`,
      [id, limit]),
  };
});

/** Buku tabungan digital (cetak per periode). */
router.get('/api/simpanan/rekening/:id/buku', 'simpanan.view', ({ params, query }) => {
  const id = idParam(params);
  const rek = get(
    `SELECT r.*, a.nama AS anggota_nama, a.nomor_anggota, p.nama AS produk_nama
       FROM rekening_simpanan r JOIN anggota a ON a.id = r.anggota_id
       JOIN produk_simpanan p ON p.id = r.produk_id WHERE r.id = ?`, [id]);
  if (!rek) throw notFound('Rekening simpanan tidak ditemukan');
  const dari = query.dari || `${new Date().getFullYear()}-01-01`;
  const sampai = query.sampai || today();
  const mutasi = all(
    `SELECT * FROM transaksi_simpanan WHERE rekening_id = ? AND tanggal BETWEEN ? AND ?
      ORDER BY tanggal, id`, [id, dari, sampai]);
  const saldoAwal = scalar(
    `SELECT COALESCE((SELECT saldo_akhir FROM transaksi_simpanan
        WHERE rekening_id = ? AND tanggal < ? ORDER BY tanggal DESC, id DESC LIMIT 1), 0)`, [id, dari]);
  return {
    rekening: rek, periode: { dari, sampai }, saldo_awal: saldoAwal, mutasi,
    total_setoran: mutasi.reduce((s, m) => s + m.kredit, 0),
    total_penarikan: mutasi.reduce((s, m) => s + m.debit, 0),
    saldo_akhir: mutasi.length ? mutasi[mutasi.length - 1].saldo_akhir : saldoAwal,
  };
});

router.post('/api/simpanan/rekening', 'simpanan.create', ({ body, ctx }) => svc.bukaRekening({
  anggota_id: num(body, 'anggota_id', { min: 1 }),
  produk_id: num(body, 'produk_id', { min: 1 }),
  tanggal_buka: date(body, 'tanggal_buka', { required: false, dflt: today() }),
  setoran_awal: num(body, 'setoran_awal', { required: false, min: 0 }),
  cabang_id: body.cabang_id ? Number(body.cabang_id) : null,
}, ctx));

router.post('/api/simpanan/setoran', 'simpanan.create', ({ body, ctx }) => svc.setoran({
  rekening_id: num(body, 'rekening_id', { min: 1 }),
  tanggal: date(body, 'tanggal', { required: false, dflt: today() }),
  nominal: num(body, 'nominal', { min: 1, label: 'Nominal setoran' }),
  keterangan: str(body, 'keterangan', { required: false, max: 200 }),
  metode: oneOf(body, 'metode', ['tunai', 'transfer', 'potong_gaji'], { required: false, dflt: 'tunai' }),
  bank_account_id: body.bank_account_id ? Number(body.bank_account_id) : null,
}, ctx));

router.post('/api/simpanan/penarikan', 'simpanan.create', ({ body, ctx }) => svc.penarikan({
  rekening_id: num(body, 'rekening_id', { min: 1 }),
  tanggal: date(body, 'tanggal', { required: false, dflt: today() }),
  nominal: num(body, 'nominal', { min: 1, label: 'Nominal penarikan' }),
  keterangan: str(body, 'keterangan', { required: false, max: 200 }),
  metode: oneOf(body, 'metode', ['tunai', 'transfer'], { required: false, dflt: 'tunai' }),
  bank_account_id: body.bank_account_id ? Number(body.bank_account_id) : null,
}, ctx));

router.post('/api/simpanan/pindah-buku', 'simpanan.create', ({ body, ctx }) => svc.pindahBuku({
  dari_rekening_id: num(body, 'dari_rekening_id', { min: 1 }),
  ke_rekening_id: num(body, 'ke_rekening_id', { min: 1 }),
  tanggal: date(body, 'tanggal', { required: false, dflt: today() }),
  nominal: num(body, 'nominal', { min: 1 }),
  keterangan: str(body, 'keterangan', { required: false, max: 200 }),
}, ctx));

router.post('/api/simpanan/bunga', 'simpanan.post', ({ body, ctx }) => svc.posBungaBulanan({
  periode: str(body, 'periode', { max: 7, label: 'Periode (YYYY-MM)' }),
  tanggal: date(body, 'tanggal', { required: false, dflt: null }),
}, ctx));

router.post('/api/simpanan/rekening/:id/blokir', 'simpanan.update', ({ params, body, ctx }) =>
  svc.setBlokir(idParam(params), num(body, 'nominal', { min: 0 }), ctx));

router.get('/api/simpanan/anggota/:id', 'simpanan.view', ({ params }) =>
  svc.ringkasanAnggota(idParam(params)));

/** Daftar transaksi simpanan (untuk laporan & rekap kasir). */
router.get('/api/simpanan/transaksi', 'simpanan.view', ({ query }) => {
  const w = [];
  const p = [];
  if (query.dari) { w.push('t.tanggal >= ?'); p.push(query.dari); }
  if (query.sampai) { w.push('t.tanggal <= ?'); p.push(query.sampai); }
  if (query.jenis) { w.push('t.jenis = ?'); p.push(query.jenis); }
  if (query.rekening_id) { w.push('t.rekening_id = ?'); p.push(Number(query.rekening_id)); }
  const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
  const limit = Math.min(Number(query.limit) || 100, 1000);
  const data = all(
    `SELECT t.*, r.nomor_rekening, a.nama AS anggota_nama, pr.nama AS produk_nama
       FROM transaksi_simpanan t
       JOIN rekening_simpanan r ON r.id = t.rekening_id
       JOIN anggota a ON a.id = r.anggota_id
       JOIN produk_simpanan pr ON pr.id = r.produk_id
       ${where} ORDER BY t.tanggal DESC, t.id DESC LIMIT ?`, [...p, limit]);
  return {
    data,
    total_setoran: data.reduce((s, r) => s + r.kredit, 0),
    total_penarikan: data.reduce((s, r) => s + r.debit, 0),
  };
});

export default router;
