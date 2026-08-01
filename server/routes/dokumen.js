/**
 * Modul 18 (Document Management System), Persuratan, dan 19 (Workflow Approval).
 */
import crypto from 'node:crypto';
import { createRouter, notFound, badRequest, conflict } from '../lib/http.js';
import { all, get, run, scalar } from '../db.js';
import { crud, mountCrud } from '../lib/crud.js';
import { logAudit } from '../lib/audit.js';
import { idParam, num, str, date, oneOf, today } from '../lib/util.js';
import * as approval from '../services/approval.js';
import { ROLES } from '../lib/rbac.js';

const router = createRouter();

const KATEGORI = ['ad_art', 'sop', 'kebijakan', 'notulen', 'kontrak', 'legalitas',
  'sertifikat', 'rat', 'surat', 'lainnya'];

// ---------------------------- Dokumen ----------------------------

router.get('/api/dokumen', 'dokumen.view', ({ query }) => {
  const w = [];
  const p = [];
  if (query.q) {
    w.push('(judul LIKE ? OR nomor LIKE ? OR tag LIKE ? OR isi_teks LIKE ?)');
    p.push(`%${query.q}%`, `%${query.q}%`, `%${query.q}%`, `%${query.q}%`);
  }
  if (query.kategori) { w.push('kategori = ?'); p.push(query.kategori); }
  if (query.status) { w.push('status = ?'); p.push(query.status); }
  const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
  return {
    data: all(
      `SELECT id, nomor, judul, kategori, deskripsi, versi, file_nama, file_mime, file_ukuran,
              hash_sha256, tag, retensi_tahun, tanggal_kadaluarsa, ttd_oleh, ttd_pada, status,
              pemilik, created_at
         FROM dokumen ${where} ORDER BY created_at DESC LIMIT 200`, p),
    total: scalar(`SELECT COUNT(*) FROM dokumen ${where}`, p),
    kategori_tersedia: KATEGORI,
  };
});

router.get('/api/dokumen/:id', 'dokumen.view', ({ params }) => {
  const id = idParam(params);
  const d = get('SELECT * FROM dokumen WHERE id = ?', [id]);
  if (!d) throw notFound('Dokumen tidak ditemukan');
  return { ...d, versi_riwayat: all('SELECT * FROM dokumen_versi WHERE dokumen_id = ? ORDER BY versi DESC', [id]) };
});

/**
 * Unggah dokumen. Berkas dikirim sebagai data URI base64 pada kolom "file_data".
 * Hash SHA-256 disimpan sebagai bukti integritas (UU ITE Pasal 5-6).
 */
