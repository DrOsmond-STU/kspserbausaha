/**
 * Modul 1 - Dasbor Eksekutif.
 */
import { api, el, kpi, panel, panelTabel, tabel, rp, rpRingkas, angka, persen, tgl, waktu, status, judul, kosong }
  from '../inti.js';
import { grafikGaris, grafikBatang, grafikCincin, grafikPeringkat, SERI } from '../grafik.js';
import { periodeLabel } from '../inti.js';

export async function render() {
  const d = await api.get('/api/dashboard');
  const k = d.kpi;
  const p = d.perhatian;
  const wadah = el('div');

  // ------------------------------ Perhatian ------------------------------
  const butir = [];
  if (p.approval_menunggu) butir.push(['✅', `${p.approval_menunggu} permintaan menunggu persetujuan Anda`, '#/approval']);
  if (p.tagihan_tertunggak) butir.push(['⏰', `${p.tagihan_tertunggak} angsuran tertunggak senilai ${rp(p.nilai_tertunggak)}`, '#/pinjaman']);
  if (p.calon_anggota) butir.push(['👤', `${p.calon_anggota} calon anggota menunggu verifikasi`, '#/anggota']);
  if (p.stok_perlu_order) butir.push(['📦', `${p.stok_perlu_order} barang mencapai titik pemesanan ulang`, '#/persediaan']);
  if (p.izin_segera_kadaluarsa) butir.push(['⚖️', `${p.izin_segera_kadaluarsa} dokumen kepatuhan akan kedaluwarsa`, '#/compliance']);
  if (p.temuan_audit_terbuka) butir.push(['🔍', `${p.temuan_audit_terbuka} temuan audit belum ditindaklanjuti`, '#/audit']);
  if (p.risiko_tinggi) butir.push(['⚠️', `${p.risiko_tinggi} risiko berkategori tinggi/ekstrem`, '#/risiko']);
  if (p.tiket_terbuka) butir.push(['💬', `${p.tiket_terbuka} tiket layanan anggota belum selesai`, '#/crm']);

  if (butir.length) {
    wadah.append(panel('Perlu Perhatian', el('div', { gaya: {
      display: 'grid', gap: '8px', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' } },
    butir.map(([ikon, teks, tautan]) => el('a', {
      href: tautan,
      gaya: { display: 'flex', gap: '10px', alignItems: 'center', padding: '10px 12px',
        background: 'var(--bg-subtle)', border: '1px solid var(--border)',
        borderRadius: '8px', color: 'var(--teks)', textDecoration: 'none', fontSize: '13px' },
    }, [el('span', { gaya: { fontSize: '17px' } }, ikon), el('span', teks)])))));
  }

  // -------------------------------- KPI --------------------------------
  wadah.append(el('div.grid.k4.mb16', [
    kpi('Total Anggota', angka(k.total_anggota), {
      catatan: `+${k.anggota_baru_bulan_ini} anggota baru bulan ini`, ikon: '👥' }),
    kpi('Total Simpanan', rpRingkas(k.total_simpanan), { catatan: rp(k.total_simpanan), ikon: '🏦' }),
    kpi('Pinjaman Beredar', rpRingkas(k.total_pinjaman), { catatan: rp(k.total_pinjaman), ikon: '💳' }),
    kpi('SHU Berjalan', rpRingkas(k.shu_berjalan), {
      catatan: rp(k.shu_berjalan), ikon: '🧮',
      jenis: k.shu_berjalan >= 0 ? 'sukses' : 'bahaya' }),
  ]));

  wadah.append(el('div.grid.k4.mb16', [
    kpi('Kas & Bank', rpRingkas(k.kas_dan_bank), { catatan: rp(k.kas_dan_bank), ikon: '💰' }),
    kpi('Total Aset', rpRingkas(k.total_aset), { catatan: `Ekuitas ${rpRingkas(k.total_ekuitas)}`, ikon: '📊' }),
    kpi('Omzet Toko (bulan ini)', rpRingkas(k.omzet_toko_bulan_ini), {
      catatan: `Persediaan ${rpRingkas(k.nilai_persediaan)}`, ikon: '🛒' }),
    kpi('Rasio NPL', persen(k.npl_ratio), {
      catatan: `Kredit bermasalah ${rpRingkas(k.kredit_macet)}`, ikon: '⚠️',
      jenis: k.npl_ratio < 5 ? 'sukses' : k.npl_ratio < 10 ? 'peringatan' : 'bahaya' }),
  ]));

  // ------------------------------ Grafik tren ------------------------------
  const label = d.tren.map((t) => periodeLabel(t.periode).replace(/ \d{4}$/, ''));
  wadah.append(panel('Tren Pendapatan, Beban & SHU (12 bulan)', grafikGaris({
    label,
    seri: [
      { nama: 'Pendapatan', data: d.tren.map((t) => t.pendapatan) },
      { nama: 'Beban', data: d.tren.map((t) => t.beban) },
      { nama: 'SHU', data: d.tren.map((t) => t.shu) },
    ],
    tinggi: 260,
  })));

  wadah.append(el('div.grid.k2', [
    panel('Penjualan Toko per Bulan', grafikBatang({
      label, data: d.tren.map((t) => t.penjualan), tinggi: 220,
    })),
    panel('Pencairan Pinjaman per Bulan', grafikBatang({
      label, data: d.tren.map((t) => t.pencairan), tinggi: 220, warna: SERI()[1],
    })),
  ]));

  // ------------------------- Portofolio pinjaman -------------------------
  const pk = d.portofolio_pinjaman;
  const warnaKol = ['#1baf7a', '#eda100', '#eb6834', '#e34948', '#8b1a1a'];
  wadah.append(el('div.grid.k2', [
    panel('Kualitas Portofolio Pinjaman', el('div', [
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
    ])),
    panel('Ikhtisar Kinerja Tahun Berjalan', el('div', [
      grafikPeringkat({
        baris: [
          { label: 'Pendapatan', nilai: k.pendapatan_ytd, warna: SERI()[0] },
          { label: 'Beban', nilai: k.beban_ytd, warna: SERI()[1] },
          { label: 'Simpanan anggota', nilai: k.total_simpanan, warna: SERI()[2] },
          { label: 'Pinjaman beredar', nilai: k.total_pinjaman, warna: SERI()[3] },
        ],
        format: rp,
      }),
      el('dl.deskripsi', { gaya: { marginTop: '14px' } }, [
        el('dt', 'Total aset'), el('dd', rp(k.total_aset)),
        el('dt', 'Total ekuitas'), el('dd', rp(k.total_ekuitas)),
        el('dt', 'Nilai persediaan'), el('dd', rp(k.nilai_persediaan)),
        el('dt', 'Per tanggal'), el('dd', tgl(d.per_tanggal, true)),
      ]),
    ])),
  ]));

  // ----------------------------- Aktivitas -----------------------------
  wadah.append(panelTabel('Aktivitas Terakhir', tabel([
    { judul: 'Waktu', render: (r) => el('span.kecil.nowrap', waktu(r.waktu)) },
    { judul: 'Pengguna', kunci: 'username' },
    { judul: 'Aksi', render: (r) => status(r.aksi, judul(r.aksi)) },
    { judul: 'Modul', render: (r) => el('span.kecil', judul(r.modul)) },
    { judul: 'Keterangan', render: (r) => el('span.kecil.lembut', r.keterangan || '-') },
  ], d.aktivitas_terakhir, { kosongTeks: 'Belum ada aktivitas tercatat' })));

  return wadah;
}
