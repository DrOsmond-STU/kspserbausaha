/**
 * Modul 16 - Aset Tetap (PSAK 16).
 */
import {
  api, el, kpi, panel, panelTabel, tabel, rp, angka, persen, tgl, status, judul, modal,
  kolom, input, pilih, bacaForm, toast, galat, memuat, kosongkan, hariIni, bilah, konfirmasi,
} from '../inti.js';
import { grafikCincin } from '../grafik.js';
import { izin, navigasi } from '../app.js';
import { ikon } from '../ikon.js';

export async function render(param) {
  if (param[0]) return detail(Number(param[0]));

  const wadah = el('div');
  const [r, d] = await Promise.all([api.get('/api/aset/ringkasan'), api.get('/api/aset')]);

  wadah.append(el('div.grid.k4.mb16', [
    kpi('Jumlah Aset', angka(r.jumlah_aset), { ikon: ikon('lapis') }),
    kpi('Harga Perolehan', rp(r.total_perolehan)),
    kpi('Akumulasi Penyusutan', rp(r.total_akumulasi), { jenis: 'peringatan' }),
    kpi('Nilai Buku', rp(r.total_nilai_buku), { jenis: 'sukses' }),
  ]));

  wadah.append(el('div.grid.k2', [
    el('div.panel', [el('div.panel-kepala', [el('h3', 'Komposisi Nilai Buku per Kategori')]),
      el('div.panel-isi', [grafikCincin({
        bagian: r.per_kategori.map((k) => ({ label: judul(k.kategori || 'lainnya'), nilai: k.nilai_buku })),
        tengahLabel: 'Nilai Buku', tengahNilai: rp(r.total_nilai_buku).replace('Rp ', ''),
      })])]),
    panelTabel('Rekapitulasi per Kategori', tabel([
      { judul: 'Kategori', render: (k) => judul(k.kategori || 'lainnya') },
      { judul: 'Unit', angka: true, render: (k) => angka(k.jumlah) },
      { judul: 'Perolehan', angka: true, render: (k) => rp(k.perolehan) },
      { judul: 'Akumulasi', angka: true, render: (k) => rp(k.akumulasi) },
      { judul: 'Nilai Buku', angka: true, render: (k) => el('strong', rp(k.nilai_buku)) },
    ], r.per_kategori)),
  ]));

  if (r.perlu_maintenance.length) {
    wadah.append(panelTabel('Jadwal Pemeliharaan Mendatang', tabel([
      { judul: 'Kode', render: (m) => el('span.mono.kecil', m.kode) },
      { judul: 'Aset', kunci: 'nama' },
      { judul: 'Jadwal Berikutnya', render: (m) => tgl(m.jadwal_berikutnya, true) },
    ], r.perlu_maintenance)));
  }

  wadah.append(panelTabel('Daftar Aset Tetap', tabel([
    { judul: 'Kode', render: (a) => el('span.mono.kecil', a.kode) },
    { judul: 'Nama Aset', kunci: 'nama' },
    { judul: 'Kategori', render: (a) => judul(a.kategori || '-') },
    { judul: 'Perolehan', render: (a) => tgl(a.tanggal_perolehan) },
    { judul: 'Harga', angka: true, render: (a) => rp(a.harga_perolehan) },
    { judul: 'Penyusutan/bln', angka: true, render: (a) => rp(a.penyusutan_per_bulan) },
    { judul: 'Nilai Buku', angka: true, render: (a) => el('strong', rp(a.nilai_buku)) },
    { judul: 'Tersusut', render: (a) => el('div', { gaya: { minWidth: '100px' } }, [
      el('div.kecil', persen(a.persen_tersusut)),
      bilah(a.persen_tersusut, 100, a.persen_tersusut > 85 ? 'peringatan' : ''),
    ]) },
    { judul: 'Status', render: (a) => status(a.status) },
  ], d.data, { saatKlik: (a) => { location.hash = `#/aset/${a.id}`; },
    kosongTeks: 'Belum ada aset tetap terdaftar' }), [
    izin('aset.create') && el('button.btn.utama', { onclick: () => formAset() }, '+ Tambah Aset'),
    izin('aset.post') && el('button.btn', { onclick: () => formPenyusutan() }, 'Jalankan Penyusutan'),
  ].filter(Boolean)));

  return wadah;
}

