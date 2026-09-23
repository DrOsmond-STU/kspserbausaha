/**
 * Koreksi transaksi tersimpan: ubah & batal.
 *
 * Setiap rute memerlukan izin "<modul>.koreksi" yang diatur pada menu
 * Administrator → Peran & Hak Akses. Seluruh koreksi membentuk jurnal balik
 * sehingga jurnal, buku besar, dan neraca ikut terkoreksi secara otomatis.
 */
import { createRouter, forbidden } from '../lib/http.js';
import { can } from '../lib/rbac.js';
import { idParam, num, str, date, oneOf } from '../lib/util.js';
import { voidJournal } from '../services/accounting.js';
import { batalBuktiKas, ubahBuktiKas } from '../services/kas.js';
import { batalTransaksi } from '../services/savings.js';
import * as k from '../services/koreksi.js';

const router = createRouter();

/** Minimal salah satu izin koreksi dimiliki. */
function wajib(ctx, ...izin) {
  if (!izin.some((i) => can(ctx.user.role, i))) {
    throw forbidden(`Koreksi transaksi memerlukan izin ${izin.map((i) => `"${i}"`).join(' atau ')}`);
  }
}

const alasan = (body) => str(body, 'alasan', { max: 300, label: 'Alasan koreksi' });
const opsiBank = (body) => (body.bank_account_id ? Number(body.bank_account_id) : null);

// ------------------------------- Jurnal -------------------------------

router.post('/api/koreksi/jurnal/:id/batal', 'akuntansi.koreksi', ({ params, body, ctx }) =>
  voidJournal(idParam(params), alasan(body), ctx));

router.put('/api/koreksi/jurnal/:id', 'akuntansi.koreksi', ({ params, body, ctx }) => k.ubahJurnal(idParam(params), {
  tanggal: date(body, 'tanggal', { required: false, dflt: null }),
  tipe: oneOf(body, 'tipe', ['umum', 'penyesuaian', 'pembuka'], { required: false, dflt: null }),
  keterangan: str(body, 'keterangan', { required: false, max: 300 }),
  lines: body.lines || body.detail || [],
}, alasan(body), ctx));

// -------------------------------- Kas --------------------------------

router.post('/api/koreksi/kas/:id/batal', 'kas.koreksi', ({ params, body, ctx }) =>
  batalBuktiKas(idParam(params), alasan(body), ctx));

router.put('/api/koreksi/kas/:id', 'kas.koreksi', ({ params, body, ctx }) => {
  const data = {};
  for (const f of ['coa_kas', 'coa_lawan', 'coa_tujuan', 'keterangan', 'pihak']) {
    if (body[f] !== undefined) data[f] = str(body, f, { required: false, max: 300 });
  }
  if (body.nominal !== undefined) data.nominal = num(body, 'nominal', { min: 1, label: 'Nominal' });
  if (body.tanggal) data.tanggal = date(body, 'tanggal');
  if (body.unit_usaha_id !== undefined) data.unit_usaha_id = Number(body.unit_usaha_id) || null;
  return ubahBuktiKas(idParam(params), data, alasan(body), ctx);
});

// ----------------------------- Penjualan -----------------------------

router.post('/api/koreksi/penjualan/:id/batal', null, ({ params, body, ctx }) => {
  wajib(ctx, 'pos.koreksi', 'penjualan.koreksi');
  return k.batalPenjualan(idParam(params), alasan(body), ctx);
});

router.put('/api/koreksi/penjualan/:id', null, ({ params, body, ctx }) => {
  wajib(ctx, 'pos.koreksi', 'penjualan.koreksi');
  const data = { items: body.items || [] };
  if (body.tanggal) data.tanggal = date(body, 'tanggal');
  for (const f of ['diskon', 'pajak', 'poin_dipakai']) {
    if (body[f] !== undefined) data[f] = num(body, f, { required: false, min: 0 });
  }
  if (body.bayar !== undefined) data.bayar = Number(body.bayar);
  if (body.metode_bayar) {
    data.metode_bayar = oneOf(body, 'metode_bayar', ['tunai', 'qris', 'transfer', 'piutang', 'potong_simpanan']);
  }
  if (body.anggota_id !== undefined) data.anggota_id = body.anggota_id ? Number(body.anggota_id) : null;
  data.bank_account_id = opsiBank(body);
  return k.ubahPenjualan(idParam(params), data, alasan(body), ctx);
});

// --------------------------- Pembelian & utang ---------------------------

router.post('/api/koreksi/pembelian/:id/batal-penerimaan', 'pembelian.koreksi', ({ params, body, ctx }) =>
  k.batalPenerimaan(idParam(params), alasan(body), ctx));

router.get('/api/koreksi/hutang-piutang/:id/pembayaran', 'akuntansi.view', ({ params }) =>
  ({ data: k.riwayatPembayaran(idParam(params)) }));

router.post('/api/koreksi/pembayaran-hp/:id/batal', null, ({ params, body, ctx }) => {
  wajib(ctx, 'kas.koreksi', 'pembelian.koreksi', 'penjualan.koreksi');
  return k.batalPembayaranHP(idParam(params), alasan(body), ctx);
});

// ------------------------------ Persediaan ------------------------------

router.post('/api/koreksi/stok/:id/batal', 'persediaan.koreksi', ({ params, body, ctx }) =>
  k.batalPenyesuaianStok(idParam(params), alasan(body), ctx));

// ------------------------------- Simpanan -------------------------------

router.post('/api/koreksi/simpanan/:id/batal', 'simpanan.koreksi', ({ params, body, ctx }) =>
  batalTransaksi(idParam(params), alasan(body), ctx));

router.put('/api/koreksi/simpanan/:id', 'simpanan.koreksi', ({ params, body, ctx }) => {
  const data = {};
  if (body.nominal !== undefined) data.nominal = num(body, 'nominal', { min: 1, label: 'Nominal' });
  if (body.tanggal) data.tanggal = date(body, 'tanggal');
  if (body.keterangan !== undefined) data.keterangan = str(body, 'keterangan', { required: false, max: 200 });
  if (body.metode) data.metode = oneOf(body, 'metode', ['tunai', 'transfer', 'potong_gaji']);
  if (body.bank_account_id !== undefined) data.bank_account_id = opsiBank(body);
  return k.ubahTransaksiSimpanan(idParam(params), data, alasan(body), ctx);
});

// ------------------------------- Pinjaman -------------------------------

router.post('/api/koreksi/angsuran/:id/batal', 'pinjaman.koreksi', ({ params, body, ctx }) =>
  k.batalAngsuran(idParam(params), alasan(body), ctx));

router.put('/api/koreksi/angsuran/:id', 'pinjaman.koreksi', ({ params, body, ctx }) => {
  const data = {};
  if (body.nominal !== undefined) data.nominal = num(body, 'nominal', { min: 1, label: 'Nominal' });
  if (body.tanggal) data.tanggal = date(body, 'tanggal');
  if (body.metode) data.metode = oneOf(body, 'metode', ['tunai', 'transfer', 'potong_gaji']);
  if (body.bank_account_id !== undefined) data.bank_account_id = opsiBank(body);
  if (body.keterangan !== undefined) data.keterangan = str(body, 'keterangan', { required: false, max: 200 });
  return k.ubahAngsuran(idParam(params), data, alasan(body), ctx);
});

router.post('/api/koreksi/pinjaman/:id/batal-pencairan', 'pinjaman.koreksi', ({ params, body, ctx }) =>
  k.batalPencairan(idParam(params), alasan(body), ctx));

export default router;
