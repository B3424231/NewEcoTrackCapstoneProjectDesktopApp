// Initialize metadata (Supabase) and local telemetry clients.
const sb = window.supabaseClient || window.sb;
const pb = window.pb || (typeof PocketBase === 'function' ? new PocketBase() : null);

// Real telemetry logs from the local backend.
let nodeDataLogs = [];
let currentPeriod = 'daily';
let currentNodeFilter = '';
let selectedDateKey = '';
let startTimeFilter = '';
let endTimeFilter = '';
let roomMap = {}; // Store node to room mapping
let controlNameMap = {}; // Store node to control name mapping
let locationMap = {}; // Store node to location details
let globalAirconMap = {}; // Store node to aircon type mapping
let globalInstallDateMap = {}; // Store node to installation date mapping
let selectedAlgorithm = 'xgb'; // Default: XGBoost (Exclusive Model)
let currentEvaluatedKwh = null;
let currentEvaluatedCost = null;
let currentAnalyticsResult = null;
let currentActiveConsumerTab = 'buildings';
let globalNodeRecords = []; // Store raw nodes from Supabase / aircon system
let telemetryRefreshPending = false;
let telemetryRefreshRunning = false;
let telemetryRefreshTimer = null;
let telemetryMetadataPending = false;
let telemetryResetPending = false;
let lastTelemetryResetAt = null;
let lastTelemetryTotalItems = null;
let followLatestLogPeriod = true;
let lastTelemetryRevision = null;
let telemetryPollRunning = false;

function isCurrentLogPeriod() {
  return followLatestLogPeriod || !selectedDateKey || selectedDateKey === getPeriodDateKey(new Date(), currentPeriod);
}

function onTelemetrySavedDebounced(force = false) {
  if (force === true) telemetryResetPending = true;
  if (!isCurrentLogPeriod() && !telemetryResetPending) return;
  clearTimeout(telemetryRefreshTimer);
  telemetryRefreshTimer = setTimeout(() => {
    telemetryRefreshTimer = null;
    refreshLogsAfterTelemetrySaved(telemetryResetPending);
  }, 800);
}

// Coalesce saves from several controllers and preserve historical date filters.
async function refreshLogsAfterTelemetrySaved(force = false) {
  if (force) telemetryResetPending = true;
  if (!isCurrentLogPeriod() && !telemetryResetPending) return;
  telemetryRefreshPending = true;
  if (telemetryRefreshRunning) return;
  telemetryRefreshRunning = true;
  try {
    while (telemetryRefreshPending) {
      telemetryRefreshPending = false;
      const resetRefresh = telemetryResetPending;
      telemetryResetPending = false;
      if (telemetryMetadataPending) {
        telemetryMetadataPending = false;
        await loadRoomMap();
      }
      await fetchLogsFromDB(true);
      if (isCurrentLogPeriod() || resetRefresh) render({ preserveScroll: true });
    }
  } catch (error) {
    console.warn('[Daily Logs] Telemetry refresh failed:', error.message);
  } finally {
    telemetryRefreshRunning = false;
  }
}
window.addEventListener('ecotrack:telemetry-saved', onTelemetrySavedDebounced);
window.addEventListener('focus', onTelemetrySavedDebounced);

function getTelemetryRevision(data) {
  const latest = data.items?.[0];
  return JSON.stringify([data.totalItems, latest?.id, latest?.created, latest?.updated, data.reset_at]);
}

async function pollLatestTelemetry() {
  if (telemetryPollRunning) return;
  telemetryPollRunning = true;
  try {
    const backendUrl = window.ECOTRACK_CONFIG?.backendUrl || 'http://localhost:5000';
    const response = await fetch(`${backendUrl}/api/telemetry?perPage=1&sort=-created`, { cache: 'no-store' });
    if (!response.ok) return;
    const data = await response.json();
    if (getTelemetryRevision(data) !== lastTelemetryRevision) {
      const resetChanged = data.reset_at !== undefined && (data.reset_at || null) !== lastTelemetryResetAt;
      onTelemetrySavedDebounced(resetChanged || data.totalItems === 0);
    }
  } catch (_) {} finally {
    telemetryPollRunning = false;
  }
}

// Helper to get actual aircon fleet count synchronized with Dashboard Controller & Supabase
function getAirconFleetCount() {
  try {
    if (window.EcoTrackAirconSystem?.AirconProfileManager?.getAll) {
      const list = window.EcoTrackAirconSystem.AirconProfileManager.getAll();
      if (Array.isArray(list)) {
        const online = list.filter(a => String(a.status || '').toLowerCase() === 'online').length;
        return { total: list.length, online };
      }
    }
  } catch (_) {}

  try {
    const raw = localStorage.getItem('ecoTrack_aircons');
    if (raw) {
      const list = JSON.parse(raw);
      if (Array.isArray(list)) {
        const online = list.filter(a => String(a.status || '').toLowerCase() === 'online').length;
        return { total: list.length, online };
      }
    }
  } catch (_) {}

  try {
    if (Array.isArray(globalNodeRecords) && globalNodeRecords.length > 0) {
      const online = globalNodeRecords.filter(n => String(n.status || '').toLowerCase() === 'online').length;
      return { total: globalNodeRecords.length, online };
    }
  } catch (_) {}

  return { total: 0, online: 0 };
}

// Pagination state
let currentPage = 1;
const PAGE_SIZE = 20;

function getPeriodDateKey(date, period = currentPeriod) {
  const dObj = (date instanceof Date) ? date : new Date(date);
  if (isNaN(dObj.getTime())) return '';
  const year = dObj.getFullYear();
  const month = String(dObj.getMonth() + 1).padStart(2, '0');
  const day = String(dObj.getDate()).padStart(2, '0');

  if (period === 'monthly') {
    return `${year}-${month}`;
  }

  if (period === 'yearly') {
    return `${year}`;
  }

  if (period === 'weekly') {
    const d = new Date(dObj);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
    const monday = new Date(d.setDate(diff));
    const mYear = monday.getFullYear();
    const mMonth = String(monday.getMonth() + 1).padStart(2, '0');
    const mDay = String(monday.getDate()).padStart(2, '0');
    return `${mYear}-${mMonth}-${mDay}`;
  }

  return `${year}-${month}-${day}`;
}

function getPeriodDateLabel(key, period = currentPeriod) {
  if (!key) return 'Select Date';

  if (period === 'yearly') {
    return key;
  }

  if (period === 'weekly') {
    const [year, month, day] = key.split('-').map(Number);
    const monday = new Date(year, month - 1, day);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const monStr = monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const sunStr = sunday.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return `${monStr} - ${sunStr}`;
  }

  if (period === 'monthly') {
    const [year, month] = key.split('-').map(Number);
    return new Date(year, month - 1, 1).toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric'
    });
  }

  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
}

function getDefaultDateKey() {
  const todayKey = getPeriodDateKey(new Date(), currentPeriod);
  if (!nodeDataLogs || nodeDataLogs.length === 0) {
    return todayKey;
  }
  const actualKeys = new Set(nodeDataLogs.map(log => getPeriodDateKey(log.timestamp, currentPeriod)).filter(Boolean));
  // If today actually has telemetry data, default to today
  if (actualKeys.has(todayKey)) {
    return todayKey;
  }
  // Otherwise default to the most recent date with real telemetry data
  const sortedActual = Array.from(actualKeys).sort((left, right) => right.localeCompare(left));
  return sortedActual[0] || todayKey;
}

function getAvailableDateKeys() {
  const todayKey = getPeriodDateKey(new Date(), currentPeriod);
  const keys = new Set(nodeDataLogs.map(log => getPeriodDateKey(log.timestamp, currentPeriod)).filter(Boolean));
  if (todayKey) keys.add(todayKey);
  return Array.from(keys).sort((left, right) => right.localeCompare(left));
}

function populateDateRangeOptions() {
  const dateSelect = document.getElementById('dateRangeSelect');
  if (!dateSelect) return;

  const availableKeys = getAvailableDateKeys();
  const defaultKey = getDefaultDateKey();

  if (followLatestLogPeriod || !selectedDateKey || !availableKeys.includes(selectedDateKey)) {
    if (selectedDateKey !== defaultKey) currentPage = 1;
    selectedDateKey = defaultKey;
  }

  // Bound the visible list regardless of how much historical telemetry is retained.
  const visibleKeys = availableKeys.slice(0, 7);
  if (selectedDateKey && !visibleKeys.includes(selectedDateKey)) {
    if (visibleKeys.length === 7) visibleKeys.pop();
    visibleKeys.push(selectedDateKey);
  }
  const optionsHtml = visibleKeys.map(key => {
    const label = getPeriodDateLabel(key, currentPeriod);
    return `<option value="${key}">${label}</option>`;
  }).join('') + (availableKeys.length > visibleKeys.length ? '<option value="__older__">Choose older date…</option>' : '');
  if (dateSelect.dataset.optionsHtml !== optionsHtml) {
    dateSelect.innerHTML = optionsHtml;
    dateSelect.dataset.optionsHtml = optionsHtml;
  }

  dateSelect.value = selectedDateKey;
  const historyDatePicker = document.getElementById('historyDatePicker');
  if (historyDatePicker && historyDatePicker.style && selectedDateKey && dateSelect.value === selectedDateKey) {
    historyDatePicker.style.display = 'none';
  }
}

// Initialize logs on page load
document.addEventListener('DOMContentLoaded', async () => {
  console.log('Logs page loaded');
  setupEventListeners();
  setupTariffModal();
  setupTopConsumersModal();
  updateTariffUI();

  // 1. Instant local database load (renders in ~400ms!)
  await Promise.all([fetchLogsFromDB(), loadRoomMap().catch(() => {})]);
  console.log('Loaded', nodeDataLogs.length, 'telemetry log records');
  if (!selectedDateKey) {
    selectedDateKey = getDefaultDateKey();
  }
  populateDateRangeOptions();
  render();

  // 2. Enhance metadata asynchronously in background without blocking initial render
  loadRoomMap().then(() => {
    render({ preserveScroll: true });
  }).catch(e => console.warn('[EcoTrack Logs] Background room map load:', e));

  // Poll the newest row as well as its count; replacement rows can keep the same count.
  setInterval(pollLatestTelemetry, 4000);

  // Real-time event subscription for immediate updates when packets arrive in Supabase
  const sbClient = window.supabaseClient || window.sb;
  if (sbClient) {
    try {
      sbClient.channel('telemetry-logs-realtime')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'telemetry' }, onTelemetrySavedDebounced)
        .subscribe();
    } catch (_) {}
    try {
      sbClient.channel('nodes-logs-schedules')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'nodes' }, () => {
          telemetryMetadataPending = true;
          onTelemetrySavedDebounced();
        }).subscribe();
    } catch (_) {}
  }
});

// Load room mapping directly from PocketBase / Supabase (non-blocking)
async function loadRoomMap() {
  const nodeFilter = document.getElementById('nodeFilter');
  if (nodeFilter && nodeFilter.options.length <= 1) {
    nodeFilter.innerHTML = '<option value="">All Controls</option>';
  }
  
  try {
    let roomRecords = [];
    let floorRecords = [];
    let buildingRecords = [];
    let nodeRecords = [];

    if (window.electron && typeof window.electron.invoke === 'function') {
      try {
        const res = await window.electron.invoke('scheduler-fetch-data');
        if (res && res.success) {
          roomRecords = res.rooms || [];
          floorRecords = res.floors || [];
          buildingRecords = res.buildings || [];
          nodeRecords = res.nodes || [];
          globalNodeRecords = nodeRecords;
        }
      } catch (_) {}
    }

    if (!nodeRecords.length && sb) {
      const [rRes, fRes, bRes, nRes] = await Promise.all([
        sb.from('rooms').select('*').order('created', { ascending: false }),
        sb.from('floors').select('*').order('created', { ascending: false }),
        sb.from('buildings').select('*').order('created', { ascending: false }),
        sb.from('nodes').select('*')
      ]);
      roomRecords = rRes.data || [];
      floorRecords = fRes.data || [];
      buildingRecords = bRes.data || [];
      nodeRecords = nRes.data || [];
      globalNodeRecords = nodeRecords;
    }

    const buildingMapById = {};
    buildingRecords.forEach(b => { buildingMapById[b.id] = b.name; });
    
    const floorMapById = {};
    floorRecords.forEach(f => { floorMapById[f.id] = { name: f.name, building_id: f.building_id }; });

    const roomDetailsById = {};
    roomRecords.forEach(room => {
      const fInfo = floorMapById[room.floor_id] || { name: 'Unknown', building_id: null };
      const bName = buildingMapById[fInfo.building_id] || 'Unknown';
      roomDetailsById[room.id] = {
        roomName: room.name,
        floorName: fInfo.name,
        buildingName: bName
      };
    });

    nodeRecords.forEach(node => {
      const nodeIdStr = node.name || node.id;
      controlNameMap[node.id] = nodeIdStr; // e.g. "AC-SRV-01"
      if (node.name) controlNameMap[node.name] = node.name;

      const airconType = node.aircon_type || 'Unknown';
      globalAirconMap[node.id] = airconType;
      globalAirconMap[nodeIdStr] = airconType;

      const installDate = node.created ? new Date(node.created) : new Date();
      const formattedDate = `${installDate.getFullYear()}-${String(installDate.getMonth() + 1).padStart(2, '0')}-${String(installDate.getDate()).padStart(2, '0')} ${String(installDate.getHours()).padStart(2, '0')}:${String(installDate.getMinutes()).padStart(2, '0')}:${String(installDate.getSeconds()).padStart(2, '0')}`;
      globalInstallDateMap[node.id] = formattedDate;
      globalInstallDateMap[nodeIdStr] = formattedDate;

      if (node.room_id && roomDetailsById[node.room_id]) {
        const details = roomDetailsById[node.room_id];
        locationMap[node.id] = details;
        if (node.name) locationMap[node.name] = details;
        roomMap[node.id] = node.room_id;
        if (node.name) roomMap[node.name] = node.room_id;
      }

      const filterVal = node.name || node.id;
      if (nodeFilter && !nodeFilter.querySelector(`option[value="${CSS.escape(filterVal)}"]`)) {
        const option = document.createElement('option');
        option.value = filterVal;
        option.textContent = filterVal;
        nodeFilter.appendChild(option);
      }
    });
  } catch(e) {
    console.error('PocketBase load error (rooms/nodes):', e);
  }
}

// Get room name for a node
function getRoomForNode(nodeId) {
  const loc = locationMap[nodeId];
  if (loc && loc.roomName && loc.roomName !== 'Unassigned') return loc.roomName;
  return roomMap[nodeId] || 'Unassigned';
}

// Calculate battery percentage matching Telemetry (4.2V = 100%)
function getBatteryPercentage(voltage) {
  const v = parseFloat(voltage);
  if (isNaN(v)) return 0;
  if (v > 10) return Math.min(100, Math.max(0, Math.round(v)));
  return Math.min(100, Math.max(0, Math.round((v / 4.2) * 100)));
}

// Convert RSSI to signal bars (1-4) matching Telemetry getSignalBars
function getSignalBars(rssi) {
  const r = parseFloat(rssi);
  if (isNaN(r)) return 1;
  // If raw dBm (negative values, standard RSSI)
  if (r < 0) {
    if (r > -60) return 4;
    if (r > -70) return 3;
    if (r > -80) return 2;
    return 1;
  }
  // If already percentage
  if (r >= 75) return 4;
  if (r >= 50) return 3;
  if (r >= 25) return 2;
  return 1;
}

// Generate signal icon matching Telemetry
function getSignalIcon(rssi) {
  const filledBars = getSignalBars(rssi);
  const r = parseFloat(rssi);
  const barColor = filledBars >= 3 ? '#10b981' : (filledBars === 2 ? '#fbbf24' : '#fb7185');
  const emptyColor = '#d1d5db';
  
  return `
    <span class="inline-flex items-center gap-1.5" title="${!isNaN(r) && r < 0 ? r + ' dBm' : ''}">
      <svg viewBox="0 0 24 24" width="22" height="22" style="display: inline-block; vertical-align: middle;">
        <!-- Bar 1 (smallest) -->
        <rect x="2" y="18" width="2.8" height="4" rx="0.5" fill="${filledBars >= 1 ? barColor : emptyColor}" opacity="${filledBars >= 1 ? '1' : '0.4'}"/>
        <!-- Bar 2 -->
        <rect x="6.8" y="14" width="2.8" height="8" rx="0.5" fill="${filledBars >= 2 ? barColor : emptyColor}" opacity="${filledBars >= 2 ? '1' : '0.4'}"/>
        <!-- Bar 3 -->
        <rect x="11.6" y="10" width="2.8" height="12" rx="0.5" fill="${filledBars >= 3 ? barColor : emptyColor}" opacity="${filledBars >= 3 ? '1' : '0.4'}"/>
        <!-- Bar 4 (tallest) -->
        <rect x="16.4" y="6" width="2.8" height="16" rx="0.5" fill="${filledBars >= 4 ? barColor : emptyColor}" opacity="${filledBars >= 4 ? '1' : '0.4'}"/>
      </svg>
    </span>
  `;
}

// Setup event listeners
async function clearAllTelemetryHistory() {
  const client = window.supabaseClient || window.sb;
  if (!client || typeof client.from !== 'function') throw new Error('Connect to Supabase before clearing history.');
  const backendUrl = window.ECOTRACK_CONFIG?.backendUrl || 'http://localhost:5000';
  let response;
  try { response = await fetch(backendUrl + '/api/telemetry', {method:'DELETE'}); }
  catch (_) { throw new Error('Could not reach the telemetry service. Check its connection and try again.'); }
  if (!response.ok) throw new Error('The telemetry service could not confirm deletion (HTTP ' + response.status + ').');
  const result = await response.json();
  if (result?.success !== true) throw new Error(result?.error || 'The telemetry service could not confirm deletion.');
  try {
    const cloud = await client.from('telemetry').delete().neq('id','___none___');
    if (cloud.error) throw cloud.error;
  } catch (error) {
    throw new Error('Local history was cleared, but cloud history could not be cleared. ' + (error?.message || 'Check the connection and retry.'));
  }
  window.EcoTrackAirconSystem?.CentralLogService?.clearLogs?.();
  nodeDataLogs = []; lastTelemetryTotalItems = 0; currentPage = 1;
  render();
  window.EcoDataBus?.invalidate('telemetry');
  window.dispatchEvent(new CustomEvent('ecotrack:telemetry-saved', {detail:{cleared:true}}));
}

function setupEventListeners() {
  // Centralized period switcher that syncs throughout entire page
  window.setPeriod = function(period) {
    if (!period) return;
    currentPeriod = period;
    followLatestLogPeriod = true;
    if (historyDatePicker) historyDatePicker.style.display = 'none';

    // Sync Header Period Buttons
    document.querySelectorAll('.header-period-btn').forEach(btn => {
      const isAct = btn.dataset.period === period;
      btn.classList.toggle('active', isAct);
      if (isAct) {
        btn.style.setProperty('background-color', '#10b981', 'important');
        btn.style.setProperty('color', '#ffffff', 'important');
        btn.style.setProperty('border', '1px solid #10b981', 'important');
        const svg = btn.querySelector('svg');
        if (svg) svg.style.setProperty('stroke', '#ffffff', 'important');
      } else {
        btn.style.removeProperty('background-color');
        btn.style.removeProperty('color');
        btn.style.removeProperty('border');
        const svg = btn.querySelector('svg');
        if (svg) svg.style.removeProperty('stroke');
      }
    });

    // Sync Table Log-Tabs if present
    document.querySelectorAll('.log-tab').forEach(b => {
      const isAct = b.dataset.period === period;
      b.classList.toggle('active', isAct);
      if (isAct) {
        b.classList.add('bg-[#10b981]', 'text-white', 'border-[#10b981]');
        b.classList.remove('bg-white', 'dark:bg-slate-900', 'text-gray-700', 'dark:text-gray-200');
        b.style.setProperty('background-color', '#10b981', 'important');
        b.style.setProperty('color', '#ffffff', 'important');
        const svg = b.querySelector('svg');
        if (svg) svg.style.setProperty('stroke', '#ffffff', 'important');
        const label = b.querySelector('.tab-label');
        if (label) label.style.setProperty('color', '#ffffff', 'important');
      } else {
        b.classList.remove('active', 'bg-[#10b981]', 'text-white', 'border-[#10b981]');
        b.classList.add('bg-white', 'dark:bg-slate-900', 'text-gray-700', 'dark:text-gray-200');
        b.style.removeProperty('background-color');
        b.style.removeProperty('color');
        const svg = b.querySelector('svg');
        if (svg) svg.style.removeProperty('stroke');
        const label = b.querySelector('.tab-label');
        if (label) label.style.removeProperty('color');
      }
    });

    selectedDateKey = getDefaultDateKey();
    currentPage = 1;
    populateDateRangeOptions();
    render();
  };

  // Header Period Buttons
  document.querySelectorAll('.header-period-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const p = e.currentTarget.dataset.period;
      if (p) window.setPeriod(p);
    });
  });

  // Table Log Tab Buttons
  document.querySelectorAll('.log-tab').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const p = e.currentTarget.dataset.period;
      if (p) window.setPeriod(p);
    });
  });

  const dateRangeSelect = document.getElementById('dateRangeSelect');
  const historyDatePicker = document.getElementById('historyDatePicker');
  if (dateRangeSelect) {
    dateRangeSelect.addEventListener('change', (e) => {
      if (e.target.value === '__older__') {
        dateRangeSelect.value = selectedDateKey;
        if (historyDatePicker) {
          const asDate = key => key.length === 4 ? key + '-01-01' : key.length === 7 ? key + '-01' : key;
          const keys = getAvailableDateKeys();
          historyDatePicker.min = asDate(keys[keys.length - 1]);
          historyDatePicker.max = getPeriodDateKey(new Date(), 'daily');
          historyDatePicker.value = asDate(selectedDateKey);
          historyDatePicker.setCustomValidity('');
          historyDatePicker.style.display = '';
          historyDatePicker.focus();
          try { historyDatePicker.showPicker?.(); } catch (_) {}
        }
        return;
      }
      if (historyDatePicker) historyDatePicker.style.display = 'none';
      selectedDateKey = e.target.value;
      followLatestLogPeriod = selectedDateKey === getPeriodDateKey(new Date(), currentPeriod);
      currentPage = 1;
      render();
    });
  }

  if (historyDatePicker) {
    historyDatePicker.addEventListener('change', () => {
      const key = getPeriodDateKey(new Date(historyDatePicker.value + 'T12:00:00'), currentPeriod);
      if (!key || !getAvailableDateKeys().includes(key)) {
        historyDatePicker.setCustomValidity('No logs are available for this date or period.');
        historyDatePicker.reportValidity();
        return;
      }
      historyDatePicker.setCustomValidity('');
      selectedDateKey = key;
      followLatestLogPeriod = key === getPeriodDateKey(new Date(), currentPeriod);
      currentPage = 1;
      historyDatePicker.style.display = 'none';
      render();
    });
    historyDatePicker.addEventListener('input', () => historyDatePicker.setCustomValidity(''));
    historyDatePicker.addEventListener('blur', () => {
      if (!historyDatePicker.value) historyDatePicker.style.display = 'none';
    });
  }

  // Time filter inputs
  const startTimeInput = document.getElementById('startTimeFilter');
  const endTimeInput = document.getElementById('endTimeFilter');
  const clearTimeBtn = document.getElementById('clearTimeFilterBtn');

  if (startTimeInput) {
    startTimeInput.addEventListener('change', (e) => {
      startTimeFilter = e.target.value;
      currentPage = 1;
      render();
    });
  }

  if (endTimeInput) {
    endTimeInput.addEventListener('change', (e) => {
      endTimeFilter = e.target.value;
      currentPage = 1;
      render();
    });
  }

  if (clearTimeBtn) {
    clearTimeBtn.addEventListener('click', () => {
      startTimeFilter = '';
      endTimeFilter = '';
      if (startTimeInput) startTimeInput.value = '';
      if (endTimeInput) endTimeInput.value = '';
      currentPage = 1;
      render();
    });
  }

  // Node filter dropdown
  const nodeFilterEl = document.getElementById('nodeFilter');
  if (nodeFilterEl) {
    nodeFilterEl.addEventListener('change', (e) => {
      currentNodeFilter = e.target.value;
      currentPage = 1;
      render();
    });
  }

  // Reset all filters button
  const resetFiltersBtn = document.getElementById('resetAllFiltersBtn');
  if (resetFiltersBtn) {
    resetFiltersBtn.addEventListener('click', () => {
      currentNodeFilter = '';
      if (nodeFilterEl) nodeFilterEl.value = '';

      followLatestLogPeriod = true;
      if (historyDatePicker) historyDatePicker.style.display = 'none';
      selectedDateKey = getDefaultDateKey();
      if (dateRangeSelect) dateRangeSelect.value = selectedDateKey;

      startTimeFilter = '';
      endTimeFilter = '';
      if (startTimeInput) startTimeInput.value = '';
      if (endTimeInput) endTimeInput.value = '';

      currentPage = 1;
      populateDateRangeOptions();
      render();
    });
  }

  // Clear All Logs uses an in-app confirmation with progress and error states.
  const clearAllLogsBtn = document.getElementById('clearAllLogsBtn');
  if (clearAllLogsBtn && window.EcoTrackClearLogsDialog) {
    window.EcoTrackClearLogsDialog.attach(clearAllLogsBtn, clearAllTelemetryHistory);
  } else if (clearAllLogsBtn) {
    clearAllLogsBtn.disabled = true;
  }

  let downloadProgressInterval = null;

  function showDownloadModal(type, actualDownloadFn) {
    const modal = document.getElementById('downloadModal');
    const title = document.getElementById('downloadModalTitle');
    const subtitle = document.getElementById('downloadModalSubtitle');
    const progressBar = document.getElementById('downloadProgressBar');
    const percentText = document.getElementById('downloadProgressPercent');
    
    if (!modal || !title || !subtitle || !progressBar) return;
    
    if (type === 'pdf') {
      title.textContent = 'Generating PDF';
      subtitle.textContent = 'Creating your monitoring report...';
    } else {
      title.textContent = 'Generating Excel';
      subtitle.textContent = 'Building spreadsheet logs...';
    }
    
    progressBar.style.width = '0%';
    if (percentText) percentText.textContent = '0%';
    modal.style.display = 'flex';
    
    let progress = 0;
    clearInterval(downloadProgressInterval);
    
    downloadProgressInterval = setInterval(() => {
      progress += Math.floor(Math.random() * 12) + 5;
      if (progress >= 100) {
        progress = 100;
        progressBar.style.width = '100%';
        if (percentText) percentText.textContent = '100%';
        clearInterval(downloadProgressInterval);
        
        setTimeout(() => {
          modal.style.display = 'none';
          actualDownloadFn();
        }, 400);
      } else {
        progressBar.style.width = `${progress}%`;
        if (percentText) percentText.textContent = `${progress}%`;
      }
    }, 120);
  }

  // Export buttons (Header & Table)
  const headerPdfBtn = document.getElementById('headerExportPdfBtn');
  if (headerPdfBtn) {
    headerPdfBtn.addEventListener('click', () => {
      showDownloadModal('pdf', exportLogs);
    });
  }

  const headerExcelBtn = document.getElementById('headerExportExcelBtn');
  if (headerExcelBtn) {
    headerExcelBtn.addEventListener('click', () => {
      showDownloadModal('excel', exportExcelLogs);
    });
  }

  const tablePdfBtn = document.getElementById('exportBtn');
  if (tablePdfBtn) {
    tablePdfBtn.addEventListener('click', () => {
      showDownloadModal('pdf', exportLogs);
    });
  }

  const tableExcelBtn = document.getElementById('exportExcelBtn');
  if (tableExcelBtn) {
    tableExcelBtn.addEventListener('click', () => {
      showDownloadModal('excel', exportExcelLogs);
    });
  }

  const cancelDownloadBtn = document.getElementById('cancelDownloadBtn');
  if (cancelDownloadBtn) {
    cancelDownloadBtn.addEventListener('click', () => {
      clearInterval(downloadProgressInterval);
      const modal = document.getElementById('downloadModal');
      if (modal) modal.style.display = 'none';
    });
  }



  // Pagination buttons
  const prevPageBtn = document.getElementById('prevPageBtn');
  const nextPageBtn = document.getElementById('nextPageBtn');

  if (prevPageBtn) {
    prevPageBtn.addEventListener('click', () => {
      if (currentPage > 1) {
        currentPage--;
        render();
      }
    });
  }

  if (nextPageBtn) {
    nextPageBtn.addEventListener('click', () => {
      const filtered = getFilteredLogs();
      const totalPages = Math.ceil(filtered.length / PAGE_SIZE) || 1;
      if (currentPage < totalPages) {
        currentPage++;
        render();
      }
    });
  }
}

