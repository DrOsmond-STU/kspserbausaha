/**
 * Pusat Laporan - kelompok usaha: penjualan/POS, pembelian, persediaan, dan unit usaha.
 * Lihat server/laporan/bantu.js untuk format definisi laporan.
 *
 * Catatan semantik data (lihat server/services/trade.js & inventory.js):
 * - penjualan.subtotal sudah setelah diskon per barang; penjualan.diskon = diskon
 *   barang + diskon nota; pendapatan yang dijurnal = total - pajak.
 * - Retur penjualan tidak mengubah baris penjualan (kecuali status 'retur' bila
 *   diretur penuh); jejaknya ada di mutasi_stok jenis 'retur_masuk' dengan
 *   referensi 'retur:<id penjualan>' dan jurnal berreferensi sama.
 * - Penerimaan barang = mutasi_stok jenis 'masuk' berreferensi 'pembelian:<id>'.
 * - Stok per tanggal = jumlah qty mutasi_stok s.d. tanggal tersebut (tabel stok
 *   selalu sama dengan jumlah seluruh mutasinya).
 */
import { all, get } from '../db.js';
import { labaRugi } from '../services/accounting.js';
import { diffDays, addDays } from '../lib/util.js';
import { tanggalPanjang } from '../lib/profil.js';
import { periode, rentang, pilih, kondisi, teksPeriode, jumlahkan, bernomor, KOLOM_NO, opsiCabang, opsiUnit } from './bantu.js';

// ------------------------------ Alat bantu ------------------------------

const hariIni = () => new Date().toISOString().slice(0, 10);

/**
 * Mengisi periode yang dikosongkan: "sampai" = hari ini (atau tanggal awal bila
 * lebih akhir) dan "dari" = awal(sampai). Dipakai sebagai pengganti nilai bawaan
 * filter agar pengisian salah satu tanggal saja tidak berbenturan.
 */
function isiPeriode(f, awal) {
  const sampai = f.sampai || (f.dari && f.dari > hariIni() ? f.dari : hariIni());
  return { ...f, sampai, dari: f.dari || awal(sampai) };
}
const awalBulanDari = (t) => `${t.slice(0, 7)}-01`;
const awalTahunDari = (t) => `${t.slice(0, 4)}-01-01`;
const bulat = (n) => Math.round(Number(n) || 0);
const persen = (a, b) => (b ? Number((a / b * 100).toFixed(2)) : 0);

/**
 * Membungkus definisi laporan: setiap baris dipangkas hanya ke kolom yang
 * ditampilkan, sehingga kolom bantu/internal tidak ikut terkirim ke peramban.
 */
function rapikan(def) {
  const susun = def.susun;
  return {
    ...def,
    susun(f, ctx) {
      const hasil = susun(f, ctx);
      hasil.bagian = (hasil.bagian || []).map((b) => ({
        ...b, baris: b.baris.map((r) => Object.fromEntries(b.kolom.map((k) => [k.kunci, r[k.kunci] ?? null]))),
      }));
      return hasil;
    },
  };
}

/** Filter rentang tanggal untuk kolom bertipe tanggal murni (tetap memakai indeks). */
function tanggal(w, kolom, f) {
  if (f.dari) w.tambah(`${kolom} >= ?`, f.dari);
  if (f.sampai) w.tambah(`${kolom} <= ?`, f.sampai);
  return w;
}

const opsiGudang = () => all('SELECT id AS nilai, nama AS teks FROM gudang ORDER BY kode');
const opsiKategori = () => all('SELECT id AS nilai, nama AS teks FROM kategori_barang ORDER BY kode');
const opsiSupplier = () => all("SELECT id AS nilai, kode || ' - ' || nama AS teks FROM supplier ORDER BY kode");
const opsiKasir = () => all(
  'SELECT DISTINCT kasir AS nilai, kasir AS teks FROM penjualan WHERE kasir IS NOT NULL ORDER BY kasir');

const LABEL_METODE = {
  tunai: 'Tunai', qris: 'QRIS', transfer: 'Transfer', piutang: 'Piutang (kredit)',
  potong_simpanan: 'Potong simpanan', debit: 'Kartu debit', kredit: 'Kredit',
};
const teksMetode = (m) => LABEL_METODE[m] || m || '-';
/** Metode bayar baku ditambah nilai lain yang sudah tercatat di basis data. */
const opsiMetode = () => {
  const ada = all('SELECT DISTINCT metode_bayar AS m FROM penjualan WHERE metode_bayar IS NOT NULL').map((r) => r.m);
  return [...new Set(['tunai', 'qris', 'transfer', 'piutang', 'potong_simpanan', ...ada])]
    .map((m) => ({ nilai: m, teks: teksMetode(m) }));
};

const OPSI_PEMBELI = [
  { nilai: 'anggota', teks: 'Anggota' },
  { nilai: 'umum', teks: 'Umum (bukan anggota)' },
  { nilai: 'pelanggan', teks: 'Pelanggan terdaftar (customer)' },
];
function filterPembeli(w, nilai, alias = 'j') {
  if (nilai === 'anggota') w.tambah(`${alias}.anggota_id IS NOT NULL`);
  else if (nilai === 'umum') w.tambah(`${alias}.anggota_id IS NULL`);
  else if (nilai === 'pelanggan') w.tambah(`${alias}.customer_id IS NOT NULL`);
  return w;
}

/** Penjualan yang sah secara akuntansi (sudah dijurnal & mengurangi stok). */
const PENJUALAN_SAH = "j.status NOT IN ('batal','draft')";

/** Filter umum penjualan yang dipakai bersama oleh transaksi & retur. */
function filterPenjualan(w, f) {
  w.sama('j.metode_bayar', f.metode).sama('j.kasir', f.kasir)
    .sama('j.unit_usaha_id', f.unit_usaha_id).sama('j.cabang_id', f.cabang_id);
  return filterPembeli(w, f.pembeli);
}

/**
 * Baris retur penjualan (per barang per kejadian retur) dengan nilainya.
 * Nilai retur mengikuti services/trade.js: porsi subtotal barang terhadap
 * subtotal nota dikalikan total nota (diskon nota, poin, dan PPN ikut terkoreksi).
 */
function dataRetur(f) {
  const wm = kondisi().tambah("m.jenis = 'retur_masuk'").tambah("m.referensi LIKE 'retur:%'");
  tanggal(wm, 'm.tanggal', f);
  const w = filterPenjualan(kondisi(), f);
  w.rentang('b.kode', f, 'kode').sama('b.kategori_id', f.kategori_id);
  const baris = all(
    `WITH r AS (
       SELECT m.id, m.tanggal, m.barang_id, m.qty, m.harga, m.referensi,
              CAST(substr(m.referensi, 7) AS INTEGER) AS pid
         FROM mutasi_stok m ${wm.where()}
     ), dd AS (
       SELECT penjualan_id, barang_id, SUM(subtotal) AS sub, SUM(qty) AS qty
         FROM penjualan_detail WHERE penjualan_id IN (SELECT pid FROM r)
        GROUP BY penjualan_id, barang_id
     )
     SELECT r.id, r.tanggal, r.referensi, r.qty, r.harga, j.id AS penjualan_id, j.nomor,
            j.tanggal AS tanggal_nota, j.metode_bayar, j.kasir, j.subtotal AS subtotal_nota,
            j.total AS total_nota, j.pajak AS pajak_nota,
            COALESCE(a.nama, c.nama, 'Umum') AS pembeli,
            b.id AS barang_id, b.kode, b.nama, b.satuan, k.nama AS kategori,
            CASE WHEN dd.qty > 0 THEN r.qty * dd.sub * 1.0 / dd.qty ELSE 0 END AS nilai_barang
       FROM r JOIN penjualan j ON j.id = r.pid
       JOIN barang b ON b.id = r.barang_id
       LEFT JOIN kategori_barang k ON k.id = b.kategori_id
       LEFT JOIN dd ON dd.penjualan_id = j.id AND dd.barang_id = r.barang_id
       LEFT JOIN anggota a ON a.id = j.anggota_id
       LEFT JOIN customer c ON c.id = j.customer_id
       ${w.where()}
      ORDER BY r.tanggal, r.id`, [...wm.params, ...w.params]);
  return baris.map((r) => {
    const faktor = r.subtotal_nota > 0 ? r.total_nota / r.subtotal_nota : 1;
    const nilai = bulat(r.nilai_barang * faktor);
    return {
      ...r,
      nilai_barang: bulat(r.nilai_barang),
      nilai_retur: nilai,
      pajak_retur: r.total_nota > 0 ? bulat(nilai * r.pajak_nota / r.total_nota) : 0,
      hpp: bulat(r.qty * r.harga),
    };
  });
}

/** Menambahkan kolom umur (hari lewat jatuh tempo) & kelompok umurnya. */
const KOLOM_UMUR = [
  { kunci: 'belum_jt', label: 'Belum Jatuh Tempo', tipe: 'uang' },
  { kunci: 'u1_30', label: '1-30 hari', tipe: 'uang' },
  { kunci: 'u31_60', label: '31-60 hari', tipe: 'uang' },
  { kunci: 'u61_90', label: '61-90 hari', tipe: 'uang' },
  { kunci: 'u90', label: '> 90 hari', tipe: 'uang' },
];
function kelompokUmur(r, acuan) {
  const umur = r.jatuh_tempo ? diffDays(acuan, r.jatuh_tempo) : 0;
  const x = { ...r, umur_hari: Math.max(0, umur), belum_jt: 0, u1_30: 0, u31_60: 0, u61_90: 0, u90: 0 };
  const k = umur <= 0 ? 'belum_jt' : umur <= 30 ? 'u1_30' : umur <= 60 ? 'u31_60' : umur <= 90 ? 'u61_90' : 'u90';
  x[k] = r.sisa;
  return x;
}

/**
 * Hutang (supplier) / piutang (penjualan kredit) per tanggal acuan. Pembayaran
 * dihitung dari jurnal pembayaran (referensi 'hp:<id>') s.d. tanggal acuan;
 * untuk acuan hari ini atau sesudahnya dipakai saldo terbayar terkini.
 */
function dataHutangPiutang(jenis, f) {
  const acuan = f.per_tanggal || hariIni();
  const w = kondisi().tambah('h.jenis = ?', jenis).tambah('h.tanggal <= ?', acuan);
  tanggal(w, 'h.tanggal', f);
  w.sama('h.supplier_id', f.supplier_id).sama('h.customer_id', f.customer_id);
  if (f.pihak) w.cari(['s.nama', 'a.nama', 'c.nama', 'h.pihak'], f.pihak);
  const tabelDok = jenis === 'hutang' ? 'pembelian' : 'penjualan';
  const baris = all(
    `SELECT h.id, h.referensi, h.tanggal, h.jatuh_tempo, h.nominal, h.status, h.supplier_id,
            COALESCE(s.nama, a.nama, c.nama, h.pihak, '-') AS pihak, s.kode AS supplier_kode,
            (SELECT d.nomor FROM ${tabelDok} d WHERE d.id = CAST(substr(h.referensi, 11) AS INTEGER)) AS nomor_dokumen,
            CASE WHEN ? >= date('now') THEN h.terbayar
                 ELSE MIN(h.terbayar, COALESCE((SELECT SUM(j.total_debit) FROM jurnal j
                        WHERE j.referensi = 'hp:' || h.id AND j.status = 'posted' AND j.tanggal <= ?), 0)) END AS terbayar
       FROM hutang_piutang h
       LEFT JOIN supplier s ON s.id = h.supplier_id
       LEFT JOIN anggota a ON a.id = h.anggota_id
       LEFT JOIN customer c ON c.id = h.customer_id
       ${w.where()}
      ORDER BY pihak, h.jatuh_tempo, h.id`, [acuan, acuan, ...w.params])
    .map((r) => ({ ...r, sisa: r.nominal - r.terbayar }))
    .filter((r) => (f.status === 'semua' ? true : f.status === 'lunas' ? r.sisa <= 0 : r.sisa > 0))
    .map((r) => kelompokUmur(r, acuan));
  return { acuan, baris };
}

