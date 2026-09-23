/**
 * ECMS - Enterprise Cooperative Management System
 * Titik masuk aplikasi: server HTTP, routing API, dan penyajian berkas statis.
 */
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

import { migrate, run, setting } from './db.js';
import {
  AppError, readBody, sendJson, sendText, mergeRouters,
} from './lib/http.js';
import { can } from './lib/rbac.js';
import {
  COOKIE_NAME, parseCookies, requireUser, sessionCookie, clearCookie, purgeExpiredSessions,
} from './lib/auth.js';
import { pastikanDataAwal } from './seed.js';
import { profilKoperasi } from './lib/profil.js';
import { jalankanRecurring } from './services/accounting.js';

import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import masterRoutes from './routes/master.js';
import anggotaRoutes from './routes/anggota.js';
import simpananRoutes from './routes/simpanan.js';
import pinjamanRoutes from './routes/pinjaman.js';
import akuntansiRoutes from './routes/akuntansi.js';
import kasRoutes from './routes/kas.js';
import perdaganganRoutes from './routes/perdagangan.js';
import organisasiRoutes from './routes/organisasi.js';
import dokumenRoutes from './routes/dokumen.js';
import tatakelolaRoutes from './routes/tatakelola.js';
import adminRoutes from './routes/admin.js';
import portalRoutes from './routes/portal.js';
import pusatLaporanRoutes from './routes/pusat-laporan.js';
import koreksiRoutes from './routes/koreksi.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');
// PORT=0 sah (sistem operasi memilih porta bebas - dipakai uji otomatis),
// jadi tidak boleh ikut jatuh ke nilai bawaan seperti `Number(x) || 3000`.
const PORT = process.env.PORT !== undefined && process.env.PORT !== '' ? Number(process.env.PORT) : 3000;
const HOST = process.env.HOST || '0.0.0.0';

const router = mergeRouters(
  authRoutes, dashboardRoutes, masterRoutes, anggotaRoutes, simpananRoutes, pinjamanRoutes,
  akuntansiRoutes, kasRoutes, perdaganganRoutes, organisasiRoutes, dokumenRoutes,
  tatakelolaRoutes, adminRoutes, portalRoutes, pusatLaporanRoutes, koreksiRoutes,
);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/** Rute publik yang tidak memerlukan sesi. */
const PUBLIK = new Set(['POST /api/auth/login', 'POST /api/auth/logout', 'GET /api/info']);

const sidikLogo = (isi) => createHash('sha1').update(isi).digest('hex').slice(0, 12);

/** Nama koperasi & alamat logo untuk halaman yang tampil sebelum masuk. */
function identitasPublik() {
  const p = profilKoperasi();
  return { nama: p.nama, logo: p.logo ? `/api/logo?v=${sidikLogo(p.logo)}` : '' };
}

