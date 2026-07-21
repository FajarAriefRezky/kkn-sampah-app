const ADMIN_STATE = { authenticated: false, enabled: false, username: null };
let allAdminReports = [];
let filteredAdminReports = [];
let adminMap = null;
let adminMarkers = new Map();
let pendingDeleteRow = null;
let pollingTimer = null;
let currentReportPage = 1;
const REPORTS_PER_PAGE = 12;

const $ = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));

function setAdminMessage(message, isError = false) {
  const element = $("adminMessage");
  element.textContent = message;
  element.className = `admin-message ${isError ? "error" : "success"}`;
  element.classList.remove("hidden");
  setTimeout(() => element.classList.add("hidden"), 5000);
}

async function fetchAdminSession() {
  try {
    const response = await fetch("/api/admin/session", { credentials: "same-origin" });
    const data = await response.json();
    ADMIN_STATE.enabled = Boolean(data.enabled);
    ADMIN_STATE.authenticated = Boolean(data.authenticated);
    ADMIN_STATE.username = data.username || null;
    updateAdminUi();
  } catch (error) {
    setAdminMessage("Gagal memeriksa sesi admin.", true);
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const username = $("username").value.trim();
  const password = $("password").value;
  if (!username || !password) return setAdminMessage("Username dan password harus diisi.", true);
  const button = $("loginBtn");
  button.disabled = true;
  button.textContent = "Sedang masuk...";
  try {
    const response = await fetch("/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ username, password }) });
    const data = await response.json();
    if (!response.ok) return setAdminMessage(data.message || "Login gagal.", true);
    ADMIN_STATE.authenticated = true;
    ADMIN_STATE.username = username.toLowerCase();
    $("username").value = ""; $("password").value = "";
    setAdminMessage("Login berhasil.");
    updateAdminUi();
  } catch (error) {
    setAdminMessage("Gagal terhubung ke server.", true);
  } finally {
    button.disabled = false;
    button.textContent = "🔑 Masuk ke Dashboard";
  }
}

async function handleLogout() {
  await fetch("/api/admin/logout", { method: "POST", credentials: "same-origin" }).catch(() => null);
  ADMIN_STATE.authenticated = false;
  ADMIN_STATE.username = null;
  clearInterval(pollingTimer);
  updateAdminUi();
  setAdminMessage("Logout berhasil.");
}

function updateAdminUi() {
  $("loginForm").classList.toggle("hidden", ADMIN_STATE.authenticated);
  $("dashboard").classList.toggle("hidden", !ADMIN_STATE.authenticated);
  if (!ADMIN_STATE.authenticated) return;
  requestAnimationFrame(() => {
    initAdminMap();
    adminMap?.invalidateSize();
    loadReports();
    loadStatusHistory();
  });
  clearInterval(pollingTimer);
  pollingTimer = setInterval(() => loadReports(true), 15000);
}

function resolvePhotoUrl(reference) {
  const value = String(reference || "").trim();
  if (!value || value === "-") return "";
  return /^https?:\/\//i.test(value) ? value : `/uploads/${encodeURIComponent(value)}`;
}

function parseIndonesianDate(value) {
  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) return direct;
  const match = String(value || "").match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\D+(\d{1,2})[.:](\d{2}))?/);
  return match ? new Date(+match[3], +match[2] - 1, +match[1], +(match[4] || 0), +(match[5] || 0)) : null;
}

function initAdminMap() {
  if (adminMap || !window.L || !$("adminMap")) return;
  adminMap = L.map("adminMap").setView([-6.4001, 107.4438], 13);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "&copy; OpenStreetMap" }).addTo(adminMap);
}

function renderAdminMap(reports) {
  initAdminMap();
  if (!adminMap) return;
  adminMarkers.forEach((marker) => marker.remove());
  adminMarkers.clear();
  const bounds = [];
  reports.forEach((report) => {
    if (!Number.isFinite(report.latitude) || !Number.isFinite(report.longitude)) return;
    const isTps = report.sourceType === "TPS";
    const color = isTps ? "#6366f1" : report.status === "Selesai Ditangani" ? "#10b981" : report.status === "Sedang Ditindaklanjuti" ? "#f59e0b" : "#ef4444";
    const marker = L.circleMarker([report.latitude, report.longitude], { radius: 9, color: "#fff", weight: 2, fillColor: color, fillOpacity: .95 })
      .addTo(adminMap).bindPopup(`<strong>${escapeHtml(report.nama || "-")}</strong><br>${escapeHtml(report.status || "TPS")}`);
    adminMarkers.set(`${report.sourceType}-${report.rowNumber}`, marker);
    bounds.push([report.latitude, report.longitude]);
  });
  if (bounds.length) adminMap.fitBounds(bounds, { padding: [24, 24], maxZoom: 15 });
}

