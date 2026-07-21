// app.js
// Frontend dashboard: ambil data laporan dari API, render peta Leaflet + sidebar
// KKN 2026 - Fajar Arief Rezky - 23416255201230 - IF23E

// === Utility Functions untuk Micro-Interactions ===
function showNotification(message, type = "success", duration = 3000) {
  const notification = document.createElement("div");
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${type === "success" ? "#2e9d56" : "#E63946"};
    color: white;
    padding: 14px 20px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    animation: slideInRight 0.4s ease-out;
    z-index: 1000;
    font-weight: 600;
    max-width: 300px;
  `;
  notification.textContent = message;
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.style.animation = "slideOutRight 0.4s ease-out forwards";
    setTimeout(() => notification.remove(), 400);
  }, duration);
}

function showReportSuccessModal() {
  const modal = document.getElementById("reportSuccessModal");
  const closeButton = document.getElementById("closeSuccessModal");
  if (!modal) return;
  modal.hidden = false;
  document.body.classList.add("modal-open");
  requestAnimationFrame(() => modal.classList.add("is-visible"));
  setTimeout(() => closeButton?.focus(), 250);
}

function closeReportSuccessModal() {
  const modal = document.getElementById("reportSuccessModal");
  if (!modal || modal.hidden) return;
  modal.classList.remove("is-visible");
  document.body.classList.remove("modal-open");
  setTimeout(() => { modal.hidden = true; }, 220);
}

function bindReportSuccessModal() {
  const modal = document.getElementById("reportSuccessModal");
  modal?.querySelectorAll("[data-close-success]").forEach((element) => {
    element.addEventListener("click", closeReportSuccessModal);
  });
  document.getElementById("closeSuccessModal")?.addEventListener("click", closeReportSuccessModal);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modal && !modal.hidden) closeReportSuccessModal();
  });
}

function animateElement(element, animation = "pulse") {
  if (!element) return;
  element.style.animation = `${animation} 0.6s ease-out`;
  setTimeout(() => {
    element.style.animation = "";
  }, 600);
}

const MAX_IMAGE_INPUT_BYTES = 15 * 1024 * 1024;
const IMAGE_COMPRESSION_THRESHOLD = 900 * 1024;
const IMAGE_MAX_DIMENSION = 1600;

function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("FORMAT_FOTO_TIDAK_DIDUKUNG"));
    };
    image.src = objectUrl;
  });
}

async function preparePhotoForUpload(file) {
  if (!file) return null;
  if (!file.type.startsWith("image/")) throw new Error("FILE_BUKAN_GAMBAR");
  if (file.size > MAX_IMAGE_INPUT_BYTES) throw new Error("FOTO_TERLALU_BESAR");
  if (file.size <= IMAGE_COMPRESSION_THRESHOLD) return file;

  const image = await loadImageFile(file);
  const scale = Math.min(1, IMAGE_MAX_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d", { alpha: false });
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.76));
  if (!blob) throw new Error("KOMPRESI_FOTO_GAGAL");
  const baseName = (file.name || "foto-sampah").replace(/\.[^.]+$/, "");
  return new File([blob], `${baseName}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
}

function getPhotoErrorMessage(error) {
  const messages = {
    FILE_BUKAN_GAMBAR: "File yang dipilih bukan gambar.",
    FOTO_TERLALU_BESAR: "Foto terlalu besar. Pilih foto berukuran maksimal 15 MB.",
    FORMAT_FOTO_TIDAK_DIDUKUNG: "Format foto tidak didukung. Gunakan JPG, PNG, atau WebP.",
    KOMPRESI_FOTO_GAGAL: "Foto gagal diproses. Coba gunakan foto lain atau ambil ulang.",
  };
  return messages[error?.message] || "Foto gagal diproses. Coba gunakan foto lain.";
}

function addRippleEffect(event) {
  const button = event.currentTarget;
  const ripple = document.createElement("span");
  const rect = button.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  const x = event.clientX - rect.left - size / 2;
  const y = event.clientY - rect.top - size / 2;
  
  ripple.style.cssText = `
    position: absolute;
    width: ${size}px;
    height: ${size}px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.5);
    left: ${x}px;
    top: ${y}px;
    pointer-events: none;
    animation: ripple 0.6s ease-out;
  `;
  
  button.style.position = "relative";
  button.style.overflow = "hidden";
  button.appendChild(ripple);
  
  setTimeout(() => ripple.remove(), 600);
}

const STATUS_COLOR = {
  "Belum Ditangani": "#C62828",
  "Sedang Ditindaklanjuti": "#F57C00",
  "Selesai Ditangani": "#2E7D32",
};

const STATUS_CLASS = {
  "Belum Ditangani": "belum",
  "Sedang Ditindaklanjuti": "proses",
  "Selesai Ditangani": "selesai",
};

const ADMIN_STATE = {
  authenticated: false,
  enabled: false,
};

let currentTab = "tps"; // track tab yang sedang aktif

