/**
 * Modul 7 & 8 - Akuntansi dan Laporan Keuangan.
 */
import { createRouter, notFound, badRequest, conflict } from '../lib/http.js';
import { all, get, run, scalar, tx } from '../db.js';
import { logAudit } from '../lib/audit.js';
import { idParam, num, str, date, today, rupiah, terbilang, yearOf } from '../lib/util.js';
import * as acc from '../services/accounting.js';

const router = createRouter();

// ------------------------------ Jurnal ------------------------------

router.get('/api/akuntansi/jurnal', 'akuntansi.view', ({ query }) => {
  const w = [];
  const p = [];
  if (query.dari) { w.push('j.tanggal >= ?'); p.push(query.dari); }
  if (query.sampai) { w.push('j.tanggal <= ?'); p.push(query.sampai); }
  if (query.tipe) { w.push('j.tipe = ?'); p.push(query.tipe); }
  if (query.status) { w.push('j.status = ?'); p.push(query.status); }
  if (query.q) { w.push('(j.nomor LIKE ? OR j.keterangan LIKE ?)'); p.push(`%${query.q}%`, `%${query.q}%`); }
  const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
  const limit = Math.min(Number(query.limit) || 50, 500);
  const offset = Math.max(Number(query.offset) || 0, 0);
  return {
    data: all(`SELECT j.* FROM jurnal j ${where} ORDER BY j.tanggal DESC, j.id DESC LIMIT ? OFFSET ?`,
      [...p, limit, offset]),
    total: scalar(`SELECT COUNT(*) FROM jurnal j ${where}`, p),
    limit, offset,
  };
});

router.get('/api/akuntansi/jurnal/:id', 'akuntansi.view', ({ params }) => {
  const id = idParam(params);
  const j = get('SELECT * FROM jurnal WHERE id = ?', [id]);
  if (!j) throw notFound('Jurnal tidak ditemukan');
  return {
    ...j,
    detail: all(
      `SELECT d.*, c.nama AS akun_nama, c.tipe AS akun_tipe FROM jurnal_detail d
         JOIN coa c ON c.kode = d.coa_kode WHERE d.jurnal_id = ? ORDER BY d.urut`, [id]),
    terbilang: terbilang(j.total_debit),
  };
});

router.post('/api/akuntansi/jurnal', 'akuntansi.create', ({ body, ctx }) => acc.postJournal({
  tanggal: date(body, 'tanggal', { required: false, dflt: today() }),
  tipe: body.tipe || 'umum',
  keterangan: str(body, 'keterangan', { max: 300, label: 'Keterangan jurnal' }),
  referensi: str(body, 'referensi', { required: false, max: 100 }),
  cabang_id: body.cabang_id ? Number(body.cabang_id) : null,
  unit_usaha_id: body.unit_usaha_id ? Number(body.unit_usaha_id) : null,
  lines: body.lines || body.detail || [],
}, ctx));

router.post('/api/akuntansi/jurnal/:id/batal', 'akuntansi.post', ({ params, body, ctx }) =>
  acc.voidJournal(idParam(params), str(body, 'alasan', { max: 300, label: 'Alasan pembatalan' }), ctx));

// ------------------------- Jurnal berulang --------------------------

router.get('/api/akuntansi/recurring', 'akuntansi.view', () =>
  ({ data: all('SELECT * FROM jurnal_recurring ORDER BY id DESC') }));

router.post('/api/akuntansi/recurring', 'akuntansi.create', ({ body, ctx }) => {
  const nama = str(body, 'nama', { max: 150 });
  const lines = body.template || body.lines;
  if (!Array.isArray(lines) || lines.length < 2) throw badRequest('Template jurnal minimal 2 baris');
  const { lastInsertRowid: id } = run(
    `INSERT INTO jurnal_recurring(nama, frekuensi, tanggal_mulai, tanggal_akhir, template)
     VALUES(?,?,?,?,?)`,
    [nama, body.frekuensi || 'bulanan', date(body, 'tanggal_mulai', { required: false, dflt: today() }),
      body.tanggal_akhir || null, JSON.stringify(lines)],
  );
  logAudit(ctx, { aksi: 'create', modul: 'akuntansi', entitas_id: id,
    keterangan: `Jurnal berulang "${nama}" dibuat` });
  return get('SELECT * FROM jurnal_recurring WHERE id = ?', [id]);
});

