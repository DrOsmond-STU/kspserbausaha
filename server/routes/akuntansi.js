/**
 * Modul 7 & 8 - Akuntansi dan Laporan Keuangan.
 */
import { createRouter, notFound, badRequest, conflict } from '../lib/http.js';
import { all, get, run, scalar, tx, setting } from '../db.js';
import { logAudit } from '../lib/audit.js';
import { idParam, num, str, date, oneOf, today, rupiah, terbilang, yearOf } from '../lib/util.js';
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
    // Kolom sumber dapat kosong pada jurnal lama; diturunkan dari referensinya.
    data: all(`SELECT j.* FROM jurnal j ${where} ORDER BY j.tanggal DESC, j.id DESC LIMIT ? OFFSET ?`,
      [...p, limit, offset]).map((j) => ({ ...j, sumber: acc.sumberJurnal(j) })),
    total: scalar(`SELECT COUNT(*) FROM jurnal j ${where}`, p),
    limit, offset,
  };
});

router.get('/api/akuntansi/jurnal/:id', 'akuntansi.view', ({ params }) => {
  const id = idParam(params);
  const j = get('SELECT * FROM jurnal WHERE id = ?', [id]);
  if (!j) throw notFound('Jurnal tidak ditemukan');
  const sumber = acc.sumberJurnal(j);
  return {
    ...j,
    sumber,
    // Sama dengan aturan voidJournal(): jurnal sistem dibatalkan lewat dokumen sumbernya.
    dapat_dibatalkan: j.status === 'posted' && !String(j.referensi || '').startsWith('void:')
      && (sumber !== 'sistem' || j.tipe === 'penutup'),
    detail: all(
      `SELECT d.*, c.nama AS akun_nama, c.tipe AS akun_tipe FROM jurnal_detail d
         JOIN coa c ON c.kode = d.coa_kode WHERE d.jurnal_id = ? ORDER BY d.urut`, [id]),
    terbilang: terbilang(j.total_debit),
  };
});

router.post('/api/akuntansi/jurnal', 'akuntansi.create', ({ body, ctx }) => acc.postJournal({
  tanggal: date(body, 'tanggal', { required: false, dflt: today() }),
  // Tipe lain (penjualan, simpanan, penutup, ...) khusus untuk jurnal otomatis
  // modul; jurnal umum yang diinput tangan dibatasi pada tipe berikut.
  tipe: oneOf(body, 'tipe', ['umum', 'penyesuaian', 'pembuka'], { required: false, dflt: 'umum' }),
  sumber: 'manual',
  keterangan: str(body, 'keterangan', { max: 300, label: 'Keterangan jurnal' }),
  referensi: str(body, 'referensi', { required: false, max: 100 }),
  cabang_id: body.cabang_id ? Number(body.cabang_id) : null,
  unit_usaha_id: body.unit_usaha_id ? Number(body.unit_usaha_id) : null,
  lines: body.lines || body.detail || [],
}, ctx));

router.post('/api/akuntansi/jurnal/:id/batal', 'akuntansi.post', ({ params, body, ctx }) =>
  acc.voidJournal(idParam(params), str(body, 'alasan', { max: 300, label: 'Alasan pembatalan' }), ctx));

// ------------------------- Jurnal berulang --------------------------

const recurringDenganJadwal = (r) => ({ ...r, jadwal_berikutnya: r.status === 'aktif' ? acc.jadwalBerikutnya(r) : null });

