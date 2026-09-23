/**
 * Modul 3 - Manajemen Keanggotaan.
 */
import {
  api, el, kpi, panel, panelTabel, tabel, rp, angka, tgl, status, judul, modal, kolom, input, pilih,
  bacaForm, toast, galat, konfirmasi, kosong, memuat, kosongkan, persen, tabelServer, ukuranHalaman,
  ambilSemua,
} from '../inti.js';
import { grafikBatang, grafikPeringkat } from '../grafik.js';
import { izin, navigasi } from '../app.js';
import { ikon } from '../ikon.js';
import { daftarBank, kolomBank, denganTombol, kapital, teksMetode } from './simpanan.js';
import { cetakDokumen, tombolCetak, dataCetak } from '../cetak.js';

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
      const ambil = (h) => api.get('/api/anggota', { q, status: filter, ...h });
      const d = await ambil({ limit: ukuranHalaman(), offset: 0 });
      kosongkan(daftar).append(panelTabel(`Daftar Anggota (${angka(d.total)})`, tabelServer([
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
      ], {
        awal: d, ambil,
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
        tombolCetak(async () => { const semua = await ambilSemua(ambil); return {
          judul: 'Daftar Anggota Koperasi', jenis_ttd: 'laporan', orientasi: 'landscape',
          keterangan: [filter && `Status: ${judul(filter)}`, q && `Pencarian: "${q}"`].filter(Boolean),
          bagian: [{
            kolom: [{ kunci: 'no', label: 'No', tipe: 'angka' }, { kunci: 'nomor_anggota', label: 'No. Anggota' },
              { kunci: 'nama', label: 'Nama' }, { kunci: 'nik', label: 'NIK' }, { kunci: 'telepon', label: 'Telepon' },
              { kunci: 'pekerjaan', label: 'Pekerjaan' }, { kunci: 'total_simpanan', label: 'Simpanan', tipe: 'uang' },
              { kunci: 'outstanding_pinjaman', label: 'Pinjaman', tipe: 'uang' }, { kunci: 'status', label: 'Status' }],
            baris: semua.map((r, i) => ({ ...r, no: i + 1, status: judul(r.status) })),
            total: { total_simpanan: semua.reduce((t, r) => t + (r.total_simpanan || 0), 0),
              outstanding_pinjaman: semua.reduce((t, r) => t + (r.outstanding_pinjaman || 0), 0) },
          }],
        }; }, { label: 'Cetak' }),
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
  const segarkan = () => navigasi(location.hash, true);
  const sudahKeluar = ['keluar', 'meninggal'].includes(a.status);

  wadah.append(el('div.gap8.mb16', [
    el('button.btn', { onclick: () => { location.hash = '#/anggota'; } }, '← Kembali'),
    izin('anggota.update') && !sudahKeluar
      && el('button.btn', { onclick: () => formAnggota(a, segarkan) }, 'Ubah Data'),
    izin('anggota.approve') && a.status === 'calon'
      && el('button.btn.sukses', { onclick: () => setujui(a) }, '✓ Setujui Keanggotaan'),
    izin('anggota.approve') && a.status === 'calon'
      && el('button.btn.bahaya', { onclick: () => tolak(a) }, '✕ Tolak'),
    izin('anggota.update') && a.status === 'aktif'
      && el('button.btn', { onclick: () => ubahKeaktifan(a, false) }, 'Nonaktifkan'),
    izin('anggota.update') && a.status === 'nonaktif'
      && el('button.btn.sukses', { onclick: () => ubahKeaktifan(a, true) }, 'Aktifkan Kembali'),
    izin('anggota.update') && ['aktif', 'nonaktif'].includes(a.status)
      && el('button.btn.bahaya', { onclick: () => keluarAnggota(a) }, 'Proses Keluar'),
    !['calon', 'ditolak'].includes(a.status)
      && el('button.btn', { onclick: () => kartuAnggota(a).catch(galat) }, 'Kartu Anggota'),
    el('button.btn', { onclick: (e) => denganTombol(e, () => cetakDokumen(dokBiodata(a))) },
      a.status === 'calon' ? 'Cetak Formulir Pendaftaran' : 'Cetak Biodata'),
    sudahKeluar && el('button.btn', { onclick: (e) => denganTombol(e, () => cetakBuktiKeluar(a.id)) },
      'Cetak Bukti Keluar'),
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
  ], a.simpanan.rekening, { kosongTeks: 'Belum memiliki rekening simpanan',
    saatKlik: izin('simpanan.view') ? (r) => { location.hash = `#/simpanan/${r.id}`; } : null })));

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
      { judul: 'Nama', render: (r) => el('div', [
        el('div', r.nama), r.nik && el('div.kecil.samar.mono', r.nik)]) },
      { judul: 'Hubungan', render: (r) => judul(r.hubungan || '-') },
      { judul: 'Telepon', render: (r) => r.telepon || '-' },
      { judul: 'Bagian', angka: true, render: (r) => persen(r.persentase) },
      izin('anggota.update') && { judul: '', render: (r) => el('div.gap8', [
        el('button.btn.kecil', { onclick: () => formAhliWaris(a, r, segarkan) }, 'Ubah'),
        el('button.btn.kecil.bahaya', { onclick: () => hapusAhliWaris(r, segarkan) }, 'Hapus'),
      ]) },
    ].filter(Boolean), a.ahli_waris, { kosongTeks: 'Belum ada ahli waris terdaftar' }), [
      izin('anggota.update') && el('button.btn.kecil', {
        onclick: () => formAhliWaris(a, null, segarkan) }, '+ Tambah Ahli Waris'),
    ].filter(Boolean)),
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
  const bank = await daftarBank();
  const rekeningBuka = (a.simpanan?.rekening || []).filter((r) => r.status !== 'tutup');
  const saldo = rekeningBuka.reduce((t, r) => t + r.saldo, 0);
  const diblokir = rekeningBuka.reduce((t, r) => t + (r.saldo_blokir || 0), 0);

  const centang = input('kembalikan_simpanan', { tipe: 'checkbox', checked: true });
  const metode = pilih('metode', [{ nilai: 'tunai', teks: 'Tunai' }, { nilai: 'transfer', teks: 'Transfer Bank' }]);
  const bagianPengembalian = el('div.baris-form', [kolom('Metode Pengembalian', metode), kolomBank(metode, bank)]);
  const aturPengembalian = () => { bagianPengembalian.style.display = centang.checked ? '' : 'none'; };
  centang.addEventListener('change', aturPengembalian);

  const form = el('div', [
    el('div.notis.peringatan', [el('div.isi', [
      el('strong', 'Perhatian'),
      el('div.kecil', 'Anggota tidak dapat keluar bila masih memiliki pinjaman berjalan. '
        + `Saldo simpanan saat ini ${rp(saldo)} pada ${rekeningBuka.length} rekening`
        + `${diblokir > 0 ? ` (termasuk ${rp(diblokir)} yang diblokir)` : ''}.`),
    ])]),
    el('div.baris-form', [
      kolom('Alasan Keluar', pilih('alasan_keluar', [
        { nilai: 'mengundurkan_diri', teks: 'Mengundurkan diri' },
        { nilai: 'meninggal', teks: 'Meninggal dunia' },
        { nilai: 'diberhentikan', teks: 'Diberhentikan' },
      ]), { wajib: true }),
      kolom('Tanggal Keluar', input('tanggal_keluar', { tipe: 'date',
        nilai: new Date().toISOString().slice(0, 10) })),
    ]),
    kolom('Keterangan', input('keterangan')),
    el('label.kecil', { gaya: { display: 'flex', gap: '8px', alignItems: 'center', margin: '4px 0 12px' } }, [
      centang, 'Kembalikan seluruh simpanan sekarang (pokok, wajib & sukarela; dijurnal otomatis)',
    ]),
    bagianPengembalian,
    el('div.kecil.lembut', 'Bila tidak dicentang, simpanan dikembalikan kemudian melalui menu Simpanan → Tutup Rekening.'),
  ]);
  aturPengembalian();

  const tutup = modal({
    judul: `Proses Keluar — ${a.nama}`, isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.bahaya', { onclick: async (e) => {
        const tombol = e.currentTarget;
        tombol.disabled = true;
        try {
          const h = await api.post(`/api/anggota/${a.id}/keluar`, bacaForm(form));
          tutup();
          if (h.pengembalian?.length) ringkasanPengembalian(a, h, () => navigasi(location.hash, true));
          else { toast('Anggota diproses keluar', 'sukses', h.catatan); navigasi(location.hash, true); }
        } catch (err) { galat(err); tombol.disabled = false; }
      } }, 'Proses Keluar'),
    ],
  });
}

