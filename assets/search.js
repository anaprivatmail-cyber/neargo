// Uporablja globalne helperje iz utils (že dodani v projektu)
let GEO=window.GEO||null, currentPage=0, quickMode="";
let mapSearch=null, markersSearch=[];

function setLocButtonsActive(which){
  document.getElementById("btnPickOnMap")?.classList.toggle("active", which==='pick');
  document.getElementById("btnUseLocation")?.classList.toggle("active", which==='gps');
}

const radius=document.getElementById("radius"), radiusLbl=document.getElementById("radiusLbl"),
      radiusCity=document.getElementById("radiusCity"), radiusCityLbl=document.getElementById("radiusCityLbl"),
      cityInput=document.getElementById("city"), cityRadiusWrap=document.getElementById("cityRadiusWrap");
function clampRange(input){ if(!input) return; input.min=5; input.max=400; input.step=5; }
function updRange(input,label){ if(input&&label) label.textContent=`${input.value} km`; }
[ radius, radiusCity ].forEach(clampRange);
[ radius, radiusCity ].forEach(r=>{
  if(!r) return;
  ["input","change","pointerup","touchend"].forEach(ev=>r.addEventListener(ev,()=>updRange(r, r===radius?radiusLbl:radiusCityLbl), {passive:true}));
  updRange(r, r===radius?radiusLbl:radiusCityLbl);
});
cityInput?.addEventListener('input',()=>{ cityRadiusWrap.style.display = cityInput.value.trim()? 'block':'none'; });

function euro(v){ return Number.isFinite(+v)?new Intl.NumberFormat('sl-SI',{style:'currency',currency:'EUR'}).format(+v):''; }
function hashId(e){ if(e?.id) return `ev-${String(e.id).replace(/[^a-z0-9]/gi,'')}`; return `ev-${(e.name||'').toLowerCase().replace(/[^a-z0-9]/g,'')}-${(e.start||'').replace(/[^0-9]/g,'')}`.slice(0,64); }
function isExternalAPI(e){ const u=(e?.url||'').toLowerCase(); return u.includes('ticketmaster')||u.includes('eventbrite'); }
function formatDateRange(start,end){
  if(!start) return ""; const s=new Date(start); if(Number.isNaN(s.getTime())) return "";
  const hasEnd=!!end&&!Number.isNaN(new Date(end).getTime());
  const dFmt=new Intl.DateTimeFormat("sl-SI",{day:"2-digit",month:"2-digit",year:"numeric"});
  const tFmt=new Intl.DateTimeFormat("sl-SI",{hour:"2-digit",minute:"2-digit"});
  if(hasEnd){ const e=new Date(end); const same=s.toDateString()===e.toDateString();
    return same?`${dFmt.format(s)} ${tFmt.format(s)}–${tFmt.format(e)}`:`${dFmt.format(s)} ${tFmt.format(s)} — ${dFmt.format(e)} ${tFmt.format(e)}`; }
  return `${dFmt.format(s)} ${tFmt.format(s)}`;
}
function qs(o){ return new URLSearchParams(o).toString(); }

