const express = require('express');
const router = express.Router();
const db = require('../db');
const { authRequired, adminOnly } = require('../middleware/auth');
const { uploadDoc } = require('../middleware/upload');
const appEvents = require('../events');

// POST /api/leaves (Pengajuan izin / sakit / cuti oleh karyawan)
router.post('/', authRequired, uploadDoc.single('attachment'), (req, res) => {
  const { type, startDate, endDate, reason } = req.body;

  if (!type || !startDate || !endDate || !reason) {
    return res.status(400).json({ success: false, message: 'Jenis pengajuan, tanggal mulai, tanggal selesai, dan alasan wajib diisi.' });
  }

  if (startDate > endDate) {
    return res.status(400).json({ success: false, message: 'Tanggal mulai tidak boleh lebih besar dari tanggal selesai.' });
  }

  let attachmentPath = null;
  if (req.file) {
    attachmentPath = `/uploads/docs/${req.file.filename}`;
  }

  const stmt = db.prepare(`
    INSERT INTO leaves (user_id, type, start_date, end_date, reason, attachment, status)
    VALUES (?, ?, ?, ?, ?, ?, 'menunggu')
  `);

  stmt.run(req.user.id, type.toLowerCase(), startDate, endDate, reason, attachmentPath);

  // Broadcast notifikasi izin baru ke Admin
  appEvents.emit('leave:submitted', {
    userId: req.user.id,
    userName: req.user.name,
    nip: req.user.nip,
    type,
    startDate,
    endDate,
    reason
  });

  res.json({
    success: true,
    message: 'Pengajuan berhasil dikirim dan sedang menunggu persetujuan Admin.'
  });
});

// GET /api/leaves (Daftar pengajuan: karyawan melihat miliknya, admin melihat semua)
router.get('/', authRequired, (req, res) => {
  const statusFilter = req.query.status; // 'menunggu', 'disetujui', 'ditolak', or undefined

  let query = `
    SELECT l.*, u.name as user_name, u.nip, u.position,
           r.name as reviewer_name
    FROM leaves l
    JOIN users u ON l.user_id = u.id
    LEFT JOIN users r ON l.reviewed_by = r.id
  `;

  const params = [];

  if (req.user.role !== 'admin') {
    query += ' WHERE l.user_id = ?';
    params.push(req.user.id);
    if (statusFilter) {
      query += ' AND l.status = ?';
      params.push(statusFilter);
    }
  } else {
    if (statusFilter) {
      query += ' WHERE l.status = ?';
      params.push(statusFilter);
    }
  }

  query += ' ORDER BY l.created_at DESC';

  const leaves = db.prepare(query).all(...params);
  res.json({ success: true, leaves });
});

// PUT /api/leaves/:id/status (Approval pengajuan oleh Admin)
router.put('/:id/status', authRequired, adminOnly, (req, res) => {
  const { status } = req.body; // 'disetujui' | 'ditolak'
  const leaveId = req.params.id;

  if (!['disetujui', 'ditolak'].includes(status)) {
    return res.status(400).json({ success: false, message: 'Status harus disetujui atau ditolak.' });
  }

  const leave = db.prepare('SELECT * FROM leaves WHERE id = ?').get(leaveId);
  if (!leave) {
    return res.status(404).json({ success: false, message: 'Pengajuan tidak ditemukan.' });
  }

  db.prepare(`
    UPDATE leaves 
    SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(status, req.user.id, leaveId);

  res.json({
    success: true,
    message: `Pengajuan berhasil ${status === 'disetujui' ? 'disetujui' : 'ditolak'}.`
  });
});

module.exports = router;
