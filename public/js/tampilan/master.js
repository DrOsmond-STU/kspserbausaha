/**
 * Modul 2 - Master Data (CRUD generik untuk seluruh data acuan).
 */
import {
  api, el, panelTabel, tabel, rp, angka, desimal, persen, status, judul, modal, kolom, input,
  pilih, bacaForm, toast, galat, memuat, kosongkan, konfirmasi,
} from '../inti.js';
import { izin } from '../app.js';

// ------------------------- Pembentuk definisi kolom -------------------------
//
// Kolom formulir ditulis sebagai senarai ringkas [nama, label, tipe, wajib, opsi]
// untuk isian sederhana, atau sebagai objek {nama, label, tipe, wajib, ...} untuk
// tipe yang memerlukan keterangan tambahan:
//   - 'pilih'   : opsi statis (opsi) atau dimuat dari API (sumber: async () => [{nilai, teks}])
//   - 'yatidak' : pilihan Ya (1) / Tidak (0)
//   - 'akun'    : akun COA yang dapat dijurnal & aktif, disaring menurut tipeAkun / kasBank
//   - 'anggota' : pilihan anggota aktif dengan kotak pencarian

/** Status aktif/nonaktif - menonaktifkan lebih aman daripada menghapus. */
const fStatus = () => ({ nama: 'status', label: 'Status', tipe: 'pilih', opsi: ['aktif', 'nonaktif'],
  bantuan: 'Data nonaktif tidak dapat dipilih pada transaksi baru' });
const fYaTidak = (nama, label, bawaan = '0', bantuan) => ({ nama, label, tipe: 'yatidak', bawaan, bantuan });
const fAkun = (nama, label, tipeAkun, opt = {}) => ({ nama, label, tipe: 'akun', tipeAkun, ...opt });
/** Kolom kosong berarti akun diambil dari pemetaan Parameter Sistem. */
const IKUT_PARAMETER = { kosong: '- ikuti Parameter Sistem -',
  bantuan: 'Kosongkan untuk memakai pemetaan akun pada Parameter Sistem' };

/** Relasi ke tabel master lain (id), opsional. */
const fRelasi = (nama, label, path, { teks, kosong = '- tidak ada -', ...opt } = {}) => ({
  nama, label, tipe: 'pilih', kosong, ...opt,
  sumber: async (muat, terpilih) => {
    const d = await muat(path);
    return d.data
      // Data nonaktif disembunyikan kecuali sedang dipakai oleh rekaman ini
      .filter((r) => !r.status || r.status === 'aktif' || String(r.id) === String(terpilih ?? ''))
      .map((r) => ({ nilai: r.id, teks: teks ? teks(r) : [r.kode, r.nama].filter(Boolean).join(' — ') }));
  },
});
const fCabang = () => fRelasi('cabang_id', 'Cabang', '/api/master/cabang');
const fUnit = () => fRelasi('unit_usaha_id', 'Unit Usaha', '/api/master/unit-usaha');

