const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const { authRequired, adminOnly } = require('../middleware/auth');

// GET /api/employees (Daftar karyawan)
router.get('/', authRequired, adminOnly, (req, res) => {
  const employees = db.prepare(`
    SELECT u.id, u.nip, u.name, u.role, u.position, u.phone, u.avatar, u.work_days, u.is_active, u.created_at,
           (u.face_descriptor IS NOT NULL) as has_face,
           s.id as shift_id, s.name as shift_name, s.start_time, s.end_time
    FROM users u
    LEFT JOIN shifts s ON u.shift_id = s.id
    WHERE u.role = 'karyawan'
    ORDER BY u.is_active DESC, u.name ASC
  `).all();

  res.json({ success: true, employees });
});

// POST /api/employees (Tambah karyawan baru)
router.post('/', authRequired, adminOnly, (req, res) => {
  const { nip, name, position, shift_id, phone, pin, work_days } = req.body;

  if (!nip || !name || !pin) {
    return res.status(400).json({ success: false, message: 'NIP, Nama, dan PIN/Password wajib diisi.' });
  }

  // Cek duplikasi NIP
  const existing = db.prepare('SELECT id FROM users WHERE nip = ?').get(nip.trim());
  if (existing) {
    return res.status(400).json({ success: false, message: 'NIP sudah terdaftar untuk pengguna lain.' });
  }

  const hashedPassword = bcrypt.hashSync(pin.trim(), 10);
  const workDaysJson = work_days ? (typeof work_days === 'string' ? work_days : JSON.stringify(work_days)) : '[1,2,3,4,5,6]';

  const stmt = db.prepare(`
    INSERT INTO users (nip, name, role, password, position, shift_id, phone, work_days)
    VALUES (?, ?, 'karyawan', ?, ?, ?, ?, ?)
  `);

  const info = stmt.run(
    nip.trim(),
    name.trim(),
    hashedPassword,
    position ? position.trim() : null,
    shift_id || 1,
    phone ? phone.trim() : null,
    workDaysJson
  );

  res.json({
    success: true,
    message: 'Karyawan berhasil ditambahkan.',
    employeeId: info.lastInsertRowid
  });
});

// PUT /api/employees/:id (Update data karyawan)
router.put('/:id', authRequired, adminOnly, (req, res) => {
  const { name, position, shift_id, phone, pin, work_days, is_active } = req.body;
  const empId = req.params.id;

  const emp = db.prepare('SELECT * FROM users WHERE id = ? AND role = "karyawan"').get(empId);
  if (!emp) {
    return res.status(404).json({ success: false, message: 'Karyawan tidak ditemukan.' });
  }

  let updateQuery = `
    UPDATE users SET 
      name = ?, position = ?, shift_id = ?, phone = ?, 
      work_days = ?, is_active = ?
  `;
  const workDaysJson = work_days ? (typeof work_days === 'string' ? work_days : JSON.stringify(work_days)) : emp.work_days;
  const params = [
    name ? name.trim() : emp.name,
    position != null ? position.trim() : emp.position,
    shift_id != null ? shift_id : emp.shift_id,
    phone != null ? phone.trim() : emp.phone,
    workDaysJson,
    is_active !== undefined ? (is_active ? 1 : 0) : emp.is_active
  ];

  if (pin && pin.trim().length > 0) {
    updateQuery += ', password = ?';
    params.push(bcrypt.hashSync(pin.trim(), 10));
  }

  updateQuery += ' WHERE id = ?';
  params.push(empId);

  db.prepare(updateQuery).run(...params);

  res.json({ success: true, message: 'Data karyawan berhasil diperbarui.' });
});

// DELETE /api/employees/:id (Nonaktifkan / hapus karyawan)
router.delete('/:id', authRequired, adminOnly, (req, res) => {
  const empId = req.params.id;
  const emp = db.prepare('SELECT id FROM users WHERE id = ? AND role = "karyawan"').get(empId);
  if (!emp) {
    return res.status(404).json({ success: false, message: 'Karyawan tidak ditemukan.' });
  }

  // Soft delete (nonaktifkan) agar riwayat absensi tetap utuh
  db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(empId);
  res.json({ success: true, message: 'Karyawan berhasil dinonaktifkan.' });
});

module.exports = router;
