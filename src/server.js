const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');
require('./db'); // Pastikan database & skema diinisialisasi

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '15mb' })); // Limit besar untuk foto selfie base64
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Static files
app.use('/uploads', express.static(config.UPLOADS_DIR));
app.use(express.static(config.PUBLIC_DIR));

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/leaves', require('./routes/leaves'));
app.use('/api/employees', require('./routes/employees'));
app.use('/api/shifts', require('./routes/shifts'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/reports', require('./routes/reports'));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', serverTime: new Date().toISOString() });
});

// SPA Fallback: arahkan semua rute non-API ke index.html
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/') && !req.path.startsWith('/uploads/')) {
    return res.sendFile(path.join(config.PUBLIC_DIR, 'index.html'));
  }
  next();
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('[Error Server]:', err.message);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Terjadi kesalahan pada server.'
  });
});

if (require.main === module) {
  app.listen(config.PORT, () => {
    console.log(`===============================================`);
    console.log(` Server Absensi Karyawan berjalan!`);
    console.log(` Port: ${config.PORT}`);
    console.log(` URL : http://localhost:${config.PORT}`);
    console.log(`===============================================`);
  });
}

module.exports = app;
