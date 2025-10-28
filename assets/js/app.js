// ===== Points badge (osveževanje) =====
import { getUserPoints } from '../../providers/supabase-points.js';
async function refreshPointsBadge() {
  const badge = document.getElementById('pointsBadge');
  const email = localStorage.getItem('user_email');
  if (!badge || !email) return;
  const points = await getUserPoints(email);
  badge.textContent = points;
  badge.style.display = points > 0 ? 'inline-flex' : 'none';
}
document.addEventListener('DOMContentLoaded', refreshPointsBadge);
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
      const location = document.getElementById("earlyNotifyLocation")?.value?.trim() || "";
      const radius = Number(document.getElementById("earlyNotifyRadius")?.value || 30);
      localStorage.setItem("ng_early_notify_categories", JSON.stringify({categories: checked, location, radius}));
      if (confirmation) {
        confirmation.textContent = "Predčasna obvestila so vključena za izbrane kategorije in lokacijo.";
        confirmation.style.display = "block";
        setTimeout(() => { confirmation.style.display = "none"; }, 4000);
      }
    });
    // Ob nalaganju strani označi že izbrane kategorije, lokacijo in radij
    const saved = localStorage.getItem("ng_early_notify_categories");
    if (saved) {
      try {
        const obj = JSON.parse(saved);
        if (obj.categories) {
          form.querySelectorAll("input[type=checkbox]").forEach(cb => {
            cb.checked = obj.categories.includes(cb.value);
          });
        }
        if (obj.location) {
          document.getElementById("earlyNotifyLocation").value = obj.location;
        }
        if (obj.radius) {
          document.getElementById("earlyNotifyRadius").value = obj.radius;
        }
      } catch {}
    }
  }
});
"use strict";

/* ===== Helpers ===== */
// ===== Kategorije z ikonami =====
const CATEGORY_ICONS = {
  'Koncerti': 'guitar.svg',
  'Kulinarika': 'food.svg',
  'Družina': 'family.svg',
  'Šport': 'sport.svg',
  'Kultura': 'culture.svg',
  'Sejmi': 'fair.svg',
  'Ostalo': 'other.svg',
};

function renderCategoryChips() {
  const cats = document.getElementById('cats');
  if (!cats) return;
  cats.innerHTML = '';
  Object.entries(CATEGORY_ICONS).forEach(([cat, icon]) => {
    const btn = document.createElement('button');
    btn.className = 'chip';
    btn.setAttribute('data-cat', cat);
    btn.setAttribute('aria-label', cat);
    btn.innerHTML = `<img src="assets/icons/${icon}" alt="${cat}" class="cat-icon" style="width:32px;height:32px;display:block;margin:0 auto;"/><span class="cat-label" style="display:none">${cat}</span>`;
    btn.addEventListener('click', function() {
      document.querySelectorAll('#cats .chip').forEach(b => {
        b.classList.remove('active');
        b.querySelector('.cat-label').style.display = 'none';
      });
      btn.classList.add('active');
      btn.querySelector('.cat-label').style.display = 'block';
      doSearch(0);
    });
    cats.appendChild(btn);
  });
}
document.addEventListener('DOMContentLoaded', renderCategoryChips);
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
  const now = Date.now();
  const isLive = e.start && e.end && (now >= new Date(e.start).getTime() && now <= new Date(e.end).getTime());
  card.innerHTML = `
    <div style="display:flex; gap:12px; align-items:flex-start">
      <div style="width:110px">
        <img src="${img}" alt="" style="width:110px;height:110px;object-fit:cover;border-radius:12px;border:1px solid var(--chipborder)">
      </div>
      <div style="flex:1; min-width:0">
        <b>${e.name||"Dogodek"}</b>
        ${isLive ? `<span class="badge live">🟢 V teku</span>` : ""}
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
  updateLiveBanner(items);

  const filtered = catVal ? items.filter(e=>(e.category||"")===catVal) : items;
  const box=$("#results"); if(!box) return;
  box.innerHTML="";

  const now = Date.now();
  filtered.forEach(e=>{
    const img=(e.images&&e.images[0])||"https://picsum.photos/600/400";
    const isCoupon = e.offerType==="coupon";
    const showBuy  = isCoupon || (e.offerType==="ticket" && Number(e.price)>0);
    const priceToShow = isCoupon ? 2 : (e.price||0);
    const isLive = e.start && e.end && (now >= new Date(e.start).getTime() && now <= new Date(e.end).getTime());

    const card=el("div","card");
    card.innerHTML=`
      <b>${e.name||"Dogodek"}</b>
      ${isLive ? `<span class="badge live">🟢 V teku</span>` : ""}
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
// ===== Živi dogodki: pasica in gumb za zemljevid =====
let liveEvents = [];
function updateLiveBanner(items) {
  const now = Date.now();
  liveEvents = items.filter(e => e.start && e.end && (now >= new Date(e.start).getTime() && now <= new Date(e.end).getTime()));
  const liveCount = document.getElementById('liveCount');
  if (liveCount) liveCount.textContent = liveEvents.length;
}

document.getElementById('btnShowLiveMap')?.addEventListener('click', () => {
  showPanel('mapPanel');
  // Prikaži samo žive dogodke na zemljevidu
  if (typeof refreshTopMap === 'function') refreshTopMap(liveEvents);
});
document.getElementById('liveInfoBtn')?.addEventListener('click', function() {
  const info = document.getElementById('liveInfoText');
  if (info) info.style.display = info.style.display === 'none' ? 'block' : 'none';
});
// ===== Referral program =====
import { getReferralCode, getReferralStats } from '../providers/supabase-referral.js';

