/**
 * Modul 5 - Pinjaman (Simpan Pinjam).
 *
 * Mencakup pengajuan, credit scoring, persetujuan berjenjang, pencairan,
 * jadwal amortisasi, angsuran, denda, restrukturisasi, pelunasan dipercepat,
 * serta klasifikasi kolektibilitas & NPL.
 */
import { all, get, run, scalar, nextNumber, tx, settingNum } from '../db.js';
import { badRequest, notFound, conflict } from '../lib/http.js';
import { logAudit, notify } from '../lib/audit.js';
import { postJournal, AKUN, akunKasMetode } from './accounting.js';
import { addMonths, diffDays, rupiah, splitEvenly, today } from '../lib/util.js';
import { ringkasanAnggota, setBlokir } from './savings.js';

// ----------------------------- Amortisasi -----------------------------

/**
 * Menghitung jadwal angsuran.
 * @param {'flat'|'efektif'|'menurun'|'anuitas'|'margin_murabahah'} metode
 * @returns {{jadwal:Array, total_bunga:number, angsuran_pertama:number}}
 */
export function hitungJadwal({ pokok, tenor, bunga_tahunan, metode, tanggal_mulai }) {
  if (tenor < 1) throw badRequest('Tenor minimal 1 bulan');
  if (pokok <= 0) throw badRequest('Pokok pinjaman harus lebih besar dari nol');
  const i = bunga_tahunan / 100 / 12;
  const jadwal = [];
  let sisa = pokok;

  if (metode === 'flat' || metode === 'margin_murabahah') {
    const bungaBulanan = rupiah(pokok * i);
    const pokokPer = splitEvenly(pokok, tenor);
    for (let k = 1; k <= tenor; k++) {
      const p = pokokPer[k - 1];
      sisa -= p;
      jadwal.push({ angsuran_ke: k, jatuh_tempo: addMonths(tanggal_mulai, k),
        pokok: p, bunga: bungaBulanan, total: p + bungaBulanan, sisa_pokok: sisa });
    }
  } else if (metode === 'anuitas') {
    const angsuran = i === 0 ? rupiah(pokok / tenor)
      : rupiah((pokok * i) / (1 - (1 + i) ** -tenor));
    for (let k = 1; k <= tenor; k++) {
      let bunga = rupiah(sisa * i);
      let p = angsuran - bunga;
      if (k === tenor) { p = sisa; bunga = angsuran - p >= 0 ? rupiah(sisa * i) : bunga; }
      if (p > sisa) p = sisa;
      sisa -= p;
      jadwal.push({ angsuran_ke: k, jatuh_tempo: addMonths(tanggal_mulai, k),
        pokok: p, bunga, total: p + bunga, sisa_pokok: sisa });
    }
    // Sisa pembulatan dibebankan pada angsuran terakhir
    if (sisa !== 0) {
      const last = jadwal[jadwal.length - 1];
      last.pokok += sisa;
      last.total = last.pokok + last.bunga;
      last.sisa_pokok = 0;
    }
  } else { // efektif / menurun: pokok tetap, bunga dari sisa pokok
    const pokokPer = splitEvenly(pokok, tenor);
    for (let k = 1; k <= tenor; k++) {
      const bunga = rupiah(sisa * i);
      const p = pokokPer[k - 1];
      sisa -= p;
      jadwal.push({ angsuran_ke: k, jatuh_tempo: addMonths(tanggal_mulai, k),
        pokok: p, bunga, total: p + bunga, sisa_pokok: sisa });
    }
  }
  return {
    jadwal,
    total_bunga: jadwal.reduce((s, r) => s + r.bunga, 0),
    total_angsuran: jadwal.reduce((s, r) => s + r.total, 0),
    angsuran_pertama: jadwal[0]?.total || 0,
  };
}

// --------------------------- Credit scoring ---------------------------

/**
 * Skor kredit sederhana berbasis 5C (Character, Capacity, Capital,
 * Collateral, Condition) yang dapat diaudit.
 */
