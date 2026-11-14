const Camera = {
  stream: null,
  faceTrackTimer: null,
  consecutiveFaceCount: 0,
  isFacePresent: false,

  async start(videoElement, onFaceStatusChange) {
    this.stop();
    this.consecutiveFaceCount = 0;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user', // Kamera depan
          width: { ideal: 640 },
          height: { ideal: 640 }
        },
        audio: false
      });
      videoElement.srcObject = this.stream;
      await videoElement.play();

      // Inisialisasi model neural network wajah
      await FaceDetectorModule.init();

      // Mulai loop pelacak wajah real-time
      if (onFaceStatusChange) {
        this.startFaceTracking(videoElement, onFaceStatusChange);
      }

      return true;
    } catch (err) {
      console.error('Camera error:', err);
      let msg = 'Gagal mengakses kamera.';
      if (err.name === 'NotAllowedError') {
        msg = 'Izin kamera ditolak. Harap izinkan akses kamera pada browser Anda.';
      } else if (err.name === 'NotFoundError') {
        msg = 'Kamera tidak ditemukan pada perangkat ini.';
      }
      throw new Error(msg);
    }
  },

  startFaceTracking(videoElement, callback) {
    if (this.faceTrackTimer) clearInterval(this.faceTrackTimer);

    this.faceTrackTimer = setInterval(async () => {
      if (!this.stream) return;

      try {
        const result = await FaceDetectorModule.detectFaceInVideo(videoElement);

        if (result.hasFace) {
          this.consecutiveFaceCount++;
        } else {
          this.consecutiveFaceCount = Math.max(0, this.consecutiveFaceCount - 1);
        }

        // Butuh minimal 2 frame berturut-turut untuk memastikan wajah stabil
        const isStableFace = this.consecutiveFaceCount >= 2;
        this.isFacePresent = isStableFace;
        callback(isStableFace, result);
      } catch (e) {
        // Abaikan error per frame
      }
    }, 250);
  },

  stop() {
    if (this.faceTrackTimer) {
      clearInterval(this.faceTrackTimer);
      this.faceTrackTimer = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    this.consecutiveFaceCount = 0;
    this.isFacePresent = false;
  },

  async captureAndValidateFace(videoElement, maxDimension = 480) {
    if (!videoElement || !this.stream) {
      throw new Error('Kamera tidak aktif.');
    }

    const canvas = document.createElement('canvas');
    let width = videoElement.videoWidth || 640;
    let height = videoElement.videoHeight || 480;

    // Perkecil proporsional agar hemat data
    if (width > height) {
      if (width > maxDimension) {
        height = Math.round((height * maxDimension) / width);
        width = maxDimension;
      }
    } else {
      if (height > maxDimension) {
        width = Math.round((width * maxDimension) / height);
        height = maxDimension;
      }
    }

    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    // Cerminkan secara horizontal seperti cermin selfie biasa
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(videoElement, 0, 0, width, height);

    // Validasi ketat Neural Network (Mata, Hidung, Mulut + 128-d Feature Vector)
    const faceCheck = await FaceDetectorModule.validateSnapshot(canvas);
    if (!faceCheck.hasFace || !faceCheck.descriptor) {
      throw new Error(faceCheck.reason || 'Foto ditolak: Bukan wajah manusia! Kamera hanya menerima wajah orang asli.');
    }

    // Kompresi JPEG kualitas 0.75 (~15-25 KB)
    return {
      photoBase64: canvas.toDataURL('image/jpeg', 0.75),
      faceScore: faceCheck.score,
      liveDescriptor: faceCheck.descriptor
    };
  }
};
