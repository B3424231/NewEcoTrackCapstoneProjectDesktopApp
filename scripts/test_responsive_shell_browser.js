'use strict';
// Isolated real-page checks. Registry/IP fixtures only; no live services or commands.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.ECOTRACK_PLAYWRIGHT || 'playwright');
const root = process.env.ECOTRACK_QA_ROOT || path.resolve(__dirname, '..');
const out = process.env.ECOTRACK_QA_OUTPUT;
const nodes = [{ id: 'missing-ip', name: 'Missing IP Controller', device_mode: 'controller' }, { id: 'reported-ip', name: 'Reported IP Controller', device_mode: 'controller' }];
const failures = [], checks = [], errors = [];
let browser, server;
async function check(name, task) { try { await task(); checks.push(name); console.log('PASS ' + name); } catch (error) { failures.push({ name, error: error.message }); console.log('FAIL ' + name + ': ' + error.message); } }
(async () => {
  server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const base = pathname.startsWith('/assets/') ? root : path.join(root, 'public');
    const file = path.resolve(base, '.' + pathname);
    if (!file.startsWith(base + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const site = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ executablePath: process.env.ECOTRACK_QA_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 1460, height: 800 } });
    await context.route('**/*', async route => {
      const url = route.request().url();
      if (!['GET', 'HEAD'].includes(route.request().method())) return route.abort();
      if (url.startsWith(site + '/api/')) return route.fulfill({ json: { items: [], summary: {}, total: 0, sync: { enabled: false } } });
      if (url.startsWith(site + '/')) return route.continue();
      if (url.startsWith('https://cdn.tailwindcss.com')) return route.fulfill({ path: path.join(root, 'public/vendor/tailwindcss.js'), contentType: 'text/javascript' });
      if (url.startsWith('https://offline-fixture.invalid/rest/v1/')) return route.fulfill({ json: new URL(url).pathname.endsWith('/nodes') ? nodes : [] });
      return route.abort();
    });
    await context.routeWebSocket(/.*/, socket => socket.close());
    await context.addInitScript(({ site, nodes, theme }) => {
      localStorage.setItem('ecoTrack_workspace_mode', 'both');
      localStorage.setItem('ecoTrackTheme', theme);
      if (localStorage.getItem('sidebarCollapsed') === null) localStorage.setItem('sidebarCollapsed', 'true');
      localStorage.setItem('ecoTrack_backend_url', site);
      localStorage.setItem('ecoTrack_supabase_url', 'https://offline-fixture.invalid');
      localStorage.setItem('ecoTrack_supabase_anon_key', 'sb_publishable_isolated_fixture');
      localStorage.setItem('ecoTrack_nodes', JSON.stringify(nodes.map((node, i) => ({ ...node, node_id: node.name, db_id: node.id, status: 'Offline', ip_address: i ? '10.42.0.25' : null }))));
      for (const key of ['aircons', 'rooms', 'floors', 'buildings', 'staff']) localStorage.setItem('ecoTrack_' + key, '[]');
      window.electron = { env: { BACKEND_URL: site }, on() {}, invoke: async () => ({ success: true, data: [], nodes, aircons: [], rooms: [], floors: [], buildings: [] }) };
    }, { site, nodes, theme });
    const page = await context.newPage();
    page.setDefaultTimeout(7000);
    page.setDefaultNavigationTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(site + '/dashboard.html');
    await page.waitForTimeout(1100);
    // Drive an isolated registry event so both missing and reported IP states use the real renderer.
    await page.evaluate(() => {
      const items = JSON.parse(localStorage.getItem('ecoTrack_nodes'));
      items[0].ip_address = null; items[1].ip_address = '10.42.0.25';
      localStorage.setItem('ecoTrack_nodes', JSON.stringify(items));
      window.EcoTrackAirconSystem.AirconEvents.emit('node:updated', {});
    });
    await page.waitForTimeout(150);
    await check(theme + ': missing IP is explicit', async () => { assert.match(await page.locator('#nodesListContainer').innerText(), /IP not reported/); assert.doesNotMatch(await page.locator('#nodesListContainer').innerText(), /192\.168\.1\.101/); });
    await check(theme + ': reported IP retained', async () => assert.match(await page.locator('#nodesListContainer').innerText(), /10\.42\.0\.25/));
    for (const file of ['dashboard.html', 'nodes.html']) {
      await page.goto(site + '/' + file);
      await page.waitForTimeout(750);
      await check(theme + ': ' + file + ' desktop preference', async () => assert(await page.locator('#sidebar').evaluate(el => el.classList.contains('collapsed'))));
      for (const size of [{ width: 390, height: 844 }, { width: 730, height: 400 }]) {
        await page.setViewportSize(size);
        await page.waitForTimeout(150);
        await check(theme + ': ' + file + ' fills ' + size.width + 'px window', async () => {
          const layout = await page.evaluate(() => ({ main: document.querySelector('main').getBoundingClientRect().width, doc: document.documentElement.scrollWidth, width: innerWidth }));
          assert(layout.main >= size.width - 2, JSON.stringify(layout));
          assert(layout.doc <= size.width + 1, JSON.stringify(layout));
          assert(await page.locator('#ecoNavigationMenu').isVisible(), 'Visible Menu button');
        });
        if (file === 'nodes.html') await check(theme + ': device table reachable at ' + size.width, async () => {
          const table = await page.locator('#nodeTableScroll').evaluate(el => { el.scrollLeft = 90; return { h: el.clientHeight, scrolled: el.scrollLeft, top: el.getBoundingClientRect().top }; });
          assert(table.h >= 150, JSON.stringify(table));
          assert(table.scrolled > 0, 'Horizontal table scroll works');
          await page.locator('#nodeTableScroll').evaluate(el => { el.scrollLeft = 0; });
        });
        if (out) await page.screenshot({ path: path.join(out, theme + '-' + file.replace('.html', '') + '-' + size.width + '.png') });
      }
      if (await page.locator('#ecoNavigationMenu').count()) {
        await check(theme + ': ' + file + ' drawer keyboard and focus', async () => {
          await page.locator('#ecoNavigationMenu').click();
          assert.equal(await page.locator('#ecoNavigationMenu').getAttribute('aria-expanded'), 'true');
          assert.equal(await page.locator('main').evaluate(el => el.inert), true);
          assert(await page.locator('#sidebar').isVisible());
          await page.locator('#ecoNavigationClose').focus();
          await page.keyboard.press('Shift+Tab');
          assert(await page.locator('#logoutButton').evaluate(el => el === document.activeElement), 'Backward Tab wraps to last drawer control');
          await page.keyboard.press('Tab');
          assert(await page.locator('#ecoNavigationClose').evaluate(el => el === document.activeElement), 'Forward Tab wraps to first drawer control');
          await page.keyboard.press('Escape');
          assert.equal(await page.locator('#ecoNavigationMenu').getAttribute('aria-expanded'), 'false');
          assert(await page.locator('#ecoNavigationMenu').evaluate(el => el === document.activeElement));
          assert.equal(await page.locator('main').evaluate(el => el.inert), false);
          assert.equal(await page.locator('#sidebar').evaluate(el => el.inert), true);
          await page.locator('#ecoNavigationMenu').click();
          await page.locator('#ecoNavigationBackdrop').click({ position: { x: 700, y: 200 } });
          assert.equal(await page.locator('#ecoNavigationMenu').getAttribute('aria-expanded'), 'false');
          await page.locator('#ecoNavigationMenu').click();
          await page.setViewportSize({ width: 1460, height: 800 });
          assert.equal(await page.locator('main').evaluate(el => el.inert), false);
          assert.equal(await page.locator('#sidebar').evaluate(el => el.inert), false);
          assert(await page.locator('#sidebar').evaluate(el => el.classList.contains('collapsed')), 'Desktop preference restored');
          assert.equal(await page.evaluate(() => localStorage.getItem('sidebarCollapsed')), 'true');
        });
      }
      await page.setViewportSize({ width: 1460, height: 800 });
    }
    await check(theme + ': navigation closes drawer and desktop expanded preference survives', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator('#ecoNavigationMenu').click();
      assert(await page.locator('#sidebar .user-container a').evaluate(el => el.getBoundingClientRect().width > 200), 'Drawer footer labels have full width');
      if (out) await page.screenshot({ path: path.join(out, theme + '-navigation-open-390.png') });
      await page.locator('#sidebar a.nav-link[href="dashboard.html"]').click();
      await page.waitForURL(site + '/dashboard.html');
      await page.locator('#ecoNavigationMenu').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#ecoNavigationMenu').getAttribute('aria-expanded'), 'false');
      assert.equal(await page.locator('main').evaluate(el => el.inert), false);
      await page.setViewportSize({ width: 1460, height: 800 });
      await page.evaluate(() => { initializeSidebarToggle(); initSidebarModules(); initSidebarModules(); });
      await page.locator('#sidebarToggle').focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(() => localStorage.getItem('sidebarCollapsed')), 'false');
      await page.reload();
      await page.locator('#sidebar').waitFor();
      assert.equal(await page.locator('#sidebar').evaluate(el => el.classList.contains('collapsed')), false);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator('#ecoNavigationMenu').click();
      await page.keyboard.press('Escape');
      await page.setViewportSize({ width: 1460, height: 800 });
      assert.equal(await page.locator('#sidebar').evaluate(el => el.classList.contains('collapsed')), false);
      assert.equal(await page.evaluate(() => localStorage.getItem('sidebarCollapsed')), 'false');
    });
    await context.close();
  }
  assert.deepEqual(errors, [], 'No uncaught renderer errors');
  assert.deepEqual(failures, [], 'Responsive shell regressions');
})().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  if (out) fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ checks, failures, errors, stopped: true }, null, 2));
});