/** Rincian pengembalian simpanan per rekening setelah anggota keluar. */
function ringkasanPengembalian(a, h, saatTutup) {
  const peta = new Map((a.simpanan?.rekening || []).map((r) => [r.id, r]));
  const total = h.pengembalian.reduce((t, p) => t + (p.dikembalikan || 0), 0);
  const tutup = modal({
    judul: 'Pengembalian Simpanan', saatTutup,
    isi: el('div', [
      el('div.notis.sukses', [el('div.isi', [
        el('strong', `${a.nama} telah ${h.status === 'meninggal' ? 'dicatat meninggal' : 'keluar'}`),
        el('div.kecil', h.catatan || ''),
      ])]),
      el('div.tabel-bungkus', [tabel([
        { judul: 'Rekening', render: (p) => el('span.mono', peta.get(p.rekening_id)?.nomor_rekening || `#${p.rekening_id}`) },
        { judul: 'Produk', render: (p) => peta.get(p.rekening_id)?.produk_nama || '-' },
        { judul: 'Dikembalikan', kunci: 'dikembalikan', angka: true, render: (p) => el('strong', rp(p.dikembalikan)) },
        { judul: 'Jurnal', render: (p) => (p.jurnal ? el('span.mono.kecil', p.jurnal.nomor) : el('span.samar', '-')) },
      ], h.pengembalian, { kaki: { dikembalikan: el('strong', rp(total)) } })]),
    ]),
    kaki: [
      el('button.btn', { onclick: (e) => denganTombol(e, () => cetakBuktiKeluar(a.id)) }, 'Cetak Bukti Keluar'),
      el('button.btn.utama', { onclick: () => tutup() }, 'Selesai'),
    ],
  });
}

