'use strict';
// Real renderer ingestion adapter; only its authenticated IPC/cloud boundaries are isolated.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function harness(){
  const writes=[],events=[],window={dispatchEvent:event=>events.push(event),electron:{invoke:async(channel,input)=>{
    assert.equal(channel,'telemetry-admin-request');assert.equal(input.method,'POST');
    writes.push(input.data);return {success:true,data:{id:input.data.id||'fixture-reading'}};
  }}};
  const context=vm.createContext({window,document:{readyState:'loading',addEventListener(){}},
    console:{log(){},warn(){},error(){}},AbortController,setTimeout,clearTimeout,setInterval(){},
    CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/js/node-sync.js'),'utf8'),context);
  return {save:window.EcoTrackNodeSync.saveNodeTelemetryToSqlite,writes,events};
}
const packet={id:'io-fixture-device',room_name:'Fixture room',floor_name:'Fixture floor',building_name:'Fixture building',status:'online'};
test('booleans, containers and blank text never become measured temperature, battery or RSSI',async()=>{
  for(const field of ['temp','temperature','battery','rssi'])for(const value of [true,false,[],{},'','   ']){
    const h=harness();await h.save({...packet,[field]:value});assert.equal(h.writes.length,1);
    const output=field==='temp'?'temperature':field;
    assert.equal(h.writes[0][output],null,field+' '+JSON.stringify(value));
    assert.equal(h.events[0].detail[output],null);
  }
});
test('real zero and valid numeric readings survive the adapter and event unchanged',async()=>{
  for(const value of [0,21.5,'21.5']){
    const h=harness();await h.save({...packet,temp:value,battery:value,rssi:value,rotation_rpm:value,ac_on:false});
    for(const field of ['temperature','battery','rssi','rotation_rpm'])assert.equal(h.writes[0][field],Number(value));
    assert.equal(h.writes[0].ac_on,false);
  }
});
test('invalid cadence types do not create an invented one-second interval',async()=>{
  for(const fields of [{interval_seconds:true},{intervalSeconds:true},{interval_val:true,interval_unit:'Seconds'}]){
    const h=harness();await h.save({...packet,...fields});assert(!Object.hasOwn(h.writes[0],'interval_seconds'));
  }
});
test('an original observation timestamp and correlation ID survive delayed ingestion',async()=>{
  const h=harness(),observed='2026-10-20T03:14:15.000Z';
  await h.save({...packet,telemetry_id:'io-adapter-001',observed_at:observed,temp:0});
  assert.equal(h.writes[0].observed_at,observed);assert.equal(h.writes[0].id,'io-adapter-001');
  assert.equal(h.events[0].detail.observed_at,observed);
});
test('containers cannot fabricate independent ON or OFF feedback through string conversion',async()=>{
  for(const field of ['ac_on','acOn','power_state','powerState','acState'])for(const value of [[1],[0],['on'],['off'],{},[]]){
    const h=harness();await h.save({...packet,[field]:value});
    assert(!Object.hasOwn(h.writes[0],'ac_on'),field+' '+JSON.stringify(value));
  }
});
