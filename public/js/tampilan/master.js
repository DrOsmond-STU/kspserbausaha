/**
 * Modul 2 - Master Data (CRUD generik untuk seluruh data acuan).
 */
import {
  api, el, panelTabel, tabel, rp, angka, desimal, persen, status, judul, modal, kolom, input,
  pilih, bacaForm, toast, galat, memuat, kosongkan, konfirmasi, tgl,
} from '../inti.js';
import { izin } from '../app.js';

/** Definisi setiap entitas master: kolom tabel dan kolom formulir. */
const ENTITAS = {
  cabang: {
    nama: 'Cabang', path: '/api/master/cabang',
    kolom: [['kode', 'Kode'], ['nama', 'Nama Cabang'], ['kota', 'Kota'], ['telepon', 'Telepon']],
    form: [['kode', 'Kode', 'text', true], ['nama', 'Nama Cabang', 'text', true],
      ['alamat', 'Alamat'], ['kota', 'Kota'], ['telepon', 'Telepon']],
  },
  'unit-usaha': {
    nama: 'Unit Usaha', path: '/api/master/unit-usaha',
    kolom: [['kode', 'Kode'], ['nama', 'Nama Unit'], ['jenis', 'Jenis', judul],
      ['cabang_nama', 'Cabang'], ['penanggung_jawab', 'Penanggung Jawab']],
    form: [['kode', 'Kode', 'text', true], ['nama', 'Nama Unit', 'text', true],
      ['jenis', 'Jenis', 'pilih', true, ['simpan_pinjam', 'retail', 'pertanian', 'perikanan',
        'peternakan', 'jasa', 'transportasi', 'wisata', 'apotek', 'spbu', 'lainnya']],
      ['penanggung_jawab', 'Penanggung Jawab']],
  },
  coa: {
    nama: 'Bagan Akun (COA)', path: '/api/master/coa',
    kolom: [['kode', 'Kode'], ['nama', 'Nama Akun'], ['tipe', 'Tipe', judul],
      ['saldo_normal', 'Saldo Normal'], ['is_postable', 'Dapat Dijurnal', (v) => (v ? 'Ya' : 'Akun induk')]],
    form: [['kode', 'Kode Akun', 'text', true], ['nama', 'Nama Akun', 'text', true],
      ['tipe', 'Tipe', 'pilih', true, ['aset', 'kewajiban', 'ekuitas', 'pendapatan', 'beban']],
      ['saldo_normal', 'Saldo Normal', 'pilih', true, ['D', 'K']],
      ['parent_kode', 'Kode Induk'], ['is_postable', 'Dapat Dijurnal', 'pilih', false, ['1', '0']]],
  },
  'produk-simpanan': {
    nama: 'Produk Simpanan', path: '/api/master/produk-simpanan',
    kolom: [['kode', 'Kode'], ['nama', 'Nama Produk'], ['jenis', 'Jenis', judul],
      ['coa_kode', 'Akun'], ['setoran_minimal', 'Setoran Min.', rp],
      ['bunga_tahunan', 'Jasa % p.a.'], ['boleh_tarik', 'Dapat Ditarik', (v) => (v ? 'Ya' : 'Tidak')]],
    form: [['kode', 'Kode', 'text', true], ['nama', 'Nama Produk', 'text', true],
      ['jenis', 'Jenis', 'pilih', true, ['pokok', 'wajib', 'sukarela', 'berjangka', 'deposito']],
      ['coa_kode', 'Kode Akun Simpanan', 'text', true], ['coa_beban_bunga', 'Akun Beban Jasa'],
      ['setoran_minimal', 'Setoran Minimal', 'number'], ['setoran_wajib', 'Setoran Wajib/bulan', 'number'],
      ['bunga_tahunan', 'Jasa Tahunan (%)', 'number'], ['tenor_bulan', 'Tenor (bulan)', 'number'],
      ['boleh_tarik', 'Dapat Ditarik', 'pilih', false, ['1', '0']]],
  },
  'produk-pinjaman': {
    nama: 'Produk Pinjaman', path: '/api/master/produk-pinjaman',
    kolom: [['kode', 'Kode'], ['nama', 'Nama Produk'], ['jenis', 'Jenis', judul],
      ['metode_bunga', 'Metode', judul], ['bunga_tahunan', 'Bunga % p.a.'],
      ['plafon_max', 'Plafon Maks.', rp], ['denda_harian', 'Denda %/hari']],
    form: [['kode', 'Kode', 'text', true], ['nama', 'Nama Produk', 'text', true],
      ['jenis', 'Jenis', 'pilih', true, ['konsumtif', 'produktif', 'modal_usaha', 'syariah']],
      ['metode_bunga', 'Metode Bunga', 'pilih', true, ['flat', 'menurun', 'efektif', 'anuitas', 'margin_murabahah']],
      ['bunga_tahunan', 'Bunga Tahunan (%)', 'number'],
      ['tenor_min', 'Tenor Minimal', 'number'], ['tenor_max', 'Tenor Maksimal', 'number'],
      ['plafon_min', 'Plafon Minimal', 'number'], ['plafon_max', 'Plafon Maksimal', 'number'],
      ['biaya_admin', 'Biaya Admin (%)', 'number'], ['biaya_provisi', 'Provisi (%)', 'number'],
      ['denda_harian', 'Denda Harian (%)', 'number'],
      ['coa_piutang', 'Akun Piutang', 'text', true],
      ['coa_pendapatan_bunga', 'Akun Pendapatan Jasa', 'text', true],
      ['coa_pendapatan_admin', 'Akun Pendapatan Admin'], ['coa_pendapatan_denda', 'Akun Pendapatan Denda']],
  },
  barang: {
    nama: 'Barang', path: '/api/master/barang',
    kolom: [['kode', 'Kode'], ['barcode', 'Barcode'], ['nama', 'Nama Barang'],
      ['kategori_nama', 'Kategori'], ['satuan', 'Satuan'], ['stok', 'Stok', desimal],
      ['harga_beli', 'HPP', rp], ['harga_jual', 'Harga Jual', rp], ['harga_anggota', 'Harga Anggota', rp]],
    form: [['kode', 'Kode', 'text', true], ['barcode', 'Barcode'], ['nama', 'Nama Barang', 'text', true],
      ['satuan', 'Satuan'], ['harga_beli', 'Harga Beli / HPP', 'number'],
      ['harga_jual', 'Harga Jual Umum', 'number'], ['harga_anggota', 'Harga Khusus Anggota', 'number'],
      ['stok_minimum', 'Stok Minimum', 'number'], ['reorder_point', 'Titik Pesan Ulang', 'number']],
  },
  'kategori-barang': {
    nama: 'Kategori Barang', path: '/api/master/kategori-barang',
    kolom: [['kode', 'Kode'], ['nama', 'Nama Kategori']],
    form: [['kode', 'Kode', 'text', true], ['nama', 'Nama Kategori', 'text', true]],
  },
  gudang: {
    nama: 'Gudang', path: '/api/master/gudang',
    kolom: [['kode', 'Kode'], ['nama', 'Nama Gudang'], ['alamat', 'Alamat']],
    form: [['kode', 'Kode', 'text', true], ['nama', 'Nama Gudang', 'text', true], ['alamat', 'Alamat']],
  },
  supplier: {
    nama: 'Supplier', path: '/api/master/supplier',
    kolom: [['kode', 'Kode'], ['nama', 'Nama Supplier'], ['telepon', 'Telepon'],
      ['termin_hari', 'Termin (hari)'], ['rating', 'Rating']],
    form: [['kode', 'Kode', 'text', true], ['nama', 'Nama Supplier', 'text', true],
      ['npwp', 'NPWP'], ['alamat', 'Alamat'], ['telepon', 'Telepon'], ['email', 'Surel'],
      ['termin_hari', 'Termin Pembayaran (hari)', 'number'], ['rating', 'Rating (0-5)', 'number']],
  },
  customer: {
    nama: 'Pelanggan', path: '/api/master/customer',
    kolom: [['kode', 'Kode'], ['nama', 'Nama'], ['telepon', 'Telepon'],
      ['termin_hari', 'Termin'], ['limit_piutang', 'Limit Piutang', rp]],
    form: [['kode', 'Kode', 'text', true], ['nama', 'Nama', 'text', true], ['alamat', 'Alamat'],
      ['telepon', 'Telepon'], ['npwp', 'NPWP'], ['termin_hari', 'Termin (hari)', 'number'],
      ['limit_piutang', 'Limit Piutang', 'number']],
  },
  bank: {
    nama: 'Rekening Bank', path: '/api/master/bank',
    kolom: [['nama_bank', 'Bank'], ['nomor_rekening', 'Nomor Rekening'],
      ['atas_nama', 'Atas Nama'], ['coa_kode', 'Akun']],
    form: [['nama_bank', 'Nama Bank', 'text', true], ['nomor_rekening', 'Nomor Rekening', 'text', true],
      ['atas_nama', 'Atas Nama', 'text', true], ['coa_kode', 'Kode Akun', 'text', true],
      ['saldo_awal', 'Saldo Awal', 'number']],
  },
  pajak: {
    nama: 'Pajak', path: '/api/master/pajak',
    kolom: [['kode', 'Kode'], ['nama', 'Nama Pajak'], ['tarif', 'Tarif (%)'], ['coa_kode', 'Akun']],
    form: [['kode', 'Kode', 'text', true], ['nama', 'Nama Pajak', 'text', true],
      ['tarif', 'Tarif (%)', 'number'], ['coa_kode', 'Kode Akun']],
  },
  jabatan: {
    nama: 'Jabatan', path: '/api/master/jabatan',
    kolom: [['kode', 'Kode'], ['nama', 'Nama Jabatan'], ['kelompok', 'Kelompok', judul]],
    form: [['kode', 'Kode', 'text', true], ['nama', 'Nama Jabatan', 'text', true],
      ['kelompok', 'Kelompok', 'pilih', true, ['pengurus', 'pengawas', 'karyawan']]],
  },
  karyawan: {
    nama: 'Karyawan, Pengurus & Pengawas', path: '/api/master/karyawan',
    kolom: [['nik', 'NIK'], ['nama', 'Nama'], ['jabatan_nama', 'Jabatan'],
      ['kelompok', 'Kelompok', judul], ['cabang_nama', 'Cabang'], ['telepon', 'Telepon']],
    form: [['nik', 'NIK', 'text', true], ['nama', 'Nama Lengkap', 'text', true],
      ['telepon', 'Telepon'], ['email', 'Surel'], ['tgl_masuk', 'Tanggal Masuk', 'date'],
      ['periode_mulai', 'Masa Bakti Mulai', 'date'], ['periode_akhir', 'Masa Bakti Akhir', 'date']],
  },
};

