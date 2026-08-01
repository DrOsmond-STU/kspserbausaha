/**
 * Modul 22 - Enterprise Risk Management.
 */
import {
  api, el, kpi, panel, panelTabel, tabel, angka, judul, tgl, status, modal, kolom, input,
  pilih, bacaForm, toast, galat, memuat, kosongkan, desimal,
} from '../inti.js';
import { izin } from '../app.js';

const KATEGORI = ['kredit', 'likuiditas', 'operasional', 'kepatuhan', 'strategis', 'reputasi', 'teknologi'];
const kelasLevel = (l) => ({ rendah: 'st-sukses', sedang: 'st-peringatan',
  tinggi: 'st-bahaya', ekstrem: 'st-bahaya' }[l] || 'st-netral');

export async function render() {
  const wadah = el('div');
  async function muat() {
    kosongkan(wadah).append(memuat());
    try {
      const [m, d] = await Promise.all([api.get('/api/risiko/matriks'), api.get('/api/risiko')]);
      kosongkan(wadah).append(
        el('div.grid.k4.mb16', [
          kpi('Risiko Ekstrem', angka(m.ringkasan.ekstrem), { jenis: m.ringkasan.ekstrem ? 'bahaya' : 'sukses' }),
          kpi('Risiko Tinggi', angka(m.ringkasan.tinggi), { jenis: m.ringkasan.tinggi ? 'bahaya' : 'sukses' }),
          kpi('Risiko Sedang', angka(m.ringkasan.sedang), { jenis: 'peringatan' }),
          kpi('Risiko Rendah', angka(m.ringkasan.rendah), { jenis: 'sukses' }),
        ]),

        el('div.notis.info', [el('div.isi', [
          el('strong', 'Matriks risiko 5×5'),
          el('div.kecil', 'Skor risiko = kemungkinan (likelihood) × dampak (impact). '
            + 'Risiko inheren adalah risiko sebelum pengendalian; risiko residual adalah risiko '
            + 'yang tersisa setelah pengendalian berjalan.'),
        ])]),

        panel('Matriks Risiko Inheren', el('div', [
          el('div.matriks', [
            el('div.tepi', ''),
            ...[1, 2, 3, 4, 5].map((i) => el('div.tepi', `Dampak ${i}`)),
            ...m.matriks.flatMap((brs, bi) => [
              el('div.tepi', `Kemungkinan ${5 - bi}`),
              ...brs.map((sel) => el(`div.sel.m-${sel.level}`, [
                el('div', { gaya: { fontSize: '13px' } }, sel.risiko.length || ''),
                sel.risiko.length ? el('div', { gaya: { fontSize: '9.5px', lineHeight: '1.25' } },
                  sel.risiko.map((r) => r.kode).join(', ')) : null,
              ])),
            ]),
          ]),
          el('div.legenda', [
            el('span', [el('i', { gaya: { background: '#86efac' } }), 'Rendah (1-5)']),
            el('span', [el('i', { gaya: { background: '#fde047' } }), 'Sedang (6-11)']),
            el('span', [el('i', { gaya: { background: '#fdba74' } }), 'Tinggi (12-19)']),
            el('span', [el('i', { gaya: { background: '#fca5a5' } }), 'Ekstrem (20-25)']),
          ]),
        ])),

        m.kri_terlampaui.length ? panelTabel(
          `Key Risk Indicator Terlampaui (${m.kri_terlampaui.length})`, tabel([
            { judul: 'Kode', render: (k) => el('span.mono.kecil', k.kode) },
            { judul: 'Risiko', kunci: 'nama' },
            { judul: 'Indikator', kunci: 'kri' },
            { judul: 'Ambang Batas', angka: true, render: (k) => desimal(k.ambang) },
            { judul: 'Nilai Terkini', angka: true, render: (k) => el('span.neg', desimal(k.nilai)) },
          ], m.kri_terlampaui)) : null,

        panelTabel('Risk Register', tabel([
          { judul: 'Kode', render: (r) => el('span.mono.kecil', r.kode) },
          { judul: 'Risiko', render: (r) => el('div', [
            el('div.tebal', r.nama),
            r.deskripsi && el('div.kecil.samar', String(r.deskripsi).slice(0, 80))]) },
          { judul: 'Kategori', render: (r) => status('netral', judul(r.kategori)) },
          { judul: 'L × D', angka: true, render: (r) => `${r.likelihood} × ${r.impact}` },
          { judul: 'Inheren', render: (r) => el(`span.lencana-status.${kelasLevel(r.level_inheren)}`,
            `${r.skor_inheren} — ${judul(r.level_inheren)}`) },
          { judul: 'Residual', render: (r) => el(`span.lencana-status.${kelasLevel(r.level_residu)}`,
            `${r.skor_residu} — ${judul(r.level_residu)}`) },
          { judul: 'Kontrol', render: (r) => judul(r.efektivitas_kontrol || '-') },
          { judul: 'PIC', render: (r) => el('span.kecil', r.pic || '-') },
          { judul: '', render: (r) => (izin('risiko.update')
            ? el('button.btn.kecil', { onclick: (e) => { e.stopPropagation(); form(r, muat); } }, 'Ubah') : '') },
        ], d.data, { saatKlik: (r) => lihat(r), kosongTeks: 'Belum ada risiko teridentifikasi' }), [
          izin('risiko.create') && el('button.btn.utama', { onclick: () => form(null, muat) },
            '+ Identifikasi Risiko'),
        ].filter(Boolean)),
      );
    } catch (err) { galat(err); }
  }
  await muat();
  return wadah;
}

