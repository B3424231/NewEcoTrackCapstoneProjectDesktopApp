'use strict';
// Browser + real temporary Flask/SQLite. No live cloud or hardware is contacted.
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const http = require('node:http'), net = require('node:net'), { spawn } = require('node:child_process');
const { chromium } = require(process.env.ECOTRACK_PLAYWRIGHT || 'playwright');
const { requestMonitoring } = require('../src/monitoring-local'), { createSensorAsset } = require('../src/sensor-assets');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ecotrack-workspace-'));
const out=process.env.ECOTRACK_AUDIT_ARTIFACTS || path.resolve(process.env.ECOTRACK_WORKSPACE_REPORT_DIR || path.join(root, 'reports/pipeline-resilience/ui'));
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

  for (const theme of ['dark','light']) {
    const ctx = await context(), page = await ctx.newPage();
    page.on('pageerror', error=>errors.push(error.message));
    await page.goto(site+'/staff.html');
    await page.waitForFunction(()=>window.EcoTrackMaintenance?.openCreateModal);
    await page.evaluate(()=>EcoTrackMaintenance.openCreateModal());
    const trigger=page.locator('#modalPriorityDropdownTrigger');
    await trigger.waitFor();
    const expected=theme==='dark'?['rgb(52, 211, 153)','rgb(56, 189, 248)','rgb(251, 191, 36)','rgb(251, 113, 133)']:['rgb(5, 150, 105)','rgb(2, 132, 199)','rgb(217, 119, 6)','rgb(225, 29, 72)'];
    await page.evaluate(theme=>{document.documentElement.classList.toggle('dark',theme==='dark');localStorage.setItem('ecoTrackTheme',theme);},theme);
    for (const [index,priority] of ['Low','Medium','High','Critical'].entries()) {
      await trigger.click();
      const row=page.locator('.custom-priority-item[data-priority-val="'+priority+'"]');
      assert.equal(await row.locator('.maintenance-priority-dot').evaluate(el=>getComputedStyle(el).backgroundColor),expected[index]);
      await row.click();
      assert.equal(await page.locator('#modalCreatePriority').inputValue(),priority);
      assert.equal(await trigger.locator('.maintenance-priority-dot').getAttribute('data-priority'),priority);
      assert.equal(await trigger.locator('.maintenance-priority-dot').evaluate(el=>getComputedStyle(el).backgroundColor),expected[index]);
      await trigger.click();
      assert.equal(await page.locator('#modalPriorityDropdownMenu .maintenance-priority-check:visible').count(),1);
      assert(await row.locator('.maintenance-priority-check').isVisible());
      assert.equal(await row.getAttribute('aria-selected'),'true');
      if(priority==='High') { await page.waitForTimeout(220); await page.screenshot({path:path.join(out,'priority-icons-'+theme+'.png')}); }
      await trigger.click();
    }
    results.push('Priority colors and selected check follow all four options in '+theme+' theme');
    await ctx.unrouteAll({behavior:'ignoreErrors'});await ctx.close();
  }
  const asset=await createSensorAsset(fixtureClient,{asset_tag:'RESILIENCE-FIXTURE',name:'Fixture AC',brand:'Fixture Brand',model:'Fixture Model',aircon_type:'Window Type'});
  registered=(await requestMonitoring({action:'create',data:{name:'Fixture Sensor',aircon_id:asset.data.id,location:'Fixture Building · Floor 1 · Room A',expected_interval_seconds:60}},{backendUrl:api,adminToken,lookupAircon:async id=>assets.find(asset=>asset.id===id)})).data;
  const observed=new Date(fixtureNow-3600000).toISOString();
  const result=await fetch(api+'/api/monitoring/telemetry',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+registered.device_token},body:JSON.stringify({device_id:registered.id,samples:[{boot_id:'resilience-fixture',sequence:1,observed_at:observed,clock_quality:'synchronized',interval_seconds:60,outlet_temperature_c:22,rotation_rpm:120,ac_on:null}]})});
  assert.equal(result.status,200);
  for(const theme of ['dark','light'])for(const width of [1460,390]){
    const ctx=await context(width,theme),page=await ctx.newPage(),observedRequests=[];
    page.on('request',request=>observedRequests.push(request.url()));
    page.on('pageerror',error=>errors.push(error.message));
    await ctx.route(new RegExp(api+'/api/monitoring/(devices|changes)(\\?|$)'),async route=>{
      const response=await route.fetch(),data=await response.json();
      for(const node of data.items||[])node.cloud_node_id='fixture-cloud-node';
      await route.fulfill({response,json:data});
    });
    await ctx.route('https://offline-fixture.invalid/rest/v1/ecotrack_device_state*',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{node_id:'fixture-cloud-node',last_seen:new Date(fixtureNow).toISOString(),sleeping_until:null,applied_config:{telemetry_pending:3,telemetry_queue_error:''}}])}));
    await page.goto(site+'/telemetry.html');
    await page.waitForFunction(()=>document.getElementById('sensorConnection')?.textContent.startsWith('Local backend connected'));
    const room=page.locator('[data-location-index]').first();
    if(await room.count()&&await room.isVisible())await room.click();
    const card=page.locator('.sensor-telemetry-card').first();await card.waitFor();
    await page.waitForFunction(()=>document.querySelector('.sensor-telemetry-card')?.textContent.includes('Connected'));
    assert((await card.innerText()).includes('Measurements: Stale'));
    assert((await card.innerText()).includes('Measured:'));
    assert.equal(await page.locator('#sensorHistoryHealth,.sensor-history-health').count(),0);
    if(width===1460&&theme==='dark'){
      const before=observedRequests.length;
      await wait(5700);
      const after=observedRequests.slice(before).filter(url=>url.startsWith(api));
      assert(after.some(url=>url.includes('/changes?')),'Polling must ask for changed nodes');
      assert(!after.some(url=>/\/(analytics|history|energy)\?/.test(url)),'Unchanged devices must not reload history or analytics');
      results.push('Unchanged polling reads the change cursor without reloading history/analytics');
    }
    assert(!observedRequests.some(url=>url.includes('/history-health')||url.includes('/api/telemetry/health')),'Pages must not poll backend history diagnostics');
    await page.screenshot({path:path.join(out,'measurement-background-'+width+'-'+theme+'.png')});
    results.push('Connected heartbeat and stale measurement remain visible without a history banner at '+width+'px '+theme);
    await ctx.unrouteAll({behavior:'ignoreErrors'});await ctx.close();
  }

  // Backend diagnostics can fail without adding a page banner or a status request.
  for(const theme of ['dark','light'])for(const width of [1460,390]){
    const ctx=await context(width,theme),page=await ctx.newPage(),pageRequests=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('request',request=>pageRequests.push(request.url()));
    await ctx.route('**/api/monitoring/history-health',route=>route.fulfill({status:503,json:{error:'Unavailable fixture'}}));
    for(const file of ['analytics.html','telemetry.html','sensor-logs.html']){
      await page.goto(site+'/'+file);
      await page.waitForFunction(()=>document.getElementById('sensorConnection')?.textContent.startsWith('Local backend connected'));
      assert(await page.locator('#sensorApp').isVisible());
      assert.equal(await page.locator('#sensorHistoryHealth,.sensor-history-health').count(),0);
      assert(!(await page.locator('body').innerText()).includes('History status unavailable'));
      assert(!pageRequests.some(url=>url.includes('/history-health')||url.includes('/api/telemetry/health')));
      await page.screenshot({path:path.join(out,file.replace('.html','')+'-background-only-'+width+'-'+theme+'.png')});
    }
    results.push('All three sensor pages have no history banner or diagnostic polling at '+width+'px '+theme);
    await ctx.unrouteAll({behavior:'ignoreErrors'});await ctx.close();
  }
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({status:'PASS',scenarios:results,runtime_errors:errors,live_external_requests:0},null,2));
  results.forEach(result=>console.log('PASS '+result));
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;}).finally(async()=>{await browser?.close();await new Promise(resolve=>server?server.close(resolve):resolve());backend?.kill();});
