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
    { judul: 'Nilai', kunci: 'nilai', angka: true, render: (b) => el('strong', rp(b.nilai)) },
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
        { judul: 'Status', render: (o) => el('div', [status(o.status),
          o.status === 'batal' && o.alasan_batal && el('div.kecil.samar', o.alasan_batal)]) },
        { judul: '', render: (o) => {
          // Dokumen draft belum mengubah stok/jurnal sehingga masih boleh dibatalkan.
          const draft = !['selesai', 'batal'].includes(o.status);
          return el('div.gap8', [
            draft && izin('persediaan.post')
              ? el('button.btn.kecil.utama', { onclick: () => isiOpname(o.id, muat) }, 'Isi & Selesaikan')
              : el('button.btn.kecil', { onclick: () => lihatOpname(o.id) }, 'Lihat'),
            draft && izin('persediaan.update')
              && el('button.btn.kecil.bahaya', { onclick: () => batalOpname(o, muat) }, 'Batalkan'),
          ].filter(Boolean));
        } },
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
        const tombol = e.currentTarget;
        tombol.disabled = true;
        try {
          const h = await api.post('/api/persediaan/opname', bacaForm(form));
          toast('Dokumen opname dibuat', 'sukses', `${h.nomor} · ${h.jumlah_item} item`);
          tutup(); saatSelesai?.();
        } catch (err) { galat(err); tombol.disabled = false; }
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
        const tombol = e.currentTarget;
        tombol.disabled = true;
        try {
          const h = await api.post(`/api/persediaan/opname/${id}/selesai`, {
            detail: Object.entries(nilai).map(([k, v]) => ({ id: Number(k), qty_fisik: v })),
          });
          toast('Stock opname selesai', 'sukses',
            `Selisih kurang ${rp(h.nilai_kurang)} · lebih ${rp(h.nilai_lebih)}`);
          tutup(); saatSelesai?.();
        } catch (err) { galat(err); tombol.disabled = false; }
      } }, 'Selesaikan & Sesuaikan Stok'),
    ],
  });
}

async function lihatOpname(id) {
  const o = await api.get(`/api/persediaan/opname/${id}`);
  modal({
    judul: `Stock Opname ${o.nomor}`, lebar: 'lebar',
    isi: el('div', [
      o.status === 'batal' && el('div.notis.bahaya', [el('div.isi', [
        el('strong', 'Dokumen dibatalkan'),
        el('div.kecil', o.alasan_batal || 'Tanpa keterangan'),
      ])]),
      el('div.tabel-bungkus', [tabel([
      { judul: 'Kode', render: (d) => el('span.mono.kecil', d.kode) },
      { judul: 'Barang', kunci: 'nama' },
      { judul: 'Sistem', angka: true, render: (d) => desimal(d.qty_sistem) },
      { judul: 'Fisik', angka: true, render: (d) => desimal(d.qty_fisik) },
      { judul: 'Selisih', angka: true, render: (d) => el(d.selisih < 0 ? 'span.neg' : d.selisih > 0 ? 'span.pos' : 'span.samar',
        desimal(d.selisih)) },
      { judul: 'Nilai Selisih', angka: true, render: (d) => rp(d.nilai_selisih) },
    ], o.detail)]),
    ].filter(Boolean)),
  });
}

function batalOpname(o, saatSelesai) {
  const form = el('div', [
    el('div.notis.peringatan', [el('div.isi', [
      el('strong', `Batalkan dokumen ${o.nomor}?`),
      el('div.kecil', 'Dokumen yang belum diselesaikan belum mengubah stok maupun jurnal. '
        + 'Setelah dibatalkan, dokumen tidak dapat diisi lagi.'),
    ])]),
    kolom('Alasan Pembatalan', input('alasan', { maxlength: 300 }), { wajib: true }),
  ]);
  const tutup = modal({
    judul: 'Batalkan Stock Opname', isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Kembali'),
      el('button.btn.bahaya', { onclick: async (e) => {
        const tombol = e.currentTarget;
        tombol.disabled = true;
        try {
          await api.post(`/api/persediaan/opname/${o.id}/batal`, bacaForm(form));
          toast('Stock opname dibatalkan', 'sukses', o.nomor);
          tutup(); saatSelesai?.();
        } catch (err) { galat(err); tombol.disabled = false; }
      } }, 'Batalkan Dokumen'),
    ],
  });
}

/**
 * Pilihan akun lawan penyesuaian: seluruh akun postable & aktif dari bagan akun.
 * Kosong = memakai pemetaan bawaan di Parameter Sistem (dipilih server).
 */
