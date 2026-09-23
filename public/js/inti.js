/**
 * Inti aplikasi klien: pemanggilan API, pembentukan elemen, format,
 * notifikasi, dan dialog.
 */
import { ikon as ikonSvg } from './ikon.js';

// ------------------------------- API -------------------------------

async function minta(metode, path, data) {
  const opt = { method: metode, headers: {}, credentials: 'same-origin' };
  if (data !== undefined) {
    opt.headers['Content-Type'] = 'application/json';
    opt.body = JSON.stringify(data);
  }
  const res = await fetch(path, opt);
  let isi = null;
  try { isi = await res.json(); } catch { /* respons kosong */ }
  if (!res.ok) {
    const err = new Error(isi?.pesan || `Permintaan gagal (${res.status})`);
    err.status = res.status;
    err.detail = isi?.detail || null;
    throw err;
  }
  return isi;
}

export const api = {
  get: (p, q) => minta('GET', q ? `${p}${p.includes('?') ? '&' : '?'}${new URLSearchParams(
    Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== ''))}` : p),
  post: (p, d) => minta('POST', p, d ?? {}),
  put: (p, d) => minta('PUT', p, d ?? {}),
  del: (p) => minta('DELETE', p),
};

// ---------------------------- Pembentuk DOM ----------------------------

/**
 * Membuat elemen: el('div.kelas#id', {attr}, [anak])
 * Anak berupa string disisipkan sebagai teks (aman dari injeksi HTML).
 */
export function el(tag, props = {}, anak = []) {
  // Pemisahan selektor: nama tag diikuti token #id dan .kelas dalam urutan bebas,
  // sehingga "div.halaman#halaman" maupun "div#halaman.halaman" sama-sama sah.
  const selektor = String(tag);
  const cocokTag = selektor.match(/^[a-z0-9]+/i);
  const node = document.createElement(cocokTag ? cocokTag[0] : 'div');
  const kelas = [];
  for (const token of selektor.slice(cocokTag ? cocokTag[0].length : 0).match(/[.#][\w-]+/g) || []) {
    if (token[0] === '#') node.id = token.slice(1);
    else kelas.push(token.slice(1));
  }
  if (kelas.length) node.className = kelas.join(' ');

  // Argumen kedua boleh berupa properti ATAU langsung anak. Yang dianggap
  // properti hanyalah objek biasa; selain itu - teks, ANGKA, senarai, simpul -
  // diperlakukan sebagai anak. Sebelumnya angka luput dari pemeriksaan sehingga
  // el('td', 2025) menghasilkan sel kosong tanpa peringatan apa pun.
  const propsPolos = props === null || props === undefined
    || (typeof props === 'object' && !Array.isArray(props) && !(props instanceof Node));
  if (!propsPolos) { anak = props; props = {}; }
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = `${node.className} ${v}`.trim();
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'teks') node.textContent = v;
    else if (k === 'gaya') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'nilai') node.value = v;
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  const tambah = (c) => {
    if (c === null || c === undefined || c === false || c === '') return;
    if (Array.isArray(c)) { c.forEach(tambah); return; }
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  tambah(anak);
  return node;
}

export const kosongkan = (node) => { while (node.firstChild) node.removeChild(node.firstChild); return node; };

// ------------------------------ Format ------------------------------

const nf = new Intl.NumberFormat('id-ID');
const nf2 = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 });

export const rp = (n) => `Rp ${nf.format(Math.round(Number(n) || 0))}`;
export const angka = (n) => nf.format(Math.round(Number(n) || 0));
export const desimal = (n) => nf2.format(Number(n) || 0);
export const persen = (n) => `${nf2.format(Number(n) || 0)}%`;

/** Ringkas nilai besar: 1,2 jt / 3,4 M */
export function rpRingkas(n) {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  if (abs >= 1e12) return `Rp ${nf2.format(v / 1e12)} T`;
  if (abs >= 1e9) return `Rp ${nf2.format(v / 1e9)} M`;
  if (abs >= 1e6) return `Rp ${nf2.format(v / 1e6)} jt`;
  if (abs >= 1e3) return `Rp ${nf2.format(v / 1e3)} rb`;
  return rp(v);
}

const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli',
  'Agustus', 'September', 'Oktober', 'November', 'Desember'];

