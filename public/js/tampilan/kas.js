/**
 * Modul 9 - Kas & Bank.
 */
import {
  api, el, kpi, panel, panelTabel, tabel, rp, angka, tgl, status, judul, modal, kolom, input,
  pilih, bacaForm, toast, galat, memuat, kosongkan, hariIni,
} from '../inti.js';
import { izin, navigasi } from '../app.js';
import { ikon } from '../ikon.js';

export async function render() {
  const wadah = el('div');
  const isi = el('div');
  const daftarTab = [
    { judul: 'Posisi & Transaksi', render: transaksiTab },
    { judul: 'Rekonsiliasi Bank', render: rekonTab },
    { judul: 'Cash Opname', render: opnameTab },
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
  const posisi = await api.get('/api/kas/posisi');

  wadah.append(el('div.grid.k3.mb16', [
    kpi('Total Kas', rp(posisi.total_kas), { ikon: ikon('uang') }),
    kpi('Total Bank', rp(posisi.total_bank), { ikon: ikon('gedung') }),
    kpi('Total Kas & Bank', rp(posisi.total), { jenis: 'sukses' }),
  ]));

  wadah.append(panelTabel('Posisi Kas & Bank', tabel([
    { judul: 'Kode Akun', render: (b) => el('span.mono.kecil', b.kode) },
    { judul: 'Nama Akun', kunci: 'nama' },
    { judul: 'Jenis', render: (b) => (b.is_kas ? 'Kas' : 'Bank') },
    { judul: 'Penerimaan', angka: true, render: (b) => rp(b.debit) },
    { judul: 'Pengeluaran', angka: true, render: (b) => rp(b.kredit) },
    { judul: 'Saldo', kunci: 'saldo', angka: true, render: (b) => el('strong', rp(b.saldo)) },
  ], posisi.baris, { kaki: { nama: 'TOTAL', saldo: rp(posisi.total) } })));

  const daftar = el('div');
  wadah.append(daftar);
  let dari = `${new Date().getFullYear()}-01-01`;
  let sampai = hariIni();

  async function muat() {
    kosongkan(daftar).append(memuat());
    try {
      const d = await api.get('/api/kas', { dari, sampai, limit: 200 });
      const batal = (k) => k.status === 'batal';
      // Total dari server sudah mengecualikan bukti yang dibatalkan.
      kosongkan(daftar).append(panelTabel('Bukti Kas & Bank', tabel([
        { judul: 'Tanggal', render: (k) => el('span.nowrap', tgl(k.tanggal)) },
        { judul: 'Nomor', render: (k) => el(batal(k) ? 'span.mono.kecil.samar' : 'span.mono.kecil', k.nomor) },
        { judul: 'Jenis', render: (k) => status(k.jenis === 'kas_masuk' ? 'aktif'
          : k.jenis === 'kas_keluar' ? 'peringatan' : 'info', judul(k.jenis)) },
        { judul: 'Keterangan', render: (k) => el('div', [
          el('span.kecil', k.keterangan || '-'),
          batal(k) && k.alasan_batal && el('div.kecil.neg', `Dibatalkan: ${k.alasan_batal}`),
        ]) },
        { judul: 'Pihak', kunci: 'pihak', render: (k) => el('span.kecil.samar', k.pihak || '-') },
        { judul: 'Nominal', kunci: 'nominal', angka: true, render: (k) => (batal(k)
          ? el('s.samar', rp(k.nominal)) : el('strong', rp(k.nominal))) },
        { judul: 'Status', render: (k) => status(k.status || 'posted', batal(k) ? 'Batal' : 'Posted') },
        { judul: 'Rekon', render: (k) => (k.rekonsiliasi ? status('lunas', '✓') : status('netral', '-')) },
        { judul: '', render: (k) => (izin('kas.update') && !batal(k) && !k.rekonsiliasi
          && ['kas_masuk', 'kas_keluar', 'transfer'].includes(k.jenis)
          ? el('button.btn.kecil.polos', { title: 'Batalkan bukti ini (jurnal dibalik)',
            onclick: () => formBatal(k, muat) }, 'Batalkan') : '') },
      ], d.data, {
        kosongTeks: 'Belum ada transaksi kas pada periode ini',
        kaki: d.data.length ? { pihak: 'Masuk / keluar (tanpa batal)',
          nominal: el('span.nowrap', [el('span.pos', rp(d.total_masuk)), ' / ', el('span.neg', rp(d.total_keluar))]) } : undefined,
      }), [
        el('input', { type: 'date', nilai: dari, onchange: (e) => { dari = e.target.value; muat(); } }),
        el('input', { type: 'date', nilai: sampai, onchange: (e) => { sampai = e.target.value; muat(); } }),
        izin('kas.create') && el('button.btn.utama', { onclick: () => formKas('kas_masuk', muat) }, '↓ Kas Masuk'),
        izin('kas.create') && el('button.btn', { onclick: () => formKas('kas_keluar', muat) }, '↑ Kas Keluar'),
        izin('kas.create') && el('button.btn', { onclick: () => formTransfer(muat) }, '⇄ Transfer'),
      ].filter(Boolean)));
    } catch (err) { galat(err); }
  }
  await muat();
  return wadah;
}

/** Akun postable & aktif dari bagan akun (tanpa kode yang ditanam). */
async function akunPostable() {
  const coa = await api.get('/api/master/coa', { limit: 1000 });
  return coa.data.filter((c) => c.is_postable && c.status === 'aktif');
}

const opsiAkun = (daftar) => [{ nilai: '', teks: '- pilih akun -' },
  ...daftar.map((c) => ({ nilai: c.kode, teks: `${c.kode} — ${c.nama}` }))];

/** Hanya akun bertanda kas/bank yang sah sebagai sisi kas. */
async function akunKasBank() {
  return opsiAkun((await akunPostable()).filter((c) => c.is_kas || c.is_bank));
}

/** Akun lawan: seluruh akun postable selain kas/bank (antarkas memakai Transfer). */
async function semuaAkun() {
  return opsiAkun((await akunPostable()).filter((c) => !c.is_kas && !c.is_bank));
}

async function formKas(jenis, saatSelesai) {
  let kasBank;
  let lawan;
  try { [kasBank, lawan] = await Promise.all([akunKasBank(), semuaAkun()]); } catch (err) { galat(err); return; }
  const masuk = jenis === 'kas_masuk';
  const form = el('div', [
    el('input', { type: 'hidden', name: 'jenis', nilai: jenis }),
    el('div.baris-form', [
      kolom('Tanggal', input('tanggal', { tipe: 'date', nilai: hariIni() })),
      kolom('Nominal', input('nominal', { tipe: 'number', min: 1 }), { wajib: true }),
    ]),
    kolom(masuk ? 'Kas/Bank Penerima' : 'Kas/Bank Sumber', pilih('coa_kas', kasBank), { wajib: true }),
    kolom(masuk ? 'Akun Pendapatan / Lawan' : 'Akun Beban / Lawan', pilih('coa_lawan', lawan), { wajib: true }),
    kolom('Keterangan', input('keterangan'), { wajib: true }),
    kolom('Pihak Terkait', input('pihak', { placeholder: 'Opsional' })),
  ]);
  const tutup = modal({
    judul: masuk ? 'Bukti Kas Masuk' : 'Bukti Kas Keluar', isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async (e) => {
        const tombol = e.currentTarget;
        tombol.disabled = true;
        try {
          const h = await api.post('/api/kas', bacaForm(form));
          toast('Transaksi kas tercatat', 'sukses', `${h.nomor} · ${judul(h.terbilang)}`);
          tutup(); saatSelesai?.();
        } catch (err) { galat(err); tombol.disabled = false; }
      } }, 'Simpan'),
    ],
  });
}

