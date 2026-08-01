/**
 * Modul 24 - Portal / Mobile Apps Anggota (layanan mandiri).
 *
 * Seluruh endpoint di sini HANYA mengakses data milik anggota yang sedang masuk
 * (diambil dari users.anggota_id, bukan dari parameter permintaan) sehingga
 * tidak dapat dipakai untuk melihat data anggota lain.
 */
import { createRouter, forbidden, notFound, badRequest, conflict } from '../lib/http.js';
import { all, get, run, scalar, nextNumber } from '../db.js';
import { logAudit } from '../lib/audit.js';
import { num, str, date, oneOf, today } from '../lib/util.js';
import { ringkasanAnggota } from '../services/savings.js';
import { riwayatAnggota as shuAnggota } from '../services/shu.js';
import { hitungJadwal, simulasiPelunasan, LABEL_KOLEKTIBILITAS } from '../services/loans.js';
import * as loans from '../services/loans.js';

const router = createRouter();

/** Mengambil id anggota dari sesi; menolak bila akun tidak tertaut anggota. */
function anggotaSaya(ctx) {
  const id = ctx?.user?.anggota_id;
  if (!id) {
    throw forbidden('Akun Anda tidak tertaut dengan data keanggotaan',
      'Hubungi pengurus koperasi untuk menautkan akun Anda dengan nomor anggota.');
  }
  const a = get('SELECT * FROM anggota WHERE id = ?', [id]);
  if (!a) throw notFound('Data anggota tidak ditemukan');
  return a;
}

router.get('/api/portal/beranda', 'portal.view', ({ ctx }) => {
  const a = anggotaSaya(ctx);
  const simpanan = ringkasanAnggota(a.id);
  const pinjaman = all(
    `SELECT p.*, pr.nama AS produk_nama FROM pinjaman p JOIN produk_pinjaman pr ON pr.id = p.produk_id
      WHERE p.anggota_id = ? AND p.status IN ('dicairkan','restrukturisasi','disetujui','diajukan','dianalisis')
      ORDER BY p.id DESC`, [a.id]);
  const tagihan = all(
    `SELECT j.*, p.nomor AS nomor_pinjaman FROM pinjaman_jadwal j JOIN pinjaman p ON p.id = j.pinjaman_id
      WHERE p.anggota_id = ? AND j.status <> 'lunas' ORDER BY j.jatuh_tempo LIMIT 3`, [a.id]);
  return {
    anggota: {
      nomor_anggota: a.nomor_anggota, nama: a.nama, status: a.status,
      tanggal_gabung: a.tanggal_gabung, foto: a.foto,
      qr: `ECMS-ANGGOTA:${a.nomor_anggota}`,
    },
    simpanan,
    pinjaman: pinjaman.map((p) => ({ ...p, label_kolektibilitas: LABEL_KOLEKTIBILITAS[p.kolektibilitas] })),
    tagihan_terdekat: tagihan.map((t) => ({ ...t, sisa: t.total - t.bayar_pokok - t.bayar_bunga })),
    poin_loyalty: scalar('SELECT COALESCE(SUM(poin),0) FROM loyalty_poin WHERE anggota_id = ?', [a.id]),
    shu_terakhir: shuAnggota(a.id)[0] || null,
    rat_terbuka: all(
      `SELECT r.id, r.judul, r.tanggal, r.tempat, r.status, p.hadir
         FROM rat r JOIN rat_peserta p ON p.rat_id = r.id AND p.anggota_id = ?
        WHERE r.status IN ('undangan','berlangsung') ORDER BY r.tanggal`, [a.id]),
  };
});

