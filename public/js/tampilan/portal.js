/**
 * Modul 24 - Portal & Mobile Anggota (layanan mandiri).
 */
import {
  api, el, kpi, panel, panelTabel, tabel, rp, angka, desimal, tgl, status, judul, modal,
  kolom, input, pilih, bacaForm, toast, galat, memuat, kosongkan, kosong, hariIni,
} from '../inti.js';
import { negara } from '../app.js';

export async function render() {
  const wadah = el('div');
  const isi = el('div');
  const daftarTab = [
    { judul: 'Beranda', render: berandaTab },
    { judul: 'Simpanan', render: simpananTab },
    { judul: 'Pinjaman', render: pinjamanTab },
    { judul: 'SHU', render: shuTab },
    { judul: 'Belanja & Poin', render: belanjaTab },
    { judul: 'RAT & Voting', render: ratTab },
    { judul: 'Layanan', render: layananTab },
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
  try {
    isi.append(await daftarTab[0].render());
  } catch (err) {
    kosongkan(isi).append(el('div.notis.bahaya', [el('div.isi', [
      el('strong', err.message), err.detail && el('div.kecil', err.detail)])]));
  }
  return wadah;
}

async function berandaTab() {
  const d = await api.get('/api/portal/beranda');
  const a = d.anggota;
  return el('div', [
    el('div.panel', [el('div.panel-isi', [
      el('div.antara', { gaya: { flexWrap: 'wrap' } }, [
        el('div', [
          el('h2', a.nama),
          el('div.mono.lembut', a.nomor_anggota),
          el('div.kecil.samar', `Anggota sejak ${tgl(a.tanggal_gabung, true)}`),
          el('div.mt8', [status(a.status)]),
        ]),
        el('div.tengah', [
          el('div', { gaya: { fontFamily: 'var(--mono)', fontSize: '11px', padding: '14px',
            border: '2px dashed var(--border-kuat)', borderRadius: '10px',
            background: 'var(--bg-subtle)' } }, a.qr),
          el('div.kecil.samar.mt8', 'Kartu Anggota Digital'),
        ]),
      ]),
    ])]),

    el('div.grid.k4.mb16', [
      kpi('Total Simpanan', rp(d.simpanan.total_simpanan), { jenis: 'sukses', ikon: '🏦' }),
      kpi('Simpanan Pokok', rp(d.simpanan.total_pokok)),
      kpi('Simpanan Wajib', rp(d.simpanan.total_wajib)),
      kpi('Poin Loyalti', `${angka(d.poin_loyalty)} poin`, { ikon: '⭐' }),
    ]),

    d.tagihan_terdekat.length ? panelTabel('Tagihan Angsuran Terdekat', tabel([
      { judul: 'Pinjaman', render: (t) => el('span.mono.kecil', t.nomor_pinjaman) },
      { judul: 'Angsuran ke-', angka: true, kunci: 'angsuran_ke' },
      { judul: 'Jatuh Tempo', render: (t) => tgl(t.jatuh_tempo, true) },
      { judul: 'Jumlah', angka: true, render: (t) => el('strong', rp(t.sisa)) },
    ], d.tagihan_terdekat)) : null,

    panelTabel('Pinjaman Saya', tabel([
      { judul: 'Nomor', render: (p) => el('span.mono.kecil', p.nomor) },
      { judul: 'Produk', kunci: 'produk_nama' },
      { judul: 'Pokok', angka: true, render: (p) => rp(p.pokok) },
      { judul: 'Sisa Pokok', angka: true, render: (p) => el('strong', rp(p.outstanding_pokok)) },
      { judul: 'Angsuran/bln', angka: true, render: (p) => rp(p.angsuran_total) },
      { judul: 'Status', render: (p) => status(p.status) },
    ], d.pinjaman, { kosongTeks: 'Tidak ada pinjaman berjalan' })),

    d.shu_terakhir ? panel('SHU Terakhir Diterima', el('dl.deskripsi', [
      el('dt', 'Tahun buku'), el('dd', d.shu_terakhir.tahun),
      el('dt', 'Jasa modal'), el('dd', rp(d.shu_terakhir.shu_jasa_modal)),
      el('dt', 'Jasa usaha'), el('dd', rp(d.shu_terakhir.shu_jasa_usaha)),
      el('dt', 'Total'), el('dd', el('strong.pos', rp(d.shu_terakhir.shu_total))),
    ])) : null,

    d.rat_terbuka.length ? panel('Rapat Anggota Berlangsung', el('div',
      d.rat_terbuka.map((r) => el('div.antara', { gaya: { padding: '8px 0' } }, [
        el('div', [el('div.tebal', r.judul),
          el('div.kecil.samar', `${tgl(r.tanggal, true)} · ${r.tempat || '-'}`)]),
        r.hadir ? status('lunas', '✓ Sudah presensi')
          : el('button.btn.kecil.utama', { onclick: async () => {
            try {
              await api.post(`/api/portal/rat/${r.id}/hadir`, {});
              toast('Presensi tercatat', 'sukses');
            } catch (err) { galat(err); }
          } }, 'Presensi Hadir'),
      ])))) : null,
  ].filter(Boolean));
}

async function simpananTab() {
  const d = await api.get('/api/portal/simpanan');
  return el('div', [
    el('div.grid.k4.mb16', [
      kpi('Total Simpanan', rp(d.total_simpanan), { jenis: 'sukses' }),
      kpi('Pokok', rp(d.total_pokok)),
      kpi('Wajib', rp(d.total_wajib)),
      kpi('Sukarela & Berjangka', rp(d.total_sukarela)),
    ]),
    panelTabel('Rekening Saya', tabel([
      { judul: 'Nomor Rekening', render: (r) => el('span.mono', r.nomor_rekening) },
      { judul: 'Produk', kunci: 'produk_nama' },
      { judul: 'Jenis', render: (r) => judul(r.jenis) },
      { judul: 'Jasa', angka: true, render: (r) => `${r.bunga_tahunan}% p.a.` },
      { judul: 'Saldo', angka: true, render: (r) => el('strong', rp(r.saldo)) },
      { judul: 'Status', render: (r) => status(r.status) },
    ], d.rekening, { kosongTeks: 'Belum memiliki rekening simpanan' })),
    panelTabel('Mutasi Simpanan', tabel([
      { judul: 'Tanggal', render: (m) => tgl(m.tanggal) },
      { judul: 'Jenis', render: (m) => judul(m.jenis) },
      { judul: 'Keterangan', render: (m) => el('span.kecil.lembut', m.keterangan || '-') },
      { judul: 'Setoran', angka: true, render: (m) => (m.kredit ? el('span.pos', rp(m.kredit)) : '-') },
      { judul: 'Penarikan', angka: true, render: (m) => (m.debit ? el('span.neg', rp(m.debit)) : '-') },
      { judul: 'Saldo', angka: true, render: (m) => rp(m.saldo_akhir) },
    ], d.mutasi, { kosongTeks: 'Belum ada mutasi' })),
  ]);
}

async function pinjamanTab() {
  const wadah = el('div');
  const d = await api.get('/api/portal/pinjaman');
  wadah.append(el('div.alat', [
    el('button.btn', { onclick: simulasi }, '🧮 Simulasi Angsuran'),
    el('button.btn.utama', { onclick: ajukan }, '+ Ajukan Pinjaman'),
  ]));

  if (!d.data.length) {
    wadah.append(kosong('Belum pernah mengajukan pinjaman',
      'Gunakan tombol di atas untuk mensimulasikan dan mengajukan pinjaman.', '💳'));
    return wadah;
  }

  for (const p of d.data) {
    wadah.append(panel(`${p.nomor} — ${p.produk_nama}`, el('div', [
      el('div.grid.k4.mb16', [
        kpi('Pokok', rp(p.pokok)),
        kpi('Sisa Pokok', rp(p.outstanding_pokok)),
        kpi('Angsuran/bulan', rp(p.angsuran_total)),
        kpi('Status', judul(p.status), {
          catatan: p.label_kolektibilitas, jenis: p.kolektibilitas === 1 ? 'sukses' : 'peringatan' }),
      ]),
      p.status === 'dicairkan' ? el('button.btn.kecil.mb16', { onclick: async () => {
        try {
          const s = await api.get(`/api/portal/pinjaman/${p.id}/pelunasan`);
          modal({ judul: 'Simulasi Pelunasan Dipercepat', lebar: 'sempit',
            isi: el('dl.deskripsi', [
              el('dt', 'Sisa pokok'), el('dd', rp(s.sisa_pokok)),
              el('dt', 'Jasa berjalan'), el('dd', rp(s.bunga_berjalan)),
              el('dt', 'Denda'), el('dd', rp(s.denda)),
              el('dt', 'Penalti'), el('dd', rp(s.penalti_pelunasan)),
              el('dt', el('strong', 'Total')), el('dd', el('strong', rp(s.total))),
              el('dt', 'Hemat jasa'), el('dd', el('span.pos', rp(s.penghematan_bunga))),
            ]) });
        } catch (err) { galat(err); }
      } }, '⚡ Simulasi Pelunasan Dipercepat') : null,
      el('div.tabel-bungkus', [tabel([
        { judul: 'Ke-', angka: true, kunci: 'angsuran_ke' },
        { judul: 'Jatuh Tempo', render: (j) => tgl(j.jatuh_tempo) },
        { judul: 'Pokok', angka: true, render: (j) => rp(j.pokok) },
        { judul: 'Jasa', angka: true, render: (j) => rp(j.bunga) },
        { judul: 'Total', angka: true, render: (j) => rp(j.total) },
        { judul: 'Status', render: (j) => status(j.status === 'lunas' ? 'lunas'
          : j.status === 'sebagian' ? 'peringatan' : 'netral', judul(j.status)) },
      ], p.jadwal, { kosongTeks: 'Jadwal terbentuk setelah pencairan' })]),
    ].filter(Boolean))));
  }
  return wadah;
}

async function simulasi() {
  const produk = await api.get('/api/portal/produk');
  const hasil = el('div.mt16');
  const f = el('div', [
    kolom('Produk', pilih('produk_id', produk.pinjaman.map((p) => ({
      nilai: p.id, teks: `${p.nama} — ${p.bunga_tahunan}% ${judul(p.metode_bunga)}` })))),
    el('div.baris-form', [
      kolom('Jumlah Pinjaman', input('pokok', { tipe: 'number', min: 0, nilai: 5000000 })),
      kolom('Tenor (bulan)', input('tenor', { tipe: 'number', min: 1, nilai: 12 })),
    ]),
    el('button.btn.utama', { onclick: async () => {
      try {
        const h = await api.post('/api/portal/simulasi', bacaForm(f));
        kosongkan(hasil).append(
          el('div.grid.k3.mb16', [
            kpi('Angsuran/bulan', rp(h.angsuran_pertama)),
            kpi('Total jasa', rp(h.total_bunga)),
            kpi('Total bayar', rp(h.total_angsuran)),
          ]),
          el('div.tabel-bungkus', [tabel([
            { judul: 'Ke-', angka: true, kunci: 'angsuran_ke' },
            { judul: 'Jatuh Tempo', render: (j) => tgl(j.jatuh_tempo) },
            { judul: 'Pokok', angka: true, render: (j) => rp(j.pokok) },
            { judul: 'Jasa', angka: true, render: (j) => rp(j.bunga) },
            { judul: 'Total', angka: true, render: (j) => rp(j.total) },
          ], h.jadwal)]),
        );
      } catch (err) { galat(err); }
    } }, 'Hitung'),
    hasil,
  ]);
  modal({ judul: 'Simulasi Angsuran', lebar: 'lebar', isi: f });
}

async function ajukan() {
  const produk = await api.get('/api/portal/produk');
  const f = el('div', [
    el('div.notis.info', [el('div.isi', [
      el('strong', 'Pengajuan akan diverifikasi pengurus'),
      el('div.kecil', 'Sistem menghitung skor kelayakan kredit secara otomatis. '
        + 'Anda akan menerima notifikasi setelah pengajuan diputuskan.'),
    ])]),
    kolom('Produk Pinjaman', pilih('produk_id', produk.pinjaman.map((p) => ({
      nilai: p.id, teks: `${p.nama} — ${p.bunga_tahunan}% p.a., ${p.tenor_min}-${p.tenor_max} bulan` }))),
    { wajib: true }),
    el('div.baris-form', [
      kolom('Jumlah Pinjaman', input('pokok', { tipe: 'number', min: 1 }), { wajib: true }),
      kolom('Tenor (bulan)', input('tenor', { tipe: 'number', min: 1 }), { wajib: true }),
    ]),
    kolom('Tujuan Penggunaan', input('tujuan'), { wajib: true }),
  ]);
  const tutup = modal({
    judul: 'Ajukan Pinjaman', isi: f,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async (e) => {
        e.currentTarget.disabled = true;
        try {
          const h = await api.post('/api/portal/pinjaman', bacaForm(f));
          toast('Pengajuan terkirim', 'sukses', `Nomor ${h.nomor} — menunggu verifikasi pengurus`);
          tutup();
        } catch (err) { galat(err); e.currentTarget.disabled = false; }
      } }, 'Kirim Pengajuan'),
    ],
  });
}

