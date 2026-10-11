const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const sourceText = fs.readFileSync('src/app/devices.tsx', 'utf8');
const source = ts.createSourceFile('devices.tsx', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(predicate) {
  let result;
  function visit(node) { if (!result && predicate(node)) result = node; if (!result) ts.forEachChild(node, visit); }
  visit(source); assert.ok(result, 'Expected source declaration or UI section'); return result;
}
function declaration(name) {
  const node = find(n => (ts.isFunctionDeclaration(n) || ts.isVariableDeclaration(n)) && n.name?.getText(source) === name);
  return (ts.isVariableDeclaration(node) ? 'const ' : '') + node.getText(source) + ';';
}
function evaluate(code, context = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText,
    { module, exports: module.exports, Date, console: { error() {} }, ...context });
  return module.exports;
}
const formatters = evaluate(declaration('formatBatteryPercent') + declaration('formatConnectionLatency') + 'exports.battery = formatBatteryPercent; exports.latency = formatConnectionLatency;');
function renderSection(style, marker, context) {
  const node = find(n => ts.isJsxElement(n) && n.openingElement.attributes.getText(source).includes(`styles.${style}`) && n.getText(source).includes(marker));
  return evaluate(declaration('formatBatteryPercent') + declaration('formatConnectionLatency') + `exports.render = () => (${node.getText(source)});`, {
    React: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) }, View: 'View', ThemedText: 'Text', Pressable: 'Button',
    styles: new Proxy({}, { get: (_target, key) => key === 'infoVal' ? { flex: 1 } : {} }), isDark: false, testingConnection: false, testResult: null, ...context,
  }).render();
}
function elements(node) { return node && typeof node === 'object' ? [node, ...(node.props?.children || []).flatMap(elements)] : []; }
function text(node) { return Array.isArray(node) ? node.map(text).join(' ') : node && typeof node === 'object' ? text(node.props?.children || []) : node == null ? '' : String(node); }
const clean = value => JSON.parse(JSON.stringify(value));
const oldDevice = { id: 'n1', deviceId: 'ESP32-1', name: 'Room 1 AC', brand: 'Daikin', roomId: 'r1', room: 'Room 1', status: 'connected', battery: 85, updated: '2026-10-05T08:00:00Z' };
const rooms = [{ id: 'r1', name: 'Room 1' }, { id: 'r2', name: 'Room 2' }];

test('device battery uses the nodes percentage contract and rejects unavailable or invalid data', () => {
  for (const [value, expected] of [[0, '0%'], [15, '15%'], [85, '85%'], [100, '100%'], [85.6, '86%']]) assert.equal(formatters.battery(value), expected);
  for (const value of [null, undefined, NaN, Infinity, -1, 101]) assert.equal(formatters.battery(value), 'Unavailable');
  const tree = renderSection('infoList', 'Battery Level', { selectedDevice: oldDevice });
  assert.match(text(tree), /85%/); assert.doesNotMatch(text(tree), /Temperature Telemetry|RSSI|dBm|85V/);
});

test('latency is available only from a successful measured probe and has an explicit unavailable state', () => {
  assert.equal(formatters.latency({ online: true, pingMs: 23.7 }), '24 ms');
  assert.equal(formatters.latency({ online: true, pingMs: 0 }), '0 ms');
  for (const result of [null, { online: false, pingMs: 0 }, { online: true, pingMs: NaN }, { online: true, pingMs: -60 }]) assert.equal(formatters.latency(result), 'Unavailable');
  const tree = renderSection('infoList', 'Battery Level', { selectedDevice: { ...oldDevice, rssi: -66 }, testResult: { online: true, pingMs: 24 } });
  assert.match(text(tree), /Connection Latency.*24 ms/); assert.doesNotMatch(text(tree), /66 ms/);
});

test('BLE discovery and manual identifiers do not invent milliseconds from RSSI or fixed placeholders', async () => {
  const prefix = fs.readFileSync('scripts/test-scoped-control-fixes.cjs', 'utf8').split('\ntest(')[0];
  const harness = vm.runInNewContext(prefix + ';bleHarness;', { require, console, process, Date, queueMicrotask });
  const found = await harness({ devices: [{ id: 'AA:BB:CC:DD:EE:01', name: 'EcoTrack-node-1', rssi: -66 }] }).service.scanNearbyDevices();
  assert.equal(found[0].pingMs, null); assert.equal(found[0].bleId, 'AA:BB:CC:DD:EE:01');
  let selected;
  const run = evaluate(declaration('handleSelectManualNode') + 'exports.run = handleSelectManualNode;', {
    Alert: { alert() {} }, handleSelectBleDevice: device => { selected = device; },
  }).run;
  run('node-1'); assert.equal(selected.pingMs, null); assert.equal(selected.deviceId, 'node-1');
});

