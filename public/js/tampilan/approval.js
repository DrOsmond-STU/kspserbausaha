/**
 * Modul 19 - Workflow Persetujuan.
 */
import {
  api, el, kpi, panel, panelTabel, tabel, rp, angka, tgl, waktu, status, judul, modal,
  kolom, input, pilih, bacaForm, toast, galat, memuat, kosongkan, kosong, konfirmasi,
} from '../inti.js';
import { izin, navigasi, segarkanNotifikasi, negara } from '../app.js';
import { cetakDokumen, tombolCetak } from '../cetak.js';

export async function render(param) {
  if (param[0]) return detail(Number(param[0]));

  const wadah = el('div');
  const isi = el('div');
  const daftarTab = [
    { judul: 'Menunggu Persetujuan Saya', render: () => daftar({ saya: 1 }) },
    { judul: 'Semua Permintaan', render: () => daftar({}) },
    { judul: 'Konfigurasi Alur', render: alurTab },
  ];
  const bilah = el('div.tab', daftarTab.map((t, i) => el('button', {
    class: i === 0 ? 'aktif' : '',
    onclick: async (e) => {
      bilah.querySelectorAll('button').forEach((b) => b.classList.remove('aktif'));
      e.currentTarget.classList.add('aktif');
      kosongkan(isi).append(memuat());
      kosongkan(isi).append(await t.render());
    },
  }, t.judul)));
  wadah.append(el('div.panel', [bilah]), isi);
  isi.append(await daftarTab[0].render());
  return wadah;
}

async function daftar(q) {
  const wadah = el('div');
  async function muat() {
    kosongkan(wadah).append(memuat());
    try {
      const d = await api.get('/api/approval', q);
      kosongkan(wadah).append(panelTabel(
        q.saya ? `Menunggu Keputusan Anda (${d.data.length})` : `Seluruh Permintaan (${d.data.length})`,
        tabel([
          { judul: 'Nomor', render: (r) => el('span.mono.kecil', r.nomor) },
          { judul: 'Modul', render: (r) => judul(r.modul) },
          { judul: 'Judul', kunci: 'judul' },
          { judul: 'Ringkasan', render: (r) => el('span.kecil.lembut', r.ringkasan || '-') },
          { judul: 'Nominal', angka: true, render: (r) => (r.nominal ? rp(r.nominal) : '-') },
          { judul: 'Pemohon', render: (r) => el('span.kecil', r.pemohon || '-') },
          { judul: 'Tahap', angka: true, render: (r) => r.tahap_aktif },
          { judul: 'Status', render: (r) => status(r.status) },
        ], d.data, {
          saatKlik: (r) => { location.hash = `#/approval/${r.id}`; },
          kosongTeks: q.saya ? 'Tidak ada permintaan yang menunggu keputusan Anda ✓'
            : 'Belum ada permintaan persetujuan',
        }), [
        el('button.btn.kecil', { onclick: async () => {
          try {
            const h = await api.post('/api/approval/eskalasi', {});
            toast(h.dieskalasi ? `${h.dieskalasi} permintaan dieskalasi` : 'Tidak ada yang melewati SLA',
              'sukses');
          } catch (err) { galat(err); }
        } }, 'Jalankan Eskalasi SLA'),
        tombolCetak(() => ({
          judul: q.saya ? 'Permintaan Persetujuan Menunggu Keputusan' : 'Daftar Permintaan Persetujuan',
          jenis_ttd: 'laporan', orientasi: 'landscape',
          bagian: [{
            kolom: [{ kunci: 'no', label: 'No', tipe: 'angka' }, { kunci: 'nomor', label: 'Nomor' },
              { kunci: 'modul', label: 'Modul' }, { kunci: 'judul', label: 'Judul' }, { kunci: 'ringkasan', label: 'Ringkasan' },
              { kunci: 'nominal', label: 'Nominal', tipe: 'uang' }, { kunci: 'pemohon', label: 'Pemohon' },
              { kunci: 'tahap_aktif', label: 'Tahap', tipe: 'angka' }, { kunci: 'status', label: 'Status' }],
            baris: d.data.map((r, i) => ({ ...r, no: i + 1, modul: judul(r.modul), status: judul(r.status) })),
          }],
        }), { label: 'Cetak' }),
      ]));
    } catch (err) { galat(err); }
  }
  await muat();
  return wadah;
}

