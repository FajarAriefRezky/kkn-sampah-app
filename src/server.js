// server.js
// Dashboard web (peta digital sebaran titik sampah) + REST API
// KKN 2026 - Fajar Arief Rezky - 23416255201230 - IF23E

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const http = require("http");
const https = require("https");
const multer = require("multer");
const { v2: cloudinary } = require("cloudinary");
const selfsigned = require("selfsigned");
require("dotenv").config();

const { getAllReports, updateStatus, ensureHeader, appendReport, deleteReport } = require("./sheets");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HTTP_PORT = Number(process.env.HTTP_PORT) || 3001;
const HOST = process.env.HOST || "0.0.0.0";
const HTTPS_HOST = process.env.HTTPS_HOST || "PetaTitikTPS";
const IS_CLOUD_ENV = Boolean(
  process.env.RAILWAY_ENVIRONMENT ||
    process.env.RENDER ||
    process.env.FLY_APP_NAME ||
    process.env.K_SERVICE ||
    process.env.HEROKU
);
const FORCE_LOCAL_HTTPS = process.env.FORCE_LOCAL_HTTPS === "1";
const RUN_LOCAL_HTTPS = !IS_CLOUD_ENV || FORCE_LOCAL_HTTPS;
const RUN_HTTP_FALLBACK = process.env.RUN_HTTP_FALLBACK !== "0";
const USE_CLOUDINARY = Boolean(
  process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
);
const UPLOAD_DIR = path.resolve(__dirname, "..", "uploads");
const CERT_DIR = path.resolve(__dirname, "..", "certs");
const CERT_PATH = path.join(CERT_DIR, "cert.pem");
const KEY_PATH = path.join(CERT_DIR, "key.pem");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(CERT_DIR)) fs.mkdirSync(CERT_DIR, { recursive: true });

if (USE_CLOUDINARY) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const info of interfaces[name] || []) {
      if (info.family === "IPv4" && !info.internal) {
        return info.address;
      }
    }
  }
  return "127.0.0.1";
}

const storage = USE_CLOUDINARY
  ? multer.memoryStorage()
  : multer.diskStorage({
      destination: (req, file, cb) => cb(null, UPLOAD_DIR),
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname || "jpg");
        cb(null, `report_${Date.now()}${ext}`);
      },
    });

const upload = multer({ storage });

function uploadToCloudinary(file) {
  return new Promise((resolve, reject) => {
    const folder = process.env.CLOUDINARY_FOLDER || "kkn-sampah";
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: "image",
      },
      (error, result) => {
        if (error) return reject(error);
        return resolve(result?.secure_url);
      }
    );

    uploadStream.end(file.buffer);
  });
}

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.resolve(__dirname, "..", "public")));
app.use("/uploads", express.static(UPLOAD_DIR));

// Ambil semua laporan untuk ditampilkan di peta
app.get("/api/reports", async (req, res) => {
  try {
    const reports = await getAllReports();
    res.json({ ok: true, desa: process.env.NAMA_DESA || "Desa", data: reports });
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ ok: false, message: "Gagal mengambil data dari Google Sheets. Cek konfigurasi .env dan credentials.json." });
  }
});

// Kirim laporan dari form web
app.post("/api/reports", upload.single("foto"), async (req, res) => {
  try {
    const { nama, nomorWa, deskripsi, latitude, longitude } = req.body;
    if (!nama || !nomorWa || !deskripsi || latitude === undefined || longitude === undefined) {
      return res.status(400).json({ ok: false, message: "Semua field wajib diisi." });
    }

    let fotoReference;
    if (req.file) {
      fotoReference = USE_CLOUDINARY ? await uploadToCloudinary(req.file) : req.file.filename;
    }

    await appendReport({
      nomorWa,
      nama,
      deskripsi,
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
      fotoFilename: fotoReference,
    });

    res.json({ ok: true, message: "Laporan berhasil dikirim." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: "Gagal menyimpan laporan." });
  }
});

