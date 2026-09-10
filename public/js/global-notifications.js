// ===== GLOBAL NOTIFICATION & RULES MONITORING SYSTEM =====
// This script is included on all EcoTrack pages to provide background rule monitoring and alert notifications.

let globalTriggeredCount = 0;
let _cachedRules = null;
let _cachedRuleNodes = null;
let _lastRulesFetchTime = 0;
const _ruleViolationTracking = {};
const _recentTriggeredKeys = new Set();

// Update badge on all pages
async function updateGlobalNotificationBadge() {
  try {
    const readState = JSON.parse(localStorage.getItem('ecoTrackNotificationReadState') || '{}');
    
    let records = [];
    const sb = window.supabaseClient || window.sb;
    if (sb) {
      try {
        const { data, error } = await sb
          .from('notifications')
          .select('*')
          .order('created', { ascending: false });
        if (!error && data) {
          records = data;
        }
      } catch (e) {
        // Supabase query error
      }
    }
    
    globalTriggeredCount = records.filter(notification => 
      notification.triggered &&
      !(notification.content && String(notification.content).startsWith('__INBOX_DISMISSED__|||')) &&
      !readState[String(notification.id || notification.pbId || notification.id_internal || '')]
    ).length;
    
    // Update sidebar bell badge
    const badge = document.getElementById('notificationBadge');
    if (badge) {
      if (globalTriggeredCount > 0) {
        badge.classList.remove('hidden');
        badge.style.display = 'flex';
        badge.textContent = globalTriggeredCount;
      } else {
        badge.classList.add('hidden');
        badge.style.display = '';
      }
    }

    // Update analytics page alerts badge if it exists
    const analyticsBadge = document.getElementById('analyticsAlertsBadge');
    if (analyticsBadge) {
      analyticsBadge.textContent = globalTriggeredCount;
      if (globalTriggeredCount > 0) {
        analyticsBadge.classList.remove('hidden');
        analyticsBadge.style.display = 'flex';
      } else {
        analyticsBadge.classList.add('hidden');
        analyticsBadge.style.display = 'none';
      }
    }
  } catch (error) {
    console.error('Could not load notification badge count:', error);
  }
}

// Dismiss notification dialog
function dismissGlobalNotification() {
  const dialog = document.getElementById('globalNotificationDialog');
  if (dialog) {
    dialog.style.display = 'none';
  }
  const pending = sessionStorage.getItem('pendingNav');
  if (pending) {
    try {
      const parsed = JSON.parse(pending);
      if (parsed.notif) {
        const readState = JSON.parse(localStorage.getItem('ecoTrackNotificationReadState') || '{}');
        readState[String(parsed.notif)] = true;
        localStorage.setItem('ecoTrackNotificationReadState', JSON.stringify(readState));
        updateGlobalNotificationBadge();
      }
    } catch (_) {}
  }
}

// Universal notification navigation helper: restores Electron window on Windows,
// persists navigation context, and either directs to Notification.html or opens the modal dynamically
function navigateToNotification(navContext = {}) {
  // 1. Restore & focus Electron window via IPC
  try {
    if (window.electron && typeof window.electron.send === 'function') {
      window.electron.send('focus-window');
    }
  } catch (_) {}

  try {
    window.focus();
  } catch (_) {}

  const roomId = navContext.room_id || navContext.room || '';
  const notifId = navContext.id || navContext.notif_id || navContext.notif || '';
  const sensor = navContext.sensor_name || navContext.sensor || '';
  const message = navContext.message || navContext.content || '';

  const navPayload = {
    room: roomId,
    notif: notifId,
    highlight: notifId,
    sensor: sensor,
    message: message,
    timestamp: Date.now()
  };

  try {
    sessionStorage.setItem('pendingNav', JSON.stringify(navPayload));
  } catch (_) {}

  try {
    localStorage.setItem('ecoTrack_pendingNotificationNav', JSON.stringify(navPayload));
  } catch (_) {}

  // 2. Check if we are ALREADY on Notification.html
  const currentPath = (window.location.pathname || '').toLowerCase();
  const isAlreadyOnNotifPage = currentPath.endsWith('notification.html') ||
                               (typeof window.focusAndOpenNotification === 'function');

  if (isAlreadyOnNotifPage && typeof window.focusAndOpenNotification === 'function') {
    window.focusAndOpenNotification(notifId, navPayload);
    return;
  }

  // 3. Otherwise navigate to Notification.html with query parameters
  let destUrl = 'Notification.html';
  const qParams = [];
  if (roomId) qParams.push(`room=${encodeURIComponent(roomId)}`);
  if (notifId) qParams.push(`notif=${encodeURIComponent(notifId)}`);
  if (sensor) qParams.push(`sensor=${encodeURIComponent(sensor)}`);
  if (qParams.length) destUrl += `?${qParams.join('&')}`;

  window.location.href = destUrl;
}

