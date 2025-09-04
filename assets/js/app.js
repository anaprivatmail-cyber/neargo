"use strict";

/* ===== Helpers ===== */
const $  = s => document.querySelector(s);
const el = (t,c)=>{const x=document.createElement(t); if(c) x.className=c; return x;};
const qs = o => new URLSearchParams(o).toString();
const euro = v => Number.isFinite(+v) ? new Intl.NumberFormat('sl-SI',{style:'currency',currency:'EUR'}).format(+v) : '';
const priceCents = v => Math.round(Number(v||0)*100);

/* ===== Tema ===== */
const theme=$("#theme");
const applyTheme=v=>document.body.classList.toggle("dark", v==="dark");
applyTheme(localStorage.getItem("theme")||"light");
if(theme){
  theme.checked=document.body.classList.contains("dark");
  theme.onchange=()=>{const m=theme.checked?"dark":"light"; localStorage.setItem("theme",m); applyTheme(m);};
}

/* ===== Jezik – simple dropdown ===== */
(function(){
  const wrap = $("#langWrap");
  const menu = $("#langMenu");
  const hidden = $("#lang");
  const label = $("#langLabel");
  let open = false;
  const toggle = (state)=>{ open=state!==undefined?state:!open; if(menu) menu.style.display=open?"block":"none"; };
  wrap?.addEventListener("click",(e)=>{ if(e.target.closest(".lang-menu")) return; toggle(); });
  menu?.querySelectorAll("button").forEach(b=>{
    b.addEventListener("click", ()=>{ if(hidden) hidden.value=b.dataset.val; if(label) label.textContent=b.textContent; toggle(false); });
  });
  document.addEventListener("click",(e)=>{ if(wrap && !wrap.contains(e.target)) toggle(false); });
})();

/* ===== Toast (success/cancel) ===== */
(function(){
  const t=$("#toast");
  const show=(msg,ok=true)=>{
    if(!t) return;
    t.textContent=msg; t.className="toast "+(ok?"ok":"bad"); t.style.display="flex";
    setTimeout(()=>t.style.display="none", 4000);
  };
  if(location.hash==="#success"){ show("Plačilo uspešno. Hvala! ✅", true); history.replaceState(null,"",location.pathname+location.search); }
  if(location.hash==="#cancel"){ show("Plačilo preklicano. ❌", false); history.replaceState(null,"",location.pathname+location.search); }
})();

/* ===== Navigacija / Paneli ===== */
function showPanel(id){
  ["searchPanel","mapPanel","orgPanel"].forEach(pid=>$("#"+pid)?.classList.remove("show"));
  $("#"+id)?.classList.add("show");
  $("#"+id)?.scrollIntoView({behavior:"smooth", block:"start"});
}
$("#btnStart")?.addEventListener("click",()=>{ showPanel("searchPanel"); $("#q")?.focus(); });
$("#btnMap")?.addEventListener("click",()=> { showPanel("mapPanel"); refreshTopMap(); });
$("#btnOrganizers")?.addEventListener("click",()=> showPanel("orgPanel"));
$("#btnChecker")?.addEventListener("click",()=> { location.href = "/checker.html"; });

$("#radius")?.addEventListener("input",()=> { const v=$("#radius")?.value||30; const l=$("#radiusLbl"); if(l) l.textContent = `${v} km`; });

document.querySelectorAll(".cat").forEach(btn=>{
  btn.addEventListener("click",()=>{
    document.querySelectorAll(".cat").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    doSearch(0);
  });
});

/* ===== Leaflet – glavni zemljevid ===== */
const map=L.map("map").setView([46.05,14.51],6);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:"© OSM"}).addTo(map);
let markersTop=[];

