/**
 * Modul 25 - Business Intelligence.
 */
import {
  api, el, kpi, panel, panelTabel, tabel, rp, rpRingkas, angka, persen, desimal, judul,
  memuat, kosongkan, galat, periodeLabel,
} from '../inti.js';
import { grafikGaris, grafikBatang, grafikPeringkat, grafikCincin, SERI } from '../grafik.js';

export async function render() {
  const wadah = el('div');
  const isi = el('div');
  const daftarTab = [
    { judul: 'Kesehatan Koperasi', render: kesehatanTab },
    { judul: 'Keanggotaan', render: keanggotaanTab },
    { judul: 'Pinjaman', render: pinjamanTab },
    { judul: 'Usaha & Toko', render: usahaTab },
    { judul: 'Proyeksi Kas', render: proyeksiTab },
  ];
  const bilah = el('div.tab', daftarTab.map((t, i) => el('button', {
    class: i === 0 ? 'aktif' : '',
    onclick: async (e) => {
      bilah.querySelectorAll('button').forEach((b) => b.classList.remove('aktif'));
      e.currentTarget.classList.add('aktif');
      kosongkan(isi).append(memuat());
      try { kosongkan(isi).append(await t.render()); } catch (err) { galat(err); }
    },
  }, t.judul)));
  wadah.append(el('div.panel', [bilah]), isi);
  isi.append(await daftarTab[0].render());
  return wadah;
}

async function kesehatanTab() {
  const d = await api.get('/api/bi/kesehatan');
  const r = d.rasio;
  const warna = d.skor_kesehatan >= 80 ? 'sukses' : d.skor_kesehatan >= 60 ? 'peringatan' : 'bahaya';
  return el('div', [
    el('div.grid.k2.mb16', [
      kpi('Skor Kesehatan', `${d.skor_kesehatan} / 100`, { jenis: warna, ikon: '❤️' }),
      kpi('Predikat', d.predikat, { jenis: warna }),
    ]),
    el('div.notis.info', [el('div.isi', [
      el('strong', 'Metodologi penilaian'), el('div.kecil', d.catatan)])]),
    el('div.grid.k2', [
      panel('Likuiditas', el('div', [
        el('dl.deskripsi', [
          el('dt', 'Rasio lancar'), el('dd', persen(r.likuiditas.rasio_lancar)),
          el('dt', 'Rasio kas'), el('dd', persen(r.likuiditas.rasio_kas)),
        ]),
        el('div.kecil.samar.mt8', r.likuiditas.keterangan),
      ])),
      panel('Solvabilitas & Permodalan', el('dl.deskripsi', [
        el('dt', 'Rasio utang terhadap aset'), el('dd', persen(r.solvabilitas.rasio_hutang_aset)),
        el('dt', 'Rasio modal sendiri'), el('dd', persen(r.solvabilitas.rasio_modal_sendiri)),
      ])),
      panel('Rentabilitas', el('dl.deskripsi', [
        el('dt', 'ROA'), el('dd', persen(r.rentabilitas.roa)),
        el('dt', 'ROE'), el('dd', persen(r.rentabilitas.roe)),
        el('dt', 'Margin SHU'), el('dd', persen(r.rentabilitas.margin_shu)),
      ])),
      panel('Kualitas Aktiva Produktif', el('div', [
        el('dl.deskripsi', [
          el('dt', 'Pinjaman beredar'), el('dd', rp(r.kualitas_pinjaman.outstanding)),
          el('dt', 'Kredit bermasalah'), el('dd', rp(r.kualitas_pinjaman.npl_nominal)),
          el('dt', 'Rasio NPL'), el('dd', el(r.kualitas_pinjaman.npl_ratio < 5 ? 'strong.pos' : 'strong.neg',
            persen(r.kualitas_pinjaman.npl_ratio))),
        ]),
        el('div.kecil.samar.mt8', r.kualitas_pinjaman.keterangan),
      ])),
    ]),
  ]);
}

