// Mesure reproductible, profil isolé et CPU ralenti ; ne mesure pas le GPU d'un iPhone.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const ref = process.argv.find(a => a.startsWith('--ref='))?.slice(6);
const verify = process.argv.includes('--verify');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const quantile = (values, q) => values.slice().sort((a, b) => a - b)[Math.floor((values.length - 1) * q)];

async function run() {
  const html = ref ? execFileSync('git', ['-C', root, 'show', `${ref}:index.html`])
    : fs.readFileSync(path.join(root, 'index.html'));
  const server = http.createServer((req, res) => {
    const icon = req.url.startsWith('/IconCourses.png');
    res.setHeader('Content-Type', icon ? 'image/png' : 'text/html; charset=utf-8');
    res.end(icon ? fs.readFileSync(path.join(root, 'IconCourses.png')) : html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  const results = [];
  try {
    for (const count of [28, 300]) {
      const context = await browser.newContext({ viewport: { width: 375, height: 812 },
        isMobile: true, hasTouch: true, colorScheme: 'dark' });
      await context.addInitScript(count => {
        localStorage.setItem('lc_appData_v1', JSON.stringify({ schemaVersion: 1, prefs: { theme: 'dark' },
          lastBackupISO: null, stores: [{ id: 's_test', name: 'Magasin test', template: null,
            items: Array.from({ length: count }, (_, i) => ({ id: `i_${i}`, name: `Article ${i}`,
              qty: 1, planned: false, bought: false })) }] }));
        window.tapMeasures = [];
        window.lastTouchEnd = 0;
        document.addEventListener('touchend', () => { window.lastTouchEnd = performance.now(); }, true);
        document.addEventListener('click', event => {
          const action = event.target.closest('[data-action]');
          if (!action || !['toggle-planned', 'qty-inc', 'qty-dec'].includes(action.dataset.action)) return;
          const start = performance.now();
          const row = action.closest('.item-row');
          const id = row.dataset.itemRow;
          const list = row.parentElement;
          const sorter = window.Sortable.get(list);
          const result = { action: action.dataset.action, clickDelayMs: start - window.lastTouchEnd,
            handlerMs: null, frameMs: null, elementsAdded: 0, elementsRemoved: 0 };
          const observer = new MutationObserver(records => {
            for (const record of records) {
              for (const node of record.addedNodes) if (node.nodeType === 1)
                result.elementsAdded += 1 + node.querySelectorAll('*').length;
              for (const node of record.removedNodes) if (node.nodeType === 1)
                result.elementsRemoved += 1 + node.querySelectorAll('*').length;
            }
          });
          observer.observe(document.querySelector('#app'), { childList: true, subtree: true });
          document.addEventListener('click', () => {
            result.handlerMs = performance.now() - start;
            result.rowPreserved = row === document.querySelector(`[data-item-row="${id}"]`);
            result.sorterPreserved = sorter === window.Sortable.get(document.querySelector('#app .list'));
            requestAnimationFrame(() => requestAnimationFrame(() => {
              result.frameMs = performance.now() - start;
              observer.disconnect();
              window.tapMeasures.push(result);
            }));
          }, { once: true });
        }, true);
      }, count);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.route('**/*', route => route.request().url().startsWith(url) ? route.continue() : route.abort());
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
      await page.goto(url);
      await page.locator('#splash').click(); await wait(800);
      await page.locator('[data-action="open-store"]').click(); await wait(200);
      async function tap(selector) {
        const r = await page.locator(selector).first().boundingBox();
        const x = r.x + r.width / 2, y = r.y + r.height / 2;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
        await wait(35);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await wait(120);
      }
      for (let i = 0; i < 12; i++) await tap('.item-name');
      for (let i = 0; i < 6; i++) await tap('[data-action="qty-inc"]');
      await wait(500); // Laisser se terminer les deux frames de la dernière mesure.
      const measurements = await page.evaluate(() => window.tapMeasures);
      assert.equal(measurements.length, 18, `Chaque toucher doit être traité une seule fois : ${JSON.stringify(measurements)}`);
      const data = await page.evaluate(() => JSON.parse(localStorage.getItem('lc_appData_v1')));
      assert.equal(data.stores[0].items[0].planned, false);
      assert.equal(data.stores[0].items[0].qty, 7);
      await page.locator('[data-action="store-menu"]').click();
      await page.locator('.sheet [data-value="undo"]').waitFor();
      const menuActionMs = await page.evaluate(() => new Promise(resolve => {
        const start = performance.now();
        const observer = new MutationObserver(() => {
          if (document.querySelector('#app .qty')?.textContent === '6') {
            observer.disconnect(); resolve(performance.now() - start);
          }
        });
        observer.observe(document.querySelector('#app'), { childList: true, subtree: true, characterData: true });
        document.querySelector('.sheet [data-value="undo"]').click();
      }));
      await wait(200);
      await page.locator('[data-action="toggle-search"]').click(); await wait(100);
      const search = await page.evaluate(() => {
        const input = document.querySelector('#searchInput');
        const row = document.querySelector('[data-item-row="i_2"]');
        input.focus(); input.value = 'Article 2'; input.setSelectionRange(3, 3);
        const start = performance.now();
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return { handlerMs: performance.now() - start, inputPreserved: input.isConnected,
          caret: input.isConnected ? input.selectionStart : null,
          rowPreserved: row === document.querySelector('[data-item-row="i_2"]') };
      });
      if (verify) {
        assert.ok(measurements.every(m => m.rowPreserved && m.sorterPreserved));
        assert.ok(measurements.every(m => m.elementsAdded === 0 && m.elementsRemoved === 0));
        assert.ok(search.inputPreserved && search.caret === 3, 'La recherche conserve le champ et son curseur');
        assert.ok(search.rowPreserved, 'La recherche réutilise les cartes');
      }
      assert.deepEqual(errors, []);
      results.push({ items: count, cpuSlowdown: 6, samples: measurements.length,
        clickDelayMedianMs: +quantile(measurements.map(m => m.clickDelayMs), .5).toFixed(2),
        handlerMedianMs: +quantile(measurements.map(m => m.handlerMs), .5).toFixed(2),
        handlerP95Ms: +quantile(measurements.map(m => m.handlerMs), .95).toFixed(2),
        nextFrameMedianMs: +quantile(measurements.map(m => m.frameMs), .5).toFixed(2),
        rebuiltElementsPerTap: quantile(measurements.map(m => m.elementsAdded), .5),
        preservedRows: measurements.filter(m => m.rowPreserved).length,
        menuActionMs: +menuActionMs.toFixed(2), search });
      await context.close();
    }
    console.log(JSON.stringify({ source: ref || 'working-tree', results }, null, 2));
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
run().catch(e => { console.error(e); process.exitCode = 1; });
