const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync((file === 'public/js/node-sync.js' && process.env.ECOTRACK_NODE_SYNC_SOURCE) || path.join(__dirname, '..', file), 'utf8');
async function main() {
  let now = Date.now();
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  let nodes = [{ id: 'node_db_1', name: 'node-1', room_id: 'room1', interval_val: 30, interval_unit: 'Seconds', temp: 25.2, rotation_rpm: 120, battery: 3.9, rssi: -61, ac_on: true, status: 'online', aircon_type: 'Split Type' }];
  const writes = []; const events = []; let failWrites = false;
  const sb = { from(table) {
    let field; let value; let update = false;
    const query = {
      select() { return query; }, not() { return query; },
      eq(f, v) { field = f; value = v; return query; }, maybeSingle() { return query; },
      update() { update = true; return query; },
      then(resolve, reject) {
        const data = update ? [] : table === 'nodes' ? (field ? nodes.find(n => n[field] === value) : nodes)
          : table === 'rooms' ? { name: 'Lab', floor_id: 'floor1' }
          : table === 'floors' ? { name: 'Floor 2', building_id: 'building1' }
          : { name: 'Science Building' };
        return Promise.resolve({ data }).then(resolve, reject);
      }
    };
    return query;
  } };
  const window = { supabaseClient: sb, dispatchEvent: event => events.push(event), addEventListener() {} };
  window.electron = {invoke:async(channel,input)=>{
    assert.equal(channel,'telemetry-admin-request');assert.equal(input.path,'/api/telemetry');
    writes.push(input.data);return {success:!failWrites,error:failWrites?'Isolated failure':undefined,data:{id:`saved_${writes.length}`}};
  }};
  const context = vm.createContext({ window, document: { readyState: 'loading', addEventListener() {} }, Date: Clock,
    console, AbortController, clearTimeout, setTimeout() {}, setInterval() {}, CustomEvent: class { constructor(type, args) { this.type = type; this.detail = args.detail; } },
    fetch: async (_, options) => {
      writes.push(JSON.parse(options.body));
      return { ok: !failWrites, status: failWrites ? 500 : 201, json: async () => ({ id: `saved_${writes.length}` }) };
    } });
  vm.runInContext(read('public/js/node-sync.js'), context);
  const flush = () => new Promise(setImmediate);
  const step = window.EcoTrackNodeSync.stepBackgroundTelemetryCadence;
  for (let n=0;n<5;n++) { await step(); await flush(); now+=30000; }
  assert.equal(writes.length, 0, 'Cached node readings cannot become new measurements on a timer');
  const save=window.EcoTrackNodeSync.saveNodeTelemetryToSqlite;
  const packet={id:'node-1',pb_id:'node_db_1',temp:25.2,rotation_rpm:120,rotation_quality:'ok',battery:3.9,rssi:-61,
    ac_on:true,status:'online',intervalVal:30,intervalUnit:'Seconds',telemetry_id:'real-1'};
  await save(packet);
  assert.equal(writes.length,1); assert.equal(writes[0].temperature,25.2);
  assert.equal(writes[0].node_id,'node_db_1'); assert.equal(writes[0].room_name,'Lab');
  assert.equal(writes[0].interval_seconds,30); assert.equal(writes[0].ac_on,true);
  assert.equal(writes[0].id,'real-1'); assert.equal(writes[0].rotation_rpm,120);assert(!Object.hasOwn(writes[0],'pressure'));
  assert.equal(events[0].type,'ecotrack:telemetry-saved');
  await save(packet); assert.equal(writes.length,1,'Burst is throttled');
  now+=1000; failWrites=true; await save({...packet,telemetry_id:'real-2'});
  assert.equal(events.length,1,'Failed persistence cannot dispatch success');
  failWrites=false; await save({...packet,telemetry_id:'real-2'});
  assert.equal(writes.length,3,'A failed save can be retried immediately');
  assert.equal(events.length,2);
  now+=1000;
  await save({...packet,ac_on:false,telemetry_id:'real-off',control_snapshot:{desired_state:{power:true}}});
  assert.equal(writes.at(-1).ac_on,false,'Selected ON must not suppress a measured OFF boundary');
  now+=1000;
  await save({...packet,ac_on:undefined,temp:undefined,rotation_rpm:undefined,telemetry_id:'real-unknown'});
  assert.equal(writes.at(-1).ac_on,undefined); assert.equal(writes.at(-1).temperature,null);
  const saved=writes.length; now+=1000;
  await save({...packet,status:'sleeping'}); assert.equal(writes.length,saved);
  nodes=[]; now+=30000; await step(); await flush(); assert.equal(writes.length,saved);

  const source = read('public/js/sensor-workspace.js'),begin=source.indexOf('  function query()'),end=source.indexOf('  function error(',begin);
  assert(begin>=0&&end>begin);
  const controls=new Map([['sensorSelect',{value:'sensor-history'}],['sensorThrough',{value:''}],['sensorTimeStart',{value:'08:00'}],['sensorTimeEnd',{value:'17:00'}]]);
  const logs=vm.createContext({Date:Clock,URLSearchParams,page:'logs',observationDate:'2000-01-02',period:'daily',$:id=>controls.get(id)});
  vm.runInContext(source.slice(begin,end),logs);
  const query=logs.query();assert.equal(query.get('from'),'2000-01-01T16:00:00.000Z');assert.equal(query.get('to'),'2000-01-02T16:00:00.000Z');
  assert.equal(query.get('node_id'),'sensor-history');assert.equal(query.get('start_time'),'08:00');assert.equal(query.get('end_time'),'17:00');
  now+=86400000;assert.equal(logs.query().toString(),query.toString(),'New readings and current time cannot move an explicitly selected historical period');
  logs.period='monthly';assert.equal(logs.query().get('from'),'1999-12-31T16:00:00.000Z');assert.equal(logs.query().get('to'),'2000-01-31T16:00:00.000Z');
  console.log('Telemetry tests passed: actual readings, OFF/unknown evidence, failed-save retry, no synthetic timer rows, and history filters.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
