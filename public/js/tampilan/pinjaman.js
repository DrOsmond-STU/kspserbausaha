/**
 * Modul 5 - Pinjaman.
 */
import {
  api, el, kpi, panel, panelTabel, tabel, rp, rpRingkas, angka, persen, tgl, status, judul,
  modal, kolom, input, pilih, bacaForm, toast, galat, memuat, kosongkan, hariIni, bilah, kosong,
} from '../inti.js';
import { grafikCincin } from '../grafik.js';
import { izin, navigasi } from '../app.js';
import { ikon } from '../ikon.js';
import {
  daftarBank, kolomBank, suksesCetak, denganTombol, kapital, teksMetode,
} from './simpanan.js';
import { cetakDokumen, tombolCetak } from '../cetak.js';

/** Status pengajuan yang belum dicairkan sehingga masih dapat dibatalkan. */
const STATUS_BISA_BATAL = ['diajukan', 'survey', 'dianalisis', 'disetujui'];

const WARNA_KOL = ['#1baf7a', '#eda100', '#eb6834', '#e34948', '#8b1a1a'];
const kelasKol = (k) => (k === 1 ? 'st-sukses' : k === 2 ? 'st-peringatan' : 'st-bahaya');

export async function render(param) {
  if (param[0]) return detail(Number(param[0]));

  const pf = await api.get('/api/pinjaman/portofolio');
  const wadah = el('div');

  wadah.append(el('div.grid.k4.mb16', [
    kpi('Pinjaman Beredar', rpRingkas(pf.total_outstanding), { catatan: rp(pf.total_outstanding), ikon: ikon('kartu') }),
    kpi('Kredit Bermasalah', rpRingkas(pf.npl_nominal), { ikon: ikon('waspada'),
      jenis: pf.npl_ratio < 5 ? 'sukses' : 'bahaya' }),
    kpi('Rasio NPL', persen(pf.npl_ratio), { catatan: `Status: ${judul(pf.status_kesehatan)}`,
      jenis: pf.npl_ratio < 5 ? 'sukses' : pf.npl_ratio < 10 ? 'peringatan' : 'bahaya' }),
    kpi('Debitur Aktif', angka(pf.per_kolektibilitas.reduce((s, x) => s + x.jumlah, 0)), { ikon: ikon('anggota') }),
  ]));

  wadah.append(el('div.grid.k2', [
    panel('Kualitas Kredit (Kolektibilitas)', grafikCincin({
      bagian: pf.per_kolektibilitas.map((x, i) => ({
        label: `${x.kolektibilitas}. ${x.label}`, nilai: x.nominal, warna: WARNA_KOL[i] })),
      tengahLabel: 'Outstanding', tengahNilai: rpRingkas(pf.total_outstanding),
    })),
    panelTabel('Rincian Kolektibilitas', tabel([
      { judul: 'Kolektibilitas', render: (x) => el(`span.lencana-status.${kelasKol(x.kolektibilitas)}`,
        `${x.kolektibilitas}. ${x.label}`) },
      { judul: 'Debitur', angka: true, render: (x) => angka(x.jumlah) },
      { judul: 'Nominal', angka: true, render: (x) => rp(x.nominal) },
      { judul: 'Porsi', angka: true, render: (x) => persen(x.persen) },
    ], pf.per_kolektibilitas)),
  ]));

  // ------------------------------ Tagihan ------------------------------
  const tagihan = await api.get('/api/pinjaman/tagihan', { hari_kedepan: 7 });
  if (tagihan.data.length) {
    wadah.append(panelTabel(`Tagihan & Tunggakan (${tagihan.data.length})`, tabel([
      { judul: 'Jatuh Tempo', render: (t) => el('span.nowrap', tgl(t.jatuh_tempo)) },
      { judul: 'Pinjaman', render: (t) => el('a.mono.kecil', { href: `#/pinjaman/${t.pinjaman_id}` }, t.nomor_pinjaman) },
      { judul: 'Anggota', render: (t) => el('div', [
        el('div', t.anggota_nama), el('div.kecil.samar', t.telepon || '-')]) },
      { judul: 'Ke-', angka: true, kunci: 'angsuran_ke' },
      { judul: 'Sisa Tagihan', angka: true, render: (t) => rp(t.sisa_tagihan) },
      { judul: 'Telat', angka: true, render: (t) => (t.hari_telat > 0
        ? el('span.neg', `${t.hari_telat} hari`) : el('span.samar', '-')) },
      { judul: 'Status', render: (t) => status(t.kategori === 'tertunggak' ? 'ditolak' : 'peringatan',
        t.kategori === 'tertunggak' ? 'Tertunggak' : 'Akan jatuh tempo') },
    ], tagihan.data), [
      tombolCetak(() => ({
        judul: 'Daftar Tagihan & Tunggakan Angsuran', jenis_ttd: 'laporan', orientasi: 'landscape',
        subjudul: `Per ${tgl(hariIni(), true)} (jatuh tempo s.d. 7 hari ke depan)`,
        bagian: [{
          kolom: [{ kunci: 'no', label: 'No', tipe: 'angka' }, { kunci: 'jatuh_tempo', label: 'Jatuh Tempo', tipe: 'tanggal' },
            { kunci: 'nomor_pinjaman', label: 'No. Pinjaman' }, { kunci: 'anggota_nama', label: 'Anggota' },
            { kunci: 'telepon', label: 'Telepon' }, { kunci: 'angsuran_ke', label: 'Ke-', tipe: 'angka' },
            { kunci: 'sisa_tagihan', label: 'Sisa Tagihan', tipe: 'uang' }, { kunci: 'hari_telat', label: 'Telat (hari)', tipe: 'angka' },
            { kunci: 'kategori', label: 'Status' }],
          baris: tagihan.data.map((t, i) => ({ ...t, no: i + 1, kategori: judul(t.kategori) })),
          total: { sisa_tagihan: tagihan.data.reduce((x, t) => x + t.sisa_tagihan, 0) },
        }],
      }), { label: 'Cetak' }),
      izin('pinjaman.update') && el('button.btn.kecil', { onclick: async () => {
        try {
          const h = await api.post('/api/pinjaman/refresh-kolektibilitas', {});
          toast(`Kolektibilitas ${h.diproses} pinjaman diperbarui`, 'sukses');
          navigasi(location.hash, true);
        } catch (err) { galat(err); }
      } }, '↻ Perbarui Kolektibilitas'),
    ].filter(Boolean)));
  }

  // ------------------------------ Daftar ------------------------------
  const daftar = el('div');
  wadah.append(daftar);
  let q = '';
  let filter = '';

  async function muat() {
    kosongkan(daftar).append(memuat());
    try {
      const d = await api.get('/api/pinjaman', { q, status: filter, limit: 100 });
      kosongkan(daftar).append(panelTabel(`Daftar Pinjaman (${angka(d.total)})`, tabel([
        { judul: 'Nomor', render: (p) => el('span.mono.kecil', p.nomor) },
        { judul: 'Anggota', render: (p) => el('div', [
          el('div.tebal', p.anggota_nama), el('div.kecil.samar', p.nomor_anggota)]) },
        { judul: 'Produk', render: (p) => el('div', [
          el('div.kecil', p.produk_nama),
          el('div.kecil.samar', `${p.tenor} bln · ${p.bunga_tahunan}% ${judul(p.metode_bunga)}`)]) },
        { judul: 'Pokok', angka: true, render: (p) => rp(p.pokok) },
        { judul: 'Sisa Pokok', angka: true, render: (p) => el('strong', rp(p.outstanding_pokok)) },
        { judul: 'Kolek.', render: (p) => (p.status === 'dicairkan' || p.status === 'restrukturisasi'
          ? el(`span.lencana-status.${kelasKol(p.kolektibilitas)}`, `${p.kolektibilitas}`) : el('span.samar', '-')) },
        { judul: 'Status', render: (p) => status(p.status) },
      ], d.data, { saatKlik: (p) => { location.hash = `#/pinjaman/${p.id}`; } }), [
        el('input', { type: 'search', placeholder: 'Cari nomor atau nama anggota…',
          oninput: (e) => { q = e.target.value; clearTimeout(muat.t); muat.t = setTimeout(muat, 320); } }),
        pilih('f', ['', 'diajukan', 'dianalisis', 'disetujui', 'dicairkan', 'lunas', 'ditolak',
          'batal', 'restrukturisasi'].map((s) => ({ nilai: s, teks: s ? judul(s) : 'Semua status' })), filter,
        { onchange: (e) => { filter = e.target.value; muat(); } }),
        el('button.btn', { onclick: simulasi }, 'Simulasi Angsuran'),
        izin('pinjaman.create') && el('button.btn.utama', { onclick: () => formAjukan(muat) }, '+ Ajukan Pinjaman'),
        tombolCetak(() => ({
          judul: 'Daftar Pinjaman Anggota', jenis_ttd: 'laporan', orientasi: 'landscape',
          keterangan: [filter && `Status: ${judul(filter)}`, q && `Pencarian: "${q}"`].filter(Boolean),
          bagian: [{
            kolom: [{ kunci: 'no', label: 'No', tipe: 'angka' }, { kunci: 'nomor', label: 'Nomor' },
              { kunci: 'nomor_anggota', label: 'No. Anggota' }, { kunci: 'anggota_nama', label: 'Anggota' },
              { kunci: 'produk_nama', label: 'Produk' }, { kunci: 'tenor', label: 'Tenor (bln)', tipe: 'angka' },
              { kunci: 'bunga_tahunan', label: 'Jasa % p.a.', tipe: 'persen' }, { kunci: 'pokok', label: 'Pokok', tipe: 'uang' },
              { kunci: 'outstanding_pokok', label: 'Sisa Pokok', tipe: 'uang' }, { kunci: 'kolektibilitas', label: 'Kolek.', tipe: 'angka' },
              { kunci: 'status', label: 'Status' }],
            baris: d.data.map((p, i) => ({ ...p, no: i + 1, status: judul(p.status) })),
            total: { pokok: d.data.reduce((t, p) => t + p.pokok, 0),
              outstanding_pokok: d.data.reduce((t, p) => t + p.outstanding_pokok, 0) },
          }],
        }), { label: 'Cetak' }),
      ].filter(Boolean)));
    } catch (err) { galat(err); }
  }
  await muat();
  return wadah;
}

