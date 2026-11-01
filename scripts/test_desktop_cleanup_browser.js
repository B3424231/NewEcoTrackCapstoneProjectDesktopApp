'use strict';
// Actual desktop pages and assets; every data response is isolated and every external request intercepted.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.ECOTRACK_PLAYWRIGHT || 'playwright');
const root=path.resolve(__dirname,'..'),out=process.env.ECOTRACK_AUDIT_ARTIFACTS || path.resolve(process.env.ECOTRACK_CLEANUP_REPORT_DIR || path.join(root,'reports/desktop-cleanup'));
const assetAudit=require('./verify_current_ui_assets').verify();
const now=Date.parse('2026-10-21T07:00:00Z'),api='http://127.0.0.1:59999';
const sample={control_snapshot:{configured_state:{temp:24,fan:'high',mode:'cool'}},target_temperature_c:24,observed_at:new Date(now).toISOString(),outlet_temperature_c:18,temperature_quality:'good',rotation_rpm:600,rotation_quality:'good',battery_voltage:3.8,rssi_dbm:-60,ac_on:true,operating_mode:'cool',interval_seconds:60,connection_status:'online'};
const node={id:'fixture-sensor',name:'Cleanup Fixture Sensor',active:true,fresh:true,status:'online',aircon_id:'fixture-ac',aircon_name:'Cleanup Fixture AC',aircon_type:'Window Type',location:'Fixture Building · Floor 1 · Room 1',created_at:'2026-10-01T00:00:00Z',latest:sample,schedule:{wake_time:'05:00',sleep_time:'17:00',interval_seconds:60}};
const rows=[{...sample,id:'fixture-reading-1',node_id:node.id,sensor_name:node.name,location:node.location,aircon_type:node.aircon_type}];
const stats={sample_count:1,confirmed_state_count:1,confirmed_unit_hours:.1,observed_unit_hours:.1,temperature_avg:18,rotation_avg:600,points:[{observed_at:sample.observed_at,temperature:18,rotation_rpm:600,operating_mode:'cool',ac_on:1}]};
const energy={available:true,energy_kwh:.4,estimated_unit_hours:.1,average_power_kw:4,devices:[{node_id:node.id,aircon_id:node.aircon_id,energy_kwh:.4,estimated_seconds:360}],points:[{observed_at:sample.observed_at,energy_kwh:.4}]};
const metadata={success:true,nodes:[],aircons:[{id:'fixture-ac',name:node.aircon_name,aircon_type:'Window Type'}],rooms:[],floors:[],buildings:[]};
const checks=[],runtimeErrors=[],missingResources=[],unexpectedMutations=[],retiredRequests=[];
let server,browser;
async function main(){
 fs.mkdirSync(out,{recursive:true});
 server=http.createServer((req,res)=>{
  const requested=decodeURIComponent(new URL(req.url,'http://local').pathname),file=path.resolve(root,'.'+requested);
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end('Not found');return;}
  const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.ttf':'font/ttf','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon'};
  res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const site='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({executablePath:process.env.ECOTRACK_QA_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 for(const theme of ['light','dark']){
  const ctx=await browser.newContext({viewport:{width:1460,height:1000},timezoneId:'Asia/Singapore',acceptDownloads:true});
 await require('./helpers/browser-local-api').installLocalApiBridge(ctx,{backendUrl:api,routeFixtures:true});
  await ctx.routeWebSocket(/.*/,socket=>socket.close());
  await ctx.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.hostname==='cdn.tailwindcss.com')return route.fulfill({path:path.join(root,'public/vendor/tailwindcss.js'),contentType:'text/javascript'});
   if(url.hostname==='cdn.jsdelivr.net'&&url.pathname.startsWith('/npm/chart.js'))return route.fulfill({path:path.join(root,'public/vendor/chart.umd.js'),contentType:'text/javascript'});
   if(req.url().startsWith(site+'/')){
    if(url.pathname==='/favicon.ico')return route.fulfill({status:204});
    if(require('./verify_current_ui_assets').retired.some(file=>url.pathname==='/'+file))retiredRequests.push(url.pathname);
    return route.continue();
   }
   if(url.hostname==='cleanup-fixture.invalid'&&/^\/rest\/v1\/rpc\/ecotrack_(?:my_profile|is_admin|admin_list_staff)$/.test(url.pathname))return route.fulfill({contentType:'application/json',body:url.pathname.endsWith('is_admin')?'true':'[]'});
   if(req.method()!=='GET'&&req.method()!=='HEAD'){unexpectedMutations.push({url:url.pathname,method:req.method()});return route.fulfill({status:503,contentType:'application/json',body:'{"error":"Fixture is read only"}'});}
   if(req.url().startsWith(api+'/')){
    let data={items:[],total:0,totalItems:0,totalPages:0};
    if(url.pathname==='/api/monitoring/devices')data={items:[node]};
    else if(url.pathname==='/api/monitoring/analytics')data=stats;
    else if(url.pathname==='/api/monitoring/telemetry')data={items:rows,total:rows.length};
    else if(url.pathname==='/api/monitoring/energy')data=energy;
    return route.fulfill({contentType:'application/json',body:JSON.stringify(data),headers:{'Access-Control-Allow-Origin':'*'}});
   }
   if(url.hostname==='cleanup-fixture.invalid')return route.fulfill({contentType:'application/json',body:'[]',headers:{'content-range':'0-0/0'}});
   // Unavailable internet is intentional; the desktop's bundled libraries still load locally.
   return route.abort();
  });
  await ctx.addInitScript(({api,theme,now,metadata})=>{
   const NativeDate=Date;window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
   localStorage.setItem('ecoTrackTheme',theme);if(!localStorage.getItem('ecoTrack_workspace_mode'))localStorage.setItem('ecoTrack_workspace_mode','both');localStorage.setItem('ecoTrack_session_timeout','Never');
   localStorage.setItem('ecoTrack_backend_url',api);localStorage.setItem('ecoTrack_supabase_url','https://cleanup-fixture.invalid');localStorage.setItem('ecoTrack_supabase_anon_key','sb_publishable_isolated_cleanup_fixture');
   localStorage.setItem('ecoTrack_tariff_rate','13.24');localStorage.setItem('ecoTrack_profile_user',JSON.stringify({id:'fixture-admin',username:'Fixture Admin',name:'Fixture Admin',role:'admin',session_timeout:'Never'}));
   window.electron={env:{BACKEND_URL:api},on(){},invoke:async(channel,input)=>channel==='monitoring-sync-registry'?{success:true,data:{changed:false}}:channel==='rules-fetch-data'&&input?.report?{success:true,data:{complete:true,rules:[{id:'temperature-fixture',type:'temperature',condition:'above',value:25,unit:'°C',room_id:'room-fixture',enabled:false}],nodes:[{id:'controller-fixture',name:'Cleanup Fixture Sensor',monitoring_id:'fixture-sensor',room_id:'room-fixture'}],rooms:[{id:'room-fixture',name:'Room 1',floor_id:'floor-fixture'}],floors:[{id:'floor-fixture',name:'Floor 1',building_id:'building-fixture'}],buildings:[{id:'building-fixture',name:'Fixture Building'}],ruleNodes:[],notifications:[{id:'saved-temperature-violation',node_id:'controller-fixture',room_id:'room-fixture',rule_id:'temperature-fixture',created:new Date(now-60000).toISOString(),content:'Cleanup Fixture Sensor|||Temperature went above 25°C (was 31°C)',triggered:true,is_dismissed_from_inbox:true}]}}:channel==='scheduler-fetch-data'?metadata:channel==='monitoring-fetch-assets'?{success:true,data:metadata.aircons}:{success:true,data:[],nodes:[],aircons:[],rooms:[],floors:[],buildings:[]}};
  },{api,theme,now,metadata});
  const page=await ctx.newPage();
  page.on('pageerror',error=>runtimeErrors.push({page:new URL(page.url()).pathname,error:error.message}));
  page.on('response',response=>{if(response.url().startsWith(site+'/')&&response.status()>=400)missingResources.push({url:new URL(response.url()).pathname,status:response.status()});});
  const pages=fs.readdirSync(path.join(root,'public')).filter(file=>file.endsWith('.html')&&!['sidebar-template.html','index.html','sensor-scheduler.html'].includes(file));
  for(const file of pages){
   await page.goto(site+'/public/'+file,{waitUntil:'load'});
   if(file!=='login.html')await page.locator('#sidebar').waitFor();
   if(['analytics.html','telemetry.html','sensor-logs.html'].includes(file))await page.waitForFunction(()=>document.getElementById('sensorConnection')?.textContent.startsWith('Local backend connected'));
   if(file==='sensor-logs.html'){
    assert.equal(await page.locator('#sensorLogTable th').nth(8).innerText(),'BLOWER FAN SPEED');
    assert.equal(await page.locator('#sensorLogTable tbody tr').first().locator('td').nth(8).innerText(),'HIGH');
    assert(!/RPM/.test(await page.locator('#sensorLogTable').innerText()));
   }
   assert.equal(await page.locator('a[href="logs.html"]').count(),0,file+' has no retired link');
   if(file!=='login.html'){
    assert.equal(await page.locator('#sidebarModeSwitch').count(),0);assert.equal(await page.evaluate(()=>EcoTrackMode.mode),'both');
   }
   if(file==='login.html')assert(await page.locator('[style*="login-bg.jpg"]').evaluate(el=>getComputedStyle(el).backgroundImage.includes('login-bg.jpg')));
   checks.push({theme,page:file,status:'PASS'});
  }
  await page.goto(site+'/public/profile.html');await page.locator('#sidebar').waitFor();assert.equal(await page.locator('#tabBtnDeviceMode,#panelDeviceMode').count(),0);await page.reload();assert.equal(await page.evaluate(()=>EcoTrackMode.mode),'both');
  await page.getByRole('link',{name:'Telemetry',exact:true}).click();await page.waitForURL('**/telemetry.html');await page.locator('#sensorFleet .sensor-telemetry-card').first().waitFor();
  assert.match(await page.locator('#sensorFleet').innerText(),/Cleanup Fixture AC/);
  await page.getByRole('link',{name:'AC Energy Forecast',exact:true}).click();await page.waitForURL('**/sensor-logs.html');await page.waitForFunction(()=>document.getElementById('sensorConnection')?.textContent.startsWith('Local backend connected'));
  await page.locator('#openFutureCostBtn').click();await page.locator('#futureHours').fill('8');await page.waitForFunction(()=>document.querySelector('.fc-kpis')&&document.getElementById('futureResult').getAttribute('aria-busy')==='false');
  const calculated=await page.evaluate(()=>EcoTrackFutureCost.capture());assert.equal(calculated.available,true);assert.equal(calculated.plannedUnitHours,56);assert.equal(calculated.kwh,224);
  await page.keyboard.press('Escape');
  for(const [button,name] of [['headerExportPdfBtn','pdf'],['headerExportExcelBtn','xlsx']]){
   const pending=page.waitForEvent('download');await page.locator('#'+button).click();const download=await pending.catch(async error=>{throw new Error(name+' download failed: '+await page.locator('#sensorExportStatus').innerText()+'; '+error.message);});await download.saveAs(path.join(out,theme+'-monitoring.'+name));
   await page.waitForFunction(()=>!document.getElementById('headerExportPdfBtn').disabled);
   assert.equal(download.failure instanceof Function?await download.failure():null,null);
  }
  await page.screenshot({path:path.join(out,theme+'-current-forecast.png')});
  checks.push({theme,journey:'mode, reload, sidebar navigation, telemetry, forecast, PDF and XLSX',status:'PASS'});
  await ctx.close();
 }
 assert.deepEqual(missingResources,[]);assert.deepEqual(retiredRequests,[]);assert.deepEqual(runtimeErrors,[]);assert.deepEqual(unexpectedMutations,[]);
 console.log('PASS '+checks.length+' desktop page/journey groups; zero missing local resources, retired-file requests, runtime errors, or data mutations.');
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;}).finally(async()=>{
 await browser?.close();await new Promise(resolve=>server?server.close(resolve):resolve());
 fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({status:process.exitCode?'FAIL':'PASS',assetAudit,checks,runtimeErrors,missingResources,retiredRequests,unexpectedMutations},null,2));
});
