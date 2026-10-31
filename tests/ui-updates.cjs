// Profils isolés et géométrie de clavier simulée : pas une validation de Safari iPhone.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const reference = process.argv.find(arg => arg.startsWith('--ref='))?.slice(6);
const source = reference ? execFileSync('git', ['-C', root, 'show', `${reference}:index.html`])
  : fs.readFileSync(path.join(root, 'index.html'));
const key = 'lc_appData_v1';
const fixture = { schemaVersion: 1, prefs: { theme: 'dark', allStores: false }, lastBackupISO: null, stores: [
  { id: 's_first', name: 'Boîte à Fromage', template: null, items: [
    { id: 'i_z', name: 'Yaourts', qty: 2, planned: true, bought: false },
    { id: 'i_c', name: 'Crème fraîche', qty: 1, planned: true, bought: false },
    { id: 'i_o', name: 'Œufs', qty: 1, planned: false, bought: false },
    { id: 'i_a', name: 'Abricots', qty: 1, planned: true, bought: false },
  ] },
  { id: 's_second', name: 'Grand Frais', template: null, items: [
    { id: 'i_r', name: 'Riz', qty: 1, planned: true, bought: false },
    { id: 'i_b', name: 'Bananes', qty: 1, planned: true, bought: false },
  ] },
] };

