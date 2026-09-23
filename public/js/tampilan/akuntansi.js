/**
 * Modul 7 - Akuntansi (jurnal, periode, tutup buku).
 */
import {
  api, el, kpi, panel, panelTabel, tabel, rp, angka, tgl, status, judul, modal, kolom, input,
  pilih, bacaForm, toast, galat, memuat, kosongkan, hariIni, kosong, konfirmasi,
} from '../inti.js';
import { izin, navigasi } from '../app.js';
import { cetakDokumen, tombolCetak, tawaranCetak, tandaAir } from '../cetak.js';

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
      const tombol = e.currentTarget;
      aktif = i;
      bilah.querySelectorAll('button').forEach((b) => b.classList.remove('aktif'));
      tombol.classList.add('aktif');
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
        { judul: 'Sumber', render: (j) => lencanaSumber(j.sumber) },
        { judul: 'Keterangan', render: (j) => el('span.kecil', j.keterangan || '-') },
        { judul: 'Debit', angka: true, render: (j) => rp(j.total_debit) },
        { judul: 'Kredit', angka: true, render: (j) => rp(j.total_kredit) },
        { judul: 'Status', render: (j) => status(j.status) },
        { judul: '', render: (j) => el('div.gap8.nowrap', { onclick: (e) => e.stopPropagation() }, [
          el('button.btn.kecil.polos', {
            title: 'Cetak bukti jurnal memorial',
            onclick: (e) => cetakJurnal(e, j.id),
          }, 'Cetak'),
          bolehKoreksi(j) && el('button.btn.kecil', { onclick: () => ubahJurnal(j.id, muat) }, 'Ubah'),
          bolehKoreksi(j) && el('button.btn.kecil.polos', { onclick: () => batalkan(j, muat) }, 'Batal'),
        ].filter(Boolean)) },
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

/**
 * Jurnal yang boleh diubah/dibatalkan dari buku besar: jurnal manual atau hasil
 * jurnal berulang yang masih posted dan bukan jurnal balik. Jurnal otomatis
 * modul dikoreksi dari dokumen sumbernya. Hanya untuk pemegang izin koreksi.
 */
const jurnalManual = (j) => j.status === 'posted' && ['manual', 'recurring'].includes(j.sumber)
  && !String(j.referensi || '').startsWith('void:') && j.tipe !== 'penutup';
const bolehKoreksi = (j) => izin('akuntansi.koreksi') && jurnalManual(j);

/** Lencana asal jurnal: manual, berulang, atau otomatis dari modul. */
const SUMBER = {
  manual: ['baru', 'Manual'],
  recurring: ['review', 'Berulang'],
  sistem: ['nonaktif', 'Sistem'],
};
function lencanaSumber(s) {
  const [warna, label] = SUMBER[s] || SUMBER.manual;
  return status(warna, label);
}

// ---------------------------- Cetak bukti ----------------------------

/** Model dokumen Bukti Jurnal Memorial dari detail jurnal (GET /api/akuntansi/jurnal/:id). */
export function dokJurnal(j) {
  const batal = j.status === 'void';
  return {
    judul: 'Bukti Jurnal Memorial', nomor: j.nomor, jenis_ttd: 'jurnal_memorial',
    ringkasan: [
      { label: 'Tanggal', nilai: j.tanggal, tipe: 'tanggal' },
      { label: 'Tipe jurnal', nilai: judul(j.tipe) },
      { label: 'Keterangan', nilai: j.keterangan || '-' },
      { label: 'Referensi', nilai: j.referensi || '-' },
      { label: 'Dibuat oleh', nilai: j.dibuat_oleh || '-' },
      { label: 'Status', nilai: batal ? 'DIBATALKAN' : judul(j.status) },
    ],
    isi: batal ? tandaAir('BATAL') : undefined,
    bagian: [{
      kolom: [
        { kunci: 'coa_kode', label: 'Kode Akun' },
        { kunci: 'akun_nama', label: 'Nama Akun' },
        { kunci: 'keterangan', label: 'Keterangan' },
        { kunci: 'debit', label: 'Debit', tipe: 'uang' },
        { kunci: 'kredit', label: 'Kredit', tipe: 'uang' },
      ],
      baris: (j.detail || []).map((d) => ({ coa_kode: d.coa_kode, akun_nama: d.akun_nama,
        keterangan: d.keterangan || '', debit: d.debit || null, kredit: d.kredit || null })),
      total: { debit: j.total_debit, kredit: j.total_kredit },
    }],
    terbilang: judul(j.terbilang),
    catatan: batal && j.void_alasan ? `Alasan pembatalan: ${j.void_alasan}` : undefined,
  };
}

