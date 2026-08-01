/**
 * Modul 6 - SHU (Sisa Hasil Usaha).
 *
 * UU 25/1992 Pasal 45: SHU dibagikan kepada anggota sebanding dengan jasa
 * usaha yang dilakukan masing-masing anggota, setelah dikurangi dana cadangan.
 * Persentase alokasi mengikuti AD/ART dan disimpan pada modul Administrator.
 */
import { all, get, run, scalar, tx, settingNum, setting } from '../db.js';
import { badRequest, notFound, conflict } from '../lib/http.js';
import { logAudit, notify } from '../lib/audit.js';
import { labaRugi, postJournal, AKUN } from './accounting.js';
import { rupiah, today } from '../lib/util.js';

/** Komponen pembagian SHU beserta default sesuai praktik AD/ART umum. */
export const KOMPONEN = [
  { kode: 'cadangan', nama: 'Dana Cadangan', default: 25, coa: () => AKUN.cadangan() },
  { kode: 'jasa_modal', nama: 'Jasa Modal (Simpanan)', default: 20, coa: () => AKUN.shu_dibagikan() },
  { kode: 'jasa_usaha', nama: 'Jasa Usaha (Transaksi)', default: 30, coa: () => AKUN.shu_dibagikan() },
  { kode: 'dana_pengurus', nama: 'Dana Pengurus & Pengawas', default: 10, coa: () => setting('coa.dana_pengurus', '2-1402') },
  { kode: 'dana_karyawan', nama: 'Dana Kesejahteraan Karyawan', default: 5, coa: () => setting('coa.dana_karyawan', '2-1403') },
  { kode: 'dana_pendidikan', nama: 'Dana Pendidikan', default: 5, coa: () => setting('coa.dana_pendidikan', '2-1404') },
  { kode: 'dana_sosial', nama: 'Dana Sosial', default: 3, coa: () => setting('coa.dana_sosial', '2-1405') },
  { kode: 'dana_pembangunan', nama: 'Dana Pembangunan Daerah Kerja', default: 2, coa: () => setting('coa.dana_pembangunan', '2-1406') },
];

/**
 * Menyesuaikan pembulatan agar sekumpulan nominal berjumlah persis `target`.
 *
 * Pembagian menurut persentase selalu menyisakan pecahan rupiah. Bila selisih
 * itu dibiarkan, jurnal yang menyandingkan total dengan rinciannya akan ditolak
 * karena tidak seimbang. Selisih dititipkan pada baris bernominal terbesar -
 * dampaknya paling kecil secara relatif dan tidak pernah membuat baris menjadi
 * negatif.
 *
 * @param {Array<{nominal:number}>} baris diubah di tempat
 */
function seimbangkan(baris, target, kunci = 'nominal') {
  if (!baris.length) return baris;
  const selisih = target - baris.reduce((s, b) => s + b[kunci], 0);
  if (selisih === 0) return baris;
  // Bila seluruh baris masih nol - misalnya SHU yang begitu kecil sehingga
  // setiap komponen membulat ke nol - selisih dititipkan pada baris pertama,
  // yang menurut urutan KOMPONEN adalah dana cadangan.
  const berisi = baris.filter((b) => b[kunci] !== 0);
  const sasaran = berisi.length
    ? berisi.reduce((a, b) => (Math.abs(b[kunci]) > Math.abs(a[kunci]) ? b : a))
    : baris[0];
  sasaran[kunci] += selisih;
  return baris;
}

export function persentaseAlokasi() {
  return KOMPONEN.map((k) => ({
    ...k, persentase: settingNum(`shu.${k.kode}`, k.default),
  }));
}

/**
 * Rata-rata saldo simpanan seorang anggota selama tahun buku.
 * Pendekatan: (saldo awal tahun + saldo akhir tahun) / 2 - lazim dipakai koperasi.
 */
