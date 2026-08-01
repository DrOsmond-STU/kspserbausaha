/**
 * Modul 9 - Kas & Bank, dan Modul 10 - Anggaran (RKAP).
 */
import { createRouter, notFound, badRequest, conflict } from '../lib/http.js';
import { all, get, run, scalar, tx, nextNumber } from '../db.js';
import { logAudit } from '../lib/audit.js';
import { idParam, num, str, date, oneOf, today, rupiah, terbilang, yearOf } from '../lib/util.js';
import { postJournal, saldoAkun, AKUN } from '../services/accounting.js';

const router = createRouter();

// --------------------------- Kas & Bank ---------------------------

router.get('/api/kas', 'kas.view', ({ query }) => {
  const w = [];
  const p = [];
  if (query.dari) { w.push('tanggal >= ?'); p.push(query.dari); }
  if (query.sampai) { w.push('tanggal <= ?'); p.push(query.sampai); }
  if (query.jenis) { w.push('jenis = ?'); p.push(query.jenis); }
  const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
  const limit = Math.min(Number(query.limit) || 100, 500);
  const data = all(`SELECT * FROM kas_bank ${where} ORDER BY tanggal DESC, id DESC LIMIT ?`, [...p, limit]);
  return {
    data,
    total_masuk: data.filter((r) => r.jenis === 'kas_masuk').reduce((s, r) => s + r.nominal, 0),
    total_keluar: data.filter((r) => r.jenis === 'kas_keluar').reduce((s, r) => s + r.nominal, 0),
  };
});

/** Posisi seluruh akun kas & bank. */
router.get('/api/kas/posisi', 'kas.view', ({ query }) => {
  const sampai = query.sampai || today();
  const akun = all("SELECT kode, nama, is_kas, is_bank FROM coa WHERE is_kas = 1 OR is_bank = 1 ORDER BY kode");
  const baris = akun.map((a) => ({ ...a, ...saldoAkun(a.kode, { sampai }) }));
  return {
    per_tanggal: sampai,
    baris,
    total_kas: baris.filter((b) => b.is_kas).reduce((s, b) => s + b.saldo, 0),
    total_bank: baris.filter((b) => b.is_bank).reduce((s, b) => s + b.saldo, 0),
    total: baris.reduce((s, b) => s + b.saldo, 0),
  };
});

