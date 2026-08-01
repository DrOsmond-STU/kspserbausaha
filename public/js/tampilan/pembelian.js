/**
 * Modul 13 - Pembelian & Utang Usaha.
 */
import {
  api, el, kpi, panel, panelTabel, tabel, rp, angka, desimal, tgl, status, judul, modal,
  kolom, input, pilih, bacaForm, toast, galat, memuat, kosongkan, hariIni, persen,
} from '../inti.js';
import { izin, navigasi } from '../app.js';

export async function render(param) {
  if (param[0]) return detail(Number(param[0]));

  const wadah = el('div');
  const isi = el('div');
  const daftarTab = [
    { judul: 'Dokumen Pembelian', render: dokumenTab },
    { judul: 'Utang Usaha', render: () => hutangTab('hutang') },
    { judul: 'Evaluasi Supplier', render: supplierTab },
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
  let filter = '';
  async function muat() {
    kosongkan(wadah).append(memuat());
    try {
      const d = await api.get('/api/pembelian', { status: filter, limit: 100 });
      kosongkan(wadah).append(panelTabel(`Dokumen Pembelian (${angka(d.total)})`, tabel([
        { judul: 'Nomor', render: (p) => el('span.mono.kecil', p.nomor) },
        { judul: 'Tanggal', render: (p) => tgl(p.tanggal) },
        { judul: 'Tipe', render: (p) => p.tipe.toUpperCase() },
        { judul: 'Supplier', render: (p) => p.supplier_nama || '-' },
        { judul: 'Gudang', render: (p) => el('span.kecil', p.gudang_nama || '-') },
        { judul: 'Total', angka: true, render: (p) => rp(p.total) },
        { judul: 'Terbayar', angka: true, render: (p) => rp(p.terbayar) },
        { judul: 'Status', render: (p) => status(p.status) },
      ], d.data, { saatKlik: (p) => { location.hash = `#/pembelian/${p.id}`; },
        kosongTeks: 'Belum ada dokumen pembelian' }), [
        pilih('f', ['', 'draft', 'diajukan', 'disetujui', 'diterima', 'selesai', 'batal']
          .map((s) => ({ nilai: s, teks: s ? judul(s) : 'Semua status' })), filter,
        { onchange: (e) => { filter = e.target.value; muat(); } }),
        izin('pembelian.create') && el('button.btn.utama', { onclick: () => formPO(muat) },
          '+ Buat Purchase Order'),
      ].filter(Boolean)));
    } catch (err) { galat(err); }
  }
  await muat();
  return wadah;
}

async function detail(id) {
  const p = await api.get(`/api/pembelian/${id}`);
  const wadah = el('div');

  wadah.append(el('div.gap8.mb16', [
    el('button.btn', { onclick: () => { location.hash = '#/pembelian'; } }, '← Kembali'),
    izin('pembelian.update') && !['selesai', 'batal'].includes(p.status)
      && el('button.btn.utama', { onclick: () => formTerima(p) }, 'Terima Barang'),
    el('button.btn', { onclick: () => window.print() }, 'Cetak'),
  ].filter(Boolean)));

  wadah.append(el('div.grid.k4.mb16', [
    kpi('Total Dokumen', rp(p.total)),
    kpi('Terbayar', rp(p.terbayar)),
    kpi('Sisa Utang', rp(p.total - p.terbayar), { jenis: p.total - p.terbayar ? 'peringatan' : 'sukses' }),
    kpi('Status', judul(p.status)),
  ]));

  wadah.append(panel(`Dokumen ${p.nomor}`, el('dl.deskripsi', [
    el('dt', 'Tanggal'), el('dd', tgl(p.tanggal, true)),
    el('dt', 'Tipe'), el('dd', p.tipe.toUpperCase()),
    el('dt', 'Supplier'), el('dd', p.supplier_nama || '-'),
    el('dt', 'Gudang'), el('dd', p.gudang_nama || '-'),
    el('dt', 'Jatuh tempo'), el('dd', tgl(p.jatuh_tempo, true)),
    el('dt', 'Dibuat oleh'), el('dd', p.dibuat_oleh || '-'),
    el('dt', 'Status'), el('dd', status(p.status)),
  ])));

  wadah.append(panelTabel('Rincian Barang', tabel([
    { judul: 'Kode', render: (d) => el('span.mono.kecil', d.kode) },
    { judul: 'Barang', kunci: 'nama' },
    { judul: 'Dipesan', angka: true, render: (d) => `${desimal(d.qty)} ${d.satuan}` },
    { judul: 'Diterima', angka: true, render: (d) => desimal(d.qty_diterima) },
    { judul: 'Sisa', angka: true, render: (d) => el(d.qty - d.qty_diterima > 0 ? 'span.neg' : 'span.samar',
      desimal(d.qty - d.qty_diterima)) },
    { judul: 'Harga', angka: true, render: (d) => rp(d.harga) },
    { judul: 'Subtotal', kunci: 'subtotal', angka: true, render: (d) => el('strong', rp(d.subtotal)) },
  ], p.detail, {
    kaki: { nama: 'TOTAL', subtotal: rp(p.total) },
  })));

  return wadah;
}

async function formPO(saatSelesai) {
  const [supplier, gudang, barang] = await Promise.all([
    api.get('/api/master/supplier'), api.get('/api/master/gudang'),
    api.get('/api/master/barang', { limit: 500 }),
  ]);
  const items = [];
  const daftar = el('div');
  const ringkas = el('div.antara.mt8');

  function gambar() {
    kosongkan(daftar);
    if (!items.length) daftar.append(el('div.samar.kecil', 'Belum ada barang. Klik "Tambah Barang".'));
    items.forEach((it, i) => {
      daftar.append(el('div', { gaya: { display: 'grid', gap: '8px', marginBottom: '8px',
        gridTemplateColumns: 'minmax(0,2.4fr) minmax(0,1fr) minmax(0,1.2fr) minmax(0,1.2fr) auto',
        alignItems: 'center' } }, [
        el('select', { onchange: (e) => {
          it.barang_id = Number(e.target.value);
          const b = barang.data.find((x) => x.id === it.barang_id);
          if (b) { it.harga = b.harga_beli; gambar(); }
        } }, [el('option', { value: '' }, '- pilih barang -'),
          ...barang.data.map((b) => el('option', { value: b.id, selected: b.id === it.barang_id },
            `${b.kode} — ${b.nama}`))]),
        el('input', { type: 'number', class: 'angka', placeholder: 'Qty', min: 0, step: 'any',
          nilai: it.qty || '', oninput: (e) => { it.qty = Number(e.target.value) || 0; hitung(); } }),
        el('input', { type: 'number', class: 'angka', placeholder: 'Harga', min: 0,
          nilai: it.harga || '', oninput: (e) => { it.harga = Number(e.target.value) || 0; hitung(); } }),
        el('div.kanan.kecil.tebal', rp((it.qty || 0) * (it.harga || 0))),
        el('button.btn.kecil.polos', { onclick: () => { items.splice(i, 1); gambar(); } }, '✕'),
      ]));
    });
    hitung();
  }
  function hitung() {
    const total = items.reduce((s, i) => s + (i.qty || 0) * (i.harga || 0), 0);
    kosongkan(ringkas).append(el('span.lembut', `${items.length} baris barang`),
      el('strong', { gaya: { fontSize: '16px' } }, rp(total)));
  }

  const form = el('div', [
    el('div.baris-form.k3', [
      kolom('Supplier', pilih('supplier_id', supplier.data.map((s) => ({
        nilai: s.id, teks: `${s.nama} (termin ${s.termin_hari} hari)` }))), { wajib: true }),
      kolom('Gudang Penerima', pilih('gudang_id', gudang.data.map((g) => ({
        nilai: g.id, teks: g.nama }))), { wajib: true }),
      kolom('Tanggal', input('tanggal', { tipe: 'date', nilai: hariIni() })),
    ]),
    el('div.tebal.mt16.mb8', 'Rincian Barang'),
    daftar,
    el('button.btn.kecil', { onclick: () => { items.push({}); gambar(); } }, '+ Tambah Barang'),
    ringkas,
  ]);
  gambar();

  const tutup = modal({
    judul: 'Purchase Order Baru', lebar: 'lebar', isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async (e) => {
        e.currentTarget.disabled = true;
        try {
          const h = await api.post('/api/pembelian', {
            ...bacaForm(form), tipe: 'po',
            items: items.filter((i) => i.barang_id && i.qty > 0) });
          toast('Purchase Order dibuat', 'sukses', `${h.nomor} · ${rp(h.total)}`);
          tutup(); saatSelesai?.();
        } catch (err) { galat(err); e.currentTarget.disabled = false; }
      } }, 'Simpan PO'),
    ],
  });
}

