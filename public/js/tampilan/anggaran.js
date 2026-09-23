/**
 * Modul 10 - Anggaran (RKAP) & analisis varians.
 */
import {
  api, el, kpi, panel, panelTabel, tabel, rp, angka, persen, tgl, status, judul, modal,
  kolom, input, pilih, bacaForm, toast, galat, memuat, kosongkan, bilah, konfirmasi,
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
          { judul: 'Status', render: (a) => el('div', [
            status(a.status),
            a.status === 'ditolak' && a.catatan_revisi && el('div.kecil.neg', a.catatan_revisi),
          ]) },
          { judul: '', render: (a) => (dapatDiubah(a) ? el('div.gap8', { onclick: (e) => e.stopPropagation() }, [
            izin('anggaran.update') && el('button.btn.kecil', { onclick: () => formAnggaran(muat, a.id) }, 'Ubah'),
            izin('anggaran.delete') && el('button.btn.kecil.polos', { onclick: () => hapusAnggaran(a, muat) }, 'Hapus'),
          ].filter(Boolean)) : '') },
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

/** Hanya anggaran draft / ditolak yang boleh direvisi atau dihapus. */
const dapatDiubah = (a) => ['draft', 'ditolak'].includes(a.status);

async function hapusAnggaran(a, saatSelesai) {
  if (!await konfirmasi(`Hapus anggaran "${a.nama}" (${a.tahun}) beserta seluruh rinciannya?`,
    { judul: 'Hapus Anggaran', ya: 'Hapus', jenis: 'bahaya' })) return;
  try {
    await api.del(`/api/anggaran/${a.id}`);
    toast('Anggaran dihapus', 'sukses');
    saatSelesai?.();
  } catch (err) { galat(err); }
}

function formTolak(a) {
  const form = el('div', [
    el('div.kecil.lembut.mb8', 'Anggaran dikembalikan ke penyusun untuk diperbaiki. Catatan ini tampil '
      + 'pada anggaran sampai direvisi.'),
    kolom('Catatan Revisi', el('textarea', { name: 'catatan', rows: 4 }), { wajib: true }),
  ]);
  const tutup = modal({
    judul: `Tolak RKAP — ${a.nama}`, isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.bahaya', { onclick: async (e) => {
        const tombol = e.currentTarget;
        const { catatan } = bacaForm(form);
        if (!catatan.trim()) { toast('Catatan revisi wajib diisi', 'peringatan'); return; }
        tombol.disabled = true;
        try {
          await api.post(`/api/anggaran/${a.id}/tolak`, { catatan });
          toast('Anggaran ditolak dan dikembalikan untuk revisi', 'sukses');
          tutup(); navigasi(location.hash, true);
        } catch (err) { galat(err); tombol.disabled = false; }
      } }, 'Tolak Anggaran'),
    ],
  });
}

