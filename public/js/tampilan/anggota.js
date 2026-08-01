/**
 * Modul 3 - Manajemen Keanggotaan.
 */
import {
  api, el, kpi, panel, panelTabel, tabel, rp, angka, tgl, status, judul, modal, kolom, input,
  pilih, bacaForm, toast, galat, konfirmasi, kosong, memuat, kosongkan, persen,
} from '../inti.js';
import { grafikBatang, grafikPeringkat } from '../grafik.js';
import { izin, navigasi } from '../app.js';
import { ikon } from '../ikon.js';

const STATUS = ['', 'calon', 'aktif', 'nonaktif', 'keluar', 'meninggal', 'ditolak'];

export async function render(param) {
  if (param[0]) return detail(Number(param[0]));

  const wadah = el('div');
  const st = await api.get('/api/anggota/statistik');

  wadah.append(el('div.grid.k4.mb16', [
    kpi('Anggota Aktif', angka(st.aktif), { ikon: ikon('anggota') }),
    kpi('Calon Anggota', angka(st.calon), { catatan: 'Menunggu verifikasi', ikon: ikon('orang'),
      jenis: st.calon ? 'peringatan' : '' }),
    kpi('Total Terdaftar', angka(st.total), { ikon: ikon('papan') }),
    kpi('Keluar / Meninggal', angka(st.keluar), { ikon: ikon('keluar') }),
  ]));

  wadah.append(el('div.grid.k2', [
    panel('Pertumbuhan Anggota per Bulan', grafikBatang({
      label: st.pertumbuhan.map((p) => p.periode.slice(2)),
      data: st.pertumbuhan.map((p) => p.jumlah),
      tinggi: 200, format: (v) => angka(v),
    })),
    panel('Sebaran per Cabang', grafikPeringkat({
      baris: st.per_cabang.map((c) => ({ label: c.cabang, nilai: c.jumlah })),
      format: (v) => `${angka(v)} orang`,
    })),
  ]));

  // ------------------------------ Daftar ------------------------------
  const daftar = el('div');
  wadah.append(daftar);
  let q = '';
  let filter = '';

  async function muat() {
    kosongkan(daftar).append(memuat());
    try {
      const d = await api.get('/api/anggota', { q, status: filter, limit: 100 });
      kosongkan(daftar).append(panelTabel(`Daftar Anggota (${angka(d.total)})`, tabel([
        { judul: 'No. Anggota', render: (r) => el('span.mono', r.nomor_anggota) },
        { judul: 'Nama', render: (r) => el('div', [
          el('div.tebal', r.nama),
          el('div.kecil.samar', r.pekerjaan || '-'),
        ]) },
        { judul: 'NIK', render: (r) => el('span.mono.kecil', r.nik) },
        { judul: 'Telepon', render: (r) => r.telepon || '-' },
        { judul: 'Simpanan', angka: true, render: (r) => rp(r.total_simpanan) },
        { judul: 'Pinjaman', angka: true, render: (r) => (r.outstanding_pinjaman
          ? el('span.neg', rp(r.outstanding_pinjaman)) : el('span.samar', '-')) },
        { judul: 'Status', render: (r) => status(r.status) },
      ], d.data, {
        saatKlik: (r) => { location.hash = `#/anggota/${r.id}`; },
        kosongTeks: 'Tidak ada anggota yang cocok dengan pencarian',
      }), [
        el('input', { type: 'search', placeholder: 'Cari nama, nomor anggota, NIK…',
          nilai: q, oninput: (e) => { q = e.target.value; clearTimeout(muat.t);
            muat.t = setTimeout(muat, 320); } }),
        pilih('f', STATUS.map((s) => ({ nilai: s, teks: s ? judul(s) : 'Semua status' })), filter,
          { onchange: (e) => { filter = e.target.value; muat(); } }),
        izin('anggota.create') && el('button.btn.utama', { onclick: () => formAnggota(null, muat) },
          '+ Daftarkan Anggota'),
      ]));
    } catch (err) { galat(err); }
  }
  await muat();
  return wadah;
}

// ------------------------------- Detail -------------------------------

