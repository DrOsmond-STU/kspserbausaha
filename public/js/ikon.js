/**
 * Set ikon garis (line icon) berbasis SVG sebaris.
 *
 * Emoji dipakai sebelumnya karena praktis, tetapi bentuk, berat, dan warnanya
 * ditentukan oleh sistem operasi masing-masing perangkat - hasilnya antarmuka
 * yang terlihat berbeda-beda dan tidak pernah benar-benar rapi. Ikon di sini
 * digambar dengan satu ketebalan garis, mewarisi warna teks lewat currentColor,
 * sehingga menyatu dengan mode terang maupun gelap.
 *
 * Semua jalur digambar pada kanvas 24x24.
 */

const JALUR = {
  // ---- navigasi modul ----
  dasbor: 'M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6v-9h-6v9Zm0-16v5h6V4h-6Z',
  analitik: 'M4 19V9m5 10V5m5 14v-7m5 7V8',
  ponsel: 'M7 3h10a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm3.5 15h3',
  anggota: 'M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 11.5a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5ZM20 20v-1.5a3.5 3.5 0 0 0-2.6-3.38M15 5.13a3.25 3.25 0 0 1 0 6.24',
  dompet: 'M3 8.5A2.5 2.5 0 0 1 5.5 6H18a2 2 0 0 1 2 2v1M3 8.5V17a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-2M3 8.5c0 1 .7 1.5 1.7 1.5H21v5h-4.5a2.5 2.5 0 0 1 0-5H21',
  kartu: 'M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8Zm0 3h18M6.5 15h3',
  bagan: 'M12 3v9h9a9 9 0 1 0-9-9Zm4.5 5.5L21 5',
  keranjang: 'M3 4h2l2.2 10.2a2 2 0 0 0 2 1.6h7.5a2 2 0 0 0 2-1.55L20.5 8H6M10 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm7 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z',
  kotak: 'M12 3 3.5 7.5v9L12 21l8.5-4.5v-9L12 3Zm0 0v18M3.5 7.5 12 12l8.5-4.5',
  truk: 'M3 6.5A1.5 1.5 0 0 1 4.5 5H14v11H3V6.5ZM14 9h3.8l3.2 3.3V16h-7V9ZM7.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm10 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
  struk: 'M6 3h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4L6 21V3Zm3.5 5h5m-5 4h5',
  gedung: 'M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M14 21V10h4a2 2 0 0 1 2 2v9M3 21h18M7.5 7h3m-3 4h3m-3 4h3',
  buku: 'M5 4.5A1.5 1.5 0 0 1 6.5 3H19v14H6.5A1.5 1.5 0 0 0 5 18.5v-14ZM5 18.5A1.5 1.5 0 0 0 6.5 20H19v-3',
  laporan: 'M6 3h8l4 4v14H6V3Zm8 0v4h4M9.5 17v-3m3 3v-6m3 6v-4',
  uang: 'M2.5 7h19v10h-19V7Zm9.5 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM6 10v0m12 4v0',
  sasaran: 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18Zm0-4.5a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9Zm0-3.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z',
  lapis: 'M12 3 3 8l9 5 9-5-9-5Zm9 8.5-9 5-9-5m18 4.5-9 5-9-5',
  papan: 'M8 4H6a1 1 0 0 0-1 1v15a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1h-2M9 3h6v3H9V3Zm-.5 11 2.2 2.2 4.3-4.4',
  centang: 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18Zm-3.8-9.2 2.7 2.7 5-5',
  map: 'M4 6.5A1.5 1.5 0 0 1 5.5 5h3.2l1.8 2.5h8A1.5 1.5 0 0 1 20 9v8.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-11Z',
  neraca: 'M12 3v18M7 21h10M12 6 5 8.5m7-2.5 7 2.5M5 8.5 2.5 15a2.5 2.5 0 0 0 5 0L5 8.5Zm14 0L16.5 15a2.5 2.5 0 0 0 5 0L19 8.5Z',
  kaca: 'M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Zm5-2 5 5',
  waspada: 'M10.3 4.3 2.6 17.4A2 2 0 0 0 4.3 20.4h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0ZM12 9v4.5m0 3v0',
  obrol: 'M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-5.2A8 8 0 1 1 21 12Z',
  basis: 'M12 8.5c4.4 0 8-1.2 8-2.75S16.4 3 12 3 4 4.2 4 5.75 7.6 8.5 12 8.5Zm8-2.75V18.25C20 19.8 16.4 21 12 21s-8-1.2-8-2.75V5.75M20 12c0 1.55-3.6 2.75-8 2.75S4 13.55 4 12',
  roda: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Zm7.4-2.2a7.6 7.6 0 0 0 0-2l1.9-1.4-1.9-3.3-2.2.9a7.6 7.6 0 0 0-1.75-1L15.1 3h-3.8l-.35 2.3c-.63.25-1.22.58-1.75 1l-2.2-.9L5.1 8.7 7 10.1a7.6 7.6 0 0 0 0 2L5.1 13.5l1.9 3.3 2.2-.9c.53.42 1.12.75 1.75 1l.35 2.3h3.8l.35-2.3c.63-.25 1.22-.58 1.75-1l2.2.9 1.9-3.3-1.9-1.4Z',

  // ---- antarmuka ----
  menu: 'M4 7h16M4 12h16M4 17h16',
  lonceng: 'M18 8.5a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16s-2-1.5-2-6.5ZM10.3 19a2 2 0 0 0 3.4 0',
  terang: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0-14v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4',
  gelap: 'M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z',
  otomatis: 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18Zm0-18v18',
  keluar: 'M15 17.5V19a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1.5M10.5 12H21m0 0-3.2-3.2M21 12l-3.2 3.2',
  tutup: 'M6.5 6.5l11 11m0-11-11 11',
  kompas: 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18Zm3.5-12.5-2 5.5-5.5 2 2-5.5 5.5-2Z',
  berkas: 'M7 3h7l4 4v14H7V3Zm7 0v4h4',
  jam: 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18Zm0-13.5V12l3 2',
  orang: 'M18 20v-1.75A4.25 4.25 0 0 0 13.75 14h-3.5A4.25 4.25 0 0 0 6 18.25V20M12 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
  perisai: 'M12 3 5 6v5.5c0 4.2 2.9 7.9 7 9.5 4.1-1.6 7-5.3 7-9.5V6l-7-3Zm-2.6 8.8 2 2 4-4',
  bintang: 'm12 4 2.6 5.3 5.9.85-4.25 4.15 1 5.85L12 17.4l-5.25 2.75 1-5.85L3.5 10.15l5.9-.85L12 4Z',
};