/** Bukti kas masuk / keluar. */
router.post('/api/kas', 'kas.create', ({ body, ctx }) => {
  const jenis = oneOf(body, 'jenis', ['kas_masuk', 'kas_keluar', 'petty_cash'], { label: 'Jenis transaksi' });
  const nominal = num(body, 'nominal', { min: 1, label: 'Nominal' });
  const coaKas = str(body, 'coa_kas', { max: 20, label: 'Akun kas/bank' });
  const coaLawan = str(body, 'coa_lawan', { max: 20, label: 'Akun lawan' });
  if (coaKas === coaLawan) throw badRequest('Akun kas dan akun lawan tidak boleh sama');
  const tanggal = date(body, 'tanggal', { required: false, dflt: today() });
  const keterangan = str(body, 'keterangan', { max: 300, label: 'Keterangan' });

  return tx(() => {
    const masuk = jenis === 'kas_masuk';
    // Nomor bukti kas dipakai sekaligus sebagai nomor jurnal agar keduanya
    // dapat ditelusuri sebagai satu dokumen yang sama.
    const nomor = nextNumber(masuk ? 'BKM' : 'BKK', tanggal);
    const jurnal = postJournal({
      nomor, tanggal, tipe: masuk ? 'kas_masuk' : 'kas_keluar',
      keterangan, cabang_id: body.cabang_id ? Number(body.cabang_id) : null,
      unit_usaha_id: body.unit_usaha_id ? Number(body.unit_usaha_id) : null,
      lines: masuk
        ? [{ coa_kode: coaKas, debit: nominal }, { coa_kode: coaLawan, kredit: nominal }]
        : [{ coa_kode: coaLawan, debit: nominal }, { coa_kode: coaKas, kredit: nominal }],
    }, ctx);
    const { lastInsertRowid: id } = run(
      `INSERT INTO kas_bank(nomor, tanggal, jenis, coa_kas, coa_lawan, nominal, keterangan, pihak,
         cabang_id, unit_usaha_id, jurnal_id, dibuat_oleh)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      [nomor, tanggal, jenis, coaKas, coaLawan, nominal, keterangan, body.pihak || null,
        body.cabang_id || null, body.unit_usaha_id || null, jurnal.id, ctx?.user?.username || 'sistem'],
    );
    logAudit(ctx, { aksi: 'create', modul: 'kas', entitas_id: id,
      keterangan: `${nomor} ${jenis} Rp ${nominal.toLocaleString('id-ID')}: ${keterangan}` });
    return { id, nomor, jurnal, terbilang: terbilang(nominal) };
  });
});

/** Transfer antar kas / bank. */
router.post('/api/kas/transfer', 'kas.create', ({ body, ctx }) => {
  const dari = str(body, 'coa_kas', { max: 20, label: 'Akun asal' });
  const ke = str(body, 'coa_tujuan', { max: 20, label: 'Akun tujuan' });
  if (dari === ke) throw badRequest('Akun asal dan tujuan tidak boleh sama');
  const nominal = num(body, 'nominal', { min: 1 });
  const tanggal = date(body, 'tanggal', { required: false, dflt: today() });
  const keterangan = str(body, 'keterangan', { required: false, max: 300 }) || `Transfer ${dari} → ${ke}`;

  return tx(() => {
    const nomor = nextNumber('TRF', tanggal);
    const jurnal = postJournal({
      nomor, tanggal, tipe: 'umum', keterangan,
      lines: [{ coa_kode: ke, debit: nominal }, { coa_kode: dari, kredit: nominal }],
    }, ctx);
    const { lastInsertRowid: id } = run(
      `INSERT INTO kas_bank(nomor, tanggal, jenis, coa_kas, coa_lawan, coa_tujuan, nominal,
         keterangan, jurnal_id, dibuat_oleh) VALUES(?,?,'transfer',?,?,?,?,?,?,?)`,
      [nomor, tanggal, dari, ke, ke, nominal, keterangan, jurnal.id, ctx?.user?.username || 'sistem'],
    );
    logAudit(ctx, { aksi: 'create', modul: 'kas', entitas_id: id,
      keterangan: `${nomor} transfer Rp ${nominal.toLocaleString('id-ID')} dari ${dari} ke ${ke}` });
    return { id, nomor, jurnal };
  });
});

/** Rekonsiliasi bank: menandai transaksi yang sudah cocok dengan rekening koran. */
router.post('/api/kas/rekonsiliasi', 'kas.update', ({ body, ctx }) => {
  const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(Boolean) : [];
  if (!ids.length) throw badRequest('Pilih minimal satu transaksi untuk direkonsiliasi');
  const tgl = date(body, 'tanggal', { required: false, dflt: today() });
  const cocok = body.cocok !== false;
  return tx(() => {
    for (const id of ids) {
      run('UPDATE kas_bank SET rekonsiliasi = ?, tanggal_rekon = ? WHERE id = ?',
        [cocok ? 1 : 0, cocok ? tgl : null, id]);
    }
    logAudit(ctx, { aksi: 'update', modul: 'kas',
      keterangan: `Rekonsiliasi ${ids.length} transaksi kas/bank per ${tgl}` });
    return { diproses: ids.length, tanggal: tgl };
  });
});

router.get('/api/kas/rekonsiliasi/belum', 'kas.view', ({ query }) => ({
  data: all(
    `SELECT * FROM kas_bank WHERE rekonsiliasi = 0 ${query.sampai ? 'AND tanggal <= ?' : ''}
      ORDER BY tanggal DESC LIMIT 200`, query.sampai ? [query.sampai] : []),
}));

/**
 * Cash opname: mencocokkan saldo fisik dengan saldo sistem.
 * Selisih langsung dibukukan sebagai beban / pendapatan lain.
 */
router.post('/api/kas/opname', 'kas.create', ({ body, ctx }) => {
  const coaKas = str(body, 'coa_kas', { max: 20, label: 'Akun kas' });
  const fisik = num(body, 'saldo_fisik', { min: 0, label: 'Saldo fisik' });
  const tanggal = date(body, 'tanggal', { required: false, dflt: today() });
  const sistem = saldoAkun(coaKas, { sampai: tanggal }).saldo;
  const selisih = fisik - sistem;

  return tx(() => {
    let jurnal = null;
    if (selisih !== 0) {
      jurnal = postJournal({
        tanggal, tipe: 'penyesuaian', referensi: `opname_kas:${coaKas}`,
        keterangan: `Penyesuaian cash opname ${coaKas} per ${tanggal}`,
        lines: selisih > 0
          ? [{ coa_kode: coaKas, debit: selisih, keterangan: 'Selisih lebih kas' },
            { coa_kode: AKUN.pendapatan_lain(), kredit: selisih, keterangan: 'Selisih lebih kas' }]
          : [{ coa_kode: AKUN.beban_selisih(), debit: -selisih, keterangan: 'Selisih kurang kas' },
            { coa_kode: coaKas, kredit: -selisih, keterangan: 'Selisih kurang kas' }],
      }, ctx);
    }
    const { lastInsertRowid: id } = run(
      `INSERT INTO cash_opname(tanggal, coa_kas, saldo_sistem, saldo_fisik, selisih, keterangan,
         jurnal_id, petugas) VALUES(?,?,?,?,?,?,?,?)`,
      [tanggal, coaKas, sistem, fisik, selisih, body.keterangan || null, jurnal?.id || null,
        ctx?.user?.username || 'sistem'],
    );
    logAudit(ctx, { aksi: 'post', modul: 'kas', entitas_id: id,
      keterangan: `Cash opname ${coaKas}: sistem Rp ${sistem.toLocaleString('id-ID')}, `
        + `fisik Rp ${fisik.toLocaleString('id-ID')}, selisih Rp ${selisih.toLocaleString('id-ID')}` });
    return { id, saldo_sistem: sistem, saldo_fisik: fisik, selisih, jurnal };
  });
});

router.get('/api/kas/opname', 'kas.view', () =>
  ({ data: all('SELECT * FROM cash_opname ORDER BY tanggal DESC, id DESC LIMIT 100') }));

// ---------------------------- Anggaran (RKAP) ----------------------------

router.get('/api/anggaran', 'anggaran.view', ({ query }) => ({
  data: all(
    `SELECT a.*, u.nama AS unit_nama, c.nama AS cabang_nama,
            (SELECT COALESCE(SUM(nominal),0) FROM anggaran_detail WHERE anggaran_id = a.id) AS total
       FROM anggaran a LEFT JOIN unit_usaha u ON u.id = a.unit_usaha_id
       LEFT JOIN cabang c ON c.id = a.cabang_id
      ${query.tahun ? 'WHERE a.tahun = ?' : ''} ORDER BY a.tahun DESC, a.id DESC`,
    query.tahun ? [Number(query.tahun)] : []),
}));

router.get('/api/anggaran/:id', 'anggaran.view', ({ params }) => {
  const id = idParam(params);
  const a = get('SELECT * FROM anggaran WHERE id = ?', [id]);
  if (!a) throw notFound('Anggaran tidak ditemukan');
  const detail = all(
    `SELECT d.*, c.nama AS akun_nama, c.tipe AS akun_tipe FROM anggaran_detail d
       JOIN coa c ON c.kode = d.coa_kode WHERE d.anggaran_id = ? ORDER BY d.coa_kode, d.bulan`, [id]);
  return { ...a, detail, total: detail.reduce((s, r) => s + r.nominal, 0) };
});

router.post('/api/anggaran', 'anggaran.create', ({ body, ctx }) => {
  const tahun = num(body, 'tahun', { min: 2000, max: 2200 });
  const nama = str(body, 'nama', { max: 150, label: 'Nama anggaran' });
  const detail = body.detail || [];
  if (!Array.isArray(detail) || !detail.length) throw badRequest('Rincian anggaran minimal 1 baris');

  return tx(() => {
    const { lastInsertRowid: id } = run(
      `INSERT INTO anggaran(tahun, nama, unit_usaha_id, cabang_id, keterangan) VALUES(?,?,?,?,?)`,
      [tahun, nama, body.unit_usaha_id || null, body.cabang_id || null, body.keterangan || null]);
    for (const d of detail) {
      if (!get('SELECT kode FROM coa WHERE kode = ?', [d.coa_kode])) {
        throw badRequest(`Akun ${d.coa_kode} tidak terdaftar dalam bagan akun`);
      }
      run(`INSERT INTO anggaran_detail(anggaran_id, coa_kode, bulan, nominal, keterangan)
           VALUES(?,?,?,?,?)`,
      [id, d.coa_kode, Number(d.bulan) || 0, rupiah(d.nominal), d.keterangan || null]);
    }
    logAudit(ctx, { aksi: 'create', modul: 'anggaran', entitas_id: id,
      keterangan: `RKAP ${tahun}: ${nama} (${detail.length} baris)` });
    return get('SELECT * FROM anggaran WHERE id = ?', [id]);
  });
});

router.post('/api/anggaran/:id/setujui', 'anggaran.approve', ({ params, ctx }) => {
  const id = idParam(params);
  const a = get('SELECT * FROM anggaran WHERE id = ?', [id]);
  if (!a) throw notFound('Anggaran tidak ditemukan');
  if (a.status === 'disetujui') throw conflict('Anggaran ini sudah disetujui');
  run(`UPDATE anggaran SET status = 'disetujui', disetujui_oleh = ?, disetujui_pada = datetime('now')
       WHERE id = ?`, [ctx?.user?.username || 'sistem', id]);
  logAudit(ctx, { aksi: 'approve', modul: 'anggaran', entitas_id: id,
    keterangan: `RKAP ${a.tahun} "${a.nama}" disetujui` });
  return get('SELECT * FROM anggaran WHERE id = ?', [id]);
});

/** Monitoring realisasi anggaran vs realisasi buku besar (variance analysis). */
router.get('/api/anggaran/:id/realisasi', 'anggaran.view', ({ params, query }) => {
  const id = idParam(params);
  const a = get('SELECT * FROM anggaran WHERE id = ?', [id]);
  if (!a) throw notFound('Anggaran tidak ditemukan');
  const sampai = query.sampai || `${a.tahun}-12-31`;
  const detail = all(
    `SELECT d.coa_kode, c.nama AS akun_nama, c.tipe, SUM(d.nominal) AS anggaran
       FROM anggaran_detail d JOIN coa c ON c.kode = d.coa_kode
      WHERE d.anggaran_id = ? GROUP BY d.coa_kode, c.nama, c.tipe ORDER BY d.coa_kode`, [id]);
  const baris = detail.map((d) => {
    const real = saldoAkun(d.coa_kode, {
      dari: `${a.tahun}-01-01`, sampai,
      unit_usaha_id: a.unit_usaha_id, cabang_id: a.cabang_id,
    }).saldo;
    const selisih = real - d.anggaran;
    return {
      ...d, realisasi: real, selisih,
      persen_realisasi: d.anggaran ? Number((real / d.anggaran * 100).toFixed(1)) : 0,
      // Untuk beban: realisasi > anggaran = tidak menguntungkan
      status: d.tipe === 'beban'
        ? (real > d.anggaran ? 'melebihi anggaran' : 'dalam anggaran')
        : (real >= d.anggaran ? 'tercapai' : 'belum tercapai'),
    };
  });
  return {
    anggaran: a, per_tanggal: sampai, baris,
    total_anggaran: baris.reduce((s, r) => s + r.anggaran, 0),
    total_realisasi: baris.reduce((s, r) => s + r.realisasi, 0),
  };
});

export default router;
