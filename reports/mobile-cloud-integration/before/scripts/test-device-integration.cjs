const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function harness({ respond = () => ({ data: [], error: null }), request = async () => { throw Error('Unexpected hardware request'); }, initial = {}, os = 'android', wifiState = { type: 'cellular', isConnected: true, details: {} }, locationEnabled = true, locationPermission = { granted: true, android: { accuracy: 'fine' }, ios: { accuracy: 'full' } }, appOwnership = null, controllerTimeoutMs = 8000 } = {}) {
  const calls = [], requests = [], stored = new Map(Object.entries(initial)), loaded = new Map();
  const storage = {
    getItem: async key => stored.get(key) ?? null,
    setItem: async (key, value) => { stored.set(key, value); },
    removeItem: async key => { stored.delete(key); },
  };
  const client = {
    from(table) {
      const call = { table, ops: [] }; calls.push(call);
      const query = new Proxy({}, { get(_, method) {
        if (method === 'then') return (resolve, reject) => Promise.resolve().then(() => respond(call)).then(resolve, reject);
        return (...args) => { call.ops.push([method, ...args]); return query; };
      } }); return query;
    },
    rpc(name, args) { const call = { rpc: name, args }; calls.push(call); return Promise.resolve(respond(call)); },
  };
  function load(filename) {
    filename = path.resolve(filename);
    if (loaded.has(filename)) return loaded.get(filename).exports;
    const module = { exports: {} }; loaded.set(filename, module);
    const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const requireMock = spec => {
      if (spec === '@react-native-async-storage/async-storage') return storage;
      if (spec === 'react-native') return { Platform: { OS: os, Version: 31 }, PermissionsAndroid: { requestMultiple: async () => ({}), request: async () => 'granted', PERMISSIONS: {}, RESULTS: {} } };
      if (spec === '@react-native-community/netinfo') return { default: {
        configure: options => calls.push({ netInfoConfig: options }),
        refresh: async () => { calls.push({ netInfoRefresh: true }); return typeof wifiState === 'function' ? wifiState() : wifiState; },
      } };
      if (spec === 'expo-location') return {
        hasServicesEnabledAsync: async () => locationEnabled,
        requestForegroundPermissionsAsync: async () => { calls.push({ foregroundPermission: true }); return typeof locationPermission === 'function' ? locationPermission() : locationPermission; },
      };
      if (spec === 'expo-constants') return { default: { appOwnership } };
      if (spec === './supabase') return { supabase: client };
      if (spec.startsWith('.')) return load(path.resolve(path.dirname(filename), spec + '.ts'));
      throw Error(`Unexpected dependency ${spec}`);
    };
    vm.runInNewContext(js, {
      require: requireMock, module, exports: module.exports, Date, AbortController,
      setTimeout: (callback, ms) => setTimeout(callback, ms === 8000 ? controllerTimeoutMs : ms), clearTimeout,
      console: { warn() {}, log() {}, error() {} },
      fetch: async (...args) => { requests.push(args); return request(...args); },
    }, { filename });
    return module.exports;
  }
  return { load, calls, requests, stored };
}
const ac = h => h.load('src/services/ac-controller-service.ts').AcControllerService;
const device = h => h.load('src/services/device-service.ts').DeviceService;
const ble = h => h.load('src/services/device-service.ts').BleDeviceService;
const transport = h => h.load('src/services/device-transport.ts');
const response = data => ({ ok: true, json: async () => data });