async function shuTab() {
  const d = await api.get('/api/portal/shu');
  return el('div', [
    el('div.grid.k2.mb16', [
      kpi('Total SHU Diterima', rp(d.total_diterima), { jenis: 'sukses' }),
      kpi('Periode Diterima', angka(d.data.length)),
    ]),
    el('div.notis.info', [el('div.isi', [
      el('strong', 'Bagaimana SHU Anda dihitung?'),
      el('div.kecil', 'SHU terdiri dari jasa modal (sebanding dengan rata-rata simpanan Anda) '
        + 'dan jasa usaha (sebanding dengan nilai transaksi Anda di koperasi) — '
        + 'sesuai UU No. 25 Tahun 1992 Pasal 45.'),
    ])]),
    panelTabel('Riwayat SHU', tabel([
      { judul: 'Tahun Buku', render: (s) => el('strong', s.tahun) },
      { judul: 'Simpanan Rata-rata', angka: true, render: (s) => rp(s.simpanan_rata) },
      { judul: 'Nilai Transaksi', angka: true, render: (s) => rp(s.nilai_transaksi) },
      { judul: 'Jasa Modal', angka: true, render: (s) => rp(s.shu_jasa_modal) },
      { judul: 'Jasa Usaha', angka: true, render: (s) => rp(s.shu_jasa_usaha) },
      { judul: 'Total', angka: true, render: (s) => el('strong.pos', rp(s.shu_total)) },
      { judul: 'Status', render: (s) => (s.dibayar ? status('lunas', `Diterima (${judul(s.metode_bayar || '')})`)
        : status(s.status_periode)) },
    ], d.data, { kosongTeks: 'Belum ada pembagian SHU' })),
  ]);
}