async function sajikanStatis(req, res, pathname) {
  const bersih = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  let file = join(PUBLIC_DIR, bersih === '/' ? 'index.html' : bersih);
  if (!file.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, 'Akses ditolak');
    return;
  }
  try {
    const info = await stat(file);
    if (info.isDirectory()) file = join(file, 'index.html');
  } catch {
    // Rute aplikasi dilayani index.html supaya penyegaran halaman di tengah
    // navigasi tetap bekerja. Permintaan yang jelas-jelas menyebut nama berkas
    // tidak ikut: aset yang hilang harus menjawab 404 yang jujur, bukan HTML
    // yang menyamar sebagai skrip atau gaya dan menghasilkan galat MIME yang
    // menyesatkan saat ditelusuri.
    //
    // Nama berawalan titik (.env, .git) diperiksa terpisah karena extname()
    // menganggapnya tanpa ekstensi - tanpa ini justru berkas yang paling sering
    // diintip pemindai otomatis yang lolos menjadi jawaban 200.
    const namaBerkas = bersih.slice(bersih.lastIndexOf('/') + 1);
    if (extname(namaBerkas) || namaBerkas.startsWith('.')) {
      sendText(res, 404, 'Berkas tidak ditemukan');
      return;
    }
    file = join(PUBLIC_DIR, 'index.html');
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] || 'application/octet-stream',
      'Content-Length': data.length,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=300',
    });
    res.end(data);
  } catch {
    sendText(res, 404, 'Berkas tidak ditemukan');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const { pathname } = url;

  // Header keamanan dasar
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');

  if (!pathname.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendText(res, 405, 'Metode tidak diizinkan');
      return;
    }
    await sajikanStatis(req, res, pathname);
    return;
  }

  if (pathname === '/api/info') {
    sendJson(res, 200, {
      aplikasi: 'ECMS - Enterprise Cooperative Management System',
      untuk: 'Koperasi Serba Usaha',
      versi: '1.0.0',
      acuan: ['UU No. 25 Tahun 1992', 'Permenkop UKM No. 2 Tahun 2024', 'SAK EP',
        'UU ITE No. 11/2008 jo. UU No. 19/2016'],
      // Halaman masuk memakai penanda ini untuk memutuskan apakah daftar akun
      // contoh boleh ditampilkan. Bila pengaturan belum ada - misalnya basis
      // data lama - jawabannya tidak, karena itu pilihan yang aman.
      demo: setting('mode_demo', '0') === '1',
      // Identitas yang memang tampil di setiap cetakan, sehingga aman dibuka
      // sebelum masuk: halaman masuk & ikon tab memakai logo dari Setup Koperasi.
      koperasi: identitasPublik(),
    });
    return;
  }

  // Logo koperasi sebagai berkas gambar biasa (bukan data URI) supaya dapat
  // dipakai sebagai <img> dan ikon tab. Alamatnya membawa ?v=<sidik> dari
  // /api/info, jadi logo baru langsung terpakai tanpa menunggu singgahan habis.
  if (pathname === '/api/logo' && (req.method === 'GET' || req.method === 'HEAD')) {
    const m = /^data:(image\/(?:png|jpeg|jpg));base64,(.+)$/.exec(profilKoperasi().logo || '');
    if (!m) { sendText(res, 404, 'Logo belum diatur'); return; }
    const data = Buffer.from(m[2], 'base64');
    res.writeHead(200, {
      'Content-Type': m[1] === 'image/jpg' ? 'image/jpeg' : m[1],
      'Content-Length': data.length,
      'Cache-Control': 'public, max-age=86400',
      ETag: `"${sidikLogo(m[2])}"`,
    });
    res.end(req.method === 'HEAD' ? undefined : data);
    return;
  }

  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies[COOKIE_NAME];
  let ctx = null;

  try {
    const kunci = `${req.method} ${pathname}`;
    const publik = PUBLIK.has(kunci);

    if (!publik) {
      const user = requireUser(token);
      ctx = { user, token, ip: req.socket.remoteAddress };
    } else if (token) {
      try {
        ctx = { user: requireUser(token), token, ip: req.socket.remoteAddress };
      } catch { /* sesi kedaluwarsa pada rute publik diabaikan */ }
    }

    const hasil = router.match(req.method, pathname);
    if (!hasil) throw new AppError(404, `Endpoint ${req.method} ${pathname} tidak tersedia`);
    if (hasil.methodNotAllowed) throw new AppError(405, `Metode ${req.method} tidak diizinkan untuk ${pathname}`);

    const { route, params } = hasil;

    // Pemeriksaan hak akses (RBAC)
    if (route.permission && !can(ctx.user.role, route.permission)) {
      throw new AppError(403,
        'Anda tidak memiliki hak akses untuk tindakan ini',
        `Diperlukan izin "${route.permission}". Peran Anda saat ini: ${ctx.user.role}.`);
    }
    // Peran anggota hanya boleh mengakses portal
    if (ctx?.user?.role === 'anggota' && !pathname.startsWith('/api/portal/')
      && !pathname.startsWith('/api/auth/') && !pathname.startsWith('/api/notifikasi')) {
      throw new AppError(403, 'Peran Anggota hanya dapat mengakses layanan portal anggota');
    }

    const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
    const query = Object.fromEntries(url.searchParams);

    const data = await route.handler({
      params, query, body, ctx, req, res, token,
      setCookie: (t, exp) => res.setHeader('Set-Cookie', sessionCookie(t, exp)),
      clear: () => res.setHeader('Set-Cookie', clearCookie()),
    });

    if (res.headersSent) return;
    sendJson(res, req.method === 'POST' ? 201 : 200, data ?? { berhasil: true });
  } catch (err) {
    if (res.headersSent) return;
    const status = err instanceof AppError ? err.status : 500;
    if (status >= 500) {
      console.error(`[ECMS] ${req.method} ${pathname}:`, err);
    }
    sendJson(res, status, {
      error: true,
      pesan: status >= 500 ? 'Terjadi kesalahan pada server' : err.message,
      detail: err.detail || null,
      ...(process.env.NODE_ENV !== 'production' && status >= 500 ? { debug: err.message } : {}),
    });
  }
});

// Pemeliharaan berkala: pembersihan sesi kedaluwarsa
setInterval(() => {
  try { purgeExpiredSessions(); } catch { /* diabaikan */ }
}, 30 * 60 * 1000).unref();

migrate();
pastikanDataAwal();

/**
 * Jurnal berulang (sewa, amortisasi, dsb.) diposting otomatis begitu jatuh
 * tempo - saat server menyala lalu setiap jam. Dapat dimatikan lewat
 * pengaturan akuntansi.recurring_otomatis = 0.
 */
function jurnalBerulangOtomatis() {
  if (setting('akuntansi.recurring_otomatis', '1') !== '1') return;
  try {
    const h = jalankanRecurring();
    if (h.jumlah_jurnal) console.log(`[ECMS] ${h.jumlah_jurnal} jurnal berulang diposting otomatis`);
    for (const t of h.template.filter((x) => x.galat)) {
      console.warn(`[ECMS] Jurnal berulang "${t.nama}" gagal diposting: ${t.galat}`);
    }
  } catch (err) {
    console.error('[ECMS] Jurnal berulang otomatis gagal:', err);
  }
}
jurnalBerulangOtomatis();
setInterval(jurnalBerulangOtomatis, 60 * 60 * 1000).unref();

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════════════════════╗');
  console.log('  ║   ECMS · Enterprise Cooperative Management System             ║');
  console.log('  ║   Aplikasi Koperasi Serba Usaha                               ║');
  console.log('  ╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  Server berjalan  : http://localhost:${server.address().port}`);
  if (setting('mode_demo', '0') === '1') {
    console.log('  Akun contoh      : admin / Admin12345  (Super Administrator)');
  }
  console.log('  Dokumentasi      : lihat README.md');
  console.log('');
});

export default server;
