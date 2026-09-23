/**
 * Modul 14 - Penjualan & Piutang.
 */
import {
  api, el, kpi, panelTabel, tabel, rp, angka, desimal, tgl, status, judul, modal, toast,
  galat, memuat, kosongkan, hariIni, awalTahun, kolom, input, pilih, bacaForm,
} from '../inti.js';
import { izin, navigasi } from '../app.js';
import { hutangTab, daftarRekeningBank, kolomRekeningBank } from './pembelian.js';

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
      const tombol = e.currentTarget;
      bilah.querySelectorAll('button').forEach((b) => b.classList.remove('aktif'));
      tombol.classList.add('aktif');
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
        { judul: 'Diretur', angka: true, render: (d) => (d.qty_retur > 0
          ? el('span.neg', desimal(d.qty_retur)) : el('span.samar', '-')) },
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
        onclick: () => { tutup(); formRetur(p).catch(galat); } }, '↩ Retur'),
      el('button.btn.utama', { onclick: () => tutup() }, 'Tutup'),
    ].filter(Boolean),
  });
}

/** Keterangan cara pengembalian dana retur menurut metode bayar transaksi semula. */
const INFO_REFUND = {
  tunai: 'Dana dikembalikan tunai dari kas.',
  qris: 'Dana dikembalikan melalui rekening bank.',
  transfer: 'Dana dikembalikan melalui rekening bank.',
  piutang: 'Nilai retur otomatis mengurangi sisa piutang pembeli. Bila melebihi sisa piutang '
    + '(sebagian sudah dibayar), kelebihannya dikembalikan tunai.',
  potong_simpanan: 'Nilai retur otomatis dikreditkan kembali ke rekening simpanan anggota yang dipotong.',
};

