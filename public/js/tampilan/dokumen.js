/**
 * Modul 18 - Document Management System & Persuratan.
 */
import {
  api, el, kpi, panel, panelTabel, tabel, angka, tgl, waktu, status, judul, modal, kolom,
  input, pilih, bacaForm, toast, galat, memuat, kosongkan, hariIni, kosong, konfirmasi,
} from '../inti.js';
import { izin, navigasi } from '../app.js';

const KATEGORI = ['ad_art', 'sop', 'kebijakan', 'notulen', 'kontrak', 'legalitas',
  'sertifikat', 'rat', 'surat', 'lainnya'];

export async function render() {
  const wadah = el('div');
  const isi = el('div');
  const daftarTab = [
    { judul: 'Repositori Dokumen', render: dokumenTab },
    { judul: 'Persuratan', render: suratTab },
    { judul: 'Retensi & Kedaluwarsa', render: retensiTab },
  ];
  const bilah = el('div.tab', daftarTab.map((t, i) => el('button', {
    class: i === 0 ? 'aktif' : '',
    onclick: async (e) => {
      bilah.querySelectorAll('button').forEach((b) => b.classList.remove('aktif'));
      e.currentTarget.classList.add('aktif');
      kosongkan(isi).append(memuat());
      kosongkan(isi).append(await t.render());
    },
  }, t.judul)));
  wadah.append(el('div.panel', [bilah]), isi);
  isi.append(await daftarTab[0].render());
  return wadah;
}

async function dokumenTab() {
  const wadah = el('div');
  let q = '';
  let kategori = '';

  async function muat() {
    kosongkan(wadah).append(memuat());
    try {
      const d = await api.get('/api/dokumen', { q, kategori });
      kosongkan(wadah).append(
        el('div.notis.info', [el('div.isi', [
          el('strong', 'Integritas dokumen elektronik'),
          el('div.kecil', 'Setiap berkas disimpan bersama sidik jari SHA-256. Perubahan sekecil apa pun '
            + 'pada berkas akan terdeteksi melalui menu verifikasi — sesuai UU ITE Pasal 5 dan 6.'),
        ])]),
        panelTabel(`Repositori Dokumen (${angka(d.total)})`, tabel([
          { judul: 'Nomor', render: (x) => el('span.mono.kecil', x.nomor || '-') },
          { judul: 'Judul', render: (x) => el('div', [
            el('div.tebal', x.judul),
            x.deskripsi && el('div.kecil.samar', x.deskripsi)]) },
          { judul: 'Kategori', render: (x) => status('netral', judul(x.kategori)) },
          { judul: 'Versi', angka: true, render: (x) => `v${x.versi}` },
          { judul: 'Hash', render: (x) => (x.hash_sha256
            ? el('span.mono.kecil.samar', `${x.hash_sha256.slice(0, 12)}…`)
            : el('span.samar', 'tanpa berkas')) },
          { judul: 'Tanda Tangan', render: (x) => (x.ttd_oleh
            ? el('span.kecil.pos', `✓ ${x.ttd_oleh}`) : el('span.samar', '-')) },
          { judul: 'Status', render: (x) => status(x.status) },
          { judul: '', render: (x) => el('div.gap8', [
            el('button.btn.kecil', { onclick: (e) => { e.stopPropagation(); lihat(x.id, muat); } }, 'Detail'),
          ]) },
        ], d.data, { kosongTeks: 'Belum ada dokumen tersimpan' }), [
          el('input', { type: 'search', placeholder: 'Cari judul, nomor, tag, atau isi teks…',
            oninput: (e) => { q = e.target.value; clearTimeout(muat.t); muat.t = setTimeout(muat, 320); } }),
          pilih('k', ['', ...KATEGORI].map((s) => ({ nilai: s, teks: s ? judul(s) : 'Semua kategori' })),
            kategori, { onchange: (e) => { kategori = e.target.value; muat(); } }),
          izin('dokumen.create') && el('button.btn.utama', { onclick: () => formUnggah(muat) },
            '+ Unggah Dokumen'),
        ].filter(Boolean)),
      );
    } catch (err) { galat(err); }
  }
  await muat();
  return wadah;
}