// ------------------------------- Detail -------------------------------

async function detail(id) {
  const p = await api.get(`/api/pinjaman/${id}`);
  const wadah = el('div');
  const segarkan = () => navigasi(location.hash, true);

  const aksi = [el('button.btn', { onclick: () => { location.hash = '#/pinjaman'; } }, '← Kembali')];
  if (izin('pinjaman.update') && ['diajukan', 'survey', 'dianalisis'].includes(p.status)) {
    aksi.push(el('button.btn', { onclick: () => formSurvey(p, segarkan) }, 'Survey / Analisis'));
  }
  if (izin('pinjaman.approve') && ['diajukan', 'survey', 'dianalisis'].includes(p.status)) {
    aksi.push(el('button.btn.sukses', { onclick: () => formPutusan(p, true, segarkan) }, '✓ Setujui'));
    aksi.push(el('button.btn.bahaya', { onclick: () => formPutusan(p, false, segarkan) }, '✕ Tolak'));
  }
  if (izin('pinjaman.post') && p.status === 'disetujui') {
    aksi.push(el('button.btn.utama', { onclick: () => formCairkan(p, segarkan) }, 'Cairkan'));
  }
  if (izin('pinjaman.create') && ['dicairkan', 'restrukturisasi'].includes(p.status)) {
    aksi.push(el('button.btn.utama', { onclick: () => formAngsuran(p, segarkan) }, 'Bayar Angsuran'));
    aksi.push(el('button.btn', { onclick: () => formPelunasan(p, segarkan) }, 'Pelunasan Dipercepat'));
  }
  if (izin('pinjaman.approve') && p.status === 'dicairkan') {
    aksi.push(el('button.btn', { onclick: () => formRestruktur(p, segarkan) }, 'Restrukturisasi'));
  }
  if (izin('pinjaman.update') && STATUS_BISA_BATAL.includes(p.status)) {
    aksi.push(el('button.btn.bahaya', { onclick: () => formBatal(p, segarkan) }, 'Batalkan Pengajuan'));
  }
  // Cetakan dokumen pinjaman
  aksi.push(el('button.btn', { onclick: (e) => denganTombol(e, async () => cetakDokumen(await dokPengajuan(p))) },
    'Cetak Formulir Pengajuan'));
  if (p.tanggal_cair && !p.restruktur_dari) {
    aksi.push(el('button.btn', { onclick: (e) => denganTombol(e, () => cetakDokumen(dokPencairan(p))) },
      'Cetak Bukti Pencairan'));
  }
  if (p.restruktur_dari) {
    aksi.push(el('button.btn', { onclick: (e) => denganTombol(e, () => cetakDokumen(dokRestrukturisasi(p))) },
      'Cetak Restrukturisasi'));
  }
  wadah.append(el('div.gap8.mb16', aksi));

  wadah.append(el('div.grid.k4.mb16', [
    kpi('Pokok Pinjaman', rp(p.pokok), { catatan: `${p.tenor} bulan · ${p.bunga_tahunan}% ${judul(p.metode_bunga)}` }),
    kpi('Sisa Pokok', rp(p.outstanding_pokok), { jenis: 'peringatan' }),
    kpi('Angsuran / Bulan', rp(p.angsuran_total), {
      catatan: `Pokok ${rp(p.angsuran_pokok)} + jasa ${rp(p.angsuran_bunga)}` }),
    kpi('Denda Berjalan', rp(p.denda.total), {
      catatan: p.tunggakan_hari ? `Tunggakan ${p.tunggakan_hari} hari` : 'Tidak ada tunggakan',
      jenis: p.denda.total ? 'bahaya' : 'sukses' }),
  ]));

  wadah.append(el('div.grid.k2', [
    panel('Informasi Pinjaman', el('dl.deskripsi', [
      el('dt', 'Nomor'), el('dd', el('span.mono', p.nomor)),
      el('dt', 'Anggota'), el('dd', el('a', { href: `#/anggota/${p.anggota_id}` },
        `${p.anggota_nama} (${p.nomor_anggota})`)),
      el('dt', 'Produk'), el('dd', p.produk_nama),
      el('dt', 'Tujuan'), el('dd', p.tujuan || '-'),
      el('dt', 'Diajukan'), el('dd', tgl(p.tanggal_pengajuan, true)),
      p.tanggal_persetujuan && el('dt', 'Disetujui'),
      p.tanggal_persetujuan && el('dd', `${tgl(p.tanggal_persetujuan, true)} oleh ${p.disetujui_oleh || '-'}`),
      p.tanggal_cair && el('dt', 'Dicairkan'), p.tanggal_cair && el('dd', tgl(p.tanggal_cair, true)),
      p.tanggal_lunas && el('dt', 'Lunas'), p.tanggal_lunas && el('dd', tgl(p.tanggal_lunas, true)),
      el('dt', 'Biaya admin'), el('dd', rp(p.biaya_admin)),
      el('dt', 'Total jasa'), el('dd', rp(p.total_bunga)),
      el('dt', 'Status'), el('dd', status(p.status)),
      el('dt', 'Kolektibilitas'), el('dd', el(`span.lencana-status.${kelasKol(p.kolektibilitas)}`,
        `${p.kolektibilitas}. ${p.label_kolektibilitas}`)),
      p.alasan_tolak && el('dt', p.status === 'batal' ? 'Alasan dibatalkan' : 'Alasan ditolak'),
      p.alasan_tolak && el('dd', p.alasan_tolak),
    ].filter(Boolean))),
    panel('Analisis Kredit', el('div', [
      p.skor_kredit !== null ? el('div', [
        el('div.antara.mb8', [
          el('span.lembut', 'Skor kredit'),
          el('strong', { gaya: { fontSize: '19px' } }, `${p.skor_kredit} / 100`),
        ]),
        bilah(p.skor_kredit, 100, p.skor_kredit >= 75 ? 'sukses' : p.skor_kredit >= 60 ? '' : p.skor_kredit >= 45 ? 'peringatan' : 'bahaya'),
        el('div.kecil.lembut.mt8', p.rekomendasi_skor || ''),
      ]) : el('div.samar', 'Belum ada penilaian skor'),
      el('hr', { gaya: { border: 0, borderTop: '1px solid var(--border)', margin: '14px 0' } }),
      el('dl.deskripsi', [
        el('dt', 'Hasil survey'), el('dd', p.hasil_survey || '-'),
        el('dt', 'Catatan analis'), el('dd', p.catatan_analis || '-'),
        el('dt', 'Penghasilan'), el('dd', rp(p.penghasilan)),
      ]),
      p.approval?.ada ? el('div.mt16', [
        el('div.tebal.mb8', 'Persetujuan berjenjang'),
        el('div', p.approval.tahapan.map((t) => el('div.antara', {
          gaya: { padding: '5px 0', borderBottom: '1px solid var(--border)', fontSize: '12.5px' },
        }, [
          el('span', `Tahap ${t.urut} — ${judul(t.role)}`),
          status(t.status),
        ]))),
      ]) : null,
    ])),
  ]));

  if (p.agunan?.length) {
    wadah.append(panelTabel('Agunan', tabel([
      { judul: 'Jenis', render: (g) => judul(g.jenis) },
      { judul: 'Deskripsi', kunci: 'deskripsi' },
      { judul: 'No. Dokumen', render: (g) => el('span.mono.kecil', g.nomor_dokumen || '-') },
      { judul: 'Nilai Taksiran', angka: true, render: (g) => rp(g.nilai_taksiran) },
      { judul: 'Status', render: (g) => status(g.status) },
    ], p.agunan)));
  }

  wadah.append(panelTabel('Jadwal Angsuran', tabel([
    { judul: 'Ke-', angka: true, kunci: 'angsuran_ke' },
    { judul: 'Jatuh Tempo', render: (j) => tgl(j.jatuh_tempo) },
    { judul: 'Pokok', angka: true, render: (j) => rp(j.pokok) },
    { judul: 'Jasa', angka: true, render: (j) => rp(j.bunga) },
    { judul: 'Total', angka: true, render: (j) => el('strong', rp(j.total)) },
    { judul: 'Dibayar', angka: true, render: (j) => rp(j.bayar_pokok + j.bayar_bunga) },
    { judul: 'Sisa Pokok', angka: true, render: (j) => rp(j.sisa_pokok) },
    { judul: 'Status', render: (j) => status(j.status === 'lunas' ? 'lunas'
      : j.status === 'sebagian' ? 'peringatan' : 'netral', judul(j.status)) },
  ], p.jadwal, { kosongTeks: 'Jadwal terbentuk setelah pencairan' }), [
    p.jadwal.length ? tombolCetak(() => dokJadwal(p), { label: 'Cetak Jadwal' }) : null,
  ].filter(Boolean)));

  wadah.append(panelTabel('Riwayat Pembayaran', tabel([
    { judul: 'Tanggal', render: (a) => tgl(a.tanggal) },
    { judul: 'Nomor', render: (a) => el('span.mono.kecil', a.nomor) },
    { judul: 'Jenis', render: (a) => judul(a.jenis) },
    { judul: 'Pokok', angka: true, render: (a) => rp(a.bayar_pokok) },
    { judul: 'Jasa', angka: true, render: (a) => rp(a.bayar_bunga) },
    { judul: 'Denda', angka: true, render: (a) => (a.bayar_denda ? el('span.neg', rp(a.bayar_denda)) : '-') },
    { judul: 'Total', angka: true, render: (a) => el('strong', rp(a.total_bayar)) },
    { judul: 'Petugas', render: (a) => el('span.kecil.samar', a.petugas || '-') },
    { judul: '', render: (a) => el('button.btn.kecil', { title: 'Cetak bukti pembayaran',
      onclick: (e) => denganTombol(e, async () => cetakDokumen(dokBuktiAngsuran(
        await api.get(`/api/pinjaman/angsuran/${a.id}`)))) }, 'Bukti') },
  ], p.angsuran, { kosongTeks: 'Belum ada pembayaran' })));

  return wadah;
}

