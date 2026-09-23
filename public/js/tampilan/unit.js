/**
 * Modul 15 - Unit Usaha: kinerja per segmen dan transaksi pendapatan/biaya unit.
 */
import {
  api, el, kpi, panel, panelTabel, tabel, rp, angka, persen, judul, memuat, kosongkan, galat, tgl, status,
  modal, kolom, input, pilih, bacaForm, toast, hariIni, tabelServer, ukuranHalaman, ambilSemua,
} from '../inti.js';
import { grafikPeringkat, SERI } from '../grafik.js';
import { tombolCetak, cetakDokumen, tawaranCetak } from '../cetak.js';
import { izin } from '../app.js';
import { dokKas } from './kas.js';

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
  const isi = el('div');
  const daftarTab = [
    { judul: 'Kinerja per Unit', render: kinerjaTab },
    { judul: 'Transaksi Unit (Pendapatan & Biaya)', render: transaksiTab },
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

async function kinerjaTab() {
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

// ---------------------- Transaksi unit: pendapatan & biaya ----------------------

const bolehCatat = () => izin('unit.create') || izin('kas.create');
const bolehKoreksi = (k) => (izin('unit.koreksi') || izin('kas.koreksi')) && k.status !== 'batal' && !k.rekonsiliasi;
const akunTeks = (a) => `${a.kode} — ${a.nama}`;
const LABEL = { pendapatan: 'Pendapatan', biaya: 'Biaya' };

const ambilDokTransaksi = async (id) => dokKas(await api.get(`/api/unit-usaha/transaksi/${id}`));

/** Laporan daftar transaksi unit untuk dicetak / diekspor. */
function dokDaftarTransaksi(d, f, namaUnit) {
  return {
    judul: 'Laporan Transaksi Unit Usaha',
    subjudul: `${namaUnit || 'Seluruh unit'} · ${tgl(f.dari, true)} s.d. ${tgl(f.sampai, true)}`,
    jenis_ttd: 'laporan', orientasi: 'landscape',
    ringkasan: [
      { label: 'Pendapatan', nilai: rp(d.ringkasan.pendapatan) },
      { label: 'Biaya', nilai: rp(d.ringkasan.biaya) },
      { label: 'Selisih (pendapatan − biaya)', nilai: rp(d.ringkasan.selisih) },
    ],
    bagian: [{
      kolom: [
        { kunci: 'tanggal', label: 'Tanggal', tipe: 'tanggal' }, { kunci: 'nomor', label: 'Nomor' },
        { kunci: 'unit_nama', label: 'Unit' }, { kunci: 'akun', label: 'Akun' },
        { kunci: 'keterangan', label: 'Keterangan' }, { kunci: 'pihak', label: 'Pihak' },
        { kunci: 'pendapatan', label: 'Pendapatan', tipe: 'uang' }, { kunci: 'biaya', label: 'Biaya', tipe: 'uang' },
        { kunci: 'status', label: 'Status' },
      ],
      baris: d.data.map((k) => ({
        ...k, akun: `${k.coa_lawan} ${k.akun_lawan_nama || ''}`,
        pendapatan: k.jenis_unit === 'pendapatan' ? k.nominal : null,
        biaya: k.jenis_unit === 'biaya' ? k.nominal : null,
        status: k.status === 'batal' ? 'Batal' : 'Posted',
      })),
      total: { pendapatan: d.ringkasan.pendapatan, biaya: d.ringkasan.biaya },
    }],
    catatan: 'Total tidak termasuk transaksi yang dibatalkan. Pendapatan unit toko dan simpan pinjam '
      + 'yang berasal dari penjualan dan angsuran tampil pada tab Kinerja per Unit.',
  };
}

async function transaksiTab() {
  const wadah = el('div');
  const opsi = await api.get('/api/unit-usaha/opsi');
  const f = { unit_usaha_id: '', jenis: '', dari: `${new Date().getFullYear()}-01-01`, sampai: hariIni(), q: '' };
  const daftar = el('div');

  wadah.append(el('div.notis.info', [el('div.isi', [
    el('strong', 'Pendapatan & biaya unit usaha'),
    el('div.kecil', 'Catat di sini pendapatan dan biaya unit yang tidak berasal dari penjualan toko atau '
      + 'pinjaman, misalnya unit jasa, sewa, pertanian, atau transportasi. Setiap transaksi otomatis menjadi '
      + 'bukti kas masuk/keluar dan jurnal bertanda unit, sehingga masuk ke buku besar, laba rugi, neraca, '
      + 'dan laporan kinerja per unit.'),
  ])]), daftar);

  async function muat() {
    kosongkan(daftar).append(memuat());
    try {
      const ambil = (h) => api.get('/api/unit-usaha/transaksi', { ...f, ...h });
      const d = await ambil({ limit: ukuranHalaman(), offset: 0 });
      const batal = (k) => k.status === 'batal';
      const namaUnit = opsi.unit.find((u) => String(u.id) === String(f.unit_usaha_id))?.nama;
      kosongkan(daftar).append(
        el('div.grid.k3.mb16', [
          kpi('Pendapatan', rp(d.ringkasan.pendapatan), { jenis: 'sukses', catatan: namaUnit || 'Seluruh unit' }),
          kpi('Biaya', rp(d.ringkasan.biaya), { jenis: 'peringatan' }),
          kpi('Selisih', rp(d.ringkasan.selisih), { jenis: d.ringkasan.selisih >= 0 ? 'sukses' : 'bahaya',
            catatan: `${angka(d.ringkasan.jumlah)} transaksi berlaku` }),
        ]),
        panelTabel(`Transaksi Unit Usaha (${angka(d.total)})`, tabelServer([
          { judul: 'Tanggal', render: (k) => el('span.nowrap', tgl(k.tanggal)) },
          { judul: 'Nomor', render: (k) => el(batal(k) ? 'span.mono.kecil.samar' : 'span.mono.kecil', k.nomor) },
          { judul: 'Unit', render: (k) => el('span.kecil', k.unit_nama) },
          { judul: 'Jenis', render: (k) => status(k.jenis_unit === 'pendapatan' ? 'aktif' : 'peringatan',
            LABEL[k.jenis_unit]) },
          { judul: 'Akun', render: (k) => el('span.kecil', [el('span.mono', k.coa_lawan), ' ', k.akun_lawan_nama || '']) },
          { judul: 'Keterangan', render: (k) => el('div', [
            el('span.kecil', k.keterangan || '-'),
            k.pihak && el('div.kecil.samar', k.pihak),
            batal(k) && k.alasan_batal && el('div.kecil.neg', `Dibatalkan: ${k.alasan_batal}`),
          ]) },
          { judul: 'Nominal', angka: true, render: (k) => (batal(k) ? el('s.samar', rp(k.nominal))
            : el(k.jenis_unit === 'pendapatan' ? 'strong.pos' : 'strong.neg', rp(k.nominal))) },
          { judul: 'Status', render: (k) => status(batal(k) ? 'batal' : 'posted', batal(k) ? 'Batal' : 'Posted') },
          { judul: '', render: (k) => el('div.gap8', [
            el('button.btn.kecil.polos', { title: 'Cetak bukti kas', onclick: async (e) => {
              const t = e.currentTarget; t.disabled = true;
              try { await cetakDokumen(await ambilDokTransaksi(k.id)); } catch (err) { galat(err); } finally { t.disabled = false; }
            } }, 'Cetak'),
            bolehKoreksi(k) && el('button.btn.kecil', { title: 'Transaksi lama dibatalkan dan diganti bukti bernomor baru',
              onclick: () => formTransaksi(k.jenis_unit, opsi, muat, k) }, 'Ubah'),
            bolehKoreksi(k) && el('button.btn.kecil.polos', { title: 'Batalkan (jurnal dibalik)',
              onclick: () => formBatal(k, muat) }, 'Batal'),
          ].filter(Boolean)) },
        ], { awal: d, ambil, kosongTeks: 'Belum ada transaksi unit pada periode ini' }), [
          pilih('unit_usaha_id', [{ nilai: '', teks: 'Semua unit' },
            ...opsi.unit.map((u) => ({ nilai: u.id, teks: u.nama }))], f.unit_usaha_id,
          { onchange: (e) => { f.unit_usaha_id = e.target.value; muat(); } }),
          pilih('jenis', [{ nilai: '', teks: 'Pendapatan & biaya' }, { nilai: 'pendapatan', teks: 'Pendapatan' },
            { nilai: 'biaya', teks: 'Biaya' }], f.jenis, { onchange: (e) => { f.jenis = e.target.value; muat(); } }),
          el('input', { type: 'date', nilai: f.dari, onchange: (e) => { f.dari = e.target.value; muat(); } }),
          el('input', { type: 'date', nilai: f.sampai, onchange: (e) => { f.sampai = e.target.value; muat(); } }),
          tombolCetak(async () => dokDaftarTransaksi({ ...d, data: await ambilSemua(ambil) }, f, namaUnit),
            { label: 'Cetak' }),
          bolehCatat() && el('button.btn.utama', { onclick: () => formTransaksi('pendapatan', opsi, muat, null, f.unit_usaha_id) },
            '+ Pendapatan'),
          bolehCatat() && el('button.btn', { onclick: () => formTransaksi('biaya', opsi, muat, null, f.unit_usaha_id) },
            '+ Biaya'),
        ].filter(Boolean)),
      );
    } catch (err) { galat(err); }
  }
  await muat();
  return wadah;
}

/**
 * Formulir pendapatan/biaya unit. Akun terisi dari akun bawaan unit (Master
 * Data → Unit Usaha) dan berganti ketika unit diganti. Dengan `lama`,
 * formulir menjadi koreksi: transaksi lama dibatalkan, diganti bukti baru.
 */
function formTransaksi(jenis, opsi, saatSelesai, lama = null, unitAwal = '') {
  const pendapatan = jenis === 'pendapatan';
  const daftarAkun = pendapatan ? opsi.akun_pendapatan : opsi.akun_beban;
  const kolomBawaan = pendapatan ? 'coa_pendapatan' : 'coa_beban';
  const unitTerpilih = String(lama?.unit_usaha_id ?? unitAwal ?? '');
  const bawaanUnit = (id) => opsi.unit.find((u) => String(u.id) === String(id))?.[kolomBawaan] || '';

  const opsiAkun = [{ nilai: '', teks: '- pilih akun -' }, ...daftarAkun.map((a) => ({ nilai: a.kode, teks: akunTeks(a) }))];
  if (lama && !daftarAkun.some((a) => a.kode === lama.coa_lawan)) {
    opsiAkun.push({ nilai: lama.coa_lawan, teks: `${lama.coa_lawan} — ${lama.akun_lawan_nama || ''}` });
  }
  const opsiKas = [{ nilai: '', teks: '- pilih kas/bank -' }, ...opsi.akun_kas.map((a) => ({ nilai: a.kode, teks: akunTeks(a) }))];
  const pilihAkun = pilih('coa_akun', opsiAkun, lama?.coa_lawan ?? bawaanUnit(unitTerpilih));
  const pilihUnit = pilih('unit_usaha_id', [{ nilai: '', teks: '- pilih unit usaha -' },
    ...opsi.unit.map((u) => ({ nilai: u.id, teks: `${u.kode} — ${u.nama}` }))], unitTerpilih, {
    // Unit berganti → akun ikut bawaan unit baru (bila unit itu punya bawaan).
    onchange: (e) => { const b = bawaanUnit(e.target.value); if (b) pilihAkun.value = b; },
  });

  const form = el('div', [
    lama && el('div.notis.peringatan', [el('div.isi', [
      el('strong', `Koreksi ${lama.nomor}`),
      el('div.kecil', 'Transaksi lama tidak dihapus: dibatalkan (jurnal dibalik) lalu dibuat bukti pengganti '
        + 'bernomor baru. Buku besar, laba rugi, dan neraca ikut terkoreksi.'),
    ])]),
    kolom('Unit Usaha', pilihUnit, { wajib: true }),
    el('div.baris-form', [
      kolom('Tanggal', input('tanggal', { tipe: 'date', nilai: lama?.tanggal || hariIni() })),
      kolom('Nominal', input('nominal', { tipe: 'number', min: 1, nilai: lama?.nominal ?? '' }), { wajib: true }),
    ]),
    kolom(pendapatan ? 'Akun Pendapatan' : 'Akun Biaya', pilihAkun, { wajib: true,
      bantuan: `Bawaan per unit diatur di Master Data → Unit Usaha (Akun ${pendapatan ? 'Pendapatan' : 'Biaya'} Bawaan)` }),
    kolom(pendapatan ? 'Diterima di (Kas/Bank)' : 'Dibayar dari (Kas/Bank)', pilih('coa_kas', opsiKas, lama?.coa_kas),
      { wajib: true }),
    kolom('Keterangan', input('keterangan', { nilai: lama?.keterangan || '',
      placeholder: pendapatan ? 'mis. Sewa tenda acara pernikahan' : 'mis. Perawatan peralatan' })),
    kolom(pendapatan ? 'Diterima dari' : 'Dibayarkan kepada', input('pihak', { nilai: lama?.pihak || '',
      placeholder: 'Opsional' })),
    lama && kolom('Alasan Perubahan', el('textarea', { name: 'alasan', placeholder: 'mis. salah nominal / salah unit' }),
      { wajib: true }),
  ].filter(Boolean));

  const namaForm = `${LABEL[jenis]} Unit Usaha`;
  const tutup = modal({
    judul: lama ? `Ubah ${namaForm} ${lama.nomor}` : `Catat ${namaForm}`, isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async (e) => {
        const tombol = e.currentTarget;
        const data = bacaForm(form);
        if (!data.unit_usaha_id) { toast('Pilih unit usaha', 'peringatan'); return; }
        if (lama && !data.alasan.trim()) { toast('Alasan perubahan wajib diisi', 'peringatan'); return; }
        tombol.disabled = true;
        try {
          if (lama) {
            const h = await api.put(`/api/unit-usaha/transaksi/${lama.id}`, data);
            toast('Transaksi unit diubah', 'sukses', `${h.dibatalkan} dibatalkan → ${h.pengganti.nomor}`);
            tutup(); saatSelesai?.();
            tawaranCetak('Transaksi Unit Berhasil Diubah', el('dl.deskripsi', [
              el('dt', 'Bukti lama'), el('dd', [el('span.mono', h.dibatalkan), ' ', status('batal', 'Dibatalkan')]),
              el('dt', 'Bukti pengganti'), el('dd', el('span.mono', h.pengganti.nomor)),
            ]), () => ambilDokTransaksi(h.pengganti.id), { label: 'Cetak Bukti Pengganti' });
            return;
          }
          const h = await api.post('/api/unit-usaha/transaksi', { ...data, jenis });
          toast(`${LABEL[jenis]} ${h.unit.nama} tercatat`, 'sukses', `${h.nomor} · jurnal ${h.jurnal?.nomor || h.nomor}`);
          tutup(); saatSelesai?.();
          tawaranCetak(`${LABEL[jenis]} Unit Tersimpan`, el('dl.deskripsi', [
            el('dt', 'Nomor'), el('dd', el('span.mono', h.nomor)),
            el('dt', 'Unit'), el('dd', h.unit.nama),
            el('dt', 'Terbilang'), el('dd', el('em', judul(h.terbilang))),
          ]), () => ambilDokTransaksi(h.id));
        } catch (err) { galat(err); tombol.disabled = false; }
      } }, lama ? 'Simpan Perubahan' : 'Simpan'),
    ],
  });
}

