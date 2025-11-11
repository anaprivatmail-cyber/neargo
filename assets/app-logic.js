// Lightweight booking UI utilities for NearGo internal calendars
export async function fetchSlots(calendarId){
  const r = await fetch(`/api/calendar-slots?calendar_id=${encodeURIComponent(calendarId)}`).then(x=>x.json()).catch(()=>({ok:false}));
  return (r && r.ok) ? (r.slots||[]) : [];
}

export async function reserveSlot({ slotId, email, eventId, eventTitle, benefit }){
  const res = await fetch('/api/calendar-reserve', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ slot_id: slotId, email, event_id: eventId, event_title: eventTitle, display_benefit: benefit }) }).then(x=>x.json()).catch(()=>({ok:false}));
  return res;
}

export function renderSlotsInline(node, slots, onPick){
  if (!node) return;
  const upcoming = slots.filter(s => s.status==='free');
  if (!upcoming.length){ node.innerHTML = '<div class="muted">Ni prostih terminov.</div>'; return; }
  const fmt = new Intl.DateTimeFormat('sl-SI', { dateStyle:'medium', timeStyle:'short' });
  node.innerHTML = '';
  upcoming.slice(0,20).forEach(s=>{
    const b = document.createElement('button');
    b.className = 'btn mini';
    b.textContent = fmt.format(new Date(s.start_time));
    b.addEventListener('click', ()=> onPick && onPick(s));
    node.appendChild(b);
  });
}
  // ===== Predogled dogodka/storitve =====
  const btnPreview = document.getElementById('btnPreviewEvent');
  const previewModal = document.getElementById('previewModal');
  const closePreviewModal = document.getElementById('closePreviewModal');
  const previewContent = document.getElementById('previewContent');
  if (btnPreview && previewModal && closePreviewModal && previewContent) {
    btnPreview.onclick = function() {
      // Zberi podatke iz obrazca
      const title = document.getElementById('eventName')?.value || '';
      const desc = document.getElementById('desc')?.value || '';
      const img = document.getElementById('imgPreview')?.src || 'https://picsum.photos/600/400';
      const start = document.getElementById('start')?.value || '';
      const end = document.getElementById('end')?.value || '';
      const venue = document.getElementById('venue')?.value || '';
      const price = document.getElementById('price')?.value || '';
      const category = document.getElementById('category')?.value || '';
      previewContent.innerHTML = `
        <img src="${img}" alt="" style="width:100%;max-width:320px;border-radius:12px;margin-bottom:12px;object-fit:cover">
        <h2 style="margin:0 0 8px 0;font-size:1.3em;color:#0bbbd6;">${title}</h2>
        <div style="color:#5b6b7b;font-size:14px;margin-bottom:6px">${venue}</div>
        <div style="color:#5b6b7b;font-size:14px;margin-bottom:6px">${start ? 'Začetek: ' + start : ''} ${end ? '<br>Končanje: ' + end : ''}</div>
        <div style="color:#5b6b7b;font-size:14px;margin-bottom:6px">Kategorija: ${category}</div>
        <div style="color:#0bbbd6;font-weight:700;font-size:16px;margin-bottom:8px;">${price ? 'Cena: ' + price + ' €' : ''}</div>
        <div style="margin-bottom:8px;color:#222;font-size:15px;">${desc}</div>
      `;
      previewModal.style.display = 'flex';
    };
    closePreviewModal.onclick = function() {
      previewModal.style.display = 'none';
    };
    previewModal.onclick = function(e) {
      if (e.target === previewModal) previewModal.style.display = 'none';
    };
  }
// assets/app-logic.js

// ===== UTIL =====
function $(s){ return document.querySelector(s); }
function el(t,c){ var x=document.createElement(t); if(c) x.className=c; return x; }
function qs(o){ return new URLSearchParams(o).toString(); }
function euro(v){ return isFinite(+v)?new Intl.NumberFormat('sl-SI',{style:'currency',currency:'EUR'}).format(+v):''; }
function debounce(fn,ms){ var t; return function(){ var a=arguments; clearTimeout(t); t=setTimeout(function(){ fn.apply(null,a); }, ms||350); }; }
function isExternalAPI(e){ var u=(e && e.url ? e.url : "").toLowerCase(); return u.indexOf("ticketmaster")>-1 || u.indexOf("eventbrite")>-1; }