// Update status laporan (klik marker di peta -> tandai selesai/proses)
app.post("/api/reports/:rowNumber/status", async (req, res) => {
  try {
    const { rowNumber } = req.params;
    const { status } = req.body;
    const allowed = ["Belum Ditangani", "Sedang Ditindaklanjuti", "Selesai Ditangani"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ ok: false, message: "Status tidak valid." });
    }
    await updateStatus(parseInt(rowNumber, 10), status);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: "Gagal update status." });
  }
});

// Hapus laporan (soft delete)
app.post("/api/reports/:rowNumber/delete", async (req, res) => {
  try {
    const { rowNumber } = req.params;
    await deleteReport(parseInt(rowNumber, 10));
    res.json({ ok: true, message: "Laporan berhasil dihapus." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: "Gagal menghapus laporan." });
  }
});

function ensureHttpsCertificate() {
  const hosts = [HTTPS_HOST, "localhost", "127.0.0.1"];
  const expectedAltNames = hosts.map((host) => ({ type: 2, value: host }));

  if (fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH)) {
    const certText = fs.readFileSync(CERT_PATH, "utf8");
    const keyText = fs.readFileSync(KEY_PATH, "utf8");

    try {
      const cert = new crypto.X509Certificate(certText);
      const altNames = cert.subjectAltName || "";
      const hasRequiredHosts = hosts.every((host) => altNames.includes(host));

      if (hasRequiredHosts) {
        return { key: keyText, cert: certText };
      }
    } catch (err) {
      console.warn("[server] Sertifikat lama tidak valid, akan dibuat ulang:", err.message);
    }
  }

  const attrs = [{ name: "commonName", value: HTTPS_HOST }];
  const pems = selfsigned.generate(attrs, {
    days: 365,
    keySize: 2048,
    algorithm: "sha256",
    extensions: [
      {
        name: "subjectAltName",
        altNames: expectedAltNames,
      },
    ],
  });

  fs.writeFileSync(KEY_PATH, pems.private);
  fs.writeFileSync(CERT_PATH, pems.cert);

  return { key: pems.private, cert: pems.cert };
}

(async () => {
  const localIp = getLocalIp();
  const httpsPortText = PORT === 443 ? "" : `:${PORT}`;
  const httpPortText = HTTP_PORT === 80 ? "" : `:${HTTP_PORT}`;

  if (RUN_LOCAL_HTTPS) {
    const ssl = ensureHttpsCertificate();

    https.createServer({ key: ssl.key, cert: ssl.cert }, app).listen(PORT, HOST, async () => {
      console.log(`[server] Dashboard HTTPS jalan di https://${HTTPS_HOST}${httpsPortText}`);
      console.log(`[server] Juga tersedia di https://localhost${httpsPortText}`);
      console.log(`[server] Bisa diakses dari perangkat lain di https://${localIp}${httpsPortText}`);

      if (RUN_HTTP_FALLBACK && HTTP_PORT !== PORT) {
        console.log(`[server] Akses HP (tanpa warning sertifikat): http://${localIp}${httpPortText}`);
      }

      try {
        await ensureHeader();
      } catch (err) {
        console.error("[server] Gagal cek header Google Sheet:", err.message);
      }
    });

    // HTTP fallback untuk akses mobile LAN yang biasanya tidak menerima self-signed cert.
    if (RUN_HTTP_FALLBACK && HTTP_PORT !== PORT) {
      http.createServer(app).listen(HTTP_PORT, HOST);
    }
    return;
  }

  // Mode cloud: platform sudah menangani HTTPS di edge, aplikasi cukup HTTP pada PORT.
  http.createServer(app).listen(PORT, HOST, async () => {
    console.log(`[server] Cloud mode aktif di http://${HOST}:${PORT}`);

    try {
      await ensureHeader();
    } catch (err) {
      console.error("[server] Gagal cek header Google Sheet:", err.message);
    }
  });
})();
