/**
 * Modul 6 (SHU), 15 (Unit Usaha), 16 (Aset Tetap), 17 (RAT).
 */
import { createRouter, notFound, badRequest, conflict } from '../lib/http.js';
import { all, get, run, scalar, tx, nextNumber } from '../db.js';
import { logAudit, notify } from '../lib/audit.js';
import { idParam, num, str, date, oneOf, today, terbilang } from '../lib/util.js';
import * as shu from '../services/shu.js';
import * as aset from '../services/assets.js';
import { labaRugi, saldoAkun } from '../services/accounting.js';
import crypto from 'node:crypto';

const router = createRouter();

// ------------------------------- SHU -------------------------------

router.get('/api/shu', 'shu.view', () => ({ data: shu.daftarPeriode(), alokasi_default: shu.persentaseAlokasi() }));

router.get('/api/shu/simulasi', 'shu.view', ({ query }) => shu.simulasi(
  Number(query.tahun) || new Date().getFullYear(),
  query.shu_bersih ? Number(query.shu_bersih) : null,
));

router.get('/api/shu/:id', 'shu.view', ({ params }) => {
  const id = idParam(params);
  const p = get('SELECT * FROM shu_periode WHERE id = ?', [id]);
  if (!p) throw notFound('Periode SHU tidak ditemukan');
  return {
    ...p,
    alokasi: all('SELECT * FROM shu_alokasi WHERE periode_id = ? ORDER BY id', [id]),
    per_anggota: all(
      `SELECT s.*, a.nomor_anggota, a.nama FROM shu_anggota s JOIN anggota a ON a.id = s.anggota_id
        WHERE s.periode_id = ? ORDER BY s.shu_total DESC`, [id]),
    terbilang: terbilang(p.shu_bersih),
  };
});

router.post('/api/shu/usulan', 'shu.create', ({ body, ctx }) => shu.simpanUsulan(
  num(body, 'tahun', { min: 2000, max: 2200 }),
  body.shu_bersih !== undefined && body.shu_bersih !== '' ? Number(body.shu_bersih) : null,
  ctx,
));

router.post('/api/shu/:id/sahkan', 'shu.approve', ({ params, body, ctx }) => shu.sahkan(idParam(params), {
  rat_id: body.rat_id ? Number(body.rat_id) : null,
  tanggal: date(body, 'tanggal', { required: false, dflt: null }),
}, ctx));

router.post('/api/shu/:id/bagikan', 'shu.approve', ({ params, body, ctx }) => shu.bagikan(idParam(params), {
  metode: oneOf(body, 'metode', ['tunai', 'transfer', 'simpanan'], { required: false, dflt: 'simpanan' }),
  tanggal: date(body, 'tanggal', { required: false, dflt: today() }),
  bank_account_id: body.bank_account_id ? Number(body.bank_account_id) : null,
}, ctx));

// --------------------------- Unit Usaha ---------------------------

/** Laporan laba rugi per unit usaha (segment reporting). */
router.get('/api/unit-usaha/kinerja', 'unit.view', ({ query }) => {
  const tahun = Number(query.tahun) || new Date().getFullYear();
  const dari = query.dari || `${tahun}-01-01`;
  const sampai = query.sampai || `${tahun}-12-31`;
  const units = all("SELECT * FROM unit_usaha WHERE status = 'aktif' ORDER BY kode");
  const perUnit = units.map((u) => {
    const lr = labaRugi({ dari, sampai, unit_usaha_id: u.id });
    return {
      id: u.id, kode: u.kode, nama: u.nama, jenis: u.jenis,
      pendapatan: lr.total_pendapatan, hpp: lr.hpp, laba_kotor: lr.laba_kotor,
      beban: lr.total_beban, shu: lr.shu_bersih,
      margin: lr.total_pendapatan ? Number((lr.shu_bersih / lr.total_pendapatan * 100).toFixed(2)) : 0,
    };
  });
  const konsolidasi = labaRugi({ dari, sampai });
  return {
    periode: { dari, sampai },
    per_unit: perUnit,
    tanpa_unit: {
      pendapatan: konsolidasi.total_pendapatan - perUnit.reduce((s, u) => s + u.pendapatan, 0),
      shu: konsolidasi.shu_bersih - perUnit.reduce((s, u) => s + u.shu, 0),
    },
    konsolidasi: {
      pendapatan: konsolidasi.total_pendapatan, beban: konsolidasi.total_beban,
      shu: konsolidasi.shu_bersih,
    },
  };
});

