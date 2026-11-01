'use strict';
// Production pages, production models, disposable SQLite and isolated browser storage only.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),net=require('node:net');
const {spawn}=require('node:child_process'),{chromium}=require(process.env.ECOTRACK_PLAYWRIGHT || 'playwright');
const {requestMonitoring}=require('../src/monitoring-local');
const root=path.resolve(__dirname,'..'),out=process.env.ECOTRACK_AUDIT_ARTIFACTS || path.resolve(process.env.ECOTRACK_FUTURE_COST_REPORT_DIR || path.join(root,'reports/future-cost')),temp=fs.mkdtempSync(path.join(os.tmpdir(),'ecotrack-future-cost-'));
const now=Date.parse('2026-10-20T07:00:00Z'),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let backend,server,browser;
async function port(){const s=net.createServer();await new Promise(resolve=>s.listen(0,'127.0.0.1',resolve));const p=s.address().port;await new Promise(resolve=>s.close(resolve));return p;}
async function until(fn,label){for(let i=0;i<250;i++){try{if(await fn())return;}catch(_){}await wait(100);}throw Error('Timed out: '+label);}
async function main(){
 fs.mkdirSync(out,{recursive:true});const api='http://127.0.0.1:'+await port();
 backend=spawn(path.join(root,'venv/Scripts/python.exe'),['-c','from backend.app import app;from backend import monitoring;import sys;monitoring.datetime=type("FixtureDateTime",(monitoring.datetime,),{"now":classmethod(lambda cls,tz=None:cls.fromtimestamp(float(sys.argv[2])/1000,tz or monitoring.timezone.utc))});app.run(host="127.0.0.1",port=int(sys.argv[1]),use_reloader=False)',new URL(api).port,String(now)],{cwd:root,windowsHide:true,stdio:'ignore',env:{...process.env,ECOTRACK_SQLITE_DB_PATH:path.join(temp,'telemetry.db'),ECOTRACK_TELEMETRY_SYNC:'0',ECOTRACK_MONITOR_SYNC:'0'}});
 await until(async()=>(await fetch(api+'/api/monitoring/devices')).ok,'private backend');
 const adminToken=fs.readFileSync(path.join(temp,'.ecotrack-monitoring-admin.key'),'utf8').trim();
 const asset={id:'fixture-ac-one',name:'Monitoring Fixture AC',aircon_type:'Split Type'};
 const registered=(await requestMonitoring({action:'create',data:{name:'Monitoring Fixture Node',aircon_id:asset.id,location:'Fixture Building · Floor 1 · Room 1',pressure_sensor:'MPX5010DP',pressure_min_pa:0,pressure_max_pa:10000,state_source:'power_meter',expected_interval_seconds:60}},{backendUrl:api,adminToken,lookupAircon:async()=>asset})).data;
 const samples=Array.from({length:24},(_,i)=>({boot_id:'isolated-future-cost',sequence:i,observed_at:new Date(now-(23-i)*60000).toISOString(),clock_quality:'synchronized',interval_seconds:60,outlet_temperature_c:18+i/100,differential_pressure_pa:30,ac_on:true,state_source:'power_meter',battery_voltage:3.8,rssi_dbm:-61,connection_status:'online'}));
 assert.equal((await fetch(api+'/api/monitoring/telemetry',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+registered.device_token},body:JSON.stringify({device_id:registered.id,samples})})).status,200);
 require('./helpers/recorded-energy-fixture').seedRecordedEnergyFixture({root,directory:temp,deviceId:registered.id,samples});
 // Verify the real cold model separately before testing the renderer's bounded requests.
 const modelStarted=performance.now(),modelResponse=await fetch(api+'/api/monitoring/energy?from=2026-10-19T16:00:00Z&to=2026-10-20T16:00:00Z'),modelReadiness=await modelResponse.json(),modelLoadMs=Math.round(performance.now()-modelStarted);
 assert.equal(modelResponse.status,200,JSON.stringify(modelReadiness));assert.equal(modelReadiness.available,true,JSON.stringify(modelReadiness));
 console.log('PASS isolated real-model readiness before browser: '+modelLoadMs+' ms');
 const publicRoot=path.join(root,'public');server=http.createServer((req,res)=>{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=path.resolve(publicRoot,'.'+pathname);if(!file.startsWith(publicRoot+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.ttf':'font/ttf'};res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const site='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const evidence={status:'RUNNING',checks:[],runtimeErrors:[],externalRequestsSent:0,productionDatabaseAccessed:false,modelLoadMs};
 {
  const source='sensor';
  const ctx=await browser.newContext({viewport:{width:1920,height:1080},timezoneId:'Asia/Singapore',acceptDownloads:true});
  await require('./helpers/browser-local-api').installLocalApiBridge(ctx,{backendUrl:api,adminToken});
  await ctx.route('**/*',route=>{const url=route.request().url();if(url.startsWith(site+'/')||url.startsWith(api+'/'))return route.continue();return route.abort();});
  await ctx.routeWebSocket(/.*/,socket=>socket.close());
  await ctx.addInitScript(({api,now})=>{
   const NativeDate=Date;window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
   localStorage.setItem('ecoTrackTheme','dark');localStorage.setItem('ecoTrack_workspace_mode','monitoring');localStorage.setItem('ecoTrack_backend_url',api);localStorage.setItem('ecoTrack_supabase_url','https://isolated.example.invalid');localStorage.setItem('ecoTrack_supabase_anon_key','sb_publishable_isolated_fixture');localStorage.setItem('ecoTrack_tariff_rate','13.24');
   window.electron={env:{BACKEND_URL:api},invoke:async channel=>channel==='monitoring-sync-registry'?{success:true,data:{changed:false}}:{success:false},on(){}};
  },{api,now});
  const page=await ctx.newPage();page.on('pageerror',error=>evidence.runtimeErrors.push(source+': '+error.message));
  await page.goto(site+'/sensor-logs.html',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.getElementById('sensorConnection')?.textContent.startsWith('Local backend connected'));
  const layout=await page.evaluate(()=>{const box=id=>document.getElementById(id).getBoundingClientRect(),button=box('openFutureCostBtn'),time=box('sensorTimeStart'),pdf=box('headerExportPdfBtn');return {sameTimeRow:Math.abs((button.top+button.height/2)-(time.top+time.height/2))<3,belowExports:button.top>=pdf.bottom,inside:button.right<=innerWidth};});
  assert(layout.sameTimeRow,source+' future button must align with Time');assert(layout.belowExports);assert(layout.inside);
  await page.screenshot({path:path.join(out,source+'-header.png')});
  assert.equal(await page.evaluate(()=>EcoTrackFutureCost.hasPlan()),false);
  await page.locator('#openFutureCostBtn').click();await page.locator('#futureCostDialog[open]').waitFor();
  assert(await page.locator('#futureCostDialog').evaluate(element=>{const box=element.getBoundingClientRect();return Math.abs(box.left+box.width/2-innerWidth/2)<2 && Math.abs(box.top+box.height/2-innerHeight/2)<2;}),'Empty modal centered');
  assert.equal(await page.locator('#futureCostDialog button').filter({hasText:/Generate|Export/}).count(),0);
  assert.equal(await page.locator('#futureTarget').count(),0,'Monitoring forecasts do not expose requested controller settings');
  assert.equal(await page.locator('#futureHours').inputValue(),'');
  assert.equal(await page.locator('#futureDevice option').count(),2,'One registered monitored AC plus All');
  await page.locator('#futureHours').fill('8');await page.waitForFunction(()=>document.querySelectorAll('.fc-kpis').length===1 && document.getElementById('futureResult').getAttribute('aria-busy')==='false');
  const calculated=await page.evaluate(()=>EcoTrackFutureCost.capture());assert.equal(calculated.available,true,calculated.reason);assert.equal(calculated.rows.length,7);assert.equal(calculated.plannedUnitHours,56);assert.equal(calculated.deviceCount,1);
  {
   const energy=await(await fetch(api+'/api/monitoring/energy?from=2026-10-19T16:00:00Z&to=2026-10-20T16:00:00Z')).json();const device=energy.devices.find(device=>device.node_id===registered.id);assert(Math.abs(calculated.kwh-device.energy_kwh/(device.estimated_seconds/3600)*56)<1e-8);assert.match(calculated.reference,/2026-10-20 to 2026-10-20/);
  }
  evidence.checks.push(source+': production page and model integration, explicit plan hours, truthful source, exact AC count, Time-row placement');
  for(const theme of ['dark','light'])for(const width of [1460,390]){
   await page.setViewportSize({width,height:1000});await page.evaluate(theme=>document.documentElement.classList.toggle('dark',theme==='dark'),theme);
   const modal=await page.locator('#futureCostDialog').evaluate(element=>{const box=element.getBoundingClientRect(),body=element.querySelector('.fc-body');return {inside:box.left>=0&&box.right<=innerWidth&&box.top>=0&&box.bottom<=innerHeight,centered:Math.abs(box.left+box.width/2-innerWidth/2)<2 && Math.abs(box.top+box.height/2-innerHeight/2)<2,scroll:body.scrollHeight>=body.clientHeight,width:element.scrollWidth<=element.clientWidth};});assert(modal.inside);assert(modal.centered);assert(modal.width);assert(modal.scroll);
   await page.screenshot({path:path.join(out,source+'-modal-'+width+'-'+theme+'.png')});
  }
  await page.setViewportSize({width:1920,height:1080});await page.evaluate(()=>document.documentElement.classList.add('dark'));
  await page.keyboard.press('Escape');assert.equal(await page.locator('#futureCostDialog').count(),0);assert(await page.locator('#openFutureCostBtn').evaluate(element=>document.activeElement===element));
  const file=page.waitForEvent('download');await page.locator('#headerExportPdfBtn').click();await(await file).saveAs(path.join(out,source+'-future.pdf'));
  await page.waitForFunction(()=>!document.getElementById('headerExportPdfBtn').disabled);
  const excel=page.waitForEvent('download');await page.locator('#headerExportExcelBtn').click();await(await excel).saveAs(path.join(out,source+'-history.xlsx'));
  await page.waitForFunction(()=>!document.getElementById('headerExportPdfBtn').disabled);
  evidence.checks.push(source+': dark/light responsive modal, Close/Escape focus, header PDF and combined AC Excel downloads');
  // Change the historical selection to a date with no records. Future data stays explicitly conditional.
  await page.locator('#sensorFrom').fill('2026-01-01');await page.locator('#sensorFrom').dispatchEvent('change');
  await page.waitForFunction(()=>!document.getElementById('sensorRefresh').disabled && document.getElementById('sensorPageInfo').textContent==='No readings');
  await page.locator('#openFutureCostBtn').click();
  await page.locator('[data-fc-period="month"]').click();await page.waitForFunction(()=>document.querySelectorAll('.fc-kpis').length===1 && document.getElementById('futureResult').getAttribute('aria-busy')==='false');
  const empty=await page.evaluate(()=>EcoTrackFutureCost.capture());assert.equal(empty.rows.length,30);
  assert.equal(empty.available,false,'Missing sensor history cannot establish projected energy');
  assert.equal(empty.kwh,null);assert.equal(empty.cost,null);
  await page.locator('#futureDone').click();
  const second=page.waitForEvent('download');await page.locator('#headerExportPdfBtn').click();await(await second).saveAs(path.join(out,source+'-empty-history-future.pdf'));
  evidence.checks.push(source+': next-calendar-month daily breakdown; empty-history PDF and missing monitoring data handled');
  await ctx.close();
 }
 await require('./test_future_cost_interactions')(browser);
 evidence.checks.push('Modal interactions: presets/custom dates, weekdays, unit selector, tariff changes, invalid hours, removed devices, stale PDF rejection, late reply after Escape');
 const actualCount=await(await fetch(api+'/api/monitoring/telemetry?from=2026-10-19T16:00:00Z&to=2026-10-20T16:00:00Z')).json();assert.equal(actualCount.total,24,'Projection must not write future observations');
 assert.deepEqual(evidence.runtimeErrors,[]);evidence.status='PASS';fs.writeFileSync(path.join(out,'browser-verification.json'),JSON.stringify(evidence,null,2));evidence.checks.forEach(check=>console.log('PASS '+check));
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;}).finally(async()=>{await browser?.close();server?.close();backend?.kill();});
