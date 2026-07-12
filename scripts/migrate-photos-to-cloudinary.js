const path = require("path");
const fs = require("fs");
const { v2: cloudinary } = require("cloudinary");
require("dotenv").config();

const { getAllReports, updateFotoReference } = require("../src/sheets");

const UPLOAD_DIR = path.resolve(__dirname, "..", "uploads");
const CLOUDINARY_FOLDER = process.env.CLOUDINARY_FOLDER || "kkn-sampah";

function isCloudUrl(value) {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

function validateEnv() {
  const required = [
    "CLOUDINARY_CLOUD_NAME",
    "CLOUDINARY_API_KEY",
    "CLOUDINARY_API_SECRET",
    "SPREADSHEET_ID",
  ];

  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  }
}

async function uploadLocalPhoto(fileName) {
  const absolutePath = path.join(UPLOAD_DIR, fileName);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File not found in uploads: ${fileName}`);
  }

  const result = await cloudinary.uploader.upload(absolutePath, {
    folder: CLOUDINARY_FOLDER,
    resource_type: "image",
  });

  if (!result?.secure_url) {
    throw new Error(`Cloudinary upload did not return secure_url for ${fileName}`);
  }

  return result.secure_url;
}

async function migratePhotos() {
  validateEnv();

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });

  const reports = await getAllReports();
  const uploadCache = new Map();

  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const report of reports) {
    const currentFoto = report.foto;

    if (!currentFoto || currentFoto === "-" || isCloudUrl(currentFoto)) {
      skipped += 1;
      continue;
    }

    try {
      let photoUrl = uploadCache.get(currentFoto);
      if (!photoUrl) {
        photoUrl = await uploadLocalPhoto(currentFoto);
        uploadCache.set(currentFoto, photoUrl);
      }

      await updateFotoReference(report.rowNumber, photoUrl);
      migrated += 1;
      console.log(`[migrate] row ${report.rowNumber}: ${currentFoto} -> ${photoUrl}`);
    } catch (err) {
      failed += 1;
      console.error(`[migrate] row ${report.rowNumber} failed: ${currentFoto} (${err.message})`);
    }
  }

  console.log("\n[migrate] done");
  console.log(`[migrate] migrated=${migrated} skipped=${skipped} failed=${failed}`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

migratePhotos().catch((err) => {
  console.error("[migrate] fatal:", err.message);
  process.exit(1);
});
