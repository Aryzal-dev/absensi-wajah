const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const config = require('../config');
const { authRequired, adminOnly } = require('../middleware/auth');
const { saveBase64Image } = require('../middleware/upload');

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { nip, password } = req.body;

  if (!nip || !password) {
    return res.status(400).json({ success: false, message: 'NIP / ID dan Password / PIN wajib diisi.' });
  }

  const user = db.prepare(`
    SELECT u.*, s.name as shift_name, s.start_time, s.end_time 
    FROM users u
    LEFT JOIN shifts s ON u.shift_id = s.id
    WHERE u.nip = ?
  `).get(nip.trim());

  if (!user) {
    return res.status(401).json({ success: false, message: 'NIP atau password salah.' });
  }

  if (!user.is_active) {
    return res.status(403).json({ success: false, message: 'Akun ini telah dinonaktifkan oleh Admin.' });
  }

  const isMatch = bcrypt.compareSync(password, user.password);
  if (!isMatch) {
    return res.status(401).json({ success: false, message: 'NIP atau password salah.' });
  }

  const token = jwt.sign(
    { id: user.id, nip: user.nip, role: user.role, name: user.name },
    config.JWT_SECRET,
    { expiresIn: '30d' }
  );

  res.json({
    success: true,
    message: 'Login berhasil.',
    token,
    user: {
      id: user.id,
      nip: user.nip,
      name: user.name,
      role: user.role,
      position: user.position,
      shift_id: user.shift_id,
      shift_name: user.shift_name,
      start_time: user.start_time,
      end_time: user.end_time,
      avatar: user.avatar
    }
  });
});

// GET /api/auth/me
router.get('/me', authRequired, (req, res) => {
  const user = db.prepare(`
    SELECT u.id, u.nip, u.name, u.role, u.position, u.phone, u.avatar, u.work_days,
           s.id as shift_id, s.name as shift_name, s.start_time, s.end_time, s.tolerance_minutes
    FROM users u
    LEFT JOIN shifts s ON u.shift_id = s.id
    WHERE u.id = ?
  `).get(req.user.id);

  res.json({ success: true, user });
});

// PUT /api/auth/change-password
router.put('/change-password', authRequired, (req, res) => {
  const { oldPassword, newPassword } = req.body;

  if (!oldPassword || !newPassword) {
    return res.status(400).json({ success: false, message: 'Password lama dan baru wajib diisi.' });
  }

  if (newPassword.length < 4) {
    return res.status(400).json({ success: false, message: 'Password baru minimal 4 karakter.' });
  }

  const user = db.prepare('SELECT password FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(oldPassword, user.password)) {
    return res.status(400).json({ success: false, message: 'Password lama salah.' });
  }

  const hashed = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashed, req.user.id);

  res.json({ success: true, message: 'Password berhasil diperbarui.' });
});

// POST /api/auth/enroll-face (Daftarkan data wajah biometrik karyawan)
router.post('/enroll-face', authRequired, (req, res) => {
  const { descriptor, photoBase64 } = req.body;

  if (!descriptor || !Array.isArray(descriptor) || descriptor.length !== 128) {
    return res.status(400).json({ success: false, message: 'Data fitur wajah (128-d descriptor) tidak valid.' });
  }

  let photoPath = null;
  if (photoBase64) {
    photoPath = saveBase64Image(photoBase64, 'selfies');
  }

  const descriptorJson = JSON.stringify(descriptor);

  if (photoPath) {
    db.prepare('UPDATE users SET face_descriptor = ?, avatar = ? WHERE id = ?').run(descriptorJson, photoPath, req.user.id);
  } else {
    db.prepare('UPDATE users SET face_descriptor = ? WHERE id = ?').run(descriptorJson, req.user.id);
  }

  res.json({
    success: true,
    message: 'Data wajah biometrik berhasil didaftarkan.',
    avatar: photoPath
  });
});

// POST /api/auth/reset-face/:id (Reset data wajah karyawan oleh Admin)
router.post('/reset-face/:id', authRequired, adminOnly, (req, res) => {
  const userId = req.params.id;
  db.prepare('UPDATE users SET face_descriptor = NULL WHERE id = ?').run(userId);
  res.json({ success: true, message: 'Data wajah karyawan berhasil direset.' });
});

module.exports = router;
