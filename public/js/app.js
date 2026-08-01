/**
 * Kerangka aplikasi: autentikasi, navigasi, dan perutean tampilan.
 */
import { api, el, kosongkan, toast, galat, memuat, modal, kolom, input, bacaForm } from './inti.js';
import { MENU, TAMPILAN } from './menu.js';

export const negara = { user: null, notifikasi: 0 };

const app = document.getElementById('app');

// ------------------------------- Masuk -------------------------------

function layarMasuk(pesanAwal) {
  const form = el('form', { onsubmit: async (e) => { e.preventDefault(); await kirim(); } }, [
    kolom('Nama Pengguna', input('username', { required: true, autocomplete: 'username',
      placeholder: 'contoh: admin' })),
    kolom('Kata Sandi', input('password', { tipe: 'password', required: true,
      autocomplete: 'current-password' })),
    el('div#kotak-mfa', { gaya: { display: 'none' } }, [
      kolom('Kode MFA', input('kode_mfa', { inputmode: 'numeric', maxlength: 6,
        placeholder: '6 digit' }), { bantuan: 'Buka aplikasi autentikator Anda.' }),
    ]),
    el('div#galat-masuk'),
    el('button.btn.utama.blok', { type: 'submit', gaya: { marginTop: '6px' } }, 'Masuk'),
  ]);

  async function kirim() {
    const data = bacaForm(form);
    const tombol = form.querySelector('button[type=submit]');
    const kotakGalat = form.querySelector('#galat-masuk');
    kosongkan(kotakGalat);
    tombol.disabled = true;
    tombol.textContent = 'Memproses…';
    try {
      const hasil = await api.post('/api/auth/login', data);
      if (hasil.perlu_mfa) {
        form.querySelector('#kotak-mfa').style.display = '';
        form.querySelector('[name=kode_mfa]').focus();
        kotakGalat.append(el('div.notis.info', hasil.pesan));
        return;
      }
      negara.user = hasil.user;
      await gambarKerangka();
      navigasi(location.hash || '#/');
    } catch (err) {
      kotakGalat.append(el('div.notis.bahaya', [
        el('div.isi', [el('strong', err.message), err.detail && el('div.kecil', err.detail)]),
      ]));
    } finally {
      tombol.disabled = false;
      tombol.textContent = 'Masuk';
    }
  }

  kosongkan(app).className = '';
  app.append(el('div.layar-masuk', [
    el('div.kartu-masuk', [
      el('div.merek', [
        el('div.logo', 'ECMS'),
        el('div.sub', 'Enterprise Cooperative Management System'),
        el('div.sub', { gaya: { fontWeight: '600', marginTop: '2px' } }, 'Koperasi Serba Usaha'),
      ]),
      pesanAwal ? el('div.notis.peringatan', pesanAwal) : null,
      form,
      el('div.kredensial', [
        el('div', { gaya: { fontWeight: '650', marginBottom: '5px' } }, 'Akun demonstrasi'),
        el('div', [el('code', 'admin'), ' / ', el('code', 'Admin12345'), ' — Super Administrator']),
        el('div', [el('code', 'pengurus1'), ' · ', el('code', 'bendahara1'), ' · ',
          el('code', 'kasir1'), ' · ', el('code', 'anggota1'), ' / ', el('code', 'Demo12345')]),
      ]),
    ]),
  ]));
}

// ------------------------------ Kerangka ------------------------------