async function lihat(id, saatSelesai) {
  const d = await api.get(`/api/dokumen/${id}`);
  const tutup = modal({
    judul: d.judul, lebar: 'lebar',
    isi: el('div', [
      el('dl.deskripsi.mb16', [
        el('dt', 'Nomor'), el('dd', d.nomor || '-'),
        el('dt', 'Kategori'), el('dd', judul(d.kategori)),
        el('dt', 'Deskripsi'), el('dd', d.deskripsi || '-'),
        el('dt', 'Versi'), el('dd', `v${d.versi}`),
        el('dt', 'Berkas'), el('dd', d.file_nama || el('span.samar', 'tanpa lampiran')),
        el('dt', 'Sidik jari SHA-256'), el('dd', el('span.mono.kecil', d.hash_sha256 || '-')),
        el('dt', 'Retensi'), el('dd', `${d.retensi_tahun} tahun`),
        el('dt', 'Tanda tangan'), el('dd', d.ttd_oleh
          ? `${d.ttd_oleh} — ${waktu(d.ttd_pada)}` : el('span.samar', 'belum ditandatangani')),
        el('dt', 'Status'), el('dd', status(d.status)),
      ]),
      d.versi_riwayat.length ? el('div', [
        el('div.tebal.mb8', 'Riwayat Versi'),
        el('div.tabel-bungkus', [tabel([
          { judul: 'Versi', render: (v) => `v${v.versi}` },
          { judul: 'Hash', render: (v) => el('span.mono.kecil.samar', v.hash_sha256
            ? `${v.hash_sha256.slice(0, 16)}…` : '-') },
          { judul: 'Catatan', render: (v) => el('span.kecil', v.catatan || '-') },
          { judul: 'Oleh', render: (v) => el('span.kecil', v.oleh || '-') },
          { judul: 'Waktu', render: (v) => waktu(v.created_at) },
        ], d.versi_riwayat)]),
      ]) : null,
    ]),
    kaki: [
      el('button.btn', { onclick: async () => {
        try {
          const h = await api.get(`/api/dokumen/${id}/verifikasi`);
          toast(h.valid === null ? 'Dokumen tanpa berkas' : h.valid ? 'Berkas UTUH ✓' : 'PERINGATAN: berkas berubah',
            h.valid === false ? 'bahaya' : h.valid ? 'sukses' : 'peringatan', h.pesan);
        } catch (err) { galat(err); }
      } }, 'Verifikasi Integritas'),
      izin('dokumen.update') && el('button.btn', {
        onclick: () => { tutup(); formVersi(d, saatSelesai); } }, 'Unggah Versi Baru'),
      izin('dokumen.update') && !d.ttd_elektronik && el('button.btn.sukses', { onclick: async () => {
        if (!await konfirmasi('Tandatangani dokumen ini secara elektronik? Tindakan ini tidak dapat dibatalkan.',
          { ya: 'Tandatangani' })) return;
        try {
          await api.post(`/api/dokumen/${id}/tandatangani`, {});
          toast('Dokumen ditandatangani secara elektronik', 'sukses');
          tutup(); saatSelesai?.();
        } catch (err) { galat(err); }
      } }, 'Tandatangani'),
      el('button.btn.utama', { onclick: () => tutup() }, 'Tutup'),
    ].filter(Boolean),
  });
}

/**
 * Pemilih berkas yang membaca isi sebagai data URI base64.
 * Mengembalikan { node, ambil } — ambil() memberi { data, nama, mime } atau null.
 */
function pemilihBerkas() {
  let berkas = null;
  const namaBerkas = el('div.kecil.samar');
  const node = el('div', [
    kolom('Berkas', el('input', {
      type: 'file',
      onchange: (e) => {
        const f = e.target.files[0];
        berkas = null;
        if (!f) { kosongkan(namaBerkas); return; }
        if (f.size > 8 * 1024 * 1024) {
          toast('Ukuran berkas maksimal 8 MB', 'peringatan');
          e.target.value = ''; kosongkan(namaBerkas); return;
        }
        const r = new FileReader();
        r.onload = () => {
          berkas = { data: r.result, nama: f.name, mime: f.type };
          kosongkan(namaBerkas).append(`${f.name} · ${(f.size / 1024).toFixed(0)} KB`);
        };
        r.readAsDataURL(f);
      },
    }), { bantuan: 'Maksimal 8 MB. Sidik jari SHA-256 dihitung otomatis.' }),
    namaBerkas,
  ]);
  return { node, ambil: () => berkas };
}

function formUnggah(saatSelesai) {
  const berkas = pemilihBerkas();
  const form = el('div', [
    el('div.baris-form', [
      kolom('Judul Dokumen', input('judul'), { wajib: true }),
      kolom('Nomor Dokumen', input('nomor')),
    ]),
    el('div.baris-form', [
      kolom('Kategori', pilih('kategori', KATEGORI.map((k) => ({ nilai: k, teks: judul(k) })))),
      kolom('Masa Retensi (tahun)', input('retensi_tahun', { tipe: 'number', min: 1, nilai: 10 })),
    ]),
    kolom('Deskripsi', input('deskripsi')),
    kolom('Tag', input('tag', { placeholder: 'Dipisahkan koma' })),
    kolom('Tanggal Kedaluwarsa', input('tanggal_kadaluarsa', { tipe: 'date' })),
    berkas.node,
  ]);
  const tutup = modal({
    judul: 'Unggah Dokumen', isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async (e) => {
        const tombol = e.currentTarget;
        tombol.disabled = true;
        try {
          const b = berkas.ambil();
          await api.post('/api/dokumen', {
            ...bacaForm(form),
            file_data: b?.data || null, file_nama: b?.nama || null,
            file_mime: b?.mime || null,
          });
          toast('Dokumen berhasil diunggah', 'sukses');
          tutup(); saatSelesai?.();
        } catch (err) { galat(err); tombol.disabled = false; }
      } }, 'Unggah'),
    ],
  });
}