async function detail(id) {
  const a = await api.get(`/api/aset/${id}`);
  const wadah = el('div');
  const dilepas = a.status === 'dilepas';
  const belumDisusutkan = !(a.riwayat_penyusutan || []).length;

  wadah.append(el('div.gap8.mb16', [
    el('button.btn', { onclick: () => { location.hash = '#/aset'; } }, '← Kembali'),
    izin('aset.update') && !dilepas && el('button.btn', { onclick: () => formUbah(a) }, 'Ubah Data'),
    izin('aset.update') && !dilepas && el('button.btn', {
      onclick: () => formMaintenance(a) }, 'Catat Pemeliharaan'),
    izin('aset.update') && !dilepas && el('button.btn.bahaya', {
      onclick: () => formDisposal(a) }, 'Pelepasan Aset'),
    izin('aset.delete') && !dilepas && belumDisusutkan && el('button.btn.polos', {
      title: 'Hanya untuk aset salah input yang belum pernah disusutkan',
      onclick: (e) => hapusAset(e, a) }, 'Hapus'),
  ].filter(Boolean)));

  wadah.append(el('div.grid.k4.mb16', [
    kpi('Harga Perolehan', rp(a.harga_perolehan)),
    kpi('Akumulasi Penyusutan', rp(a.akumulasi_penyusutan)),
    kpi('Nilai Buku', rp(a.nilai_buku), { jenis: 'sukses' }),
    kpi('Penyusutan / Bulan', rp(a.penyusutan_per_bulan)),
  ]));

  wadah.append(panel(`${a.kode} — ${a.nama}`, el('dl.deskripsi', [
    el('dt', 'Kategori'), el('dd', judul(a.kategori || '-')),
    el('dt', 'Tanggal perolehan'), el('dd', tgl(a.tanggal_perolehan, true)),
    el('dt', 'Umur manfaat'), el('dd', `${a.umur_manfaat} tahun`),
    el('dt', 'Metode penyusutan'), el('dd', judul(a.metode)),
    el('dt', 'Nilai residu'), el('dd', rp(a.nilai_residu)),
    el('dt', 'Akun aset / akumulasi / beban'), el('dd', el('span.mono.kecil',
      `${a.coa_aset || '-'} / ${a.coa_akumulasi || '-'} / ${a.coa_beban || '-'}`)),
    el('dt', 'Lokasi'), el('dd', a.lokasi || '-'),
    el('dt', 'Penanggung jawab'), el('dd', a.penanggung_jawab || '-'),
    el('dt', 'Barcode'), el('dd', el('span.mono', a.barcode || '-')),
    el('dt', 'Status'), el('dd', status(a.status)),
    a.tanggal_disposal && el('dt', 'Tanggal pelepasan'),
    a.tanggal_disposal && el('dd', tgl(a.tanggal_disposal, true)),
  ].filter(Boolean))));

  wadah.append(el('div.grid.k2', [
    panelTabel('Riwayat Penyusutan', tabel([
      { judul: 'Periode', kunci: 'periode' },
      { judul: 'Beban', angka: true, render: (p) => rp(p.nominal) },
      { judul: 'Akumulasi', angka: true, render: (p) => rp(p.akumulasi) },
      { judul: 'Nilai Buku', angka: true, render: (p) => rp(p.nilai_buku) },
    ], a.riwayat_penyusutan, { kosongTeks: 'Belum ada penyusutan dibukukan' })),
    panelTabel('Riwayat Pemeliharaan', tabel([
      { judul: 'Tanggal', render: (m) => tgl(m.tanggal) },
      { judul: 'Jenis', kunci: 'jenis' },
      { judul: 'Vendor', render: (m) => m.vendor || '-' },
      { judul: 'Biaya', angka: true, render: (m) => rp(m.biaya) },
      { judul: 'Jadwal Berikutnya', render: (m) => (m.jadwal_berikutnya ? tgl(m.jadwal_berikutnya) : '-') },
    ], a.maintenance, { kosongTeks: 'Belum ada catatan pemeliharaan' })),
  ]));

  return wadah;
}

// ------------------------------ Pembantu ------------------------------

const KATEGORI = ['inventaris', 'bangunan', 'kendaraan', 'mesin', 'tanah'];
const METODE = [{ nilai: 'garis_lurus', teks: 'Garis Lurus' }, { nilai: 'saldo_menurun', teks: 'Saldo Menurun Ganda' }];

