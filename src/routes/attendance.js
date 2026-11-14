const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');
const { authRequired, adminOnly } = require('../middleware/auth');
const { saveBase64Image } = require('../middleware/upload');
const appEvents = require('../events');

// Pengelola klien SSE Admin untuk update otomatis real-time
const sseClients = new Set();

function broadcastToAdmins(eventType, data) {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

appEvents.on('attendance:updated', (data) => broadcastToAdmins('attendance_updated', data));
appEvents.on('leave:submitted', (data) => broadcastToAdmins('leave_submitted', data));

// Helper: Ambil seluruh pengaturan ke bentuk object
function getSettingsMap() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const map = {};
  for (const r of rows) map[r.key] = r.value;
  return map;
}

// Helper: Format tanggal lokal YYYY-MM-DD
function getLocalDateString(d = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Helper: Haversine distance dalam meter
function getDistanceMeters(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return 0;
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c);
}

// Helper: Hitung jarak Euclidean antara dua 128-d face descriptors
function euclideanDistance(desc1, desc2) {
  if (!desc1 || !desc2 || desc1.length !== desc2.length) return 1.0;
  let sum = 0;
  for (let i = 0; i < desc1.length; i++) {
    const diff = desc1[i] - desc2[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

// Helper: Parse HH:mm ke Date object hari ini
function parseTimeToToday(dateStr, timeStr) {
  const [h, m] = (timeStr || '00:00').split(':').map(Number);
  const d = new Date(dateStr + 'T00:00:00');
  d.setHours(h, m, 0, 0);
  return d;
}

// GET /api/attendance/today (Status absensi hari ini untuk user login)
router.get('/today', authRequired, (req, res) => {
  const todayStr = getLocalDateString();
  const settings = getSettingsMap();

  const user = db.prepare(`
    SELECT u.id, u.name, u.nip, u.position, s.id as shift_id, s.name as shift_name, 
           s.start_time, s.end_time, s.tolerance_minutes, s.icon as shift_icon
    FROM users u
    LEFT JOIN shifts s ON u.shift_id = s.id
    WHERE u.id = ?
  `).get(req.user.id);

  const attendance = db.prepare('SELECT * FROM attendance WHERE user_id = ? AND date = ?').get(req.user.id, todayStr);

  // Periksa apakah user memiliki izin yang disetujui hari ini
  const leave = db.prepare(`
    SELECT * FROM leaves 
    WHERE user_id = ? AND status = 'disetujui' AND ? BETWEEN start_date AND end_date
  `).get(req.user.id, todayStr);

  res.json({
    success: true,
    today: todayStr,
    serverTime: new Date().toISOString(),
    user,
    attendance: attendance || null,
    leave: leave || null,
    office: {
      name: settings.office_name,
      lat: parseFloat(settings.office_lat || '0'),
      lng: parseFloat(settings.office_lng || '0'),
      radius: parseInt(settings.office_radius || '100', 10),
      requireLocation: settings.require_location === 'true',
      requireSelfie: settings.require_selfie === 'true'
    }
  });
});

// POST /api/attendance/check-in
router.post('/check-in', authRequired, (req, res) => {
  const todayStr = getLocalDateString();
  const now = new Date();
  const settings = getSettingsMap();

  // Periksa apakah sudah pernah check-in hari ini
  const existing = db.prepare('SELECT * FROM attendance WHERE user_id = ? AND date = ?').get(req.user.id, todayStr);
  if (existing && existing.check_in_time) {
    return res.status(400).json({ success: false, message: 'Anda sudah melakukan check-in hari ini.' });
  }

  // Periksa apakah sedang izin/cuti
  const leave = db.prepare(`
    SELECT * FROM leaves 
    WHERE user_id = ? AND status = 'disetujui' AND ? BETWEEN start_date AND end_date
  `).get(req.user.id, todayStr);
  if (leave) {
    return res.status(400).json({ success: false, message: `Anda terdaftar ${leave.type.toUpperCase()} hari ini.` });
  }

  const { lat, lng, photoBase64, faceDetected, liveDescriptor, notes } = req.body;

  // Ambil data user
  const user = db.prepare(`
    SELECT u.*, s.start_time, s.end_time, s.tolerance_minutes 
    FROM users u
    LEFT JOIN shifts s ON u.shift_id = s.id
    WHERE u.id = ?
  `).get(req.user.id);

  // Validasi Geofence jika diwajibkan
  const requireLocation = settings.require_location === 'true';
  let distance = null;
  const officeLat = parseFloat(settings.office_lat);
  const officeLng = parseFloat(settings.office_lng);
  const officeRadius = parseInt(settings.office_radius, 10);

  if (requireLocation) {
    if (lat == null || lng == null) {
      return res.status(400).json({ success: false, message: 'Lokasi GPS diperlukan untuk melakukan absensi.' });
    }
    distance = getDistanceMeters(lat, lng, officeLat, officeLng);
    if (distance > officeRadius) {
      return res.status(400).json({
        success: false,
        message: `Anda berada di luar radius kantor (${distance} meter dari kantor). Maksimal radius: ${officeRadius} meter.`
      });
    }
  } else if (lat != null && lng != null) {
    distance = getDistanceMeters(lat, lng, officeLat, officeLng);
  }

  // Validasi Selfie & Deteksi Wajah
  const requireSelfie = settings.require_selfie === 'true';
  let photoPath = null;
  if (requireSelfie) {
    if (!photoBase64) {
      return res.status(400).json({ success: false, message: 'Foto selfie wajah wajib diambil saat check-in.' });
    }

    // Wajib memiliki biometrik descriptor (128-d neural network array)
    // Jika memfoto dinding, plafon, lantai, atau bukan wajah manusia asli, descriptor tidak ada!
    if (!liveDescriptor || !Array.isArray(liveDescriptor) || liveDescriptor.length !== 128) {
      return res.status(400).json({
        success: false,
        message: 'Presensi ditolak! Foto bukan wajah manusia asli atau wajah tidak terdeteksi oleh sistem.'
      });
    }

    // Validasi Pencocokan Wajah Karyawan (Face Recognition)
    if (user && user.face_descriptor) {
      let registeredDesc = null;
      try { registeredDesc = JSON.parse(user.face_descriptor); } catch (e) {}

      if (registeredDesc) {
        const dist = euclideanDistance(liveDescriptor, registeredDesc);
        console.log(`[Face Match Check-in] User: ${user.name}, Distance: ${dist.toFixed(3)}`);
        // Ambang batas standar face recognition face-api.js (0.60)
        if (dist > 0.60) {
          return res.status(400).json({
            success: false,
            message: `Presensi ditolak! Wajah tidak cocok dengan data biometrik karyawan ${user.name}. Titip absen tidak diperbolehkan.`
          });
        }
      }
    }
  }

  if (photoBase64) {
    photoPath = saveBase64Image(photoBase64, 'selfies');

    // Jika karyawan belum pernah mendaftarkan wajah, otomatis simpan wajah saat absen valid pertama
    if (user && !user.face_descriptor && liveDescriptor && Array.isArray(liveDescriptor) && liveDescriptor.length === 128) {
      db.prepare('UPDATE users SET face_descriptor = ?, avatar = ? WHERE id = ?').run(JSON.stringify(liveDescriptor), photoPath, req.user.id);
    }
  }

  // Hitung keterlambatan berdasarkan Shift
  let status = 'hadir';
  let lateMinutes = 0;

  if (user && user.start_time) {
    const scheduledStart = parseTimeToToday(todayStr, user.start_time);
    const toleranceMs = (user.tolerance_minutes || 0) * 60 * 1000;
    const diffMs = now.getTime() - scheduledStart.getTime();

    if (diffMs > toleranceMs) {
      status = 'telat';
      lateMinutes = Math.floor(diffMs / 60000);
    }
  }

  // Simpan record absensi
  const stmt = db.prepare(`
    INSERT INTO attendance (
      user_id, date, check_in_time, check_in_lat, check_in_lng, 
      check_in_distance, check_in_photo, status, late_minutes, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, date) DO UPDATE SET
      check_in_time = excluded.check_in_time,
      check_in_lat = excluded.check_in_lat,
      check_in_lng = excluded.check_in_lng,
      check_in_distance = excluded.check_in_distance,
      check_in_photo = excluded.check_in_photo,
      status = excluded.status,
      late_minutes = excluded.late_minutes,
      notes = excluded.notes
  `);

  stmt.run(
    req.user.id,
    todayStr,
    now.toISOString(),
    lat || null,
    lng || null,
    distance,
    photoPath,
    status,
    lateMinutes,
    notes || null
  );

  const updated = db.prepare('SELECT * FROM attendance WHERE user_id = ? AND date = ?').get(req.user.id, todayStr);

  // Broadcast event real-time ke semua dashboard admin yang aktif
  appEvents.emit('attendance:updated', {
    action: 'check-in',
    userId: req.user.id,
    userName: user ? user.name : req.user.name,
    nip: user ? user.nip : req.user.nip,
    status,
    lateMinutes,
    time: now.toISOString(),
    distance,
    date: todayStr
  });

  res.json({
    success: true,
    message: status === 'telat' ? `Check-in berhasil. Anda terlambat ${lateMinutes} menit.` : 'Check-in berhasil tepat waktu.',
    attendance: updated
  });
});

// POST /api/attendance/check-out
router.post('/check-out', authRequired, (req, res) => {
  const todayStr = getLocalDateString();
  const now = new Date();
  const settings = getSettingsMap();

  const user = db.prepare(`
    SELECT u.*, s.start_time, s.end_time, s.tolerance_minutes 
    FROM users u
    LEFT JOIN shifts s ON u.shift_id = s.id
    WHERE u.id = ?
  `).get(req.user.id);

  const existing = db.prepare('SELECT * FROM attendance WHERE user_id = ? AND date = ?').get(req.user.id, todayStr);
  if (!existing || !existing.check_in_time) {
    return res.status(400).json({ success: false, message: 'Anda belum melakukan check-in hari ini.' });
  }

  if (existing.check_out_time) {
    return res.status(400).json({ success: false, message: 'Anda sudah melakukan check-out hari ini.' });
  }

  const { lat, lng, photoBase64, faceDetected, liveDescriptor } = req.body;

  // Validasi Geofence jika diwajibkan
  const requireLocation = settings.require_location === 'true';
  const officeRadius = parseInt(settings.office_radius, 10);
  let distance = null;
  const officeLat = parseFloat(settings.office_lat);
  const officeLng = parseFloat(settings.office_lng);

  if (requireLocation) {
    if (lat == null || lng == null) {
      return res.status(400).json({ success: false, message: 'Lokasi GPS diperlukan untuk melakukan check-out.' });
    }
    distance = getDistanceMeters(lat, lng, officeLat, officeLng);
    if (distance > officeRadius) {
      return res.status(400).json({
        success: false,
        message: `Check-out gagal: Anda berada di luar radius kantor (${distance}m dari kantor, maks ${officeRadius}m).`
      });
    }
  } else if (lat != null && lng != null) {
    distance = getDistanceMeters(lat, lng, officeLat, officeLng);
  }

  // Validasi Selfie & Biometrik Wajah saat Check-out
  const requireSelfie = settings.require_selfie === 'true';
  let photoPath = null;
  if (requireSelfie) {
    if (!photoBase64) {
      return res.status(400).json({ success: false, message: 'Foto selfie wajah wajib diambil saat check-out.' });
    }
    if (!liveDescriptor || !Array.isArray(liveDescriptor) || liveDescriptor.length !== 128) {
      return res.status(400).json({
        success: false,
        message: 'Presensi ditolak! Foto bukan wajah manusia asli atau wajah tidak terdeteksi oleh sistem.'
      });
    }

    if (user && user.face_descriptor) {
      let registeredDesc = null;
      try { registeredDesc = JSON.parse(user.face_descriptor); } catch (e) {}
      if (registeredDesc) {
        const dist = euclideanDistance(liveDescriptor, registeredDesc);
        console.log(`[Face Match Check-out] User: ${user.name}, Distance: ${dist.toFixed(3)}`);
        if (dist > 0.60) {
          return res.status(400).json({
            success: false,
            message: `Presensi ditolak! Wajah tidak cocok dengan data biometrik karyawan ${user.name}.`
          });
        }
      }
    }
  }

  if (photoBase64) {
    photoPath = saveBase64Image(photoBase64, 'selfies');
    if (user && !user.face_descriptor && liveDescriptor && Array.isArray(liveDescriptor) && liveDescriptor.length === 128) {
      db.prepare('UPDATE users SET face_descriptor = ?, avatar = ? WHERE id = ?').run(JSON.stringify(liveDescriptor), photoPath, req.user.id);
    }
  }

  let overtimeMinutes = 0;
  let earlyMinutes = 0;
  const minOvertime = parseInt(settings.min_overtime_minutes || '30', 10);

  if (user && user.end_time) {
    const scheduledEnd = parseTimeToToday(todayStr, user.end_time);
    const diffMs = now.getTime() - scheduledEnd.getTime();
    if (diffMs > minOvertime * 60 * 1000) {
      overtimeMinutes = Math.floor(diffMs / 60000);
    } else if (diffMs < -5 * 60 * 1000) {
      earlyMinutes = Math.floor(Math.abs(diffMs) / 60000);
    }
  }

  db.prepare(`
    UPDATE attendance SET 
      check_out_time = ?,
      check_out_lat = ?,
      check_out_lng = ?,
      check_out_distance = ?,
      check_out_photo = ?,
      overtime_minutes = ?
    WHERE user_id = ? AND date = ?
  `).run(
    now.toISOString(),
    lat || null,
    lng || null,
    distance,
    photoPath,
    overtimeMinutes,
    req.user.id,
    todayStr
  );

  const updated = db.prepare('SELECT * FROM attendance WHERE user_id = ? AND date = ?').get(req.user.id, todayStr);

  // Broadcast event real-time ke semua dashboard admin yang aktif
  appEvents.emit('attendance:updated', {
    action: 'check-out',
    userId: req.user.id,
    userName: user ? user.name : req.user.name,
    nip: user ? user.nip : req.user.nip,
    status: 'selesai',
    overtimeMinutes,
    time: now.toISOString(),
    distance,
    date: todayStr
  });

  let message = 'Check-out berhasil.';
  if (overtimeMinutes > 0) {
    message = `Check-out berhasil. Tercatat lembur ${overtimeMinutes} menit.`;
  } else if (earlyMinutes > 0) {
    message = `Check-out berhasil. Pulang ${earlyMinutes} menit lebih awal.`;
  } else {
    message = 'Check-out berhasil tepat waktu.';
  }

  res.json({
    success: true,
    message,
    attendance: updated
  });
});

// GET /api/attendance/stream (SSE Real-Time Stream untuk Dashboard Admin)
router.get('/stream', (req, res) => {
  const token = req.query.token || (req.headers.authorization && req.headers.authorization.split(' ')[1]);
  if (!token) {
    return res.status(401).json({ success: false, message: 'Token diperlukan.' });
  }

  try {
    const decoded = jwt.verify(token, config.JWT_SECRET);
    if (decoded.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Hanya Admin yang dapat mengakses stream.' });
    }
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Token tidak valid.' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  res.write(`event: connected\ndata: ${JSON.stringify({ status: 'connected', time: new Date().toISOString() })}\n\n`);
  sseClients.add(res);

  const heartbeat = setInterval(() => {
    try {
      res.write(': keep-alive\n\n');
    } catch {
      clearInterval(heartbeat);
      sseClients.delete(res);
    }
  }, 20000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

// GET /api/attendance/history (Riwayat absensi per bulan)
router.get('/history', authRequired, (req, res) => {
  const targetUserId = req.user.role === 'admin' && req.query.user_id ? req.query.user_id : req.user.id;
  const year = req.query.year || new Date().getFullYear();
  const month = req.query.month ? String(req.query.month).padStart(2, '0') : String(new Date().getMonth() + 1).padStart(2, '0');
  const monthPrefix = `${year}-${month}`;

  const attendances = db.prepare(`
    SELECT a.*, u.name as user_name, u.nip, s.name as shift_name
    FROM attendance a
    JOIN users u ON a.user_id = u.id
    LEFT JOIN shifts s ON u.shift_id = s.id
    WHERE a.user_id = ? AND a.date LIKE ?
    ORDER BY a.date DESC
  `).all(targetUserId, `${monthPrefix}%`);

  const leaves = db.prepare(`
    SELECT * FROM leaves
    WHERE user_id = ? AND (start_date LIKE ? OR end_date LIKE ?)
  `).all(targetUserId, `${monthPrefix}%`, `${monthPrefix}%`);

  res.json({ success: true, month: monthPrefix, attendances, leaves });
});

// GET /api/attendance/admin/today (Ringkasan hari ini untuk Dashboard Admin)
router.get('/admin/today', authRequired, adminOnly, (req, res) => {
  const todayStr = getLocalDateString();

  const employees = db.prepare(`
    SELECT u.id, u.nip, u.name, u.position, u.phone, u.avatar,
           s.name as shift_name, s.start_time, s.end_time,
           a.check_in_time, a.check_out_time, a.status, a.late_minutes, 
           a.overtime_minutes, a.check_in_distance, a.check_in_photo, a.check_out_photo
    FROM users u
    LEFT JOIN shifts s ON u.shift_id = s.id
    LEFT JOIN attendance a ON u.id = a.user_id AND a.date = ?
    WHERE u.role = 'karyawan' AND u.is_active = 1
    ORDER BY u.name ASC
  `).all(todayStr);

  const approvedLeaves = db.prepare(`
    SELECT l.*, u.name as user_name, u.nip
    FROM leaves l
    JOIN users u ON l.user_id = u.id
    WHERE l.status = 'disetujui' AND ? BETWEEN l.start_date AND l.end_date
  `).all(todayStr);

  const leaveUserIds = new Set(approvedLeaves.map(l => l.user_id));

  // Hitung ringkasan
  let countHadir = 0;
  let countTelat = 0;
  let countIzin = approvedLeaves.length;
  let countBelum = 0;

  for (const emp of employees) {
    if (leaveUserIds.has(emp.id)) {
      emp.status_today = 'izin';
    } else if (emp.check_in_time) {
      if (emp.status === 'telat') {
        countTelat++;
        emp.status_today = 'telat';
      } else {
        countHadir++;
        emp.status_today = 'hadir';
      }
    } else {
      countBelum++;
      emp.status_today = 'belum';
    }
  }

  res.json({
    success: true,
    today: todayStr,
    summary: {
      totalKaryawan: employees.length,
      hadir: countHadir,
      telat: countTelat,
      izin: countIzin,
      belumHadir: countBelum
    },
    employees,
    leaves: approvedLeaves
  });
});

module.exports = router;
