/**
 * Modul 15 - Unit Usaha (pelaporan per segmen).
 */
import {
  api, el, kpi, panel, panelTabel, tabel, rp, angka, persen, judul, memuat, kosongkan, galat, tgl,
} from '../inti.js';
import { grafikPeringkat, SERI } from '../grafik.js';
import { tombolCetak } from '../cetak.js';

/** Laporan kinerja unit usaha dari GET /api/unit-usaha/kinerja. */
function dokKinerja(d, tahun) {
  return {
    judul: 'Laporan Kinerja Unit Usaha', subjudul: `Tahun buku ${tahun}`, jenis_ttd: 'laporan', orientasi: 'landscape',
    keterangan: [`Periode ${tgl(d.periode.dari, true)} s.d. ${tgl(d.periode.sampai, true)}`],
    ringkasan: [
      { label: 'Pendapatan konsolidasi', nilai: rp(d.konsolidasi.pendapatan) },
      { label: 'Beban konsolidasi', nilai: rp(d.konsolidasi.beban) },
      { label: 'SHU konsolidasi', nilai: rp(d.konsolidasi.shu) },
      { label: 'Tanpa penandaan unit', nilai: `Pendapatan ${rp(d.tanpa_unit.pendapatan)} · SHU ${rp(d.tanpa_unit.shu)}` },
    ],
    bagian: [{
      kolom: [
        { kunci: 'kode', label: 'Kode' }, { kunci: 'nama', label: 'Unit Usaha' }, { kunci: 'jenis', label: 'Jenis' },
        { kunci: 'pendapatan', label: 'Pendapatan', tipe: 'uang' }, { kunci: 'hpp', label: 'HPP', tipe: 'uang' },
        { kunci: 'laba_kotor', label: 'Laba Kotor', tipe: 'uang' }, { kunci: 'beban', label: 'Beban', tipe: 'uang' },
        { kunci: 'shu', label: 'SHU', tipe: 'uang' }, { kunci: 'margin', label: 'Margin', tipe: 'persen' },
      ],
      baris: d.per_unit.map((u) => ({ ...u, jenis: judul(u.jenis) })),
      total: { _label: 'KONSOLIDASI', pendapatan: d.konsolidasi.pendapatan, beban: d.konsolidasi.beban,
        shu: d.konsolidasi.shu },
    }],
    catatan: 'Transaksi yang tidak ditandai unit tertentu tidak termasuk dalam baris per unit.',
  };
}

export async function render() {
  const wadah = el('div');
  let tahun = new Date().getFullYear();
  const isi = el('div');

  let data = null;
  wadah.append(el('div.alat', [
    el('label.kecil.lembut', 'Tahun buku'),
    el('input', { type: 'number', nilai: tahun, gaya: { width: '110px' },
      onchange: (e) => { tahun = Number(e.target.value); muat(); } }),
    tombolCetak(() => {
      if (!data) throw new Error('Data kinerja belum dimuat');
      return dokKinerja(data, tahun);
    }),
  ]), isi);

  async function muat() {
    kosongkan(isi).append(memuat());
    try {
      data = null;
      const d = await api.get('/api/unit-usaha/kinerja', { tahun });
      data = d;
      kosongkan(isi).append(
        el('div.grid.k3.mb16', [
          kpi('Pendapatan Konsolidasi', rp(d.konsolidasi.pendapatan)),
          kpi('Beban Konsolidasi', rp(d.konsolidasi.beban)),
          kpi('SHU Konsolidasi', rp(d.konsolidasi.shu), {
            jenis: d.konsolidasi.shu >= 0 ? 'sukses' : 'bahaya' }),
        ]),
        el('div.notis.info', [el('div.isi', [
          el('strong', 'Pelaporan per segmen usaha'),
          el('div.kecil', 'Setiap unit usaha memiliki laporan hasil usaha tersendiri berdasarkan '
            + 'penandaan unit pada setiap baris jurnal (cost center). Transaksi yang tidak ditandai '
            + 'unit tertentu disajikan pada baris "tanpa unit".'),
        ])]),
        panelTabel(`Kinerja per Unit Usaha — Tahun ${tahun}`, tabel([
          { judul: 'Kode', render: (u) => el('span.mono.kecil', u.kode) },
          { judul: 'Unit Usaha', kunci: 'nama' },
          { judul: 'Jenis', render: (u) => judul(u.jenis) },
          { judul: 'Pendapatan', kunci: 'pendapatan', angka: true, render: (u) => rp(u.pendapatan) },
          { judul: 'HPP', angka: true, render: (u) => rp(u.hpp) },
          { judul: 'Laba Kotor', angka: true, render: (u) => rp(u.laba_kotor) },
          { judul: 'Beban', kunci: 'beban', angka: true, render: (u) => rp(u.beban) },
          { judul: 'SHU', kunci: 'shu', angka: true, render: (u) => el(u.shu >= 0 ? 'strong.pos' : 'strong.neg', rp(u.shu)) },
          { judul: 'Margin', angka: true, render: (u) => persen(u.margin) },
        ], d.per_unit, {
          kosongTeks: 'Belum ada unit usaha terdaftar',
          kaki: { nama: 'KONSOLIDASI', pendapatan: rp(d.konsolidasi.pendapatan),
            beban: rp(d.konsolidasi.beban), shu: rp(d.konsolidasi.shu) },
        })),
        el('div.grid.k2', [
          panel('Kontribusi Pendapatan per Unit', grafikPeringkat({
            baris: d.per_unit.map((u, i) => ({ label: u.nama, nilai: u.pendapatan,
              warna: SERI()[i % 4] })),
            format: rp,
          })),
          panel('Kontribusi SHU per Unit', grafikPeringkat({
            baris: d.per_unit.map((u, i) => ({ label: u.nama, nilai: u.shu, warna: SERI()[i % 4],
              catatan: `Margin ${persen(u.margin)}` })),
            format: rp,
          })),
        ]),
        el('div.panel', [el('div.panel-isi', [
          el('div.antara', [
            el('span.lembut', 'Transaksi tanpa penandaan unit usaha'),
            el('span', `Pendapatan ${rp(d.tanpa_unit.pendapatan)} · SHU ${rp(d.tanpa_unit.shu)}`),
          ]),
        ])]),
      );
    } catch (err) { galat(err); }
  }
  await muat();
  return wadah;
}
