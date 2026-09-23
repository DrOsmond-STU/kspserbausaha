/**
 * Pusat Laporan - katalog seluruh laporan lintas modul.
 *
 * Alur: pilih laporan → isi filter (rentang tanggal dan/atau rentang data) →
 * Tampilkan (pratinjau di layar) → Cetak / PDF, Excel, atau Word.
 * Formulir filter disusun otomatis dari spesifikasi filter yang dikirim
 * server; katalog juga sudah disaring server menurut izin pengguna.
 */
import { api, el, kosongkan, memuat, kosong, galat, toast, angka, halamankan } from '../inti.js';
import { cetakDokumen, unduhUrl, teksSel } from '../cetak.js';

const ANGKA = new Set(['angka', 'uang', 'persen']);
const KUNCI_SIMPAN = 'ecms-pusat-laporan';

// --------------------------- Penyimpanan sesi ---------------------------

function bacaSesi(kunci) {
  try { return JSON.parse(sessionStorage.getItem(`${KUNCI_SIMPAN}:${kunci}`) || 'null'); } catch { return null; }
}
function tulisSesi(kunci, nilai) {
  try { sessionStorage.setItem(`${KUNCI_SIMPAN}:${kunci}`, JSON.stringify(nilai)); } catch { /* penyimpanan tidak tersedia */ }
}

// ------------------------------ Tanggal ------------------------------

/** Tanggal lokal YYYY-MM-DD (bukan UTC, supaya "hari ini" tidak mundur sehari). */
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const PRESET = [
  { teks: 'Hari ini', rentang: (k) => [k, k] },
  { teks: 'Bulan ini', rentang: (k) => [new Date(k.getFullYear(), k.getMonth(), 1), new Date(k.getFullYear(), k.getMonth() + 1, 0)] },
  { teks: 'Bulan lalu', rentang: (k) => [new Date(k.getFullYear(), k.getMonth() - 1, 1), new Date(k.getFullYear(), k.getMonth(), 0)] },
  { teks: 'Tahun ini', rentang: (k) => [new Date(k.getFullYear(), 0, 1), new Date(k.getFullYear(), 11, 31)] },
  { teks: 'Tahun lalu', rentang: (k) => [new Date(k.getFullYear() - 1, 0, 1), new Date(k.getFullYear() - 1, 11, 31)] },
];

// ------------------------------ Halaman ------------------------------

