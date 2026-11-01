'use strict';
// Read-only verification of the built archive/resources. Secrets stay in memory;
// evidence contains only variable names, booleans, counts and public file hashes.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const asar = require('@electron/asar');
const dotenv = require('dotenv');
const root = path.resolve(__dirname, '..');
const release = path.resolve(process.env.ECOTRACK_RELEASE_DIR || path.join(root, 'dist/ecotrack-20261030'));
const resources = path.join(release, 'win-unpacked/resources');
const archive = path.join(resources, 'app.asar');
const output = path.join(root, 'reports/packaging-20261030/archive-verification.json');
const report = { status: 'RUNNING', checked_at: new Date().toISOString(), release,
  read_only: true, application_launched: false, production_rows_written: 0,
  checks: [], failures: [], workspace_hashes: [], model_hashes: [], secret_scan: [] };
const normalized = value => value.replace(/\\/g, '/').replace(/^\/+/, '');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function check(name, passed, evidence = {}) {
  report.checks.push({ name, status: passed ? 'PASS' : 'FAIL', ...evidence });
  if (!passed) report.failures.push(name);
}
function filesUnder(folder) {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(folder, entry.name);
    return entry.isDirectory() ? filesUnder(file) : entry.isFile() ? [file] : [];
  });
}
function isPublicKey(value) {
  if (typeof value !== 'string') return false;
  if (value.startsWith('sb_publishable_')) return true;
  try { return JSON.parse(Buffer.from(value.split('.')[1], 'base64url')).role === 'anon'; }
  catch (_) { return false; }
}
function collectPrivateValues() {
  const found = [];
  const consider = (name, value) => {
    if (typeof value !== 'string' || value.trim().length < 12) return;
    if (!/(?:SECRET|PASSWORD|TOKEN|PRIVATE|SERVICE_ROLE|SUPABASE_KEY|ADMIN_KEY)/i.test(name)) return;
    if (isPublicKey(value)) return;
    found.push({ name, value: value.trim() });
  };
  for (const location of ['', 'backend']) {
    const folder = path.join(root, location);
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if (!entry.isFile() || !/^\.env(?:\.|$)/.test(entry.name) || /example|sample|template/i.test(entry.name)) continue;
      const file = path.join(folder, entry.name);
      for (const [name, value] of Object.entries(dotenv.parse(fs.readFileSync(file)))) consider(normalized(path.relative(root, file)) + ':' + name, value);
    }
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if (entry.isFile() && /^\.ecotrack-.*\.key$/i.test(entry.name)) {
        found.push({ name: normalized(path.join(location, entry.name)), value: fs.readFileSync(path.join(folder, entry.name), 'utf8').trim() });
      }
    }
  }
  for (const [name, value] of Object.entries(process.env)) {
    if (/^(?:SUPABASE_|EXPO_PUBLIC_SUPABASE_|ECOTRACK_|WIFI_)/.test(name)) consider('process.env:' + name, value);
  }
  return found.filter(item => item.value.length >= 12);
}
try {
  const allEntries = asar.listPackage(archive).map(normalized);
  const nativeArchivePath = file => file.split('/').join(path.sep);
  const archiveFiles = allEntries.filter(file => !asar.statFile(archive, nativeArchivePath(file)).files);
  const archiveSet = new Set(archiveFiles);
  const extract = file => asar.extractFile(archive, nativeArchivePath(file));
  const activePages = ['analytics.html', 'telemetry.html', 'dashboard.html', 'control.html', 'nodes.html',
    'ir-library.html', 'scheduler.html', 'rules.html', 'Notification.html', 'staff.html', 'sensor-logs.html'];
  check('All 11 active application pages are included', activePages.every(file => archiveSet.has('public/' + file)), { pages: activePages });
  const required = new Set([...activePages.map(file => 'public/' + file), 'public/login.html', 'public/profile.html',
    'public/sidebar-template.html', 'public/styles.css', ...filesUnder(path.join(root, 'src')).map(file => normalized(path.relative(root, file))),
    ...filesUnder(path.join(root, 'public/js')).map(file => normalized(path.relative(root, file))),
    ...filesUnder(path.join(root, 'public/css')).map(file => normalized(path.relative(root, file))),
    ...filesUnder(path.join(root, 'public/vendor')).filter(file => !['.gitattributes', '.gitignore', '.gitkeep'].includes(path.basename(file)))
      .map(file => normalized(path.relative(root, file)))]);
  for (const file of required) {
    const sourceHash = hash(fs.readFileSync(path.join(root, file)));
    const packagedHash = archiveSet.has(file) ? hash(extract(file)) : null;
    report.workspace_hashes.push({ file, source_sha256: sourceHash, packaged_sha256: packagedHash, matches: sourceHash === packagedHash });
  }
  check('Current pages, main/preload/runtime, shared scripts, CSS and vendor assets match packaged bytes',
    report.workspace_hashes.every(item => item.matches), { files: report.workspace_hashes.length });
  const login = extract('public/login.html').toString('utf8');
  check('Login uses the bundled Tailwind script', /<script\s+src=["']\.\/vendor\/tailwindcss\.js["']/.test(login) &&
    !/<script[^>]+src=["']https?:\/\/cdn\.tailwindcss\.com/.test(login), { local_vendor_present: archiveSet.has('public/vendor/tailwindcss.js') });
  check('Packaged backend runtime includes encrypted configure-cloud support',
    extract('src/backend-runtime.js').toString('utf8').includes("getSwitchValue('configure-cloud')") &&
    extract('src/backend-runtime.js').toString('utf8').includes('safeStorage.encryptString'));
  for (const name of ['model.joblib', 'manifest.json', 'assumptions.json', 'supported_inputs.json.gz']) {
    const source = path.join(root, 'backend/ml/control_extra_trees', name);
    const packaged = path.join(resources, 'backend/_internal/backend/ml/control_extra_trees', name);
    const sourceHash = hash(fs.readFileSync(source)), packagedHash = hash(fs.readFileSync(packaged));
    report.model_hashes.push({ file: name, source_sha256: sourceHash, packaged_sha256: packagedHash, matches: sourceHash === packagedHash });
  }
  check('All four frozen AI model artifacts exactly match the current source model', report.model_hashes.every(item => item.matches));
  const backendFiles = filesUnder(path.join(resources, 'backend'));
  const resourceFiles = filesUnder(resources).filter(file => file !== archive);
  // Upstream sklearn distribution data is separate from application audit/test
  // fixtures; it never contains EcoTrack observations or user credentials.
  const upstreamDataset = file => /^backend\/_internal\/sklearn\/datasets\/tests\/data\//.test(file);
  const forbidden = file => /(?:^|\/)\.env(?:\.|$)|\.(?:db|sqlite|sqlite3)(?:-(?:wal|shm|journal))?$|\.(?:key|pfx|p12)$/i.test(file) ||
    (!upstreamDataset(file) && /(?:^|\/)(?:reports|scratch|audits?|fixtures?|tests?|backups)(?:\/|$)/i.test(file)) ||
    /(?:^|\/)(?:wifi[_-]?(?:credentials|secrets)|\.ecotrack-wifi[^/]*)\.json$/i.test(file);
  const forbiddenArchive = archiveFiles.filter(forbidden);
  const forbiddenResources = resourceFiles.map(file => normalized(path.relative(resources, file))).filter(forbidden);
  const upstreamFiles = resourceFiles.filter(file => upstreamDataset(normalized(path.relative(resources, file))));
  const upstreamMatches = upstreamFiles.every(file => {
    const relative = normalized(path.relative(path.join(resources, 'backend/_internal'), file));
    const installed = path.join(root, 'venv/Lib/site-packages', relative);
    return fs.existsSync(installed) && hash(fs.readFileSync(file)) === hash(fs.readFileSync(installed));
  });
  report.upstream_dependency_test_data = { package: 'scikit-learn', path: 'backend/_internal/sklearn/datasets/tests/data',
    files: upstreamFiles.length, bytes: upstreamFiles.reduce((total, file) => total + fs.statSync(file).size, 0),
    matches_installed_dependency: upstreamMatches,
    ecotrack_audit_or_user_data: false, note: 'Unmodified upstream distribution resources collected by PyInstaller; private-file and exact-secret scans still apply.' };
  check('Upstream scikit-learn dataset resources match the installed dependency', upstreamMatches, { files: upstreamFiles.length });
  check('No private env/database/key, saved Wi-Fi secrets or application audit/test fixtures are shipped',
    forbiddenArchive.length === 0 && forbiddenResources.length === 0,
    { archive_violations: forbiddenArchive, resource_violations: forbiddenResources, backend_files_checked: backendFiles.length });
  const publicConfig = JSON.parse(fs.readFileSync(path.join(resources, 'ecotrack-public.json'), 'utf8'));
  const allowlisted = Object.keys(publicConfig).sort().join(',') === ['SUPABASE_ANON_KEY', 'SUPABASE_URL'].sort().join(',');
  const publicOnly = allowlisted && isPublicKey(publicConfig.SUPABASE_ANON_KEY) && /^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(publicConfig.SUPABASE_URL);
  check('Public configuration contains only HTTPS Supabase URL and publishable/anon key', publicOnly,
    { keys: Object.keys(publicConfig).sort(), public_key_kind: isPublicKey(publicConfig.SUPABASE_ANON_KEY) ? 'publishable_or_anon' : 'INVALID' });
  const privateValues = collectPrivateValues();
  const archiveBytes = fs.readFileSync(archive);
  const candidates = privateValues.map(({ name, value }) => ({ name, patterns: [Buffer.from(value, 'utf8'), Buffer.from(value, 'utf16le')],
    archive_match: false, backend_match: false, resources_match: false }));
  for (const item of candidates) item.archive_match = item.patterns.some(pattern => archiveBytes.includes(pattern));
  for (const file of resourceFiles) {
    const bytes = fs.readFileSync(file), backend = file.startsWith(path.join(resources, 'backend') + path.sep);
    for (const item of candidates) if (item.patterns.some(pattern => bytes.includes(pattern))) {
      item.resources_match = true; if (backend) item.backend_match = true;
    }
  }
  report.secret_scan = candidates.map(({ name, archive_match, backend_match, resources_match }) => ({ name, checked: true, archive_match, backend_match, resources_match }));
  check('Exact current private credential bytes are absent from archive and backend/resources',
    candidates.length > 0 && candidates.every(item => !item.archive_match && !item.resources_match),
    { private_values_checked: candidates.length, archive_bytes_checked: archiveBytes.length,
      resource_files_checked: resourceFiles.length, scan_scope: 'Exact UTF-8/UTF-16LE bytes in on-disk archive and resource files; no credential values exported' });
  const python = String.raw`import hashlib,json,sqlite3
from pathlib import Path
out=Path('reports/packaging-20261030/integration')
prior=json.loads((out/'database-config-baseline.json').read_text(encoding='utf-8'))
con=sqlite3.connect('file:'+Path('backend/telemetry.db').resolve().as_posix()+'?mode=ro',uri=True)
con.row_factory=sqlite3.Row
result={'quick_check':con.execute('pragma quick_check').fetchone()[0],'tables':{},'unchanged':True}
for name,baseline in prior['tables'].items():
 rows=[dict(row) for row in con.execute('select * from '+name)]
 rows.sort(key=lambda row:json.dumps(row,sort_keys=True,default=str))
 digest=hashlib.sha256(json.dumps(rows,sort_keys=True,default=str).encode()).hexdigest()
 matches=len(rows)==baseline['rows'] and digest==baseline['sha256_logical_rows']
 result['tables'][name]={'rows':len(rows),'sha256_logical_rows':digest,'unchanged':matches}
 result['unchanged']=result['unchanged'] and matches
con.close()
print(json.dumps(result))`;
  const sqlite = spawnSync(path.join(root, 'venv/Scripts/python.exe'), ['-c', python], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (sqlite.status !== 0) throw new Error('Read-only SQLite snapshot check could not complete.');
  report.sqlite = JSON.parse(sqlite.stdout);
  check('Original SQLite archive still has 47 telemetry rows and five unchanged content hashes',
    report.sqlite.quick_check === 'ok' && report.sqlite.unchanged && report.sqlite.tables.telemetry.rows === 47);
  report.archive = { bytes: archiveBytes.length, sha256: hash(archiveBytes), files: archiveFiles.length };
  if (process.argv.includes('--include-installer')) {
    const installer = path.join(release, 'EcoTrack-Setup-1.0.0-2026-10-30.exe');
    const bytes = fs.readFileSync(installer);
    report.installer = { file: path.basename(installer), bytes: bytes.length, sha256: hash(bytes),
      last_modified: fs.statSync(installer).mtime.toISOString() };
    check('Completed NSIS installer exists and has an executable header', bytes.length > 1000000 && bytes.subarray(0, 2).toString() === 'MZ');
  }
  report.status = report.failures.length ? 'FAIL' : 'PASS';
} catch (error) { report.status = 'FAIL'; report.error = error.message; process.exitCode = 1; }
finally {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, failures: report.failures,
    evidence: path.relative(root, output), error: report.error }, null, 2));
  if (report.status !== 'PASS') process.exitCode = 1;
}