function simpananRataRata(tahun) {
  return all(
    `SELECT r.anggota_id,
            COALESCE(SUM(awal.saldo_awal), 0) AS saldo_awal,
            COALESCE(SUM(r.saldo), 0) AS saldo_akhir
       FROM rekening_simpanan r
       JOIN produk_simpanan p ON p.id = r.produk_id AND p.masuk_shu = 1
       LEFT JOIN (
         SELECT t.rekening_id, t.saldo_akhir AS saldo_awal
           FROM transaksi_simpanan t
           JOIN (SELECT rekening_id, MAX(id) AS mid FROM transaksi_simpanan
                  WHERE tanggal < ? GROUP BY rekening_id) x
             ON x.mid = t.id
       ) awal ON awal.rekening_id = r.id
      WHERE r.status <> 'tutup'
      GROUP BY r.anggota_id`,
    [`${tahun}-01-01`],
  ).map((r) => ({ anggota_id: r.anggota_id, rata: Math.round((r.saldo_awal + r.saldo_akhir) / 2) }));
}

/**
 * Nilai transaksi anggota selama tahun buku (dasar jasa usaha):
 * pembelian di toko koperasi + jasa pinjaman yang dibayarkan.
 */
function transaksiAnggota(tahun) {
  const belanja = all(
    `SELECT anggota_id, COALESCE(SUM(total),0) AS nilai FROM penjualan
      WHERE anggota_id IS NOT NULL AND status = 'selesai'
        AND substr(tanggal,1,4) = ? GROUP BY anggota_id`,
    [String(tahun)],
  );
  const jasa = all(
    `SELECT p.anggota_id, COALESCE(SUM(a.bayar_bunga),0) AS nilai
       FROM pinjaman_angsuran a JOIN pinjaman p ON p.id = a.pinjaman_id
      WHERE substr(a.tanggal,1,4) = ? GROUP BY p.anggota_id`,
    [String(tahun)],
  );
  const map = new Map();
  for (const b of belanja) map.set(b.anggota_id, (map.get(b.anggota_id) || 0) + b.nilai);
  for (const j of jasa) map.set(j.anggota_id, (map.get(j.anggota_id) || 0) + j.nilai);
  return [...map].map(([anggota_id, nilai]) => ({ anggota_id, nilai }));
}

/**
 * Simulasi pembagian SHU tahun tertentu. Tidak mengubah data keuangan.
 */
