'use strict';
// Compatibility entrypoint migrated to current recorded sensor modes, power, charts and log values.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/js/sensor-workspace.js'),'utf8');
function section(start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert(a>=0&&b>a,start);return source.slice(a,b);}
const {createSensorHarness:harness}=require('./helpers/sensor-workspace-harness');
test('only explicit recorded mode and fresh independent power appear as confirmed on sensor cards',()=>{
 const h=harness(),sample={operating_mode:'cool',ac_on:false,outlet_temperature_c:0,rotation_rpm:0,battery_voltage:0,rssi_dbm:-61};
 const card=h.context.sensorCard({id:'fixture',name:'Fixture device',aircon_name:'Fixture AC',fresh:true,latest:sample,status:'online'});
 assert.match(card,/>Cool</);assert.match(card,/Recorded mode/);assert.match(card,/Confirmed OFF/);assert.match(card,/sensor-unavailable/,'Raw outlet temperature is not a target setpoint');assert(!card.includes('Confirmed ON'));
 assert.equal(h.api.modeLabel({desired_state:{mode:'cool'}}),'Not reported');assert(h.api.state({status:'online',desired_state:{power:true}}).includes('Not reported'));
 assert(h.api.state({ac_on:true},false).includes('No recent feedback'));
});
test('saved schedules never become measurements and stale cards show unavailable sensor values',()=>{
 const h=harness(),card=h.context.sensorCard({id:'fixture',name:'Fixture',aircon_name:'Fixture AC',fresh:false,status:'offline',latest:{operating_mode:'cool',ac_on:true,outlet_temperature_c:18},sensor_schedule:{wake_time:'05:00',sleep_time:'22:00',interval_seconds:60}});
 assert.match(card,/Not reported/);assert.match(card,/Unavailable/);assert(!card.includes('05:00'),'A saved schedule is not rendered as measured temperature or power');assert(!card.includes('>18.0<'));assert(!card.includes('Confirmed ON'));
});
test('historical table values retain recorded OFF, unknowns and real zeros without requested-state fallbacks',()=>{
 const h=harness();const values=h.context.logValues({observed_at:'2026-10-19T01:00:00Z',sensor_name:'Fixture',location:'Building · Floor · Room',ac_on:false,target_temperature_c:0,outlet_temperature_c:99,rotation_rpm:0,battery_voltage:0,rssi_dbm:0,connection_status:'offline'});
 assert.equal(values.length,12);assert.equal(values[6],'Confirmed OFF');assert.deepEqual(Array.from(values.slice(7,11)),[0,'—',0,0]);
 const missing=h.context.logValues({desired_state:{power:true,temp:21},status:'online'});assert.equal(missing[6],'Unknown');assert(missing.slice(7,11).every(value=>value==='—'));
 assert.equal(h.api.rotationValue({rotation_rpm:120,rotation_quality:'fault'}),null);
});
test('forecast blower fan speed comes from each saved control snapshot, independently of RPM',()=>{
 const h=harness();
 for(const fan of ['auto','low','medium','high','max','quiet','silent','turbo']) {
  const row={observed_at:'2026-10-19T03:00:00Z',control_snapshot:{configured_state:{fan}},rotation_rpm:600,rotation_quality:'ok'};
  assert.equal(h.context.logValues(row)[8],fan.toUpperCase());
  assert.equal(h.context.logValues({...row,rotation_rpm:null})[8],fan.toUpperCase());
 }
 assert.equal(h.context.logValues({observed_at:'2026-10-19T03:00:00Z',control_snapshot:JSON.stringify({reported_state:{fan:'low'}})})[8],'LOW');
 assert.equal(h.context.logValues({observed_at:'2026-10-19T03:00:00Z',control_snapshot:{reported_state:{fan:'high',turbo:true}}})[8],'HIGH · TURBO');
});

test('forecast fan speed keeps historical settings and leaves missing settings unavailable',()=>{
 const h=harness();
 h.context.liveAircons.set('fixture-ac',{reported_state:{fan:'high'}});
 const snapshot={configured_state:{fan:'low'},desired_state:{fan:'medium'},commanded_at:'2026-10-19T01:00:00Z',reported_state:{fan:'auto'},reported_at:'2026-10-19T02:00:00Z'};
 assert.equal(h.context.logValues({observed_at:'2026-10-19T03:00:00Z',aircon_id:'fixture-ac',control_snapshot:snapshot})[8],'AUTO');
 for(const control_snapshot of [null,undefined,'broken',{},{reported_state:{fan:'unsupported'}}]) {
  assert.equal(h.context.logValues({aircon_id:'fixture-ac',control_snapshot,rotation_rpm:600})[8],'—');
 }
});