async function keanggotaanTab() {
  const d = await api.get('/api/bi/keanggotaan');
  return el('div', [
    el('div.grid.k2', [
      panel('Pertumbuhan Anggota (24 bulan)', grafikBatang({
        label: d.pertumbuhan.map((p) => p.periode.slice(2)),
        data: d.pertumbuhan.map((p) => p.bergabung),
        tinggi: 210, format: (v) => angka(v),
      })),
      panel('Sebaran Usia Anggota', grafikCincin({
        bagian: d.per_usia.map((u) => ({ label: u.kelompok, nilai: u.jumlah })),
        tengahLabel: 'Anggota', tengahNilai: angka(d.per_usia.reduce((s, u) => s + u.jumlah, 0)),
      })),
    ]),
    el('div.grid.k2', [
      panel('Sebaran Pekerjaan', grafikPeringkat({
        baris: d.per_pekerjaan.map((p) => ({ label: p.pekerjaan, nilai: p.jumlah })),
        format: (v) => `${angka(v)} orang`,
      })),
      panelTabel('10 Penyimpan Terbesar', tabel([
        { judul: 'No. Anggota', render: (a) => el('span.mono.kecil', a.nomor_anggota) },
        { judul: 'Nama', kunci: 'nama' },
        { judul: 'Saldo Simpanan', angka: true, render: (a) => el('strong', rp(a.saldo)) },
      ], d.top_simpanan)),
    ]),
  ]);
}

async function pinjamanTab() {
  const d = await api.get('/api/bi/pinjaman');
  const pf = d.portofolio;
  return el('div', [
    el('div.grid.k3.mb16', [
      kpi('Outstanding', rpRingkas(pf.total_outstanding), { catatan: rp(pf.total_outstanding) }),
      kpi('NPL', persen(pf.npl_ratio), { jenis: pf.npl_ratio < 5 ? 'sukses' : 'bahaya' }),
      kpi('Status Portofolio', judul(pf.status_kesehatan)),
    ]),
    el('div.grid.k2', [
      panel('Pencairan per Bulan', grafikBatang({
        label: d.pencairan_bulanan.map((p) => p.periode.slice(5)),
        data: d.pencairan_bulanan.map((p) => p.nominal), tinggi: 210,
      })),
      panel('Pendapatan Jasa & Denda', grafikGaris({
        label: d.pendapatan_jasa.map((p) => p.periode.slice(5)),
        seri: [
          { nama: 'Jasa pinjaman', data: d.pendapatan_jasa.map((p) => p.bunga) },
          { nama: 'Denda', data: d.pendapatan_jasa.map((p) => p.denda) },
        ],
        tinggi: 210,
      })),
    ]),
    panelTabel('Kinerja per Produk Pinjaman', tabel([
      { judul: 'Produk', kunci: 'nama' },
      { judul: 'Jumlah', angka: true, render: (p) => angka(p.jumlah) },
      { judul: 'Total Pencairan', angka: true, render: (p) => rp(p.pencairan) },
      { judul: 'Outstanding', angka: true, render: (p) => el('strong', rp(p.outstanding)) },
    ], d.per_produk)),
    panelTabel('Tunggakan Terbesar', tabel([
      { judul: 'Nomor', render: (t) => el('span.mono.kecil', t.nomor) },
      { judul: 'Anggota', kunci: 'nama' },
      { judul: 'Outstanding', angka: true, render: (t) => rp(t.outstanding_pokok) },
      { judul: 'Tunggakan', angka: true, render: (t) => el('span.neg', `${t.tunggakan_hari} hari`) },
      { judul: 'Kolektibilitas', angka: true, kunci: 'kolektibilitas' },
    ], d.tunggakan_terbesar, { kosongTeks: 'Tidak ada tunggakan ✓' })),
  ]);
}

