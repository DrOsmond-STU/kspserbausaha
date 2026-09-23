/**
 * Modul 11 (Persediaan), 12 (Toko Koperasi/POS), 13 (Pembelian), 14 (Penjualan).
 */
import { createRouter, notFound, badRequest } from '../lib/http.js';
import { all, get, scalar } from '../db.js';
import { idParam, num, str, date, oneOf, today } from '../lib/util.js';
import * as inv from '../services/inventory.js';
import * as trade from '../services/trade.js';

const router = createRouter();

// ---------------------------- Persediaan ----------------------------

router.get('/api/persediaan/stok', 'persediaan.view', ({ query }) =>
  inv.nilaiPersediaan({ gudang_id: query.gudang_id ? Number(query.gudang_id) : null }));

router.get('/api/persediaan/reorder', 'persediaan.view', () => ({ data: inv.daftarReorder() }));

router.get('/api/persediaan/kartu-stok', 'persediaan.view', ({ query }) => {
  if (!query.barang_id) throw badRequest('Parameter "barang_id" wajib diisi');
  const barang = get('SELECT * FROM barang WHERE id = ?', [Number(query.barang_id)]);
  if (!barang) throw notFound('Barang tidak ditemukan');
  return {
    barang,
    mutasi: inv.kartuStok(Number(query.barang_id), {
      gudang_id: query.gudang_id ? Number(query.gudang_id) : null,
      dari: query.dari, sampai: query.sampai,
    }),
  };
});

router.post('/api/persediaan/penyesuaian', 'persediaan.update', ({ body, ctx }) => inv.penyesuaianStok({
  barang_id: num(body, 'barang_id', { min: 1 }),
  gudang_id: num(body, 'gudang_id', { min: 1 }),
  tanggal: date(body, 'tanggal', { required: false, dflt: today() }),
  jenis: oneOf(body, 'jenis', ['masuk', 'keluar'], { required: false, dflt: 'masuk' }),
  qty: num(body, 'qty', { integer: false, label: 'Kuantitas' }),
  harga: num(body, 'harga', { required: false, min: 0 }),
  akun_lawan: str(body, 'akun_lawan', { required: false, max: 20 }),
  keterangan: str(body, 'keterangan', { required: false, max: 200 }),
}, ctx));

router.post('/api/persediaan/transfer', 'persediaan.update', ({ body, ctx }) => inv.transferGudang({
  barang_id: num(body, 'barang_id', { min: 1 }),
  dari_gudang_id: num(body, 'dari_gudang_id', { min: 1 }),
  ke_gudang_id: num(body, 'ke_gudang_id', { min: 1 }),
  qty: num(body, 'qty', { min: 0.001, integer: false }),
  tanggal: date(body, 'tanggal', { required: false, dflt: today() }),
  keterangan: str(body, 'keterangan', { required: false, max: 200 }),
}, ctx));

router.get('/api/persediaan/opname', 'persediaan.view', () => ({
  data: all(
    `SELECT o.*, g.nama AS gudang_nama,
            (SELECT COUNT(*) FROM stock_opname_detail WHERE opname_id = o.id) AS jumlah_item
       FROM stock_opname o JOIN gudang g ON g.id = o.gudang_id ORDER BY o.id DESC LIMIT 100`),
}));

router.get('/api/persediaan/opname/:id', 'persediaan.view', ({ params }) => {
  const id = idParam(params);
  const o = get(`SELECT o.*, g.nama AS gudang_nama FROM stock_opname o
                   JOIN gudang g ON g.id = o.gudang_id WHERE o.id = ?`, [id]);
  if (!o) throw notFound('Dokumen opname tidak ditemukan');
  return {
    ...o,
    detail: all(
      `SELECT d.*, b.kode, b.nama, b.satuan, b.harga_beli FROM stock_opname_detail d
         JOIN barang b ON b.id = d.barang_id WHERE d.opname_id = ? ORDER BY b.kode`, [id]),
  };
});

router.post('/api/persediaan/opname', 'persediaan.create', ({ body, ctx }) => inv.mulaiOpname({
  gudang_id: num(body, 'gudang_id', { min: 1 }),
  tanggal: date(body, 'tanggal', { required: false, dflt: today() }),
  keterangan: str(body, 'keterangan', { required: false, max: 200 }),
}, ctx));

