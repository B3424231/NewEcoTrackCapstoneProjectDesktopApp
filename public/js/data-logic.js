// ===================================================================
// ECOTRACK DATA LOGIC LAYER — Phase 3
// CRUD operations, business logic, diagnostics, rule evaluation
// ===================================================================

const EcoTrackDataLayer = (() => {
  // ---- Internal State ----
  let _rooms = {};
  let _rules = [];
  let _notifications = [];
  let _telemetry = [];
  let _nodes = [];
  let _config = {};
  let _initialized = false;

  // ===== INITIALIZATION =====
  function initialize(dataset) {
    if (!dataset) throw new Error('EcoTrackDataLayer: dataset is required');
    _rooms = {};
    (dataset.rooms || []).forEach(r => { _rooms[r.id] = { ...r }; delete _rooms[r.id].nodes; });
    _rules = (dataset.rules || []).map(r => ({ ...r }));
    _notifications = (dataset.notifications || []).map(n => ({ ...n }));
    _telemetry = (dataset.telemetry || []).map(t => ({ ...t }));
    _nodes = (dataset.nodes || []).map(n => ({ ...n }));
    
    // Seed room_id based on initial dataset (if present)
    (dataset.rooms || []).forEach(r => {
      (r.nodes || []).forEach(n => {
        const nId = typeof n === 'object' ? n.id : n;
        const targetNode = _nodes.find(nd => nd.id === nId);
        if (targetNode) targetNode.room_id = r.id;
      });
    });

    _config = JSON.parse(JSON.stringify(dataset.config || {}));
    _initialized = true;
    return { success: true, rooms: Object.keys(_rooms).length, rules: _rules.length, telemetry: _telemetry.length };
  }

  function _assertInit() { if (!_initialized) throw new Error('Call initialize() first'); }

  // ===== ROOM CRUD =====
  function createRoom(name, nodeLimit) {
    _assertInit();
    if (!name || typeof name !== 'string' || !name.trim()) return { error: 'Room name is required' };
    if (!nodeLimit || nodeLimit < 1 || nodeLimit > 20) return { error: 'AC Sensor limit must be 1–20' };
    const id = 'rm_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    const room = { id, name: name.trim(), nodeLimit: parseInt(nodeLimit), nodes: [], created: new Date().toISOString() };
    _rooms[id] = room;
    return { success: true, room };
  }

  function getRoom(roomId) {
    _assertInit();
    const room = _rooms[roomId];
    if (!room) return null;
    return { ...room, nodes: _nodes.filter(n => n.room_id === roomId) };
  }

  function getAllRooms() {
    _assertInit();
    return Object.values(_rooms).map(r => ({ ...r, nodes: _nodes.filter(n => n.room_id === r.id) }));
  }

  function deleteRoom(roomId) {
    _assertInit();
    if (!_rooms[roomId]) return { error: 'Room not found' };
    delete _rooms[roomId];
    return { success: true };
  }

  function updateRoom(roomId, updates) {
    _assertInit();
    const room = _rooms[roomId];
    if (!room) return { error: 'Room not found' };
    if (updates && typeof updates === 'object') {
      if (typeof updates.name === 'string') room.name = updates.name.trim() || room.name;
      if (updates.nodeLimit != null) room.nodeLimit = parseInt(updates.nodeLimit, 10) || room.nodeLimit;
      if (Array.isArray(updates.nodes)) room.nodes = updates.nodes.map(n => ({ ...n }));
    }
    return { success: true, room };
  }

  // ===== NODE PLACEMENT =====
  function addNodeToRoom(roomId, nodeId) {
    _assertInit();
    const room = _rooms[roomId];
    if (!room) return { error: 'Room not found' };
    const roomNodes = _nodes.filter(n => n.room_id === roomId);
    if (roomNodes.length >= room.nodeLimit) return { error: `Room limit reached (${room.nodeLimit} max)` };
    const nodeData = _nodes.find(n => n.id === nodeId);
    if (!nodeData) return { error: 'AC Sensor not found in Active AC Sensors' };
    if (nodeData.room_id === roomId) return { error: 'AC Sensor already in this room' };
    
    // Check node isn't already in another room
    if (nodeData.room_id && nodeData.room_id !== roomId) {
      const oldRoom = _rooms[nodeData.room_id];
      if (oldRoom) return { error: `Node already placed in room "${oldRoom.name}"` };
    }
    
    nodeData.room_id = roomId;
    return { success: true, room: getRoom(roomId) };
  }

  function removeNodeFromRoom(roomId, nodeId) {
    _assertInit();
    const room = _rooms[roomId];
    if (!room) return { error: 'Room not found' };
    const node = _nodes.find(n => n.id === nodeId);
    if (!node || node.room_id !== roomId) return { error: 'Node not in this room' };
    node.room_id = null;
    return { success: true, room: getRoom(roomId) };
  }

  function clearRoomNodes(roomId) {
    _assertInit();
    const room = _rooms[roomId];
    if (!room) return { error: 'Room not found' };
    const roomNodes = _nodes.filter(n => n.room_id === roomId);
    const cleared = roomNodes.length;
    roomNodes.forEach(n => n.room_id = null);
    return { success: true, clearedCount: cleared };
  }

  // ===== TELEMETRY =====
  function getLatestTelemetryByNode() {
    _assertInit();
    const latest = {};
    // telemetry is sorted chronologically, so iterate forward and last wins
    _telemetry.forEach(t => { latest[t.node_id] = t; });
    return latest;
  }

  function getTelemetryForNode(nodeId, limit = 24) {
    _assertInit();
    return _telemetry.filter(t => t.node_id === nodeId).slice(-limit);
  }

  function getAllTelemetry() {
    _assertInit();
    return _telemetry.map(t => ({ ...t }));
  }

  function deleteTelemetryForNode(nodeId) {
    _assertInit();
    _telemetry = _telemetry.filter(t => t.node_id !== nodeId);
    const idx = _nodes.findIndex(n => n.id === nodeId);
    if (idx >= 0) {
      _nodes.splice(idx, 1);
    }
    return { success: true };
  }

  function ingestPacket(packet) {
    _assertInit();
    if (!packet || !packet.id) return { error: 'Packet must have an id field' };
    const record = {
      id: Math.random().toString(36).substring(2, 17),
      node_id: packet.id,
      temperature: packet.temp ?? packet.temperature ?? 0,
      pressure: packet.pressure ?? 0,
      rssi: packet.rssi ?? -70,
      battery: packet.battery ?? packet.voltage ?? 3.7,
      status: packet.status || 'online',
      created: packet.timestamp || new Date().toISOString(),
    };
    _telemetry.push(record);
    // Update node in _nodes
    const idx = _nodes.findIndex(n => n.id === packet.id);
    const nodeUpdate = { id: packet.id, name: packet.name || packet.id, temp: record.temperature, pressure: record.pressure, rssi: record.rssi, battery: record.battery, status: record.status };
    if (idx >= 0) Object.assign(_nodes[idx], nodeUpdate);
    else _nodes.push({ ...nodeUpdate, wakeTime: '06:00', sleepTime: '22:00', intervalVal: 15, intervalUnit: 'Minutes' });
    return { success: true, record };
  }

  function getHistorical(period = '24h') {
    _assertInit();
    const cutoff = { '24h': 24, '12h': 12, '6h': 6, '1h': 1 }[period] || 24;
    const since = new Date(Date.now() - cutoff * 3600000).toISOString();
    const filtered = _telemetry.filter(t => t.created >= since);
    return {
      period,
      temperatures: filtered.map(t => t.temperature),
      pressures: filtered.map(t => t.pressure),
      timestamps: filtered.map(t => t.created),
      data_points: filtered.length,
    };
  }

  // ===== DIAGNOSTICS =====
  function runDiagnostics() {
    _assertInit();
    const alerts = [];
    const th = _config.diagnostics_thresholds || {};
    const latest = getLatestTelemetryByNode();

    Object.entries(latest).forEach(([nodeId, t]) => {
      if (t.status === 'offline') return;
      if (t.temperature > (th.temp_critical || 35))
        alerts.push({ type: 'temperature_critical', message: `High temp: ${t.temperature}°C on ${nodeId}`, severity: 'critical', nodeId });
      else if (t.temperature > (th.temp_warning || 30))
        alerts.push({ type: 'temperature_warning', message: `Temp rising: ${t.temperature}°C on ${nodeId}`, severity: 'warning', nodeId });
      const batteryPercent = Math.round((t.battery / 4.2) * 100);
      if (batteryPercent < (th.voltage_critical ? Math.round((th.voltage_critical / 4.2) * 100) : 15))
        alerts.push({ type: 'battery_critical', message: `Low battery: ${batteryPercent}% on ${nodeId}`, severity: 'critical', nodeId });
      else if (batteryPercent < (th.voltage_warning ? Math.round((th.voltage_warning / 4.2) * 100) : 30))
        alerts.push({ type: 'battery_warning', message: `Battery low: ${batteryPercent}% on ${nodeId}`, severity: 'warning', nodeId });
      if (t.rssi < (th.rssi_poor || -90))
        alerts.push({ type: 'rssi_poor', message: `Weak signal: ${t.rssi} dBm on ${nodeId}`, severity: 'warning', nodeId });
    });

    return { status: alerts.length ? 'warning' : 'ok', alerts, last_check: new Date().toISOString() };
  }

  // ===== EFFICIENCY =====
  function calculateEfficiency(nodeId) {
    _assertInit();
    const latest = getLatestTelemetryByNode();
    const t = latest[nodeId];
    if (!t) return { error: 'No telemetry for node' };
    const optimal = _config.optimal_temp || 24;
    const deviation = Math.abs(t.temperature - optimal);
    const score = Math.max(0, 100 - deviation * 5);
    return { efficiency_score: Math.round(score * 10) / 10, optimal_temperature: optimal, current_temperature: t.temperature, deviation: Math.round(deviation * 100) / 100 };
  }

  function estimateACDial(temp) {
    const th = (_config.ac_thresholds || { eco: 20, cool: 24, cold: 28 });
    if (temp < th.eco) return { dial: 'Off', description: 'Idle - No cooling needed', estimated_power: 0 };
    if (temp < th.cool) return { dial: 'Eco', description: 'Minimal cooling - Eco mode', estimated_power: 15 };
    if (temp < th.cold) return { dial: 'Cool', description: 'Standard cooling mode', estimated_power: 35 };
    return { dial: 'Cold', description: 'Maximum cooling - High demand', estimated_power: 60 };
  }

  function getPowerStats() {
    _assertInit();
    const s = _config.power_settings || { sleep_hours: 8, active_draw_ma: 50, sleep_draw_ma: 5 };
    const mahActive = s.sleep_hours * s.active_draw_ma;
    const mahSleep = s.sleep_hours * s.sleep_draw_ma;
    const mahSaved = mahActive - mahSleep;
    const gain = mahActive ? (mahSaved / mahActive * 100) : 0;
    return { sleep_duration_hours: s.sleep_hours, mah_saved: mahSaved, active_hours: 24 - s.sleep_hours, efficiency_gain_percent: Math.round(gain * 10) / 10 };
  }

  // ===== RULE CRUD & EVALUATION =====
  function createRule(ruleData) {
    _assertInit();
    if (!ruleData.type || !ruleData.condition || ruleData.value == null || !ruleData.unit)
      return { error: 'Missing required fields: type, condition, value, unit' };
    if (!['temperature', 'battery'].includes(ruleData.type)) return { error: 'Invalid rule type' };
    if (ruleData.type === 'temperature' && !ruleData.room) return { error: 'Temperature rules require a room' };
    if (ruleData.type === 'temperature' && (!ruleData.nodes || !ruleData.nodes.length)) return { error: 'Temperature rules require at least one node' };
    if (ruleData.type === 'battery' && !ruleData.node) return { error: 'Battery rules require a node' };

    const rule = { id: Date.now(), ...ruleData, enabled: ruleData.enabled !== false };
    _rules.push(rule);
    return { success: true, rule };
  }

  function updateRule(ruleId, updates) {
    _assertInit();
    const idx = _rules.findIndex(r => r.id === ruleId);
    if (idx === -1) return { error: 'Rule not found' };
    Object.assign(_rules[idx], updates);
    return { success: true, rule: _rules[idx] };
  }

  function deleteRule(ruleId) {
    _assertInit();
    const before = _rules.length;
    _rules = _rules.filter(r => r.id !== ruleId);
    return _rules.length < before ? { success: true } : { error: 'Rule not found' };
  }

  function toggleRule(ruleId) {
    _assertInit();
    const rule = _rules.find(r => r.id === ruleId);
    if (!rule) return { error: 'Rule not found' };
    rule.enabled = !rule.enabled;
    return { success: true, enabled: rule.enabled };
  }

  function getAllRules(filter = 'all') {
    _assertInit();
    if (filter === 'all') return [..._rules];
    if (filter === 'disabled') return _rules.filter(r => !r.enabled);
    return _rules.filter(r => r.type === filter);
  }

  function _normalizeRuleValue(value, unit) {
    const v = parseFloat(value);
    if (isNaN(v)) return 0;
    if (unit === '°F') return (v - 32) * (5 / 9);
    return v;
  }

  function evaluateRules() {
    _assertInit();
    const latest = getLatestTelemetryByNode();
    const enabledRules = _rules.filter(r => r.enabled);
    const violations = [];

    enabledRules.forEach(rule => {
      const targetNodes = rule.type === 'temperature' ? (rule.nodes || []) : (rule.node ? [rule.node] : []);
      targetNodes.forEach(nodeId => {
        const telemetry = latest[nodeId];
        if (!telemetry) return;
        let violated = false;
        if (rule.type === 'temperature') {
          const threshold = _normalizeRuleValue(rule.value, rule.unit);
          if (rule.condition === 'above') violated = telemetry.temperature > threshold;
          if (rule.condition === 'below') violated = telemetry.temperature < threshold;
        } else if (rule.type === 'battery') {
          const threshold = parseFloat(rule.value);
          const compareVal = threshold < 10 ? telemetry.battery : Math.round((telemetry.battery / 4.2) * 100);
          if (rule.condition === 'below') violated = compareVal < threshold;
          if (rule.condition === 'equals') violated = Math.abs(compareVal - threshold) <= 0.1;
        }
        if (violated) violations.push({ ruleId: rule.id, nodeId, message: rule.message, type: rule.type, severity: rule.type === 'battery' ? 'critical' : 'warning' });
      });
    });
    return violations;
  }

  // ===== SCHEDULER =====
  function applySchedule(nodeId, wakeTime, sleepTime, intervalVal, intervalUnit) {
    _assertInit();
    if (!nodeId) return { error: 'nodeId is required' };
    // Find the room containing this node
    const node = _nodes.find(n => n.id === nodeId);
    if (!node || !node.room_id) return { error: 'AC Sensor not found in any room' };
    const targetRoom = _rooms[node.room_id];
    if (!targetRoom) return { error: 'Room not found' };
    
    // Collision detection
    const roomNodes = _nodes.filter(n => n.room_id === node.room_id);
    const hasCollision = roomNodes.some(n =>
      n.id !== nodeId && n.intervalVal == intervalVal && n.intervalUnit === intervalUnit
    );
    if (hasCollision) return { error: `Collision: another node in "${targetRoom.name}" uses ${intervalVal} ${intervalUnit}. Choose a different interval.` };
    
    node.wakeTime = wakeTime;
    node.sleepTime = sleepTime;
    node.intervalVal = intervalVal;
    node.intervalUnit = intervalUnit;
    // Calculate sleep seconds for downlink
    let sleepSecs = intervalVal;
    if (intervalUnit === 'Minutes') sleepSecs *= 60;
    if (intervalUnit === 'Hours') sleepSecs *= 3600;
    return { success: true, nodeId, sleepSeconds: sleepSecs, room: targetRoom.name };
  }

  // ===== NOTIFICATIONS CRUD =====
  function createNotification(time, date, content, roomId) {
    _assertInit();
    if (!time || !date || !content) return { error: 'time, date, and content are required' };
    if (!roomId) return { error: 'Room is required' };
    const notif = { id: Date.now(), id_internal: Date.now(), time, date, content, room: roomId, triggered: false };
    _notifications.push(notif);
    return { success: true, notification: notif };
  }

  function deleteNotification(id) {
    _assertInit();
    const before = _notifications.length;
    _notifications = _notifications.filter(n => n.id !== id);
    return _notifications.length < before ? { success: true } : { error: 'Notification not found' };
  }

  function processScheduledNotifications() {
    _assertInit();
    const now = new Date();
    const nowDate = now.toISOString().split('T')[0];
    const nowHour = String(now.getHours()).padStart(2, '0');
    const nowMin = String(now.getMinutes()).padStart(2, '0');
    const nowTime = `${nowHour}:${nowMin}`;
    const triggered = [];

    _notifications.forEach(n => {
      if (n.triggered) return;
      if (n.date < nowDate || (n.date === nowDate && n.time <= nowTime)) {
        n.triggered = true;
        triggered.push(n);
      }
    });
    return { triggered };
  }

  function getAllNotifications() { _assertInit(); return [..._notifications]; }

  // ===== CSV EXPORT =====
  function exportTelemetryCSV(nodeFilter = null) {
    _assertInit();
    const filtered = nodeFilter ? _telemetry.filter(t => t.node_id === nodeFilter) : _telemetry;
    const lines = ['Timestamp,AC Sensor ID,Temperature (°C),Pressure (kPa),Battery (V),RSSI (dBm),Status'];
    filtered.forEach(t => {
      lines.push(`"${t.created}","${t.node_id}","${t.temperature}","${t.pressure}","${t.battery}","${t.rssi}","${t.status}"`);
    });
    return lines.join('\n');
  }

  // ===== CONFIG CRUD =====
  function getConfig() { _assertInit(); return JSON.parse(JSON.stringify(_config)); }
  function updateConfig(updates) {
    _assertInit();
    for (const k of Object.keys(updates)) {
      if (k in _config) {
        if (typeof _config[k] === 'object' && typeof updates[k] === 'object') Object.assign(_config[k], updates[k]);
        else _config[k] = updates[k];
      }
    }
    return { success: true, config: getConfig() };
  }

  // ===== PUBLIC API =====
  return {
    initialize, createRoom, getRoom, getAllRooms, updateRoom, deleteRoom,
    addNodeToRoom, removeNodeFromRoom, clearRoomNodes,
    getLatestTelemetryByNode, getTelemetryForNode, getAllTelemetry, deleteTelemetryForNode, ingestPacket, getHistorical,
    runDiagnostics, calculateEfficiency, estimateACDial, getPowerStats,
    createRule, updateRule, deleteRule, toggleRule, getAllRules, evaluateRules,
    applySchedule,
    createNotification, deleteNotification, processScheduledNotifications, getAllNotifications,
    exportTelemetryCSV, getConfig, updateConfig,
    // Getters for internal state (testing)
    _getNodes: () => [..._nodes],
    getAllNodes: () => _nodes.map(n => ({ ...n })),
  };
})();

if (typeof window !== 'undefined') window.EcoTrackDataLayer = EcoTrackDataLayer;
if (typeof module !== 'undefined' && module.exports) module.exports = EcoTrackDataLayer;
