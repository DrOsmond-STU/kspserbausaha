/**
 * Modul 26 - Administrator.
 */
import {
  api, el, kpi, panel, panelTabel, tabel, angka, waktu, tgl, status, judul, modal, kolom, input, pilih,
  bacaForm, toast, galat, memuat, kosongkan, konfirmasi, kosong, tabelServer, ukuranHalaman, ambilSemua,
} from '../inti.js';
import { izin, negara } from '../app.js';

export async function render() {
  const wadah = el('div');
  const isi = el('div');
  const daftarTab = [
    { judul: 'Pengguna', render: penggunaTab },
    { judul: 'Peran & Hak Akses', render: peranTab },
    { judul: 'Parameter Sistem', render: pengaturanTab },
    { judul: 'Audit Trail', render: auditTab },
    { judul: 'Keamanan & Sistem', render: sistemTab },
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

// ----------------------------- Pengguna -----------------------------

async function penggunaTab() {
  const wadah = el('div');
  async function muat() {
    kosongkan(wadah).append(memuat());
    try {
      const d = await api.get('/api/admin/users');
      kosongkan(wadah).append(panelTabel(`Pengguna Sistem (${d.data.length})`, tabel([
        { judul: 'Nama Pengguna', render: (u) => el('span.mono', u.username) },
        { judul: 'Nama Lengkap', kunci: 'nama' },
        { judul: 'Peran', render: (u) => status('netral', judul(u.role)) },
        { judul: 'Cabang / Unit', render: (u) => el('span.kecil',
          [u.cabang_nama, u.unit_nama].filter(Boolean).join(' · ') || '-') },
        { judul: 'MFA', render: (u) => (u.mfa_enabled ? status('lunas', '✓ Aktif') : status('netral', 'Nonaktif')) },
        { judul: 'Terakhir Masuk', render: (u) => (u.last_login_at ? waktu(u.last_login_at)
          : el('span.samar', 'belum pernah')) },
        { judul: 'Gagal Masuk', angka: true, render: (u) => (u.gagal_login >= 5
          ? el('span.neg', `${u.gagal_login} (terkunci)`) : u.gagal_login) },
        { judul: 'Status', render: (u) => status(u.status) },
        { judul: '', render: (u) => el('div.gap8', [
          izin('admin.update') && el('button.btn.kecil', {
            onclick: () => formPengguna(u, muat) }, 'Ubah'),
          izin('admin.update') && el('button.btn.kecil', {
            onclick: () => resetSandi(u) }, 'Reset'),
          izin('admin.update') && u.mfa_enabled && u.id !== negara.user.id && el('button.btn.kecil', {
            title: 'Nonaktifkan MFA pengguna ini (mis. perangkat autentikator hilang)',
            onclick: () => resetMfa(u, muat) }, 'Reset MFA'),
          izin('admin.delete') && u.id !== negara.user.id && el('button.btn.kecil.polos', {
            onclick: async () => {
              if (!await konfirmasi(`Hapus pengguna "${u.username}"?`, { ya: 'Hapus', jenis: 'bahaya' })) return;
              try { await api.del(`/api/admin/users/${u.id}`); toast('Pengguna dihapus', 'sukses'); muat(); }
              catch (err) { galat(err); }
            } }, 'Hapus'),
        ].filter(Boolean)) },
      ], d.data), [
        izin('admin.create') && el('button.btn.utama', { onclick: () => formPengguna(null, muat) },
          '+ Tambah Pengguna'),
      ].filter(Boolean)));
    } catch (err) { galat(err); }
  }
  await muat();
  return wadah;
}

async function formPengguna(data, saatSelesai) {
  const [peran, cabang, unit, anggota] = await Promise.all([
    api.get('/api/admin/roles'), api.get('/api/master/cabang'),
    api.get('/api/master/unit-usaha'), api.get('/api/anggota', { limit: 500 }).catch(() => ({ data: [] })),
  ]);
  const isBaru = !data;
  const f = el('div', [
    el('div.baris-form', [
      kolom('Nama Pengguna', input('username', { nilai: data?.username || '',
        readonly: !isBaru }), { wajib: isBaru, bantuan: isBaru ? 'Huruf kecil, angka, titik, strip' : null }),
      kolom('Nama Lengkap', input('nama', { nilai: data?.nama || '' }), { wajib: true }),
    ]),
    el('div.baris-form', [
      kolom('Surel', input('email', { tipe: 'email', nilai: data?.email || '' })),
      kolom('Peran', pilih('role', peran.data.map((p) => ({ nilai: p.kode, teks: p.nama })),
        data?.role), { wajib: true }),
    ]),
    el('div.baris-form.k3', [
      kolom('Cabang', pilih('cabang_id', [{ nilai: '', teks: '- semua -' },
        ...cabang.data.map((c) => ({ nilai: c.id, teks: c.nama }))], data?.cabang_id)),
      kolom('Unit Usaha', pilih('unit_usaha_id', [{ nilai: '', teks: '- semua -' },
        ...unit.data.map((u) => ({ nilai: u.id, teks: u.nama }))], data?.unit_usaha_id)),
      kolom('Tautkan ke Anggota', pilih('anggota_id', [{ nilai: '', teks: '- bukan anggota -' },
        ...anggota.data.map((a) => ({ nilai: a.id, teks: `${a.nomor_anggota} — ${a.nama}` }))],
      data?.anggota_id), { bantuan: 'Wajib untuk peran Anggota' }),
    ]),
    isBaru ? kolom('Kata Sandi', input('password', { tipe: 'password' }),
      { wajib: true, bantuan: 'Minimal 8 karakter, mengandung huruf dan angka' }) : null,
    !isBaru ? kolom('Status', pilih('status', [{ nilai: 'aktif', teks: 'Aktif' },
      { nilai: 'nonaktif', teks: 'Nonaktif' }], data?.status)) : null,
  ].filter(Boolean));

  const tutup = modal({
    judul: isBaru ? 'Tambah Pengguna' : `Ubah Pengguna — ${data.username}`, lebar: 'lebar', isi: f,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async (e) => {
        const tombol = e.currentTarget;
        tombol.disabled = true;
        try {
          const nilai = bacaForm(f);
          if (isBaru) await api.post('/api/admin/users', nilai);
          else await api.put(`/api/admin/users/${data.id}`, nilai);
          toast('Pengguna tersimpan', 'sukses');
          tutup(); saatSelesai?.();
        } catch (err) { galat(err); tombol.disabled = false; }
      } }, 'Simpan'),
    ],
  });
}

