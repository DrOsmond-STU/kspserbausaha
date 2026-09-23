/**
 * Modul 16 - Manajemen Aset Tetap (PSAK 16).
 *
 * Metode penyusutan: garis lurus dan saldo menurun ganda.
 * Penyusutan dijalankan per periode (bulanan) dan langsung membentuk jurnal.
 */
import { all, get, run, tx, scalar } from '../db.js';
import { badRequest, notFound, conflict } from '../lib/http.js';
import { logAudit } from '../lib/audit.js';
import { postJournal, voidJournal, AKUN, akunKasMetode } from './accounting.js';
import { rupiah, today, endOfMonth } from '../lib/util.js';

/** Penyusutan per bulan untuk satu aset. */
export function penyusutanBulanan(aset) {
  if (aset.kategori === 'tanah') return 0;           // tanah tidak disusutkan (PSAK 16)
  const umurBulan = (aset.umur_manfaat || 0) * 12;
  if (umurBulan <= 0) return 0;
  const dasar = aset.harga_perolehan - aset.nilai_residu;
  if (dasar <= 0) return 0;
  if (aset.metode === 'saldo_menurun') {
    const tarif = (2 / (aset.umur_manfaat || 1)) / 12;
    const nilaiBuku = aset.harga_perolehan - aset.akumulasi_penyusutan;
    return rupiah(Math.max(0, (nilaiBuku - aset.nilai_residu) * tarif));
  }
  return rupiah(dasar / umurBulan);
}

export function daftar(filter = {}) {
  const w = [];
  const p = [];
  if (filter.status) { w.push('status = ?'); p.push(filter.status); }
  if (filter.kategori) { w.push('kategori = ?'); p.push(filter.kategori); }
  if (filter.unit_usaha_id) { w.push('unit_usaha_id = ?'); p.push(Number(filter.unit_usaha_id)); }
  const rows = all(
    `SELECT * FROM aset_tetap ${w.length ? `WHERE ${w.join(' AND ')}` : ''} ORDER BY kode`, p);
  return rows.map((a) => ({
    ...a,
    nilai_buku: a.harga_perolehan - a.akumulasi_penyusutan,
    penyusutan_per_bulan: penyusutanBulanan(a),
    persen_tersusut: a.harga_perolehan
      ? Number((a.akumulasi_penyusutan / a.harga_perolehan * 100).toFixed(1)) : 0,
  }));
}

/**
 * Sumber perolehan aset:
 *   kas / transfer  D Aset Tetap            K Kas / Bank
 *   hutang          D Aset Tetap            K Utang Usaha
 *   saldo_awal      tanpa jurnal - aset sudah tercatat pada neraca pembuka
 *                   (dipakai saat memindahkan register aset lama ke sistem)
 */
export const SUMBER_PEROLEHAN = ['kas', 'transfer', 'hutang', 'saldo_awal'];

/** Akun aset/akumulasi/beban sebuah aset: isian aset, bila kosong dari Parameter Sistem. */
function akunAset(a) {
  return {
    aset: a.coa_aset || AKUN.aset_tetap(),
    akumulasi: a.coa_akumulasi || AKUN.akumulasi_penyusutan(),
    beban: a.coa_beban || AKUN.beban_penyusutan(),
  };
}

