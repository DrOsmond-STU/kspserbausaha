/**
 * Modul 21 - Audit Internal (temuan & CAPA).
 */
import {
  api, el, kpi, panel, panelTabel, tabel, angka, persen, tgl, status, judul, modal, kolom,
  input, pilih, bacaForm, toast, galat, memuat, kosongkan, hariIni, bilah, konfirmasi,
} from '../inti.js';
import { izin, navigasi } from '../app.js';
import { tombolCetak } from '../cetak.js';
import { ikon } from '../ikon.js';

const RATING = ['rendah', 'sedang', 'tinggi', 'kritis'];
const kelasRating = (r) => ({ rendah: 'st-sukses', sedang: 'st-peringatan',
  tinggi: 'st-bahaya', kritis: 'st-bahaya' }[r] || 'st-netral');

export async function render(param) {
  if (param[0]) return detailPlan(Number(param[0]));

  const wadah = el('div');
  const isi = el('div');
  const daftarTab = [
    { judul: 'Ikhtisar', render: ikhtisarTab },
    { judul: 'Rencana Audit', render: planTab },
    { judul: 'Temuan & CAPA', render: temuanTab },
  ];
  const bilahTab = el('div.tab', daftarTab.map((t, i) => el('button', {
    class: i === 0 ? 'aktif' : '',
    onclick: async (e) => {
      bilahTab.querySelectorAll('button').forEach((b) => b.classList.remove('aktif'));
      e.currentTarget.classList.add('aktif');
      kosongkan(isi).append(memuat());
      kosongkan(isi).append(await t.render());
    },
  }, t.judul)));
  wadah.append(el('div.panel', [bilahTab]), isi);
  isi.append(await daftarTab[0].render());
  return wadah;
}

async function ikhtisarTab() {
  const d = await api.get('/api/audit/dashboard/ringkasan');
  return el('div', [
    el('div.grid.k4.mb16', [
      kpi('Total Temuan', angka(d.total_temuan), { ikon: ikon('kaca') }),
      kpi('Terbuka', angka(d.terbuka), { jenis: d.terbuka ? 'peringatan' : 'sukses' }),
      kpi('Selesai', angka(d.selesai), { jenis: 'sukses' }),
      kpi('Tingkat Penyelesaian', persen(d.tingkat_penyelesaian), {
        jenis: d.tingkat_penyelesaian >= 80 ? 'sukses' : 'peringatan' }),
    ]),
    el('div.grid.k2', [
      panelTabel('Temuan per Tingkat Risiko', tabel([
        { judul: 'Tingkat Risiko', render: (r) => el(`span.lencana-status.${kelasRating(r.risk_rating)}`,
          judul(r.risk_rating)) },
        { judul: 'Jumlah', angka: true, render: (r) => angka(r.jumlah) },
      ], d.per_rating, { kosongTeks: 'Belum ada temuan' })),
      panelTabel('Temuan per Status', tabel([
        { judul: 'Status', render: (r) => status(r.status) },
        { judul: 'Jumlah', angka: true, render: (r) => angka(r.jumlah) },
      ], d.per_status, { kosongTeks: 'Belum ada temuan' })),
    ]),
    panelTabel(`CAPA Mendekati Batas Waktu (${d.capa_jatuh_tempo.length})`, tabel([
      { judul: 'Kode', render: (t) => el('span.mono.kecil', t.kode || '-') },
      { judul: 'Temuan', kunci: 'judul' },
      { judul: 'Risiko', render: (t) => el(`span.lencana-status.${kelasRating(t.risk_rating)}`,
        judul(t.risk_rating)) },
      { judul: 'PIC', render: (t) => t.pic || '-' },
      { judul: 'Batas Waktu', render: (t) => tgl(t.batas_waktu, true) },
      { judul: 'Status', render: (t) => status(t.status) },
    ], d.capa_jatuh_tempo, { kosongTeks: 'Tidak ada CAPA yang mendekati batas waktu ✓' })),
  ]);
}

