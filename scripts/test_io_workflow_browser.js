'use strict';
// Current combined-workspace pages + real local API/SQLite. Cloud identity/metadata are fixtures.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),net=require('node:net');
const {spawn}=require('node:child_process'),{chromium}=require(process.env.ECOTRACK_PLAYWRIGHT||'playwright');
const {requestMonitoring}=require('../src/monitoring-local'),{requestLocalRead}=require('../src/telemetry-local');
const root=path.resolve(__dirname,'..'),out=path.join(root,'reports/io-workflow-validation-20261028/current-e2e');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ecotrack-io-e2e-')),checks=[];
let backend,server,browser,api;
async function until(fn,label){for(let i=0;i<200;i++){try{if(await fn())return;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Timed out: '+label);}
async function start(){backend=spawn(path.join(root,'venv/Scripts/python.exe'),['-c','from backend.app import app;import sys;app.run(host="127.0.0.1",port=int(sys.argv[1]),use_reloader=False)',new URL(api).port],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,ECOTRACK_SQLITE_DB_PATH:path.join(temp,'telemetry.db'),ECOTRACK_TELEMETRY_SYNC:'0',ECOTRACK_MONITOR_SYNC:'0'}});const logs=[];backend.stdout.on('data',chunk=>logs.push(chunk));backend.stderr.on('data',chunk=>logs.push(chunk));try{await until(async()=>(await fetch(api+'/api/monitoring/devices')).ok,'disposable backend');}catch(error){fs.writeFileSync(path.join(out,'backend-startup.log'),Buffer.concat(logs));throw error;}}
async function stop(){if(backend&&!backend.killed){const exited=new Promise(resolve=>backend.once('exit',resolve));backend.kill();await exited;}}
(async()=>{
  fs.mkdirSync(out,{recursive:true});const listener=net.createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));api='http://127.0.0.1:'+listener.address().port;await new Promise(resolve=>listener.close(resolve));await start();
  const adminToken=fs.readFileSync(path.join(temp,'.ecotrack-monitoring-admin.key'),'utf8').trim();
  const asset={id:'io-workflow-asset',name:'IO workflow AC',aircon_type:'Split Type'};
  const registered=(await requestMonitoring({action:'create',data:{name:'IO workflow fixture',aircon_id:asset.id,location:'Fixture Building · Floor 1 · Room 1',state_source:'isolated_contact',expected_interval_seconds:5}},{backendUrl:api,adminToken,lookupAircon:async()=>asset})).data;
  const samples=[0,20,null].map((temperature,sequence)=>({boot_id:'io-correlation-20261028',sequence,observed_at:new Date(Date.now()-(3-sequence)*5000).toISOString(),clock_quality:'synchronized',interval_seconds:5,outlet_temperature_c:temperature,rotation_rpm:0,battery_voltage:0,rssi_dbm:0,ac_on:false,state_source:'isolated_contact'}));
  const upload=async(body,token=registered.device_token)=>{const response=await fetch(api+'/api/monitoring/telemetry',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
  let response=await upload({device_id:registered.id,samples});assert.equal(response.status,200);assert.equal(response.data.inserted,3);checks.push('Actual authenticated registration and three original sample records persisted.');
  response=await upload({device_id:registered.id,samples});assert.equal(response.data.duplicates,3);assert.equal(response.data.inserted,0);
  assert.equal((await upload({device_id:registered.id,samples:[{...samples[0],outlet_temperature_c:99}]})).status,409);
  assert.equal((await upload({device_id:registered.id,samples:[{...samples[0],sequence:9,outlet_temperature_c:true}]})).status,422);
  assert.equal((await upload({device_id:registered.id,samples:[{...samples[0],sequence:10}]},'invalid-fixture-token')).status,401);
  checks.push('Exact retry is idempotent; conflicting identity, boolean measurement and wrong credentials are rejected.');
  const history=async()=>{const response=await fetch(api+'/api/monitoring/telemetry?node_id='+encodeURIComponent(registered.id));assert(response.ok);return response.json();};
  let stored=await history();assert.equal(stored.total,3);assert.equal(stored.items.find(item=>item.sequence===0).outlet_temperature_c,0);assert.equal(stored.items.find(item=>item.sequence===2).outlet_temperature_c,null);assert.equal(stored.items.find(item=>item.sequence===0).observed_at,samples[0].observed_at);
  await stop();await start();assert.equal((await history()).total,3);checks.push('SQLite retains original timestamps, real zero/null and all three records across a backend restart.');
  server=http.createServer((request,response)=>{const publicRoot=path.join(root,'public'),file=path.resolve(publicRoot,'.'+new URL(request.url,'http://localhost').pathname);if(!file.startsWith(publicRoot+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){response.writeHead(404);return response.end();}response.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'})[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(response);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const site='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({executablePath:process.env.ECOTRACK_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  for(const [width,theme] of [[1440,'light'],[320,'dark']]){
    const context=await browser.newContext({viewport:{width,height:1000},timezoneId:'Asia/Singapore',acceptDownloads:true}),errors=[];
    await context.route('**/*',route=>{const url=route.request().url();if(url.startsWith(site+'/js/shared.js')||url.startsWith(site+'/js/supabase.umd.js'))return route.fulfill({contentType:'text/javascript',body:'/* Cloud identity/metadata boundary isolated; local API remains real. */'});if(url.startsWith(site+'/')||url.startsWith(api+'/'))return route.continue();return route.abort();});
    await context.routeWebSocket(/.*/,socket=>socket.close());
    await context.exposeBinding('ioInvoke',async(_source,channel,input)=>{
      if(channel==='local-api-read')return {success:true,...await requestLocalRead(input,{backendUrl:api,adminToken})};
      if(channel==='monitoring-sync-registry')return {success:true,data:{changed:false}};
      if(channel==='monitoring-fetch-assets')return {success:true,data:[asset]};
      if(channel==='scheduler-fetch-data')return {success:true,nodes:[],aircons:[asset],rooms:[],floors:[],buildings:[]};
      return {success:false,error:'Isolated cloud boundary'};
    });
    await context.addInitScript(({api,theme})=>{localStorage.setItem('ecoTrackTheme',theme);localStorage.setItem('ecoTrack_profile_user',JSON.stringify({id:'io-fixture-admin',role:'admin'}));localStorage.setItem('ecoTrack_backend_url',api);window.electron={env:{BACKEND_URL:api},invoke:(channel,input)=>window.ioInvoke(channel,input),on(){}};},{api,theme});
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(site+'/sensor-logs.html');
    await page.waitForFunction(()=>!document.getElementById('sensorRefresh').disabled&&document.querySelectorAll('#sensorLogTable tbody tr').length===3);
    const rows=page.locator('#sensorLogTable tbody tr');assert.equal(await rows.count(),3);assert((await rows.first().innerText()).includes('IO workflow fixture'));assert((await rows.first().innerText()).includes('Confirmed OFF'));
    await page.locator('#sensorRefresh').click();await page.waitForFunction(()=>!document.getElementById('sensorRefresh').disabled);assert.equal(await rows.count(),3);
    await page.reload();await page.waitForFunction(()=>!document.getElementById('sensorRefresh').disabled&&document.querySelectorAll('#sensorLogTable tbody tr').length===3);
    for(const [id,extension] of [['headerExportPdfBtn','pdf'],['headerExportExcelBtn','xlsx']]){
      const download=page.waitForEvent('download',{timeout:20000});await page.locator('#'+id).click();const item=await download,file=path.join(out,`io-records-${width}.${extension}`);await item.saveAs(file);const bytes=fs.readFileSync(file);assert(bytes.length>100);assert.equal(bytes.subarray(0,extension==='pdf'?4:2).toString(),extension==='pdf'?'%PDF':'PK');
    }
    assert.deepEqual(errors,[]);await rows.first().scrollIntoViewIfNeeded();assert(await rows.first().isVisible());
    await page.screenshot({path:path.join(out,`io-history-${width}-${theme}.png`),fullPage:false});checks.push(`Actual ${width}px ${theme} history renders three persisted rows and OFF evidence; manual refresh/reload and real PDF/Excel downloads succeed without runtime errors.`);await context.close();
  }
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({status:'PASS',checks,live_cloud_used:false,physical_hardware_tested:false},null,2));console.log(JSON.stringify({status:'PASS',checks},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));await stop();});