test('historical fan excludes future controls and keeps the recorded five-second clock tolerance',()=>{
 const h=harness(),observed_at='2026-10-18T00:00:00Z';
 const snapshot={configured_state:{fan:'low'},desired_state:{fan:'high'},commanded_at:'2026-10-18T00:03:00Z'};
 assert.equal(h.context.logValues({observed_at,control_snapshot:snapshot})[8],'LOW');
 assert.equal(h.context.logValues({observed_at,control_snapshot:{...snapshot,commanded_at:'2026-10-18T00:00:05Z'}})[8],'HIGH');
 assert.equal(h.context.logValues({observed_at,control_snapshot:{...snapshot,commanded_at:'2026-10-18T00:00:06Z'}})[8],'LOW');
 assert.equal(h.context.window.EcoTrackAirconState.displaySettings(snapshot).fanLabel,'HIGH','Live controls still use their latest settings');
});

test('historical fan and Turbo follow individual remote field times',()=>{
 const h=harness(),snapshot={configured_state:{fan:'low',turbo:false},observed_remote_state:{fan:'high',turbo:true},
  observed_remote_at:'2026-10-18T00:03:00Z',observed_remote_field_at:{fan:'2026-10-18T00:03:00Z',turbo:'2026-10-17T23:59:00Z'}};
 assert.equal(h.context.logValues({observed_at:'2026-10-18T00:00:00Z',control_snapshot:snapshot})[8],'LOW · TURBO');
});

test('historical fan cannot establish recorded settings without a valid observation timestamp',()=>{
 const h=harness();
 for(const observed_at of [null,undefined,'invalid'])
  assert.equal(h.context.logValues({observed_at,control_snapshot:{configured_state:{fan:'high'}}})[8],'—');
});

test('current mode chart separates observed mode, physical ON/OFF and missing points',()=>{
 const h=harness();h.context.stats={points:[{observed_at:'2026-10-19T01:00:00Z',operating_mode:'cool',ac_on:null},{observed_at:'2026-10-19T01:01:00Z',operating_mode:'off',ac_on:0},{observed_at:'2026-10-19T01:02:00Z',operating_mode:null,ac_on:1},{observed_at:'2026-10-19T01:03:00Z',desired_state:{power:true},ac_on:null}]};
 h.context.chart('sensorStateChart','operating_mode');const datasets=h.created[0].data.datasets;
 assert.deepEqual(Array.from(datasets.map(dataset=>dataset.label)),['Cold','Dry','Auto','Fan Only','Off (reported mode)','Confirmed ON','Confirmed OFF']);
 assert.deepEqual(Array.from(datasets[0].data),[4,null,null,null]);assert.deepEqual(Array.from(datasets[5].data),[null,null,1,null]);assert.deepEqual(Array.from(datasets[6].data),[null,0,null,null]);
 assert.equal(h.$('sensorStateChartEmpty').hidden,true);
 h.context.stats={points:[]};h.context.chart('sensorStateChart','operating_mode');assert.equal(h.$('sensorStateChartEmpty').hidden,false);assert(h.created[0].updated);
});
test('temperature chart preserves real negatives and gaps and shows Celsius bounds for empty data',()=>{
 const h=harness();h.context.stats={points:[]};h.context.chart('sensorTempChart','target_temperature_c','#0ff','°C');let chart=h.created[0];
 assert.equal(chart.options.scales.y.min,0);assert.equal(chart.options.scales.y.max,40);assert.equal(h.$('sensorTempChartEmpty').hidden,false);
 h.context.stats={points:[{observed_at:'2026-10-19T01:00:00Z',target_temperature_c:-5},{observed_at:'2026-10-19T01:01:00Z',target_temperature_c:null},{observed_at:'2026-10-19T01:02:00Z',target_temperature_c:46}]};
 h.context.chart('sensorTempChart','target_temperature_c','#0ff','°C');assert.deepEqual(Array.from(chart.data.datasets[0].data),[-5,null,46]);assert.equal(chart.data.datasets[0].spanGaps,false);assert(chart.options.scales.y.min<-5&&chart.options.scales.y.max>46);
});
