// === Nea asistentka ===
const btnNea = document.getElementById('btnNea');
const neaModal = document.getElementById('neaModal');
const neaClose = document.getElementById('neaClose');
const neaForm = document.getElementById('neaForm');
const neaInput = document.getElementById('neaInput');
const neaChatContent = document.getElementById('neaChatContent');
if(btnNea && neaModal && neaClose && neaForm && neaInput && neaChatContent){
  btnNea.addEventListener('click',()=>{
    neaModal.style.display = 'flex';
    setTimeout(()=>neaInput.focus(), 200);
  });
  neaClose.addEventListener('click',()=>{
    neaModal.style.display = 'none';
  });
  neaModal.addEventListener('click',e=>{
    if(e.target===neaModal) neaModal.style.display='none';
  });
  neaForm.addEventListener('submit',async e=>{
    e.preventDefault();
    const q = neaInput.value.trim();
    if(!q) return;
    addNeaMsg('user',q);
    neaInput.value = '';
    neaInput.disabled = true;
    // Simulacija odgovora (TODO: povezava na AI/iskanje)
    setTimeout(()=>{
      addNeaMsg('nea',neaMockAnswer(q));
      neaInput.disabled = false;
      neaInput.focus();
    }, 900);
  });
  function addNeaMsg(who,txt){
    const msg = document.createElement('div');
    msg.className = 'nea-msg ' + (who==='nea'?'nea':'user');
    msg.innerHTML = `<span>${who==='nea'?'🤖':'🧑'} </span>${txt}`;
    neaChatContent.appendChild(msg);
    neaChatContent.scrollTop = neaChatContent.scrollHeight;
  }
  function neaMockAnswer(q){
    // Osnovna analiza vprašanja (demo)
    if(q.toLowerCase().includes('gume')) return 'Za menjavo gum priporočam <b>Vulkanizer Maribor</b> – prosti termini jutri! <button class="btn mini" onclick="window._toast(\'Rezervacija ni še implementirana\')">Rezerviraj termin</button>';
    if(q.toLowerCase().includes('koncert')) return 'V vaši bližini je koncert <b>Koncert XYZ</b> ta petek. <button class="btn mini" onclick="window._toast(\'Nakup ni še implementiran\')">Kupi vstopnico</button>';
    return 'Nea: Hvala za vprašanje! Trenutno še učim, a kmalu bom znala več. Poskusi vprašati po storitvah ali dogodkih.';
  }
}

// ========== PRENOS GLAVNE LOGIKE IZ index.html ========== //
// (1) Toast
(function(){
  window._toast=(msg,ok)=>{const t=document.getElementById('toast'); if(!t) return; t.textContent=msg; t.className='toast '+(ok===false?'bad':'ok'); t.style.display='flex'; setTimeout(()=>t.style.display='none',4000); };
  window.onerror=(m)=>{ try{window._toast('Napaka: '+m,false);}catch(e){} };
})();

// (2) Panel helpers
function hideAllPanels(){ document.querySelectorAll('.panel').forEach(p=>p.classList.remove('show')); }
function scrollToEl(node){ if(!node) return; const y=node.getBoundingClientRect().top+window.scrollY-(document.querySelector('header')?.getBoundingClientRect().height||64)-8; window.scrollTo({top:y,behavior:'smooth'}); }
function showPanel(id){
  const p = document.getElementById(id); if(!p) return;
  if(id==='plansPanel'){ window.prevPanelBeforePlans = window.lastPanel; }
  hideAllPanels(); p.classList.add('show'); window.lastPanel=id; scrollToEl(p);
}