/** Rekening bank aktif; pengguna tanpa akses master mendapat daftar kosong (server memakai akun bank bawaan). */
async function rekeningBank() {
  try { return (await api.get('/api/master/bank', { status: 'aktif', limit: 200 })).data || []; } catch { return []; }
}

/** Pemetaan akun Parameter Sistem (hanya bila pengguna berhak melihatnya). */
async function petaAkun() {
  if (!izin('admin.view')) return {};
  try { return (await api.get('/api/admin/settings', { prefix: 'coa.' })).map || {}; } catch { return {}; }
}

/**
 * Pilihan akun dengan opsi kosong "ikuti Parameter Sistem": nilai kosong berarti
 * server memakai pemetaan akun pada Parameter Sistem.
 */
function pilihAkun(nama, daftar, kodeParameter, terpilih = '') {
  return pilih(nama, [
    { nilai: '', teks: `- Ikuti Parameter Sistem${kodeParameter ? ` (${kodeParameter})` : ''} -` },
    ...daftar.map((c) => ({ nilai: c.kode, teks: `${c.kode} — ${c.nama}` })),
  ], terpilih);
}

function kolomBank(bank, label = 'Rekening Bank') {
  return kolom(label, pilih('bank_account_id', [
    { nilai: '', teks: '- Akun bank bawaan (Parameter Sistem) -' },
    ...bank.map((b) => ({ nilai: b.id, teks: `${b.nama_bank} · ${b.nomor_rekening} a.n. ${b.atas_nama}` })),
  ]), { bantuan: bank.length ? 'Kosongkan untuk memakai akun bank bawaan'
    : 'Belum ada rekening bank terdaftar; dipakai akun bank bawaan' });
}

/** Menampilkan bagian formulir sesuai pilihan; bagian tersembunyi tidak ikut dikirim. */
function tampilkan(node, ya) { node.style.display = ya ? '' : 'none'; }

/** Membaca formulir tanpa isian di dalam bagian yang sedang disembunyikan. */
function bacaTerlihat(form) {
  const data = bacaForm(form);
  for (const f of form.querySelectorAll('input[name], select[name], textarea[name]')) {
    if (f.closest('[style*="display: none"]')) delete data[f.name];
  }
  return data;
}

// ------------------------------ Formulir ------------------------------

