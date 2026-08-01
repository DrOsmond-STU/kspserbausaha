/**
 * Modul 15 - Unit Usaha (pelaporan per segmen).
 */
import {
  api, el, kpi, panel, panelTabel, tabel, rp, angka, persen, judul, memuat, kosongkan, galat, tgl,
} from '../inti.js';
import { grafikPeringkat, SERI } from '../grafik.js';

export async function render() {
  const wadah = el('div');
  let tahun = new Date().getFullYear();
  const isi = el('div');

  wadah.append(el('div.alat', [
    el('label.kecil.lembut', 'Tahun buku'),
    el('input', { type: 'number', nilai: tahun, gaya: { width: '110px' },
      onchange: (e) => { tahun = Number(e.target.value); muat(); } }),
  ]), isi);

  async function muat() {
    kosongkan(isi).append(memuat());
    try {
      const d = await api.get('/api/unit-usaha/kinerja', { tahun });
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