test('AC screen control failures show an error without saving inventory or reporting success', async () => {
  const source = fs.readFileSync('src/app/explore.tsx', 'utf8');
  const parsed = ts.createSourceFile('explore.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const handlers = [];
  const names = new Set(['handleQuickPowerToggle', 'handleAdjustTemp']);
  const visit = node => {
    if (ts.isVariableDeclaration(node) && names.has(node.name.getText(parsed))) handlers.push(node.getText(parsed));
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  assert.equal(handlers.length, 2);
  const code = handlers.map(handler => 'const ' + handler + ';').join('\n')
    + '\nexports.controls = { handleQuickPowerToggle, handleAdjustTemp };';
  for (const os of ['android', 'web']) {
  const module = { exports: {} }, calls = [], alerts = [];
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, {
    module, exports: module.exports,
    AcControllerService: {
      dispatchIntent: async (...args) => { calls.push(['transmit', ...args]); return false; },
      saveDesiredState: async () => calls.push(['save']),
      saveAircon: async () => calls.push(['save']),
    },
    CapabilityEngine: { getCapabilities: () => ({ minTemp: 16, maxTemp: 30 }) },
    triggerHaptic() {}, setTransmittingId() {},
    loadAircons: async () => calls.push(['reload']),
    Alert: { alert: (...args) => alerts.push(args) },
    Platform: { OS: os }, window: { alert: message => alerts.push(['Command Failed', message]) },
  });
  const device = { deviceId: 'AC-1', power: 'OFF', setTemp: 24 };
  await module.exports.controls.handleQuickPowerToggle(device);
  await module.exports.controls.handleAdjustTemp(device, 1);
  await module.exports.controls.handleAdjustTemp(device, -1);
  assert.equal(calls.filter(call => call[0] === 'transmit').length, 3);
  assert.ok(!calls.some(call => call[0] === 'save' || call[0] === 'reload'));
  assert.equal(alerts.length, 3);
  assert.ok(alerts.every(args => args[1] === 'Controller unavailable or transmission was not acknowledged.'));
  }
});

test('unknown brands and unverified aliases never select a different vendor protocol', () => {
  const { CapabilityEngine } = harness().load('src/services/ac-controller-service.ts');
  for (const name of ['LG', 'Sharp', 'Condura', 'Fujidenzo', 'FakeMidea', '']) assert.equal(CapabilityEngine.resolveProtocolName(name), 'unverified');
  assert.equal(CapabilityEngine.resolveProtocolName('Midea'), 'midea_ir');
  assert.equal(CapabilityEngine.isSupported('Midea', 'POWER'), false);
});

test('diagnostics reject malformed and nonlocal controller destinations before fetch', async () => {
  const h = harness();
  for (const address of ['https://example.com', '192.168.1.2/path', '192.168.1.2:0', '192.168.1.2:65536', '192.168.1.2:', '192.168.1.2:80/path', '192.168.1.2@evil.local', '8.8.8.8:80', '192.168.256.1']) {
    await assert.rejects(transport(h).probeController(address, ['node-1']));
  }
  assert.equal(h.requests.length, 0);
});

test('controller diagnostics preserve local host restrictions and accept valid optional ports', async () => {
  for (const address of ['192.168.4.1:80', '192.168.1.50:8080', 'controller.local:65535']) {
    const h = harness({ request: async () => response({ status: 'online', node_id: 'node-1' }) });
    await transport(h).probeController(address, ['node-1']);
    assert.equal(h.requests[0][0], `http://${address}/ping`);
  }
});

test('local controller probe requires actual node identity instead of HTTP 200 alone', async () => {
  const h = harness({ request: async () => response({ status: 'online', node_id: 'other-node' }) });
  await assert.rejects(transport(h).probeController('192.168.1.5', ['node-1']), /identity/);
});

test('mobile intent probes registered controller then transmits exact protocol and state',async()=>{
  const h=harness({respond:call=>call.rpc?{data:{id:'ac-one',command_id:'command-one'}}:{data:[{id:'node-one',name:'Controller One'}]},request:async url=>response(url.endsWith('/ping')?{node_id:'node-one',status:'online'}:{success:true,result:'SUCCESS'})});
  const payload={protocol:'DAIKIN2',state:{power:'on',temp:23,mode:'cool',fan:'auto'}};
  assert.equal(await ac(h).dispatchIntent('192.168.1.2',payload),true);
  assert.deepEqual(h.requests.map(request=>request[0]),['http://192.168.1.2/ping','http://192.168.1.2/ir/intent']);
  assert.deepEqual(JSON.parse(h.requests[1][1].body),payload);
  await ac(h).saveDesiredState('ac-one',payload.state,payload.protocol);
  assert.equal(h.calls.at(-2).args.p_protocol,'DAIKIN2');
  assert.equal(h.calls.at(-1).args.p_command_id,'command-one');
  assert.equal(h.calls.at(-1).args.p_status,'transmitted');
  const rejected=harness({respond:()=>({data:[{id:'node-one'}]}),request:async url=>response(url.endsWith('/ping')?{node_id:'node-one'}:{success:true,result:'FAILED'})});
  assert.equal(await ac(rejected).dispatchIntent('192.168.1.2',payload),false);
  assert.equal(rejected.calls.filter(call=>call.rpc).length,0);
});

test('local probe measures controller response and uses returned RSSI', async () => {
  const h = harness({ request: async () => response({ status: 'online', node_id: 'node-1', rssi: -65 }) });
  const result = await transport(h).probeController('ecotrack.local', ['node-1']);
  assert.equal(result.rssi, -65);
  assert.equal(h.requests[0][0], 'http://ecotrack.local/ping');
  assert.ok(result.pingMs >= 0);
});

test('controller requests abort when transport times out', async () => {
  const h = harness({ request: (_, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Error('aborted')))) });
  await assert.rejects(transport(h).requestControllerJson('192.168.1.2', '/ping', 5), /aborted/);
  assert.equal(h.requests[0][1].signal.aborted, true);
});

test('controller HTTP failure and invalid JSON shape never become online success', async () => {
  const denied = harness({ request: async () => ({ ok: false, status: 503 }) });
  await assert.rejects(transport(denied).probeController('192.168.1.2', ['node-1']), /503/);
  const invalid = harness({ request: async () => response([]) });
  await assert.rejects(transport(invalid).probeController('192.168.1.2', ['node-1']), /Invalid/);
});

