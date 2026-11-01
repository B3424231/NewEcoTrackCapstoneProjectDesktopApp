'use strict';
// Isolated storage and authenticated-read contract fixtures. No cloud or hardware access.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/js/aircon-system.js'), 'utf8');
const code = source.slice(source.indexOf('  class CentralLogService {'), source.indexOf('  // ===== DATABASE SYNC ENGINE'));
function environment(values = new Map(), timers = {}) {
  const events = [];
  const context = { localStorage: { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) },
    AirconEvents: { emit: (...args) => events.push(args) }, console, setTimeout, clearTimeout, ...timers };
  vm.runInNewContext(code + '\nglobalThis.audit = CentralLogService;', context);
  return { audit: context.audit, values, events };
}
const device = { device_id: 'AC-ISOLATED', node_id: 'esp-isolated', controller_node_id: 'node-isolated', name: 'Isolated AC' };
function queue(audit, id = 'command-one') {
  return audit.recordCommand({ id, node_id: 'node-isolated', expires_at: '2030-01-01T00:00:00Z' }, device, 'ac-isolated', 'POWER', { power: 'on' });
}
function receipt(id = 'command-one', changes = {}) {
  return { id, node_id: 'node-isolated', kind: 'ac_intent', payload: { aircon_id: 'ac-isolated' }, status: 'completed',
    acknowledged_at: '2026-10-30T13:00:00Z', result: { command_id: id, success: true, delivery_status: 'transmitted' }, ...changes };
}
function client(rows, error = null) {
  return { from(table) { assert.equal(table, 'ecotrack_device_commands'); return {
    select(columns) { assert.ok(columns.includes('node_id') && columns.includes('result')); return this; },
    async in(key, ids) { assert.equal(key, 'id'); return { data: rows.filter(row => ids.includes(row.id)), error }; }
  }; } };
}

test('one command progresses queued to claimed to verified transmission and survives reload', () => {
  const { audit, values } = environment();
  queue(audit); queue(audit);
  assert.equal(audit.getCommandLogs(500).length, 1);
  assert.equal(audit.getCommandStats().pending, 1);
  audit.reconcileCommand(receipt('command-one', { status: 'claimed', result: null }));
  assert.equal(audit.getCommandLogs()[0].delivery_status, 'claimed');
  assert.equal(audit.getCommandStats().transmitted, 0);
  audit.reconcileCommand(receipt());
  assert.equal(audit.getCommandLogs()[0].delivery_status, 'transmitted');
  assert.equal(audit.getCommandStats().transmitted, 1);
  assert.match(audit.getCommandLogs()[0].details, /AC response remains unconfirmed/);
  assert.equal(environment(values).audit.getCommandStats().transmitted, 1);
});

test('wrong command, controller, AC or command kind cannot update an audit row', () => {
  for (const change of [{ id: 'foreign' }, { node_id: 'foreign' }, { kind: 'ping' }, { payload: { aircon_id: 'foreign' } }]) {
    const { audit } = environment(); queue(audit);
    assert.equal(audit.reconcileCommand(receipt('command-one', change)), false);
    assert.equal(audit.getCommandStats().pending, 1);
    assert.equal(audit.getCommandStats().transmitted, 0);
  }
});

test('malformed or mismatched completion evidence never counts as transmission', () => {
  for (const result of [null, {}, { command_id: 'foreign', success: true, delivery_status: 'transmitted' },
    { command_id: 'command-one', success: 'true', delivery_status: 'transmitted' },
    { command_id: 'command-one', success: true, delivery_status: 'queued' }]) {
    const { audit } = environment(); queue(audit); audit.reconcileCommand(receipt('command-one', { result }));
    assert.equal(audit.getCommandStats().transmitted, 0);
    assert.equal(audit.getCommandStats().unconfirmed, 1);
  }
});

test('failed, expired and superseded requests leave pending without a success claim', () => {
  for (const status of ['failed', 'expired', 'superseded']) {
    const { audit } = environment(); queue(audit); audit.reconcileCommand(receipt('command-one', { status, result: { error: 'Isolated negative path' } }));
    assert.equal(audit.getCommandLogs()[0].delivery_status, status);
    assert.equal(audit.getCommandStats().failed, 1); assert.equal(audit.getCommandStats().pending, 0);
  }
});

test('stale and duplicate receipts cannot roll back a terminal outcome', () => {
  const { audit } = environment(); queue(audit); audit.reconcileCommand(receipt());
  assert.equal(audit.reconcileCommand(receipt('command-one', { status: 'queued', result: null })), false);
  assert.equal(audit.reconcileCommand(receipt()), false);
  assert.equal(audit.getCommandLogs().length, 1); assert.equal(audit.getCommandStats().transmitted, 1);
});

