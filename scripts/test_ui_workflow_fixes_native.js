'use strict';
// Production HTML and preload in native Electron. All IPC, Auth, database and API data
// below are isolated software fixtures; every HTTP/WebSocket request is blocked.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'reports/ui-workflow-fixes-20261030/native');
function fixtureData(){
 const at=new Date().toISOString();
 const buildings=[{id:'qa-building',name:'Isolated QA Building'}],floors=[{id:'qa-floor',name:'Floor 1',building_id:'qa-building'}],rooms=[{id:'qa-room',name:'QA Room',floor_id:'qa-floor'}];
 const nodes=[{id:'qa-node-both',name:'Software QA Both Device',device_mode:'both',monitoring_id:'22222222-2222-4222-8222-222222222221',monitor_aircon_id:'qa-ac-both',room_id:'qa-room',interval_val:5,interval_unit:'Seconds',wake_time:'00:00',sleep_time:'00:00',protocol_name:'DAIKIN2',brand:'Daikin',aircon_type:'Split Type',status:'online',sensor_config:{rotation_rpm:true}},
 {id:'qa-node-monitor',name:'Software QA Monitoring Device with a longer name',device_mode:'monitoring',monitoring_id:'22222222-2222-4222-8222-222222222222',monitor_aircon_id:'qa-ac-monitor',room_id:'qa-room',interval_val:5,interval_unit:'Seconds',wake_time:'00:00',sleep_time:'00:00',sensor_config:{rotation_rpm:true},status:'online'}];
 const aircons=[{id:'qa-ac-both',name:'Software QA Both AC',asset_tag:'QA-CONTROL-AC',node_id:'qa-node-both',controller_node_id:'qa-node-both',room_id:'qa-room',brand:'Daikin',model:'Split Type',aircon_type:'Split Type',protocol:'DAIKIN2',protocol_name:'DAIKIN2',capability_profile:{revision:0},desired_state:{power:'off',temp:24,mode:'cool',fan:'medium'},commanded_at:at,reported_state:null,reported_at:null,command_status:null},
 {id:'qa-ac-monitor',name:'Software QA Monitoring AC',asset_tag:'QA-MONITOR-AC',node_id:null,controller_node_id:null,room_id:'qa-room',aircon_type:'Split Type',reported_state:null,reported_at:null}];
 const hardware=nodes.map((n,i)=>({node_id:n.id,device_id:'esp32s3-00aabbcc000'+(i+1),last_seen:at,sleeping_until:null,capabilities:{ir_receiver:true,ir_transmitter:i===0},rssi:-60,latest_ir:null}));
 const monitors=nodes.map(n=>({id:n.monitoring_id,cloud_node_id:n.id,name:n.name,aircon_id:n.monitor_aircon_id,aircon_name:aircons.find(a=>a.id===n.monitor_aircon_id).name,aircon_type:'Split Type',device_mode:n.device_mode,location:'Isolated QA Building \u00b7 Floor 1 \u00b7 QA Room',active:true,fresh:false,status:'Awaiting readings',latest:null,expected_interval_seconds:5,sensor_config:{rotation_rpm:true}}));
 const staff=['Alex QA Technician','Beth QA Technician','Chris QA Technician'].map((name,i)=>({id:'qa-staff-'+i,name,email:'isolated-'+i+'@example.invalid',role:'HVAC/Aircon Technician',status:'Active',is_active:true,is_archived:false,room_id:'qa-room',assignment_scope:'room',building_name:'Isolated QA Building',floor_name:'Floor 1',room_name:'QA Room'}));
 return {nodes,aircons,buildings,floors,rooms,staff,ecotrack_device_state:hardware,monitors,ecotrack_device_commands:[],ecotrack_ir_codes:[],telemetry:[],notifications:[],rules:[],rule_nodes:[],maintenance_reports:[]};
}
function rendererFixture(initial){
 if(!location.protocol.startsWith('file'))return;
 const key='ecotrack_isolated_native_database';
 let db;try{db=JSON.parse(sessionStorage.getItem(key)||'null');}catch{}if(!db)db=initial;
 const persist=()=>sessionStorage.setItem(key,JSON.stringify(db));persist();
 if(!localStorage.getItem('ecoTrackTheme'))localStorage.setItem('ecoTrackTheme','dark');
 localStorage.setItem('ecoTrack_profile_user',JSON.stringify({id:'qa-admin',auth_user_id:'qa-auth',username:'Isolated QA Administrator',role:'admin'}));
 localStorage.removeItem('ecoTrack_require_login');
 localStorage.setItem('ecoTrack_supabase_url','https://isolated-ecotrack.invalid');localStorage.setItem('ecoTrack_supabase_anon_key','sb_publishable_isolated_native_fixture');
 localStorage.setItem('ecoTrack_backend_url','http://127.0.0.1:65530');localStorage.setItem('ecoTrack_workspace_mode','both');localStorage.setItem('ecoTrack_tariff_rate','13.24');
 const clone=value=>JSON.parse(JSON.stringify(value)),session={user:{id:'qa-auth',email:'isolated-admin@example.invalid'},access_token:'isolated-fixture-token',refresh_token:'isolated-fixture-refresh'};
 const subscriptions=[];
 const client={auth:{getSession:async()=>({data:{session},error:null}),getUser:async()=>({data:{user:session.user},error:null}),onAuthStateChange(fn){queueMicrotask(()=>fn('INITIAL_SESSION',session));return {data:{subscription:{unsubscribe(){}}}};},signOut:async()=>({error:null})},
  channel(){const q={on(type,filter,fn){subscriptions.push({type,filter,fn});return q;},subscribe(fn){queueMicrotask(()=>fn?.('SUBSCRIBED'));return q;},unsubscribe(){}};return q;},removeChannel(){},removeAllChannels(){},
  storage:{from(){return {createSignedUrl:async()=>({data:{signedUrl:''}})}}},
  from(table){let filters=[],single=false,limit=null,offset=0,sort=null;const q={select(){return q;},order(field,options){sort={field,options};return q;},eq(field,value){filters.push(row=>row[field]===value);return q;},in(field,values){filters.push(row=>values.includes(row[field]));return q;},is(field,value){filters.push(row=>(row[field]??null)===value);return q;},not(field,op,value){if(op==='is')filters.push(row=>(row[field]??null)!==value);return q;},neq(field,value){filters.push(row=>row[field]!==value);return q;},match(value){for(const [k,v]of Object.entries(value))filters.push(row=>row[k]===v);return q;},gte(){return q;},gt(){return q;},lt(){return q;},lte(){return q;},or(){return q;},limit(value){limit=value;return q;},range(a,b){offset=a;limit=b-a+1;return q;},abortSignal(){return q;},maybeSingle(){single=true;return q;},single(){single=true;return q;},
   then(resolve,reject){return Promise.resolve().then(()=>{if(table==='ecotrack_device_state')for(const row of db[table])row.last_seen=new Date().toISOString();let rows=clone(db[table]||[]).filter(row=>filters.every(fn=>fn(row)));if(sort)rows.sort((a,b)=>String(a[sort.field]||'').localeCompare(String(b[sort.field]||''))*(sort.options?.ascending===false?-1:1));const count=rows.length;if(limit!==null)rows=rows.slice(offset,offset+limit);return {data:single?(rows[0]||null):rows,error:null,count};}).then(resolve,reject);}
  };return q;},
  async rpc(name,args={}){
   if(name==='ecotrack_admin_list_staff')return {data:clone(db.staff),error:null};
   if(name==='ecotrack_cloud_rule_evaluation')return {data:true,error:null};
   if(name==='ecotrack_cloud_request'){
    const now=new Date().toISOString(),command={id:args.p_request_id||crypto.randomUUID(),node_id:args.p_node_id,kind:args.p_kind,payload:clone(args.p_payload),status:'queued',created_at:now,expires_at:new Date(Date.now()+60000).toISOString(),result:null};db.ecotrack_device_commands.push(command);
    if(command.kind==='ac_intent'){const ac=db.aircons.find(a=>a.id===command.payload.aircon_id);if(ac)Object.assign(ac,{desired_state:clone(command.payload.state),command_id:command.id,command_status:'queued',commanded_at:now});}persist();return {data:clone(command),error:null};
   }
   return {data:[],error:null};
  }
 };
 Object.defineProperty(window,'supabase',{configurable:true,get:()=>({createClient:()=>client}),set(){}});
 window.__nativeFixture={snapshot:()=>clone(db),setReceipt(valid){const command=db.ecotrack_device_commands.at(-1);if(!command)throw Error('No isolated command to acknowledge');Object.assign(command,{status:'completed',acknowledged_at:new Date().toISOString(),result:{command_id:valid?command.id:'wrong-isolated-command',success:true,delivery_status:'transmitted',aircon_id:command.payload.aircon_id,protocol:command.payload.protocol}});const ac=db.aircons.find(a=>a.id===command.payload.aircon_id);ac.command_status='transmitted';persist();return clone(command);},subscriptions};
 window.__nativeFrames=[];
 function sample(){const main=document.querySelector('main'),nav=document.getElementById('sidebarNav'),side=document.getElementById('sidebar'),header=side?.querySelector('.sidebar-header');if(main){window.__nativeFrames.push({ms:Math.round(performance.now()),ready:document.readyState,mainOpacity:Number(getComputedStyle(main).opacity),navHeight:nav?Math.round(nav.getBoundingClientRect().height):null,navFlex:nav?getComputedStyle(nav).flexGrow:null,headerHeight:header?Math.round(header.getBoundingClientRect().height):null});}if(performance.now()<1400)requestAnimationFrame(sample);}requestAnimationFrame(sample);
}
if(process.versions.electron){
 const {app,BrowserWindow,session,ipcMain}=require('electron');
 assert(process.env.ECOTRACK_QA_NATIVE_PROFILE,'Fresh isolated userData is required');app.setPath('userData',process.env.ECOTRACK_QA_NATIVE_PROFILE);app.on('window-all-closed',()=>{});
 app.whenReady().then(()=>{
  const data=fixtureData(),registry={success:true,nodes:data.nodes,aircons:data.aircons,rooms:data.rooms,floors:data.floors,buildings:data.buildings};
  const api=input=>{const url=new URL(input.path,'http://isolated.invalid');let body={items:[],total:0,points:[]};if(/\/(?:devices|changes)$/.test(url.pathname))body={items:data.monitors,version:1,generation:'qa-native',reset:true,removed:[]};else if(url.pathname.endsWith('/analytics'))body={sample_count:0,points:[],rotation_by_node:[]};else if(url.pathname.endsWith('/energy'))body={available:false,reason:'Isolated fixture contains no recorded measurement history',points:[],devices:[],workspace:'monitoring'};return {success:true,status:200,body:JSON.stringify(body),contentType:'application/json'};};
  const handlers={
   'auth-set-session':()=>({success:true}),'local-api-read':api,'monitoring-sync-registry':()=>({success:true,data:{changed:0}}),'scheduler-fetch-data':()=>registry,'locations-fetch-all':()=>registry,
   'staff-fetch-all':()=>({success:true,data:data.staff}),'maintenance-fetch-reports':()=>({success:true,data:[]}),
   'notifications-fetch-all':()=>({success:true,data:[]}), 'notifications-fetch-today':()=>({success:true,data:[]}),
   'rules-fetch-data':()=>({...registry,rules:[],ruleNodes:[],data:{complete:true,rules:[],rule_nodes:[],nodes:data.nodes,rooms:data.rooms,floors:data.floors,buildings:data.buildings,notifications:[]}}),
   'monitoring-fetch-assets':()=>({success:true,data:data.aircons})
  };
  for(const [channel,handler]of Object.entries(handlers))ipcMain.handle(channel,(_event,input)=>handler(input));
  global.__qaBlockedRequests=[];
  session.defaultSession.webRequest.onBeforeRequest((details,callback)=>{const blocked=/^(?:https?|wss?):/i.test(details.url);if(blocked)global.__qaBlockedRequests.push({url:details.url.split('?')[0],method:details.method});callback({cancel:blocked});});
  const win=new BrowserWindow({show:false,useContentSize:true,width:1460,height:1000,webPreferences:{preload:path.join(root,'src/preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:false,backgroundThrottling:false}});win.loadURL('about:blank');
 });
}else{
 const {_electron}=require(process.env.ECOTRACK_PLAYWRIGHT||'C:/Users/reygay/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
 const report={mode:'Isolated native Electron with production HTML/preload and test-only IPC/database fixtures',live_database_access:false,physical_hardware_tested:false,source_pages:[],checks:[],runtime_errors:[],screenshots:[]};let app;
 const persist=()=>{fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2));};
 const check=(name,actual)=>{report.checks.push({name,status:'PASS',actual});persist();console.log('PASS '+name);};
 const pages=[['Analytics','analytics.html'],['Telemetry','telemetry.html'],['Control Dashboard','dashboard.html'],['Aircon Control','control.html'],['Register AC Devices','nodes.html'],['AC Protocol Studio','ir-library.html'],['AC Device Scheduler','scheduler.html'],['Rules Management','rules.html'],['Notifications','Notification.html'],['Maintenance','staff.html'],['AC Energy Forecast','sensor-logs.html']];
 (async()=>{
  fs.mkdirSync(out,{recursive:true});const env={...process.env,ECOTRACK_QA_NATIVE_PROFILE:fs.mkdtempSync(path.join(os.tmpdir(),'ecotrack-native-workflow-')),BACKEND_URL:'http://127.0.0.1:65530',SUPABASE_URL:'https://isolated-ecotrack.invalid',EXPO_PUBLIC_SUPABASE_URL:'https://isolated-ecotrack.invalid',SUPABASE_KEY:'sb_publishable_isolated_native_fixture',SUPABASE_ANON_KEY:'sb_publishable_isolated_native_fixture',EXPO_PUBLIC_SUPABASE_ANON_KEY:'sb_publishable_isolated_native_fixture'};delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:[__filename,'--noerrdialogs'],cwd:root,env});const page=await app.firstWindow();await page.addInitScript(rendererFixture,fixtureData());await page.setViewportSize({width:1460,height:1000});
  page.on('pageerror',error=>{report.runtime_errors.push({file:page.url().split('/').pop(),message:error.message});persist();});page.on('dialog',async dialog=>{report.runtime_errors.push({file:page.url().split('/').pop(),dialog:dialog.message()});await dialog.dismiss();});
  async function ready(){await page.locator('main').waitFor();await page.waitForFunction(()=>document.querySelector('#sidebarNav a'));await page.waitForFunction(()=>{const button=document.getElementById('sensorRefresh');return !button||button.getAttribute('aria-busy')==='false';},{},{timeout:15000});await page.waitForTimeout(350);}
  async function go(file,card=false){
   if(page.url().startsWith('file:')&&await page.locator('#sidebarNav').count()){
    if(card){await page.locator('a[href="control.html?id=QA-CONTROL-AC"]').first().click();await page.waitForURL(/control\.html/);}
    else {await page.evaluate(file=>{const a=[...document.querySelectorAll('#sidebarNav a')].find(a=>new URL(a.href).pathname.toLowerCase().endsWith('/'+file.toLowerCase()));if(!a)throw Error('Missing actual sidebar link '+file);a.click();},file);await page.waitForURL(url=>url.pathname.toLowerCase().endsWith('/'+file.toLowerCase()));}
   }else await page.goto('file:///'+path.join(root,'public',file).replace(/\\/g,'/'));
   await ready();
  }
  async function shot(name){await page.evaluate(async()=>{for(const animation of document.getAnimations())if(animation.constructor.name==='CSSTransition')animation.finish();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});const file=name+'.png';const png=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG().toString('base64'));fs.writeFileSync(path.join(out,file),Buffer.from(png,'base64'));report.screenshots.push(file);persist();}
  async function shell(title,file){await go(file);await page.waitForTimeout(1100);const state=await page.evaluate(()=>({title:document.title,isolated:typeof require==='undefined',bridge:typeof electron.invoke,frames:window.__nativeFrames||[],links:document.querySelectorAll('#sidebarNav a').length,opacity:Number(getComputedStyle(document.querySelector('main')).opacity),navHeight:document.getElementById('sidebarNav').getBoundingClientRect().height}));assert(state.isolated);assert.equal(state.bridge,'function');assert(state.links>=11);assert.equal(state.opacity,1);assert(state.frames.length>0);assert(state.frames.every(f=>f.mainOpacity===1),title+' first content frames stay visible');assert(state.frames.filter(f=>f.navHeight!==null).every(f=>f.navHeight>40),title+' menu never collapses during navigation');await shot(file.replace('.html','')+'-dark-1460');report.source_pages.push({title,file,page_sha256:require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(root,'public',file))).digest('hex'),state});check(title+' native navigation and first frames',state);}
  if(!process.argv.includes('--visual-confirm'))for(const [title,file]of pages)await shell(title,file);
  await go('dashboard.html');await page.locator('.power-toggle-btn[data-device-id="QA-CONTROL-AC"]').waitFor();
  await page.evaluate(()=>EcoTrackAirconSystem.CentralLogService.log({module:'CONFIG',event:'PROFILE_SAVED',result:'SUCCESS',device_id:'QA-CONTROL-AC',details:'Isolated non-command success must not count as IR transmission.'}));
  await page.locator('.power-toggle-btn[data-device-id="QA-CONTROL-AC"]').click();await page.waitForFunction(()=>EcoTrackAirconSystem.AirconProfileManager.getById('QA-CONTROL-AC')?.control_snapshot?.desired_state?.power==='on');
  const queued=await page.evaluate(()=>({profile:EcoTrackAirconSystem.AirconProfileManager.getById('QA-CONTROL-AC'),logs:EcoTrackAirconSystem.CentralLogService.getCommandLogs(500),stats:EcoTrackAirconSystem.CentralLogService.getCommandStats()}));assert.equal(queued.logs.length,1);assert.equal(queued.logs[0].delivery_status,'queued');assert.equal(queued.stats.transmitted,0);check('Dashboard ON creates one queued audit entry and excludes configuration successes',queued);
  await go('control.html',true);const control=await page.evaluate(()=>({profile:EcoTrackAirconSystem.AirconProfileManager.getById('QA-CONTROL-AC'),toggle:document.getElementById('masterPowerText')?.textContent,commanded:document.getElementById('dispCommandedState')?.textContent}));assert.equal(control.profile.control_snapshot.command_id,queued.profile.control_snapshot.command_id);assert.equal(control.profile.control_snapshot.desired_state.power,'on');assert.match(control.toggle,/ON/i);check('Card Control link selects the same requested ON command',control);await shot('control-requested-on-dark-1460');
  await go('dashboard.html');const invalid=await page.evaluate(async()=>{__nativeFixture.setReceipt(false);await EcoTrackAirconSystem.CentralLogService.reconcileCommands(supabaseClient,__nativeFixture.snapshot().aircons);return {logs:EcoTrackAirconSystem.CentralLogService.getCommandLogs(500),stats:EcoTrackAirconSystem.CentralLogService.getCommandStats()};});assert.equal(invalid.stats.transmitted,0);assert.equal(invalid.logs[0].receipt_verified,false);check('Mismatched ACK cannot count as IR transmitted',invalid);
  const valid=await page.evaluate(async()=>{__nativeFixture.setReceipt(true);await EcoTrackAirconSystem.CentralLogService.reconcileCommands(supabaseClient,__nativeFixture.snapshot().aircons);return {logs:EcoTrackAirconSystem.CentralLogService.getCommandLogs(500),stats:EcoTrackAirconSystem.CentralLogService.getCommandStats()};});assert.equal(valid.logs.length,1);assert.equal(valid.logs[0].id,queued.logs[0].id);assert.equal(valid.stats.transmitted,1);assert.equal(valid.logs[0].receipt_verified,true);assert.match(valid.logs[0].details,/AC response.*unconfirmed/i);check('Matching software ACK updates the same audit entry and keeps AC response unconfirmed',valid);await page.locator('#openAuditModalBtn').click();await shot('audit-transmitted-dark-1460');await page.locator('#closeAuditModalXBtn').click();
  for(const [width,theme]of [[1460,'light'],[390,'dark'],[390,'light']]){
   await page.setViewportSize({width,height:1000});await page.evaluate(theme=>localStorage.setItem('ecoTrackTheme',theme),theme);
   for(const [title,file]of pages.filter(([_,f])=>['telemetry.html','control.html','dashboard.html','staff.html'].includes(f))){
    await page.goto('file:///'+path.join(root,'public',file).replace(/\\/g,'/'));await ready();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,title+' '+width+' no document horizontal overflow');await shot(file.replace('.html','')+'-'+theme+'-'+width);check(title+' '+theme+' '+width+' visible responsive page',await page.locator('main').boundingBox());
    if(file==='staff.html'){
     await page.evaluate(()=>EcoTrackMaintenance.openCreateModal());await page.locator('#ecoCreateReportModal').waitFor({state:'visible'});await page.locator('#modalStaffDropdownTrigger').scrollIntoViewIfNeeded();await page.locator('#modalStaffDropdownTrigger').click();await page.locator('#modalStaffDropdownMenu').waitFor({state:'visible'});const staff=await page.evaluate(()=>{const menu=document.getElementById('modalStaffDropdownMenu'),r=menu.getBoundingClientRect();return {count:menu.querySelectorAll('.custom-staff-item').length,rect:{x:r.x,y:r.y,right:r.right,bottom:r.bottom},viewport:{width:innerWidth,height:innerHeight},text:menu.innerText};});assert(staff.count>=3,'all isolated active technicians offered');assert(staff.rect.x>=0&&staff.rect.right<=width+1,'worker menu fits viewport');await shot('staff-selector-'+theme+'-'+width);check('Maintenance staff selector '+theme+' '+width,staff);await page.evaluate(()=>EcoTrackMaintenance.closeCreateModal());
    }
   }
  }
  report.blocked_external_requests=await app.evaluate(()=>global.__qaBlockedRequests);assert.deepEqual(report.runtime_errors,[]);check('No renderer runtime errors across navigation and affected workflows',[]);report.status='PASS';report.visual_confirmation=process.argv.includes('--visual-confirm');report.completed_at=new Date().toISOString();persist();console.log('NATIVE_COMPLETE '+report.checks.length+' checks PASS; all data isolated.');
 })().catch(error=>{report.status='FAIL';report.failure=error.stack;persist();console.error(error.stack);process.exitCode=1;}).finally(async()=>{await app?.close();});
}
