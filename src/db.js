const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const config = require('./config');

// Pastikan folder data dan uploads tersedia
const dataDir = path.dirname(config.DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
const selfiesDir = path.join(config.UPLOADS_DIR, 'selfies');
const docsDir = path.join(config.UPLOADS_DIR, 'docs');
if (!fs.existsSync(selfiesDir)) fs.mkdirSync(selfiesDir, { recursive: true });
if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });

const db = new DatabaseSync(config.DB_PATH);

// Aktifkan foreign keys & WAL mode untuk konkurensi optimal
db.exec('PRAGMA foreign_keys = ON;');

// Migrasi tabel
function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS shifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      tolerance_minutes INTEGER DEFAULT 10,
      icon TEXT DEFAULT 'sun'
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nip TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'karyawan',
      password TEXT NOT NULL,
      position TEXT,
      shift_id INTEGER REFERENCES shifts(id) ON DELETE SET NULL,
      phone TEXT,
      avatar TEXT,
      work_days TEXT DEFAULT '[1,2,3,4,5]',
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      check_in_time TEXT,
      check_out_time TEXT,
      check_in_lat REAL,
      check_in_lng REAL,
      check_in_distance REAL,
      check_in_photo TEXT,
      check_out_lat REAL,
      check_out_lng REAL,
      check_out_distance REAL,
      check_out_photo TEXT,
      status TEXT DEFAULT 'hadir',
      late_minutes INTEGER DEFAULT 0,
      overtime_minutes INTEGER DEFAULT 0,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, date)
    );

    CREATE TABLE IF NOT EXISTS leaves (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      reason TEXT NOT NULL,
      attachment TEXT,
      status TEXT DEFAULT 'menunggu',
      reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Migrasi kolom face_descriptor pada tabel users jika belum ada
  try {
    db.exec('ALTER TABLE users ADD COLUMN face_descriptor TEXT;');
  } catch (e) {
    // Kolom sudah ada
  }

  // Seeding pengaturan default jika belum ada
  const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
  const setSetting = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');

  const defaultSettings = {
    office_name: 'CV Maju Bersama',
    office_lat: '-6.9175',
    office_lng: '107.6191',
    office_radius: '150',
    require_selfie: 'true',
    require_location: 'true',
    allowance_meal: '25000',
    allowance_overtime: '20000',
    penalty_late: '10000',
    penalty_absent: '75000',
    min_overtime_minutes: '30'
  };

  for (const [key, val] of Object.entries(defaultSettings)) {
    if (!getSetting.get(key)) {
      setSetting.run(key, val);
    }
  }

  // Seeding shift default jika kosong
  const shiftCount = db.prepare('SELECT COUNT(*) as count FROM shifts').get().count;
  if (shiftCount === 0) {
    const insertShift = db.prepare('INSERT INTO shifts (name, start_time, end_time, tolerance_minutes, icon) VALUES (?, ?, ?, ?, ?)');
    insertShift.run('Pagi', '08:00', '16:00', 10, 'sun');
    insertShift.run('Siang', '13:00', '21:00', 10, 'sunset');
    insertShift.run('Malam', '21:00', '05:00', 15, 'moon');
  }

  // Seeding user Admin & Karyawan contoh jika belum ada
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  if (userCount === 0) {
    const insertUser = db.prepare(`
      INSERT INTO users (nip, name, role, password, position, shift_id, phone, work_days)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Akun admin: NIP 'admin', Password 'admin123'
    const adminPassHash = bcrypt.hashSync('admin123', 10);
    insertUser.run('admin', 'Admin Absensi', 'admin', adminPassHash, 'HR & Operasional', 1, '081234567890', '[1,2,3,4,5,6]');

    // Akun karyawan demo: NIP '1001', Password / PIN '1111'
    const pass1111 = bcrypt.hashSync('1111', 10);
    const pass2222 = bcrypt.hashSync('2222', 10);
    const pass3333 = bcrypt.hashSync('3333', 10);

    insertUser.run('1001', 'Rina Wulandari', 'karyawan', pass1111, 'Kasir', 1, '081211112222', '[1,2,3,4,5,6]');
    insertUser.run('1002', 'Dimas Pratama', 'karyawan', pass2222, 'Barista', 1, '081233334444', '[1,2,3,4,5,6]');
    insertUser.run('1003', 'Siti Nurhaliza', 'karyawan', pass3333, 'Admin Gudang', 2, '081255556666', '[1,2,3,4,5]');
  }
}

initSchema();

module.exports = db;
