/**
 * Modul 11 - Persediaan.
 */
import {
  api, el, kpi, panel, panelTabel, tabel, rp, angka, desimal, tgl, status, judul, modal,
  kolom, input, pilih, bacaForm, toast, galat, memuat, kosongkan, hariIni, kosong,
} from '../inti.js';
import { grafikPeringkat } from '../grafik.js';
import { izin, navigasi } from '../app.js';
import { ikon } from '../ikon.js';

const WARNA_STOK = { habis: 'st-bahaya', kritis: 'st-bahaya', perlu_order: 'st-peringatan', aman: 'st-sukses' };

export async function render() {
  const wadah = el('div');
  const isi = el('div');
  const daftarTab = [
    { judul: 'Nilai Persediaan', render: stokTab },
    { judul: 'Kartu Stok', render: kartuTab },
    { judul: 'Stock Opname', render: opnameTab },
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

async function stokTab() {
  const wadah = el('div');
  const [d, reorder] = await Promise.all([
    api.get('/api/persediaan/stok'), api.get('/api/persediaan/reorder'),
  ]);

  wadah.append(el('div.grid.k4.mb16', [
    kpi('Nilai Persediaan', rp(d.total_nilai), { ikon: ikon('kotak') }),
    kpi('Jenis Barang', angka(d.baris.length)),
    kpi('Perlu Dipesan Ulang', angka(reorder.data.length), {
      jenis: reorder.data.length ? 'peringatan' : 'sukses', ikon: ikon('lonceng') }),
    kpi('Stok Habis', angka(d.baris.filter((b) => b.status_stok === 'habis').length), {
      jenis: d.baris.some((b) => b.status_stok === 'habis') ? 'bahaya' : 'sukses' }),
  ]));

  if (reorder.data.length) {
    wadah.append(panelTabel(`Perlu Pemesanan Ulang (${reorder.data.length})`, tabel([
      { judul: 'Kode', render: (b) => el('span.mono.kecil', b.kode) },
      { judul: 'Barang', kunci: 'nama' },
      { judul: 'Stok', angka: true, render: (b) => `${desimal(b.qty)} ${b.satuan}` },
      { judul: 'Stok Minimum', angka: true, render: (b) => desimal(b.stok_minimum) },
      { judul: 'Titik Pesan Ulang', angka: true, render: (b) => desimal(b.reorder_point) },
      { judul: 'Status', render: (b) => el(`span.lencana-status.${WARNA_STOK[b.status_stok]}`, judul(b.status_stok)) },
    ], reorder.data)));
  }

  wadah.append(panelTabel('Nilai Persediaan per Barang', tabel([
    { judul: 'Kode', render: (b) => el('span.mono.kecil', b.kode) },
    { judul: 'Barang', kunci: 'nama' },
    { judul: 'Stok', angka: true, render: (b) => `${desimal(b.qty)} ${b.satuan}` },
    { judul: 'HPP Rata-rata', angka: true, render: (b) => rp(b.harga_beli) },
    { judul: 'Nilai', angka: true, render: (b) => el('strong', rp(b.nilai)) },
    { judul: 'Status', render: (b) => el(`span.lencana-status.${WARNA_STOK[b.status_stok]}`, judul(b.status_stok)) },
  ], d.baris, { kaki: { nama: 'TOTAL NILAI PERSEDIAAN', nilai: rp(d.total_nilai) } }), [
    izin('persediaan.update') && el('button.btn', { onclick: () => formPenyesuaian() }, '± Penyesuaian Stok'),
    izin('persediaan.update') && el('button.btn', { onclick: () => formTransfer() }, '⇄ Transfer Gudang'),
  ].filter(Boolean)));

  wadah.append(panel('10 Barang dengan Nilai Persediaan Terbesar', grafikPeringkat({
    baris: [...d.baris].sort((a, b) => b.nilai - a.nilai).slice(0, 10)
      .map((b) => ({ label: b.nama, nilai: b.nilai, catatan: `${desimal(b.qty)} ${b.satuan}` })),
    format: rp,
  })));

  return wadah;
}

async function kartuTab() {
  const wadah = el('div');
  const barang = await api.get('/api/master/barang', { limit: 500 });
  const isi = el('div');
  const pilihan = pilih('barang_id', [{ nilai: '', teks: '- pilih barang -' },
    ...barang.data.map((b) => ({ nilai: b.id, teks: `${b.kode} — ${b.nama}` }))], '', {
    onchange: async (e) => {
      if (!e.target.value) { kosongkan(isi); return; }
      kosongkan(isi).append(memuat());
      try {
        const d = await api.get('/api/persediaan/kartu-stok', { barang_id: e.target.value });
        kosongkan(isi).append(
          el('div.grid.k3.mb16', [
            kpi('Barang', d.barang.nama, { catatan: d.barang.kode }),
            kpi('HPP Rata-rata', rp(d.barang.harga_beli)),
            kpi('Harga Jual', rp(d.barang.harga_jual), {
              catatan: `Harga anggota ${rp(d.barang.harga_anggota)}` }),
          ]),
          panelTabel('Kartu Stok', tabel([
            { judul: 'Tanggal', render: (m) => tgl(m.tanggal) },
            { judul: 'Jenis', render: (m) => judul(m.jenis) },
            { judul: 'Gudang', kunci: 'gudang_nama' },
            { judul: 'Referensi', render: (m) => el('span.mono.kecil', m.referensi || '-') },
            { judul: 'Masuk', angka: true, render: (m) => (m.qty > 0 ? el('span.pos', desimal(m.qty)) : '-') },
            { judul: 'Keluar', angka: true, render: (m) => (m.qty < 0 ? el('span.neg', desimal(-m.qty)) : '-') },
            { judul: 'Harga', angka: true, render: (m) => rp(m.harga) },
            { judul: 'Saldo', angka: true, render: (m) => el('strong', desimal(m.saldo_qty)) },
          ], d.mutasi, { kosongTeks: 'Belum ada mutasi untuk barang ini' })),
        );
      } catch (err) { galat(err); }
    },
  });
  wadah.append(el('div.alat', [el('label.kecil.lembut', 'Pilih barang'), pilihan]), isi);
  return wadah;
}

async function opnameTab() {
  const wadah = el('div');
  async function muat() {
    kosongkan(wadah).append(memuat());
    try {
      const d = await api.get('/api/persediaan/opname');
      kosongkan(wadah).append(panelTabel('Riwayat Stock Opname', tabel([
        { judul: 'Nomor', render: (o) => el('span.mono.kecil', o.nomor) },
        { judul: 'Tanggal', render: (o) => tgl(o.tanggal) },
        { judul: 'Gudang', kunci: 'gudang_nama' },
        { judul: 'Item', angka: true, render: (o) => angka(o.jumlah_item) },
        { judul: 'Petugas', render: (o) => el('span.kecil', o.petugas || '-') },
        { judul: 'Status', render: (o) => status(o.status === 'selesai' ? 'selesai' : 'draft') },
        { judul: '', render: (o) => (o.status === 'draft' && izin('persediaan.post')
          ? el('button.btn.kecil.utama', { onclick: () => isiOpname(o.id, muat) }, 'Isi & Selesaikan')
          : el('button.btn.kecil', { onclick: () => lihatOpname(o.id) }, 'Lihat')) },
      ], d.data, { kosongTeks: 'Belum pernah dilakukan stock opname' }), [
        izin('persediaan.create') && el('button.btn.utama', { onclick: () => mulaiOpname(muat) },
          '+ Mulai Stock Opname'),
      ].filter(Boolean)));
    } catch (err) { galat(err); }
  }
  await muat();
  return wadah;
}

async function mulaiOpname(saatSelesai) {
  const gudang = await api.get('/api/master/gudang');
  const form = el('div', [
    kolom('Gudang', pilih('gudang_id', gudang.data.map((g) => ({ nilai: g.id, teks: g.nama }))), { wajib: true }),
    kolom('Tanggal', input('tanggal', { tipe: 'date', nilai: hariIni() })),
    kolom('Keterangan', input('keterangan')),
  ]);
  const tutup = modal({
    judul: 'Mulai Stock Opname', isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async (e) => {
        e.currentTarget.disabled = true;
        try {
          const h = await api.post('/api/persediaan/opname', bacaForm(form));
          toast('Dokumen opname dibuat', 'sukses', `${h.nomor} · ${h.jumlah_item} item`);
          tutup(); saatSelesai?.();
        } catch (err) { galat(err); e.currentTarget.disabled = false; }
      } }, 'Buat Dokumen'),
    ],
  });
}

