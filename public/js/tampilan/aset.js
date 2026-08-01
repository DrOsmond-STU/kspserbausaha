/**
 * Modul 16 - Aset Tetap (PSAK 16).
 */
import {
  api, el, kpi, panel, panelTabel, tabel, rp, angka, persen, tgl, status, judul, modal,
  kolom, input, pilih, bacaForm, toast, galat, memuat, kosongkan, hariIni, bilah,
} from '../inti.js';
import { grafikCincin } from '../grafik.js';
import { izin, navigasi } from '../app.js';

export async function render(param) {
  if (param[0]) return detail(Number(param[0]));

  const wadah = el('div');
  const [r, d] = await Promise.all([api.get('/api/aset/ringkasan'), api.get('/api/aset')]);

  wadah.append(el('div.grid.k4.mb16', [
    kpi('Jumlah Aset', angka(r.jumlah_aset), { ikon: '🏗️' }),
    kpi('Harga Perolehan', rp(r.total_perolehan)),
    kpi('Akumulasi Penyusutan', rp(r.total_akumulasi), { jenis: 'peringatan' }),
    kpi('Nilai Buku', rp(r.total_nilai_buku), { jenis: 'sukses' }),
  ]));

  wadah.append(el('div.grid.k2', [
    el('div.panel', [el('div.panel-kepala', [el('h3', 'Komposisi Nilai Buku per Kategori')]),
      el('div.panel-isi', [grafikCincin({
        bagian: r.per_kategori.map((k) => ({ label: judul(k.kategori || 'lainnya'), nilai: k.nilai_buku })),
        tengahLabel: 'Nilai Buku', tengahNilai: rp(r.total_nilai_buku).replace('Rp ', ''),
      })])]),
    panelTabel('Rekapitulasi per Kategori', tabel([
      { judul: 'Kategori', render: (k) => judul(k.kategori || 'lainnya') },
      { judul: 'Unit', angka: true, render: (k) => angka(k.jumlah) },
      { judul: 'Perolehan', angka: true, render: (k) => rp(k.perolehan) },
      { judul: 'Akumulasi', angka: true, render: (k) => rp(k.akumulasi) },
      { judul: 'Nilai Buku', angka: true, render: (k) => el('strong', rp(k.nilai_buku)) },
    ], r.per_kategori)),
  ]));

  if (r.perlu_maintenance.length) {
    wadah.append(panelTabel('Jadwal Pemeliharaan Mendatang', tabel([
      { judul: 'Kode', render: (m) => el('span.mono.kecil', m.kode) },
      { judul: 'Aset', kunci: 'nama' },
      { judul: 'Jadwal Berikutnya', render: (m) => tgl(m.jadwal_berikutnya, true) },
    ], r.perlu_maintenance)));
  }

  wadah.append(panelTabel('Daftar Aset Tetap', tabel([
    { judul: 'Kode', render: (a) => el('span.mono.kecil', a.kode) },
    { judul: 'Nama Aset', kunci: 'nama' },
    { judul: 'Kategori', render: (a) => judul(a.kategori || '-') },
    { judul: 'Perolehan', render: (a) => tgl(a.tanggal_perolehan) },
    { judul: 'Harga', angka: true, render: (a) => rp(a.harga_perolehan) },
    { judul: 'Penyusutan/bln', angka: true, render: (a) => rp(a.penyusutan_per_bulan) },
    { judul: 'Nilai Buku', angka: true, render: (a) => el('strong', rp(a.nilai_buku)) },
    { judul: 'Tersusut', render: (a) => el('div', { gaya: { minWidth: '100px' } }, [
      el('div.kecil', persen(a.persen_tersusut)),
      bilah(a.persen_tersusut, 100, a.persen_tersusut > 85 ? 'peringatan' : ''),
    ]) },
    { judul: 'Status', render: (a) => status(a.status) },
  ], d.data, { saatKlik: (a) => { location.hash = `#/aset/${a.id}`; },
    kosongTeks: 'Belum ada aset tetap terdaftar' }), [
    izin('aset.create') && el('button.btn.utama', { onclick: () => formAset() }, '+ Tambah Aset'),
    izin('aset.post') && el('button.btn', { onclick: () => formPenyusutan() }, '📉 Jalankan Penyusutan'),
  ].filter(Boolean)));

  return wadah;
}

