// Generated from mobile src/services/aircon-state.ts by fix-ipc-and-logged-settings.cjs.
(function(root){ const exports={};
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseAirconSnapshot = parseAirconSnapshot;
exports.describeAirconState = describeAirconState;
exports.remoteObservation = remoteObservation;
exports.selectSettings = selectSettings;
function parseAirconSnapshot(value) {
    if (typeof value === 'string') {
        try {
            return parseAirconSnapshot(JSON.parse(value));
        }
        catch {
            return null;
        }
    }
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}
function powerValue(value) {
    if (value === true || value === 1 || ['on', 'true', '1'].includes(String(value).toLowerCase()))
        return true;
    if (value === false || value === 0 || ['off', 'false', '0'].includes(String(value).toLowerCase()))
        return false;
    return null;
}
function remoteObservation(capture, receivedAt, previous) {
    const frame = parseAirconSnapshot(capture);
    if (!frame) return {};
    const saved = parseAirconSnapshot(previous) || {};
    const retained = saved.observed_remote_state ? {
        observed_remote_state:saved.observed_remote_state,
        observed_remote_at:saved.observed_remote_at,
        observed_remote_frame:saved.observed_remote_frame
    } : {};
    const decodedFrame = frame.frame_kind !== 'settings_only' && parseAirconSnapshot(frame.state) ? frame : parseAirconSnapshot(frame.last_decoded);
    const decoded = decodedFrame?.frame_kind === 'settings_only' ? null : parseAirconSnapshot(decodedFrame?.state);
    if (!decoded || (!decodedFrame.raw_data && !(Number(decodedFrame.raw_count) > 0)))
        return frame.raw_data || Number(frame.raw_count) > 0 ? retained : {};
    const power = powerValue(decoded.power);
    const temp = decoded.temp !== null && decoded.temp !== undefined && decoded.temp !== '' && Number.isFinite(Number(decoded.temp)) ? Number(decoded.temp) : null;
    const mode = ['cool','heat','dry','fan','auto'].includes(decoded.mode) ? decoded.mode : null;
    const fan = ['auto','low','medium','high','quiet','silent','turbo'].includes(decoded.fan) ? decoded.fan : null;
    if (power === null && temp === null && mode === null && fan === null) return retained;
    const identity = JSON.stringify([decodedFrame.boot_count,decodedFrame.sequence,decodedFrame.captured_at_epoch_ms,
        decodedFrame.captured_at_ms,decodedFrame.protocol,decodedFrame.hex,power,temp,mode,fan]);
    const epoch = Number(decodedFrame.captured_at_epoch_ms);
    const serverTime = Date.parse(decodedFrame.received_at || '');
    // A queued IR frame can reach Supabase after a newer UI command; keep its actual capture time.
    const validEpoch = Number.isFinite(epoch) && epoch > 0 && epoch <= 8640000000000000 &&
        (!Number.isFinite(serverTime) || epoch <= serverTime + 5000);
    const capturedAt = validEpoch ? new Date(epoch).toISOString() :
        Number.isFinite(serverTime) ? new Date(serverTime).toISOString() : receivedAt || null;
    // Heartbeats must not give the same old remote command a newer timestamp.
    const observedAt = identity === saved.observed_remote_frame ? saved.observed_remote_at : capturedAt;
    if (Date.parse(observedAt || '') < Date.parse(saved.observed_remote_at || '')) return retained;
    return {observed_remote_state:{power,temp,mode,fan,source:'ir_receiver'},
        observed_remote_at:observedAt,observed_remote_frame:identity};
}
function selectSettings(value) {
    const snapshot = parseAirconSnapshot(value) || {};
    const reportTime = Date.parse(snapshot.reported_at || '');
    const commandTime = Date.parse(snapshot.commanded_at || '');
    const remoteTime = Date.parse(snapshot.observed_remote_at || '');
    const latest = Math.max(Number.isFinite(reportTime) ? reportTime : 0, Number.isFinite(commandTime) ? commandTime : 0);
    if (snapshot.observed_remote_state && ((!snapshot.desired_state && !snapshot.reported_state) || (Number.isFinite(remoteTime) && remoteTime >= latest)))
        return {state:snapshot.observed_remote_state,source:'remote'};
    if (snapshot.reported_state && (!snapshot.desired_state || (Number.isFinite(reportTime) && (!Number.isFinite(commandTime) || reportTime >= commandTime))))
        return {state:parseAirconSnapshot(snapshot.reported_state),source:'reported'};
    if (snapshot.desired_state) return {state:parseAirconSnapshot(snapshot.desired_state),source:'requested'};
    if (snapshot.configured_state) return {state:parseAirconSnapshot(snapshot.configured_state),source:'configured'};
    return {state:null,source:'unknown'};
}

/** Commands describe selected settings; only reported feedback describes operation. */
function describeAirconState(value) {
    const snapshot = parseAirconSnapshot(value);
    const reported = snapshot?.reported_state;
    const observed = selectSettings(snapshot);
    if (observed.source === 'remote') {
        const state = observed.state;
        const mode = String(state.mode || '').toUpperCase();
        const label = state.power === false ? 'REMOTE OFF' : state.power === true ? 'REMOTE ON' + (mode ? ' / ' + mode : '') : 'REMOTE SETTINGS';
        const fanLabel = state.fan ? String(state.fan).toUpperCase() + ' FAN' : '';
        return {label,fanLabel,commandStatus:'',confirmed:false,power:null,remoteObserved:true,observedPower:state.power,summary:[label,fanLabel].filter(Boolean).join(' · ')};
    }
    if (!snapshot?.desired_state && !reported && snapshot?.configured_state) {
        const mode = String(snapshot.configured_state.mode || '').trim().toLowerCase();
        const fan = String(snapshot.configured_state.fan || '').trim().toLowerCase();
        if (['cool', 'dry', 'fan', 'auto', 'heat'].includes(mode)) {
            const label = `${mode.toUpperCase()} SETTINGS`;
            const fanLabel = ['low', 'medium', 'high', 'auto', 'quiet', 'silent', 'turbo'].includes(fan) ? `${fan.toUpperCase()} FAN` : '';
            return { label, fanLabel, commandStatus: '', confirmed: false, power: null,
                summary: [label, fanLabel].filter(Boolean).join(' · ') };
        }
    }
    const reportTime = Date.parse(snapshot?.reported_at || '');
    const commandTime = Date.parse(snapshot?.commanded_at || '');
    const useReported = Boolean(reported && (!snapshot?.desired_state ||
        (Number.isFinite(reportTime) && (!Number.isFinite(commandTime) || reportTime >= commandTime))));
    const state = useReported ? reported : snapshot?.desired_state;
    const power = powerValue(state?.power);
    const mode = String(state?.mode || '').trim().toLowerCase();
    const fan = String(state?.fan || '').trim().toLowerCase();
    const validFans = ['low', 'medium', 'high', 'auto', 'quiet', 'silent', 'turbo'];
    const fanLabel = power !== false && validFans.includes(fan) ? `${fan.toUpperCase()} FAN` : '';
    const commandStatus = ['queued', 'transmitted', 'failed'].includes(snapshot?.command_status || '')
        ? snapshot.command_status.toUpperCase() : '';
    let label = 'UNCONFIRMED';
    if (power === false)
        label = useReported ? 'OFF / STANDBY' : 'POWER OFF REQUESTED';
    if (power === true) {
        if (useReported) {
            label = { fan: 'FAN ONLY', dry: 'DRY MODE', heat: 'HEAT MODE', auto: 'AUTO MODE',
                cool: state?.compressor_active === true ? 'ACTIVE COOLING' :
                    state?.compressor_active === false ? 'COOLING IDLE' : 'COOL MODE' }[mode] || 'ON (MODE UNKNOWN)';
        }
        else {
            label = { cool: 'COOLING REQUESTED', fan: 'FAN REQUESTED', dry: 'DRY REQUESTED',
                heat: 'HEATING REQUESTED', auto: 'AUTO REQUESTED' }[mode] || 'POWER ON REQUESTED';
        }
    }
    return { label, fanLabel, commandStatus, confirmed: useReported && power !== null,
        power: useReported ? power : null, summary: [label, fanLabel, commandStatus].filter(Boolean).join(' · ') };
}

root.EcoTrackAirconState=exports;
})(typeof window==='undefined'?globalThis:window);


﻿/**
 * Universal Aircon IoT System â€” Core Desktop Client Engine
 * Handles Aircon Profiles, Capability Engine, Command Management,
 * Protocol Adapters, IR Learning, Control State Tracking,
 * AC Controller Device Registry, and Central Logging.
 * 
 * Provides unified interoperability across all Desktop pages.
 */

