/**
 * Modul 17 - Rapat Anggota Tahunan (UU 25/1992 Pasal 22-27).
 */
import {
  api, el, kpi, panel, panelTabel, tabel, rp, angka, persen, tgl, status, judul, modal,
  kolom, input, pilih, bacaForm, toast, galat, memuat, kosongkan, hariIni, bilah, kosong, konfirmasi,
} from '../inti.js';
import { izin, navigasi } from '../app.js';
import { cetakDokumen, tombolCetak } from '../cetak.js';

export async function render(param) {
  if (param[0]) return detail(Number(param[0]));

  const wadah = el('div');
  async function muat() {
    kosongkan(wadah).append(memuat());
    try {
      const d = await api.get('/api/rat');
      kosongkan(wadah).append(
        el('div.notis.info', [el('div.isi', [
          el('strong', 'Rapat Anggota adalah pemegang kekuasaan tertinggi koperasi'),
          el('div.kecil', 'UU No. 25 Tahun 1992 Pasal 22. Rapat Anggota sah bila dihadiri sesuai '
            + 'ketentuan kuorum dalam Anggaran Dasar; setiap anggota memiliki satu suara.'),
        ])]),
        panelTabel('Daftar Rapat Anggota', tabel([
          { judul: 'Nomor', render: (r) => el('span.mono.kecil', r.nomor) },
          { judul: 'Judul', kunci: 'judul' },
          { judul: 'Tahun Buku', kunci: 'tahun_buku' },
          { judul: 'Tanggal', render: (r) => tgl(r.tanggal, true) },
          { judul: 'Tempat', render: (r) => el('span.kecil', r.tempat || '-') },
          { judul: 'Kehadiran', render: (r) => el('div', { gaya: { minWidth: '110px' } }, [
            el('div.kecil', `${r.jumlah_hadir} / ${r.total_anggota}`),
            bilah(r.jumlah_hadir, r.total_anggota || 1, r.kuorum_tercapai ? 'sukses' : 'peringatan'),
          ]) },
          { judul: 'Kuorum', render: (r) => (r.kuorum_tercapai
            ? status('lunas', 'Tercapai') : status('peringatan', 'Belum')) },
          { judul: 'Status', render: (r) => status(r.status) },
        ], d.data, { saatKlik: (r) => { location.hash = `#/rat/${r.id}`; },
          kosongTeks: 'Belum ada rapat anggota dijadwalkan' }), [
          izin('rat.create') && el('button.btn.utama', { onclick: () => formRat(null, muat) },
            '+ Jadwalkan RAT'),
        ].filter(Boolean)),
      );
    } catch (err) { galat(err); }
  }
  await muat();
  return wadah;
}

