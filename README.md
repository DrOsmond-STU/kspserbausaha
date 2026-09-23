# ECMS — Enterprise Cooperative Management System

Aplikasi manajemen **Koperasi Serba Usaha (KSU)** berbasis web, dirancang modular
sehingga dapat dipakai mulai dari koperasi kecil sampai koperasi dengan banyak
cabang dan unit usaha.

**Acuan regulasi & standar**

| Acuan | Penerapan di sistem |
|---|---|
| UU No. 25 Tahun 1992 tentang Perkoperasian | Siklus keanggotaan, Rapat Anggota & kuorum, pembagian SHU (Pasal 45), simpanan pokok/wajib sebagai ekuitas (Pasal 41) |
| Permenkop UKM No. 2 Tahun 2024 | Bagan akun koperasi, kebijakan akuntansi, susunan laporan keuangan |
| SAK Entitas Privat (SAK EP) | Dasar akrual, penyajian laporan, CALK |
| PSAK 14 — Persediaan | Perpetual, rata-rata bergerak (moving average) |
| PSAK 16 — Aset Tetap | Penyusutan garis lurus & saldo menurun ganda, pelepasan aset |
| UU ITE No. 11/2008 jo. UU No. 19/2016 | Audit trail berantai (hash chain), tanda tangan elektronik, sidik jari dokumen SHA-256 |
| Good Cooperative Governance | RBAC berlapis, pemisahan fungsi pengawasan, persetujuan berjenjang, manajemen risiko |

---

## Menjalankan aplikasi

Tidak memerlukan `npm install` — aplikasi berjalan **tanpa dependensi eksternal**
di atas Node.js 22 (memakai `node:sqlite`, `node:http`, dan `node:crypto` bawaan).

```bash
node server/seed.js --reset     # menyiapkan skema + data contoh (opsional)
npm start                       # menjalankan server di http://localhost:3000
```

Perintah lain:

```bash
npm run dev      # mode pengembangan dengan auto-reload
npm run seed     # memastikan data awal ada (tanpa menghapus data)
npm test         # menjalankan uji otomatis
```

### Data contoh

`node server/seed.js --reset` membangun kurang lebih **dua tahun buku** data
operasional — dari 1 Januari tahun lalu sampai hari ini — sehingga seluruh
laporan dan dasbor terisi:

| | |
|---|---|
| Anggota | 100 aktif, 5 calon, 3 keluar |
| Simpanan | pokok, wajib bulanan, sukarela, berjangka, deposito |
| Pinjaman | 72 berkas dari pengajuan sampai lunas, seluruh kelas kolektibilitas, NPL ±2,6% |
| Toko | ±9.400 transaksi kasir, pembelian rutin bulanan, retur, penjualan kredit |
| Keuangan | jurnal harian, kas & bank, rekonsiliasi, cash opname, stock opname |
| Tahun buku lalu | ditutup penuh: jurnal penutup → RAT dengan kehadiran & voting → SHU disahkan dan dibagikan |
| Tata kelola | kepatuhan, audit internal, risk register, dokumen berversi, persuratan, persetujuan berjenjang |
| Layanan anggota | tiket berbalasan, broadcast, survei kepuasan (NPS) |

Seluruh transaksi keuangan dibuat lewat service yang sama dengan yang dipakai
antarmuka, jadi setiap angka pada laporan benar-benar berasal dari buku besar —
bukan baris tabel yang ditanam langsung. Penyemaian memakai bilangan acak
deterministik sehingga hasilnya selalu sama.

Menjalankan `--reset` **menghapus seluruh data yang ada**. Untuk memakainya pada
koperasi sungguhan, jalankan `npm run seed` (tanpa `--reset`) yang hanya
menyiapkan bagan akun dan parameter, tanpa data contoh.

### Akun demonstrasi

Hanya berlaku untuk basis data yang disemai tanpa `ECMS_ADMIN_PASSWORD`. Pada
pemasangan produksi kata sandi `admin` ditentukan lewat variabel tersebut dan
daftar di bawah tidak ditampilkan pada halaman masuk.