function bacaRecurring(body, lama = null) {
  const frekuensi = oneOf(body, 'frekuensi', Object.keys(acc.FREKUENSI_RECURRING),
    { required: false, dflt: lama?.frekuensi || 'bulanan' });
  const tanggalMulai = date(body, 'tanggal_mulai', { required: false, dflt: lama?.tanggal_mulai || today() });
  const tanggalAkhir = body.tanggal_akhir === undefined ? (lama?.tanggal_akhir ?? null)
    : (date(body, 'tanggal_akhir', { required: false }) || null);
  if (tanggalAkhir && tanggalAkhir < tanggalMulai) throw badRequest('Tanggal akhir tidak boleh sebelum tanggal mulai');
  const lines = body.template || body.lines;
  return {
    nama: body.nama !== undefined || !lama ? str(body, 'nama', { max: 150, label: 'Nama jurnal berulang' }) : lama.nama,
    frekuensi, tanggal_mulai: tanggalMulai, tanggal_akhir: tanggalAkhir,
    template: lines !== undefined || !lama ? JSON.stringify(acc.validasiTemplate(lines)) : lama.template,
    status: oneOf(body, 'status', ['aktif', 'nonaktif'], { required: false, dflt: lama?.status || 'aktif' }),
  };
}

router.get('/api/akuntansi/recurring', 'akuntansi.view', () =>
  ({ data: all('SELECT * FROM jurnal_recurring ORDER BY id DESC').map(recurringDenganJadwal) }));

router.get('/api/akuntansi/recurring/:id', 'akuntansi.view', ({ params }) => {
  const r = get('SELECT * FROM jurnal_recurring WHERE id = ?', [idParam(params)]);
  if (!r) throw notFound('Jurnal berulang tidak ditemukan');
  return {
    ...recurringDenganJadwal(r),
    riwayat: all(`SELECT id, nomor, tanggal, status, total_debit FROM jurnal
                   WHERE referensi = ? ORDER BY tanggal DESC LIMIT 60`, [`recurring:${r.id}`]),
  };
});

router.post('/api/akuntansi/recurring', 'akuntansi.create', ({ body, ctx }) => {
  const d = bacaRecurring(body);
  const { lastInsertRowid: id } = run(
    `INSERT INTO jurnal_recurring(nama, frekuensi, tanggal_mulai, tanggal_akhir, template, status)
     VALUES(?,?,?,?,?,?)`,
    [d.nama, d.frekuensi, d.tanggal_mulai, d.tanggal_akhir, d.template, d.status],
  );
  logAudit(ctx, { aksi: 'create', modul: 'akuntansi', entitas_id: id,
    keterangan: `Jurnal berulang "${d.nama}" dibuat`, after: d });
  return recurringDenganJadwal(get('SELECT * FROM jurnal_recurring WHERE id = ?', [id]));
});

router.put('/api/akuntansi/recurring/:id', 'akuntansi.update', ({ params, body, ctx }) => {
  const id = idParam(params);
  const lama = get('SELECT * FROM jurnal_recurring WHERE id = ?', [id]);
  if (!lama) throw notFound('Jurnal berulang tidak ditemukan');
  const d = bacaRecurring(body, lama);
  run(`UPDATE jurnal_recurring SET nama = ?, frekuensi = ?, tanggal_mulai = ?, tanggal_akhir = ?,
         template = ?, status = ? WHERE id = ?`,
  [d.nama, d.frekuensi, d.tanggal_mulai, d.tanggal_akhir, d.template, d.status, id]);
  logAudit(ctx, { aksi: 'update', modul: 'akuntansi', entitas_id: id,
    keterangan: `Jurnal berulang "${d.nama}" diubah`, before: lama, after: d });
  return recurringDenganJadwal(get('SELECT * FROM jurnal_recurring WHERE id = ?', [id]));
});

/** Menghapus template. Jurnal yang sudah terbentuk tetap ada di buku besar. */
router.delete('/api/akuntansi/recurring/:id', 'akuntansi.delete', ({ params, ctx }) => {
  const id = idParam(params);
  const lama = get('SELECT * FROM jurnal_recurring WHERE id = ?', [id]);
  if (!lama) throw notFound('Jurnal berulang tidak ditemukan');
  run('DELETE FROM jurnal_recurring WHERE id = ?', [id]);
  logAudit(ctx, { aksi: 'delete', modul: 'akuntansi', entitas_id: id,
    keterangan: `Jurnal berulang "${lama.nama}" dihapus`, before: lama });
  return { dihapus: true, id };
});

