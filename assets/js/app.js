import { getCategoryList } from '../categories.js';
import { getUserPoints } from '../../providers/supabase-points.js';
import { CATEGORY_SOURCE } from '../data/categories/index.js';

// ===== PREMIUM / PROVIDER PLAN CHECKS =====
function checkPremiumAccess() {
  if (typeof IS_PREMIUM !== 'undefined' && !IS_PREMIUM) {
    window.location.href = '/premium.html';
    return false;
  }
  return true;
}
function checkProviderPlan(requiredPlan) {
  var plan = window.PROVIDER_PLAN || localStorage.getItem('ng_provider_plan') || 'free';
  if (plan === 'free' && requiredPlan !== 'free') {
    window.location.href = '/providers.html#plans';
    return false;
  }
  return true;
}


const ICON_BASE = '/assets/icons';

const normalizeIconPath = (icon) => {
  if (!icon) return null;
  return icon.startsWith('/') ? icon : `${ICON_BASE}/${icon}`;
};

const cloneSourceCategory = (cat = {}) => ({
  key: cat.key,
  label: cat.label,
  emoji: cat.emoji || null,
  icon: normalizeIconPath(cat.icon || ''),
  sub: Array.isArray(cat.sub) ? cat.sub.map((item) => ({ key: item.key, label: item.label })) : []
});

const deepCloneList = (list = []) => list.map((cat) => ({
  ...cat,
  sub: Array.isArray(cat.sub) ? cat.sub.map((sub) => ({ ...sub })) : []
}));

const SOURCE_FALLBACK = {
  events: Array.isArray(CATEGORY_SOURCE?.events) ? CATEGORY_SOURCE.events.map(cloneSourceCategory) : [],
  services: Array.isArray(CATEGORY_SOURCE?.services) ? CATEGORY_SOURCE.services.map(cloneSourceCategory) : []
};

const getCanonicalCategories = (type = 'events') => {
  const list = getCategoryList(type);
  if (Array.isArray(list) && list.length) return deepCloneList(list);
  const fallback = SOURCE_FALLBACK[type] || [];
  return deepCloneList(fallback);
};

// ===== Early-notify renderer (populate premium.html) =====
const buildEarlyNotifyCategoryList = (selectedKeys = []) => {
  const container = document.getElementById('earlyNotifyCategoryList');
  if (!container) return;
  const selectedSet = new Set(Array.isArray(selectedKeys) ? selectedKeys : []);
  container.innerHTML = '';

  const sections = [
    { title: 'Dogodki', type: 'events' },
    { title: 'Storitve', type: 'services' }
  ];

  sections.forEach(({ title, type }) => {
    const list = getCanonicalCategories(type);
    if (!Array.isArray(list) || !list.length) return;

    const section = document.createElement('section');
    section.className = 'early-notify-section';
    section.style.marginBottom = '18px';

    const heading = document.createElement('h3');
    heading.textContent = title;
    heading.className = 'early-notify-title';
    heading.style.margin = '0 0 8px 0';
    heading.style.fontSize = '1.05em';
    heading.style.fontWeight = '800';
    section.appendChild(heading);

    const itemsWrap = document.createElement('div');
    itemsWrap.className = 'early-notify-grid';
    itemsWrap.style.display = 'flex';
    itemsWrap.style.flexWrap = 'wrap';
    itemsWrap.style.gap = '10px';

    list.forEach((cat) => {
      if (!cat?.key) return;
      const item = document.createElement('div');
      item.className = 'early-notify-item';
  item.style.display = 'flex';
  item.style.flexDirection = 'column';
  item.style.gap = '6px';

      const label = document.createElement('label');
      label.className = 'cat-chip early-cat';
      label.dataset.cat = cat.key;
      label.setAttribute('aria-pressed', 'false');
      label.style.position = 'relative';
      label.style.display = 'inline-flex';
      label.style.alignItems = 'center';
      label.style.gap = '8px';
      label.style.cursor = 'pointer';

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.name = 'categories';
      input.value = cat.key;
      input.style.position = 'absolute';
      input.style.opacity = '0';
      input.style.pointerEvents = 'none';
      input.style.width = '1px';
      input.style.height = '1px';

      const setChipState = (checked) => {
        if (checked) {
          label.classList.add('active');
          label.setAttribute('aria-pressed', 'true');
          toggleChipLabel(label, true);
        } else {
          label.classList.remove('active');
          label.setAttribute('aria-pressed', 'false');
          toggleChipLabel(label, false);
        }
      };

      input.addEventListener('change', () => {
        setChipState(input.checked);
      });

      label.addEventListener('mouseenter', () => toggleChipLabel(label, true));
      label.addEventListener('mouseleave', () => toggleChipLabel(label, false));
      label.addEventListener('focus', () => toggleChipLabel(label, true));
      label.addEventListener('blur', () => toggleChipLabel(label, false));
      label.addEventListener('touchstart', () => toggleChipLabel(label, true), { passive: true });
      label.addEventListener('touchend', () => toggleChipLabel(label, false));

      if (cat.icon) {
        const img = document.createElement('img');
        img.src = cat.icon;
        img.alt = '';
        img.loading = 'lazy';
        label.appendChild(img);
      } else {
        const emoji = document.createElement('span');
        emoji.className = 'cat-emoji';
        emoji.setAttribute('aria-hidden', 'true');
        emoji.textContent = cat.emoji || '🏷️';
        label.appendChild(emoji);
      }

      const text = document.createElement('span');
      text.className = 'cat-label';
      text.textContent = cat.label || cat.key;
      label.appendChild(text);

      if (selectedSet.has(cat.key)) {
        input.checked = true;
      }
      setChipState(input.checked);

      label.appendChild(input);
      item.appendChild(label);

      if (Array.isArray(cat.sub) && cat.sub.length) {
        const subList = document.createElement('ul');
        subList.className = 'early-subcategories';
        subList.style.margin = '0 0 0 26px';
        subList.style.padding = '0';
        subList.style.listStyle = 'disc';
        subList.style.color = 'var(--muted, #555)';
        subList.style.fontSize = '13px';
        cat.sub.forEach((sub) => {
          if (!sub?.label) return;
          const li = document.createElement('li');
          li.textContent = sub.label;
          subList.appendChild(li);
        });
        item.appendChild(subList);
      }

      itemsWrap.appendChild(item);
    });

    section.appendChild(itemsWrap);
    container.appendChild(section);
  });
};