| Pengguna | Kata sandi | Peran |
|---|---|---|
| `admin` | `Admin12345` | Super Administrator |
| `pengurus1` | `Demo12345` | Pengurus Koperasi |
| `pengawas1` | `Demo12345` | Pengawas (hanya-baca) |
| `bendahara1` | `Demo12345` | Bendahara |
| `manajer1` | `Demo12345` | Manajer Unit Usaha |
| `simpanan1` | `Demo12345` | Petugas Simpanan |
| `pinjaman1` | `Demo12345` | Petugas Pinjaman |
| `kasir1` | `Demo12345` | Kasir Toko |
| `gudang1` | `Demo12345` | Staf Gudang |
| `auditor1` | `Demo12345` | Auditor Internal |
| `anggota1` | `Demo12345` | Anggota (portal mandiri) |

---

## Arsitektur

```
server/
├── index.js              server HTTP, routing, RBAC, penyajian berkas statis
├── schema.sql            skema basis data (≈50 tabel)
├── seed.js               bagan akun, parameter AD/ART, data contoh
├── db.js                 akses SQLite, transaksi, penomoran dokumen
├── lib/                  http, auth (PBKDF2 + TOTP), rbac, audit, crud, util
├── services/             logika bisnis inti
│   ├── accounting.js     mesin jurnal double entry + seluruh laporan
│   ├── savings.js        simpanan
│   ├── loans.js          pinjaman, amortisasi, skoring, kolektibilitas
│   ├── shu.js            perhitungan & distribusi SHU
│   ├── inventory.js      persediaan perpetual rata-rata bergerak
│   ├── trade.js          POS, penjualan, pembelian, utang-piutang
│   ├── assets.js         aset tetap & penyusutan
│   └── approval.js       workflow persetujuan berjenjang/paralel
└── routes/               endpoint REST per kelompok modul

public/
├── index.html, app.css   antarmuka (mendukung mode terang & gelap)
└── js/
    ├── app.js            kerangka, autentikasi, perutean
    ├── inti.js           pemanggilan API, pembentuk DOM, format, dialog
    ├── ikon.js           set ikon garis SVG sebaris
    ├── grafik.js         grafik SVG tanpa pustaka eksternal
    └── tampilan/         satu berkas per modul
```

### Antarmuka

Seluruh gaya berada pada satu berkas `public/app.css` yang dibangun di atas token
warna, radius, bayangan, dan gerak — komponen tidak pernah menuliskan nilai warna
secara langsung, sehingga mode gelap cukup mengganti nilai token.

Beberapa keputusan yang membentuk tampilannya:

- **Navigasi selalu gelap**, di mode terang maupun gelap. Kontras tetap ini
  menjadi jangkar visual: mata langsung tahu mana navigasi dan mana isi.
- **Ikon digambar sendiri sebagai SVG sebaris** (`ikon.js`), bukan emoji. Emoji
  praktis, tetapi bentuk, berat, dan warnanya ditentukan sistem operasi
  masing-masing perangkat sehingga antarmuka tidak pernah benar-benar rapi.
- **Gerak seperlunya** — menyambut, menegaskan, menuntun — dan seluruhnya tunduk
  pada `prefers-reduced-motion`.
- **Status tidak pernah bergantung warna semata**: setiap lencana memuat teks
  keadaannya, dan seri grafik diberi label langsung selain warna.

### Prinsip perancangan

**Buku besar sebagai sumber kebenaran tunggal.** Setiap transaksi finansial —
setoran simpanan, pencairan pinjaman, penjualan di kasir, penerimaan barang,
penyusutan aset, pembagian SHU — diposting melalui satu fungsi `postJournal()`
yang menolak jurnal tidak seimbang, akun induk, akun nonaktif, dan periode yang
sudah ditutup. Laporan keuangan dihitung dari buku besar, bukan dari
tabel ringkasan terpisah, sehingga tidak mungkin terjadi selisih antar modul.

