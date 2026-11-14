const express = require('express');
const router = express.Router();
const db = require('../db');
const { authRequired, adminOnly } = require('../middleware/auth');

function getMonthReport(year, month) {
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;

  // Ambil pengaturan uang
  const settingsRows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const s of settingsRows) settings[s.key] = s.value;

  const uangMakan = parseInt(settings.allowance_meal || '25000', 10);
  const uangLemburPerJam = parseInt(settings.allowance_overtime || '20000', 10);
  const potTelat = parseInt(settings.penalty_late || '10000', 10);
  const potAlpa = parseInt(settings.penalty_absent || '75000', 10);

  const employees = db.prepare(`
    SELECT id, nip, name, position, shift_id, work_days 
    FROM users 
    WHERE role = 'karyawan' AND is_active = 1
    ORDER BY name ASC
  `).all();

  const report = [];

  for (const emp of employees) {
    // Ambil semua absensi bulan ini
    const attendances = db.prepare(`
      SELECT * FROM attendance 
      WHERE user_id = ? AND date LIKE ?
    `).all(emp.id, `${monthPrefix}%`);

    let hadir = 0;
    let telat = 0;
    let totalMenitTelat = 0;
    let totalMenitLembur = 0;

    for (const att of attendances) {
      if (att.check_in_time) {
        hadir++;
        if (att.status === 'telat') {
          telat++;
          totalMenitTelat += att.late_minutes || 0;
        }
        totalMenitLembur += att.overtime_minutes || 0;
      }
    }

    // Ambil izin yang disetujui bulan ini
    const leaves = db.prepare(`
      SELECT * FROM leaves 
      WHERE user_id = ? AND status = 'disetujui' 
        AND (start_date LIKE ? OR end_date LIKE ?)
    `).all(emp.id, `${monthPrefix}%`, `${monthPrefix}%`);

    let totalIzin = 0;
    for (const lv of leaves) {
      // Hitung hari (sederhana: jika dalam bulan yang sama)
      const start = new Date(lv.start_date);
      const end = new Date(lv.end_date);
      const days = Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;
      totalIzin += Math.max(1, days);
    }

    const tunjanganMakan = hadir * uangMakan;
    const tunjanganLembur = Math.floor(totalMenitLembur / 60) * uangLemburPerJam;
    const totalTunjangan = tunjanganMakan + tunjanganLembur;

    const totalPotongan = telat * potTelat;
    const estimasiBersih = totalTunjangan - totalPotongan;

    report.push({
      userId: emp.id,
      nip: emp.nip,
      name: emp.name,
      position: emp.position,
      hadir,
      telat,
      totalMenitTelat,
      totalMenitLembur,
      totalIzin,
      tunjanganMakan,
      tunjanganLembur,
      totalTunjangan,
      totalPotongan,
      estimasiBersih
    });
  }

  return { monthPrefix, report, settings: { uangMakan, uangLemburPerJam, potTelat, potAlpa } };
}

function getEmployeeDetailReport(userId, year, month) {
  const monthNum = String(month).padStart(2, '0');
  const monthPrefix = `${year}-${monthNum}`;

  const user = db.prepare(`
    SELECT u.id, u.nip, u.name, u.position, u.phone, u.avatar, u.work_days,
           s.name as shift_name, s.start_time, s.end_time, s.tolerance_minutes
    FROM users u
    LEFT JOIN shifts s ON u.shift_id = s.id
    WHERE u.id = ?
  `).get(userId);

  if (!user) return { user: null };

  const attendances = db.prepare(`
    SELECT a.*, s.name as shift_name, s.start_time, s.end_time
    FROM attendance a
    JOIN users u ON a.user_id = u.id
    LEFT JOIN shifts s ON u.shift_id = s.id
    WHERE a.user_id = ? AND a.date LIKE ?
    ORDER BY a.date DESC
  `).all(userId, `${monthPrefix}%`);

  const leaves = db.prepare(`
    SELECT * FROM leaves
    WHERE user_id = ? AND status = 'disetujui'
      AND (start_date LIKE ? OR end_date LIKE ?)
    ORDER BY start_date DESC
  `).all(userId, `${monthPrefix}%`, `${monthPrefix}%`);

  let hadir = 0;
  let telat = 0;
  let totalMenitTelat = 0;
  let totalMenitLembur = 0;
  let totalMenitKerja = 0;

  const logs = attendances.map((att) => {
    let inTime = null;
    let outTime = null;
    let durationMins = 0;

    if (att.check_in_time) {
      hadir++;
      const inDate = new Date(att.check_in_time);
      inTime = inDate.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

      if (att.status === 'telat') {
        telat++;
        totalMenitTelat += att.late_minutes || 0;
      }
      totalMenitLembur += att.overtime_minutes || 0;

      if (att.check_out_time) {
        const outDate = new Date(att.check_out_time);
        outTime = outDate.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
        durationMins = Math.max(0, Math.floor((outDate - inDate) / 60000));
        totalMenitKerja += durationMins;
      }
    }

    const durationText = durationMins > 0 ? `${Math.floor(durationMins / 60)}j ${durationMins % 60}m` : '-';
    const statusLabel = att.status === 'telat' ? `Terlambat (${att.late_minutes}m)` : 'Tepat Waktu';

    return {
      id: att.id,
      date: att.date,
      shift_name: att.shift_name,
      check_in_time: att.check_in_time,
      check_out_time: att.check_out_time,
      in_time: inTime,
      out_time: outTime,
      duration_minutes: durationMins,
      duration_text: durationText,
      status: att.status,
      status_label: statusLabel,
      late_minutes: att.late_minutes || 0,
      overtime_minutes: att.overtime_minutes || 0,
      distance: att.check_in_distance,
      in_photo: att.check_in_photo,
      out_photo: att.check_out_photo,
      notes: att.notes
    };
  });

  let totalIzinDays = 0;
  for (const lv of leaves) {
    const start = new Date(lv.start_date);
    const end = new Date(lv.end_date);
    const days = Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;
    totalIzinDays += Math.max(1, days);
  }

  return {
    monthPrefix,
    user,
    summary: {
      hadir,
      telat,
      totalMenitTelat,
      totalMenitLembur,
      totalMenitKerja,
      totalJamKerja: (totalMenitKerja / 60).toFixed(1),
      totalIzinDays
    },
    logs,
    leaves
  };
}