router.get('/api/portal/simpanan', 'portal.view', ({ ctx, query }) => {
  const a = anggotaSaya(ctx);
  const ringkasan = ringkasanAnggota(a.id);
  const rekeningId = query.rekening_id ? Number(query.rekening_id) : null;
  if (rekeningId && !ringkasan.rekening.some((r) => r.id === rekeningId)) {
    throw forbidden('Rekening tersebut bukan milik Anda');
  }
  return {
    ...ringkasan,
    mutasi: all(
      `SELECT t.* FROM transaksi_simpanan t JOIN rekening_simpanan r ON r.id = t.rekening_id
        WHERE r.anggota_id = ? ${rekeningId ? 'AND t.rekening_id = ?' : ''}
        ORDER BY t.tanggal DESC, t.id DESC LIMIT 100`,
      rekeningId ? [a.id, rekeningId] : [a.id]),
  };
});

router.get('/api/portal/pinjaman', 'portal.view', ({ ctx }) => {
  const a = anggotaSaya(ctx);
  const list = all(
    `SELECT p.*, pr.nama AS produk_nama FROM pinjaman p JOIN produk_pinjaman pr ON pr.id = p.produk_id
      WHERE p.anggota_id = ? ORDER BY p.id DESC`, [a.id]);
  return {
    data: list.map((p) => ({
      ...p,
      label_kolektibilitas: LABEL_KOLEKTIBILITAS[p.kolektibilitas],
      jadwal: all('SELECT * FROM pinjaman_jadwal WHERE pinjaman_id = ? ORDER BY angsuran_ke', [p.id]),
      angsuran: all('SELECT * FROM pinjaman_angsuran WHERE pinjaman_id = ? ORDER BY tanggal DESC', [p.id]),
    })),
  };
});

router.get('/api/portal/pinjaman/:id/pelunasan', 'portal.view', ({ ctx, params }) => {
  const a = anggotaSaya(ctx);
  const p = get('SELECT * FROM pinjaman WHERE id = ? AND anggota_id = ?', [Number(params.id), a.id]);
  if (!p) throw notFound('Pinjaman tidak ditemukan atau bukan milik Anda');
  return simulasiPelunasan(p.id, today());
});

/** Simulasi angsuran mandiri. */
router.post('/api/portal/simulasi', 'portal.view', ({ body }) => {
  const produk = get("SELECT * FROM produk_pinjaman WHERE id = ? AND status = 'aktif'", [Number(body.produk_id)]);
  if (!produk) throw notFound('Produk pinjaman tidak ditemukan');
  const pokok = num(body, 'pokok', { min: 1 });
  const tenor = num(body, 'tenor', { min: produk.tenor_min, max: produk.tenor_max, label: 'Tenor' });
  return {
    produk: { nama: produk.nama, bunga_tahunan: produk.bunga_tahunan, metode: produk.metode_bunga },
    ...hitungJadwal({ pokok, tenor, bunga_tahunan: produk.bunga_tahunan,
      metode: produk.metode_bunga, tanggal_mulai: today() }),
  };
});

/** Pengajuan pinjaman mandiri oleh anggota. */
router.post('/api/portal/pinjaman', 'portal.view', ({ ctx, body }) => {
  const a = anggotaSaya(ctx);
  if (a.status !== 'aktif') throw conflict('Hanya anggota aktif yang dapat mengajukan pinjaman');
  return loans.ajukan({
    anggota_id: a.id,
    produk_id: num(body, 'produk_id', { min: 1 }),
    pokok: num(body, 'pokok', { min: 1, label: 'Jumlah pinjaman' }),
    tenor: num(body, 'tenor', { min: 1, max: 120, label: 'Tenor' }),
    tujuan: str(body, 'tujuan', { max: 300, label: 'Tujuan penggunaan' }),
    tanggal_pengajuan: today(),
    cabang_id: a.cabang_id,
  }, ctx);
});

router.get('/api/portal/shu', 'portal.view', ({ ctx }) => {
  const a = anggotaSaya(ctx);
  const riwayat = shuAnggota(a.id);
  return { data: riwayat, total_diterima: riwayat.reduce((s, r) => s + r.shu_total, 0) };
});

