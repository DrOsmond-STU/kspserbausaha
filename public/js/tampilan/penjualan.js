/**
 * Modul 14 - Penjualan & Piutang.
 */
import {
  api, el, kpi, panelTabel, tabel, rp, angka, desimal, tgl, status, judul, modal, toast, galat, memuat,
  kosongkan, hariIni, awalTahun, kolom, input, pilih, bacaForm, tabelServer, ukuranHalaman, ambilSemua,
} from '../inti.js';
import { izin, navigasi } from '../app.js';
import { hutangTab, daftarRekeningBank, kolomRekeningBank, aturKolomBank, dialogKoreksi } from './pembelian.js';
import { cetakDokumen, tombolCetak, tawaranCetak, tandaAir } from '../cetak.js';

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

// ---------------------------- Cetak bukti ----------------------------

const pembeli = (p) => (p.anggota_nama ? `${p.anggota_nama}${p.nomor_anggota ? ` (${p.nomor_anggota})` : ''}`
  : p.customer_nama || 'Umum');
const KOLOM_URAIAN = [{ kunci: 'uraian', label: 'Uraian' }, { kunci: 'jumlah', label: 'Jumlah (Rp)', tipe: 'uang' }];

/** Faktur / nota penjualan dari GET /api/penjualan/:id. */
export function dokFaktur(p) {
  const batal = p.status === 'batal';
  const adaRetur = p.detail.some((d) => d.qty_retur > 0);
  return {
    judul: p.tipe === 'pos' ? 'Nota Penjualan' : 'Faktur Penjualan', nomor: p.nomor, jenis_ttd: 'faktur_penjualan',
    ringkasan: [
      { label: 'Tanggal', nilai: p.tanggal, tipe: 'tanggal' },
      { label: 'Pembeli', nilai: pembeli(p) },
      { label: 'Metode bayar', nilai: judul(p.metode_bayar) },
      { label: 'Gudang', nilai: p.gudang_nama || '-' },
      { label: 'Kasir', nilai: p.kasir || '-' },
      { label: 'Status', nilai: batal ? 'BATAL' : judul(p.status) },
    ],
    isi: batal ? tandaAir('BATAL') : undefined,
    bagian: [
      { judul: 'Rincian Barang', kolom: [
        { kunci: 'kode', label: 'Kode' }, { kunci: 'nama', label: 'Barang' },
        { kunci: 'qty', label: 'Qty', tipe: 'angka' }, { kunci: 'satuan', label: 'Satuan' },
        { kunci: 'harga', label: 'Harga', tipe: 'uang' }, { kunci: 'diskon', label: 'Diskon', tipe: 'uang' },
        { kunci: 'subtotal', label: 'Subtotal', tipe: 'uang' },
      ], baris: p.detail.map((d) => ({ ...d, diskon: d.diskon || null })),
      total: { subtotal: p.detail.reduce((s, d) => s + d.subtotal, 0) } },
      { kolom: KOLOM_URAIAN, baris: [
        { uraian: 'Subtotal', jumlah: p.subtotal },
        { uraian: 'Diskon', jumlah: p.diskon },
        { uraian: 'Pajak (PPN)', jumlah: p.pajak },
        { uraian: 'TOTAL', jumlah: p.total },
        { uraian: 'Dibayar', jumlah: p.bayar },
      ], total: { _label: 'Kembali', jumlah: p.kembali } },
    ],
    terbilang: judul(p.terbilang),
    catatan: batal ? `Dibatalkan: ${p.alasan_batal || '-'}` : adaRetur ? `Sebagian barang telah diretur: ${p.detail.filter((d) => d.qty_retur > 0)
      .map((d) => `${d.nama} ${desimal(d.qty_retur)} ${d.satuan}`).join(', ')}.` : undefined,
    penanda_tambahan: p.anggota_nama || p.customer_nama ? { Pembeli: p.anggota_nama || p.customer_nama,
      Pelanggan: p.anggota_nama || p.customer_nama } : {},
  };
}