async function detail(id) {
  const a = await api.get(`/api/aset/${id}`);
  const wadah = el('div');

  wadah.append(el('div.gap8.mb16', [
    el('button.btn', { onclick: () => { location.hash = '#/aset'; } }, '← Kembali'),
    izin('aset.update') && a.status === 'aktif' && el('button.btn', {
      onclick: () => formMaintenance(a) }, '🔧 Catat Pemeliharaan'),
    izin('aset.update') && a.status !== 'dilepas' && el('button.btn.bahaya', {
      onclick: () => formDisposal(a) }, '📤 Pelepasan Aset'),
  ].filter(Boolean)));

  wadah.append(el('div.grid.k4.mb16', [
    kpi('Harga Perolehan', rp(a.harga_perolehan)),
    kpi('Akumulasi Penyusutan', rp(a.akumulasi_penyusutan)),
    kpi('Nilai Buku', rp(a.nilai_buku), { jenis: 'sukses' }),
    kpi('Penyusutan / Bulan', rp(a.penyusutan_per_bulan)),
  ]));

  wadah.append(panel(`${a.kode} — ${a.nama}`, el('dl.deskripsi', [
    el('dt', 'Kategori'), el('dd', judul(a.kategori || '-')),
    el('dt', 'Tanggal perolehan'), el('dd', tgl(a.tanggal_perolehan, true)),
    el('dt', 'Umur manfaat'), el('dd', `${a.umur_manfaat} tahun`),
    el('dt', 'Metode penyusutan'), el('dd', judul(a.metode)),
    el('dt', 'Nilai residu'), el('dd', rp(a.nilai_residu)),
    el('dt', 'Lokasi'), el('dd', a.lokasi || '-'),
    el('dt', 'Penanggung jawab'), el('dd', a.penanggung_jawab || '-'),
    el('dt', 'Barcode'), el('dd', el('span.mono', a.barcode || '-')),
    el('dt', 'Status'), el('dd', status(a.status)),
    a.tanggal_disposal && el('dt', 'Tanggal pelepasan'),
    a.tanggal_disposal && el('dd', tgl(a.tanggal_disposal, true)),
  ].filter(Boolean))));

  wadah.append(el('div.grid.k2', [
    panelTabel('Riwayat Penyusutan', tabel([
      { judul: 'Periode', kunci: 'periode' },
      { judul: 'Beban', angka: true, render: (p) => rp(p.nominal) },
      { judul: 'Akumulasi', angka: true, render: (p) => rp(p.akumulasi) },
      { judul: 'Nilai Buku', angka: true, render: (p) => rp(p.nilai_buku) },
    ], a.riwayat_penyusutan, { kosongTeks: 'Belum ada penyusutan dibukukan' })),
    panelTabel('Riwayat Pemeliharaan', tabel([
      { judul: 'Tanggal', render: (m) => tgl(m.tanggal) },
      { judul: 'Jenis', kunci: 'jenis' },
      { judul: 'Vendor', render: (m) => m.vendor || '-' },
      { judul: 'Biaya', angka: true, render: (m) => rp(m.biaya) },
    ], a.maintenance, { kosongTeks: 'Belum ada catatan pemeliharaan' })),
  ]));

  return wadah;
}

async function formAset() {
  const [coa, unit] = await Promise.all([
    api.get('/api/master/coa', { limit: 500 }), api.get('/api/master/unit-usaha'),
  ]);
  const akunAset = coa.data.filter((c) => c.is_postable && c.tipe === 'aset')
    .map((c) => ({ nilai: c.kode, teks: `${c.kode} — ${c.nama}` }));
  const akunBeban = coa.data.filter((c) => c.is_postable && c.tipe === 'beban')
    .map((c) => ({ nilai: c.kode, teks: `${c.kode} — ${c.nama}` }));

  const form = el('div', [
    el('div.baris-form', [
      kolom('Kode Aset', input('kode'), { wajib: true }),
      kolom('Nama Aset', input('nama'), { wajib: true }),
    ]),
    el('div.baris-form.k3', [
      kolom('Kategori', pilih('kategori', ['inventaris', 'bangunan', 'kendaraan', 'mesin', 'tanah']
        .map((k) => ({ nilai: k, teks: judul(k) })))),
      kolom('Tanggal Perolehan', input('tanggal_perolehan', { tipe: 'date', nilai: hariIni() })),
      kolom('Metode Penyusutan', pilih('metode', [
        { nilai: 'garis_lurus', teks: 'Garis Lurus' },
        { nilai: 'saldo_menurun', teks: 'Saldo Menurun Ganda' }])),
    ]),
    el('div.baris-form.k3', [
      kolom('Harga Perolehan', input('harga_perolehan', { tipe: 'number', min: 1 }), { wajib: true }),
      kolom('Nilai Residu', input('nilai_residu', { tipe: 'number', min: 0, nilai: 0 })),
      kolom('Umur Manfaat (tahun)', input('umur_manfaat', { tipe: 'number', min: 1, nilai: 4 })),
    ]),
    el('div.baris-form.k3', [
      kolom('Akun Aset', pilih('coa_aset', akunAset)),
      kolom('Akun Akumulasi', pilih('coa_akumulasi', akunAset, '1-1699')),
      kolom('Akun Beban Penyusutan', pilih('coa_beban', akunBeban, '5-2301')),
    ]),
    el('div.baris-form.k3', [
      kolom('Lokasi', input('lokasi')),
      kolom('Penanggung Jawab', input('penanggung_jawab')),
      kolom('Unit Usaha', pilih('unit_usaha_id', [{ nilai: '', teks: '- tidak spesifik -' },
        ...unit.data.map((u) => ({ nilai: u.id, teks: u.nama }))])),
    ]),
    el('div.kecil.lembut', 'Catatan: aset berkategori "tanah" tidak disusutkan sesuai PSAK 16.'),
  ]);

  const tutup = modal({
    judul: 'Tambah Aset Tetap', lebar: 'lebar', isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async (e) => {
        e.currentTarget.disabled = true;
        try {
          await api.post('/api/aset', bacaForm(form));
          toast('Aset berhasil didaftarkan', 'sukses');
          tutup(); navigasi(location.hash, true);
        } catch (err) { galat(err); e.currentTarget.disabled = false; }
      } }, 'Simpan'),
    ],
  });
}

