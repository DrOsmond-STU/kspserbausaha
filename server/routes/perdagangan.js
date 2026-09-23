/**
 * Modul 11 (Persediaan), 12 (Toko Koperasi/POS), 13 (Pembelian), 14 (Penjualan).
 */
import { createRouter, notFound, badRequest } from '../lib/http.js';
import { all, get, scalar } from '../db.js';
import { idParam, num, str, date, oneOf, today, terbilang } from '../lib/util.js';
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

/** Bukti penyesuaian stok: satu mutasi penyesuaian beserta jurnalnya (untuk dicetak). */
router.get('/api/persediaan/penyesuaian/:id', 'persediaan.view', ({ params }) => {
  const m = get(
    `SELECT m.*, b.kode, b.nama, b.satuan, g.nama AS gudang_nama FROM mutasi_stok m
       JOIN barang b ON b.id = m.barang_id JOIN gudang g ON g.id = m.gudang_id
      WHERE m.id = ? AND m.jenis IN ('penyesuaian_masuk', 'penyesuaian_keluar')`, [idParam(params)]);
  if (!m) throw notFound('Mutasi penyesuaian tidak ditemukan');
  const jurnal = get('SELECT id, nomor, tanggal, keterangan, total_debit, status FROM jurnal WHERE referensi = ? ORDER BY id LIMIT 1',
    [`stok:${m.id}`]);
  const detail = jurnal ? all(
    `SELECT d.coa_kode, c.nama AS akun_nama, d.debit, d.kredit, d.keterangan FROM jurnal_detail d
       JOIN coa c ON c.kode = d.coa_kode WHERE d.jurnal_id = ? ORDER BY d.urut`, [jurnal.id]) : [];
  const nilai = jurnal ? jurnal.total_debit : 0;
  return { ...m, jurnal: jurnal ? { ...jurnal, detail } : null, nilai, terbilang: terbilang(nilai) };
});

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

/**
 * Mengelompokkan mutasi stok per proses (penerimaan/retur) untuk bukti cetak.
 * Satu proses dicatat dalam satu transaksi: tanggal & waktu catatnya sama dan
 * satu barang hanya muncul sekali. Kelompok baru dimulai bila salah satunya berubah.
 */
function kelompokMutasi(kelompok, m) {
  const kunci = `${m.tanggal}|${m.created_at}`;
  let k = kelompok.at(-1);
  if (!k || k.kunci !== kunci || k.barang.has(m.barang_id)) {
    k = { kunci, tanggal: m.tanggal, items: [], barang: new Set() };
    kelompok.push(k);
  }
  k.barang.add(m.barang_id);
  return k;
}

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
    // Penjualan yang dibatalkan tetap tampil di daftar, tetapi tidak dihitung sebagai omzet
    omzet: scalar(`SELECT COALESCE(SUM(CASE WHEN j.status <> 'batal' THEN j.total ELSE 0 END),0) FROM penjualan j ${where}`, p),
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
    terbilang: terbilang(j.total),
  };
});

/**
 * Riwayat retur sebuah penjualan untuk bukti retur: mutasi retur dikelompokkan
 * per proses retur dan dipasangkan dengan jurnal retur sesuai urutan waktunya.
 */
router.get('/api/penjualan/:id/retur', 'penjualan.view', ({ params }) => {
  const id = idParam(params);
  const p = get('SELECT id, nomor, tanggal, total, subtotal, metode_bayar FROM penjualan WHERE id = ?', [id]);
  if (!p) throw notFound('Transaksi penjualan tidak ditemukan');
  const harga = new Map(all('SELECT barang_id, qty, subtotal FROM penjualan_detail WHERE penjualan_id = ?', [id])
    .map((d) => [d.barang_id, d.qty ? d.subtotal / d.qty : 0]));
  const mutasi = all(
    `SELECT m.id, m.tanggal, m.created_at, m.barang_id, m.qty, b.kode, b.nama, b.satuan FROM mutasi_stok m
       JOIN barang b ON b.id = m.barang_id WHERE m.referensi = ? AND m.jenis = 'retur_masuk' ORDER BY m.id`,
    [`retur:${id}`]);
  const jurnal = all(
    'SELECT id, nomor, tanggal, keterangan, total_debit, status FROM jurnal WHERE referensi = ? ORDER BY id',
    [`retur:${id}`]);
  const kelompok = [];
  for (const m of mutasi) {
    const k = kelompokMutasi(kelompok, m);
    k.items.push({ barang_id: m.barang_id, kode: m.kode, nama: m.nama, satuan: m.satuan, qty: m.qty,
      harga: Math.round(harga.get(m.barang_id) || 0), nilai: Math.round((harga.get(m.barang_id) || 0) * m.qty) });
  }
  return {
    penjualan: p,
    retur: kelompok.map(({ kunci, barang, ...k }, i) => {
      const j = jurnal[i] || null;
      const nilai = k.items.reduce((s, x) => s + x.nilai, 0);
      // Diskon nota & PPN dikoreksi proporsional, sama dengan perhitungan retur.
      const nilaiRetur = p.subtotal > 0 ? Math.min(Math.round(nilai * p.total / p.subtotal), p.total) : nilai;
      return { ...k, urut: i + 1, jurnal: j, nilai_item: nilai, nilai_retur: nilaiRetur,
        terbilang: terbilang(nilaiRetur) };
    }),
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
    terbilang: terbilang(b.total),
  };
});

