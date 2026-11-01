'use strict';
// Actual Windows safeStorage + packaged executable. Public-only fixtures and
// disposable Chromium/SQLite directories; never reads project credentials.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { _electron } = require(process.env.ECOTRACK_PLAYWRIGHT || 'C:/Users/reygay/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const executable = process.env.ECOTRACK_PACKAGED_EXE || path.join(root, 'dist/ecotrack-20261030/win-unpacked/EcoTrack.exe');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ecotrack-profile-recovery-'));
const runtime = path.join(temporary, 'runtime'), profile = path.join(temporary, 'packaged-profile');
fs.mkdirSync(runtime);
const encrypted = path.join(runtime, 'runtime-config.bin');
const input = path.join(temporary, 'public-only.json');
const config = { SUPABASE_URL: 'https://profile-recovery.invalid', SUPABASE_ANON_KEY: 'sb_publishable_profile_recovery' };
fs.writeFileSync(input, JSON.stringify(config));
const env = { ...process.env, ECOTRACK_USER_DATA_PATH: profile, ECOTRACK_RUNTIME_HOME: runtime,
  ECOTRACK_TELEMETRY_SYNC: '0', ECOTRACK_MONITOR_SYNC: '0', ECOTRACK_BACKUP_ENABLED: '0' };
for (const key of Object.keys(env)) if (/^(SUPABASE_|EXPO_PUBLIC_SUPABASE_|PYTHONPATH$|PYTHONHOME$)/.test(key) ||
  ['ELECTRON_RUN_AS_NODE', 'ECOTRACK_SQLITE_DB_PATH', 'ECOTRACK_CONFIG_PATH', 'ECOTRACK_MONITOR_ADMIN_TOKEN', 'ECOTRACK_MONITOR_KEY_PATH', 'BACKEND_URL', 'PORT'].includes(key)) delete env[key];