// ------------------------------ Formulir ------------------------------

async function simulasi() {
  const produk = await api.get('/api/master/produk-pinjaman');
  const hasil = el('div.mt16');
  const form = el('div', [
    el('div.baris-form.k3', [
      kolom('Produk', pilih('produk_id', produk.data.map((p) => ({
        nilai: p.id, teks: `${p.nama} (${p.bunga_tahunan}% ${judul(p.metode_bunga)})` })))),
      kolom('Pokok', input('pokok', { tipe: 'number', min: 0, nilai: 10000000 })),
      kolom('Tenor (bulan)', input('tenor', { tipe: 'number', min: 1, max: 120, nilai: 12 })),
    ]),
    el('button.btn.utama', { onclick: async () => {
      try {
        const d = bacaForm(form);
        const h = await api.post('/api/pinjaman/simulasi', d);
        const pr = produk.data.find((x) => String(x.id) === String(d.produk_id));
        kosongkan(hasil).append(
          el('div.mb8', [tombolCetak(() => ({
            judul: 'Simulasi Angsuran Pinjaman', jenis_ttd: 'default',
            keterangan: ['Simulasi bersifat perkiraan dan bukan persetujuan pinjaman.'],
            ringkasan: [
              { label: 'Produk', nilai: pr ? `${pr.nama} (${pr.bunga_tahunan}% ${judul(pr.metode_bunga)})` : '-' },
              { label: 'Pokok', nilai: d.pokok, tipe: 'uang' },
              { label: 'Tenor', nilai: `${d.tenor} bulan` },
              { label: 'Angsuran pertama', nilai: h.angsuran_pertama, tipe: 'uang' },
              { label: 'Total jasa', nilai: h.total_bunga, tipe: 'uang' },
              { label: 'Total kewajiban', nilai: h.total_angsuran, tipe: 'uang' },
            ],
            bagian: [bagianJadwal(h.jadwal, false)],
          }), { label: 'Cetak Simulasi' })]),
          el('div.grid.k3.mb16', [
            kpi('Angsuran / bulan', rp(h.angsuran_pertama)),
            kpi('Total jasa', rp(h.total_bunga)),
            kpi('Total kewajiban', rp(h.total_angsuran)),
          ]),
          el('div.tabel-bungkus', [tabel([
            { judul: 'Ke-', angka: true, kunci: 'angsuran_ke' },
            { judul: 'Jatuh Tempo', render: (j) => tgl(j.jatuh_tempo) },
            { judul: 'Pokok', angka: true, render: (j) => rp(j.pokok) },
            { judul: 'Jasa', angka: true, render: (j) => rp(j.bunga) },
            { judul: 'Total', angka: true, render: (j) => rp(j.total) },
            { judul: 'Sisa Pokok', angka: true, render: (j) => rp(j.sisa_pokok) },
          ], h.jadwal)]),
        );
      } catch (err) { galat(err); }
    } }, 'Hitung Simulasi'),
    hasil,
  ]);
  modal({ judul: 'Simulasi Angsuran Pinjaman', lebar: 'lebar', isi: form });
}