async function planTab() {
  const wadah = el('div');
  async function muat() {
    kosongkan(wadah).append(memuat());
    try {
      const d = await api.get('/api/audit/plan');
      kosongkan(wadah).append(panelTabel('Rencana Audit Internal', tabel([
        { judul: 'Nomor', render: (p) => el('span.mono.kecil', p.nomor) },
        { judul: 'Judul', kunci: 'judul' },
        { judul: 'Tahun', kunci: 'tahun' },
        { judul: 'Objek Audit', render: (p) => p.objek || '-' },
        { judul: 'Auditor', render: (p) => el('span.kecil', p.auditor || '-') },
        { judul: 'Periode', render: (p) => el('span.kecil.nowrap',
          `${tgl(p.tanggal_mulai)} – ${tgl(p.tanggal_selesai)}`) },
        { judul: 'Temuan', angka: true, render: (p) => `${p.temuan_terbuka} / ${p.jumlah_temuan}` },
        { judul: 'Status', render: (p) => status(p.status) },
        { judul: '', render: (p) => el('div.gap8.nowrap', [
          izin('audit.update') && el('button.btn.kecil', {
            onclick: (e) => { e.stopPropagation(); formPlan(p, muat); } }, 'Ubah'),
          izin('audit.delete') && el('button.btn.kecil.bahaya', {
            onclick: (e) => { e.stopPropagation(); hapusPlan(p, muat); } }, 'Hapus'),
        ].filter(Boolean)) },
      ], d.data, { saatKlik: (p) => { location.hash = `#/audit/${p.id}`; },
        kosongTeks: 'Belum ada rencana audit' }), [
        izin('audit.create') && el('button.btn.utama', { onclick: () => formPlan(null, muat) },
          '+ Buat Rencana Audit'),
      ].filter(Boolean)));
    } catch (err) { galat(err); }
  }
  await muat();
  return wadah;
}

async function detailPlan(id) {
  const p = await api.get(`/api/audit/plan/${id}`);
  const wadah = el('div');
  wadah.append(el('div.gap8.mb16', [
    el('button.btn', { onclick: () => { location.hash = '#/audit'; } }, '← Kembali'),
    izin('audit.create') && el('button.btn.utama', {
      onclick: () => formTemuan(null, id, () => navigasi(location.hash, true)) }, '+ Tambah Temuan'),
    izin('audit.update') && el('button.btn', {
      onclick: () => formPlan(p, () => navigasi(location.hash, true)) }, 'Ubah Rencana'),
    izin('audit.delete') && el('button.btn.bahaya', {
      onclick: () => hapusPlan({ ...p, jumlah_temuan: p.temuan.length },
        () => { location.hash = '#/audit'; }) }, 'Hapus Rencana'),
    tombolCetak(() => dokLaporanAudit(p), { label: 'Cetak Laporan Hasil Audit' }),
  ].filter(Boolean)));

  wadah.append(panel(p.judul, el('dl.deskripsi', [
    el('dt', 'Nomor'), el('dd', el('span.mono', p.nomor)),
    el('dt', 'Tahun'), el('dd', p.tahun),
    el('dt', 'Objek audit'), el('dd', p.objek || '-'),
    el('dt', 'Auditor'), el('dd', p.auditor || '-'),
    el('dt', 'Periode'), el('dd', `${tgl(p.tanggal_mulai, true)} – ${tgl(p.tanggal_selesai, true)}`),
    el('dt', 'Ruang lingkup'), el('dd', p.ruang_lingkup || '-'),
    el('dt', 'Status'), el('dd', status(p.status)),
  ])));

  for (const t of p.temuan) {
    wadah.append(panel(`${t.kode || 'Temuan'} — ${t.judul}`, el('div', [
      el('div.gap8.mb16', [
        el(`span.lencana-status.${kelasRating(t.risk_rating)}`, `Risiko ${judul(t.risk_rating)}`),
        status(t.status),
      ]),
      el('dl.deskripsi', [
        el('dt', 'Kondisi'), el('dd', t.deskripsi || '-'),
        el('dt', 'Kriteria'), el('dd', t.kriteria || '-'),
        el('dt', 'Sebab'), el('dd', t.sebab || '-'),
        el('dt', 'Akibat'), el('dd', t.akibat || '-'),
        el('dt', 'Rekomendasi'), el('dd', t.rekomendasi || '-'),
        el('dt', 'CAPA'), el('dd', t.capa || el('span.samar', 'belum ada rencana tindakan')),
        el('dt', 'PIC'), el('dd', t.pic || '-'),
        el('dt', 'Batas waktu'), el('dd', tgl(t.batas_waktu, true)),
      ]),
      el('div.gap8.mt16', [
        izin('audit.update') && el('button.btn.kecil', {
          onclick: () => formTemuan(t, id, () => navigasi(location.hash, true)) }, 'Ubah / Perbarui CAPA'),
        izin('audit.delete') && el('button.btn.kecil.bahaya', {
          onclick: () => hapusTemuan(t, () => navigasi(location.hash, true)) }, 'Hapus Temuan'),
      ].filter(Boolean)),
    ])));
  }
  if (!p.temuan.length) wadah.append(panel('Temuan Audit', el('div.kosong', 'Belum ada temuan dicatat')));
  return wadah;
}