const ambilDokJurnal = async (id) => dokJurnal(await api.get(`/api/akuntansi/jurnal/${id}`));

/** Mencetak bukti jurnal dari tombol baris (tombol dikunci selama data diambil). */
async function cetakJurnal(e, id) {
  const tombol = e.currentTarget;
  tombol.disabled = true;
  try { await cetakDokumen(await ambilDokJurnal(id)); } catch (err) { galat(err); } finally { tombol.disabled = false; }
}

/** Daftar jurnal yang baru terbentuk (mis. dari jurnal berulang) dengan tombol cetak per jurnal. */
function tawaranCetakDaftar(judulDialog, daftar) {
  const tutup = modal({
    judul: judulDialog, lebar: 'sempit',
    isi: el('div', daftar.map((j) => el('div.antara.mb8', [
      el('span', [el('span.mono.kecil', j.nomor), j.tanggal ? el('span.kecil.lembut', ` · ${tgl(j.tanggal)}`) : null]),
      el('button.btn.kecil', { onclick: (e) => cetakJurnal(e, j.jurnal_id || j.id) }, 'Cetak Bukti'),
    ]))),
    kaki: [el('button.btn.utama', { onclick: () => tutup() }, 'Tutup')],
  });
}

async function detailJurnal(id) {
  const j = await api.get(`/api/akuntansi/jurnal/${id}`);
  // Server menghitung dapat_dibatalkan; jurnal balik & jurnal sistem (selain penutup) tidak boleh dibatalkan di sini.
  const bisaBatal = j.status === 'posted' && j.dapat_dibatalkan !== false;
  const koreksi = izin('akuntansi.koreksi');
  const wadah = el('div');
  wadah.append(el('div.gap8.mb16', [
    el('button.btn', { onclick: () => { location.hash = '#/akuntansi'; } }, '← Kembali'),
    koreksi && jurnalManual(j) && el('button.btn', {
      onclick: () => ubahJurnal(j.id),
    }, '✎ Ubah Jurnal'),
    koreksi && bisaBatal && el('button.btn.bahaya', {
      onclick: () => batalkan(j),
    }, '↩ Batalkan Jurnal'),
    tombolCetak(() => dokJurnal(j), { label: 'Cetak Bukti' }),
  ].filter(Boolean)));

  if (j.status === 'posted' && j.sumber === 'sistem' && !bisaBatal) {
    wadah.append(el('div.notis.info', [el('div.isi', [
      el('strong', 'Jurnal otomatis dari modul'),
      el('div.kecil', 'Jurnal ini dibentuk oleh transaksi sumbernya (bukti kas, simpanan, pinjaman, '
        + 'penjualan, aset, dsb.). Pembatalannya dilakukan melalui dokumen sumber tersebut agar buku '
        + 'pembantu ikut terkoreksi.'),
    ])]));
  }

  const idRecurring = String(j.referensi || '').startsWith('recurring:') ? j.referensi.slice(10) : null;
  wadah.append(panel(`Jurnal ${j.nomor}`, el('dl.deskripsi', [
    el('dt', 'Tanggal'), el('dd', tgl(j.tanggal, true)),
    el('dt', 'Tipe'), el('dd', judul(j.tipe)),
    el('dt', 'Sumber'), el('dd', lencanaSumber(j.sumber)),
    el('dt', 'Keterangan'), el('dd', j.keterangan || '-'),
    el('dt', 'Referensi'), el('dd', idRecurring
      ? el('a.mono.kecil', { href: '#', onclick: (e) => { e.preventDefault(); detailRecurring(Number(idRecurring)); } },
        j.referensi)
      : el('span.mono.kecil', j.referensi || '-')),
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

/**
 * Setelah koreksi: muat ulang daftar, atau halaman detail (pindah ke jurnal
 * pengganti bila ada). Ditunggu sampai selesai agar dialog tawaran cetak
 * sesudahnya tidak ikut tertutup oleh perpindahan halaman.
 */
async function segarkan(saatSelesai, idBaru) {
  if (saatSelesai) { saatSelesai(); return; }
  if (idBaru) history.pushState(null, '', `#/akuntansi/${idBaru}`);
  await navigasi(location.hash, true);
}

function batalkan(j, saatSelesai) {
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
      el('button.btn.bahaya', { onclick: async (e) => {
        const tombol = e.currentTarget;
        const data = bacaForm(form);
        if (!data.alasan.trim()) { toast('Alasan pembatalan wajib diisi', 'peringatan'); return; }
        tombol.disabled = true;
        try {
          const h = await api.post(`/api/koreksi/jurnal/${j.id}/batal`, data);
          toast('Jurnal dibatalkan', 'sukses', `Jurnal balik ${h.nomor} dibuat`);
          tutup(); segarkan(saatSelesai);
        } catch (err) {
          // 409: jurnal sistem / sudah dibatalkan - pesan & detail dari server menjelaskan jalannya.
          galat(err);
          if (err.status === 409) { tutup(); segarkan(saatSelesai); } else tombol.disabled = false;
        }
      } }, 'Batalkan'),
    ],
  });
}

// ------------------------- Editor baris jurnal -------------------------

/** Daftar akun yang boleh dijurnal (postable & aktif) dari bagan akun. */
async function akunPostable() {
  const coa = await api.get('/api/master/coa', { limit: 1000 });
  return coa.data.filter((c) => c.is_postable && c.status === 'aktif');
}

/**
 * Editor baris debit/kredit dengan pemeriksaan keseimbangan berjalan.
 * `baris` diubah langsung; minimal dua baris.
 */
function editorBaris(akun, baris) {
  const daftar = el('div');
  const ringkas = el('div.antara.mt8');

  function hitung() {
    const d = baris.reduce((s, b) => s + (Number(b.debit) || 0), 0);
    const k = baris.reduce((s, b) => s + (Number(b.kredit) || 0), 0);
    const seimbang = d === k && d > 0;
    kosongkan(ringkas).append(
      el('span.lembut', `Total debit ${rp(d)} · total kredit ${rp(k)}`),
      el('strong', { class: seimbang ? 'pos' : 'neg' },
        seimbang ? '✓ Seimbang' : `Selisih ${rp(Math.abs(d - k))}`),
    );
    return seimbang;
  }

  function gambar() {
    kosongkan(daftar);
    baris.forEach((b, i) => {
      const inDebit = el('input', { type: 'number', class: 'angka', placeholder: 'Debit', min: 0,
        nilai: b.debit || '' });
      const inKredit = el('input', { type: 'number', class: 'angka', placeholder: 'Kredit', min: 0,
        nilai: b.kredit || '' });
      // Satu baris hanya boleh berisi debit ATAU kredit.
      inDebit.addEventListener('input', () => {
        b.debit = Number(inDebit.value) || 0;
        if (b.debit) { b.kredit = 0; inKredit.value = ''; }
        hitung();
      });
      inKredit.addEventListener('input', () => {
        b.kredit = Number(inKredit.value) || 0;
        if (b.kredit) { b.debit = 0; inDebit.value = ''; }
        hitung();
      });
      daftar.append(el('div', { gaya: { display: 'grid', gap: '8px', marginBottom: '8px',
        gridTemplateColumns: 'minmax(0,2.2fr) minmax(0,1.6fr) minmax(0,1fr) minmax(0,1fr) auto',
        alignItems: 'center' } }, [
        el('select', { onchange: (e) => { b.coa_kode = e.target.value; } },
          [el('option', { value: '' }, '- pilih akun -'),
            ...akun.map((a) => el('option', { value: a.kode, selected: a.kode === b.coa_kode },
              `${a.kode} — ${a.nama}`))]),
        el('input', { type: 'text', placeholder: 'Keterangan baris',
          nilai: b.keterangan || '', oninput: (e) => { b.keterangan = e.target.value; } }),
        inDebit,
        inKredit,
        el('button.btn.kecil.polos', { disabled: baris.length <= 2,
          onclick: () => { baris.splice(i, 1); gambar(); } }, '✕'),
      ]));
    });
    hitung();
  }
  gambar();

  return {
    node: el('div', [
      daftar,
      el('button.btn.kecil', { onclick: () => { baris.push({}); gambar(); } }, '+ Tambah Baris'),
      ringkas,
    ]),
    terisi: () => baris.filter((b) => b.coa_kode && (Number(b.debit) || Number(b.kredit)))
      .map((b) => ({ coa_kode: b.coa_kode, debit: Number(b.debit) || 0, kredit: Number(b.kredit) || 0,
        keterangan: b.keterangan || null })),
    seimbang: hitung,
  };
}

// --------------------------- Jurnal manual ---------------------------

/**
 * Formulir jurnal manual. Dengan `lama` (detail jurnal), formulir terisi dan
 * disimpan sebagai koreksi: jurnal lama dibalik lalu jurnal pengganti
 * bernomor baru diposting (PUT /api/koreksi/jurnal/:id).
 */
async function formJurnal(saatSelesai, lama = null) {
  let akun;
  try { akun = await akunPostable(); } catch (err) { galat(err); return; }
  const baris = lama ? (lama.detail || []).map((d) => ({ coa_kode: d.coa_kode, debit: d.debit || 0,
    kredit: d.kredit || 0, keterangan: d.keterangan || '' })) : [{}, {}];
  while (baris.length < 2) baris.push({});
  const editor = editorBaris(akun, baris);
  const inAlasan = el('textarea', { name: 'alasan', placeholder: 'mis. salah akun / salah nominal' });

  const form = el('div', [
    lama && el('div.notis.peringatan', [el('div.isi', [
      el('strong', `Koreksi jurnal ${lama.nomor}`),
      el('div.kecil', 'Jurnal lama tidak dihapus: sistem membuat jurnal balik atasnya, lalu memposting '
        + 'jurnal pengganti bernomor baru. Buku besar dan neraca ikut terkoreksi.'),
    ])]),
    el('div.baris-form.k3', [
      kolom('Tanggal', input('tanggal', { tipe: 'date', nilai: lama?.tanggal || hariIni() })),
      kolom('Tipe', pilih('tipe', ['umum', 'penyesuaian', 'pembuka']
        .map((t) => ({ nilai: t, teks: judul(t) })), lama?.tipe)),
      lama ? kolom('Referensi', el('input', { type: 'text', nilai: lama.referensi || '-', disabled: true }))
        : kolom('Referensi', input('referensi', { placeholder: 'Opsional' })),
    ]),
    kolom('Keterangan Jurnal', input('keterangan', { nilai: lama?.keterangan || '' }), { wajib: true }),
    el('div.tebal.mt16.mb8', 'Rincian Jurnal'),
    editor.node,
    lama && el('div.mt16', [kolom('Alasan Perubahan', inAlasan, { wajib: true })]),
  ].filter(Boolean));

  const tutup = modal({
    judul: lama ? `Ubah Jurnal ${lama.nomor}` : 'Jurnal Manual', lebar: 'lebar', isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async (e) => {
        const tombol = e.currentTarget;
        if (lama && !editor.seimbang()) { toast('Jurnal belum seimbang', 'peringatan'); return; }
        if (lama && !inAlasan.value.trim()) { toast('Alasan perubahan wajib diisi', 'peringatan'); return; }
        tombol.disabled = true;
        try {
          if (lama) {
            const d = bacaForm(form);
            const h = await api.put(`/api/koreksi/jurnal/${lama.id}`, {
              tanggal: d.tanggal, tipe: d.tipe, keterangan: d.keterangan, alasan: d.alasan, lines: editor.terisi(),
            });
            const baru = h.pengganti;
            toast('Jurnal berhasil diubah', 'sukses', `${h.dibatalkan} dibatalkan → ${baru.nomor}`);
            tutup(); await segarkan(saatSelesai, baru.id);
            tawaranCetak('Jurnal Berhasil Diubah', el('dl.deskripsi', [
              el('dt', 'Jurnal lama'), el('dd', [el('span.mono', h.dibatalkan), ' ', status('batal', 'Dibatalkan')]),
              h.jurnal_balik && el('dt', 'Jurnal balik'), h.jurnal_balik && el('dd', el('span.mono', h.jurnal_balik.nomor)),
              el('dt', 'Jurnal pengganti'), el('dd', el('span.mono', baru.nomor)),
              el('dt', 'Total'), el('dd', el('strong', rp(baru.total))),
            ].filter(Boolean)), () => ambilDokJurnal(baru.id), { label: 'Cetak Jurnal Pengganti' });
            return;
          }
          const h = await api.post('/api/akuntansi/jurnal', { ...bacaForm(form), lines: editor.terisi() });
          toast('Jurnal berhasil diposting', 'sukses', `${h.nomor} · ${rp(h.total)}`);
          tutup(); saatSelesai?.();
          tawaranCetak('Jurnal Berhasil Diposting', el('dl.deskripsi', [
            el('dt', 'Nomor'), el('dd', el('span.mono', h.nomor)),
            el('dt', 'Total'), el('dd', el('strong', rp(h.total))),
          ]), () => ambilDokJurnal(h.id));
        } catch (err) { galat(err); tombol.disabled = false; }
      } }, lama ? 'Simpan Perubahan' : 'Posting Jurnal'),
    ],
  });
}