/** Bukti retur penjualan untuk satu proses retur (GET /api/penjualan/:id/retur). */
export function dokRetur(p, r) {
  return {
    judul: 'Bukti Retur Penjualan', nomor: r.jurnal?.nomor || `${p.nomor}/R${r.urut}`, jenis_ttd: 'retur_penjualan',
    ringkasan: [
      { label: 'Tanggal retur', nilai: r.tanggal, tipe: 'tanggal' },
      { label: 'Nomor transaksi', nilai: p.nomor },
      { label: 'Tanggal transaksi', nilai: p.tanggal, tipe: 'tanggal' },
      { label: 'Pembeli', nilai: pembeli(p) },
      { label: 'Metode bayar semula', nilai: judul(p.metode_bayar) },
      { label: 'Jurnal retur', nilai: r.jurnal?.nomor || '-' },
    ],
    bagian: [
      { judul: 'Barang Diretur', kolom: [
        { kunci: 'kode', label: 'Kode' }, { kunci: 'nama', label: 'Barang' },
        { kunci: 'qty', label: 'Qty', tipe: 'angka' }, { kunci: 'satuan', label: 'Satuan' },
        { kunci: 'harga', label: 'Harga Netto', tipe: 'uang' }, { kunci: 'nilai', label: 'Nilai', tipe: 'uang' },
      ], baris: r.items, total: { nilai: r.nilai_item } },
      { kolom: KOLOM_URAIAN, baris: [{ uraian: 'Nilai barang diretur', jumlah: r.nilai_item }],
        total: { _label: 'Nilai retur (termasuk koreksi diskon nota & PPN)', jumlah: r.nilai_retur } },
    ],
    terbilang: judul(r.terbilang),
    catatan: `Pengembalian dana: ${INFO_REFUND[p.metode_bayar] || 'mengikuti metode bayar semula.'}`,
    penanda_tambahan: p.anggota_nama || p.customer_nama ? { Pembeli: p.anggota_nama || p.customer_nama } : {},
  };
}

async function cetakDenganTombol(e, ambil) {
  const tombol = e.currentTarget;
  tombol.disabled = true;
  try { await cetakDokumen(await ambil()); } catch (err) { galat(err); } finally { tombol.disabled = false; }
}

/** Daftar proses retur sebuah transaksi dengan tombol cetak bukti per retur. */
async function riwayatRetur(p) {
  let d;
  try { d = await api.get(`/api/penjualan/${p.id}/retur`); } catch (err) { galat(err); return; }
  const tutup = modal({
    judul: `Retur ${p.nomor}`, lebar: 'lebar',
    isi: el('div.tabel-bungkus', [tabel([
      { judul: 'Ke', render: (r) => r.urut },
      { judul: 'Tanggal', render: (r) => tgl(r.tanggal) },
      { judul: 'Jurnal', render: (r) => el('span.mono.kecil', r.jurnal?.nomor || '-') },
      { judul: 'Barang', render: (r) => el('span.kecil', r.items.map((i) => `${i.nama} ${desimal(i.qty)}`).join(', ')) },
      { judul: 'Nilai Retur', angka: true, render: (r) => rp(r.nilai_retur) },
      { judul: '', render: (r) => el('button.btn.kecil', {
        onclick: (e) => cetakDenganTombol(e, () => dokRetur(p, r)) }, 'Cetak Bukti') },
    ], d.retur, { kosongTeks: 'Belum ada retur' })]),
    kaki: [el('button.btn.utama', { onclick: () => tutup() }, 'Tutup')],
  });
}

