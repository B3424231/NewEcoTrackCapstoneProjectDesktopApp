'use strict';
// Real renderer navigation, isolated read-only fixtures, and an ephemeral local asset server.
// ECOTRACK_PLAYWRIGHT may point to an existing Playwright installation; no backend is started.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { performance } = require('node:perf_hooks');
const { chromium } = require(process.env.ECOTRACK_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '..');
const out = path.resolve(process.env.ECOTRACK_TRANSITION_REPORT_DIR || path.join(root, 'reports/page-transitions-20261030'));
const api = 'http://127.0.0.1:59999';
const routes = ['analytics.html', 'telemetry.html', 'dashboard.html', 'control.html', 'nodes.html', 'ir-library.html', 'scheduler.html', 'rules.html', 'Notification.html', 'staff.html', 'sensor-logs.html', 'profile.html'];
const now = Date.parse('2026-10-30T07:00:00Z');
const sample = { observed_at: new Date(now).toISOString(), target_temperature_c: 24, control_snapshot: { configured_state: { temp: 24, fan: 'high', mode: 'cool' } }, outlet_temperature_c: 18, temperature_quality: 'good', rotation_rpm: 600, rotation_quality: 'good', ac_on: true, operating_mode: 'cool', interval_seconds: 60 };
const node = { id: 'transition-fixture-sensor', name: 'Transition Fixture Sensor', active: true, fresh: true, status: 'online', aircon_id: 'transition-fixture-ac', aircon_name: 'Transition Fixture AC', aircon_type: 'Window Type', location: 'Fixture Building · Floor 1 · Room 1', created_at: '2026-10-01T00:00:00Z', expected_interval_seconds: 60, latest: sample };
const controllers = [1, 2].map(index => ({ id: 'transition-controller-' + index, name: 'Transition Controller ' + index, device_mode: 'controller', status: 'Offline' }));
const controlAircons = controllers.map((controller, index) => ({ id: 'transition-control-ac-' + (index + 1), aircon_id: 'transition-control-ac-' + (index + 1), asset_tag: 'FIXTURE-AC-' + (index + 1), device_id: 'FIXTURE-AC-' + (index + 1), name: 'Transition Control AC ' + (index + 1), controller_node_id: controller.id, node_id: controller.id, device_mode: 'controller', aircon_type: 'Window Type', brand: 'Unspecified', model: '', protocol_name: 'NEC', status: 'offline' }));
const metadata = { success: true, nodes: controllers, aircons: controlAircons, rooms: [], floors: [], buildings: [] };
const checks = [], errors = [], missing = [], mutations = [], cdnScripts = [], transitions = [];
let browser, server, site;
async function check(name, work) {
  const start = performance.now();
  try { await work(); checks.push({ name, status: 'PASS', ms: Math.round(performance.now() - start) }); console.log('PASS ' + name); }
  catch (error) { checks.push({ name, status: 'FAIL', error: error.message, ms: Math.round(performance.now() - start) }); console.log('FAIL ' + name + ': ' + error.message.split('\n')[0]); }
}
async function fixtureContext(options = {}) {
  const context = await browser.newContext({ viewport: options.viewport || { width: 1460, height: 1000 }, timezoneId: 'Asia/Singapore' });
  const state = { fail: false, delayMs: 0, pending: 0 };
  await require('./helpers/browser-local-api').installLocalApiBridge(context, { backendUrl: api, routeFixtures: true });
  await context.routeWebSocket(/.*/, socket => socket.close());
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.hostname === 'transition-fixture.invalid' && /^\/rest\/v1\/rpc\/ecotrack_(?:my_profile|is_admin|admin_list_staff)$/.test(url.pathname)) {
      return route.fulfill({ json: url.pathname.endsWith('/ecotrack_is_admin') ? true : [] });
    }
    if (!['GET', 'HEAD'].includes(request.method())) { mutations.push({ method: request.method(), path: url.pathname }); return route.fulfill({ status: 503, json: { error: 'Fixture is read only' } }); }
    if (request.url().startsWith(site + '/')) {
      if (url.pathname === '/favicon.ico') return route.fulfill({ status: 204 });
      return route.continue();
    }
    if (['cdn.tailwindcss.com', 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'unpkg.com'].includes(url.hostname) && request.resourceType() === 'script') {
      cdnScripts.push({ page: request.frame().url(), url: request.url() });
      if (url.hostname === 'cdn.tailwindcss.com') return route.fulfill({ path: path.join(root, 'public/vendor/tailwindcss.js'), contentType: 'text/javascript' });
      if (url.pathname.includes('chart.js')) return route.fulfill({ path: path.join(root, 'public/vendor/chart.umd.js'), contentType: 'text/javascript' });
      return route.abort();
    }
    if (request.url().startsWith(api + '/')) {
      state.pending++;
      try {
        if (state.delayMs) await new Promise(resolve => setTimeout(resolve, state.delayMs));
        if (state.fail) return await route.fulfill({ status: 503, json: { error: 'Isolated fixture backend unavailable' }, headers: { 'Access-Control-Allow-Origin': '*' } });
        let data = { items: [], total: 0, totalItems: 0, totalPages: 0 };
        if (url.pathname === '/api/monitoring/devices') data = { items: [node] };
        if (url.pathname === '/api/monitoring/analytics') data = { sample_count: 1, confirmed_state_count: 1, confirmed_unit_hours: .1, observed_unit_hours: .1, temperature_avg: 18, points: [{ ...sample, temperature: 18 }] };
        if (url.pathname === '/api/monitoring/telemetry') data = { items: [{ ...sample, id: 'transition-reading', node_id: node.id, sensor_name: node.name, aircon_type: node.aircon_type, location: node.location }], total: 1 };
        if (url.pathname === '/api/monitoring/energy') data = { available: false, code: 'SENSOR_REFERENCE_NO_COVERAGE', points: [], devices: [] };
        return await route.fulfill({ json: data, headers: { 'Access-Control-Allow-Origin': '*' } });
      } finally { state.pending--; }
    }
    if (url.hostname === 'transition-fixture.invalid') {
      const table = url.pathname.split('/').pop();
      const rows = table === 'nodes' ? controllers : table === 'aircons' ? controlAircons : [];
      return route.fulfill({ json: rows, headers: { 'content-range': rows.length ? '0-' + (rows.length - 1) + '/' + rows.length : '0-0/0' } });
    }
    // Every other external URL is blocked, including all real services.
    return route.abort();
  });
  await context.addInitScript(({ api, now, metadata, blockedStorage }) => {
    window.__transitionDocument = Math.random().toString(36).slice(2);
    if (!/^https?:$/.test(location.protocol)) return;
    const NativeDate = Date;
    window.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } };
    const seed = (key, value) => { if (localStorage.getItem(key) === null) localStorage.setItem(key, value); };
    seed('ecoTrackTheme', 'dark'); seed('sidebarCollapsed', 'false');
    localStorage.setItem('ecoTrack_workspace_mode', 'both'); localStorage.setItem('ecoTrack_session_timeout', 'Never');
    localStorage.setItem('ecoTrack_backend_url', api); localStorage.setItem('ecoTrack_supabase_url', 'https://transition-fixture.invalid');
    localStorage.setItem('ecoTrack_supabase_anon_key', 'sb_publishable_isolated_transition_fixture');
    localStorage.setItem('ecoTrack_profile_user', JSON.stringify({ id: 'transition-fixture-admin', username: 'Fixture Admin', name: 'Fixture Admin', role: 'admin', session_timeout: 'Never' }));
    localStorage.setItem('ecoTrack_nodes', JSON.stringify(metadata.nodes.map(item => ({ ...item, db_id: item.id, node_id: item.id }))));
    localStorage.setItem('ecoTrack_aircons', JSON.stringify(metadata.aircons));
    window.electron = { env: { BACKEND_URL: api }, on() {}, invoke: async (channel, input) => {
      if (channel === 'monitoring-sync-registry') return { success: true, data: { changed: false } };
      if (channel === 'scheduler-fetch-data') return metadata;
      if (channel === 'monitoring-fetch-assets') return { success: true, data: metadata.aircons };
      if (channel === 'rules-fetch-data' && input?.report) return { success: true, data: { complete: true, rules: [], notifications: [], ...metadata } };
      return { success: true, data: [], nodes: [], aircons: [], rooms: [], floors: [], buildings: [] };
    } };
    if (blockedStorage) {
      // Exercise unavailable writes after fixture authentication/config have been seeded.
      Storage.prototype.setItem = function () { throw new DOMException('Fixture storage blocked', 'QuotaExceededError'); };
    }
  }, { api, now, metadata, blockedStorage: Boolean(options.blockedStorage) });
  context.on('page', page => {
    page.setDefaultTimeout(5000); page.setDefaultNavigationTimeout(12000);
    page.on('pageerror', error => errors.push({ page: page.url(), error: error.message, blockedStorage: Boolean(options.blockedStorage) }));
    page.on('response', response => { if (response.url().startsWith(site + '/') && response.status() >= 400) missing.push({ url: response.url(), status: response.status() }); });
  });
  return { context, state };
}
async function shellReady(page) { await page.locator('#sidebar').waitFor({ state: 'attached' }); await page.waitForFunction(() => Boolean(document.querySelector('#sidebar a[href*="profile.html"]'))); }
async function navigate(page, file) {
  const start = performance.now();
  const target = page.locator('#sidebar a[href^="' + file + '"]').first();
  assert.equal(await target.count(), 1, 'Sidebar destination exists: ' + file);
  await target.click();
  await page.waitForURL(url => url.pathname.endsWith('/' + file), { waitUntil: 'domcontentloaded' });
  await shellReady(page);
  transitions.push({ route: file, ms: Math.round(performance.now() - start), url: page.url() });
}
async function sensorReady(page) { await page.waitForFunction(() => document.getElementById('sensorApp')?.getAttribute('aria-busy') === 'false' && document.getElementById('sensorConnection')?.textContent.startsWith('Local backend connected')); }
async function loaderHidden(page) { await page.waitForFunction(() => { const el = document.getElementById('eco-loader'); return !el || getComputedStyle(el).visibility === 'hidden' || getComputedStyle(el).display === 'none'; }); }
async function main() {
  fs.mkdirSync(out, { recursive: true });
  server = http.createServer((request, response) => {
    const file = path.resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://local').pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404); return response.end('Not found'); }
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
    response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); site = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ executablePath: process.env.ECOTRACK_QA_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const { context } = await fixtureContext();
  const page = await context.newPage();
  try {
    await page.goto(site + '/public/profile.html'); await shellReady(page);
    for (const file of routes) {
      await check('sidebar route and current-page semantics: ' + file, async () => {
        await navigate(page, file);
        const current = page.locator('#sidebar a[aria-current="page"]');
        assert.equal(await current.count(), 1, 'Exactly one current-page link');
        assert(new URL(await current.getAttribute('href'), page.url()).pathname.endsWith('/' + file));
      });
    }
    await check('repeated current Notifications does not reload or leave progress visible', async () => {
      await navigate(page, 'Notification.html'); await loaderHidden(page);
      const documentId = await page.evaluate(() => window.__transitionDocument);
      for (let i = 0; i < 3; i++) { await page.locator('#sidebar a[href^="Notification.html"]').click(); await page.waitForTimeout(120); }
      assert.equal(await page.evaluate(() => window.__transitionDocument), documentId, 'Current-page clicks keep the document');
      await loaderHidden(page);
    });
    await check('Ctrl-click opens destination in a new tab and keeps current document', async () => {
      const before = { url: page.url(), id: await page.evaluate(() => window.__transitionDocument) };
      const popupPending = context.waitForEvent('page', { timeout: 5000 });
      await page.locator('#sidebar a[href^="analytics.html"]').click({ modifiers: ['Control'] });
      const popup = await popupPending;
      try { await popup.waitForURL('**/analytics.html'); await shellReady(popup); assert.equal(page.url(), before.url); assert.equal(await page.evaluate(() => window.__transitionDocument), before.id); await loaderHidden(page); }
      finally { await popup.close(); }
    });
    await check('navigation honors a link href changed after sidebar initialization', async () => {
      await page.locator('#sidebar a[href^="dashboard.html"]').evaluate(el => el.setAttribute('href', 'profile.html?transition-check=href'));
      await page.locator('#sidebar a[href="profile.html?transition-check=href"]').click();
      await page.waitForURL('**/profile.html?transition-check=href'); await shellReady(page);
    });
    await check('skip link is keyboard reachable and moves focus to main', async () => {
      const skip = page.locator('a').filter({ hasText: /^Skip to (main )?content$/i }).first();
      assert.equal(await skip.count(), 1, 'Skip link exists');
      await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
      await page.keyboard.press('Tab'); assert(await skip.evaluate(el => el === document.activeElement), 'First Tab reaches skip link');
      await page.keyboard.press('Enter');
      assert(await page.locator('main').evaluate(el => el === document.activeElement || el.contains(document.activeElement)), 'Skip link moves focus to main');
    });
    await check('theme and desktop collapse survive sidebar navigation', async () => {
      await page.evaluate(() => { localStorage.setItem('ecoTrackTheme', 'light'); document.documentElement.classList.remove('dark'); });
      if (!(await page.locator('#sidebar').evaluate(el => el.classList.contains('collapsed')))) await page.locator('#sidebarToggle').click();
      for (const file of ['dashboard.html', 'analytics.html', 'telemetry.html', 'profile.html']) {
        await navigate(page, file);
        assert.equal(await page.locator('html').evaluate(el => el.classList.contains('dark')), false, file + ' keeps theme');
        assert(await page.locator('#sidebar').evaluate(el => el.classList.contains('collapsed')), file + ' keeps collapse');
      }
      await page.locator('#sidebarToggle').click();
    });
    await check('Analytics dates and device survive Analytics → Telemetry → Analytics', async () => {
      await navigate(page, 'analytics.html'); await sensorReady(page);
      await page.locator('#sensorFrom').fill('2026-10-10'); await page.locator('#sensorFrom').dispatchEvent('change');
      await page.locator('#sensorThrough').fill('2026-10-11'); await page.locator('#sensorThrough').dispatchEvent('change');
      await page.locator('#sensorSelect').selectOption(node.id); await sensorReady(page);
      await navigate(page, 'telemetry.html'); await sensorReady(page);
      await navigate(page, 'analytics.html'); await sensorReady(page);
      assert.equal(await page.locator('#sensorFrom').inputValue(), '2026-10-10');
      assert.equal(await page.locator('#sensorThrough').inputValue(), '2026-10-11');
      assert.equal(await page.locator('#sensorSelect').inputValue(), node.id);
    });
    await check('Control device survives a sidebar round trip and explicit workspace links take priority', async () => {
      await navigate(page, 'control.html');
      await page.locator('#airconDropdownTrigger').click();
      await page.locator('#airconDropdownList [role="option"]').filter({ hasText: 'FIXTURE-AC-2' }).click();
      assert.match(await page.locator('#selectedAcIdBadge').innerText(), /FIXTURE-AC-2/);
      await navigate(page, 'profile.html'); await navigate(page, 'control.html');
      await page.waitForFunction(() => document.getElementById('selectedAcIdBadge')?.textContent.trim() === 'FIXTURE-AC-2');
      // The current interface has no visible workspace tab strip; exercise the supported deep link.
      await page.goto(site + '/public/control.html?id=FIXTURE-AC-2&tab=logs'); await shellReady(page);
      await navigate(page, 'profile.html'); await navigate(page, 'control.html');
      assert.equal(new URL(page.url()).searchParams.get('tab'), 'logs');
      assert(await page.locator('#tabContent-logs').isVisible());
      await page.goto(site + '/public/control.html?id=FIXTURE-AC-1&tab=overview'); await shellReady(page);
      await page.waitForFunction(() => document.getElementById('selectedAcIdBadge')?.textContent.trim() === 'FIXTURE-AC-1');
      assert(await page.locator('#tabContent-overview').isVisible(), 'Explicit URL overrides saved device and tab');
    });
    await check('IR Library selected device survives navigation and explicit id wins', async () => {
      await navigate(page, 'ir-library.html');
      await page.locator('#targetDeviceSelect').selectOption('FIXTURE-AC-2');
      await navigate(page, 'telemetry.html'); await navigate(page, 'ir-library.html');
      await page.waitForFunction(() => document.getElementById('targetDeviceSelect')?.value === 'FIXTURE-AC-2');
      await page.goto(site + '/public/ir-library.html?id=FIXTURE-AC-1'); await shellReady(page);
      await page.waitForFunction(() => document.getElementById('targetDeviceSelect')?.value === 'FIXTURE-AC-1');
    });
    await check('dashboard status filter survives a sidebar round trip', async () => {
      await navigate(page, 'dashboard.html');
      await page.locator('.filter-pill[data-filter="standby"]').click();
      await navigate(page, 'profile.html'); await navigate(page, 'dashboard.html');
      assert(await page.locator('.filter-pill[data-filter="standby"]').evaluate(el => el.classList.contains('active')));
    });
    await page.setViewportSize({ width: 390, height: 844 });
    for (const file of ['dashboard.html', 'analytics.html', 'telemetry.html', 'scheduler.html', 'profile.html']) {
      await check('narrow drawer traps focus, Escape restores focus and main: ' + file, async () => {
        await page.goto(site + '/public/' + file); await shellReady(page);
        const menu = page.locator('#ecoNavigationMenu, #sensorMenu, #profileModeMenu').first();
        await menu.click(); assert.equal(await menu.getAttribute('aria-expanded'), 'true');
        assert(await page.locator('main').evaluate(el => el.inert), 'Background main is inert');
        assert.equal(await page.locator('#sidebar').getAttribute('aria-modal'), 'true');
        const focusable = await page.locator('#sidebar').evaluate(el => [...el.querySelectorAll('a[href],button,input,select,[tabindex]')].filter(item => !item.disabled && item.tabIndex >= 0 && item.getClientRects().length && getComputedStyle(item).visibility !== 'hidden').length);
        for (let i = 0; i <= focusable + 1; i++) { await page.keyboard.press('Tab'); assert(await page.locator('#sidebar').evaluate(el => el.contains(document.activeElement)), 'Tab remains inside drawer'); }
        await page.keyboard.press('Escape'); assert.equal(await menu.getAttribute('aria-expanded'), 'false');
        assert(await menu.evaluate(el => el === document.activeElement), 'Focus returns to opener');
        assert.equal(await page.locator('main').evaluate(el => el.inert), false);
      });
    }
  } finally { await context.close(); }
  const delayed = await fixtureContext(); delayed.state.delayMs = 1600;
  const slowPage = await delayed.context.newPage();
  try {
    await check('delayed data stays busy until data resolves', async () => {
      await slowPage.goto(site + '/public/analytics.html', { waitUntil: 'domcontentloaded' }); await shellReady(slowPage);
      await slowPage.waitForFunction(() => document.getElementById('sensorApp')?.getAttribute('aria-busy') === 'true');
      await slowPage.waitForTimeout(450);
      assert(delayed.state.pending > 0, 'Fixture request remains pending');
      assert.equal(await slowPage.locator('#sensorApp').getAttribute('aria-busy'), 'true');
      assert.doesNotMatch(await slowPage.locator('#sensorConnection').innerText(), /Local backend connected/);
      assert(await slowPage.locator('#sensorLoading').isVisible(), 'Local data skeleton remains visible');
      await sensorReady(slowPage);
    });
  } finally { await delayed.context.close(); }
  const failed = await fixtureContext(); failed.state.fail = true;
  const errorPage = await failed.context.newPage();
  try {
    await check('failed data has a recoverable error and refresh succeeds', async () => {
      await errorPage.goto(site + '/public/analytics.html'); await shellReady(errorPage);
      await errorPage.locator('#sensorError').waitFor({ state: 'visible' });
      assert.match(await errorPage.locator('#sensorError').innerText(), /unavailable|could not|failed/i);
      failed.state.fail = false; await errorPage.locator('#sensorRefresh').click(); await sensorReady(errorPage);
      assert.equal(await errorPage.locator('#sensorRefresh').isDisabled(), false);
    });
  } finally { await failed.context.close(); }
  const blocked = await fixtureContext({ blockedStorage: true });
  const blockedPage = await blocked.context.newPage();
  try {
    await check('blocked storage writes retain usable navigation', async () => {
      await blockedPage.goto(site + '/public/profile.html'); await shellReady(blockedPage);
      await navigate(blockedPage, 'analytics.html'); await sensorReady(blockedPage);
      await navigate(blockedPage, 'profile.html');
      assert.equal(errors.filter(error => error.blockedStorage).length, 0, 'No uncaught storage errors');
    });
  } finally { await blocked.context.close(); }
  await check('dashboard initial markup has no hard-coded 4/4/3 device counts', async () => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    try {
      await context.route('**/*', route => route.request().url().startsWith(site + '/') ? route.continue() : route.abort());
      const page = await context.newPage(); await page.goto(site + '/public/dashboard.html');
      const values = await page.locator('#kpiTotalUnits,#kpiOnlineUnits,#kpiActivePower').allTextContents();
      assert.notDeepEqual(values.map(value => value.trim()), ['4', '4', '3']);
      assert(values.every(value => !/[1-9]/.test(value)), 'Initial KPIs remain unknown before data');
    } finally { await context.close(); }
  });
  await check('all destinations use bundled startup scripts', async () => assert.deepEqual(cdnScripts, []));
  await check('no missing local resources', async () => assert.deepEqual(missing, []));
  await check('no attempted data mutations', async () => assert.deepEqual(mutations, []));
  await check('no uncaught renderer exceptions', async () => assert.deepEqual(errors, []));
}
const started = performance.now();
main().catch(error => { checks.push({ name: 'harness completion', status: 'FAIL', error: error.stack }); console.error(error.stack); }).finally(async () => {
  await browser?.close();
  if (server) { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); }
  fs.mkdirSync(out, { recursive: true });
  const failed = checks.filter(check => check.status === 'FAIL');
  const report = { status: failed.length ? 'FAIL' : 'PASS', durationMs: Math.round(performance.now() - started), passed: checks.length - failed.length, failed: failed.length, checks, transitions, errors, missing, mutations, cdnScripts, stopped: true };
  fs.writeFileSync(path.join(out, process.env.ECOTRACK_TRANSITION_REPORT_NAME || 'browser-results.json'), JSON.stringify(report, null, 2));
  console.log(report.status + ': ' + report.passed + ' passed; ' + report.failed + ' failed; ' + report.durationMs + 'ms; browser and server closed.');
  if (failed.length) process.exitCode = 1;
});
