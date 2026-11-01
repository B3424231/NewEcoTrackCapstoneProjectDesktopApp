'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = process.env.ECOTRACK_DESKTOP_ROOT || path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function workspace(saved, filename = 'control.html') {
  const events = {}, redirects = [], classes = new Set();
  const location = { href: 'http://localhost/' + filename, protocol: 'http:', host: 'localhost', replace: value => redirects.push(value) };
  const document = {
    documentElement: { dataset: {}, classList: { add: name => classes.add(name), toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); } } },
    head: { appendChild() {} }, body: {},
    createElement: () => ({}), getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    addEventListener: (name, callback) => { events[name] = callback; },
  };
  const localStorage = { getItem: key => key === 'ecoTrack_workspace_mode' ? saved : null, setItem() {}, removeItem() {} };
  const window = { addEventListener: (name, callback) => { events[name] = callback; } };
  vm.runInNewContext(read('public/js/app-mode.js'), { window, document, localStorage, location, URL, Object });
  events.DOMContentLoaded?.();
  return { api: window.EcoTrackMode, document, events, redirects };
}

test('saved workspace choices cannot hide monitoring or control pages', () => {
  for (const saved of [null, 'monitoring', 'controller', 'both']) {
    for (const page of ['control.html', 'analytics.html', 'telemetry.html', 'nodes.html', 'sensor-logs.html']) {
      const state = workspace(saved, page);
      assert.equal(state.api.mode, 'both');
      assert.equal(state.api.home(), 'dashboard.html');
      assert.equal(state.document.documentElement.dataset.ecoMode, 'both');
      assert.deepEqual(state.redirects, []);
      assert.equal(typeof state.api.setMode, 'undefined');
      state.events.storage?.({ key: 'ecoTrack_workspace_mode', newValue: 'monitoring' });
      assert.equal(state.api.mode, 'both');
    }
  }
});

test('mode controls and title are absent while both navigation groups remain', () => {
  const sidebar = read('public/sidebar-template.html');
  assert.doesNotMatch(sidebar, /sidebarModeSwitch|data-workspace-toggle|Monitoring and Controlling Mode/);
  for (const page of ['control.html', 'analytics.html', 'telemetry.html', 'sensor-logs.html']) assert.ok(sidebar.includes('href="' + page + '"'));
  assert.doesNotMatch(read('public/js/sidebar-loader.js'), /v25-sidebar-mode-switch/);
});

test('registration defaults to combined capabilities without a visible mode selector', () => {
  const html = read('public/nodes.html');
  assert.doesNotMatch(html, /<select[^>]*id="nodeFormDeviceMode"/);
  assert.match(html, /<input[^>]*type="hidden"[^>]*id="nodeFormDeviceMode"[^>]*value="both"/);
  const elements = new Map();
  const element = id => { if (!elements.has(id)) elements.set(id, { value: '', hidden: true, setAttribute() {}, focus() {}, classList: { remove() {} } }); return elements.get(id); };
  element('nodeFormDeviceMode').value = 'both';
  const context = { window: {}, document: { getElementById: element, querySelector: () => null, querySelectorAll: () => [] } };
  vm.runInNewContext(read('public/js/controller-registration.js'), context);
  context.window.EcoTrackControllerRegistration.setDeviceMode('monitoring');
  assert.equal(context.window.EcoTrackControllerRegistration.fields().device_mode, 'monitoring');
  assert.equal(element('registrationIrConfig').hidden, true);
  context.window.EcoTrackControllerRegistration.reset();
  assert.equal(context.window.EcoTrackControllerRegistration.fields().device_mode, 'both');
  assert.equal(element('registrationIrConfig').hidden, false);
  assert.doesNotMatch(html, /nodeFormDeviceMode'\)\.addEventListener\('change'/);
});

test('reconnecting sensors restore their capability before AC choices, even with edited drafts', async () => {
  const html = read('public/nodes.html');
  const start = html.indexOf('async function refreshRegistrationStatus(info, restore = false)');
  const end = html.indexOf('function updateRegistrationRecoveryAction()', start);
  assert.ok(start > 0 && end > start);
  for (const touched of [false, true]) {
    let role = 'both', roleWhenChoicesLoaded;
    const elements = new Map();
    const element = id => { if (!elements.has(id)) elements.set(id, { value: id === 'nodeFormName' ? 'Edited name' : '' }); return elements.get(id); };
    const context = {
      registrationSessionVersion: 1, registrationCheckRevision: 0, selectedBleDevice: { nodeId: 'fixture-device' },
      modal: { classList: { contains: () => false } }, registrationCheck: null, registrationDraftTouched: touched,
      document: { getElementById: element }, _cachedRooms: [], _cachedFloors: [], _cachedBuildings: [],
      registrationUi: { setDeviceMode: value => { role = value; }, setType() {}, chooseMode() {} },
      loadRegistrationAirconChoices: async () => { roleWhenChoicesLoaded = role; },
      updateRegistrationSave() {}, updateConfigSummary() {}, setRegistrationCloudStatus() {}, refreshExistingWifiPanel() {},
      reportRegistrationFailure: error => { throw error; },
      window: { EcoTrackHardwareCloud: { registrationStatus: async () => ({ state: 'reuse', node: { name: 'Saved sensor', device_mode: 'monitoring' }, aircon: { id: 'occupied-ac' } }) }, EcoTrackControllerLocations: { bind() {} } },
    };
    vm.runInNewContext(html.slice(start, end) + ';this.refresh = refreshRegistrationStatus;', context);
    await context.refresh({ device_id: 'fixture-device' }, true);
    assert.equal(roleWhenChoicesLoaded, 'monitoring', 'sensor AC choices must be loaded under its saved capability');
    assert.equal(role, 'monitoring');
    assert.equal(element('nodeFormName').value, touched ? 'Edited name' : 'Saved sensor');
  }
});
