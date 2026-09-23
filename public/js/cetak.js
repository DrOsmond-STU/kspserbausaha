/**
 * Cetakan seragam: kop surat (logo & identitas koperasi), isi, blok tanda
 * tangan, dan catatan kaki. Dipakai seluruh bukti transaksi dan laporan.
 *
 * PDF dibuat lewat dialog cetak peramban (tujuan "Simpan sebagai PDF"),
 * sedangkan Excel & Word disusun server dari model dokumen yang sama.
 *
 * Model dokumen:
 *   {
 *     judul, subjudul?, nomor?, keterangan?: [teks], orientasi?: 'portrait'|'landscape',
 *     ukuran?: 'A4'|'A5'|'struk', jenis_ttd: 'bukti_kas_masuk'|...,
 *     ringkasan?: [{ label, nilai, tipe? }],           // pasangan isian di atas tabel
 *     bagian?: [{ judul?, kolom: [{ kunci, label, tipe? }], baris: [], total? }],
 *     isi?: Node | string(HTML)                         // isi bebas, bila bukan tabel
 *     terbilang?: string, catatan?: string,
 *     penanda_tambahan?: { <label>: nama }              // mengisi nama kolom ttd tertentu (mis. nama anggota)
 *   }
 */
import { api, el, toast, galat } from './inti.js';
import { negara } from './app.js';

let cache = null;

/** Kop, aktivasi, dan tanda tangan (disimpan sementara; segarkan sesudah Setup Koperasi diubah). */
export async function dataCetak(paksa = false) {
  if (!cache || paksa) cache = await api.get('/api/cetak/profil');
  return cache;
}
export const segarkanDataCetak = () => { cache = null; };

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');
const nf = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 });
const ANGKA = new Set(['angka', 'uang', 'persen']);

export function teksSel(v, tipe) {
  if (v === null || v === undefined || v === '') return '';
  if (tipe === 'uang') return nf.format(Math.round(Number(v) || 0));
  if (tipe === 'angka') return nf.format(Number(v) || 0);
  if (tipe === 'persen') return `${nf.format(Number(v) || 0)}%`;
  if (tipe === 'tanggal') {
    const s = String(v).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : String(v);
  }
  return String(v);
}

const GAYA = `
*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0;font-size:11px}
.halaman{padding:18px 22px}
.kop{display:flex;align-items:center;gap:14px;border-bottom:3px double #333;padding-bottom:8px;margin-bottom:12px}
.kop img{max-height:64px;max-width:90px;object-fit:contain}
.kop .nama{font-size:17px;font-weight:700;text-transform:uppercase}
.kop .baris{font-size:10px;color:#333;line-height:1.35}
h1{font-size:14px;text-align:center;margin:6px 0 2px;text-transform:uppercase;letter-spacing:.3px}
.sub{text-align:center;font-size:11px;margin-bottom:2px}.ket{text-align:center;font-size:10px;font-style:italic;color:#444}
.nomor{text-align:center;font-size:11px;margin-bottom:6px}
.ringkas{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:3px 24px;margin:10px 0}
.ringkas div{display:flex;gap:6px}.ringkas b{min-width:130px;font-weight:600}
table{width:100%;border-collapse:collapse;margin:6px 0 10px;page-break-inside:auto}
th,td{border:1px solid #888;padding:3px 5px;vertical-align:top}
th{background:#e8eef5;font-weight:700;text-align:center}
td.a{text-align:right;white-space:nowrap}tr.t td{font-weight:700;background:#e8eef5}
thead{display:table-header-group}tr{page-break-inside:avoid}
h2{font-size:12px;margin:12px 0 2px}
.terbilang{font-style:italic;margin:4px 0 8px;padding:4px 6px;border:1px dashed #999}
.catatan{font-size:10px;color:#333;margin-top:6px}
.ttd{margin-top:18px;page-break-inside:avoid}.ttd .tgl{text-align:right;margin-bottom:6px}
.ttd .kol{display:flex;justify-content:space-around;gap:10px}
.ttd .p{text-align:center;flex:1}.ttd .jab{font-weight:700}.ttd .spasi{height:58px}
.ttd .nm{font-weight:700;text-decoration:underline}
.kaki{margin-top:14px;font-size:9px;color:#666;border-top:1px solid #ccc;padding-top:4px}
.struk{width:76mm;font-size:10px}.struk .kop{flex-direction:column;text-align:center;gap:2px}
.struk .kop .nama{font-size:13px}.struk th,.struk td{border:none;border-bottom:1px dashed #999;padding:2px}
@media print{.halaman{padding:0}.tanpa-cetak{display:none}}
`;

