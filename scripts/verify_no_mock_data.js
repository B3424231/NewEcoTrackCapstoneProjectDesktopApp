const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

console.log('━━━ AUDITING CODEBASE: ZERO MOCK DATA INTEGRITY ━━━\n');

let failed = 0;
let passed = 0;

function test(name, condition, errorMsg) {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.error(`  ❌ ${name}: ${errorMsg}`);
    failed++;
  }
}

// 1. shared.js
const sharedPath = path.join(__dirname, '../public/js/shared.js');
const sharedCode = fs.readFileSync(sharedPath, 'utf8');
test(
  'shared.js: MockDataGenerator injection removed',
  !sharedCode.includes('MockDataGenerator.generateFullDataset'),
  'Still calls MockDataGenerator'
);
test(
  'shared.js: MockPocketBase class removed',
  !sharedCode.includes('class MockPocketBase'),
  'Still defines MockPocketBase'
);
test(
  'shared.js: Fake fetch interceptor removed',
  !sharedCode.includes('window.fetch = async') && !sharedCode.includes('mock-token'),
  'Still intercepts window.fetch with mock tokens/data'
);

// 2. login.js
const loginPath = path.join(__dirname, '../public/js/login.js');
const loginCode = fs.readFileSync(loginPath, 'utf8');
test(
  'login.js: Offline mock admin login removed',
  !loginCode.includes('admin@ecotrack.local') && !loginCode.includes('adminpassword123'),
  'Still contains offline mock login credentials'
);

// 3. maintenance-modal.js
const maintPath = path.join(__dirname, '../public/js/maintenance-modal.js');
const maintCode = fs.readFileSync(maintPath, 'utf8');
test(
  'maintenance-modal.js: Hardcoded AIRCONS_DATABASE array removed',
  !maintCode.includes("room: 'Room 101'") && !maintCode.includes("brand: 'Panasonic'"),
  'Still contains hardcoded mock aircons'
);
test(
  'maintenance-modal.js: Hardcoded DEFAULT_STAFF array removed',
  !maintCode.includes("carlos@ecotrack.local"),
  'Still contains hardcoded mock staff'
);
test(
  'maintenance-modal.js: Hardcoded DEFAULT_REPORTS array removed',
  !maintCode.includes("MR-2026-001"),
  'Still contains hardcoded mock maintenance reports'
);

