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

/* Varnostni CSS – fiksna je CEL header, znotraj .nav ni fixed */
function injectSafetyCSS(){
  if (document.getElementById('nav-safety-style')) return;
  const css = `
    :root { --header-h: 108px; }
    header { position: fixed !important; top:0; left:0; right:0; z-index:1000;
             background: var(--card); box-shadow: 0 4px 16px rgba(0,0,0,.05);
             border-bottom: 1px solid var(--chipborder); }
    header .nav { position: static !important; }
    main, #app { padding-top: calc(var(--header-h) + 12px) !important; }
    .hero, #searchPanel, #featuredCard, #carousel, #mapPanel, #orgPanel, .card.hero {
      position: static !important;
    }
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

  Array.from(header.children).forEach(node => {
    if (!node.classList || !node.classList.contains('nav')) app.appendChild(node);
  });

  header.querySelectorAll('.nav section, .nav .card, .nav #searchPanel, .nav #featuredCard, .nav #carousel, .nav #mapPanel, .nav #orgPanel')
    .forEach(n => app.appendChild(n));

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
  if ('ResizeObserver' in window){
    const ro = new ResizeObserver(() => syncHeaderHeight());
    ro.observe(nav);
  }
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
  // await loadPartStrict('app', '/partials/organizers.html');

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

  // LANG MENU TOGGLE – čisto: odpiranje z razredom .open, zapiranje ob kliku izven
  (function(){
    const wrap = document.getElementById('langWrap');
    const menu = document.getElementById('langMenu');
    if (!wrap || !menu) return;

    // zaprto na start (brez inline display, naj vlada CSS)
    wrap.classList.remove('open');
    menu.hidden = true;

    // toggle na klik kapsule (klik v sam menu ga ne zapre)
    wrap.addEventListener('click', (e)=>{
      if (e.target.closest('.lang-menu')) return;
      e.stopPropagation();
      const opened = wrap.classList.toggle('open');
      menu.hidden = !opened;
    });

    // klik izven zapre
    document.addEventListener('click', ()=>{ wrap.classList.remove('open'); menu.hidden = true; });
  })();

  // Dinamična višina glave
  syncHeaderHeight();
  watchHeaderHeight();

  setTimeout(() => { sanitizeHeaderDeep(); syncHeaderHeight(); }, 0);
  setTimeout(() => { sanitizeHeaderDeep(); syncHeaderHeight(); }, 250);
});