async function formAset() {
  let coa;
  let unit;
  let bank;
  let peta;
  try {
    [coa, unit, bank, peta] = await Promise.all([
      api.get('/api/master/coa', { limit: 1000 }), api.get('/api/master/unit-usaha'), rekeningBank(), petaAkun(),
    ]);
  } catch (err) { galat(err); return; }
  const sah = coa.data.filter((c) => c.is_postable && c.status === 'aktif');
  const akunAset = sah.filter((c) => c.tipe === 'aset' && !c.is_kas && !c.is_bank);
  const akunBeban = sah.filter((c) => c.tipe === 'beban');

  const pilihSumber = pilih('sumber_perolehan', [
    { nilai: 'kas', teks: 'Dibayar tunai (kas)' },
    { nilai: 'transfer', teks: 'Transfer bank' },
    { nilai: 'hutang', teks: 'Utang ke pemasok' },
    { nilai: 'saldo_awal', teks: 'Saldo awal (aset lama, tanpa jurnal perolehan)' },
  ], 'kas');
  const bagianTransfer = el('div', [kolomBank(bank, 'Rekening Pembayar')]);
  const bagianHutang = el('div.baris-form', [
    kolom('Pemasok', input('pemasok', { placeholder: 'Nama pemasok / vendor' })),
    kolom('Jatuh Tempo', input('jatuh_tempo', { tipe: 'date' })),
  ]);
  const bagianSaldoAwal = el('div', [
    kolom('Akumulasi Penyusutan Awal', input('akumulasi_awal', { tipe: 'number', min: 0, nilai: 0 }),
      { bantuan: 'Akumulasi penyusutan yang sudah ada per tanggal perolehan/neraca pembuka.' }),
  ]);
  const keteranganSumber = el('div.kecil.lembut.mb8');
  const aturSumber = () => {
    const s = pilihSumber.value;
    tampilkan(bagianTransfer, s === 'transfer');
    tampilkan(bagianHutang, s === 'hutang');
    tampilkan(bagianSaldoAwal, s === 'saldo_awal');
    keteranganSumber.textContent = {
      kas: 'Jurnal otomatis: D Aset Tetap · K Kas.',
      transfer: 'Jurnal otomatis: D Aset Tetap · K Bank (rekening terpilih).',
      hutang: 'Jurnal otomatis: D Aset Tetap · K Utang Usaha, dan utang tercatat pada daftar utang.',
      saldo_awal: 'Tidak ada jurnal perolehan: saldo aset diasumsikan sudah ada pada neraca pembuka.',
    }[s];
  };
  pilihSumber.addEventListener('change', aturSumber);

  const form = el('div', [
    el('div.baris-form', [
      kolom('Kode Aset', input('kode'), { wajib: true }),
      kolom('Nama Aset', input('nama'), { wajib: true }),
    ]),
    el('div.baris-form.k3', [
      kolom('Kategori', pilih('kategori', KATEGORI.map((k) => ({ nilai: k, teks: judul(k) })))),
      kolom('Tanggal Perolehan', input('tanggal_perolehan', { tipe: 'date', nilai: hariIni() })),
      kolom('Metode Penyusutan', pilih('metode', METODE)),
    ]),
    el('div.baris-form.k3', [
      kolom('Harga Perolehan', input('harga_perolehan', { tipe: 'number', min: 1 }), { wajib: true }),
      kolom('Nilai Residu', input('nilai_residu', { tipe: 'number', min: 0, nilai: 0 })),
      kolom('Umur Manfaat (tahun)', input('umur_manfaat', { tipe: 'number', min: 1, nilai: 4 })),
    ]),
    el('div.tebal.mt16.mb8', 'Sumber Perolehan'),
    kolom('Dibayar Dengan', pilihSumber),
    keteranganSumber,
    bagianTransfer, bagianHutang, bagianSaldoAwal,
    el('div.tebal.mt16.mb8', 'Akun'),
    el('div.baris-form.k3', [
      kolom('Akun Aset', pilihAkun('coa_aset', akunAset, peta['coa.aset_tetap'])),
      kolom('Akun Akumulasi', pilihAkun('coa_akumulasi', akunAset, peta['coa.akumulasi_penyusutan'])),
      kolom('Akun Beban Penyusutan', pilihAkun('coa_beban', akunBeban, peta['coa.beban_penyusutan'])),
    ]),
    el('div.baris-form.k3', [
      kolom('Lokasi', input('lokasi')),
      kolom('Penanggung Jawab', input('penanggung_jawab')),
      kolom('Unit Usaha', pilih('unit_usaha_id', [{ nilai: '', teks: '- tidak spesifik -' },
        ...unit.data.map((u) => ({ nilai: u.id, teks: u.nama }))])),
    ]),
    el('div.kecil.lembut', 'Catatan: aset berkategori "tanah" tidak disusutkan sesuai PSAK 16.'),
  ]);
  aturSumber();

  const tutup = modal({
    judul: 'Tambah Aset Tetap', lebar: 'lebar', isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async (e) => {
        const tombol = e.currentTarget;
        tombol.disabled = true;
        try {
          const h = await api.post('/api/aset', bacaTerlihat(form));
          toast('Aset berhasil didaftarkan', 'sukses', h.jurnal?.nomor ? `Jurnal perolehan ${h.jurnal.nomor}` : null);
          tutup(); navigasi(location.hash, true);
        } catch (err) { galat(err); tombol.disabled = false; }
      } }, 'Simpan'),
    ],
  });
}