const OPSI_STATUS_TAGIHAN = [
  { nilai: 'terbuka', teks: 'Belum lunas' }, { nilai: 'lunas', teks: 'Lunas' }, { nilai: 'semua', teks: 'Semua' },
];

const JENIS_MUTASI = {
  masuk: 'Masuk (pembelian)', keluar: 'Keluar (penjualan)', retur_masuk: 'Retur penjualan',
  retur_keluar: 'Retur pembelian', transfer_masuk: 'Transfer masuk', transfer_keluar: 'Transfer keluar',
  opname: 'Selisih stock opname', penyesuaian_masuk: 'Penyesuaian masuk', penyesuaian_keluar: 'Penyesuaian keluar',
};
const teksJenis = (j) => JENIS_MUTASI[j] || j;

/** Filter barang umum: rentang kode & kategori. */
const FILTER_BARANG = [...rentang('kode', 'Kode barang'), pilih('kategori_id', 'Kategori', opsiKategori)];

// ------------------------------ Definisi ------------------------------

export default [
  // =============================== PENJUALAN ===============================
  {
    kode: 'penjualan-daftar',
    judul: 'Daftar Transaksi Penjualan',
    izin: 'penjualan.view',
    orientasi: 'landscape',
    deskripsi: 'Nota penjualan/POS per periode dengan filter nomor, metode bayar, kasir, jenis pembeli, dan status.',
    filter: [
      ...periode(),
      ...rentang('nomor', 'Nomor nota'),
      pilih('metode', 'Metode bayar', opsiMetode),
      pilih('kasir', 'Kasir', opsiKasir),
      pilih('pembeli', 'Pembeli', OPSI_PEMBELI),
      pilih('status', 'Status', ['selesai', 'retur', 'dipesan', 'draft', 'batal']),
      pilih('unit_usaha_id', 'Unit usaha', opsiUnit),
      pilih('cabang_id', 'Cabang', opsiCabang),
    ],
    susun(f) {
      const w = filterPenjualan(tanggal(kondisi(), 'j.tanggal', f), f)
        .rentang('j.nomor', f, 'nomor').sama('j.status', f.status);
      const baris = bernomor(all(
        `SELECT j.nomor, j.tanggal, COALESCE(a.nama, c.nama, 'Umum') AS pembeli, a.nomor_anggota,
                j.kasir, j.metode_bayar, j.subtotal, j.diskon, j.pajak, j.total, j.hpp,
                (j.total - j.pajak - j.hpp) AS laba_kotor, j.status
           FROM penjualan j LEFT JOIN anggota a ON a.id = j.anggota_id
           LEFT JOIN customer c ON c.id = j.customer_id
           ${w.where()} ORDER BY j.tanggal, j.id`, w.params))
        .map((r) => ({ ...r, metode_bayar: teksMetode(r.metode_bayar) }));
      const sah = baris.filter((r) => !['batal', 'draft'].includes(r.status));
      const t = jumlahkan(sah, ['subtotal', 'diskon', 'pajak', 'total', 'hpp', 'laba_kotor']);
      return {
        subjudul: teksPeriode(f),
        ringkasan: [
          { label: 'Jumlah nota', nilai: baris.length, tipe: 'angka' },
          { label: 'Total penjualan', nilai: t.total, tipe: 'uang' },
          { label: 'HPP', nilai: t.hpp, tipe: 'uang' },
          { label: 'Laba kotor', nilai: t.laba_kotor, tipe: 'uang' },
        ],
        bagian: [{
          kolom: [KOLOM_NO, { kunci: 'nomor', label: 'No. Nota' }, { kunci: 'tanggal', label: 'Tanggal', tipe: 'tanggal' },
            { kunci: 'pembeli', label: 'Pembeli' }, { kunci: 'nomor_anggota', label: 'No. Anggota' },
            { kunci: 'kasir', label: 'Kasir' }, { kunci: 'metode_bayar', label: 'Metode' },
            { kunci: 'subtotal', label: 'Subtotal', tipe: 'uang' }, { kunci: 'diskon', label: 'Diskon', tipe: 'uang' },
            { kunci: 'pajak', label: 'PPN', tipe: 'uang' }, { kunci: 'total', label: 'Total', tipe: 'uang' },
            { kunci: 'hpp', label: 'HPP', tipe: 'uang' }, { kunci: 'laba_kotor', label: 'Laba Kotor', tipe: 'uang' },
            { kunci: 'status', label: 'Status' }],
          baris,
          total: jumlahkan(sah, ['subtotal', 'diskon', 'pajak', 'total', 'hpp', 'laba_kotor'], 'TOTAL (tanpa batal/draft)'),
        }],
        catatan: 'Subtotal sudah dikurangi diskon per barang; kolom Diskon memuat diskon barang dan diskon nota. '
          + 'Laba kotor = total - PPN - HPP. Retur penjualan disajikan pada laporan Retur Penjualan.',
      };
    },
  },
  {
    kode: 'penjualan-per-barang',
    judul: 'Penjualan per Barang',
    izin: 'penjualan.view',
    orientasi: 'landscape',
    deskripsi: 'Kuantitas, nilai, retur, HPP, dan laba kotor per barang dengan filter rentang kode barang dan kategori.',
    filter: [
      ...periode(),
      ...FILTER_BARANG,
      pilih('metode', 'Metode bayar', opsiMetode),
      pilih('pembeli', 'Pembeli', OPSI_PEMBELI),
      pilih('unit_usaha_id', 'Unit usaha', opsiUnit),
    ],
    susun(f) {
      const w = filterPenjualan(tanggal(kondisi().tambah(PENJUALAN_SAH), 'j.tanggal', f), f)
        .rentang('b.kode', f, 'kode').sama('b.kategori_id', f.kategori_id);
      const jual = all(
        `SELECT b.id, b.kode, b.nama, k.nama AS kategori, b.satuan,
                SUM(d.qty) AS qty, SUM(d.subtotal) AS nilai, SUM(d.qty * d.hpp_satuan) AS hpp
           FROM penjualan_detail d JOIN penjualan j ON j.id = d.penjualan_id
           JOIN barang b ON b.id = d.barang_id LEFT JOIN kategori_barang k ON k.id = b.kategori_id
           ${w.where()} GROUP BY b.id`, w.params);
      const peta = new Map(jual.map((r) => [r.id, { ...r, qty_retur: 0, nilai_retur: 0, hpp_retur: 0 }]));
      for (const r of dataRetur(f)) {
        const x = peta.get(r.barang_id) || { id: r.barang_id, kode: r.kode, nama: r.nama, kategori: r.kategori,
          satuan: r.satuan, qty: 0, nilai: 0, hpp: 0, qty_retur: 0, nilai_retur: 0, hpp_retur: 0 };
        x.qty_retur += r.qty; x.nilai_retur += r.nilai_barang; x.hpp_retur += r.hpp;
        peta.set(r.barang_id, x);
      }
      const baris = bernomor([...peta.values()].sort((a, b) => a.kode.localeCompare(b.kode)).map((r) => {
        const bersih = r.nilai - r.nilai_retur;
        const hpp = bulat(r.hpp - r.hpp_retur);
        return {
          kode: r.kode, nama: r.nama, kategori: r.kategori, satuan: r.satuan,
          qty: r.qty, qty_retur: r.qty_retur, qty_bersih: r.qty - r.qty_retur,
          nilai: bulat(r.nilai), nilai_retur: bulat(r.nilai_retur), bersih: bulat(bersih), hpp,
          laba_kotor: bulat(bersih - hpp), margin: persen(bersih - hpp, bersih),
        };
      }));
      const total = jumlahkan(baris, ['nilai', 'nilai_retur', 'bersih', 'hpp', 'laba_kotor']);
      total.margin = persen(total.laba_kotor, total.bersih);
      return {
        subjudul: teksPeriode(f),
        ringkasan: [
          { label: 'Jumlah barang', nilai: baris.length, tipe: 'angka' },
          { label: 'Penjualan bersih', nilai: total.bersih, tipe: 'uang' },
          { label: 'HPP', nilai: total.hpp, tipe: 'uang' },
          { label: 'Laba kotor', nilai: total.laba_kotor, tipe: 'uang' },
          { label: 'Margin', nilai: total.margin, tipe: 'persen' },
        ],
        bagian: [{
          kolom: [KOLOM_NO, { kunci: 'kode', label: 'Kode' }, { kunci: 'nama', label: 'Nama Barang' },
            { kunci: 'kategori', label: 'Kategori' }, { kunci: 'satuan', label: 'Satuan' },
            { kunci: 'qty', label: 'Qty Jual', tipe: 'angka' }, { kunci: 'qty_retur', label: 'Qty Retur', tipe: 'angka' },
            { kunci: 'qty_bersih', label: 'Qty Bersih', tipe: 'angka' },
            { kunci: 'nilai', label: 'Penjualan', tipe: 'uang' }, { kunci: 'nilai_retur', label: 'Retur', tipe: 'uang' },
            { kunci: 'bersih', label: 'Penjualan Bersih', tipe: 'uang' }, { kunci: 'hpp', label: 'HPP', tipe: 'uang' },
            { kunci: 'laba_kotor', label: 'Laba Kotor', tipe: 'uang' }, { kunci: 'margin', label: 'Margin', tipe: 'persen' }],
          baris,
          total,
        }],
        catatan: 'Nilai penjualan per barang adalah subtotal baris nota (setelah diskon barang, sebelum diskon nota & PPN). '
          + 'Retur dihitung menurut tanggal retur dengan nilai baris yang sama.',
      };
    },
  },
  {
    kode: 'penjualan-rekap-periodik',
    judul: 'Rekap Penjualan Harian / Bulanan',
    izin: 'penjualan.view',
    orientasi: 'landscape',
    deskripsi: 'Jumlah transaksi, penjualan, retur, PPN, HPP, dan laba kotor per hari atau per bulan.',
    filter: [
      ...periode(),
      pilih('kelompok', 'Dikelompokkan per', [{ nilai: 'harian', teks: 'Hari' }, { nilai: 'bulanan', teks: 'Bulan' }]),
      pilih('metode', 'Metode bayar', opsiMetode),
      pilih('kasir', 'Kasir', opsiKasir),
      pilih('unit_usaha_id', 'Unit usaha', opsiUnit),
      pilih('cabang_id', 'Cabang', opsiCabang),
    ].map((x) => (x.kunci === 'kelompok' ? { ...x, bawaan: 'harian' } : x)),
    susun(f) {
      const pj = f.kelompok === 'bulanan' ? 7 : 10;
      const w = filterPenjualan(tanggal(kondisi().tambah(PENJUALAN_SAH), 'j.tanggal', f), f);
      const peta = new Map(all(
        `SELECT substr(j.tanggal, 1, ${pj}) AS periode, COUNT(*) AS transaksi, SUM(j.total) AS total,
                SUM(j.pajak) AS pajak, SUM(j.hpp) AS hpp
           FROM penjualan j ${w.where()} GROUP BY 1`, w.params)
        .map((r) => [r.periode, { ...r, retur: 0, pajak_retur: 0, hpp_retur: 0 }]));
      for (const r of dataRetur(f)) {
        const k = r.tanggal.slice(0, pj);
        const x = peta.get(k) || { periode: k, transaksi: 0, total: 0, pajak: 0, hpp: 0, retur: 0, pajak_retur: 0, hpp_retur: 0 };
        x.retur += r.nilai_retur; x.pajak_retur += r.pajak_retur; x.hpp_retur += r.hpp;
        peta.set(k, x);
      }
      const baris = [...peta.values()].sort((a, b) => a.periode.localeCompare(b.periode)).map((r) => {
        const bersih = r.total - r.retur;
        const ppn = r.pajak - r.pajak_retur;
        const hpp = r.hpp - r.hpp_retur;
        return {
          periode: r.periode, transaksi: r.transaksi, total: r.total, retur: r.retur, bersih, ppn, hpp,
          laba_kotor: bersih - ppn - hpp, rata: r.transaksi ? bulat(r.total / r.transaksi) : 0,
        };
      });
      const total = jumlahkan(baris, ['transaksi', 'total', 'retur', 'bersih', 'ppn', 'hpp', 'laba_kotor']);
      total.rata = total.transaksi ? bulat(total.total / total.transaksi) : 0;
      return {
        subjudul: `${teksPeriode(f)} — per ${f.kelompok === 'bulanan' ? 'bulan' : 'hari'}`,
        ringkasan: [
          { label: 'Jumlah transaksi', nilai: total.transaksi, tipe: 'angka' },
          { label: 'Penjualan bersih', nilai: total.bersih, tipe: 'uang' },
          { label: 'Laba kotor', nilai: total.laba_kotor, tipe: 'uang' },
        ],
        bagian: [{
          kolom: [{ kunci: 'periode', label: f.kelompok === 'bulanan' ? 'Bulan' : 'Tanggal', tipe: f.kelompok === 'bulanan' ? 'teks' : 'tanggal' },
            { kunci: 'transaksi', label: 'Transaksi', tipe: 'angka' }, { kunci: 'total', label: 'Penjualan', tipe: 'uang' },
            { kunci: 'retur', label: 'Retur', tipe: 'uang' }, { kunci: 'bersih', label: 'Penjualan Bersih', tipe: 'uang' },
            { kunci: 'ppn', label: 'PPN', tipe: 'uang' }, { kunci: 'hpp', label: 'HPP', tipe: 'uang' },
            { kunci: 'laba_kotor', label: 'Laba Kotor', tipe: 'uang' }, { kunci: 'rata', label: 'Rata-rata/Transaksi', tipe: 'uang' }],
          baris,
          total,
        }],
        catatan: 'Penjualan termasuk PPN; laba kotor = penjualan bersih - PPN - HPP. Retur dikelompokkan menurut tanggal retur.',
      };
    },
  },
  {
    kode: 'penjualan-tutup-kasir',
    judul: 'Rekap Kasir & Metode Bayar (Tutup Kasir)',
    izin: 'pos.view',
    orientasi: 'landscape',
    deskripsi: 'Rekap penjualan per tanggal, kasir, dan metode bayar beserta retur untuk tutup kasir (tanpa tanggal: hari ini).',
    filter: [
      ...periode(),
      pilih('kasir', 'Kasir', opsiKasir),
      pilih('metode', 'Metode bayar', opsiMetode),
      pilih('unit_usaha_id', 'Unit usaha', opsiUnit),
    ],
    susun(f0, ctx) {
      const f = isiPeriode(f0, (t) => t);
      // Kasir toko hanya melihat rekapnya sendiri (sama dengan /api/pos/rekap)
      const g = ctx?.user?.role === 'kasir_toko' ? { ...f, kasir: ctx.user.username } : f;
      const w = filterPenjualan(tanggal(kondisi().tambah(PENJUALAN_SAH), 'j.tanggal', g), g);
      const rinci = all(
        `SELECT j.tanggal, j.kasir, j.metode_bayar, COUNT(*) AS transaksi, SUM(j.total) AS total,
                SUM(j.diskon) AS diskon, SUM(j.pajak) AS pajak, SUM(j.bayar) AS bayar, SUM(j.kembali) AS kembali,
                SUM(j.hpp) AS hpp
           FROM penjualan j ${w.where()}
          GROUP BY j.tanggal, j.kasir, j.metode_bayar ORDER BY j.tanggal, j.kasir, j.metode_bayar`, w.params);
      const retur = dataRetur(g);
      const perMetode = new Map();
      for (const r of rinci) {
        const x = perMetode.get(r.metode_bayar) || { metode: r.metode_bayar, transaksi: 0, total: 0, retur: 0 };
        x.transaksi += r.transaksi; x.total += r.total;
        perMetode.set(r.metode_bayar, x);
      }
      for (const r of retur) {
        const x = perMetode.get(r.metode_bayar) || { metode: r.metode_bayar, transaksi: 0, total: 0, retur: 0 };
        x.retur += r.nilai_retur;
        perMetode.set(r.metode_bayar, x);
      }
      const metode = [...perMetode.values()].map((x) => ({ ...x, neto: x.total - x.retur, metode: teksMetode(x.metode), _m: x.metode }));
      const perKasir = new Map();
      for (const r of rinci) {
        const x = perKasir.get(r.kasir) || { kasir: r.kasir || '-', transaksi: 0, total: 0, pajak: 0, hpp: 0 };
        x.transaksi += r.transaksi; x.total += r.total; x.pajak += r.pajak; x.hpp += r.hpp;
        perKasir.set(r.kasir, x);
      }
      const kasir = [...perKasir.values()].map((x) => ({ ...x, laba_kotor: x.total - x.pajak - x.hpp }));
      const tunai = metode.find((m) => m._m === 'tunai');
      return {
        subjudul: teksPeriode(g, 'Tanggal'),
        ringkasan: [
          { label: 'Jumlah transaksi', nilai: rinci.reduce((s, r) => s + r.transaksi, 0), tipe: 'angka' },
          { label: 'Total penjualan', nilai: rinci.reduce((s, r) => s + r.total, 0), tipe: 'uang' },
          { label: 'Retur (pengembalian dana)', nilai: retur.reduce((s, r) => s + r.nilai_retur, 0), tipe: 'uang' },
          { label: 'Kas tunai neto (penjualan tunai - retur tunai)', nilai: tunai ? tunai.neto : 0, tipe: 'uang' },
        ],
        bagian: [
          {
            judul: 'Rincian per tanggal, kasir, dan metode bayar',
            kolom: [{ kunci: 'tanggal', label: 'Tanggal', tipe: 'tanggal' }, { kunci: 'kasir', label: 'Kasir' },
              { kunci: 'metode', label: 'Metode' }, { kunci: 'transaksi', label: 'Transaksi', tipe: 'angka' },
              { kunci: 'total', label: 'Penjualan', tipe: 'uang' }, { kunci: 'diskon', label: 'Diskon', tipe: 'uang' },
              { kunci: 'pajak', label: 'PPN', tipe: 'uang' }, { kunci: 'bayar', label: 'Uang Diterima', tipe: 'uang' },
              { kunci: 'kembali', label: 'Kembalian', tipe: 'uang' }],
            baris: rinci.map((r) => ({ ...r, metode: teksMetode(r.metode_bayar) })),
            total: jumlahkan(rinci, ['transaksi', 'total', 'diskon', 'pajak', 'bayar', 'kembali']),
          },
          {
            judul: 'Rekap per metode bayar',
            kolom: [{ kunci: 'metode', label: 'Metode Bayar' }, { kunci: 'transaksi', label: 'Transaksi', tipe: 'angka' },
              { kunci: 'total', label: 'Penjualan', tipe: 'uang' }, { kunci: 'retur', label: 'Retur', tipe: 'uang' },
              { kunci: 'neto', label: 'Neto', tipe: 'uang' }],
            baris: metode,
            total: jumlahkan(metode, ['transaksi', 'total', 'retur', 'neto']),
          },
          {
            judul: 'Rekap per kasir',
            kolom: [{ kunci: 'kasir', label: 'Kasir' }, { kunci: 'transaksi', label: 'Transaksi', tipe: 'angka' },
              { kunci: 'total', label: 'Penjualan', tipe: 'uang' }, { kunci: 'pajak', label: 'PPN', tipe: 'uang' },
              { kunci: 'hpp', label: 'HPP', tipe: 'uang' }, { kunci: 'laba_kotor', label: 'Laba Kotor', tipe: 'uang' }],
            baris: kasir,
            total: jumlahkan(kasir, ['transaksi', 'total', 'pajak', 'hpp', 'laba_kotor']),
          },
        ],
        catatan: 'Retur dikembalikan melalui metode bayar semula dan dikelompokkan menurut tanggal retur.',
      };
    },
  },
  {
    kode: 'penjualan-retur',
    judul: 'Retur Penjualan',
    izin: 'penjualan.view',
    orientasi: 'landscape',
    deskripsi: 'Barang retur penjualan per periode beserta nilai pengembalian, HPP, dan alasan retur.',
    filter: [
      ...periode({ label: 'Tanggal retur' }),
      ...FILTER_BARANG,
      pilih('metode', 'Metode bayar nota', opsiMetode),
      pilih('pembeli', 'Pembeli', OPSI_PEMBELI),
    ],
    susun(f) {
      const data = dataRetur(f);
      // Alasan retur tersimpan pada keterangan jurnal retur ("Retur penjualan <nomor> - <alasan>")
      const ref = [...new Set(data.map((r) => r.referensi))];
      const alasan = new Map();
      for (let i = 0; i < ref.length; i += 500) {
        const potong = ref.slice(i, i + 500);
        for (const j of all(`SELECT referensi, tanggal, keterangan FROM jurnal WHERE referensi IN (${potong.map(() => '?').join(',')})`, potong)) {
          alasan.set(`${j.referensi}|${j.tanggal}`, String(j.keterangan || '').replace(/^Retur penjualan \S+ - /, ''));
        }
      }
      const baris = bernomor(data.map((r) => ({
        tanggal: r.tanggal, nomor: r.nomor, tanggal_nota: r.tanggal_nota, pembeli: r.pembeli,
        kode: r.kode, nama: r.nama, qty: r.qty, satuan: r.satuan, nilai_retur: r.nilai_retur, hpp: r.hpp,
        metode: teksMetode(r.metode_bayar), alasan: alasan.get(`${r.referensi}|${r.tanggal}`) || '',
      })));
      const total = jumlahkan(baris, ['nilai_retur', 'hpp']);
      return {
        subjudul: teksPeriode(f, 'Retur'),
        ringkasan: [
          { label: 'Jumlah baris retur', nilai: baris.length, tipe: 'angka' },
          { label: 'Jumlah nota', nilai: new Set(data.map((r) => r.penjualan_id)).size, tipe: 'angka' },
          { label: 'Nilai retur', nilai: total.nilai_retur, tipe: 'uang' },
        ],
        bagian: [{
          kolom: [KOLOM_NO, { kunci: 'tanggal', label: 'Tgl Retur', tipe: 'tanggal' }, { kunci: 'nomor', label: 'No. Nota' },
            { kunci: 'tanggal_nota', label: 'Tgl Nota', tipe: 'tanggal' }, { kunci: 'pembeli', label: 'Pembeli' },
            { kunci: 'kode', label: 'Kode' }, { kunci: 'nama', label: 'Nama Barang' },
            { kunci: 'qty', label: 'Qty', tipe: 'angka' }, { kunci: 'satuan', label: 'Satuan' },
            { kunci: 'nilai_retur', label: 'Nilai Retur', tipe: 'uang' }, { kunci: 'hpp', label: 'HPP', tipe: 'uang' },
            { kunci: 'metode', label: 'Dikembalikan via' }, { kunci: 'alasan', label: 'Alasan' }],
          baris,
          total,
        }],
        catatan: 'Nilai retur dihitung proporsional terhadap total nota (diskon nota, poin, dan PPN ikut terkoreksi).',
      };
    },
  },
  {
    kode: 'piutang-usaha',
    judul: 'Piutang Usaha & Umur Piutang',
    izin: 'penjualan.view',
    orientasi: 'landscape',
    deskripsi: 'Piutang penjualan kredit per tanggal acuan dengan analisis umur (aging).',
    filter: [
      { kunci: 'per_tanggal', label: 'Per tanggal', tipe: 'tanggal', bawaan: hariIni },
      ...periode({ label: 'Tanggal transaksi' }),
      pilih('status', 'Status', OPSI_STATUS_TAGIHAN),
      pilih('customer_id', 'Pelanggan', () => all("SELECT id AS nilai, kode || ' - ' || nama AS teks FROM customer ORDER BY kode")),
      { kunci: 'pihak', label: 'Nama pihak memuat', tipe: 'teks' },
    ].map((x) => (x.kunci === 'status' ? { ...x, bawaan: 'terbuka' } : x)),
    susun(f) {
      const { acuan, baris } = dataHutangPiutang('piutang', f);
      const kunci = ['nominal', 'terbayar', 'sisa', ...KOLOM_UMUR.map((k) => k.kunci)];
      const total = jumlahkan(baris, kunci);
      return {
        subjudul: `Per ${tanggalPanjang(acuan)}`,
        ringkasan: [
          { label: 'Jumlah tagihan', nilai: baris.length, tipe: 'angka' },
          { label: 'Sisa piutang', nilai: total.sisa, tipe: 'uang' },
          { label: 'Lewat jatuh tempo', nilai: total.sisa - total.belum_jt, tipe: 'uang' },
        ],
        bagian: [{
          kolom: [KOLOM_NO, { kunci: 'nomor_dokumen', label: 'No. Nota' }, { kunci: 'pihak', label: 'Pihak' },
            { kunci: 'tanggal', label: 'Tanggal', tipe: 'tanggal' }, { kunci: 'jatuh_tempo', label: 'Jatuh Tempo', tipe: 'tanggal' },
            { kunci: 'nominal', label: 'Nominal', tipe: 'uang' }, { kunci: 'terbayar', label: 'Terbayar', tipe: 'uang' },
            { kunci: 'sisa', label: 'Sisa', tipe: 'uang' }, { kunci: 'umur_hari', label: 'Lewat JT (hari)', tipe: 'angka' },
            ...KOLOM_UMUR],
          baris: bernomor(baris),
          total,
        }],
        catatan: 'Umur dihitung dari jatuh tempo sampai tanggal acuan. Pembayaran dihitung dari jurnal pelunasan '
          + 's.d. tanggal acuan; pengurangan piutang karena retur mengikuti nilai tagihan terkini.',
      };
    },
  },

  // =============================== PEMBELIAN ===============================
  {
    kode: 'pembelian-daftar',
    judul: 'Daftar Permintaan & Pesanan Pembelian',
    izin: 'pembelian.view',
    orientasi: 'landscape',
    deskripsi: 'Dokumen PR/PO per periode dengan status (termasuk batal beserta alasannya), supplier, dan gudang.',
    filter: [
      ...periode(),
      ...rentang('nomor', 'Nomor dokumen'),
      pilih('tipe', 'Jenis dokumen', [{ nilai: 'pr', teks: 'Permintaan (PR)' }, { nilai: 'po', teks: 'Pesanan (PO)' }]),
      pilih('status', 'Status', ['draft', 'diajukan', 'disetujui', 'diterima', 'selesai', 'batal']),
      pilih('supplier_id', 'Supplier', opsiSupplier),
      pilih('gudang_id', 'Gudang', opsiGudang),
      pilih('unit_usaha_id', 'Unit usaha', opsiUnit),
    ],
    susun(f) {
      const w = tanggal(kondisi(), 'p.tanggal', f).rentang('p.nomor', f, 'nomor').sama('p.tipe', f.tipe)
        .sama('p.status', f.status).sama('p.supplier_id', f.supplier_id).sama('p.gudang_id', f.gudang_id)
        .sama('p.unit_usaha_id', f.unit_usaha_id);
      const baris = bernomor(all(
        `SELECT p.nomor, p.tanggal, UPPER(p.tipe) AS tipe, s.nama AS supplier, g.nama AS gudang,
                p.subtotal, p.diskon, p.pajak, p.total, p.terbayar, p.jatuh_tempo, p.status,
                p.alasan_batal, p.dibuat_oleh
           FROM pembelian p LEFT JOIN supplier s ON s.id = p.supplier_id LEFT JOIN gudang g ON g.id = p.gudang_id
           ${w.where()} ORDER BY p.tanggal, p.id`, w.params));
      const aktif = baris.filter((r) => r.status !== 'batal');
      return {
        subjudul: teksPeriode(f),
        ringkasan: [
          { label: 'Jumlah dokumen', nilai: baris.length, tipe: 'angka' },
          { label: 'Dibatalkan', nilai: baris.length - aktif.length, tipe: 'angka' },
          { label: 'Nilai (tanpa batal)', nilai: aktif.reduce((s, r) => s + r.total, 0), tipe: 'uang' },
        ],
        bagian: [{
          kolom: [KOLOM_NO, { kunci: 'nomor', label: 'Nomor' }, { kunci: 'tanggal', label: 'Tanggal', tipe: 'tanggal' },
            { kunci: 'tipe', label: 'Jenis' }, { kunci: 'supplier', label: 'Supplier' }, { kunci: 'gudang', label: 'Gudang' },
            { kunci: 'subtotal', label: 'Subtotal', tipe: 'uang' }, { kunci: 'diskon', label: 'Diskon', tipe: 'uang' },
            { kunci: 'pajak', label: 'PPN', tipe: 'uang' }, { kunci: 'total', label: 'Total', tipe: 'uang' },
            { kunci: 'terbayar', label: 'Terbayar', tipe: 'uang' }, { kunci: 'jatuh_tempo', label: 'Jatuh Tempo', tipe: 'tanggal' },
            { kunci: 'status', label: 'Status' }, { kunci: 'alasan_batal', label: 'Alasan Batal' },
            { kunci: 'dibuat_oleh', label: 'Dibuat Oleh' }],
          baris,
          total: jumlahkan(aktif, ['subtotal', 'diskon', 'pajak', 'total', 'terbayar'], 'TOTAL (tanpa batal)'),
        }],
      };
    },
  },
  {
    kode: 'pembelian-per-barang',
    judul: 'Pembelian per Barang',
    izin: 'pembelian.view',
    orientasi: 'landscape',
    deskripsi: 'Kuantitas dipesan, diterima, sisa, nilai, dan harga rata-rata pembelian per barang.',
    filter: [
      ...periode(),
      ...FILTER_BARANG,
      pilih('supplier_id', 'Supplier', opsiSupplier),
      pilih('tipe', 'Jenis dokumen', [{ nilai: 'pr', teks: 'Permintaan (PR)' }, { nilai: 'po', teks: 'Pesanan (PO)' }]),
    ],
    susun(f) {
      const w = tanggal(kondisi().tambah("p.status <> 'batal'"), 'p.tanggal', f).rentang('b.kode', f, 'kode')
        .sama('b.kategori_id', f.kategori_id).sama('p.supplier_id', f.supplier_id).sama('p.tipe', f.tipe);
      const baris = bernomor(all(
        `SELECT b.kode, b.nama, k.nama AS kategori, b.satuan, COUNT(DISTINCT p.id) AS dokumen,
                SUM(d.qty) AS qty, SUM(d.qty_diterima) AS qty_diterima, SUM(d.qty - d.qty_diterima) AS qty_sisa,
                SUM(d.subtotal) AS nilai, SUM(d.qty_diterima * d.subtotal * 1.0 / d.qty) AS nilai_diterima
           FROM pembelian_detail d JOIN pembelian p ON p.id = d.pembelian_id
           JOIN barang b ON b.id = d.barang_id LEFT JOIN kategori_barang k ON k.id = b.kategori_id
           ${w.where()} GROUP BY b.id ORDER BY b.kode`, w.params)
        .map((r) => ({ ...r, nilai_diterima: bulat(r.nilai_diterima), harga_rata: r.qty ? bulat(r.nilai / r.qty) : 0 })));
      const total = jumlahkan(baris, ['nilai', 'nilai_diterima']);
      return {
        subjudul: teksPeriode(f),
        ringkasan: [
          { label: 'Jumlah barang', nilai: baris.length, tipe: 'angka' },
          { label: 'Nilai pesanan', nilai: total.nilai, tipe: 'uang' },
          { label: 'Nilai diterima', nilai: total.nilai_diterima, tipe: 'uang' },
        ],
        bagian: [{
          kolom: [KOLOM_NO, { kunci: 'kode', label: 'Kode' }, { kunci: 'nama', label: 'Nama Barang' },
            { kunci: 'kategori', label: 'Kategori' }, { kunci: 'satuan', label: 'Satuan' },
            { kunci: 'dokumen', label: 'Dokumen', tipe: 'angka' }, { kunci: 'qty', label: 'Qty Dipesan', tipe: 'angka' },
            { kunci: 'qty_diterima', label: 'Qty Diterima', tipe: 'angka' }, { kunci: 'qty_sisa', label: 'Sisa', tipe: 'angka' },
            { kunci: 'harga_rata', label: 'Harga Rata-rata', tipe: 'uang' }, { kunci: 'nilai', label: 'Nilai Pesanan', tipe: 'uang' },
            { kunci: 'nilai_diterima', label: 'Nilai Diterima', tipe: 'uang' }],
          baris,
          total,
        }],
        catatan: 'Dokumen berstatus batal tidak diikutkan. Nilai sebelum diskon nota dan PPN.',
      };
    },
  },
  {
    kode: 'pembelian-penerimaan',
    judul: 'Penerimaan Barang',
    izin: 'pembelian.view',
    orientasi: 'landscape',
    deskripsi: 'Barang yang diterima dari pembelian per periode, termasuk batch dan tanggal kedaluwarsa.',
    filter: [
      ...periode({ label: 'Tanggal terima' }),
      ...FILTER_BARANG,
      pilih('supplier_id', 'Supplier', opsiSupplier),
      pilih('gudang_id', 'Gudang', opsiGudang),
    ],
    susun(f) {
      const w = tanggal(kondisi().tambah("m.jenis = 'masuk'").tambah("m.referensi LIKE 'pembelian:%'"), 'm.tanggal', f)
        .rentang('b.kode', f, 'kode').sama('b.kategori_id', f.kategori_id)
        .sama('p.supplier_id', f.supplier_id).sama('m.gudang_id', f.gudang_id);
      const data = all(
        `SELECT m.tanggal, p.id AS pembelian_id, p.nomor, s.nama AS supplier, g.nama AS gudang, b.kode, b.nama,
                m.qty, b.satuan, m.harga, (m.qty * m.harga) AS nilai, m.batch, m.expired
           FROM mutasi_stok m JOIN pembelian p ON p.id = CAST(substr(m.referensi, 11) AS INTEGER)
           JOIN barang b ON b.id = m.barang_id JOIN gudang g ON g.id = m.gudang_id
           LEFT JOIN supplier s ON s.id = p.supplier_id
           ${w.where()} ORDER BY m.tanggal, m.id`, w.params);
      const baris = bernomor(data.map(({ pembelian_id: _, ...r }) => ({ ...r, nilai: bulat(r.nilai) })));
      const total = jumlahkan(baris, ['nilai']);
      return {
        subjudul: teksPeriode(f, 'Diterima'),
        ringkasan: [
          { label: 'Jumlah dokumen', nilai: new Set(data.map((r) => r.pembelian_id)).size, tipe: 'angka' },
          { label: 'Jumlah baris', nilai: baris.length, tipe: 'angka' },
          { label: 'Nilai penerimaan', nilai: total.nilai, tipe: 'uang' },
        ],
        bagian: [{
          kolom: [KOLOM_NO, { kunci: 'tanggal', label: 'Tgl Terima', tipe: 'tanggal' }, { kunci: 'nomor', label: 'No. PO' },
            { kunci: 'supplier', label: 'Supplier' }, { kunci: 'gudang', label: 'Gudang' }, { kunci: 'kode', label: 'Kode' },
            { kunci: 'nama', label: 'Nama Barang' }, { kunci: 'qty', label: 'Qty', tipe: 'angka' },
            { kunci: 'satuan', label: 'Satuan' }, { kunci: 'harga', label: 'Harga Netto', tipe: 'uang' },
            { kunci: 'nilai', label: 'Nilai', tipe: 'uang' }, { kunci: 'batch', label: 'Batch' },
            { kunci: 'expired', label: 'Kedaluwarsa', tipe: 'tanggal' }],
          baris,
          total,
        }],
        catatan: 'Harga netto = subtotal baris pesanan dibagi kuantitas (sebelum PPN masukan).',
      };
    },
  },
  {
    kode: 'hutang-supplier',
    judul: 'Hutang Usaha per Supplier',
    izin: 'pembelian.view',
    orientasi: 'landscape',
    deskripsi: 'Saldo hutang pembelian per supplier per tanggal acuan beserta umur hutang.',
    filter: [
      { kunci: 'per_tanggal', label: 'Per tanggal', tipe: 'tanggal', bawaan: hariIni },
      ...periode({ label: 'Tanggal tagihan' }),
      pilih('supplier_id', 'Supplier', opsiSupplier),
      pilih('status', 'Status', OPSI_STATUS_TAGIHAN),
    ].map((x) => (x.kunci === 'status' ? { ...x, bawaan: 'terbuka' } : x)),
    susun(f) {
      const { acuan, baris } = dataHutangPiutang('hutang', f);
      const kunciUmur = KOLOM_UMUR.map((k) => k.kunci);
      const rekap = new Map();
      for (const r of baris) {
        const x = rekap.get(r.pihak) || { supplier: r.pihak, kode: r.supplier_kode, tagihan: 0, nominal: 0, terbayar: 0,
          sisa: 0, jatuh_tempo: null, ...Object.fromEntries(kunciUmur.map((k) => [k, 0])) };
        x.tagihan += 1; x.nominal += r.nominal; x.terbayar += r.terbayar; x.sisa += r.sisa;
        for (const k of kunciUmur) x[k] += r[k];
        if (r.sisa > 0 && r.jatuh_tempo && (!x.jatuh_tempo || r.jatuh_tempo < x.jatuh_tempo)) x.jatuh_tempo = r.jatuh_tempo;
        rekap.set(r.pihak, x);
      }
      const perSupplier = bernomor([...rekap.values()]);
      const kunci = ['nominal', 'terbayar', 'sisa', ...kunciUmur];
      const total = jumlahkan(baris, kunci);
      return {
        subjudul: `Per ${tanggalPanjang(acuan)}`,
        ringkasan: [
          { label: 'Jumlah supplier', nilai: perSupplier.length, tipe: 'angka' },
          { label: 'Sisa hutang', nilai: total.sisa, tipe: 'uang' },
          { label: 'Lewat jatuh tempo', nilai: total.sisa - total.belum_jt, tipe: 'uang' },
        ],
        bagian: [
          {
            judul: 'Rekap per supplier',
            kolom: [KOLOM_NO, { kunci: 'kode', label: 'Kode' }, { kunci: 'supplier', label: 'Supplier' },
              { kunci: 'tagihan', label: 'Tagihan', tipe: 'angka' }, { kunci: 'nominal', label: 'Nominal', tipe: 'uang' },
              { kunci: 'terbayar', label: 'Terbayar', tipe: 'uang' }, { kunci: 'sisa', label: 'Sisa', tipe: 'uang' },
              { kunci: 'jatuh_tempo', label: 'JT Terdekat', tipe: 'tanggal' }, ...KOLOM_UMUR],
            baris: perSupplier,
            total: jumlahkan(perSupplier, ['tagihan', ...kunci]),
          },
          {
            judul: 'Rincian tagihan',
            kolom: [KOLOM_NO, { kunci: 'nomor_dokumen', label: 'No. PO' }, { kunci: 'pihak', label: 'Supplier' },
              { kunci: 'tanggal', label: 'Tanggal', tipe: 'tanggal' }, { kunci: 'jatuh_tempo', label: 'Jatuh Tempo', tipe: 'tanggal' },
              { kunci: 'nominal', label: 'Nominal', tipe: 'uang' }, { kunci: 'terbayar', label: 'Terbayar', tipe: 'uang' },
              { kunci: 'sisa', label: 'Sisa', tipe: 'uang' }, { kunci: 'umur_hari', label: 'Lewat JT (hari)', tipe: 'angka' }],
            baris: bernomor(baris),
            total: jumlahkan(baris, ['nominal', 'terbayar', 'sisa']),
          },
        ],
        catatan: 'Umur dihitung dari jatuh tempo sampai tanggal acuan. Pembayaran dihitung dari jurnal pembayaran hutang s.d. tanggal acuan.',
      };
    },
  },
  {
    kode: 'evaluasi-supplier',
    judul: 'Evaluasi Supplier',
    izin: 'pembelian.view',
    orientasi: 'landscape',
    deskripsi: 'Kinerja supplier per periode: nilai pesanan & penerimaan, tingkat penyelesaian, pemenuhan, dan lead time.',
    filter: [
      ...periode({ label: 'Tanggal dokumen' }),
      pilih('status', 'Status supplier', ['aktif', 'nonaktif']),
      pilih('transaksi', 'Tampilkan', [{ nilai: 'ada', teks: 'Hanya supplier bertransaksi' }, { nilai: 'semua', teks: 'Semua supplier' }]),
    ].map((x) => (x.kunci === 'transaksi' ? { ...x, bawaan: 'ada' } : x)),
    susun(f) {
      const wp = tanggal(kondisi(), 'p.tanggal', f);
      const ws = kondisi().sama('s.status', f.status);
      const dataPo = new Map(all(
        `WITH terima AS (
           SELECT referensi, MIN(tanggal) AS pertama, SUM(qty * harga) AS nilai
             FROM mutasi_stok WHERE jenis = 'masuk' AND referensi LIKE 'pembelian:%' GROUP BY referensi
         )
         SELECT p.supplier_id, COUNT(*) AS dokumen,
                SUM(CASE WHEN p.status <> 'batal' THEN p.total ELSE 0 END) AS nilai_po,
                SUM(p.status = 'selesai') AS selesai, SUM(p.status = 'batal') AS batal,
                COALESCE(SUM(t.nilai), 0) AS nilai_terima,
                AVG(CASE WHEN t.pertama IS NOT NULL THEN julianday(t.pertama) - julianday(p.tanggal) END) AS lead_time
           FROM pembelian p LEFT JOIN terima t ON t.referensi = 'pembelian:' || p.id
           ${wp.where()} GROUP BY p.supplier_id`, wp.params).map((r) => [r.supplier_id, r]));
      const wq = tanggal(kondisi().tambah("p.status <> 'batal'"), 'p.tanggal', f);
      const pemenuhan = new Map(all(
        `SELECT p.supplier_id, SUM(d.qty) AS qty, SUM(d.qty_diterima) AS diterima
           FROM pembelian_detail d JOIN pembelian p ON p.id = d.pembelian_id ${wq.where()} GROUP BY p.supplier_id`,
        wq.params).map((r) => [r.supplier_id, r]));
      const hutang = new Map(all(
        `SELECT supplier_id, SUM(nominal - terbayar) AS sisa FROM hutang_piutang
          WHERE jenis = 'hutang' AND status = 'terbuka' GROUP BY supplier_id`).map((r) => [r.supplier_id, r.sisa]));
      const baris = all(`SELECT s.id, s.kode, s.nama, s.rating, s.termin_hari, s.status FROM supplier s ${ws.where()}`, ws.params)
        .map((s) => {
          const p = dataPo.get(s.id) || { dokumen: 0, nilai_po: 0, selesai: 0, batal: 0, nilai_terima: 0, lead_time: null };
          const q = pemenuhan.get(s.id);
          const aktif = p.dokumen - p.batal;
          return {
            kode: s.kode, nama: s.nama, rating: s.rating, termin_hari: s.termin_hari, status: s.status,
            dokumen: p.dokumen, nilai_po: p.nilai_po, nilai_terima: bulat(p.nilai_terima), selesai: p.selesai, batal: p.batal,
            penyelesaian: persen(p.selesai, aktif), pemenuhan: q ? persen(q.diterima, q.qty) : 0,
            lead_time: p.lead_time === null ? null : Number(p.lead_time.toFixed(1)), hutang: hutang.get(s.id) || 0,
          };
        })
        .filter((r) => f.transaksi === 'semua' || r.dokumen > 0)
        .sort((a, b) => b.nilai_po - a.nilai_po);
      return {
        subjudul: teksPeriode(f),
        ringkasan: [
          { label: 'Jumlah supplier', nilai: baris.length, tipe: 'angka' },
          { label: 'Nilai pesanan', nilai: baris.reduce((s, r) => s + r.nilai_po, 0), tipe: 'uang' },
          { label: 'Hutang terbuka', nilai: baris.reduce((s, r) => s + r.hutang, 0), tipe: 'uang' },
        ],
        bagian: [{
          kolom: [KOLOM_NO, { kunci: 'kode', label: 'Kode' }, { kunci: 'nama', label: 'Supplier' },
            { kunci: 'rating', label: 'Rating', tipe: 'angka' }, { kunci: 'termin_hari', label: 'Termin (hari)', tipe: 'angka' },
            { kunci: 'dokumen', label: 'Dokumen', tipe: 'angka' }, { kunci: 'batal', label: 'Batal', tipe: 'angka' },
            { kunci: 'selesai', label: 'Selesai', tipe: 'angka' }, { kunci: 'nilai_po', label: 'Nilai Pesanan', tipe: 'uang' },
            { kunci: 'nilai_terima', label: 'Nilai Diterima', tipe: 'uang' },
            { kunci: 'penyelesaian', label: 'Penyelesaian', tipe: 'persen' }, { kunci: 'pemenuhan', label: 'Pemenuhan Qty', tipe: 'persen' },
            { kunci: 'lead_time', label: 'Lead Time (hari)', tipe: 'angka' }, { kunci: 'hutang', label: 'Hutang Terbuka', tipe: 'uang' }],
          baris: bernomor(baris),
          total: jumlahkan(baris, ['dokumen', 'batal', 'selesai', 'nilai_po', 'nilai_terima', 'hutang']),
        }],
        catatan: 'Penyelesaian = dokumen selesai / dokumen tidak batal. Pemenuhan = qty diterima / qty dipesan. '
          + 'Lead time = rata-rata hari dari tanggal dokumen sampai penerimaan pertama. Hutang terbuka per hari ini.',
      };
    },
  },

  // =============================== PERSEDIAAN ===============================
  {
    kode: 'persediaan-posisi',
    judul: 'Posisi Stok & Nilai Persediaan',
    izin: 'persediaan.view',
    orientasi: 'landscape',
    deskripsi: 'Kuantitas dan nilai persediaan per gudang pada tanggal tertentu.',
    filter: [
      { kunci: 'per_tanggal', label: 'Per tanggal', tipe: 'tanggal', bawaan: hariIni },
      pilih('gudang_id', 'Gudang', opsiGudang),
      ...FILTER_BARANG,
      pilih('nol', 'Barang bersaldo nol', [{ nilai: 'sembunyikan', teks: 'Sembunyikan' }, { nilai: 'tampilkan', teks: 'Tampilkan' }]),
    ].map((x) => (x.kunci === 'nol' ? { ...x, bawaan: 'sembunyikan' } : x)),
    susun(f) {
      const w = kondisi().tambah('m.tanggal <= ?', f.per_tanggal).sama('m.gudang_id', f.gudang_id)
        .rentang('b.kode', f, 'kode').sama('b.kategori_id', f.kategori_id);
      const data = all(
        `SELECT g.id AS gudang_id, g.kode AS gudang_kode, g.nama AS gudang, b.kode, b.nama, k.nama AS kategori,
                b.satuan, b.harga_beli, SUM(m.qty) AS qty
           FROM mutasi_stok m JOIN barang b ON b.id = m.barang_id JOIN gudang g ON g.id = m.gudang_id
           LEFT JOIN kategori_barang k ON k.id = b.kategori_id
           ${w.where()} GROUP BY m.gudang_id, m.barang_id ORDER BY g.kode, b.kode`, w.params)
        .filter((r) => f.nol === 'tampilkan' || Math.abs(r.qty) > 1e-9)
        .map((r) => ({ ...r, nilai: bulat(r.qty * r.harga_beli) }));
      const perGudang = new Map();
      for (const r of data) {
        if (!perGudang.has(r.gudang_id)) perGudang.set(r.gudang_id, { nama: `${r.gudang_kode} - ${r.gudang}`, baris: [] });
        perGudang.get(r.gudang_id).baris.push(r);
      }
      const kolom = [KOLOM_NO, { kunci: 'kode', label: 'Kode' }, { kunci: 'nama', label: 'Nama Barang' },
        { kunci: 'kategori', label: 'Kategori' }, { kunci: 'satuan', label: 'Satuan' },
        { kunci: 'qty', label: 'Qty', tipe: 'angka' }, { kunci: 'harga_beli', label: 'HPP Rata-rata', tipe: 'uang' },
        { kunci: 'nilai', label: 'Nilai', tipe: 'uang' }];
      const bagian = [...perGudang.values()].map((g) => ({
        judul: `Gudang ${g.nama}`, kolom, baris: bernomor(g.baris),
        total: jumlahkan(g.baris, ['nilai'], `TOTAL ${g.nama}`),
      }));
      if (!bagian.length) bagian.push({ kolom, baris: [] });
      const totalNilai = data.reduce((s, r) => s + r.nilai, 0);
      return {
        subjudul: `Per ${tanggalPanjang(f.per_tanggal)}`,
        ringkasan: [
          { label: 'Jumlah gudang', nilai: perGudang.size, tipe: 'angka' },
          { label: 'Jumlah item', nilai: data.length, tipe: 'angka' },
          { label: 'Total nilai persediaan', nilai: totalNilai, tipe: 'uang' },
        ],
        bagian,
        catatan: 'Kuantitas dihitung dari mutasi stok s.d. tanggal acuan. Nilai memakai HPP rata-rata bergerak TERKINI '
          + '(master barang), bukan HPP historis pada tanggal acuan; untuk tanggal lampau nilai dapat berbeda dengan buku besar.',
      };
    },
  },
  {
    kode: 'kartu-stok',
    judul: 'Kartu Stok',
    izin: 'persediaan.view',
    orientasi: 'landscape',
    deskripsi: 'Riwayat mutasi dan saldo berjalan per barang untuk rentang kode barang dan periode (tanpa tanggal: bulan berjalan).',
    filter: [
      ...periode(),
      ...FILTER_BARANG,
      pilih('gudang_id', 'Gudang', opsiGudang),
    ],
    susun(f0) {
      const f = isiPeriode(f0, awalBulanDari);
      const wb = kondisi().rentang('b.kode', f, 'kode').sama('b.kategori_id', f.kategori_id);
      const gudang = f.gudang_id ? 'AND m.gudang_id = ?' : '';
      const pg = f.gudang_id ? [f.gudang_id] : [];
      const awal = new Map(all(
        `SELECT m.barang_id, SUM(m.qty) AS qty FROM mutasi_stok m JOIN barang b ON b.id = m.barang_id
          WHERE m.tanggal < ? ${gudang} ${wb.and()} GROUP BY m.barang_id`, [f.dari, ...pg, ...wb.params])
        .map((r) => [r.barang_id, r.qty]));
      const mutasi = all(
        `SELECT m.barang_id, m.tanggal, m.jenis, m.qty, m.harga, m.referensi, m.keterangan, m.batch, g.nama AS gudang
           FROM mutasi_stok m JOIN barang b ON b.id = m.barang_id JOIN gudang g ON g.id = m.gudang_id
          WHERE m.tanggal >= ? AND m.tanggal <= ? ${gudang} ${wb.and()}
          ORDER BY b.kode, m.tanggal, m.id`, [f.dari, f.sampai, ...pg, ...wb.params]);
      const perBarang = new Map();
      for (const m of mutasi) {
        if (!perBarang.has(m.barang_id)) perBarang.set(m.barang_id, []);
        perBarang.get(m.barang_id).push(m);
      }
      const id = new Set([...perBarang.keys(), ...[...awal].filter(([, q]) => Math.abs(q) > 1e-9).map(([k]) => k)]);
      const barang = id.size
        ? all(`SELECT b.id, b.kode, b.nama, b.satuan FROM barang b WHERE b.id IN (${[...id].map(() => '?').join(',')}) ORDER BY b.kode`, [...id])
        : [];
      const kolom = [{ kunci: 'tanggal', label: 'Tanggal', tipe: 'tanggal' }, { kunci: 'jenis', label: 'Jenis' },
        { kunci: 'referensi', label: 'Referensi' }, { kunci: 'keterangan', label: 'Keterangan' },
        { kunci: 'gudang', label: 'Gudang' }, { kunci: 'masuk', label: 'Masuk', tipe: 'angka' },
        { kunci: 'keluar', label: 'Keluar', tipe: 'angka' }, { kunci: 'saldo', label: 'Saldo', tipe: 'angka' },
        { kunci: 'harga', label: 'Harga', tipe: 'uang' }];
      const bagian = barang.map((b) => {
        let saldo = awal.get(b.id) || 0;
        const baris = [{ tanggal: f.dari, jenis: 'Saldo awal', saldo }];
        for (const m of perBarang.get(b.id) || []) {
          saldo += m.qty;
          baris.push({ tanggal: m.tanggal, jenis: teksJenis(m.jenis), referensi: m.referensi,
            keterangan: [m.keterangan, m.batch && `batch ${m.batch}`].filter(Boolean).join(' · '), gudang: m.gudang,
            masuk: m.qty > 0 ? m.qty : null, keluar: m.qty < 0 ? -m.qty : null, saldo, harga: m.harga });
        }
        const total = jumlahkan(baris.slice(1), ['masuk', 'keluar'], 'JUMLAH / SALDO AKHIR');
        total.saldo = saldo;
        return { judul: `${b.kode} - ${b.nama} (${b.satuan})`, kolom, baris, total };
      });
      if (!bagian.length) bagian.push({ kolom, baris: [] });
      return {
        subjudul: teksPeriode(f),
        ringkasan: [
          { label: 'Jumlah barang', nilai: barang.length, tipe: 'angka' },
          { label: 'Jumlah mutasi', nilai: mutasi.length, tipe: 'angka' },
        ],
        bagian,
        catatan: f.gudang_id ? undefined : 'Saldo merupakan gabungan seluruh gudang; pilih gudang untuk kartu stok per gudang.',
      };
    },
  },
  {
    kode: 'mutasi-stok',
    judul: 'Mutasi Stok',
    izin: 'persediaan.view',
    orientasi: 'landscape',
    deskripsi: 'Rekap saldo awal-masuk-keluar-saldo akhir per barang, atau rincian mutasi per jenis (tanpa tanggal: bulan berjalan).',
    filter: [
      ...periode(),
      pilih('tampilan', 'Tampilan', [{ nilai: 'rekap', teks: 'Rekap per barang' }, { nilai: 'rinci', teks: 'Rincian mutasi' }]),
      pilih('jenis', 'Jenis mutasi', Object.entries(JENIS_MUTASI).map(([nilai, teks]) => ({ nilai, teks }))),
      pilih('gudang_id', 'Gudang', opsiGudang),
      ...FILTER_BARANG,
    ].map((x) => (x.kunci === 'tampilan' ? { ...x, bawaan: 'rekap' } : x)),
    susun(f0) {
      const f = isiPeriode(f0, awalBulanDari);
      const wb = kondisi().sama('m.gudang_id', f.gudang_id).rentang('b.kode', f, 'kode').sama('b.kategori_id', f.kategori_id);
      const wj = kondisi().tambah('m.tanggal >= ?', f.dari).tambah('m.tanggal <= ?', f.sampai).sama('m.jenis', f.jenis);
      const perJenis = all(
        `SELECT m.jenis, COUNT(*) AS baris, SUM(CASE WHEN m.qty > 0 THEN m.qty ELSE 0 END) AS masuk,
                SUM(CASE WHEN m.qty < 0 THEN -m.qty ELSE 0 END) AS keluar, SUM(m.qty * m.harga) AS nilai
           FROM mutasi_stok m JOIN barang b ON b.id = m.barang_id ${wj.where()} ${wb.and()}
          GROUP BY m.jenis ORDER BY m.jenis`, [...wj.params, ...wb.params])
        .map((r) => ({ ...r, jenis: teksJenis(r.jenis), nilai: bulat(r.nilai) }));
      const bagianJenis = {
        judul: 'Rekap per jenis mutasi',
        kolom: [{ kunci: 'jenis', label: 'Jenis Mutasi' }, { kunci: 'baris', label: 'Jumlah Mutasi', tipe: 'angka' },
          { kunci: 'masuk', label: 'Qty Masuk', tipe: 'angka' }, { kunci: 'keluar', label: 'Qty Keluar', tipe: 'angka' },
          { kunci: 'nilai', label: 'Nilai (+/-)', tipe: 'uang' }],
        baris: perJenis,
        total: jumlahkan(perJenis, ['baris', 'nilai']),
      };
      if (f.tampilan === 'rinci') {
        const baris = bernomor(all(
          `SELECT m.tanggal, m.jenis, b.kode, b.nama, b.satuan, g.nama AS gudang, m.qty, m.harga,
                  (m.qty * m.harga) AS nilai, m.referensi, m.keterangan
             FROM mutasi_stok m JOIN barang b ON b.id = m.barang_id JOIN gudang g ON g.id = m.gudang_id
             ${wj.where()} ${wb.and()} ORDER BY m.tanggal, m.id`, [...wj.params, ...wb.params])
          .map((r) => ({ ...r, jenis: teksJenis(r.jenis), masuk: r.qty > 0 ? r.qty : null,
            keluar: r.qty < 0 ? -r.qty : null, nilai: bulat(r.nilai) })));
        return {
          subjudul: teksPeriode(f),
          ringkasan: [{ label: 'Jumlah mutasi', nilai: baris.length, tipe: 'angka' },
            { label: 'Nilai bersih (+/-)', nilai: baris.reduce((s, r) => s + r.nilai, 0), tipe: 'uang' }],
          bagian: [{
            judul: 'Rincian mutasi',
            kolom: [KOLOM_NO, { kunci: 'tanggal', label: 'Tanggal', tipe: 'tanggal' }, { kunci: 'jenis', label: 'Jenis' },
              { kunci: 'kode', label: 'Kode' }, { kunci: 'nama', label: 'Nama Barang' }, { kunci: 'gudang', label: 'Gudang' },
              { kunci: 'masuk', label: 'Masuk', tipe: 'angka' }, { kunci: 'keluar', label: 'Keluar', tipe: 'angka' },
              { kunci: 'satuan', label: 'Satuan' }, { kunci: 'harga', label: 'Harga', tipe: 'uang' },
              { kunci: 'nilai', label: 'Nilai', tipe: 'uang' }, { kunci: 'referensi', label: 'Referensi' },
              { kunci: 'keterangan', label: 'Keterangan' }],
            baris,
            total: jumlahkan(baris, ['nilai']),
          }, bagianJenis],
        };
      }
      // Rekap per barang: saldo awal + masuk - keluar = saldo akhir (seluruh jenis mutasi)
      const baris = bernomor(all(
        `SELECT b.kode, b.nama, k.nama AS kategori, b.satuan, b.harga_beli,
                SUM(CASE WHEN m.tanggal < ? THEN m.qty ELSE 0 END) AS awal,
                SUM(CASE WHEN m.tanggal >= ? AND m.qty > 0 THEN m.qty ELSE 0 END) AS masuk,
                SUM(CASE WHEN m.tanggal >= ? AND m.qty < 0 THEN -m.qty ELSE 0 END) AS keluar,
                SUM(m.qty) AS akhir
           FROM mutasi_stok m JOIN barang b ON b.id = m.barang_id LEFT JOIN kategori_barang k ON k.id = b.kategori_id
          WHERE m.tanggal <= ? ${wb.and()}
          GROUP BY b.id HAVING awal <> 0 OR masuk <> 0 OR keluar <> 0 ORDER BY b.kode`,
        [f.dari, f.dari, f.dari, f.sampai, ...wb.params])
        .map((r) => ({ ...r, nilai: bulat(r.akhir * r.harga_beli) })));
      return {
        subjudul: teksPeriode(f),
        ringkasan: [{ label: 'Jumlah barang', nilai: baris.length, tipe: 'angka' },
          { label: 'Nilai saldo akhir', nilai: baris.reduce((s, r) => s + r.nilai, 0), tipe: 'uang' }],
        bagian: [{
          judul: 'Rekap per barang',
          kolom: [KOLOM_NO, { kunci: 'kode', label: 'Kode' }, { kunci: 'nama', label: 'Nama Barang' },
            { kunci: 'kategori', label: 'Kategori' }, { kunci: 'satuan', label: 'Satuan' },
            { kunci: 'awal', label: 'Saldo Awal', tipe: 'angka' }, { kunci: 'masuk', label: 'Masuk', tipe: 'angka' },
            { kunci: 'keluar', label: 'Keluar', tipe: 'angka' }, { kunci: 'akhir', label: 'Saldo Akhir', tipe: 'angka' },
            { kunci: 'harga_beli', label: 'HPP Rata-rata', tipe: 'uang' }, { kunci: 'nilai', label: 'Nilai Akhir', tipe: 'uang' }],
          baris,
          total: jumlahkan(baris, ['nilai']),
        }, bagianJenis],
        catatan: `Rekap per barang mencakup seluruh jenis mutasi${f.jenis ? '; filter jenis hanya berlaku pada rekap per jenis' : ''}. `
          + 'Nilai akhir memakai HPP rata-rata bergerak terkini.',
      };
    },
  },
  {
    kode: 'stock-opname',
    judul: 'Hasil Stock Opname & Selisih',
    izin: 'persediaan.view',
    orientasi: 'landscape',
    jenis_ttd: 'stock_opname',
    deskripsi: 'Dokumen stock opname per periode beserta selisih kuantitas dan nilai per barang.',
    filter: [
      ...periode(),
      pilih('gudang_id', 'Gudang', opsiGudang),
      pilih('status', 'Status', ['draft', 'selesai', 'batal']),
      pilih('rincian', 'Rincian barang', [{ nilai: 'selisih', teks: 'Hanya yang berselisih' }, { nilai: 'semua', teks: 'Semua barang' }]),
    ].map((x) => (x.kunci === 'rincian' ? { ...x, bawaan: 'selisih' } : x)),
    susun(f) {
      const w = tanggal(kondisi(), 'o.tanggal', f).sama('o.gudang_id', f.gudang_id).sama('o.status', f.status);
      const dok = bernomor(all(
        `SELECT o.id, o.nomor, o.tanggal, g.nama AS gudang, o.status, o.petugas, o.keterangan, o.alasan_batal,
                COUNT(d.id) AS item, SUM(d.selisih <> 0) AS item_selisih,
                SUM(CASE WHEN d.nilai_selisih > 0 THEN d.nilai_selisih ELSE 0 END) AS lebih,
                SUM(CASE WHEN d.nilai_selisih < 0 THEN -d.nilai_selisih ELSE 0 END) AS kurang
           FROM stock_opname o JOIN gudang g ON g.id = o.gudang_id
           LEFT JOIN stock_opname_detail d ON d.opname_id = o.id
           ${w.where()} GROUP BY o.id ORDER BY o.tanggal, o.id`, w.params)
        .map((r) => ({ ...r, item_selisih: r.item_selisih || 0, lebih: r.lebih || 0, kurang: r.kurang || 0,
          bersih: (r.lebih || 0) - (r.kurang || 0) })));
      const ids = dok.map((d) => d.id);
      const rinci = ids.length ? all(
        `SELECT o.nomor, b.kode, b.nama, b.satuan, d.qty_sistem, d.qty_fisik, d.selisih, d.nilai_selisih, d.keterangan
           FROM stock_opname_detail d JOIN stock_opname o ON o.id = d.opname_id JOIN barang b ON b.id = d.barang_id
          WHERE d.opname_id IN (${ids.map(() => '?').join(',')}) ${f.rincian === 'semua' ? '' : 'AND d.selisih <> 0'}
          ORDER BY o.tanggal, o.id, b.kode`, ids) : [];
      const total = jumlahkan(dok, ['item', 'item_selisih', 'lebih', 'kurang', 'bersih']);
      return {
        subjudul: teksPeriode(f),
        ringkasan: [
          { label: 'Jumlah dokumen', nilai: dok.length, tipe: 'angka' },
          { label: 'Selisih lebih', nilai: total.lebih, tipe: 'uang' },
          { label: 'Selisih kurang', nilai: total.kurang, tipe: 'uang' },
        ],
        bagian: [
          {
            judul: 'Dokumen stock opname',
            kolom: [KOLOM_NO, { kunci: 'nomor', label: 'Nomor' }, { kunci: 'tanggal', label: 'Tanggal', tipe: 'tanggal' },
              { kunci: 'gudang', label: 'Gudang' }, { kunci: 'status', label: 'Status' }, { kunci: 'petugas', label: 'Petugas' },
              { kunci: 'item', label: 'Item', tipe: 'angka' }, { kunci: 'item_selisih', label: 'Item Selisih', tipe: 'angka' },
              { kunci: 'lebih', label: 'Nilai Lebih', tipe: 'uang' }, { kunci: 'kurang', label: 'Nilai Kurang', tipe: 'uang' },
              { kunci: 'bersih', label: 'Selisih Bersih', tipe: 'uang' }, { kunci: 'alasan_batal', label: 'Alasan Batal' }],
            baris: dok.map(({ id: _, ...r }) => r),
            total,
          },
          {
            judul: f.rincian === 'semua' ? 'Rincian barang' : 'Rincian barang berselisih',
            kolom: [KOLOM_NO, { kunci: 'nomor', label: 'No. Opname' }, { kunci: 'kode', label: 'Kode' },
              { kunci: 'nama', label: 'Nama Barang' }, { kunci: 'satuan', label: 'Satuan' },
              { kunci: 'qty_sistem', label: 'Qty Sistem', tipe: 'angka' }, { kunci: 'qty_fisik', label: 'Qty Fisik', tipe: 'angka' },
              { kunci: 'selisih', label: 'Selisih', tipe: 'angka' }, { kunci: 'nilai_selisih', label: 'Nilai Selisih', tipe: 'uang' },
              { kunci: 'keterangan', label: 'Keterangan' }],
            baris: bernomor(rinci),
            total: jumlahkan(rinci, ['nilai_selisih']),
          },
        ],
        catatan: 'Dokumen draft belum menyesuaikan stok sehingga kuantitas fisiknya masih sama dengan sistem.',
      };
    },
  },
  {
    kode: 'persediaan-reorder',
    judul: 'Barang Perlu Dipesan Ulang',
    izin: 'persediaan.view',
    orientasi: 'landscape',
    deskripsi: 'Barang aktif yang habis, di bawah stok minimum, atau mencapai titik pemesanan ulang (ROP).',
    filter: [
      pilih('kategori_id', 'Kategori', opsiKategori),
      ...rentang('kode', 'Kode barang'),
      pilih('status_stok', 'Status stok', [{ nilai: 'habis', teks: 'Habis' }, { nilai: 'kritis', teks: 'Kritis (≤ stok minimum)' },
        { nilai: 'perlu_order', teks: 'Perlu order (≤ ROP)' }]),
    ],
    susun(f) {
      const w = kondisi().tambah("b.status = 'aktif'").sama('b.kategori_id', f.kategori_id).rentang('b.kode', f, 'kode');
      const acuan = hariIni();
      const baris = all(
        `WITH jual AS (
           SELECT barang_id, SUM(-qty) AS qty FROM mutasi_stok
            WHERE jenis = 'keluar' AND tanggal > ? GROUP BY barang_id
         ), beli AS (
           SELECT d.barang_id, s.nama AS supplier, MAX(p.tanggal) AS tanggal
             FROM pembelian_detail d JOIN pembelian p ON p.id = d.pembelian_id LEFT JOIN supplier s ON s.id = p.supplier_id
            WHERE p.status <> 'batal' GROUP BY d.barang_id
         )
         SELECT b.kode, b.nama, k.nama AS kategori, b.satuan, b.stok_minimum, b.reorder_point, b.harga_beli,
                COALESCE((SELECT SUM(qty) FROM stok WHERE barang_id = b.id), 0) AS stok,
                COALESCE(jual.qty, 0) AS jual_30, beli.supplier, beli.tanggal AS beli_terakhir
           FROM barang b LEFT JOIN kategori_barang k ON k.id = b.kategori_id
           LEFT JOIN jual ON jual.barang_id = b.id LEFT JOIN beli ON beli.barang_id = b.id
           ${w.where()} ORDER BY b.kode`, [addDays(acuan, -30), ...w.params])
        .map((r) => {
          const status = r.stok <= 0 ? 'habis' : r.stok <= r.stok_minimum ? 'kritis' : r.stok <= r.reorder_point ? 'perlu_order' : null;
          const rata = r.jual_30 / 30;
          return {
            ...r, status_stok: status, rata_harian: Number(rata.toFixed(2)),
            hari_habis: rata > 0 ? Math.floor(Math.max(r.stok, 0) / rata) : null,
            kurang_rop: Math.max(0, r.reorder_point - r.stok),
          };
        })
        .filter((r) => r.status_stok && (!f.status_stok || r.status_stok === f.status_stok));
      const LABEL = { habis: 'Habis', kritis: 'Kritis', perlu_order: 'Perlu order' };
      return {
        subjudul: `Per ${tanggalPanjang(acuan)}`,
        ringkasan: [
          { label: 'Habis', nilai: baris.filter((r) => r.status_stok === 'habis').length, tipe: 'angka' },
          { label: 'Kritis', nilai: baris.filter((r) => r.status_stok === 'kritis').length, tipe: 'angka' },
          { label: 'Perlu order', nilai: baris.filter((r) => r.status_stok === 'perlu_order').length, tipe: 'angka' },
        ],
        bagian: [{
          kolom: [KOLOM_NO, { kunci: 'kode', label: 'Kode' }, { kunci: 'nama', label: 'Nama Barang' },
            { kunci: 'kategori', label: 'Kategori' }, { kunci: 'satuan', label: 'Satuan' },
            { kunci: 'stok', label: 'Stok', tipe: 'angka' }, { kunci: 'stok_minimum', label: 'Stok Min.', tipe: 'angka' },
            { kunci: 'reorder_point', label: 'ROP', tipe: 'angka' }, { kunci: 'kurang_rop', label: 'Kurang dari ROP', tipe: 'angka' },
            { kunci: 'rata_harian', label: 'Jual/Hari (30 hr)', tipe: 'angka' }, { kunci: 'hari_habis', label: 'Perkiraan Habis (hari)', tipe: 'angka' },
            { kunci: 'supplier', label: 'Supplier Terakhir' }, { kunci: 'beli_terakhir', label: 'Beli Terakhir', tipe: 'tanggal' },
            { kunci: 'status', label: 'Status' }],
          baris: bernomor(baris.map((r) => ({ ...r, status: LABEL[r.status_stok] }))),
        }],
        catatan: 'Status: habis bila stok ≤ 0, kritis bila ≤ stok minimum, perlu order bila ≤ titik pemesanan ulang (ROP). '
          + 'Rata-rata jual dihitung dari penjualan 30 hari terakhir.',
      };
    },
  },
  {
    kode: 'persediaan-kedaluwarsa',
    judul: 'Barang Kedaluwarsa & Akan Kedaluwarsa',
    izin: 'persediaan.view',
    orientasi: 'landscape',
    deskripsi: 'Batch barang yang sudah atau akan kedaluwarsa beserta perkiraan sisa kuantitasnya.',
    filter: [
      { kunci: 'per_tanggal', label: 'Per tanggal', tipe: 'tanggal', bawaan: hariIni },
      { kunci: 'hari', label: 'Akan kedaluwarsa dalam (hari)', tipe: 'angka', bawaan: 90 },
      pilih('gudang_id', 'Gudang', opsiGudang),
      ...FILTER_BARANG,
      pilih('sisa', 'Batch', [{ nilai: 'bersisa', teks: 'Hanya yang diperkirakan masih ada' }, { nilai: 'semua', teks: 'Semua batch' }]),
    ].map((x) => (x.kunci === 'sisa' ? { ...x, bawaan: 'bersisa' } : x)),
    susun(f) {
      const acuan = f.per_tanggal;
      const batas = addDays(acuan, Math.max(0, Math.floor(Number(f.hari) || 0)));
      const wb = kondisi().sama('m.gudang_id', f.gudang_id).rentang('b.kode', f, 'kode').sama('b.kategori_id', f.kategori_id);
      // Seluruh penerimaan berbatch/berkedaluwarsa (untuk alokasi FIFO), lalu dipilih yang jatuh sebelum batas.
      const terima = all(
        `SELECT m.id, m.tanggal, m.barang_id, m.gudang_id, m.qty, m.harga, m.batch, m.expired,
                b.kode, b.nama, b.satuan, g.nama AS gudang
           FROM mutasi_stok m JOIN barang b ON b.id = m.barang_id JOIN gudang g ON g.id = m.gudang_id
          WHERE m.qty > 0 AND m.expired IS NOT NULL AND m.expired <> '' AND m.tanggal <= ? ${wb.and()}
          ORDER BY m.barang_id, m.gudang_id, m.tanggal DESC, m.id DESC`, [acuan, ...wb.params]);
      const pasangan = [...new Set(terima.map((r) => `${r.barang_id}:${r.gudang_id}`))];
      const stok = new Map();
      for (const p of pasangan) {
        const [b, g] = p.split(':').map(Number);
        stok.set(p, get('SELECT COALESCE(SUM(qty),0) AS q FROM mutasi_stok WHERE barang_id = ? AND gudang_id = ? AND tanggal <= ?',
          [b, g, acuan]).q);
      }
      // Asumsi FIFO: stok yang tersisa berasal dari penerimaan paling akhir.
      const sisaStok = new Map(stok);
      const baris = [];
      for (const r of terima) {
        const k = `${r.barang_id}:${r.gudang_id}`;
        const tersedia = Math.max(0, sisaStok.get(k) || 0);
        const sisa = Math.min(r.qty, tersedia);
        sisaStok.set(k, tersedia - sisa);
        if (r.expired > batas) continue;
        if (f.sisa !== 'semua' && sisa <= 0) continue;
        const hari = diffDays(r.expired, acuan);
        baris.push({ kode: r.kode, nama: r.nama, gudang: r.gudang, batch: r.batch, tanggal_terima: r.tanggal,
          expired: r.expired, sisa_hari: hari, qty_terima: r.qty, qty_sisa: sisa, satuan: r.satuan,
          nilai: bulat(sisa * r.harga), status: hari < 0 ? 'Kedaluwarsa' : 'Akan kedaluwarsa' });
      }
      baris.sort((a, b) => a.expired.localeCompare(b.expired) || a.kode.localeCompare(b.kode));
      return {
        subjudul: `Per ${tanggalPanjang(acuan)} — batas kedaluwarsa s.d. ${tanggalPanjang(batas)}`,
        ringkasan: [
          { label: 'Batch kedaluwarsa', nilai: baris.filter((r) => r.sisa_hari < 0).length, tipe: 'angka' },
          { label: 'Batch akan kedaluwarsa', nilai: baris.filter((r) => r.sisa_hari >= 0).length, tipe: 'angka' },
          { label: 'Nilai perkiraan sisa', nilai: baris.reduce((s, r) => s + r.nilai, 0), tipe: 'uang' },
        ],
        bagian: [{
          kolom: [KOLOM_NO, { kunci: 'kode', label: 'Kode' }, { kunci: 'nama', label: 'Nama Barang' },
            { kunci: 'gudang', label: 'Gudang' }, { kunci: 'batch', label: 'Batch' },
            { kunci: 'tanggal_terima', label: 'Tgl Terima', tipe: 'tanggal' }, { kunci: 'expired', label: 'Kedaluwarsa', tipe: 'tanggal' },
            { kunci: 'sisa_hari', label: 'Sisa Hari', tipe: 'angka' }, { kunci: 'qty_terima', label: 'Qty Diterima', tipe: 'angka' },
            { kunci: 'qty_sisa', label: 'Perkiraan Sisa', tipe: 'angka' }, { kunci: 'satuan', label: 'Satuan' },
            { kunci: 'nilai', label: 'Nilai Sisa', tipe: 'uang' }, { kunci: 'status', label: 'Status' }],
          baris: bernomor(baris),
          total: jumlahkan(baris, ['nilai']),
        }],
        catatan: terima.length
          ? 'Mutasi keluar tidak mencatat batch, sehingga sisa per batch diperkirakan dengan asumsi FIFO '
            + '(stok tersisa berasal dari penerimaan terakhir).'
          : 'Belum ada penerimaan barang yang mencatat tanggal kedaluwarsa.',
      };
    },
  },

  // =============================== UNIT USAHA ===============================
  {
    kode: 'unit-kinerja',
    judul: 'Kinerja Unit Usaha',
    izin: 'unit.view',
    orientasi: 'landscape',
    deskripsi: 'Pendapatan, HPP, beban, dan SHU per unit usaha (laporan segmen); tanpa tanggal: awal tahun s.d. hari ini.',
    filter: [
      ...periode(),
      pilih('unit_usaha_id', 'Unit usaha (rincian akun)', opsiUnit),
      pilih('status', 'Status unit', ['aktif', 'nonaktif']),
    ].map((x) => (x.kunci === 'status' ? { ...x, bawaan: 'aktif' } : x)),
    susun(f0) {
      const f = isiPeriode(f0, awalTahunDari);
      // Logika sama dengan GET /api/unit-usaha/kinerja (server/routes/organisasi.js)
      const units = all('SELECT * FROM unit_usaha WHERE status = ? ORDER BY kode', [f.status]);
      const perUnit = units.map((u) => {
        const lr = labaRugi({ dari: f.dari, sampai: f.sampai, unit_usaha_id: u.id });
        return {
          kode: u.kode, nama: u.nama, jenis: u.jenis, pendapatan: lr.total_pendapatan, hpp: lr.hpp,
          laba_kotor: lr.laba_kotor, beban: lr.beban_operasional, shu: lr.shu_bersih,
          margin: persen(lr.shu_bersih, lr.total_pendapatan),
        };
      });
      const kons = labaRugi({ dari: f.dari, sampai: f.sampai });
      const sum = (k) => perUnit.reduce((s, u) => s + u[k], 0);
      const tanpa = {
        kode: '-', nama: 'Tanpa unit / kantor pusat', jenis: '',
        pendapatan: kons.total_pendapatan - sum('pendapatan'), hpp: kons.hpp - sum('hpp'),
        laba_kotor: kons.laba_kotor - sum('laba_kotor'), beban: kons.beban_operasional - sum('beban'),
        shu: kons.shu_bersih - sum('shu'),
      };
      tanpa.margin = persen(tanpa.shu, tanpa.pendapatan);
      const baris = [...perUnit];
      if (tanpa.pendapatan || tanpa.hpp || tanpa.beban) baris.push(tanpa);
      const total = { _label: 'KONSOLIDASI', pendapatan: kons.total_pendapatan, hpp: kons.hpp, laba_kotor: kons.laba_kotor,
        beban: kons.beban_operasional, shu: kons.shu_bersih, margin: persen(kons.shu_bersih, kons.total_pendapatan) };
      const bagian = [{
        judul: 'Kinerja per unit usaha',
        kolom: [{ kunci: 'kode', label: 'Kode' }, { kunci: 'nama', label: 'Unit Usaha' }, { kunci: 'jenis', label: 'Jenis' },
          { kunci: 'pendapatan', label: 'Pendapatan', tipe: 'uang' }, { kunci: 'hpp', label: 'HPP', tipe: 'uang' },
          { kunci: 'laba_kotor', label: 'Laba Kotor', tipe: 'uang' }, { kunci: 'beban', label: 'Beban Operasional', tipe: 'uang' },
          { kunci: 'shu', label: 'SHU', tipe: 'uang' }, { kunci: 'margin', label: 'Margin SHU', tipe: 'persen' }],
        baris,
        total,
      }];
      if (f.unit_usaha_id) {
        const u = get('SELECT * FROM unit_usaha WHERE id = ?', [f.unit_usaha_id]);
        const lr = labaRugi({ dari: f.dari, sampai: f.sampai, unit_usaha_id: f.unit_usaha_id });
        const akun = [...lr.pendapatan, ...lr.beban].filter((r) => r.saldo)
          .map((r) => ({ kode: r.kode, nama: r.nama, tipe: r.tipe, saldo: r.saldo }));
        bagian.push({
          judul: `Rincian akun ${u?.kode || ''} - ${u?.nama || ''}`,
          kolom: [{ kunci: 'kode', label: 'Kode Akun' }, { kunci: 'nama', label: 'Nama Akun' },
            { kunci: 'tipe', label: 'Tipe' }, { kunci: 'saldo', label: 'Saldo', tipe: 'uang' }],
          baris: akun,
          total: { _label: 'SHU UNIT', saldo: lr.shu_bersih },
        });
      }
      return {
        subjudul: teksPeriode(f),
        ringkasan: [
          { label: 'Pendapatan konsolidasi', nilai: kons.total_pendapatan, tipe: 'uang' },
          { label: 'Beban konsolidasi', nilai: kons.total_beban, tipe: 'uang' },
          { label: 'SHU konsolidasi', nilai: kons.shu_bersih, tipe: 'uang' },
        ],
        bagian,
        catatan: 'Disusun dari jurnal ber-segmen unit usaha. SHU = pendapatan - HPP - beban operasional.',
      };
    },
  },
].map(rapikan);
