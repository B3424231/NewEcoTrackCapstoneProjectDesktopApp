const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = file => fs.readFileSync(path.join(__dirname, '..', 'public/js', file), 'utf8');
const storage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
};
const quiet = { log() {}, warn() {}, error() {} };
async function testAdapter() {
  const localStorage = storage(), calls = [], events = [];
  let poll, stopped = false, failure = false;
  let records = [{ id: 'reading/1', temperature: 25, updated: '2026-10-08T10:00:00Z' }];
  const window = { localStorage };
  const context = vm.createContext({ window, localStorage, URLSearchParams, console: quiet,
    setInterval(fn) { poll = fn; return 1; }, clearInterval() { stopped = true; },
    fetch: async (url, options = {}) => {
      calls.push({ url, ...options });
      return { ok: !failure, status: failure ? 500 : 200, json: async () => failure ? { error: 'Backend unavailable' }
        : options.method === 'PATCH' ? { id: 'reading/1', ...JSON.parse(options.body) }
        : options.method === 'DELETE' ? { success: true }
        : { items: records, totalItems: records.length, page: 1, perPage: 1, totalPages: 1 } };
    } });
  window.electron = {invoke: async (channel, input) => {
    assert.equal(channel, 'telemetry-admin-request');
    const response = await context.fetch('http://localhost:5000' + input.path, {method:input.method,body:JSON.stringify(input.data)});
    const data = await response.json();
    return {success:response.ok,data,error:response.ok ? undefined : data.error};
  }};
  vm.runInContext(source('supabase-client.js'), context);
  const telemetry = window.pb.collection('telemetry');
  const updated = await telemetry.update('reading/1', { room_name: 'Lab' });
  assert.equal(updated.room_name, 'Lab');
  assert.equal(calls.at(-1).method, 'PATCH');
  assert(calls.at(-1).url.endsWith('/api/telemetry/reading%2F1'));
  await telemetry.getList(2, 10, { node_id: 'controller', date: '2026-10-08', filter: "battery >= 3.5" });
  const url = new URL(calls.at(-1).url);
  assert.equal(url.searchParams.get('node_id'), 'controller');
  assert.equal(url.searchParams.get('filter'), 'battery >= 3.5');
  failure = true;
  await assert.rejects(() => telemetry.getFullList(), /Backend unavailable/);
  await assert.rejects(() => telemetry.delete('reading'), /Backend unavailable/);
  failure = false;
  const unsubscribe = await telemetry.subscribe('*', event => events.push(event));
  await poll(); assert.equal(events.length, 1);
  failure = true; await poll(); assert.equal(events.length, 1, 'Failed requests cannot clear subscriber state');
  failure = false; records = []; await poll();
  assert.equal(events.at(-1).action, 'delete'); assert.equal(events.at(-1).record, null);
  unsubscribe(); assert(stopped); await poll(); assert.equal(events.length, 2);
  assert.equal(window.pb.authStore, undefined);
  assert.equal(window.pb.autoCancellation, undefined);
  assert.throws(() => window.pb.collection('nodes'), /supabaseClient/);
  assert.equal(window.pb, window.telemetryClient);
}
function engine() {
  const localStorage = storage(), events = [], queries = [];
  const window = { localStorage, addEventListener() {}, dispatchEvent(event) { events.push(event); } };
  const context = vm.createContext({ window, document:{addEventListener(){}}, localStorage, console: quiet, setTimeout() {},
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } } });
  vm.runInContext(source('aircon-system.js'), context);
  let state = { nodes: [], aircons: [], rooms: [], floors: [], buildings: [] }, error = null, session = { user: { id: 'test' } };
  window.supabaseClient = { auth: { getSession: async () => ({ data: { session } }) }, from(table) {
    queries.push(table);
    const query = { select() { return query; }, order() { return query; },
      then(resolve, reject) { return Promise.resolve({ data: state[table], error: table === 'nodes' ? error : null }).then(resolve, reject); } };
    return query;
  } };
  return { localStorage, window, events, queries, system: window.EcoTrackAirconSystem,
    rows(value) { state = { ...state, ...value }; }, error(value) { error = value; }, session(value) { session = value; } };
}
function seed(e) {
  e.localStorage.setItem('ecoTrack_nodes', JSON.stringify([{ node_id: 'old-node' }]));
  e.localStorage.setItem('ecoTrack_aircons', JSON.stringify([{ device_id: 'OLD-AC', name: 'Old AC', node_id: 'old-node' }]));
  e.localStorage.setItem('ecoTrack_aircons_cache', 'legacy');
}
async function testRegistryReconciliation() {
  const e = engine(); seed(e);
  e.error({ message: 'Permission denied' });
  await e.system.syncWithDatabase();
  assert.equal(e.system.AirconProfileManager.getAll().length, 1, 'Query failures preserve cached data');
  e.error(null); e.session(null); await e.system.syncWithDatabase();
  assert.equal(e.system.AirconProfileManager.getAll().length, 1, 'Unauthenticated empty results cannot erase cache');
  e.session({ user: { id: 'test' } }); e.rows({ nodes: null }); await e.system.syncWithDatabase();
  assert.equal(e.system.AirconProfileManager.getAll().length, 1, 'Malformed results cannot erase cache');
  e.rows({ nodes: [] });
  let ready; e.window.ecotrackAuthReady = new Promise(resolve => { ready = resolve; });
  const before = e.queries.length, pending = e.system.syncWithDatabase();
  await Promise.resolve(); assert.equal(e.queries.length, before, 'Wait for restored authentication before reads');
  ready(); await pending;
  assert.equal(e.system.AirconProfileManager.getAll().length, 0);
  assert.equal(e.system.NodeService.getNodes().length, 0);
  assert.equal(e.localStorage.getItem('ecoTrack_aircons_cache'), null);
  assert(e.events.some(event => event.type === 'devices:synced' && event.detail.aircons.length === 0));
  const partial = engine();
  partial.localStorage.setItem('ecoTrack_aircons', JSON.stringify([
    { device_id: 'AC-1', aircon_id: 'asset-1', node_id: 'node-1', name: 'Custom AC Name' },
    { device_id: 'DELETED', aircon_id: 'removed', node_id: 'node-2', name: 'Deleted asset' },
    { device_id: 'ORPHAN', node_id: 'missing', name: 'Orphan profile' }
  ]));
  partial.rows({ nodes: [{ id: 'db-1', name: 'node-1', status: 'online' }, { id: 'db-2', name: 'node-2', status: 'online' }],
    aircons: [{ id: 'asset-1', asset_tag: 'AC-1', name:'Custom AC Name', node_id: 'db-1', brand: 'Midea', protocol_name: 'midea_ir' }] });
  await partial.system.syncWithDatabase();
  const profiles = partial.system.AirconProfileManager.getAll();
  assert.equal(profiles.find(ac => ac.device_id === 'AC-1').name, 'Custom AC Name');
  assert(!profiles.some(ac => ['DELETED', 'ORPHAN'].includes(ac.device_id)));
  assert.equal(partial.system.NodeService.getNodes().length, 2);
  partial.rows({aircons:[{id:'asset-1',asset_tag:'AC-1',name:'Renamed in registry',node_id:'db-1',brand:'Midea',protocol_name:'midea_ir'}]});
  await partial.system.syncWithDatabase();
  assert.equal(partial.system.AirconProfileManager.getAll().find(ac=>ac.device_id==='AC-1').name,'Renamed in registry','A successful registry refresh uses the persisted AC name');
}
async function testTelemetryRegistryFailures() {
  const code = source('sensor-workspace.js');
  const begin = code.indexOf('  function refreshLocations(');
  const end = code.indexOf('  function sensorIcon(', begin);
  assert(begin >= 0 && end > begin, 'Current sensor registry refresh exists');
  let response = { success: false, error: 'Offline' }, renders = 0, registryDevices = [{ id: 'cached' }];
  const context = vm.createContext({ window: {electron:{invoke:async channel=>{assert.equal(channel,'scheduler-fetch-data');return response;}}}, console: quiet,setTimeout,clearTimeout,
    page:'telemetry',registryTask:null,locationRegistry:{buildings:[{id:'b'}],floors:[{id:'f'}],rooms:[{id:'r'}]},
    readRegistryDevices(data) { registryDevices=data.nodes; },renderLocations(){renders++;},renderFleet(){renders++;} });
  vm.runInContext(code.slice(begin, end), context);
  await context.refreshLocations();
  assert.equal(registryDevices.length, 1, 'Failed sensor registry reads preserve existing device metadata');
  assert.equal(renders, 0);
  assert.equal(context.locationRegistry.rooms.length,1);
  response = { success:true,nodes:[],buildings:[],floors:[],rooms:[] };
  await context.refreshLocations();
  assert.equal(registryDevices.length, 0, 'An explicit successful empty registry clears stale devices');
  assert.equal(context.locationRegistry.rooms.length,0);assert.equal(renders,2);
}

async function main() {
  await testAdapter(); await testRegistryReconciliation(); await testTelemetryRegistryFailures();
  for (const page of ['rules.html', 'telemetry.html']) {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', page), 'utf8');
    assert.equal((html.match(/src="\.\/js\/supabase-client\.js"/g) || []).length, 1);
  }
  console.log('Database cleanup passed: real update requests, filter forwarding, error preservation, empty subscriptions, authenticated cache reconciliation and partial deletions.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
