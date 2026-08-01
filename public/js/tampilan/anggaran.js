/**
 * Modul 10 - Anggaran (RKAP) & analisis varians.
 */
import {
  api, el, kpi, panel, panelTabel, tabel, rp, angka, persen, tgl, status, judul, modal,
  kolom, input, pilih, bacaForm, toast, galat, memuat, kosongkan, bilah,
} from '../inti.js';
import { izin, navigasi } from '../app.js';

export async function render(param) {
  if (param[0]) return realisasi(Number(param[0]));

  const wadah = el('div');
  async function muat() {
    kosongkan(wadah).append(memuat());
    try {
      const d = await api.get('/api/anggaran');
      kosongkan(wadah).append(
        el('div.notis.info', [el('div.isi', [
          el('strong', 'Rencana Kerja dan Anggaran Pendapatan Belanja Koperasi (RKAP)'),
          el('div.kecil', 'RKAP disusun pengurus dan disahkan dalam Rapat Anggota Tahunan. '
            + 'Realisasi dibandingkan otomatis terhadap buku besar.'),
        ])]),
        panelTabel('Daftar Anggaran', tabel([
          { judul: 'Tahun', render: (a) => el('strong', a.tahun) },
          { judul: 'Nama', kunci: 'nama' },
          { judul: 'Unit Usaha', render: (a) => a.unit_nama || el('span.samar', 'Seluruh unit') },
          { judul: 'Total Anggaran', angka: true, render: (a) => rp(a.total) },
          { judul: 'Disetujui Oleh', render: (a) => el('span.kecil', a.disetujui_oleh || '-') },
          { judul: 'Status', render: (a) => status(a.status) },
        ], d.data, { saatKlik: (a) => { location.hash = `#/anggaran/${a.id}`; },
          kosongTeks: 'Belum ada anggaran tersusun' }), [
          izin('anggaran.create') && el('button.btn.utama', { onclick: () => formAnggaran(muat) },
            '+ Susun RKAP'),
        ].filter(Boolean)),
      );
    } catch (err) { galat(err); }
  }
  await muat();
  return wadah;
}

async function realisasi(id) {
  const d = await api.get(`/api/anggaran/${id}/realisasi`);
  const wadah = el('div');
  const a = d.anggaran;

  wadah.append(el('div.gap8.mb16', [
    el('button.btn', { onclick: () => { location.hash = '#/anggaran'; } }, '← Kembali'),
    izin('anggaran.approve') && a.status !== 'disetujui' && el('button.btn.sukses', {
      onclick: async () => {
        try {
          await api.post(`/api/anggaran/${id}/setujui`, {});
          toast('Anggaran disetujui', 'sukses');
          navigasi(location.hash, true);
        } catch (err) { galat(err); }
      },
    }, '✓ Setujui RKAP'),
    el('button.btn', { onclick: () => window.print() }, 'Cetak'),
  ].filter(Boolean)));

  wadah.append(el('div.grid.k4.mb16', [
    kpi('Tahun', a.tahun),
    kpi('Total Anggaran', rp(d.total_anggaran)),
    kpi('Total Realisasi', rp(d.total_realisasi)),
    kpi('Status', judul(a.status)),
  ]));

  wadah.append(panelTabel(`Realisasi Anggaran — ${a.nama} (s.d. ${tgl(d.per_tanggal, true)})`, tabel([
    { judul: 'Kode', render: (r) => el('span.mono.kecil', r.coa_kode) },
    { judul: 'Akun', kunci: 'akun_nama' },
    { judul: 'Tipe', render: (r) => judul(r.tipe) },
    { judul: 'Anggaran', angka: true, render: (r) => rp(r.anggaran) },
    { judul: 'Realisasi', angka: true, render: (r) => rp(r.realisasi) },
    { judul: 'Selisih', angka: true, render: (r) => el(r.selisih >= 0 ? 'span.pos' : 'span.neg', rp(r.selisih)) },
    { judul: 'Capaian', render: (r) => el('div', { gaya: { minWidth: '120px' } }, [
      el('div.kecil', persen(r.persen_realisasi)),
      bilah(Math.min(r.persen_realisasi, 150), 150,
        r.tipe === 'beban'
          ? (r.persen_realisasi > 100 ? 'bahaya' : 'sukses')
          : (r.persen_realisasi >= 100 ? 'sukses' : r.persen_realisasi >= 75 ? '' : 'peringatan')),
    ]) },
    { judul: 'Keterangan', render: (r) => el('span.kecil.lembut', r.status) },
  ], d.baris, {
    kaki: { akun_nama: 'TOTAL', anggaran: rp(d.total_anggaran), realisasi: rp(d.total_realisasi) },
  })));

  return wadah;
}

async function formAnggaran(saatSelesai) {
  const [coa, unit] = await Promise.all([
    api.get('/api/master/coa', { limit: 500 }), api.get('/api/master/unit-usaha'),
  ]);
  const akun = coa.data.filter((c) => c.is_postable && ['pendapatan', 'beban'].includes(c.tipe));
  const baris = [{}];
  const daftar = el('div');

  function gambar() {
    kosongkan(daftar);
    baris.forEach((b, i) => {
      daftar.append(el('div', { gaya: { display: 'grid', gap: '8px', marginBottom: '8px',
        gridTemplateColumns: 'minmax(0,2.6fr) minmax(0,1.3fr) auto', alignItems: 'center' } }, [
        el('select', { onchange: (e) => { b.coa_kode = e.target.value; } },
          [el('option', { value: '' }, '- pilih akun -'),
            ...akun.map((c) => el('option', { value: c.kode, selected: c.kode === b.coa_kode },
              `${c.kode} — ${c.nama} (${c.tipe})`))]),
        el('input', { type: 'number', class: 'angka', placeholder: 'Nominal setahun', min: 0,
          nilai: b.nominal || '', oninput: (e) => { b.nominal = Number(e.target.value) || 0; } }),
        el('button.btn.kecil.polos', { disabled: baris.length <= 1,
          onclick: () => { baris.splice(i, 1); gambar(); } }, '✕'),
      ]));
    });
  }
  gambar();

  const form = el('div', [
    el('div.baris-form.k3', [
      kolom('Tahun', input('tahun', { tipe: 'number', nilai: new Date().getFullYear() + 1 }), { wajib: true }),
      kolom('Nama Anggaran', input('nama', { nilai: `RKAP Tahun ${new Date().getFullYear() + 1}` }), { wajib: true }),
      kolom('Unit Usaha', pilih('unit_usaha_id', [{ nilai: '', teks: 'Seluruh unit' },
        ...unit.data.map((u) => ({ nilai: u.id, teks: u.nama }))])),
    ]),
    kolom('Keterangan', input('keterangan')),
    el('div.tebal.mt16.mb8', 'Rincian Anggaran per Akun'),
    daftar,
    el('button.btn.kecil', { onclick: () => { baris.push({}); gambar(); } }, '+ Tambah Baris'),
  ]);

  const tutup = modal({
    judul: 'Susun RKAP', lebar: 'lebar', isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async (e) => {
        e.currentTarget.disabled = true;
        try {
          await api.post('/api/anggaran', {
            ...bacaForm(form), detail: baris.filter((b) => b.coa_kode && b.nominal > 0) });
          toast('RKAP berhasil disusun', 'sukses');
          tutup(); saatSelesai?.();
        } catch (err) { galat(err); e.currentTarget.disabled = false; }
      } }, 'Simpan'),
    ],
  });
}
