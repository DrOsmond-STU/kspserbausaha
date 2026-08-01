/**
 * Modul 14 - Penjualan & Piutang.
 */
import {
  api, el, kpi, panelTabel, tabel, rp, angka, desimal, tgl, status, judul, modal, toast,
  galat, memuat, kosongkan, hariIni, awalTahun, kolom, input, pilih, bacaForm,
} from '../inti.js';
import { izin, navigasi } from '../app.js';
import { hutangTab } from './pembelian.js';

export async function render() {
  const wadah = el('div');
  const isi = el('div');
  const daftarTab = [
    { judul: 'Transaksi Penjualan', render: transaksiTab },
    { judul: 'Piutang Usaha', render: () => hutangTab('piutang') },
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

async function transaksiTab() {
  const wadah = el('div');
  let dari = awalTahun();
  let sampai = hariIni();
  let q = '';

  async function muat() {
    kosongkan(wadah).append(memuat());
    try {
      const d = await api.get('/api/penjualan', { dari, sampai, q, limit: 200 });
      kosongkan(wadah).append(
        el('div.grid.k3.mb16', [
          kpi('Jumlah Transaksi', angka(d.total)),
          kpi('Omzet Periode', rp(d.omzet), { jenis: 'sukses' }),
          kpi('Rata-rata per Transaksi', rp(d.total ? d.omzet / d.total : 0)),
        ]),
        panelTabel('Transaksi Penjualan', tabel([
          { judul: 'Tanggal', render: (p) => el('span.nowrap', tgl(p.tanggal)) },
          { judul: 'Nomor', render: (p) => el('span.mono.kecil', p.nomor) },
          { judul: 'Tipe', render: (p) => p.tipe.toUpperCase() },
          { judul: 'Pembeli', render: (p) => p.anggota_nama || p.customer_nama
            || el('span.samar', 'Umum') },
          { judul: 'Metode', render: (p) => judul(p.metode_bayar) },
          { judul: 'Total', angka: true, render: (p) => el('strong', rp(p.total)) },
          { judul: 'Laba Kotor', angka: true, render: (p) => el('span.pos', rp(p.total - p.hpp)) },
          { judul: 'Status', render: (p) => status(p.status) },
        ], d.data, { saatKlik: (p) => lihat(p.id), kosongTeks: 'Belum ada transaksi pada periode ini' }), [
          el('input', { type: 'search', placeholder: 'Cari nomor transaksi…',
            oninput: (e) => { q = e.target.value; clearTimeout(muat.t); muat.t = setTimeout(muat, 320); } }),
          el('input', { type: 'date', nilai: dari, onchange: (e) => { dari = e.target.value; muat(); } }),
          el('input', { type: 'date', nilai: sampai, onchange: (e) => { sampai = e.target.value; muat(); } }),
        ]),
      );
    } catch (err) { galat(err); }
  }
  await muat();
  return wadah;
}

async function lihat(id) {
  const p = await api.get(`/api/penjualan/${id}`);
  const tutup = modal({
    judul: `Transaksi ${p.nomor}`, lebar: 'lebar',
    isi: el('div', [
      el('dl.deskripsi.mb16', [
        el('dt', 'Tanggal'), el('dd', tgl(p.tanggal, true)),
        el('dt', 'Pembeli'), el('dd', p.anggota_nama
          ? `${p.anggota_nama} (${p.nomor_anggota})` : p.customer_nama || 'Umum'),
        el('dt', 'Gudang'), el('dd', p.gudang_nama || '-'),
        el('dt', 'Metode bayar'), el('dd', judul(p.metode_bayar)),
        el('dt', 'Kasir'), el('dd', p.kasir || '-'),
        el('dt', 'Status'), el('dd', status(p.status)),
      ]),
      el('div.tabel-bungkus', [tabel([
        { judul: 'Kode', render: (d) => el('span.mono.kecil', d.kode) },
        { judul: 'Barang', kunci: 'nama' },
        { judul: 'Qty', angka: true, render: (d) => `${desimal(d.qty)} ${d.satuan}` },
        { judul: 'Harga', angka: true, render: (d) => rp(d.harga) },
        { judul: 'Diskon', angka: true, render: (d) => (d.diskon ? rp(d.diskon) : '-') },
        { judul: 'Subtotal', kunci: 'subtotal', angka: true, render: (d) => el('strong', rp(d.subtotal)) },
      ], p.detail, {
        kaki: { nama: 'TOTAL', subtotal: rp(p.total) },
      })]),
      el('dl.deskripsi.mt16', [
        el('dt', 'Subtotal'), el('dd', rp(p.subtotal)),
        el('dt', 'Diskon'), el('dd', rp(p.diskon)),
        el('dt', 'Pajak'), el('dd', rp(p.pajak)),
        el('dt', 'Total'), el('dd', el('strong', rp(p.total))),
        el('dt', 'Dibayar'), el('dd', rp(p.bayar)),
        el('dt', 'Kembali'), el('dd', rp(p.kembali)),
        el('dt', 'HPP'), el('dd', rp(p.hpp)),
        el('dt', 'Laba kotor'), el('dd', el('strong.pos', rp(p.total - p.hpp))),
      ]),
    ]),
    kaki: [
      izin('pos.update') && p.status === 'selesai' && el('button.btn.bahaya', {
        onclick: () => { tutup(); formRetur(p); } }, '↩ Retur'),
      el('button.btn.utama', { onclick: () => tutup() }, 'Tutup'),
    ].filter(Boolean),
  });
}

function formRetur(p) {
  const form = el('div', [
    el('div.notis.peringatan', [el('div.isi', [
      el('strong', 'Retur mengembalikan barang ke gudang'),
      el('div.kecil', 'Seluruh barang pada transaksi ini akan diretur dan jurnal penjualan dibalik.'),
    ])]),
    el('div.baris-form', [
      kolom('Tanggal Retur', input('tanggal', { tipe: 'date', nilai: hariIni() })),
      kolom('Alasan', input('alasan'), { wajib: true }),
    ]),
  ]);
  const tutup = modal({
    judul: `Retur Penjualan — ${p.nomor}`, isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.bahaya', { onclick: async (e) => {
        e.currentTarget.disabled = true;
        try {
          const h = await api.post('/api/pos/retur', { ...bacaForm(form), penjualan_id: p.id });
          toast('Retur berhasil diproses', 'sukses', `Nilai retur ${rp(h.nilai_retur)}`);
          tutup(); navigasi(location.hash, true);
        } catch (err) { galat(err); e.currentTarget.disabled = false; }
      } }, 'Proses Retur'),
    ],
  });
}