**Tidak ada kode akun di dalam program.** Setiap jurnal otomatis mengambil
akunnya dari master data (akun pada produk simpanan/pinjaman, barang, rekening
bank, aset) atau dari **pemetaan akun** di Parameter Sistem (`coa.*`). Bila
pemetaan belum diisi, transaksi ditolak dengan pesan yang menyebut pengaturan
mana yang harus dilengkapi — sistem tidak pernah diam-diam menebak akun.
Pemetaan divalidasi saat disimpan: akun harus ada, dapat dijurnal, aktif, dan
bertipe sesuai; akun yang sedang dipetakan tidak dapat dihapus atau
dinonaktifkan dari bagan akun.

**Jurnal otomatis di setiap transaksi keuangan.** Setoran, penarikan, jasa
simpanan, pencairan & angsuran pinjaman, penjualan kasir & retur, penerimaan
barang, penyesuaian & opname stok, bukti kas, perolehan/pemeliharaan/
penyusutan/pelepasan aset, pengembalian simpanan anggota keluar, serta
pengesahan & distribusi SHU langsung membentuk jurnal. Jurnal berulang (sewa,
amortisasi) diposting otomatis oleh server saat jatuh tempo.

**Pembatalan tanpa penghapusan.** Jurnal tidak pernah dihapus. Pembatalan
membentuk jurnal balik (*reversing entry*) dan jurnal asli tetap tersimpan —
jejak audit tidak dapat disangkal sesuai UU ITE. Jurnal yang dibentuk modul
hanya dapat dibatalkan lewat dokumen sumbernya (bukti kas, transaksi simpanan,
retur penjualan, hapus aset) sehingga saldo rekening, stok, dan register ikut
terkoreksi; jurnal umum yang diinput manual dibatalkan dari buku besar.

**Audit trail berantai.** Setiap baris audit menyimpan
`sha256(hash_sebelumnya + isi)`. Penyisipan, penghapusan, atau perubahan satu
baris memutus rantai dan langsung terdeteksi melalui menu
Administrator → Audit Trail → Verifikasi.

**Atomisitas.** Seluruh operasi multi-tabel dibungkus transaksi SQLite
(mendukung *nested* melalui SAVEPOINT), sehingga kegagalan di tengah proses
tidak meninggalkan data separuh jadi.

---

## Modul

| # | Modul | Cakupan |
|---|---|---|
| 1 | Dashboard Executive | KPI, tren 12 bulan, daftar hal yang perlu perhatian |
| 2 | Master Data | 14 entitas acuan: cabang, unit usaha, COA, produk, barang, supplier, dll. |
| 3 | Keanggotaan | Pendaftaran → verifikasi → aktif → keluar, ahli waris, kartu digital |
| 4 | Simpanan | Pokok, wajib, sukarela, berjangka, deposito; jasa simpanan; buku tabungan |
| 5 | Pinjaman | Pengajuan, skoring 5C, survey, persetujuan, pencairan, angsuran, denda, restrukturisasi, pelunasan dipercepat, kolektibilitas & NPL |
| 6 | SHU | Simulasi, alokasi AD/ART, pengesahan RAT, distribusi tunai/simpanan |
| 7 | Akuntansi | Jurnal umum & otomatis, jurnal berulang, tutup periode, tutup buku tahunan |
| 8 | Laporan | **Pusat Laporan**: 90 laporan seluruh modul dengan filter rentang tanggal & rentang data, cetak/PDF, Excel (.xlsx), Word (.docx). **Laporan Keuangan**: Neraca, Laba Rugi, Arus Kas, Perubahan Ekuitas, Neraca Saldo, Neraca Lajur, Buku Besar, CALK, Rasio, Rekap Pajak |
| 9 | Kas & Bank | Bukti kas masuk/keluar, transfer, rekonsiliasi, cash opname |
| 10 | Anggaran (RKAP) | Penyusunan, persetujuan, monitoring realisasi & varians |
| 11 | Persediaan | Stok multi-gudang, kartu stok, transfer, stock opname, reorder point |
| 12 | Toko Koperasi (POS) | Kasir barcode, harga khusus anggota, QRIS, potong simpanan, poin loyalti, struk |
| 13 | Pembelian | PO, penerimaan barang, utang usaha, evaluasi supplier |
| 14 | Penjualan | Riwayat transaksi, retur, piutang & analisis umur |
| 15 | Unit Usaha | Laporan hasil usaha per segmen (cost center) |
| 16 | Aset Tetap | Registrasi, penyusutan berkala, pemeliharaan, pelepasan |
| 17 | RAT | Agenda, undangan, presensi + TTE, kuorum, voting, berita acara |
| 18 | Dokumen & Persuratan | Repositori berversi, sidik jari SHA-256, TTE, retensi, surat masuk/keluar & disposisi |
| 19 | Workflow Approval | Berjenjang & paralel, delegasi, eskalasi SLA, tanda tangan elektronik |
| 20 | Compliance | Register kewajiban, pemantauan masa berlaku izin |
| 21 | Audit Internal | Rencana audit, temuan, CAPA, tingkat risiko |
| 22 | Risk Management | Risk register, matriks 5×5, risiko inheren & residual, KRI |
| 23 | CRM Anggota | Tiket layanan, broadcast, survei kepuasan & NPS |
| 24 | Portal Anggota | Saldo, pinjaman, SHU, simulasi & pengajuan mandiri, voting RAT, tiket |
| 25 | Business Intelligence | Analitik keanggotaan, pinjaman, usaha, proyeksi kas, skor kesehatan |
| 26 | Administrator | Pengguna, hak akses per peran (dapat diatur), parameter sistem, audit trail, sesi, MFA, pencadangan |
| 27 | Setup Koperasi | Profil & logo koperasi, nomor aktivasi aplikasi, tanda tangan setiap jenis cetakan |