let map;
let markers = [];
let locationPickerMarker = null;
let reporterPreviewMarker = null;
let reporterAccuracyCircle = null;
let tpsLocationPickerMarker = null;
let locationPickerActive = false;
let tpsLocationPickerActive = false;

// Data storage untuk laporan terpisah
let allReports = [];
let allTps = [];
let currentReportFilter = "warga"; // 'warga' atau 'tps'
let locationPickerMessageTimer = null;

const defaultTpsPoints = [
  { name: "TPS Pusat Kota", lat: -6.4001, lng: 107.4438, type: "TPS" },
  { name: "TPS Pasar Cikampek", lat: -6.3968, lng: 107.4472, type: "TPS" },
  { name: "TPS Jalan Raya Cikampek", lat: -6.4052, lng: 107.4381, type: "TPS" },
  { name: "TPS Perumahan Cikampek", lat: -6.4105, lng: 107.4518, type: "TPS" },
  { name: "TPS Terminal", lat: -6.3924, lng: 107.4369, type: "TPS" },
];

const MAX_REPORT_ACCURACY_METERS = 50;
const GPS_SAMPLE_TARGET = 4;

function clearReporterLocationPreview() {
  if (reporterPreviewMarker && map) map.removeLayer(reporterPreviewMarker);
  if (reporterAccuracyCircle && map) map.removeLayer(reporterAccuracyCircle);
  reporterPreviewMarker = null;
  reporterAccuracyCircle = null;
}

function showReporterLocation(latitude, longitude, accuracy = null) {
  clearReporterLocationPreview();
  reporterPreviewMarker = L.marker([latitude, longitude], {
    icon: reporterIcon("#2E7D32"),
    draggable: true,
  }).addTo(map).bindPopup("<strong>Geser pin jika titik sampah belum tepat</strong>").openPopup();

  if (Number.isFinite(accuracy) && accuracy > 0) {
    reporterAccuracyCircle = L.circle([latitude, longitude], {
      radius: accuracy,
      color: "#2E7D32",
      fillColor: "#66BB6A",
      fillOpacity: 0.14,
      weight: 2,
      interactive: false,
    }).addTo(map);
  }

  reporterPreviewMarker.on("dragend", (event) => {
    const point = event.target.getLatLng();
    document.getElementById("latitude").value = point.lat.toFixed(6);
    document.getElementById("longitude").value = point.lng.toFixed(6);
    if (reporterAccuracyCircle) reporterAccuracyCircle.setLatLng(point);
    document.getElementById("confirmLocation").checked = false;
    showFormMessage("Marker digeser. Periksa posisinya lalu konfirmasi kembali.");
  });

  const confirmation = document.getElementById("locationConfirmation");
  confirmation.hidden = false;
  document.getElementById("confirmLocation").checked = false;
  document.getElementById("locationAccuracyText").textContent = Number.isFinite(accuracy)
    ? `Akurasi GPS terbaik: ±${Math.round(accuracy)} meter`
    : "Lokasi dipilih manual di peta";
  map.setView([latitude, longitude], 18);
}