export function simulasi(tahun, shuOverride = null) {
  const lr = labaRugi({ dari: `${tahun}-01-01`, sampai: `${tahun}-12-31` });
  const shuBersih = shuOverride !== null ? rupiah(shuOverride) : lr.shu_bersih;
  const alokasi = persentaseAlokasi();
  const totalPersen = alokasi.reduce((s, a) => s + a.persentase, 0);
  if (Math.abs(totalPersen - 100) > 0.01) {
    throw badRequest(`Total persentase alokasi SHU harus 100% (saat ini ${totalPersen}%)`,
      'Perbaiki pada modul Administrator → Parameter SHU.');
  }

  const rincianAlokasi = alokasi.map((a) => ({
    komponen: a.kode, nama: a.nama, persentase: a.persentase,
    nominal: rupiah(shuBersih * a.persentase / 100), coa_kode: a.coa(),
  }));
  // Setiap komponen dibulatkan ke rupiah penuh, sehingga jumlahnya dapat
  // meleset beberapa rupiah dari SHU bersih. Selisih itu dibebankan ke
  // komponen terbesar - tanpa langkah ini jurnal pengesahan SHU tidak akan
  // pernah seimbang dan pembagian gagal diposting.
  seimbangkan(rincianAlokasi, shuBersih);

  const poolModal = rincianAlokasi.find((a) => a.komponen === 'jasa_modal')?.nominal || 0;
  const poolUsaha = rincianAlokasi.find((a) => a.komponen === 'jasa_usaha')?.nominal || 0;

  const simpanan = simpananRataRata(tahun);
  const transaksi = transaksiAnggota(tahun);
  const totalSimpanan = simpanan.reduce((s, r) => s + r.rata, 0);
  const totalTransaksi = transaksi.reduce((s, r) => s + r.nilai, 0);

  const anggotaAktif = all(
    "SELECT id, nomor_anggota, nama FROM anggota WHERE status = 'aktif' ORDER BY nomor_anggota");
  const mapSim = new Map(simpanan.map((s) => [s.anggota_id, s.rata]));
  const mapTrx = new Map(transaksi.map((t) => [t.anggota_id, t.nilai]));

  const perAnggota = anggotaAktif.map((a) => {
    const sim = mapSim.get(a.id) || 0;
    const trx = mapTrx.get(a.id) || 0;
    const jm = totalSimpanan > 0 ? rupiah(poolModal * sim / totalSimpanan) : 0;
    const ju = totalTransaksi > 0 ? rupiah(poolUsaha * trx / totalTransaksi) : 0;
    return {
      anggota_id: a.id, nomor_anggota: a.nomor_anggota, nama: a.nama,
      simpanan_rata: sim, nilai_transaksi: trx,
      shu_jasa_modal: jm, shu_jasa_usaha: ju, shu_total: jm + ju,
    };
  }).filter((r) => r.shu_total > 0 || r.simpanan_rata > 0);

  // Pembulatan per anggota juga disesuaikan supaya jumlah yang dibagikan persis
  // sama dengan pool jasa modal dan jasa usaha. Bila tidak, akun "SHU Yang Akan
  // Dibagikan" menyisakan saldo receh yang tidak pernah bisa dinolkan.
  seimbangkan(perAnggota, poolModal, 'shu_jasa_modal');
  seimbangkan(perAnggota, poolUsaha, 'shu_jasa_usaha');
  for (const r of perAnggota) r.shu_total = r.shu_jasa_modal + r.shu_jasa_usaha;

  return {
    tahun,
    shu_bersih: shuBersih,
    total_pendapatan: lr.total_pendapatan,
    total_beban: lr.total_beban,
    alokasi: rincianAlokasi,
    dasar: { total_simpanan: totalSimpanan, total_transaksi: totalTransaksi, jumlah_anggota: perAnggota.length },
    per_anggota: perAnggota,
    total_dibagikan: perAnggota.reduce((s, r) => s + r.shu_total, 0),
  };
}

/** Menyimpan hasil simulasi sebagai usulan pembagian SHU (menunggu RAT). */
export function simpanUsulan(tahun, shuOverride, ctx) {
  const hasil = simulasi(tahun, shuOverride);
  const ada = get('SELECT * FROM shu_periode WHERE tahun = ?', [tahun]);
  if (ada && ['disetujui', 'dibagikan'].includes(ada.status)) {
    throw conflict(`Pembagian SHU tahun ${tahun} sudah ${ada.status} dan tidak dapat diubah`);
  }
  return tx(() => {
    let periodeId;
    if (ada) {
      periodeId = ada.id;
      run(`UPDATE shu_periode SET shu_bersih = ?, total_simpanan = ?, total_transaksi = ?,
             status = 'diajukan' WHERE id = ?`,
      [hasil.shu_bersih, hasil.dasar.total_simpanan, hasil.dasar.total_transaksi, periodeId]);
      run('DELETE FROM shu_alokasi WHERE periode_id = ?', [periodeId]);
      run('DELETE FROM shu_anggota WHERE periode_id = ?', [periodeId]);
    } else {
      periodeId = run(
        `INSERT INTO shu_periode(tahun, shu_bersih, total_simpanan, total_transaksi, status)
         VALUES(?,?,?,?,'diajukan')`,
        [tahun, hasil.shu_bersih, hasil.dasar.total_simpanan, hasil.dasar.total_transaksi],
      ).lastInsertRowid;
    }
    for (const a of hasil.alokasi) {
      run('INSERT INTO shu_alokasi(periode_id, komponen, persentase, nominal, coa_kode) VALUES(?,?,?,?,?)',
        [periodeId, a.komponen, a.persentase, a.nominal, a.coa_kode]);
    }
    for (const p of hasil.per_anggota) {
      run(`INSERT INTO shu_anggota(periode_id, anggota_id, simpanan_rata, nilai_transaksi,
             shu_jasa_modal, shu_jasa_usaha, shu_total) VALUES(?,?,?,?,?,?,?)`,
      [periodeId, p.anggota_id, p.simpanan_rata, p.nilai_transaksi, p.shu_jasa_modal, p.shu_jasa_usaha, p.shu_total]);
    }
    logAudit(ctx, { aksi: 'create', modul: 'shu', entitas_id: periodeId,
      keterangan: `Usulan pembagian SHU tahun ${tahun} sebesar Rp ${hasil.shu_bersih.toLocaleString('id-ID')}`,
      after: { tahun, shu_bersih: hasil.shu_bersih, jumlah_anggota: hasil.per_anggota.length } });
    notify({ role: 'pengurus', judul: 'Usulan pembagian SHU menunggu persetujuan RAT',
      pesan: `Tahun buku ${tahun} - Rp ${hasil.shu_bersih.toLocaleString('id-ID')}`, tipe: 'info', link: '#/shu' });
    return { periode_id: periodeId, ...hasil };
  });
}