async function ubahKeaktifan(a, aktifkan) {
  const form = el('div', [
    el('p', aktifkan
      ? `Mengaktifkan kembali ${a.nama} sebagai anggota aktif.`
      : `Menonaktifkan ${a.nama}. Anggota nonaktif tetap tercatat dan dapat diaktifkan kembali.`),
    kolom('Alasan', input('alasan', { placeholder: 'Opsional' })),
  ]);
  const tutup = modal({
    judul: aktifkan ? 'Aktifkan Kembali Anggota' : 'Nonaktifkan Anggota', lebar: 'sempit', isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el(`button.btn.${aktifkan ? 'sukses' : 'bahaya'}`, { onclick: async (e) => {
        const tombol = e.currentTarget;
        tombol.disabled = true;
        try {
          await api.post(`/api/anggota/${a.id}/nonaktif`, { ...bacaForm(form), aktifkan });
          toast(aktifkan ? 'Anggota diaktifkan kembali' : 'Anggota dinonaktifkan', 'sukses');
          tutup(); navigasi(location.hash, true);
        } catch (err) { galat(err); tombol.disabled = false; }
      } }, aktifkan ? 'Aktifkan' : 'Nonaktifkan'),
    ],
  });
}

// ----------------------------- Ahli waris -----------------------------

