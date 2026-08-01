/**
 * Modul 4 - Simpanan.
 */
import {
  api, el, kpi, panel, panelTabel, tabel, rp, rpRingkas, angka, tgl, status, judul, modal,
  kolom, input, pilih, bacaForm, toast, galat, memuat, kosongkan, periodeLabel, hariIni,
} from '../inti.js';
import { grafikGaris } from '../grafik.js';
import { izin, navigasi } from '../app.js';
import { ikon } from '../ikon.js';

export async function render(param) {
  if (param[0]) return detail(Number(param[0]));

  const r = await api.get('/api/simpanan/ringkasan');
  const wadah = el('div');

  wadah.append(el('div.grid.k3.mb16', [
    kpi('Total Simpanan', rpRingkas(r.total_simpanan), { catatan: rp(r.total_simpanan), ikon: ikon('dompet') }),
    kpi('Jumlah Rekening', angka(r.jumlah_rekening), { ikon: ikon('buku') }),
    kpi('Jumlah Penyimpan', angka(r.jumlah_penyimpan), { catatan: 'Anggota dengan rekening aktif', ikon: ikon('anggota') }),
  ]));

  wadah.append(panel('Mutasi Simpanan Bulanan', grafikGaris({
    label: r.mutasi_bulanan.map((m) => periodeLabel(m.periode).replace(/ \d{4}$/, '')),
    seri: [
      { nama: 'Setoran', data: r.mutasi_bulanan.map((m) => m.setoran) },
      { nama: 'Penarikan', data: r.mutasi_bulanan.map((m) => m.penarikan) },
    ],
    tinggi: 230,
  })));

  wadah.append(panelTabel('Komposisi per Produk', tabel([
    { judul: 'Kode', render: (x) => el('span.mono', x.kode) },
    { judul: 'Produk', kunci: 'nama' },
    { judul: 'Jenis', render: (x) => judul(x.jenis) },
    { judul: 'Rekening', angka: true, render: (x) => angka(x.jumlah_rekening) },
    { judul: 'Saldo', kunci: 'saldo', angka: true, render: (x) => el('strong', rp(x.saldo)) },
  ], r.per_produk, {
    kaki: { nama: 'TOTAL', saldo: rp(r.per_produk.reduce((s, x) => s + x.saldo, 0)) },
  })));

  // ------------------------------ Rekening ------------------------------
  const daftar = el('div');
  wadah.append(daftar);
  let q = '';

  async function muat() {
    kosongkan(daftar).append(memuat());
    try {
      const d = await api.get('/api/simpanan/rekening', { q, limit: 100 });
      kosongkan(daftar).append(panelTabel(`Rekening Simpanan (${angka(d.total)})`, tabel([
        { judul: 'No. Rekening', render: (x) => el('span.mono', x.nomor_rekening) },
        { judul: 'Anggota', render: (x) => el('div', [
          el('div.tebal', x.anggota_nama),
          el('div.kecil.samar', x.nomor_anggota),
        ]) },
        { judul: 'Produk', render: (x) => el('div', [
          el('div', x.produk_nama),
          x.bunga_tahunan > 0 && el('div.kecil.samar', `Jasa ${x.bunga_tahunan}% p.a.`),
        ]) },
        { judul: 'Saldo', angka: true, render: (x) => el('strong', rp(x.saldo)) },
        { judul: 'Diblokir', angka: true, render: (x) => (x.saldo_blokir
          ? el('span.neg', rp(x.saldo_blokir)) : el('span.samar', '-')) },
        { judul: 'Status', render: (x) => status(x.status) },
      ], d.data, { saatKlik: (x) => { location.hash = `#/simpanan/${x.id}`; } }), [
        el('input', { type: 'search', placeholder: 'Cari nomor rekening atau nama anggota…',
          oninput: (e) => { q = e.target.value; clearTimeout(muat.t); muat.t = setTimeout(muat, 320); } }),
        izin('simpanan.create') && el('button.btn', { onclick: () => formRekening(muat) }, '+ Buka Rekening'),
        izin('simpanan.create') && el('button.btn.utama', { onclick: () => formTransaksi('setoran', null, muat) }, '↓ Setoran'),
        izin('simpanan.create') && el('button.btn', { onclick: () => formTransaksi('penarikan', null, muat) }, '↑ Penarikan'),
        izin('simpanan.post') && el('button.btn', { onclick: () => formBunga(muat) }, 'Posting Jasa Simpanan'),
      ]));
    } catch (err) { galat(err); }
  }
  await muat();
  return wadah;
}