/** Mendaftarkan aset baru dan membukukan perolehannya secara otomatis. */
export function tambah(data, ctx) {
  const kode = String(data.kode || '').trim();
  if (!kode) throw badRequest('Kode aset wajib diisi');
  if (!String(data.nama || '').trim()) throw badRequest('Nama aset wajib diisi');
  if (get('SELECT id FROM aset_tetap WHERE kode = ?', [kode])) {
    throw conflict(`Kode aset "${kode}" sudah digunakan`);
  }
  const harga = rupiah(data.harga_perolehan);
  if (harga <= 0) throw badRequest('Harga perolehan harus lebih besar dari nol');
  const residu = rupiah(data.nilai_residu || 0);
  if (residu >= harga) throw badRequest('Nilai residu harus lebih kecil dari harga perolehan');
  // Kompatibilitas: klien lama mengirim buat_jurnal + metode_bayar.
  let sumber = data.sumber_perolehan
    || (data.buat_jurnal === false ? 'saldo_awal' : (data.metode_bayar === 'transfer' ? 'transfer' : 'kas'));
  if (!SUMBER_PEROLEHAN.includes(sumber)) throw badRequest(`Sumber perolehan "${sumber}" tidak dikenal`);
  const akumulasiAwal = sumber === 'saldo_awal' ? rupiah(data.akumulasi_awal || 0) : 0;
  if (akumulasiAwal < 0 || akumulasiAwal > harga - residu) {
    throw badRequest('Akumulasi penyusutan awal tidak boleh melebihi harga perolehan dikurangi nilai residu');
  }
  const coa = akunAset(data);
  const tanggal = data.tanggal_perolehan || today();

  return tx(() => {
    const { lastInsertRowid: id } = run(
      `INSERT INTO aset_tetap(kode, nama, kategori, tanggal_perolehan, harga_perolehan, nilai_residu,
         umur_manfaat, metode, akumulasi_penyusutan, nilai_buku, lokasi, cabang_id, unit_usaha_id,
         penanggung_jawab, coa_aset, coa_akumulasi, coa_beban, barcode)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [kode, data.nama, data.kategori || 'inventaris', tanggal, harga, residu,
        Number(data.umur_manfaat) || 4, data.metode || 'garis_lurus', akumulasiAwal, harga - akumulasiAwal,
        data.lokasi || null, data.cabang_id || null, data.unit_usaha_id || null, data.penanggung_jawab || null,
        coa.aset, coa.akumulasi, coa.beban, data.barcode || kode],
    );
    let jurnal = null;
    if (sumber !== 'saldo_awal') {
      const lawan = sumber === 'hutang' ? AKUN.hutang_usaha() : akunKasMetode(sumber, data.bank_account_id);
      jurnal = postJournal({
        tanggal, tipe: 'umum', referensi: `aset:${id}`,
        keterangan: `Perolehan aset ${kode} - ${data.nama}`,
        cabang_id: data.cabang_id, unit_usaha_id: data.unit_usaha_id,
        lines: [
          { coa_kode: coa.aset, debit: harga, keterangan: data.nama },
          { coa_kode: lawan, kredit: harga, keterangan: `Perolehan ${kode}` },
        ],
      }, ctx);
      if (sumber === 'hutang') {
        run(`INSERT INTO hutang_piutang(jenis, referensi, pihak, tanggal, jatuh_tempo, nominal)
             VALUES('hutang',?,?,?,?,?)`,
        [`aset:${id}`, data.pemasok || data.vendor || null, tanggal, data.jatuh_tempo || tanggal, harga]);
      }
    }
    logAudit(ctx, { aksi: 'create', modul: 'aset', entitas_id: id,
      keterangan: `Aset ${kode} - ${data.nama} senilai Rp ${harga.toLocaleString('id-ID')} (${sumber})`,
      after: { kode, nama: data.nama, harga, sumber } });
    return { id, kode, jurnal };
  });
}

/** Kolom aset yang boleh diubah sesudah didaftarkan. */
const KOLOM_UBAH = ['nama', 'kategori', 'lokasi', 'cabang_id', 'unit_usaha_id', 'penanggung_jawab', 'barcode',
  'umur_manfaat', 'metode', 'nilai_residu', 'coa_beban', 'status'];

/**
 * Mengubah data aset. Nilai perolehan dan akun aset/akumulasi tidak dapat
 * diubah karena sudah terbukukan; koreksinya melalui pelepasan atau jurnal
 * penyesuaian. Umur, metode, dan residu berlaku untuk penyusutan berikutnya.
 */
export function ubah(aset_id, data, ctx) {
  const a = get('SELECT * FROM aset_tetap WHERE id = ?', [aset_id]);
  if (!a) throw notFound('Aset tidak ditemukan');
  if (a.status === 'dilepas') throw conflict('Aset yang sudah dilepas tidak dapat diubah');
  const ubahan = {};
  for (const k of KOLOM_UBAH) if (data[k] !== undefined) ubahan[k] = data[k] === '' ? null : data[k];
  if (ubahan.status && !['aktif', 'maintenance', 'rusak'].includes(ubahan.status)) {
    throw badRequest('Status aset hanya dapat diubah menjadi aktif, maintenance, atau rusak (gunakan Pelepasan untuk melepas aset)');
  }
  if (ubahan.nilai_residu !== undefined) {
    ubahan.nilai_residu = rupiah(ubahan.nilai_residu || 0);
    if (ubahan.nilai_residu >= a.harga_perolehan) throw badRequest('Nilai residu harus lebih kecil dari harga perolehan');
  }
  if (ubahan.umur_manfaat !== undefined && !(Number(ubahan.umur_manfaat) > 0)) {
    throw badRequest('Umur manfaat harus lebih besar dari nol');
  }
  if (ubahan.coa_beban) {
    const akun = get('SELECT tipe, is_postable FROM coa WHERE kode = ?', [ubahan.coa_beban]);
    if (!akun || !akun.is_postable || akun.tipe !== 'beban') throw badRequest('Akun beban penyusutan tidak valid');
  }
  const kolom = Object.keys(ubahan);
  if (!kolom.length) throw badRequest('Tidak ada perubahan yang dikirim');
  run(`UPDATE aset_tetap SET ${kolom.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`,
    [...kolom.map((k) => ubahan[k]), aset_id]);
  const sesudah = get('SELECT * FROM aset_tetap WHERE id = ?', [aset_id]);
  logAudit(ctx, { aksi: 'update', modul: 'aset', entitas_id: aset_id,
    keterangan: `Aset ${a.kode} diubah`, before: a, after: sesudah });
  return sesudah;
}

/**
 * Menghapus aset yang salah input. Hanya boleh bila belum pernah disusutkan;
 * jurnal perolehannya dibatalkan dengan jurnal balik sehingga buku besar
 * kembali seperti sebelum aset didaftarkan.
 */
export function hapus(aset_id, ctx) {
  const a = get('SELECT * FROM aset_tetap WHERE id = ?', [aset_id]);
  if (!a) throw notFound('Aset tidak ditemukan');
  if (scalar('SELECT COUNT(*) FROM aset_penyusutan WHERE aset_id = ?', [aset_id]) > 0) {
    throw conflict(`Aset ${a.kode} sudah disusutkan dan tidak dapat dihapus`,
      'Gunakan Pelepasan Aset untuk mengeluarkan aset dari pembukuan.');
  }
  const hp = get("SELECT * FROM hutang_piutang WHERE referensi = ? AND jenis = 'hutang'", [`aset:${aset_id}`]);
  if (hp && hp.terbayar > 0) {
    throw conflict('Utang perolehan aset ini sudah dibayar sebagian sehingga aset tidak dapat dihapus');
  }
  return tx(() => {
    const jurnal = get("SELECT id FROM jurnal WHERE referensi = ? AND status = 'posted'", [`aset:${aset_id}`]);
    if (jurnal) voidJournal(jurnal.id, `Penghapusan aset ${a.kode} (salah input)`, ctx, { sistem: true });
    if (hp) run('DELETE FROM hutang_piutang WHERE id = ?', [hp.id]);
    run('DELETE FROM aset_maintenance WHERE aset_id = ?', [aset_id]);
    run('DELETE FROM aset_tetap WHERE id = ?', [aset_id]);
    logAudit(ctx, { aksi: 'delete', modul: 'aset', entitas_id: aset_id,
      keterangan: `Aset ${a.kode} - ${a.nama} dihapus`, before: a });
    return { dihapus: true, id: aset_id };
  });
}

/**
 * Menjalankan penyusutan seluruh aset untuk satu periode (YYYY-MM).
 * Idempoten: aset yang sudah disusutkan pada periode tersebut dilewati.
 */
export function jalankanPenyusutan(periode, ctx) {
  if (!/^\d{4}-\d{2}$/.test(String(periode || ''))) throw badRequest('Periode harus berformat YYYY-MM');
  const tgl = endOfMonth(periode);
  const aset = all(
    "SELECT * FROM aset_tetap WHERE status = 'aktif' AND kategori <> 'tanah' AND tanggal_perolehan <= ?", [tgl]);

  return tx(() => {
    const lines = [];
    const diproses = [];
    let total = 0;
    for (const a of aset) {
      if (get('SELECT id FROM aset_penyusutan WHERE aset_id = ? AND periode = ?', [a.id, periode])) continue;
      const nilaiBuku = a.harga_perolehan - a.akumulasi_penyusutan;
      if (nilaiBuku <= a.nilai_residu) continue;
      let susut = penyusutanBulanan(a);
      if (susut <= 0) continue;
      // Penyusutan tidak boleh membuat nilai buku turun di bawah nilai residu
      susut = Math.min(susut, nilaiBuku - a.nilai_residu);
      const akumulasi = a.akumulasi_penyusutan + susut;
      run(`INSERT INTO aset_penyusutan(aset_id, periode, nominal, akumulasi, nilai_buku)
           VALUES(?,?,?,?,?)`, [a.id, periode, susut, akumulasi, a.harga_perolehan - akumulasi]);
      run('UPDATE aset_tetap SET akumulasi_penyusutan = ?, nilai_buku = ? WHERE id = ?',
        [akumulasi, a.harga_perolehan - akumulasi, a.id]);
      const coa = akunAset(a);
      lines.push({ coa_kode: coa.beban, debit: susut,
        unit_usaha_id: a.unit_usaha_id, cabang_id: a.cabang_id, keterangan: `Penyusutan ${a.kode}` });
      lines.push({ coa_kode: coa.akumulasi, kredit: susut,
        unit_usaha_id: a.unit_usaha_id, cabang_id: a.cabang_id, keterangan: `Akumulasi penyusutan ${a.kode}` });
      total += susut;
      diproses.push({ kode: a.kode, nama: a.nama, penyusutan: susut, nilai_buku: a.harga_perolehan - akumulasi });
    }
    if (!diproses.length) {
      return { periode, jumlah_aset: 0, total: 0, pesan: 'Tidak ada aset yang perlu disusutkan pada periode ini' };
    }
    const jurnal = postJournal({
      tanggal: tgl, tipe: 'penyusutan', referensi: `penyusutan:${periode}`,
      keterangan: `Beban penyusutan aset tetap periode ${periode}`, lines,
    }, ctx);
    run(`UPDATE aset_penyusutan SET jurnal_id = ? WHERE periode = ? AND jurnal_id IS NULL`, [jurnal.id, periode]);
    logAudit(ctx, { aksi: 'post', modul: 'aset', entitas_id: periode,
      keterangan: `Penyusutan ${periode}: ${diproses.length} aset, total Rp ${total.toLocaleString('id-ID')}` });
    return { periode, jumlah_aset: diproses.length, total, detail: diproses, jurnal };
  });
}

/** Pelepasan aset (dijual / dihapuskan) beserta pengakuan laba-rugi pelepasan. */
export function disposal(aset_id, { tanggal, nilai_jual = 0, keterangan, metode = 'tunai', bank_account_id }, ctx) {
  const a = get('SELECT * FROM aset_tetap WHERE id = ?', [aset_id]);
  if (!a) throw notFound('Aset tidak ditemukan');
  if (a.status === 'dilepas') throw conflict('Aset ini sudah dilepas');
  const tgl = tanggal || today();
  const nilaiBuku = a.harga_perolehan - a.akumulasi_penyusutan;
  const hasil = rupiah(nilai_jual);
  const labaRugi = hasil - nilaiBuku;

  return tx(() => {
    const coa = akunAset(a);
    const lines = [];
    if (hasil > 0) {
      lines.push({ coa_kode: akunKasMetode(metode, bank_account_id), debit: hasil,
        keterangan: `Hasil pelepasan ${a.kode}` });
    }
    if (a.akumulasi_penyusutan > 0) {
      lines.push({ coa_kode: coa.akumulasi, debit: a.akumulasi_penyusutan,
        keterangan: `Penghapusan akumulasi penyusutan ${a.kode}` });
    }
    lines.push({ coa_kode: coa.aset, kredit: a.harga_perolehan,
      keterangan: `Pelepasan aset ${a.kode}` });
    if (labaRugi > 0) {
      lines.push({ coa_kode: AKUN.pendapatan_lain(), kredit: labaRugi, keterangan: 'Laba pelepasan aset' });
    } else if (labaRugi < 0) {
      lines.push({ coa_kode: AKUN.beban_lain(), debit: -labaRugi, keterangan: 'Rugi pelepasan aset' });
    }
    const jurnal = postJournal({
      tanggal: tgl, tipe: 'umum', referensi: `disposal:${aset_id}`,
      keterangan: `Pelepasan aset ${a.kode} - ${a.nama}. ${keterangan || ''}`.trim(),
      cabang_id: a.cabang_id, unit_usaha_id: a.unit_usaha_id, lines,
    }, ctx);
    run(`UPDATE aset_tetap SET status = 'dilepas', tanggal_disposal = ?, nilai_disposal = ?,
           nilai_buku = 0 WHERE id = ?`, [tgl, hasil, aset_id]);
    logAudit(ctx, { aksi: 'update', modul: 'aset', entitas_id: aset_id,
      keterangan: `Pelepasan ${a.kode}: nilai buku Rp ${nilaiBuku.toLocaleString('id-ID')}, `
        + `hasil Rp ${hasil.toLocaleString('id-ID')}, ${labaRugi >= 0 ? 'laba' : 'rugi'} Rp ${Math.abs(labaRugi).toLocaleString('id-ID')}`,
      before: a });
    return { nilai_buku: nilaiBuku, hasil, laba_rugi: labaRugi, jurnal };
  });
}

/**
 * Mencatat pemeliharaan aset. Biaya pemeliharaan langsung dibebankan:
 *   D Beban Pemeliharaan   K Kas / Bank / Utang Usaha
 */
export function maintenance(aset_id, data, ctx) {
  const a = get('SELECT * FROM aset_tetap WHERE id = ?', [aset_id]);
  if (!a) throw notFound('Aset tidak ditemukan');
  const biaya = rupiah(data.biaya || 0);
  if (biaya < 0) throw badRequest('Biaya pemeliharaan tidak boleh negatif');
  const tanggal = data.tanggal || today();
  const metode = data.metode_bayar || 'tunai';
  return tx(() => {
    let jurnal = null;
    if (biaya > 0) {
      const lawan = metode === 'hutang' ? AKUN.hutang_usaha() : akunKasMetode(metode, data.bank_account_id);
      jurnal = postJournal({
        tanggal, tipe: metode === 'hutang' ? 'umum' : 'kas_keluar', referensi: `maintenance:${aset_id}`,
        keterangan: `Pemeliharaan aset ${a.kode} - ${data.jenis || 'perawatan'}`,
        cabang_id: a.cabang_id, unit_usaha_id: a.unit_usaha_id,
        lines: [
          { coa_kode: AKUN.beban_pemeliharaan(), debit: biaya, keterangan: `Pemeliharaan ${a.kode}` },
          { coa_kode: lawan, kredit: biaya, keterangan: data.vendor || `Pemeliharaan ${a.kode}` },
        ],
      }, ctx);
      if (metode === 'hutang') {
        run(`INSERT INTO hutang_piutang(jenis, referensi, pihak, tanggal, jatuh_tempo, nominal)
             VALUES('hutang',?,?,?,?,?)`,
        [`maintenance:${aset_id}`, data.vendor || null, tanggal, data.jatuh_tempo || tanggal, biaya]);
      }
    }
    const { lastInsertRowid: id } = run(
      `INSERT INTO aset_maintenance(aset_id, tanggal, jenis, biaya, vendor, keterangan, jadwal_berikutnya)
       VALUES(?,?,?,?,?,?,?)`,
      [aset_id, tanggal, data.jenis || 'perawatan rutin', biaya,
        data.vendor || null, data.keterangan || null, data.jadwal_berikutnya || null],
    );
    logAudit(ctx, { aksi: 'create', modul: 'aset', entitas_id: aset_id,
      keterangan: `Pemeliharaan ${a.kode}: ${data.jenis || 'perawatan'} Rp ${biaya.toLocaleString('id-ID')}` });
    return { id, jurnal };
  });
}

/** Ringkasan aset untuk dashboard & laporan. */
export function ringkasan() {
  const perKategori = all(
    `SELECT kategori, COUNT(*) AS jumlah, COALESCE(SUM(harga_perolehan),0) AS perolehan,
            COALESCE(SUM(akumulasi_penyusutan),0) AS akumulasi,
            COALESCE(SUM(harga_perolehan - akumulasi_penyusutan),0) AS nilai_buku
       FROM aset_tetap WHERE status <> 'dilepas' GROUP BY kategori ORDER BY nilai_buku DESC`);
  return {
    per_kategori: perKategori,
    total_perolehan: perKategori.reduce((s, r) => s + r.perolehan, 0),
    total_akumulasi: perKategori.reduce((s, r) => s + r.akumulasi, 0),
    total_nilai_buku: perKategori.reduce((s, r) => s + r.nilai_buku, 0),
    jumlah_aset: scalar("SELECT COUNT(*) FROM aset_tetap WHERE status <> 'dilepas'"),
    perlu_maintenance: all(
      `SELECT a.kode, a.nama, m.jadwal_berikutnya FROM aset_maintenance m
         JOIN aset_tetap a ON a.id = m.aset_id
        WHERE m.jadwal_berikutnya IS NOT NULL AND m.jadwal_berikutnya <= date('now','+30 day')
        ORDER BY m.jadwal_berikutnya`),
  };
}
