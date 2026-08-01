/**
 * Modul 7 - Akuntansi (jurnal, periode, tutup buku).
 */
import {
  api, el, kpi, panel, panelTabel, tabel, rp, angka, tgl, status, judul, modal, kolom, input,
  pilih, bacaForm, toast, galat, memuat, kosongkan, hariIni, kosong, konfirmasi,
} from '../inti.js';
import { izin, navigasi } from '../app.js';

export async function render(param) {
  if (param[0]) return detailJurnal(Number(param[0]));

  const wadah = el('div');
  const tabIsi = el('div');
  const daftarTab = [
    { judul: 'Jurnal Umum', render: jurnalTab },
    { judul: 'Periode Akuntansi', render: periodeTab },
    { judul: 'Jurnal Berulang', render: recurringTab },
  ];
  let aktif = 0;
  const bilah = el('div.tab', daftarTab.map((t, i) => el('button', {
    class: i === 0 ? 'aktif' : '',
    onclick: async (e) => {
      aktif = i;
      bilah.querySelectorAll('button').forEach((b) => b.classList.remove('aktif'));
      e.currentTarget.classList.add('aktif');
      kosongkan(tabIsi).append(memuat());
      kosongkan(tabIsi).append(await t.render());
    },
  }, t.judul)));
  wadah.append(el('div.panel', [bilah]), tabIsi);
  tabIsi.append(await daftarTab[aktif].render());
  return wadah;
}

// ------------------------------- Jurnal -------------------------------

async function jurnalTab() {
  const wadah = el('div');
  let dari = `${new Date().getFullYear()}-01-01`;
  let sampai = hariIni();
  let tipe = '';
  let q = '';

  async function muat() {
    kosongkan(wadah).append(memuat());
    try {
      const d = await api.get('/api/akuntansi/jurnal', { dari, sampai, tipe, q, limit: 200 });
      kosongkan(wadah).append(panelTabel(`Jurnal (${angka(d.total)})`, tabel([
        { judul: 'Tanggal', render: (j) => el('span.nowrap', tgl(j.tanggal)) },
        { judul: 'Nomor', render: (j) => el('span.mono.kecil', j.nomor) },
        { judul: 'Tipe', render: (j) => judul(j.tipe) },
        { judul: 'Keterangan', render: (j) => el('span.kecil', j.keterangan || '-') },
        { judul: 'Debit', angka: true, render: (j) => rp(j.total_debit) },
        { judul: 'Kredit', angka: true, render: (j) => rp(j.total_kredit) },
        { judul: 'Status', render: (j) => status(j.status) },
      ], d.data, { saatKlik: (j) => { location.hash = `#/akuntansi/${j.id}`; } }), [
        el('input', { type: 'search', placeholder: 'Cari nomor atau keterangan…',
          oninput: (e) => { q = e.target.value; clearTimeout(muat.t); muat.t = setTimeout(muat, 320); } }),
        el('input', { type: 'date', nilai: dari, onchange: (e) => { dari = e.target.value; muat(); } }),
        el('input', { type: 'date', nilai: sampai, onchange: (e) => { sampai = e.target.value; muat(); } }),
        pilih('t', ['', 'umum', 'kas_masuk', 'kas_keluar', 'simpanan', 'pinjaman', 'penjualan',
          'pembelian', 'penyusutan', 'penyesuaian', 'penutup', 'pembuka', 'shu']
          .map((s) => ({ nilai: s, teks: s ? judul(s) : 'Semua tipe' })), tipe,
        { onchange: (e) => { tipe = e.target.value; muat(); } }),
        izin('akuntansi.create') && el('button.btn.utama', { onclick: () => formJurnal(muat) }, '+ Jurnal Manual'),
      ].filter(Boolean)));
    } catch (err) { galat(err); }
  }
  await muat();
  return wadah;
}

async function detailJurnal(id) {
  const j = await api.get(`/api/akuntansi/jurnal/${id}`);
  const wadah = el('div');
  wadah.append(el('div.gap8.mb16', [
    el('button.btn', { onclick: () => { location.hash = '#/akuntansi'; } }, '← Kembali'),
    izin('akuntansi.post') && j.status === 'posted' && el('button.btn.bahaya', {
      onclick: () => batalkan(j),
    }, '↩ Batalkan Jurnal'),
    el('button.btn', { onclick: () => window.print() }, 'Cetak'),
  ].filter(Boolean)));

  wadah.append(panel(`Jurnal ${j.nomor}`, el('dl.deskripsi', [
    el('dt', 'Tanggal'), el('dd', tgl(j.tanggal, true)),
    el('dt', 'Tipe'), el('dd', judul(j.tipe)),
    el('dt', 'Keterangan'), el('dd', j.keterangan || '-'),
    el('dt', 'Referensi'), el('dd', el('span.mono.kecil', j.referensi || '-')),
    el('dt', 'Dibuat oleh'), el('dd', j.dibuat_oleh || '-'),
    el('dt', 'Status'), el('dd', status(j.status)),
    j.void_alasan && el('dt', 'Alasan pembatalan'), j.void_alasan && el('dd', j.void_alasan),
    el('dt', 'Terbilang'), el('dd', el('em', judul(j.terbilang))),
  ].filter(Boolean))));

  wadah.append(panelTabel('Rincian Jurnal', tabel([
    { judul: 'Akun', render: (d) => el('span.mono.kecil', d.coa_kode) },
    { judul: 'Nama Akun', kunci: 'akun_nama' },
    { judul: 'Keterangan', render: (d) => el('span.kecil.lembut', d.keterangan || '-') },
    { judul: 'Debit', kunci: 'debit', angka: true, render: (d) => (d.debit ? rp(d.debit) : '-') },
    { judul: 'Kredit', kunci: 'kredit', angka: true, render: (d) => (d.kredit ? rp(d.kredit) : '-') },
  ], j.detail, {
    kaki: { akun_nama: 'TOTAL', debit: rp(j.total_debit), kredit: rp(j.total_kredit) },
  })));
  return wadah;
}

