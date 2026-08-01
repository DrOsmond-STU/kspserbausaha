/**
 * Inti aplikasi klien: pemanggilan API, pembentukan elemen, format,
 * notifikasi, dan dialog.
 */

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

  if (props && (Array.isArray(props) || props instanceof Node || typeof props === 'string')) {
    anak = props; props = {};
  }
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
    const selesai = (v) => { tutup?.(); resolve(v); };
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

export const kosong = (judulTeks = 'Belum ada data', catatan = null, ikon = '📄') =>
  el('div.kosong', [
    el('div.ikon', ikon),
    el('div.judul', judulTeks),
    catatan && el('div.kecil', catatan),
  ]);

export function panel(judulTeks, isi, aksi = []) {
  return el('div.panel', [
    judulTeks && el('div.panel-kepala', [
      el('h3', judulTeks),
      aksi.length ? el('div.aksi', aksi) : null,
    ]),
    el('div.panel-isi', [isi]),
  ]);
}

export function panelTabel(judulTeks, isi, aksi = []) {
  return el('div.panel', [
    judulTeks && el('div.panel-kepala', [
      el('h3', judulTeks),
      aksi.length ? el('div.aksi', aksi) : null,
    ]),
    el('div.panel-isi.rapat', [el('div.tabel-bungkus', [isi])]),
  ]);
}

export function kpi(label, nilai, { catatan, jenis = '', ikon } = {}) {
  return el(`div.kpi${jenis ? `.${jenis}` : ''}`, [
    el('div.label', [ikon && el('span', ikon), label]),
    el('div.nilai', nilai),
    catatan && el('div.catatan', catatan),
  ]);
}

/**
 * Tabel data.
 * @param {Array} kolom [{judul, kunci?, render?, angka?, lebar?}]
 */
export function tabel(kolom, baris, { kosongTeks = 'Belum ada data', saatKlik, kaki } = {}) {
  if (!baris?.length) return kosong(kosongTeks);
  return el('table.tabel', [
    el('thead', [el('tr', kolom.map((k) => el('th', { class: k.angka ? 'angka' : '' }, k.judul)))]),
    el('tbody', baris.map((r, i) => el('tr', {
      class: saatKlik ? 'klik' : '',
      onclick: saatKlik ? () => saatKlik(r) : null,
    }, kolom.map((k) => el('td', { class: k.angka ? 'angka' : '' },
      [k.render ? k.render(r, i) : (r[k.kunci] ?? '-')]))))),
    kaki ? el('tfoot', [el('tr', kolom.map((k) => el('td', { class: k.angka ? 'angka' : '' },
      [kaki[k.kunci] !== undefined ? kaki[k.kunci] : ''])))]) : null,
  ]);
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
