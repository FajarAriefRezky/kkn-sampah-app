<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Peta Titik TPS</title>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <style>
        :root { --green:#2E7D32; --green-light:#E8F5E9; --orange:#F57C00; --red:#C62828; --gray:#555; }
        * { box-sizing: border-box; }
        body { margin:0; font-family:Segoe UI, Roboto, Arial, sans-serif; color:#222; background:#f5f7f5; }
        .topbar { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; background:var(--green); color:white; padding:16px 24px; }
        .topbar h1 { margin:0 0 4px 0; font-size:1.3rem; }
        .topbar p { margin:0; font-size:0.85rem; opacity:0.9; }
        .stats { display:flex; gap:10px; flex-wrap:wrap; }
        .stat-card { background:rgba(255,255,255,0.15); border-radius:8px; padding:8px 14px; text-align:center; min-width:90px; }
        .stat-card span { display:block; font-size:1.4rem; font-weight:bold; }
        .stat-card small { font-size:0.7rem; opacity:0.9; }
        .stat-card.belum { background:rgba(198,40,40,0.35); }
        .stat-card.proses { background:rgba(245,124,0,0.35); }
        .stat-card.selesai { background:rgba(46,125,50,0.5); }
        main { display:flex; height:calc(100vh - 90px); }
        #map { flex:1; height:100%; }
        #sidebar { width:320px; background:white; border-left:1px solid #ddd; padding:16px; overflow-y:auto; }
        #sidebar h2 { font-size:1rem; margin-top:0; color:var(--green); }
        .panel { border:1px solid #e0e0e0; border-radius:10px; padding:10px; margin-bottom:12px; background:#fafdfa; }
        .report-form { display:flex; flex-direction:column; gap:6px; }
        .report-form label { font-size:0.8rem; font-weight:600; }
        .field-hint { font-size:0.72rem; color:#666; margin-top:-2px; }
        .location-actions { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:4px; }
        .location-actions button { flex:1; padding:7px 8px; border-radius:6px; border:1px solid #ccc; background:#f1f8e9; cursor:pointer; }
        .report-form input, .report-form textarea, .report-form button { padding:8px; border-radius:6px; border:1px solid #ccc; font:inherit; }
        .report-form button { background:var(--green); color:white; border:none; cursor:pointer; margin-top:4px; }
        .form-message { min-height:1.2rem; font-size:0.8rem; margin:0; }
        .report-item { border:1px solid #e0e0e0; border-radius:8px; padding:10px; margin-bottom:10px; font-size:0.85rem; }
        .report-item img { width:100%; border-radius:6px; margin-top:6px; }
        .report-actions { margin-top:6px; }
        .delete-btn { padding:6px 8px; border:1px solid #c62828; border-radius:6px; background:#ffebee; color:#c62828; cursor:pointer; font-size:0.8rem; }
        .badge { display:inline-block; padding:2px 8px; border-radius:12px; font-size:0.7rem; color:white; margin-top:4px; }
        .badge.belum { background:var(--red); }
        .badge.proses { background:var(--orange); }
        .badge.selesai { background:var(--green); }
        select.status-select { margin-top:6px; width:100%; padding:4px; border-radius:6px; border:1px solid #ccc; }
        footer { text-align:center; font-size:0.75rem; color:var(--gray); padding:8px; background:#eee; }
        @media (max-width: 900px) { main { flex-direction:column; height:auto;} #map { height:60vh; min-height:320px;} #sidebar { width:100%; border-left:none; border-top:1px solid #ddd; } }
        @media (max-width: 600px) { .topbar { padding:12px 14px; } .topbar h1 { font-size:1.05rem; } .stats { width:100%; } .stat-card { flex:1 1 calc(50% - 6px); min-width:0; } .location-actions { flex-direction:column;} .location-actions button { width:100%; } .report-form input, .report-form textarea, .report-form button { font-size:16px; } }
    </style>
</head>
<body>
<header class="topbar">
    <div>
        <h1>🗺️ Peta Titik TPS</h1>
        <p id="desaName">Memuat data desa...</p>
    </div>
    <div class="stats" id="stats">
        <div class="stat-card"><span id="statTotal">0</span><small>Total Laporan</small></div>
        <div class="stat-card belum"><span id="statBelum">0</span><small>Belum Ditangani</small></div>
        <div class="stat-card proses"><span id="statProses">0</span><small>Sedang Ditindaklanjuti</small></div>
        <div class="stat-card selesai"><span id="statSelesai">0</span><small>Selesai</small></div>
    </div>
</header>
<main>
    <div id="map"></div>
    <aside id="sidebar">
        <section class="panel">
            <h2>Form Laporan Warga</h2>
            <form id="reportForm" class="report-form" enctype="multipart/form-data">
                <label>Nama</label>
                <input type="text" id="nama" name="nama" required />
                <label>Nomor WA</label>
                <input type="text" id="nomorWa" name="nomorWa" placeholder="Contoh: 628123456789" required />
                <label>Deskripsi</label>
                <textarea id="deskripsi" name="deskripsi" rows="3" required></textarea>
                <div class="location-actions">
                    <button type="button" id="useMyLocationBtn">Gunakan lokasi saya</button>
                    <button type="button" id="pickLocationBtn">Pilih lokasi di peta</button>
                </div>
                <label>Koordinat lokasi (garis lintang)</label>
                <input type="text" id="latitude" name="latitude" placeholder="Contoh: -6.4001" required />
                <label>Koordinat lokasi (garis bujur)</label>
                <input type="text" id="longitude" name="longitude" placeholder="Contoh: 107.4438" required />
                <small class="field-hint">Kalau belum tahu, tekan tombol di atas untuk pakai lokasi Anda atau pilih titik di peta.</small>
                <label>Foto (opsional)</label>
                <input type="file" id="foto" name="foto" accept="image/*" />
                <button type="submit">Kirim Laporan</button>
                <p id="formMessage" class="form-message"></p>
            </form>
        </section>
        <section class="panel">
            <h2>Daftar Laporan Terbaru</h2>
            <div id="reportList"></div>
        </section>
    </aside>
</main>
<footer>
    Sistem Informasi Digital Pengelolaan Sampah Desa — Chatbot WhatsApp &amp; Peta Digital &middot;
    KKN 2026 &middot; Nama: Fajar Arief Rezky | NIM: 23416255201230 | Kelas: IF23E
</footer>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
const STATUS_COLOR = { 'Belum Ditangani':'#C62828', 'Sedang Ditindaklanjuti':'#F57C00', 'Selesai Ditangani':'#2E7D32' };
const STATUS_CLASS = { 'Belum Ditangani':'belum', 'Sedang Ditindaklanjuti':'proses', 'Selesai Ditangani':'selesai' };
let map; let markers=[]; let locationPickerMarker=null; let locationPickerActive=false; let locationPickerMessageTimer=null;
const defaultTpsPoints = [
 { name:'TPS Pusat Kota', lat:-6.4001, lng:107.4438, type:'TPS' },
 { name:'TPS Pasar Cikampek', lat:-6.3968, lng:107.4472, type:'TPS' },
 { name:'TPS Jalan Raya Cikampek', lat:-6.4052, lng:107.4381, type:'TPS' },
 { name:'TPS Perumahan Cikampek', lat:-6.4105, lng:107.4518, type:'TPS' },
 { name:'TPS Terminal', lat:-6.3924, lng:107.4369, type:'TPS' },
];
function initMap() { map = L.map('map').setView([-6.4001,107.4438],14); L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'&copy; OpenStreetMap contributors'}).addTo(map); map.on('click',(event)=>{ if(!locationPickerActive) return; const {lat,lng}=event.latlng; document.getElementById('latitude').value=lat.toFixed(6); document.getElementById('longitude').value=lng.toFixed(6); if(locationPickerMarker){ map.removeLayer(locationPickerMarker); } locationPickerMarker=L.marker([lat,lng],{icon:colorIcon('#E65100')}).addTo(map); showFormMessage('Lokasi dipilih. Silakan kirim laporan.'); setLocationPickerState(false); }); }
function colorIcon(color,isTrash=false){ if(!isTrash){ return L.divIcon({ className:'', html:`<div style="background:${color};width:16px;height:16px;border-radius:50%;border:2px solid white;box-shadow:0 0 3px rgba(0,0,0,0.5)"></div>`, iconSize:[16,16] }); } return L.divIcon({ className:'', html:`<div style="background:${color};width:22px;height:22px;border-radius:4px;border:2px solid white;box-shadow:0 0 3px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;font-size:12px;">🗑️</div>`, iconSize:[22,22] }); }
async function updateStatus(rowNumber,status){ await fetch(`/api/reports/${rowNumber}/status`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status})}); loadReports(); }
function showFormMessage(message,isError=false){ const el=document.getElementById('formMessage'); el.textContent=message; el.style.color=isError?'#C62828':'#2E7D32'; }
async function deleteReport(rowNumber){ const confirmed=window.confirm('Hapus laporan ini?'); if(!confirmed) return; try { const res=await fetch(`/api/reports/${rowNumber}/delete`,{method:'POST'}); const json=await res.json(); if(!res.ok||!json.ok){ showFormMessage(json.message||'Gagal menghapus laporan.',true); return; } showFormMessage('Laporan berhasil dihapus.'); loadReports(); } catch (err){ console.error(err); showFormMessage('Gagal menghapus laporan.',true); } }
function setLocationPickerState(active){ locationPickerActive=active; const pickBtn=document.getElementById('pickLocationBtn'); if(pickBtn){ pickBtn.textContent=active?'Klik peta sekarang':'Pilih lokasi di peta'; pickBtn.style.background=active?'#e8f5e9':'#f1f8e9'; pickBtn.style.borderColor=active? '#2e7d32':'#ccc'; } if(locationPickerMessageTimer){ clearTimeout(locationPickerMessageTimer); } if(!active){ showFormMessage('Silakan lanjutkan mengisi form atau kirim laporan.'); } }
function bindReportForm(){ const form=document.getElementById('reportForm'); if(!form) return; const useMyLocationBtn=document.getElementById('useMyLocationBtn'); const pickLocationBtn=document.getElementById('pickLocationBtn'); useMyLocationBtn?.addEventListener('click',()=>{ if(!navigator.geolocation){ showFormMessage('Browser Anda belum mendukung penentuan lokasi otomatis.',true); return; } showFormMessage('Sedang mencari lokasi Anda...'); navigator.geolocation.getCurrentPosition((position)=>{ const {latitude,longitude,accuracy}=position.coords; if(accuracy>150){ showFormMessage(`Akurasi lokasi masih rendah (${Math.round(accuracy)} m). Coba lagi di tempat terbuka atau pilih lokasi di peta.`,true); return; } document.getElementById('latitude').value=latitude.toFixed(6); document.getElementById('longitude').value=longitude.toFixed(6); showFormMessage(`Lokasi Anda terdeteksi dengan akurasi ${Math.round(accuracy)} m.`); if(map){ map.setView([latitude,longitude],17); } },(error)=>{ const messages={1:'Akses lokasi ditolak. Izinkan akses lokasi di browser lalu coba lagi.',2:'Sinyal lokasi tidak tersedia saat ini. Coba lagi atau pilih lokasi di peta.',3:'Waktu pencarian lokasi habis. Coba lagi atau pilih lokasi di peta.'}; showFormMessage(messages[error.code] || 'Gagal mengambil lokasi. Coba pilih lokasi di peta.',true); },{enableHighAccuracy:true,timeout:15000,maximumAge:0}); }); pickLocationBtn?.addEventListener('click',()=>{ setLocationPickerState(!locationPickerActive); if(locationPickerActive){ showFormMessage('Klik titik di peta untuk memilih lokasi laporan.'); } }); form.addEventListener('submit',async(e)=>{ e.preventDefault(); const formData=new FormData(); formData.append('nama', document.getElementById('nama').value.trim()); formData.append('nomorWa', document.getElementById('nomorWa').value.trim()); formData.append('deskripsi', document.getElementById('deskripsi').value.trim()); formData.append('latitude', document.getElementById('latitude').value.trim()); formData.append('longitude', document.getElementById('longitude').value.trim()); const fotoInput=document.getElementById('foto'); if(fotoInput.files[0]){ formData.append('foto', fotoInput.files[0]); } try { const res=await fetch('/api/reports',{method:'POST',body:formData}); const json=await res.json(); if(!res.ok||!json.ok){ showFormMessage(json.message||'Gagal mengirim laporan.',true); return; } showFormMessage('Laporan berhasil dikirim.'); form.reset(); loadReports(); } catch (err){ console.error(err); showFormMessage('Gagal mengirim laporan. Coba lagi.',true); } }); }
function renderStats(reports){ document.getElementById('statTotal').textContent=reports.length; document.getElementById('statBelum').textContent=reports.filter((r)=>r.status==='Belum Ditangani').length; document.getElementById('statProses').textContent=reports.filter((r)=>r.status==='Sedang Ditindaklanjuti').length; document.getElementById('statSelesai').textContent=reports.filter((r)=>r.status==='Selesai Ditangani').length; }
function renderSidebar(reports){ const list=document.getElementById('reportList'); list.innerHTML=''; if(reports.length===0){ list.innerHTML='<p>Belum ada laporan masuk.</p>'; return; } reports.slice().reverse().forEach((r)=>{ const div=document.createElement('div'); div.className='report-item'; const cls=STATUS_CLASS[r.status]||'belum'; div.innerHTML=`<strong>${r.nama}</strong> — ${r.timestamp}<br/>${r.deskripsi}<div class="badge ${cls}">${r.status}</div><br/>${r.foto&&r.foto!=='-'?`<img src="/uploads/${r.foto}" alt="foto laporan"/>`:''}<select class="status-select" data-row="${r.rowNumber}"><option ${r.status==='Belum Ditangani'?'selected':''}>Belum Ditangani</option><option ${r.status==='Sedang Ditindaklanjuti'?'selected':''}>Sedang Ditindaklanjuti</option><option ${r.status==='Selesai Ditangani'?'selected':''}>Selesai Ditangani</option></select><div class="report-actions"><button class="delete-btn" type="button" data-row="${r.rowNumber}">Hapus</button></div>`; div.querySelector('.status-select').addEventListener('change',(e)=>{ updateStatus(r.rowNumber,e.target.value); }); div.querySelector('.delete-btn').addEventListener('click',()=>{ deleteReport(r.rowNumber); }); list.appendChild(div); }); }
function renderMarkers(reports){ markers.forEach((m)=>map.removeLayer(m)); markers=[]; const allPoints=[...defaultTpsPoints.map((point)=>({...point,status:'TPS',name:point.name,description:'Titik TPS yang ditandai sebagai referensi lokasi sampah.'})), ...reports]; allPoints.forEach((item)=>{ const color=item.status==='TPS'?'#1565C0':STATUS_COLOR[item.status]||'#C62828'; const isTrashMarker=item.status==='TPS'; const markerConfig=isTrashMarker?{icon:colorIcon(color,true)}:{radius:8,fillColor:color,color:'#ffffff',weight:2,opacity:1,fillOpacity:1}; const marker=L.marker([item.latitude||item.lat,item.longitude||item.lng],markerConfig).addTo(map); marker.bindPopup(`<strong>${item.name||item.nama}</strong><br/>${item.description||item.deskripsi||''}<br/>${item.status&&item.status!=='TPS'?`<em>${item.status}</em><br/>`:''}${item.timestamp?item.timestamp:''}${item.foto&&item.foto!=='-'?`<br/><img src="/uploads/${item.foto}" style="width:150px;border-radius:6px;margin-top:6px"/>`:''}`); markers.push(marker); }); }
async function loadReports(){ try { const res=await fetch('/api/reports'); const json=await res.json(); if(!json.ok){ document.getElementById('desaName').textContent=json.message; return; } document.getElementById('desaName').textContent=json.desa; renderStats(json.data); renderSidebar(json.data); renderMarkers(json.data); } catch (err){ console.error(err); document.getElementById('desaName').textContent='Gagal memuat data. Pastikan server backend menyala.'; } }
initMap(); bindReportForm(); loadReports(); setInterval(loadReports,15000);
</script>
</body>
</html>