function batalkan(j) {
  const form = el('div', [
    el('div.notis.peringatan', [el('div.isi', [
      el('strong', 'Jurnal tidak dihapus'),
      el('div.kecil', 'Sistem membuat jurnal balik (reversing entry) sehingga jejak audit tetap utuh '
        + 'sesuai UU ITE. Jurnal asli ditandai sebagai dibatalkan.'),
    ])]),
    kolom('Alasan Pembatalan', el('textarea', { name: 'alasan' }), { wajib: true }),
  ]);
  const tutup = modal({
    judul: `Batalkan Jurnal ${j.nomor}`, isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.bahaya', { onclick: async () => {
        try {
          const h = await api.post(`/api/akuntansi/jurnal/${j.id}/batal`, bacaForm(form));
          toast('Jurnal dibatalkan', 'sukses', `Jurnal balik ${h.nomor} dibuat`);
          tutup(); navigasi(location.hash, true);
        } catch (err) { galat(err); }
      } }, 'Batalkan'),
    ],
  });
}

// --------------------------- Jurnal manual ---------------------------

async function formJurnal(saatSelesai) {
  const coa = await api.get('/api/master/coa', { limit: 500 });
  const akun = coa.data.filter((c) => c.is_postable && c.status === 'aktif');
  const baris = [{}, {}];
  const daftar = el('div');
  const ringkas = el('div.antara.mt8');

  function gambar() {
    kosongkan(daftar);
    baris.forEach((b, i) => {
      daftar.append(el('div', { gaya: { display: 'grid', gap: '8px', marginBottom: '8px',
        gridTemplateColumns: 'minmax(0,2.2fr) minmax(0,1.6fr) minmax(0,1fr) minmax(0,1fr) auto',
        alignItems: 'center' } }, [
        el('select', { onchange: (e) => { b.coa_kode = e.target.value; } },
          [el('option', { value: '' }, '- pilih akun -'),
            ...akun.map((a) => el('option', { value: a.kode, selected: a.kode === b.coa_kode },
              `${a.kode} — ${a.nama}`))]),
        el('input', { type: 'text', placeholder: 'Keterangan baris',
          nilai: b.keterangan || '', oninput: (e) => { b.keterangan = e.target.value; } }),
        el('input', { type: 'number', class: 'angka', placeholder: 'Debit', min: 0,
          nilai: b.debit || '', oninput: (e) => {
            b.debit = Number(e.target.value) || 0;
            if (b.debit) { b.kredit = 0; e.target.parentElement.querySelectorAll('input')[1].value = ''; }
            hitung();
          } }),
        el('input', { type: 'number', class: 'angka', placeholder: 'Kredit', min: 0,
          nilai: b.kredit || '', oninput: (e) => {
            b.kredit = Number(e.target.value) || 0;
            if (b.kredit) b.debit = 0;
            hitung();
          } }),
        el('button.btn.kecil.polos', { disabled: baris.length <= 2,
          onclick: () => { baris.splice(i, 1); gambar(); } }, '✕'),
      ]));
    });
    hitung();
  }

  function hitung() {
    const d = baris.reduce((s, b) => s + (Number(b.debit) || 0), 0);
    const k = baris.reduce((s, b) => s + (Number(b.kredit) || 0), 0);
    const seimbang = d === k && d > 0;
    kosongkan(ringkas).append(
      el('span.lembut', `Total debit ${rp(d)} · total kredit ${rp(k)}`),
      el('strong', { class: seimbang ? 'pos' : 'neg' },
        seimbang ? '✓ Seimbang' : `Selisih ${rp(Math.abs(d - k))}`),
    );
  }

  const form = el('div', [
    el('div.baris-form.k3', [
      kolom('Tanggal', input('tanggal', { tipe: 'date', nilai: hariIni() })),
      kolom('Tipe', pilih('tipe', ['umum', 'penyesuaian', 'pembuka']
        .map((t) => ({ nilai: t, teks: judul(t) })))),
      kolom('Referensi', input('referensi', { placeholder: 'Opsional' })),
    ]),
    kolom('Keterangan Jurnal', input('keterangan'), { wajib: true }),
    el('div.tebal.mt16.mb8', 'Rincian Jurnal'),
    daftar,
    el('button.btn.kecil', { onclick: () => { baris.push({}); gambar(); } }, '+ Tambah Baris'),
    ringkas,
  ]);
  gambar();

  const tutup = modal({
    judul: 'Jurnal Manual', lebar: 'lebar', isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async (e) => {
        e.currentTarget.disabled = true;
        try {
          const d = bacaForm(form);
          const h = await api.post('/api/akuntansi/jurnal', {
            ...d, lines: baris.filter((b) => b.coa_kode && (b.debit || b.kredit)) });
          toast('Jurnal berhasil diposting', 'sukses', `${h.nomor} · ${rp(h.total)}`);
          tutup(); saatSelesai?.();
        } catch (err) { galat(err); e.currentTarget.disabled = false; }
      } }, 'Posting Jurnal'),
    ],
  });
}

