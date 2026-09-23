/**
 * Ekspor dokumen ke Excel (.xlsx) dan Word (.docx) tanpa pustaka eksternal.
 *
 * Kedua format adalah arsip ZIP berisi XML (Office Open XML), jadi cukup
 * disusun dengan zlib bawaan Node. Masukannya "model dokumen" yang sama
 * dengan yang dipakai pratinjau & cetak PDF di peramban:
 *
 *   {
 *     judul, subjudul, keterangan: [teks filter...], orientasi: 'portrait'|'landscape',
 *     ringkasan: [{ label, nilai, tipe }],
 *     bagian: [{ judul?, kolom: [{ kunci, label, tipe }], baris: [...], total? }],
 *     catatan?, jenis_ttd
 *   }
 *
 * tipe kolom: teks | angka | uang | tanggal | persen
 */
import { deflateRawSync, crc32 } from 'node:zlib';
import { profilKoperasi, tandaTangan, aktivasi } from './profil.js';

// ------------------------------- ZIP -------------------------------

function zip(berkas) {
  const lokal = [];
  const pusat = [];
  let offset = 0;
  for (const { nama, isi } of berkas) {
    const data = Buffer.isBuffer(isi) ? isi : Buffer.from(isi, 'utf8');
    const padat = deflateRawSync(data);
    const namaBuf = Buffer.from(nama, 'utf8');
    const crc = crc32(data) >>> 0;
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6);
    h.writeUInt16LE(8, 8); h.writeUInt16LE(0, 10); h.writeUInt16LE(0x21, 12);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(padat.length, 18); h.writeUInt32LE(data.length, 22);
    h.writeUInt16LE(namaBuf.length, 26); h.writeUInt16LE(0, 28);
    lokal.push(h, namaBuf, padat);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(8, 10); c.writeUInt16LE(0, 12); c.writeUInt16LE(0x21, 14);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(padat.length, 20); c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(namaBuf.length, 28); c.writeUInt16LE(0, 30); c.writeUInt16LE(0, 32);
    c.writeUInt16LE(0, 34); c.writeUInt16LE(0, 36); c.writeUInt32LE(0, 38); c.writeUInt32LE(offset, 42);
    pusat.push(c, namaBuf);
    offset += h.length + namaBuf.length + padat.length;
  }
  const pusatBuf = Buffer.concat(pusat);
  const akhir = Buffer.alloc(22);
  akhir.writeUInt32LE(0x06054b50, 0); akhir.writeUInt16LE(0, 4); akhir.writeUInt16LE(0, 6);
  akhir.writeUInt16LE(berkas.length, 8); akhir.writeUInt16LE(berkas.length, 10);
  akhir.writeUInt32LE(pusatBuf.length, 12); akhir.writeUInt32LE(offset, 16); akhir.writeUInt16LE(0, 20);
  return Buffer.concat([...lokal, pusatBuf, akhir]);
}

const xml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  // karakter kontrol tidak sah di XML
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

const ANGKA = new Set(['angka', 'uang', 'persen']);
const nf = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 });

/** Nilai sel sebagai teks (untuk Word & tampilan). */
export function teksSel(nilai, tipe) {
  if (nilai === null || nilai === undefined || nilai === '') return '';
  if (tipe === 'uang') return nf.format(Math.round(Number(nilai) || 0));
  if (tipe === 'angka') return nf.format(Number(nilai) || 0);
  if (tipe === 'persen') return `${nf.format(Number(nilai) || 0)}%`;
  if (tipe === 'tanggal') {
    const s = String(nilai).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : String(nilai);
  }
  return String(nilai);
}

function kopTeks(profil) {
  return [
    [profil.alamat, profil.kota, profil.kode_pos].filter(Boolean).join(', '),
    [profil.telepon && `Telp. ${profil.telepon}`, profil.email, profil.website].filter(Boolean).join(' · '),
    [profil.badan_hukum && `BH No. ${profil.badan_hukum}`, profil.npwp && `NPWP ${profil.npwp}`]
      .filter(Boolean).join(' · '),
  ].filter(Boolean);
}