router.post('/api/persediaan/opname/:id/selesai', 'persediaan.post', ({ params, body, ctx }) =>
  inv.selesaikanOpname(idParam(params), body.detail || [], ctx));

router.post('/api/persediaan/opname/:id/batal', 'persediaan.update', ({ params, body, ctx }) =>
  inv.batalOpname(idParam(params), str(body, 'alasan', { max: 300, label: 'Alasan pembatalan' }), ctx));

// ------------------------------- POS --------------------------------

/** Pencarian barang cepat untuk kasir (barcode / nama / kode). */
router.get('/api/pos/cari-barang', 'pos.view', ({ query }) => {
  const q = String(query.q || '').trim();
  if (!q) return { data: [] };
  const gudangId = query.gudang_id ? Number(query.gudang_id) : null;
  return {
    data: all(
      `SELECT b.id, b.kode, b.barcode, b.nama, b.satuan, b.harga_jual, b.harga_anggota,
              COALESCE((SELECT SUM(qty) FROM stok WHERE barang_id = b.id ${gudangId ? 'AND gudang_id = ?' : ''}), 0) AS stok
         FROM barang b
        WHERE b.status = 'aktif' AND (b.barcode = ? OR b.kode LIKE ? OR b.nama LIKE ?)
        ORDER BY (b.barcode = ?) DESC, b.nama LIMIT 25`,
      gudangId ? [gudangId, q, `%${q}%`, `%${q}%`, q] : [q, `%${q}%`, `%${q}%`, q]),
  };
});

router.post('/api/pos/jual', 'pos.create', ({ body, ctx }) => trade.jual({
  tanggal: date(body, 'tanggal', { required: false, dflt: today() }),
  tipe: oneOf(body, 'tipe', ['pos', 'sales_order', 'invoice'], { required: false, dflt: 'pos' }),
  anggota_id: body.anggota_id ? Number(body.anggota_id) : null,
  customer_id: body.customer_id ? Number(body.customer_id) : null,
  gudang_id: body.gudang_id ? Number(body.gudang_id) : null,
  unit_usaha_id: body.unit_usaha_id ? Number(body.unit_usaha_id) : null,
  cabang_id: body.cabang_id ? Number(body.cabang_id) : null,
  items: body.items || [],
  diskon: num(body, 'diskon', { required: false, min: 0 }),
  pajak: num(body, 'pajak', { required: false, min: 0 }),
  bayar: body.bayar !== undefined ? Number(body.bayar) : undefined,
  poin_dipakai: num(body, 'poin_dipakai', { required: false, min: 0 }),
  metode_bayar: oneOf(body, 'metode_bayar',
    ['tunai', 'qris', 'transfer', 'piutang', 'potong_simpanan'], { required: false, dflt: 'tunai' }),
  bank_account_id: body.bank_account_id ? Number(body.bank_account_id) : null,
}, ctx));

router.get('/api/pos/rekap', 'pos.view', ({ query, ctx }) => trade.rekapKasir({
  tanggal: query.tanggal || today(),
  kasir: query.kasir || (ctx?.user?.role === 'kasir_toko' ? ctx.user.username : null),
}));

router.post('/api/pos/retur', 'pos.update', ({ body, ctx }) => trade.returPenjualan({
  penjualan_id: num(body, 'penjualan_id', { min: 1 }),
  tanggal: date(body, 'tanggal', { required: false, dflt: today() }),
  items: body.items || null,
  alasan: str(body, 'alasan', { required: false, max: 300 }),
  bank_account_id: body.bank_account_id ? Number(body.bank_account_id) : null,
}, ctx));

// ---------------------------- Penjualan -----------------------------

router.get('/api/penjualan', 'penjualan.view', ({ query }) => {
  const w = [];
  const p = [];
  if (query.dari) { w.push('j.tanggal >= ?'); p.push(query.dari); }
  if (query.sampai) { w.push('j.tanggal <= ?'); p.push(query.sampai); }
  if (query.tipe) { w.push('j.tipe = ?'); p.push(query.tipe); }
  if (query.q) { w.push('j.nomor LIKE ?'); p.push(`%${query.q}%`); }
  const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
  const limit = Math.min(Number(query.limit) || 50, 500);
  const offset = Math.max(Number(query.offset) || 0, 0);
  return {
    data: all(
      `SELECT j.*, a.nama AS anggota_nama, c.nama AS customer_nama
         FROM penjualan j LEFT JOIN anggota a ON a.id = j.anggota_id
         LEFT JOIN customer c ON c.id = j.customer_id
         ${where} ORDER BY j.tanggal DESC, j.id DESC LIMIT ? OFFSET ?`, [...p, limit, offset]),
    total: scalar(`SELECT COUNT(*) FROM penjualan j ${where}`, p),
    omzet: scalar(`SELECT COALESCE(SUM(total),0) FROM penjualan j ${where}`, p),
    limit, offset,
  };
});