async function isiOpname(id, saatSelesai) {
  const o = await api.get(`/api/persediaan/opname/${id}`);
  const nilai = {};
  const isi = el('div', [
    el('div.notis.info', [el('div.isi', [
      el('strong', 'Masukkan hasil perhitungan fisik'),
      el('div.kecil', 'Selisih akan disesuaikan pada stok dan dibukukan sebagai beban '
        + '(selisih kurang) atau pendapatan lain (selisih lebih).'),
    ])]),
    el('div.tabel-bungkus', [tabel([
      { judul: 'Kode', render: (d) => el('span.mono.kecil', d.kode) },
      { judul: 'Barang', kunci: 'nama' },
      { judul: 'Stok Sistem', angka: true, render: (d) => `${desimal(d.qty_sistem)} ${d.satuan}` },
      { judul: 'Stok Fisik', angka: true, render: (d) => el('input', {
        type: 'number', step: 'any', min: 0, nilai: d.qty_fisik,
        gaya: { width: '100px', textAlign: 'right' },
        oninput: (e) => { nilai[d.id] = Number(e.target.value); },
      }) },
      { judul: 'HPP', angka: true, render: (d) => rp(d.harga_beli) },
    ], o.detail)]),
  ]);
  o.detail.forEach((d) => { nilai[d.id] = d.qty_fisik; });

  const tutup = modal({
    judul: `Stock Opname ${o.nomor} — ${o.gudang_nama}`, lebar: 'lebar', isi,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async (e) => {
        e.currentTarget.disabled = true;
        try {
          const h = await api.post(`/api/persediaan/opname/${id}/selesai`, {
            detail: Object.entries(nilai).map(([k, v]) => ({ id: Number(k), qty_fisik: v })),
          });
          toast('Stock opname selesai', 'sukses',
            `Selisih kurang ${rp(h.nilai_kurang)} · lebih ${rp(h.nilai_lebih)}`);
          tutup(); saatSelesai?.();
        } catch (err) { galat(err); e.currentTarget.disabled = false; }
      } }, 'Selesaikan & Sesuaikan Stok'),
    ],
  });
}