const readEarlyNotifyState = () => {
  try {
    const stored = JSON.parse(localStorage.getItem('ng_early_notify_categories') || '{}');
    return {
      categories: Array.isArray(stored?.categories) ? stored.categories : [],
      location: stored?.location || '',
      radius: Number.isFinite(Number(stored?.radius)) ? Number(stored.radius) : 30
    };
  } catch {
    return { categories: [], location: '', radius: 30 };
  }
};

const hydrateEarlyNotifyUI = () => {
  const container = document.getElementById('earlyNotifyCategoryList');
  if (!container) return;
  const { categories, location, radius } = readEarlyNotifyState();
  buildEarlyNotifyCategoryList(categories);
  const locationInput = document.getElementById('earlyNotifyLocation');
  if (locationInput) locationInput.value = location || '';
  const radiusInput = document.getElementById('earlyNotifyRadius');
  if (radiusInput) radiusInput.value = Number.isFinite(radius) ? radius : 30;
};

document.addEventListener('DOMContentLoaded', () => {
  hydrateEarlyNotifyUI();
});

document.addEventListener('neargo:categories-ready', () => {
  hydrateEarlyNotifyUI();
});

// ===== Points badge (osveževanje) =====
async function refreshPointsBadge() {
  const badge = document.getElementById('pointsBadge');
  const email = localStorage.getItem('user_email');
  if (!badge || !email) return;
  const points = await getUserPoints(email);
  badge.textContent = points;
  badge.style.display = points > 0 ? 'inline-flex' : 'none';
  // Progress bar v my.html
  const progress = document.getElementById('pointsProgress');
  const label = document.getElementById('pointsProgressLabel');
  if (progress && label) {
    progress.value = Math.min(points, 100);
    label.textContent = `${points} / 100`;
  }
}
document.addEventListener('DOMContentLoaded', function() {
  refreshPointsBadge();
  // Prikaz pasice za točke
  const banner = document.getElementById('pointsBanner');
  const closeBtn = document.getElementById('pointsBannerClose');
  const email = localStorage.getItem('user_email');
  if (banner && !email) {
    banner.style.display = 'flex';
    closeBtn.onclick = () => { banner.style.display = 'none'; };
    setTimeout(() => { banner.style.display = 'none'; }, 12000);
  }
});
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
    form.addEventListener("submit", function(e) {
      if (!checkPremiumAccess()) {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      const checked = Array.from(form.querySelectorAll("input[type=checkbox]:checked"))
        .map(cb => cb.value);
      const location = document.getElementById("earlyNotifyLocation")?.value?.trim() || "";
      const radius = Number(document.getElementById("earlyNotifyRadius")?.value || 30);
      localStorage.setItem("ng_early_notify_categories", JSON.stringify({categories: checked, location, radius}));
      hydrateEarlyNotifyUI();
      if (confirmation) {
        confirmation.textContent = "Predčasna obvestila so vključena za izbrane kategorije in lokacijo.";
        confirmation.style.display = "block";
        setTimeout(() => { confirmation.style.display = "none"; }, 4000);
      }
    });
  }
