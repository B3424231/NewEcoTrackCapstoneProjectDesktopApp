const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const prefix=fs.readFileSync('scripts/test-cloud-hardware-integration.cjs','utf8').split('\ntest(')[0];
const sandbox={require,console,exports:{}};vm.runInNewContext(prefix+';exports.harness=harness;',sandbox);
const h=sandbox.exports.harness(()=>({data:[],error:null}));
const {applyHomeControllerState,mergeHomeControllerFetch}=h.load('src/services/home-controller-state.ts');
const now=Date.parse('2026-10-11T08:00:00Z');
const item={id:'node-one',name:'Controller One',roomId:'room-one',status:'optimal',settingsSnapshot:{desired_state:{power:'on',temp:24,mode:'cool',fan:'quiet'},commanded_at:'2026-10-11T07:00:00Z'}};
const row={node_id:item.id,device_id:'esp32s3-111111111111',last_seen:'2026-10-11T08:00:00Z',latest_ir:{protocol:'TCL112AC',raw_count:227,sequence:1,captured_at_epoch_ms:now,state:{power:false,temp:16,mode:'heat',fan:'auto',swing:true,turbo:false}}};
const clean=x=>JSON.parse(JSON.stringify(x));
test('a missing staff-readable heartbeat is unavailable, never proof of offline',()=>{
 const result=applyHomeControllerState(item,null,now);
 assert.equal(result.connectionState,'unavailable');assert.equal(result.statusLabel,'Status unavailable');assert.doesNotMatch(result.airconState,/OFFLINE/);
});
test('fresh connected hardware stays online when physical remote switches AC OFF',()=>{
 const result=applyHomeControllerState(item,row,now);
 assert.equal(result.connectionState,'online');assert.equal(result.powerSetting,'off');assert.equal(result.setpoint,16);assert.equal(result.operatingMode,'heat');assert.equal(result.fanMode,'auto');
 assert.deepEqual(clean(result.specialFunctions),['Vertical swing']);assert.equal(result.serialNumber,row.device_id);
});
test('heartbeat ageing and sleep remain truthful while retaining the last AC settings',()=>{
 const current=applyHomeControllerState(item,row,now);
 assert.equal(applyHomeControllerState(current,null,now+45001).connectionState,'offline');
 assert.equal(applyHomeControllerState(current,{...row,sleeping_until:'2026-10-11T09:00:00Z'},now).connectionState,'sleeping');
 assert.equal(applyHomeControllerState(current,null,now+45001).setpoint,16);
});
test('foreign controllers and older hardware updates cannot overwrite a card',()=>{
 const current=applyHomeControllerState(item,row,now);
 assert.equal(applyHomeControllerState(current,{...row,node_id:'other'},now),current);
 assert.equal(applyHomeControllerState(current,{...row,last_seen:'2026-10-11T07:59:00Z'},now),current);
});
test('partial IR updates preserve independent fields and UNKNOWN cannot invent new state',()=>{
 const current=applyHomeControllerState(item,row,now);
 const next=applyHomeControllerState(current,{...row,last_seen:'2026-10-11T08:00:01Z',latest_ir:{...row.latest_ir,sequence:2,captured_at_epoch_ms:now+1000,state:{power:true}}},now+1000);
 assert.equal(next.powerSetting,'on');assert.equal(next.setpoint,16);assert.equal(next.operatingMode,'heat');
 const unknown=applyHomeControllerState(next,{...row,last_seen:'2026-10-11T08:00:02Z',latest_ir:{protocol:'UNKNOWN',raw_count:227,state:{power:false}}},now+2000);
 assert.equal(unknown.powerSetting,'on');
});
test('an older full fetch keeps newer receiver values but applies renamed metadata',()=>{
 const current=applyHomeControllerState(item,row,now);
 const old={...item,name:'Renamed controller',lastSeen:'2026-10-11T07:59:00Z'};
 const merged=mergeHomeControllerFetch([old],[current])[0];
 assert.equal(merged.name,'Renamed controller');assert.equal(merged.powerSetting,'off');assert.equal(merged.setpoint,16);
 assert.equal(mergeHomeControllerFetch([{...old,roomId:'new-room'}],[current])[0].lastSeen,old.lastSeen);
});
test('display labels keep connection and power independent and absent battery neutral',()=>{
 const {controllerConnection,controllerPower,batteryReading}=h.load('src/services/controller-display.ts');
 const current=applyHomeControllerState(item,row,now);
 assert.equal(controllerConnection(current).label,'Online');assert.equal(controllerPower(current),'OFF');
 assert.equal(batteryReading(undefined).text,'—');assert.equal(batteryReading('0%').text,'0%');assert.equal(batteryReading('82').text,'82%');
 assert.equal(batteryReading('Unavailable').color,'#94a3b8');
});
test('visible registration has exactly three stages while mapping existing asynchronous phases correctly',()=>{
 const ts=require('typescript'),source=fs.readFileSync('src/components/controller-registration-steps.tsx','utf8'),module={exports:{}};
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText,{module,exports:module.exports,require:()=>({})});
 for(const [phase,step] of [['find',1],['connecting',1],['wifi',2],['verifying',2],['naming',3],['success',3]]) assert.equal(module.exports.registrationStep(phase),step);
 const screen=fs.readFileSync('src/app/index.tsx','utf8');
 assert.match(screen,/controllers\.find\(item => item\.id === selectedControllerId\)/);
 assert.doesNotMatch(screen,/useState<AcControllerData \| null>/);
});