// ------------------------------ Periode ------------------------------

async function periodeTab() {
  const wadah = el('div');
  let tahun = new Date().getFullYear();

  async function muat() {
    kosongkan(wadah).append(memuat());
    try {
      const d = await api.get('/api/akuntansi/periode', { tahun });
      kosongkan(wadah).append(
        el('div.notis.info', [el('div.isi', [
          el('strong', 'Penutupan periode mengunci pembukuan'),
          el('div.kecil', 'Setelah periode ditutup, tidak ada transaksi baru yang dapat diposting '
            + 'pada bulan tersebut. Neraca saldo wajib seimbang sebelum penutupan.'),
        ])]),
        panelTabel(`Periode Akuntansi ${tahun}`, tabel([
          { judul: 'Bulan', render: (p) => ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
            'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'][p.bulan - 1] },
          { judul: 'Status', render: (p) => status(p.status === 'tutup' ? 'netral' : 'aktif',
            p.status === 'tutup' ? 'Ditutup' : 'Terbuka') },
          { judul: 'Ditutup Oleh', render: (p) => p.ditutup_oleh || '-' },
          { judul: 'Waktu', render: (p) => (p.ditutup_pada ? tgl(p.ditutup_pada) : '-') },
          { judul: '', render: (p) => (izin('akuntansi.post')
            ? el('button.btn.kecil', {
              onclick: async () => {
                try {
                  const aksi = p.status === 'tutup' ? 'buka' : 'tutup';
                  if (aksi === 'tutup' && !await konfirmasi(
                    `Tutup periode ${p.bulan}/${tahun}? Transaksi pada bulan ini tidak dapat diubah lagi.`,
                    { ya: 'Tutup Periode' })) return;
                  await api.post(`/api/akuntansi/periode/${aksi}`, { tahun, bulan: p.bulan });
                  toast(`Periode berhasil di${aksi}`, 'sukses');
                  muat();
                } catch (err) { galat(err); }
              },
            }, p.status === 'tutup' ? 'Buka' : 'Tutup') : '') },
        ], d.data), [
          el('input', { type: 'number', nilai: tahun, gaya: { width: '110px' },
            onchange: (e) => { tahun = Number(e.target.value); muat(); } }),
          izin('akuntansi.post') && el('button.btn.bahaya', { onclick: async () => {
            if (!await konfirmasi(`Buat jurnal penutup tahun ${tahun}? Seluruh akun pendapatan dan `
              + 'beban akan ditutup ke akun SHU Tahun Berjalan.', { ya: 'Buat Jurnal Penutup' })) return;
            try {
              const h = await api.post('/api/akuntansi/tutup-tahun', { tahun });
              toast('Jurnal penutup berhasil dibuat', 'sukses', `${h.nomor} · ${rp(h.total)}`);
            } catch (err) { galat(err); }
          } }, 'Tutup Buku Tahunan'),
        ].filter(Boolean)),
      );
    } catch (err) { galat(err); }
  }
  await muat();
  return wadah;
}

// --------------------------- Jurnal berulang ---------------------------

async function recurringTab() {
  const d = await api.get('/api/akuntansi/recurring');
  return panelTabel('Jurnal Berulang (Recurring)', tabel([
    { judul: 'Nama', kunci: 'nama' },
    { judul: 'Frekuensi', render: (r) => judul(r.frekuensi) },
    { judul: 'Mulai', render: (r) => tgl(r.tanggal_mulai) },
    { judul: 'Terakhir Dibuat', render: (r) => (r.terakhir_dibuat ? tgl(r.terakhir_dibuat) : '-') },
    { judul: 'Status', render: (r) => status(r.status) },
    { judul: '', render: (r) => (izin('akuntansi.post') ? el('button.btn.kecil', {
      onclick: async () => {
        try {
          const h = await api.post(`/api/akuntansi/recurring/${r.id}/jalankan`, {});
          toast('Jurnal berulang diposting', 'sukses', h.nomor);
        } catch (err) { galat(err); }
      },
    }, 'Jalankan') : '') },
  ], d.data, { kosongTeks: 'Belum ada jurnal berulang yang dikonfigurasi' }));
}