async function detail(id) {
  const r = await api.get(`/api/approval/${id}`);
  const wadah = el('div');
  const segarkan = () => { segarkanNotifikasi(); navigasi(location.hash, true); };

  const tahapSaya = r.tahapan.find((t) => t.urut === r.tahap_aktif && t.status === 'menunggu'
    && (t.role === negara.user.role || t.delegasi_ke === negara.user.username
      || negara.user.role === 'super_admin'));

  wadah.append(el('div.gap8.mb16', [
    el('button.btn', { onclick: () => { location.hash = '#/approval'; } }, '← Kembali'),
    r.status === 'menunggu' && tahapSaya && el('button.btn.sukses', {
      onclick: () => putuskan(r, 'setuju', segarkan) }, '✓ Setujui'),
    r.status === 'menunggu' && tahapSaya && el('button.btn.bahaya', {
      onclick: () => putuskan(r, 'tolak', segarkan) }, '✕ Tolak'),
    r.status === 'menunggu' && tahapSaya && el('button.btn', {
      onclick: () => delegasi(r, segarkan) }, '↪ Delegasikan'),
    r.modul === 'pinjaman' && el('a.btn', { href: `#/pinjaman/${r.entitas_id}` }, 'Lihat Dokumen →'),
    tombolCetak(() => dokPersetujuan(r), { label: 'Cetak Lembar Persetujuan' }),
  ].filter(Boolean)));

  wadah.append(panel(r.judul, el('dl.deskripsi', [
    el('dt', 'Nomor'), el('dd', el('span.mono', r.nomor)),
    el('dt', 'Modul'), el('dd', judul(r.modul)),
    el('dt', 'Ringkasan'), el('dd', r.ringkasan || '-'),
    el('dt', 'Nominal'), el('dd', rp(r.nominal)),
    el('dt', 'Pemohon'), el('dd', r.pemohon || '-'),
    el('dt', 'Diajukan'), el('dd', waktu(r.created_at)),
    el('dt', 'Status'), el('dd', status(r.status)),
    r.selesai_at && el('dt', 'Selesai'), r.selesai_at && el('dd', waktu(r.selesai_at)),
  ].filter(Boolean))));

  wadah.append(panelTabel('Tahapan Persetujuan', tabel([
    { judul: 'Tahap', angka: true, kunci: 'urut' },
    { judul: 'Peran Penyetuju', kunci: 'role_nama' },
    { judul: 'Tipe', render: (t) => judul(t.tipe) },
    { judul: 'Batas Waktu', render: (t) => (t.batas_waktu ? tgl(t.batas_waktu) : '-') },
    { judul: 'Diputus Oleh', render: (t) => t.oleh || (t.delegasi_ke
      ? el('span.kecil.samar', `didelegasikan ke ${t.delegasi_ke}`) : '-') },
    { judul: 'Waktu', render: (t) => (t.waktu ? waktu(t.waktu) : '-') },
    { judul: 'Catatan', render: (t) => el('span.kecil.lembut', t.catatan || '-') },
    { judul: 'Tanda Tangan', render: (t) => (t.ttd_elektronik
      ? el('span.mono.kecil.samar', `${t.ttd_elektronik.slice(0, 14)}…`) : '-') },
    { judul: 'Status', render: (t) => status(t.status) },
  ], r.tahapan)));

  return wadah;
}

function putuskan(r, keputusan, saatSelesai) {
  const form = el('div', [
    el('div.notis', { class: keputusan === 'setuju' ? 'sukses' : 'bahaya' }, [el('div.isi', [
      el('strong', keputusan === 'setuju' ? 'Persetujuan ditandatangani elektronik'
        : 'Penolakan menghentikan seluruh tahapan'),
      el('div.kecil', 'Keputusan Anda direkam beserta tanda tangan elektronik sesuai UU ITE '
        + 'dan tidak dapat diubah.'),
    ])]),
    kolom('Catatan', el('textarea', { name: 'catatan' }), { wajib: keputusan === 'tolak' }),
  ]);
  const tutup = modal({
    judul: keputusan === 'setuju' ? `Setujui — ${r.nomor}` : `Tolak — ${r.nomor}`, isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el(`button.btn.${keputusan === 'setuju' ? 'sukses' : 'bahaya'}`, { onclick: async (e) => {
        const tombol = e.currentTarget;
        tombol.disabled = true;
        try {
          const h = await api.post(`/api/approval/${r.id}/putuskan`, { ...bacaForm(form), keputusan });
          toast(`Permintaan ${h.status}`, 'sukses',
            h.tahap_aktif ? `Lanjut ke tahap ${h.tahap_aktif}` : null);
          tutup(); saatSelesai?.();
        } catch (err) { galat(err); tombol.disabled = false; }
      } }, keputusan === 'setuju' ? 'Setujui' : 'Tolak'),
    ],
  });
}

