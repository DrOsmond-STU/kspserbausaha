/**
 * Modul 12 - Kasir Toko Koperasi (Point of Sale).
 */
import {
  api, el, kpi, panel, panelTabel, tabel, rp, angka, desimal, tgl, judul, modal, kolom, input,
  pilih, bacaForm, toast, galat, kosongkan, kosong, hariIni, status,
} from '../inti.js';
import { negara } from '../app.js';
import { daftarRekeningBank, kolomRekeningBank, aturKolomBank } from './pembelian.js';
import { ikon } from '../ikon.js';

export async function render() {
  const [gudang, rekap, bank] = await Promise.all([
    api.get('/api/master/gudang'), api.get('/api/pos/rekap'), daftarRekeningBank(),
  ]);

  const keranjang = [];
  let anggota = null;
  const gudangId = gudang.data[0]?.id;

  const wadah = el('div');
  const daftarItem = el('div');
  const ringkas = el('div');
  const kotakAnggota = el('div');

  // ------------------------------ Perhitungan ------------------------------
  const hitung = () => {
    const subtotal = keranjang.reduce((s, i) => s + i.harga * i.qty - i.diskon, 0);
    return { subtotal, total: subtotal };
  };

  function gambarKeranjang() {
    kosongkan(daftarItem);
    if (!keranjang.length) {
      daftarItem.append(kosong('Keranjang kosong', 'Pindai barcode atau cari barang untuk memulai', 'keranjang'));
    } else {
      daftarItem.append(el('div.tabel-bungkus', [tabel([
        { judul: 'Barang', render: (i) => el('div', [
          el('div.tebal', i.nama), el('div.kecil.samar', `${i.kode} · ${rp(i.harga)}/${i.satuan}`)]) },
        { judul: 'Qty', angka: true, render: (i) => el('input', {
          type: 'number', min: '0.01', step: 'any', nilai: i.qty,
          gaya: { width: '78px', textAlign: 'right' },
          onchange: (e) => {
            const v = Number(e.target.value);
            if (v > 0 && v <= i.stok) { i.qty = v; } else {
              toast(v > i.stok ? `Stok hanya ${desimal(i.stok)} ${i.satuan}` : 'Kuantitas tidak valid', 'peringatan');
              e.target.value = i.qty;
            }
            gambarKeranjang();
          },
        }) },
        { judul: 'Diskon', angka: true, render: (i) => el('input', {
          type: 'number', min: '0', nilai: i.diskon, gaya: { width: '92px', textAlign: 'right' },
          onchange: (e) => { i.diskon = Math.max(0, Number(e.target.value) || 0); gambarKeranjang(); },
        }) },
        { judul: 'Subtotal', angka: true, render: (i) => el('strong', rp(i.harga * i.qty - i.diskon)) },
        { judul: '', render: (i) => el('button.btn.kecil.polos', {
          onclick: () => { keranjang.splice(keranjang.indexOf(i), 1); gambarKeranjang(); },
        }, '✕') },
      ], keranjang)]));
    }
    gambarRingkas();
  }

  function gambarRingkas() {
    const h = hitung();
    kosongkan(ringkas).append(
      el('div.antara', { gaya: { fontSize: '15px' } }, [
        el('span.lembut', 'Subtotal'), el('strong', rp(h.subtotal))]),
      el('div.antara', { gaya: { fontSize: '22px', margin: '12px 0', paddingTop: '12px',
        borderTop: '2px solid var(--border-kuat)' } }, [
        el('span.tebal', 'TOTAL'), el('strong', { gaya: { color: 'var(--brand)' } }, rp(h.total))]),
      el('div.kecil.lembut', `${keranjang.length} jenis barang · `
        + `${desimal(keranjang.reduce((s, i) => s + i.qty, 0))} unit`),
    );
  }

  function gambarAnggota() {
    kosongkan(kotakAnggota).append(anggota
      ? el('div.notis.sukses', { gaya: { marginBottom: 0 } }, [el('div.isi', [
        el('strong', anggota.nama),
        el('div.kecil', `${anggota.nomor_anggota} · harga khusus anggota berlaku`),
      ]), el('button.btn.kecil.polos', { onclick: () => { anggota = null; gambarAnggota(); muatUlangHarga(); } }, '✕')])
      : el('button.btn.blok', { onclick: pilihAnggota }, 'Pilih Anggota (opsional)'));
  }

  async function muatUlangHarga() {
    for (const i of keranjang) i.harga = anggota && i.harga_anggota > 0 ? i.harga_anggota : i.harga_jual;
    gambarKeranjang();
  }

  async function pilihAnggota() {
    const d = await api.get('/api/anggota', { status: 'aktif', limit: 500 });
    const cari = el('input', { type: 'search', placeholder: 'Cari nama atau nomor anggota…' });
    const hasil = el('div', { gaya: { maxHeight: '340px', overflowY: 'auto', marginTop: '10px' } });
    const gambar = (q = '') => {
      const cocok = d.data.filter((a) => !q
        || a.nama.toLowerCase().includes(q.toLowerCase())
        || a.nomor_anggota.toLowerCase().includes(q.toLowerCase())).slice(0, 60);
      kosongkan(hasil).append(cocok.length ? el('div', cocok.map((a) => el('button.btn.blok', {
        gaya: { justifyContent: 'flex-start', marginBottom: '4px' },
        onclick: () => { anggota = a; gambarAnggota(); muatUlangHarga(); tutup(); },
      }, `${a.nomor_anggota} — ${a.nama}`))) : kosong('Tidak ditemukan'));
    };
    cari.addEventListener('input', (e) => gambar(e.target.value));
    gambar();
    const tutup = modal({ judul: 'Pilih Anggota', isi: el('div', [cari, hasil]) });
  }

  // -------------------------------- Cari --------------------------------
  const kotakCari = el('input', {
    type: 'search', placeholder: 'Pindai barcode atau ketik nama/kode barang, lalu Enter…',
    gaya: { fontSize: '15px', padding: '11px 14px' },
  });
  const saranWadah = el('div');

  async function cari(q) {
    if (!q || q.length < 2) { kosongkan(saranWadah); return; }
    try {
      const d = await api.get('/api/pos/cari-barang', { q, gudang_id: gudangId });
      kosongkan(saranWadah);
      if (!d.data.length) { saranWadah.append(el('div.kecil.samar', { gaya: { padding: '8px 2px' } }, 'Barang tidak ditemukan')); return; }
      // Barcode persis & tunggal → langsung masuk keranjang
      if (d.data.length === 1 && d.data[0].barcode === q) { tambah(d.data[0]); kotakCari.value = ''; return; }
      saranWadah.append(el('div', { gaya: { display: 'grid', gap: '4px', marginTop: '8px' } },
        d.data.map((b) => el('button.btn.blok', {
          gaya: { justifyContent: 'space-between' }, disabled: b.stok <= 0,
          onclick: () => { tambah(b); kotakCari.value = ''; kosongkan(saranWadah); kotakCari.focus(); },
        }, [
          el('span', { gaya: { textAlign: 'left' } }, [
            el('div.tebal', b.nama),
            el('div.kecil.samar', `${b.kode} · stok ${desimal(b.stok)} ${b.satuan}`)]),
          el('strong', rp(anggota && b.harga_anggota > 0 ? b.harga_anggota : b.harga_jual)),
        ]))));
    } catch (err) { galat(err); }
  }

  function tambah(b) {
    if (b.stok <= 0) { toast(`Stok ${b.nama} habis`, 'peringatan'); return; }
    const ada = keranjang.find((i) => i.barang_id === b.id);
    if (ada) {
      if (ada.qty + 1 > b.stok) { toast(`Stok hanya ${desimal(b.stok)} ${b.satuan}`, 'peringatan'); return; }
      ada.qty += 1;
    } else {
      keranjang.push({ barang_id: b.id, kode: b.kode, nama: b.nama, satuan: b.satuan,
        harga_jual: b.harga_jual, harga_anggota: b.harga_anggota,
        harga: anggota && b.harga_anggota > 0 ? b.harga_anggota : b.harga_jual,
        qty: 1, diskon: 0, stok: b.stok });
    }
    gambarKeranjang();
  }

  let tundaCari;
  kotakCari.addEventListener('input', (e) => {
    clearTimeout(tundaCari);
    tundaCari = setTimeout(() => cari(e.target.value.trim()), 220);
  });
  kotakCari.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { clearTimeout(tundaCari); cari(e.target.value.trim()); }
  });

  // ------------------------------ Bayar ------------------------------
  async function bayar() {
    const h = hitung();
    if (!keranjang.length) { toast('Keranjang masih kosong', 'peringatan'); return; }
    const kembali = el('div.antara', { gaya: { fontSize: '17px', marginTop: '10px' } },
      [el('span.lembut', 'Kembalian'), el('strong#kembali', rp(0))]);
    // Rekening tujuan untuk transfer/QRIS (opsional; kosong = akun bank di Parameter Sistem)
    const kolomBank = kolomRekeningBank(bank, { label: 'Rekening Bank Tujuan' });
    aturKolomBank(kolomBank, false);
    const form = el('div', [
      el('div.antara', { gaya: { fontSize: '21px', marginBottom: '14px' } },
        [el('span.tebal', 'Total'), el('strong', { gaya: { color: 'var(--brand)' } }, rp(h.total))]),
      kolom('Metode Pembayaran', pilih('metode_bayar', [
        { nilai: 'tunai', teks: 'Tunai' }, { nilai: 'qris', teks: 'QRIS' },
        { nilai: 'transfer', teks: 'Transfer Bank' },
        { nilai: 'piutang', teks: 'Piutang (kredit)' },
        { nilai: 'potong_simpanan', teks: 'Potong Simpanan Sukarela' },
      ], 'tunai', { onchange: (e) => {
        const tunai = e.target.value === 'tunai';
        form.querySelector('#kotak-bayar').style.display = tunai ? '' : 'none';
        aturKolomBank(kolomBank, ['transfer', 'qris'].includes(e.target.value));
      } })),
      kolomBank,
      el('div#kotak-bayar', [
        kolom('Uang Diterima', input('bayar', { tipe: 'number', min: 0, nilai: h.total,
          oninput: (e) => {
            const k = Number(e.target.value) - h.total;
            const n = form.querySelector('#kembali');
            n.textContent = rp(Math.max(0, k));
            n.className = k < 0 ? 'neg' : 'pos';
          } })),
        kembali,
        el('div.gap8.mt8', [50000, 100000, 150000, 200000].map((v) => el('button.btn.kecil', {
          onclick: () => {
            const i = form.querySelector('[name=bayar]');
            i.value = v; i.dispatchEvent(new Event('input'));
          },
        }, rp(v)))),
      ]),
    ]);
    const tutup = modal({
      judul: 'Pembayaran', isi: form,
      kaki: [
        el('button.btn', { onclick: () => tutup() }, 'Batal'),
        el('button.btn.utama', { onclick: async (e) => {
          const tombol = e.currentTarget;
          tombol.disabled = true;
          try {
            const d = bacaForm(form);
            const hasil = await api.post('/api/pos/jual', {
              gudang_id: gudangId, anggota_id: anggota?.id || null,
              items: keranjang.map((i) => ({ barang_id: i.barang_id, qty: i.qty,
                harga: i.harga, diskon: i.diskon })),
              metode_bayar: d.metode_bayar,
              bank_account_id: ['transfer', 'qris'].includes(d.metode_bayar) ? d.bank_account_id || null : null,
              bayar: d.metode_bayar === 'tunai' ? d.bayar : h.total,
            });
            tutup();
            keranjang.length = 0;
            anggota = null;
            gambarAnggota(); gambarKeranjang();
            kotakCari.focus();
            tampilkanStruk(hasil);
          } catch (err) { galat(err); tombol.disabled = false; }
        } }, 'Proses Pembayaran'),
      ],
    });
  }

  // ------------------------------ Tata letak ------------------------------
  wadah.append(el('div.grid.k4.mb16', [
    kpi('Transaksi Hari Ini', angka(rekap.jumlah_transaksi), { ikon: ikon('struk') }),
    kpi('Omzet Hari Ini', rp(rekap.total), { ikon: ikon('uang') }),
    kpi('Laba Kotor', rp(rekap.laba_kotor), { jenis: 'sukses' }),
    kpi('Diskon Diberikan', rp(rekap.diskon)),
  ]));

  wadah.append(el('div', { gaya: { display: 'grid', gap: '16px',
    gridTemplateColumns: 'minmax(0,1.9fr) minmax(280px,1fr)' }, class: 'pos-tata' }, [
    el('div', [
      panel('Kasir', el('div', [kotakCari, saranWadah])),
      el('div.panel', [
        el('div.panel-kepala', [el('h3', 'Keranjang Belanja')]),
        el('div.panel-isi.rapat', [daftarItem]),
      ]),
    ]),
    el('div', [
      panel('Anggota', kotakAnggota),
      panel('Ringkasan', el('div', [
        ringkas,
        el('button.btn.utama.blok.mt16', { gaya: { padding: '12px', fontSize: '15px' }, onclick: bayar },
          'Bayar'),
        el('button.btn.blok.mt8', {
          onclick: () => { keranjang.length = 0; gambarKeranjang(); },
        }, 'Kosongkan Keranjang'),
      ])),
    ]),
  ]));

  // Rekap penutupan kasir
  wadah.append(el('div.grid.k2', [
    panelTabel('Rekap per Metode Bayar (hari ini)', tabel([
      { judul: 'Metode', render: (m) => judul(m.metode_bayar) },
      { judul: 'Transaksi', angka: true, render: (m) => angka(m.jumlah) },
      { judul: 'Nilai', angka: true, render: (m) => rp(m.total) },
    ], rekap.per_metode, { kosongTeks: 'Belum ada transaksi hari ini' })),
    panelTabel('Barang Terlaris (hari ini)', tabel([
      { judul: 'Kode', render: (b) => el('span.mono.kecil', b.kode) },
      { judul: 'Barang', kunci: 'nama' },
      { judul: 'Qty', angka: true, render: (b) => desimal(b.qty) },
      { judul: 'Nilai', angka: true, render: (b) => rp(b.nilai) },
    ], rekap.terlaris, { kosongTeks: 'Belum ada penjualan' })),
  ]));

  gambarAnggota();
  gambarKeranjang();
  setTimeout(() => kotakCari.focus(), 100);
  return wadah;
}

