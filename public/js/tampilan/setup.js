/**
 * Setup Koperasi: profil & logo (kop surat seluruh cetakan), nomor aktivasi
 * aplikasi, dan susunan tanda tangan untuk setiap jenis cetakan.
 *
 * Pengguna dengan admin.view dapat melihat; perubahan memerlukan admin.update.
 */
import {
  api, el, kosongkan, memuat, kolom, toast, galat, konfirmasi, status, tgl,
} from '../inti.js';
import { izin, negara, segarkanIdentitas } from '../app.js';
import { cetakDokumen, htmlTtd, segarkanDataCetak } from '../cetak.js';

const BATAS_LOGO = 512 * 1024;
const MAKS_KOLOM_TTD = 6;
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September',
  'Oktober', 'November', 'Desember'];

const bolehUbah = () => izin('admin.update');
const hariIni = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const tanggalPanjang = (iso) => {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return `${d} ${BULAN[m - 1]} ${y}`;
};

/** Sesudah profil/aktivasi/tanda tangan berubah: cetakan & sidebar memakai data baru. */
function segarkanSemua() {
  segarkanDataCetak();
  segarkanIdentitas(true);
}

export async function render() {
  const wadah = el('div');
  const isi = el('div');
  const daftarTab = [
    { judul: 'Profil Koperasi', render: profilTab },
    { judul: 'Aktivasi Aplikasi', render: aktivasiTab },
    { judul: 'Tanda Tangan Cetakan', render: ttdTab },
  ];
  const bilah = el('div.tab', daftarTab.map((t, i) => el('button', {
    class: i === 0 ? 'aktif' : '',
    onclick: async (e) => {
      const tombol = e.currentTarget;
      bilah.querySelectorAll('button').forEach((b) => b.classList.remove('aktif'));
      tombol.classList.add('aktif');
      kosongkan(isi).append(memuat());
      try { kosongkan(isi).append(await t.render()); } catch (err) {
        kosongkan(isi).append(el('div.notis.bahaya', [el('div.isi', [el('strong', err.message), err.detail && el('div.kecil', err.detail)])]));
      }
    },
  }, t.judul)));
  wadah.append(el('div.panel', [bilah]));
  if (!bolehUbah()) {
    wadah.append(el('div.notis.info', [el('div.isi', [el('strong', 'Mode baca saja'),
      el('div.kecil', 'Perubahan Setup Koperasi memerlukan izin "admin.update".')])]));
  }
  wadah.append(isi);
  isi.append(await daftarTab[0].render());
  return wadah;
}

// ------------------------------ Kop surat ------------------------------

/** Pratinjau kop surat, meniru kop pada jendela cetak (lihat cetak.js). */
function kopPratinjau(p) {
  const baris = [
    [p.alamat, p.kota, p.kode_pos].filter(Boolean).join(', '),
    [p.telepon && `Telp. ${p.telepon}`, p.email, p.website].filter(Boolean).join(' · '),
    [p.badan_hukum && `Badan Hukum No. ${p.badan_hukum}`, p.npwp && `NPWP ${p.npwp}`].filter(Boolean).join(' · '),
  ].filter(Boolean);
  return el('div.kop', [
    p.logo ? el('img', { src: p.logo, alt: 'Logo' }) : null,
    el('div', [el('div.nama', p.nama || 'Nama koperasi'), ...baris.map((b) => el('div.baris', b))]),
  ]);
}

// ------------------------------ Profil ------------------------------

const KELOMPOK_PROFIL = [
  { judul: 'Identitas & legalitas', kunci: ['nama', 'singkatan', 'badan_hukum', 'tanggal_badan_hukum', 'nib', 'npwp', 'nik_koperasi', 'tahun_berdiri'] },
  { judul: 'Alamat & kontak', kunci: ['alamat', 'kota', 'provinsi', 'kode_pos', 'telepon', 'email', 'website'] },
  { judul: 'Pengurus, pengawas & manajemen (nama pada tanda tangan)', kunci: ['ketua', 'sekretaris', 'bendahara', 'ketua_pengawas', 'manajer'] },
];