window.navigateToNotification = navigateToNotification;

// Function to trigger global notification from any page
function triggerGlobalNotification(message, notifContext = {}) {
  updateGlobalNotificationBadge(); // Re-sync from DB
  
  // Clean message for display if it includes node prefix
  let displayMessage = message;
  let sensorPrefix = '';
  if (displayMessage && displayMessage.includes('|||')) {
    const parts = displayMessage.split('|||');
    sensorPrefix = parts[0];
    displayMessage = parts.slice(1).join('|||');
  }

  const roomId = notifContext.room_id || notifContext.room || '';
  const notifId = notifContext.id || notifContext.notif_id || '';
  const sensorName = notifContext.sensor_name || sensorPrefix;

  // Store in pendingNav so clicking redirect takes user directly to this notification record
  const navData = {
    room: roomId,
    notif: notifId,
    highlight: notifId,
    sensor: sensorName,
    message: displayMessage,
    content: message,
    timestamp: Date.now()
  };
  try { sessionStorage.setItem('pendingNav', JSON.stringify(navData)); } catch (_) {}
  try { localStorage.setItem('ecoTrack_pendingNotificationNav', JSON.stringify(navData)); } catch (_) {}

  // Update redirect link on the global notification popup dialog
  const dialog = document.getElementById('globalNotificationDialog');
  const messageEl = document.getElementById('globalNotificationMessage');
  
  if (dialog) {
    const viewLinks = dialog.querySelectorAll('a[href*="Notification.html"], #goToNotificationsBtn');
    viewLinks.forEach(link => {
      link.onclick = (e) => {
        e.preventDefault();
        navigateToNotification({
          id: notifId,
          room_id: roomId,
          sensor_name: sensorName,
          message: displayMessage,
          content: message
        });
      };
    });
  }

  // Strip redundant leading status emojis (⏰, 🌙, ⚠️, 📅, 🌡️, 🔋) so only the notification title has the icon
  const cleanBodyMessage = (displayMessage || '').replace(/^[⏰🌙⚠️🌡️🔋📅\s]+/, '').trim();

  if (dialog && messageEl) {
    messageEl.textContent = cleanBodyMessage;
    const titleEl = dialog.querySelector('h3');
    if (titleEl) {
      if (displayMessage.includes('Wake Up')) {
        titleEl.textContent = '⏰ Sensor Wake Up!';
      } else if (displayMessage.includes('Sleep Schedule') || displayMessage.includes('Sleep')) {
        titleEl.textContent = '🌙 Sensor Sleep Mode!';
      } else {
        titleEl.textContent = 'New Notification!';
      }
    }
    const dialogCard = dialog.querySelector('div');
    if (dialogCard) {
      dialogCard.style.pointerEvents = 'auto';
    }
    dialog.style.backgroundColor = 'transparent';
    dialog.style.pointerEvents = 'none';
    dialog.style.display = 'flex';
  }

  // Native browser desktop notification with click redirect
  if (typeof Notification !== 'undefined') {
    if (Notification.permission === 'granted') {
      try {
        let notifTitle = '⚠️ EcoTrack Threshold Alert';
        if (displayMessage.includes('Wake Up')) notifTitle = '⏰ EcoTrack Sensor Wake Up';
        else if (displayMessage.includes('Sleep Schedule') || displayMessage.includes('Sleep')) notifTitle = '🌙 EcoTrack Sensor Sleep Schedule';

        const browserNotif = new Notification(notifTitle, {
          body: cleanBodyMessage,
          icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%2310b981" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>'
        });
        browserNotif.onclick = () => {
          navigateToNotification({
            id: notifId,
            room_id: roomId,
            sensor_name: sensorName,
            message: cleanBodyMessage,
            content: message
          });
        };
      } catch (_) {}
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission();
    }
  }

  // Dispatch global event and immediately re-evaluate rule violation benchmarks so every triggered alert is counted
  try {
    window.dispatchEvent(new CustomEvent('notification:triggered', {
      detail: { roomId, notifId, sensorName, message: displayMessage }
    }));
    if (typeof window.initRuleComplianceBenchmarking === 'function') {
      window.initRuleComplianceBenchmarking();
    }
    if (typeof window.renderComplianceChart === 'function') {
      window.renderComplianceChart();
    }
  } catch (_) {}
}

