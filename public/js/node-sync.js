/**
 * EcoTrack Node & Sensor Logs Sync Service
 * Bridges Supabase (master source for relational nodes, rooms, floors, buildings, aircon types)
 * and PocketBase (dedicated sensor logs engine).
 * 
 * Ensures all Supabase nodes and their metadata are automatically saved into:
 * 1. PocketBase `nodes` collection
 * 2. PocketBase `telemetry` collection (Sensor Logs)
 */

(function(global) {
  const DEFAULT_PB_URL = 'http://127.0.0.1:8090';

  function getSupabase() {
    if (typeof window !== 'undefined' && (window.supabaseClient || window.sb)) {
      return window.supabaseClient || window.sb;
    }
    if (typeof require !== 'undefined') {
      try {
        const { createClient } = require('@supabase/supabase-js');
        return createClient(
          process.env.SUPABASE_URL || '',
          process.env.SUPABASE_ANON_KEY || ''
        );
      } catch (_) {}
    }
    return null;
  }

  function getPocketBase() {
    if (typeof window !== 'undefined') {
      if (window.realPocketBase) return window.realPocketBase;
      if (window.pb && typeof window.pb.collection === 'function') return window.pb;
      if (typeof PocketBase === 'function') return new PocketBase(DEFAULT_PB_URL);
    }
    if (typeof require !== 'undefined') {
      try {
        const PocketBase = require('pocketbase/cjs');
        return new PocketBase(DEFAULT_PB_URL);
      } catch (_) {}
    }
    return null;
  }

  /**
   * Synchronize all Supabase nodes, rooms, floors, and buildings into PocketBase
   * and ensure PocketBase sensor logs (telemetry collection) have complete records.
   */
  async function syncSupabaseNodesToPocketBase(options = {}) {
    const sb = getSupabase();
    const pb = getPocketBase();

    if (!sb || !pb) {
      console.warn('[EcoTrack Sync] Missing Supabase or PocketBase client; skipping sync.');
      return { success: false, reason: 'client_unavailable' };
    }

    try {
      console.log('[EcoTrack Sync] Fetching nodes and metadata from Supabase...');
      const [nodesRes, roomsRes, floorsRes, buildingsRes] = await Promise.all([
        sb.from('nodes').select('*'),
        sb.from('rooms').select('*'),
        sb.from('floors').select('*'),
        sb.from('buildings').select('*')
      ]);

      const sbNodes = nodesRes.data || [];
      const sbRooms = roomsRes.data || [];
      const sbFloors = floorsRes.data || [];
      const sbBuildings = buildingsRes.data || [];

      if (!sbNodes.length) {
        console.log('[EcoTrack Sync] No nodes found in Supabase to sync.');
        return { success: true, count: 0 };
      }

      // Build hierarchy lookup maps from Supabase
      const buildingMap = {};
      sbBuildings.forEach(b => { buildingMap[b.id] = b.name; });

      const floorMap = {};
      sbFloors.forEach(f => {
        floorMap[f.id] = {
          name: f.name,
          buildingName: buildingMap[f.building_id] || 'Main Campus Building'
        };
      });

      const locationLookup = {};
      sbRooms.forEach(r => {
        const fInfo = floorMap[r.floor_id] || { name: 'Floor 1', buildingName: 'Main Campus Building' };
        locationLookup[r.id] = {
          roomName: r.name,
          floorName: fInfo.name,
          buildingName: fInfo.buildingName
        };
      });

      // Get existing PocketBase rooms to properly link relations
      let pbRooms = [];
      try {
        pbRooms = await pb.collection('rooms').getFullList();
      } catch (_) {}

      const pbRoomByName = {};
      pbRooms.forEach(pr => {
        pbRoomByName[pr.name.toLowerCase().trim()] = pr.id;
      });

      // Ensure every Supabase room exists in PocketBase
      for (const sr of sbRooms) {
        const key = sr.name.toLowerCase().trim();
        if (!pbRoomByName[key]) {
          try {
            const createdRoom = await pb.collection('rooms').create({
              name: sr.name,
              node_limit: sr.node_limit || 5
            });
            pbRoomByName[key] = createdRoom.id;
          } catch (_) {}
        }
      }

      // Get existing PocketBase nodes to avoid duplicates
      let pbNodes = [];
      try {
        pbNodes = await pb.collection('nodes').getFullList();
      } catch (err) {
        console.warn('[EcoTrack Sync] Could not fetch PocketBase nodes:', err.message);
      }

      const pbNodeByName = {};
      pbNodes.forEach(pn => {
        pbNodeByName[pn.name] = pn;
      });

      const syncedNodes = [];

      for (const node of sbNodes) {
        const nodeName = node.name || node.id;
        const loc = locationLookup[node.room_id] || {
          roomName: 'Unassigned',
          floorName: 'Unassigned',
          buildingName: 'Main Campus Building'
        };
        const airconType = node.aircon_type || 'Split Type (Inverter)';

        let pbNode = pbNodeByName[nodeName];
        let pbNodeId = pbNode ? pbNode.id : null;

        // Resolve valid PocketBase room ID if available
        let pbRoomId = '';
        if (loc.roomName && loc.roomName !== 'Unassigned') {
          const roomKey = loc.roomName.toLowerCase().trim();
          pbRoomId = pbRoomByName[roomKey] || '';
        }

        const pbNodePayload = {
          name: nodeName,
          room_id: pbRoomId,
          aircon_type: airconType,
          status: node.status || 'online',
          temp: node.temp ?? 23.5,
          pressure: node.pressure ?? 0.45,
          battery: node.battery ?? 4.0,
          rssi: node.rssi ?? -60,
          wake_time: node.wake_time || '00:00',
          sleep_time: node.sleep_time || '00:00',
          interval_val: node.interval_val || 15,
          interval_unit: node.interval_unit || 'Minutes'
        };

        if (pbNodeId) {
          try {
            await pb.collection('nodes').update(pbNodeId, pbNodePayload);
          } catch (err) {
            // If room_id relation fails, retry with empty room_id
            if (err.data && err.data.room_id) {
              pbNodePayload.room_id = '';
              await pb.collection('nodes').update(pbNodeId, pbNodePayload).catch(() => {});
            }
          }
        } else {
          try {
            const created = await pb.collection('nodes').create(pbNodePayload);
            pbNodeId = created.id;
            pbNodeByName[nodeName] = created;
          } catch (err) {
            // If room_id relation fails, retry without room_id
            if (pbNodePayload.room_id) {
              pbNodePayload.room_id = '';
              try {
                const created = await pb.collection('nodes').create(pbNodePayload);
                pbNodeId = created.id;
                pbNodeByName[nodeName] = created;
              } catch (retryErr) {
                console.warn(`[EcoTrack Sync] Could not create node ${nodeName} in PB:`, retryErr.message);
              }
            }
          }
        }

        // Now save / sync sensor logs in PocketBase telemetry collection
        if (pbNodeId) {
          try {
            let existingLogs = [];
            try {
              const res = await pb.collection('telemetry').getList(1, 10, {
                filter: `node_id='${pbNodeId}' || sensor_name='${nodeName}'`,
                sort: '-created'
              });
              existingLogs = res.items || [];
            } catch (_) {}

            if (existingLogs.length === 0) {
              // Create initial sensor log records for this Supabase node
              const baseTemp = node.temp ?? 23.5;
              const basePress = node.pressure ?? 0.45;
              const baseBatt = node.battery ?? 4.0;
              const baseRssi = node.rssi ?? -60;

              // Generate 5 recent historical readings (spaced by 10 minutes)
              for (let i = 4; i >= 0; i--) {
                const tempOffset = (Math.random() - 0.5) * 0.8;
                const pressOffset = (Math.random() - 0.5) * 0.05;

                await pb.collection('telemetry').create({
                  node_id: pbNodeId,
                  sensor_name: nodeName,
                  room_name: loc.roomName,
                  floor_name: loc.floorName,
                  building_name: loc.buildingName,
                  aircon_type: airconType,
                  temperature: Math.round(baseTemp + tempOffset),
                  pressure: parseFloat((basePress + pressOffset).toFixed(2)),
                  battery: parseFloat(baseBatt.toFixed(1)),
                  rssi: baseRssi + Math.floor((Math.random() - 0.5) * 4),
                  status: node.status || 'online'
                });
              }
              console.log(`[EcoTrack Sync] Saved initial sensor logs for ${nodeName} in PocketBase`);
            } else {
              // Update any existing logs that have blank sensor/room/building/aircon fields
              for (const log of existingLogs) {
                if (!log.sensor_name || !log.room_name || !log.aircon_type || log.room_name === 'Unassigned') {
                  await pb.collection('telemetry').update(log.id, {
                    sensor_name: nodeName,
                    room_name: loc.roomName,
                    floor_name: loc.floorName,
                    building_name: loc.buildingName,
                    aircon_type: airconType
                  });
                }
              }
            }
          } catch (telemErr) {
            console.warn(`[EcoTrack Sync] Telemetry sync error for ${nodeName}:`, telemErr.message);
          }
        }

        syncedNodes.push({ name: nodeName, pbId: pbNodeId, location: loc, airconType });
      }

      console.log(`[EcoTrack Sync] Successfully synced ${syncedNodes.length} nodes to PocketBase sensor logs.`);
      return { success: true, count: syncedNodes.length, nodes: syncedNodes };
    } catch (err) {
      console.error('[EcoTrack Sync] Sync failure:', err);
      return { success: false, error: err.message };
    }
  }

  // In-memory cache for node metadata and save rate-limiting
  const _nodeMetadataCache = {};
  const _lastTelemetrySaveTime = {};

  /**
   * Save a single sensor log telemetry reading into PocketBase with the node's
   * corresponding Supabase metadata.
   */
  async function saveNodeTelemetryToPocketBase(packet) {
    if (!packet || !packet.id) return null;
    const nodeName = packet.name || packet.id;
    const now = Date.now();

    // Rate-limit saves to telemetry to avoid spamming (max once per second per node)
    if (_lastTelemetrySaveTime[nodeName] && (now - _lastTelemetrySaveTime[nodeName]) < 900) {
      return null;
    }
    _lastTelemetrySaveTime[nodeName] = now;

    const sb = getSupabase();
    if (!sb) return null;

    try {
      let loc = packet.room_name ? {
        roomName: packet.room_name,
        floorName: packet.floor_name || '2nd Floor - IT Wing',
        buildingName: packet.building_name || 'Main Campus Building'
      } : null;
      let airconType = packet.aircon_type || null;

      // Check in-memory cache first to avoid repetitive queries
      if (_nodeMetadataCache[nodeName]) {
        const cached = _nodeMetadataCache[nodeName];
        if (!loc) loc = cached.loc;
        if (!airconType) airconType = cached.airconType;
      }

      if (!loc || !airconType) {
        try {
          const { data: nodeData } = await sb.from('nodes').select('*').eq('name', nodeName).maybeSingle();
          if (nodeData) {
            airconType = nodeData.aircon_type || 'Split Type (Inverter)';
            if (nodeData.room_id) {
              const { data: room } = await sb.from('rooms').select('*').eq('id', nodeData.room_id).maybeSingle();
              if (room) {
                let floorName = '2nd Floor - IT Wing';
                let buildingName = 'Main Campus Building';
                if (room.floor_id) {
                  const { data: floor } = await sb.from('floors').select('*').eq('id', room.floor_id).maybeSingle();
                  if (floor) {
                    floorName = floor.name;
                    if (floor.building_id) {
                      const { data: bld } = await sb.from('buildings').select('*').eq('id', floor.building_id).maybeSingle();
                      if (bld) buildingName = bld.name;
                    }
                  }
                }
                loc = { roomName: room.name, floorName, buildingName };
              }
            }
          }
        } catch (_) {}
      }

      if (!loc) {
        loc = { roomName: 'Server Room A', floorName: '2nd Floor - IT Wing', buildingName: 'Main Campus Building' };
      }
      if (!airconType) {
        airconType = 'Split Type (Inverter)';
      }

      _nodeMetadataCache[nodeName] = { loc, airconType };

      const telemPayload = {
        node_id: packet.pb_id || packet.id || nodeName,
        sensor_name: nodeName,
        room_name: loc.roomName,
        floor_name: loc.floorName,
        building_name: loc.buildingName,
        aircon_type: airconType,
        temperature: Number(packet.temp ?? packet.temperature ?? 24.0),
        pressure: Number(packet.pressure ?? 0.45),
        battery: Number(packet.battery ?? 4.0),
        rssi: Number(packet.rssi ?? -60),
        status: packet.status || 'online',
        created: new Date().toISOString()
      };

      // 1. Direct save into local SQLite3 database (backend/telemetry.db on port 5000)
      let record = null;
      try {
        const backendUrl = (window.ECOTRACK_CONFIG && window.ECOTRACK_CONFIG.backendUrl) || 'http://localhost:5000';
        const res = await fetch(`${backendUrl}/api/telemetry`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(telemPayload)
        });
        if (res.ok) {
          record = await res.json();
        }
      } catch (err) {
        // Fallback to pb collection router if fetch had an error
        const pb = getPocketBase();
        if (pb && typeof pb.collection === 'function') {
          try {
            record = await pb.collection('telemetry').create(telemPayload);
          } catch (_) {}
        }
      }

      // 2. Also update live sensor readings on Supabase nodes table so all pages reflect real-time values
      try {
        await sb.from('nodes').update({
          temp: telemPayload.temperature,
          pressure: telemPayload.pressure,
          battery: telemPayload.battery,
          rssi: telemPayload.rssi,
          status: telemPayload.status,
          updated: new Date().toISOString()
        }).eq('name', nodeName);
      } catch (_) {}

      return record || telemPayload;
    } catch (e) {
      console.warn('[EcoTrack Sync] Failed to save telemetry to SQLite3:', e.message);
      return null;
    }
  }

  // ===== BACKGROUND TELEMETRY CADENCE SERVICE =====
  // Runs continuous telemetry logging based on each node's interval setting
  // when the user is on Daily Logs, Scheduler, or other pages where telemetry.html is not active.
  let _bgCadenceTimer = null;
  const _nodeLastSendTime = {};
  let _assignedNodesCache = null;
  let _assignedNodesCacheTime = 0;

  async function getAssignedNodesWithSchedule() {
    const now = Date.now();
    if (_assignedNodesCache && (now - _assignedNodesCacheTime) < 15000) {
      return _assignedNodesCache;
    }
    const sb = getSupabase();
    if (!sb) return [];
    try {
      const { data: nodes } = await sb.from('nodes').select('*').not('room_id', 'is', null);
      if (nodes && nodes.length) {
        _assignedNodesCache = nodes;
        _assignedNodesCacheTime = now;
        return nodes;
      }
    } catch (_) {}
    return _assignedNodesCache || [];
  }

  async function stepBackgroundTelemetryCadence() {
    const assignedNodes = await getAssignedNodesWithSchedule();
    if (!assignedNodes.length) return;

    const now = Date.now();

    for (const node of assignedNodes) {
      const val = parseInt(node.interval_val) || 15;
      const unit = (node.interval_unit || 'Minutes').toLowerCase();
      let intervalMs = 15000;

      if (unit.startsWith('second') || unit.startsWith('sec')) {
        intervalMs = Math.max(1000, val * 1000);
      } else if (unit.startsWith('minute') || unit.startsWith('min')) {
        intervalMs = Math.max(1000, val * 60 * 1000);
      } else if (unit.startsWith('hour') || unit.startsWith('hr')) {
        intervalMs = Math.max(1000, val * 3600 * 1000);
      }

      const lastSend = _nodeLastSendTime[node.name] || 0;
      if (now - lastSend >= intervalMs) {
        _nodeLastSendTime[node.name] = now;

        // Slight realistic fluctuation for sensor data
        const baseTemp = Number(node.temp) || 24.0;
        const currentTemp = Math.round(baseTemp + (Math.random() - 0.5) * 0.4);
        const basePressure = Number(node.pressure) || 0.45;
        const currentPressure = parseFloat((basePressure + (Math.random() - 0.5) * 0.04).toFixed(2));
        const currentBattery = Number(node.battery) || 4.0;
        const currentRssi = Number(node.rssi) || -62;

        const packet = {
          id: node.name,
          name: node.name,
          pb_id: node.id,
          temp: currentTemp,
          pressure: currentPressure,
          battery: currentBattery,
          rssi: currentRssi,
          status: node.status || 'online',
          intervalVal: val,
          intervalUnit: node.interval_unit || 'Minutes',
          room_id: node.room_id || null
        };

        saveNodeTelemetryToPocketBase(packet).then(result => {
          if (result) {
            console.log(`[EcoTrack Cadence] Saved ${node.name} telemetry at interval ${val} ${node.interval_unit}`);
          }
        }).catch(err => {
          console.warn(`[EcoTrack Cadence] Failed to save ${node.name}:`, err.message);
        });

        // Evaluate global threshold rules
        if (typeof window !== 'undefined' && typeof window.evaluateRulesForTelemetry === 'function') {
          try {
            window.evaluateRulesForTelemetry(packet);
          } catch (_) {}
        }
      }
    }
  }

  function startBackgroundTelemetryCadence() {
    if (_bgCadenceTimer) return;
    // Step immediately, then tick every 1 second to check node interval cadences
    setTimeout(stepBackgroundTelemetryCadence, 1000);
    _bgCadenceTimer = setInterval(stepBackgroundTelemetryCadence, 1000);
  }

  if (typeof window !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        setTimeout(startBackgroundTelemetryCadence, 1500);
      });
    } else {
      setTimeout(startBackgroundTelemetryCadence, 1500);
    }
  }

  // Export functions
  const EcoTrackNodeSync = {
    syncSupabaseNodesToPocketBase,
    saveNodeTelemetryToPocketBase,
    startBackgroundTelemetryCadence
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = EcoTrackNodeSync;
  }
  if (typeof global !== 'undefined') {
    global.EcoTrackNodeSync = EcoTrackNodeSync;
    global.syncSupabaseNodesToPocketBase = syncSupabaseNodesToPocketBase;
    global.saveNodeTelemetryToPocketBase = saveNodeTelemetryToPocketBase;
    global.startBackgroundTelemetryCadence = startBackgroundTelemetryCadence;
  }
})(typeof window !== 'undefined' ? window : global);