// GET /api/reports/monthly
router.get('/monthly', authRequired, adminOnly, (req, res) => {
  const year = req.query.year || new Date().getFullYear();
  const month = req.query.month || (new Date().getMonth() + 1);

  const data = getMonthReport(year, month);
  res.json({ success: true, ...data });
});

// GET /api/reports/employee/:id (Rekapan detail kehadiran per karyawan)
router.get('/employee/:id', authRequired, (req, res) => {
  if (req.user.role !== 'admin' && String(req.user.id) !== String(req.params.id)) {
    return res.status(403).json({ success: false, message: 'Akses ditolak.' });
  }

  const year = req.query.year || new Date().getFullYear();
  const month = req.query.month || (new Date().getMonth() + 1);

  const data = getEmployeeDetailReport(req.params.id, year, month);
  if (!data.user) {
    return res.status(404).json({ success: false, message: 'Karyawan tidak ditemukan.' });
  }

  res.json({ success: true, ...data });
});

// GET /api/reports/export-employee-csv/:id (Unduh rekapan per karyawan)
router.get('/export-employee-csv/:id', authRequired, (req, res) => {
  if (req.user.role !== 'admin' && String(req.user.id) !== String(req.params.id)) {
    return res.status(403).json({ success: false, message: 'Akses ditolak.' });
  }

  const year = req.query.year || new Date().getFullYear();
  const month = req.query.month || (new Date().getMonth() + 1);

  const data = getEmployeeDetailReport(req.params.id, year, month);
  if (!data.user) {
    return res.status(404).json({ success: false, message: 'Karyawan tidak ditemukan.' });
  }

  const header = ['Tanggal', 'NIP', 'Nama Karyawan', 'Shift', 'Jam Masuk', 'Status Masuk', 'Terlambat (Menit)', 'Jam Pulang', 'Durasi Kerja', 'Lembur (Menit)', 'Jarak GPS Masuk (m)', 'Catatan'];
  const rows = [header.join(',')];

  for (const log of data.logs) {
    const row = [
      `"${log.date}"`,
      `"${data.user.nip}"`,
      `"${data.user.name}"`,
      `"${log.shift_name || '-'}"`,
      `"${log.in_time || '-'}"`,
      `"${log.status_label || '-'}"`,
      log.late_minutes || 0,
      `"${log.out_time || '-'}"`,
      `"${log.duration_text || '-'}"`,
      log.overtime_minutes || 0,
      log.distance != null ? log.distance : '-',
      `"${log.notes || '-'}"`
    ];
    rows.push(row.join(','));
  }

  const csvContent = '\uFEFF' + rows.join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="rekap_absen_${data.user.nip}_${data.monthPrefix}.csv"`);
  res.send(csvContent);
});

// GET /api/reports/export-csv
router.get('/export-csv', authRequired, adminOnly, (req, res) => {
  const year = req.query.year || new Date().getFullYear();
  const month = req.query.month || (new Date().getMonth() + 1);

  const { monthPrefix, report } = getMonthReport(year, month);

  // Buat CSV
  const header = ['NIP', 'Nama Karyawan', 'Jabatan', 'Hadir (Hari)', 'Telat (Hari)', 'Menit Telat', 'Lembur (Menit)', 'Izin/Sakit (Hari)', 'Uang Makan (Rp)', 'Uang Lembur (Rp)', 'Total Tunjangan (Rp)', 'Potongan Telat (Rp)', 'Estimasi Bersih (Rp)'];
  const rows = [header.join(',')];

  for (const r of report) {
    const row = [
      `"${r.nip}"`,
      `"${r.name}"`,
      `"${r.position || '-'}"`,
      r.hadir,
      r.telat,
      r.totalMenitTelat,
      r.totalMenitLembur,
      r.totalIzin,
      r.tunjanganMakan,
      r.tunjanganLembur,
      r.totalTunjangan,
      r.totalPotongan,
      r.estimasiBersih
    ];
    rows.push(row.join(','));
  }

  const csvContent = '\uFEFF' + rows.join('\r\n'); // UTF-8 BOM untuk Excel Indonesia
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="rekap_absensi_${monthPrefix}.csv"`);
  res.send(csvContent);
});

module.exports = router;