/** Definisi setiap entitas master: kolom tabel dan kolom formulir. */
const ENTITAS = {
  cabang: {
    nama: 'Cabang', path: '/api/master/cabang',
    kolom: [['kode', 'Kode'], ['nama', 'Nama Cabang'], ['kota', 'Kota'], ['telepon', 'Telepon'],
      ['is_pusat', 'Kantor Pusat', (v) => (Number(v) ? 'Ya' : 'Tidak')]],
    form: [['kode', 'Kode', 'text', true], ['nama', 'Nama Cabang', 'text', true],
      ['alamat', 'Alamat'], ['kota', 'Kota'], ['telepon', 'Telepon'],
      fYaTidak('is_pusat', 'Kantor Pusat'), fStatus()],
  },
  'unit-usaha': {
    nama: 'Unit Usaha', path: '/api/master/unit-usaha',
    kolom: [['kode', 'Kode'], ['nama', 'Nama Unit'], ['jenis', 'Jenis', judul],
      ['cabang_nama', 'Cabang'], ['penanggung_jawab', 'Penanggung Jawab']],
    form: [['kode', 'Kode', 'text', true], ['nama', 'Nama Unit', 'text', true],
      ['jenis', 'Jenis', 'pilih', true, ['simpan_pinjam', 'retail', 'pertanian', 'perikanan',
        'peternakan', 'jasa', 'transportasi', 'wisata', 'apotek', 'spbu', 'lainnya']],
      fCabang(), ['penanggung_jawab', 'Penanggung Jawab'], fStatus()],
  },
  coa: {
    nama: 'Bagan Akun (COA)', path: '/api/master/coa',
    kolom: [['kode', 'Kode'], ['nama', 'Nama Akun'], ['tipe', 'Tipe', judul],
      ['saldo_normal', 'Saldo Normal'], ['parent_kode', 'Induk'],
      ['is_postable', 'Dapat Dijurnal', (v) => (Number(v) ? 'Ya' : 'Akun induk')],
      ['is_kas', 'Kas/Bank', (v, r) => (Number(r.is_kas) ? 'Kas' : Number(r.is_bank) ? 'Bank' : '-')]],
    form: [['kode', 'Kode Akun', 'text', true], ['nama', 'Nama Akun', 'text', true],
      ['tipe', 'Tipe', 'pilih', true, ['aset', 'kewajiban', 'ekuitas', 'pendapatan', 'beban']],
      { nama: 'saldo_normal', label: 'Saldo Normal', tipe: 'pilih', wajib: true,
        opsi: [{ nilai: 'D', teks: 'D — Debit' }, { nilai: 'K', teks: 'K — Kredit' }] },
      { nama: 'parent_kode', label: 'Akun Induk', tipe: 'pilih', kosong: '- tanpa induk (akun utama) -',
        sumber: async (muat, terpilih, data) => (await muat('/api/master/coa')).data
          .filter((a) => a.kode !== data?.kode)
          .map((a) => ({ nilai: a.kode, teks: `${a.kode} — ${a.nama}${Number(a.is_postable) ? '' : ' (induk)'}` })),
        // Level, tipe, dan saldo normal mengikuti akun induk yang dipilih
        saatUbah: async (kode, f, muat) => {
          const induk = (await muat('/api/master/coa')).data.find((a) => a.kode === kode);
          f.querySelector('[name="level"]').value = induk ? Number(induk.level || 1) + 1 : 1;
          if (induk) {
            f.querySelector('[name="tipe"]').value = induk.tipe;
            f.querySelector('[name="saldo_normal"]').value = induk.saldo_normal;
          }
        } },
      { nama: 'level', label: 'Level', tipe: 'number', bawaan: 1 },
      fYaTidak('is_postable', 'Dapat Dijurnal', '1', 'Pilih "Tidak" untuk akun induk / header'),
      fYaTidak('is_kas', 'Akun Kas'), fYaTidak('is_bank', 'Akun Bank'), fStatus()],
  },
  'produk-simpanan': {
    nama: 'Produk Simpanan', path: '/api/master/produk-simpanan',
    kolom: [['kode', 'Kode'], ['nama', 'Nama Produk'], ['jenis', 'Jenis', judul],
      ['coa_kode', 'Akun'], ['setoran_minimal', 'Setoran Min.', rp],
      ['bunga_tahunan', 'Jasa % p.a.'], ['boleh_tarik', 'Dapat Ditarik', (v) => (Number(v) ? 'Ya' : 'Tidak')]],
    form: [['kode', 'Kode', 'text', true], ['nama', 'Nama Produk', 'text', true],
      ['jenis', 'Jenis', 'pilih', true, ['pokok', 'wajib', 'sukarela', 'berjangka', 'deposito']],
      fAkun('coa_kode', 'Akun Simpanan', ['kewajiban', 'ekuitas'], { wajib: true }),
      fAkun('coa_beban_bunga', 'Akun Beban Jasa', ['beban'], IKUT_PARAMETER),
      ['setoran_minimal', 'Setoran Minimal', 'number'], ['setoran_wajib', 'Setoran Wajib/bulan', 'number'],
      ['bunga_tahunan', 'Jasa Tahunan (%)', 'number'], ['tenor_bulan', 'Tenor (bulan)', 'number'],
      fYaTidak('boleh_tarik', 'Dapat Ditarik', '1'),
      fYaTidak('masuk_shu', 'Diperhitungkan dalam Jasa Modal SHU', '1'), fStatus()],
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
      fAkun('coa_piutang', 'Akun Piutang', ['aset'], { wajib: true }),
      fAkun('coa_pendapatan_bunga', 'Akun Pendapatan Jasa', ['pendapatan'], { wajib: true }),
      fAkun('coa_pendapatan_admin', 'Akun Pendapatan Admin', ['pendapatan'], IKUT_PARAMETER),
      fAkun('coa_pendapatan_denda', 'Akun Pendapatan Denda', ['pendapatan'], IKUT_PARAMETER),
      fYaTidak('wajib_agunan', 'Wajib Agunan'), fStatus()],
  },
  barang: {
    nama: 'Barang', path: '/api/master/barang',
    kolom: [['kode', 'Kode'], ['barcode', 'Barcode'], ['nama', 'Nama Barang'],
      ['kategori_nama', 'Kategori'], ['satuan', 'Satuan'], ['stok', 'Stok', desimal],
      ['harga_beli', 'HPP', rp], ['harga_jual', 'Harga Jual', rp], ['harga_anggota', 'Harga Anggota', rp]],
    form: [['kode', 'Kode', 'text', true], ['barcode', 'Barcode'], ['nama', 'Nama Barang', 'text', true],
      fRelasi('kategori_id', 'Kategori', '/api/master/kategori-barang'),
      ['satuan', 'Satuan'], ['harga_beli', 'Harga Beli / HPP', 'number'],
      ['harga_jual', 'Harga Jual Umum', 'number'], ['harga_anggota', 'Harga Khusus Anggota', 'number'],
      ['stok_minimum', 'Stok Minimum', 'number'], ['reorder_point', 'Titik Pesan Ulang', 'number'],
      fRelasi('pajak_id', 'Pajak', '/api/master/pajak', { kosong: '- tidak dikenai pajak -',
        teks: (p) => `${p.kode} — ${p.nama} (${desimal(p.tarif)}%)` }),
      fYaTidak('pakai_batch', 'Kelola Batch / Kedaluwarsa'),
      fAkun('coa_persediaan', 'Akun Persediaan', ['aset'], IKUT_PARAMETER),
      fAkun('coa_penjualan', 'Akun Penjualan', ['pendapatan'], IKUT_PARAMETER),
      fAkun('coa_hpp', 'Akun HPP', ['beban'], IKUT_PARAMETER), fStatus()],
  },
  'kategori-barang': {
    nama: 'Kategori Barang', path: '/api/master/kategori-barang',
    kolom: [['kode', 'Kode'], ['nama', 'Nama Kategori']],
    form: [['kode', 'Kode', 'text', true], ['nama', 'Nama Kategori', 'text', true]],
  },
  gudang: {
    nama: 'Gudang', path: '/api/master/gudang',
    kolom: [['kode', 'Kode'], ['nama', 'Nama Gudang'], ['alamat', 'Alamat']],
    form: [['kode', 'Kode', 'text', true], ['nama', 'Nama Gudang', 'text', true], ['alamat', 'Alamat'],
      fCabang(), fUnit(), fStatus()],
  },
  supplier: {
    nama: 'Supplier', path: '/api/master/supplier',
    kolom: [['kode', 'Kode'], ['nama', 'Nama Supplier'], ['telepon', 'Telepon'],
      ['termin_hari', 'Termin (hari)'], ['rating', 'Rating']],
    form: [['kode', 'Kode', 'text', true], ['nama', 'Nama Supplier', 'text', true],
      ['npwp', 'NPWP'], ['alamat', 'Alamat'], ['telepon', 'Telepon'], ['email', 'Surel'],
      ['termin_hari', 'Termin Pembayaran (hari)', 'number'], ['rating', 'Rating (0-5)', 'number'], fStatus()],
  },
  customer: {
    nama: 'Pelanggan', path: '/api/master/customer',
    kolom: [['kode', 'Kode'], ['nama', 'Nama'], ['telepon', 'Telepon'],
      ['termin_hari', 'Termin'], ['limit_piutang', 'Limit Piutang', rp]],
    form: [['kode', 'Kode', 'text', true], ['nama', 'Nama', 'text', true],
      { nama: 'anggota_id', label: 'Tautkan ke Anggota', tipe: 'anggota',
        bantuan: 'Isi bila pelanggan adalah anggota koperasi' },
      ['alamat', 'Alamat'], ['telepon', 'Telepon'], ['npwp', 'NPWP'], ['termin_hari', 'Termin (hari)', 'number'],
      ['limit_piutang', 'Limit Piutang', 'number'], fStatus()],
  },
  bank: {
    nama: 'Rekening Bank', path: '/api/master/bank',
    kolom: [['nama_bank', 'Bank'], ['nomor_rekening', 'Nomor Rekening'],
      ['atas_nama', 'Atas Nama'], ['coa_kode', 'Akun']],
    form: [['nama_bank', 'Nama Bank', 'text', true], ['nomor_rekening', 'Nomor Rekening', 'text', true],
      ['atas_nama', 'Atas Nama', 'text', true],
      fAkun('coa_kode', 'Akun Bank', null, { wajib: true, kasBank: true,
        bantuan: 'Hanya akun yang ditandai kas/bank pada bagan akun' }),
      fCabang(), ['saldo_awal', 'Saldo Awal', 'number'], fStatus()],
  },
  pajak: {
    nama: 'Pajak', path: '/api/master/pajak',
    kolom: [['kode', 'Kode'], ['nama', 'Nama Pajak'], ['tarif', 'Tarif (%)'], ['coa_kode', 'Akun']],
    form: [['kode', 'Kode', 'text', true], ['nama', 'Nama Pajak', 'text', true],
      ['tarif', 'Tarif (%)', 'number'],
      fAkun('coa_kode', 'Akun Pajak', ['aset', 'kewajiban'], IKUT_PARAMETER), fStatus()],
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
      fRelasi('jabatan_id', 'Jabatan', '/api/master/jabatan', {
        teks: (j) => `${j.nama} (${judul(j.kelompok)})` }),
      fCabang(), fUnit(),
      ['telepon', 'Telepon'], ['email', 'Surel'], ['tgl_masuk', 'Tanggal Masuk', 'date'],
      ['tgl_keluar', 'Tanggal Keluar', 'date'],
      ['periode_mulai', 'Masa Bakti Mulai', 'date'], ['periode_akhir', 'Masa Bakti Akhir', 'date'], fStatus()],
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
      const tombol = e.currentTarget;
      aktif = k;
      bilah.querySelectorAll('button').forEach((b) => b.classList.remove('aktif'));
      tombol.classList.add('aktif');
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
            return typeof fmt === 'function' ? fmt(v, r) : String(v);
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