test('sniff ignores firmware guessed success without a decoder capture', async () => {
  const h = harness({
    respond: () => ({ data: [{ id: 'node_1', name: 'node-1' }], error: null }),
    request: async url => response(url.endsWith('/ping') ? { status: 'online', node_id: 'node-1' } : { success: true, protocol: 'midea_ir', brand: 'Midea', raw_type: '', hex: '' }),
  });
  assert.equal((await ac(h).sniffProtocol('node_1', '192.168.1.2')).success, false);
});

test('sniff accepts a known decoder response after confirming controller identity', async () => {
  const h = harness({
    respond: () => ({ data: [{ id: 'node_1', name: 'node-1' }], error: null }),
    request: async url => response(url.endsWith('/ping') ? { status: 'online', node_id: 'node-1' } : { success: true, protocol: 'midea_ir', raw_type: 'MIDEA', hex: '1A2B3C' }),
  });
  assert.equal((await ac(h).sniffProtocol('node_1', '192.168.1.2')).protocol, 'midea_ir');
});

test('synthetic firmware RAW capture is not accepted as protocol detection', async () => {
  const h = harness({
    respond: () => ({ data: [{ id: 'node_1', name: 'node-1' }], error: null }),
    request: async url => response(url.endsWith('/ping') ? { status: 'online', node_id: 'node-1' } : { success: true, protocol: 'koppel_ir', raw_type: 'KOPPEL_RAW', hex: '0x12A45C' }),
  });
  assert.equal((await ac(h).sniffProtocol('node_1', '192.168.1.2')).success, false);
});

test('wizard IR detection works before registration and confirms the selected controller before listening', async () => {
  const h = harness({ request: async url => response(url.endsWith('/ping')
    ? { status: 'online', node_id: 'node-6' }
    : { success: true, protocol: 'daikin', brand: 'Incorrect claimed brand', raw_type: 'DAIKIN', hex: '0x12A45C' }) });
  const result = await device(h).sniffRemoteBrand(' 192.168.1.145 ', 'node-6');
  assert.equal(result.success, true);
  assert.equal(result.brand, 'Daikin');
  assert.equal(result.protocol, 'daikin');
  assert.equal(result.rawType, 'DAIKIN');
  assert.deepEqual(h.requests.map(call => call[0]), ['http://192.168.1.145/ping', 'http://192.168.1.145/sniff-protocol']);
  assert.equal(h.requests[1][1].method, 'POST');
  assert.equal(h.calls.length, 0);
  const wrongNode = harness({ request: async () => response({ status: 'online', node_id: 'wrong-node' }) });
  assert.equal((await device(wrongNode).sniffRemoteBrand('192.168.1.145', 'node-6')).success, false);
  assert.equal(wrongNode.requests.length, 1);
});

test('wizard IR detection never accepts firmware defaults, synthetic captures or inconsistent decoder results', async () => {
  const valid = { success: true, protocol: 'midea_ir', brand: 'Midea', raw_type: 'MIDEA', hex: '12AB' };
  for (const patch of [
    { raw_type: '', hex: '' }, { raw_type: 'KOPPEL_RAW', hex: '0x12A45C', protocol: 'koppel_ir', brand: 'Koppel' },
    { raw_type: 'UNKNOWN' }, { raw_type: 'RAW' }, { raw_type: 'NEC' }, { raw_type: 'DAIKIN999' },
    { success: false }, { success: 'true' }, { protocol: 'gree' }, { hex: '' }, { hex: '0x' }, { hex: 'not-a-capture' },
  ]) {
    const h = harness({ request: async () => response({ ...valid, ...patch }) });
    assert.equal((await device(h).sniffRemoteBrand('192.168.1.145')).success, false, JSON.stringify(patch));
    assert.equal(h.calls.length, 0);
  }
});

test('wizard IR detection recognizes actual AC family variants and preserves their decoder type', async () => {
  for (const [rawType, protocol, brand] of [
    ['MIDEA24', 'midea_ir', 'Midea'], ['GREE', 'gree', 'Gree'], ['DAIKIN216', 'daikin', 'Daikin'],
    ['CARRIER_AC128', 'carrier', 'Carrier'], ['PANASONIC_AC32', 'panasonic', 'Panasonic'],
    ['SAMSUNG_AC', 'samsung', 'Samsung'], ['MITSUBISHI136', 'mitsubishi', 'Mitsubishi'],
  ]) {
    const h = harness({ request: async () => response({ success: true, protocol, raw_type: rawType, hex: '0' }) });
    const result = await device(h).sniffRemoteBrand('ecotrack.local');
    assert.equal(result.success, true);
    assert.equal(result.brand, brand);
    assert.equal(result.rawType, rawType);
  }
});

