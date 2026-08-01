/**
 * Modul 8 - Laporan Keuangan (SAK EP & Permenkop UKM No. 2/2024).
 */
import {
  api, el, kpi, panel, panelTabel, tabel, rp, angka, persen, tgl, judul, galat, memuat,
  kosongkan, hariIni, awalTahun, kosong, toast,
} from '../inti.js';
import { negara } from '../app.js';

const LAPORAN = [
  { kode: 'neraca', nama: 'Neraca (Posisi Keuangan)' },
  { kode: 'laba-rugi', nama: 'Laba Rugi (Hasil Usaha)' },
  { kode: 'arus-kas', nama: 'Arus Kas' },
  { kode: 'perubahan-ekuitas', nama: 'Perubahan Ekuitas' },
  { kode: 'neraca-saldo', nama: 'Neraca Saldo' },
  { kode: 'neraca-lajur', nama: 'Neraca Lajur' },
  { kode: 'buku-besar', nama: 'Buku Besar' },
  { kode: 'rasio', nama: 'Analisis Rasio' },
  { kode: 'calk', nama: 'Catatan atas Laporan Keuangan' },
  { kode: 'pajak', nama: 'Rekapitulasi Pajak' },
];

export async function render() {
  const wadah = el('div');
  const isi = el('div');
  let jenis = 'neraca';
  let dari = awalTahun();
  let sampai = hariIni();
  let kodeAkun = '';

  const [unit, coa] = await Promise.all([
    api.get('/api/master/unit-usaha').catch(() => ({ data: [] })),
    api.get('/api/master/coa', { limit: 500 }).catch(() => ({ data: [] })),
  ]);
  let unitId = '';

  const pilihAkun = el('select', {
    gaya: { display: 'none' },
    onchange: (e) => { kodeAkun = e.target.value; muat(); },
  }, [el('option', { value: '' }, '- pilih akun -'),
    ...coa.data.filter((c) => c.is_postable).map((c) => el('option', { value: c.kode }, `${c.kode} — ${c.nama}`))]);

  const alat = el('div.alat', [
    el('select', { onchange: (e) => {
      jenis = e.target.value;
      pilihAkun.style.display = jenis === 'buku-besar' ? '' : 'none';
      muat();
    } }, LAPORAN.map((l) => el('option', { value: l.kode }, l.nama))),
    pilihAkun,
    el('label.kecil.lembut', 'Dari'),
    el('input', { type: 'date', nilai: dari, onchange: (e) => { dari = e.target.value; muat(); } }),
    el('label.kecil.lembut', 'Sampai'),
    el('input', { type: 'date', nilai: sampai, onchange: (e) => { sampai = e.target.value; muat(); } }),
    unit.data.length ? el('select', { onchange: (e) => { unitId = e.target.value; muat(); } },
      [el('option', { value: '' }, 'Seluruh unit usaha'),
        ...unit.data.map((u) => el('option', { value: u.id }, u.nama))]) : null,
    el('button.btn', { onclick: () => window.print() }, 'Cetak'),
    el('button.btn', { onclick: () => unduh(jenis, isi) }, '⬇ Unduh CSV'),
  ].filter(Boolean));

  wadah.append(alat, isi);

  async function muat() {
    kosongkan(isi).append(memuat());
    try {
      const q = { dari, sampai, unit_usaha_id: unitId || undefined };
      if (jenis === 'buku-besar') {
        if (!kodeAkun) { kosongkan(isi).append(kosong('Pilih akun terlebih dahulu', null, 'buku')); return; }
        q.kode = kodeAkun;
      }
      const d = await api.get(`/api/laporan/${jenis}`, q);
      kosongkan(isi).append(kepala(jenis, dari, sampai), GAMBAR[jenis](d));
    } catch (err) {
      kosongkan(isi).append(el('div.notis.bahaya', [el('div.isi', [
        el('strong', err.message), err.detail && el('div.kecil', err.detail)])]));
    }
  }
  await muat();
  return wadah;
}

