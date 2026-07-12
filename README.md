# Sistem Informasi Digital Pengelolaan Sampah Desa
### Chatbot WhatsApp + Peta Digital (GIS Sederhana)

**KKN 2026 — Fajar Arief Rezky (23416255201230) — Teknik Informatika IF23E**

Program ini terdiri dari 2 bagian yang jalan bersamaan:
1. **Bot WhatsApp** (`src/bot.js`) — edukasi, lapor sampah (foto+lokasi), jadwal, kuis
2. **Dashboard Web** (`src/server.js` + `public/`) — peta digital sebaran titik sampah, real-time dari Google Sheets

---

## 1. Persiapan Awal

### a. Install Node.js
Download dan install Node.js versi 18 ke atas dari https://nodejs.org

### b. Install dependencies project
Buka folder project ini di terminal, lalu jalankan:
```bash
npm install
```

---

## 2. Setup Google Sheets (sebagai database)

### a. Buat Google Spreadsheet baru
1. Buka https://sheets.google.com, buat spreadsheet baru
2. Ganti nama sheet/tab pertama jadi `Laporan` (atau sesuaikan `SHEET_NAME` di `.env`)
3. Copy **ID spreadsheet** dari URL, contoh:
   `https://docs.google.com/spreadsheets/d/`**`1AbCxyz...`**`/edit`
   → yang di-bold itu ID-nya

### b. Buat Service Account (kunci akses otomatis)
1. Buka https://console.cloud.google.com
2. Buat project baru (bebas nama apa)
3. Aktifkan **Google Sheets API** (menu "APIs & Services" > "Enable APIs" > cari "Google Sheets API" > Enable)
4. Buat **Service Account**: menu "IAM & Admin" > "Service Accounts" > "Create Service Account"
5. Setelah dibuat, buka service account tersebut > tab "Keys" > "Add Key" > "Create new key" > pilih **JSON** > download
6. Rename file JSON yang didownload jadi `credentials.json`, taruh di folder utama project ini (sejajar dengan `package.json`)
7. Buka file `credentials.json`, cari field `"client_email"` (contoh: `xxx@xxx.iam.gserviceaccount.com`)
8. **Share spreadsheet kamu** ke email tersebut dengan akses **Editor** (klik tombol "Share" di Google Sheets seperti share ke teman biasa)

### c. Konfigurasi .env
1. Copy file `.env.example` jadi `.env`
2. Isi `SPREADSHEET_ID` dengan ID spreadsheet dari langkah 2a
3. Pastikan `GOOGLE_APPLICATION_CREDENTIALS=./credentials.json`

---

## 3. Menjalankan Program

### Jalankan dashboard + bot sekaligus:
```bash
npm start
```

### Atau jalankan terpisah (2 terminal berbeda):
```bash
npm run server   # dashboard web
npm run bot      # bot WhatsApp
```

Saat bot pertama kali dijalankan, akan muncul **QR code di terminal**.
Scan QR tersebut pakai WhatsApp kamu: buka WhatsApp > Menu (⋮) > Perangkat Tertaut > Tautkan Perangkat.

Setelah itu bot otomatis aktif menjawab pesan.

Dashboard bisa dibuka di browser: **http://localhost:3000**

---

## 3A. Deploy 24 Jam (Laptop Boleh Mati)

Untuk membuat website tetap berjalan saat laptop mati, deploy ke server cloud. Rekomendasi tercepat: **Railway**.

### Langkah cepat Railway
1. Push project ini ke GitHub repository.
2. Login ke https://railway.app dan pilih **New Project > Deploy from GitHub Repo**.
3. Pilih repository project ini.
4. Atur Environment Variables berikut di Railway:
   - `SPREADSHEET_ID`
   - `SHEET_NAME`
   - `GOOGLE_APPLICATION_CREDENTIALS=./credentials.json`
   - `NAMA_DESA`
   - `RUN_HTTP_FALLBACK=0`
5. Upload file `credentials.json` sebagai file pada deploy (atau set secret file sesuai fitur Railway).
6. Deploy. Aplikasi akan jalan di mode cloud (HTTP internal) dan otomatis HTTPS dari Railway.

