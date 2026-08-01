/**
 * Mesin akuntansi double entry (Permenkop UKM No. 2/2024 & SAK EP).
 *
 * SELURUH modul finansial memposting melalui postJournal() sehingga
 * buku besar selalu menjadi sumber kebenaran tunggal (single source of truth).
 */
import { all, get, run, scalar, nextNumber, tx, setting } from '../db.js';
import { AppError, badRequest, notFound, conflict } from '../lib/http.js';
import { logAudit } from '../lib/audit.js';
import { rupiah, yearOf, monthOf, endOfMonth } from '../lib/util.js';

/** Akun default yang dipakai lintas modul; dapat diubah lewat modul Administrator. */
export const AKUN = {
  kas: () => setting('coa.kas', '1-1101'),
  bank: () => setting('coa.bank', '1-1201'),
  piutang_usaha: () => setting('coa.piutang_usaha', '1-1301'),
  piutang_pinjaman: () => setting('coa.piutang_pinjaman', '1-1310'),
  cadangan_kerugian: () => setting('coa.cadangan_kerugian', '1-1319'),
  persediaan: () => setting('coa.persediaan', '1-1401'),
  hutang_usaha: () => setting('coa.hutang_usaha', '2-1101'),
  hutang_pajak: () => setting('coa.hutang_pajak', '2-1301'),
  shu_dibagikan: () => setting('coa.shu_dibagikan', '2-1401'),
  simpanan_pokok: () => setting('coa.simpanan_pokok', '3-1101'),
  simpanan_wajib: () => setting('coa.simpanan_wajib', '3-1102'),
  cadangan: () => setting('coa.cadangan', '3-1201'),
  shu_berjalan: () => setting('coa.shu_berjalan', '3-1301'),
  shu_ditahan: () => setting('coa.shu_ditahan', '3-1302'),
  penjualan: () => setting('coa.penjualan', '4-1101'),
  pendapatan_bunga: () => setting('coa.pendapatan_bunga', '4-1201'),
  pendapatan_admin: () => setting('coa.pendapatan_admin', '4-1202'),
  pendapatan_denda: () => setting('coa.pendapatan_denda', '4-1203'),
  pendapatan_lain: () => setting('coa.pendapatan_lain', '4-1301'),
  hpp: () => setting('coa.hpp', '5-1101'),
  beban_bunga_simpanan: () => setting('coa.beban_bunga_simpanan', '5-2101'),
  beban_penyusutan: () => setting('coa.beban_penyusutan', '5-2301'),
  beban_selisih: () => setting('coa.beban_selisih', '5-2901'),
  beban_lain: () => setting('coa.beban_lain', '5-2902'),
};

/** Memastikan periode akuntansi tanggal tersebut masih terbuka. */
export function assertPeriodeTerbuka(tanggal) {
  const p = get('SELECT status FROM periode_akuntansi WHERE tahun = ? AND bulan = ?',
    [yearOf(tanggal), monthOf(tanggal)]);
  if (p && p.status === 'tutup') {
    throw conflict(`Periode ${tanggal.slice(0, 7)} sudah ditutup`,
      'Buka kembali periode melalui modul Akuntansi bila koreksi memang diperlukan.');
  }
}

function assertAkun(kode) {
  const akun = get('SELECT kode, nama, is_postable, status FROM coa WHERE kode = ?', [kode]);
  if (!akun) throw badRequest(`Akun ${kode} tidak terdaftar dalam bagan akun`);
  if (!akun.is_postable) throw badRequest(`Akun ${kode} - ${akun.nama} adalah akun induk dan tidak dapat dijurnal`);
  if (akun.status !== 'aktif') throw badRequest(`Akun ${kode} - ${akun.nama} tidak aktif`);
  return akun;
}

/**
 * Memposting jurnal. Wajib seimbang (total debit = total kredit).
 *
 * @param {object} j
 * @param {string} j.tanggal
 * @param {string} j.tipe
 * @param {Array<{coa_kode, debit?, kredit?, keterangan?, unit_usaha_id?, cabang_id?, anggota_id?}>} j.lines
 * @returns {{id:number, nomor:string, total:number}}
 */