function formAhliWaris(a, w, saatSelesai) {
  const totalLain = (a.ahli_waris || []).filter((x) => x.id !== w?.id)
    .reduce((t, x) => t + Number(x.persentase || 0), 0);
  // Data lama bisa berisi "Anak" (huruf besar) atau nilai bebas; tetap dipertahankan
  const opsiHubungan = [{ nilai: '', teks: '- pilih -' },
    ...['suami', 'istri', 'anak', 'orang_tua', 'saudara', 'lainnya'].map((h) => ({ nilai: h, teks: judul(h) }))];
  const cocok = opsiHubungan.find((o) => o.nilai && o.nilai === String(w?.hubungan || '').toLowerCase().replace(/\s+/g, '_'));
  if (w?.hubungan && !cocok) opsiHubungan.push({ nilai: w.hubungan, teks: w.hubungan });
  const hubunganTerpilih = cocok ? cocok.nilai : (w?.hubungan || '');
  const form = el('div', [
    el('div.baris-form', [
      kolom('Nama Ahli Waris', input('nama', { nilai: w?.nama || '' }), { wajib: true }),
      kolom('NIK', input('nik', { nilai: w?.nik || '', maxlength: 16, inputmode: 'numeric' })),
    ]),
    el('div.baris-form.k3', [
      kolom('Hubungan', pilih('hubungan', opsiHubungan, hubunganTerpilih)),
      kolom('Telepon', input('telepon', { nilai: w?.telepon || '' })),
      kolom('Bagian (%)', input('persentase', { tipe: 'number', min: 0, max: 100, step: '0.01',
        nilai: w ? w.persentase : Math.max(0, 100 - totalLain) }),
      { bantuan: `Ahli waris lain ${persen(totalLain)}; total maksimal 100%` }),
    ]),
    kolom('Alamat', input('alamat', { nilai: w?.alamat || '' })),
  ]);
  const tutup = modal({
    judul: w ? `Ubah Ahli Waris — ${w.nama}` : `Tambah Ahli Waris — ${a.nama}`, isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async (e) => {
        const tombol = e.currentTarget;
        tombol.disabled = true;
        try {
          const d = bacaForm(form);
          if (w) await api.put(`/api/anggota/ahli-waris/${w.id}`, d);
          else await api.post(`/api/anggota/${a.id}/ahli-waris`, d);
          toast(w ? 'Ahli waris diperbarui' : 'Ahli waris ditambahkan', 'sukses');
          tutup(); saatSelesai?.();
        } catch (err) { galat(err); tombol.disabled = false; }
      } }, 'Simpan'),
    ],
  });
}

async function hapusAhliWaris(w, saatSelesai) {
  if (!await konfirmasi(`Hapus ahli waris "${w.nama}"?`, { judul: 'Hapus Ahli Waris', ya: 'Hapus', jenis: 'bahaya' })) return;
  try {
    await api.del(`/api/anggota/ahli-waris/${w.id}`);
    toast('Ahli waris dihapus', 'sukses');
    saatSelesai?.();
  } catch (err) { galat(err); }
}

// ---------------------------- Kartu anggota ----------------------------

/**
 * Membentuk kartu anggota (dipakai untuk pratinjau maupun jendela cetak).
 * `c` = data cetak (kop & tanda tangan) dari dataCetak().
 */