async function belanjaTab() {
  const d = await api.get('/api/portal/belanja');
  return el('div', [
    el('div.grid.k2.mb16', [
      kpi('Saldo Poin', `${angka(d.poin.saldo)} poin`, { ikon: '⭐', jenis: 'sukses' }),
      kpi('Transaksi Belanja', angka(d.riwayat.length)),
    ]),
    panelTabel('Riwayat Belanja di Toko Koperasi', tabel([
      { judul: 'Tanggal', render: (r) => tgl(r.tanggal) },
      { judul: 'Nomor', render: (r) => el('span.mono.kecil', r.nomor) },
      { judul: 'Metode', render: (r) => judul(r.metode_bayar) },
      { judul: 'Total', angka: true, render: (r) => rp(r.total) },
      { judul: 'Poin', angka: true, render: (r) => (r.poin_didapat ? `+${r.poin_didapat}` : '-') },
    ], d.riwayat, { kosongTeks: 'Belum ada transaksi belanja' })),
    panelTabel('Mutasi Poin Loyalti', tabel([
      { judul: 'Tanggal', render: (p) => tgl(p.tanggal) },
      { judul: 'Keterangan', render: (p) => el('span.kecil', p.keterangan || '-') },
      { judul: 'Poin', angka: true, render: (p) => el(p.poin > 0 ? 'span.pos' : 'span.neg',
        `${p.poin > 0 ? '+' : ''}${p.poin}`) },
      { judul: 'Saldo', angka: true, render: (p) => angka(p.saldo) },
    ], d.poin.mutasi, { kosongTeks: 'Belum ada mutasi poin' })),
  ]);
}