/**
 * Membuat elemen SVG. Ukuran mengikuti font sekitarnya bila tidak ditentukan,
 * dan warnanya selalu mengikuti currentColor supaya cukup satu berkas ikon
 * untuk mode terang dan gelap.
 */
export function ikon(nama, { ukuran = 20, tebal = 1.7, isi = false } = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', ukuran);
  svg.setAttribute('height', ukuran);
  svg.setAttribute('fill', isi ? 'currentColor' : 'none');
  svg.setAttribute('stroke', isi ? 'none' : 'currentColor');
  svg.setAttribute('stroke-width', tebal);
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('ikon-svg');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', JALUR[nama] || JALUR.berkas);
  svg.append(path);
  return svg;
}

/** Lambang koperasi: tiga pilar yang menyatu — dipakai pada layar masuk. */
export function lambang(ukuran = 44) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.setAttribute('width', ukuran);
  svg.setAttribute('height', ukuran);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = `
    <path d="M24 4 44 15v18L24 44 4 33V15L24 4Z" fill="currentColor" opacity=".14"/>
    <path d="M24 4 44 15v18L24 44 4 33V15L24 4Z" stroke="currentColor" stroke-width="2.2"
          stroke-linejoin="round"/>
    <path d="M16 30V21m8 9V15m8 15v-6" stroke="currentColor" stroke-width="3"
          stroke-linecap="round"/>`;
  return svg;
}

export default ikon;