export function tgl(s, panjang = false) {
  if (!s) return '-';
  const d = String(s).slice(0, 10).split('-');
  if (d.length !== 3) return s;
  return panjang ? `${Number(d[2])} ${BULAN[Number(d[1]) - 1]} ${d[0]}`
    : `${d[2]}/${d[1]}/${d[0]}`;
}

export function waktu(s) {
  if (!s) return '-';
  const d = new Date(s.includes('T') || s.includes('Z') ? s : `${s.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit' });
}

export const periodeLabel = (p) => {
  if (!p) return '-';
  const [y, m] = String(p).split('-');
  return `${BULAN[Number(m) - 1] || m} ${y}`;
};

export const hariIni = () => new Date().toISOString().slice(0, 10);
export const awalTahun = () => `${new Date().getFullYear()}-01-01`;

/** Judul dari kode: 'kurang_lancar' -> 'Kurang Lancar' */
export const judul = (s) => String(s || '').replace(/[_-]/g, ' ')
  .replace(/\b\w/g, (c) => c.toUpperCase());

// ---------------------------- Notifikasi ----------------------------

export function toast(pesan, jenis = 'info', detail = null) {
  const host = document.getElementById('toast-host');
  const node = el(`div.toast.${jenis}`, [
    el('strong', pesan),
    detail && el('div.detail', detail),
  ]);
  host.append(node);
  setTimeout(() => {
    node.style.transition = 'opacity .25s, transform .25s';
    node.style.opacity = '0';
    node.style.transform = 'translateX(14px)';
    setTimeout(() => node.remove(), 260);
  }, jenis === 'bahaya' ? 6500 : 3800);
}

/** Menampilkan galat API sebagai toast dengan detail bantuan. */
export function galat(err) {
  console.error(err);
  toast(err.message || 'Terjadi kesalahan', 'bahaya', err.detail);
}

// ------------------------------ Dialog ------------------------------

/**
 * Membuka modal. Mengembalikan fungsi penutup.
 * @param {{judul:string, isi:Node, kaki?:Node[], lebar?:string, saatTutup?:Function}} opt
 */
export function modal({ judul: jdl, isi, kaki = [], lebar = '', saatTutup }) {
  const host = document.getElementById('modal-host');
  const tutup = () => { kosongkan(host); document.body.style.overflow = ''; saatTutup?.(); };
  const kotak = el(`div.modal${lebar ? `.${lebar}` : ''}`, [
    el('div.modal-kepala', [
      el('h3', jdl),
      el('button.btn.polos.kecil', { onclick: tutup, 'aria-label': 'Tutup', gaya: { marginLeft: 'auto' } }, '✕'),
    ]),
    el('div.modal-isi', [isi]),
    kaki.length ? el('div.modal-kaki', kaki) : null,
  ]);
  const latar = el('div.modal-latar', {
    onclick: (e) => { if (e.target === latar) tutup(); },
  }, [kotak]);
  document.body.style.overflow = 'hidden';
  kosongkan(host).append(latar);
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { tutup(); document.removeEventListener('keydown', esc); }
  });
  setTimeout(() => kotak.querySelector('input,select,textarea')?.focus(), 60);
  return tutup;
}

/** Dialog konfirmasi. Mengembalikan Promise<boolean>. */
export function konfirmasi(pesan, { judul: jdl = 'Konfirmasi', ya = 'Ya, lanjutkan', jenis = 'utama' } = {}) {
  return new Promise((resolve) => {
    let tutup;
    // resolve lebih dulu: tutup() memicu saatTutup → resolve(false), dan
    // Promise hanya menerima nilai pertama - urutan terbalik membuat tombol
    // "Ya" tidak pernah berpengaruh.
    const selesai = (v) => { resolve(v); tutup?.(); };
    tutup = modal({
      judul: jdl, lebar: 'sempit',
      isi: el('div', pesan),
      kaki: [
        el('button.btn', { onclick: () => selesai(false) }, 'Batal'),
        el(`button.btn.${jenis}`, { onclick: () => selesai(true) }, ya),
      ],
      saatTutup: () => resolve(false),
    });
  });
}

// ---------------------------- Komponen umum ----------------------------

export const memuat = (pesan = 'Memuat data…') => el('div.memuat-baris', [el('div.spinner', { gaya: { margin: '0 auto 12px' } }), pesan]);

/**
 * Keadaan kosong. Argumen ketiga adalah NAMA ikon dari ikon.js - bukan emoji -
 * supaya bentuk dan ketebalannya sama di semua perangkat.
 */
export const kosong = (judulTeks = 'Belum ada data', catatan = null, namaIkon = 'berkas') =>
  el('div.kosong', [
    el('div.ikon', ikonSvg(namaIkon, { ukuran: 34, tebal: 1.3 })),
    el('div.judul', judulTeks),
    catatan && el('div.kecil', catatan),
  ]);

/** Kepala panel: judul, keterangan kecil opsional di bawahnya, dan tombol aksi. */
function kepalaPanel(judulTeks, aksi, sub) {
  return el('div.panel-kepala', [
    sub ? el('div.panel-judul', [el('h3', judulTeks), el('div.panel-sub', sub)]) : el('h3', judulTeks),
    aksi.length ? el('div.aksi', aksi) : null,
  ]);
}

/**
 * Kartu berjudul. Argumen keempat opsional: { sub } untuk keterangan di
 * bawah judul (mis. rentang waktu atau sumber data).
 */
export function panel(judulTeks, isi, aksi = [], { sub } = {}) {
  return el('div.panel', [
    judulTeks && kepalaPanel(judulTeks, aksi, sub),
    el('div.panel-isi', [isi]),
  ]);
}

export function panelTabel(judulTeks, isi, aksi = [], { sub } = {}) {
  // Tabel berhalaman sudah membawa pembungkus gulir sendiri; bilah halamannya
  // harus di luar area gulir mendatar supaya tidak ikut tergeser.
  const berhalaman = isi?.classList?.contains('tabel-berhalaman');
  return el('div.panel', [
    judulTeks && kepalaPanel(judulTeks, aksi, sub),
    el('div.panel-isi.rapat', [berhalaman ? isi : el('div.tabel-bungkus', [isi])]),
  ]);
}

/**
 * Kartu indikator. `ikon` menerima teks (emoji) maupun simpul SVG dari ikon.js;
 * keduanya dibungkus keping berwarna yang mengikuti `jenis`.
 */
export function kpi(label, nilai, { catatan, jenis = '', ikon } = {}) {
  return el(`div.kpi${jenis ? `.${jenis}` : ''}`, [
    el('div.label', [ikon && el('span.kpi-ikon', ikon), label]),
    el('div.nilai', nilai),
    catatan && el('div.catatan', catatan),
  ]);
}

// ------------------------------ Pagination ------------------------------

/** Pilihan jumlah baris per halaman; pilihan terakhir pengguna diingat. */
export const UKURAN_HALAMAN = [10, 25, 50, 100];
const KUNCI_UKURAN = 'ecms-per-halaman';

function ukuranTersimpan() {
  try {
    const n = Number(localStorage.getItem(KUNCI_UKURAN));
    return UKURAN_HALAMAN.includes(n) ? n : UKURAN_HALAMAN[0];
  } catch { return UKURAN_HALAMAN[0]; }
}

/** Nomor halaman yang ditampilkan: pertama, terakhir, dan dua di kiri-kanan halaman aktif. */
function nomorHalaman(aktif, jumlah) {
  const set = new Set([1, jumlah]);
  for (let i = aktif - 2; i <= aktif + 2; i += 1) if (i >= 1 && i <= jumlah) set.add(i);
  const urut = [...set].sort((a, b) => a - b);
  const hasil = [];
  urut.forEach((n, i) => {
    if (i && n - urut[i - 1] > 1) hasil.push(null);
    hasil.push(n);
  });
  return hasil;
}

/** Jumlah baris per halaman pilihan pengguna (dipakai saat meminta halaman pertama ke server). */
export const ukuranHalaman = () => ukuranTersimpan();

/**
 * Bilah navigasi halaman. `st` = { jumlah, ukuran, aktif }; `ke(n)` pindah
 * halaman, `ganti(ukuranBaru)` mengganti jumlah baris per halaman.
 */
function isiBilah(bilah, st, ke, ganti) {
  const halaman = Math.max(1, Math.ceil(st.jumlah / st.ukuran));
  const awal = st.jumlah ? (st.aktif - 1) * st.ukuran + 1 : 0;
  const akhir = Math.min(st.jumlah, st.aktif * st.ukuran);
  const tombol = (isi, n, { aktif = false, label } = {}) => el('button', {
    type: 'button', class: aktif ? 'aktif' : '', disabled: n === null,
    'aria-label': label || `Halaman ${n}`, 'aria-current': aktif ? 'page' : null,
    onclick: () => { if (!aktif) ke(n); },
  }, isi);
  kosongkan(bilah).append(
    el('div.pager-info', `Menampilkan ${angka(awal)}–${angka(akhir)} dari ${angka(st.jumlah)} baris`),
    el('label.pager-ukuran', [
      'Baris per halaman ',
      el('select', { onchange: (e) => {
        const n = Number(e.target.value);
        try { localStorage.setItem(KUNCI_UKURAN, String(n)); } catch { /* abaikan */ }
        ganti(n);
      } }, UKURAN_HALAMAN.map((n) => el('option', { value: n, selected: n === st.ukuran }, String(n)))),
    ]),
    el('nav.pager-nav', { 'aria-label': 'Navigasi halaman' }, [
      tombol('‹', st.aktif > 1 ? st.aktif - 1 : null, { label: 'Halaman sebelumnya' }),
      ...nomorHalaman(st.aktif, halaman).map((n) => (n === null
        ? el('span.pager-elipsis', '…') : tombol(String(n), n, { aktif: n === st.aktif }))),
      tombol('›', st.aktif < halaman ? st.aktif + 1 : null, { label: 'Halaman berikutnya' }),
    ]),
  );
}

/** Pindah halaman: halaman aktif baru tetap memuat baris teratas yang sedang dilihat. */
const halamanUntuk = (st, ukuranBaru) => Math.floor(((st.aktif - 1) * st.ukuran) / ukuranBaru) + 1;

/**
 * Memasang pagination pada tabel yang seluruh barisnya sudah ada di browser:
 * hanya baris halaman aktif yang digambar. Tabel pendek (≤ ukuran terkecil)
 * digambar utuh tanpa bilah.
 *
 * @param {HTMLTableElement} tabelEl  tabel lengkap dengan thead/tfoot
 * @param {HTMLElement} tbody         tbody milik tabel (diisi ulang per halaman)
 * @param {number} jumlah             jumlah seluruh baris
 * @param {(i:number)=>HTMLElement} buatBaris  pembuat <tr> untuk baris ke-i
 * @returns {HTMLElement} tabel itu sendiri, atau pembungkus .tabel-berhalaman
 */
export function halamankan(tabelEl, tbody, jumlah, buatBaris) {
  if (jumlah <= UKURAN_HALAMAN[0]) {
    for (let i = 0; i < jumlah; i += 1) tbody.append(buatBaris(i));
    return tabelEl;
  }
  const st = { jumlah, ukuran: ukuranTersimpan(), aktif: 1 };
  const bilah = el('div.pager');
  const wadah = el('div.tabel-berhalaman', [el('div.tabel-bungkus', [tabelEl]), bilah]);

  function gambar() {
    st.aktif = Math.min(Math.max(1, st.aktif), Math.max(1, Math.ceil(jumlah / st.ukuran)));
    const awal = (st.aktif - 1) * st.ukuran;
    kosongkan(tbody);
    for (let i = awal; i < Math.min(jumlah, awal + st.ukuran); i += 1) tbody.append(buatBaris(i));
    isiBilah(bilah, st,
      (n) => { st.aktif = n; gambar(); wadah.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); },
      (u) => { st.aktif = halamanUntuk(st, u); st.ukuran = u; gambar(); });
  }
  gambar();
  // Ekspor (CSV) memerlukan seluruh baris, bukan hanya halaman yang tampil.
  wadah.tabelLengkap = () => {
    const salinan = tabelEl.cloneNode(true);
    const badan = salinan.querySelector('tbody');
    kosongkan(badan);
    for (let i = 0; i < jumlah; i += 1) badan.append(buatBaris(i));
    return salinan;
  };
  return wadah;
}

/** Sel-sel satu baris data menurut definisi kolom. */
const barisData = (kolom, r, i, saatKlik) => el('tr', {
  class: saatKlik ? 'klik' : '',
  onclick: saatKlik ? () => saatKlik(r) : null,
}, kolom.map((k) => el('td', { class: k.angka ? 'angka' : '' },
  [k.render ? k.render(r, i) : (r[k.kunci] ?? '-')])));

const kepalaTabel = (kolom) => el('thead', [el('tr', kolom.map((k) => el('th', { class: k.angka ? 'angka' : '' }, k.judul)))]);
const kakiTabel = (kolom, kaki) => (kaki ? el('tfoot', [el('tr', kolom.map((k) => el('td', { class: k.angka ? 'angka' : '' },
  [kaki[k.kunci] !== undefined ? kaki[k.kunci] : ''])))]) : null);

/**
 * Tabel dengan pagination di server: hanya halaman yang sedang dilihat yang
 * diminta, sehingga daftar ribuan baris (jurnal, penjualan) tetap ringan dan
 * seluruh data dapat dijelajahi.
 *
 * @param {Array} kolom  sama dengan tabel()
 * @param {object} o
 * @param {{data:Array,total:number}} o.awal  jawaban halaman pertama; minta dengan
 *   `limit: ukuranHalaman()` supaya tidak perlu dimuat dua kali
 * @param {({limit, offset}) => Promise<{data:Array,total:number}>} o.ambil  peminta halaman
 */
export function tabelServer(kolom, { awal, ambil, kosongTeks = 'Belum ada data', saatKlik, kaki } = {}) {
  if (!awal?.data?.length) return kosong(kosongTeks);
  const st = { jumlah: Number(awal.total ?? awal.data.length), ukuran: ukuranTersimpan(), aktif: 1 };
  const tbody = el('tbody');
  const tabelEl = el('table.tabel', [kepalaTabel(kolom), tbody, kakiTabel(kolom, kaki)]);
  const isiBaris = (data, offset) => {
    kosongkan(tbody).append(...data.map((r, j) => barisData(kolom, r, offset + j, saatKlik)));
  };
  // Halaman pertama yang dikirim pemanggil bisa lebih panjang dari ukuran halaman.
  isiBaris(awal.data.slice(0, st.ukuran), 0);
  if (st.jumlah <= UKURAN_HALAMAN[0] && awal.data.length >= st.jumlah) return tabelEl;

  const bilah = el('div.pager');
  const wadah = el('div.tabel-berhalaman', [el('div.tabel-bungkus', [tabelEl]), bilah]);
  let permintaan = 0;
  async function muatHalaman(gulir) {
    const nomor = ++permintaan;
    wadah.classList.add('memuat-halaman');
    try {
      const d = await ambil({ limit: st.ukuran, offset: (st.aktif - 1) * st.ukuran });
      if (nomor !== permintaan) return;                 // jawaban halaman lama yang terlambat
      st.jumlah = Number(d.total ?? st.jumlah);
      isiBaris(d.data, (st.aktif - 1) * st.ukuran);
      gambarBilah();
      if (gulir) wadah.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch (err) { galat(err); } finally { if (nomor === permintaan) wadah.classList.remove('memuat-halaman'); }
  }
  function gambarBilah() {
    isiBilah(bilah, st,
      (n) => { st.aktif = n; gambarBilah(); muatHalaman(true); },
      (u) => { st.aktif = halamanUntuk(st, u); st.ukuran = u; gambarBilah(); muatHalaman(false); });
  }
  gambarBilah();
  return wadah;
}

/**
 * Mengambil seluruh baris dari endpoint berhalaman (untuk cetak / ekspor
 * daftar), bertahap per `per` baris sampai `maks`.
 */
export async function ambilSemua(ambil, { per = 500, maks = 10000 } = {}) {
  const hasil = [];
  let total = Infinity;
  while (hasil.length < Math.min(total, maks)) {
    const d = await ambil({ limit: per, offset: hasil.length });
    total = Number(d.total ?? 0);
    if (!d.data?.length) break;
    hasil.push(...d.data);
  }
  return hasil;
}

/**
 * Tabel data dengan pagination otomatis (10/25/50/100 baris per halaman).
 * Baris kaki (`kaki`) selalu tampil dan berisi total seluruh data.
 * @param {Array} kolom [{judul, kunci?, render?, angka?, lebar?}]
 */
export function tabel(kolom, baris, { kosongTeks = 'Belum ada data', saatKlik, kaki } = {}) {
  if (!baris?.length) return kosong(kosongTeks);
  const tbody = el('tbody');
  const tabelEl = el('table.tabel', [kepalaTabel(kolom), tbody, kakiTabel(kolom, kaki)]);
  return halamankan(tabelEl, tbody, baris.length, (i) => barisData(kolom, baris[i], i, saatKlik));
}

/** Lencana status dengan pemetaan warna otomatis. */
const WARNA_STATUS = {
  aktif: 'st-sukses', selesai: 'st-sukses', lunas: 'st-sukses', disetujui: 'st-sukses',
  posted: 'st-sukses', patuh: 'st-sukses', dibagikan: 'st-sukses', terkirim: 'st-sukses',
  sehat: 'st-sukses', dicairkan: 'st-info', diterima: 'st-info', berjalan: 'st-info',
  diajukan: 'st-peringatan', menunggu: 'st-peringatan', calon: 'st-peringatan',
  draft: 'st-netral', rencana: 'st-netral', baru: 'st-info', diproses: 'st-info',
  review: 'st-peringatan', dianalisis: 'st-peringatan', survey: 'st-peringatan',
  perlu_perhatian: 'st-peringatan', terbuka: 'st-peringatan', simulasi: 'st-netral',
  ditolak: 'st-bahaya', batal: 'st-bahaya', void: 'st-bahaya', macet: 'st-bahaya',
  kadaluarsa: 'st-bahaya', tidak_patuh: 'st-bahaya', nonaktif: 'st-netral',
  keluar: 'st-netral', meninggal: 'st-netral', tutup: 'st-netral', arsip: 'st-netral',
  restrukturisasi: 'st-peringatan', undangan: 'st-info', hapus_buku: 'st-bahaya',
};

export function status(nilai, label) {
  const kelas = WARNA_STATUS[String(nilai || '').toLowerCase()] || 'st-netral';
  return el(`span.lencana-status.${kelas}`, label || judul(nilai));
}

export function bilah(nilai, maks = 100, jenis = '') {
  const p = maks > 0 ? Math.min(100, Math.max(0, (nilai / maks) * 100)) : 0;
  return el(`div.bilah${jenis ? `.${jenis}` : ''}`, [el('i', { gaya: { width: `${p}%` } })]);
}

/** Kolom formulir. */
export function kolom(label, input, { bantuan, wajib } = {}) {
  return el('div.kolom', [
    el('label', [label, wajib && el('span.wajib', ' *')]),
    input,
    bantuan && el('div.bantuan', bantuan),
  ]);
}

export function input(nama, opt = {}) {
  return el('input', { name: nama, type: opt.tipe || 'text', ...opt,
    class: opt.tipe === 'number' ? 'angka' : '' });
}

export function pilih(nama, opsi, terpilih, opt = {}) {
  return el('select', { name: nama, ...opt },
    opsi.map((o) => {
      const nilai = o.nilai ?? o.id ?? o;
      const teks = o.teks ?? o.nama ?? o;
      return el('option', { value: nilai, selected: String(nilai) === String(terpilih) }, teks);
    }));
}

/** Mengambil nilai seluruh input dalam sebuah elemen sebagai objek. */
export function bacaForm(node) {
  const data = {};
  for (const f of node.querySelectorAll('input[name], select[name], textarea[name]')) {
    if (f.type === 'checkbox') data[f.name] = f.checked;
    else if (f.type === 'number') data[f.name] = f.value === '' ? '' : Number(f.value);
    else data[f.name] = f.value;
  }
  return data;
}

/** Tab sederhana; isi dibangun ulang saat berpindah. */
export function tab(daftar, wadah) {
  let aktif = 0;
  const isi = el('div');
  const bilahTab = el('div.tab', daftar.map((t, i) => el('button', {
    class: i === 0 ? 'aktif' : '',
    onclick: (e) => {
      aktif = i;
      bilahTab.querySelectorAll('button').forEach((b) => b.classList.remove('aktif'));
      e.currentTarget.classList.add('aktif');
      kosongkan(isi).append(t.render());
    },
  }, t.judul)));
  isi.append(daftar[aktif].render());
  wadah.append(bilahTab, isi);
  return wadah;
}