---

## Hak akses (RBAC)

Izin melekat pada **peran**, bukan individu, dengan format `modul.aksi`
(`*` berarti seluruh aksi). Ditegakkan di sisi server pada setiap permintaan —
antarmuka hanya menyembunyikan menu, bukan menjadi pengaman.

| Peran | Hak akses utama |
|---|---|
| Super Administrator | Seluruh modul, konfigurasi sistem & keamanan |
| Pengurus Koperasi | Monitoring, persetujuan transaksi, laporan strategis |
| Pengawas | **Hanya-baca**: audit, laporan keuangan, kepatuhan |
| Manajer Unit Usaha | Operasional unit, persediaan, POS, pembelian |
| Bendahara | Kas, bank, akuntansi, anggaran, aset, rekonsiliasi |
| Petugas Simpanan | Pengelolaan simpanan anggota, pencatatan tiket layanan anggota |
| Petugas Pinjaman | Pengajuan, analisis, pencairan, penagihan |
| Kasir Toko | POS, penerimaan pembayaran, retur |
| Staf Gudang | Persediaan, mutasi stok, stock opname |
| Auditor Internal | Audit, temuan, CAPA, risiko, kepatuhan |
| Anggota | Portal mandiri (hanya data miliknya sendiri) |

Peran **Pengawas** sengaja dibuat hanya-baca sebagai penerapan pemisahan fungsi
pengawasan dari fungsi pelaksanaan.

Susunan di atas adalah bawaan. Administrator dapat mengubah izin setiap peran
(kecuali Super Administrator dan Anggota) lewat **Administrator → Peran & Hak
Akses**; perubahan berlaku pada permintaan berikutnya dan tercatat di audit trail.

### Koreksi transaksi (ubah & batal)

Transaksi yang sudah tersimpan hanya dapat diubah atau dibatalkan oleh peran yang
memiliki izin **`<modul>.koreksi`** — bawaan: Pengurus (seluruh modul),
Bendahara (akuntansi, kas, simpanan, pinjaman, aset), Manajer Unit (POS,
penjualan, pembelian, persediaan). Izin ini sengaja **tidak** ikut wildcard modul:
kasir dengan `pos.*` boleh berjualan tetapi tidak membatalkan penjualan.

