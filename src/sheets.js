// sheets.js
// Modul untuk baca/tulis data laporan sampah ke Google Sheets
// KKN 2026 - Fajar Arief Rezky - 23416255201230 - IF23E

const { google } = require("googleapis");
const path = require("path");
require("dotenv").config();

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_NAME = process.env.SHEET_NAME || "Laporan";
const TPS_SHEET_NAME = "TitikTPS";
const CREDENTIALS_PATH = path.resolve(
  process.env.GOOGLE_APPLICATION_CREDENTIALS || "./credentials.json"
);

function getServiceAccountCredentials() {
  const rawJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!rawJson) return null;

  try {
    return JSON.parse(rawJson);
  } catch (err) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON tidak valid (bukan JSON yang benar).");
  }
}

// Header kolom yang dipakai di sheet laporan. Baris pertama sheet HARUS persis ini.
const HEADERS = [
  "Timestamp",
  "Nomor WA",
  "Nama Pelapor",
  "Deskripsi",
  "Latitude",
  "Longitude",
  "Status",
  "Foto",
  "Accuracy (m)",
];

// Header untuk sheet Titik TPS
const TPS_HEADERS = [
  "Timestamp",
  "Nomor WA",
  "Nama TPS",
  "Deskripsi",
  "Latitude",
  "Longitude",
  "Foto",
];

function getAuth() {
  const inlineCredentials = getServiceAccountCredentials();

  return new google.auth.GoogleAuth({
    ...(inlineCredentials ? { credentials: inlineCredentials } : { keyFile: CREDENTIALS_PATH }),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

async function getSheetsClient() {
  const auth = getAuth();
  const client = await auth.getClient();
  return google.sheets({ version: "v4", auth: client });
}

// Pastikan baris header ada di sheet laporan. Dipanggil sekali saat startup.
async function ensureHeader() {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A1:I1`,
  });

  const hasHeader = res.data.values && res.data.values.length > 0;
  if (!hasHeader) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A1:I1`,
      valueInputOption: "RAW",
      requestBody: { values: [HEADERS] },
    });
    console.log("[sheets] Header sheet laporan berhasil dibuat.");
  }
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!I1`,
    valueInputOption: "RAW",
    requestBody: { values: [["Accuracy (m)"]] },
  });

  // Pastikan sheet Titik TPS juga ada
  try {
    await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${TPS_SHEET_NAME}!A1:G1`,
    });
  } catch (err) {
    if (err.message?.includes("not found") || err.message?.includes("Unable to parse range")) {
      // Sheet belum ada, coba buat
      try {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
          requestBody: {
            requests: [
              {
                addSheet: {
                  properties: {
                    title: TPS_SHEET_NAME,
                  },
                },
              },
            ],
          },
        });
        console.log(`[sheets] Sheet "${TPS_SHEET_NAME}" berhasil dibuat.`);
        // Tambahkan header setelah sheet dibuat
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${TPS_SHEET_NAME}!A1:G1`,
          valueInputOption: "RAW",
          requestBody: { values: [TPS_HEADERS] },
        });
      } catch (addErr) {
        console.warn(`[sheets] Gagal setup sheet TPS:`, addErr.message);
      }
    }
  }
}

// Tambah satu baris laporan baru
async function appendReport({
  nomorWa,
  nama,
  deskripsi,
  latitude,
  longitude,
  accuracy,
  fotoFilename,
}) {
  const sheets = await getSheetsClient();
  const timestamp = new Date().toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
  });

  const row = [
    timestamp,
    nomorWa,
    nama || "-",
    deskripsi || "-",
    latitude,
    longitude,
    "Belum Ditangani",
    fotoFilename || "-",
    accuracy ?? "-",
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:I`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });

  console.log(`[sheets] Laporan baru dari ${nomorWa} tersimpan.`);
}

// Ambil semua laporan (dipakai dashboard/peta)
async function getAllReports() {
  try {
    const sheets = await getSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A2:I`,
    });

    const parseCoordinate = (value) => {
      if (typeof value === "number") return value;
      if (value === undefined || value === null) return NaN;

      const normalized = String(value).trim().replace(/\s+/g, "").replace(",", ".");
      return parseFloat(normalized);
    };

    const rows = res.data.values || [];
    return rows
      .map((r, idx) => ({
        rowNumber: idx + 2, // baris asli di sheet (buat update status nanti)
        timestamp: r[0] || "",
        nomorWa: r[1] || "",
        nama: r[2] || "",
        deskripsi: r[3] || "",
        latitude: parseCoordinate(r[4]),
        longitude: parseCoordinate(r[5]),
        status: r[6] || "Belum Ditangani",
        foto: r[7] || "",
        accuracy: Number.isFinite(parseCoordinate(r[8])) ? parseCoordinate(r[8]) : null,
      }))
      .filter((r) => !isNaN(r.latitude) && !isNaN(r.longitude) && r.status !== "Dihapus");
  } catch (err) {
    console.warn("[sheets] Gagal ambil laporan:", err.message);
    return [];
  }
}

// Update status laporan (dipakai dashboard, opsional/lanjutan)
async function updateStatus(rowNumber, status) {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!G${rowNumber}`,
    valueInputOption: "RAW",
    requestBody: { values: [[status]] },
  });
}

async function updateFotoReference(rowNumber, fotoReference) {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!H${rowNumber}`,
    valueInputOption: "RAW",
    requestBody: { values: [[fotoReference]] },
  });
}

async function deleteReport(rowNumber) {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!G${rowNumber}`,
    valueInputOption: "RAW",
    requestBody: { values: [["Dihapus"]] },
  });
}

// Tambah TPS baru (dari form warga di peta)
async function appendTps({
  nomorWa,
  nama,
  deskripsi,
  latitude,
  longitude,
  fotoFilename,
}) {
  const sheets = await getSheetsClient();
  const timestamp = new Date().toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
  });

  const row = [
    timestamp,
    nomorWa,
    nama || "-",
    deskripsi || "-",
    latitude,
    longitude,
    fotoFilename || "-",
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${TPS_SHEET_NAME}!A:G`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });

  console.log(`[sheets] TPS baru dari ${nomorWa} tersimpan.`);
}

// Ambil semua TPS dari sheet (dipakai dashboard/peta)
async function getAllTps() {
  const sheets = await getSheetsClient();
  
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${TPS_SHEET_NAME}!A2:G`,
    });

    const parseCoordinate = (value) => {
      if (typeof value === "number") return value;
      if (value === undefined || value === null) return NaN;

      const normalized = String(value).trim().replace(/\s+/g, "").replace(",", ".");
      return parseFloat(normalized);
    };

    const rows = res.data.values || [];
    return rows
      .map((r, idx) => ({
        rowNumber: idx + 2,
        timestamp: r[0] || "",
        nomorWa: r[1] || "",
        name: r[2] || "TPS",
        nama: r[2] || "TPS",
        deskripsi: r[3] || "",
        latitude: parseCoordinate(r[4]),
        longitude: parseCoordinate(r[5]),
        foto: r[6] || "",
        status: "TPS",
        type: "TPS",
      }))
      .filter((r) => !isNaN(r.latitude) && !isNaN(r.longitude));
  } catch (err) {
    console.warn("[sheets] Gagal ambil TPS:", err.message);
    return [];
  }
}

module.exports = {
  ensureHeader,
  appendReport,
  getAllReports,
  updateStatus,
  updateFotoReference,
  deleteReport,
  appendTps,
  getAllTps,
};