// ===== Analitika in Boost izpostavitev (Provider plan) =====
document.addEventListener('DOMContentLoaded', function() {
  var hubStats = document.getElementById('hubStats');
  if (hubStats) {
    hubStats.addEventListener('click', function(e) {
      if (!checkProviderPlan('grow')) {
        e.preventDefault();
        return;
      }
    });
  }
  var hubBoost = document.getElementById('hubBoost');
  if (hubBoost) {
    hubBoost.addEventListener('click', function(e) {
      if (!checkProviderPlan('grow')) {
        e.preventDefault();
        return;
      }
    });
  }
});
});
"use strict";

/* ===== Helpers ===== */
const withCategories = (callback) => {
  const data = window.NearGoCategories;
  if (data && (Array.isArray(data.events) || Array.isArray(data.services))) {
    callback(data);
    return;
  }

  const bootstrap = window.NearGoCategoryBootstrap;
  if (bootstrap && (Array.isArray(bootstrap.events) || Array.isArray(bootstrap.services))) {
    callback(bootstrap);
  }

  document.addEventListener('neargo:categories-ready', () => {
    const latest = window.NearGoCategories || window.NearGoCategoryBootstrap || {};
    callback(latest);
  }, { once: true });
};

const getCategoriesForType = (type = 'events') => {
  const source = window.NearGoCategories || window.NearGoCategoryBootstrap || {};
  const list = source[type];
  if (Array.isArray(list) && list.length) return list;
  return getCanonicalCategories(type);
};

const toggleChipLabel = (chip, show) => {
  if (!chip) return;
  if (show) {
    chip.classList.add('show-label');
  } else if (!chip.classList.contains('active')) {
    chip.classList.remove('show-label');
  }
};

