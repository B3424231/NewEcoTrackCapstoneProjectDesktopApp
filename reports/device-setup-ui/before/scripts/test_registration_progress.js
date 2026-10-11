const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('public/nodes.html', 'utf8');
const checks = [];
const section = (start, end) => {
  const from = html.indexOf(start), to = html.indexOf(end, from);
  assert(from >= 0 && to > from, 'Missing source section: ' + start);
  return html.slice(from, to);
};
const remoteSource = section('      const remoteCapture = {', '      let nodeCurrentPage = 1;');
const summarySource = section('      function updateConfigSummary() {', '      // Manage state and restrictions');
const submitSource = section("      form.addEventListener('submit',", "      const nPrev = document.getElementById('nodePrevBtn');");
const closeSource = section('      function closeModal() {', "      closeBtn.addEventListener('click'");
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function element() {
  const classes = new Set();
  return { value: '', textContent: '', disabled: false, className: '', dataset: {}, attributes: {}, options: [], selectedIndex: 0,
    setAttribute(key, value) { this.attributes[key] = value; },
    addEventListener() {}, focus() {},
    classList: { contains: name => classes.has(name), add: (...names) => names.forEach(name => classes.add(name)), remove: (...names) => names.forEach(name => classes.delete(name)) }
  };
}
const registration = () => ({
  node: { id: 'node-fixture' },
  info: { device_id: 'esp32s3-001122334455', firmware_version: 'fixture', wifi_ssid: 'Fixture network', ip_address: '10.0.0.4', rssi: -67, capabilities: { ir_receiver: true, ir_transmitter: false } },
  cloud_state: { connection_status: 'online', last_seen: '2026-10-09T00:00:00Z' }
});
function harness() {
  const elements = new Map(), calls = [], saved = [], toasts = [], handlers = new Map(), capture = deferred(), persisted = deferred();
  const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  for (const [id, value] of Object.entries({
    nodeFormId: 'esp32s3-001122334455', nodeFormName: 'Controller fixture', nodeFormIp: '10.0.0.4',
    nodeFormSsid: 'Fixture network', nodeFormPassword: 'fixture-password', nodeFormStatus: 'Connected',
    nodeFormAirconType: 'Split Type (Inverter)', nodeFormBuilding: 'building-fixture', nodeFormFloor: 'floor-fixture', nodeFormRoom: 'room-fixture',
    editNodeIdHidden: 'esp32s3-001122334455', editNodeIp: '10.0.0.4'
  })) get(id).value = value;
  for (const [id, text] of [['nodeFormBuilding', 'Fixture building'], ['nodeFormFloor', 'Fixture floor'], ['nodeFormRoom', 'Fixture room']]) get(id).options = [{ text }];
  const window = {
    EcoTrackHardwareCloud: { register: async (...args) => { calls.push(args); return capture.promise; } },
    EcoToast: { show: (message, kind) => toasts.push({ message, kind }) },
    EcoDataBus: { invalidate() {} }
  };
  const context = vm.createContext({
    window, console, document: { getElementById: get }, NodeService: { saveNode: async node => { saved.push(node); return persisted.promise; }, saveRemoteProfile: async () => {} },
    ProtocolAdapter: { detectRemoteBrand: async id => ({ success: true, brand: 'Daikin', protocol: 'DAIKIN2' }) },
    renderBrandChips() {}, renderNodes() {}, setNodeModalStep() {}, setTimeout: () => 1,
    _cachedBuildings: [], _cachedFloors: [], _cachedRooms: [], nodeCurrentPage: 1,
    AirconProfileManager: { getById: () => null },
    modal: get('nodeModal'), saveNodeBtn: get('saveNodeBtn'),
    form: { addEventListener: (name, fn) => handlers.set(name, fn) }
  });
  vm.runInContext(remoteSource + summarySource + closeSource + submitSource, context);
  return { get, window, context, calls, saved, toasts, capture, persisted,
    submit: () => handlers.get('submit')({ preventDefault() {} }) };
}
async function main() {
  assert.match(html, /id="registerRemoteBtn"[^>]*\bdisabled\b/);
  assert(!html.includes("Keep this PC on the controller's network"));
  assert(!html.includes('Check the local network'));
  checks.push('Initial markup disables premature detection and removes the same-network requirement');

  let app = harness();
  vm.runInContext("resetRemoteDetection('register'); setRemoteBusy('register', true); setRemoteBusy('register', false); resetRemoteDetection('register');", app.context);
  assert.equal(app.get('registerRemoteBtn').disabled, true);
  let learned = 0;
  app.context.ProtocolAdapter.detectRemoteBrand = async () => { learned++; };
  await app.context.listenForRemote('register');
  assert.equal(learned, 0);
  assert.match(app.get('registerRemoteStatus').textContent, /Edit screen/);
  checks.push('Resets and forced clicks cannot send an IR command during initial registration');

  app = harness();
  vm.runInContext("setRegistrationCloudStatus('pending'); updateConfigSummary();", app.context);
  assert.equal(app.get('summaryStatusBadge').textContent, 'Cloud pending');
  vm.runInContext("setRegistrationCloudStatus('failed', 'Cloud migration is missing'); updateConfigSummary();", app.context);
  assert.equal(app.get('summaryStatusBadge').textContent, 'Setup incomplete');
  assert.equal(app.get('registrationCloudMessage').textContent, 'Cloud migration is missing');
  checks.push('Wi-Fi Connected and form edits cannot imply cloud success or erase a failure');

  app = harness();
  let receivedNode;
  const ir = deferred();
  app.context.ProtocolAdapter.detectRemoteBrand = async nodeId => { receivedNode = nodeId; return ir.promise; };
  const listening = app.context.listenForRemote('edit');
  assert.equal(app.get('editRemoteBtn').disabled, true);
  assert.equal(app.get('saveEditNodeBtn').disabled, true);
  assert.match(app.get('editRemoteStatus').textContent, /Supabase/);
  ir.resolve({ success: true, brand: 'Daikin', protocol: 'DAIKIN2' });
  await listening;
  assert.equal(receivedNode, 'esp32s3-001122334455');
  assert.equal(app.get('editNodeBrand').value, 'Daikin');
  assert.equal(app.get('editRemoteBtn').disabled, false);
  assert.equal(app.get('saveEditNodeBtn').disabled, false);
  checks.push('Registered controller Edit still learns a real result and releases its controls');

  app.context.ProtocolAdapter.detectRemoteBrand = async () => { throw new Error('Device is sleeping until its next wake time'); };
  await app.context.listenForRemote('edit');
  assert.match(app.get('editRemoteStatus').textContent, /Device is sleeping/);
  assert.equal(app.get('editRemoteBtn').textContent, 'Retry');
  checks.push('Learning failures retain their actionable cloud error instead of a local-network instruction');

  app = harness();
  const saving = app.submit();
  assert.equal(app.calls.length, 1);
  assert.equal(app.get('registrationCloudStatus').dataset.state, 'verifying');
  assert.equal(app.get('registrationCloudStatus').attributes['aria-busy'], 'true');
  assert.equal(app.get('saveNodeBtn').disabled, true);
  assert.equal(app.get('saveNodeBtnText').textContent, 'Verifying Supabase...');
  assert.equal(app.saved.length, 0);
  assert.equal(app.get('nodeFormPassword').value, 'fixture-password');
  checks.push('Saving remains Verifying until the asynchronous cloud registration confirms');

  await app.submit();
  app.context.closeModal();
  assert.equal(app.calls.length, 1);
  assert.equal(app.get('nodeModal').classList.contains('hidden'), false);
  checks.push('Repeated Submit and closing the modal cannot race the active registration');

  app.capture.resolve(registration());
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(app.saved.length, 1);
  assert.equal(app.saved[0].cloud_registered, true);
  assert.equal(app.get('registrationCloudStatus').dataset.state, 'verifying');
  app.persisted.resolve();
  await saving;
  assert.equal(app.get('registrationCloudStatus').dataset.state, 'verified');
  assert.equal(app.get('registrationCloudStatus').attributes['aria-busy'], 'false');
  assert.equal(app.get('nodeFormPassword').value, '');
  assert.equal(app.get('nodeModal').classList.contains('hidden'), true);
  assert.match(app.toasts.at(-1).message, /Supabase connection verified.*Edit/);
  checks.push('Cloud success and local persistence complete before the verified message and close');

  app = harness();
  const failedSave = app.submit();
  app.capture.reject(new Error('Run supabase_cloud_hardware_migration.sql in Supabase SQL Editor.'));
  await failedSave;
  assert.equal(app.get('registrationCloudStatus').dataset.state, 'failed');
  assert.match(app.get('registrationCloudMessage').textContent, /migration/);
  assert.equal(app.get('saveNodeBtn').disabled, false);
  assert.equal(app.saved.length, 0);
  assert.equal(app.get('nodeModal').classList.contains('hidden'), false);
  assert(!app.toasts.some(toast => toast.kind === 'success'));
  checks.push('Missing migration or rejected registration stays incomplete and allows retry');

  app.window.EcoTrackHardwareCloud.register = async (...args) => { app.calls.push(args); return registration(); };
  app.persisted.resolve();
  await app.submit();
  assert.equal(app.calls.length, 2);
  assert.equal(app.get('registrationCloudStatus').dataset.state, 'verified');
  checks.push('A failed registration can be retried successfully');

  app = harness();
  const failedPersistence = app.submit();
  app.capture.resolve(registration());
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  app.persisted.reject(new Error('Unable to save controller metadata'));
  await failedPersistence;
  assert.equal(app.get('registrationCloudStatus').dataset.state, 'failed');
  assert.match(app.get('registrationCloudMessage').textContent, /metadata/);
  assert.equal(app.get('saveNodeBtn').disabled, false);
  assert(!app.toasts.some(toast => toast.kind === 'success'));
  checks.push('Local persistence failure cannot produce a completed registration UI');

  app = harness();
  app.get('nodeFormBrand').value = 'Daikin';
  app.context.CapabilityEngine = { resolveProtocolName: () => 'daikin' };
  const profile = deferred();
  let profileCalls = 0;
  app.context.NodeService.saveRemoteProfile = async () => { profileCalls++; return profile.promise; };
  const savingProfile = app.submit();
  app.capture.resolve(registration());
  app.persisted.resolve();
  for (let count = 0; count < 8; count++) await Promise.resolve();
  assert.equal(profileCalls, 1);
  assert.equal(app.get('saveNodeBtn').disabled, true);
  await app.submit();
  app.context.closeModal();
  assert.equal(app.calls.length, 1);
  assert.equal(app.get('nodeModal').classList.contains('hidden'), false);
  profile.resolve();
  await savingProfile;
  assert.equal(app.get('saveNodeBtn').disabled, false);
  assert.equal(app.get('nodeModal').classList.contains('hidden'), true);
  checks.push('Optional brand-profile saving remains guarded against duplicate registrations');

  app = harness();
  app.get('nodeFormBrand').value = 'Daikin';
  app.context.CapabilityEngine = { resolveProtocolName: () => 'daikin' };
  app.context.NodeService.saveRemoteProfile = async () => { throw new Error('Profile write rejected'); };
  const failedProfile = app.submit();
  app.capture.resolve(registration());
  app.persisted.resolve();
  await failedProfile;
  assert.match(app.toasts.at(-1).message, /Profile write rejected/);
  assert.equal(app.get('registrationCloudStatus').dataset.state, 'failed');
  assert.equal(app.get('saveNodeBtn').disabled, false);
  assert.equal(app.get('nodeModal').classList.contains('hidden'), false);
  app.context.closeModal();
  assert.equal(app.get('nodeModal').classList.contains('hidden'), true);
  checks.push('Optional profile failure releases the save guard and keeps its error visible');

  app = harness();
  app.get('nodeFormAircon').value = 'existing-ac';
  app.get('nodeFormBrand').value = 'Daikin';
  app.context.AirconProfileManager.getById = id => id === 'existing-ac' ? { brand: 'Daikin', protocol_name: 'DAIKIN64' } : null;
  app.context.CapabilityEngine = { resolveProtocolName: () => 'daikin' };
  let savedProtocol;
  app.context.NodeService.saveRemoteProfile = async (_id, data) => { savedProtocol = data.protocol_name; };
  const attachExisting = app.submit();
  app.capture.resolve(registration()); app.persisted.resolve();
  await attachExisting;
  assert.equal(app.saved[0].aircon_id, 'existing-ac');
  assert.equal(app.saved[0].protocol_name, 'DAIKIN64');
  assert.equal(savedProtocol, 'DAIKIN64');
  checks.push('Choosing an existing AC passes its actual ID and exact saved IR variant through the registration handler');

  app = harness();
  app.get('nodeFormRoom').value = 'custom';
  app.get('nodeFormCustomRoom').value = 'New lab';
  let rejectRoom = true, roomWrites = 0;
  app.window.supabaseClient = { from(table) {
    assert.equal(table, 'rooms');
    let payload;
    const query = { insert(rows) { roomWrites++; payload = rows[0]; return query; }, select() { return query; },
      async single() { return rejectRoom ? { data: null, error: { message: 'Room save denied' } } : { data: { id: payload.id }, error: null }; }
    };
    return query;
  } };
  await app.submit();
  assert.equal(app.calls.length, 0);
  assert.equal(app.context._cachedRooms.length, 0);
  assert.equal(app.get('registrationCloudStatus').dataset.state, 'failed');
  rejectRoom = false; app.capture.resolve(registration()); app.persisted.resolve();
  await app.submit();
  assert.equal(roomWrites, 2);
  assert.equal(app.context._cachedRooms.length, 1);
  assert.equal(app.calls.length, 1);
  assert.equal(app.saved[0].room_id, app.context._cachedRooms[0].id);
  checks.push('A rejected custom room stays out of the shared cache; retry creates and confirms it before cloud registration');

  app = harness();
  const edits = [];
  let denyEditLocation = true, closedEdit = false;
  app.context.console = { log() {}, warn() {}, error() {} };
  app.context.crypto = require('node:crypto').webcrypto;
  app.context.saveEditBtn = app.get('saveEditNodeBtn');
  app.context.closeEditNodeModal = () => { closedEdit = true; };
  for (const prefix of ['Bld','Flr','Room']) {
    const selected = element(); selected.value = 'custom';
    const input = element(); input.value = 'Edit ' + prefix;
    app.context['edit' + prefix + 'Select'] = selected;
    app.context['editCustom' + (prefix === 'Bld' ? 'Bld' : prefix === 'Flr' ? 'Flr' : 'Room') + 'Input'] = input;
  }
  app.get('editNodeName').value = 'Real receiver';
  app.context.NodeService.getNode = () => ({ db_id: 'node-fixture', node_id: 'esp32s3-001122334455' });
  app.context.NodeService.editDevice = async (_id, payload) => edits.push(payload);
  app.window.supabaseClient = { from(table) {
    let payload; const query = { insert(rows) { payload = rows[0]; return query; }, select() { return query; },
      async single() { return denyEditLocation ? { data: null, error: { message: 'Edit location denied' } } : { data: payload, error: null }; } };
    return query;
  } };
  vm.runInContext(section('      async function confirmCustomDeployment(', '      if (saveEditBtn) saveEditBtn.addEventListener'), app.context);
  await app.context.handleSaveEditNode();
  assert.equal(edits.length, 0); assert.equal(app.context._cachedBuildings.length, 0); assert.equal(closedEdit, false);
  assert.equal(app.get('saveEditNodeBtn').disabled, false);
  denyEditLocation = false;
  await app.context.handleSaveEditNode();
  assert.equal(edits.length, 1); assert.equal(closedEdit, true);
  assert.equal(edits[0].room_id, app.context._cachedRooms[0].id);
  assert.equal(app.context._cachedRooms[0].floor_id, app.context._cachedFloors[0].id);
  assert.equal(app.context._cachedFloors[0].building_id, app.context._cachedBuildings[0].id);
  checks.push('Controller Edit confirms custom building, floor, and room before linking; rejected locations leave metadata unchanged and allow retry');

  const cloudWindow = { supabaseClient: { rpc() {}, from: () => {
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: null, error: null }) };
    return query;
  } } };
  const cloudContext = vm.createContext({ window: cloudWindow, console });
  vm.runInContext(fs.readFileSync('public/js/hardware-cloud.js', 'utf8'), cloudContext);
  await assert.rejects(() => cloudWindow.EcoTrackHardwareCloud.resolveNode('esp32s3-001122334455'), /not found in Supabase.*Save & Verify/);
  checks.push('Missing device lookup explains cloud registration instead of falsely blaming Bluetooth');

  for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) if (script[1].trim()) new vm.Script(script[1], { filename: 'nodes.html' });
  fs.writeFileSync('reports/cloud-hardware/registration-progress-tests.json', JSON.stringify({ passed: checks.length, checks, physical_hardware_tested: false, browser_visual_tested: false }, null, 2));
  console.log('Registration progress: ' + checks.length + ' checks passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
