// Initialize Database Clients (telemetry -> PocketBase, metadata -> Supabase)
const sb = window.supabaseClient || window.sb;
const pb = window.pb || (typeof PocketBase === 'function' ? new PocketBase() : null);

// Real telemetry logs from PocketBase
let nodeDataLogs = [];
let currentPeriod = 'daily';
let currentNodeFilter = '';
let selectedDateKey = '';
let startTimeFilter = '';
let endTimeFilter = '';
let roomMap = {}; // Store node to room mapping
let sensorNameMap = {}; // Store node to sensor name mapping
let locationMap = {}; // Store node to location details
let globalAirconMap = {}; // Store node to aircon type mapping
let globalInstallDateMap = {}; // Store node to installation date mapping
let selectedAlgorithm = 'rf'; // Default: Random Forest

// Pagination state
let currentPage = 1;
const PAGE_SIZE = 20;

function getPeriodDateKey(date, period = currentPeriod) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  if (period === 'monthly') {
    return `${year}-${month}`;
  }

  if (period === 'yearly') {
    return `${year}`;
  }

  if (period === 'weekly') {
    const d = new Date(date);
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
  return getPeriodDateKey(new Date(), currentPeriod);
}

function getAvailableDateKeys() {
  const keys = new Set(nodeDataLogs.map(log => getPeriodDateKey(log.timestamp, currentPeriod)));
  keys.add(getDefaultDateKey());
  return Array.from(keys).sort((left, right) => right.localeCompare(left));
}

function populateDateRangeOptions() {
  const dateSelect = document.getElementById('dateRangeSelect');
  if (!dateSelect) return;

  const availableKeys = getAvailableDateKeys();
  const preferredKey = getDefaultDateKey();

  if (!selectedDateKey || !availableKeys.includes(selectedDateKey)) {
    selectedDateKey = availableKeys.includes(preferredKey) ? preferredKey : (availableKeys[0] || preferredKey);
  }

  dateSelect.innerHTML = availableKeys.map(key => {
    const label = getPeriodDateLabel(key, currentPeriod);
    return `<option value="${key}">${label}</option>`;
  }).join('');

  dateSelect.value = selectedDateKey;
}

// Initialize logs on page load
document.addEventListener('DOMContentLoaded', async () => {
  console.log('Logs page loaded');
  setupEventListeners();

  // 1. Instant local database load (renders in ~400ms!)
  await fetchLogsFromDB();
  console.log('Loaded', nodeDataLogs.length, 'telemetry log records');
  populateDateRangeOptions();
  render();

  // 2. Enhance metadata asynchronously in background without blocking initial render
  loadRoomMap().then(() => {
    populateDateRangeOptions();
    render();
  }).catch(e => console.warn('[EcoTrack Logs] Background room map load:', e));

  // 3. Lightweight background poll: check totalItems first before re-fetching all records
  let lastTotalItems = nodeDataLogs.length;
  setInterval(async () => {
    try {
      const backendUrl = (window.ECOTRACK_CONFIG && window.ECOTRACK_CONFIG.backendUrl) || 'http://localhost:5000';
      const checkRes = await fetch(`${backendUrl}/api/telemetry?perPage=1`);
      if (checkRes.ok) {
        const checkData = await checkRes.json();
        if (checkData.totalItems && checkData.totalItems !== lastTotalItems) {
          lastTotalItems = checkData.totalItems;
          await fetchLogsFromDB();
          populateDateRangeOptions();
          render();
        }
      }
    } catch (_) {}
  }, 4000);

  // Real-time event subscription for immediate updates when packets arrive in Supabase
  const sbClient = window.supabaseClient || window.sb;
  if (sbClient) {
    try {
      sbClient.channel('telemetry-logs-realtime')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'telemetry' }, async () => {
          await fetchLogsFromDB();
          populateDateRangeOptions();
          render();
        })
        .subscribe();
    } catch (_) {}
  }
});

// Load room mapping directly from PocketBase / Supabase (non-blocking)
async function loadRoomMap() {
  const nodeFilter = document.getElementById('nodeFilter');
  if (nodeFilter && nodeFilter.options.length <= 1) {
    nodeFilter.innerHTML = '<option value="">All Sensors</option>';
  }
  
  // Non-blocking sync in background
  if (typeof syncSupabaseNodesToPocketBase === 'function') {
    syncSupabaseNodesToPocketBase().catch(e => console.warn('[EcoTrack Logs] Sync error:', e));
  }

  try {
    let roomRecords = [];
    let floorRecords = [];
    let buildingRecords = [];
    let nodeRecords = [];

    if (sb) {
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
      sensorNameMap[node.id] = nodeIdStr; // e.g. "AC-SRV-01"
      if (node.name) sensorNameMap[node.name] = node.name;

      const airconType = node.aircon_type || 'Split Type (Inverter)';
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
function setupEventListeners() {
  // Tab buttons
  document.querySelectorAll('.log-tab').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const button = e.currentTarget;

      document.querySelectorAll('.log-tab').forEach(b => {
        b.classList.remove('bg-[#0b291d]', 'dark:bg-[#10b981]', 'text-white');
        b.classList.add('bg-white', 'dark:bg-slate-900', 'text-gray-700', 'dark:text-gray-200');
      });
      button.classList.add('bg-[#0b291d]', 'dark:bg-[#10b981]', 'text-white');
      button.classList.remove('bg-white', 'dark:bg-slate-900', 'text-gray-700', 'dark:text-gray-200');
      
      currentPeriod = button.dataset.period;
      selectedDateKey = getDefaultDateKey();
      currentPage = 1;
      populateDateRangeOptions();
      render();
    });
  });

  const dateRangeSelect = document.getElementById('dateRangeSelect');
  if (dateRangeSelect) {
    dateRangeSelect.addEventListener('change', (e) => {
      selectedDateKey = e.target.value;
      currentPage = 1;
      render();
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
  document.getElementById('nodeFilter').addEventListener('change', (e) => {
    currentNodeFilter = e.target.value;
    currentPage = 1;
    render();
  });

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

  // Export button
  document.getElementById('exportBtn').addEventListener('click', () => {
    showDownloadModal('pdf', exportLogs);
  });

  document.getElementById('exportExcelBtn').addEventListener('click', () => {
    showDownloadModal('excel', exportExcelLogs);
  });

  const cancelDownloadBtn = document.getElementById('cancelDownloadBtn');
  if (cancelDownloadBtn) {
    cancelDownloadBtn.addEventListener('click', () => {
      clearInterval(downloadProgressInterval);
      const modal = document.getElementById('downloadModal');
      if (modal) modal.style.display = 'none';
    });
  }

  // Algorithm selector buttons
  document.querySelectorAll('.algo-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const algo = e.currentTarget.dataset.algo;
      selectedAlgorithm = algo;
      // Update button styles
      document.querySelectorAll('.algo-btn').forEach(b => {
        b.classList.remove('bg-[#0b291d]', 'text-white', 'border-[#10b981]', 'dark:bg-[#10b981]', 'dark:text-white', 'dark:border-[#10b981]/40');
        b.classList.add('bg-white', 'text-gray-500', 'border-gray-300', 'dark:bg-slate-900', 'dark:text-gray-400', 'dark:border-white/10');
      });
      e.currentTarget.classList.remove('bg-white', 'text-gray-500', 'border-gray-300', 'dark:bg-slate-900', 'dark:text-gray-400', 'dark:border-white/10');
      e.currentTarget.classList.add('bg-[#0b291d]', 'text-white', 'border-[#10b981]', 'dark:bg-[#10b981]', 'dark:text-white', 'dark:border-[#10b981]/40');
      // Re-run prediction
      render();
    });
  });

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