router.get('/api/penjualan/:id', 'penjualan.view', ({ params }) => {
  const id = idParam(params);
  const j = get(
    `SELECT j.*, a.nama AS anggota_nama, a.nomor_anggota, c.nama AS customer_nama, g.nama AS gudang_nama
       FROM penjualan j LEFT JOIN anggota a ON a.id = j.anggota_id
       LEFT JOIN customer c ON c.id = j.customer_id LEFT JOIN gudang g ON g.id = j.gudang_id
      WHERE j.id = ?`, [id]);
  if (!j) throw notFound('Transaksi penjualan tidak ditemukan');
  // qty_retur: jumlah yang sudah diretur (dari mutasi stok retur) agar antarmuka
  // dapat menampilkan sisa yang masih boleh diretur.
  return {
    ...j,
    detail: all(
      `SELECT d.*, b.kode, b.nama, b.satuan,
              COALESCE((SELECT SUM(m.qty) FROM mutasi_stok m WHERE m.referensi = ?
                          AND m.jenis = 'retur_masuk' AND m.barang_id = d.barang_id), 0) AS qty_retur
         FROM penjualan_detail d
         JOIN barang b ON b.id = d.barang_id WHERE d.penjualan_id = ?`, [`retur:${id}`, id]),
  };
});

// ---------------------------- Pembelian -----------------------------

router.get('/api/pembelian', 'pembelian.view', ({ query }) => {
  const w = [];
  const p = [];
  if (query.dari) { w.push('b.tanggal >= ?'); p.push(query.dari); }
  if (query.sampai) { w.push('b.tanggal <= ?'); p.push(query.sampai); }
  if (query.status) { w.push('b.status = ?'); p.push(query.status); }
  if (query.tipe) { w.push('b.tipe = ?'); p.push(query.tipe); }
  const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
  const limit = Math.min(Number(query.limit) || 50, 500);
  return {
    data: all(
      `SELECT b.*, s.nama AS supplier_nama, g.nama AS gudang_nama FROM pembelian b
         LEFT JOIN supplier s ON s.id = b.supplier_id LEFT JOIN gudang g ON g.id = b.gudang_id
         ${where} ORDER BY b.tanggal DESC, b.id DESC LIMIT ?`, [...p, limit]),
    total: scalar(`SELECT COUNT(*) FROM pembelian b ${where}`, p),
  };
});

router.get('/api/pembelian/:id', 'pembelian.view', ({ params }) => {
  const id = idParam(params);
  const b = get(`SELECT b.*, s.nama AS supplier_nama, g.nama AS gudang_nama FROM pembelian b
                   LEFT JOIN supplier s ON s.id = b.supplier_id
                   LEFT JOIN gudang g ON g.id = b.gudang_id WHERE b.id = ?`, [id]);
  if (!b) throw notFound('Dokumen pembelian tidak ditemukan');
  return {
    ...b,
    detail: all(
      `SELECT d.*, br.kode, br.nama, br.satuan FROM pembelian_detail d
         JOIN barang br ON br.id = d.barang_id WHERE d.pembelian_id = ?`, [id]),
  };
});

router.post('/api/pembelian', 'pembelian.create', ({ body, ctx }) => trade.buatPembelian({
  tanggal: date(body, 'tanggal', { required: false, dflt: today() }),
  tipe: oneOf(body, 'tipe', ['pr', 'po'], { required: false, dflt: 'po' }),
  supplier_id: body.supplier_id ? Number(body.supplier_id) : null,
  gudang_id: body.gudang_id ? Number(body.gudang_id) : null,
  unit_usaha_id: body.unit_usaha_id ? Number(body.unit_usaha_id) : null,
  cabang_id: body.cabang_id ? Number(body.cabang_id) : null,
  items: body.items || [],
  diskon: num(body, 'diskon', { required: false, min: 0 }),
  pajak: num(body, 'pajak', { required: false, min: 0 }),
  status: oneOf(body, 'status', ['draft', 'diajukan'], { required: false, dflt: 'draft' }),
}, ctx));

