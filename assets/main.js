// assets/main.js
import { onReady } from './domready.js';
import { initTheme } from './theme.js';
import { initI18n } from './i18n.js';
import { initToast } from './toast.js';
import { wirePanels } from './panels.js';
import { initMaps } from './map.js';
import { initPicker } from './picker.js';
import { initBuy } from './buy.js';
import { initFeatured } from './featured.js';
import { initSearch } from './search.js';
// Če uporabljaš obrazec kot partial, odkomentiraj naslednje:
// import { initOrganizers } from './organizers.js';

/* ---------- Pomagala ---------- */
function cacheBustValue(){
  // Prednost ima build timestamp, sicer “unikaten” fallback
  return (window.__BUILD_TS__ || String(Date.now()));
}

/* V header dovolimo **izključno** navbar.html; vse ostalo gre v #app */
async function loadPartStrict(id, url){
  if (id === 'topbar' && !/\/navbar\.html(\?|$)/i.test(url)) {
    id = 'app';
  }
  const host = document.getElementById(id);
  if(!host) return;

  const sep  = url.includes('?') ? '&' : '?';
  const html = await fetch(`${url}${sep}v=${encodeURIComponent(cacheBustValue())}`, { cache: 'no-cache' })
    .then(r => r.text());
  host.insertAdjacentHTML('beforeend', html);
}

/* Varnostni CSS – fiksna je le .nav; hero/search/featured nikoli niso sticky/fixed */
function injectSafetyCSS(){
  if (document.getElementById('nav-safety-style')) return;
  const css = `
    :root { --header-h: 64px; }
    header { position: static !important; height: auto !important; background: transparent !important; box-shadow: none !important; }
    header .nav { position: fixed !important; top:0; left:0; right:0; z-index:1000; height: var(--header-h); backdrop-filter: blur(6px);
                  background: color-mix(in srgb, var(--card) 92%, transparent); box-shadow: 0 4px 16px rgba(0,0,0,.05); }
    main, #app { padding-top: calc(var(--header-h) + 12px) !important; position: static !important; }
    .hero, #searchPanel, #featuredCard, #carousel, #mapPanel, #orgPanel, .card.hero { position: static !important; }
  `.trim();
  const tag = document.createElement('style');
  tag.id = 'nav-safety-style';
  tag.textContent = css;
  document.head.appendChild(tag);
}

/* “Deep” sanacija: iz headerja odstrani VSE, kar ni .nav (tudi če je gnezdeno) */
function sanitizeHeaderDeep(){
  const header = document.getElementById('topbar');
  const app    = document.getElementById('app');
  if (!header || !app) return;

  // 1) Premakni vse neposredne otroke, ki niso .nav
  Array.from(header.children).forEach(node => {
    if (!node.classList || !node.classList.contains('nav')) app.appendChild(node);
  });

  // 2) Če je karkoli vseeno zašlo v .nav (npr. <section>, .card, #searchPanel, #featuredCard) – tudi to premaknemo
  header.querySelectorAll('.nav section, .nav .card, .nav #searchPanel, .nav #featuredCard, .nav #carousel, .nav #mapPanel, .nav #orgPanel')
    .forEach(n => app.appendChild(n));

  // 3) Če se je slučajno ustvaril še kak drug <header> (v partialu) – iz njega prav tako prestavi vse, kar ni .nav
  document.querySelectorAll('header:not(#topbar)').forEach(h2 => {
    Array.from(h2.children).forEach(node => {
      if (!node.classList || !node.classList.contains('nav')) app.appendChild(node);
    });
  });
}

/* Opazuj header in takoj prestavi neželene elemente v main */
function watchHeaderMutations(){
  const header = document.getElementById('topbar');
  if (!header || !('MutationObserver' in window)) return;
  const obs = new MutationObserver(() => sanitizeHeaderDeep());
  obs.observe(header, { childList: true, subtree: true });

  // če bi kdo premaknil .nav ven iz headerja, ga vrnemo nazaj
  const obs2 = new MutationObserver(() => {
    const topbar = document.getElementById('topbar');
    const nav = document.querySelector('header#topbar .nav') || document.querySelector('.nav');
    if (topbar && nav && nav.parentElement !== topbar) topbar.appendChild(nav);
  });
  obs2.observe(document.body, { childList: true, subtree: true });
}

/* Dinamična višina glave – ujemi realno višino .nav in nastavi --header-h */
function syncHeaderHeight(){
  const nav = document.querySelector('header .nav');
  if (!nav) return;
  const h = nav.offsetHeight || 64;
  document.documentElement.style.setProperty('--header-h', `${Math.max(64, h)}px`);
}

function watchHeaderHeight(){
  const nav = document.querySelector('header .nav');
  if (!nav) return;
  // ResizeObserver za spremembe velikosti (prelomi vrstic, jezik, itd.)
  if ('ResizeObserver' in window){
    const ro = new ResizeObserver(() => syncHeaderHeight());
    ro.observe(nav);
  }
  // tudi na resize in po kratkem času (zaradi fontov)
  window.addEventListener('resize', syncHeaderHeight, { passive:true });
  setTimeout(syncHeaderHeight, 150);
}

/* ---------- Boot ---------- */
onReady(async () => {
  injectSafetyCSS();

  // HEADER: samo navbar
  await loadPartStrict('topbar', '/partials/navbar.html');

  // MAIN: vse ostalo
  await loadPartStrict('app', '/partials/hero.html');
  await loadPartStrict('app', '/partials/search.html');
  await loadPartStrict('app', '/partials/map.html');
  await loadPartStrict('app', '/partials/footer-modals.html');
  // Če uporabljaš obrazec kot partial:
  // await loadPartStrict('app', '/partials/organizers.html');

  // Sanacija + opazovanje (tudi če SW/keš kdaj prinese star HTML)
  sanitizeHeaderDeep();
  watchHeaderMutations();

  // Inicializacije
  initTheme();
  initI18n();
  initToast();
  wirePanels();

  initMaps();
  initPicker();
  initBuy();
  initFeatured();
  initSearch();
  // if (typeof initOrganizers === 'function') initOrganizers();

  // Jezikovni meni naj bo zaprt na start
  const langMenu = document.getElementById('langMenu');
  if (langMenu){ langMenu.hidden = true; langMenu.style.display = 'none'; }

  // LANG MENU TOGGLE — odpri na klik, zapri ob kliku izven
  (function(){
    const wrap = document.getElementById('langWrap');
    const menu = document.getElementById('langMenu');
    if (!wrap || !menu) return;
    const close = ()=>{ menu.style.display='none'; menu.hidden=true; };
    const open  = ()=>{ menu.style.display='flex'; menu.hidden=false; };
    // vedno start zaprto
    close(); setTimeout(close, 0);
    // toggle na klik na kapsulo
    wrap.addEventListener('click', (e)=>{
      e.stopPropagation();
      const opened = menu.style.display !== 'none';
      opened ? close() : open();
    });
    // klik izven zapre
    document.addEventListener('click', close);
    // klik znotraj menija ne zapre takoj
    menu.addEventListener('click', e=>e.stopPropagation());
  })();

  // Dinamična višina glave (da se main vedno pravilno odmakne)
  syncHeaderHeight();
  watchHeaderHeight();

  // Po kratkem zamiku še en “double-check” (če se kaj naloži asinhrono)
  setTimeout(() => { sanitizeHeaderDeep(); syncHeaderHeight(); }, 0);
  setTimeout(() => { sanitizeHeaderDeep(); syncHeaderHeight(); }, 250);
});
