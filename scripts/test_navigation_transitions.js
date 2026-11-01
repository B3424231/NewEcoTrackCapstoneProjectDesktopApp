'use strict';
// Shared navigation only: isolated fixture, no application services or hardware.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.ECOTRACK_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '..');
let browser, server;
const fixture = (sensor = false) => `<!doctype html><html><head><link rel="stylesheet" href="/styles.css"><style>main{flex:1}body{display:flex}header{height:80px}.sidebar-header{height:80px}#sidebar{width:256px} .sensor-menu{display:none}@media(max-width:760px){.sensor-menu{display:block}}</style></head><body class="app-shell"><aside id="sidebar"><div class="sidebar-header"><button id="sidebarToggle">Collapse</button></div><nav><a class="nav-link" id="same" href="Notification.html?v=4">Notifications</a><a class="nav-link" id="context" href="control.html">Control</a><a class="nav-link" id="last" href="staff.html">Maintenance</a></nav><button id="logoutButton">Log out</button></aside><main><header>${sensor ? '<button id="sensorMenu" class="sensor-menu">Menu</button>' : ''}<h1>Notifications</h1></header><div id="content"><div class="eco-skeleton" style="width:80px;height:20px"></div></div><button id="mainButton">Content action</button></main>${sensor ? '<button id="sensorBackdrop" class="sensor-backdrop"></button>' : ''}<div id="logoutModal" style="display:none"><button id="logoutCancel">Cancel</button><button id="logoutConfirm">Confirm</button></div><script>window.EcoNetwork={};window.EcoDataBus={};window.EcoTrackSkeletons={};window.EcoTrackSelectControls={};window.EcoTrackMaintenance={};window.updateGlobalNotificationBadge=()=>{};</script><script src="/js/sidebar.js"></script><script src="/js/sidebar-loader.js"></script></body></html>`;