export async function render(param = []) {
  const katalog = await api.get('/api/pusat-laporan');
  const daftar = katalog.data || [];
  const wadah = el('div.pl-tata');

  if (!daftar.length) {
    wadah.classList.add('tunggal');
    wadah.append(el('div.panel', [el('div.panel-isi', [kosong('Belum ada laporan yang dapat Anda akses',
      'Hubungi administrator bila Anda memerlukan hak akses laporan tertentu.', 'laporan')])]));
    return wadah;
  }

  const kerja = el('div.pl-kerja');
  let aktif = null;
  const tombolLaporan = new Map();

  // ---- Katalog kiri: pencarian + daftar per kelompok ----
  const cari = el('input', { type: 'search', placeholder: 'Cari laporan…', 'aria-label': 'Cari laporan' });
  const daftarKatalog = el('div.pl-katalog');
  const namaKelompok = Object.fromEntries((katalog.kelompok || []).map((k) => [k.kode, k.nama]));
  const urutanKelompok = [...(katalog.kelompok || []).map((k) => k.kode),
    ...new Set(daftar.map((l) => l.kelompok).filter((k) => !namaKelompok[k]))];

  function gambarKatalog() {
    const q = cari.value.trim().toLowerCase();
    kosongkan(daftarKatalog);
    tombolLaporan.clear();
    let ada = 0;
    for (const kode of urutanKelompok) {
      const isi = daftar.filter((l) => l.kelompok === kode && (!q
        || `${l.judul} ${l.deskripsi} ${l.kode}`.toLowerCase().includes(q)));
      if (!isi.length) continue;
      ada += isi.length;
      daftarKatalog.append(el('div.pl-grup', [
        el('div.pl-grup-judul', [el('span', namaKelompok[kode] || kode), el('span.samar', String(isi.length))]),
        ...isi.map((l) => {
          const b = el('button.pl-item', { type: 'button', class: aktif?.kode === l.kode ? 'aktif' : '',
            title: l.deskripsi || l.judul, onclick: () => pilihLaporan(l) }, [
            el('span.judul', l.judul),
            l.deskripsi && el('span.desk', l.deskripsi),
          ]);
          tombolLaporan.set(l.kode, b);
          return b;
        }),
      ]));
    }
    if (!ada) daftarKatalog.append(el('div.kecil.samar', { gaya: { padding: '14px 4px' } }, 'Tidak ada laporan yang cocok.'));
  }
  cari.addEventListener('input', gambarKatalog);

  function pilihLaporan(l) {
    aktif = l;
    for (const [k, b] of tombolLaporan) b.classList.toggle('aktif', k === l.kode);
    tulisSesi('terakhir', l.kode);
    try { history.replaceState(null, '', `#/pusat-laporan/${encodeURIComponent(l.kode)}`); } catch { /* abaikan */ }
    kosongkan(kerja).append(halamanLaporan(l));
  }

  wadah.append(
    el('div.panel.pl-kiri', [
      el('div.panel-kepala', [el('h3', `Katalog Laporan (${daftar.length})`)]),
      el('div.panel-isi', [cari, daftarKatalog]),
    ]),
    kerja,
  );
  gambarKatalog();

  const awal = daftar.find((l) => l.kode === decodeURIComponent(param[0] || ''))
    || daftar.find((l) => l.kode === bacaSesi('terakhir'));
  if (awal) pilihLaporan(awal);
  else {
    kerja.append(el('div.panel', [el('div.panel-isi', [kosong('Pilih laporan dari katalog',
      'Setiap laporan dapat disaring menurut rentang tanggal dan/atau rentang data, lalu dicetak ke PDF '
      + 'atau diunduh sebagai Excel dan Word.', 'laporan')])]));
  }
  return wadah;
}

// --------------------------- Satu laporan ---------------------------

/** Mengelompokkan filter berpasangan (dari/sampai, x_dari/x_sampai) menjadi satu baris rentang. */
function susunBaris(filter) {
  const baris = [];
  const terpakai = new Set();
  for (const f of filter) {
    if (terpakai.has(f.kunci)) continue;
    let pasangan = null;
    if (f.kunci === 'dari') pasangan = filter.find((x) => x.kunci === 'sampai');
    else if (f.kunci.endsWith('_dari')) pasangan = filter.find((x) => x.kunci === `${f.kunci.slice(0, -5)}_sampai`);
    if (pasangan) {
      terpakai.add(f.kunci).add(pasangan.kunci);
      baris.push({ rentang: true, dari: f, sampai: pasangan,
        label: f.label.replace(/\s+dari$/i, '') || f.label });
    } else if (!(f.kunci === 'sampai' || f.kunci.endsWith('_sampai'))
      || !filter.some((x) => x.kunci === (f.kunci === 'sampai' ? 'dari' : `${f.kunci.slice(0, -7)}_dari`))) {
      terpakai.add(f.kunci);
      baris.push({ rentang: false, f });
    }
  }
  return baris;
}

function isian(f, nilai) {
  const umum = { name: f.kunci, 'aria-label': f.label, required: f.wajib || null };
  if (f.tipe === 'pilih') {
    const opsi = (f.opsi || []).map((o) => el('option', { value: o.nilai, selected: String(o.nilai) === String(nilai ?? '') }, o.teks));
    return el('select', umum, [!f.wajib && el('option', { value: '', selected: !nilai }, 'Semua'), ...opsi]);
  }
  const tipe = { tanggal: 'date', bulan: 'month', angka: 'number' }[f.tipe] || 'text';
  return el('input', { ...umum, type: tipe, nilai: nilai ?? '', step: tipe === 'number' ? 'any' : null,
    class: tipe === 'number' ? 'angka' : null });
}

const labelIsian = (teks, wajib) => el('label', [teks, wajib && el('span.wajib', ' *')]);