function formTerima(p) {
  const form = el('div', [
    el('div.notis.info', [el('div.isi', [
      el('strong', 'Penerimaan barang membentuk jurnal'),
      el('div.kecil', 'Persediaan bertambah sebesar nilai barang diterima, dan HPP rata-rata '
        + 'bergerak dihitung ulang otomatis.'),
    ])]),
    el('div.baris-form', [
      kolom('Tanggal Terima', input('tanggal', { tipe: 'date', nilai: hariIni() })),
      kolom('Pembayaran', pilih('metode_bayar', [
        { nilai: 'hutang', teks: 'Utang (bayar kemudian)' },
        { nilai: 'tunai', teks: 'Tunai' }, { nilai: 'transfer', teks: 'Transfer Bank' }])),
    ]),
    el('div.kecil.lembut', 'Seluruh sisa barang yang belum diterima akan dicatat sebagai diterima.'),
  ]);
  const tutup = modal({
    judul: `Penerimaan Barang — ${p.nomor}`, isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async (e) => {
        e.currentTarget.disabled = true;
        try {
          const h = await api.post(`/api/pembelian/${p.id}/terima`, bacaForm(form));
          toast('Barang diterima', 'sukses', `Nilai ${rp(h.total)} · jurnal ${h.jurnal.nomor}`);
          tutup(); navigasi(location.hash, true);
        } catch (err) { galat(err); e.currentTarget.disabled = false; }
      } }, 'Terima Barang'),
    ],
  });
}

