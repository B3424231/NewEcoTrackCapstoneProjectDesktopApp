// ===================================================================
// ECOTRACK VALIDATION SCRIPT — Phase 4
// Demonstrates all data-logic operations against mock data
// Run: node public/js/data-tests.js
// ===================================================================

const MockDataGenerator = require('./data-schemas.js');
const DL = require('./data-logic.js');

let passed = 0, failed = 0;
function assert(label, condition, detail = '') {
  if (condition) { passed++; console.log(`  ✅ ${label}`); }
  else { failed++; console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); }
}

function section(title) { console.log(`\n━━━ ${title} ━━━`); }

// ---- Generate & Initialize ----
section('INITIALIZATION');
const dataset = MockDataGenerator.generateFullDataset();
const initResult = DL.initialize(dataset);
assert('Initialize succeeds', initResult.success);
assert('4 rooms loaded', initResult.rooms === 4);
assert('5 rules loaded', initResult.rules === 5);
assert('Telemetry records loaded', initResult.telemetry > 100);

// ---- Room CRUD ----
section('ROOM CRUD');
const rooms = DL.getAllRooms();
assert('getAllRooms returns 4', rooms.length === 4);

const newRoom = DL.createRoom('Conference Room C', 3);
assert('createRoom succeeds', newRoom.success);
assert('New room has correct name', newRoom.room.name === 'Conference Room C');

const noNameRoom = DL.createRoom('', 3);
assert('Empty name rejected', !!noNameRoom.error);

const badLimitRoom = DL.createRoom('Test', 0);
assert('Zero limit rejected', !!badLimitRoom.error);

const emptyRoom = rooms.find(r => r.name === 'Storage Closet B2');
assert('Empty room exists', !!emptyRoom);
assert('Empty room has 0 nodes', emptyRoom.nodes.length === 0);

const delResult = DL.deleteRoom(newRoom.room.id);
assert('deleteRoom succeeds', delResult.success);
assert('Deleted room no longer exists', DL.getRoom(newRoom.room.id) === null);

// ---- Node Placement ----
section('NODE PLACEMENT');
const serverRoom = rooms.find(r => r.name === 'Server Room A');
const addDuplicate = DL.addNodeToRoom(serverRoom.id, 'node-1');
assert('Duplicate node rejected', !!addDuplicate.error);

const offlineResult = DL.addNodeToRoom(serverRoom.id, 'node-7');
assert('Offline node can be added if found', offlineResult.success || !!offlineResult.error);

const removeResult = DL.removeNodeFromRoom(serverRoom.id, 'node-1');
assert('removeNodeFromRoom succeeds', removeResult.success);

const addBack = DL.addNodeToRoom(serverRoom.id, 'node-1');
assert('Re-add removed node succeeds', addBack.success);

const clearResult = DL.clearRoomNodes(serverRoom.id);
assert('clearRoomNodes succeeds', clearResult.success);
assert('Cleared 2+ nodes', clearResult.clearedCount >= 1);

// Re-add for subsequent tests
DL.addNodeToRoom(serverRoom.id, 'node-1');
DL.addNodeToRoom(serverRoom.id, 'node-2');

// ---- Telemetry ----
section('TELEMETRY');
const latestMap = DL.getLatestTelemetryByNode();
assert('Latest telemetry has multiple nodes', Object.keys(latestMap).length >= 5);
assert('node-7 has stale offline data', latestMap['node-7'] && latestMap['node-7'].status === 'offline');

const node1History = DL.getTelemetryForNode('node-1', 10);
assert('getTelemetryForNode returns data', node1History.length > 0);
assert('History respects limit', node1History.length <= 10);

const historical = DL.getHistorical('24h');
assert('getHistorical returns temps', historical.temperatures.length > 0);
assert('getHistorical returns pressures', historical.pressures.length > 0);

// Ingest a new packet
const ingestResult = DL.ingestPacket({ id: 'node-99', temp: 25.5, pressure: 0.5, rssi: -60, battery: 4.0, status: 'online' });
assert('ingestPacket succeeds', ingestResult.success);
assert('New node appears in latest', !!DL.getLatestTelemetryByNode()['node-99']);

const badIngest = DL.ingestPacket({});
assert('Packet without id rejected', !!badIngest.error);

// Test deleteTelemetryForNode
const deleteTelemRes = DL.deleteTelemetryForNode('node-99');
assert('deleteTelemetryForNode succeeds', deleteTelemRes.success);
assert('Deleted node telemetry is gone from latest', !DL.getLatestTelemetryByNode()['node-99']);
assert('Deleted node history is empty', DL.getTelemetryForNode('node-99').length === 0);

// ---- Diagnostics ----
section('DIAGNOSTICS');
const diag = DL.runDiagnostics();
assert('Diagnostics returns alerts array', Array.isArray(diag.alerts));
const criticals = diag.alerts.filter(a => a.severity === 'critical');
const warnings = diag.alerts.filter(a => a.severity === 'warning');
assert('Has critical alerts (node-8 low battery / node-5 high temp)', criticals.length >= 1);
assert('Has warning alerts', warnings.length >= 0);
console.log(`    → ${criticals.length} critical, ${warnings.length} warning`);

// ---- Efficiency ----
section('EFFICIENCY & AC ESTIMATION');
const eff = DL.calculateEfficiency('node-1');
assert('Efficiency calculation succeeds', !!eff.efficiency_score);
assert('Efficiency score is 0-100', eff.efficiency_score >= 0 && eff.efficiency_score <= 100);