Koreksi tidak pernah menghapus data. **Batal** membentuk jurnal balik dan
memulihkan buku pembantu (stok pada nilai semula, saldo simpanan, jadwal
angsuran, utang/piutang, poin loyalti); **ubah** = batal + dokumen pengganti
bernomor baru, dalam satu transaksi basis data — jurnal, buku besar, dan neraca
selalu ikut terkoreksi. Koreksi atas periode yang sudah ditutup dibukukan pada
tanggal koreksi. Setiap koreksi wajib beralasan dan tercatat di audit trail.

| Dokumen | Batal | Ubah |
|---|---|---|
| Jurnal umum (manual/berulang) | ✓ | ✓ |
| Bukti kas masuk/keluar & transfer | ✓ | ✓ |
| Penjualan POS | ✓ | ✓ |
| Penerimaan barang (per PO) | ✓ | – |
| Pembayaran utang/piutang | ✓ | – |
| Penyesuaian stok | ✓ | – |
| Setoran/penarikan simpanan | ✓ | ✓ |
| Angsuran & pelunasan pinjaman (pembayaran terakhir) | ✓ | ✓ |
| Pencairan pinjaman (belum ada angsuran) | ✓ | – |
| Aset tetap (belum pernah disusutkan) | hapus | – |

---

## Keamanan

- Kata sandi di-*hash* dengan **PBKDF2-SHA512**, 210.000 iterasi, salt acak per pengguna.
- Sesi memakai cookie **HttpOnly + SameSite=Strict**; setel `ECMS_SECURE_COOKIE=1`
  bila dilayani melalui HTTPS.
- **MFA TOTP** (RFC 6238) kompatibel dengan Google Authenticator/Authy.
- Akun terkunci otomatis setelah 5 kali gagal masuk, dan terbuka kembali dengan
  sendirinya sesudah 15 menit. Kunci sengaja tidak permanen: pada aplikasi yang
  terbuka ke internet, kunci permanen berarti siapa pun yang menebak lima kali
  salah dapat mematikan akun Super Administrator tanpa perlu tahu kata sandinya.
- Daftar akun contoh hanya muncul pada pemasangan demonstrasi (ditandai
  pengaturan `mode_demo`), tidak pernah pada pemasangan produksi.
- Seluruh masukan divalidasi di sisi server; kueri memakai *prepared statement*
  sehingga bebas dari injeksi SQL.
- Penyusunan DOM di sisi klien memakai `textContent`, bukan `innerHTML`, sehingga
  data pengguna tidak dapat dieksekusi sebagai skrip.

### Bila tidak seorang pun dapat masuk

Akun terkunci atau kata sandi administrator terlupa dipulihkan dari baris
perintah server, tanpa perlu menyentuh basis data secara manual:

```bash
node tools/pulihkan-akun.mjs                       # buka kunci "admin"
node tools/pulihkan-akun.mjs admin 'SandiBaru123'  # sekaligus ganti kata sandi
```

Mengganti kata sandi lewat cara ini juga menghentikan seluruh sesi pengguna
tersebut yang masih hidup.

> **Jangan pernah** membiarkan skrip pemantauan mencoba masuk secara berkala.
> Percobaan yang gagal ikut terhitung sebagai gagal masuk dan akan mengunci akun
> yang dipantau; periksa kesehatan lewat jalur yang tidak memerlukan sesi.

---

## Pengujian

```bash
npm test
```

105 uji otomatis mencakup: penolakan jurnal tidak seimbang, penyaringan periode
laporan, persamaan akuntansi (aset = kewajiban + ekuitas), kesamaan total arus
kas dengan mutasi kas sesungguhnya, netralisasi jurnal balik, penguncian periode,
keterbacaan hasil usaha sesudah tutup buku tahunan, ketepatan amortisasi
flat/menurun/anuitas, aturan simpanan, siklus pinjaman, klasifikasi
kolektibilitas, HPP rata-rata bergerak, ketepatan pembulatan alokasi SHU, ambang
dan kedaluwarsa penguncian akun, serta penyajian berkas statis. Selain itu:
rekonsiliasi buku pembantu (simpanan, pinjaman, stok, aset, utang-piutang)
terhadap buku besar sesudah setiap alur transaksi, penolakan pemetaan akun yang
kosong, pembatalan lewat dokumen sumber, jurnal berulang otomatis, CRUD
seluruh modul, serta uji asap yang memanggil setiap endpoint GET tanpa boleh
ada galat server.