async function delegasi(r, saatSelesai) {
  let pengguna = { data: [] };
  try { pengguna = await api.get('/api/admin/users'); } catch { /* tanpa akses daftar pengguna */ }
  const form = el('div', [
    pengguna.data.length
      ? kolom('Delegasikan Kepada', pilih('ke_username', pengguna.data
        .filter((u) => u.status === 'aktif' && u.role !== 'anggota')
        .map((u) => ({ nilai: u.username, teks: `${u.nama} (${u.username})` }))), { wajib: true })
      : kolom('Nama Pengguna Tujuan', input('ke_username'), { wajib: true }),
    kolom('Catatan', input('catatan')),
  ]);
  const tutup = modal({
    judul: `Delegasikan — ${r.nomor}`, isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async () => {
        try {
          await api.post(`/api/approval/${r.id}/delegasi`, bacaForm(form));
          toast('Persetujuan didelegasikan', 'sukses');
          tutup(); saatSelesai?.();
        } catch (err) { galat(err); }
      } }, 'Delegasikan'),
    ],
  });
}

const MODUL_ALUR = ['pinjaman', 'pembelian', 'anggaran', 'jurnal', 'shu', 'dokumen'];

const bacaTahapan = (teks) => {
  try { const t = JSON.parse(teks); return Array.isArray(t) ? t : []; } catch { return []; }
};

async function alurTab() {
  const wadah = el('div');
  const bolehUbah = izin('admin.update');
  // Daftar peran hanya dapat dibaca pemegang admin.view; selain itu peran diketik bebas
  let peran = null;
  if (bolehUbah && izin('admin.view')) {
    try {
      peran = (await api.get('/api/admin/roles')).data
        .filter((r) => r.kode !== 'anggota').map((r) => ({ nilai: r.kode, teks: r.nama }));
    } catch { peran = null; }
  }
  const namaPeran = (kode) => peran?.find((p) => p.nilai === kode)?.teks || judul(kode);

  async function muat() {
    kosongkan(wadah).append(memuat());
    try {
      const d = await api.get('/api/approval-flow', { limit: 500 });
      kosongkan(wadah).append(
        el('div.notis.info', [el('div.isi', [
          el('strong', 'Alur persetujuan berbasis nominal'),
          el('div.kecil', 'Sistem memilih alur aktif berdasarkan modul dan batas nominal transaksi '
            + '(batas atas 0 = tak terbatas). Tahapan bertipe "parallel" pada urutan yang sama harus '
            + 'disetujui seluruhnya. Perubahan alur hanya berlaku untuk permintaan baru.'),
        ])]),
        panelTabel('Konfigurasi Alur Persetujuan', tabel([
          { judul: 'Modul', render: (f) => judul(f.modul) },
          { judul: 'Nama Alur', kunci: 'nama' },
          { judul: 'Batas Bawah', angka: true, render: (f) => rp(f.batas_min) },
          { judul: 'Batas Atas', angka: true, render: (f) => (f.batas_max ? rp(f.batas_max)
            : el('span.samar', 'tak terbatas')) },
          { judul: 'Tahapan', render: (f) => el('div.kecil', bacaTahapan(f.tahapan).map((x) => el('div',
            `${x.urut}. ${namaPeran(x.role)} (${x.tipe}${x.sla_hari ? `, SLA ${x.sla_hari} hari` : ''})`))) },
          { judul: 'Status', render: (f) => status(f.status) },
          bolehUbah && { judul: '', render: (f) => el('div.gap8.nowrap', [
            el('button.btn.kecil', { onclick: () => formAlur(f, peran, muat) }, 'Ubah'),
            el('button.btn.kecil.bahaya', { onclick: () => hapusAlur(f, muat) }, 'Hapus'),
          ]) },
        ].filter(Boolean), d.data, { kosongTeks: 'Belum ada alur persetujuan dikonfigurasi' }), [
          bolehUbah && el('button.btn.utama', { onclick: () => formAlur(null, peran, muat) }, '+ Tambah Alur'),
        ].filter(Boolean)),
      );
    } catch (err) { galat(err); }
  }
  await muat();
  return wadah;
}