test('failed connection UI cannot claim a verified cloud connection and status text keeps its width and color', () => {
  for (const isDark of [false, true]) {
    const failed = renderSection('testResultBox', 'Local Controller Reached', { isDark, testResult: { online: false, pingMs: 0 } });
    assert.match(text(failed), /Local Controller Unreachable/); assert.doesNotMatch(text(failed), /Cloud|Device identity verified|0 ms/);
    const success = renderSection('testResultBox', 'Local Controller Reached', { isDark, testResult: { online: true, pingMs: 17 } });
    assert.match(text(success), /Local Controller Reached.*17 ms.*Device identity verified/);
    const hardware = renderSection('infoList', 'Battery Level', { isDark, selectedDevice: { ...oldDevice, status: 'offline' } });
    const offline = elements(hardware).find(element => element.type === 'Text' && text(element).trim() === 'Offline');
    assert.ok(offline); assert.equal(offline.props.style.at(-1).flex, 0); assert.equal(offline.props.style.at(-1).color, '#ef4444');
    const header = renderSection('modalHeader', 'selectedDevice?.deviceId', { isDark, selectedDevice: { ...oldDevice, status: 'offline' } });
    assert.equal(elements(header).find(element => text(element).includes('● Offline') && element.type === 'Text').props.style.color, '#ef4444');
  }
  assert.match(text(renderSection('infoList', 'Associated AC', { selectedDevice: { ...oldDevice, room: undefined, building: undefined, floor: undefined } })), /Room details unavailable/);
});

function roomHandler(overrides = {}) {
  const state = { device: oldDevice, devices: [oldDevice], modal: true, saving: false, result: { online: true, pingMs: 12 } }, calls = [], alerts = [];
  const context = {
    selectedDevice: oldDevice, selectedChangeRoomId: 'r2', changeRoomSearchQuery: 'Room 2', availableRooms: rooms,
    changeRoomAirconName: oldDevice.name, changeRoomAirconBrand: oldDevice.brand, roomSavePending: { current: false }, connectionTestRequest: { current: 0 }, triggerHaptic() {},
    originalRoomMetadata: { current: { name: oldDevice.name, brand: oldDevice.brand } },
    setSavingRoom: value => { state.saving = value; }, setSelectedDevice: value => { state.device = value; }, setDevices: fn => { state.devices = fn(state.devices); },
    setTestResult: value => { state.result = value; }, setTestingConnection() {}, setRoomChangeModalVisible: value => { state.modal = value; }, loadDevices: async () => calls.push(['refresh']),
    Alert: { alert: (...args) => alerts.push(args) }, DeviceService: {
      resolveRoomId: async id => { calls.push(['resolve', id]); return id; },
      updateDevice: async (id, updates) => { calls.push(['update', id, updates]); return { ...oldDevice, ...updates, room: 'Room 2' }; },
    }, ...overrides,
  };
  const handler = evaluate(declaration('handleSaveChangeRoom') + 'exports.run = handleSaveChangeRoom;', context).run;
  return { handler, state, calls, alerts, context };
}

test('room reassignment sends only changed metadata, retains the IR brand/protocol, and displays the confirmed location', async () => {
  const h = roomHandler(); await h.handler();
  const update = h.calls.find(call => call[0] === 'update'); assert.deepEqual(clean(update[2]), { roomId: 'r2' });
  assert.equal(h.state.device.roomId, 'r2'); assert.equal(h.state.devices[0].roomId, 'r2'); assert.equal(h.state.device.brand, 'Daikin');
  assert.equal(h.state.modal, false); assert.equal(h.state.saving, false); assert.equal(h.state.result, null); assert.equal(h.alerts.length, 0);
  const refreshed = roomHandler({ selectedDevice: { ...oldDevice, name: 'Renamed elsewhere', brand: 'Midea' } });
  await refreshed.handler();
  assert.deepEqual(clean(refreshed.calls.find(call => call[0] === 'update')[2]), { roomId: 'r2' });
});

test('unselected typed room text never silently saves the old room; custom and unassigned selections remain explicit', async () => {
  const mismatch = roomHandler({ selectedChangeRoomId: 'r1', changeRoomSearchQuery: 'New Room' }); await mismatch.handler();
  assert.equal(mismatch.calls.length, 0); assert.equal(mismatch.state.modal, true); assert.equal(mismatch.alerts[0][0], 'Select a room');
  for (const [id, query] of [['custom:New Room', 'New Room'], [null, '']]) {
    const h = roomHandler({ selectedChangeRoomId: id, changeRoomSearchQuery: query }); await h.handler();
    assert.equal(h.calls.find(call => call[0] === 'update')[2].roomId, id);
  }
  const edited = roomHandler({ changeRoomAirconName: 'New AC Name', changeRoomAirconBrand: 'Midea' }); await edited.handler();
  assert.deepEqual(clean(edited.calls.find(call => call[0] === 'update')[2]), { roomId: 'r2', name: 'New AC Name', brand: 'Midea' });
});