function resetSandi(u) {
  const f = el('div', [
    el('div.notis.peringatan', [el('div.isi', [
      el('strong', `Reset kata sandi untuk "${u.username}"`),
      el('div.kecil', 'Seluruh sesi aktif pengguna ini akan dikeluarkan dan kunci akun dibuka.'),
    ])]),
    kolom('Kata Sandi Baru', input('password', { tipe: 'password' }),
      { wajib: true, bantuan: 'Minimal 8 karakter, mengandung huruf dan angka' }),
  ]);
  const tutup = modal({
    judul: 'Reset Kata Sandi', lebar: 'sempit', isi: f,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.bahaya', { onclick: async () => {
        try {
          const h = await api.post(`/api/admin/users/${u.id}/reset-sandi`, bacaForm(f));
          toast('Kata sandi direset', 'sukses', h.pesan);
          tutup();
        } catch (err) { galat(err); }
      } }, 'Reset'),
    ],
  });
}

/** Menonaktifkan MFA pengguna lain, mis. bila perangkat autentikatornya hilang. */
function resetMfa(u, saatSelesai) {
  const tutup = modal({
    judul: 'Reset MFA', lebar: 'sempit',
    isi: el('div.notis.peringatan', [el('div.isi', [
      el('strong', `Nonaktifkan MFA untuk "${u.username}"?`),
      el('div.kecil', 'Kunci rahasia autentikator dihapus. Pengguna dapat masuk hanya dengan kata sandi '
        + 'sampai ia mengaktifkan MFA kembali. Lakukan hanya setelah identitas pengguna diverifikasi.'),
    ])]),
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.bahaya', { onclick: async (e) => {
        const tombol = e.currentTarget;
        tombol.disabled = true;
        try {
          const h = await api.post(`/api/admin/users/${u.id}/reset-mfa`, {});
          toast('MFA dinonaktifkan', 'sukses', h.pesan);
          tutup(); saatSelesai?.();
        } catch (err) { galat(err); tombol.disabled = false; }
      } }, 'Nonaktifkan MFA'),
    ],
  });
}

