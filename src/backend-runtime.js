'use strict';
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

function readRuntimeConfig(app, safeStorage) {
  const folder = process.env.ECOTRACK_RUNTIME_HOME || path.join(app.getPath('appData'), 'EcoTrack');
  fs.mkdirSync(folder, { recursive: true });
  const encrypted = path.join(folder, 'runtime-config.bin');
  const configureFrom = app.commandLine.getSwitchValue('configure-cloud');
  if (configureFrom) {
    const input = JSON.parse(fs.readFileSync(path.resolve(configureFrom), 'utf8'));
    const config = Object.fromEntries(['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']
      .filter(key => typeof input[key] === 'string' && input[key].trim()).map(key => [key, input[key].trim()]));
    if (!config.SUPABASE_URL?.startsWith('https://') || !config.SUPABASE_ANON_KEY) throw new Error('Cloud configuration requires an HTTPS project URL and public key.');
    let isPublic = config.SUPABASE_ANON_KEY.startsWith('sb_publishable_');
    try { isPublic ||= JSON.parse(Buffer.from(config.SUPABASE_ANON_KEY.split('.')[1], 'base64url').toString()).role === 'anon'; } catch (_) {}
    if (!isPublic) throw new Error('The public cloud key must not be a server credential.');
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows credential encryption is unavailable.');
    const ciphertext = safeStorage.encryptString(JSON.stringify(config));
    // Encrypt inside this app's Chromium profile. A development Electron profile
    // has a different key, even when it belongs to the same Windows account.
    const pending = encrypted + '.tmp';
    try {
      fs.writeFileSync(pending, ciphertext, { mode: 0o600 });
      if (fs.existsSync(encrypted)) fs.copyFileSync(encrypted, encrypted + '.previous');
      fs.renameSync(pending, encrypted);
    } finally {
      if (fs.existsSync(pending)) fs.unlinkSync(pending);
    }
  }
  if (fs.existsSync(encrypted)) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows could not unlock EcoTrack configuration.');
    let config;
    try {
      config = JSON.parse(safeStorage.decryptString(fs.readFileSync(encrypted)));
    } catch (_) {
      const error = new Error('EcoTrack could not unlock the saved cloud settings in this Windows/app profile. Your settings and database have been kept. Close EcoTrack, then import your cloud configuration using EcoTrack.exe --configure-cloud="C:\\secure\\ecotrack-runtime.json".');
      error.code = 'ECOTRACK_CONFIG_LOCKED';
      throw error;
    }
    for (const [key, value] of Object.entries(config)) if (/^(SUPABASE_|ECOTRACK_)/.test(key) && typeof value === 'string' && !process.env[key]) process.env[key] = value;
  }
  const publicPath = path.join(process.resourcesPath, 'ecotrack-public.json');
  if (fs.existsSync(publicPath)) {
    const config = JSON.parse(fs.readFileSync(publicPath, 'utf8'));
    for (const key of ['SUPABASE_URL', 'SUPABASE_ANON_KEY']) if (config[key] && !process.env[key]) process.env[key] = config[key];
  }
  return folder;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer(); server.unref(); server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(error => error ? reject(error) : resolve(port)); });
  });
}

async function startBackend(app, safeStorage) {
  if (!app.isPackaged) return { stop() {} };
  const folder = readRuntimeConfig(app, safeStorage);
  const dataFolder = path.join(folder, 'data'); fs.mkdirSync(dataFolder, { recursive: true });
  process.env.ECOTRACK_SQLITE_DB_PATH ||= path.join(dataFolder, 'telemetry.db');
  const port = await freePort();
  process.env.BACKEND_URL = 'http://127.0.0.1:' + port;
  const executable = path.join(process.resourcesPath, 'backend', 'ecotrack-backend.exe');
  if (!fs.existsSync(executable)) throw new Error('The EcoTrack backend is missing. Reinstall EcoTrack.');
  const log = fs.openSync(path.join(folder, 'backend.log'), 'a');
  const child = spawn(executable, [], { cwd: dataFolder, windowsHide: true,
    env: { ...process.env, PORT: String(port), PYTHONUTF8: '1', FLASK_DEBUG: '0' }, stdio: ['ignore', log, log] });
  fs.closeSync(log);
  let failure = null, exited = false;
  child.once('error', error => { failure = error; }); child.once('exit', () => { exited = true; });
  let stopping = false;
  const stop = () => { if (!stopping && !exited) { stopping = true; child.kill(); } };
  app.once('will-quit', stop);
  try {
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      if (failure) throw failure;
      if (exited) throw new Error('EcoTrack backend stopped during startup. See backend.log in the EcoTrack app-data folder.');
      try {
        const response = await fetch(process.env.BACKEND_URL + '/api/health', { signal: AbortSignal.timeout(1500) });
        if (response.ok && (await response.json()).service === 'EcoTrack Machine Learning Backend') return { stop, pid: child.pid, folder, url: process.env.BACKEND_URL };
      } catch (_) {}
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error('EcoTrack backend did not become ready. See backend.log in the EcoTrack app-data folder.');
  } catch (error) { stop(); throw error; }
}
module.exports = { startBackend, readRuntimeConfig, freePort };