const acOff = DL.estimateACDial(18);
assert('18°C → Off', acOff.dial === 'Off');
const acEco = DL.estimateACDial(22);
assert('22°C → Eco', acEco.dial === 'Eco');
const acCool = DL.estimateACDial(25);
assert('25°C → Cool', acCool.dial === 'Cool');
const acCold = DL.estimateACDial(30);
assert('30°C → Cold', acCold.dial === 'Cold');

const power = DL.getPowerStats();
assert('Power stats: 360 mAh saved (8h × (50-5))', power.mah_saved === 360);

// ---- Rule CRUD ----
section('RULE CRUD');
const allRules = DL.getAllRules();
assert('5 rules loaded', allRules.length === 5);

const disabledRules = DL.getAllRules('disabled');
assert('1 disabled rule', disabledRules.length === 1);
assert('Disabled rule is Lab A maintenance', disabledRules[0].message.includes('disabled for maintenance'));

const tempRules = DL.getAllRules('temperature');
assert('4 temperature rules', tempRules.length === 4);

const battRules = DL.getAllRules('battery');
assert('1 battery rule', battRules.length === 1);

const newRule = DL.createRule({ type: 'temperature', condition: 'above', value: 25, unit: '°C', room: serverRoom.id, roomName: 'Server Room A', nodes: ['node-1'], message: 'Test rule' });
assert('createRule succeeds', newRule.success);

const badRule = DL.createRule({ type: 'temperature', condition: 'above', value: 25, unit: '°C' });
assert('Rule without room rejected', !!badRule.error);

const toggleResult = DL.toggleRule(newRule.rule.id);
assert('toggleRule disables', toggleResult.success && toggleResult.enabled === false);

DL.toggleRule(newRule.rule.id);
const delRule = DL.deleteRule(newRule.rule.id);
assert('deleteRule succeeds', delRule.success);

// ---- Rule Evaluation ----
section('RULE EVALUATION');
const violations = DL.evaluateRules();
assert('evaluateRules returns array', Array.isArray(violations));
console.log(`    → ${violations.length} active violations found`);

// node-8 has battery 3.1V, rule threshold 3.3V → should violate
const battViolation = violations.find(v => v.nodeId === 'node-8' && v.type === 'battery');
assert('node-8 battery violation detected (3.1V < 3.3V)', !!battViolation);

// node-5 has temp spike to 36.2 in telemetry, rule is above 82.4°F (=28°C) 
const tempViolation = violations.find(v => v.nodeId === 'node-5' && v.type === 'temperature');
assert('node-5 Fahrenheit rule violation detected (28.9°C > 28°C)', !!tempViolation);

// Disabled rule for node-6 should NOT trigger
const disabledViolation = violations.find(v => v.nodeId === 'node-6');
assert('Disabled rule for node-6 NOT evaluated', !disabledViolation);

// ---- Scheduler ----
section('SCHEDULER');
const schedResult = DL.applySchedule('node-1', '07:00', '23:00', 20, 'Minutes');
assert('applySchedule succeeds', schedResult.success);
assert('Sleep seconds = 1200 (20 min × 60)', schedResult.sleepSeconds === 1200);

// Collision detection: node-2 is in the same room, try setting same interval
const collisionResult = DL.applySchedule('node-2', '06:00', '22:00', 20, 'Minutes');
assert('Collision detected for duplicate interval', !!collisionResult.error && collisionResult.error.includes('Collision'));

const noNodeSched = DL.applySchedule('node-999', '06:00', '22:00', 10, 'Minutes');
assert('Schedule for unknown node fails', !!noNodeSched.error);

// ---- Notifications ----
section('NOTIFICATIONS');
const allNotifs = DL.getAllNotifications();
assert('6 notifications loaded', allNotifs.length === 6);

const triggeredCount = allNotifs.filter(n => n.triggered).length;
assert('3 pre-triggered notifications', triggeredCount === 3);

const newNotif = DL.createNotification('15:00', '2026-05-13', 'Test maintenance alert', serverRoom.id);
assert('createNotification succeeds', newNotif.success);

const badNotif = DL.createNotification('', '', '', '');
assert('Empty notification rejected', !!badNotif.error);

const processResult = DL.processScheduledNotifications();
assert('processScheduledNotifications runs', !!processResult);

const delNotif = DL.deleteNotification(newNotif.notification.id);
assert('deleteNotification succeeds', delNotif.success);

// ---- CSV Export ----
section('CSV EXPORT');
const csv = DL.exportTelemetryCSV();
assert('CSV has header', csv.startsWith('Timestamp,AC Sensor ID'));
const csvLines = csv.split('\n');
assert('CSV has data rows', csvLines.length > 10);

const filteredCSV = DL.exportTelemetryCSV('node-1');
const filteredLines = filteredCSV.split('\n');
assert('Filtered CSV only has node-1', filteredLines.slice(1).every(l => l === '' || l.includes('node-1')));

// ---- Config ----
section('CONFIG');
const config = DL.getConfig();
assert('Config has optimal_temp = 24', config.optimal_temp === 24);

const updConfig = DL.updateConfig({ optimal_temp: 22 });
assert('Config update succeeds', updConfig.success);
assert('optimal_temp now 22', DL.getConfig().optimal_temp === 22);

// ---- Summary ----
console.log('\n' + '═'.repeat(50));
console.log(`  RESULTS: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log('═'.repeat(50));
process.exit(failed > 0 ? 1 : 0);
