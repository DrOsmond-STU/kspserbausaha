/**
 * Pusat Laporan, cetakan, dan Setup Koperasi.
 *
 * - Katalog laporan seluruh modul dengan filter rentang tanggal / rentang data
 * - Pratinjau (JSON) dan unduhan Excel (.xlsx) / Word (.docx); PDF dicetak
 *   dari pratinjau di peramban (Cetak → Simpan sebagai PDF)
 * - Profil koperasi, logo, nomor aktivasi, dan tanda tangan setiap cetakan
 */
import { createRouter, badRequest, notFound, forbidden } from '../lib/http.js';
import { all, get, run, setting, setSetting, tx } from '../db.js';
import { can } from '../lib/rbac.js';
import { logAudit } from '../lib/audit.js';
import { oneOf, str } from '../lib/util.js';
import { LAPORAN, KELOMPOK } from '../laporan/index.js';
import { buatXlsx, buatDocx, namaBerkas, MIME } from '../lib/ekspor.js';
import {
  ISIAN_PROFIL, JENIS_CETAKAN, profilKoperasi, aktivasi, dataCetak, daftarKonfigTtd, konfigTtd,
} from '../lib/profil.js';

const router = createRouter();
const BATAS_BARIS = 50_000;

// ----------------------------- Katalog -----------------------------

const opsiFilter = (f) => (typeof f.opsi === 'function' ? f.opsi() : f.opsi || [])
  .map((o) => (typeof o === 'object' ? o : { nilai: o, teks: o }));

function definisi(kode, ctx) {
  const d = LAPORAN.find((l) => l.kode === kode);
  if (!d) throw notFound(`Laporan "${kode}" tidak ditemukan`);
  if (d.izin && !can(ctx.user.role, d.izin)) {
    throw forbidden(`Anda tidak memiliki hak akses untuk laporan ini (diperlukan izin "${d.izin}")`);
  }
  return d;
}

