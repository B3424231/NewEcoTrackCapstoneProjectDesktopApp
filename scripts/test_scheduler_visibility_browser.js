'use strict';
// Isolated scheduling UI fixtures. No live database, account, network commands or hardware.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { chromium } = require(process.env.ECOTRACK_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '..');
const out = process.env.ECOTRACK_SCHEDULER_VISIBILITY_REPORT_DIR || path.join(root, 'reports/scheduler-visibility');
const baseline = process.argv.includes('--baseline'), report = { phase: baseline ? 'before' : 'after', checks: [], errors: [], failures: [], blockedWriteAttempts: 0 };
fs.mkdirSync(out, { recursive: true });
let browser, server;
async function boxes(page) {
 return page.evaluate(() => {
  const scroll = document.querySelector('.scheduler-table-scroll'), frame = scroll.getBoundingClientRect();
  const box = selector => { const el = document.querySelector(selector), r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { unobscured:!!hit && el.contains(hit), left:r.left, right:r.right, top:r.top, bottom:r.bottom, visible:r.left >= frame.left && r.right <= frame.right && r.top >= frame.top && r.bottom <= frame.bottom && r.right <= innerWidth }; };
  return { viewport:innerWidth, scrollLeft:scroll.scrollLeft, frame:{left:frame.left,right:frame.right,width:frame.width}, identity:box('.sched-device-name'), identityHeader:box('thead th:nth-child(2)'), action:box('.apply-schedule-btn'), documentOverflow:document.documentElement.scrollWidth > innerWidth };
 });
}
(async () => {
 server = http.createServer((req,res) => { const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname), base=name.startsWith('/assets/')?root:path.join(root,'public'), file=path.resolve(base,'.'+name); if(!file.startsWith(base+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'})[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res); });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); const site='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({executablePath:process.env.ECOTRACK_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 for(const width of [1460,1280]) for(const mode of (baseline?['both']:['both'])) for(const theme of (baseline?['light']:['light','dark'])) {
  const writes=[], commands=[];
  const node={id:'fixture-controller',name:'Fixture Controller',monitoring_id:'fixture-sensor',device_mode:'both',room_id:'room',wake_time:'22:00',sleep_time:'06:00',interval_val:15,interval_unit:'Minutes'};
  const asset={id:'fixture-ac',name:'Fixture Aircon',asset_tag:'FIXTURE-AC',controller_node_id:node.id,aircon_type:'Window Type'};
  const sensor={id:'fixture-sensor',active:true,name:'Fixture Sensor',aircon_id:asset.id,aircon_name:asset.name,aircon_type:asset.aircon_type,location:'Fixture Building · Floor 1 · Room 1',fresh:false,latest:null,sensor_schedule:{wake_time:'22:00',sleep_time:'06:00',interval_seconds:900}};
  const registry={success:true,nodes:[node],aircons:[asset],buildings:[{id:'building',name:'Fixture Building'}],floors:[{id:'floor',name:'Floor 1',building_id:'building'}],rooms:[{id:'room',name:'Room 1',floor_id:'floor'}]};
  const ctx=await browser.newContext({viewport:{width,height:800}});
    await require('./helpers/browser-local-api').installLocalApiBridge(ctx,{backendUrl:site,routeFixtures:true});
  await ctx.route('**/*',route=>{const url=route.request().url(); if(!['GET','HEAD'].includes(route.request().method())){report.blockedWriteAttempts++;return route.abort();} if(url.startsWith(site+'/api/monitoring/devices'))return route.fulfill({json:{items:[sensor],sync:{enabled:false}}});if(url.startsWith(site+'/api/'))return route.fulfill({json:{items:[],version:1}});if(url.startsWith(site+'/'))return route.continue();return route.abort();});
  await ctx.routeWebSocket(/.*/,socket=>socket.close());
  await ctx.exposeBinding('fixtureInvoke',async(_,channel,input)=>{if(channel==='scheduler-fetch-data')return registry;if(channel==='monitoring-sync-registry')return {success:true};if(channel==='monitoring-admin-request'){assert.equal(input.action,'schedule');writes.push(input);return {success:true,data:input.data};}return {success:false,error:'Isolated fixture'};});
  await ctx.addInitScript(({site,mode,theme})=>{
   localStorage.setItem('ecoTrack_workspace_mode',mode);localStorage.setItem('ecoTrackTheme',theme);localStorage.setItem('sidebarCollapsed','false');localStorage.setItem('ecoTrack_backend_url',site);localStorage.setItem('ecoTrack_supabase_url','https://offline-fixture.invalid');localStorage.setItem('ecoTrack_supabase_anon_key','sb_publishable_isolated_fixture');
   window.electron={env:{BACKEND_URL:site},invoke:(channel,input)=>window.fixtureInvoke(channel,input),on(){}};
   window.fixtureRequests=[];let hardware;Object.defineProperty(window,'EcoTrackHardwareCloud',{configurable:true,get:()=>hardware,set:api=>{hardware={...api,listStatus:async()=>[],request:async(id,kind,payload)=>{window.fixtureRequests.push({id,kind,payload});return {id:'fixture-command',node_id:id,kind};},waitForResult:undefined};}});
  },{site,mode,theme});
  const page=await ctx.newPage();page.on('pageerror',error=>report.errors.push(error.message));
  const check={width,mode,theme};report.checks.push(check);
  try {
   await page.goto(site+'/scheduler.html',{waitUntil:'domcontentloaded'});await page.locator('.apply-schedule-btn').first().waitFor();await page.waitForFunction(()=>Number(getComputedStyle(document.querySelector('main')).opacity)>.99);
   check.beforeScroll=await boxes(page);await page.screenshot({path:path.join(out,`scheduler-${report.phase}-${mode}-${width}-${theme}.png`)});
   if(baseline){try{assert(check.beforeScroll.action.visible,'Apply must be visible before horizontal scrolling');}catch(error){report.failures.push({width,mode,theme,error:error.message});}continue;}
   assert(check.beforeScroll.action.visible,'Apply must be visible before horizontal scrolling');assert(check.beforeScroll.identity.visible,'Device identity must be visible initially');
   assert(await page.locator('#schedulerScrollHint').isVisible(),'Explicit wake/sleep and interval scroll cue');
   await page.locator('.scheduler-table-scroll').focus();await page.keyboard.press('End');await page.locator('.scheduler-table-scroll').evaluate(el=>{el.scrollLeft=el.scrollWidth;});
   check.afterScroll=await boxes(page); await page.screenshot({path:path.join(out,`scheduler-after-scroll-${mode}-${width}-${theme}.png`)});assert(check.afterScroll.action.visible,'Apply must remain visible after scrolling');assert(check.afterScroll.identity.visible && check.afterScroll.identity.unobscured,'Device identity must remain visible after scrolling'); assert(check.afterScroll.identityHeader.visible && check.afterScroll.identityHeader.unobscured,'Device header must remain readable after scrolling');
   const sleep=page.getByRole('button',{name:'Edit sleep time',exact:true});await sleep.click();await page.locator('#timePickerHour').selectOption('7');await page.locator('#timePickerMinute').selectOption('30');await page.locator('#timePickerPeriod').selectOption('AM');await page.locator('#timePickerSaveBtn').click();
   assert.equal(await page.locator('input[id^="sleep-"]').inputValue(),'07:30');
   await page.locator('input[id^="interval-val-"]').fill('2');await page.locator('.scheduler-table-scroll').evaluate(el=>{el.scrollLeft=el.scrollWidth;}); await page.locator('.sched-interval-box .eco-select-trigger').click(); await page.getByRole('option',{name:'Hours',exact:true}).click();
   await page.locator('.apply-schedule-btn').click();await page.waitForFunction(()=>!document.querySelector('.apply-schedule-btn').disabled);
   if(mode!=='controller')assert.deepEqual(writes.at(-1).data,{wake_time:'22:00',sleep_time:'07:30',interval_seconds:7200});
   const requests=await page.evaluate(()=>window.fixtureRequests);if(mode!=='monitoring'){assert.equal(requests.at(-1).kind,'configure');assert.equal(requests.at(-1).payload.sleep_time,'07:30');assert.equal(requests.at(-1).payload.interval_seconds,7200);}else assert.equal(requests.length,0);
   assert.equal((await boxes(page)).documentOverflow,false);check.saved={sensorWrites:writes.length,controllerRequests:requests.length};
   await page.screenshot({path:path.join(out,`scheduler-after-controls-${mode}-${width}-${theme}.png`)});
  }catch(error){report.failures.push({width,mode,theme,error:error.stack});}finally{await ctx.close();}
 }
assert.deepEqual(report.errors,[]);assert.deepEqual(report.failures,[]);
})().catch(error=>{process.exitCode=1;report.failure=error.stack;}).finally(async()=>{await browser?.close();await new Promise(resolve=>server?server.close(resolve):resolve());report.stopped=true;fs.writeFileSync(path.join(out,`scheduler-visibility-${report.phase}.json`),JSON.stringify(report,null,2));console.log(JSON.stringify({phase:report.phase,checks:report.checks.length,errors:report.errors,failures:report.failures,blockedWriteAttempts:report.blockedWriteAttempts,stopped:report.stopped},null,2));});