export async function hutangTab(jenis) {
  const wadah = el('div');
  async function muat() {
    kosongkan(wadah).append(memuat());
    try {
      const d = await api.get('/api/hutang-piutang', { jenis });
      const a = d.aging;
      kosongkan(wadah).append(
        el('div.grid.k5.mb16', [
          kpi('Belum Jatuh Tempo', rp(a.lancar)),
          kpi('1-30 hari', rp(a['1_30']), { jenis: a['1_30'] ? 'peringatan' : '' }),
          kpi('31-60 hari', rp(a['31_60']), { jenis: a['31_60'] ? 'peringatan' : '' }),
          kpi('61-90 hari', rp(a['61_90']), { jenis: a['61_90'] ? 'bahaya' : '' }),
          kpi('> 90 hari', rp(a.diatas_90), { jenis: a.diatas_90 ? 'bahaya' : '' }),
        ]),
        panelTabel(`Analisis Umur ${judul(jenis)} — total terbuka ${rp(d.total_terbuka)}`, tabel([
          { judul: 'Tanggal', render: (h) => tgl(h.tanggal) },
          { judul: 'Referensi', render: (h) => el('span.mono.kecil', h.referensi) },
          { judul: 'Pihak', render: (h) => h.supplier_nama || h.customer_nama || h.anggota_nama || h.pihak || '-' },
          { judul: 'Jatuh Tempo', render: (h) => el('span.nowrap', tgl(h.jatuh_tempo)) },
          { judul: 'Umur', angka: true, render: (h) => (h.status === 'lunas' ? '-'
            : h.umur_hari > 0 ? el('span.neg', `${h.umur_hari} hari`) : el('span.samar', 'belum')) },
          { judul: 'Nominal', angka: true, render: (h) => rp(h.nominal) },
          { judul: 'Sisa', angka: true, render: (h) => el('strong', rp(h.sisa)) },
          { judul: 'Status', render: (h) => status(h.status) },
          { judul: '', render: (h) => (h.status === 'terbuka' && izin('kas.create')
            ? el('button.btn.kecil.utama', { onclick: () => formBayar(h, muat) }, 'Bayar') : '') },
        ], d.data, { kosongTeks: `Tidak ada ${jenis} tercatat` })),
      );
    } catch (err) { galat(err); }
  }
  await muat();
  return wadah;
}

function formBayar(h, saatSelesai) {
  const form = el('div', [
    el('dl.deskripsi.mb16', [
      el('dt', 'Referensi'), el('dd', h.referensi),
      el('dt', 'Nominal'), el('dd', rp(h.nominal)),
      el('dt', 'Sudah dibayar'), el('dd', rp(h.terbayar)),
      el('dt', 'Sisa'), el('dd', el('strong', rp(h.sisa))),
    ]),
    el('div.baris-form', [
      kolom('Tanggal', input('tanggal', { tipe: 'date', nilai: hariIni() })),
      kolom('Nominal Bayar', input('nominal', { tipe: 'number', min: 1, nilai: h.sisa }), { wajib: true }),
    ]),
    kolom('Metode', pilih('metode', [{ nilai: 'tunai', teks: 'Tunai' },
      { nilai: 'transfer', teks: 'Transfer Bank' }])),
  ]);
  const tutup = modal({
    judul: h.jenis === 'hutang' ? 'Pembayaran Utang' : 'Penerimaan Piutang', isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async (e) => {
        e.currentTarget.disabled = true;
        try {
          const r = await api.post('/api/hutang-piutang/bayar', { ...bacaForm(form), id: h.id });
          toast('Pembayaran tercatat', 'sukses', `Sisa ${rp(r.sisa)}`);
          tutup(); saatSelesai?.();
        } catch (err) { galat(err); e.currentTarget.disabled = false; }
      } }, 'Bayar'),
    ],
  });
}

async function supplierTab() {
  const d = await api.get('/api/pembelian/evaluasi/supplier');
  return panelTabel('Evaluasi Kinerja Supplier', tabel([
    { judul: 'Kode', render: (s) => el('span.mono.kecil', s.kode) },
    { judul: 'Supplier', kunci: 'nama' },
    { judul: 'Termin', angka: true, render: (s) => `${s.termin_hari} hari` },
    { judul: 'Transaksi', angka: true, render: (s) => angka(s.jumlah_transaksi) },
    { judul: 'Nilai Transaksi', angka: true, render: (s) => rp(s.nilai_transaksi) },
    { judul: 'Penyelesaian', angka: true, render: (s) => persen(s.tingkat_penyelesaian) },
    { judul: 'Utang Terbuka', angka: true, render: (s) => rp(s.hutang_terbuka) },
    { judul: 'Rating', angka: true, render: (s) => `${s.rating} / 5` },
  ], d.data, { kosongTeks: 'Belum ada supplier' }));
}