async function formAjukan(saatSelesai) {
  const [anggota, produk] = await Promise.all([
    api.get('/api/anggota', { status: 'aktif', limit: 500 }),
    api.get('/api/master/produk-pinjaman'),
  ]);
  const kotakSkor = el('div');
  const form = el('div', [
    kolom('Anggota', pilih('anggota_id', anggota.data.map((a) => ({
      nilai: a.id, teks: `${a.nomor_anggota} — ${a.nama}` }))), { wajib: true }),
    kolom('Produk Pinjaman', pilih('produk_id', produk.data.map((p) => ({
      nilai: p.id,
      teks: `${p.nama} · ${p.bunga_tahunan}% ${judul(p.metode_bunga)} · ${p.tenor_min}-${p.tenor_max} bln` }))),
    { wajib: true }),
    el('div.baris-form.k3', [
      kolom('Pokok Pinjaman', input('pokok', { tipe: 'number', min: 1 }), { wajib: true }),
      kolom('Tenor (bulan)', input('tenor', { tipe: 'number', min: 1, max: 120 }), { wajib: true }),
      kolom('Tanggal Pengajuan', input('tanggal_pengajuan', { tipe: 'date', nilai: hariIni() })),
    ]),
    kolom('Tujuan Penggunaan', input('tujuan')),
    el('button.btn.kecil', { onclick: async () => {
      const d = bacaForm(form);
      if (!d.anggota_id || !d.pokok || !d.tenor) { toast('Lengkapi anggota, pokok, dan tenor', 'peringatan'); return; }
      try {
        const sim = await api.post('/api/pinjaman/simulasi', d);
        const skor = await api.post('/api/pinjaman/skoring', {
          anggota_id: d.anggota_id, pokok: d.pokok, tenor: d.tenor,
          angsuran_bulanan: sim.angsuran_pertama });
        kosongkan(kotakSkor).append(el('div.notis', {
          class: skor.skor >= 60 ? 'sukses' : skor.skor >= 45 ? 'peringatan' : 'bahaya',
        }, [el('div.isi', [
          el('strong', `Skor kredit ${skor.skor}/100 — ${skor.rekomendasi}`),
          el('div.kecil', `Angsuran ${rp(sim.angsuran_pertama)}/bulan · DSR ${persen(skor.dsr)}`),
          el('div.kecil.mt8', skor.rincian.map((r) => el('div',
            `• ${r.aspek}: ${r.nilai}/${r.maks} — ${r.catatan}`))),
        ])]));
      } catch (err) { galat(err); }
    } }, 'Cek Kelayakan & Skor Kredit'),
    kotakSkor,
  ]);

  const tutup = modal({
    judul: 'Pengajuan Pinjaman', lebar: 'lebar', isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async (e) => {
        const tombol = e.currentTarget;
        tombol.disabled = true;
        try {
          const h = await api.post('/api/pinjaman', bacaForm(form));
          toast('Pengajuan pinjaman tercatat', 'sukses',
            `${h.nomor} · skor ${h.skoring.skor}/100${h.approval ? ' · menunggu persetujuan' : ''}`);
          tutup(); saatSelesai?.();
          suksesCetak({
            judul: 'Pengajuan Tercatat', pesan: `Pengajuan ${h.nomor} tercatat`,
            detail: `Skor kredit ${h.skoring.skor}/100 — ${h.skoring.rekomendasi}`, tombol: 'Cetak Formulir Pengajuan',
            cetak: async () => cetakDokumen(await dokPengajuan(await api.get(`/api/pinjaman/${h.id}`))),
          });
        } catch (err) { galat(err); tombol.disabled = false; }
      } }, 'Ajukan'),
    ],
  });
}