const output = path.join(root, 'reports/packaging-20261030/config-recovery/packaged-results.json');
const report = { status: 'RUNNING', executable, disposable_profile: profile, live_database_access: false, cloud_writes: false, checks: [] };
let application;
function save() { fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2)); }
function pass(name, actual = true) { report.checks.push({ name, status: 'PASS', actual }); save(); console.log('PASS ' + name); }
function configure() {
  return spawnSync(process.execPath, [path.join(root, 'scripts/configure-packaged-install.cjs'), '--exe', executable, '--config', input], {
    cwd: root, env, windowsHide: true, encoding: 'utf8', timeout: 40000
  });
}
async function launch() {
  application = await _electron.launch({ executablePath: executable, args: [], cwd: path.dirname(executable), env, timeout: 120000 });
  await application.evaluate(({ session }) => session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url); callback({ cancel: ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) });
  }));
  const page = await application.firstWindow({ timeout: 120000 });
  await page.locator('#email').waitFor({ timeout: 45000 });
}
(async () => {
  const probe = path.join(temporary, 'profile-probe.cjs');
  fs.writeFileSync(probe, `const {app,safeStorage}=require('electron'),fs=require('fs');app.setPath('userData',process.env.PROBE_PROFILE);app.whenReady().then(()=>{if(process.env.PROBE_WRITE){fs.writeFileSync(process.env.PROBE_CIPHER,safeStorage.encryptString(fs.readFileSync(process.env.PROBE_INPUT,'utf8')));console.log('ENCRYPTED');}else{try{safeStorage.decryptString(fs.readFileSync(process.env.PROBE_CIPHER));console.log('DECRYPTED');}catch{console.log('PROFILE_MISMATCH');}}app.quit();});`);
  function probeProfile(profilePath, write) {
    const result = spawnSync(require('electron'), [probe], { env: { ...env, PROBE_PROFILE: profilePath, PROBE_CIPHER: encrypted, PROBE_INPUT: input, ...(write ? { PROBE_WRITE: '1' } : {}) },
      windowsHide: true, encoding: 'utf8', timeout: 20000 });
    assert.equal(result.status, 0); return result.stdout;
  }
  const developmentProfile = path.join(temporary, 'development-profile');
  assert.match(probeProfile(developmentProfile, true), /ENCRYPTED/);
  assert.match(probeProfile(developmentProfile, false), /DECRYPTED/);
  assert.match(probeProfile(profile, false), /PROFILE_MISMATCH/);
  const oldCiphertext = fs.readFileSync(encrypted);
  pass('Reproduced development-to-packaged profile encryption mismatch with real Windows safeStorage');

  const imported = configure();
  assert.equal(imported.status, 0, imported.stderr);
  assert.deepEqual(fs.readFileSync(encrypted + '.previous'), oldCiphertext);
  assert(!fs.existsSync(path.join(runtime, 'data')));
  assert(!fs.existsSync(path.join(runtime, 'backend.log')));
  assert(!fs.readFileSync(encrypted).includes(Buffer.from(config.SUPABASE_ANON_KEY)));
  pass('Configuration helper imports through packaged app, retains old encrypted file, and starts no backend/database');

  await launch();
  const restored = await application.evaluate(({ app, safeStorage }, encoded) => {
    const config = JSON.parse(safeStorage.decryptString(Buffer.from(encoded, 'base64')));
    return { packaged: app.isPackaged, profile: app.getPath('userData'),
      url_matches: config.SUPABASE_URL === process.env.SUPABASE_URL && config.SUPABASE_URL === 'https://profile-recovery.invalid',
      public_key_matches: config.SUPABASE_ANON_KEY === process.env.SUPABASE_ANON_KEY,
      server_key_absent: !process.env.SUPABASE_SERVICE_ROLE_KEY, backend: process.env.BACKEND_URL };
  }, fs.readFileSync(encrypted).toString('base64'));
  assert(restored.packaged && restored.url_matches && restored.public_key_matches && restored.server_key_absent);
  assert.equal(path.resolve(restored.profile), path.resolve(profile));
  const health = await fetch(restored.backend + '/api/health').then(r => r.json());
  assert.equal(health.prediction_status, 'research_estimate_ready');
  pass('Recovered packaged startup decrypts settings, renders login and loads bundled AI', restored);

  const beforeLockedImport = fs.readFileSync(encrypted);
  const locked = configure();
  assert.equal(locked.status, 1); assert.match(locked.stderr, /Close the running EcoTrack/);
  assert.deepEqual(fs.readFileSync(encrypted), beforeLockedImport);
  pass('Helper reports a running-app profile lock instead of falsely claiming successful configuration');

  await application.close(); application = null;
  const beforeInvalid = fs.readFileSync(encrypted);
  fs.writeFileSync(input, JSON.stringify({ SUPABASE_URL: 'http://invalid.invalid', SUPABASE_ANON_KEY: 'not-a-public-key' }));
  const invalid = configure(); assert.equal(invalid.status, 1);
  assert.deepEqual(fs.readFileSync(encrypted), beforeInvalid);
  pass('Invalid reimport is rejected without altering working encrypted configuration');

  await launch();
  const afterRestart = await application.evaluate(() => ({ url_matches: process.env.SUPABASE_URL === 'https://profile-recovery.invalid', backend: process.env.BACKEND_URL }));
  assert(afterRestart.url_matches);
  const restartedHealth = await fetch(afterRestart.backend + '/api/health').then(r => r.json());
  assert.equal(restartedHealth.prediction_status, 'research_estimate_ready');
  await application.close(); application = null;
  pass('A normal packaged restart restores recovered settings and a ready AI backend');
  report.status = 'PASS'; report.completed_at = new Date().toISOString(); save();
  console.log('CONFIG_RECOVERY_COMPLETE ' + report.checks.length + ' checks PASS');
})().catch(error => { report.status = 'FAIL'; report.failure = error.stack; save(); console.error(error.message); process.exitCode = 1; })
  .finally(async () => { if (application) await application.close().catch(() => {}); });
