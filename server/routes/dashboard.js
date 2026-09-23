/**
 * Modul 1 (Dashboard Executive) dan Modul 25 (Business Intelligence).
 */
import { createRouter } from '../lib/http.js';
import { all, get, scalar, setting } from '../db.js';
import { today, yearOf, addMonths } from '../lib/util.js';
import { labaRugi, neraca, arusKas, rasioKeuangan, saldoAkun, AKUN } from '../services/accounting.js';
import { statistikPortofolio, daftarTagihan } from '../services/loans.js';
import { totalSimpanan } from '../services/savings.js';
import { nilaiPersediaan, daftarReorder } from '../services/inventory.js';
import { menungguSaya } from '../services/approval.js';
import { ringkasan as ringkasanAset } from '../services/assets.js';

const router = createRouter();

router.get('/api/dashboard', 'dashboard.view', ({ query, ctx }) => {
  const sampai = query.sampai || today();
  const tahun = yearOf(sampai);
  const dari = `${tahun}-01-01`;

  const lr = labaRugi({ dari, sampai });
  const n = neraca({ sampai });
  const portofolio = statistikPortofolio();
  const kasBank = all('SELECT kode FROM coa WHERE is_kas = 1 OR is_bank = 1')
    .reduce((s, a) => s + saldoAkun(a.kode, { sampai }).saldo, 0);

  const bulanIni = sampai.slice(0, 7);
  const omzetToko = scalar(
    "SELECT COALESCE(SUM(total),0) FROM penjualan WHERE status = 'selesai' AND substr(tanggal,1,7) = ?",
    [bulanIni]);

  // Tren 12 bulan terakhir
  const tren = [];
  for (let i = 11; i >= 0; i--) {
    const p = addMonths(`${sampai.slice(0, 7)}-01`, -i).slice(0, 7);
    const l = labaRugi({ dari: `${p}-01`, sampai: `${p}-31` });
    tren.push({
      periode: p,
      pendapatan: l.total_pendapatan,
      beban: l.total_beban,
      shu: l.shu_bersih,
      simpanan: scalar(
        "SELECT COALESCE(SUM(kredit) - SUM(debit),0) FROM transaksi_simpanan WHERE substr(tanggal,1,7) = ?", [p]),
      penjualan: scalar(
        "SELECT COALESCE(SUM(total),0) FROM penjualan WHERE status = 'selesai' AND substr(tanggal,1,7) = ?", [p]),
      pencairan: scalar(
        "SELECT COALESCE(SUM(pokok),0) FROM pinjaman WHERE tanggal_cair IS NOT NULL AND substr(tanggal_cair,1,7) = ?", [p]),
    });
  }

  const tagihan = daftarTagihan({ sampai, hari_kedepan: 7 });

  return {
    per_tanggal: sampai,
    koperasi: setting('koperasi.nama', 'Koperasi Serba Usaha'),
    kpi: {
      total_anggota: scalar("SELECT COUNT(*) FROM anggota WHERE status = 'aktif'"),
      anggota_baru_bulan_ini: scalar(
        "SELECT COUNT(*) FROM anggota WHERE substr(tanggal_gabung,1,7) = ?", [bulanIni]),
      total_simpanan: totalSimpanan(),
      total_pinjaman: portofolio.total_outstanding,
      shu_berjalan: lr.shu_bersih,
      total_aset: n.total_aset,
      total_ekuitas: n.total_ekuitas,
      kas_dan_bank: kasBank,
      nilai_persediaan: nilaiPersediaan().total_nilai,
      omzet_toko_bulan_ini: omzetToko,
      npl_ratio: portofolio.npl_ratio,
      kredit_macet: portofolio.npl_nominal,
      pendapatan_ytd: lr.total_pendapatan,
      beban_ytd: lr.total_beban,
    },
    tren,
    portofolio_pinjaman: portofolio,
    perhatian: {
      approval_menunggu: ctx?.user ? menungguSaya(ctx.user).length : 0,
      tagihan_jatuh_tempo: tagihan.filter((t) => t.kategori === 'akan_jatuh_tempo').length,
      tagihan_tertunggak: tagihan.filter((t) => t.kategori === 'tertunggak').length,
      nilai_tertunggak: tagihan.filter((t) => t.kategori === 'tertunggak')
        .reduce((s, t) => s + t.sisa_tagihan, 0),
      stok_perlu_order: daftarReorder().length,
      calon_anggota: scalar("SELECT COUNT(*) FROM anggota WHERE status = 'calon'"),
      tiket_terbuka: scalar("SELECT COUNT(*) FROM tiket WHERE status IN ('baru','diproses')"),
      izin_segera_kadaluarsa: scalar(
        `SELECT COUNT(*) FROM compliance_item WHERE tanggal_kadaluarsa IS NOT NULL
           AND tanggal_kadaluarsa <= date('now','+90 day')`),
      temuan_audit_terbuka: scalar("SELECT COUNT(*) FROM audit_temuan WHERE status = 'terbuka'"),
      risiko_tinggi: scalar("SELECT COUNT(*) FROM risiko WHERE status = 'aktif' AND skor_inheren >= 12"),
    },
    aktivitas_terakhir: all(
      `SELECT waktu, username, aksi, modul, keterangan FROM audit_log
        ORDER BY id DESC LIMIT 15`),
  };
});