function focusReportOnMap(sourceType, rowNumber) {
  const key = `${sourceType}-${rowNumber}`;
  const report = allAdminReports.find((item) => `${item.sourceType}-${item.rowNumber}` === key);
  const marker = adminMarkers.get(key);
  if (!report || !marker) return;
  adminMap.setView([report.latitude, report.longitude], 18, { animate: true });
  marker.openPopup();
  document.querySelectorAll(".report-item").forEach((card) => card.classList.toggle("map-selected", card.dataset.reportKey === key));
  $("adminMap").scrollIntoView({ behavior: "smooth", block: "center" });
}

function renderTrendChart(reports) {
  const chart = $("adminTrendChart");
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 7 }, (_, index) => { const date = new Date(today); date.setDate(date.getDate() - (6 - index)); return { date, count: 0 }; });
  reports.filter((report) => report.sourceType === "Warga").forEach((report) => {
    const date = parseIndonesianDate(report.timestamp); if (!date) return;
    date.setHours(0, 0, 0, 0); const day = days.find((item) => item.date.getTime() === date.getTime()); if (day) day.count++;
  });
  const maximum = Math.max(1, ...days.map((day) => day.count));
  chart.innerHTML = days.map((day) => `<div class="trend-bar-wrap"><span class="trend-value">${day.count}</span><div class="trend-bar" style="height:${Math.max(2, day.count / maximum * 100)}%"></div><span class="trend-label">${day.date.toLocaleDateString("id-ID", { weekday: "short", day: "numeric" })}</span></div>`).join("");
}

function renderStats(reports) {
  const warga = reports.filter((item) => item.sourceType === "Warga");
  const count = (status) => warga.filter((item) => item.status === status).length;
  const values = { total: reports.length, belum: count("Belum Ditangani"), proses: count("Sedang Ditindaklanjuti"), selesai: count("Selesai Ditangani"), tps: reports.filter((item) => item.sourceType === "TPS").length };
  $("dashboardStats").innerHTML = `<div class="dash-stat dash-total"><span>${values.total}</span><small>Total Data</small></div><div class="dash-stat dash-belum"><span>${values.belum}</span><small>Belum Ditangani</small></div><div class="dash-stat dash-proses"><span>${values.proses}</span><small>Sedang Ditangani</small></div><div class="dash-stat dash-selesai"><span>${values.selesai}</span><small>Selesai</small></div><div class="dash-stat dash-tps"><span>${values.tps}</span><small>Titik TPS</small></div>`;
  $("sidebarStats").innerHTML = `<div class="sidebar-stat-row"><span>Total</span><span class="sstat-val">${values.total}</span></div><div class="sidebar-stat-row"><span>Belum</span><span class="sstat-val">${values.belum}</span></div><div class="sidebar-stat-row"><span>Proses</span><span class="sstat-val">${values.proses}</span></div><div class="sidebar-stat-row"><span>Selesai</span><span class="sstat-val">${values.selesai}</span></div>`;
}

function applyFilters(resetPage = true) {
  const search = $("reportSearch").value.trim().toLowerCase();
  const status = $("statusFilter").value;
  const type = $("typeFilter").value;
  filteredAdminReports = allAdminReports.filter((report) => {
    if (type !== "all" && report.sourceType !== type) return false;
    if (status !== "all" && report.status !== status) return false;
    const haystack = [report.nama, report.deskripsi, report.nomorWa, report.latitude, report.longitude, report.timestamp].join(" ").toLowerCase();
    return !search || haystack.includes(search);
  });
  if (resetPage) currentReportPage = 1;
  const totalPages = Math.max(1, Math.ceil(filteredAdminReports.length / REPORTS_PER_PAGE));
  currentReportPage = Math.min(currentReportPage, totalPages);
  $("filterSummary").textContent = `Menampilkan ${filteredAdminReports.length} dari ${allAdminReports.length} data.`;
  const start = (currentReportPage - 1) * REPORTS_PER_PAGE;
  renderReportCards(filteredAdminReports.slice(start, start + REPORTS_PER_PAGE));
  renderPagination(totalPages);
}

