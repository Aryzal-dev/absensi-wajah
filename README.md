# Absensi Karyawan — Full-Stack Node.js & PWA

Aplikasi Absensi Karyawan modern berbasis **Node.js, SQLite, dan PWA (Progressive Web App)** yang dirancang agar karyawan dapat melakukan presensi langsung dari HP masing-masing dengan validasi **GPS Geofencing** dan **Foto Selfie Kamera Live**, serta dashboard terpusat untuk Admin/HR.

---

## Fitur Utama

### 📱 Sisi Karyawan (Mobile PWA)
- **Check-in / Check-out Intuitif:** Tombol bundar besar interaktif, jam digital *live*, dan informasi shift.
- **Validasi GPS Anti-Curang:** Menghitung jarak ke titik koordinat kantor dan menolak absensi jika di luar radius yang ditentukan.
- **Selfie Kamera Depan (Live):** Mengambil foto langsung dari kamera HP dengan kompresi otomatis di browser (~20 KB) agar hemat kuota.
- **Jam Server:** Waktu absensi mengacu pada jam server, mencegah karyawan memanipulasi waktu di HP mereka.
- **Riwayat Kehadiran:** Menampilkan riwayat jam masuk, jam pulang, dan status keterlambatan per bulan.
- **Pengajuan Izin / Sakit / Cuti:** Form pengajuan online lengkap dengan unggah bukti / surat dokter.

### 💻 Sisi Admin / HR (Dashboard Terpusat)
- **Monitoring Kehadiran Real-Time:** Melihat jumlah karyawan hadir tepat waktu, terlambat, izin, dan yang belum absen hari ini.
- **Verifikasi Bukti Foto:** Admin dapat melihat foto selfie dan jarak GPS karyawan saat absen.
- **Persetujuan Izin (1-Click Approval):** Memeriksa dan menyetujui/menolak izin karyawan secara instan.
- **Rekapitulasi Bulanan & Payroll:** Perhitungan otomatis uang makan (kehadiran), uang lembur, potongan keterlambatan, dan estimasi gaji bersih.
- **Ekspor CSV (Excel):** Unduh laporan lengkap rekapitulasi bulanan dalam 1 klik.
- **Manajemen Karyawan & Shift:** Tambah karyawan baru, atur shift kerja, toleransi keterlambatan, dan jam kerja.
- **Pengaturan Lokasi Kantor:** Set koordinat kantor secara instan dengan tombol *"Gunakan Lokasi Saya Saat Ini"*, atur radius maksimal (meter), dan toggle wajib selfie/GPS.

---

## Cara Menjalankan

1. **Jalankan Server:**
   Buka terminal di folder proyek ini (`d:\Node.js\absensi`), lalu jalankan:
   ```bash
   npm start
   ```
2. **Akses Aplikasi:**
   Buka browser di laptop atau HP (dalam jaringan lokal WiFi yang sama) ke alamat:
   ```
   http://localhost:3000
   ```
   *(Atau ganti `localhost` dengan IP komputer Anda, misal `http://192.168.1.10:3000` untuk diakses dari HP karyawan).*

3. **Pasang di HP (PWA):**
   Buka link web di browser HP (Chrome / Safari), lalu pilih menu browser **"Tambahkan ke Layar Utama" / "Add to Home Screen"**. Aplikasi akan terpasang layaknya aplikasi Android/iOS asli.

---

## Akun Demo untuk Pengujian

Aplikasi sudah dilengkapi data demo awal:

| Peran | NIP / ID | PIN / Password | Keterangan |
| :--- | :--- | :--- | :--- |
| **Admin HR** | `admin` | `admin123` | Akses penuh dashboard, approval izin, rekap gaji, dan pengaturan kantor |
| **Karyawan 1** | `1001` | `1111` | Rina Wulandari (Kasir - Shift Pagi) |
| **Karyawan 2** | `1002` | `2222` | Dimas Pratama (Barista - Shift Pagi) |
| **Karyawan 3** | `1003` | `3333` | Siti Nurhaliza (Admin Gudang - Shift Siang) |

*(Di halaman login juga sudah disediakan tombol **"Akses Cepat Demo"** agar Anda bisa langsung mencoba tanpa perlu mengetik).*

---

## Struktur Berkas Proyek

```
d:\Node.js\absensi\
├── src\
│   ├── config.js              # Konfigurasi port, path DB, JWT secret
│   ├── db.js                  # Inisialisasi SQLite native (node:sqlite) & skema tabel
│   ├── server.js              # Express app & static file routing
│   ├── middleware\
│   │   ├── auth.js            # Middleware verifikasi token JWT & role admin
│   │   └── upload.js          # Pengelola unggahan file & kompresi foto selfie
│   └── routes\
│       ├── auth.js            # Login, autentikasi & profil
│       ├── attendance.js      # Endpoint check-in, check-out, riwayat & status hari ini
│       ├── leaves.js          # Pengajuan izin, sakit, cuti & persetujuan admin
│       ├── employees.js       # CRUD data karyawan
│       ├── shifts.js          # CRUD jam kerja & shift
│       ├── settings.js        # Konfigurasi GPS, radius kantor & tarif tunjangan
│       └── reports.js         # Rekapitulasi bulanan & ekspor CSV Excel
├── public\                    # Tampilan Frontend PWA
│   ├── index.html             # Single Page Application
│   ├── manifest.json          # PWA Manifest (Add to Home Screen)
│   ├── sw.js                  # Service Worker untuk performa offline
│   ├── css\
│   │   └── style.css          # Desain modern, glassmorphism & responsif
│   └── js\
│       ├── app.js             # Logika antarmuka & perutean tab
│       ├── api.js             # HTTP client pembungkus fetch & JWT
│       ├── geo.js             # Penghitung jarak Haversine GPS
│       └── camera.js          # Pengambil gambar selfie kamera live
├── data\                      # File database SQLite (absensi.db)
└── uploads\                   # Folder penyimpanan foto selfie & surat dokter
```
