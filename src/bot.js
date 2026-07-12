// bot.js
// Chatbot WhatsApp Edukasi & Pelaporan Sampah Desa
// KKN 2026 - Fajar Arief Rezky - 23416255201230 - IF23E

const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const { appendReport, ensureHeader } = require("./sheets");

const UPLOAD_DIR = path.resolve(__dirname, "..", "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_SENDERS = (process.env.ALLOWED_SENDERS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

function isAllowedSender(id) {
  if (ALLOWED_SENDERS.length === 0) return false;
  return ALLOWED_SENDERS.some((allowed) => id.includes(allowed));
}

// Simpan status percakapan tiap nomor (in-memory, cukup untuk demo/skala desa)
// state: 'idle' | 'awaiting_report_photo' | 'awaiting_report_location' | 'in_quiz'
const sessions = new Map();

function getSession(id) {
  if (!sessions.has(id)) {
    sessions.set(id, { state: "idle", pendingReport: {}, quizIndex: 0, quizScore: 0 });
  }
  return sessions.get(id);
}

const MENU_TEXT = `*Selamat datang di Layanan Sampah Desa* 🌱

Ketik angka menu yang kamu mau:
1️⃣ Edukasi Sampah
2️⃣ Lapor Sampah / TPS Penuh
3️⃣ Jadwal & Info Kebersihan
4️⃣ Kuis Edukasi Sampah

Ketik *menu* kapan saja untuk kembali ke menu ini.`;

const EDUKASI_TEXT = `*Edukasi Pengelolaan Sampah* ♻️

*Jenis Sampah:*
- Organik: sisa makanan, daun, sampah dapur (bisa jadi kompos)
- Anorganik: plastik, kaleng, kaca, kertas (bisa didaur ulang)
- B3: baterai, lampu, obat kadaluarsa (perlu penanganan khusus)

*Konsep 3R:*
- *Reduce*: kurangi pemakaian barang sekali pakai
- *Reuse*: pakai kembali barang yang masih layak
- *Recycle*: olah sampah jadi barang/produk baru

Ketik *menu* untuk kembali.`;

const JADWAL_TEXT = `*Jadwal & Info Kebersihan Desa* 🗓️

- Pengangkutan sampah rutin: Senin, Rabu, Jumat (pagi)
- Gotong royong bulanan: Minggu pertama tiap bulan
- Titik kumpul sampah anorganik: Balai Desa

_Catatan: jadwal dapat disesuaikan oleh perangkat desa._

Ketik *menu* untuk kembali.`;

const QUIZ = [
  {
    q: "1. Sampah sisa makanan termasuk jenis sampah apa?\nA. Organik\nB. Anorganik\nC. B3",
    correct: "a",
  },
  {
    q: "2. Apa kepanjangan dari 3R?\nA. Reduce, Reuse, Recycle\nB. Rapi, Rajin, Ringkas\nC. Reduce, Repeat, Recycle",
    correct: "a",
  },
  {
    q: "3. Baterai bekas termasuk kategori sampah apa?\nA. Organik\nB. Anorganik\nC. B3 (perlu penanganan khusus)",
    correct: "c",
  },
];

function normalize(text) {
  return (text || "").trim().toLowerCase();
}

async function replySafely(msg, text) {
  try {
    await msg.reply(text);
  } catch (err) {
    const message = err?.message || String(err);
    console.error("[bot] Gagal mengirim balasan:", message);
  }
}

async function handleReportCompletion(client, msg, session, id) {
  const contact = await msg.getContact();
  const nama = contact.pushname || contact.number || id;

  await appendReport({
    nomorWa: id.replace("@c.us", ""),
    nama,
    deskripsi: session.pendingReport.deskripsi || "Laporan via foto & lokasi",
    latitude: session.pendingReport.latitude,
    longitude: session.pendingReport.longitude,
    fotoFilename: session.pendingReport.fotoFilename,
  });

  await replySafely(
    msg,
    "✅ Terima kasih! Laporan kamu sudah tersimpan dan akan ditindaklanjuti oleh perangkat desa.\n\nKetik *menu* untuk kembali ke menu utama."
  );

  session.state = "idle";
  session.pendingReport = {};
}

function startClient() {
  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: path.resolve(__dirname, "..", ".wwebjs_auth") }),
    puppeteer: {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    },
  });

  client.on("qr", (qr) => {
    console.log("\nScan QR code ini dengan WhatsApp kamu (Menu > Perangkat Tertaut):\n");
    qrcode.generate(qr, { small: true });
  });

  client.on("ready", async () => {
    console.log("[bot] WhatsApp bot siap digunakan!");
    try {
      await ensureHeader();
    } catch (err) {
      console.error("[bot] Gagal cek header Google Sheet:", err.message);
      console.error("      Pastikan credentials.json & SPREADSHEET_ID sudah benar di .env");
    }
  });

  client.on("message", async (msg) => {
    const id = msg.from;
    const session = getSession(id);
    const text = normalize(msg.body);

    if (!isAllowedSender(id) && !msg.fromMe) {
      return;
    }

    // Perintah global
    if (text === "menu") {
      session.state = "idle";
      session.pendingReport = {};
      await replySafely(msg, MENU_TEXT);
      return;
    }

    // === Alur Laporan Sampah ===
    if (session.state === "awaiting_report_photo") {
      if (msg.hasMedia) {
        const media = await msg.downloadMedia();
        const ext = media.mimetype.split("/")[1] || "jpg";
        const filename = `report_${Date.now()}.${ext}`;
        fs.writeFileSync(
          path.join(UPLOAD_DIR, filename),
          media.data,
          "base64"
        );
        session.pendingReport.fotoFilename = filename;
        session.pendingReport.deskripsi = msg.body || session.pendingReport.deskripsi;
        session.state = "awaiting_report_location";
        await replySafely(
          msg,
          "📸 Foto diterima!\n\nSekarang kirim *lokasi* titik sampah tersebut (tekan ikon 📎 lampiran > Lokasi di WhatsApp)."
        );
      } else {
        await replySafely(msg, "Mohon kirim *foto* titik sampah/TPS terlebih dahulu ya 🙏");
      }
      return;
    }

    if (session.state === "awaiting_report_location") {
      if (msg.location) {
        session.pendingReport.latitude = msg.location.latitude;
        session.pendingReport.longitude = msg.location.longitude;
        await handleReportCompletion(client, msg, session, id);
      } else {
        await replySafely(
          msg,
          "Mohon kirim *lokasi* (bukan teks) lewat fitur lampiran 📎 > Lokasi di WhatsApp ya."
        );
      }
      return;
    }

    // === Alur Kuis ===
    if (session.state === "in_quiz") {
      const answer = text;
      const current = QUIZ[session.quizIndex];
      if (["a", "b", "c"].includes(answer)) {
        if (answer === current.correct) {
          session.quizScore += 1;
          await replySafely(msg, "✅ Benar!");
        } else {
          await replySafely(msg, `❌ Kurang tepat. Jawaban benar: ${current.correct.toUpperCase()}`);
        }
        session.quizIndex += 1;

        if (session.quizIndex >= QUIZ.length) {
          await replySafely(
            msg,
            `🏁 Kuis selesai! Skor kamu: ${session.quizScore}/${QUIZ.length}\n\nKetik *menu* untuk kembali.`
          );
          session.state = "idle";
          session.quizIndex = 0;
          session.quizScore = 0;
        } else {
          await replySafely(msg, QUIZ[session.quizIndex].q + "\n\nJawab dengan A, B, atau C.");
        }
      } else {
        await replySafely(msg, "Jawab dengan mengetik *A*, *B*, atau *C* ya.");
      }
      return;
    }

    // === Menu Utama ===
    switch (text) {
      case "1":
      case "edukasi":
        await replySafely(msg, EDUKASI_TEXT);
        break;

      case "2":
      case "lapor":
        session.state = "awaiting_report_photo";
        session.pendingReport = {};
        await replySafely(
          msg,
          "📢 *Lapor Sampah / TPS Penuh*\n\nSilakan kirim *foto* kondisi sampah/TPS yang ingin dilaporkan (boleh tambahkan keterangan singkat di caption)."
        );
        break;

      case "3":
      case "jadwal":
        await replySafely(msg, JADWAL_TEXT);
        break;

      case "4":
      case "kuis":
        session.state = "in_quiz";
        session.quizIndex = 0;
        session.quizScore = 0;
        await replySafely(
          msg,
          "*Kuis Edukasi Sampah* 🧠\n\n" + QUIZ[0].q + "\n\nJawab dengan A, B, atau C."
        );
        break;

      default:
        await replySafely(
          msg,
          "Maaf, aku belum paham perintah itu 🙏\n\n" + MENU_TEXT
        );
    }
  });

  client.initialize();
  return client;
}

if (require.main === module) {
  startClient();
}

module.exports = { startClient };
