/**
 * Modul 6 - SHU (Sisa Hasil Usaha).
 */
import {
  api, el, kpi, panel, panelTabel, tabel, rp, angka, persen, tgl, status, judul, modal,
  kolom, input, pilih, bacaForm, toast, galat, memuat, kosongkan, hariIni, konfirmasi,
} from '../inti.js';
import { grafikCincin } from '../grafik.js';
import { izin, navigasi } from '../app.js';

export async function render(param) {
  if (param[0]) return detail(Number(param[0]));

  const wadah = el('div');
  const d = await api.get('/api/shu');

  wadah.append(el('div.notis.info', [el('div.isi', [
    el('strong', 'Dasar hukum pembagian SHU'),
    el('div.kecil', 'UU No. 25 Tahun 1992 Pasal 45: SHU dibagikan kepada anggota sebanding dengan '
      + 'jasa usaha masing-masing anggota, setelah dikurangi dana cadangan. Persentase alokasi '
      + 'mengikuti AD/ART dan dapat diubah pada modul Administrator.'),
  ])]));

  wadah.append(panelTabel('Alokasi SHU sesuai AD/ART', tabel([
    { judul: 'Komponen', kunci: 'nama' },
    { judul: 'Persentase', kunci: 'persentase', angka: true, render: (a) => persen(a.persentase) },
  ], d.alokasi_default, {
    kaki: { nama: 'TOTAL', persentase: persen(d.alokasi_default.reduce((s, a) => s + a.persentase, 0)) },
  })));

  wadah.append(panelTabel('Periode Pembagian SHU', tabel([
    { judul: 'Tahun Buku', render: (p) => el('strong', p.tahun) },
    { judul: 'SHU Bersih', angka: true, render: (p) => rp(p.shu_bersih) },
    { judul: 'Dasar Simpanan', angka: true, render: (p) => rp(p.total_simpanan) },
    { judul: 'Dasar Transaksi', angka: true, render: (p) => rp(p.total_transaksi) },
    { judul: 'Anggota', angka: true, render: (p) => angka(p.jumlah_anggota) },
    { judul: 'Dibagikan', angka: true, render: (p) => rp(p.total_dibagikan) },
    { judul: 'Status', render: (p) => status(p.status) },
  ], d.data, {
    saatKlik: (p) => { location.hash = `#/shu/${p.id}`; },
    kosongTeks: 'Belum ada periode SHU. Jalankan simulasi untuk membuat usulan.',
  }), [
    el('button.btn', { onclick: simulasi }, 'Simulasi SHU'),
    izin('shu.create') && el('button.btn.utama', { onclick: () => buatUsulan() }, '+ Buat Usulan Pembagian'),
  ].filter(Boolean)));

  return wadah;
}

async function simulasi() {
  const tahun = new Date().getFullYear();
  const hasil = el('div');
  const form = el('div', [
    el('div.baris-form', [
      kolom('Tahun Buku', input('tahun', { tipe: 'number', nilai: tahun })),
      kolom('SHU Bersih (opsional)', input('shu_bersih', { tipe: 'number',
        placeholder: 'Kosongkan untuk ambil dari laporan laba rugi' })),
    ]),
    el('button.btn.utama', { onclick: async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      kosongkan(hasil).append(memuat());
      try {
        const d = bacaForm(form);
        const h = await api.get('/api/shu/simulasi', { tahun: d.tahun, shu_bersih: d.shu_bersih || '' });
        kosongkan(hasil).append(tampilSimulasi(h));
      } catch (err) { galat(err); kosongkan(hasil); } finally { b.disabled = false; }
    } }, 'Hitung Simulasi'),
    hasil,
  ]);
  modal({ judul: 'Simulasi Pembagian SHU', lebar: 'lebar', isi: form });
}

