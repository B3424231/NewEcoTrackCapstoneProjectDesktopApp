const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(process.env.ECOTRACK_LOGS_SOURCE || path.join(__dirname, '..', 'public/js/logs.js'), 'utf8');
const section = (start, end) => {
  const index = source.indexOf(start);
  return source.slice(index, source.indexOf(end, index));
};
const flush = () => new Promise(setImmediate);

async function testRefreshBursts() {
  let now = 0, timerId = 0, fetches = 0, renders = 0;
  const timers = new Map();
  const listeners = new Map();
  let release;
  const context = vm.createContext({ Date, currentPeriod: 'daily', selectedDateKey: '', console,
    window: { addEventListener: (name, handler) => listeners.set(name, handler) },
    getPeriodDateKey: () => 'today',
    setTimeout: (handler, delay) => { const id = ++timerId; timers.set(id, { handler, at: now + delay }); return id; },
    clearTimeout: id => timers.delete(id),
    fetchLogsFromDB: async silent => { assert.equal(silent, true); fetches++; if (release === 'hold') await new Promise(resolve => { release = resolve; }); },
    loadRoomMap: async options => assert.equal(options.syncNodes, false),
    render: options => { assert.equal(options.preserveScroll, true); renders++; }
  });
  vm.runInContext(section('let telemetryRefreshPending', '// Helper to get actual aircon fleet count'), context);
  vm.runInContext('followLatestLogPeriod = false', context); // Explicit date choices in this scenario.
  async function advance(ms) {
    now += ms;
    for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.handler(); }
    await flush();
  }
  const saved = listeners.get('ecotrack:telemetry-saved');
  for (let i = 0; i < 11; i++) { saved(); await advance(20); }
  await advance(779);
  assert.equal(fetches, 0, 'No full reload during a telemetry burst');
  await advance(1);
  assert.equal(fetches, 1);
  assert.equal(renders, 1);
  release = 'hold';
  saved(); await advance(800);
  for (let i = 0; i < 11; i++) saved();
  await advance(800);
  assert.equal(fetches, 2, 'Keep only one database request in flight');
  release(); await flush();
  assert.equal(fetches, 3, 'Follow up once when writes arrive during a reload');
  context.selectedDateKey = 'historical';
  saved(); await advance(800);
  assert.equal(fetches, 3, 'Do not refresh historical selections');
  context.selectedDateKey = '';
  release = 'hold'; saved(); await advance(800);
  context.selectedDateKey = 'historical';
  const before = renders;
  release(); await flush();
  assert.equal(renders, before, 'A pending background refresh must not render a newly selected historical period');
}

function predictionContext(fetch) {
  const elements = new Map([['energyConsumption', { textContent: 'previous', style: {}, classList: { contains: () => true } }]]);
  const charts = [];
  const context = vm.createContext({ AbortController, console, fetch, BACKEND_URL: 'http://backend',
    currentPeriod: 'daily', currentNodeFilter: '', startTimeFilter: '', endTimeFilter: '',
    currentEvaluatedKwh: null, currentEvaluatedCost: null, currentAnalyticsResult: null,
    selectedDateKey: '2026-10-04', nodeDataLogs: [], globalNodeRecords: [], controlNameMap: {},
    getPreviousPeriodDateKey: () => '2026-10-03', getDefaultDateKey: () => '2026-10-04',
    getActiveTariffRate: () => 10,
    getAirconFleetCount: () => ({ total: 11, online: 11 }),
    updateKpiCardsTrends() {}, updateTopConsumersModal() {},
    updateAnalyticsCharts: (kwh, cost) => charts.push({ kwh, cost }),
    document: { getElementById: id => {
      if (!elements.has(id)) elements.set(id, { textContent: 'previous', style: {}, classList: { contains: () => true } });
      return elements.get(id);
    } }
  });
  vm.runInContext(section('function calculateEnergyCost(', 'function saveTariffSettings('), context);
  vm.runInContext(section('function getConfirmedAcOnState(', '// Helper: Calculate previous period'), context);
  vm.runInContext(section('let currentPredictionSession', '// Convert 24-hour'), context);
  return { context, elements, charts };
}
const logs = count => Array.from({ length: count }, (_, index) => ({ nodeId: `node-${index}`, temperature: 25, pressure: 0.4, timestamp: new Date('2026-10-04T06:00:00+08:00'), acOn: true, intervalSeconds: 30 }));
const stats = { totalRecords: 11, onlineNodes: '11/11' };