// ------------------------------ Peran ------------------------------

const NAMA_MODUL = {
  dashboard: 'Dasbor', master: 'Master Data', anggota: 'Keanggotaan', simpanan: 'Simpanan',
  pinjaman: 'Pinjaman', shu: 'SHU', akuntansi: 'Akuntansi', laporan: 'Laporan', kas: 'Kas & Bank',
  anggaran: 'Anggaran', persediaan: 'Persediaan', pos: 'Kasir (POS)', pembelian: 'Pembelian',
  penjualan: 'Penjualan', unit: 'Unit Usaha', aset: 'Aset Tetap', rat: 'RAT', dokumen: 'Dokumen',
  surat: 'Surat', approval: 'Persetujuan', compliance: 'Kepatuhan', audit: 'Audit Internal',
  risiko: 'Risiko', crm: 'CRM', bi: 'Business Intelligence', admin: 'Administrator',
};

/** Pencocokan izin sama dengan server: "koreksi" tidak ikut wildcard modul. */
const punya = (daftar, izinPerlu) => {
  const [m, a] = izinPerlu.split('.');
  return daftar.includes('*') || daftar.includes(izinPerlu) || (a !== 'koreksi' && daftar.includes(`${m}.*`));
};

async function peranTab() {
  const wadah = el('div');
  async function muat() {
    kosongkan(wadah).append(memuat());
    try {
      const d = await api.get('/api/admin/roles');
      kosongkan(wadah).append(
        el('div.notis.info', [el('div.isi', [
          el('strong', 'Hak akses per peran'),
          el('div.kecil', 'Hak akses melekat pada peran, bukan pada individu. Centang aksi yang boleh dilakukan '
            + 'setiap peran pada setiap modul. Kolom "Koreksi" memberi wewenang mengubah atau membatalkan transaksi '
            + 'yang sudah tersimpan (jurnal balik otomatis) — berikan hanya kepada pejabat berwenang seperti ketua, '
            + 'manajer, atau bendahara. Super Administrator selalu memiliki seluruh akses dan Anggota hanya portal, '
            + 'sehingga keduanya tidak dapat diubah.'),
        ])]),
        ...d.data.map((p) => panel(`${p.nama} (${p.jumlah_pengguna} pengguna)`, el('div', [
          el('div.kecil.lembut.mb8', [p.deskripsi, p.diatur ? ' · susunan hak akses sudah diubah dari bawaan' : '']),
          p.tetap
            ? el('div.gap8', p.permissions.map((x) => el('span.lencana-status.st-netral',
              { gaya: { fontFamily: 'var(--mono)', fontSize: '11px' } }, x)))
            : el('div.gap8', [
              el('span.kecil', `${p.permissions.length} izin`),
              p.permissions.some((x) => x.endsWith('.koreksi'))
                ? el('span.lencana-status.st-peringatan', `Koreksi: ${p.permissions.filter((x) => x.endsWith('.koreksi'))
                  .map((x) => NAMA_MODUL[x.split('.')[0]] || x).join(', ')}`)
                : el('span.lencana-status.st-netral', 'Tanpa wewenang koreksi'),
              el('button.btn.kecil', { onclick: () => editor(p, d) }, izin('admin.update') ? 'Atur Hak Akses' : 'Lihat Rincian'),
            ]),
        ]))),
      );
    } catch (err) { galat(err); }
  }

  function editor(peran, d) {
    const bolehUbah = izin('admin.update');
    const kotak = {};
    const baris = d.modul.map((m) => el('tr', [
      el('td', NAMA_MODUL[m] || m),
      ...d.aksi.map((a) => {
        const cb = el('input', { type: 'checkbox', checked: punya(peran.permissions, `${m}.${a.kode}`),
          disabled: !bolehUbah, 'aria-label': `${NAMA_MODUL[m] || m} - ${a.nama}` });
        kotak[`${m}.${a.kode}`] = cb;
        return el('td', { gaya: { textAlign: 'center', background: a.kode === 'koreksi' ? 'var(--peringatan-bg)' : '' } }, cb);
      }),
    ]));
    const tabelIzin = el('div', { gaya: { overflowX: 'auto', maxHeight: '60vh' } }, el('table.tabel', [
      el('thead', el('tr', [el('th', 'Modul'), ...d.aksi.map((a) => el('th', { title: a.nama, gaya: { textAlign: 'center' } },
        a.kode === 'koreksi' ? 'Koreksi' : a.nama))])),
      el('tbody', baris),
    ]));
    const simpan = async (e) => {
      const tombol = e.currentTarget;
      tombol.disabled = true;
      try {
        const daftar = Object.entries(kotak).filter(([, cb]) => cb.checked).map(([k]) => k);
        await api.put(`/api/admin/roles/${peran.kode}`, { permissions: daftar });
        toast(`Hak akses ${peran.nama} tersimpan`, 'sukses', 'Berlaku untuk pengguna peran ini pada permintaan berikutnya.');
        tutup();
        muat();
      } catch (err) { galat(err); } finally { tombol.disabled = false; }
    };
    const kembalikan = async () => {
      if (!await konfirmasi(`Kembalikan hak akses ${peran.nama} ke susunan bawaan?`)) return;
      try {
        await api.del(`/api/admin/roles/${peran.kode}`);
        toast('Hak akses dikembalikan ke bawaan', 'sukses');
        tutup();
        muat();
      } catch (err) { galat(err); }
    };
    const tutup = modal({
      judul: `Hak Akses — ${peran.nama}`, lebar: 'lebar',
      isi: el('div', [
        el('div.kecil.lembut.mb8', 'Aksi Koreksi (kolom berwarna) = ubah/batal transaksi tersimpan dengan jurnal balik otomatis.'),
        tabelIzin,
      ]),
      kaki: bolehUbah ? [
        peran.diatur ? el('button.btn', { onclick: kembalikan }, 'Kembalikan ke Bawaan') : null,
        el('button.btn', { onclick: () => tutup() }, 'Batal'),
        el('button.btn.utama', { onclick: simpan }, 'Simpan Hak Akses'),
      ].filter(Boolean) : [el('button.btn', { onclick: () => tutup() }, 'Tutup')],
    });
  }

  await muat();
  return wadah;
}