test('wizard IR requests reject invalid or nonlocal destinations without issuing HTTP requests', async () => {
  const h = harness();
  for (const address of ['', ' ', '0.0.0.0', 'https://example.com', '8.8.8.8', '192.168.1.2/path', '192.168.1.2:0']) {
    assert.equal((await device(h).sniffRemoteBrand(address)).success, false);
  }
  assert.equal(h.requests.length, 0);
});

test('wizard IR HTTP, JSON and network failures return usable errors without claiming detection', async () => {
  for (const request of [
    async () => ({ ok: false, status: 503 }),
    async () => response([]),
    async () => ({ ok: true, json: async () => { throw Error('Invalid JSON'); } }),
    async () => { throw Error('Network unavailable'); },
  ]) {
    const result = await device(harness({ request })).sniffRemoteBrand('192.168.1.145');
    assert.equal(result.success, false);
    assert.ok(result.error);
    assert.equal(result.brand, undefined);
  }
});

test('wizard IR listening aborts at the transport deadline and returns a timeout message', async () => {
  const h = harness({ controllerTimeoutMs: 5, request: (_, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => { const error = Error('aborted'); error.name = 'AbortError'; reject(error); });
  }) });
  const result = await device(h).sniffRemoteBrand('192.168.1.145');
  assert.equal(result.success, false);
  assert.match(result.error, /timed out/);
  assert.equal(h.requests[0][1].signal.aborted, true);
});

function remoteWizard({ sniff = async () => ({ success: true, brand: 'Daikin', protocol: 'daikin' }), ip = '192.168.1.145', name = 'EcoTrack-node-6' } = {}) {
  const source = fs.readFileSync('src/app/devices.tsx', 'utf8');
  const parsed = ts.createSourceFile('devices.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = ['resetRemoteDetection', 'handleCloseAddModal', 'handleManualBrandChange', 'handleSniffRemote'];
  const pieces = [];
  const visit = node => {
    if (ts.isVariableDeclaration(node) && names.includes(node.name.getText(parsed))) pieces.push('const ' + node.getText(parsed) + ';');
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  assert.equal(pieces.length, names.length);
  const state = { brand: 'Manual Brand', name, listening: false, info: null, error: null, visible: true, haptics: 0, customBrand: 'Old Custom' };
  const calls = [], alerts = [], module = { exports: {} };
  const set = key => value => { state[key] = typeof value === 'function' ? value(state[key]) : value; };
  const code = pieces.join('\n') + '\nexports.handlers = { ' + names.join(',') + ' };';
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    module, exports: module.exports, assignedIp: ip, targetBleDevice: { deviceId: 'node-6', name: 'EcoTrack-node-6' },
    remoteSniffRequest: { current: { id: 0, listening: false } },
    DeviceService: { sniffRemoteBrand: async (...args) => { calls.push(args); return sniff(); } },
    setIsListeningRemote: set('listening'), setDetectedRemoteInfo: set('info'), setSniffError: set('error'),
    setSelectedBrand: set('brand'), setCustomBrandInput: set('customBrand'), setFriendlyName: set('name'), setAddModalVisible: set('visible'),
    triggerHaptic: () => { state.haptics += 1; }, Alert: { alert: (...args) => alerts.push(args) },
  });
  return { state, calls, alerts, ...module.exports.handlers };
}

test('wizard remote success autofills brand and generic names while preserving custom aircon names', async () => {
  for (const name of ['', 'EcoTrack-node-6', 'node-6 Aircon', 'EcoTrack Aircon Unit', 'Lab 204 AC']) {
    const h = remoteWizard({ name });
    await h.handleSniffRemote();
    assert.equal(h.state.brand, 'Daikin');
    assert.equal(h.state.name, name === 'Lab 204 AC' ? name : 'Daikin Aircon');
    assert.equal(h.state.info.brand, 'Daikin');
    assert.equal(h.state.info.protocol, 'daikin');
    assert.equal(h.state.customBrand, '');
    assert.equal(h.state.listening, false);
    assert.equal(h.state.error, null);
    assert.equal(h.state.haptics, 1);
    assert.deepEqual(h.calls[0], ['192.168.1.145', 'node-6']);
  }
});

test('wizard missing IP never starts listening and failures preserve manual selection with retry guidance', async () => {
  for (const ip of ['', '0.0.0.0']) {
    const h = remoteWizard({ ip });
    await h.handleSniffRemote();
    assert.equal(h.calls.length, 0);
    assert.equal(h.alerts[0][0], 'Device IP Unavailable');
    assert.equal(h.state.listening, false);
  }
  for (const sniff of [async () => ({ success: false, error: 'Listening timed out.' }), async () => { throw Error('Offline'); }]) {
    const h = remoteWizard({ sniff, name: 'Lab 204 AC' });
    await h.handleSniffRemote();
    assert.equal(h.state.brand, 'Manual Brand');
    assert.equal(h.state.name, 'Lab 204 AC');
    assert.equal(h.state.info, null);
    assert.equal(h.state.listening, false);
    assert.match(h.state.error, /manually below/);
  }
});