async function formTransfer(saatSelesai) {
  let kasBank;
  try { kasBank = await akunKasBank(); } catch (err) { galat(err); return; }
  const form = el('div', [
    el('div.baris-form', [
      kolom('Dari Akun', pilih('coa_kas', kasBank), { wajib: true }),
      kolom('Ke Akun', pilih('coa_tujuan', kasBank), { wajib: true }),
    ]),
    el('div.baris-form', [
      kolom('Tanggal', input('tanggal', { tipe: 'date', nilai: hariIni() })),
      kolom('Nominal', input('nominal', { tipe: 'number', min: 1 }), { wajib: true }),
    ]),
    kolom('Keterangan', input('keterangan')),
  ]);
  const tutup = modal({
    judul: 'Transfer Kas / Bank', isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async (e) => {
        const tombol = e.currentTarget;
        tombol.disabled = true;
        try {
          const h = await api.post('/api/kas/transfer', bacaForm(form));
          toast('Transfer berhasil', 'sukses', h.nomor);
          tutup(); saatSelesai?.();
        } catch (err) { galat(err); tombol.disabled = false; }
      } }, 'Transfer'),
    ],
  });
}

/** Pembatalan bukti kas: bukti tetap tersimpan berstatus batal, jurnalnya dibalik. */
function formBatal(k, saatSelesai) {
  const form = el('div', [
    el('div.notis.peringatan', [el('div.isi', [
      el('strong', `${k.nomor} · ${judul(k.jenis)} ${rp(k.nominal)}`),
      el('div.kecil', 'Bukti tidak dihapus. Sistem membuat jurnal balik atas jurnal bukti ini dan menandainya '
        + 'sebagai batal, sehingga saldo kas/bank kembali seperti sebelum transaksi.'),
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
          const h = await api.post(`/api/kas/${k.id}/batal`, { alasan });
          toast(`${k.nomor} dibatalkan`, 'sukses', h.jurnal?.nomor ? `Jurnal balik ${h.jurnal.nomor}` : null);
          tutup(); saatSelesai?.();
        } catch (err) { galat(err); tombol.disabled = false; }
      } }, 'Batalkan Bukti'),
    ],
  });
}

