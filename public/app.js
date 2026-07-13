// app.js
// Frontend dashboard: ambil data laporan dari API, render peta Leaflet + sidebar
// KKN 2026 - Fajar Arief Rezky - 23416255201230 - IF23E

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
      }
      locationPickerMarker = L.marker([lat, lng], {
        icon: colorIcon("#E65100"),
      }).addTo(map);
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

function colorIcon(color, isTrash = false) {
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

function reporterIcon(color) {
  return L.divIcon({
    className: "",
    html: `<div style="background:${color};width:24px;height:24px;border-radius:50%;border:2px solid #ffffff;box-shadow:0 0 5px rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;font-size:13px;">👤</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -10],
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
    
    // Update button style
    tabTpsBtn.style.background = "#1565C0";
    tabTpsBtn.style.color = "white";
    tabReportBtn.style.background = "#ddd";
    tabReportBtn.style.color = "#333";
  } else {
    // Tampilkan laporan form, sembunyikan TPS
    tpsPanel.style.display = "none";
    reportPanel.style.display = "block";
    
    // Update button style
    tabTpsBtn.style.background = "#ddd";
    tabTpsBtn.style.color = "#333";
    tabReportBtn.style.background = "#2E7D32";
    tabReportBtn.style.color = "white";
  }
}

function switchReportFilter(filterType) {
  currentReportFilter = filterType;
  const tabWargaBtn = document.getElementById("tabLaporanWarga");
  const tabTpsBtn = document.getElementById("tabLaporanTps");
  
  if (filterType === "warga") {
    tabWargaBtn.style.background = "#2E7D32";
    tabWargaBtn.style.color = "white";
    tabTpsBtn.style.background = "#ddd";
    tabTpsBtn.style.color = "#333";
  } else {
    tabWargaBtn.style.background = "#ddd";
    tabWargaBtn.style.color = "#333";
    tabTpsBtn.style.background = "#1565C0";
    tabTpsBtn.style.color = "white";
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

  useMyLocationBtn?.addEventListener("click", () => {
    if (!navigator.geolocation) {
      showFormMessage("Browser Anda belum mendukung penentuan lokasi otomatis.", true);
      return;
    }

    showFormMessage("Sedang mencari lokasi Anda. Pastikan Anda berada di tempat terbuka...");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;

        if (accuracy > 150) {
          showFormMessage(
            `Akurasi lokasi masih rendah (${Math.round(accuracy)} m). Coba lagi di tempat terbuka atau pilih lokasi di peta.`,
            true
          );
          return;
        }

        document.getElementById("latitude").value = latitude.toFixed(6);
        document.getElementById("longitude").value = longitude.toFixed(6);
        showFormMessage(`Lokasi Anda terdeteksi dengan akurasi ${Math.round(accuracy)} m.`);

        if (reporterPreviewMarker) {
          map.removeLayer(reporterPreviewMarker);
        }
        reporterPreviewMarker = L.marker([latitude, longitude], {
          icon: reporterIcon("#2E7D32"),
        })
          .addTo(map)
          .bindPopup("<strong>Posisi pelapor terdeteksi</strong>")
          .openPopup();

        if (map) {
          map.setView([latitude, longitude], 17);
        }
      },
      (error) => {
        const messages = {
          1: "Akses lokasi ditolak. Izinkan akses lokasi di browser lalu coba lagi.",
          2: "Sinyal lokasi tidak tersedia saat ini. Coba lagi atau pilih lokasi di peta.",
          3: "Waktu pencarian lokasi habis. Coba lagi atau pilih lokasi di peta.",
        };
        showFormMessage(messages[error.code] || "Gagal mengambil lokasi. Coba pilih lokasi di peta.", true);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });

  pickLocationBtn?.addEventListener("click", () => {
    setLocationPickerState(!locationPickerActive);
    if (locationPickerActive) {
      showFormMessage("🗺️ Klik titik di peta untuk memilih lokasi laporan.");
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData();
    formData.append("nama", document.getElementById("nama").value.trim());
    formData.append("nomorWa", document.getElementById("nomorWa").value.trim());
    formData.append("deskripsi", document.getElementById("deskripsi").value.trim());
    formData.append("latitude", document.getElementById("latitude").value.trim());
    formData.append("longitude", document.getElementById("longitude").value.trim());
    const fotoInput = document.getElementById("foto");
    if (fotoInput.files[0]) {
      formData.append("foto", fotoInput.files[0]);
    }

    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        body: formData,
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        showFormMessage(json.message || "Gagal mengirim laporan.", true);
        return;
      }

      showFormMessage("Laporan berhasil dikirim.");
      form.reset();
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
      div.className = "report-item";
      const cls = STATUS_CLASS[r.status] || "belum";
      const photoUrl = resolvePhotoUrl(r.foto);
      div.innerHTML = `
        <strong>${r.nama}</strong> — ${r.timestamp}<br/>
        ${r.deskripsi}
        <div class="badge ${cls}">${r.status}</div><br/>
        ${
          photoUrl
            ? `<img src="${photoUrl}" alt="foto laporan"/>`
            : ""
        }
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

  allPoints.forEach((item) => {
    const color = item.status === "TPS" ? "#1565C0" : STATUS_COLOR[item.status] || "#C62828";
    const isTrashMarker = item.status === "TPS";

    const marker = isTrashMarker
      ? L.marker([item.latitude || item.lat, item.longitude || item.lng], {
          icon: colorIcon(color, true),
        }).addTo(map)
      : L.marker([item.latitude || item.lat, item.longitude || item.lng], {
          icon: reporterIcon(color),
        }).addTo(map);

    const photoUrl = resolvePhotoUrl(item.foto);
    marker.bindPopup(`
      <strong>${item.name || item.nama}</strong><br/>
      ${item.description || item.deskripsi || ""}<br/>
      ${item.status && item.status !== "TPS" ? `<em>${item.status}</em><br/>` : ""}
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
    renderStats(allData);
    renderReportList();  // Filtered based on currentReportFilter
    renderMarkers(allData);
  } catch (err) {
    console.error(err);
    document.getElementById("desaName").textContent =
      "Gagal memuat data. Pastikan server backend menyala.";
  }
}

initMap();
bindTabButtons();
bindReportForm();
bindAddTpsForm();
bindAdminPanel();
fetchAdminSession();
loadReports();
setInterval(loadReports, 15000);