async function usahaTab() {
  const d = await api.get('/api/bi/usaha');
  const k = d.kontribusi_anggota;
  return el('div', [
    panel('Omzet, HPP & Laba Kotor per Bulan', grafikGaris({
      label: d.penjualan_bulanan.map((p) => periodeLabel(p.periode).replace(/ \d{4}$/, '')),
      seri: [
        { nama: 'Omzet', data: d.penjualan_bulanan.map((p) => p.omzet) },
        { nama: 'HPP', data: d.penjualan_bulanan.map((p) => p.hpp) },
        { nama: 'Laba kotor', data: d.penjualan_bulanan.map((p) => p.laba_kotor) },
      ],
      tinggi: 250,
    })),
    el('div.grid.k2', [
      panel('Kontribusi Anggota vs Non-Anggota', el('div', [
        grafikCincin({
          bagian: [
            { label: 'Belanja anggota', nilai: k.anggota },
            { label: 'Belanja umum', nilai: k.non_anggota },
          ],
          tengahLabel: 'Anggota', tengahNilai: persen(k.persen_anggota),
        }),
        el('div.kecil.samar.mt8', 'Semakin tinggi porsi belanja anggota, semakin besar '
          + 'dasar perhitungan jasa usaha dalam pembagian SHU.'),
      ])),
      panel('Metode Pembayaran', grafikPeringkat({
        baris: d.per_metode_bayar.map((m, i) => ({ label: judul(m.metode_bayar), nilai: m.nilai,
          warna: SERI()[i % 4], catatan: `${angka(m.jumlah)} transaksi` })),
        format: rp,
      })),
    ]),
    panelTabel('Barang Terlaris', tabel([
      { judul: 'Kode', render: (b) => el('span.mono.kecil', b.kode) },
      { judul: 'Barang', kunci: 'nama' },
      { judul: 'Qty Terjual', angka: true, render: (b) => desimal(b.qty) },
      { judul: 'Omzet', angka: true, render: (b) => rp(b.omzet) },
      { judul: 'Margin', angka: true, render: (b) => el('span.pos', rp(b.margin)) },
    ], d.barang_terlaris, { kosongTeks: 'Belum ada penjualan' })),
    el('div.grid.k2', [
      panelTabel('Nilai Persediaan', tabel([
        { judul: 'Barang', kunci: 'nama' },
        { judul: 'Stok', angka: true, render: (b) => desimal(b.qty) },
        { judul: 'Nilai', angka: true, render: (b) => rp(b.nilai) },
      ], d.persediaan.baris.slice(0, 10), {
        kaki: { nama: 'TOTAL', nilai: rp(d.persediaan.total_nilai) },
      })),
      panelTabel('Aset Tetap per Kategori', tabel([
        { judul: 'Kategori', render: (a) => judul(a.kategori || '-') },
        { judul: 'Unit', angka: true, render: (a) => angka(a.jumlah) },
        { judul: 'Nilai Buku', angka: true, render: (a) => rp(a.nilai_buku) },
      ], d.aset.per_kategori, {
        kaki: { kategori: 'TOTAL', nilai_buku: rp(d.aset.total_nilai_buku) },
      })),
    ]),
  ]);
}

async function proyeksiTab() {
  const d = await api.get('/api/bi/proyeksi-kas');
  return el('div', [
    el('div.grid.k2.mb16', [
      kpi('Saldo Kas & Bank Saat Ini', rp(d.saldo_awal)),
      kpi('Basis Beban Bulanan', rp(d.basis_beban_bulanan), {
        catatan: 'Rata-rata 3 bulan terakhir' }),
    ]),
    el('div.notis.info', [el('div.isi', [
      el('strong', 'Metode proyeksi'),
      el('div.kecil', 'Penerimaan diproyeksikan dari jadwal angsuran pinjaman yang jatuh tempo '
        + 'ditambah setoran simpanan wajib. Pengeluaran memakai rata-rata beban operasional '
        + 'tiga bulan terakhir. Proyeksi bersifat indikatif untuk perencanaan likuiditas.'),
    ])]),
    panel('Proyeksi Arus Kas 6 Bulan ke Depan', grafikGaris({
      label: d.proyeksi.map((p) => periodeLabel(p.periode).replace(/ \d{4}$/, '')),
      seri: [
        { nama: 'Penerimaan', data: d.proyeksi.map((p) => p.penerimaan) },
        { nama: 'Pengeluaran', data: d.proyeksi.map((p) => p.pengeluaran) },
        { nama: 'Saldo akhir', data: d.proyeksi.map((p) => p.saldo_akhir) },
      ],
      tinggi: 250,
    })),
    panelTabel('Rincian Proyeksi', tabel([
      { judul: 'Periode', render: (p) => periodeLabel(p.periode) },
      { judul: 'Penerimaan', angka: true, render: (p) => el('span.pos', rp(p.penerimaan)) },
      { judul: 'Pengeluaran', angka: true, render: (p) => el('span.neg', rp(p.pengeluaran)) },
      { judul: 'Arus Bersih', angka: true, render: (p) => el(p.arus_bersih >= 0 ? 'span.pos' : 'span.neg',
        rp(p.arus_bersih)) },
      { judul: 'Saldo Akhir', angka: true, render: (p) => el(p.saldo_akhir >= 0 ? 'strong' : 'strong.neg',
        rp(p.saldo_akhir)) },
    ], d.proyeksi)),
  ]);
}
