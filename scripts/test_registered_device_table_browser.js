'use strict';
// The actual registered-device page, data bus and skeletons with one isolated NodeService fixture.
// No cloud login, database writes, hardware commands or external network requests.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.ECOTRACK_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '..'), publicRoot = path.join(root, 'public');
const out=process.env.ECOTRACK_AUDIT_ARTIFACTS || path.resolve(process.env.ECOTRACK_REGISTERED_DEVICE_REPORT || path.join(root, 'reports/registered-device-table/browser'));
let server, browser;
const transportId = 'esp32s3-001122334455';
const canonicalId = 'AC-' + transportId;
const fixtureScript = `(() => {
  const node = { node_id:'${transportId}', db_id:'registered-fixture-one', name:'${transportId}', device_mode:'both', monitoring_id:'11111111-1111-4111-8111-111111111111',
    room_id:'room-fixture', room_name:'Fixture Room', floor:'Fixture Floor', building:'Fixture Building', status:'Connected',hardware:'ESP32-S3 IR controller',
    firmware:'fixture-version',ip_address:'10.0.0.4',wifi_ssid:'Fixture network',rssi:-62,last_seen:new Date().toISOString(),capabilities:{ir_receiver:true,ir_transmitter:true},
    cloud_state:{device_id:'${transportId}',connection_status:'online',latest_ir:null},ir_tx:true,ir_rx:true,battery_percent:window.fixtureInitialFailure?0:undefined };
  const aircon = {id:'ac-fixture',aircon_id:'ac-fixture',device_id:'${canonicalId}',asset_tag:'Fixture AC',name:'Fixture AC',controller_node_id:node.db_id,node_id:node.node_id,brand:'Fixture',aircon_type:'Split Type'};
  Object.defineProperty(node,'name',{get(){if(window.fixtureInitialFailure)throw new Error('Isolated initial row render failure');return '${transportId}';}});
  const listeners = new Map();
  const on = (name, callback) => {if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(callback);};
  const emit = name => (listeners.get(name)||[]).forEach(callback=>callback({}));
  window.fixtureDevice = {node,aircon,profiles:[aircon],emit,networkWrites:0};
  window.EcoTrackAirconState = {remoteObservation:()=>({}),selectSettings:()=>({state:null,source:'unknown'})};
  window.EcoTrackAirconSystem = {
    NodeService:{getNodes:()=>[node],getNode:id=>[node.node_id,node.db_id].includes(id)?node:null},
    AirconProfileManager:{getAll:()=>window.fixtureDevice.profiles,getById:id=>id===aircon.id?aircon:null},
    CentralLogService:{log:()=>{throw new Error('Unexpected fixture command/log write');}},
    AirconEvents:{on},ProtocolAdapter:{},CapabilityEngine:{},syncWithDatabase:async()=>{}
  };
})();`;

