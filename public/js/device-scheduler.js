// One scheduling matrix. Controller delivery and local sensor configuration retain their own contracts.
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = schedulerEscape;
  let revision = 0, loading = null, saving = false, snapshot = null, hardwareStates = [];
  let registrySyncAt = 0, registrySyncing = false;
  const loadedMode = window.EcoTrackMode?.mode || 'controller';
  const savedView = window.EcoTrackPageState?.read() || {};
  const schedulerUrl = new URLSearchParams(window.location.search);
  const rememberedRoom = schedulerUrl.get('room') || schedulerUrl.get('roomId') || savedView.selectedRoomId;
  if (typeof rememberedRoom === 'string' && rememberedRoom.length < 300) selectedRoomId = rememberedRoom;
  const saveView = () => window.EcoTrackPageState?.save({selectedRoomId});
  const sessionKey = 'device-scheduler:' + loadedMode;
  let hasSnapshot = false;
  const intervalUnits = { Seconds: 1, Minutes: 60, Hours: 3600 };
  function intervalDisplay(seconds) {
    const intervalUnit = seconds % 3600 === 0 ? 'Hours' : seconds % 60 === 0 ? 'Minutes' : 'Seconds';
    return { intervalUnit, intervalVal: seconds / intervalUnits[intervalUnit] };
  }
  const readCache = key => { try { const value = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(value) ? value : value && typeof value === 'object' ? Object.values(value) : []; } catch (_) { return []; } };
  function locationParts(value) {
    if (typeof value !== 'string') return [];
    const legacy = /^\s*(.+?)\s*\(([^()]*)\)\s*$/.exec(value);
    if (legacy) { const parent = legacy[2].split(/[·•]/).map(part => part.trim()).filter(Boolean); if (parent.length === 2) return [...parent, legacy[1].trim()]; }
    const parts = value.split(/[·•]/).map(part => part.trim()).filter(Boolean);
    return parts.length === 3 ? parts : [];
  }
  const bounded = (task, ms) => new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Controller registry unavailable.')), ms); Promise.resolve(task).then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); }); });
  async function monitors() {
    const endpoint = new URL(window.ECOTRACK_CONFIG?.backendUrl || window.electron?.env?.BACKEND_URL || 'http://localhost:5000');
    if (!['http:', 'https:'].includes(endpoint.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)) throw new Error('Device schedules require the local backend.');
    const response = await fetch(endpoint.origin + '/api/monitoring/devices', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('Local sensor schedules unavailable.');
    const data = await response.json();
    if (!Array.isArray(data.items)) throw new Error('Local sensor schedules unavailable.');
    return data.items;
  }
  function scheduleFields(source, registered = false) {
    const unit = String(source?.interval_unit || 'Minutes').toLowerCase();
    const rawSeconds = registered ? source?.interval_val == null ? null : Number(source.interval_val) * ({ seconds: 1, minutes: 60, hours: 3600 }[unit] || NaN) : source?.interval_seconds;
    const seconds = rawSeconds == null ? NaN : Number(rawSeconds);
    return { wakeTime: normalizeScheduleTime(source?.wake_time) || '', sleepTime: normalizeScheduleTime(source?.sleep_time) || '', seconds: Number.isFinite(seconds) && seconds >= 1 && seconds <= 86400 ? seconds : null, intervalUnit: Number.isFinite(seconds) && seconds >= 1 ? intervalDisplay(seconds).intervalUnit : unit === 'hours' ? 'Hours' : 'Minutes' };
  }
  function controllerRows(data) {
    const assets = data?.aircons || readCache('ecoTrack_aircons');
    const rooms = data?.rooms || readCache('ecoTrack_rooms'), floors = data?.floors || readCache('ecoTrack_floors'), buildings = data?.buildings || readCache('ecoTrack_buildings');
    const sources = data?.nodes || window.EcoTrackAirconSystem?.NodeService?.getNodes?.() || readCache('ecoTrack_nodes');
    return sources.filter(source=>source.device_mode!=='monitoring').map(source => {
      const databaseId = source.db_id || source.pb_id || source.id;
      const matches = assets.filter(asset => [asset.controller_node_id, asset.node_id].includes(databaseId));
      const asset = matches.length === 1 ? matches[0] : null;
      const room = rooms.find(item => item.id === source.room_id) || rooms.find(item => item.id === asset?.room_id), floor = floors.find(item => item.id === room?.floor_id), building = buildings.find(item => item.id === floor?.building_id);
      const path = [building?.name || source.building_name || source.building, floor?.name || source.floor_name || source.floor, room?.name || source.room_name];
      const location = path.every(part => typeof part === 'string' && part.trim()) ? path.map(part => part.trim()).join(' · ') : locationParts(source.location).join(' · ');
      const id = databaseId || source.device_id || source.name || source.node_id;
      if (!id) return null;
      const schedule = scheduleFields(source, true), { seconds, intervalUnit } = schedule;
      const hardware = hardwareStates.find(state => state.node_id === databaseId) || source.cloud_state;
      const status = getSchedulerDeviceState(hardware);
      return { id, pb_id: databaseId, monitoringId: source.monitoring_id || null, name: source.device_name || source.name || id, device_name: source.device_name || source.name || null, ac_id: asset?.id || asset?.aircon_id || null, ac_name: asset?.name || 'Aircon name unavailable', ac_tag: asset?.asset_tag || asset?.device_id || '', ac_type: asset?.aircon_type || asset?.model || 'Unavailable', controller: true, deviceLabel: source.device_mode === 'both' ? 'Monitoring & Controlling' : 'Controlling', status, roomId: room?.id || null, location, wakeTime: schedule.wakeTime, sleepTime: schedule.sleepTime, intervalVal: seconds == null ? '' : seconds / intervalUnits[intervalUnit], intervalUnit, deliveryNote: 'Controller delivery unconfirmed.' };
    }).filter(Boolean);
  }
  function mergeRows(sensorNodes, data) {
    const rows = loadedMode === 'both' ? controllerRows(data) : [];
    for (const sensor of sensorNodes.filter(node => node.active)) {
      const linked = rows.filter(row => row.monitoringId === sensor.id);
      const matches = linked.length ? linked : rows.filter(row => row.controller && !row.monitorId && !row.monitoringId && row.ac_id && row.ac_id === sensor.aircon_id);
      let row = matches.length === 1 ? matches[0] : null;
      const localSchedule = scheduleFields(sensor.sensor_schedule);
      if (!row) { row = { id: 'monitor_' + sensor.id, name: sensor.name, device_name: sensor.name, ac_id: sensor.aircon_id, ac_tag: '', ac_name: sensor.aircon_name || 'Aircon name unavailable', ac_type: sensor.aircon_type || 'Unavailable', controller: false, location: sensor.location || '', wakeTime: '', sleepTime: '', intervalVal: '', intervalUnit: 'Minutes' }; rows.push(row); }
      row.monitorId = sensor.id;
      const sharedDevice = row.controller && row.monitoringId === sensor.id;
      if (row.controller && !sharedDevice) row.monitor_name = sensor.name;
      row.deviceLabel = row.controller ? 'Monitoring & Controlling' : 'Monitoring';
      const sensorState = sensor.latest?.connection_status;
      const monitorStatus = !sensor.latest ? 'unknown' : sensor.fresh ? ['online', 'sleeping', 'offline'].includes(sensorState) ? sensorState : 'unknown' : 'offline';
      // Sensor telemetry and IR control belong to the same device only when the
      // registry explicitly links their identities. An AC assignment alone is not proof.
      const registered = (data?.nodes || []).filter(node => node.monitoring_id === sensor.id);
      const device = registered.length === 1 ? registered[0] : null;
      const registrySchedule = scheduleFields(device, true);
      const controllerSchedule = { wakeTime: row.wakeTime, sleepTime: row.sleepTime, seconds: row.intervalVal === '' ? null : Number(row.intervalVal) * intervalUnits[row.intervalUnit] };
      const mismatch = row.controller && (['wakeTime', 'sleepTime'].some(key => controllerSchedule[key] && localSchedule[key] && controllerSchedule[key] !== localSchedule[key]) || controllerSchedule.seconds != null && localSchedule.seconds != null && Math.abs(controllerSchedule.seconds - localSchedule.seconds) > 0.00001);
      row.scheduleConflict = Boolean(mismatch);
      // Both uses the registered controller values first; Monitoring uses local
      // sensor values first. Only an explicit device identity permits fallback.
      const primary = row.controller ? controllerSchedule : localSchedule;
      const secondary = row.controller ? sharedDevice ? localSchedule : {} : registrySchedule;
      row.wakeTime = primary.wakeTime || secondary.wakeTime || '';
      row.sleepTime = primary.sleepTime || secondary.sleepTime || '';
      const seconds = primary.seconds ?? secondary.seconds ?? null;
      if (seconds != null) {
        Object.assign(row, intervalDisplay(seconds));
      }
      const databaseId = device?.db_id || device?.pb_id || device?.id;
      const hardware = databaseId ? hardwareStates.find(state => state.node_id === databaseId) || device.cloud_state : null;
      const deviceStatus = hardware ? getSchedulerDeviceState(hardware) : 'unknown';
      if (!row.controller) row.status = deviceStatus !== 'unknown' ? deviceStatus : monitorStatus;
      else if (sharedDevice && row.status === 'unknown') row.status = monitorStatus;
      else if (!sharedDevice) row.connectionDetail = 'Sensor: ' + monitorStatus[0].toUpperCase() + monitorStatus.slice(1);
      const localSaved = localSchedule.wakeTime || localSchedule.sleepTime || localSchedule.seconds != null;
      const registrySaved = registrySchedule.wakeTime || registrySchedule.sleepTime || registrySchedule.seconds != null;
      row.deliveryNote = mismatch ? 'Stored schedules differ. Apply to sync both.' : localSaved ? 'Sensor saved locally · hardware unconfirmed.' : registrySaved ? 'Registered device schedule · hardware unconfirmed.' : 'No sensor reporting schedule saved.';
    }
    for (const row of rows) {
      const draft = scheduleDrafts.get(row.id);
      if (draft) Object.assign(row, draft, Object.hasOwn(intervalUnits, draft.intervalUnit) ? {} : { intervalUnit: 'Minutes' });
    }
    return rows;
  }
  function render(rows) {
    savedRooms = {}; buildings = {}; floors = {};
    // Locations belong to the saved registry, even after the last device is removed.
    const registry = snapshot || { buildings: readCache('ecoTrack_buildings'), floors: readCache('ecoTrack_floors'), rooms: readCache('ecoTrack_rooms') };
    for (const building of registry.buildings || []) buildings[building.id] = { ...building };
    for (const floor of registry.floors || []) floors[floor.id] = { ...floor };
    for (const room of registry.rooms || []) savedRooms[room.id] = { ...room, nodes: [] };
    for (const row of rows) {
      const registeredRoom = savedRooms[row.roomId] || Object.values(savedRooms).find(room => {
        const floor = floors[room.floor_id], building = buildings[floor?.building_id || room.building_id];
        return [building?.name, floor?.name, room.name].every(Boolean) && [building.name, floor.name, room.name].join(' · ') === locationParts(row.location).join(' · ');
      });
      if (registeredRoom) { registeredRoom.nodes.push(row); continue; }
      const parts = locationParts(row.location);
      if (!parts.length) { savedRooms.__unassigned__ ||= { id: '__unassigned__', name: 'Unassigned', ungrouped: true, nodes: [] }; savedRooms.__unassigned__.nodes.push(row); continue; }
      const [building, floor, room] = parts;
      const buildingId = 'building_' + encodeURIComponent(building), floorId = 'floor_' + encodeURIComponent(building + '|' + floor), key = 'room_' + encodeURIComponent(row.location || 'Location not recorded');
      buildings[buildingId] ||= { id: buildingId, name: building };
      floors[floorId] ||= { id: floorId, name: floor, building_id: buildingId };
      savedRooms[key] ||= { id: key, name: room, floor_id: floorId, building_id: buildingId, nodes: [] };
      savedRooms[key].nodes.push(row);
    }
    renderSchedulerLocationCabinet();
    saveView();
  }
  async function load(force = false) {
    if (saving) return;
    if (loading && !force) return loading;
    const generation = ++revision;
    if (!hasSnapshot) {
      const saved = window.EcoDataBus?.getCached(sessionKey);
      if (saved) {
        snapshot = saved.snapshot; hardwareStates = saved.hardwareStates;
        const rows = mergeRows(saved.sensors, snapshot);
        // A stored status is historical until the current read confirms it.
        rows.forEach(row => { row.status = 'unknown'; });
        render(rows); hasSnapshot = true;
        $('sensorConnection').textContent = 'Cached schedules · refreshing';
      }
    }
    if (!hasSnapshot) renderSchedulerLoading();
    const task = (async () => {
      try {
        const cloud = (async () => {
            if (!window.electron?.invoke) throw new Error('Controller registry unavailable.');
            const result = await bounded(window.electron.invoke('scheduler-fetch-data'), 5000);
            if (!result?.success) throw new Error('Controller registry unavailable.');
            let states = [];
            if (window.EcoTrackHardwareCloud?.listStatus) { try { states = await bounded(window.EcoTrackHardwareCloud.listStatus(), 4000); } catch (_) {} }
            return { result, states };
          })();
        const [sensorResult, cloudResult] = await Promise.allSettled([monitors(), cloud]);
        if (generation !== revision) return;
        const sensorReady = sensorResult.status === 'fulfilled';
        const cloudReady = cloudResult.status === 'fulfilled';
        if (!sensorReady && (loadedMode === 'monitoring' || !cloudReady)) throw sensorResult.reason;
        if (cloudReady) { snapshot = cloudResult.value.result; hardwareStates = cloudResult.value.states; }
        const sensors = sensorReady ? sensorResult.value : [];
        render(mergeRows(sensors, snapshot)); hasSnapshot = true;
        window.EcoDataBus?.mutate(sessionKey, { sensors, snapshot, hardwareStates });
        $('sensorConnection').textContent = sensorReady ? 'Local backend connected' +
          (!cloudReady ? ' · ' + (loadedMode === 'both' ? 'controller' : 'device') + ' registry unavailable' : '') :
          'Controller registry connected · local sensor schedules unavailable';
        if (window.electron?.invoke && !registrySyncing && Date.now() - registrySyncAt >= 15000) {
          registrySyncAt = Date.now(); registrySyncing = true;
          void bounded(window.electron.invoke('monitoring-sync-registry'), 8000)
            .then(result => { if (result?.success && result.data?.changed) return load(true); })
            .catch(() => {}).finally(() => { registrySyncing = false; });
        }
      } catch (error) {
        $('sensorConnection').textContent = (hasSnapshot ? 'Cached schedules · ' : '') + error.message;
        if (!hasSnapshot) renderSchedulerErrorState(error.message);
        else window.EcoToast?.warning('Refresh failed. Previously loaded schedules are still shown.');
      }
    })().finally(() => { if (loading === task) loading = null; });
    loading = task;
    return task;
  }
  async function apply(id, button) {
    const node = currentRoomNodes.find(row => row.id === id), status = $('delivery-' + id);
    const feedback = message => { if (status) { status.hidden = false; status.textContent = message; } };
    if (!node || button.disabled) return;
    const wake = normalizeScheduleTime($('wake-' + id)?.value), sleep = normalizeScheduleTime($('sleep-' + id)?.value);
    const interval = Number($('interval-val-' + id)?.value), unit = $('interval-unit-' + id)?.value;
    const multiplier = intervalUnits[unit], seconds = Math.round(interval * multiplier);
    if (!wake || !sleep || !multiplier || !Number.isFinite(interval) || seconds < 1 || seconds > 86400 || Math.abs(interval * multiplier - seconds) > 0.00001) { feedback('Choose wake/sleep times and an interval from 1 second to 24 hours.'); return; }
    saving = true; ++revision; button.disabled = true; button.textContent = 'Saving…';
    let sensorSaved = false;
    try {
      if (node.monitorId) {
        if (!window.electron?.invoke) throw new Error('Open the desktop app to save sensor schedules.');
        const result = await window.electron.invoke('monitoring-admin-request', { action: 'schedule', id: node.monitorId, data: { wake_time: wake, sleep_time: sleep, interval_seconds: seconds } });
        if (!result?.success) throw new Error(result?.error || 'Sensor schedule could not be saved.');
        sensorSaved = true;
      }
      Object.assign(node, { wakeTime: wake, sleepTime: sleep, intervalVal: interval, intervalUnit: unit });
      if (node.controller) {
        const queued = await applyNodeSchedule(id, button, { controllerOnly: true });
        feedback((sensorSaved ? 'Sensor saved locally · hardware unconfirmed. ' : '') + (queued?.id ? 'Controller queued; awaiting its receipt.' : 'Controller was not queued. Retry when connected.'));
        if (!queued?.id) button.textContent = sensorSaved ? 'Sensor saved' : 'Retry';
      } else { button.textContent = 'Saved locally'; feedback('Sensor saved locally · hardware unconfirmed.'); scheduleDrafts.delete(id); }
    } catch (error) { feedback((sensorSaved ? 'Sensor saved locally. ' : '') + error.message); button.textContent = 'Retry'; }
    finally { saving = false; button.disabled = false; }
  }
  window.EcoDeviceScheduler = Object.freeze({ load, apply });
  document.addEventListener('DOMContentLoaded', () => {
    $('schedulerRefresh').addEventListener('click', async () => { const button = $('schedulerRefresh'); button.disabled = true; button.setAttribute('aria-busy', 'true'); try { await loadSchedulerWithSWR(true); } finally { button.disabled = false; button.setAttribute('aria-busy', 'false'); } });
    window.initializeResponsiveSidebar?.();
    document.getElementById('roomsList')?.addEventListener('click',saveView);
    window.addEventListener('pagehide',saveView);
    window.addEventListener('workspace:changed', event => { if (event.detail.mode !== loadedMode) setTimeout(() => location.reload(), 0); });
    if (!schedulerControllerMode()) {
      let timer;
      const start = () => { clearInterval(timer); timer = setInterval(() => { if (!document.hidden && !activeTimePickerTargetId && !document.activeElement?.matches('input,select')) load(); }, 10000); };
      start();
      window.addEventListener('pagehide', () => { clearInterval(timer); ++revision; loading = null; });
      window.addEventListener('pageshow', event => { if (event.persisted) { start(); load(true); } });
    }
  });
})();