// Fetch real control telemetry data from Native SQLite3 (backend/telemetry.db)
async function fetchLogsFromDB(silent = false) {
  const tbody = document.getElementById('logsTableBody');
  if (!silent && tbody && (!nodeDataLogs || nodeDataLogs.length === 0)) {
    window.EcoTrackSkeletons?.renderTableSkeleton('logsTableBody', {
      rows: 8,
      cols: 9,
      colWidths: ['w-28', 'w-20', 'w-24', 'w-20', 'w-16', 'w-16', 'w-16', 'w-16', 'w-20']
    });
  }
  try {
    const backendUrl = window.ECOTRACK_CONFIG?.backendUrl || 'http://localhost:5000';
    const res = await fetch(`${backendUrl}/api/telemetry?perPage=0&sort=-created`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Telemetry request failed (HTTP ${res.status})`);
    const data = await res.json();
    if (!Array.isArray(data.items)) throw new Error('Telemetry response must contain an items array');
    const records = data.items;
    lastTelemetryTotalItems = data.totalItems ?? records.length;
    lastTelemetryRevision = getTelemetryRevision(data);
    lastTelemetryResetAt = data.reset_at || null;

    nodeDataLogs = records.map((r, i) => {
      // 1. Direct fields saved in PocketBase telemetry collection
      let controlName = r.control_name || r.sensor_name;
      let roomName = r.room_name;
      let floorName = r.floor_name;
      let buildingName = r.building_name;
      let airconType = r.aircon_type;

      // 2. Relational expanded fields from PocketBase if not directly on the record
      if (r.expand && r.expand.node_id) {
        const n = r.expand.node_id;
        if (!controlName) controlName = n.name || r.node_id;
        if (!airconType) airconType = n.aircon_type;
        if (n.expand && n.expand.room_id) {
          const rm = n.expand.room_id;
          if (!roomName) roomName = rm.name;
          if (rm.expand && rm.expand.floor_id) {
            const fl = rm.expand.floor_id;
            if (!floorName) floorName = fl.name;
            if (fl.expand && fl.expand.building_id) {
              const b = fl.expand.building_id;
              if (!buildingName) buildingName = b.name;
            }
          }
        }
      }

      // 3. Fallback to loaded PocketBase node maps
      if (!controlName) controlName = controlNameMap[r.node_id] || r.node_id;
      if (!roomName && locationMap[r.node_id]) roomName = locationMap[r.node_id].roomName;
      if (!floorName && locationMap[r.node_id]) floorName = locationMap[r.node_id].floorName;
      if (!buildingName && locationMap[r.node_id]) buildingName = locationMap[r.node_id].buildingName;
      if (!airconType) airconType = globalAirconMap[r.node_id] || null;

      // Cache back into maps for quick UI lookup
      controlNameMap[r.node_id] = controlName;
      if (!locationMap[r.node_id]) {
        locationMap[r.node_id] = {
          roomName: roomName || 'Unassigned',
          floorName: floorName || 'Unassigned',
          buildingName: buildingName || 'Unassigned'
        };
      }
      globalAirconMap[r.node_id] = airconType;

      return {
        id: r.id,
        nodeId: r.node_id,
        controlName: controlName || r.node_id,
        roomName: roomName || 'Unassigned',
        floorName: floorName || 'Unassigned',
        buildingName: buildingName || 'Unassigned',
        airconType: airconType,
        timestamp: new Date(r.created),
        temperature: r.temperature,
        pressure: r.pressure,
        battery: r.battery,
        rssi: r.rssi,
        status: r.status || 'unknown',
        eventType: r.event_type,
        intervalSeconds: r.interval_seconds,
        intervalVal: r.interval_val,
        intervalUnit: r.interval_unit,
        wakeTime: r.wake_time,
        sleepTime: r.sleep_time,
        acOn: r.ac_on ?? r.acOn,
        powerState: r.power_state ?? r.powerState,
        acState: r.ac_state ?? r.acState,
        aircon_state: r.aircon_state,
        ac_current_a: r.ac_current_a,
        compressor_current_a: r.compressor_current_a,
        airconId: r.aircon_id,
        controlSnapshot: window.EcoTrackAirconState?.parseAirconSnapshot(r.control_snapshot)
      };
    });

    // Clear stale analytics immediately; abort predictions based on deleted rows.
    if (!records.length) predictEnergyConsumption({ totalRecords: 0 }, []);

    // Populate filter options with real controls and historical records.
    const nodeFilter = document.getElementById('nodeFilter');
    if (nodeFilter) {
      const addedValues = new Set();
      if (nodeFilter.options.length === 0) {
        const defaultOpt = document.createElement('option');
        defaultOpt.value = '';
        defaultOpt.textContent = 'All Controls';
        nodeFilter.appendChild(defaultOpt);
      }

      nodeDataLogs.forEach(log => {
        const sName = log.controlName || log.nodeId;
        const filterVal = sName;
        if (!addedValues.has(filterVal)) {
          addedValues.add(filterVal);
          const roomSuffix = (log.roomName && log.roomName !== 'Unassigned') ? ` (${log.roomName})` : '';

          if (!nodeFilter.querySelector(`option[value="${CSS.escape(filterVal)}"]`)) {
            const option = document.createElement('option');
            option.value = filterVal;
            option.textContent = `${sName}${roomSuffix}`;
            nodeFilter.appendChild(option);
          }
        }
      });
    }
  } catch(e) {
    console.error('Local telemetry load error:', e);
  }
}

// Get filtered logs based on current period, node filter, and time range
function getFilteredLogs() {
  const activeDateKey = selectedDateKey || getDefaultDateKey();
  let filtered = nodeDataLogs;
  
  // Include all telemetry logs (do not filter out unassigned nodes)
  filtered = filtered.filter(log => getPeriodDateKey(log.timestamp, currentPeriod) === activeDateKey);
  
  // Filter by AC Control (matches name or database id)
  if (currentNodeFilter) {
    filtered = filtered.filter(log => 
      log.nodeId === currentNodeFilter || 
      log.controlName === currentNodeFilter ||
      (controlNameMap[currentNodeFilter] && controlNameMap[currentNodeFilter] === log.controlName) ||
      (controlNameMap[log.nodeId] && controlNameMap[log.nodeId] === currentNodeFilter)
    );
  }

  // Filter by Start Time and End Time
  if (startTimeFilter || endTimeFilter) {
    filtered = filtered.filter(log => {
      const logMinutes = log.timestamp.getHours() * 60 + log.timestamp.getMinutes();

      if (startTimeFilter && endTimeFilter) {
        const [sH, sM] = startTimeFilter.split(':').map(Number);
        const [eH, eM] = endTimeFilter.split(':').map(Number);
        const startMinutes = sH * 60 + sM;
        const endMinutes = eH * 60 + eM;

        if (startMinutes <= endMinutes) {
          return logMinutes >= startMinutes && logMinutes <= endMinutes;
        } else {
          // Overnight range (e.g. 22:00 to 06:00)
          return logMinutes >= startMinutes || logMinutes <= endMinutes;
        }
      }

      if (startTimeFilter) {
        const [sH, sM] = startTimeFilter.split(':').map(Number);
        const startMinutes = sH * 60 + sM;
        return logMinutes >= startMinutes;
      }

      if (endTimeFilter) {
        const [eH, eM] = endTimeFilter.split(':').map(Number);
        const endMinutes = eH * 60 + eM;
        return logMinutes <= endMinutes;
      }

      return true;
    });
  }
  
  return filtered;
}

// Calculate statistics from filtered logs
function calculateStats() {
  const filtered = getFilteredLogs();
  
  if (filtered.length === 0) {
    return {
      totalRecords: 0,
      avgTemp: '--',
      onlineNodes: '0/0'
    };
  }
  
  // Calculate averages
  const temps = filtered.map(l => parseFloat(l.temperature)).filter(Number.isFinite);
  const avgTemp = temps.length ? Math.round(temps.reduce((a, b) => a + b, 0) / temps.length) : '--';
  
  // Count online nodes
  const activeNodes = new Set();
  const onlineActiveNodes = new Set();
  
  filtered.forEach(l => {
    activeNodes.add(l.nodeId);
    if (l.status === 'online') {
      onlineActiveNodes.add(l.nodeId);
    }
  });

  const fleet = getAirconFleetCount();
  const totalFleetUnits = currentNodeFilter ? 1 : Math.max(fleet.total, activeNodes.size);
  const onlineFleetUnits = currentNodeFilter ? Math.min(1, onlineActiveNodes.size) : Math.max(fleet.online, onlineActiveNodes.size);
  
  return {
    totalRecords: filtered.length,
    avgTemp: avgTemp,
    onlineNodes: `${onlineFleetUnits}/${totalFleetUnits}`
  };
}

// ─── ENERGY CONSUMPTION PREDICTION (via Flask + .pkl models) ──────────

// ─── DYNAMIC ELECTRICITY TARIFF & BUDGET MANAGEMENT ───────────────────
function getActiveTariffRate() {
  const stored = parseFloat(localStorage.getItem('ecoTrack_tariff_rate'));
  return Number.isFinite(stored) && stored > 0 ? stored : null;
}

function getTargetBudget() {
  const stored = parseFloat(localStorage.getItem('ecoTrack_target_budget'));
  return Number.isFinite(stored) && stored > 0 ? stored : null;
}

function getUtilityProvider() {
  return localStorage.getItem('ecoTrack_utility_provider')?.trim() || 'Not configured';
}

function calculateEnergyCost(kwh, rate = getActiveTariffRate()) {
  return Number.isFinite(kwh) && Number.isFinite(rate) && rate > 0 ? kwh * rate : null;
}

function formatTariffRate(rate = getActiveTariffRate(), currency = '₱') {
  return Number.isFinite(rate) && rate > 0 ? `${currency}${formatAnalyticsNumber(rate)} / kWh` : 'Not configured';
}

function formatAnalyticsNumber(value, decimals = 2) {
  return Number.isFinite(value) ? value.toFixed(decimals) : 'Unavailable';
}

function saveTariffSettings(rate, budget, provider) {
  const numRate = parseFloat(rate);
  const numBudget = parseFloat(budget);
  if (!Number.isFinite(numRate) || numRate <= 0) return false;

  localStorage.setItem('ecoTrack_tariff_rate', numRate.toFixed(2));
  if (!isNaN(numBudget) && numBudget > 0) {
    localStorage.setItem('ecoTrack_target_budget', numBudget.toFixed(1));
  }
  if (provider?.trim()) localStorage.setItem('ecoTrack_utility_provider', provider.trim());
  else localStorage.removeItem('ecoTrack_utility_provider');


  updateTariffUI();
  return true;
}

function updateTariffUI() {
  const rate = getActiveTariffRate();
  const budget = getTargetBudget();
  const rateFmt = formatTariffRate(rate);

  const headerDisplay = document.getElementById('headerTariffDisplay');
  if (headerDisplay) headerDisplay.textContent = rateFmt;

  const kpiRate = document.getElementById('kpiCostRate');
  if (kpiRate) kpiRate.textContent = rateFmt;

  const costCardRate = document.getElementById('costCardRate');
  if (costCardRate) costCardRate.textContent = rateFmt;

  const targetBudgetEl = document.getElementById('kpiTargetBudget');
  if (targetBudgetEl) targetBudgetEl.textContent = formatAnalyticsNumber(budget, 1);
}

function setupTariffModal() {
  const modal = document.getElementById('tariffSettingsModal');
  const openBtn = document.getElementById('openTariffModalBtn');
  const closeBtn = document.getElementById('closeTariffModalBtn');
  const cancelBtn = document.getElementById('cancelTariffModalBtn');
  const form = document.getElementById('tariffConfigForm');
  const rateInput = document.getElementById('tariffRateInput');
  const budgetInput = document.getElementById('targetBudgetInput');
  const providerInput = document.getElementById('utilityProviderInput');
  const previewBill = document.getElementById('tariffPreviewBill');
  const resetBtn = document.getElementById('resetTariffDefaultBtn');

  if (!modal) return;

  function openModal() {
    if (rateInput) rateInput.value = getActiveTariffRate()?.toFixed(2) || '';
    if (budgetInput) budgetInput.value = getTargetBudget()?.toFixed(1) || '';
    if (providerInput) providerInput.value = localStorage.getItem('ecoTrack_utility_provider') || '';
    updatePreview();
    modal.classList.remove('hidden');
  }

  function closeModal() {
    modal.classList.add('hidden');
  }

  function updatePreview() {
    if (!previewBill || !rateInput) return;
    const rate = parseFloat(rateInput.value);
    const cost = calculateEnergyCost(currentEvaluatedKwh, rate);
    previewBill.textContent = Number.isFinite(cost)
      ? '₱' + cost.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ` (${currentEvaluatedKwh.toFixed(1)} kWh)`
      : 'Enter a rate and load valid energy data to preview cost.';
  }

  if (openBtn) openBtn.addEventListener('click', openModal);
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
      closeModal();
    }
  });

  if (rateInput) {
    rateInput.addEventListener('input', updatePreview);
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      for (const key of ['ecoTrack_tariff_rate', 'ecoTrack_target_budget', 'ecoTrack_utility_provider']) localStorage.removeItem(key);
      if (rateInput) rateInput.value = '';
      if (budgetInput) budgetInput.value = '';
      if (providerInput) providerInput.value = '';
      updateTariffUI();
      render();
      updatePreview();
    });
  }

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const newRate = parseFloat(rateInput.value);
      const newBudget = parseFloat(budgetInput.value);
      const newProvider = providerInput ? providerInput.value : '';

      if (saveTariffSettings(newRate, newBudget, newProvider)) {
        closeModal();
        render();
        const cModal = document.getElementById('topConsumersModal');
        if (cModal && !cModal.classList.contains('hidden')) {
          updateTopConsumersModal();
        }
      }
    });
  }
}

// ─── HIGHEST CONSUMPTION BREAKDOWN MODAL (INFO MODAL) ─────────────────
function getDrawLevelBadge(sharePct) {
  if (sharePct >= 35) {
    return `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30">CRITICAL DRAW</span>`;
  } else if (sharePct >= 22) {
    return `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">HIGH DRAW</span>`;
  } else if (sharePct >= 12) {
    return `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30">MODERATE</span>`;
  } else {
    return `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">OPTIMAL</span>`;
  }
}

function getRankBadge(index) {
  if (index === 0) {
    return `<span class="inline-flex items-center gap-1 font-black text-amber-500 bg-amber-500/15 px-2 py-0.5 rounded-md border border-amber-500/30">🥇 #1</span>`;
  } else if (index === 1) {
    return `<span class="inline-flex items-center gap-1 font-black text-slate-400 bg-slate-400/15 px-2 py-0.5 rounded-md border border-slate-400/30">🥈 #2</span>`;
  } else if (index === 2) {
    return `<span class="inline-flex items-center gap-1 font-black text-amber-700 dark:text-amber-500 bg-amber-700/15 px-2 py-0.5 rounded-md border border-amber-700/30">🥉 #3</span>`;
  } else {
    return `<span class="inline-flex items-center font-bold text-slate-500 dark:text-gray-400 px-2 py-0.5">#${index + 1}</span>`;
  }
}

function getShareProgressBar(sharePct) {
  let color = 'bg-emerald-500';
  if (sharePct >= 35) color = 'bg-rose-500';
  else if (sharePct >= 22) color = 'bg-amber-500';
  else if (sharePct >= 12) color = 'bg-blue-500';

  return `
    <div class="flex items-center gap-2.5 min-w-[130px]">
      <div class="flex-1 h-2 rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden">
        <div class="h-full rounded-full ${color} transition-all duration-300" style="width: ${Math.min(100, Math.max(2, sharePct))}%;"></div>
      </div>
      <span class="text-xs font-mono font-black text-slate-700 dark:text-gray-300 w-12 text-right">${sharePct.toFixed(1)}%</span>
    </div>
  `;
}

function computeConsumptionRankings() {
  const rate = getActiveTariffRate();
  const groups = { buildings: {}, floors: {}, rooms: {}, controls: {}, airconTypes: {} };
  const jobs = (currentAnalyticsResult?.nodes || []).filter(job => Number.isFinite(job.kwh));
  const totalKwh = jobs.length ? jobs.reduce((sum, job) => sum + job.kwh, 0) : null;
  jobs.forEach(job => {
    const log = job.logs?.[0];
    if (!log) return;
    const names = { buildings: log.buildingName, floors: log.floorName, rooms: log.roomName,
      controls: log.controlName || controlNameMap[job.id] || job.id, airconTypes: log.airconType || globalAirconMap[job.id] };
    Object.entries(names).forEach(([category, name]) => {
      if (!name || ['Unassigned', 'Unknown'].includes(name)) return;
      groups[category][name] = (groups[category][name] || 0) + job.kwh;
    });
  });
  const result = { totalKwh, totalCost: calculateEnergyCost(totalKwh, rate), rate, period: currentPeriod };
  Object.entries(groups).forEach(([category, entries]) => {
    result[category] = Object.entries(entries).sort((a, b) => b[1] - a[1]).map(([name, kwh]) => ({
      name, kwh, cost: calculateEnergyCost(kwh, rate), share: totalKwh > 0 ? kwh / totalKwh * 100 : 0
    }));
  });
  return result;
}

function updateTopConsumersModal(activeCategory = currentActiveConsumerTab) {
  currentActiveConsumerTab = activeCategory;
  const rankings = computeConsumptionRankings();
  const fmt = (v) => Number.isFinite(v) ? '₱' + v.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'Unavailable';
  const fmtKwh = (v) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  // 1. Update Scope Banner
  const periodEl = document.getElementById('modalScopePeriod');
  const tariffEl = document.getElementById('modalScopeTariff');
  const totalKwhEl = document.getElementById('modalScopeTotalKwh');
  const totalCostEl = document.getElementById('modalScopeTotalCost');

  if (periodEl) periodEl.textContent = rankings.period.toUpperCase();
  if (tariffEl) tariffEl.textContent = formatTariffRate(rankings.rate);
  if (totalKwhEl) totalKwhEl.textContent = rankings.totalKwh > 0 ? `${fmtKwh(rankings.totalKwh)} kWh` : '--';
  if (totalCostEl) totalCostEl.textContent = rankings.totalCost > 0 ? fmt(rankings.totalCost) : '--';

  // 2. Update Top 5 Highlights Cards (#1 in each category)
  const updateHighlight = (topItem, nameId, kwhId, costId, shareId) => {
    const elName = document.getElementById(nameId);
    const elKwh = document.getElementById(kwhId);
    const elCost = document.getElementById(costId);
    const elShare = document.getElementById(shareId);
    if (topItem && topItem.name) {
      if (elName) { elName.textContent = topItem.name; elName.title = topItem.name; }
      if (elKwh) elKwh.textContent = rankings.totalKwh > 0 ? fmtKwh(topItem.kwh) : '--';
      if (elCost) elCost.textContent = rankings.totalCost > 0 ? fmt(topItem.cost) : '--';
      if (elShare) elShare.textContent = `${topItem.share.toFixed(1)}%`;
    } else {
      if (elName) { elName.textContent = '--'; elName.title = ''; }
      if (elKwh) elKwh.textContent = '--';
      if (elCost) elCost.textContent = '--';
      if (elShare) elShare.textContent = '--%';
    }
  };

  updateHighlight(rankings.buildings[0], 'topBuildingName', 'topBuildingKwh', 'topBuildingCost', 'topBuildingShare');
  updateHighlight(rankings.floors[0], 'topFloorName', 'topFloorKwh', 'topFloorCost', 'topFloorShare');
  updateHighlight(rankings.rooms[0], 'topRoomName', 'topRoomKwh', 'topRoomCost', 'topRoomShare');
  updateHighlight(rankings.controls[0], 'topControlName', 'topControlKwh', 'topControlCost', 'topControlShare');
  updateHighlight(rankings.airconTypes[0], 'topAirconTypeName', 'topAirconTypeKwh', 'topAirconTypeCost', 'topAirconTypeShare');

  // 3. Update Category Tabs Active State
  const tabButtons = document.querySelectorAll('#consumersTabContainer .consumer-tab-btn');
  tabButtons.forEach(btn => {
    const isAct = btn.dataset.category === activeCategory;
    btn.classList.toggle('active', isAct);
    if (isAct) {
      btn.className = 'consumer-tab-btn active px-3 py-1.5 rounded-lg transition-all cursor-pointer bg-[#10b981] text-white shadow-xs font-bold';
    } else {
      btn.className = 'consumer-tab-btn px-3 py-1.5 rounded-lg transition-all cursor-pointer text-slate-600 dark:text-gray-300 hover:text-[#10b981] font-bold';
    }
  });

  // 4. Update Header Label
  const headerMap = {
    buildings: 'Building Name',
    floors: 'Floor Level',
    rooms: 'Room / Facility Name',
    controls: 'AC Control Unit',
    airconTypes: 'Aircon Equipment Type'
  };
  const headerEl = document.getElementById('leaderboardNameHeader');
  if (headerEl) headerEl.textContent = headerMap[activeCategory] || 'Entity Name';

  // 5. Render Leaderboard Rows
  const tbody = document.getElementById('topConsumersTableBody');
  if (!tbody) return;

  const categoryList = rankings[activeCategory] || [];
  if (categoryList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="px-4 py-6 text-center text-slate-400 font-bold">No ranking data available for this category</td></tr>`;
    return;
  }

  tbody.innerHTML = categoryList.map((item, idx) => {
    const rankBadge = getRankBadge(idx);
    const progressBar = getShareProgressBar(item.share);
    const drawBadge = getDrawLevelBadge(item.share);
    const rowBg = idx === 0 ? 'bg-amber-500/5 dark:bg-amber-500/10 font-medium' : (idx % 2 === 0 ? 'bg-transparent' : 'bg-slate-50/50 dark:bg-white/[0.02]');

    return `
      <tr class="${rowBg} hover:bg-slate-100 dark:hover:bg-white/5 transition-colors">
        <td class="px-4 py-3 font-bold whitespace-nowrap">${rankBadge}</td>
        <td class="px-4 py-3 font-bold text-slate-900 dark:text-white">
          <div class="flex items-center gap-2">
            <span>${item.name}</span>
            ${idx === 0 ? '<span class="px-1.5 py-0.5 rounded text-[9px] font-black uppercase bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30">TOP #1</span>' : ''}
          </div>
        </td>
        <td class="px-4 py-3 whitespace-nowrap">${progressBar}</td>
        <td class="px-4 py-3 font-mono font-bold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">${fmtKwh(item.kwh)} kWh</td>
        <td class="px-4 py-3 font-mono font-bold text-slate-700 dark:text-gray-300 whitespace-nowrap">${fmt(item.cost)}</td>
        <td class="px-4 py-3 text-right whitespace-nowrap">${drawBadge}</td>
      </tr>
    `;
  }).join('');
}

function setupTopConsumersModal() {
  const modal = document.getElementById('topConsumersModal');
  const openBtn = document.getElementById('openTopConsumersModalBtn');
  const closeBtn = document.getElementById('closeTopConsumersModalBtn');
  const closeBottomBtn = document.getElementById('closeTopConsumersBtn');
  const tabContainer = document.getElementById('consumersTabContainer');

  if (!modal) return;

  function openModal() {
    updateTopConsumersModal(currentActiveConsumerTab);
    modal.classList.remove('hidden');
  }

  function closeModal() {
    modal.classList.add('hidden');
  }

  if (openBtn) openBtn.addEventListener('click', openModal);
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (closeBottomBtn) closeBottomBtn.addEventListener('click', closeModal);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
      closeModal();
    }
  });

  if (tabContainer) {
    tabContainer.querySelectorAll('.consumer-tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const cat = e.currentTarget.dataset.category;
        if (cat) {
          updateTopConsumersModal(cat);
        }
      });
    });
  }
}

// ─── INTERACTIVE CHART.JS ANALYTICS DASHBOARD ─────────────────────────
let energyTrendChartInstance = null;
let estimatedCostChartInstance = null;
let dualAxisChartInstance = null;
let currentChartGranularity = 'daily';

function updateOrCreateAnalyticsChart(instance, canvas, config) {
  if (!instance) return new Chart(canvas, config);
  instance.data = config.data;
  instance.options = config.options;
  instance.update('none');
  return instance;
}

function initAnalyticsCharts() {
  updateAnalyticsCharts();
}

function updateAnalyticsCharts(currentKwh, currentCost) {
  if (typeof Chart === 'undefined') return;

  const isDark = document.documentElement.classList.contains('dark');
  const textColor = isDark ? '#94a3b8' : '#64748b';
  const gridColor = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)';
  const rate = getActiveTariffRate();

  let labels = [];
  let trendData = [];
  let baselineData = [];
  let costData = [];
  let lowLabel = '--';
  let peakLabel = '--';
  let periodBadgeText = '';

  const filteredLogs = getFilteredLogs();
  const baseKwh = Number.isFinite(currentKwh) ? currentKwh : currentKwh === null ? null : currentAnalyticsResult?.kwh ?? null;
  const available = Number.isFinite(baseKwh);
  const result = currentAnalyticsResult;
  const definitions = {
    daily: { labels: ['12:00 AM', '3:00 AM', '6:00 AM', '9:00 AM', '12:00 PM', '3:00 PM', '6:00 PM', '9:00 PM', '11:59 PM'], badge: '24-hour observation interval' },
    weekly: { labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], badge: '7-day observation interval' },
    monthly: { labels: ['Week 1', 'Week 2', 'Week 3', 'Week 4'], badge: 'Monthly observation interval' },
    yearly: { labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], badge: 'Annual observation interval' }
  };
  const definition = definitions[currentPeriod] || definitions.daily;
  labels = definition.labels;
  periodBadgeText = definition.badge;
  trendData = available ? getAnalyticsChartSeries(result?.nodes, currentPeriod) : labels.map(() => null);
  baselineData = (result?.previous?.nodes?.length && (result.previous.kwh !== null || result.previous.runtime !== null)) ? getAnalyticsChartSeries(result.previous.nodes, currentPeriod) : labels.map(() => null);
  costData = trendData.map(kwh => Number.isFinite(kwh) ? calculateEnergyCost(kwh, rate) : null);
  const knownIndices = trendData.map((value, index) => Number.isFinite(value) ? index : -1).filter(index => index >= 0);
  if (knownIndices.length) {
    lowLabel = labels[knownIndices.reduce((best, index) => trendData[index] < trendData[best] ? index : best, knownIndices[0])];
    peakLabel = labels[knownIndices.reduce((best, index) => trendData[index] > trendData[best] ? index : best, knownIndices[0])];
  }
  const known = trendData.filter(Number.isFinite);
  const format = value => Number.isFinite(value) ? value.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : 'Unavailable';
  const periodLow = format(known.length ? Math.min(...known) : null);
  const periodPeak = format(known.length ? Math.max(...known) : null);
  const periodTotal = format(baseKwh);
  for (const id of ['energyTrendEmpty', 'estimatedCostEmpty', 'dualAxisEmpty']) {
    const empty = document.getElementById(id);
    if (empty) empty.style.display = (available && (id !== 'estimatedCostEmpty' || Number.isFinite(rate))) ? 'none' : 'flex';
  }
  const periodCap = currentPeriod.charAt(0).toUpperCase() + currentPeriod.slice(1);

  const lowEl = document.getElementById('trendLow');
  if (lowEl) lowEl.textContent = available && lowLabel !== '--' ? `${periodLow} kWh (${lowLabel})` : 'Unavailable';
  const peakEl = document.getElementById('trendPeak');
  if (peakEl) peakEl.textContent = available && peakLabel !== '--' ? `${periodPeak} kWh (${peakLabel})` : 'Unavailable';
  const totalEl = document.getElementById('trendTotal');
  if (totalEl) totalEl.textContent = available ? `${periodTotal} kWh` : 'Unavailable';

  const lowPrefix = document.getElementById('trendLowPrefix');
  if (lowPrefix) lowPrefix.textContent = `${periodCap} Low`;
  const peakPrefix = document.getElementById('trendPeakPrefix');
  if (peakPrefix) peakPrefix.textContent = `${periodCap} Peak`;
  const totalPrefix = document.getElementById('trendTotalPrefix');
  if (totalPrefix) totalPrefix.textContent = `${periodCap} Total`;

  const trendBaselineLegend = document.getElementById('trendBaselineLegend');
  if (trendBaselineLegend) {
    trendBaselineLegend.textContent = result?.previous?.complete ? 'Previous period estimate' : 'Previous period: Unavailable';
  }

  const controlScopeName = currentNodeFilter ? (controlNameMap[currentNodeFilter] || currentNodeFilter) : 'All Controls';

  const trendSub = document.getElementById('energyTrendSubtitle');
  if (trendSub) {
    trendSub.textContent = `${result?.forecast ? 'Forecast from saved settings and wake/sleep times' : available ? 'Estimated energy from confirmed runtime' : 'Awaiting confirmed operating data'} • Scope: ${controlScopeName} • ${getDateRangeText()}`;
  }

  const costSub = document.getElementById('estimatedCostSubtitle');
  if (costSub) {
    costSub.innerHTML = `Electricity Rate: <span id="costCardRate" class="font-bold text-amber-600 dark:text-amber-400">₱${formatAnalyticsNumber(rate)} / kWh</span> • Scope: <strong class="text-slate-700 dark:text-white">${controlScopeName}</strong>`;
  }

  const badgeEl = document.getElementById('dualAxisPeriodBadge');
  if (badgeEl) badgeEl.textContent = `${periodBadgeText} • Scope: ${controlScopeName}`;

  // 1. ENERGY CONSUMPTION TREND CHART
  const trendCanvas = document.getElementById('energyTrendChart');
  if (trendCanvas) {
    const ctx = trendCanvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 240);
    grad.addColorStop(0, 'rgba(16, 185, 129, 0.35)');
    grad.addColorStop(1, 'rgba(16, 185, 129, 0.0)');

    energyTrendChartInstance = updateOrCreateAnalyticsChart(energyTrendChartInstance, trendCanvas, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: `Usage (${controlScopeName}) (kWh)`,
            data: trendData,
            borderColor: '#10b981',
            backgroundColor: grad,
            borderWidth: 2.5,
            fill: true,
            tension: 0.4,
            pointBackgroundColor: '#ffffff',
            pointBorderColor: '#10b981',
            pointBorderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 6
          },
          {
            label: 'Prev. Period Baseline',
            data: baselineData,
            borderColor: isDark ? '#64748b' : '#94a3b8',
            borderWidth: 1.5,
            borderDash: [5, 5],
            fill: false,
            pointRadius: 0
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: isDark ? '#0c1328' : '#ffffff',
            titleColor: isDark ? '#f8fafc' : '#0f172a',
            bodyColor: isDark ? '#cbd5e1' : '#334155',
            borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
            borderWidth: 1,
            padding: 10,
            callbacks: {
              label: (ctx) => ` ${ctx.dataset.label}: ${ctx.raw} kWh`
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: textColor, font: { weight: '600', size: 11 } }
          },
          y: {
            min: 0,
            max: Math.ceil((Math.max(...trendData) * 1.25) / 5) * 5 || 10,
            grid: { color: gridColor },
            ticks: {
              color: textColor,
              font: { weight: '600', size: 11 },
              callback: (v) => `${v}`
            }
          }
        }
      }
    });
  }

  // 2. ESTIMATED ELECTRICITY COST CHART
  const costCanvas = document.getElementById('estimatedCostChart');
  if (costCanvas) {
    const maxCostIdx = costData.indexOf(Math.max(...costData));

    // Green bars for normal days, bright amber/gold for peak interval
    const barColors = costData.map((_, idx) => idx === maxCostIdx ? '#f59e0b' : '#10b981');
    const barHoverColors = costData.map((_, idx) => idx === maxCostIdx ? '#fbbf24' : '#34d399');

    estimatedCostChartInstance = updateOrCreateAnalyticsChart(estimatedCostChartInstance, costCanvas, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: `Estimated Cost (${controlScopeName})`,
          data: costData,
          backgroundColor: barColors,
          hoverBackgroundColor: barHoverColors,
          borderRadius: 6,
          borderSkipped: false
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: isDark ? '#0c1328' : '#ffffff',
            titleColor: isDark ? '#f8fafc' : '#0f172a',
            bodyColor: isDark ? '#cbd5e1' : '#334155',
            borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
            borderWidth: 1,
            padding: 10,
            callbacks: {
              label: (ctx) => ` Cost: ₱${Number(ctx.raw).toLocaleString('en-PH', { minimumFractionDigits: 2 })} (@ ₱${formatAnalyticsNumber(rate)}/kWh)`
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: textColor, font: { weight: '600', size: 11 } }
          },
          y: {
            min: 0,
            max: Math.ceil((Math.max(...costData) * 1.25) / 25) * 25 || 50,
            grid: { color: gridColor },
            ticks: {
              color: textColor,
              font: { weight: '600', size: 11 },
              callback: (v) => '₱' + (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v)
            }
          }
        }
      }
    });
  }

  // 3. DUAL-AXIS CORRELATION CHART (CONSUMPTION VS COST)
  const dualCanvas = document.getElementById('dualAxisChart');
  if (dualCanvas) {
    dualAxisChartInstance = updateOrCreateAnalyticsChart(dualAxisChartInstance, dualCanvas, {
      data: {
        labels: labels,
        datasets: [
          {
            type: 'bar',
            label: `Cost (${controlScopeName}) (₱)`,
            data: costData,
            backgroundColor: 'rgba(16, 185, 129, 0.75)',
            hoverBackgroundColor: '#10b981',
            borderRadius: 6,
            yAxisID: 'y1',
            barPercentage: 0.5
          },
          {
            type: 'line',
            label: `Energy (${controlScopeName}) (kWh)`,
            data: trendData,
            borderColor: '#22d3ee',
            backgroundColor: '#22d3ee',
            borderWidth: 2.5,
            fill: false,
            tension: 0.35,
            pointBackgroundColor: '#ffffff',
            pointBorderColor: '#22d3ee',
            pointBorderWidth: 2.5,
            pointRadius: 4.5,
            pointHoverRadius: 6.5,
            yAxisID: 'y'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: isDark ? '#0c1328' : '#ffffff',
            titleColor: isDark ? '#f8fafc' : '#0f172a',
            bodyColor: isDark ? '#cbd5e1' : '#334155',
            borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
            borderWidth: 1,
            padding: 10,
            callbacks: {
              label: (ctx) => {
                if (ctx.dataset.yAxisID === 'y1') {
                  return ` Cost: ₱${Number(ctx.raw).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
                }
                return ` Energy: ${ctx.raw} kWh`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: textColor, font: { weight: '600', size: 11 } }
          },
          y: {
            type: 'linear',
            display: true,
            position: 'left',
            min: 0,
            max: Math.ceil((Math.max(...trendData) * 1.25) / 5) * 5 || 10,
            grid: { color: gridColor },
            ticks: {
              color: '#06b6d4',
              font: { weight: 'bold', size: 11 },
              callback: (v) => `${v} kWh`
            }
          },
          y1: {
            type: 'linear',
            display: true,
            position: 'right',
            min: 0,
            max: Math.ceil((Math.max(...costData) * 1.25) / 25) * 25 || 50,
            grid: { drawOnChartArea: false },
            ticks: {
              color: '#10b981',
              font: { weight: 'bold', size: 11 },
              callback: (v) => '₱' + Number(v).toLocaleString('en-PH')
            }
          }
        }
      }
    });
  }

  const energyMaxVal = baseKwh > 0 ? (Math.ceil((Math.max(...trendData, 0) * 1.25) / 5) * 5 || 10) : 10;
  const costMaxVal = baseKwh > 0 ? (Math.ceil((Math.max(...costData, 0) * 1.25) / 25) * 25 || 50) : 50;

  const dualAxisEnergyLegend = document.getElementById('dualAxisEnergyLegend');
  if (dualAxisEnergyLegend) {
    dualAxisEnergyLegend.textContent = baseKwh > 0
      ? `Energy (Left Axis: 0 - ${energyMaxVal} kWh)`
      : available ? 'Energy (Left Axis: 0 kWh)' : 'Energy: Unavailable';
  }

  const dualAxisCostLegend = document.getElementById('dualAxisCostLegend');
  if (dualAxisCostLegend) {
    dualAxisCostLegend.textContent = baseKwh > 0
      ? `Cost (Right Axis: ₱0 - ₱${Number(costMaxVal).toLocaleString('en-PH')})`
      : available ? 'Cost (Right Axis: ₱0)' : 'Cost: Unavailable';
  }

  const corrEl = document.getElementById('correlationScore');
  if (corrEl) {
    const pairs = trendData.map((energy, index) => [energy, costData[index]]).filter(([energy, cost]) => Number.isFinite(energy) && Number.isFinite(cost));
    const meanX = pairs.reduce((sum, pair) => sum + pair[0], 0) / (pairs.length || 1);
    const meanY = pairs.reduce((sum, pair) => sum + pair[1], 0) / (pairs.length || 1);
    const covariance = pairs.reduce((sum, [x, y]) => sum + (x - meanX) * (y - meanY), 0);
    const varianceX = pairs.reduce((sum, [x]) => sum + (x - meanX) ** 2, 0);
    const varianceY = pairs.reduce((sum, [, y]) => sum + (y - meanY) ** 2, 0);
    corrEl.textContent = pairs.length > 1 && varianceX > 0 && varianceY > 0
      ? 'r = ' + Math.max(-1, Math.min(1, covariance / Math.sqrt(varianceX * varianceY))).toFixed(3) : 'Unavailable';
  }
}

