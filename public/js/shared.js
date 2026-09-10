// ===== ECOTRACK SHARED UTILITIES =====
const API_BASE = 'http://localhost:5000/api';


// ===== SHARED STATE =====
const appState = {
  currentTemp: 0,
  currentPressure: 0,
  batteryVoltage: 3.8,
  batteryUsable: true,
  rssi: 0,
  isConnected: false,
  historicalData: { temps: [], pressures: [], timestamps: [] },
  isSleeping: true,
  lastUpdate: Date.now(),
  logMessages: [],
  maxLogs: 50
};

// ===== API CALLS =====
async function fetchAPI(endpoint) {
  try {
    const response = await fetch(`${API_BASE}${endpoint}`);
    if (response.ok) {
      return await response.json();
    }
  } catch (error) {
    console.error(`API Error: ${endpoint}`, error);
  }
  return null;
}

async function postAPI(endpoint, data) {
  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (response.ok) {
      return await response.json();
    }
  } catch (error) {
    console.error(`API Error: ${endpoint}`, error);
  }
  return null;
}

// ===== SENSOR SIMULATION =====
// Mock data removed in favor of live telemetry.

// Page loader removed.

// ===== UTILITY FUNCTIONS =====
function estimateACDial(temp) {
  if (temp < 20) return 'Off';
  if (temp < 24) return 'Eco';
  if (temp < 28) return 'Active Cooling';
  return 'Cold';
}

function getACDescription(acMode) {
  const descriptions = {
    'Off': 'No active cooling',
    'Eco': 'Light cooling mode',
    'Active Cooling': 'Standard cooling',
    'Cold': 'Maximum cooling'
  };
  return descriptions[acMode] || 'Unknown';
}

function calculateEfficiency(temp) {
  const optimal = 24;
  const deviation = Math.abs(temp - optimal);
  return Math.max(0, 100 - (deviation * 5));
}

function updateRSSIBars(rssi) {
  const bars = document.querySelectorAll('#rssiBar div');
  const signal = Math.max(0, Math.min(100, (rssi + 100) * 2));
  const activeCount = Math.ceil((signal / 100) * 5);

  bars.forEach((bar, i) => {
    if (i < activeCount) {
      bar.className = 'w-2 h-6 bg-cyan-500';
    } else {
      bar.className = 'w-2 h-6 bg-slate-700';
    }
  });
}

function updateConnectionStatus(isConnected) {
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const sidebarStatus = document.getElementById('sidebarStatus');
  const sidebarStatusText = document.getElementById('sidebarStatusText');

  if (isConnected) {
    statusDot && (statusDot.className = 'w-3 h-3 bg-green-500 rounded-full animate-pulse');
    statusText && (statusText.textContent = 'Online');
    sidebarStatus && (sidebarStatus.className = 'w-3 h-3 bg-green-500 rounded-full animate-pulse');
    sidebarStatusText && (sidebarStatusText.textContent = 'Online');
  } else {
    statusDot && (statusDot.className = 'w-3 h-3 bg-red-500 rounded-full');
    statusText && (statusText.textContent = 'Offline');
    sidebarStatus && (sidebarStatus.className = 'w-3 h-3 bg-red-500 rounded-full');
    sidebarStatusText && (sidebarStatusText.textContent = 'Offline');
  }
}

function addLog(message) {
  const timestamp = new Date().toLocaleTimeString();
  const logEntry = `[${timestamp}] ${message}`;

  appState.logMessages.push(logEntry);
  if (appState.logMessages.length > appState.maxLogs) {
    appState.logMessages.shift();
  }

  updateLogDisplay();
}

function updateLogDisplay() {
  const logConsole = document.getElementById('logConsole');
  if (logConsole) {
    logConsole.innerHTML = appState.logMessages
      .map(msg => `<div>${msg}</div>`)
      .join('');
    logConsole.scrollTop = logConsole.scrollHeight;
  }
}

async function checkBackendConnection() {
  let pythonOk = false;
  let pocketbaseOk = false;
  let supabaseOk = false;

  // 1. Check Python Backend
  try {
    const pyResponse = await fetch(`${API_BASE}/health`);
    if (pyResponse.ok) {
      pythonOk = true;
    }
  } catch (error) {
    console.warn('Python backend not responding');
  }

  // 2. Check PocketBase Database (Sensor Logs Engine)
  try {
    const pbResponse = await fetch(`http://127.0.0.1:8090/api/health`);
    if (pbResponse.ok) {
      pocketbaseOk = true;
    }
  } catch (error) {
    console.warn('PocketBase (sensor logs engine) not responding');
  }

  // 3. Check Supabase
  if (typeof window.supabaseClient !== 'undefined' && window.ECOTRACK_CONFIG?.isSupabaseConfigured()) {
    try {
      const { error } = await window.supabaseClient.from('nodes').select('id', { count: 'exact', head: true });
      if (!error) {
        supabaseOk = true;
      }
    } catch (e) { }
  } else {
    // If not configured yet or offline, allow operational mode
    supabaseOk = true;
  }

  // Update App State & Logs
  if (pythonOk && pocketbaseOk) {
    if (!appState.isConnected) addLog('System Online: Connected to Python, PocketBase (Sensor Logs) & Supabase');
    appState.isConnected = true;
    updateConnectionStatus(true);
  } else if (pythonOk && !pocketbaseOk) {
    addLog('Warning: Connected to Python & Supabase, but PocketBase (Sensor Logs) is offline');
    appState.isConnected = false;
    updateConnectionStatus(false);
  } else if (!pythonOk && pocketbaseOk) {
    addLog('Warning: Connected to PocketBase but Python Backend is offline');
    appState.isConnected = false;
    updateConnectionStatus(false);
  } else {
    addLog('System Offline: Python & PocketBase are unreachable');
    appState.isConnected = false;
    updateConnectionStatus(false);
  }
}

