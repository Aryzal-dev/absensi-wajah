const GEO = {
  calculateDistance(lat1, lon1, lat2, lon2) {
    if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return null;
    const R = 6371e3;
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return Math.round(R * c);
  },

  getCurrentPosition(timeoutMs = 4000) {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        return reject(new Error('Perangkat / browser Anda tidak mendukung fitur lokasi GPS.'));
      }

      let done = false;
      const timer = setTimeout(() => {
        if (!done) {
          done = true;
          // Coba fallback akurasi normal jika GPS akurasi tinggi lambat merespons
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              resolve({
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                accuracy: pos.coords.accuracy
              });
            },
            () => reject(new Error('Waktu pencarian lokasi GPS habis. Pastikan GPS aktif.')),
            { enableHighAccuracy: false, timeout: 3000, maximumAge: 60000 }
          );
        }
      }, timeoutMs);

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (!done) {
            done = true;
            clearTimeout(timer);
            resolve({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracy: pos.coords.accuracy
            });
          }
        },
        (err) => {
          if (!done) {
            done = true;
            clearTimeout(timer);
            let msg = 'Gagal mendeteksi lokasi GPS.';
            switch (err.code) {
              case err.PERMISSION_DENIED:
                msg = 'Izin lokasi GPS ditolak. Harap izinkan akses lokasi di browser HP Anda.';
                break;
              case err.POSITION_UNAVAILABLE:
                msg = 'Sinyal lokasi tidak tersedia. Coba aktifkan GPS pada HP Anda.';
                break;
              case err.TIMEOUT:
                msg = 'Waktu pencarian lokasi habis. Silakan coba lagi.';
                break;
            }
            reject(new Error(msg));
          }
        },
        {
          enableHighAccuracy: true,
          timeout: timeoutMs,
          maximumAge: 60000 // Cache 1 menit agar instan
        }
      );
    });
  }
};