function bentukKartu(k, c, doc = document) {
  const buat = (tag, gaya, anak = []) => {
    const n = doc.createElement(tag);
    Object.assign(n.style, gaya);
    for (const c of [].concat(anak)) if (c !== null && c !== undefined) n.append(c);
    return n;
  };
  const baris = (label, nilai) => buat('div', { display: 'flex', gap: '8px', fontSize: '12px', margin: '2px 0' }, [
    buat('span', { opacity: '.75', minWidth: '92px' }, label), buat('strong', {}, String(nilai ?? '-')),
  ]);
  let foto = null;
  if (k.foto && /^(data:image\/|https?:\/\/|\/)/.test(k.foto)) {
    foto = doc.createElement('img');
    foto.src = k.foto;
    foto.alt = k.nama;
    Object.assign(foto.style, { width: '72px', height: '90px', objectFit: 'cover', borderRadius: '6px',
      border: '2px solid rgba(255,255,255,.6)' });
  }
  let logo = null;
  if (c?.profil?.logo) {
    logo = doc.createElement('img');
    logo.src = c.profil.logo;
    logo.alt = 'Logo';
    Object.assign(logo.style, { height: '22px', maxWidth: '40px', objectFit: 'contain', background: '#fff',
      borderRadius: '4px', padding: '1px' });
  }
  // Tanda tangan sesuai pengaturan jenis cetakan "kartu_anggota"
  const ttd = c?.ttd?.kartu_anggota || { penanda: [] };
  const blokTtd = ttd.penanda?.length ? buat('div', { display: 'flex', gap: '10px', justifyContent: 'flex-end' },
    ttd.penanda.map((p) => buat('div', { textAlign: 'center', fontSize: '8.5px', lineHeight: '1.25', minWidth: '70px' }, [
      p.label ? buat('div', { opacity: '.85' }, p.label) : null,
      buat('div', { opacity: '.85' }, p.jabatan),
      buat('div', { height: '14px' }),
      buat('div', { fontWeight: '700', borderTop: '1px solid rgba(255,255,255,.7)', paddingTop: '1px' },
        p.nama || '(.....................)'),
    ]))) : null;
  return buat('div', {
    width: '85.6mm', minHeight: '54mm', boxSizing: 'border-box', padding: '12px 14px', borderRadius: '10px',
    background: 'linear-gradient(135deg,#062b63,#1a7bd4)', color: '#fff', fontFamily: 'system-ui, sans-serif',
    display: 'flex', flexDirection: 'column', gap: '6px', printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact',
  }, [
    buat('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }, [
      buat('div', { display: 'flex', alignItems: 'center', gap: '6px' }, [
        logo, buat('strong', { fontSize: '13px', letterSpacing: '.3px' }, c?.profil?.nama || k.koperasi),
      ]),
      buat('span', { fontSize: '10px', opacity: '.85' }, 'KARTU ANGGOTA'),
    ]),
    buat('div', { display: 'flex', gap: '12px', alignItems: 'center', flex: '1' }, [
      foto,
      buat('div', { flex: '1' }, [
        buat('div', { fontSize: '16px', fontWeight: '700', marginBottom: '4px' }, k.nama),
        baris('No. Anggota', k.nomor_anggota),
        baris('NIK', k.nik),
        baris('Bergabung', tgl(k.tanggal_gabung, true)),
        baris('Status', judul(k.status)),
      ]),
    ]),
    buat('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '8px' }, [
      buat('div', { fontFamily: 'ui-monospace, monospace', fontSize: '10px', background: 'rgba(255,255,255,.15)',
        padding: '3px 6px', borderRadius: '4px' }, k.qr),
      blokTtd,
    ]),
  ]);
}

async function kartuAnggota(a) {
  const [k, c] = await Promise.all([api.get(`/api/anggota/${a.id}/kartu`), dataCetak()]);
  const cetak = () => {
    const w = window.open('', '_blank', 'width=520,height=420');
    if (!w) { toast('Jendela cetak diblokir peramban', 'peringatan', 'Izinkan pop-up untuk situs ini lalu coba lagi.'); return; }
    w.document.title = `Kartu Anggota ${k.nomor_anggota}`;
    w.document.body.style.margin = '12mm';
    const gaya = w.document.createElement('style');
    gaya.textContent = '@page{size:A4 portrait;margin:10mm}';
    w.document.head.append(gaya);
    w.document.body.append(bentukKartu(k, c, w.document));
    w.focus();
    const gambar = [...w.document.images];
    const jalankan = () => setTimeout(() => { w.print(); }, 150);
    if (gambar.every((g) => g.complete)) jalankan();
    else Promise.all(gambar.map((g) => new Promise((r) => { g.onload = r; g.onerror = r; }))).then(jalankan);
  };
  const tutup = modal({
    judul: `Kartu Anggota — ${k.nama}`, isi: el('div', { gaya: { display: 'flex', justifyContent: 'center' } }, [bentukKartu(k, c)]),
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Tutup'),
      el('button.btn.utama', { onclick: cetak }, 'Cetak Kartu'),
    ],
  });
}

