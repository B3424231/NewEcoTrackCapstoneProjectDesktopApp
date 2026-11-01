'use strict';
// Real pages and sidebar cache; isolated browser storage, no live API or hardware.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.ECOTRACK_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '..');
let browser, server;

(async () => {
  server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname.startsWith('/api/')) {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ items: [], summary: {}, sync: { enabled: false } }));
    }
    const base = pathname.startsWith('/assets/') ? root : path.join(root, 'public');
    const file = path.resolve(base, '.' + pathname);
    if (!file.startsWith(base + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404); return res.end();
    }
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' })[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const site = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ executablePath: process.env.ECOTRACK_QA_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const errors = [];
  for (const theme of ['dark', 'light']) for (const mode of ['both', 'monitoring']) {
    const context = await browser.newContext({ viewport: { width: 1460, height: 1000 } });
    await context.route('**/*', route => route.request().url().startsWith(site + '/') ? route.continue() : route.abort());
    await context.routeWebSocket(/.*/, socket => socket.close());
    await context.addInitScript(({ site, theme, mode }) => {
      localStorage.setItem('ecoTrackTheme', theme);
      localStorage.setItem('ecoTrack_workspace_mode', mode);
      localStorage.setItem('ecoTrack_backend_url', site);
      window.electron = { env: { BACKEND_URL: site }, invoke: async () => ({ success: true, data: [], nodes: [], aircons: [], rooms: [], floors: [], buildings: [] }), on() {} };
    }, { site, theme, mode });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    async function expectState(collapsed, label) {
      await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('main')).opacity) > .99);
      assert.equal(await page.locator('#sidebar').evaluate(element => element.classList.contains('collapsed')), collapsed, label);
      await page.waitForFunction(collapsed => {
        const width = document.getElementById('sidebar').getBoundingClientRect().width;
        return collapsed ? width <= 101 : width >= 250;
      }, collapsed);
      assert.equal(await page.evaluate(() => localStorage.getItem('sidebarCollapsed')), String(collapsed), label + ': saved preference');
    }
    async function click(collapsed, label) {
      await page.locator('#sidebarToggle').click();
      await expectState(collapsed, label);
    }
    // The first visit fetches the template; the next page restores its synchronous cache.
    await page.goto(site + '/analytics.html');
    await click(true, 'Fresh Analytics collapses');
    await page.locator('a.nav-link[href="telemetry.html"]').click();
    await page.waitForURL(site + '/telemetry.html');
    await expectState(true, 'Telemetry restores collapsed state');
    await click(false, 'Cached Telemetry expands with one click');
    await page.locator('a.nav-link[href="analytics.html"]').click();
    await page.waitForURL(site + '/analytics.html');
    await expectState(false, 'Analytics restores expanded state');
    await click(true, 'Cached Analytics collapses with one click');
    await page.reload();
    await expectState(true, 'Reload restores collapsed state');
    await click(false, 'Reloaded Analytics expands with one click');
    await page.evaluate(() => { initializeSidebarToggle(); initSidebarModules(); });
    await page.locator('#sidebarToggle').focus();
    await page.keyboard.press('Enter');
    await expectState(true, 'Reinitialization preserves one keyboard toggle');
    await page.keyboard.press('Space');
    await expectState(false, 'Space expands once');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#sensorMenu').click();
    assert.equal(await page.locator('#sensorMenu').getAttribute('aria-expanded'), 'true');
    assert(await page.locator('#sidebar').isVisible());
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#sensorMenu').getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('#sidebar').isVisible(), false);
    console.log(`PASS ${theme} / ${mode}: fresh and cached Analytics/Telemetry, reload, persistence, repeated initialization, keyboard and mobile menu`);
    await context.close();
  }
  assert.deepEqual(errors, [], 'No uncaught renderer errors');
})().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