async function testPredictionRaces() {
  const requests = [];
  const { context, elements, charts } = predictionContext((_, options) => new Promise(resolve => requests.push({ resolve, signal: options.signal })));
  const older = context.predictEnergyConsumption(stats, logs(1));
  assert.equal(elements.get('energyConsumption').textContent, 'previous', 'Retain the displayed value while predicting');
  const newer = context.predictEnergyConsumption(stats, logs(1));
  assert.equal(requests[0].signal.aborted, true);
  requests[1].resolve({ ok: true, json: async () => ({ kwh: 8 }) });
  await newer;
  assert.equal(context.currentEvaluatedKwh, 8, 'A successful model estimate must not enter the fallback path');
  requests[0].resolve({ ok: true, json: async () => ({ kwh: 99 }) });
  await older;
  assert.equal(context.currentEvaluatedKwh, 8, 'Older results cannot overwrite current KPIs');
  assert.equal(charts.length, 1, 'Stale sessions cannot update charts');
  const pending = context.predictEnergyConsumption(stats, logs(1));
  await context.predictEnergyConsumption({ totalRecords: 0 }, []);
  requests[2].resolve({ ok: false }); await pending;
  assert.equal(context.currentEvaluatedKwh, null, 'Empty filters supersede in-flight fallback results with unavailable data');
}

async function testPredictionLoadAndFallback() {
  let active = 0, maxActive = 0, requests = 0;
  const { context } = predictionContext(async () => {
    active++; maxActive = Math.max(active, maxActive); requests++;
    await flush(); active--;
    return { ok: true, json: async () => ({ kwh: 0 }) };
  });
  await context.predictEnergyConsumption(stats, logs(11));
  assert.equal(requests, 11);
  assert.equal(maxActive, 3, 'Limit model requests to three concurrent controllers');
  assert.equal(context.currentEvaluatedKwh, 0, 'Zero is a valid model output');
  let index = 0;
  const mixed = predictionContext(async () => ++index === 1 ? { ok: true, json: async () => ({ kwh: 8 }) } : { ok: false });
  await mixed.context.predictEnergyConsumption(stats, logs(2));
  assert.equal(mixed.context.currentEvaluatedKwh, 8, 'Failed predictions cannot invent energy estimates');
  assert.equal(mixed.context.currentAnalyticsResult.missingEstimates, 1);
  const failed = predictionContext(async () => ({ ok: false }));
  await failed.context.predictEnergyConsumption(stats, logs(1));
  assert.equal(failed.context.currentEvaluatedKwh, null, 'A failed model stays unavailable');
  let missingInputRequests = 0;
  const missing = predictionContext(async () => { missingInputRequests++; return { ok: true, json: async () => ({ kwh: 4 }) }; });
  await missing.context.predictEnergyConsumption(stats, logs(1).map(log => ({ ...log, temperature: null })));
  assert.equal(missingInputRequests, 0, 'Missing temperature cannot become a hardcoded model input');
  assert.equal(missing.context.currentEvaluatedKwh, null);
  const noRate = predictionContext(async () => ({ ok: true, json: async () => ({ kwh: 8 }) }));
  noRate.context.getActiveTariffRate = () => null;
  await noRate.context.predictEnergyConsumption(stats, logs(1));
  assert.equal(noRate.context.currentEvaluatedKwh, 8);
  assert.equal(noRate.context.currentEvaluatedCost, null, 'Unconfigured tariffs cannot show a zero electricity bill');
}