/**
 * Formulir alur persetujuan dengan penyunting tahapan.
 * @param {object|null} data  alur yang diubah; null untuk alur baru
 * @param {Array|null} peran  opsi peran dari /api/admin/roles; null = isian bebas
 */
function formAlur(data, peran, saatSelesai) {
  const tahapan = data ? bacaTahapan(data.tahapan).map((t) => ({ ...t }))
    : [{ urut: 1, role: peran?.[0]?.nilai || '', tipe: 'berjenjang', sla_hari: 3 }];
  const daftarTahap = el('div');

  const gambarTahap = () => {
    kosongkan(daftarTahap);
    if (!tahapan.length) {
      daftarTahap.append(el('div.samar.kecil.mb8', 'Belum ada tahapan. Tambahkan minimal satu tahap.'));
      return;
    }
    tahapan.forEach((t, i) => {
      const ubah = (k, ubahAngka = false) => (e) => {
        t[k] = ubahAngka ? Number(e.target.value) : e.target.value;
      };
      const opsiPeran = peran && !peran.some((p) => p.nilai === t.role) && t.role
        ? [...peran, { nilai: t.role, teks: t.role }] : peran;
      daftarTahap.append(el('div.baris-form', { gaya: {
        gridTemplateColumns: 'minmax(48px,70px) minmax(0,2fr) minmax(0,1fr) minmax(52px,90px) auto',
        gap: '8px', alignItems: 'end', marginBottom: '8px' } }, [
        kolom(i === 0 ? 'Urut' : '', el('input.angka', { type: 'number', min: 1, value: t.urut,
          oninput: ubah('urut', true) })),
        kolom(i === 0 ? 'Peran Penyetuju' : '', opsiPeran
          ? pilih(null, opsiPeran, t.role, { onchange: ubah('role') })
          : el('input', { value: t.role || '', placeholder: 'kode peran, mis. manajer_unit',
            oninput: ubah('role') })),
        kolom(i === 0 ? 'Tipe' : '', pilih(null, [{ nilai: 'berjenjang', teks: 'Berjenjang' },
          { nilai: 'parallel', teks: 'Paralel' }], t.tipe, { onchange: ubah('tipe') })),
        kolom(i === 0 ? 'SLA (hari)' : '', el('input.angka', { type: 'number', min: 1, value: t.sla_hari ?? 3,
          oninput: ubah('sla_hari', true) })),
        el('div.kolom', [el('button.btn.kecil.polos', { title: 'Hapus tahap', 'aria-label': 'Hapus tahap',
          onclick: () => { tahapan.splice(i, 1); gambarTahap(); } }, '✕')]),
      ]));
    });
  };
  gambarTahap();

  const form = el('div', [
    el('div.baris-form', [
      kolom('Modul', pilih('modul', [...new Set([...MODUL_ALUR, data?.modul].filter(Boolean))]
        .map((m) => ({ nilai: m, teks: judul(m) })), data?.modul), { wajib: true }),
      kolom('Nama Alur', input('nama', { nilai: data?.nama || '', placeholder: 'mis. Pinjaman s.d. Rp 5 juta' }),
        { wajib: true }),
    ]),
    el('div.baris-form.k3', [
      kolom('Batas Bawah (Rp)', input('batas_min', { tipe: 'number', min: 0, nilai: data?.batas_min ?? 0 })),
      kolom('Batas Atas (Rp)', input('batas_max', { tipe: 'number', min: 0, nilai: data?.batas_max ?? 0 }),
        { bantuan: '0 = tak terbatas' }),
      kolom('Status', pilih('status', [{ nilai: 'aktif', teks: 'Aktif' }, { nilai: 'nonaktif', teks: 'Nonaktif' }],
        data?.status || 'aktif')),
    ]),
    el('div.tebal.mt16.mb8', 'Tahapan Persetujuan'),
    daftarTahap,
    el('button.btn.kecil', { onclick: () => {
      const akhir = tahapan[tahapan.length - 1];
      tahapan.push({ urut: (Number(akhir?.urut) || 0) + 1, role: peran?.[0]?.nilai || '',
        tipe: 'berjenjang', sla_hari: 3 });
      gambarTahap();
    } }, '+ Tambah Tahap'),
    el('div.kecil.lembut.mt16', 'Beri nomor urut yang sama dan tipe "Paralel" pada beberapa tahap '
      + 'agar seluruh peran tersebut harus menyetujui sebelum lanjut.'),
  ]);

  const tutup = modal({
    judul: data ? `Ubah Alur — ${data.nama}` : 'Tambah Alur Persetujuan', lebar: 'lebar', isi: form,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async (e) => {
        if (!tahapan.length) { toast('Alur minimal memiliki satu tahap', 'peringatan'); return; }
        if (tahapan.some((t) => !String(t.role || '').trim())) {
          toast('Peran penyetuju setiap tahap wajib diisi', 'peringatan'); return;
        }
        const tombol = e.currentTarget;
        tombol.disabled = true;
        try {
          const isi = {
            ...bacaForm(form),
            tahapan: tahapan.map((t) => ({ urut: Number(t.urut) || 1, role: String(t.role).trim(),
              tipe: t.tipe || 'berjenjang', sla_hari: Number(t.sla_hari) || 3 })),
          };
          if (data) await api.put(`/api/approval-flow/${data.id}`, isi);
          else await api.post('/api/approval-flow', isi);
          toast('Alur persetujuan tersimpan', 'sukses');
          tutup(); saatSelesai?.();
        } catch (err) { galat(err); tombol.disabled = false; }
      } }, 'Simpan'),
    ],
  });
}

