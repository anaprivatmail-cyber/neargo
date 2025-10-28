// assets/app-logic.js
(function(){
  "use strict";

  /* ===== UTIL ===== */
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

  /* ===== STATE ===== */
  let GEO=null, currentPage=0, quickMode="";
  let mapSearch=null, markersSearch=[];
  let topMap=null, topMarkers=[];

  /* ===== Datumi ===== */
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

  /* ===== Tema ===== */
  (function(){
    const btn=$("#btnThemeToggle"), icon=btn?.querySelector('#themeIcon');
    function apply(mode){
      document.body.classList.toggle('dark', mode==='dark');
      try{localStorage.setItem('theme',mode);}catch{}
      if(icon) icon.textContent=mode==='dark'?'☀️':'🌙';
    }
    apply(localStorage.getItem('theme')||'light');
    btn?.addEventListener('click',()=>apply(document.body.classList.contains('dark')?'light':'dark'),{passive:true});
  })();

  /* ===== Toast ===== */
  (function(){
    const t=$("#toast");
    const show=(msg,ok=true)=>{ if(!t) return; t.textContent=msg; t.className="toast "+(ok?"ok":"bad"); t.style.display="flex"; setTimeout(()=>t.style.display="none",4000); };
    if(location.hash==="#success"){ show("Plačilo uspešno ✅", true); history.replaceState(null,"",location.pathname+location.search); }
    if(location.hash==="#cancel"){  show("Plačilo preklicano ❌", false); history.replaceState(null,"",location.pathname+location.search); }
    window._toast=show;
  })();

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
    const id=hashId(e);

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
  document.addEventListener('DOMContentLoaded', ()=>{
    navigator.geolocation.getCurrentPosition(
      p=>{ GEO=`${p.coords.latitude},${p.coords.longitude}`; loadAllForTopMap(); },
      ()=>{ loadAllForTopMap(); },
      { enableHighAccuracy:true, timeout:8000 }
    );
  });

})();