test('failed room writes retain the prior location and repeated update taps cannot send duplicate transactions', async () => {
  const denied = roomHandler({ DeviceService: { resolveRoomId: async id => id, updateDevice: async () => null } }); await denied.handler();
  assert.equal(denied.state.device.roomId, 'r1'); assert.equal(denied.state.modal, true); assert.equal(denied.state.saving, false); assert.equal(denied.alerts[0][0], 'Unable to change room');
  let finish, writes = 0;
  const waiting = roomHandler({ DeviceService: { resolveRoomId: async id => id, updateDevice: async () => { writes++; return new Promise(resolve => { finish = resolve; }); } } });
  const first = waiting.handler(); await new Promise(resolve => setImmediate(resolve)); await waiting.handler(); assert.equal(writes, 1);
  finish({ ...oldDevice, roomId: 'r2' }); await first; assert.equal(waiting.context.roomSavePending.current, false);
});

function serviceHarness(options) {
  const prefix = fs.readFileSync('scripts/test-device-integration.cjs', 'utf8').split('const ac = h =>')[0];
  return vm.runInNewContext(prefix + ';harness;', { require, console, process, setTimeout, clearTimeout, Date, AbortController })(options);
}

test('the device mutation uses its committed node row even when a post-move node read would be unavailable', async () => {
  const committed = { id: 'n1', name: oldDevice.name, status: 'offline', room_id: 'r2', battery: 70, brand: 'Daikin', protocol_name: 'DAIKIN2', updated: '2026-10-05T08:01:00Z' };
  const h = serviceHarness({ respond: q => {
    if (q.rpc) return { data: { node: committed }, error: null };
    if (q.table === 'nodes') throw Error('Post-move node read unavailable');
    return { data: q.ops.some(op => op[0] === 'gt') ? [] : q.table === 'rooms' ? [{ id: 'r2', name: 'Room 2', floor_id: 'f2' }] : q.table === 'floors' ? [{ id: 'f2', name: 'Floor 2', building_id: 'b2' }] : q.table === 'buildings' ? [{ id: 'b2', name: 'Main' }] : [], error: null };
  } });
  const updated = await h.load('src/services/device-service.ts').DeviceService.updateDevice('n1', { roomId: 'r2' });
  assert.ok(updated); assert.equal(updated.roomId, 'r2'); assert.equal(updated.room, 'Room 2'); assert.equal(updated.floor, 'Floor 2'); assert.equal(updated.building, 'Main'); assert.equal(updated.status, 'offline');
  assert.equal(h.calls.some(call => call.table === 'nodes'), false); assert.deepEqual(clean(h.calls[0].args.p_payload), { room_id: 'r2' });
  for (const response of [{ data: null, error: { code: '42501' } }, { data: { node: { id: 'different' } }, error: null }]) {
    const denied = serviceHarness({ respond: () => response });
    assert.equal(await denied.load('src/services/device-service.ts').DeviceService.updateDevice('n1', { roomId: 'r2' }), null);
    assert.equal(denied.calls.length, 1);
  }
});

test('late connection-test results cannot replace another device selection', async () => {
  let finish; const results = [], loading = [], alerts = [], request = { current: 0 };
  const run = evaluate(declaration('handleRunConnectionTest') + 'exports.run = handleRunConnectionTest;', {
    selectedDevice: oldDevice, triggerHaptic() {}, setTestingConnection: value => loading.push(value), setTestResult: value => results.push(value), connectionTestRequest: request,
    BleDeviceService: { testDeviceConnection: () => new Promise(resolve => { finish = resolve; }) }, Alert: { alert: (...args) => alerts.push(args) },
  }).run;
  const pending = run(); request.current++; finish({ online: true, pingMs: 25 }); await pending;
  assert.deepEqual(results, [null]); assert.deepEqual(loading, [true]); assert.equal(alerts.length, 0);
});

test('device refresh updates open status/location, preserves newer confirmed saves, and retains details after read failure', async () => {
  for (const scenario of ['fresh', 'old', 'failed']) {
    let selected = oldDevice, message = null;
    const fresh = { ...oldDevice, roomId: 'r2', room: 'Room 2', status: 'offline', updated: scenario === 'old' ? '2026-10-05T07:59:00Z' : '2026-10-05T08:02:00Z' };
    const run = evaluate(declaration('refreshDeviceData') + 'exports.run = refreshDeviceData;', {
      useCallback: callback => callback, snapshotUser: { current: 'user-1' }, fetchUser: 'user-1',
      createReadScope: () => ({ assertSuccessful() {} }), fetchDevices: async () => { if (scenario === 'failed') throw Error('offline'); return [fresh]; }, DeviceService: { fetchAvailableRooms: async () => rooms },
      setSelectedDevice: fn => { selected = fn(selected); }, setDevices() {}, setAvailableRooms() {}, setLoading() {}, setFetchError: value => { message = value; },
      setTestResult() {}, setTestingConnection() {}, connectionTestRequest: { current: 0 },
    }).run;
    await run(() => true);
    assert.equal(selected.roomId, scenario === 'fresh' ? 'r2' : 'r1'); assert.equal(selected.status, scenario === 'fresh' ? 'offline' : 'connected');
    assert.equal(message !== null, scenario === 'failed');
  }
});