function halamanLaporan(l) {
  const filter = l.filter || [];
  const simpanan = bacaSesi(`filter:${l.kode}`) || {};
  const nilaiAwal = (f) => (simpanan[f.kunci] !== undefined ? simpanan[f.kunci] : (f.bawaan ?? ''));

  const hasil = el('div');
  const pesan = el('div');
  const form = el('form.pl-filter', { onsubmit: (e) => { e.preventDefault(); tampilkan(); } });

  const baris = susunBaris(filter);
  for (const b of baris) {
    if (b.rentang) {
      form.append(el('div.kolom.pl-rentang', [
        labelIsian(b.label, b.dari.wajib || b.sampai.wajib),
        el('div.pl-rentang-isi', [isian(b.dari, nilaiAwal(b.dari)), el('span.samar', 's.d.'), isian(b.sampai, nilaiAwal(b.sampai))]),
      ]));
    } else {
      form.append(el('div.kolom', [labelIsian(b.f.label, b.f.wajib), isian(b.f, nilaiAwal(b.f))]));
    }
  }

  // Pilihan cepat periode untuk laporan yang memiliki filter tanggal dari–sampai
  const fDari = filter.find((f) => f.kunci === 'dari');
  const fSampai = filter.find((f) => f.kunci === 'sampai');
  const adaPeriode = fDari && fSampai && fDari.tipe === 'tanggal' && fSampai.tipe === 'tanggal';
  const preset = adaPeriode ? el('div.pl-preset', [
    el('span.kecil.samar', 'Periode cepat:'),
    ...PRESET.map((p) => el('button.btn.kecil', { type: 'button', onclick: () => {
      const [a, z] = p.rentang(new Date());
      form.querySelector('[name=dari]').value = iso(a);
      form.querySelector('[name=sampai]').value = iso(z);
    } }, p.teks)),
  ]) : null;

  const tombolTampil = el('button.btn.utama', { type: 'submit' }, 'Tampilkan');
  form.append(el('div.pl-aksi-filter', [
    tombolTampil,
    filter.length ? el('button.btn', { type: 'button', onclick: () => {
      for (const f of filter) {
        const n = form.querySelector(`[name="${f.kunci}"]`);
        if (n) n.value = f.bawaan ?? '';
      }
      tulisSesi(`filter:${l.kode}`, {});
    } }, 'Atur ulang') : null,
  ]));

  function bacaNilai() {
    const v = {};
    for (const f of filter) {
      const n = form.querySelector(`[name="${f.kunci}"]`);
      const x = n ? String(n.value).trim() : '';
      if (x !== '') v[f.kunci] = x;
    }
    return v;
  }

  function periksa(v) {
    for (const f of filter) {
      if (f.wajib && (v[f.kunci] === undefined || v[f.kunci] === '')) return `Filter "${f.label}" wajib diisi`;
    }
    for (const b of baris.filter((x) => x.rentang)) {
      const a = v[b.dari.kunci];
      const z = v[b.sampai.kunci];
      if (a === undefined || z === undefined) continue;
      const lebih = b.dari.tipe === 'angka' ? Number(a) > Number(z) : String(a) > String(z);
      if (lebih) return `${b.label}: nilai awal tidak boleh melebihi nilai akhir`;
    }
    return null;
  }

  async function tampilkan() {
    const v = bacaNilai();
    kosongkan(pesan);
    const salah = periksa(v);
    if (salah) { pesan.append(el('div.notis.peringatan', [el('div.isi', salah)])); return; }
    tulisSesi(`filter:${l.kode}`, v);
    tombolTampil.disabled = true;
    kosongkan(hasil).append(el('div.panel', [memuat('Menyusun laporan…')]));
    try {
      const dok = await api.get(`/api/pusat-laporan/${encodeURIComponent(l.kode)}`, v);
      kosongkan(hasil).append(pratinjau(l, dok, new URLSearchParams(v).toString()));
      hasil.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      kosongkan(hasil);
      pesan.append(el('div.notis.bahaya', [el('div.isi', [el('strong', err.message), err.detail && el('div.kecil', err.detail)])]));
    } finally {
      tombolTampil.disabled = false;
    }
  }

  return el('div', [
    el('div.panel', [
      el('div.panel-kepala', [el('h3', l.judul), el('div.aksi', [el('span.lencana-status.st-netral',
        l.orientasi === 'landscape' ? 'Lanskap' : 'Potret')])]),
      el('div.panel-isi', [
        l.deskripsi && el('p.kecil.lembut.mt0', l.deskripsi),
        filter.length ? null : el('p.kecil.samar', 'Laporan ini tidak memiliki filter.'),
        preset,
        form,
        pesan,
      ]),
    ]),
    hasil,
  ]);
}

