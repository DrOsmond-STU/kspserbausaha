/**
 * Modul 4 - Simpanan.
 *
 * Simpanan Pokok & Wajib diperlakukan sebagai EKUITAS koperasi (UU 25/1992
 * Pasal 41), sedangkan Simpanan Sukarela / Berjangka / Deposito merupakan
 * KEWAJIBAN. Klasifikasi ditentukan oleh akun pada master produk simpanan.
 */
import { all, get, run, scalar, nextNumber, tx } from '../db.js';
import { badRequest, notFound, conflict } from '../lib/http.js';
import { logAudit } from '../lib/audit.js';
import { postJournal, voidJournal, AKUN, akunKasMetode } from './accounting.js';
import { addMonths, diffDays, rupiah, today } from '../lib/util.js';

/** Membuka rekening simpanan baru. */
export function bukaRekening({ anggota_id, produk_id, tanggal_buka, setoran_awal = 0, cabang_id }, ctx) {
  const anggota = get('SELECT * FROM anggota WHERE id = ?', [anggota_id]);
  if (!anggota) throw notFound('Anggota tidak ditemukan');
  if (!['aktif', 'calon'].includes(anggota.status)) {
    throw conflict(`Anggota berstatus "${anggota.status}" tidak dapat membuka rekening simpanan`);
  }
  const produk = get("SELECT * FROM produk_simpanan WHERE id = ? AND status = 'aktif'", [produk_id]);
  if (!produk) throw notFound('Produk simpanan tidak ditemukan atau tidak aktif');

  // Simpanan pokok & wajib bersifat tunggal per anggota
  if (['pokok', 'wajib'].includes(produk.jenis)) {
    const ada = get(
      `SELECT r.id FROM rekening_simpanan r JOIN produk_simpanan p ON p.id = r.produk_id
        WHERE r.anggota_id = ? AND p.jenis = ? AND r.status <> 'tutup'`,
      [anggota_id, produk.jenis],
    );
    if (ada) throw conflict(`Anggota sudah memiliki rekening simpanan ${produk.jenis}`);
  }
  if (setoran_awal > 0 && setoran_awal < produk.setoran_minimal) {
    throw badRequest(`Setoran awal minimal Rp ${produk.setoran_minimal.toLocaleString('id-ID')}`);
  }

  return tx(() => {
    const tanggal = tanggal_buka || today();
    const nomor = nextNumber(`REK${produk.kode}`, tanggal).replace(/\//g, '');
    const jatuhTempo = produk.tenor_bulan > 0 ? addMonths(tanggal, produk.tenor_bulan) : null;
    const { lastInsertRowid: id } = run(
      `INSERT INTO rekening_simpanan(nomor_rekening, anggota_id, produk_id, cabang_id, saldo,
                                     tanggal_buka, tanggal_jatuh_tempo)
       VALUES(?,?,?,?,0,?,?)`,
      [nomor, anggota_id, produk_id, cabang_id ?? anggota.cabang_id ?? null, tanggal, jatuhTempo],
    );
    logAudit(ctx, { aksi: 'create', modul: 'simpanan', entitas_id: id,
      keterangan: `Rekening ${nomor} (${produk.nama}) atas nama ${anggota.nama}`,
      after: { nomor, anggota: anggota.nama, produk: produk.nama } });

    if (setoran_awal > 0) {
      setoran({ rekening_id: id, tanggal, nominal: setoran_awal, keterangan: 'Setoran awal pembukaan rekening' }, ctx);
    }
    return get('SELECT * FROM rekening_simpanan WHERE id = ?', [id]);
  });
}

function ambilRekening(rekening_id) {
  const rek = get(
    `SELECT r.*, p.jenis, p.nama AS produk_nama, p.coa_kode, p.boleh_tarik, p.setoran_minimal,
            p.coa_beban_bunga, p.bunga_tahunan, a.nama AS anggota_nama, a.nomor_anggota, a.status AS anggota_status
       FROM rekening_simpanan r
       JOIN produk_simpanan p ON p.id = r.produk_id
       JOIN anggota a ON a.id = r.anggota_id
      WHERE r.id = ?`,
    [rekening_id],
  );
  if (!rek) throw notFound('Rekening simpanan tidak ditemukan');
  return rek;
}

function catatMutasi({ rek, tanggal, jenis, debit = 0, kredit = 0, keterangan, metode, bank_account_id, jurnal_id }, ctx) {
  const saldoBaru = rek.saldo + kredit - debit;
  const nomor = nextNumber('TSP', tanggal);
  const { lastInsertRowid: id } = run(
    `INSERT INTO transaksi_simpanan(nomor, rekening_id, tanggal, jenis, debit, kredit, saldo_akhir,
                                    keterangan, jurnal_id, metode, bank_account_id, petugas)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    [nomor, rek.id, tanggal, jenis, debit, kredit, saldoBaru, keterangan || null,
      jurnal_id || null, metode || 'tunai', bank_account_id || null, ctx?.user?.username || 'sistem'],
  );
  run('UPDATE rekening_simpanan SET saldo = ? WHERE id = ?', [saldoBaru, rek.id]);
  return { id, nomor, saldo_akhir: saldoBaru };
}

/** Setoran simpanan. */
export function setoran({ rekening_id, tanggal, nominal, keterangan, metode = 'tunai', bank_account_id }, ctx) {
  const rek = ambilRekening(rekening_id);
  if (rek.status !== 'aktif') throw conflict(`Rekening berstatus "${rek.status}", transaksi ditolak`);
  const nom = rupiah(nominal);
  if (nom <= 0) throw badRequest('Nominal setoran harus lebih besar dari nol');
  if (rek.setoran_minimal && nom < rek.setoran_minimal && rek.saldo > 0) {
    throw badRequest(`Setoran minimal Rp ${rek.setoran_minimal.toLocaleString('id-ID')}`);
  }
  const tgl = tanggal || today();

  return tx(() => {
    const akunKas = akunKasMetode(metode, metode === 'transfer' ? bank_account_id : null);

    const jurnal = postJournal({
      tanggal: tgl, tipe: 'simpanan', referensi: `simpanan:${rekening_id}`,
      keterangan: `Setoran ${rek.produk_nama} - ${rek.anggota_nama}`,
      cabang_id: rek.cabang_id,
      lines: [
        { coa_kode: akunKas, debit: nom, keterangan: `Setoran ${rek.nomor_rekening}` },
        { coa_kode: rek.coa_kode, kredit: nom, anggota_id: rek.anggota_id,
          keterangan: `${rek.produk_nama} - ${rek.anggota_nama}` },
      ],
    }, ctx);

    const mut = catatMutasi({ rek, tanggal: tgl, jenis: 'setoran', kredit: nom,
      keterangan: keterangan || `Setoran ${rek.produk_nama}`, metode, bank_account_id, jurnal_id: jurnal.id }, ctx);
    logAudit(ctx, { aksi: 'create', modul: 'simpanan', entitas_id: mut.id,
      keterangan: `Setoran ${mut.nomor} Rp ${nom.toLocaleString('id-ID')} ke ${rek.nomor_rekening}`,
      after: { nominal: nom, saldo_akhir: mut.saldo_akhir } });
    return { ...mut, jurnal };
  });
}

/** Penarikan simpanan. */
export function penarikan({ rekening_id, tanggal, nominal, keterangan, metode = 'tunai', bank_account_id }, ctx) {
  const rek = ambilRekening(rekening_id);
  if (rek.status !== 'aktif') throw conflict(`Rekening berstatus "${rek.status}", transaksi ditolak`);
  if (!rek.boleh_tarik) {
    throw conflict(`Simpanan ${rek.produk_nama} tidak dapat ditarik sewaktu-waktu`,
      'Simpanan pokok & wajib hanya dapat dikembalikan pada saat anggota keluar dari koperasi.');
  }
  const nom = rupiah(nominal);
  if (nom <= 0) throw badRequest('Nominal penarikan harus lebih besar dari nol');

  const tersedia = rek.saldo - rek.saldo_blokir;
  if (nom > tersedia) {
    throw conflict('Saldo tidak mencukupi',
      `Saldo tersedia Rp ${tersedia.toLocaleString('id-ID')} (saldo Rp ${rek.saldo.toLocaleString('id-ID')}, `
      + `diblokir sebagai agunan Rp ${rek.saldo_blokir.toLocaleString('id-ID')})`);
  }
  if (rek.tanggal_jatuh_tempo && diffDays(rek.tanggal_jatuh_tempo, tanggal || today()) > 0) {
    throw conflict(`Simpanan berjangka belum jatuh tempo (${rek.tanggal_jatuh_tempo})`);
  }
  const tgl = tanggal || today();

  return tx(() => {
    const akunKas = akunKasMetode(metode, metode === 'transfer' ? bank_account_id : null);
    const jurnal = postJournal({
      tanggal: tgl, tipe: 'simpanan', referensi: `simpanan:${rekening_id}`,
      keterangan: `Penarikan ${rek.produk_nama} - ${rek.anggota_nama}`,
      cabang_id: rek.cabang_id,
      lines: [
        { coa_kode: rek.coa_kode, debit: nom, anggota_id: rek.anggota_id,
          keterangan: `Penarikan ${rek.nomor_rekening}` },
        { coa_kode: akunKas, kredit: nom, keterangan: `Penarikan ${rek.anggota_nama}` },
      ],
    }, ctx);
    const mut = catatMutasi({ rek, tanggal: tgl, jenis: 'penarikan', debit: nom,
      keterangan: keterangan || `Penarikan ${rek.produk_nama}`, metode, bank_account_id, jurnal_id: jurnal.id }, ctx);
    logAudit(ctx, { aksi: 'create', modul: 'simpanan', entitas_id: mut.id,
      keterangan: `Penarikan ${mut.nomor} Rp ${nom.toLocaleString('id-ID')} dari ${rek.nomor_rekening}`,
      after: { nominal: nom, saldo_akhir: mut.saldo_akhir } });
    return { ...mut, jurnal };
  });
}

/** Pemindahbukuan antar rekening simpanan. */
export function pindahBuku({ dari_rekening_id, ke_rekening_id, tanggal, nominal, keterangan }, ctx) {
  if (dari_rekening_id === ke_rekening_id) throw badRequest('Rekening asal dan tujuan tidak boleh sama');
  const asal = ambilRekening(dari_rekening_id);
  const tujuan = ambilRekening(ke_rekening_id);
  const nom = rupiah(nominal);
  if (nom <= 0) throw badRequest('Nominal harus lebih besar dari nol');
  if (nom > asal.saldo - asal.saldo_blokir) throw conflict('Saldo rekening asal tidak mencukupi');
  const tgl = tanggal || today();

  return tx(() => {
    const jurnal = postJournal({
      tanggal: tgl, tipe: 'simpanan', referensi: `pindahbuku:${dari_rekening_id}-${ke_rekening_id}`,
      keterangan: keterangan || `Pindah buku ${asal.nomor_rekening} ke ${tujuan.nomor_rekening}`,
      lines: [
        { coa_kode: asal.coa_kode, debit: nom, anggota_id: asal.anggota_id },
        { coa_kode: tujuan.coa_kode, kredit: nom, anggota_id: tujuan.anggota_id },
      ],
    }, ctx);
    const a = catatMutasi({ rek: asal, tanggal: tgl, jenis: 'pindah_buku', debit: nom,
      keterangan: `Pindah buku ke ${tujuan.nomor_rekening}`, metode: 'pindah_buku', jurnal_id: jurnal.id }, ctx);
    const b = catatMutasi({ rek: tujuan, tanggal: tgl, jenis: 'pindah_buku', kredit: nom,
      keterangan: `Pindah buku dari ${asal.nomor_rekening}`, metode: 'pindah_buku', jurnal_id: jurnal.id }, ctx);
    logAudit(ctx, { aksi: 'create', modul: 'simpanan', entitas_id: a.id,
      keterangan: `Pindah buku Rp ${nom.toLocaleString('id-ID')}: ${asal.nomor_rekening} → ${tujuan.nomor_rekening}` });
    return { asal: a, tujuan: b, jurnal };
  });
}

/**
 * Perhitungan & pembukuan jasa simpanan (bunga) bulanan.
 * Bunga dihitung dari saldo akhir bulan x (bunga_tahunan / 12).
 */
export function posBungaBulanan({ periode, tanggal }, ctx) {
  const tgl = tanggal || `${periode}-28`;
  const rekening = all(
    `SELECT r.id, r.saldo, r.cabang_id, r.anggota_id, r.nomor_rekening,
            p.bunga_tahunan, p.coa_kode, p.coa_beban_bunga, p.nama AS produk_nama
       FROM rekening_simpanan r JOIN produk_simpanan p ON p.id = r.produk_id
      WHERE r.status = 'aktif' AND p.bunga_tahunan > 0 AND r.saldo > 0`,
  );
  if (!rekening.length) return { periode, jumlah_rekening: 0, total_bunga: 0 };

  return tx(() => {
    let total = 0;
    const lines = [];
    const detail = [];
    for (const r of rekening) {
      const sudah = get(
        "SELECT id FROM transaksi_simpanan WHERE rekening_id = ? AND jenis = 'bunga' AND substr(tanggal,1,7) = ?",
        [r.id, periode],
      );
      if (sudah) continue;
      const bunga = rupiah((r.saldo * (r.bunga_tahunan / 100)) / 12);
      if (bunga <= 0) continue;
      total += bunga;
      lines.push({ coa_kode: r.coa_beban_bunga || AKUN.beban_bunga_simpanan(), debit: bunga,
        anggota_id: r.anggota_id, keterangan: `Jasa simpanan ${r.nomor_rekening}` });
      lines.push({ coa_kode: r.coa_kode, kredit: bunga, anggota_id: r.anggota_id,
        keterangan: `Jasa simpanan ${r.nomor_rekening}` });
      detail.push({ rekening: r, bunga });
    }
    if (!detail.length) return { periode, jumlah_rekening: 0, total_bunga: 0, pesan: 'Jasa simpanan periode ini sudah pernah diposting' };

    const jurnal = postJournal({
      tanggal: tgl, tipe: 'simpanan', referensi: `bunga:${periode}`,
      keterangan: `Pembebanan jasa simpanan periode ${periode}`, lines,
    }, ctx);

    for (const d of detail) {
      const rek = ambilRekening(d.rekening.id);
      catatMutasi({ rek, tanggal: tgl, jenis: 'bunga', kredit: d.bunga,
        keterangan: `Jasa simpanan periode ${periode}`, metode: 'pindah_buku', jurnal_id: jurnal.id }, ctx);
    }
    logAudit(ctx, { aksi: 'post', modul: 'simpanan', entitas_id: periode,
      keterangan: `Jasa simpanan ${periode}: ${detail.length} rekening, total Rp ${total.toLocaleString('id-ID')}` });
    return { periode, jumlah_rekening: detail.length, total_bunga: total, jurnal };
  });
}

/**
 * Membatalkan transaksi setoran / penarikan yang salah input.
 * Transaksi asli tetap tersimpan (status "batal"); saldo dikoreksi lewat
 * mutasi "koreksi" dan jurnalnya dibalik - jejak audit tetap utuh.
 */
export function batalTransaksi(transaksi_id, alasan, ctx) {
  const t = get('SELECT * FROM transaksi_simpanan WHERE id = ?', [transaksi_id]);
  if (!t) throw notFound('Transaksi simpanan tidak ditemukan');
  if (t.status === 'batal') throw conflict('Transaksi ini sudah dibatalkan');
  if (!['setoran', 'penarikan'].includes(t.jenis)) {
    throw conflict(`Transaksi jenis "${t.jenis}" tidak dapat dibatalkan dari sini`,
      'Jasa simpanan, pindah buku, dan pembayaran belanja dibatalkan melalui modul asalnya.');
  }
  if (!t.jurnal_id) throw conflict('Transaksi ini tidak memiliki jurnal sehingga tidak dapat dibatalkan otomatis');
  const lain = scalar('SELECT COUNT(*) FROM transaksi_simpanan WHERE jurnal_id = ? AND id <> ?', [t.jurnal_id, t.id]);
  if (lain > 0) throw conflict('Jurnal transaksi ini dipakai bersama transaksi lain sehingga tidak dapat dibatalkan sendiri');
  if (!String(alasan || '').trim()) throw badRequest('Alasan pembatalan wajib diisi');
  const rek = ambilRekening(t.rekening_id);
  if (t.jenis === 'setoran' && rek.saldo - rek.saldo_blokir < t.kredit) {
    throw conflict('Saldo rekening tidak mencukupi untuk membatalkan setoran ini',
      `Saldo tersedia Rp ${(rek.saldo - rek.saldo_blokir).toLocaleString('id-ID')}`);
  }

  return tx(() => {
    const jurnal = voidJournal(t.jurnal_id, `Pembatalan ${t.nomor}: ${alasan}`, ctx, { sistem: true });
    const mut = catatMutasi({ rek, tanggal: today(), jenis: 'koreksi', debit: t.kredit, kredit: t.debit,
      keterangan: `Koreksi pembatalan ${t.nomor}: ${alasan}`, metode: t.metode, jurnal_id: jurnal.id }, ctx);
    run("UPDATE transaksi_simpanan SET status = 'batal' WHERE id = ?", [t.id]);
    logAudit(ctx, { aksi: 'void', modul: 'simpanan', entitas_id: t.id,
      keterangan: `Transaksi ${t.nomor} dibatalkan: ${alasan}`, before: t });
    return { ...mut, jurnal };
  });
}

/**
 * Menutup rekening simpanan: saldo dikembalikan kepada anggota (tunai/bank)
 * dan dijurnal otomatis, lalu rekening berstatus "tutup". Simpanan pokok &
 * wajib hanya dapat ditutup bila anggota sudah keluar (UU 25/1992 Pasal 41).
 */
export function tutupRekening(rekening_id, { tanggal, metode = 'tunai', bank_account_id, keterangan } = {}, ctx) {
  const rek = ambilRekening(rekening_id);
  if (rek.status === 'tutup') throw conflict('Rekening ini sudah ditutup');
  if (['pokok', 'wajib'].includes(rek.jenis) && !['keluar', 'meninggal'].includes(rek.anggota_status)) {
    throw conflict(`Simpanan ${rek.jenis} hanya dapat dikembalikan ketika anggota keluar dari koperasi`);
  }
  if (rek.saldo_blokir > 0) throw conflict('Sebagian saldo masih diblokir sebagai agunan pinjaman');
  if (rek.saldo < 0) throw conflict('Saldo rekening negatif; lakukan koreksi terlebih dahulu');
  const tgl = tanggal || today();

  return tx(() => {
    let jurnal = null;
    if (rek.saldo > 0) {
      jurnal = postJournal({
        tanggal: tgl, tipe: 'simpanan', referensi: `simpanan:${rek.id}`,
        keterangan: `Pengembalian ${rek.produk_nama} ${rek.nomor_rekening} - ${rek.anggota_nama} (tutup rekening)`,
        cabang_id: rek.cabang_id,
        lines: [
          { coa_kode: rek.coa_kode, debit: rek.saldo, anggota_id: rek.anggota_id,
            keterangan: `Pengembalian ${rek.nomor_rekening}` },
          { coa_kode: akunKasMetode(metode, bank_account_id), kredit: rek.saldo,
            keterangan: `Pengembalian simpanan ${rek.anggota_nama}` },
        ],
      }, ctx);
      catatMutasi({ rek, tanggal: tgl, jenis: 'penarikan', debit: rek.saldo,
        keterangan: keterangan || 'Pengembalian saldo - penutupan rekening', metode, bank_account_id,
        jurnal_id: jurnal.id }, ctx);
    }
    run("UPDATE rekening_simpanan SET status = 'tutup' WHERE id = ?", [rek.id]);
    logAudit(ctx, { aksi: 'update', modul: 'simpanan', entitas_id: rek.id,
      keterangan: `Rekening ${rek.nomor_rekening} ditutup, saldo Rp ${rek.saldo.toLocaleString('id-ID')} dikembalikan`,
      before: { status: rek.status, saldo: rek.saldo } });
    return { rekening_id: rek.id, dikembalikan: rek.saldo, jurnal };
  });
}

/** Ringkasan simpanan seorang anggota. */
export function ringkasanAnggota(anggota_id) {
  const rekening = all(
    `SELECT r.*, p.nama AS produk_nama, p.jenis, p.bunga_tahunan, p.boleh_tarik
       FROM rekening_simpanan r JOIN produk_simpanan p ON p.id = r.produk_id
      WHERE r.anggota_id = ? ORDER BY p.jenis`,
    [anggota_id],
  );
  return {
    rekening,
    total_simpanan: rekening.filter((r) => r.status !== 'tutup').reduce((s, r) => s + r.saldo, 0),
    total_pokok: rekening.filter((r) => r.jenis === 'pokok').reduce((s, r) => s + r.saldo, 0),
    total_wajib: rekening.filter((r) => r.jenis === 'wajib').reduce((s, r) => s + r.saldo, 0),
    total_sukarela: rekening.filter((r) => !['pokok', 'wajib'].includes(r.jenis)).reduce((s, r) => s + r.saldo, 0),
  };
}

/** Blokir / buka blokir saldo (dipakai saat simpanan menjadi agunan). */
export function setBlokir(rekening_id, nominal, ctx) {
  const rek = ambilRekening(rekening_id);
  const n = rupiah(nominal);
  if (n < 0) throw badRequest('Nominal blokir tidak boleh negatif');
  if (n > rek.saldo) throw conflict('Nominal blokir melebihi saldo rekening');
  run('UPDATE rekening_simpanan SET saldo_blokir = ? WHERE id = ?', [n, rekening_id]);
  logAudit(ctx, { aksi: 'update', modul: 'simpanan', entitas_id: rekening_id,
    keterangan: `Blokir saldo ${rek.nomor_rekening} diubah menjadi Rp ${n.toLocaleString('id-ID')}`,
    before: { saldo_blokir: rek.saldo_blokir }, after: { saldo_blokir: n } });
  return get('SELECT * FROM rekening_simpanan WHERE id = ?', [rekening_id]);
}

/** Total simpanan seluruh anggota (dipakai dashboard & SHU). */
export function totalSimpanan() {
  return scalar("SELECT COALESCE(SUM(saldo),0) FROM rekening_simpanan WHERE status <> 'tutup'");
}
