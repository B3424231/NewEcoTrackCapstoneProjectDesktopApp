const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'reports/multi-brand-capabilities'),read=f=>fs.readFileSync(path.join(root,f),'utf8'),html=read('public/control.html');
app.setPath('userData',path.join(root,'scratch/multi-brand-controls-electron'));app.disableHardwareAcceleration();app.on('window-all-closed',()=>{});
function section(a,b){const start=html.indexOf(a),end=html.indexOf(b,start);assert(start>=0&&end>start);return html.slice(start,end);}
app.whenReady().then(async()=>{
 const markup=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'').replace('</head>','<style>'+read('public/styles.css')+'</style></head>');
 const file=path.join(root,'scratch/multi-brand-controls-fixture.html');fs.writeFileSync(file,markup);
 const win=new BrowserWindow({width:1400,height:1000,show:false,webPreferences:{offscreen:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 const errors=[];win.webContents.on('console-message',e=>{if(e.level==='error'&&!e.message.includes('Content Security Policy')){errors.push(e.message);console.error('Renderer: '+e.message);}});
 win.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,cb)=>cb({cancel:true}));await win.loadFile(file);
 if(fs.existsSync(path.join(root,'scratch/step3-qa-tailwind.js')))await win.webContents.executeJavaScript(read('scratch/step3-qa-tailwind.js')+"\nwindow.tailwind.config={darkMode:'class'};true;");
 await win.webContents.executeJavaScript(`
 localStorage.clear();window.fixtureReads=0;window.fixtureWrites=[];
 window.dbFixture={aircons:[{id:'ac-ui',asset_tag:'AC-UI',name:'Matrix',brand:'Matrix',protocol_name:'TCL112AC',node_id:'node-ui',controller_node_id:'node-ui',model:'Split Type (Inverter)'}],nodes:[{id:'node-ui',name:'ESP32 UI',room_id:null}],rooms:[],floors:[],buildings:[]};
 window.hardwareFixture=[{node_id:'node-ui',device_id:'esp32s3-001122334455',last_seen:new Date().toISOString(),capabilities:{ir_receiver:true,ir_transmitter:true},connection_status:'online',latest_ir:{protocol:'TCL112AC',raw_count:227,frame_kind:'full_state',sequence:1,received_at:new Date().toISOString(),state:{power:true,temp:24.5,mode:'cool',fan:'high',turbo:false,source:'ir_receiver'}}}];
 window.supabaseClient={from(table){fixtureReads++;let key,value;const q={select(){return q},order(){return q},eq(k,v){key=k;value=v;return q},async maybeSingle(){return {data:dbFixture[table].find(r=>!key||r[key]===value),error:null}},then(a,b){return Promise.resolve({data:dbFixture[table]||[],error:null}).then(a,b)}};return q;}};
 window.EcoTrackHardwareCloud={listStatus:async()=>structuredClone(hardwareFixture),describe:()=> 'online',control:async(_node,payload)=>{fixtureWrites.push(structuredClone(payload));return {command_id:'fixture-queued',commanded_at:new Date().toISOString()};}};
 `+read('public/js/aircon-system.js')+read('public/js/ac-capability-verification.js')+`
 const {AirconProfileManager,CapabilityEngine,CommandManager,NodeService}=EcoTrackAirconSystem;let activeDeviceId='AC-UI';
 function executeCommand(command,value){window.pendingCommand=CommandManager.dispatch({device_id:activeDeviceId,command,value});return pendingCommand;}
 `+section('      // Dynamic Aircon Dropdown Elements','      // Centralized Control Layout Mode Manager')+
 section('      function renderControlPanel()','      // Pending command tracking')+
 section('      function enforceControllerCapabilities(device)','      async function executeCommand(')+
 section('      // Temperature Clickers','      // Remote Layout Buttons')+'\ntrue;');
 await win.webContents.executeJavaScript("(async()=>{await EcoTrackAirconSystem.syncWithDatabase();const end=Date.now()+5000;while(!AirconProfileManager.getById('AC-UI')){if(Date.now()>end)throw Error('Fixture sync failed');await new Promise(r=>setTimeout(r,20));}renderControlPanel();return true;})()");
 const checks=[];
 let result=await win.webContents.executeJavaScript("({name:unitNameEl.textContent,range:tempRangeHelp.textContent,temp:tempValueDisplay.textContent,fans:[...fanButtonsGroup.children].map(b=>b.textContent),hasHelp:!!document.querySelector('.ac-capability-summary'),canAdjust:!tempPlusBtn.disabled})");
 assert.equal(result.name,'Matrix');assert(result.range.includes('16Â°C')&&result.range.includes('31Â°C')&&result.range.includes('0.5Â°C')&&result.range.includes('unverified'));
 assert.equal(result.temp,'24.5');assert(result.hasHelp&&result.canAdjust&&!result.fans.includes('turbo'));
 await win.webContents.executeJavaScript("tempPlusBtn.click();pendingCommand.then(()=>renderControlPanel());true;");
 await win.webContents.executeJavaScript("pendingCommand");
 result=await win.webContents.executeJavaScript('fixtureWrites.at(-1)');
 assert.equal(result.state.temp,25);assert.equal(result.requested_feature,'TEMP');
 checks.push('Production Control panel preserves custom manufacturer/name, labels unverified features and sends actual half-degree increments.');
 await win.webContents.executeJavaScript(`(async()=>{hardwareFixture[0].last_seen=new Date(Date.now()+2000).toISOString();hardwareFixture[0].latest_ir={protocol:'FUJITSU_AC',remote_model:3,raw_count:260,frame_kind:'full_state',sequence:2,received_at:new Date(Date.now()+2000).toISOString(),state:{power:true,temp:24.25,mode:'cool',fan:'low',turbo:false,source:'ir_receiver'}};await EcoTrackAirconSystem.syncWithDatabase();renderControlPanel();return true;})()`);
 result=await win.webContents.executeJavaScript("({range:tempRangeHelp.textContent,temp:tempValueDisplay.textContent,turbo:[...specialButtonsGroup.children].some(b=>b.textContent==='Turbo'),fans:[...fanButtonsGroup.children].map(b=>b.textContent)})");
 assert(result.range.includes('0.25Â°C'));assert.equal(result.temp,'24.25');assert(result.turbo&&result.fans.includes('quiet'));
 checks.push('Detected exact Fujitsu model changes the existing panel to quarter-degree steps and model-specific functions without reloading.');
 await win.webContents.executeJavaScript(`(async()=>{hardwareFixture[0].last_seen=new Date(Date.now()+3000).toISOString();hardwareFixture[0].latest_ir={...hardwareFixture[0].latest_ir,protocol:'DAIKIN2',remote_model:null,sequence:3,received_at:new Date(Date.now()+3000).toISOString(),state:{power:true,temp:20,mode:'fan',fan:'low',source:'ir_receiver'}};await EcoTrackAirconSystem.syncWithDatabase();renderControlPanel();return true;})()`);
 result=await win.webContents.executeJavaScript("({disabled:tempPlusBtn.disabled&&tempMinusBtn.disabled,modes:[...modeButtonsGroup.children].map(b=>b.textContent),preset:[...document.querySelectorAll('.rem-preset-btn')].map(b=>b.dataset.temp)})");
 assert(result.disabled);assert(result.modes.includes('cool'));assert.equal(result.preset[0],'18');
 checks.push('Fan mode disables temperature adjustments; Cool presets use their own minimum and display their actual setpoints.');
 await win.webContents.executeJavaScript(`(async()=>{dbFixture.aircons=[{id:'unknown-unit',asset_tag:'AC-UNKNOWN',name:'Unknown unit',brand:'Custom maker',protocol_name:'UNKNOWN',node_id:'node-ui',controller_node_id:'node-ui',model:'Window'}];hardwareFixture[0].latest_ir={};activeDeviceId='AC-UNKNOWN';await EcoTrackAirconSystem.syncWithDatabase();renderControlPanel();return true;})()`);
 result=await win.webContents.executeJavaScript("({power:masterPowerBtn.disabled,temp:tempPlusBtn.disabled,modes:modeButtonsGroup.children.length,fans:fanButtonsGroup.children.length,range:tempRangeHelp.textContent,protocol:AirconProfileManager.getById('AC-UNKNOWN').protocol_name})");
 assert(result.power&&result.temp&&result.modes===0&&result.fans===0);assert.equal(result.protocol,'UNKNOWN');assert(result.range.includes('unknown'));
 checks.push('A different unknown AC on the same controller does not inherit the previous profile or fabricate controls.');
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'control-native-results.json'),JSON.stringify({passed:checks.length,checks,physical_hardware_tested:false},null,2));win.destroy();console.log('Dynamic production controls: '+checks.length+' native scenario groups passed.');app.exit(0);
}).catch(e=>{console.error(e);app.exit(1);});
