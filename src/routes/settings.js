const express = require('express');
const router = express.Router();
const db = require('../db');
const { authRequired, adminOnly } = require('../middleware/auth');

// GET /api/settings (Ambil pengaturan kantor)
router.get('/', authRequired, (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const r of rows) settings[r.key] = r.value;

  res.json({ success: true, settings });
});

// PUT /api/settings (Simpan pengaturan kantor - Admin only)
router.put('/', authRequired, adminOnly, (req, res) => {
  const settings = req.body; // { office_name, office_lat, office_lng, office_radius, require_selfie, require_location, ... }

  if (!settings || typeof settings !== 'object') {
    return res.status(400).json({ success: false, message: 'Data pengaturan tidak valid.' });
  }

  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');

  for (const [key, value] of Object.entries(settings)) {
    upsert.run(key, String(value));
  }

  res.json({ success: true, message: 'Pengaturan berhasil disimpan.' });
});

module.exports = router;
