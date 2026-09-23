/**
 * Grafik SVG tanpa pustaka eksternal.
 *
 * Palet kategorikal (slot 1-3) telah divalidasi untuk keterbacaan penyandang
 * buta warna pada mode terang maupun gelap. Karena salah satu warna berada di
 * bawah rasio kontras 3:1 pada mode terang, setiap grafik SELALU menyertakan
 * legenda dan label langsung sebagai penanda identitas selain warna.
 */

// Warna diambil dari token CSS (app.css: --seri-1..4, --teks, --border, ...)
// sehingga grafik selalu seirama dengan tema aktif, terang maupun gelap.
// Nilai cadangan dipakai bila stylesheet belum termuat.
const token = (nama, cadangan) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(nama).trim();
  return v || cadangan;
};

export const SERI = () => [
  token('--seri-1', '#1a7bd4'), token('--seri-2', '#e0702a'),
  token('--seri-3', '#1c9a6c'), token('--seri-4', '#c98f00'),
];

const tinta = () => ({
  teks: token('--teks', '#0b1b2e'), lembut: token('--teks-lembut', '#526883'),
  grid: token('--border', '#dce6f2'), permukaan: token('--bg-panel', '#ffffff'),
  isi: Number(token('--grafik-isi', '.18')) || 0.18,
});

let nomorGradasi = 0;
/** Gradasi tegak satu warna (pekat di atas, memudar ke bawah) untuk area & batang. */
function gradasi(svg, warna, atas, bawah) {
  const id = `gr-${++nomorGradasi}`;
  const lg = s('linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1 }, [
    s('stop', { offset: '0%', 'stop-color': warna, 'stop-opacity': atas }),
    s('stop', { offset: '100%', 'stop-color': warna, 'stop-opacity': bawah }),
  ]);
  let defs = svg.querySelector('defs');
  if (!defs) { defs = s('defs'); svg.prepend(defs); }
  defs.append(lg);
  return `url(#${id})`;
}

const NS = 'http://www.w3.org/2000/svg';
function s(tag, attr = {}, anak = []) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attr)) {
    if (v !== null && v !== undefined) n.setAttribute(k, v);
  }
  for (const c of [].concat(anak)) {
    if (c) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return n;
}

const nfRingkas = (v) => {
  const a = Math.abs(v);
  if (a >= 1e12) return `${(v / 1e12).toFixed(1)} T`;
  if (a >= 1e9) return `${(v / 1e9).toFixed(1)} M`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)} jt`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(0)} rb`;
  return new Intl.NumberFormat('id-ID').format(Math.round(v));
};
const nfPenuh = (v) => new Intl.NumberFormat('id-ID').format(Math.round(v));

/** Skala sumbu yang "bulat" (1/2/5 × 10^n). */
function skalaBagus(min, maks, target = 5) {
  if (min === maks) { maks = min + 1; }
  const rentang = maks - min;
  const kasar = rentang / target;
  const pangkat = 10 ** Math.floor(Math.log10(Math.abs(kasar) || 1));
  const norm = kasar / pangkat;
  const langkah = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * pangkat;
  const bawah = Math.floor(min / langkah) * langkah;
  const atas = Math.ceil(maks / langkah) * langkah;
  const tik = [];
  for (let v = bawah; v <= atas + langkah / 2; v += langkah) tik.push(Number(v.toFixed(6)));
  return { bawah, atas, tik };
}

// --------------------------- Tooltip bersama ---------------------------

function buatTooltip(wadah) {
  const tip = document.createElement('div');
  Object.assign(tip.style, {
    position: 'absolute', pointerEvents: 'none', opacity: '0', zIndex: '5',
    background: 'var(--bg-panel)', border: '1px solid var(--border)',
    borderRadius: '8px', boxShadow: 'var(--bayang-lg)', padding: '8px 10px',
    fontSize: '12px', whiteSpace: 'nowrap', transition: 'opacity .1s',
    color: 'var(--teks)',
  });
  wadah.style.position = 'relative';
  wadah.append(tip);
  return tip;
}

const posisikan = (tip, wadah, x, y) => {
  const w = wadah.clientWidth;
  const lebarTip = tip.offsetWidth || 140;
  let kiri = x + 12;
  if (kiri + lebarTip > w - 4) kiri = x - lebarTip - 12;
  tip.style.left = `${Math.max(4, kiri)}px`;
  tip.style.top = `${Math.max(4, y - 10)}px`;
};

/**
 * Grafik garis / area multi-seri dengan crosshair dan tooltip.
 * @param {{label:string[], seri:{nama:string,data:number[]}[], tinggi?:number,
 *          format?:Function, area?:boolean}} opt
 */
