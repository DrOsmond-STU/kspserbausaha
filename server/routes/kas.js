/**
 * Modul 9 - Kas & Bank, dan Modul 10 - Anggaran (RKAP).
 */
import { createRouter, notFound, badRequest, conflict } from '../lib/http.js';
import { all, get, run, scalar, tx, nextNumber } from '../db.js';
import { logAudit } from '../lib/audit.js';
import { idParam, num, str, date, oneOf, today, rupiah, terbilang, yearOf } from '../lib/util.js';
import { postJournal, voidJournal, saldoAkun, AKUN, assertAkunKas } from '../services/accounting.js';

const router = createRouter();

// --------------------------- Kas & Bank ---------------------------

router.get('/api/kas', 'kas.view', ({ query }) => {
  const w = [];
  const p = [];
  if (query.dari) { w.push('tanggal >= ?'); p.push(query.dari); }
  if (query.sampai) { w.push('tanggal <= ?'); p.push(query.sampai); }
  if (query.jenis) { w.push('jenis = ?'); p.push(query.jenis); }
  if (query.status) { w.push('status = ?'); p.push(query.status); }
  const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
  const limit = Math.min(Number(query.limit) || 100, 500);
  const data = all(`SELECT * FROM kas_bank ${where} ORDER BY tanggal DESC, id DESC LIMIT ?`, [...p, limit]);
  const berlaku = data.filter((r) => r.status !== 'batal');
  return {
    data,
    total_masuk: berlaku.filter((r) => r.jenis === 'kas_masuk').reduce((s, r) => s + r.nominal, 0),
    total_keluar: berlaku.filter((r) => r.jenis === 'kas_keluar').reduce((s, r) => s + r.nominal, 0),
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
  assertAkunKas(coaKas);
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
  assertAkunKas(dari, 'Akun asal');
  assertAkunKas(ke, 'Akun tujuan');
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

/**
 * Membatalkan bukti kas / transfer yang salah input. Bukti tetap tersimpan
 * berstatus "batal" dan jurnalnya dibalik (reversing entry).
 */
router.post('/api/kas/:id/batal', 'kas.update', ({ params, body, ctx }) => {
  const id = idParam(params);
  const alasan = str(body, 'alasan', { max: 300, label: 'Alasan pembatalan' });
  const k = get('SELECT * FROM kas_bank WHERE id = ?', [id]);
  if (!k) throw notFound('Bukti kas tidak ditemukan');
  if (k.status === 'batal') throw conflict('Bukti kas ini sudah dibatalkan');
  if (k.rekonsiliasi) throw conflict('Bukti kas yang sudah direkonsiliasi tidak dapat dibatalkan',
    'Batalkan tanda rekonsiliasinya terlebih dahulu.');
  return tx(() => {
    const jurnal = k.jurnal_id ? voidJournal(k.jurnal_id, `Pembatalan ${k.nomor}: ${alasan}`, ctx, { sistem: true }) : null;
    run("UPDATE kas_bank SET status = 'batal', alasan_batal = ? WHERE id = ?", [alasan, id]);
    logAudit(ctx, { aksi: 'void', modul: 'kas', entitas_id: id,
      keterangan: `${k.nomor} dibatalkan: ${alasan}`, before: k });
    return { ...get('SELECT * FROM kas_bank WHERE id = ?', [id]), jurnal };
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
    `SELECT * FROM kas_bank WHERE rekonsiliasi = 0 AND status <> 'batal' ${query.sampai ? 'AND tanggal <= ?' : ''}
      ORDER BY tanggal DESC LIMIT 200`, query.sampai ? [query.sampai] : []),
}));

/**
 * Cash opname: mencocokkan saldo fisik dengan saldo sistem.
 * Selisih langsung dibukukan sebagai beban / pendapatan lain.
 */
router.post('/api/kas/opname', 'kas.create', ({ body, ctx }) => {
  const coaKas = str(body, 'coa_kas', { max: 20, label: 'Akun kas' });
  assertAkunKas(coaKas, 'Akun kas');
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

/** Berita acara cash opname (untuk dicetak). */
router.get('/api/kas/opname/:id', 'kas.view', ({ params }) => {
  const o = get(
    `SELECT o.*, c.nama AS akun_kas_nama, j.nomor AS jurnal_nomor FROM cash_opname o
       LEFT JOIN coa c ON c.kode = o.coa_kas LEFT JOIN jurnal j ON j.id = o.jurnal_id
      WHERE o.id = ?`, [idParam(params)]);
  if (!o) throw notFound('Data cash opname tidak ditemukan');
  return { ...o, terbilang_fisik: terbilang(o.saldo_fisik), terbilang_selisih: terbilang(Math.abs(o.selisih)) };
});

/** Satu bukti kas / transfer lengkap dengan nama akun dan jurnalnya (untuk dicetak). */
router.get('/api/kas/:id', 'kas.view', ({ params }) => {
  const k = get(
    `SELECT k.*, ck.nama AS akun_kas_nama, cl.nama AS akun_lawan_nama, ct.nama AS akun_tujuan_nama,
            j.nomor AS jurnal_nomor, u.nama AS unit_nama
       FROM kas_bank k LEFT JOIN coa ck ON ck.kode = k.coa_kas LEFT JOIN coa cl ON cl.kode = k.coa_lawan
       LEFT JOIN coa ct ON ct.kode = k.coa_tujuan LEFT JOIN jurnal j ON j.id = k.jurnal_id
       LEFT JOIN unit_usaha u ON u.id = k.unit_usaha_id
      WHERE k.id = ?`, [idParam(params)]);
  if (!k) throw notFound('Bukti kas tidak ditemukan');
  return { ...k, terbilang: terbilang(k.nominal) };
});

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
  const a = get(`SELECT a.*, u.nama AS unit_nama, c.nama AS cabang_nama FROM anggaran a
                   LEFT JOIN unit_usaha u ON u.id = a.unit_usaha_id LEFT JOIN cabang c ON c.id = a.cabang_id
                  WHERE a.id = ?`, [id]);
  if (!a) throw notFound('Anggaran tidak ditemukan');
  const detail = all(
    `SELECT d.*, c.nama AS akun_nama, c.tipe AS akun_tipe FROM anggaran_detail d
       JOIN coa c ON c.kode = d.coa_kode WHERE d.anggaran_id = ? ORDER BY d.coa_kode, d.bulan`, [id]);
  return { ...a, detail, total: detail.reduce((s, r) => s + r.nominal, 0) };
});

/** Membaca & memvalidasi header + rincian anggaran (dipakai saat menyusun dan merevisi). */
function bacaAnggaran(body) {
  const tahun = num(body, 'tahun', { min: 2000, max: 2200 });
  const nama = str(body, 'nama', { max: 150, label: 'Nama anggaran' });
  const detail = body.detail || [];
  if (!Array.isArray(detail) || !detail.length) throw badRequest('Rincian anggaran minimal 1 baris');
  for (const d of detail) {
    if (!get('SELECT kode FROM coa WHERE kode = ?', [d.coa_kode])) {
      throw badRequest(`Akun ${d.coa_kode} tidak terdaftar dalam bagan akun`);
    }
  }
  return {
    tahun, nama, detail,
    unit_usaha_id: body.unit_usaha_id || null, cabang_id: body.cabang_id || null,
    keterangan: body.keterangan || null,
  };
}

function simpanRincian(id, detail) {
  for (const d of detail) {
    run(`INSERT INTO anggaran_detail(anggaran_id, coa_kode, bulan, nominal, keterangan)
         VALUES(?,?,?,?,?)`,
    [id, d.coa_kode, Number(d.bulan) || 0, rupiah(d.nominal), d.keterangan || null]);
  }
}

/** Anggaran hanya dapat diubah/dihapus selama belum diajukan/disetujui. */
function anggaranDapatDiubah(id, aksi) {
  const a = get('SELECT * FROM anggaran WHERE id = ?', [id]);
  if (!a) throw notFound('Anggaran tidak ditemukan');
  if (!['draft', 'ditolak'].includes(a.status)) {
    throw conflict(`Anggaran berstatus "${a.status}" tidak dapat ${aksi}`,
      'Hanya anggaran berstatus draft atau ditolak yang dapat diubah maupun dihapus.');
  }
  return a;
}

router.post('/api/anggaran', 'anggaran.create', ({ body, ctx }) => {
  const d = bacaAnggaran(body);
  return tx(() => {
    const { lastInsertRowid: id } = run(
      `INSERT INTO anggaran(tahun, nama, unit_usaha_id, cabang_id, keterangan) VALUES(?,?,?,?,?)`,
      [d.tahun, d.nama, d.unit_usaha_id, d.cabang_id, d.keterangan]);
    simpanRincian(id, d.detail);
    logAudit(ctx, { aksi: 'create', modul: 'anggaran', entitas_id: id,
      keterangan: `RKAP ${d.tahun}: ${d.nama} (${d.detail.length} baris)` });
    return get('SELECT * FROM anggaran WHERE id = ?', [id]);
  });
});

/** Revisi anggaran draft/ditolak: header dan rincian diganti seluruhnya, status kembali draft. */
router.put('/api/anggaran/:id', 'anggaran.update', ({ params, body, ctx }) => {
  const id = idParam(params);
  const lama = anggaranDapatDiubah(id, 'diubah');
  const d = bacaAnggaran(body);
  return tx(() => {
    run(`UPDATE anggaran SET tahun = ?, nama = ?, unit_usaha_id = ?, cabang_id = ?, keterangan = ?,
           status = 'draft' WHERE id = ?`,
    [d.tahun, d.nama, d.unit_usaha_id, d.cabang_id, d.keterangan, id]);
    run('DELETE FROM anggaran_detail WHERE anggaran_id = ?', [id]);
    simpanRincian(id, d.detail);
    logAudit(ctx, { aksi: 'update', modul: 'anggaran', entitas_id: id,
      keterangan: `RKAP ${d.tahun}: ${d.nama} direvisi (${d.detail.length} baris)`, before: lama });
    return get('SELECT * FROM anggaran WHERE id = ?', [id]);
  });
});

router.delete('/api/anggaran/:id', 'anggaran.delete', ({ params, ctx }) => {
  const id = idParam(params);
  const lama = anggaranDapatDiubah(id, 'dihapus');
  return tx(() => {
    run('DELETE FROM anggaran_detail WHERE anggaran_id = ?', [id]);
    run('DELETE FROM anggaran WHERE id = ?', [id]);
    logAudit(ctx, { aksi: 'delete', modul: 'anggaran', entitas_id: id,
      keterangan: `RKAP ${lama.tahun} "${lama.nama}" dihapus`, before: lama });
    return { dihapus: true, id };
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

/** Menolak anggaran beserta catatan revisi; penyusun dapat memperbaikinya lalu menyimpan ulang. */
router.post('/api/anggaran/:id/tolak', 'anggaran.approve', ({ params, body, ctx }) => {
  const id = idParam(params);
  const catatan = str(body, 'catatan', { max: 500, label: 'Catatan revisi' });
  const a = get('SELECT * FROM anggaran WHERE id = ?', [id]);
  if (!a) throw notFound('Anggaran tidak ditemukan');
  if (a.status === 'disetujui') throw conflict('Anggaran yang sudah disetujui tidak dapat ditolak');
  if (a.status === 'ditolak') throw conflict('Anggaran ini sudah ditolak');
  run(`UPDATE anggaran SET status = 'ditolak', catatan_revisi = ?, disetujui_oleh = NULL,
         disetujui_pada = NULL WHERE id = ?`, [catatan, id]);
  logAudit(ctx, { aksi: 'approve', modul: 'anggaran', entitas_id: id,
    keterangan: `RKAP ${a.tahun} "${a.nama}" DITOLAK: ${catatan}` });
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