/**
 * Riwayat penerimaan barang sebuah dokumen pembelian (bukti penerimaan):
 * mutasi stok "masuk" berreferensi pembelian:<id> dikelompokkan per proses
 * penerimaan dan dipasangkan dengan jurnal penerimaannya sesuai urutan waktu.
 */
router.get('/api/pembelian/:id/penerimaan', 'pembelian.view', ({ params }) => {
  const id = idParam(params);
  const pb = get(`SELECT b.id, b.nomor, b.tanggal, b.supplier_id, s.nama AS supplier_nama, g.nama AS gudang_nama
                    FROM pembelian b LEFT JOIN supplier s ON s.id = b.supplier_id
                    LEFT JOIN gudang g ON g.id = b.gudang_id WHERE b.id = ?`, [id]);
  if (!pb) throw notFound('Dokumen pembelian tidak ditemukan');
  const pesan = new Map(all('SELECT barang_id, qty FROM pembelian_detail WHERE pembelian_id = ?', [id])
    .map((d) => [d.barang_id, d.qty]));
  const mutasi = all(
    `SELECT m.id, m.tanggal, m.created_at, m.barang_id, m.qty, m.harga, m.batch, m.expired, b.kode, b.nama, b.satuan
       FROM mutasi_stok m JOIN barang b ON b.id = m.barang_id
      WHERE m.referensi = ? AND m.jenis = 'masuk' ORDER BY m.id`, [`pembelian:${id}`]);
  const jurnal = all(
    `SELECT id, nomor, tanggal, total_debit, status FROM jurnal WHERE referensi = ? AND tipe = 'pembelian'
      ORDER BY id`, [`pembelian:${id}`]);
  const kelompok = [];
  for (const m of mutasi) {
    const k = kelompokMutasi(kelompok, m);
    k.items.push({ barang_id: m.barang_id, kode: m.kode, nama: m.nama, satuan: m.satuan,
      qty_pesan: pesan.get(m.barang_id) ?? null, qty: m.qty, harga: m.harga, nilai: Math.round(m.qty * m.harga),
      batch: m.batch, expired: m.expired });
  }
  return {
    pembelian: pb,
    penerimaan: kelompok.map(({ kunci, barang, ...k }, i) => ({
      ...k, urut: i + 1, jurnal: jurnal[i] || null, nilai: k.items.reduce((s, x) => s + x.nilai, 0),
    })),
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

/** Satu tagihan utang/piutang beserta riwayat pembayarannya (untuk bukti pembayaran). */
router.get('/api/hutang-piutang/:id', 'akuntansi.view', ({ params }) => {
  const h = get(
    `SELECT h.*, s.nama AS supplier_nama, c.nama AS customer_nama, a.nama AS anggota_nama,
            a.nomor_anggota, (h.nominal - h.terbayar) AS sisa
       FROM hutang_piutang h LEFT JOIN supplier s ON s.id = h.supplier_id
       LEFT JOIN customer c ON c.id = h.customer_id LEFT JOIN anggota a ON a.id = h.anggota_id
      WHERE h.id = ?`, [idParam(params)]);
  if (!h) throw notFound('Data hutang/piutang tidak ditemukan');
  // Nomor dokumen sumber (pembelian/penjualan) agar bukti mudah ditelusuri.
  const [jenisSumber, idSumber] = String(h.referensi).split(':');
  const tabelSumber = { pembelian: 'pembelian', penjualan: 'penjualan' }[jenisSumber];
  const sumber = tabelSumber ? get(`SELECT id, nomor, tanggal, total FROM ${tabelSumber} WHERE id = ?`, [Number(idSumber)]) : null;
  const pembayaran = all(
    `SELECT id, nomor, tanggal, keterangan, total_debit AS nominal, status, dibuat_oleh FROM jurnal
      WHERE referensi = ? ORDER BY tanggal, id`, [`hp:${h.id}`]).map((j) => ({
    ...j,
    akun: all(`SELECT d.coa_kode, c.nama AS akun_nama, d.debit, d.kredit FROM jurnal_detail d
                 JOIN coa c ON c.kode = d.coa_kode WHERE d.jurnal_id = ? ORDER BY d.urut`, [j.id]),
    terbilang: terbilang(j.nominal),
  }));
  return { ...h, pihak_nama: h.supplier_nama || h.customer_nama || h.anggota_nama || h.pihak || null,
    sumber: sumber ? { jenis: jenisSumber, ...sumber } : null, pembayaran };
});

router.post('/api/hutang-piutang/bayar', 'kas.create', ({ body, ctx }) => trade.bayarHutangPiutang({
  id: num(body, 'id', { min: 1 }),
  tanggal: date(body, 'tanggal', { required: false, dflt: today() }),
  nominal: num(body, 'nominal', { min: 1 }),
  metode: oneOf(body, 'metode', ['tunai', 'transfer'], { required: false, dflt: 'tunai' }),
  bank_account_id: body.bank_account_id ? Number(body.bank_account_id) : null,
}, ctx));

export default router;