async function formUbah(a) {
  let coa;
  let unit;
  let peta;
  try {
    [coa, unit, peta] = await Promise.all([
      api.get('/api/master/coa', { limit: 1000 }), api.get('/api/master/unit-usaha'), petaAkun(),
    ]);
  } catch (err) { galat(err); return; }
  const akunBeban = coa.data.filter((c) => c.tipe === 'beban'
    && ((c.is_postable && c.status === 'aktif') || c.kode === a.coa_beban));

  const form = el('div', [
    el('div.notis.info', [el('div.isi', [
      el('strong', 'Harga perolehan dan akun aset tidak dapat diubah'),
      el('div.kecil', 'Nilai tersebut sudah dibukukan. Perubahan umur, metode, dan residu berlaku untuk '
        + 'penyusutan periode berikutnya.'),
    ])]),
    el('div.baris-form', [
      kolom('Nama Aset', input('nama', { nilai: a.nama }), { wajib: true }),
      kolom('Kategori', pilih('kategori', KATEGORI.map((k) => ({ nilai: k, teks: judul(k) })), a.kategori)),
    ]),
    el('div.baris-form.k3', [
      kolom('Metode Penyusutan', pilih('metode', METODE, a.metode)),
      kolom('Umur Manfaat (tahun)', input('umur_manfaat', { tipe: 'number', min: 1, nilai: a.umur_manfaat })),
      kolom('Nilai Residu', input('nilai_residu', { tipe: 'number', min: 0, nilai: a.nilai_residu || 0 })),
    ]),
    el('div.baris-form', [
      kolom('Akun Beban Penyusutan', pilihAkun('coa_beban', akunBeban, peta['coa.beban_penyusutan'], a.coa_beban || '')),
      kolom('Status', pilih('status', ['aktif', 'maintenance', 'rusak'].map((s) => ({ nilai: s, teks: judul(s) })),
        a.status)),
    ]),
    el('div.baris-form.k3', [
      kolom('Lokasi', input('lokasi', { nilai: a.lokasi || '' })),
      kolom('Penanggung Jawab', input('penanggung_jawab', { nilai: a.penanggung_jawab || '' })),
      kolom('Barcode', input('barcode', { nilai: a.barcode || '' })),
    ]),
    kolom('Unit Usaha', pilih('unit_usaha_id', [{ nilai: '', teks: '- tidak spesifik -' },
      ...unit.data.map((u) => ({ nilai: u.id, teks: u.nama }))], a.unit_usaha_id ?? '')),
  ]);

  const tutup = modal({
    judul: `Ubah Aset — ${a.kode}`, lebar: 'lebar', isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async (e) => {
        const tombol = e.currentTarget;
        tombol.disabled = true;
        try {
          await api.put(`/api/aset/${a.id}`, bacaForm(form));
          toast('Data aset diperbarui', 'sukses');
          tutup(); navigasi(location.hash, true);
        } catch (err) { galat(err); tombol.disabled = false; }
      } }, 'Simpan'),
    ],
  });
}

async function hapusAset(e, a) {
  const tombol = e.currentTarget;
  if (!await konfirmasi(`Hapus aset ${a.kode} — ${a.nama}? Jurnal perolehannya dibatalkan dengan jurnal balik `
    + 'dan utang perolehan (bila ada) ikut dihapus. Gunakan hanya untuk aset yang salah input.',
  { judul: 'Hapus Aset', ya: 'Hapus Aset', jenis: 'bahaya' })) return;
  tombol.disabled = true;
  try {
    await api.del(`/api/aset/${a.id}`);
    toast('Aset dihapus', 'sukses');
    location.hash = '#/aset';
  } catch (err) { galat(err); tombol.disabled = false; }
}

function formPenyusutan() {
  const form = el('div', [
    el('div.notis.info', [el('div.isi', [
      el('strong', 'Penyusutan bulanan'),
      el('div.kecil', 'Sistem menghitung beban penyusutan seluruh aset aktif untuk periode terpilih '
        + 'dan membentuk satu jurnal. Aset yang sudah disusutkan pada periode tersebut dilewati.'),
    ])]),
    kolom('Periode', input('periode', { placeholder: 'YYYY-MM', nilai: hariIni().slice(0, 7) }), { wajib: true }),
  ]);
  const tutup = modal({
    judul: 'Jalankan Penyusutan', isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async (e) => {
        const tombol = e.currentTarget;
        tombol.disabled = true;
        try {
          const h = await api.post('/api/aset/penyusutan', bacaForm(form));
          toast(h.pesan || 'Penyusutan berhasil dibukukan', 'sukses',
            h.total ? `${h.jumlah_aset} aset · total ${rp(h.total)}` : null);
          tutup(); navigasi(location.hash, true);
        } catch (err) { galat(err); tombol.disabled = false; }
      } }, 'Jalankan'),
    ],
  });
}

