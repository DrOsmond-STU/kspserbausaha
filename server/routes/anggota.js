/**
 * Modul 3 - Manajemen Keanggotaan (UU 25/1992).
 *
 * Siklus status: calon → aktif → nonaktif → keluar / meninggal.
 */
import { createRouter, badRequest, notFound, conflict } from '../lib/http.js';
import { all, get, run, scalar, tx, nextNumber } from '../db.js';
import { logAudit } from '../lib/audit.js';
import { str, num, oneOf, date, idParam, today } from '../lib/util.js';
import { ringkasanAnggota, tutupRekening } from '../services/savings.js';
import { riwayatAnggota as riwayatShu } from '../services/shu.js';

const router = createRouter();

const STATUS = ['calon', 'aktif', 'nonaktif', 'keluar', 'meninggal', 'ditolak'];

router.get('/api/anggota', 'anggota.view', ({ query }) => {
  const w = [];
  const p = [];
  if (query.q) {
    w.push('(a.nama LIKE ? OR a.nomor_anggota LIKE ? OR a.nik LIKE ? OR a.telepon LIKE ?)');
    p.push(`%${query.q}%`, `%${query.q}%`, `%${query.q}%`, `%${query.q}%`);
  }
  if (query.status) { w.push('a.status = ?'); p.push(query.status); }
  if (query.cabang_id) { w.push('a.cabang_id = ?'); p.push(Number(query.cabang_id)); }
  const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
  const limit = Math.min(Number(query.limit) || 50, 500);
  const offset = Math.max(Number(query.offset) || 0, 0);
  const data = all(
    `SELECT a.*, c.nama AS cabang_nama,
            (SELECT COALESCE(SUM(saldo),0) FROM rekening_simpanan WHERE anggota_id = a.id AND status <> 'tutup') AS total_simpanan,
            (SELECT COALESCE(SUM(outstanding_pokok),0) FROM pinjaman WHERE anggota_id = a.id AND status IN ('dicairkan','restrukturisasi')) AS outstanding_pinjaman
       FROM anggota a LEFT JOIN cabang c ON c.id = a.cabang_id
       ${where} ORDER BY a.nomor_anggota LIMIT ? OFFSET ?`, [...p, limit, offset]);
  return { data, total: scalar(`SELECT COUNT(*) FROM anggota a ${where}`, p), limit, offset };
});

router.get('/api/anggota/statistik', 'anggota.view', () => {
  const perStatus = all('SELECT status, COUNT(*) AS jumlah FROM anggota GROUP BY status');
  const perGender = all("SELECT jenis_kelamin, COUNT(*) AS jumlah FROM anggota WHERE status = 'aktif' GROUP BY jenis_kelamin");
  const perCabang = all(
    `SELECT c.nama AS cabang, COUNT(a.id) AS jumlah FROM cabang c
       LEFT JOIN anggota a ON a.cabang_id = c.id AND a.status = 'aktif'
      GROUP BY c.id ORDER BY jumlah DESC`);
  const pertumbuhan = all(
    `SELECT substr(tanggal_gabung,1,7) AS periode, COUNT(*) AS jumlah FROM anggota
      WHERE tanggal_gabung IS NOT NULL GROUP BY periode ORDER BY periode DESC LIMIT 12`).reverse();
  return {
    total: scalar('SELECT COUNT(*) FROM anggota'),
    aktif: scalar("SELECT COUNT(*) FROM anggota WHERE status = 'aktif'"),
    calon: scalar("SELECT COUNT(*) FROM anggota WHERE status = 'calon'"),
    keluar: scalar("SELECT COUNT(*) FROM anggota WHERE status IN ('keluar','meninggal')"),
    per_status: perStatus, per_gender: perGender, per_cabang: perCabang, pertumbuhan,
  };
});

router.get('/api/anggota/:id', 'anggota.view', ({ params }) => {
  const id = idParam(params);
  const a = get(
    `SELECT a.*, c.nama AS cabang_nama FROM anggota a LEFT JOIN cabang c ON c.id = a.cabang_id WHERE a.id = ?`,
    [id]);
  if (!a) throw notFound('Anggota tidak ditemukan');
  return {
    ...a,
    ahli_waris: all('SELECT * FROM anggota_ahli_waris WHERE anggota_id = ?', [id]),
    riwayat: all('SELECT * FROM anggota_riwayat WHERE anggota_id = ? ORDER BY created_at DESC', [id]),
    simpanan: ringkasanAnggota(id),
    pinjaman: all(
      `SELECT p.*, pr.nama AS produk_nama FROM pinjaman p
         JOIN produk_pinjaman pr ON pr.id = p.produk_id
        WHERE p.anggota_id = ? ORDER BY p.tanggal_pengajuan DESC`, [id]),
    shu: riwayatShu(id),
    poin_loyalty: scalar('SELECT COALESCE(SUM(poin),0) FROM loyalty_poin WHERE anggota_id = ?', [id]),
  };
});

