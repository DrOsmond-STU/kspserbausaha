/**
 * Modul 23 - CRM Anggota (tiket, broadcast, survei kepuasan).
 */
import {
  api, el, kpi, panel, panelTabel, tabel, angka, desimal, tgl, waktu, status, judul, modal,
  kolom, input, pilih, bacaForm, toast, galat, memuat, kosongkan, kosong,
} from '../inti.js';
import { izin } from '../app.js';
import { cetakDokumen, tombolCetak } from '../cetak.js';
import { ikon } from '../ikon.js';

export async function render() {
  const wadah = el('div');
  const isi = el('div');
  const daftarTab = [
    { judul: 'Tiket Layanan', render: tiketTab },
    { judul: 'Broadcast', render: broadcastTab },
    { judul: 'Survei Kepuasan', render: surveiTab },
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

async function tiketTab() {
  const wadah = el('div');
  let filter = '';
  async function muat() {
    kosongkan(wadah).append(memuat());
    try {
      const d = await api.get('/api/crm/tiket', { status: filter });
      const r = d.ringkasan;
      kosongkan(wadah).append(
        el('div.grid.k4.mb16', [
          kpi('Tiket Baru', angka(r.baru), { jenis: r.baru ? 'peringatan' : 'sukses' }),
          kpi('Sedang Diproses', angka(r.diproses)),
          kpi('Selesai', angka(r.selesai), { jenis: 'sukses' }),
          kpi('Rata-rata Rating', `${desimal(r.rata_rating)} / 5`, { ikon: ikon('bintang') }),
        ]),
        panelTabel('Tiket Layanan Anggota', tabel([
          { judul: 'Nomor', render: (t) => el('span.mono.kecil', t.nomor) },
          { judul: 'Anggota', render: (t) => (t.anggota_nama
            ? el('div', [el('div', t.anggota_nama), el('div.kecil.samar', t.nomor_anggota)])
            : el('span.samar', 'umum')) },
          { judul: 'Kategori', render: (t) => status(t.kategori === 'pengaduan' ? 'peringatan' : 'netral',
            judul(t.kategori)) },
          { judul: 'Judul', kunci: 'judul' },
          { judul: 'Prioritas', render: (t) => status(['tinggi', 'urgent'].includes(t.prioritas)
            ? 'bahaya' : 'netral', judul(t.prioritas)) },
          { judul: 'Kanal', render: (t) => el('span.kecil', judul(t.kanal || '-')) },
          { judul: 'Balasan', angka: true, render: (t) => angka(t.jumlah_balasan) },
          { judul: 'Status', render: (t) => status(t.status) },
        ], d.data, { saatKlik: (t) => buka(t.id, muat), kosongTeks: 'Belum ada tiket layanan' }), [
          pilih('f', ['', 'baru', 'diproses', 'menunggu', 'selesai', 'ditutup']
            .map((s) => ({ nilai: s, teks: s ? judul(s) : 'Semua status' })), filter,
          { onchange: (e) => { filter = e.target.value; muat(); } }),
          izin('crm.update') && el('button.btn.utama', { onclick: () => formTiket(muat) }, '+ Buat Tiket'),
          tombolCetak(() => ({
            judul: 'Daftar Tiket Layanan Anggota', jenis_ttd: 'laporan', orientasi: 'landscape',
            keterangan: filter ? [`Status: ${judul(filter)}`] : [],
            bagian: [{
              kolom: [{ kunci: 'no', label: 'No', tipe: 'angka' }, { kunci: 'nomor', label: 'Nomor' },
                { kunci: 'tanggal', label: 'Tanggal', tipe: 'tanggal' }, { kunci: 'anggota', label: 'Anggota' },
                { kunci: 'kategori', label: 'Kategori' }, { kunci: 'judul', label: 'Judul' },
                { kunci: 'prioritas', label: 'Prioritas' }, { kunci: 'kanal', label: 'Kanal' },
                { kunci: 'jumlah_balasan', label: 'Balasan', tipe: 'angka' }, { kunci: 'status', label: 'Status' }],
              baris: d.data.map((t, i) => ({ ...t, no: i + 1, tanggal: t.created_at,
                anggota: t.anggota_nama ? `${t.anggota_nama} (${t.nomor_anggota})` : 'Umum',
                kategori: judul(t.kategori), prioritas: judul(t.prioritas), kanal: judul(t.kanal || '-'),
                status: judul(t.status) })),
            }],
          }), { label: 'Cetak' }),
        ].filter(Boolean)),
      );
    } catch (err) { galat(err); }
  }
  await muat();
  return wadah;
}

async function buka(id, saatSelesai) {
  const t = await api.get(`/api/crm/tiket/${id}`);
  const balasan = el('div', { gaya: { maxHeight: '300px', overflowY: 'auto', marginBottom: '14px' } },
    t.balasan.length ? t.balasan.map((b) => el('div', {
      gaya: { padding: '10px 12px', marginBottom: '8px', borderRadius: '8px',
        background: b.is_petugas ? 'var(--info-bg)' : 'var(--bg-subtle)',
        border: '1px solid var(--border)' },
    }, [
      el('div.antara', [
        el('strong.kecil', `${b.oleh || 'Anggota'}${b.is_petugas ? ' (petugas)' : ''}`),
        el('span.kecil.samar', waktu(b.created_at)),
      ]),
      el('div.kecil', { gaya: { marginTop: '4px' } }, b.isi),
    ])) : [el('div.samar.kecil', 'Belum ada balasan')]);

  const isiBalas = el('textarea', { name: 'isi', placeholder: 'Tulis balasan…' });
  const tutup = modal({
    judul: `${t.nomor} — ${t.judul}`, lebar: 'lebar',
    isi: el('div', [
      el('dl.deskripsi.mb16', [
        el('dt', 'Anggota'), el('dd', t.anggota_nama
          ? `${t.anggota_nama} (${t.nomor_anggota}) · ${t.telepon || '-'}` : 'umum'),
        el('dt', 'Kategori'), el('dd', judul(t.kategori)),
        el('dt', 'Prioritas'), el('dd', judul(t.prioritas)),
        el('dt', 'Kanal'), el('dd', judul(t.kanal || '-')),
        el('dt', 'Dibuat'), el('dd', waktu(t.created_at)),
        el('dt', 'Petugas'), el('dd', t.petugas || '-'),
        el('dt', 'Status'), el('dd', status(t.status)),
      ]),
      t.isi ? el('div.notis.info', [el('div.isi', [el('strong', 'Isi tiket'), el('div', t.isi)])]) : null,
      el('div.tebal.mb8', 'Percakapan'),
      balasan,
      izin('crm.update') ? kolom('Balasan', isiBalas) : null,
    ]),
    kaki: [
      el('button.btn', { onclick: () => cetakDokumen(dokTiket(t)) }, 'Cetak'),
      izin('crm.update') && !['selesai', 'ditutup'].includes(t.status) && el('button.btn.sukses', {
        onclick: async () => {
          try {
            await api.post(`/api/crm/tiket/${id}/tutup`, {});
            toast('Tiket diselesaikan', 'sukses'); tutup(); saatSelesai?.();
          } catch (err) { galat(err); }
        },
      }, '✓ Selesaikan'),
      izin('crm.update') && el('button.btn.utama', { onclick: async () => {
        if (!isiBalas.value.trim()) { toast('Isi balasan tidak boleh kosong', 'peringatan'); return; }
        try {
          await api.post(`/api/crm/tiket/${id}/balas`, { isi: isiBalas.value });
          toast('Balasan terkirim', 'sukses'); tutup(); saatSelesai?.(); buka(id, saatSelesai);
        } catch (err) { galat(err); }
      } }, 'Kirim Balasan'),
    ].filter(Boolean),
  });
}

async function formTiket(saatSelesai) {
  const anggota = await api.get('/api/anggota', { status: 'aktif', limit: 500 }).catch(() => ({ data: [] }));
  const f = el('div', [
    kolom('Anggota', pilih('anggota_id', [{ nilai: '', teks: '- umum / bukan anggota -' },
      ...anggota.data.map((a) => ({ nilai: a.id, teks: `${a.nomor_anggota} — ${a.nama}` }))])),
    el('div.baris-form.k3', [
      kolom('Kategori', pilih('kategori', ['pertanyaan', 'pengaduan', 'saran', 'klaim']
        .map((k) => ({ nilai: k, teks: judul(k) })))),
      kolom('Prioritas', pilih('prioritas', ['rendah', 'normal', 'tinggi', 'urgent']
        .map((p) => ({ nilai: p, teks: judul(p) })), 'normal')),
      kolom('Kanal', pilih('kanal', ['aplikasi', 'whatsapp', 'telepon', 'email', 'langsung']
        .map((k) => ({ nilai: k, teks: judul(k) })))),
    ]),
    kolom('Judul', input('judul'), { wajib: true }),
    kolom('Isi', el('textarea', { name: 'isi' })),
  ]);
  const tutup = modal({
    judul: 'Buat Tiket Layanan', isi: f,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async (e) => {
        const tombol = e.currentTarget;
        tombol.disabled = true;
        try {
          await api.post('/api/crm/tiket', bacaForm(f));
          toast('Tiket berhasil dibuat', 'sukses'); tutup(); saatSelesai?.();
        } catch (err) { galat(err); tombol.disabled = false; }
      } }, 'Simpan'),
    ],
  });
}