function tampilSimulasi(h) {
  return el('div.mt16', [
    el('div.grid.k3.mb16', [
      kpi('SHU Bersih', rp(h.shu_bersih), { jenis: h.shu_bersih >= 0 ? 'sukses' : 'bahaya' }),
      kpi('Dasar Simpanan', rp(h.dasar.total_simpanan)),
      kpi('Dasar Transaksi', rp(h.dasar.total_transaksi)),
    ]),
    el('div.grid.k2', [
      el('div.panel', [el('div.panel-isi', [
        el('h3.mb8', 'Alokasi'),
        grafikCincin({
          bagian: h.alokasi.filter((a) => a.nominal > 0).map((a) => ({ label: a.nama, nilai: a.nominal })),
          tengahLabel: 'SHU', tengahNilai: rp(h.shu_bersih).replace('Rp ', ''),
        }),
      ])]),
      el('div.panel', [el('div.panel-isi.rapat', [el('div.tabel-bungkus', [tabel([
        { judul: 'Komponen', kunci: 'nama' },
        { judul: '%', angka: true, render: (a) => persen(a.persentase) },
        { judul: 'Nominal', angka: true, render: (a) => rp(a.nominal) },
      ], h.alokasi)])])]),
    ]),
    el('div.panel', [el('div.panel-isi.rapat', [el('div.tabel-bungkus', [tabel([
      { judul: 'No. Anggota', render: (a) => el('span.mono.kecil', a.nomor_anggota) },
      { judul: 'Nama', kunci: 'nama' },
      { judul: 'Simpanan Rata-rata', angka: true, render: (a) => rp(a.simpanan_rata) },
      { judul: 'Nilai Transaksi', angka: true, render: (a) => rp(a.nilai_transaksi) },
      { judul: 'Jasa Modal', angka: true, render: (a) => rp(a.shu_jasa_modal) },
      { judul: 'Jasa Usaha', angka: true, render: (a) => rp(a.shu_jasa_usaha) },
      { judul: 'Total SHU', kunci: 'shu_total', angka: true, render: (a) => el('strong.pos', rp(a.shu_total)) },
    ], h.per_anggota, {
      kosongTeks: 'Belum ada anggota yang memenuhi dasar perhitungan',
      kaki: { nama: `TOTAL (${h.per_anggota.length} anggota)`, shu_total: rp(h.total_dibagikan) },
    })])])]),
  ]);
}

function buatUsulan() {
  const form = el('div', [
    el('div.notis.peringatan', [el('div.isi', [
      el('strong', 'Usulan menunggu pengesahan RAT'),
      el('div.kecil', 'Perhitungan disimpan sebagai usulan. Pembagian baru dibukukan setelah '
        + 'disahkan dalam Rapat Anggota Tahunan.'),
    ])]),
    el('div.baris-form', [
      kolom('Tahun Buku', input('tahun', { tipe: 'number', nilai: new Date().getFullYear() - 1 }), { wajib: true }),
      kolom('SHU Bersih (opsional)', input('shu_bersih', { tipe: 'number',
        placeholder: 'Otomatis dari laba rugi' })),
    ]),
  ]);
  const tutup = modal({
    judul: 'Buat Usulan Pembagian SHU', isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async (e) => {
        e.currentTarget.disabled = true;
        try {
          const h = await api.post('/api/shu/usulan', bacaForm(form));
          toast('Usulan pembagian SHU tersimpan', 'sukses',
            `${h.per_anggota.length} anggota · ${rp(h.shu_bersih)}`);
          tutup(); location.hash = `#/shu/${h.periode_id}`;
        } catch (err) { galat(err); e.currentTarget.disabled = false; }
      } }, 'Simpan Usulan'),
    ],
  });
}