function htmlKop(profil) {
  const baris = [
    [profil.alamat, profil.kota, profil.kode_pos].filter(Boolean).join(', '),
    [profil.telepon && `Telp. ${profil.telepon}`, profil.email, profil.website].filter(Boolean).join(' · '),
    [profil.badan_hukum && `Badan Hukum No. ${profil.badan_hukum}`, profil.npwp && `NPWP ${profil.npwp}`]
      .filter(Boolean).join(' · '),
  ].filter(Boolean);
  return `<div class="kop">${profil.logo ? `<img src="${esc(profil.logo)}" alt="Logo">` : ''}
    <div><div class="nama">${esc(profil.nama)}</div>${baris.map((b) => `<div class="baris">${esc(b)}</div>`).join('')}</div></div>`;
}

function htmlTabel(b) {
  const kepala = `<thead><tr>${b.kolom.map((k) => `<th>${esc(k.label)}</th>`).join('')}</tr></thead>`;
  const badan = b.baris.map((r) => `<tr>${b.kolom.map((k) =>
    `<td${ANGKA.has(k.tipe) ? ' class="a"' : ''}>${esc(teksSel(r[k.kunci], k.tipe))}</td>`).join('')}</tr>`).join('');
  const total = b.total ? `<tr class="t">${b.kolom.map((k, i) => {
    const v = b.total[k.kunci];
    const t = v === undefined || v === null ? (i === 0 ? (b.total._label || 'TOTAL') : '') : teksSel(v, k.tipe);
    return `<td${ANGKA.has(k.tipe) ? ' class="a"' : ''}>${esc(t)}</td>`;
  }).join('')}</tr>` : '';
  const kosong = b.baris.length ? '' : `<tr><td colspan="${b.kolom.length}" style="text-align:center;font-style:italic">Tidak ada data</td></tr>`;
  return `${b.judul ? `<h2>${esc(b.judul)}</h2>` : ''}<table>${kepala}<tbody>${badan}${kosong}${total}</tbody></table>`;
}

/** Blok tanda tangan sesuai pengaturan jenis cetakan. */
export function htmlTtd(ttd, tambahan = {}) {
  if (!ttd || !ttd.penanda?.length) return '';
  return `<div class="ttd">${ttd.kota_tanggal ? `<div class="tgl">${esc(ttd.kota_tanggal)}</div>` : ''}
    <div class="kol">${ttd.penanda.map((p) => {
    const nama = tambahan[p.label] || tambahan[p.jabatan] || p.nama;
    return `<div class="p"><div>${esc(p.label)}</div><div class="jab">${esc(p.jabatan)}</div><div class="spasi"></div>
      <div class="nm">${nama ? esc(nama) : '(................................)'}</div></div>`;
  }).join('')}</div></div>`;
}

