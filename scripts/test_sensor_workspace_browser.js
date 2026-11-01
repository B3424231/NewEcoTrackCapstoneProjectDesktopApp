'use strict';
// Browser + real temporary Flask/SQLite. No live cloud or hardware is contacted.
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const http = require('node:http'), net = require('node:net'), { spawn } = require('node:child_process');
const { chromium } = require(process.env.ECOTRACK_PLAYWRIGHT || 'playwright');
const { requestMonitoring } = require('../src/monitoring-local'), { createSensorAsset } = require('../src/sensor-assets');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ecotrack-workspace-'));
const out=process.env.ECOTRACK_AUDIT_ARTIFACTS || path.resolve(process.env.ECOTRACK_WORKSPACE_REPORT_DIR || path.join(root, 'reports/workspace-modes'));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let backend, server, browser;
const fixtureNow = Date.parse('2026-10-19T07:00:00Z');
async function port() { const s = net.createServer(); await new Promise(resolve => s.listen(0, '127.0.0.1', resolve)); const p = s.address().port; await new Promise(resolve => s.close(resolve)); return p; }
async function until(fn, label) { for (let i = 0; i < 300; i++) { try { if (await fn()) return; } catch (_) {} await wait(100); } throw new Error('Timed out: ' + label); }
async function main() {
  fs.mkdirSync(out, { recursive: true });
  const api = 'http://127.0.0.1:' + await port();
  backend = spawn(path.join(root, 'venv/Scripts/python.exe'), ['-c', 'from backend.app import app;from backend import monitoring;import sys;monitoring.datetime=type("FixtureDateTime",(monitoring.datetime,),{"now":classmethod(lambda cls,tz=None:cls.fromtimestamp(float(sys.argv[2])/1000,tz or monitoring.timezone.utc))});app.run(host="127.0.0.1",port=int(sys.argv[1]),use_reloader=False)', new URL(api).port, String(fixtureNow)], { cwd: root, windowsHide: true, stdio: 'ignore', env: { ...process.env, ECOTRACK_SQLITE_DB_PATH: path.join(temp, 'telemetry.db'), ECOTRACK_TELEMETRY_SYNC: '0', ECOTRACK_MONITOR_SYNC: '0' } });
  await until(async () => (await fetch(api + '/api/monitoring/devices')).ok, 'temporary backend');
  const adminToken = fs.readFileSync(path.join(temp, '.ecotrack-monitoring-admin.key'), 'utf8').trim();
  server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname), dir = pathname.startsWith('/assets/') ? root : path.join(root, 'public');
    const file = path.resolve(dir, '.' + pathname);
    if (!file.startsWith(dir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.png': 'image/png', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const site = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ executablePath: process.env.ECOTRACK_QA_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const results = [], errors = [], assets = [], requests = [], fixtureControllers = []; let registered;
  const fixtureClient = { from(table) { assert.equal(table, 'aircons'); return { insert(payload) { assert.equal(payload.protocol, null); assert.equal(payload.controller_node_id, null); assets.push({ ...payload, id: 'fixture-ac-' + assets.length }); return { select() { return { single: async () => ({ data: assets.at(-1) }) }; } }; } }; } };
  async function context(width = 1460, theme = 'dark', options = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: 1000 }, timezoneId: 'Asia/Singapore', acceptDownloads: true });
    await require('./helpers/browser-local-api').installLocalApiBridge(ctx,{backendUrl:api,adminToken,routeFixtures:true});
    await ctx.route('**/*', route => {
      const url = route.request().url(); requests.push(url);
      if (url.startsWith(site + '/') || url.startsWith(api + '/')) return route.continue();
      if (url.startsWith('https://cdn.tailwindcss.com')) return route.fulfill({ path: path.join(root, 'public/vendor/tailwindcss.js'), contentType: 'text/javascript' });
      if (url.startsWith('https://cdn.jsdelivr.net/npm/chart.js')) return route.fulfill({ path: path.join(root, 'public/vendor/chart.umd.js'), contentType: 'text/javascript' });
      if (options.blackhole) return new Promise(() => {});
      return route.abort();
    });
    await ctx.routeWebSocket(/.*/, socket => socket.close());
    await ctx.exposeBinding('fixtureIPC', async (_source, channel, input) => {
      if (channel === 'local-api-read') return {success:true,...await require('../src/telemetry-local').requestLocalRead(input,{backendUrl:api,adminToken})};
      // This fixture owns its local registry; it never requests a live cloud import.
      if (channel === 'monitoring-sync-registry') return {success:true,data:{changed:false}};
      if (channel === 'monitoring-fetch-assets') return { success: true, data: assets };
      if (channel === 'scheduler-fetch-data') return { success: true, nodes: fixtureControllers, aircons: assets, rooms: [{ id: 'fixture-room', name: 'Room A', floor_id: 'fixture-floor' }], floors: [{ id: 'fixture-floor', name: 'Floor 1', building_id: 'fixture-building' }], buildings: [{ id: 'fixture-building', name: 'Fixture Building' }] };
      if (channel === 'sensor-create-asset') return createSensorAsset(fixtureClient, input);
      if (channel !== 'monitoring-admin-request') return { success: false, error: 'Isolated fixture' };
      try { const result = await requestMonitoring(input, { backendUrl: api, adminToken, lookupAircon: async id => assets.find(asset => asset.id === id) }); if (input.action === 'create') registered = result.data; return result; }
      catch (failure) { return { success: false, error: failure.message }; }
    });
    await ctx.addInitScript(({ api, theme, width, options, fixtureNow }) => {
      const NativeDate=Date; window.Date=class extends NativeDate { constructor(...args){super(...(args.length?args:[fixtureNow]));} static now(){return fixtureNow;} };
      Object.defineProperty(navigator, 'onLine', { get: () => false });
      localStorage.setItem('ecoTrackTheme', theme); localStorage.setItem('sidebarCollapsed', String(width < 760));
      localStorage.setItem('ecoTrack_backend_url', api); localStorage.setItem('ecoTrack_supabase_url', 'https://offline-fixture.invalid'); localStorage.setItem('ecoTrack_supabase_anon_key', 'sb_publishable_isolated_fixture');
      if (options.failStorage) { const set = Storage.prototype.setItem; Storage.prototype.setItem = function (key, value) { if (key === 'ecoTrack_workspace_mode') throw new Error('Fixture storage failure'); return set.call(this, key, value); }; }
      window.electron = { env: { BACKEND_URL: api }, invoke: (channel, input) => window.fixtureIPC(channel, input), on() {} };
    }, { api, theme, width, options, fixtureNow });
    return ctx;
  }
  const ctx = await context(), page = await ctx.newPage();
  page.on('pageerror', failure => { if (/profile|analytics|telemetry|sensor-/.test(page.url())) errors.push(failure.message); });
  await page.goto(site + '/profile.html#device-mode'); await page.locator('#sidebar').waitFor();
  assert.equal(await page.locator('#panelDeviceMode,#tabBtnDeviceMode').count(),0); assert(await page.locator('#panelProfile').isVisible()); assert.equal(await page.locator('a[href="settings.html"]').count(),0);
  assert.equal(await page.getByRole('link', { name: 'Open workspace' }).count(), 0);
  assert.equal(await page.locator('#panelDeviceMode .device-mode-footer').count(), 0);
  await page.locator('#tabBtnProfile').click(); assert(await page.locator('#panelProfile').isVisible());
  await page.locator('#tabBtnProfile').focus(); await page.keyboard.press('End'); assert.equal(await page.locator('#tabBtnHistory').getAttribute('aria-selected'),'true'); await page.locator('#tabBtnProfile').click();
  assert.equal(await page.evaluate(() => EcoTrackMode.mode), 'both');
  assert.equal(await page.locator('#sidebarModeSwitch').count(),0);
  for(const route of ['control.html','telemetry.html','sensor-logs.html','nodes.html','rules.html','profile.html'])assert(await page.locator('a.nav-link[href="'+route+'"]').isVisible());
  await page.reload();assert.equal(await page.evaluate(()=>EcoTrackMode.mode),'both');
  results.push('Combined workspace persists across reload and exposes control, monitoring, registration and rules navigation');
  if (process.env.ECOTRACK_QA_PROFILE_ONLY === '1') {
    for (const width of [1460, 900, 390]) for (const theme of ['dark', 'light']) {
      const visual = await context(width, theme), p = await visual.newPage(); p.on('pageerror', failure => errors.push(failure.message));
      await p.goto(site + '/profile.html#device-mode'); await p.waitForFunction(() => Number(getComputedStyle(document.querySelector('main')).opacity) > .99);
      assert(await p.locator('#panelProfile').isVisible()); assert.equal(await p.locator('#tabBtnProfile').getAttribute('aria-selected'),'true');
      assert.equal(await p.locator('#panelDeviceMode,#tabBtnDeviceMode,[data-select-mode]').count(),0); assert.equal(await p.locator('a[href="settings.html"]').count(),0);
      const bounds = await p.locator('#tabBtnProfile').boundingBox(); assert(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
      for (const [tab,panel] of [['tabBtnProfile','panelProfile'],['tabBtnSecurity','panelSecurity'],['tabBtnHistory','panelHistory']]) {
        const button=p.locator('#'+tab);await button.click();assert.equal(await button.getAttribute('aria-selected'),'true');assert(await p.locator('#'+panel).isVisible());
        assert.equal(await p.locator('.profile-nav-tab[aria-selected="true"]').count(),1);
        const before=await button.boundingBox();await button.hover();
        assert.equal(await button.evaluate(element=>getComputedStyle(element).boxShadow),'none');
        const after=await button.boundingBox();assert.deepEqual(after,before,'Hover must not shift a tab');
      }
      await p.locator('#tabBtnProfile').focus();await p.keyboard.press('ArrowRight');assert.equal(await p.locator('#tabBtnSecurity').getAttribute('aria-selected'),'true');
      await p.keyboard.press('End');assert.equal(await p.locator('#tabBtnHistory').getAttribute('aria-selected'),'true');
      assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      const columns=await p.locator('.profile-tabs').evaluate(element=>getComputedStyle(element).gridTemplateColumns.split(' ').length);assert.equal(columns,width<=600?1:3);
      await p.locator('#tabBtnSecurity').hover();assert.equal(await p.locator('#tabBtnSecurity').evaluate(element=>getComputedStyle(element).boxShadow),'none');
      await p.locator('.profile-tabs').screenshot({path:path.join(out,`profile-tabs-${width}-${theme}.png`)});
      await p.screenshot({ path: path.join(out, `profile-device-mode-${width}-${theme}.png`) }); await visual.close();
    }
    assert.deepEqual(errors, []); assert.equal(fs.existsSync(path.join(root, 'public/settings.html')), false);
    results.push('Profile tabs: three panels, selected states, no hover shadow or movement, arrow/End keys, three desktop/one mobile columns, dark/light layouts without overflow');
    fs.writeFileSync(path.join(out, 'profile-verification.json'), JSON.stringify({ status: 'PASS', scenarios: results, runtime_errors: errors }, null, 2));
    results.forEach(result => console.log('PASS ' + result)); await ctx.close(); return;
  }
  await page.goto(site + '/control.html');assert(new URL(page.url()).pathname.endsWith('/control.html'));
  await page.goto(site + '/telemetry.html'); await page.waitForFunction(() => document.getElementById('sensorConnection')?.textContent.startsWith('Local backend connected'));
  assert.equal(await page.locator('#registerSensor').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Register AC Sensor', exact: true }).count(), 0);
  assert.equal(await page.locator('#sensorSync, #sensorAvailable, #sensorSelect').count(), 0);
  assert.equal(await page.locator('.sensor-telemetry-layout > .sensor-panel').count(), 2);
  await page.locator('#sensorLocations').getByText('Room A', { exact: true }).waitFor();
  assert.equal(await page.locator('.sensor-cabinet h2').innerText(), 'Location');
  assert(await page.locator('.sensor-location-level-0').isVisible());
  assert(await page.locator('.sensor-location-level-1').isVisible());
  const spacing = await page.evaluate(() => { const content = document.querySelector('.sensor-content'), panels = document.querySelector('.sensor-telemetry-layout'); return content.getBoundingClientRect().bottom - panels.getBoundingClientRect().bottom; }); assert(spacing < 45, 'Telemetry panels must fill the available desktop height');
  // Registry/ingestion setup uses the authenticated local IPC adapter in this disposable DB.
  const asset = await createSensorAsset(fixtureClient, { asset_tag: 'FIXTURE-AC', name: 'Fixture AC', brand: 'Fixture Brand', model: 'Fixture Model', aircon_type: 'Window Type' });
  registered = (await requestMonitoring({ action: 'create', data: { name: 'Fixture Sensor', aircon_id: asset.data.id, location: 'Fixture Building · Floor 1 · Room A', state_source: 'power_meter', expected_interval_seconds: 60 } }, { backendUrl: api, adminToken, lookupAircon: async id => assets.find(asset => asset.id === id) })).data;
  assert(registered.id);
  assert.equal(await page.evaluate(token => Object.values(localStorage).some(value => value.includes(token)), registered.device_token), false);
  results.push('Desktop-reference Telemetry cabinet and sensor interface, no available panel, dropdown or duplicate registration button, real authenticated sensor registry and no credential caching');
  await page.goto(site + '/sensor-logs.html'); await page.waitForFunction(() => document.getElementById('sensorConnection')?.textContent.startsWith('Local backend connected'));
  assert.equal(await page.locator('#sensorLogTable th').count(), 12, 'Sensor column headers must remain visible with no readings');
  assert(await page.locator('#sensorLogTable .sensor-log-empty-icon').isVisible()); assert.equal(await page.locator('#sensorLogTable .sensor-log-empty button').count(),0);
  assert.equal(await page.locator('[data-export="csv"]').count(), 0);
  assert(await page.locator('#headerExportPdfBtn').isEnabled()); assert(await page.locator('#headerExportExcelBtn').isEnabled());
  // Real export lifecycle: stall summary loading, inspect visible progress, then cancel.
  for(const theme of ['dark','light'])for(const width of [1460,390]){
    await page.setViewportSize({width,height:1000});await page.evaluate(theme=>document.documentElement.classList.toggle('dark',theme==='dark'),theme);
    for(const id of ['energyTrendChart','estimatedCostChart','dualAxisChart']){
      assert.equal(await page.locator('#'+id).evaluate(canvas=>getComputedStyle(canvas).visibility),'hidden');
    }
    const layout=await page.locator('#energyTrendEmpty').evaluate(element=>{const box=element.getBoundingClientRect(),text=element.querySelector('span').getBoundingClientRect();return {direction:getComputedStyle(element).flexDirection,inside:text.left>=box.left && text.right<=box.right && text.top>=box.top && text.bottom<=box.bottom};});
    assert.equal(layout.direction,'column');assert(layout.inside);await page.locator('#energyTrendEmpty').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,`sensor-chart-empty-${width}-${theme}.png`)});
    for(const format of ['pdf','xlsx']){
      let release,intercepted=false;const gate=new Promise(resolve=>release=resolve);
      const hold=async route=>{intercepted=true;await gate;await route.continue().catch(()=>{});};
      await page.route(api+'/api/monitoring/analytics?**',hold);
      let downloaded=false;const onDownload=()=>downloaded=true;page.on('download',onDownload);
      await page.locator(`[data-export="${format}"]`).click();await page.locator('#downloadModal[open]').waitFor();
      await page.waitForFunction(()=>document.getElementById('downloadProgressPercent')?.textContent==='50%');await until(()=>intercepted,'held summary request');
      await page.waitForFunction(()=>{const fill=document.getElementById('downloadProgressBar');return fill && Math.abs(fill.getBoundingClientRect().width/fill.parentElement.getBoundingClientRect().width-.5)<.04;});
      assert.equal(await page.locator('#downloadModalTitle').innerText(),format==='pdf'?'Generating PDF':'Generating Excel');
      const bar=await page.locator('#downloadProgressBar').evaluate(fill=>{const box=fill.getBoundingClientRect(),track=fill.parentElement.getBoundingClientRect();return {ratio:box.width/track.width,height:box.height,background:getComputedStyle(fill).backgroundImage,aria:fill.parentElement.getAttribute('aria-valuenow')};});
      assert.equal(bar.aria,'50');assert(bar.ratio>.45 && bar.ratio<.55);assert(bar.height>=10);assert(bar.background.includes('linear-gradient'));
      assert(await page.locator('#headerExportPdfBtn').isDisabled());
      if(format==='pdf')await page.screenshot({path:path.join(out,`sensor-download-modal-${width}-${theme}.png`)});
      if(format==='pdf')await page.locator('#cancelDownloadBtn').click();else await page.keyboard.press('Escape');
      await page.waitForFunction(()=>!document.getElementById('downloadModal') && !document.getElementById('headerExportPdfBtn').disabled);
      release();await page.unroute(api+'/api/monitoring/analytics?**',hold);assert.equal(downloaded,false);assert.equal(await page.locator('#sensorExportStatus').innerText(),'Export cancelled.');
      assert.equal(await page.locator(`[data-export="${format}"]`).evaluate(button=>button===document.activeElement),true);page.off('download',onDownload);
    }
  }
  await page.setViewportSize({width:1460,height:1000});await page.evaluate(()=>document.documentElement.classList.add('dark'));
  results.push('Centered empty charts without axes; matching export dialog, visible stage progress and Cancel/Escape without download in dark/light at desktop/mobile widths');
  for (const format of ['pdf', 'xlsx']) { const pending = page.waitForEvent('download'); await page.locator(`[data-export="${format}"]`).click(); const file = await pending; assert.equal(file.suggestedFilename(),`EcoTrack_AC_Energy_Report_2026-10-19.${format}`); await file.saveAs(path.join(out, 'empty-sensor-logs.' + format)); await page.waitForFunction(() => !document.getElementById('headerExportPdfBtn').disabled); }
  await page.locator('#sensorLogTable').scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(out, 'sensor-empty-table-dark.png') });
  await page.locator('#openTopConsumersModalBtn').click(); await page.locator('#sensorDialog[open]').waitFor();
  assert.equal(await page.locator('#sensorDialog [data-category]').count(), 5);
  await page.locator('#sensorConsumerState[data-phase="empty"]').waitFor();
  assert(await page.locator('#sensorConsumerContent').isHidden());
  assert((await page.locator('#sensorConsumerState').innerText()).includes('Energy rankings are not ready'));
  assert(await page.locator('#sensorConsumerState [data-consumer-retry]').isEnabled());
  await page.locator('#sensorConsumerState [data-consumer-retry]').click();await page.locator('#sensorConsumerState[data-phase="empty"]').waitFor();
  assert.equal(await page.locator('#sensorDialog').getAttribute('aria-busy'),'false');
  await page.screenshot({ path: path.join(out, 'sensor-top-consumers-dark.png') }); await page.keyboard.press('Escape'); assert(await page.locator('#openTopConsumersModalBtn').evaluate(element => element === document.activeElement));
  results.push('Empty sensor logs retain 12 columns; CSV removed; highlighted PDF/Excel export empty reports; Top Consumers explains unavailable coverage and retries without invented rankings');
  await page.goto(site + '/telemetry.html'); await page.waitForFunction(() => document.getElementById('sensorConnection')?.textContent.startsWith('Local backend connected'));
  const now = fixtureNow, cadence = 60, samples = Array.from({ length: 58 }, (_, i) => ({ boot_id: 'fixture-boot', sequence: i, observed_at: new Date(now - (57 - i) * cadence * 1000).toISOString(), clock_quality: 'synchronized', interval_seconds: cadence, outlet_temperature_c: i === 0 ? null : 18 + i / 100, rotation_rpm: i === 1 ? 0 : 30 + i, ac_on: i < 24 ? true : i < 40 ? false : null, ...(i < 40 ? { state_source: 'power_meter' } : {}), battery_voltage: 3.8, rssi_dbm: -61, connection_status: 'online', operating_mode: i < 24 ? 'cool' : i < 40 ? 'fan_only' : i < 45 ? 'heat' : i < 50 ? 'off' : null }));
  const upload = await fetch(api + '/api/monitoring/telemetry', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + registered.device_token }, body: JSON.stringify({ device_id: registered.id, samples }) }); assert.equal(upload.status, 200);
  await page.locator('#sensorRefresh').click(); await page.waitForFunction(()=>!document.getElementById('sensorRefresh').disabled);assert.match(await page.locator('.temperature').innerText(),/Unavailable/); await page.screenshot({ path: path.join(out, 'telemetry-dark.png') });
  await page.locator('[data-sensor-detail]').first().click(); await page.getByRole('dialog').waitFor(); assert((await page.locator('.sensor-detail-list').innerText()).includes('Fixture AC')); await page.keyboard.press('Escape');
  // Empty charts use a temperature scale; measured modes never come from AC power.
  await page.goto(site + '/analytics.html'); await page.waitForFunction(() => document.getElementById('sensorConnection')?.textContent.startsWith('Local backend connected'));
  const measuredCharts = await page.evaluate(() => { const temp = Chart.getChart('sensorTempChart'), mode = Chart.getChart('sensorStateChart'); return { min: temp.scales.y.min, max: temp.scales.y.max, modeLabels: mode.data.datasets.map(item => item.label), modeCounts: mode.data.datasets.map(item => item.data.filter(value => value !== null).length) }; });
  assert(measuredCharts.min <= 18 && measuredCharts.max >= 18.57); assert.deepEqual(measuredCharts.modeLabels, ['Cold','Dry','Auto','Fan Only','Off (reported mode)','Confirmed ON','Confirmed OFF']); assert([0,3,4,5,6].every(index=>measuredCharts.modeCounts[index]>0));
  const persistedModes=await (await fetch(api+'/api/monitoring/telemetry?from=2026-10-18T16:00:00Z&to=2026-10-19T16:00:00Z&per_page=100')).json();
  assert.equal(persistedModes.items.filter(row=>row.operating_mode==='heat').length,5,'Removing Heat from the chart never rewrites recorded operating modes');
  await page.locator('#sensorFrom').fill('2026-01-01'); await page.locator('#sensorThrough').fill('2026-01-01'); await page.waitForFunction(() => !document.getElementById('sensorRefresh').disabled && !document.getElementById('sensorTempChartEmpty').hidden);
  assert.deepEqual(await page.evaluate(() => { const chart = Chart.getChart('sensorTempChart'); return [chart.scales.y.min, chart.scales.y.max]; }), [0, 40]);
  assert(await page.locator('#sensorStateChartEmpty').isVisible());
  results.push('Temperature chart empty scale 0–40 °C; Cold/Fan Only/Off use reported modes, Heat remains persisted and unplotted, confirmed ON/OFF require power feedback, unknown data stays empty');
  await page.goto(site + '/sensor-scheduler.html'); await page.waitForURL(site + '/scheduler.html'); await page.waitForFunction(() => document.getElementById('sensorConnection')?.textContent.startsWith('Local backend connected'));
  assert.equal(await page.locator('a.nav-link[href="scheduler.html"]').count(), 1); assert.equal(await page.locator('a.nav-link[href="sensor-scheduler.html"]').count(), 0);
  assert.equal(await page.locator('#schedulerTableBody tr').count(), 1); assert((await page.locator('#schedulerTableBody tr').innerText()).includes('Fixture AC'));
  assert.equal(await page.getByRole('columnheader', { name: 'Target Temp', exact: true }).count(), 0);
  assert.deepEqual(await page.locator('select[id^="interval-unit-"] option').allTextContents(), ['Seconds', 'Minutes', 'Hours']);
  for (const [field, hour, half] of [['wake','10','PM'], ['sleep','06','AM']]) {
    await page.locator(`[data-time-target^="${field}-"]`).click(); await page.locator('#timePickerHour').selectOption(hour); await page.locator('#timePickerMinute').selectOption('00'); await page.locator('#timePickerPeriod').selectOption(half); await page.locator('#timePickerSaveBtn').click();
  }
  await page.locator('input[id^="interval-val-"]').fill('2'); await page.locator('.apply-schedule-btn').click(); await page.getByText('Sensor saved locally · hardware unconfirmed.', { exact: true }).waitFor();
  await page.reload(); await page.waitForFunction(() => document.querySelector('input[id^="wake-"]')?.value === '22:00'); assert.equal(await page.locator('input[id^="interval-val-"]').inputValue(), '2');
  const configured = await (await fetch(api + '/api/monitoring/devices')).json(); assert.equal(configured.items[0].sensor_schedule.interval_seconds, 120);
  await page.screenshot({ path: path.join(out, 'scheduler-dark.png') }); results.push('Single shared AC Device Scheduler, registered aircon name, monitoring fields, Minutes/Hours units and persisted overnight schedule');
  await page.goto(site+'/telemetry.html');await page.waitForFunction(()=>!document.getElementById('sensorRefresh').disabled);assert.equal(await page.locator('#sensorCount').innerText(),'1 device');await page.locator('[data-sensor-detail]').click();assert.match(await page.locator('#sensorDialog').innerText(),/22:00/);await page.keyboard.press('Escape');
  await page.goto(site + '/sensor-logs.html'); await page.waitForFunction(() => document.getElementById('sensorPageInfo')?.textContent.includes('of 58'));
  assert.equal(await page.locator('.sensor-forecast-title h1').innerText(), 'AC Energy Forecast');
  assert.equal(await page.locator('a.nav-link[href="sensor-logs.html"]').innerText(), 'AC Energy Forecast');
  assert.equal((await page.locator('a.nav-link[href="nodes.html"]').innerText()).trim(), 'Register AC Devices');
  assert.equal(await page.locator('header [data-period]').count(), 3);
  assert.equal(await page.locator('header #sensorSelect, header #sensorFrom, header #sensorTariff, header [data-export]').count(), 5);
  assert.equal(await page.locator('#sensorApp .sensor-periods, #sensorApp .sensor-filters').count(), 0);
  assert.equal(await page.locator('#kpiEnergyVal').innerText(), '—'); assert.equal(await page.locator('#sensorModelNotice').count(),0); assert.equal(await page.locator('#kpiEnergyTrend').innerText(),'Experimental'); assert.equal(await page.locator('.analytics-glass-card').count(), 7);
  assert.equal(await page.locator('#sensorLogTable th').count(), 12); assert(await page.getByText('Window Type', { exact: true }).first().isVisible());
  await page.locator('#sensorNext').click(); await page.waitForFunction(() => document.getElementById('sensorPageInfo')?.textContent === '51–58 of 58');
  assert(await page.getByText('Confirmed ON', { exact: true }).first().isVisible());
  for (const format of ['pdf', 'xlsx']) { const pending = page.waitForEvent('download'); await page.locator(`[data-export="${format}"]`).click(); const file = await pending; assert.equal(file.suggestedFilename(),`EcoTrack_AC_Energy_Report_2026-10-19.${format}`); const destination = path.join(out, 'fixture-sensor-logs.' + format); await file.saveAs(destination); assert(fs.statSync(destination).size > 300); await page.waitForFunction(() => !document.getElementById('headerExportPdfBtn').disabled); }
  await page.locator('#sensorTariff').click(); await page.locator('#tariffRateInput').fill('13.24'); await page.locator('#saveTariffBtn').click(); assert((await page.locator('#kpiCostRate').innerText()).includes('13.24')); assert((await page.locator('#headerTariffDisplay').innerText()).includes('13.24'));
  await page.locator('#openTopConsumersModalBtn').click();await page.locator('#sensorDialog[open]').waitFor();await page.locator('#sensorConsumerState[data-phase="empty"]').waitFor();assert(await page.locator('#sensorConsumerContent').isHidden());
  assert.equal(await page.locator('#sensorDialog [data-category]').count(),5);assert(await page.locator('[data-consumer-retry]').isVisible());
  await page.keyboard.press('Escape');assert(await page.locator('#energyTrendEmpty').isVisible());assert(await page.locator('#estimatedCostEmpty').isVisible());
  await page.screenshot({ path: path.join(out, 'sensor-log-dark.png'), fullPage: true }); results.push('Controller forecast card/chart template, 12 sensor columns, pagination, full filtered PDF/Excel exports and shared tariff');
  if(process.env.ECOTRACK_QA_ESTIMATES_ONLY==='1'){
    for(const theme of ['dark','light'])for(const width of [1460,390]){
      await page.setViewportSize({width,height:1000});await page.evaluate(theme=>{document.documentElement.classList.toggle('dark',theme==='dark');localStorage.setItem('ecoTrackTheme',theme);},theme);
      await page.locator('#sensorRefresh').click();await page.waitForFunction(()=>!document.getElementById('sensorRefresh').disabled);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await page.screenshot({path:path.join(out,`nrel-estimate-${width}-${theme}.png`)});
      await page.locator('#openTopConsumersModalBtn').click();await page.locator('#sensorDialog[open]').waitFor();await page.screenshot({path:path.join(out,`nrel-consumers-${width}-${theme}.png`)});await page.keyboard.press('Escape');
    }
    fs.writeFileSync(path.join(out,'nrel-estimate-browser-verification.json'),JSON.stringify({status:'PASS',checks:['Experimental estimate cards, power-feedback runtime, energy/cost charts and ranked consumers','Real filtered PDF/Excel downloads; raw readings Excel only','Dark/light at 1460/390px; no document overflow'],runtime_errors:errors},null,2));
    assert.deepEqual(errors,[]);console.log('PASS focused experimental estimator UI, consumers, exports, themes and responsive layouts');await ctx.close();return;
  }
  await page.route(api + '/api/monitoring/telemetry?**', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Fixture local sensor storage unavailable' }) }));
  let unexpectedDownload = false; const onDownload = () => { unexpectedDownload = true; }; page.on('download', onDownload);
  await page.locator('[data-export="pdf"]').click(); await page.waitForFunction(() => document.getElementById('sensorExportStatus')?.textContent === 'Fixture local sensor storage unavailable');
  assert.equal(unexpectedDownload, false); assert(await page.locator('#headerExportPdfBtn').isEnabled()); page.off('download', onDownload); await page.unroute(api + '/api/monitoring/telemetry?**');
  const energy=await(await fetch(api+'/api/monitoring/energy')).json();assert.equal(energy.available,false);assert.equal(energy.energy_kwh,null);assert.equal(energy.code,'CONTROL_HISTORY_UNAVAILABLE');const model=await(await fetch(api+'/api/monitoring/energy-model')).json();assert.equal(model.loaded,true);assert.equal(model.model,'extra_trees');results.push('Missing recorded reference inputs preserve unavailable energy; the trained model loads without inventing feedback');
  // Calendar boundaries are tested from real requests, not a duplicated date function.
  const queryDates = [];
  page.on('request', req => { const url = new URL(req.url()); if (url.pathname === '/api/monitoring/analytics') queryDates.push(url.searchParams); });
  await page.locator('#sensorSelect').selectOption(registered.id); await until(() => queryDates.some(q => q.get('node_id') === registered.id), 'header sensor filter');
  await page.locator('#sensorSelect').selectOption(''); await until(() => queryDates.at(-1) && !queryDates.at(-1).has('node_id'), 'header all sensors filter');
  await page.locator('#sensorFrom').fill('2026-10-19'); await page.locator('[data-period="weekly"]').click(); await until(() => queryDates.some(q => q.get('from') === '2026-10-18T16:00:00.000Z' && q.get('to') === '2026-10-25T16:00:00.000Z'), 'Monday week boundary');
  assert.equal(await page.locator('[data-period="weekly"]').getAttribute('aria-pressed'), 'true'); assert(await page.locator('[data-period="weekly"]').evaluate(element => element.classList.contains('active')));
  for(const format of ['pdf','xlsx']){await page.waitForFunction(()=>!document.getElementById('sensorRefresh').disabled);const pending=page.waitForEvent('download');await page.locator(`[data-export="${format}"]`).click();const file=await pending;assert.equal(file.suggestedFilename(),`EcoTrack_AC_Energy_Report_2026-10-19_to_2026-10-25.${format}`);await file.saveAs(path.join(out,'weekly-'+file.suggestedFilename()));await page.waitForFunction(()=>!document.getElementById('headerExportPdfBtn').disabled);}
  await page.locator('#sensorTimeStart').fill('10:00'); await page.locator('#sensorTimeEnd').fill('15:00'); await page.locator('#sensorTimeEnd').blur();
  await until(() => queryDates.some(q => q.get('start_time') === '10:00' && q.get('end_time') === '15:00'), 'time filters reach local API');
  await page.locator('#sensorClearTime').click(); await until(() => queryDates.at(-1) && !queryDates.at(-1).has('start_time') && !queryDates.at(-1).has('end_time'), 'clear time filters');
  assert.equal(await page.locator('#sensorTimeStart').inputValue(), ''); assert.equal(await page.locator('#sensorTimeEnd').inputValue(), '');
  const dateOption = await page.locator('#sensorDateSelect option').first().getAttribute('value');
  await page.locator('#sensorDateSelect').selectOption(dateOption); assert.equal(await page.locator('#sensorFrom').inputValue(), '');
  await page.locator('#sensorFrom').fill('2026-01-31'); await page.locator('[data-period="monthly"]').click(); await until(() => queryDates.some(q => q.get('from') === '2025-12-31T16:00:00.000Z' && q.get('to') === '2026-01-31T16:00:00.000Z'), 'month/year boundary'); results.push('Compact controller-format forecast filters, preset/custom dates, active periods, UTC+08 time range and clear action');
  for(const format of ['pdf','xlsx']){await page.waitForFunction(()=>!document.getElementById('sensorRefresh').disabled);const pending=page.waitForEvent('download');await page.locator(`[data-export="${format}"]`).click();const file=await pending;assert.equal(file.suggestedFilename(),`EcoTrack_AC_Energy_Report_2026-01-01_to_2026-01-31.${format}`);await file.saveAs(path.join(out,'monthly-'+file.suggestedFilename()));await page.waitForFunction(()=>!document.getElementById('headerExportPdfBtn').disabled);}
  results.push('PDF and Excel download names identify EcoTrack AC Energy Report and the selected local date/range, including empty daily reports and the January month/year boundary');
  const peer = await ctx.newPage(); await peer.goto(site + '/profile.html#device-mode'); await page.goto(site + '/profile.html#device-mode');
  for(const target of [page,peer])assert.equal(await target.evaluate(()=>EcoTrackMode.mode),'both');await peer.close();await page.goto(site+'/nodes.html');assert.equal(await page.getByRole('columnheader',{name:'IR Monitoring',exact:true}).count(),0);
  for(const mode of ['both']) {
    await page.evaluate(mode=>{localStorage.setItem('ecotrack_control_layout','remote');return EcoTrackMode.mode;},mode); await page.goto(site+'/control.html');
    await page.locator('#airconDropdownTrigger').waitFor();
    assert.equal(await page.locator('#viewStandardBtn,#viewRemoteBtn,#remoteLayoutContainer,#prevAirconBtn,#nextAirconBtn,#quickStatusPill').count(),0);
    assert.equal(await page.locator('#controlsContainer').count(),1); assert.equal(await page.locator('body.remote-layout-active').count(),0);
  }
  results.push('Controller/Both use desktop controls directly despite an old remote preference; remote view, layout switcher, arrows and quick status pill removed');

  const offline=await context(1460,'dark',{blackhole:true}),offlinePage=await offline.newPage();await offlinePage.goto(site+'/sensor-logs.html',{waitUntil:'domcontentloaded'});await offlinePage.waitForFunction(()=>document.getElementById('sensorConnection')?.textContent.startsWith('Local backend connected'));results.push('Local logs remain usable while cloud requests hang');await offline.close();
  for (const width of [1460, 390]) for (const theme of ['dark', 'light']) {
    const visual = await context(width, theme), p = await visual.newPage(); p.on('pageerror', failure => errors.push(failure.message));
    for (const file of ['profile.html#device-mode', 'analytics.html', 'telemetry.html', 'sensor-logs.html']) {
      await p.goto(site + '/' + file); if (file !== 'profile.html#device-mode') await p.waitForFunction(() => document.getElementById('sensorConnection')?.textContent.startsWith('Local backend connected'));
      await p.waitForFunction(() => Number(getComputedStyle(document.querySelector('main')).opacity) > .99);
      if (file === 'analytics.html') { assert.equal(await p.locator('.sensor-quicklinks, #sensorApp .sensor-filters').count(), 0); assert.equal(await p.locator('header #sensorSelect, header #sensorFrom, header #sensorThrough').count(), 3); }
      if (file !== 'profile.html#device-mode') {
        const id = file === 'sensor-scheduler.html' ? 'schedulerRefresh' : 'sensorRefresh';
        const refresh = p.locator('#' + id); assert.equal((await refresh.innerText()).trim(), ''); assert(await refresh.getAttribute('aria-label'));
        let fetches = 0; const onRequest = request => { if (request.url().includes('/api/monitoring/devices')) fetches++; }; p.on('request', onRequest);
        await refresh.click(); await p.waitForFunction(id => !document.getElementById(id).disabled, id); assert(fetches > 0, `${file} refresh must fetch local records`); p.off('request', onRequest);
      }
      if (await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)) { console.log(await p.evaluate(() => [...document.querySelectorAll('body,body>div,main,.device-scheduler-layout,.device-scheduler-layout>div')].map(element => ({tag:element.tagName,classes:element.className,width:element.clientWidth,scroll:element.scrollWidth,box:element.getBoundingClientRect().width})))); await p.screenshot({ path: path.join(out, 'scheduler-overflow.png') }); }
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${file} overflow at ${width}`);
      assert.equal(await p.evaluate(() => { const content = document.querySelector('.sensor-content'); return Boolean(content && content.scrollWidth > content.clientWidth + 1); }), false, `${file} content overflow at ${width}`);
      if (width === 390) { await p.locator('#sidebar').waitFor({ state: 'attached' }); const menu = p.locator(file === 'profile.html#device-mode' ? '#profileModeMenu' : '#sensorMenu'); await menu.click(); await p.locator('a[href="profile.html"].nav-link').waitFor({ state: 'visible' }); assert(await p.locator('a[href="profile.html"].nav-link').isVisible(), `${file} drawer ${theme}`); await p.keyboard.press('Escape'); assert.equal(await menu.getAttribute('aria-expanded'), 'false'); }
      if (file === 'profile.html#device-mode' || file === 'sensor-logs.html' || file === 'telemetry.html' || file === 'analytics.html') await p.screenshot({ path: path.join(out, `${file.replace('.html#device-mode', '-device-mode').replace('.html', '')}-${width}-${theme}.png`) });
      if (file === 'sensor-logs.html') {
        const sensorControl = p.locator('[data-select-id="sensorSelect"]'); await sensorControl.waitFor(); assert((await sensorControl.boundingBox()).width > 100);
        const fields = await p.locator('.sensor-forecast-field').evaluateAll(fields => fields.map(field => { const r=field.getBoundingClientRect(); return {x:r.x,y:r.y,right:r.right,bottom:r.bottom}; }));
        for (let i=1;i<fields.length;i++) assert(fields[i].y >= fields[i-1].bottom-1 || fields[i].x >= fields[i-1].right-1, 'Forecast filter groups must not overlap');
        if (width === 1460) { const title = await p.locator('.sensor-forecast-title').boundingBox(), action = await p.locator('#openTopConsumersModalBtn').boundingBox(); assert(Math.abs(title.y - action.y) < 8, 'Desktop forecast header actions should align with title and periods'); }
        for (const id of ['headerExportPdfBtn', 'headerExportExcelBtn', 'openTopConsumersModalBtn']) { assert(await p.locator('#' + id).isEnabled()); assert.equal(await p.locator('#' + id).evaluate(element => getComputedStyle(element).opacity), '1'); }
        await p.locator('#openTopConsumersModalBtn').click();await p.locator('#sensorConsumerState[data-phase="empty"]').waitFor();assert(await p.locator('[data-consumer-retry]').isVisible());
        assert.equal(await p.locator('#sensorDialog').evaluate(element => element.scrollWidth > element.clientWidth + 1), false, `Consumer dialog overflow at ${width}`);
        await p.screenshot({ path: path.join(out, `sensor-consumers-${width}-${theme}.png`) }); await p.keyboard.press('Escape');
      }
    }
    await visual.close();
  }
  results.push('Five screens at desktop/mobile in dark/light; no document overflow; keyboard navigation drawer');
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(out, 'browser-verification.json'), JSON.stringify({ status: 'PASS', scenarios: results, runtime_errors: errors, live_external_requests: 0 }, null, 2));
  results.forEach(result => console.log('PASS ' + result)); await ctx.close();
}
main().catch(failure => { console.error(failure.stack); process.exitCode = 1; }).finally(async () => { await browser?.close(); await new Promise(resolve => server ? server.close(resolve) : resolve()); backend?.kill(); });