async function detail(id) {
  const r = await api.get(`/api/rat/${id}`);
  const wadah = el('div');
  const segarkan = () => navigasi(location.hash, true);
  // RAT selesai/batal adalah arsip: hanya dapat dilihat dan dicetak
  const selesai = ['selesai', 'batal'].includes(r.status);

  wadah.append(el('div.gap8.mb16', [
    el('button.btn', { onclick: () => { location.hash = '#/rat'; } }, '← Kembali'),
    izin('rat.update') && r.status === 'rencana' && el('button.btn.utama', {
      onclick: async () => {
        try {
          const h = await api.post(`/api/rat/${id}/undangan`, {});
          toast(`Undangan dikirim ke ${h.diundang} anggota`, 'sukses');
          segarkan();
        } catch (err) { galat(err); }
      },
    }, 'Kirim Undangan'),
    izin('rat.update') && ['undangan', 'berlangsung'].includes(r.status) && el('button.btn', {
      onclick: () => formHadir(r, segarkan) }, '✋ Catat Kehadiran'),
    izin('rat.create') && !selesai && el('button.btn', { onclick: () => formVoting(r, segarkan) }, 'Buat Voting'),
    el('button.btn', { onclick: () => beritaAcara(r).catch(galat) }, 'Berita Acara'),
    izin('rat.update') && !selesai && el('button.btn', { onclick: () => formRat(r, segarkan) }, 'Ubah'),
    izin('rat.update') && ['undangan', 'berlangsung'].includes(r.status) && el('button.btn.utama', {
      onclick: () => formSelesai(r, segarkan) }, 'Selesaikan RAT'),
    izin('rat.delete') && r.status === 'rencana' && !r.hadir && el('button.btn.bahaya', {
      onclick: () => hapusRat(r) }, 'Hapus'),
  ].filter(Boolean)));

  wadah.append(el('div.grid.k4.mb16', [
    kpi('Anggota Diundang', angka(r.total_anggota)),
    kpi('Hadir', angka(r.hadir), {
      catatan: persen(r.total_anggota ? (r.hadir / r.total_anggota) * 100 : 0) }),
    kpi('Syarat Kuorum', persen(r.kuorum_persen)),
    kpi('Kuorum', r.kuorum_tercapai ? 'TERCAPAI' : 'BELUM', {
      jenis: r.kuorum_tercapai ? 'sukses' : 'peringatan' }),
  ]));

  wadah.append(panel(r.judul, el('dl.deskripsi', [
    el('dt', 'Nomor'), el('dd', el('span.mono', r.nomor)),
    el('dt', 'Tahun buku'), el('dd', r.tahun_buku),
    el('dt', 'Jenis'), el('dd', judul(r.jenis)),
    el('dt', 'Tanggal'), el('dd', `${tgl(r.tanggal, true)} ${r.waktu || ''}`),
    el('dt', 'Tempat'), el('dd', r.tempat || '-'),
    el('dt', 'Status'), el('dd', status(r.status)),
    r.berita_acara && el('dt', 'Catatan berita acara'),
    r.berita_acara && el('dd', { gaya: { whiteSpace: 'pre-wrap' } }, r.berita_acara),
  ])));

  wadah.append(panelTabel('Agenda Rapat', tabel([
    { judul: 'No.', angka: true, kunci: 'urut' },
    { judul: 'Agenda', kunci: 'judul' },
    { judul: 'Jenis', render: (a) => status(a.jenis === 'voting' ? 'info' : 'netral', judul(a.jenis)) },
    { judul: 'Keterangan', render: (a) => el('span.kecil.lembut', a.keterangan || '-') },
  ], r.agenda)));

  // ------------------------------ Voting ------------------------------
  const kotakVoting = el('div');
  if (r.voting.length) {
    for (const v of r.voting) {
      kotakVoting.append(panel(`Voting: ${v.judul}`, el('div', [
        el('div.antara.mb8', [
          status(v.status),
          el('span.kecil.lembut', `${v.total_suara} suara masuk`),
        ]),
        v.rekap.length ? el('div', v.rekap.map((s) => el('div', { gaya: { marginBottom: '10px' } }, [
          el('div.antara.kecil', [el('span', s.pilihan),
            el('strong', `${s.jumlah} suara (${persen(s.persen)})`)]),
          bilah(s.persen, 100, s.persen > 50 ? 'sukses' : ''),
        ]))) : el('div.samar.kecil', 'Belum ada suara masuk'),
        izin('rat.update') && el('div.gap8.mt16', [
          v.status === 'draft' && el('button.btn.kecil.utama', {
            onclick: () => ubahStatusVoting(v.id, 'dibuka', segarkan) }, 'Buka Voting'),
          v.status === 'dibuka' && el('button.btn.kecil.bahaya', {
            onclick: () => ubahStatusVoting(v.id, 'ditutup', segarkan) }, 'Tutup Voting'),
        ].filter(Boolean)),
      ])));
    }
  }
  wadah.append(kotakVoting);

  wadah.append(panelTabel(`Daftar Hadir (${r.peserta.filter((p) => p.hadir).length} hadir)`, tabel([
    { judul: 'No. Anggota', render: (p) => el('span.mono.kecil', p.nomor_anggota) },
    { judul: 'Nama', kunci: 'nama' },
    { judul: 'Hadir', render: (p) => (p.hadir ? status('lunas', '✓ Hadir') : status('netral', 'Belum')) },
    { judul: 'Waktu', render: (p) => (p.waktu_hadir ? tgl(p.waktu_hadir) : '-') },
    { judul: 'Tanda Tangan Elektronik', render: (p) => (p.ttd_elektronik
      ? el('span.mono.kecil.samar', `${p.ttd_elektronik.slice(0, 16)}…`) : '-') },
  ], r.peserta, { kosongTeks: 'Belum ada peserta. Kirim undangan terlebih dahulu.' }), [
    r.peserta.length ? tombolCetak(() => dokDaftarHadir(r), { label: 'Cetak Daftar Hadir' }) : null,
  ].filter(Boolean)));

  return wadah;
}