// ===== SESSION TIMEOUT & INACTIVITY WATCHER =====
let _sessionTimeoutTimer = null;
let _sessionWarningTimer = null;

function getSessionTimeoutMs() {
  const user = JSON.parse(localStorage.getItem('ecoTrack_profile_user') || '{}');
  const timeoutSetting = localStorage.getItem('ecoTrack_session_timeout') || user.session_timeout || '30 minutes';
  
  if (timeoutSetting === '15 minutes') return 15 * 60 * 1000;
  if (timeoutSetting === '30 minutes') return 30 * 60 * 1000;
  if (timeoutSetting === '60 minutes') return 60 * 60 * 1000;
  if (timeoutSetting === 'Never') return 0; // Disabled
  return 30 * 60 * 1000; // Default: 30 minutes
}

function resetSessionTimeoutTimer() {
  // Do not run timeout on login page
  const path = window.location.pathname.toLowerCase();
  if (path.endsWith('login.html') || path.endsWith('/login')) {
    return;
  }

  const timeoutMs = getSessionTimeoutMs();
  if (timeoutMs === 0) {
    if (_sessionTimeoutTimer) clearTimeout(_sessionTimeoutTimer);
    if (_sessionWarningTimer) clearTimeout(_sessionWarningTimer);
    return;
  }

  if (_sessionTimeoutTimer) clearTimeout(_sessionTimeoutTimer);
  if (_sessionWarningTimer) clearTimeout(_sessionWarningTimer);

  // Warning 1 minute before timeout
  const warningMs = Math.max(10000, timeoutMs - 60000);
  _sessionWarningTimer = setTimeout(() => {
    if (typeof showEcoTrackToast === 'function') {
      showEcoTrackToast('⚠️ Your session will expire in 1 minute due to inactivity.', 'warning');
    }
  }, warningMs);

  _sessionTimeoutTimer = setTimeout(() => {
    console.warn('[EcoTrack] Session timed out due to inactivity.');
    try {
      sessionStorage.clear();
    } catch (e) {}
    window.location.href = 'login.html?timeout=true';
  }, timeoutMs);
}

function initSessionTimeoutWatcher() {
  const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
  events.forEach(event => {
    window.addEventListener(event, resetSessionTimeoutTimer, { passive: true });
  });
  resetSessionTimeoutTimer();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSessionTimeoutWatcher);
} else {
  initSessionTimeoutWatcher();
}

// Fix keyboard focus routing bug in Chromium/Electron/WebViews on alt-tab window focus
window.addEventListener('focus', () => {
  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
    active.blur();
    active.focus();
  }
});

// ===== RULE VIOLATION AUDIT HISTORY (Persistent Store) =====
// Ensures that rule violations in Rule Management (benchmarking, rankings, history board)
// are permanently preserved even when a user clears or erases notifications from the Notification page inbox.
const ECOTRACK_VIOLATION_AUDIT_KEY = 'ecoTrack_violation_audit_history';

function getStoredViolationAuditHistory() {
  try {
    const raw = localStorage.getItem(ECOTRACK_VIOLATION_AUDIT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function saveViolationToAuditHistory(notif) {
  if (!notif) return;
  try {
    const history = getStoredViolationAuditHistory();
    const rawContent = String(notif.rawContent || notif.content || notif.message || '')
      .replace(/^__INBOX_DISMISSED__\|\|\|/, '')
      .trim();
    if (!rawContent) return;

    // Routine schedule alerts and battery notices are notifications only, not environmental compliance violations
    const textLower = rawContent.toLowerCase();
    if (textLower.includes('sensor wake up') || textLower.includes('sensor sleep') || textLower.includes('schedule applied') || textLower.includes('battery')) {
      return;
    }

    const notifId = String(notif.id || notif.pbId || '').trim();
    const dateStr = notif.date || (notif.created ? new Date(notif.created).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]);
    const timeStr = notif.time || (notif.created ? new Date(notif.created).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) : '');
    const roomId = notif.room_id || notif.room || notif.roomId || null;
    const ruleId = notif.rule_id || notif.ruleId || null;

    const existsIndex = history.findIndex(h => {
      if (notifId && h.id && String(h.id) === notifId) return true;
      if (h.content === rawContent && h.date === dateStr && String(h.room_id) === String(roomId)) return true;
      return false;
    });

    const entry = {
      id: notifId || `v_hist_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      pbId: notifId,
      room_id: roomId,
      rule_id: ruleId,
      content: rawContent,
      date: dateStr,
      time: timeStr,
      created: notif.created || new Date().toISOString(),
      triggered: true,
      archived: true
    };

    if (existsIndex >= 0) {
      history[existsIndex] = { ...history[existsIndex], ...entry };
    } else {
      history.unshift(entry);
    }

    if (history.length > 5000) {
      history.length = 5000;
    }

    localStorage.setItem(ECOTRACK_VIOLATION_AUDIT_KEY, JSON.stringify(history));
  } catch (err) {
    console.warn('[EcoTrack] Failed to save violation to audit history:', err);
  }
}

window.getStoredViolationAuditHistory = getStoredViolationAuditHistory;
window.saveViolationToAuditHistory = saveViolationToAuditHistory;