// ------------------------------- Cetakan -------------------------------

const teksJk = (jk) => (jk === 'L' ? 'Laki-laki' : jk === 'P' ? 'Perempuan' : '-');

/** Formulir pendaftaran / biodata anggota beserta ahli waris dan ringkasan simpanan. */
function dokBiodata(a) {
  const rek = a.simpanan?.rekening || [];
  const pinjamanBerjalan = (a.pinjaman || []).filter((p) => ['dicairkan', 'restrukturisasi', 'disetujui',
    'diajukan', 'dianalisis', 'survey'].includes(p.status));
  return {
    judul: a.status === 'calon' ? 'Formulir Pendaftaran Anggota' : 'Biodata Anggota Koperasi',
    nomor: a.nomor_anggota, jenis_ttd: 'anggota',
    ringkasan: [
      { label: 'Nama lengkap', nilai: a.nama },
      { label: 'NIK', nilai: a.nik },
      { label: 'No. KK', nilai: a.no_kk || '-' },
      { label: 'NPWP', nilai: a.npwp || '-' },
      { label: 'Jenis kelamin', nilai: teksJk(a.jenis_kelamin) },
      { label: 'Tempat, tgl lahir', nilai: `${a.tempat_lahir || '-'}, ${tgl(a.tanggal_lahir, true)}` },
      { label: 'Alamat', nilai: [a.alamat, a.kelurahan, a.kecamatan, a.kota, a.provinsi, a.kode_pos]
        .filter(Boolean).join(', ') || '-' },
      { label: 'Telepon', nilai: a.telepon || '-' },
      { label: 'Surel', nilai: a.email || '-' },
      { label: 'Pekerjaan', nilai: [a.pekerjaan, a.nama_instansi].filter(Boolean).join(' - ') || '-' },
      { label: 'Penghasilan / bulan', nilai: a.penghasilan, tipe: 'uang' },
      { label: 'Pendidikan', nilai: a.pendidikan || '-' },
      { label: 'Jenis anggota', nilai: judul(a.jenis_anggota) },
      { label: 'Cabang', nilai: a.cabang_nama || '-' },
      { label: 'Tanggal daftar', nilai: a.tanggal_daftar, tipe: 'tanggal' },
      { label: 'Tanggal bergabung', nilai: a.tanggal_gabung || '-', tipe: 'tanggal' },
      { label: 'Status', nilai: judul(a.status) },
      a.tanggal_keluar && { label: 'Tanggal keluar', nilai: a.tanggal_keluar, tipe: 'tanggal' },
    ].filter(Boolean),
    bagian: [
      { judul: 'Ahli Waris', kolom: [{ kunci: 'no', label: 'No', tipe: 'angka' }, { kunci: 'nama', label: 'Nama' },
        { kunci: 'nik', label: 'NIK' }, { kunci: 'hubungan', label: 'Hubungan' }, { kunci: 'telepon', label: 'Telepon' },
        { kunci: 'alamat', label: 'Alamat' }, { kunci: 'persentase', label: 'Bagian', tipe: 'persen' }],
      baris: (a.ahli_waris || []).map((w, i) => ({ ...w, no: i + 1, hubungan: judul(w.hubungan || '-') })) },
      { judul: 'Ringkasan Simpanan', kolom: [{ kunci: 'nomor_rekening', label: 'No. Rekening' },
        { kunci: 'produk_nama', label: 'Produk' }, { kunci: 'jenis', label: 'Jenis' },
        { kunci: 'tanggal_buka', label: 'Dibuka', tipe: 'tanggal' }, { kunci: 'saldo', label: 'Saldo', tipe: 'uang' },
        { kunci: 'status', label: 'Status' }],
      baris: rek.map((r) => ({ ...r, jenis: judul(r.jenis), status: judul(r.status) })),
      total: { saldo: a.simpanan?.total_simpanan || 0 } },
      pinjamanBerjalan.length ? { judul: 'Pinjaman Berjalan', kolom: [{ kunci: 'nomor', label: 'Nomor' },
        { kunci: 'produk_nama', label: 'Produk' }, { kunci: 'pokok', label: 'Pokok', tipe: 'uang' },
        { kunci: 'outstanding_pokok', label: 'Sisa Pokok', tipe: 'uang' }, { kunci: 'status', label: 'Status' }],
      baris: pinjamanBerjalan.map((p) => ({ ...p, status: judul(p.status) })) } : null,
    ].filter(Boolean),
    catatan: a.status === 'calon'
      ? 'Dengan menandatangani formulir ini, pemohon menyatakan data di atas benar dan bersedia mematuhi '
        + 'Anggaran Dasar, Anggaran Rumah Tangga, serta ketentuan koperasi, termasuk menyetor simpanan pokok dan wajib.'
      : null,
    penanda_tambahan: { Anggota: a.nama, Pemohon: a.nama },
  };
}

