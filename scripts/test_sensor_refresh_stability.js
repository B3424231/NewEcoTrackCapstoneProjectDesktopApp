'use strict';
// Actual pages, isolated API fixtures and virtual time; no live data or cloud writes.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const {chromium} = require(process.env.ECOTRACK_PLAYWRIGHT || 'playwright');
const root = process.env.ECOTRACK_DESKTOP_ROOT || path.resolve(__dirname, '..');
const out = process.env.ECOTRACK_REFRESH_OUT;
const observations = [];
let server, browser;
async function run() {
  server = http.createServer((req, res) => {
    const file = path.resolve(root, 'public', '.' + new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(path.join(root, 'public') + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404); return res.end();
    }
    res.setHeader('Content-Type', ({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'})[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const site = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  for (const name of ['telemetry', 'analytics', 'sensor-logs']) {
    const ctx = await browser.newContext({viewport:{width:1460,height:1000}});
    let mode = 'failure', release, waiting = false, reads = 0, version = 1;
    const runtimeErrors = [];
    const device = () => ({id:'fixture-node',name:'AC Device Fixture',active:true,device_mode:'monitoring',fresh:true,status:'Fresh',expected_interval_seconds:60,
      aircon_id:'fixture-ac',aircon_name:'Fixture AC',location:'Building · Floor · Room',sensor_config:{airflow_reference:{rpm:1200}},
      latest:{control_snapshot:{desired_state:{temp:25,fan:'auto',mode:'cool'},commanded_at:new Date().toISOString()},observed_at:new Date().toISOString(),target_temperature_c:25,rotation_rpm:600,rotation_quality:'ok',ac_on:true,operating_mode:'cool'}});
    await ctx.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== site) return route.abort();
      if (url.pathname === '/js/supabase-client.js') return route.fulfill({contentType:'text/javascript',body:`window.ECOTRACK_CONFIG={backendUrl:${JSON.stringify(site)}};window.supabaseClient={auth:{onAuthStateChange(fn){fn('INITIAL_SESSION',{user:{id:'refresh-fixture'}});return {data:{subscription:{unsubscribe(){}}}};}},channel(){return {on(){return this;},subscribe(){return this;}};}};`});
      if (!url.pathname.startsWith('/api/')) return route.continue();
      if (/\/(?:devices|changes)$/.test(url.pathname)) {
        reads++;
        if (mode === 'held-failure') { waiting = true; await new Promise(resolve => {release = resolve;}); }
        if (mode !== 'success') return route.fulfill({status:503,json:{error:'fetch failed'}});
        return route.fulfill({json:{items:[device()],version:version++,generation:'fixture',reset:true,removed:[]}});
      }
      if (url.pathname.endsWith('/analytics')) return route.fulfill({json:{sample_count:2,target_temperature_avg:25,rotation_by_node:[{node_id:'fixture-node',rotation_count:2,rotation_avg:600}],points:[{observed_at:new Date().toISOString(),target_temperature_c:25,rotation_by_node:[{node_id:'fixture-node',rotation_count:2,rotation_avg:600}]}]}});
      if (url.pathname.endsWith('/energy')) return route.fulfill({json:{available:true,workspace:'monitoring',energy_kwh:0.1,estimated_unit_hours:1/60,average_power_kw:1,points:[],devices:[]}});
      return route.fulfill({json:{items:[],total:0}});
    });
    await ctx.routeWebSocket(/.*/, socket => socket.close());
    await ctx.addInitScript(({site}) => {
      localStorage.setItem('ecoTrackTheme','light');
      localStorage.setItem('ecoTrack_profile_user',JSON.stringify({id:'refresh-fixture'}));
      localStorage.setItem('ecoTrack_tariff_rate','13.24');
      window.electron={env:{BACKEND_URL:site},on(){},invoke:async()=>({success:true,data:[],nodes:[],aircons:[],buildings:[],floors:[],rooms:[]})};
    }, {site});
    const page = await ctx.newPage();
    page.on('pageerror', error => runtimeErrors.push(error.message));
    await page.clock.install();
    await page.goto(site + '/' + name + '.html');
    const settled = () => page.waitForFunction(() => document.querySelector('#sensorRefresh')?.getAttribute('aria-busy') === 'false');
    await settled();
    assert(await page.locator('#sensorError').isVisible(), name + ': initial error visible');
    await page.evaluate(() => {
      window.refreshProbe={skeletons:0,hides:0,errorChild:document.querySelector('#sensorError').firstChild};
      new MutationObserver(records => {
        for (const record of records) {
          if (record.type==='childList') for (const node of record.addedNodes) if (node.id==='sensorLoading') window.refreshProbe.skeletons++;
          if (record.target.id==='sensorApp' && record.attributeName==='hidden' && record.oldValue===null) window.refreshProbe.hides++;
        }
      }).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden'],attributeOldValue:true});
    });
    mode = 'held-failure';
    await page.clock.runFor(name === 'telemetry' ? 2000 : 5000);
    await page.waitForFunction(() => document.querySelector('#sensorRefresh')?.getAttribute('aria-busy') === 'true');
    assert(waiting, name + ': automatic retry reached fixture');
    const duringRetry = await page.evaluate(() => ({appVisible:!document.querySelector('#sensorApp').hidden,skeletons:refreshProbe.skeletons,hides:refreshProbe.hides}));
    const failureRequestedAt = await page.evaluate(() => { window.refreshProbe.clearedAt = null; new MutationObserver(() => { if (document.querySelector('#sensorError').hidden) window.refreshProbe.clearedAt = performance.now(); }).observe(document.querySelector('#sensorError'), {attributes:true,attributeFilter:['hidden']}); return performance.now(); });
    release(); mode = 'failure';
    await settled();
    const sameErrorNode = await page.evaluate(() => refreshProbe.errorChild === document.querySelector('#sensorError').firstChild);
    mode = 'success';
    await page.locator('#sensorRefresh').click();
    await settled();
    const errorHeldOnRecovery = await page.locator('#sensorError').isVisible();
    if(name==='telemetry') assert((await page.locator('.sensor-metric.temperature').innerText()).includes('25'), 'Target setpoint stays connected');
    if(name==='analytics') assert.equal(await page.locator('#sensorSnapshots .sensor-stat').first().locator('strong').innerText(),'25 °C');
    const updated = name === 'telemetry' ? (await page.locator('.sensor-metric.rotation strong').innerText()) === '600 RPM'
      : name === 'analytics' ? (await page.locator('#sensorSnapshots .sensor-stat').nth(1).locator('strong').innerText()) === '600 RPM'
      : (await page.locator('#kpiEnergyVal').innerText()).includes('0.100');
    await page.clock.runFor(4000);
    const heldUntilMinimum = await page.locator('#sensorError').isVisible();
    await page.clock.runFor(1500);
    const clearsAfterMinimum = await page.locator('#sensorError').isHidden();
    const errorDuration = await page.evaluate(start => refreshProbe.clearedAt - start, failureRequestedAt);
    await settled();
    if (out) await page.screenshot({path:path.join(out,name+'-recovered.png'),fullPage:true});
    // A new failure must cancel an earlier pending clear.
    mode = 'failure'; await page.locator('#sensorRefresh').click(); await settled();
    mode = 'success'; await page.locator('#sensorRefresh').click(); await settled();
    await page.clock.runFor(1000);
    mode = 'failure'; await page.locator('#sensorRefresh').click(); await settled();
    await page.clock.runFor(4500); await settled();
    const newFailureSurvivesOldTimer = await page.locator('#sensorError').isVisible();
    if (out) await page.screenshot({path:path.join(out,name+'-error.png'),fullPage:true});
    observations.push({page:name,duringRetry,sameErrorNode,errorHeldOnRecovery,updated,heldUntilMinimum,clearsAfterMinimum,errorDuration,newFailureSurvivesOldTimer,reads,runtimeErrors});
    await ctx.close();
  }
  if (out) fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(observations,null,2));
  console.log(JSON.stringify(observations,null,2));
  for (const result of observations) {
    assert(result.duringRetry.appVisible && result.duringRetry.skeletons===0 && result.duringRetry.hides===0, result.page+': retries must preserve displayed content');
    assert(result.sameErrorNode, result.page+': repeated identical errors must preserve alert content');
    assert(result.errorHeldOnRecovery && result.heldUntilMinimum && result.clearsAfterMinimum && result.errorDuration >= 5000, result.page+': error must stay for at least five seconds');
    assert(result.newFailureSurvivesOldTimer, result.page+': newer failures cancel earlier clears');
    assert(result.updated, result.page+': recovered data renders immediately with correct RPM');
    assert.deepEqual(result.runtimeErrors,[],result.page+': no runtime errors');
  }
}
run().catch(error => {console.error(error.stack);process.exitCode=1;}).finally(async()=>{
  await browser?.close(); if(server) await new Promise(resolve=>server.close(resolve));
});