export function postJournal(j, ctx = null) {
  const tanggal = j.tanggal;
  if (!tanggal) throw badRequest('Tanggal jurnal wajib diisi');
  assertPeriodeTerbuka(tanggal);

  const lines = (j.lines || [])
    .map((l) => ({
      coa_kode: String(l.coa_kode || '').trim(),
      debit: rupiah(l.debit || 0),
      kredit: rupiah(l.kredit || 0),
      keterangan: l.keterangan || null,
      cabang_id: l.cabang_id ?? j.cabang_id ?? null,
      unit_usaha_id: l.unit_usaha_id ?? j.unit_usaha_id ?? null,
      anggota_id: l.anggota_id ?? null,
    }))
    .filter((l) => l.debit !== 0 || l.kredit !== 0);

  if (lines.length < 2) throw badRequest('Jurnal minimal terdiri dari 2 baris (debit dan kredit)');

  let totalD = 0;
  let totalK = 0;
  for (const l of lines) {
    if (l.debit < 0 || l.kredit < 0) throw badRequest('Nilai debit/kredit tidak boleh negatif');
    if (l.debit > 0 && l.kredit > 0) {
      throw badRequest(`Baris akun ${l.coa_kode} tidak boleh diisi debit dan kredit sekaligus`);
    }
    assertAkun(l.coa_kode);
    totalD += l.debit;
    totalK += l.kredit;
  }
  if (totalD !== totalK) {
    throw badRequest('Jurnal tidak seimbang',
      `Total debit ${totalD.toLocaleString('id-ID')} tidak sama dengan total kredit ${totalK.toLocaleString('id-ID')}`);
  }
  if (totalD === 0) throw badRequest('Nilai jurnal tidak boleh nol');

  return tx(() => {
    const nomor = j.nomor || nextNumber(prefixOf(j.tipe), tanggal);
    const { lastInsertRowid: id } = run(
      `INSERT INTO jurnal(nomor, tanggal, tipe, referensi, keterangan, cabang_id, unit_usaha_id,
                          total_debit, total_kredit, status, dibuat_oleh)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      [nomor, tanggal, j.tipe || 'umum', j.referensi || null, j.keterangan || null,
        j.cabang_id ?? null, j.unit_usaha_id ?? null, totalD, totalK,
        j.status || 'posted', ctx?.user?.username || 'sistem'],
    );
    lines.forEach((l, i) => {
      run(
        `INSERT INTO jurnal_detail(jurnal_id, coa_kode, debit, kredit, keterangan,
                                   cabang_id, unit_usaha_id, anggota_id, urut)
         VALUES(?,?,?,?,?,?,?,?,?)`,
        [id, l.coa_kode, l.debit, l.kredit, l.keterangan, l.cabang_id, l.unit_usaha_id, l.anggota_id, i + 1],
      );
    });
    logAudit(ctx, {
      aksi: 'post', modul: 'akuntansi', entitas_id: id,
      keterangan: `Jurnal ${nomor} - ${j.keterangan || j.tipe} sebesar ${totalD}`,
      after: { nomor, tanggal, total: totalD, lines },
    });
    return { id, nomor, total: totalD };
  });
}

function prefixOf(tipe) {
  return {
    kas_masuk: 'BKM', kas_keluar: 'BKK', simpanan: 'JSP', pinjaman: 'JPJ',
    penjualan: 'JPN', pembelian: 'JPB', penyusutan: 'JPY', penutup: 'JTP',
    pembuka: 'JBK', shu: 'JSHU', penyesuaian: 'JPS',
  }[tipe] || 'JV';
}

/**
 * Membatalkan jurnal dengan membuat jurnal balik (reversing entry).
 * Jurnal asli tidak dihapus - prinsip audit trail yang tidak dapat disangkal.
 */
export function voidJournal(jurnalId, alasan, ctx) {
  const j = get('SELECT * FROM jurnal WHERE id = ?', [jurnalId]);
  if (!j) throw notFound('Jurnal tidak ditemukan');
  if (j.status === 'void') throw conflict('Jurnal ini sudah dibatalkan');
  const lines = all('SELECT * FROM jurnal_detail WHERE jurnal_id = ? ORDER BY urut', [jurnalId]);

  return tx(() => {
    const balik = postJournal({
      tanggal: j.tanggal,
      tipe: j.tipe,
      referensi: `void:${j.id}`,
      keterangan: `PEMBATALAN ${j.nomor} - ${alasan}`,
      cabang_id: j.cabang_id,
      unit_usaha_id: j.unit_usaha_id,
      lines: lines.map((l) => ({ ...l, debit: l.kredit, kredit: l.debit })),
    }, ctx);
    run('UPDATE jurnal SET status = ?, void_alasan = ? WHERE id = ?', ['void', alasan, jurnalId]);
    logAudit(ctx, {
      aksi: 'void', modul: 'akuntansi', entitas_id: jurnalId,
      keterangan: `Jurnal ${j.nomor} dibatalkan: ${alasan}`, before: j,
    });
    return balik;
  });
}

// ------------------------------ Pelaporan ------------------------------

/**
 * Jurnal yang diperhitungkan dalam buku besar.
 *
 * Jurnal berstatus 'void' TETAP diikutsertakan karena pembatalan dilakukan
 * dengan membuat jurnal balik (reversing entry), bukan dengan menghapus data -
 * lihat voidJournal(). Bila jurnal asli dikeluarkan sekaligus jurnal baliknya
 * diposting, dampaknya akan terhitung dua kali dengan arah berlawanan.
 * Hanya jurnal 'draft' yang belum berpengaruh pada buku besar.
 */
const WHERE_POSTED = "j.status IN ('posted','void')";

function filterSql(f = {}) {
  const w = [WHERE_POSTED];
  const p = [];
  // Jurnal penutup memindahkan seluruh saldo pendapatan dan beban ke ekuitas.
  // Untuk laporan posisi keuangan pemindahan itu memang harus ikut terhitung,
  // tetapi untuk laporan hasil usaha tidak: kalau ikut, tahun buku yang sudah
  // ditutup akan tersaji berpendapatan nol dan berbeban nol - dan seluruh
  // turunannya (rasio, realisasi anggaran, dasar pembagian SHU) ikut nol.
  if (f.tanpa_penutup) w.push("j.tipe <> 'penutup'");
  if (f.dari) { w.push('j.tanggal >= ?'); p.push(f.dari); }
  if (f.sampai) { w.push('j.tanggal <= ?'); p.push(f.sampai); }
  if (f.cabang_id) { w.push('COALESCE(d.cabang_id, j.cabang_id) = ?'); p.push(Number(f.cabang_id)); }
  if (f.unit_usaha_id) { w.push('COALESCE(d.unit_usaha_id, j.unit_usaha_id) = ?'); p.push(Number(f.unit_usaha_id)); }
  return { where: w.join(' AND '), params: p };
}

/** Saldo satu akun pada rentang tanggal. */
export function saldoAkun(kode, f = {}) {
  const { where, params } = filterSql(f);
  const row = get(
    `SELECT COALESCE(SUM(d.debit),0) AS debit, COALESCE(SUM(d.kredit),0) AS kredit
       FROM jurnal_detail d JOIN jurnal j ON j.id = d.jurnal_id
      WHERE ${where} AND d.coa_kode = ?`,
    [...params, kode],
  );
  const akun = get('SELECT saldo_normal FROM coa WHERE kode = ?', [kode]);
  const debit = row?.debit || 0;
  const kredit = row?.kredit || 0;
  const saldo = akun?.saldo_normal === 'K' ? kredit - debit : debit - kredit;
  return { kode, debit, kredit, saldo };
}

/** Neraca saldo (trial balance). */
export function trialBalance(f = {}) {
  const { where, params } = filterSql(f);
  // Penjumlahan mutasi dilakukan di subkueri ber-INNER JOIN agar filter periode
  // benar-benar menyaring baris. Bila filter diletakkan pada klausa ON sebuah
  // LEFT JOIN, baris jurnal di luar periode tetap ikut terjumlah - laporan akan
  // selalu menampilkan angka sepanjang masa.
  const rowsData = all(
    `SELECT c.kode, c.nama, c.tipe, c.saldo_normal,
            COALESCE(m.debit, 0)  AS debit,
            COALESCE(m.kredit, 0) AS kredit
       FROM coa c
       LEFT JOIN (
         SELECT d.coa_kode,
                SUM(d.debit)  AS debit,
                SUM(d.kredit) AS kredit
           FROM jurnal_detail d
           JOIN jurnal j ON j.id = d.jurnal_id
          WHERE ${where}
          GROUP BY d.coa_kode
       ) m ON m.coa_kode = c.kode
      WHERE c.is_postable = 1
      ORDER BY c.kode`,
    params,
  ).map((r) => {
    const saldo = r.saldo_normal === 'K' ? r.kredit - r.debit : r.debit - r.kredit;
    return { ...r, saldo, saldo_debit: saldo > 0 && r.saldo_normal === 'D' ? saldo : 0,
      saldo_kredit: saldo > 0 && r.saldo_normal === 'K' ? saldo : 0 };
  });
  const aktif = rowsData.filter((r) => r.debit || r.kredit);
  return {
    baris: aktif,
    total_debit: aktif.reduce((s, r) => s + r.debit, 0),
    total_kredit: aktif.reduce((s, r) => s + r.kredit, 0),
  };
}

/** Buku besar satu akun (dengan saldo berjalan). */
export function bukuBesar(kode, f = {}) {
  const akun = get('SELECT * FROM coa WHERE kode = ?', [kode]);
  if (!akun) throw notFound(`Akun ${kode} tidak ditemukan`);
  const awal = f.dari ? saldoAkun(kode, { sampai: prevDay(f.dari), cabang_id: f.cabang_id, unit_usaha_id: f.unit_usaha_id }).saldo : 0;
  const { where, params } = filterSql(f);
  const mutasi = all(
    `SELECT j.id AS jurnal_id, j.nomor, j.tanggal, j.tipe, j.keterangan AS jurnal_ket,
            d.debit, d.kredit, d.keterangan
       FROM jurnal_detail d JOIN jurnal j ON j.id = d.jurnal_id
      WHERE ${where} AND d.coa_kode = ?
      ORDER BY j.tanggal, j.id, d.urut`,
    [...params, kode],
  );
  let saldo = awal;
  const baris = mutasi.map((m) => {
    saldo += akun.saldo_normal === 'K' ? m.kredit - m.debit : m.debit - m.kredit;
    return { ...m, saldo };
  });
  return { akun, saldo_awal: awal, baris, saldo_akhir: saldo };
}

const prevDay = (d) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
};

/**
 * Laporan Laba Rugi (Perhitungan Hasil Usaha).
 *
 * Jurnal penutup selalu dikeluarkan: yang ingin dibaca adalah hasil usaha
 * periode tersebut, bukan sisa saldo akun nominal sesudah dipindahkan ke
 * ekuitas. Tanpa ini, laporan tahun buku yang sudah ditutup akan nol.
 */
export function labaRugi(f = {}) {
  const tb = trialBalance({ ...f, tanpa_penutup: true });
  const pendapatan = tb.baris.filter((r) => r.tipe === 'pendapatan');
  const beban = tb.baris.filter((r) => r.tipe === 'beban');
  const totalPendapatan = pendapatan.reduce((s, r) => s + r.saldo, 0);
  const totalBeban = beban.reduce((s, r) => s + r.saldo, 0);
  const hpp = beban.filter((r) => r.kode.startsWith('5-1')).reduce((s, r) => s + r.saldo, 0);
  const operasional = totalBeban - hpp;
  return {
    periode: { dari: f.dari, sampai: f.sampai },
    pendapatan, beban,
    total_pendapatan: totalPendapatan,
    hpp,
    laba_kotor: totalPendapatan - hpp,
    beban_operasional: operasional,
    total_beban: totalBeban,
    shu_sebelum_pajak: totalPendapatan - totalBeban,
    shu_bersih: totalPendapatan - totalBeban,
  };
}

/**
 * Nilai hasil usaha satu tahun buku yang sudah dipindahkan ke akun SHU Tahun
 * Berjalan melalui jurnal penutup, sampai dengan tanggal tertentu.
 */
function labaDipindahKeEkuitas(tahun, sampai, f = {}) {
  const { where, params } = filterSql({
    dari: `${tahun}-01-01`, sampai, cabang_id: f.cabang_id, unit_usaha_id: f.unit_usaha_id,
  });
  const row = get(
    `SELECT COALESCE(SUM(d.kredit), 0) - COALESCE(SUM(d.debit), 0) AS n
       FROM jurnal_detail d JOIN jurnal j ON j.id = d.jurnal_id
      WHERE ${where} AND j.tipe = 'penutup' AND d.coa_kode = ?`,
    [...params, AKUN.shu_berjalan()],
  );
  return row?.n || 0;
}

/** Neraca (Laporan Posisi Keuangan). */
export function neraca(f = {}) {
  const sampai = f.sampai || new Date().toISOString().slice(0, 10);
  const tb = trialBalance({ ...f, dari: null, sampai });
  const aset = tb.baris.filter((r) => r.tipe === 'aset');
  const kewajiban = tb.baris.filter((r) => r.tipe === 'kewajiban');
  const ekuitas = tb.baris.filter((r) => r.tipe === 'ekuitas');
  const totalAset = aset.reduce((s, r) => s + r.saldo, 0);
  const totalKewajiban = kewajiban.reduce((s, r) => s + r.saldo, 0);
  const totalEkuitasTercatat = ekuitas.reduce((s, r) => s + r.saldo, 0);

  // Hasil usaha tahun berjalan adalah bagian dari ekuitas walaupun belum
  // dipindahkan lewat jurnal penutup. Begitu jurnal penutup dibuat, nilainya
  // sudah duduk pada akun SHU Tahun Berjalan dan ikut terhitung pada
  // totalEkuitasTercatat - karena itu bagian yang sudah dipindahkan dikurangkan
  // kembali, supaya tidak terhitung dua kali dan neraca tetap seimbang.
  const lr = labaRugi({ ...f, dari: `${sampai.slice(0, 4)}-01-01`, sampai });
  const sudahDitutup = labaDipindahKeEkuitas(sampai.slice(0, 4), sampai, f);
  const totalEkuitas = totalEkuitasTercatat + lr.shu_bersih - sudahDitutup;
  return {
    per_tanggal: sampai,
    aset, kewajiban, ekuitas,
    shu_berjalan: lr.shu_bersih,
    total_aset: totalAset,
    total_kewajiban: totalKewajiban,
    total_ekuitas: totalEkuitas,
    total_pasiva: totalKewajiban + totalEkuitas,
    seimbang: totalAset === totalKewajiban + totalEkuitas,
    selisih: totalAset - (totalKewajiban + totalEkuitas),
  };
}

/** Laporan Arus Kas (metode langsung, berbasis mutasi akun kas & bank). */
export function arusKas(f = {}) {
  const kasAkun = all("SELECT kode FROM coa WHERE is_kas = 1 OR is_bank = 1").map((r) => r.kode);
  if (!kasAkun.length) return { operasi: [], investasi: [], pendanaan: [], saldo_awal: 0, saldo_akhir: 0 };
  const ph = kasAkun.map(() => '?').join(',');

  const saldoAwal = f.dari
    ? kasAkun.reduce((s, k) => s + saldoAkun(k, { sampai: prevDay(f.dari) }).saldo, 0)
    : 0;

  const { where, params } = filterSql(f);

  // Pergerakan kas bersih PER JURNAL. Dihitung per jurnal (bukan per pasangan
  // baris) agar satu baris kas tidak terhitung berulang ketika jurnal memiliki
  // banyak akun lawan - misalnya jurnal penjualan yang sekaligus mencatat
  // pendapatan, PPN, HPP, dan persediaan.
  const arusPerJurnal = all(
    `SELECT j.id, SUM(d.debit - d.kredit) AS arus
       FROM jurnal_detail d JOIN jurnal j ON j.id = d.jurnal_id
      WHERE ${where} AND d.coa_kode IN (${ph})
      GROUP BY j.id HAVING arus <> 0`,
    [...params, ...kasAkun],
  );
  if (!arusPerJurnal.length) {
    return { operasi: [], investasi: [], pendanaan: [], arus_operasi: 0, arus_investasi: 0,
      arus_pendanaan: 0, kenaikan_kas: 0, saldo_awal: saldoAwal, saldo_akhir: saldoAwal };
  }

  // Akun lawan (non-kas) pada jurnal-jurnal tersebut.
  const lawan = all(
    `SELECT d.jurnal_id, d.coa_kode, c.nama, c.tipe, SUM(d.debit + d.kredit) AS nilai
       FROM jurnal_detail d JOIN jurnal j ON j.id = d.jurnal_id
       JOIN coa c ON c.kode = d.coa_kode
      WHERE ${where} AND d.coa_kode NOT IN (${ph})
      GROUP BY d.jurnal_id, d.coa_kode, c.nama, c.tipe`,
    [...params, ...kasAkun],
  );
  const perJurnal = new Map();
  for (const l of lawan) {
    const arr = perJurnal.get(l.jurnal_id);
    if (arr) arr.push(l); else perJurnal.set(l.jurnal_id, [l]);
  }

  /**
   * Klasifikasi PSAK 2 / SAK EP:
   *   investasi - perolehan & pelepasan aset tetap
   *   pendanaan - simpanan anggota, modal, dan pinjaman jangka panjang
   *   operasi   - selebihnya (penjualan, pembelian, beban, jasa pinjaman)
   */
  const klasifikasi = (kode, tipe) => {
    if (kode.startsWith('1-15') || kode.startsWith('1-16')) return 'investasi';
    if (tipe === 'ekuitas' || kode.startsWith('2-12') || kode.startsWith('2-2')) return 'pendanaan';
    return 'operasi';
  };

  // Setiap jurnal diklasifikasikan berdasarkan akun lawan bernilai terbesar,
  // sehingga penjumlahan seluruh kelompok selalu sama dengan mutasi kas riil.
  const akumulasi = new Map();
  const grup = { operasi: 0, investasi: 0, pendanaan: 0 };
  for (const j of arusPerJurnal) {
    const kandidat = perJurnal.get(j.id) || [];
    if (!kandidat.length) continue;
    const utama = kandidat.reduce((a, b) => (b.nilai > a.nilai ? b : a));
    const kel = klasifikasi(utama.coa_kode, utama.tipe);
    grup[kel] += j.arus;
    const kunci = `${kel}|${utama.coa_kode}`;
    const ada = akumulasi.get(kunci);
    if (ada) ada.arus += j.arus;
    else akumulasi.set(kunci, { coa_kode: utama.coa_kode, nama: utama.nama, tipe: utama.tipe, arus: j.arus });
  }

  const ambil = (kel) => [...akumulasi.entries()]
    .filter(([k, v]) => k.startsWith(`${kel}|`) && v.arus !== 0)
    .map(([, v]) => v)
    .sort((a, b) => a.coa_kode.localeCompare(b.coa_kode));

  const kasBersih = grup.operasi + grup.investasi + grup.pendanaan;
  return {
    operasi: ambil('operasi'),
    investasi: ambil('investasi'),
    pendanaan: ambil('pendanaan'),
    arus_operasi: grup.operasi,
    arus_investasi: grup.investasi,
    arus_pendanaan: grup.pendanaan,
    kenaikan_kas: kasBersih,
    saldo_awal: saldoAwal,
    saldo_akhir: saldoAwal + kasBersih,
  };
}

/** Laporan Perubahan Ekuitas. */
export function perubahanEkuitas(f = {}) {
  const dari = f.dari || `${new Date().getFullYear()}-01-01`;
  const sampai = f.sampai || new Date().toISOString().slice(0, 10);
  const akun = all("SELECT kode, nama FROM coa WHERE tipe = 'ekuitas' AND is_postable = 1 ORDER BY kode");
  const baris = akun.map((a) => {
    const awal = saldoAkun(a.kode, { sampai: prevDay(dari) }).saldo;
    const mut = saldoAkun(a.kode, { dari, sampai });
    return { ...a, saldo_awal: awal, penambahan: mut.kredit, pengurangan: mut.debit, saldo_akhir: awal + mut.saldo };
  });
  const lr = labaRugi({ dari, sampai });
  // Sama seperti pada neraca: bagian hasil usaha yang sudah dipindahkan ke
  // ekuitas lewat jurnal penutup tidak boleh dijumlahkan dua kali.
  const sudahDitutup = labaDipindahKeEkuitas(dari.slice(0, 4), sampai);
  return {
    periode: { dari, sampai },
    baris,
    shu_periode_berjalan: lr.shu_bersih,
    total_awal: baris.reduce((s, r) => s + r.saldo_awal, 0),
    total_akhir: baris.reduce((s, r) => s + r.saldo_akhir, 0) + lr.shu_bersih - sudahDitutup,
  };
}

/** Analisis rasio keuangan koperasi (acuan penilaian kesehatan KSP). */
export function rasioKeuangan(f = {}) {
  const n = neraca(f);
  const lr = labaRugi({ dari: `${(f.sampai || '').slice(0, 4) || new Date().getFullYear()}-01-01`, sampai: f.sampai });
  const lancar = n.aset.filter((r) => r.kode.startsWith('1-1')).reduce((s, r) => s + r.saldo, 0);
  const hutangLancar = n.kewajiban.filter((r) => r.kode.startsWith('2-1')).reduce((s, r) => s + r.saldo, 0);
  const kas = n.aset.filter((r) => r.kode.startsWith('1-11') || r.kode.startsWith('1-12')).reduce((s, r) => s + r.saldo, 0);
  const piutang = scalar("SELECT COALESCE(SUM(outstanding_pokok),0) FROM pinjaman WHERE status = 'dicairkan'");
  const npl = scalar("SELECT COALESCE(SUM(outstanding_pokok),0) FROM pinjaman WHERE status = 'dicairkan' AND kolektibilitas >= 3");
  const pct = (a, b) => (b ? Number(((a / b) * 100).toFixed(2)) : 0);
  return {
    likuiditas: {
      rasio_lancar: pct(lancar, hutangLancar),
      rasio_kas: pct(kas, hutangLancar),
      keterangan: 'Rasio lancar sehat pada kisaran 175% - 200%',
    },
    solvabilitas: {
      rasio_hutang_aset: pct(n.total_kewajiban, n.total_aset),
      rasio_modal_sendiri: pct(n.total_ekuitas, n.total_aset),
    },
    rentabilitas: {
      roa: pct(lr.shu_bersih, n.total_aset),
      roe: pct(lr.shu_bersih, n.total_ekuitas),
      margin_shu: pct(lr.shu_bersih, lr.total_pendapatan),
    },
    kualitas_pinjaman: {
      outstanding: piutang,
      npl_nominal: npl,
      npl_ratio: pct(npl, piutang),
      keterangan: 'NPL di bawah 5% dikategorikan sehat',
    },
  };
}

/** Menutup periode akuntansi (bulanan). */
export function tutupPeriode(tahun, bulan, ctx) {
  const existing = get('SELECT * FROM periode_akuntansi WHERE tahun = ? AND bulan = ?', [tahun, bulan]);
  if (existing?.status === 'tutup') throw conflict('Periode ini sudah ditutup');
  const tb = trialBalance({ sampai: endOfMonth(`${tahun}-${String(bulan).padStart(2, '0')}`) });
  if (tb.total_debit !== tb.total_kredit) {
    throw conflict('Neraca saldo tidak seimbang, periode tidak dapat ditutup',
      `Selisih ${(tb.total_debit - tb.total_kredit).toLocaleString('id-ID')}`);
  }
  run(
    `INSERT INTO periode_akuntansi(tahun, bulan, status, ditutup_oleh, ditutup_pada)
     VALUES(?,?,'tutup',?,datetime('now'))
     ON CONFLICT(tahun, bulan) DO UPDATE SET status='tutup', ditutup_oleh=excluded.ditutup_oleh,
       ditutup_pada=excluded.ditutup_pada`,
    [tahun, bulan, ctx?.user?.username || 'sistem'],
  );
  logAudit(ctx, { aksi: 'update', modul: 'akuntansi', entitas_id: `${tahun}-${bulan}`,
    keterangan: `Periode ${tahun}-${String(bulan).padStart(2, '0')} ditutup` });
  return { tahun, bulan, status: 'tutup' };
}

export function bukaPeriode(tahun, bulan, ctx) {
  run(
    `INSERT INTO periode_akuntansi(tahun, bulan, status) VALUES(?,?,'terbuka')
     ON CONFLICT(tahun, bulan) DO UPDATE SET status='terbuka', ditutup_oleh=NULL, ditutup_pada=NULL`,
    [tahun, bulan],
  );
  logAudit(ctx, { aksi: 'update', modul: 'akuntansi', entitas_id: `${tahun}-${bulan}`,
    keterangan: `Periode ${tahun}-${String(bulan).padStart(2, '0')} dibuka kembali` });
  return { tahun, bulan, status: 'terbuka' };
}

/**
 * Jurnal penutup akhir tahun: menutup pendapatan & beban ke SHU tahun berjalan.
 */
export function jurnalPenutup(tahun, ctx) {
  const dari = `${tahun}-01-01`;
  const sampai = `${tahun}-12-31`;
  const sudah = get("SELECT id FROM jurnal WHERE tipe = 'penutup' AND referensi = ? AND status = 'posted'",
    [`penutup:${tahun}`]);
  if (sudah) throw conflict(`Jurnal penutup tahun ${tahun} sudah pernah dibuat`);

  // Jurnal penutup sebelumnya dikeluarkan agar penutupan ulang - misalnya
  // sesudah jurnal penutup lama dibatalkan - tidak menutup saldo yang sama dua kali.
  const tb = trialBalance({ dari, sampai, tanpa_penutup: true });
  const lines = [];
  let laba = 0;
  for (const r of tb.baris) {
    if (r.tipe === 'pendapatan' && r.saldo !== 0) {
      lines.push({ coa_kode: r.kode, debit: r.saldo, keterangan: 'Menutup pendapatan' });
      laba += r.saldo;
    } else if (r.tipe === 'beban' && r.saldo !== 0) {
      lines.push({ coa_kode: r.kode, kredit: r.saldo, keterangan: 'Menutup beban' });
      laba -= r.saldo;
    }
  }
  if (!lines.length) throw badRequest('Tidak ada pendapatan/beban untuk ditutup pada tahun ini');
  if (laba >= 0) lines.push({ coa_kode: AKUN.shu_berjalan(), kredit: laba, keterangan: 'SHU tahun berjalan' });
  else lines.push({ coa_kode: AKUN.shu_berjalan(), debit: -laba, keterangan: 'Defisit tahun berjalan' });

  return postJournal({
    tanggal: sampai, tipe: 'penutup', referensi: `penutup:${tahun}`,
    keterangan: `Jurnal penutup tahun buku ${tahun}`, lines,
  }, ctx);
}
