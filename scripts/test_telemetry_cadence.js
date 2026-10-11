const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync((file === 'public/js/node-sync.js' && process.env.ECOTRACK_NODE_SYNC_SOURCE) || (file === 'public/js/logs.js' && process.env.ECOTRACK_LOGS_SOURCE) || path.join(__dirname, '..', file), 'utf8');
async function main() {
  let now = Date.now();
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  let nodes = [{ id: 'node_db_1', name: 'node-1', room_id: 'room1', interval_val: 30, interval_unit: 'Seconds', temp: 25.2, pressure: 0.4, battery: 3.9, rssi: -61, ac_on: true, status: 'online', aircon_type: 'Split Type' }];
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
  const context = vm.createContext({ window, document: { readyState: 'loading', addEventListener() {} }, Date: Clock,
    console, setTimeout() {}, setInterval() {}, CustomEvent: class { constructor(type, args) { this.type = type; this.detail = args.detail; } },
    fetch: async (_, options) => {
      writes.push(JSON.parse(options.body));
      return { ok: !failWrites, status: failWrites ? 500 : 201, json: async () => ({ id: `saved_${writes.length}` }) };
    } });
  vm.runInContext(read('public/js/node-sync.js'), context);
  const flush = () => new Promise(setImmediate);
  const step = window.EcoTrackNodeSync.stepBackgroundTelemetryCadence;
  await step(); await flush();
  assert.equal(writes.length, 1, 'Cadence logging must work without a rule evaluator');
  assert.equal(writes[0].temperature, 25.2);
  assert.equal(writes[0].node_id, 'node_db_1');
  assert.equal(writes[0].room_name, 'Lab');
  assert.equal(writes[0].interval_seconds, 30);
  assert.equal(writes[0].ac_on, true, 'Preserve the explicit ON setting used to authorize recording');
  assert.equal(events[0].type, 'ecotrack:telemetry-saved');
  assert.equal(events[0].detail.sensor_name, 'node-1');
  now += 29000;
  await step(); await flush();
  assert.equal(writes.length, 1, 'Do not log before the 30-second interval');
  now += 1000;
  window.evaluateRulesForTelemetry = () => { throw new Error('Rule evaluator unavailable'); };
  await step(); await flush();
  assert.equal(writes.length, 2, 'Rule failures must not interrupt logging');
  assert.notEqual(writes[0].id, writes[1].id);
  failWrites = true;
  now += 30000;
  await step(); await flush();
  assert.equal(events.length, 2, 'Failed SQLite writes must not dispatch success events');
  failWrites = false;
  now += 30000;
  await step(); await flush();
  assert.equal(events.length, 3);
  nodes = [];
  now += 30000;
  await step(); await flush();
  assert.equal(writes.length, 4, 'Removed/unassigned nodes must stop generating cadence rows');

  nodes = Array.from({ length: 11 }, (_, index) => ({ id: `burst_db_${index}`, name: `burst-${index}`,
    room_id: 'room1', interval_val: 30, interval_unit: 'Seconds', temp: 25, pressure: 0.4, ac_on: true, status: 'online' }));
  now += 15000;
  const beforeBurst = writes.length;
  await step(); await flush();
  assert.equal(writes.length - beforeBurst, 1, 'Only the first controller is due at startup');
  for (let count = 2; count <= 11; count++) {
    now += 250;
    await step(); await flush();
    assert.equal(writes.length - beforeBurst, count, 'Quarter-second ticks retain staggered controller phases');
  }
  await window.EcoTrackNodeSync.saveNodeTelemetryToSqlite({ id: 'confirmed-state', room_name: 'Lab', aircon_type: 'Split Type',
    temp: 25, ac_on: false, intervalVal: 2, intervalUnit: 'Minutes' });
  assert.equal(writes.length, beforeBurst + 11, 'An OFF sample must not produce a write or save event');
  vm.runInContext(read('public/js/aircon-state.js'), context);
  const basePacket = { id: 'guarded', room_name: 'Lab', aircon_type: 'Split Type', ac_on: true, intervalVal: 2, intervalUnit: 'Minutes' };
  const off = { desired_state: { power: true }, commanded_at: '2026-10-10T09:00:00Z',
    observed_remote_state: { power: false }, observed_remote_at: '2026-10-10T09:01:00Z' };
  const beforeOff = writes.length;
  await window.EcoTrackNodeSync.saveNodeTelemetryToSqlite({ ...basePacket, control_snapshot: off });
  await window.EcoTrackNodeSync.saveNodeTelemetryToSqlite({ ...basePacket, id: 'unknown', ac_on: undefined });
  await window.EcoTrackNodeSync.saveNodeTelemetryToSqlite({ ...basePacket, id: 'sleeping', status: 'sleeping' });
  assert.equal(writes.length, beforeOff, 'Remote OFF, unknown power and sleeping hardware do not create analytics');
  await window.EcoTrackNodeSync.saveNodeTelemetryToSqlite({ ...basePacket, control_snapshot: { ...off,
    desired_state: { power: false }, observed_remote_state: { power: true } } });
  assert.equal(writes.length, beforeOff + 1, 'A newer remote ON resumes recording without a page reload');
  assert.equal(writes.at(-1).interval_seconds, 120, 'Save the cadence used by the reading');
  window.EcoTrackHardwareCloud = {};
  now += 30000;
  await step(); await flush();
  assert.equal(writes.length, beforeOff + 1, 'Cloud heartbeats never mint duplicate desktop samples');

  const source = read('public/js/logs.js');
  let refreshCalls = 0; let renders = 0;
  const logs = vm.createContext({ Date: Clock, currentPeriod: 'daily', selectedDateKey: '',
    window: { addEventListener() {} }, console,
    fetchLogsFromDB: async silent => { assert.equal(silent, true); refreshCalls++; },
    populateDateRangeOptions() {}, render() { renders++; } });
  vm.runInContext(source.slice(source.indexOf('function getPeriodDateKey('), source.indexOf('function getPeriodDateLabel(')), logs);
  vm.runInContext(source.slice(source.indexOf('let telemetryRefreshPending'), source.indexOf('// Helper to get actual aircon fleet count')), logs);
  await logs.refreshLogsAfterTelemetrySaved();
  assert.equal(refreshCalls, 1);
  assert.equal(renders, 1);
  logs.selectedDateKey = '2000-01-01';
  vm.runInContext('followLatestLogPeriod = false', logs); // Simulate the date picker choosing history.
  await logs.refreshLogsAfterTelemetrySaved();
  assert.equal(refreshCalls, 1, 'Historical filters must remain stable');
  logs.currentPeriod = 'monthly';
  logs.selectedDateKey = logs.getPeriodDateKey(new Clock(), 'monthly');
  await logs.refreshLogsAfterTelemetrySaved();
  assert.equal(refreshCalls, 2);
  console.log('Telemetry cadence tests passed: 30-second writes, rule failure isolation, confirmed-save events, assignment removal, and daily/monthly refresh filters.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