async function profilTab() {
  const d = await api.get('/api/setup/koperasi');
  const ubah = bolehUbah();
  const nilai = { ...d.profil };
  let logo = d.profil.logo || '';
  let logoBerubah = false;

  const kertas = el('div.kertas-pratinjau');
  const gambarKop = () => kosongkan(kertas).append(kopPratinjau({ ...nilai, logo }));

  const form = el('form', { onsubmit: (e) => { e.preventDefault(); simpan(); } });
  const sisa = d.isian.filter((i) => !KELOMPOK_PROFIL.some((k) => k.kunci.includes(i.kunci)));
  const kelompok = [...KELOMPOK_PROFIL, ...(sisa.length ? [{ judul: 'Lainnya', kunci: sisa.map((i) => i.kunci) }] : [])];
  for (const k of kelompok) {
    const isian = k.kunci.map((kunci) => d.isian.find((i) => i.kunci === kunci)).filter(Boolean);
    if (!isian.length) continue;
    form.append(el('div.setup-subjudul', k.judul), el('div.baris-form', isian.map((i) => kolom(i.label, el('input', {
      name: i.kunci, type: i.tipe || 'text', nilai: nilai[i.kunci] ?? '', required: i.wajib || null,
      disabled: !ubah || null, maxlength: 300, class: i.tipe === 'number' ? 'angka' : null,
      oninput: (e) => { nilai[i.kunci] = e.target.value; gambarKop(); },
    }), { wajib: i.wajib }))));
  }

  // ---- Logo ----
  const pratinjauLogo = el('div.setup-logo');
  const berkas = el('input', { type: 'file', accept: 'image/png,image/jpeg', hidden: true, onchange: bacaLogo });
  const tombolHapusLogo = el('button.btn.kecil', { type: 'button', onclick: () => {
    logo = ''; logoBerubah = true; gambarLogo(); gambarKop();
  } }, 'Hapus logo');
  function gambarLogo() {
    kosongkan(pratinjauLogo).append(logo ? el('img', { src: logo, alt: 'Logo koperasi' })
      : el('span.kecil.samar', 'Belum ada logo'));
    tombolHapusLogo.style.display = logo && ubah ? '' : 'none';
  }
  function bacaLogo() {
    const f = berkas.files[0];
    berkas.value = '';
    if (!f) return;
    if (!['image/png', 'image/jpeg'].includes(f.type)) { toast('Logo harus berupa gambar PNG atau JPEG', 'peringatan'); return; }
    if (f.size > BATAS_LOGO) {
      toast('Ukuran logo maksimal 512 KB', 'peringatan', `Berkas terpilih ${Math.ceil(f.size / 1024)} KB.`);
      return;
    }
    const r = new FileReader();
    r.onload = () => { logo = String(r.result); logoBerubah = true; gambarLogo(); gambarKop(); };
    r.onerror = () => toast('Berkas logo tidak dapat dibaca', 'bahaya');
    r.readAsDataURL(f);
  }
  gambarLogo();
  gambarKop();

  const tombolSimpan = el('button.btn.utama', { type: 'submit' }, 'Simpan profil');
  if (ubah) form.append(el('div.setup-kaki', [tombolSimpan]));

  async function simpan() {
    const data = {};
    for (const i of d.isian) data[i.kunci] = nilai[i.kunci] ?? '';
    if (logoBerubah) data.logo = logo;
    tombolSimpan.disabled = true;
    try {
      const hasil = await api.put('/api/setup/koperasi', data);
      Object.assign(nilai, hasil.profil);
      logo = hasil.profil.logo || '';
      logoBerubah = false;
      gambarLogo();
      gambarKop();
      segarkanSemua();
      toast('Profil koperasi disimpan', 'sukses', 'Kop surat seluruh cetakan ikut diperbarui.');
    } catch (err) { galat(err); } finally { tombolSimpan.disabled = false; }
  }

  return el('div.setup-tata', [
    el('div.panel', [
      el('div.panel-kepala', [el('h3', 'Profil Koperasi')]),
      el('div.panel-isi', [form]),
    ]),
    el('div.setup-samping', [
      el('div.panel', [
        el('div.panel-kepala', [el('h3', 'Logo')]),
        el('div.panel-isi', [
          pratinjauLogo,
          ubah ? el('div.gap8', { gaya: { marginTop: '12px', flexWrap: 'wrap' } }, [
            el('button.btn.kecil', { type: 'button', onclick: () => berkas.click() }, 'Pilih berkas…'),
            tombolHapusLogo, berkas,
          ]) : null,
          el('div.kecil.samar', { gaya: { marginTop: '8px' } }, 'PNG atau JPEG, maksimal 512 KB. Logo tampil pada kop seluruh cetakan dan sidebar.'),
        ]),
      ]),
      el('div.panel', [
        el('div.panel-kepala', [el('h3', 'Pratinjau kop surat')]),
        el('div.panel-isi', [kertas]),
      ]),
    ]),
  ]);
}

