const path = require('path');

module.exports = {
  PORT: process.env.PORT || 3000,
  JWT_SECRET: process.env.JWT_SECRET || 'absensi-karyawan-secret-key-2026',
  DB_PATH: path.join(__dirname, '..', 'data', 'absensi.db'),
  UPLOADS_DIR: path.join(__dirname, '..', 'uploads'),
  PUBLIC_DIR: path.join(__dirname, '..', 'public')
};