async function pilihAkunLawan() {
  const [coa, setelan] = await Promise.all([
    api.get('/api/master/coa', { status: 'aktif', limit: 1000 }).catch(() => null),
    izin('admin.view') ? api.get('/api/admin/settings', { prefix: 'coa.' }).catch(() => null) : null,
  ]);
  const akun = (coa?.data || []).filter((a) => a.is_postable && a.status === 'aktif');
  const namaAkun = (kode) => {
    if (!kode) return null;
    const a = akun.find((x) => x.kode === kode);
    return a ? `${a.kode} ${a.nama}` : kode;
  };
  return {
    akun,
    bawaanMasuk: namaAkun(setelan?.map?.['coa.pendapatan_lain']),
    bawaanKeluar: namaAkun(setelan?.map?.['coa.beban_selisih']),
  };
}

async function formPenyesuaian() {
  const [barang, gudang, lawan] = await Promise.all([
    api.get('/api/master/barang', { limit: 500 }), api.get('/api/master/gudang'), pilihAkunLawan(),
  ]);
  const bantuanLawan = el('div.bantuan');
  const pilihJenis = pilih('jenis', [{ nilai: 'masuk', teks: 'Barang Masuk' },
    { nilai: 'keluar', teks: 'Barang Keluar' }], 'masuk', { onchange: () => perbarui() });
  const kolomHarga = kolom('Harga Satuan', input('harga', { tipe: 'number', min: 0 }),
    { bantuan: 'Kosongkan untuk memakai HPP rata-rata' });
  const opsiLawan = [{ nilai: '', teks: '- Bawaan (Parameter Sistem) -' },
    ...lawan.akun.map((a) => ({ nilai: a.kode, teks: `${a.kode} — ${a.nama} (${judul(a.tipe)})` }))];

  function perbarui() {
    const masuk = pilihJenis.value === 'masuk';
    kolomHarga.style.display = masuk ? '' : 'none';
    const bawaan = masuk ? lawan.bawaanMasuk : lawan.bawaanKeluar;
    bantuanLawan.textContent = (masuk
      ? 'Jurnal otomatis: D Persediaan, K akun lawan. '
      : 'Jurnal otomatis: D akun lawan, K Persediaan (senilai HPP rata-rata). ')
      + `Kosongkan untuk memakai ${masuk ? 'akun pendapatan lain-lain' : 'akun beban selisih persediaan'} `
      + `pada Parameter Sistem${bawaan ? ` (${bawaan})` : ''}.`;
  }

  const form = el('div', [
    kolom('Barang', pilih('barang_id', barang.data.map((b) => ({
      nilai: b.id, teks: `${b.kode} — ${b.nama} (stok ${desimal(b.stok)})` }))), { wajib: true }),
    el('div.baris-form', [
      kolom('Gudang', pilih('gudang_id', gudang.data.map((g) => ({ nilai: g.id, teks: g.nama }))), { wajib: true }),
      kolom('Tanggal', input('tanggal', { tipe: 'date', nilai: hariIni() })),
    ]),
    el('div.baris-form.k3', [
      kolom('Jenis', pilihJenis),
      kolom('Kuantitas', input('qty', { tipe: 'number', step: 'any', min: 0 }), { wajib: true,
        bantuan: 'Selalu isi angka positif; arah mutasi mengikuti jenis' }),
      kolomHarga,
    ]),
    lawan.akun.length
      ? el('div.kolom', [el('label', 'Akun Lawan'), pilih('akun_lawan', opsiLawan), bantuanLawan])
      : el('div.notis.info', [el('div.isi', [el('strong', 'Penyesuaian dijurnal otomatis'), bantuanLawan])]),
    kolom('Keterangan', input('keterangan')),
  ]);
  perbarui();

  const tutup = modal({
    judul: 'Penyesuaian Stok', isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async (e) => {
        const tombol = e.currentTarget;
        tombol.disabled = true;
        try {
          const d = bacaForm(form);
          // Kuantitas selalu positif; arah mutasi ditentukan kolom Jenis. Angka negatif
          // ditolak (bukan dibalik diam-diam) agar kebiasaan lama "negatif = keluar" tidak salah arah.
          const qty = Number(d.qty);
          if (!(qty > 0)) {
            throw Object.assign(new Error('Kuantitas harus lebih besar dari nol'),
              { detail: 'Untuk mengurangi stok, pilih jenis "Barang Keluar" dan isi kuantitas positif.' });
          }
          const h = await api.post('/api/persediaan/penyesuaian', {
            ...d, qty, harga: d.jenis === 'masuk' ? d.harga : '', akun_lawan: d.akun_lawan || null });
          toast('Stok berhasil disesuaikan', 'sukses', h.jurnal
            ? `Nilai ${rp(h.nilai)} · jurnal ${h.jurnal.nomor}` : 'Tanpa jurnal (nilai nol)');
          tutup(); navigasi(location.hash, true);
        } catch (err) { galat(err); tombol.disabled = false; }
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
        const tombol = e.currentTarget;
        tombol.disabled = true;
        try {
          await api.post('/api/persediaan/transfer', bacaForm(form));
          toast('Transfer stok berhasil', 'sukses');
          tutup(); navigasi(location.hash, true);
        } catch (err) { galat(err); tombol.disabled = false; }
      } }, 'Transfer'),
    ],
  });
}