function renderPagination(totalPages) {
  const pagination = $("reportPagination");
  pagination.hidden = filteredAdminReports.length <= REPORTS_PER_PAGE;
  if (pagination.hidden) { pagination.innerHTML = ""; return; }
  const pageButtons = [];
  for (let page = 1; page <= totalPages; page++) {
    if (page === 1 || page === totalPages || Math.abs(page - currentReportPage) <= 1) pageButtons.push(`<button type="button" data-page="${page}" class="${page === currentReportPage ? "active" : ""}">${page}</button>`);
    else if (pageButtons[pageButtons.length - 1] !== '<span class="pagination-info">…</span>') pageButtons.push('<span class="pagination-info">…</span>');
  }
  pagination.innerHTML = `<button type="button" data-page="${currentReportPage - 1}" ${currentReportPage === 1 ? "disabled" : ""}>‹</button>${pageButtons.join("")}<button type="button" data-page="${currentReportPage + 1}" ${currentReportPage === totalPages ? "disabled" : ""}>›</button><span class="pagination-info">Halaman ${currentReportPage}/${totalPages}</span>`;
  pagination.querySelectorAll("button[data-page]").forEach((button) => button.addEventListener("click", () => {
    currentReportPage = Number(button.dataset.page);
    applyFilters(false);
    $("reportsSection").scrollIntoView({ behavior: "smooth", block: "start" });
  }));
}

function renderReportCards(reports) {
  if (!reports.length) { $("reportsList").innerHTML = '<div class="empty-state">Tidak ada laporan yang sesuai filter.</div>'; return; }
  $("reportsList").innerHTML = reports.map((report) => {
    const isTps = report.sourceType === "TPS";
    const statusClass = report.status === "Selesai Ditangani" ? "done" : report.status === "Sedang Ditindaklanjuti" ? "process" : "pending";
    const photo = resolvePhotoUrl(report.foto);
    const key = `${report.sourceType}-${report.rowNumber}`;
    const printButton = `<button class="btn-sm btn-print" data-print-key="${key}">Cetak laporan</button>`;
    const actions = isTps ? `<div class="report-actions"><p style="color:#6366f1">Titik TPS terdaftar pada peta publik.</p>${printButton}</div>` : `<div class="report-actions"><select class="status-select-admin" data-status-row="${report.rowNumber}"><option ${report.status === "Belum Ditangani" ? "selected" : ""}>Belum Ditangani</option><option ${report.status === "Sedang Ditindaklanjuti" ? "selected" : ""}>Sedang Ditindaklanjuti</option><option ${report.status === "Selesai Ditangani" ? "selected" : ""}>Selesai Ditangani</option></select>${printButton}<button class="btn-sm btn-delete" data-delete-row="${report.rowNumber}" data-delete-name="${escapeHtml(report.nama || "-")}">Hapus laporan</button></div>`;
    return `<article class="report-item ${isTps ? "tps-card" : `status-${statusClass}`}" data-report-key="${key}" tabindex="0"><h3>${isTps ? "TPS" : "Warga"} · ${escapeHtml(report.nama || "-")}</h3><p><strong>Tipe:</strong> ${isTps ? "TPS / Bank Sampah" : "Laporan Warga"}</p><p><strong>Status:</strong> <span class="status-badge ${statusClass}">${escapeHtml(isTps ? "TPS Terdaftar" : report.status)}</span></p><p><strong>Deskripsi:</strong> ${escapeHtml(report.deskripsi || "-")}</p><p><strong>Lokasi:</strong> ${Number.isFinite(report.latitude) ? `${report.latitude.toFixed(5)}, ${report.longitude.toFixed(5)}` : "-"}</p><p><strong>Tanggal:</strong> ${escapeHtml(report.timestamp || "-")}</p><p><strong>WA:</strong> ${escapeHtml(report.nomorWa || "-")}</p><span class="focus-hint">Klik kartu untuk fokus di peta</span>${photo ? `<img src="${escapeHtml(photo)}" alt="Foto ${escapeHtml(report.nama || "laporan")}">` : ""}${actions}</article>`;
  }).join("");
  document.querySelectorAll(".report-item").forEach((card) => {
    card.addEventListener("click", (event) => { if (!event.target.closest("button,select,a,img")) { const [source, row] = card.dataset.reportKey.split("-"); focusReportOnMap(source, Number(row)); } });
    card.addEventListener("keydown", (event) => { if (event.key === "Enter") { const [source, row] = card.dataset.reportKey.split("-"); focusReportOnMap(source, Number(row)); } });
  });
  document.querySelectorAll("[data-status-row]").forEach((select) => select.addEventListener("change", () => updateReportStatus(select)));
  document.querySelectorAll("[data-delete-row]").forEach((button) => button.addEventListener("click", () => deleteReport(Number(button.dataset.deleteRow), button.dataset.deleteName)));
  document.querySelectorAll("[data-print-key]").forEach((button) => button.addEventListener("click", () => printSingleReport(button.dataset.printKey)));
}