export function grafikGaris({ label, seri, tinggi = 240, format = nfRingkas, area = false }) {
  const wadah = document.createElement('div');
  if (!label?.length || !seri?.length) {
    wadah.className = 'kosong';
    wadah.textContent = 'Belum ada data untuk ditampilkan';
    return wadah;
  }
  const warna = SERI();
  const c = tinta();
  const W = 780;
  const H = tinggi;
  // Label langsung di ujung kanan memerlukan ruang; lebarnya menyesuaikan
  // nama seri terpanjang agar teks tidak terpotong.
  const labelLangsung = seri.length <= 4;
  const lebarLabel = labelLangsung
    ? Math.min(150, 12 + Math.max(...seri.map((s) => s.nama.length)) * 6.2) : 16;
  const m = { atas: 16, kanan: lebarLabel, bawah: 30, kiri: 62 };
  const pw = W - m.kiri - m.kanan;
  const ph = H - m.atas - m.bawah;

  const semua = seri.flatMap((x) => x.data.map(Number));
  const { bawah, atas, tik } = skalaBagus(Math.min(0, ...semua), Math.max(0, ...semua));
  const X = (i) => m.kiri + (label.length === 1 ? pw / 2 : (i / (label.length - 1)) * pw);
  const Y = (v) => m.atas + ph - ((v - bawah) / (atas - bawah || 1)) * ph;

  const svg = s('svg', { class: 'grafik', viewBox: `0 0 ${W} ${H}`,
    preserveAspectRatio: 'xMidYMid meet', role: 'img' });

  // Kisi & sumbu nilai (recessive)
  for (const t of tik) {
    svg.append(s('line', { x1: m.kiri, x2: m.kiri + pw, y1: Y(t), y2: Y(t),
      stroke: c.grid, 'stroke-width': 1 }));
    svg.append(s('text', { x: m.kiri - 8, y: Y(t) + 4, 'text-anchor': 'end',
      'font-size': 11, fill: c.lembut }, format(t)));
  }
  if (bawah < 0) {
    svg.append(s('line', { x1: m.kiri, x2: m.kiri + pw, y1: Y(0), y2: Y(0),
      stroke: c.lembut, 'stroke-width': 1.5 }));
  }

  // Label sumbu waktu (dijarangkan agar tidak bertabrakan)
  const lompat = Math.ceil(label.length / 8);
  label.forEach((l, i) => {
    if (i % lompat !== 0 && i !== label.length - 1) return;
    svg.append(s('text', { x: X(i), y: H - 9, 'text-anchor': 'middle',
      'font-size': 11, fill: c.lembut }, l));
  });

  // Posisi label ujung dihitung lebih dulu lalu digeser bila saling bertumpuk,
  // sehingga identitas seri tetap terbaca tanpa mengandalkan warna semata.
  const posLabel = seri.map((sr, si) => ({
    si, y: Y(Number(sr.data[sr.data.length - 1]) || 0) + 4, nama: sr.nama,
  })).sort((a, b) => a.y - b.y);
  const JARAK_MIN = 13;
  for (let i = 1; i < posLabel.length; i++) {
    if (posLabel[i].y - posLabel[i - 1].y < JARAK_MIN) {
      posLabel[i].y = posLabel[i - 1].y + JARAK_MIN;
    }
  }
  const geserLabel = new Map(posLabel.map((p) => [p.si, p.y]));

  seri.forEach((sr, si) => {
    const w = warna[si % warna.length];
    const titik = sr.data.map((v, i) => [X(i), Y(Number(v) || 0)]);
    if (area) {
      // Area bergradasi; pada banyak seri dibuat lebih tipis agar tidak menutupi.
      const pekat = seri.length === 1 ? c.isi * 1.6 : c.isi * 0.8;
      svg.append(s('path', {
        d: `M${titik.map((p) => p.join(',')).join(' L')} L${X(label.length - 1)},${Y(bawah)} L${X(0)},${Y(bawah)} Z`,
        fill: gradasi(svg, w, pekat, 0),
      }));
    }
    svg.append(s('path', {
      d: `M${titik.map((p) => p.join(',')).join(' L')}`,
      fill: 'none', stroke: w, 'stroke-width': 2.5,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round',
    }));
    // Label langsung di titik terakhir - identitas tidak bergantung warna saja
    const akhir = titik[titik.length - 1];
    svg.append(s('circle', { cx: akhir[0], cy: akhir[1], r: 4, fill: w,
      stroke: c.permukaan, 'stroke-width': 2 }));
    if (labelLangsung) {
      const yLabel = geserLabel.get(si);
      // Garis penghubung tipis bila label digeser menjauh dari titik datanya
      if (Math.abs(yLabel - akhir[1]) > 2) {
        svg.append(s('line', { x1: akhir[0] + 4, y1: akhir[1], x2: akhir[0] + 8, y2: yLabel - 3,
          stroke: c.grid, 'stroke-width': 1 }));
      }
      svg.append(s('text', { x: akhir[0] + 9, y: yLabel, 'font-size': 11,
        fill: c.lembut, 'font-weight': 600 }, sr.nama));
    }
  });

  // Lapisan interaksi: crosshair + tooltip
  const garisBantu = s('line', { y1: m.atas, y2: m.atas + ph, stroke: c.lembut,
    'stroke-width': 1, 'stroke-dasharray': '3 3', opacity: 0 });
  svg.append(garisBantu);
  const penanda = seri.map((_, si) => s('circle', { r: 5, fill: warna[si % warna.length],
    stroke: c.permukaan, 'stroke-width': 2, opacity: 0 }));
  penanda.forEach((p) => svg.append(p));

  const tip = buatTooltip(wadah);
  const alas = s('rect', { x: m.kiri, y: m.atas, width: pw, height: ph, fill: 'transparent' });
  svg.append(alas);

  const sembunyi = () => {
    tip.style.opacity = '0'; garisBantu.setAttribute('opacity', 0);
    penanda.forEach((p) => p.setAttribute('opacity', 0));
  };
  const gerak = (ev) => {
    const kotak = svg.getBoundingClientRect();
    const titikX = ev.touches ? ev.touches[0].clientX : ev.clientX;
    const titikY = ev.touches ? ev.touches[0].clientY : ev.clientY;
    const px = ((titikX - kotak.left) / kotak.width) * W;
    const i = Math.max(0, Math.min(label.length - 1,
      Math.round(((px - m.kiri) / pw) * (label.length - 1))));
    garisBantu.setAttribute('x1', X(i));
    garisBantu.setAttribute('x2', X(i));
    garisBantu.setAttribute('opacity', 1);
    seri.forEach((sr, si) => {
      penanda[si].setAttribute('cx', X(i));
      penanda[si].setAttribute('cy', Y(Number(sr.data[i]) || 0));
      penanda[si].setAttribute('opacity', 1);
    });
    tip.innerHTML = '';
    const jd = document.createElement('div');
    jd.style.fontWeight = '700';
    jd.style.marginBottom = '4px';
    jd.textContent = label[i];
    tip.append(jd);
    seri.forEach((sr, si) => {
      const b = document.createElement('div');
      b.style.display = 'flex';
      b.style.gap = '8px';
      b.style.justifyContent = 'space-between';
      const kiri = document.createElement('span');
      kiri.style.color = 'var(--teks-lembut)';
      const kotakWarna = document.createElement('i');
      Object.assign(kotakWarna.style, { display: 'inline-block', width: '9px', height: '9px',
        borderRadius: '2px', background: warna[si % warna.length], marginRight: '6px' });
      kiri.append(kotakWarna, document.createTextNode(sr.nama));
      const kanan = document.createElement('strong');
      kanan.textContent = nfPenuh(Number(sr.data[i]) || 0);
      b.append(kiri, kanan);
      tip.append(b);
    });
    tip.style.opacity = '1';
    posisikan(tip, wadah, ((titikX - kotak.left) / kotak.width) * wadah.clientWidth,
      ((titikY - kotak.top) / kotak.height) * wadah.clientHeight);
  };
  svg.addEventListener('mousemove', gerak);
  svg.addEventListener('mouseleave', sembunyi);
  svg.addEventListener('touchmove', (e) => { gerak(e); e.preventDefault(); }, { passive: false });
  svg.addEventListener('touchend', sembunyi);

  wadah.append(svg);
  if (seri.length >= 2) wadah.append(legenda(seri.map((x) => x.nama), warna));
  return wadah;
}