// ------------------------------ Formulir ------------------------------

/** Menyeragamkan definisi kolom (senarai ringkas atau objek) menjadi objek. */
function normalKolom(k) {
  if (!Array.isArray(k)) return { tipe: 'text', wajib: false, ...k };
  const [nama, label, tipe = 'text', wajib = false, opsi] = k;
  return { nama, label, tipe, wajib, opsi };
}

/** Opsi statis: senarai teks atau {nilai, teks}. */
const opsiStatis = (opsi) => (opsi || []).map((o) => (typeof o === 'object' ? o
  : { nilai: o, teks: judul(String(o)) }));

/** Menambahkan nilai tersimpan yang tidak ada lagi di daftar supaya tidak tertimpa diam-diam. */
function pastikanTerpilih(opsi, terpilih, catatan) {
  if (terpilih === null || terpilih === undefined || terpilih === '') return opsi;
  if (opsi.some((o) => String(o.nilai) === String(terpilih))) return opsi;
  return [...opsi, { nilai: terpilih, teks: `${terpilih} ${catatan}` }];
}

/** Pilihan akun COA: dapat dijurnal, aktif, dan bertipe sesuai. */
async function opsiAkun(k, muat, terpilih) {
  const d = await muat('/api/master/coa');
  const opsi = d.data
    .filter((a) => Number(a.is_postable) && a.status === 'aktif')
    .filter((a) => !k.tipeAkun || k.tipeAkun.includes(a.tipe))
    .filter((a) => !k.kasBank || Number(a.is_kas) || Number(a.is_bank))
    .map((a) => ({ nilai: a.kode, teks: `${a.kode} — ${a.nama}` }));
  return pastikanTerpilih(opsi, terpilih, '(tidak aktif / tidak sesuai - pilih ulang)');
}