async function lihatOpname(id) {
  const o = await api.get(`/api/persediaan/opname/${id}`);
  modal({
    judul: `Stock Opname ${o.nomor}`, lebar: 'lebar',
    isi: el('div.tabel-bungkus', [tabel([
      { judul: 'Kode', render: (d) => el('span.mono.kecil', d.kode) },
      { judul: 'Barang', kunci: 'nama' },
      { judul: 'Sistem', angka: true, render: (d) => desimal(d.qty_sistem) },
      { judul: 'Fisik', angka: true, render: (d) => desimal(d.qty_fisik) },
      { judul: 'Selisih', angka: true, render: (d) => el(d.selisih < 0 ? 'span.neg' : d.selisih > 0 ? 'span.pos' : 'span.samar',
        desimal(d.selisih)) },
      { judul: 'Nilai Selisih', angka: true, render: (d) => rp(d.nilai_selisih) },
    ], o.detail)]),
  });
}

async function formPenyesuaian() {
  const [barang, gudang] = await Promise.all([
    api.get('/api/master/barang', { limit: 500 }), api.get('/api/master/gudang'),
  ]);
  const form = el('div', [
    kolom('Barang', pilih('barang_id', barang.data.map((b) => ({
      nilai: b.id, teks: `${b.kode} — ${b.nama} (stok ${desimal(b.stok)})` }))), { wajib: true }),
    kolom('Gudang', pilih('gudang_id', gudang.data.map((g) => ({ nilai: g.id, teks: g.nama }))), { wajib: true }),
    el('div.baris-form.k3', [
      kolom('Jenis', pilih('jenis', [{ nilai: 'masuk', teks: 'Barang Masuk' },
        { nilai: 'keluar', teks: 'Barang Keluar' }])),
      kolom('Kuantitas', input('qty', { tipe: 'number', step: 'any' }), { wajib: true,
        bantuan: 'Isi positif untuk masuk, negatif untuk keluar' }),
      kolom('Harga Satuan', input('harga', { tipe: 'number', min: 0 }),
        { bantuan: 'Hanya untuk barang masuk' }),
    ]),
    kolom('Keterangan', input('keterangan')),
  ]);
  const tutup = modal({
    judul: 'Penyesuaian Stok', isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async (e) => {
        e.currentTarget.disabled = true;
        try {
          const d = bacaForm(form);
          await api.post('/api/persediaan/penyesuaian', {
            ...d, qty: d.jenis === 'keluar' ? -Math.abs(d.qty) : Math.abs(d.qty) });
          toast('Stok berhasil disesuaikan', 'sukses');
          tutup(); navigasi(location.hash, true);
        } catch (err) { galat(err); e.currentTarget.disabled = false; }
      } }, 'Simpan'),
    ],
  });
}

async function formTransfer() {
  const [barang, gudang] = await Promise.all([
    api.get('/api/master/barang', { limit: 500 }), api.get('/api/master/gudang'),
  ]);
  const opsiGudang = gudang.data.map((g) => ({ nilai: g.id, teks: g.nama }));
  const form = el('div', [
    kolom('Barang', pilih('barang_id', barang.data.map((b) => ({
      nilai: b.id, teks: `${b.kode} — ${b.nama}` }))), { wajib: true }),
    el('div.baris-form', [
      kolom('Dari Gudang', pilih('dari_gudang_id', opsiGudang), { wajib: true }),
      kolom('Ke Gudang', pilih('ke_gudang_id', opsiGudang), { wajib: true }),
    ]),
    el('div.baris-form', [
      kolom('Kuantitas', input('qty', { tipe: 'number', step: 'any', min: 0 }), { wajib: true }),
      kolom('Tanggal', input('tanggal', { tipe: 'date', nilai: hariIni() })),
    ]),
    kolom('Keterangan', input('keterangan')),
  ]);
  const tutup = modal({
    judul: 'Transfer Antar Gudang', isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async (e) => {
        e.currentTarget.disabled = true;
        try {
          await api.post('/api/persediaan/transfer', bacaForm(form));
          toast('Transfer stok berhasil', 'sukses');
          tutup(); navigasi(location.hash, true);
        } catch (err) { galat(err); e.currentTarget.disabled = false; }
      } }, 'Transfer'),
    ],
  });
}