// Current telemetry, analytics and energy pages share the sensor workspace.
const sensorPath = path.join(__dirname, '../public/js/sensor-workspace.js');
const sensorCode = fs.readFileSync(sensorPath, 'utf8');
test(
  'sensor-workspace.js: No legacy mock data layer or generator',
  !/EcoTrackDataLayer|MockDataGenerator|MockPocketBase|generateMockData|loadMockMessages/.test(sensorCode),
  'The active sensor workspace contains a legacy mock data provider'
);
test(
  'sensor-workspace.js: No random telemetry, compliance or demo cadence',
  !/Math\s*\.\s*random\s*\(|UI_CADENCE_MS|lastUIUpdateMap|Mock compliance/.test(sensorCode),
  'The active telemetry/analytics renderer contains a fabricated reading or demo cadence source'
);
test(
  'sensor-workspace.js: Observations come from the local monitoring API',
  sensorCode.includes("'/api/monitoring'") && sensorCode.includes("request('/devices'") &&
    sensorCode.includes("request('/analytics?'") && sensorCode.includes("request('/telemetry?'") &&
    sensorCode.includes("request('/energy?'") && sensorCode.includes('nodes = data.items') &&
    sensorCode.includes('history = rows?.items || []'),
  'The current telemetry, analytics and energy views no longer use recorded monitoring responses'
);
// Exercise the real formatting/power helpers so missing values cannot silently become
// plausible readings, and requested/online state cannot become confirmed AC power.
try {
  const declaration = name => {
    const match = sensorCode.match(new RegExp('^  const ' + name + ' =[^\\r\\n]+;', 'm'));
    if (!match) throw new Error('Missing current sensor helper: ' + name);
    return match[0];
  };
  const context = vm.createContext({});
  vm.runInContext(['esc','num','rotationValue','stamp','badge','state'].map(declaration).join('\n') +
    '\nthis.currentSensor = {num,rotationValue,stamp,state};', context);
  const sensor = context.currentSensor;
  test('sensor-workspace.js: Missing measurements use a dash and real zero stays zero',
    [null,undefined,NaN,Infinity,'23'].every(value => sensor.num(value) === '—') &&
      /^0(?:\.0+)?$/.test(sensor.num(0)),
    'A missing/invalid measurement is presented as a number or a valid zero is discarded');
  test('sensor-workspace.js: Faulty rotation stays null and absent timestamps stay unrecorded',
    sensor.rotationValue(null) === null && sensor.rotationValue({rotation_rpm:120,rotation_quality:'fault'}) === null &&
      sensor.rotationValue({rotation_rpm:-1}) === null && sensor.rotationValue({rotation_rpm:0,rotation_quality:'ok'}) === 0 &&
      sensor.stamp(null) === 'No reading' && sensor.stamp('invalid') === 'No reading',
    'Faulty/missing measurements or dates are replaced with fabricated observations');
  const unknown = [null,{}, {status:'online',desired_state:{power:true}}].map(value => sensor.state(value));
  test('sensor-workspace.js: AC power requires explicit fresh feedback',
    unknown.every(value => value.includes('Not reported') && !value.includes('Confirmed ON')) &&
      sensor.state({ac_on:true}).includes('Confirmed ON') && sensor.state({ac_on:false}).includes('Confirmed OFF') &&
      sensor.state({ac_on:true},false).includes('No recent feedback'),
    'Missing/stale AC feedback, connectivity or requested power is displayed as confirmed operation');
} catch (error) {
  test('sensor-workspace.js: Current measurement helpers can be verified', false, error.message);
}

// 6. notifications.js
const notifPath = path.join(__dirname, '../public/js/notifications.js');
const notifCode = fs.readFileSync(notifPath, 'utf8');
test(
  'notifications.js: EcoTrackDataLayer fallbacks removed',
  !notifCode.includes('EcoTrackDataLayer'),
  'Still contains EcoTrackDataLayer fallback'
);
test(
  'notifications.js: loadMockMessages renamed to loadNotificationMessages',
  !notifCode.includes('loadMockMessages') && notifCode.includes('loadNotificationMessages'),
  'Still calls or defines loadMockMessages'
);

// 7. supabase-client.js
const sbPath = path.join(__dirname, '../public/js/supabase-client.js');
const sbCode = fs.readFileSync(sbPath, 'utf8');
test(
  'supabase-client.js: EcoTrackDataLayer fallbacks removed',
  !sbCode.includes('EcoTrackDataLayer'),
  'Still contains fallback to EcoTrackDataLayer'
);

// 8. HTML files script tags
const publicRoot = path.join(__dirname, '../public');
function desktopHtmlFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() && entry.name !== 'vendor' ? desktopHtmlFiles(file) :
      entry.isFile() && /\.html$/i.test(entry.name) ? [file] : [];
  });
}
const htmlFiles = desktopHtmlFiles(publicRoot).sort();
test('Desktop HTML audit discovers current application pages',
  ['telemetry.html','analytics.html','sensor-logs.html','control.html','nodes.html','profile.html'].every(file => htmlFiles.includes(path.join(publicRoot,file))),
  'A current application page is missing from the audit');
