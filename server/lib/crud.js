/**
 * Pembangun endpoint CRUD generik dengan whitelist kolom, pencarian,
 * paginasi, dan pencatatan audit otomatis.
 */
import { all, get, run, scalar } from '../db.js';
import { badRequest, notFound, conflict } from './http.js';
import { logAudit } from './audit.js';

/**
 * @param {object} opt
 * @param {string} opt.table        nama tabel
 * @param {string} opt.modul        nama modul untuk audit & izin
 * @param {string[]} opt.fields     kolom yang boleh diisi/ubah
 * @param {string[]} [opt.required] kolom wajib saat create
 * @param {string[]} [opt.search]   kolom yang dicari oleh parameter q
 * @param {string} [opt.orderBy]
 * @param {string} [opt.label]      kolom untuk deskripsi audit
 * @param {string} [opt.selectSql]  SELECT kustom (mis. dengan JOIN); harus memuat alias t
 * @param {string[]} [opt.unique]   kolom yang harus unik
 * @param {(row:object)=>object} [opt.transform]
 */
export function crud(opt) {
  const {
    table, modul, fields, required = [], search = [], orderBy = 'id DESC',
    label = 'nama', selectSql = null, unique = [], transform = null, filters = [],
  } = opt;

  const pick = (body) => {
    const out = {};
    for (const f of fields) if (body[f] !== undefined) out[f] = body[f] === '' ? null : body[f];
    return out;
  };

  const cekUnik = (data, excludeId = null) => {
    for (const u of unique) {
      if (data[u] === undefined || data[u] === null) continue;
      const row = get(`SELECT id FROM ${table} WHERE ${u} = ?${excludeId ? ' AND id <> ?' : ''}`,
        excludeId ? [data[u], excludeId] : [data[u]]);
      if (row) throw conflict(`Nilai "${data[u]}" pada kolom ${u} sudah digunakan`);
    }
  };

  return {
    list(query = {}) {
      const w = [];
      const p = [];
      if (query.q && search.length) {
        w.push(`(${search.map((s) => `t.${s} LIKE ?`).join(' OR ')})`);
        for (const _ of search) p.push(`%${query.q}%`);
      }
      for (const f of filters) {
        if (query[f] !== undefined && query[f] !== '') { w.push(`t.${f} = ?`); p.push(query[f]); }
      }
      if (query.status) { w.push('t.status = ?'); p.push(query.status); }
      const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
      const limit = Math.min(Number(query.limit) || 100, 1000);
      const offset = Math.max(Number(query.offset) || 0, 0);
      const base = selectSql || `SELECT t.* FROM ${table} t`;
      const rows = all(`${base} ${where} ORDER BY t.${orderBy} LIMIT ? OFFSET ?`, [...p, limit, offset]);
      const total = scalar(`SELECT COUNT(*) FROM ${table} t ${where}`, p);
      return { data: transform ? rows.map(transform) : rows, total, limit, offset };
    },

    detail(id) {
      const base = selectSql || `SELECT t.* FROM ${table} t`;
      const row = get(`${base} WHERE t.id = ?`, [id]);
      if (!row) throw notFound(`Data pada ${modul} tidak ditemukan`);
      return transform ? transform(row) : row;
    },

    create(body, ctx) {
      const data = pick(body);
      for (const r of required) {
        if (data[r] === undefined || data[r] === null || data[r] === '') {
          throw badRequest(`Kolom "${r}" wajib diisi`);
        }
      }
      cekUnik(data);
      const cols = Object.keys(data);
      if (!cols.length) throw badRequest('Tidak ada data yang dikirim');
      const { lastInsertRowid: id } = run(
        `INSERT INTO ${table}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`,
        cols.map((c) => data[c]),
      );
      const row = get(`SELECT * FROM ${table} WHERE id = ?`, [id]);
      logAudit(ctx, { aksi: 'create', modul, entitas_id: id,
        keterangan: `${table}: ${row?.[label] ?? id} ditambahkan`, after: row });
      return row;
    },

    update(id, body, ctx) {
      const before = get(`SELECT * FROM ${table} WHERE id = ?`, [id]);
      if (!before) throw notFound(`Data pada ${modul} tidak ditemukan`);
      const data = pick(body);
      const cols = Object.keys(data);
      if (!cols.length) throw badRequest('Tidak ada perubahan yang dikirim');
      cekUnik(data, id);
      run(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
        [...cols.map((c) => data[c]), id]);
      const after = get(`SELECT * FROM ${table} WHERE id = ?`, [id]);
      logAudit(ctx, { aksi: 'update', modul, entitas_id: id,
        keterangan: `${table}: ${after?.[label] ?? id} diubah`, before, after });
      return after;
    },

    remove(id, ctx) {
      const before = get(`SELECT * FROM ${table} WHERE id = ?`, [id]);
      if (!before) throw notFound(`Data pada ${modul} tidak ditemukan`);
      try {
        run(`DELETE FROM ${table} WHERE id = ?`, [id]);
      } catch (e) {
        if (String(e.message || '').includes('FOREIGN KEY')) {
          throw conflict('Data tidak dapat dihapus karena masih dipakai oleh transaksi lain',
            'Nonaktifkan data ini (ubah status menjadi "nonaktif") sebagai gantinya.');
        }
        throw e;
      }
      logAudit(ctx, { aksi: 'delete', modul, entitas_id: id,
        keterangan: `${table}: ${before?.[label] ?? id} dihapus`, before });
      return { dihapus: true, id };
    },
  };
}

/** Mendaftarkan rute CRUD standar pada sebuah router. */
export function mountCrud(router, path, modul, resource, { readPerm, writePerm } = {}) {
  const rp = readPerm || `${modul}.view`;
  const wp = writePerm || `${modul}.update`;
  router.get(path, rp, ({ query }) => resource.list(query));
  router.get(`${path}/:id`, rp, ({ params }) => resource.detail(Number(params.id)));
  router.post(path, writePerm || `${modul}.create`, ({ body, ctx }) => resource.create(body, ctx));
  router.put(`${path}/:id`, wp, ({ params, body, ctx }) => resource.update(Number(params.id), body, ctx));
  router.delete(`${path}/:id`, writePerm || `${modul}.delete`, ({ params, ctx }) => resource.remove(Number(params.id), ctx));
  return router;
}