function formSurvey(p, saatSelesai) {
  const form = el('div', [
    kolom('Hasil Survey Lapangan', el('textarea', { name: 'hasil_survey' }, p.hasil_survey || '')),
    kolom('Catatan Analis', el('textarea', { name: 'catatan_analis' }, p.catatan_analis || '')),
  ]);
  const tutup = modal({
    judul: `Survey & Analisis — ${p.nomor}`, isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async () => {
        try {
          await api.post(`/api/pinjaman/${p.id}/survey`, bacaForm(form));
          toast('Hasil survey tersimpan', 'sukses'); tutup(); saatSelesai?.();
        } catch (err) { galat(err); }
      } }, 'Simpan'),
    ],
  });
}

function formPutusan(p, setuju, saatSelesai) {
  const form = el('div', setuju ? [
    el('div.notis.info', [el('div.isi', [
      el('strong', 'Plafon dapat disesuaikan'),
      el('div.kecil', 'Jika pokok atau tenor diubah, jadwal angsuran akan dihitung ulang otomatis.'),
    ])]),
    el('div.baris-form', [
      kolom('Pokok Disetujui', input('pokok_disetujui', { tipe: 'number', nilai: p.pokok })),
      kolom('Tenor Disetujui', input('tenor_disetujui', { tipe: 'number', nilai: p.tenor })),
    ]),
  ] : [
    kolom('Alasan Penolakan', el('textarea', { name: 'alasan' }), { wajib: true }),
  ]);
  const tutup = modal({
    judul: setuju ? `Setujui Pinjaman — ${p.nomor}` : `Tolak Pinjaman — ${p.nomor}`, isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el(`button.btn.${setuju ? 'sukses' : 'bahaya'}`, { onclick: async () => {
        try {
          await api.post(`/api/pinjaman/${p.id}/putuskan`, { ...bacaForm(form), setuju });
          toast(setuju ? 'Pinjaman disetujui' : 'Pinjaman ditolak', 'sukses');
          tutup(); saatSelesai?.();
        } catch (err) { galat(err); }
      } }, setuju ? 'Setujui' : 'Tolak'),
    ],
  });
}

async function formCairkan(p, saatSelesai) {
  const bank = await daftarBank();
  const metode = pilih('metode', [{ nilai: 'tunai', teks: 'Tunai' }, { nilai: 'transfer', teks: 'Transfer Bank' }]);
  const form = el('div', [
    el('div.notis.info', [el('div.isi', [
      el('strong', `Pencairan ${rp(p.pokok)}`),
      el('div.kecil', `Biaya administrasi & provisi ${rp(p.biaya_admin + p.biaya_provisi)} `
        + `dipotong dari pencairan. Diterima bersih ${rp(p.pokok - p.biaya_admin - p.biaya_provisi)}.`),
    ])]),
    el('div.baris-form', [
      kolom('Tanggal Pencairan', input('tanggal', { tipe: 'date', nilai: hariIni() })),
      kolom('Metode', metode),
    ]),
    kolomBank(metode, bank),
    el('div.kecil.lembut', 'Jadwal angsuran dihitung ulang berdasarkan tanggal pencairan.'),
  ]);
  const tutup = modal({
    judul: `Pencairan Pinjaman — ${p.nomor}`, isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async (e) => {
        const tombol = e.currentTarget;
        tombol.disabled = true;
        try {
          const h = await api.post(`/api/pinjaman/${p.id}/cairkan`, bacaForm(form));
          toast('Pinjaman berhasil dicairkan', 'sukses',
            `Diterima ${rp(h.dicairkan)} · jurnal ${h.jurnal.nomor}`);
          tutup(); saatSelesai?.();
          suksesCetak({
            judul: 'Pencairan Berhasil', pesan: `Pinjaman ${p.nomor} dicairkan`,
            detail: `Diterima bersih ${rp(h.dicairkan)} · jurnal ${h.jurnal.nomor}`, tombol: 'Cetak Bukti Pencairan',
            cetak: async () => cetakDokumen(dokPencairan(await api.get(`/api/pinjaman/${p.id}`))),
          });
        } catch (err) { galat(err); tombol.disabled = false; }
      } }, 'Cairkan'),
    ],
  });
}

async function formAngsuran(p, saatSelesai) {
  const bank = await daftarBank();
  const metode = pilih('metode', [{ nilai: 'tunai', teks: 'Tunai' },
    { nilai: 'transfer', teks: 'Transfer Bank' }, { nilai: 'potong_gaji', teks: 'Potong Gaji' }]);
  const berikut = p.jadwal.find((j) => j.status !== 'lunas');
  const usulan = berikut ? (berikut.total - berikut.bayar_pokok - berikut.bayar_bunga) + p.denda.total : 0;
  const form = el('div', [
    el('div.notis.info', [el('div.isi', [
      el('strong', `Sisa pokok ${rp(p.outstanding_pokok)}`),
      berikut && el('div.kecil', `Angsuran ke-${berikut.angsuran_ke} jatuh tempo ${tgl(berikut.jatuh_tempo)} `
        + `sebesar ${rp(berikut.total - berikut.bayar_pokok - berikut.bayar_bunga)}`),
      p.denda.total > 0 && el('div.kecil', `Denda berjalan ${rp(p.denda.total)}`),
      el('div.kecil', 'Alokasi pembayaran: denda → jasa → pokok.'),
    ].filter(Boolean))]),
    el('div.baris-form', [
      kolom('Tanggal', input('tanggal', { tipe: 'date', nilai: hariIni() })),
      kolom('Nominal', input('nominal', { tipe: 'number', min: 1, nilai: usulan }), { wajib: true }),
    ]),
    el('div.baris-form', [kolom('Metode', metode), kolomBank(metode, bank)]),
    kolom('Keterangan', input('keterangan')),
  ]);
  const tutup = modal({
    judul: `Pembayaran Angsuran — ${p.nomor}`, isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async (e) => {
        const tombol = e.currentTarget;
        tombol.disabled = true;
        try {
          const h = await api.post('/api/pinjaman/angsuran', { ...bacaForm(form), pinjaman_id: p.id });
          toast(h.lunas ? 'Angsuran tercatat — pinjaman LUNAS' : 'Angsuran berhasil dicatat', 'sukses',
            `Pokok ${rp(h.bayar_pokok)} · jasa ${rp(h.bayar_bunga)} · denda ${rp(h.bayar_denda)}`);
          tutup(); saatSelesai?.();
          suksesCetak({
            judul: h.lunas ? 'Pinjaman Lunas' : 'Angsuran Tercatat', pesan: `Pembayaran ${h.nomor} sebesar ${rp(h.total_bayar)}`,
            detail: `Sisa pokok ${rp(h.outstanding_pokok)}`, tombol: 'Cetak Bukti Angsuran',
            cetak: async () => cetakDokumen(dokBuktiAngsuran(await api.get(`/api/pinjaman/angsuran/${h.id}`))),
          });
        } catch (err) { galat(err); tombol.disabled = false; }
      } }, 'Bayar'),
    ],
  });
}