/**
 * Pengesahan SHU oleh RAT dan pembukuannya.
 *
 * Jurnal:
 *   D  SHU Tahun Berjalan
 *      K  Dana Cadangan (ekuitas)
 *      K  SHU Yang Akan Dibagikan / dana-dana (kewajiban)
 */
export function sahkan(periode_id, { rat_id, tanggal }, ctx) {
  const periode = get('SELECT * FROM shu_periode WHERE id = ?', [periode_id]);
  if (!periode) throw notFound('Periode SHU tidak ditemukan');
  if (periode.status === 'dibagikan') throw conflict('SHU periode ini sudah dibagikan');
  if (periode.status === 'disetujui') throw conflict('SHU periode ini sudah disahkan');
  const alokasi = all('SELECT * FROM shu_alokasi WHERE periode_id = ?', [periode_id]);
  if (!alokasi.length) throw badRequest('Belum ada rincian alokasi. Jalankan simulasi terlebih dahulu.');
  const tgl = tanggal || `${periode.tahun}-12-31`;

  return tx(() => {
    const lines = [{ coa_kode: AKUN.shu_berjalan(), debit: periode.shu_bersih,
      keterangan: `Pembagian SHU tahun buku ${periode.tahun}` }];
    for (const a of alokasi) {
      if (a.nominal > 0) lines.push({ coa_kode: a.coa_kode, kredit: a.nominal, keterangan: a.komponen });
    }
    const jurnal = postJournal({
      tanggal: tgl, tipe: 'shu', referensi: `shu:${periode_id}`,
      keterangan: `Pengesahan pembagian SHU tahun buku ${periode.tahun}`, lines,
    }, ctx);
    run(`UPDATE shu_periode SET status = 'disetujui', disetujui_oleh = ?, disetujui_pada = datetime('now'),
           rat_id = ?, jurnal_id = ? WHERE id = ?`,
    [ctx?.user?.username || 'sistem', rat_id || null, jurnal.id, periode_id]);
    logAudit(ctx, { aksi: 'approve', modul: 'shu', entitas_id: periode_id,
      keterangan: `SHU tahun ${periode.tahun} disahkan RAT sebesar Rp ${periode.shu_bersih.toLocaleString('id-ID')}` });
    return { periode_id, jurnal };
  });
}

/**
 * Distribusi SHU ke anggota (tunai atau menambah simpanan sukarela).
 */