// ─── ENERGY CONSUMPTION PREDICTION (via Flask + .pkl models) ──────────

const BACKEND_URL = 'http://127.0.0.1:5000';

const ALGO_TO_MODEL = {
  xgb: 'xgboost'
};

// ─── AIRCON RUNTIME & OPERATIONAL TIMESTAMPS ENGINE ──────────

// Determine actual AC operation from feedback; schedule forecasts are handled separately.
function getConfirmedAcOnState(log) {
  if (log.eventType === 'schedule_updated' || log.event_type === 'schedule_updated') return null;
  if (['offline', 'disconnected'].includes(String(log.status).toLowerCase())) return null;
  const snapshot = typeof window !== 'undefined' && window.EcoTrackAirconState
    ? window.EcoTrackAirconState.describeAirconState(log.controlSnapshot ?? log.control_snapshot) : { confirmed: false };
  if (snapshot.confirmed && typeof snapshot.power === 'boolean') return snapshot.power;
  const value = log.aircon_state ?? log.acOn ?? log.ac_on ?? log.powerState ?? log.power_state ?? log.acState ?? log.ac_state;
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  const state = String(value ?? '').trim().toLowerCase().replace(/[_-]/g, ' ');
  if (['on', 'true', '1', 'cooling', 'active cooling', 'fan only', 'running'].includes(state)) return true;
  if (['off', 'false', '0', 'standby', 'idle', 'stopped'].includes(state)) return false;
  const current = log.ac_current_a ?? log.compressor_current_a;
  if (current !== null && current !== undefined && current !== '' && Number.isFinite(Number(current))) return Number(current) > 0;

  return null;
}

function getDisplayAcState(log) {
  const snapshot = typeof window !== 'undefined' && window.EcoTrackAirconState
    ? window.EcoTrackAirconState.describeAirconState(log.controlSnapshot ?? log.control_snapshot) : { label: 'UNCONFIRMED' };
  if (snapshot.confirmed && snapshot.summary) return snapshot.summary;
  const explicitState = String(log.aircon_state ?? log.acState ?? log.ac_state ?? '').trim().toLowerCase().replace(/[_-]/g, ' ');
  if (explicitState === 'fan only') return 'FAN ONLY';
  if (['active cooling', 'cooling'].includes(explicitState)) return 'ACTIVE COOLING';
  const confirmed = getConfirmedAcOnState(log);
  if (confirmed === false) return 'OFF';
  if (confirmed === true) return 'ON';
  if (snapshot.summary && snapshot.label !== 'UNCONFIRMED') return snapshot.summary;
  return 'STATE NOT RECORDED';
}

// Historical settings come from the state saved with this reading.
function getAnalyticsRecordingPower(log) {
  const api = typeof window !== 'undefined' ? window.EcoTrackAirconState : null;
  const selected = api?.displaySettings?.(log.controlSnapshot ?? log.control_snapshot)?.power;
  if (typeof selected === 'boolean') return selected;
  const value = log.ac_on ?? log.acOn ?? log.power_state ?? log.powerState ?? log.ac_state ?? log.acState;
  if (value === true || value === 1 || ['on','true','1','cooling','active cooling','fan only','running'].includes(String(value).toLowerCase())) return true;
  if (value === false || value === 0 || ['off','false','0','standby','idle','stopped'].includes(String(value).toLowerCase())) return false;
  return null;
}

function getRecordedClimateSettings(log) {
  const api = typeof window !== 'undefined' ? window.EcoTrackAirconState : null;
  const snapshot = api?.parseAirconSnapshot(log.controlSnapshot ?? log.control_snapshot);
  if (!snapshot || !api?.displaySettings) return null;
  return api.displaySettings({
    reported_state: snapshot.reported_state,
    reported_at: snapshot.reported_at,
    observed_remote_state: snapshot.observed_remote_state,
    observed_remote_at: snapshot.observed_remote_at,
    observed_remote_field_at: snapshot.observed_remote_field_at
  });
}

function getRecordedSpecialFunctions(log) {
  const state = getRecordedClimateSettings(log)?.state || {};
  const fields = [
    ['Vertical Swing', state.swing_vertical ?? state.swing],
    ['Horizontal Swing', state.swing_horizontal], ['Turbo', state.turbo],
    ['Eco', state.eco], ['Quiet', state.quiet], ['Sleep', state.sleep],
    ['Display', state.display], ['Clean', state.clean], ['Beep', state.beep], ['I Feel', state.i_feel]
  ];
  return fields.flatMap(([label, value]) => {
    if (value == null) return [];
    const known = String(value).toLowerCase();
    return ['true','on','1'].includes(known) ? [label + ': ON']
      : ['false','off','0'].includes(known) ? [label + ': OFF'] : [];
  }).join(' · ') || 'Unavailable';
}

function getRecordedClimateModes(log) {
  const display = getRecordedClimateSettings(log);
  if (!display) return { mode: 'Unavailable', fan: 'Unavailable' };
  return {
    mode: display.modeLabel === '—' ? 'Unavailable' : display.modeLabel,
    fan: display.fanLabel === '—' ? 'Unavailable'
      : display.fanLabel + (display.state?.turbo === true ? ' · TURBO' : '')
  };
}