async function detail(id) {
  const p = await api.get(`/api/shu/${id}`);
  const wadah = el('div');
  const segarkan = () => navigasi(location.hash, true);

  wadah.append(el('div.gap8.mb16', [
    el('button.btn', { onclick: () => { location.hash = '#/shu'; } }, '← Kembali'),
    izin('shu.approve') && p.status === 'diajukan' && el('button.btn.sukses', {
      onclick: () => sahkan(p, segarkan) }, '✓ Sahkan (RAT)'),
    izin('shu.approve') && p.status === 'disetujui' && el('button.btn.utama', {
      onclick: () => bagikan(p, segarkan) }, 'Bagikan ke Anggota'),
    el('button.btn', { onclick: () => window.print() }, 'Cetak'),
  ].filter(Boolean)));

  wadah.append(el('div.grid.k4.mb16', [
    kpi('Tahun Buku', p.tahun),
    kpi('SHU Bersih', rp(p.shu_bersih), { jenis: 'sukses' }),
    kpi('Status', judul(p.status)),
    kpi('Anggota Penerima', angka(p.per_anggota.length)),
  ]));

  wadah.append(el('div.notis.info', [el('div.isi', [
    el('strong', 'Terbilang'), el('div', judul(p.terbilang)),
  ])]));

  wadah.append(el('div.grid.k2', [
    el('div.panel', [el('div.panel-kepala', [el('h3', 'Alokasi SHU')]),
      el('div.panel-isi', [grafikCincin({
        bagian: p.alokasi.filter((a) => a.nominal > 0).map((a) => ({
          label: judul(a.komponen), nilai: a.nominal })),
        tengahLabel: 'Total', tengahNilai: rp(p.shu_bersih).replace('Rp ', ''),
      })])]),
    panelTabel('Rincian Alokasi', tabel([
      { judul: 'Komponen', render: (a) => judul(a.komponen) },
      { judul: 'Akun', render: (a) => el('span.mono.kecil', a.coa_kode || '-') },
      { judul: '%', angka: true, render: (a) => persen(a.persentase) },
      { judul: 'Nominal', angka: true, render: (a) => rp(a.nominal) },
    ], p.alokasi)),
  ]));

  wadah.append(panelTabel('Pembagian SHU per Anggota', tabel([
    { judul: 'No. Anggota', render: (a) => el('span.mono.kecil', a.nomor_anggota) },
    { judul: 'Nama', kunci: 'nama', render: (a) => el('a', { href: `#/anggota/${a.anggota_id}` }, a.nama) },
    { judul: 'Simpanan Rata-rata', angka: true, render: (a) => rp(a.simpanan_rata) },
    { judul: 'Nilai Transaksi', angka: true, render: (a) => rp(a.nilai_transaksi) },
    { judul: 'Jasa Modal', angka: true, render: (a) => rp(a.shu_jasa_modal) },
    { judul: 'Jasa Usaha', angka: true, render: (a) => rp(a.shu_jasa_usaha) },
    { judul: 'Total', kunci: 'shu_total', angka: true, render: (a) => el('strong.pos', rp(a.shu_total)) },
    { judul: 'Dibayar', render: (a) => (a.dibayar ? status('lunas', judul(a.metode_bayar || 'ya'))
      : status('netral', 'Belum')) },
  ], p.per_anggota, {
    kaki: { nama: 'TOTAL', shu_total: rp(p.per_anggota.reduce((s, a) => s + a.shu_total, 0)) },
  })));

  return wadah;
}

function sahkan(p, saatSelesai) {
  const form = el('div', [
    el('div.notis.peringatan', [el('div.isi', [
      el('strong', 'Pengesahan membentuk jurnal'),
      el('div.kecil', `SHU tahun berjalan sebesar ${rp(p.shu_bersih)} akan didebit dan dialokasikan `
        + 'ke dana cadangan serta dana-dana lain sesuai AD/ART.'),
    ])]),
    kolom('Tanggal Pengesahan', input('tanggal', { tipe: 'date', nilai: `${p.tahun}-12-31` })),
  ]);
  const tutup = modal({
    judul: `Sahkan Pembagian SHU ${p.tahun}`, isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.sukses', { onclick: async (e) => {
        e.currentTarget.disabled = true;
        try {
          const h = await api.post(`/api/shu/${p.id}/sahkan`, bacaForm(form));
          toast('SHU berhasil disahkan', 'sukses', `Jurnal ${h.jurnal.nomor}`);
          tutup(); saatSelesai?.();
        } catch (err) { galat(err); e.currentTarget.disabled = false; }
      } }, 'Sahkan'),
    ],
  });
}

function bagikan(p, saatSelesai) {
  const form = el('div', [
    kolom('Metode Pembagian', pilih('metode', [
      { nilai: 'simpanan', teks: 'Kreditkan ke Simpanan Sukarela' },
      { nilai: 'tunai', teks: 'Dibayar Tunai' },
    ]), { bantuan: 'Pembagian ke simpanan sukarela memperkuat permodalan koperasi.' }),
    kolom('Tanggal', input('tanggal', { tipe: 'date', nilai: hariIni() })),
  ]);
  const tutup = modal({
    judul: `Bagikan SHU ${p.tahun}`, isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async (e) => {
        e.currentTarget.disabled = true;
        try {
          const h = await api.post(`/api/shu/${p.id}/bagikan`, bacaForm(form));
          toast('SHU berhasil dibagikan', 'sukses',
            `${h.jumlah_anggota} anggota · total ${rp(h.total)}`);
          tutup(); saatSelesai?.();
        } catch (err) { galat(err); e.currentTarget.disabled = false; }
      } }, 'Bagikan'),
    ],
  });
}