/** Unggah versi baru untuk dokumen yang sudah ada (riwayat versi tetap tersimpan). */
function formVersi(d, saatSelesai) {
  const berkas = pemilihBerkas();
  const form = el('div', [
    el('div.notis.info', [el('div.isi', [
      el('strong', `${d.judul} — saat ini v${d.versi}`),
      el('div.kecil', 'Versi baru berstatus review. '
        + (d.ttd_elektronik ? 'Tanda tangan elektronik pada versi lama dilepas dan dokumen perlu ditandatangani ulang.'
          : 'Versi lama tetap tersimpan pada riwayat.')),
    ])]),
    berkas.node,
    kolom('Catatan Perubahan', el('textarea', { name: 'catatan', rows: 3,
      placeholder: 'Apa yang berubah pada versi ini?' })),
  ]);
  const tutup = modal({
    judul: `Versi Baru — v${d.versi + 1}`, isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async (e) => {
        const b = berkas.ambil();
        if (!b) { toast('Pilih berkas versi baru terlebih dahulu', 'peringatan'); return; }
        const tombol = e.currentTarget;
        tombol.disabled = true;
        try {
          const h = await api.post(`/api/dokumen/${d.id}/versi`, {
            ...bacaForm(form), file_data: b.data, file_nama: b.nama, file_mime: b.mime || null,
          });
          toast(`Versi v${h.versi} tersimpan`, 'sukses');
          tutup(); saatSelesai?.();
        } catch (err) { galat(err); tombol.disabled = false; }
      } }, 'Unggah Versi'),
    ],
  });
}

async function suratTab() {
  const wadah = el('div');
  let jenis = '';
  async function muat() {
    kosongkan(wadah).append(memuat());
    try {
      const d = await api.get('/api/surat', { jenis });
      kosongkan(wadah).append(panelTabel(`Persuratan (${angka(d.total)})`, tabel([
        { judul: 'Nomor', render: (s) => el('span.mono.kecil', s.nomor) },
        { judul: 'Jenis', render: (s) => status(s.jenis === 'masuk' ? 'info' : 'netral', judul(s.jenis)) },
        { judul: 'Tanggal', render: (s) => tgl(s.tanggal) },
        { judul: 'Perihal', kunci: 'perihal' },
        { judul: 'Dari', render: (s) => el('span.kecil', s.dari || '-') },
        { judul: 'Kepada', render: (s) => el('span.kecil', s.kepada || '-') },
        { judul: 'Sifat', render: (s) => status(s.sifat === 'rahasia' || s.sifat === 'segera'
          ? 'peringatan' : 'netral', judul(s.sifat || 'biasa')) },
        { judul: 'Status', render: (s) => status(s.status) },
        { judul: '', render: (s) => el('div.gap8.nowrap', [
          izin('surat.update') && s.jenis === 'masuk'
            && el('button.btn.kecil', { onclick: () => formDisposisi(s, muat) }, 'Disposisi'),
          izin('surat.update') && el('button.btn.kecil', { onclick: () => formSurat(s, muat) }, 'Ubah'),
          izin('surat.delete') && el('button.btn.kecil.bahaya', { onclick: () => hapusSurat(s, muat) }, 'Hapus'),
        ].filter(Boolean)) },
      ], d.data, { kosongTeks: 'Belum ada surat tercatat' }), [
        pilih('j', [{ nilai: '', teks: 'Semua surat' }, { nilai: 'masuk', teks: 'Surat Masuk' },
          { nilai: 'keluar', teks: 'Surat Keluar' }], jenis,
        { onchange: (e) => { jenis = e.target.value; muat(); } }),
        izin('surat.create') && el('button.btn.utama', { onclick: () => formSurat(null, muat) }, '+ Catat Surat'),
      ].filter(Boolean)));
    } catch (err) { galat(err); }
  }
  await muat();
  return wadah;
}