async function broadcastTab() {
  const wadah = el('div');
  async function muat() {
    kosongkan(wadah).append(memuat());
    try {
      const d = await api.get('/api/crm/broadcast');
      kosongkan(wadah).append(panelTabel('Riwayat Broadcast', tabel([
        { judul: 'Judul', kunci: 'judul' },
        { judul: 'Pesan', render: (b) => el('span.kecil.lembut', String(b.pesan).slice(0, 80)) },
        { judul: 'Kanal', render: (b) => status('netral', judul(b.kanal)) },
        { judul: 'Target', render: (b) => judul(b.target) },
        { judul: 'Penerima', angka: true, render: (b) => angka(b.jumlah_target) },
        { judul: 'Dikirim', render: (b) => (b.dikirim_pada ? waktu(b.dikirim_pada) : '-') },
        { judul: 'Status', render: (b) => status(b.status) },
      ], d.data, { kosongTeks: 'Belum ada broadcast dikirim' }), [
        izin('crm.update') && el('button.btn.utama', { onclick: () => formBroadcast(muat) },
          '+ Kirim Broadcast'),
      ].filter(Boolean)));
    } catch (err) { galat(err); }
  }
  await muat();
  return wadah;
}

function formBroadcast(saatSelesai) {
  const f = el('div', [
    kolom('Judul', input('judul'), { wajib: true }),
    kolom('Pesan', el('textarea', { name: 'pesan' }), { wajib: true }),
    el('div.baris-form', [
      kolom('Kanal', pilih('kanal', ['aplikasi', 'whatsapp', 'sms', 'email']
        .map((k) => ({ nilai: k, teks: judul(k) })))),
      kolom('Target Penerima', pilih('target', [
        { nilai: 'aktif', teks: 'Seluruh anggota aktif' },
        { nilai: 'semua', teks: 'Seluruh anggota (termasuk nonaktif)' },
        { nilai: 'punya_pinjaman', teks: 'Anggota dengan pinjaman berjalan' },
      ])),
    ]),
    el('div.kecil.lembut', 'Kanal "aplikasi" langsung masuk ke pusat notifikasi anggota. '
      + 'Kanal WhatsApp/SMS/Email memerlukan integrasi penyedia layanan pada tahap implementasi.'),
  ]);
  const tutup = modal({
    judul: 'Kirim Broadcast', isi: f,
    kaki: [
      el('button.btn', { onclick: () => tutup() }, 'Batal'),
      el('button.btn.utama', { onclick: async (e) => {
        const tombol = e.currentTarget;
        tombol.disabled = true;
        try {
          const h = await api.post('/api/crm/broadcast', bacaForm(f));
          toast('Broadcast terkirim', 'sukses', `${h.jumlah_target} penerima`);
          tutup(); saatSelesai?.();
        } catch (err) { galat(err); tombol.disabled = false; }
      } }, 'Kirim'),
    ],
  });
}