/** Pembatalan transaksi unit: bukti tetap tersimpan berstatus batal, jurnalnya dibalik. */
function formBatal(k, saatSelesai) {
  const form = el('div', [
    el('div.notis.peringatan', [el('div.isi', [
      el('strong', `${k.nomor} · ${LABEL[k.jenis_unit]} ${k.unit_nama} ${rp(k.nominal)}`),
      el('div.kecil', 'Transaksi tidak dihapus. Sistem membuat jurnal balik dan menandainya batal, sehingga '
        + 'kas, pendapatan/biaya unit, dan neraca kembali seperti sebelum transaksi.'),
    ])]),
    kolom('Alasan Pembatalan', el('textarea', { name: 'alasan' }), { wajib: true }),
  ]);
  const tutup = modal({
    judul: `Batalkan ${k.nomor}`, isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Tutup'),
      el('button.btn.bahaya', { onclick: async (e) => {
        const tombol = e.currentTarget;
        const { alasan } = bacaForm(form);
        if (!alasan.trim()) { toast('Alasan pembatalan wajib diisi', 'peringatan'); return; }
        tombol.disabled = true;
        try {
          const h = await api.post(`/api/unit-usaha/transaksi/${k.id}/batal`, { alasan });
          toast(`${k.nomor} dibatalkan`, 'sukses', h.jurnal?.nomor ? `Jurnal balik ${h.jurnal.nomor}` : null);
          tutup(); saatSelesai?.();
        } catch (err) { galat(err); tombol.disabled = false; }
      } }, 'Batalkan Transaksi'),
    ],
  });
}
