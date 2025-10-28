// ===== Hero sekcija: štetje odprtij in skrivanje =====
document.addEventListener("DOMContentLoaded", function() {
  const hero = document.getElementById("hero");
  const btnPremium = document.getElementById("btnPremiumTop");
  // Števec odprtij aplikacije
  let openCount = Number(localStorage.getItem("ng_app_open_count") || 0) + 1;
  localStorage.setItem("ng_app_open_count", openCount);
  if (hero) {
    // Skrij hero sekcijo, če je uporabnik odprl app vsaj 5x
    if (openCount >= 5) {
      hero.style.display = "none";
    } else {
      // Skrij po 5 sekundah
      setTimeout(() => { hero.style.display = "none"; }, 5000);
    }
    // Skrij takoj ob kliku na Premium
    if (btnPremium) {
      btnPremium.addEventListener("click", () => { hero.style.display = "none"; });
    }
  }
});
// ===== Predčasna obvestila za Premium uporabnike =====
document.addEventListener("DOMContentLoaded", function() {
  const form = document.getElementById("earlyNotifyForm");
  const confirmation = document.getElementById("earlyNotifyConfirmation");
  if (form) {
    // Ob submit shrani izbrane kategorije v localStorage
    form.addEventListener("submit", function(e) {
      e.preventDefault();
      const checked = Array.from(form.querySelectorAll("input[type=checkbox]:checked"))
        .map(cb => cb.value);
      localStorage.setItem("ng_early_notify_categories", JSON.stringify(checked));
      if (confirmation) {
        confirmation.textContent = "Predčasna obvestila so vključena za izbrane kategorije.";
        confirmation.style.display = "block";
        setTimeout(() => { confirmation.style.display = "none"; }, 4000);
      }
    });
    // Ob nalaganju strani označi že izbrane kategorije
    const saved = localStorage.getItem("ng_early_notify_categories");
    if (saved) {
      try {
        const arr = JSON.parse(saved);
        form.querySelectorAll("input[type=checkbox]").forEach(cb => {
          cb.checked = arr.includes(cb.value);
        });
      } catch {}
    }
  }
});
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

/* ===== Jezik ===== */
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

/* ===== Toast ===== */
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

/* ===== Navigacija ===== */
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

  // [COUPON] izračun
  const isCoupon = e.offerType === "coupon";
  const showBuy  = isCoupon || (e.offerType==="ticket" && Number(e.price)>0);
  const priceToShow = isCoupon ? 2 : (e.price || 0);

  card.innerHTML = `
    <div style="display:flex; gap:12px; align-items:flex-start">
      <div style="width:110px">
        <img src="${img}" alt="" style="width:110px;height:110px;object-fit:cover;border-radius:12px;border:1px solid var(--chipborder)">
      </div>
      <div style="flex:1; min-width:0">
        <b>${e.name||"Dogodek"}</b>
        <div style="color:var(--muted);font-size:13px">${e.venue?.address||""}</div>
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
          </div>
          ${isCoupon && (e.couponDesc || e.display_benefit) ? `<div class="muted" style="font-size:12px">Kupon: ${e.couponDesc || e.display_benefit} (vnovči se pri ponudniku)</div>` : ``}
        ` : ``}
      </div>
    </div>`;
  host.appendChild(card);
  attachMiniActions();
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

  const filtered = catVal ? items.filter(e=>(e.category||"")===catVal) : items;
  const box=$("#results"); if(!box) return;
  box.innerHTML="";

  filtered.forEach(e=>{
    const img=(e.images&&e.images[0])||"https://picsum.photos/600/400";
    const isCoupon = e.offerType==="coupon";
    const showBuy  = isCoupon || (e.offerType==="ticket" && Number(e.price)>0);
    const priceToShow = isCoupon ? 2 : (e.price||0);

    const card=el("div","card");
    card.innerHTML=`
      <b>${e.name||"Dogodek"}</b>
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
        ${isCoupon && (e.couponDesc || e.display_benefit) ? `<div class="muted">Kupon: ${e.couponDesc || e.display_benefit} (vnovči se pri ponudniku)</div>` : ``}
      ` : ``}`;
    box.appendChild(card);
  });
  attachMiniActions();
}

/* ===== Gumbi (share, ics, buy) ===== */
function attachMiniActions(){
  document.querySelectorAll("[data-act]").forEach(b=>{
    b.onclick=async ()=>{
      if(b.dataset.act==="buy"){
        const kind  = b.dataset.kind || "ticket";
        const title = decodeURIComponent(b.dataset.name || "Dogodek");
        const amount= Number(b.dataset.price || 0);
        const benefitText = decodeURIComponent(b.dataset.benefit || "");

        const payload = (kind === "coupon")
          ? {
              type: "coupon",
              metadata: { type: "coupon", event_title: title, display_benefit: benefitText || undefined },
              successUrl: `${location.origin}/#success`,
              cancelUrl:  `${location.origin}/#cancel`
            }
          : {
              lineItems:[{ name: `${kind==='coupon'?'Kupon':'Vstopnica'}: ${title}`, description: kind, amount, currency:"eur", quantity:1 }],
              successUrl: `${location.origin}/#success`,
              cancelUrl:  `${location.origin}/#cancel`
            };

        const r=await fetch("/api/checkout",{method:"POST",headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
        const data=await r.json();
        if(data && data.ok && data.url){ location.href=data.url; }
        else{ alert("Checkout ni uspel."); }
      }
    };
  });
}

/* ===== Kupon konfigurator ===== */
const offerSel  = document.getElementById("offerType");
const priceEl   = document.getElementById("price");
const couponBox = document.getElementById("couponCfg");
const kindSel   = document.getElementById("couponKind");
const inPercent = document.getElementById("couponPercent");
const inValue   = document.getElementById("couponValue");
const inFreebie = document.getElementById("couponFreebie");

function onOfferChange(){
  if (!offerSel || !priceEl || !couponBox) return;
  if (offerSel.value === "coupon"){
    priceEl.value = "2.00";
    priceEl.readOnly = true;
    couponBox.style.display = "block";
  } else {
    priceEl.readOnly = false;
    couponBox.style.display = "none";
  }
}
offerSel?.addEventListener("change", onOfferChange);
onOfferChange();

/* ===== Submit dogodka ===== */
$("#btnSubmitEvent")?.addEventListener("click", async ()=>{
  const payload={
    organizer:$("#orgName")?.value.trim(),
    organizerEmail:$("#orgEmail")?.value.trim(),
    eventName:$("#eventName")?.value.trim(),
    offerType: $("#offerType")?.value,
    price:$("#price")?.value?Number($("#price").value):null,
    description:$("#desc")?.value.trim()
  };

  if (payload.offerType==="coupon"){
    payload.price=2;
    payload.couponKind = kindSel?.value || "PERCENT";
    payload.couponPercentOff = inPercent?.value||null;
    payload.couponValueEur   = inValue?.value||null;
    payload.couponFreebieLabel = inFreebie?.value||null;
  }

  await fetch("/api/provider-submit",{method:"POST",headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
});