// Get current triggered count
function getTriggeredNotificationCount() {
  return globalTriggeredCount;
}

// Ensure resetting just forces a sync
function resetNotificationCount() {
  updateGlobalNotificationBadge();
}

window.syncNotificationBadges = updateGlobalNotificationBadge;

// ===== AUTOMATED BACKGROUND RULE EVALUATION ENGINE =====

async function getActiveRulesAndNodes() {
  const now = Date.now();
  const sb = window.supabaseClient || window.sb;
  if (!sb) return { rules: [], ruleNodes: [], nodes: [], rooms: [], nodeMap: {} };

  if (_cachedRules && (now - _lastRulesFetchTime) < 8000) {
    return {
      rules: _cachedRules,
      ruleNodes: _cachedRuleNodes || [],
      nodes: _cachedNodes || [],
      rooms: _cachedRooms || [],
      nodeMap: _cachedNodeMap || {}
    };
  }

  try {
    const [rulesRes, rnRes, nodesRes, roomsRes] = await Promise.all([
      sb.from('rules').select('*').eq('enabled', true),
      sb.from('rule_nodes').select('*'),
      sb.from('nodes').select('*'),
      sb.from('rooms').select('*')
    ]);

    const allNodes = nodesRes.data || [];
    const allRooms = roomsRes.data || [];
    const nodeMap = {};
    allNodes.forEach(n => {
      if (n.id) nodeMap[n.id] = n;
      if (n.name) nodeMap[n.name] = n;
    });

    const ruleNodes = (rnRes.data || []).map(rn => ({
      ...rn,
      node_name: nodeMap[rn.node_id]?.name || rn.node_id
    }));

    _cachedRules = rulesRes.data || [];
    _cachedRuleNodes = ruleNodes;
    _cachedNodes = allNodes;
    _cachedRooms = allRooms;
    _cachedNodeMap = nodeMap;
    _lastRulesFetchTime = now;

    return {
      rules: _cachedRules,
      ruleNodes: _cachedRuleNodes,
      nodes: _cachedNodes,
      rooms: _cachedRooms,
      nodeMap: _cachedNodeMap
    };
  } catch (err) {
    console.warn('[EcoTrack Rules Engine] Error loading rules:', err);
    return {
      rules: _cachedRules || [],
      ruleNodes: _cachedRuleNodes || [],
      nodes: _cachedNodes || [],
      rooms: _cachedRooms || [],
      nodeMap: _cachedNodeMap || {}
    };
  }
}

// Helper to check if current time is within rule's optional schedule
function isRuleWithinSchedule(rule, now) {
  const dateStr = now.toISOString().split('T')[0];
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const timeStr = `${hours}:${minutes}`;

  if (rule.start_date && dateStr < rule.start_date) return false;
  if (rule.end_date && dateStr > rule.end_date) return false;
  if (rule.start_time && timeStr < rule.start_time) return false;
  if (rule.end_time && timeStr > rule.end_time) return false;
  return true;
}

/**
 * Evaluates rules against an incoming telemetry packet or latest readings.
 * STRICT RESTRICTION: Sensors sitting in the "Available AC Sensors" lobby
 * (unassigned, room_id is null/empty) MUST NEVER trigger room alerts.
 * Additionally, if an AC sensor interface room is empty (0 assigned sensors),
 * no rule violations for that room may ever be triggered.
 */