test('wizard blocks duplicate listening requests and ignores results after manual selection or closing', async () => {
  for (const action of ['manual', 'close', 'reset']) {
    let resolve;
    const h = remoteWizard({ sniff: () => new Promise(done => { resolve = done; }) });
    const pending = h.handleSniffRemote();
    assert.equal(h.state.listening, true);
    await h.handleSniffRemote();
    assert.equal(h.calls.length, 1);
    if (action === 'manual') h.handleManualBrandChange('Carrier');
    else if (action === 'close') h.handleCloseAddModal();
    else h.resetRemoteDetection();
    resolve({ success: true, brand: 'Daikin', protocol: 'daikin' });
    await pending;
    assert.equal(h.state.brand, action === 'manual' ? 'Carrier' : 'Manual Brand');
    assert.equal(h.state.info, null);
    assert.equal(h.state.listening, false);
    assert.equal(h.state.haptics, 0);
    if (action === 'close') assert.equal(h.state.visible, false);
  }
});

test('wizard retry accepts the current request and ignores an earlier cancelled request', async () => {
  const pending = [];
  const h = remoteWizard({ sniff: () => new Promise(resolve => pending.push(resolve)) });
  const oldRequest = h.handleSniffRemote();
  h.handleManualBrandChange('Gree');
  const retry = h.handleSniffRemote();
  pending[0]({ success: true, brand: 'Daikin', protocol: 'daikin' });
  await oldRequest;
  assert.equal(h.state.brand, 'Gree');
  assert.equal(h.state.listening, true);
  pending[1]({ success: true, brand: 'Carrier', protocol: 'carrier' });
  await retry;
  assert.equal(h.state.brand, 'Carrier');
  assert.equal(h.state.listening, false);
  h.handleManualBrandChange('Custom Brand');
  assert.equal(h.state.brand, 'Custom Brand');
  assert.equal(h.state.info, null);
});

