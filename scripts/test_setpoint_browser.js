'use strict';
// Actual desktop pages with isolated network data; never connects to live services.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.ECOTRACK_PLAYWRIGHT || 'playwright');
const root=process.env.ECOTRACK_DESKTOP_ROOT || path.resolve(__dirname,'..'),out=process.env.ECOTRACK_SETPOINT_OUT || path.join(require('node:os').tmpdir(),'ecotrack-setpoint-browser');fs.mkdirSync(out,{recursive:true});
let browser,server,target=24,version=1,missing=false,fan="high",mode="dry",rpm=600;
const now=()=>new Date().toISOString(),past=()=>new Date(Date.now()-120000).toISOString();
const nodeId='11111111-1111-4111-8111-111111111111';
const aircon=()=>({id:'ac',name:'Window AC',asset_tag:'AC-1',controller_node_id:'node',configured_state:{temp:22,mode,fan},desired_state:missing?{}:{temp:target,mode,fan},commanded_at:now()});
const registry=()=>({success:true,nodes:[{id:'node',name:'AC device',device_mode:'both',monitoring_id:nodeId,monitor_aircon_id:'ac',room_id:'room',interval_val:5,interval_unit:'Seconds',sensor_config:{airflow_reference:{rpm:1200}}}],aircons:[aircon()],buildings:[{id:'building',name:'IC building'}],floors:[{id:'floor',name:'Floor 1',building_id:'building'}],rooms:[{id:'room',name:'Room 1',floor_id:'floor'}]});
const sample=()=>({id:'s',node_id:nodeId,aircon_id:'ac',aircon_name:'Window AC',observed_at:now(),outlet_temperature_c:18,temperature_quality:'ok',rotation_rpm:rpm,rotation_quality:'ok',operating_mode:mode,ac_on:null,target_temperature_c:missing?null:target,control_snapshot:missing?null:{desired_state:{temp:target,mode,fan},commanded_at:past()}});
const device=()=>({id:nodeId,cloud_node_id:'node',active:true,name:'AC device',device_mode:'both',aircon_id:'ac',aircon_name:'Window AC',location:'IC building · Floor 1 · Room 1',fresh:true,status:'Reporting',expected_interval_seconds:5,latest:sample()});
const analytics=()=>({sample_count:13,temperature_avg:18,temperature_count:13,target_temperature_avg:missing?null:target,target_temperature_count:missing?0:13,rotation_avg:rpm,rotation_by_node:[{node_id:nodeId,rotation_avg:rpm,rotation_count:13}],confirmed_state_count:0,confirmed_unit_hours:0,observed_unit_hours:1/60,points:[{observed_at:now(),temperature:18,target_temperature_c:missing?null:target,rotation_rpm:rpm,rotation_by_node:[{node_id:nodeId,rotation_avg:rpm,rotation_count:13}],operating_mode:mode,ac_on:null}]});
const energy=()=>({model:'extra_trees',source:'recorded_ac_control_settings',workspace:'monitoring',history_seconds:60,available:!missing,experimental:true,energy_kwh:missing?null:0.01,average_power_kw:missing?null:0.6,estimated_unit_hours:1/60,reason:missing?'Requires one minute of continuous recorded target, fan and mode settings.':'Conditional target-setpoint estimate; not metered consumption.',code:missing?'CONTROL_REFERENCE_HISTORY_UNAVAILABLE':'EXPERIMENTAL_CONTROL_ESTIMATE',points:[{observed_at:now(),energy_kwh:0.01}],devices:missing?[]:[{node_id:nodeId,aircon_id:'ac',aircon_name:'Window AC',sensor_name:'AC device',location:device().location,aircon_type:'Window',energy_kwh:0.01,estimated_seconds:60}]});
const results=[];
(async()=>{
 server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname,file=path.resolve(root,'public','.'+pathname);if(!file.startsWith(path.join(root,'public')+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'})[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const site='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const context=await browser.newContext({viewport:{width:1460,height:1000}});
 await require('./helpers/browser-local-api').installLocalApiBridge(context,{backendUrl:site,routeFixtures:true});
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.origin!==site)return route.abort();
  if(/\/js\/(?:shared|sidebar|sidebar-loader|supabase\.umd)\.js$/.test(url.pathname))return route.fulfill({contentType:'text/javascript',body:''});
  if(url.pathname==='/js/supabase-client.js')return route.fulfill({contentType:'text/javascript',body:`window.ECOTRACK_CONFIG={backendUrl:${JSON.stringify(site)}};window.supabaseClient={from(table){const q={select(){return q},eq(){return q},in(){return q},not(){return q},order(){return q},limit(){return q},abortSignal(){return q},then(ok,bad){return fetch('/fixture/'+table).then(r=>r.json()).then(data=>({data,error:null})).then(ok,bad)}};return q},channel(){return {on(kind,filter,fn){window.fixtureEvents ||= {};window.fixtureEvents[filter.table]=fn;return this},subscribe(){return this}}},removeChannel(){}};`});
  if(url.pathname.startsWith('/fixture/')){const table=url.pathname.split('/').pop(),data=table==='aircons'?[missing?{...aircon(),configured_state:null}:aircon()]:table==='nodes'?[{id:'node',temp:18,rotation_rpm:rpm,updated:now()}]:table==='ecotrack_device_state'?[{node_id:'node',last_seen:now()}]:table==='telemetry'?[{node_id:'node',aircon_id:'ac',temperature:18,rotation_rpm:rpm,rotation_quality:'ok',observed_at:now(),ac_on:null,control_snapshot:sample().control_snapshot}]:[];return route.fulfill({json:data});}
  if(url.pathname.startsWith('/api/monitoring/')){let data={};if(url.pathname.endsWith('/devices'))data={items:[device()],version,generation:'fixture'};else if(url.pathname.endsWith('/changes'))data={items:[device()],removed:[],version,generation:'fixture'};else if(url.pathname.endsWith('/analytics'))data=analytics();else if(url.pathname.endsWith('/telemetry'))data={items:[sample()],total:1,snapshot:'1'};else if(url.pathname.endsWith('/energy'))data=energy();return route.fulfill({json:data});}
  return route.continue();
 });
 await context.exposeBinding('fixtureRegistry',()=>registry());
 await context.addInitScript(({site})=>{localStorage.setItem('ecoTrackTheme','light');localStorage.setItem('ecoTrack_profile_user',JSON.stringify({id:'fixture',role:'admin'}));localStorage.setItem('ecoTrack_tariff_rate','13.24');window.electron={env:{BACKEND_URL:site},invoke:async channel=>channel==='scheduler-fetch-data'?window.fixtureRegistry():({success:true}),on(){}};},{site});
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(site+'/analytics.html');await page.waitForFunction(()=>!document.getElementById('sensorRefresh').disabled);
 await page.screenshot({path:path.join(out,'analytics-'+(process.argv.includes('--baseline')?'before':'after')+'.png'),fullPage:true});
 assert.match(await page.locator('#sensorSnapshots').innerText(),/24\s*°C/,'Average uses recorded target 24°C, not outlet 18°C');
 assert.match(await page.locator('#sensorSnapshots').innerText(),/target setpoint/i);
 await page.waitForFunction(()=>typeof Chart==='function'&&Chart.getChart('sensorTempChart'));
 assert.match(await page.locator('#sensorSnapshots').innerText(),/600 RPM/,'Analytics includes actual measured RPM average');
 assert.deepEqual(await page.evaluate(()=>Chart.getChart('sensorRotationChart').data.datasets[0].data),[600]);
 assert.ok(await page.evaluate(()=>Chart.getChart('sensorStateChart').data.datasets.some(d=>d.label==='Dry' && d.data.some(value=>value!==null))),'Recorded Dry mode is visible');
 for(const recordedMode of ['auto','dry']){
  mode=recordedMode;version++;await page.locator('#sensorRefresh').click();await page.waitForFunction(()=>!document.getElementById('sensorRefresh').disabled);
  const label=recordedMode[0].toUpperCase()+recordedMode.slice(1);
  assert.ok(await page.evaluate(label=>Chart.getChart('sensorStateChart').data.datasets.some(d=>d.label===label && d.data.some(value=>value!==null)),label));
 }

 const rotationTooltip=await page.evaluate(()=>Chart.getChart('sensorRotationChart').options.plugins.tooltip.callbacks.label({dataIndex:0,parsed:{y:600},formattedValue:'600'}));
 assert.match(rotationTooltip,/600 RPM/);

 assert.deepEqual(await page.evaluate(()=>Chart.getChart('sensorTempChart').data.datasets[0].data),[24]);
 await page.waitForFunction(()=>window.fixtureEvents?.nodes);
 await page.evaluate(()=>window.fixtureEvents.nodes({eventType:'UPDATE',new:{id:'node',temp:19,updated:new Date().toISOString()}}));
 assert.match(await page.locator('#sensorSnapshots').innerText(),/24\s*°C/,'Measurement-only event does not replace target average');
 results.push('Analytics average and Temperature Trend use recorded setpoints; realtime sensor events stay safe');
 assert.equal(await page.locator('h1 + .sensor-badge').count(),0,'Analytics heading badge removed');
 await page.goto(site+'/telemetry.html');await page.waitForFunction(()=>document.querySelector('.sensor-telemetry-card'));
 assert.equal(await page.locator('h1 + .sensor-badge').count(),0,'Telemetry heading badge removed');
 const sidebar=fs.readFileSync(path.join(root,'public/sidebar-template.html'),'utf8');
 assert.match(sidebar, /id="sensorMonitoringSection"[^>]*>AC Monitoring<\/div>/);
 const temperature=page.locator('.sensor-metric.temperature');
 assert.match(await page.locator('.sensor-metric.rotation').innerText(),/600 RPM/);
 assert.match(await page.locator('.sensor-metric.rotation').innerText(),/600 RPM[\s\S]*High/);
 assert.match(await page.locator('.sensor-mode-tile').innerText(),/Dry/);

 await page.waitForFunction(()=>document.querySelector('.sensor-metric.temperature strong span')?.textContent==='24');
 assert.match(await temperature.innerText(),/^Temperature/i);assert.match(await temperature.innerText(),/target setpoint/i);
 await page.getByRole('button',{name:/View details/}).click();
 assert.match(await page.locator('.sensor-detail-list').innerText(),/600 RPM[\s\S]*High/);
 target=26;version++;
 await page.waitForFunction(()=>document.querySelector('.sensor-metric.temperature strong span')?.textContent==='26',null,{timeout:7000});
 assert.match(await page.locator('.sensor-detail-list').innerText(),/Temperature\s+26 °C/);
 assert.match(await page.locator('.sensor-detail-list').innerText(),/Unknown/,'Setpoint does not confirm power');
 results.push('Telemetry target updates automatically, including open details; unknown power preserved');
 await page.locator('#sensorDialogClose').click();
 for(const [setting,measured] of [['auto',600],['low',300],['medium',900],['high',1200]]){
  fan=setting;rpm=measured;version++;
  await page.locator('#sensorRefresh').click();await page.waitForFunction(()=>!document.getElementById('sensorRefresh').disabled);
  const reading=await page.locator('.sensor-metric.rotation').innerText();
  assert.match(reading,new RegExp(setting,'i'));assert.match(reading,new RegExp(measured+' RPM'));assert.doesNotMatch(reading,/RPM.*%/);
 }
 rpm=600;fan='high';
 results.push('Telemetry and details follow measured RPM across Auto/Low/Medium/High; Analytics uses actual RPM and displays recorded Dry mode');

 for(const width of [1460,390])for(const dark of [false,true]){await page.setViewportSize({width,height:1000});await page.evaluate(dark=>document.documentElement.classList.toggle('dark',dark),dark);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:path.join(out,`telemetry-${width}-${dark?'dark':'light'}.png`),fullPage:true});}
 await page.goto(site+'/sensor-logs.html');await page.waitForFunction(()=>!document.getElementById('sensorRefresh').disabled);
 assert.equal(await page.getByRole('columnheader',{name:'Temperature (°C)',exact:true}).count(),1);
 assert.equal(await page.locator('#sensorLogTable tbody tr td').nth(7).innerText(),'26');
 assert.equal(await page.getByRole('columnheader',{name:'Blower Fan Speed',exact:true}).count(),1);
 assert.equal(await page.locator('#sensorLogTable tbody tr td').nth(8).innerText(),'HIGH');
 assert.doesNotMatch(await page.locator('#sensorLogTable').innerText(),/RPM/);
 await page.locator('#sensorLogTable').scrollIntoViewIfNeeded();
 await page.locator('#sensorLogTable th').nth(8).scrollIntoViewIfNeeded();
 await page.locator('#sensorLogTable').screenshot({path:path.join(out,'forecast-blower-fan-column.png')});
 assert.match(await page.locator('#energyTrendSubtitle').innerText(),/recorded intervals|setpoint/i);
 await page.locator('#openTopConsumersModalBtn').click();await page.waitForFunction(()=>document.querySelector('#sensorDialog')?.textContent.includes('0.010'));
 assert.doesNotMatch(await page.locator('#sensorDialog').innerText(),/5 minutes|five minutes/i);
 await page.screenshot({path:path.join(out,'one-minute-rankings.png'),fullPage:true});
 await page.keyboard.press('Escape');
 for(const [selector,filename] of [['#headerExportPdfBtn','sensor-logs.pdf'],['#headerExportExcelBtn','sensor-logs.xlsx']]){
   const downloaded=page.waitForEvent('download',{timeout:30000});
   await page.locator(selector).click();
   const download=await downloaded;assert.equal(download.suggestedFilename(),filename);
   assert.equal(await download.failure(),null);await download.saveAs(path.join(out,filename));
   await page.waitForFunction(()=>!document.querySelector('#headerExportPdfBtn').disabled);
 }
 results.push('Actual PDF and Excel toolbar buttons download files; Analytics/Telemetry badges removed; AC Monitoring sidebar label retained');
 missing=true;version++;
 await page.locator('#sensorRefresh').click();
 await page.waitForFunction(()=>document.querySelector('#sensorLogTable tbody tr td:nth-child(8)')?.textContent==='—',null,{timeout:7500});
 assert.equal(await page.locator('#kpiEnergyVal').innerText(),'—');
 await page.locator('#openTopConsumersModalBtn').click();await page.waitForFunction(()=>document.querySelector('#sensorDialog')?.textContent.includes('one minute'));
 assert.doesNotMatch(await page.locator('#sensorDialog').innerText(),/5 minutes|five minutes/i);
 results.push('Forecast and historical Temperature column use target source; one-minute readiness and automatic unavailable update');
 await page.screenshot({path:path.join(out,'one-minute-unavailable.png'),fullPage:true});
 assert.deepEqual(errors,[],'No renderer runtime errors');
 console.log(JSON.stringify({passed:results},null,2));fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify({passed:results,errors},null,2));await context.close();
})().catch(error=>{console.error(error.stack);process.exitCode=1;}).finally(async()=>{await browser?.close();if(server)await new Promise(r=>server.close(r));});