// (3) Gumbi in paneli
document.getElementById("btnStart")?.addEventListener("click",()=>scrollToEl(document.getElementById("searchPanel")));
document.getElementById("btnProvidersTop")?.addEventListener("click",(e)=>{ e.preventDefault(); showPanel('orgHub'); });
document.getElementById("hubPublish")?.addEventListener("click",()=>showPanel('orgPanel'));
document.getElementById("btnPremiumTop")?.addEventListener("click",(e)=>{ e.preventDefault(); showPanel('premiumPanel'); });
document.getElementById("btnClosePremium")?.addEventListener("click",()=>scrollToEl(document.getElementById("hero")));
document.getElementById("btnCloseMap")?.addEventListener("click",()=>scrollToEl(document.getElementById("searchPanel")));
document.getElementById("showProviderTerms")?.addEventListener("click",(e)=>{ e.preventDefault(); showPanel('providerTermsPanel'); });
document.getElementById("closeProviderTerms")?.addEventListener("click",(e)=>{ e.preventDefault(); showPanel('orgPanel'); });
document.getElementById("hubPlans")?.addEventListener("click",()=>showPanel('plansPanel'));
document.getElementById("btnClosePlans")?.addEventListener("click",()=>showPanel(window.prevPanelBeforePlans || 'orgHub'));
document.getElementById("linkPlansInline")?.addEventListener("click",(e)=>{ e.preventDefault(); showPanel('plansPanel'); });
document.getElementById("featPlansLink")?.addEventListener("click",(e)=>{ e.preventDefault(); showPanel('plansPanel'); });

// (4) Pri interakciji z iskanjem skrij ponudniške panele
document.getElementById("searchPanel")?.addEventListener("click",()=>hideAllPanels());

// (5) Lokacijski gumbi
function setLocButtonsActive(which){
  document.getElementById("btnPickOnMap")?.classList.toggle("active", which==='pick');
  document.getElementById("btnUseLocation")?.classList.toggle("active", which==='gps');
}

// (6) Drsniki
const radius=document.getElementById("radius"), radiusLbl=document.getElementById("radiusLbl"),
      radiusCity=document.getElementById("radiusCity"), radiusCityLbl=document.getElementById("radiusCityLbl"),
      cityInput=document.getElementById("city");
radius?.addEventListener('input',()=>{ radiusLbl.textContent=`${radius.value} km`; });
radiusCity?.addEventListener('input',()=>{ radiusCityLbl.textContent=`${radiusCity.value} km`; });

// (7) Geolokacija
document.getElementById("btnUseLocation")?.addEventListener("click", ()=>{
  try{
    navigator.geolocation.getCurrentPosition((pos)=>{
      window.GEO = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      document.querySelector("#btnUseLocation .txt")?.textContent="Uporabljam tvojo lokacijo ✓";
      document.getElementById("cityRadiusWrap").style.display='none';
      radiusLbl.textContent = `${radius.value} km`;
      setLocButtonsActive('gps');
      if(typeof doSearch==='function') doSearch(0);
    }, ()=>{ window._toast("Lokacije ni bilo mogoče pridobiti.", false); }, {enableHighAccuracy:true,timeout:15000});
  }catch{}
});

// (8) Gumbi za prikaz zemljevida in iskanje (osnovni primer)
document.getElementById("btnPickOnMap")?.addEventListener("click", ()=>{ document.getElementById("pickModal").style.display="flex"; setTimeout(()=>{if(typeof initPickMap==='function')initPickMap();},50); setLocButtonsActive('pick'); });
document.getElementById("pickClose")?.addEventListener("click", ()=>{ document.getElementById("pickModal").style.display="none"; });

// (9) Hitri datumi (osnovni primer)
// ... (ostane za naslednji korak, če bo potrebno) ...
// assets/app-logic.js
(function(){
  "use strict";

  /* ===== UTIL ===== */
  const $=s=>document.querySelector(s);
  const el=(t,c)=>{const x=document.createElement(t); if(c) x.className=c; return x;};
  const qs=o=>new URLSearchParams(o).toString();
  const euro=v=>Number.isFinite(+v)?new Intl.NumberFormat('sl-SI',{style:'currency',currency:'EUR'}).format(+v):'';
  const debounce=(fn,ms=350)=>{let t; return(...a)=>{clearTimeout(t); t=setTimeout(()=>fn(...a),ms);} };
  function isExternalAPI(e){ const u=(e?.url||'').toLowerCase(); return u.includes('ticketmaster')||u.includes('eventbrite'); }

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
