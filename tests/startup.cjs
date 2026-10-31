// Banc isolé : réseau ralenti, cache, fermeture/réouverture et conservation des courses.
// Chromium sur PC ; les temps ne sont pas des mesures Safari/iPhone.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '..');
const ref = process.argv.find(arg => arg.startsWith('--ref='))?.slice(6);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const delayMs = 2500;
const storageKey = 'lc_appData_v1';
const fixture = { schemaVersion: 1, prefs: { theme: 'light', allStores: true }, lastBackupISO: '2026-10-01T12:00:00.000Z',
  stores: [{ id: 's_test', name: 'Épicerie test', template: null,
    items: [{ id: 'i_test', name: 'Œufs', qty: 3, planned: true, bought: false }] }] };

// waitForFunction attend une valeur synchrone ; ici les lectures du cache sont asynchrones.
async function waitForAsync(page, predicate) {
  const deadline = Date.now() + 15000;
  while (!(await page.evaluate(predicate))) {
    assert.ok(Date.now() < deadline, `Condition asynchrone non satisfaite : ${predicate}`);
    await pause(50);
  }
}

async function bounded(promise, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Délai dépassé : ${label}`)), 15000);
    })]);
  } finally { clearTimeout(timer); }
}

async function run() {
  const html = ref ? execFileSync('git', ['-C', root, 'show', `${ref}:index.html`])
    : fs.readFileSync(path.join(root, 'index.html'));
  let iconDelay = 0;
  let fontDelay = 0;
  let htmlDelay = 0;
  let htmlStatus = 200;
  let missingFont = false;
  let revision = '';
  let workerRevision = '';
  let onUnavailableResponse = null;
  const requests = [];
  const basePath = '/Liste_Courses/';
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    requests.push(pathname);
    if (pathname === '/setup.html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end('<!doctype html><title>Préparation isolée</title>'); return;
    }
    const name = pathname === basePath ? 'index.html' : pathname.slice(basePath.length);
    const allowed = ['index.html', 'IconCourses.png', 'sw.js', 'fonts/syne-latin.woff2',
      'fonts/syne-latin-ext.woff2', 'fonts/syne-greek.woff2'];
    res.setHeader('Cache-Control', 'no-store');
    if (!pathname.startsWith(basePath) || !allowed.includes(name) ||
        (name !== 'index.html' && !fs.existsSync(path.join(root, name))) ||
        (missingFont && name.endsWith('.woff2'))) {
      res.writeHead(404); res.end('Introuvable'); return;
    }
    if (name === 'IconCourses.png') await pause(iconDelay);
    if (name.endsWith('.woff2')) await pause(fontDelay);
    if (name === 'index.html') await pause(htmlDelay);
    res.setHeader('Content-Type', name.endsWith('.png') ? 'image/png' : name.endsWith('.js')
      ? 'application/javascript' : name.endsWith('.woff2') ? 'font/woff2' : 'text/html; charset=utf-8');
    if (name === 'index.html') {
      res.writeHead(htmlStatus);
      if (htmlStatus === 503) res.once('finish', () => onUnavailableResponse?.());
      res.end(htmlStatus === 200 ? html.toString().replace('</title>', `${revision}</title>`) : 'Indisponible');
    } else if (name === 'sw.js') {
      const worker = fs.readFileSync(path.join(root, name), 'utf8');
      res.end(worker.replace('shell-v1', `shell-v1${workerRevision}`));
    } else res.end(fs.readFileSync(path.join(root, name)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const url = origin + basePath;
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  const results = [];
  const checkpoint = label => {
    if (process.argv.includes('--debug')) console.log(label);
  };
  try {
    for (const slowResource of ['font', 'logo']) {
      iconDelay = slowResource === 'logo' ? delayMs : 0;
      fontDelay = slowResource === 'font' ? delayMs : 0;
      const context = await browser.newContext({ viewport: { width: 375, height: 812 },
        isMobile: true, hasTouch: true, serviceWorkers: 'block', colorScheme: 'dark' });
      const page = await context.newPage();
      const errors = [];
      const external = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', async route => {
        if (route.request().url().startsWith(origin)) return route.continue();
        external.push(route.request().url());
        if (slowResource === 'font') await pause(delayMs);
        await route.fulfill({ contentType: 'text/css', body: '/* police lente simulée */' });
      });
      await page.goto(url, { waitUntil: 'commit' });
      await page.locator('#splash').click();
      await page.waitForFunction(() => document.body.classList.contains('ready'));
      await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('#app')).opacity) > .99);
      await page.waitForFunction(() => performance.getEntriesByName('first-contentful-paint').length > 0);
      const timing = await page.evaluate(() => ({ appReadyMs: performance.now(),
        firstPaintMs: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null,
        loadEventMs: performance.getEntriesByType('navigation')[0].loadEventEnd }));
      if (ref) {
        assert.ok(timing.appReadyMs >= delayMs, `Le blocage initial doit être reproduit (${slowResource})`);
      } else {
        assert.ok(timing.appReadyMs < delayMs * .6, `L’app doit être disponible avant la ressource lente : ${JSON.stringify(timing)}`);
        assert.equal(external.length, 0, 'Aucune dépendance réseau extérieure pour démarrer');
        if (slowResource === 'logo') assert.equal(timing.loadEventMs, 0, 'La liste est disponible avant window.load');
      }
      assert.deepEqual(errors, []);
      results.push({ case: `attente ${slowResource}`, simulatedDelayMs: delayMs,
        ...Object.fromEntries(Object.entries(timing).map(([key, value]) => [key, value === null ? null : Math.round(value)])),
        externalRequests: external.length, passed: true });
      checkpoint(`Affichage sans attente ${slowResource} vérifié`);
      await context.close();
    }
    iconDelay = 0;
    fontDelay = 0;

    if (!ref) {
      const context = await browser.newContext({ viewport: { width: 375, height: 812 },
        isMobile: true, hasTouch: true, colorScheme: 'dark' });
      const page = await context.newPage();
      const errors = [];
      context.on('page', p => p.on('pageerror', error => errors.push(error.message)));
      page.on('pageerror', error => errors.push(error.message));
      // Préparer les données avant que le SW puisse s’installer et nettoyer ses caches.
      await page.goto(origin + '/setup.html');
      await page.evaluate(({ storageKey, fixture, url }) => {
        localStorage.setItem(storageKey, JSON.stringify(fixture));
        return Promise.all([`liste-courses:${url}:obsolete`,
          `liste-courses:${location.origin}/autre-app/:shell-v1`, 'autre-app-cache'].map(name => caches.open(name)));
      }, { storageKey, fixture, url });
      await page.goto(url);
      await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
      const cacheNames = await page.evaluate(() => caches.keys());
      assert.ok(cacheNames.includes('autre-app-cache'), 'Les caches des autres applications sont préservés');
      assert.ok(cacheNames.includes(`liste-courses:${origin}/autre-app/:shell-v1`), 'Un autre périmètre de Liste Courses est préservé');
      assert.ok(!cacheNames.includes(`liste-courses:${url}:obsolete`), 'Seul le vieux cache de ce périmètre est retiré');

      // Fermer l’écran, couper entièrement le réseau et rouvrir depuis la même origine.
      await page.close();
      await context.setOffline(true);
      const offline = await context.newPage();
      await offline.goto(url, { waitUntil: 'domcontentloaded' });
      await offline.locator('#splash').click();
      await offline.locator('[data-action="open-store"]').filter({ hasText: 'Épicerie test' }).click();
      assert.equal(await offline.locator('.item-name').innerText(), 'Œufs');
      assert.deepEqual(await offline.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey), fixture);
      assert.equal(await offline.locator('.qty').innerText(), '3');
      await offline.locator('[data-action="qty-inc"]').click();
      const modified = structuredClone(fixture); modified.stores[0].items[0].qty = 4;
      assert.deepEqual(await offline.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey), modified);
      await offline.goto(url + 'index.html?source=iphone', { waitUntil: 'domcontentloaded' });
      assert.deepEqual(await offline.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey), modified);
      await offline.locator('#splash').click();
      const fontLoaded = await offline.evaluate(async () => {
        const fonts = await document.fonts.load('600 16px Syne', 'Épicerie Œufs Łódź Αθήνα');
        return fonts.length > 0 && fonts.every(font => font.status === 'loaded');
      });
      assert.equal(fontLoaded, true, 'La police et ses accents sont disponibles hors connexion');
      results.push({ case: 'fermeture/réouverture hors connexion', dataAndEditsPreserved: true,
        fontAvailable: true, otherAppsUntouched: true, passed: true });
      checkpoint('Réouverture hors connexion vérifiée');

      // Une réponse lente ne doit pas retarder le cache ; l’actualisation prépare l’ouverture suivante.
      await context.setOffline(false);
      revision = ' — version suivante';
      htmlDelay = delayMs;
      const start = Date.now();
      await offline.reload({ waitUntil: 'domcontentloaded' });
      assert.ok(Date.now() - start < delayMs * .6, 'Le cache répond avant le serveur lent');
      assert.equal(await offline.title(), 'Liste de courses', 'La page ouverte garde sa version');
      await waitForAsync(offline, async () => {
        const names = await caches.keys();
        const name = names.find(value => value.startsWith(`liste-courses:${location.origin}/Liste_Courses/:shell-`));
        const cached = await (await caches.open(name)).match(new URL('index.html', location.href).href);
        return cached && (await cached.text()).includes('version suivante');
      });
      htmlDelay = 0;
      const updatedResponse = await offline.reload({ waitUntil: 'domcontentloaded' });
      assert.equal(await offline.title(), 'Liste de courses — version suivante', JSON.stringify({
        fromWorker: updatedResponse.fromServiceWorker(),
        responseTitle: (await updatedResponse.text()).match(/<title>(.*?)<\/title>/)?.[1],
        caches: await offline.evaluate(() => caches.keys()), requests: requests.slice(-12),
      }));
      assert.deepEqual(await offline.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey), modified);
      results.push({ case: 'serveur lent et actualisation différée', passed: true });
      checkpoint('Actualisation différée vérifiée');

      // Une erreur serveur ne doit jamais remplacer la copie qui fonctionne.
      htmlStatus = 503;
      // Les requêtes propres au SW ne sont pas des réponses de la page.
      // Vérifier la réponse 503 réellement envoyée par le serveur de ce banc.
      const failedResponse = new Promise(resolve => { onUnavailableResponse = resolve; });
      await offline.reload({ waitUntil: 'domcontentloaded' });
      await bounded(failedResponse, 'réponse HTTP 503 du serveur');
      await pause(100); // Laisser le SW traiter la réponse reçue.
      await context.setOffline(true);
      await offline.reload({ waitUntil: 'domcontentloaded' });
      assert.equal(await offline.title(), 'Liste de courses — version suivante');
      assert.deepEqual(await offline.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey), modified);
      results.push({ case: 'erreur serveur, copie valide conservée', passed: true });
      checkpoint('Erreur serveur vérifiée');

      htmlStatus = 200;
      await context.setOffline(false);
      // Observer avant de rendre la nouvelle version disponible : un register automatique
      // au premier affichage peut lancer l’update avant notre appel explicite.
      await offline.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        window.nextWorkerState = new Promise(resolve => {
          registration.addEventListener('updatefound', () => {
            const worker = registration.installing;
            worker.addEventListener('statechange', () => {
              if (worker.state === 'redundant' || worker.state === 'activated') resolve(worker.state);
            });
          }, { once: true });
        });
      });
      missingFont = true;
      workerRevision = '-incomplete';
      const failedInstall = await bounded(offline.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        await registration.update();
        return window.nextWorkerState;
      }), 'rejet de la mise à jour incomplète');
      assert.equal(failedInstall, 'redundant', 'Une mise à jour incomplète est rejetée');
      await context.setOffline(true);
      await offline.reload({ waitUntil: 'domcontentloaded' });
      assert.equal(await offline.title(), 'Liste de courses — version suivante');
      assert.deepEqual(await offline.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey), modified);
      results.push({ case: 'mise à jour incomplète rejetée, ancienne copie disponible hors connexion', passed: true });
      checkpoint('Mise à jour incomplète vérifiée');

      missingFont = false;
      await context.setOffline(false);
      workerRevision = '-update';
      await offline.locator('#splash').click();
      await offline.locator('[data-action="open-store"]').click();
      await offline.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        await registration.update();
      });
      await waitForAsync(offline, async () => (await caches.keys()).includes(`liste-courses:${location.origin}/Liste_Courses/:shell-v1-update`));
      await waitForAsync(offline, async () => !(await caches.keys()).includes(`liste-courses:${location.origin}/Liste_Courses/:shell-v1`));
      assert.equal(await offline.locator('.item-name').innerText(), 'Œufs', 'La mise à jour ne recharge pas l’écran en cours');
      assert.deepEqual(await offline.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey), modified);
      assert.ok((await offline.evaluate(() => caches.keys())).includes('autre-app-cache'));
      assert.deepEqual(errors, []);
      results.push({ case: 'nouveau service worker, écran et données préservés', passed: true });
      await context.close();
    }
    console.log(JSON.stringify({ source: ref || 'working-tree', engine: 'Chromium PC', results }, null, 2));
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