(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.endsWith('.html')) {
      res.setHeader('Content-Type', 'text/html');
      let html = fixture(url.searchParams.has('sensor'));
      if (url.searchParams.has('sensor')) {
        // Profile's existing backdrop is nested under main; retain that shape here.
        const backdrop = '<button id="sensorBackdrop" class="sensor-backdrop"></button>';
        html = html.replace(backdrop, '').replace('</main>', backdrop + '</main>');
      }
      if (url.searchParams.has('late')) html = html.replace('<div class="eco-skeleton" style="width:80px;height:20px"></div>', '').replace('</body>', `<script>document.addEventListener('DOMContentLoaded',()=>{document.getElementById('content').innerHTML='<div class="eco-skeleton" style="width:80px;height:20px"></div>';});</script></body>`);
      return res.end(html);
    }
    const file = path.resolve(root, 'public', '.' + url.pathname);
    if (!file.startsWith(path.join(root, 'public') + path.sep) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.setHeader('Content-Type', path.extname(file) === '.css' ? 'text/css' : 'text/javascript');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const site = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.ECOTRACK_QA_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1460, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(site + '/Notification.html?v=4');
  await page.waitForTimeout(500);
  await page.evaluate(() => document.getElementById('content').replaceChildren(document.createTextNode('Loaded')));
  await page.waitForTimeout(250);
  await page.locator('#same').click();
  assert.equal(await page.locator('#eco-loader').evaluate(el => getComputedStyle(el).visibility), 'hidden', 'Re-clicking current Notifications never starts a stuck progress bar');
  assert.equal(await page.locator('#same').getAttribute('aria-current'), 'page');
  for (const key of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey']) {
    const prevented = await page.evaluate(key => {
      const event = new MouseEvent('click', { bubbles: true, cancelable: true, [key]: true });
      let canceledByNavigation;
      document.addEventListener('click', event => { canceledByNavigation = event.defaultPrevented; event.preventDefault(); }, { once: true });
      document.getElementById('context').dispatchEvent(event);
      return canceledByNavigation;
    }, key);
    assert.equal(prevented, false, `${key} preserves native link activation`);
    assert.equal(await page.locator('#eco-loader').evaluate(el => getComputedStyle(el).visibility), 'hidden', `${key} does not start current-page progress`);
  }
  assert.equal(await page.evaluate(() => {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 1 });
    let canceled;
    document.addEventListener('click', event => { canceled = event.defaultPrevented; event.preventDefault(); }, { once: true });
    document.getElementById('context').dispatchEvent(event);
    return canceled;
  }), false, 'Middle-click preserves native activation');
  await page.evaluate(() => document.getElementById('context').setAttribute('href', 'control.html?id=changed'));
  await page.locator('#context').click();
  await page.waitForURL(site + '/control.html?id=changed');
  console.log('PASS active Notifications, aria-current, modified clicks, dynamic href');

  for (const sensor of [false, true]) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(site + '/Notification.html?v=4' + (sensor ? '&sensor' : ''));
    const menu = sensor ? '#sensorMenu' : '#ecoNavigationMenu';
    await page.locator(menu).click();
    assert.equal(await page.locator(menu).getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('#sidebar').getAttribute('aria-modal'), 'true');
    assert.equal(await page.locator('main').evaluate(el => el.inert), true);
    assert.equal(await page.locator(sensor ? '#sensorBackdrop' : '#ecoNavigationBackdrop').evaluate(el => !!el.closest('[inert]')), false, 'Backdrop remains interactive outside inert content');
    assert.equal(await page.evaluate(() => document.getElementById('sidebar').contains(document.activeElement)), true);
    await page.locator('#same').evaluate(el => { el.href = location.pathname + location.search; });
    await page.locator('#same').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator(menu).evaluate(el => el === document.activeElement), true, 'Current-page keyboard activation restores the drawer opener');
    assert.equal(await page.evaluate(() => !!document.activeElement.closest('[inert]')), false, 'Focus never remains in the closed inert drawer');
    for (const activation of ['ctrlKey', 'metaKey', 'newTab', 'canceled', 'dialog']) {
      await page.locator(menu).click();
      await page.locator('#context').focus();
      await page.evaluate(activation => {
        const link = document.getElementById('context');
        link.target = activation === 'newTab' ? '_blank' : '';
        document.addEventListener('click', event => {
          event.preventDefault();
          if (activation === 'dialog') document.getElementById('mainButton').focus();
        }, { once: true });
        link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, [activation]: true }));
      }, activation);
      const expected = activation === 'dialog' ? '#mainButton' : menu;
      assert.equal(await page.locator(expected).evaluate(el => el === document.activeElement), true, `${activation} leaves focus in active content after drawer closure`);
    }
    await page.locator(menu).click();
    await page.locator('#logoutButton').focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.getElementById('sidebar').contains(document.activeElement)), true, 'Focus stays in drawer');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator(menu).getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator(menu).evaluate(el => el === document.activeElement), true);
    assert.equal(await page.locator('main').evaluate(el => el.inert), false);
    await page.locator(menu).click();
    await page.locator(sensor ? '#sensorBackdrop' : '#ecoNavigationBackdrop').click({ position: { x: 350, y: 400 } });
    assert.equal(await page.locator(menu).getAttribute('aria-expanded'), 'false', 'Backdrop click closes the drawer');
    await page.evaluate(() => { document.getElementById('content').inert = true; });
    await page.locator(menu).click();
    await page.locator('#logoutButton').click();
    assert.equal(await page.locator(menu).getAttribute('aria-expanded'), 'false', 'Drawer closes before a dialog opens');
    assert.equal(await page.locator('#content').evaluate(el => el.inert), true, 'Original inert state is preserved');
    await page.setViewportSize({ width: 1460, height: 1000 });
    await page.waitForFunction(() => !document.getElementById('sidebar').inert);
    assert.equal(await page.locator('#sidebar').evaluate(el => el.inert), false, 'Desktop navigation remains interactive');
    console.log(`PASS ${sensor ? 'sensor' : 'legacy'} drawer, focus trap, Escape, dialog, inert and resize`);
  }
  await page.setViewportSize({ width: 1460, height: 1000 });
  await page.goto(site + '/Notification.html?v=4&late');
  await page.waitForTimeout(600);
  assert.equal(await page.locator('#eco-loader').evaluate(el => getComputedStyle(el).visibility), 'visible', 'Visible initial skeleton keeps honest progress beyond 300ms');
  await page.evaluate(() => document.getElementById('content').textContent = 'Loaded');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#eco-loader').evaluate(el => getComputedStyle(el).visibility), 'hidden', 'Progress ends when visible initial content settles');
  await page.evaluate(() => document.getElementById('content').setAttribute('aria-busy', 'true'));
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#eco-loader').evaluate(el => getComputedStyle(el).visibility), 'hidden', 'Background refresh does not restart initial page progress');
  await page.evaluate(() => { showLoader(); dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
  await page.waitForTimeout(250);
  assert.equal(await page.locator('#eco-loader').evaluate(el => getComputedStyle(el).visibility), 'hidden', 'History restores clear departing-page progress');
  assert.equal(await page.locator('.eco-skip-link').count(), 1);
  await page.locator('.eco-skip-link').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('main').evaluate(el => el === document.activeElement), true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('#eco-loader').evaluate(el => parseFloat(getComputedStyle(el).transitionDuration)), 0);
  assert.equal(await page.locator('main').evaluate(el => getComputedStyle(el).animationName), 'none');
  assert.deepEqual(errors, [], 'No uncaught renderer errors');
  const blocked = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const blockedErrors = [];
  blocked.on('pageerror', error => blockedErrors.push(error.message));
  await blocked.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new DOMException('Storage denied', 'SecurityError'); };
    Storage.prototype.setItem = () => { throw new DOMException('Storage denied', 'SecurityError'); };
  });
  await blocked.goto(site + '/Notification.html?v=4');
  await blocked.locator('#ecoNavigationMenu').click();
  assert.equal(await blocked.locator('#ecoNavigationMenu').getAttribute('aria-expanded'), 'true');
  await blocked.keyboard.press('Escape');
  assert.deepEqual(blockedErrors, [], 'Shared navigation initializes when storage is blocked');
  await blocked.close();
  console.log('PASS content readiness, background refresh, history restore, skip link, reduced motion');
})().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