function renderMapDetail(e){
  const host = $("#mapDetail");
  if(!host) return;
  host.innerHTML = "";
  const card = el("div","card");
  const img=(e.images&&e.images[0])||"https://picsum.photos/600/400";

  // [COUPON] izračun prikaza cene/gumba
  const isCoupon = e.offerType === "coupon";
  const showBuy  = isCoupon || (e.offerType==="ticket" && Number(e.price)>0);
  const priceToShow = isCoupon ? 2 : (e.price || 0);

  const showMore = (!!e.description && !e.url);
  card.innerHTML = `
    <div style="display:flex; gap:12px; align-items:flex-start">
      <div style="width:110px">
        <img src="${img}" alt="" style="width:110px;height:110px;object-fit:cover;border-radius:12px;border:1px solid var(--chipborder)">
        <div style="margin-top:6px">
          ${ showMore ? `<button class="btn mini link" data-act="more">Več ▾</button>` :
            (e.url?`<a class="btn mini link" href="${e.url}" target="_blank" rel="noopener">Povezava</a>`:"") }
        </div>
      </div>
      <div style="flex:1; min-width:0">
        <b style="display:block; margin-bottom:4px; overflow:hidden; text-overflow:ellipsis;">${e.name||"Dogodek"}</b>
        <div style="color:var(--muted);font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis">${e.venue?.address||""}</div>
        <div style="color:var(--muted);font-size:13px">${e.start?new Date(e.start).toLocaleString():""}</div>
        <div class="actions" style="margin-top:8px">
          <button class="btn mini" data-act="share" data-title="${encodeURIComponent(e.name||'Dogodek')}" data-url="${encodeURIComponent(e.url||location.href)}">Povabi še nekoga</button>
          <button class="btn mini" data-act="ics" data-title="${encodeURIComponent(e.name||'Dogodek')}" data-start="${e.start||""}" data-end="${e.end||""}" data-loc="${encodeURIComponent(e.venue?.address||'')}">Dodaj v koledar</button>
        </div>
        ${ showBuy ? `
          <div class="buy">
            <span class="price">${euro(priceToShow)}</span>
            <button class="btn mini"
                    data-act="buy"
                    data-kind="${e.offerType}"
                    data-name="${encodeURIComponent(e.name||'Dogodek')}"
                    data-benefit="${encodeURIComponent(e.couponDesc || e.display_benefit || '')}"
                    data-price="${priceToShow}">Kupi ${isCoupon?'kupon':'vstopnico'}</button>
          </div>
          ${isCoupon && (e.couponDesc || e.display_benefit) ? `<div class="muted" style="font-size:12px">Kupon: ${e.couponDesc || e.display_benefit} (vnovči se pri ponudniku)</div>` : ``}
        ` : ``}
        ${e.description?`<div class="more-text" style="display:none; margin-top:6px; color:var(--muted)">${e.description}</div>`:''}
      </div>
    </div>`;
  host.appendChild(card);
  attachMiniActions();
  host.scrollIntoView({behavior:"smooth", block:"start"});
}

function setMarkersOn(mapInst, arr){
  const bag=[];
  arr.forEach(e=>{
    const lat=e.venue?.lat, lon=e.venue?.lon;
    if(Number.isFinite(lat) && Number.isFinite(lon)){
      const name=e.name||"Dogodek";
      const link=e.url||e.permalink||"";
      const more = !link ? `<br><a href="#" class="more-link">Več</a>` : `<br><a href="${link}" target="_blank" rel="noopener">Povezava</a>`;
      const m=L.marker([lat,lon]).addTo(mapInst).bindPopup(`<b>${name}</b>${more}`);
      m._event = e;
      bag.push(m);
    }
  });
  if(bag.length){
    const g=new L.featureGroup(bag);
    mapInst.fitBounds(g.getBounds().pad(0.2));
  }
  return bag;
}

map.on('popupopen', (ev)=>{
  const node = ev?.popup?._contentNode;
  const src  = ev?.popup?._source;
  if(node){
    const a = node.querySelector('.more-link');
    if(a){ a.addEventListener('click', (e)=>{ e.preventDefault(); if(src && src._event) renderMapDetail(src._event); }); }
  }
});
function clearMarkers(arr){ arr.forEach(m=>m.remove()); arr.length=0; }
function setTopMarkers(items){ clearMarkers(markersTop); markersTop = setMarkersOn(map, items); }

/* ===== GEO / mesto + featured ===== */
let GEO=null;
const cityInput = $("#city");
cityInput?.addEventListener('input', ()=>{ GEO=null; });

