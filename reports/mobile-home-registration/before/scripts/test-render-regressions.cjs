const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function loadComponent(file) {
  let hooks = [];
  const react = {
    useMemo(callback) { hooks.push('memo'); return callback(); },
    createElement(type, props, ...children) { return { type, props: { ...props, children } }; },
  };
  const icons = new Proxy({ getColoredSvgUri: (svg, color) => `${svg}:${color}` }, { get: (target, name) => target[name] || String(name) });
  const settings = { effectiveTheme: 'light', colors: {}, formatTemperatureDisplay: value => `${value}°C` };
  const mocks = { react, 'react-native': { View: 'View', Pressable: 'Pressable', StyleSheet: { create: value => value }, Platform: { OS: 'android', select: value => value.android || value.default } },
    'expo-image': { Image: 'Image' }, 'expo-symbols': { SymbolView: 'SymbolView' }, 'expo-router': { router: { push() {} } },
    '@/constants/theme': { Spacing: {} }, '@/constants/custom-icons': icons,
    '@/context/settings-context': { useSettings() { hooks.push('settings'); return settings; } } };
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText,
    { module, exports: module.exports, require: name => mocks[name] || {} });
  return { exports: module.exports, render(component, props) { hooks = []; const result = component(props); return { result, hooks: [...hooks] }; } };
}

function textValues(element) {
  if (element == null) return [];
  if (typeof element === 'string' || typeof element === 'number') return [element];
  if (Array.isArray(element)) return element.flatMap(textValues);
  return textValues(element.props?.children);
}

test('controller card retains hook order when data disappears and preserves the legacy sensor prop', () => {
  const h = loadComponent('src/components/sensor-card.tsx'), card = h.exports.AcControllerCard;
  const sensor = { id: 'synthetic', name: 'Legacy sensor', ventTemp: '24°C', status: 'optimal', battery: '90' };
  const empty = h.render(card, { onPress() {} });
  const loaded = h.render(card, { sensor, onPress() {} });
  const missingAgain = h.render(card, { onPress() {} });
  assert.equal(empty.result, null); assert.equal(missingAgain.result, null);
  assert.deepEqual(empty.hooks, loaded.hooks); assert.deepEqual(loaded.hooks, missingAgain.hooks);
  assert.ok(textValues(loaded.result).includes('Legacy sensor')); assert.ok(textValues(loaded.result).includes('24°C'));
  assert.equal(h.exports.SensorCard, card);
  const preferred = h.render(card, { controller: { ...sensor, name: 'Controller' }, sensor, onPress() {} });
  assert.ok(textValues(preferred.result).includes('Controller')); assert.ok(!textValues(preferred.result).includes('Legacy sensor'));
});

test('icon preserves hook order across unknown names without changing known icon size or color', () => {
  const h = loadComponent('src/components/app-icon.tsx'), icon = h.exports.AppIcon;
  const unknown = h.render(icon, { name: 'unmapped' });
  const known = h.render(icon, { name: 'bolt', size: 24, color: '#10b981' });
  const unknownAgain = h.render(icon, { name: 'unmapped' });
  assert.equal(unknown.result, null); assert.equal(unknownAgain.result, null);
  assert.deepEqual(unknown.hooks, known.hooks); assert.deepEqual(known.hooks, unknownAgain.hooks);
  const image = known.result.props.children[0];
  assert.equal(image.props.source.uri, 'ICON_BOLT:#10b981');
  assert.equal(image.props.style.width, 24); assert.equal(image.props.style.height, 24);
});

test('notification rendering uses a stable clock snapshot and its timer updates snooze expiry and relative time', () => {
  const source = fs.readFileSync('src/app/notification.tsx', 'utf8');
  const parsed = ts.createSourceFile('notification.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = new Set(['currentSnoozeItem', 'isTargetSnoozed', 'activeSnoozeMinutes', 'currentSnoozeFormatted', 'remainingMins', 'formatTime']);
  let clock, effect, label; const calculations = [];
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'getSnoozeTimeLabel') label = node.getText(parsed);
    if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) && node.name.elements[0]?.name?.getText(parsed) === 'now') clock = 'const ' + node.getText(parsed) + ';';
    if (ts.isVariableDeclaration(node) && names.has(node.name.getText(parsed))) calculations.push('const ' + node.getText(parsed) + ';');
    if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(parsed) === 'useEffect' && node.getText(parsed).includes('setNow(Date.now())')) effect = node.getText(parsed);
    ts.forEachChild(node, visit);
  }
  visit(parsed); assert.ok(clock && effect && label); assert.equal(calculations.length, names.size);
  let actualTime = Date.parse('2026-10-03T00:00:00Z'), state, timer, cleanup, cleared = false, phase;
  class ClockDate extends Date { static now() { assert.notEqual(phase, 'render', 'clock read during render'); return actualTime; } }
  const module = { exports: {} };
  const code = label + '\nexports.render = () => {' + clock + effect + calculations.join('\n') + '\nreturn { active: isTargetSnoozed, remaining: remainingMins, relative: formatTime(notifications[0].createdAt), label: getSnoozeTimeLabel(15, now) }; };';
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports: module.exports, Date: ClockDate,
      useState(initializer) { if (state === undefined) { phase = 'initializer'; state = initializer(); phase = 'render'; } return [state, value => { state = value; }]; },
      useMemo: callback => callback(), useEffect(callback) { if (!cleanup) { phase = 'effect'; cleanup = callback(); phase = 'render'; } },
      setInterval(callback, delay) { assert.equal(delay, 60000); timer = callback; return 1; }, clearInterval() { cleared = true; },
      snoozeTargetId: 'note', snoozeDurations: {}, notifications: [{ id: 'note', isSnoozed: true, snoozeUntil: new Date(actualTime + 30000).toISOString(), createdAt: new Date(actualTime - 30000).toISOString() }] });
  phase = 'render'; const first = module.exports.render(); assert.equal(first.active, true); assert.equal(first.relative, 'Just now');
  actualTime += 60000; assert.deepEqual(module.exports.render(), first);
  phase = 'effect'; timer(); phase = 'render'; const updated = module.exports.render();
  assert.equal(updated.active, false); assert.equal(updated.remaining, null); assert.equal(updated.relative, '1m');
  cleanup(); assert.equal(cleared, true);
});