async function ubahStatusVoting(id, st, saatSelesai) {
  try {
    await api.post(`/api/rat/voting/${id}/status`, { status: st });
    toast(`Voting ${st}`, 'sukses');
    saatSelesai?.();
  } catch (err) { galat(err); }
}

/** Formulir jadwal RAT; `data` terisi berarti mengubah data pokok RAT yang ada. */
function formRat(data, saatSelesai) {
  const tahun = new Date().getFullYear();
  const form = el('div', [
    el('div.baris-form', [
      kolom('Tahun Buku', input('tahun_buku', { tipe: 'number', nilai: data?.tahun_buku ?? tahun - 1 }),
        { wajib: true }),
      kolom('Jenis', pilih('jenis', [{ nilai: 'tahunan', teks: 'RAT Tahunan' },
        { nilai: 'luar_biasa', teks: 'Rapat Anggota Luar Biasa' }], data?.jenis)),
    ]),
    kolom('Judul Rapat', input('judul', {
      nilai: data?.judul ?? `Rapat Anggota Tahunan Tahun Buku ${tahun - 1}` }), { wajib: true }),
    el('div.baris-form.k3', [
      kolom('Tanggal', input('tanggal', { tipe: 'date', nilai: data?.tanggal ?? hariIni() }), { wajib: true }),
      kolom('Waktu', input('waktu', { nilai: data ? (data.waktu || '') : '09.00 WIB' })),
      kolom('Syarat Kuorum (%)', input('kuorum_persen', { tipe: 'number', nilai: data?.kuorum_persen ?? 50,
        min: 1, max: 100 })),
    ]),
    kolom('Tempat', input('tempat', { nilai: data ? (data.tempat || '') : 'Aula Koperasi' })),
    el('div.kecil.lembut', data
      ? 'Perubahan syarat kuorum langsung menghitung ulang status kuorum dari kehadiran yang tercatat.'
      : 'Agenda baku RAT akan dibuat otomatis dan dapat disesuaikan kemudian.'),
  ]);
  const tutup = modal({
    judul: data ? `Ubah ${data.nomor}` : 'Jadwalkan Rapat Anggota', isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async (e) => {
        const tombol = e.currentTarget;
        tombol.disabled = true;
        try {
          if (data) await api.put(`/api/rat/${data.id}`, bacaForm(form));
          else await api.post('/api/rat', bacaForm(form));
          toast(data ? 'Data RAT diperbarui' : 'RAT berhasil dijadwalkan', 'sukses');
          tutup(); saatSelesai?.();
        } catch (err) { galat(err); tombol.disabled = false; }
      } }, data ? 'Simpan' : 'Jadwalkan'),
    ],
  });
}

async function hapusRat(r) {
  if (!await konfirmasi(`Hapus ${r.nomor} — ${r.judul}? Agenda dan voting draf ikut terhapus.`,
    { judul: 'Hapus Rapat Anggota', ya: 'Hapus', jenis: 'bahaya' })) return;
  try {
    await api.del(`/api/rat/${r.id}`);
    toast('RAT dihapus', 'sukses');
    location.hash = '#/rat';
  } catch (err) { galat(err); }
}

/** Menutup RAT: status menjadi selesai dan catatan berita acara disimpan. */
function formSelesai(r, saatSelesai) {
  const votingDibuka = r.voting.filter((v) => v.status === 'dibuka');
  const form = el('div', [
    votingDibuka.length ? el('div.notis.bahaya', [el('div.isi', [
      el('strong', `${votingDibuka.length} voting masih dibuka`),
      el('div.kecil', 'Tutup seluruh voting terlebih dahulu agar hasilnya tercatat pada berita acara.'),
    ])]) : null,
    !r.kuorum_tercapai ? el('div.notis.peringatan', [el('div.isi', [
      el('strong', 'Kuorum belum tercapai'),
      el('div.kecil', `Hadir ${r.hadir} dari ${r.total_anggota} anggota (syarat ${persen(r.kuorum_persen)}). `
        + 'Keputusan rapat tanpa kuorum dapat dipersoalkan keabsahannya.'),
    ])]) : null,
    kolom('Catatan Berita Acara', el('textarea', { name: 'berita_acara', rows: 5,
      placeholder: 'Ringkasan jalannya rapat, keputusan penting, dan catatan pimpinan rapat' },
    r.berita_acara || ''), { bantuan: 'Setelah diselesaikan, data RAT tidak dapat diubah lagi.' }),
  ]);
  const tutup = modal({
    judul: `Selesaikan ${r.nomor}`, isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { disabled: votingDibuka.length > 0, onclick: async (e) => {
        const tombol = e.currentTarget;
        tombol.disabled = true;
        try {
          await api.post(`/api/rat/${r.id}/selesai`, bacaForm(form));
          toast('RAT dinyatakan selesai', 'sukses');
          tutup(); saatSelesai?.();
        } catch (err) { galat(err); tombol.disabled = false; }
      } }, 'Selesaikan RAT'),
    ],
  });
}