router.get('/api/unit-usaha/:id/laporan', 'unit.view', ({ params, query }) => {
  const id = idParam(params);
  const u = get('SELECT * FROM unit_usaha WHERE id = ?', [id]);
  if (!u) throw notFound('Unit usaha tidak ditemukan');
  const tahun = Number(query.tahun) || new Date().getFullYear();
  return {
    unit: u,
    laba_rugi: labaRugi({ dari: `${tahun}-01-01`, sampai: query.sampai || `${tahun}-12-31`, unit_usaha_id: id }),
    gudang: all('SELECT * FROM gudang WHERE unit_usaha_id = ?', [id]),
    aset: aset.daftar({ unit_usaha_id: id }),
  };
});

// ---------------------------- Aset Tetap ----------------------------

router.get('/api/aset', 'aset.view', ({ query }) => ({ data: aset.daftar(query) }));

router.get('/api/aset/ringkasan', 'aset.view', () => aset.ringkasan());

router.get('/api/aset/:id', 'aset.view', ({ params }) => {
  const id = idParam(params);
  const a = get('SELECT * FROM aset_tetap WHERE id = ?', [id]);
  if (!a) throw notFound('Aset tidak ditemukan');
  return {
    ...a,
    nilai_buku: a.harga_perolehan - a.akumulasi_penyusutan,
    penyusutan_per_bulan: aset.penyusutanBulanan(a),
    riwayat_penyusutan: all('SELECT * FROM aset_penyusutan WHERE aset_id = ? ORDER BY periode DESC', [id]),
    maintenance: all('SELECT * FROM aset_maintenance WHERE aset_id = ? ORDER BY tanggal DESC', [id]),
  };
});

router.post('/api/aset', 'aset.create', ({ body, ctx }) => aset.tambah({
  kode: str(body, 'kode', { max: 30 }),
  nama: str(body, 'nama', { max: 150 }),
  kategori: oneOf(body, 'kategori', ['tanah', 'bangunan', 'kendaraan', 'inventaris', 'mesin'],
    { required: false, dflt: 'inventaris' }),
  tanggal_perolehan: date(body, 'tanggal_perolehan', { required: false, dflt: today() }),
  harga_perolehan: num(body, 'harga_perolehan', { min: 1 }),
  nilai_residu: num(body, 'nilai_residu', { required: false, min: 0 }),
  umur_manfaat: num(body, 'umur_manfaat', { required: false, min: 0, max: 100 }) || 4,
  metode: oneOf(body, 'metode', ['garis_lurus', 'saldo_menurun'], { required: false, dflt: 'garis_lurus' }),
  lokasi: body.lokasi, cabang_id: body.cabang_id ? Number(body.cabang_id) : null,
  unit_usaha_id: body.unit_usaha_id ? Number(body.unit_usaha_id) : null,
  penanggung_jawab: body.penanggung_jawab,
  coa_aset: body.coa_aset || null, coa_akumulasi: body.coa_akumulasi || null, coa_beban: body.coa_beban || null,
  barcode: body.barcode,
  // Perolehan selalu dijurnal otomatis kecuali aset lama yang sudah ada di
  // neraca pembuka (saldo_awal). buat_jurnal/metode_bayar dipertahankan
  // untuk klien lama.
  sumber_perolehan: oneOf(body, 'sumber_perolehan', aset.SUMBER_PEROLEHAN, { required: false, dflt: null })
    || (body.buat_jurnal === false ? 'saldo_awal' : (body.metode_bayar === 'transfer' ? 'transfer' : 'kas')),
  bank_account_id: body.bank_account_id ? Number(body.bank_account_id) : null,
  akumulasi_awal: num(body, 'akumulasi_awal', { required: false, min: 0 }),
  pemasok: str(body, 'pemasok', { required: false, max: 150 }),
  jatuh_tempo: date(body, 'jatuh_tempo', { required: false, dflt: null }),
}, ctx));