const kepala = (jenis, dari, sampai) => el('div.panel', [el('div.panel-isi.tengah', [
  el('h2', negara.koperasi || 'Koperasi Serba Usaha'),
  el('div.tebal', { gaya: { marginTop: '4px' } }, LAPORAN.find((l) => l.kode === jenis)?.nama || ''),
  el('div.kecil.lembut', ['neraca'].includes(jenis)
    ? `Per ${tgl(sampai, true)}`
    : `Periode ${tgl(dari, true)} s.d. ${tgl(sampai, true)}`),
  el('div.kecil.samar', { gaya: { marginTop: '6px' } },
    'Disusun berdasarkan SAK Entitas Privat dan Permenkop UKM No. 2 Tahun 2024'),
])]);

const barisAkun = (r) => el('tr', [
  el('td', el('span.mono.kecil', r.kode)),
  el('td', r.nama),
  el('td.angka', rp(r.saldo)),
]);

const kelompok = (nama, baris, total) => el('table.tabel', [
  el('thead', [el('tr', [el('th', { colspan: 2 }, nama), el('th.angka', 'Jumlah')])]),
  el('tbody', baris.length ? baris.map(barisAkun)
    : [el('tr', [el('td', { colspan: 3, class: 'samar tengah' }, 'Tidak ada saldo')])]),
  el('tfoot', [el('tr', [el('td', { colspan: 2 }, `Total ${nama}`), el('td.angka', rp(total))])]),
]);