async function formPelunasan(p, saatSelesai) {
  const [sim, bank] = await Promise.all([
    api.get(`/api/pinjaman/${p.id}/simulasi-pelunasan`), daftarBank()]);
  const metode = pilih('metode', [{ nilai: 'tunai', teks: 'Tunai' }, { nilai: 'transfer', teks: 'Transfer Bank' }]);
  const form = el('div', [
    el('dl.deskripsi', [
      el('dt', 'Sisa pokok'), el('dd', rp(sim.sisa_pokok)),
      el('dt', 'Jasa berjalan'), el('dd', rp(sim.bunga_berjalan)),
      el('dt', 'Denda'), el('dd', rp(sim.denda)),
      el('dt', 'Penalti pelunasan'), el('dd', rp(sim.penalti_pelunasan)),
      el('dt', el('strong', 'Total pelunasan')), el('dd', el('strong', rp(sim.total))),
      el('dt', 'Penghematan jasa'), el('dd', el('span.pos', rp(sim.penghematan_bunga))),
    ]),
    el('div.baris-form.mt16', [
      kolom('Tanggal', input('tanggal', { tipe: 'date', nilai: hariIni() })),
      kolom('Metode', metode),
    ]),
    kolomBank(metode, bank),
  ]);
  const tutup = modal({
    judul: `Pelunasan Dipercepat — ${p.nomor}`, isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async (e) => {
        const tombol = e.currentTarget;
        tombol.disabled = true;
        try {
          const h = await api.post(`/api/pinjaman/${p.id}/pelunasan`, bacaForm(form));
          toast('Pinjaman berhasil dilunasi', 'sukses');
          tutup(); saatSelesai?.();
          suksesCetak({
            judul: 'Pelunasan Berhasil', pesan: `Pinjaman ${p.nomor} LUNAS`,
            detail: `${h.nomor} · total ${rp(h.total)}`, tombol: 'Cetak Bukti Pelunasan',
            cetak: async () => {
              const d = await api.get(`/api/pinjaman/${p.id}`);
              const a = d.angsuran.find((x) => x.nomor === h.nomor);
              if (!a) throw new Error('Data pelunasan tidak ditemukan');
              cetakDokumen(dokBuktiAngsuran(await api.get(`/api/pinjaman/angsuran/${a.id}`)));
            },
          });
        } catch (err) { galat(err); tombol.disabled = false; }
      } }, `Lunasi ${rp(sim.total)}`),
    ],
  });
}

function formRestruktur(p, saatSelesai) {
  const form = el('div', [
    el('div.notis.peringatan', [el('div.isi', [
      el('strong', 'Restrukturisasi membentuk pinjaman baru'),
      el('div.kecil', `Sisa pokok ${rp(p.outstanding_pokok)} ditambah denda ${rp(p.denda.total)} `
        + 'dialihkan menjadi pinjaman baru. Pinjaman lama ditutup tanpa arus kas.'),
    ])]),
    el('div.baris-form.k3', [
      kolom('Tenor Baru (bulan)', input('tenor_baru', { tipe: 'number', min: 1, max: 120, nilai: 24 }), { wajib: true }),
      kolom('Bunga Baru (% p.a.)', input('bunga_baru', { tipe: 'number', step: '0.1', nilai: p.bunga_tahunan })),
      kolom('Tanggal', input('tanggal', { tipe: 'date', nilai: hariIni() })),
    ]),
    kolom('Alasan Restrukturisasi', el('textarea', { name: 'alasan' }), { wajib: true }),
  ]);
  const tutup = modal({
    judul: `Restrukturisasi — ${p.nomor}`, isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async (e) => {
        const tombol = e.currentTarget;
        tombol.disabled = true;
        try {
          const h = await api.post(`/api/pinjaman/${p.id}/restrukturisasi`, bacaForm(form));
          toast('Restrukturisasi berhasil', 'sukses', `Pinjaman baru ${h.nomor} sebesar ${rp(h.pokok)}`);
          tutup(); location.hash = `#/pinjaman/${h.id}`;
          suksesCetak({
            judul: 'Restrukturisasi Berhasil', pesan: `Pinjaman baru ${h.nomor} sebesar ${rp(h.pokok)}`,
            detail: `${h.tenor} bulan · menggantikan ${p.nomor}`, tombol: 'Cetak Berita Acara Restrukturisasi',
            cetak: async () => cetakDokumen(dokRestrukturisasi(await api.get(`/api/pinjaman/${h.id}`))),
          });
        } catch (err) { galat(err); tombol.disabled = false; }
      } }, 'Proses Restrukturisasi'),
    ],
  });
}

/** Membatalkan pengajuan yang belum dicairkan (belum ada jurnal). */
function formBatal(p, saatSelesai) {
  const form = el('div', [
    el('div.notis.peringatan', [el('div.isi', [
      el('strong', `Pengajuan ${p.nomor} sebesar ${rp(p.pokok)} akan dibatalkan`),
      el('div.kecil', 'Pinjaman belum dicairkan sehingga tidak ada jurnal yang perlu dibalik. Agunan '
        + 'dikembalikan dan permintaan persetujuan yang masih berjalan ikut ditutup.'),
    ])]),
    kolom('Alasan Pembatalan', el('textarea', { name: 'alasan' }), { wajib: true }),
  ]);
  const tutup = modal({
    judul: `Batalkan Pengajuan — ${p.nomor}`, lebar: 'sempit', isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Tutup'),
      el('button.btn.bahaya', { onclick: async (e) => {
        const tombol = e.currentTarget;
        tombol.disabled = true;
        try {
          const h = await api.post(`/api/pinjaman/${p.id}/batal`, bacaForm(form));
          toast('Pengajuan dibatalkan', 'sukses',
            h.approval_ditutup ? 'Permintaan persetujuan terkait ikut ditutup' : null);
          tutup(); saatSelesai?.();
        } catch (err) { galat(err); tombol.disabled = false; }
      } }, 'Batalkan Pengajuan'),
    ],
  });
}

// ------------------------------- Cetakan -------------------------------

const labelBunga = (p) => `${p.bunga_tahunan}% p.a. (${judul(p.metode_bunga)})`;

/** Bagian tabel jadwal angsuran untuk model dokumen. */
export function bagianJadwal(jadwal, lengkap = true) {
  const kolom = [{ kunci: 'angsuran_ke', label: 'Ke-', tipe: 'angka' },
    { kunci: 'jatuh_tempo', label: 'Jatuh Tempo', tipe: 'tanggal' },
    { kunci: 'pokok', label: 'Pokok', tipe: 'uang' }, { kunci: 'bunga', label: 'Jasa', tipe: 'uang' },
    { kunci: 'total', label: 'Total', tipe: 'uang' }, { kunci: 'sisa_pokok', label: 'Sisa Pokok', tipe: 'uang' }];
  if (lengkap) {
    kolom.push({ kunci: 'dibayar', label: 'Dibayar', tipe: 'uang' }, { kunci: 'tanggal_bayar', label: 'Tgl Bayar', tipe: 'tanggal' },
      { kunci: 'status_teks', label: 'Status' });
  }
  const jml = (k) => jadwal.reduce((t, j) => t + (Number(j[k]) || 0), 0);
  return {
    judul: 'Jadwal Angsuran',
    kolom,
    baris: jadwal.map((j) => ({ ...j, dibayar: (j.bayar_pokok || 0) + (j.bayar_bunga || 0),
      status_teks: judul(j.status || '') })),
    total: { pokok: jml('pokok'), bunga: jml('bunga'), total: jml('total'),
      ...(lengkap ? { dibayar: jml('bayar_pokok') + jml('bayar_bunga') } : {}) },
  };
}