async function transaksiTab() {
  const wadah = el('div');
  let dari = awalTahun();
  let sampai = hariIni();
  let q = '';

  async function muat() {
    kosongkan(wadah).append(memuat());
    try {
      const ambil = (h) => api.get('/api/penjualan', { dari, sampai, q, ...h });
      const d = await ambil({ limit: ukuranHalaman(), offset: 0 });
      // Transaksi batal tetap tampil, tetapi tidak dihitung pada omzet/rata-rata/total cetak.
      const batal = d.jumlah_batal ?? d.data.filter((p) => p.status === 'batal').length;
      const koreksi = bolehKoreksiJual();
      kosongkan(wadah).append(
        el('div.grid.k3.mb16', [
          kpi('Jumlah Transaksi', angka(d.total - batal), { catatan: batal ? `${angka(batal)} transaksi batal tidak dihitung` : undefined }),
          kpi('Omzet Periode', rp(d.omzet), { jenis: 'sukses' }),
          kpi('Rata-rata per Transaksi', rp(d.total - batal ? d.omzet / (d.total - batal) : 0)),
        ]),
        panelTabel('Transaksi Penjualan', tabelServer([
          { judul: 'Tanggal', render: (p) => el('span.nowrap', tgl(p.tanggal)) },
          { judul: 'Nomor', render: (p) => el('span.mono.kecil', p.nomor) },
          { judul: 'Tipe', render: (p) => p.tipe.toUpperCase() },
          { judul: 'Pembeli', render: (p) => p.anggota_nama || p.customer_nama
            || el('span.samar', 'Umum') },
          { judul: 'Metode', render: (p) => judul(p.metode_bayar) },
          { judul: 'Total', angka: true, render: (p) => el('strong', rp(p.total)) },
          { judul: 'Laba Kotor', angka: true, render: (p) => (p.status === 'batal' ? el('span.samar', '-')
            : el('span.pos', rp(p.total - p.hpp))) },
          { judul: 'Status', render: (p) => el('div', [status(p.status),
            p.status === 'batal' && p.alasan_batal && el('div.kecil.samar', p.alasan_batal),
            p.status === 'selesai' && p.ada_retur && el('div.kecil.samar', 'retur sebagian')]) },
          { judul: '', render: (p) => el('div.gap8', { onclick: (e) => e.stopPropagation() }, [
            el('button.btn.kecil.polos', {
              title: 'Cetak faktur / nota',
              onclick: (e) => cetakDenganTombol(e, async () => dokFaktur(await api.get(`/api/penjualan/${p.id}`))),
            }, 'Cetak'),
            koreksi && p.status === 'selesai' && !p.ada_retur && el('button.btn.kecil', {
              title: 'Ubah transaksi (dibatalkan lalu diganti transaksi bernomor baru)',
              onclick: () => formUbahPenjualan(p.id, { saatSelesai: muat }).catch(galat) }, 'Ubah'),
            koreksi && p.status === 'selesai' && !p.ada_retur && el('button.btn.kecil.bahaya', {
              onclick: () => batalPenjualan(p, muat) }, 'Batal'),
          ].filter(Boolean)) },
        ], { awal: d, ambil, saatKlik: (p) => lihat(p.id, muat).catch(galat),
          kosongTeks: 'Belum ada transaksi pada periode ini' }), [
          el('input', { type: 'search', placeholder: 'Cari nomor transaksi…', nilai: q,
            oninput: (e) => { q = e.target.value; clearTimeout(muat.t); muat.t = setTimeout(muat, 320); } }),
          el('input', { type: 'date', nilai: dari, onchange: (e) => { dari = e.target.value; muat(); } }),
          el('input', { type: 'date', nilai: sampai, onchange: (e) => { sampai = e.target.value; muat(); } }),
          tombolCetak(async () => {
            const semua = await ambilSemua(ambil);
            const sah = semua.filter((p) => p.status !== 'batal');
            return {
            judul: 'Daftar Transaksi Penjualan', subjudul: `Periode ${tgl(dari, true)} s.d. ${tgl(sampai, true)}`,
            jenis_ttd: 'laporan', orientasi: 'landscape',
            ringkasan: [{ label: 'Jumlah transaksi', nilai: angka(d.total) }, { label: 'Omzet periode', nilai: rp(d.omzet) }],
            bagian: [{ kolom: [
              { kunci: 'tanggal', label: 'Tanggal', tipe: 'tanggal' }, { kunci: 'nomor', label: 'Nomor' },
              { kunci: 'tipe', label: 'Tipe' }, { kunci: 'pembeli', label: 'Pembeli' }, { kunci: 'metode', label: 'Metode' },
              { kunci: 'total', label: 'Total', tipe: 'uang' }, { kunci: 'laba', label: 'Laba Kotor', tipe: 'uang' },
              { kunci: 'status', label: 'Status' },
            ], baris: semua.map((p) => ({ ...p, tipe: p.tipe.toUpperCase(), pembeli: pembeli(p),
              metode: judul(p.metode_bayar), laba: p.status === 'batal' ? null : p.total - p.hpp,
              status: p.status === 'batal' ? `Batal${p.alasan_batal ? ` (${p.alasan_batal})` : ''}` : judul(p.status) })),
            total: { total: sah.reduce((s, p) => s + p.total, 0), laba: sah.reduce((s, p) => s + p.total - p.hpp, 0) } }],
            catatan: [d.total > semua.length ? `Menampilkan ${semua.length} dari ${d.total} transaksi.` : '',
              batal ? 'Transaksi berstatus batal tidak dijumlahkan.' : ''].filter(Boolean).join(' ') || undefined,
            };
          }, { label: 'Cetak' }),
        ]),
      );
    } catch (err) { galat(err); }
  }
  await muat();
  return wadah;
}