/** Memposting seluruh jadwal yang sudah jatuh tempo sampai tanggal tertentu. */
router.post('/api/akuntansi/recurring/:id/jalankan', 'akuntansi.post', ({ params, body, ctx }) => {
  const id = idParam(params);
  const r = get('SELECT * FROM jurnal_recurring WHERE id = ?', [id]);
  if (!r) throw notFound('Jurnal berulang tidak ditemukan');
  if (r.status !== 'aktif') throw conflict('Jurnal berulang ini tidak aktif');
  const sampai = date(body, 'tanggal', { required: false, dflt: today() });
  const h = acc.jalankanRecurring({ sampai, id }, ctx).template[0];
  if (h.galat) throw badRequest(`Jurnal berulang gagal diposting: ${h.galat}`);
  logAudit(ctx, { aksi: 'post', modul: 'akuntansi', entitas_id: id,
    keterangan: `Jurnal berulang "${r.nama}" dijalankan s.d. ${sampai}: ${h.dibuat.length} jurnal` });
  return {
    ...h,
    pesan: h.dibuat.length ? `${h.dibuat.length} jurnal diposting`
      : `Belum ada jadwal yang jatuh tempo s.d. ${sampai}${h.jadwal_berikutnya ? ` (berikutnya ${h.jadwal_berikutnya})` : ''}`,
  };
});

/** Menjalankan seluruh jurnal berulang yang jatuh tempo (juga dijalankan otomatis oleh server). */
router.post('/api/akuntansi/recurring-jalankan-semua', 'akuntansi.post', ({ body, ctx }) =>
  acc.jalankanRecurring({ sampai: date(body, 'tanggal', { required: false, dflt: today() }) }, ctx));

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
  const kasBank = new Set(acc.akunKasBank());
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
      kas_dan_setara_kas: n.aset.filter((r) => kasBank.has(r.kode)),
      piutang_pinjaman: n.aset.filter((r) => acc.termasukKelompok(r.kode, 'piutang')),
      persediaan: n.aset.filter((r) => acc.termasukKelompok(r.kode, 'persediaan')),
      aset_tetap: n.aset.filter((r) => acc.termasukKelompok(r.kode, 'aset_tetap')),
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
  // Akun pajak = akun pada master pajak + pemetaan PPN + kelompok "pajak"
  // pada Parameter Sistem. Tidak ada kode akun yang ditanam di sini.
  const kode = new Set(all("SELECT DISTINCT coa_kode FROM pajak WHERE coa_kode IS NOT NULL AND coa_kode <> ''")
    .map((r) => r.coa_kode));
  for (const k of ['hutang_pajak', 'ppn_masukan']) {
    const v = setting(`coa.${k}`, null);
    if (v) kode.add(v);
  }
  const awalan = acc.awalanKelompok('pajak');
  for (const r of all('SELECT kode FROM coa WHERE is_postable = 1')) {
    if (awalan.some((a) => r.kode.startsWith(a))) kode.add(r.kode);
  }
  const akunPajak = [...kode].sort()
    .map((k) => get('SELECT kode, nama FROM coa WHERE kode = ?', [k])).filter(Boolean);
  const ppnKeluaran = setting('coa.hutang_pajak', null);
  const ppnMasukan = setting('coa.ppn_masukan', null);
  return {
    periode: f,
    akun: akunPajak.map((a) => ({ ...a, ...acc.saldoAkun(a.kode, f) })),
    ppn_keluaran: ppnKeluaran ? acc.saldoAkun(ppnKeluaran, f) : null,
    ppn_masukan: ppnMasukan ? acc.saldoAkun(ppnMasukan, f) : null,
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
