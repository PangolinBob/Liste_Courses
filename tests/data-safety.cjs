// Profils isolés : ces essais ne lisent ni ne modifient les courses de l'iPhone.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const key = 'lc_appData_v1';
const baseline = process.argv.includes('--baseline');
const baselineSource = baseline ? execFileSync('git', ['-C', root, 'show', '5862a4f:index.html']) : null;
const fixture = { schemaVersion: 1, prefs: { theme: 'dark', allStores: true, sortMode: 'alpha',
  futurePreference: { enabled: true } }, lastBackupISO: '2026-10-01T12:00:00.000Z',
  customMetadata: 'à conserver', stores: [
    { id: 's_first', name: 'Épicerie personnalisée', template: null, items: [
      { id: 'i_first', name: 'Œufs fermiers', qty: 2, planned: true, bought: false },
      { id: 'i_other', name: 'Savon', qty: 1, planned: false, bought: false },
    ] },
    { id: 's_second', name: 'Second magasin', items: [
      { id: 'i_second', name: 'Riz', qty: 1, planned: true },
    ] },
  ] };
const invalidRaw = '{"schemaVersion":1,"stores":[';

(async () => {
  const server = http.createServer((req, res) => {
    const file = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
    if (file === 'setup.html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end('<!doctype html><title>Préparation isolée</title>');
    }
    if (!['index.html', 'IconCourses.png'].includes(file) && !/^fonts\/[\w.-]+\.woff2$/.test(file)) {
      res.writeHead(404); return res.end();
    }
    res.setHeader('Content-Type', file.endsWith('.png') ? 'image/png' : file.endsWith('.woff2')
      ? 'font/woff2' : 'text/html; charset=utf-8');
    res.end(file === 'index.html' && baselineSource ? baselineSource : fs.readFileSync(path.join(root, file)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  const results = [];
  try {
    async function scenario(name, run, { raw = JSON.stringify(fixture), refuseInitially = false, core = false } = {}) {
      if (baseline && !core) return;
      const context = await browser.newContext({ viewport: { width: 375, height: 812 },
        isMobile: true, hasTouch: true, colorScheme: 'dark', reducedMotion: 'reduce', serviceWorkers: 'block' });
      try {
        const page = await context.newPage(); page.setDefaultTimeout(5000);
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        await context.route('**/*', route => route.request().url().startsWith(url) ? route.continue() : route.abort());
        await page.goto(url + 'setup.html');
        if (raw !== null) await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key, raw });
        async function refuseWrites() {
          await page.evaluate(key => {
            const original = Storage.prototype.setItem;
            Storage.prototype.setItem = function (name, value) {
              if (name === key) throw new DOMException('Refus simulé', 'QuotaExceededError');
              return original.call(this, name, value);
            };
            window.allowStorageWrites = () => { Storage.prototype.setItem = original; };
          }, key);
        }
        if (refuseInitially) await context.addInitScript(key => {
          const original = Storage.prototype.setItem;
          Storage.prototype.setItem = function (name, value) {
            if (name === key) throw new DOMException('Refus simulé', 'QuotaExceededError');
            return original.call(this, name, value);
          };
        }, key);
        await page.goto(url);
        if (await page.locator('body.ready').count()) await page.locator('#splash').click();
        const storedRaw = () => page.evaluate(key => localStorage.getItem(key), key);
        const stored = async () => JSON.parse(await storedRaw());
        const menu = () => page.locator('[data-action="store-menu"]').click();
        const choice = value => page.locator(`.sheet [data-value="${value}"]`).click();
        const openStore = () => page.locator('[data-action="open-store"][data-id="s_first"]').click();
        const settings = () => page.locator('[data-action="open-settings"]').click();
        const back = () => page.locator('[data-action="back-home"]').click();
        async function importData(data) {
          const previousNotice = await page.locator('#toastRoot').evaluateHandle(root => root.firstElementChild);
          const chooserPromise = page.waitForEvent('filechooser');
          await page.locator('[data-action="import"]').click();
          await (await chooserPromise).setFiles({ name: 'sauvegarde-test.json', mimeType: 'application/json',
            buffer: Buffer.from(JSON.stringify({ appData: data })) });
          await page.locator('[data-modal-ok]').click();
          // Attendre l’issue de cet import, pas un ancien message encore affiché.
          await page.waitForFunction(previous => {
            const current = document.querySelector('#toastRoot').firstElementChild;
            return current && current !== previous && /invalide|impossible|restauration|restaurée/i.test(current.textContent);
          }, previousNotice);
          await previousNotice.dispose();
        }
        const quantity = () => page.locator('[data-item-row="i_first"] .qty').innerText();
        const errorToast = async () => {
          await page.waitForFunction(() => /impossible|non enregistr|pas été conserv|pu être enregistr|refus/i.test(document.querySelector('#toastRoot').textContent));
          assert.doesNotMatch(await page.locator('#toastRoot').innerText(), /ajouté|supprimé|renommé|créée|Restauration OK|Ordre mis à jour/);
        };
        await run({ page, context, storedRaw, stored, menu, choice, openStore, settings, back,
          refuseWrites, importData, quantity, errorToast, errors });
        assert.deepEqual(errors, [], 'Aucune erreur JavaScript ne doit échapper à l’application');
        results.push({ case: name, passed: true });
      } catch (error) {
        results.push({ case: name, passed: false, error: error.message });
      } finally { await context.close(); }
    }

    for (const [name, stores] of [['magasin null', [null]],
      ['articles null', [{ id: 's_bad', name: 'Magasin incomplet', items: null }]]]) {
      await scenario(`import invalide (${name}) : les courses précédentes restent intactes`, async s => {
        await s.settings(); await s.importData({ schemaVersion: 1, prefs: { theme: 'dark' }, stores });
        assert.deepEqual(await s.stored(), fixture, 'Un import invalide ne doit jamais remplacer les données enregistrées');
        await s.back(); await s.openStore(); assert.equal(await s.quantity(), '2');
      }, { core: true });
    }
    await scenario('démarrage : contenu illisible conservé et exportable', async s => {
      assert.ok(await s.storedRaw() === invalidRaw, 'Une lecture impossible ne doit pas réinitialiser les courses');
      assert.equal(await s.page.locator('[data-recovery]').count(), 1);
      const downloadPromise = s.page.waitForEvent('download');
      await s.page.locator('[data-action="export-recovery"]').click();
      const download = await downloadPromise;
      assert.equal(fs.readFileSync(await download.path(), 'utf8'), invalidRaw);
      assert.equal(await s.storedRaw(), invalidRaw);
    }, { raw: invalidRaw, core: true });
    await scenario('écriture refusée : quantité visible et enregistrée inchangée', async s => {
      await s.openStore(); await s.refuseWrites();
      await s.page.locator('[data-item-row="i_first"] [data-action="qty-inc"]').click();
      assert.equal(await s.quantity(), '2', 'La quantité affichée doit revenir à celle réellement enregistrée');
      assert.deepEqual(await s.stored(), fixture); await s.errorToast();
      await s.menu(); assert.equal(await s.page.locator('.sheet [data-value="undo"]').getAttribute('aria-disabled'), 'true');
    }, { core: true });

    const malformed = [
      ['identifiant injecté', data => { data.stores[0].id = 's_" onclick="alert(1)'; }],
      ['magasins avec le même identifiant', data => { data.stores[1].id = data.stores[0].id; }],
      ['articles avec le même identifiant', data => { data.stores[1].items[0].id = data.stores[0].items[0].id; }],
      ['quantité non numérique', data => { data.stores[0].items[0].qty = '2'; }],
      ['quantité hors limites', data => { data.stores[0].items[0].qty = 0; }],
      ['nom vide', data => { data.stores[0].items[0].name = ' '; }],
      ['préférences non objet', data => { data.prefs = 'dark'; }],
    ];
    for (const [name, damage] of malformed) await scenario(`refus avant engagement : ${name}`, async s => {
      const damaged = structuredClone(fixture); damage(damaged);
      await s.settings(); await s.importData(damaged); assert.deepEqual(await s.stored(), fixture);
    });
    await scenario('restauration valide : noms, ordre, articles et préférences inconnues conservés', async s => {
      const incoming = structuredClone(fixture); incoming.stores.reverse(); incoming.stores[1].items.reverse();
      incoming.stores[1].name = 'Ma liste à moi'; incoming.prefs.futurePreference = { enabled: false, mode: 'futur' };
      await s.settings(); await s.importData(incoming); assert.deepEqual(await s.stored(), incoming);
    });
    await scenario('ancienne sauvegarde sans préférences : restauration compatible', async s => {
      const incoming = structuredClone(fixture); delete incoming.prefs;
      await s.settings(); await s.importData(incoming);
      const restored = await s.stored(); assert.deepEqual(restored.stores, fixture.stores);
      assert.equal(restored.prefs.theme, 'dark'); assert.equal(restored.prefs.allStores, true);
      assert.equal(restored.prefs.sortMode, 'alpha');
    });
    await scenario('version incompatible conservée puis remplacée par une vraie sauvegarde', async s => {
      const untouched = await s.storedRaw(); assert.equal(JSON.parse(untouched).schemaVersion, 99);
      assert.equal(await s.page.locator('[data-recovery]').count(), 1);
      await s.importData(fixture); assert.deepEqual(await s.stored(), fixture);
      await s.openStore(); assert.equal(await s.quantity(), '2');
    }, { raw: JSON.stringify({ schemaVersion: 99, stores: fixture.stores }) });
    await scenario('premier démarrage sans écriture possible : écran de récupération sans faux succès', async s => {
      assert.equal(await s.storedRaw(), null);
      assert.equal(await s.page.locator('[data-recovery]').count(), 1);
      assert.equal(await s.page.locator('[data-action="open-store"]').count(), 0);
    }, { raw: null, refuseInitially: true });
    await scenario('lecture temporairement refusée : aucun écrasement et nouvel essai possible', async s => {
      await s.context.addInitScript(key => {
        const original = Storage.prototype.getItem;
        Storage.prototype.getItem = function (name) {
          if (name === key) throw new DOMException('Lecture refusée', 'SecurityError');
          return original.call(this, name);
        };
        window.allowStorageReads = () => { Storage.prototype.getItem = original; };
      }, key);
      await s.page.reload(); await s.page.locator('#splash').click();
      assert.equal(await s.page.locator('[data-recovery]').count(), 1);
      assert.equal(await s.page.locator('[data-action="export-recovery"]').isDisabled(), true);
      await s.page.evaluate(() => window.allowStorageReads()); assert.deepEqual(await s.stored(), fixture);
    });
    await scenario('récupération : restauration refusée sans perdre le contenu conservé, puis réessayée', async s => {
      await s.refuseWrites(); await s.importData(fixture); assert.equal(await s.storedRaw(), invalidRaw);
      assert.equal(await s.page.locator('[data-recovery]').count(), 1); await s.errorToast();
      await s.page.evaluate(() => window.allowStorageWrites()); await s.importData(fixture);
      assert.deepEqual(await s.stored(), fixture); await s.openStore(); assert.equal(await s.quantity(), '2');
    }, { raw: invalidRaw });
    await scenario('import refusé à l’enregistrement : état antérieur et message exact', async s => {
      const incoming = structuredClone(fixture); incoming.stores[0].name = 'Import non enregistré';
      await s.settings(); await s.refuseWrites(); await s.importData(incoming);
      assert.deepEqual(await s.stored(), fixture); await s.errorToast();
      await s.back(); await s.openStore(); assert.equal(await s.quantity(), '2');
    });
    await scenario('annulation refusée puis réessayée : historique utilisable et présentation conservée', async s => {
      await s.openStore(); await s.page.locator('[data-item-row="i_first"] [data-action="qty-inc"]').click();
      assert.equal(await s.quantity(), '3');
      const incoming = await s.stored(); incoming.prefs.sortMode = 'manual'; incoming.prefs.allStores = false;
      await s.back(); await s.settings(); await s.importData(incoming); await s.openStore();
      await s.menu(); await s.choice('undo'); assert.equal(await s.quantity(), '3');
      assert.equal((await s.stored()).prefs.sortMode, 'manual');
      assert.equal((await s.stored()).prefs.allStores, false);
      await s.refuseWrites(); await s.menu(); await s.choice('undo');
      assert.equal(await s.quantity(), '3'); await s.errorToast();
      await s.page.evaluate(() => window.allowStorageWrites()); await s.menu(); await s.choice('undo');
      assert.equal(await s.quantity(), '2'); const restored = await s.stored();
      assert.equal(restored.prefs.sortMode, 'manual'); assert.equal(restored.prefs.allStores, false);
      assert.deepEqual(restored.prefs.futurePreference, fixture.prefs.futurePreference);
    });
    await scenario('ajout refusé : aucun article ni message de succès trompeur', async s => {
      await s.openStore(); await s.refuseWrites(); await s.page.locator('[data-action="add-item"]').click();
      await s.page.locator('#modalRoot input').fill('Article non enregistré'); await s.page.locator('[data-modal-ok]').click();
      assert.deepEqual(await s.stored(), fixture); await s.errorToast();
      assert.equal(await s.page.getByText('Article non enregistré', { exact: true }).count(), 0);
    });
    await scenario('thème refusé : couleurs et préférence réellement enregistrée cohérentes', async s => {
      await s.refuseWrites(); await s.menu(); await s.choice('theme'); await s.errorToast();
      assert.equal(await s.page.locator('body').getAttribute('data-theme'), 'dark');
      assert.deepEqual(await s.stored(), fixture);
    });
    await scenario('export : fichier conservé, erreur explicite si sa date ne peut être enregistrée', async s => {
      await s.settings(); await s.refuseWrites(); const downloadPromise = s.page.waitForEvent('download');
      await s.page.locator('[data-action="export"]').click(); const download = await downloadPromise;
      const exported = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
      assert.deepEqual(exported.appData, fixture); assert.deepEqual(await s.stored(), fixture);
      await s.errorToast();
    });
    const manualFixture = structuredClone(fixture); manualFixture.prefs.sortMode = 'manual';
    await scenario('déplacement refusé : ordre initial rétabli sans faux succès', async s => {
      await s.openStore(); await s.refuseWrites();
      const first = await s.page.locator('[data-item-row="i_first"]').boundingBox();
      const second = await s.page.locator('[data-item-row="i_other"]').boundingBox();
      const x = first.x + first.width * .6, from = first.y + first.height / 2, to = second.y + second.height * .8;
      const cdp = await s.context.newCDPSession(s.page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: from }] });
      await s.page.waitForTimeout(380);
      for (let step = 1; step <= 10; step++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: from + (to - from) * step / 10 }] });
        await s.page.waitForTimeout(25);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await s.errorToast(); assert.deepEqual(await s.stored(), manualFixture);
      assert.deepEqual(await s.page.locator('[data-item-row]').evaluateAll(rows => rows.map(row => row.dataset.itemRow)), ['i_first', 'i_other']);
      assert.equal(await s.page.locator('.drag-preview').count(), 0);
    }, { raw: JSON.stringify(manualFixture) });
    console.log(JSON.stringify({ mode: baseline ? 'baseline-RED' : 'regression', results }, null, 2));
    if (results.some(result => !result.passed)) process.exitCode = 1;
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