/** Grafik batang vertikal satu seri. */
export function grafikBatang({ label, data, tinggi = 230, format = nfRingkas, warna: warnaKustom }) {
  const wadah = document.createElement('div');
  if (!label?.length) {
    wadah.className = 'kosong';
    wadah.textContent = 'Belum ada data untuk ditampilkan';
    return wadah;
  }
  const c = tinta();
  const w1 = warnaKustom || SERI()[0];
  const W = 780;
  const H = tinggi;
  const m = { atas: 14, kanan: 14, bawah: 30, kiri: 62 };
  const pw = W - m.kiri - m.kanan;
  const ph = H - m.atas - m.bawah;
  const nilai = data.map(Number);
  const { bawah, atas, tik } = skalaBagus(Math.min(0, ...nilai), Math.max(0, ...nilai));
  const Y = (v) => m.atas + ph - ((v - bawah) / (atas - bawah || 1)) * ph;
  // Jarak 2px antar batang sebagai pemisah permukaan
  const lebarSlot = pw / label.length;
  const lebarBatang = Math.max(3, Math.min(38, lebarSlot - 6));

  const svg = s('svg', { class: 'grafik', viewBox: `0 0 ${W} ${H}`,
    preserveAspectRatio: 'xMidYMid meet', role: 'img' });
  // Batang bergradasi: pekat di puncak, sedikit memudar ke dasar.
  const isiBatang = gradasi(svg, w1, 1, 0.62);
  for (const t of tik) {
    svg.append(s('line', { x1: m.kiri, x2: m.kiri + pw, y1: Y(t), y2: Y(t),
      stroke: c.grid, 'stroke-width': 1 }));
    svg.append(s('text', { x: m.kiri - 8, y: Y(t) + 4, 'text-anchor': 'end',
      'font-size': 11, fill: c.lembut }, format(t)));
  }

  const tip = buatTooltip(wadah);
  const lompat = Math.ceil(label.length / 12);
  label.forEach((l, i) => {
    const v = nilai[i] || 0;
    const x = m.kiri + i * lebarSlot + (lebarSlot - lebarBatang) / 2;
    const y = v >= 0 ? Y(v) : Y(0);
    const h = Math.max(1, Math.abs(Y(v) - Y(0)));
    const btg = s('rect', { x, y, width: lebarBatang, height: h, rx: 4, fill: isiBatang });
    btg.addEventListener('mouseenter', (ev) => {
      btg.setAttribute('opacity', 0.82);
      tip.innerHTML = '';
      const a = document.createElement('div');
      a.style.color = 'var(--teks-lembut)';
      a.textContent = l;
      const b = document.createElement('strong');
      b.textContent = nfPenuh(v);
      tip.append(a, b);
      tip.style.opacity = '1';
      const kotak = svg.getBoundingClientRect();
      posisikan(tip, wadah, ((ev.clientX - kotak.left) / kotak.width) * wadah.clientWidth,
        ((ev.clientY - kotak.top) / kotak.height) * wadah.clientHeight);
    });
    btg.addEventListener('mouseleave', () => {
      btg.setAttribute('opacity', 1); tip.style.opacity = '0';
    });
    svg.append(btg);
    if (i % lompat === 0 || i === label.length - 1) {
      svg.append(s('text', { x: x + lebarBatang / 2, y: H - 9, 'text-anchor': 'middle',
        'font-size': 11, fill: c.lembut }, l));
    }
  });
  wadah.append(svg);
  return wadah;
}

