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

// GET /api/reports/monthly
router.get('/monthly', authRequired, adminOnly, (req, res) => {
  const year = req.query.year || new Date().getFullYear();
  const month = req.query.month || (new Date().getMonth() + 1);

  const data = getMonthReport(year, month);
  res.json({ success: true, ...data });
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
