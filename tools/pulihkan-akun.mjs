/**
 * Pemulihan akun dari baris perintah server.
 *
 * Dipakai ketika tidak ada seorang pun yang masih bisa masuk - misalnya akun
 * Super Administrator terkunci atau kata sandinya terlupa - sehingga jalur
 * normal lewat menu Administrator tidak dapat ditempuh.
 *
 * Skrip ini sengaja tidak mengimpor apa pun dari server/: ia hanya memakai
 * node:sqlite dan node:crypto, supaya tetap berjalan meski berkas aplikasi
 * sedang dalam proses pembaruan. Parameter PBKDF2 di bawah harus sama persis
 * dengan yang dipakai server/lib/auth.js.
 *
 * Pemakaian:
 *   node tools/pulihkan-akun.mjs                       buka kunci "admin"
 *   node tools/pulihkan-akun.mjs budi                  buka kunci "budi"
 *   node tools/pulihkan-akun.mjs admin 'SandiBaru123'  buka kunci + ganti sandi
 *
 * Letak basis data diambil dari ECMS_DB atau ECMS_DATA_DIR, sama seperti
 * aplikasinya. Aman dijalankan selagi server menyala.
 */
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import { join } from 'node:path';

const PBKDF2_ITER = 210_000;

const dbPath = process.env.ECMS_DB
  || join(process.env.ECMS_DATA_DIR || join(import.meta.dirname, '..', 'data'), 'ecms.db');

const [username = 'admin', sandiBaru] = process.argv.slice(2);

if (sandiBaru !== undefined && (sandiBaru.length < 8 || !/[A-Za-z]/.test(sandiBaru)
  || !/[0-9]/.test(sandiBaru))) {
  console.error('Kata sandi baru minimal 8 karakter serta mengandung huruf dan angka.');
  process.exit(1);
}

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA busy_timeout = 10000');

const user = db.prepare('SELECT id, username, nama, role, status, gagal_login FROM users WHERE lower(username) = ?')
  .get(username.toLowerCase());

if (!user) {
  console.error(`Pengguna "${username}" tidak ditemukan pada ${dbPath}`);
  process.exit(1);
}

const kolomKunci = db.prepare('PRAGMA table_info(users)').all().some((k) => k.name === 'terkunci_sampai');
const bagianKunci = kolomKunci ? ', terkunci_sampai = NULL' : '';

if (sandiBaru === undefined) {
  db.prepare(`UPDATE users SET gagal_login = 0${bagianKunci} WHERE id = ?`).run(user.id);
  console.log(`Akun "${user.username}" (${user.nama}) dibuka kembali.`);
  console.log(`Hitungan gagal masuk sebelumnya: ${user.gagal_login}. Kata sandi TIDAK diubah.`);
} else {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(sandiBaru, salt, PBKDF2_ITER, 64, 'sha512').toString('hex');
  db.prepare(`UPDATE users SET password_hash = ?, password_salt = ?, gagal_login = 0${bagianKunci}
              WHERE id = ?`).run(hash, salt, user.id);
  // Seluruh sesi lama dihapus: kalau kata sandi sampai perlu dipulihkan paksa,
  // sesi yang masih hidup harus dianggap tidak lagi tepercaya.
  const sesi = db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  console.log(`Akun "${user.username}" (${user.nama}) dibuka kembali dan kata sandinya diganti.`);
  console.log(`Sesi lama yang dihentikan: ${Number(sesi.changes)}.`);
}

// Dicatat sebagai peristiwa biasa, bukan lewat rantai audit aplikasi: skrip ini
// berjalan di luar server sehingga tidak boleh menyentuh rantai hash log audit.
console.log(`Status akun: ${user.status}, peran: ${user.role}.`);
db.close();
