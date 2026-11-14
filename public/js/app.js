// Controller Utama Aplikasi Absensi
const App = {
  state: {
    user: null,
    todayData: null,
    currentTab: 'absen',
    clockTimer: null,
    eventSource: null,
    pollingTimer: null,
    pendingAction: null // 'check-in' | 'check-out'
  },

  init() {
    this.bindEvents();
    this.checkSession();
  },

  bindEvents() {
    // Event listener token expired
    window.addEventListener('auth:expired', () => {
      this.showToast('Sesi Anda telah kedaluwarsa. Silakan login kembali.');
      this.render();
    });

    // Form Login
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
      loginForm.addEventListener('submit', (e) => this.handleLogin(e));
    }

    // Tombol Logout
    const btnLogout = document.getElementById('btnLogout');
    if (btnLogout) {
      btnLogout.addEventListener('click', () => this.handleLogout());
    }

    // Tombol Ambil Foto Kamera di Modal
    const btnCapture = document.getElementById('btnCaptureSelfie');
    if (btnCapture) {
      btnCapture.addEventListener('click', () => this.handleCaptureSelfie());
    }

    // Tombol Tutup Kamera
    const btnCloseCamera = document.getElementById('btnCloseCamera');
    if (btnCloseCamera) {
      btnCloseCamera.addEventListener('click', () => {
        Camera.stop();
        document.getElementById('cameraModal').classList.remove('open');
      });
    }

    // Form Pengajuan Izin
    const leaveForm = document.getElementById('formIzin');
    if (leaveForm) {
      leaveForm.addEventListener('submit', (e) => this.handleLeaveSubmit(e));
    }

    // Form Tambah Karyawan
    const empForm = document.getElementById('formTambahKaryawan');
    if (empForm) {
      empForm.addEventListener('submit', (e) => this.handleEmployeeSubmit(e));
    }

    // Form Pengaturan Kantor
    const settingsForm = document.getElementById('formSettings');
    if (settingsForm) {
      settingsForm.addEventListener('submit', (e) => this.handleSettingsSubmit(e));
    }

    // Tombol "Gunakan Lokasi Saya" di Pengaturan
    const btnUseMyLoc = document.getElementById('btnUseCurrentLocation');
    if (btnUseMyLoc) {
      btnUseMyLoc.addEventListener('click', () => this.handleUseCurrentLocation());
    }
  },

  checkSession() {
    const user = API.getUser();
    const token = API.getToken();

    if (token && user) {
      this.state.user = user;
      // Ambil tab default berdasarkan role
      this.state.currentTab = user.role === 'admin' ? 'admin-dashboard' : 'absen';
      if (user.role === 'admin') {
        this.connectRealtimeStream();
      }
    } else {
      this.state.user = null;
    }
    this.render();
  },

  async handleLogin(e) {
    e.preventDefault();
    const nip = document.getElementById('loginNip').value;
    const password = document.getElementById('loginPassword').value;
    const btnSubmit = e.target.querySelector('button[type="submit"]');

    try {
      btnSubmit.disabled = true;
      btnSubmit.textContent = 'Memverifikasi...';

      const res = await API.post('/api/auth/login', { nip, password });
      API.setSession(res.token, res.user);
      this.state.user = res.user;
      this.state.currentTab = res.user.role === 'admin' ? 'admin-dashboard' : 'absen';

      if (res.user.role === 'admin') {
        this.connectRealtimeStream();
      }

      this.showToast(`Selamat datang, ${res.user.name}!`);
      this.render();
    } catch (err) {
      this.showToast(err.message, 'danger');
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.textContent = 'Masuk Sekarang';
    }
  },

  fillDemoLogin(nip, pass) {
    document.getElementById('loginNip').value = nip;
    document.getElementById('loginPassword').value = pass;
    document.getElementById('loginForm').requestSubmit();
  },

  handleLogout() {
    Camera.stop();
    if (this.state.eventSource) {
      this.state.eventSource.close();
      this.state.eventSource = null;
    }
    if (this.state.pollingTimer) {
      clearInterval(this.state.pollingTimer);
      this.state.pollingTimer = null;
    }
    API.clearSession();
    this.state.user = null;
    this.state.todayData = null;
    if (this.state.clockTimer) clearInterval(this.state.clockTimer);
    this.showToast('Anda telah keluar.');
    this.render();
  },

  connectRealtimeStream() {
    if (this.state.eventSource) {
      this.state.eventSource.close();
      this.state.eventSource = null;
    }
    if (this.state.pollingTimer) {
      clearInterval(this.state.pollingTimer);
      this.state.pollingTimer = null;
    }

    if (!this.state.user || this.state.user.role !== 'admin') return;

    const token = API.getToken();
    if (!token) return;

    const updateLiveBadge = (connected) => {
      const badge = document.getElementById('adminLiveIndicator');
      if (badge) {
        badge.style.display = 'inline-flex';
        if (connected) {
          badge.innerHTML = '<span style="color:#10b981;font-size:14px;animation:pulse 2s infinite">●</span> Live Real-Time Aktif';
          badge.className = 'badge badge-hadir';
        } else {
          badge.innerHTML = '<span style="color:#f59e0b;font-size:14px">●</span> Menghubungkan...';
          badge.className = 'badge badge-telat';
        }
      }
    };

    try {
      const es = new EventSource(`/api/attendance/stream?token=${encodeURIComponent(token)}`);

      es.addEventListener('connected', () => {
        updateLiveBadge(true);
      });

      es.addEventListener('attendance_updated', (e) => {
        try {
          const data = JSON.parse(e.data);
          const act = data.action === 'check-out' ? 'Check-out' : 'Check-in';
          const st = data.status === 'telat' ? ` (Terlambat ${data.lateMinutes || 0}m)` : '';
          this.showToast(`⚡ Presensi Terkini: ${data.userName} ${act}${st}!`, 'success');

          // Perbarui dashboard seketika tanpa reload halaman!
          if (this.state.currentTab === 'admin-dashboard') {
            this.loadAdminDashboard();
          }
          if (this.state.currentTab === 'admin-rekap') {
            this.loadAdminReport();
          }
        } catch (err) {
          console.error('Error parse SSE event:', err);
        }
      });

      es.addEventListener('leave_submitted', (e) => {
        try {
          const data = JSON.parse(e.data);
          this.showToast(`📝 Pengajuan Izin Baru: ${data.userName} (${data.type.toUpperCase()})`, 'info');
          if (this.state.currentTab === 'admin-dashboard') {
            this.loadAdminDashboard();
          }
          if (this.state.currentTab === 'admin-izin') {
            this.loadAdminLeaves();
          }
        } catch (err) {
          console.error('Error parse leave event:', err);
        }
      });

      es.onerror = () => {
        updateLiveBadge(false);
      };

      this.state.eventSource = es;
    } catch (err) {
      console.warn('Browser tidak mendukung EventSource:', err);
    }

    // Polling otomatis setiap 10 detik sebagai backup sinkronisasi
    this.state.pollingTimer = setInterval(() => {
      if (this.state.user?.role === 'admin' && this.state.currentTab === 'admin-dashboard') {
        this.loadAdminDashboard();
      }
    }, 10000);
  },

  switchTab(tabId) {
    this.state.currentTab = tabId;
    this.render();
  },

  showToast(msg, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    if (type === 'danger') toast.style.borderLeft = '4px solid var(--danger)';
    if (type === 'success') toast.style.borderLeft = '4px solid var(--success)';
    toast.textContent = msg;

    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  },

  // RENDER UTAMA
  render() {
    const appShell = document.getElementById('appShell');
    const authView = document.getElementById('authView');

    if (!this.state.user) {
      if (appShell) appShell.style.display = 'none';
      if (authView) authView.style.display = 'block';
      return;
    }

    if (authView) authView.style.display = 'none';
    if (appShell) appShell.style.display = 'block';

    // Update Profil Karyawan di Halaman Absen
    const absenAvatar = document.getElementById('absenAvatar');
    const absenName = document.getElementById('absenUserName');
    const absenRole = document.getElementById('absenUserRole');
    const absenNip = document.getElementById('absenUserNip');

    if (absenAvatar) absenAvatar.textContent = this.state.user.name.charAt(0).toUpperCase();
    if (absenName) absenName.textContent = this.state.user.name;
    if (absenRole) absenRole.textContent = this.state.user.position || (this.state.user.role === 'admin' ? 'Admin' : 'Karyawan');
    if (absenNip) absenNip.textContent = `NIP: ${this.state.user.nip}`;

    // Render Navigation
    this.renderNavigation();

    // Sembunyikan semua tab content
    document.querySelectorAll('.tab-view').forEach((el) => (el.style.display = 'none'));

    // Buka tab aktif
    const activeEl = document.getElementById(`view-${this.state.currentTab}`);
    if (activeEl) {
      activeEl.style.display = 'block';
      this.loadTabData(this.state.currentTab);
    }
  },

  renderNavigation() {
    const navBottom = document.getElementById('navBottom');
    if (!navBottom) return;

    const role = this.state.user.role;
    let navItems = [];

    if (role === 'admin') {
      navItems = [
        { id: 'admin-dashboard', label: 'Monitor', icon: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>' },
        { id: 'admin-izin', label: 'Izin', icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 15l2 2 4-4"/>' },
        { id: 'admin-rekap', label: 'Rekap Gaji', icon: '<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>' },
        { id: 'admin-karyawan', label: 'Karyawan', icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>' },
        { id: 'admin-atur', label: 'Pengaturan', icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>' }
      ];
    } else {
      navItems = [
        { id: 'absen', label: 'Absen', icon: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>' },
        { id: 'riwayat', label: 'Riwayat', icon: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>' },
        { id: 'izin', label: 'Izin', icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 15l2 2 4-4"/>' },
        { id: 'profil', label: 'Profil', icon: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>' }
      ];
    }

    navBottom.innerHTML = navItems
      .map(
        (item) => `
        <button class="nav-item ${this.state.currentTab === item.id ? 'active' : ''}" onclick="App.switchTab('${item.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${item.icon}</svg>
          <span>${item.label}</span>
        </button>
      `
      )
      .join('');
  },

  async loadTabData(tabId) {
    if (tabId === 'absen') {
      this.initAbsenTab();
    } else if (tabId === 'riwayat') {
      this.loadHistory();
    } else if (tabId === 'izin') {
      this.loadLeaves();
    } else if (tabId === 'admin-dashboard') {
      this.loadAdminDashboard();
    } else if (tabId === 'admin-izin') {
      this.loadAdminLeaves();
    } else if (tabId === 'admin-rekap') {
      this.loadAdminReport();
    } else if (tabId === 'admin-karyawan') {
      this.loadAdminEmployees();
    } else if (tabId === 'admin-atur') {
      this.loadAdminSettings();
    }
  },

  // ========== TAB 1: ABSEN KARYAWAN ==========
  async initAbsenTab() {
    this.startDigitalClock();

    try {
      const res = await API.get('/api/attendance/today');
      this.state.todayData = res;
      this.updatePunchButtonUI(res);
      this.checkLiveLocationStatus(res.office);
    } catch (err) {
      this.showToast('Gagal memuat status absensi: ' + err.message, 'danger');
    }
  },

  startDigitalClock() {
    if (this.state.clockTimer) clearInterval(this.state.clockTimer);

    const updateClock = () => {
      const clockEl = document.getElementById('liveClock');
      const dateEl = document.getElementById('liveDate');
      if (!clockEl) return;

      const now = new Date();
      const h = String(now.getHours()).padStart(2, '0');
      const m = String(now.getMinutes()).padStart(2, '0');
      const s = String(now.getSeconds()).padStart(2, '0');
      clockEl.innerHTML = `${h}:${m}<small style="font-size:24px;color:var(--text-dim)">:${s}</small>`;

      if (dateEl) {
        const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
        dateEl.textContent = now.toLocaleDateString('id-ID', options);
      }
    };

    updateClock();
    this.state.clockTimer = setInterval(updateClock, 1000);
  },

  updatePunchButtonUI(data) {
    const btn = document.getElementById('btnPunch');
    if (!btn) return;

    btn.style.pointerEvents = 'auto';

    // Pastikan struktur anak tombol selalu lengkap
    if (!document.getElementById('punchLabel') || !document.getElementById('punchSub')) {
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 11v4M7.5 8.5A6 6 0 0 1 18 12v2a14 14 0 0 1-1 5M6 12a6 6 0 0 1 .3-1.9M9 21a12 12 0 0 0 1-5v-4a2 2 0 0 1 4 0v1M14.5 21c.3-1 .5-2 .5-3M12 3a9 9 0 0 1 9 9v1M3 12a9 9 0 0 1 3-6.7"/></svg><b id="punchLabel"></b><small id="punchSub"></small>`;
    }

    const label = document.getElementById('punchLabel');
    const sub = document.getElementById('punchSub');
    const shiftChip = document.getElementById('shiftChipText');
    const statMasuk = document.getElementById('statMasuk');
    const statPulang = document.getElementById('statPulang');
    const statDurasi = document.getElementById('statDurasi');

    if (shiftChip) {
      if (data.user && data.user.shift_name) {
        shiftChip.textContent = `Shift ${data.user.shift_name} (${data.user.start_time} - ${data.user.end_time})`;
      } else {
        shiftChip.textContent = 'Shift Reguler (08:00 - 16:00)';
      }
    }

    const att = data.attendance;
    btn.className = 'btn-punch';

    if (data.leave) {
      btn.classList.add('done');
      if (label) label.textContent = data.leave.type.toUpperCase();
      if (sub) sub.textContent = 'Izin disetujui';
      return;
    }

    if (!att || !att.check_in_time) {
      // Belum Check-in
      btn.className = 'btn-punch';
      if (label) label.textContent = 'CHECK-IN';
      if (sub) sub.textContent = 'Tekan untuk masuk';
      if (statMasuk) statMasuk.textContent = '--:--';
      if (statPulang) statPulang.textContent = '--:--';
      if (statDurasi) statDurasi.textContent = '0j 0m';
      btn.onclick = () => this.initiatePunch('check-in');
    } else if (att.check_in_time && !att.check_out_time) {
      // Sedang Bekerja, siap Check-out
      btn.className = 'btn-punch checkout';
      if (label) label.textContent = 'CHECK-OUT';
      if (sub) sub.textContent = 'Tekan untuk pulang';

      const inDate = new Date(att.check_in_time);
      if (statMasuk) statMasuk.textContent = `${String(inDate.getHours()).padStart(2, '0')}:${String(inDate.getMinutes()).padStart(2, '0')}`;
      if (statPulang) statPulang.textContent = '--:--';

      // Hitung durasi saat ini
      const diffMins = Math.max(0, Math.floor((new Date() - inDate) / 60000));
      if (statDurasi) statDurasi.textContent = `${Math.floor(diffMins / 60)}j ${diffMins % 60}m`;

      btn.onclick = () => this.initiatePunch('check-out');
    } else {
      // Selesai Check-in dan Check-out
      btn.className = 'btn-punch done';
      if (label) label.textContent = 'SELESAI';
      if (sub) sub.textContent = 'Absensi hari ini tuntas';
      btn.style.pointerEvents = 'none';

      const inDate = new Date(att.check_in_time);
      const outDate = new Date(att.check_out_time);
      if (statMasuk) statMasuk.textContent = `${String(inDate.getHours()).padStart(2, '0')}:${String(inDate.getMinutes()).padStart(2, '0')}`;
      if (statPulang) statPulang.textContent = `${String(outDate.getHours()).padStart(2, '0')}:${String(outDate.getMinutes()).padStart(2, '0')}`;

      const totalMins = Math.max(0, Math.floor((outDate - inDate) / 60000));
      if (statDurasi) statDurasi.textContent = `${Math.floor(totalMins / 60)}j ${totalMins % 60}m`;
      btn.onclick = null;
    }
  },

  async checkLiveLocationStatus(office) {
    const locStatusEl = document.getElementById('locStatusTag');
    if (!locStatusEl) return;

    locStatusEl.innerHTML = '<span style="color:var(--text-dim)">Mendeteksi lokasi GPS...</span>';

    try {
      const pos = await GEO.getCurrentPosition();
      this.state.lastPosition = { lat: pos.lat, lng: pos.lng };
      const dist = GEO.calculateDistance(pos.lat, pos.lng, office.lat, office.lng);

      if (dist <= office.radius) {
        locStatusEl.innerHTML = `<span style="color:var(--success)">● Di dalam area kantor (${dist}m)</span>`;
      } else {
        locStatusEl.innerHTML = `<span style="color:var(--danger)">● Di luar area kantor (${dist}m - maks ${office.radius}m)</span>`;
      }
    } catch (err) {
      locStatusEl.innerHTML = `<span style="color:var(--warning)">● GPS tidak aktif: ${err.message}</span>`;
    }
  },

  async initiatePunch(action) {
    this.state.pendingAction = action;
    const office = this.state.todayData.office;

    // Jika membutuhkan selfie, buka modal kamera terlebih dahulu
    if (office.requireSelfie) {
      const modal = document.getElementById('cameraModal');
      const video = document.getElementById('cameraVideo');
      const btnCapture = document.getElementById('btnCaptureSelfie');
      const faceBadge = document.getElementById('faceStatusBadge');
      const faceOval = document.getElementById('faceOval');

      // Reset state tombol & badge
      btnCapture.disabled = true;
      btnCapture.style.opacity = '0.5';
      btnCapture.innerHTML = '📸 Ambil Foto &amp; Kirim Absen';
      faceBadge.innerHTML = '<span style="color:var(--danger)">❌ Arahkan kamera ke wajah Anda</span>';
      if (faceOval) faceOval.classList.remove('detected');

      modal.classList.add('open');

      try {
        await Camera.start(video, (hasFace, details) => {
          if (hasFace) {
            btnCapture.disabled = false;
            btnCapture.style.opacity = '1';
            faceBadge.innerHTML = '<span style="color:var(--success)">✅ Wajah Asli Terdeteksi (Siap Absen)</span>';
            if (faceOval) faceOval.classList.add('detected');
          } else {
            btnCapture.disabled = true;
            btnCapture.style.opacity = '0.5';
            const reason = details && details.reason ? `<br><small style="font-size:11px;color:var(--text-dim)">${details.reason}</small>` : '';
            faceBadge.innerHTML = `<span style="color:var(--danger)">❌ Wajah Belum Terdeteksi</span>${reason}`;
            if (faceOval) faceOval.classList.remove('detected');
          }
        });
      } catch (err) {
        modal.classList.remove('open');
        this.showToast(err.message, 'danger');
      }
    } else {
      // Tanpa selfie, langsung ambil lokasi dan submit
      this.executePunch(null, false);
    }
  },

  async handleCaptureSelfie() {
    const video = document.getElementById('cameraVideo');
    const btnCapture = document.getElementById('btnCaptureSelfie');

    try {
      btnCapture.disabled = true;
      btnCapture.innerHTML = '<b>Memverifikasi biometrik wajah...</b>';

      // Validasi ketat pada frame foto & ekstraksi descriptor 128-d
      const result = await Camera.captureAndValidateFace(video);

      Camera.stop();
      document.getElementById('cameraModal').classList.remove('open');

      this.executePunch(result.photoBase64, true, result.liveDescriptor);
    } catch (err) {
      btnCapture.disabled = false;
      btnCapture.innerHTML = '📸 Ambil Foto &amp; Kirim Absen';
      this.showToast(err.message, 'danger');
    }
  },

  async executePunch(photoBase64, faceDetected = false, liveDescriptor = null) {
    const action = this.state.pendingAction;
    const btn = document.getElementById('btnPunch');
    const label = document.getElementById('punchLabel');
    const sub = document.getElementById('punchSub');

    if (label) label.textContent = 'Memproses...';
    if (sub) sub.textContent = 'Mohon tunggu...';
    if (btn) btn.style.pointerEvents = 'none';

    try {
      let lat = this.state.lastPosition?.lat || null;
      let lng = this.state.lastPosition?.lng || null;

      // Jika belum memiliki koordinat tersimpan, ambil GPS dengan timeout cepat
      if (lat == null || lng == null) {
        try {
          const pos = await GEO.getCurrentPosition(3500);
          lat = pos.lat;
          lng = pos.lng;
          this.state.lastPosition = { lat, lng };
        } catch (geoErr) {
          if (this.state.todayData?.office?.requireLocation) {
            throw geoErr;
          }
        }
      }

      const endpoint = action === 'check-in' ? '/api/attendance/check-in' : '/api/attendance/check-out';
      const res = await API.post(endpoint, { lat, lng, photoBase64, faceDetected, liveDescriptor });

      this.showToast(res.message, 'success');
      await this.initAbsenTab(); // Refresh tampilan absensi
    } catch (err) {
      console.error('Punch execution error:', err);
      this.showToast(err.message || 'Terjadi kesalahan sistem saat absensi.', 'danger');
      if (label) label.textContent = action === 'check-in' ? 'CHECK-IN' : 'CHECK-OUT';
      if (sub) sub.textContent = action === 'check-in' ? 'Tekan untuk masuk' : 'Tekan untuk pulang';
    } finally {
      if (btn) btn.style.pointerEvents = 'auto';
    }
  },

  // ========== TAB 2: RIWAYAT KARYAWAN ==========
  async loadHistory() {
    const container = document.getElementById('historyList');
    if (!container) return;

    const monthEl = document.getElementById('userHistoryMonth');
    const yearEl = document.getElementById('userHistoryYear');

    const now = new Date();
    if (monthEl && !monthEl.dataset.userChanged) {
      monthEl.value = String(now.getMonth() + 1);
    }
    if (yearEl && !yearEl.dataset.userChanged) {
      yearEl.value = String(now.getFullYear());
    }

    const month = monthEl ? monthEl.value : now.getMonth() + 1;
    const year = yearEl ? yearEl.value : now.getFullYear();

    container.innerHTML = '<p style="text-align:center;color:var(--text-dim);padding:20px 0">Memuat rekapan riwayat...</p>';

    try {
      const res = await API.get(`/api/reports/employee/${this.state.user.id}?year=${year}&month=${month}`);
      
      // Update Summary Cards
      const summaryBox = document.getElementById('userHistorySummary');
      if (summaryBox) {
        summaryBox.style.display = 'grid';
        document.getElementById('statUserHadir').textContent = `${res.summary.hadir} Hari`;
        document.getElementById('statUserTelat').textContent = `${res.summary.telat} Hari (${res.summary.totalMenitTelat}m)`;
        document.getElementById('statUserLembur').textContent = `${res.summary.totalMenitLembur} Menit`;
        document.getElementById('statUserIzin').textContent = `${res.summary.totalIzinDays} Hari`;
      }

      if (res.logs.length === 0) {
        container.innerHTML = '<p style="text-align:center;color:var(--text-dim);padding:24px 0">Belum ada riwayat absensi pada bulan yang dipilih.</p>';
        return;
      }

      container.innerHTML = res.logs
        .map((log) => {
          const date = new Date(log.date);
          const dateFormatted = date.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
          const badgeClass = log.status === 'telat' ? 'badge-telat' : 'badge-hadir';

          const inPhotoHtml = log.in_photo ? `<img class="table-selfie-thumb" src="${log.in_photo}" onclick="App.previewPhoto('${log.in_photo}')" title="Lihat Foto Masuk">` : '';
          const outPhotoHtml = log.out_photo ? `<img class="table-selfie-thumb" src="${log.out_photo}" onclick="App.previewPhoto('${log.out_photo}')" title="Lihat Foto Pulang">` : '';

          return `
          <div class="card" style="margin-bottom:12px;padding:16px;border-left:4px solid ${log.status === 'telat' ? 'var(--warning)' : 'var(--success)'}">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
              <div>
                <b>${dateFormatted}</b>
                <small style="display:block;color:var(--text-muted);font-size:12px">${log.shift_name || 'Shift Reguler'}</small>
              </div>
              <span class="badge ${badgeClass}">${log.status_label}</span>
            </div>
            
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px;background:var(--bg-card-inner);padding:10px;border-radius:var(--radius-sm)">
              <div>
                <small style="color:var(--text-muted);display:block">Jam Masuk</small>
                <div style="display:flex;align-items:center;gap:6px;margin-top:2px">
                  ${inPhotoHtml}
                  <b style="color:var(--text-main);font-size:14px">${log.in_time || '--:--'}</b>
                </div>
              </div>
              <div>
                <small style="color:var(--text-muted);display:block">Jam Pulang</small>
                <div style="display:flex;align-items:center;gap:6px;margin-top:2px">
                  ${outPhotoHtml}
                  <b style="color:var(--text-main);font-size:14px">${log.out_time || '--:--'}</b>
                </div>
              </div>
            </div>

            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;font-size:12px;color:var(--text-muted)">
              <span>Durasi: <b style="color:var(--text-main)">${log.duration_text}</b></span>
              <span>Lembur: <b style="color:var(--accent)">${log.overtime_minutes}m</b></span>
              <span>GPS: <b style="color:var(--text-main)">${log.distance != null ? log.distance + 'm' : '-'}</b></span>
            </div>
          </div>
        `;
        })
        .join('');
    } catch (err) {
      container.innerHTML = `<p style="color:var(--danger)">Gagal memuat: ${err.message}</p>`;
    }
  },

  // ========== TAB 3: IZIN / SAKIT / CUTI ==========
  async handleLeaveSubmit(e) {
    e.preventDefault();
    const type = document.getElementById('leaveType').value;
    const startDate = document.getElementById('leaveStart').value;
    const endDate = document.getElementById('leaveEnd').value;
    const reason = document.getElementById('leaveReason').value;
    const fileInput = document.getElementById('leaveAttachment');

    const formData = new FormData();
    formData.append('type', type);
    formData.append('startDate', startDate);
    formData.append('endDate', endDate);
    formData.append('reason', reason);
    if (fileInput.files[0]) {
      formData.append('attachment', fileInput.files[0]);
    }

    try {
      await API.post('/api/leaves', formData);
      this.showToast('Pengajuan izin berhasil dikirim!', 'success');
      e.target.reset();
      this.loadLeaves();
    } catch (err) {
      this.showToast(err.message, 'danger');
    }
  },

  async loadLeaves() {
    const listEl = document.getElementById('myLeavesList');
    if (!listEl) return;

    listEl.innerHTML = '<p style="text-align:center;color:var(--text-dim)">Memuat pengajuan...</p>';

    try {
      const res = await API.get('/api/leaves');
      if (res.leaves.length === 0) {
        listEl.innerHTML = '<p style="text-align:center;color:var(--text-dim);padding:16px">Belum ada pengajuan izin.</p>';
        return;
      }

      listEl.innerHTML = res.leaves
        .map((lv) => {
          let badgeClass = 'badge-belum';
          if (lv.status === 'disetujui') badgeClass = 'badge-hadir';
          if (lv.status === 'ditolak') badgeClass = 'badge-alpa';

          return `
          <div class="card" style="margin-bottom:10px;padding:14px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
              <b style="text-transform:capitalize">${lv.type}</b>
              <span class="badge ${badgeClass}">${lv.status}</span>
            </div>
            <p style="font-size:13px;color:var(--text-muted);margin-bottom:4px">
              Periode: <b>${lv.start_date}</b> s/d <b>${lv.end_date}</b>
            </p>
            <p style="font-size:13px">${lv.reason}</p>
            ${this.renderAttachmentHtml(lv.attachment, `Lampiran: ${lv.type}`)}
          </div>
        `;
        })
        .join('');
    } catch (err) {
      listEl.innerHTML = `<p style="color:var(--danger)">Gagal memuat: ${err.message}</p>`;
    }
  },

  renderAttachmentHtml(attachment, title = 'Lampiran Bukti') {
    if (!attachment) return '';

    const isPdf = attachment.toLowerCase().endsWith('.pdf');
    if (isPdf) {
      return `
        <div style="margin-top:10px;padding:8px 12px;background:var(--bg-card-inner);border:1px solid var(--bg-card-border);border-radius:var(--radius-sm);display:flex;align-items:center;justify-content:space-between;gap:10px">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:20px">📄</span>
            <div>
              <b style="font-size:13px;display:block">Dokumen Lampiran (PDF)</b>
              <small style="color:var(--text-muted)">Surat dokter / dokumen bukti izin</small>
            </div>
          </div>
          <a href="${attachment}" target="_blank" class="btn btn-primary" style="padding:5px 12px;font-size:12px;text-decoration:none">
            📄 Buka PDF
          </a>
        </div>
      `;
    }

    return `
      <div style="margin-top:10px;padding:8px 12px;background:var(--bg-card-inner);border:1px solid var(--bg-card-border);border-radius:var(--radius-sm);display:flex;align-items:center;justify-content:space-between;gap:10px">
        <div style="display:flex;align-items:center;gap:10px">
          <img src="${attachment}" style="width:48px;height:48px;object-fit:cover;border-radius:6px;border:1px solid var(--bg-card-border);cursor:pointer" onclick="App.previewPhoto('${attachment}', '${title}')" title="Klik untuk perbesar">
          <div>
            <b style="font-size:13px;display:block">Foto Surat Dokter / Bukti Lampiran</b>
            <small style="color:var(--text-muted)">Klik gambar untuk memperbesar</small>
          </div>
        </div>
        <button class="btn btn-primary" style="padding:5px 12px;font-size:12px" onclick="App.previewPhoto('${attachment}', '${title}')">
          🔍 Lihat Foto
        </button>
      </div>
    `;
  },

  // ========== ADMIN: DASHBOARD MONITOR ==========
  async loadAdminDashboard() {
    try {
      const res = await API.get('/api/attendance/admin/today');
      const sum = res.summary;

      document.getElementById('kpiTotal').textContent = sum.totalKaryawan;
      document.getElementById('kpiHadir').textContent = sum.hadir;
      document.getElementById('kpiTelat').textContent = sum.telat;
      document.getElementById('kpiIzin').textContent = sum.izin;
      document.getElementById('kpiBelum').textContent = sum.belumHadir;

      const listEl = document.getElementById('adminTodayAttendanceList');
      if (listEl) {
        listEl.innerHTML = res.employees
          .map((emp) => {
            let statusBadge = '<span class="badge badge-belum">Belum Hadir</span>';
            if (emp.status_today === 'izin') statusBadge = '<span class="badge badge-izin">Izin / Cuti</span>';
            if (emp.status_today === 'telat') statusBadge = `<span class="badge badge-telat">Telat ${emp.late_minutes}m</span>`;
            if (emp.status_today === 'hadir') statusBadge = '<span class="badge badge-hadir">Hadir</span>';

            const inTime = emp.check_in_time ? new Date(emp.check_in_time).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-';
            const outTime = emp.check_out_time ? new Date(emp.check_out_time).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-';

            const selfieThumbnail = emp.check_in_photo
              ? `<img src="${emp.check_in_photo}" style="width:36px;height:36px;border-radius:6px;object-fit:cover;cursor:pointer" onclick="App.previewPhoto('${emp.check_in_photo}')">`
              : `<div style="width:36px;height:36px;border-radius:6px;background:var(--bg-input);display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--text-dim)">No Pic</div>`;

            return `
            <tr>
              <td>
                <div style="display:flex;align-items:center;gap:10px">
                  ${selfieThumbnail}
                  <div>
                    <b>${emp.name}</b>
                    <small style="display:block;color:var(--text-muted)">${emp.position || '-'} (${emp.nip})</small>
                  </div>
                </div>
              </td>
              <td>${statusBadge}</td>
              <td><b>${inTime}</b> / ${outTime}</td>
              <td>${emp.check_in_distance != null ? emp.check_in_distance + 'm' : '-'}</td>
            </tr>
          `;
          })
          .join('');
      }
    } catch (err) {
      this.showToast('Gagal memuat dashboard: ' + err.message, 'danger');
    }
  },

  previewPhoto(url, title = 'Bukti Foto / Lampiran') {
    const modal = document.getElementById('previewModal');
    const img = document.getElementById('previewImage');
    const titleEl = document.getElementById('previewModalTitle');
    const linkEl = document.getElementById('previewDownloadLink');

    if (titleEl) titleEl.textContent = title;
    if (img) img.src = url;
    if (linkEl) linkEl.href = url;
    if (modal) modal.classList.add('open');
  },

  // ========== ADMIN: APPROVAL IZIN ==========
  async loadAdminLeaves() {
    const container = document.getElementById('adminLeavesList');
    if (!container) return;

    try {
      const res = await API.get('/api/leaves');
      if (res.leaves.length === 0) {
        container.innerHTML = '<p style="text-align:center;color:var(--text-dim);padding:24px 0">Tidak ada pengajuan izin.</p>';
        return;
      }

      container.innerHTML = res.leaves
        .map((lv) => {
          const isPending = lv.status === 'menunggu';
          const actions = isPending
            ? `
            <div style="display:flex;gap:8px;margin-top:12px">
              <button class="btn btn-success" style="padding:6px 14px;font-size:12px" onclick="App.reviewLeave(${lv.id}, 'disetujui')">Setujui</button>
              <button class="btn btn-danger" style="padding:6px 14px;font-size:12px" onclick="App.reviewLeave(${lv.id}, 'ditolak')">Tolak</button>
            </div>
          `
            : `<small style="color:var(--text-dim);display:block;margin-top:10px">Diperiksa oleh: ${lv.reviewer_name || 'Admin'} (${lv.status})</small>`;

          const attachmentHtml = this.renderAttachmentHtml(lv.attachment, `Lampiran: ${lv.user_name} (${lv.type})`);

          return `
          <div class="card" style="margin-bottom:12px">
            <div style="display:flex;justify-content:space-between;align-items:flex-start">
              <div style="flex:1">
                <b>${lv.user_name}</b> <small style="color:var(--text-muted)">(${lv.nip})</small>
                <div style="font-size:13px;color:var(--accent);margin:4px 0;text-transform:capitalize"><b>${lv.type}</b>: ${lv.start_date} s/d ${lv.end_date}</div>
                <p style="font-size:13px">${lv.reason}</p>
                ${attachmentHtml}
              </div>
              <span class="badge ${lv.status === 'disetujui' ? 'badge-hadir' : lv.status === 'ditolak' ? 'badge-alpa' : 'badge-belum'}">${lv.status}</span>
            </div>
            ${actions}
          </div>
        `;
        })
        .join('');
    } catch (err) {
      container.innerHTML = `<p style="color:var(--danger)">Gagal memuat: ${err.message}</p>`;
    }
  },

  async reviewLeave(leaveId, status) {
    try {
      await API.put(`/api/leaves/${leaveId}/status`, { status });
      this.showToast(`Pengajuan berhasil ${status}.`, 'success');
      this.loadAdminLeaves();
    } catch (err) {
      this.showToast(err.message, 'danger');
    }
  },

  // ========== ADMIN: REKAP BULANAN & PAYROLL ==========
  async loadAdminReport() {
    const monthEl = document.getElementById('adminRekapMonth');
    const yearEl = document.getElementById('adminRekapYear');
    const empSelect = document.getElementById('adminRekapEmployeeSelect');

    const now = new Date();
    if (monthEl && !monthEl.dataset.userChanged) {
      monthEl.value = String(now.getMonth() + 1);
    }
    if (yearEl && !yearEl.dataset.userChanged) {
      yearEl.value = String(now.getFullYear());
    }

    // Muat daftar opsi karyawan jika baru pertama kali
    if (empSelect && empSelect.options.length <= 1) {
      try {
        const empRes = await API.get('/api/employees');
        empRes.employees.forEach((emp) => {
          const opt = document.createElement('option');
          opt.value = emp.id;
          opt.textContent = `👤 ${emp.name} (${emp.nip} - ${emp.position || 'Karyawan'})`;
          opt.style.color = '#f8fafc';
          opt.style.backgroundColor = '#161f30';
          empSelect.appendChild(opt);
        });
      } catch (e) {
        console.warn('Gagal memuat list karyawan untuk filter rekap:', e);
      }
    }

    this.handleRekapFilterChange();
  },

  async handleRekapFilterChange() {
    const monthEl = document.getElementById('adminRekapMonth');
    const yearEl = document.getElementById('adminRekapYear');
    const empSelect = document.getElementById('adminRekapEmployeeSelect');

    if (monthEl) monthEl.dataset.userChanged = 'true';
    if (yearEl) yearEl.dataset.userChanged = 'true';

    const month = monthEl ? monthEl.value : (new Date().getMonth() + 1);
    const year = yearEl ? yearEl.value : new Date().getFullYear();
    const selectedEmp = empSelect ? empSelect.value : 'all';

    const allContainer = document.getElementById('rekapAllContainer');
    const detailContainer = document.getElementById('rekapDetailContainer');

    if (selectedEmp === 'all') {
      if (allContainer) allContainer.style.display = 'block';
      if (detailContainer) detailContainer.style.display = 'none';
      this.loadAllEmployeesReport(year, month);
    } else {
      if (allContainer) allContainer.style.display = 'none';
      if (detailContainer) detailContainer.style.display = 'block';
      this.loadEmployeeDetailRekap(selectedEmp, year, month);
    }
  },

  async loadAllEmployeesReport(year, month) {
    const tableBody = document.getElementById('reportTableBody');
    if (!tableBody) return;

    tableBody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-dim);padding:24px">Memuat data rekap bulanan...</td></tr>';

    try {
      const res = await API.get(`/api/reports/monthly?year=${year}&month=${month}`);
      if (res.report.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-dim);padding:24px">Tidak ada data karyawan aktif.</td></tr>';
        return;
      }

      tableBody.innerHTML = res.report
        .map(
          (r) => `
        <tr>
          <td><b>${r.name}</b><small style="display:block;color:var(--text-muted)">${r.nip} • ${r.position || '-'}</small></td>
          <td><b>${r.hadir}</b> hr</td>
          <td><span style="color:${r.telat > 0 ? 'var(--warning)' : 'inherit'}">${r.telat} hr (${r.totalMenitTelat}m)</span></td>
          <td>${r.totalIzin} hr</td>
          <td>Rp${r.totalTunjangan.toLocaleString('id-ID')}</td>
          <td><span style="color:var(--danger)">-Rp${r.totalPotongan.toLocaleString('id-ID')}</span></td>
          <td><b style="color:var(--success)">Rp${r.estimasiBersih.toLocaleString('id-ID')}</b></td>
          <td>
            <button class="btn btn-primary" style="padding:4px 10px;font-size:12px;white-space:nowrap" onclick="App.viewEmployeeRekap(${r.userId})">
              🔍 Rincian
            </button>
          </td>
        </tr>
      `
        )
        .join('');
    } catch (err) {
      tableBody.innerHTML = `<tr><td colspan="8" style="color:var(--danger);text-align:center;padding:16px">Gagal memuat rekap: ${err.message}</td></tr>`;
    }
  },

  async loadEmployeeDetailRekap(employeeId, year, month) {
    const tableBody = document.getElementById('rekapDetailTableBody');
    if (!tableBody) return;

    tableBody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-dim);padding:24px">Memuat rekapan harian karyawan...</td></tr>';

    try {
      const res = await API.get(`/api/reports/employee/${employeeId}?year=${year}&month=${month}`);

      // Set Info Karyawan
      const nameEl = document.getElementById('rekapDetailName');
      const metaEl = document.getElementById('rekapDetailMeta');
      if (nameEl) nameEl.textContent = res.user.name;
      if (metaEl) {
        const monthNames = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
        metaEl.textContent = `NIP: ${res.user.nip} • Jabatan: ${res.user.position || '-'} • Shift: ${res.user.shift_name || 'Reguler'} • Periode: ${monthNames[parseInt(month, 10)]} ${year}`;
      }

      // Set Statistik
      document.getElementById('rdStatHadir').textContent = `${res.summary.hadir} Hari`;
      document.getElementById('rdStatTelat').textContent = `${res.summary.telat} Hari`;
      document.getElementById('rdStatMenitTelat').textContent = `${res.summary.totalMenitTelat} Menit`;
      document.getElementById('rdStatLembur').textContent = `${res.summary.totalMenitLembur} Menit`;
      document.getElementById('rdStatIzin').textContent = `${res.summary.totalIzinDays} Hari`;
      document.getElementById('rdStatJamKerja').textContent = `${res.summary.totalJamKerja} Jam`;

      if (res.logs.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-dim);padding:24px">Belum ada riwayat absensi pada bulan ini.</td></tr>';
        return;
      }

      tableBody.innerHTML = res.logs
        .map((log) => {
          const date = new Date(log.date);
          const dateFormatted = date.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' });
          const badgeClass = log.status === 'telat' ? 'badge-telat' : 'badge-hadir';

          const inPhotoHtml = log.in_photo
            ? `<img class="table-selfie-thumb" src="${log.in_photo}" onclick="App.previewPhoto('${log.in_photo}')" title="Klik foto masuk">`
            : '-';
          const outPhotoHtml = log.out_photo
            ? `<img class="table-selfie-thumb" src="${log.out_photo}" onclick="App.previewPhoto('${log.out_photo}')" title="Klik foto pulang">`
            : '-';

          return `
          <tr>
            <td><b>${dateFormatted}</b><small style="display:block;color:var(--text-muted)">${log.date}</small></td>
            <td><small>${log.shift_name || '-'}</small></td>
            <td>
              <div style="display:flex;align-items:center;gap:6px">
                ${inPhotoHtml}
                <b>${log.in_time || '--:--'}</b>
              </div>
            </td>
            <td><span class="badge ${badgeClass}">${log.status_label}</span></td>
            <td>
              <div style="display:flex;align-items:center;gap:6px">
                ${outPhotoHtml}
                <b>${log.out_time || '--:--'}</b>
              </div>
            </td>
            <td><b>${log.duration_text}</b></td>
            <td><span style="color:${log.overtime_minutes > 0 ? 'var(--accent)' : 'inherit'}">${log.overtime_minutes}m</span></td>
            <td><small>${log.distance != null ? log.distance + 'm' : '-'}</small></td>
          </tr>
        `;
        })
        .join('');
    } catch (err) {
      tableBody.innerHTML = `<tr><td colspan="8" style="color:var(--danger);text-align:center;padding:16px">Gagal memuat detail rekap: ${err.message}</td></tr>`;
    }
  },

  viewEmployeeRekap(userId) {
    const empSelect = document.getElementById('adminRekapEmployeeSelect');
    if (empSelect) {
      empSelect.value = String(userId);
      this.handleRekapFilterChange();
    }
  },

  showAllRekapView() {
    const empSelect = document.getElementById('adminRekapEmployeeSelect');
    if (empSelect) {
      empSelect.value = 'all';
      this.handleRekapFilterChange();
    }
  },

  exportReportCSV() {
    const monthEl = document.getElementById('adminRekapMonth');
    const yearEl = document.getElementById('adminRekapYear');
    const m = monthEl ? monthEl.value : new Date().getMonth() + 1;
    const y = yearEl ? yearEl.value : new Date().getFullYear();
    window.location.href = `/api/reports/export-csv?year=${y}&month=${m}`;
  },

  exportEmployeeCSV() {
    const monthEl = document.getElementById('adminRekapMonth');
    const yearEl = document.getElementById('adminRekapYear');
    const empSelect = document.getElementById('adminRekapEmployeeSelect');
    const empId = empSelect ? empSelect.value : null;

    if (!empId || empId === 'all') {
      this.showToast('Pilih karyawan terlebih dahulu.', 'warning');
      return;
    }

    const m = monthEl ? monthEl.value : new Date().getMonth() + 1;
    const y = yearEl ? yearEl.value : new Date().getFullYear();
    window.location.href = `/api/reports/export-employee-csv/${empId}?year=${y}&month=${m}`;
  },

  // ========== ADMIN: KELOLA KARYAWAN ==========
  async loadAdminEmployees() {
    const listEl = document.getElementById('employeeListTable');
    if (!listEl) return;

    try {
      const res = await API.get('/api/employees');
      listEl.innerHTML = res.employees
        .map(
          (emp) => `
        <tr>
          <td><b>${emp.name}</b></td>
          <td>${emp.nip}</td>
          <td>${emp.position || '-'}</td>
          <td>
            <span class="badge ${emp.has_face ? 'badge-hadir' : 'badge-belum'}">
              ${emp.has_face ? '✅ Terdaftar' : 'Belum Ada'}
            </span>
          </td>
          <td>
            <span class="badge ${emp.is_active ? 'badge-hadir' : 'badge-alpa'}">${emp.is_active ? 'Aktif' : 'Nonaktif'}</span>
          </td>
          <td>
            <div style="display:flex;gap:6px">
              ${emp.has_face ? `<button class="btn" style="padding:4px 8px;font-size:11px" onclick="App.resetEmployeeFace(${emp.id})">Reset Wajah</button>` : ''}
              ${emp.is_active ? `<button class="btn btn-danger" style="padding:4px 8px;font-size:11px" onclick="App.deactivateEmployee(${emp.id})">Nonaktifkan</button>` : ''}
            </div>
          </td>
        </tr>
      `
        )
        .join('');
    } catch (err) {
      this.showToast('Gagal memuat karyawan: ' + err.message, 'danger');
    }
  },

  async resetEmployeeFace(id) {
    if (!confirm('Reset data biometrik wajah karyawan ini agar bisa didaftarkan ulang?')) return;

    try {
      await API.post(`/api/auth/reset-face/${id}`);
      this.showToast('Data wajah berhasil direset.', 'success');
      this.loadAdminEmployees();
    } catch (err) {
      this.showToast(err.message, 'danger');
    }
  },

  async handleEmployeeSubmit(e) {
    e.preventDefault();
    const nip = document.getElementById('newEmpNip').value;
    const name = document.getElementById('newEmpName').value;
    const position = document.getElementById('newEmpPosition').value;
    const pin = document.getElementById('newEmpPin').value;

    try {
      await API.post('/api/employees', { nip, name, position, pin });
      this.showToast('Karyawan berhasil ditambahkan!', 'success');
      e.target.reset();
      document.getElementById('modalTambahKaryawan').classList.remove('open');
      this.loadAdminEmployees();
    } catch (err) {
      this.showToast(err.message, 'danger');
    }
  },

  async deactivateEmployee(id) {
    if (!confirm('Apakah Anda yakin ingin menonaktifkan karyawan ini?')) return;

    try {
      await API.delete(`/api/employees/${id}`);
      this.showToast('Karyawan dinonaktifkan.', 'success');
      this.loadAdminEmployees();
    } catch (err) {
      this.showToast(err.message, 'danger');
    }
  },

  // ========== ADMIN: PENGATURAN KANTOR ==========
  async loadAdminSettings() {
    try {
      const res = await API.get('/api/settings');
      const s = res.settings;

      document.getElementById('setOfficeName').value = s.office_name || '';
      document.getElementById('setOfficeLat').value = s.office_lat || '';
      document.getElementById('setOfficeLng').value = s.office_lng || '';
      document.getElementById('setOfficeRadius').value = s.office_radius || '150';
      document.getElementById('setRequireLoc').checked = s.require_location === 'true';
      document.getElementById('setRequireSelfie').checked = s.require_selfie === 'true';
      document.getElementById('setAllowanceMeal').value = s.allowance_meal || '25000';
      document.getElementById('setAllowanceOvertime').value = s.allowance_overtime || '20000';
      document.getElementById('setPenaltyLate').value = s.penalty_late || '10000';
      document.getElementById('setPenaltyAbsent').value = s.penalty_absent || '75000';
    } catch (err) {
      this.showToast('Gagal memuat pengaturan: ' + err.message, 'danger');
    }
  },

  async handleUseCurrentLocation() {
    const btn = document.getElementById('btnUseCurrentLocation');
    btn.textContent = 'Mencari GPS...';

    try {
      const pos = await GEO.getCurrentPosition();
      document.getElementById('setOfficeLat').value = pos.lat.toFixed(6);
      document.getElementById('setOfficeLng').value = pos.lng.toFixed(6);
      this.showToast('Koordinat GPS berhasil disetel!', 'success');
    } catch (err) {
      this.showToast(err.message, 'danger');
    } finally {
      btn.textContent = 'Gunakan Lokasi Saya Saat Ini';
    }
  },

  async handleSettingsSubmit(e) {
    e.preventDefault();
    const payload = {
      office_name: document.getElementById('setOfficeName').value,
      office_lat: document.getElementById('setOfficeLat').value,
      office_lng: document.getElementById('setOfficeLng').value,
      office_radius: document.getElementById('setOfficeRadius').value,
      require_location: document.getElementById('setRequireLoc').checked ? 'true' : 'false',
      require_selfie: document.getElementById('setRequireSelfie').checked ? 'true' : 'false',
      allowance_meal: document.getElementById('setAllowanceMeal').value,
      allowance_overtime: document.getElementById('setAllowanceOvertime').value,
      penalty_late: document.getElementById('setPenaltyLate').value,
      penalty_absent: document.getElementById('setPenaltyAbsent').value
    };

    try {
      await API.put('/api/settings', payload);
      this.showToast('Pengaturan kantor berhasil disimpan!', 'success');
    } catch (err) {
      this.showToast(err.message, 'danger');
    }
  }
};

// Inisialisasi saat DOM siap
document.addEventListener('DOMContentLoaded', () => App.init());