async function lihat(id, saatBerubah) {
  const p = await api.get(`/api/penjualan/${id}`);
  const bisaKoreksi = bolehKoreksiJual() && p.status === 'selesai' && !p.detail.some((d) => d.qty_retur > 0);
  const tutup = modal({
    judul: `Transaksi ${p.nomor}`, lebar: 'lebar',
    isi: el('div', [
      p.status === 'batal' && el('div.notis.bahaya', [el('div.isi', [
        el('strong', 'Transaksi dibatalkan'),
        el('div.kecil', p.alasan_batal || 'Tanpa keterangan'),
      ])]),
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
    ].filter(Boolean)),
    kaki: [
      bisaKoreksi && el('button.btn', {
        onclick: () => { tutup(); formUbahPenjualan(p.id, { saatSelesai: saatBerubah }).catch(galat); } }, 'Ubah'),
      bisaKoreksi && el('button.btn.bahaya', {
        onclick: () => { tutup(); batalPenjualan(p, saatBerubah); } }, 'Batalkan Transaksi'),
      izin('pos.update') && p.status === 'selesai' && el('button.btn.bahaya', {
        onclick: () => { tutup(); formRetur(p).catch(galat); } }, '↩ Retur'),
      p.detail.some((d) => d.qty_retur > 0) && el('button.btn', {
        onclick: () => { tutup(); riwayatRetur(p); } }, 'Bukti Retur'),
      tombolCetak(() => dokFaktur(p), { label: p.tipe === 'pos' ? 'Cetak Nota' : 'Cetak Faktur' }),
      el('button.btn.utama', { onclick: () => tutup() }, 'Tutup'),
    ].filter(Boolean),
  });
}

// ------------------------- Koreksi (ubah & batal) -------------------------

/** Hak mengubah/membatalkan penjualan tersimpan (tidak ikut wildcard pos.* / penjualan.*). */
export const bolehKoreksiJual = () => izin('pos.koreksi') || izin('penjualan.koreksi');

/** Membatalkan seluruh transaksi penjualan / POS. */
export function batalPenjualan(p, saatSelesai) {
  dialogKoreksi({
    judul: 'Batalkan Transaksi Penjualan',
    pesan: `Batalkan transaksi ${p.nomor} senilai ${rp(p.total)}?`,
    rincian: [
      'Jurnal penjualan (pendapatan, PPN, HPP, persediaan, dan kas/bank/piutang) dibalik; barang kembali ke gudang '
        + 'pada HPP semula; piutang yang belum dibayar dihapus; potongan simpanan dikembalikan; poin loyalti dibatalkan.',
      'Transaksi tetap tercatat dengan status batal. Transaksi yang sudah diretur sebagian atau piutangnya sudah '
        + 'dibayar tidak dapat dibatalkan.',
    ],
    tombol: 'Batalkan Transaksi',
    kirim: (alasan) => api.post(`/api/koreksi/penjualan/${p.id}/batal`, { alasan }),
    saatBerhasil: async (h) => {
      toast('Transaksi dibatalkan', 'sukses',
        `${p.nomor}${h.jurnal_balik?.nomor ? ` · jurnal balik ${h.jurnal_balik.nomor}` : ''}`);
      await saatSelesai?.();
    },
  });
}

