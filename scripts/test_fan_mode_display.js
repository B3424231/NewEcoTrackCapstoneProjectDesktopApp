'use strict';
// Actual display functions, isolated readings and control snapshots; no live writes.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const html = fs.readFileSync('public/control.html', 'utf8');
const workspace = fs.readFileSync('public/js/sensor-workspace.js', 'utf8');
const now = Date.now(), at = new Date(now).toISOString();
const monitor = {db_id:'monitor',device_mode:'monitoring',monitor_aircon_id:'ac',rotation_rpm:600,rotation_quality:'ok',last_measurement_at:at,interval_val:5,interval_unit:'Seconds',sensor_config:{airflow_reference:{rpm:1200}}};
function context(nodes = [monitor]) {
  const c = {console,Date,NodeService:{getNodes:()=>nodes}}; c.window=c;
  vm.createContext(c);
  for (const file of ['public/js/aircon-state.js','public/js/airflow-pressure.js']) vm.runInContext(fs.readFileSync(file,'utf8'),c);
  return c;
}
function blower(nodes) {
  const c=context(nodes), start=html.indexOf('function measuredBlowerSpeed(');
  assert.ok(start>=0,'Control panel must resolve real LM393 measurements');
  const end=html.indexOf('function renderControlPanel()',start);
  vm.runInContext(html.slice(start,end),c);
  return c.measuredBlowerSpeed({aircon_id:'ac'});
}
test('separately linked LM393 displays calibrated percentage and actual RPM',()=>assert.equal(blower([monitor]),'50% · 600 RPM'));
test('real zero survives; RPM alone remains available without a calibration reference',()=>{
  assert.equal(blower([{...monitor,rotation_rpm:0}]),'0% · 0 RPM');
  assert.equal(blower([{...monitor,sensor_config:null}]),'600 RPM');
});
test('unbound, wrong-AC, ambiguous and invalid measurements remain unavailable',()=>{
  for (const nodes of [[],[{...monitor,monitor_aircon_id:'other'}],[monitor,{...monitor,db_id:'second'}],
    [{...monitor,rotation_rpm:null}],[{...monitor,rotation_rpm:-1}],[{...monitor,rotation_quality:'fault'}],
    [{...monitor,last_measurement_at:null}],[{...monitor,last_measurement_at:new Date(now-60000).toISOString()}],
    [{...monitor,last_measurement_at:new Date(now+10000).toISOString()}]]) assert.equal(blower(nodes),'Unavailable');
});
function desktopSetting(snapshot,sample={operating_mode:'cool',ac_on:false}) {
  const c=context(); Object.assign(c,{available:true,controlSnapshot:()=>snapshot,modeLabel:()=> 'Not reported',observedModes:{cool:'Cold',fan_only:'Fan Only',heat:'Heat',off:'Off'}});
  const start=workspace.indexOf('function modeSetting('),end=workspace.indexOf('function empty(',start);
  vm.runInContext(workspace.slice(start,end),c);
  return c.modeSetting({latest:sample,fresh:true});
}
function desktopMode(snapshot,sample) { return desktopSetting(snapshot,sample).value; }
const mobile=process.env.ECOTRACK_MOBILE_ROOT || path.resolve('..','EcoTrackAppMobileNew-master-control');
const ts=require(path.join(mobile,'node_modules/typescript'));
const loaded=new Map();
function loadMobile(file) {
  file=path.resolve(mobile,file); if(!path.extname(file))file+='.ts';
  if(loaded.has(file))return loaded.get(file).exports;
  const module={exports:{}};loaded.set(file,module);
  const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{module,exports:module.exports,require:spec=>loadMobile(path.resolve(path.dirname(file),spec)),Date,console},{filename:file});
  return module.exports;
}
const mobileDisplay=loadMobile('src/services/controller-display.ts');
for(const [platform,reading] of [['desktop',desktopMode],['mobile',(snapshot,sample)=>mobileDisplay.airconStateReading({settingsSnapshot:snapshot,operatingMode:sample?.operating_mode,powerFeedback:{value:false,observedAt:at}})]]) {
  test(platform+': Aircon state follows operation mode, independently of power feedback',()=>{
    for(const [mode,label] of [['auto','Auto'],['dry','Dry'],['cool',platform==='desktop'?'Cool':'Cold'],['fan','Fan Only'],['fan_only','Fan Only'],['heat','Heat']]) {
      assert.equal(reading({desired_state:{mode,power:false},commanded_at:at}),label);
    }
    assert.equal(reading({desired_state:{mode:'cool'},commanded_at:'2026-01-01',reported_state:{mode:'heat'},reported_at:at}),'Heat');
    assert.equal(reading({configured_state:{mode:'dry'}}),'Dry');
    assert.equal(reading(null,{operating_mode:null}),'Not reported');
  });
}
test('fan command remains Auto; measurements are separate from command values',()=>{
  assert.match(html,/executeCommand\('FAN', f\)/);
  assert.match(html,/id="blowerFanMeasurement"/);
  assert.match(html,/Blower Fan Speed/);
});

test('desktop mode source distinguishes requested, reported, configured and remote settings',()=>{
  for (const [field,timeField,source] of [['desired_state','commanded_at','requested'],['reported_state','reported_at','reported'],['configured_state',null,'configured'],['observed_remote_state','observed_remote_at','remote']]) {
    const snapshot={[field]:{mode:'cool'}};if(timeField)snapshot[timeField]=at;
    const display=desktopSetting(snapshot);
    assert.equal(display.value,'Cool');assert.equal(display.source,source);
  }
  assert.equal(desktopSetting(null,{operating_mode:null}).source,null);
});