(async () => {
  const server = http.createServer((req, res) => {
    const file = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
    if (!['index.html', 'IconCourses.png'].includes(file) && !/^fonts\/[\w.-]+\.woff2$/.test(file)) {
      res.writeHead(404); return res.end();
    }
    res.setHeader('Content-Type', file.endsWith('.png') ? 'image/png' : file.endsWith('.woff2')
      ? 'font/woff2' : 'text/html; charset=utf-8');
    res.end(file === 'index.html' ? source : fs.readFileSync(path.join(root, file)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  const results = [];
  try {
    async function scenario(name, run, width = 375) {
      const context = await browser.newContext({ viewport: { width, height: 812 },
        isMobile: true, hasTouch: true, reducedMotion: 'reduce', serviceWorkers: 'block' });
      try {
        await context.addInitScript(() => {
          const viewport = Object.assign(new EventTarget(), { width: innerWidth, height: innerHeight,
            offsetTop: 0, offsetLeft: 0, scale: 1 });
          Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true });
          document.addEventListener('DOMContentLoaded', () => {
            viewport.width = innerWidth; viewport.height = innerHeight;
          }, { once: true });
          window.resizeVisibleArea = values => {
            Object.assign(viewport, values);
            viewport.dispatchEvent(new Event('resize'));
            viewport.dispatchEvent(new Event('scroll'));
          };
        });
        const page = await context.newPage(); page.setDefaultTimeout(2500);
        const errors = []; page.on('pageerror', e => errors.push(e.message));
        await context.route('**/*', r => r.request().url().startsWith(url) ? r.continue() : r.abort());
        await page.goto(url);
        await page.evaluate(({ key, fixture }) => localStorage.setItem(key, JSON.stringify(fixture)), { key, fixture });
        await page.reload(); await page.locator('#splash').tap();
        const open = id => page.locator(`[data-action="open-store"][data-id="${id}"]`).tap();
        await open('s_first');
        const data = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
        const names = () => page.locator('.item-name').allTextContents();
        const sort = mode => page.locator(`[data-action="set-sort-mode"][data-mode="${mode}"]`).tap();
        const menu = () => page.locator('[data-action="store-menu"]').tap();
        const choice = value => page.locator(`.sheet [data-value="${value}"]`).tap();
        await run({ page, open, data, names, sort, menu, choice });
        assert.deepEqual(errors, []);
        results.push({ case: name, passed: true });
      } catch (error) { results.push({ case: name, passed: false, error: error.message }); }
      finally { await context.close(); }
    }

    await scenario('recherche sans accents ni ligatures, noms enregistrés intacts', async s => {
      await s.page.locator('[data-action="toggle-search"]').tap();
      await s.page.locator('#searchInput').fill('CREME');
      assert.deepEqual(await s.names(), ['Crème fraîche']);
      await s.page.locator('#searchInput').fill('oeufs');
      assert.deepEqual(await s.names(), ['Œufs']);
      assert.deepEqual((await s.data()).stores, fixture.stores);
    });
    await scenario('tri direct, ordre manuel préservé et choix durable', async s => {
      await s.sort('alpha');
      assert.deepEqual(await s.names(), ['Abricots', 'Crème fraîche', 'Œufs', 'Yaourts']);
      assert.deepEqual((await s.data()).stores, fixture.stores, 'Le tri de consultation ne modifie pas les listes');
      assert.equal(await s.page.locator('.sheet').count(), 0, 'Aucun menu de tri');
      assert.equal(await s.page.locator('.sort-mode[aria-pressed="true"]').getAttribute('data-mode'), 'alpha');
      assert.equal(await s.page.evaluate(() => Sortable.get(document.querySelector('#app .list'))), undefined,
        'Pas de déplacement manuel pendant le tri alphabétique');
      await s.page.reload(); await s.page.locator('#splash').tap(); await s.open('s_first');
      assert.deepEqual(await s.names(), ['Abricots', 'Crème fraîche', 'Œufs', 'Yaourts']);
      await s.sort('manual'); assert.deepEqual(await s.names(), fixture.stores[0].items.map(i => i.name));
      assert.equal(await s.page.evaluate(() => Boolean(Sortable.get(document.querySelector('#app .list')))), true);
    });
    await scenario('tri conservé avec filtre, recherche et navigation', async s => {
      await s.sort('alpha');
      await s.page.locator('[data-action="toggle-filter-pill"]').tap();
      assert.deepEqual(await s.names(), ['Abricots', 'Crème fraîche', 'Yaourts']);
      await s.page.locator('[data-action="toggle-search"]').tap();
      await s.page.locator('#searchInput').fill('creme');
      await s.sort('manual'); assert.deepEqual(await s.names(), ['Crème fraîche']);
      await s.sort('alpha'); assert.deepEqual(await s.names(), ['Crème fraîche']);
      await s.page.locator('[data-action="back-home"]').tap(); await s.open('s_second');
      assert.deepEqual(await s.names(), ['Bananes', 'Riz']);
    });
    await scenario('Undo conserve le tri choisi après une modification', async s => {
      await s.page.locator('[data-item-row="i_z"] [data-action="qty-inc"]').tap();
      await s.sort('alpha'); await s.menu(); await s.choice('undo');
      assert.equal((await s.data()).prefs.sortMode, 'alpha', 'Undo ne change pas le tri choisi');
      assert.equal((await s.data()).stores[0].items[0].qty, 2);
      assert.deepEqual(await s.names(), ['Abricots', 'Crème fraîche', 'Œufs', 'Yaourts']);
    });
    await scenario('vue globale : magasins et rangement manuel intacts', async s => {
      await s.sort('alpha'); await s.page.locator('[data-action="toggle-filter-pill"]').tap();
      await s.menu(); await s.choice('scope');
      assert.deepEqual(await s.page.locator('[data-store-section]').evaluateAll(nodes => nodes.map(n => n.dataset.storeSection)), ['s_first', 's_second']);
      assert.deepEqual(await s.page.locator('[data-store-section="s_first"] .item-name').allTextContents(), ['Abricots', 'Crème fraîche', 'Yaourts']);
      assert.deepEqual(await s.page.locator('[data-store-section="s_second"] .item-name').allTextContents(), ['Bananes', 'Riz']);
      await s.sort('manual'); assert.deepEqual(await s.names(), ['Yaourts', 'Crème fraîche', 'Abricots', 'Riz', 'Bananes']);
      assert.deepEqual((await s.data()).stores, fixture.stores);
    });
    await scenario('ajout, renommage et suppression en ordre alphabétique', async s => {
      await s.sort('alpha'); await s.page.locator('[data-action="add-item"]').tap();
      await s.page.locator('.modal input').fill('Beurre'); await s.page.locator('[data-modal-ok]').tap();
      assert.deepEqual(await s.names(), ['Abricots', 'Beurre', 'Crème fraîche', 'Œufs', 'Yaourts']);
      await s.page.locator('[data-item-row="i_z"] [data-action="item-gear"]').tap(); await s.choice('rename');
      await s.page.locator('.modal input').fill('Ananas'); await s.page.locator('[data-modal-ok]').tap();
      assert.deepEqual(await s.names(), ['Abricots', 'Ananas', 'Beurre', 'Crème fraîche', 'Œufs']);
      await s.page.locator('[data-item-row="i_o"] [data-action="item-gear"]').tap(); await s.choice('delete');
      await s.page.locator('[data-modal-ok]').tap(); await s.sort('manual');
      assert.deepEqual(await s.names(), ['Ananas', 'Crème fraîche', 'Abricots', 'Beurre']);
    });
    for (const width of [375, 320]) for (const theme of ['dark', 'light']) await scenario(`en-tête ${theme} et cibles tactiles à ${width} px`, async s => {
      if (theme === 'light') {
        await s.menu(); await s.choice('theme');
        await s.page.locator('.modalOverlay').waitFor({ state: 'detached' });
      }
      await s.page.evaluate(() => document.fonts.ready);
      const geometry = await s.page.evaluate(() => {
        const rect = e => { const r = e.getBoundingClientRect(); return { x: r.x, right: r.right, y: r.y, bottom: r.bottom, width: r.width, height: r.height }; };
        const plus = document.querySelector('[data-action="qty-inc"]'), b = plus.getBoundingClientRect();
        return { width: document.body.scrollWidth, viewport: innerWidth,
          title: rect(document.querySelector('.store-title')), menu: rect(document.querySelector('[data-action="store-menu"]')),
          controls: [...document.querySelectorAll('.meta-row button')].map(rect),
          quantityHit: document.elementFromPoint(b.right + 6, b.top + b.height / 2)?.closest('[data-action]')?.dataset.action,
          quantityName: rect(document.querySelector('.item-name')), quantity: rect(plus) };
      });
      assert.equal(geometry.width, geometry.viewport);
      assert.ok(geometry.title.right <= geometry.menu.x + 1);
      for (const control of geometry.controls) {
        assert.ok(control.width >= 43.5); assert.ok(control.height >= 43.5);
        assert.ok(control.x >= 0 && control.right <= width);
      }
      for (let i = 1; i < geometry.controls.length; i++) assert.ok(geometry.controls[i - 1].right <= geometry.controls[i].x + 1);
      assert.equal(geometry.quantityHit, 'qty-inc', `La cible déborde la petite icône sans toucher le nom : ${JSON.stringify(geometry)}`);
      assert.ok(geometry.quantity.right + 7 <= geometry.quantityName.x + 1);
      await s.page.touchscreen.tap(geometry.quantity.right + 6, geometry.quantity.y + geometry.quantity.height / 2);
      assert.equal((await s.data()).stores[0].items[0].qty, 3);
      assert.equal((await s.data()).stores[0].items[0].planned, true, 'La cible étendue ne coche pas la ligne');
      if (process.env.UI_SCREENSHOT_DIR) await s.page.screenshot({ path: path.join(process.env.UI_SCREENSHOT_DIR, `ui-${theme}-${width}.png`) });
    }, width);
    await scenario('formulaire au-dessus du clavier, défilement et nettoyage', async s => {
      await s.page.locator('[data-action="add-item"]').tap();
      await s.page.evaluate(() => resizeVisibleArea({ height: 360, offsetTop: 80 }));
      await s.page.waitForTimeout(30);
      const visible = await s.page.evaluate(() => {
        const input = document.querySelector('.modal input'), ok = document.querySelector('[data-modal-ok]');
        return { input: input.getBoundingClientRect().toJSON(), ok: ok.getBoundingClientRect().toJSON(), font: parseFloat(getComputedStyle(input).fontSize) };
      });
      assert.ok(visible.input.top >= 80); assert.ok(visible.ok.bottom <= 440, 'Le bouton Ajouter reste au-dessus du clavier');
      assert.ok(visible.font >= 16);
      await s.page.evaluate(() => resizeVisibleArea({ width: 330, height: 240, offsetTop: 110, offsetLeft: 20, scale: 1.2 }));
      await s.page.waitForTimeout(30);
      await s.page.locator('.modal .body').evaluate(el => { el.scrollTop = el.scrollHeight; });
      const ok = await s.page.locator('[data-modal-ok]').boundingBox();
      assert.ok(ok.y >= 110 && ok.y + ok.height <= 350, 'Validation atteignable dans la zone visible raccourcie');
      await s.page.setViewportSize({ width: 812, height: 375 });
      await s.page.evaluate(() => resizeVisibleArea({ width: 812, height: 210, offsetTop: 20, offsetLeft: 0, scale: 1 }));
      await s.page.waitForTimeout(30);
      await s.page.locator('.modal .body').evaluate(el => { el.scrollTop = el.scrollHeight; });
      const landscapeOk = await s.page.locator('[data-modal-ok]').boundingBox();
      assert.ok(landscapeOk.y >= 20 && landscapeOk.y + landscapeOk.height <= 230, 'Validation atteignable après rotation');
      await s.page.locator('[data-modal-cancel]').tap(); await s.page.waitForTimeout(220);
      const closedStyle = await s.page.locator('#modalRoot').getAttribute('style');
      await s.page.evaluate(() => resizeVisibleArea({ height: 500, offsetTop: 0, offsetLeft: 0 }));
      await s.page.waitForTimeout(30);
      assert.equal(await s.page.locator('#modalRoot').getAttribute('style'), closedStyle, 'Les écouteurs de la modale fermée sont retirés');
    });
    await scenario('Actions reste utilisable depuis la recherche avec clavier ouvert', async s => {
      await s.page.locator('[data-action="toggle-search"]').tap();
      await s.page.locator('#searchInput').fill('creme');
      await s.page.evaluate(() => resizeVisibleArea({ height: 320, offsetTop: 50 }));
      await s.menu();
      const box = await s.page.locator('.sheet').boundingBox();
      assert.ok(box.y >= 50 && box.y + box.height <= 370, 'Le menu tient dans la partie visible');
      await s.choice('cancel');
      assert.equal(await s.page.locator('#searchInput').inputValue(), 'creme');
      assert.deepEqual(await s.names(), ['Crème fraîche']);
    });
    await scenario('le toucher d’ouverture ne traverse pas vers un magasin', async s => {
      const sixStores = { ...fixture, stores: Array.from({ length: 6 }, (_, index) => ({
        id: `s_opening_${index}`, name: `Magasin ${index + 1}`, template: null, items: []
      })) };
      await s.page.evaluate(({ key, data }) => localStorage.setItem(key, JSON.stringify(data)), { key, data: sixStores });
      await s.page.reload();
      assert.equal(await s.page.locator('[data-action="open-store"]').count(), 6);
      await s.page.locator('#splash').tap();
      assert.equal(await s.page.locator('[data-action="open-store"]').count(), 6,
        'Le même toucher doit révéler l’accueil sans ouvrir le magasin situé dessous');
      assert.equal(await s.page.locator('body').evaluate(el => el.classList.contains('entered')), true);
    });
    console.log(JSON.stringify({ source: reference || 'working-tree', engine: 'Chromium PC, clavier simulé', results }, null, 2));
    if (results.some(r => !r.passed)) process.exitCode = 1;
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
