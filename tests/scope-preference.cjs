// Le choix du périmètre est une préférence durable, distincte du filtre et de la navigation.
// Profil isolé, Chromium mobile : ne remplace pas un essai Safari sur l'iPhone.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const storageKey = 'lc_appData_v1';
const fixture = { schemaVersion: 1, prefs: { theme: 'dark' }, lastBackupISO: null, stores: [
  { id: 's_first', name: 'Premier magasin', template: null, items: [
    { id: 'i_first', name: 'Lait', qty: 2, planned: true, bought: false },
    { id: 'i_hidden', name: 'Savon', qty: 1, planned: false, bought: false },
  ] },
  { id: 's_second', name: 'Second magasin', template: null, items: [
    { id: 'i_second', name: 'Riz', qty: 1, planned: true, bought: false },
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
    async function scenario(name, run) {
      const context = await browser.newContext({ viewport: { width: 375, height: 812 },
        isMobile: true, hasTouch: true, reducedMotion: 'reduce', serviceWorkers: 'block' });
      try {
        let page = await context.newPage();
        page.setDefaultTimeout(5000);
        const errors = []; context.on('page', p => p.on('pageerror', e => errors.push(e.message)));
        page.on('pageerror', e => errors.push(e.message));
        await context.route('**/*', route => route.request().url().startsWith(url) ? route.continue() : route.abort());
        await page.goto(url);
        await page.evaluate(({ storageKey, fixture }) => localStorage.setItem(storageKey, JSON.stringify(fixture)),
          { storageKey, fixture });
        await page.reload(); await page.locator('#splash').click();
        const openStore = id => page.locator(`[data-action="open-store"][data-id="${id}"]`).click();
        await openStore('s_first');
        const menu = () => page.locator('[data-action="store-menu"]').click();
        const choice = value => page.locator(`.sheet [data-value="${value}"]`).click();
        const toggleFilter = () => page.locator('[data-action="toggle-filter-pill"]').click();
        const back = () => page.locator('[data-action="back-home"]').click();
        const toggleScope = async () => { await menu(); await choice('scope'); };
        const enableGlobal = async () => { await toggleFilter(); await toggleScope(); };
        const groups = () => page.locator('[data-store-section]').evaluateAll(nodes => nodes.map(node => node.dataset.storeSection));
        const assertGlobal = async () => assert.deepEqual(await groups(), ['s_first', 's_second'], 'Le filtre ON doit toujours respecter le choix tous magasins');
        const assertSetting = async on => {
          await menu();
          const scope = page.locator('.sheet [data-value="scope"]');
          assert.equal(await scope.locator('div').first().innerText(), 'Tous les magasins');
          assert.equal(await scope.locator('div').last().innerText(), on ? 'ON' : 'OFF', 'Le menu doit afficher le choix enregistré, même filtre OFF');
          assert.notEqual(await scope.getAttribute('aria-disabled'), 'true', 'Le réglage reste accessible indépendamment du filtre');
          await choice('cancel');
        };
        const reopen = async () => {
          await page.close(); page = await context.newPage(); page.setDefaultTimeout(5000);
          await page.goto(url); await page.locator('#splash').click(); await openStore('s_first');
        };
        await run({ page, context, menu, choice, toggleFilter, back, openStore, toggleScope,
          enableGlobal, groups, assertGlobal, assertSetting, reopen });
        assert.deepEqual(errors, []);
        results.push({ case: name, passed: true });
      } catch (error) {
        results.push({ case: name, passed: false, error: error.message });
      } finally { await context.close(); }
    }

    await scenario('régler tous magasins avec le filtre OFF', async s => {
      await s.assertSetting(false);
      await s.toggleScope();
      await s.assertSetting(true);
      assert.deepEqual(await s.groups(), [], 'Changer le réglage seul ne doit pas activer le filtre');
      await s.toggleFilter(); await s.assertGlobal();
    });
    await scenario('cycle filtre ON → OFF → ON', async s => {
      await s.enableGlobal(); await s.assertGlobal();
      await s.toggleFilter();
      assert.deepEqual(await s.groups(), []);
      await s.toggleFilter(); await s.assertGlobal(); await s.assertSetting(true);
    });
    await scenario('Retour puis ouverture d’un autre magasin', async s => {
      await s.enableGlobal(); await s.back();
      assert.equal(await s.page.locator('[data-action="open-store"]').count(), 2, 'Retour doit naviguer, sans changer le réglage');
      await s.openStore('s_second'); await s.assertSetting(true); await s.assertGlobal();
    });
    await scenario('navigation entre magasins avec le filtre OFF', async s => {
      await s.enableGlobal(); await s.toggleFilter(); await s.back();
      await s.openStore('s_second');
      await s.toggleFilter(); await s.assertGlobal(); await s.assertSetting(true);
    });
    await scenario('réglages et changement de thème', async s => {
      await s.enableGlobal(); await s.toggleFilter(); await s.back();
      await s.page.locator('[data-action="open-settings"]').click();
      await s.page.locator('[data-action="toggle-theme"]').click();
      await s.back(); await s.openStore('s_first');
      await s.toggleFilter(); await s.assertGlobal(); await s.assertSetting(true);
    });
    await scenario('fermeture puis réouverture', async s => {
      await s.enableGlobal(); await s.reopen();
      await s.toggleFilter(); await s.assertGlobal(); await s.assertSetting(true);
    });
    await scenario('Undo ne restaure pas un ancien choix d’affichage', async s => {
      await s.page.locator('[data-item-row="i_first"] [data-action="qty-inc"]').tap();
      await s.enableGlobal(); await s.menu(); await s.choice('undo');
      assert.equal(await s.page.locator('[data-item-row="i_first"] .qty').innerText(), '2');
      await s.assertSetting(true); await s.assertGlobal();
    });
    await scenario('Undo conserve aussi une désactivation explicite', async s => {
      await s.enableGlobal();
      await s.page.locator('[data-item-row="i_first"] [data-action="qty-inc"]').tap();
      await s.toggleScope(); await s.menu(); await s.choice('undo');
      assert.equal(await s.page.locator('[data-item-row="i_first"] .qty').innerText(), '2');
      await s.assertSetting(false); assert.deepEqual(await s.groups(), []);
    });
    await scenario('nouvelle course dans un magasin', async s => {
      await s.enableGlobal(); await s.toggleFilter();
      await s.menu(); await s.choice('new'); await s.page.locator('[data-modal-ok]').click();
      await s.assertSetting(true); await s.toggleFilter();
      assert.deepEqual(await s.groups(), ['s_second'], 'Le magasin vidé ne doit pas faire perdre le périmètre global');
    });
    await scenario('désactivation explicite conservée', async s => {
      await s.enableGlobal(); await s.toggleScope(); await s.assertSetting(false);
      await s.back(); await s.openStore('s_second');
      assert.deepEqual(await s.groups(), []);
      await s.reopen(); await s.assertSetting(false); await s.toggleFilter();
      assert.deepEqual(await s.groups(), []);
    });
    await scenario('ancienne sauvegarde sans ce réglage', async s => {
      await s.enableGlobal(); await s.toggleFilter(); await s.back();
      await s.page.locator('[data-action="open-settings"]').click();
      const pendingChooser = s.page.waitForEvent('filechooser');
      await s.page.locator('[data-action="import"]').click();
      const chooser = await pendingChooser;
      await chooser.setFiles({ name: 'ancienne-sauvegarde.json', mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify({ appData: fixture })) });
      await s.page.locator('[data-modal-ok]').click();
      await s.openStore('s_first');
      await s.toggleFilter(); await s.assertGlobal(); await s.assertSetting(true);
    });
    console.log(JSON.stringify({ results }, null, 2));
    if (results.some(result => !result.passed)) process.exitCode = 1;
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
