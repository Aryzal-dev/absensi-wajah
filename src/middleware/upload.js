const multer = require('multer');
const path = require('path');
const fs = require('fs');
const config = require('../config');

// Storage untuk dokumen pengajuan izin/sakit
const docStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(config.UPLOADS_DIR, 'docs');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = `doc_${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`;
    cb(null, name);
  }
});

const uploadDoc = multer({
  storage: docStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // Maksimal 5MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|pdf/;
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.test(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Format berkas harus JPG, PNG, atau PDF.'));
    }
  }
});

// Fungsi simpan base64 image (foto selfie dari WebRTC camera)
function saveBase64Image(dataUri, subfolder = 'selfies') {
  if (!dataUri || !dataUri.startsWith('data:image/')) return null;

  const matches = dataUri.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
  if (!matches || matches.length !== 3) return null;

  const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
  const buffer = Buffer.from(matches[2], 'base64');
  const filename = `selfie_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;
  const targetDir = path.join(config.UPLOADS_DIR, subfolder);

  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

  const filepath = path.join(targetDir, filename);
  fs.writeFileSync(filepath, buffer);

  return `/uploads/${subfolder}/${filename}`;
}

module.exports = { uploadDoc, saveBase64Image };
