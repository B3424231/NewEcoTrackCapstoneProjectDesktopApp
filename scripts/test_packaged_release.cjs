'use strict';
// Real packaged Electron and frozen backend; fresh local profile/database only.
// No sign-in, cloud writes, hardware commands or development Python are used.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const assert = require('node:assert/strict');
const { _electron } = require(process.env.ECOTRACK_PLAYWRIGHT || 'C:/Users/reygay/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const root = path.resolve(__dirname, '..');
const executable = process.env.ECOTRACK_PACKAGED_EXE || path.join(root, 'dist/ecotrack-20261030/win-unpacked/EcoTrack.exe');
const provisionOnly = process.argv.includes('--provision-only');
const output = path.join(root, 'reports/packaging-20261030/installed-runtime', ...(provisionOnly ? ['provisioning'] : []));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ecotrack-packaged-release-'));
const runtimeHome = path.join(profile, 'runtime');
const sqlitePath = path.join(runtimeHome, 'data/telemetry.db');
const keyPath = path.join(runtimeHome, 'data/.ecotrack-monitoring-admin.key');
const report = { status: 'RUNNING', packaged_executable: executable,
  isolated_runtime_home: runtimeHome, isolated_profile: path.join(profile, 'chromium'),
  live_database_access: false, cloud_writes: false, physical_hardware_tested: false,
  checks: [], renderer_errors: [], screenshots: [] };
let app, backendUrl;

function persist() {
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
}
function pass(name, actual) {
  report.checks.push({ name, status: 'PASS', actual });
  persist();
  console.log('PASS ' + name);
}
function portListening(port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const finish = value => { socket.destroy(); resolve(value); };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(1000, () => finish(false));
  });
}
async function json(endpoint, options = {}) {
  const response = await fetch(backendUrl + endpoint, { ...options, signal: AbortSignal.timeout(15000) });
  return { status: response.status, body: await response.json() };
}
async function waitForBackendExit(url) {
  const port = Number(new URL(url).port), deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (!await portListening(port)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Packaged app did not stop its owned backend at exit.');
}
function launchEnvironment() {
  const env = { ...process.env,
    ECOTRACK_USER_DATA_PATH: report.isolated_profile,
    ECOTRACK_RUNTIME_HOME: runtimeHome,
    ECOTRACK_TELEMETRY_SYNC: '0', ECOTRACK_MONITOR_SYNC: '0',
    ECOTRACK_BACKUP_ENABLED: '0', PYTHONUTF8: '1' };
  // Public cloud configuration comes from the packaged resource. Private runtime
  // credentials, development database overrides and Python paths must not leak in.
  for (const key of Object.keys(env)) {
    if (/^(?:SUPABASE_|EXPO_PUBLIC_SUPABASE_|PYTHONPATH$|PYTHONHOME$)/.test(key) ||
        ['ELECTRON_RUN_AS_NODE', 'ECOTRACK_SQLITE_DB_PATH', 'ECOTRACK_MONITOR_ADMIN_TOKEN',
          'ECOTRACK_CONFIG_PATH', 'ECOTRACK_MONITOR_KEY_PATH', 'BACKEND_URL', 'PORT'].includes(key)) delete env[key];
  }
  env.PATH = path.join(process.env.SystemRoot || 'C:/Windows', 'System32');
  return env;
}
async function launch(extraArgs = []) {
  app = await _electron.launch({ executablePath: executable,
    args: ['--user-data-dir=' + report.isolated_profile, ...extraArgs], cwd: path.dirname(executable), env: launchEnvironment(), timeout: 120000 });
  const page = await app.firstWindow({ timeout: 120000 });
  page.on('pageerror', error => { report.renderer_errors.push(error.message); persist(); });
  await app.evaluate(({ BrowserWindow, session }) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.setBackgroundThrottling(false);
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      // All smoke checks are local. Never let this anonymous profile initiate
      // any cloud operation while a packaged interface is being inspected.
      const url = new URL(details.url);
      const network = ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol);
      callback({ cancel: network && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) });
    });
  });
  backendUrl = await app.evaluate(() => process.env.BACKEND_URL);
  assert.match(backendUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
  await page.locator('#email').waitFor({ timeout: 45000 });
  return page;
}