// ------------------------------ Pratinjau ------------------------------

/**
 * Satu bagian laporan sebagai tabel berhalaman. Hanya halaman aktif yang
 * digambar, sehingga laporan ribuan baris tetap ringan di layar; cetak dan
 * unduhan tetap memuat seluruh baris.
 */
function tabelBagian(b) {
  const kolom = b.kolom || [];
  const semua = b.baris || [];
  const kelas = (k) => (ANGKA.has(k.tipe) ? 'angka' : '');
  const total = b.total ? el('tfoot', [el('tr', kolom.map((k, i) => {
    const v = b.total[k.kunci];
    const t = v === undefined || v === null ? (i === 0 ? (b.total._label || 'TOTAL') : '') : teksSel(v, k.tipe);
    return el('td', { class: kelas(k) }, t);
  }))]) : null;
  const tbody = el('tbody');
  const tabel = el('table.tabel', [
    el('thead', [el('tr', kolom.map((k) => el('th', { class: kelas(k) }, k.label)))]),
    tbody,
    total,
  ]);
  const isi = semua.length
    ? halamankan(tabel, tbody, semua.length, (i) => el('tr', kolom.map((k) => el('td', { class: kelas(k) },
      teksSel(semua[i][k.kunci], k.tipe)))))
    : (tbody.append(el('tr', [el('td.tengah.samar', { colspan: kolom.length || 1 }, 'Tidak ada data')])), tabel);
  return el('div.pl-bagian', [
    b.judul && el('div.pl-bagian-judul', [el('span', b.judul), el('span.kecil.samar', `${angka(semua.length)} baris`)]),
    isi.classList.contains('tabel-berhalaman') ? isi : el('div.tabel-bungkus', [isi]),
  ]);
}

function pratinjau(l, dok, query) {
  const bagian = dok.bagian || [];
  const jumlah = bagian.reduce((s, b) => s + (b.baris?.length || 0), 0);
  const tabel = bagian.map((b) => tabelBagian(b));
  const jalur = `/api/pusat-laporan/${encodeURIComponent(l.kode)}/unduh?${query ? `${query}&` : ''}format=`;

  const unduh = (format) => async (e) => {
    const tombol = e.currentTarget;
    tombol.disabled = true;
    try {
      await unduhUrl(`${jalur}${format}`);
      toast(`Berkas ${format === 'xlsx' ? 'Excel' : 'Word'} diunduh`, 'sukses');
    } catch (err) { galat(err); } finally { tombol.disabled = false; }
  };

  return el('div.panel.pl-pratinjau', [
    el('div.panel-kepala', [
      el('h3', 'Pratinjau'),
      el('div.aksi', [
        el('span.kecil.samar', `${angka(jumlah)} baris`),
        el('button.btn.utama', { type: 'button', onclick: () => cetakDokumen(dok) }, 'Cetak / PDF'),
        el('button.btn', { type: 'button', onclick: unduh('xlsx') }, 'Excel'),
        el('button.btn', { type: 'button', onclick: unduh('docx') }, 'Word'),
      ]),
    ]),
    el('div.panel-isi', [
      el('div.pl-dok-kepala', [
        el('div.pl-dok-judul', dok.judul),
        dok.subjudul && el('div.pl-dok-sub', dok.subjudul),
        ...(dok.keterangan || []).map((k) => el('div.pl-dok-ket', k)),
      ]),
      dok.ringkasan?.length ? el('div.pl-ringkas', dok.ringkasan.map((x) => el('div', [
        el('span.samar', x.label), el('strong', teksSel(x.nilai, x.tipe) || '-'),
      ]))) : null,
      ...tabel,
      dok.catatan && el('div.kecil.lembut', { gaya: { marginTop: '10px', whiteSpace: 'pre-line' } }, dok.catatan),
    ]),
  ]);
}
