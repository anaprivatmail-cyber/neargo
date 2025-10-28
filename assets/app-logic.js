// assets/app-logic.js

// ===== UTIL =====
function $(s){ return document.querySelector(s); }
function el(t,c){ var x=document.createElement(t); if(c) x.className=c; return x; }
function qs(o){ return new URLSearchParams(o).toString(); }
function euro(v){ return isFinite(+v)?new Intl.NumberFormat('sl-SI',{style:'currency',currency:'EUR'}).format(+v):''; }
function debounce(fn,ms){ var t; return function(){ var a=arguments; clearTimeout(t); t=setTimeout(function(){ fn.apply(null,a); }, ms||350); }; }
function isExternalAPI(e){ var u=(e && e.url ? e.url : "").toLowerCase(); return u.indexOf("ticketmaster")>-1 || u.indexOf("eventbrite")>-1; }

// Stabilen ID za kartico
const hashId = e => {
  if(e.id) return `ev-${String(e.id).replace(/[^a-z0-9]/gi,'')}`;
  const n=(e.name||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,40);
  const t=(e.start||'').replace(/[^0-9]/g,'').slice(0,14);
  return `ev-${n}-${t}`;
};

// ===== STATE =====
let GEO=null, currentPage=0, quickMode="";
let mapSearch=null, markersSearch=[];
let topMap=null, topMarkers=[];

// ===== Datumi =====
function formatDateRange(start,end){
  if(!start) return "";
  const s=new Date(start); if(Number.isNaN(s.getTime())) return "";
  const dFmt=new Intl.DateTimeFormat("sl-SI",{day:"2-digit",month:"2-digit",year:"numeric"});
  const tFmt=new Intl.DateTimeFormat("sl-SI",{hour:"2-digit",minute:"2-digit"});
  if(end){
    const e=new Date(end); if(!Number.isNaN(e.getTime())){
      const same=s.toDateString()===e.toDateString();
      return same?`${dFmt.format(s)} ${tFmt.format(s)}–${tFmt.format(e)}`:`${dFmt.format(s)} ${tFmt.format(s)} — ${dFmt.format(e)} ${tFmt.format(e)}`;
    }
  }
  return `${dFmt.format(s)} ${tFmt.format(s)}`;

// ===== DOMContentLoaded: VSA inicializacija =====
// Tema (noč/dan) – robustno: globalna funkcija za inline onclick
window.toggleTheme = function() {
  var icon = document.getElementById('themeIcon');
  var isDark = document.body.classList.contains('dark');
  var newMode = isDark ? 'light' : 'dark';
  document.body.classList.toggle('dark', newMode === 'dark');
  try { localStorage.setItem('theme', newMode); } catch {}
  if (icon) icon.textContent = newMode === 'dark' ? '☀️' : '🌙';
};
// Ob nalaganju strani nastavi temo glede na localStorage
document.addEventListener('DOMContentLoaded', function() {
  var icon = document.getElementById('themeIcon');
  var mode = (function(){ try { return localStorage.getItem('theme') || 'light'; } catch { return 'light'; } })();
  document.body.classList.toggle('dark', mode === 'dark');
  if (icon) icon.textContent = mode === 'dark' ? '☀️' : '🌙';
});

  /* ===== Map ===== */
  function refreshTopMap(){
    const node=$("#map"); if(!node) return;
    if(!topMap){
      topMap=L.map("map").setView([46.05,14.51],6);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:"© OSM"}).addTo(topMap);
    }
  }
  function clearMarkers(arr){ try{arr.forEach(m=>m.remove());}catch{} }
  function setMarkersOn(map, items){
    const ms=[]; items.forEach(e=>{
      const lat=e.venue?.lat, lon=e.venue?.lon;
      if(Number.isFinite(+lat)&&Number.isFinite(+lon)){
        const m=L.marker([+lat,+lon]).addTo(map);
        const id=hashId(e);
        m.bindPopup(`<a href="#${id}">${(e.name||"Dogodek").slice(0,80)}</a>`);
        ms.push(m);
      }
    }); return ms;
  }

  async function loadAllForTopMap(){
    if(!topMap) return;
    clearMarkers(topMarkers);
    try{
      const [intRes, extRes]=await Promise.all([
        fetch(`/api/provider-list?${qs({size:200})}`).then(r=>r.json()).catch(()=>({})),
        fetch(`/api/search?${qs({size:200})}`).then(r=>r.json()).catch(()=>({}))
      ]);
      const all=[...(intRes?.results||[]),...(extRes?.results||[])];
      topMarkers=setMarkersOn(topMap, all);
      if(topMarkers.length){ const g=new L.featureGroup(topMarkers); topMap.fitBounds(g.getBounds().pad(0.2)); }
    }catch{}
  }

  /* ====== Init featured ====== */
  // ===== Ostala inicializacija =====
  navigator.geolocation.getCurrentPosition(
    p => { GEO = `${p.coords.latitude},${p.coords.longitude}`; loadAllForTopMap(); },
    () => { loadAllForTopMap(); },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}