async function temuanTab() {
  const wadah = el('div');
  async function muat() {
    kosongkan(wadah).append(memuat());
    try {
      const d = await api.get('/api/audit/temuan', { limit: 200 });
      kosongkan(wadah).append(panelTabel('Seluruh Temuan Audit', tabel([
        { judul: 'Kode', render: (t) => el('span.mono.kecil', t.kode || '-') },
        { judul: 'Temuan', render: (t) => el('div', [
          el('div.tebal', t.judul),
          t.deskripsi && el('div.kecil.samar', String(t.deskripsi).slice(0, 90))]) },
        { judul: 'Risiko', render: (t) => el(`span.lencana-status.${kelasRating(t.risk_rating)}`,
          judul(t.risk_rating)) },
        { judul: 'PIC', render: (t) => el('span.kecil', t.pic || '-') },
        { judul: 'Batas Waktu', render: (t) => tgl(t.batas_waktu) },
        { judul: 'Status', render: (t) => status(t.status) },
        { judul: '', render: (t) => el('div.gap8.nowrap', [
          izin('audit.update') && el('button.btn.kecil', { onclick: () => formTemuan(t, t.plan_id, muat) }, 'Ubah'),
          izin('audit.delete') && el('button.btn.kecil.bahaya', { onclick: () => hapusTemuan(t, muat) }, 'Hapus'),
        ].filter(Boolean)) },
      ], d.data, { kosongTeks: 'Belum ada temuan audit' }), [
        izin('audit.create') && el('button.btn.utama', { onclick: () => formTemuan(null, null, muat) },
          '+ Tambah Temuan'),
        tombolCetak(() => ({
          judul: 'Daftar Temuan Audit & Tindak Lanjut (CAPA)', jenis_ttd: 'laporan', orientasi: 'landscape',
          bagian: [bagianTemuan(d.data)],
        }), { label: 'Cetak' }),
      ].filter(Boolean)));
    } catch (err) { galat(err); }
  }
  await muat();
  return wadah;
}

/** Formulir rencana audit; `data` terisi berarti mode ubah. */
function formPlan(data, saatSelesai) {
  const f = el('div', [
    el('div.baris-form', [
      kolom('Judul Audit', input('judul', { nilai: data?.judul || '' }), { wajib: true }),
      kolom('Tahun', input('tahun', { tipe: 'number', nilai: data?.tahun || new Date().getFullYear() }),
        { wajib: true }),
    ]),
    el('div.baris-form.k3', [
      kolom('Objek Audit', input('objek', { nilai: data?.objek || '', placeholder: 'contoh: Unit Simpan Pinjam' })),
      kolom('Auditor', input('auditor', { nilai: data?.auditor || '' })),
      kolom('Status', pilih('status', ['rencana', 'berjalan', 'selesai']
        .map((s) => ({ nilai: s, teks: judul(s) })), data?.status)),
    ]),
    el('div.baris-form', [
      kolom('Tanggal Mulai', input('tanggal_mulai', { tipe: 'date',
        nilai: data ? (data.tanggal_mulai || '') : hariIni() })),
      kolom('Tanggal Selesai', input('tanggal_selesai', { tipe: 'date', nilai: data?.tanggal_selesai || '' })),
    ]),
    kolom('Ruang Lingkup', el('textarea', { name: 'ruang_lingkup' }, data?.ruang_lingkup || '')),
  ]);
  const tutup = modal({
    judul: data ? `Ubah Rencana Audit ${data.nomor}` : 'Rencana Audit Internal', lebar: 'lebar', isi: f,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async (e) => {
        const tombol = e.currentTarget;
        tombol.disabled = true;
        try {
          if (data) await api.put(`/api/audit/plan/${data.id}`, bacaForm(f));
          else await api.post('/api/audit/plan', bacaForm(f));
          toast('Rencana audit tersimpan', 'sukses');
          tutup(); saatSelesai?.();
        } catch (err) { galat(err); tombol.disabled = false; }
      } }, 'Simpan'),
    ],
  });
}

async function hapusPlan(p, saatSelesai) {
  if (p.jumlah_temuan) {
    toast('Rencana audit tidak dapat dihapus', 'peringatan',
      `Sudah ada ${p.jumlah_temuan} temuan pada rencana ini. Hapus temuannya terlebih dahulu.`);
    return;
  }
  if (!await konfirmasi(`Hapus rencana audit ${p.nomor} — ${p.judul}?`,
    { judul: 'Hapus Rencana Audit', ya: 'Hapus', jenis: 'bahaya' })) return;
  try {
    await api.del(`/api/audit/plan/${p.id}`);
    toast('Rencana audit dihapus', 'sukses');
    saatSelesai?.();
  } catch (err) { galat(err); }
}

async function hapusTemuan(t, saatSelesai) {
  if (!await konfirmasi(`Hapus temuan "${t.judul}" beserta rencana CAPA-nya? Tindakan ini tercatat di log audit.`,
    { judul: 'Hapus Temuan Audit', ya: 'Hapus', jenis: 'bahaya' })) return;
  try {
    await api.del(`/api/audit/temuan/${t.id}`);
    toast('Temuan audit dihapus', 'sukses');
    saatSelesai?.();
  } catch (err) { galat(err); }
}

