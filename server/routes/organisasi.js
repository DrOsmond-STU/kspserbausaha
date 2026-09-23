/**
 * Modul 6 (SHU), 15 (Unit Usaha), 16 (Aset Tetap), 17 (RAT).
 */
import { createRouter, notFound, badRequest, conflict, forbidden } from '../lib/http.js';
import { can } from '../lib/rbac.js';
import { all, get, run, scalar, tx, nextNumber } from '../db.js';
import { logAudit, notify } from '../lib/audit.js';
import { idParam, num, str, date, oneOf, today, terbilang } from '../lib/util.js';
import * as shu from '../services/shu.js';
import * as aset from '../services/assets.js';
import * as unitSvc from '../services/unit.js';
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
        WHERE s.periode_id = ? ORDER BY s.shu_total DESC`, [id])
      .map((x) => ({ ...x, terbilang: terbilang(x.shu_total) })),   // untuk slip SHU per anggota
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

// ------------------ Transaksi unit usaha (pendapatan & biaya) ------------------

/** Minimal salah satu izin dimiliki (mis. unit.create ATAU kas.create). */
function wajibSalahSatu(ctx, ...izin) {
  if (!izin.some((i) => can(ctx.user.role, i))) {
    throw forbidden(`Aksi ini memerlukan izin ${izin.map((i) => `"${i}"`).join(' atau ')}`);
  }
}

/** Pilihan formulir: unit aktif (dengan akun bawaannya) dan akun dari bagan akun. */
router.get('/api/unit-usaha/opsi', 'unit.view', () => {
  const akun = all(`SELECT kode, nama, tipe, is_kas, is_bank FROM coa
                     WHERE is_postable = 1 AND status = 'aktif' ORDER BY kode`);
  return {
    unit: all(`SELECT id, kode, nama, jenis, coa_pendapatan, coa_beban FROM unit_usaha
                WHERE status = 'aktif' ORDER BY kode`),
    akun_pendapatan: akun.filter((a) => a.tipe === 'pendapatan'),
    akun_beban: akun.filter((a) => a.tipe === 'beban'),
    akun_kas: akun.filter((a) => a.is_kas || a.is_bank),
  };
});

router.get('/api/unit-usaha/transaksi', 'unit.view', ({ query }) => unitSvc.daftarTransaksiUnit(query));

router.get('/api/unit-usaha/transaksi/:id', 'unit.view', ({ params }) => {
  const k = unitSvc.transaksiUnit(idParam(params));
  return { ...k, terbilang: terbilang(k.nominal) };
});

const isianTransaksiUnit = (body, wajib) => {
  const d = {};
  if (wajib || body.unit_usaha_id !== undefined) d.unit_usaha_id = Number(body.unit_usaha_id) || null;
  if (wajib || body.nominal !== undefined) d.nominal = num(body, 'nominal', { min: 1, label: 'Nominal' });
  if (wajib || body.coa_kas !== undefined) d.coa_kas = str(body, 'coa_kas', { max: 20, label: 'Akun kas/bank' });
  if (body.coa_akun !== undefined) d.coa_akun = str(body, 'coa_akun', { required: false, max: 20 }) || undefined;
  if (body.tanggal) d.tanggal = date(body, 'tanggal');
  if (body.keterangan !== undefined) d.keterangan = str(body, 'keterangan', { required: false, max: 300 });
  if (body.pihak !== undefined) d.pihak = str(body, 'pihak', { required: false, max: 150 }) || null;
  return d;
};

router.post('/api/unit-usaha/transaksi', null, ({ body, ctx }) => {
  wajibSalahSatu(ctx, 'unit.create', 'kas.create');
  return unitSvc.catatTransaksiUnit({
    jenis: oneOf(body, 'jenis', Object.keys(unitSvc.JENIS_TRANSAKSI_UNIT), { label: 'Jenis transaksi' }),
    tanggal: date(body, 'tanggal', { required: false, dflt: today() }),
    ...isianTransaksiUnit(body, true),
  }, ctx);
});

router.put('/api/unit-usaha/transaksi/:id', null, ({ params, body, ctx }) => {
  wajibSalahSatu(ctx, 'unit.koreksi', 'kas.koreksi');
  return unitSvc.ubahTransaksiUnit(idParam(params), isianTransaksiUnit(body, false),
    str(body, 'alasan', { max: 300, label: 'Alasan perubahan' }), ctx);
});

router.post('/api/unit-usaha/transaksi/:id/batal', null, ({ params, body, ctx }) => {
  wajibSalahSatu(ctx, 'unit.koreksi', 'kas.koreksi');
  return unitSvc.batalTransaksiUnit(idParam(params), str(body, 'alasan', { max: 300, label: 'Alasan pembatalan' }), ctx);
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

/** Data bukti pelepasan aset: nilai buku saat dilepas, hasil, laba/rugi, dan jurnalnya. */
router.get('/api/aset/:id/pelepasan', 'aset.view', ({ params }) => {
  const id = idParam(params);
  const a = get('SELECT * FROM aset_tetap WHERE id = ?', [id]);
  if (!a) throw notFound('Aset tidak ditemukan');
  if (a.status !== 'dilepas') throw conflict('Aset ini belum dilepas');
  const jurnal = get(`SELECT id, nomor, tanggal, keterangan, status FROM jurnal WHERE referensi = ?
                       ORDER BY id DESC LIMIT 1`, [`disposal:${id}`]);
  const detail = jurnal ? all(
    `SELECT d.coa_kode, c.nama AS akun_nama, d.debit, d.kredit, d.keterangan FROM jurnal_detail d
       JOIN coa c ON c.kode = d.coa_kode WHERE d.jurnal_id = ? ORDER BY d.urut`, [jurnal.id]) : [];
  const nilaiBuku = a.harga_perolehan - a.akumulasi_penyusutan;
  const hasil = a.nilai_disposal || 0;
  return {
    aset: a, nilai_buku: nilaiBuku, hasil, laba_rugi: hasil - nilaiBuku,
    terbilang: terbilang(hasil), jurnal: jurnal ? { ...jurnal, detail } : null,
  };
});

router.put('/api/aset/:id', 'aset.update', ({ params, body, ctx }) => aset.ubah(idParam(params), body, ctx));

router.delete('/api/aset/:id', 'aset.koreksi', ({ params, ctx }) => aset.hapus(idParam(params), ctx));

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

/**
 * Ubah data pokok RAT selama rapat belum selesai/batal. Bila syarat kuorum
 * berubah, status kuorum dihitung ulang dari kehadiran yang sudah tercatat.
 */
router.put('/api/rat/:id', 'rat.update', ({ params, body, ctx }) => {
  const id = idParam(params);
  const before = get('SELECT * FROM rat WHERE id = ?', [id]);
  if (!before) throw notFound('Data RAT tidak ditemukan');
  if (['selesai', 'batal'].includes(before.status)) {
    throw conflict(`RAT berstatus ${before.status} tidak dapat diubah lagi`);
  }
  const data = {};
  if (body.tahun_buku !== undefined) data.tahun_buku = num(body, 'tahun_buku', { min: 2000, max: 2200 });
  if (body.judul !== undefined) data.judul = str(body, 'judul', { max: 200 });
  // Tanggal kosong diabaikan (bukan diganti hari ini seperti perilaku bawaan date())
  if (body.tanggal) data.tanggal = date(body, 'tanggal', { label: 'Tanggal pelaksanaan' });
  if (body.waktu !== undefined) data.waktu = str(body, 'waktu', { required: false, max: 50 }) || null;
  if (body.tempat !== undefined) data.tempat = str(body, 'tempat', { required: false, max: 200 }) || null;
  if (body.jenis !== undefined) data.jenis = oneOf(body, 'jenis', ['tahunan', 'luar_biasa']);
  if (body.kuorum_persen !== undefined) {
    data.kuorum_persen = num(body, 'kuorum_persen', { min: 1, max: 100, integer: false, label: 'Syarat kuorum' });
    data.kuorum_tercapai = before.total_anggota > 0
      && (before.hadir / before.total_anggota * 100) >= data.kuorum_persen ? 1 : 0;
  }
  const cols = Object.keys(data);
  if (!cols.length) throw badRequest('Tidak ada perubahan yang dikirim');
  run(`UPDATE rat SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
    [...cols.map((c) => data[c]), id]);
  logAudit(ctx, { aksi: 'update', modul: 'rat', entitas_id: id,
    keterangan: `Data RAT ${before.nomor} diperbarui`, before, after: data });
  return get('SELECT * FROM rat WHERE id = ?', [id]);
});