async function surveiTab() {
  const d = await api.get('/api/crm/survey/ringkasan');
  return el('div', [
    el('div.grid.k5.mb16', [
      kpi('Responden', angka(d.responden)),
      kpi('Skor Layanan', `${desimal(d.skor_layanan)} / 5`),
      kpi('Skor Produk', `${desimal(d.skor_produk)} / 5`),
      kpi('Skor Petugas', `${desimal(d.skor_petugas)} / 5`),
      kpi('Net Promoter Score', desimal(d.nps), {
        jenis: d.nps >= 50 ? 'sukses' : d.nps >= 0 ? 'peringatan' : 'bahaya',
        catatan: `${d.promoter} promoter · ${d.detractor} detractor` }),
    ]),
    el('div.notis.info', [el('div.isi', [
      el('strong', 'Net Promoter Score (NPS)'),
      el('div.kecil', 'NPS = %promoter (skor 9-10) − %detractor (skor 0-6). '
        + 'Nilai di atas 50 tergolong sangat baik.'),
    ])]),
    panelTabel('Saran & Masukan Terbaru', tabel([
      { judul: 'Waktu', render: (s) => waktu(s.created_at) },
      { judul: 'Saran', kunci: 'saran' },
    ], d.saran_terbaru, { kosongTeks: 'Belum ada saran dari anggota' })),
  ]);
}

/** Lembar tiket layanan beserta riwayat percakapan. */
function dokTiket(t) {
  return {
    judul: 'Lembar Tiket Layanan Anggota', subjudul: t.judul, nomor: t.nomor, jenis_ttd: 'default',
    ringkasan: [
      { label: 'Anggota', nilai: t.anggota_nama ? `${t.anggota_nama} (${t.nomor_anggota})` : 'Umum' },
      { label: 'Telepon', nilai: t.telepon || '-' },
      { label: 'Kategori', nilai: judul(t.kategori) },
      { label: 'Prioritas', nilai: judul(t.prioritas) },
      { label: 'Kanal', nilai: judul(t.kanal || '-') },
      { label: 'Dibuat', nilai: waktu(t.created_at) },
      { label: 'Petugas', nilai: t.petugas || '-' },
      { label: 'Status', nilai: judul(t.status) },
    ],
    bagian: [{
      judul: 'Percakapan',
      kolom: [{ kunci: 'waktu', label: 'Waktu' }, { kunci: 'oleh', label: 'Oleh' }, { kunci: 'isi', label: 'Isi' }],
      baris: [
        { waktu: waktu(t.created_at), oleh: t.anggota_nama || 'Pelapor', isi: t.isi || '-' },
        ...t.balasan.map((b) => ({ waktu: waktu(b.created_at),
          oleh: `${b.oleh || 'Anggota'}${b.is_petugas ? ' (petugas)' : ''}`, isi: b.isi })),
      ],
    }],
  };
}