function testChartsAndDateOptions() {
  const elements = new Map(); const created = [];
  for (const id of ['energyTrendChart', 'estimatedCostChart', 'dualAxisChart']) elements.set(id, {
    getContext: () => ({ createLinearGradient: () => ({ addColorStop() {} }) })
  });
  const context = vm.createContext({ console, currentPeriod: 'daily', currentNodeFilter: '', controlNameMap: {},
    currentEvaluatedKwh: null, currentAnalyticsResult: { kwh: 8, nodes: [], previous: null },
    getAnalyticsChartSeries: () => { const values = new Array(context.currentPeriod === 'monthly' ? 4 : 9).fill(null); values[0] = context.currentAnalyticsResult.kwh; return values; }, getActiveTariffRate: () => 10, getFilteredLogs: () => [{ timestamp: new Date(2026, 9, 2, 10) }],
    getDateRangeText: () => 'Today', document: { documentElement: { classList: { contains: () => false } }, getElementById: id => elements.get(id) || null },
    Chart: class { constructor(canvas, config) { this.data = config.data; this.options = config.options; this.updates = []; created.push(this); }
      update(mode) { this.updates.push(mode); } destroy() { throw new Error('Live charts must not be destroyed'); } }
  });
  vm.runInContext(section('function calculateEnergyCost(', 'function saveTariffSettings('), context);
  vm.runInContext(section('let energyTrendChartInstance', '// ─── ENERGY CONSUMPTION PREDICTION'), context);
  context.updateAnalyticsCharts(8, 80);
  context.currentPeriod = 'monthly'; context.currentAnalyticsResult.kwh = 12; context.updateAnalyticsCharts(12, 120);
  assert.equal(created.length, 3, 'Reuse all three charts across period and data changes');
  for (const chart of created) { assert.deepEqual(chart.updates, ['none']); assert.equal(chart.data.labels.length, 4); }
  assert.equal(created[0].data.datasets[0].data.reduce((a, b) => a + b), 12);

  let writes = 0;
  const select = { dataset: {}, value: '', set innerHTML(value) { writes++; } };
  const dates = vm.createContext({ selectedDateKey: 'today', currentPeriod: 'daily', followLatestLogPeriod: false, currentPage: 1, document: { getElementById: () => select },
    getAvailableDateKeys: () => ['today', 'yesterday'], getDefaultDateKey: () => 'today', getPeriodDateLabel: key => key });
  vm.runInContext(section('function populateDateRangeOptions()', '// Initialize logs on page load'), dates);
  dates.populateDateRangeOptions(); dates.populateDateRangeOptions();
  assert.equal(writes, 1, 'Unchanged date options must preserve their DOM');
}

function testTableScroll() {
  const scroll = { scrollTop: 80 };
  let replacements = 0;
  const tbody = { closest: () => scroll, replaceChildren: fragment => {
    replacements++; assert.equal(fragment.rows.length, 2);
  }, set innerHTML(value) { throw new Error('Do not clear live table rows before constructing replacements'); } };
  const filtered = logs(2).map(log => ({ ...log, timestamp: new Date(), status: 'online' }));
  const context = vm.createContext({ console: { log() {} }, currentPeriod: 'daily', currentPage: 1, PAGE_SIZE: 50,
    nodeDataLogs: filtered, controlNameMap: {}, locationMap: {}, globalAirconMap: {},
    populateDateRangeOptions() {}, getFilteredLogs: () => filtered,
    calculateStats: () => ({ totalRecords: 2, avgTemp: 25, onlineNodes: '2/2' }),
    updateActiveFilterBadge() {}, predictEnergyConsumption() {}, getConfirmedAcOnState: () => true, getDisplayAcState: () => 'ON', getBatteryPercentage: () => 90, getSignalIcon: () => '',
    document: { getElementById: id => id === 'logsTableBody' ? tbody : {},
      createDocumentFragment: () => ({ rows: [], appendChild(row) { this.rows.push(row); } }), createElement: () => ({}) }
  });
  vm.runInContext(section('function render({', '// ── REDESIGNED EXECUTIVE EXCEL'), context);
  context.render({ preserveScroll: true });
  assert.equal(scroll.scrollTop, 80, 'Background refresh preserves table position');
  context.render();
  assert.equal(scroll.scrollTop, 0, 'User filter changes still start at the top');
  assert.equal(replacements, 2);
}

async function main() {
  await testRefreshBursts(); await testPredictionRaces(); await testPredictionLoadAndFallback(); testChartsAndDateOptions(); testTableScroll();
  console.log('Logs stability passed: burst debounce, single reload, historical filters, stale predictions, bounded ML requests, unavailable failed estimates, missing inputs, valid zero estimates, chart reuse, and stable date options.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