router.put('/api/pembelian/:id', 'pembelian.update', ({ params, body, ctx }) => trade.ubahPembelian(idParam(params), {
  tanggal: date(body, 'tanggal', { required: false, dflt: null }),
  supplier_id: body.supplier_id !== undefined ? (body.supplier_id ? Number(body.supplier_id) : null) : undefined,
  gudang_id: body.gudang_id !== undefined ? (body.gudang_id ? Number(body.gudang_id) : null) : undefined,
  unit_usaha_id: body.unit_usaha_id !== undefined ? (body.unit_usaha_id ? Number(body.unit_usaha_id) : null) : undefined,
  cabang_id: body.cabang_id !== undefined ? (body.cabang_id ? Number(body.cabang_id) : null) : undefined,
  items: body.items || [],
  diskon: body.diskon !== undefined ? num(body, 'diskon', { required: false, min: 0 }) : undefined,
  pajak: body.pajak !== undefined ? num(body, 'pajak', { required: false, min: 0 }) : undefined,
}, ctx));

router.post('/api/pembelian/:id/batal', 'pembelian.update', ({ params, body, ctx }) =>
  trade.batalPembelian(idParam(params), str(body, 'alasan', { max: 300, label: 'Alasan pembatalan' }), ctx));

router.post('/api/pembelian/:id/terima', 'pembelian.update', ({ params, body, ctx }) =>
  trade.terimaBarang({
    pembelian_id: idParam(params),
    tanggal: date(body, 'tanggal', { required: false, dflt: today() }),
    items: body.items || null,
    metode_bayar: oneOf(body, 'metode_bayar', ['hutang', 'tunai', 'transfer'],
      { required: false, dflt: 'hutang' }),
    bank_account_id: body.bank_account_id ? Number(body.bank_account_id) : null,
  }, ctx));

router.get('/api/pembelian/evaluasi/supplier', 'pembelian.view', () =>
  ({ data: trade.evaluasiSupplier() }));

// ------------------------- Hutang & Piutang -------------------------

router.get('/api/hutang-piutang', 'akuntansi.view', ({ query }) => {
  const jenis = query.jenis === 'piutang' ? 'piutang' : 'hutang';
  const data = all(
    `SELECT h.*, s.nama AS supplier_nama, c.nama AS customer_nama, a.nama AS anggota_nama,
            (h.nominal - h.terbayar) AS sisa,
            CAST(julianday('now') - julianday(h.jatuh_tempo) AS INTEGER) AS umur_hari
       FROM hutang_piutang h
       LEFT JOIN supplier s ON s.id = h.supplier_id
       LEFT JOIN customer c ON c.id = h.customer_id
       LEFT JOIN anggota a ON a.id = h.anggota_id
      WHERE h.jenis = ? ${query.status ? 'AND h.status = ?' : ''}
      ORDER BY h.jatuh_tempo`, query.status ? [jenis, query.status] : [jenis]);
  // Analisis umur (aging)
  const bucket = { lancar: 0, '1_30': 0, '31_60': 0, '61_90': 0, 'diatas_90': 0 };
  for (const r of data.filter((x) => x.status === 'terbuka')) {
    const u = r.umur_hari ?? 0;
    if (u <= 0) bucket.lancar += r.sisa;
    else if (u <= 30) bucket['1_30'] += r.sisa;
    else if (u <= 60) bucket['31_60'] += r.sisa;
    else if (u <= 90) bucket['61_90'] += r.sisa;
    else bucket.diatas_90 += r.sisa;
  }
  return {
    jenis, data, aging: bucket,
    total_terbuka: data.filter((x) => x.status === 'terbuka').reduce((s, r) => s + r.sisa, 0),
  };
});

router.post('/api/hutang-piutang/bayar', 'kas.create', ({ body, ctx }) => trade.bayarHutangPiutang({
  id: num(body, 'id', { min: 1 }),
  tanggal: date(body, 'tanggal', { required: false, dflt: today() }),
  nominal: num(body, 'nominal', { min: 1 }),
  metode: oneOf(body, 'metode', ['tunai', 'transfer'], { required: false, dflt: 'tunai' }),
  bank_account_id: body.bank_account_id ? Number(body.bank_account_id) : null,
}, ctx));

export default router;
