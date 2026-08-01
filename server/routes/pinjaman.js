/**
 * Modul 5 - Pinjaman (rute API).
 */
import { createRouter, notFound, badRequest } from '../lib/http.js';
import { all, get, scalar } from '../db.js';
import { idParam, num, str, date, oneOf, today } from '../lib/util.js';
import * as svc from '../services/loans.js';
import * as approval from '../services/approval.js';

const router = createRouter();

router.get('/api/pinjaman', 'pinjaman.view', ({ query }) => {
  const w = [];
  const p = [];
  if (query.q) {
    w.push('(p.nomor LIKE ? OR a.nama LIKE ? OR a.nomor_anggota LIKE ?)');
    p.push(`%${query.q}%`, `%${query.q}%`, `%${query.q}%`);
  }
  if (query.status) { w.push('p.status = ?'); p.push(query.status); }
  if (query.anggota_id) { w.push('p.anggota_id = ?'); p.push(Number(query.anggota_id)); }
  if (query.kolektibilitas) { w.push('p.kolektibilitas = ?'); p.push(Number(query.kolektibilitas)); }
  const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
  const limit = Math.min(Number(query.limit) || 50, 500);
  const offset = Math.max(Number(query.offset) || 0, 0);
  const data = all(
    `SELECT p.*, a.nama AS anggota_nama, a.nomor_anggota, a.telepon, pr.nama AS produk_nama
       FROM pinjaman p JOIN anggota a ON a.id = p.anggota_id
       JOIN produk_pinjaman pr ON pr.id = p.produk_id
       ${where} ORDER BY p.id DESC LIMIT ? OFFSET ?`, [...p, limit, offset]);
  return {
    data: data.map((r) => ({ ...r, label_kolektibilitas: svc.LABEL_KOLEKTIBILITAS[r.kolektibilitas] })),
    total: scalar(`SELECT COUNT(*) FROM pinjaman p JOIN anggota a ON a.id = p.anggota_id ${where}`, p),
    limit, offset,
  };
});

router.get('/api/pinjaman/portofolio', 'pinjaman.view', () => svc.statistikPortofolio());

router.get('/api/pinjaman/tagihan', 'pinjaman.view', ({ query }) => ({
  data: svc.daftarTagihan({
    sampai: query.sampai || today(),
    hari_kedepan: Number(query.hari_kedepan) || 7,
  }),
}));

/** Simulasi angsuran sebelum pengajuan (juga dipakai portal anggota). */
router.post('/api/pinjaman/simulasi', 'pinjaman.view', ({ body }) => {
  const pokok = num(body, 'pokok', { min: 1, label: 'Pokok pinjaman' });
  const tenor = num(body, 'tenor', { min: 1, max: 120, label: 'Tenor' });
  let bunga = body.bunga_tahunan;
  let metode = body.metode_bunga;
  if (body.produk_id) {
    const pr = get('SELECT * FROM produk_pinjaman WHERE id = ?', [Number(body.produk_id)]);
    if (!pr) throw notFound('Produk pinjaman tidak ditemukan');
    bunga = bunga ?? pr.bunga_tahunan;
    metode = metode || pr.metode_bunga;
  }
  if (bunga === undefined || bunga === null) throw badRequest('Suku bunga atau produk pinjaman wajib diisi');
  return svc.hitungJadwal({
    pokok, tenor, bunga_tahunan: Number(bunga), metode: metode || 'flat',
    tanggal_mulai: date(body, 'tanggal_mulai', { required: false, dflt: today() }),
  });
});

router.post('/api/pinjaman/skoring', 'pinjaman.view', ({ body }) => svc.hitungSkor({
  anggota_id: num(body, 'anggota_id', { min: 1 }),
  pokok: num(body, 'pokok', { min: 1 }),
  tenor: num(body, 'tenor', { min: 1 }),
  angsuran_bulanan: num(body, 'angsuran_bulanan', { min: 0 }),
}));

router.get('/api/pinjaman/:id', 'pinjaman.view', ({ params }) => {
  const id = idParam(params);
  const p = get(
    `SELECT p.*, a.nama AS anggota_nama, a.nomor_anggota, a.nik, a.telepon, a.alamat, a.penghasilan,
            pr.nama AS produk_nama, pr.denda_harian, pr.metode_bunga AS produk_metode
       FROM pinjaman p JOIN anggota a ON a.id = p.anggota_id
       JOIN produk_pinjaman pr ON pr.id = p.produk_id WHERE p.id = ?`, [id]);
  if (!p) throw notFound('Pinjaman tidak ditemukan');
  return {
    ...p,
    label_kolektibilitas: svc.LABEL_KOLEKTIBILITAS[p.kolektibilitas],
    jadwal: all('SELECT * FROM pinjaman_jadwal WHERE pinjaman_id = ? ORDER BY angsuran_ke', [id]),
    angsuran: all('SELECT * FROM pinjaman_angsuran WHERE pinjaman_id = ? ORDER BY tanggal DESC, id DESC', [id]),
    agunan: all('SELECT * FROM pinjaman_agunan WHERE pinjaman_id = ?', [id]),
    denda: svc.hitungDenda(id),
    approval: approval.statusEntitas('pinjaman', id),
  };
});