async function realisasi(id) {
  const d = await api.get(`/api/anggaran/${id}/realisasi`);
  const wadah = el('div');
  const a = d.anggaran;

  wadah.append(el('div.gap8.mb16', [
    el('button.btn', { onclick: () => { location.hash = '#/anggaran'; } }, '← Kembali'),
    izin('anggaran.approve') && a.status !== 'disetujui' && el('button.btn.sukses', {
      onclick: async (e) => {
        const tombol = e.currentTarget;
        tombol.disabled = true;
        try {
          await api.post(`/api/anggaran/${id}/setujui`, {});
          toast('Anggaran disetujui', 'sukses');
          navigasi(location.hash, true);
        } catch (err) { galat(err); tombol.disabled = false; }
      },
    }, '✓ Setujui RKAP'),
    izin('anggaran.approve') && !['disetujui', 'ditolak'].includes(a.status) && el('button.btn.bahaya', {
      onclick: () => formTolak(a),
    }, '✕ Tolak'),
    izin('anggaran.update') && dapatDiubah(a) && el('button.btn', {
      onclick: () => formAnggaran(() => navigasi(location.hash, true), a.id),
    }, 'Ubah'),
    izin('anggaran.delete') && dapatDiubah(a) && el('button.btn', {
      onclick: () => hapusAnggaran(a, () => { location.hash = '#/anggaran'; }),
    }, 'Hapus'),
    el('button.btn', { onclick: () => window.print() }, 'Cetak'),
  ].filter(Boolean)));

  if (a.status === 'ditolak') {
    wadah.append(el('div.notis.bahaya', [el('div.isi', [
      el('strong', 'Anggaran ditolak — perlu revisi'),
      el('div.kecil', a.catatan_revisi || 'Tidak ada catatan.'),
    ])]));
  }

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
    { judul: 'Anggaran', kunci: 'anggaran', angka: true, render: (r) => rp(r.anggaran) },
    { judul: 'Realisasi', kunci: 'realisasi', angka: true, render: (r) => rp(r.realisasi) },
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

const NAMA_BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/** Menyusun RKAP baru, atau merevisi anggaran draft/ditolak bila `id` diberikan. */
async function formAnggaran(saatSelesai, id = null) {
  let coa;
  let unit;
  let lama = null;
  try {
    [coa, unit, lama] = await Promise.all([
      api.get('/api/master/coa', { limit: 1000 }), api.get('/api/master/unit-usaha'),
      id ? api.get(`/api/anggaran/${id}`) : null,
    ]);
  } catch (err) { galat(err); return; }
  // Akun yang sudah dipakai rincian lama tetap ditampilkan walau kini nonaktif.
  const dipakai = new Set((lama?.detail || []).map((d) => d.coa_kode));
  const akun = coa.data.filter((c) => dipakai.has(c.kode) || (c.is_postable && c.status === 'aktif'
    && ['pendapatan', 'beban'].includes(c.tipe)));
  const baris = lama?.detail?.length
    ? lama.detail.map((d) => ({ coa_kode: d.coa_kode, bulan: d.bulan || 0, nominal: d.nominal, keterangan: d.keterangan }))
    : [{}];
  const daftar = el('div');
  const ringkas = el('div.antara.mt8');
  const tahunDepan = new Date().getFullYear() + 1;

  const hitung = () => kosongkan(ringkas).append(
    el('span.lembut', `${baris.filter((b) => b.coa_kode && b.nominal > 0).length} baris terisi`),
    el('strong', `Total ${rp(baris.reduce((s, b) => s + (Number(b.nominal) || 0), 0))}`));

  function gambar() {
    kosongkan(daftar);
    baris.forEach((b, i) => {
      daftar.append(el('div', { gaya: { display: 'grid', gap: '8px', marginBottom: '8px',
        gridTemplateColumns: 'minmax(0,2.6fr) minmax(0,0.9fr) minmax(0,1.3fr) auto', alignItems: 'center' } }, [
        el('select', { onchange: (e) => { b.coa_kode = e.target.value; hitung(); } },
          [el('option', { value: '' }, '- pilih akun -'),
            ...akun.map((c) => el('option', { value: c.kode, selected: c.kode === b.coa_kode },
              `${c.kode} — ${c.nama} (${c.tipe})`))]),
        el('select', { title: 'Bulan anggaran', onchange: (e) => { b.bulan = Number(e.target.value); } },
          [el('option', { value: 0, selected: !b.bulan }, 'Setahun'),
            ...NAMA_BULAN.map((n, m) => el('option', { value: m + 1, selected: b.bulan === m + 1 }, n))]),
        el('input', { type: 'number', class: 'angka', placeholder: 'Nominal', min: 0,
          nilai: b.nominal || '', oninput: (e) => { b.nominal = Number(e.target.value) || 0; hitung(); } }),
        el('button.btn.kecil.polos', { disabled: baris.length <= 1,
          onclick: () => { baris.splice(i, 1); gambar(); } }, '✕'),
      ]));
    });
    hitung();
  }
  gambar();

  const form = el('div', [
    lama?.status === 'ditolak' && lama.catatan_revisi && el('div.notis.bahaya', [el('div.isi', [
      el('strong', 'Catatan revisi'), el('div.kecil', lama.catatan_revisi),
    ])]),
    el('div.baris-form.k3', [
      kolom('Tahun', input('tahun', { tipe: 'number', nilai: lama?.tahun || tahunDepan }), { wajib: true }),
      kolom('Nama Anggaran', input('nama', { nilai: lama?.nama || `RKAP Tahun ${tahunDepan}` }), { wajib: true }),
      kolom('Unit Usaha', pilih('unit_usaha_id', [{ nilai: '', teks: 'Seluruh unit' },
        ...unit.data.map((u) => ({ nilai: u.id, teks: u.nama }))], lama?.unit_usaha_id ?? '')),
    ]),
    kolom('Keterangan', input('keterangan', { nilai: lama?.keterangan || '' })),
    el('div.tebal.mt16.mb8', 'Rincian Anggaran per Akun'),
    daftar,
    el('button.btn.kecil', { onclick: () => { baris.push({}); gambar(); } }, '+ Tambah Baris'),
    ringkas,
    lama && el('div.kecil.lembut.mt8', 'Menyimpan revisi mengembalikan status anggaran menjadi draft.'),
  ].filter(Boolean));

  const tutup = modal({
    judul: lama ? `Revisi RKAP — ${lama.nama}` : 'Susun RKAP', lebar: 'lebar', isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async (e) => {
        const tombol = e.currentTarget;
        tombol.disabled = true;
        try {
          const data = { ...bacaForm(form), cabang_id: lama?.cabang_id ?? null,
            detail: baris.filter((b) => b.coa_kode && b.nominal > 0) };
          if (lama) await api.put(`/api/anggaran/${lama.id}`, data);
          else await api.post('/api/anggaran', data);
          toast(lama ? 'Revisi anggaran tersimpan' : 'RKAP berhasil disusun', 'sukses');
          tutup(); saatSelesai?.();
        } catch (err) { galat(err); tombol.disabled = false; }
      } }, 'Simpan'),
    ],
  });
}