router.put('/api/aset/:id', 'aset.update', ({ params, body, ctx }) => aset.ubah(idParam(params), body, ctx));

router.delete('/api/aset/:id', 'aset.delete', ({ params, ctx }) => aset.hapus(idParam(params), ctx));

router.post('/api/aset/penyusutan', 'aset.post', ({ body, ctx }) =>
  aset.jalankanPenyusutan(str(body, 'periode', { max: 7, label: 'Periode (YYYY-MM)' }), ctx));

router.post('/api/aset/:id/disposal', 'aset.update', ({ params, body, ctx }) => aset.disposal(idParam(params), {
  tanggal: date(body, 'tanggal', { required: false, dflt: today() }),
  nilai_jual: num(body, 'nilai_jual', { required: false, min: 0 }),
  keterangan: str(body, 'keterangan', { required: false, max: 300 }),
  metode: oneOf(body, 'metode', ['tunai', 'transfer'], { required: false, dflt: 'tunai' }),
  bank_account_id: body.bank_account_id ? Number(body.bank_account_id) : null,
}, ctx));

router.post('/api/aset/:id/maintenance', 'aset.update', ({ params, body, ctx }) => aset.maintenance(idParam(params), {
  tanggal: date(body, 'tanggal', { required: false, dflt: today() }),
  jenis: str(body, 'jenis', { required: false, max: 100 }),
  biaya: num(body, 'biaya', { required: false, min: 0 }),
  vendor: str(body, 'vendor', { required: false, max: 150 }),
  keterangan: str(body, 'keterangan', { required: false, max: 300 }),
  jadwal_berikutnya: date(body, 'jadwal_berikutnya', { required: false, dflt: null }),
  metode_bayar: oneOf(body, 'metode_bayar', ['tunai', 'transfer', 'hutang'], { required: false, dflt: 'tunai' }),
  bank_account_id: body.bank_account_id ? Number(body.bank_account_id) : null,
  jatuh_tempo: date(body, 'jatuh_tempo', { required: false, dflt: null }),
}, ctx));

// ------------------------------- RAT -------------------------------

router.get('/api/rat', 'rat.view', () => ({
  data: all(
    `SELECT r.*, (SELECT COUNT(*) FROM rat_peserta WHERE rat_id = r.id AND hadir = 1) AS jumlah_hadir
       FROM rat r ORDER BY r.tahun_buku DESC, r.id DESC`),
}));

router.get('/api/rat/:id', 'rat.view', ({ params }) => {
  const id = idParam(params);
  const r = get('SELECT * FROM rat WHERE id = ?', [id]);
  if (!r) throw notFound('Data RAT tidak ditemukan');
  const voting = all('SELECT * FROM rat_voting WHERE rat_id = ? ORDER BY id', [id]).map((v) => {
    const suara = all('SELECT pilihan, COUNT(*) AS jumlah FROM rat_suara WHERE voting_id = ? GROUP BY pilihan', [v.id]);
    const total = suara.reduce((s, x) => s + x.jumlah, 0);
    return {
      ...v, opsi: JSON.parse(v.opsi || '[]'), total_suara: total,
      rekap: suara.map((s) => ({ ...s, persen: total ? Number((s.jumlah / total * 100).toFixed(1)) : 0 })),
    };
  });
  return {
    ...r,
    agenda: all('SELECT * FROM rat_agenda WHERE rat_id = ? ORDER BY urut', [id]),
    peserta: all(
      `SELECT p.*, a.nomor_anggota, a.nama FROM rat_peserta p JOIN anggota a ON a.id = p.anggota_id
        WHERE p.rat_id = ? ORDER BY a.nomor_anggota`, [id]),
    voting,
  };
});