---

## Cetakan & laporan

Seluruh cetakan — bukti transaksi, formulir, laporan — memakai kop surat (logo &
identitas koperasi), blok tanda tangan, dan catatan kaki (pencetak, waktu, nomor
lisensi) yang seragam. Semuanya diatur pada **Setup Koperasi**:

- **Profil Koperasi**: nama, logo, badan hukum, NIB, NPWP, alamat, kota, kontak,
  dan nama pejabat (ketua, sekretaris, bendahara, ketua pengawas, manajer).
- **Aktivasi Aplikasi**: nomor aktivasi, pemegang lisensi, masa berlaku.
- **Tanda Tangan Cetakan**: untuk 29 jenis cetakan (bukti jurnal memorial, BKM,
  BKK, PO, penerimaan barang, bukti angsuran, dst.) dapat diatur hingga 6 kolom
  tanda tangan: keterangan, jabatan, dan nama — tetap, diambil dari profil
  koperasi, atau otomatis pengguna yang mencetak.

PDF dibuat lewat dialog cetak peramban (pilih "Simpan sebagai PDF"). Excel
(.xlsx) dan Word (.docx) disusun server tanpa pustaka tambahan dan memuat kop
serta tanda tangan yang sama.

## Konfigurasi

| Variabel | Nilai bawaan | Keterangan |
|---|---|---|
| `PORT` | `3000` | Porta server |
| `HOST` | `0.0.0.0` | Alamat bind |
| `ECMS_DATA_DIR` | `./data` | Direktori basis data |
| `ECMS_DB` | `<data>/ecms.db` | Berkas SQLite |
| `ECMS_SECURE_COOKIE` | – | Setel `1` bila memakai HTTPS |
| `ECMS_ADMIN_PASSWORD` | `Admin12345` | Kata sandi administrator saat basis data **pertama kali** dibuat. Wajib diisi pada pemasangan produksi. |

Parameter operasional — identitas koperasi, persentase pembagian SHU sesuai
AD/ART, batas pinjaman, masa tenggang denda, nilai poin loyalti, dan pemetaan
akun — diubah melalui antarmuka pada **Administrator → Parameter Sistem**,
tanpa perlu menyunting kode.