async function formRetur(p) {
  // Hanya baris yang masih memiliki sisa untuk diretur yang dapat diisi.
  const baris = p.detail.map((d) => ({ ...d, sisa: Math.max(0, d.qty - (d.qty_retur || 0)), retur: 0 }));
  const bankDipakai = ['transfer', 'qris', 'piutang'].includes(p.metode_bayar);
  const bank = bankDipakai ? await daftarRekeningBank() : [];
  const kolomBank = bankDipakai ? kolomRekeningBank(bank, {
    label: 'Rekening Pengembalian Dana',
    bantuan: p.metode_bayar === 'piutang'
      ? 'Hanya dipakai bila ada kelebihan yang dikembalikan; kosongkan untuk tunai'
      : 'Kosongkan untuk memakai akun bank bawaan pada Parameter Sistem',
  }) : null;
  if (kolomBank && p.metode_bayar === 'piutang') {
    kolomBank.querySelector('option[value=""]').textContent = '- Tunai (kas) -';
  }
  const perkiraan = el('strong');
  const porsiTotal = p.subtotal > 0 ? p.total / p.subtotal : 1;

  function hitung() {
    const nilaiItem = baris.reduce((s, d) => s + (d.qty > 0 ? (d.subtotal / d.qty) * d.retur : 0), 0);
    perkiraan.textContent = rp(Math.min(Math.round(nilaiItem * porsiTotal), p.total));
  }

  const form = el('div', [
    el('div.notis.peringatan', [el('div.isi', [
      el('strong', 'Retur mengembalikan barang ke gudang dan membalik jurnal penjualan'),
      el('div.kecil', `Metode bayar semula: ${judul(p.metode_bayar)}. ${INFO_REFUND[p.metode_bayar] || ''} `
        + 'Diskon nota dan PPN ikut dikoreksi secara proporsional.'),
    ])]),
    el('div.tabel-bungkus', [tabel([
      { judul: 'Barang', render: (d) => el('div', [el('div', d.nama), el('div.kecil.samar', d.kode)]) },
      { judul: 'Terjual', angka: true, render: (d) => `${desimal(d.qty)} ${d.satuan}` },
      { judul: 'Sudah Diretur', angka: true, render: (d) => (d.qty_retur > 0 ? desimal(d.qty_retur) : '-') },
      { judul: 'Sisa', angka: true, render: (d) => desimal(d.sisa) },
      { judul: 'Qty Retur', angka: true, render: (d) => el('input', {
        type: 'number', min: 0, max: d.sisa, step: 'any', nilai: d.retur, disabled: d.sisa <= 0,
        class: 'qty-retur', gaya: { width: '90px', textAlign: 'right' },
        oninput: (e) => { d.retur = Math.max(0, Number(e.target.value) || 0); hitung(); },
      }) },
    ], baris)]),
    el('div.antara.mt8.mb16', [
      el('button.btn.kecil', { onclick: () => {
        baris.forEach((d) => { d.retur = d.sisa; });
        form.querySelectorAll('input.qty-retur').forEach((i, idx) => { i.value = baris[idx].retur; });
        hitung();
      } }, 'Retur semua sisa'),
      el('span', [el('span.lembut', 'Perkiraan nilai retur: '), perkiraan]),
    ]),
    el('div.baris-form', [
      kolom('Tanggal Retur', input('tanggal', { tipe: 'date', nilai: hariIni() })),
      kolom('Alasan', input('alasan', { maxlength: 300 }), { wajib: true }),
    ]),
    kolomBank,
  ].filter(Boolean));
  hitung();

  const tutup = modal({
    judul: `Retur Penjualan — ${p.nomor}`, lebar: 'lebar', isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.bahaya', { onclick: async (e) => {
        const tombol = e.currentTarget;
        tombol.disabled = true;
        try {
          const items = baris.filter((d) => d.retur > 0).map((d) => ({ barang_id: d.barang_id, qty: d.retur }));
          if (!items.length) throw new Error('Isi kuantitas retur minimal pada satu barang');
          const lebih = baris.find((d) => d.retur > d.sisa);
          if (lebih) throw new Error(`Kuantitas retur ${lebih.nama} melebihi sisa ${desimal(lebih.sisa)}`);
          const d = bacaForm(form);
          if (!String(d.alasan || '').trim()) throw new Error('Alasan retur wajib diisi');
          const h = await api.post('/api/pos/retur', {
            penjualan_id: p.id, tanggal: d.tanggal, alasan: d.alasan, items,
            bank_account_id: d.bank_account_id || null,
          });
          tutup();
          tampilkanHasilRetur(p, h);
          navigasi(location.hash, true);
        } catch (err) { galat(err); tombol.disabled = false; }
      } }, 'Proses Retur'),
    ],
  });
}

/** Ringkasan hasil retur dari server (nilai, PPN, jurnal, dan cara pengembalian dana). */
function tampilkanHasilRetur(p, h) {
  toast('Retur berhasil diproses', 'sukses',
    `Nilai retur ${rp(h.nilai_retur)}${h.jurnal?.nomor ? ` · jurnal ${h.jurnal.nomor}` : ''}`);
  const tutup = modal({
    judul: `Retur ${p.nomor} Berhasil`, lebar: 'sempit',
    isi: el('div', [
      el('dl.deskripsi', [
        el('dt', 'Nilai retur'), el('dd', el('strong', rp(h.nilai_retur))),
        el('dt', 'Koreksi PPN'), el('dd', rp(h.pajak_retur || 0)),
        el('dt', 'Koreksi HPP'), el('dd', rp(h.hpp_retur || 0)),
        el('dt', 'Jurnal'), el('dd', el('span.mono', h.jurnal?.nomor || '-')),
        el('dt', 'Status transaksi'), el('dd', h.retur_penuh
          ? status('retur', 'Diretur seluruhnya') : status('selesai', 'Retur sebagian')),
      ]),
      el('div.notis.info.mt16', [el('div.isi', [
        el('strong', 'Pengembalian dana'),
        el('div.kecil', INFO_REFUND[p.metode_bayar] || 'Mengikuti metode bayar semula.'),
      ])]),
    ]),
    kaki: [el('button.btn.utama', { onclick: () => tutup() }, 'Tutup')],
  });
}