/** Formulir pengajuan pinjaman & hasil analisis/skoring. */
async function dokPengajuan(p) {
  let skor = null;
  // Rincian skor dihitung ulang hanya selama pengajuan belum dicairkan
  if (STATUS_BISA_BATAL.includes(p.status)) {
    try {
      skor = await api.post('/api/pinjaman/skoring', { anggota_id: p.anggota_id, pokok: p.pokok, tenor: p.tenor,
        angsuran_bulanan: p.angsuran_total || p.jadwal?.[0]?.total || 0 });
    } catch { skor = null; }
  }
  const bagian = [];
  if (p.agunan?.length) {
    bagian.push({ judul: 'Agunan', kolom: [{ kunci: 'jenis', label: 'Jenis' }, { kunci: 'deskripsi', label: 'Deskripsi' },
      { kunci: 'nomor_dokumen', label: 'No. Dokumen' }, { kunci: 'nilai_taksiran', label: 'Nilai Taksiran', tipe: 'uang' }],
    baris: p.agunan.map((g) => ({ ...g, jenis: judul(g.jenis) })),
    total: { nilai_taksiran: p.agunan.reduce((t, g) => t + g.nilai_taksiran, 0) } });
  }
  bagian.push({ judul: 'Hasil Analisis Kredit', kolom: [{ kunci: 'aspek', label: 'Aspek' }, { kunci: 'uraian', label: 'Uraian' }],
    baris: [
      { aspek: 'Skor kredit', uraian: p.skor_kredit !== null && p.skor_kredit !== undefined
        ? `${p.skor_kredit} / 100 — ${p.rekomendasi_skor || ''}` : 'Belum dinilai' },
      { aspek: 'Hasil survey', uraian: p.hasil_survey || '-' },
      { aspek: 'Catatan analis', uraian: p.catatan_analis || '-' },
      { aspek: 'Status / keputusan', uraian: [judul(p.status),
        p.tanggal_persetujuan && `tanggal ${tgl(p.tanggal_persetujuan, true)}`,
        p.disetujui_oleh && `oleh ${p.disetujui_oleh}`, p.alasan_tolak && `alasan: ${p.alasan_tolak}`]
        .filter(Boolean).join(', ') },
    ] });
  if (skor?.rincian?.length) {
    bagian.push({ judul: 'Rincian Skoring 5C (dihitung per tanggal cetak)',
      kolom: [{ kunci: 'aspek', label: 'Aspek' }, { kunci: 'nilai', label: 'Nilai', tipe: 'angka' },
        { kunci: 'maks', label: 'Maks', tipe: 'angka' }, { kunci: 'catatan', label: 'Keterangan' }],
      baris: skor.rincian, total: { nilai: skor.skor, maks: skor.maks, catatan: `${skor.rekomendasi} · DSR ${skor.dsr}%` } });
  }
  if (p.approval?.ada && p.approval.tahapan?.length) {
    bagian.push({ judul: 'Persetujuan Berjenjang', kolom: [{ kunci: 'urut', label: 'Tahap', tipe: 'angka' },
      { kunci: 'role', label: 'Peran' }, { kunci: 'oleh', label: 'Diputus Oleh' }, { kunci: 'waktu', label: 'Waktu' },
      { kunci: 'catatan', label: 'Catatan' }, { kunci: 'status', label: 'Status' }],
    baris: p.approval.tahapan.map((t) => ({ ...t, role: judul(t.role), status: judul(t.status) })) });
  }
  return {
    judul: 'Formulir Pengajuan Pinjaman & Hasil Analisis', nomor: p.nomor, jenis_ttd: 'pengajuan_pinjaman',
    ringkasan: [
      { label: 'Tanggal pengajuan', nilai: p.tanggal_pengajuan, tipe: 'tanggal' },
      { label: 'Status', nilai: judul(p.status) },
      { label: 'No. anggota', nilai: p.nomor_anggota },
      { label: 'Nama pemohon', nilai: p.anggota_nama },
      { label: 'NIK', nilai: p.nik || '-' },
      { label: 'Telepon', nilai: p.telepon || '-' },
      { label: 'Alamat', nilai: p.alamat || '-' },
      { label: 'Penghasilan / bulan', nilai: p.penghasilan, tipe: 'uang' },
      { label: 'Produk pinjaman', nilai: p.produk_nama },
      { label: 'Pokok diajukan', nilai: p.pokok, tipe: 'uang' },
      { label: 'Tenor', nilai: `${p.tenor} bulan` },
      { label: 'Jasa', nilai: labelBunga(p) },
      { label: 'Perkiraan angsuran / bulan', nilai: p.angsuran_total || p.jadwal?.[0]?.total || 0, tipe: 'uang' },
      { label: 'Biaya admin + provisi', nilai: (p.biaya_admin || 0) + (p.biaya_provisi || 0), tipe: 'uang' },
      { label: 'Tujuan penggunaan', nilai: p.tujuan || '-' },
    ],
    bagian,
    terbilang: kapital(p.terbilang_pokok),
    penanda_tambahan: { Pemohon: p.anggota_nama, Anggota: p.anggota_nama },
  };
}