/** Membuka editor jurnal terisi data jurnal yang akan dikoreksi. */
async function ubahJurnal(id, saatSelesai) {
  let j;
  try { j = await api.get(`/api/akuntansi/jurnal/${id}`); } catch (err) { galat(err); return; }
  formJurnal(saatSelesai, j);
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
              if (h.id) tawaranCetakDaftar('Jurnal Penutup Dibuat', [h]);
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

const FREKUENSI = ['mingguan', 'bulanan', 'triwulanan', 'semesteran', 'tahunan'];

const bacaTemplate = (r) => {
  try { return JSON.parse(r.template || '[]'); } catch { return []; }
};
const nilaiTemplate = (r) => bacaTemplate(r).reduce((s, l) => s + (Number(l.debit) || 0), 0);
const jatuhTempo = (r) => r.status === 'aktif' && r.jadwal_berikutnya && r.jadwal_berikutnya <= hariIni();

async function recurringTab() {
  const wadah = el('div');

  async function muat() {
    kosongkan(wadah).append(memuat());
    try {
      const d = await api.get('/api/akuntansi/recurring');
      const jumlahJatuhTempo = d.data.filter(jatuhTempo).length;
      const aksiBaris = (r) => el('div.gap8', { onclick: (e) => e.stopPropagation() }, [
        izin('akuntansi.post') && r.status === 'aktif' && el('button.btn.kecil', {
          title: 'Posting seluruh jadwal yang jatuh tempo sampai hari ini',
          onclick: (e) => jalankanRecurring(e, r, muat),
        }, '▶ Jalankan s.d. hari ini'),
        izin('akuntansi.update') && el('button.btn.kecil', { onclick: () => formRecurring(r, muat) }, 'Ubah'),
        izin('akuntansi.update') && el('button.btn.kecil.polos', {
          onclick: async (e) => {
            const tombol = e.currentTarget;
            tombol.disabled = true;
            try {
              await api.put(`/api/akuntansi/recurring/${r.id}`, { status: r.status === 'aktif' ? 'nonaktif' : 'aktif' });
              toast(`Jurnal berulang ${r.status === 'aktif' ? 'dinonaktifkan' : 'diaktifkan'}`, 'sukses');
              muat();
            } catch (err) { galat(err); tombol.disabled = false; }
          },
        }, r.status === 'aktif' ? 'Nonaktifkan' : 'Aktifkan'),
        izin('akuntansi.delete') && el('button.btn.kecil.polos', { onclick: () => hapusRecurring(r, muat) }, 'Hapus'),
      ].filter(Boolean));

      kosongkan(wadah).append(
        el('div.notis.info', [el('div.isi', [
          el('strong', 'Jurnal berulang diposting otomatis'),
          el('div.kecil', 'Server memeriksa jadwal setiap jam dan memposting jurnal yang jatuh tempo. '
            + 'Gunakan tombol Jalankan untuk memposting segera. Jadwal yang sudah diposting tidak akan '
            + 'dibuat dua kali.'),
        ])]),
        panelTabel('Jurnal Berulang (Recurring)', tabel([
          { judul: 'Nama', render: (r) => el('strong', r.nama) },
          { judul: 'Frekuensi', render: (r) => judul(r.frekuensi) },
          { judul: 'Periode', render: (r) => el('span.kecil.nowrap',
            `${tgl(r.tanggal_mulai)} – ${r.tanggal_akhir ? tgl(r.tanggal_akhir) : 'tanpa batas'}`) },
          { judul: 'Nilai', angka: true, render: (r) => rp(nilaiTemplate(r)) },
          { judul: 'Terakhir Dibuat', render: (r) => (r.terakhir_dibuat ? tgl(r.terakhir_dibuat) : '-') },
          { judul: 'Jadwal Berikutnya', render: (r) => (r.jadwal_berikutnya
            ? el('span.nowrap', [tgl(r.jadwal_berikutnya), ' ', jatuhTempo(r) && status('terbuka', 'Jatuh tempo')])
            : el('span.samar', r.status === 'aktif' ? 'Selesai' : '-')) },
          { judul: 'Status', render: (r) => status(r.status) },
          { judul: '', render: aksiBaris },
        ], d.data, {
          kosongTeks: 'Belum ada jurnal berulang yang dikonfigurasi',
          saatKlik: (r) => detailRecurring(r.id, muat),
        }), [
          izin('akuntansi.post') && el('button.btn', {
            disabled: !jumlahJatuhTempo,
            title: jumlahJatuhTempo ? `${jumlahJatuhTempo} template jatuh tempo` : 'Tidak ada yang jatuh tempo',
            onclick: (e) => jalankanSemua(e, muat),
          }, `▶ Jalankan semua yang jatuh tempo${jumlahJatuhTempo ? ` (${jumlahJatuhTempo})` : ''}`),
          izin('akuntansi.create') && el('button.btn.utama', { onclick: () => formRecurring(null, muat) },
            '+ Jurnal Berulang'),
        ].filter(Boolean)),
      );
    } catch (err) { galat(err); kosongkan(wadah).append(kosong('Gagal memuat jurnal berulang', err.message)); }
  }
  await muat();
  return wadah;
}

async function jalankanRecurring(e, r, saatSelesai) {
  const tombol = e.currentTarget;
  tombol.disabled = true;
  try {
    const h = await api.post(`/api/akuntansi/recurring/${r.id}/jalankan`, {});
    toast(h.pesan, h.dibuat?.length ? 'sukses' : 'info',
      h.dibuat?.length ? h.dibuat.map((j) => j.nomor).join(', ')
        : (h.jadwal_berikutnya ? `Jadwal berikutnya ${tgl(h.jadwal_berikutnya, true)}` : null));
    saatSelesai?.();
    if (h.dibuat?.length) tawaranCetakDaftar(`Jurnal Berulang — ${r.nama}`, h.dibuat);
  } catch (err) { galat(err); tombol.disabled = false; }
}

async function jalankanSemua(e, saatSelesai) {
  const tombol = e.currentTarget;
  if (!await konfirmasi('Posting seluruh jurnal berulang aktif yang jatuh tempo sampai hari ini?',
    { ya: 'Jalankan' })) return;
  tombol.disabled = true;
  try {
    const h = await api.post('/api/akuntansi/recurring-jalankan-semua', {});
    const gagal = (h.template || []).filter((t) => t.galat);
    const dibuat = (h.template || []).flatMap((t) => t.dibuat || []);
    toast(h.jumlah_jurnal ? `${h.jumlah_jurnal} jurnal berulang diposting` : 'Tidak ada jadwal yang jatuh tempo',
      h.jumlah_jurnal ? 'sukses' : 'info');
    if (gagal.length) {
      toast(`${gagal.length} jurnal berulang gagal diposting`, 'bahaya',
        gagal.map((t) => `${t.nama}: ${t.galat}`).join(' · '));
    }
    saatSelesai?.();
    if (dibuat.length) tawaranCetakDaftar('Jurnal Berulang Diposting', dibuat);
  } catch (err) { galat(err); tombol.disabled = false; }
}

async function hapusRecurring(r, saatSelesai) {
  if (!await konfirmasi(`Hapus jurnal berulang "${r.nama}"? Jurnal yang sudah terbentuk tetap ada di buku besar; `
    + 'hanya jadwal berikutnya yang tidak akan dibuat lagi.', { judul: 'Hapus Jurnal Berulang', ya: 'Hapus', jenis: 'bahaya' })) return false;
  try {
    await api.del(`/api/akuntansi/recurring/${r.id}`);
    toast('Jurnal berulang dihapus', 'sukses');
    saatSelesai?.();
    return true;
  } catch (err) { galat(err); return false; }
}

async function formRecurring(lama, saatSelesai) {
  let akun;
  try { akun = await akunPostable(); } catch (err) { galat(err); return; }
  const baris = lama ? bacaTemplate(lama).map((l) => ({ ...l })) : [{}, {}];
  while (baris.length < 2) baris.push({});
  const editor = editorBaris(akun, baris);

  const form = el('div', [
    el('div.baris-form', [
      kolom('Nama', input('nama', { nilai: lama?.nama || '', placeholder: 'mis. Beban sewa kantor bulanan' }), { wajib: true }),
      kolom('Frekuensi', pilih('frekuensi', FREKUENSI.map((f) => ({ nilai: f, teks: judul(f) })),
        lama?.frekuensi || 'bulanan')),
    ]),
    el('div.baris-form.k3', [
      kolom('Tanggal Mulai', input('tanggal_mulai', { tipe: 'date', nilai: lama?.tanggal_mulai || hariIni() }),
        { wajib: true, bantuan: 'Jadwal pertama; jadwal berikutnya dihitung dari tanggal ini.' }),
      kolom('Tanggal Akhir', input('tanggal_akhir', { tipe: 'date', nilai: lama?.tanggal_akhir || '' }),
        { bantuan: 'Kosongkan bila tanpa batas.' }),
      kolom('Status', pilih('status', [{ nilai: 'aktif', teks: 'Aktif' }, { nilai: 'nonaktif', teks: 'Nonaktif' }],
        lama?.status || 'aktif')),
    ]),
    lama?.terakhir_dibuat && el('div.notis.peringatan', [el('div.isi', [
      el('strong', `Sudah diposting sampai ${tgl(lama.terakhir_dibuat, true)}`),
      el('div.kecil', 'Perubahan hanya berlaku untuk jadwal berikutnya; jurnal yang sudah terbentuk tidak diubah.'),
    ])]),
    el('div.tebal.mt16.mb8', 'Template Jurnal'),
    editor.node,
  ].filter(Boolean));

  const tutup = modal({
    judul: lama ? `Ubah Jurnal Berulang — ${lama.nama}` : 'Jurnal Berulang Baru', lebar: 'lebar', isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async (e) => {
        const tombol = e.currentTarget;
        if (!editor.seimbang()) { toast('Template jurnal belum seimbang', 'peringatan'); return; }
        tombol.disabled = true;
        try {
          const d = bacaForm(form);
          const data = { ...d, tanggal_akhir: d.tanggal_akhir || null, template: editor.terisi() };
          const h = lama ? await api.put(`/api/akuntansi/recurring/${lama.id}`, data)
            : await api.post('/api/akuntansi/recurring', data);
          toast(lama ? 'Jurnal berulang diperbarui' : 'Jurnal berulang dibuat', 'sukses',
            h.jadwal_berikutnya ? `Jadwal berikutnya ${tgl(h.jadwal_berikutnya, true)}` : null);
          tutup(); saatSelesai?.();
        } catch (err) { galat(err); tombol.disabled = false; }
      } }, 'Simpan'),
    ],
  });
}