// ------------------------------- XLSX -------------------------------

function kolomHuruf(i) {
  let s = '';
  let n = i + 1;
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/**
 * Gaya sel (indeks cellXfs pada styles.xml):
 * 0 biasa, 1 judul besar, 2 tebal, 3 kepala tabel, 4 teks berbingkai,
 * 5 angka berbingkai, 6 total teks, 7 total angka, 8 miring kecil
 */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0;[Red]-#,##0"/></numFmts>
<fonts count="4"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="14"/><name val="Arial"/></font>
<font><b/><sz val="10"/><name val="Arial"/></font><font><i/><sz val="9"/><color rgb="FF555555"/><name val="Arial"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF5"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FF999999"/></left><right style="thin"><color rgb="FF999999"/></right><top style="thin"><color rgb="FF999999"/></top><bottom style="thin"><color rgb="FF999999"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="9">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="164" fontId="2" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

/** Menyusun berkas .xlsx dari model dokumen. */
export function buatXlsx(dok, { pengguna = null } = {}) {
  const profil = profilKoperasi();
  const barisXml = [];
  const gabung = [];
  let r = 0;
  const lebarKolom = [];
  const maksKolom = Math.max(1, ...dok.bagian.map((b) => b.kolom.length), 2);

  const tulis = (sel, tinggi) => {
    r += 1;
    const isi = sel.map(({ v, s = 0, angka = false }, i) => {
      const ref = `${kolomHuruf(i)}${r}`;
      if (v === null || v === undefined || v === '') return `<c r="${ref}" s="${s}"/>`;
      if (angka && Number.isFinite(Number(v))) return `<c r="${ref}" s="${s}"><v>${Number(v)}</v></c>`;
      return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
    }).join('');
    barisXml.push(`<row r="${r}"${tinggi ? ` ht="${tinggi}" customHeight="1"` : ''}>${isi}</row>`);
  };
  const judulPenuh = (teks, s) => {
    tulis([{ v: teks, s }]);
    gabung.push(`A${r}:${kolomHuruf(maksKolom - 1)}${r}`);
  };

  judulPenuh(profil.nama, 1);
  for (const t of kopTeks(profil)) judulPenuh(t, 8);
  r += 1;
  judulPenuh(dok.judul, 2);
  if (dok.subjudul) judulPenuh(dok.subjudul, 0);
  for (const k of dok.keterangan || []) judulPenuh(k, 8);
  if (dok.ringkasan?.length) {
    r += 1;
    for (const x of dok.ringkasan) {
      tulis([{ v: x.label, s: 2 }, { v: ANGKA.has(x.tipe) ? x.nilai : teksSel(x.nilai, x.tipe), angka: ANGKA.has(x.tipe) }]);
    }
  }

  for (const b of dok.bagian) {
    r += 1;
    if (b.judul) tulis([{ v: b.judul, s: 2 }]);
    b.kolom.forEach((k, i) => {
      const panjang = Math.max(String(k.label).length, ...b.baris.slice(0, 200)
        .map((x) => teksSel(x[k.kunci], k.tipe).length));
      lebarKolom[i] = Math.min(60, Math.max(lebarKolom[i] || 8, panjang + 2));
    });
    tulis(b.kolom.map((k) => ({ v: k.label, s: 3 })), 22);
    for (const x of b.baris) {
      tulis(b.kolom.map((k) => (ANGKA.has(k.tipe)
        ? { v: x[k.kunci], s: 5, angka: true }
        : { v: teksSel(x[k.kunci], k.tipe), s: 4 })));
    }
    if (b.total) {
      tulis(b.kolom.map((k, i) => {
        const v = b.total[k.kunci];
        if (v === undefined || v === null) return { v: i === 0 ? (b.total._label || 'TOTAL') : '', s: 6 };
        return ANGKA.has(k.tipe) ? { v, s: 7, angka: true } : { v: teksSel(v, k.tipe), s: 6 };
      }));
    }
  }
  if (dok.catatan) { r += 1; judulPenuh(dok.catatan, 8); }

  // Blok tanda tangan
  const ttd = tandaTangan(dok.jenis_ttd || 'laporan', { pengguna });
  if (ttd.penanda.length) {
    r += 1;
    if (ttd.kota_tanggal) tulis([{ v: ttd.kota_tanggal, s: 0 }]);
    const langkah = Math.max(1, Math.floor(maksKolom / ttd.penanda.length));
    const pos = ttd.penanda.map((_, i) => i * langkah);
    const baris = (f, s = 0) => {
      const sel = Array.from({ length: maksKolom }, () => ({ v: '' }));
      ttd.penanda.forEach((p, i) => { sel[pos[i]] = { v: f(p), s }; });
      tulis(sel);
    };
    baris((p) => p.label, 0);
    baris((p) => p.jabatan, 2);
    r += 3;
    baris((p) => (p.nama ? p.nama : '(................................)'), 2);
  }
  const akt = aktivasi();
  r += 1;
  judulPenuh(`Dicetak ${new Date().toLocaleString('id-ID')}${pengguna ? ` oleh ${pengguna.nama || pengguna.username}` : ''}`
    + (akt.nomor ? ` · Lisensi ${akt.nomor}` : ''), 8);

  const cols = lebarKolom.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>
${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${barisXml.join('')}</sheetData>
${gabung.length ? `<mergeCells count="${gabung.length}">${gabung.map((g) => `<mergeCell ref="${g}"/>`).join('')}</mergeCells>` : ''}
<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>
<pageSetup paperSize="9" orientation="${dok.orientasi === 'landscape' ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
  const namaSheet = xml(String(dok.judul || 'Laporan').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
  return zip([
    { nama: '[Content_Types].xml', isi: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>` },
    { nama: '_rels/.rels', isi: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>` },
    { nama: 'xl/workbook.xml', isi: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${namaSheet || 'Laporan'}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { nama: 'xl/_rels/workbook.xml.rels', isi: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>` },
    { nama: 'xl/styles.xml', isi: STYLES },
    { nama: 'xl/worksheets/sheet1.xml', isi: sheet },
  ]);
}

// ------------------------------- DOCX -------------------------------

/** Membaca data URI gambar logo menjadi { buf, ext, w, h }. */
function bacaLogo(dataUri) {
  const m = /^data:image\/(png|jpeg|jpg);base64,(.+)$/i.exec(String(dataUri || ''));
  if (!m) return null;
  const buf = Buffer.from(m[2], 'base64');
  const ext = m[1].toLowerCase() === 'png' ? 'png' : 'jpeg';
  let w = 0;
  let h = 0;
  if (ext === 'png' && buf.length > 24) { w = buf.readUInt32BE(16); h = buf.readUInt32BE(20); }
  if (ext === 'jpeg') {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xFF) { i += 1; continue; }
      const penanda = buf[i + 1];
      const pjg = buf.readUInt16BE(i + 2);
      if (penanda >= 0xC0 && penanda <= 0xC3) { h = buf.readUInt16BE(i + 5); w = buf.readUInt16BE(i + 7); break; }
      i += 2 + pjg;
    }
  }
  if (!w || !h) return null;
  return { buf, ext, w, h };
}

const para = (teks, { tebal = false, ukuran = 20, rata = 'left', miring = false, spasiSetelah = 60 } = {}) =>
  `<w:p><w:pPr><w:spacing w:after="${spasiSetelah}"/><w:jc w:val="${rata}"/></w:pPr>`
  + `<w:r><w:rPr>${tebal ? '<w:b/>' : ''}${miring ? '<w:i/>' : ''}<w:sz w:val="${ukuran}"/></w:rPr>`
  + `<w:t xml:space="preserve">${xml(teks)}</w:t></w:r></w:p>`;

function selDocx(teks, { tebal = false, rata = 'left', latar = null, lebar } = {}) {
  return `<w:tc><w:tcPr>${lebar ? `<w:tcW w:w="${lebar}" w:type="dxa"/>` : ''}${latar ? `<w:shd w:val="clear" w:color="auto" w:fill="${latar}"/>` : ''}</w:tcPr>`
    + `<w:p><w:pPr><w:spacing w:after="0"/><w:jc w:val="${rata}"/></w:pPr><w:r><w:rPr>${tebal ? '<w:b/>' : ''}<w:sz w:val="17"/></w:rPr>`
    + `<w:t xml:space="preserve">${xml(teks)}</w:t></w:r></w:p></w:tc>`;
}

const BINGKAI = '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
  .map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="999999"/>`).join('') + '</w:tblBorders>';

/** Menyusun berkas .docx dari model dokumen. */
export function buatDocx(dok, { pengguna = null } = {}) {
  const profil = profilKoperasi();
  const lanskap = dok.orientasi === 'landscape';
  const lebarHalaman = lanskap ? 16838 : 11906;
  const tinggiHalaman = lanskap ? 11906 : 16838;
  const margin = 850;
  const lebarIsi = lebarHalaman - margin * 2;
  const logo = bacaLogo(profil.logo);
  const isi = [];

  // Kop surat: logo di kiri, identitas di kanan
  const kop = [para(profil.nama, { tebal: true, ukuran: 30, spasiSetelah: 20 }),
    ...kopTeks(profil).map((t) => para(t, { ukuran: 16, spasiSetelah: 0 }))].join('');
  if (logo) {
    const cx = 900000;
    const cy = Math.round(cx * (logo.h / logo.w));
    const gambar = `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">
<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="1" name="Logo"/>
<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="logo.${logo.ext}"/><pic:cNvPicPr/></pic:nvPicPr>
<pic:blipFill><a:blip r:embed="rIdLogo"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>
</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
    isi.push(`<w:tbl><w:tblPr><w:tblW w:w="${lebarIsi}" w:type="dxa"/><w:tblBorders><w:bottom w:val="double" w:sz="6" w:space="0" w:color="333333"/></w:tblBorders></w:tblPr>`
      + `<w:tr><w:tc><w:tcPr><w:tcW w:w="1600" w:type="dxa"/></w:tcPr>${gambar}</w:tc>`
      + `<w:tc><w:tcPr><w:tcW w:w="${lebarIsi - 1600}" w:type="dxa"/></w:tcPr>${kop}</w:tc></w:tr></w:tbl>`);
  } else {
    isi.push(kop, `<w:p><w:pPr><w:pBdr><w:bottom w:val="double" w:sz="6" w:space="1" w:color="333333"/></w:pBdr></w:pPr></w:p>`);
  }

  isi.push(para('', { spasiSetelah: 0 }));
  isi.push(para(String(dok.judul || '').toUpperCase(), { tebal: true, ukuran: 26, rata: 'center', spasiSetelah: 20 }));
  if (dok.subjudul) isi.push(para(dok.subjudul, { rata: 'center', ukuran: 18, spasiSetelah: 20 }));
  for (const k of dok.keterangan || []) isi.push(para(k, { rata: 'center', ukuran: 16, miring: true, spasiSetelah: 0 }));

  if (dok.ringkasan?.length) {
    isi.push(para(''));
    isi.push(`<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>${dok.ringkasan.map((x) => `<w:tr>${selDocx(x.label, { tebal: true, lebar: 3500 })}${selDocx(': ' + teksSel(x.nilai, x.tipe), { lebar: 5000 })}</w:tr>`).join('')}</w:tbl>`);
  }

  for (const b of dok.bagian) {
    isi.push(para(''));
    if (b.judul) isi.push(para(b.judul, { tebal: true, ukuran: 20 }));
    const lebar = Math.floor(lebarIsi / Math.max(1, b.kolom.length));
    const kepala = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${b.kolom.map((k) => selDocx(k.label, { tebal: true, rata: 'center', latar: 'E8EEF5', lebar })).join('')}</w:tr>`;
    const badan = b.baris.map((x) => `<w:tr>${b.kolom.map((k) => selDocx(teksSel(x[k.kunci], k.tipe),
      { rata: ANGKA.has(k.tipe) ? 'right' : 'left', lebar })).join('')}</w:tr>`).join('');
    const total = b.total ? `<w:tr>${b.kolom.map((k, i) => {
      const v = b.total[k.kunci];
      const t = v === undefined || v === null ? (i === 0 ? (b.total._label || 'TOTAL') : '') : teksSel(v, k.tipe);
      return selDocx(t, { tebal: true, latar: 'E8EEF5', rata: ANGKA.has(k.tipe) ? 'right' : 'left', lebar });
    }).join('')}</w:tr>` : '';
    isi.push(`<w:tbl><w:tblPr><w:tblW w:w="${lebarIsi}" w:type="dxa"/>${BINGKAI}<w:tblLayout w:type="fixed"/></w:tblPr>`
      + `<w:tblGrid>${b.kolom.map(() => `<w:gridCol w:w="${lebar}"/>`).join('')}</w:tblGrid>${kepala}${badan}${total}</w:tbl>`);
    if (!b.baris.length) isi.push(para('Tidak ada data untuk filter yang dipilih.', { miring: true, ukuran: 16 }));
  }
  if (dok.catatan) isi.push(para(''), para(dok.catatan, { miring: true, ukuran: 16 }));

  const ttd = tandaTangan(dok.jenis_ttd || 'laporan', { pengguna });
  if (ttd.penanda.length) {
    isi.push(para(''));
    if (ttd.kota_tanggal) isi.push(para(ttd.kota_tanggal, { rata: 'right', ukuran: 18 }));
    const lebar = Math.floor(lebarIsi / ttd.penanda.length);
    const sel = (p) => `<w:tc><w:tcPr><w:tcW w:w="${lebar}" w:type="dxa"/></w:tcPr>`
      + para(p.label, { rata: 'center', ukuran: 18, spasiSetelah: 0 })
      + para(p.jabatan, { rata: 'center', ukuran: 18, tebal: true, spasiSetelah: 900 })
      + para(p.nama || '(................................)', { rata: 'center', ukuran: 18, tebal: true, spasiSetelah: 0 })
      + '</w:tc>';
    isi.push(`<w:tbl><w:tblPr><w:tblW w:w="${lebarIsi}" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tr><w:trPr><w:cantSplit/></w:trPr>${ttd.penanda.map(sel).join('')}</w:tr></w:tbl>`);
  }
  const akt = aktivasi();
  isi.push(para(''), para(`Dicetak ${new Date().toLocaleString('id-ID')}${pengguna ? ` oleh ${pengguna.nama || pengguna.username}` : ''}`
    + (akt.nomor ? ` · Lisensi ${akt.nomor}` : ''), { miring: true, ukuran: 14 }));

  const dokumen = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
<w:body>${isi.join('')}
<w:sectPr><w:pgSz w:w="${lebarHalaman}" w:h="${tinggiHalaman}"${lanskap ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="${margin}" w:right="${margin}" w:bottom="${margin}" w:left="${margin}" w:header="400" w:footer="400" w:gutter="0"/></w:sectPr>
</w:body></w:document>`;

  const berkas = [
    { nama: '[Content_Types].xml', isi: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Default Extension="jpeg" ContentType="image/jpeg"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>` },
    { nama: '_rels/.rels', isi: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>` },
    { nama: 'word/_rels/document.xml.rels', isi: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${logo ? `<Relationship Id="rIdLogo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.${logo.ext}"/>` : ''}
</Relationships>` },
    { nama: 'word/document.xml', isi: dokumen },
  ];
  if (logo) berkas.push({ nama: `word/media/logo.${logo.ext}`, isi: logo.buf });
  return zip(berkas);
}

/** Nama berkas aman dari judul dokumen. */
export function namaBerkas(judul, ext) {
  const dasar = String(judul || 'laporan').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  return `${dasar || 'laporan'}-${new Date().toISOString().slice(0, 10)}.${ext}`;
}

export const MIME = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