// --------------------------- Pengaturan ---------------------------

async function pengaturanTab() {
  const wadah = el('div');
  const d = await api.get('/api/admin/settings');
  const bolehUbah = izin('admin.update');
  const nilaiAwal = { ...d.map };
  const semuaInput = {};

  const LABEL = { koperasi: 'Identitas Koperasi', shu: 'Pembagian SHU (AD/ART)',
    pinjaman: 'Parameter Pinjaman', loyalty: 'Program Loyalti', akuntansi: 'Akuntansi',
    coa: 'Pemetaan Akun Jurnal Otomatis', kelompok: 'Kelompok Akun Laporan' };
  const URUTAN = ['koperasi', 'shu', 'pinjaman', 'loyalty', 'akuntansi', 'coa', 'kelompok'];
  const ANGKA = ['shu', 'pinjaman', 'loyalty'];
  // Pengaturan yang tidak boleh diubah dari antarmuka (hanya ditampilkan)
  const HANYA_BACA = ['mode_demo'];

  const grup = {};
  const keterangan = {};
  for (const s of d.data) {
    keterangan[s.key] = s.keterangan;
    if (HANYA_BACA.includes(s.key)) continue;
    (grup[s.key.split('.')[0]] ||= []).push(s.key);
  }
  // Pemetaan & kelompok akun mengikuti daftar resmi server, termasuk kunci
  // yang belum tersimpan - supaya yang belum diatur tetap terlihat.
  if (d.pemetaan_akun) grup.coa = d.pemetaan_akun.map((p) => p.key);
  if (d.kelompok_akun) {
    const resmi = d.kelompok_akun.map((k) => k.key);
    grup.kelompok = [...resmi, ...(grup.kelompok || []).filter((k) => !resmi.includes(k))];
  }
  const pemetaan = Object.fromEntries((d.pemetaan_akun || []).map((p) => [p.key, p]));
  const kelompok = Object.fromEntries((d.kelompok_akun || []).map((k) => [k.key, k]));
  const daftarAkun = d.daftar_akun || [];

  /** Pilihan akun untuk satu pemetaan: tipe sesuai; kas/bank hanya akun bertanda kas/bank. */
  function pilihAkun(key, nilai) {
    const p = pemetaan[key];
    const opsi = daftarAkun
      .filter((a) => !p?.tipe || a.tipe === p.tipe)
      .filter((a) => !['coa.kas', 'coa.bank'].includes(key) || Number(a.is_kas) || Number(a.is_bank))
      .map((a) => ({ nilai: a.kode, teks: `${a.kode} — ${a.nama}` }));
    if (nilai && !opsi.some((o) => o.nilai === nilai)) {
      opsi.push({ nilai, teks: `${nilai} (tidak aktif / tidak sesuai - pilih ulang)` });
    }
    return pilih(key, [{ nilai: '', teks: '- belum diatur -' }, ...opsi], nilai);
  }

  function kendali(key) {
    const g = key.split('.')[0];
    const nilai = d.map[key] ?? '';
    if (g === 'coa') {
      return kolom(pemetaan[key]?.label || keterangan[key] || key, pilihAkun(key, nilai), {
        bantuan: nilai ? key : el('span.neg', `${key} — belum diatur; jurnal otomatis terkait akan ditolak`),
      });
    }
    if (g === 'kelompok') {
      return kolom(kelompok[key]?.label || keterangan[key] || key, input(key, { nilai }),
        { bantuan: `${key} — awalan kode akun dipisah koma, mis. 1-11,1-12` });
    }
    if (key === 'akuntansi.recurring_otomatis') {
      return kolom(keterangan[key] || key, pilih(key, [{ nilai: '1', teks: 'Ya' }, { nilai: '0', teks: 'Tidak' }],
        nilai === '' ? '1' : nilai), { bantuan: key });
    }
    const inp = ANGKA.includes(g) ? input(key, { tipe: 'number', step: 'any', nilai }) : input(key, { nilai });
    return kolom(keterangan[key] || key, inp, { bantuan: key });
  }

  function bangunGrup(g, keys) {
    const kolomGrup = keys.map((key) => {
      const k = kendali(key);
      const node = k.querySelector('[name]');
      if (!bolehUbah) node.disabled = true;
      semuaInput[key] = node;
      return k;
    });
    if (g !== 'coa') return el('div.baris-form', kolomGrup);
    // Pemetaan akun dikelompokkan menurut tipe akun supaya mudah ditelusuri
    const perTipe = {};
    keys.forEach((key, i) => (perTipe[pemetaan[key]?.tipe || 'lainnya'] ||= []).push(kolomGrup[i]));
    return el('div', [
      el('div.kecil.lembut.mb16', 'Akun yang dipakai jurnal otomatis setiap modul. Produk, barang, '
        + 'rekening bank, dan aset yang tidak menentukan akunnya sendiri memakai pemetaan ini. '
        + 'Hanya akun aktif yang dapat dijurnal dan bertipe sesuai yang dapat dipilih.'),
      ...Object.entries(perTipe).map(([tipe, isi]) => el('div', [
        el('div.tebal.kecil.lembut.mb8', judul(tipe)),
        el('div.baris-form', isi),
      ])),
    ]);
  }

  const kunciGrup = [...URUTAN.filter((g) => grup[g]), ...Object.keys(grup).filter((g) => !URUTAN.includes(g))];
  for (const g of kunciGrup) wadah.append(panel(LABEL[g] || judul(g), bangunGrup(g, grup[g])));

  const hanyaBaca = HANYA_BACA.filter((k) => d.map[k] !== undefined);
  if (hanyaBaca.length) {
    wadah.append(panel('Informasi Sistem (hanya baca)', el('dl.deskripsi', hanyaBaca.flatMap((k) => [
      el('dt', keterangan[k] || k),
      el('dd', [k === 'mode_demo' ? (d.map[k] === '1' ? 'Ya' : 'Tidak') : d.map[k], ' ',
        el('span.mono.kecil.samar', k)]),
    ]))));
  }

  // Ringkasan total alokasi SHU - diperbarui langsung saat angka diketik
  if (grup.shu) {
    const judulShu = el('strong');
    const catatanShu = el('div.kecil');
    const banner = el('div.notis', [el('div.isi', [judulShu, catatanShu])]);
    const hitungShu = () => {
      const total = grup.shu.reduce((s, k) => s + (Number(semuaInput[k].value) || 0), 0);
      const pas = Math.abs(total - 100) < 0.01;
      banner.className = `notis ${pas ? 'sukses' : 'bahaya'}`;
      judulShu.textContent = `Total alokasi SHU: ${Math.round(total * 100) / 100}%`;
      catatanShu.textContent = pas ? 'Sesuai ketentuan — total alokasi harus tepat 100%.'
        : 'Total alokasi wajib tepat 100%. Perbaiki sebelum menyimpan.';
    };
    for (const k of grup.shu) semuaInput[k].addEventListener('input', hitungShu);
    hitungShu();
    wadah.insertBefore(banner, wadah.firstChild);
  }

  if (bolehUbah) {
    wadah.append(el('button.btn.utama', { onclick: async (e) => {
      const tombol = e.currentTarget;
      // Hanya parameter yang berubah yang dikirim, supaya jejak audit ringkas
      const nilai = {};
      for (const [k, inp] of Object.entries(semuaInput)) {
        if (String(inp.value) !== String(nilaiAwal[k] ?? '')) nilai[k] = inp.value;
      }
      if (!Object.keys(nilai).length) { toast('Tidak ada parameter yang berubah', 'info'); return; }
      tombol.disabled = true;
      try {
        await api.put('/api/admin/settings', { settings: nilai });
        Object.assign(nilaiAwal, nilai);
        toast('Parameter sistem tersimpan', 'sukses', `${Object.keys(nilai).length} parameter diperbarui`);
      } catch (err) { galat(err); } finally { tombol.disabled = false; }
    } }, 'Simpan Perubahan Parameter'));
  }
  return wadah;
}