function printSingleReport(key) {
  const report = allAdminReports.find((item) => `${item.sourceType}-${item.rowNumber}` === key);
  if (!report) return;
  const photo = resolvePhotoUrl(report.foto);
  const rows = [
    ["Tipe", report.sourceType === "TPS" ? "TPS / Bank Sampah" : "Laporan Warga"], ["Status", report.status || "TPS Terdaftar"],
    ["Nama", report.nama || "-"], ["Nomor WhatsApp", report.nomorWa || "-"], ["Tanggal laporan", report.timestamp || "-"],
    ["Koordinat", Number.isFinite(report.latitude) ? `${report.latitude}, ${report.longitude}` : "-"], ["Deskripsi", report.deskripsi || "-"],
  ];
  $("printReportSheet").innerHTML = `<header class="print-report-header"><div><h1>Laporan Titik Sampah</h1><small>Sistem Monitoring Sampah Desa</small></div><strong>#${escapeHtml(report.sourceType)}-${report.rowNumber}</strong></header><h2>${escapeHtml(report.nama || "Laporan")}</h2><table class="print-report-meta">${rows.map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join("")}</table>${photo ? `<img class="print-report-photo" src="${escapeHtml(photo)}" alt="Bukti foto laporan">` : ""}<footer class="print-report-footer">Dicetak dari Dashboard Admin Peta Titik TPS pada ${new Date().toLocaleString("id-ID")}.</footer>`;
  document.body.classList.add("print-single-report");
  setTimeout(() => window.print(), photo ? 250 : 0);
}

function updateNewReportBadge(reports, silent) {
  const warga = reports.filter((item) => item.sourceType === "Warga");
  const latest = Math.max(0, ...warga.map((item) => Number(item.rowNumber) || 0));
  const storageKey = "adminLastSeenReportRow";
  const previous = Number(localStorage.getItem(storageKey) || latest);
  const newCount = warga.filter((item) => item.rowNumber > previous).length;
  const badge = $("newReportBadge");
  badge.hidden = newCount === 0;
  badge.textContent = `${newCount} laporan baru`;
  if (!silent || !localStorage.getItem(storageKey)) localStorage.setItem(storageKey, String(latest));
  badge.onclick = () => { localStorage.setItem(storageKey, String(latest)); badge.hidden = true; $("reportsSection").scrollIntoView({ behavior: "smooth" }); };
}