function benefitTextFromCoupon(e){
  if(typeof e.couponPercentOff==="number" && e.couponPercentOff>0) return `-${e.couponPercentOff}%`;
  if(typeof e.couponValueEur==="number" && e.couponValueEur>0)  return euro(e.couponValueEur);
  const fb=(e.couponFreebieLabel||e.display_benefit||"").toString().trim();
  if(fb) return fb;
  if((e.benefit_type||"").toLowerCase()==="percent" && typeof e.benefit_value==="number") return `-${e.benefit_value}%`;
  if((e.benefit_type||"").toLowerCase()==="amount"  && typeof e.benefit_value==="number") return euro(e.benefit_value);
  return "Kupon";
}
function renderBuyRow(e, img){
  if(isExternalAPI(e)){ return e.url ? `<div class="buy"><button class="btn mini" onclick="window.open('${e.url}','_blank','noopener')">Kupi vstopnico</button></div>` : ``; }
  const isCoupon=e.offerType==="coupon";
  const isTicket=e.offerType==="ticket";
  const hasTiers=Array.isArray(e.ticketPrices)&&e.ticketPrices.length>0;
  if (isCoupon){
    const benefit = benefitTextFromCoupon(e);
    return `<div class="buy">
      <span class="value-chip">${benefit}</span>
      <button class="btn mini" data-act="buy" data-kind="coupon"
        data-name="${encodeURIComponent(e.name||'Dogodek')}"
        data-benefit="${encodeURIComponent(benefit)}"
        data-price="0" data-price-eur="0"
        data-img="${img}" data-venue="${encodeURIComponent(e.venue?.address||'')}"
        data-startiso="${e.start||''}" data-eid="${e.id||''}">
        Kupi kupon
      </button>
    </div>`;
  }
  if (isTicket && hasTiers){
    return e.ticketPrices.map(t=>{
      const label=(t.label||'Vstopnica').toString().slice(0,40);
      const price=Number(t.price||0);
      return `<div class="buy">
        <span class="value-chip">${euro(price)}</span>
        <button class="btn mini" data-act="buy" data-kind="ticket"
          data-name="${encodeURIComponent(`${e.name||'Dogodek'} – ${label}`)}"
          data-price="${price}" data-price-eur="${price}"
          data-img="${img}" data-venue="${encodeURIComponent(e.venue?.address||'')}"
          data-startiso="${e.start||''}" data-eid="${e.id||''}">
          Kupi vstopnico – ${label}
        </button>
      </div>`;
    }).join("");
  }
  if (isTicket && Number(e.price)>0){
    const p=Number(e.price||0);
    return `<div class="buy"><span class="value-chip">${euro(p)}</span>
      <button class="btn mini" data-act="buy" data-kind="ticket"
        data-name="${encodeURIComponent(e.name||'Dogodek')}"
        data-price="${p}" data-price-eur="${p}"
        data-img="${img}" data-venue="${encodeURIComponent(e.venue?.address||'')}"
        data-startiso="${e.start||''}" data-eid="${e.id||''}">
        Kupi vstopnico
      </button></div>`;
  }
  if(e.offerType==="none"){ return `<div class="muted" style="font-size:13px"><b>Brez vstopnine</b></div>`; }
  return "";
}
function renderSpotCard(e){
  const img=(e.images&&e.images[0])||"https://picsum.photos/600/400";
  const addr=(e.venue?.address||"");
  const gmHref=(e.venue?.lat && e.venue?.lon) ? `https://www.google.com/maps?q=${e.venue.lat},${e.venue.lon}` : (addr ? `https://www.google.com/maps?q=${encodeURIComponent(addr)}` : "");
  const id=hashId(e);
  const isExt=isExternalAPI(e);
  const hasMore=!!e.description && !e.url;
  const moreBtn=isExt ? (e.url?`<a class="btn mini link" href="${e.url}" target="_blank" rel="noopener">Več</a>`:"") : (hasMore?`<button class="btn mini link" data-act="more">Več ▾</button>`:"");
  const linkBtn=(!isExt && e.url) ? `<a class="btn mini link" href="${e.url}" target="_blank" rel="noopener">Povezava na dogodek</a>`:"";
  const card=document.createElement("div"); card.className="spot"; card.id=id;
  card.innerHTML=`
    <img src="${img}" alt="" loading="lazy">
    <div class="meta">
      <b>${e.name||"Dogodek"}</b>
      <div style="color:var(--muted);font-size:13px">
        ${ gmHref ? `<a href="${gmHref}" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline">📍 ${addr||'Google Maps'}</a>` : addr }
      </div>
      <div style="color:var(--muted);font-size:13px">${formatDateRange(e.start, e.end)}</div>
      <div class="actions" style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
        ${moreBtn}
        <button class="btn mini link" data-act="share" data-title="${encodeURIComponent(e.name||'Dogodek')}" data-url="${encodeURIComponent(e.url||location.href)}">Povabi še nekoga</button>
        <button class="btn mini link" data-act="ics" data-title="${encodeURIComponent(e.name||'Dogodek')}" data-start="${e.start||""}" data-end="${e.end||""}" data-loc="${encodeURIComponent(e.venue?.address||'')}">Dodaj v koledar</button>
        ${linkBtn}
      </div>
      ${ renderBuyRow(e, img) }
      ${ (!isExt && e.description) ? `<div class="more-text" style="display:none; margin-top:6px; color:var(--muted)">${e.description}</div>` : ``}
    </div>`;
  return card;
}

const liveSearch=(fn=>{let t; return()=>{clearTimeout(t); t=setTimeout(fn,350);};})(()=>doSearch(0,false));
document.getElementById("q")?.addEventListener("input", liveSearch);
document.getElementById("city")?.addEventListener("input", ()=>{ document.getElementById("cityRadiusWrap").style.display = document.getElementById("city").value.trim()? 'block':'none'; liveSearch(); });
document.getElementById("btnUseLocation")?.addEventListener("click",()=>navigator.geolocation.getCurrentPosition(
  p=>{ GEO=`${p.coords.latitude.toFixed(5)},${p.coords.longitude.toFixed(5)}`; setLocButtonsActive('gps'); doSearch(0,true); },
  ()=>window._toast?.("Lokacije ni bilo mogoče pridobiti.",false)
));
document.getElementById("btnPickOnMap")?.addEventListener("click", ()=>{ setLocButtonsActive('pick'); document.dispatchEvent(new CustomEvent('picker:open')); });
document.getElementById("freeOnly")?.addEventListener("change",()=>doSearch(0,false));
document.getElementById("dateFrom")?.addEventListener("change", ()=>{ quickMode=""; setQuickActive(); doSearch(0,false); });
document.getElementById("dateTo")?.addEventListener("change",   ()=>{ quickMode=""; setQuickActive(); doSearch(0,false); });
document.querySelectorAll(".quickDate").forEach(b=> b.addEventListener("click",()=>{ quickMode=b.dataset.mode||""; setQuickActive(b); doSearch(0,false); }));
function setQuickActive(activeBtn){ document.querySelectorAll(".quickDate").forEach(x=>x.classList.toggle("active", x===activeBtn)); }
document.querySelectorAll(".cat").forEach(btn=>{
  btn.onclick=()=>{ document.querySelectorAll(".cat").forEach(b=>b.classList.remove("active")); btn.classList.add("active"); doSearch(0,false); };
});
document.getElementById("btnClear")?.addEventListener("click", ()=>{
  const reset=30;
  document.getElementById("q").value=""; document.getElementById("city").value=""; document.getElementById("radius").value=reset; document.getElementById("radiusLbl").textContent=`${reset} km`;
  document.getElementById("radiusCity").value=reset; document.getElementById("radiusCityLbl").textContent=`${reset} km`; document.getElementById("cityRadiusWrap").style.display="none";
  document.getElementById("freeOnly").checked=false; quickMode=""; document.getElementById("dateFrom").value=""; document.getElementById("dateTo").value="";
  document.querySelectorAll(".cat").forEach((b,i)=>b.classList.toggle("active", i===0));
  setQuickActive(null); setLocButtonsActive(null);
  GEO=null; doSearch(0,false);
});
document.getElementById("btnToggleResultsMap")?.addEventListener("click",()=>{
  const wrap=document.getElementById("mapSearchWrap");
  const show=wrap.style.display==="none";
  wrap.style.display=show?"block":"none";
  document.getElementById("btnToggleResultsMap").textContent= show ? "Skrij zemljevid rezultatov" : "Pokaži zemljevid rezultatov";
  if(show && !mapSearch){
    mapSearch=L.map("mapSearch").setView([46.05,14.51],6);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:"© OSM"}).addTo(mapSearch);
  }
});

function getEndTs(e){ const cand=e.end||e.until||e.endsAt||e.ends_at||e.finish||e.stop||e.start; const t=new Date(cand).getTime(); return Number.isFinite(t)?t:NaN; }
async function doSearch(page=0, byGeo=false){
  window.showPanel?.("searchPanel"); currentPage=page;
  // Dinamično nastavi naslov obrazca
  const mode = document.querySelector('.mode.active')?.dataset?.mode || '';
  const searchTitle = document.getElementById('searchTitle');
  if(searchTitle){
    if(mode==='events') searchTitle.textContent = 'Iskanje dogodkov';
    else if(mode==='services') searchTitle.textContent = 'Iskanje storitev';
    else searchTitle.textContent = 'Iskanje';
  }
  const qVal=document.getElementById("q")?.value.trim()||"", cityVal=document.getElementById("city")?.value.trim()||"";
  const radUser=Number(document.getElementById("radius")?.value||30);
  const radCity=Number(document.getElementById("radiusCity")?.value||30);
  const catVal=document.querySelector(".cat.active")?.dataset?.cat ?? "";
  const freeOnly=document.getElementById("freeOnly")?.checked;
  let fromTs=null, toTs=null;
  if(quickMode){
    const now=new Date(); let from=new Date(now), to=new Date(now);
    if(quickMode==="weekend"){ const d=now.getDay(); const ds=(6-(d||7)); from.setDate(now.getDate()+ds); to=new Date(from); to.setDate(from.getDate()+1); }
    else if(quickMode==="7"){ to.setDate(now.getDate()+7); }
    else if(quickMode==="30"){ to.setDate(now.getDate()+30); }
    fromTs=from.setHours(0,0,0,0); toTs=to.setHours(23,59,59,999);
  } else {
    const df=document.getElementById("dateFrom")?.value||"", dt=document.getElementById("dateTo")?.value||"";
    if(df) fromTs=new Date(df).setHours(0,0,0,0);
    if(dt) toTs=new Date(dt).setHours(23,59,59,999);
  }
  const params={ q:qVal, radiuskm:(cityVal?radCity:radUser), page, size:50 };
  if (byGeo && GEO) params.latlon=GEO; else if (cityVal) params.city=cityVal; else if (GEO) params.latlon=GEO;
  let external=[], internal=[];
  try{ internal=await fetch(`/api/provider-list?${qs(params)}`).then(r=>r.json()).then(d=>d?.results||[]).catch(()=>[]);}catch{}
  try{ external=await fetch(`/api/search?${qs(params)}`).then(r=>r.json()).then(d=>d?.results||[]).catch(()=>[]);}catch{}
  let items=[...(internal||[]), ...(external||[])];
  // Filtriraj demo/test/sample dogodke/storitve
  items=items.filter(e=>{
    const name=(e.name||'').toLowerCase();
    if(name.includes('demo')||name.includes('test')||name.includes('vzorec')||name.includes('sample')) return false;
    return true;
  });
  // Prikaži le dogodke/storitve, ki jih je vpisal uporabnik ali so iz velikih appov
  items=items.filter(e=>{
    // Če ima e.userId ali e.createdBy, je vpisal uporabnik
    if(e.userId||e.createdBy) return true;
    // Če je iz Ticketmaster/Eventbrite
    if(isExternalAPI(e)) return true;
    return false;
  });
  const seen=new Set();
  items=items.filter(e=>{ const k=`${(e.name||'').toLowerCase()}|${e.start||''}|${e.venue?.address||''}`; if(seen.has(k)) return false; seen.add(k); return true; });
  const now=Date.now();
  items=items.filter(e=>{ const t=getEndTs(e); return Number.isFinite(t)&&t>=now; });
  if(fromTs || toTs){
    items=items.filter(e=>{
      const t=new Date(e.start || e.end).getTime();
      if(!Number.isFinite(t)) return false;
      if(fromTs && t<fromTs) return false;
      if(toTs && t>toTs) return false;
      return true;
    });
  }
  items.forEach(e=>{ if(!e.category) e.category=detectCategory(e); });
  if(cityVal){ const c=cityVal.toLowerCase(); items=items.filter(e => ((e.venue?.address||e.city||e.venue?.city||"").toLowerCase().includes(c))); }
  if(freeOnly){
    items=items.filter(e=>{
      if((e?.url||'').toLowerCase().includes('ticketmaster') || (e?.url||'').toLowerCase().includes('eventbrite')) return false;
      const tiersFree=(Array.isArray(e.ticketPrices)&&e.ticketPrices.length>0)? e.ticketPrices.every(tp=>Number(tp.price||0)===0) : true;
      const baseFree=(e.offerType==="none") || Number(e.price||0)===0;
      return baseFree && tiersFree;
    });
  }
  const filtered=catVal?items.filter(e=>(e.category||"")===catVal):items;
  const box=document.getElementById("results"); box.innerHTML="";
  if(!filtered.length){
    box.innerHTML=`<div class="card" style="color:var(--muted)">Ni rezultatov. Poskusi druge datume, večji radij ali drugo mesto.</div>`;
    if(mapSearch){ clearMarkers(markersSearch); markersSearch=[]; }
    return;
  }
  filtered.forEach(e=>{ const card=renderSpotCard(e); box.appendChild(card); });
  if(mapSearch){
    clearMarkers(markersSearch);
    markersSearch=window.setMarkersOn?.(mapSearch, filtered, false) || [];
    try{ if(markersSearch.length){ const g=new L.featureGroup(markersSearch); mapSearch.fitBounds(g.getBounds().pad(0.2)); } }catch{}
  }
  const p=document.getElementById("pagination"); if(p){ p.innerHTML=""; const prev=document.createElement("button"); prev.className="btn link"; prev.textContent="Nazaj"; prev.disabled=currentPage<=0; prev.onclick=()=>doSearch(currentPage-1,false); const next=document.createElement("button"); next.className="btn link"; next.textContent="Naprej"; next.onclick=()=>doSearch(currentPage+1,false); p.append(prev,next); }
}
function detectCategory(e){
  const t=((e.name||'')+' '+(e.description||'')).toLowerCase();
  if(/koncert|music|band|rock|jazz|festival/.test(t)) return 'koncerti';
  if(/otrok|otroci|kids|family|družin/.test(t)) return 'druzina-otroci';
  if(/hrana|food|street food|kulinar/.test(t)) return 'kulinarika';
  if(/gora|narav|hike|trek|outdoor|park/.test(t)) return 'outdoor-narava';
  if(/šport|sport|tek|match|game|liga|nogomet|košarka/.test(t)) return 'sport-tekmovanja';
  if(/podjetj|biz|business|b2b|konferenc/.test(t)) return 'posel-networking';
  if(/uč|ucenje|workshop|delavn|tečaj|tecaj|skill/.test(t)) return 'ucenje-skill';
  if(/gledali|muzej|razstav|opera|film|kino|kulturn/.test(t)) return 'kultura-umetnost';
  return '';
}

// Cookie banner + SW
(function(){ const b=document.getElementById("cookieBanner"); if(!localStorage.getItem("cookieAccepted")) b.style.display="block"; document.getElementById("cookieAccept")?.addEventListener("click",()=>{ localStorage.setItem("cookieAccepted","1"); b.style.display="none"; });})();
if('serviceWorker' in navigator){ window.addEventListener('load',()=>{ navigator.serviceWorker.register('/sw.js').then(reg=>{ if(reg.waiting){ reg.waiting.postMessage({type:'SKIP_WAITING'}); } reg.update().catch(()=>{}); }).catch(()=>{}); }); }

export function initSearch(){}