navigator.geolocation.getCurrentPosition(p=>{
  GEO=`${p.coords.latitude.toFixed(5)},${p.coords.longitude.toFixed(5)}`;
  loadFeatured(); refreshTopMap();
}, ()=>{ loadFeatured(); refreshTopMap(); });

/* ===== Vrtiljak autoscroll ===== */
let autoScrollTimer=null;
function startAutoScroll(){
  const box=$("#carousel");
  if(!box) return;
  if(autoScrollTimer) clearInterval(autoScrollTimer);
  autoScrollTimer=setInterval(()=>{
    const nearEnd = box.scrollLeft >= (box.scrollWidth - box.clientWidth - 4);
    if(nearEnd){ box.scrollTo({left:0, behavior:"smooth"}); return; }
    box.scrollBy({left: box.clientWidth*0.95, behavior:"smooth"});
  }, 3500);
}

function detectCategory(e){
  const name=(e.name||"").toLowerCase();
  const desc=(e.description||"").toLowerCase();
  const text=name+" "+desc;
  const has=(...w)=>w.some(x=>text.includes(x));
  if(has("concert","koncert","tour","band","music","muzika")) return "koncert";
  if(has("kids","otro","family","družin")) return "otroci";
  if(has("food","street food","hran","kulinar")) return "hrana";
  if(has("sport","šport","match","tekma","run","maraton")) return "sport";
  if(has("nature","narav","hike","trek","outdoor")) return "narava";
  if(has("business","podjet","b2b","network","delavnica","seminar","konferenc")) return "za-podjetja";
  return "kultura";
}