async function evaluateTelemetryAgainstRules(telemetry) {
  if (!telemetry || (!telemetry.name && !telemetry.id)) return;
  const sensorName = telemetry.name || telemetry.id;
  const { rules, ruleNodes, nodes, rooms, nodeMap } = await getActiveRulesAndNodes();
  if (!rules.length) return;

  // 1. SENSOR ASSIGNMENT CHECK:
  // Locate node in DB record. If node is not assigned to a room, it is in the "Available AC Sensors" lobby!
  const currentNode = nodeMap[sensorName] || nodeMap[telemetry.id] || nodeMap[telemetry.pb_id];
  const assignedRoomId = (currentNode && currentNode.room_id)
    ? String(currentNode.room_id).trim()
    : (telemetry.room_id ? String(telemetry.room_id).trim() : '');

  if (!assignedRoomId) {
    // Sensor is in the Available AC Sensors lobby (unassigned).
    // Clean up any stale violation timers and skip evaluation completely!
    for (const r of rules) {
      const vKey = `${r.id}_${sensorName}`;
      localStorage.removeItem(`ecoTrack_violation_start_${vKey}`);
      localStorage.removeItem(`ecoTrack_alert_triggered_${vKey}`);
    }
    return;
  }

  const now = new Date();
  const nowMs = now.getTime();
  const sb = window.supabaseClient || window.sb;

  for (const rule of rules) {
    // Strictly skip disabled rules
    if (!rule.enabled || rule.enabled === false || rule.enabled === 'false') {
      const violationKey = `${rule.id}_${sensorName}`;
      localStorage.removeItem(`ecoTrack_violation_start_${violationKey}`);
      localStorage.removeItem(`ecoTrack_alert_triggered_${violationKey}`);
      continue;
    }

    // Check optional schedule
    if (!isRuleWithinSchedule(rule, now)) {
      continue;
    }

    const ruleRoomId = (rule.room_id || rule.room) ? String(rule.room_id || rule.room).trim() : '';

    // 2. ROOM MATCH RESTRICTION:
    // If the rule is associated with a specific room, this sensor MUST belong to that room in the AC Sensor Interface!
    if (ruleRoomId && assignedRoomId !== ruleRoomId) {
      continue;
    }

    // 3. EMPTY ROOM RESTRICTION:
    // If the AC Sensor Interface is empty for this room (0 sensors assigned), rule alerts must NEVER fire!
    if (ruleRoomId) {
      const nodesInRoom = nodes.filter(n => n && n.room_id && String(n.room_id).trim() === ruleRoomId);
      if (nodesInRoom.length === 0) {
        continue;
      }
    }

    // 4. SPECIFIC SENSOR TARGET RESTRICTION:
    const associatedNodes = ruleNodes.filter(rn => rn.rule_id === rule.id);
    const targetNodeNames = associatedNodes.map(rn => rn.node_name);
    if (rule.node) targetNodeNames.push(rule.node);
    if (Array.isArray(rule.nodes)) targetNodeNames.push(...rule.nodes);

    if (targetNodeNames.length > 0) {
      const matchesSensor = targetNodeNames.some(tn => 
        tn === sensorName || tn === telemetry.id || tn === telemetry.pb_id ||
        (currentNode && (tn === currentNode.id || tn === currentNode.name))
      );
      if (!matchesSensor) continue;
    }

    let isViolated = false;
    let violationReason = '';
    const thresholdVal = Number(rule.value);
    const durationMins = Number(rule.duration) || 0;
    const durationMs = durationMins * 60000;

    if (rule.type === 'temperature') {
      let currentTemp = Number(telemetry.temp ?? telemetry.temperature);
      if (isNaN(currentTemp)) continue;

      let compareVal = thresholdVal;
      if (rule.unit === '°F') {
        compareVal = (thresholdVal - 32) * (5 / 9);
      }

      if (rule.condition === 'above' && currentTemp > compareVal) isViolated = true;
      if (rule.condition === 'below' && currentTemp < compareVal) isViolated = true;
      if (rule.condition === 'equals' && Math.abs(currentTemp - compareVal) < 0.2) isViolated = true;

      if (isViolated) {
        const unit = rule.unit || '°C';
        if (rule.condition === 'above') violationReason = `Temperature went above ${thresholdVal}${unit} (was ${Math.round(currentTemp)}°C)`;
        else if (rule.condition === 'below') violationReason = `Temperature went below ${thresholdVal}${unit} (was ${Math.round(currentTemp)}°C)`;
        else if (rule.condition === 'equals') violationReason = `Temperature equals ${thresholdVal}${unit}`;
      }
    } else if (rule.type === 'battery') {
      let currentBatt = Number(telemetry.battery);
      if (isNaN(currentBatt)) continue;

      if (currentBatt <= 5.0) {
        currentBatt = Math.round((currentBatt / 4.2) * 100);
      }

      if (rule.condition === 'below' && currentBatt < thresholdVal) isViolated = true;
      if (rule.condition === 'equals' && Math.abs(currentBatt - thresholdVal) < 2) isViolated = true;

      if (isViolated) {
        violationReason = `Battery dropped to ${currentBatt}% (threshold ${thresholdVal}%)`;
      }
    }

    const violationKey = `${rule.id}_${sensorName}`;
    const startKey = `ecoTrack_violation_start_${violationKey}`;
    const alertKey = `ecoTrack_alert_triggered_${violationKey}`;

    if (isViolated) {
      const rawStart = localStorage.getItem(startKey);
      let startTime = rawStart !== null ? Number(rawStart) : null;
      if (startTime === null || isNaN(startTime)) {
        startTime = nowMs;
        localStorage.setItem(startKey, String(startTime));
      }

      const elapsedViolationTime = nowMs - startTime;

      if (elapsedViolationTime >= durationMs) {
        const lastAlertTime = Number(localStorage.getItem(alertKey)) || 0;
        const repeatIntervalMs = Math.max(durationMs, 60 * 1000);

        if (!lastAlertTime || (nowMs - lastAlertTime) >= repeatIntervalMs) {
          localStorage.setItem(alertKey, String(nowMs));

          const dateStr = now.toISOString().split('T')[0];
          const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
          const defaultMsg = rule.message || 'Environmental threshold exceeded';
          const fullContent = `${sensorName}|||${violationReason ? violationReason + '. ' : ''}${defaultMsg}`;

          try {
            let notifId = null;
            if (sb) {
              const { data: insertedData } = await sb.from('notifications').insert([{
                room_id: assignedRoomId || rule.room_id || null,
                rule_id: rule.id || null,
                content: fullContent,
                time: timeStr,
                date: dateStr,
                triggered: true
              }]).select().maybeSingle();
              if (insertedData) notifId = insertedData.id;
              console.log(`[EcoTrack Rules Engine] Alert triggered after ${durationMins} min duration for ${sensorName}: ${fullContent}`);
            }

            if (typeof saveViolationToAuditHistory === 'function') {
              saveViolationToAuditHistory({
                id: notifId,
                room_id: assignedRoomId || rule.room_id || null,
                rule_id: rule.id || null,
                content: fullContent,
                time: timeStr,
                date: dateStr,
                triggered: true,
                created: new Date().toISOString()
              });
            }

            triggerGlobalNotification(fullContent, {
              id: notifId,
              room_id: assignedRoomId || rule.room_id || null,
              sensor_name: sensorName
            });

            if (typeof window.setupNotificationsPage === 'function') {
              window.setupNotificationsPage();
            } else if (typeof window.loadNotificationMessages === 'function') {
              window.loadNotificationMessages();
            }
          } catch (insertErr) {
            console.warn('[EcoTrack Rules Engine] Failed to record triggered notification:', insertErr.message);
          }
        }
      }
    } else {
      localStorage.removeItem(startKey);
      localStorage.removeItem(alertKey);
    }
  }
}