(async () => {
  fs.mkdirSync(out, { recursive: true });
  server = http.createServer((req, res) => {
    const file = path.resolve(publicRoot, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(publicRoot + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const site = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ executablePath: process.env.ECOTRACK_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const results = [];
  for (const [width, height, theme, initialFailure] of [[1460,1000,'dark',false],[1460,1000,'light',false],[390,844,'dark',false],[390,844,'light',false],[1460,1000,'dark',true]]) {
    const context = await browser.newContext({ viewport: { width, height }, timezoneId: 'Asia/Singapore' });
    const errors = [], writes = [], attemptedExternal = [];
    await context.addInitScript(({ theme, initialFailure }) => {
      window.fixtureInitialFailure = initialFailure;
      localStorage.setItem('ecoTrack_workspace_mode', 'both');localStorage.setItem('ecoTrackTheme', theme);
      localStorage.setItem('sidebarCollapsed', String(innerWidth < 760));
      localStorage.setItem('ecoTrack_profile_user', JSON.stringify({ id:'admin_fixture',name:'Fixture Administrator',userType:'admin' }));
      window.electron={env:{},on(){},invoke:async channel=>channel==='auth-set-session'?{success:true}:{success:false,error:'Isolated fixture prevents IPC writes'}};
    }, { theme, initialFailure });
    await context.route('**/*', route => {
      const request = route.request(), url = request.url();
      if (!['GET', 'HEAD'].includes(request.method())) { writes.push({ method:request.method(),url }); return route.abort(); }
      if (url === 'https://cdn.tailwindcss.com/') return route.fulfill({ path:path.join(publicRoot,'vendor/tailwindcss.js'),contentType:'text/javascript' });
      if (url.startsWith(site + '/js/supabase.umd.js') || url.startsWith(site + '/js/supabase-client.js')) return route.fulfill({ body:'/* All cloud clients disabled for this isolated fixture. */',contentType:'text/javascript' });
      if (url.startsWith(site + '/js/aircon-system.js')) return route.fulfill({ body:fixtureScript,contentType:'text/javascript' });
      if (url.startsWith(site + '/')) return route.continue();
      attemptedExternal.push(url); return route.abort();
    });
    await context.routeWebSocket(/.*/, socket=>socket.close());
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    await page.goto(site+'/nodes.html');
    // The previous failure updated this KPI to 1, then threw before replacing skeleton rows.
    await page.waitForFunction(()=>document.getElementById('nodeKpiTotal')?.textContent==='1',{},{timeout:5000});
    if(initialFailure){
      await page.locator('#nodeTableBody [role="alert"]').waitFor({timeout:5000});
      assert((await page.locator('#nodeTableBody').innerText()).includes('Devices could not be displayed'));
      assert.equal(await page.locator('#nodeTableBody .eco-skeleton').count(),0);
      assert.equal(await page.locator('#nodeTableBody').getAttribute('aria-busy'),'false');
      await page.screenshot({path:path.join(out,'initial-render-error.png'),fullPage:true});
      await page.evaluate(()=>{window.fixtureInitialFailure=false;window.fixtureDevice.emit('hardware:updated');});
    }
    await page.locator('#nodeTableBody tr[data-id="'+transportId+'"]').waitFor({timeout:5000});
    const row=page.locator('#nodeTableBody tr[data-id="'+transportId+'"]');
    async function openRowContextMenu() {
      const cell = row.locator('td').first();
      await cell.evaluate(el=>el.scrollIntoView({block:'nearest',inline:'nearest'}));
      // Deliver pending scroll events before opening a menu that closes on scroll.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await cell.click({button:'right'});
    }

    assert.equal(await row.count(),1);
    assert.equal(await page.locator('#nodeKpiConnected').innerText(),'1');
    assert.equal(await page.locator('#nodeKpiOffline').innerText(),'0');
    assert.equal(await page.locator('#nodeKpiAircons').innerText(),'1');
    assert.equal(await page.locator('th').filter({hasText:'Device Name'}).count(),1);
    assert.equal((await page.locator('th').filter({hasText:'Device Name'}).textContent()).trim(),'Device Name');
    assert.equal((await row.locator('td').first().innerText()).trim(),canonicalId);
    assert(!/ESP32|Heltec|MCP9808|MPX5010DP|LM393/i.test(await row.locator('td').nth(1).innerText()));
    assert((await row.innerText()).includes('AC device 334455'));
    assert.equal(await page.locator('#nodeTableBody .eco-skeleton, #nodeTableBody [aria-busy="true"]').count(),0);
    assert.equal(await row.getAttribute('data-id'),transportId,'Transport identity stays unchanged');
    await page.screenshot({path:path.join(out,`registered-table-${width}-${theme}.png`),fullPage:true});
    await openRowContextMenu();
    await page.locator('#contextMenuViewBtn').waitFor({state:'visible'});
    assert(!/ESP32/i.test(await page.locator('#contextMenuNodeName').innerText()));
    assert.equal(await page.locator('#contextMenuNodeBadge').innerText(),canonicalId);
    await page.locator('#contextMenuViewBtn').click();
    await page.locator('#viewNodeModal').waitFor({state:'visible'});
    await page.locator('#nodeContextMenu').waitFor({state:'hidden'});
    assert(!/ESP32|Heltec/i.test(await page.locator('#viewModalTitle').innerText()));
    assert((await page.locator('#viewModalTitle').innerText()).includes('AC device 334455'));
    assert.equal(await page.locator('#viewHardwareModel').innerText(),'AC Device');
    assert.equal(await page.locator('#viewBattery').innerText(),initialFailure?'0%':'Not reported');
    assert.equal(await page.locator('#viewModalNodeBadge').innerText(),canonicalId);
    assert.equal(await page.locator('#viewConnectionStatus').getAttribute('data-device-state'),'online');
    assert.equal(await page.locator('#viewStatusDot svg').getAttribute('width'),'20');
    assert.equal(await page.locator('#viewSignalBadge svg').getAttribute('width'),'16');
    assert.equal(await page.locator('#viewRssiIcon').getAttribute('width'),'16');
    assert.equal(await page.locator('#viewSignalBadgeText').innerText(),'-62 dBm');
    await page.screenshot({path:path.join(out,`registered-details-${width}-${theme}.png`),fullPage:true});
    await page.keyboard.press('Escape');
    await page.locator('#viewNodeModal').waitFor({state:'hidden'});
    if(!initialFailure){
      for(const [status,state,label] of [['Offline','offline','Offline / standby'],['Sleeping','sleeping','Sleeping'],[null,'unknown','Status not reported']]){
        await page.evaluate(status=>{window.fixtureDevice.node.status=status;window.fixtureDevice.emit('hardware:updated');},status);
        await openRowContextMenu();await page.locator('#contextMenuViewBtn').click();await page.locator('#viewNodeModal').waitFor({state:'visible'});
        assert.equal(await page.locator('#viewConnectionStatus').getAttribute('data-device-state'),state);
        assert.equal(await page.locator('#viewStatusText').innerText(),label);
        assert.equal(await page.locator('#viewSignalBadgeText').innerText(),'-62 dBm · last reported');
        assert.equal(await page.locator('#viewRssiVal').innerText(),'-62 dBm · last reported');
        assert.equal(await page.locator('#viewSignalBadge').getAttribute('data-device-state'),'unknown');
        const iconColors=await page.locator('#viewStatusDot').evaluate(icon=>({icon:getComputedStyle(icon).color,label:getComputedStyle(document.getElementById('viewStatusText')).color}));assert.equal(iconColors.icon,iconColors.label);
        await page.screenshot({path:path.join(out,`details-${state}-${width}-${theme}.png`),fullPage:true});
        await page.keyboard.press('Escape');await page.locator('#viewNodeModal').waitFor({state:'hidden'});
      }
      await openRowContextMenu();await page.locator('#contextMenuEditBtn').click();await page.locator('#editNodeModal').waitFor({state:'visible'});
      assert.equal(await page.locator('#editModalNodeBadge').innerText(),canonicalId);
      const brand=page.locator('#editNodeBrand'),list=page.locator('#editBrandList');
      assert.equal(await brand.getAttribute('list'),null);assert.equal(await brand.getAttribute('role'),'combobox');
      await brand.fill('TC');await list.getByRole('option',{name:'TCL',exact:true}).waitFor();
      const flow=await list.evaluate(list=>({bottom:list.getBoundingClientRect().bottom,next:document.getElementById('editNodeAirconType').parentElement.getBoundingClientRect().top}));assert(flow.next>=flow.bottom,'Manufacturer suggestions push the next field down instead of covering it');
      await page.screenshot({path:path.join(out,`edit-brand-suggestions-${width}-${theme}.png`),fullPage:true});
      await brand.press('ArrowDown');assert(await brand.getAttribute('aria-activedescendant'));await brand.press('Enter');assert.equal(await brand.inputValue(),'TCL');assert.equal(await brand.getAttribute('aria-expanded'),'false');
      await brand.fill('Independent manufacturer');assert((await list.innerText()).includes('You can enter the manufacturer'));await brand.press('Escape');assert.equal(await brand.inputValue(),'Independent manufacturer');assert(await page.locator('#editNodeModal').isVisible());
      await brand.fill('');await brand.press('ArrowUp');assert(await brand.getAttribute('aria-activedescendant'));
      const bounded=await list.evaluate(list=>({height:list.getBoundingClientRect().height,content:list.scrollHeight,view:list.clientHeight}));assert(bounded.height<=180);assert(bounded.content>bounded.view,'Manufacturer suggestions scroll within the form');
      await brand.press('Escape');await page.locator('#cancelEditNodeBtn').click();await page.locator('#editNodeModal').waitFor({state:'hidden'});
      await page.evaluate(()=>{window.fixtureDevice.profiles.push({...window.fixtureDevice.aircon,device_id:'Another profile'});window.fixtureDevice.emit('hardware:updated');});
      await page.waitForFunction(raw=>document.querySelector('#nodeTableBody tr[data-id] td')?.textContent.trim()===raw,transportId);
      assert.equal(await row.getAttribute('data-id'),transportId,'An ambiguous display link does not change the command identity');
      await page.evaluate(()=>{window.fixtureDevice.profiles.splice(1);window.fixtureDevice.aircon.device_id='';window.fixtureDevice.emit('hardware:updated');});
      await page.waitForFunction(raw=>document.querySelector('#nodeTableBody tr[data-id] td')?.textContent.trim()===raw,transportId);
      await page.evaluate(canonical=>{window.fixtureDevice.aircon.device_id=canonical;window.fixtureDevice.node.rssi=null;window.fixtureDevice.emit('hardware:updated');},canonicalId);
      await openRowContextMenu();await page.locator('#contextMenuViewBtn').click();await page.locator('#viewNodeModal').waitFor({state:'visible'});
      assert.equal(await page.locator('#viewSignalBadgeText').innerText(),'Signal not reported');assert.equal(await page.locator('#viewRssiVal').innerText(),'Not reported');
      await page.keyboard.press('Escape');await page.locator('#viewNodeModal').waitFor({state:'hidden'});
      await page.evaluate(()=>{window.supabaseClient={from(){return {select(){return this;},order(){return this;},then(resolve,reject){return Promise.resolve({data:[],error:null}).then(resolve,reject);}};}};});
      await page.locator('#openAddNodeBtn').click();await page.locator('#nodeModal').waitFor({state:'visible'});
      const manualButton=page.getByRole('button',{name:'Enter AC Device ID',exact:true});
      assert.equal(await manualButton.getAttribute('type'),'button');assert.equal(await manualButton.getAttribute('aria-expanded'),'false');
      await manualButton.focus();await manualButton.press('Enter');await page.locator('#manualNodeContainer').waitFor({state:'visible'});
      assert.equal(await manualButton.getAttribute('aria-expanded'),'true');assert(await page.locator('#manualNodeInput').evaluate(input=>document.activeElement===input));
      await page.locator('#manualNodeInput').fill(transportId);
      const manualShape=await manualButton.evaluate(button=>({height:button.getBoundingClientRect().height,border:parseFloat(getComputedStyle(button).borderTopWidth),right:button.getBoundingClientRect().right}));assert(manualShape.height>=38);assert(manualShape.border>=1);assert(manualShape.right<=width);
      await page.screenshot({path:path.join(out,`manual-device-id-${width}-${theme}.png`),fullPage:true});
      await manualButton.click();await page.locator('#manualNodeContainer').waitFor({state:'hidden'});assert.equal(await manualButton.getAttribute('aria-expanded'),'false');
      await page.locator('#closeNodeModalBtn').click();await page.locator('#nodeModal').waitFor({state:'hidden'});
    }
    await page.evaluate(()=>window.fixtureDevice.emit('hardware:updated'));
    await page.waitForFunction(()=>document.querySelectorAll('#nodeTableBody tr[data-id]').length===1);
    await page.waitForTimeout(250);
    assert.equal(await row.count(),1);
    await page.evaluate(()=>{window.fixtureDevice.node.status=null;window.fixtureDevice.emit('hardware:updated');});
    await page.waitForFunction(()=>document.getElementById('nodeKpiOffline')?.textContent==='1');
    assert.equal(await row.count(),1,'Null status cannot return the populated table to skeletons');
    assert.equal(await page.locator('#nodeKpiConnected').innerText(),'0');
    assert.equal(await page.locator('#nodeTableBody .eco-skeleton').count(),0);
    assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
    results.push({width,height,theme,initial_failure_recovered:initialFailure,status:'PASS',rows:1,kpi:1,context_details:'PASS',canonical_identifier:'PASS',raw_fallback_for_ambiguous_links:'PASS',brand_keyboard_custom_entry:initialFailure?'NOT RUN':'PASS',readable_device_states:initialFailure?'NOT RUN':'PASS',manual_device_id_button:initialFailure?'NOT RUN':'PASS',missing_battery_or_reported_zero:'PASS',null_status:'PASS',hardware_model_hidden:true,raw_transport_id_preserved:true,runtime_errors:errors,network_writes:writes.length});
    await context.close();
  }
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({status:'PASS',real_accounts_created:0,cloud_or_database_writes:0,checks:results},null,2));
  console.log(JSON.stringify({status:'PASS',checks:results},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();await new Promise(resolve=>server?server.close(resolve):resolve());});
