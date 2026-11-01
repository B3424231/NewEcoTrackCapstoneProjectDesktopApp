'use strict';
// Only the packaged app may encrypt its configuration: safeStorage keys belong
// to the Chromium profile, not just the Windows account.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  if (!process.argv[index + 1] || process.argv[index + 1].startsWith('--')) throw new Error('Missing value for ' + name);
  return path.resolve(process.argv[index + 1]);
}
let temporaryInput;
try {
  const specified = argument('--exe');
  const executable = specified || [
    path.join(process.env.LOCALAPPDATA || '', 'Programs/EcoTrack/EcoTrack.exe'),
    path.join(root, 'dist/ecotrack-20261030/win-unpacked/EcoTrack.exe')
  ].find(file => fs.existsSync(file));
  if (!executable || !fs.existsSync(executable)) throw new Error('Build or install EcoTrack first, or pass --exe <path to EcoTrack.exe>.');
  let input = argument('--config');
  if (!input) {
    const config = {}, dotenv = require('dotenv');
    for (const relative of ['.env', 'backend/.env']) {
      const source = path.join(root, relative);
      if (fs.existsSync(source)) for (const [key, value] of Object.entries(dotenv.parse(fs.readFileSync(source))))
        if (['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'].includes(key)) config[key] = value;
    }
    if (!config.SUPABASE_URL || !config.SUPABASE_ANON_KEY) throw new Error('Project cloud settings are incomplete.');
    const temporaryFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'ecotrack-private-import-'));
    temporaryInput = path.join(temporaryFolder, 'cloud.json');
    fs.writeFileSync(temporaryInput, JSON.stringify(config), { mode: 0o600, flag: 'wx' });
    input = temporaryInput;
  }
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(executable, ['--configure-cloud=' + input, '--configure-only'], {
    cwd: path.dirname(executable), env, windowsHide: true, stdio: 'ignore', timeout: 30000
  });
  if (result.error || result.status !== 0) throw new Error(result.status === 2
    ? 'Close the running EcoTrack application, then repeat configuration.'
    : 'EcoTrack could not import the configuration. Use the rebuilt executable and a valid private JSON file.');
  console.log('Cloud configuration imported by packaged EcoTrack for its own Windows profile. No backend or database was started.');
} catch (error) {
  console.error(error.message); process.exitCode = 1;
} finally {
  if (temporaryInput && fs.existsSync(temporaryInput)) fs.unlinkSync(temporaryInput);
}