document.addEventListener('DOMContentLoaded', async function() {
  const email = localStorage.getItem('user_email');
  const referralLinkInput = document.getElementById('referralLink');
  const copyBtn = document.getElementById('copyReferralBtn');
  const progress = document.getElementById('referralProgress');
  const rewardMsg = document.getElementById('referralRewardMsg');
  if (email && referralLinkInput) {
    const userId = email; // ali user_id, če je na voljo
    const link = await getReferralCode(userId);
    referralLinkInput.value = link;
    copyBtn.onclick = () => {
      referralLinkInput.select();
      document.execCommand('copy');
      rewardMsg.textContent = 'Povezava kopirana!';
      rewardMsg.style.display = 'block';
      setTimeout(()=>rewardMsg.style.display='none', 2500);
    };
    // Prikaz napredka do nagrade
    const stats = await getReferralStats(userId);
    const nextReward = 2 - (stats.successfulReferrals % 2);
    progress.textContent = `Še ${nextReward} povabilo do brezplačnega Premium meseca.`;
    // Prikaz obvestila o Flash kuponu
    // (dobi iz Supabase, če je freeFlashCoupons > 0)
    // ...
  } else if (referralLinkInput) {
    referralLinkInput.value = 'Vpiši e-pošto za referral povezavo.';
    copyBtn.disabled = true;
    progress.textContent = '';
  }
});
// ===== Real-time osveževanje dogodkov in referral napredka =====
let lastSearchParams = null;
async function refreshEventsRealtime() {
  if (!lastSearchParams) return;
  try {
    const r = await fetch(`/api/search?${qs(lastSearchParams)}`);
    const data = await r.json();
    const items = (data && data.ok && data.results) || [];
    updateLiveBanner(items);
    // Osveži prikaz dogodkov (po potrebi re-call doSearch ali custom render)
    // ...
  } catch {}
}

// Shrani zadnje parametre ob iskanju
async function doSearch(page=0, byGeo=false){
  // ...existing code...
  const params = { q:qVal, radiuskm:radiusVal, page, size:20 };
  // ...existing code...
  lastSearchParams = params;
  // ...existing code...
}
  // ===== Ikone kategorij v obrazcu za dodajanje =====
  const FORM_EVENT_CATS = {
    'Koncerti': 'guitar.svg',
    'Kulinarika': 'food.svg',
    'Družina & otroci': 'family.svg',
    'Šport': 'sport.svg',
    'Kultura': 'culture.svg',
    'Sejmi': 'fair.svg',
    'Ostalo': 'other.svg',
  };
  const FORM_SERVICE_CATS = {
    'Lepota': 'beauty.svg',
    'Zdravje': 'health.svg',
    'Wellness': 'wellness.svg',
    'Šport & fit': 'fit.svg',
    'Kulinarika': 'food.svg',
    'Učenje': 'learn.svg',
    'Servis': 'service.svg',
    'Avto': 'car.svg',
    'Dom & vrt': 'home-garden.svg',
    'Ostalo': 'other.svg',
  };

  function renderFormCategoryIcons() {
    const entryType = document.getElementById('entryType');
    const catsContainer = document.getElementById('formCatsIcons');
    const sel = document.getElementById('category');
    if (!catsContainer || !sel) return;
    catsContainer.innerHTML = '';
    sel.style.display = 'none';
    const cats = (entryType?.value === 'service') ? FORM_SERVICE_CATS : FORM_EVENT_CATS;
    Object.entries(cats).forEach(([cat, icon]) => {
      const btn = document.createElement('button');
      btn.className = 'chip';
      btn.setAttribute('type', 'button');
      btn.setAttribute('data-cat', cat);
      btn.setAttribute('aria-label', cat);
      btn.innerHTML = `<img src="assets/icons/${icon}" alt="${cat}" class="cat-icon"/><span class="cat-label" style="display:none">${cat}</span>`;
      btn.addEventListener('click', function() {
        document.querySelectorAll('#formCatsIcons .chip').forEach(b => {
          b.classList.remove('active');
          b.querySelector('.cat-label').style.display = 'none';
        });
        btn.classList.add('active');
        btn.querySelector('.cat-label').style.display = 'block';
        sel.value = cat;
        sel.dispatchEvent(new Event('change'));
      });
      catsContainer.appendChild(btn);
    });
  }
  document.addEventListener('DOMContentLoaded', function() {
    if (document.getElementById('formCatsIcons')) renderFormCategoryIcons();
    document.getElementById('entryType')?.addEventListener('change', renderFormCategoryIcons);
  });

setInterval(refreshEventsRealtime, 15000); // osveži vsakih 15s

// ===== Real-time osveževanje referral napredka =====
async function refreshReferralProgress() {
  const email = localStorage.getItem('user_email');
  const progress = document.getElementById('referralProgress');
  if (email && progress) {
    const userId = email;
    const stats = await getReferralStats(userId);
    const nextReward = 2 - (stats.successfulReferrals % 2);
    progress.textContent = `Še ${nextReward} povabilo do brezplačnega Premium meseca.`;
    progress.classList.add('pulse-anim');
    setTimeout(()=>progress.classList.remove('pulse-anim'), 1200);
  }
}
setInterval(refreshReferralProgress, 20000); // osveži vsakih 20s
