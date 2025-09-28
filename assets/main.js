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
// (če uporabljaš obrazec kot partial, lahko dodaš še import { initOrganizers } from './organizers.js';

async function loadPartStrict(id, url){
  // varovalo: v header dovolimo LE navbar.html
  if (id === 'topbar' && !/\/navbar\.html(\?|$)/i.test(url)) {
    id = 'app';
  }
  const host = document.getElementById(id);
  if(!host) return;
  const bust = `v=${encodeURIComponent((window.__BUILD_TS__||'') || new Date().toISOString().slice(0,10))}`;
  const sep  = url.includes('?') ? '&' : '?';
  const html = await fetch(`${url}${sep}${bust}`, { cache: 'no-cache' }).then(r => r.text());
  host.insertAdjacentHTML('beforeend', html);
}

function sanitizeHeaderToMain(){
  const header = document.getElementById('topbar');
  const app = document.getElementById('app');
  if (!header || !app) return;
  // prestavi VSE, kar ni .nav, iz headerja v main
  Array.from(header.children).forEach(node => {
    if (!node.classList || !node.classList.contains('nav')) {
      app.appendChild(node);
    }
  });
}

onReady(async () => {
  // V HEADER gre samo navbar
  await loadPartStrict('topbar', '/partials/navbar.html');

  // V MAIN gre vse ostalo
  await loadPartStrict('app', '/partials/hero.html');
  await loadPartStrict('app', '/partials/search.html');
  await loadPartStrict('app', '/partials/map.html');
  await loadPartStrict('app', '/partials/footer-modals.html');
  // Če imaš obrazec kot partial:
  // await loadPartStrict('app', '/partials/organizers.html');

  // Varnostno: če je kaj pomotoma pristalo v headerju, prestavi v main
  sanitizeHeaderToMain();

  // Init
  initTheme();
  initI18n();
  initToast();
  wirePanels();

  initMaps();
  initPicker();
  initBuy();
  initFeatured();
  initSearch();
  // initOrganizers && initOrganizers();
});