async function detail(id) {
  const a = await api.get(`/api/anggota/${id}`);
  const wadah = el('div');

  wadah.append(el('div.gap8.mb16', [
    el('button.btn', { onclick: () => { location.hash = '#/anggota'; } }, '← Kembali'),
    izin('anggota.update') && !['keluar', 'meninggal'].includes(a.status)
      && el('button.btn', { onclick: () => formAnggota(a, () => navigasi(location.hash, true)) }, 'Ubah Data'),
    izin('anggota.approve') && a.status === 'calon'
      && el('button.btn.sukses', { onclick: () => setujui(a) }, '✓ Setujui Keanggotaan'),
    izin('anggota.approve') && a.status === 'calon'
      && el('button.btn.bahaya', { onclick: () => tolak(a) }, '✕ Tolak'),
    izin('anggota.update') && a.status === 'aktif'
      && el('button.btn', { onclick: () => keluarAnggota(a) }, 'Proses Keluar'),
  ].filter(Boolean)));

  wadah.append(el('div.grid.k4.mb16', [
    kpi('Simpanan Pokok', rp(a.simpanan.total_pokok)),
    kpi('Simpanan Wajib', rp(a.simpanan.total_wajib)),
    kpi('Simpanan Sukarela', rp(a.simpanan.total_sukarela)),
    kpi('Total Simpanan', rp(a.simpanan.total_simpanan), { jenis: 'sukses' }),
  ]));

  wadah.append(el('div.grid.k2', [
    panel('Data Pribadi', el('dl.deskripsi', [
      el('dt', 'Nomor anggota'), el('dd', el('span.mono', a.nomor_anggota)),
      el('dt', 'Nama lengkap'), el('dd', a.nama),
      el('dt', 'NIK'), el('dd', el('span.mono', a.nik)),
      el('dt', 'No. KK'), el('dd', a.no_kk || '-'),
      el('dt', 'NPWP'), el('dd', a.npwp || '-'),
      el('dt', 'Jenis kelamin'), el('dd', a.jenis_kelamin === 'L' ? 'Laki-laki' : a.jenis_kelamin === 'P' ? 'Perempuan' : '-'),
      el('dt', 'Tempat, tgl lahir'), el('dd', `${a.tempat_lahir || '-'}, ${tgl(a.tanggal_lahir, true)}`),
      el('dt', 'Alamat'), el('dd', [a.alamat, a.kelurahan, a.kecamatan, a.kota].filter(Boolean).join(', ') || '-'),
      el('dt', 'Telepon'), el('dd', a.telepon || '-'),
      el('dt', 'Surel'), el('dd', a.email || '-'),
    ])),
    panel('Keanggotaan', el('dl.deskripsi', [
      el('dt', 'Status'), el('dd', status(a.status)),
      el('dt', 'Jenis anggota'), el('dd', judul(a.jenis_anggota)),
      el('dt', 'Cabang'), el('dd', a.cabang_nama || '-'),
      el('dt', 'Tanggal daftar'), el('dd', tgl(a.tanggal_daftar, true)),
      el('dt', 'Tanggal gabung'), el('dd', tgl(a.tanggal_gabung, true)),
      a.tanggal_keluar && el('dt', 'Tanggal keluar'), a.tanggal_keluar && el('dd', tgl(a.tanggal_keluar, true)),
      a.alasan_keluar && el('dt', 'Alasan'), a.alasan_keluar && el('dd', judul(a.alasan_keluar)),
      el('dt', 'Pekerjaan'), el('dd', a.pekerjaan || '-'),
      el('dt', 'Penghasilan'), el('dd', rp(a.penghasilan)),
      el('dt', 'Pendidikan'), el('dd', a.pendidikan || '-'),
      el('dt', 'Poin loyalti'), el('dd', `${angka(a.poin_loyalty)} poin`),
    ].filter(Boolean))),
  ]));

  wadah.append(panelTabel('Rekening Simpanan', tabel([
    { judul: 'Nomor Rekening', render: (r) => el('span.mono', r.nomor_rekening) },
    { judul: 'Produk', kunci: 'produk_nama' },
    { judul: 'Jenis', render: (r) => judul(r.jenis) },
    { judul: 'Dibuka', render: (r) => tgl(r.tanggal_buka) },
    { judul: 'Saldo', angka: true, render: (r) => el('strong', rp(r.saldo)) },
    { judul: 'Status', render: (r) => status(r.status) },
  ], a.simpanan.rekening, { kosongTeks: 'Belum memiliki rekening simpanan' })));

  wadah.append(panelTabel('Riwayat Pinjaman', tabel([
    { judul: 'Nomor', render: (r) => el('a.mono', { href: `#/pinjaman/${r.id}` }, r.nomor) },
    { judul: 'Produk', kunci: 'produk_nama' },
    { judul: 'Diajukan', render: (r) => tgl(r.tanggal_pengajuan) },
    { judul: 'Pokok', angka: true, render: (r) => rp(r.pokok) },
    { judul: 'Sisa Pokok', angka: true, render: (r) => rp(r.outstanding_pokok) },
    { judul: 'Tenor', angka: true, render: (r) => `${r.tenor} bln` },
    { judul: 'Status', render: (r) => status(r.status) },
  ], a.pinjaman, { kosongTeks: 'Belum pernah mengajukan pinjaman' })));

  if (a.shu?.length) {
    wadah.append(panelTabel('Riwayat SHU', tabel([
      { judul: 'Tahun Buku', kunci: 'tahun' },
      { judul: 'Simpanan Rata-rata', angka: true, render: (r) => rp(r.simpanan_rata) },
      { judul: 'Nilai Transaksi', angka: true, render: (r) => rp(r.nilai_transaksi) },
      { judul: 'Jasa Modal', angka: true, render: (r) => rp(r.shu_jasa_modal) },
      { judul: 'Jasa Usaha', angka: true, render: (r) => rp(r.shu_jasa_usaha) },
      { judul: 'Total SHU', angka: true, render: (r) => el('strong.pos', rp(r.shu_total)) },
      { judul: 'Status', render: (r) => status(r.dibayar ? 'dibagikan' : r.status_periode) },
    ], a.shu)));
  }

  wadah.append(el('div.grid.k2', [
    panelTabel('Ahli Waris', tabel([
      { judul: 'Nama', kunci: 'nama' },
      { judul: 'Hubungan', render: (r) => judul(r.hubungan || '-') },
      { judul: 'Telepon', render: (r) => r.telepon || '-' },
      { judul: 'Bagian', angka: true, render: (r) => persen(r.persentase) },
    ], a.ahli_waris, { kosongTeks: 'Belum ada ahli waris terdaftar' })),
    panelTabel('Riwayat Perubahan', tabel([
      { judul: 'Tanggal', render: (r) => tgl(r.created_at) },
      { judul: 'Perubahan', render: (r) => (r.status_baru
        ? `${r.status_lama || '-'} → ${r.status_baru}` : judul(r.jenis)) },
      { judul: 'Keterangan', render: (r) => el('span.kecil.lembut', r.keterangan || '-') },
      { judul: 'Oleh', render: (r) => el('span.kecil', r.oleh || '-') },
    ], a.riwayat, { kosongTeks: 'Belum ada riwayat' })),
  ]));

  return wadah;
}