function getRuntimeIntervalMs(log, node = {}) {
  const seconds = Number(log.intervalSeconds ?? log.interval_seconds ?? node.interval_seconds);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 3600000);
  const value = Number(log.intervalVal ?? log.interval_val ?? node.interval_val ?? node.intervalVal);
  const unit = String(log.intervalUnit ?? log.interval_unit ?? node.interval_unit ?? node.intervalUnit ?? '').toLowerCase();
  const multiplier = unit.startsWith('sec') ? 1000 : unit.startsWith('min') ? 60000 : (unit.startsWith('hour') || unit.startsWith('hr')) ? 3600000 : 0;
  const calcMs = Number.isFinite(value) && value > 0 && multiplier ? value * multiplier : 900000;
  return Math.min(calcMs, 3600000);
}

function runtimeClockMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(value ?? ''));
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function runtimeDayWindows(day, startMinutes, endMinutes) {
  const nextDay = new Date(day); nextDay.setDate(nextDay.getDate() + 1);
  const begin = day.getTime(), end = nextDay.getTime();
  if (startMinutes === null || endMinutes === null || startMinutes === endMinutes) return [[begin, end]];
  const at = minutes => { const date = new Date(day); date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0); return date.getTime(); };
  return endMinutes > startMinutes ? [[at(startMinutes), at(endMinutes)]] : [[begin, at(endMinutes)], [at(startMinutes), end]];
}

function clipRuntimeSegment(start, end, node = {}) {
  const segments = [];
  const day = new Date(start); day.setHours(0, 0, 0, 0);
  const filterStart = typeof startTimeFilter === 'string' && startTimeFilter.trim() ? runtimeClockMinutes(startTimeFilter) : null;
  const filterEnd = typeof endTimeFilter === 'string' && endTimeFilter.trim() ? runtimeClockMinutes(endTimeFilter) : null;
  while (day.getTime() < end) {
    const nextDay = new Date(day); nextDay.setDate(nextDay.getDate() + 1);
    const dayBoundaryStart = day.getTime();
    const dayBoundaryEnd = nextDay.getTime();
    
    // Day-clipped session boundaries based on exact calendar day timestamps
    const daySegmentStart = Math.max(start, dayBoundaryStart);
    const daySegmentEnd = Math.min(end, dayBoundaryEnd);
    
    if (daySegmentEnd > daySegmentStart) {
      if (filterStart !== null || filterEnd !== null) {
        const filteredWindows = runtimeDayWindows(day, filterStart ?? 0, filterEnd ?? 1440);
        filteredWindows.forEach(([f, t]) => {
          const clippedStart = Math.max(daySegmentStart, f);
          const clippedEnd = Math.min(daySegmentEnd, t);
          if (clippedEnd > clippedStart) segments.push([clippedStart, clippedEnd]);
        });
      } else {
        segments.push([daySegmentStart, daySegmentEnd]);
      }
    }
    day.setDate(day.getDate() + 1);
  }
  return segments;
}

function mergeRuntimeSegments(segments) {
  const merged = [];
  segments.sort((a, b) => a[0] - b[0]).forEach(([start, end]) => {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  });
  return merged;
}

// Ground truth runtime calculation: strictly timestamp-based per unit and partitioned each day
function calculateRuntimeFromLogs(logs) {
  const logsByNode = new Map();
  (logs || []).forEach(log => {
    const originalId = log.nodeId || log.node_id || log.sensor_name;
    const timestamp = new Date(log.timestamp ?? log.created).getTime();
    if (!originalId || !Number.isFinite(timestamp)) return;
    const node = globalNodeRecords.find(n => [n.id, n.name, n.node_id, n.db_id].some(id => id && [originalId, log.controlName, log.sensor_name].includes(id))) || {};
    const id = node.id || originalId;
    if (!logsByNode.has(id)) logsByNode.set(id, { node, samples: [] });
    logsByNode.get(id).samples.push({ log, timestamp });
  });

  const nodeRuntimes = {};
  const dailyNodeRuntimes = {};
  const dailyFacilitySegments = new Map();
  const allFacilitySegments = [];
  let totalRuntimeSum = 0;

  logsByNode.forEach(({ node, samples }, id) => {
    let config = { ...node };
    const readings = [];
    samples.sort((a, b) => a.timestamp - b.timestamp).forEach(sample => {
      const { log } = sample;
      if (Number(log.intervalSeconds ?? log.interval_seconds) > 0) config.interval_seconds = Number(log.intervalSeconds ?? log.interval_seconds);
      if (log.wakeTime ?? log.wake_time) config.wake_time = log.wakeTime ?? log.wake_time;
      if (log.sleepTime ?? log.sleep_time) config.sleep_time = log.sleepTime ?? log.sleep_time;
      if (log.eventType !== 'schedule_updated' && log.event_type !== 'schedule_updated' && String(log.status).toLowerCase() !== 'schedule') readings.push({ ...sample, config: { ...config } });
    });

    const segments = [];
    readings.forEach(({ log, timestamp, config }, index) => {
      if (getConfirmedAcOnState(log) !== true) return;
      const intervalMs = getRuntimeIntervalMs(log, config);
      const next = readings[index + 1];
      const gap = next ? next.timestamp - timestamp : Infinity;
      const dayEnd = new Date(timestamp); dayEnd.setHours(24, 0, 0, 0);
      const maxSessionGap = Math.max(intervalMs * 2.5, 1800000);
      const end = (gap > 0 && gap <= maxSessionGap)
        ? next.timestamp : Math.min(timestamp + intervalMs, dayEnd.getTime());
      const clipped = clipRuntimeSegment(timestamp, end, config);
      segments.push(...clipped);
    });

    const merged = mergeRuntimeSegments(segments);
    const nodeTotalHours = merged.reduce((sum, [start, end]) => sum + end - start, 0) / 3600000;
    nodeRuntimes[id] = nodeTotalHours;
    totalRuntimeSum += nodeTotalHours;
    allFacilitySegments.push(...merged);

    // Group segments by each calendar day based on timestamp
    merged.forEach(([start, end]) => {
      const day = new Date(start); day.setHours(0, 0, 0, 0);
      const dayKey = day.getTime();
      if (!dailyNodeRuntimes[dayKey]) dailyNodeRuntimes[dayKey] = {};
      const hrs = (end - start) / 3600000;
      dailyNodeRuntimes[dayKey][id] = (dailyNodeRuntimes[dayKey][id] || 0) + hrs;

      if (!dailyFacilitySegments.has(dayKey)) dailyFacilitySegments.set(dayKey, []);
      dailyFacilitySegments.get(dayKey).push([start, end]);
    });
  });

  const activeUnits = Object.values(nodeRuntimes).filter(hours => hours > 0).length;

  // Calculate facility active operational hours across each day based on merged timestamp sessions
  let totalFacilityActiveHrs = 0;
  dailyFacilitySegments.forEach((daySegments) => {
    const mergedDay = mergeRuntimeSegments(daySegments);
    const dayFacilityHrs = mergedDay.reduce((sum, [start, end]) => sum + end - start, 0) / 3600000;
    totalFacilityActiveHrs += dayFacilityHrs;
  });

  if (totalFacilityActiveHrs === 0 && allFacilitySegments.length > 0) {
    totalFacilityActiveHrs = mergeRuntimeSegments(allFacilitySegments).reduce((sum, [start, end]) => sum + end - start, 0) / 3600000;
  }

  const mergedAllFacility = mergeRuntimeSegments(allFacilitySegments);
  const facilitySpanHrs = mergedAllFacility.reduce((sum, [start, end]) => sum + end - start, 0) / 3600000;

  return {
    runtimeHrs: totalFacilityActiveHrs || facilitySpanHrs,
    perUnitUtil: activeUnits ? totalRuntimeSum / activeUnits : 0,
    totalRuntimeSum,
    activeUnits,
    nodeRuntimes,
    dailyNodeRuntimes,
    confirmedSegments: allFacilitySegments,
    facilityActiveHrs: facilitySpanHrs
  };
}

// Helper: Calculate previous period date key for comparative trend evaluation
function getPreviousPeriodDateKey(dateKey, period = currentPeriod) {
  if (!dateKey) return null;
  try {
    if (period === 'yearly') {
      const yr = parseInt(dateKey, 10);
      return isNaN(yr) ? null : String(yr - 1);
    }
    if (period === 'monthly') {
      const [y, m] = dateKey.split('-').map(Number);
      const d = new Date(y, m - 1, 1);
      d.setMonth(d.getMonth() - 1);
      const prevY = d.getFullYear();
      const prevM = String(d.getMonth() + 1).padStart(2, '0');
      return `${prevY}-${prevM}`;
    }
    if (period === 'weekly') {
      const [y, m, dNum] = dateKey.split('-').map(Number);
      const d = new Date(y, m - 1, dNum);
      d.setDate(d.getDate() - 7);
      return getPeriodDateKey(d, 'weekly');
    }
    // daily: subtract 1 calendar day
    const [y, m, dNum] = dateKey.split('-').map(Number);
    const d = new Date(y, m - 1, dNum);
    d.setDate(d.getDate() - 1);
    return getPeriodDateKey(d, 'daily');
  } catch (_) {
    return null;
  }
}

// Helper: Get previous period runtime derived from actual telemetry logs
function getPreviousPeriodRuntime(period = currentPeriod) {
  const activeDateKey = selectedDateKey || getDefaultDateKey();
  const prevDateKey = getPreviousPeriodDateKey(activeDateKey, period);
  if (!prevDateKey) return null;

  let prevLogs = nodeDataLogs.filter(log => getPeriodDateKey(log.timestamp, period) === prevDateKey);
  if (currentNodeFilter) {
    prevLogs = prevLogs.filter(log =>
      log.nodeId === currentNodeFilter ||
      log.controlName === currentNodeFilter ||
      (controlNameMap[currentNodeFilter] && controlNameMap[currentNodeFilter] === log.controlName) ||
      (controlNameMap[log.nodeId] && controlNameMap[log.nodeId] === currentNodeFilter)
    );
  }

  if (prevLogs.length === 0) return 0;
  return calculateRuntimeFromLogs(prevLogs).runtimeHrs;
}





let currentPredictionSession = 0;
let predictionAbortController = null;

function getAnalyticsNodeId(log) {
  const id = log.nodeId || log.node_id || log.sensor_name;
  const node = globalNodeRecords.find(n => [n.id, n.name, n.node_id, n.db_id].some(value => value && [id, log.controlName, log.sensor_name].includes(value)));
  return node?.id || id;
}

function getAnalyticsReadings(logs) {
  return (logs || []).filter(log => getAnalyticsNodeId(log) && Number.isFinite(new Date(log.timestamp ?? log.created).getTime()) &&
    log.eventType !== 'schedule_updated' && log.event_type !== 'schedule_updated' && String(log.status).toLowerCase() !== 'schedule');
}

function getAnalyticsCoverage(logs, totalUnits) {
  const readings = getAnalyticsReadings(logs), latest = new Map();
  let confirmedSamples = 0, unknownSamples = 0;
  readings.forEach(log => {
    const id = getAnalyticsNodeId(log), time = new Date(log.timestamp ?? log.created).getTime();
    if (typeof getConfirmedAcOnState(log) === 'boolean') confirmedSamples++;
    else unknownSamples++;
    if (!latest.has(id) || time >= latest.get(id).time) latest.set(id, { time, state: getConfirmedAcOnState(log) });
  });
  let activeUnits = 0, offUnits = 0;
  latest.forEach(({ state }) => { if (state === true) activeUnits++; else if (state === false) offUnits++; });
  totalUnits = Math.max(totalUnits || 0, latest.size);
  return { confirmedSamples, unknownSamples, activeUnits, offUnits, totalUnits,
    knownUnits: activeUnits + offUnits, unknownUnits: Math.max(0, totalUnits - activeUnits - offUnits) };
}

function getPreviousAnalyticsLogs() {
  const key = getPreviousPeriodDateKey(selectedDateKey || getDefaultDateKey(), currentPeriod);
  return nodeDataLogs.filter(log => {
    if (getPeriodDateKey(log.timestamp ?? log.created, currentPeriod) !== key) return false;
    const matchesControl = getAnalyticsNodeId(log) === getAnalyticsNodeId({ nodeId: currentNodeFilter }) ||
      [log.nodeId, log.node_id, log.controlName, controlNameMap[log.nodeId]].includes(currentNodeFilter) ||
      (controlNameMap[currentNodeFilter] && controlNameMap[currentNodeFilter] === log.controlName);
    if (currentNodeFilter && !matchesControl) return false;
    const date = new Date(log.timestamp ?? log.created);
    const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    return (!startTimeFilter || time >= startTimeFilter) && (!endTimeFilter || time <= endTimeFilter);
  });
}

function getAcStateFeatures(filteredLogs) {
  const readings = getAnalyticsReadings(filteredLogs);
  let onCount = 0, offCount = 0;
  readings.forEach(log => { const state = getConfirmedAcOnState(log); if (state === true) onCount++; else if (state === false) offCount++; });
  const runtime = calculateRuntimeFromLogs(readings);
  return { acOnRatio: onCount / (onCount + offCount || 1), hoursUsed: runtime.totalRuntimeSum,
    confirmedCount: onCount + offCount, unknownCount: readings.length - onCount - offCount };
}

// This projection is an explicit assumption about the saved schedule, never device feedback.
function getScheduledEnergyProjection(id, logs, targetDateKey = (selectedDateKey || getDefaultDateKey())) {
  const node = globalNodeRecords.find(record => [record.id, record.name, record.node_id, record.db_id].some(v => v && [id, controlNameMap[id]].includes(v)));
  const wakeTime = node?.wake_time || logs.find(l => l.wakeTime || l.wake_time)?.wakeTime || logs.find(l => l.wakeTime || l.wake_time)?.wake_time;
  const sleepTime = node?.sleep_time || logs.find(l => l.sleepTime || l.sleep_time)?.sleepTime || logs.find(l => l.sleepTime || l.sleep_time)?.sleep_time;
  if (runtimeClockMinutes(wakeTime) === null || runtimeClockMinutes(sleepTime) === null) return null;
  const schedNode = node ? { ...node, wake_time: wakeTime, sleep_time: sleepTime } : { id, wake_time: wakeTime, sleep_time: sleepTime };
  const sorted = [...logs].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  let state = null;
  for (const item of sorted) {
    let snapshot = item?.controlSnapshot ?? item?.control_snapshot;
    if (typeof snapshot === 'string') { try { snapshot = JSON.parse(snapshot); } catch (_) { continue; } }
    const candidate = snapshot?.desired_state || snapshot?.configured_state;
    if (candidate) { state = candidate; break; }
  }
  if (!state || state.power === undefined || state.power === null) return null;
  const mode = String(state.mode || '').toLowerCase();
  if (!['cool', 'dry', 'fan', 'auto', 'heat'].includes(mode)) return null;
  const dateKey = targetDateKey || selectedDateKey || getDefaultDateKey(), parts = (dateKey || '').split('-').map(Number);
  const start = new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1), end = new Date(start);
  if (currentPeriod === 'yearly') end.setFullYear(end.getFullYear() + 1);
  else if (currentPeriod === 'monthly') end.setMonth(end.getMonth() + 1);
  else end.setDate(end.getDate() + (currentPeriod === 'weekly' ? 7 : 1));
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return null;
  const off = state?.power === false || state?.power === 0 || ['off', 'false', '0'].includes(String(state?.power).toLowerCase());
  const segments = off ? [] : clipRuntimeSegment(start.getTime(), end.getTime(), schedNode);
  return { segments, hoursUsed: segments.reduce((sum, [begin, finish]) => sum + finish - begin, 0) / 3600000,
    acOnRatio: off ? 0 : 1, setpoint: state.temp ?? null, mode };
}

function getAnalyticsPeriodHours() {
  const parts = (selectedDateKey || getDefaultDateKey()).split('-').map(Number);
  const start = new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1), end = new Date(start);
  if (currentPeriod === 'yearly') end.setFullYear(end.getFullYear() + 1);
  else if (currentPeriod === 'monthly') end.setMonth(end.getMonth() + 1);
  else end.setDate(end.getDate() + (currentPeriod === 'weekly' ? 7 : 1));
  return (end - start) / 3600000;
}

// Use the same successful per-controller estimates as the forecast energy chart.
function getForecastOperatingMetrics(result) {
  const jobs = result.nodes.filter(job => Number.isFinite(job.kwh));
  let activeUnits = 0, totalRuntimeSum = 0;
  const segments = [];
  jobs.forEach(job => {
    const metrics = job.projection ? { totalRuntimeSum: job.projection.hoursUsed, confirmedSegments: job.projection.segments }
      : calculateRuntimeFromLogs(job.logs);
    totalRuntimeSum += metrics.totalRuntimeSum;
    if (metrics.totalRuntimeSum > 0) activeUnits++;
    segments.push(...metrics.confirmedSegments.map(segment => [...segment]));
  });
  const runtimeHrs = mergeRuntimeSegments(segments).reduce((sum, [start, end]) => sum + end - start, 0) / 3600000;
  return { runtimeHrs, perUnitUtil: activeUnits ? totalRuntimeSum / activeUnits : 0,
    activeUnits, offUnits: jobs.length - activeUnits, knownUnits: jobs.length,
    unknownUnits: Math.max(0, result.coverage.totalUnits - jobs.length), totalUnits: result.coverage.totalUnits };
}

function setAnalyticsText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function setAnalyticsValue(id, value, unitId) {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = value;
    const unavailable = value === 'Unavailable';
    element.style.fontSize = unavailable ? '1.125rem' : '';
  }
  const unit = unitId && document.getElementById(unitId);
  if (unit) unit.style.display = value === 'Unavailable' ? 'none' : '';
}

function updateKpiCardsTrends(period, isSingleNode, kwh, cost, runtimeHrs, activeUnits, totalUnits, idleUnits, capacityPct) {
  const previous = currentAnalyticsResult?.previous;
  const labels = { daily: 'vs previous day', weekly: 'vs previous week', monthly: 'vs previous month', yearly: 'vs previous year' };
  const compare = (id, value, prior, unit) => {
    let text = '--';
    let className = 'font-bold text-slate-500 dark:text-gray-400';
    if (Number.isFinite(value) && Number.isFinite(prior)) {
      const difference = value - prior;
      if (unit === 'hrs') {
        const sign = difference > 0 ? '+' : difference < 0 ? '-' : '';
        text = `${sign}${Math.abs(difference).toFixed(1)} hrs`;
        className = difference < 0 ? 'font-bold text-emerald-500 dark:text-emerald-400' : difference > 0 ? 'font-bold text-cyan-500 dark:text-cyan-400' : 'font-bold text-slate-400';
      } else if (prior > 0) {
        const pct = (difference / prior) * 100;
        const sign = pct > 0 ? '+' : pct < 0 ? '-' : '';
        text = `${sign}${Math.abs(pct).toFixed(1)}%`;
        className = pct < 0 ? 'font-bold text-emerald-500 dark:text-emerald-400' : pct > 0 ? 'font-bold text-amber-500 dark:text-amber-400' : 'font-bold text-slate-400';
      } else {
        text = difference === 0 ? '0.0%' : (difference > 0 ? '+100%' : '0.0%');
        className = 'font-bold text-slate-400';
      }
    } else if (Number.isFinite(value) && (!previous || prior === null || prior === undefined)) {
      text = 'Unavailable';
      className = 'font-bold text-slate-400';
    } else {
      text = 'Unavailable';
      className = 'font-bold text-slate-500 dark:text-gray-400';
    }
    setAnalyticsText(id, text);
    const element = document.getElementById(id);
    if (element) element.className = className;
  };
  compare('kpiEnergyTrend', kwh, previous?.kwh);
  compare('kpiCostTrend', cost, previous?.cost);
  compare('kpiRuntimeTrend', runtimeHrs, previous?.runtime, 'hrs');
  for (const id of ['kpiEnergyTrendLabel', 'kpiCostTrendLabel', 'kpiRuntimeTrendLabel']) setAnalyticsText(id, labels[period] || 'vs previous period');
  setAnalyticsText('kpiUtilizationLabel', `${period.charAt(0).toUpperCase() + period.slice(1)} utilization factor`);
}

function renderEnergyAnalytics(result) {
  const { coverage, kwh, runtime, previous } = result;
  const rate = getActiveTariffRate(), cost = Number.isFinite(kwh) ? calculateEnergyCost(kwh, rate) : null;
  result.cost = cost;
  currentAnalyticsResult = result;
  currentEvaluatedKwh = kwh;
  currentEvaluatedCost = cost;
  const money = value => Number.isFinite(value) ? '₱' + value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'Unavailable';
  const energy = value => Number.isFinite(value) ? value.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : 'Unavailable';
  const operating = result.forecast ? getForecastOperatingMetrics(result) : { ...runtime, ...coverage };
  const partial = result.forecast ? operating.unknownUnits > 0 || result.missingEstimates > 0
    : coverage.unknownUnits > 0 || coverage.unknownSamples > 0 || result.missingEstimates > 0;
  const hasRuntime = result.forecast ? operating.knownUnits > 0 : coverage.confirmedSamples > 0;
  setAnalyticsText('energyConsumption', Number.isFinite(kwh) ? energy(kwh) + ' kWh' : 'Unavailable');
  setAnalyticsValue('kpiEnergyVal', energy(kwh), 'kpiEnergyUnit');
  for (const id of ['kpiCostVal', 'estBillValue', 'costTodayCost', 'costCurrentCycle']) setAnalyticsValue(id, money(cost));
  for (const id of ['kpiCostRate', 'costCardRate']) setAnalyticsText(id, formatTariffRate(rate));
  setAnalyticsText('estBillPeriod', currentPeriod.charAt(0).toUpperCase() + currentPeriod.slice(1));
  setAnalyticsText('costPrevPeriod', previous?.complete ? money(previous.cost) : 'Unavailable');
  setAnalyticsText('costVariance', !result.forecast && !partial && previous?.complete && Number.isFinite(cost) && Number.isFinite(previous.cost)
    ? `${cost >= previous.cost ? '+' : '-'}${money(Math.abs(cost - previous.cost))}` : 'Unavailable');
  setAnalyticsValue('kpiRuntimeVal', hasRuntime ? operating.runtimeHrs.toFixed(1) : 'Unavailable', 'kpiRuntimeUnit');
  setAnalyticsText('kpiUtilization', hasRuntime ? `${operating.perUnitUtil.toFixed(1)} hrs / unit${partial ? ' · partial' : ''}` : 'Unavailable');
  setAnalyticsValue('kpiActiveUnits', operating.knownUnits ? String(operating.activeUnits) : 'Unavailable');
  setAnalyticsText('kpiTotalUnits', operating.knownUnits ? `/${operating.totalUnits}` : '');
  setAnalyticsText('kpiFleetStatusLabel', result.forecast ? '• Planned during selected period'
    : coverage.knownUnits ? `• ${coverage.knownUnits}/${coverage.totalUnits} units have confirmed state` : '• Awaiting AC power feedback');
  setAnalyticsText('kpiIdleUnits', result.forecast ? `${operating.offUnits} planned idle${operating.unknownUnits ? ' · ' + operating.unknownUnits + ' without estimate' : ''}`
    : `${coverage.offUnits} confirmed off · ${coverage.unknownUnits} unknown`);
  const capacity = operating.knownUnits && operating.totalUnits ? operating.activeUnits / operating.totalUnits * 100 : null;
  setAnalyticsText('kpiCapacityPct', Number.isFinite(capacity) ? `${capacity.toFixed(1)}% ${result.forecast ? 'projected active' : 'confirmed active'}` : 'Unavailable');
  setAnalyticsText('kpiRuntimeLabel', result.forecast ? 'FORECAST OPERATING HOURS' : 'FACILITY OPERATIONAL SPAN');
  setAnalyticsText('kpiActiveLabel', result.forecast ? 'FORECAST ACTIVE UNITS' : 'ACTIVE AIRCONS');
  setAnalyticsText('kpiIdleLabel', result.forecast ? 'Forecast Idle Units' : 'Standby / Idle Units');
  const runtimeLabel = document.getElementById('kpiRuntimeLabel');
  if (runtimeLabel) runtimeLabel.title = result.forecast
    ? 'Projected hours with at least one unit scheduled to run. Overlapping unit schedules count once; physical power is unconfirmed.'
    : 'Observed span from confirmed AC-on readings. Utilization sums bounded sessions per unit.';
  const bar = document.getElementById('kpiCapacityBar');
  if (bar) bar.style.width = `${capacity || 0}%`;
  const hours = getAnalyticsPeriodHours();
  setAnalyticsText('kpiAvgLoad', Number.isFinite(kwh) ? `${energy(kwh / (hours || 1))} kW${partial ? ' · partial' : ''}` : 'Unavailable');
  const status = result.forecast
    ? `${result.forecastPartial ? 'Partial schedule-based forecast' : 'Schedule-based forecast'} assuming the saved AC settings are applied; actual power is unconfirmed.`
    : Number.isFinite(kwh) ? partial ? 'Partial estimate from confirmed operating data.' : 'Estimate based on confirmed operating data.' : 'Unavailable: no usable confirmed operating data for this selection.';
  setAnalyticsText('kpiEnergyLabel', result.forecast ? 'FORECAST ENERGY' : 'ESTIMATED ENERGY');
  setAnalyticsText('kpiCostLabel', result.forecast ? 'FORECAST COST' : 'ESTIMATED COST');
  setAnalyticsText('analyticsDataStatus', status);
  setAnalyticsText('aiSuggestion', status);
  updateKpiCardsTrends(currentPeriod, !!currentNodeFilter, kwh, cost, hasRuntime ? runtime.runtimeHrs : null,
    coverage.activeUnits, coverage.totalUnits, coverage.offUnits, capacity);
  updateAnalyticsCharts(kwh, cost);
}