(async () => {
  assert(fs.existsSync(executable), 'Build the packaged EcoTrack executable before running this smoke check.');
  const originalBackendPresent = await portListening(5000);
  if (provisionOnly) {
    const publicConfig = { SUPABASE_URL: 'https://configuration-smoke.invalid',
      SUPABASE_ANON_KEY: 'sb_publishable_isolated_provisioning_check' };
    const input = path.join(profile, 'public-only-cloud.json');
    fs.writeFileSync(input, JSON.stringify(publicConfig));
    await launch(['--configure-cloud=' + input]);
    const configured = await app.evaluate(() => ({
      project_url: process.env.SUPABASE_URL,
      public_key_matches: process.env.SUPABASE_ANON_KEY === 'sb_publishable_isolated_provisioning_check',
      server_key_absent: !process.env.SUPABASE_SERVICE_ROLE_KEY
    }));
    assert.equal(configured.project_url, publicConfig.SUPABASE_URL);
    assert.equal(configured.public_key_matches, true); assert.equal(configured.server_key_absent, true);
    pass('Packaged configure-cloud import overrides bundled public defaults without a server key', configured);
    const encrypted = fs.readFileSync(path.join(runtimeHome, 'runtime-config.bin'));
    assert(!encrypted.includes(Buffer.from(publicConfig.SUPABASE_URL)));
    const decrypted = await app.evaluate(({ safeStorage }, encoded) => {
      const config = JSON.parse(safeStorage.decryptString(Buffer.from(encoded, 'base64')));
      return { encrypted_storage_available: safeStorage.isEncryptionAvailable(),
        imported_url_matches: config.SUPABASE_URL === 'https://configuration-smoke.invalid',
        imported_key_matches: config.SUPABASE_ANON_KEY === 'sb_publishable_isolated_provisioning_check' };
    }, encrypted.toString('base64'));
    assert(decrypted.encrypted_storage_available && decrypted.imported_url_matches && decrypted.imported_key_matches);
    pass('Packaged provisioning stores working Windows-encrypted configuration outside the installer', decrypted);
    const firstUrl = backendUrl; await app.close(); app = null; await waitForBackendExit(firstUrl);
    await launch();
    const restored = await app.evaluate(() => ({ project_url: process.env.SUPABASE_URL,
      public_key_matches: process.env.SUPABASE_ANON_KEY === 'sb_publishable_isolated_provisioning_check' }));
    assert.equal(restored.project_url, publicConfig.SUPABASE_URL); assert.equal(restored.public_key_matches, true);
    pass('Packaged restart restores imported encrypted cloud configuration', restored);
    const finalUrl = backendUrl; await app.close(); app = null; await waitForBackendExit(finalUrl);
    if (originalBackendPresent) assert.equal(await portListening(5000), true);
    assert.deepEqual(report.renderer_errors, []);
    pass('Provisioning smoke leaves no owned backend or renderer error and preserves the existing service', []);
    report.status = 'PASS'; report.completed_at = new Date().toISOString(); persist();
    console.log('PACKAGED_PROVISIONING_COMPLETE ' + report.checks.length + ' checks PASS');
    return;
  }
  let page = await launch();
  const runtime = await app.evaluate(({ app }) => ({ isPackaged: app.isPackaged,
    userData: app.getPath('userData'), resources: process.resourcesPath,
    sqlite: process.env.ECOTRACK_SQLITE_DB_PATH, backendUrl: process.env.BACKEND_URL }));
  assert.equal(runtime.isPackaged, true);
  assert.equal(path.resolve(runtime.userData), path.resolve(report.isolated_profile));
  assert.equal(path.resolve(runtime.sqlite), path.resolve(sqlitePath));
  assert(!path.resolve(runtime.sqlite).startsWith(path.resolve(runtime.resources) + path.sep));
  assert(fs.existsSync(sqlitePath) && fs.existsSync(keyPath));
  pass('Installed Electron launches its own frozen backend and writable isolated SQLite', {
    is_packaged: runtime.isPackaged, data_outside_installed_resources: true,
    runtime_created_without_development_python: true, sqlite_exists: true,
    backend_url: runtime.backendUrl });

  const health = await json('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.model, 'extra_trees');
  assert.equal(health.body.algorithm, 'ExtraTreesRegressor');
  assert.equal(health.body.prediction_status, 'research_estimate_ready');
  assert.equal(health.body.physical_accuracy_validated, false);
  pass('Bundled model loads with required library metadata and artifact integrity', health);

  const settings = { setpoint_c: 24, fan_command: 'medium', operating_mode: 'cool',
    eco: false, turbo: false, swing: true, quiet: false, horizontal_swing: false, display: true };
  const predict = await json('/api/predict-energy', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'extra_trees', settings }) });
  assert.equal(predict.status, 200);
  assert(Number.isFinite(predict.body.estimated_energy_kwh) && predict.body.estimated_energy_kwh >= 0);
  assert.equal(predict.body.measured_energy_kwh, null);
  assert.equal(predict.body.physically_confirmed_ac_on, null);
  pass('Actual packaged AI produces a finite research estimate without claiming measured energy', predict);

  const invalid = await json('/api/predict-energy', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'extra_trees', settings: { ...settings, setpoint_c: 40 } }) });
  assert.equal(invalid.status, 422); pass('Packaged AI rejects unsupported control inputs', invalid);
  const missing = await json('/api/predict-energy', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'extra_trees' }) });
  assert.equal(missing.status, 400); pass('Packaged AI rejects missing settings', missing);

  const unauthorized = await json('/api/monitoring/devices', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(unauthorized.status, 401);
  pass('Packaged local mutations retain administrator authorization', unauthorized);
  const token = fs.readFileSync(keyPath, 'utf8').trim();
  assert(token.length >= 32);
  const created = await json('/api/monitoring/devices', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ name: 'Isolated packaged smoke device', aircon_id: 'isolated-packaged-smoke-ac',
      aircon_name: 'Isolated packaged smoke AC', location: 'Software test only', expected_interval_seconds: 5 }) });
  assert.equal(created.status, 201);
  const deviceId = created.body.id;
  assert.match(deviceId, /^[a-f0-9-]{36}$/i);
  pass('Authenticated packaged SQLite metadata write and read succeed', {
    http: created.status, id: deviceId, latest: created.body.latest,
    measured_data_injected: false, device_token_redacted: true });
  const listed = await json('/api/monitoring/devices');
  assert.equal(listed.status, 200);
  assert(listed.body.items.some(item => item.id === deviceId && item.latest === null));
  pass('SQLite exposes persisted metadata with absent measurements still null', { http: listed.status,
    matched_device: true, observation_count: listed.body.items.filter(item => item.latest).length });

  const renderer = await page.evaluate(() => ({ title: document.title,
    isolated: typeof require === 'undefined', bridge: typeof window.electron?.invoke,
    loginVisible: Boolean(document.getElementById('email')), bodyWidth: document.body.scrollWidth,
    viewportWidth: innerWidth }));
  assert.equal(renderer.isolated, true); assert.equal(renderer.bridge, 'function'); assert(renderer.loginVisible);
  pass('Packaged login and isolated preload render without signing in or cloud writes', renderer);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const png = await app.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64'));
  fs.writeFileSync(path.join(output, 'packaged-login.png'), Buffer.from(png, 'base64'));
  report.screenshots.push('packaged-login.png');
  const firstUrl = backendUrl;
  await app.close(); app = null;
  await waitForBackendExit(firstUrl);
  if (originalBackendPresent) assert.equal(await portListening(5000), true, 'The pre-existing backend must remain running.');
  pass('Closing EcoTrack stops its owned backend without stopping the existing service', {
    owned_backend_closed: true, pre_existing_port_5000_preserved: originalBackendPresent });

  page = await launch();
  const persisted = await json('/api/monitoring/devices');
  assert.equal(persisted.status, 200);
  assert(persisted.body.items.some(item => item.id === deviceId && item.name === 'Isolated packaged smoke device'));
  pass('Packaged restart preserves SQLite data and starts a working backend', {
    http: persisted.status, same_device_id: deviceId, persisted: true });
  const restartedHealth = await json('/api/health');
  assert.equal(restartedHealth.body.prediction_status, 'research_estimate_ready');
  pass('Model remains available after packaged restart', { prediction_status: restartedHealth.body.prediction_status });
  const finalUrl = backendUrl;
  await app.close(); app = null; await waitForBackendExit(finalUrl);
  assert.deepEqual(report.renderer_errors, []);
  pass('Packaged runtime has no observed renderer errors and leaves no owned backend', []);
  report.status = 'PASS'; report.completed_at = new Date().toISOString(); persist();
  console.log('PACKAGED_RELEASE_COMPLETE ' + report.checks.length + ' checks PASS');
})().catch(error => {
  report.status = 'FAIL'; report.failure = error.stack; persist();
  console.error(error.message); process.exitCode = 1;
}).finally(async () => {
  if (app) { const url = backendUrl; await app.close().catch(() => {}); if (url) await waitForBackendExit(url).catch(() => {}); }
});
