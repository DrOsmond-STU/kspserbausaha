/**
 * Modul 20 (Compliance), 21 (Internal Audit), 22 (Enterprise Risk Management),
 * dan 23 (CRM Anggota) - pilar Good Cooperative Governance.
 */
import { createRouter, notFound, badRequest, conflict } from '../lib/http.js';
import { all, get, run, scalar, nextNumber, tx } from '../db.js';
import { crud, mountCrud } from '../lib/crud.js';
import { logAudit, notify } from '../lib/audit.js';
import { idParam, num, str, date, oneOf, today, diffDays } from '../lib/util.js';

const router = createRouter();

// --------------------------- Compliance ---------------------------

mountCrud(router, '/api/compliance', 'compliance', crud({
  table: 'compliance_item', modul: 'compliance',
  fields: ['kategori', 'nama', 'dasar_hukum', 'nomor', 'penerbit', 'tanggal_terbit',
    'tanggal_kadaluarsa', 'pic', 'dokumen_id', 'status', 'catatan'],
  required: ['kategori', 'nama'], search: ['nama', 'nomor', 'dasar_hukum'],
  orderBy: 'tanggal_kadaluarsa ASC', filters: ['kategori'],
}));

/** Dashboard kepatuhan: perizinan yang akan/telah kedaluwarsa. */
router.get('/api/compliance/dashboard/ringkasan', 'compliance.view', () => {
  const items = all('SELECT * FROM compliance_item ORDER BY tanggal_kadaluarsa');
  const hariIni = today();
  const dengan = items.map((i) => {
    const sisa = i.tanggal_kadaluarsa ? diffDays(i.tanggal_kadaluarsa, hariIni) : null;
    let statusHitung = i.status;
    if (sisa !== null) {
      if (sisa < 0) statusHitung = 'kadaluarsa';
      else if (sisa <= 90) statusHitung = 'perlu_perhatian';
    }
    return { ...i, sisa_hari: sisa, status_terhitung: statusHitung };
  });
  return {
    total: dengan.length,
    patuh: dengan.filter((d) => d.status_terhitung === 'patuh').length,
    perlu_perhatian: dengan.filter((d) => d.status_terhitung === 'perlu_perhatian').length,
    kadaluarsa: dengan.filter((d) => d.status_terhitung === 'kadaluarsa').length,
    per_kategori: Object.entries(
      dengan.reduce((acc, d) => { acc[d.kategori] = (acc[d.kategori] || 0) + 1; return acc; }, {}),
    ).map(([kategori, jumlah]) => ({ kategori, jumlah })),
    segera_kadaluarsa: dengan.filter((d) => d.sisa_hari !== null && d.sisa_hari <= 90),
    data: dengan,
  };
});

// ------------------------- Internal Audit -------------------------

router.get('/api/audit/plan', 'audit.view', ({ query }) => ({
  data: all(
    `SELECT p.*, (SELECT COUNT(*) FROM audit_temuan WHERE plan_id = p.id) AS jumlah_temuan,
            (SELECT COUNT(*) FROM audit_temuan WHERE plan_id = p.id AND status = 'terbuka') AS temuan_terbuka
       FROM audit_plan p ${query.tahun ? 'WHERE p.tahun = ?' : ''} ORDER BY p.tahun DESC, p.id DESC`,
    query.tahun ? [Number(query.tahun)] : []),
}));

router.get('/api/audit/plan/:id', 'audit.view', ({ params }) => {
  const id = idParam(params);
  const p = get('SELECT * FROM audit_plan WHERE id = ?', [id]);
  if (!p) throw notFound('Rencana audit tidak ditemukan');
  return { ...p, temuan: all('SELECT * FROM audit_temuan WHERE plan_id = ? ORDER BY risk_rating DESC, id', [id]) };
});

router.post('/api/audit/plan', 'audit.create', ({ body, ctx }) => {
  const tahun = num(body, 'tahun', { min: 2000, max: 2200 });
  const judul = str(body, 'judul', { max: 200 });
  const nomor = nextNumber('AUD', today());
  const { lastInsertRowid: id } = run(
    `INSERT INTO audit_plan(nomor, judul, tahun, objek, auditor, tanggal_mulai, tanggal_selesai,
       ruang_lingkup, status) VALUES(?,?,?,?,?,?,?,?,?)`,
    [nomor, judul, tahun, body.objek || null, body.auditor || ctx?.user?.nama || null,
      body.tanggal_mulai || null, body.tanggal_selesai || null, body.ruang_lingkup || null,
      body.status || 'rencana'],
  );
  logAudit(ctx, { aksi: 'create', modul: 'audit', entitas_id: id,
    keterangan: `Rencana audit ${nomor}: ${judul}` });
  return get('SELECT * FROM audit_plan WHERE id = ?', [id]);
});