| Kelompok pengaturan | Isi |
|---|---|
| `coa.*` — Pemetaan akun jurnal otomatis | Kas, bank, piutang, persediaan, PPN masukan/keluaran, aset tetap & akumulasi penyusutan, utang usaha, dana-dana SHU, simpanan pokok/wajib, cadangan, SHU berjalan, penjualan, pendapatan jasa/administrasi/denda/lain-lain, HPP, beban jasa simpanan, penyusutan, pemeliharaan, selisih, dan beban lain-lain. Akun pada master data (produk, barang, rekening bank, aset) didahulukan; pemetaan ini dipakai bila master tidak menentukan. |
| `kelompok.*` — Kelompok akun laporan | Awalan kode akun (dipisah koma) untuk HPP, aset lancar, kewajiban lancar, piutang, persediaan, aset tetap, arus kas investasi/pendanaan, dan rekap pajak. Kas & setara kas ditentukan oleh tanda *kas*/*bank* pada bagan akun. |
| `akuntansi.recurring_otomatis` | `1` = jurnal berulang diposting otomatis saat jatuh tempo (dicek saat server menyala dan setiap jam), `0` = hanya lewat tombol *Jalankan*. |

---

## Pemasangan di shared hosting cPanel

Aplikasi tidak memerlukan `npm install` maupun langkah build, sehingga cukup
menyalin berkas dan menjalankan satu proses Node. Karena cPanel di banyak
penyedia tidak menyediakan Passenger, proses dijaga hidup oleh cron.

Contoh penerapan pada `ksp.semestateknologiutama.com`:

```
~/ksp-app/     berkas aplikasi (server/, public/, package.json)
~/ksp-data/    basis data SQLite — di luar docroot, tidak terjangkau HTTP
~/ksp-runner.sh   pemasang + penjaga proses, dipanggil cron tiap 7 menit
~/ksp-verify.sh   pemeriksaan kesehatan, hasilnya di ~/ksp-verify.log
~/ksp-app.log     keluaran aplikasi
```

Proses Node mendengarkan `127.0.0.1:3300` saja — tidak terbuka langsung ke
internet. Apache mengakhiri TLS lalu meneruskan permintaan lewat `.htaccess`
pada document root:

```apache
DirectoryIndex index.html

RewriteEngine On
RewriteBase /

RewriteCond %{HTTPS} !=on
RewriteCond %{HTTP:X-Forwarded-Proto} !https
RewriteRule ^(.*)$ https://%{HTTP_HOST}%{REQUEST_URI} [R=301,L]

# Verifikasi AutoSSL dilayani Apache, jangan di-proxy.
RewriteCond %{REQUEST_URI} ^/\.well-known/ [NC]
RewriteRule ^ - [L]

# Halaman akar dilayani dari salinan statis, lihat catatan di bawah.
RewriteRule ^$ index.html [L]
RewriteRule ^index\.html$ - [L]

RewriteCond %{REQUEST_URI} ^/(.*)$
RewriteRule ^ http://127.0.0.1:3300/%1 [P,QSA,L]
```

`RequestHeader set X-Forwarded-Proto "https" env=HTTPS` perlu ditambahkan pula,
karena tanpa itu aplikasi mengira permintaan datang lewat HTTP polos.

**Halaman akar.** Permintaan ke `/` diselesaikan Apache sebagai permintaan
direktori sebelum aturan proxy sempat berlaku, sehingga yang muncul adalah
daftar folder, bukan aplikasi — meski semua jalur lain sudah benar diteruskan.
Karena itu akar ditulis ulang ke `index.html` yang disalin runner dari
`public/index.html` ke document root. Berkas itu hanya kerangka statis dan
selalu identik dengan yang dikirim Node, sedangkan seluruh isinya tetap dimuat
dari `/app.css` dan `/js/app.js` yang melewati proxy — jadi tidak ada versi
ganda yang bisa basi.

Selain `.htaccess` dan `index.html` itu, document root dibiarkan kosong:
seluruh kode dan basis data berada di luar jangkauan HTTP. Setel
`ECMS_SECURE_COOKIE=1` dan `ECMS_ADMIN_PASSWORD` pada skrip runner; keduanya
tidak boleh memakai nilai bawaan di lingkungan yang terbuka ke internet.

Pembaruan dilakukan dengan menaruh paket baru di `~/ksp-deploy.zip` — runner
menghentikan proses, menyalin berkas aplikasi, lalu menyalakannya kembali.
Direktori `~/ksp-data` tidak pernah tersentuh oleh pembaruan.

---

## Catatan penerapan

Beberapa hal yang perlu dilengkapi saat diterapkan pada koperasi sungguhan:

- **Kanal WhatsApp/SMS/E-mail** pada modul CRM baru mencatat riwayat broadcast;
  pengiriman nyata memerlukan integrasi penyedia layanan.
- **Virtual account & internet banking** pada modul Kas & Bank disiapkan pada
  tingkat data; sambungan ke bank menyesuaikan penyedia yang dipakai koperasi.
- **Tanda tangan elektronik** yang diterapkan bersifat *self-signed* berbasis
  hash. Untuk kekuatan pembuktian tertinggi menurut UU ITE, gunakan sertifikat
  dari Penyelenggara Sertifikasi Elektronik (PSrE) yang terdaftar di Kominfo.
- **OCR dokumen** saat ini mengindeks berkas teks; dokumen hasil pindaian
  memerlukan mesin OCR terpisah.
- Untuk koperasi berskala nasional dengan banyak cabang daring, pertimbangkan
  migrasi basis data ke PostgreSQL — lapisan akses data sudah terpusat di
  `server/db.js` sehingga perubahan terbatas pada satu berkas.