router.get('/api/portal/belanja', 'portal.view', ({ ctx }) => {
  const a = anggotaSaya(ctx);
  return {
    riwayat: all(
      `SELECT id, nomor, tanggal, total, poin_didapat, metode_bayar FROM penjualan
        WHERE anggota_id = ? AND status = 'selesai' ORDER BY tanggal DESC LIMIT 50`, [a.id]),
    poin: {
      saldo: scalar('SELECT COALESCE(SUM(poin),0) FROM loyalty_poin WHERE anggota_id = ?', [a.id]),
      mutasi: all('SELECT * FROM loyalty_poin WHERE anggota_id = ? ORDER BY id DESC LIMIT 50', [a.id]),
    },
  };
});

// ------------------------------ RAT ------------------------------

router.get('/api/portal/rat', 'portal.view', ({ ctx }) => {
  const a = anggotaSaya(ctx);
  const daftar = all(
    `SELECT r.*, p.hadir, p.waktu_hadir FROM rat r
       JOIN rat_peserta p ON p.rat_id = r.id AND p.anggota_id = ?
      ORDER BY r.tanggal DESC`, [a.id]);
  return {
    data: daftar.map((r) => ({
      ...r,
      agenda: all('SELECT urut, judul, jenis FROM rat_agenda WHERE rat_id = ? ORDER BY urut', [r.id]),
      voting: all("SELECT id, judul, opsi, status FROM rat_voting WHERE rat_id = ? AND status = 'dibuka'", [r.id])
        .map((v) => ({
          ...v, opsi: JSON.parse(v.opsi || '[]'),
          sudah_memilih: !!get('SELECT id FROM rat_suara WHERE voting_id = ? AND anggota_id = ?', [v.id, a.id]),
        })),
    })),
  };
});

router.post('/api/portal/rat/:id/hadir', 'portal.view', ({ ctx, params }) => {
  const a = anggotaSaya(ctx);
  const ratId = Number(params.id);
  const peserta = get('SELECT * FROM rat_peserta WHERE rat_id = ? AND anggota_id = ?', [ratId, a.id]);
  if (!peserta) throw notFound('Anda tidak terdaftar sebagai peserta RAT ini');
  if (peserta.hadir) return { berhasil: true, pesan: 'Kehadiran Anda sudah tercatat sebelumnya' };
  run(`UPDATE rat_peserta SET hadir = 1, waktu_hadir = datetime('now') WHERE id = ?`, [peserta.id]);
  const r = get('SELECT * FROM rat WHERE id = ?', [ratId]);
  const hadir = scalar('SELECT COUNT(*) FROM rat_peserta WHERE rat_id = ? AND hadir = 1', [ratId]);
  const kuorum = r.total_anggota > 0 && (hadir / r.total_anggota * 100) >= r.kuorum_persen;
  run('UPDATE rat SET hadir = ?, kuorum_tercapai = ? WHERE id = ?', [hadir, kuorum ? 1 : 0, ratId]);
  logAudit(ctx, { aksi: 'create', modul: 'rat', entitas_id: ratId,
    keterangan: `Anggota ${a.nomor_anggota} melakukan presensi mandiri` });
  return { berhasil: true, hadir, kuorum_tercapai: kuorum };
});