const FIELDS = ['nik', 'no_kk', 'npwp', 'nama', 'jenis_kelamin', 'tempat_lahir', 'tanggal_lahir',
  'alamat', 'kelurahan', 'kecamatan', 'kota', 'provinsi', 'kode_pos', 'telepon', 'email',
  'pekerjaan', 'nama_instansi', 'penghasilan', 'pendidikan', 'foto', 'tanda_tangan',
  'cabang_id', 'jenis_anggota'];

/** Pendaftaran calon anggota. */
router.post('/api/anggota', 'anggota.create', ({ body, ctx }) => {
  const nik = str(body, 'nik', { max: 20, min: 16, label: 'NIK' });
  if (!/^\d{16}$/.test(nik)) throw badRequest('NIK harus terdiri dari 16 digit angka');
  if (get('SELECT id FROM anggota WHERE nik = ?', [nik])) {
    throw conflict(`NIK ${nik} sudah terdaftar sebagai anggota`);
  }
  const nama = str(body, 'nama', { max: 120, label: 'Nama lengkap' });
  const tanggal = date(body, 'tanggal_daftar', { required: false, dflt: today() });

  return tx(() => {
    const nomor = body.nomor_anggota
      || nextNumber('AGT', tanggal).replace(/\//g, '').replace('AGT', 'A');
    if (get('SELECT id FROM anggota WHERE nomor_anggota = ?', [nomor])) {
      throw conflict(`Nomor anggota ${nomor} sudah digunakan`);
    }
    const data = {};
    for (const f of FIELDS) if (body[f] !== undefined && body[f] !== '') data[f] = body[f];
    data.nik = nik;
    data.nama = nama;
    data.nomor_anggota = nomor;
    data.tanggal_daftar = tanggal;
    data.status = 'calon';
    const cols = Object.keys(data);
    const { lastInsertRowid: id } = run(
      `INSERT INTO anggota(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`,
      cols.map((c) => data[c]));

    for (const w of body.ahli_waris || []) {
      run(`INSERT INTO anggota_ahli_waris(anggota_id, nama, nik, hubungan, telepon, alamat, persentase)
           VALUES(?,?,?,?,?,?,?)`,
      [id, w.nama, w.nik || null, w.hubungan || null, w.telepon || null, w.alamat || null,
        Number(w.persentase) || 100]);
    }
    run(`INSERT INTO anggota_riwayat(anggota_id, jenis, keterangan, status_baru, oleh)
         VALUES(?,'status','Pendaftaran calon anggota','calon',?)`,
    [id, ctx?.user?.username || 'sistem']);
    logAudit(ctx, { aksi: 'create', modul: 'anggota', entitas_id: id,
      keterangan: `Pendaftaran calon anggota ${nomor} - ${nama}`, after: { nomor, nama, nik } });
    return get('SELECT * FROM anggota WHERE id = ?', [id]);
  });
});

router.put('/api/anggota/:id', 'anggota.update', ({ params, body, ctx }) => {
  const id = idParam(params);
  const before = get('SELECT * FROM anggota WHERE id = ?', [id]);
  if (!before) throw notFound('Anggota tidak ditemukan');
  if (['keluar', 'meninggal'].includes(before.status)) {
    throw conflict(`Data anggota berstatus "${before.status}" tidak dapat diubah`);
  }
  const data = {};
  for (const f of FIELDS) if (body[f] !== undefined) data[f] = body[f] === '' ? null : body[f];
  const cols = Object.keys(data);
  if (!cols.length) throw badRequest('Tidak ada perubahan yang dikirim');
  if (data.nik && data.nik !== before.nik && get('SELECT id FROM anggota WHERE nik = ? AND id <> ?', [data.nik, id])) {
    throw conflict(`NIK ${data.nik} sudah terdaftar pada anggota lain`);
  }
  run(`UPDATE anggota SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`,
    [...cols.map((c) => data[c]), id]);
  const after = get('SELECT * FROM anggota WHERE id = ?', [id]);
  logAudit(ctx, { aksi: 'update', modul: 'anggota', entitas_id: id,
    keterangan: `Data anggota ${before.nomor_anggota} diperbarui`, before, after });
  return after;
});

/**
 * Verifikasi & persetujuan calon anggota menjadi anggota penuh.
 * Simpanan pokok wajib disetor pada tahap ini (UU 25/1992 Pasal 41).
 */
router.post('/api/anggota/:id/setujui', 'anggota.approve', ({ params, body, ctx }) => {
  const id = idParam(params);
  const a = get('SELECT * FROM anggota WHERE id = ?', [id]);
  if (!a) throw notFound('Anggota tidak ditemukan');
  if (a.status !== 'calon') throw conflict(`Hanya calon anggota yang dapat disetujui (status saat ini: ${a.status})`);
  const tanggal = date(body, 'tanggal_gabung', { required: false, dflt: today() });

  return tx(() => {
    run(`UPDATE anggota SET status = 'aktif', tanggal_gabung = ?, updated_at = datetime('now') WHERE id = ?`,
      [tanggal, id]);
    run(`INSERT INTO anggota_riwayat(anggota_id, jenis, keterangan, status_lama, status_baru, oleh)
         VALUES(?,'status','Disetujui menjadi anggota','calon','aktif',?)`,
    [id, ctx?.user?.username || 'sistem']);
    logAudit(ctx, { aksi: 'approve', modul: 'anggota', entitas_id: id,
      keterangan: `Calon anggota ${a.nomor_anggota} - ${a.nama} disetujui menjadi anggota`,
      before: { status: 'calon' }, after: { status: 'aktif', tanggal_gabung: tanggal } });
    return get('SELECT * FROM anggota WHERE id = ?', [id]);
  });
});

router.post('/api/anggota/:id/tolak', 'anggota.approve', ({ params, body, ctx }) => {
  const id = idParam(params);
  const a = get('SELECT * FROM anggota WHERE id = ?', [id]);
  if (!a) throw notFound('Anggota tidak ditemukan');
  if (a.status !== 'calon') throw conflict('Hanya calon anggota yang dapat ditolak');
  const alasan = str(body, 'alasan', { max: 500, label: 'Alasan penolakan' });
  run("UPDATE anggota SET status = 'ditolak', alasan_keluar = ? WHERE id = ?", [alasan, id]);
  run(`INSERT INTO anggota_riwayat(anggota_id, jenis, keterangan, status_lama, status_baru, oleh)
       VALUES(?,'status',?,'calon','ditolak',?)`, [id, alasan, ctx?.user?.username || 'sistem']);
  logAudit(ctx, { aksi: 'approve', modul: 'anggota', entitas_id: id,
    keterangan: `Calon anggota ${a.nomor_anggota} DITOLAK: ${alasan}` });
  return get('SELECT * FROM anggota WHERE id = ?', [id]);
});

/**
 * Pengunduran diri / pemberhentian anggota.
 * Simpanan pokok & wajib dikembalikan setelah seluruh kewajiban lunas.
 */
router.post('/api/anggota/:id/keluar', 'anggota.update', ({ params, body, ctx }) => {
  const id = idParam(params);
  const a = get('SELECT * FROM anggota WHERE id = ?', [id]);
  if (!a) throw notFound('Anggota tidak ditemukan');
  if (['keluar', 'meninggal'].includes(a.status)) throw conflict('Anggota ini sudah keluar');
  const alasan = oneOf(body, 'alasan_keluar', ['mengundurkan_diri', 'meninggal', 'diberhentikan'],
    { label: 'Alasan keluar' });
  const tanggal = date(body, 'tanggal_keluar', { required: false, dflt: today() });

  const pinjamanAktif = get(
    `SELECT COUNT(*) AS jml, COALESCE(SUM(outstanding_pokok),0) AS sisa FROM pinjaman
      WHERE anggota_id = ? AND status IN ('dicairkan','restrukturisasi')`, [id]);
  if (pinjamanAktif.jml > 0) {
    throw conflict('Anggota masih memiliki pinjaman berjalan',
      `${pinjamanAktif.jml} pinjaman dengan sisa pokok Rp ${pinjamanAktif.sisa.toLocaleString('id-ID')}. `
      + 'Lunasi atau kompensasikan dengan simpanan terlebih dahulu.');
  }
  const saldo = scalar(
    "SELECT COALESCE(SUM(saldo),0) FROM rekening_simpanan WHERE anggota_id = ? AND status <> 'tutup'", [id]);
  // Bawaan: seluruh simpanan (termasuk pokok & wajib) langsung dikembalikan
  // dan dijurnal otomatis. Kirim kembalikan_simpanan=false bila pengembalian
  // akan dilakukan kemudian lewat menu Simpanan → Tutup Rekening.
  const kembalikan = body.kembalikan_simpanan !== false && body.kembalikan_simpanan !== 0
    && body.kembalikan_simpanan !== '0';
  const metode = oneOf(body, 'metode', ['tunai', 'transfer'], { required: false, dflt: 'tunai' });

  return tx(() => {
    const statusBaru = alasan === 'meninggal' ? 'meninggal' : 'keluar';
    run(`UPDATE anggota SET status = ?, tanggal_keluar = ?, alasan_keluar = ?,
           updated_at = datetime('now') WHERE id = ?`, [statusBaru, tanggal, alasan, id]);
    const pengembalian = [];
    if (kembalikan) {
      const rekening = all("SELECT id FROM rekening_simpanan WHERE anggota_id = ? AND status <> 'tutup'", [id]);
      for (const r of rekening) {
        run("UPDATE rekening_simpanan SET saldo_blokir = 0 WHERE id = ?", [r.id]);
        pengembalian.push(tutupRekening(r.id, {
          tanggal, metode, bank_account_id: body.bank_account_id ? Number(body.bank_account_id) : null,
          keterangan: `Pengembalian simpanan - anggota ${statusBaru}`,
        }, ctx));
      }
    }
    run(`INSERT INTO anggota_riwayat(anggota_id, jenis, keterangan, status_lama, status_baru, oleh)
         VALUES(?,'status',?,?,?,?)`,
    [id, body.keterangan || `Keluar: ${alasan}`, a.status, statusBaru, ctx?.user?.username || 'sistem']);
    logAudit(ctx, { aksi: 'update', modul: 'anggota', entitas_id: id,
      keterangan: `Anggota ${a.nomor_anggota} - ${a.nama} keluar (${alasan}). `
        + `Saldo simpanan yang harus dikembalikan Rp ${saldo.toLocaleString('id-ID')}`,
      before: { status: a.status }, after: { status: statusBaru, tanggal_keluar: tanggal } });
    return {
      ...get('SELECT * FROM anggota WHERE id = ?', [id]),
      saldo_simpanan_dikembalikan: saldo,
      pengembalian,
      catatan: saldo <= 0 ? 'Tidak ada saldo simpanan yang perlu dikembalikan.'
        : kembalikan ? `Simpanan Rp ${saldo.toLocaleString('id-ID')} dikembalikan dan dijurnal otomatis.`
          : 'Kembalikan simpanan melalui menu Simpanan → Tutup Rekening.',
    };
  });
});

router.post('/api/anggota/:id/nonaktif', 'anggota.update', ({ params, body, ctx }) => {
  const id = idParam(params);
  const a = get('SELECT * FROM anggota WHERE id = ?', [id]);
  if (!a) throw notFound('Anggota tidak ditemukan');
  const aktifkan = body.aktifkan === true || body.aktifkan === 1;
  if (!aktifkan && a.status !== 'aktif') throw conflict('Hanya anggota aktif yang dapat dinonaktifkan');
  if (aktifkan && a.status !== 'nonaktif') throw conflict('Hanya anggota nonaktif yang dapat diaktifkan kembali');
  const baru = aktifkan ? 'aktif' : 'nonaktif';
  run('UPDATE anggota SET status = ? WHERE id = ?', [baru, id]);
  run(`INSERT INTO anggota_riwayat(anggota_id, jenis, keterangan, status_lama, status_baru, oleh)
       VALUES(?,'status',?,?,?,?)`,
  [id, body.alasan || null, a.status, baru, ctx?.user?.username || 'sistem']);
  logAudit(ctx, { aksi: 'update', modul: 'anggota', entitas_id: id,
    keterangan: `Anggota ${a.nomor_anggota} diubah menjadi ${baru}` });
  return get('SELECT * FROM anggota WHERE id = ?', [id]);
});

// ---------------------------- Ahli waris ----------------------------

router.post('/api/anggota/:id/ahli-waris', 'anggota.update', ({ params, body, ctx }) => {
  const id = idParam(params);
  if (!get('SELECT id FROM anggota WHERE id = ?', [id])) throw notFound('Anggota tidak ditemukan');
  const nama = str(body, 'nama', { max: 120, label: 'Nama ahli waris' });
  const persen = num(body, 'persentase', { required: false, min: 0, max: 100, integer: false }) || 100;
  const totalLain = scalar('SELECT COALESCE(SUM(persentase),0) FROM anggota_ahli_waris WHERE anggota_id = ?', [id]);
  if (totalLain + persen > 100) {
    throw badRequest(`Total persentase ahli waris melebihi 100% (saat ini ${totalLain}%)`);
  }
  const { lastInsertRowid } = run(
    `INSERT INTO anggota_ahli_waris(anggota_id, nama, nik, hubungan, telepon, alamat, persentase)
     VALUES(?,?,?,?,?,?,?)`,
    [id, nama, body.nik || null, body.hubungan || null, body.telepon || null, body.alamat || null, persen]);
  logAudit(ctx, { aksi: 'create', modul: 'anggota', entitas_id: id,
    keterangan: `Ahli waris "${nama}" ditambahkan` });
  return get('SELECT * FROM anggota_ahli_waris WHERE id = ?', [lastInsertRowid]);
});

router.put('/api/anggota/ahli-waris/:id', 'anggota.update', ({ params, body, ctx }) => {
  const id = idParam(params);
  const before = get('SELECT * FROM anggota_ahli_waris WHERE id = ?', [id]);
  if (!before) throw notFound('Ahli waris tidak ditemukan');
  const nama = str(body, 'nama', { max: 120, label: 'Nama ahli waris' });
  const persen = num(body, 'persentase', { required: false, min: 0, max: 100, integer: false }) || 100;
  // Total dihitung tanpa baris yang sedang diubah
  const totalLain = scalar(
    'SELECT COALESCE(SUM(persentase),0) FROM anggota_ahli_waris WHERE anggota_id = ? AND id <> ?',
    [before.anggota_id, id]);
  if (totalLain + persen > 100) {
    throw badRequest(`Total persentase ahli waris melebihi 100% (ahli waris lain ${totalLain}%)`);
  }
  run(`UPDATE anggota_ahli_waris SET nama = ?, nik = ?, hubungan = ?, telepon = ?, alamat = ?, persentase = ?
        WHERE id = ?`,
  [nama, body.nik || null, body.hubungan || null, body.telepon || null, body.alamat || null, persen, id]);
  const after = get('SELECT * FROM anggota_ahli_waris WHERE id = ?', [id]);
  logAudit(ctx, { aksi: 'update', modul: 'anggota', entitas_id: before.anggota_id,
    keterangan: `Ahli waris "${nama}" diperbarui`, before, after });
  return after;
});

router.delete('/api/anggota/ahli-waris/:id', 'anggota.update', ({ params, ctx }) => {
  const id = idParam(params);
  const w = get('SELECT * FROM anggota_ahli_waris WHERE id = ?', [id]);
  if (!w) throw notFound('Ahli waris tidak ditemukan');
  run('DELETE FROM anggota_ahli_waris WHERE id = ?', [id]);
  logAudit(ctx, { aksi: 'delete', modul: 'anggota', entitas_id: w.anggota_id,
    keterangan: `Ahli waris "${w.nama}" dihapus`, before: w });
  return { dihapus: true };
});

/** Kartu anggota digital (data untuk cetak / QR). */
router.get('/api/anggota/:id/kartu', 'anggota.view', ({ params }) => {
  const id = idParam(params);
  const a = get('SELECT * FROM anggota WHERE id = ?', [id]);
  if (!a) throw notFound('Anggota tidak ditemukan');
  return {
    nomor_anggota: a.nomor_anggota, nama: a.nama, nik: a.nik, foto: a.foto,
    tanggal_gabung: a.tanggal_gabung, status: a.status,
    qr: `ECMS-ANGGOTA:${a.nomor_anggota}`,
    koperasi: get("SELECT value FROM settings WHERE key = 'koperasi.nama'")?.value || 'Koperasi Serba Usaha',
  };
});

export default router;