/**
 * Hapus RAT yang masih berstatus rencana dan belum memiliki kehadiran,
 * suara, maupun keterkaitan dengan pengesahan SHU. RAT yang sudah berjalan
 * merupakan arsip kelembagaan dan tidak boleh dihapus.
 */
router.delete('/api/rat/:id', 'rat.delete', ({ params, ctx }) => {
  const id = idParam(params);
  const r = get('SELECT * FROM rat WHERE id = ?', [id]);
  if (!r) throw notFound('Data RAT tidak ditemukan');
  if (r.status !== 'rencana') {
    throw conflict(`RAT berstatus ${r.status} tidak dapat dihapus`,
      'Hanya RAT yang masih berstatus rencana (undangan belum dikirim) yang dapat dihapus.');
  }
  const hadir = scalar('SELECT COUNT(*) FROM rat_peserta WHERE rat_id = ? AND hadir = 1', [id]);
  const suara = scalar(
    'SELECT COUNT(*) FROM rat_suara s JOIN rat_voting v ON v.id = s.voting_id WHERE v.rat_id = ?', [id]);
  if (hadir || suara) throw conflict('RAT yang sudah memiliki kehadiran atau suara tidak dapat dihapus');
  const shuTerkait = get('SELECT tahun FROM shu_periode WHERE rat_id = ?', [id]);
  if (shuTerkait) throw conflict(`RAT ini menjadi dasar pengesahan SHU tahun ${shuTerkait.tahun}`);
  tx(() => {
    // Urutan penting: voting merujuk agenda tanpa ON DELETE CASCADE
    run('DELETE FROM rat_suara WHERE voting_id IN (SELECT id FROM rat_voting WHERE rat_id = ?)', [id]);
    run('DELETE FROM rat_voting WHERE rat_id = ?', [id]);
    run('DELETE FROM rat_peserta WHERE rat_id = ?', [id]);
    run('DELETE FROM rat_agenda WHERE rat_id = ?', [id]);
    run('DELETE FROM rat WHERE id = ?', [id]);
  });
  logAudit(ctx, { aksi: 'delete', modul: 'rat', entitas_id: id,
    keterangan: `RAT ${r.nomor} (${r.judul}) dihapus`, before: r });
  return { dihapus: true, id };
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

// Pencatatan suara oleh panitia atas nama anggota yang hadir adalah aksi tulis
// sehingga memerlukan rat.update; anggota memilih sendiri lewat /api/portal/voting.
router.post('/api/rat/voting/:id/suara', 'rat.update', ({ params, body, ctx }) => {
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
    // Untuk cetakan berita acara
    waktu: r.waktu, jenis: r.jenis, status: r.status, catatan: r.berita_acara || '',
    kehadiran: { hadir: r.hadir, total: r.total_anggota, kuorum_tercapai: !!r.kuorum_tercapai,
      kuorum_persen: r.kuorum_persen,
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
  if (['selesai', 'batal'].includes(r.status)) throw conflict(`RAT ini sudah berstatus ${r.status}`);
  const votingTerbuka = scalar("SELECT COUNT(*) FROM rat_voting WHERE rat_id = ? AND status = 'dibuka'", [id]);
  if (votingTerbuka) {
    throw conflict('Masih ada voting yang sedang dibuka', 'Tutup seluruh voting sebelum menyelesaikan RAT.');
  }
  run("UPDATE rat SET status = 'selesai', berita_acara = ? WHERE id = ?", [body.berita_acara || null, id]);
  logAudit(ctx, { aksi: 'update', modul: 'rat', entitas_id: id,
    keterangan: `RAT ${r.nomor} dinyatakan selesai` });
  return get('SELECT * FROM rat WHERE id = ?', [id]);
});

export default router;
