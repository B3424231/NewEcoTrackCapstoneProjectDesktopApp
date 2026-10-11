const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const hardwareId = 'esp32s3-9cd20604a7ac', nodeId = 'node-shared', acId = 'ac-shared';
function harness(respond, nativeDevice) {
  let now = Date.parse('2026-10-11T08:00:00Z'), nonce = 0;
  const loaded = new Map(), calls = [], channels = [];
  const client = {
    from(table) {
      const call = { table, ops: [] }; calls.push(call);
      const query = new Proxy({}, { get(_, name) {
        if (name === 'then') return (resolve, reject) => Promise.resolve(respond(call)).then(resolve, reject);
        return (...args) => { call.ops.push([name, ...args]); return query; };
      } }); return query;
    },
    async rpc(name, args) { const call = { rpc: name, args }; calls.push(call); return respond(call); },
    channel(name, options) {
      const handlers = [], channel = { name, options, handlers, on(type, filter, callback) { handlers.push({ type, filter, callback }); return channel; }, subscribe() { return channel; } };
      channels.push(channel); return channel;
    },
    removeChannel() {},
  };
  class FakeDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  function load(file) {
    file = path.resolve(file);
    if (!fs.existsSync(file)) file += fs.existsSync(file + '.ts') ? '.ts' : '.js';
    if (loaded.has(file)) return loaded.get(file).exports;
    const module = { exports: {} }; loaded.set(file, module);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, allowJs: true }}).outputText;
    function req(spec) {
      if (spec === './supabase') return { supabase: client, SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_ANON_KEY: 'sb_publishable_fixture' };
      if (spec === 'react-native') return { Platform: { OS: 'android' }, PermissionsAndroid: {} };
      if (spec === 'react-native-ble-plx') return { BleManager: class { async isDeviceConnected() { return true; } async devices() { return [nativeDevice]; } } };
      if (spec === '@react-native-async-storage/async-storage') return { getItem: async () => null, setItem: async () => {} };
      if (spec.startsWith('.')) return load(path.resolve(path.dirname(file), spec));
      throw Error('Unexpected dependency ' + spec);
    }
    vm.runInNewContext(code, { module, exports: module.exports, require: req, Date: FakeDate, console,
      crypto: { randomUUID: () => '00000000-0000-4000-8000-' + (++nonce).toString().padStart(12, '0') },
      btoa: value => Buffer.from(value, 'binary').toString('base64'), atob: value => Buffer.from(value, 'base64').toString('binary'),
      setTimeout: callback => { now += 700; callback(); return 1; }, clearTimeout() {}, setInterval() { return 1; }, clearInterval() {} }, { filename: file });
    return module.exports;
  }
  return { load, calls, channels };
}
const fresh = { node_id: nodeId, device_id: hardwareId, last_seen: '2026-10-11T08:00:00Z', capabilities: { ir_transmitter: true } };
const setup = { controller_name: 'AC Controller 1', assignment_mode: 'existing', aircon_id: acId, room_id: 'room-1', brand: 'Matrix', aircon_type: 'Split Type (Inverter)', protocol_name: 'TCL112AC' };
const capture = (state, sequence = 1) => ({ protocol: 'TCL112AC', raw_count: 227, sequence, captured_at_epoch_ms: Date.parse('2026-10-11T08:00:00Z'), state });
function rows(call, data) { return { data: call.ops.some(op => op[0] === 'gt') ? [] : data, error: null }; }

test('firmware chunks reconstruct UTF-8 and UUID-correlated payload with 220-byte limit', () => {
  const p = harness(() => {}).load('src/services/ble-protocol.ts');
  const request = p.provisioningPackets({ device_id: hardwareId, ssid: 'Lab 研究', pass: 'valid-password', device_token: 'a'.repeat(64) });
  assert.match(request.id, /^[0-9a-f-]{36}$/);
  assert.ok(request.packets.every(packet => Buffer.byteLength(packet, 'binary') <= 220));
  const chunks = request.packets.map((packet, index) => {
    assert.ok(packet.startsWith(request.id + ':' + index + ':' + request.packets.length + ':'));
    return packet.replace(/^[^:]+:\d+:\d+:/, '');
  });
  const decoded = JSON.parse(Buffer.from(chunks.join(''), 'binary').toString('utf8'));
  assert.equal(decoded.ssid, 'Lab 研究'); assert.equal(decoded.device_id, hardwareId); assert.equal(decoded.request_id, request.id);
  assert.throws(() => p.validateWifi('Lab', 'short')); assert.throws(() => p.validateWifi('Lab', 'é'.repeat(32)));
});

