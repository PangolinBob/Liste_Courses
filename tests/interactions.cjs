const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const baseline = process.argv.includes('--baseline');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const source = baseline ? execFileSync('git', ['-C', root, 'show', '9bb4df7:index.html'])
    : fs.readFileSync(path.join(root, 'index.html'));
  const server = http.createServer((req, res) => {
    const icon = req.url.startsWith('/IconCourses.png');
    res.setHeader('Content-Type', icon ? 'image/png' : 'text/html; charset=utf-8');
    res.end(icon ? fs.readFileSync(path.join(root, 'IconCourses.png')) : source);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  const results = [];
  try {
    for (const motion of ['reduce', 'no-preference']) {
      const page = await browser.newPage({ viewport: { width: 375, height: 812 }, reducedMotion: motion });
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.route('**/*', r => r.request().url().startsWith(url) ? r.continue() : r.abort());
      await page.goto(url); await page.locator('#splash').click(); await wait(700);
      await page.locator('[data-action="open-store"]').filter({ hasText: 'Carrefour' }).click();
      await page.locator('.item-name').nth(0).click(); await page.locator('.item-name').nth(2).click();
      await page.locator('[data-action="toggle-filter-pill"]').click();
      const remaining = () => page.locator('.meta-row .pill strong').first().innerText();
      assert.equal(await remaining(), '2');
      await page.locator('.item-name').first().click(); await wait(220);
      if (baseline) {
        if (motion === 'reduce') {
          assert.equal(await remaining(), '2');
          assert.equal(await page.locator('.removing').count(), 1);
          results.push({ case: 'suppression sans animation', staleCounterReproduced: true });
        }
        await page.close(); continue;
      }
      assert.equal(await remaining(), '1');
      assert.equal(await page.locator('.item-row').count(), 1);
      await page.locator('.item-name').first().click(); await wait(220);
      assert.equal(await remaining(), '0');
      assert.equal(await page.locator('.item-row').count(), 0);
      assert.equal(await page.locator('.empty').count(), 1);
      await page.locator('[data-action="toggle-filter-pill"]').click();
      const initialCount = await page.locator('.item-row').count();
      const kept = await page.locator('.item-row').first().getAttribute('data-item-row');
      await page.locator('[data-action="toggle-search"]').click();
      await page.evaluate(id => { window.keptCard = document.querySelector(`[data-item-row="${id}"]`); }, kept);
      await page.locator('#searchInput').fill('zzz');
      assert.equal(await page.locator('.item-row').count(), 0);
      await page.locator('[data-action="clear-search"]').click();
      assert.equal(await page.locator('.item-row').count(), initialCount);
      assert.equal(await page.evaluate(id => window.keptCard === document.querySelector(`[data-item-row="${id}"]`), kept), true);
      await page.locator('[data-action="toggle-search"]').click();
      await page.locator('[data-action="item-gear"]').first().click();
      await page.locator('.sheet [data-value="rename"]').click();
      await page.locator('#modalRoot input').waitFor();
      await wait(220); // La fermeture de l'ancien menu ne doit pas effacer le nouveau formulaire.
      assert.equal(await page.locator('#modalRoot input').count(), 1);
      assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('#modalRoot input')), true);
      await page.locator('#modalRoot input').fill('Article renommé');
      await page.locator('[data-modal-ok]').click();
      await page.locator('.item-name').filter({ hasText: 'Article renommé' }).waitFor();
      await page.locator('[data-action="add-item"]').click();
      await page.locator('#modalRoot input').fill('Article ajouté');
      await page.locator('[data-modal-ok]').click();
      assert.equal(await page.locator('.item-name').filter({ hasText: 'Article ajouté' }).count(), 1);
      assert.deepEqual(errors, []);
      results.push({ motion, filteredRemoval: true, emptyList: true, searchCache: true,
        chainedDialogs: true, renameAndAdd: true, passed: true });
      await page.close();
    }
    console.log(JSON.stringify({ mode: baseline ? 'baseline' : 'regression', results }, null, 2));
  } finally {
    await browser.close(); await new Promise(resolve => server.close(resolve));
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