/** Business Intelligence: analitik mendalam per domain. */
router.get('/api/bi/keanggotaan', 'bi.view', () => {
  const perUsia = all(
    `SELECT CASE
              WHEN tanggal_lahir IS NULL THEN 'tidak diketahui'
              WHEN (julianday('now') - julianday(tanggal_lahir))/365.25 < 25 THEN '< 25 tahun'
              WHEN (julianday('now') - julianday(tanggal_lahir))/365.25 < 35 THEN '25-34 tahun'
              WHEN (julianday('now') - julianday(tanggal_lahir))/365.25 < 45 THEN '35-44 tahun'
              WHEN (julianday('now') - julianday(tanggal_lahir))/365.25 < 55 THEN '45-54 tahun'
              ELSE '55+ tahun' END AS kelompok,
            COUNT(*) AS jumlah
       FROM anggota WHERE status = 'aktif' GROUP BY kelompok ORDER BY kelompok`);
  return {
    per_usia: perUsia,
    per_pekerjaan: all(
      `SELECT COALESCE(pekerjaan,'tidak diisi') AS pekerjaan, COUNT(*) AS jumlah
         FROM anggota WHERE status = 'aktif' GROUP BY pekerjaan ORDER BY jumlah DESC LIMIT 10`),
    pertumbuhan: all(
      `SELECT substr(tanggal_gabung,1,7) AS periode, COUNT(*) AS bergabung
         FROM anggota WHERE tanggal_gabung IS NOT NULL GROUP BY periode ORDER BY periode DESC LIMIT 24`).reverse(),
    keluar: all(
      `SELECT substr(tanggal_keluar,1,7) AS periode, COUNT(*) AS keluar
         FROM anggota WHERE tanggal_keluar IS NOT NULL GROUP BY periode ORDER BY periode DESC LIMIT 12`).reverse(),
    top_simpanan: all(
      `SELECT a.nomor_anggota, a.nama, COALESCE(SUM(r.saldo),0) AS saldo
         FROM anggota a JOIN rekening_simpanan r ON r.anggota_id = a.id AND r.status <> 'tutup'
        GROUP BY a.id ORDER BY saldo DESC LIMIT 10`),
  };
});

router.get('/api/bi/pinjaman', 'bi.view', ({ query }) => {
  const tahun = Number(query.tahun) || new Date().getFullYear();
  return {
    portofolio: statistikPortofolio(),
    per_produk: all(
      `SELECT pr.nama, COUNT(p.id) AS jumlah, COALESCE(SUM(p.pokok),0) AS pencairan,
              COALESCE(SUM(p.outstanding_pokok),0) AS outstanding
         FROM produk_pinjaman pr LEFT JOIN pinjaman p ON p.produk_id = pr.id
        GROUP BY pr.id ORDER BY outstanding DESC`),
    pencairan_bulanan: all(
      `SELECT substr(tanggal_cair,1,7) AS periode, COUNT(*) AS jumlah, COALESCE(SUM(pokok),0) AS nominal
         FROM pinjaman WHERE tanggal_cair IS NOT NULL AND substr(tanggal_cair,1,4) = ?
        GROUP BY periode ORDER BY periode`, [String(tahun)]),
    pendapatan_jasa: all(
      `SELECT substr(tanggal,1,7) AS periode, COALESCE(SUM(bayar_bunga),0) AS bunga,
              COALESCE(SUM(bayar_denda),0) AS denda
         FROM pinjaman_angsuran WHERE substr(tanggal,1,4) = ? AND status <> 'batal'
        GROUP BY periode ORDER BY periode`,
      [String(tahun)]),
    tunggakan_terbesar: all(
      `SELECT p.nomor, a.nama, p.outstanding_pokok, p.tunggakan_hari, p.kolektibilitas
         FROM pinjaman p JOIN anggota a ON a.id = p.anggota_id
        WHERE p.status IN ('dicairkan','restrukturisasi') AND p.tunggakan_hari > 0
        ORDER BY p.outstanding_pokok DESC LIMIT 15`),
  };
});

