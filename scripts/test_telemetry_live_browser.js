'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.ECOTRACK_PLAYWRIGHT || 'playwright');
const root=process.env.ECOTRACK_DESKTOP_ROOT || path.resolve(__dirname,'..'),out=process.env.ECOTRACK_UX_OUT || path.join(require('node:os').tmpdir(),'ecotrack-telemetry-attention');let server,browser;
fs.mkdirSync(out,{recursive:true});
(async()=>{
server=http.createServer((req,res)=>{const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname),base=name.startsWith('/assets/')?root:path.join(root,'public'),file=path.resolve(base,'.'+name);if(!file.startsWith(base+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'})[path.extname(file)]||'application/octet-stream');fs.createReadStream(process.env.ECOTRACK_DESKTOP_OVERLAY && !process.argv.includes('--baseline') && fs.existsSync(path.join(process.env.ECOTRACK_DESKTOP_OVERLAY,path.relative(root,file))) ? path.join(process.env.ECOTRACK_DESKTOP_OVERLAY,path.relative(root,file)) : file).pipe(res);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const site='http://127.0.0.1:'+server.address().port;console.log('SERVER '+server.address().port+' PID '+process.pid);
browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const rooms=[{id:'r',name:'Room 1',floor_id:'f'},{id:'r2',name:'Room 2',floor_id:'f'}],floors=[{id:'f',name:'Floor 1',building_id:'b'}],buildings=[{id:'b',name:'IC building'}];
const sensorId='11111111-1111-4111-8111-111111111111',nodes=[{id:'controller',name:'AC Controller 1',room_id:'r',device_mode:'controller',wake_time:'05:00',sleep_time:'05:00',interval_val:5,interval_unit:'Seconds'},{id:'sensor',name:'AC Sensor 1',room_id:'r',device_mode:'monitoring',monitor_aircon_id:'ac',monitoring_id:sensorId},{id:'combined',name:'AC Both 1',room_id:'r',device_mode:'both',monitor_aircon_id:'ac-both',wake_time:'05:00',sleep_time:'05:00',interval_val:1,interval_unit:'Minutes',sensor_config:{temperature_sensor:'MCP9808',pressure_sensor:'MPX5010DP',pressure_min_pa:0,pressure_max_pa:10000}}];
const aircons=[{id:'ac',asset_tag:'AC-FIXTURE',name:'Matrix',controller_node_id:'controller',node_id:'controller',aircon_type:'Split Type (Inverter)'},{id:'ac-both',asset_tag:'AC-BOTH-FIXTURE',name:'Both Aircon',controller_node_id:'combined',node_id:'combined',aircon_type:'Window'}],staff=[{id:'staff',name:'Fixture Technician',role:'technician',status:'Online',room_id:'r'}],hardware=nodes.map(node=>({node_id:node.id,device_id:'esp32s3-001122334455',last_seen:new Date().toISOString()}));
const sensor={id:sensorId,name:'AC Sensor 1',active:true,aircon_id:'ac',aircon_name:'Matrix',aircon_type:'Split Type (Inverter)',location:'IC building · Floor 1 · Room 1',sensor_schedule:{wake_time:'22:00',sleep_time:'06:00',interval_seconds:120},fresh:true,status:'Fresh',expected_interval_seconds:120,cloud_node_id:'sensor',latest:{control_snapshot:{desired_state:{temp:24},commanded_at:new Date().toISOString()},outlet_temperature_c:18,differential_pressure_pa:40,rotation_rpm:1200,rotation_quality:'ok',operating_mode:'cool',battery_voltage:3.8,rssi_dbm:-61,observed_at:new Date().toISOString(),ac_on:null}};
const summary=[];let failing=false, rangeFault=false;
const ctx=await browser.newContext({viewport:{width:1460,height:1000}});
 await require('./helpers/browser-local-api').installLocalApiBridge(ctx,{backendUrl:site,routeFixtures:true});
await ctx.route('**/*',async route=>{const url=route.request().url();if(url.startsWith(site+'/api/monitoring/devices'))return failing?route.fulfill({status:503,json:{error:'Backend unavailable'}}):route.fulfill({json:{items:[rangeFault ? {...sensor,latest:{...sensor.latest,temperature_quality:'out_of_range',outlet_temperature_c:null}} : sensor],sync:{enabled:false}}});if(url.startsWith(site+'/api/'))return route.fulfill({json:{items:[],success:true}});if(url.startsWith(site+'/'))return route.continue();if(url.startsWith('https://cdn.tailwindcss.com'))return route.fulfill({path:path.join(root,'public/vendor/tailwindcss.js'),contentType:'text/javascript'});if(url.startsWith('https://offline-fixture.invalid/rest/v1/')){const name=new URL(url).pathname.split('/').pop();return route.fulfill({json:({nodes,aircons,rooms,floors,buildings,staff,ecotrack_device_state:hardware,maintenance_reports:[]})[name]||[]});}return route.abort();});
await ctx.routeWebSocket(/.*/,socket=>socket.close());await ctx.exposeBinding('fixtureInvoke',(_,channel)=>Promise.resolve(channel==='monitoring-sync-registry'?{success:true}:channel==='scheduler-fetch-data'?{success:true,nodes,aircons,rooms,floors,buildings}:channel==='staff-fetch-all'?{success:true,data:staff}:['notifications-fetch-all','maintenance-fetch-reports'].includes(channel)?{success:true,data:[]}:{success:false,error:'Isolated fixture'}));
await ctx.addInitScript(({site,staff,nodes,aircons})=>{localStorage.setItem('ecoTrack_nodes',JSON.stringify(nodes.map(n=>({...n,node_id:n.id,db_id:n.id,status:'Offline'}))));localStorage.setItem('ecoTrack_aircons',JSON.stringify(aircons.map(ac=>({...ac,aircon_id:ac.id,device_id:ac.asset_tag}))));localStorage.setItem('ecoTrack_workspace_mode','both');localStorage.setItem('ecoTrackTheme',localStorage.getItem('__ux_test_theme') || 'dark');localStorage.setItem('ecoTrack_backend_url',site);localStorage.setItem('ecoTrack_supabase_url','https://offline-fixture.invalid');localStorage.setItem('ecoTrack_supabase_anon_key','sb_publishable_isolated_fixture');localStorage.setItem('ecoTrack_staff',JSON.stringify(staff));window.electron={env:{BACKEND_URL:site},invoke:(channel,input)=>window.fixtureInvoke(channel,input),on(){}};},{site,staff,nodes,aircons});
const page=await ctx.newPage();page.on('pageerror',e=>summary.push({runtimeError:e.message}));
const record=async(name)=>{await page.screenshot({path:path.join(out,name+'.png'),fullPage:true});summary.push({name,url:page.url(),text:await page.locator('body').innerText(),layout:await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,innerScroll:[...document.querySelectorAll('*')].filter(x=>x.clientHeight>80&&x.scrollHeight>x.clientHeight+5&&['auto','scroll'].includes(getComputedStyle(x).overflowY)).map(x=>({id:x.id,cls:x.className,scroll:x.scrollHeight,client:x.clientHeight})).slice(0,20)}))});};


let connected=true,deviceReads=0,lastHeartbeat=new Date().toISOString();
await ctx.addInitScript(()=>{const NativeDate=Date;window.fixtureClockOffset=0;window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[NativeDate.now()+window.fixtureClockOffset]));}static now(){return NativeDate.now()+window.fixtureClockOffset;}};});
await ctx.route(site+'/api/monitoring/devices*',route=>{
 deviceReads++;
 return failing?route.fulfill({status:503,json:{error:'Backend unavailable'}}):route.fulfill({json:{items:[sensor],sync:{enabled:false}}});
});
await ctx.route('https://offline-fixture.invalid/rest/v1/ecotrack_device_state*',route=>route.fulfill({json:hardware.map(row=>({...row,last_seen:connected?(lastHeartbeat=new Date().toISOString()):lastHeartbeat}))}));
await page.goto(site+'/telemetry.html');
await page.waitForFunction(()=>document.querySelectorAll('.sensor-telemetry-card').length===3 && !document.querySelector('#sensorRefresh').disabled);
const card=page.locator('.sensor-telemetry-card').filter({has:page.getByRole('heading',{name:'AC Sensor 1',exact:true})});
await page.screenshot({path:path.join(out,process.argv.includes('--baseline')?'telemetry-before.png':'telemetry-initial.png'),fullPage:true});
assert.equal(await page.locator('[data-fleet-filter]').count(),0,'Remove both fleet filter buttons');
assert.equal(await card.locator('.temperature strong span').innerText(), '24');
const readsBefore=deviceReads;
sensor.latest={...sensor.latest,outlet_temperature_c:21.5,control_snapshot:{desired_state:{temp:26},commanded_at:new Date().toISOString()},observed_at:new Date().toISOString()};sensor.status='Reporting';
await page.waitForFunction(()=>[...document.querySelectorAll('.sensor-telemetry-card')].some(e=>e.textContent.includes('AC Sensor 1')&&e.querySelector('.temperature strong span')?.textContent === '26'),null,{timeout:6000});
assert(deviceReads>readsBefore,'The polling cycle must fetch new observations without Refresh');
connected=false;await page.evaluate(()=>window.fixtureClockOffset=600000);sensor.fresh=false;sensor.status='Stale';sensor.latest.observed_at=new Date(Date.now()-600000).toISOString();
await page.waitForFunction(()=>[...document.querySelectorAll('.sensor-telemetry-card')].some(e=>e.textContent.includes('AC Sensor 1')&&e.textContent.includes('Last recorded')&&e.textContent.includes('Offline')),null,{timeout:16000}).catch(async error=>{throw new Error(error.message+'; card='+await card.innerText());});
assert.equal(await card.locator('.temperature strong span').innerText(), '26');
assert(!(await card.locator('.temperature').innerText()).includes('Unavailable'));
await page.screenshot({path:path.join(out,'telemetry-offline-last-reading.png'),fullPage:true});
connected=true;await page.evaluate(()=>window.fixtureClockOffset=0);sensor.fresh=true;sensor.status='Reporting';sensor.latest={...sensor.latest,outlet_temperature_c:23.125,control_snapshot:{desired_state:{temp:23},commanded_at:new Date().toISOString()},observed_at:new Date().toISOString()};
await page.waitForFunction(()=>[...document.querySelectorAll('.sensor-telemetry-card')].some(e=>e.textContent.includes('AC Sensor 1')&&e.textContent.includes('Connected')&&e.querySelector('.temperature strong span')?.textContent === '23'&&!e.querySelector('.temperature').textContent.includes('Last recorded')),null,{timeout:16000});
for(const width of [1460,390]) for(const theme of ['dark','light']) {
 await page.setViewportSize({width,height:1000});
 await page.evaluate(theme=>{localStorage.setItem('ecoTrackTheme',theme);document.documentElement.classList.toggle('dark',theme==='dark');window.dispatchEvent(new Event('theme:changed'));},theme);
 await page.waitForTimeout(200);
 assert.equal(await page.locator('[data-fleet-filter]').count(),0);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:path.join(out,`telemetry-live-${width}-${theme}.png`),fullPage:true});
}
console.log('PASS telemetry: no filter buttons; automatic temperature updates; offline last readings; recovery; dark/light at desktop/mobile widths.');
await ctx.close();
})().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(async()=>{await browser?.close();await new Promise(r=>server?server.close(r):r());console.log('SERVER CLOSED');});