/** Pilihan anggota aktif dengan kotak pencarian (daftar anggota bisa ribuan). */
async function kendaliAnggota(k, terpilih) {
  const teksAnggota = (a) => [a.nomor_anggota, a.nama].filter(Boolean).join(' — ');
  const kotak = pilih(k.nama, [], '');
  const dikenal = new Map();
  const isiOpsi = (daftar, nilaiKini) => {
    for (const a of daftar) dikenal.set(String(a.id), a);
    const opsi = daftar.map((a) => ({ nilai: a.id, teks: teksAnggota(a) }));
    // Anggota yang sedang terpilih tetap ada walau tidak cocok dengan pencarian
    if (nilaiKini && !opsi.some((o) => String(o.nilai) === String(nilaiKini)) && dikenal.has(String(nilaiKini))) {
      opsi.unshift({ nilai: nilaiKini, teks: teksAnggota(dikenal.get(String(nilaiKini))) });
    }
    const baru = pilih(k.nama, [{ nilai: '', teks: '- bukan anggota -' }, ...opsi], nilaiKini ?? '');
    kosongkan(kotak).append(...baru.children);
    kotak.value = String(nilaiKini ?? '');
  };
  let bolehCari = true;
  if (terpilih) {
    const a = await api.get(`/api/anggota/${terpilih}`).catch(() => null);
    dikenal.set(String(terpilih), a || { id: terpilih, nomor_anggota: `ID ${terpilih}` });
  }
  try {
    isiOpsi((await api.get('/api/anggota', { status: 'aktif', limit: 100 })).data, terpilih);
  } catch {
    // Tanpa hak lihat anggota: cukup pertahankan nilai tersimpan
    bolehCari = false;
    isiOpsi([], terpilih);
  }
  let jeda;
  const cari = el('input', { type: 'search', placeholder: 'Cari nama / nomor anggota…',
    oninput: (e) => {
      const q = e.target.value.trim();
      clearTimeout(jeda);
      jeda = setTimeout(async () => {
        try {
          isiOpsi((await api.get('/api/anggota', { status: 'aktif', q, limit: 50 })).data, kotak.value);
        } catch (err) { galat(err); }
      }, 300);
    } });
  return el('div', [bolehCari && el('div.mb8', [cari]), kotak]);
}