test('heartbeat freshness, future-clock limit and sleep override metadata status', () => {
  const { connectionStatus } = harness(() => {}).load('src/services/cloud-hardware.ts');
  const now = Date.parse(fresh.last_seen);
  assert.equal(connectionStatus(fresh, now), 'online');
  assert.equal(connectionStatus(fresh, now + 45001), 'offline');
  assert.equal(connectionStatus({ ...fresh, sleeping_until: '2026-10-11T09:00:00Z' }, now), 'sleeping');
  assert.equal(connectionStatus({ ...fresh, last_seen: '2026-10-11T08:00:06Z' }, now), 'offline');
});
test('cloud inventory paginates by node_id, including more than one page', async () => {
  const h = harness(call => rows(call, [fresh]));
  const data = await h.load('src/services/cloud-hardware.ts').CloudHardware.list();
  assert.equal(data.length, 1); assert.equal(h.calls.length, 2);
  assert.ok(h.calls.every(call => call.ops.some(op => op[0] === 'order' && op[1] === 'node_id')));
});
test('existing registration reuses the same node and AC without token rotation or BLE writes', async () => {
  const h = harness(call => {
    if (call.table) return { data: fresh, error: null };
    const responses = {
      ecotrack_validate_controller_assignment: { valid: true },
      ecotrack_controller_registration_status: { requires_credentials: false, node: { id: nodeId }, aircon: { id: acId } },
      ecotrack_finish_controller_registration: { success: true, connected: true, node: { id: nodeId }, aircon: { id: acId } },
    };
    assert.ok(responses[call.rpc], 'Unexpected credential mutation'); return { data: responses[call.rpc], error: null };
  });
  const saved = await h.load('src/services/cloud-hardware.ts').CloudHardware.register({ device_id: hardwareId, cloud_protocol: 1, cloud_status: 'verified', node_id: nodeId }, setup, { ssid: '', pass: '' }, () => { throw Error('Unexpected BLE write'); });
  assert.equal(saved.node.id, nodeId); assert.equal(saved.aircon.id, acId);
});
test('invalid Wi-Fi password fails before refreshing cloud credentials', async () => {
  const h = harness(call => ({ data: call.rpc === 'ecotrack_validate_controller_assignment' ? { valid: true } : { requires_credentials: true }, error: null }));
  await assert.rejects(h.load('src/services/cloud-hardware.ts').CloudHardware.register({ device_id: hardwareId, cloud_protocol: 1, cloud_status: 'unconfigured' }, setup, { ssid: 'Lab', pass: 'short' }, async () => {}), /password/);
  assert.ok(!h.calls.some(call => call.rpc === 'ecotrack_prepare_controller_registration'));
});
test('fresh registration delivers temporary credentials and finalizes after a real matching heartbeat', async () => {
  let writes = 0;
  const prepared = { node: { id: nodeId }, device_token: 'a'.repeat(64) };
  const h = harness(call => {
    if (call.table) return { data: fresh, error: null };
    const data = { ecotrack_validate_controller_assignment: { valid: true },
      ecotrack_controller_registration_status: { requires_credentials: true },
      ecotrack_prepare_controller_registration: prepared,
      ecotrack_finish_controller_registration: { success: true, connected: true, node: { id: nodeId }, aircon: { id: acId } } }[call.rpc];
    return { data, error: null };
  });
  const result = await h.load('src/services/cloud-hardware.ts').CloudHardware.register({ device_id: hardwareId, cloud_protocol: 1 }, setup,
    { ssid: 'Lab', pass: 'valid-password' }, async payload => {
      writes++; assert.equal(payload.device_id, hardwareId); assert.equal(payload.device_token.length, 64);
      return { device_id: hardwareId, cloud_protocol: 1, cloud_status: 'verified' };
    });
  assert.equal(writes, 1); assert.equal(result.node.id, nodeId); assert.equal(prepared.device_token, undefined);
});
test('offline registration never reports inventory-only setup success', async () => {
  const h = harness(call => ({ data: call.table ? { ...fresh, last_seen: '2026-10-10T08:00:00Z' } :
    call.rpc === 'ecotrack_validate_controller_assignment' ? { valid: true } : { node: { id: nodeId }, requires_credentials: false }, error: null }));
  await assert.rejects(h.load('src/services/cloud-hardware.ts').CloudHardware.register({ device_id: hardwareId, cloud_protocol: 1, cloud_status: 'verified' }, setup, { ssid: '', pass: '' }, async () => {}), /heartbeat/);
  assert.ok(!h.calls.some(call => call.rpc === 'ecotrack_finish_controller_registration'));
});
test('cloud command requires ESP32 acknowledgement and never calls client-side ack RPC', async () => {
  let id;
  const h = harness(call => {
    if (call.rpc) { id = call.args.p_request_id; return { data: { id, node_id: nodeId, kind: 'ac_intent' }, error: null }; }
    return { data: call.table === 'ecotrack_device_state' ? fresh :
      { node_id: nodeId, kind: 'ac_intent', status: 'completed', result: { success: true, command_id: id } }, error: null };
  });
  const result = await h.load('src/services/cloud-hardware.ts').CloudHardware.request(nodeId, 'ac_intent', { aircon_id: acId, protocol: 'TCL112AC', state: { power: 'off' } });
  assert.ok(result.command_id); assert.equal(h.calls.filter(call => call.rpc).length, 1);
  assert.equal(h.calls.find(call => call.rpc).rpc, 'ecotrack_cloud_request');
});
test('wrong ACK, failed request, timeout and staff denial cannot become command success', async () => {
  for (const scenario of ['wrong', 'failed', 'timeout', 'staff']) {
    const h = harness(call => {
      if (call.table === 'ecotrack_device_state') return { data: fresh, error: null };
      if (call.rpc) return scenario === 'staff' ? { data: null, error: { code: '42501', message: 'Admin required' } } :
        { data: { id: call.args.p_request_id, node_id: nodeId, kind: 'ping' }, error: null };
      return { data: { node_id: nodeId, kind: 'ping', status: scenario === 'wrong' ? 'completed' : scenario === 'failed' ? 'failed' : 'claimed',
        result: { success: true, command_id: 'wrong', error: 'Rejected' } }, error: null };
    });
    await assert.rejects(h.load('src/services/cloud-hardware.ts').CloudHardware.request(nodeId, 'ping', {}, 1000));
  }
});
test('remote OFF overrides older ON; partial features keep independent field timestamps', () => {
  const state = harness(() => {}).load('src/services/receiver-state.ts');
  const previous = { desired_state: { power: 'on', temp: 25, fan: 'high' }, commanded_at: '2026-10-11T07:00:00Z' };
  const observed = state.remoteObservation(capture({ power: false, mode: 'cool', fan: 'auto', temp: 20 }), fresh.last_seen, previous);
  assert.equal(state.selectSettings({ ...previous, ...observed }).state.power, false);
  const partial = { ...capture({ turbo: true }, 2), frame_kind: 'partial_state', captured_at_epoch_ms: Date.parse('2026-10-11T08:00:01Z') };
  const next = state.remoteObservation(partial, fresh.last_seen, observed);
  assert.equal(next.observed_remote_state.power, false); assert.equal(next.observed_remote_state.turbo, true);
  assert.equal(next.observed_remote_field_at.power, '2026-10-11T08:00:00.000Z');
  const command = { ...previous, ...next, desired_state: { power: 'on' }, commanded_at: '2026-10-11T08:00:00.500Z' };
  assert.equal(state.selectSettings(command).state.power, 'on'); assert.equal(state.selectSettings(command).state.turbo, true);
});
test('UNKNOWN and settings-only captures preserve last decoded power', () => {
  const state = harness(() => {}).load('src/services/receiver-state.ts');
  const saved = state.remoteObservation(capture({ power: false }), fresh.last_seen);
  for (const change of [{ protocol: 'UNKNOWN' }, { frame_kind: 'settings_only' }]) {
    const observed = state.remoteObservation({ ...capture({ power: true }, 2), ...change }, fresh.last_seen, saved);
    assert.equal(observed.observed_remote_state.power, false);
  }
});
test('exact shared registry supports TCL half-degree steps and does not infer Matrix protocol', () => {
  const registry = harness(() => {}).load('src/services/ac-capability-registry.js').default;
  assert.equal(registry.protocol('DAIKIN2'), 'DAIKIN2'); assert.equal(registry.protocol('Matrix'), 'UNKNOWN');
  assert.equal(registry.capabilities('TCL112AC').temperature_step, 0.5);
  assert.equal(registry.capabilities('UNKNOWN').can_transmit, false); assert.equal(registry.capabilities('TCL112AC').turbo, true);
});
test('inventory uses desktop controller name, stable hardware ID and heartbeat firmware', async () => {
  const h = harness(call => rows(call, ({ nodes: [{ id: nodeId, name: 'AC Controller 1', status: 'online' }],
    aircons: [{ id: acId, controller_node_id: nodeId, name: 'Matrix', asset_tag: 'AC-1' }],
    ecotrack_device_state: [{ ...fresh, firmware_version: 'cloud-ir-controller-1.8-capabilities' }] })[call.table] || []));
  const devices = await h.load('src/services/device-service.ts').DeviceService.getDevices();
  assert.equal(devices[0].name, 'AC Controller 1'); assert.equal(devices[0].deviceId, hardwareId);
  assert.equal(devices[0].firmwareVersion, 'cloud-ir-controller-1.8-capabilities'); assert.equal(devices[0].status, 'connected');
});
test('receiver event updates only the linked controller without any database fetch', () => {
  const h = harness(() => {});
  const service = h.load('src/services/ac-controller-service.ts').AcControllerService;
  const one = { id: acId, nodeId, controlSnapshot: { desired_state: { power: 'on' }, commanded_at: '2026-10-11T07:00:00Z' } };
  const next = service.applyHardwareState(one, { ...fresh, latest_ir: capture({ power: false, mode: 'cool', fan: 'quiet', temp: 20 }) });
  assert.equal(next.power, 'OFF'); assert.equal(next.desiredState.fan, 'quiet'); assert.equal(next.setTemp, 20); assert.equal(next.protocolName, 'TCL112AC');
  const other = { ...one, nodeId: 'other-node' };
  assert.equal(service.applyHardwareState(other, fresh), other); assert.equal(h.calls.length, 0);
});
test('BLE sender uses cloud protocol chunks and validates returned identity and IP', async () => {
  let info = { device_id: hardwareId, cloud_protocol: 1, wifi_status: 'disconnected' }, frames = [];
  const ble = { async discoverAllServicesAndCharacteristics() {}, async requestMTU() {},
    async readCharacteristicForService() { return { value: Buffer.from(JSON.stringify(info)).toString('base64') }; },
    async writeCharacteristicWithResponseForService(service, characteristic, value) {
      const binary = Buffer.from(value, 'base64').toString('binary'); frames.push(binary);
      const [id, index, total] = binary.split(':');
      if (frames.length === Number(total)) {
        const payload = JSON.parse(Buffer.from(frames.map(frame => frame.replace(/^[^:]+:\d+:\d+:/, '')).join(''), 'binary').toString('utf8'));
        info = { ...info, request_id: id, wifi_status: 'connected', wifi_ssid: payload.ssid, ip_address: '192.168.1.66', cloud_status: 'verified' };
      }
    } };
  const service = harness(() => ({ data: [], error: null }), ble).load('src/services/device-service.ts').BleDeviceService;
  const receipt = await service.provisionCloud('AA:BB:CC:DD:EE:FF', { ssid: 'Lab', pass: 'valid-password', device_id: hardwareId });
  assert.equal(receipt.ip_address, '192.168.1.66');
  await assert.rejects(service.provisionCloud('AA:BB:CC:DD:EE:FF', { ssid: 'Lab', pass: 'valid-password' }, false, 'esp32s3-111111111111'), /match/);
});