async function ratTab() {
  const wadah = el('div');
  const d = await api.get('/api/portal/rat');
  if (!d.data.length) {
    wadah.append(kosong('Belum ada Rapat Anggota', 'Anda akan diundang saat RAT dijadwalkan.', '🗳️'));
    return wadah;
  }
  for (const r of d.data) {
    wadah.append(panel(r.judul, el('div', [
      el('dl.deskripsi.mb16', [
        el('dt', 'Tanggal'), el('dd', `${tgl(r.tanggal, true)} ${r.waktu || ''}`),
        el('dt', 'Tempat'), el('dd', r.tempat || '-'),
        el('dt', 'Kehadiran Anda'), el('dd', r.hadir ? status('lunas', '✓ Hadir') : status('netral', 'Belum presensi')),
        el('dt', 'Status rapat'), el('dd', status(r.status)),
      ]),
      !r.hadir && ['undangan', 'berlangsung'].includes(r.status) ? el('button.btn.utama.mb16', {
        onclick: async () => {
          try {
            await api.post(`/api/portal/rat/${r.id}/hadir`, {});
            toast('Presensi berhasil tercatat', 'sukses');
            location.reload();
          } catch (err) { galat(err); }
        },
      }, '✋ Presensi Kehadiran') : null,
      el('div.tebal.mb8', 'Agenda'),
      el('ol', { gaya: { paddingLeft: '20px', marginTop: 0 } }, r.agenda.map((a) => el('li', a.judul))),
      r.voting.length ? el('div.mt16', [
        el('div.tebal.mb8', 'Voting Terbuka'),
        ...r.voting.map((v) => el('div.panel', [el('div.panel-isi', [
          el('div.tebal.mb8', v.judul),
          v.sudah_memilih
            ? el('div.notis.sukses', { gaya: { marginBottom: 0 } },
              [el('div.isi', 'Anda sudah memberikan suara pada voting ini.')])
            : el('div.gap8', v.opsi.map((o) => el('button.btn', {
              onclick: async () => {
                try {
                  await api.post(`/api/portal/voting/${v.id}`, { pilihan: o });
                  toast('Suara Anda tercatat', 'sukses');
                  location.reload();
                } catch (err) { galat(err); }
              },
            }, o))),
        ])])),
      ]) : null,
    ].filter(Boolean))));
  }
  return wadah;
}

