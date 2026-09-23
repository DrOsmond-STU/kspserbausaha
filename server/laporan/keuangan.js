/**
 * Pusat Laporan - kelompok keuangan & akuntansi.
 * Lihat server/laporan/bantu.js untuk format definisi laporan.
 *
 * Seluruh angka laporan keuangan diambil dari mesin akuntansi
 * (server/services/accounting.js) sehingga sama dengan layar Laporan
 * Keuangan. Tidak ada kode akun yang ditanam: akun dipilih pengguna dari
 * bagan akun, atau dibaca dari penanda kas/bank, pemetaan akun, dan kelompok
 * akun pada Parameter Sistem.
 */
import { all, get, setting } from '../db.js';
import { today } from '../lib/util.js';
import { tanggalPanjang } from '../lib/profil.js';
import * as acc from '../services/accounting.js';
import { penyusutanBulanan } from '../services/assets.js';
import { periode, rentang, pilih, kondisi, teksPeriode, jumlahkan, bernomor, KOLOM_NO, opsiCabang, opsiUnit } from './bantu.js';

// ------------------------------ Alat bantu ------------------------------

const awalTahun = (t) => `${String(t || today()).slice(0, 4)}-01-01`;
const awalBulan = (t) => `${String(t || today()).slice(0, 7)}-01`;
const akhirTahun = (t) => `${String(t || today()).slice(0, 4)}-12-31`;

/** Tanggal sehari sebelumnya (YYYY-MM-DD). */
function kemarin(d) {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
}

/** Selisih hari antara dua tanggal ISO (b - a). */
const selisihHari = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

const kol = (kunci, label, tipe) => (tipe ? { kunci, label, tipe } : { kunci, label });
const uang = (kunci, label) => kol(kunci, label, 'uang');
const jumlah = (baris, kunci) => baris.reduce((s, r) => s + (Number(r[kunci]) || 0), 0);
const nominal = (tipe) => tipe === 'pendapatan' || tipe === 'beban';

/** Tanggal "per tanggal" (bawaan hari ini). */
const perTanggal = (label = 'Per tanggal') => ({ kunci: 'sampai', label, tipe: 'tanggal', bawaan: today });

/** Rentang tanggal; bila "dari" dikosongkan, susun() memakai awal tahun/bulan dari tanggal akhir. */
const periodeLaporan = () => [
  { kunci: 'dari', label: 'Tanggal dari', tipe: 'tanggal' },
  { kunci: 'sampai', label: 'Tanggal sampai', tipe: 'tanggal', bawaan: today },
];

/** Opsi akun dari bagan akun (hanya akun yang dapat dijurnal). */
const opsiAkun = () => all(
  "SELECT kode AS nilai, kode || ' - ' || nama AS teks FROM coa WHERE is_postable = 1 ORDER BY kode");
const opsiAkunKas = () => all(
  `SELECT kode AS nilai, kode || ' - ' || nama AS teks FROM coa
    WHERE (is_kas = 1 OR is_bank = 1) AND is_postable = 1 ORDER BY kode`);
const opsiAnggaran = () => all(
  "SELECT id AS nilai, tahun || ' - ' || nama || ' (' || status || ')' AS teks FROM anggaran ORDER BY tahun DESC, id DESC");
const opsiKategoriAset = () => all(
  "SELECT DISTINCT kategori AS nilai, kategori AS teks FROM aset_tetap WHERE kategori IS NOT NULL AND kategori <> '' ORDER BY kategori");

/** Rentang akun: dua pilihan akun dari bagan akun. */
const rentangAkun = (opsi = opsiAkun) => [
  { kunci: 'kode_dari', label: 'Kode akun dari', tipe: 'pilih', opsi },
  { kunci: 'kode_sampai', label: 'Kode akun sampai', tipe: 'pilih', opsi },
];

const namaAkun = (kode) => {
  const a = kode ? get('SELECT nama FROM coa WHERE kode = ?', [kode]) : null;
  return a ? `${kode} - ${a.nama}` : (kode || '');
};

const TIPE_JURNAL = [
  ['umum', 'Umum'], ['penyesuaian', 'Penyesuaian'], ['pembuka', 'Saldo awal / pembuka'], ['kas_masuk', 'Kas masuk'],
  ['kas_keluar', 'Kas keluar'], ['simpanan', 'Simpanan'], ['pinjaman', 'Pinjaman'], ['penjualan', 'Penjualan'],
  ['pembelian', 'Pembelian'], ['penyusutan', 'Penyusutan'], ['shu', 'SHU'], ['penutup', 'Penutup'],
].map(([nilai, teks]) => ({ nilai, teks }));

const JENIS_KAS = { kas_masuk: 'Kas masuk', kas_keluar: 'Kas keluar', petty_cash: 'Kas kecil', transfer: 'Transfer' };

/**
 * Posisi keuangan per tanggal dari acc.neraca(), dilengkapi:
 * - SHU tahun berjalan yang belum dipindahkan ke akun ekuitas (bila tahun
 *   buku sudah ditutup, bagian yang dipindahkan sudah ada pada akun SHU);
 * - hasil usaha tahun-tahun lalu yang belum ditutup dengan jurnal penutup,
 *   supaya neraca tetap seimbang walaupun tutup buku belum dilakukan.
 */
function posisiKeuangan(sampai) {
  const n = acc.neraca({ sampai });
  const tercatat = jumlah(n.ekuitas, 'saldo');
  const sudahDipindah = tercatat + n.shu_berjalan - n.total_ekuitas;
  const lalu = acc.trialBalance({ sampai: kemarin(awalTahun(sampai)) });
  const shuLalu = lalu.baris.filter((r) => nominal(r.tipe)).reduce((s, r) => s + r.kredit - r.debit, 0);
  const totalEkuitas = n.total_ekuitas + shuLalu;
  const totalPasiva = n.total_kewajiban + totalEkuitas;
  return {
    ...n,
    shu_sudah_dipindah: sudahDipindah,
    shu_belum_dipindah: n.shu_berjalan - sudahDipindah,
    shu_lalu_belum_ditutup: shuLalu,
    total_ekuitas: totalEkuitas,
    total_pasiva: totalPasiva,
    selisih: n.total_aset - totalPasiva,
    seimbang: n.total_aset === totalPasiva,
  };
}

/** Menggabungkan baris dua periode berdasarkan kode akun (untuk kolom pembanding). */
function gabung(kini, banding, kunci = 'saldo') {
  const peta = new Map();
  for (const r of kini) peta.set(r.kode, { kode: r.kode, nama: r.nama, nilai: r[kunci], banding: 0 });
  for (const r of banding || []) {
    const ada = peta.get(r.kode);
    if (ada) ada.banding = r[kunci];
    else peta.set(r.kode, { kode: r.kode, nama: r.nama, nilai: 0, banding: r[kunci] });
  }
  return [...peta.values()].sort((a, b) => a.kode.localeCompare(b.kode));
}

/** Kolom kode–uraian–nilai (+ pembanding bila ada). */
const kolomNilai = (labelKini, labelBanding) => [
  kol('kode', 'Kode'), kol('nama', 'Uraian'), uang('nilai', labelKini),
  ...(labelBanding ? [uang('banding', labelBanding), uang('perubahan', 'Perubahan')] : []),
];
const denganPerubahan = (baris, ada) => (ada ? baris.map((r) => ({ ...r, perubahan: (r.nilai || 0) - (r.banding || 0) })) : baris);
const totalNilai = (baris, label, ada) => ({
  _label: label, nilai: jumlah(baris, 'nilai'),
  ...(ada ? { banding: jumlah(baris, 'banding'), perubahan: jumlah(baris, 'nilai') - jumlah(baris, 'banding') } : {}),
});

/** Akun pajak: sama dengan GET /api/laporan/pajak (master pajak + pemetaan PPN + kelompok "pajak"). */
function akunPajak() {
  const kode = new Set(all("SELECT DISTINCT coa_kode FROM pajak WHERE coa_kode IS NOT NULL AND coa_kode <> ''")
    .map((r) => r.coa_kode));
  for (const k of ['hutang_pajak', 'ppn_masukan']) {
    const v = setting(`coa.${k}`, null);
    if (v) kode.add(v);
  }
  const awalan = acc.awalanKelompok('pajak');
  for (const r of all('SELECT kode FROM coa WHERE is_postable = 1')) {
    if (awalan.some((a) => r.kode.startsWith(a))) kode.add(r.kode);
  }
  return [...kode].sort().map((k) => get('SELECT kode, nama FROM coa WHERE kode = ?', [k])).filter(Boolean);
}

/** Batas jumlah akun dan jumlah baris keseluruhan dalam satu cetakan buku besar / buku kas. */
const MAKS_AKUN = 80;
const MAKS_BARIS = 50_000;

// ------------------------------ Definisi ------------------------------