export function hitungSkor({ anggota_id, pokok, tenor, angsuran_bulanan }) {
  const anggota = get('SELECT * FROM anggota WHERE id = ?', [anggota_id]);
  if (!anggota) throw notFound('Anggota tidak ditemukan');
  const simpanan = ringkasanAnggota(anggota_id);
  const rincian = [];
  let skor = 0;

  // 1. Character - lama keanggotaan
  const lamaHari = anggota.tanggal_gabung ? diffDays(today(), anggota.tanggal_gabung) : 0;
  const lamaBulan = Math.floor(lamaHari / 30);
  const cChar = lamaBulan >= 36 ? 20 : lamaBulan >= 12 ? 15 : lamaBulan >= 6 ? 10 : 5;
  rincian.push({ aspek: 'Character (lama keanggotaan)', nilai: cChar, maks: 20,
    catatan: `${lamaBulan} bulan menjadi anggota` });
  skor += cChar;

  // 2. Character - riwayat pembayaran pinjaman sebelumnya
  const riwayat = get(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'lunas' THEN 1 ELSE 0 END) AS lunas,
            MAX(kolektibilitas) AS kol_terburuk
       FROM pinjaman WHERE anggota_id = ? AND status IN ('lunas','dicairkan','hapus_buku')`,
    [anggota_id],
  );
  let cHist = 10;
  let histNote = 'Belum pernah meminjam';
  if (riwayat.total > 0) {
    if (riwayat.kol_terburuk >= 4) { cHist = 0; histNote = 'Pernah menunggak berat (kolektibilitas 4/5)'; }
    else if (riwayat.kol_terburuk === 3) { cHist = 8; histNote = 'Pernah kurang lancar'; }
    else if (riwayat.kol_terburuk === 2) { cHist = 15; histNote = 'Pernah dalam perhatian khusus'; }
    else { cHist = 20; histNote = `${riwayat.lunas} pinjaman lunas tanpa tunggakan`; }
  }
  rincian.push({ aspek: 'Character (riwayat pinjaman)', nilai: cHist, maks: 20, catatan: histNote });
  skor += cHist;

  // 3. Capacity - Debt Service Ratio
  const penghasilan = anggota.penghasilan || 0;
  const dsr = penghasilan > 0 ? (angsuran_bulanan / penghasilan) * 100 : 100;
  const cCap = dsr <= 30 ? 25 : dsr <= 40 ? 18 : dsr <= 50 ? 10 : 0;
  rincian.push({ aspek: 'Capacity (rasio angsuran/penghasilan)', nilai: cCap, maks: 25,
    catatan: `DSR ${dsr.toFixed(1)}% ${dsr > 50 ? '(melebihi batas aman 50%)' : ''}` });
  skor += cCap;

  // 4. Capital - simpanan terhadap pinjaman
  const rasioSimpanan = pokok > 0 ? (simpanan.total_simpanan / pokok) * 100 : 0;
  const cCapital = rasioSimpanan >= 50 ? 20 : rasioSimpanan >= 25 ? 15 : rasioSimpanan >= 10 ? 10 : 5;
  rincian.push({ aspek: 'Capital (simpanan terhadap plafon)', nilai: cCapital, maks: 20,
    catatan: `Simpanan Rp ${simpanan.total_simpanan.toLocaleString('id-ID')} (${rasioSimpanan.toFixed(1)}%)` });
  skor += cCapital;

  // 5. Condition - tenor & status anggota
  const cCond = (anggota.status === 'aktif' ? 10 : 0) + (tenor <= 24 ? 5 : 0);
  rincian.push({ aspek: 'Condition (status & tenor)', nilai: cCond, maks: 15,
    catatan: `Status ${anggota.status}, tenor ${tenor} bulan` });
  skor += cCond;

  const rekomendasi = skor >= 75 ? 'Layak - disetujui'
    : skor >= 60 ? 'Layak dengan catatan - perlu agunan tambahan'
      : skor >= 45 ? 'Dipertimbangkan - wajib survey lapangan'
        : 'Tidak layak - risiko tinggi';
  return { skor, maks: 100, rincian, rekomendasi, dsr: Number(dsr.toFixed(2)) };
}

// ---------------------------- Siklus pinjaman ----------------------------

/** Mengajukan pinjaman baru (status: diajukan). */
export function ajukan(data, ctx) {
  const anggota = get('SELECT * FROM anggota WHERE id = ?', [data.anggota_id]);
  if (!anggota) throw notFound('Anggota tidak ditemukan');
  if (anggota.status !== 'aktif') {
    throw conflict(`Hanya anggota berstatus aktif yang dapat mengajukan pinjaman (status saat ini: ${anggota.status})`);
  }
  const produk = get("SELECT * FROM produk_pinjaman WHERE id = ? AND status = 'aktif'", [data.produk_id]);
  if (!produk) throw notFound('Produk pinjaman tidak ditemukan atau tidak aktif');

  const pokok = rupiah(data.pokok);
  const tenor = Number(data.tenor);
  if (produk.plafon_min && pokok < produk.plafon_min) {
    throw badRequest(`Plafon minimal produk ini Rp ${produk.plafon_min.toLocaleString('id-ID')}`);
  }
  if (produk.plafon_max && pokok > produk.plafon_max) {
    throw badRequest(`Plafon maksimal produk ini Rp ${produk.plafon_max.toLocaleString('id-ID')}`);
  }
  if (tenor < produk.tenor_min || tenor > produk.tenor_max) {
    throw badRequest(`Tenor harus antara ${produk.tenor_min} - ${produk.tenor_max} bulan`);
  }

  // Batas maksimal pinjaman aktif per anggota
  const aktif = scalar(
    "SELECT COUNT(*) FROM pinjaman WHERE anggota_id = ? AND status IN ('dicairkan','disetujui','restrukturisasi')",
    [data.anggota_id],
  );
  const maksAktif = settingNum('pinjaman.maks_aktif_per_anggota', 2);
  if (aktif >= maksAktif) {
    throw conflict(`Anggota sudah memiliki ${aktif} pinjaman berjalan (maksimal ${maksAktif})`,
      'Lunasi pinjaman berjalan terlebih dahulu atau ajukan restrukturisasi.');
  }

  const tanggal = data.tanggal_pengajuan || today();
  const bunga = data.bunga_tahunan ?? produk.bunga_tahunan;
  const metode = data.metode_bunga || produk.metode_bunga;
  const h = hitungJadwal({ pokok, tenor, bunga_tahunan: bunga, metode, tanggal_mulai: tanggal });
  const skoring = hitungSkor({ anggota_id: data.anggota_id, pokok, tenor, angsuran_bulanan: h.angsuran_pertama });

  return tx(() => {
    const nomor = nextNumber('PJM', tanggal);
    const { lastInsertRowid: id } = run(
      `INSERT INTO pinjaman(nomor, anggota_id, produk_id, cabang_id, unit_usaha_id, tanggal_pengajuan,
        pokok, tenor, bunga_tahunan, metode_bunga, tujuan, biaya_admin, biaya_provisi, total_bunga,
        angsuran_pokok, angsuran_bunga, angsuran_total, skor_kredit, rekomendasi_skor, status)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'diajukan')`,
      [nomor, data.anggota_id, data.produk_id, data.cabang_id ?? anggota.cabang_id ?? null,
        data.unit_usaha_id ?? null, tanggal, pokok, tenor, bunga, metode, data.tujuan || null,
        rupiah(pokok * produk.biaya_admin / 100), rupiah(pokok * produk.biaya_provisi / 100),
        h.total_bunga, h.jadwal[0].pokok, h.jadwal[0].bunga, h.angsuran_pertama,
        skoring.skor, skoring.rekomendasi],
    );
    for (const j of h.jadwal) {
      run(
        `INSERT INTO pinjaman_jadwal(pinjaman_id, angsuran_ke, jatuh_tempo, pokok, bunga, total, sisa_pokok)
         VALUES(?,?,?,?,?,?,?)`,
        [id, j.angsuran_ke, j.jatuh_tempo, j.pokok, j.bunga, j.total, j.sisa_pokok],
      );
    }
    for (const ag of data.agunan || []) {
      run(
        `INSERT INTO pinjaman_agunan(pinjaman_id, jenis, deskripsi, nomor_dokumen, nilai_taksiran, lokasi_simpan)
         VALUES(?,?,?,?,?,?)`,
        [id, ag.jenis, ag.deskripsi || null, ag.nomor_dokumen || null,
          rupiah(ag.nilai_taksiran || 0), ag.lokasi_simpan || null],
      );
    }
    if (produk.wajib_agunan && !(data.agunan || []).length) {
      throw badRequest(`Produk ${produk.nama} mewajibkan agunan`);
    }
    logAudit(ctx, { aksi: 'create', modul: 'pinjaman', entitas_id: id,
      keterangan: `Pengajuan ${nomor} a.n. ${anggota.nama} sebesar Rp ${pokok.toLocaleString('id-ID')}`,
      after: { nomor, pokok, tenor, skor: skoring.skor } });
    notify({ role: 'petugas_pinjaman', judul: 'Pengajuan pinjaman baru',
      pesan: `${nomor} a.n. ${anggota.nama} - Rp ${pokok.toLocaleString('id-ID')} (skor ${skoring.skor})`,
      tipe: 'info', link: `#/pinjaman/${id}` });
    return { id, nomor, skoring, ...h };
  });
}