const METODE_JUAL = [
  { nilai: 'tunai', teks: 'Tunai' }, { nilai: 'qris', teks: 'QRIS' }, { nilai: 'transfer', teks: 'Transfer Bank' },
  { nilai: 'piutang', teks: 'Piutang (kredit)' }, { nilai: 'potong_simpanan', teks: 'Potong Simpanan Sukarela' },
];

/**
 * Formulir ubah penjualan tersimpan. Server membatalkan transaksi lama (jurnal
 * balik, stok kembali) lalu membuat transaksi pengganti bernomor baru dalam
 * satu transaksi basis data. `cetak(hasil)` (opsional) menyusun dokumen cetak
 * pengganti; bawaannya faktur/nota dari GET /api/penjualan/:id.
 */
export async function formUbahPenjualan(id, { saatSelesai, cetak, labelCetak } = {}) {
  const [p, barang, anggota, bank] = await Promise.all([
    api.get(`/api/penjualan/${id}`),
    api.get('/api/master/barang', { limit: 500 }),
    api.get('/api/anggota', { status: 'aktif', limit: 1000 }).catch(() => ({ data: [] })),
    daftarRekeningBank(),
  ]);
  if (p.status !== 'selesai') throw new Error(`Transaksi berstatus "${judul(p.status)}" tidak dapat diubah`);
  if (p.detail.some((d) => d.qty_retur > 0)) {
    throw Object.assign(new Error('Sebagian barang pada transaksi ini sudah diretur'),
      { detail: 'Gunakan retur penjualan untuk sisa barang yang ingin dikoreksi.' });
  }
  // Anggota transaksi semula tetap dapat dipilih walau kini tidak aktif.
  const daftarAnggota = [...anggota.data];
  if (p.anggota_id && !daftarAnggota.some((a) => a.id === p.anggota_id)) {
    daftarAnggota.unshift({ id: p.anggota_id, nama: p.anggota_nama, nomor_anggota: p.nomor_anggota });
  }
  const items = p.detail.map((d) => ({ barang_id: d.barang_id, qty: d.qty, harga: d.harga, diskon: d.diskon || 0 }));
  const diskonItemSemula = p.detail.reduce((s, d) => s + (d.diskon || 0), 0);
  const daftar = el('div');
  const ringkas = el('div.antara.mt8');
  const hargaBarang = (b, anggotaId) => (anggotaId && b.harga_anggota > 0 ? b.harga_anggota : b.harga_jual);

  function gambar() {
    kosongkan(daftar);
    daftar.append(el('div.kecil.lembut', { gaya: { display: 'grid', gap: '8px', marginBottom: '4px',
      gridTemplateColumns: 'minmax(0,2.4fr) minmax(0,.9fr) minmax(0,1.1fr) minmax(0,1fr) minmax(0,1.1fr) auto' } },
    [el('span', 'Barang'), el('span', 'Qty'), el('span', 'Harga'), el('span', 'Diskon'), el('span.kanan', 'Subtotal'),
      el('span', { gaya: { width: '28px' } })]));
    items.forEach((it, i) => {
      daftar.append(el('div', { gaya: { display: 'grid', gap: '8px', marginBottom: '8px', alignItems: 'center',
        gridTemplateColumns: 'minmax(0,2.4fr) minmax(0,.9fr) minmax(0,1.1fr) minmax(0,1fr) minmax(0,1.1fr) auto' } }, [
        el('select', { onchange: (e) => {
          it.barang_id = Number(e.target.value);
          const b = barang.data.find((x) => x.id === it.barang_id);
          if (b) { it.harga = hargaBarang(b, form.querySelector('[name=anggota_id]').value); gambar(); }
        } }, [el('option', { value: '' }, '- pilih barang -'),
          ...barang.data.map((b) => el('option', { value: b.id, selected: b.id === it.barang_id },
            `${b.kode} — ${b.nama}`))]),
        el('input', { type: 'number', class: 'angka', placeholder: 'Qty', min: 0, step: 'any',
          nilai: it.qty || '', oninput: (e) => { it.qty = Number(e.target.value) || 0; hitung(); } }),
        el('input', { type: 'number', class: 'angka', placeholder: 'Harga', min: 0,
          nilai: it.harga ?? '', oninput: (e) => { it.harga = Number(e.target.value) || 0; hitung(); } }),
        el('input', { type: 'number', class: 'angka', placeholder: 'Diskon', min: 0,
          nilai: it.diskon || 0, oninput: (e) => { it.diskon = Math.max(0, Number(e.target.value) || 0); hitung(); } }),
        el('div.kanan.kecil.tebal', { class: 'subtotal-baris' }, rp((it.qty || 0) * (it.harga || 0) - (it.diskon || 0))),
        el('button.btn.kecil.polos', { title: 'Hapus baris', onclick: () => { items.splice(i, 1); gambar(); } }, '✕'),
      ]));
    });
    hitung();
  }
  function hitung() {
    daftar.querySelectorAll('.subtotal-baris').forEach((n, i) => {
      const it = items[i];
      n.textContent = rp((it.qty || 0) * (it.harga || 0) - (it.diskon || 0));
    });
    const d = bacaForm(form);
    const subtotal = items.reduce((s, i) => s + (i.qty || 0) * (i.harga || 0) - (i.diskon || 0), 0);
    const total = subtotal - (Number(d.diskon) || 0) + (Number(d.pajak) || 0);
    kosongkan(ringkas).append(
      el('span.lembut', `${items.length} baris barang · total semula ${rp(p.total)}`),
      el('span', [el('span.lembut', Number(d.poin_dipakai) > 0 ? 'Perkiraan total (sebelum poin): ' : 'Perkiraan total: '),
        el('strong', { gaya: { fontSize: '16px' } }, rp(total))]),
    );
    return total;
  }

  const kolomBank = kolomRekeningBank(bank, { label: 'Rekening Bank Tujuan' });
  const form = el('div');
  // Dikosongkan = uang pas senilai total baru (nilai semula bisa kurang bila total bertambah).
  const kotakBayar = kolom('Uang Diterima', input('bayar', { tipe: 'number', min: 0, placeholder: 'Uang pas' }), {
    bantuan: `Kosongkan bila uang pas senilai total baru. Semula diterima ${rp(p.bayar)}.` });
  const aturMetode = (m) => {
    kotakBayar.style.display = m === 'tunai' ? '' : 'none';
    aturKolomBank(kolomBank, ['transfer', 'qris'].includes(m));
  };
  form.append(
    el('div.notis.info', [el('div.isi', [
      el('strong', 'Perubahan dicatat sebagai pembatalan + transaksi pengganti'),
      el('div.kecil', `Transaksi ${p.nomor} dibatalkan (jurnal dibalik, barang kembali ke gudang), lalu transaksi `
        + 'pengganti bernomor baru dibuat beserta jurnalnya. Keduanya tetap tercatat untuk jejak audit.'),
    ])]),
    el('div.baris-form.k3', [
      kolom('Tanggal', input('tanggal', { tipe: 'date', nilai: p.tanggal })),
      kolom('Anggota', pilih('anggota_id', [
        { nilai: '', teks: p.customer_nama ? `- ${p.customer_nama} (pelanggan) -` : '- Umum / bukan anggota -' },
        ...daftarAnggota.map((a) => ({ nilai: a.id, teks: `${a.nomor_anggota || ''} — ${a.nama}` })),
      ], p.anggota_id || '')),
      kolom('Metode Bayar', pilih('metode_bayar', METODE_JUAL, p.metode_bayar,
        { onchange: (e) => aturMetode(e.target.value) })),
    ]),
    el('div.tebal.mt16.mb8', 'Rincian Barang'),
    daftar,
    el('button.btn.kecil', { onclick: () => { items.push({ qty: 1, diskon: 0 }); gambar(); } }, '+ Tambah Barang'),
    ringkas,
    el('div.baris-form.k3.mt16', [
      kolom('Diskon Nota', input('diskon', { tipe: 'number', min: 0, nilai: Math.max(0, p.diskon - diskonItemSemula),
        oninput: () => hitung() })),
      kolom('Pajak (PPN)', input('pajak', { tipe: 'number', min: 0, nilai: p.pajak || 0, oninput: () => hitung() })),
      kolom('Poin Dipakai', input('poin_dipakai', { tipe: 'number', min: 0, nilai: p.poin_dipakai || 0,
        oninput: () => hitung() }), { bantuan: 'Khusus anggota' }),
    ]),
    kotakBayar,
    kolomBank,
    kolom('Alasan Perubahan', el('textarea', { name: 'alasan', rows: 2, maxlength: 300 }), { wajib: true }),
  );
  aturMetode(p.metode_bayar);
  gambar();

  const tutup = modal({
    judul: `Ubah Transaksi ${p.nomor}`, lebar: 'lebar', isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Kembali'),
      el('button.btn.utama', { onclick: async (e) => {
        const tombol = e.currentTarget;
        tombol.disabled = true;
        try {
          const d = bacaForm(form);
          const baris = items.filter((i) => i.barang_id && i.qty > 0)
            .map((i) => ({ barang_id: i.barang_id, qty: i.qty, harga: i.harga, diskon: i.diskon || 0 }));
          if (!baris.length) throw new Error('Tambahkan minimal satu barang dengan kuantitas');
          if (!String(d.alasan || '').trim()) throw new Error('Alasan perubahan wajib diisi');
          const isian = {
            alasan: d.alasan.trim(), items: baris, tanggal: d.tanggal || undefined,
            anggota_id: d.anggota_id ? Number(d.anggota_id) : null, metode_bayar: d.metode_bayar,
            diskon: Number(d.diskon) || 0, pajak: Number(d.pajak) || 0, poin_dipakai: Number(d.poin_dipakai) || 0,
            bank_account_id: ['transfer', 'qris'].includes(d.metode_bayar) ? d.bank_account_id || null : null,
          };
          if (d.metode_bayar === 'tunai' && d.bayar !== '') isian.bayar = Number(d.bayar);
          const h = await api.put(`/api/koreksi/penjualan/${p.id}`, isian);
          const baru = h.pengganti;
          toast('Transaksi diubah', 'sukses', `${h.dibatalkan} dibatalkan → ${baru.nomor}`);
          tutup();
          await saatSelesai?.();
          tawaranCetak('Transaksi Berhasil Diubah', el('dl.deskripsi', [
            el('dt', 'Nomor lama'), el('dd', [el('span.mono', h.dibatalkan), ' ', status('batal')]),
            el('dt', 'Nomor baru'), el('dd', el('strong.mono', baru.nomor)),
            el('dt', 'Total baru'), el('dd', el('strong', rp(baru.total))),
            baru.kembali > 0 && el('dt', 'Kembalian'), baru.kembali > 0 && el('dd', rp(baru.kembali)),
          ].filter(Boolean)), async () => (cetak ? cetak(baru) : dokFaktur(await api.get(`/api/penjualan/${baru.id}`))),
          { label: labelCetak || (p.tipe === 'pos' ? 'Cetak Nota Pengganti' : 'Cetak Faktur Pengganti') });
        } catch (err) { galat(err); tombol.disabled = false; }
      } }, 'Simpan Perubahan'),
    ],
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
    kaki: [
      el('button.btn', { onclick: (e) => cetakDenganTombol(e, async () => {
        const d = await api.get(`/api/penjualan/${p.id}/retur`);
        const r = d.retur.find((x) => x.jurnal?.id === h.jurnal?.id) || d.retur.at(-1);
        if (!r) throw new Error('Data retur tidak ditemukan');
        return dokRetur({ ...p, ...d.penjualan, anggota_nama: p.anggota_nama, nomor_anggota: p.nomor_anggota,
          customer_nama: p.customer_nama }, r);
      }) }, 'Cetak Bukti Retur'),
      el('button.btn.utama', { onclick: () => tutup() }, 'Tutup'),
    ],
  });
}
