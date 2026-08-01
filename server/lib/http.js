/**
 * Utilitas HTTP: parsing body, response JSON, error terstruktur, router mini.
 */

/** Error aplikasi dengan kode status HTTP. */
export class AppError extends Error {
  constructor(status, message, detail = null) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

export const badRequest = (msg, detail) => new AppError(400, msg, detail);
export const unauthorized = (msg = 'Belum masuk / sesi berakhir') => new AppError(401, msg);
export const forbidden = (msg = 'Anda tidak memiliki hak akses untuk aksi ini') => new AppError(403, msg);
export const notFound = (msg = 'Data tidak ditemukan') => new AppError(404, msg);
export const conflict = (msg, detail) => new AppError(409, msg, detail);

const MAX_BODY = 12 * 1024 * 1024; // 12 MB (upload dokumen base64)

export function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new AppError(413, 'Ukuran data terlalu besar (maksimum 12 MB)'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(badRequest('Format JSON tidak valid'));
      }
    });
    req.on('error', reject);
  });
}

export function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

export function sendText(res, status, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}

/**
 * Router sederhana berbasis pola "/api/anggota/:id".
 * Mengembalikan objek dengan .get/.post/.put/.patch/.delete dan .match().
 */
export function createRouter() {
  const routes = [];

  const add = (method, pattern, permission, handler) => {
    const parts = pattern.split('/').filter(Boolean);
    routes.push({ method, parts, permission, handler, pattern });
  };

  const api = {
    get: (p, perm, h) => add('GET', p, perm, h),
    post: (p, perm, h) => add('POST', p, perm, h),
    put: (p, perm, h) => add('PUT', p, perm, h),
    patch: (p, perm, h) => add('PATCH', p, perm, h),
    delete: (p, perm, h) => add('DELETE', p, perm, h),
    routes,
    match(method, pathname) {
      const segs = pathname.split('/').filter(Boolean);
      let pathMatched = false;
      for (const r of routes) {
        if (r.parts.length !== segs.length) continue;
        const params = {};
        let ok = true;
        for (let i = 0; i < r.parts.length; i++) {
          const p = r.parts[i];
          if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(segs[i]);
          else if (p !== segs[i]) { ok = false; break; }
        }
        if (!ok) continue;
        pathMatched = true;
        if (r.method === method) return { route: r, params };
      }
      return pathMatched ? { methodNotAllowed: true } : null;
    },
  };
  return api;
}

/** Menggabungkan beberapa router menjadi satu. */
export function mergeRouters(...routers) {
  const merged = createRouter();
  for (const r of routers) merged.routes.push(...r.routes);
  return merged;
}
