/**
 * Modul 19 - Workflow Approval.
 *
 * Mendukung persetujuan berjenjang (sekuensial) maupun paralel, delegasi,
 * eskalasi berdasarkan batas waktu, dan tanda tangan elektronik (UU ITE).
 */
import { all, get, run, nextNumber, tx } from '../db.js';
import { badRequest, notFound, conflict, forbidden } from '../lib/http.js';
import { logAudit, notify } from '../lib/audit.js';
import { ROLES } from '../lib/rbac.js';
import { addDays, today } from '../lib/util.js';
import crypto from 'node:crypto';

/** Memilih alur persetujuan yang sesuai modul & nominal. */
export function pilihFlow(modul, nominal = 0) {
  return get(
    `SELECT * FROM approval_flow
      WHERE modul = ? AND status = 'aktif' AND batas_min <= ?
        AND (batas_max = 0 OR batas_max >= ?)
      ORDER BY batas_min DESC LIMIT 1`,
    [modul, nominal, nominal],
  );
}

/**
 * Membuat permintaan persetujuan.
 * @returns {{id:number, nomor:string, tahapan:Array}|null} null bila modul tidak memerlukan approval
 */
export function ajukan({ modul, entitas_id, judul, nominal = 0, ringkasan, pemohon_id }, ctx) {
  const flow = pilihFlow(modul, nominal);
  if (!flow) return null;
  let tahapan;
  try {
    tahapan = JSON.parse(flow.tahapan);
  } catch {
    throw badRequest(`Konfigurasi alur persetujuan "${flow.nama}" tidak valid`);
  }
  if (!Array.isArray(tahapan) || !tahapan.length) {
    throw badRequest(`Alur persetujuan "${flow.nama}" belum memiliki tahapan`);
  }
  const sudahAda = get(
    "SELECT id FROM approval_request WHERE modul = ? AND entitas_id = ? AND status = 'menunggu'",
    [modul, entitas_id],
  );
  if (sudahAda) throw conflict('Permintaan persetujuan untuk dokumen ini sudah diajukan');

  return tx(() => {
    const nomor = nextNumber('APR', today());
    const { lastInsertRowid: id } = run(
      `INSERT INTO approval_request(nomor, modul, entitas_id, judul, nominal, ringkasan, pemohon, pemohon_id)
       VALUES(?,?,?,?,?,?,?,?)`,
      [nomor, modul, entitas_id, judul, nominal, ringkasan || null,
        ctx?.user?.nama || 'sistem', pemohon_id ?? ctx?.user?.id ?? null],
    );
    tahapan.forEach((t, i) => {
      run(`INSERT INTO approval_step(request_id, urut, role, tipe, batas_waktu) VALUES(?,?,?,?,?)`,
        [id, t.urut ?? i + 1, t.role, t.tipe || 'berjenjang',
          addDays(today(), Number(t.sla_hari) || 3)]);
    });
    const pertama = tahapan.filter((t) => (t.urut ?? 1) === 1);
    for (const t of pertama) {
      notify({ role: t.role, judul: `Persetujuan diperlukan: ${judul}`,
        pesan: `${nomor} - ${ringkasan || modul}`, tipe: 'warning', link: `#/approval/${id}` });
    }
    logAudit(ctx, { aksi: 'create', modul: 'approval', entitas_id: id,
      keterangan: `Permintaan persetujuan ${nomor}: ${judul}`, after: { modul, entitas_id, nominal } });
    return { id, nomor, tahapan: all('SELECT * FROM approval_step WHERE request_id = ? ORDER BY urut', [id]) };
  });
}

