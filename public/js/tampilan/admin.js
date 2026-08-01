/**
 * Modul 26 - Administrator.
 */
import {
  api, el, kpi, panel, panelTabel, tabel, angka, waktu, tgl, status, judul, modal, kolom,
  input, pilih, bacaForm, toast, galat, memuat, kosongkan, konfirmasi, kosong,
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
      bilah.querySelectorAll('button').forEach((b) => b.classList.remove('aktif'));
      e.currentTarget.classList.add('aktif');
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
            onclick: () => resetSandi(u) }, '🔑'),
          izin('admin.delete') && u.id !== negara.user.id && el('button.btn.kecil.polos', {
            onclick: async () => {
              if (!await konfirmasi(`Hapus pengguna "${u.username}"?`, { ya: 'Hapus', jenis: 'bahaya' })) return;
              try { await api.del(`/api/admin/users/${u.id}`); toast('Pengguna dihapus', 'sukses'); muat(); }
              catch (err) { galat(err); }
            } }, '🗑'),
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
        e.currentTarget.disabled = true;
        try {
          const nilai = bacaForm(f);
          if (isBaru) await api.post('/api/admin/users', nilai);
          else await api.put(`/api/admin/users/${data.id}`, nilai);
          toast('Pengguna tersimpan', 'sukses');
          tutup(); saatSelesai?.();
        } catch (err) { galat(err); e.currentTarget.disabled = false; }
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

// ------------------------------ Peran ------------------------------

async function peranTab() {
  const d = await api.get('/api/admin/roles');
  return el('div', [
    el('div.notis.info', [el('div.isi', [
      el('strong', 'Role Based Access Control (RBAC)'),
      el('div.kecil', 'Hak akses melekat pada peran, bukan pada individu. Format izin: '
        + '"modul.aksi" — tanda bintang berarti seluruh aksi pada modul tersebut. '
        + 'Peran Pengawas sengaja dibuat hanya-baca sesuai prinsip pemisahan fungsi pengawasan '
        + 'dan pelaksanaan (Good Cooperative Governance).'),
    ])]),
    ...d.data.map((p) => panel(`${p.nama} (${p.jumlah_pengguna} pengguna)`, el('div', [
      el('div.kecil.lembut.mb8', p.deskripsi),
      el('div.gap8', p.permissions.map((x) => el('span.lencana-status.st-netral',
        { gaya: { fontFamily: 'var(--mono)', fontSize: '11px' } }, x))),
    ]))),
  ]);
}

// --------------------------- Pengaturan ---------------------------

async function pengaturanTab() {
  const wadah = el('div');
  const d = await api.get('/api/admin/settings');
  const grup = {};
  for (const s of d.data) {
    const g = s.key.split('.')[0];
    (grup[g] ||= []).push(s);
  }
  const LABEL = { koperasi: 'Identitas Koperasi', shu: 'Pembagian SHU (AD/ART)',
    pinjaman: 'Parameter Pinjaman', loyalty: 'Program Loyalti', coa: 'Pemetaan Akun Default' };

  const semuaInput = {};
  for (const [g, items] of Object.entries(grup)) {
    wadah.append(panel(LABEL[g] || judul(g), el('div.baris-form', items.map((s) => {
      const inp = input(s.key, { nilai: s.value ?? '' });
      semuaInput[s.key] = inp;
      return kolom(s.keterangan || s.key, inp, { bantuan: el('code', s.key).textContent });
    }))));
  }

  if (grup.shu) {
    const total = grup.shu.reduce((s, x) => s + Number(x.value || 0), 0);
    wadah.insertBefore(el('div.notis', { class: Math.abs(total - 100) < 0.01 ? 'sukses' : 'bahaya' },
      [el('div.isi', [
        el('strong', `Total alokasi SHU saat ini: ${total}%`),
        el('div.kecil', Math.abs(total - 100) < 0.01
          ? 'Sesuai ketentuan — total alokasi harus tepat 100%.'
          : 'Total alokasi wajib tepat 100%. Perbaiki sebelum menyimpan.'),
      ])]), wadah.firstChild);
  }

  if (izin('admin.update')) {
    wadah.append(el('button.btn.utama', { onclick: async (e) => {
      e.currentTarget.disabled = true;
      try {
        const nilai = {};
        for (const [k, inp] of Object.entries(semuaInput)) nilai[k] = inp.value;
        await api.put('/api/admin/settings', { settings: nilai });
        toast('Parameter sistem tersimpan', 'sukses');
      } catch (err) { galat(err); } finally { e.currentTarget.disabled = false; }
    } }, 'Simpan Seluruh Parameter'));
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
      const [d, v] = await Promise.all([
        api.get('/api/admin/audit-log', { q, modul, aksi, limit: 200 }),
        api.get('/api/admin/audit-log/verifikasi'),
      ]);
      kosongkan(wadah).append(
        el('div.notis', { class: v.valid ? 'sukses' : 'bahaya' }, [el('div.isi', [
          el('strong', v.valid ? `✓ Integritas audit trail VALID (${v.total} rekaman)`
            : '✕ Rantai audit trail TERPUTUS'),
          el('div.kecil', v.penjelasan),
          el('div.kecil.samar', { gaya: { marginTop: '4px' } }, v.dasar_hukum),
        ])]),
        panelTabel(`Jejak Audit (${angka(d.total)})`, tabel([
          { judul: 'Waktu', render: (a) => el('span.kecil.nowrap', waktu(a.waktu)) },
          { judul: 'Pengguna', render: (a) => el('span.mono.kecil', a.username || 'sistem') },
          { judul: 'Aksi', render: (a) => status(a.aksi === 'delete' ? 'bahaya'
            : a.aksi === 'create' ? 'aktif' : 'netral', judul(a.aksi)) },
          { judul: 'Modul', render: (a) => judul(a.modul) },
          { judul: 'Keterangan', render: (a) => el('span.kecil.lembut', a.keterangan || '-') },
          { judul: 'IP', render: (a) => el('span.mono.kecil.samar', a.ip || '-') },
          { judul: 'Hash', render: (a) => el('span.mono.kecil.samar',
            a.hash ? `${a.hash.slice(0, 10)}…` : '-') },
        ], d.data, { kosongTeks: 'Belum ada jejak audit' }), [
          el('input', { type: 'search', placeholder: 'Cari keterangan…',
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
      panel('Keamanan Akun Anda', el('div', [
        el('dl.deskripsi.mb16', [
          el('dt', 'Pengguna'), el('dd', negara.user.username),
          el('dt', 'Peran'), el('dd', negara.user.role_info?.nama),
          el('dt', 'MFA'), el('dd', negara.user.mfa_enabled
            ? el('span.pos', '✓ Aktif') : el('span.neg', 'Belum diaktifkan')),
        ]),
        el('div.gap8', [
          el('button.btn', { onclick: gantiSandi }, '🔑 Ganti Kata Sandi'),
          !negara.user.mfa_enabled && el('button.btn.utama', { onclick: siapkanMfa },
            '🔐 Aktifkan MFA'),
        ].filter(Boolean)),
      ])),
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
        e.currentTarget.disabled = true;
        try {
          const h = await api.post('/api/admin/backup', {});
          toast('Pencadangan berhasil', 'sukses', h.berkas);
        } catch (err) { galat(err); } finally { e.currentTarget.disabled = false; }
      } }, '💾 Buat Cadangan Sekarang'),
    ])) : null,
  ]);
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

async function siapkanMfa() {
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
            tutup();
          } catch (err) { galat(err); }
        } }, 'Aktifkan'),
      ],
    });
  } catch (err) { galat(err); }
}
