/**
 * Kerangka aplikasi: autentikasi, navigasi, dan perutean tampilan.
 */
import { api, el, kosongkan, toast, galat, memuat, modal, kolom, input, bacaForm } from './inti.js';
import { MENU, TAMPILAN } from './menu.js';
import { ikon, lambang } from './ikon.js';
import { dataCetak, segarkanDataCetak } from './cetak.js';

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
      segarkanDataCetak();                 // nama pencetak pada tanda tangan ikut berganti
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

  // Kolom kiri hanya identitas dan konteks regulasi; ia disembunyikan pada
  // layar sempit (lihat app.css) sehingga formulir tidak pernah terdesak.
  const panelMerek = el('section.masuk-merek', [
    el('div.merek-atas', [lambang(38), el('div.nama', 'ECMS')]),
    el('div', [
      el('h2', 'Kelola seluruh usaha koperasi dari satu tempat'),
      el('p.kalimat', 'Keanggotaan, simpan pinjam, toko, akuntansi, hingga tata kelola '
        + 'dalam satu buku besar yang saling terhubung.'),
      el('div.acuan', ['UU 25/1992', 'Permenkop 2/2024', 'SAK EP', 'PSAK 14 & 16', 'UU ITE']
        .map((t) => el('span', t))),
    ]),
    el('div.kaki', `Enterprise Cooperative Management System · ${new Date().getFullYear()}`),
  ]);

  const kartu = el('div.kartu-masuk', [
    el('div.merek', [
      el('div.logo', 'ECMS'),
      el('h1', 'Masuk ke sistem'),
      el('div.sub', 'Gunakan akun yang diberikan pengurus koperasi.'),
    ]),
    pesanAwal ? el('div.notis.peringatan', pesanAwal) : null,
    form,
    // Hanya pada pemasangan demonstrasi. Di server sungguhan kata sandi
    // administrator berbeda, sehingga daftar ini akan menyesatkan sekaligus
    // memancing percobaan masuk yang berujung akun terkunci.
    negara.aplikasi?.demo ? el('div.kredensial', [
      el('div', { gaya: { fontWeight: '650', marginBottom: '5px' } }, 'Akun demonstrasi'),
      el('div', [el('code', 'admin'), ' / ', el('code', 'Admin12345'), ' — Super Administrator']),
      el('div', [el('code', 'pengurus1'), ' · ', el('code', 'bendahara1'), ' · ',
        el('code', 'kasir1'), ' · ', el('code', 'anggota1'), ' / ', el('code', 'Demo12345')]),
    ]) : null,
  ]);

  kosongkan(app).className = '';
  app.append(el('div.layar-masuk', [panelMerek, el('section.masuk-form', [kartu])]));
}

// ------------------------------ Kerangka ------------------------------

async function gambarKerangka() {
  // Disalin, bukan diubah di tempat: MENU tetap utuh bila pengguna lain masuk
  // tanpa memuat ulang halaman.
  const menu = MENU.map((g) => ({ ...g, item: g.item.filter((i) => izin(i.izin)
    && (!i.syarat || i.syarat(negara.user))) })).filter((g) => g.item.length > 0);

  const sidebar = el('aside.sidebar#sidebar', [
    el('div.sidebar-kepala', [
      el('div.tanda#tanda-koperasi', lambang(22)),
      el('div', { gaya: { minWidth: 0 } }, [
        el('div.logo', 'ECMS'),
        el('div.nama-koperasi#nama-koperasi', negara.koperasi || 'Koperasi Serba Usaha'),
      ]),
    ]),
    el('nav.nav#nav', menu.map((g) => el('div.nav-grup', [
      el('div.nav-judul', g.judul),
      ...g.item.map((i) => el('a', {
        href: `#${i.rute}`, 'data-rute': i.rute,
        onclick: () => { if (window.innerWidth <= 1000) tutupSidebar(); },
      }, [el('span.ikon', ikon(i.ikon, { ukuran: 17 })), el('span', i.nama),
        i.rute === '/approval' ? el('span.lencana#lencana-approval', { gaya: { display: 'none' } }) : null])),
    ]))),
    el('div.sidebar-kaki', [
      el('div.kartu-pengguna', [
        el('div.avatar', inisial(negara.user.nama)),
        el('div', { gaya: { minWidth: 0, flex: '1' } }, [
          el('div.nama', negara.user.nama),
          el('div.peran', negara.user.role_info?.nama || negara.user.role),
        ]),
        el('button.btn.polos.kecil', { title: 'Keluar', 'aria-label': 'Keluar', onclick: keluar },
          ikon('keluar', { ukuran: 17 })),
      ]),
    ]),
  ]);

  const topbar = el('header.topbar', [
    el('button.btn-ikon.tombol-menu', { onclick: bukaSidebar, 'aria-label': 'Buka menu' },
      ikon('menu', { ukuran: 20 })),
    el('div', { gaya: { minWidth: 0 } }, [
      el('h1#judul-halaman', 'Dasbor'),
      el('div.sub#sub-halaman', ''),
    ]),
    el('div.kanan', [
      el('a.lencana-aktivasi#lencana-aktivasi', { href: '#/setup', gaya: { display: 'none' } }),
      el('button.btn-ikon#tombol-notif', { title: 'Notifikasi', 'aria-label': 'Notifikasi',
        onclick: bukaNotifikasi }, [ikon('lonceng', { ukuran: 19 })]),
      el('button.btn-ikon#tombol-tema', { title: 'Ganti tema', 'aria-label': 'Ganti tema',
        onclick: gantiTema }, [ikon(namaIkonTema(), { ukuran: 19 })]),
    ]),
  ]);

  kosongkan(app).className = '';
  app.append(el('div.kerangka', [sidebar, el('main.konten', [topbar, el('div.halaman#halaman')])]));
  segarkanNotifikasi();
  segarkanIdentitas();
}

