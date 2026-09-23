/**
 * Modul 1 - Dasbor Eksekutif.
 */
import { api, el, kpi, panel, panelTabel, tabel, rp, rpRingkas, angka, persen, tgl, waktu, status, judul, kosong }
  from '../inti.js';
import { grafikGaris, grafikBatang, grafikCincin, grafikPeringkat, SERI } from '../grafik.js';
import { ikon } from '../ikon.js';
import { periodeLabel } from '../inti.js';
import { metrikHero } from '../app.js';

export async function render() {
  const d = await api.get('/api/dashboard');
  const k = d.kpi;
  const p = d.perhatian;
  const wadah = el('div');

  // Angka utama di pita judul: total aset per tanggal laporan.
  metrikHero(rpRingkas(k.total_aset), `Total aset per ${tgl(d.per_tanggal, true)}`);

  // -------------------------------- KPI --------------------------------
  // Deret pertama menumpang tepi bawah pita judul (lihat .halaman.tumpang).
  wadah.append(el('div.grid.k4.mb16', [
    kpi('Total Anggota', angka(k.total_anggota), {
      catatan: `+${k.anggota_baru_bulan_ini} anggota baru bulan ini`, ikon: ikon('anggota') }),
    kpi('Total Simpanan', rpRingkas(k.total_simpanan), { catatan: rp(k.total_simpanan), ikon: ikon('dompet') }),
    kpi('Pinjaman Beredar', rpRingkas(k.total_pinjaman), { catatan: rp(k.total_pinjaman), ikon: ikon('kartu') }),
    kpi('SHU Berjalan', rpRingkas(k.shu_berjalan), {
      catatan: rp(k.shu_berjalan), ikon: ikon('bagan'),
      jenis: k.shu_berjalan >= 0 ? 'sukses' : 'bahaya' }),
  ]));

  wadah.append(el('div.grid.k4.mb16', [
    kpi('Kas & Bank', rpRingkas(k.kas_dan_bank), { catatan: rp(k.kas_dan_bank), ikon: ikon('uang') }),
    kpi('Total Aset', rpRingkas(k.total_aset), { catatan: `Ekuitas ${rpRingkas(k.total_ekuitas)}`, ikon: ikon('dasbor') }),
    kpi('Omzet Toko (bulan ini)', rpRingkas(k.omzet_toko_bulan_ini), {
      catatan: `Persediaan ${rpRingkas(k.nilai_persediaan)}`, ikon: ikon('keranjang') }),
    kpi('Rasio NPL', persen(k.npl_ratio), {
      catatan: `Kredit bermasalah ${rpRingkas(k.kredit_macet)}`, ikon: ikon('waspada'),
      jenis: k.npl_ratio < 5 ? 'sukses' : k.npl_ratio < 10 ? 'peringatan' : 'bahaya' }),
  ]));

  // ------------------------------ Grafik tren ------------------------------
  const label = d.tren.map((t) => periodeLabel(t.periode).replace(/ \d{4}$/, ''));
  const rentang = d.tren.length
    ? `${periodeLabel(d.tren[0].periode)} – ${periodeLabel(d.tren[d.tren.length - 1].periode)}` : '';
  wadah.append(panel('Tren Pendapatan, Beban & SHU', grafikGaris({
    label,
    seri: [
      { nama: 'Pendapatan', data: d.tren.map((t) => t.pendapatan) },
      { nama: 'Beban', data: d.tren.map((t) => t.beban) },
      { nama: 'SHU', data: d.tren.map((t) => t.shu) },
    ],
    tinggi: 260, area: true,
  }), [], { sub: `12 bulan terakhir${rentang ? ` · ${rentang}` : ''}` }));

  // ------------------- Perlu perhatian & portofolio pinjaman -------------------
  const butir = [];
  if (p.approval_menunggu) butir.push(['centang', `${p.approval_menunggu} permintaan menunggu persetujuan Anda`, '#/approval']);
  if (p.tagihan_tertunggak) butir.push(['jam', `${p.tagihan_tertunggak} angsuran tertunggak senilai ${rp(p.nilai_tertunggak)}`, '#/pinjaman']);
  if (p.calon_anggota) butir.push(['orang', `${p.calon_anggota} calon anggota menunggu verifikasi`, '#/anggota']);
  if (p.stok_perlu_order) butir.push(['kotak', `${p.stok_perlu_order} barang mencapai titik pemesanan ulang`, '#/persediaan']);
  if (p.izin_segera_kadaluarsa) butir.push(['neraca', `${p.izin_segera_kadaluarsa} dokumen kepatuhan akan kedaluwarsa`, '#/compliance']);
  if (p.temuan_audit_terbuka) butir.push(['kaca', `${p.temuan_audit_terbuka} temuan audit belum ditindaklanjuti`, '#/audit']);
  if (p.risiko_tinggi) butir.push(['waspada', `${p.risiko_tinggi} risiko berkategori tinggi/ekstrem`, '#/risiko']);
  if (p.tiket_terbuka) butir.push(['obrol', `${p.tiket_terbuka} tiket layanan anggota belum selesai`, '#/crm']);

  const panelPerhatian = panel('Perlu Perhatian', butir.length
    ? el('div.perhatian', butir.map(([nama, teks, tautan]) => el('a.perhatian-butir', { href: tautan }, [
      el('span.perhatian-ikon', ikon(nama, { ukuran: 17 })),
      el('span.perhatian-teks', teks),
      el('span.perhatian-panah', '→'),
    ])))
    : kosong('Tidak ada yang mendesak', 'Semua antrean kerja sudah tertangani.', 'centang'),
  [], { sub: 'Antrean kerja lintas modul yang menunggu tindakan' });

  const pk = d.portofolio_pinjaman;
  const warnaKol = ['#1b9e6b', '#eda100', '#eb6834', '#e34948', '#8b1a1a'];
  const panelPortofolio = panel('Kualitas Portofolio Pinjaman', el('div', [
    grafikCincin({
      bagian: pk.per_kolektibilitas.map((x, i) => ({
        label: `${x.kolektibilitas}. ${x.label}`, nilai: x.nominal, warna: warnaKol[i],
      })),
      tengahLabel: 'Outstanding', tengahNilai: rpRingkas(pk.total_outstanding),
    }),
    el('div.notis', {
      class: pk.npl_ratio < 5 ? 'sukses' : pk.npl_ratio < 10 ? 'peringatan' : 'bahaya',
      gaya: { marginTop: '14px', marginBottom: 0 },
    }, [el('div.isi', [
      el('strong', `NPL ${persen(pk.npl_ratio)} — ${judul(pk.status_kesehatan)}`),
      el('div.kecil', 'Kolektibilitas 3 (Kurang Lancar) ke atas dihitung sebagai kredit bermasalah. Batas sehat 5%.'),
    ])]),
  ]), [], { sub: 'Sebaran outstanding menurut kolektibilitas' });

  wadah.append(el('div.grid.k2', [panelPerhatian, panelPortofolio]));

  // ------------------------- Penjualan & pencairan -------------------------
  wadah.append(el('div.grid.k2', [
    panel('Penjualan Toko per Bulan', grafikBatang({
      label, data: d.tren.map((t) => t.penjualan), tinggi: 220,
    }), [], { sub: 'Omzet unit toko, 12 bulan terakhir' }),
    panel('Pencairan Pinjaman per Bulan', grafikBatang({
      label, data: d.tren.map((t) => t.pencairan), tinggi: 220, warna: SERI()[2],
    }), [], { sub: 'Nominal pinjaman yang dicairkan' }),
  ]));

  // --------------------- Ikhtisar kinerja & aktivitas ---------------------
  wadah.append(panel('Ikhtisar Kinerja Tahun Berjalan', el('div.grid.k2', [
    grafikPeringkat({
      baris: [
        { label: 'Pendapatan', nilai: k.pendapatan_ytd, warna: SERI()[0] },
        { label: 'Beban', nilai: k.beban_ytd, warna: SERI()[1] },
        { label: 'Simpanan anggota', nilai: k.total_simpanan, warna: SERI()[2] },
        { label: 'Pinjaman beredar', nilai: k.total_pinjaman, warna: SERI()[3] },
      ],
      format: rp,
    }),
    el('dl.deskripsi', { gaya: { alignContent: 'start' } }, [
      el('dt', 'Total aset'), el('dd', rp(k.total_aset)),
      el('dt', 'Total ekuitas'), el('dd', rp(k.total_ekuitas)),
      el('dt', 'Nilai persediaan'), el('dd', rp(k.nilai_persediaan)),
      el('dt', 'Per tanggal'), el('dd', tgl(d.per_tanggal, true)),
    ]),
  ]), [], { sub: 'Posisi sejak awal tahun buku' }));

  wadah.append(panelTabel('Aktivitas Terakhir', tabel([
    { judul: 'Waktu', render: (r) => el('span.mono.lembut.nowrap', waktu(r.waktu)) },
    { judul: 'Pengguna', render: (r) => el('span.tebal', r.username || '-') },
    { judul: 'Aksi', render: (r) => status(r.aksi, judul(r.aksi)) },
    { judul: 'Modul', render: (r) => judul(r.modul) },
    { judul: 'Keterangan', render: (r) => el('span.lembut', r.keterangan || '-') },
  ], d.aktivitas_terakhir, { kosongTeks: 'Belum ada aktivitas tercatat' }), [],
  { sub: 'Jejak audit terbaru dari seluruh modul' }));

  return wadah;
}
