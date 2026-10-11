// Isolated Chromium production-component checks; no account or network.
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'reports/controller-workflow');
app.setPath('userData',path.join(root,'scratch/controller-workflow-electron'));app.disableHardwareAcceleration();app.on('window-all-closed',()=>{});
const read=file=>fs.readFileSync(path.join(root,file),'utf8'),html=read('public/nodes.html'),control=read('public/control.html');
const section=(source,start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert(a>=0&&b>a,start);return source.slice(a,b);};
const form=id=>html.match(new RegExp('<form\\b[^>]*id="'+id+'"[^>]*>[\\s\\S]*?</form>'))[0];
const buttons=['masterPowerBtn','tempMinusBtn','tempPlusBtn','modeButton','fanButton','specialButton','remoteSim'];
async function check(theme){
 const win=new BrowserWindow({width:950,height:1000,show:false,webPreferences:{offscreen:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,partition:'controller-workflow-qa'}});
 win.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,done)=>done({cancel:true}));
 const markup='<!doctype html><html class="'+(theme==='dark'?'dark':'')+'"><head><meta charset="utf-8"><style>'+read('public/styles.css')+'</style><style>.hidden{display:none!important}.qa{padding:24px;margin:auto;max-width:730px;}input,select{padding:8px;max-width:100%}#editNodeModal{margin-top:30px;border-top:1px solid #aaa;}#nodeStep3>div{margin-bottom:12px;}</style></head><body class="app-shell"><main class="qa"><div id="nodeModal">'+form('nodeForm')+'</div><div id="editNodeModal">'+form('editNodeForm')+'<button id="saveEditNodeBtn">Save</button></div><p id="hardwareRoleMessage"></p>'+buttons.map(id=>'<button id="'+id+'"'+(id==='remoteSim'?' class="sim-btn" data-cmd="POWER"':'')+'>fixture command</button>').join('')+'</main></body></html>';
 await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(markup));
 const startup=[
 read('public/js/controller-locations.js'),read('public/js/aircon-state.js'),
 "let currentModalStep=3,selectedBleDevice={nodeId:'esp32s3-fixture',info:{device_id:'esp32s3-fixture'}},wifiConfirmedFor='Fixture network';",
 "function renderBrandChips(){} function updateConfigSummary(){} const form=document.getElementById('nodeForm');",
 section(html,'      const remoteCapture = {','      let nodeCurrentPage = 1;'),
 section(html,'      // Connection diagnostics and existing Wi-Fi reuse.','      async function scanForBleDevices()'),
 section(html,'      // Enter in a text field',"      form.addEventListener('submit',"),
 "document.getElementById('nodeStep1').classList.add('hidden');document.getElementById('nodeStep2').classList.add('hidden');document.getElementById('nodeStep3').classList.remove('hidden');document.getElementById('saveNodeBtn').classList.remove('hidden');",
 "document.getElementById('nodeFormId').value='esp32s3-fixture';document.getElementById('nodeFormName').value='Fixture receiver';document.getElementById('nodeFormIp').value='10.0.0.4';document.getElementById('nodeFormSsid').value='Fixture network';",
 "existingWifiInfo={device_id:'esp32s3-fixture',wifi_status:'connected',wifi_ssid:'Fixture network',ip_address:'10.0.0.4',cloud_status:'error'};refreshExistingWifiPanel();",
 "const cache={buildings:[{id:'b1',name:'East'},{id:'b2',name:'West'}],floors:[{id:'f1',name:'Ground',building_id:'b1'},{id:'f2',name:'Ground',building_id:'b2'}],rooms:[{id:'r1',name:'Lab',floor_id:'f1'},{id:'r2',name:'Lab',floor_id:'f2'}]};",
 "EcoTrackControllerLocations.bind('nodeForm',cache);EcoTrackControllerLocations.bind('editNode',cache,{room_id:'r2'});document.getElementById('editNodeName').value='Fixture edited receiver';resetRemoteDetection('register');true;"
 ].join('\n');
 await win.webContents.executeJavaScript(startup);
 const results=await win.webContents.executeJavaScript(`(async()=>{
 const checks=[];function check(value,message){if(!value)throw Error(message);checks.push(message);}
 const get=id=>document.getElementById(id),change=(id,value)=>{get(id).value=value;get(id).dispatchEvent(new Event('change',{bubbles:true}));};
 check(get('editNodeBuilding').value==='b2'&&get('editNodeFloor').value==='f2'&&get('editNodeRoom').value==='r2','Edit restores actual ancestors with repeated location names');
 change('nodeFormBuilding','b1');check([...get('nodeFormFloor').options].some(o=>o.value==='f1')&&![...get('nodeFormFloor').options].some(o=>o.value==='f2'),'Floors are restricted to the selected building');
 change('nodeFormFloor','f1');change('nodeFormRoom','r1');change('nodeFormBuilding','b2');
 check(get('nodeFormFloor').value===''&&get('nodeFormRoom').value==='','Changing buildings clears incompatible descendants');
 change('nodeFormFloor','f2');change('nodeFormRoom','r2');check(EcoTrackControllerLocations.selection('nodeForm',cache).Room.id==='r2','Complete location validates');
 change('nodeFormRoom','custom');let invalid=false;try{EcoTrackControllerLocations.selection('nodeForm',cache);}catch(error){invalid=/Enter a name/.test(error.message);}
 check(invalid,'Blank custom room fails before writes');get('nodeFormCustomRoom').value='New room';
 const writes=[];const client={from(table){let payload,id;const q={select(){return q;},eq(_k,value){id=value;return q;},insert(rows){payload=rows[0];return q;},async maybeSingle(){return {data:cache[table].find(row=>row.id===id),error:null};},async single(){if('id' in payload)throw Error('Client generated ID');writes.push({table,payload});return {data:{id:'server-room',...payload},error:null};}};return q;}};
 const deployment=await EcoTrackControllerLocations.resolve('nodeForm',cache,client);
 check(deployment.room_id==='server-room'&&writes[0].payload.floor_id==='f2','Custom room uses its server ID and correct parent');
 get('registrationWifiPassword').value='fixture-password';check(form.checkValidity(),'Step 3 native validation accepts recovery password and optional brand');
 check(get('editNodeForm').checkValidity(),'Edit native validation accepts optional brand');
 check(!get('editNodeStatus')&&get('editNodeIp').readOnly,'Status absent; hardware IP read-only');
 const event=new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});get('registrationWifiPassword').dispatchEvent(event);check(event.defaultPrevented,'Password Enter cannot submit registration');
 check(!get('registerRemoteBtn').disabled,'Bluetooth detection enabled before registration');
 let request;window.ProtocolAdapter={detectRemoteBrand:async(id,options)=>{request=options;options.onListening();return {success:true,brand:'Daikin',protocol:'DAIKIN64'};}};
 await listenForRemote('register');check(request.nearby===true&&get('nodeFormBrand').value==='Daikin'&&!get('registerRemoteBtn').disabled,'Detection result updates brand and releases buttons');
 return checks;
 })()`);
 const capabilityCode=[
 "const masterPowerBtn=document.getElementById('masterPowerBtn'),tempMinusBtn=document.getElementById('tempMinusBtn'),tempPlusBtn=document.getElementById('tempPlusBtn');",
 "const modeButtonsGroup={querySelectorAll:()=>[document.getElementById('modeButton')]},fanButtonsGroup={querySelectorAll:()=>[document.getElementById('fanButton')]},specialButtonsGroup={querySelectorAll:()=>[document.getElementById('specialButton')]};",
 "let transmitter=false;const NodeService={getNode:()=>({capabilities:{ir_receiver:true,get ir_transmitter(){return transmitter;}}})};",
 section(control,'      function enforceControllerCapabilities(device)','      async function executeCommand('),
 "enforceControllerCapabilities({node_id:'fixture'});true;"
 ].join('\n');
 await win.webContents.executeJavaScript(capabilityCode);
 const blocked=await win.webContents.executeJavaScript('('+JSON.stringify(buttons)+').map(id=>document.getElementById(id).disabled)');
 assert(blocked.every(Boolean));results.push('Every AC command button including simulated remote requires a transmitter');
 await win.webContents.executeJavaScript("transmitter=true;enforceControllerCapabilities({node_id:'fixture'});true;");
 assert.equal(await win.webContents.executeJavaScript("document.getElementById('remoteSim').disabled"),false);results.push('Transmitter capability restores power control');
 await win.webContents.executeJavaScript("document.getElementById('editNodeModal').classList.add('hidden');new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));");
 const shot=await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});fs.writeFileSync(path.join(out,'registration-'+theme+'.png'),shot.toPNG());
 win.destroy();return {theme,checks:results};
}
app.whenReady().then(async()=>{fs.mkdirSync(out,{recursive:true});try{const results=[await check('light'),await check('dark')];fs.writeFileSync(path.join(out,'native-ui-tests.json'),JSON.stringify({passed:results.reduce((n,r)=>n+r.checks.length,0),isolated_production_components:true,live_hardware_tested:false,results},null,2));app.exit(0);}catch(error){fs.writeFileSync(path.join(out,'native-ui-failure.txt'),error.stack);app.exit(1);}});