/** Bukti pencairan pinjaman beserta jadwal angsuran. */
function dokPencairan(p) {
  const bersih = p.pokok - (p.biaya_admin || 0) - (p.biaya_provisi || 0);
  return {
    judul: 'Bukti Pencairan Pinjaman', nomor: p.nomor, jenis_ttd: 'pencairan_pinjaman',
    ringkasan: [
      { label: 'Tanggal pencairan', nilai: p.tanggal_cair, tipe: 'tanggal' },
      { label: 'Produk', nilai: p.produk_nama },
      { label: 'No. anggota', nilai: p.nomor_anggota },
      { label: 'Nama anggota', nilai: p.anggota_nama },
      { label: 'Pokok pinjaman', nilai: p.pokok, tipe: 'uang' },
      { label: 'Tenor', nilai: `${p.tenor} bulan` },
      { label: 'Jasa', nilai: labelBunga(p) },
      { label: 'Angsuran / bulan', nilai: p.angsuran_total, tipe: 'uang' },
      { label: 'Jatuh tempo pertama', nilai: p.jadwal?.[0]?.jatuh_tempo || '-', tipe: 'tanggal' },
      { label: 'Jatuh tempo terakhir', nilai: p.jadwal?.[p.jadwal.length - 1]?.jatuh_tempo || '-', tipe: 'tanggal' },
    ],
    bagian: [
      { judul: 'Rincian Pencairan', kolom: [{ kunci: 'uraian', label: 'Uraian' }, { kunci: 'jumlah', label: 'Jumlah (Rp)', tipe: 'uang' }],
        baris: [{ uraian: 'Pokok pinjaman', jumlah: p.pokok },
          { uraian: 'Dikurangi biaya administrasi', jumlah: -(p.biaya_admin || 0) },
          { uraian: 'Dikurangi biaya provisi', jumlah: -(p.biaya_provisi || 0) }],
        total: { jumlah: bersih, _label: 'DITERIMA BERSIH' } },
      bagianJadwal(p.jadwal || [], false),
    ],
    terbilang: kapital(p.terbilang_cair),
    catatan: 'Anggota menyatakan telah menerima dana pinjaman di atas dan bersedia membayar angsuran '
      + 'sesuai jadwal. Keterlambatan dikenakan denda sesuai ketentuan produk.',
    penanda_tambahan: { Penerima: p.anggota_nama, Anggota: p.anggota_nama },
  };
}

/** Jadwal angsuran (lengkap dengan realisasi pembayaran). */
export function dokJadwal(p) {
  return {
    judul: 'Jadwal Angsuran Pinjaman', nomor: p.nomor, jenis_ttd: 'pencairan_pinjaman', orientasi: 'landscape',
    ringkasan: [
      { label: 'No. anggota', nilai: p.nomor_anggota },
      { label: 'Nama anggota', nilai: p.anggota_nama },
      { label: 'Produk', nilai: p.produk_nama },
      { label: 'Pokok', nilai: p.pokok, tipe: 'uang' },
      { label: 'Tenor', nilai: `${p.tenor} bulan` },
      { label: 'Jasa', nilai: labelBunga(p) },
      { label: 'Tanggal cair', nilai: p.tanggal_cair || '-', tipe: 'tanggal' },
      { label: 'Sisa pokok', nilai: p.outstanding_pokok, tipe: 'uang' },
    ],
    bagian: [bagianJadwal(p.jadwal || [], true)],
    penanda_tambahan: { Penerima: p.anggota_nama, Anggota: p.anggota_nama },
  };
}

/** Bukti pembayaran angsuran / pelunasan dari GET /api/pinjaman/angsuran/:id. */
export function dokBuktiAngsuran(a) {
  const pelunasan = a.jenis === 'pelunasan_dipercepat';
  return {
    judul: pelunasan ? 'Bukti Pelunasan Pinjaman' : 'Bukti Pembayaran Angsuran', nomor: a.nomor,
    ukuran: 'A5', orientasi: 'landscape', jenis_ttd: 'angsuran',
    ringkasan: [
      { label: 'Nomor', nilai: a.nomor },
      { label: 'Tanggal bayar', nilai: a.tanggal, tipe: 'tanggal' },
      { label: 'No. pinjaman', nilai: a.nomor_pinjaman },
      { label: 'Produk', nilai: a.produk_nama },
      { label: 'No. anggota', nilai: a.nomor_anggota },
      { label: 'Nama anggota', nilai: a.anggota_nama },
      { label: 'Angsuran ke', nilai: pelunasan ? 'Pelunasan dipercepat'
        : `${a.angsuran_ke ?? '-'} dari ${a.tenor}${a.jatuh_tempo ? ` (jatuh tempo ${tgl(a.jatuh_tempo)})` : ''}` },
      { label: 'Metode', nilai: teksMetode(a.metode) },
      { label: 'Sisa pokok', nilai: a.sisa_pokok, tipe: 'uang' },
      { label: 'Petugas', nilai: a.petugas_nama || a.petugas || '-' },
    ],
    bagian: [{
      kolom: [{ kunci: 'uraian', label: 'Uraian' }, { kunci: 'jumlah', label: 'Jumlah (Rp)', tipe: 'uang' }],
      baris: [{ uraian: 'Pokok', jumlah: a.bayar_pokok },
        { uraian: pelunasan ? 'Jasa berjalan & penalti pelunasan' : 'Jasa', jumlah: a.bayar_bunga },
        { uraian: 'Denda keterlambatan', jumlah: a.bayar_denda }],
      total: { jumlah: a.total_bayar },
    }],
    terbilang: kapital(a.terbilang),
    catatan: [a.keterangan, a.sisa_pokok <= 0 ? 'Dengan pembayaran ini pinjaman dinyatakan LUNAS.' : null]
      .filter(Boolean).join(' · '),
    // Kolom petugas diisi petugas yang menerima pembayaran, bukan pengguna yang mencetak ulang
    penanda_tambahan: { Penyetor: a.anggota_nama, Anggota: a.anggota_nama, Petugas: a.petugas_nama || a.petugas },
  };
}

/** Berita acara restrukturisasi: pinjaman baru hasil pengalihan saldo pinjaman lama. */
function dokRestrukturisasi(p) {
  return {
    judul: 'Berita Acara Restrukturisasi Pinjaman', nomor: p.nomor, jenis_ttd: 'pencairan_pinjaman',
    ringkasan: [
      { label: 'Tanggal', nilai: p.tanggal_cair || p.tanggal_pengajuan, tipe: 'tanggal' },
      { label: 'Pinjaman lama', nilai: p.restruktur_dari_nomor || '-' },
      { label: 'Pinjaman baru', nilai: p.nomor },
      { label: 'Produk', nilai: p.produk_nama },
      { label: 'No. anggota', nilai: p.nomor_anggota },
      { label: 'Nama anggota', nilai: p.anggota_nama },
      { label: 'Pokok baru', nilai: p.pokok, tipe: 'uang' },
      { label: 'Tenor baru', nilai: `${p.tenor} bulan` },
      { label: 'Jasa', nilai: labelBunga(p) },
      { label: 'Angsuran / bulan', nilai: p.angsuran_total, tipe: 'uang' },
      { label: 'Disetujui oleh', nilai: p.disetujui_oleh || '-' },
      { label: 'Alasan', nilai: p.catatan_analis || '-' },
    ],
    bagian: [bagianJadwal(p.jadwal || [], false)],
    terbilang: kapital(p.terbilang_pokok),
    catatan: 'Sisa pokok (dan denda yang dikapitalisasi) pinjaman lama dialihkan menjadi pinjaman baru tanpa '
      + 'arus kas; pinjaman lama dinyatakan ditutup. Anggota menyetujui jadwal angsuran baru di atas.',
    penanda_tambahan: { Penerima: p.anggota_nama, Anggota: p.anggota_nama },
  };
}