test('a historical receipt updates its own row while a newer request remains pending', () => {
  const { audit } = environment(); queue(audit); queue(audit, 'command-two'); audit.reconcileCommand(receipt());
  assert.equal(audit.getCommandLogs().find(row => row.command_id === 'command-two').delivery_status, 'queued');
  assert.equal(audit.getCommandStats().pending, 1); assert.equal(audit.getCommandStats().transmitted, 1);
});

test('configuration successes do not inflate IR totals and legacy successes remain unconfirmed', () => {
  const { audit } = environment();
  audit.log({ device_id: 'AC', module: 'CONFIG', event: 'AIRCON_UPDATED', result: 'SUCCESS' });
  audit.log({ device_id: 'AC', module: 'IR', event: 'REQUESTING_COMMAND', result: 'PENDING' });
  audit.log({ device_id: 'AC', module: 'CONTROL', event: 'COMMAND_SUCCESS', result: 'SUCCESS' });
  assert.equal(audit.getCommandStats().total, 1); assert.equal(audit.getCommandStats().transmitted, 0);
  assert.equal(audit.getCommandLogs()[0].result, 'UNKNOWN');
  audit.clearCommandLogs(); assert.equal(audit.getCommandLogs().length, 0);
  assert.equal(audit.getLogs().length, 2, 'Clearing command audit preserves other local logs');
});

test('shared sync reconciles authenticated receipt rows and tolerates read failure', async () => {
  const { audit } = environment(); queue(audit);
  await audit.reconcileCommands(client([], { message: 'Unavailable' }));
  assert.equal(audit.getCommandStats().pending, 1);
  await audit.reconcileCommands(client([receipt()])); assert.equal(audit.getCommandStats().transmitted, 1);
});

test('clearing an audit during an in-flight receipt read does not recreate it', async () => {
  const { audit } = environment(); queue(audit); let release;
  const remote = { from: () => ({ select() { return this; }, in: () => new Promise(resolve => { release = resolve; }) }) };
  const pending = audit.reconcileCommands(remote); audit.clearCommandLogs(); release({ data: [receipt()], error: null }); await pending;
  assert.equal(audit.getCommandLogs().length, 0);
});

test('an account change during a read discards the result', async () => {
  const { audit } = environment(); queue(audit); let current = true, release;
  const remote = { from: () => ({ select() { return this; }, in: () => new Promise(resolve => { release = resolve; }) }) };
  const pending = audit.reconcileCommands(remote, [], () => current); current = false; release({ data: [receipt()], error: null }); await pending;
  assert.equal(audit.getCommandStats().pending, 1); assert.equal(audit.getCommandStats().transmitted, 0);
});

test('a stalled receipt read times out and releases synchronization for retry', async () => {
  let deadlines = 0;
  const { audit } = environment(new Map(), { setTimeout: callback => {
    if (deadlines++ === 0) { queueMicrotask(callback); return undefined; }
    return setTimeout(callback, 10000);
  }, clearTimeout });
  queue(audit);
  const stalled = { from: () => ({ select() { return this; }, in: () => new Promise(() => {}) }) };
  await audit.reconcileCommands(stalled);
  assert.equal(audit._receiptRead, false); assert.equal(audit.getCommandStats().pending, 1);
  await audit.reconcileCommands(client([receipt()]));
  assert.equal(audit.getCommandStats().transmitted, 1);
});

test('a pruned detailed receipt uses a matching summary without claiming verified transmission', async () => {
  const { audit } = environment(); queue(audit);
  await audit.reconcileCommands(client([]), [{ id: 'ac-isolated', node_id: 'node-isolated', command_id: 'command-one', command_status: 'transmitted' }]);
  assert.equal(audit.getCommandStats().transmitted, 0); assert.equal(audit.getCommandStats().unconfirmed, 1);
  assert.match(audit.getCommandLogs()[0].details, /Cloud reports IR transmitted; detailed receipt unavailable/);
});

test('a summary for another command or binding cannot complete the tracked request', async () => {
  for (const change of [{ command_id: 'foreign' }, { node_id: 'foreign' }, { id: 'foreign' }]) {
    const { audit } = environment(); queue(audit);
    await audit.reconcileCommands(client([]), [{ id: 'ac-isolated', node_id: 'node-isolated', command_id: 'command-one', command_status: 'transmitted', ...change }]);
    assert.equal(audit.getCommandStats().pending, 1); assert.equal(audit.getCommandStats().transmitted, 0);
  }
});