/** Batang horizontal berlabel - untuk peringkat / komposisi. */
export function grafikPeringkat({ baris, format = (v) => nfPenuh(v), warna: warnaKustom }) {
  const wadah = document.createElement('div');
  if (!baris?.length) {
    wadah.className = 'kosong';
    wadah.textContent = 'Belum ada data untuk ditampilkan';
    return wadah;
  }
  const maks = Math.max(...baris.map((b) => Math.abs(Number(b.nilai) || 0)), 1);
  const palet = SERI();
  for (const b of baris) {
    const p = (Math.abs(Number(b.nilai) || 0) / maks) * 100;
    const w = b.warna || warnaKustom || palet[0];
    const kotak = document.createElement('div');
    kotak.style.marginBottom = '11px';
    const atas = document.createElement('div');
    Object.assign(atas.style, { display: 'flex', justifyContent: 'space-between',
      gap: '12px', fontSize: '12.5px', marginBottom: '4px' });
    const kiri = document.createElement('span');
    kiri.textContent = b.label;
    kiri.style.overflow = 'hidden';
    kiri.style.textOverflow = 'ellipsis';
    kiri.style.whiteSpace = 'nowrap';
    const kanan = document.createElement('strong');
    kanan.style.whiteSpace = 'nowrap';
    kanan.textContent = format(b.nilai);
    atas.append(kiri, kanan);
    const jalur = document.createElement('div');
    Object.assign(jalur.style, { height: '8px', background: 'var(--bg-hover)',
      borderRadius: '5px', overflow: 'hidden' });
    const isi = document.createElement('i');
    Object.assign(isi.style, { display: 'block', height: '100%', width: `${p}%`,
      background: w, borderRadius: '5px' });
    jalur.append(isi);
    kotak.append(atas, jalur);
    if (b.catatan) {
      const ct = document.createElement('div');
      ct.className = 'kecil samar';
      ct.style.marginTop = '3px';
      ct.textContent = b.catatan;
      kotak.append(ct);
    }
    wadah.append(kotak);
  }
  return wadah;
}