async function formHadir(r, saatSelesai) {
  const belum = r.peserta.filter((p) => !p.hadir);
  const form = el('div', [
    el('div.notis.info', [el('div.isi', [
      el('strong', `${r.hadir} dari ${r.total_anggota} anggota telah hadir`),
      el('div.kecil', 'Kehadiran dicatat dengan tanda tangan elektronik sesuai UU ITE.'),
    ])]),
    kolom('Anggota', pilih('anggota_id', belum.map((p) => ({
      nilai: p.anggota_id, teks: `${p.nomor_anggota} — ${p.nama}` }))), { wajib: true }),
  ]);
  if (!belum.length) {
    modal({ judul: 'Catat Kehadiran', isi: kosong('Seluruh anggota sudah tercatat hadir', null, 'centang') });
    return;
  }
  const tutup = modal({
    judul: 'Catat Kehadiran Anggota', isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async () => {
        try {
          const h = await api.post(`/api/rat/${r.id}/hadir`, bacaForm(form));
          toast('Kehadiran tercatat', 'sukses',
            `${h.hadir}/${h.total_anggota} · kuorum ${h.kuorum_tercapai ? 'tercapai' : 'belum tercapai'}`);
          tutup(); saatSelesai?.();
        } catch (err) { galat(err); }
      } }, 'Catat'),
    ],
  });
}

function formVoting(r, saatSelesai) {
  const form = el('div', [
    kolom('Judul Voting', input('judul'), { wajib: true }),
    kolom('Agenda Terkait', pilih('agenda_id', [{ nilai: '', teks: '- tidak terkait -' },
      ...r.agenda.map((a) => ({ nilai: a.id, teks: `${a.urut}. ${a.judul}` }))])),
    kolom('Pilihan (pisahkan dengan koma)', input('opsi', { nilai: 'Setuju, Tidak Setuju, Abstain' })),
  ]);
  const tutup = modal({
    judul: 'Buat Voting', isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async () => {
        try {
          const d = bacaForm(form);
          await api.post(`/api/rat/${r.id}/voting`, {
            ...d, opsi: String(d.opsi).split(',').map((s) => s.trim()).filter(Boolean) });
          toast('Voting berhasil dibuat', 'sukses');
          tutup(); saatSelesai?.();
        } catch (err) { galat(err); }
      } }, 'Buat'),
    ],
  });
}

async function beritaAcara(r) {
  const b = await api.get(`/api/rat/${r.id}/berita-acara`);
  modal({
    judul: 'Berita Acara Rapat Anggota', lebar: 'lebar',
    isi: el('div', [
      el('div.tengah.mb16', [
        el('h3', 'BERITA ACARA'), el('div.tebal', b.judul),
        el('div.kecil.lembut', `Nomor: ${b.nomor}`),
      ]),
      el('dl.deskripsi.mb16', [
        el('dt', 'Hari, tanggal'), el('dd', tgl(b.tanggal, true)),
        el('dt', 'Tempat'), el('dd', b.tempat || '-'),
        el('dt', 'Kehadiran'), el('dd', `${b.kehadiran.hadir} dari ${b.kehadiran.total} anggota `
          + `(${persen(b.kehadiran.persen)}) — kuorum ${b.kehadiran.kuorum_tercapai ? 'TERCAPAI' : 'BELUM TERCAPAI'}`),
      ]),
      el('div.tebal.mb8', 'Agenda Rapat'),
      el('ol', { gaya: { paddingLeft: '20px', marginTop: 0 } },
        b.agenda.map((a) => el('li', a.judul))),
      el('div.tebal.mt16.mb8', 'Keputusan Rapat'),
      b.keputusan.length ? el('ul', { gaya: { paddingLeft: '20px', marginTop: 0 } },
        b.keputusan.map((k) => el('li', [
          el('strong', k.judul),
          k.hasil && el('div.kecil', `Keputusan: ${k.hasil.keputusan} (${k.hasil.total_suara} suara)`),
        ]))) : el('div.samar.kecil', 'Belum ada keputusan voting yang ditutup'),
      el('div.tebal.mt16.mb8', 'Ikhtisar Keuangan'),
      el('dl.deskripsi', [
        el('dt', 'Tahun buku'), el('dd', b.ikhtisar_keuangan.tahun_buku),
        el('dt', 'Pendapatan'), el('dd', rp(b.ikhtisar_keuangan.pendapatan)),
        el('dt', 'Beban'), el('dd', rp(b.ikhtisar_keuangan.beban)),
        el('dt', 'SHU'), el('dd', el('strong', rp(b.ikhtisar_keuangan.shu))),
        el('dt', 'Terbilang'), el('dd', el('em', judul(b.ikhtisar_keuangan.shu_terbilang))),
      ]),
      el('div.tebal.mt16.mb8', 'Perangkat Organisasi'),
      el('div.tabel-bungkus', [tabel([
        { judul: 'Nama', kunci: 'nama' },
        { judul: 'Jabatan', kunci: 'jabatan' },
        { judul: 'Kelompok', render: (p) => judul(p.kelompok) },
      ], b.perangkat_organisasi, { kosongTeks: 'Belum ada data pengurus/pengawas' })]),
      el('div.kecil.samar.mt16', b.dasar_hukum),
    ]),
    kaki: [
      el('div', { gaya: { marginRight: 'auto' } }, [tombolCetak(() => dokBeritaAcara(r, b),
        { label: 'Cetak Berita Acara' })]),
    ],
  });
}