async function gambarKerangka() {
  const menu = MENU.filter((g) => {
    g.item = g.item.filter((i) => izin(i.izin));
    return g.item.length > 0;
  });

  const sidebar = el('aside.sidebar#sidebar', [
    el('div.sidebar-kepala', [
      el('div.logo', 'ECMS'),
      el('div.nama-koperasi', negara.koperasi || 'Koperasi Serba Usaha'),
    ]),
    el('nav.nav#nav', menu.map((g) => el('div.nav-grup', [
      el('div.nav-judul', g.judul),
      ...g.item.map((i) => el('a', {
        href: `#${i.rute}`, 'data-rute': i.rute,
        onclick: () => { if (window.innerWidth <= 900) tutupSidebar(); },
      }, [el('span.ikon', i.ikon), el('span', i.nama),
        i.rute === '/approval' ? el('span.lencana#lencana-approval', { gaya: { display: 'none' } }) : null])),
    ]))),
    el('div.sidebar-kaki', [
      el('div.antara', [
        el('div', { gaya: { minWidth: 0 } }, [
          el('div.tebal.kecil', { gaya: { overflow: 'hidden', textOverflow: 'ellipsis',
            whiteSpace: 'nowrap' } }, negara.user.nama),
          el('div.kecil.samar', negara.user.role_info?.nama || negara.user.role),
        ]),
        el('button.btn.polos.kecil', { title: 'Keluar', onclick: keluar }, '⇥'),
      ]),
    ]),
  ]);

  const topbar = el('header.topbar', [
    el('button.btn.polos.tombol-menu', { onclick: bukaSidebar, 'aria-label': 'Menu' }, '☰'),
    el('div', { gaya: { minWidth: 0 } }, [
      el('h1#judul-halaman', 'Dasbor'),
      el('div.sub#sub-halaman', ''),
    ]),
    el('div.kanan', [
      el('button.btn.polos.kecil#tombol-notif', { title: 'Notifikasi', onclick: bukaNotifikasi }, '🔔'),
      el('button.btn.polos.kecil', { title: 'Ganti tema', onclick: gantiTema }, '◐'),
    ]),
  ]);

  kosongkan(app).className = '';
  app.append(el('div.kerangka', [sidebar, el('main.konten', [topbar, el('div.halaman#halaman')])]));
  segarkanNotifikasi();
}

const bukaSidebar = () => {
  document.getElementById('sidebar').classList.add('buka');
  const tirai = el('div.tirai', { onclick: tutupSidebar });
  document.body.append(tirai);
};
const tutupSidebar = () => {
  document.getElementById('sidebar')?.classList.remove('buka');
  document.querySelector('.tirai')?.remove();
};

function gantiTema() {
  const kini = document.documentElement.dataset.tema;
  const baru = kini === 'gelap' ? 'terang' : kini === 'terang' ? '' : 'gelap';
  if (baru) document.documentElement.dataset.tema = baru;
  else delete document.documentElement.dataset.tema;
  try { localStorage.setItem('ecms-tema', baru); } catch { /* penyimpanan tidak tersedia */ }
  navigasi(location.hash, true);
}

async function keluar() {
  try { await api.post('/api/auth/logout'); } catch { /* abaikan */ }
  negara.user = null;
  location.hash = '';
  layarMasuk('Anda telah keluar dari sistem.');
}

// ----------------------------- Hak akses -----------------------------

export function izin(perlu) {
  if (!perlu) return true;
  const daftar = negara.user?.izin || [];
  const [modul] = perlu.split('.');
  return daftar.some((p) => p === '*' || p === perlu || p === `${modul}.*`);
}

// ----------------------------- Notifikasi -----------------------------

export async function segarkanNotifikasi() {
  try {
    const n = await api.get('/api/notifikasi', { belum: 1 });
    negara.notifikasi = n.belum_dibaca;
    const tombol = document.getElementById('tombol-notif');
    if (tombol) tombol.textContent = n.belum_dibaca > 0 ? `🔔 ${n.belum_dibaca}` : '🔔';
    if (izin('approval.view')) {
      const a = await api.get('/api/approval', { saya: 1 });
      const lencana = document.getElementById('lencana-approval');
      if (lencana) {
        lencana.textContent = a.data.length;
        lencana.style.display = a.data.length ? '' : 'none';
      }
    }
  } catch { /* diabaikan */ }
}