/** Bukti keluar anggota & pengembalian simpanan. */
async function cetakBuktiKeluar(id) {
  const d = await api.get(`/api/anggota/${id}/bukti-keluar`);
  const a = d.anggota;
  const meninggal = a.status === 'meninggal';
  const aw = meninggal ? d.ahli_waris[0] : null;
  const penerima = aw ? `${aw.nama} (ahli waris)` : a.nama;
  cetakDokumen({
    judul: 'Bukti Keluar Anggota & Pengembalian Simpanan', nomor: a.nomor_anggota, jenis_ttd: 'penarikan_simpanan',
    ringkasan: [
      { label: 'No. anggota', nilai: a.nomor_anggota },
      { label: 'Nama anggota', nilai: a.nama },
      { label: 'NIK', nilai: a.nik },
      { label: 'Tanggal bergabung', nilai: a.tanggal_gabung || '-', tipe: 'tanggal' },
      { label: 'Tanggal keluar', nilai: a.tanggal_keluar || '-', tipe: 'tanggal' },
      { label: 'Alasan', nilai: judul(a.alasan_keluar || a.status) },
      { label: 'Total dikembalikan', nilai: d.total, tipe: 'uang' },
      { label: 'Simpanan belum dikembalikan', nilai: d.sisa_saldo, tipe: 'uang' },
      aw && { label: 'Diterima oleh', nilai: penerima },
    ].filter(Boolean),
    bagian: [{
      judul: 'Rincian Pengembalian Simpanan',
      kolom: [{ kunci: 'no', label: 'No', tipe: 'angka' }, { kunci: 'nomor', label: 'No. Transaksi' },
        { kunci: 'tanggal', label: 'Tanggal', tipe: 'tanggal' }, { kunci: 'nomor_rekening', label: 'No. Rekening' },
        { kunci: 'produk_nama', label: 'Produk' }, { kunci: 'metode', label: 'Metode' },
        { kunci: 'nominal', label: 'Dikembalikan', tipe: 'uang' }],
      baris: d.pengembalian.map((x, i) => ({ ...x, no: i + 1, metode: teksMetode(x.metode) })),
      total: { nominal: d.total },
    }],
    terbilang: kapital(d.terbilang),
    catatan: d.sisa_saldo > 0
      ? 'Masih terdapat saldo simpanan yang belum dikembalikan; pengembalian dilakukan melalui menu Simpanan → Tutup Rekening.'
      : 'Dengan ini keanggotaan yang bersangkutan dinyatakan berakhir dan seluruh simpanan telah dikembalikan.',
    penanda_tambahan: { Penerima: penerima, Anggota: penerima },
  });
}