// --------------------------- Audit trail ---------------------------

async function auditTab() {
  const wadah = el('div');
  let q = '';
  let modul = '';
  let aksi = '';

  async function muat() {
    kosongkan(wadah).append(memuat());
    try {
      const ambil = (h) => api.get('/api/admin/audit-log', { q, modul, aksi, ...h });
      const [d, v] = await Promise.all([
        ambil({ limit: ukuranHalaman(), offset: 0 }),
        api.get('/api/admin/audit-log/verifikasi'),
      ]);
      kosongkan(wadah).append(
        el('div.notis', { class: v.valid ? 'sukses' : 'bahaya' }, [el('div.isi', [
          el('strong', v.valid ? `✓ Integritas audit trail VALID (${v.total} rekaman)`
            : '✕ Rantai audit trail TERPUTUS'),
          el('div.kecil', v.penjelasan),
          el('div.kecil.samar', { gaya: { marginTop: '4px' } }, v.dasar_hukum),
        ])]),
        panelTabel(`Jejak Audit (${angka(d.total)})`, tabelServer([
          { judul: 'Waktu', render: (a) => el('span.kecil.nowrap', waktu(a.waktu)) },
          { judul: 'Pengguna', render: (a) => el('span.mono.kecil', a.username || 'sistem') },
          { judul: 'Aksi', render: (a) => status(a.aksi === 'delete' ? 'bahaya'
            : a.aksi === 'create' ? 'aktif' : 'netral', judul(a.aksi)) },
          { judul: 'Modul', render: (a) => judul(a.modul) },
          { judul: 'Keterangan', render: (a) => el('span.kecil.lembut', a.keterangan || '-') },
          { judul: 'IP', render: (a) => el('span.mono.kecil.samar', a.ip || '-') },
          { judul: 'Hash', render: (a) => el('span.mono.kecil.samar',
            a.hash ? `${a.hash.slice(0, 10)}…` : '-') },
        ], { awal: d, ambil, kosongTeks: 'Belum ada jejak audit' }), [
          el('input', { type: 'search', placeholder: 'Cari keterangan…', nilai: q,
            oninput: (e) => { q = e.target.value; clearTimeout(muat.t); muat.t = setTimeout(muat, 320); } }),
          pilih('m', ['', 'anggota', 'simpanan', 'pinjaman', 'akuntansi', 'kas', 'pos', 'pembelian',
            'shu', 'aset', 'rat', 'dokumen', 'approval', 'admin', 'crm', 'audit', 'risiko',
            'compliance', 'persediaan', 'anggaran', 'surat']
            .map((s) => ({ nilai: s, teks: s ? judul(s) : 'Semua modul' })), modul,
          { onchange: (e) => { modul = e.target.value; muat(); } }),
          pilih('a', ['', 'create', 'update', 'delete', 'login', 'logout', 'approve', 'post', 'void', 'export']
            .map((s) => ({ nilai: s, teks: s ? judul(s) : 'Semua aksi' })), aksi,
          { onchange: (e) => { aksi = e.target.value; muat(); } }),
        ]),
      );
    } catch (err) { galat(err); }
  }
  await muat();
  return wadah;
}