async function detailRecurring(id, saatSelesai) {
  let r;
  let akun = [];
  try {
    [r, akun] = await Promise.all([
      api.get(`/api/akuntansi/recurring/${id}`),
      api.get('/api/master/coa', { limit: 1000 }).then((c) => c.data).catch(() => []),
    ]);
  } catch (err) { galat(err); return; }
  const namaAkun = Object.fromEntries(akun.map((a) => [a.kode, a.nama]));
  const template = bacaTemplate(r);
  const segarkan = () => { tutup(); saatSelesai?.(); };

  const isi = el('div', [
    el('dl.deskripsi', [
      el('dt', 'Frekuensi'), el('dd', judul(r.frekuensi)),
      el('dt', 'Periode'), el('dd', `${tgl(r.tanggal_mulai, true)} – ${r.tanggal_akhir ? tgl(r.tanggal_akhir, true) : 'tanpa batas'}`),
      el('dt', 'Terakhir dibuat'), el('dd', r.terakhir_dibuat ? tgl(r.terakhir_dibuat, true) : 'Belum pernah'),
      el('dt', 'Jadwal berikutnya'), el('dd', r.jadwal_berikutnya
        ? [tgl(r.jadwal_berikutnya, true), ' ', jatuhTempo(r) && status('terbuka', 'Jatuh tempo')]
        : (r.status === 'aktif' ? 'Jadwal sudah berakhir' : '-')),
      el('dt', 'Status'), el('dd', status(r.status)),
    ]),
    el('div.tebal.mt16.mb8', 'Template Jurnal'),
    el('div.tabel-bungkus', [tabel([
      { judul: 'Akun', render: (l) => el('span.mono.kecil', l.coa_kode) },
      { judul: 'Nama Akun', kunci: 'nama', render: (l) => namaAkun[l.coa_kode] || '-' },
      { judul: 'Keterangan', render: (l) => el('span.kecil.lembut', l.keterangan || '-') },
      { judul: 'Debit', kunci: 'debit', angka: true, render: (l) => (l.debit ? rp(l.debit) : '-') },
      { judul: 'Kredit', kunci: 'kredit', angka: true, render: (l) => (l.kredit ? rp(l.kredit) : '-') },
    ], template, { kaki: { nama: 'TOTAL', debit: rp(nilaiTemplate(r)), kredit: rp(nilaiTemplate(r)) } })]),
    el('div.tebal.mt16.mb8', `Riwayat Jurnal (${r.riwayat.length})`),
    el('div.tabel-bungkus', [tabel([
      { judul: 'Tanggal', render: (j) => tgl(j.tanggal) },
      { judul: 'Nomor', render: (j) => el('a.mono.kecil', { href: `#/akuntansi/${j.id}`, onclick: () => tutup() }, j.nomor) },
      { judul: 'Nilai', angka: true, render: (j) => rp(j.total_debit) },
      { judul: 'Status', render: (j) => status(j.status) },
      { judul: '', render: (j) => el('button.btn.kecil.polos', { onclick: (e) => cetakJurnal(e, j.id) }, 'Cetak') },
    ], r.riwayat, { kosongTeks: 'Belum ada jurnal yang terbentuk dari template ini' })]),
  ]);

  const tutup = modal({
    judul: `Jurnal Berulang — ${r.nama}`, lebar: 'lebar', isi,
    kaki: [
      izin('akuntansi.delete') && el('button.btn.bahaya', { onclick: async () => {
        if (await hapusRecurring(r)) segarkan();
      } }, 'Hapus'),
      izin('akuntansi.update') && el('button.btn', { onclick: () => { tutup(); formRecurring(r, saatSelesai); } }, 'Ubah'),
      izin('akuntansi.post') && r.status === 'aktif' && el('button.btn.utama', {
        onclick: (e) => jalankanRecurring(e, r, segarkan),
      }, '▶ Jalankan s.d. hari ini'),
      el('button.btn', { onclick: () => tutup() }, 'Tutup'),
    ].filter(Boolean),
  });
}
