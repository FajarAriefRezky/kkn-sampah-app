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

const { getAllReports, updateStatus, ensureHeader, appendReport, deleteReport, appendTps, getAllTps } = require("./sheets");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HTTP_PORT = Number(process.env.HTTP_PORT) || 3001;
const HOST = process.env.HOST || "0.0.0.0";
const HTTPS_HOST = process.env.HTTPS_HOST || "PetaTitikTPS";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || process.env.SESSION_SECRET || "";
const ADMIN_LOGIN_ATTEMPTS = {}; // { ip: { count, blockedUntil } }
const MAX_LOGIN_ATTEMPTS = 5;
const BLOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes
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

function parseCookies(cookieHeader = "") {
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const separatorIndex = part.indexOf("=");
      if (separatorIndex === -1) return acc;

      const key = part.slice(0, separatorIndex);
      const value = part.slice(separatorIndex + 1);
      acc[key] = decodeURIComponent(value);
      return acc;
    }, {});
}

function createAdminSessionToken(username) {
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD || !ADMIN_SESSION_SECRET) return "";

  return crypto
    .createHmac("sha256", ADMIN_SESSION_SECRET)
    .update(`${ADMIN_USERNAME}:${ADMIN_PASSWORD}`)
    .digest("hex");
}

function isAdminAuthenticated(req) {
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD || !ADMIN_SESSION_SECRET) return false;

  const cookies = parseCookies(req.headers.cookie || "");
  return cookies.admin_session === createAdminSessionToken(ADMIN_USERNAME);
}

function getClientIp(req) {
  return req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket.remoteAddress || "unknown";
}

function isLoginBlocked(ip) {
  const now = Date.now();
  const attempt = ADMIN_LOGIN_ATTEMPTS[ip];
  
  if (!attempt) return false;
  if (now > attempt.blockedUntil) {
    delete ADMIN_LOGIN_ATTEMPTS[ip];
    return false;
  }
  
  return true;
}

function recordLoginAttempt(ip, success) {
  const now = Date.now();
  
  if (success) {
    delete ADMIN_LOGIN_ATTEMPTS[ip];
    return;
  }
  
  if (!ADMIN_LOGIN_ATTEMPTS[ip]) {
    ADMIN_LOGIN_ATTEMPTS[ip] = { count: 0, blockedUntil: 0 };
  }
  
  ADMIN_LOGIN_ATTEMPTS[ip].count++;
  
  if (ADMIN_LOGIN_ATTEMPTS[ip].count >= MAX_LOGIN_ATTEMPTS) {
    ADMIN_LOGIN_ATTEMPTS[ip].blockedUntil = now + BLOCK_DURATION_MS;
  }
}

function setAdminSessionCookie(res, username) {
  const secure = RUN_LOCAL_HTTPS || IS_CLOUD_ENV;
  const cookieParts = [
    `admin_session=${encodeURIComponent(createAdminSessionToken(username))}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${60 * 60 * 12}`,
  ];

  if (secure) {
    cookieParts.push("Secure");
  }

  res.setHeader("Set-Cookie", cookieParts.join("; "));
}

function clearAdminSessionCookie(res) {
  const secure = RUN_LOCAL_HTTPS || IS_CLOUD_ENV;
  const cookieParts = ["admin_session=", "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];

  if (secure) {
    cookieParts.push("Secure");
  }

  res.setHeader("Set-Cookie", cookieParts.join("; "));
}

function requireAdmin(req, res, next) {
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD || !ADMIN_SESSION_SECRET) {
    return res.status(503).json({ ok: false, message: "Akses admin belum dikonfigurasi di server." });
  }

  if (!isAdminAuthenticated(req)) {
    return res.status(403).json({ ok: false, message: "Hanya admin yang dapat mengelola laporan." });
  }

  return next();
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

app.get("/admin", (req, res) => {
  res.sendFile(path.resolve(__dirname, "..", "public", "admin.html"));
});

app.get("/api/admin/session", (req, res) => {
  const enabled = Boolean(ADMIN_USERNAME && ADMIN_PASSWORD && ADMIN_SESSION_SECRET);
  res.json({ ok: true, enabled, authenticated: enabled ? isAdminAuthenticated(req) : false });
});

app.post("/api/admin/login", (req, res) => {
  const clientIp = getClientIp(req);
  
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD || !ADMIN_SESSION_SECRET) {
    return res.status(503).json({ ok: false, message: "Akses admin belum dikonfigurasi di server." });
  }

  if (isLoginBlocked(clientIp)) {
    return res.status(429).json({ ok: false, message: "Terlalu banyak percobaan login gagal. Coba lagi dalam 15 menit." });
  }

  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  
  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    recordLoginAttempt(clientIp, false);
    const attempt = ADMIN_LOGIN_ATTEMPTS[clientIp];
    return res.status(401).json({ ok: false, message: `Username atau password salah. (Percobaan: ${attempt.count}/${MAX_LOGIN_ATTEMPTS})` });
  }

  recordLoginAttempt(clientIp, true);
  setAdminSessionCookie(res, username);
  return res.json({ ok: true, message: "Login admin berhasil." });
});

app.post("/api/admin/logout", (req, res) => {
  clearAdminSessionCookie(res);
  res.json({ ok: true, message: "Logout admin berhasil." });
});

// Ambil semua laporan untuk ditampilkan di peta
app.get("/api/reports", async (req, res) => {
  try {
    const reports = await getAllReports();
    const tpsPoints = await getAllTps();
    // Gabung laporan dan TPS
    const allData = [...reports, ...tpsPoints];
    res.json({ ok: true, desa: process.env.NAMA_DESA || "Desa", data: allData });
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ ok: false, message: "Gagal mengambil data dari Google Sheets. Cek konfigurasi .env dan credentials.json." });
  }
});

// Ambil hanya TPS
app.get("/api/tps", async (req, res) => {
  try {
    const tps = await getAllTps();
    res.json({ ok: true, data: tps });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: "Gagal mengambil data TPS." });
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
app.post("/api/reports/:rowNumber/status", requireAdmin, async (req, res) => {
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
app.post("/api/reports/:rowNumber/delete", requireAdmin, async (req, res) => {
  try {
    const { rowNumber } = req.params;
    await deleteReport(parseInt(rowNumber, 10));
    res.json({ ok: true, message: "Laporan berhasil dihapus." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: "Gagal menghapus laporan." });
  }
});

// Tambah TPS/Bank Sampah baru dari form web
app.post("/api/tps", upload.single("foto"), async (req, res) => {
  try {
    const { nama, nomorWa, deskripsi, latitude, longitude } = req.body;
    if (!nama || !nomorWa || latitude === undefined || longitude === undefined) {
      return res.status(400).json({ ok: false, message: "Nama, nomor WA, dan koordinat wajib diisi." });
    }

    let fotoReference;
    if (req.file) {
      fotoReference = USE_CLOUDINARY ? await uploadToCloudinary(req.file) : req.file.filename;
    }

    await appendTps({
      nomorWa,
      nama,
      deskripsi: deskripsi || "",
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
      fotoFilename: fotoReference,
    });

    res.json({ ok: true, message: "TPS baru berhasil ditambahkan." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: "Gagal menambahkan TPS." });
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