async function bukaNotifikasi() {
  try {
    const n = await api.get('/api/notifikasi');
    modal({
      judul: 'Notifikasi',
      isi: n.data.length ? el('div', n.data.map((x) => el('div', {
        gaya: { padding: '10px 0', borderBottom: '1px solid var(--border)',
          opacity: x.dibaca ? '.6' : '1' },
      }, [
        el('div.antara', [
          el('strong', x.judul),
          el('span.kecil.samar', new Date(`${x.created_at.replace(' ', 'T')}Z`)
            .toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })),
        ]),
        x.pesan && el('div.kecil.lembut', { gaya: { marginTop: '3px' } }, x.pesan),
        x.link && el('a.kecil', { href: x.link, onclick: () => document.querySelector('.modal-latar')?.remove() }, 'Buka →'),
      ]))) : el('div.kosong', 'Tidak ada notifikasi'),
      kaki: [el('button.btn.utama', {
        onclick: async () => {
          await api.post('/api/notifikasi/baca', {});
          document.getElementById('modal-host').innerHTML = '';
          document.body.style.overflow = '';
          segarkanNotifikasi();
        },
      }, 'Tandai semua dibaca')],
    });
  } catch (err) { galat(err); }
}

// ------------------------------ Perutean ------------------------------

export function judulHalaman(teks, sub = '') {
  const j = document.getElementById('judul-halaman');
  const s = document.getElementById('sub-halaman');
  if (j) j.textContent = teks;
  if (s) s.textContent = sub;
  document.title = `${teks} · ECMS Koperasi`;
}

let rutePakai = null;

export async function navigasi(hash, paksa = false) {
  if (!negara.user) return;
  const bersih = (hash || '#/').replace(/^#/, '') || '/';
  if (bersih === rutePakai && !paksa) return;
  rutePakai = bersih;

  const [dasar, ...sisa] = bersih.split('/').filter(Boolean);
  const rute = `/${dasar || ''}`;
  const param = sisa;

  for (const a of document.querySelectorAll('#nav a')) {
    a.classList.toggle('aktif', a.dataset.rute === rute);
  }

  const halaman = document.getElementById('halaman');
  if (!halaman) return;
  const def = TAMPILAN[rute];
  if (!def) {
    judulHalaman('Halaman tidak ditemukan');
    kosongkan(halaman).append(el('div.kosong', [
      el('div.ikon', '🧭'),
      el('div.judul', 'Halaman tidak ditemukan'),
      el('a', { href: '#/' }, 'Kembali ke dasbor'),
    ]));
    return;
  }
  if (def.izin && !izin(def.izin)) {
    judulHalaman('Akses ditolak');
    kosongkan(halaman).append(el('div.notis.bahaya', [el('div.isi', [
      el('strong', 'Anda tidak memiliki hak akses ke modul ini'),
      el('div.kecil', `Diperlukan izin "${def.izin}". Peran Anda: ${negara.user.role_info?.nama}.`),
    ])]));
    return;
  }

  judulHalaman(def.judul, def.sub || '');
  kosongkan(halaman).append(memuat());
  try {
    const modul = await def.muat();
    const isi = await modul.render(param);
    if (rutePakai !== bersih) return;      // pengguna sudah berpindah halaman
    kosongkan(halaman).append(isi);
    window.scrollTo(0, 0);
  } catch (err) {
    kosongkan(halaman).append(el('div.notis.bahaya', [el('div.isi', [
      el('strong', err.message || 'Gagal memuat halaman'),
      err.detail && el('div.kecil', err.detail),
    ])]));
    if (err.status === 401) { negara.user = null; layarMasuk('Sesi Anda telah berakhir. Silakan masuk kembali.'); }
  }
}

window.addEventListener('hashchange', () => navigasi(location.hash));

// ------------------------------- Mula -------------------------------

(async function mula() {
  try {
    const t = localStorage.getItem('ecms-tema');
    if (t) document.documentElement.dataset.tema = t;
  } catch { /* penyimpanan tidak tersedia */ }

  try {
    const info = await api.get('/api/info');
    negara.aplikasi = info;
  } catch { /* abaikan */ }

  try {
    negara.user = await api.get('/api/auth/saya');
    try {
      const s = await api.get('/api/admin/settings', { prefix: 'koperasi.nama' });
      negara.koperasi = s.map['koperasi.nama'];
    } catch { /* pengguna tanpa akses pengaturan */ }
    await gambarKerangka();
    navigasi(location.hash || '#/');
  } catch {
    layarMasuk();
  }
}());