function renderCategoryChips() {
  const wrap = document.getElementById('cats');
  if (!wrap) return;
  const subWrap = document.getElementById('searchSubcategoryWrap');
  const subSelect = document.getElementById('searchSubcategory');
  let activeKey = wrap.dataset.selectedCat || '';

  const apply = (categories) => {
    wrap.innerHTML = '';
    if (!Array.isArray(categories) || !categories.length) return;

    const setActive = (key, opts = {}) => {
      const { silent } = opts;
      const nextBtn = key ? wrap.querySelector(`[data-cat="${key}"]`) : null;
      const fallbackBtn = wrap.querySelector('.cat-chip');
      const target = nextBtn || fallbackBtn;
      if (!target) return;

      wrap.querySelectorAll('.cat-chip').forEach((btn) => {
        btn.classList.remove('active');
        btn.setAttribute('aria-pressed', 'false');
        toggleChipLabel(btn, false);
      });
      target.classList.add('active');
      target.setAttribute('aria-pressed', 'true');
      toggleChipLabel(target, true);
      activeKey = target.dataset.cat || '';
      wrap.dataset.selectedCat = activeKey;
      if (subSelect) populateSubcategories(activeKey);
      if (!silent) doSearch(0);
    };

    categories.forEach((cat) => {
      if (!cat?.key) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      // use the unified cat-chip styling so appearance matches app
      btn.className = 'cat-chip';
      btn.dataset.cat = cat.key;
      btn.setAttribute('aria-label', cat.label || cat.key);
      btn.setAttribute('aria-pressed', 'false');

      // icon (prefer image) + label
      const imgHtml = cat.icon
        ? `<img src="${cat.icon}" alt="" loading="lazy">`
        : `<span class="cat-emoji" aria-hidden="true">${cat.emoji || '🏷️'}</span>`;
      btn.innerHTML = `${imgHtml}<span class="cat-label">${cat.label || cat.key}</span>`;
      btn.addEventListener('mouseenter', () => toggleChipLabel(btn, true));
      btn.addEventListener('mouseleave', () => toggleChipLabel(btn, false));
      btn.addEventListener('focus', () => toggleChipLabel(btn, true));
      btn.addEventListener('blur', () => toggleChipLabel(btn, false));
      btn.addEventListener('touchstart', () => toggleChipLabel(btn, true), { passive: true });
      btn.addEventListener('touchend', () => toggleChipLabel(btn, false));
      btn.addEventListener('click', () => {
        subSelect?.removeAttribute('data-selected-sub');
        setActive(cat.key);
      });
      wrap.appendChild(btn);
    });

    const initialKey = activeKey && categories.some((cat) => cat.key === activeKey)
      ? activeKey
      : categories[0].key;
    setActive(initialKey, { silent: true });
  };

  const populateSubcategories = (key) => {
    if (!subSelect) return;
    const utils = window.NearGoCategoryUtils;
    let subs = utils?.getSubcategories('events', key) || [];
    if (!subs.length) {
      const fallbackCat = getCanonicalCategories('events').find((cat) => cat.key === key);
      subs = fallbackCat && Array.isArray(fallbackCat.sub) ? fallbackCat.sub : [];
    }
    subSelect.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Podkategorija (neobvezno)';
    subSelect.appendChild(placeholder);
    subs.forEach((sub) => {
      const option = document.createElement('option');
      option.value = sub.key;
      option.textContent = sub.label;
      subSelect.appendChild(option);
    });
    const hasSubs = subs.length > 0;
    if (subWrap) subWrap.style.display = hasSubs ? 'block' : 'none';
    subSelect.disabled = !hasSubs;
    if (!hasSubs) {
      subSelect.value = '';
      subSelect.dataset.selectedSub = '';
    } else if (subSelect.dataset.selectedSub) {
      const wanted = subSelect.dataset.selectedSub;
      const hasWanted = Array.from(subSelect.options).some((opt) => opt.value === wanted);
      subSelect.value = hasWanted ? wanted : '';
    }
  };

  withCategories((data) => {
    const list = Array.isArray(data.events) && data.events.length
      ? data.events
      : getCanonicalCategories('events');
    apply(list);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  renderCategoryChips();
  document.getElementById('searchSubcategory')?.addEventListener('change', () => {
    const select = document.getElementById('searchSubcategory');
    if (select) select.dataset.selectedSub = select.value || '';
    doSearch(0);
  });
});
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

// ===== Navigacija & Preusmeritve =====
function isLoggedIn() {
  // Preveri prijavo (npr. po emailu ali tokenu v localStorage)
  return !!localStorage.getItem('user_email') || !!localStorage.getItem('user_token');
}
function saveIntent(intent) {
  localStorage.setItem('ng_intent', JSON.stringify(intent));
}
function getIntent() {
  try { return JSON.parse(localStorage.getItem('ng_intent') || '{}'); } catch { return {}; }
}
function clearIntent() {
  localStorage.removeItem('ng_intent');
}
function redirectToLogin(intent) {
  saveIntent(intent);
  window.location.href = '/login.html';
}
function handlePostLogin() {
  const intent = getIntent();
  if (intent && intent.action) {
    clearIntent();
    if (intent.action === 'publish') showPanel('orgPanel');
    else if (intent.action === 'buy') window.location.href = intent.url || '/';
    else if (intent.action === 'scan') window.location.href = '/scan.html';
    else if (intent.action === 'stats') window.location.href = '/org-stats.html';
    else if (intent.action === 'premium') window.location.href = '/premium.html';
    else if (intent.action === 'points') window.location.href = '/my.html';
    else showPanel('searchPanel');
  }
}
window.handlePostLogin = handlePostLogin;

function showPanel(id){
  ["searchPanel","mapPanel","orgPanel"].forEach(pid=>$("#"+pid)?.classList.remove("show"));
  $("#"+id)?.classList.add("show");
  $("#"+id)?.scrollIntoView({behavior:"smooth", block:"start"});
}
$("#btnStart")?.addEventListener("click",()=>{ showPanel("searchPanel"); $("#q")?.focus(); });
$("#btnMap")?.addEventListener("click",()=> { showPanel("mapPanel"); refreshTopMap(); });
$("#hubPublish")?.addEventListener("click",()=>{
  if (!isLoggedIn()) { redirectToLogin({action:'publish'}); return; }
  showPanel('orgPanel');
});
$("#hubScan")?.addEventListener("click",()=>{
  if (!isLoggedIn()) { redirectToLogin({action:'scan'}); return; }
  window.location.href = '/scan.html';
});
$("#hubStats")?.addEventListener("click",()=>{
  if (!isLoggedIn()) { redirectToLogin({action:'stats'}); return; }
  window.location.href = '/org-stats.html';
});
$("#btnPremiumTop")?.addEventListener("click",()=>{
  if (!isLoggedIn()) { redirectToLogin({action:'premium'}); return; }
  window.location.href = '/premium.html';
});
$("#btnMine")?.addEventListener("click",(e)=>{
  // Prevent default navigation; if not logged-in redirect to login intent.
  e.preventDefault();
  if (!isLoggedIn()) { redirectToLogin({action:'points'}); return; }
  // If logged in, header-account.js will handle toggling the small dropdown menu.
});

// Nakup kupona/vstopnice
document.addEventListener('click', function(e) {
  const btn = e.target.closest('button[data-act="buy"]');
  if (btn) {
    if (!isLoggedIn()) {
      redirectToLogin({action:'buy', url: window.location.href});
      e.preventDefault();
      return;
    }
    // ...obstoječa logika nakupa...
  }
});

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
  const catVal = document.querySelector('#cats .cat-chip.active')?.dataset.cat || '';
  const subVal = document.getElementById('searchSubcategory')?.value || '';
  const radiusVal = $("#radius")?.value || 30;

  const params = { q:qVal, radiuskm:radiusVal, page, size:20 };
  if (byGeo && GEO) params.latlon = GEO;
  else if (cityVal) params.city = cityVal;
  else if (GEO) params.latlon = GEO;
  if (subVal) params.subcategory = subVal;

  let data=null;
  try{ const r=await fetch(`/api/search?${qs(params)}`); data=await r.json(); }catch{}
  const items=(data && data.ok && data.results)||[];
  updateLiveBanner(items);

  let filtered = catVal ? items.filter(e=>(e.category||"")===catVal) : items;
  if (subVal) {
    const target = String(subVal).toLowerCase();
    filtered = filtered.filter((item) => {
      const raw = item?.subcategory || item?.subCategory || item?.subcategoryKey || '';
      if (raw) return String(raw).toLowerCase() === target;
      const tags = Array.isArray(item?.tags) ? item.tags.map((tag) => String(tag).toLowerCase()) : [];
      if (tags.length) return tags.includes(target);
      return true;
    });
  }
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
  function renderFormCategoryIcons() {
    const entryType = document.getElementById('entryType');
    const catsContainer = document.getElementById('formCatsIcons');
    const sel = document.getElementById('category');
    const subWrap = document.getElementById('formSubcategoryWrap');
    const subSelect = document.getElementById('formSubcategory');
    if (!catsContainer || !sel) return;
    catsContainer.innerHTML = '';
    sel.style.display = 'none';

    const type = entryType?.value === 'service' ? 'services' : 'events';
    const fallback = getCanonicalCategories(type);

    const currentValue = sel.value;
    const apply = (source) => {
      const list = Array.isArray(source) && source.length ? source : fallback;
      catsContainer.innerHTML = '';

      const populateSubs = (catKey) => {
        if (!subSelect) return;
        const utils = window.NearGoCategoryUtils;
        let subs = utils?.getSubcategories(type, catKey) || [];
        if (!subs.length) {
          const fallbackCat = fallback.find((cat) => cat.key === catKey);
          subs = fallbackCat && Array.isArray(fallbackCat.sub) ? fallbackCat.sub : [];
        }
        subSelect.innerHTML = '';
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Podkategorija (neobvezno)';
        subSelect.appendChild(placeholder);
        subs.forEach((sub) => {
          const opt = document.createElement('option');
          opt.value = sub.key;
          opt.textContent = sub.label;
          subSelect.appendChild(opt);
        });
        const hasSubs = subs.length > 0;
        if (subWrap) subWrap.style.display = hasSubs ? 'block' : 'none';
        subSelect.disabled = !hasSubs;
        if (!hasSubs) {
          subSelect.value = '';
        } else if (subSelect.dataset.selectedSub) {
          const wanted = subSelect.dataset.selectedSub;
          const exists = Array.from(subSelect.options).some((opt) => opt.value === wanted);
          subSelect.value = exists ? wanted : '';
        }
      };

      list.forEach((cat) => {
        if (!cat?.key) return;
        const btn = document.createElement('button');
        btn.className = 'cat-chip';
        btn.type = 'button';
        btn.dataset.cat = cat.key;
        btn.setAttribute('aria-label', cat.label || cat.key);
        btn.setAttribute('aria-pressed', 'false');

        if (cat.icon) {
          const img = document.createElement('img');
          img.src = cat.icon;
          img.alt = '';
          img.loading = 'lazy';
          btn.appendChild(img);
        } else {
          const emoji = document.createElement('span');
          emoji.className = 'cat-emoji';
          emoji.textContent = cat.emoji || '🏷️';
          btn.appendChild(emoji);
        }

        const labelNode = document.createElement('span');
        labelNode.className = 'cat-label';
        labelNode.textContent = cat.label || cat.key;
        btn.appendChild(labelNode);

        btn.addEventListener('mouseenter', () => toggleChipLabel(btn, true));
        btn.addEventListener('mouseleave', () => toggleChipLabel(btn, false));
        btn.addEventListener('focus', () => toggleChipLabel(btn, true));
        btn.addEventListener('blur', () => toggleChipLabel(btn, false));
        btn.addEventListener('touchstart', () => toggleChipLabel(btn, true), { passive: true });
        btn.addEventListener('touchend', () => toggleChipLabel(btn, false));
        btn.addEventListener('click', () => {
          catsContainer.querySelectorAll('.cat-chip').forEach((chip) => {
            chip.classList.remove('active');
            chip.setAttribute('aria-pressed', 'false');
            toggleChipLabel(chip, false);
          });
          btn.classList.add('active');
          btn.setAttribute('aria-pressed', 'true');
          toggleChipLabel(btn, true);
          sel.value = cat.key;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          if (subSelect) {
            delete subSelect.dataset.selectedSub;
            populateSubs(cat.key);
          }
        });
        catsContainer.appendChild(btn);
      });

      const defaultKey = (currentValue && list.some((cat) => cat.key === currentValue)) ? currentValue : (list[0]?.key || '');
      if (defaultKey) {
        const defaultBtn = catsContainer.querySelector(`[data-cat="${defaultKey}"]`) || catsContainer.querySelector('.cat-chip');
        if (defaultBtn) {
          defaultBtn.classList.add('active', 'show-label');
          defaultBtn.setAttribute('aria-pressed', 'true');
          sel.value = defaultBtn.dataset.cat;
          if (subSelect) populateSubs(defaultBtn.dataset.cat);
        }
      }
    };

    withCategories((data) => {
      const sourceList = Array.isArray(data[type]) ? data[type] : [];
      apply(sourceList);
    });
  }
  document.addEventListener('DOMContentLoaded', function() {
    if (document.getElementById('formCatsIcons')) renderFormCategoryIcons();
    document.getElementById('entryType')?.addEventListener('change', renderFormCategoryIcons);
    document.getElementById('formSubcategory')?.addEventListener('change', (ev) => {
      const target = ev.target;
      if (target) target.dataset.selectedSub = target.value || '';
    });
  });
  document.addEventListener('neargo:categories-ready', renderFormCategoryIcons);

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

// Initialize rewards listener (realtime) and record-view helper on page load.
(async function initRewardsAndRecord(){
  try{
    // dynamic import of supabase client (exports `supabase`)
    const sc = await import('/assets/supabase-client.js');
    const supabase = sc.supabase;
    // get session and user id if logged in
    let userId = null;
    try{ const sess = await supabase.auth.getSession(); userId = sess?.data?.session?.user?.id; }catch(e){}

    // init rewards realtime listener for logged-in users
    if (userId){
      try{
        const rp = await import('/assets/rewards-popup.js');
        rp.initRewardsListener(supabase, userId);
      }catch(e){ console.warn('initRewardsListener failed', e); }
    }

    // init record view (no-op if not a details page)
    try{
      const rv = await import('/assets/record-view.js');
      rv.initRecordView();
    }catch(e){ /* ignore */ }
  }catch(e){ console.warn('initRewardsAndRecord err', e); }
})();
