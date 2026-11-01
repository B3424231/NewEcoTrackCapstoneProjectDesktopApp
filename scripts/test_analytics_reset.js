'use strict';
// Compatibility entrypoint now exercising the active sensor workspace, not the retired controller log page.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/js/sensor-workspace.js'),'utf8');
function section(start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert(a>=0&&b>a,start);return source.slice(a,b);}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
const {createRefreshHarness:harness}=require('./helpers/sensor-workspace-harness');
test('current observation queries preserve explicit empty dates, Singapore boundaries, devices and overnight clocks',()=>{
 const h=harness();h.context.observationDate='2026-10-20';h.$('sensorSelect').value='selected-device';h.$('sensorTimeStart').value='22:00';h.$('sensorTimeEnd').value='06:00';
 let q=h.context.query();assert.equal(q.get('from'),'2026-10-19T16:00:00.000Z');assert.equal(q.get('to'),'2026-10-20T16:00:00.000Z');assert.equal(q.get('node_id'),'selected-device');assert.equal(q.get('start_time'),'22:00');assert.equal(q.get('end_time'),'06:00');
 h.context.period='weekly';q=h.context.query();assert.equal(q.get('from'),'2026-10-18T16:00:00.000Z');assert.equal(q.get('to'),'2026-10-25T16:00:00.000Z');
 h.context.period='monthly';q=h.context.query();assert.equal(q.get('from'),'2026-09-30T16:00:00.000Z');assert.equal(q.get('to'),'2026-10-31T16:00:00.000Z');
});
test('an authoritative empty current response replaces old history and forecasts without falling back',async()=>{
 const h=harness();await h.context.refresh();assert.equal(h.context.history.length,1);
 h.fixture.rows={items:[],total:0};h.fixture.analytics={sample_count:0};h.fixture.energy={available:false,energy_kwh:null};
 await h.context.refresh();assert.equal(h.context.history.length,0);assert.equal(h.context.total,0);assert.equal(h.context.stats.sample_count,0);assert.equal(h.context.energy.available,false);assert.equal(h.context.available,true);assert.equal(h.context.observationDate,'2026-10-19');assert(h.requests.every(r=>r.url.startsWith('/')));
});
test('failed refresh preserves confirmed cache while a failed new selection clears derived values and recovery retains devices',async()=>{
 const h=harness();await h.context.refresh();const devices=h.context.nodes;h.fixture.fail='Fixture backend unavailable';await h.context.refresh();
 assert.equal(h.context.available,true);assert.equal(h.context.history[0].id,'old-record');assert.deepEqual(Array.from(h.context.nodes,node=>node.id),Array.from(devices,node=>node.id));assert.match(h.$('sensorConnection').textContent,/Cached data.*unavailable/);h.context.observationDate='2026-10-20';await h.context.refresh();assert.equal(h.context.available,false);assert.equal(h.context.history.length,0);assert.equal(h.context.energy,null);assert.equal(h.context.stats,null);assert.match(h.errors.at(-1),/backend unavailable/);assert.equal(h.$('sensorRefresh').disabled,false);
 h.fixture.fail=null;await h.context.refresh();assert.equal(h.context.available,true);assert.equal(h.context.history.length,1);
});
test('a replacement refresh aborts the old request and stale responses cannot overwrite the newest selection',async()=>{
 const h=harness(),hold=deferred();h.fixture.hold=hold;const first=h.context.refresh();assert.equal(h.$('sensorRefresh').disabled,true);
 h.fixture.hold=null;h.fixture.rows={items:[{id:'new-selection'}],total:1};await h.context.refresh();assert.equal(h.requests[0].signal.aborted,true);hold.resolve();await first;
 assert.equal(h.context.history[0].id,'new-selection');assert.equal(h.$('sensorRefresh').attributes['aria-busy'],'false');assert.equal(h.context.running,false);
});
test('polling coalesces while an existing refresh is pending and loading stays active through completion',async()=>{
 const h=harness(),hold=deferred();h.fixture.hold=hold;const first=h.context.refresh();await h.context.refresh({poll:true});
 assert.equal(h.requests.length,1,'Polling coalesces while the initial device read is still pending');assert.equal(h.$('sensorRefresh').disabled,true);assert.deepEqual(h.loading,['show']);hold.resolve();await first;assert.deepEqual(h.loading,['show','hide']);assert.equal(h.$('sensorRefresh').disabled,false);
});
test('cloud metadata failure preserves local recorded results and reports the failure explicitly',async()=>{
 const h=harness();h.fixture.sync={success:false,error:'Fixture metadata timeout',registry_preserved:true};await h.context.refresh();
 assert.equal(h.context.available,true);assert.equal(h.context.history[0].id,'old-record');assert.match(h.errors.at(-1),/registry sync unavailable.*metadata timeout.*Local sensor readings/i);
 assert(h.$('sensorConnection').textContent.toLowerCase().includes('registry sync unavailable'));
});
