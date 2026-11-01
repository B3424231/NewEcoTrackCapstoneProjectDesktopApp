'use strict';
// Isolated view-state and actual-page regressions. No account, cloud or hardware access.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), http = require('node:http');
const root = path.resolve(__dirname, '..');
const stateFile = path.join(root, 'public/js/page-state.js');
assert(fs.existsSync(stateFile), 'The shared page-context store must exist');
const source = fs.readFileSync(stateFile, 'utf8');
function unitChecks() {
  const entries = new Map(), account = { id: 'context-account-a' };
  const storage = { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key) };
  const load = (pathname = '/analytics.html', blocked = false) => {
    const window = { location: { pathname }, localStorage: { getItem: key => key === 'ecoTrack_profile_user' ? JSON.stringify(account) : null }, sessionStorage: blocked ? { getItem(){throw Error('blocked');},setItem(){throw Error('blocked');},removeItem(){throw Error('blocked');} } : storage, addEventListener(){} };
    const document = { readyState: 'loading', addEventListener(){} };
    vm.runInNewContext(source, { window, document, URLSearchParams, location: window.location, requestAnimationFrame(){} });
    return window.EcoTrackPageState;
  };
  let api = load(); api.save({ sensorFrom: '2026-10-01', pageNumber: 3 }); api.save({ sensorThrough: '2026-10-05' });
  assert.equal(load().read().sensorFrom, '2026-10-01'); assert.equal(load().read().pageNumber, 3);
  assert.equal(load('/telemetry.html').read().sensorFrom, undefined, 'Pages have separate contexts');
  account.id = 'context-account-b'; assert.equal(load().read().sensorFrom, undefined, 'Accounts have separate contexts');
  api.save({ sensorFrom: 'old-account-view' }); assert.equal(load().read().sensorFrom, undefined, 'An old document cannot write into a newly signed-in account');
  account.id = 'context-account-a'; api = load(); api.clear(); assert.equal(api.read().sensorFrom, undefined);
  api.save({pageNumber:2}); for (const key of entries.keys()) entries.set(key, '{malformed');
  assert.doesNotThrow(() => load().read()); assert.doesNotThrow(() => { const blocked = load('/analytics.html', true); blocked.save({pageNumber:2}); blocked.clear(); });
  console.log('PASS page store: return visits, merge, account/page isolation, malformed and blocked storage');
}
async function browserChecks() {
  const { chromium } = require(process.env.ECOTRACK_PLAYWRIGHT || 'playwright');
  let browser;
  const server = http.createServer((req,res) => {
    const file = path.resolve(root, 'public', '.' + new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(path.join(root, 'public') + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {res.writeHead(404);return res.end();}
    res.setHeader('Content-Type', ({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[path.extname(file)] || 'application/octet-stream');fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const site = 'http://127.0.0.1:' + server.address().port;
  try {
    browser = await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
    const context = await browser.newContext({viewport:{width:1460,height:1000}}), errors = [];
    context.setDefaultTimeout(8000);
    let devices = [{id:'context-sensor',name:'Context Device',active:true,fresh:false,location:'Context Building · Floor 1 · Room 2',aircon_name:'Context AC',latest:null}];
    await context.route('**/*', route => {
      const url = new URL(route.request().url()); if (url.origin !== site) return route.abort();
      if(url.pathname === '/js/supabase-client.js') return route.fulfill({contentType:'text/javascript',body:`window.ECOTRACK_CONFIG={backendUrl:${JSON.stringify(site)}};window.supabaseClient={auth:{onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}};}},channel(){return {on(){return this;},subscribe(){return this;}};}};`});
      if (!url.pathname.startsWith('/api/')) return route.continue();
      if (/\/(devices|changes)$/.test(url.pathname)) return route.fulfill({json:{items:devices,reset:true,version:1,generation:'context',removed:[]}});
      if(url.pathname.endsWith('/analytics')) return route.fulfill({json:{sample_count:0,points:[]}});
      if(url.pathname.endsWith('/energy')) return route.fulfill({json:{available:false}});
      if(url.pathname.endsWith('/telemetry')) { const offset = (Number(url.searchParams.get('page') || 1)-1)*50;return route.fulfill({json:{items:Array.from({length:offset?10:50},(_,index)=>({id:'context-log-'+(offset+index),node_id:'context-sensor',observed_at:'2026-10-02T00:00:00Z',target_temperature_c:24,ac_on:null})),total:60}}); }
      return route.fulfill({json:{items:[],total:0}});
    });
    await context.routeWebSocket(/.*/, socket=>socket.close());
    await context.addInitScript(({site}) => {
      localStorage.setItem('ecoTrack_profile_user',JSON.stringify({id:'context-account-a'})); localStorage.setItem('ecoTrackTheme','light');
      window.electron={env:{BACKEND_URL:site},on(){},invoke:async(channel)=>{
        if (channel === 'scheduler-fetch-data') return {success:true,buildings:[{id:'context-building',name:'Context Building'}],floors:[{id:'context-floor',name:'Floor 1',building_id:'context-building'}],rooms:[{id:'context-room-1',name:'Room 1',floor_id:'context-floor'},{id:'context-room-2',name:'Room 2',floor_id:'context-floor'}],nodes:[],aircons:[]};
        if (channel === 'notifications-fetch-all') return {success:true,data:Array.from({length:24},(_,index)=>({id:'context-alert-'+index,room_id:'context-room-2',content:'Fixture threshold alert '+index,triggered:true,created:'2026-10-01T00:00:00Z'}))};
        if (channel === 'staff-fetch-all') return {success:true,data:[{id:'context-staff',name:'Context Technician',email:'context@example.invalid',status:'offline'}]};
        return {success:true,data:[],nodes:[],aircons:[],buildings:[],floors:[],rooms:[]};
      }};
    }, {site});
    const page = await context.newPage(); page.on('pageerror',error=>errors.push(error.message));
    const settled = () => page.waitForFunction(()=>document.querySelector('#sensorRefresh')?.getAttribute('aria-busy') === 'false');
    await page.goto(site+'/analytics.html');await settled();
    await page.locator('#sensorFrom').fill('2026-10-01');await page.locator('#sensorFrom').dispatchEvent('change');await settled();
    await page.locator('#sensorThrough').fill('2026-10-05');await page.locator('#sensorThrough').dispatchEvent('change');await settled();
    await page.locator('#sensorSelect').selectOption('context-sensor');await settled();
    await page.goto(site+'/telemetry.html');await settled();await page.goto(site+'/analytics.html');await settled();
    assert.equal(await page.locator('#sensorFrom').inputValue(),'2026-10-01','Analytics retains the investigation start date');
    assert.equal(await page.locator('#sensorThrough').inputValue(),'2026-10-05'); assert.equal(await page.locator('#sensorSelect').inputValue(),'context-sensor');
    await page.reload(); await settled(); assert.equal(await page.locator('#sensorFrom').inputValue(),'2026-10-01');
    await page.goto(site+'/analytics.html?from=2026-09-02&through=2026-09-03');await settled();
    assert.equal(await page.locator('#sensorFrom').inputValue(),'2026-09-02','Explicit URL dates take priority');
    devices=[];await page.reload();await settled();assert.equal(await page.locator('#sensorSelect').inputValue(),'','Deleted saved sensors fall back to the real all-devices scope');
    devices=[{id:'context-sensor',name:'Context Device',active:true,fresh:false,location:'Context Building · Floor 1 · Room 2',aircon_name:'Context AC',latest:null}];
    await page.goto(site+'/sensor-logs.html');await settled();
    await page.locator('[data-period="weekly"]').click();await settled();
    await page.locator('#sensorDateSelect').selectOption({index:1});await settled();
    const selectedDate = await page.locator('#sensorDateSelect').inputValue();
    await page.locator('#sensorTimeStart').fill('08:30');await page.locator('#sensorTimeStart').dispatchEvent('change');await settled();
    await page.locator('#sensorTimeEnd').fill('17:15');await page.locator('#sensorTimeEnd').dispatchEvent('change');await settled();
    await page.locator('#sensorNext').click();await settled();assert((await page.locator('#sensorPageInfo').innerText()).includes('51'));
    await page.locator('.sensor-content').evaluate(element=>{element.scrollTop=200;});
    await page.waitForFunction(()=>document.querySelector('.sensor-content').scrollTop >= 200);
    await page.goto(site+'/telemetry.html');await settled();
    await page.locator('[data-location-index="0"]').click();
    await page.goto(site+'/sensor-logs.html');await settled();
    assert.equal(await page.locator('[data-period="weekly"]').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('#sensorDateSelect').inputValue(),selectedDate);assert.equal(await page.locator('#sensorTimeStart').inputValue(),'08:30');assert.equal(await page.locator('#sensorTimeEnd').inputValue(),'17:15');
    assert((await page.locator('#sensorPageInfo').innerText()).includes('51'),'Logs retain the selected result page');
    await page.waitForFunction(()=>document.querySelector('.sensor-content').scrollTop >= 200);
    await page.locator('#sensorClearTime').click();await settled();await page.locator('#sensorRefresh').click();await settled();
    assert.equal(await page.locator('#sensorTimeStart').inputValue(),'','Polling cannot restore a cleared time filter');
    await page.goto(site+'/telemetry.html');await settled();assert.equal(await page.locator('[data-location-index="0"]').getAttribute('aria-pressed'),'true');
    await page.goto(site+'/profile.html');await page.locator('#tabBtnSecurity').click();
    await page.goto(site+'/telemetry.html');await settled();await page.goto(site+'/profile.html');
    assert.equal(await page.locator('#tabBtnSecurity').getAttribute('aria-selected'),'true','Profile retains the selected tab');
    console.log('Checking Maintenance context');
    await page.goto(site+'/staff.html');await page.locator('#tabStaffBtn').click();
    await page.locator('#staffSearch').fill('Context');await page.locator('#staffStatusFilter').selectOption({label:'Offline'});
    await page.goto(site+'/telemetry.html');await settled();await page.goto(site+'/staff.html');await page.locator('#staffSearch').waitFor({state:'visible'});
    assert.equal(await page.locator('#staffSearch').inputValue(),'Context');assert.equal(await page.locator('#staffStatusFilter').inputValue(),'Offline');
    console.log('Checking Notifications context');
    await page.goto(site+'/Notification.html');await page.locator('#roomsList [data-room="context-room-2"]').click();await page.locator('#notificationFilterUnreadBtn').click();await page.locator('#messagesNextBtn').click();
    await page.goto(site+'/telemetry.html');await settled();await page.goto(site+'/Notification.html');
    await page.waitForFunction(()=>document.querySelector('#messagesPaginationPages')?.textContent.includes('Page 2'));
    assert.equal(await page.locator('#roomsList [data-room="context-room-2"]').getAttribute('aria-selected'),'true');
    assert((await page.locator('#notificationFilterUnreadBtn').getAttribute('class')).includes('active'));
    await page.goto(site+'/scheduler.html');await page.locator('#roomsList [data-room="context-room-2"]').click();
    await page.goto(site+'/telemetry.html');await settled();await page.goto(site+'/scheduler.html');
    await page.waitForFunction(()=>document.querySelector('#roomsList [data-room="context-room-2"]')?.getAttribute('aria-selected') === 'true');
    assert.deepEqual(errors,[]); await context.close();
    console.log('PASS actual Analytics/Telemetry/Logs/Profile/Maintenance/Notifications/Scheduler return visits, refresh, URL precedence, deleted sensor, log period/date/time/page, room/filter/page/tab retention, clear filter stability, no runtime errors');
  } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
}
unitChecks();
if (!process.argv.includes('--unit')) browserChecks().catch(error=>{console.error(error.stack);process.exitCode=1;});
