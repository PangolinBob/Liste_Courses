// Tests de gestes tactiles réels via Chromium ; aucun profil utilisateur n'est utilisé.
// PLAYWRIGHT_MODULE peut désigner une installation existante de Playwright.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '..');
const baseline = process.argv.includes('--baseline');
const storageKey = 'lc_appData_v1';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function touch(cdp, type, points = []) {
  await cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: p.id || i + 1, radiusX: 2, radiusY: 2 })),
  });
}

async function center(locator) {
  const r = await locator.boundingBox();
  assert.ok(r, 'La cible tactile doit être visible');
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

async function moveFinger(cdp, from, to, steps = 8) {
  for (let i = 1; i <= steps; i++) {
    await touch(cdp, 'touchMove', [{
      x: from.x + (to.x - from.x) * i / steps,
      y: from.y + (to.y - from.y) * i / steps,
    }]);
    await pause(30);
  }
  await pause(120);
}

async function stored(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
}

async function clean(page, errors) {
  await pause(180);
  assert.deepEqual(errors, [], 'Aucune erreur JavaScript pendant le geste');
  assert.equal(await page.locator('.ghost, .drag-preview, .drag-chosen, .drag-placeholder, .drag-moving').count(), 0,
    'Le relâchement doit retirer toute carte flottante et toute sélection');
  assert.equal(await page.locator('body.drag-lock, html.drag-lock, body.is-reordering').count(), 0,
    'Le défilement doit être libéré');
}

async function run() {
  const source = baseline
    ? execFileSync('git', ['-C', root, 'show', 'fdce6ea:index.html'])
    : fs.readFileSync(path.join(root, 'index.html'));
  const server = http.createServer((req, res) => {
    const file = req.url.split('?')[0] === '/IconCourses.png' ? 'IconCourses.png' : 'index.html';
    res.setHeader('Content-Type', file.endsWith('.png') ? 'image/png' : 'text/html; charset=utf-8');
    res.end(file === 'index.html' ? source : fs.readFileSync(path.join(root, file)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined),
    headless: true,
  });
  const results = [];
  try {
    async function boot(store = true) {
      const context = await browser.newContext({
        viewport: { width: 375, height: 812 }, deviceScaleFactor: 3,
        isMobile: true, hasTouch: true, colorScheme: 'dark',
        // Exerce aussi le placement de la carte flottante spécifique à iOS.
        // Le moteur reste Chromium : ce test ne remplace pas Safari sur un appareil.
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.route('**/*', route => route.request().url().startsWith(url)
        ? route.continue() : route.abort());
      await page.goto(url);
      await page.locator('#splash').click();
      await pause(700);
      if (store) await page.locator('[data-action="open-store"]').filter({ hasText: 'Carrefour' }).click();
      await pause(200);
      return { context, page, errors, cdp: await context.newCDPSession(page) };
    }

    // Ce scénario a reproduit la carte bloquée sur la version fdce6ea.
    {
      const { context, page, errors, cdp } = await boot();
      const before = await stored(page);
      const start = await center(page.locator('.item-name').nth(2));
      const end = await center(page.locator('.item-name').nth(5));
      await touch(cdp, 'touchStart', [start]);
      await pause(450);
      await moveFinger(cdp, start, end);
      await touch(cdp, 'touchEnd');
      await pause(200);
      if (baseline) {
        assert.ok(errors.some(e => e.includes('armFailSafe')), JSON.stringify(errors));
        assert.equal(await page.locator('.ghost').count(), 1);
        results.push({ case: 'défaut initial', reproduced: true, errors, floatingCardAfterRelease: 1 });
        await context.close();
      } else {
        await clean(page, errors);
        const after = await stored(page);
        const ids = after.stores[0].items.map(it => it.id);
        assert.ok(ids.indexOf(before.stores[0].items[2].id) > 2, 'L’article doit changer de place');
        assert.equal(ids.length, before.stores[0].items.length);
        assert.deepEqual(after.stores[0].items.map(it => [it.id, it.qty, it.planned]).sort(),
          before.stores[0].items.map(it => [it.id, it.qty, it.planned]).sort());
        await page.reload();
        assert.deepEqual((await stored(page)).stores[0].items.map(it => it.id), ids, 'Ordre sauvegardé');
        results.push({ case: 'article déplacé puis relâché', passed: true });
        await context.close();
      }
    }

    if (!baseline) {
      {
        const { context, page, errors } = await boot();
        await page.evaluate(() => {
          window.rowBeforeBlur = document.querySelector('.item-row');
          window.dispatchEvent(new Event('blur'));
        });
        assert.equal(await page.evaluate(() => window.rowBeforeBlur === document.querySelector('.item-row')), true,
          'Sans déplacement, quitter la fenêtre ne doit pas reconstruire la liste');
        await clean(page, errors);
        results.push({ case: 'interruption sans geste, page préservée', passed: true });
        await context.close();
      }
      {
        const { context, page, errors, cdp } = await boot(false);
        const before = await stored(page);
        const start = await center(page.locator('.store-row .name').first());
        const end = await center(page.locator('.store-row .name').nth(3));
        await touch(cdp, 'touchStart', [start]); await pause(420);
        await moveFinger(cdp, start, end); await touch(cdp, 'touchEnd');
        await clean(page, errors);
        const after = await stored(page);
        assert.ok(after.stores.findIndex(s => s.id === before.stores[0].id) > 0);
        assert.deepEqual(after.stores.map(s => s.id).sort(), before.stores.map(s => s.id).sort());
        assert.equal(await page.locator('.store-row').count(), before.stores.length,
          'Un déplacement ne doit pas ouvrir le magasin');
        results.push({ case: 'magasin déplacé', passed: true });
        await context.close();
      }
      {
        const { context, page, errors, cdp } = await boot();
        const before = await stored(page);
        const start = await center(page.locator('.item-name').nth(2));
        await touch(cdp, 'touchStart', [start]); await pause(420);
        await moveFinger(cdp, start, { x: start.x, y: start.y + 180 });
        await touch(cdp, 'touchCancel');
        await clean(page, errors);
        assert.deepEqual(await stored(page), before, 'Une annulation ne doit rien sauvegarder');
        results.push({ case: 'geste annulé', passed: true });
        await context.close();
      }
      {
        const { context, page, errors, cdp } = await boot();
        const start = { x: 180, y: 600 };
        await touch(cdp, 'touchStart', [start]); await pause(50);
        await moveFinger(cdp, start, { x: 180, y: 250 }, 6);
        await touch(cdp, 'touchEnd');
        await clean(page, errors);
        assert.ok((await page.evaluate(() => scrollY)) > 0,
          'Un balayage rapide doit continuer à faire défiler la page');
        results.push({ case: 'défilement tactile ordinaire', passed: true });
        await context.close();
      }
      {
        const { context, page, errors, cdp } = await boot();
        const before = await stored(page);
        const start = await center(page.locator('.item-name').nth(1));
        await touch(cdp, 'touchStart', [start]); await pause(420);
        await touch(cdp, 'touchEnd');
        await clean(page, errors);
        assert.deepEqual(await stored(page), before, 'Appui long sans mouvement : aucun changement');
        results.push({ case: 'appui long sans déplacement', passed: true });
        await context.close();
      }
      {
        const { context, page, errors, cdp } = await boot();
        const before = await stored(page);
        const start = await center(page.locator('.item-name').nth(1));
        await touch(cdp, 'touchStart', [start]); await pause(420);
        await moveFinger(cdp, start, { x: start.x, y: start.y + 160 });
        await touch(cdp, 'touchStart', [
          { x: start.x, y: start.y + 160, id: 1 }, { x: 260, y: 500, id: 2 },
        ]);
        await touch(cdp, 'touchEnd');
        await clean(page, errors);
        assert.deepEqual(await stored(page), before, 'Un second doigt annule sans modifier les données');
        results.push({ case: 'second doigt', passed: true });
        await context.close();
      }
      {
        const { context, page, errors, cdp } = await boot();
        const before = await stored(page);
        const start = await center(page.locator('.item-name').nth(1));
        await touch(cdp, 'touchStart', [start]); await pause(420);
        await moveFinger(cdp, start, { x: start.x, y: start.y + 160 });
        await page.evaluate(() => window.dispatchEvent(new Event('blur')));
        await touch(cdp, 'touchEnd');
        await clean(page, errors);
        assert.deepEqual(await stored(page), before, 'Une interruption annule sans sauvegarder');
        results.push({ case: 'interruption de la fenêtre', passed: true });
        await context.close();
      }
      {
        const { context, page, errors, cdp } = await boot();
        const start = await center(page.locator('[data-action="qty-inc"]').first());
        await touch(cdp, 'touchStart', [start]); await touch(cdp, 'touchEnd');
        await pause(180);
        assert.equal(await page.locator('.qty').first().innerText(), '2');
        const rowTap = await center(page.locator('.item-name').first());
        await touch(cdp, 'touchStart', [rowTap]); await touch(cdp, 'touchEnd');
        await clean(page, errors);
        assert.equal((await stored(page)).stores[0].items[0].planned, true,
          'Le toucher bref doit toujours sélectionner l’article');
        results.push({ case: 'boutons de quantité et toucher bref', passed: true });
        await context.close();
      }
      {
        const { context, page, errors, cdp } = await boot(false);
        const tap = await center(page.locator('.store-row .name').first());
        await touch(cdp, 'touchStart', [tap]); await touch(cdp, 'touchEnd');
        await clean(page, errors);
        assert.equal(await page.locator('.store-title').innerText(), 'Carrefour');
        results.push({ case: 'ouverture par toucher bref', passed: true });
        await context.close();
      }
      {
        const { context, page, errors, cdp } = await boot();
        await page.locator('.item-name').nth(0).click();
        await page.locator('.item-name').nth(2).click();
        await page.locator('.item-name').nth(4).click();
        await page.locator('[data-action="toggle-filter-pill"]').click();
        const before = await stored(page);
        const visibleBefore = await page.locator('.item-row').evaluateAll(rows => rows.map(r => r.dataset.itemRow));
        const from = await center(page.locator('.item-name').first());
        const to = await center(page.locator('.item-name').last());
        await touch(cdp, 'touchStart', [from]); await pause(420);
        await moveFinger(cdp, from, { x: to.x, y: to.y + 15 }); await touch(cdp, 'touchEnd');
        await clean(page, errors);
        const after = await stored(page);
        const visible = new Set(visibleBefore);
        const beforeIds = before.stores[0].items.map(it => it.id);
        const afterIds = after.stores[0].items.map(it => it.id);
        assert.notDeepEqual(afterIds, beforeIds, 'Les articles visibles doivent être réordonnés');
        beforeIds.forEach((id, i) => { if (!visible.has(id)) assert.equal(afterIds[i], id); });
        assert.deepEqual(afterIds.slice().sort(), beforeIds.slice().sort(), 'Aucun article perdu par le filtre');
        results.push({ case: 'déplacement avec filtre, articles masqués préservés', passed: true });
        await context.close();
      }
      {
        const { context, page, errors, cdp } = await boot();
        const start = await center(page.locator('.item-name').nth(3));
        await touch(cdp, 'touchStart', [start]); await pause(420);
        const original = await page.locator('.item-row').nth(3).boundingBox();
        const bottomY = await page.evaluate(() => innerHeight - 8);
        await moveFinger(cdp, start, { x: start.x, y: bottomY });
        await pause(750);
        const downY = await page.evaluate(() => scrollY);
        assert.ok(downY > 80, 'Le bord inférieur doit faire défiler la liste');
        const floating = await page.locator('.drag-preview').boundingBox();
        assert.ok(floating && Math.abs(floating.width - original.width) < 2 &&
          Math.abs(floating.height - original.height) < 2, 'La carte flottante conserve ses dimensions');
        assert.ok(Math.abs(floating.y + (start.y - original.y) - bottomY) < 8,
          `La carte doit rester sous le doigt : ${JSON.stringify({ floating, start, original, bottomY, downY })}`);
        const floatingLayout = await page.locator('.drag-preview').evaluate(row => ({
          display: getComputedStyle(row).display, columns: getComputedStyle(row).gridTemplateColumns,
          children: row.children.length,
        }));
        assert.equal(floatingLayout.display, 'grid');
        assert.equal(floatingLayout.children, 3);
        await moveFinger(cdp, { x: start.x, y: bottomY }, { x: start.x, y: 150 });
        await pause(750);
        const upY = await page.evaluate(() => scrollY);
        assert.ok(upY < downY, `Défilement au-dessus des articles : ${upY} < ${downY}`);
        await touch(cdp, 'touchEnd');
        await clean(page, errors);
        const releasedY = await page.evaluate(() => scrollY);
        await pause(220);
        assert.equal(await page.evaluate(() => scrollY), releasedY, 'Le défilement automatique doit cesser');
        results.push({ case: 'défilement automatique, carte intacte et arrêt au relâchement', passed: true });
        await context.close();
      }
      {
        const { context, page, errors, cdp } = await boot();
        for (let repetition = 0; repetition < 2; repetition++) {
          const start = await center(page.locator('.item-name').nth(1));
          const end = await center(page.locator('.item-name').nth(4));
          await touch(cdp, 'touchStart', [start]); await pause(420);
          await moveFinger(cdp, start, end); await touch(cdp, 'touchEnd');
          await clean(page, errors);
          await pause(380);
        }
        const qtyBefore = Number(await page.locator('.qty').first().innerText());
        const tap = await center(page.locator('[data-action="qty-inc"]').first());
        await touch(cdp, 'touchStart', [tap]); await touch(cdp, 'touchEnd');
        await pause(150);
        assert.equal(Number(await page.locator('.qty').first().innerText()), qtyBefore + 1,
          'Les boutons doivent répondre après des déplacements successifs');
        await clean(page, errors);
        results.push({ case: 'déplacements successifs puis utilisation des boutons', passed: true });
        await context.close();
      }
      {
        const { context, page, errors } = await boot();
        await page.locator('[data-action="toggle-search"]').click();
        await page.locator('#searchInput').fill('ch');
        await pause(150);
        const before = await stored(page);
        const visibleBefore = await page.locator('.item-row').evaluateAll(rows => rows.map(r => r.dataset.itemRow));
        assert.ok(visibleBefore.length >= 2, 'La recherche doit afficher plusieurs articles');
        // Souris : même liste, mêmes règles de sauvegarde, sans appui long tactile.
        const start = await center(page.locator('.item-name').first());
        const end = await center(page.locator('.item-name').last());
        await page.mouse.move(start.x, start.y); await page.mouse.down();
        await page.mouse.move(end.x, end.y + 12, { steps: 10 }); await pause(150);
        await page.mouse.up();
        await clean(page, errors);
        const after = await stored(page);
        const visible = new Set(visibleBefore);
        const beforeIds = before.stores[0].items.map(it => it.id);
        const afterIds = after.stores[0].items.map(it => it.id);
        assert.notDeepEqual(afterIds, beforeIds);
        beforeIds.forEach((id, i) => { if (!visible.has(id)) assert.equal(afterIds[i], id); });
        results.push({ case: 'souris et recherche, éléments masqués préservés', passed: true });
        await context.close();
      }
    }
    console.log(JSON.stringify({ mode: baseline ? 'baseline' : 'regression', results }, null, 2));
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
run().catch(e => { console.error(e); process.exitCode = 1; });