router.put('/api/audit/plan/:id', 'audit.update', ({ params, body, ctx }) => {
  const id = idParam(params);
  const before = get('SELECT * FROM audit_plan WHERE id = ?', [id]);
  if (!before) throw notFound('Rencana audit tidak ditemukan');
  const fields = ['judul', 'objek', 'auditor', 'tanggal_mulai', 'tanggal_selesai', 'ruang_lingkup', 'status'];
  const data = {};
  for (const f of fields) if (body[f] !== undefined) data[f] = body[f] === '' ? null : body[f];
  if (body.judul !== undefined) data.judul = str(body, 'judul', { max: 200 });
  if (body.tahun !== undefined) data.tahun = num(body, 'tahun', { min: 2000, max: 2200 });
  if (data.status !== undefined) data.status = oneOf(body, 'status', ['rencana', 'berjalan', 'selesai']);
  const cols = Object.keys(data);
  if (!cols.length) throw badRequest('Tidak ada perubahan yang dikirim');
  run(`UPDATE audit_plan SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
    [...cols.map((c) => data[c]), id]);
  logAudit(ctx, { aksi: 'update', modul: 'audit', entitas_id: id,
    keterangan: `Rencana audit ${before.nomor} diperbarui`, before, after: data });
  return get('SELECT * FROM audit_plan WHERE id = ?', [id]);
});

/** Hapus rencana audit; ditolak bila sudah ada temuan (jejak audit harus utuh). */
router.delete('/api/audit/plan/:id', 'audit.delete', ({ params, ctx }) => {
  const id = idParam(params);
  const before = get('SELECT * FROM audit_plan WHERE id = ?', [id]);
  if (!before) throw notFound('Rencana audit tidak ditemukan');
  const temuan = scalar('SELECT COUNT(*) FROM audit_temuan WHERE plan_id = ?', [id]);
  if (temuan) {
    throw conflict(`Rencana audit ${before.nomor} sudah memiliki ${temuan} temuan`,
      'Hapus atau pindahkan temuannya terlebih dahulu, atau ubah status rencana menjadi selesai.');
  }
  run('DELETE FROM audit_plan WHERE id = ?', [id]);
  logAudit(ctx, { aksi: 'delete', modul: 'audit', entitas_id: id,
    keterangan: `Rencana audit ${before.nomor}: ${before.judul} dihapus`, before });
  return { dihapus: true, id };
});

mountCrud(router, '/api/audit/temuan', 'audit', crud({
  table: 'audit_temuan', modul: 'audit',
  fields: ['plan_id', 'kode', 'judul', 'deskripsi', 'kriteria', 'sebab', 'akibat', 'rekomendasi',
    'risk_rating', 'capa', 'pic', 'batas_waktu', 'bukti', 'status'],
  required: ['judul'], search: ['judul', 'deskripsi', 'kode'], orderBy: 'id DESC',
  label: 'judul', filters: ['plan_id', 'risk_rating'],
}));

router.get('/api/audit/dashboard/ringkasan', 'audit.view', () => {
  const perRating = all(
    `SELECT risk_rating, COUNT(*) AS jumlah FROM audit_temuan GROUP BY risk_rating`);
  const perStatus = all('SELECT status, COUNT(*) AS jumlah FROM audit_temuan GROUP BY status');
  const jatuhTempo = all(
    `SELECT * FROM audit_temuan WHERE status IN ('terbuka','proses') AND batas_waktu IS NOT NULL
        AND batas_waktu <= date('now','+30 day') ORDER BY batas_waktu`);
  return {
    total_temuan: scalar('SELECT COUNT(*) FROM audit_temuan'),
    terbuka: scalar("SELECT COUNT(*) FROM audit_temuan WHERE status = 'terbuka'"),
    selesai: scalar("SELECT COUNT(*) FROM audit_temuan WHERE status = 'selesai'"),
    tingkat_penyelesaian: (() => {
      const t = scalar('SELECT COUNT(*) FROM audit_temuan');
      const s = scalar("SELECT COUNT(*) FROM audit_temuan WHERE status = 'selesai'");
      return t ? Number((s / t * 100).toFixed(1)) : 0;
    })(),
    per_rating: perRating, per_status: perStatus, capa_jatuh_tempo: jatuhTempo,
  };
});

// ------------------- Enterprise Risk Management -------------------

const risikoResource = crud({
  table: 'risiko', modul: 'risiko',
  fields: ['kode', 'nama', 'kategori', 'deskripsi', 'penyebab', 'dampak_deskripsi', 'unit_usaha_id',
    'likelihood', 'impact', 'kontrol', 'efektivitas_kontrol', 'likelihood_residu', 'impact_residu',
    'mitigasi', 'pic', 'kri_nama', 'kri_ambang', 'kri_nilai', 'status', 'review_terakhir'],
  required: ['kode', 'nama', 'kategori'], unique: ['kode'], search: ['kode', 'nama', 'deskripsi'],
  orderBy: 'skor_inheren DESC', filters: ['kategori'],
});

const hitungSkor = (id) => {
  const r = get('SELECT * FROM risiko WHERE id = ?', [id]);
  if (!r) return;
  run('UPDATE risiko SET skor_inheren = ?, skor_residu = ? WHERE id = ?',
    [r.likelihood * r.impact, r.likelihood_residu * r.impact_residu, id]);
};

const LEVEL = (skor) => (skor >= 20 ? 'ekstrem' : skor >= 12 ? 'tinggi' : skor >= 6 ? 'sedang' : 'rendah');

router.get('/api/risiko', 'risiko.view', ({ query }) => {
  const res = risikoResource.list(query);
  return {
    ...res,
    data: res.data.map((r) => ({
      ...r, level_inheren: LEVEL(r.skor_inheren), level_residu: LEVEL(r.skor_residu),
      kri_terlampaui: r.kri_ambang !== null && r.kri_nilai !== null && r.kri_nilai > r.kri_ambang,
    })),
  };
});

router.get('/api/risiko/matriks', 'risiko.view', () => {
  const rows = all("SELECT * FROM risiko WHERE status = 'aktif'");
  // Matriks 5x5: likelihood (baris) x impact (kolom)
  const matriks = Array.from({ length: 5 }, (_, l) =>
    Array.from({ length: 5 }, (_, i) => ({
      likelihood: 5 - l, impact: i + 1, skor: (5 - l) * (i + 1),
      level: LEVEL((5 - l) * (i + 1)),
      risiko: rows.filter((r) => r.likelihood === 5 - l && r.impact === i + 1)
        .map((r) => ({ id: r.id, kode: r.kode, nama: r.nama })),
    })));
  return {
    matriks,
    per_kategori: all(
      `SELECT kategori, COUNT(*) AS jumlah, AVG(skor_inheren) AS rata_skor
         FROM risiko WHERE status = 'aktif' GROUP BY kategori ORDER BY rata_skor DESC`),
    kri_terlampaui: rows.filter((r) => r.kri_ambang !== null && r.kri_nilai !== null && r.kri_nilai > r.kri_ambang)
      .map((r) => ({ kode: r.kode, nama: r.nama, kri: r.kri_nama, ambang: r.kri_ambang, nilai: r.kri_nilai })),
    ringkasan: {
      ekstrem: rows.filter((r) => LEVEL(r.skor_inheren) === 'ekstrem').length,
      tinggi: rows.filter((r) => LEVEL(r.skor_inheren) === 'tinggi').length,
      sedang: rows.filter((r) => LEVEL(r.skor_inheren) === 'sedang').length,
      rendah: rows.filter((r) => LEVEL(r.skor_inheren) === 'rendah').length,
    },
  };
});

router.get('/api/risiko/:id', 'risiko.view', ({ params }) => {
  const r = risikoResource.detail(idParam(params));
  return { ...r, level_inheren: LEVEL(r.skor_inheren), level_residu: LEVEL(r.skor_residu) };
});

router.post('/api/risiko', 'risiko.create', ({ body, ctx }) => {
  const r = risikoResource.create(body, ctx);
  hitungSkor(r.id);
  return get('SELECT * FROM risiko WHERE id = ?', [r.id]);
});

router.put('/api/risiko/:id', 'risiko.update', ({ params, body, ctx }) => {
  const id = idParam(params);
  risikoResource.update(id, body, ctx);
  hitungSkor(id);
  return get('SELECT * FROM risiko WHERE id = ?', [id]);
});

router.delete('/api/risiko/:id', 'risiko.delete', ({ params, ctx }) => risikoResource.remove(idParam(params), ctx));

// ---------------------------- CRM Anggota ----------------------------

router.get('/api/crm/tiket', 'crm.view', ({ query }) => {
  const w = [];
  const p = [];
  if (query.status) { w.push('t.status = ?'); p.push(query.status); }
  if (query.kategori) { w.push('t.kategori = ?'); p.push(query.kategori); }
  if (query.anggota_id) { w.push('t.anggota_id = ?'); p.push(Number(query.anggota_id)); }
  const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
  return {
    data: all(
      `SELECT t.*, a.nama AS anggota_nama, a.nomor_anggota,
              (SELECT COUNT(*) FROM tiket_balasan WHERE tiket_id = t.id) AS jumlah_balasan
         FROM tiket t LEFT JOIN anggota a ON a.id = t.anggota_id
         ${where} ORDER BY t.created_at DESC LIMIT 200`, p),
    ringkasan: {
      baru: scalar("SELECT COUNT(*) FROM tiket WHERE status = 'baru'"),
      diproses: scalar("SELECT COUNT(*) FROM tiket WHERE status = 'diproses'"),
      selesai: scalar("SELECT COUNT(*) FROM tiket WHERE status IN ('selesai','ditutup')"),
      rata_rating: scalar('SELECT COALESCE(AVG(rating),0) FROM tiket WHERE rating IS NOT NULL'),
    },
  };
});

router.get('/api/crm/tiket/:id', 'crm.view', ({ params }) => {
  const id = idParam(params);
  const t = get(
    `SELECT t.*, a.nama AS anggota_nama, a.nomor_anggota, a.telepon FROM tiket t
       LEFT JOIN anggota a ON a.id = t.anggota_id WHERE t.id = ?`, [id]);
  if (!t) throw notFound('Tiket tidak ditemukan');
  return { ...t, balasan: all('SELECT * FROM tiket_balasan WHERE tiket_id = ? ORDER BY created_at', [id]) };
});

router.post('/api/crm/tiket', 'crm.update', ({ body, ctx }) => {
  const judul = str(body, 'judul', { max: 200, label: 'Judul tiket' });
  const nomor = nextNumber('TKT', today());
  const { lastInsertRowid: id } = run(
    `INSERT INTO tiket(nomor, anggota_id, kategori, prioritas, judul, isi, kanal)
     VALUES(?,?,?,?,?,?,?)`,
    [nomor, body.anggota_id || ctx?.user?.anggota_id || null,
      oneOf(body, 'kategori', ['pengaduan', 'pertanyaan', 'saran', 'klaim'], { required: false, dflt: 'pertanyaan' }),
      oneOf(body, 'prioritas', ['rendah', 'normal', 'tinggi', 'urgent'], { required: false, dflt: 'normal' }),
      judul, body.isi || null,
      oneOf(body, 'kanal', ['aplikasi', 'whatsapp', 'telepon', 'email', 'langsung'], { required: false, dflt: 'aplikasi' })],
  );
  notify({ role: 'manajer_unit', judul: 'Tiket baru dari anggota', pesan: `${nomor} - ${judul}`,
    tipe: 'info', link: `#/crm/${id}` });
  logAudit(ctx, { aksi: 'create', modul: 'crm', entitas_id: id, keterangan: `Tiket ${nomor}: ${judul}` });
  return get('SELECT * FROM tiket WHERE id = ?', [id]);
});

router.post('/api/crm/tiket/:id/balas', 'crm.update', ({ params, body, ctx }) => {
  const id = idParam(params);
  const t = get('SELECT * FROM tiket WHERE id = ?', [id]);
  if (!t) throw notFound('Tiket tidak ditemukan');
  const isi = str(body, 'isi', { max: 3000, label: 'Isi balasan' });
  const isPetugas = ctx?.user?.role !== 'anggota' ? 1 : 0;
  run('INSERT INTO tiket_balasan(tiket_id, oleh, is_petugas, isi) VALUES(?,?,?,?)',
    [id, ctx?.user?.nama || 'anggota', isPetugas, isi]);
  if (t.status === 'baru' && isPetugas) {
    run("UPDATE tiket SET status = 'diproses', petugas = ? WHERE id = ?", [ctx.user.nama, id]);
  }
  logAudit(ctx, { aksi: 'create', modul: 'crm', entitas_id: id, keterangan: `Balasan pada tiket ${t.nomor}` });
  return { berhasil: true };
});

router.post('/api/crm/tiket/:id/tutup', 'crm.update', ({ params, body, ctx }) => {
  const id = idParam(params);
  const t = get('SELECT * FROM tiket WHERE id = ?', [id]);
  if (!t) throw notFound('Tiket tidak ditemukan');
  run(`UPDATE tiket SET status = 'selesai', selesai_at = datetime('now'), rating = ? WHERE id = ?`,
    [body.rating ? Number(body.rating) : null, id]);
  logAudit(ctx, { aksi: 'update', modul: 'crm', entitas_id: id, keterangan: `Tiket ${t.nomor} diselesaikan` });
  return get('SELECT * FROM tiket WHERE id = ?', [id]);
});

/** Broadcast ke anggota (aplikasi / WhatsApp / SMS / email). */
router.post('/api/crm/broadcast', 'crm.update', ({ body, ctx }) => {
  const judul = str(body, 'judul', { max: 200 });
  const pesan = str(body, 'pesan', { max: 2000 });
  const target = oneOf(body, 'target', ['semua', 'aktif', 'cabang', 'punya_pinjaman', 'kustom'],
    { required: false, dflt: 'aktif' });
  const sqlTarget = {
    semua: 'SELECT id FROM anggota',
    aktif: "SELECT id FROM anggota WHERE status = 'aktif'",
    cabang: "SELECT id FROM anggota WHERE status = 'aktif' AND cabang_id = ?",
    punya_pinjaman: `SELECT DISTINCT a.id FROM anggota a JOIN pinjaman p ON p.anggota_id = a.id
                       WHERE p.status IN ('dicairkan','restrukturisasi')`,
    kustom: "SELECT id FROM anggota WHERE status = 'aktif'",
  }[target];
  const penerima = all(sqlTarget, target === 'cabang' ? [Number(body.target_param)] : []);

  return tx(() => {
    const { lastInsertRowid: id } = run(
      `INSERT INTO broadcast(judul, pesan, kanal, target, target_param, jumlah_target, status, dikirim_pada)
       VALUES(?,?,?,?,?,?,'terkirim',datetime('now'))`,
      [judul, pesan, oneOf(body, 'kanal', ['aplikasi', 'whatsapp', 'sms', 'email'], { required: false, dflt: 'aplikasi' }),
        target, body.target_param || null, penerima.length],
    );
    // Kanal aplikasi langsung masuk ke pusat notifikasi pengguna anggota
    for (const a of penerima) {
      const u = get('SELECT id FROM users WHERE anggota_id = ?', [a.id]);
      if (u) notify({ user_id: u.id, judul, pesan, tipe: 'info' });
    }
    logAudit(ctx, { aksi: 'create', modul: 'crm', entitas_id: id,
      keterangan: `Broadcast "${judul}" ke ${penerima.length} anggota` });
    return { id, jumlah_target: penerima.length, status: 'terkirim' };
  });
});

router.get('/api/crm/broadcast', 'crm.view', () =>
  ({ data: all('SELECT * FROM broadcast ORDER BY created_at DESC LIMIT 100') }));

/** Survey kepuasan anggota & Net Promoter Score. */
router.post('/api/crm/survey', 'crm.update', ({ body, ctx }) => {
  const { lastInsertRowid: id } = run(
    `INSERT INTO survey_kepuasan(anggota_id, periode, skor_layanan, skor_produk, skor_petugas, nps, saran)
     VALUES(?,?,?,?,?,?,?)`,
    [body.anggota_id || ctx?.user?.anggota_id || null, body.periode || today().slice(0, 7),
      num(body, 'skor_layanan', { required: false, min: 1, max: 5 }) || null,
      num(body, 'skor_produk', { required: false, min: 1, max: 5 }) || null,
      num(body, 'skor_petugas', { required: false, min: 1, max: 5 }) || null,
      num(body, 'nps', { required: false, min: 0, max: 10 }) || null,
      body.saran || null],
  );
  return { id, berhasil: true, pesan: 'Terima kasih atas masukan Anda' };
});

router.get('/api/crm/survey/ringkasan', 'crm.view', () => {
  const rows = all('SELECT * FROM survey_kepuasan');
  const nps = rows.filter((r) => r.nps !== null);
  const promoter = nps.filter((r) => r.nps >= 9).length;
  const detractor = nps.filter((r) => r.nps <= 6).length;
  const avg = (k) => {
    const v = rows.filter((r) => r[k] !== null);
    return v.length ? Number((v.reduce((s, r) => s + r[k], 0) / v.length).toFixed(2)) : 0;
  };
  return {
    responden: rows.length,
    skor_layanan: avg('skor_layanan'), skor_produk: avg('skor_produk'), skor_petugas: avg('skor_petugas'),
    nps: nps.length ? Number(((promoter - detractor) / nps.length * 100).toFixed(1)) : 0,
    promoter, detractor, pasif: nps.length - promoter - detractor,
    saran_terbaru: all('SELECT saran, created_at FROM survey_kepuasan WHERE saran IS NOT NULL ORDER BY created_at DESC LIMIT 20'),
  };
});

export default router;