async function hapusAlur(f, saatSelesai) {
  if (!await konfirmasi(`Hapus alur "${f.nama}"? Permintaan yang sudah berjalan tidak terpengaruh, `
    + 'tetapi transaksi baru pada rentang nominal ini tidak lagi memerlukan persetujuan. '
    + 'Pertimbangkan menonaktifkannya saja.', { judul: 'Hapus Alur Persetujuan', ya: 'Hapus', jenis: 'bahaya' })) return;
  try {
    await api.del(`/api/approval-flow/${f.id}`);
    toast('Alur persetujuan dihapus', 'sukses');
    saatSelesai?.();
  } catch (err) { galat(err); }
}

/** Lembar persetujuan berjenjang (riwayat keputusan tiap tahap). */
function dokPersetujuan(r) {
  return {
    judul: 'Lembar Persetujuan', subjudul: r.judul, nomor: r.nomor, jenis_ttd: 'default',
    ringkasan: [
      { label: 'Modul', nilai: judul(r.modul) },
      { label: 'Status', nilai: judul(r.status) },
      { label: 'Nominal', nilai: r.nominal, tipe: 'uang' },
      { label: 'Pemohon', nilai: r.pemohon || '-' },
      { label: 'Diajukan', nilai: waktu(r.created_at) },
      { label: 'Selesai', nilai: r.selesai_at ? waktu(r.selesai_at) : '-' },
      { label: 'Ringkasan', nilai: r.ringkasan || '-' },
    ],
    bagian: [{
      judul: 'Tahapan Persetujuan',
      kolom: [{ kunci: 'urut', label: 'Tahap', tipe: 'angka' }, { kunci: 'role_nama', label: 'Peran Penyetuju' },
        { kunci: 'tipe', label: 'Tipe' }, { kunci: 'batas_waktu', label: 'Batas Waktu', tipe: 'tanggal' },
        { kunci: 'oleh', label: 'Diputus Oleh' }, { kunci: 'waktu_teks', label: 'Waktu' },
        { kunci: 'catatan', label: 'Catatan' }, { kunci: 'tte', label: 'Tanda Tangan Elektronik' },
        { kunci: 'status', label: 'Status' }],
      baris: r.tahapan.map((t) => ({ ...t, tipe: judul(t.tipe), status: judul(t.status),
        oleh: t.oleh || (t.delegasi_ke ? `didelegasikan ke ${t.delegasi_ke}` : ''),
        waktu_teks: t.waktu ? waktu(t.waktu) : '', tte: t.ttd_elektronik ? t.ttd_elektronik.slice(0, 16) : '' })),
    }],
  };
}