/** HTML lengkap sebuah dokumen cetak. */
export async function htmlDokumen(dok) {
  const d = await dataCetak();
  const ttd = d.ttd[dok.jenis_ttd] || d.ttd.default;
  let isiBebas = '';
  if (dok.isi instanceof Node) isiBebas = dok.isi.outerHTML;
  else if (typeof dok.isi === 'string') isiBebas = dok.isi;
  const pengguna = negara.user ? (negara.user.nama || negara.user.username) : '';
  const struk = dok.ukuran === 'struk';
  const orientasi = dok.orientasi === 'landscape' ? 'landscape' : 'portrait';
  const kertas = struk ? '80mm auto' : `${dok.ukuran === 'A5' ? 'A5' : 'A4'} ${orientasi}`;
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>${esc(dok.judul)}${dok.nomor ? ` ${esc(dok.nomor)}` : ''}</title>
<style>${GAYA}@page{size:${kertas};margin:${struk ? '4mm' : '12mm'}}</style></head>
<body><div class="halaman${struk ? ' struk' : ''}">
${htmlKop(d.profil)}
<h1>${esc(dok.judul)}</h1>
${dok.nomor ? `<div class="nomor">Nomor: <b>${esc(dok.nomor)}</b></div>` : ''}
${dok.subjudul ? `<div class="sub">${esc(dok.subjudul)}</div>` : ''}
${(dok.keterangan || []).map((k) => `<div class="ket">${esc(k)}</div>`).join('')}
${dok.ringkasan?.length ? `<div class="ringkas">${dok.ringkasan.map((x) =>
    `<div><b>${esc(x.label)}</b><span>: ${esc(teksSel(x.nilai, x.tipe))}</span></div>`).join('')}</div>` : ''}
${isiBebas}
${(dok.bagian || []).map(htmlTabel).join('')}
${dok.terbilang ? `<div class="terbilang">Terbilang: ${esc(dok.terbilang)}</div>` : ''}
${dok.catatan ? `<div class="catatan">${esc(dok.catatan)}</div>` : ''}
${htmlTtd(ttd, dok.penanda_tambahan || {})}
<div class="kaki">Dicetak ${esc(new Date().toLocaleString('id-ID'))}${pengguna ? ` oleh ${esc(pengguna)}` : ''}${d.aktivasi?.nomor
    ? ` · Lisensi ${esc(d.aktivasi.nomor)}` : ' · Aplikasi belum diaktivasi'}</div>
</div></body></html>`;
}

/** Membuka jendela cetak (pengguna dapat memilih printer atau "Simpan sebagai PDF"). */
export async function cetakDokumen(dok) {
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) {
    toast('Jendela cetak diblokir peramban', 'peringatan', 'Izinkan pop-up untuk situs ini lalu coba lagi.');
    return;
  }
  try {
    w.document.open();
    w.document.write(await htmlDokumen(dok));
    w.document.close();
    const cetak = () => { w.focus(); w.print(); };
    const gambar = [...w.document.images];
    if (gambar.every((g) => g.complete)) setTimeout(cetak, 150);
    else Promise.all(gambar.map((g) => new Promise((r) => { g.onload = r; g.onerror = r; }))).then(cetak);
  } catch (err) {
    w.close();
    galat(err);
  }
}

function simpanBlob(blob, nama) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: nama });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function unduh(res) {
  if (!res.ok) {
    let isi = null;
    try { isi = await res.json(); } catch { /* bukan JSON */ }
    const err = new Error(isi?.pesan || `Unduhan gagal (${res.status})`);
    err.detail = isi?.detail || null;
    throw err;
  }
  const cd = res.headers.get('Content-Disposition') || '';
  const nama = /filename="([^"]+)"/.exec(cd)?.[1] || 'dokumen';
  simpanBlob(await res.blob(), nama);
}

/** Unduh model dokumen sebagai Excel (xlsx) atau Word (docx). Isi bebas (dok.isi) tidak ikut. */
export async function unduhDokumen(dok, format) {
  const { isi, ...model } = dok;
  const res = await fetch('/api/cetak/ekspor', {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ format, dokumen: model }),
  });
  await unduh(res);
}

/** Unduh berkas dari URL GET (mis. /api/pusat-laporan/<kode>/unduh?...). */
export async function unduhUrl(url) {
  await unduh(await fetch(url, { credentials: 'same-origin' }));
}

/**
 * Tombol Cetak/PDF + Excel + Word untuk sebuah dokumen.
 * @param {() => object|Promise<object>} ambil fungsi yang mengembalikan model dokumen terkini
 */
export function tombolCetak(ambil, { excel = true, word = true, label = 'Cetak / PDF' } = {}) {
  const jalankan = (fn) => async (e) => {
    const tombol = e.currentTarget;
    tombol.disabled = true;
    try { await fn(await ambil()); } catch (err) { galat(err); } finally { tombol.disabled = false; }
  };
  return el('div.aksi-cetak', { gaya: { display: 'inline-flex', gap: '6px', flexWrap: 'wrap' } }, [
    el('button.btn', { type: 'button', onclick: jalankan(cetakDokumen) }, label),
    excel && el('button.btn', { type: 'button', onclick: jalankan((d) => unduhDokumen(d, 'xlsx')) }, 'Excel'),
    word && el('button.btn', { type: 'button', onclick: jalankan((d) => unduhDokumen(d, 'docx')) }, 'Word'),
  ].filter(Boolean));
}