async function formDisposal(a) {
  const bank = await rekeningBank();
  const pilihMetode = pilih('metode', [{ nilai: 'tunai', teks: 'Tunai' }, { nilai: 'transfer', teks: 'Transfer Bank' }]);
  const bagianBank = el('div', [kolomBank(bank, 'Rekening Penerima')]);
  const atur = () => tampilkan(bagianBank, pilihMetode.value === 'transfer');
  pilihMetode.addEventListener('change', atur);

  const form = el('div', [
    el('div.notis.peringatan', [el('div.isi', [
      el('strong', `Nilai buku saat ini ${rp(a.nilai_buku)}`),
      el('div.kecil', 'Selisih antara hasil penjualan dan nilai buku diakui sebagai laba/rugi pelepasan aset.'),
    ])]),
    el('div.baris-form.k3', [
      kolom('Tanggal', input('tanggal', { tipe: 'date', nilai: hariIni() })),
      kolom('Nilai Jual', input('nilai_jual', { tipe: 'number', min: 0, nilai: 0 })),
      kolom('Metode Terima', pilihMetode),
    ]),
    bagianBank,
    kolom('Keterangan', input('keterangan')),
  ]);
  atur();
  const tutup = modal({
    judul: `Pelepasan Aset — ${a.kode}`, isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.bahaya', { onclick: async (e) => {
        const tombol = e.currentTarget;
        tombol.disabled = true;
        try {
          const h = await api.post(`/api/aset/${a.id}/disposal`, bacaTerlihat(form));
          toast('Aset berhasil dilepas', 'sukses',
            `${h.laba_rugi >= 0 ? 'Laba' : 'Rugi'} pelepasan ${rp(Math.abs(h.laba_rugi))}`);
          tutup(); navigasi(location.hash, true);
        } catch (err) { galat(err); tombol.disabled = false; }
      } }, 'Proses Pelepasan'),
    ],
  });
}

async function formMaintenance(a) {
  const bank = await rekeningBank();
  const pilihBayar = pilih('metode_bayar', [
    { nilai: 'tunai', teks: 'Tunai (kas)' },
    { nilai: 'transfer', teks: 'Transfer bank' },
    { nilai: 'hutang', teks: 'Utang ke vendor' },
  ]);
  const bagianBank = el('div', [kolomBank(bank, 'Rekening Pembayar')]);
  const bagianHutang = el('div', [kolom('Jatuh Tempo Utang', input('jatuh_tempo', { tipe: 'date' }))]);
  const atur = () => {
    tampilkan(bagianBank, pilihBayar.value === 'transfer');
    tampilkan(bagianHutang, pilihBayar.value === 'hutang');
  };
  pilihBayar.addEventListener('change', atur);

  const form = el('div', [
    el('div.notis.info', [el('div.isi', [
      el('strong', 'Biaya pemeliharaan dijurnal otomatis'),
      el('div.kecil', 'D Beban Pemeliharaan · K Kas / Bank / Utang Usaha sesuai cara bayar '
        + '(akun mengikuti Parameter Sistem). Biaya nol tidak membentuk jurnal.'),
    ])]),
    el('div.baris-form.k3', [
      kolom('Tanggal', input('tanggal', { tipe: 'date', nilai: hariIni() })),
      kolom('Jenis', input('jenis', { nilai: 'Perawatan rutin' })),
      kolom('Biaya', input('biaya', { tipe: 'number', min: 0, nilai: 0 })),
    ]),
    el('div.baris-form', [
      kolom('Vendor', input('vendor')),
      kolom('Cara Bayar', pilihBayar),
    ]),
    bagianBank, bagianHutang,
    el('div.baris-form', [
      kolom('Jadwal Berikutnya', input('jadwal_berikutnya', { tipe: 'date' })),
      kolom('Keterangan', input('keterangan')),
    ]),
  ]);
  atur();
  const tutup = modal({
    judul: `Pemeliharaan — ${a.nama}`, isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async (e) => {
        const tombol = e.currentTarget;
        tombol.disabled = true;
        try {
          const h = await api.post(`/api/aset/${a.id}/maintenance`, bacaTerlihat(form));
          toast('Pemeliharaan tercatat', 'sukses', h.jurnal?.nomor ? `Jurnal ${h.jurnal.nomor}` : null);
          tutup(); navigasi(location.hash, true);
        } catch (err) { galat(err); tombol.disabled = false; }
      } }, 'Simpan'),
    ],
  });
}
