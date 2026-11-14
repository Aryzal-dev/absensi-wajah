const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');

function authRequired(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Autentikasi diperlukan. Silakan login terlebih dahulu.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET);
    const user = db.prepare('SELECT id, nip, name, role, position, shift_id, phone, avatar, is_active FROM users WHERE id = ?').get(decoded.id);

    if (!user || !user.is_active) {
      return res.status(403).json({ success: false, message: 'Akun tidak ditemukan atau telah dinonaktifkan.' });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Sesi kedaluwarsa atau token tidak valid.' });
  }
}

function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Akses ditolak. Fitur ini hanya untuk Admin.' });
  }
  next();
}

module.exports = { authRequired, adminOnly };
