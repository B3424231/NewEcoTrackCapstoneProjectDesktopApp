"use strict";
// Production picker and connection code, with isolated Bluetooth/IPC promises only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.ECOTRACK_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'reports/bluetooth-connection-loading');
const hardware = fs.readFileSync(path.join(root, 'public/js/hardware-cloud.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/styles.css'), 'utf8');
let browser;
const results = [];
async function fixture(theme = 'dark', width = 1460, reducedMotion = 'no-preference') {
  const page = await browser.newPage({ viewport: { width, height: 844 }, reducedMotion });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.abort());
  await page.setContent('<!doctype html><html class="' + (theme === 'dark' ? 'dark' : '') + '"><head><style>' + css + '</style></head><body class="app-shell"><button id="start">Connect nearby</button></body></html>');
  await page.evaluate(() => {
    const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
    const f = window.fixture = { gatt: deferred(), read: deferred(), gattCalls: 0, readCalls: 0, responses: [], parentEscapes: 0 };
    const listeners = new Map();
    const info = { device_id: 'esp32s3-001122334455', cloud_protocol: 1, wifi_status: 'connected', wifi_ssid: 'Fixture network', ip_address: '10.0.0.4' };
    const reader = { readValue: () => { f.readCalls++; return f.read.promise.then(() => new DataView(new TextEncoder().encode(JSON.stringify(info)).buffer)); } };
    const service = { getCharacteristic: async id => id.startsWith('beb5483e') ? reader : { writeValueWithResponse: () => { throw Error('Unexpected provisioning write'); } } };
    const device = { name: 'EcoTrack-' + info.device_id, addEventListener() {}, gatt: { connected: false,
      connect: () => { f.gattCalls++; return f.gatt.promise.then(() => { device.gatt.connected = true; return { getPrimaryService: async () => service }; }); },
      disconnect() { this.connected = false; }
    } };
    window.ecoDeviceDisplayName = () => 'AC device 4455';
    Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: { requestDevice: () => {
      f.picker = deferred();
      queueMicrotask(() => listeners.get('bluetooth-select-request')({}, { request_id: 'isolated-selection', devices: [{ deviceId: 'fixture-device', deviceName: device.name }] }));
      return f.picker.promise;
    } } });
    window.electron = { on: (name, fn) => listeners.set(name, fn), invoke: async (name, data) => {
      if (name !== 'bluetooth-select-response') throw Error('Unexpected IPC: ' + name);
      f.responses.push(data);
      if (data.device_id) f.picker.resolve(device);
      else f.picker.reject(new DOMException('Picker cancelled', 'NotFoundError'));
      return { success: true };
    } };
    window.addEventListener('keydown', event => { if (event.key === 'Escape') f.parentEscapes++; });
  });
  await page.addScriptTag({ content: hardware });
  await page.evaluate(() => document.getElementById('start').addEventListener('click', () => {
    fixture.result = null;
    fixture.pending = EcoTrackHardwareCloud.connect().then(info => { fixture.result = { status: 'success', id: info.device_id }; }, error => { fixture.result = { status: 'error', code: error.code, message: error.message }; });
  }));
  await page.getByRole('button', { name: 'Connect nearby', exact: true }).click();
  await page.getByRole('dialog', { name: 'Select nearby EcoTrack device' }).waitFor();
  return { page, errors };
}
async function choose(page) {
  await page.getByRole('button', { name: 'AC device 4455', exact: true }).click();
  const dialog = page.locator('.ecotrack-bluetooth-progress[open]');
  await dialog.waitFor();
  assert.equal(await dialog.getAttribute('aria-busy'), 'true');
  assert.equal(await page.locator('.ecotrack-bluetooth-dialog__choice').count(), 0);
  return dialog;
}
(async () => {
  fs.mkdirSync(out, { recursive: true });
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  for (const theme of ['dark', 'light']) for (const width of [1460, 390]) {
    const { page, errors } = await fixture(theme, width);
    const dialog = await choose(page);
    const metrics = await dialog.evaluate(element => {
      const box = element.getBoundingClientRect();
      return { modal: element.matches(':modal'), x: box.x, y: box.y, width: box.width, height: box.height, viewWidth: innerWidth, viewHeight: innerHeight,
        spinner: getComputedStyle(element.querySelector('span')).animationName };
    });
    assert(metrics.modal && metrics.x >= 0 && metrics.y >= 0 && metrics.x + metrics.width <= width && metrics.y + metrics.height <= 844);
    assert(Math.abs(metrics.x - (width - metrics.width) / 2) < 2);
    assert(Math.abs(metrics.y - (844 - metrics.height) / 2) < 2);
    assert.equal(metrics.spinner, 'ecotrack-bluetooth-progress-spin');
    await page.keyboard.press('Escape');
    assert.equal(await dialog.count(), 1, 'Escape cannot dismiss pending feedback or the setup below');
    assert.equal(await page.evaluate(() => fixture.parentEscapes), 0);
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => fixture.result), null, 'No timer invents success');
    await dialog.screenshot({ path: path.join(out, `loading-${theme}-${width}.png`) });
    await page.evaluate(() => fixture.gatt.resolve());
    await page.waitForFunction(() => fixture.readCalls === 1);
    assert.equal(await dialog.count(), 1, 'Loading persists until the device information is read');
    await page.evaluate(() => fixture.read.resolve());
    await page.waitForFunction(() => fixture.result?.status === 'success');
    assert.equal(await page.locator('.ecotrack-bluetooth-progress').count(), 0);
    assert.equal(await page.evaluate(() => fixture.responses.length), 1, 'Selection is forwarded once');
    assert.deepEqual(errors, []);
    results.push({ theme, width, status: 'PASS', metrics });
    console.log(`PASS ${theme} ${width}: selection, modal, pending connection/read, Escape, success cleanup`);
    await page.close();
  }
  for (const failure of ['gatt', 'read', 'cancel']) {
    const { page, errors } = await fixture();
    if (failure === 'cancel') await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    else {
      await choose(page);
      if (failure === 'read') { await page.evaluate(() => fixture.gatt.resolve()); await page.waitForFunction(() => fixture.readCalls === 1); }
      await page.evaluate(stage => fixture[stage].reject(new DOMException('Isolated Bluetooth failure', 'NetworkError')), failure);
    }
    await page.waitForFunction(() => fixture.result?.status === 'error');
    assert.equal(await page.locator('.ecotrack-bluetooth-progress').count(), 0);
    assert.equal(await page.evaluate(() => fixture.result.code), failure === 'cancel' ? 'BLE_DISCONNECTED' : 'BLE_CONNECTION_FAILED');
    if (failure === 'cancel') assert.equal(await page.evaluate(() => fixture.gattCalls), 0);
    assert.deepEqual(errors, []);
    results.push({ failure, status: 'PASS' });
    console.log(`PASS ${failure}: no stuck modal, actual error/cancellation preserved`);
    await page.close();
  }
  const { page } = await fixture('dark', 390, 'reduce');
  await choose(page);
  assert.equal(await page.locator('.ecotrack-bluetooth-progress__spinner').evaluate(element => getComputedStyle(element).animationName), 'none');
  await page.evaluate(() => { fixture.gatt.resolve(); fixture.read.resolve(); });
  await page.waitForFunction(() => fixture.result?.status === 'success');
  await page.close();
  results.push({ reducedMotion: true, status: 'PASS' });
  console.log('PASS reduced motion');
  fs.writeFileSync(path.join(out, 'browser-results.json'), JSON.stringify({ passed: results.length, results, externalRequestsSent: 0, physicalHardwareTested: false }, null, 2));
})().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => { await browser?.close(); });
