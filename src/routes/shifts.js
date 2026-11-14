const express = require('express');
const router = express.Router();
const db = require('../db');
const { authRequired, adminOnly } = require('../middleware/auth');

// GET /api/shifts
router.get('/', authRequired, (req, res) => {
  const shifts = db.prepare('SELECT * FROM shifts ORDER BY start_time ASC').all();
  res.json({ success: true, shifts });
});

// POST /api/shifts (Tambah shift)
router.post('/', authRequired, adminOnly, (req, res) => {
  const { name, start_time, end_time, tolerance_minutes, icon } = req.body;

  if (!name || !start_time || !end_time) {
    return res.status(400).json({ success: false, message: 'Nama shift, jam masuk, dan jam pulang wajib diisi.' });
  }

  const stmt = db.prepare(`
    INSERT INTO shifts (name, start_time, end_time, tolerance_minutes, icon)
    VALUES (?, ?, ?, ?, ?)
  `);

  const info = stmt.run(
    name.trim(),
    start_time.trim(),
    end_time.trim(),
    parseInt(tolerance_minutes || '10', 10),
    icon || 'sun'
  );

  res.json({ success: true, message: 'Shift berhasil ditambahkan.', shiftId: info.lastInsertRowid });
});

// PUT /api/shifts/:id (Edit shift)
router.put('/:id', authRequired, adminOnly, (req, res) => {
  const { name, start_time, end_time, tolerance_minutes, icon } = req.body;
  const shiftId = req.params.id;

  const existing = db.prepare('SELECT id FROM shifts WHERE id = ?').get(shiftId);
  if (!existing) {
    return res.status(404).json({ success: false, message: 'Shift tidak ditemukan.' });
  }

  db.prepare(`
    UPDATE shifts SET 
      name = ?, start_time = ?, end_time = ?, 
      tolerance_minutes = ?, icon = ?
    WHERE id = ?
  `).run(
    name.trim(),
    start_time.trim(),
    end_time.trim(),
    parseInt(tolerance_minutes || '10', 10),
    icon || 'sun',
    shiftId
  );

  res.json({ success: true, message: 'Shift berhasil diperbarui.' });
});

// DELETE /api/shifts/:id (Hapus shift)
router.delete('/:id', authRequired, adminOnly, (req, res) => {
  const shiftId = req.params.id;
  const inUse = db.prepare('SELECT COUNT(*) as count FROM users WHERE shift_id = ?').get(shiftId).count;

  if (inUse > 0) {
    return res.status(400).json({ success: false, message: `Shift masih digunakan oleh ${inUse} karyawan.` });
  }

  db.prepare('DELETE FROM shifts WHERE id = ?').run(shiftId);
  res.json({ success: true, message: 'Shift berhasil dihapus.' });
});

module.exports = router;