async function rekonTab() {
  const wadah = el('div');
  const terpilih = new Set();
  async function muat() {
    kosongkan(wadah).append(memuat());
    try {
      const d = await api.get('/api/kas/rekonsiliasi/belum');
      kosongkan(wadah).append(
        el('div.notis.info', [el('div.isi', [
          el('strong', 'Rekonsiliasi bank'),
          el('div.kecil', 'Tandai transaksi yang sudah cocok dengan rekening koran bank. '
            + 'Transaksi yang belum tercentang menjadi item rekonsiliasi.'),
        ])]),
        panelTabel(`Belum Direkonsiliasi (${d.data.length})`, tabel([
          { judul: '', render: (k) => el('input', { type: 'checkbox',
            gaya: { width: 'auto' },
            onchange: (e) => (e.target.checked ? terpilih.add(k.id) : terpilih.delete(k.id)) }) },
          { judul: 'Tanggal', render: (k) => tgl(k.tanggal) },
          { judul: 'Nomor', render: (k) => el('span.mono.kecil', k.nomor) },
          { judul: 'Jenis', render: (k) => judul(k.jenis) },
          { judul: 'Keterangan', render: (k) => el('span.kecil', k.keterangan || '-') },
          { judul: 'Nominal', angka: true, render: (k) => rp(k.nominal) },
        ], d.data, { kosongTeks: 'Seluruh transaksi sudah direkonsiliasi ✓' }), [
          izin('kas.update') && el('button.btn.utama', { onclick: async () => {
            if (!terpilih.size) { toast('Pilih transaksi terlebih dahulu', 'peringatan'); return; }
            try {
              const h = await api.post('/api/kas/rekonsiliasi', { ids: [...terpilih], cocok: true });
              toast(`${h.diproses} transaksi direkonsiliasi`, 'sukses');
              terpilih.clear(); muat();
            } catch (err) { galat(err); }
          } }, '✓ Tandai Terekonsiliasi'),
        ].filter(Boolean)),
      );
    } catch (err) { galat(err); }
  }
  await muat();
  return wadah;
}

async function opnameTab() {
  const wadah = el('div');
  async function muat() {
    kosongkan(wadah).append(memuat());
    try {
      const d = await api.get('/api/kas/opname');
      kosongkan(wadah).append(panelTabel('Riwayat Cash Opname', tabel([
        { judul: 'Tanggal', render: (o) => tgl(o.tanggal) },
        { judul: 'Akun Kas', render: (o) => el('span.mono.kecil', o.coa_kas) },
        { judul: 'Saldo Sistem', angka: true, render: (o) => rp(o.saldo_sistem) },
        { judul: 'Saldo Fisik', angka: true, render: (o) => rp(o.saldo_fisik) },
        { judul: 'Selisih', angka: true, render: (o) => el(o.selisih === 0 ? 'span.samar'
          : o.selisih > 0 ? 'span.pos' : 'span.neg', rp(o.selisih)) },
        { judul: 'Petugas', render: (o) => el('span.kecil', o.petugas || '-') },
      ], d.data, { kosongTeks: 'Belum pernah dilakukan cash opname' }), [
        izin('kas.create') && el('button.btn.utama', { onclick: () => formOpname(muat) }, '+ Cash Opname'),
      ].filter(Boolean)));
    } catch (err) { galat(err); }
  }
  await muat();
  return wadah;
}

async function formOpname(saatSelesai) {
  let kasBank;
  try { kasBank = await akunKasBank(); } catch (err) { galat(err); return; }
  const form = el('div', [
    el('div.notis.info', [el('div.isi', [
      el('strong', 'Selisih langsung dibukukan'),
      el('div.kecil', 'Selisih kurang dicatat sebagai beban selisih kas, selisih lebih sebagai '
        + 'pendapatan lain-lain.'),
    ])]),
    kolom('Akun Kas', pilih('coa_kas', kasBank), { wajib: true }),
    el('div.baris-form', [
      kolom('Tanggal', input('tanggal', { tipe: 'date', nilai: hariIni() })),
      kolom('Saldo Fisik (hasil hitung)', input('saldo_fisik', { tipe: 'number', min: 0 }), { wajib: true }),
    ]),
    kolom('Keterangan', input('keterangan')),
  ]);
  const tutup = modal({
    judul: 'Cash Opname', isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async (e) => {
        const tombol = e.currentTarget;
        tombol.disabled = true;
        try {
          const h = await api.post('/api/kas/opname', bacaForm(form));
          toast('Cash opname tercatat', 'sukses',
            `Sistem ${rp(h.saldo_sistem)} · fisik ${rp(h.saldo_fisik)} · selisih ${rp(h.selisih)}`);
          tutup(); saatSelesai?.();
        } catch (err) { galat(err); tombol.disabled = false; }
      } }, 'Simpan'),
    ],
  });
}
