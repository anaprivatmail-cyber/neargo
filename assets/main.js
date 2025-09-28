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

/** Preprosto nalaganje partialov v dani host element */
async function loadPart(id, url){
  const host = document.getElementById(id);
  if(!host) return;

  // Dodamo preprost cache-bust, da ob deployu ne vleče stare verzije
  const bust = `v=${encodeURIComponent((window.__BUILD_TS__||'') || new Date().toISOString().slice(0,10))}`;
  const sep  = url.includes('?') ? '&' : '?';
  const html = await fetch(`${url}${sep}${bust}`, { cache: 'no-cache' }).then(r => r.text());

  host.insertAdjacentHTML('beforeend', html);
}

onReady(async () => {
  // V HEADER gre SAMO prava glava (navbar) – fiksna vrstica
  await loadPart('topbar', '/partials/navbar.html');

  // V MAIN gre vse ostalo (hero/search, results+map, footer+modals)
  await loadPart('app', '/partials/hero.html');              // "Najdi dogodke blizu …"
  await loadPart('app', '/partials/search.html');            // filtri/obrazci
  await loadPart('app', '/partials/map.html');               // rezultati + zemljevid
  await loadPart('app', '/partials/footer-modals.html');     // footer + modals

  // Inicializacije UI in logike
  initTheme();     // temni/svetli način
  initI18n();      // jezik
  initToast();     // obvestila/toasti
  wirePanels();    // odpiranje/zapiranje panelov/modals

  // Funkcionalnosti aplikacije
  initMaps();      // Leaflet map
  initPicker();    // npr. date/location pickerji
  initBuy();       // gumbi "kupi" / kuponi
  initFeatured();  // izpostavljeni dogodki (carousel)
  initSearch();    // iskanje, event handlers itd.
});