// ------------------------------- Detail -------------------------------

async function detail(id) {
  const r = await api.get(`/api/simpanan/rekening/${id}`);
  const wadah = el('div');

  wadah.append(el('div.gap8.mb16', [
    el('button.btn', { onclick: () => { location.hash = '#/simpanan'; } }, '← Kembali'),
    izin('simpanan.create') && r.status === 'aktif'
      && el('button.btn.utama', { onclick: () => formTransaksi('setoran', r, () => navigasi(location.hash, true)) }, '↓ Setoran'),
    izin('simpanan.create') && r.status === 'aktif' && r.boleh_tarik
      && el('button.btn', { onclick: () => formTransaksi('penarikan', r, () => navigasi(location.hash, true)) }, '↑ Penarikan'),
    el('button.btn', { onclick: () => window.print() }, 'Cetak Buku'),
  ].filter(Boolean)));

  wadah.append(el('div.grid.k4.mb16', [
    kpi('Saldo', rp(r.saldo), { jenis: 'sukses' }),
    kpi('Saldo Diblokir', rp(r.saldo_blokir), { catatan: 'Agunan pinjaman' }),
    kpi('Saldo Tersedia', rp(r.saldo_tersedia)),
    kpi('Jasa Simpanan', `${r.bunga_tahunan}% p.a.`),
  ]));

  wadah.append(panel('Informasi Rekening', el('dl.deskripsi', [
    el('dt', 'Nomor rekening'), el('dd', el('span.mono', r.nomor_rekening)),
    el('dt', 'Pemilik'), el('dd', el('a', { href: `#/anggota/${r.anggota_id}` },
      `${r.anggota_nama} (${r.nomor_anggota})`)),
    el('dt', 'Produk'), el('dd', `${r.produk_nama} — ${judul(r.jenis)}`),
    el('dt', 'Tanggal buka'), el('dd', tgl(r.tanggal_buka, true)),
    r.tanggal_jatuh_tempo && el('dt', 'Jatuh tempo'),
    r.tanggal_jatuh_tempo && el('dd', tgl(r.tanggal_jatuh_tempo, true)),
    el('dt', 'Dapat ditarik'), el('dd', r.boleh_tarik ? 'Ya' : 'Tidak (simpanan pokok/wajib)'),
    el('dt', 'Status'), el('dd', status(r.status)),
  ].filter(Boolean))));

  wadah.append(panelTabel('Mutasi Rekening', tabel([
    { judul: 'Tanggal', render: (m) => tgl(m.tanggal) },
    { judul: 'Nomor', render: (m) => el('span.mono.kecil', m.nomor) },
    { judul: 'Jenis', render: (m) => status(m.jenis === 'setoran' ? 'aktif' : m.jenis === 'penarikan' ? 'peringatan' : 'info', judul(m.jenis)) },
    { judul: 'Keterangan', render: (m) => el('span.kecil.lembut', m.keterangan || '-') },
    { judul: 'Setoran', angka: true, render: (m) => (m.kredit ? el('span.pos', rp(m.kredit)) : '-') },
    { judul: 'Penarikan', angka: true, render: (m) => (m.debit ? el('span.neg', rp(m.debit)) : '-') },
    { judul: 'Saldo', angka: true, render: (m) => el('strong', rp(m.saldo_akhir)) },
  ], r.mutasi, { kosongTeks: 'Belum ada mutasi' })));

  return wadah;
}

// ------------------------------ Formulir ------------------------------