async function predictEnergyConsumption(stats, filteredLogs) {
  const sessionId = ++currentPredictionSession;
  predictionAbortController?.abort();
  const controller = new AbortController();
  predictionAbortController = controller;
  const total = currentNodeFilter ? 1 : getAirconFleetCount().total;
  const periods = [getAnalyticsReadings(filteredLogs), getAnalyticsReadings(getPreviousAnalyticsLogs())];
  const groups = periods.map((logs, periodIdx) => {
    const byNode = new Map();
    logs.forEach(log => { const id = getAnalyticsNodeId(log); if (!byNode.has(id)) byNode.set(id, []); byNode.get(id).push(log); });
    return byNode;
  });

  // Ensure period 1 has all nodes from period 0 so previous period can be evaluated
  groups[0].forEach((_, id) => {
    if (!groups[1].has(id)) groups[1].set(id, []);
  });

  const coverage = getAnalyticsCoverage(periods[0], total);
  const runtime = calculateRuntimeFromLogs(periods[0]);
  const result = { coverage, runtime, kwh: null, nodes: [], missingEstimates: 0, previous: null };
  // Empty or unknown-only selections invalidate pending values immediately.
  if (!periods[0].length && !result.forecast) { renderEnergyAnalytics(result); return; }
  const jobs = groups.flatMap((group, period) => [...group].map(([id, logs]) => ({ id, logs, period, kwh: null })));
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(3, jobs.length) }, async () => {
    while (next < jobs.length && sessionId === currentPredictionSession) {
      const job = jobs[next++];
      let features = getAcStateFeatures(job.logs);
      if (!features.confirmedCount) {
        const targetKey = job.period === 0 ? (selectedDateKey || getDefaultDateKey()) : getPreviousPeriodDateKey(selectedDateKey || getDefaultDateKey(), currentPeriod);
        const projection = getScheduledEnergyProjection(job.id, job.logs, targetKey);
        if (!projection) continue;
        job.projection = projection;
        features = projection;
      }
      if (features.acOnRatio === 0 || features.hoursUsed <= 0) { job.kwh = 0; continue; }
      const temperatures = job.logs.filter(log => job.projection || getConfirmedAcOnState(log) === true)
        .map(log => log.temperature).filter(value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))).map(Number);
      if (!temperatures.length) continue;
      const average = temperatures.reduce((sum, value) => sum + value, 0) / temperatures.length;
      try {
        const response = await fetch(`${BACKEND_URL}/api/predict-energy`, { method: 'POST', signal: controller.signal,
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'xgboost', avg_temp: average,
            period: currentPeriod, ac_on_ratio: features.acOnRatio, hours_used: features.hoursUsed }) });
        if (response.ok) {
          const data = await response.json();
          if (typeof data.kwh === 'number' && Number.isFinite(data.kwh) && data.kwh >= 0) job.kwh = data.kwh;
        }
      } catch (_) {}
    }
  }));
  if (sessionId !== currentPredictionSession || controller.signal.aborted) return;
  result.nodes = jobs.filter(job => job.period === 0);
  result.forecast = result.nodes.some(job => job.projection && Number.isFinite(job.kwh));
  result.forecastPartial = result.nodes.filter(job => Number.isFinite(job.kwh)).length < total;
  result.missingEstimates = result.nodes.filter(job => job.kwh === null).length;
  const estimates = result.nodes.filter(job => Number.isFinite(job.kwh));
  result.kwh = estimates.length ? estimates.reduce((sum, job) => sum + job.kwh, 0) : null;
  const prior = jobs.filter(job => job.period === 1), priorCoverage = getAnalyticsCoverage(periods[1], total);
  const priorKnown = prior.filter(job => Number.isFinite(job.kwh));
  const priorKwh = priorKnown.length ? priorKnown.reduce((sum, job) => sum + job.kwh, 0) : null;
  const priorOperating = result.forecast ? getForecastOperatingMetrics({ nodes: prior, coverage: priorCoverage }) : null;
  const priorRuntime = result.forecast
    ? (priorOperating?.runtimeHrs ?? null)
    : (priorCoverage.confirmedSamples ? calculateRuntimeFromLogs(periods[1]).runtimeHrs : (priorOperating?.runtimeHrs ?? null));
  result.previous = {
    nodes: prior,
    kwh: priorKwh,
    cost: Number.isFinite(priorKwh) ? calculateEnergyCost(priorKwh) : null,
    runtime: priorRuntime,
    complete: priorKnown.length > 0
  };
  renderEnergyAnalytics(result);
}

function getAnalyticsChartSeries(nodes, period) {
  const size = { daily: 9, weekly: 7, monthly: 4, yearly: 12 }[period] || 9;
  const series = new Array(size).fill(null);
  const bucket = log => {
    const date = new Date(log.timestamp ?? log.created);
    if (period === 'yearly') return date.getMonth();
    if (period === 'monthly') return Math.min(3, Math.floor((date.getDate() - 1) / 7));
    if (period === 'weekly') return (date.getDay() + 6) % 7;
    const hour = date.getHours() + date.getMinutes() / 60;
    return [1.5, 4.5, 7.5, 10.5, 13.5, 16.5, 19.5, 22.5, 24.1].findIndex(cutoff => hour < cutoff);
  };
  (nodes || []).forEach(node => {
    if (!Number.isFinite(node.kwh)) return;
    const groups = Array.from({ length: size }, () => []);
    getAnalyticsReadings(node.logs).forEach(log => { if (typeof getConfirmedAcOnState(log) === 'boolean') groups[bucket(log)].push(log); });
    const metrics = node.projection ? { confirmedSegments: node.projection.segments, totalRuntimeSum: node.projection.hoursUsed } : calculateRuntimeFromLogs(node.logs);
    const weights = new Array(size).fill(0);
    for (const segment of metrics.confirmedSegments || []) {
      let [start, end] = segment;
      while (start < end) {
        const date = new Date(start), boundary = new Date(start);
        const index = bucket({ timestamp: date });
        if (period === 'yearly') { boundary.setMonth(boundary.getMonth() + 1, 1); boundary.setHours(0, 0, 0, 0); }
        else if (period === 'monthly') {
          if (index < 3) boundary.setDate((index + 1) * 7 + 1);
          else boundary.setMonth(boundary.getMonth() + 1, 1);
          boundary.setHours(0, 0, 0, 0);
        } else if (period === 'weekly') { boundary.setDate(boundary.getDate() + 1); boundary.setHours(0, 0, 0, 0); }
        else { const minutes = [90, 270, 450, 630, 810, 990, 1170, 1350, 1440][index]; boundary.setHours(0, minutes, 0, 0); }
        const finish = Math.min(end, boundary.getTime());
        if (finish <= start) break;
        weights[index] += (finish - start) / 3600000;
        start = finish;
      }
    }
    const hours = metrics.totalRuntimeSum;
    groups.forEach((logs, index) => {
      if ((!node.projection && !logs.length && weights[index] === 0) || (node.kwh > 0 && !hours)) return;
      const value = hours > 0 ? node.kwh * weights[index] / hours : 0;
      series[index] = (series[index] ?? 0) + value;
    });
  });
  return series;
}




// Convert 24-hour HH:MM time string to 12-Hour Clock (numbers 1-12 with AM/PM)
function formatTime12Hour(timeStr) {
  if (!timeStr) return '';
  const parts = timeStr.split(':');
  if (parts.length < 2) return timeStr;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h)) return timeStr;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  const mStr = isNaN(m) ? '00' : String(m).padStart(2, '0');
  return `${h12}:${mStr} ${period}`;
}

// Get date range text (including active time filters formatted in 12-Hour Clock)
function getDateRangeText() {
  const baseLabel = getPeriodDateLabel(selectedDateKey || getDefaultDateKey(), currentPeriod);
  if (startTimeFilter && endTimeFilter) {
    return `${baseLabel} (${formatTime12Hour(startTimeFilter)} - ${formatTime12Hour(endTimeFilter)})`;
  } else if (startTimeFilter) {
    return `${baseLabel} (From ${formatTime12Hour(startTimeFilter)})`;
  } else if (endTimeFilter) {
    return `${baseLabel} (Until ${formatTime12Hour(endTimeFilter)})`;
  }
  return baseLabel;
}

// Update active filter badge in header
function updateActiveFilterBadge(filteredCount) {
  const badgeEl = document.getElementById('activeFilterText');
  if (!badgeEl) return;

  const controlLabel = currentNodeFilter ? (controlNameMap[currentNodeFilter] || currentNodeFilter) : 'All Controls';
  const dateLabel = getDateRangeText();
  const countStr = typeof filteredCount === 'number' ? ` • ${filteredCount} logs` : '';
  badgeEl.textContent = `${controlLabel} • ${dateLabel}${countStr}`;
}