export async function render() {
  const wadah = el('div');
  const kunci = Object.keys(ENTITAS);
  let aktif = kunci[0];
  const isi = el('div');

  const bilah = el('div.tab', kunci.map((k, i) => el('button', {
    class: i === 0 ? 'aktif' : '',
    onclick: (e) => {
      aktif = k;
      bilah.querySelectorAll('button').forEach((b) => b.classList.remove('aktif'));
      e.currentTarget.classList.add('aktif');
      muat();
    },
  }, ENTITAS[k].nama)));

  async function muat() {
    const def = ENTITAS[aktif];
    kosongkan(isi).append(memuat());
    try {
      const d = await api.get(def.path, { limit: 500 });
      kosongkan(isi).append(panelTabel(`${def.nama} (${angka(d.total ?? d.data.length)})`, tabel([
        ...def.kolom.map(([kunciKol, judulKol, fmt]) => ({
          judul: judulKol,
          angka: [rp, desimal, persen].includes(fmt),
          render: (r) => {
            const v = r[kunciKol];
            if (v === null || v === undefined || v === '') return el('span.samar', '-');
            return typeof fmt === 'function' ? fmt(v) : String(v);
          },
        })),
        { judul: 'Status', render: (r) => (r.status ? status(r.status) : '-') },
        { judul: '', render: (r) => el('div.gap8', [
          izin('master.update') && el('button.btn.kecil', {
            onclick: (e) => { e.stopPropagation(); form(def, r, muat); } }, 'Ubah'),
          izin('master.delete') && el('button.btn.kecil.polos', {
            onclick: async (e) => {
              e.stopPropagation();
              if (!await konfirmasi(`Hapus "${r.nama || r.kode || r.nama_bank}"?`,
                { ya: 'Hapus', jenis: 'bahaya' })) return;
              try {
                await api.del(`${def.path}/${r.id}`);
                toast('Data dihapus', 'sukses'); muat();
              } catch (err) { galat(err); }
            } }, 'Hapus'),
        ].filter(Boolean)) },
      ], d.data, { kosongTeks: `Belum ada data ${def.nama.toLowerCase()}` }), [
        izin('master.create') && el('button.btn.utama', { onclick: () => form(def, null, muat) },
          `+ Tambah ${def.nama}`),
      ].filter(Boolean)));
    } catch (err) { galat(err); }
  }

  wadah.append(el('div.panel', [bilah]), isi);
  await muat();
  return wadah;
}

function form(def, data, saatSelesai) {
  const kolomForm = def.form.map(([nama, label, tipe = 'text', wajib = false, opsi]) => {
    let kendali;
    if (tipe === 'pilih') {
      kendali = pilih(nama, (opsi || []).map((o) => ({ nilai: o, teks: judul(String(o)) })), data?.[nama]);
    } else {
      kendali = input(nama, { tipe, nilai: data?.[nama] ?? '' });
    }
    return kolom(label, kendali, { wajib });
  });

  const f = el('div', [
    el('div.baris-form', kolomForm),
  ]);

  const tutup = modal({
    judul: data ? `Ubah ${def.nama}` : `Tambah ${def.nama}`, lebar: 'lebar', isi: f,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async (e) => {
        e.currentTarget.disabled = true;
        try {
          const nilai = bacaForm(f);
          if (data) await api.put(`${def.path}/${data.id}`, nilai);
          else await api.post(def.path, nilai);
          toast('Data tersimpan', 'sukses');
          tutup(); saatSelesai?.();
        } catch (err) { galat(err); e.currentTarget.disabled = false; }
      } }, 'Simpan'),
    ],
  });
}