/* ===== Izpostavljeno ===== */
async function loadFeatured(){
  let paid = [];
  try{
    const r1 = await fetch(`/api/provider-list?featured=1&limit=50`);
    const d1 = await r1.json().catch(()=>({}));
    paid = (d1 && d1.ok && d1.results) ? d1.results : [];
  }catch{}

  const params = GEO
    ? { latlon: GEO, radiuskm: 75, size: 50, page: 0 }
    : { city: $("#city")?.value.trim() || "Ljubljana", radiuskm: 150, size: 50, page: 0 };

  let apiItems=[];
  try{
    const r=await fetch(`/api/search?${qs(params)}`);
    const data=await r.json().catch(()=>({}));
    apiItems=(data && data.ok && data.results)||[];
  }catch(e){}

  const seen=new Set();
  const items=[...paid, ...apiItems].filter(e=>{
    const key = `${(e.name||'').toLowerCase()}|${e.start||''}`;
    if(seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const box=$("#carousel"); if(!box) return;
  box.innerHTML="";
  if(!items.length){
    box.innerHTML = `<div class="note" style="padding:10px">Trenutno ni izpostavljenih dogodkov v bližini.</div>`;
    return;
  }

  items.slice(0,20).forEach(e=>{
    const img=(e.images&&e.images[0])||"https://picsum.photos/1200/600?blur=1";

    // [COUPON] 2€ za kupon
    const isCoupon = e.offerType==="coupon";
    const showBuy  = isCoupon || (e.offerType==="ticket" && Number(e.price)>0);
    const priceToShow = isCoupon ? 2 : (e.price||0);

    const card=el("div","spot");
    card.innerHTML=`
      <img src="${img}" alt="">
      <div class="meta">
        <b>${e.name||"Dogodek"}</b>
        <div style="color:var(--muted);font-size:13px">${e.venue?.address||""}</div>
        <div style="color:var(--muted);font-size:13px">${e.start?new Date(e.start).toLocaleString():""}</div>
        <div style="margin-top:8px">
          ${(!!e.description && !e.url) ? `<button class="btn mini link" data-act="more">Več ▾</button>` :
           (e.url?`<a class="btn mini link" href="${e.url}" target="_blank" rel="noopener">Povezava</a>`:"")}
        </div>
        <div class="actions" style="margin-top:8px">
          <button class="btn mini" data-act="share" data-title="${encodeURIComponent(e.name||'Dogodek')}" data-url="${encodeURIComponent(e.url||location.href)}">Povabi še nekoga</button>
          <button class="btn mini" data-act="ics" data-title="${encodeURIComponent(e.name||'Dogodek')}" data-start="${e.start||""}" data-end="${e.end||""}" data-loc="${encodeURIComponent(e.venue?.address||'')}">Dodaj v koledar</button>
        </div>
        ${ showBuy ? `
          <div class="buy">
            <span class="price">${euro(priceToShow)}</span>
            <button class="btn mini"
                    data-act="buy"
                    data-kind="${e.offerType}"
                    data-name="${encodeURIComponent(e.name||'Dogodek')}"
                    data-benefit="${encodeURIComponent(e.couponDesc || e.display_benefit || '')}"
                    data-price="${priceToShow}">Kupi ${isCoupon?'kupon':'vstopnico'}</button>
          </div>` : ``}
        ${isCoupon && (e.couponDesc || e.display_benefit) ? `<div class="muted" style="font-size:12px">Kupon: ${e.couponDesc || e.display_benefit} (vnovči se pri ponudniku)</div>` : ``}
      </div>`;
    box.appendChild(card);
  });
  attachMiniActions();
  startAutoScroll();
}

/* ===== Deljenje / ICS / Več / Kupi ===== */
function attachMiniActions(){
  document.querySelectorAll("[data-act]").forEach(b=>{
    b.onclick=async ()=>{
      if(b.dataset.act==="share"){
        const title=decodeURIComponent(b.dataset.title||"Dogodek");
        const url=decodeURIComponent(b.dataset.url||location.href);
        const text="Greš tudi ti? 🎉";
        if(navigator.share){ navigator.share({title, text, url}).catch(()=>{}); }
        else{ navigator.clipboard.writeText(`${title} – ${url}`); alert("Povezava kopirana. Greš tudi ti?"); }
      }else if(b.dataset.act==="ics"){
        const title=decodeURIComponent(b.dataset.title||"Dogodek");
        const loc=decodeURIComponent(b.dataset.loc||"");
        const dt=s=>s?new Date(s).toISOString().replace(/[-:]/g,"").replace(/\.\d{3}Z/,"Z"):"";
        const ics=[
          "BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//NearGo//Events//EN","BEGIN:VEVENT",
          `UID:${Date.now()}@neargo`,
          b.dataset.start?`DTSTART:${dt(b.dataset.start)}`:"",
          b.dataset.end?`DTEND:${dt(b.dataset.end)}`:"",
          `SUMMARY:${title}`, loc?`LOCATION:${loc}`:"",
          "END:VEVENT","END:VCALENDAR"
        ].filter(Boolean).join("\r\n");
        const blob=new Blob([ics],{type:"text/calendar"});
        const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="neargo-event.ics"; a.click(); URL.revokeObjectURL(a.href);
      }else if(b.dataset.act==="more"){
        const wrap=b.closest('.meta, .card, .spot')||document;
        const box=wrap.querySelector('.more-text');
        if(box){ const open=box.style.display!=="none"; box.style.display=open?"none":"block"; b.textContent=open?"Več ▾":"Skrij ▴"; }
      }else if(b.dataset.act==="buy"){
        const kind  = b.dataset.kind || "ticket";
        const title = decodeURIComponent(b.dataset.name || "Dogodek");
        const amount= Number(b.dataset.price || 0);
        const benefitText = decodeURIComponent(b.dataset.benefit || ""); // [COUPON] opis ugodnosti

        const payload = (kind === "coupon")
          ? {
              type: "coupon",
              metadata: { type: "coupon", event_title: title, display_benefit: benefitText || undefined },
              successUrl: `${location.origin}/#success`,
              cancelUrl:  `${location.origin}/#cancel`
            }
          : {
              lineItems:[{
                name: `${kind==='coupon'?'Kupon':'Vstopnica'}: ${title}`.slice(0,60),
                description: kind,
                amount,
                currency:"eur",
                quantity:1
              }],
              successUrl: `${location.origin}/#success`,
              cancelUrl:  `${location.origin}/#cancel`
            };

        try{
          const r=await fetch("/api/checkout",{method:"POST",headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
          const data=await r.json();
          if(data && data.ok && data.url){ location.href=data.url; }
          else{ alert("Checkout ni uspel."); }
        }catch(e){ alert("Nepričakovana napaka pri nakupu."); }
      }
    };
  });
}

/* ===== Iskanje ===== */
let currentPage=0;

$("#btnUseLocation")?.addEventListener("click",()=>navigator.geolocation.getCurrentPosition(p=>{
  GEO=`${p.coords.latitude.toFixed(5)},${p.coords.longitude.toFixed(5)}`;
  doSearch(0,true);
},()=>alert("Lokacije ni bilo mogoče pridobiti.")));

$("#btnSearch")?.addEventListener("click",()=>doSearch(0,false));

async function doSearch(page=0, byGeo=false){
  showPanel("searchPanel");
  currentPage=page;

  const qVal = $("#q")?.value.trim() || "";
  const cityVal = $("#city")?.value.trim() || "";
  const catVal = document.querySelector(".cat.active")?.dataset.cat || "";
  const radiusVal = $("#radius")?.value || 30;

  const params = { q:qVal, radiuskm:radiusVal, page, size:20 };
  if (byGeo && GEO) params.latlon = GEO;
  else if (cityVal) params.city = cityVal;
  else if (GEO) params.latlon = GEO;

  let data=null;
  try{ const r=await fetch(`/api/search?${qs(params)}`); data=await r.json(); }catch{}
  const items=(data && data.ok && data.results)||[];
  items.forEach(e=>{ if(!e.category) e.category = detectCategory(e); });

  const filtered = catVal ? items.filter(e=>(e.category||"")===catVal) : items;

  const box=$("#results"); if(!box) return;
  box.innerHTML="";
  if(!filtered.length){
    box.innerHTML=`<div class="card" style="color:var(--muted)">Ni rezultatov. Poskusi večji radij ali drugo mesto.</div>`;
    if(mapSearch) { clearMarkers(markersSearch); }
    return;
  }

  filtered.forEach(e=>{
    const img=(e.images&&e.images[0])||"https://picsum.photos/600/400";

    // [COUPON] 2€ za kupon
    const isCoupon = e.offerType==="coupon";
    const showBuy  = isCoupon || (e.offerType==="ticket" && Number(e.price)>0);
    const priceToShow = isCoupon ? 2 : (e.price||0);

    const card=el("div","card");
    const head=`
      <div style="display:flex; gap:12px; align-items:flex-start">
        <div style="width:110px">
          <img src="${img}" alt="" style="width:110px;height:110px;object-fit:cover;border-radius:12px;border:1px solid var(--chipborder)">
          <div style="margin-top:6px">
            ${ (!!e.description && !e.url) ? `<button class="btn mini link" data-act="more">Več ▾</button>` :
              (e.url?`<a class="btn mini link" href="${e.url}" target="_blank" rel="noopener">Povezava</a>`:"") }
          </div>
        </div>
        <div style="flex:1; min-width:0">
          <b style="display:block; margin-bottom:4px; overflow:hidden; text-overflow:ellipsis;">${e.name||"Dogodek"}</b>
          <div style="color:var(--muted);font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis">${e.venue?.address||""}</div>
          <div style="color:var(--muted);font-size:13px">${e.start?new Date(e.start).toLocaleString():""}</div>
          ${ showBuy ? `
            <div class="buy">
              <span class="price">${euro(priceToShow)}</span>
              <button class="btn mini"
                      data-act="buy"
                      data-kind="${e.offerType}"
                      data-name="${encodeURIComponent(e.name||'Dogodek')}"
                      data-benefit="${encodeURIComponent(e.couponDesc || e.display_benefit || '')}"
                      data-price="${priceToShow}">Kupi ${isCoupon?'kupon':'vstopnico'}</button>
            </div>` : ``}
          ${isCoupon && (e.couponDesc || e.display_benefit) ? `<div class="muted" style="font-size:12px">Kupon: ${e.couponDesc || e.display_benefit} (vnovči se pri ponudniku)</div>` : ``}
        </div>
      </div>`;
    const more = e.description ? `<div class="more-text" style="display:none; margin-top:8px; color:var(--muted)">${e.description}</div>` : '';
    card.innerHTML = head + more;
    box.appendChild(card);
  });
  attachMiniActions();
  renderSearchMap(filtered);
  renderPagination(page);
}

function renderPagination(page){
  const p=$("#pagination"); if(!p) return;
  p.innerHTML="";
  const prev=el("button","btn link"); prev.textContent="Nazaj"; prev.disabled=page<=0; prev.onclick=()=>doSearch(page-1);
  const next=el("button","btn link"); next.textContent="Naprej"; next.onclick=()=>doSearch(page+1);
  p.append(prev,next);
}

/* ===== Zemljevid v iskanju ===== */
let mapSearch=null, markersSearch=[];
$("#btnMapInSearch")?.addEventListener("click",()=>{
  const wrap=$("#mapSearchWrap");
  if(!wrap) return;
  const isShown = wrap.style.display!=="none";
  wrap.style.display = isShown ? "none" : "block";
  if(!isShown && !mapSearch){
    mapSearch = L.map("mapSearch").setView([46.05,14.51],6);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:"© OSM"}).addTo(mapSearch);
  }
  $("#btnMapInSearch").textContent = wrap.style.display==="none" ? "Zemljevid" : "Zapri zemljevid";
});
function renderSearchMap(items){
  if(!mapSearch) return;
  clearMarkers(markersSearch);
  markersSearch = setMarkersOn(mapSearch, items);
}

/* ===== Upload slike ===== */
let IMAGE_URL = null;
const fileInput = $("#image");
const fileNameEl = $("#fileName");
const imgPrev = $("#imgPreview");

fileInput?.addEventListener("change", async ()=>{
  const f = fileInput.files && fileInput.files[0];
  if(!f){ if(fileNameEl) fileNameEl.textContent="Fotografija ni izbrana"; if(imgPrev) imgPrev.style.display="none"; IMAGE_URL=null; return; }
  if(fileNameEl) fileNameEl.textContent = f.name;

  const reader = new FileReader();
  reader.onload = e => { if(imgPrev){ imgPrev.src = e.target.result; imgPrev.style.display="inline-block"; } };
  reader.readAsDataURL(f);

  try{
    const fd = new FormData();
    fd.append("file", f, f.name);
    const r = await fetch("/api/provider-upload",{ method:"POST", body: fd });
    const data = await r.json();
    if(data.ok && data.imagePublicUrl){ IMAGE_URL = data.imagePublicUrl; }
    else{ IMAGE_URL = null; alert("Nalaganje slike ni uspelo: " + (data.error || "neznana napaka")); }
  }catch(e){ IMAGE_URL = null; alert("Nalaganje slike ni uspelo."); }
});

$("#desc")?.addEventListener("input", ()=>{
  const n=$("#desc").value.length;
  const c=$("#descCount"); if(c) c.textContent=`${n} / 800`;
});

/* ===== [COUPON] konfigurator (toggle + price=2) ===== */
const offerSel  = document.getElementById("offerType");
const priceEl   = document.getElementById("price");
const couponBox = document.getElementById("couponCfg");
const kindSel   = document.getElementById("couponKind");
const lblPercent= document.getElementById("lblPercent");
const lblValue  = document.getElementById("lblValue");
const lblFreebie= document.getElementById("lblFreebie");
const inPercent = document.getElementById("couponPercent");
const inValue   = document.getElementById("couponValue");
const inFreebie = document.getElementById("couponFreebie");

function setCouponKindUI(){
  if (!kindSel) return;
  const k = kindSel.value;
  if(lblPercent) lblPercent.style.display = (k==="PERCENT") ? "block" : "none";
  if(lblValue)   lblValue.style.display   = (k==="VALUE")   ? "block" : "none";
  if(lblFreebie) lblFreebie.style.display = (k==="FREEBIE") ? "block" : "none";
}
function onOfferChange(){
  if (!offerSel || !priceEl || !couponBox) return;
  const v = offerSel.value;
  if (v === "coupon"){
    priceEl.value = "2.00";
    priceEl.readOnly = true;
    priceEl.setAttribute("aria-readonly","true");
    couponBox.style.display = "block";
  } else {
    priceEl.readOnly = false;
    priceEl.removeAttribute("aria-readonly");
    couponBox.style.display = "none";
  }
}
offerSel?.addEventListener("change", onOfferChange);
kindSel?.addEventListener("change", setCouponKindUI);
onOfferChange(); setCouponKindUI();

/* ===== Oddaja dogodka ===== */
$("#btnSubmitEvent")?.addEventListener("click", async ()=>{
  const payload={
    organizer:$("#orgName")?.value.trim(),
    organizerEmail:$("#orgEmail")?.value.trim(),
    eventName:$("#eventName")?.value.trim(),
    venue:$("#venue")?.value.trim(),
    city:$("#city2")?.value.trim(),
    country:$("#country")?.value,
    start:$("#start")?.value,
    end:$("#end")?.value,
    url:$("#url")?.value.trim(),
    offerType: $("#offerType")?.value,
    price:$("#price")?.value?Number($("#price").value):null,
    stock:$("#stock")?.value?Number($("#stock").value):null,
    maxPerOrder:$("#maxPerOrder")?Number($("#maxPerOrder").value||0):null,
    description:$("#desc")?$("#desc").value.trim():"",
    category: $("#category")?$("#category").value:"",
    featured: $("#featured")?$("#featured").checked:false,
    imagePublicUrl: IMAGE_URL || null
  };

  // [COUPON] vključi kupon polja; server prisili price=2 in validira
  if (payload.offerType === "coupon") {
    payload.price = 2;
    payload.couponKind = kindSel?.value || "PERCENT";
    payload.couponPercentOff   = (payload.couponKind === "PERCENT") ? Number(inPercent?.value || 0) : null;
    payload.couponValueEur     = (payload.couponKind === "VALUE")   ? Number(inValue?.value   || 0) : null;
    payload.couponFreebieLabel = (payload.couponKind === "FREEBIE") ? (inFreebie?.value || "").trim() : null;
  }

  const msg=$("#orgMsg"); if(msg) msg.textContent="Pošiljam…";
  try{
    const r=await fetch("/api/provider-submit",{method:"POST",headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
    const data=await r.json();
    if(msg) msg.textContent=data.ok?"Prijava sprejeta – prejeli boste potrditev po e-pošti.":"Napaka: "+(data.error||"neznano");
  }catch(e){
    if(msg) msg.textContent="Napaka pri pošiljanju.";
  }
});

/* ===== Zgornji zemljevid – prikaži VSE (provider + API) ===== */
async function refreshTopMap(){
  const base = { radiuskm: 500, size: 400, page: 0 };
  const center = GEO ? { latlon: GEO } : { city: $("#city")?.value.trim() || "Ljubljana" };

  let providerAll=[];
  try{
    const rP = await fetch(`/api/provider-list?limit=500`);
    const dP = await rP.json().catch(()=>({}));
    providerAll = (dP && dP.ok && dP.results) ? dP.results : [];
  }catch{}

  let apiAll=[];
  try{
    const rA = await fetch(`/api/search?${qs({...center, ...base})}`);
    const dA = await rA.json().catch(()=>({}));
    apiAll = (dA && dA.ok && dA.results) ? dA.results : [];
  }catch{}

  const all = [...providerAll, ...apiAll];
  setTopMarkers(all);
}

/* ===== Tipkanje v Zakaj NearGo (ostane) ===== */
(function slowType(){
  const host = document.querySelector('#benefits ul.typing');
  if(!host) return;
  host.querySelectorAll('li b').forEach(b=>{
    if(b.dataset.split) return;
    const text = b.textContent;
    b.textContent='';
    [...text].forEach(ch=>{
      if(ch===' '){ b.appendChild(document.createTextNode(' ')); return; }
      const em=document.createElement('em');
      em.textContent=ch;
      b.appendChild(em);
    });
    b.dataset.split='1';
  });
  function cycle(){
    host.querySelectorAll('li b').forEach((b)=>{
      const letters=[...b.querySelectorAll('em')];
      letters.forEach((em)=>em.classList.remove('show'));
      letters.forEach((em,j)=>{ setTimeout(()=>em.classList.add('show'), 140*j); });
    });
    setTimeout(cycle, 4200);
  }
  cycle();
})();

/* ===== PWA SW ===== */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(()=>{}); });
    }