async function loadReports(silent = false) {
  if (!ADMIN_STATE.authenticated) return;
  try {
    const response = await fetch("/api/reports", { credentials: "same-origin" });
    const data = await response.json();
    if (!data.ok) throw new Error(data.message || "Gagal memuat data");
    const warga = (data.reports || []).map((item) => ({ ...item, sourceType: "Warga" }));
    const tps = (data.tps || []).map((item) => ({ ...item, sourceType: "TPS" }));
    allAdminReports = [...warga, ...tps].sort((a, b) => (parseIndonesianDate(b.timestamp)?.getTime() || 0) - (parseIndonesianDate(a.timestamp)?.getTime() || 0));
    renderStats(allAdminReports); renderTrendChart(warga); renderAdminMap(allAdminReports); applyFilters(false); updateNewReportBadge(allAdminReports, silent);
  } catch (error) {
    if (!silent) $("reportsList").innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

async function updateReportStatus(select) {
  const response = await fetch(`/api/reports/${select.dataset.statusRow}/status`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ status: select.value }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { setAdminMessage(data.message || "Gagal memperbarui status.", true); return loadReports(); }
  setAdminMessage("Status laporan berhasil diperbarui.");
  await Promise.all([loadReports(), loadStatusHistory()]);
}

function deleteReport(rowNumber, name = "laporan") {
  pendingDeleteRow = rowNumber;
  $("deleteModalText").textContent = `Laporan “${name}” akan disembunyikan dari dashboard dan peta.`;
  $("deleteModal").hidden = false;
  $("confirmDeleteBtn").focus();
}

async function confirmDeleteReport() {
  if (!pendingDeleteRow) return;
  const response = await fetch(`/api/reports/${pendingDeleteRow}/delete`, { method: "POST", credentials: "same-origin" });
  const data = await response.json().catch(() => ({}));
  $("deleteModal").hidden = true; pendingDeleteRow = null;
  if (!response.ok) return setAdminMessage(data.message || "Gagal menghapus laporan.", true);
  setAdminMessage("Laporan berhasil dihapus."); loadReports();
}

function exportCsv() {
  const quote = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const rows = [["Tipe", "Timestamp", "Nama", "Nomor WA", "Deskripsi", "Latitude", "Longitude", "Status", "Foto"], ...allAdminReports.map((item) => [item.sourceType, item.timestamp, item.nama, item.nomorWa, item.deskripsi, item.latitude, item.longitude, item.status, item.foto])];
  const blob = new Blob(["\ufeff" + rows.map((row) => row.map(quote).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `rekap-laporan-sampah-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(link.href);
}

async function loadStatusHistory() {
  try {
    const response = await fetch("/api/admin/status-history", { credentials: "same-origin" }); const data = await response.json();
    if (!response.ok) throw new Error(data.message);
    $("statusHistory").innerHTML = data.history?.length ? data.history.map((item) => `<div class="history-item"><strong>${escapeHtml(item.reportName)}</strong><br>${escapeHtml(item.oldStatus)} → ${escapeHtml(item.newStatus)}<br><small>${escapeHtml(item.timestamp)} · ${escapeHtml(item.changedBy)}</small></div>`).join("") : '<div class="empty-state">Belum ada perubahan status.</div>';
  } catch (error) { $("statusHistory").innerHTML = '<div class="empty-state">Riwayat belum dapat dimuat.</div>'; }
}

async function submitAccountForm(url, body, form) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  setAdminMessage(data.message || (response.ok ? "Berhasil disimpan." : "Gagal menyimpan."), !response.ok);
  if (response.ok) form.reset();
}

$("loginBtn").addEventListener("click", handleLogin);
$("logoutBtn").addEventListener("click", handleLogout);
$("togglePassword").addEventListener("click", () => { $("password").type = $("password").type === "password" ? "text" : "password"; });
$("reportSearch").addEventListener("input", applyFilters); $("statusFilter").addEventListener("change", applyFilters); $("typeFilter").addEventListener("change", applyFilters); $("exportCsvBtn").addEventListener("click", exportCsv);
$("cancelDeleteBtn").addEventListener("click", () => { $("deleteModal").hidden = true; pendingDeleteRow = null; }); $("confirmDeleteBtn").addEventListener("click", confirmDeleteReport);
document.querySelectorAll("[data-account-tab]").forEach((button) => button.addEventListener("click", () => { document.querySelectorAll("[data-account-tab]").forEach((item) => item.classList.toggle("active", item === button)); $("changePasswordForm").classList.toggle("hidden", button.dataset.accountTab !== "password"); $("newAdminForm").classList.toggle("hidden", button.dataset.accountTab !== "new-admin"); }));
$("changePasswordForm").addEventListener("submit", (event) => { event.preventDefault(); submitAccountForm("/api/admin/change-password", { currentPassword: $("currentPassword").value, newPassword: $("newPassword").value }, event.currentTarget); });
$("newAdminForm").addEventListener("submit", (event) => { event.preventDefault(); submitAccountForm("/api/admin/users", { name: $("newAdminName").value, username: $("newAdminUsername").value, password: $("newAdminPassword").value }, event.currentTarget); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape") $("deleteModal").hidden = true; });
function applyTheme(theme) { const dark = theme === "dark"; document.body.classList.toggle("admin-dark", dark); $("themeToggle").textContent = dark ? "☀ Terang" : "🌙 Gelap"; localStorage.setItem("adminTheme", dark ? "dark" : "light"); setTimeout(() => adminMap?.invalidateSize(), 100); }
$("themeToggle").addEventListener("click", () => applyTheme(document.body.classList.contains("admin-dark") ? "light" : "dark"));
window.addEventListener("afterprint", () => { document.body.classList.remove("print-single-report"); $("printReportSheet").innerHTML = ""; });
applyTheme(localStorage.getItem("adminTheme") || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
fetchAdminSession();
