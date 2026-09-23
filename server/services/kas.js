/**
 * Modul 9 - Bukti kas masuk/keluar & transfer kas/bank.
 *
 * Dipisahkan dari rute supaya pembuatan bukti dan koreksinya (ubah/batal)
 * memakai satu jalur yang sama.
 */
import { get, run, nextNumber, tx } from '../db.js';
import { badRequest, notFound, conflict } from '../lib/http.js';
import { logAudit } from '../lib/audit.js';
import { rupiah, terbilang, today } from '../lib/util.js';
import { postJournal, voidJournal, assertAkunKas } from './accounting.js';

/** Bukti kas masuk / keluar (juga petty cash sebagai pengeluaran). */
export function buatBuktiKas(d, ctx) {
  const jenis = d.jenis;
  if (!['kas_masuk', 'kas_keluar', 'petty_cash'].includes(jenis)) throw badRequest('Jenis bukti kas tidak valid');
  const nominal = rupiah(d.nominal);
  if (!(nominal > 0)) throw badRequest('Nominal harus lebih besar dari nol');
  if (!d.coa_kas || !d.coa_lawan) throw badRequest('Akun kas/bank dan akun lawan wajib diisi');
  if (d.coa_kas === d.coa_lawan) throw badRequest('Akun kas dan akun lawan tidak boleh sama');
  assertAkunKas(d.coa_kas);
  if (!String(d.keterangan || '').trim()) throw badRequest('Keterangan wajib diisi');
  const tanggal = d.tanggal || today();

  return tx(() => {
    const masuk = jenis === 'kas_masuk';
    // Nomor bukti kas dipakai sekaligus sebagai nomor jurnal agar keduanya
    // dapat ditelusuri sebagai satu dokumen yang sama.
    const nomor = nextNumber(masuk ? 'BKM' : 'BKK', tanggal);
    const jurnal = postJournal({
      nomor, tanggal, tipe: masuk ? 'kas_masuk' : 'kas_keluar',
      keterangan: d.keterangan, cabang_id: d.cabang_id || null, unit_usaha_id: d.unit_usaha_id || null,
      lines: masuk
        ? [{ coa_kode: d.coa_kas, debit: nominal }, { coa_kode: d.coa_lawan, kredit: nominal }]
        : [{ coa_kode: d.coa_lawan, debit: nominal }, { coa_kode: d.coa_kas, kredit: nominal }],
    }, ctx);
    const { lastInsertRowid: id } = run(
      `INSERT INTO kas_bank(nomor, tanggal, jenis, coa_kas, coa_lawan, nominal, keterangan, pihak,
         cabang_id, unit_usaha_id, jurnal_id, dibuat_oleh)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      [nomor, tanggal, jenis, d.coa_kas, d.coa_lawan, nominal, d.keterangan, d.pihak || null,
        d.cabang_id || null, d.unit_usaha_id || null, jurnal.id, ctx?.user?.username || 'sistem'],
    );
    logAudit(ctx, { aksi: 'create', modul: 'kas', entitas_id: id,
      keterangan: `${nomor} ${jenis} Rp ${nominal.toLocaleString('id-ID')}: ${d.keterangan}` });
    return { id, nomor, jurnal, terbilang: terbilang(nominal) };
  });
}

/** Transfer antar akun kas / bank. */
export function buatTransfer(d, ctx) {
  const dari = d.coa_kas;
  const ke = d.coa_tujuan;
  if (!dari || !ke) throw badRequest('Akun asal dan tujuan wajib diisi');
  if (dari === ke) throw badRequest('Akun asal dan tujuan tidak boleh sama');
  assertAkunKas(dari, 'Akun asal');
  assertAkunKas(ke, 'Akun tujuan');
  const nominal = rupiah(d.nominal);
  if (!(nominal > 0)) throw badRequest('Nominal harus lebih besar dari nol');
  const tanggal = d.tanggal || today();
  const keterangan = d.keterangan || `Transfer ${dari} → ${ke}`;

  return tx(() => {
    const nomor = nextNumber('TRF', tanggal);
    const jurnal = postJournal({
      nomor, tanggal, tipe: 'umum', keterangan,
      lines: [{ coa_kode: ke, debit: nominal }, { coa_kode: dari, kredit: nominal }],
    }, ctx);
    const { lastInsertRowid: id } = run(
      `INSERT INTO kas_bank(nomor, tanggal, jenis, coa_kas, coa_lawan, coa_tujuan, nominal,
         keterangan, jurnal_id, dibuat_oleh) VALUES(?,?,'transfer',?,?,?,?,?,?,?)`,
      [nomor, tanggal, dari, ke, ke, nominal, keterangan, jurnal.id, ctx?.user?.username || 'sistem'],
    );
    logAudit(ctx, { aksi: 'create', modul: 'kas', entitas_id: id,
      keterangan: `${nomor} transfer Rp ${nominal.toLocaleString('id-ID')} dari ${dari} ke ${ke}` });
    return { id, nomor, jurnal };
  });
}

/**
 * Membatalkan bukti kas / transfer. Bukti tetap tersimpan berstatus "batal"
 * dan jurnalnya dibalik (reversing entry).
 */
export function batalBuktiKas(id, alasan, ctx) {
  if (!String(alasan || '').trim()) throw badRequest('Alasan pembatalan wajib diisi');
  const k = get('SELECT * FROM kas_bank WHERE id = ?', [id]);
  if (!k) throw notFound('Bukti kas tidak ditemukan');
  if (k.status === 'batal') throw conflict('Bukti kas ini sudah dibatalkan');
  if (k.rekonsiliasi) {
    throw conflict('Bukti kas yang sudah direkonsiliasi tidak dapat dibatalkan',
      'Batalkan tanda rekonsiliasinya terlebih dahulu.');
  }
  return tx(() => {
    const jurnal = k.jurnal_id ? voidJournal(k.jurnal_id, `Pembatalan ${k.nomor}: ${alasan}`, ctx, { sistem: true }) : null;
    run("UPDATE kas_bank SET status = 'batal', alasan_batal = ? WHERE id = ?", [alasan, id]);
    logAudit(ctx, { aksi: 'void', modul: 'kas', entitas_id: id, keterangan: `${k.nomor} dibatalkan: ${alasan}`, before: k });
    return { ...get('SELECT * FROM kas_bank WHERE id = ?', [id]), jurnal };
  });
}

/** Mengubah bukti kas: bukti lama dibatalkan, bukti pengganti dibuat dengan nomor baru. */
export function ubahBuktiKas(id, data, alasan, ctx) {
  const k = get('SELECT * FROM kas_bank WHERE id = ?', [id]);
  if (!k) throw notFound('Bukti kas tidak ditemukan');
  return tx(() => {
    batalBuktiKas(id, alasan || 'Diubah', ctx);
    const baru = { ...k, ...data };
    const hasil = k.jenis === 'transfer'
      ? buatTransfer({ coa_kas: baru.coa_kas, coa_tujuan: baru.coa_tujuan, nominal: baru.nominal,
        tanggal: baru.tanggal, keterangan: baru.keterangan }, ctx)
      : buatBuktiKas({ jenis: baru.jenis, coa_kas: baru.coa_kas, coa_lawan: baru.coa_lawan, nominal: baru.nominal,
        tanggal: baru.tanggal, keterangan: baru.keterangan, pihak: baru.pihak,
        cabang_id: baru.cabang_id, unit_usaha_id: baru.unit_usaha_id }, ctx);
    return { dibatalkan: k.nomor, pengganti: hasil };
  });
}
