/* Supabase hardware transport + nearby BLE provisioning. No local-IP dispatch. */
(function (root) {
  'use strict';
  const SERVICE = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
  const INFO = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';
  const WIFI = '1c95d5e3-d8f7-413a-bf3d-7a2e5d7be87e';
  const state = { device: null, info: null, writer: null, identity: null };
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const timestamp = () => root.performance?.now?.() ?? Date.now();
  const client = () => {
    const sb = root.supabaseClient || root.sb;
    if (!sb?.rpc) throw new Error('Sign in and connect to Supabase first.');
    return sb;
  };
  function publicKey(key) {
    if (key?.startsWith('sb_publishable_')) return true;
    try { return JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role === 'anon'; }
    catch (_) { return false; }
  }
  function failure(error) {
    const missing = ['PGRST202', 'PGRST205', '42P01'].includes(error?.code);
    const message = missing ? 'Cloud hardware setup is missing. Run supabase_cloud_hardware_migration.sql in Supabase SQL Editor.' : error?.message || 'Cloud request failed.';
    return Object.assign(new Error(message), { code: error?.code });
  }
  async function rpc(name, args) {
    const response = await client().rpc(name, args);
    if (response.error) throw failure(response.error);
    if (!response.data) throw new Error('Supabase returned no confirmation.');
    return response.data;
  }
  function identityMatches(info) {
    return /^esp32s3-[a-f0-9]{12}$/.test(info?.device_id || '') && info.cloud_protocol === 1;
  }
  async function readInfo() {
    if (!state.device?.gatt?.connected || !state.info) throw new Error('Reconnect the nearby ESP32 through Bluetooth.');
    const value = await state.info.readValue();
    const info = JSON.parse(new TextDecoder().decode(value));
    if (!identityMatches(info)) throw new Error('Install the new EcoTrack cloud receiver sketch on this ESP32 first.');
    if (state.identity && state.identity !== info.device_id) throw new Error('Bluetooth device identity does not match this setup.');
    state.identity = info.device_id;
    return info;
  }
  async function connect() {
    if (!root.navigator?.bluetooth?.requestDevice) throw new Error('Bluetooth provisioning requires EcoTrack desktop with a working Bluetooth adapter.');
    if (state.device?.gatt?.connected) state.device.gatt.disconnect();
    const device = await root.navigator.bluetooth.requestDevice({ filters: [{ namePrefix: 'EcoTrack-' }], optionalServices: [SERVICE] });
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE);
    state.device = device;
    state.identity = null;
    state.info = await service.getCharacteristic(INFO);
    state.writer = await service.getCharacteristic(WIFI);
    const info = await readInfo();
    device.addEventListener?.('gattserverdisconnected', () => { if (state.device === device) { state.info = null; state.writer = null; } });
    return { ...info, bluetooth_name: device.name || info.device_id };
  }
  async function provision(payload, cloud = false) {
    const info = await readInfo();
    if (payload.device_id && payload.device_id !== info.device_id) throw new Error('Wrong Bluetooth device selected.');
    if (typeof payload.ssid !== 'string' || !payload.ssid.trim() || new TextEncoder().encode(payload.ssid).length > 32 ||
        typeof payload.pass !== 'string' || new TextEncoder().encode(payload.pass).length < 8 || new TextEncoder().encode(payload.pass).length > 63) throw new Error('Enter a Wi-Fi name and a password of 8..63 bytes.');
    const requestId = root.crypto.randomUUID();
    const bytes = new TextEncoder().encode(JSON.stringify({ ...payload, device_id: info.device_id, request_id: requestId }));
    if (bytes.length > 2048) throw new Error('Provisioning payload is too large.');
    const total = Math.ceil(bytes.length / 160);
    for (let index = 0; index < total; index++) {
      const header = new TextEncoder().encode(`${requestId}:${index}:${total}:`);
      const part = bytes.slice(index * 160, (index + 1) * 160);
      const packet = new Uint8Array(header.length + part.length);
      packet.set(header); packet.set(part, header.length);
      await state.writer.writeValueWithResponse(packet);
    }
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      await delay(700);
      const current = await readInfo();
      if (current.request_id !== requestId) continue;
      if (current.wifi_status === 'error' || (cloud && current.cloud_status === 'error')) throw new Error(current.error || 'The device rejected this connection.');
      if (current.wifi_status === 'connected' && (!cloud || current.cloud_status === 'verified')) return current;
    }
    throw new Error(cloud ? 'Wi-Fi connected, but no Supabase device acknowledgement arrived. Check the migration, internet connection, and Serial Monitor.' : 'ESP32 did not confirm Wi-Fi connection. Check its 2.4 GHz network and password.');
  }
  async function register(metadata, credentials) {
    const info = await readInfo();
    const config = root.ECOTRACK_CONFIG;
    if (!config?.supabaseUrl?.startsWith('https://') || !publicKey(config.supabaseKey)) throw new Error('A Supabase HTTPS URL and publishable key are required.');
    const registration = await rpc('ecotrack_register_cloud_device', { p_device_id: info.device_id, p_metadata: metadata });
    if (!registration.node?.id || !/^[a-f0-9]{64}$/.test(registration.device_token || '')) throw new Error('Invalid cloud device registration response.');
    try {
      const confirmed = await provision({ ...credentials, supabase_url: config.supabaseUrl, supabase_key: config.supabaseKey,
        device_token: registration.device_token, device_id: info.device_id }, true);
      const cloudState = await getStatus(registration.node.id);
      if (cloudState.device_id !== confirmed.device_id || cloudState.connection_status !== 'online') throw new Error('Device cloud heartbeat was not confirmed.');
      state.device.gatt.disconnect();
      return { node: registration.node, info: confirmed, cloud_state: cloudState };
    } finally { delete registration.device_token; }
  }
  async function resolveNode(nodeId) {
    const local = root.EcoTrackAirconSystem?.NodeService?.getNode?.(nodeId);
    if (local?.db_id || local?.pb_id) return local.db_id || local.pb_id;
    let query = client().from('nodes').select('id');
    let response = await query.eq('id', nodeId).maybeSingle();
    if (response.error) throw failure(response.error);
    if (response.data?.id) return response.data.id;
    response = await client().from('nodes').select('id').eq('name', nodeId).maybeSingle();
    if (response.error) throw failure(response.error);
    if (!response.data?.id) throw new Error('This controller was not found in Supabase. Complete Save & Verify Controller in the registration wizard first.');
    return response.data.id;
  }
  function describe(device) {
    const wake = Date.parse(device?.sleeping_until || '');
    const seen = Date.parse(device?.last_seen || '');
    if (Number.isFinite(wake) && wake > Date.now()) return 'sleeping';
    return Number.isFinite(seen) && Date.now() - seen <= 45000 && seen <= Date.now() + 5000 ? 'online' : 'offline';
  }
  async function getStatus(nodeId) {
    const id = await resolveNode(nodeId);
    const response = await client().from('ecotrack_device_state').select('*').eq('node_id', id).maybeSingle();
    if (response.error) throw failure(response.error);
    if (!response.data) throw new Error('Provision this controller through Bluetooth first.');
    return { ...response.data, connection_status: describe(response.data) };
  }
  async function listStatus() {
    const response = await client().from('ecotrack_device_state').select('*');
    if (response.error) throw failure(response.error);
    if (!Array.isArray(response.data)) throw new Error('Invalid cloud device status response.');
    return response.data.map(item => ({ ...item, connection_status: describe(item) }));
  }
  async function request(nodeId, kind, payload = {}, options = {}) {
    const started = timestamp();
    const id = await resolveNode(nodeId);
    const queued = await rpc('ecotrack_cloud_request', { p_node_id: id, p_kind: kind, p_payload: payload, p_request_id: root.crypto.randomUUID() });
    if (!queued.id || queued.node_id !== id || queued.kind !== kind) throw new Error('Supabase did not confirm the hardware request.');
    if (options.wait === false) return queued;
    return waitForResult(queued, { ...options, started });
  }
  async function waitForResult(queued, options = {}) {
    const id = queued.node_id;
    const started = options.started ?? timestamp();
    const deadline = Date.now() + (options.timeoutMs || 25000);
    while (Date.now() < deadline) {
      const response = await client().from('ecotrack_device_commands').select('*').eq('id', queued.id).maybeSingle();
      if (response.error) throw failure(response.error);
      const command = response.data;
      if (!command || command.node_id !== id) throw new Error('Hardware request disappeared or became inaccessible.');
      if (command.status === 'completed') {
        if (command.result?.success !== true || command.result.command_id !== queued.id) throw new Error('Invalid hardware acknowledgement.');
        return { ...command.result, command_id: queued.id, round_trip_ms: Math.round(timestamp() - started), source: 'supabase' };
      }
      if (['failed', 'expired', 'superseded'].includes(command.status)) throw Object.assign(new Error(command.result?.error || `Hardware request ${command.status}.`), { code: command.status.toUpperCase(), command_id: queued.id });
      await delay(500);
    }
    throw Object.assign(new Error('No device acknowledgement received. The controller may be asleep, offline, or reconnecting.'), { code: 'ACK_TIMEOUT', command_id: queued.id });
  }
  async function ping(nodeId) {
    const device = await getStatus(nodeId);
    if (device.connection_status === 'sleeping') throw Object.assign(new Error(`Controller is sleeping until ${new Date(device.sleeping_until).toLocaleString()}.`), { code: 'DEVICE_SLEEPING' });
    return request(nodeId, 'ping', {}, { timeoutMs: 20000 });
  }
  async function learn(nodeId) {
    return request(nodeId, 'learn_ir', {}, { timeoutMs: 30000 });
  }
  async function latest(nodeId) {
    const device = await getStatus(nodeId);
    if (!device.latest_ir?.raw_data) throw new Error('No actual IR capture has been uploaded by this receiver.');
    return { ...device.latest_ir, success: true, source: 'supabase' };
  }
  async function control(nodeId, payload) {
    const device = await getStatus(nodeId);
    if (device.capabilities?.ir_transmitter !== true) throw Object.assign(new Error('This ESP32 is receiver-only. Add an IR transmitter before using power, temperature, mode, or fan controls.'), { code: 'RECEIVER_ONLY' });
    const queued = await request(nodeId, 'ac_intent', payload, { wait: false });
    return { ...queued, command_id: queued.id, command_status: 'queued', commanded_at: queued.created_at };
  }
  function inputDialog(title, message, choices, passkey = false) {
    return new Promise(resolve => {
      const dialog = root.document.createElement('dialog');
      dialog.style.cssText = 'padding:24px;border:1px solid #10b981;border-radius:16px;max-width:440px;width:90%;background:#0f172a;color:#f8fafc';
      const heading = root.document.createElement('h2'); heading.textContent = title;
      const text = root.document.createElement('p'); text.textContent = message;
      dialog.append(heading, text);
      let field;
      if (passkey) {
        field = root.document.createElement('input'); field.inputMode = 'numeric'; field.maxLength = 6; field.autocomplete = 'off'; field.setAttribute('aria-label', 'Six-digit Bluetooth code');
        field.style.cssText = 'padding:10px;color:#0f172a;width:100%;margin-bottom:16px'; dialog.append(field);
      }
      const close = value => { dialog.close(); dialog.remove(); resolve(value); };
      for (const choice of choices) {
        const button = root.document.createElement('button'); button.textContent = choice.label; button.type = 'button';
        button.style.cssText = 'padding:10px;margin:4px;border:1px solid #10b981;border-radius:8px;background:#065f46;color:white';
        button.addEventListener('click', () => {
          if (passkey && choice.value && !/^\d{6}$/.test(field.value)) { field.focus(); return; }
          close(passkey && choice.value ? field.value : choice.value);
        }); dialog.append(button);
      }
      dialog.addEventListener('cancel', event => { event.preventDefault(); close(null); });
      root.document.body.append(dialog); dialog.showModal(); field?.focus();
    });
  }
  if (root.electron?.on && root.document) {
    root.electron.on('bluetooth-select-request', async (_event, data) => {
      const choice = await inputDialog('Select nearby EcoTrack device', 'Choose the ESP32 you want to configure.', [...data.devices.map(item => ({ label: item.deviceName || item.deviceId, value: item.deviceId })), { label: 'Cancel', value: null }]);
      await root.electron.invoke('bluetooth-select-response', { request_id: data.request_id, device_id: choice });
    });
    root.electron.on('bluetooth-pairing-request', async (_event, data) => {
      const entering = data.pairingKind === 'providePin';
      const answer = await inputDialog('Secure Bluetooth pairing', entering ? 'Enter the six-digit pairing code printed in the ESP32 Serial Monitor (115200 baud).' : `Confirm pairing with ${data.deviceId}${data.pin ? ': ' + data.pin : ''}.`, [{ label: 'Pair', value: true }, { label: 'Cancel', value: false }], entering);
      await root.electron.invoke('bluetooth-pairing-response', { request_id: data.request_id, confirmed: !!answer, pin: entering && answer ? answer : undefined });
    });
  }
  try {
    const raw = root.localStorage?.getItem('ecoTrack_nodes');
    if (raw) {
      const nodes = JSON.parse(raw);
      for (const node of nodes) { delete node.wifi_password; delete node.password; delete node.device_token; }
      root.localStorage.setItem('ecoTrack_nodes', JSON.stringify(nodes));
    }
  } catch (_) {}
  root.EcoTrackHardwareCloud = { connect, readInfo, provision, register, request, waitForResult, ping, learn, latest, control, getStatus, listStatus, describe, resolveNode };
})(typeof window !== 'undefined' ? window : globalThis);