router.get('/api/bi/usaha', 'bi.view', ({ query }) => {
  const tahun = Number(query.tahun) || new Date().getFullYear();
  return {
    penjualan_bulanan: all(
      `SELECT substr(tanggal,1,7) AS periode, COUNT(*) AS transaksi,
              COALESCE(SUM(total),0) AS omzet, COALESCE(SUM(hpp),0) AS hpp,
              COALESCE(SUM(total - hpp),0) AS laba_kotor
         FROM penjualan WHERE status = 'selesai' AND substr(tanggal,1,4) = ?
        GROUP BY periode ORDER BY periode`, [String(tahun)]),
    barang_terlaris: all(
      `SELECT b.kode, b.nama, SUM(d.qty) AS qty, SUM(d.subtotal) AS omzet,
              SUM(d.subtotal - d.hpp_satuan * d.qty) AS margin
         FROM penjualan_detail d JOIN penjualan j ON j.id = d.penjualan_id
         JOIN barang b ON b.id = d.barang_id
        WHERE j.status = 'selesai' AND substr(j.tanggal,1,4) = ?
        GROUP BY b.id ORDER BY omzet DESC LIMIT 15`, [String(tahun)]),
    per_metode_bayar: all(
      `SELECT metode_bayar, COUNT(*) AS jumlah, COALESCE(SUM(total),0) AS nilai
         FROM penjualan WHERE status = 'selesai' AND substr(tanggal,1,4) = ?
        GROUP BY metode_bayar`, [String(tahun)]),
    kontribusi_anggota: (() => {
      const anggota = scalar(
        `SELECT COALESCE(SUM(total),0) FROM penjualan WHERE status = 'selesai'
           AND anggota_id IS NOT NULL AND substr(tanggal,1,4) = ?`, [String(tahun)]);
      const umum = scalar(
        `SELECT COALESCE(SUM(total),0) FROM penjualan WHERE status = 'selesai'
           AND anggota_id IS NULL AND substr(tanggal,1,4) = ?`, [String(tahun)]);
      return { anggota, non_anggota: umum,
        persen_anggota: anggota + umum ? Number((anggota / (anggota + umum) * 100).toFixed(1)) : 0 };
    })(),
    persediaan: nilaiPersediaan(),
    aset: ringkasanAset(),
  };
});

/** Proyeksi kas 6 bulan ke depan berbasis jadwal angsuran & rata-rata operasional. */
router.get('/api/bi/proyeksi-kas', 'bi.view', ({ query }) => {
  const mulai = query.dari || today();
  const kasAwal = all('SELECT kode FROM coa WHERE is_kas = 1 OR is_bank = 1')
    .reduce((s, a) => s + saldoAkun(a.kode, { sampai: mulai }).saldo, 0);

  // Rata-rata beban operasional 3 bulan terakhir sebagai basis proyeksi
  const bebanRata = scalar(
    `SELECT COALESCE(AVG(b),0) FROM (
        SELECT substr(j.tanggal,1,7) AS p, SUM(d.debit) AS b
          FROM jurnal_detail d JOIN jurnal j ON j.id = d.jurnal_id
          JOIN coa c ON c.kode = d.coa_kode
         WHERE c.tipe = 'beban' AND j.status = 'posted' AND j.tanggal >= date(?,'-3 month')
         GROUP BY p)`, [mulai]);

  const proyeksi = [];
  let saldo = kasAwal;
  for (let i = 1; i <= 6; i++) {
    const p = addMonths(`${mulai.slice(0, 7)}-01`, i).slice(0, 7);
    const masukAngsuran = scalar(
      `SELECT COALESCE(SUM(total - bayar_pokok - bayar_bunga),0) FROM pinjaman_jadwal
        WHERE status <> 'lunas' AND substr(jatuh_tempo,1,7) = ?`, [p]);
    const masukSimpanan = scalar(
      `SELECT COALESCE(SUM(setoran_wajib),0) FROM produk_simpanan p
         JOIN rekening_simpanan r ON r.produk_id = p.id
        WHERE p.jenis = 'wajib' AND r.status = 'aktif'`);
    const masuk = masukAngsuran + masukSimpanan;
    const keluar = Math.round(bebanRata);
    saldo += masuk - keluar;
    proyeksi.push({ periode: p, penerimaan: masuk, pengeluaran: keluar,
      arus_bersih: masuk - keluar, saldo_akhir: saldo });
  }
  return { saldo_awal: kasAwal, basis_beban_bulanan: Math.round(bebanRata), proyeksi };
});

router.get('/api/bi/kesehatan', 'bi.view', ({ query }) => {
  const sampai = query.sampai || today();
  const rasio = rasioKeuangan({ sampai });
  const nilai = [];
  const skor = (kondisi, bobot) => { nilai.push(kondisi ? bobot : 0); return kondisi; };
  skor(rasio.likuiditas.rasio_lancar >= 150, 20);
  skor(rasio.solvabilitas.rasio_modal_sendiri >= 30, 20);
  skor(rasio.rentabilitas.roa >= 3, 20);
  skor(rasio.kualitas_pinjaman.npl_ratio < 5, 25);
  skor(rasio.rentabilitas.margin_shu >= 5, 15);
  const total = nilai.reduce((s, v) => s + v, 0);
  return {
    per_tanggal: sampai, rasio, skor_kesehatan: total,
    predikat: total >= 80 ? 'SEHAT' : total >= 60 ? 'CUKUP SEHAT'
      : total >= 40 ? 'DALAM PENGAWASAN' : 'DALAM PENGAWASAN KHUSUS',
    catatan: 'Penilaian indikatif mengacu pada aspek permodalan, kualitas aktiva produktif, '
      + 'likuiditas, dan rentabilitas sebagaimana pedoman penilaian kesehatan koperasi simpan pinjam.',
  };
});

export default router;