// Fetch real sensor telemetry data from Native SQLite3 (backend/telemetry.db)
async function fetchLogsFromDB() {
  const tbody = document.getElementById('logsTableBody');
  if (tbody && (!nodeDataLogs || nodeDataLogs.length === 0)) {
    window.EcoTrackSkeletons?.renderTableSkeleton('logsTableBody', {
      rows: 8,
      cols: 9,
      colWidths: ['w-28', 'w-20', 'w-24', 'w-20', 'w-16', 'w-16', 'w-16', 'w-16', 'w-20']
    });
  }
  try {
    let records = [];

    // 1. Primary Sensor Logs Source: Native SQLite3 API (port 5000)
    try {
      const backendUrl = (window.ECOTRACK_CONFIG && window.ECOTRACK_CONFIG.backendUrl) || 'http://localhost:5000';
      const res = await fetch(`${backendUrl}/api/telemetry?perPage=0&sort=-created`);
      if (res.ok) {
        const data = await res.json();
        records = data.items || [];
      }
    } catch (_) {}

    // Fallback to pb collection router if needed
    if (!records.length && pb && typeof pb.collection === 'function') {
      try {
        records = await pb.collection('telemetry').getFullList({ sort: '-created' });
      } catch (_) {}
    }

    // 2. Secondary fallback to Supabase if SQLite3 is empty or initializing
    if (!records.length) {
      const sbClient = window.supabaseClient || window.sb;
      if (sbClient) {
        try {
          const { data, error } = await sbClient.from('telemetry').select('*').order('created', { ascending: false });
          if (!error && data && data.length) {
            records = data;
          }
        } catch (_) {}
      }
    }

    if (!records || records.length === 0) return;

    nodeDataLogs = records.map((r, i) => {
      // 1. Direct fields saved in PocketBase telemetry collection
      let sensorName = r.sensor_name;
      let roomName = r.room_name;
      let floorName = r.floor_name;
      let buildingName = r.building_name;
      let airconType = r.aircon_type;

      // 2. Relational expanded fields from PocketBase if not directly on the record
      if (r.expand && r.expand.node_id) {
        const n = r.expand.node_id;
        if (!sensorName) sensorName = n.name || r.node_id;
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
      if (!sensorName) sensorName = sensorNameMap[r.node_id] || r.node_id;
      if (!roomName && locationMap[r.node_id]) roomName = locationMap[r.node_id].roomName;
      if (!floorName && locationMap[r.node_id]) floorName = locationMap[r.node_id].floorName;
      if (!buildingName && locationMap[r.node_id]) buildingName = locationMap[r.node_id].buildingName;
      if (!airconType) airconType = globalAirconMap[r.node_id] || 'Split Type (Inverter)';

      // Cache back into maps for quick UI lookup
      sensorNameMap[r.node_id] = sensorName;
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
        sensorName: sensorName || r.node_id,
        roomName: roomName || 'Unassigned',
        floorName: floorName || 'Unassigned',
        buildingName: buildingName || 'Unassigned',
        airconType: airconType,
        timestamp: new Date(r.created || (Date.now() - i * 60000)),
        temperature: r.temperature,
        pressure: r.pressure,
        battery: r.battery,
        rssi: r.rssi,
        status: r.status || 'online'
      };
    });

    // Populate dropdown filter options with all historical sensors from PocketBase
    const nodeFilter = document.getElementById('nodeFilter');
    if (nodeFilter) {
      const addedValues = new Set();
      if (nodeFilter.options.length === 0) {
        const defaultOpt = document.createElement('option');
        defaultOpt.value = '';
        defaultOpt.textContent = 'All Sensors';
        nodeFilter.appendChild(defaultOpt);
      }

      nodeDataLogs.forEach(log => {
        const sName = log.sensorName || log.nodeId;
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
    console.error('PocketBase load error (telemetry):', e);
  }
}

// Get filtered logs based on current period, node filter, and time range
function getFilteredLogs() {
  const activeDateKey = selectedDateKey || getDefaultDateKey();
  let filtered = nodeDataLogs;
  
  // Include all telemetry logs (do not filter out unassigned nodes)
  filtered = filtered.filter(log => getPeriodDateKey(log.timestamp, currentPeriod) === activeDateKey);
  
  // Filter by AC Sensor (matches name or database id)
  if (currentNodeFilter) {
    filtered = filtered.filter(log => 
      log.nodeId === currentNodeFilter || 
      log.sensorName === currentNodeFilter ||
      (sensorNameMap[currentNodeFilter] && sensorNameMap[currentNodeFilter] === log.sensorName) ||
      (sensorNameMap[log.nodeId] && sensorNameMap[log.nodeId] === currentNodeFilter)
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
      avgPressure: '--',
      onlineNodes: '0/0'
    };
  }
  
  // Calculate averages
  const temps = filtered.map(l => parseFloat(l.temperature));
  const pressures = filtered.map(l => parseFloat(l.pressure));
  
  const avgTemp = Math.round(temps.reduce((a, b) => a + b, 0) / temps.length);
  const avgPressure = (pressures.reduce((a, b) => a + b, 0) / pressures.length).toFixed(1);
  
  // Count online nodes
  const activeNodes = new Set();
  const onlineActiveNodes = new Set();
  
  filtered.forEach(l => {
    activeNodes.add(l.nodeId);
    if (l.status === 'online') {
      onlineActiveNodes.add(l.nodeId);
    }
  });
  
  return {
    totalRecords: filtered.length,
    avgTemp: avgTemp,
    avgPressure: avgPressure,
    onlineNodes: `${onlineActiveNodes.size}/${activeNodes.size}`
  };
}

// ─── ENERGY CONSUMPTION PREDICTION (via Flask + .pkl models) ──────────

const BACKEND_URL = 'http://127.0.0.1:5000';
const DAVAO_LIGHT_RATE = 10.35; // ₱ per kWh (Davao Light May 2026 residential rate)

const ALGO_TO_MODEL = {
  rf:  'random_forest',
  dt:  'decision_tree',
  xgb: 'xgboost'
};

function getAcStateFeatures(filteredLogs) {
  let onCount = 0;
  let offCount = 0;

  let minTime = Infinity;
  let maxTime = -Infinity;

  filteredLogs.forEach(log => {
    const time = new Date(log.timestamp).getTime();
    if (time < minTime) minTime = time;
    if (time > maxTime) maxTime = time;

    const temperature = Number(log.temperature) || 0;
    let acState = 'ACTIVE COOLING';
    if (temperature >= 28) acState = 'OFF';
    else if (temperature >= 26) acState = 'FAN ONLY';
    if (log.status !== 'online') acState = 'OFF';

    if (acState === 'OFF') offCount++;
    else onCount++; // FAN ONLY and ACTIVE COOLING = ON
  });

  const total = onCount + offCount || 1;
  
  // Period-based minimum hours (realistic AC runtime assumptions)
  const periodMinHours = { daily: 8, weekly: 56, monthly: 240 };
  const minHours = periodMinHours[currentPeriod] || 8;
  
  // Calculate actual time span in hours
  let hoursUsed = minHours;
  if (minTime !== Infinity && maxTime !== -Infinity) {
    const actualHours = (maxTime - minTime) / (1000 * 60 * 60);
    // Use the larger of actual span or period-based minimum
    hoursUsed = Math.max(actualHours, minHours);
  }

  return { acOnRatio: onCount / total, hoursUsed };
}

async function predictEnergyConsumption(stats, filteredLogs) {
  const el = document.getElementById('energyConsumption');
  if (!stats || stats.totalRecords === 0) {
    el.textContent = '-- kWh';
    return;
  }

  const modelType = ALGO_TO_MODEL[selectedAlgorithm] || 'random_forest';
  el.textContent = '...';

  try {
    let totalKwh = 0;
    let maxHoursUsed = 0;
    
    // Group logs by sensor (nodeId) to predict energy per AC unit
    const logsByNode = {};
    filteredLogs.forEach(log => {
      const nid = log.nodeId || log.node_id;
      if (!logsByNode[nid]) logsByNode[nid] = [];
      logsByNode[nid].push(log);
    });

    // Make concurrent predictions for each sensor in parallel
    const predictionPromises = Object.keys(logsByNode).map(async (nid) => {
      const nodeLogs = logsByNode[nid];
      
      let sumT = 0, sumP = 0;
      nodeLogs.forEach(l => {
        sumT += Number(l.temperature) || 0;
        sumP += Number(l.pressure) || 0;
      });
      const avgT = sumT / nodeLogs.length;
      const avgP = sumP / nodeLogs.length;
      
      const { acOnRatio, hoursUsed } = getAcStateFeatures(nodeLogs);
      if (hoursUsed > maxHoursUsed) maxHoursUsed = hoursUsed;
      
      if (isNaN(avgT) || isNaN(avgP)) return 0;
      
      try {
        const res = await fetch(`${BACKEND_URL}/api/predict-energy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: modelType,
            avg_temp: avgT,
            avg_pressure: avgP,
            period: currentPeriod,
            ac_on_ratio: acOnRatio,
            hours_used: hoursUsed
          })
        });
        
        if (res.ok) {
          const data = await res.json();
          return (data.kwh || 0);
        }
      } catch (_) {}
      return 0;
    });

    const results = await Promise.all(predictionPromises);
    totalKwh = results.reduce((sum, val) => sum + val, 0);

    el.textContent = `${totalKwh.toFixed(1)} kWh`;

    // ── Estimated Bill Calculation (₱) ──
    // Bill = ML predicted kWh for the current period × Davao Light rate
    const estBill = totalKwh * DAVAO_LIGHT_RATE;
    const fmt = (v) => '₱' + v.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const billEl = document.getElementById('estBillValue');
    const periodEl = document.getElementById('estBillPeriod');
    if (billEl) billEl.textContent = fmt(estBill);
    if (periodEl) {
      const periodLabels = { daily: 'Daily Estimate', weekly: 'Weekly Estimate', monthly: 'Monthly Estimate' };
      periodEl.textContent = periodLabels[currentPeriod] || 'Estimate';
    }
    
    // Update AI Suggestion based on model prediction
    const suggestionEl = document.getElementById('aiSuggestion');
    const svgIcon = suggestionEl?.previousElementSibling;
    
    if (suggestionEl) {
      if (svgIcon) svgIcon.classList.remove('text-[#10b981]', 'text-amber-500');

      // Calculate the predicted hourly draw to determine efficiency
      const numNodes = Object.keys(logsByNode).length || 1;
      const totalKwhPerHour = maxHoursUsed > 0 ? (totalKwh / maxHoursUsed) : 0;
      const avgKwhPerHourPerNode = totalKwhPerHour / numNodes;

      if (avgKwhPerHourPerNode > 1.1) {
        suggestionEl.textContent = `Model predicts high draw (~${totalKwhPerHour.toFixed(2)} kW/h total). Raise temp to 25°C to save energy.`;
        suggestionEl.className = 'font-semibold italic text-amber-600';
        if (svgIcon) svgIcon.classList.add('text-amber-500');
      } else if (avgKwhPerHourPerNode >= 0.8 && maxHoursUsed > 8) {
        suggestionEl.textContent = `Sustained draw (~${totalKwhPerHour.toFixed(2)} kW/h total). Inverter models cut costs for long runs.`;
        suggestionEl.className = 'font-semibold italic text-amber-600';
        if (svgIcon) svgIcon.classList.add('text-amber-500');
      } else if (avgKwhPerHourPerNode > 0) {
        suggestionEl.textContent = `Optimal! Model predicts an efficient ~${totalKwhPerHour.toFixed(2)} kW/h total consumption rate.`;
        suggestionEl.className = 'font-semibold italic text-[#10b981]';
        if (svgIcon) svgIcon.classList.add('text-[#10b981]');
      } else {
        suggestionEl.textContent = 'Consumption running optimally based on parameters.';
        suggestionEl.className = 'font-semibold italic text-[#10b981]';
        if (svgIcon) svgIcon.classList.add('text-[#10b981]');
      }
    }
  } catch (err) {
    console.warn('Prediction API error, check if Flask backend is running:', err);
    el.textContent = 'Backend Error';
    const suggestionEl = document.getElementById('aiSuggestion');
    if (suggestionEl) {
      suggestionEl.textContent = 'Ensure Flask backend (app.py) is running on port 5000.';
      suggestionEl.className = 'font-semibold italic text-red-600';
    }
  }
}

// Get date range text (including active time filters)
function getDateRangeText() {
  const baseLabel = getPeriodDateLabel(selectedDateKey || getDefaultDateKey(), currentPeriod);
  if (startTimeFilter && endTimeFilter) {
    return `${baseLabel} (${startTimeFilter} - ${endTimeFilter})`;
  } else if (startTimeFilter) {
    return `${baseLabel} (From ${startTimeFilter})`;
  } else if (endTimeFilter) {
    return `${baseLabel} (Until ${endTimeFilter})`;
  }
  return baseLabel;
}

// Render the page
function render() {
  populateDateRangeOptions();
  
  const filtered = getFilteredLogs();
  const stats = calculateStats();
  
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
  document.getElementById('totalRecords').textContent = stats.totalRecords;
  document.getElementById('avgTemp').textContent = stats.avgTemp === '--' ? '--°C' : `${stats.avgTemp}°C`;
  document.getElementById('avgPressure').textContent = stats.avgPressure === '--' ? '--kPa' : `${stats.avgPressure}kPa`;
  
  // Predict energy consumption (also updates estimated bill card)
  predictEnergyConsumption(stats, filtered);
  
  // Render table rows
  const tbody = document.getElementById('logsTableBody');
  if (tbody) {
    const scrollContainer = tbody.closest('.overflow-y-auto');
    if (scrollContainer && currentPage === 1) scrollContainer.scrollTop = 0;
  }
  tbody.innerHTML = '';
  
  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="11" class="px-6 py-6 text-center text-gray-500 font-bold">
          No data available for this period
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
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    
    const roomName = log.roomName || locationMap[log.nodeId]?.roomName || 'Unassigned';
    const floorName = log.floorName || locationMap[log.nodeId]?.floorName || 'Unassigned';
    const buildingName = log.buildingName || locationMap[log.nodeId]?.buildingName || 'Unassigned';
    const sensorName = log.sensorName || sensorNameMap[log.nodeId] || log.nodeId;
    
    const acType = log.airconType || globalAirconMap[log.nodeId] || 'Split Type (Inverter)';
    
    const temperature = Number(log.temperature) || 0;
    let acState = 'ACTIVE COOLING';
    if (temperature >= 28) acState = 'OFF';
    else if (temperature >= 26) acState = 'FAN ONLY';
    
    const isOnline = String(log.status).toLowerCase() === 'online';
    const statusText = isOnline ? 'Online' : 'Offline';
    const statusClass = isOnline ? 'text-green-600 dark:text-emerald-400 font-bold' : 'text-red-500 dark:text-rose-400 font-bold';
    
    if (!isOnline) {
      acState = 'OFF';
    }
    
    // Convert battery voltage to percentage matching Telemetry (4.2V = 100%)
    const batteryPercent = getBatteryPercentage(log.battery);
    
    row.innerHTML = `
      <td class="px-6 py-4">${timestampStr}</td>
      <td class="px-6 py-4 font-bold text-[#18392B] dark:text-cyan-400">${sensorName}</td>
      <td class="px-6 py-4 font-bold text-[#10b981] dark:text-emerald-400">${buildingName}</td>
      <td class="px-6 py-4 font-bold text-[#10b981] dark:text-emerald-400">${floorName}</td>
      <td class="px-6 py-4 font-bold text-[#10b981] dark:text-emerald-400">${roomName}</td>
      <td class="px-6 py-4 font-bold text-[#18392B] dark:text-cyan-400 whitespace-nowrap">${acType}</td>
      <td class="px-6 py-4 font-bold text-[#10b981] dark:text-emerald-400 whitespace-nowrap">${acState}</td>
      <td class="px-6 py-4">${Math.round(temperature)}°C</td>
      <td class="px-6 py-4">${(Number(log.pressure) || 0).toFixed(1)}kPa</td>
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
  
  tbody.appendChild(fragment);
}
// ── EXCEL (XLSX) EXPORT ──
async function exportExcelLogs() {
  const filtered = getFilteredLogs();
  if (!filtered.length) {
    alert('No logs available for export.');
    return;
  }

  // Ensure ExcelJS is loaded
  if (typeof ExcelJS === 'undefined') {
    alert('ExcelJS library is loading. Please try again in a moment.');
    return;
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'EcoTrack';
  workbook.created = new Date();
  
  const sheet = workbook.addWorksheet('Sensor Logs');
  
  // 1. Add Title
  sheet.mergeCells('A1:L1');
  const titleCell = sheet.getCell('A1');
  titleCell.value = 'EcoTrack Telemetry Report';
  titleCell.font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B291D' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  
  // 2. Add Meta Information (Export Date, Sensor Filter)
  const exportDateStr = new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });
  sheet.mergeCells('A2:L2');
  const metaCell1 = sheet.getCell('A2');
  metaCell1.value = `Exported on: ${exportDateStr}`;
  metaCell1.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF000000' } };
  
  const sensorFilterLabel = currentNodeFilter ? (sensorNameMap[currentNodeFilter] || currentNodeFilter) : 'All Sensors';
  sheet.mergeCells('A3:L3');
  const metaCell2 = sheet.getCell('A3');
  metaCell2.value = `Sensor Filter: ${sensorFilterLabel}`;
  metaCell2.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF000000' } };
  
  // Empty row for spacing
  sheet.getRow(4).height = 15;

  // 3. Add Summary Statistics Table
  const stats = calculateStats();
  const energyValueEl = document.getElementById('energyConsumption');
  const energyValue = energyValueEl ? energyValueEl.textContent.trim() : 'N/A';

  // Calculate estimated bill for Excel export (matches selected period)
  const energyKwh = parseFloat(energyValue) || 0;
  const excelEstBill = energyKwh * DAVAO_LIGHT_RATE;
  const fmtPeso = (v) => '₱' + v.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const excelPeriodLabel = currentPeriod.charAt(0).toUpperCase() + currentPeriod.slice(1);

  const summaryHeaders = ['TOTAL RECORDS', 'AVG TEMPERATURE', 'AVG AIRFLOW PRESSURE', 'PREDICTED ENERGY', `EST. BILL ${excelPeriodLabel.toUpperCase()} (₱)`];
  const summaryRowHeaders = sheet.getRow(5);
  summaryRowHeaders.values = summaryHeaders;
  
  summaryRowHeaders.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF10B981' } }; // Green
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF0B291D' } },
      left: { style: 'thin', color: { argb: 'FF0B291D' } },
      bottom: { style: 'thin', color: { argb: 'FF0B291D' } },
      right: { style: 'thin', color: { argb: 'FF0B291D' } }
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });

  const summaryValues = [
    stats.totalRecords, 
    stats.avgTemp !== '--' ? `${stats.avgTemp} °C` : '--',
    stats.avgPressure !== '--' ? `${stats.avgPressure} kPa` : '--',
    energyValue,
    fmtPeso(excelEstBill)
  ];
  const summaryRowValues = sheet.getRow(6);
  summaryRowValues.values = summaryValues;
  
  summaryRowValues.eachCell((cell) => {
    cell.font = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FF000000' } };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFCCCCCC' } },
      left: { style: 'thin', color: { argb: 'FFCCCCCC' } },
      bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
      right: { style: 'thin', color: { argb: 'FFCCCCCC' } }
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });

  sheet.getRow(7).height = 15; // Spacer

  // 4. Define Data Table Headers
  const dataHeaders = [
    'Timestamp', 'Sensor Name', 'Building', 'Floor', 'Room', 
    'Attached Aircon Type', 'Aircon State', 'Temperature (°C)', 
    'Airflow Pressure (kPa)', 'Battery Level (%)', 'RSSI (dBm)', 'Status'
  ];
  
  const headerRow = sheet.getRow(8);
  headerRow.values = dataHeaders;
  
  // Style headers
  headerRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF10B981' } }; // Green
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF0B291D' } },
      left: { style: 'thin', color: { argb: 'FF0B291D' } },
      bottom: { style: 'thin', color: { argb: 'FF0B291D' } },
      right: { style: 'thin', color: { argb: 'FF0B291D' } }
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });

  // 5. Add Data Rows
  filtered.forEach((log) => {
    const roomName = log.roomName || locationMap[log.nodeId]?.roomName || 'Unassigned';
    const floorName = log.floorName || locationMap[log.nodeId]?.floorName || 'Unassigned';
    const buildingName = log.buildingName || locationMap[log.nodeId]?.buildingName || 'Unassigned';
    const sName = log.sensorName || sensorNameMap[log.nodeId] || log.nodeId;
    const acType = log.airconType || globalAirconMap[log.nodeId] || 'Split Type (Inverter)';
    
    const ts = new Date(log.timestamp).toLocaleString();
    let acState = 'ACTIVE COOLING';
    const temp = Number(log.temperature) || 0;
    if (temp >= 28) acState = 'OFF';
    else if (temp >= 26) acState = 'FAN ONLY';
    if (String(log.status).toLowerCase() !== 'online') acState = 'OFF';

    const batteryPercent = getBatteryPercentage(log.battery);
    const row = sheet.addRow([
      ts, sName, buildingName, floorName, roomName,
      acType, acState, log.temperature, log.pressure, `${batteryPercent}%`, log.rssi, log.status.toUpperCase()
    ]);
    
    // Style Data Rows
    row.eachCell((cell) => {
      cell.font = { name: 'Calibri', size: 11, color: { argb: 'FF000000' } }; // Black text
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFCCCCCC' } },
        left: { style: 'thin', color: { argb: 'FFCCCCCC' } },
        bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
        right: { style: 'thin', color: { argb: 'FFCCCCCC' } }
      };
      // Center align specific columns
      if ([8, 9, 10, 11, 12].includes(cell.col)) {
        cell.alignment = { horizontal: 'center' };
      }
    });
  });

  // 6. Auto-fit columns based on text length
  sheet.columns.forEach((column, i) => {
    let maxLength = 0;
    // Skip checking title and meta rows, start from header row (row index 5 and 8)
    column.eachCell({ includeEmpty: true }, (cell, rowNumber) => {
      if (rowNumber === 5 || rowNumber === 6 || rowNumber >= 8) {
        const columnLength = cell.value ? cell.value.toString().length : 10;
        if (columnLength > maxLength) {
          maxLength = columnLength;
        }
      }
    });
    // Add padding to max length, with a maximum limit to prevent excessively wide columns
    column.width = Math.min(Math.max(maxLength + 2, 12), 40);
  });

  // Generate blob and download
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  
  const link = document.createElement('a');
  const dateRangeStr = getDateRangeText().replace(/ /g, '_').replace(/,/g, '');
  const url = URL.createObjectURL(blob);
  
  link.setAttribute('href', url);
  link.setAttribute('download', `EcoTrack_Logs_${dateRangeStr}.xlsx`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

async function exportLogs() {
  const filtered = getFilteredLogs();

  if (filtered.length === 0) {
    alert('No data to export');
    return;
  }

  try {
    // ── DESIGN CONSTANTS ──────────────────────────────────────────────
    const DARK_GREEN  = [11, 41, 29];
    const ACCENT      = [16, 185, 129];
    const WHITE       = [255, 255, 255];
    const LIGHT_GRAY  = [249, 250, 251];
    const DARK_TEXT   = [24, 57, 43];
    const MARGIN      = 14;

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const generatedAt = new Date();
    const generatedStr = generatedAt.toLocaleString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const dateRangeText = getDateRangeText();
    const periodLabel = currentPeriod.charAt(0).toUpperCase() + currentPeriod.slice(1);
    const sensorFilterLabel = currentNodeFilter
      ? (sensorNameMap[currentNodeFilter] || currentNodeFilter)
      : 'All Sensors';

    // ── HELPER: Compute log row values ────────────────────────────────
    const logRow = (log) => {
      const ts = new Date(log.timestamp).toLocaleString();
      const room = log.roomName || locationMap[log.nodeId]?.roomName || 'Unassigned';
      const floor = log.floorName || locationMap[log.nodeId]?.floorName || 'Unassigned';
      const building = log.buildingName || locationMap[log.nodeId]?.buildingName || 'Unassigned';
      const name = log.sensorName || sensorNameMap[log.nodeId] || log.nodeId;
      const acType = log.airconType || globalAirconMap[log.nodeId] || 'Split Type (Inverter)';
      const temp = Number(log.temperature) || 0;
      const pres = Number(log.pressure) || 0;
      const batP = getBatteryPercentage(log.battery);
      const rssiV = parseInt(log.rssi);
      const rssiP = Math.min(100, Math.max(0, ((rssiV + 120) / 120) * 100));
      let ac = 'ACTIVE COOLING';
      if (temp >= 28) ac = 'OFF';
      else if (temp >= 26) ac = 'FAN ONLY';
      if (log.status !== 'online') ac = 'OFF';
      const status = log.status.charAt(0).toUpperCase() + log.status.slice(1);
      return { ts, name, building, floor,
               room, type: acType, ac, temp, pres, batP, rssiP, status };
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
        doc.text('EcoTrack Sensor Log Monitoring Report', MARGIN, 8);
        doc.text(generatedStr, pageW - MARGIN, 8, { align: 'right' });
        // Footer
        doc.setDrawColor(229, 231, 235);
        doc.setLineWidth(0.3);
        doc.line(MARGIN, pageH - 10, pageW - MARGIN, pageH - 10);
        doc.text('Generated by EcoTrack Monitoring System', MARGIN, pageH - 6);
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
      const text = currentNodeFilter ? `${baseText} — ${sensorFilterLabel}` : baseText;
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
          const dataUrl = canvas.toDataURL('image/png');
          chart.destroy();
          document.body.removeChild(canvas);
          resolve(dataUrl);
        }, 150);
      });
    }

    // ── Pre-compute common data ───────────────────────────────────────
    const stats = calculateStats();
    const { acOnRatio, hoursUsed } = getAcStateFeatures(filtered);
    const temps = filtered.map(l => Number(l.temperature) || 0);
    const pressures = filtered.map(l => Number(l.pressure) || 0);
    const batteries = filtered.map(l => getBatteryPercentage(l.battery));
    const rssis = filtered.map(l => {
      const v = parseInt(l.rssi);
      return Math.min(100, Math.max(0, ((v + 120) / 120) * 100));
    });

    let acActive = 0, acFan = 0, acOff = 0, onlineCount = 0, offlineCount = 0;
    filtered.forEach(l => {
      const t = Number(l.temperature) || 0;
      let ac = 'ACTIVE COOLING';
      if (t >= 28) ac = 'OFF';
      else if (t >= 26) ac = 'FAN ONLY';
      if (l.status !== 'online') ac = 'OFF';
      if (ac === 'ACTIVE COOLING') acActive++;
      else if (ac === 'FAN ONLY') acFan++;
      else acOff++;
      if (l.status === 'online') onlineCount++;
      else offlineCount++;
    });

    const uniqueNodes = new Set(filtered.map(l => l.nodeId));
    const onlineNodes = new Set(filtered.filter(l => l.status === 'online').map(l => l.nodeId));
    const offlineNodes = new Set([...uniqueNodes].filter(n => !onlineNodes.has(n)));

    const avgBat = batteries.length ? (batteries.reduce((a, b) => a + b, 0) / batteries.length) : 0;
    const avgRssi = rssis.length ? (rssis.reduce((a, b) => a + b, 0) / rssis.length) : 0;

    // ══════════════════════════════════════════════════════════════════
    // PAGE 1 — COVER PAGE (Modern Split-Panel Corporate Design)
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
    doc.text('BUILDING MONITORING SYSTEM', 18, 57);

    // Sidebar divider
    doc.setDrawColor(...ACCENT);
    doc.setLineWidth(0.4);
    doc.line(18, 62, 75, 62);

    // Sidebar description
    doc.setFontSize(9.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(200, 200, 200);
    const sidebarText = doc.splitTextToSize(
      'Automated environmental telemetry analysis, rule violations, and machine learning energy predictions.',
      60
    );
    doc.text(sidebarText, 18, 70);

    // Right Sidebar Content
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...ACCENT);
    doc.text('MONITORING REPORT', 110, 38);

    doc.setFontSize(26);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...DARK_GREEN);
    doc.text('Sensor Log Report', 110, 48);

    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139); // Gray-500
    doc.text('Audit report of temperature, pressure, battery performance, and energy consumption.', 110, 56);

    // Report Parameters Table
    doc.autoTable({
      startY: 72,
      margin: { left: 110, right: MARGIN },
      theme: 'plain',
      styles: { 
        fontSize: 9.5, 
        cellPadding: 5, 
        textColor: [55, 65, 81],
        lineColor: [243, 244, 246], // Very light grey horizontal dividers
        lineWidth: 0.2
      },
      body: [
        ['Report Period', dateRangeText],
        ['Sensor Group', sensorFilterLabel],
        ['Analysis Type', periodLabel],
        ['Generated At', generatedStr],
        ['System Status', 'All Sensors Audited']
      ],
      columnStyles: { 
        0: { fontStyle: 'bold', cellWidth: 40, textColor: [100, 116, 139] }, 
        1: { textColor: [17, 24, 39] } 
      }
    });

    // ══════════════════════════════════════════════════════════════════
    // PAGE 2 — SENSOR LOCATION DETAILS
    // ══════════════════════════════════════════════════════════════════
    doc.addPage();
    let curY = sectionTitle('Sensor Location Details', 20);

    const sensorRows = [];
    uniqueNodes.forEach(nid => {
      const loc = locationMap[nid] || { buildingName: 'Unknown', floorName: 'Unknown', roomName: 'Unknown' };
      const lastLog = filtered.filter(l => l.nodeId === nid).sort((a, b) => b.timestamp - a.timestamp)[0];
      const monitorStatus = lastLog ? (lastLog.status === 'online' ? 'Active' : 'Inactive') : 'Unknown';
      const sensorStatus = lastLog ? (lastLog.status.charAt(0).toUpperCase() + lastLog.status.slice(1)) : 'Unknown';
      sensorRows.push([
        sensorNameMap[nid] || nid,
        nid,
        loc.buildingName,
        loc.floorName,
        loc.roomName,
        globalAirconMap[nid] || 'Split Type (Inverter)',
        monitorStatus,
        sensorStatus
      ]);
    });

    doc.autoTable({
      startY: curY,
      margin: { left: MARGIN, right: MARGIN },
      head: [['Sensor Name', 'Sensor ID', 'Building', 'Floor', 'Room', 'Attached Aircon Type', 'Monitoring Status', 'Sensor Status']],
      body: sensorRows,
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
    // PAGE 3 — MONITORING SUMMARY (KPI CARDS)
    // ══════════════════════════════════════════════════════════════════
    doc.addPage();
    curY = sectionTitle('Monitoring Summary', 20);

    const energyText = document.getElementById('energyConsumption')?.textContent || '-- kWh';
    const activeCoolHrs = filtered.length > 0
      ? ((acActive / filtered.length) * hoursUsed).toFixed(1)
      : '0.0';

    // ── Estimated Bill for PDF (matches selected period) ──
    const pdfEnergyKwh = parseFloat(energyText) || 0;
    const pdfEstBill = pdfEnergyKwh * DAVAO_LIGHT_RATE;
    const fmtP = (v) => 'PHP ' + v.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const cardW = 60; const cardH = 30; const gap = 7;
    const startX = MARGIN + 4;

    // Row 1 — 4 cards
    const row1 = [
      { label: 'Total Records', value: stats.totalRecords, color: ACCENT },
      { label: 'Avg Temperature', value: stats.avgTemp === '--' ? '--' : stats.avgTemp + '°C', color: ACCENT },
      { label: 'Avg Airflow Pressure', value: stats.avgPressure === '--' ? '--' : stats.avgPressure + ' kPa', color: ACCENT },
      { label: 'Energy Consumption', value: energyText, color: [234, 179, 8] }
    ];
    row1.forEach((c, i) => drawKpiCard(startX + i * (cardW + gap), curY, cardW, cardH, c.label, c.value, c.color));
    curY += cardH + gap;

    // Row 2 — 4 cards
    const row2 = [
      { label: `Est. ${periodLabel} Bill`, value: fmtP(pdfEstBill), color: [234, 179, 8] },
      { label: 'Online Sensors', value: onlineNodes.size, color: ACCENT },
      { label: 'Offline Sensors', value: offlineNodes.size, color: [239, 68, 68] },
      { label: 'Avg Battery %', value: avgBat.toFixed(1) + '%', color: ACCENT }
    ];
    row2.forEach((c, i) => drawKpiCard(startX + i * (cardW + gap), curY, cardW, cardH, c.label, c.value, c.color));
    curY += cardH + gap;

    // Row 3 — 4 cards
    const row3 = [
      { label: 'Avg RSSI %', value: avgRssi.toFixed(1) + '%', color: ACCENT },
      { label: 'Active Cooling Duration', value: activeCoolHrs + ' hrs', color: [59, 130, 246] },
      { label: 'Total Runtime Hours', value: hoursUsed.toFixed(1) + ' hrs', color: DARK_GREEN },
      { label: 'Davao Light Rate', value: 'PHP 10.35/kWh', color: ACCENT }
    ];
    row3.forEach((c, i) => drawKpiCard(startX + i * (cardW + gap), curY, cardW, cardH, c.label, c.value, c.color));

    // ══════════════════════════════════════════════════════════════════
    // PAGE 4 — INITIAL & FINAL SENSOR READINGS
    // ══════════════════════════════════════════════════════════════════
    doc.addPage();
    curY = sectionTitle('Initial & Final Sensor Readings', 20);

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
        head: [['Timestamp', 'Sensor', 'Building', 'Floor', 'Room', 'Attached Aircon Type', 'AC State', 'Temp', 'Pressure', 'Battery', 'RSSI', 'Status']],
        body: [[r.ts, r.name, r.building, r.floor, r.room, r.type, r.ac,
                r.temp.toFixed(0) + '°C', r.pres.toFixed(1) + ' kPa',
                r.batP.toFixed(0) + '%', r.rssiP.toFixed(0) + '%', r.status]]
      });
      return doc.lastAutoTable.finalY + 10;
    }

    curY = readingTable(firstLog, 'First Recorded Reading', curY);
    readingTable(lastLog, 'Last Recorded Reading', curY);

    // ══════════════════════════════════════════════════════════════════
    // PAGE 5 — SENSOR AGGREGATION SUMMARY
    // ══════════════════════════════════════════════════════════════════
    doc.addPage();
    let curY5 = sectionTitle('Sensor Aggregation Summary', 20);

    const sensorAggMap = {};
    filtered.forEach(log => {
      const sName = sensorNameMap[log.nodeId] || log.nodeId;
      if (!sensorAggMap[sName]) {
        sensorAggMap[sName] = { name: sName, temps: [], press: [], acOn: 0, count: 0 };
      }
      sensorAggMap[sName].temps.push(log.temperature);
      sensorAggMap[sName].press.push(log.pressure);
      if (log.acState === 'ACTIVE COOLING') sensorAggMap[sName].acOn++;
      sensorAggMap[sName].count++;
    });

    const summaryBody = Object.values(sensorAggMap).map(s => {
      const avgTemp = s.temps.reduce((a, b) => a + b, 0) / s.temps.length;
      const maxTemp = Math.max(...s.temps);
      const avgPres = s.press.reduce((a, b) => a + b, 0) / s.press.length;
      const acRatio = (s.acOn / s.count) * 100;
      return [
        s.name,
        avgTemp.toFixed(0) + '°C',
        maxTemp.toFixed(0) + '°C',
        avgPres.toFixed(1) + ' kPa',
        acRatio.toFixed(0) + '%',
        s.count.toString()
      ];
    });

    doc.autoTable({
      startY: curY5,
      margin: { left: MARGIN, right: MARGIN },
      head: [['Sensor Name', 'Average Temp', 'Peak Temp', 'Average Pressure', 'AC Active (%)', 'Total Readings']],
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
    const minPres = Math.min(...pressures);
    const maxPres = Math.max(...pressures);
    const avgPresVal = pressures.reduce((a, b) => a + b, 0) / pressures.length;

    // Temperature Analysis
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
    const leftTableY = doc.lastAutoTable.finalY;

    // Airflow Pressure Analysis
    doc.autoTable({
      startY: curY,
      margin: { left: pageW / 2 + 5, right: MARGIN },
      head: [['Airflow Pressure Analysis', 'Value']],
      body: [
        ['Average Pressure', avgPresVal.toFixed(1) + ' kPa'],
        ['Minimum Pressure', minPres.toFixed(1) + ' kPa'],
        ['Maximum Pressure', maxPres.toFixed(1) + ' kPa']
      ],
      theme: 'striped',
      styles: { fontSize: 8.5, cellPadding: 3.5, textColor: [55, 65, 81], lineColor: [229, 231, 235], lineWidth: 0.1 },
      headStyles: { fillColor: DARK_GREEN, textColor: WHITE, fontStyle: 'bold', fontSize: 8.5, cellPadding: 4 },
      alternateRowStyles: { fillColor: [249, 250, 251] }
    });
    const rightTableY = doc.lastAutoTable.finalY;

    const envTableEnd = Math.max(leftTableY, rightTableY) + 8;

    // Operational Analysis
    doc.autoTable({
      startY: envTableEnd,
      margin: { left: MARGIN, right: MARGIN },
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

    let afterOps = doc.lastAutoTable.finalY + 8;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(75, 85, 99); // Gray-600
    const interpText = `Summary: Temperature ranged from ${minTemp.toFixed(0)}°C to ${maxTemp.toFixed(0)}°C (avg ${avgTempVal.toFixed(0)}°C). ` +
      `Airflow pressure ranged from ${minPres.toFixed(1)} kPa to ${maxPres.toFixed(1)} kPa. ` +
      `Active cooling was engaged for ${acActive} out of ${filtered.length} events (${((acActive / filtered.length) * 100).toFixed(1)}%).`;
    const interpLines = doc.splitTextToSize(interpText, pageW - MARGIN * 2);
    doc.text(interpLines, MARGIN, afterOps);

    // ══════════════════════════════════════════════════════════════════
    // NEXT PAGES — VISUAL ANALYTICS (Charts)
    // ══════════════════════════════════════════════════════════════════
    const chartLabels = filtered.map((l, i) => {
      if (filtered.length <= 30) {
        return l.timestamp.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      }
      // sample labels for readability
      return i % Math.ceil(filtered.length / 20) === 0
        ? l.timestamp.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit' })
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

    const getDynLabel = (lbl) => currentNodeFilter ? `${lbl} — ${sensorFilterLabel}` : lbl;

    // Render all 6 charts
    const [tempChart, presChart, batChart, rssiChart, acChart, statusChart] = await Promise.all([
      renderChart(lineOpts(getDynLabel('Temperature Trend Over Time (°C)'), temps, '#10b981'), 700, 350),
      renderChart(lineOpts(getDynLabel('Airflow Pressure Trend Over Time (kPa)'), pressures, '#3b82f6'), 700, 350),
      renderChart(lineOpts(getDynLabel('Battery Level Trend (%)'), batteries, '#f59e0b'), 700, 350),
      renderChart(lineOpts(getDynLabel('RSSI Signal Strength Trend (%)'), rssis, '#8b5cf6'), 700, 350),
      renderChart(doughnutOpts(getDynLabel('Aircon State Distribution'),
        ['Active Cooling', 'Fan Only', 'Off'], [acActive, acFan, acOff],
        ['#10b981', '#f59e0b', '#ef4444']), 500, 400),
      renderChart(doughnutOpts(getDynLabel('Sensor Status Distribution'),
        ['Online', 'Offline'], [onlineCount, offlineCount],
        ['#10b981', '#ef4444']), 500, 400)
    ]);

    // Charts page 1 — line charts (2 per page)
    const chartPairs = [
      [{ img: tempChart, title: getDynLabel('Temperature Trend Over Time') }, { img: presChart, title: getDynLabel('Airflow Pressure Trend Over Time') }],
      [{ img: batChart, title: getDynLabel('Battery Level Trend') }, { img: rssiChart, title: getDynLabel('RSSI Signal Strength Trend') }]
    ];

    for (const pair of chartPairs) {
      doc.addPage();
      sectionTitle('Visual Analytics', 20);
      const chartW = (pageW - MARGIN * 2 - 10) / 2;
      const chartH = chartW * 0.55;
      pair.forEach((ch, idx) => {
        const x = MARGIN + idx * (chartW + 10);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...DARK_GREEN);
        doc.text(ch.title, x + chartW / 2, 30, { align: 'center' });
        doc.addImage(ch.img, 'PNG', x, 33, chartW, chartH);
      });
    }

    // Charts page 3 — doughnut charts
    doc.addPage();
    sectionTitle('Visual Analytics — Distribution', 20);
    const doughW = (pageW - MARGIN * 2 - 10) / 2;
    const doughH = doughW * 0.65;
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...DARK_GREEN);
    
    doc.text(getDynLabel('Aircon State Distribution'), MARGIN + doughW / 2, 30, { align: 'center' });
    doc.addImage(acChart, 'PNG', MARGIN, 33, doughW, doughH);
    
    doc.text(getDynLabel('Sensor Status Distribution'), MARGIN + doughW + 10 + doughW / 2, 30, { align: 'center' });
    doc.addImage(statusChart, 'PNG', MARGIN + doughW + 10, 33, doughW, doughH);

    // ══════════════════════════════════════════════════════════════════
    // NEXT PAGE — PREDICTIVE ANALYTICS
    // ══════════════════════════════════════════════════════════════════
    doc.addPage();
    curY = sectionTitle('Predictive Analytics', 20);

    let predKwh = 'Unavailable';
    let predRate = 'Unavailable';
    let predModel = (ALGO_TO_MODEL[selectedAlgorithm] || 'random_forest').replace(/_/g, ' ');
    predModel = predModel.charAt(0).toUpperCase() + predModel.slice(1);

    try {
      const avgT = parseFloat(stats.avgTemp);
      const avgP = parseFloat(stats.avgPressure);
      if (!isNaN(avgT) && !isNaN(avgP)) {
        const res = await fetch(`${BACKEND_URL}/api/predict-energy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: ALGO_TO_MODEL[selectedAlgorithm] || 'random_forest',
            avg_temp: avgT,
            avg_pressure: avgP,
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

    let predEndY = doc.lastAutoTable.finalY + 8;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(75, 85, 99); // Gray-600
    const predInterp = predKwh !== 'Unavailable'
      ? `Summary: The ${predModel} model estimates an energy consumption of ${predKwh} for the current monitoring period (${dateRangeText}), translating to a rate of approximately ${predRate}. This prediction accounts for average temperature, pressure, AC on-ratio, and runtime hours.`
      : 'Summary: Prediction is currently unavailable. Ensure the Flask backend prediction API is running and accessible.';
    doc.text(doc.splitTextToSize(predInterp, pageW - MARGIN * 2), MARGIN, predEndY);

    // ══════════════════════════════════════════════════════════════════
    // EXTRA SECTIONS (Installation, Rules Compliance, Energy Ranking)
    // ══════════════════════════════════════════════════════════════════
    await addExtraPdfSections(doc, filtered, locationMap, sensorNameMap, globalAirconMap, globalInstallDateMap, pageW, MARGIN, addHeaderFooter, sectionTitle, addTableExplanation, DARK_GREEN, ACCENT, WHITE, LIGHT_GRAY, DARK_TEXT, currentPeriod, ALGO_TO_MODEL, selectedAlgorithm);

    // ══════════════════════════════════════════════════════════════════
    // LAST PAGE — EXECUTIVE SUMMARY
    // ══════════════════════════════════════════════════════════════════
    doc.addPage();
    curY = sectionTitle('Executive Summary', 20);

    const totalSensors = uniqueNodes.size;
    const onlinePct = totalSensors > 0 ? ((onlineNodes.size / totalSensors) * 100).toFixed(0) : 0;
    const tempStability = (maxTemp - minTemp) <= 5 ? 'stable' : 'showing significant variation';
    const presStability = (maxPres - minPres) <= 20 ? 'within normal range' : 'showing notable fluctuations';
    const acEfficiency = acActive > acOff ? 'predominantly in active cooling mode' : 'mostly in standby/off mode';
    const batteryHealth = avgBat >= 60 ? 'healthy' : avgBat >= 30 ? (currentNodeFilter ? 'moderate — consider replacement soon' : 'moderate — consider replacements soon') : 'critically low — immediate attention needed';
    const signalQuality = avgRssi >= 60 ? 'strong' : avgRssi >= 30 ? 'acceptable but could be improved' : (currentNodeFilter ? 'poor — consider repositioning the sensor' : 'poor — consider repositioning sensors');

    const perfText = currentNodeFilter
      ? `The sensor ${sensorFilterLabel} was monitored during the ${periodLabel.toLowerCase()} period (${dateRangeText}). It was ${onlineNodes.size > 0 ? 'online' : 'offline'} at its most recent reading, producing ${filtered.length} total telemetry records.`
      : `A total of ${totalSensors} sensor(s) were monitored during the ${periodLabel.toLowerCase()} period (${dateRangeText}). Of these, ${onlineNodes.size} (${onlinePct}%) were online at their most recent reading, producing ${filtered.length} total telemetry records.`;

    const acText = currentNodeFilter
      ? `The air conditioning unit was ${acEfficiency}, with ${acActive} active cooling events, ${acFan} fan-only events, and ${acOff} off events across the period. Active cooling accounted for ${((acActive / filtered.length) * 100).toFixed(1)}% of total events.`
      : `Air conditioning systems were ${acEfficiency}, with ${acActive} active cooling events, ${acFan} fan-only events, and ${acOff} off events across the period. Active cooling accounted for ${((acActive / filtered.length) * 100).toFixed(1)}% of total events.`;

    const batText = currentNodeFilter
      ? `The battery level for this sensor averages ${avgBat.toFixed(1)}% — assessed as ${batteryHealth}. The RSSI signal strength averages ${avgRssi.toFixed(1)}% — assessed as ${signalQuality}. ${offlineCount} offline event(s) were recorded.`
      : `Average battery level across all sensors is ${avgBat.toFixed(1)}% — assessed as ${batteryHealth}. Average RSSI signal strength is ${avgRssi.toFixed(1)}% — assessed as ${signalQuality}. ${offlineCount} offline event(s) were recorded.`;

    // ── Estimated Bill for Executive Summary (matches selected period) ──
    const execEnergyKwh = parseFloat(energyText) || 0;
    const execEstBill = execEnergyKwh * DAVAO_LIGHT_RATE;
    const fmtExec = (v) => 'PHP ' + v.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const billText = execEnergyKwh > 0
      ? `Based on Davao Light's residential rate of PHP 10.35/kWh (May 2026), the estimated ${periodLabel.toLowerCase()} electricity bill is ${fmtExec(execEstBill)} for a predicted energy consumption of ${energyText}. This estimate is computed from the ML energy prediction model output multiplied by the prevailing residential electricity rate.`
      : 'Estimated electricity bill is unavailable due to insufficient energy consumption data.';

    const execSections = [
      { header: 'OVERALL SENSOR PERFORMANCE', text: perfText },
      { header: 'ENVIRONMENTAL STABILITY', text: `Temperature readings were ${tempStability}, ranging from ${minTemp.toFixed(0)}°C to ${maxTemp.toFixed(0)}°C with an average of ${avgTempVal.toFixed(0)}°C. Airflow pressure readings were ${presStability}, averaging ${avgPresVal.toFixed(1)} kPa.` },
      { header: 'AC OPERATIONAL BEHAVIOR', text: acText },
      { header: 'ESTIMATED ELECTRICITY BILL (PHP)', text: billText },
      { header: 'SENSOR RELIABILITY', text: batText }
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
    doc.save(`EcoTrack_SensorLog_Report_${currentPeriod}_${dateStr}.pdf`);

  } catch (error) {
    console.error('Could not export PDF:', error);
    alert('Failed to export PDF. See console for details.');
  }
}

// ── EXTRA PDF SECTIONS (Installation, Rules Compliance, Energy Ranking) ──
async function addExtraPdfSections(doc, filtered, locationMap, sensorNameMap, airconMap, installDateMap, pageW, MARGIN, addHeaderFooter, sectionTitle, addTableExplanation, DARK_GREEN, ACCENT, WHITE, LIGHT_GRAY, DARK_TEXT, currentPeriod, ALGO_TO_MODEL, selectedAlgorithm) {
  // 1. SENSOR INSTALLATION DIRECTORY
  doc.addPage();
  let curY = sectionTitle('Sensor Installation Directory', 20);
  
  const uniqueNodesMap = new Map();
  filtered.forEach(log => {
    if (!uniqueNodesMap.has(log.nodeId)) {
      const loc = locationMap[log.nodeId] || { buildingName: 'Unknown', floorName: 'Unknown', roomName: 'Unknown' };
      uniqueNodesMap.set(log.nodeId, {
        id: log.nodeId,
        name: sensorNameMap[log.nodeId] || log.nodeId,
        building: loc.buildingName,
        floor: loc.floorName,
        room: loc.roomName,
        acType: airconMap[log.nodeId] || 'Split Type (Inverter)',
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
    head: [['Building', 'Floor', 'Room', 'Sensor Name', 'Attached Aircon Type', 'Install Date & Time', 'Status']],
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
    if (sb) {
      const { data, error } = await sb.from('notifications').select('*').order('created', { ascending: false });
      if (!error && data) notifs = data;
    }
    
    // Determine the time range for the current report to filter notifications
    let minT = 0, maxT = Date.now();
    if (filtered.length > 0) {
      const timestamps = filtered.map(l => l.timestamp.getTime());
      minT = Math.min(...timestamps);
      maxT = Math.max(...timestamps);
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
      
      let hardwareId = 'Unknown Sensor';
      let reason = (n.content || '').replace('__INBOX_DISMISSED__|||', '');
      
      // Parse the notification content which is usually "HardwareID|||Message"
      if (reason.includes('|||')) {
        const parts = reason.split('|||');
        hardwareId = parts[0];
        reason = parts.slice(1).join('|||'); // Join back in case message had |||
      } else if (sensorNameMap[n.room_id]) {
        // Fallback
        hardwareId = sensorNameMap[n.room_id];
      }
      
      // Map hardwareId to location using locationMap (which now has node.name mapped)
      const loc = locationMap[hardwareId] || { buildingName: 'Unknown', floorName: 'Unknown', roomName: 'Unknown' };
      
      // Apply the active sensor filter (currentNodeFilter stores the PocketBase ID)
      if (currentNodeFilter) {
        const expectedHardwareId = sensorNameMap[currentNodeFilter] || currentNodeFilter;
        if (hardwareId !== expectedHardwareId) {
          return; // Skip this notification since it doesn't match the selected sensor
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
  violationData.sort((a, b) => new Date(b[5]) - new Date(a[5]));

  if (violationData.length === 0) violationData = [['-', '-', '-', '-', 'No violations recorded during this period', '-']];

  doc.autoTable({
    startY: curY,
    margin: { left: MARGIN, right: MARGIN },
    head: [['Building', 'Floor', 'Room', 'Sensor', 'Violation Details', 'Date/Time']],
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

  const logsByRoomLoc = {};
  filtered.forEach(t => {
    const loc = locationMap[t.nodeId] || { buildingName: 'Unknown', floorName: 'Unknown', roomName: 'Unknown' };
    const roomKey = `${loc.buildingName}|||${loc.floorName}|||${loc.roomName}`;
    if (!logsByRoomLoc[roomKey]) logsByRoomLoc[roomKey] = [];
    logsByRoomLoc[roomKey].push(t);
  });

  const energyRankings = [];
  
  // Need to process sequentially to avoid overwhelming Flask backend if there are many rooms
  for (const roomKey in logsByRoomLoc) {
     const recs = logsByRoomLoc[roomKey];
     if (!recs || recs.length === 0) continue;
     
     let sumTemp = 0, sumPres = 0, acOnCount = 0;
     recs.forEach(r => {
        sumTemp += Number(r.temperature) || 0;
        sumPres += Number(r.pressure) || 0;
        let ac = 'ACTIVE COOLING';
        if (Number(r.temperature) >= 28) ac = 'OFF';
        if (r.status !== 'online') ac = 'OFF';
        if (ac !== 'OFF') acOnCount++;
     });
     
     const avgT = sumTemp / recs.length;
     const avgP = sumPres / recs.length;
     const acOnRatio = acOnCount / recs.length;
     
     const timestamps = recs.map(r => new Date(r.timestamp).getTime());
     const minT = Math.min(...timestamps);
     const maxT = Math.max(...timestamps);
     let hoursUsed = (maxT - minT) / (1000 * 60 * 60);
     if (hoursUsed === 0) hoursUsed = 1;
     
     let kwh = 0;
     try {
       const res = await fetch(`${BACKEND_URL}/api/predict-energy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: ALGO_TO_MODEL[selectedAlgorithm] || 'random_forest',
            avg_temp: avgT,
            avg_pressure: avgP,
            period: currentPeriod,
            ac_on_ratio: acOnRatio,
            hours_used: hoursUsed
          })
       });
       if (res.ok) {
         const data = await res.json();
         kwh = data.kwh || 0;
       }
     } catch (e) { /* ignore */ }
     
     const parts = roomKey.split('|||');
     energyRankings.push({
       building: parts[0],
       floor: parts[1],
       room: parts[2],
       kwh: kwh
     });
  }

  energyRankings.sort((a, b) => b.kwh - a.kwh);
  
  const fmtRank = (v) => 'PHP ' + v.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const rankPeriodLabel = currentPeriod.charAt(0).toUpperCase() + currentPeriod.slice(1);

  let rankingBody = energyRankings.map((r, i) => [
     (i + 1).toString(), r.building, r.floor, r.room, r.kwh.toFixed(2) + ' kWh', fmtRank(r.kwh * DAVAO_LIGHT_RATE)
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
  addTableExplanation(`Note: Estimates are based on Davao Light's residential rate of PHP 10.35/kWh.`);

  addHeaderFooter();
}