(function(window) {
  'use strict';

  // ===== EVENT BUS FOR INTER-MODULE SYNCHRONIZATION =====
  class EventEmitter {
    constructor() {
      this.events = {};
    }
    on(event, listener) {
      if (!this.events[event]) this.events[event] = [];
      this.events[event].push(listener);
      return () => this.off(event, listener);
    }
    off(event, listener) {
      if (!this.events[event]) return;
      this.events[event] = this.events[event].filter(l => l !== listener);
    }
    emit(event, data) {
      if (this.events[event]) {
        this.events[event].forEach(listener => {
          try { listener(data); } catch (err) { console.error(`Error in event listener for ${event}:`, err); }
        });
      }
      // Cross-tab / cross-window sync via BroadcastChannel if available
      try {
        if (window.BroadcastChannel) {
          if (!this.bc) this.bc = new BroadcastChannel('ecotrack_aircon_channel');
          this.bc.postMessage({ event, data, sender: 'aircon_system' });
        }
      } catch (_) {}
      // DOM CustomEvent dispatch on window for pages that use window.addEventListener
      try {
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
          window.dispatchEvent(new CustomEvent(event, { detail: data }));
        }
      } catch (_) {}
    }
  }

  const AirconEvents = new EventEmitter();

  // Listen for broadcast messages from other windows/tabs
  try {
    if (window.BroadcastChannel) {
      const bc = new BroadcastChannel('ecotrack_aircon_channel');
      bc.onmessage = (msg) => {
        if (msg.data && msg.data.event && msg.data.sender === 'aircon_system') {
          if (AirconEvents.events[msg.data.event]) {
            AirconEvents.events[msg.data.event].forEach(l => l(msg.data.data));
          }
        }
      };
    }
  } catch (_) {}

  // ===== AIRCON IDENTITY & DEDUPLICATION ENGINE =====
  function normalizeAirconNodeId(nodeId) {
    if (!nodeId) return '';
    return String(nodeId).toLowerCase().trim()
      .replace(/\s*\([^)]*\)/g, '') // remove parentheticals: e.g. " (room 1)", " (unassigned)"
      .replace(/^node_/, 'node-')
      .replace(/node-0+/, 'node-') // node-001 -> node-1
      .trim();
  }

  function isAutoGeneratedTag(deviceId, nodeId) {
    if (!deviceId) return true;
    const d = String(deviceId).trim();
    if (d.startsWith('AC-node-')) return true;
    if (d.startsWith('AC-EcoTrack-')) return true;
    if (nodeId && (d === 'AC-' + nodeId || d.toLowerCase() === ('ac-' + nodeId).toLowerCase())) return true;
    return false;
  }

  function deduplicateAirconList(list) {
    if (!Array.isArray(list)) return [];
    const result = [];
    const seenDeviceIds = new Set();
    const seenNodeIds = new Set();

    // Prioritize formatted / user-edited / richer profiles over auto-generated AC-node-* tags
    const sorted = [...list].sort((a, b) => {
      if (!a || !b) return 0;
      const aAuto = isAutoGeneratedTag(a.device_id, a.node_id);
      const bAuto = isAutoGeneratedTag(b.device_id, b.node_id);
      if (aAuto && !bAuto) return 1;
      if (!aAuto && bAuto) return -1;
      
      const aHasBrand = a.brand && a.brand !== 'Generic';
      const bHasBrand = b.brand && b.brand !== 'Generic';
      if (!aHasBrand && bHasBrand) return 1;
      if (aHasBrand && !bHasBrand) return -1;

      return 0;
    });

    const seenNodeMap = new Map(); // normNode -> canonical aircon

    sorted.forEach(ac => {
      if (!ac || !ac.device_id) return;
      const devId = String(ac.device_id).trim();
      const devIdLower = devId.toLowerCase();
      const normNode = normalizeAirconNodeId(ac.node_id);
      const isAuto = isAutoGeneratedTag(devId, ac.node_id);

      // If exact device_id already registered, skip
      if (seenDeviceIds.has(devIdLower)) return;

      // If node_id already registered:
      // If either this unit or the existing unit has an auto-generated placeholder ID, they are duplicate profiles for the same node!
      if (normNode && seenNodeMap.has(normNode)) {
        const existing = seenNodeMap.get(normNode);
        const existingIsAuto = isAutoGeneratedTag(existing.device_id, existing.node_id);

        if (isAuto || existingIsAuto) {
          if ((!existing.brand || existing.brand === 'Daikin' || existing.brand === 'Generic') && ac.brand && ac.brand !== 'Generic') {
            existing.brand = ac.brand;
            existing.protocol_name = ac.protocol_name || CapabilityEngine.resolveProtocolName(ac.brand);
            existing.protocol = existing.protocol_name;
            existing.capabilities = CapabilityEngine.getCapabilities(existing.protocol_name);
          }
          if ((!existing.location || existing.location.includes('Facility Zone')) && ac.location && !ac.location.includes('Facility Zone')) {
            existing.location = ac.location;
            existing.room = ac.room || existing.room;
            existing.room_name = ac.room_name || existing.room_name;
            existing.floor = ac.floor || existing.floor;
            existing.building = ac.building || existing.building;
          }
          if (ac.state && (!existing.state || typeof existing.state.temperature !== 'number')) {
            existing.state = ac.state;
          }
          return;
        }
      }

      seenDeviceIds.add(devIdLower);
      if (normNode) seenNodeMap.set(normNode, ac);
      result.push({ ...ac });
    });

    return result;
  }

  // ===== PURGE STALE MOCK DATA FROM PREVIOUS SESSIONS & AUTO-DEDUPLICATE =====
  // Only purge legacy demo mock data (e.g. Living Room, Master Bedroom) or outdated (node- patterns
  try {
    const rawAircons = localStorage.getItem('ecoTrack_aircons');
    if (rawAircons) {
      const aircons = JSON.parse(rawAircons);
      const hasMock = Array.isArray(aircons) && aircons.some(a =>
        a && a.name && (a.name.includes('Living Room') || a.name.includes('Master Bedroom') || a.name.includes('(node-') || a.name.includes('(EcoTrack-'))
      );
      if (hasMock) {
        localStorage.removeItem('ecoTrack_nodes');
        localStorage.removeItem('ecoTrack_aircons');
        localStorage.removeItem('ecoTrack_ir_commands');
        console.log('[AirconSystem] Purged legacy mock/outdated aircon names from localStorage.');
      } else if (Array.isArray(aircons) && aircons.length > 0) {
        // Immediate startup deduplication to prevent inflated unit counts
        const deduped = deduplicateAirconList(aircons);
        if (deduped.length !== aircons.length) {
          localStorage.setItem('ecoTrack_aircons', JSON.stringify(deduped));
          console.log(`[AirconSystem] Immediate startup deduplication: purged ${aircons.length - deduped.length} duplicate aircon entries (${aircons.length} -> ${deduped.length}).`);
        }
      }
    }
  } catch (_) {}

  // ===== DEFAULT SEED DATA (empty â€” all data comes from Supabase or user registration) =====
  const DEFAULT_NODES = [];

  const DEFAULT_AIRCONS = [];

  const DEFAULT_IR_COMMANDS = [];

  // ===== CENTRAL LOGGING SERVICE =====
  class CentralLogService {
    static getLogs(limit = 100) {
      try {
        const raw = localStorage.getItem('ecoTrack_system_logs');
        const logs = raw ? JSON.parse(raw) : [];
        return logs.slice(0, limit);
      } catch (_) {
        return [];
      }
    }

    static clearLogs() {
      try {
        localStorage.setItem('ecoTrack_system_logs', JSON.stringify([]));
      } catch (_) {}
      if (typeof AirconEvents !== 'undefined' && typeof AirconEvents.emit === 'function') {
        AirconEvents.emit('log:cleared');
      }
    }

    /**
     * @param {Object} entry
     * @param {string} entry.device_id
     * @param {string} [entry.node_id]
     * @param {'CONTROL' | 'IR' | 'MONITORING' | 'NODE' | 'STATE' | 'CONFIG'} entry.module
     * @param {string} entry.event
     * @param {'SUCCESS' | 'FAILED' | 'PENDING' | 'WARNING' | 'INFO' | 'OFFLINE'} entry.result
     * @param {string} [entry.details]
     */
    static log({ device_id, node_id, module, event, result, details }) {
      const entry = {
        id: 'log_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
        timestamp: new Date().toISOString(),
        device_id: device_id || 'SYSTEM',
        node_id: node_id || 'N/A',
        module: module || 'GENERAL',
        event: event || 'ACTION',
        result: result || 'INFO',
        details: details || ''
      };

      try {
        const raw = localStorage.getItem('ecoTrack_system_logs');
        const logs = raw ? JSON.parse(raw) : [];
        logs.unshift(entry);
        if (logs.length > 500) logs.pop();
        localStorage.setItem('ecoTrack_system_logs', JSON.stringify(logs));
      } catch (err) {
        console.warn('Could not persist system log:', err);
      }

      AirconEvents.emit('log:new', entry);

      return entry;
    }
  }

  // ===== DATABASE SYNC ENGINE (Supabase Master Source) =====
  let isDatabaseSyncing = false;
  let databaseSyncPending = false;
  let databaseReferenceRefreshPending = false;
  let referenceCache = null;
  let referenceRead = null;
  let referenceEpoch = 0;
  let databaseAuthVersion = 0;
  let databaseRealtimeClient = null;
  let databaseSyncTimer = null;
  let databaseRefreshTimer = null;
  let scheduledReferenceRefresh = false;
  function invalidateReferenceData() {
    referenceEpoch += 1;
    referenceCache = null;
    referenceRead = null;
  }
  function readReferenceData(sb, force) {
    if (force) invalidateReferenceData();
    if (referenceCache?.client === sb && Date.now() - referenceCache.loadedAt < 30000) return Promise.resolve(referenceCache.rows);
    if (referenceRead?.client === sb) return referenceRead.promise;
    const epoch = referenceEpoch;
    const request = { client: sb, promise: null };
    request.promise = Promise.all(['rooms', 'floors', 'buildings'].map(table => sb.from(table).select('*'))).then(rows => {
      const failed = rows.find(row => row.error);
      if (failed) throw failed.error;
      if (epoch === referenceEpoch) referenceCache = { client: sb, rows, loadedAt: Date.now() };
      return rows;
    }).finally(() => { if (referenceRead === request) referenceRead = null; });
    referenceRead = request;
    return request.promise;
  }
  function scheduleDatabaseSync(refreshReferences = false) {
    scheduledReferenceRefresh ||= refreshReferences;
    if (refreshReferences) invalidateReferenceData();
    if (databaseSyncTimer) return;
    databaseSyncTimer = setTimeout(() => {
      databaseSyncTimer = null;
      const force = scheduledReferenceRefresh;
      scheduledReferenceRefresh = false;
      void syncWithDatabase(force);
    }, 150);
  }
  function resolveRegisteredAirconNode(aircon, aircons, nodes) {
    const links = [aircon.node_id, aircon.controller_node_id].filter(Boolean);
    const matches = nodes.filter(node => links.includes(node.id) || links.includes(node.name));
    if (matches.length !== 1) return null;
    const node = matches[0];
    const owners = aircons.filter(owner => [owner.node_id, owner.controller_node_id]
      .some(link => link && (link === node.id || link === node.name)));
    return owners.length === 1 ? node : null;
  }

  async function syncWithDatabase(refreshReferences = true) {
    if (isDatabaseSyncing) {
      databaseSyncPending = true;
      databaseReferenceRefreshPending ||= refreshReferences;
      return;
    }
    const sb = window.supabaseClient || window.sb;
    if (!sb || typeof sb.from !== 'function') return;

    try {
      isDatabaseSyncing = true;
      const authVersion = databaseAuthVersion;
      await window.ecotrackAuthReady;
      if (sb.auth?.getSession) {
        const { data, error } = await sb.auth.getSession();
        if (error) throw error;
        if (!data?.session || authVersion !== databaseAuthVersion) return;
      }
      const [nodesRes, [roomsRes, floorsRes, bldRes], airconsRes] = await Promise.all([
        sb.from('nodes').select('*').order('name'),
        readReferenceData(sb, refreshReferences),
        sb.from('aircons').select('*')
      ]);
      if (authVersion !== databaseAuthVersion) return;
      if (nodesRes.error || airconsRes.error) throw nodesRes.error || airconsRes.error;
      if (!Array.isArray(nodesRes.data) || !Array.isArray(airconsRes.data)) throw new Error('Unexpected device registry response');

      let hardwareStates = [];
      if (window.EcoTrackHardwareCloud) {
        hardwareStates = await window.EcoTrackHardwareCloud.listStatus();
      }
      if (authVersion !== databaseAuthVersion) return;
      const hardwareByNode = new Map(hardwareStates.map(item => [item.node_id, item]));
      const sbNodes = nodesRes.data || [];
      const sbRooms = roomsRes.data || [];
      const sbFloors = floorsRes.data || [];
      const sbBuildings = bldRes.data || [];
      const sbAircons = (airconsRes && airconsRes.data) ? airconsRes.data : [];

      const buildingMap = {};
      sbBuildings.forEach(b => { buildingMap[b.id] = b.name; });

      const floorMap = {};
      sbFloors.forEach(f => {
        floorMap[f.id] = {
          name: f.name,
          building: buildingMap[f.building_id] || 'main campus'
        };
      });

      const roomMap = {};
      sbRooms.forEach(r => {
        const flr = floorMap[r.floor_id] || { name: 'first floor', building: 'main campus' };
        roomMap[r.id] = {
          name: r.name,
          floor: flr.name,
          building: flr.building
        };
      });

      // Map real Supabase nodes into AC Controller Devices
      const pendingControllers = new Set(window.EcoTrackHardwareCloud?.pendingRegistrations?.() || []);
      const realNodes = sbNodes.filter(n => !pendingControllers.has(n.id) || sbAircons.some(ac => ac.controller_node_id === n.id || ac.node_id === n.id)).map((n, idx) => {
        let rInfo = roomMap[n.room_id];
        if (!rInfo) {
          rInfo = { name: 'Unassigned', floor: 'Unassigned', building: 'Unassigned' };
        }

        const hardware = hardwareByNode.get(n.id);
        const isOnline = hardware?.connection_status === 'online';
        const numPart = (n.name || n.id || String(idx + 1)).replace(/\D/g, '') || String(idx + 1);
        const matchedAcForNode = sbAircons.find(a => 
          a.node_id === n.name || a.node_id === n.id || 
          a.controller_node_id === n.name || a.controller_node_id === n.id ||
          (a.asset_tag && (n.name === a.asset_tag || n.id === a.asset_tag || n.aircon_id === a.asset_tag))
        );
        const resolvedBrand = matchedAcForNode?.brand || n.brand || null;

        return {
          node_id: hardware?.device_id || n.name || n.id,
          name: n.name,
          status: hardware?.connection_status === 'sleeping' ? 'Sleeping' : isOnline ? 'Connected' : 'Offline',
          hardware: hardware?.capabilities?.ir_transmitter ? 'ESP32-S3 IR controller' : 'ESP32-S3 IR receiver',
          firmware: hardware?.firmware_version || null,
          capabilities: hardware?.capabilities || {},
          cloud_state: hardware || null,
          connection: 'WiFi (2.4GHz) / Supabase Realtime',
          controls: hardware?.capabilities?.ir_transmitter ? ['IR Control', 'IR Learning'] : ['IR Learning'],
          ir_tx: hardware?.capabilities?.ir_transmitter === true,
          ir_rx: hardware?.capabilities?.ir_receiver === true,
          brand: resolvedBrand,
          protocol_name: matchedAcForNode?.protocol_name || matchedAcForNode?.protocol || n.protocol_name || null,
          mac_address: n.mac_address || null,
          ip_address: hardware?.ip_address || null,
          wifi_ssid: hardware?.wifi_ssid || null,
          rssi: hardware?.rssi ?? null,
          temp: null,
          pressure: null,
          room_id: n.room_id,
          room_name: rInfo.name,
          floor_id: sbRooms.find(room => room.id === n.room_id)?.floor_id || null,
          building_id: sbFloors.find(floor => floor.id === sbRooms.find(room => room.id === n.room_id)?.floor_id)?.building_id || null,
          floor: rInfo.floor,
          building: rInfo.building,
          location: `${rInfo.name} (${rInfo.building} • ${rInfo.floor})`,
          aircon_type: n.aircon_type || matchedAcForNode?.aircon_type || 'Split Type (Inverter)',
          db_id: n.id,
          last_seen: hardware?.last_seen || null
        };
      });

      // Existing cached aircons from localStorage (cleaned of any duplicates)
      let cachedAircons = [];
      try {
        const raw = localStorage.getItem('ecoTrack_aircons');
        if (raw) cachedAircons = deduplicateAirconList(JSON.parse(raw));
      } catch (_) {}

      // Build unified, deduplicated list of real aircon units (Strict 1 Unit per Node)
      const realAircons = [];
      const processedTags = new Set();
      const processedNodeIds = new Set();

      // 1. First add all aircons explicitly registered in Supabase aircons table (from Admin or Mobile Staff)
      sbAircons.forEach(ac => {
        const tag = ac.asset_tag || ac.id;
        if (!tag || processedTags.has(tag.toLowerCase())) return;

        const matchedNode = resolveRegisteredAirconNode(ac, sbAircons, sbNodes);
        const effectiveNodeName = matchedNode ? (hardwareByNode.get(matchedNode.id)?.device_id || matchedNode.name || matchedNode.id) : '';
        const normNode = normalizeAirconNodeId(effectiveNodeName);
        if (normNode && processedNodeIds.has(normNode)) return;

        const rId = ac.room_id || matchedNode?.room_id;
        const rInfo = (rId && roomMap[rId]) || { name: 'Unassigned', floor: 'Unassigned', building: 'Unassigned' };
        const cleanRoom = (rInfo.name || '').trim().replace(/\b\w/g, l => l.toUpperCase());
        const canonicalName = `${cleanRoom} AC (${tag})`;

        const existingLocal = cachedAircons.find(c => 
          c.device_id.toLowerCase() === tag.toLowerCase() || 
          (normNode && normalizeAirconNodeId(c.node_id) === normNode)
        );

        const isCustomUserEdited = existingLocal?.name && 
          !existingLocal.name.includes('(node-') && 
          !existingLocal.name.includes('(EcoTrack-') && 
          !existingLocal.name.includes('Living Room') &&
          !existingLocal.name.includes('Master Bedroom');
        const finalName = isCustomUserEdited ? existingLocal.name : canonicalName;

        const isOnline = matchedNode ? hardwareByNode.get(matchedNode.id)?.connection_status === 'online' : false;
        const proto = ac.protocol_name || ac.protocol || CapabilityEngine.resolveProtocolName(ac.brand);
        const hardwareState = matchedNode ? hardwareByNode.get(matchedNode.id) : null;
        const snapshot = { desired_state: ac.desired_state, reported_state: ac.reported_state, reported_at: ac.reported_at, commanded_at: ac.commanded_at, command_id: ac.command_id, command_status: ac.command_status,
          ...window.EcoTrackAirconState.remoteObservation(hardwareState?.latest_ir, hardwareState?.last_seen, existingLocal?.control_snapshot) };
        const description = window.EcoTrackAirconState.describeAirconState(snapshot);
        const selectedState = window.EcoTrackAirconState.selectSettings(snapshot).state;
        const controlState = selectedState ? {
          ...(existingLocal?.state || {}),
          power: description.confirmed ? description.power : ['on', 'true', '1'].includes(String(selectedState.power).toLowerCase()) ? true : ['off', 'false', '0'].includes(String(selectedState.power).toLowerCase()) ? false : null,
          temperature: selectedState.temp, mode: selectedState.mode, fan: selectedState.fan,
          swing: selectedState.swing === true || selectedState.swing === 'on',
          turbo: selectedState.turbo === true || selectedState.turbo === 'on',
          eco: selectedState.eco === true || selectedState.eco === 'on', updated_at: ac.updated_at
        } : { power: null, temperature: null, mode: null, fan: null };

        realAircons.push({
          aircon_id: ac.id,
          controller_node_id: matchedNode?.id || null,
          room_id: rId || null,
          control_snapshot: snapshot,
          hardware_capabilities: hardwareState?.capabilities || {},
          ir_monitoring: hardwareState?.capabilities?.ir_receiver === true,
          ir_controlling: hardwareState?.capabilities?.ir_transmitter === true,
          device_id: tag,
          name: finalName,
          brand: ac.brand || 'Unspecified',
          model: ac.model || ac.aircon_type || existingLocal?.model || 'Split Type (Inverter)',
          aircon_type: ac.aircon_type || ac.model || existingLocal?.aircon_type || 'Split Type (Inverter)',
          location: (existingLocal?.room_id === rId && existingLocal?.location) || `${cleanRoom} (${rInfo.building || 'Main Campus'} • ${rInfo.floor || '1st Floor'})`,
          building: rInfo.building || '',
          floor: rInfo.floor || '',
          room: cleanRoom,
          room_name: cleanRoom,
          node_id: effectiveNodeName,
          status: isOnline ? 'online' : 'offline',
          protocol_name: proto,
          protocol: proto,
          capabilities: CapabilityEngine.getCapabilities(proto),
          state: controlState,
          operational_state: { classification: description.confirmed || description.remoteObserved ? description.label : 'UNCONFIRMED',
            target_temperature: selectedState?.temp ?? null, mode: selectedState?.mode ?? null,
            last_updated: ac.reported_at || null }
        });

        processedTags.add(tag.toLowerCase());
        if (normNode) processedNodeIds.add(normNode);
      });

      // Supabase assets are authoritative; reads never recreate deleted profiles from cache or controllers.

      // 4. Final deduplication guarantee
      const finalAircons = deduplicateAirconList(realAircons);

      localStorage.setItem('ecoTrack_nodes', JSON.stringify(realNodes));
      localStorage.setItem('ecoTrack_aircons', JSON.stringify(finalAircons));
      localStorage.removeItem('ecoTrack_aircons_cache');

      AirconEvents.emit('node:updated', realNodes);
      AirconEvents.emit('aircon:updated', finalAircons);
      AirconEvents.emit('devices:synced', { nodes: realNodes, aircons: finalAircons });
    } catch (e) {
      console.warn('[AirconSystem] Supabase sync error:', e);
    } finally {
      isDatabaseSyncing = false;
      if (databaseSyncPending) {
        const force = databaseReferenceRefreshPending;
        databaseSyncPending = false;
        databaseReferenceRefreshPending = false;
        void syncWithDatabase(force);
      }
    }
  }

  // Subscribe to real-time changes on nodes table
  function initSupabaseRealtime() {
    const sb = window.supabaseClient || window.sb;
    if (sb && typeof sb.channel === 'function' && databaseRealtimeClient !== sb) {
      databaseRealtimeClient = sb;
      sb.auth?.onAuthStateChange?.(() => {
        if (databaseRealtimeClient !== sb) return;
        databaseAuthVersion += 1;
        invalidateReferenceData();
        scheduleDatabaseSync(true);
      });
      try {
        sb.channel('realtime_aircon_nodes')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'nodes' }, () => {
            scheduleDatabaseSync();
          })
          .on('postgres_changes', { event: '*', schema: 'public', table: 'aircons' }, () => scheduleDatabaseSync())
          .on('postgres_changes', { event: '*', schema: 'public', table: 'ecotrack_device_state' }, () => scheduleDatabaseSync())
          .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, () => scheduleDatabaseSync(true))
          .on('postgres_changes', { event: '*', schema: 'public', table: 'floors' }, () => scheduleDatabaseSync(true))
          .on('postgres_changes', { event: '*', schema: 'public', table: 'buildings' }, () => scheduleDatabaseSync(true))
          .subscribe(status => {
            if (status === 'SUBSCRIBED') scheduleDatabaseSync();
          });
      } catch (_) {}
    }
    if (sb && !databaseRefreshTimer) {
      databaseRefreshTimer = setInterval(() => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
        void syncWithDatabase(false);
      }, 5000);
    }
  }

  // Listen for Supabase ready
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'hidden') scheduleDatabaseSync();
    });
    window.addEventListener('beforeunload', () => {
      clearInterval(databaseRefreshTimer);
      clearTimeout(databaseSyncTimer);
      databaseRefreshTimer = null;
      databaseSyncTimer = null;
    });
    window.addEventListener('supabase:ready', () => {
      syncWithDatabase();
      initSupabaseRealtime();
    });
  }
  if (typeof window !== 'undefined' && (window.supabaseClient || window.sb)) {
    syncWithDatabase();
    initSupabaseRealtime();
  }

  // ===== AC CONTROLLER DEVICE SERVICE =====
  class ACControllerDeviceService {
    static getDevices() {
      try {
        const raw = localStorage.getItem('ecoTrack_nodes');
        if (raw) {
          const parsed = JSON.parse(raw);
          // Only purge old mock nodes with fake room names (Living/Bed, Kitchen/Dining)
          const isStale = Array.isArray(parsed) && parsed.some(n => n.name && (n.name.includes('Living/Bed') || n.name.includes('Kitchen/Dining')));
          if (Array.isArray(parsed) && parsed.length > 0 && !isStale) {
            let modified = false;
            parsed.forEach(n => {
              if (!n) return;
              delete n.wifi_password; delete n.password; delete n.device_token;
              if (window.EcoTrackHardwareCloud) {
                const status = window.EcoTrackHardwareCloud.describe(n.cloud_state);
                n.status = status === 'online' ? 'Connected' : status === 'sleeping' ? 'Sleeping' : 'Offline';
              }
              if (n.room_name && n.room_name !== 'Unassigned' && n.name && n.name.includes('(Unassigned)')) {
                n.name = `${n.node_id || n.name.split(' ')[0]} (${n.room_name})`;
                modified = true;
              }
            });
            if (modified) {
              try { localStorage.setItem('ecoTrack_nodes', JSON.stringify(parsed)); } catch (_) {}
            }
            const pending = new Set(window.EcoTrackHardwareCloud?.pendingRegistrations?.() || []);
            let profiles = [];
            try { profiles = JSON.parse(localStorage.getItem('ecoTrack_aircons') || '[]'); } catch (_) {}
            return parsed.filter(node => !pending.has(node.db_id) || profiles.some(ac => ac.controller_node_id === node.db_id || ac.node_id === node.db_id));
          }
        }
        return DEFAULT_NODES;
      } catch (_) {
        return DEFAULT_NODES;
      }
    }

    static async updateNodeLocation(node_id, { building_id, building_name, floor_id, floor_name, room_id, room_name }) {
      return this.editDevice(node_id, { building_id, building: building_name, floor_id, floor: floor_name,
        room_id, room_name, location: `${room_name} (${building_name || 'Unassigned'} • ${floor_name || 'Unassigned'})` });
    }

    static async editDevice(node_id, updatedData) {
      const sb = window.supabaseClient || window.sb;
      if (!sb?.from) throw new Error('Connect to Supabase before editing this controller.');
      const current = this.getNode(node_id);
      if (!current) throw new Error('Registered controller not found.');
      let databaseId = current.db_id;
      if (!databaseId) {
        const lookup = await sb.from('nodes').select('id').eq('name', current.node_id).maybeSingle();
        if (lookup.error || !lookup.data?.id) throw new Error(lookup.error?.message || 'Controller not found in Supabase.');
        databaseId = lookup.data.id;
      }
      const payload = { updated: new Date().toISOString() };
      for (const field of ['name', 'room_id', 'brand', 'aircon_type', 'protocol_name']) {
        if (updatedData[field] !== undefined) payload[field] = updatedData[field];
      }
      const { data, error } = await sb.from('nodes').update(payload).eq('id', databaseId).select('*').single();
      if (error || data?.id !== databaseId || Object.entries(payload).some(([field,value]) => field !== 'updated' && data[field] !== value)) throw new Error(error?.message || 'Controller changes were not confirmed in Supabase.');
      const linked = AirconProfileManager.getAll().filter(ac => ac.controller_node_id === databaseId || ac.node_id === current.node_id);
      for (const ac of linked) {
        await AirconProfileManager.save({ ...ac, controller_node_id: databaseId,
          room_id: data.room_id ?? null, room_name: updatedData.room_name || ac.room_name,
          location: updatedData.location || ac.location, name: updatedData.room_name ? `${updatedData.room_name} AC (${ac.device_id})` : ac.name,
          brand: updatedData.brand === null ? 'Unspecified' : updatedData.brand || ac.brand, model: updatedData.aircon_type || ac.model,
          aircon_type: updatedData.aircon_type || ac.aircon_type,
          protocol: updatedData.protocol_name || ac.protocol_name, protocol_name: updatedData.protocol_name || ac.protocol_name });
      }
      const merged = { ...current, ...updatedData, db_id: databaseId, node_id: current.node_id,
        room_id: data.room_id ?? null, last_seen: current.cloud_state?.last_seen || current.last_seen || null,
        status: current.status, capabilities: current.capabilities, cloud_state: current.cloud_state };
      delete merged.wifi_password; delete merged.password; delete merged.device_token;
      const devices = this.getDevices().map(node => node.node_id === current.node_id || node.db_id === databaseId ? merged : node);
      localStorage.setItem('ecoTrack_nodes', JSON.stringify(devices));
      window.EcoDataBus?.invalidate('nodes'); window.EcoDataBus?.invalidate('scheduler:data');
      AirconEvents.emit('node:updated', merged);
      AirconEvents.emit('devices:synced', { nodes: devices, aircons: AirconProfileManager.getAll() });
      return merged;
    }

    static async saveRemoteProfile(nodeId, profile) {
      const sb = window.supabaseClient || window.sb;
      if (!sb || typeof sb.rpc !== 'function') throw new Error('Sign in and connect to Supabase to save the AC profile.');
      const current = this.getNode(nodeId);
      if (!current) throw new Error('Controller unavailable. Refresh the device list and retry.');
      let databaseId = current.db_id;
      if (!databaseId) {
        const lookup = await sb.from('nodes').select('id').eq('name', nodeId).maybeSingle();
        if (lookup.error || !lookup.data?.id) throw new Error('The registered controller could not be confirmed in Supabase.');
        databaseId = lookup.data.id;
      }
      const payload = { brand: profile.brand.trim(), aircon_type: profile.aircon_type, protocol_name: profile.protocol_name };
      if (!payload.brand || !payload.protocol_name) throw new Error('Choose an AC brand and IR protocol before saving.');
      const { data, error } = await sb.rpc('ecotrack_device_mutation', {
        p_operation: 'update_node', p_id: databaseId, p_payload: payload
      });
      if (error || data?.node?.id !== databaseId || data.node.brand !== payload.brand ||
          data.node.aircon_type !== payload.aircon_type || data.node.protocol_name !== payload.protocol_name) {
        throw new Error(error?.message || 'The AC profile save was not confirmed.');
      }
      const savedProfile = { db_id: databaseId, brand: data.node.brand,
        aircon_type: data.node.aircon_type, protocol_name: data.node.protocol_name };
      const devices = this.getDevices().map(device => device.node_id === current.node_id || device.db_id === databaseId
        ? { ...device, ...savedProfile } : device);
      const saved = devices.find(device => device.db_id === databaseId) || { ...current, ...savedProfile };
      const linked = AirconProfileManager.getAll().filter(ac =>
        ac.node_id === current.node_id || ac.node_id === databaseId || ac.controller_node_id === databaseId);
      const profiles = linked.length ? linked : [{ device_id: `AC-${current.node_id}`, node_id: current.node_id,
        controller_node_id: databaseId, room_id: current.room_id || null, name: current.name || current.node_id }];
      for (const ac of profiles) {
        await AirconProfileManager.save({ ...ac, brand: saved.brand, model: saved.aircon_type, aircon_type: saved.aircon_type,
          protocol: saved.protocol_name, protocol_name: saved.protocol_name, capabilities: CapabilityEngine.getCapabilities(saved.protocol_name) });
      }
      localStorage.setItem('ecoTrack_nodes', JSON.stringify(devices));
      AirconEvents.emit('node:updated', saved);
      AirconEvents.emit('devices:synced', { nodes: devices, aircons: AirconProfileManager.getAll() });
      window.EcoDataBus?.invalidate('nodes');
      window.EcoDataBus?.invalidate('scheduler:data');
      return saved;
    }

    static editNode(node_id, updatedData) { return this.editDevice(node_id, updatedData); }

    static async deleteDevice(node_id, options = {}) {
      const sb = window.supabaseClient || window.sb;
      if (!sb?.from) throw new Error('Connect to Supabase before removing this controller.');
      const target = this.getNode(node_id) || { node_id, name: node_id };
      if (!target?.node_id && !target?.db_id) throw new Error('Registered controller not found.');
      let lookup = null;
      if (target.db_id) {
        lookup = await sb.from('nodes').select('id,name').eq('id', target.db_id).maybeSingle();
      }
      if (!lookup?.data) {
        lookup = await sb.from('nodes').select('id,name').eq('name', target.node_id).maybeSingle();
      }
      if (!lookup?.data) {
        lookup = await sb.from('nodes').select('id,name').eq('id', target.node_id).maybeSingle();
      }
      if (lookup?.error || !lookup?.data?.id) throw new Error(lookup?.error?.message || 'Controller not found in Supabase.');
      const id = lookup.data.id;
      const linked = await sb.from('aircons').select('id,asset_tag,node_id,controller_node_id')
        .or(`node_id.eq.${id},controller_node_id.eq.${id},node_id.eq.${lookup.data.name}`);
      if (linked.error) throw linked.error;
      const linkedAircons = (linked.data || []).filter(ac => [id, lookup.data.name].includes(ac.node_id) || ac.controller_node_id === id);
      if (linkedAircons.length > 0) {
        if (!options.unassignLinked && !options.force) {
          throw new Error('This controller is assigned to an AC profile. Unassign it in Aircon Control configuration before removing the controller.');
        }
        for (const ac of linkedAircons) {
          const isAuto = isAutoGeneratedTag(ac.asset_tag, target.node_id) || isAutoGeneratedTag(ac.asset_tag, id);
          if (isAuto || options.deleteAutoGenerated) {
            await sb.from('aircons').delete().eq('id', ac.id);
          } else {
            await sb.from('aircons').update({ node_id: null, controller_node_id: null, status: 'offline' }).eq('id', ac.id);
          }
        }
      }
      const removed = await sb.from('nodes').delete().eq('id', id);
      if (removed.error) throw removed.error;
      const confirmation = await sb.from('nodes').select('id').eq('id', id).maybeSingle();
      if (confirmation.error || confirmation.data) throw new Error(confirmation.error?.message || 'Supabase did not confirm controller removal.');
      const devices = this.getDevices().filter(node => node.db_id !== id && node.node_id !== target.node_id && node.node_id !== node_id);
      localStorage.setItem('ecoTrack_nodes', JSON.stringify(devices));

      if (linkedAircons.length > 0) {
        const remainingAircons = AirconProfileManager.getAll().filter(ac => {
          const matched = linkedAircons.find(l => l.id === ac.aircon_id || l.asset_tag === ac.device_id || l.id === ac.id);
          if (!matched) return true;
          const isAuto = isAutoGeneratedTag(ac.device_id, target.node_id) || isAutoGeneratedTag(ac.device_id, id);
          if (isAuto || options.deleteAutoGenerated) return false;
          ac.node_id = null;
          ac.controller_node_id = null;
          ac.status = 'offline';
          return true;
        });
        localStorage.setItem('ecoTrack_aircons', JSON.stringify(remainingAircons));
        AirconEvents.emit('aircons:synced', remainingAircons);
      }

      window.EcoDataBus?.invalidate('nodes');
      window.EcoDataBus?.invalidate('aircons');
      window.EcoDataBus?.invalidate('scheduler:data');
      AirconEvents.emit('node:deleted', { node_id: target.node_id, target });
      AirconEvents.emit('devices:synced', { nodes: devices, aircons: AirconProfileManager.getAll() });
      return true;
    }

    static deleteNode(node_id) { return this.deleteDevice(node_id); }

    static getNodes() { return this.getDevices(); }

    static getDevice(device_node_id) {
      const devices = this.getDevices();
      return devices.find(n => n.node_id === device_node_id || n.db_id === device_node_id || n.name === device_node_id) || null;
    }

    static getNode(node_id) { return this.getDevice(node_id); }

    static isDeviceOnline(device_node_id) {
      const dev = this.getDevice(device_node_id);
      return dev ? (dev.status.toLowerCase() === 'connected' || dev.status.toLowerCase() === 'online') : false;
    }

    static isNodeOnline(node_id) { return this.isDeviceOnline(node_id); }

    static updateDevicePingStatus(node_id, probeResult = {}) {
      const isOnline = probeResult?.success === true;
      const status = isOnline ? 'Connected' : (probeResult?.sleeping ? 'Sleeping' : 'Offline');
      const nowIso = new Date().toISOString();
      const current = this.getNode(node_id);
      if (!current) return null;

      const devices = this.getDevices();
      const idx = devices.findIndex(n => n.node_id === current.node_id || n.db_id === current.db_id || n.name === current.node_id);
      if (idx >= 0) {
        const target = devices[idx];
        target.status = status;
        if (isOnline) {
          target.last_seen = nowIso;
          if (!target.cloud_state) target.cloud_state = {};
          target.cloud_state.last_seen = nowIso;
          target.cloud_state.connection_status = 'online';
          if (Number.isFinite(probeResult.rssi)) {
            target.rssi = probeResult.rssi;
            target.cloud_state.rssi = probeResult.rssi;
          }
          if (probeResult.ip_address) {
            target.ip_address = probeResult.ip_address;
            target.cloud_state.ip_address = probeResult.ip_address;
          }
          if (probeResult.firmware_version) {
            target.firmware = probeResult.firmware_version;
            target.cloud_state.firmware_version = probeResult.firmware_version;
          }
        } else {
          if (target.cloud_state) {
            target.cloud_state.connection_status = probeResult?.sleeping ? 'sleeping' : 'offline';
          }
        }
        devices[idx] = target;
        try { localStorage.setItem('ecoTrack_nodes', JSON.stringify(devices)); } catch (_) {}
      }

      // Propagate online/offline status to bound aircons
      const aircons = AirconProfileManager.getAll();
      let airconsModified = false;
      aircons.forEach(ac => {
        if (ac.node_id === current.node_id || (current.db_id && ac.controller_node_id === current.db_id)) {
          ac.status = isOnline ? 'online' : (probeResult?.sleeping ? 'sleeping' : 'offline');
          airconsModified = true;
        }
      });
      if (airconsModified) {
        try { localStorage.setItem('ecoTrack_aircons', JSON.stringify(aircons)); } catch (_) {}
        AirconEvents.emit('aircons:synced', aircons);
      }

      // Async update in Supabase if client is ready
      try {
        const sb = typeof window !== 'undefined' && (window.supabaseClient || window.sb);
        if (sb && typeof sb.from === 'function') {
          const dbId = current.db_id;
          const updatePayload = {
            status: isOnline ? 'online' : 'offline',
            updated: nowIso
          };
          if (isOnline) {
            if (Number.isFinite(probeResult?.rssi)) updatePayload.rssi = probeResult.rssi;
            if (probeResult?.ip_address) updatePayload.ip_address = probeResult.ip_address;
          }
          if (dbId) {
            sb.from('nodes').update(updatePayload).eq('id', dbId).then(() => {}).catch(() => {});
            sb.from('ecotrack_device_state').update({
              last_seen: nowIso,
              rssi: Number.isFinite(probeResult?.rssi) ? probeResult.rssi : null
            }).eq('node_id', dbId).then(() => {}).catch(() => {});
          } else {
            sb.from('nodes').update(updatePayload).eq('name', current.node_id).then(() => {}).catch(() => {});
          }
        }
      } catch (_) {}

      window.EcoDataBus?.invalidate('nodes');
      window.EcoDataBus?.invalidate('scheduler:data');
      AirconEvents.emit('node:status', { node_id: current.node_id, status, probeResult });
      AirconEvents.emit('devices:synced', { nodes: devices, aircons });
      return devices[idx] || current;
    }

    static updateNodePingStatus(node_id, probeResult) { return this.updateDevicePingStatus(node_id, probeResult); }

    static async saveDevice(deviceData) {
      const sb = typeof window !== 'undefined' && (window.supabaseClient || window.sb);
      if (deviceData.cloud_registered && !sb?.from) throw new Error('Supabase is required to connect an AC profile.');
      let effectiveRoomId = deviceData.room_id || null;

      const safeDeviceData = { ...deviceData };
      delete safeDeviceData.wifi_password; delete safeDeviceData.device_token; delete safeDeviceData.password;
      const mergedDevice = {
        ...safeDeviceData,
        room_id: effectiveRoomId,
        last_seen: deviceData.cloud_state?.last_seen || deviceData.last_seen || null
      };

      // Persist to Supabase nodes table
      if (!deviceData.cloud_registered && sb && typeof sb.from === 'function') {
        try {
          const upsertPayload = {
            id: deviceData.db_id || ('node_' + (deviceData.node_id || '').toLowerCase().replace(/[^a-z0-9]/g, '_')),
            name: deviceData.node_id || deviceData.name,
            status: (deviceData.status || 'Connected').toLowerCase() === 'connected' ? 'online' : 'offline',
            rssi: deviceData.rssi ?? null,
            aircon_type: deviceData.aircon_type || 'Split Type (Inverter)',
            room_id: effectiveRoomId,
            ip_address: deviceData.ip_address || null,
            wifi_ssid: deviceData.wifi_ssid || null,
            wake_time: deviceData.wake_time || '06:00',
            sleep_time: deviceData.sleep_time || '22:00',
            interval_val: deviceData.interval_val || 15,
            interval_unit: deviceData.interval_unit || 'Minutes',
            temp: deviceData.temp ?? null,
            updated: new Date().toISOString()
          };
          const saved = await sb.from('nodes').upsert([upsertPayload]);
          if (saved.error) throw saved.error;
        } catch (err) {
          throw new Error(err.message || 'Controller registration failed');
        }
      }

      // Cloud verification is followed by confirmed controller metadata and one AC binding.
      if (deviceData.cloud_registered) {
        const nodePayload = {name:deviceData.name || deviceData.node_id, room_id:effectiveRoomId,
          brand:deviceData.brand && deviceData.brand !== 'Unassigned Brand' ? deviceData.brand : null,
          aircon_type:deviceData.aircon_type || null, protocol_name:deviceData.protocol_name || null, updated:new Date().toISOString()};
        const committed = await sb.from('nodes').update(nodePayload).eq('id',deviceData.db_id).select('*').single();
        if (committed.error || committed.data?.id !== deviceData.db_id || Object.entries(nodePayload).some(([field,value]) => field !== 'updated' && committed.data[field] !== value))
          throw new Error(committed.error?.message || 'Controller metadata was not confirmed in Supabase.');
        let existing = deviceData.aircon_id ? AirconProfileManager.getById(deviceData.aircon_id) :
          AirconProfileManager.getAll().find(ac => ac.controller_node_id === deviceData.db_id || ac.node_id === deviceData.node_id);
        if (deviceData.aircon_id) {
          const selected = await sb.from('aircons').select('*').eq('id', deviceData.aircon_id).maybeSingle();
          if (selected.error || !selected.data?.id) throw new Error(selected.error?.message || 'The selected AC profile is no longer available.');
          if ([selected.data.node_id, selected.data.controller_node_id].some(id => id && id !== deviceData.db_id)) throw new Error('The selected AC already has a controller. Unassign it first.');
          existing = { ...existing, aircon_id: selected.data.id, device_id: selected.data.asset_tag,
            brand: selected.data.brand, model: selected.data.model, aircon_type: selected.data.aircon_type,
            protocol_name: selected.data.protocol_name || selected.data.protocol };
        }
        await AirconProfileManager.save({ ...existing,
          device_id: existing?.device_id || `AC-${deviceData.node_id}`,
          name: existing?.name || deviceData.name || deviceData.node_id,
          node_id: deviceData.node_id, controller_node_id: deviceData.db_id,
          room_id: effectiveRoomId, room_name: deviceData.room_name,
          brand: deviceData.brand && deviceData.brand !== 'Unassigned Brand' ? deviceData.brand : existing?.brand || 'Unspecified',
          model: deviceData.aircon_type || 'Unspecified', aircon_type: deviceData.aircon_type || 'Unspecified',
          protocol_name: deviceData.protocol_name ||
            (!deviceData.brand || deviceData.brand === 'Unassigned Brand' || deviceData.brand === existing?.brand ? existing?.protocol_name : null) ||
            CapabilityEngine.resolveProtocolName(deviceData.brand || existing?.brand),
          state: existing?.state || { power: null, temperature: null, mode: null, fan: null }
        });
      }
      const devices = this.getDevices();
      const idx = devices.findIndex(n => n.node_id === deviceData.node_id || n.name === deviceData.node_id);
      if (idx >= 0) {
        devices[idx] = { ...devices[idx], ...mergedDevice };
      } else {
        devices.push(mergedDevice);
      }
      localStorage.setItem('ecoTrack_nodes', JSON.stringify(devices));
      AirconEvents.emit('node:updated', mergedDevice);
      AirconEvents.emit('device:updated', mergedDevice);
      AirconEvents.emit('devices:synced', devices);

      // Invalidate cache for immediate refresh
      if (typeof window !== 'undefined' && window.EcoDataBus) {
        window.EcoDataBus.invalidate('scheduler:data');
        window.EcoDataBus.invalidate('nodes');
        window.EcoDataBus.invalidate('rooms');
      }

      // Cross-tab broadcast for instant scheduler updates
      try {
        if (typeof window !== 'undefined' && window.BroadcastChannel) {
          const bc = new BroadcastChannel('ecotrack_aircon_channel');
          bc.postMessage({ event: 'scheduler:refresh', sender: 'aircon_system', room_id: effectiveRoomId });
        }
      } catch (_) {}

      return mergedDevice;
    }

    static async reconnectNode(node_id) {
      await window.EcoTrackHardwareCloud.ping(node_id);
      const cloud = await window.EcoTrackHardwareCloud.getStatus(node_id);
      const devices = this.getDevices();
      const target = devices.find(item => item.node_id === node_id || item.db_id === cloud.node_id);
      if (!target) throw new Error('Registered controller not found. Refresh the device list.');
      Object.assign(target, { status: 'Connected', cloud_state: cloud, last_seen: cloud.last_seen, rssi: cloud.rssi,
        ip_address: cloud.ip_address, wifi_ssid: cloud.wifi_ssid, capabilities: cloud.capabilities });
      localStorage.setItem('ecoTrack_nodes', JSON.stringify(devices));
      AirconEvents.emit('node:updated', target); AirconEvents.emit('devices:synced', devices);
      return target;
    }

    static reconnectDevice(id) { return this.reconnectNode(id); }
    static setNodeOnline(id) { return this.reconnectNode(id); }

    static saveNode(nodeData) { return this.saveDevice(nodeData); }
  }
  const NodeService = ACControllerDeviceService;

  // ===== AIRCON PROFILE MANAGER =====
  class AirconProfileManager {
    static normalizeNodeId(nodeId) { return normalizeAirconNodeId(nodeId); }
    static deduplicateAircons(list) { return deduplicateAirconList(list); }

    static getAll() {
      try {
        const raw = localStorage.getItem('ecoTrack_aircons');
        if (raw) {
          const list = JSON.parse(raw);
          if (Array.isArray(list) && list.length > 0) {
            // Purge stale mock aircons (Living Room, Master Bedroom, etc.)
            const isStale = list.some(a => a && a.name && (a.name.includes('Living Room') || a.name.includes('Master Bedroom')));
            if (isStale) {
              localStorage.removeItem('ecoTrack_aircons');
              return DEFAULT_AIRCONS;
            }

            let modified = false;

            // Automatically deduplicate any multiple instances of the same node / device ID
            const deduped = deduplicateAirconList(list);
            if (deduped.length !== list.length || modified) {
              try { localStorage.setItem('ecoTrack_aircons', JSON.stringify(deduped)); } catch (_) {}
            }
            if (window.EcoTrackHardwareCloud) {
              deduped.forEach(ac => {
                const controller = NodeService.getNode(ac.controller_node_id) || NodeService.getNode(ac.node_id);
                ac.status = controller?.status === 'Sleeping' ? 'sleeping' : controller && NodeService.isNodeOnline(controller.node_id) ? 'online' : 'offline';
              });
            }
            return deduped;
          }
        }
        return DEFAULT_AIRCONS;
      } catch (_) {
        return DEFAULT_AIRCONS;
      }
    }

    static getById(device_id) {
      if (!device_id) return null;
      const aircons = this.getAll();
      const devIdLower = String(device_id).toLowerCase().trim();
      return aircons.find(a => 
        a.device_id.toLowerCase() === devIdLower ||
        a.aircon_id?.toLowerCase() === devIdLower || a.controller_node_id?.toLowerCase() === devIdLower ||
        (a.node_id && a.node_id.toLowerCase() === devIdLower) ||
        normalizeAirconNodeId(a.node_id) === normalizeAirconNodeId(device_id)
      ) || null;
    }

    static async save(input) {
      const sb = window.supabaseClient || window.sb;
      const aircon = { ...input };
      if (!aircon.device_id) throw new Error('An AC asset identifier is required.');
      aircon.protocol_name = aircon.protocol_name || aircon.protocol || CapabilityEngine.resolveProtocolName(aircon);
      aircon.protocol = aircon.protocol_name;

      if (!sb?.from) throw new Error('Supabase is not ready. The AC profile has not been saved.');
      const identity = aircon.controller_node_id || aircon.node_id;
      let registeredNode = null;
      if (identity) {
        const local = NodeService.getNode(identity);
        let result = await sb.from('nodes').select('id,name,room_id').eq('id', local?.db_id || identity).maybeSingle();
        if (result.error) throw result.error;
        if (!result.data) result = await sb.from('nodes').select('id,name,room_id').eq('name', identity).maybeSingle();
        if (result.error) throw result.error;
        if (!result.data?.id) throw new Error('The assigned controller was not found in Supabase. Register it before saving this profile.');
        registeredNode = result.data;
      }
      if (registeredNode) {
        const owners = await sb.from('aircons').select('id,asset_tag,node_id,controller_node_id')
          .or(`node_id.eq.${registeredNode.id},controller_node_id.eq.${registeredNode.id}`);
        if (owners.error) throw owners.error;
        if ((owners.data || []).some(owner => owner.asset_tag !== aircon.device_id && [owner.node_id, owner.controller_node_id].includes(registeredNode.id))) throw new Error('This controller is already assigned to another AC. Edit the existing profile instead.');
      }
      const payload = {
        asset_tag: aircon.device_id, brand: aircon.brand || 'Unspecified',
        model: aircon.model || aircon.aircon_type || 'Unspecified',
        aircon_type: aircon.aircon_type || aircon.model || 'Unspecified',
        node_id: registeredNode?.id || null, controller_node_id: registeredNode?.id || null,
        room_id: aircon.room_id ?? registeredNode?.room_id ?? null,
        protocol: aircon.protocol_name, protocol_name: aircon.protocol_name,
        status: registeredNode && NodeService.isNodeOnline(registeredNode.id) ? 'online' : 'offline',
        updated_at: new Date().toISOString()
      };
      const { data, error } = await sb.from('aircons').upsert([payload], { onConflict: 'asset_tag' }).select('*').single();
      if (error) throw new Error(error.message || 'The AC profile could not be saved.');
      if (!data?.id || data.asset_tag !== payload.asset_tag || data.protocol_name !== payload.protocol_name ||
          data.node_id !== payload.node_id || data.controller_node_id !== payload.controller_node_id ||
          data.room_id !== payload.room_id || data.brand !== payload.brand) throw new Error('Supabase did not confirm the AC profile and controller binding.');
      const saved = { ...aircon, aircon_id: data.id, room_id: data.room_id,
        controller_node_id: data.controller_node_id, node_id: (registeredNode && NodeService.getNode(registeredNode.id)?.node_id) || registeredNode?.name || '',
        brand: aircon.brand || data.brand, protocol: data.protocol_name, protocol_name: data.protocol_name,
        capabilities: { ...CapabilityEngine.getCapabilities(data.protocol_name), ...(aircon.capabilities || {}) }, status: payload.status };
      const aircons = this.getAll();
      const index = aircons.findIndex(a => a.device_id === saved.device_id ||
        (isAutoGeneratedTag(a.device_id, a.node_id) && saved.node_id && normalizeAirconNodeId(a.node_id) === normalizeAirconNodeId(saved.node_id)));
      if (index >= 0) aircons[index] = { ...aircons[index], ...saved };
      else aircons.push(saved);
      const finalAircons = deduplicateAirconList(aircons);
      localStorage.setItem('ecoTrack_aircons', JSON.stringify(finalAircons));
      CentralLogService.log({ device_id: saved.device_id, node_id: saved.node_id, module: 'CONFIG',
        event: index >= 0 ? 'AIRCON_UPDATED' : 'AIRCON_REGISTERED', result: 'SUCCESS',
        details: `${saved.name} (${saved.brand} • Protocol: ${saved.protocol_name})` });
      window.EcoDataBus?.invalidate('scheduler:data');
      window.EcoDataBus?.invalidate('nodes');
      AirconEvents.emit('aircon:saved', saved);
      AirconEvents.emit('aircons:synced', finalAircons);
      AirconEvents.emit('devices:synced', { nodes: NodeService.getNodes(), aircons: finalAircons });
      return saved;
    }

    static async delete(device_id) {
      const target = this.getById(device_id);
      if (!target) return false;
      const sb = window.supabaseClient || window.sb;
      if (!sb?.from) throw new Error('Connect to Supabase before deleting an AC profile.');
      const response = await sb.from('aircons').delete().eq('asset_tag', target.device_id).select('id');
      if (response.error) throw new Error(response.error.message || 'The AC profile was not deleted.');
      const confirmation = await sb.from('aircons').select('id').eq('asset_tag', target.device_id).maybeSingle();
      if (confirmation.error || confirmation.data) throw new Error(confirmation.error?.message || 'Supabase did not confirm deletion.');
      const aircons = this.getAll().filter(ac => ac.device_id !== target.device_id);
      localStorage.setItem('ecoTrack_aircons', JSON.stringify(aircons));
      window.EcoDataBus?.invalidate('scheduler:data'); window.EcoDataBus?.invalidate('nodes');
      AirconEvents.emit('aircon:deleted', target.device_id);
      AirconEvents.emit('devices:synced', { nodes: NodeService.getNodes(), aircons });
      return true;
    }

    static updateState(device_id, stateUpdates, controlSnapshot) {
      const aircons = this.getAll();
      const target = aircons.find(a => a.device_id === device_id);
      if (!target) return null;

      if (controlSnapshot) target.control_snapshot = controlSnapshot;
      target.state = {
        ...target.state,
        ...stateUpdates,
        updated_at: new Date().toISOString()
      };

      localStorage.setItem('ecoTrack_aircons', JSON.stringify(aircons));
      AirconEvents.emit('aircon:state_changed', target);

      return target.state;
    }
  }

  // ===== CAPABILITY ENGINE =====
  // Predefined dictionary of supported AC brand limits and dynamic protocol profiles
  const BRAND_PROTOCOL_LIMITS = {
    midea_ir: {
      protocol_name: 'midea_ir',
      brand: 'Midea',
      label: 'Midea / Carrier / Comfee (climate_ir: midea)',
      min_temp: 16,
      max_temp: 30,
      temperature_min: 16,
      temperature_max: 30,
      modes: ['cool', 'dry', 'fan', 'auto', 'heat'],
      fans: ['low', 'medium', 'high', 'auto'],
      fan_speeds: ['low', 'medium', 'high', 'auto'],
      swing: true,
      turbo: true,
      eco: true,
      sleep: true,
      timer: true,
      power: true,
      temperature: true
    },
    gree: {
      protocol_name: 'gree',
      brand: 'Gree',
      label: 'Gree Electric / Tosot (climate_ir: gree)',
      min_temp: 16,
      max_temp: 30,
      temperature_min: 16,
      temperature_max: 30,
      modes: ['cool', 'dry', 'fan', 'auto', 'heat'],
      fans: ['low', 'medium', 'high', 'auto', 'turbo'],
      fan_speeds: ['low', 'medium', 'high', 'auto', 'turbo'],
      swing: true,
      turbo: true,
      eco: true,
      sleep: true,
      timer: true,
      power: true,
      temperature: true
    },
    daikin: {
      protocol_name: 'daikin',
      brand: 'Daikin',
      label: 'Daikin ARC433 / ARC4xx (climate_ir: daikin)',
      min_temp: 18,
      max_temp: 32,
      temperature_min: 18,
      temperature_max: 32,
      modes: ['cool', 'dry', 'fan', 'auto', 'heat'],
      fans: ['low', 'medium', 'high', 'auto', 'quiet'],
      fan_speeds: ['low', 'medium', 'high', 'auto', 'quiet'],
      swing: true,
      turbo: true,
      eco: true,
      sleep: true,
      timer: true,
      power: true,
      temperature: true
    },
    carrier: {
      protocol_name: 'carrier',
      brand: 'Carrier',
      label: 'Carrier Inverter / Optima (climate_ir: carrier)',
      min_temp: 17,
      max_temp: 30,
      temperature_min: 17,
      temperature_max: 30,
      modes: ['cool', 'dry', 'fan', 'auto'],
      fans: ['low', 'medium', 'high', 'auto'],
      fan_speeds: ['low', 'medium', 'high', 'auto'],
      swing: true,
      turbo: true,
      eco: true,
      sleep: true,
      timer: true,
      power: true,
      temperature: true
    },
    panasonic: {
      protocol_name: 'panasonic',
      brand: 'Panasonic',
      label: 'Panasonic CS Series (climate_ir: panasonic)',
      min_temp: 16,
      max_temp: 30,
      temperature_min: 16,
      temperature_max: 30,
      modes: ['cool', 'dry', 'fan', 'auto', 'heat'],
      fans: ['low', 'medium', 'high', 'auto'],
      fan_speeds: ['low', 'medium', 'high', 'auto'],
      swing: true,
      turbo: true,
      eco: true,
      sleep: true,
      timer: true,
      power: true,
      temperature: true
    },
    koppel_ir: {
      protocol_name: 'koppel_ir',
      brand: 'Koppel',
      label: 'Koppel Split / Window (climate_ir: koppel)',
      min_temp: 16,
      max_temp: 30,
      temperature_min: 16,
      temperature_max: 30,
      modes: ['cool', 'dry', 'fan', 'auto'],
      fans: ['low', 'medium', 'high', 'auto'],
      fan_speeds: ['low', 'medium', 'high', 'auto'],
      swing: true,
      turbo: true,
      eco: true,
      sleep: true,
      timer: true,
      power: true,
      temperature: true
    },
    mitsubishi: {
      protocol_name: 'mitsubishi',
      brand: 'Mitsubishi',
      label: 'Mitsubishi Heavy / Electric (climate_ir: mitsubishi)',
      min_temp: 16,
      max_temp: 31,
      temperature_min: 16,
      temperature_max: 31,
      modes: ['cool', 'dry', 'fan', 'auto', 'heat'],
      fans: ['low', 'medium', 'high', 'auto', 'silent'],
      fan_speeds: ['low', 'medium', 'high', 'auto', 'silent'],
      swing: true,
      turbo: true,
      eco: true,
      sleep: true,
      timer: true,
      power: true,
      temperature: true
    },
    samsung: {
      protocol_name: 'samsung',
      brand: 'Samsung',
      label: 'Samsung WindFree / Digital (climate_ir: samsung)',
      min_temp: 16,
      max_temp: 30,
      temperature_min: 16,
      temperature_max: 30,
      modes: ['cool', 'dry', 'fan', 'auto', 'heat'],
      fans: ['low', 'medium', 'high', 'auto', 'turbo'],
      fan_speeds: ['low', 'medium', 'high', 'auto', 'turbo'],
      swing: true,
      turbo: true,
      eco: true,
      sleep: true,
      timer: true,
      power: true,
      temperature: true
    },
    generic_ac: {
      protocol_name: 'generic_ac',
      brand: 'Generic',
      label: 'Universal Generic AC (climate_ir: generic)',
      min_temp: 16,
      max_temp: 30,
      temperature_min: 16,
      temperature_max: 30,
      modes: ['cool', 'dry', 'fan', 'auto'],
      fans: ['low', 'medium', 'high', 'auto'],
      fan_speeds: ['low', 'medium', 'high', 'auto'],
      swing: true,
      turbo: false,
      eco: true,
      sleep: true,
      timer: true,
      power: true,
      temperature: true
    }
  };

  class CapabilityEngine {
    static get BRAND_PROTOCOL_LIMITS() {
      return BRAND_PROTOCOL_LIMITS;
    }

    /**
     * Resolves canonical protocol name from device, brand or protocol string
     */
    static resolveProtocolName(deviceOrProtocol) {
      if (!deviceOrProtocol) return 'generic_ac';
      let raw = '';
      if (typeof deviceOrProtocol === 'string') {
        raw = deviceOrProtocol.toLowerCase().trim();
      } else if (typeof deviceOrProtocol === 'object') {
        raw = (deviceOrProtocol.protocol_name || deviceOrProtocol.protocol || deviceOrProtocol.brand || deviceOrProtocol.model || '').toLowerCase().trim();
      }
      if (raw.includes('midea') || raw.includes('comfee')) return 'midea_ir';
      if (raw.includes('gree') || raw.includes('tosot')) return 'gree';
      if (raw.includes('daikin')) return 'daikin';
      if (raw.includes('carrier') || raw.includes('condura')) return 'carrier';
      if (raw.includes('panasonic')) return 'panasonic';
      if (raw.includes('koppel') || raw.includes('fujidenzo')) return 'koppel_ir';
      if (raw.includes('mitsubishi')) return 'mitsubishi';
      if (raw.includes('samsung')) return 'samsung';
      if (raw.includes('generic')) return 'generic_ac';
      if (BRAND_PROTOCOL_LIMITS[raw]) return raw;
      return 'generic_ac';
    }

    /**
     * Read capabilities from predefined dictionary of brand limits
     * @param {Object|string} deviceOrProtocol
     */
    static getCapabilities(deviceOrProtocol) {
      if (!deviceOrProtocol) return BRAND_PROTOCOL_LIMITS.generic_ac;
      const proto = this.resolveProtocolName(deviceOrProtocol);
      const base = BRAND_PROTOCOL_LIMITS[proto] || BRAND_PROTOCOL_LIMITS.midea_ir;

      if (typeof deviceOrProtocol === 'object' && deviceOrProtocol !== null) {
        const devCaps = deviceOrProtocol.capabilities || {};
        return {
          ...base,
          ...devCaps,
          protocol_name: proto,
          min_temp: (devCaps.min_temp !== undefined ? devCaps.min_temp : (devCaps.temperature_min !== undefined ? devCaps.temperature_min : base.min_temp)),
          max_temp: (devCaps.max_temp !== undefined ? devCaps.max_temp : (devCaps.temperature_max !== undefined ? devCaps.temperature_max : base.max_temp)),
          temperature_min: (devCaps.temperature_min !== undefined ? devCaps.temperature_min : (devCaps.min_temp !== undefined ? devCaps.min_temp : base.temperature_min)),
          temperature_max: (devCaps.temperature_max !== undefined ? devCaps.temperature_max : (devCaps.max_temp !== undefined ? devCaps.max_temp : base.temperature_max)),
          modes: (Array.isArray(devCaps.modes) && devCaps.modes.length > 0) ? devCaps.modes : base.modes,
          fans: (Array.isArray(devCaps.fans) && devCaps.fans.length > 0) ? devCaps.fans : (Array.isArray(devCaps.fan_speeds) && devCaps.fan_speeds.length > 0 ? devCaps.fan_speeds : base.fans),
          fan_speeds: (Array.isArray(devCaps.fans) && devCaps.fans.length > 0) ? devCaps.fans : (Array.isArray(devCaps.fan_speeds) && devCaps.fan_speeds.length > 0 ? devCaps.fan_speeds : base.fans),
          swing: devCaps.swing !== undefined ? !!devCaps.swing : base.swing,
          turbo: devCaps.turbo !== undefined ? !!devCaps.turbo : base.turbo,
          eco: devCaps.eco !== undefined ? !!devCaps.eco : base.eco,
          sleep: devCaps.sleep !== undefined ? !!devCaps.sleep : base.sleep,
          timer: devCaps.timer !== undefined ? !!devCaps.timer : base.timer,
          power: devCaps.power !== undefined ? !!devCaps.power : base.power,
          temperature: devCaps.temperature !== undefined ? !!devCaps.temperature : base.temperature
        };
      }

      return { ...base };
    }

    /**
     * Determine whether a command/feature is supported for a given device or protocol
     */
    static isSupported(deviceOrProtocol, feature, value = null) {
      const caps = this.getCapabilities(deviceOrProtocol);
      if (!caps) return false;
      const feat = (feature || '').toUpperCase();

      switch (feat) {
        case 'POWER':
          return !!caps.power;
        case 'TEMPERATURE':
        case 'TEMP':
          if (value !== null && value !== undefined && typeof value === 'number') {
            const min = caps.min_temp ?? caps.temperature_min ?? 16;
            const max = caps.max_temp ?? caps.temperature_max ?? 30;
            return value >= min && value <= max;
          }
          return !!caps.temperature;
        case 'MODE':
          return Array.isArray(caps.modes) && (value ? caps.modes.includes(String(value).toLowerCase()) : caps.modes.length > 0);
        case 'FAN':
          return Array.isArray(caps.fans) && (value ? caps.fans.includes(String(value).toLowerCase()) : caps.fans.length > 0);
        case 'SWING':
          return !!caps.swing;
        case 'SLEEP':
          return !!caps.sleep;
        case 'TURBO':
          return !!caps.turbo;
        case 'ECO':
          return !!caps.eco;
        case 'TIMER':
          return !!caps.timer;
        default:
          return false;
      }
    }

    static clampTemperature(deviceOrProtocol, requestedTemp) {
      const caps = this.getCapabilities(deviceOrProtocol);
      const min = caps.min_temp ?? caps.temperature_min ?? 16;
      const max = caps.max_temp ?? caps.temperature_max ?? 30;
      return Math.max(min, Math.min(max, requestedTemp));
    }

    static getSupportedProtocols() {
      return Object.values(BRAND_PROTOCOL_LIMITS);
    }
  }

  // ===== PROTOCOL ADAPTER & IR SERVICE =====
  class ProtocolAdapter {
    /** Learn an actual remote capture through Supabase, from any network. */
    static decodeRemoteCapture(data) {
      const protocol = String(data.raw_type || data.protocol || '').trim().toUpperCase();
      if (!protocol || (!data.raw_data && !(Number(data.raw_count) >= 3)))
        return {success:false,message:'No valid IR frame was received. Retry while pressing the physical remote.'};
      const families = [
        [/^DAIKIN/, 'Daikin'], [/^MIDEA/, 'Midea'], [/^GREE$/, 'Gree'],
        [/^CARRIER_AC/, 'Carrier'], [/^PANASONIC_AC/, 'Panasonic'], [/^SAMSUNG_AC$/, 'Samsung'],
        [/^MITSUBISHI/, 'Mitsubishi'], [/^HAIER/, 'Haier'], [/^HITACHI/, 'Hitachi'],
        [/^TOSHIBA_AC$/, 'Toshiba'], [/^FUJITSU_AC$/, 'Fujitsu'], [/^LG(?:2)?$/, 'LG'],
        [/^SHARP_AC$/, 'Sharp'], [/^TCL(?:112|96)AC$/, 'TCL'], [/^WHIRLPOOL_AC$/, 'Whirlpool']
      ];
      const brand = families.find(([pattern]) => pattern.test(protocol))?.[1] || null;
      return {...data,success:true,brand,protocol,ambiguous:!brand,
        message:brand ? 'Recognized ' + brand + ' IR protocol.' : 'IR protocol ' + protocol + ' was captured. Choose the manufacturer manually; this protocol can be shared by multiple brands.'};
    }
    static async detectRemoteBrand(nodeId, options = {}) {
      try {
        const data = options.nearby ? await window.EcoTrackHardwareCloud.learnNearby(nodeId, options) : await window.EcoTrackHardwareCloud.learn(nodeId);
        return this.decodeRemoteCapture(data);
      } catch (error) { return {success:false,message:error.message,code:error.code}; }
    }
    static getSupportedProtocols() { return CapabilityEngine.getSupportedProtocols(); }
    static async sniffProtocol(nodeId) {
      try { return await window.EcoTrackHardwareCloud.learn(nodeId); }
      catch (error) { return { success: false, message: error.message, code: error.code, source: 'supabase' }; }
    }
    static async getLatestLearned(nodeId) {
      try { return await window.EcoTrackHardwareCloud.latest(nodeId); }
      catch (error) { return { success: false, message: error.message, code: error.code, source: 'supabase' }; }
    }

    static getCommandsForDevice(device_id) {
      try {
        const raw = localStorage.getItem('ecoTrack_ir_commands');
        const commands = raw ? JSON.parse(raw) : DEFAULT_IR_COMMANDS;
        return commands.filter(c => c.device_id === device_id);
      } catch (_) {
        return DEFAULT_IR_COMMANDS.filter(c => c.device_id === device_id);
      }
    }

    static saveCommand(cmd) {
      try {
        const raw = localStorage.getItem('ecoTrack_ir_commands');
        const commands = raw ? JSON.parse(raw) : [...DEFAULT_IR_COMMANDS];
        const newCmd = {
          id: cmd.id || 'cmd_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
          device_id: cmd.device_id,
          command_type: cmd.command_type,
          protocol: cmd.protocol || 'UNKNOWN',
          raw_data: cmd.raw_data || '',
          decoded_data: cmd.decoded_data || '',
          created_at: new Date().toISOString()
        };
        const idx = commands.findIndex(c => c.device_id === newCmd.device_id && c.command_type === newCmd.command_type);
        if (idx >= 0) commands[idx] = newCmd;
        else commands.push(newCmd);

        localStorage.setItem('ecoTrack_ir_commands', JSON.stringify(commands));
        AirconEvents.emit('ir:command_saved', newCmd);
        AirconEvents.emit('ir:updated', { device_id: newCmd.device_id, action: 'save', command: newCmd });
        return newCmd;
      } catch (err) {
        console.error('Failed to save IR command:', err);
        return null;
      }
    }

    static deleteCommand(idOrDeviceId, commandType = null) {
      try {
        const raw = localStorage.getItem('ecoTrack_ir_commands');
        let commands = raw ? JSON.parse(raw) : [...DEFAULT_IR_COMMANDS];
        let deletedCmd = null;

        if (commandType) {
          deletedCmd = commands.find(c => c.device_id === idOrDeviceId && c.command_type === commandType);
          commands = commands.filter(c => !(c.device_id === idOrDeviceId && c.command_type === commandType));
        } else {
          deletedCmd = commands.find(c => c.id === idOrDeviceId);
          commands = commands.filter(c => c.id !== idOrDeviceId);
        }

        localStorage.setItem('ecoTrack_ir_commands', JSON.stringify(commands));
        if (deletedCmd) {
          AirconEvents.emit('ir:command_deleted', deletedCmd);
          AirconEvents.emit('ir:updated', { device_id: deletedCmd.device_id, action: 'delete', command: deletedCmd });
        }
        return true;
      } catch (err) {
        console.error('Failed to delete IR command:', err);
        return false;
      }
    }

    static getCustomFunctions(device_id) {
      try {
        const raw = localStorage.getItem(`ecoTrack_custom_funcs_${device_id}`);
        return raw ? JSON.parse(raw) : [];
      } catch (_) {
        return [];
      }
    }

    static addCustomFunction(device_id, funcName) {
      try {
        const cleanName = (funcName || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_').replace(/_+/g, '_');
        if (!cleanName) return null;
        const funcs = this.getCustomFunctions(device_id);
        if (!funcs.includes(cleanName)) {
          funcs.push(cleanName);
          localStorage.setItem(`ecoTrack_custom_funcs_${device_id}`, JSON.stringify(funcs));
          AirconEvents.emit('ir:function_added', { device_id, function_name: cleanName });
          AirconEvents.emit('ir:updated', { device_id, action: 'add_function', function_name: cleanName });
        }
        return cleanName;
      } catch (err) {
        console.error('Failed to add custom function:', err);
        return null;
      }
    }

    static deleteFunction(device_id, funcName) {
      try {
        let funcs = this.getCustomFunctions(device_id);
        const wasCustom = funcs.includes(funcName);
        if (wasCustom) {
          funcs = funcs.filter(f => f !== funcName);
          localStorage.setItem(`ecoTrack_custom_funcs_${device_id}`, JSON.stringify(funcs));
        }
        // Also remove any recorded IR signal for this function
        this.deleteCommand(device_id, funcName);
        AirconEvents.emit('ir:function_deleted', { device_id, function_name: funcName, wasCustom });
        AirconEvents.emit('ir:updated', { device_id, action: 'delete_function', function_name: funcName });
        return true;
      } catch (err) {
        console.error('Failed to delete function:', err);
        return false;
      }
    }

    /**
     * Check command coverage and functions for an aircon
     */
    static getCoverage(device) {
      if (!device) return { items: [], total: 0, mappedCount: 0, percent: 0, protocol: 'midea_ir' };
      const proto = CapabilityEngine.resolveProtocolName(device);
      const caps = CapabilityEngine.getCapabilities(device);

      const knownCmds = this.getCommandsForDevice(device.device_id).map(c => c.command_type);
      const needed = ['POWER_ON', 'POWER_OFF'];
      if (caps && caps.modes) {
        caps.modes.forEach(m => needed.push(`MODE_${m.toUpperCase()}`));
      }
      needed.push('TEMP_UP', 'TEMP_DOWN');
      if (caps && caps.fans) {
        caps.fans.forEach(f => needed.push(`FAN_${f.toUpperCase()}`));
      }
      if (caps && caps.swing) needed.push('SWING');
      if (caps && caps.sleep) needed.push('SLEEP');
      if (caps && caps.turbo) needed.push('TURBO');
      if (caps && caps.eco) needed.push('ECO');

      // Include user-added custom functions for this device
      const customFuncs = this.getCustomFunctions(device.device_id);
      customFuncs.forEach(cf => {
        if (!needed.includes(cf)) needed.push(cf);
      });

      // Include any stored commands that exist in library
      knownCmds.forEach(kc => {
        if (!needed.includes(kc)) needed.push(kc);
      });

      const coverage = needed.map(cmdType => ({
        type: cmdType,
        mapped: knownCmds.includes(cmdType),
        isCustom: customFuncs.includes(cmdType)
      }));

      const mappedCount = coverage.filter(c => c.mapped).length;
      return {
        protocol: proto,
        capabilities: caps,
        items: coverage,
        total: needed.length,
        mappedCount,
        percent: needed.length > 0 ? Math.round((mappedCount / needed.length) * 100) : 0
      };
    }
  }

  // ===== COMMAND MANAGER =====
  const controllerCommandQueues = new Map();
  class CommandManager {
    /**
     * Dispatch an aircon control command via dynamic protocol state generation
     * @param {Object} req
     * @param {string} req.device_id - MANDATORY target device ID
     * @param {'POWER' | 'TEMP' | 'MODE' | 'FAN' | 'SWING' | 'SLEEP' | 'TURBO' | 'ECO'} req.command
     * @param {any} req.value
     * @returns {Promise<{ success: boolean, message: string, state?: Object, code?: string, intent?: Object }>}
     */
    static dispatch(req) {
      const key = req?.device_id || 'UNKNOWN';
      const pending = (controllerCommandQueues.get(key) || Promise.resolve())
        .catch(() => {}).then(() => this.dispatchCommand(req));
      controllerCommandQueues.set(key, pending);
      return pending.finally(() => {
        if (controllerCommandQueues.get(key) === pending) controllerCommandQueues.delete(key);
      });
    }

    static async dispatchCommand(req) {
      const { device_id, command, value } = req;
      const requestId = req.request_id || 'REQ-' + Date.now().toString(36).toUpperCase();

      // 1. Validate Target Device ID
      if (!device_id) {
        const errorMsg = 'Command rejected: Missing target device_id. Commands cannot be broadcast untargeted.';
        CentralLogService.log({
          device_id: 'UNKNOWN',
          module: 'CONTROL',
          event: 'COMMAND_REJECTED',
          result: 'FAILED',
          details: errorMsg
        });
        return { success: false, message: errorMsg };
      }

      // 2. Validate Device Existence
      const device = AirconProfileManager.getById(device_id);
      if (!device) {
        const errorMsg = `Command rejected: Aircon with ID ${device_id} not found in system registry.`;
        CentralLogService.log({
          device_id,
          module: 'CONTROL',
          event: 'COMMAND_FAILED',
          result: 'FAILED',
          details: errorMsg
        });
        return { success: false, message: errorMsg };
      }

      if (req.protocol !== undefined) {
        if (typeof req.protocol !== 'string' || !/^[A-Za-z0-9_]{1,64}$/.test(req.protocol)) return { success: false, code: 'INVALID_PROTOCOL', message: 'Choose a valid IR protocol.' };
        device.protocol_name = req.protocol;
        device.protocol = req.protocol;
        device.capabilities = CapabilityEngine.getCapabilities(req.protocol);
      }

      // 3. Check Assigned AC Controller Device Status
      const node = NodeService.getNode(device.node_id);
      if (!node) {
        const errorMsg = `Command not sent: Assigned hardware node (${device.node_id}) is currently OFFLINE.`;
        CentralLogService.log({
          device_id,
          node_id: device.node_id,
          module: 'CONTROL',
          event: 'COMMAND_BLOCKED_NODE_OFFLINE',
          result: 'OFFLINE',
          details: `${command} = ${JSON.stringify(value)} aborted because node is unreachable.`
        });
        return { 
          success: false, 
          message: errorMsg, 
          code: 'NODE_OFFLINE', 
          node_id: device.node_id, 
          device_id: device.device_id,
          command,
          value,
          node: node || null,
          device
        };
      }

      // 4. Validate Capability against Protocol Limits Dictionary
      if (!CapabilityEngine.isSupported(device, command, value)) {
        const errorMsg = `Capability violation: ${device.brand} ${device.model} (${device.name}) does not support ${command} ${value !== null && value !== undefined ? '(' + value + ')' : ''}.`;
        CentralLogService.log({
          device_id,
          node_id: device.node_id,
          module: 'CONTROL',
          event: 'COMMAND_UNSUPPORTED',
          result: 'FAILED',
          details: errorMsg
        });
        return { 
          success: false, 
          message: errorMsg, 
          code: 'UNSUPPORTED_CAPABILITY',
          node_id: device.node_id,
          device_id: device.device_id,
          command,
          value,
          device
        };
      }

      // 5. Build State Mutation
      const stateUpdates = {};
      switch (command) {
        case 'POWER':
          stateUpdates.power = Boolean(value);
          break;
        case 'TEMP':
          stateUpdates.temperature = CapabilityEngine.clampTemperature(device, Number(value));
          break;
        case 'MODE':
          stateUpdates.mode = String(value).toLowerCase();
          break;
        case 'FAN':
          stateUpdates.fan = String(value).toLowerCase();
          break;
        case 'SWING':
          stateUpdates.swing = Boolean(value);
          break;
        case 'SLEEP':
          stateUpdates.sleep = Boolean(value);
          break;
        case 'TURBO':
          stateUpdates.turbo = Boolean(value);
          break;
        case 'ECO':
          stateUpdates.eco = Boolean(value);
          break;
        default:
          break;
      }

      // IR Studio can submit the selected complete state as one cloud request.
      if (req.state !== undefined) {
        const mapping = { power: 'POWER', temperature: 'TEMP', mode: 'MODE', fan: 'FAN', swing: 'SWING', sleep: 'SLEEP', turbo: 'TURBO', eco: 'ECO' };
        if (!req.state || typeof req.state !== 'object' || Array.isArray(req.state)) return { success: false, code: 'INVALID_STATE', message: 'Invalid complete AC settings.' };
        for (const [field, selected] of Object.entries(req.state)) {
          if (!Object.hasOwn(mapping, field) ||
              (['power','swing','sleep','turbo','eco'].includes(field) && typeof selected !== 'boolean') ||
              (field === 'temperature' && (typeof selected !== 'number' || !Number.isFinite(selected))) ||
              (['mode','fan'].includes(field) && typeof selected !== 'string')) return { success: false, code: 'INVALID_STATE', message: `Invalid AC setting: ${field}.` };
          if (!CapabilityEngine.isSupported(device, mapping[field], selected)) return { success: false, code: 'UNSUPPORTED_CAPABILITY', message: `This AC profile does not support ${field}: ${selected}.` };
          stateUpdates[field] = field === 'temperature' ? CapabilityEngine.clampTemperature(device, selected) : ['mode','fan'].includes(field) ? selected.toLowerCase() : selected;
        }
      }

      // 6. Construct Structured JSON Intent Payload (Dynamic Full-State IR Generation)
      const protocolName = device.protocol_name || device.protocol || CapabilityEngine.resolveProtocolName(device);
      const nextPower = stateUpdates.power !== undefined ? (stateUpdates.power ? 'on' : 'off') : ((device.state && device.state.power) ? 'on' : 'off');
      const nextMode = stateUpdates.mode || (device.state && device.state.mode) || 'cool';
      const nextTemp = stateUpdates.temperature !== undefined ? stateUpdates.temperature : ((device.state && device.state.temperature) || 24);
      const nextFan = stateUpdates.fan || (device.state && device.state.fan) || 'auto';

      const intentPayload = {
        protocol: protocolName,
        state: {
          power: nextPower,
          mode: nextMode,
          temp: nextTemp,
          fan: nextFan
        }
      };

      if (stateUpdates.swing !== undefined || (device.state && device.state.swing !== undefined)) {
        intentPayload.state.swing = (stateUpdates.swing !== undefined ? stateUpdates.swing : device.state.swing) ? 'on' : 'off';
      }
      if (stateUpdates.sleep !== undefined || (device.state && device.state.sleep !== undefined)) {
        intentPayload.state.sleep = (stateUpdates.sleep !== undefined ? stateUpdates.sleep : device.state.sleep) ? 'on' : 'off';
      }
      if (stateUpdates.turbo !== undefined || (device.state && device.state.turbo !== undefined)) {
        intentPayload.state.turbo = (stateUpdates.turbo !== undefined ? stateUpdates.turbo : device.state.turbo) ? 'on' : 'off';
      }
      if (stateUpdates.eco !== undefined || (device.state && device.state.eco !== undefined)) {
        intentPayload.state.eco = (stateUpdates.eco !== undefined ? stateUpdates.eco : device.state.eco) ? 'on' : 'off';
      }

      CentralLogService.log({
        device_id,
        node_id: device.node_id,
        module: 'IR',
        event: 'REQUESTING_COMMAND',
        result: 'PENDING',
        details: `Requesting cloud command for ${device.node_id} via ${protocolName}: ${JSON.stringify(intentPayload.state)} (Req: ${requestId})`
      });

      let savedCommand;
      try {
        const sb = window.supabaseClient || window.sb;
        if (!window.EcoTrackHardwareCloud || !sb) throw new Error('Supabase hardware transport is unavailable.');
        const record = await sb.from('aircons').select('id').eq('asset_tag', device.device_id).maybeSingle();
        if (record.error || !record.data?.id) throw new Error(record.error?.message || 'Registered aircon not found.');
        savedCommand = await window.EcoTrackHardwareCloud.control(device.node_id, { ...intentPayload, aircon_id: record.data.id });
      } catch (error) {
        return { success: false, code: error.code || 'CLOUD_COMMAND_FAILED', message: error.message, intent: intentPayload };
      }
      const delivered = false;
      const deliveryPersistenceError = null;
      device.control_snapshot = {
        ...device.control_snapshot,
        desired_state: intentPayload.state, commanded_at: savedCommand.commanded_at,
        command_id: savedCommand.command_id, command_status: 'queued',
        reported_state: device.control_snapshot?.reported_state, reported_at: device.control_snapshot?.reported_at
      };

      // 7. Commit State Update
      const updatedState = AirconProfileManager.updateState(device_id, stateUpdates, device.control_snapshot);
      device.state = updatedState;

      CentralLogService.log({
        device_id,
        node_id: device.node_id,
        module: 'CONTROL',
        event: delivered ? 'COMMAND_SUCCESS' : 'COMMAND_QUEUED',
        result: delivered ? 'SUCCESS' : 'PENDING',
        details: `${command} ${delivered ? 'transmitted' : 'queued'} for ${device.name} [Intent: ${protocolName}]`
      });

      // Fire synchronization events across all buses (preserving EcoDataBus contract)
      AirconEvents.emit('aircon:state_changed', device);
      const allNodes = NodeService.getNodes();
      const allAircons = AirconProfileManager.getAll();
      AirconEvents.emit('devices:synced', { nodes: allNodes, aircons: allAircons });

      if (typeof window !== 'undefined' && window.EcoDataBus) {
        window.EcoDataBus.invalidate('aircons');
        window.EcoDataBus.invalidate('nodes');
        window.EcoDataBus.emit('devices:synced', { nodes: allNodes, aircons: allAircons });
      }

      return {
        success: true,
        message: delivered ? `IR command ${command} transmitted to ${device.name}.` : `Command ${command} queued for ${device.name}.`,
        delivery_status: delivered ? 'transmitted' : 'queued',
        state_sync_error: deliveryPersistenceError,
        state: updatedState,
        request_id: requestId,
        intent: intentPayload
      };
    }
  }

  // ===== COMMAND STATE TRACKER (CONTROL ONLY - NO SENSORS) =====
  class CommandStateTracker {
    /**
     * Formats and returns the active commanded status of an aircon
     * @param {Object} device
     * @returns {string} e.g. "POWER ON • COOL (24°C)" or "POWER OFF"
     */
    static getCommandSummary(device) {
      if (!device || !device.state) return 'POWER OFF';
      const s = device.state;
      if (!s.power) return 'POWER OFF';
      const mode = (s.mode || 'cool').toUpperCase();
      const temp = s.temperature ? `${s.temperature}°C` : '';
      const fan = s.fan ? `FAN: ${s.fan.toUpperCase()}` : '';
      return ['POWER ON', mode, temp, fan].filter(Boolean).join(' • ');
    }

    static getSummary(device) {
      return this.getCommandSummary(device);
    }

    /**
     * State classification based strictly on commanded state (no environmental sensors)
     */
    static classify(temp, power = true, targetTemp = 24) {
      return power ? 'ACTIVE' : 'OFF';
    }

    /**
     * Sensor mismatch check eliminated for control-only system
     */
    static evaluateMismatch(device) {
      return false;
    }
  }

  // ===== EXPORT TO GLOBAL WINDOW SCOPE =====
  window.EcoTrackAirconSystem = {
    AirconProfileManager,
    CapabilityEngine,
    CommandManager,
    ProtocolAdapter,
    CommandStateTracker,
    OperationalStateClassifier: CommandStateTracker,
    ACControllerDeviceService,
    NodeService: ACControllerDeviceService,
    CentralLogService,
    AirconEvents,
    syncWithDatabase,
    DEFAULT_NODES,
    DEFAULT_AIRCONS,
    DEFAULT_IR_COMMANDS
  };

  console.log('âš¡ EcoTrack Universal Aircon Core Control Engine Initialized.');

})(typeof window !== 'undefined' ? window : globalThis);