// ------------------------------ Aktivasi ------------------------------

const LABEL_AKTIVASI = {
  aktif: ['st-sukses', 'Aktif'],
  belum: ['st-peringatan', 'Belum diaktivasi'],
  kedaluwarsa: ['st-bahaya', 'Kedaluwarsa'],
};

async function aktivasiTab() {
  const d = await api.get('/api/setup/koperasi');
  const ubah = bolehUbah();
  const ringkas = el('div');

  function gambarStatus(a) {
    const [kelas, teks] = LABEL_AKTIVASI[a.status] || ['st-netral', a.status];
    kosongkan(ringkas).append(el('div.setup-aktivasi', [
      el('div', [el('span.samar', 'Status'), el(`span.lencana-status.${kelas}`, teks)]),
      el('div', [el('span.samar', 'Nomor aktivasi'), el('strong.mono', a.nomor || '-')]),
      el('div', [el('span.samar', 'Atas nama'), el('strong', a.atas_nama || '-')]),
      el('div', [el('span.samar', 'Tanggal aktivasi'), el('strong', a.tanggal ? tgl(a.tanggal, true) : '-')]),
      el('div', [el('span.samar', 'Berlaku sampai'), el('strong', a.berlaku_sampai ? tgl(a.berlaku_sampai, true) : 'Tanpa batas')]),
    ]));
  }
  gambarStatus(d.aktivasi);

  const nomor = el('input', { name: 'nomor', type: 'text', nilai: d.aktivasi.nomor || '', maxlength: 100,
    placeholder: 'contoh: KSU-2026-ABCD-1234', class: 'mono', autocomplete: 'off', disabled: !ubah || null,
    pattern: '[A-Za-z0-9][A-Za-z0-9\\-]{7,99}' });
  const atasNama = el('input', { name: 'atas_nama', type: 'text', nilai: d.aktivasi.atas_nama || d.profil.nama || '',
    maxlength: 200, disabled: !ubah || null });
  const berlaku = el('input', { name: 'berlaku_sampai', type: 'date', nilai: d.aktivasi.berlaku_sampai || '', disabled: !ubah || null });
  const tombol = el('button.btn.utama', { type: 'submit' }, d.aktivasi.nomor ? 'Ganti nomor aktivasi' : 'Aktivasi');

  const form = el('form', { onsubmit: async (e) => {
    e.preventDefault();
    const data = { nomor: nomor.value.trim(), atas_nama: atasNama.value.trim(), berlaku_sampai: berlaku.value };
    if (!data.nomor && !(await konfirmasi('Nomor aktivasi dikosongkan. Aplikasi akan berstatus belum diaktivasi. Lanjutkan?'))) return;
    tombol.disabled = true;
    try {
      const a = await api.put('/api/setup/aktivasi', data);
      gambarStatus(a);
      tombol.textContent = a.nomor ? 'Ganti nomor aktivasi' : 'Aktivasi';
      segarkanSemua();
      toast(a.status === 'aktif' ? 'Aplikasi aktif' : 'Data aktivasi disimpan', a.status === 'aktif' ? 'sukses' : 'peringatan');
    } catch (err) { galat(err); } finally { tombol.disabled = false; }
  } }, [
    el('div.baris-form', [
      kolom('Nomor aktivasi', nomor, { bantuan: 'Huruf, angka, dan tanda hubung; minimal 8 karakter.' }),
      kolom('Atas nama (pemegang lisensi)', atasNama),
      kolom('Berlaku sampai', berlaku, { bantuan: 'Kosongkan bila lisensi tidak berbatas waktu.' }),
    ]),
    ubah ? el('div.setup-kaki', [tombol]) : null,
  ]);

  return el('div.grid.k2', [
    el('div.panel', [el('div.panel-kepala', [el('h3', 'Status Aktivasi')]), el('div.panel-isi', [ringkas,
      el('p.kecil.samar', { gaya: { marginTop: '14px' } },
        'Nomor lisensi dicantumkan pada kaki setiap cetakan. Tanpa aktivasi, cetakan diberi catatan "Aplikasi belum diaktivasi".')])]),
    el('div.panel', [el('div.panel-kepala', [el('h3', d.aktivasi.nomor ? 'Ganti Nomor Aktivasi' : 'Masukkan Nomor Aktivasi')]),
      el('div.panel-isi', [form])]),
  ]);
}