// Global hook for live packet streaming (called from telemetry-new.js)
window.evaluateRulesForTelemetry = evaluateTelemetryAgainstRules;

// Background polling loop across all pages to check latest sensor telemetry
async function startGlobalRuleChecker() {
  const sb = window.supabaseClient || window.sb;
  const pb = window.pb;

  try {
    // 1. Check if ANY nodes are assigned in the AC Sensor Interface
    let assignedNodes = [];
    if (sb) {
      try {
        const { data: nData } = await sb.from('nodes').select('id, name, room_id').not('room_id', 'is', null);
        if (nData) {
          assignedNodes = nData.filter(n => n.room_id && String(n.room_id).trim() !== '');
        }
      } catch (_) {}
    }

    // IF AC SENSOR INTERFACE IS COMPLETELY EMPTY (all nodes in lobby / unassigned):
    // Do not poll or evaluate any rules!
    if (!assignedNodes || assignedNodes.length === 0) {
      return;
    }

    const assignedNamesSet = new Set();
    assignedNodes.forEach(n => {
      if (n.name) assignedNamesSet.add(n.name);
      if (n.id) assignedNamesSet.add(n.id);
    });

    let items = [];
    if (sb) {
      try {
        const { data } = await sb.from('telemetry').select('*').order('created', { ascending: false }).limit(20);
        if (data && data.length) items = data;
      } catch (_) {}
    }

    if (!items.length && pb && typeof pb.collection === 'function') {
      const res = await pb.collection('telemetry').getList(1, 20, { sort: '-created' });
      items = res.items || [];
    }

    const latestPerSensor = {};
    items.forEach(t => {
      const name = t.sensor_name || t.node_id;
      if (!latestPerSensor[name]) {
        latestPerSensor[name] = t;
      }
    });

    for (const item of Object.values(latestPerSensor)) {
      const sName = item.sensor_name || item.node_id;
      // Skip sensors in "Available AC Sensors" lobby
      if (!assignedNamesSet.has(sName) && !assignedNamesSet.has(item.node_id)) {
        continue;
      }

      await evaluateTelemetryAgainstRules({
        id: item.sensor_name || item.node_id,
        name: item.sensor_name || item.node_id,
        pb_id: item.node_id,
        temp: item.temperature,
        temperature: item.temperature,
        pressure: item.pressure,
        battery: item.battery,
        rssi: item.rssi,
        status: item.status
      });
    }
  } catch (_) {}
}