/** Mencatat hasil survey / analisis. */
export function survey(id, { hasil_survey, catatan_analis }, ctx) {
  const p = get('SELECT * FROM pinjaman WHERE id = ?', [id]);
  if (!p) throw notFound('Pinjaman tidak ditemukan');
  if (!['diajukan', 'survey', 'dianalisis'].includes(p.status)) {
    throw conflict(`Pinjaman berstatus "${p.status}" tidak dapat disurvey`);
  }
  run("UPDATE pinjaman SET hasil_survey = ?, catatan_analis = ?, status = 'dianalisis' WHERE id = ?",
    [hasil_survey || null, catatan_analis || null, id]);
  logAudit(ctx, { aksi: 'update', modul: 'pinjaman', entitas_id: id,
    keterangan: `Survey/analisis ${p.nomor}`, before: { status: p.status }, after: { status: 'dianalisis' } });
  return get('SELECT * FROM pinjaman WHERE id = ?', [id]);
}

/** Menyetujui atau menolak pengajuan. */
export function putuskan(id, { setuju, alasan, pokok_disetujui, tenor_disetujui }, ctx) {
  const p = get('SELECT * FROM pinjaman WHERE id = ?', [id]);
  if (!p) throw notFound('Pinjaman tidak ditemukan');
  if (!['diajukan', 'survey', 'dianalisis'].includes(p.status)) {
    throw conflict(`Pinjaman berstatus "${p.status}" tidak dapat diputuskan lagi`);
  }
  return tx(() => {
    if (!setuju) {
      run("UPDATE pinjaman SET status = 'ditolak', alasan_tolak = ?, disetujui_oleh = ? WHERE id = ?",
        [alasan || 'Tidak memenuhi kriteria', ctx?.user?.username || 'sistem', id]);
      logAudit(ctx, { aksi: 'approve', modul: 'pinjaman', entitas_id: id,
        keterangan: `Pengajuan ${p.nomor} DITOLAK: ${alasan || '-'}` });
      return get('SELECT * FROM pinjaman WHERE id = ?', [id]);
    }
    // Bila plafon/tenor diubah saat persetujuan, jadwal dihitung ulang
    const pokok = pokok_disetujui ? rupiah(pokok_disetujui) : p.pokok;
    const tenor = tenor_disetujui ? Number(tenor_disetujui) : p.tenor;
    if (pokok !== p.pokok || tenor !== p.tenor) {
      const h = hitungJadwal({ pokok, tenor, bunga_tahunan: p.bunga_tahunan,
        metode: p.metode_bunga, tanggal_mulai: p.tanggal_pengajuan });
      run('DELETE FROM pinjaman_jadwal WHERE pinjaman_id = ?', [id]);
      for (const j of h.jadwal) {
        run(`INSERT INTO pinjaman_jadwal(pinjaman_id, angsuran_ke, jatuh_tempo, pokok, bunga, total, sisa_pokok)
             VALUES(?,?,?,?,?,?,?)`,
        [id, j.angsuran_ke, j.jatuh_tempo, j.pokok, j.bunga, j.total, j.sisa_pokok]);
      }
      run(`UPDATE pinjaman SET pokok = ?, tenor = ?, total_bunga = ?, angsuran_pokok = ?,
             angsuran_bunga = ?, angsuran_total = ? WHERE id = ?`,
      [pokok, tenor, h.total_bunga, h.jadwal[0].pokok, h.jadwal[0].bunga, h.angsuran_pertama, id]);
    }
    run(`UPDATE pinjaman SET status = 'disetujui', tanggal_persetujuan = ?, disetujui_oleh = ? WHERE id = ?`,
      [today(), ctx?.user?.username || 'sistem', id]);
    logAudit(ctx, { aksi: 'approve', modul: 'pinjaman', entitas_id: id,
      keterangan: `Pengajuan ${p.nomor} DISETUJUI sebesar Rp ${pokok.toLocaleString('id-ID')}` });
    notify({ role: 'bendahara', judul: 'Pinjaman siap dicairkan',
      pesan: `${p.nomor} telah disetujui`, tipe: 'success', link: `#/pinjaman/${id}` });
    return get('SELECT * FROM pinjaman WHERE id = ?', [id]);
  });
}

/** Status pengajuan yang belum dicairkan (belum ada jurnal) sehingga masih dapat dibatalkan. */
export const STATUS_BISA_BATAL = ['diajukan', 'survey', 'dianalisis', 'disetujui'];

/**
 * Membatalkan pengajuan yang belum dicairkan (mis. anggota mengurungkan
 * niat). Sebelum pencairan belum ada jurnal maupun blokir simpanan, jadi
 * cukup mengubah status, melepas agunan, dan menutup permintaan persetujuan.
 */