router.post('/api/pinjaman', 'pinjaman.create', ({ body, ctx }) => {
  const hasil = svc.ajukan({
    anggota_id: num(body, 'anggota_id', { min: 1 }),
    produk_id: num(body, 'produk_id', { min: 1 }),
    pokok: num(body, 'pokok', { min: 1, label: 'Pokok pinjaman' }),
    tenor: num(body, 'tenor', { min: 1, max: 120, label: 'Tenor' }),
    bunga_tahunan: body.bunga_tahunan !== undefined ? Number(body.bunga_tahunan) : undefined,
    metode_bunga: body.metode_bunga,
    tujuan: str(body, 'tujuan', { required: false, max: 300 }),
    tanggal_pengajuan: date(body, 'tanggal_pengajuan', { required: false, dflt: today() }),
    cabang_id: body.cabang_id ? Number(body.cabang_id) : null,
    unit_usaha_id: body.unit_usaha_id ? Number(body.unit_usaha_id) : null,
    agunan: body.agunan || [],
  }, ctx);
  // Permintaan persetujuan berjenjang dibuat otomatis bila alur tersedia
  const appr = approval.ajukan({
    modul: 'pinjaman', entitas_id: hasil.id, judul: `Pengajuan pinjaman ${hasil.nomor}`,
    nominal: num(body, 'pokok', { min: 1 }),
    ringkasan: `Skor kredit ${hasil.skoring.skor}/100 - ${hasil.skoring.rekomendasi}`,
  }, ctx);
  return { ...hasil, approval: appr };
});

router.post('/api/pinjaman/:id/survey', 'pinjaman.update', ({ params, body, ctx }) => svc.survey(
  idParam(params),
  { hasil_survey: str(body, 'hasil_survey', { required: false, max: 2000 }),
    catatan_analis: str(body, 'catatan_analis', { required: false, max: 2000 }) },
  ctx,
));

router.post('/api/pinjaman/:id/putuskan', 'pinjaman.approve', ({ params, body, ctx }) => svc.putuskan(
  idParam(params),
  {
    setuju: body.setuju === true || body.setuju === 1 || body.setuju === 'true',
    alasan: str(body, 'alasan', { required: false, max: 500 }),
    pokok_disetujui: body.pokok_disetujui ? Number(body.pokok_disetujui) : null,
    tenor_disetujui: body.tenor_disetujui ? Number(body.tenor_disetujui) : null,
  },
  ctx,
));

router.post('/api/pinjaman/:id/cairkan', 'pinjaman.post', ({ params, body, ctx }) => svc.cairkan(
  idParam(params),
  {
    tanggal: date(body, 'tanggal', { required: false, dflt: today() }),
    metode: oneOf(body, 'metode', ['tunai', 'transfer'], { required: false, dflt: 'tunai' }),
    bank_account_id: body.bank_account_id ? Number(body.bank_account_id) : null,
    potong_biaya: body.potong_biaya !== false,
  },
  ctx,
));

router.post('/api/pinjaman/angsuran', 'pinjaman.create', ({ body, ctx }) => svc.bayarAngsuran({
  pinjaman_id: num(body, 'pinjaman_id', { min: 1 }),
  tanggal: date(body, 'tanggal', { required: false, dflt: today() }),
  nominal: num(body, 'nominal', { min: 1, label: 'Nominal angsuran' }),
  metode: oneOf(body, 'metode', ['tunai', 'transfer', 'potong_gaji'], { required: false, dflt: 'tunai' }),
  bank_account_id: body.bank_account_id ? Number(body.bank_account_id) : null,
  keterangan: str(body, 'keterangan', { required: false, max: 200 }),
}, ctx));

router.get('/api/pinjaman/:id/simulasi-pelunasan', 'pinjaman.view', ({ params, query }) =>
  svc.simulasiPelunasan(idParam(params), query.tanggal || today()));

router.post('/api/pinjaman/:id/pelunasan', 'pinjaman.create', ({ params, body, ctx }) =>
  svc.pelunasanDipercepat({
    pinjaman_id: idParam(params),
    tanggal: date(body, 'tanggal', { required: false, dflt: today() }),
    metode: oneOf(body, 'metode', ['tunai', 'transfer'], { required: false, dflt: 'tunai' }),
    bank_account_id: body.bank_account_id ? Number(body.bank_account_id) : null,
  }, ctx));

router.post('/api/pinjaman/:id/restrukturisasi', 'pinjaman.approve', ({ params, body, ctx }) =>
  svc.restrukturisasi({
    pinjaman_id: idParam(params),
    tenor_baru: num(body, 'tenor_baru', { min: 1, max: 120, label: 'Tenor baru' }),
    bunga_baru: body.bunga_baru !== undefined ? Number(body.bunga_baru) : undefined,
    tanggal: date(body, 'tanggal', { required: false, dflt: today() }),
    alasan: str(body, 'alasan', { max: 500, label: 'Alasan restrukturisasi' }),
  }, ctx));

router.post('/api/pinjaman/refresh-kolektibilitas', 'pinjaman.update', ({ body }) =>
  svc.refreshSemuaKolektibilitas(date(body, 'sampai', { required: false, dflt: today() })));

router.get('/api/pinjaman/:id/denda', 'pinjaman.view', ({ params, query }) =>
  svc.hitungDenda(idParam(params), query.sampai || today()));

export default router;
