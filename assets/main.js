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

async function loadPart(id, url){
  const host = document.getElementById(id);
  if(!host) return;
  const html = await fetch(url, {cache:'no-cache'}).then(r=>r.text());
  host.insertAdjacentHTML('beforeend', html);
}

onReady(async () => {
  // Uporabljaš staro organizers.html, zato tukaj ne nalagamo org panela
  await loadPart('topbar', '/partials/hero.html');
  await loadPart('app',    '/partials/search.html');
  await loadPart('app',    '/partials/map.html');
  await loadPart('app',    '/partials/footer-modals.html');

  initTheme();
  initI18n();
  initToast();
  wirePanels();

  initMaps();
  initPicker();
  initBuy();

  initFeatured();
  initSearch();
});