// ------------------------------- Cetakan -------------------------------

const kapital = (s) => (s ? `${String(s)[0].toUpperCase()}${String(s).slice(1)}` : '');
const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const hariDari = (iso) => {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? '' : HARI[d.getDay()];
};
const bacaHasil = (v) => {
  if (!v.hasil) return null;
  try { return typeof v.hasil === 'string' ? JSON.parse(v.hasil) : v.hasil; } catch { return null; }
};

/** Berita acara RAT: kehadiran, kuorum, agenda, hasil voting, ikhtisar keuangan, catatan penutup. */
function dokBeritaAcara(r, b) {
  const k = b.kehadiran;
  const pembuka = el('p', { gaya: { textAlign: 'justify', lineHeight: '1.5', margin: '8px 0' } },
    `Pada hari ${hariDari(b.tanggal)}, tanggal ${tgl(b.tanggal, true)}${b.waktu ? ` pukul ${b.waktu}` : ''}, `
    + `bertempat di ${b.tempat || '-'}, telah diselenggarakan ${b.judul}. Rapat dihadiri ${k.hadir} dari ${k.total} `
    + `anggota (${persen(k.persen)}) sehingga kuorum ${k.kuorum_tercapai ? 'TERCAPAI' : 'BELUM TERCAPAI'} `
    + `(syarat ${persen(k.kuorum_persen ?? r.kuorum_persen)}). Adapun jalannya rapat dan keputusan yang diambil adalah sebagai berikut.`);
  return {
    judul: 'Berita Acara Rapat Anggota', subjudul: b.judul, nomor: b.nomor, jenis_ttd: 'rat',
    ringkasan: [
      { label: 'Hari, tanggal', nilai: `${hariDari(b.tanggal)}, ${tgl(b.tanggal, true)}` },
      { label: 'Waktu', nilai: b.waktu || '-' },
      { label: 'Tempat', nilai: b.tempat || '-' },
      { label: 'Jenis rapat', nilai: judul(b.jenis || r.jenis) },
      { label: 'Tahun buku', nilai: b.ikhtisar_keuangan.tahun_buku },
      { label: 'Anggota terdaftar', nilai: k.total, tipe: 'angka' },
      { label: 'Anggota hadir', nilai: `${k.hadir} (${persen(k.persen)})` },
      { label: 'Syarat kuorum', nilai: k.kuorum_persen ?? r.kuorum_persen, tipe: 'persen' },
      { label: 'Kuorum', nilai: k.kuorum_tercapai ? 'TERCAPAI' : 'BELUM TERCAPAI' },
      { label: 'Status rapat', nilai: judul(b.status || r.status) },
    ],
    isi: pembuka,
    bagian: [
      { judul: 'Agenda Rapat', kolom: [{ kunci: 'urut', label: 'No', tipe: 'angka' }, { kunci: 'judul', label: 'Agenda' },
        { kunci: 'jenis', label: 'Jenis' }], baris: b.agenda.map((a) => ({ ...a, jenis: judul(a.jenis) })) },
      { judul: 'Hasil Voting / Keputusan Rapat', kolom: [{ kunci: 'no', label: 'No', tipe: 'angka' },
        { kunci: 'judul', label: 'Materi' }, { kunci: 'rekap', label: 'Perolehan Suara' },
        { kunci: 'total_suara', label: 'Total Suara', tipe: 'angka' }, { kunci: 'status', label: 'Status' },
        { kunci: 'keputusan', label: 'Keputusan' }],
      baris: r.voting.map((v, i) => ({
        no: i + 1, judul: v.judul, total_suara: v.total_suara, status: judul(v.status),
        rekap: v.rekap.map((x) => `${x.pilihan}: ${x.jumlah} (${persen(x.persen)})`).join('; ') || '-',
        keputusan: bacaHasil(v)?.keputusan || (v.status === 'ditutup' ? '-' : 'Belum diputuskan'),
      })) },
      { judul: 'Ikhtisar Keuangan', kolom: [{ kunci: 'uraian', label: 'Uraian' },
        { kunci: 'nilai', label: 'Jumlah (Rp)', tipe: 'uang' }],
      baris: [{ uraian: 'Total pendapatan', nilai: b.ikhtisar_keuangan.pendapatan },
        { uraian: 'Total beban', nilai: b.ikhtisar_keuangan.beban },
        { uraian: 'Sisa Hasil Usaha (SHU)', nilai: b.ikhtisar_keuangan.shu }] },
      b.perangkat_organisasi.length ? { judul: 'Perangkat Organisasi', kolom: [{ kunci: 'nama', label: 'Nama' },
        { kunci: 'jabatan', label: 'Jabatan' }, { kunci: 'kelompok', label: 'Kelompok' }],
      baris: b.perangkat_organisasi.map((p) => ({ ...p, kelompok: judul(p.kelompok) })) } : null,
    ].filter(Boolean),
    terbilang: `SHU tahun buku ${b.ikhtisar_keuangan.tahun_buku}: ${kapital(b.ikhtisar_keuangan.shu_terbilang)}`,
    catatan: [b.catatan && `Catatan penutup: ${b.catatan}`, b.dasar_hukum].filter(Boolean).join(' — '),
  };
}