/** Tanda tangan elektronik sederhana: hash dari identitas + keputusan + waktu. */
function tandaTangan(user, keputusan, requestId) {
  const payload = `${user.username}|${user.nama}|${keputusan}|${requestId}|${new Date().toISOString()}`;
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * Memproses keputusan pada satu tahap.
 * @param {'setuju'|'tolak'} keputusan
 */
export function putuskan(request_id, { keputusan, catatan }, ctx) {
  const req = get('SELECT * FROM approval_request WHERE id = ?', [request_id]);
  if (!req) throw notFound('Permintaan persetujuan tidak ditemukan');
  if (req.status !== 'menunggu') throw conflict(`Permintaan ini sudah ${req.status}`);
  const user = ctx?.user;
  if (!user) throw forbidden();

  const stepsAktif = all(
    "SELECT * FROM approval_step WHERE request_id = ? AND urut = ? AND status = 'menunggu'",
    [request_id, req.tahap_aktif],
  );
  const milikSaya = stepsAktif.find(
    (s) => s.role === user.role || s.delegasi_ke === user.username || user.role === 'super_admin');
  if (!milikSaya) {
    throw forbidden(`Tahap ${req.tahap_aktif} menunggu persetujuan dari: `
      + `${stepsAktif.map((s) => ROLES[s.role]?.nama || s.role).join(', ')}`);
  }

  return tx(() => {
    const ttd = tandaTangan(user, keputusan, request_id);
    run(`UPDATE approval_step SET status = ?, oleh = ?, catatan = ?, ttd_elektronik = ?,
           waktu = datetime('now') WHERE id = ?`,
    [keputusan === 'setuju' ? 'disetujui' : 'ditolak', user.username, catatan || null, ttd, milikSaya.id]);

    if (keputusan === 'tolak') {
      run("UPDATE approval_request SET status = 'ditolak', selesai_at = datetime('now') WHERE id = ?", [request_id]);
      run("UPDATE approval_step SET status = 'dilewati' WHERE request_id = ? AND status = 'menunggu'", [request_id]);
      if (req.pemohon_id) {
        notify({ user_id: req.pemohon_id, judul: `Permohonan ditolak: ${req.judul}`,
          pesan: catatan || 'Tanpa keterangan', tipe: 'danger', link: `#/approval/${request_id}` });
      }
      logAudit(ctx, { aksi: 'approve', modul: 'approval', entitas_id: request_id,
        keterangan: `${req.nomor} DITOLAK oleh ${user.username}: ${catatan || '-'}` });
      return { status: 'ditolak', request: get('SELECT * FROM approval_request WHERE id = ?', [request_id]) };
    }

    // Tahap paralel: seluruh penyetuju pada urut yang sama harus setuju
    const sisaTahap = all(
      "SELECT * FROM approval_step WHERE request_id = ? AND urut = ? AND status = 'menunggu'",
      [request_id, req.tahap_aktif]);
    if (sisaTahap.length > 0) {
      logAudit(ctx, { aksi: 'approve', modul: 'approval', entitas_id: request_id,
        keterangan: `${req.nomor} disetujui sebagian pada tahap ${req.tahap_aktif} oleh ${user.username}` });
      return { status: 'menunggu', menunggu: sisaTahap.map((s) => s.role) };
    }

    const berikutnya = get(
      "SELECT MIN(urut) AS urut FROM approval_step WHERE request_id = ? AND status = 'menunggu'",
      [request_id]);
    if (berikutnya?.urut) {
      run('UPDATE approval_request SET tahap_aktif = ? WHERE id = ?', [berikutnya.urut, request_id]);
      for (const s of all("SELECT DISTINCT role FROM approval_step WHERE request_id = ? AND urut = ?",
        [request_id, berikutnya.urut])) {
        notify({ role: s.role, judul: `Persetujuan diperlukan: ${req.judul}`,
          pesan: `${req.nomor} - tahap ${berikutnya.urut}`, tipe: 'warning', link: `#/approval/${request_id}` });
      }
      logAudit(ctx, { aksi: 'approve', modul: 'approval', entitas_id: request_id,
        keterangan: `${req.nomor} tahap ${req.tahap_aktif} disetujui ${user.username}, lanjut ke tahap ${berikutnya.urut}` });
      return { status: 'menunggu', tahap_aktif: berikutnya.urut };
    }

    run("UPDATE approval_request SET status = 'disetujui', selesai_at = datetime('now') WHERE id = ?", [request_id]);
    if (req.pemohon_id) {
      notify({ user_id: req.pemohon_id, judul: `Permohonan disetujui: ${req.judul}`,
        pesan: req.ringkasan || '', tipe: 'success', link: `#/approval/${request_id}` });
    }
    logAudit(ctx, { aksi: 'approve', modul: 'approval', entitas_id: request_id,
      keterangan: `${req.nomor} DISETUJUI seluruh tahap (terakhir oleh ${user.username})` });
    return { status: 'disetujui', request: get('SELECT * FROM approval_request WHERE id = ?', [request_id]) };
  });
}

/** Mendelegasikan tahap yang sedang menunggu ke pengguna lain. */
export function delegasikan(request_id, { ke_username, catatan }, ctx) {
  const req = get('SELECT * FROM approval_request WHERE id = ?', [request_id]);
  if (!req) throw notFound('Permintaan persetujuan tidak ditemukan');
  if (req.status !== 'menunggu') throw conflict('Hanya permintaan berstatus menunggu yang dapat didelegasikan');
  const tujuan = get("SELECT * FROM users WHERE username = ? AND status = 'aktif'", [ke_username]);
  if (!tujuan) throw notFound('Pengguna tujuan delegasi tidak ditemukan atau tidak aktif');

  const step = all("SELECT * FROM approval_step WHERE request_id = ? AND urut = ? AND status = 'menunggu'",
    [request_id, req.tahap_aktif])
    .find((s) => s.role === ctx?.user?.role || ctx?.user?.role === 'super_admin');
  if (!step) throw forbidden('Anda bukan penyetuju pada tahap yang sedang berjalan');

  run('UPDATE approval_step SET delegasi_ke = ?, catatan = ? WHERE id = ?',
    [ke_username, catatan || null, step.id]);
  notify({ user_id: tujuan.id, judul: `Delegasi persetujuan: ${req.judul}`,
    pesan: `${req.nomor} didelegasikan oleh ${ctx?.user?.nama}`, tipe: 'warning', link: `#/approval/${request_id}` });
  logAudit(ctx, { aksi: 'update', modul: 'approval', entitas_id: request_id,
    keterangan: `${req.nomor} didelegasikan ke ${ke_username}` });
  return get('SELECT * FROM approval_request WHERE id = ?', [request_id]);
}

/** Eskalasi otomatis untuk tahap yang melewati batas waktu (SLA). */
export function eskalasi(ctx) {
  const telat = all(
    `SELECT s.*, r.nomor, r.judul FROM approval_step s
       JOIN approval_request r ON r.id = s.request_id
      WHERE s.status = 'menunggu' AND r.status = 'menunggu'
        AND s.batas_waktu IS NOT NULL AND s.batas_waktu < ? AND s.urut = r.tahap_aktif`,
    [today()],
  );
  for (const t of telat) {
    notify({ role: 'pengurus', judul: 'Eskalasi persetujuan melewati batas waktu',
      pesan: `${t.nomor} - ${t.judul} (batas ${t.batas_waktu}, menunggu ${ROLES[t.role]?.nama || t.role})`,
      tipe: 'danger', link: `#/approval/${t.request_id}` });
  }
  if (telat.length) {
    logAudit(ctx, { aksi: 'update', modul: 'approval',
      keterangan: `Eskalasi otomatis atas ${telat.length} permintaan yang melewati SLA` });
  }
  return { dieskalasi: telat.length, daftar: telat };
}

/** Daftar permintaan yang menunggu keputusan seorang pengguna. */
export function menungguSaya(user) {
  if (user.role === 'super_admin') {
    return all(`SELECT * FROM approval_request WHERE status = 'menunggu' ORDER BY created_at`);
  }
  return all(
    `SELECT DISTINCT r.* FROM approval_request r
       JOIN approval_step s ON s.request_id = r.id AND s.urut = r.tahap_aktif
      WHERE r.status = 'menunggu' AND s.status = 'menunggu'
        AND (s.role = ? OR s.delegasi_ke = ?)
      ORDER BY r.created_at`,
    [user.role, user.username],
  );
}

/** Status persetujuan sebuah entitas (dipakai modul lain sebelum memproses). */
export function statusEntitas(modul, entitas_id) {
  const req = get(
    'SELECT * FROM approval_request WHERE modul = ? AND entitas_id = ? ORDER BY id DESC LIMIT 1',
    [modul, entitas_id]);
  if (!req) return { ada: false, status: null };
  return { ada: true, ...req, tahapan: all('SELECT * FROM approval_step WHERE request_id = ? ORDER BY urut', [req.id]) };
}