// Render the page
function render({ preserveScroll = false } = {}) {
  populateDateRangeOptions();
  
  const history = getFilteredLogs();
  const filtered = history.filter(log => getAnalyticsRecordingPower(log) === true);
  const stats = calculateStats();

  updateActiveFilterBadge(filtered.length);
  
  console.log('Filtered logs:', filtered.length, 'from total:', nodeDataLogs.length);
  
  // Update title
  const titleMap = {
    daily: 'Daily Logs',
    weekly: 'Weekly Logs',
    monthly: 'Monthly Logs',
    yearly: 'Yearly Logs'
  };
  document.getElementById('logsTitle').textContent = titleMap[currentPeriod];

  // Update statistics
  document.getElementById('totalRecords').textContent = filtered.length;
  document.getElementById('avgTemp').textContent = stats.avgTemp === '--' ? '--°C' : `${stats.avgTemp}°C`;
  document.getElementById('avgPressure').textContent = stats.onlineNodes || '--';
  
  // Predict energy consumption (also updates estimated bill card)
  predictEnergyConsumption(stats, history);
  
  // Render table rows
  const tbody = document.getElementById('logsTableBody');
  if (tbody) {
    const scrollContainer = tbody.closest('.overflow-y-auto');
    if (scrollContainer && currentPage === 1 && !preserveScroll) scrollContainer.scrollTop = 0;
  }
  
  if (filtered.length === 0) {
    currentPage = 1;
    const pageInfo = document.getElementById('pageInfo');
    if (pageInfo) pageInfo.textContent = 'Showing 0 of 0 logs';
    const prevPageBtn = document.getElementById('prevPageBtn');
    const nextPageBtn = document.getElementById('nextPageBtn');
    if (prevPageBtn) prevPageBtn.disabled = true;
    if (nextPageBtn) nextPageBtn.disabled = true;

    tbody.innerHTML = `
      <tr>
        <td colspan="13" class="px-6 py-12 text-center">
          <div class="flex flex-col items-center justify-center max-w-md mx-auto">
            <div class="w-14 h-14 rounded-2xl bg-teal-500/10 dark:bg-teal-500/15 text-teal-600 dark:text-teal-400 border border-teal-500/30 flex items-center justify-center mb-3 shadow-xs">
              <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
              </svg>
            </div>
            <h4 class="font-bold text-sm text-slate-800 dark:text-gray-200 mb-1">No AC Operating Logs for This Interval</h4>
            <p class="text-xs text-slate-500 dark:text-gray-400 mb-4 leading-relaxed">
              No AC operating readings match these filters. Readings are recorded while the AC power setting is ON.
            </p>
            <div class="flex items-center gap-2">
              <button type="button" onclick="const todayBtn = document.getElementById('filterTodayBtn'); if (todayBtn) todayBtn.click(); else if (typeof applyFilters === 'function') applyFilters();" class="px-3.5 py-1.5 rounded-xl bg-teal-500/15 hover:bg-teal-500/25 text-teal-600 dark:text-teal-400 border border-teal-500/30 text-xs font-bold transition-all cursor-pointer">
                Jump to Today's Logs
              </button>
              <button type="button" onclick="const resetBtn = document.getElementById('resetFiltersBtn'); if (resetBtn) resetBtn.click();" class="px-3.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 text-slate-700 dark:text-gray-300 border border-slate-200 dark:border-white/10 text-xs font-bold transition-all cursor-pointer">
                Clear Filters
              </button>
            </div>
          </div>
        </td>
      </tr>
    `;
    return;
  }
  
  // Pagination
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE) || 1;
  if (currentPage > totalPages) currentPage = totalPages;
  
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const paginatedLogs = filtered.slice(startIndex, startIndex + PAGE_SIZE);

  // Update page info
  const pageInfo = document.getElementById('pageInfo');
  if (pageInfo) {
    pageInfo.textContent = `Showing ${filtered.length === 0 ? 0 : startIndex + 1}-${Math.min(startIndex + PAGE_SIZE, filtered.length)} of ${filtered.length}`;
  }
  
  // Enable/Disable buttons
  const prevPageBtn = document.getElementById('prevPageBtn');
  const nextPageBtn = document.getElementById('nextPageBtn');
  if (prevPageBtn) prevPageBtn.disabled = currentPage === 1;
  if (nextPageBtn) nextPageBtn.disabled = currentPage >= totalPages;

  // Use DocumentFragment to batch DOM operations for better performance
  const fragment = document.createDocumentFragment();
  
  paginatedLogs.forEach(log => {
    const row = document.createElement('tr');
    row.className = 'hover:bg-gray-50 dark:hover:bg-slate-900 transition-colors text-sm text-gray-700 dark:text-gray-300 font-medium';
    
    const timestampStr = log.timestamp.toLocaleString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
    
    const roomName = log.roomName || locationMap[log.nodeId]?.roomName || 'Unassigned';
    const floorName = log.floorName || locationMap[log.nodeId]?.floorName || 'Unassigned';
    const buildingName = log.buildingName || locationMap[log.nodeId]?.buildingName || 'Unassigned';
    const controlName = log.controlName || controlNameMap[log.nodeId] || log.nodeId;
    
    const acType = log.airconType || globalAirconMap[log.nodeId] || 'Unknown';
    
    const temperature = log.temperature == null ? null : Number(log.temperature);
    const climateModes = getRecordedClimateModes(log);
    const modeClass = climateModes.mode === 'Unavailable' ? 'text-slate-400 dark:text-slate-500' : 'text-[#10b981] dark:text-emerald-400';
    const fanClass = climateModes.fan === 'Unavailable' ? 'text-slate-400 dark:text-slate-500' : 'text-[#18392B] dark:text-cyan-400';
    
    const isOnline = String(log.status).toLowerCase() === 'online';
    const statusText = log.eventType === 'schedule_updated' ? `Interval set: ${log.intervalSeconds}s` : isOnline ? 'Online' : 'Offline';
    const statusClass = isOnline ? 'text-green-600 dark:text-emerald-400 font-bold' : 'text-red-500 dark:text-rose-400 font-bold';
    
    // Convert battery voltage to percentage matching Telemetry (4.2V = 100%)
    const batteryPercent = getBatteryPercentage(log.battery);
    
    row.innerHTML = `
      <td class="px-6 py-4">${timestampStr}</td>
      <td class="px-6 py-4 font-bold text-[#18392B] dark:text-cyan-400">${controlName}</td>
      <td class="px-6 py-4 font-bold text-[#10b981] dark:text-emerald-400">${buildingName}</td>
      <td class="px-6 py-4 font-bold text-[#10b981] dark:text-emerald-400">${floorName}</td>
      <td class="px-6 py-4 font-bold text-[#10b981] dark:text-emerald-400">${roomName}</td>
      <td class="px-6 py-4 font-bold text-[#18392B] dark:text-cyan-400 whitespace-nowrap">${acType}</td>
      <td class="px-6 py-4 font-bold ${modeClass} whitespace-nowrap">${climateModes.mode}</td>
      <td class="px-6 py-4 font-bold ${fanClass} whitespace-nowrap">${climateModes.fan}</td>
      <td class="px-6 py-4 text-xs leading-relaxed min-w-[16rem] max-w-xs">${getRecordedSpecialFunctions(log)}</td>
      <td class="px-6 py-4">${temperature == null ? 'Unavailable' : `${Math.round(temperature)}°C`}</td>
      <td class="px-6 py-4">
        <span class="font-bold text-[#18392B] dark:text-cyan-400">${batteryPercent}%</span>
      </td>
      <td class="px-6 py-4">
        ${getSignalIcon(log.rssi)}
      </td>
      <td class="px-6 py-4 ${statusClass}">${statusText}</td>
    `;
    
    fragment.appendChild(row);
  });
  
  tbody.replaceChildren(fragment);
}
// ── REDESIGNED EXECUTIVE EXCEL (XLSX) EXPORT ──
async function exportExcelLogs() {
  const filtered = getFilteredLogs().filter(log => getAnalyticsRecordingPower(log) === true);
  if (!filtered.length) {
    if (window.EcoToast) window.EcoToast.warning('No logs available for export.');
    else alert('No logs available for export.');
    return;
  }

  if (typeof ExcelJS === 'undefined') {
    if (window.EcoToast) window.EcoToast.info('ExcelJS library is loading. Please try again in a moment.');
    else alert('ExcelJS library is loading. Please try again in a moment.');
    return;
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'EcoTrack Intelligent Building System';
  workbook.created = new Date();

  const rate = getActiveTariffRate();
  const provider = getUtilityProvider();
  const budget = getTargetBudget();
  const stats = calculateStats();
  const energyValueEl = document.getElementById('energyConsumption');
  const energyKwh = currentEvaluatedKwh;
  const totalCost = calculateEnergyCost(energyKwh, rate);
  const periodLabel = currentPeriod.charAt(0).toUpperCase() + currentPeriod.slice(1);
  const controlFilterLabel = currentNodeFilter ? (controlNameMap[currentNodeFilter] || currentNodeFilter) : 'All Monitored Aircons';
  const exportDateStr = new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });
  const dateRangeStr = getDateRangeText();

  // ═════════════════════════════════════════════════════════════════════
  // SHEET 1: EXECUTIVE ANALYTICS & TARIFF SUMMARY
  // ═════════════════════════════════════════════════════════════════════
  const summarySheet = workbook.addWorksheet('Analytics & Summary');

  // Title Banner
  summarySheet.mergeCells('A1:G1');
  const sTitle = summarySheet.getCell('A1');
  sTitle.value = 'ECOTRACK™ — AIRCON ENERGY ANALYTICS & UTILITY REPORT';
  sTitle.font = { name: 'Calibri', size: 15, bold: true, color: { argb: 'FFFFFFFF' } };
  sTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B291D' } };
  sTitle.alignment = { vertical: 'middle', horizontal: 'center' };
  summarySheet.getRow(1).height = 36;

  // Subtitle Banner
  summarySheet.mergeCells('A2:G2');
  const sSubtitle = summarySheet.getCell('A2');
  sSubtitle.value = 'Confidential Enterprise Telemetry, Power Consumption & Electricity Tariff Expenditure Audit';
  sSubtitle.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FFFFFFFF' } };
  sSubtitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF10B981' } };
  sSubtitle.alignment = { vertical: 'middle', horizontal: 'center' };
  summarySheet.getRow(2).height = 20;

  summarySheet.getRow(3).height = 12;

  // Metadata Table
  summarySheet.mergeCells('A4:G4');
  const sMetaH = summarySheet.getCell('A4');
  sMetaH.value = '1. AUDIT PARAMETERS & SCOPE';
  sMetaH.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF0B291D' } };
  summarySheet.getRow(4).height = 22;

  const metaRows = [
    ['Generated Timestamp', exportDateStr],
    ['Observation Interval', `${periodLabel} Audit (${currentPeriod.toUpperCase()})`],
    ['Observation Date Scope', dateRangeStr],
    ['Active Electricity Tariff', `PHP ${formatAnalyticsNumber(rate)} / kWh`],
    ['Utility Provider', provider],
    ['Target Aircon Scope', controlFilterLabel],
    ['Total Records Audited', `${filtered.length} telemetry readings`]
  ];

  metaRows.forEach((r, idx) => {
    const rowNum = 5 + idx;
    summarySheet.mergeCells(`A${rowNum}:B${rowNum}`);
    summarySheet.mergeCells(`C${rowNum}:G${rowNum}`);
    const c1 = summarySheet.getCell(`A${rowNum}`);
    const c2 = summarySheet.getCell(`C${rowNum}`);
    c1.value = r[0];
    c1.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF475569' } };
    c1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
    c2.value = r[1];
    c2.font = { name: 'Calibri', size: 10, color: { argb: 'FF0F172A' }, bold: idx === 3 || idx === 1 };
  });

  // KPI Section
  const kpiRowStart = 13;
  summarySheet.mergeCells(`A${kpiRowStart}:G${kpiRowStart}`);
  const sKpiH = summarySheet.getCell(`A${kpiRowStart}`);
  sKpiH.value = '2. EXECUTIVE ENERGY & FLEET KPIS';
  sKpiH.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF0B291D' } };
  summarySheet.getRow(kpiRowStart).height = 24;

  const kpiHeaders = [
    'METRIC NAME',
    'VALUE',
    'UNIT',
    'BENCHMARK / TARIFF',
    'STATUS / ASSESSMENT'
  ];
  const kpiHRow = summarySheet.getRow(kpiRowStart + 1);
  kpiHeaders.forEach((h, i) => {
    const cell = kpiHRow.getCell(i + 1);
    cell.value = h;
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF10B981' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  kpiHRow.height = 22;

  const kpiRows = [
    ['Total Energy Consumed', formatAnalyticsNumber(energyKwh, 1), 'kWh', 'Nominal Load', 'Active Fleet Draw'],
    ['Estimated Electricity Cost', Number.isFinite(totalCost) ? `₱${totalCost.toFixed(2)}` : 'Unavailable', 'PHP (₱)', `₱${formatAnalyticsNumber(rate)}/kWh (${provider})`, 'Projected Invoiced'],
    ['Total Aircon Runtime', document.getElementById('kpiRuntimeVal')?.textContent || '0.0', 'Hours', 'Fleet Total', 'Active Operations'],
    ['Average Room Temperature', stats.avgTemp !== '--' ? `${stats.avgTemp}` : '--', '°C', '24°C - 26°C Optimal', stats.avgTemp <= 26 ? 'Comfortable' : 'Elevated Load'],
    ['Online Aircon Units', stats.onlineNodes || 'Unavailable', 'Units', '100% Target', 'Hardware Synced']
  ];

  kpiRows.forEach((r, idx) => {
    const row = summarySheet.getRow(kpiRowStart + 2 + idx);
    r.forEach((v, i) => {
      const cell = row.getCell(i + 1);
      cell.value = v;
      cell.font = { name: 'Calibri', size: 10, color: { argb: 'FF0F172A' } };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
      };
      if (i >= 1 && i <= 3) cell.alignment = { horizontal: 'center' };
    });
  });

  // Auto-fit Sheet 1 columns
  summarySheet.columns = [
    { width: 30 },
    { width: 22 },
    { width: 14 },
    { width: 30 },
    { width: 22 },
    { width: 16 },
    { width: 16 }
  ];

  // ═════════════════════════════════════════════════════════════════════
  // SHEET 2: DETAILED AIRCON TELEMETRY LOGS
  // ═════════════════════════════════════════════════════════════════════
  const logsSheet = workbook.addWorksheet('Aircon Telemetry Logs');

  // Title Banner
  logsSheet.mergeCells('A1:M1');
  const lTitle = logsSheet.getCell('A1');
  lTitle.value = 'ECOTRACK™ — AIRCON HARDWARE & TELEMETRY AUDIT LOGS';
  lTitle.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  lTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B291D' } };
  lTitle.alignment = { vertical: 'middle', horizontal: 'center' };
  logsSheet.getRow(1).height = 32;

  // Table Headers
  const logHeaders = [
    'Timestamp', 'Control Name', 'Building', 'Floor', 'Room',
    'Attached Aircon Type', 'Operating Mode', 'Blower Fan Mode', 'Special Functions', 'Temperature (°C)',
    'Battery Level (%)', 'RSSI (dBm)', 'Hardware Status'
  ];
  const lHRow = logsSheet.getRow(3);
  lHRow.values = logHeaders;
  lHRow.height = 24;

  lHRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF10B981' } };
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF0B291D' } },
      bottom: { style: 'thin', color: { argb: 'FF0B291D' } },
      left: { style: 'thin', color: { argb: 'FF0B291D' } },
      right: { style: 'thin', color: { argb: 'FF0B291D' } }
    };
  });

  filtered.forEach((log) => {
    const roomName = log.roomName || locationMap[log.nodeId]?.roomName || 'Unassigned';
    const floorName = log.floorName || locationMap[log.nodeId]?.floorName || 'Unassigned';
    const buildingName = log.buildingName || locationMap[log.nodeId]?.buildingName || 'Unassigned';
    const sName = log.controlName || controlNameMap[log.nodeId] || log.nodeId;
    const acType = log.airconType || globalAirconMap[log.nodeId] || 'Unknown';
    const ts = new Date(log.timestamp).toLocaleString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });

    const temp = log.temperature == null ? null : Number(log.temperature);
    const climateModes = getRecordedClimateModes(log);

    const batteryPercent = getBatteryPercentage(log.battery);
    const row = logsSheet.addRow([
      ts, sName, buildingName, floorName, roomName,
      acType, climateModes.mode, climateModes.fan, getRecordedSpecialFunctions(log), temp == null ? 'Unavailable' : Math.round(temp), `${batteryPercent}%`, log.rssi, log.status.toUpperCase()
    ]);

    row.eachCell((cell, colNum) => {
      cell.font = { name: 'Calibri', size: 10, color: { argb: 'FF0F172A' } };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
      };

      if ([1, 7, 8, 10, 11, 12, 13].includes(colNum)) {
        cell.alignment = { horizontal: 'center' };
      }

      if (colNum === 7 && climateModes.mode === 'COOL') {
        cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF059669' } };
      }

      if (colNum === 9) cell.alignment = { vertical: 'top', wrapText: true };
      if (colNum === 13) {
        const isOnline = String(log.status).toLowerCase() === 'online';
        cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: isOnline ? 'FF10B981' : 'FFE11D48' } };
      }
    });
  });

  logsSheet.columns.forEach((column) => {
    let maxLen = 12;
    column.eachCell({ includeEmpty: true }, (cell, rowNumber) => {
      if (rowNumber >= 3 && cell.value) {
        const len = cell.value.toString().length;
        if (len > maxLen) maxLen = len;
      }
    });
    column.width = Math.min(maxLen + 3, 35);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const link = document.createElement('a');
  const dateRangeFileStr = getDateRangeText().replace(/ /g, '_').replace(/,/g, '');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', `EcoTrack_Aircon_Analytics_${currentPeriod}_${dateRangeFileStr}.xlsx`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

async function exportLogs() {
  const rawFiltered = getFilteredLogs().filter(log => getAnalyticsRecordingPower(log) === true);

  if (!rawFiltered || rawFiltered.length === 0) {
    if (window.EcoToast) window.EcoToast.warning('No data to export.');
    else alert('No data to export');
    return;
  }

  // Ensure all logs have valid Date instances for timestamp to avoid method call TypeErrors
  const filtered = rawFiltered.map(l => ({
    ...l,
    timestamp: l.timestamp instanceof Date ? l.timestamp : new Date(l.timestamp || l.created || Date.now())
  }));

  try {
    // ── DESIGN CONSTANTS ──────────────────────────────────────────────
    const DARK_GREEN  = [11, 41, 29];
    const ACCENT      = [16, 185, 129];
    const WHITE       = [255, 255, 255];
    const LIGHT_GRAY  = [249, 250, 251];
    const DARK_TEXT   = [24, 57, 43];
    const MARGIN      = 14;

    const jsPDFClass = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
    if (!jsPDFClass) {
      if (window.EcoToast) window.EcoToast.error('jsPDF library is not loaded. Please refresh the page.');
      else alert('jsPDF library is not loaded. Please refresh the page.');
      return;
    }
    const doc = new jsPDFClass({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const generatedAt = new Date();
    const generatedStr = generatedAt.toLocaleString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
      hour: 'numeric', minute: '2-digit', second: '2-digit',
      hour12: true
    });
    const dateRangeText = getDateRangeText();
    const periodLabel = currentPeriod.charAt(0).toUpperCase() + currentPeriod.slice(1);
    const controlFilterLabel = currentNodeFilter
      ? (controlNameMap[currentNodeFilter] || currentNodeFilter)
      : 'All Controls';

    // ── HELPER: Compute log row values ────────────────────────────────
    const logRow = (log) => {
      const ts = new Date(log.timestamp).toLocaleString('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });
      const room = log.roomName || locationMap[log.nodeId]?.roomName || 'Unassigned';
      const floor = log.floorName || locationMap[log.nodeId]?.floorName || 'Unassigned';
      const building = log.buildingName || locationMap[log.nodeId]?.buildingName || 'Unassigned';
      const name = log.controlName || controlNameMap[log.nodeId] || log.nodeId;
      const acType = log.airconType || globalAirconMap[log.nodeId] || 'Unknown';
      const temp = Number(log.temperature) || 0;
      const batP = getBatteryPercentage(log.battery);
      const rssiV = parseInt(log.rssi);
      const rssiP = Math.min(100, Math.max(0, ((rssiV + 120) / 120) * 100));
      const climateModes = getRecordedClimateModes(log);
      const status = log.status.charAt(0).toUpperCase() + log.status.slice(1);
      return { ts, name, building, floor,
               room, type: acType, mode: climateModes.mode, fan: climateModes.fan, specials: getRecordedSpecialFunctions(log), temp, batP, rssiP, status };
    };

    // ── HELPER: Add header & footer on EVERY page (skipping Cover Page) ─────────────────────
    function addHeaderFooter() {
      const totalPages = doc.internal.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        if (i === 1) continue; // Skip cover page
        doc.setPage(i);
        // Header
        doc.setDrawColor(...ACCENT);
        doc.setLineWidth(0.5);
        doc.line(MARGIN, 10, pageW - MARGIN, 10);
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 116, 139); // Slate-500
        doc.text('EcoTrack™ Aircon Energy Analytics & Utility Audit Report', MARGIN, 8);
        doc.text(`Interval: ${periodLabel} Audit | Generated: ${generatedStr}`, pageW - MARGIN, 8, { align: 'right' });
        // Footer
        doc.setDrawColor(229, 231, 235);
        doc.setLineWidth(0.3);
        doc.line(MARGIN, pageH - 10, pageW - MARGIN, pageH - 10);
        doc.text(`Active Tariff: PHP ${formatAnalyticsNumber(getActiveTariffRate())}/kWh (${getUtilityProvider()})`, MARGIN, pageH - 6);
        doc.text(`Page ${i} of ${totalPages}`, pageW - MARGIN, pageH - 6, { align: 'right' });
      }
    }

    // ── HELPER: Add table explanation note ─────────────────────────────
    function addTableExplanation(explanation, yPos) {
      if (!yPos && doc.lastAutoTable) yPos = doc.lastAutoTable.finalY;
      if (!yPos) return 0;
      doc.setFontSize(8);
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(100, 100, 100);
      const splitText = doc.splitTextToSize('Note: ' + explanation, pageW - MARGIN * 2);
      doc.text(splitText, MARGIN, yPos + 5);
      return yPos + 5 + (splitText.length * 4);
    }

    // ── HELPER: Draw KPI card ─────────────────────────────────────────
    function drawKpiCard(x, y, w, h, label, value, indicatorColor) {
      // White background card
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(x, y, w, h, 3, 3, 'F');
      
      // Light grey border
      doc.setDrawColor(229, 231, 235); // Gray-200
      doc.setLineWidth(0.3);
      doc.roundedRect(x, y, w, h, 3, 3, 'S');
      
      // Left vertical accent strip
      doc.setFillColor(...indicatorColor);
      doc.rect(x + 0.5, y + 3, 2.5, h - 6, 'F'); 
      
      // Value (bold, dark, left-aligned)
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(17, 24, 39); // Slate-900
      doc.text(String(value), x + 7, y + 13);
      
      // Label (small, grey, left-aligned, wrapped)
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(107, 114, 128); // Gray-500
      const splitLabel = doc.splitTextToSize(label, w - 11);
      doc.text(splitLabel, x + 7, y + 20);
    }

    // ── HELPER: Section title ─────────────────────────────────────────
    function sectionTitle(baseText, y) {
      const text = currentNodeFilter ? `${baseText} — ${controlFilterLabel}` : baseText;
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...DARK_TEXT);
      doc.text(text, MARGIN, y);
      doc.setDrawColor(...ACCENT);
      doc.setLineWidth(0.5);
      const textWidth = doc.getTextWidth(text);
      doc.line(MARGIN, y + 2, MARGIN + textWidth, y + 2);
      return y + 8;
    }

    // ── HELPER: Render Chart.js to data URL ───────────────────────────
    function renderChart(config, width, height) {
      return new Promise((resolve) => {
        try {
          if (typeof Chart === 'undefined') {
            resolve('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=');
            return;
          }
          const canvas = document.createElement('canvas');
          canvas.width = width || 700;
          canvas.height = height || 350;
          canvas.style.position = 'fixed';
          canvas.style.left = '-9999px';
          document.body.appendChild(canvas);
          const ctx = canvas.getContext('2d');
          config.options = config.options || {};
          config.options.animation = false;
          config.options.responsive = false;
          config.options.devicePixelRatio = 2;
          const chart = new Chart(ctx, config);
          setTimeout(() => {
            try {
              const dataUrl = canvas.toDataURL('image/png');
              chart.destroy();
              if (canvas.parentNode) document.body.removeChild(canvas);
              resolve(dataUrl);
            } catch (err) {
              console.warn('Canvas toDataURL failed:', err);
              if (canvas.parentNode) document.body.removeChild(canvas);
              resolve('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=');
            }
          }, 150);
        } catch (e) {
          console.warn('renderChart error caught:', e);
          resolve('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=');
        }
      });
    }

    // ── Pre-compute common data ───────────────────────────────────────
    const stats = calculateStats();
    const { acOnRatio, hoursUsed } = getAcStateFeatures(filtered);
    const temps = filtered.map(l => Number(l.temperature) || 0);
    const batteries = filtered.map(l => getBatteryPercentage(l.battery));
    const rssis = filtered.map(l => {
      const v = parseInt(l.rssi);
      return Math.min(100, Math.max(0, ((v + 120) / 120) * 100));
    });

    let acActive = 0, acFan = 0, acOff = 0, onlineCount = 0, offlineCount = 0;
    filtered.forEach(l => {
      const state = getDisplayAcState(l).split(' · ')[0];
      if (state === 'FAN ONLY') acFan++;
      else if (state === 'ACTIVE COOLING' || state === 'ON') acActive++;
      else if (state === 'OFF' || state === 'OFF / STANDBY') acOff++;
      if (l.status === 'online') onlineCount++;
      else offlineCount++;
    });

    const uniqueNodes = new Set(filtered.map(l => l.nodeId));
    const onlineNodes = new Set(filtered.filter(l => l.status === 'online').map(l => l.nodeId));
    const offlineNodes = new Set([...uniqueNodes].filter(n => !onlineNodes.has(n)));

    const avgBat = batteries.length ? (batteries.reduce((a, b) => a + b, 0) / batteries.length) : 0;
    const avgRssi = rssis.length ? (rssis.reduce((a, b) => a + b, 0) / rssis.length) : 0;

    // ══════════════════════════════════════════════════════════════════
    // PAGE 1 — COVER PAGE (Modern Executive Aircon Energy Audit)
    // ══════════════════════════════════════════════════════════════════
    // Left Sidebar Panel
    doc.setFillColor(...DARK_GREEN);
    doc.rect(0, 0, 95, pageH, 'F');
    doc.setFillColor(...ACCENT);
    doc.rect(0, pageH - 8, 95, 8, 'F');

    // Logo & Branding in Left Panel
    doc.setFontSize(26);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255);
    doc.text('EcoTrack', 18, 50);

    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...ACCENT);
    doc.text('AIRCON ENERGY ANALYTICS', 18, 57);

    // Sidebar divider
    doc.setDrawColor(...ACCENT);
    doc.setLineWidth(0.4);
    doc.line(18, 62, 75, 62);

    // Sidebar description
    doc.setFontSize(9.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(200, 200, 200);
    const sidebarText = doc.splitTextToSize(
      'Automated air conditioning power consumption forecasting, thermal monitoring telemetry, and flexible electricity tariff audit.',
      60
    );
    doc.text(sidebarText, 18, 70);

    // Right Sidebar Content
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...ACCENT);
    doc.text('EXECUTIVE UTILITY AUDIT REPORT', 110, 38);

    doc.setFontSize(24);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...DARK_GREEN);
    doc.text('Aircon Energy Analytics', 110, 48);

    doc.setFontSize(10.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139); // Gray-500
    doc.text('Enterprise telemetry audit of aircon compressor states, thermal comfort, and electricity expenditure.', 110, 56);

    // Report Parameters Table
    doc.autoTable({
      startY: 68,
      margin: { left: 110, right: MARGIN },
      theme: 'plain',
      styles: { 
        fontSize: 9, 
        cellPadding: 4.5, 
        textColor: [55, 65, 81],
        lineColor: [243, 244, 246],
        lineWidth: 0.2
      },
      body: [
        ['Report Scope', 'Aircon Energy Analytics & Fleet Audit'],
        ['Observation Interval', `${periodLabel} Audit (${currentPeriod.toUpperCase()})`],
        ['Date Range Scope', dateRangeText],
        ['Active Tariff Rate', `PHP ${formatAnalyticsNumber(getActiveTariffRate())} / kWh`],
        ['Utility Provider', getUtilityProvider()],
        ['Target Aircon Scope', controlFilterLabel],
        ['Total Audit Logs', `${filtered.length} telemetry readings`],
        ['Generated At', generatedStr],
        ['System Audit Status', 'All Aircon Controls Audited']
      ],
      columnStyles: { 
        0: { fontStyle: 'bold', cellWidth: 42, textColor: [100, 116, 139] }, 
        1: { textColor: [17, 24, 39] } 
      }
    });

    // ══════════════════════════════════════════════════════════════════
    // PAGE 2 — CONTROL LOCATION DETAILS
    // ══════════════════════════════════════════════════════════════════
    doc.addPage();
    let curY = sectionTitle('Control Location Details', 20);

    const controlRows = [];
    uniqueNodes.forEach(nid => {
      const loc = locationMap[nid] || { buildingName: 'Unknown', floorName: 'Unknown', roomName: 'Unknown' };
      const lastLog = filtered.filter(l => l.nodeId === nid).sort((a, b) => b.timestamp - a.timestamp)[0];
      const monitorStatus = lastLog ? (lastLog.status === 'online' ? 'Active' : 'Inactive') : 'Unknown';
      const controlStatus = lastLog ? (lastLog.status.charAt(0).toUpperCase() + lastLog.status.slice(1)) : 'Unknown';
      controlRows.push([
        controlNameMap[nid] || nid,
        nid,
        loc.buildingName,
        loc.floorName,
        loc.roomName,
        globalAirconMap[nid] || 'Unknown',
        monitorStatus,
        controlStatus
      ]);
    });

    doc.autoTable({
      startY: curY,
      margin: { left: MARGIN, right: MARGIN },
      head: [['Control Name', 'Control ID', 'Building', 'Floor', 'Room', 'Attached Aircon Type', 'Monitoring Status', 'Control Status']],
      body: controlRows,
      theme: 'striped',
      styles: { fontSize: 8.5, cellPadding: 3.5, textColor: [55, 65, 81], lineColor: [229, 231, 235], lineWidth: 0.1 },
      headStyles: { fillColor: DARK_GREEN, textColor: WHITE, fontStyle: 'bold', fontSize: 8.5, cellPadding: 4 },
      alternateRowStyles: { fillColor: [249, 250, 251] },
      didParseCell: function(data) {
        if (data.section === 'body') {
          if (data.column.index === 6) {
            const val = String(data.cell.raw || '');
            data.cell.styles.textColor = val === 'Active' ? ACCENT : [239, 68, 68];
            data.cell.styles.fontStyle = 'bold';
          } else if (data.column.index === 7) {
            const val = String(data.cell.raw || '');
            data.cell.styles.textColor = val === 'Online' ? ACCENT : [239, 68, 68];
            data.cell.styles.fontStyle = 'bold';
          }
        }
      }
    });

    // ══════════════════════════════════════════════════════════════════
    // PAGE 3 — MONITORING SUMMARY (EXECUTIVE DASHBOARD REDESIGN)
    // ══════════════════════════════════════════════════════════════════
    doc.addPage();
    curY = sectionTitle('Monitoring Summary', 20);

    const energyText = document.getElementById('energyConsumption')?.textContent || '-- kWh';
    const activeCoolHrs = filtered.length > 0
      ? ((acActive / filtered.length) * hoursUsed).toFixed(1)
      : '0.0';

    // ── Estimated Bill for PDF (matches selected period) ──
    const pdfEnergyKwh = currentEvaluatedKwh;
    const currentTariffRate = getActiveTariffRate();
    const pdfEstBill = calculateEnergyCost(pdfEnergyKwh, currentTariffRate);
    const fmtP = (v) => !Number.isFinite(v) ? 'Unavailable' : 'PHP ' + v.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // Subtitle under Section Header
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text(`Executive Energy & Operational Telemetry Audit  •  Scope: ${controlFilterLabel}  •  Period: ${periodLabel.toUpperCase()}`, MARGIN, curY - 1);
    curY += 5;

    // ── 1. TOP HERO KPI CARDS (4 Highlight Banners) ──
    const heroGap = 6;
    const heroW = (pageW - MARGIN * 2 - heroGap * 3) / 4;
    const heroH = 26;
    const heroStartX = MARGIN;

    const heroCards = [
      { label: 'Total Energy Consumption', value: energyText, sub: `Active ${periodLabel} Period`, color: [16, 185, 129] },
      { label: `Projected ${periodLabel} Utility Bill`, value: fmtP(pdfEstBill), sub: `@ ₱${formatAnalyticsNumber(currentTariffRate)} / kWh`, color: [245, 158, 11] },
      { label: 'Compressor Active Cooling', value: `${activeCoolHrs} hrs`, sub: `${((acActive / Math.max(1, filtered.length)) * 100).toFixed(1)}% Active Load`, color: [59, 130, 246] },
      { label: 'Fleet Online Coverage', value: `${onlineNodes.size} / ${uniqueNodes.size} Online`, sub: `${uniqueNodes.size > 0 ? ((onlineNodes.size / uniqueNodes.size) * 100).toFixed(0) : 100}% Fleet Health`, color: [13, 148, 136] }
    ];

    heroCards.forEach((c, i) => {
      const hx = heroStartX + i * (heroW + heroGap);
      // Card background
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(hx, curY, heroW, heroH, 2.5, 2.5, 'F');
      doc.setDrawColor(229, 231, 235);
      doc.setLineWidth(0.3);
      doc.roundedRect(hx, curY, heroW, heroH, 2.5, 2.5, 'S');

      // Top colored accent line
      doc.setFillColor(...c.color);
      doc.rect(hx + 0.5, curY + 0.5, heroW - 1, 2, 'F');

      // Value with dynamic font scaling
      const valStr = String(c.value);
      doc.setFontSize(valStr.length > 15 ? 10.5 : valStr.length > 11 ? 12 : 13.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(17, 24, 39);
      doc.text(valStr, hx + 5, curY + 11.5);

      // Label
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(75, 85, 99);
      doc.text(c.label, hx + 5, curY + 17.5);

      // Subtitle
      doc.setFontSize(6.8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(156, 163, 175);
      doc.text(c.sub, hx + 5, curY + 22.5);
    });

    curY += heroH + 8;

    // ── 2. THREE STRUCTURED DOMAIN PANELS ──
    const panelGap = 6;
    const panelW = (pageW - MARGIN * 2 - panelGap * 2) / 3;
    const panelH = 74;
    const panelStartX = MARGIN;

    const domainPanels = [
      {
        title: 'ENERGY & TARIFF ASSESSMENT',
        headerColor: [16, 185, 129],
        rows: [
          ['Total Period Energy', energyText],
          ['Configured Tariff', `PHP ${formatAnalyticsNumber(currentTariffRate)} / kWh`],
          ['Estimated Period Cost', fmtP(pdfEstBill)],
          ['Hourly Energy Intensity', `${formatAnalyticsNumber(Number.isFinite(pdfEnergyKwh) ? pdfEnergyKwh / Math.max(1, hoursUsed) : null)} kWh/hr`],
          ['Evaluation Timeframe', `${periodLabel} (${hoursUsed.toFixed(1)} hrs)`]
        ]
      },
      {
        title: 'OPERATIONAL FLEET INTEGRITY',
        headerColor: [59, 130, 246],
        rows: [
          ['Monitored Units', `${uniqueNodes.size} Aircon Controller(s)`],
          ['Fleet Online Availability', `${uniqueNodes.size > 0 ? ((onlineNodes.size / uniqueNodes.size) * 100).toFixed(0) : 100}% (${onlineNodes.size} online)`],
          ['Cumulative AC Runtime', `${(document.getElementById('kpiRuntimeVal')?.textContent || hoursUsed.toFixed(1))} hrs`],
          ['Average Unit Utilization', `${document.getElementById('kpiUtilization')?.textContent || (hoursUsed > 0 ? (hoursUsed / Math.max(1, onlineNodes.size)).toFixed(1) + ' hrs' : '--')}`],
          ['Offline Incident Count', `${offlineCount} telemetry alerts`]
        ]
      },
      {
        title: 'THERMAL & TELEMETRY HEALTH',
        headerColor: [139, 92, 246],
        rows: [
          ['Mean Ambient Temperature', stats.avgTemp === '--' ? '--' : stats.avgTemp + '°C'],
          ['Telemetry Samples Logged', `${stats.totalRecords.toLocaleString()} records`],
          ['Mean Sensor Battery', `${avgBat.toFixed(1)}% (${avgBat >= 60 ? 'Healthy' : 'Check'})`],
          ['Wireless Signal (RSSI)', `${avgRssi.toFixed(1)}% (${avgRssi >= 60 ? 'Optimal' : 'Fair'})`],
          ['Sensor Active Duty Cycle', `${filtered.length > 0 ? '100% synchronized' : '--'}`]
        ]
      }
    ];

    domainPanels.forEach((p, idx) => {
      const px = panelStartX + idx * (panelW + panelGap);

      // Container
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(px, curY, panelW, panelH, 2.5, 2.5, 'F');
      doc.setDrawColor(229, 231, 235);
      doc.setLineWidth(0.3);
      doc.roundedRect(px, curY, panelW, panelH, 2.5, 2.5, 'S');

      // Top banner
      doc.setFillColor(248, 250, 252);
      doc.rect(px + 0.5, curY + 0.5, panelW - 1, 10, 'F');
      doc.setFillColor(...p.headerColor);
      doc.rect(px + 0.5, curY + 0.5, 2.5, 10, 'F');

      // Panel Title
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 41, 59);
      doc.text(p.title, px + 6, curY + 7);

      // Divider under header
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.2);
      doc.line(px, curY + 10.5, px + panelW, curY + 10.5);

      // Rows
      let rowY = curY + 16.5;
      p.rows.forEach(([label, val], rIdx) => {
        // Alternating row background
        if (rIdx % 2 === 1) {
          doc.setFillColor(249, 250, 251);
          doc.rect(px + 1, rowY - 4.5, panelW - 2, 8.5, 'F');
        }

        // Label
        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 116, 139);
        doc.text(label, px + 5, rowY);

        // Value
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(17, 24, 39);
        const valWidth = doc.getTextWidth(String(val));
        doc.text(String(val), px + panelW - 5 - valWidth, rowY);

        rowY += 10.5;
      });
    });

    curY += panelH + 7;

    // ── 3. EXECUTIVE AUDIT SUMMARY CALLOUT ──
    const summaryBoxW = pageW - MARGIN * 2;
    const summaryBoxH = 18;
    doc.setFillColor(240, 253, 244); // emerald-50
    doc.roundedRect(MARGIN, curY, summaryBoxW, summaryBoxH, 2, 2, 'F');
    doc.setDrawColor(187, 247, 208); // emerald-200
    doc.setLineWidth(0.3);
    doc.roundedRect(MARGIN, curY, summaryBoxW, summaryBoxH, 2, 2, 'S');

    // Left green accent
    doc.setFillColor(...DARK_GREEN);
    doc.rect(MARGIN + 0.5, curY + 0.5, 2.5, summaryBoxH - 1, 'F');

    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...DARK_GREEN);
    doc.text('EXECUTIVE OPERATIONAL OBSERVATION', MARGIN + 6, curY + 6.5);

    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(51, 65, 85);
    const summaryMsg = `This report includes ${filtered.length} telemetry records for the selected period. Energy: ${energyText}. Electricity tariff: ${formatTariffRate(currentTariffRate, 'PHP ')}. Missing measurements and unavailable estimates are excluded from calculations.`;
    const summaryLines = doc.splitTextToSize(summaryMsg, summaryBoxW - 12);
    doc.text(summaryLines, MARGIN + 6, curY + 11.5);

    // ══════════════════════════════════════════════════════════════════
    // PAGE 4 — INITIAL & FINAL CONTROL READINGS
    // ══════════════════════════════════════════════════════════════════
    doc.addPage();
    curY = sectionTitle('Initial & Final Control Readings', 20);

    const sorted = [...filtered].sort((a, b) => a.timestamp - b.timestamp);
    const firstLog = sorted[0];
    const lastLog = sorted[sorted.length - 1];

    function readingTable(log, title, startY) {
      const r = logRow(log);
      doc.setFontSize(10.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...DARK_GREEN);
      doc.text(title, MARGIN, startY);
      doc.autoTable({
        startY: startY + 3,
        margin: { left: MARGIN, right: MARGIN },
        theme: 'striped',
        styles: { fontSize: 8, cellPadding: 3, textColor: [55, 65, 81], lineColor: [229, 231, 235], lineWidth: 0.1 },
        headStyles: { fillColor: DARK_GREEN, textColor: WHITE, fontStyle: 'bold', fontSize: 8, cellPadding: 4 },
        head: [['Timestamp', 'Control', 'Building', 'Floor', 'Room', 'Attached Aircon Type', 'Operating Mode', 'Blower Fan Mode', 'Special Functions', 'Temp', 'Battery', 'RSSI', 'Status']],
        body: [[r.ts, r.name, r.building, r.floor, r.room, r.type, r.mode, r.fan, r.specials,
                r.temp.toFixed(0) + '°C',
                r.batP.toFixed(0) + '%', r.rssiP.toFixed(0) + '%', r.status]]
      });
      return (doc.lastAutoTable?.finalY ?? (startY + 25)) + 10;
    }

    curY = readingTable(firstLog, 'First Recorded Reading', curY);
    readingTable(lastLog, 'Last Recorded Reading', curY);

    // ══════════════════════════════════════════════════════════════════
    // PAGE 5 — CONTROL AGGREGATION SUMMARY
    // ══════════════════════════════════════════════════════════════════
    doc.addPage();
    let curY5 = sectionTitle('Control Aggregation Summary', 20);

    const controlAggMap = {};
    filtered.forEach(log => {
      const sName = controlNameMap[log.nodeId] || log.nodeId;
      if (!controlAggMap[sName]) {
        controlAggMap[sName] = { name: sName, temps: [], acOn: 0, count: 0 };
      }
      controlAggMap[sName].temps.push(log.temperature);
      if (log.acState === 'ACTIVE COOLING') controlAggMap[sName].acOn++;
      controlAggMap[sName].count++;
    });

    const summaryBody = Object.values(controlAggMap).map(s => {
      const avgTemp = s.temps.reduce((a, b) => a + b, 0) / s.temps.length;
      const maxTemp = Math.max(...s.temps);
      const acRatio = (s.acOn / s.count) * 100;
      return [
        s.name,
        avgTemp.toFixed(0) + '°C',
        maxTemp.toFixed(0) + '°C',
        acRatio.toFixed(0) + '%',
        s.count.toString()
      ];
    });

    doc.autoTable({
      startY: curY5,
      margin: { left: MARGIN, right: MARGIN },
      head: [['Control Name', 'Average Temp', 'Peak Temp', 'AC Active (%)', 'Total Readings']],
      body: summaryBody,
      theme: 'striped',
      styles: { fontSize: 8.5, cellPadding: 3.5, textColor: [55, 65, 81], lineColor: [229, 231, 235], lineWidth: 0.1 },
      headStyles: { fillColor: DARK_GREEN, textColor: WHITE, fontStyle: 'bold', fontSize: 8.5, cellPadding: 4 },
      alternateRowStyles: { fillColor: [249, 250, 251] }
    });

    // ══════════════════════════════════════════════════════════════════
    // NEXT PAGE — ENVIRONMENTAL ANALYSIS
    // ══════════════════════════════════════════════════════════════════
    doc.addPage();
    curY = sectionTitle('Environmental Analysis', 20);

    const minTemp = Math.min(...temps);
    const maxTemp = Math.max(...temps);
    const avgTempVal = temps.reduce((a, b) => a + b, 0) / temps.length;

    // Temperature Analysis (Left Table)
    doc.autoTable({
      startY: curY,
      margin: { left: MARGIN, right: pageW / 2 + 5 },
      head: [['Temperature Analysis', 'Value']],
      body: [
        ['Average Temperature', avgTempVal.toFixed(0) + '°C'],
        ['Minimum Temperature', minTemp.toFixed(0) + '°C'],
        ['Maximum Temperature', maxTemp.toFixed(0) + '°C']
      ],
      theme: 'striped',
      styles: { fontSize: 8.5, cellPadding: 3.5, textColor: [55, 65, 81], lineColor: [229, 231, 235], lineWidth: 0.1 },
      headStyles: { fillColor: DARK_GREEN, textColor: WHITE, fontStyle: 'bold', fontSize: 8.5, cellPadding: 4 },
      alternateRowStyles: { fillColor: [249, 250, 251] }
    });
    const leftTableY = doc.lastAutoTable?.finalY ?? (curY + 25);

    // Operational Analysis (Right Table)
    doc.autoTable({
      startY: curY,
      margin: { left: pageW / 2 + 5, right: MARGIN },
      head: [['Operational Analysis', 'Count']],
      body: [
        ['Active Cooling Events', acActive],
        ['Fan Only Events', acFan],
        ['AC Off Events', acOff],
        ['Online Events', onlineCount],
        ['Offline Events', offlineCount]
      ],
      theme: 'striped',
      styles: { fontSize: 8.5, cellPadding: 3.5, textColor: [55, 65, 81], lineColor: [229, 231, 235], lineWidth: 0.1 },
      headStyles: { fillColor: DARK_GREEN, textColor: WHITE, fontStyle: 'bold', fontSize: 8.5, cellPadding: 4 },
      alternateRowStyles: { fillColor: [249, 250, 251] }
    });
    const rightTableY = doc.lastAutoTable?.finalY ?? (curY + 25);

    let afterOps = Math.max(leftTableY, rightTableY) + 8;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(75, 85, 99); // Gray-600
    const interpText = `Summary: Temperature ranged from ${minTemp.toFixed(0)}°C to ${maxTemp.toFixed(0)}°C (avg ${avgTempVal.toFixed(0)}°C). ` +
      `Active cooling was engaged for ${acActive} out of ${filtered.length} events (${((acActive / filtered.length) * 100).toFixed(1)}%).`;
    const interpLines = doc.splitTextToSize(interpText, pageW - MARGIN * 2);
    doc.text(interpLines, MARGIN, afterOps);

    // ══════════════════════════════════════════════════════════════════
    // NEXT PAGES — VISUAL ANALYTICS (Charts)
    // ══════════════════════════════════════════════════════════════════
    const chartLabels = filtered.map((l, i) => {
      if (filtered.length <= 30) {
        return l.timestamp.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
      }
      // sample labels for readability
      return i % Math.ceil(filtered.length / 20) === 0
        ? l.timestamp.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', hour12: true })
        : '';
    });

    const lineOpts = (label, data, color) => ({
      type: 'line',
      data: {
        labels: chartLabels,
        datasets: [{
          label, data, borderColor: color, backgroundColor: color + '33',
          fill: true, tension: 0.3, pointRadius: filtered.length > 50 ? 0 : 2, borderWidth: 2
        }]
      },
      options: {
        plugins: { legend: { display: true }, title: { display: false } },
        scales: { x: { ticks: { maxRotation: 45, autoSkip: true, maxTicksLimit: 15 } } }
      }
    });

    const doughnutOpts = (label, labels, data, colors) => ({
      type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: '#fff' }] },
      options: {
        plugins: {
          legend: { display: true, position: 'bottom' },
          title: { display: false }
        }
      }
    });

    const getDynLabel = (lbl) => currentNodeFilter ? `${lbl} — ${controlFilterLabel}` : lbl;

    // ── AC Energy Analytics Chart Data Computation (kWh & PHP) ──
    const tariffRate = getActiveTariffRate();
    let trendLabels = [];
    let energyValues = [];
    let baselineValues = [];

    trendLabels = {
      daily: ['12 AM', '3 AM', '6 AM', '9 AM', '12 PM', '3 PM', '6 PM', '9 PM', '12 M'],
      weekly: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      monthly: ['Week 1', 'Week 2', 'Week 3', 'Week 4'],
      yearly: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    }[currentPeriod];
    energyValues = getAnalyticsChartSeries(currentAnalyticsResult?.nodes, currentPeriod);
    baselineValues = getAnalyticsChartSeries(currentAnalyticsResult?.previous?.nodes, currentPeriod);
    const costValues = energyValues.map(value => calculateEnergyCost(value, tariffRate));
    const costBaselineValues = baselineValues.map(value => calculateEnergyCost(value, tariffRate));

    const analyticsChartOpts = (title, lbls, data, baseline, color, unit, yLabel) => {
      const maxVal = Math.max(...data, 0);
      const datasets = [
        {
          type: 'bar',
          label: `${title} (${unit || 'kWh'})`,
          data: data,
          backgroundColor: data.map(v => v === maxVal && v > 0 ? 'rgba(245, 158, 11, 0.85)' : (color ? `${color}cc` : 'rgba(16, 185, 129, 0.75)')),
          borderColor: data.map(v => v === maxVal && v > 0 ? '#d97706' : (color || '#059669')),
          borderWidth: 1.5,
          borderRadius: 4
        }
      ];
      if (baseline && baseline.length > 0) {
        datasets.push({
          type: 'line',
          label: 'Period Baseline',
          data: baseline,
          borderColor: '#94a3b8',
          borderDash: [5, 5],
          borderWidth: 1.5,
          fill: false,
          pointRadius: 0
        });
      }
      return {
        type: 'bar',
        data: {
          labels: lbls,
          datasets: datasets
        },
        options: {
          plugins: {
            legend: { display: true, position: 'top', labels: { font: { size: 9, weight: 'bold' }, boxWidth: 16 } },
            title: { display: false }
          },
          scales: {
            x: { grid: { display: false }, ticks: { font: { size: 8.5 } } },
            y: {
              title: { display: true, text: yLabel || `${title} (${unit || 'kWh'})`, font: { size: 8.5, weight: 'bold' } },
              grid: { color: 'rgba(0,0,0,0.06)' },
              ticks: { font: { size: 8.5 }, callback: (v) => v + ' ' + (unit || 'kWh') },
              beginAtZero: true
            }
          }
        }
      };
    };

    const dualAxisChartOpts = (lbls, kwhData, phpData) => {
      const maxPhp = Math.max(...phpData, 0);
      return {
        data: {
          labels: lbls,
          datasets: [
            {
              type: 'bar',
              label: 'Utility Cost (PHP)',
              data: phpData,
              backgroundColor: phpData.map(v => v === maxPhp && v > 0 ? 'rgba(245, 158, 11, 0.85)' : 'rgba(16, 185, 129, 0.7)'),
              borderColor: phpData.map(v => v === maxPhp && v > 0 ? '#d97706' : '#059669'),
              borderWidth: 1.5,
              borderRadius: 4,
              yAxisID: 'yCost',
              barPercentage: 0.55
            },
            {
              type: 'line',
              label: 'Energy Consumption (kWh)',
              data: kwhData,
              borderColor: '#06b6d4',
              backgroundColor: '#06b6d4',
              borderWidth: 2.5,
              fill: false,
              tension: 0.35,
              pointBackgroundColor: '#ffffff',
              pointBorderColor: '#06b6d4',
              pointBorderWidth: 2.5,
              pointRadius: 4,
              yAxisID: 'yEnergy'
            }
          ]
        },
        options: {
          plugins: {
            legend: {
              display: true,
              position: 'top',
              labels: { font: { size: 9.5, weight: 'bold' }, boxWidth: 16 }
            },
            title: { display: false }
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { font: { size: 9, weight: 'bold' } }
            },
            yEnergy: {
              type: 'linear',
              position: 'left',
              title: { display: true, text: 'Energy (kWh)', font: { size: 9, weight: 'bold' }, color: '#0891b2' },
              grid: { color: 'rgba(0,0,0,0.06)' },
              ticks: { font: { size: 8.5 }, color: '#0891b2' },
              beginAtZero: true
            },
            yCost: {
              type: 'linear',
              position: 'right',
              title: { display: true, text: 'Utility Cost (PHP)', font: { size: 9, weight: 'bold' }, color: '#d97706' },
              grid: { display: false },
              ticks: { font: { size: 8.5 }, color: '#d97706', callback: (v) => 'PHP ' + v },
              beginAtZero: true
            }
          }
        }
      };
    };

    const costBarChartOpts = (title, lbls, data) => {
      const maxVal = Math.max(...data, 0);
      return {
        type: 'bar',
        data: {
          labels: lbls,
          datasets: [{
            label: 'Estimated Cost (PHP)',
            data: data,
            backgroundColor: data.map(v => v === maxVal && v > 0 ? '#f59e0b' : 'rgba(16, 185, 129, 0.75)'),
            borderColor: data.map(v => v === maxVal && v > 0 ? '#d97706' : '#059669'),
            borderWidth: 1.5,
            borderRadius: 4
          }]
        },
        options: {
          plugins: {
            legend: { display: true, position: 'top', labels: { font: { size: 9, weight: 'bold' }, boxWidth: 16 } },
            title: { display: false }
          },
          scales: {
            x: { grid: { display: false }, ticks: { font: { size: 8.5 } } },
            y: {
              title: { display: true, text: 'Utility Cost (PHP)', font: { size: 8.5, weight: 'bold' } },
              grid: { color: 'rgba(0,0,0,0.06)' },
              ticks: { font: { size: 8.5 }, callback: (v) => 'PHP ' + v },
              beginAtZero: true
            }
          }
        }
      };
    };

    // Render charts: Dual-Axis, Energy Trend, Cost Breakdown, Temp, AC Distribution, Control Status
    const [dualAxisImg, energyTrendImg, costTrendImg, tempChart, acChart, statusChart] = await Promise.all([
      renderChart(dualAxisChartOpts(trendLabels, energyValues, costValues), 800, 320),
      renderChart(analyticsChartOpts('AC Energy Consumption', trendLabels, energyValues, baselineValues, '#10b981', 'kWh', 'Consumption (kWh)'), 750, 340),
      renderChart(costBarChartOpts('Estimated Utility Cost', trendLabels, costValues), 750, 340),
      renderChart(lineOpts(getDynLabel('Ambient Temperature Trend Over Time (°C)'), temps, '#10b981'), 800, 320),
      renderChart(doughnutOpts(getDynLabel('Aircon State Distribution'),
        ['Active Cooling', 'Fan Only', 'Off'], [acActive, acFan, acOff],
        ['#10b981', '#f59e0b', '#ef4444']), 500, 360),
      renderChart(doughnutOpts(getDynLabel('Control Status Distribution'),
        ['Online', 'Offline'], [onlineCount, offlineCount],
        ['#10b981', '#ef4444']), 500, 360)
    ]);

    // ══════════════════════════════════════════════════════════════════
    // PAGE 7 — AC ENERGY & UTILITY COST ANALYTICS (EXECUTIVE PRESENTATION)
    // ══════════════════════════════════════════════════════════════════
    doc.addPage();
    let chartPageY = sectionTitle('AC Energy & Utility Cost Analytics', 20);

    // Subtitle
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text(`Scope: ${controlFilterLabel}  •  Observation Interval: ${periodLabel.toUpperCase()}  •  Utility Tariff: PHP ${formatAnalyticsNumber(tariffRate)}/kWh (${getUtilityProvider()})`, MARGIN, chartPageY - 1);
    chartPageY += 5;

    // Top 4 Mini KPI Strip
    const miniGap = 5;
    const miniW = (pageW - MARGIN * 2 - miniGap * 3) / 4;
    const miniH = 16;
    const peakKwh = energyValues.some(Number.isFinite) ? Math.max(...energyValues.filter(Number.isFinite)) : null;
    const peakCost = costValues.some(Number.isFinite) ? Math.max(...costValues.filter(Number.isFinite)) : null;
    const peakIdx = energyValues.indexOf(peakKwh);
    const peakTimeLabel = peakIdx !== -1 ? trendLabels[peakIdx] : '--';

    const miniKpis = [
      { label: `Total Period Energy`, val: `${formatAnalyticsNumber(pdfEnergyKwh, 1)} kWh`, color: [16, 185, 129] },
      { label: `Peak Interval Demand`, val: `${formatAnalyticsNumber(peakKwh, 1)} kWh (${peakTimeLabel})`, color: [13, 148, 136] },
      { label: `Projected Electricity Bill`, val: fmtP(pdfEstBill), color: [245, 158, 11] },
      { label: `Configured Electricity Rate`, val: `PHP ${formatAnalyticsNumber(tariffRate)}/kWh`, color: [59, 130, 246] }
    ];

    miniKpis.forEach((m, mi) => {
      const mx = MARGIN + mi * (miniW + miniGap);
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(mx, chartPageY, miniW, miniH, 2, 2, 'F');
      doc.setDrawColor(229, 231, 235);
      doc.setLineWidth(0.2);
      doc.roundedRect(mx, chartPageY, miniW, miniH, 2, 2, 'S');

      // Top accent
      doc.setFillColor(...m.color);
      doc.rect(mx + 0.5, chartPageY + 0.5, miniW - 1, 1.5, 'F');

      const valStr = String(m.val);
      doc.setFontSize(valStr.length > 15 ? 9.5 : 10.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(17, 24, 39);
      doc.text(valStr, mx + 4, chartPageY + 8.5);

      doc.setFontSize(6.8);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(100, 116, 139);
      doc.text(m.label, mx + 4, chartPageY + 13.5);
    });

    chartPageY += miniH + 6;

    // Dual-Axis Chart Container Card
    const fullChartW = pageW - MARGIN * 2;
    const dualChartH = 48;
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(MARGIN, chartPageY, fullChartW, dualChartH + 8, 2.5, 2.5, 'F');
    doc.setDrawColor(229, 231, 235);
    doc.setLineWidth(0.3);
    doc.roundedRect(MARGIN, chartPageY, fullChartW, dualChartH + 8, 2.5, 2.5, 'S');

    doc.setFontSize(9.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...DARK_GREEN);
    doc.text('Synchronized Dual-Axis Telemetry — Energy Consumption (kWh) vs. Utility Expenditure (PHP)', MARGIN + 6, chartPageY + 5.5);

    doc.addImage(dualAxisImg, 'PNG', MARGIN + 2, chartPageY + 7, fullChartW - 4, dualChartH);

    chartPageY += dualChartH + 11;

    // Structured Interval Breakdown Table
    const intervalTableRows = trendLabels.map((lbl, idx) => {
      const kwh = energyValues[idx];
      const base = baselineValues[idx];
      const cost = costValues[idx];
      const variance = Number.isFinite(kwh) && base > 0 ? (((kwh - base) / base) * 100).toFixed(1) : 'Unavailable';
      const varianceStr = variance === 'Unavailable' ? variance : (parseFloat(variance) > 0 ? `+${variance}%` : `${variance}%`);
      const isPeak = kwh === peakKwh && kwh > 0;
      const statusStr = !Number.isFinite(kwh) ? 'Unavailable' : isPeak ? 'PEAK DEMAND' : 'Estimated';
      return [
        lbl,
        `${formatAnalyticsNumber(kwh)} kWh`,
        `${formatAnalyticsNumber(base)} kWh`,
        varianceStr,
        `PHP ${formatAnalyticsNumber(tariffRate)}/kWh`,
        fmtP(cost),
        statusStr
      ];
    });

    doc.autoTable({
      startY: chartPageY,
      margin: { left: MARGIN, right: MARGIN },
      head: [['Interval Timeframe', 'Energy Draw (kWh)', 'Period Baseline', 'Baseline Variance', 'Effective Tariff', 'Computed Cost (PHP)', 'Interval Status']],
      body: intervalTableRows,
      theme: 'striped',
      styles: { fontSize: 7, cellPadding: 1.8, textColor: [55, 65, 81], lineColor: [229, 231, 235], lineWidth: 0.1 },
      headStyles: { fillColor: DARK_GREEN, textColor: WHITE, fontStyle: 'bold', fontSize: 7.2, cellPadding: 2.5 },
      alternateRowStyles: { fillColor: [249, 250, 251] },
      didParseCell: function(data) {
        if (data.section === 'body') {
          if (data.column.index === 3) {
            const raw = String(data.cell.raw || '');
            if (raw.startsWith('+')) {
              data.cell.styles.textColor = [217, 119, 6];
              data.cell.styles.fontStyle = 'bold';
            } else {
              data.cell.styles.textColor = ACCENT;
            }
          } else if (data.column.index === 6) {
            const val = String(data.cell.raw || '');
            if (val === 'PEAK DEMAND') {
              data.cell.styles.textColor = [217, 119, 6];
              data.cell.styles.fontStyle = 'bold';
            } else if (val === 'NOMINAL LOAD') {
              data.cell.styles.textColor = ACCENT;
              data.cell.styles.fontStyle = 'bold';
            } else {
              data.cell.styles.textColor = [100, 116, 139];
            }
          }
        }
      }
    });

    let afterTableY = (doc.lastAutoTable?.finalY ?? curY) + 4;
    if (afterTableY < pageH - 28) {
      const analCalloutW = pageW - MARGIN * 2;
      const analCalloutH = 14;
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(MARGIN, afterTableY, analCalloutW, analCalloutH, 2, 2, 'F');
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.3);
      doc.roundedRect(MARGIN, afterTableY, analCalloutW, analCalloutH, 2, 2, 'S');

      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 41, 59);
      doc.text('ENERGY LOAD OBSERVATION & TARIFF IMPACT', MARGIN + 5, afterTableY + 4.5);

      doc.setFontSize(7);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(71, 85, 105);
      const analMsg = `Energy charts include available estimates for the selected period. Peak interval consumption of ${formatAnalyticsNumber(peakKwh, 1)} kWh corresponds to ${fmtP(peakCost)} in utility expenditure. Dashed indicators use available estimates from the previous period.`;
      const analLines = doc.splitTextToSize(analMsg, analCalloutW - 10);
      doc.text(analLines, MARGIN + 5, afterTableY + 9);
    }

    // ══════════════════════════════════════════════════════════════════
    // PAGE 8 — COMPONENT TRENDS & OPERATIONAL DISTRIBUTIONS
    // ══════════════════════════════════════════════════════════════════
    doc.addPage();
    let distPageY = sectionTitle('Visual Analytics — Energy Profiles & Status Distributions', 20);

    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text(`Independent energy load profiles, utility cost distributions, and controller availability`, MARGIN, distPageY - 1);
    distPageY += 5;

    // Two side-by-side component charts
    const chartW = (pageW - MARGIN * 2 - 10) / 2;
    const compChartH = 58;

    // Chart 1: Energy Trend
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(MARGIN, distPageY, chartW, compChartH + 8, 2.5, 2.5, 'F');
    doc.setDrawColor(229, 231, 235);
    doc.setLineWidth(0.3);
    doc.roundedRect(MARGIN, distPageY, chartW, compChartH + 8, 2.5, 2.5, 'S');

    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...DARK_GREEN);
    doc.text('AC Energy Consumption Trend (kWh)', MARGIN + 6, distPageY + 5.5);

    doc.addImage(energyTrendImg, 'PNG', MARGIN + 3, distPageY + 7, chartW - 6, compChartH - 1);

    // Chart 2: Cost Trend
    const chart2X = MARGIN + chartW + 10;
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(chart2X, distPageY, chartW, compChartH + 8, 2.5, 2.5, 'F');
    doc.setDrawColor(229, 231, 235);
    doc.setLineWidth(0.3);
    doc.roundedRect(chart2X, distPageY, chartW, compChartH + 8, 2.5, 2.5, 'S');

    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(180, 83, 9);
    doc.text('Estimated Utility Cost Distribution (PHP)', chart2X + 6, distPageY + 5.5);

    doc.addImage(costTrendImg, 'PNG', chart2X + 3, distPageY + 7, chartW - 6, compChartH - 1);

    distPageY += compChartH + 12;

    // Two Doughnuts Side-by-side
    const doughW = (pageW - MARGIN * 2 - 10) / 2;
    const doughH = 54;

    // Doughnut 1: AC State
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(MARGIN, distPageY, doughW, doughH + 8, 2.5, 2.5, 'F');
    doc.setDrawColor(229, 231, 235);
    doc.setLineWidth(0.3);
    doc.roundedRect(MARGIN, distPageY, doughW, doughH + 8, 2.5, 2.5, 'S');

    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...DARK_GREEN);
    doc.text(getDynLabel('Aircon Operational State Distribution'), MARGIN + 6, distPageY + 5.5);
    doc.addImage(acChart, 'PNG', MARGIN + 4, distPageY + 7, doughW - 8, doughH - 1);

    // Doughnut 2: Control Status
    const dough2X = MARGIN + doughW + 10;
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(dough2X, distPageY, doughW, doughH + 8, 2.5, 2.5, 'F');
    doc.setDrawColor(229, 231, 235);
    doc.setLineWidth(0.3);
    doc.roundedRect(dough2X, distPageY, doughW, doughH + 8, 2.5, 2.5, 'S');

    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...DARK_GREEN);
    doc.text(getDynLabel('Control Node Availability Distribution'), dough2X + 6, distPageY + 5.5);
    doc.addImage(statusChart, 'PNG', dough2X + 4, distPageY + 7, doughW - 8, doughH - 1);

    distPageY += doughH + 11;

    // Bottom Duty Cycle Observation Box
    const dutyCalloutW = pageW - MARGIN * 2;
    const dutyCalloutH = 13;
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(MARGIN, distPageY, dutyCalloutW, dutyCalloutH, 2, 2, 'F');
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.roundedRect(MARGIN, distPageY, dutyCalloutW, dutyCalloutH, 2, 2, 'S');

    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 41, 59);
    doc.text('OPERATIONAL DUTY CYCLE & FLEET EFFICIENCY', MARGIN + 5, distPageY + 4.5);

    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text(`Active cooling duty cycle accounts for ${((acActive / Math.max(1, filtered.length)) * 100).toFixed(1)}% of total observed events across ${uniqueNodes.size} aircon controller units with ${onlineNodes.size} online controls operating without interruption.`, MARGIN + 5, distPageY + 9);

    // ══════════════════════════════════════════════════════════════════
    // PAGE 9 — THERMAL TELEMETRY & PREDICTIVE ANALYTICS
    // ══════════════════════════════════════════════════════════════════
    doc.addPage();
    let thermPageY = sectionTitle('Thermal Telemetry & Predictive Analytics', 20);

    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text(`Ambient thermal conditions and machine learning energy prediction modeling`, MARGIN, thermPageY - 1);
    thermPageY += 5;

    // Full-width Temperature Trend Chart
    const fullTempW = pageW - MARGIN * 2;
    const fullTempH = 55;

    doc.setFillColor(255, 255, 255);
    doc.roundedRect(MARGIN, thermPageY, fullTempW, fullTempH + 8, 2.5, 2.5, 'F');
    doc.setDrawColor(229, 231, 235);
    doc.setLineWidth(0.3);
    doc.roundedRect(MARGIN, thermPageY, fullTempW, fullTempH + 8, 2.5, 2.5, 'S');

    doc.setFontSize(9.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...DARK_GREEN);
    doc.text(getDynLabel('Ambient Temperature Trend Over Time (°C)'), MARGIN + 6, thermPageY + 5.5);

    doc.addImage(tempChart, 'PNG', MARGIN + 2, thermPageY + 7, fullTempW - 4, fullTempH);

    thermPageY += fullTempH + 13;

    curY = thermPageY;

    let predKwh = 'Unavailable';
    let predRate = 'Unavailable';
    const predModel = 'XGBoost';

    try {
      const avgT = parseFloat(stats.avgTemp);
      if (!isNaN(avgT) && hoursUsed > 0 && acOnRatio > 0) {
        const res = await fetch(`${BACKEND_URL}/api/predict-energy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'xgboost',
            avg_temp: avgT,
            period: currentPeriod,
            ac_on_ratio: acOnRatio,
            hours_used: hoursUsed
          })
        });
        if (res.ok) {
          const data = await res.json();
          predKwh = data.kwh + ' kWh';
          predRate = hoursUsed > 0 ? (data.kwh / hoursUsed).toFixed(2) + ' kW/h' : 'N/A';
        }
      }
    } catch (_) { /* prediction unavailable */ }

    doc.autoTable({
      startY: curY,
      margin: { left: MARGIN, right: MARGIN },
      head: [['Metric', 'Value']],
      body: [
        ['Prediction Model', predModel],
        ['Predicted Energy Consumption', predKwh],
        ['Estimated Consumption Rate', predRate]
      ],
      theme: 'striped',
      styles: { fontSize: 8.5, cellPadding: 3.5, textColor: [55, 65, 81], lineColor: [229, 231, 235], lineWidth: 0.1 },
      headStyles: { fillColor: DARK_GREEN, textColor: WHITE, fontStyle: 'bold', fontSize: 8.5, cellPadding: 4 },
      alternateRowStyles: { fillColor: [249, 250, 251] },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 80 } }
    });

    let predEndY = (doc.lastAutoTable?.finalY ?? curY) + 8;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(75, 85, 99); // Gray-600
    const predInterp = predKwh !== 'Unavailable'
      ? `Summary: The ${predModel} model estimates an energy consumption of ${predKwh} for the current monitoring period (${dateRangeText}), translating to a rate of approximately ${predRate}. This prediction accounts for average temperature, AC on-ratio, and runtime hours.`
      : 'Summary: Prediction is currently unavailable. Ensure the Flask backend prediction API is running and accessible.';
    doc.text(doc.splitTextToSize(predInterp, pageW - MARGIN * 2), MARGIN, predEndY);

    // ══════════════════════════════════════════════════════════════════
    // EXTRA SECTIONS (Installation, Rules Compliance, Energy Ranking)
    // ══════════════════════════════════════════════════════════════════
    await addExtraPdfSections(doc, filtered, locationMap, controlNameMap, globalAirconMap, globalInstallDateMap, pageW, MARGIN, addHeaderFooter, sectionTitle, addTableExplanation, DARK_GREEN, ACCENT, WHITE, LIGHT_GRAY, DARK_TEXT, currentPeriod, ALGO_TO_MODEL, selectedAlgorithm);

    // ══════════════════════════════════════════════════════════════════
    // LAST PAGE — EXECUTIVE SUMMARY
    // ══════════════════════════════════════════════════════════════════
    doc.addPage();
    curY = sectionTitle('Executive Summary', 20);

    const totalControls = uniqueNodes.size;
    const onlinePct = totalControls > 0 ? ((onlineNodes.size / totalControls) * 100).toFixed(0) : 0;
    const tempStability = (maxTemp - minTemp) <= 5 ? 'stable' : 'showing significant variation';
    const acEfficiency = acActive > acOff ? 'predominantly in active cooling mode' : 'mostly in standby/off mode';
    const batteryHealth = avgBat >= 60 ? 'healthy' : avgBat >= 30 ? (currentNodeFilter ? 'moderate — consider replacement soon' : 'moderate — consider replacements soon') : 'critically low — immediate attention needed';
    const signalQuality = avgRssi >= 60 ? 'strong' : avgRssi >= 30 ? 'acceptable but could be improved' : (currentNodeFilter ? 'poor — consider repositioning the control' : 'poor — consider repositioning controls');

    const perfText = currentNodeFilter
      ? `The control ${controlFilterLabel} was monitored during the ${periodLabel.toLowerCase()} period (${dateRangeText}). It was ${onlineNodes.size > 0 ? 'online' : 'offline'} at its most recent reading, producing ${filtered.length} total telemetry records.`
      : `A total of ${totalControls} control(s) were monitored during the ${periodLabel.toLowerCase()} period (${dateRangeText}). Of these, ${onlineNodes.size} (${onlinePct}%) were online at their most recent reading, producing ${filtered.length} total telemetry records.`;

    const acText = currentNodeFilter
      ? `The air conditioning unit was ${acEfficiency}, with ${acActive} active cooling events, ${acFan} fan-only events, and ${acOff} off events across the period. Active cooling accounted for ${((acActive / filtered.length) * 100).toFixed(1)}% of total events.`
      : `Air conditioning systems were ${acEfficiency}, with ${acActive} active cooling events, ${acFan} fan-only events, and ${acOff} off events across the period. Active cooling accounted for ${((acActive / filtered.length) * 100).toFixed(1)}% of total events.`;

    const batText = currentNodeFilter
      ? `The battery level for this control averages ${avgBat.toFixed(1)}% — assessed as ${batteryHealth}. The RSSI signal strength averages ${avgRssi.toFixed(1)}% — assessed as ${signalQuality}. ${offlineCount} offline event(s) were recorded.`
      : `Average battery level across all controls is ${avgBat.toFixed(1)}% — assessed as ${batteryHealth}. Average RSSI signal strength is ${avgRssi.toFixed(1)}% — assessed as ${signalQuality}. ${offlineCount} offline event(s) were recorded.`;

    // ── Estimated Bill for Executive Summary (matches selected period) ──
    const execEnergyKwh = currentEvaluatedKwh;
    const execEstBill = calculateEnergyCost(execEnergyKwh);
    const fmtExec = (v) => !Number.isFinite(v) ? 'Unavailable' : 'PHP ' + v.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const billText = Number.isFinite(execEstBill)
      ? `Based on the active utility rate of PHP ${formatAnalyticsNumber(getActiveTariffRate())}/kWh (${getUtilityProvider()}), the estimated ${periodLabel.toLowerCase()} electricity bill is ${fmtExec(execEstBill)} for a predicted energy consumption of ${energyText}. This estimate is computed from the ML energy prediction model output multiplied by the prevailing electricity tariff.`
      : 'Estimated electricity bill is unavailable due to insufficient energy consumption data.';

    const execSections = [
      { header: 'OVERALL CONTROL PERFORMANCE', text: perfText },
      { header: 'ENVIRONMENTAL STABILITY', text: `Temperature readings were ${tempStability}, ranging from ${minTemp.toFixed(0)}°C to ${maxTemp.toFixed(0)}°C with an average of ${avgTempVal.toFixed(0)}°C.` },
      { header: 'AC OPERATIONAL BEHAVIOR', text: acText },
      { header: 'ESTIMATED ELECTRICITY BILL (PHP)', text: billText },
      { header: 'CONTROL RELIABILITY', text: batText }
    ];

    let summaryY = curY + 5;
    execSections.forEach(sec => {
      // Header
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(...DARK_GREEN);
      doc.text(sec.header, MARGIN, summaryY);
      summaryY += 5;
      
      // Body Text
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(55, 65, 81); // Slate-700
      const lines = doc.splitTextToSize(sec.text, pageW - MARGIN * 2);
      doc.text(lines, MARGIN, summaryY);
      summaryY += lines.length * 4.5 + 5;
    });

    // ── Apply headers & footers to all pages ──────────────────────────
    addHeaderFooter();

    // ── Save ──────────────────────────────────────────────────────────
    const dateStr = selectedDateKey || generatedAt.toISOString().split('T')[0];
    doc.save(`EcoTrack_Aircon_Energy_Analytics_${currentPeriod}_${dateStr}.pdf`);
    if (window.EcoToast) {
      window.EcoToast.success('PDF report exported successfully.');
    }

  } catch (error) {
    console.error('Could not export PDF:', error);
    if (window.EcoToast) window.EcoToast.error('Failed to export PDF. Please check console for details.');
    else alert('Failed to export PDF. See console for details.');
  }
}

// ── EXTRA PDF SECTIONS (Installation, Rules Compliance, Energy Ranking) ──
async function addExtraPdfSections(doc, filtered, locationMap, controlNameMap, airconMap, installDateMap, pageW, MARGIN, addHeaderFooter, sectionTitle, addTableExplanation, DARK_GREEN, ACCENT, WHITE, LIGHT_GRAY, DARK_TEXT, currentPeriod, ALGO_TO_MODEL, selectedAlgorithm) {
  // 1. CONTROL INSTALLATION DIRECTORY
  doc.addPage();
  let curY = sectionTitle('Control Installation Directory', 20);
  
  const uniqueNodesMap = new Map();
  filtered.forEach(log => {
    if (!uniqueNodesMap.has(log.nodeId)) {
      const loc = locationMap[log.nodeId] || { buildingName: 'Unknown', floorName: 'Unknown', roomName: 'Unknown' };
      uniqueNodesMap.set(log.nodeId, {
        id: log.nodeId,
        name: controlNameMap[log.nodeId] || log.nodeId,
        building: loc.buildingName,
        floor: loc.floorName,
        room: loc.roomName,
        acType: airconMap[log.nodeId] || 'Unknown',
        installDate: installDateMap[log.nodeId] || '-',
        status: log.status
      });
    }
  });

  const installationData = Array.from(uniqueNodesMap.values()).map(n => [
    n.building, n.floor, n.room, n.name, n.acType, n.installDate, n.status.toUpperCase()
  ]);

  installationData.sort((a, b) => {
    if (a[0] !== b[0]) return a[0].localeCompare(b[0]);
    if (a[1] !== b[1]) return a[1].localeCompare(b[1]);
    return a[2].localeCompare(b[2]);
  });

  doc.autoTable({
    startY: curY,
    margin: { left: MARGIN, right: MARGIN },
    head: [['Building', 'Floor', 'Room', 'Control Name', 'Attached Aircon Type', 'Install Date & Time', 'Status']],
    body: installationData.length > 0 ? installationData : [['-', '-', '-', '-', '-', '-', '-']],
    theme: 'striped',
    styles: { fontSize: 8, cellPadding: 3, textColor: [55, 65, 81], lineColor: [229, 231, 235], lineWidth: 0.1 },
    headStyles: { fillColor: DARK_GREEN, textColor: WHITE, fontStyle: 'bold', fontSize: 8, cellPadding: 3.5 },
    alternateRowStyles: { fillColor: [249, 250, 251] },
    didParseCell: function(data) {
      if (data.section === 'body' && data.column.index === 6) {
        data.cell.styles.textColor = data.cell.raw === 'ONLINE' ? ACCENT : [239, 68, 68];
        data.cell.styles.fontStyle = 'bold';
      }
    }
  });
  
  addHeaderFooter();

  // 2. RULE VIOLATION REPORT
  doc.addPage();
  curY = sectionTitle('Rule Violation Report', 20);
  
  let violationData = [];
  try {
    let notifs = [];
    if (window.electron && typeof window.electron.invoke === 'function') {
      try {
        const res = await window.electron.invoke('notifications-fetch-all');
        if (res && res.success && res.data) notifs = res.data;
      } catch (ipcErr) {
        console.warn('IPC notifications-fetch-all error in logs.js:', ipcErr);
      }
    }
    if (!notifs.length && sb) {
      const { data, error } = await sb.from('notifications').select('*').order('created', { ascending: false });
      if (!error && data) notifs = data;
    }
    
    // Determine the time range for the current report to filter notifications
    let minT = 0, maxT = Date.now();
    if (filtered.length > 0) {
      const timestamps = filtered.map(l => {
        const d = l.timestamp instanceof Date ? l.timestamp : new Date(l.timestamp);
        return d.getTime();
      }).filter(t => !isNaN(t));
      if (timestamps.length > 0) {
        minT = Math.min(...timestamps);
        maxT = Math.max(...timestamps);
      }
    }
    
    notifs.forEach(n => {
      // Basic time filtering based on the logs in the report
      let notifTime = Date.now();
      try {
        notifTime = new Date(`${n.date} ${n.time}`).getTime();
      } catch (e) {
        notifTime = new Date(n.created).getTime();
      }
      
      // If we have logs, only show notifications from the same time window
      if (filtered.length > 0 && (notifTime < minT || notifTime > maxT)) {
        return; 
      }
      
      let hardwareId = 'Unknown Control';
      let reason = (n.content || '').replace('__INBOX_DISMISSED__|||', '');
      
      // Parse the notification content which is usually "HardwareID|||Message"
      if (reason.includes('|||')) {
        const parts = reason.split('|||');
        hardwareId = parts[0];
        reason = parts.slice(1).join('|||'); // Join back in case message had |||
      } else if (controlNameMap[n.room_id]) {
        // Fallback
        hardwareId = controlNameMap[n.room_id];
      }
      
      // Map hardwareId to location using locationMap (which now has node.name mapped)
      const loc = locationMap[hardwareId] || { buildingName: 'Unknown', floorName: 'Unknown', roomName: 'Unknown' };
      
      // Apply the active control filter (currentNodeFilter stores the PocketBase ID)
      if (currentNodeFilter) {
        const expectedHardwareId = controlNameMap[currentNodeFilter] || currentNodeFilter;
        if (hardwareId !== expectedHardwareId) {
          return; // Skip this notification since it doesn't match the selected control
        }
      }

      violationData.push([
        loc.buildingName, 
        loc.floorName, 
        loc.roomName, 
        hardwareId, 
        reason,
        `${n.date} ${n.time}`
      ]);
    });
  } catch (err) {
    console.warn('Failed to load notifications for PDF:', err);
  }

  // Sort chronologically (newest first)
  violationData.sort((a, b) => {
    const tA = new Date(a[5]).getTime() || 0;
    const tB = new Date(b[5]).getTime() || 0;
    return tB - tA;
  });

  if (violationData.length === 0) violationData = [['-', '-', '-', '-', 'No violations recorded during this period', '-']];

  doc.autoTable({
    startY: curY,
    margin: { left: MARGIN, right: MARGIN },
    head: [['Building', 'Floor', 'Room', 'Control', 'Violation Details', 'Date/Time']],
    body: violationData,
    theme: 'striped',
    styles: { fontSize: 8, cellPadding: 3, textColor: [55, 65, 81], lineColor: [229, 231, 235], lineWidth: 0.1 },
    headStyles: { fillColor: DARK_GREEN, textColor: WHITE, fontStyle: 'bold', fontSize: 8, cellPadding: 3.5 },
    alternateRowStyles: { fillColor: [249, 250, 251] },
    columnStyles: { 4: { cellWidth: 100 } } // Give the violation reason more space
  });

  addHeaderFooter();

  // 3. ENERGY CONSUMPTION RANKING
  doc.addPage();
  curY = sectionTitle('Energy Consumption Ranking', 20);

  const roomEstimates = new Map();
  for (const job of currentAnalyticsResult?.nodes || []) {
    if (!Number.isFinite(job.kwh)) continue;
    const log = job.logs?.[0];
    if (!log) continue;
    const building = log.buildingName || 'Unassigned', floor = log.floorName || 'Unassigned', room = log.roomName || 'Unassigned';
    const key = JSON.stringify([building, floor, room]);
    if (!roomEstimates.has(key)) roomEstimates.set(key, { building, floor, room, kwh: 0 });
    roomEstimates.get(key).kwh += job.kwh;
  }
  const energyRankings = [...roomEstimates.values()];

  energyRankings.sort((a, b) => b.kwh - a.kwh);
  
  const fmtRank = (v) => !Number.isFinite(v) ? 'Unavailable' : 'PHP ' + v.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const rankPeriodLabel = currentPeriod.charAt(0).toUpperCase() + currentPeriod.slice(1);

  let rankingBody = energyRankings.map((r, i) => [
     (i + 1).toString(), r.building, r.floor, r.room, r.kwh.toFixed(2) + ' kWh', fmtRank(calculateEnergyCost(r.kwh))
  ]);
  
  if (rankingBody.length === 0) rankingBody = [['-', '-', '-', '-', 'N/A', '-']];

  doc.autoTable({
    startY: curY,
    margin: { left: MARGIN, right: MARGIN },
    head: [['Rank', 'Building', 'Floor', 'Room', 'Predicted kWh', `Est. ${rankPeriodLabel} Bill (PHP)`]],
    body: rankingBody,
    theme: 'striped',
    styles: { fontSize: 8, cellPadding: 3, textColor: [55, 65, 81], lineColor: [229, 231, 235], lineWidth: 0.1 },
    headStyles: { fillColor: DARK_GREEN, textColor: WHITE, fontStyle: 'bold', fontSize: 8, cellPadding: 3.5 },
    alternateRowStyles: { fillColor: [249, 250, 251] },
    columnStyles: { 0: { fontStyle: 'bold', textColor: ACCENT, halign: 'center' } }
  });
  addTableExplanation(`Note: Estimates are based on the active electricity tariff of PHP ${formatAnalyticsNumber(getActiveTariffRate())}/kWh (${getUtilityProvider()}).`);

  addHeaderFooter();
}