htmlFiles.forEach(htmlPath => {
  const file = path.relative(publicRoot, htmlPath);
  const htmlCode = fs.readFileSync(htmlPath, 'utf8');
  const scripts = [...htmlCode.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)].map(match => match[1]);
  test(
    `${file}: Does not load a mock data provider`,
    !scripts.some(src => /(?:^|\/)(?:data-schemas|data-logic|mock-data|mock-data-generator)\.js(?:[?#]|$)/i.test(src)),
    'Still loads a legacy mock data provider script'
  );
});
for (const file of ['telemetry.html','analytics.html','sensor-logs.html']) {
  test(`${file}: Loads the current recorded-data workspace`,
    /<script\b[^>]*\bsrc=["'][^"']*\/sensor-workspace\.js(?:[?][^"']*)?["']/i.test(fs.readFileSync(path.join(publicRoot,file),'utf8')),
    'The active sensor page no longer loads the audited workspace renderer');
}

// 10. staff.js & staff.html (Registered Maintenance Staff)
const staffJsPath = path.join(__dirname, '../public/js/staff.js');
const staffJsCode = fs.readFileSync(staffJsPath, 'utf8');
test(
  'staff.js: Cleared of Carlos Rivera and mock staff list',
  !staffJsCode.includes('carlos@ecotrack.local') && !staffJsCode.includes("name: 'Carlos Rivera'"),
  'Still contains mock staff in staff.js'
);

const staffHtmlPath = path.join(__dirname, '../public/staff.html');
const staffHtmlCode = fs.readFileSync(staffHtmlPath, 'utf8');
test(
  'staff.html: Detail modal cleared of Carlos Rivera placeholder',
  !staffHtmlCode.includes('Carlos Rivera') && !staffHtmlCode.includes('carlos@ecotrack.local'),
  'Still contains Carlos Rivera in staff.html modal'
);

// 5. node-sync.js
const syncPath = path.join(__dirname, '../public/js/node-sync.js');
const syncCode = fs.readFileSync(syncPath, 'utf8');
test(
  'node-sync.js: Fake historical telemetry generation removed',
  !syncCode.includes('tempOffset = (Math.random()'),
  'Still generates fake historical telemetry'
);
test(
  'node-sync.js: Fake background cadence telemetry generation removed',
  !syncCode.includes('Math.round(baseTemp + (Math.random()'),
  'Still generates fake cadence telemetry'
);

// 6. nodes.html
const nodesPath = path.join(__dirname, '../public/nodes.html');
const nodesCode = fs.readFileSync(nodesPath, 'utf8');
test(
  'nodes.html: Hardcoded mock buildings/rooms fallbacks removed',
  !nodesCode.includes('Science & Research Wing') && !nodesCode.includes('Clean Room Alpha'),
  'Still contains mock buildings or rooms'
);
test(
  'nodes.html: Simulated Math.random ping latency removed',
  !nodesCode.includes('baseLatency = Math.floor(Math.random()'),
  'Still uses Math.random() for ping latency'
);

// 7. control.html
const controlPath = path.join(__dirname, '../public/control.html');
const controlCode = fs.readFileSync(controlPath, 'utf8');
test(
  'control.html: Hardcoded Server Room A AC in error modal removed',
  !controlCode.includes('Server Room A AC'),
  'Still contains hardcoded Server Room A AC'
);
test(
  'control.html: Simulated Math.random ping latency removed',
  !controlCode.includes('latencyMs = Math.floor(Math.random()'),
  'Still uses Math.random() for ping latency'
);

// 8. staff.js and staff.html
test(
  'staff.js: Fallback mock buildings/rooms removed',
  !staffJsCode.includes('Main Office Area'),
  'Still contains Main Office Area fallback'
);
test(
  'staff.html: Static mock room options removed',
  !staffHtmlCode.includes('Main Office Area'),
  'Still contains static Main Office Area options'
);

// 9. supabase-client.js
test(
  'supabase-client.js: Fake ID Math.random generation removed',
  !sbCode.includes("fakeId = 'telem_' + Math.random()") && !sbCode.includes("Math.random().toString(36).substring(2, 11)"),
  'Still fabricates fake IDs on database failure'
);

console.log('\n══════════════════════════════════════════════════');
console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════\n');

if (failed > 0) process.exit(1);