// ===== SENSOR WAKE UP & SLEEP SCHEDULE MONITOR =====
let _cachedNodesForSchedule = null;
let _cachedRoomsForSchedule = null;
let _lastScheduleFetchTime = 0;

function to24HourHHMM(timeVal) {
  if (!timeVal) return null;
  const str = String(timeVal).trim();
  if (str === '00:00' || str === '') return null;

  // Check 12-hour AM/PM: e.g. "06:00 AM", "6:00 AM", "10:00 PM", "12:43 PM"
  const ampmMatch = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i.exec(str);
  if (ampmMatch) {
    let hours = parseInt(ampmMatch[1], 10);
    const minutes = ampmMatch[2];
    const period = ampmMatch[3].toUpperCase();
    if (period === 'AM' && hours === 12) hours = 0;
    else if (period === 'PM' && hours !== 12) hours += 12;
    return `${String(hours).padStart(2, '0')}:${minutes}`;
  }

  // Check 24-hour: e.g. "06:00", "6:00", "22:00", "12:43"
  const h24Match = /^(\d{1,2}):(\d{2})/.exec(str);
  if (h24Match) {
    const hours = parseInt(h24Match[1], 10);
    const minutes = h24Match[2];
    if (hours >= 0 && hours < 24) {
      return `${String(hours).padStart(2, '0')}:${minutes}`;
    }
  }

  return null;
}

function formatScheduleTimeDisplay(value, fallback = '06:00 AM') {
  if (!value) return fallback;
  const norm = to24HourHHMM(value) || value;
  const match = /^([0-2]?\d):([0-5]\d)$/.exec(String(norm || ''));
  if (!match) return String(value || fallback);
  let hours = parseInt(match[1], 10);
  const minutes = match[2];
  const period = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  if (hours === 0) hours = 12;
  return `${String(hours).padStart(2, '0')}:${minutes} ${period}`;
}