/** Membersihkan & memvalidasi nilai filter sesuai definisi laporan. */
function bacaFilter(d, query) {
  const f = {};
  for (const x of d.filter || []) {
    let v = query[x.kunci];
    v = v === undefined || v === null ? '' : String(v).trim();
    if (v === '') {
      if (x.bawaan !== undefined) f[x.kunci] = typeof x.bawaan === 'function' ? x.bawaan() : x.bawaan;
      else if (x.wajib) throw badRequest(`Filter "${x.label}" wajib diisi`);
      continue;
    }
    if (x.tipe === 'tanggal' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw badRequest(`Filter "${x.label}" harus berupa tanggal`);
    if (x.tipe === 'bulan' && !/^\d{4}-\d{2}$/.test(v)) throw badRequest(`Filter "${x.label}" harus berformat YYYY-MM`);
    if (x.tipe === 'angka') {
      if (!Number.isFinite(Number(v))) throw badRequest(`Filter "${x.label}" harus berupa angka`);
      v = Number(v);
    }
    if (x.tipe === 'pilih' && !opsiFilter(x).some((o) => String(o.nilai) === v)) {
      throw badRequest(`Pilihan "${v}" tidak tersedia pada filter "${x.label}"`);
    }
    f[x.kunci] = v;
  }
  if (f.dari && f.sampai && f.dari > f.sampai) throw badRequest('Tanggal awal tidak boleh setelah tanggal akhir');
  return f;
}

/** Menyusun model dokumen lengkap sebuah laporan. */
function susunLaporan(d, query, ctx) {
  const f = bacaFilter(d, query);
  const hasil = d.susun(f, ctx);
  const bagian = (hasil.bagian || []).map((b) => {
    if (b.baris.length > BATAS_BARIS) {
      throw badRequest(`Hasil laporan terlalu besar (${b.baris.length.toLocaleString('id-ID')} baris)`,
        'Persempit filter, misalnya rentang tanggalnya.');
    }
    return b;
  });
  // Keterangan filter yang aktif dicantumkan pada cetakan
  const keterangan = [...(hasil.keterangan || [])];
  const aktif = (d.filter || []).filter((x) => f[x.kunci] !== undefined && !['dari', 'sampai'].includes(x.kunci))
    .map((x) => {
      const o = x.tipe === 'pilih' ? opsiFilter(x).find((p) => String(p.nilai) === String(f[x.kunci])) : null;
      return `${x.label}: ${o ? o.teks : f[x.kunci]}`;
    });
  if (aktif.length) keterangan.push(`Filter — ${aktif.join('; ')}`);
  return {
    kode: d.kode,
    judul: hasil.judul || d.judul,
    subjudul: hasil.subjudul,
    keterangan,
    ringkasan: hasil.ringkasan || [],
    bagian,
    catatan: hasil.catatan,
    orientasi: hasil.orientasi || d.orientasi || 'portrait',
    jenis_ttd: d.jenis_ttd || 'laporan',
  };
}

router.get('/api/pusat-laporan', null, ({ ctx }) => ({
  kelompok: KELOMPOK,
  data: LAPORAN.filter((l) => !l.izin || can(ctx.user.role, l.izin)).map((l) => ({
    kode: l.kode, judul: l.judul, kelompok: l.kelompok, deskripsi: l.deskripsi || '',
    orientasi: l.orientasi || 'portrait',
    filter: (l.filter || []).map((x) => ({
      kunci: x.kunci, label: x.label, tipe: x.tipe || 'teks', wajib: !!x.wajib,
      bawaan: typeof x.bawaan === 'function' ? x.bawaan() : x.bawaan,
      ...(x.tipe === 'pilih' ? { opsi: opsiFilter(x) } : {}),
    })),
  })),
}));

router.get('/api/pusat-laporan/:kode', null, ({ params, query, ctx }) =>
  susunLaporan(definisi(params.kode, ctx), query, ctx));

function kirimBerkas(res, buf, nama, mime) {
  res.writeHead(200, {
    'Content-Type': mime,
    'Content-Length': buf.length,
    'Content-Disposition': `attachment; filename="${nama}"`,
    'Cache-Control': 'no-store',
  });
  res.end(buf);
}

/** Unduhan Excel / Word sebuah laporan dengan filter yang sama seperti pratinjau. */
router.get('/api/pusat-laporan/:kode/unduh', null, ({ params, query, ctx, res }) => {
  const format = oneOf(query, 'format', ['xlsx', 'docx'], { label: 'Format' });
  const d = definisi(params.kode, ctx);
  const dok = susunLaporan(d, query, ctx);
  const buf = format === 'xlsx' ? buatXlsx(dok, { pengguna: ctx.user }) : buatDocx(dok, { pengguna: ctx.user });
  logAudit(ctx, { aksi: 'export', modul: 'laporan', entitas_id: d.kode,
    keterangan: `Unduh ${format.toUpperCase()} laporan "${dok.judul}"` });
  kirimBerkas(res, buf, namaBerkas(dok.judul, format), MIME[format]);
});

// ------------------------------ Cetakan ------------------------------

/** Kop, aktivasi, dan tanda tangan untuk seluruh cetakan (setiap pengguna yang masuk). */
router.get('/api/cetak/profil', null, ({ ctx }) => dataCetak(ctx.user));

/**
 * Ekspor model dokumen yang disusun di layar (mis. bukti transaksi, laporan
 * keuangan) ke Excel/Word. Isi dokumen berasal dari data yang memang sudah
 * boleh dilihat pengguna, jadi cukup memerlukan sesi yang sah.
 */
router.post('/api/cetak/ekspor', null, ({ body, ctx, res }) => {
  const format = oneOf(body, 'format', ['xlsx', 'docx'], { label: 'Format' });
  const dok = body.dokumen;
  if (!dok || !Array.isArray(dok.bagian)) throw badRequest('Model dokumen tidak valid');
  const bersih = {
    judul: String(dok.judul || 'Dokumen').slice(0, 200),
    subjudul: dok.subjudul ? String(dok.subjudul).slice(0, 300) : undefined,
    keterangan: (dok.keterangan || []).map((k) => String(k).slice(0, 300)).slice(0, 20),
    ringkasan: (dok.ringkasan || []).slice(0, 60),
    bagian: dok.bagian.slice(0, 20).map((b) => ({
      judul: b.judul, kolom: (b.kolom || []).slice(0, 40), baris: (b.baris || []).slice(0, BATAS_BARIS), total: b.total || null,
    })),
    catatan: dok.catatan ? String(dok.catatan).slice(0, 2000) : undefined,
    orientasi: dok.orientasi === 'landscape' ? 'landscape' : 'portrait',
    jenis_ttd: JENIS_CETAKAN.some((j) => j.kode === dok.jenis_ttd) ? dok.jenis_ttd : 'default',
  };
  const buf = format === 'xlsx' ? buatXlsx(bersih, { pengguna: ctx.user }) : buatDocx(bersih, { pengguna: ctx.user });
  logAudit(ctx, { aksi: 'export', modul: 'laporan', keterangan: `Unduh ${format.toUpperCase()} "${bersih.judul}"` });
  kirimBerkas(res, buf, namaBerkas(bersih.judul, format), MIME[format]);
});

// --------------------------- Setup Koperasi ---------------------------

router.get('/api/setup/koperasi', 'admin.view', () => ({
  isian: ISIAN_PROFIL,
  profil: profilKoperasi(),
  aktivasi: aktivasi(),
}));

const BATAS_LOGO = 512 * 1024;

router.put('/api/setup/koperasi', 'admin.update', ({ body, ctx }) => {
  const sebelum = profilKoperasi();
  return tx(() => {
    for (const i of ISIAN_PROFIL) {
      if (body[i.kunci] === undefined) continue;
      const v = String(body[i.kunci] ?? '').trim();
      if (i.wajib && !v) throw badRequest(`"${i.label}" wajib diisi`);
      if (v.length > 300) throw badRequest(`"${i.label}" maksimal 300 karakter`);
      setSetting(`koperasi.${i.kunci}`, v, i.label);
    }
    if (body.logo !== undefined) {
      const logo = String(body.logo || '');
      if (logo && !/^data:image\/(png|jpeg|jpg);base64,[A-Za-z0-9+/=]+$/.test(logo)) {
        throw badRequest('Logo harus berupa gambar PNG atau JPEG');
      }
      if (logo.length > BATAS_LOGO * 1.37) throw badRequest('Ukuran logo maksimal 512 KB');
      if (logo) setSetting('koperasi.logo', logo, 'Logo koperasi (data URI)');
      else run("DELETE FROM settings WHERE key = 'koperasi.logo'");
    }
    const sesudah = profilKoperasi();
    logAudit(ctx, { aksi: 'update', modul: 'admin', keterangan: 'Profil koperasi diperbarui',
      before: { ...sebelum, logo: sebelum.logo ? '(ada)' : '' }, after: { ...sesudah, logo: sesudah.logo ? '(ada)' : '' } });
    return { profil: sesudah, aktivasi: aktivasi() };
  });
});

router.put('/api/setup/aktivasi', 'admin.update', ({ body, ctx }) => {
  const nomor = str(body, 'nomor', { required: false, max: 100, label: 'Nomor aktivasi' }) || '';
  if (nomor && !/^[A-Za-z0-9][A-Za-z0-9-]{7,99}$/.test(nomor)) {
    throw badRequest('Nomor aktivasi hanya boleh berisi huruf, angka, dan tanda hubung (minimal 8 karakter)');
  }
  const berlaku = body.berlaku_sampai ? String(body.berlaku_sampai).slice(0, 10) : '';
  if (berlaku && !/^\d{4}-\d{2}-\d{2}$/.test(berlaku)) throw badRequest('Tanggal berlaku harus berformat YYYY-MM-DD');
  const sebelum = aktivasi();
  tx(() => {
    setSetting('aktivasi.nomor', nomor, 'Nomor aktivasi aplikasi');
    setSetting('aktivasi.atas_nama', str(body, 'atas_nama', { required: false, max: 200 }) || '', 'Pemegang lisensi');
    setSetting('aktivasi.berlaku_sampai', berlaku, 'Masa berlaku aktivasi');
    setSetting('aktivasi.tanggal', nomor ? (sebelum.nomor === nomor && sebelum.tanggal
      ? sebelum.tanggal : new Date().toISOString().slice(0, 10)) : '', 'Tanggal aktivasi');
  });
  logAudit(ctx, { aksi: 'update', modul: 'admin', keterangan: `Aktivasi aplikasi ${nomor ? 'diperbarui' : 'dikosongkan'}`,
    before: sebelum, after: aktivasi() });
  return aktivasi();
});

// ---------------------- Pengaturan tanda tangan ----------------------

const SUMBER_NAMA = ISIAN_PROFIL.filter((i) => ['ketua', 'sekretaris', 'bendahara', 'ketua_pengawas', 'manajer'].includes(i.kunci))
  .map((i) => ({ kunci: i.kunci, label: i.label }));

router.get('/api/setup/tanda-tangan', 'admin.view', () => ({
  data: daftarKonfigTtd(),
  sumber_nama: SUMBER_NAMA,
}));

router.put('/api/setup/tanda-tangan/:jenis', 'admin.update', ({ params, body, ctx }) => {
  if (!JENIS_CETAKAN.some((j) => j.kode === params.jenis)) throw notFound('Jenis cetakan tidak dikenal');
  const penanda = Array.isArray(body.penanda) ? body.penanda : [];
  if (penanda.length > 6) throw badRequest('Maksimal 6 kolom tanda tangan');
  const bersih = penanda.map((p, i) => {
    const sumber = p.sumber && SUMBER_NAMA.some((s) => s.kunci === p.sumber) ? p.sumber : undefined;
    const x = {
      label: String(p.label ?? '').slice(0, 60),
      jabatan: String(p.jabatan ?? '').slice(0, 80),
      nama: String(p.nama ?? '').slice(0, 100),
      pengguna: p.pengguna === true || p.pengguna === 1 || p.pengguna === '1',
      sumber,
    };
    if (!x.label && !x.jabatan) throw badRequest(`Kolom tanda tangan ke-${i + 1} harus memiliki keterangan atau jabatan`);
    return x;
  });
  const sebelum = konfigTtd(params.jenis);
  const nilai = { tampil_tanggal: body.tampil_tanggal !== false, penanda: bersih };
  setSetting(`ttd.${params.jenis}`, JSON.stringify(nilai), `Tanda tangan cetakan ${params.jenis}`);
  logAudit(ctx, { aksi: 'update', modul: 'admin', entitas_id: params.jenis,
    keterangan: `Tanda tangan cetakan "${params.jenis}" diperbarui`, before: sebelum, after: nilai });
  return { jenis: params.jenis, ...nilai };
});

/** Mengembalikan tanda tangan satu jenis cetakan ke susunan bawaan. */
router.delete('/api/setup/tanda-tangan/:jenis', 'admin.update', ({ params, ctx }) => {
  if (!JENIS_CETAKAN.some((j) => j.kode === params.jenis)) throw notFound('Jenis cetakan tidak dikenal');
  run('DELETE FROM settings WHERE key = ?', [`ttd.${params.jenis}`]);
  logAudit(ctx, { aksi: 'update', modul: 'admin', entitas_id: params.jenis,
    keterangan: `Tanda tangan cetakan "${params.jenis}" dikembalikan ke bawaan` });
  return { jenis: params.jenis, ...konfigTtd(params.jenis) };
});

export default router;