function lihat(r) {
  modal({
    judul: `${r.kode} — ${r.nama}`, lebar: 'lebar',
    isi: el('dl.deskripsi', [
      el('dt', 'Kategori'), el('dd', judul(r.kategori)),
      el('dt', 'Deskripsi'), el('dd', r.deskripsi || '-'),
      el('dt', 'Penyebab'), el('dd', r.penyebab || '-'),
      el('dt', 'Dampak'), el('dd', r.dampak_deskripsi || '-'),
      el('dt', 'Risiko inheren'), el('dd', `${r.likelihood} × ${r.impact} = ${r.skor_inheren} `
        + `(${judul(r.level_inheren)})`),
      el('dt', 'Pengendalian'), el('dd', r.kontrol || '-'),
      el('dt', 'Efektivitas kontrol'), el('dd', judul(r.efektivitas_kontrol || '-')),
      el('dt', 'Risiko residual'), el('dd', `${r.likelihood_residu} × ${r.impact_residu} = ${r.skor_residu} `
        + `(${judul(r.level_residu)})`),
      el('dt', 'Rencana mitigasi'), el('dd', r.mitigasi || '-'),
      el('dt', 'PIC'), el('dd', r.pic || '-'),
      el('dt', 'Key Risk Indicator'), el('dd', r.kri_nama
        ? `${r.kri_nama} — ambang ${desimal(r.kri_ambang)}, nilai terkini ${desimal(r.kri_nilai)}` : '-'),
      el('dt', 'Review terakhir'), el('dd', r.review_terakhir ? tgl(r.review_terakhir, true) : '-'),
    ]),
  });
}

function form(data, saatSelesai) {
  const skala = [1, 2, 3, 4, 5].map((n) => ({ nilai: n, teks: `${n}` }));
  const f = el('div', [
    el('div.baris-form.k3', [
      kolom('Kode Risiko', input('kode', { nilai: data?.kode || '' }), { wajib: true }),
      kolom('Kategori', pilih('kategori', KATEGORI.map((k) => ({ nilai: k, teks: judul(k) })),
        data?.kategori), { wajib: true }),
      kolom('PIC', input('pic', { nilai: data?.pic || '' })),
    ]),
    kolom('Nama Risiko', input('nama', { nilai: data?.nama || '' }), { wajib: true }),
    kolom('Deskripsi', el('textarea', { name: 'deskripsi' }, data?.deskripsi || '')),
    el('div.baris-form', [
      kolom('Penyebab', el('textarea', { name: 'penyebab' }, data?.penyebab || '')),
      kolom('Dampak', el('textarea', { name: 'dampak_deskripsi' }, data?.dampak_deskripsi || '')),
    ]),
    el('div.tebal.mt16.mb8', 'Penilaian Risiko Inheren'),
    el('div.baris-form', [
      kolom('Kemungkinan (1-5)', pilih('likelihood', skala, data?.likelihood || 3)),
      kolom('Dampak (1-5)', pilih('impact', skala, data?.impact || 3)),
    ]),
    kolom('Pengendalian yang Ada', el('textarea', { name: 'kontrol' }, data?.kontrol || '')),
    el('div.tebal.mt16.mb8', 'Penilaian Risiko Residual'),
    el('div.baris-form.k3', [
      kolom('Efektivitas Kontrol', pilih('efektivitas_kontrol', ['lemah', 'sedang', 'kuat']
        .map((s) => ({ nilai: s, teks: judul(s) })), data?.efektivitas_kontrol)),
      kolom('Kemungkinan Residual', pilih('likelihood_residu', skala, data?.likelihood_residu || 2)),
      kolom('Dampak Residual', pilih('impact_residu', skala, data?.impact_residu || 2)),
    ]),
    kolom('Rencana Mitigasi', el('textarea', { name: 'mitigasi' }, data?.mitigasi || '')),
    el('div.baris-form.k3', [
      kolom('Nama KRI', input('kri_nama', { nilai: data?.kri_nama || '' })),
      kolom('Ambang Batas KRI', input('kri_ambang', { tipe: 'number', step: 'any',
        nilai: data?.kri_ambang ?? '' })),
      kolom('Nilai KRI Terkini', input('kri_nilai', { tipe: 'number', step: 'any',
        nilai: data?.kri_nilai ?? '' })),
    ]),
  ]);

  const tutup = modal({
    judul: data ? `Ubah Risiko — ${data.kode}` : 'Identifikasi Risiko Baru', lebar: 'lebar', isi: f,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async (e) => {
        e.currentTarget.disabled = true;
        try {
          if (data) await api.put(`/api/risiko/${data.id}`, bacaForm(f));
          else await api.post('/api/risiko', bacaForm(f));
          toast('Data risiko tersimpan', 'sukses');
          tutup(); saatSelesai?.();
        } catch (err) { galat(err); e.currentTarget.disabled = false; }
      } }, 'Simpan'),
    ],
  });
}