export default [
  // ============================ AKUNTANSI ============================
  {
    kode: 'jurnal-umum',
    judul: 'Jurnal Umum',
    izin: 'akuntansi.view',
    orientasi: 'landscape',
    jenis_ttd: 'laporan',
    deskripsi: 'Daftar jurnal beserta rincian akun per periode (bila tanggal awal kosong: awal bulan), '
      + 'dapat disaring menurut tipe, asal jurnal, status, dan rentang nomor.',
    filter: [
      ...periodeLaporan(),
      ...rentang('nomor', 'Nomor jurnal'),
      pilih('tipe', 'Tipe jurnal', TIPE_JURNAL),
      pilih('sumber', 'Asal jurnal', [
        { nilai: 'manual', teks: 'Manual (jurnal umum)' }, { nilai: 'recurring', teks: 'Jurnal berulang' },
        { nilai: 'sistem', teks: 'Otomatis dari modul' }]),
      pilih('status', 'Status', [{ nilai: 'posted', teks: 'Diposting' }, { nilai: 'void', teks: 'Dibatalkan' },
        { nilai: 'draft', teks: 'Draf' }]),
      { kunci: 'q', label: 'Cari nomor / keterangan', tipe: 'teks' },
      pilih('cabang_id', 'Cabang', opsiCabang),
    ],
    susun(f) {
      const sampai = f.sampai || today();
      // Tanpa rentang nomor/pencarian, laporan dibatasi pada bulan berjalan agar tidak terlalu besar.
      const dari = f.dari || (f.nomor_dari || f.nomor_sampai || f.q ? undefined : awalBulan(sampai));
      const w = kondisi().periode('j.tanggal', { dari, sampai }).rentang('j.nomor', f, 'nomor')
        .sama('j.tipe', f.tipe).sama('j.status', f.status).sama('j.cabang_id', f.cabang_id)
        .cari(['j.nomor', 'j.keterangan'], f.q);
      let jurnal = all(`SELECT j.* FROM jurnal j ${w.where()} ORDER BY j.tanggal, j.nomor, j.id`, w.params);
      if (f.sumber) jurnal = jurnal.filter((j) => acc.sumberJurnal(j) === f.sumber);
      const dipilih = new Set(jurnal.map((j) => j.id));
      const detail = all(
        `SELECT d.jurnal_id, d.coa_kode, c.nama AS akun, d.debit, d.kredit, d.keterangan
           FROM jurnal_detail d JOIN jurnal j ON j.id = d.jurnal_id LEFT JOIN coa c ON c.kode = d.coa_kode
          ${w.where()} ORDER BY j.tanggal, j.nomor, j.id, d.urut, d.id`, w.params)
        .filter((d) => dipilih.has(d.jurnal_id));
      const kepala = new Map(jurnal.map((j) => [j.id, j]));
      let terakhir = null;
      const baris = detail.map((d) => {
        const j = kepala.get(d.jurnal_id);
        const pertama = terakhir !== d.jurnal_id;
        terakhir = d.jurnal_id;
        return {
          tanggal: pertama ? j.tanggal : null,
          nomor: pertama ? j.nomor : '',
          keterangan: pertama ? `${j.keterangan || ''}${j.status === 'void' ? ' [DIBATALKAN]' : ''}` : '',
          kode: d.coa_kode, akun: d.akun || '', uraian: d.keterangan || '',
          debit: d.debit, kredit: d.kredit,
        };
      });
      const total = jumlahkan(baris, ['debit', 'kredit']);
      return {
        subjudul: teksPeriode({ dari, sampai }),
        ringkasan: [
          { label: 'Jumlah jurnal', nilai: jurnal.length, tipe: 'angka' },
          { label: 'Jumlah baris', nilai: baris.length, tipe: 'angka' },
          { label: 'Total debit', nilai: total.debit, tipe: 'uang' },
          { label: 'Total kredit', nilai: total.kredit, tipe: 'uang' },
        ],
        bagian: [{
          kolom: [kol('tanggal', 'Tanggal', 'tanggal'), kol('nomor', 'Nomor'), kol('keterangan', 'Keterangan'),
            kol('kode', 'Kode Akun'), kol('akun', 'Nama Akun'), kol('uraian', 'Uraian Baris'),
            uang('debit', 'Debit'), uang('kredit', 'Kredit')],
          baris, total,
        }],
        catatan: 'Jurnal yang dibatalkan tetap tercantum bersama jurnal baliknya (reversing entry) sesuai prinsip jejak audit.',
      };
    },
  },

  {
    kode: 'buku-besar',
    judul: 'Buku Besar',
    izin: 'laporan.view',
    orientasi: 'landscape',
    jenis_ttd: 'laporan',
    deskripsi: `Buku besar per akun dalam rentang kode akun: saldo awal, mutasi dengan saldo berjalan, dan saldo akhir `
      + `(bila tanggal awal kosong: awal bulan; maksimal ${MAKS_AKUN} akun per cetakan).`,
    filter: [
      ...periodeLaporan(),
      ...rentangAkun(),
      pilih('tampil', 'Akun ditampilkan', [
        { nilai: 'aktif', teks: 'Hanya yang bersaldo / bermutasi' }, { nilai: 'semua', teks: 'Semua akun dalam rentang' }]),
      pilih('cabang_id', 'Cabang', opsiCabang),
      pilih('unit_usaha_id', 'Unit usaha', opsiUnit),
    ],
    susun(f) {
      const sampai = f.sampai || today();
      const dari = f.dari || awalBulan(sampai);
      const w = kondisi().tambah('is_postable = 1').rentang('kode', f, 'kode');
      const akun = all(`SELECT kode FROM coa ${w.where()} ORDER BY kode`, w.params);
      const bagian = [];
      let terpotong = false;
      let totalBaris = 0;
      for (const { kode } of akun) {
        const bb = acc.bukuBesar(kode, { dari, sampai, cabang_id: f.cabang_id, unit_usaha_id: f.unit_usaha_id });
        if (f.tampil !== 'semua' && !bb.saldo_awal && !bb.baris.length) continue;
        totalBaris += bb.baris.length + 1;
        if (bagian.length >= MAKS_AKUN || (bagian.length && totalBaris > MAKS_BARIS)) { terpotong = true; break; }
        const baris = [
          { tanggal: dari, nomor: '', keterangan: 'Saldo awal', debit: null, kredit: null, saldo: bb.saldo_awal },
          ...bb.baris.map((m) => ({
            tanggal: m.tanggal, nomor: m.nomor, keterangan: m.keterangan || m.jurnal_ket || '',
            debit: m.debit, kredit: m.kredit, saldo: m.saldo,
          })),
        ];
        bagian.push({
          judul: `${bb.akun.kode} - ${bb.akun.nama} (saldo normal ${bb.akun.saldo_normal === 'K' ? 'kredit' : 'debit'})`,
          kolom: [kol('tanggal', 'Tanggal', 'tanggal'), kol('nomor', 'Nomor Jurnal'), kol('keterangan', 'Keterangan'),
            uang('debit', 'Debit'), uang('kredit', 'Kredit'), uang('saldo', 'Saldo')],
          baris,
          total: { _label: 'Jumlah mutasi / saldo akhir', debit: jumlah(bb.baris, 'debit'),
            kredit: jumlah(bb.baris, 'kredit'), saldo: bb.saldo_akhir },
        });
      }
      return {
        subjudul: teksPeriode({ dari, sampai }),
        keterangan: terpotong
          ? [`Hanya ${bagian.length} akun pertama (s.d. ${bagian.at(-1).judul.split(' ')[0]}) yang ditampilkan karena `
            + 'batas ukuran laporan; persempit rentang kode akun atau periode untuk akun berikutnya.'] : [],
        ringkasan: [{ label: 'Jumlah akun', nilai: bagian.length, tipe: 'angka' }],
        bagian,
      };
    },
  },

  {
    kode: 'neraca-saldo',
    judul: 'Neraca Saldo',
    izin: 'laporan.view',
    orientasi: 'landscape',
    jenis_ttd: 'laporan_keuangan',
    deskripsi: 'Saldo awal, mutasi debit/kredit, dan saldo akhir setiap akun (bila tanggal awal kosong: awal tahun).',
    filter: [
      ...periodeLaporan(),
      ...rentangAkun(),
      pilih('cabang_id', 'Cabang', opsiCabang),
      pilih('unit_usaha_id', 'Unit usaha', opsiUnit),
    ],
    susun(f) {
      const sampai = f.sampai || today();
      const dari = f.dari || awalTahun(sampai);
      const segmen = { cabang_id: f.cabang_id, unit_usaha_id: f.unit_usaha_id };
      const awal = acc.trialBalance({ ...segmen, sampai: kemarin(dari) });
      const mutasi = acc.trialBalance({ ...segmen, dari, sampai });
      const peta = new Map();
      const ambil = (r) => {
        if (!peta.has(r.kode)) peta.set(r.kode, { kode: r.kode, nama: r.nama, awal: 0, md: 0, mk: 0 });
        return peta.get(r.kode);
      };
      for (const r of awal.baris) ambil(r).awal = r.debit - r.kredit;
      for (const r of mutasi.baris) Object.assign(ambil(r), { md: r.debit, mk: r.kredit });
      const dalamRentang = (k) => (!f.kode_dari || k >= f.kode_dari) && (!f.kode_sampai || k <= f.kode_sampai);
      const baris = [...peta.values()].filter((r) => dalamRentang(r.kode)).sort((a, b) => a.kode.localeCompare(b.kode))
        .map((r) => {
          const akhir = r.awal + r.md - r.mk;
          return {
            kode: r.kode, nama: r.nama,
            awal_debit: r.awal > 0 ? r.awal : 0, awal_kredit: r.awal < 0 ? -r.awal : 0,
            mutasi_debit: r.md, mutasi_kredit: r.mk,
            akhir_debit: akhir > 0 ? akhir : 0, akhir_kredit: akhir < 0 ? -akhir : 0,
          };
        })
        .filter((r) => r.awal_debit || r.awal_kredit || r.mutasi_debit || r.mutasi_kredit);
      const total = jumlahkan(baris, ['awal_debit', 'awal_kredit', 'mutasi_debit', 'mutasi_kredit', 'akhir_debit', 'akhir_kredit']);
      return {
        subjudul: teksPeriode({ dari, sampai }),
        ringkasan: [
          { label: 'Saldo akhir debit', nilai: total.akhir_debit, tipe: 'uang' },
          { label: 'Saldo akhir kredit', nilai: total.akhir_kredit, tipe: 'uang' },
          { label: 'Selisih', nilai: total.akhir_debit - total.akhir_kredit, tipe: 'uang' },
          { label: 'Jumlah akun', nilai: baris.length, tipe: 'angka' },
        ],
        bagian: [{
          kolom: [kol('kode', 'Kode'), kol('nama', 'Nama Akun'), uang('awal_debit', 'Saldo Awal Debit'),
            uang('awal_kredit', 'Saldo Awal Kredit'), uang('mutasi_debit', 'Mutasi Debit'), uang('mutasi_kredit', 'Mutasi Kredit'),
            uang('akhir_debit', 'Saldo Akhir Debit'), uang('akhir_kredit', 'Saldo Akhir Kredit')],
          baris, total,
        }],
      };
    },
  },

  {
    kode: 'neraca-lajur',
    judul: 'Neraca Lajur',
    izin: 'laporan.view',
    orientasi: 'landscape',
    jenis_ttd: 'laporan_keuangan',
    deskripsi: 'Kertas kerja per tanggal: neraca saldo sebelum penutupan, laba rugi tahun berjalan, dan neraca.',
    filter: [perTanggal()],
    susun(f) {
      const sampai = f.sampai || today();
      const awalTh = awalTahun(sampai);
      // Akun riil: saldo kumulatif (tahun lalu termasuk jurnal penutup); akun nominal: tahun berjalan saja.
      // Jurnal penutup tahun berjalan dikeluarkan karena neraca lajur adalah kertas kerja sebelum penutupan.
      const lalu = acc.trialBalance({ sampai: kemarin(awalTh) });
      const kini = acc.trialBalance({ dari: awalTh, sampai, tanpa_penutup: true });
      const peta = new Map();
      let shuLalu = 0;
      const tambah = (r) => {
        const x = peta.get(r.kode) || { kode: r.kode, nama: r.nama, tipe: r.tipe, net: 0 };
        x.net += r.debit - r.kredit;
        peta.set(r.kode, x);
      };
      for (const r of lalu.baris) {
        if (nominal(r.tipe)) shuLalu += r.kredit - r.debit; else tambah(r);
      }
      for (const r of kini.baris) tambah(r);
      const dk = (net) => ({ d: net > 0 ? net : 0, k: net < 0 ? -net : 0 });
      const baris = [...peta.values()].sort((a, b) => a.kode.localeCompare(b.kode)).filter((r) => r.net !== 0).map((r) => {
        const s = dk(r.net);
        const lr = nominal(r.tipe);
        return {
          kode: r.kode, nama: r.nama, ns_debit: s.d, ns_kredit: s.k,
          lr_debit: lr ? s.d : 0, lr_kredit: lr ? s.k : 0,
          neraca_debit: lr ? 0 : s.d, neraca_kredit: lr ? 0 : s.k,
        };
      });
      if (shuLalu) {
        const s = dk(-shuLalu);
        baris.push({ kode: '', nama: 'SHU tahun lalu yang belum ditutup', ns_debit: s.d, ns_kredit: s.k,
          lr_debit: 0, lr_kredit: 0, neraca_debit: s.d, neraca_kredit: s.k });
      }
      const shu = jumlah(baris, 'lr_kredit') - jumlah(baris, 'lr_debit');
      baris.push({
        kode: '', nama: shu >= 0 ? 'SHU tahun berjalan' : 'Defisit tahun berjalan',
        ns_debit: null, ns_kredit: null,
        lr_debit: shu > 0 ? shu : 0, lr_kredit: shu < 0 ? -shu : 0,
        neraca_debit: shu < 0 ? -shu : 0, neraca_kredit: shu > 0 ? shu : 0,
      });
      const total = jumlahkan(baris, ['ns_debit', 'ns_kredit', 'lr_debit', 'lr_kredit', 'neraca_debit', 'neraca_kredit']);
      return {
        subjudul: `Tahun buku ${sampai.slice(0, 4)}, per ${tanggalPanjang(sampai)}`,
        ringkasan: [
          { label: 'SHU tahun berjalan', nilai: shu, tipe: 'uang' },
          { label: 'Selisih neraca saldo', nilai: total.ns_debit - total.ns_kredit, tipe: 'uang' },
          { label: 'Selisih neraca', nilai: total.neraca_debit - total.neraca_kredit, tipe: 'uang' },
        ],
        bagian: [{
          kolom: [kol('kode', 'Kode'), kol('nama', 'Nama Akun'), uang('ns_debit', 'Neraca Saldo D'),
            uang('ns_kredit', 'Neraca Saldo K'), uang('lr_debit', 'Laba Rugi D'), uang('lr_kredit', 'Laba Rugi K'),
            uang('neraca_debit', 'Neraca D'), uang('neraca_kredit', 'Neraca K')],
          baris, total,
        }],
      };
    },
  },

  {
    kode: 'neraca',
    judul: 'Neraca (Laporan Posisi Keuangan)',
    izin: 'laporan.view',
    jenis_ttd: 'laporan_keuangan',
    deskripsi: 'Aset, kewajiban, dan ekuitas per tanggal termasuk SHU tahun berjalan; dapat dibandingkan dengan tanggal lain.',
    filter: [perTanggal(), { kunci: 'pembanding', label: 'Per tanggal pembanding', tipe: 'tanggal' }],
    susun(f) {
      const sampai = f.sampai || today();
      const n = posisiKeuangan(sampai);
      const b = f.pembanding ? posisiKeuangan(f.pembanding) : null;
      const ada = !!b;
      const kolom = kolomNilai(tanggalPanjang(sampai), ada ? tanggalPanjang(f.pembanding) : null);
      const bagian = [];
      const tambahBagian = (judul, baris, labelTotal) => {
        const rows = denganPerubahan(baris, ada);
        bagian.push({ judul, kolom, baris: rows, total: totalNilai(rows, labelTotal, ada) });
      };
      // Aset & kewajiban dipisah lancar / tidak lancar bila kelompoknya diatur pada Parameter Sistem.
      const pisah = (judul, rows, kelompok, [jLancar, jTidak]) => {
        if (!acc.awalanKelompok(kelompok).length) { tambahBagian(judul, rows, `JUMLAH ${judul}`); return; }
        const lancar = rows.filter((r) => acc.termasukKelompok(r.kode, kelompok));
        const lain = rows.filter((r) => !acc.termasukKelompok(r.kode, kelompok));
        if (lancar.length) tambahBagian(`${judul} ${jLancar}`, lancar, `JUMLAH ${judul} ${jLancar}`);
        if (lain.length) tambahBagian(`${judul} ${jTidak}`, lain, `JUMLAH ${judul} ${jTidak}`);
      };
      const aset = gabung(n.aset, b?.aset);
      const kewajiban = gabung(n.kewajiban, b?.kewajiban);
      pisah('ASET', aset, 'aset_lancar', ['LANCAR', 'TIDAK LANCAR']);
      pisah('KEWAJIBAN', kewajiban, 'kewajiban_lancar', ['JANGKA PENDEK', 'JANGKA PANJANG']);
      const ekuitas = gabung(n.ekuitas, b?.ekuitas);
      if (n.shu_lalu_belum_ditutup || b?.shu_lalu_belum_ditutup) {
        ekuitas.push({ kode: '', nama: 'SHU tahun lalu yang belum ditutup',
          nilai: n.shu_lalu_belum_ditutup, banding: b?.shu_lalu_belum_ditutup || 0 });
      }
      ekuitas.push({ kode: '', nama: 'SHU tahun berjalan', nilai: n.shu_belum_dipindah, banding: b?.shu_belum_dipindah || 0 });
      tambahBagian('EKUITAS', ekuitas, 'JUMLAH EKUITAS');
      const ringkas = [
        { kode: '', nama: 'JUMLAH ASET', nilai: n.total_aset, banding: b?.total_aset || 0 },
        { kode: '', nama: 'JUMLAH KEWAJIBAN', nilai: n.total_kewajiban, banding: b?.total_kewajiban || 0 },
        { kode: '', nama: 'JUMLAH EKUITAS', nilai: n.total_ekuitas, banding: b?.total_ekuitas || 0 },
        { kode: '', nama: 'JUMLAH KEWAJIBAN DAN EKUITAS', nilai: n.total_pasiva, banding: b?.total_pasiva || 0 },
        { kode: '', nama: 'Selisih', nilai: n.selisih, banding: b?.selisih || 0 },
      ];
      bagian.push({ judul: 'RINGKASAN', kolom, baris: denganPerubahan(ringkas, ada) });
      const keterangan = [];
      if (n.shu_sudah_dipindah) {
        keterangan.push(`SHU tahun ${sampai.slice(0, 4)} sebesar Rp ${n.shu_sudah_dipindah.toLocaleString('id-ID')} `
          + 'sudah dipindahkan ke akun ekuitas melalui jurnal penutup.');
      }
      return {
        subjudul: `Per ${tanggalPanjang(sampai)}${ada ? ` dibandingkan ${tanggalPanjang(f.pembanding)}` : ''}`,
        keterangan,
        ringkasan: [
          { label: 'Jumlah aset', nilai: n.total_aset, tipe: 'uang' },
          { label: 'Jumlah kewajiban & ekuitas', nilai: n.total_pasiva, tipe: 'uang' },
          { label: 'Selisih', nilai: n.selisih, tipe: 'uang' },
          { label: 'Status', nilai: n.seimbang ? 'Seimbang' : 'TIDAK SEIMBANG' },
          { label: `SHU tahun ${sampai.slice(0, 4)} (laba rugi)`, nilai: n.shu_berjalan, tipe: 'uang' },
        ],
        bagian,
      };
    },
  },

  {
    kode: 'laba-rugi',
    judul: 'Laporan Laba Rugi (Perhitungan Hasil Usaha)',
    izin: 'laporan.view',
    jenis_ttd: 'laporan_keuangan',
    deskripsi: 'Pendapatan, harga pokok penjualan, beban, dan SHU per periode (bila tanggal awal kosong: awal tahun); '
      + 'dapat dibandingkan dengan periode lain.',
    filter: [
      ...periodeLaporan(),
      { kunci: 'banding_dari', label: 'Periode pembanding dari', tipe: 'tanggal' },
      { kunci: 'banding_sampai', label: 'Periode pembanding sampai', tipe: 'tanggal' },
      pilih('cabang_id', 'Cabang', opsiCabang),
      pilih('unit_usaha_id', 'Unit usaha', opsiUnit),
    ],
    susun(f) {
      const sampai = f.sampai || today();
      const dari = f.dari || awalTahun(sampai);
      const segmen = { cabang_id: f.cabang_id, unit_usaha_id: f.unit_usaha_id };
      const lr = acc.labaRugi({ ...segmen, dari, sampai });
      const ada = !!(f.banding_dari || f.banding_sampai);
      const bSampai = f.banding_sampai || (f.banding_dari ? akhirTahun(f.banding_dari) : null);
      const bDari = f.banding_dari || (bSampai ? awalTahun(bSampai) : null);
      const b = ada ? acc.labaRugi({ ...segmen, dari: bDari, sampai: bSampai }) : null;
      const label = (x, y) => `${x.slice(8, 10)}/${x.slice(5, 7)}/${x.slice(0, 4)} - ${y.slice(8, 10)}/${y.slice(5, 7)}/${y.slice(0, 4)}`;
      const kolom = kolomNilai(ada ? label(dari, sampai) : 'Jumlah', ada ? label(bDari, bSampai) : null);
      const hpp = (r) => acc.termasukKelompok(r.kode, 'hpp');
      const bagian = [];
      const tambahBagian = (judul, rows, labelTotal) => {
        const baris = denganPerubahan(rows, ada);
        bagian.push({ judul, kolom, baris, total: totalNilai(baris, labelTotal, ada) });
      };
      tambahBagian('PENDAPATAN', gabung(lr.pendapatan, b?.pendapatan), 'JUMLAH PENDAPATAN');
      const bebanHpp = gabung(lr.beban.filter(hpp), b?.beban.filter(hpp));
      if (bebanHpp.length) tambahBagian('HARGA POKOK PENJUALAN', bebanHpp, 'JUMLAH HARGA POKOK PENJUALAN');
      tambahBagian('BEBAN USAHA', gabung(lr.beban.filter((r) => !hpp(r)), b?.beban.filter((r) => !hpp(r))),
        'JUMLAH BEBAN USAHA');
      const ringkas = [
        ['Jumlah pendapatan', 'total_pendapatan'], ['Harga pokok penjualan', 'hpp'], ['Laba kotor', 'laba_kotor'],
        ['Beban usaha', 'beban_operasional'], ['SISA HASIL USAHA (SHU)', 'shu_bersih'],
      ].map(([nama, k]) => ({ kode: '', nama, nilai: lr[k], banding: b ? b[k] : 0 }));
      bagian.push({ judul: 'HASIL USAHA', kolom, baris: denganPerubahan(ringkas, ada) });
      return {
        subjudul: `${teksPeriode({ dari, sampai })}${ada ? ` dibandingkan ${teksPeriode({ dari: bDari, sampai: bSampai }, 'periode')}` : ''}`,
        ringkasan: [
          { label: 'Jumlah pendapatan', nilai: lr.total_pendapatan, tipe: 'uang' },
          { label: 'Jumlah beban', nilai: lr.total_beban, tipe: 'uang' },
          { label: lr.shu_bersih >= 0 ? 'SHU' : 'Defisit', nilai: lr.shu_bersih, tipe: 'uang' },
        ],
        bagian,
        catatan: 'Jurnal penutup tidak diperhitungkan sehingga hasil usaha tahun buku yang sudah ditutup tetap tersaji.',
      };
    },
  },

  {
    kode: 'arus-kas',
    judul: 'Laporan Arus Kas',
    izin: 'laporan.view',
    jenis_ttd: 'laporan_keuangan',
    deskripsi: 'Arus kas operasi, investasi, dan pendanaan (metode langsung) per periode (bila tanggal awal kosong: awal tahun).',
    filter: periodeLaporan(),
    susun(f) {
      const sampai = f.sampai || today();
      const dari = f.dari || awalTahun(sampai);
      const ak = acc.arusKas({ dari, sampai });
      const kolom = [kol('kode', 'Kode'), kol('nama', 'Uraian (akun lawan)'), uang('arus', 'Jumlah')];
      const kel = (judul, rows, labelTotal, nilai) => ({
        judul, kolom,
        baris: rows.map((r) => ({ kode: r.coa_kode, nama: r.nama, arus: r.arus })),
        total: { _label: labelTotal, arus: nilai || 0 },
      });
      // Pembanding: mutasi bersih akun kas & bank menurut buku besar pada periode yang sama.
      const kasBank = acc.akunKasBank();
      const mutasiBuku = kasBank.reduce((s, k) => s + acc.saldoAkun(k, { dari, sampai }).saldo, 0);
      const saldoBuku = kasBank.reduce((s, k) => s + acc.saldoAkun(k, { sampai }).saldo, 0);
      const kenaikan = ak.kenaikan_kas || 0;
      return {
        subjudul: teksPeriode({ dari, sampai }),
        ringkasan: [
          { label: 'Kenaikan (penurunan) kas', nilai: kenaikan, tipe: 'uang' },
          { label: 'Saldo kas awal', nilai: ak.saldo_awal, tipe: 'uang' },
          { label: 'Saldo kas akhir', nilai: ak.saldo_akhir, tipe: 'uang' },
          { label: 'Selisih dengan buku besar', nilai: saldoBuku - ak.saldo_akhir, tipe: 'uang' },
        ],
        bagian: [
          kel('ARUS KAS DARI AKTIVITAS OPERASI', ak.operasi, 'Arus kas bersih aktivitas operasi', ak.arus_operasi),
          kel('ARUS KAS DARI AKTIVITAS INVESTASI', ak.investasi, 'Arus kas bersih aktivitas investasi', ak.arus_investasi),
          kel('ARUS KAS DARI AKTIVITAS PENDANAAN', ak.pendanaan, 'Arus kas bersih aktivitas pendanaan', ak.arus_pendanaan),
          {
            judul: 'RINGKASAN',
            kolom: [kol('nama', 'Uraian'), uang('nilai', 'Jumlah')],
            baris: [
              { nama: 'Kenaikan (penurunan) bersih kas & setara kas', nilai: kenaikan },
              { nama: 'Kas & setara kas awal periode', nilai: ak.saldo_awal },
              { nama: 'Kas & setara kas akhir periode', nilai: ak.saldo_akhir },
              { nama: 'Mutasi bersih akun kas & bank menurut buku besar', nilai: mutasiBuku },
              { nama: 'Saldo akun kas & bank menurut buku besar', nilai: saldoBuku },
            ],
          },
        ],
        catatan: 'Setiap jurnal kas diklasifikasikan menurut akun lawan bernilai terbesar; kelompok investasi dan '
          + 'pendanaan mengikuti Parameter Sistem (kelompok akun arus kas).',
      };
    },
  },

  {
    kode: 'perubahan-ekuitas',
    judul: 'Laporan Perubahan Ekuitas',
    izin: 'laporan.view',
    jenis_ttd: 'laporan_keuangan',
    deskripsi: 'Saldo awal, penambahan, pengurangan, dan saldo akhir setiap akun ekuitas serta SHU (bila tanggal awal kosong: awal tahun).',
    filter: periodeLaporan(),
    susun(f) {
      const sampai = f.sampai || today();
      const dari = f.dari || awalTahun(sampai);
      const pAwal = posisiKeuangan(kemarin(dari));
      const pAkhir = posisiKeuangan(sampai);
      const akun = all("SELECT kode, nama, saldo_normal FROM coa WHERE tipe = 'ekuitas' AND is_postable = 1 ORDER BY kode");
      const baris = akun.map((a) => {
        const awal = acc.saldoAkun(a.kode, { sampai: kemarin(dari) }).saldo;
        const m = acc.saldoAkun(a.kode, { dari, sampai });
        const kredit = a.saldo_normal === 'K';
        return { kode: a.kode, nama: a.nama, awal, tambah: kredit ? m.kredit : m.debit,
          kurang: kredit ? m.debit : m.kredit, akhir: awal + m.saldo };
      }).filter((r) => r.awal || r.tambah || r.kurang || r.akhir);
      // Hasil usaha yang belum dipindahkan ke akun ekuitas (tahun berjalan + tahun lalu yang belum ditutup).
      const belumAwal = pAwal.shu_belum_dipindah + pAwal.shu_lalu_belum_ditutup;
      const belumAkhir = pAkhir.shu_belum_dipindah + pAkhir.shu_lalu_belum_ditutup;
      const shuPeriode = acc.labaRugi({ dari, sampai }).shu_bersih;
      baris.push({ kode: '', nama: 'SHU belum dipindahkan ke akun ekuitas', awal: belumAwal,
        tambah: shuPeriode, kurang: belumAwal + shuPeriode - belumAkhir, akhir: belumAkhir });
      const total = jumlahkan(baris, ['awal', 'tambah', 'kurang', 'akhir']);
      return {
        subjudul: teksPeriode({ dari, sampai }),
        ringkasan: [
          { label: 'Ekuitas awal', nilai: total.awal, tipe: 'uang' },
          { label: 'Ekuitas akhir', nilai: total.akhir, tipe: 'uang' },
          { label: 'SHU periode', nilai: shuPeriode, tipe: 'uang' },
          { label: 'Selisih dengan neraca', nilai: total.akhir - pAkhir.total_ekuitas, tipe: 'uang' },
        ],
        bagian: [{
          kolom: [kol('kode', 'Kode'), kol('nama', 'Uraian'), uang('awal', 'Saldo Awal'), uang('tambah', 'Penambahan'),
            uang('kurang', 'Pengurangan'), uang('akhir', 'Saldo Akhir')],
          baris, total,
        }],
        catatan: 'Penambahan baris SHU adalah hasil usaha periode; pengurangannya adalah SHU yang dipindahkan ke akun '
          + 'ekuitas melalui jurnal penutup.',
      };
    },
  },

  {
    kode: 'rasio-keuangan',
    judul: 'Analisis Rasio Keuangan',
    izin: 'laporan.view',
    jenis_ttd: 'laporan_keuangan',
    deskripsi: 'Rasio likuiditas, solvabilitas, rentabilitas, dan kualitas pinjaman per tanggal.',
    filter: [perTanggal()],
    susun(f) {
      const sampai = f.sampai || today();
      const r = acc.rasioKeuangan({ sampai });
      const baris = [
        ['Likuiditas', 'Rasio lancar', r.likuiditas.rasio_lancar, 'persen', r.likuiditas.keterangan],
        ['Likuiditas', 'Rasio kas', r.likuiditas.rasio_kas, 'persen', ''],
        ['Solvabilitas', 'Rasio utang terhadap aset', r.solvabilitas.rasio_hutang_aset, 'persen', ''],
        ['Solvabilitas', 'Rasio modal sendiri terhadap aset', r.solvabilitas.rasio_modal_sendiri, 'persen', ''],
        ['Rentabilitas', 'Return on assets (ROA)', r.rentabilitas.roa, 'persen', 'SHU tahun berjalan / jumlah aset'],
        ['Rentabilitas', 'Return on equity (ROE)', r.rentabilitas.roe, 'persen', 'SHU tahun berjalan / jumlah ekuitas'],
        ['Rentabilitas', 'Margin SHU', r.rentabilitas.margin_shu, 'persen', 'SHU / jumlah pendapatan'],
        ['Kualitas pinjaman', 'Outstanding pinjaman', r.kualitas_pinjaman.outstanding, 'uang', ''],
        ['Kualitas pinjaman', 'Pinjaman bermasalah (kolektibilitas 3-5)', r.kualitas_pinjaman.npl_nominal, 'uang', ''],
        ['Kualitas pinjaman', 'Rasio NPL', r.kualitas_pinjaman.npl_ratio, 'persen', r.kualitas_pinjaman.keterangan],
      ].map(([aspek, rasio, nilai, tipe, ket]) => ({
        aspek, rasio, persen: tipe === 'persen' ? nilai : null, nominal: tipe === 'uang' ? nilai : null, keterangan: ket,
      }));
      return {
        subjudul: `Per ${tanggalPanjang(sampai)}`,
        bagian: [{
          kolom: [kol('aspek', 'Aspek'), kol('rasio', 'Rasio'), kol('persen', 'Nilai', 'persen'),
            uang('nominal', 'Nominal'), kol('keterangan', 'Keterangan')],
          baris,
        }],
        catatan: 'Kelompok aset lancar dan kewajiban jangka pendek mengikuti Parameter Sistem (kelompok akun).',
      };
    },
  },

  {
    kode: 'rekap-pajak',
    judul: 'Rekapitulasi Pajak',
    izin: 'laporan.view',
    jenis_ttd: 'laporan_keuangan',
    deskripsi: 'Mutasi akun pajak (master pajak, pemetaan PPN, dan kelompok akun pajak) per periode '
      + '(bila tanggal awal kosong: awal tahun).',
    filter: periodeLaporan(),
    susun(f) {
      const sampai = f.sampai || today();
      const dari = f.dari || awalTahun(sampai);
      const baris = akunPajak().map((a) => {
        const awal = acc.saldoAkun(a.kode, { sampai: kemarin(dari) }).saldo;
        const m = acc.saldoAkun(a.kode, { dari, sampai });
        return { kode: a.kode, nama: a.nama, awal, debit: m.debit, kredit: m.kredit, mutasi: m.saldo, akhir: awal + m.saldo };
      });
      const keluaran = setting('coa.hutang_pajak', null);
      const masukan = setting('coa.ppn_masukan', null);
      const mKeluar = keluaran ? acc.saldoAkun(keluaran, { dari, sampai }) : null;
      const mMasuk = masukan ? acc.saldoAkun(masukan, { dari, sampai }) : null;
      return {
        subjudul: teksPeriode({ dari, sampai }),
        ringkasan: [
          ...(mKeluar ? [{ label: `Mutasi ${namaAkun(keluaran)}`, nilai: mKeluar.saldo, tipe: 'uang' }] : []),
          ...(mMasuk ? [{ label: `Mutasi ${namaAkun(masukan)}`, nilai: mMasuk.saldo, tipe: 'uang' }] : []),
        ],
        bagian: [{
          kolom: [kol('kode', 'Kode'), kol('nama', 'Nama Akun'), uang('awal', 'Saldo Awal'), uang('debit', 'Debit'),
            uang('kredit', 'Kredit'), uang('mutasi', 'Mutasi Bersih'), uang('akhir', 'Saldo Akhir')],
          baris, total: jumlahkan(baris, ['awal', 'debit', 'kredit', 'mutasi', 'akhir']),
        }],
        catatan: 'Koperasi wajib menyampaikan SPT Tahunan PPh Badan. SHU yang dibagikan kepada anggota bukan merupakan '
          + 'objek PPh Pasal 23 sepanjang memenuhi ketentuan perpajakan yang berlaku.',
      };
    },
  },

  // ============================ KAS & BANK ============================
  {
    kode: 'bukti-kas',
    judul: 'Daftar Bukti Kas & Bank',
    izin: 'kas.view',
    orientasi: 'landscape',
    jenis_ttd: 'laporan',
    deskripsi: 'Bukti kas masuk, kas keluar, kas kecil, dan transfer per periode termasuk yang dibatalkan.',
    filter: [
      ...periode(),
      pilih('jenis', 'Jenis', Object.entries(JENIS_KAS).map(([nilai, teks]) => ({ nilai, teks }))),
      pilih('status', 'Status', [{ nilai: 'posted', teks: 'Berlaku' }, { nilai: 'batal', teks: 'Dibatalkan' }]),
      pilih('akun', 'Akun kas/bank', opsiAkunKas),
      ...rentang('nomor', 'Nomor bukti'),
      pilih('cabang_id', 'Cabang', opsiCabang),
    ],
    susun(f) {
      const w = kondisi().periode('k.tanggal', f).sama('k.jenis', f.jenis).sama('k.status', f.status)
        .rentang('k.nomor', f, 'nomor').sama('k.cabang_id', f.cabang_id);
      if (f.akun) w.tambah('(k.coa_kas = ? OR k.coa_tujuan = ?)', f.akun, f.akun);
      const data = all(
        `SELECT k.*, ck.nama AS nama_kas, cl.nama AS nama_lawan, ct.nama AS nama_tujuan
           FROM kas_bank k LEFT JOIN coa ck ON ck.kode = k.coa_kas LEFT JOIN coa cl ON cl.kode = k.coa_lawan
           LEFT JOIN coa ct ON ct.kode = k.coa_tujuan ${w.where()} ORDER BY k.tanggal, k.nomor`, w.params);
      const baris = bernomor(data.map((k) => {
        const batal = k.status === 'batal';
        const v = (cocok) => (!batal && cocok ? k.nominal : null);
        return {
          tanggal: k.tanggal, nomor: k.nomor, jenis: JENIS_KAS[k.jenis] || k.jenis,
          akun_kas: `${k.coa_kas} ${k.nama_kas || ''}`.trim(),
          lawan: k.jenis === 'transfer' ? `${k.coa_tujuan} ${k.nama_tujuan || ''}`.trim() : `${k.coa_lawan} ${k.nama_lawan || ''}`.trim(),
          uraian: [k.pihak, k.keterangan].filter(Boolean).join(' - '),
          masuk: v(k.jenis === 'kas_masuk'), keluar: v(k.jenis === 'kas_keluar' || k.jenis === 'petty_cash'),
          transfer: v(k.jenis === 'transfer'), batal: batal ? k.nominal : null,
          status: batal ? `Batal${k.alasan_batal ? `: ${k.alasan_batal}` : ''}` : (k.rekonsiliasi ? 'Berlaku, direkonsiliasi' : 'Berlaku'),
        };
      }));
      const total = jumlahkan(baris, ['masuk', 'keluar', 'transfer', 'batal']);
      return {
        subjudul: teksPeriode(f),
        ringkasan: [
          { label: 'Jumlah bukti', nilai: baris.length, tipe: 'angka' },
          { label: 'Total kas masuk', nilai: total.masuk, tipe: 'uang' },
          { label: 'Total kas keluar', nilai: total.keluar, tipe: 'uang' },
          { label: 'Total transfer', nilai: total.transfer, tipe: 'uang' },
          { label: 'Total dibatalkan', nilai: total.batal, tipe: 'uang' },
        ],
        bagian: [{
          kolom: [KOLOM_NO, kol('tanggal', 'Tanggal', 'tanggal'), kol('nomor', 'Nomor'), kol('jenis', 'Jenis'),
            kol('akun_kas', 'Akun Kas/Bank'), kol('lawan', 'Akun Lawan / Tujuan'), kol('uraian', 'Pihak / Keterangan'),
            uang('masuk', 'Masuk'), uang('keluar', 'Keluar'), uang('transfer', 'Transfer'), uang('batal', 'Dibatalkan'),
            kol('status', 'Status')],
          baris, total,
        }],
      };
    },
  },

  {
    kode: 'buku-kas',
    judul: 'Buku Kas & Bank',
    izin: 'kas.view',
    orientasi: 'landscape',
    jenis_ttd: 'laporan',
    deskripsi: 'Mutasi dan saldo berjalan setiap akun kas/bank per periode (bila tanggal awal kosong: awal bulan).',
    filter: [...periodeLaporan(), pilih('akun', 'Akun kas/bank', opsiAkunKas)],
    susun(f) {
      const sampai = f.sampai || today();
      const dari = f.dari || awalBulan(sampai);
      const akun = f.akun ? [f.akun] : acc.akunKasBank().sort().slice(0, MAKS_AKUN);
      const ringkas = [];
      const bagian = akun.map((kode) => {
        const bb = acc.bukuBesar(kode, { dari, sampai });
        ringkas.push({ kode, nama: bb.akun.nama, awal: bb.saldo_awal, masuk: jumlah(bb.baris, 'debit'),
          keluar: jumlah(bb.baris, 'kredit'), akhir: bb.saldo_akhir });
        return {
          judul: `${bb.akun.kode} - ${bb.akun.nama}`,
          kolom: [kol('tanggal', 'Tanggal', 'tanggal'), kol('nomor', 'Nomor'), kol('keterangan', 'Keterangan'),
            uang('masuk', 'Masuk'), uang('keluar', 'Keluar'), uang('saldo', 'Saldo')],
          baris: [
            { tanggal: dari, nomor: '', keterangan: 'Saldo awal', masuk: null, keluar: null, saldo: bb.saldo_awal },
            ...bb.baris.map((m) => ({ tanggal: m.tanggal, nomor: m.nomor, keterangan: m.keterangan || m.jurnal_ket || '',
              masuk: m.debit, keluar: m.kredit, saldo: m.saldo })),
          ],
          total: { _label: 'Jumlah / saldo akhir', masuk: jumlah(bb.baris, 'debit'), keluar: jumlah(bb.baris, 'kredit'),
            saldo: bb.saldo_akhir },
        };
      });
      if (akun.length > 1) {
        bagian.unshift({
          judul: 'Rekapitulasi',
          kolom: [kol('kode', 'Kode'), kol('nama', 'Akun'), uang('awal', 'Saldo Awal'), uang('masuk', 'Masuk'),
            uang('keluar', 'Keluar'), uang('akhir', 'Saldo Akhir')],
          baris: ringkas, total: jumlahkan(ringkas, ['awal', 'masuk', 'keluar', 'akhir']),
        });
      }
      return {
        subjudul: teksPeriode({ dari, sampai }),
        ringkasan: [
          { label: 'Saldo awal', nilai: jumlah(ringkas, 'awal'), tipe: 'uang' },
          { label: 'Total masuk', nilai: jumlah(ringkas, 'masuk'), tipe: 'uang' },
          { label: 'Total keluar', nilai: jumlah(ringkas, 'keluar'), tipe: 'uang' },
          { label: 'Saldo akhir', nilai: jumlah(ringkas, 'akhir'), tipe: 'uang' },
        ],
        bagian,
      };
    },
  },

  {
    kode: 'posisi-kas',
    judul: 'Posisi Kas & Bank',
    izin: 'kas.view',
    jenis_ttd: 'laporan',
    deskripsi: 'Saldo seluruh akun kas dan bank per tanggal beserta rekening bank yang dipetakan.',
    filter: [perTanggal()],
    susun(f) {
      const sampai = f.sampai || today();
      const akun = all(`SELECT kode, nama, is_kas, is_bank FROM coa WHERE (is_kas = 1 OR is_bank = 1)
                         AND is_postable = 1 ORDER BY kode`);
      const baris = akun.map((a) => {
        const rek = all('SELECT nama_bank, nomor_rekening FROM bank_account WHERE coa_kode = ? ORDER BY id', [a.kode]);
        return {
          kode: a.kode, nama: a.nama, jenis: a.is_bank ? 'Bank' : 'Kas',
          rekening: rek.map((r) => `${r.nama_bank} ${r.nomor_rekening}`).join('; '),
          saldo: acc.saldoAkun(a.kode, { sampai }).saldo,
        };
      });
      const totalKas = jumlah(baris.filter((r) => r.jenis === 'Kas'), 'saldo');
      const totalBank = jumlah(baris.filter((r) => r.jenis === 'Bank'), 'saldo');
      return {
        subjudul: `Per ${tanggalPanjang(sampai)}`,
        ringkasan: [
          { label: 'Total kas', nilai: totalKas, tipe: 'uang' },
          { label: 'Total bank', nilai: totalBank, tipe: 'uang' },
          { label: 'Total kas & bank', nilai: totalKas + totalBank, tipe: 'uang' },
        ],
        bagian: [{
          kolom: [kol('kode', 'Kode'), kol('nama', 'Nama Akun'), kol('jenis', 'Jenis'), kol('rekening', 'Rekening Bank'),
            uang('saldo', 'Saldo')],
          baris, total: jumlahkan(baris, ['saldo']),
        }],
      };
    },
  },

  {
    kode: 'rekonsiliasi-bank',
    judul: 'Rekonsiliasi Kas & Bank',
    izin: 'kas.view',
    orientasi: 'landscape',
    jenis_ttd: 'laporan',
    deskripsi: 'Bukti kas/bank satu akun yang sudah atau belum direkonsiliasi dengan rekening koran, serta saldo buku.',
    filter: [
      ...periode(),
      { kunci: 'akun', label: 'Akun kas/bank', tipe: 'pilih', opsi: opsiAkunKas, wajib: true,
        bawaan: () => get('SELECT kode FROM coa WHERE is_bank = 1 AND is_postable = 1 ORDER BY kode')?.kode
          ?? get('SELECT kode FROM coa WHERE is_kas = 1 AND is_postable = 1 ORDER BY kode')?.kode },
      pilih('rekon', 'Status rekonsiliasi', [{ nilai: 'belum', teks: 'Belum direkonsiliasi' },
        { nilai: 'sudah', teks: 'Sudah direkonsiliasi' }]),
    ],
    susun(f) {
      const sampai = f.sampai || today();
      const w = kondisi().periode('tanggal', f).tambah("status <> 'batal'")
        .tambah('(coa_kas = ? OR coa_tujuan = ?)', f.akun, f.akun);
      if (f.rekon) w.tambah('rekonsiliasi = ?', f.rekon === 'sudah' ? 1 : 0);
      const data = all(`SELECT * FROM kas_bank ${w.where()} ORDER BY tanggal, nomor`, w.params);
      const baris = bernomor(data.map((k) => {
        // Arah mutasi terhadap akun terpilih (transfer: keluar dari akun asal, masuk ke akun tujuan).
        const masuk = k.jenis === 'kas_masuk' || (k.jenis === 'transfer' && k.coa_tujuan === f.akun);
        return {
          tanggal: k.tanggal, nomor: k.nomor, jenis: JENIS_KAS[k.jenis] || k.jenis,
          uraian: [k.pihak, k.keterangan].filter(Boolean).join(' - '),
          masuk: masuk ? k.nominal : null, keluar: masuk ? null : k.nominal,
          rekon: k.rekonsiliasi ? 'Sudah' : 'Belum', tanggal_rekon: k.tanggal_rekon,
        };
      }));
      const belum = baris.filter((r) => r.rekon === 'Belum');
      // Bukti yang belum direkonsiliasi s.d. tanggal akhir (tanpa memandang tanggal awal) untuk rekonsiliasi saldo.
      const semuaBelum = all(`SELECT jenis, coa_tujuan, nominal FROM kas_bank WHERE status <> 'batal' AND rekonsiliasi = 0
                               AND (coa_kas = ? OR coa_tujuan = ?) AND tanggal <= ?`, [f.akun, f.akun, sampai]);
      const belumMasuk = semuaBelum.filter((k) => k.jenis === 'kas_masuk' || (k.jenis === 'transfer' && k.coa_tujuan === f.akun))
        .reduce((s, k) => s + k.nominal, 0);
      const belumKeluar = semuaBelum.reduce((s, k) => s + k.nominal, 0) - belumMasuk;
      const saldoBuku = acc.saldoAkun(f.akun, { sampai }).saldo;
      return {
        subjudul: `${namaAkun(f.akun)} · ${teksPeriode(f)}`,
        ringkasan: [
          { label: `Saldo buku per ${tanggalPanjang(sampai)}`, nilai: saldoBuku, tipe: 'uang' },
          { label: 'Penerimaan belum direkonsiliasi', nilai: belumMasuk, tipe: 'uang' },
          { label: 'Pengeluaran belum direkonsiliasi', nilai: belumKeluar, tipe: 'uang' },
          { label: 'Perkiraan saldo rekening koran', nilai: saldoBuku - belumMasuk + belumKeluar, tipe: 'uang' },
          { label: 'Jumlah bukti belum rekon (daftar)', nilai: belum.length, tipe: 'angka' },
        ],
        bagian: [{
          kolom: [KOLOM_NO, kol('tanggal', 'Tanggal', 'tanggal'), kol('nomor', 'Nomor'), kol('jenis', 'Jenis'),
            kol('uraian', 'Pihak / Keterangan'), uang('masuk', 'Masuk'), uang('keluar', 'Keluar'),
            kol('rekon', 'Rekonsiliasi'), kol('tanggal_rekon', 'Tgl Rekon', 'tanggal')],
          baris, total: jumlahkan(baris, ['masuk', 'keluar']),
        }],
        catatan: 'Perkiraan saldo rekening koran = saldo buku - penerimaan belum direkonsiliasi + pengeluaran belum '
          + 'direkonsiliasi (hanya transaksi yang tercatat sebagai bukti kas/bank).',
      };
    },
  },

  {
    kode: 'cash-opname',
    judul: 'Riwayat Cash Opname',
    izin: 'kas.view',
    orientasi: 'landscape',
    jenis_ttd: 'laporan',
    deskripsi: 'Hasil pemeriksaan fisik kas: saldo sistem, saldo fisik, dan selisih per periode.',
    filter: [...periode(), pilih('akun', 'Akun kas/bank', opsiAkunKas)],
    susun(f) {
      const w = kondisi().periode('o.tanggal', f).sama('o.coa_kas', f.akun);
      const baris = bernomor(all(
        `SELECT o.tanggal, o.coa_kas || ' ' || COALESCE(c.nama, '') AS akun, o.saldo_sistem, o.saldo_fisik, o.selisih,
                o.keterangan, o.petugas, j.nomor AS jurnal
           FROM cash_opname o LEFT JOIN coa c ON c.kode = o.coa_kas LEFT JOIN jurnal j ON j.id = o.jurnal_id
          ${w.where()} ORDER BY o.tanggal, o.id`, w.params));
      return {
        subjudul: teksPeriode(f),
        ringkasan: [
          { label: 'Jumlah pemeriksaan', nilai: baris.length, tipe: 'angka' },
          { label: 'Selisih lebih', nilai: baris.reduce((s, r) => s + Math.max(r.selisih, 0), 0), tipe: 'uang' },
          { label: 'Selisih kurang', nilai: baris.reduce((s, r) => s + Math.min(r.selisih, 0), 0), tipe: 'uang' },
        ],
        bagian: [{
          kolom: [KOLOM_NO, kol('tanggal', 'Tanggal', 'tanggal'), kol('akun', 'Akun Kas'), uang('saldo_sistem', 'Saldo Sistem'),
            uang('saldo_fisik', 'Saldo Fisik'), uang('selisih', 'Selisih'), kol('keterangan', 'Keterangan'),
            kol('petugas', 'Petugas'), kol('jurnal', 'Jurnal Penyesuaian')],
          baris, total: jumlahkan(baris, ['selisih']),
        }],
      };
    },
  },

  // ========================= HUTANG & PIUTANG =========================
  {
    kode: 'umur-hutang-piutang',
    judul: 'Daftar & Umur Hutang / Piutang',
    izin: 'akuntansi.view',
    orientasi: 'landscape',
    jenis_ttd: 'laporan',
    deskripsi: 'Saldo hutang usaha atau piutang usaha per tanggal beserta analisis umur (aging) sejak jatuh tempo.',
    filter: [
      { kunci: 'jenis', label: 'Jenis', tipe: 'pilih', wajib: true, bawaan: 'hutang',
        opsi: [{ nilai: 'hutang', teks: 'Hutang usaha' }, { nilai: 'piutang', teks: 'Piutang usaha' }] },
      perTanggal(),
      pilih('tampil', 'Tampilkan', [{ nilai: 'terbuka', teks: 'Yang masih bersaldo' }, { nilai: 'semua', teks: 'Semua' }]),
      { kunci: 'q', label: 'Cari pihak / referensi', tipe: 'teks' },
    ],
    susun(f) {
      const sampai = f.sampai || today();
      const w = kondisi().sama('h.jenis', f.jenis).tambah('h.tanggal <= ?', sampai)
        .cari(['s.nama', 'c.nama', 'a.nama', 'h.pihak', 'h.referensi'], f.q);
      // Terbayar per tanggal = terbayar saat ini dikurangi pembayaran sesudah tanggal laporan.
      const data = all(
        `SELECT h.*, COALESCE(s.nama, c.nama, a.nama, h.pihak, '-') AS nama_pihak,
                h.terbayar - COALESCE((SELECT SUM(j.total_debit) FROM jurnal j
                  WHERE j.referensi = 'hp:' || h.id AND j.status = 'posted' AND j.tanggal > ?), 0) AS terbayar_per
           FROM hutang_piutang h
           LEFT JOIN supplier s ON s.id = h.supplier_id LEFT JOIN customer c ON c.id = h.customer_id
           LEFT JOIN anggota a ON a.id = h.anggota_id
          ${w.where()} ORDER BY COALESCE(h.jatuh_tempo, h.tanggal), h.id`, [sampai, ...w.params]);
      const baris = bernomor(data.map((h) => {
        const sisa = h.nominal - h.terbayar_per;
        const umur = selisihHari(h.jatuh_tempo || h.tanggal, sampai);
        const ember = (cocok) => (sisa > 0 && cocok ? sisa : null);
        return {
          referensi: h.referensi, pihak: h.nama_pihak, tanggal: h.tanggal, jatuh_tempo: h.jatuh_tempo,
          nominal: h.nominal, terbayar: h.terbayar_per, sisa, umur: sisa > 0 ? Math.max(umur, 0) : null,
          lancar: ember(umur <= 0), u30: ember(umur > 0 && umur <= 30), u60: ember(umur > 30 && umur <= 60),
          u90: ember(umur > 60 && umur <= 90), u90plus: ember(umur > 90),
        };
      }).filter((r) => f.tampil === 'semua' || r.sisa > 0));
      const total = jumlahkan(baris, ['nominal', 'terbayar', 'sisa', 'lancar', 'u30', 'u60', 'u90', 'u90plus']);
      return {
        judul: f.jenis === 'piutang' ? 'Daftar & Umur Piutang Usaha' : 'Daftar & Umur Hutang Usaha',
        subjudul: `Per ${tanggalPanjang(sampai)}`,
        ringkasan: [
          { label: 'Jumlah tagihan', nilai: baris.length, tipe: 'angka' },
          { label: 'Total sisa', nilai: total.sisa, tipe: 'uang' },
          { label: 'Belum jatuh tempo', nilai: total.lancar, tipe: 'uang' },
          { label: 'Lewat jatuh tempo', nilai: total.sisa - total.lancar, tipe: 'uang' },
        ],
        bagian: [{
          kolom: [KOLOM_NO, kol('referensi', 'Referensi'), kol('pihak', 'Pihak'), kol('tanggal', 'Tanggal', 'tanggal'),
            kol('jatuh_tempo', 'Jatuh Tempo', 'tanggal'), uang('nominal', 'Nominal'), uang('terbayar', 'Terbayar'),
            uang('sisa', 'Sisa'), kol('umur', 'Lewat JT (hari)', 'angka'), uang('lancar', 'Belum JT'), uang('u30', '1-30 hari'),
            uang('u60', '31-60 hari'), uang('u90', '61-90 hari'), uang('u90plus', '> 90 hari')],
          baris, total,
        }],
      };
    },
  },

  {
    kode: 'pembayaran-hutang-piutang',
    judul: 'Pembayaran Hutang & Penerimaan Piutang',
    izin: 'akuntansi.view',
    orientasi: 'landscape',
    jenis_ttd: 'laporan',
    deskripsi: 'Daftar pembayaran hutang usaha dan penerimaan piutang usaha per periode.',
    filter: [
      ...periode(),
      pilih('jenis', 'Jenis', [{ nilai: 'hutang', teks: 'Pembayaran hutang' }, { nilai: 'piutang', teks: 'Penerimaan piutang' }]),
      { kunci: 'q', label: 'Cari pihak / referensi', tipe: 'teks' },
    ],
    susun(f) {
      const w = kondisi().tambah("j.referensi LIKE 'hp:%'").periode('j.tanggal', f).sama('h.jenis', f.jenis)
        .cari(['s.nama', 'c.nama', 'a.nama', 'h.pihak', 'h.referensi'], f.q);
      const data = all(
        `SELECT j.tanggal, j.nomor, j.status, j.total_debit AS nominal, h.jenis, h.referensi,
                COALESCE(s.nama, c.nama, a.nama, h.pihak, '-') AS pihak,
                (SELECT group_concat(d.coa_kode || ' ' || ck.nama, '; ') FROM jurnal_detail d JOIN coa ck ON ck.kode = d.coa_kode
                  WHERE d.jurnal_id = j.id AND (ck.is_kas = 1 OR ck.is_bank = 1)) AS akun_kas
           FROM jurnal j JOIN hutang_piutang h ON h.id = CAST(substr(j.referensi, 4) AS INTEGER)
           LEFT JOIN supplier s ON s.id = h.supplier_id LEFT JOIN customer c ON c.id = h.customer_id
           LEFT JOIN anggota a ON a.id = h.anggota_id
          ${w.where()} ORDER BY j.tanggal, j.nomor`, w.params);
      const baris = bernomor(data.map((r) => {
        const batal = r.status === 'void';
        return {
          tanggal: r.tanggal, nomor: r.nomor, jenis: r.jenis === 'hutang' ? 'Pembayaran hutang' : 'Penerimaan piutang',
          referensi: r.referensi, pihak: r.pihak, akun_kas: r.akun_kas || '',
          bayar: !batal && r.jenis === 'hutang' ? r.nominal : null,
          terima: !batal && r.jenis === 'piutang' ? r.nominal : null,
          batal: batal ? r.nominal : null,
        };
      }));
      const total = jumlahkan(baris, ['bayar', 'terima', 'batal']);
      return {
        subjudul: teksPeriode(f),
        ringkasan: [
          { label: 'Jumlah transaksi', nilai: baris.length, tipe: 'angka' },
          { label: 'Total pembayaran hutang', nilai: total.bayar, tipe: 'uang' },
          { label: 'Total penerimaan piutang', nilai: total.terima, tipe: 'uang' },
        ],
        bagian: [{
          kolom: [KOLOM_NO, kol('tanggal', 'Tanggal', 'tanggal'), kol('nomor', 'Nomor Bukti'), kol('jenis', 'Jenis'),
            kol('referensi', 'Referensi'), kol('pihak', 'Pihak'), kol('akun_kas', 'Akun Kas/Bank'),
            uang('bayar', 'Pembayaran'), uang('terima', 'Penerimaan'), uang('batal', 'Dibatalkan')],
          baris, total,
        }],
      };
    },
  },

  // ============================= ANGGARAN =============================
  {
    kode: 'realisasi-anggaran',
    judul: 'Realisasi Anggaran (RKAP)',
    izin: 'anggaran.view',
    orientasi: 'landscape',
    jenis_ttd: 'laporan',
    deskripsi: 'Perbandingan anggaran dengan realisasi buku besar per akun s.d. tanggal tertentu.',
    filter: [
      { kunci: 'anggaran_id', label: 'Anggaran', tipe: 'pilih', opsi: opsiAnggaran, wajib: true,
        bawaan: () => get('SELECT id FROM anggaran ORDER BY tahun DESC, id DESC')?.id },
      { kunci: 'sampai', label: 'Realisasi s.d. tanggal', tipe: 'tanggal' },
    ],
    susun(f) {
      const a = get(`SELECT a.*, u.nama AS unit, c.nama AS cabang FROM anggaran a
                       LEFT JOIN unit_usaha u ON u.id = a.unit_usaha_id LEFT JOIN cabang c ON c.id = a.cabang_id
                      WHERE a.id = ?`, [Number(f.anggaran_id)]);
      if (!a) return { bagian: [] };
      const dari = `${a.tahun}-01-01`;
      const sampai = f.sampai || `${a.tahun}-12-31`;
      const detail = all(
        `SELECT d.coa_kode AS kode, c.nama, c.tipe, SUM(d.nominal) AS anggaran
           FROM anggaran_detail d JOIN coa c ON c.kode = d.coa_kode
          WHERE d.anggaran_id = ? GROUP BY d.coa_kode, c.nama, c.tipe ORDER BY d.coa_kode`, [a.id]);
      const baris = detail.map((d) => {
        // Jurnal penutup dikeluarkan agar realisasi tahun buku yang sudah ditutup tidak menjadi nol.
        const real = acc.saldoAkun(d.kode, { dari, sampai, unit_usaha_id: a.unit_usaha_id, cabang_id: a.cabang_id,
          tanpa_penutup: true }).saldo;
        return {
          kode: d.kode, nama: d.nama, tipe: d.tipe, anggaran: d.anggaran, realisasi: real, selisih: real - d.anggaran,
          persen: d.anggaran ? Number(((real / d.anggaran) * 100).toFixed(1)) : 0,
          status: d.tipe === 'beban'
            ? (real > d.anggaran ? 'Melebihi anggaran' : 'Dalam anggaran')
            : (real >= d.anggaran ? 'Tercapai' : 'Belum tercapai'),
        };
      });
      const kolom = [kol('kode', 'Kode'), kol('nama', 'Nama Akun'), uang('anggaran', 'Anggaran'), uang('realisasi', 'Realisasi'),
        uang('selisih', 'Selisih'), kol('persen', 'Realisasi', 'persen'), kol('status', 'Status')];
      const kelompok = [['pendapatan', 'PENDAPATAN'], ['beban', 'BEBAN'], ['aset', 'ASET'], ['kewajiban', 'KEWAJIBAN'],
        ['ekuitas', 'EKUITAS']];
      const bagian = kelompok.map(([tipe, judul]) => {
        const rows = baris.filter((r) => r.tipe === tipe);
        if (!rows.length) return null;
        const t = jumlahkan(rows, ['anggaran', 'realisasi', 'selisih']);
        t._label = `JUMLAH ${judul}`;
        t.persen = t.anggaran ? Number(((t.realisasi / t.anggaran) * 100).toFixed(1)) : 0;
        return { judul, kolom, baris: rows, total: t };
      }).filter(Boolean);
      const tot = (tipe, k) => jumlah(baris.filter((r) => r.tipe === tipe), k);
      return {
        subjudul: `${a.nama} - tahun ${a.tahun}, realisasi s.d. ${tanggalPanjang(sampai)}`,
        keterangan: [[a.unit && `Unit usaha: ${a.unit}`, a.cabang && `Cabang: ${a.cabang}`, `Status anggaran: ${a.status}`]
          .filter(Boolean).join(' · ')],
        ringkasan: [
          { label: 'Anggaran pendapatan', nilai: tot('pendapatan', 'anggaran'), tipe: 'uang' },
          { label: 'Realisasi pendapatan', nilai: tot('pendapatan', 'realisasi'), tipe: 'uang' },
          { label: 'Anggaran beban', nilai: tot('beban', 'anggaran'), tipe: 'uang' },
          { label: 'Realisasi beban', nilai: tot('beban', 'realisasi'), tipe: 'uang' },
          { label: 'SHU dianggarkan', nilai: tot('pendapatan', 'anggaran') - tot('beban', 'anggaran'), tipe: 'uang' },
          { label: 'SHU terealisasi (akun beranggaran)', nilai: tot('pendapatan', 'realisasi') - tot('beban', 'realisasi'), tipe: 'uang' },
        ],
        bagian,
      };
    },
  },

  // ============================ ASET TETAP ============================
  {
    kode: 'register-aset',
    judul: 'Daftar Aset Tetap',
    izin: 'aset.view',
    orientasi: 'landscape',
    jenis_ttd: 'laporan',
    deskripsi: 'Register aset tetap per tanggal: harga perolehan, akumulasi penyusutan, dan nilai buku pada tanggal tersebut.',
    filter: [
      perTanggal(),
      pilih('kategori', 'Kategori', opsiKategoriAset),
      pilih('cabang_id', 'Cabang', opsiCabang),
      pilih('unit_usaha_id', 'Unit usaha', opsiUnit),
      ...rentang('kode', 'Kode aset'),
    ],
    susun(f) {
      const sampai = f.sampai || today();
      const w = kondisi().tambah('a.tanggal_perolehan <= ?', sampai)
        .tambah('(a.tanggal_disposal IS NULL OR a.tanggal_disposal > ?)', sampai)
        .sama('a.kategori', f.kategori).sama('a.cabang_id', f.cabang_id).sama('a.unit_usaha_id', f.unit_usaha_id)
        .rentang('a.kode', f, 'kode');
      // Akumulasi per tanggal = akumulasi awal (saldo awal register) + penyusutan yang jurnalnya (akhir bulan) <= tanggal.
      const data = all(
        `SELECT a.*, u.nama AS unit, cb.nama AS cabang,
                a.akumulasi_penyusutan - COALESCE((SELECT SUM(p.nominal) FROM aset_penyusutan p WHERE p.aset_id = a.id), 0)
                  + COALESCE((SELECT SUM(p.nominal) FROM aset_penyusutan p WHERE p.aset_id = a.id
                      AND date(p.periode || '-01', '+1 month', '-1 day') <= ?), 0) AS akumulasi_per
           FROM aset_tetap a LEFT JOIN unit_usaha u ON u.id = a.unit_usaha_id LEFT JOIN cabang cb ON cb.id = a.cabang_id
          ${w.where()} ORDER BY a.kode`, [sampai, ...w.params]);
      const baris = bernomor(data.map((a) => ({
        kode: a.kode, nama: a.nama, kategori: a.kategori, lokasi: [a.lokasi, a.cabang, a.unit].filter(Boolean).join(' / '),
        tanggal: a.tanggal_perolehan, umur: a.umur_manfaat, metode: a.metode === 'saldo_menurun' ? 'Saldo menurun' : 'Garis lurus',
        harga: a.harga_perolehan, residu: a.nilai_residu, penyusutan_bulan: penyusutanBulanan(a),
        akumulasi: a.akumulasi_per, nilai_buku: a.harga_perolehan - a.akumulasi_per,
        status: a.status === 'dilepas' ? `dilepas ${a.tanggal_disposal}` : a.status,
      })));
      const total = jumlahkan(baris, ['harga', 'residu', 'penyusutan_bulan', 'akumulasi', 'nilai_buku']);
      // Pembanding dengan buku besar: akun aset & akumulasi yang dipakai aset dalam register (tanpa filter segmen).
      const akunAset = [...new Set(all('SELECT DISTINCT coa_aset AS k FROM aset_tetap WHERE coa_aset IS NOT NULL').map((r) => r.k))];
      const akunAkum = [...new Set(all('SELECT DISTINCT coa_akumulasi AS k FROM aset_tetap WHERE coa_akumulasi IS NOT NULL')
        .map((r) => r.k))];
      // Disajikan menurut sisi normalnya (aset: debit, akumulasi: kredit) apa pun saldo normal akunnya.
      const saldoSisi = (daftar, debit) => daftar.reduce((s, k) => {
        const x = acc.saldoAkun(k, { sampai });
        return s + (debit ? x.debit - x.kredit : x.kredit - x.debit);
      }, 0);
      const bukuAset = saldoSisi(akunAset, true);
      const bukuAkum = saldoSisi(akunAkum, false);
      return {
        subjudul: `Per ${tanggalPanjang(sampai)}`,
        ringkasan: [
          { label: 'Jumlah aset', nilai: baris.length, tipe: 'angka' },
          { label: 'Total harga perolehan', nilai: total.harga, tipe: 'uang' },
          { label: 'Total akumulasi penyusutan', nilai: total.akumulasi, tipe: 'uang' },
          { label: 'Total nilai buku', nilai: total.nilai_buku, tipe: 'uang' },
          { label: `Saldo buku besar akun aset (${akunAset.join(', ') || '-'})`, nilai: bukuAset, tipe: 'uang' },
          { label: `Saldo buku besar akun akumulasi (${akunAkum.join(', ') || '-'})`, nilai: bukuAkum, tipe: 'uang' },
        ],
        bagian: [{
          kolom: [KOLOM_NO, kol('kode', 'Kode'), kol('nama', 'Nama Aset'), kol('kategori', 'Kategori'),
            kol('lokasi', 'Lokasi / Cabang / Unit'), kol('tanggal', 'Tgl Perolehan', 'tanggal'), kol('umur', 'Umur (th)', 'angka'),
            kol('metode', 'Metode'), uang('harga', 'Harga Perolehan'), uang('residu', 'Nilai Residu'),
            uang('penyusutan_bulan', 'Susut/Bulan'), uang('akumulasi', 'Akumulasi'), uang('nilai_buku', 'Nilai Buku'),
            kol('status', 'Status')],
          baris, total,
        }],
        catatan: 'Saldo buku besar dapat berbeda dari register bila ada aset yang dicatat sebagai saldo awal dengan '
          + 'neraca pembuka tersendiri, atau akun aset juga dipakai transaksi lain.',
      };
    },
  },

  {
    kode: 'penyusutan-aset',
    judul: 'Penyusutan Aset Tetap',
    izin: 'aset.view',
    orientasi: 'landscape',
    jenis_ttd: 'laporan',
    deskripsi: 'Beban penyusutan per aset per bulan dalam rentang periode (YYYY-MM).',
    filter: [
      { kunci: 'bulan_dari', label: 'Periode dari', tipe: 'bulan', bawaan: () => `${today().slice(0, 4)}-01` },
      { kunci: 'bulan_sampai', label: 'Periode sampai', tipe: 'bulan', bawaan: () => today().slice(0, 7) },
      pilih('kategori', 'Kategori', opsiKategoriAset),
      pilih('rincian', 'Tampilan', [{ nilai: 'rinci', teks: 'Rinci per bulan' }, { nilai: 'aset', teks: 'Rekap per aset' }]),
    ],
    susun(f) {
      const w = kondisi().rentang('p.periode', f, 'bulan').sama('a.kategori', f.kategori);
      const data = all(
        `SELECT p.periode, a.kode, a.nama, a.kategori, p.nominal, p.akumulasi, p.nilai_buku, j.nomor AS jurnal
           FROM aset_penyusutan p JOIN aset_tetap a ON a.id = p.aset_id LEFT JOIN jurnal j ON j.id = p.jurnal_id
          ${w.where()} ORDER BY p.periode, a.kode`, w.params);
      const sub = `Periode ${f.bulan_dari || 'awal'} s.d. ${f.bulan_sampai || 'akhir'}`;
      if (f.rincian === 'aset') {
        const peta = new Map();
        for (const r of data) {
          const x = peta.get(r.kode) || { kode: r.kode, nama: r.nama, kategori: r.kategori, bulan: 0, nominal: 0 };
          x.bulan += 1; x.nominal += r.nominal; x.akumulasi = r.akumulasi; x.nilai_buku = r.nilai_buku;
          peta.set(r.kode, x);
        }
        const baris = bernomor([...peta.values()].sort((a, b) => a.kode.localeCompare(b.kode)));
        return {
          subjudul: sub,
          ringkasan: [{ label: 'Total penyusutan', nilai: jumlah(baris, 'nominal'), tipe: 'uang' }],
          bagian: [{
            kolom: [KOLOM_NO, kol('kode', 'Kode'), kol('nama', 'Nama Aset'), kol('kategori', 'Kategori'),
              kol('bulan', 'Jumlah Bulan', 'angka'), uang('nominal', 'Penyusutan'), uang('akumulasi', 'Akumulasi Akhir'),
              uang('nilai_buku', 'Nilai Buku Akhir')],
            baris, total: jumlahkan(baris, ['nominal']),
          }],
        };
      }
      const baris = bernomor(data);
      return {
        subjudul: sub,
        ringkasan: [
          { label: 'Jumlah baris', nilai: baris.length, tipe: 'angka' },
          { label: 'Total penyusutan', nilai: jumlah(baris, 'nominal'), tipe: 'uang' },
        ],
        bagian: [{
          kolom: [KOLOM_NO, kol('periode', 'Periode'), kol('kode', 'Kode'), kol('nama', 'Nama Aset'), kol('kategori', 'Kategori'),
            uang('nominal', 'Penyusutan'), uang('akumulasi', 'Akumulasi'), uang('nilai_buku', 'Nilai Buku'), kol('jurnal', 'Jurnal')],
          baris, total: jumlahkan(baris, ['nominal']),
        }],
      };
    },
  },

  {
    kode: 'pemeliharaan-aset',
    judul: 'Pemeliharaan Aset Tetap',
    izin: 'aset.view',
    orientasi: 'landscape',
    jenis_ttd: 'laporan',
    deskripsi: 'Riwayat pemeliharaan/perbaikan aset beserta biaya dan jadwal berikutnya per periode.',
    filter: [...periode(), pilih('kategori', 'Kategori', opsiKategoriAset), { kunci: 'q', label: 'Cari aset / vendor', tipe: 'teks' }],
    susun(f) {
      const w = kondisi().periode('m.tanggal', f).sama('a.kategori', f.kategori).cari(['a.kode', 'a.nama', 'm.vendor'], f.q);
      const baris = bernomor(all(
        `SELECT m.tanggal, a.kode, a.nama, m.jenis, m.vendor, m.biaya, m.keterangan, m.jadwal_berikutnya
           FROM aset_maintenance m JOIN aset_tetap a ON a.id = m.aset_id ${w.where()} ORDER BY m.tanggal, m.id`, w.params));
      return {
        subjudul: teksPeriode(f),
        ringkasan: [
          { label: 'Jumlah pemeliharaan', nilai: baris.length, tipe: 'angka' },
          { label: 'Total biaya', nilai: jumlah(baris, 'biaya'), tipe: 'uang' },
        ],
        bagian: [{
          kolom: [KOLOM_NO, kol('tanggal', 'Tanggal', 'tanggal'), kol('kode', 'Kode Aset'), kol('nama', 'Nama Aset'),
            kol('jenis', 'Jenis'), kol('vendor', 'Vendor'), uang('biaya', 'Biaya'), kol('keterangan', 'Keterangan'),
            kol('jadwal_berikutnya', 'Jadwal Berikutnya', 'tanggal')],
          baris, total: jumlahkan(baris, ['biaya']),
        }],
      };
    },
  },

  {
    kode: 'pelepasan-aset',
    judul: 'Pelepasan Aset Tetap',
    izin: 'aset.view',
    orientasi: 'landscape',
    jenis_ttd: 'laporan',
    deskripsi: 'Aset yang dijual/dihapuskan per periode beserta nilai buku, hasil pelepasan, dan laba/rugi.',
    filter: [...periode({ label: 'Tanggal pelepasan' }), pilih('kategori', 'Kategori', opsiKategoriAset)],
    susun(f) {
      const w = kondisi().tambah("a.status = 'dilepas'").periode('a.tanggal_disposal', f).sama('a.kategori', f.kategori);
      const baris = bernomor(all(
        `SELECT a.tanggal_disposal AS tanggal, a.kode, a.nama, a.kategori, a.tanggal_perolehan, a.harga_perolehan AS harga,
                a.akumulasi_penyusutan AS akumulasi, a.harga_perolehan - a.akumulasi_penyusutan AS nilai_buku,
                COALESCE(a.nilai_disposal, 0) AS hasil,
                COALESCE(a.nilai_disposal, 0) - (a.harga_perolehan - a.akumulasi_penyusutan) AS laba_rugi,
                j.nomor AS jurnal
           FROM aset_tetap a
           LEFT JOIN jurnal j ON j.referensi = 'disposal:' || a.id AND j.status = 'posted'
          ${w.where()} ORDER BY a.tanggal_disposal, a.kode`, w.params));
      const total = jumlahkan(baris, ['harga', 'akumulasi', 'nilai_buku', 'hasil', 'laba_rugi']);
      return {
        subjudul: teksPeriode(f, 'Dilepas'),
        ringkasan: [
          { label: 'Jumlah aset dilepas', nilai: baris.length, tipe: 'angka' },
          { label: 'Total hasil pelepasan', nilai: total.hasil, tipe: 'uang' },
          { label: 'Laba (rugi) pelepasan', nilai: total.laba_rugi, tipe: 'uang' },
        ],
        bagian: [{
          kolom: [KOLOM_NO, kol('tanggal', 'Tgl Pelepasan', 'tanggal'), kol('kode', 'Kode'), kol('nama', 'Nama Aset'),
            kol('kategori', 'Kategori'), kol('tanggal_perolehan', 'Tgl Perolehan', 'tanggal'), uang('harga', 'Harga Perolehan'),
            uang('akumulasi', 'Akumulasi'), uang('nilai_buku', 'Nilai Buku'), uang('hasil', 'Hasil Pelepasan'),
            uang('laba_rugi', 'Laba (Rugi)'), kol('jurnal', 'Jurnal')],
          baris, total,
        }],
      };
    },
  },
];