router.post('/api/rat', 'rat.create', ({ body, ctx }) => {
  const tahun = num(body, 'tahun_buku', { min: 2000, max: 2200 });
  const tanggal = date(body, 'tanggal', { label: 'Tanggal pelaksanaan' });
  return tx(() => {
    const nomor = nextNumber('RAT', tanggal);
    const totalAnggota = scalar("SELECT COUNT(*) FROM anggota WHERE status = 'aktif'");
    const { lastInsertRowid: id } = run(
      `INSERT INTO rat(nomor, tahun_buku, judul, tanggal, waktu, tempat, jenis, total_anggota, kuorum_persen)
       VALUES(?,?,?,?,?,?,?,?,?)`,
      [nomor, tahun, str(body, 'judul', { max: 200 }), tanggal, body.waktu || null, body.tempat || null,
        oneOf(body, 'jenis', ['tahunan', 'luar_biasa'], { required: false, dflt: 'tahunan' }),
        totalAnggota, Number(body.kuorum_persen) || 50],
    );
    const agendaDefault = body.agenda || [
      { judul: 'Pembukaan dan pengesahan kuorum', jenis: 'pembahasan' },
      { judul: 'Laporan Pertanggungjawaban Pengurus', jenis: 'laporan' },
      { judul: 'Laporan Pengawas', jenis: 'laporan' },
      { judul: 'Pengesahan Laporan Keuangan Tahun Buku ' + tahun, jenis: 'voting' },
      { judul: 'Pembagian SHU', jenis: 'voting' },
      { judul: 'Rencana Kerja & RAPB Tahun ' + (tahun + 1), jenis: 'voting' },
      { judul: 'Lain-lain dan penutup', jenis: 'pembahasan' },
    ];
    agendaDefault.forEach((a, i) => {
      run('INSERT INTO rat_agenda(rat_id, urut, judul, keterangan, jenis) VALUES(?,?,?,?,?)',
        [id, a.urut ?? i + 1, a.judul, a.keterangan || null, a.jenis || 'pembahasan']);
    });
    logAudit(ctx, { aksi: 'create', modul: 'rat', entitas_id: id,
      keterangan: `RAT ${nomor} tahun buku ${tahun} dijadwalkan ${tanggal}` });
    return get('SELECT * FROM rat WHERE id = ?', [id]);
  });
});

/** Mengirim undangan ke seluruh anggota aktif. */
router.post('/api/rat/:id/undangan', 'rat.update', ({ params, ctx }) => {
  const id = idParam(params);
  const r = get('SELECT * FROM rat WHERE id = ?', [id]);
  if (!r) throw notFound('Data RAT tidak ditemukan');
  return tx(() => {
    const anggota = all("SELECT id FROM anggota WHERE status = 'aktif'");
    for (const a of anggota) {
      run('INSERT OR IGNORE INTO rat_peserta(rat_id, anggota_id) VALUES(?,?)', [id, a.id]);
    }
    run("UPDATE rat SET status = 'undangan', total_anggota = ? WHERE id = ?", [anggota.length, id]);
    run(`INSERT INTO broadcast(judul, pesan, kanal, target, jumlah_target, status, dikirim_pada)
         VALUES(?,?,'aplikasi','aktif',?,'terkirim',datetime('now'))`,
    [`Undangan ${r.judul}`,
      `Diundang hadir pada ${r.tanggal} ${r.waktu || ''} bertempat di ${r.tempat || '-'}.`, anggota.length]);
    logAudit(ctx, { aksi: 'create', modul: 'rat', entitas_id: id,
      keterangan: `Undangan RAT ${r.nomor} dikirim ke ${anggota.length} anggota` });
    return { diundang: anggota.length };
  });
});