router.post('/api/dokumen', 'dokumen.create', ({ body, ctx }) => {
  const judul = str(body, 'judul', { max: 200, label: 'Judul dokumen' });
  const kategori = oneOf(body, 'kategori', KATEGORI, { label: 'Kategori dokumen' });
  let hash = null;
  let ukuran = null;
  let isi = body.isi_teks || null;
  if (body.file_data) {
    const base64 = String(body.file_data).split(',').pop();
    const buf = Buffer.from(base64, 'base64');
    if (buf.length > 8 * 1024 * 1024) throw badRequest('Ukuran berkas maksimal 8 MB');
    hash = crypto.createHash('sha256').update(buf).digest('hex');
    ukuran = buf.length;
    // "OCR" sederhana: berkas teks langsung diindeks untuk pencarian
    if ((body.file_mime || '').startsWith('text/') && !isi) isi = buf.toString('utf8').slice(0, 20_000);
  }
  const { lastInsertRowid: id } = run(
    `INSERT INTO dokumen(nomor, judul, kategori, deskripsi, file_nama, file_mime, file_ukuran,
       file_path, hash_sha256, tag, isi_teks, retensi_tahun, tanggal_kadaluarsa, status, pemilik)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [body.nomor || null, judul, kategori, body.deskripsi || null, body.file_nama || null,
      body.file_mime || null, ukuran, body.file_data || null, hash, body.tag || null, isi,
      Number(body.retensi_tahun) || 10, body.tanggal_kadaluarsa || null,
      body.status || 'draft', ctx?.user?.username || 'sistem'],
  );
  run(`INSERT INTO dokumen_versi(dokumen_id, versi, file_path, hash_sha256, catatan, oleh)
       VALUES(?,1,?,?,?,?)`,
  [id, body.file_data || null, hash, 'Versi awal', ctx?.user?.username || 'sistem']);
  logAudit(ctx, { aksi: 'create', modul: 'dokumen', entitas_id: id,
    keterangan: `Dokumen "${judul}" (${kategori}) diunggah, hash ${hash?.slice(0, 16) || '-'}` });
  return get('SELECT id, judul, kategori, versi, hash_sha256, status FROM dokumen WHERE id = ?', [id]);
});

/** Unggah versi baru (versioning). */
router.post('/api/dokumen/:id/versi', 'dokumen.update', ({ params, body, ctx }) => {
  const id = idParam(params);
  const d = get('SELECT * FROM dokumen WHERE id = ?', [id]);
  if (!d) throw notFound('Dokumen tidak ditemukan');
  if (!body.file_data) throw badRequest('Berkas versi baru wajib dilampirkan');
  const buf = Buffer.from(String(body.file_data).split(',').pop(), 'base64');
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  if (hash === d.hash_sha256) throw conflict('Berkas identik dengan versi terakhir');
  const versiBaru = d.versi + 1;
  run(`UPDATE dokumen SET versi = ?, file_path = ?, hash_sha256 = ?, file_ukuran = ?,
         file_nama = COALESCE(?, file_nama), status = 'review' WHERE id = ?`,
  [versiBaru, body.file_data, hash, buf.length, body.file_nama || null, id]);
  run(`INSERT INTO dokumen_versi(dokumen_id, versi, file_path, hash_sha256, catatan, oleh)
       VALUES(?,?,?,?,?,?)`,
  [id, versiBaru, body.file_data, hash, body.catatan || null, ctx?.user?.username || 'sistem']);
  logAudit(ctx, { aksi: 'update', modul: 'dokumen', entitas_id: id,
    keterangan: `Dokumen "${d.judul}" diperbarui ke versi ${versiBaru}`,
    before: { versi: d.versi, hash: d.hash_sha256 }, after: { versi: versiBaru, hash } });
  return { id, versi: versiBaru, hash_sha256: hash };
});

/** Tanda tangan elektronik dokumen (UU ITE No. 11/2008 jo. UU No. 19/2016). */
router.post('/api/dokumen/:id/tandatangani', 'dokumen.update', ({ params, ctx }) => {
  const id = idParam(params);
  const d = get('SELECT * FROM dokumen WHERE id = ?', [id]);
  if (!d) throw notFound('Dokumen tidak ditemukan');
  if (d.ttd_elektronik) throw conflict(`Dokumen ini sudah ditandatangani oleh ${d.ttd_oleh}`);
  const waktu = new Date().toISOString();
  const ttd = crypto.createHash('sha256')
    .update(`${d.hash_sha256 || d.judul}|${ctx.user.username}|${ctx.user.nama}|${waktu}`).digest('hex');
  run(`UPDATE dokumen SET ttd_elektronik = ?, ttd_oleh = ?, ttd_pada = ?, status = 'disetujui' WHERE id = ?`,
    [ttd, `${ctx.user.nama} (${ctx.user.username})`, waktu, id]);
  logAudit(ctx, { aksi: 'approve', modul: 'dokumen', entitas_id: id,
    keterangan: `Dokumen "${d.judul}" ditandatangani secara elektronik oleh ${ctx.user.nama}` });
  return { id, ttd_elektronik: ttd, ttd_oleh: ctx.user.nama, ttd_pada: waktu };
});

/** Verifikasi integritas berkas terhadap hash tersimpan. */
router.get('/api/dokumen/:id/verifikasi', 'dokumen.view', ({ params }) => {
  const id = idParam(params);
  const d = get('SELECT * FROM dokumen WHERE id = ?', [id]);
  if (!d) throw notFound('Dokumen tidak ditemukan');
  if (!d.file_path || !d.hash_sha256) return { valid: null, pesan: 'Dokumen tidak memiliki berkas terlampir' };
  const buf = Buffer.from(String(d.file_path).split(',').pop(), 'base64');
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  return {
    valid: hash === d.hash_sha256,
    hash_tersimpan: d.hash_sha256, hash_dihitung: hash,
    pesan: hash === d.hash_sha256
      ? 'Berkas utuh dan tidak mengalami perubahan sejak diunggah.'
      : 'PERINGATAN: berkas berbeda dengan yang tercatat pada sistem.',
  };
});

/** Dokumen yang akan kedaluwarsa / melewati masa retensi. */
router.get('/api/dokumen/laporan/retensi', 'dokumen.view', () => ({
  akan_kadaluarsa: all(
    `SELECT id, judul, kategori, tanggal_kadaluarsa FROM dokumen
      WHERE tanggal_kadaluarsa IS NOT NULL AND tanggal_kadaluarsa <= date('now','+90 day')
      ORDER BY tanggal_kadaluarsa`),
  melewati_retensi: all(
    `SELECT id, judul, kategori, created_at, retensi_tahun FROM dokumen
      WHERE date(created_at, '+' || retensi_tahun || ' years') < date('now') ORDER BY created_at`),
}));

// ---------------------------- Persuratan ----------------------------

mountCrud(router, '/api/surat', 'surat', crud({
  table: 'surat', modul: 'surat',
  fields: ['nomor', 'jenis', 'tanggal', 'perihal', 'dari', 'kepada', 'sifat', 'isi', 'lampiran',
    'disposisi', 'disposisi_kepada', 'dokumen_id', 'status'],
  required: ['nomor', 'jenis', 'tanggal', 'perihal'],
  search: ['nomor', 'perihal', 'dari', 'kepada'], orderBy: 'tanggal DESC', label: 'perihal',
  filters: ['jenis', 'sifat'],
}));

router.post('/api/surat/:id/disposisi', 'surat.update', ({ params, body, ctx }) => {
  const id = idParam(params);
  const s = get('SELECT * FROM surat WHERE id = ?', [id]);
  if (!s) throw notFound('Surat tidak ditemukan');
  const kepada = str(body, 'disposisi_kepada', { max: 150, label: 'Tujuan disposisi' });
  const isi = str(body, 'disposisi', { max: 1000, label: 'Isi disposisi' });
  run("UPDATE surat SET disposisi = ?, disposisi_kepada = ?, status = 'diproses' WHERE id = ?",
    [isi, kepada, id]);
  logAudit(ctx, { aksi: 'update', modul: 'surat', entitas_id: id,
    keterangan: `Disposisi surat ${s.nomor} kepada ${kepada}` });
  return get('SELECT * FROM surat WHERE id = ?', [id]);
});

// ------------------------- Workflow Approval -------------------------

router.get('/api/approval', 'approval.view', ({ query, ctx }) => {
  if (query.saya === '1') return { data: approval.menungguSaya(ctx.user) };
  const w = [];
  const p = [];
  if (query.status) { w.push('status = ?'); p.push(query.status); }
  if (query.modul) { w.push('modul = ?'); p.push(query.modul); }
  const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
  return {
    data: all(`SELECT * FROM approval_request ${where} ORDER BY created_at DESC LIMIT 200`, p),
    menunggu_saya: approval.menungguSaya(ctx.user).length,
  };
});

router.get('/api/approval/:id', 'approval.view', ({ params }) => {
  const id = idParam(params);
  const r = get('SELECT * FROM approval_request WHERE id = ?', [id]);
  if (!r) throw notFound('Permintaan persetujuan tidak ditemukan');
  return {
    ...r,
    tahapan: all('SELECT * FROM approval_step WHERE request_id = ? ORDER BY urut, id', [id])
      .map((s) => ({ ...s, role_nama: ROLES[s.role]?.nama || s.role })),
  };
});

router.post('/api/approval/:id/putuskan', 'approval.view', ({ params, body, ctx }) =>
  approval.putuskan(idParam(params), {
    keputusan: oneOf(body, 'keputusan', ['setuju', 'tolak'], { label: 'Keputusan' }),
    catatan: str(body, 'catatan', { required: false, max: 500 }),
  }, ctx));

router.post('/api/approval/:id/delegasi', 'approval.view', ({ params, body, ctx }) =>
  approval.delegasikan(idParam(params), {
    ke_username: str(body, 'ke_username', { max: 50, label: 'Pengguna tujuan' }),
    catatan: str(body, 'catatan', { required: false, max: 300 }),
  }, ctx));

router.post('/api/approval/eskalasi', 'approval.view', ({ ctx }) => approval.eskalasi(ctx));

/** Konfigurasi alur persetujuan. */
mountCrud(router, '/api/approval-flow', 'approval', crud({
  table: 'approval_flow', modul: 'approval',
  fields: ['modul', 'nama', 'batas_min', 'batas_max', 'tahapan', 'status'],
  required: ['modul', 'nama', 'tahapan'], search: ['modul', 'nama'], orderBy: 'modul ASC',
  filters: ['modul'],
}), { readPerm: 'approval.view', writePerm: 'admin.update' });

export default router;