/** Formulir surat; `data` terisi berarti mode ubah (status ikut dapat diubah). */
function formSurat(data, saatSelesai) {
  const form = el('div', [
    el('div.baris-form.k3', [
      kolom('Nomor Surat', input('nomor', { nilai: data?.nomor || '' }), { wajib: true }),
      kolom('Jenis', pilih('jenis', [{ nilai: 'masuk', teks: 'Surat Masuk' },
        { nilai: 'keluar', teks: 'Surat Keluar' }], data?.jenis), { wajib: true }),
      kolom('Tanggal', input('tanggal', { tipe: 'date', nilai: data?.tanggal || hariIni() }), { wajib: true }),
    ]),
    kolom('Perihal', input('perihal', { nilai: data?.perihal || '' }), { wajib: true }),
    el('div.baris-form.k3', [
      kolom('Dari', input('dari', { nilai: data?.dari || '' })),
      kolom('Kepada', input('kepada', { nilai: data?.kepada || '' })),
      kolom('Sifat', pilih('sifat', ['biasa', 'penting', 'segera', 'rahasia']
        .map((s) => ({ nilai: s, teks: judul(s) })), data?.sifat)),
    ]),
    kolom('Isi Ringkas', el('textarea', { name: 'isi' }, data?.isi || '')),
    el('div.baris-form', [
      kolom('Lampiran', input('lampiran', { nilai: data?.lampiran || '', placeholder: 'Keterangan lampiran' })),
      data ? kolom('Status', pilih('status', ['baru', 'diproses', 'selesai', 'arsip']
        .map((s) => ({ nilai: s, teks: judul(s) })), data.status)) : null,
    ]),
  ]);
  const tutup = modal({
    judul: data ? `Ubah Surat — ${data.nomor}` : 'Catat Surat', lebar: 'lebar', isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async (e) => {
        const tombol = e.currentTarget;
        tombol.disabled = true;
        try {
          if (data) await api.put(`/api/surat/${data.id}`, bacaForm(form));
          else await api.post('/api/surat', bacaForm(form));
          toast(data ? 'Surat diperbarui' : 'Surat tercatat', 'sukses');
          tutup(); saatSelesai?.();
        } catch (err) { galat(err); tombol.disabled = false; }
      } }, 'Simpan'),
    ],
  });
}

async function hapusSurat(s, saatSelesai) {
  if (!await konfirmasi(`Hapus surat ${s.nomor} — ${s.perihal}?`,
    { judul: 'Hapus Surat', ya: 'Hapus', jenis: 'bahaya' })) return;
  try {
    await api.del(`/api/surat/${s.id}`);
    toast('Surat dihapus', 'sukses');
    saatSelesai?.();
  } catch (err) { galat(err); }
}

function formDisposisi(s, saatSelesai) {
  const form = el('div', [
    el('div.notis.info', [el('div.isi', [el('strong', s.perihal),
      el('div.kecil', `Dari ${s.dari || '-'} · ${tgl(s.tanggal, true)}`)])]),
    kolom('Disposisi Kepada', input('disposisi_kepada'), { wajib: true }),
    kolom('Isi Disposisi', el('textarea', { name: 'disposisi' }), { wajib: true }),
  ]);
  const tutup = modal({
    judul: `Disposisi — ${s.nomor}`, isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async () => {
        try {
          await api.post(`/api/surat/${s.id}/disposisi`, bacaForm(form));
          toast('Disposisi tercatat', 'sukses');
          tutup(); saatSelesai?.();
        } catch (err) { galat(err); }
      } }, 'Simpan'),
    ],
  });
}

async function retensiTab() {
  const d = await api.get('/api/dokumen/laporan/retensi');
  return el('div', [
    el('div.notis.peringatan', [el('div.isi', [
      el('strong', 'Manajemen retensi arsip'),
      el('div.kecil', 'Dokumen yang melewati masa retensi dapat dimusnahkan sesuai kebijakan kearsipan '
        + 'koperasi, kecuali dokumen legalitas yang wajib disimpan permanen.'),
    ])]),
    panelTabel(`Akan Kedaluwarsa dalam 90 Hari (${d.akan_kadaluarsa.length})`, tabel([
      { judul: 'Judul', kunci: 'judul' },
      { judul: 'Kategori', render: (x) => judul(x.kategori) },
      { judul: 'Kedaluwarsa', render: (x) => tgl(x.tanggal_kadaluarsa, true) },
    ], d.akan_kadaluarsa, { kosongTeks: 'Tidak ada dokumen yang akan kedaluwarsa ✓' })),
    panelTabel(`Melewati Masa Retensi (${d.melewati_retensi.length})`, tabel([
      { judul: 'Judul', kunci: 'judul' },
      { judul: 'Kategori', render: (x) => judul(x.kategori) },
      { judul: 'Dibuat', render: (x) => tgl(x.created_at) },
      { judul: 'Retensi', render: (x) => `${x.retensi_tahun} tahun` },
    ], d.melewati_retensi, { kosongTeks: 'Tidak ada dokumen yang melewati masa retensi ✓' })),
  ]);
}
