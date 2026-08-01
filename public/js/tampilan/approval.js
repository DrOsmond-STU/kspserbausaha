/**
 * Modul 19 - Workflow Persetujuan.
 */
import {
  api, el, kpi, panel, panelTabel, tabel, rp, angka, tgl, waktu, status, judul, modal,
  kolom, input, pilih, bacaForm, toast, galat, memuat, kosongkan, kosong,
} from '../inti.js';
import { izin, navigasi, segarkanNotifikasi, negara } from '../app.js';

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
        e.currentTarget.disabled = true;
        try {
          const h = await api.post(`/api/approval/${r.id}/putuskan`, { ...bacaForm(form), keputusan });
          toast(`Permintaan ${h.status}`, 'sukses',
            h.tahap_aktif ? `Lanjut ke tahap ${h.tahap_aktif}` : null);
          tutup(); saatSelesai?.();
        } catch (err) { galat(err); e.currentTarget.disabled = false; }
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

async function alurTab() {
  const d = await api.get('/api/approval-flow');
  return el('div', [
    el('div.notis.info', [el('div.isi', [
      el('strong', 'Alur persetujuan berbasis nominal'),
      el('div.kecil', 'Sistem memilih alur berdasarkan modul dan batas nominal transaksi. '
        + 'Tahapan bertipe "parallel" pada urutan yang sama harus disetujui seluruhnya.'),
    ])]),
    panelTabel('Konfigurasi Alur Persetujuan', tabel([
      { judul: 'Modul', render: (f) => judul(f.modul) },
      { judul: 'Nama Alur', kunci: 'nama' },
      { judul: 'Batas Bawah', angka: true, render: (f) => rp(f.batas_min) },
      { judul: 'Batas Atas', angka: true, render: (f) => (f.batas_max ? rp(f.batas_max)
        : el('span.samar', 'tak terbatas')) },
      { judul: 'Tahapan', render: (f) => {
        let t = [];
        try { t = JSON.parse(f.tahapan); } catch { /* format tidak valid */ }
        return el('div.kecil', t.map((x) => el('div',
          `${x.urut}. ${judul(x.role)} (${x.tipe}${x.sla_hari ? `, SLA ${x.sla_hari} hari` : ''})`)));
      } },
      { judul: 'Status', render: (f) => status(f.status) },
    ], d.data, { kosongTeks: 'Belum ada alur persetujuan dikonfigurasi' })),
  ]);
}
