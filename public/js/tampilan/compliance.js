/**
 * Modul 20 - Kepatuhan (Compliance).
 */
import {
  api, el, kpi, panel, panelTabel, tabel, angka, tgl, status, judul, modal, kolom, input,
  pilih, bacaForm, toast, galat, memuat, kosongkan, hariIni,
} from '../inti.js';
import { grafikPeringkat } from '../grafik.js';
import { izin, navigasi } from '../app.js';

const KATEGORI = ['legalitas', 'perpajakan', 'ketenagakerjaan', 'perkoperasian', 'oss'];

export async function render() {
  const wadah = el('div');
  async function muat() {
    kosongkan(wadah).append(memuat());
    try {
      const d = await api.get('/api/compliance/dashboard/ringkasan');
      kosongkan(wadah).append(
        el('div.grid.k4.mb16', [
          kpi('Total Kewajiban', angka(d.total), { ikon: '⚖️' }),
          kpi('Patuh', angka(d.patuh), { jenis: 'sukses' }),
          kpi('Perlu Perhatian', angka(d.perlu_perhatian), {
            jenis: d.perlu_perhatian ? 'peringatan' : '', catatan: 'Kedaluwarsa ≤ 90 hari' }),
          kpi('Kedaluwarsa', angka(d.kadaluarsa), { jenis: d.kadaluarsa ? 'bahaya' : 'sukses' }),
        ]),
        el('div.notis.info', [el('div.isi', [
          el('strong', 'Pemantauan kepatuhan koperasi'),
          el('div.kecil', 'Mencakup UU No. 25 Tahun 1992 tentang Perkoperasian, kewajiban perpajakan, '
            + 'ketenagakerjaan, perizinan berusaha (OSS/NIB), serta legalitas badan hukum.'),
        ])]),
        d.segera_kadaluarsa.length ? panelTabel(
          `Perlu Tindak Lanjut Segera (${d.segera_kadaluarsa.length})`, tabel([
            { judul: 'Kewajiban', kunci: 'nama' },
            { judul: 'Kategori', render: (x) => judul(x.kategori) },
            { judul: 'Nomor', render: (x) => el('span.mono.kecil', x.nomor || '-') },
            { judul: 'Berlaku s.d.', render: (x) => tgl(x.tanggal_kadaluarsa, true) },
            { judul: 'Sisa', angka: true, render: (x) => (x.sisa_hari < 0
              ? el('span.neg', `lewat ${-x.sisa_hari} hari`) : el('span.neg', `${x.sisa_hari} hari`)) },
            { judul: 'PIC', render: (x) => el('span.kecil', x.pic || '-') },
          ], d.segera_kadaluarsa)) : null,
        el('div.grid.k2', [
          panel('Sebaran per Kategori', grafikPeringkat({
            baris: d.per_kategori.map((k) => ({ label: judul(k.kategori), nilai: k.jumlah })),
            format: (v) => `${angka(v)} item`,
          })),
          panel('Ringkasan Status', el('div', [
            el('dl.deskripsi', [
              el('dt', 'Patuh'), el('dd', el('span.pos', angka(d.patuh))),
              el('dt', 'Perlu perhatian'), el('dd', angka(d.perlu_perhatian)),
              el('dt', 'Kedaluwarsa'), el('dd', el('span.neg', angka(d.kadaluarsa))),
              el('dt', 'Tingkat kepatuhan'), el('dd', el('strong',
                `${d.total ? ((d.patuh / d.total) * 100).toFixed(1) : 0}%`)),
            ]),
          ])),
        ]),
        panelTabel('Register Kepatuhan', tabel([
          { judul: 'Kategori', render: (x) => status('netral', judul(x.kategori)) },
          { judul: 'Kewajiban', render: (x) => el('div', [
            el('div.tebal', x.nama),
            x.dasar_hukum && el('div.kecil.samar', x.dasar_hukum)]) },
          { judul: 'Nomor', render: (x) => el('span.mono.kecil', x.nomor || '-') },
          { judul: 'Penerbit', render: (x) => el('span.kecil', x.penerbit || '-') },
          { judul: 'Terbit', render: (x) => tgl(x.tanggal_terbit) },
          { judul: 'Berlaku s.d.', render: (x) => (x.tanggal_kadaluarsa
            ? tgl(x.tanggal_kadaluarsa) : el('span.samar', 'permanen')) },
          { judul: 'PIC', render: (x) => el('span.kecil', x.pic || '-') },
          { judul: 'Status', render: (x) => status(x.status_terhitung) },
        ], d.data, { kosongTeks: 'Belum ada register kepatuhan' }), [
          izin('compliance.create') && el('button.btn.utama', { onclick: () => form(null, muat) },
            '+ Tambah Kewajiban'),
        ].filter(Boolean)),
      );
    } catch (err) { galat(err); }
  }
  await muat();
  return wadah;
}

function form(data, saatSelesai) {
  const f = el('div', [
    el('div.baris-form', [
      kolom('Kategori', pilih('kategori', KATEGORI.map((k) => ({ nilai: k, teks: judul(k) })),
        data?.kategori), { wajib: true }),
      kolom('Nama Kewajiban', input('nama', { nilai: data?.nama || '' }), { wajib: true }),
    ]),
    kolom('Dasar Hukum', input('dasar_hukum', { nilai: data?.dasar_hukum || '',
      placeholder: 'contoh: UU No. 25 Tahun 1992 Pasal 30' })),
    el('div.baris-form.k3', [
      kolom('Nomor Dokumen', input('nomor', { nilai: data?.nomor || '' })),
      kolom('Penerbit', input('penerbit', { nilai: data?.penerbit || '' })),
      kolom('PIC', input('pic', { nilai: data?.pic || '' })),
    ]),
    el('div.baris-form.k3', [
      kolom('Tanggal Terbit', input('tanggal_terbit', { tipe: 'date', nilai: data?.tanggal_terbit || '' })),
      kolom('Berlaku Sampai', input('tanggal_kadaluarsa', { tipe: 'date',
        nilai: data?.tanggal_kadaluarsa || '' }), { bantuan: 'Kosongkan bila permanen' }),
      kolom('Status', pilih('status', ['patuh', 'perlu_perhatian', 'tidak_patuh']
        .map((s) => ({ nilai: s, teks: judul(s) })), data?.status)),
    ]),
    kolom('Catatan', el('textarea', { name: 'catatan' }, data?.catatan || '')),
  ]);
  const tutup = modal({
    judul: data ? 'Ubah Kewajiban Kepatuhan' : 'Tambah Kewajiban Kepatuhan', lebar: 'lebar', isi: f,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async (e) => {
        e.currentTarget.disabled = true;
        try {
          if (data) await api.put(`/api/compliance/${data.id}`, bacaForm(f));
          else await api.post('/api/compliance', bacaForm(f));
          toast('Data kepatuhan tersimpan', 'sukses');
          tutup(); saatSelesai?.();
        } catch (err) { galat(err); e.currentTarget.disabled = false; }
      } }, 'Simpan'),
    ],
  });
}