/** Daftar hadir RAT dengan kolom tanda tangan. */
function dokDaftarHadir(r) {
  const hadir = r.peserta.filter((p) => p.hadir).length;
  return {
    judul: 'Daftar Hadir Rapat Anggota', subjudul: r.judul, nomor: r.nomor, jenis_ttd: 'rat',
    ringkasan: [
      { label: 'Tanggal', nilai: `${tgl(r.tanggal, true)} ${r.waktu || ''}`.trim() },
      { label: 'Tempat', nilai: r.tempat || '-' },
      { label: 'Anggota diundang', nilai: r.peserta.length, tipe: 'angka' },
      { label: 'Anggota hadir', nilai: hadir, tipe: 'angka' },
      { label: 'Syarat kuorum', nilai: r.kuorum_persen, tipe: 'persen' },
      { label: 'Kuorum', nilai: r.kuorum_tercapai ? 'TERCAPAI' : 'BELUM TERCAPAI' },
    ],
    // Baris lebih tinggi agar kolom tanda tangan dapat diisi basah
    isi: '<style>tbody td{height:26px;vertical-align:middle}</style>',
    bagian: [{
      kolom: [{ kunci: 'no', label: 'No', tipe: 'angka' }, { kunci: 'nomor_anggota', label: 'No. Anggota' },
        { kunci: 'nama', label: 'Nama Anggota' }, { kunci: 'kehadiran', label: 'Kehadiran' },
        { kunci: 'waktu', label: 'Waktu Hadir' }, { kunci: 'ttd', label: 'Tanda Tangan' }],
      baris: r.peserta.map((p, i) => ({
        no: i + 1, nomor_anggota: p.nomor_anggota, nama: p.nama,
        kehadiran: p.hadir ? 'Hadir' : 'Tidak hadir',
        waktu: p.waktu_hadir ? String(p.waktu_hadir).slice(0, 16).replace('T', ' ') : '',
        // Hadir lewat presensi elektronik: cantumkan sidik tanda tangan elektroniknya
        ttd: p.ttd_elektronik ? `TTE ${p.ttd_elektronik.slice(0, 10)}` : '',
      })),
    }],
  };
}