/** Membangun kendali isian untuk satu kolom. */
async function kendali(k, data, muat) {
  const nilai = data?.[k.nama];
  switch (k.tipe) {
    case 'pilih': {
      let opsi = k.sumber ? await k.sumber(muat, nilai, data) : opsiStatis(k.opsi);
      if (k.sumber) opsi = pastikanTerpilih(opsi, nilai, '(nonaktif)');
      if (k.kosong) opsi = [{ nilai: '', teks: k.kosong }, ...opsi];
      return pilih(k.nama, opsi, nilai ?? k.bawaan ?? '');
    }
    case 'yatidak':
      return pilih(k.nama, [{ nilai: '1', teks: 'Ya' }, { nilai: '0', teks: 'Tidak' }],
        nilai === null || nilai === undefined ? k.bawaan : Number(nilai) ? '1' : '0');
    case 'akun': {
      const opsi = await opsiAkun(k, muat, nilai);
      return pilih(k.nama, [{ nilai: '', teks: k.kosong || '- pilih akun -' }, ...opsi], nilai ?? '');
    }
    case 'anggota':
      return kendaliAnggota(k, nilai);
    default:
      return input(k.nama, { tipe: k.tipe, nilai: nilai ?? k.bawaan ?? '' });
  }
}

async function form(def, data, saatSelesai) {
  // Setiap sumber data dimuat sekali per pembukaan formulir
  const tembolok = new Map();
  const muat = (path) => {
    if (!tembolok.has(path)) tembolok.set(path, api.get(path, { limit: 1000 }));
    return tembolok.get(path);
  };
  const daftarKolom = def.form.map(normalKolom);
  let kolomForm;
  try {
    kolomForm = await Promise.all(daftarKolom.map(async (k) =>
      kolom(k.label, await kendali(k, data, muat), { wajib: k.wajib, bantuan: k.bantuan })));
  } catch (err) { galat(err); return; }

  const f = el('div', [
    el('div.baris-form', kolomForm),
  ]);
  // Kaitan antarkolom (mis. level akun mengikuti akun induk)
  for (const k of daftarKolom) {
    const node = k.saatUbah && f.querySelector(`[name="${k.nama}"]`);
    if (node) node.addEventListener('change', () => k.saatUbah(node.value, f, muat));
  }

  const tutup = modal({
    judul: data ? `Ubah ${def.nama}` : `Tambah ${def.nama}`, lebar: 'lebar', isi: f,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async (e) => {
        const tombol = e.currentTarget;
        tombol.disabled = true;
        try {
          const nilai = bacaForm(f);
          // Isian kosong tidak dikirim bila kolomnya berupa angka (atau saat
          // menambah data) supaya nilai bawaan basis data yang berlaku, bukan
          // NULL yang ditolak kolom NOT NULL. Kolom relasi/akun yang dikosongkan
          // saat mengubah tetap dikirim agar benar-benar terhapus.
          for (const k of daftarKolom) {
            if (nilai[k.nama] === '' && (!data || k.tipe === 'number')) delete nilai[k.nama];
          }
          if (data) await api.put(`${def.path}/${data.id}`, nilai);
          else await api.post(def.path, nilai);
          toast('Data tersimpan', 'sukses');
          tutup(); saatSelesai?.();
        } catch (err) { galat(err); tombol.disabled = false; }
      } }, 'Simpan'),
    ],
  });
}