/** Cincin (donut) dengan legenda dan nilai tengah. */
export function grafikCincin({ bagian, tengahLabel, tengahNilai, ukuran = 190 }) {
  const wadah = document.createElement('div');
  const total = bagian.reduce((a, b) => a + (Number(b.nilai) || 0), 0);
  if (!total) {
    wadah.className = 'kosong';
    wadah.textContent = 'Belum ada data untuk ditampilkan';
    return wadah;
  }
  const c = tinta();
  const palet = SERI();
  const R = 70;
  const r = 46;
  const cx = 90;
  const cy = 90;
  const svg = s('svg', { viewBox: '0 0 180 180', width: ukuran, height: ukuran, role: 'img' });
  let sudut = -Math.PI / 2;
  bagian.forEach((b, i) => {
    const porsi = (Number(b.nilai) || 0) / total;
    if (porsi <= 0) return;
    // Celah 2px antar irisan sebagai pemisah permukaan
    const celah = total > 0 && bagian.length > 1 ? 0.02 : 0;
    const akhir = sudut + porsi * Math.PI * 2 - celah;
    const besar = porsi > 0.5 ? 1 : 0;
    const p = (rad, radius) => [cx + Math.cos(rad) * radius, cy + Math.sin(rad) * radius];
    const [x1, y1] = p(sudut, R);
    const [x2, y2] = p(akhir, R);
    const [x3, y3] = p(akhir, r);
    const [x4, y4] = p(sudut, r);
    svg.append(s('path', {
      d: `M${x1},${y1} A${R},${R} 0 ${besar} 1 ${x2},${y2} L${x3},${y3} A${r},${r} 0 ${besar} 0 ${x4},${y4} Z`,
      fill: b.warna || palet[i % palet.length],
    }));
    sudut = akhir + celah;
  });
  if (tengahNilai !== undefined) {
    // Lubang cincin selebar ±92 satuan; nilai panjang diperkecil supaya muat.
    const ukuranTeks = Math.min(17, 80 / (Math.max(1, String(tengahNilai).length) * 0.56));
    svg.append(s('text', { x: cx, y: cy - 2, 'text-anchor': 'middle', 'font-size': ukuranTeks.toFixed(1),
      'font-weight': 700, fill: c.teks, style: 'font-family:var(--mono)' }, tengahNilai));
    svg.append(s('text', { x: cx, y: cy + 15, 'text-anchor': 'middle', 'font-size': 10.5,
      fill: c.lembut }, tengahLabel || ''));
  }
  const bungkus = document.createElement('div');
  Object.assign(bungkus.style, { display: 'flex', gap: '18px', alignItems: 'center', flexWrap: 'wrap' });
  bungkus.append(svg);

  // Legenda dengan nilai - identitas tidak bergantung pada warna semata
  const lg = document.createElement('div');
  lg.style.flex = '1 1 190px';
  lg.style.minWidth = '170px';
  bagian.forEach((b, i) => {
    if (!(Number(b.nilai) > 0)) return;
    const baris = document.createElement('div');
    Object.assign(baris.style, { display: 'flex', alignItems: 'center', gap: '8px',
      fontSize: '12.5px', marginBottom: '6px' });
    const kotak = document.createElement('i');
    Object.assign(kotak.style, { width: '11px', height: '11px', borderRadius: '3px',
      background: b.warna || palet[i % palet.length], flex: 'none' });
    const nama = document.createElement('span');
    nama.textContent = b.label;
    nama.style.color = 'var(--teks-lembut)';
    const nilai = document.createElement('strong');
    nilai.style.marginLeft = 'auto';
    nilai.style.whiteSpace = 'nowrap';
    nilai.textContent = `${((b.nilai / total) * 100).toFixed(1)}%`;
    baris.append(kotak, nama, nilai);
    lg.append(baris);
  });
  bungkus.append(lg);
  wadah.append(bungkus);
  return wadah;
}

function legenda(nama, warna) {
  const lg = document.createElement('div');
  lg.className = 'legenda';
  nama.forEach((n, i) => {
    const sp = document.createElement('span');
    const ik = document.createElement('i');
    ik.style.background = warna[i % warna.length];
    sp.append(ik, document.createTextNode(n));
    lg.append(sp);
  });
  return lg;
}