router.post('/api/akuntansi/recurring/:id/jalankan', 'akuntansi.post', ({ params, body, ctx }) => {
  const id = idParam(params);
  const r = get('SELECT * FROM jurnal_recurring WHERE id = ?', [id]);
  if (!r) throw notFound('Jurnal berulang tidak ditemukan');
  if (r.status !== 'aktif') throw conflict('Jurnal berulang ini tidak aktif');
  const tanggal = date(body, 'tanggal', { required: false, dflt: today() });
  const jurnal = acc.postJournal({
    tanggal, tipe: 'umum', referensi: `recurring:${id}`,
    keterangan: `${r.nama} (jurnal berulang ${tanggal.slice(0, 7)})`,
    lines: JSON.parse(r.template),
  }, ctx);
  run('UPDATE jurnal_recurring SET terakhir_dibuat = ? WHERE id = ?', [tanggal, id]);
  return jurnal;
});

// --------------------------- Periode ---------------------------

router.get('/api/akuntansi/periode', 'akuntansi.view', ({ query }) => {
  const tahun = Number(query.tahun) || new Date().getFullYear();
  const rows = all('SELECT * FROM periode_akuntansi WHERE tahun = ? ORDER BY bulan', [tahun]);
  const bulan = Array.from({ length: 12 }, (_, i) => {
    const f = rows.find((r) => r.bulan === i + 1);
    return f || { tahun, bulan: i + 1, status: 'terbuka' };
  });
  return { tahun, data: bulan };
});

router.post('/api/akuntansi/periode/tutup', 'akuntansi.post', ({ body, ctx }) =>
  acc.tutupPeriode(num(body, 'tahun', { min: 2000, max: 2200 }), num(body, 'bulan', { min: 1, max: 12 }), ctx));

router.post('/api/akuntansi/periode/buka', 'akuntansi.post', ({ body, ctx }) =>
  acc.bukaPeriode(num(body, 'tahun', { min: 2000, max: 2200 }), num(body, 'bulan', { min: 1, max: 12 }), ctx));

router.post('/api/akuntansi/tutup-tahun', 'akuntansi.post', ({ body, ctx }) =>
  acc.jurnalPenutup(num(body, 'tahun', { min: 2000, max: 2200 }), ctx));

// -------------------------- Laporan Keuangan -------------------------

const filterDari = (query) => ({
  dari: query.dari || null,
  sampai: query.sampai || today(),
  cabang_id: query.cabang_id ? Number(query.cabang_id) : null,
  unit_usaha_id: query.unit_usaha_id ? Number(query.unit_usaha_id) : null,
});

router.get('/api/laporan/neraca-saldo', 'laporan.view', ({ query }) => acc.trialBalance(filterDari(query)));

router.get('/api/laporan/buku-besar', 'laporan.view', ({ query }) => {
  if (!query.kode) throw badRequest('Parameter "kode" (kode akun) wajib diisi');
  return acc.bukuBesar(query.kode, filterDari(query));
});

router.get('/api/laporan/neraca', 'laporan.view', ({ query }) => acc.neraca(filterDari(query)));

router.get('/api/laporan/laba-rugi', 'laporan.view', ({ query }) => {
  const f = filterDari(query);
  return acc.labaRugi({ ...f, dari: f.dari || `${yearOf(f.sampai)}-01-01` });
});

router.get('/api/laporan/arus-kas', 'laporan.view', ({ query }) => {
  const f = filterDari(query);
  return acc.arusKas({ ...f, dari: f.dari || `${yearOf(f.sampai)}-01-01` });
});

router.get('/api/laporan/perubahan-ekuitas', 'laporan.view', ({ query }) => {
  const f = filterDari(query);
  return acc.perubahanEkuitas({ ...f, dari: f.dari || `${yearOf(f.sampai)}-01-01` });
});

router.get('/api/laporan/rasio', 'laporan.view', ({ query }) => acc.rasioKeuangan(filterDari(query)));