export function batalkan(id, { alasan }, ctx) {
  const p = get('SELECT * FROM pinjaman WHERE id = ?', [id]);
  if (!p) throw notFound('Pinjaman tidak ditemukan');
  if (!STATUS_BISA_BATAL.includes(p.status)) {
    throw conflict(`Pinjaman berstatus "${p.status}" tidak dapat dibatalkan`,
      'Hanya pengajuan yang belum dicairkan yang dapat dibatalkan. Pinjaman yang sudah cair '
      + 'diselesaikan melalui pelunasan atau restrukturisasi.');
  }
  if (!String(alasan || '').trim()) throw badRequest('Alasan pembatalan wajib diisi');
  const oleh = ctx?.user?.username || 'sistem';

  return tx(() => {
    run("UPDATE pinjaman SET status = 'batal', alasan_tolak = ? WHERE id = ?",
      [`Dibatalkan oleh ${oleh}: ${alasan}`, id]);
    // Agunan fisik dikembalikan kepada anggota
    run("UPDATE pinjaman_agunan SET status = 'dikembalikan' WHERE pinjaman_id = ? AND status = 'ditahan'", [id]);
    // Blokir simpanan agunan baru dipasang saat pencairan (lihat cairkan), jadi
    // tidak ada saldo yang perlu dilepas. Blokir yang ada pada rekening yang
    // sama sengaja tidak disentuh karena bisa milik pinjaman lain yang berjalan.
    // Permintaan persetujuan yang masih berjalan ikut ditutup
    const appr = all("SELECT id, nomor FROM approval_request WHERE modul = 'pinjaman' AND entitas_id = ? AND status = 'menunggu'", [id]);
    for (const r of appr) {
      run("UPDATE approval_request SET status = 'dibatalkan', selesai_at = datetime('now') WHERE id = ?", [r.id]);
      run("UPDATE approval_step SET status = 'dilewati' WHERE request_id = ? AND status = 'menunggu'", [r.id]);
    }
    logAudit(ctx, { aksi: 'void', modul: 'pinjaman', entitas_id: id,
      keterangan: `Pengajuan ${p.nomor} DIBATALKAN: ${alasan}`
        + (appr.length ? ` (persetujuan ${appr.map((r) => r.nomor).join(', ')} ditutup)` : ''),
      before: { status: p.status }, after: { status: 'batal', alasan } });
    return { ...get('SELECT * FROM pinjaman WHERE id = ?', [id]), approval_ditutup: appr.length };
  });
}

/**
 * Pencairan pinjaman.
 *
 * Jurnal:
 *   D  Piutang Pinjaman            (pokok)
 *      K  Kas/Bank                 (pokok - biaya)
 *      K  Pendapatan Administrasi  (biaya admin + provisi)
 */
export function cairkan(id, { tanggal, metode = 'tunai', bank_account_id, potong_biaya = true }, ctx) {
  const p = get(
    `SELECT p.*, a.nama AS anggota_nama, pr.coa_piutang, pr.coa_pendapatan_admin, pr.nama AS produk_nama
       FROM pinjaman p JOIN anggota a ON a.id = p.anggota_id
       JOIN produk_pinjaman pr ON pr.id = p.produk_id WHERE p.id = ?`, [id]);
  if (!p) throw notFound('Pinjaman tidak ditemukan');
  if (p.status !== 'disetujui') {
    throw conflict(`Hanya pinjaman berstatus "disetujui" yang dapat dicairkan (status saat ini: ${p.status})`);
  }
  const tgl = tanggal || today();

  return tx(() => {
    // Jadwal dihitung ulang dari tanggal pencairan agar jatuh tempo akurat
    const h = hitungJadwal({ pokok: p.pokok, tenor: p.tenor, bunga_tahunan: p.bunga_tahunan,
      metode: p.metode_bunga, tanggal_mulai: tgl });
    run('DELETE FROM pinjaman_jadwal WHERE pinjaman_id = ?', [id]);
    for (const j of h.jadwal) {
      run(`INSERT INTO pinjaman_jadwal(pinjaman_id, angsuran_ke, jatuh_tempo, pokok, bunga, total, sisa_pokok)
           VALUES(?,?,?,?,?,?,?)`,
      [id, j.angsuran_ke, j.jatuh_tempo, j.pokok, j.bunga, j.total, j.sisa_pokok]);
    }

    const biaya = potong_biaya ? p.biaya_admin + p.biaya_provisi : 0;
    const cair = p.pokok - biaya;
    const akunKas = akunKasMetode(metode, metode === 'transfer' ? bank_account_id : null);

    const lines = [
      { coa_kode: p.coa_piutang || AKUN.piutang_pinjaman(), debit: p.pokok, anggota_id: p.anggota_id,
        keterangan: `Pencairan ${p.nomor} - ${p.anggota_nama}` },
      { coa_kode: akunKas, kredit: cair, keterangan: `Pencairan ${p.nomor}` },
    ];
    if (biaya > 0) {
      lines.push({ coa_kode: p.coa_pendapatan_admin || AKUN.pendapatan_admin(), kredit: biaya,
        keterangan: `Biaya administrasi & provisi ${p.nomor}` });
    }
    const jurnal = postJournal({
      tanggal: tgl, tipe: 'pinjaman', referensi: `pinjaman:${id}`,
      keterangan: `Pencairan pinjaman ${p.nomor} a.n. ${p.anggota_nama}`,
      cabang_id: p.cabang_id, unit_usaha_id: p.unit_usaha_id, lines,
    }, ctx);

    run(`UPDATE pinjaman SET status = 'dicairkan', tanggal_cair = ?, outstanding_pokok = ?,
           outstanding_bunga = ?, total_bunga = ?, angsuran_pokok = ?, angsuran_bunga = ?,
           angsuran_total = ?, kolektibilitas = 1 WHERE id = ?`,
    [tgl, p.pokok, h.total_bunga, h.total_bunga, h.jadwal[0].pokok, h.jadwal[0].bunga, h.angsuran_pertama, id]);

    // Agunan berupa simpanan otomatis diblokir
    for (const ag of all("SELECT * FROM pinjaman_agunan WHERE pinjaman_id = ? AND jenis IN ('simpanan','deposito')", [id])) {
      const rek = get('SELECT id, saldo, saldo_blokir FROM rekening_simpanan WHERE nomor_rekening = ?', [ag.nomor_dokumen]);
      if (rek) setBlokir(rek.id, Math.min(rek.saldo, rek.saldo_blokir + ag.nilai_taksiran), ctx);
    }

    logAudit(ctx, { aksi: 'post', modul: 'pinjaman', entitas_id: id,
      keterangan: `Pencairan ${p.nomor} Rp ${cair.toLocaleString('id-ID')} (biaya Rp ${biaya.toLocaleString('id-ID')})`,
      after: { tanggal: tgl, cair, biaya } });
    return { pinjaman: get('SELECT * FROM pinjaman WHERE id = ?', [id]), jurnal, dicairkan: cair, biaya };
  });
}