function getBestGpsPosition() {
  return new Promise((resolve, reject) => {
    const samples = [];
    let settled = false;
    let watchId;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (watchId !== undefined) navigator.geolocation.clearWatch(watchId);
      if (!samples.length) return reject(new Error("NO_POSITION"));
      samples.sort((a, b) => a.coords.accuracy - b.coords.accuracy);
      resolve(samples[0]);
    };
    const timer = setTimeout(finish, 12000);
    watchId = navigator.geolocation.watchPosition(
      (position) => {
        samples.push(position);
        showFormMessage(`Mencari GPS terbaik... sampel ${samples.length}/${GPS_SAMPLE_TARGET}, akurasi ±${Math.round(position.coords.accuracy)} m`);
        if (position.coords.accuracy <= 20 || samples.length >= GPS_SAMPLE_TARGET) {
          clearTimeout(timer);
          finish();
        }
      },
      (error) => {
        clearTimeout(timer);
        if (!samples.length) reject(error);
        else finish();
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  });
}

function initMap() {
  map = L.map("map", {
    zoomControl: true,
    scrollWheelZoom: true,
    doubleClickZoom: true,
    dragging: true,
  }).setView([-6.4001, 107.4438], 14);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  setTimeout(() => map.invalidateSize(), 250);

  map.on("click", (event) => {
    const { lat, lng } = event.latlng;

    // Handle laporan location picker
    if (locationPickerActive) {
      document.getElementById("latitude").value = lat.toFixed(6);
      document.getElementById("longitude").value = lng.toFixed(6);
      if (locationPickerMarker) {
        map.removeLayer(locationPickerMarker);
        locationPickerMarker = null;
      }
      document.getElementById("locationAccuracy").value = "";
      showReporterLocation(lat, lng, null);
      showFormMessage("Lokasi laporan dipilih. Silakan kirim laporan.");
      setLocationPickerState(false);
    }

    // Handle TPS location picker
    if (tpsLocationPickerActive) {
      document.getElementById("tpsLatitude").value = lat.toFixed(6);
      document.getElementById("tpsLongitude").value = lng.toFixed(6);
      document.getElementById("tpsCoordDisplay").textContent = 
        `Lokasi TPS: ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      if (tpsLocationPickerMarker) {
        map.removeLayer(tpsLocationPickerMarker);
      }
      tpsLocationPickerMarker = L.marker([lat, lng], {
        icon: colorIcon("#1565C0", true),
      }).addTo(map);
      showTpsMessage("Lokasi TPS dipilih. Silakan isi form dan tambahkan TPS.");
      setTpsLocationPickerState(false);
    }
  });
}

function legacyColorIcon(color, isTrash = false) {
  if (!isTrash) {
    return L.divIcon({
      className: "",
      html: `<div style="background:${color};width:16px;height:16px;border-radius:50%;border:2px solid white;box-shadow:0 0 3px rgba(0,0,0,0.5)"></div>`,
      iconSize: [16, 16],
    });
  }

  return L.divIcon({
    className: "",
    html: `<div style="background:${color};width:22px;height:22px;border-radius:4px;border:2px solid white;box-shadow:0 0 3px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;font-size:12px;">🗑️</div>`,
    iconSize: [22, 22],
  });
}

function legacyReporterIcon(color) {
  return L.divIcon({
    className: "",
    html: `<div style="background:${color};width:24px;height:24px;border-radius:50%;border:2px solid #ffffff;box-shadow:0 0 5px rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;font-size:13px;">👤</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -10],
  });
}

// Marker GPS modern untuk TPS, titik pilihan, dan laporan warga.
// Deklarasi ini menggantikan renderer marker lama di atas.
function colorIcon(color, isTrash = false) {
  const type = isTrash ? "tps" : "picked";
  const symbol = isTrash ? "♻" : "⌖";
  return L.divIcon({
    className: `map-marker-wrap map-marker-wrap--${type}`,
    html: `<div class="map-marker map-marker--${type}" style="--marker-color:${color}"><span>${symbol}</span></div>`,
    iconSize: [42, 48],
    iconAnchor: [21, 44],
    popupAnchor: [0, -42],
  });
}

function reporterIcon(color) {
  return L.divIcon({
    className: "map-marker-wrap map-marker-wrap--reporter",
    html: `<div class="map-marker map-marker--reporter" style="--marker-color:${color}"><span>!</span></div>`,
    iconSize: [42, 48],
    iconAnchor: [21, 44],
    popupAnchor: [0, -42],
  });
}

function setAdminMessage(message, isError = false) {
  const el = document.getElementById("adminMessage");
  if (!el) return;
  el.textContent = message;
  el.style.color = isError ? "#C62828" : "#255d2e";
}

function updateAdminUi() {
  const statusText = document.getElementById("adminStatusText");
  const loginForm = document.getElementById("adminLoginForm");
  const actions = document.getElementById("adminActions");

  if (statusText) {
    if (!ADMIN_STATE.enabled) {
      statusText.textContent = "Admin belum dikonfigurasi";
    } else {
      statusText.textContent = ADMIN_STATE.authenticated ? "Mode admin aktif" : "Mode warga aktif";
    }
  }

  if (loginForm) {
    loginForm.classList.toggle("hidden", !ADMIN_STATE.enabled || ADMIN_STATE.authenticated);
  }

  if (actions) {
    actions.classList.toggle("hidden", !ADMIN_STATE.enabled || !ADMIN_STATE.authenticated);
  }
}

async function fetchAdminSession() {
  try {
    const res = await fetch("/api/admin/session", { credentials: "same-origin" });
    const json = await res.json();
    ADMIN_STATE.authenticated = Boolean(json.authenticated);
    ADMIN_STATE.enabled = Boolean(json.enabled);
    updateAdminUi();
  } catch (err) {
    console.error(err);
    ADMIN_STATE.authenticated = false;
    ADMIN_STATE.enabled = false;
    updateAdminUi();
  }
}

async function updateStatus(rowNumber, status) {
  const res = await fetch(`/api/reports/${rowNumber}/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ status }),
  });

  const json = await res.json();
  if (!res.ok || !json.ok) {
    setAdminMessage(json.message || "Hanya admin yang bisa mengubah status.", true);
    if (res.status === 401 || res.status === 403) {
      ADMIN_STATE.authenticated = false;
      updateAdminUi();
    }
    loadReports();
    return;
  }

  setAdminMessage("Status laporan berhasil diperbarui.");
  loadReports();
}

function showFormMessage(message, isError = false) {
  const el = document.getElementById("formMessage");
  el.textContent = message;
  el.style.color = isError ? "#C62828" : "#2E7D32";
}

async function deleteReport(rowNumber) {
  const confirmed = window.confirm("Hapus laporan ini?");
  if (!confirmed) return;

  try {
    const res = await fetch(`/api/reports/${rowNumber}/delete`, {
      method: "POST",
      credentials: "same-origin",
    });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      setAdminMessage(json.message || "Hanya admin yang bisa menghapus laporan.", true);
      if (res.status === 401 || res.status === 403) {
        ADMIN_STATE.authenticated = false;
        updateAdminUi();
      }
      return;
    }
    setAdminMessage("Laporan berhasil dihapus.");
    loadReports();
  } catch (err) {
    console.error(err);
    setAdminMessage("Gagal menghapus laporan.", true);
  }
}

function switchTab(tabName) {
  currentTab = tabName;
  const tpsPanel = document.getElementById("tpsFormPanel");
  const reportPanel = document.getElementById("reportFormPanel");
  const tabTpsBtn = document.getElementById("tabTpsBtn");
  const tabReportBtn = document.getElementById("tabReportBtn");

  if (tabName === "tps") {
    // Tampilkan TPS form, sembunyikan laporan
    tpsPanel.style.display = "block";
    reportPanel.style.display = "none";
    
    // Update button class
    tabTpsBtn.classList.add("active");
    tabReportBtn.classList.remove("active");
  } else {
    // Tampilkan laporan form, sembunyikan TPS
    tpsPanel.style.display = "none";
    reportPanel.style.display = "block";
    
    // Update button class
    tabTpsBtn.classList.remove("active");
    tabReportBtn.classList.add("active");
  }
}

function switchReportFilter(filterType) {
  currentReportFilter = filterType;
  const tabWargaBtn = document.getElementById("tabLaporanWarga");
  const tabTpsBtn = document.getElementById("tabLaporanTps");
  
  if (filterType === "warga") {
    tabWargaBtn.classList.add("active");
    tabTpsBtn.classList.remove("active");
  } else {
    tabWargaBtn.classList.remove("active");
    tabTpsBtn.classList.add("active");
  }
  
  renderReportList();
}

function bindTabButtons() {
  const tabTpsBtn = document.getElementById("tabTpsBtn");
  const tabReportBtn = document.getElementById("tabReportBtn");
  const tabLaporanWargaBtn = document.getElementById("tabLaporanWarga");
  const tabLaporanTpsBtn = document.getElementById("tabLaporanTps");

  tabTpsBtn?.addEventListener("click", () => switchTab("tps"));
  tabReportBtn?.addEventListener("click", () => switchTab("report"));
  tabLaporanWargaBtn?.addEventListener("click", () => switchReportFilter("warga"));
  tabLaporanTpsBtn?.addEventListener("click", () => switchReportFilter("tps"));
}

function bindAdminPanel() {
  const loginForm = document.getElementById("adminLoginForm");
  const logoutBtn = document.getElementById("adminLogoutBtn");

  loginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const passwordInput = document.getElementById("adminPassword");
    const password = passwordInput?.value || "";

    if (!password.trim()) {
      setAdminMessage("Password admin wajib diisi.", true);
      return;
    }

    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ password }),
      });
      const json = await res.json();

      if (!res.ok || !json.ok) {
        setAdminMessage(json.message || "Login admin gagal.", true);
        return;
      }

      ADMIN_STATE.authenticated = true;
      ADMIN_STATE.enabled = true;
      updateAdminUi();
      passwordInput.value = "";
      setAdminMessage("Login admin berhasil.");
      loadReports();
    } catch (err) {
      console.error(err);
      setAdminMessage("Gagal login admin.", true);
    }
  });

  logoutBtn?.addEventListener("click", async () => {
    try {
      await fetch("/api/admin/logout", {
        method: "POST",
        credentials: "same-origin",
      });
    } catch (err) {
      console.error(err);
    }

    ADMIN_STATE.authenticated = false;
    updateAdminUi();
    setAdminMessage("Mode warga aktif kembali.");
    loadReports();
  });
}

function bindAddTpsForm() {
  const form = document.getElementById("addTpsForm");
  if (!form) return;

  const tpsUseMyLocationBtn = document.getElementById("tpsUseMyLocationBtn");
  const tpsPickLocationBtn = document.getElementById("tpsPickLocationBtn");
  const cancelBtn = document.getElementById("cancelAddTpsBtn");

  // Tombol gunakan lokasi saya
  tpsUseMyLocationBtn?.addEventListener("click", () => {
    if (!navigator.geolocation) {
      showTpsMessage("Browser Anda belum mendukung penentuan lokasi otomatis.", true);
      return;
    }

    showTpsMessage("📍 Sedang mencari lokasi Anda...");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;

        if (accuracy > 150) {
          showTpsMessage(
            `Akurasi lokasi masih rendah (${Math.round(accuracy)} m). Coba lagi di tempat terbuka.`,
            true
          );
          return;
        }

        document.getElementById("tpsLatitude").value = latitude.toFixed(6);
        document.getElementById("tpsLongitude").value = longitude.toFixed(6);
        document.getElementById("tpsCoordDisplay").textContent = 
          `📍 Lokasi Anda: ${latitude.toFixed(4)}, ${longitude.toFixed(4)} (akurasi ${Math.round(accuracy)} m)`;
        showTpsMessage("✅ Lokasi TPS Anda terdeteksi. Silakan isi nama TPS dan tambahkan.");
      },
      (error) => {
        const messages = {
          1: "Akses lokasi ditolak. Izinkan akses lokasi di browser Anda.",
          2: "Sinyal lokasi tidak tersedia saat ini. Coba lagi atau gunakan tombol pilih di peta.",
          3: "Waktu pencarian lokasi habis. Coba lagi atau gunakan tombol pilih di peta.",
        };
        showTpsMessage(messages[error.code] || "Gagal mengambil lokasi.", true);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });

  // Tombol pilih di peta
  tpsPickLocationBtn?.addEventListener("click", () => {
    setTpsLocationPickerState(!tpsLocationPickerActive);
    if (tpsLocationPickerActive) {
      showTpsMessage("🗺️ Klik titik di peta untuk memilih lokasi TPS Anda.");
    }
  });

  // Tombol bersihkan form
  cancelBtn?.addEventListener("click", () => {
    form.reset();
    document.getElementById("tpsCoordDisplay").textContent = "Klik salah satu tombol di atas untuk mendapatkan koordinat";
    showTpsMessage("");
  });

  // Submit form TPS
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const tpsName = document.getElementById("tpsName").value.trim();
    const tpsNomorWa = document.getElementById("tpsNomorWa").value.trim();
    const tpsDeskripsi = document.getElementById("tpsDeskripsi").value.trim();
    const tpsLat = document.getElementById("tpsLatitude").value.trim();
    const tpsLng = document.getElementById("tpsLongitude").value.trim();

    if (!tpsName || !tpsNomorWa || !tpsLat || !tpsLng) {
      showTpsMessage("Nama TPS, nomor WA, dan koordinat wajib diisi.", true);
      return;
    }

    const formData = new FormData();
    formData.append("nama", tpsName);
    formData.append("nomorWa", tpsNomorWa);
    formData.append("deskripsi", tpsDeskripsi);
    formData.append("latitude", tpsLat);
    formData.append("longitude", tpsLng);

    const tpsFotoInput = document.getElementById("tpsFoto");
    if (tpsFotoInput.files[0]) {
      formData.append("foto", tpsFotoInput.files[0]);
    }

    try {
      const res = await fetch("/api/tps", {
        method: "POST",
        body: formData,
      });
      const json = await res.json();

      if (!res.ok || !json.ok) {
        showTpsMessage(json.message || "Gagal menambahkan TPS.", true);
        return;
      }

      showTpsMessage("✅ TPS berhasil ditambahkan! Terima kasih telah melaporkan. 🎉");
      form.reset();
      document.getElementById("tpsCoordDisplay").textContent = "Klik salah satu tombol di atas untuk mendapatkan koordinat";

      // Reload data peta
      setTimeout(() => {
        loadReports();
      }, 2000);
    } catch (err) {
      console.error(err);
      showTpsMessage("Gagal menambahkan TPS. Coba lagi.", true);
    }
  });
}

function setLocationPickerState(active) {
  locationPickerActive = active;
  const pickBtn = document.getElementById("pickLocationBtn");
  if (pickBtn) {
    pickBtn.textContent = active ? "🗺️ Klik peta sekarang" : "🗺️ Pilih lokasi di peta";
    pickBtn.style.background = active ? "#e8f5e9" : "#f1f8e9";
    pickBtn.style.borderColor = active ? "#2e7d32" : "#ccc";
  }

  if (locationPickerMessageTimer) {
    clearTimeout(locationPickerMessageTimer);
  }

  if (!active) {
    showFormMessage("Silakan lanjutkan mengisi form atau kirim laporan.");
  }
}

function setTpsLocationPickerState(active) {
  tpsLocationPickerActive = active;
  const pickBtn = document.getElementById("tpsPickLocationBtn");
  if (pickBtn) {
    pickBtn.textContent = active ? "🗺️ Klik peta sekarang" : "🗺️ Pilih di peta";
    pickBtn.style.background = active ? "#e8f5e9" : "#f1f8e9";
    pickBtn.style.borderColor = active ? "#2e7d32" : "#ccc";
  }

  if (!active) {
    document.getElementById("addTpsMessage").textContent = "";
  }
}

function showTpsMessage(message, isError = false) {
  const el = document.getElementById("addTpsMessage");
  el.textContent = message;
  el.style.color = isError ? "#C62828" : "#2E7D32";
}

function bindReportForm() {
  const form = document.getElementById("reportForm");
  if (!form) return;

  const useMyLocationBtn = document.getElementById("useMyLocationBtn");
  const pickLocationBtn = document.getElementById("pickLocationBtn");
  const addTpsBtn = document.getElementById("addTpsBtn");

  useMyLocationBtn?.addEventListener("click", async () => {
    if (!navigator.geolocation) {
      showFormMessage("Browser Anda belum mendukung penentuan lokasi otomatis.", true);
      return;
    }

    showFormMessage("Mengambil beberapa sampel GPS. Pastikan Anda berada di tempat terbuka...");
    useMyLocationBtn.disabled = true;
    try {
        const position = await getBestGpsPosition();
        const { latitude, longitude, accuracy } = position.coords;

        if (accuracy > MAX_REPORT_ACCURACY_METERS) {
          showFormMessage(
            `Akurasi terbaik masih ±${Math.round(accuracy)} m. Maksimal ${MAX_REPORT_ACCURACY_METERS} m. Coba lagi di tempat terbuka atau pilih lokasi di peta.`,
            true
          );
          return;
        }

        document.getElementById("latitude").value = latitude.toFixed(6);
        document.getElementById("longitude").value = longitude.toFixed(6);
        document.getElementById("locationAccuracy").value = accuracy.toFixed(1);
        showReporterLocation(latitude, longitude, accuracy);
        showFormMessage(`Lokasi diterima dengan akurasi terbaik ±${Math.round(accuracy)} m. Geser bila perlu lalu konfirmasi.`);
    } catch (error) {
        const messages = {
          1: "Akses lokasi ditolak. Izinkan akses lokasi di browser lalu coba lagi.",
          2: "Sinyal lokasi tidak tersedia saat ini. Coba lagi atau pilih lokasi di peta.",
          3: "Waktu pencarian lokasi habis. Coba lagi atau pilih lokasi di peta.",
        };
        showFormMessage(messages[error.code] || "Gagal mengambil lokasi. Coba pilih lokasi di peta.", true);
    } finally {
      useMyLocationBtn.disabled = false;
    }
  });

  pickLocationBtn?.addEventListener("click", () => {
    setLocationPickerState(!locationPickerActive);
    if (locationPickerActive) {
      showFormMessage("🗺️ Klik titik di peta untuk memilih lokasi laporan.");
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!document.getElementById("confirmLocation").checked) {
      showFormMessage("Periksa marker di peta dan centang konfirmasi lokasi sebelum mengirim.", true);
      return;
    }
    const formData = new FormData();
    formData.append("nama", document.getElementById("nama").value.trim());
    formData.append("nomorWa", document.getElementById("nomorWa").value.trim());
    formData.append("deskripsi", document.getElementById("deskripsi").value.trim());
    formData.append("latitude", document.getElementById("latitude").value.trim());
    formData.append("longitude", document.getElementById("longitude").value.trim());
    formData.append("accuracy", document.getElementById("locationAccuracy").value.trim());
    const fotoInput = document.getElementById("foto");
    if (fotoInput.files[0]) {
      try {
        showFormMessage("Mengoptimalkan foto sebelum dikirim...");
        const optimizedPhoto = await preparePhotoForUpload(fotoInput.files[0]);
        formData.append("foto", optimizedPhoto, optimizedPhoto.name);
      } catch (photoError) {
        showFormMessage(getPhotoErrorMessage(photoError), true);
        return;
      }
    }

    try {
      showFormMessage("Mengirim laporan, mohon tunggu...");
      const res = await fetch("/api/reports", {
        method: "POST",
        body: formData,
      });
      const responseText = await res.text();
      let json;
      try {
        json = JSON.parse(responseText);
      } catch (_) {
        const uploadTooLarge = res.status === 413 || /too large|payload/i.test(responseText);
        showFormMessage(uploadTooLarge
          ? "Ukuran foto masih terlalu besar untuk dikirim. Coba pilih foto lain."
          : "Server tidak dapat menerima foto saat ini. Coba lagi beberapa saat.", true);
        return;
      }
      if (!res.ok || !json.ok) {
        showFormMessage(json.message || "Gagal mengirim laporan.", true);
        return;
      }

      showFormMessage("Laporan berhasil dikirim.");
      showReportSuccessModal();
      form.reset();
      document.getElementById("locationConfirmation").hidden = true;
      clearReporterLocationPreview();
      loadReports();
    } catch (err) {
      console.error(err);
      showFormMessage("Gagal mengirim laporan. Coba lagi.", true);
    }
  });
}

function renderStats(reports) {
  document.getElementById("statTotal").textContent = reports.length;
  document.getElementById("statBelum").textContent = reports.filter(
    (r) => r.status === "Belum Ditangani"
  ).length;
  document.getElementById("statProses").textContent = reports.filter(
    (r) => r.status === "Sedang Ditindaklanjuti"
  ).length;
  document.getElementById("statSelesai").textContent = reports.filter(
    (r) => r.status === "Selesai Ditangani"
  ).length;
}

function parseReportDate(value) {
  if (!value) return null;
  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) return direct;

  const match = String(value).match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\D+(\d{1,2})[.:](\d{2})(?:[.:](\d{2}))?)?/);
  if (!match) return null;
  const parsed = new Date(
    Number(match[3]), Number(match[2]) - 1, Number(match[1]),
    Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0)
  );
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfWeek(date) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = result.getDay() || 7;
  result.setDate(result.getDate() - day + 1);
  result.setHours(0, 0, 0, 0);
  return result;
}

function buildWeeklyReportData(reports) {
  const currentWeek = startOfWeek(new Date());
  const weeks = Array.from({ length: 6 }, (_, index) => {
    const start = new Date(currentWeek);
    start.setDate(start.getDate() - (5 - index) * 7);
    return { start, count: 0 };
  });

  reports.forEach((report) => {
    const reportDate = parseReportDate(report.timestamp);
    if (!reportDate) return;
    const reportWeek = startOfWeek(reportDate).getTime();
    const bucket = weeks.find((week) => week.start.getTime() === reportWeek);
    if (bucket) bucket.count += 1;
  });
  return weeks;
}

function renderWeeklyChart(reports) {
  const canvas = document.getElementById("weeklyReportChart");
  if (!canvas) return;
  const weeks = buildWeeklyReportData(reports);
  const total = weeks.reduce((sum, week) => sum + week.count, 0);
  document.getElementById("weeklyTotal").textContent = total;
  document.getElementById("chartEmpty").hidden = total !== 0;

  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(canvas.clientWidth, 300);
  const height = Math.max(canvas.clientHeight, 220);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext("2d");
  context.scale(ratio, ratio);
  context.clearRect(0, 0, width, height);

  const margin = { top: 18, right: 16, bottom: 44, left: 38 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const maxValue = Math.max(4, ...weeks.map((week) => week.count));
  const gridStep = Math.max(1, Math.ceil(maxValue / 4));
  const gridMax = Math.ceil(maxValue / gridStep) * gridStep;

  context.font = "12px Segoe UI, sans-serif";
  context.textBaseline = "middle";
  for (let value = 0; value <= gridMax; value += gridStep) {
    const y = margin.top + chartHeight - (value / gridMax) * chartHeight;
    context.strokeStyle = "#e5eee8";
    context.lineWidth = 1;
    context.beginPath(); context.moveTo(margin.left, y); context.lineTo(width - margin.right, y); context.stroke();
    context.fillStyle = "#7b8980";
    context.textAlign = "right";
    context.fillText(String(value), margin.left - 10, y);
  }

  const slotWidth = chartWidth / weeks.length;
  const barWidth = Math.min(58, slotWidth * .54);
  weeks.forEach((week, index) => {
    const barHeight = (week.count / gridMax) * chartHeight;
    const x = margin.left + index * slotWidth + (slotWidth - barWidth) / 2;
    const y = margin.top + chartHeight - barHeight;
    const gradient = context.createLinearGradient(0, y, 0, margin.top + chartHeight);
    gradient.addColorStop(0, "#39a45d"); gradient.addColorStop(1, "#1f5f2b");
    context.fillStyle = gradient;
    context.beginPath();
    if (context.roundRect) context.roundRect(x, y, barWidth, Math.max(barHeight, 2), [7, 7, 2, 2]);
    else context.rect(x, y, barWidth, Math.max(barHeight, 2));
    context.fill();

    if (week.count > 0) {
      context.fillStyle = "#245b33"; context.font = "700 12px Segoe UI, sans-serif"; context.textAlign = "center";
      context.fillText(String(week.count), x + barWidth / 2, y - 10);
    }
    context.fillStyle = "#66736a"; context.font = "11px Segoe UI, sans-serif"; context.textAlign = "center";
    context.fillText(week.start.toLocaleDateString("id-ID", { day: "numeric", month: "short" }), x + barWidth / 2, height - 19);
  });
}

function initCampaignPoster() {
  const qrContainer = document.getElementById("campaignQr");
  if (!qrContainer) return;
  const campaignUrl = `${window.location.origin}${window.location.pathname}`;
  document.getElementById("campaignUrl").textContent = campaignUrl;
  if (window.QRCode) {
    new QRCode(qrContainer, { text: campaignUrl, width: 240, height: 240, colorDark: "#123d24", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.H });
  } else {
    qrContainer.textContent = "QR tidak dapat dimuat";
  }
  document.getElementById("printPosterBtn").addEventListener("click", () => {
    document.body.classList.add("printing-poster");
    window.print();
  });
  window.addEventListener("afterprint", () => document.body.classList.remove("printing-poster"));
}

function resolvePhotoUrl(photoRef) {
  if (!photoRef) return "";

  const normalizedPhotoRef = String(photoRef).trim();
  if (!normalizedPhotoRef || normalizedPhotoRef === "-") return "";
  if (/^https?:\/\//i.test(normalizedPhotoRef)) return normalizedPhotoRef;

  return `/uploads/${encodeURIComponent(normalizedPhotoRef)}`;
}

function renderReportList() {
  const list = document.getElementById("reportList");
  list.innerHTML = "";

  // Filter data based on currentReportFilter
  let filteredData = currentReportFilter === "warga" ? allReports : allTps;

  if (filteredData.length === 0) {
    const filterLabel = currentReportFilter === "warga" ? "Laporan Warga" : "Laporan TPS";
    list.innerHTML = `<p>Belum ada ${filterLabel} masuk.</p>`;
    return;
  }

  filteredData
    .slice()
    .reverse()
    .forEach((r) => {
      const div = document.createElement("div");
      const isTps = r.type === "TPS" || r.status === "TPS" || currentReportFilter === "tps";
      div.className = "report-item" + (isTps ? " tps-item" : "");
      const photoUrl = resolvePhotoUrl(r.foto);
      const title = r.nama || r.name || (isTps ? "TPS" : "Laporan");
      const description = r.deskripsi || r.description || "-";

      if (isTps) {
        div.innerHTML = `
          <strong>${title}</strong> — ${r.timestamp || "-"}<br/>
          ${description}
          <div class="badge" style="background:linear-gradient(135deg,#1565C0,#1976D2);">📍 TPS</div><br/>
          ${r.nomorWa ? `<small class="field-hint">📞 WA: ${r.nomorWa}</small><br/>` : ""}
          <small class="field-hint">📌 Koordinat: ${r.latitude}, ${r.longitude}</small><br/>
          ${photoUrl ? `<img src="${photoUrl}" alt="foto TPS"/>` : ""}
        `;
      } else {
        const cls = STATUS_CLASS[r.status] || "belum";
        div.innerHTML = `
          <strong>${title}</strong> — ${r.timestamp}<br/>
          ${description}
          <div class="badge ${cls}">${r.status}</div><br/>
          ${Number.isFinite(r.accuracy) ? `<small class="field-hint">Akurasi GPS: ±${Math.round(r.accuracy)} meter</small><br/>` : ""}
          ${photoUrl ? `<img src="${photoUrl}" alt="foto laporan"/>` : ""}
          ${
            ADMIN_STATE.authenticated
              ? `
                <select class="status-select" data-row="${r.rowNumber}">
                  <option ${r.status === "Belum Ditangani" ? "selected" : ""}>Belum Ditangani</option>
                  <option ${r.status === "Sedang Ditindaklanjuti" ? "selected" : ""}>Sedang Ditindaklanjuti</option>
                  <option ${r.status === "Selesai Ditangani" ? "selected" : ""}>Selesai Ditangani</option>
                </select>
                <div class="report-actions">
                  <button class="delete-btn" type="button" data-row="${r.rowNumber}">Hapus</button>
                </div>
              `
              : `<p class="field-hint">Warga hanya dapat melihat laporan terbaru.</p>`
          }
        `;

        if (ADMIN_STATE.authenticated) {
          div.querySelector(".status-select").addEventListener("change", (e) => {
            updateStatus(r.rowNumber, e.target.value);
          });
          div.querySelector(".delete-btn").addEventListener("click", () => {
            deleteReport(r.rowNumber);
          });
        }
      }

      list.appendChild(div);
    });
}

function renderMarkers(reports) {
  markers.forEach((m) => map.removeLayer(m));
  markers = [];

  const allPoints = [
    ...defaultTpsPoints.map((point) => ({
      ...point,
      status: "TPS",
      name: point.name,
      description: "Titik TPS yang ditandai sebagai referensi lokasi sampah.",
    })),
    ...reports,
  ];

  allPoints.forEach((item, index) => {
    const isTrashMarker = item.type === "TPS" || item.status === "TPS";
    const color = isTrashMarker ? "#1565C0" : STATUS_COLOR[item.status] || "#C62828";

    const marker = isTrashMarker
      ? L.marker([item.latitude || item.lat, item.longitude || item.lng], {
          icon: colorIcon(color, true),
        }).addTo(map)
      : L.marker([item.latitude || item.lat, item.longitude || item.lng], {
          icon: reporterIcon(color),
        }).addTo(map);

    const markerElement = marker.getElement();
    if (markerElement) {
      markerElement.style.setProperty("--marker-delay", `${Math.min(index * 0.08, 0.8)}s`);
    }

    const photoUrl = resolvePhotoUrl(item.foto);
    marker.bindPopup(`
      <strong>${item.name || item.nama}</strong><br/>
      ${item.description || item.deskripsi || ""}<br/>
      ${item.status && item.status !== "TPS" ? `<em>${item.status}</em><br/>` : ""}
      ${Number.isFinite(item.accuracy) ? `Akurasi GPS: ±${Math.round(item.accuracy)} meter<br/>` : ""}
      ${item.timestamp ? item.timestamp : ""}
      ${photoUrl ? `<br/><img src="${photoUrl}" style="width:150px;border-radius:6px;margin-top:6px"/>` : ""}
    `);

    markers.push(marker);
  });
}

async function loadReports() {
  try {
    const res = await fetch("/api/reports");
    const json = await res.json();
    if (!json.ok) {
      document.getElementById("desaName").textContent = json.message;
      return;
    }
    document.getElementById("desaName").textContent = json.desa;
    
    // Store data separately
    allReports = json.reports || [];
    allTps = json.tps || [];
    
    // For markers and stats, show both
    const allData = [...allReports, ...allTps];
    renderStats(allReports);
    renderWeeklyChart(allReports);
    renderReportList();  // Filtered based on currentReportFilter
    renderMarkers(allData);
  } catch (err) {
    console.error(err);
    document.getElementById("desaName").textContent =
      "Gagal memuat data. Pastikan server backend menyala.";
  }
}

initMap();
initCampaignPoster();
bindReportSuccessModal();
bindTabButtons();
bindReportForm();
bindAddTpsForm();
bindAdminPanel();
fetchAdminSession();
loadReports();
setInterval(loadReports, 15000);
window.addEventListener("resize", () => renderWeeklyChart(allReports));