/** Catatan atas Laporan Keuangan (CALK) - kerangka otomatis. */
router.get('/api/laporan/calk', 'laporan.view', ({ query }) => {
  const f = filterDari(query);
  const tahun = yearOf(f.sampai);
  const n = acc.neraca(f);
  const lr = acc.labaRugi({ ...f, dari: `${tahun}-01-01` });
  const profil = Object.fromEntries(
    all("SELECT key, value FROM settings WHERE key LIKE 'koperasi.%'").map((r) => [r.key, r.value]));
  return {
    tahun,
    umum: {
      judul: 'Catatan atas Laporan Keuangan',
      entitas: profil['koperasi.nama'] || 'Koperasi Serba Usaha',
      badan_hukum: profil['koperasi.badan_hukum'] || '-',
      alamat: profil['koperasi.alamat'] || '-',
      bidang_usaha: all("SELECT nama, jenis FROM unit_usaha WHERE status = 'aktif'"),
    },
    kebijakan_akuntansi: [
      'Laporan keuangan disusun berdasarkan SAK Entitas Privat (SAK EP) dan Peraturan Menteri Koperasi dan UKM Nomor 2 Tahun 2024 tentang Kebijakan Akuntansi Koperasi.',
      'Laporan keuangan disusun atas dasar akrual (accrual basis) dan konsep biaya historis.',
      'Mata uang penyajian adalah Rupiah.',
      'Persediaan dinilai dengan metode rata-rata bergerak (moving average) dan dicatat secara perpetual.',
      'Aset tetap dicatat sebesar harga perolehan dikurangi akumulasi penyusutan; penyusutan memakai metode garis lurus/saldo menurun sesuai kelompok aset.',
      'Simpanan Pokok dan Simpanan Wajib disajikan sebagai ekuitas koperasi sesuai UU No. 25 Tahun 1992 Pasal 41.',
      'Simpanan Sukarela, Simpanan Berjangka, dan Deposito Koperasi disajikan sebagai liabilitas.',
      'Pendapatan jasa pinjaman diakui pada saat diterima (cash basis untuk pinjaman non-lancar) sesuai prinsip konservatisme.',
    ],
    penjelasan_pos: {
      kas_dan_setara_kas: n.aset.filter((r) => r.kode.startsWith('1-11') || r.kode.startsWith('1-12')),
      piutang_pinjaman: n.aset.filter((r) => r.kode.startsWith('1-13')),
      persediaan: n.aset.filter((r) => r.kode.startsWith('1-14')),
      aset_tetap: n.aset.filter((r) => r.kode.startsWith('1-16')),
      liabilitas: n.kewajiban,
      ekuitas: n.ekuitas,
      pendapatan: lr.pendapatan,
      beban: lr.beban,
    },
    ringkasan: {
      total_aset: n.total_aset, total_liabilitas: n.total_kewajiban,
      total_ekuitas: n.total_ekuitas, shu_tahun_berjalan: lr.shu_bersih,
      shu_terbilang: terbilang(lr.shu_bersih),
    },
  };
});

/** Rekapitulasi pajak (PPh & PPN) dari mutasi akun pajak. */
router.get('/api/laporan/pajak', 'laporan.view', ({ query }) => {
  const f = filterDari(query);
  const akunPajak = all("SELECT kode, nama FROM coa WHERE kode LIKE '2-13%' OR nama LIKE '%pajak%'");
  return {
    periode: f,
    akun: akunPajak.map((a) => ({ ...a, ...acc.saldoAkun(a.kode, f) })),
    ppn_keluaran: acc.saldoAkun(acc.AKUN.hutang_pajak(), f),
    catatan: 'Koperasi wajib menyampaikan SPT Tahunan PPh Badan. SHU yang dibagikan kepada anggota '
      + 'bukan merupakan objek PPh Pasal 23 sepanjang memenuhi ketentuan perpajakan yang berlaku.',
  };
});

/** Neraca lajur / worksheet: neraca saldo → penyesuaian → laba rugi & neraca. */
router.get('/api/laporan/neraca-lajur', 'laporan.view', ({ query }) => {
  const f = filterDari(query);
  const tahun = yearOf(f.sampai);
  const tb = acc.trialBalance({ ...f, dari: `${tahun}-01-01` });
  return {
    periode: f,
    baris: tb.baris.map((r) => ({
      kode: r.kode, nama: r.nama, tipe: r.tipe,
      ns_debit: r.saldo_debit, ns_kredit: r.saldo_kredit,
      lr_debit: r.tipe === 'beban' ? r.saldo : 0,
      lr_kredit: r.tipe === 'pendapatan' ? r.saldo : 0,
      neraca_debit: r.tipe === 'aset' ? r.saldo : 0,
      neraca_kredit: ['kewajiban', 'ekuitas'].includes(r.tipe) ? r.saldo : 0,
    })),
  };
});

export default router;
