const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const db = new DatabaseSync('data/absensi.db');

console.log('--- Memulai Seeding Data Contoh ---');

// 1. Tambah Karyawan Contoh Baru jika belum ada
const insertUser = db.prepare(`
  INSERT OR IGNORE INTO users (nip, name, role, password, position, shift_id, phone, work_days)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const passHash = bcrypt.hashSync('1234', 10);
insertUser.run('1004', 'Budi Santoso', 'karyawan', passHash, 'Staff Gudang', 2, '081233445566', '[1,2,3,4,5]');
insertUser.run('1005', 'Dewi Lestari', 'karyawan', passHash, 'Customer Service', 1, '081277889900', '[1,2,3,4,5]');
insertUser.run('1006', 'Ahmad Fauzi', 'karyawan', passHash, 'Security Guard', 3, '081311223344', '[1,2,3,4,5,6]');

// Ambil semua karyawan
const employees = db.prepare(`
  SELECT u.*, s.name as shift_name, s.start_time, s.end_time, s.tolerance_minutes 
  FROM users u 
  LEFT JOIN shifts s ON u.shift_id = s.id 
  WHERE u.role = 'karyawan'
  ORDER BY u.id ASC
`).all();

console.log(`Ditemukan ${employees.length} karyawan aktif.`);

const selfies = [
  '/uploads/selfies/selfie_1794655575105_jy5n9o.jpg',
  '/uploads/selfies/selfie_1794655977273_y4jkrj.jpg',
  '/uploads/selfies/selfie_1794656704223_u1n5le.jpg',
  '/uploads/selfies/selfie_1794658391914_rha9qn.jpg',
  '/uploads/selfies/selfie_1794658523083_vyek97.jpg',
  '/uploads/selfies/selfie_1794659508122_bda3rb.jpg',
  '/uploads/selfies/selfie_1794659551491_z71sfk.jpg',
  '/uploads/selfies/selfie_1794659871091_r0iygb.jpg',
  '/uploads/selfies/selfie_1794659892137_vn1xyi.jpg',
  '/uploads/selfies/selfie_1794664782952_m3jkf0.jpg',
  '/uploads/selfies/selfie_1794665548201_cv8wz0.jpg',
  '/uploads/selfies/selfie_1794665626460_yaildb.jpg',
  '/uploads/selfies/selfie_1794666190597_ypg5ff.jpg'
];

let photoIdx = 0;
function getPhoto() {
  const p = selfies[photoIdx % selfies.length];
  photoIdx++;
  return p;
}

const insertAtt = db.prepare(`
  INSERT OR REPLACE INTO attendance (
    user_id, date, check_in_time, check_out_time, 
    check_in_lat, check_in_lng, check_in_distance, check_in_photo,
    check_out_lat, check_out_lng, check_out_distance, check_out_photo,
    status, late_minutes, overtime_minutes, notes
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

// Tanggal kerja Oktober & November 2026
const datesOct = [
  '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23',
  '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'
];

const datesNov = [
  '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06',
  '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'
];

const allDates = [...datesOct, ...datesNov];
const baseLat = 3.318142;
const baseLng = 117.575722;

let totalAtt = 0;

for (const emp of employees) {
  for (let i = 0; i < allDates.length; i++) {
    const dStr = allDates[i];
    
    // Jangan overwrite hari ini (tanggal 14) agar user bisa tetap coba langsung hari ini
    if (dStr === '2026-11-14') continue;

    const seed = (emp.id * 19 + i * 11) % 100;

    // Hari tidak masuk (izin/cuti)
    if (seed < 8) continue;

    const isLate = seed >= 68 && seed < 86;
    const isOvertime = seed >= 35 && seed < 60;

    const startH = parseInt((emp.start_time || '08:00').split(':')[0], 10);
    const startM = parseInt((emp.start_time || '08:00').split(':')[1], 10);
    const endH = parseInt((emp.end_time || '16:00').split(':')[0], 10);
    const endM = parseInt((emp.end_time || '16:00').split(':')[1], 10);

    let inMinOffset = 0;
    let lateMins = 0;
    let status = 'hadir';

    if (isLate) {
      status = 'telat';
      lateMins = 10 + (seed % 28); // 10 s/d 37 menit
      inMinOffset = (emp.tolerance_minutes || 10) + lateMins;
    } else {
      inMinOffset = -(4 + (seed % 10)); // datang lebih awal 4-13 menit
    }

    let outMinOffset = 0;
    let overtimeMins = 0;
    if (isOvertime) {
      overtimeMins = 40 + (seed % 80); // lembur 40-119 menit
      outMinOffset = overtimeMins;
    } else {
      outMinOffset = 3 + (seed % 12);
    }

    const inDate = new Date(dStr + 'T00:00:00');
    inDate.setHours(startH, startM + inMinOffset, seed % 60);

    const outDate = new Date(dStr + 'T00:00:00');
    outDate.setHours(endH, endM + outMinOffset, (seed * 3) % 60);

    const distIn = 6 + (seed % 35);
    const distOut = 8 + ((seed * 2) % 40);

    insertAtt.run(
      emp.id,
      dStr,
      inDate.toISOString(),
      outDate.toISOString(),
      baseLat + (seed % 10) * 0.00004,
      baseLng + (seed % 10) * 0.00004,
      distIn,
      getPhoto(),
      baseLat,
      baseLng,
      distOut,
      getPhoto(),
      status,
      lateMins,
      overtimeMins,
      isLate ? 'Macet di perjalanan' : null
    );
    totalAtt++;
  }
}

console.log(`Berhasil menambahkan ${totalAtt} data absensi harian.`);

// 3. Tambah Data Pengajuan Izin / Cuti / Sakit
db.prepare('DELETE FROM leaves').run();

const insertLeave = db.prepare(`
  INSERT INTO leaves (user_id, type, start_date, end_date, reason, attachment, status, reviewed_by, reviewed_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

// Cuti tahunan Rina
insertLeave.run(2, 'cuti', '2026-11-03', '2026-11-04', 'Cuti tahunan keperluan keluarga', null, 'disetujui', 1, '2026-11-01 09:00:00');

// Sakit Dimas dengan surat dokter
insertLeave.run(3, 'sakit', '2026-11-10', '2026-11-10', 'Demam tinggi dan flu berat (istirahat dokter)', '/uploads/selfies/selfie_1794655575105_jy5n9o.jpg', 'disetujui', 1, '2026-11-10 08:30:00');

// Izin Siti Nurhaliza (Status: Menunggu Persetujuan Admin)
insertLeave.run(4, 'izin', '2026-11-17', '2026-11-18', 'Menghadiri acara wisuda adik kandung di luar kota', null, 'menunggu', null, null);

// Izin Budi Santoso (Status: Ditolak)
insertLeave.run(5, 'izin', '2026-11-12', '2026-11-12', 'Keperluan pribadi mendadak', null, 'ditolak', 1, '2026-11-11 14:00:00');

// Sakit Dewi Lestari (Status: Menunggu)
insertLeave.run(6, 'sakit', '2026-11-16', '2026-11-16', 'Pemeriksaan rutin kesehatan', null, 'menunggu', null, null);

console.log('Berhasil menambahkan 5 data pengajuan izin/sakit/cuti.');
console.log('--- Seeding Selesai! ---');
