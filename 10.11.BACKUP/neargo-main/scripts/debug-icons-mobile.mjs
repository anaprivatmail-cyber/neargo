import { chromium, devices } from 'playwright';

const PAGES = [
  '/index.html',
  '/organizers-submit.html',
  '/organizers.html',
  '/premium.html'
];

const device = devices['iPhone 12'];

async function run() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    ...device,
  });
  const page = await context.newPage();

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
      await page.waitForTimeout(2000);

      const scan = await page.evaluate(() => {
        const hasBootstrap = !!(window.NearGoCategories || window.NearGoCategoryBootstrap || window.NearGoCategorySource);
        const bootstrapCounts = {
          NearGoCategories: Array.isArray(window.NearGoCategories?.events) ? window.NearGoCategories.events.length : (Array.isArray(window.NearGoCategoryBootstrap?.events) ? window.NearGoCategoryBootstrap.events.length : 0),
          NearGoCategoryBootstrap: Array.isArray(window.NearGoCategoryBootstrap?.events) ? window.NearGoCategoryBootstrap.events.length : 0,
          NearGoCategorySource: Array.isArray(window.NearGoCategorySource?.events) ? window.NearGoCategorySource.events.length : 0
        };

        const found = [];
        const selectors = ['#cats', '#categoryChips', '#formCatsIcons', '#earlyNotifyCategoryList'];
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

        const subWrap = document.getElementById('searchSubcategoryWrap');
        const subSelect = document.getElementById('searchSubcategory');
        return { meta: { hasBootstrap, bootstrapCounts }, found, sub: { exists: !!subWrap, display: subWrap ? (getComputedStyle(subWrap).display) : null, disabled: subSelect ? subSelect.disabled : null, options: subSelect ? Array.from(subSelect.options).map(o=>o.value) : [] } };
      });

      pageInfo.chips = scan.found || [];
      pageInfo.meta = scan.meta || {};
      pageInfo.sub = scan.sub || {};
    } catch (err) {
      pageInfo.error = String(err.message || err);
    }

    results.push(pageInfo);
    page.removeAllListeners('console');
    page.removeAllListeners('requestfailed');
  }

  console.log(JSON.stringify({ ts: new Date().toISOString(), results }, null, 2));
  await browser.close();
}

run().catch(err => { console.error(err); process.exit(1); });