function tampilkanStruk(h) {
  const struk = el('div.struk', [
    el('div.tengah', [
      el('div.tebal', negara.koperasi || 'Koperasi Serba Usaha'),
      el('div', 'Toko Koperasi'),
    ]),
    el('div.garis'),
    el('div.baris', [el('span', 'No.'), el('span', h.nomor)]),
    el('div.baris', [el('span', 'Tanggal'), el('span', tgl(h.tanggal))]),
    h.anggota && el('div.baris', [el('span', 'Anggota'), el('span', h.anggota.nama)]),
    el('div.garis'),
    ...h.items.map((i) => el('div', [
      el('div', i.nama),
      el('div.baris', [
        el('span', `  ${desimal(i.qty)} ${i.satuan} × ${angka(i.harga)}`),
        el('span', angka(i.subtotal)),
      ]),
    ])),
    el('div.garis'),
    el('div.baris', [el('span', 'Subtotal'), el('span', angka(h.subtotal))]),
    h.diskon > 0 && el('div.baris', [el('span', 'Diskon'), el('span', `-${angka(h.diskon)}`)]),
    el('div.baris', { gaya: { fontWeight: '700', fontSize: '14px' } },
      [el('span', 'TOTAL'), el('span', angka(h.total))]),
    el('div.baris', [el('span', `Bayar (${judul(h.metode_bayar)})`), el('span', angka(h.bayar))]),
    el('div.baris', [el('span', 'Kembali'), el('span', angka(h.kembali))]),
    h.poin_didapat > 0 && el('div.baris', [el('span', 'Poin diperoleh'), el('span', `${h.poin_didapat} poin`)]),
    el('div.garis'),
    el('div.tengah.kecil', 'Terima kasih telah berbelanja di koperasi kita'),
    el('div.tengah.kecil', 'Dari anggota, oleh anggota, untuk anggota'),
  ].filter(Boolean));

  const tutup = modal({
    judul: 'Transaksi Berhasil', lebar: 'sempit', isi: struk,
    kaki: [
      el('button.btn', { onclick: () => window.print() }, 'Cetak Struk'),
      el('button.btn.utama', { onclick: () => tutup() }, 'Selesai'),
    ],
  });
}
