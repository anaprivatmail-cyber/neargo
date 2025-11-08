import { chromium } from 'playwright';

const PAGES = [
  '/index.html',
  '/organizers-submit.html',
  '/organizers.html',
  '/premium.html'
];

function now() { return new Date().toISOString(); }

const browser = await chromium.launch();
const page = await browser.newPage();

const results = [];

for (const path of PAGES) {
  const url = `http://localhost:8888${path}`;
  const pageInfo = { url, console: [], requestsFailed: [], chips: [] };

  page.on('console', (msg) => {
    pageInfo.console.push({ type: msg.type(), text: msg.text() });
  });
  page.on('requestfailed', (req) => {
    pageInfo.requestsFailed.push({ url: req.url(), failure: req.failure()?.errorText || '' });
  });

  try {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(5000);
  pageInfo.content = await page.content();

    const scan = await page.evaluate(() => {
  const scripts = Array.from(document.querySelectorAll('script')).map(s => ({ src: s.getAttribute('src') || null, type: s.getAttribute('type') || null, outer: s.outerHTML.slice(0, 200) }));

      const hasBootstrap = !!(window.NearGoCategories || window.NearGoCategoryBootstrap || window.NearGoCategorySource);
      const bootstrapCounts = {
        NearGoCategories: Array.isArray(window.NearGoCategories?.events) ? window.NearGoCategories.events.length : (Array.isArray(window.NearGoCategoryBootstrap?.events) ? window.NearGoCategoryBootstrap.events.length : 0),
        NearGoCategoryBootstrap: Array.isArray(window.NearGoCategoryBootstrap?.events) ? window.NearGoCategoryBootstrap.events.length : 0,
        NearGoCategorySource: Array.isArray(window.NearGoCategorySource?.events) ? window.NearGoCategorySource.events.length : 0
      };
  const selectors = ['#cats', '#categoryChips', '#formCatsIcons', '#earlyNotifyCategoryList'];
      const found = [];
      const meta = { hasBootstrap, bootstrapCounts };
      selectors.forEach((sel) => {
        const host = document.querySelector(sel);
        if (!host) return;
        const chips = Array.from(host.querySelectorAll('.cat-chip'));
        if (!chips.length) return;
        found.push({ container: sel, items: chips.map((chip) => ({
          key: chip.dataset.cat || chip.dataset.key || null,
          hasImg: !!chip.querySelector('img'),
          imgSrc: chip.querySelector('img') ? chip.querySelector('img').getAttribute('src') : null,
          hasEmoji: !!chip.querySelector('.cat-emoji'),
          label: (chip.querySelector('.cat-label') ? chip.querySelector('.cat-label').textContent.trim() : chip.textContent.trim())
        })) });
      });
      return { meta, found, scripts };
    });

  pageInfo.chips = scan.found || [];
  pageInfo.meta = scan.meta || {};
  pageInfo.scripts = scan.scripts || [];
  } catch (err) {
    pageInfo.error = String(err.message || err);
  }

  results.push(pageInfo);
  // cleanup listeners to avoid duplicate recording
  page.removeAllListeners('console');
  page.removeAllListeners('requestfailed');
}

console.log(JSON.stringify({ ts: now(), results }, null, 2));
await browser.close();
