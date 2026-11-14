// Modul Deteksi Wajah & Biometrik Berbasis Neural Network (face-api.js)
const FaceDetectorModule = {
  isReady: false,
  isLoading: false,

  async init() {
    if (this.isReady) return true;
    if (this.isLoading) {
      while (this.isLoading) {
        await new Promise((r) => setTimeout(r, 100));
      }
      return this.isReady;
    }

    this.isLoading = true;

    try {
      if (typeof faceapi === 'undefined') {
        throw new Error('Library face-api.js belum dimuat.');
      }

      // Muat model Neural Network TinyFaceDetector, Landmarks 68-titik, dan Face Recognition 128-d
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
        faceapi.nets.faceLandmark68TinyNet.loadFromUri('/models'),
        faceapi.nets.faceRecognitionNet.loadFromUri('/models')
      ]);

      this.isReady = true;
      console.log('✅ Model Face Neural Network & Landmark siap.');
      return true;
    } catch (err) {
      console.error('❌ Gagal memuat model face-api:', err);
      this.isReady = false;
      return false;
    } finally {
      this.isLoading = false;
    }
  },

  // Deteksi wajah real-time pada video stream menggunakan Neural Network
  async detectFaceInVideo(videoElement) {
    if (!this.isReady || !videoElement || videoElement.readyState < 2) {
      return { hasFace: false, reason: 'Kamera belum siap' };
    }

    try {
      // Deteksi wajah + titik landmark (mata, hidung, bibir)
      const options = new faceapi.TinyFaceDetectorOptions({
        inputSize: 160, // 160px sangat ringan dan cepat di HP (30+ FPS)
        scoreThreshold: 0.55 // Ambang batas ketat agar tidak ada false positive pada dinding/benda
      });

      const detection = await faceapi
        .detectSingleFace(videoElement, options)
        .withFaceLandmarks(true);

      if (!detection) {
        return { hasFace: false, reason: 'Posisikan wajah Anda tepat di depan kamera' };
      }

      // Pastikan titik landmark wajah (kedua mata & mulut) terdeteksi
      const landmarks = detection.landmarks;
      const leftEye = landmarks.getLeftEye();
      const rightEye = landmarks.getRightEye();
      const mouth = landmarks.getMouth();

      if (!leftEye || !rightEye || !mouth || leftEye.length === 0 || rightEye.length === 0) {
        return { hasFace: false, reason: 'Wajah tidak lengkap atau terhalang' };
      }

      const box = detection.detection.box;
      return {
        hasFace: true,
        score: Math.round(detection.detection.score * 100),
        box: { x: box.x, y: box.y, width: box.width, height: box.height }
      };
    } catch (err) {
      return { hasFace: false, reason: err.message };
    }
  },

  // Validasi ketat pada foto hasil snapshot (Kanvas): Wajib terdeteksi Landmark + Descriptor 128-d
  async validateSnapshot(canvas) {
    if (!this.isReady) {
      await this.init();
    }

    if (!canvas) {
      return { hasFace: false, descriptor: null, reason: 'Gambar kosong' };
    }

    try {
      const options = new faceapi.TinyFaceDetectorOptions({
        inputSize: 320, // Resolusi lebih tinggi untuk snapshot
        scoreThreshold: 0.55
      });

      const detection = await faceapi
        .detectSingleFace(canvas, options)
        .withFaceLandmarks(true)
        .withFaceDescriptor();

      if (!detection || !detection.descriptor) {
        return {
          hasFace: false,
          descriptor: null,
          reason: 'Bukan wajah manusia! Kamera mendeteksi objek mati/dinding/bukan muka.'
        };
      }

      const landmarks = detection.landmarks;
      if (!landmarks.getLeftEye()?.length || !landmarks.getRightEye()?.length || !landmarks.getMouth()?.length) {
        return {
          hasFace: false,
          descriptor: null,
          reason: 'Fitur wajah (mata/hidung/mulut) tidak terdeteksi jelas.'
        };
      }

      return {
        hasFace: true,
        score: Math.round(detection.detection.score * 100),
        descriptor: Array.from(detection.descriptor),
        box: detection.detection.box
      };
    } catch (err) {
      return { hasFace: false, descriptor: null, reason: err.message };
    }
  },

  // Bandingkan dua 128-d descriptors (Euclidean Distance)
  compareDescriptors(desc1, desc2) {
    if (!desc1 || !desc2 || desc1.length !== desc2.length) {
      return { isMatch: false, distance: 1.0 };
    }

    let sum = 0;
    for (let i = 0; i < desc1.length; i++) {
      const diff = desc1[i] - desc2[i];
      sum += diff * diff;
    }
    const distance = Math.sqrt(sum);
    return {
      isMatch: distance <= 0.55,
      distance: Math.round(distance * 1000) / 1000
    };
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = FaceDetectorModule;
}
