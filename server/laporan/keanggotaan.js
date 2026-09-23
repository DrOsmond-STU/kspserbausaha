/**
 * Pusat Laporan - kelompok keanggotaan, simpanan, pinjaman & SHU.
 * Lihat server/laporan/bantu.js untuk format definisi laporan.
 */
// eslint-disable-next-line no-unused-vars
import { all, get, scalar } from '../db.js';
// eslint-disable-next-line no-unused-vars
import { periode, rentang, pilih, kondisi, teksPeriode, jumlahkan, bernomor, KOLOM_NO, opsiCabang, opsiUnit } from './bantu.js';

export default [
  {
    kode: 'daftar-anggota',
    judul: 'Daftar Anggota',
    izin: 'anggota.view',
    orientasi: 'landscape',
    deskripsi: 'Data anggota menurut tanggal bergabung, rentang nomor anggota, status, dan cabang.',
    filter: [
      ...periode({ label: 'Tanggal bergabung' }),
      ...rentang('nomor', 'Nomor anggota'),
      pilih('status', 'Status', ['calon', 'aktif', 'nonaktif', 'keluar', 'meninggal', 'ditolak']),
      pilih('cabang_id', 'Cabang', opsiCabang),
    ],
    susun(f) {
      const w = kondisi().periode('a.tanggal_gabung', f).rentang('a.nomor_anggota', f, 'nomor')
        .sama('a.status', f.status).sama('a.cabang_id', f.cabang_id);
      const baris = bernomor(all(
        `SELECT a.nomor_anggota, a.nama, a.nik, a.jenis_kelamin, a.telepon, a.alamat, a.pekerjaan,
                a.tanggal_gabung, a.status, c.nama AS cabang
           FROM anggota a LEFT JOIN cabang c ON c.id = a.cabang_id ${w.where()}
          ORDER BY a.nomor_anggota`, w.params));
      return {
        subjudul: teksPeriode(f, 'Bergabung'),
        ringkasan: [{ label: 'Jumlah anggota', nilai: baris.length, tipe: 'angka' }],
        bagian: [{
          kolom: [KOLOM_NO, { kunci: 'nomor_anggota', label: 'No. Anggota' }, { kunci: 'nama', label: 'Nama' },
            { kunci: 'nik', label: 'NIK' }, { kunci: 'jenis_kelamin', label: 'L/P' }, { kunci: 'telepon', label: 'Telepon' },
            { kunci: 'pekerjaan', label: 'Pekerjaan' }, { kunci: 'cabang', label: 'Cabang' },
            { kunci: 'tanggal_gabung', label: 'Tgl Gabung', tipe: 'tanggal' }, { kunci: 'status', label: 'Status' }],
          baris,
        }],
      };
    },
  },
];