// ------------------------- Keamanan & sistem -------------------------

async function sistemTab() {
  const [s, sesi] = await Promise.all([
    api.get('/api/admin/sistem'), api.get('/api/admin/sesi'),
  ]);
  const st = s.statistik;
  return el('div', [
    el('div.grid.k4.mb16', [
      kpi('Anggota', angka(st.anggota)),
      kpi('Jurnal', angka(st.jurnal), { catatan: `${angka(st.baris_jurnal)} baris` }),
      kpi('Rekaman Audit', angka(st.audit_log)),
      kpi('Sesi Aktif', angka(st.sesi_aktif)),
    ]),
    el('div.grid.k2', [
      panel('Informasi Sistem', el('dl.deskripsi', [
        el('dt', 'Versi aplikasi'), el('dd', s.versi_aplikasi),
        el('dt', 'Runtime Node.js'), el('dd', s.node),
        el('dt', 'Basis data'), el('dd', el('span.mono.kecil', s.basis_data)),
        el('dt', 'Ukuran basis data'), el('dd', `${(s.ukuran_db / 1024 / 1024).toFixed(2)} MB`),
        el('dt', 'Jumlah tabel'), el('dd', angka(s.jumlah_tabel)),
        el('dt', 'Waktu aktif'), el('dd', `${Math.floor(s.uptime_detik / 60)} menit`),
        el('dt', 'Penggunaan memori'), el('dd', `${s.memori_mb} MB`),
      ])),
      panel('Keamanan Akun Anda', keamananAkun()),
    ]),
    panelTabel(`Sesi Aktif (${sesi.data.length})`, tabel([
      { judul: 'Token', render: (x) => el('span.mono.kecil.samar', x.token) },
      { judul: 'Pengguna', render: (x) => `${x.nama} (${x.username})` },
      { judul: 'Peran', render: (x) => judul(x.role) },
      { judul: 'Alamat IP', render: (x) => el('span.mono.kecil', x.ip || '-') },
      { judul: 'Mulai', render: (x) => waktu(x.created_at) },
      { judul: 'Berakhir', render: (x) => waktu(x.expires_at) },
    ], sesi.data)),
    izin('admin.create') ? panel('Pencadangan Data', el('div', [
      el('div.kecil.lembut.mb8', 'Salinan basis data disimpan pada direktori data server. '
        + 'Lakukan pencadangan berkala dan simpan salinan di lokasi terpisah.'),
      el('button.btn.utama', { onclick: async (e) => {
        const tombol = e.currentTarget;
        tombol.disabled = true;
        try {
          const h = await api.post('/api/admin/backup', {});
          toast('Pencadangan berhasil', 'sukses', h.berkas);
        } catch (err) { galat(err); } finally { tombol.disabled = false; }
      } }, 'Buat Cadangan Sekarang'),
    ])) : null,
  ]);
}