test('remote detection card renders idle, listening, success and retry states with usable manual brand controls', () => {
  const source = fs.readFileSync('src/app/devices.tsx', 'utf8');
  const parsed = ts.createSourceFile('devices.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const pieces = [];
  const visit = node => {
    if (ts.isJsxElement(node) && node.openingElement.attributes.getText(parsed).includes('styles.inputGroup')) {
      const text = node.getText(parsed);
      if (text.includes('Auto-Detect Brand with Remote') || text.includes('Custom assign brand (e.g. Daikin, Carrier, Koppel, Midea)')) pieces.push(text);
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  assert.equal(pieces.length, 2);
  const js = ts.transpileModule('exports.render = () => <>' + pieces.join('\n') + '</>;', {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  for (const [status, flags, buttonText] of [
    ['idle', {}, 'Listen for Remote Signal'],
    ['listening', { isListeningRemote: true }, 'Listening for remote pulses...'],
    ['success', { detectedRemoteInfo: { brand: 'Daikin' } }, 'Re-scan'],
    ['failure', { sniffError: 'No signal detected. Select manually or retry.' }, 'Retry'],
  ]) {
    const module = { exports: {} }, changes = [];
    const listen = () => changes.push('listen'), manual = value => changes.push(value);
    const context = {
      module, exports: module.exports,
      React: { Fragment: 'Fragment', createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat() }) },
      styles: new Proxy({}, { get: () => ({}) }), isDark: false, colors: { emerald: '#10b981' },
      isListeningRemote: false, detectedRemoteInfo: null, sniffError: null, selectedBrand: 'Daikin', selectedAirconType: 'Split Type',
      handleSniffRemote: listen, handleManualBrandChange: manual, triggerHaptic() {},
      ...flags,
    };
    for (const name of ['View', 'ThemedText', 'AppIcon', 'Pressable', 'ActivityIndicator', 'TextInput', 'ScrollView']) context[name] = name;
    vm.runInNewContext(js, context);
    const nodes = [];
    const collect = node => { if (node && typeof node === 'object') { nodes.push(node); node.children.forEach(collect); } };
    const text = node => typeof node === 'string' ? node : node && typeof node === 'object' ? node.children.map(text).join('') : '';
    const tree = module.exports.render(); collect(tree);
    const button = nodes.find(node => node.type === 'Pressable' && node.props.onPress === listen);
    assert.ok(text(button).includes(buttonText), status);
    assert.equal(button.props.disabled, status === 'listening');
    assert.equal(nodes.filter(node => node.type === 'ActivityIndicator').length, status === 'listening' ? 1 : 0);
    if (status === 'success') assert.ok(text(tree).includes('Auto-Detected: Daikin'));
    if (status === 'failure') assert.ok(text(tree).includes(flags.sniffError));
    const input = nodes.find(node => node.type === 'TextInput');
    assert.equal(input.props.onChangeText, manual);
    input.props.onChangeText('My Custom Brand');
    const carrier = nodes.find(node => node.type === 'Pressable' && text(node) === 'Carrier');
    assert.ok(carrier && !carrier.props.disabled);
    carrier.props.onPress();
    assert.deepEqual(changes, ['My Custom Brand', 'Carrier']);
  }
});

test('IR and BLE stubs never claim completed hardware or storage operations', async () => {
  const h = harness(), controller = ac(h);
  assert.equal(await controller.dispatchIntent('192.168.1.2', { protocol: 'gree', state: { power: false } }), false);
  assert.equal((await controller.testTransmit('node-1', 'POWER_OFF')).success, false);
  assert.equal(await controller.deleteIrCommand('node-1', 'POWER_OFF'), false);
  assert.equal(await controller.deleteCustomFunction('node-1', 'Eco'), false);
  await assert.rejects(controller.captureIrSignal('node-1', 'POWER_OFF'), /not implemented/);
  await assert.rejects(controller.saveIrCommand({}), /unavailable/);
  await assert.rejects(controller.addCustomFunction('node-1', 'Eco'), /not implemented/);
  assert.equal(await ble(h).connectBle('node-1'), false);
  assert.equal((await ble(h).configureWifi('node-1', 'SSID', 'secret')).success, false);
  assert.equal(h.requests.length, 0);
});

test('remembered Wi-Fi networks contain no invented signal measurement', async () => {
  const h = harness({ initial: { '@ecotrack_saved_wifi_ssids': '["Campus"]' } });
  const networks = await ble(h).scanWifiNetworks();
  assert.equal(networks[0].ssid, 'Campus');
  assert.equal(networks[0].isSaved, true);
  assert.equal(networks[0].signalStrength, undefined);
  assert.equal(networks[0].signalLevel, undefined);
});

test('phone Wi-Fi is fetched fresh, unquoted, first and deduplicated with saved and registered names', async () => {
  let ssid = '"Campus"';
  const h = harness({
    initial: { '@ecotrack_saved_wifi_ssids': '["Campus","Staff"]' },
    wifiState: () => ({ type: 'wifi', isConnected: true, isInternetReachable: false, details: { ssid, frequency: 2412 } }),
    respond: () => ({ data: [{ wifi_ssid: 'Campus' }, { wifi_ssid: 'Lab' }] }),
  });
  const networks = await ble(h).scanWifiNetworks();
  assert.deepEqual(Array.from(networks, net => net.ssid), ['Campus', 'Staff', 'Lab']);
  assert.equal(networks[0].isConnectedPhone, true);
  assert.equal(networks[0].isSaved, true);
  assert.equal(networks[0].frequency, '2.4 GHz');
  assert.equal(networks[0].signalStrength, undefined);
  ssid = 'Other Network';
  assert.equal((await ble(h).getConnectedPhoneWifi()).ssid, 'Other Network');
  assert.equal(h.calls.filter(call => call.netInfoRefresh).length, 2);
});

test('unknown SSIDs and disconnected Wi-Fi never become selectable phone networks', async () => {
  for (const ssid of [null, '', '"<unknown ssid>"']) {
    const h = harness({ wifiState: { type: 'wifi', isConnected: true, details: { ssid } } });
    const phone = await ble(h).getConnectedPhoneWifi();
    assert.equal(phone.isWifi, true);
    assert.equal(phone.ssid, null);
    assert.equal((await ble(h).scanWifiNetworks(phone)).length, 0);
  }
  for (const state of [{ type: 'cellular', isConnected: true }, { type: 'none', isConnected: false }, { type: 'wifi', isConnected: false, details: { ssid: 'Old Network' } }]) {
    const phone = await ble(harness({ wifiState: state })).getConnectedPhoneWifi();
    assert.equal(phone.isWifi, false);
    assert.equal(phone.ssid, null);
  }
});

test('no mock networks are injected, while legitimately saved or registered names remain available', async () => {
  assert.equal((await ble(harness()).scanWifiNetworks()).length, 0);
  const h = harness({ initial: { '@ecotrack_saved_wifi_ssids': '["EcoTrack-IoT"]' }, respond: () => ({ data: [{ wifi_ssid: 'MobileHotspot' }] }) });
  assert.deepEqual(Array.from(await ble(h).scanWifiNetworks(), net => net.ssid), ['EcoTrack-IoT', 'MobileHotspot']);
});

test('Wi-Fi permission failures preserve saved networks and do not call the native SSID API', async () => {
  for (const [options, error] of [
    [{ locationEnabled: false }, 'location-disabled'],
    [{ locationPermission: { granted: false } }, 'permission-denied'],
    [{ locationPermission: { granted: true, android: { accuracy: 'coarse' } } }, 'precise-location-required'],
  ]) {
    const h = harness({ ...options, initial: { '@ecotrack_saved_wifi_ssids': '["Campus"]' } });
    const phone = await ble(h).getConnectedPhoneWifi();
    assert.equal(phone.error, error);
    assert.equal((await ble(h).scanWifiNetworks(phone))[0].ssid, 'Campus');
    assert.ok(!h.calls.some(call => call.netInfoRefresh));
  }
});

test('iOS enables SSID access only with precise permission and avoids resetting listeners on each search', async () => {
  let granted = true;
  const h = harness({ os: 'ios', locationPermission: () => ({ granted, ios: { accuracy: 'full' } }), wifiState: { type: 'wifi', isConnected: true, details: { ssid: 'Campus' } } });
  assert.equal((await ble(h).getConnectedPhoneWifi()).ssid, 'Campus');
  await ble(h).getConnectedPhoneWifi();
  assert.equal(h.calls.filter(call => call.netInfoConfig).length, 1);
  assert.equal(h.calls.find(call => call.netInfoConfig).netInfoConfig.shouldFetchWiFiSSID, true);
  granted = false;
  assert.equal((await ble(h).getConnectedPhoneWifi()).error, 'permission-denied');
  assert.equal(h.calls.at(-1).netInfoConfig.shouldFetchWiFiSSID, false);
  const reduced = harness({ os: 'ios', locationPermission: { granted: true, ios: { accuracy: 'reduced' } } });
  assert.equal((await ble(reduced).getConnectedPhoneWifi()).error, 'precise-location-required');
  assert.ok(!reduced.calls.some(call => call.netInfoConfig || call.netInfoRefresh));
});

test('web, Expo Go and unavailable native state keep manual Wi-Fi entry usable', async () => {
  for (const options of [{ os: 'web' }, { os: 'ios', appOwnership: 'expo' }]) {
    const h = harness(options);
    assert.equal((await ble(h).getConnectedPhoneWifi()).error, 'unsupported');
    assert.equal(h.calls.length, 0);
  }
  const broken = harness({ wifiState: () => { throw Error('Native module unavailable'); } });
  assert.equal((await ble(broken).getConnectedPhoneWifi()).error, 'unavailable');
});

test('phone frequency is reported accurately instead of presenting 5 GHz as 2.4 GHz', async () => {
  for (const [frequency, label] of [[5180, '5 GHz'], [5955, '6 GHz'], [undefined, undefined]]) {
    const h = harness({ wifiState: { type: 'wifi', isConnected: true, details: { ssid: 'Campus', frequency } } });
    assert.equal((await ble(h).scanWifiNetworks())[0].frequency, label);
  }
});

test('Add and Reconfigure Auto Search select current phone Wi-Fi and retain manual entry on failure', async () => {
  const source = fs.readFileSync('src/app/devices.tsx', 'utf8');
  const parsed = ts.createSourceFile('devices.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const pieces = [];
  const visit = node => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'alertPhoneWifiUnavailable') pieces.push(node.getText(parsed));
    if (ts.isVariableDeclaration(node) && ['handleScanWifiNetworks', 'handleScanReconfigWifi'].includes(node.name.getText(parsed))) pieces.push('const ' + node.getText(parsed) + ';');
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  assert.equal(pieces.length, 3);
  const js = ts.transpileModule(pieces.join('\n') + '\nexports.handlers = [handleScanWifiNetworks, handleScanReconfigWifi];', {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  let phone = { ssid: 'Phone Network', isWifi: true };
  const module = { exports: {} }, alerts = [], args = [], loading = [], selection = ['Old Saved', 'Old Saved'];
  vm.runInNewContext(js, {
    module, exports: module.exports,
    BleDeviceService: {
      getConnectedPhoneWifi: async () => phone,
      scanWifiNetworks: async state => { args.push(state); return [{ ssid: state.ssid || 'Saved Facility' }]; },
    },
    setSelectedWifiSsid: value => { selection[0] = value; },
    setReconfigSelectedSsid: value => { selection[1] = value; },
    setScanningWifi: value => loading.push(value), setReconfigScanningWifi: value => loading.push(value),
    setDiscoveredWifiNetworks() {}, setReconfigWifiNetworks() {},
    Alert: { alert: (...values) => alerts.push(values) }, console,
  });
  for (const handler of module.exports.handlers) await handler(true, true);
  assert.deepEqual(selection, ['Phone Network', 'Phone Network']);
  assert.equal(alerts.length, 0);
  assert.ok(args.every(arg => arg === phone));
  assert.deepEqual(loading, [true, false, true, false]);
  phone = { ssid: null, isWifi: false };
  for (const handler of module.exports.handlers) await handler(true, true);
  assert.deepEqual(selection, ['Phone Network', 'Phone Network']);
  assert.equal(alerts.length, 2);
  assert.ok(alerts.every(alert => alert[0] === 'Phone Not Connected to Wi-Fi'));
  for (const handler of module.exports.handlers) await handler(true);
  assert.equal(alerts.length, 2);
  phone = { ssid: null, isWifi: false, error: 'permission-denied' };
  for (const handler of module.exports.handlers) await handler(true, true);
  assert.ok(alerts.slice(-2).every(alert => alert[0] === 'Wi-Fi Name Unavailable' && /permission/.test(alert[1])));
});

test('a database online flag alone cannot pass the connection test', async () => {
  const h = harness({ respond: () => ({ data: [{ id: 'node_1', name: 'node-1', status: 'online' }], error: null }) });
  assert.equal((await ble(h).testDeviceConnection('node_1')).online, false);
  assert.equal(h.requests.length, 0);
});

test('device save is a single atomic RPC and never fabricates online telemetry', async () => {
  const h = harness({ respond: q => q.rpc ? { data: { node: { id: 'node_1', room_id: 'room_1' }, aircon: { id: 'ac_1' } }, error: null } : { data: [], error: null } });
  const saved = await device(h).saveDevice({ deviceId: 'node_1', name: 'Node 1', roomId: 'custom:Campus', brand: 'Midea', temp: 24 });
  const rpc = h.calls.find(q => q.rpc);
  assert.equal(rpc.rpc, 'ecotrack_device_mutation');
  assert.equal(rpc.args.p_operation, 'save_node');
  assert.equal(rpc.args.p_payload.room_id, 'custom:Campus');
  assert.equal(rpc.args.p_payload.temp, undefined);
  assert.equal(rpc.args.p_payload.status, undefined);
  assert.equal(saved.status, 'offline');
  assert.equal(h.calls.some(q => q.ops?.some(([operation]) => ['insert', 'upsert', 'update'].includes(operation))), false);
});

test('failed atomic node save does not leave local success or owner cache', async () => {
  const h = harness({ respond: () => ({ data: null, error: { message: 'conflicting asset tag' } }) });
  await assert.rejects(device(h).saveDevice({ deviceId: 'node_1', name: 'Node 1', addedByUserId: 'staff-1' }), /conflicting/);
  assert.equal(h.stored.size, 0);
  assert.equal(h.calls.length, 1);
});

test('AC save uses the committed server identity and does not infer AC power', async () => {
  const h = harness({ respond: () => ({ data: { aircon: { id: 'ac_db', asset_tag: 'AC-1', brand: 'Midea', status: 'offline' } }, error: null }) });
  const saved = await ac(h).saveAircon({ deviceId: 'AC-1', brand: 'Midea', power: 'ON', status: 'online' });
  assert.equal(saved.id, 'ac_db');
  assert.equal(saved.status, 'offline');
  assert.equal(saved.power, undefined);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].args.p_operation, 'save_aircon');
});

test('AC deletion clears cache only after the atomic delete is acknowledged', async () => {
  const initial = { '@ecotrack_aircons': JSON.stringify([{ id: 'ac_db', deviceId: 'AC-1' }]) };
  const denied = harness({ initial, respond: () => ({ error: { message: 'denied' }, data: null }) });
  assert.equal(await ac(denied).deleteAircon('AC-1'), false);
  assert.equal(JSON.parse(denied.stored.get('@ecotrack_aircons')).length, 1);
  const permitted = harness({ initial, respond: () => ({ data: { deleted: true, id: 'ac_db' }, error: null }) });
  assert.equal(await ac(permitted).deleteAircon('AC-1'), true);
  assert.equal(JSON.parse(permitted.stored.get('@ecotrack_aircons')).length, 0);
});

test('stale local AC cache cannot recreate a server-deleted controller', async () => {
  const h = harness({ initial: { '@ecotrack_aircons': JSON.stringify([{ deviceId: 'deleted-ac' }]) } });
  assert.equal((await ac(h).getAllAircons()).length, 0);
});

test('AC inventory retains exact configured protocol variants for physical intent', async()=>{
  const h=harness({respond:q=>({error:null,data:q.ops.some(op=>op[0]==='gt')?[]:q.table==='aircons'?[{id:'ac_db',asset_tag:'AC-1',brand:'Daikin',protocol:'daikin',protocol_name:'DAIKIN2',node_id:'node_1'}]:q.table==='nodes'?[{id:'node_1',name:'Node One',ip_address:'192.168.1.40',status:'online'}]:[]})});
  const saved=await ac(h).getAllAircons();assert.equal(saved[0].protocolName,'DAIKIN2');assert.equal(saved[0].nodeIp,'192.168.1.40');
});

test('an unacknowledged node deletion does not report success', async () => {
  const h = harness({ respond: () => ({ data: {}, error: null }) });
  assert.equal(await device(h).removeDevice('node_1'), false);
});