async function checkSensorSchedules(forceRefresh = false) {
  const sb = window.supabaseClient || window.sb;
  if (!sb) return;

  const now = new Date();
  const currentHH = String(now.getHours()).padStart(2, '0');
  const currentMM = String(now.getMinutes()).padStart(2, '0');
  const currentHHMM = `${currentHH}:${currentMM}`;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const todayDateStr = now.toISOString().split('T')[0];
  const nowMs = now.getTime();

  try {
    // Refresh nodes and rooms if forced or cache expired (every 15 seconds)
    if (forceRefresh || !_cachedNodesForSchedule || (nowMs - _lastScheduleFetchTime) > 15000) {
      const [nodesRes, roomsRes] = await Promise.all([
        sb.from('nodes').select('*'),
        sb.from('rooms').select('*')
      ]);
      _cachedNodesForSchedule = nodesRes.data || [];
      _cachedRoomsForSchedule = roomsRes.data || [];
      _lastScheduleFetchTime = nowMs;
    }

    const roomMap = {};
    (_cachedRoomsForSchedule || []).forEach(rm => { roomMap[rm.id] = rm.name; });

    // Fetch existing notifications for today to prevent duplicates across multiple browser tabs or sessions
    let todayNotifs = [];
    try {
      const { data: existingData } = await sb
        .from('notifications')
        .select('id, content, date, time')
        .eq('date', todayDateStr);
      if (existingData) todayNotifs = existingData;
    } catch (_) {}

    for (const node of _cachedNodesForSchedule || []) {
      // Skip sensors that are not assigned to a room
      if (!node.room_id || !roomMap[node.room_id]) {
        continue;
      }
      const nodeName = node.name || node.id;
      const roomName = roomMap[node.room_id];

      // Defaults to 06:00 (Wake) and 22:00 (Sleep) matching scheduler.html UI display
      const normWake = to24HourHHMM(node.wake_time) || '06:00';
      const normSleep = to24HourHHMM(node.sleep_time) || '22:00';

      const [wH, wM] = normWake.split(':').map(Number);
      const wakeMinutes = wH * 60 + wM;

      const [sH, sM] = normSleep.split(':').map(Number);
      const sleepMinutes = sH * 60 + sM;

      const wakeDisplay = formatScheduleTimeDisplay(normWake, '06:00 AM');
      const sleepDisplay = formatScheduleTimeDisplay(normSleep, '10:00 PM');

      // 1. Check Wake Up Trigger:
      // Realtime match OR scheduled wake has passed today
      const isWakeDue = (currentHHMM === normWake) || (nowMinutes >= wakeMinutes);
      if (isWakeDue) {
        const wakeKey = `ecoTrack_notif_wake_${node.id || nodeName}_${todayDateStr}_${normWake}`;
        const hasLocalWake = localStorage.getItem(wakeKey);
        const hasDbWake = todayNotifs.some(n =>
          n.content &&
          n.content.includes(nodeName) &&
          n.content.includes('Sensor Wake Up')
        );

        if (!hasLocalWake && !hasDbWake) {
          localStorage.setItem(wakeKey, 'pending_' + Date.now());

          const notifId = `notif_wake_${(node.id || nodeName).replace(/[^a-zA-Z0-9]/g, '')}_${Date.now()}`;
          const messageText = `Sensor Wake Up: Sensor ${nodeName} in ${roomName} has entered active wake cycle (${wakeDisplay}). Monitoring and telemetry active.`;
          const fullContent = `${nodeName}|||${messageText}`;

          try {
            let insertedId = notifId;
            if (sb) {
              const { data } = await sb.from('notifications').insert([{
                room_id: node.room_id || null,
                content: fullContent,
                time: wakeDisplay,
                date: todayDateStr,
                triggered: true
              }]).select().maybeSingle();
              if (data && data.id) insertedId = data.id;
            }

            localStorage.setItem(wakeKey, 'true');

            triggerGlobalNotification(fullContent, {
              id: insertedId,
              room_id: node.room_id,
              sensor_name: nodeName
            });

            if (typeof window.loadNotificationMessages === 'function') {
              window.loadNotificationMessages();
            }
          } catch (e) {
            localStorage.removeItem(wakeKey);
            console.warn('[Schedule Wake Notification Error]:', e.message);
          }
        } else if (!hasLocalWake && hasDbWake) {
          localStorage.setItem(wakeKey, 'true');
        }
      }

      // 2. Check Sleep Time Trigger:
      // Realtime match OR scheduled sleep has passed today (if sleep > wake) OR in overnight sleep window
      const isSleepDue = (currentHHMM === normSleep) ||
        (sleepMinutes > wakeMinutes ? (nowMinutes >= sleepMinutes) : (nowMinutes >= sleepMinutes && nowMinutes < wakeMinutes));

      if (isSleepDue) {
        const sleepKey = `ecoTrack_notif_sleep_${node.id || nodeName}_${todayDateStr}_${normSleep}`;
        const hasLocalSleep = localStorage.getItem(sleepKey);
        const hasDbSleep = todayNotifs.some(n =>
          n.content &&
          n.content.includes(nodeName) &&
          n.content.includes('Sensor Sleep Schedule')
        );

        if (!hasLocalSleep && !hasDbSleep) {
          localStorage.setItem(sleepKey, 'pending_' + Date.now());

          const notifId = `notif_sleep_${(node.id || nodeName).replace(/[^a-zA-Z0-9]/g, '')}_${Date.now()}`;
          const messageText = `Sensor Sleep Schedule: Sensor ${nodeName} in ${roomName} has entered scheduled sleep cycle (${sleepDisplay}) for energy conservation.`;
          const fullContent = `${nodeName}|||${messageText}`;

          try {
            let insertedId = notifId;
            if (sb) {
              const { data } = await sb.from('notifications').insert([{
                room_id: node.room_id || null,
                content: fullContent,
                time: sleepDisplay,
                date: todayDateStr,
                triggered: true
              }]).select().maybeSingle();
              if (data && data.id) insertedId = data.id;
            }

            localStorage.setItem(sleepKey, 'true');

            triggerGlobalNotification(fullContent, {
              id: insertedId,
              room_id: node.room_id,
              sensor_name: nodeName
            });

            if (typeof window.loadNotificationMessages === 'function') {
              window.loadNotificationMessages();
            }
          } catch (e) {
            localStorage.removeItem(sleepKey);
            console.warn('[Schedule Sleep Notification Error]:', e.message);
          }
        } else if (!hasLocalSleep && hasDbSleep) {
          localStorage.setItem(sleepKey, 'true');
        }
      }
    }
  } catch (err) {
    console.warn('[Sensor Schedule Monitor] Error checking schedules:', err);
  }
}