/** Isi panel keamanan akun sendiri; dibangun ulang setelah status MFA berubah. */
function keamananAkun() {
  const wadah = el('div');
  const bangun = () => kosongkan(wadah).append(
    el('dl.deskripsi.mb16', [
      el('dt', 'Pengguna'), el('dd', negara.user.username),
      el('dt', 'Peran'), el('dd', negara.user.role_info?.nama),
      el('dt', 'MFA'), el('dd', negara.user.mfa_enabled
        ? el('span.pos', '✓ Aktif') : el('span.neg', 'Belum diaktifkan')),
    ]),
    el('div.gap8', [
      el('button.btn', { onclick: gantiSandi }, 'Ganti Kata Sandi'),
      negara.user.mfa_enabled
        ? el('button.btn.polos', { onclick: () => nonaktifkanMfa(bangun) }, 'Nonaktifkan MFA')
        : el('button.btn.utama', { onclick: () => siapkanMfa(bangun) }, 'Aktifkan MFA'),
    ]),
  );
  bangun();
  return wadah;
}

/** Menonaktifkan MFA akun sendiri; server mensyaratkan kata sandi saat ini. */
function nonaktifkanMfa(saatSelesai) {
  const f = el('div', [
    el('div.notis.peringatan', [el('div.isi', [
      el('strong', 'Nonaktifkan MFA'),
      el('div.kecil', 'Tanpa MFA, akun Anda hanya dilindungi kata sandi. Kunci autentikator lama '
        + 'dihapus sehingga perlu dipindai ulang bila MFA diaktifkan kembali.'),
    ])]),
    kolom('Kata Sandi Saat Ini', input('sandi', { tipe: 'password', autocomplete: 'current-password' }),
      { wajib: true }),
  ]);
  const tutup = modal({
    judul: 'Nonaktifkan MFA', lebar: 'sempit', isi: f,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.bahaya', { onclick: async (e) => {
        const tombol = e.currentTarget;
        tombol.disabled = true;
        try {
          await api.post('/api/auth/mfa/nonaktifkan', bacaForm(f));
          negara.user.mfa_enabled = 0;
          toast('MFA dinonaktifkan', 'sukses');
          tutup(); saatSelesai?.();
        } catch (err) { galat(err); tombol.disabled = false; }
      } }, 'Nonaktifkan'),
    ],
  });
}

