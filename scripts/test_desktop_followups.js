const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = process.env.ECOTRACK_DESKTOP_ROOT || path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
function section(text, first, last) { const start = text.indexOf(first), end = text.indexOf(last, start); assert.ok(start >= 0 && end > start); return text.slice(start, end); }
const profile = { id: 'a1', asset_tag: 'Fixture AC', name: 'Fixture AC', room_id: 'r1', controller_node_id: 'n1', node_id: 'n1' };
const node = { id: 'n1', name: 'fixture-node', room_id: null, device_mode: 'both' };
const rooms = [{ id: 'r1', name: 'Room 1', floor_id: 'f1' }], floors = [{ id: 'f1', name: 'Floor 1', building_id: 'b1' }], buildings = [{ id: 'b1', name: 'IC building' }];
const storage = initial => { const values = new Map(Object.entries(initial || {})); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }; };

test('control dashboard excludes profiles with no registered controller and retains offline controllers', () => {
  const html = read('public/dashboard.html');
  const code = section(html, 'function renderDashboard()', '      // Filter pills listener');
  for (const bound of [false, true]) {
    const elements = new Map();
    const context = {
      AirconProfileManager: { getAll: () => [{ ...profile, node_id: bound ? 'fixture-node' : null, controller_node_id: bound ? 'n1' : null, status: 'offline' }] },
      NodeService: { getNodes: () => bound ? [{ node_id: 'fixture-node', db_id: 'n1', status: 'Offline' }] : [], getNode: id => bound && ['n1', 'fixture-node'].includes(id) ? node : null, isNodeOnline: () => false },
      CentralLogService: { getLogs: () => [] }, getDashboardPowerState: () => ({ power: null }),
      document: { querySelectorAll:()=>[], getElementById: id => { if (id === 'airconCardsGrid') return null; if (!elements.has(id)) elements.set(id, {}); return elements.get(id); } },
    };
    context.window={};context.localStorage=storage({ecoTrack_aircons:JSON.stringify([{...profile,device_id:profile.asset_tag,aircon_id:profile.id,node_id:bound?'fixture-node':null,controller_node_id:bound?'n1':null,status:'offline'}]),ecoTrack_nodes:JSON.stringify(bound?[{...node,node_id:'fixture-node',db_id:'n1',status:'Offline'}]:[])});
    context.window.localStorage=context.localStorage;context.console={log(){},warn(){},error(){}};
    vm.createContext(context);vm.runInContext(read('public/js/aircon-system.js'),context);
    context.AirconProfileManager=context.window.EcoTrackAirconSystem.AirconProfileManager;
    context.CentralLogService=context.window.EcoTrackAirconSystem.CentralLogService;
    vm.runInContext(code + ';renderDashboard();', context);
    assert.equal(elements.get('kpiTotalUnits').textContent, bound ? 1 : 0);
  }
});

test('device hierarchy falls back to the assigned AC and replaces stale cached location text', () => {
  const text = read('public/js/aircon-system.js');
  const code = section(text, '// Map real Supabase nodes into AC Controller Devices', '// Supabase assets are authoritative');
  const resolver = section(text, 'function resolveRegisteredAirconNode(', '  async function syncWithDatabase(');
  const context = {
    sbNodes: [node], sbAircons: [profile], sbRooms: rooms, sbFloors: floors,
    roomMap: { r1: { name: 'Room 1', floor: 'Floor 1', building: 'IC building' } }, hardwareByNode: new Map(),
    normalizeAirconNodeId: value => value || '', deduplicateAirconList: values => values,
    localStorage: storage({ ecoTrack_aircons: JSON.stringify([{ aircon_id: 'a1', device_id: 'Fixture AC', room_id: 'r1', location: 'Unassigned (Unassigned)' }]) }),
    CapabilityEngine: { getCapabilities: () => ({}) },
    window: { EcoTrackAirconState: { remoteObservation: () => ({}), describeAirconState: () => ({ confirmed: false }), selectSettings: () => ({ state: null }) } },
  };
  vm.runInNewContext(resolver + code + ';this.mappedNodes=realNodes;this.mappedAircons=realAircons;', context);
  assert.equal(context.mappedNodes[0].room_id, 'r1');
  assert.equal(context.mappedNodes[0].room_name, 'Room 1');
  assert.equal(context.mappedNodes[0].floor_id, 'f1');
  assert.equal(context.mappedNodes[0].building_id, 'b1');
  assert.equal(context.mappedAircons[0].location, 'Room 1 (IC building • Floor 1)');
});

test('maintenance device locations use the assigned AC room when the node room is missing', async () => {
  const source = read('public/js/maintenance-modal.js');
  const tables = { nodes: [node, { id: 'n2', name: 'other-node', room_id: 'r1' }], rooms, floors, buildings, aircons: [profile], ecotrack_device_state: [] };
  const warnings = [];
  const client = { from: table => ({ select: async () => ({ data: tables[table], error: null }) }) };
  const context = {
    getSb: () => client, ensureReportReadSession() {}, reportAuthVersion:0,
    readMaintenanceSensors: async () => [], updateStaffLocationHierarchy() {}, maintenanceControllerDiagnostics: () => ({}),
    _nodesAirconCache: null, localStorage: storage(), setTimeout() {},
    window: { dispatchEvent() {} }, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } }, console: { warn: (...args) => warnings.push(args) },
  };
  vm.runInNewContext(section(source, 'async function fetchAirconsFromSupabase()', '  // Filter AC controls strictly matching') + ';this.load=fetchAirconsFromSupabase;', context);
  await context.load();
  assert.deepEqual(warnings, []);
  const mapped = context._nodesAirconCache.find(item => item.nodeId === 'n1');
  assert.ok(mapped, 'a device with an AC room must remain visible alongside directly assigned nodes');
  assert.equal(mapped.roomId, 'r1');
  assert.equal(mapped.room, 'Room 1');
  assert.equal(mapped.floor, 'Floor 1');
  assert.equal(mapped.building, 'IC building');
});

test('maintenance Cancel closes without saving and Save Draft is absent', () => {
  const source = read('public/js/maintenance-modal.js');
  const handlers = new Map(), classes = new Set();
  const modal = { classList: { add: value => classes.add(value) }, style: { display: 'flex' } };
  const button = { addEventListener: (event, callback) => handlers.set(event, callback) };
  let refreshes = 0;
  const context = {
    document: { body: { style: { overflow: 'hidden' } }, getElementById: id => id === 'modalBtnCancelCreate' ? button : id === 'ecoCreateReportModal' ? modal : null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} },
    window: { _ecoMaintenanceDropdownGlobalBound: true },
    refreshPageReportsView: () => { refreshes++; },
  };
  const close = section(source, 'function closeCreateReportModal()', '  function injectCreateModalHTML()');
  const bindings = section(source, '    // CUSTOM DROPDOWN ENGINE & EVENT BINDINGS', '    let _formErrorTimer');
  vm.runInNewContext(close + bindings, context);
  assert.ok(handlers.has('click'), 'Cancel needs a click handler after every form render');
  handlers.get('click')();
  assert.equal(classes.has('hidden'), true);
  assert.equal(modal.style.display, 'none');
  assert.equal(context.document.body.style.overflow, '');
  assert.equal(refreshes, 1);
  assert.equal(/id="modalBtnSaveDraft"|>\s*Save Draft\s*</.test(source), false);
  assert.match(source, /<button[^>]*id="modalBtnCancelCreate"[^>]*type="button"/);
});