// ------------------------------ Formulir ------------------------------

async function formAnggota(data, saatSelesai) {
  const cabang = await api.get('/api/master/cabang');
  const isBaru = !data;
  const form = el('div', [
    el('div.baris-form', [
      kolom('NIK (16 digit)', input('nik', { nilai: data?.nik || '', maxlength: 16,
        inputmode: 'numeric', placeholder: '3171xxxxxxxxxxxx' }), { wajib: true }),
      kolom('Nama Lengkap', input('nama', { nilai: data?.nama || '' }), { wajib: true }),
    ]),
    el('div.baris-form.k3', [
      kolom('Jenis Kelamin', pilih('jenis_kelamin', [
        { nilai: '', teks: '- pilih -' }, { nilai: 'L', teks: 'Laki-laki' },
        { nilai: 'P', teks: 'Perempuan' }], data?.jenis_kelamin)),
      kolom('Tempat Lahir', input('tempat_lahir', { nilai: data?.tempat_lahir || '' })),
      kolom('Tanggal Lahir', input('tanggal_lahir', { tipe: 'date', nilai: data?.tanggal_lahir || '' })),
    ]),
    kolom('Alamat', input('alamat', { nilai: data?.alamat || '' })),
    el('div.baris-form.k3', [
      kolom('Kelurahan', input('kelurahan', { nilai: data?.kelurahan || '' })),
      kolom('Kecamatan', input('kecamatan', { nilai: data?.kecamatan || '' })),
      kolom('Kota/Kabupaten', input('kota', { nilai: data?.kota || '' })),
    ]),
    el('div.baris-form', [
      kolom('Telepon', input('telepon', { nilai: data?.telepon || '' })),
      kolom('Surel', input('email', { tipe: 'email', nilai: data?.email || '' })),
    ]),
    el('div.baris-form.k3', [
      kolom('Pekerjaan', input('pekerjaan', { nilai: data?.pekerjaan || '' })),
      kolom('Penghasilan / bulan', input('penghasilan', { tipe: 'number', min: 0,
        nilai: data?.penghasilan || 0 }), { bantuan: 'Dipakai untuk analisis kelayakan pinjaman' }),
      kolom('Pendidikan', input('pendidikan', { nilai: data?.pendidikan || '' })),
    ]),
    el('div.baris-form', [
      kolom('NPWP', input('npwp', { nilai: data?.npwp || '' })),
      kolom('Cabang', pilih('cabang_id', cabang.data.map((c) => ({ nilai: c.id, teks: c.nama })),
        data?.cabang_id)),
    ]),
  ]);

  const tutup = modal({
    judul: isBaru ? 'Pendaftaran Calon Anggota' : `Ubah Data — ${data.nama}`,
    lebar: 'lebar', isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async (e) => {
        const b = e.currentTarget;
        b.disabled = true;
        try {
          const d = bacaForm(form);
          if (isBaru) await api.post('/api/anggota', d);
          else await api.put(`/api/anggota/${data.id}`, d);
          toast(isBaru ? 'Calon anggota berhasil didaftarkan' : 'Data anggota diperbarui', 'sukses');
          tutup();
          saatSelesai?.();
        } catch (err) { galat(err); b.disabled = false; }
      } }, 'Simpan'),
    ],
  });
}