/**
 * Nama & logo koperasi pada sidebar serta penanda aktivasi untuk administrator.
 * Dipanggil ulang oleh halaman Setup Koperasi sesudah menyimpan.
 */
export async function segarkanIdentitas(paksa = false) {
  try {
    const d = await dataCetak(paksa);
    negara.koperasi = d.profil?.nama || negara.koperasi;
    negara.aktivasi = d.aktivasi || null;
    const nama = document.getElementById('nama-koperasi');
    if (nama) { nama.textContent = negara.koperasi || 'Koperasi Serba Usaha'; nama.title = nama.textContent; }
    const tanda = document.getElementById('tanda-koperasi');
    if (tanda) {
      kosongkan(tanda).append(d.profil?.logo ? el('img', { src: d.profil.logo, alt: 'Logo koperasi' }) : lambang(22));
      tanda.classList.toggle('berlogo', !!d.profil?.logo);
    }
    // Hanya pemegang akses administrator yang diingatkan; pengguna lain tidak
    // dapat berbuat apa-apa atas status aktivasi.
    const lencana = document.getElementById('lencana-aktivasi');
    const st = d.aktivasi?.status;
    if (lencana) {
      const tampil = izin('admin.view') && (st === 'belum' || st === 'kedaluwarsa');
      lencana.style.display = tampil ? '' : 'none';
      lencana.className = `lencana-aktivasi ${st === 'kedaluwarsa' ? 'bahaya' : 'peringatan'}`;
      lencana.textContent = st === 'kedaluwarsa' ? 'Aktivasi kedaluwarsa' : 'Belum diaktivasi';
      lencana.title = 'Buka Setup Koperasi untuk memasukkan nomor aktivasi';
    }
  } catch { /* identitas tetap memakai nilai bawaan */ }
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

/** Inisial nama untuk avatar: "Budi Santoso" -> "BS". */
function inisial(nama) {
  const kata = String(nama || '?').trim().split(/\s+/).slice(0, 2);
  return kata.map((k) => k[0]).join('').toUpperCase() || '?';
}

/** Ikon yang mewakili tema aktif: gelap, terang, atau mengikuti sistem. */
const namaIkonTema = () => ({ gelap: 'gelap', terang: 'terang' })[
  document.documentElement.dataset.tema] || 'otomatis';

function gantiTema() {
  const kini = document.documentElement.dataset.tema;
  const baru = kini === 'gelap' ? 'terang' : kini === 'terang' ? '' : 'gelap';
  if (baru) document.documentElement.dataset.tema = baru;
  else delete document.documentElement.dataset.tema;
  try { localStorage.setItem('ecms-tema', baru); } catch { /* penyimpanan tidak tersedia */ }

  const tombol = document.getElementById('tombol-tema');
  if (tombol) kosongkan(tombol).append(ikon(namaIkonTema(), { ukuran: 19 }));
  toast(`Tema: ${{ gelap: 'gelap', terang: 'terang' }[baru] || 'mengikuti sistem'}`);
  navigasi(location.hash, true);
}

async function keluar() {
  try { await api.post('/api/auth/logout'); } catch { /* abaikan */ }
  negara.user = null;
  segarkanDataCetak();
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
    // Jumlah ditempel sebagai gelembung terpisah, bukan menimpa isi tombol —
    // ikonnya harus tetap ada supaya tombol tidak berubah bentuk saat ada pesan.
    const tombol = document.getElementById('tombol-notif');
    if (tombol) {
      tombol.querySelector('.titik')?.remove();
      if (n.belum_dibaca > 0) {
        tombol.append(el('span.titik', n.belum_dibaca > 99 ? '99+' : String(n.belum_dibaca)));
      }
    }
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
  // Pindah halaman menutup dialog yang masih terbuka; kalau tidak, modal
  // halaman lama menutupi halaman baru.
  if (bersih !== rutePakai) {
    const host = document.getElementById('modal-host');
    if (host) kosongkan(host);
    document.body.style.overflow = '';
  }
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
    await gambarKerangka();
    navigasi(location.hash || '#/');
  } catch {
    layarMasuk();
  }
}());