/** Pencatatan kehadiran + evaluasi kuorum (UU 25/1992 Pasal 26). */
router.post('/api/rat/:id/hadir', 'rat.update', ({ params, body, ctx }) => {
  const id = idParam(params);
  const r = get('SELECT * FROM rat WHERE id = ?', [id]);
  if (!r) throw notFound('Data RAT tidak ditemukan');
  const anggotaId = num(body, 'anggota_id', { min: 1 });
  const peserta = get('SELECT * FROM rat_peserta WHERE rat_id = ? AND anggota_id = ?', [id, anggotaId]);
  if (!peserta) throw notFound('Anggota tidak terdaftar sebagai peserta RAT ini');
  if (peserta.hadir) throw conflict('Kehadiran anggota ini sudah tercatat');

  return tx(() => {
    const ttd = crypto.createHash('sha256')
      .update(`${id}|${anggotaId}|${new Date().toISOString()}`).digest('hex');
    run(`UPDATE rat_peserta SET hadir = 1, waktu_hadir = datetime('now'), ttd_elektronik = ?,
           kuasa_kepada = ? WHERE id = ?`, [ttd, body.kuasa_kepada || null, peserta.id]);
    const hadir = scalar('SELECT COUNT(*) FROM rat_peserta WHERE rat_id = ? AND hadir = 1', [id]);
    const kuorum = r.total_anggota > 0 && (hadir / r.total_anggota * 100) >= r.kuorum_persen;
    run('UPDATE rat SET hadir = ?, kuorum_tercapai = ? WHERE id = ?', [hadir, kuorum ? 1 : 0, id]);
    logAudit(ctx, { aksi: 'create', modul: 'rat', entitas_id: id,
      keterangan: `Kehadiran anggota #${anggotaId} pada RAT ${r.nomor} tercatat` });
    return {
      hadir, total_anggota: r.total_anggota,
      persen: r.total_anggota ? Number((hadir / r.total_anggota * 100).toFixed(1)) : 0,
      kuorum_tercapai: kuorum, kuorum_syarat: r.kuorum_persen, ttd_elektronik: ttd,
    };
  });
});

router.post('/api/rat/:id/voting', 'rat.create', ({ params, body, ctx }) => {
  const id = idParam(params);
  if (!get('SELECT id FROM rat WHERE id = ?', [id])) throw notFound('Data RAT tidak ditemukan');
  const opsi = Array.isArray(body.opsi) && body.opsi.length >= 2 ? body.opsi : ['Setuju', 'Tidak Setuju', 'Abstain'];
  const { lastInsertRowid } = run(
    `INSERT INTO rat_voting(rat_id, agenda_id, judul, opsi, status) VALUES(?,?,?,?,'draft')`,
    [id, body.agenda_id || null, str(body, 'judul', { max: 200 }), JSON.stringify(opsi)]);
  logAudit(ctx, { aksi: 'create', modul: 'rat', entitas_id: id, keterangan: `Voting "${body.judul}" dibuat` });
  return get('SELECT * FROM rat_voting WHERE id = ?', [lastInsertRowid]);
});

router.post('/api/rat/voting/:id/status', 'rat.update', ({ params, body, ctx }) => {
  const id = idParam(params);
  const v = get('SELECT * FROM rat_voting WHERE id = ?', [id]);
  if (!v) throw notFound('Voting tidak ditemukan');
  const status = oneOf(body, 'status', ['dibuka', 'ditutup'], { label: 'Status voting' });
  const r = get('SELECT * FROM rat WHERE id = ?', [v.rat_id]);
  if (status === 'dibuka' && !r.kuorum_tercapai) {
    throw conflict('Voting tidak dapat dibuka karena kuorum belum tercapai',
      `Hadir ${r.hadir} dari ${r.total_anggota} anggota (syarat ${r.kuorum_persen}%)`);
  }
  let hasil = null;
  if (status === 'ditutup') {
    const suara = all('SELECT pilihan, COUNT(*) AS jumlah FROM rat_suara WHERE voting_id = ? GROUP BY pilihan ORDER BY jumlah DESC', [id]);
    const total = suara.reduce((s, x) => s + x.jumlah, 0);
    hasil = JSON.stringify({ total_suara: total, rekap: suara, keputusan: suara[0]?.pilihan || 'tidak ada suara' });
  }
  run(`UPDATE rat_voting SET status = ?, hasil = ?,
         mulai = CASE WHEN ? = 'dibuka' THEN datetime('now') ELSE mulai END,
         selesai = CASE WHEN ? = 'ditutup' THEN datetime('now') ELSE selesai END WHERE id = ?`,
  [status, hasil, status, status, id]);
  logAudit(ctx, { aksi: 'update', modul: 'rat', entitas_id: v.rat_id,
    keterangan: `Voting "${v.judul}" ${status}` });
  return get('SELECT * FROM rat_voting WHERE id = ?', [id]);
});