async function setujui(a) {
  const form = el('div', [
    el('p', `Menyetujui ${a.nama} sebagai anggota koperasi. Simpanan pokok wajib disetor setelah persetujuan.`),
    kolom('Tanggal Bergabung', input('tanggal_gabung', { tipe: 'date',
      nilai: new Date().toISOString().slice(0, 10) })),
  ]);
  const tutup = modal({
    judul: 'Setujui Keanggotaan', lebar: 'sempit', isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.sukses', { onclick: async () => {
        try {
          await api.post(`/api/anggota/${a.id}/setujui`, bacaForm(form));
          toast('Anggota berhasil disetujui', 'sukses');
          tutup(); navigasi(location.hash, true);
        } catch (err) { galat(err); }
      } }, 'Setujui'),
    ],
  });
}

async function tolak(a) {
  const form = el('div', [kolom('Alasan Penolakan', input('alasan'), { wajib: true })]);
  const tutup = modal({
    judul: 'Tolak Pendaftaran', lebar: 'sempit', isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.bahaya', { onclick: async () => {
        try {
          await api.post(`/api/anggota/${a.id}/tolak`, bacaForm(form));
          toast('Pendaftaran ditolak', 'sukses');
          tutup(); navigasi(location.hash, true);
        } catch (err) { galat(err); }
      } }, 'Tolak'),
    ],
  });
}

async function keluarAnggota(a) {
  const form = el('div', [
    el('div.notis.peringatan', [el('div.isi', [
      el('strong', 'Perhatian'),
      el('div.kecil', 'Anggota tidak dapat keluar bila masih memiliki pinjaman berjalan. '
        + 'Simpanan pokok & wajib dikembalikan melalui modul Simpanan setelah proses ini.'),
    ])]),
    kolom('Alasan Keluar', pilih('alasan_keluar', [
      { nilai: 'mengundurkan_diri', teks: 'Mengundurkan diri' },
      { nilai: 'meninggal', teks: 'Meninggal dunia' },
      { nilai: 'diberhentikan', teks: 'Diberhentikan' },
    ]), { wajib: true }),
    kolom('Tanggal Keluar', input('tanggal_keluar', { tipe: 'date',
      nilai: new Date().toISOString().slice(0, 10) })),
    kolom('Keterangan', input('keterangan')),
  ]);
  const tutup = modal({
    judul: `Proses Keluar — ${a.nama}`, isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.bahaya', { onclick: async () => {
        try {
          const h = await api.post(`/api/anggota/${a.id}/keluar`, bacaForm(form));
          toast('Anggota diproses keluar', 'sukses', h.catatan);
          tutup(); navigasi(location.hash, true);
        } catch (err) { galat(err); }
      } }, 'Proses Keluar'),
    ],
  });
}