function formTemuan(data, planId, saatSelesai) {
  const f = el('div', [
    el('div.baris-form.k3', [
      kolom('Kode Temuan', input('kode', { nilai: data?.kode || '' })),
      kolom('Tingkat Risiko', pilih('risk_rating', RATING.map((r) => ({ nilai: r, teks: judul(r) })),
        data?.risk_rating || 'sedang')),
      kolom('Status', pilih('status', ['terbuka', 'proses', 'selesai', 'dibatalkan']
        .map((s) => ({ nilai: s, teks: judul(s) })), data?.status)),
    ]),
    kolom('Judul Temuan', input('judul', { nilai: data?.judul || '' }), { wajib: true }),
    kolom('Kondisi (apa yang ditemukan)', el('textarea', { name: 'deskripsi' }, data?.deskripsi || '')),
    kolom('Kriteria (seharusnya)', el('textarea', { name: 'kriteria' }, data?.kriteria || '')),
    el('div.baris-form', [
      kolom('Sebab', el('textarea', { name: 'sebab' }, data?.sebab || '')),
      kolom('Akibat', el('textarea', { name: 'akibat' }, data?.akibat || '')),
    ]),
    kolom('Rekomendasi', el('textarea', { name: 'rekomendasi' }, data?.rekomendasi || '')),
    kolom('CAPA (Corrective & Preventive Action)', el('textarea', { name: 'capa' }, data?.capa || '')),
    el('div.baris-form', [
      kolom('PIC', input('pic', { nilai: data?.pic || '' })),
      kolom('Batas Waktu', input('batas_waktu', { tipe: 'date', nilai: data?.batas_waktu || '' })),
    ]),
    planId ? el('input', { type: 'hidden', name: 'plan_id', nilai: planId }) : null,
  ].filter(Boolean));

  const tutup = modal({
    judul: data ? 'Ubah Temuan Audit' : 'Tambah Temuan Audit', lebar: 'lebar', isi: f,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async (e) => {
        const tombol = e.currentTarget;
        tombol.disabled = true;
        try {
          if (data) await api.put(`/api/audit/temuan/${data.id}`, bacaForm(f));
          else await api.post('/api/audit/temuan', bacaForm(f));
          toast('Temuan audit tersimpan', 'sukses');
          tutup(); saatSelesai?.();
        } catch (err) { galat(err); tombol.disabled = false; }
      } }, 'Simpan'),
    ],
  });
}

// ------------------------------- Cetakan -------------------------------

function bagianTemuan(temuan, jdl = null) {
  return {
    judul: jdl,
    kolom: [{ kunci: 'no', label: 'No', tipe: 'angka' }, { kunci: 'kode', label: 'Kode' }, { kunci: 'judul', label: 'Temuan' },
      { kunci: 'deskripsi', label: 'Kondisi' }, { kunci: 'kriteria', label: 'Kriteria' }, { kunci: 'sebab', label: 'Sebab' },
      { kunci: 'akibat', label: 'Akibat' }, { kunci: 'rekomendasi', label: 'Rekomendasi' }, { kunci: 'capa', label: 'CAPA' },
      { kunci: 'risk_rating', label: 'Risiko' }, { kunci: 'pic', label: 'PIC' },
      { kunci: 'batas_waktu', label: 'Batas Waktu', tipe: 'tanggal' }, { kunci: 'status', label: 'Status' }],
    baris: temuan.map((t, i) => ({ ...t, no: i + 1, risk_rating: judul(t.risk_rating), status: judul(t.status) })),
  };
}

/** Laporan hasil audit internal: rencana audit dan seluruh temuannya. */
function dokLaporanAudit(p) {
  const terbuka = p.temuan.filter((t) => !['selesai', 'ditutup'].includes(t.status)).length;
  return {
    judul: 'Laporan Hasil Audit Internal', subjudul: p.judul, nomor: p.nomor, jenis_ttd: 'laporan',
    orientasi: 'landscape',
    ringkasan: [
      { label: 'Tahun', nilai: p.tahun },
      { label: 'Objek audit', nilai: p.objek || '-' },
      { label: 'Auditor', nilai: p.auditor || '-' },
      { label: 'Periode', nilai: `${tgl(p.tanggal_mulai, true)} - ${tgl(p.tanggal_selesai, true)}` },
      { label: 'Ruang lingkup', nilai: p.ruang_lingkup || '-' },
      { label: 'Status', nilai: judul(p.status) },
      { label: 'Jumlah temuan', nilai: p.temuan.length, tipe: 'angka' },
      { label: 'Temuan terbuka', nilai: terbuka, tipe: 'angka' },
    ],
    bagian: [bagianTemuan(p.temuan, 'Temuan Audit & Rencana Tindakan (CAPA)')],
  };
}