function invalidateScheduleCache(nodeId = null) {
  _cachedNodesForSchedule = null;
  _cachedRoomsForSchedule = null;
  _lastScheduleFetchTime = 0;
  if (nodeId) {
    try {
      const now = new Date();
      const todayDateStr = now.toISOString().split('T')[0];
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && (k.includes(nodeId) || k.includes('ecoTrack_notif_')) && k.includes(todayDateStr)) {
          localStorage.removeItem(k);
        }
      }
    } catch (_) {}
  }
}

// Function to trigger immediate notification when schedule is updated on scheduler page
function notifyScheduleChange(nodeName, roomName, wakeTime, sleepTime, roomId) {
  const sb = window.supabaseClient || window.sb;
  const now = new Date();
  const todayDateStr = now.toISOString().split('T')[0];
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  const messageText = `Schedule Applied: Node ${nodeName} in ${roomName || 'Room'} set to Wake at ${formatScheduleTimeDisplay(wakeTime, '06:00 AM')}, Sleep at ${formatScheduleTimeDisplay(sleepTime, '10:00 PM')}.`;
  const fullContent = `${nodeName}|||${messageText}`;

  if (sb) {
    sb.from('notifications').insert([{
      room_id: roomId || null,
      content: fullContent,
      time: timeStr,
      date: todayDateStr,
      triggered: true
    }]).select().then(({ data }) => {
      const notifId = data && data[0] ? data[0].id : null;
      triggerGlobalNotification(fullContent, {
        id: notifId,
        room_id: roomId,
        sensor_name: nodeName
      });
      if (typeof window.loadNotificationMessages === 'function') {
        window.loadNotificationMessages();
      }
    }).catch((err) => {
      console.warn('[Schedule Change Notification Error]:', err.message);
      triggerGlobalNotification(fullContent, {
        room_id: roomId,
        sensor_name: nodeName
      });
    });
  } else {
    triggerGlobalNotification(fullContent, {
      room_id: roomId,
      sensor_name: nodeName
    });
  }
}

window.notifyScheduleChange = notifyScheduleChange;
window.checkSensorSchedules = checkSensorSchedules;
window.invalidateScheduleCache = invalidateScheduleCache;

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  updateGlobalNotificationBadge();
  
  // Setup dismiss button listener
  const dismissBtn = document.getElementById('dismissNotificationBtn');
  if (dismissBtn) {
    dismissBtn.addEventListener('click', dismissGlobalNotification);
  }
  
  // Listen for storage changes from other pages/tabs
  window.addEventListener('storage', (e) => {
    if (e.key === 'ecoTrackNotificationReadState' || e.key === 'triggeredNotifications') {
      updateGlobalNotificationBadge();
    }
  });

  // Run initial background rule check & schedule checks
  setTimeout(() => {
    startGlobalRuleChecker();
    checkSensorSchedules();
  }, 2000);

  setInterval(startGlobalRuleChecker, 6000);
  setInterval(checkSensorSchedules, 10000); // Check sensor schedules every 10 seconds
});
