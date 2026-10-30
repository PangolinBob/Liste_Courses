// Vue globale : données et profil isolés, Chromium au format iPhone (pas Safari réel).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const storageKey = 'lc_appData_v1';
const fixture = { schemaVersion: 1, prefs: { theme: 'dark' }, lastBackupISO: null, stores: [
  { id: 's_b', name: 'Marché', template: null, items: [
    { id: 'b2', name: 'Poivrons', qty: 2, planned: true, bought: false },
    { id: 'b_off', name: 'Savon', qty: 1, planned: false, bought: false },
    { id: 'b1', name: 'Lait', qty: 1, planned: true, bought: false },
  ] },
  { id: 's_empty', name: 'Réserve', template: null, items: [
    { id: 'empty_off', name: 'Farine', qty: 1, planned: false, bought: false },
  ] },
  { id: 's_a', name: 'Épicerie', template: null, items: [
    { id: 'a2', name: 'Lait', qty: 3, planned: true, bought: false },
    { id: 'a1', name: 'Riz', qty: 1, planned: true, bought: false },
  ] },
] };

(async () => {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (!['index.html', 'IconCourses.png'].includes(file) && !/^fonts\/[\w.-]+\.woff2$/.test(file)) {
      res.writeHead(404); return res.end();
    }
    res.setHeader('Content-Type', file.endsWith('.png') ? 'image/png' : file.endsWith('.woff2')
      ? 'font/woff2' : 'text/html; charset=utf-8');
    res.end(fs.readFileSync(path.join(root, file)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  const results = [];
  try {
    for (const motion of ['reduce', 'no-preference']) {
      const context = await browser.newContext({ viewport: { width: 375, height: 812 },
        isMobile: true, hasTouch: true, reducedMotion: motion, serviceWorkers: 'block' });
      const page = await context.newPage();
      page.setDefaultTimeout(5000);
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => route.request().url().startsWith(url) ? route.continue() : route.abort());
      await page.goto(url);
      await page.evaluate(({ storageKey, fixture }) => localStorage.setItem(storageKey, JSON.stringify(fixture)),
        { storageKey, fixture });
      await page.reload();
      await page.locator('#splash').click();
      await page.locator('[data-action="open-store"][data-id="s_b"]').click();
      const stored = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
      const rows = () => page.locator('.item-row').evaluateAll(nodes => nodes.map(node => node.dataset.itemRow));
      const groups = () => page.locator('[data-store-section]').evaluateAll(nodes => nodes.map(node => node.dataset.storeSection));
      const remaining = () => page.locator('[data-remaining-count]').innerText();
      const menu = () => page.locator('[data-action="store-menu"]').click();
      const choice = value => page.locator(`.sheet [data-value="${value}"]`).click();
      const openGlobal = async () => { await menu(); await choice('scope'); };

      await menu();
      assert.equal(await page.locator('.sheet [data-value="filter"]').count(), 0,
        'Le menu ne doit plus dupliquer la commande du filtre');
      assert.equal(await page.locator('.sheet [data-value="scope"]').count(), 0,
        'Le choix de tous les magasins est absent lorsque le filtre est OFF');
      await choice('cancel');
      await page.locator('[data-action="toggle-filter-pill"]').click();
      assert.deepEqual(await rows(), ['b2', 'b1']);
      await openGlobal();
      assert.deepEqual(await groups(), ['s_b', 's_a'], 'Ordre des magasins conservé, magasins sans achat masqués');
      assert.deepEqual(await rows(), ['b2', 'b1', 'a2', 'a1'], 'Ordre des articles conservé');
      assert.equal(await remaining(), '4');
      assert.equal(await page.locator('[data-action="add-item"]').count(), 0,
        'Aucun ajout ne doit viser implicitement un magasin caché');
      await menu();
      assert.equal(await page.locator('.sheet [data-value="new"], .sheet [data-value="restore"]').count(), 0,
        'Les actions propres au magasin restent dans sa vue');
      await choice('cancel');

      // Les homonymes de deux magasins restent indépendants ; la carte n'est pas reconstruite.
      await page.evaluate(() => { window.keptCard = document.querySelector('[data-item-row="a2"]'); });
      await page.locator('[data-item-row="a2"] [data-action="qty-inc"]').tap();
      let data = await stored();
      assert.equal(data.stores[2].items[0].qty, 4);
      assert.equal(data.stores[0].items[2].qty, 1);
      assert.equal(await page.evaluate(() => window.keptCard === document.querySelector('[data-item-row="a2"]')), true);
      assert.equal(await remaining(), '4');

      await page.locator('[data-action="toggle-search"]').click();
      await page.locator('#searchInput').fill('lait');
      assert.deepEqual(await rows(), ['b1', 'a2']);
      assert.deepEqual(await groups(), ['s_b', 's_a']);
      await page.locator('#searchInput').fill('introuvable');
      assert.deepEqual(await groups(), []);
      assert.equal(await page.locator('.empty').count(), 1);
      await page.locator('[data-action="clear-search"]').click();
      assert.deepEqual(await rows(), ['b2', 'b1', 'a2', 'a1']);
      assert.equal(await page.evaluate(() => window.keptCard === document.querySelector('[data-item-row="a2"]')), true);
      await page.locator('[data-action="toggle-search"]').click();

      await page.locator('[data-item-row="a2"] .item-name').tap();
      await page.locator('[data-item-row="a2"]').waitFor({ state: 'detached' });
      assert.equal(await remaining(), '3');
      data = await stored();
      assert.equal(data.stores[2].items[0].planned, false);
      assert.equal(data.stores[0].items[2].planned, true);
      await page.locator('[data-item-row="a1"] .item-name').tap();
      await page.locator('[data-store-section="s_a"]').waitFor({ state: 'detached' });
      assert.deepEqual(await groups(), ['s_b']);
      assert.equal(await remaining(), '2');
      await menu(); await choice('undo');
      assert.deepEqual(await groups(), ['s_b', 's_a']);
      assert.deepEqual(await rows(), ['b2', 'b1', 'a1']);

      // Retour et filtre OFF doivent ramener au magasin d'où la vue a été ouverte.
      await page.locator('[data-action="back-home"]').click();
      assert.equal(await page.locator('.store-title').innerText(), 'Marché');
      assert.deepEqual(await rows(), ['b2', 'b1']);
      await openGlobal();
      await page.locator('[data-action="toggle-filter-pill"]').click();
      assert.equal(await page.locator('.store-title').innerText(), 'Marché');
      assert.deepEqual(await rows(), ['b2', 'b_off', 'b1']);
      await page.locator('[data-action="toggle-filter-pill"]').click();
      assert.deepEqual(await groups(), [], 'Réactiver le filtre seul ne change pas les modalités d’affichage');
      await openGlobal();
      await menu(); await choice('scope');
      assert.equal(await page.locator('.store-title').innerText(), 'Marché');
      assert.deepEqual(await rows(), ['b2', 'b1']);

      // Menu d'article : appliquer le changement dans son magasin, même dans la vue globale.
      await openGlobal();
      await page.locator('[data-item-row="a1"] [data-action="item-gear"]').click();
      await choice('rename');
      await page.locator('#modalRoot input').fill('Riz complet');
      await page.locator('[data-modal-ok]').click();
      assert.equal((await stored()).stores[2].items[1].name, 'Riz complet');
      assert.equal(await page.locator('[data-item-row="a1"] .item-name').innerText(), 'Riz complet');

      for (const id of ['b2', 'b1', 'a1']) {
        await page.locator(`[data-item-row="${id}"] .item-name`).tap();
        await page.locator(`[data-item-row="${id}"]`).waitFor({ state: 'detached' });
      }
      assert.equal(await remaining(), '0');
      assert.deepEqual(await groups(), []);
      assert.equal(await page.locator('.empty').innerText(), 'Aucun article à acheter.');
      await menu(); await choice('undo');
      assert.deepEqual(await groups(), ['s_a']);
      assert.deepEqual(await rows(), ['a1']);
      assert.equal(await remaining(), '1');
      assert.deepEqual((await stored()).stores.map(store => store.items.map(item => item.id)),
        fixture.stores.map(store => store.items.map(item => item.id)), 'La vue ne change aucun ordre enregistré');
      const beforeReload = await stored();
      await page.reload();
      assert.deepEqual(await stored(), beforeReload, 'Quantités et achats conservés à la réouverture');
      assert.deepEqual(errors, []);
      results.push({ motion, filterGate: true, groupedOrder: true, itemActions: true, search: true,
        undo: true, emptyGroups: true, passed: true });
      await context.close();
    }

    // Liste longue : défiler sans réorganiser les articles ni passer à un autre magasin.
    {
      const context = await browser.newContext({ viewport: { width: 375, height: 812 },
        isMobile: true, hasTouch: true, serviceWorkers: 'block' });
      const page = await context.newPage();
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.goto(url);
      const longFixture = structuredClone(fixture);
      longFixture.stores[0].items = Array.from({ length: 25 }, (_, i) => ({
        id: `long_${i}`, name: `Article ${i}`, qty: 1, planned: true, bought: false,
      }));
      await page.evaluate(({ storageKey, longFixture }) => localStorage.setItem(storageKey, JSON.stringify(longFixture)),
        { storageKey, longFixture });
      await page.reload(); await page.locator('#splash').click();
      await page.locator('[data-action="open-store"][data-id="s_b"]').click();
      await page.locator('[data-action="toggle-filter-pill"]').click();
      await page.locator('[data-action="store-menu"]').click();
      await page.locator('.sheet [data-value="scope"]').click();
      await page.locator('.modalOverlay').waitFor({ state: 'detached' });
      const cdp = await context.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 180, y: 650 }] });
      for (let i = 1; i <= 8; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 180, y: 650 - 50 * i }] });
        await page.waitForTimeout(20);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      assert.ok(await page.evaluate(() => scrollY > 0), 'La liste globale défile au doigt');
      const toolbar = await page.locator('.store-toolbar').boundingBox();
      assert.ok(toolbar && Math.abs(toolbar.y) < 2, 'Les commandes restent en haut de l’écran');
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 290, y: 150 }] });
      for (let i = 1; i <= 6; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 290 - 30 * i, y: 150 }] });
        await page.waitForTimeout(15);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      assert.equal(await page.locator('.store-title').innerText(), 'À acheter', 'Un balayage ne quitte pas la vue globale');
      assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey), longFixture);
      assert.deepEqual(errors, []);
      results.push({ globalTouchScroll: true, stickyToolbar: true, noStoreSwipe: true, passed: true });
      await context.close();
    }
    console.log(JSON.stringify({ results }, null, 2));
  } finally {
    await browser.close(); await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
