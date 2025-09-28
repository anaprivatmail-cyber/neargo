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
  // Naloži 5 partialov
await loadPart('topbar', '/partials/hero.html');
await loadPart('app',    '/partials/search.html');
await loadPart('app',    '/partials/map.html');
await loadPart('app',    '/partials/footer-modals.html');

  // Inicializacije (v tem vrstnem redu)
  initTheme();          // temni/svetli način
  initI18n();           // jezikovni meni
  initToast();          // toast + hash success/cancel
  wirePanels();         // preklapljanje panelov + hash odpiranje

  initMaps();           // zgornji zemljevid (shell + event handler)
  initPicker();         // modal za izbiro lokacije
  initBuy();            // share/ics/checkout delegacija

  initFeatured();       // “Izpostavljeno” + geo preload
  initSearch();         // filtri & iskanje (handlerji že znotraj modula)
});