async function layananTab() {
  const wadah = el('div');
  async function muat() {
    kosongkan(wadah).append(memuat());
    try {
      const d = await api.get('/api/portal/tiket');
      kosongkan(wadah).append(
        el('div.alat', [
          el('button.btn.utama', { onclick: () => formTiket(muat) }, '+ Ajukan Pertanyaan / Pengaduan'),
          el('button.btn', { onclick: () => formProfil() }, '👤 Perbarui Data Kontak'),
        ]),
        d.data.length ? el('div', d.data.map((t) => panel(`${t.nomor} — ${t.judul}`, el('div', [
          el('div.antara.mb8', [status(t.status), el('span.kecil.samar', tgl(t.created_at))]),
          t.isi && el('div.kecil.lembut.mb8', t.isi),
          t.balasan.length ? el('div', t.balasan.map((b) => el('div', {
            gaya: { padding: '8px 10px', marginBottom: '6px', borderRadius: '7px',
              background: b.is_petugas ? 'var(--info-bg)' : 'var(--bg-subtle)' },
          }, [
            el('div.kecil.tebal', b.is_petugas ? `Petugas: ${b.oleh}` : 'Anda'),
            el('div.kecil', b.isi),
          ]))) : el('div.kecil.samar', 'Menunggu tanggapan petugas'),
        ])))) : kosong('Belum ada tiket layanan',
          'Ajukan pertanyaan, pengaduan, atau saran kepada pengurus koperasi.', '💬'),
      );
    } catch (err) { galat(err); }
  }
  await muat();
  return wadah;
}

function formTiket(saatSelesai) {
  const f = el('div', [
    kolom('Kategori', pilih('kategori', ['pertanyaan', 'pengaduan', 'saran', 'klaim']
      .map((k) => ({ nilai: k, teks: judul(k) })))),
    kolom('Judul', input('judul'), { wajib: true }),
    kolom('Isi', el('textarea', { name: 'isi' }), { wajib: true }),
  ]);
  const tutup = modal({
    judul: 'Ajukan Layanan', isi: f,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async (e) => {
        e.currentTarget.disabled = true;
        try {
          await api.post('/api/portal/tiket', bacaForm(f));
          toast('Tiket terkirim', 'sukses', 'Pengurus akan menanggapi secepatnya');
          tutup(); saatSelesai?.();
        } catch (err) { galat(err); e.currentTarget.disabled = false; }
      } }, 'Kirim'),
    ],
  });
}

function formProfil() {
  const f = el('div', [
    el('div.notis.info', [el('div.isi', [
      el('strong', 'Perubahan terbatas pada data kontak'),
      el('div.kecil', 'Perubahan data identitas (nama, NIK) harus diajukan kepada pengurus koperasi.'),
    ])]),
    el('div.baris-form', [
      kolom('Telepon', input('telepon')),
      kolom('Surel', input('email', { tipe: 'email' })),
    ]),
    kolom('Alamat', input('alamat')),
    el('div.baris-form.k3', [
      kolom('Kelurahan', input('kelurahan')),
      kolom('Kecamatan', input('kecamatan')),
      kolom('Kota', input('kota')),
    ]),
  ]);
  const tutup = modal({
    judul: 'Perbarui Data Kontak', lebar: 'lebar', isi: f,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async () => {
        try {
          const nilai = Object.fromEntries(
            Object.entries(bacaForm(f)).filter(([, v]) => v !== ''));
          await api.put('/api/portal/profil', nilai);
          toast('Data kontak diperbarui', 'sukses');
          tutup();
        } catch (err) { galat(err); }
      } }, 'Simpan'),
    ],
  });
}