// Stabilen ID za kartico
// Use any existing global `hashId` if present, otherwise provide a local fallback as `_hashId`.
const _hashId = (function(){
  try {
    if (typeof window !== 'undefined' && typeof window.hashId === 'function') return window.hashId;
  } catch (err) {}
  try {
    if (typeof hashId === 'function') return hashId;
  } catch (err) {}
  return function(e){
    if(e?.id) return `ev-${String(e.id).replace(/[^a-z0-9]/gi,'')}`;
    const n=(e.name||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,40);
    const t=(e.start||'').replace(/[^0-9]/g,'').slice(0,14);
    return `ev-${n}-${t}`;
  };
})();

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
}

// ===== DOMContentLoaded: VSA inicializacija =====
document.addEventListener('DOMContentLoaded', function() {
  // Tema (noč/dan)
  const btn = $("#btnThemeToggle"), icon = btn ? btn.querySelector('#themeIcon') : null;
  function applyTheme(mode) {
    document.body.classList.toggle('dark', mode === 'dark');
    try { localStorage.setItem('theme', mode); } catch {}
    if (icon) icon.textContent = mode === 'dark' ? '☀️' : '🌙';
  }
  applyTheme(localStorage.getItem('theme') || 'light');
  if (btn) btn.addEventListener('click', function() {
    applyTheme(document.body.classList.contains('dark') ? 'light' : 'dark');
  }, { passive: true });

  // ...obstoječa inicializacija (paneli, toast, iskanje, mape, itd.)...


  // ===== Toast =====
  const tToast = $("#toast");
  const showToast = (msg, ok = true) => { if (!tToast) return; tToast.textContent = msg; tToast.className = "toast " + (ok ? "ok" : "bad"); tToast.style.display = "flex"; setTimeout(() => tToast.style.display = "none", 4000); };
  if (location.hash === "#success") { showToast("Plačilo uspešno ✅", true); history.replaceState(null, "", location.pathname + location.search); }
  if (location.hash === "#cancel") { showToast("Plačilo preklicano ❌", false); history.replaceState(null, "", location.pathname + location.search); }
  window._toast = showToast;

  /* ===== Paneli ===== */
  function showPanel(id){
    ["searchPanel","mapPanel","orgPanel","providerTermsPanel"].forEach(pid=>{ const n=$("#"+pid); if(n){ n.classList.remove("show"); n.style.display="none"; } });
    const el=$("#"+id); if(!el) return;
    el.classList.add("show"); el.style.display="block";
    const h=(document.querySelector('header')?.getBoundingClientRect().height)||64;
    const y=el.getBoundingClientRect().top + window.pageYOffset - (h+10);
    window.scrollTo({top:y, behavior:"smooth"});
  }
  $("#btnStart")?.addEventListener('click',()=>showPanel("searchPanel"),{passive:true});
  $("#btnMap")?.addEventListener('click',()=>{ showPanel("mapPanel"); refreshTopMap(); loadAllForTopMap(); },{passive:true});
  $("#btnCloseMap")?.addEventListener('click',()=>showPanel("searchPanel"),{passive:true});

  /* ===== Lokacijska gumba ===== */
  function setLocButtonsActive(which){
    $("#btnPickOnMap")?.classList.toggle("active", which==='pick');
    $("#btnUseLocation")?.classList.toggle("active", which==='gps');
  }

  /* ===== Range ===== */
  const radius=$("#radius"), radiusLbl=$("#radiusLbl"),
        radiusCity=$("#radiusCity"), radiusCityLbl=$("#radiusCityLbl"),
        cityInput=$("#city"), cityRadiusWrap=$("#cityRadiusWrap");
  function updRange(input,label){ if(input&&label) label.textContent=`${input.value} km`; }
  [radius,radiusCity].forEach(r=>{
    if(!r) return;
    r.addEventListener("input",()=>updRange(r,r===radius?radiusLbl:radiusCityLbl),{passive:true});
    updRange(r,r===radius?radiusLbl:radiusCityLbl);
  });
  cityInput?.addEventListener('input',()=>{ if(cityRadiusWrap) cityRadiusWrap.style.display=cityInput.value.trim()?'block':'none'; });

  /* ===== Render kartic ===== */
  function renderSpotCard(e){
    const img=(e.images&&e.images[0])||"https://picsum.photos/600/400";
    const addr=(e.venue?.address||"");
    const gmHref=(e.venue?.lat && e.venue?.lon)
      ? `https://www.google.com/maps?q=${e.venue.lat},${e.venue.lon}`
      : (addr?`https://www.google.com/maps?q=${encodeURIComponent(addr)}`:"");
  const id=_hashId(e);

    const isExt=isExternalAPI(e);
    const moreBtn=isExt?(e.url?`<a class="btn mini link" href="${e.url}" target="_blank">Več</a>`:"")
      :(e.description&&!e.url?`<button class="btn mini link" data-act="more">Več ▾</button>`:"");
    const linkBtn=(!isExt&&e.url)?`<a class="btn mini link" href="${e.url}" target="_blank">Povezava</a>`:"";

    const card=el("div","spot"); card.id=id;
    card.innerHTML=`
      <img src="${img}" alt="">
      <div class="meta">
        <b>${e.name||"Dogodek"}</b>
        <div style="color:var(--muted);font-size:13px">${gmHref?`<a href="${gmHref}" target="_blank">📍 ${addr||'Google Maps'}</a>`:addr}</div>
        <div style="color:var(--muted);font-size:13px">${formatDateRange(e.start,e.end)}</div>
        <div class="actions" style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
          ${moreBtn}
          <button class="btn mini link" data-act="share" data-title="${encodeURIComponent(e.name||'Dogodek')}" data-url="${encodeURIComponent(e.url||location.href)}">Povabi</button>
          <button class="btn mini link" data-act="ics" data-title="${encodeURIComponent(e.name||'Dogodek')}" data-start="${e.start||""}" data-end="${e.end||""}" data-loc="${encodeURIComponent(addr)}">Koledar</button>
          ${linkBtn}
        </div>
      </div>`;
    return card;
  }

  /* ===== Map ===== */
  function refreshTopMap(){
    const node=$("#map"); if(!node) return;
    if(!topMap){
      topMap=L.map("map").setView([46.05,14.51],6);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:"© OSM"}).addTo(topMap);
    }
  }
  function clearMarkers(arr){ try{arr.forEach(m=>m.remove());}catch{} }
  function ensureLiveMarkerStyles(){
    if(document.getElementById('liveMarkerStyles')) return;
    const st=document.createElement('style'); st.id='liveMarkerStyles';
    st.textContent=`.mk{width:16px;height:16px;border-radius:50%;background:#ff6b6b;border:2px solid #fff;box-shadow:0 0 0 2px rgba(0,0,0,.15)}
    .mk-live{background:#2ecc71;animation:pulseLive 1.8s infinite}
    @keyframes pulseLive{0%{transform:scale(1)}50%{transform:scale(1.3)}100%{transform:scale(1)}}`;
    document.head.appendChild(st);
  }
  function isLive(e){
    try{
      const now=Date.now();
      const startMs=new Date(e.start).getTime(); if(!isFinite(startMs)) return false;
      const endMs=isFinite(new Date(e.end).getTime())?new Date(e.end).getTime():startMs+2*3600_000;
      return (startMs <= now && now <= endMs) || (startMs > now && (startMs - now) <= 2*3600_000);
    }catch{return false;}
  }
  function setMarkersOn(map, items){
    ensureLiveMarkerStyles();
    const liveIcon=L.divIcon({className:'live-outer', html:'<div class="mk mk-live"></div>', iconSize:[16,16]});
    const normalIcon=L.divIcon({className:'normal-outer', html:'<div class="mk"></div>', iconSize:[16,16]});
    const ms=[]; items.forEach(e=>{
      const lat=e.venue?.lat, lon=e.venue?.lon;
      if(Number.isFinite(+lat)&&Number.isFinite(+lon)){
        const m=L.marker([+lat,+lon], { icon: isLive(e)?liveIcon:normalIcon }).addTo(map);
  const id=_hashId(e);
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
});
