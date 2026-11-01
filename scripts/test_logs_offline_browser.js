'use strict';
// Current sensor logs, real temperature model, disposable SQLite and isolated browser storage.
// Only the private test backend is written; every external connection is intercepted.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),net=require('node:net');
const {spawn}=require('node:child_process'),{chromium}=require(process.env.ECOTRACK_PLAYWRIGHT || 'playwright');
const {requestMonitoring}=require('../src/monitoring-local');
const root=path.resolve(__dirname,'..'),sandbox=fs.mkdtempSync(path.join(os.tmpdir(),'ecotrack-sensor-offline-'));
const out=process.env.ECOTRACK_AUDIT_ARTIFACTS || path.resolve(process.env.ECOTRACK_LOGS_QA_OUT || path.join(root,'reports/logs-offline'));
const now=Date.parse('2026-10-20T07:00:00Z'),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let backend,web,browser;
async function port(){const listener=net.createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));const value=listener.address().port;await new Promise(resolve=>listener.close(resolve));return value;}
async function waitFor(test,label){for(let i=0;i<250;i++){try{if(await test())return;}catch(_){}await delay(100);}throw Error('Timed out: '+label);}
async function main(){
 fs.mkdirSync(out,{recursive:true});const api='http://127.0.0.1:'+await port();
 backend=spawn(path.join(root,'venv/Scripts/python.exe'),['-c','from backend.app import app;from backend import monitoring;import sys;monitoring.datetime=type("FixtureDateTime",(monitoring.datetime,),{"now":classmethod(lambda cls,tz=None:cls.fromtimestamp(float(sys.argv[2])/1000,tz or monitoring.timezone.utc))});app.run(host="127.0.0.1",port=int(sys.argv[1]),use_reloader=False)',new URL(api).port,String(now)],{cwd:root,windowsHide:true,stdio:['ignore','ignore','pipe'],env:{...process.env,ECOTRACK_SQLITE_DB_PATH:path.join(sandbox,'telemetry.db'),ECOTRACK_TELEMETRY_SYNC:'0',ECOTRACK_MONITOR_SYNC:'0'}});
 let backendError='';backend.stderr.on('data',chunk=>{backendError=(backendError+chunk).slice(-1200);});
 await waitFor(async()=>{if(backend.exitCode!==null)throw Error(backendError);return(await fetch(api+'/api/monitoring/devices')).ok;},'private Flask backend');
 const adminToken=fs.readFileSync(path.join(sandbox,'.ecotrack-monitoring-admin.key'),'utf8').trim(),asset={id:'offline-fixture-ac',name:'Offline Fixture AC',aircon_type:'Split Type'};
 const registered=(await requestMonitoring({action:'create',data:{name:'Offline Fixture Sensor',aircon_id:asset.id,location:'Fixture Building · Floor 1 · Room 1',pressure_sensor:'MPX5010DP',pressure_min_pa:0,pressure_max_pa:10000,state_source:'power_meter',expected_interval_seconds:60}},{backendUrl:api,adminToken,lookupAircon:async()=>asset})).data;
 const samples=Array.from({length:24},(_,index)=>({boot_id:'isolated-offline',sequence:index,observed_at:new Date(now-(23-index)*60000).toISOString(),clock_quality:'synchronized',interval_seconds:60,outlet_temperature_c:18+index/100,rotation_rpm:index===0?0:30+index,ac_on:true,state_source:'power_meter',battery_voltage:3.8,rssi_dbm:-61,connection_status:'online'}));
 assert.equal((await fetch(api+'/api/monitoring/telemetry',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+registered.device_token},body:JSON.stringify({device_id:registered.id,samples})})).status,200);
 require('./helpers/recorded-energy-fixture').seedRecordedEnergyFixture({root,directory:sandbox,deviceId:registered.id,samples});
 const publicRoot=path.join(root,'public');web=http.createServer((req,res)=>{const file=path.resolve(publicRoot,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!file.startsWith(publicRoot+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.ttf':'font/ttf','.svg':'image/svg+xml','.png':'image/png'};res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);});
 await new Promise(resolve=>web.listen(0,'127.0.0.1',resolve));const site='http://127.0.0.1:'+web.address().port;
 browser=await chromium.launch({executablePath:process.env.ECOTRACK_QA_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const evidence={status:'RUNNING',scenarios:[],external_requests_fulfilled:0,production_database_accessed:false};let expected;
 async function contextFor({width=1540,theme='dark',offline=false,unavailable=false}={}){
  const context=await browser.newContext({viewport:{width,height:1000},timezoneId:'Asia/Singapore'}),held=[],errors=[],requests=[];
  let backendUnavailable=unavailable;
  await require('./helpers/browser-local-api').installLocalApiBridge(context,{backendUrl:api,adminToken,unavailable:()=>backendUnavailable});
  await context.route('**/*',route=>{const url=route.request().url();if(url.startsWith(site+'/'))return route.continue();if(url.startsWith(api+'/')){requests.push({path:new URL(url).pathname,method:route.request().method()});return backendUnavailable?route.abort():route.continue();}held.push(new URL(url).origin);return new Promise(()=>{});});
  await context.routeWebSocket(/.*/,socket=>socket.close());
  await context.addInitScript(({api,offline,theme,now})=>{
   const NativeDate=Date;window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
   Object.defineProperty(navigator,'onLine',{get:()=>!offline});
   localStorage.setItem('ecoTrackTheme',theme);localStorage.setItem('ecoTrack_workspace_mode','monitoring');localStorage.setItem('ecoTrack_backend_url',api);localStorage.setItem('ecoTrack_supabase_url','https://offline.example.invalid');localStorage.setItem('ecoTrack_supabase_anon_key','sb_publishable_isolated_fixture');localStorage.setItem('ecoTrack_tariff_rate','13.24');
   window.electron={env:{BACKEND_URL:api},invoke:async channel=>channel==='monitoring-sync-registry'?{success:true,data:{changed:false}}:{success:false},on(){}};
   window.__offlineTiming={start:performance.now(),analyticsMs:null};new MutationObserver(()=>{const value=document.getElementById('kpiEnergyVal')?.textContent;if(value&&/^\d/.test(value.trim())&&__offlineTiming.analyticsMs===null)__offlineTiming.analyticsMs=performance.now()-__offlineTiming.start;}).observe(document,{childList:true,subtree:true,characterData:true});
  },{api,offline,theme,now});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  return{context,page,held,requests,errors,setUnavailable:value=>{backendUnavailable=value;}};
 }
 const settled=page=>page.waitForFunction(()=>document.getElementById('sensorConnection')?.textContent.startsWith('Local backend connected')&&!document.getElementById('sensorRefresh').disabled);
 const energyValue=page=>page.locator('#kpiEnergyVal').innerText();
 for(const config of [{name:'stalled-internet-desktop',width:1540,theme:'dark'},{name:'offline-mobile',width:390,theme:'light',offline:true},{name:'offline-restart',width:1540,theme:'dark',offline:true}]){
  const test=await contextFor(config);await test.page.goto(site+'/sensor-logs.html',{waitUntil:'domcontentloaded',timeout:10000});await settled(test.page);
  const result=await test.page.evaluate(()=>({energy:document.getElementById('kpiEnergyVal').textContent,cost:document.getElementById('kpiCostVal').textContent,rows:document.querySelectorAll('#sensorLogTable tbody tr').length,info:document.getElementById('sensorPageInfo').textContent,confirmedOn:document.getElementById('kpiRuntimeVal').textContent,energyPoints:Chart.getChart('energyTrendChart').data.datasets[0]?.data.filter(Number.isFinite).length||0,costPoints:Chart.getChart('estimatedCostChart').data.datasets[0]?.data.filter(Number.isFinite).length||0,dualPoints:Chart.getChart('dualAxisChart').data.datasets[0]?.data.filter(Number.isFinite).length||0,timing:window.__offlineTiming.analyticsMs,chartVersion:Chart.version,exportsAvailable:!!(window.jspdf?.jsPDF&&window.ExcelJS?.Workbook)}));
  if(!expected){expected=await(await fetch(api+'/api/monitoring/energy?from=2026-10-19T16:00:00Z&to=2026-10-20T16:00:00Z')).json();assert.equal(expected.available,true,expected.reason);}
  assert.equal(result.energy,expected.energy_kwh.toLocaleString('en-US',{minimumFractionDigits:3,maximumFractionDigits:3}));assert.equal(result.cost,'₱'+(expected.energy_kwh*13.24).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}));
  assert.equal(result.rows,24);assert.equal(result.info,'1–24 of 24');const observed=await(await fetch(api+'/api/monitoring/analytics?from=2026-10-19T16:00:00Z&to=2026-10-20T16:00:00Z')).json();assert.equal(result.confirmedOn,String(Math.round(observed.confirmed_unit_hours)),'Operation follows independent synthetic power feedback, separately from the model estimate');
  assert(result.energyPoints>0&&result.costPoints>0&&result.dualPoints>0);assert(result.exportsAvailable&&Number.isFinite(result.timing));
  assert(!test.held.some(origin=>/cdn|fonts\./.test(origin)),'Current page must not request a style/chart/font CDN');assert.deepEqual(test.errors,[]);
  await test.page.screenshot({path:path.join(out,config.name+'.png'),fullPage:true});
  await test.page.locator('#sensorSelect').selectOption(registered.id);await settled(test.page);assert.equal(await energyValue(test.page),result.energy);
  await test.page.reload({waitUntil:'domcontentloaded'});await settled(test.page);assert.equal(await energyValue(test.page),result.energy);assert.deepEqual(test.errors,[]);
  await test.page.locator('#sensorFrom').fill('2026-01-01');await test.page.locator('#sensorFrom').dispatchEvent('change');await test.page.waitForFunction(()=>!document.getElementById('sensorRefresh').disabled&&document.getElementById('sensorPageInfo').textContent==='No readings');
  assert.equal(await energyValue(test.page),'—');assert.equal(await test.page.locator('#sensorLogTable th').count(),12);assert.match(await test.page.locator('#sensorLogTable tbody').innerText(),/No Sensor Readings/);
  await test.page.locator('#sensorFrom').fill('2026-10-20');await test.page.locator('#sensorFrom').dispatchEvent('change');await settled(test.page);assert.equal(await energyValue(test.page),result.energy);
  evidence.scenarios.push({name:config.name,...result,blockedExternalOrigins:[...new Set(test.held)],empty_and_recovery:'PASS',filter_and_reload:'PASS'});
  console.log('PASS '+config.name+': current sensor page, real model, truthful charts, filters/reload, empty history and recovery');await test.context.close();
 }
 const unavailable=await contextFor({offline:true,unavailable:true});await unavailable.page.goto(site+'/sensor-logs.html',{waitUntil:'domcontentloaded'});
 await unavailable.page.waitForFunction(()=>document.getElementById('sensorConnection')?.textContent==='Local readings unavailable'&&!document.getElementById('sensorRefresh').disabled);
 assert.equal(await energyValue(unavailable.page),'—');assert.equal(await unavailable.page.locator('#kpiCostVal').innerText(),'—');assert.equal(await unavailable.page.locator('#sensorError').isVisible(),true);assert.deepEqual(unavailable.errors,[]);
 unavailable.setUnavailable(false);await unavailable.page.locator('#sensorRefresh').click();await settled(unavailable.page);assert.equal(await energyValue(unavailable.page),expected.energy_kwh.toLocaleString('en-US',{minimumFractionDigits:3,maximumFractionDigits:3}));await unavailable.page.waitForFunction(()=>document.getElementById('sensorError').hidden);assert.equal(await unavailable.page.locator('#sensorError').isVisible(),false);assert.deepEqual(unavailable.errors,[]);
 evidence.backend_unavailable_and_recovery='PASS: unavailable values remain truthful, explicit error clears after real backend recovery';await unavailable.context.close();
 const stored=await(await fetch(api+'/api/monitoring/telemetry?from=2026-10-19T16:00:00Z&to=2026-10-20T16:00:00Z')).json();assert.equal(stored.total,24);assert(stored.items.every(row=>row.ac_on===true));
 evidence.status='PASS';fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(evidence,null,2)+'\n');console.log('PASS backend-down/recovery and unchanged isolated telemetry; no external requests were fulfilled');
}
async function close(){await browser?.close();if(web)await new Promise(resolve=>web.close(resolve));backend?.kill();}
main().then(close).catch(async error=>{console.error(error);await close();process.exitCode=1;});