function formPenyusutan() {
  const form = el('div', [
    el('div.notis.info', [el('div.isi', [
      el('strong', 'Penyusutan bulanan'),
      el('div.kecil', 'Sistem menghitung beban penyusutan seluruh aset aktif untuk periode terpilih '
        + 'dan membentuk satu jurnal. Aset yang sudah disusutkan pada periode tersebut dilewati.'),
    ])]),
    kolom('Periode', input('periode', { placeholder: 'YYYY-MM', nilai: hariIni().slice(0, 7) }), { wajib: true }),
  ]);
  const tutup = modal({
    judul: 'Jalankan Penyusutan', isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async (e) => {
        e.currentTarget.disabled = true;
        try {
          const h = await api.post('/api/aset/penyusutan', bacaForm(form));
          toast(h.pesan || 'Penyusutan berhasil dibukukan', 'sukses',
            h.total ? `${h.jumlah_aset} aset · total ${rp(h.total)}` : null);
          tutup(); navigasi(location.hash, true);
        } catch (err) { galat(err); e.currentTarget.disabled = false; }
      } }, 'Jalankan'),
    ],
  });
}

function formDisposal(a) {
  const form = el('div', [
    el('div.notis.peringatan', [el('div.isi', [
      el('strong', `Nilai buku saat ini ${rp(a.nilai_buku)}`),
      el('div.kecil', 'Selisih antara hasil penjualan dan nilai buku diakui sebagai laba/rugi pelepasan aset.'),
    ])]),
    el('div.baris-form.k3', [
      kolom('Tanggal', input('tanggal', { tipe: 'date', nilai: hariIni() })),
      kolom('Nilai Jual', input('nilai_jual', { tipe: 'number', min: 0, nilai: 0 })),
      kolom('Metode Terima', pilih('metode', [{ nilai: 'tunai', teks: 'Tunai' },
        { nilai: 'transfer', teks: 'Transfer Bank' }])),
    ]),
    kolom('Keterangan', input('keterangan')),
  ]);
  const tutup = modal({
    judul: `Pelepasan Aset — ${a.kode}`, isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.bahaya', { onclick: async (e) => {
        e.currentTarget.disabled = true;
        try {
          const h = await api.post(`/api/aset/${a.id}/disposal`, bacaForm(form));
          toast('Aset berhasil dilepas', 'sukses',
            `${h.laba_rugi >= 0 ? 'Laba' : 'Rugi'} pelepasan ${rp(Math.abs(h.laba_rugi))}`);
          tutup(); navigasi(location.hash, true);
        } catch (err) { galat(err); e.currentTarget.disabled = false; }
      } }, 'Proses Pelepasan'),
    ],
  });
}

function formMaintenance(a) {
  const form = el('div', [
    el('div.baris-form.k3', [
      kolom('Tanggal', input('tanggal', { tipe: 'date', nilai: hariIni() })),
      kolom('Jenis', input('jenis', { nilai: 'Perawatan rutin' })),
      kolom('Biaya', input('biaya', { tipe: 'number', min: 0, nilai: 0 })),
    ]),
    el('div.baris-form', [
      kolom('Vendor', input('vendor')),
      kolom('Jadwal Berikutnya', input('jadwal_berikutnya', { tipe: 'date' })),
    ]),
    kolom('Keterangan', input('keterangan')),
  ]);
  const tutup = modal({
    judul: `Pemeliharaan — ${a.nama}`, isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async () => {
        try {
          await api.post(`/api/aset/${a.id}/maintenance`, bacaForm(form));
          toast('Pemeliharaan tercatat', 'sukses');
          tutup(); navigasi(location.hash, true);
        } catch (err) { galat(err); }
      } }, 'Simpan'),
    ],
  });
}