export function bagikan(periode_id, { metode = 'simpanan', tanggal }, ctx) {
  const periode = get('SELECT * FROM shu_periode WHERE id = ?', [periode_id]);
  if (!periode) throw notFound('Periode SHU tidak ditemukan');
  if (periode.status !== 'disetujui') {
    throw conflict('SHU harus disahkan terlebih dahulu melalui RAT sebelum dibagikan');
  }
  const daftar = all('SELECT * FROM shu_anggota WHERE periode_id = ? AND shu_total > 0 AND dibayar = 0', [periode_id]);
  if (!daftar.length) throw badRequest('Tidak ada SHU anggota yang perlu dibagikan');
  const tgl = tanggal || today();

  return tx(() => {
    const total = daftar.reduce((s, r) => s + r.shu_total, 0);
    const lines = [{ coa_kode: AKUN.shu_dibagikan(), debit: total, keterangan: `Distribusi SHU ${periode.tahun}` }];

    if (metode === 'tunai') {
      lines.push({ coa_kode: AKUN.kas(), kredit: total, keterangan: 'Pembayaran SHU tunai' });
    } else {
      // Dikreditkan ke rekening simpanan sukarela masing-masing anggota
      const produk = get("SELECT * FROM produk_simpanan WHERE jenis = 'sukarela' AND status = 'aktif' LIMIT 1");
      if (!produk) throw badRequest('Produk simpanan sukarela tidak tersedia untuk menampung SHU');
      for (const d of daftar) {
        let rek = get('SELECT * FROM rekening_simpanan WHERE anggota_id = ? AND produk_id = ? AND status = ?',
          [d.anggota_id, produk.id, 'aktif']);
        if (!rek) {
          const nomor = `SKR${String(d.anggota_id).padStart(6, '0')}`;
          const id = run(
            `INSERT INTO rekening_simpanan(nomor_rekening, anggota_id, produk_id, saldo, tanggal_buka)
             VALUES(?,?,?,0,?)`, [nomor, d.anggota_id, produk.id, tgl]).lastInsertRowid;
          rek = get('SELECT * FROM rekening_simpanan WHERE id = ?', [id]);
        }
        const saldoBaru = rek.saldo + d.shu_total;
        run(`INSERT INTO transaksi_simpanan(nomor, rekening_id, tanggal, jenis, kredit, saldo_akhir,
               keterangan, metode, petugas)
             VALUES(?,?,?,'setoran',?,?,?,'pindah_buku',?)`,
        [`SHU${periode.tahun}-${d.anggota_id}`, rek.id, tgl, d.shu_total, saldoBaru,
          `Pembagian SHU tahun buku ${periode.tahun}`, ctx?.user?.username || 'sistem']);
        run('UPDATE rekening_simpanan SET saldo = ? WHERE id = ?', [saldoBaru, rek.id]);
      }
      lines.push({ coa_kode: produk.coa_kode, kredit: total, keterangan: 'SHU dikreditkan ke simpanan sukarela' });
    }

    const jurnal = postJournal({
      tanggal: tgl, tipe: 'shu', referensi: `distribusi:${periode_id}`,
      keterangan: `Distribusi SHU tahun ${periode.tahun} secara ${metode}`, lines,
    }, ctx);
    run(`UPDATE shu_anggota SET dibayar = 1, metode_bayar = ?, tanggal_bayar = ?
          WHERE periode_id = ? AND shu_total > 0`, [metode, tgl, periode_id]);
    run("UPDATE shu_periode SET status = 'dibagikan' WHERE id = ?", [periode_id]);
    logAudit(ctx, { aksi: 'post', modul: 'shu', entitas_id: periode_id,
      keterangan: `Distribusi SHU ${periode.tahun}: ${daftar.length} anggota, Rp ${total.toLocaleString('id-ID')} (${metode})` });
    return { jumlah_anggota: daftar.length, total, metode, jurnal };
  });
}

/** Riwayat SHU seorang anggota (untuk portal & mobile). */
export function riwayatAnggota(anggota_id) {
  return all(
    `SELECT s.*, p.tahun, p.status AS status_periode
       FROM shu_anggota s JOIN shu_periode p ON p.id = s.periode_id
      WHERE s.anggota_id = ? ORDER BY p.tahun DESC`,
    [anggota_id],
  );
}

export function daftarPeriode() {
  return all(
    `SELECT p.*, (SELECT COUNT(*) FROM shu_anggota WHERE periode_id = p.id) AS jumlah_anggota,
            (SELECT COALESCE(SUM(shu_total),0) FROM shu_anggota WHERE periode_id = p.id) AS total_dibagikan
       FROM shu_periode p ORDER BY p.tahun DESC`,
  );
}
