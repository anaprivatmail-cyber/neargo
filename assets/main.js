import { onReady } from './domready.js';
import { initTheme } from './theme.js';
import { initI18n } from './i18n.js';
import { initToast } from './toast.js';
import { wirePanels } from './panels.js';
import { initFeatured } from './featured.js';
import { initSearch } from './search.js';
import { initMaps } from './map.js';
import { initPicker } from './picker.js';
import { initBuy } from './buy.js';
import { initOrganizers } from './organizers.js';

async function loadPart(id, url){
  const host = document.getElementById(id);
  const html = await fetch(url, {cache:'no-cache'}).then(r=>r.text());
  host.insertAdjacentHTML('beforeend', html);
}

onReady(async () => {
  await loadPart('topbar', '/partials/hero.html');
  await loadPart('app',    '/partials/featured.html');
  await loadPart('app',    '/partials/search-panel.html');
  await loadPart('app',    '/partials/map-panel.html');
  await loadPart('app',    '/partials/org-panel.html');
  await loadPart('app',    '/partials/benefits.html');
  await loadPart('app',    '/partials/provider-terms.html');
  await loadPart('app',    '/partials/footer.html');
  await loadPart('app',    '/partials/modals.html');

  initTheme(); initI18n(); initToast(); wirePanels();
  initMaps(); initPicker(); initBuy(); initOrganizers();
  initFeatured(); initSearch();
});