// --------------------------- Tanda tangan ---------------------------

async function ttdTab() {
  const [d, k] = await Promise.all([api.get('/api/setup/tanda-tangan'), api.get('/api/setup/koperasi')]);
  const ubah = bolehUbah();
  const profil = k.profil;
  let daftar = d.data;
  let terpilih = daftar[0]?.kode;

  const kiri = el('div.ttd-daftar');
  const kanan = el('div');

  function gambarDaftar() {
    kosongkan(kiri).append(...daftar.map((j) => el('button.ttd-jenis', {
      type: 'button', class: j.kode === terpilih ? 'aktif' : '',
      onclick: () => { terpilih = j.kode; gambarDaftar(); gambarEditor(); },
    }, [
      el('span.nama', j.nama),
      el('span.meta', [
        el('span.mono.samar', j.kode),
        el('span.samar', `${j.penanda?.length || 0} kolom`),
        j.diatur ? status('aktif', 'Diatur') : status('netral', 'Bawaan'),
      ]),
    ])));
  }

  async function muatUlang() {
    const baru = await api.get('/api/setup/tanda-tangan');
    daftar = baru.data;
    gambarDaftar();
    gambarEditor();
  }

  function gambarEditor() {
    const j = daftar.find((x) => x.kode === terpilih);
    if (!j) { kosongkan(kanan); return; }
    kosongkan(kanan).append(editorTtd(j, { ubah, profil, sumber: d.sumber_nama || [], muatUlang }));
  }

  gambarDaftar();
  gambarEditor();

  return el('div.setup-tata.ttd', [
    el('div.panel', [
      el('div.panel-kepala', [el('h3', `Jenis Cetakan (${daftar.length})`)]),
      el('div.panel-isi.rapat', [kiri]),
    ]),
    kanan,
  ]);
}