router.post('/api/rat/voting/:id/suara', 'rat.view', ({ params, body, ctx }) => {
  const id = idParam(params);
  const v = get('SELECT * FROM rat_voting WHERE id = ?', [id]);
  if (!v) throw notFound('Voting tidak ditemukan');
  if (v.status !== 'dibuka') throw conflict('Voting ini belum dibuka atau sudah ditutup');
  const anggotaId = num(body, 'anggota_id', { min: 1 });
  const hadir = get('SELECT hadir FROM rat_peserta WHERE rat_id = ? AND anggota_id = ?', [v.rat_id, anggotaId]);
  if (!hadir?.hadir) throw conflict('Hanya anggota yang hadir dan tercatat yang berhak memberikan suara');
  const opsi = JSON.parse(v.opsi || '[]');
  const pilihan = str(body, 'pilihan', { max: 100 });
  if (!opsi.includes(pilihan)) throw badRequest(`Pilihan tidak valid. Opsi: ${opsi.join(', ')}`);
  if (get('SELECT id FROM rat_suara WHERE voting_id = ? AND anggota_id = ?', [id, anggotaId])) {
    throw conflict('Anggota ini sudah memberikan suara (satu anggota satu suara)');
  }
  run('INSERT INTO rat_suara(voting_id, anggota_id, pilihan) VALUES(?,?,?)', [id, anggotaId, pilihan]);
  logAudit(ctx, { aksi: 'create', modul: 'rat', entitas_id: v.rat_id,
    keterangan: `Suara tercatat pada voting "${v.judul}"` });
  return { berhasil: true, total_suara: scalar('SELECT COUNT(*) FROM rat_suara WHERE voting_id = ?', [id]) };
});

/** Berita acara RAT (draf otomatis). */
router.get('/api/rat/:id/berita-acara', 'rat.view', ({ params }) => {
  const id = idParam(params);
  const r = get('SELECT * FROM rat WHERE id = ?', [id]);
  if (!r) throw notFound('Data RAT tidak ditemukan');
  const lr = labaRugi({ dari: `${r.tahun_buku}-01-01`, sampai: `${r.tahun_buku}-12-31` });
  const voting = all('SELECT * FROM rat_voting WHERE rat_id = ? AND status = ?', [id, 'ditutup'])
    .map((v) => ({ judul: v.judul, hasil: v.hasil ? JSON.parse(v.hasil) : null }));
  const perangkat = all(
    `SELECT k.nama, j.nama AS jabatan, j.kelompok FROM karyawan k JOIN jabatan j ON j.id = k.jabatan_id
      WHERE k.status = 'aktif' AND j.kelompok IN ('pengurus','pengawas')`);
  return {
    nomor: r.nomor, judul: r.judul, tanggal: r.tanggal, tempat: r.tempat,
    kehadiran: { hadir: r.hadir, total: r.total_anggota, kuorum_tercapai: !!r.kuorum_tercapai,
      persen: r.total_anggota ? Number((r.hadir / r.total_anggota * 100).toFixed(1)) : 0 },
    agenda: all('SELECT urut, judul, jenis FROM rat_agenda WHERE rat_id = ? ORDER BY urut', [id]),
    keputusan: voting,
    ikhtisar_keuangan: {
      tahun_buku: r.tahun_buku, pendapatan: lr.total_pendapatan, beban: lr.total_beban,
      shu: lr.shu_bersih, shu_terbilang: terbilang(lr.shu_bersih),
    },
    perangkat_organisasi: perangkat,
    dasar_hukum: 'UU No. 25 Tahun 1992 tentang Perkoperasian, Pasal 22 s.d. 27 mengenai Rapat Anggota.',
  };
});

router.post('/api/rat/:id/selesai', 'rat.update', ({ params, body, ctx }) => {
  const id = idParam(params);
  const r = get('SELECT * FROM rat WHERE id = ?', [id]);
  if (!r) throw notFound('Data RAT tidak ditemukan');
  run("UPDATE rat SET status = 'selesai', berita_acara = ? WHERE id = ?", [body.berita_acara || null, id]);
  logAudit(ctx, { aksi: 'update', modul: 'rat', entitas_id: id,
    keterangan: `RAT ${r.nomor} dinyatakan selesai` });
  return get('SELECT * FROM rat WHERE id = ?', [id]);
});

export default router;