async function formRekening(saatSelesai) {
  const [anggota, produk] = await Promise.all([
    api.get('/api/anggota', { status: 'aktif', limit: 500 }),
    api.get('/api/master/produk-simpanan'),
  ]);
  const form = el('div', [
    kolom('Anggota', pilih('anggota_id', anggota.data.map((a) => ({
      nilai: a.id, teks: `${a.nomor_anggota} — ${a.nama}` }))), { wajib: true }),
    kolom('Produk Simpanan', pilih('produk_id', produk.data.map((p) => ({
      nilai: p.id, teks: `${p.nama} (min. ${rp(p.setoran_minimal)})` }))), { wajib: true }),
    el('div.baris-form', [
      kolom('Tanggal Buka', input('tanggal_buka', { tipe: 'date', nilai: hariIni() })),
      kolom('Setoran Awal', input('setoran_awal', { tipe: 'number', min: 0, nilai: 0 })),
    ]),
  ]);
  const tutup = modal({
    judul: 'Buka Rekening Simpanan', isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async (e) => {
        e.currentTarget.disabled = true;
        try {
          await api.post('/api/simpanan/rekening', bacaForm(form));
          toast('Rekening berhasil dibuka', 'sukses');
          tutup(); saatSelesai?.();
        } catch (err) { galat(err); e.currentTarget.disabled = false; }
      } }, 'Buka Rekening'),
    ],
  });
}

async function formTransaksi(jenis, rekening, saatSelesai) {
  let pilihRek = null;
  if (!rekening) {
    const d = await api.get('/api/simpanan/rekening', { status: 'aktif', limit: 500 });
    pilihRek = kolom('Rekening', pilih('rekening_id', d.data.map((x) => ({
      nilai: x.id, teks: `${x.nomor_rekening} — ${x.anggota_nama} (${x.produk_nama}) · saldo ${rp(x.saldo)}` }))),
    { wajib: true });
  }
  const form = el('div', [
    pilihRek,
    rekening && el('div.notis.info', [el('div.isi', [
      el('strong', `${rekening.nomor_rekening} — ${rekening.anggota_nama}`),
      el('div.kecil', `${rekening.produk_nama} · saldo tersedia ${rp(rekening.saldo_tersedia ?? rekening.saldo)}`),
    ])]),
    rekening && el('input', { type: 'hidden', name: 'rekening_id', nilai: rekening.id }),
    el('div.baris-form', [
      kolom('Tanggal', input('tanggal', { tipe: 'date', nilai: hariIni() })),
      kolom('Nominal', input('nominal', { tipe: 'number', min: 1, placeholder: '0' }), { wajib: true }),
    ]),
    kolom('Metode', pilih('metode', jenis === 'setoran'
      ? [{ nilai: 'tunai', teks: 'Tunai' }, { nilai: 'transfer', teks: 'Transfer Bank' },
        { nilai: 'potong_gaji', teks: 'Potong Gaji' }]
      : [{ nilai: 'tunai', teks: 'Tunai' }, { nilai: 'transfer', teks: 'Transfer Bank' }])),
    kolom('Keterangan', input('keterangan', { placeholder: 'Opsional' })),
  ].filter(Boolean));

  const tutup = modal({
    judul: jenis === 'setoran' ? 'Setoran Simpanan' : 'Penarikan Simpanan', isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async (e) => {
        e.currentTarget.disabled = true;
        try {
          const h = await api.post(`/api/simpanan/${jenis}`, bacaForm(form));
          toast(`${judul(jenis)} berhasil dicatat`, 'sukses',
            `${h.nomor} · saldo akhir ${rp(h.saldo_akhir)}`);
          tutup(); saatSelesai?.();
        } catch (err) { galat(err); e.currentTarget.disabled = false; }
      } }, `Proses ${judul(jenis)}`),
    ],
  });
}

function formBunga(saatSelesai) {
  const form = el('div', [
    el('div.notis.info', [el('div.isi', [
      el('strong', 'Pembebanan jasa simpanan bulanan'),
      el('div.kecil', 'Jasa dihitung dari saldo akhir tiap rekening × (bunga tahunan ÷ 12) dan '
        + 'langsung menambah saldo anggota serta membentuk jurnal beban.'),
    ])]),
    kolom('Periode', input('periode', { placeholder: 'YYYY-MM',
      nilai: hariIni().slice(0, 7) }), { wajib: true }),
  ]);
  const tutup = modal({
    judul: 'Posting Jasa Simpanan', isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async (e) => {
        e.currentTarget.disabled = true;
        try {
          const h = await api.post('/api/simpanan/bunga', bacaForm(form));
          toast(h.pesan || `Jasa simpanan diposting untuk ${h.jumlah_rekening} rekening`, 'sukses',
            h.total_bunga ? `Total ${rp(h.total_bunga)}` : null);
          tutup(); saatSelesai?.();
        } catch (err) { galat(err); e.currentTarget.disabled = false; }
      } }, 'Posting'),
    ],
  });
}