function gantiSandi() {
  const f = el('div', [
    kolom('Kata Sandi Lama', input('sandi_lama', { tipe: 'password' }), { wajib: true }),
    kolom('Kata Sandi Baru', input('sandi_baru', { tipe: 'password' }),
      { wajib: true, bantuan: 'Minimal 8 karakter, mengandung huruf dan angka' }),
  ]);
  const tutup = modal({
    judul: 'Ganti Kata Sandi', lebar: 'sempit', isi: f,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async () => {
        try {
          const h = await api.post('/api/auth/ganti-sandi', bacaForm(f));
          toast('Kata sandi diubah', 'sukses', h.pesan);
          tutup();
        } catch (err) { galat(err); }
      } }, 'Simpan'),
    ],
  });
}

async function siapkanMfa(saatSelesai) {
  try {
    const h = await api.post('/api/auth/mfa/siapkan', {});
    const f = el('div', [
      el('div.notis.info', [el('div.isi', [
        el('strong', 'Multi-Factor Authentication (TOTP)'),
        el('div.kecil', h.petunjuk),
      ])]),
      kolom('Kunci Rahasia', el('div', {
        gaya: { fontFamily: 'var(--mono)', fontSize: '15px', letterSpacing: '2px',
          padding: '12px', background: 'var(--bg-subtle)', borderRadius: '8px',
          wordBreak: 'break-all', border: '1px solid var(--border)' },
      }, h.secret), { bantuan: 'Masukkan kunci ini pada Google Authenticator / Authy' }),
      kolom('Kode Verifikasi (6 digit)', input('kode', { inputmode: 'numeric', maxlength: 6 }),
        { wajib: true }),
    ]);
    const tutup = modal({
      judul: 'Aktifkan MFA', isi: f,
      kaki: [
        el('button.btn', { onclick: () => tutup() }, 'Batal'),
        el('button.btn.utama', { onclick: async () => {
          try {
            await api.post('/api/auth/mfa/aktifkan', bacaForm(f));
            toast('MFA berhasil diaktifkan', 'sukses');
            negara.user.mfa_enabled = 1;
            tutup(); saatSelesai?.();
          } catch (err) { galat(err); }
        } }, 'Aktifkan'),
      ],
    });
  } catch (err) { galat(err); }
}