/** Menghitung denda keterlambatan sampai tanggal tertentu. */
export function hitungDenda(pinjaman_id, sampai = today()) {
  const p = get(
    `SELECT p.*, pr.denda_harian FROM pinjaman p
       JOIN produk_pinjaman pr ON pr.id = p.produk_id WHERE p.id = ?`, [pinjaman_id]);
  if (!p || !p.denda_harian) return { total: 0, rincian: [] };
  const grace = settingNum('pinjaman.grace_period_hari', 3);
  const tunggak = all(
    `SELECT * FROM pinjaman_jadwal WHERE pinjaman_id = ? AND status <> 'lunas' AND jatuh_tempo < ?
      ORDER BY angsuran_ke`, [pinjaman_id, sampai]);
  const rincian = [];
  let total = 0;
  for (const t of tunggak) {
    const hari = diffDays(sampai, t.jatuh_tempo) - grace;
    if (hari <= 0) continue;
    const sisa = t.total - t.bayar_pokok - t.bayar_bunga;
    const denda = rupiah(sisa * (p.denda_harian / 100) * hari);
    if (denda <= 0) continue;
    total += denda;
    rincian.push({ angsuran_ke: t.angsuran_ke, jatuh_tempo: t.jatuh_tempo, hari_telat: hari, sisa, denda });
  }
  const sudahBayar = scalar("SELECT COALESCE(SUM(bayar_denda),0) FROM pinjaman_angsuran WHERE pinjaman_id = ? AND status <> 'batal'", [pinjaman_id]);
  return { total: Math.max(0, total - sudahBayar), total_bruto: total, sudah_dibayar: sudahBayar, rincian, grace_period: grace };
}

/**
 * Pembayaran angsuran.
 * Urutan alokasi pembayaran: denda → bunga → pokok (praktik lazim koperasi).
 */