/** "Nama ketua pengurus" → "Ketua pengurus". */
const judulSumber = (label) => {
  const t = String(label).replace(/^Nama\s+/i, '');
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** Menyalin satu kolom tanda tangan ke bentuk yang dapat diubah. */
const salinKolom = (p) => ({ label: p.label || '', jabatan: p.jabatan || '', nama: p.nama || '',
  pengguna: !!p.pengguna, sumber: p.sumber || '' });

function editorTtd(j, { ubah, profil, sumber, muatUlang }) {
  const keadaan = {
    tampil_tanggal: j.tampil_tanggal !== false,
    penanda: (j.penanda || []).map(salinKolom),
  };
  let berubah = false;
  const namaPengguna = negara.user?.nama || negara.user?.username || '';

  const daftarKolom = el('div.ttd-kolom-daftar');
  const pratinjau = el('div.kertas-pratinjau');
  const tombolTambah = el('button.btn.kecil', { type: 'button', onclick: () => {
    keadaan.penanda.push({ label: '', jabatan: '', nama: '', pengguna: false, sumber: '' });
    tandai(); gambarKolom();
  } }, '+ Tambah kolom');

  function tandai() { berubah = true; gambarPratinjau(); }

  function gambarPratinjau() {
    const ttd = {
      kota_tanggal: keadaan.tampil_tanggal ? `${profil.kota ? `${profil.kota}, ` : ''}${tanggalPanjang(hariIni())}` : null,
      penanda: keadaan.penanda.map((p) => ({ label: p.label, jabatan: p.jabatan,
        nama: p.nama || (p.pengguna ? namaPengguna : '') || (p.sumber ? profil[p.sumber] || '' : '') })),
    };
    const html = htmlTtd(ttd);
    kosongkan(pratinjau).append(html ? el('div', { html })
      : el('div.kecil.samar.tengah', { gaya: { padding: '18px 0' } }, 'Cetakan jenis ini tidak memuat blok tanda tangan.'));
  }

  function gambarKolom() {
    kosongkan(daftarKolom);
    tombolTambah.disabled = !ubah || keadaan.penanda.length >= MAKS_KOLOM_TTD;
    if (!keadaan.penanda.length) {
      daftarKolom.append(el('div.kecil.samar', { gaya: { padding: '6px 0 12px' } }, 'Belum ada kolom tanda tangan.'));
    }
    keadaan.penanda.forEach((p, i) => {
      const isian = (nama, props = {}) => el('input', { type: 'text', nilai: p[nama], disabled: !ubah || null,
        oninput: (e) => { p[nama] = e.target.value; tandai(); }, ...props });
      const pilihSumber = el('select', { disabled: !ubah || null, onchange: (e) => { p.sumber = e.target.value; tandai(); } }, [
        el('option', { value: '', selected: !p.sumber }, '— tidak —'),
        ...sumber.map((s) => el('option', { value: s.kunci, selected: p.sumber === s.kunci },
          `${judulSumber(s.label)}${profil[s.kunci] ? ` (${profil[s.kunci]})` : ' (belum diisi)'}`)),
      ]);
      const pindah = (arah) => () => {
        const t = i + arah;
        [keadaan.penanda[i], keadaan.penanda[t]] = [keadaan.penanda[t], keadaan.penanda[i]];
        tandai(); gambarKolom();
      };
      daftarKolom.append(el('div.ttd-kolom', [
        el('div.ttd-kolom-kepala', [
          el('strong', `Kolom ${i + 1}`),
          ubah ? el('div.gap8', [
            el('button.btn.kecil.polos', { type: 'button', title: 'Geser ke kiri', 'aria-label': 'Geser ke kiri',
              disabled: i === 0 || null, onclick: pindah(-1) }, '←'),
            el('button.btn.kecil.polos', { type: 'button', title: 'Geser ke kanan', 'aria-label': 'Geser ke kanan',
              disabled: i === keadaan.penanda.length - 1 || null, onclick: pindah(1) }, '→'),
            el('button.btn.kecil.polos', { type: 'button', title: 'Hapus kolom', 'aria-label': 'Hapus kolom',
              onclick: () => { keadaan.penanda.splice(i, 1); tandai(); gambarKolom(); } }, '✕'),
          ]) : null,
        ]),
        el('div.baris-form', [
          kolom('Keterangan', isian('label', { placeholder: 'mis. Dibuat oleh', maxlength: 60 })),
          kolom('Jabatan', isian('jabatan', { placeholder: 'mis. Kasir', maxlength: 80 })),
          kolom('Nama tetap (opsional)', isian('nama', { placeholder: 'Kosongkan bila otomatis', maxlength: 100 })),
          kolom('Ambil nama dari profil', pilihSumber),
        ]),
        el('label.ttd-centang', [
          el('input', { type: 'checkbox', checked: p.pengguna || null, disabled: !ubah || null,
            onchange: (e) => { p.pengguna = e.target.checked; tandai(); } }),
          'Nama = pengguna yang mencetak',
        ]),
      ]));
    });
  }

  const centangTanggal = el('label.ttd-centang', [
    el('input', { type: 'checkbox', checked: keadaan.tampil_tanggal || null, disabled: !ubah || null,
      onchange: (e) => { keadaan.tampil_tanggal = e.target.checked; tandai(); } }),
    `Tampilkan kota & tanggal${profil.kota ? ` (${profil.kota}, …)` : ' (kota diisi pada Profil Koperasi)'}`,
  ]);

  const simpan = async (e) => {
    const tombol = e.currentTarget;
    const kosongLabel = keadaan.penanda.findIndex((p) => !p.label.trim() && !p.jabatan.trim());
    if (kosongLabel >= 0) {
      toast(`Kolom ${kosongLabel + 1} harus memiliki keterangan atau jabatan`, 'peringatan');
      return;
    }
    tombol.disabled = true;
    try {
      await api.put(`/api/setup/tanda-tangan/${encodeURIComponent(j.kode)}`, {
        tampil_tanggal: keadaan.tampil_tanggal,
        penanda: keadaan.penanda.map((p) => ({ label: p.label.trim(), jabatan: p.jabatan.trim(), nama: p.nama.trim(),
          pengguna: p.pengguna, sumber: p.sumber || undefined })),
      });
      berubah = false;
      segarkanSemua();
      toast('Tanda tangan cetakan disimpan', 'sukses', j.nama);
      await muatUlang();
    } catch (err) { galat(err); tombol.disabled = false; }
  };

  const kembalikan = async (e) => {
    const tombol = e.currentTarget;
    if (!(await konfirmasi(`Kembalikan tanda tangan "${j.nama}" ke susunan bawaan?`, { jenis: 'bahaya', ya: 'Kembalikan' }))) return;
    tombol.disabled = true;
    try {
      await api.del(`/api/setup/tanda-tangan/${encodeURIComponent(j.kode)}`);
      segarkanSemua();
      toast('Dikembalikan ke bawaan', 'sukses', j.nama);
      await muatUlang();
    } catch (err) { galat(err); tombol.disabled = false; }
  };

  const contoh = () => {
    if (berubah) toast('Contoh memakai pengaturan yang sudah tersimpan', 'peringatan', 'Simpan dahulu untuk melihat perubahan pada cetakan.');
    cetakDokumen({
      judul: `Contoh ${j.nama}`,
      nomor: 'CONTOH-0001',
      jenis_ttd: j.kode,
      ringkasan: [
        { label: 'Tanggal', nilai: hariIni(), tipe: 'tanggal' },
        { label: 'Keterangan', nilai: 'Contoh cetakan untuk memeriksa kop surat dan tanda tangan' },
      ],
      bagian: [{
        kolom: [{ kunci: 'no', label: 'No', tipe: 'angka' }, { kunci: 'uraian', label: 'Uraian' },
          { kunci: 'jumlah', label: 'Jumlah (Rp)', tipe: 'uang' }],
        baris: [{ no: 1, uraian: 'Contoh uraian pertama', jumlah: 150000 }, { no: 2, uraian: 'Contoh uraian kedua', jumlah: 350000 }],
        total: { _label: 'TOTAL', jumlah: 500000 },
      }],
      terbilang: 'lima ratus ribu rupiah',
      catatan: 'Dokumen ini hanya contoh dan tidak mewakili transaksi apa pun.',
    });
  };

  gambarKolom();
  gambarPratinjau();

  return el('div.setup-samping', [
    el('div.panel', [
      el('div.panel-kepala', [
        el('h3', j.nama),
        el('div.aksi', [j.diatur ? status('aktif', 'Diatur') : status('netral', 'Bawaan')]),
      ]),
      el('div.panel-isi', [
        j.kode === 'default' ? el('p.kecil.lembut.mt0', 'Susunan ini dipakai oleh setiap jenis cetakan yang tidak memiliki susunan bawaan sendiri dan belum diatur.') : null,
        centangTanggal,
        el('div.kecil.samar', { gaya: { margin: '4px 0 12px' } },
          'Urutan pengisian nama: nama tetap → pengguna yang mencetak → nama dari profil koperasi. '
          + `Maksimal ${MAKS_KOLOM_TTD} kolom.`),
        daftarKolom,
        ubah ? el('div', { gaya: { marginTop: '4px' } }, [tombolTambah]) : null,
      ]),
    ]),
    el('div.panel', [
      el('div.panel-kepala', [el('h3', 'Pratinjau tanda tangan'), el('div.aksi', [
        el('button.btn.kecil', { type: 'button', onclick: contoh }, 'Contoh cetak'),
      ])]),
      el('div.panel-isi', [pratinjau]),
    ]),
    ubah ? el('div.setup-kaki', [
      el('button.btn', { type: 'button', onclick: kembalikan, disabled: !j.diatur || null,
        title: j.diatur ? '' : 'Jenis ini sudah memakai susunan bawaan' }, 'Kembalikan ke bawaan'),
      el('button.btn.utama', { type: 'button', onclick: simpan }, 'Simpan'),
    ]) : null,
  ]);
}