const GAMBAR = {
  neraca: (d) => el('div', [
    el('div.grid.k2', [
      el('div.panel', [el('div.panel-isi.rapat', [el('div.tabel-bungkus',
        [kelompok('ASET', d.aset, d.total_aset)])])]),
      el('div', [
        el('div.panel', [el('div.panel-isi.rapat', [el('div.tabel-bungkus',
          [kelompok('LIABILITAS', d.kewajiban, d.total_kewajiban)])])]),
        el('div.panel', [el('div.panel-isi.rapat', [el('div.tabel-bungkus', [
          el('table.tabel', [
            el('thead', [el('tr', [el('th', { colspan: 2 }, 'EKUITAS'), el('th.angka', 'Jumlah')])]),
            el('tbody', [
              ...d.ekuitas.map(barisAkun),
              el('tr', [el('td', ''), el('td', 'SHU Tahun Berjalan'),
                el('td.angka', rp(d.shu_berjalan))]),
            ]),
            el('tfoot', [el('tr', [el('td', { colspan: 2 }, 'Total Ekuitas'),
              el('td.angka', rp(d.total_ekuitas))])]),
          ]),
        ])])]),
      ]),
    ]),
    el('div.panel', [el('div.panel-isi', [
      el('div.antara', [
        el('strong', 'TOTAL ASET'), el('strong', rp(d.total_aset))]),
      el('div.antara.mt8', [
        el('strong', 'TOTAL LIABILITAS + EKUITAS'), el('strong', rp(d.total_pasiva))]),
      el('div.notis', { class: d.seimbang ? 'sukses' : 'bahaya', gaya: { marginTop: '12px', marginBottom: 0 } },
        [el('div.isi', [
          el('strong', d.seimbang ? '✓ Neraca seimbang' : '✕ Neraca tidak seimbang'),
          !d.seimbang && el('div.kecil', `Selisih ${rp(d.selisih)}`),
        ].filter(Boolean))]),
    ])]),
  ]),

  'laba-rugi': (d) => el('div', [
    el('div.grid.k4.mb16', [
      kpi('Pendapatan', rp(d.total_pendapatan)),
      kpi('Harga Pokok Penjualan', rp(d.hpp)),
      kpi('Laba Kotor', rp(d.laba_kotor), { jenis: 'sukses' }),
      kpi('SHU Bersih', rp(d.shu_bersih), { jenis: d.shu_bersih >= 0 ? 'sukses' : 'bahaya' }),
    ]),
    el('div.panel', [el('div.panel-isi.rapat', [el('div.tabel-bungkus', [
      el('table.tabel', [
        el('thead', [el('tr', [el('th', { colspan: 2 }, 'Uraian'), el('th.angka', 'Jumlah')])]),
        el('tbody', [
          el('tr.induk', [el('td', { colspan: 3 }, 'PENDAPATAN')]),
          ...d.pendapatan.map(barisAkun),
          el('tr', [el('td', { colspan: 2 }, el('strong', 'Total Pendapatan')),
            el('td.angka', el('strong', rp(d.total_pendapatan)))]),
          el('tr.induk', [el('td', { colspan: 3 }, 'BEBAN')]),
          ...d.beban.map(barisAkun),
          el('tr', [el('td', { colspan: 2 }, el('strong', 'Total Beban')),
            el('td.angka', el('strong', rp(d.total_beban)))]),
        ]),
        el('tfoot', [el('tr', [el('td', { colspan: 2 }, 'SISA HASIL USAHA (SHU)'),
          el('td.angka', rp(d.shu_bersih))])]),
      ]),
    ])])]),
  ]),

  'arus-kas': (d) => el('div', [
    el('div.grid.k4.mb16', [
      kpi('Arus Operasi', rp(d.arus_operasi), { jenis: d.arus_operasi >= 0 ? 'sukses' : 'bahaya' }),
      kpi('Arus Investasi', rp(d.arus_investasi)),
      kpi('Arus Pendanaan', rp(d.arus_pendanaan)),
      kpi('Saldo Akhir Kas', rp(d.saldo_akhir), { catatan: `Saldo awal ${rp(d.saldo_awal)}` }),
    ]),
    ...['operasi', 'investasi', 'pendanaan'].map((k) => panelTabel(
      `Arus Kas dari Aktivitas ${judul(k)}`, tabel([
        { judul: 'Akun', render: (r) => el('span.mono.kecil', r.coa_kode) },
        { judul: 'Uraian', kunci: 'nama' },
        { judul: 'Arus Kas', angka: true, render: (r) => el(r.arus >= 0 ? 'span.pos' : 'span.neg', rp(r.arus)) },
      ], d[k], { kosongTeks: 'Tidak ada arus kas pada kelompok ini',
        kaki: { nama: `Arus kas bersih ${k}`, arus: rp(d[`arus_${k}`]) } }))),
    el('div.panel', [el('div.panel-isi', [
      el('div.antara', [el('strong', 'Kenaikan (penurunan) kas bersih'), el('strong', rp(d.kenaikan_kas))]),
      el('div.antara.mt8', [el('span.lembut', 'Kas & setara kas awal periode'), el('span', rp(d.saldo_awal))]),
      el('div.antara.mt8', [el('strong', 'Kas & setara kas akhir periode'), el('strong', rp(d.saldo_akhir))]),
    ])]),
  ]),

  'perubahan-ekuitas': (d) => panelTabel('Laporan Perubahan Ekuitas', tabel([
    { judul: 'Akun', render: (r) => el('span.mono.kecil', r.kode) },
    { judul: 'Uraian', kunci: 'nama' },
    { judul: 'Saldo Awal', angka: true, render: (r) => rp(r.saldo_awal) },
    { judul: 'Penambahan', angka: true, render: (r) => el('span.pos', rp(r.penambahan)) },
    { judul: 'Pengurangan', angka: true, render: (r) => el('span.neg', rp(r.pengurangan)) },
    { judul: 'Saldo Akhir', angka: true, render: (r) => el('strong', rp(r.saldo_akhir)) },
  ], [...d.baris, { kode: '', nama: 'SHU Periode Berjalan', saldo_awal: 0,
    penambahan: d.shu_periode_berjalan, pengurangan: 0, saldo_akhir: d.shu_periode_berjalan }], {
    kaki: { nama: 'TOTAL EKUITAS', saldo_awal: rp(d.total_awal), saldo_akhir: rp(d.total_akhir) },
  })),

  'neraca-saldo': (d) => panelTabel('Neraca Saldo', tabel([
    { judul: 'Kode', render: (r) => el('span.mono.kecil', r.kode) },
    { judul: 'Nama Akun', kunci: 'nama' },
    { judul: 'Tipe', render: (r) => judul(r.tipe) },
    { judul: 'Mutasi Debit', angka: true, render: (r) => rp(r.debit) },
    { judul: 'Mutasi Kredit', angka: true, render: (r) => rp(r.kredit) },
    { judul: 'Saldo', angka: true, render: (r) => el('strong', rp(r.saldo)) },
  ], d.baris, {
    kaki: { nama: 'TOTAL', debit: rp(d.total_debit), kredit: rp(d.total_kredit) },
  })),

  'neraca-lajur': (d) => panelTabel('Neraca Lajur (Worksheet)', tabel([
    { judul: 'Kode', render: (r) => el('span.mono.kecil', r.kode) },
    { judul: 'Nama Akun', kunci: 'nama' },
    { judul: 'NS Debit', angka: true, render: (r) => (r.ns_debit ? rp(r.ns_debit) : '-') },
    { judul: 'NS Kredit', angka: true, render: (r) => (r.ns_kredit ? rp(r.ns_kredit) : '-') },
    { judul: 'L/R Debit', angka: true, render: (r) => (r.lr_debit ? rp(r.lr_debit) : '-') },
    { judul: 'L/R Kredit', angka: true, render: (r) => (r.lr_kredit ? rp(r.lr_kredit) : '-') },
    { judul: 'Neraca Debit', angka: true, render: (r) => (r.neraca_debit ? rp(r.neraca_debit) : '-') },
    { judul: 'Neraca Kredit', angka: true, render: (r) => (r.neraca_kredit ? rp(r.neraca_kredit) : '-') },
  ], d.baris)),

  'buku-besar': (d) => el('div', [
    el('div.grid.k3.mb16', [
      kpi('Akun', `${d.akun.kode}`, { catatan: d.akun.nama }),
      kpi('Saldo Awal', rp(d.saldo_awal)),
      kpi('Saldo Akhir', rp(d.saldo_akhir), { jenis: 'sukses' }),
    ]),
    panelTabel('Mutasi Buku Besar', tabel([
      { judul: 'Tanggal', render: (r) => tgl(r.tanggal) },
      { judul: 'Nomor Jurnal', render: (r) => el('a.mono.kecil', { href: `#/akuntansi/${r.jurnal_id}` }, r.nomor) },
      { judul: 'Keterangan', render: (r) => el('span.kecil', r.keterangan || r.jurnal_ket || '-') },
      { judul: 'Debit', angka: true, render: (r) => (r.debit ? rp(r.debit) : '-') },
      { judul: 'Kredit', angka: true, render: (r) => (r.kredit ? rp(r.kredit) : '-') },
      { judul: 'Saldo', angka: true, render: (r) => el('strong', rp(r.saldo)) },
    ], d.baris, { kosongTeks: 'Tidak ada mutasi pada periode ini' })),
  ]),

  rasio: (d) => el('div', [
    el('div.grid.k2', [
      panel('Likuiditas', el('div', [
        el('dl.deskripsi', [
          el('dt', 'Rasio lancar'), el('dd', persen(d.likuiditas.rasio_lancar)),
          el('dt', 'Rasio kas'), el('dd', persen(d.likuiditas.rasio_kas)),
        ]),
        el('div.kecil.samar.mt8', d.likuiditas.keterangan),
      ])),
      panel('Solvabilitas', el('dl.deskripsi', [
        el('dt', 'Rasio utang terhadap aset'), el('dd', persen(d.solvabilitas.rasio_hutang_aset)),
        el('dt', 'Rasio modal sendiri'), el('dd', persen(d.solvabilitas.rasio_modal_sendiri)),
      ])),
      panel('Rentabilitas', el('dl.deskripsi', [
        el('dt', 'Return on Assets (ROA)'), el('dd', persen(d.rentabilitas.roa)),
        el('dt', 'Return on Equity (ROE)'), el('dd', persen(d.rentabilitas.roe)),
        el('dt', 'Margin SHU'), el('dd', persen(d.rentabilitas.margin_shu)),
      ])),
      panel('Kualitas Pinjaman', el('div', [
        el('dl.deskripsi', [
          el('dt', 'Pinjaman beredar'), el('dd', rp(d.kualitas_pinjaman.outstanding)),
          el('dt', 'Kredit bermasalah'), el('dd', rp(d.kualitas_pinjaman.npl_nominal)),
          el('dt', 'Rasio NPL'), el('dd', persen(d.kualitas_pinjaman.npl_ratio)),
        ]),
        el('div.kecil.samar.mt8', d.kualitas_pinjaman.keterangan),
      ])),
    ]),
  ]),

  calk: (d) => el('div', [
    panel('Informasi Umum', el('dl.deskripsi', [
      el('dt', 'Entitas'), el('dd', d.umum.entitas),
      el('dt', 'Badan hukum'), el('dd', d.umum.badan_hukum),
      el('dt', 'Alamat'), el('dd', d.umum.alamat),
      el('dt', 'Bidang usaha'), el('dd', d.umum.bidang_usaha.map((u) => u.nama).join(', ') || '-'),
      el('dt', 'Tahun buku'), el('dd', d.tahun),
    ])),
    panel('Ikhtisar Kebijakan Akuntansi', el('ol', { gaya: { paddingLeft: '20px', margin: 0 } },
      d.kebijakan_akuntansi.map((k) => el('li', { gaya: { marginBottom: '8px' } }, k)))),
    panel('Ringkasan Posisi Keuangan', el('dl.deskripsi', [
      el('dt', 'Total aset'), el('dd', rp(d.ringkasan.total_aset)),
      el('dt', 'Total liabilitas'), el('dd', rp(d.ringkasan.total_liabilitas)),
      el('dt', 'Total ekuitas'), el('dd', rp(d.ringkasan.total_ekuitas)),
      el('dt', 'SHU tahun berjalan'), el('dd', rp(d.ringkasan.shu_tahun_berjalan)),
      el('dt', 'Terbilang'), el('dd', el('em', judul(d.ringkasan.shu_terbilang))),
    ])),
    ...Object.entries(d.penjelasan_pos).map(([nama, baris]) => (baris?.length
      ? panelTabel(judul(nama), tabel([
        { judul: 'Kode', render: (r) => el('span.mono.kecil', r.kode) },
        { judul: 'Uraian', kunci: 'nama' },
        { judul: 'Saldo', angka: true, render: (r) => rp(r.saldo) },
      ], baris)) : null)).filter(Boolean),
  ]),

  pajak: (d) => el('div', [
    panelTabel('Rekapitulasi Akun Pajak', tabel([
      { judul: 'Kode', render: (r) => el('span.mono.kecil', r.kode) },
      { judul: 'Nama Akun', kunci: 'nama' },
      { judul: 'Debit', angka: true, render: (r) => rp(r.debit) },
      { judul: 'Kredit', angka: true, render: (r) => rp(r.kredit) },
      { judul: 'Saldo', angka: true, render: (r) => el('strong', rp(r.saldo)) },
    ], d.akun, { kosongTeks: 'Tidak ada akun pajak dengan mutasi' })),
    el('div.notis.info', [el('div.isi', [el('strong', 'Catatan perpajakan'), el('div.kecil', d.catatan)])]),
  ]),
};

/** Ekspor tabel yang sedang tampil ke berkas CSV. */
function unduh(jenis, wadah) {
  const tabelNode = wadah.querySelectorAll('table.tabel');
  if (!tabelNode.length) { toast('Tidak ada tabel untuk diekspor', 'peringatan'); return; }
  const baris = [];
  tabelNode.forEach((t) => {
    t.querySelectorAll('tr').forEach((tr) => {
      const sel = [...tr.children].map((td) => `"${td.textContent.trim().replace(/"/g, '""')}"`);
      if (sel.length) baris.push(sel.join(';'));
    });
    baris.push('');
  });
  const blob = new Blob([`﻿${baris.join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `laporan-${jenis}-${hariIni()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Berkas CSV berhasil diunduh', 'sukses');
}