export function bayarAngsuran({ pinjaman_id, tanggal, nominal, metode = 'tunai', bank_account_id, keterangan }, ctx) {
  const p = get(
    `SELECT p.*, a.nama AS anggota_nama, pr.coa_piutang, pr.coa_pendapatan_bunga, pr.coa_pendapatan_denda
       FROM pinjaman p JOIN anggota a ON a.id = p.anggota_id
       JOIN produk_pinjaman pr ON pr.id = p.produk_id WHERE p.id = ?`, [pinjaman_id]);
  if (!p) throw notFound('Pinjaman tidak ditemukan');
  if (!['dicairkan', 'restrukturisasi'].includes(p.status)) {
    throw conflict(`Pinjaman berstatus "${p.status}" tidak dapat menerima angsuran`);
  }
  let sisaBayar = rupiah(nominal);
  if (sisaBayar <= 0) throw badRequest('Nominal pembayaran harus lebih besar dari nol');
  const tgl = tanggal || today();

  return tx(() => {
    const denda = hitungDenda(pinjaman_id, tgl);
    let bayarDenda = 0;
    if (denda.total > 0) {
      bayarDenda = Math.min(denda.total, sisaBayar);
      sisaBayar -= bayarDenda;
    }

    let bayarPokok = 0;
    let bayarBunga = 0;
    let angsuranKe = null;
    const jadwal = all(
      "SELECT * FROM pinjaman_jadwal WHERE pinjaman_id = ? AND status <> 'lunas' ORDER BY angsuran_ke",
      [pinjaman_id],
    );
    for (const j of jadwal) {
      if (sisaBayar <= 0) break;
      if (angsuranKe === null) angsuranKe = j.angsuran_ke;
      const sisaBunga = j.bunga - j.bayar_bunga;
      const bB = Math.min(sisaBunga, sisaBayar);
      sisaBayar -= bB;
      const sisaPokok = j.pokok - j.bayar_pokok;
      const bP = Math.min(sisaPokok, sisaBayar);
      sisaBayar -= bP;
      bayarBunga += bB;
      bayarPokok += bP;
      const totalBayarJ = j.bayar_pokok + bP + j.bayar_bunga + bB;
      const statusJ = totalBayarJ >= j.total ? 'lunas' : totalBayarJ > 0 ? 'sebagian' : 'belum';
      run(`UPDATE pinjaman_jadwal SET bayar_pokok = ?, bayar_bunga = ?, status = ?,
             tanggal_bayar = CASE WHEN ? = 'lunas' THEN ? ELSE tanggal_bayar END WHERE id = ?`,
      [j.bayar_pokok + bP, j.bayar_bunga + bB, statusJ, statusJ, tgl, j.id]);
    }
    // Kelebihan bayar dialokasikan sebagai pelunasan pokok dipercepat
    if (sisaBayar > 0) {
      const outstanding = p.outstanding_pokok - bayarPokok;
      const extra = Math.min(sisaBayar, outstanding);
      bayarPokok += extra;
      sisaBayar -= extra;
      if (extra > 0) {
        // Kurangi pokok dari jadwal terakhir yang belum lunas
        let sisaExtra = extra;
        const belum = all("SELECT * FROM pinjaman_jadwal WHERE pinjaman_id = ? AND status <> 'lunas' ORDER BY angsuran_ke DESC", [pinjaman_id]);
        for (const j of belum) {
          if (sisaExtra <= 0) break;
          const sisaPokokJ = j.pokok - j.bayar_pokok;
          const amb = Math.min(sisaPokokJ, sisaExtra);
          sisaExtra -= amb;
          const totalBayarJ = j.bayar_pokok + amb + j.bayar_bunga;
          run("UPDATE pinjaman_jadwal SET bayar_pokok = ?, status = ? WHERE id = ?",
            [j.bayar_pokok + amb, totalBayarJ >= j.total ? 'lunas' : 'sebagian', j.id]);
        }
      }
    }
    if (sisaBayar > 0) {
      throw badRequest('Nominal pembayaran melebihi total kewajiban pinjaman',
        `Kelebihan Rp ${sisaBayar.toLocaleString('id-ID')}. Gunakan menu Pelunasan Dipercepat.`);
    }

    const totalBayar = bayarPokok + bayarBunga + bayarDenda;
    const akunKas = akunKasMetode(metode, metode === 'transfer' ? bank_account_id : null);
    const lines = [{ coa_kode: akunKas, debit: totalBayar, keterangan: `Angsuran ${p.nomor}` }];
    if (bayarPokok > 0) {
      lines.push({ coa_kode: p.coa_piutang || AKUN.piutang_pinjaman(), kredit: bayarPokok,
        anggota_id: p.anggota_id, keterangan: 'Angsuran pokok' });
    }
    if (bayarBunga > 0) {
      lines.push({ coa_kode: p.coa_pendapatan_bunga || AKUN.pendapatan_bunga(), kredit: bayarBunga,
        anggota_id: p.anggota_id, keterangan: 'Jasa pinjaman' });
    }
    if (bayarDenda > 0) {
      lines.push({ coa_kode: p.coa_pendapatan_denda || AKUN.pendapatan_denda(), kredit: bayarDenda,
        anggota_id: p.anggota_id, keterangan: 'Denda keterlambatan' });
    }
    const jurnal = postJournal({
      tanggal: tgl, tipe: 'pinjaman', referensi: `angsuran:${pinjaman_id}`,
      keterangan: `Angsuran ${p.nomor} a.n. ${p.anggota_nama}`,
      cabang_id: p.cabang_id, unit_usaha_id: p.unit_usaha_id, lines,
    }, ctx);

    const nomor = nextNumber('ANG', tgl);
    const { lastInsertRowid: angsuranId } = run(
      `INSERT INTO pinjaman_angsuran(nomor, pinjaman_id, tanggal, angsuran_ke, bayar_pokok, bayar_bunga,
        bayar_denda, total_bayar, metode, keterangan, jurnal_id, petugas, bank_account_id)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [nomor, pinjaman_id, tgl, angsuranKe, bayarPokok, bayarBunga, bayarDenda, totalBayar,
        metode, keterangan || null, jurnal.id, ctx?.user?.username || 'sistem',
        metode === 'transfer' ? bank_account_id || null : null],
    );

    const outPokok = p.outstanding_pokok - bayarPokok;
    const outBunga = Math.max(0, p.outstanding_bunga - bayarBunga);
    const lunas = outPokok <= 0;
    run(`UPDATE pinjaman SET outstanding_pokok = ?, outstanding_bunga = ?,
           status = CASE WHEN ? THEN 'lunas' ELSE status END,
           tanggal_lunas = CASE WHEN ? THEN ? ELSE tanggal_lunas END WHERE id = ?`,
    [Math.max(0, outPokok), outBunga, lunas ? 1 : 0, lunas ? 1 : 0, tgl, pinjaman_id]);
    if (lunas) {
      run("UPDATE pinjaman_agunan SET status = 'dikembalikan' WHERE pinjaman_id = ? AND status = 'ditahan'", [pinjaman_id]);
      for (const ag of all("SELECT * FROM pinjaman_agunan WHERE pinjaman_id = ? AND jenis IN ('simpanan','deposito')", [pinjaman_id])) {
        const rek = get('SELECT id FROM rekening_simpanan WHERE nomor_rekening = ?', [ag.nomor_dokumen]);
        if (rek) setBlokir(rek.id, 0, ctx);
      }
    }
    perbaruiKolektibilitas(pinjaman_id, tgl);

    logAudit(ctx, { aksi: 'create', modul: 'pinjaman', entitas_id: pinjaman_id,
      keterangan: `Angsuran ${nomor} Rp ${totalBayar.toLocaleString('id-ID')} untuk ${p.nomor}`,
      after: { bayarPokok, bayarBunga, bayarDenda, outstanding: Math.max(0, outPokok) } });
    return { id: angsuranId, nomor, bayar_pokok: bayarPokok, bayar_bunga: bayarBunga,
      bayar_denda: bayarDenda, total_bayar: totalBayar, outstanding_pokok: Math.max(0, outPokok), lunas, jurnal };
  });
}

/** Simulasi pelunasan dipercepat (pokok tersisa + bunga berjalan + denda). */
export function simulasiPelunasan(pinjaman_id, tanggal = today()) {
  const p = get('SELECT * FROM pinjaman WHERE id = ?', [pinjaman_id]);
  if (!p) throw notFound('Pinjaman tidak ditemukan');
  const denda = hitungDenda(pinjaman_id, tanggal);
  const belum = all("SELECT * FROM pinjaman_jadwal WHERE pinjaman_id = ? AND status <> 'lunas' ORDER BY angsuran_ke", [pinjaman_id]);
  const sisaPokok = belum.reduce((s, j) => s + (j.pokok - j.bayar_pokok), 0);
  // Bunga hanya ditagih untuk angsuran yang sudah jatuh tempo + angsuran berjalan
  const bungaTertagih = belum
    .filter((j) => j.jatuh_tempo <= tanggal || j.angsuran_ke === belum[0]?.angsuran_ke)
    .reduce((s, j) => s + (j.bunga - j.bayar_bunga), 0);
  const penalti = rupiah(sisaPokok * settingNum('pinjaman.penalti_pelunasan_persen', 1) / 100);
  return {
    tanggal, sisa_pokok: sisaPokok, bunga_berjalan: bungaTertagih, denda: denda.total,
    penalti_pelunasan: penalti,
    total: sisaPokok + bungaTertagih + denda.total + penalti,
    penghematan_bunga: belum.reduce((s, j) => s + (j.bunga - j.bayar_bunga), 0) - bungaTertagih,
  };
}

/** Pelunasan dipercepat. */
export function pelunasanDipercepat({ pinjaman_id, tanggal, metode = 'tunai', bank_account_id }, ctx) {
  const tgl = tanggal || today();
  const sim = simulasiPelunasan(pinjaman_id, tgl);
  const p = get(
    `SELECT p.*, a.nama AS anggota_nama, pr.coa_piutang, pr.coa_pendapatan_bunga, pr.coa_pendapatan_denda
       FROM pinjaman p JOIN anggota a ON a.id = p.anggota_id
       JOIN produk_pinjaman pr ON pr.id = p.produk_id WHERE p.id = ?`, [pinjaman_id]);
  if (!p) throw notFound('Pinjaman tidak ditemukan');
  if (p.status !== 'dicairkan' && p.status !== 'restrukturisasi') {
    throw conflict(`Pinjaman berstatus "${p.status}" tidak dapat dilunasi`);
  }

  return tx(() => {
    const akunKas = akunKasMetode(metode, metode === 'transfer' ? bank_account_id : null);
    const pendapatanLain = sim.bunga_berjalan + sim.penalti_pelunasan;
    const lines = [{ coa_kode: akunKas, debit: sim.total, keterangan: `Pelunasan ${p.nomor}` }];
    lines.push({ coa_kode: p.coa_piutang || AKUN.piutang_pinjaman(), kredit: sim.sisa_pokok,
      anggota_id: p.anggota_id, keterangan: 'Pelunasan pokok' });
    if (pendapatanLain > 0) {
      lines.push({ coa_kode: p.coa_pendapatan_bunga || AKUN.pendapatan_bunga(), kredit: pendapatanLain,
        anggota_id: p.anggota_id, keterangan: 'Jasa pinjaman & penalti pelunasan' });
    }
    if (sim.denda > 0) {
      lines.push({ coa_kode: p.coa_pendapatan_denda || AKUN.pendapatan_denda(), kredit: sim.denda,
        anggota_id: p.anggota_id, keterangan: 'Denda keterlambatan' });
    }
    const jurnal = postJournal({
      tanggal: tgl, tipe: 'pinjaman', referensi: `pelunasan:${pinjaman_id}`,
      keterangan: `Pelunasan dipercepat ${p.nomor} a.n. ${p.anggota_nama}`,
      cabang_id: p.cabang_id, unit_usaha_id: p.unit_usaha_id, lines,
    }, ctx);

    const nomor = nextNumber('ANG', tgl);
    run(`INSERT INTO pinjaman_angsuran(nomor, pinjaman_id, tanggal, bayar_pokok, bayar_bunga, bayar_denda,
           total_bayar, metode, jenis, keterangan, jurnal_id, petugas)
         VALUES(?,?,?,?,?,?,?,?,'pelunasan_dipercepat',?,?,?)`,
    [nomor, pinjaman_id, tgl, sim.sisa_pokok, pendapatanLain, sim.denda, sim.total, metode,
      `Pelunasan dipercepat (hemat bunga Rp ${sim.penghematan_bunga.toLocaleString('id-ID')})`,
      jurnal.id, ctx?.user?.username || 'sistem']);

    run(`UPDATE pinjaman_jadwal SET bayar_pokok = pokok, bayar_bunga = bunga, status = 'lunas',
           tanggal_bayar = ? WHERE pinjaman_id = ? AND status <> 'lunas'`, [tgl, pinjaman_id]);
    run(`UPDATE pinjaman SET status = 'lunas', tanggal_lunas = ?, outstanding_pokok = 0,
           outstanding_bunga = 0, kolektibilitas = 1, tunggakan_hari = 0 WHERE id = ?`, [tgl, pinjaman_id]);
    run("UPDATE pinjaman_agunan SET status = 'dikembalikan' WHERE pinjaman_id = ?", [pinjaman_id]);
    for (const ag of all("SELECT * FROM pinjaman_agunan WHERE pinjaman_id = ? AND jenis IN ('simpanan','deposito')", [pinjaman_id])) {
      const rek = get('SELECT id FROM rekening_simpanan WHERE nomor_rekening = ?', [ag.nomor_dokumen]);
      if (rek) setBlokir(rek.id, 0, ctx);
    }
    logAudit(ctx, { aksi: 'create', modul: 'pinjaman', entitas_id: pinjaman_id,
      keterangan: `Pelunasan dipercepat ${p.nomor} Rp ${sim.total.toLocaleString('id-ID')}`, after: sim });
    return { nomor, ...sim, jurnal };
  });
}

/**
 * Restrukturisasi: pinjaman lama ditutup, saldo dialihkan ke pinjaman baru
 * dengan tenor / bunga baru (tanpa arus kas).
 */
export function restrukturisasi({ pinjaman_id, tenor_baru, bunga_baru, tanggal, alasan }, ctx) {
  const lama = get(
    `SELECT p.*, a.nama AS anggota_nama, pr.coa_piutang, pr.coa_pendapatan_denda
       FROM pinjaman p JOIN anggota a ON a.id = p.anggota_id
       JOIN produk_pinjaman pr ON pr.id = p.produk_id WHERE p.id = ?`,
    [pinjaman_id]);
  if (!lama) throw notFound('Pinjaman tidak ditemukan');
  if (lama.status !== 'dicairkan') throw conflict('Hanya pinjaman berjalan yang dapat direstrukturisasi');
  const tgl = tanggal || today();
  const denda = hitungDenda(pinjaman_id, tgl);
  const pokokBaru = lama.outstanding_pokok + denda.total;
  const bunga = bunga_baru ?? lama.bunga_tahunan;

  return tx(() => {
    const h = hitungJadwal({ pokok: pokokBaru, tenor: tenor_baru, bunga_tahunan: bunga,
      metode: lama.metode_bunga, tanggal_mulai: tgl });
    const nomor = nextNumber('PJM', tgl);
    const { lastInsertRowid: id } = run(
      `INSERT INTO pinjaman(nomor, anggota_id, produk_id, cabang_id, unit_usaha_id, tanggal_pengajuan,
        tanggal_persetujuan, tanggal_cair, pokok, tenor, bunga_tahunan, metode_bunga, tujuan,
        total_bunga, angsuran_pokok, angsuran_bunga, angsuran_total, outstanding_pokok, outstanding_bunga,
        status, restruktur_dari, disetujui_oleh, catatan_analis)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'dicairkan',?,?,?)`,
      [nomor, lama.anggota_id, lama.produk_id, lama.cabang_id, lama.unit_usaha_id, tgl, tgl, tgl,
        pokokBaru, tenor_baru, bunga, lama.metode_bunga, `Restrukturisasi dari ${lama.nomor}`,
        h.total_bunga, h.jadwal[0].pokok, h.jadwal[0].bunga, h.angsuran_pertama, pokokBaru, h.total_bunga,
        pinjaman_id, ctx?.user?.username || 'sistem', alasan || null],
    );
    for (const j of h.jadwal) {
      run(`INSERT INTO pinjaman_jadwal(pinjaman_id, angsuran_ke, jatuh_tempo, pokok, bunga, total, sisa_pokok)
           VALUES(?,?,?,?,?,?,?)`,
      [id, j.angsuran_ke, j.jatuh_tempo, j.pokok, j.bunga, j.total, j.sisa_pokok]);
    }
    run(`UPDATE pinjaman SET status = 'restrukturisasi', outstanding_pokok = 0, outstanding_bunga = 0,
           tanggal_lunas = ? WHERE id = ?`, [tgl, pinjaman_id]);
    run("UPDATE pinjaman_jadwal SET status = 'lunas' WHERE pinjaman_id = ? AND status <> 'lunas'", [pinjaman_id]);

    // Denda yang dikapitalisasi diakui sebagai pendapatan sekaligus menambah piutang
    if (denda.total > 0) {
      postJournal({
        tanggal: tgl, tipe: 'pinjaman', referensi: `restrukturisasi:${id}`,
        keterangan: `Kapitalisasi denda restrukturisasi ${lama.nomor} → ${nomor}`,
        cabang_id: lama.cabang_id,
        lines: [
          { coa_kode: lama.coa_piutang || AKUN.piutang_pinjaman(), debit: denda.total, anggota_id: lama.anggota_id },
          { coa_kode: lama.coa_pendapatan_denda || AKUN.pendapatan_denda(), kredit: denda.total,
            anggota_id: lama.anggota_id },
        ],
      }, ctx);
    }
    logAudit(ctx, { aksi: 'update', modul: 'pinjaman', entitas_id: id,
      keterangan: `Restrukturisasi ${lama.nomor} → ${nomor} (pokok Rp ${pokokBaru.toLocaleString('id-ID')}, ${tenor_baru} bulan)`,
      before: { nomor: lama.nomor, outstanding: lama.outstanding_pokok },
      after: { nomor, pokok: pokokBaru, tenor: tenor_baru, alasan } });
    return { id, nomor, pokok: pokokBaru, tenor: tenor_baru, denda_dikapitalisasi: denda.total, jadwal: h.jadwal };
  });
}

/**
 * Klasifikasi kolektibilitas berdasarkan hari tunggakan
 * (mengacu pada pedoman penilaian kesehatan KSP):
 *   1 Lancar (0 hari) | 2 Dalam Perhatian Khusus (1-90) | 3 Kurang Lancar (91-180)
 *   4 Diragukan (181-270) | 5 Macet (>270)
 */
export function perbaruiKolektibilitas(pinjaman_id, sampai = today()) {
  const tertunggak = get(
    `SELECT MIN(jatuh_tempo) AS paling_lama FROM pinjaman_jadwal
      WHERE pinjaman_id = ? AND status <> 'lunas' AND jatuh_tempo < ?`,
    [pinjaman_id, sampai],
  );
  const hari = tertunggak?.paling_lama ? diffDays(sampai, tertunggak.paling_lama) : 0;
  const kol = hari === 0 ? 1 : hari <= 90 ? 2 : hari <= 180 ? 3 : hari <= 270 ? 4 : 5;
  run('UPDATE pinjaman SET tunggakan_hari = ?, kolektibilitas = ? WHERE id = ?', [Math.max(0, hari), kol, pinjaman_id]);
  return { tunggakan_hari: Math.max(0, hari), kolektibilitas: kol };
}

/** Menjalankan pembaruan kolektibilitas untuk seluruh pinjaman berjalan. */
export function refreshSemuaKolektibilitas(sampai = today()) {
  const list = all("SELECT id FROM pinjaman WHERE status IN ('dicairkan','restrukturisasi')");
  for (const p of list) perbaruiKolektibilitas(p.id, sampai);
  return { diproses: list.length };
}

export const LABEL_KOLEKTIBILITAS = {
  1: 'Lancar', 2: 'Dalam Perhatian Khusus', 3: 'Kurang Lancar', 4: 'Diragukan', 5: 'Macet',
};

/** Daftar tagihan jatuh tempo untuk penagihan (collection). */
export function daftarTagihan({ sampai = today(), hari_kedepan = 7 } = {}) {
  const batas = new Date(`${sampai}T00:00:00Z`);
  batas.setUTCDate(batas.getUTCDate() + hari_kedepan);
  return all(
    `SELECT j.*, p.nomor AS nomor_pinjaman, p.kolektibilitas, p.tunggakan_hari,
            a.nama AS anggota_nama, a.telepon, a.id AS anggota_id
       FROM pinjaman_jadwal j
       JOIN pinjaman p ON p.id = j.pinjaman_id
       JOIN anggota a ON a.id = p.anggota_id
      WHERE j.status <> 'lunas' AND p.status IN ('dicairkan','restrukturisasi')
        AND j.jatuh_tempo <= ?
      ORDER BY j.jatuh_tempo, a.nama`,
    [batas.toISOString().slice(0, 10)],
  ).map((r) => ({
    ...r,
    sisa_tagihan: r.total - r.bayar_pokok - r.bayar_bunga,
    hari_telat: Math.max(0, diffDays(sampai, r.jatuh_tempo)),
    kategori: diffDays(sampai, r.jatuh_tempo) > 0 ? 'tertunggak' : 'akan_jatuh_tempo',
  }));
}

/** Statistik NPL & portofolio pinjaman. */
export function statistikPortofolio() {
  const rows = all(
    `SELECT kolektibilitas, COUNT(*) AS jumlah, COALESCE(SUM(outstanding_pokok),0) AS nominal
       FROM pinjaman WHERE status IN ('dicairkan','restrukturisasi') GROUP BY kolektibilitas`,
  );
  const total = rows.reduce((s, r) => s + r.nominal, 0);
  const npl = rows.filter((r) => r.kolektibilitas >= 3).reduce((s, r) => s + r.nominal, 0);
  return {
    per_kolektibilitas: [1, 2, 3, 4, 5].map((k) => {
      const f = rows.find((r) => r.kolektibilitas === k);
      return { kolektibilitas: k, label: LABEL_KOLEKTIBILITAS[k],
        jumlah: f?.jumlah || 0, nominal: f?.nominal || 0,
        persen: total ? Number(((f?.nominal || 0) / total * 100).toFixed(2)) : 0 };
    }),
    total_outstanding: total,
    npl_nominal: npl,
    npl_ratio: total ? Number(((npl / total) * 100).toFixed(2)) : 0,
    status_kesehatan: total === 0 ? 'belum ada pinjaman'
      : (npl / total) * 100 < 5 ? 'sehat' : (npl / total) * 100 < 10 ? 'cukup sehat' : 'perlu perhatian',
  };
}