### Catatan penting deploy
- Folder `uploads/` pada hosting cloud biasanya **tidak permanen**. Untuk produksi, pindahkan penyimpanan foto ke layanan object storage (Cloudinary/S3/R2).
- File konfigurasi deploy untuk Railway sudah disediakan di [railway.json](railway.json).

### Cloudinary untuk foto laporan (disarankan production)
Jika variabel Cloudinary tersedia, upload foto dari form web akan langsung disimpan ke Cloudinary, bukan ke folder lokal.

Tambahkan variabel berikut di Railway:
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`
- `CLOUDINARY_FOLDER` (opsional, contoh: `kkn-sampah`)

### Hak akses admin dashboard
Secara default, warga hanya bisa melihat daftar laporan terbaru. Mengubah status dan menghapus laporan hanya bisa dilakukan oleh admin yang login.

Tambahkan variabel berikut di server atau Railway:
- `ADMIN_PASSWORD` = password admin dashboard
- `ADMIN_SESSION_SECRET` = string acak panjang untuk menandatangani sesi admin

Jika dua variabel ini belum diisi, tombol login admin akan tampil sebagai belum dikonfigurasi dan endpoint edit/hapus otomatis ditolak server.

### Custom domain Railway (URL resmi desa)
1. Buka service Railway kamu > tab **Domains**.
2. Pilih **Custom Domain** lalu masukkan domain/subdomain (contoh: `lapor-sampah.desakamu.id`).
3. Railway akan memberi record DNS yang harus ditambahkan di penyedia domain:
   - biasanya `CNAME` untuk subdomain
   - atau `A/ALIAS` untuk root domain
4. Tambahkan record tersebut di panel DNS domain kamu.
5. Tunggu status domain di Railway menjadi **Active**.

---

## 4. Cara Kerja Bot (untuk warga)

Warga tinggal chat nomor WhatsApp yang dipakai bot, lalu ketik `menu`:
```
1 - Edukasi Sampah
2 - Lapor Sampah / TPS Penuh   (bot minta foto, lalu minta share lokasi)
3 - Jadwal & Info Kebersihan
4 - Kuis Edukasi Sampah
```

Laporan yang masuk (foto + lokasi) otomatis:
- Foto disimpan di folder `uploads/`
- Data (waktu, nomor, deskripsi, lokasi, status) tersimpan ke Google Sheets
- Langsung muncul di peta dashboard sebagai titik merah (belum ditangani)

Perangkat desa bisa buka dashboard, klik titik di peta atau ubah dropdown status di sidebar
jadi "Sedang Ditindaklanjuti" / "Selesai Ditangani" — warna titik di peta ikut berubah.

---

## 5. Struktur Folder

```
kkn-sampah-app/
├── src/
│   ├── bot.js        # logika chatbot WhatsApp
│   ├── server.js      # server dashboard + REST API
│   ├── sheets.js       # koneksi ke Google Sheets
│   └── index.js         # menjalankan bot+server bersamaan
├── public/
│   ├── index.html       # halaman dashboard
│   ├── style.css        # styling dashboard
│   └── app.js            # logika peta Leaflet + fetch data
├── uploads/               # tempat penyimpanan foto laporan warga
├── .env.example
├── package.json
└── README.md
```

---

## 6. Catatan untuk Presentasi/Laporan KKN

- Bot berjalan dengan `whatsapp-web.js` (memakai sesi WhatsApp Web, gratis, tanpa perlu approval Meta Business API) — cocok untuk skala pemakaian di 1 desa.
- Data tersimpan di Google Sheets supaya perangkat desa yang gaptek sekalipun bisa buka & lihat data mentah tanpa perlu paham database.
- Untuk demo ke dosen/penilai: cukup jalankan `npm start`, scan QR sekali, lalu kirim pesan `menu` dari HP lain ke nomor yang dipakai bot.
- Jika WhatsApp yang dipakai untuk bot adalah nomor pribadi, sebaiknya pakai HP/nomor khusus (bukan nomor utama) karena sesi akan tertaut terus ke device.