router.post('/api/portal/voting/:id', 'portal.view', ({ ctx, params, body }) => {
  const a = anggotaSaya(ctx);
  const v = get('SELECT * FROM rat_voting WHERE id = ?', [Number(params.id)]);
  if (!v) throw notFound('Voting tidak ditemukan');
  if (v.status !== 'dibuka') throw conflict('Voting belum dibuka atau sudah ditutup');
  const hadir = get('SELECT hadir FROM rat_peserta WHERE rat_id = ? AND anggota_id = ?', [v.rat_id, a.id]);
  if (!hadir?.hadir) throw conflict('Anda harus melakukan presensi kehadiran terlebih dahulu');
  if (get('SELECT id FROM rat_suara WHERE voting_id = ? AND anggota_id = ?', [v.id, a.id])) {
    throw conflict('Anda sudah memberikan suara pada voting ini');
  }
  const opsi = JSON.parse(v.opsi || '[]');
  const pilihan = str(body, 'pilihan', { max: 100, label: 'Pilihan' });
  if (!opsi.includes(pilihan)) throw badRequest(`Pilihan tidak valid. Opsi: ${opsi.join(', ')}`);
  run('INSERT INTO rat_suara(voting_id, anggota_id, pilihan) VALUES(?,?,?)', [v.id, a.id, pilihan]);
  logAudit(ctx, { aksi: 'create', modul: 'rat', entitas_id: v.rat_id,
    keterangan: `Suara anggota ${a.nomor_anggota} tercatat pada voting "${v.judul}"` });
  return { berhasil: true, pesan: 'Suara Anda telah tercatat' };
});

// ---------------------------- Layanan ----------------------------

router.get('/api/portal/tiket', 'portal.view', ({ ctx }) => {
  const a = anggotaSaya(ctx);
  return {
    data: all('SELECT * FROM tiket WHERE anggota_id = ? ORDER BY created_at DESC', [a.id])
      .map((t) => ({ ...t, balasan: all('SELECT * FROM tiket_balasan WHERE tiket_id = ? ORDER BY created_at', [t.id]) })),
  };
});

router.post('/api/portal/tiket', 'portal.view', ({ ctx, body }) => {
  const a = anggotaSaya(ctx);
  const judul = str(body, 'judul', { max: 200, label: 'Judul' });
  const nomor = nextNumber('TKT', today());
  const { lastInsertRowid: id } = run(
    `INSERT INTO tiket(nomor, anggota_id, kategori, prioritas, judul, isi, kanal)
     VALUES(?,?,?,'normal',?,?,'aplikasi')`,
    [nomor, a.id, oneOf(body, 'kategori', ['pengaduan', 'pertanyaan', 'saran', 'klaim'],
      { required: false, dflt: 'pertanyaan' }), judul, body.isi || null]);
  logAudit(ctx, { aksi: 'create', modul: 'crm', entitas_id: id,
    keterangan: `Tiket ${nomor} dibuat oleh anggota ${a.nomor_anggota}` });
  return get('SELECT * FROM tiket WHERE id = ?', [id]);
});

router.get('/api/portal/produk', 'portal.view', () => ({
  simpanan: all("SELECT id, kode, nama, jenis, setoran_minimal, setoran_wajib, bunga_tahunan, boleh_tarik, tenor_bulan FROM produk_simpanan WHERE status = 'aktif'"),
  pinjaman: all("SELECT id, kode, nama, jenis, metode_bunga, bunga_tahunan, tenor_min, tenor_max, plafon_min, plafon_max, biaya_admin, wajib_agunan FROM produk_pinjaman WHERE status = 'aktif'"),
}));

/** Perubahan data pribadi terbatas (kontak) oleh anggota sendiri. */
router.put('/api/portal/profil', 'portal.view', ({ ctx, body }) => {
  const a = anggotaSaya(ctx);
  const boleh = ['telepon', 'email', 'alamat', 'kelurahan', 'kecamatan', 'kota', 'provinsi', 'kode_pos'];
  const data = {};
  for (const f of boleh) if (body[f] !== undefined) data[f] = body[f] === '' ? null : body[f];
  const cols = Object.keys(data);
  if (!cols.length) throw badRequest('Tidak ada perubahan yang dikirim');
  run(`UPDATE anggota SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`,
    [...cols.map((c) => data[c]), a.id]);
  logAudit(ctx, { aksi: 'update', modul: 'anggota', entitas_id: a.id,
    keterangan: `Anggota ${a.nomor_anggota} memperbarui data kontak mandiri`,
    before: Object.fromEntries(cols.map((c) => [c, a[c]])), after: data });
  return get('SELECT * FROM anggota WHERE id = ?', [a.id]);
});

export default router;
