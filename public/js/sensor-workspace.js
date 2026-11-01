/* Sensor project page structure, using the controller shell and real local sensor records. */
(function () {
  'use strict';
  const page = document.body.dataset.sensorPage;
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const deviceLabel = value => window.ecoDeviceDisplayName?.(value) || String(value ?? 'AC device');
  const num = (value, digits = 1) => Number.isFinite(value) ? value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';
  const rotationValue = sample => !sample || ['fault', 'missing', 'out_of_range', 'invalid'].includes(sample.rotation_quality) || !Number.isFinite(sample.rotation_rpm) || sample.rotation_rpm < 0 ? null : sample.rotation_rpm;
  const stamp = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('en-SG', { timeZone: 'Asia/Singapore', hour12: true }) : 'No reading';
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  let observationDate = today();
  const badge = (label, tone = '') => `<span class="sensor-badge ${tone}">${esc(label)}</span>`;
  const state = (sample, fresh = true) => sample?.ac_on == null ? '<span title="Waiting for confirmed AC ON/OFF feedback">'+badge('Not reported')+'</span>' : !fresh ? badge('No recent feedback') : badge(sample.ac_on ? 'Confirmed ON' : 'Confirmed OFF', 'good');
  const observedModes = {cool:'Cold', fan:'Fan Only', fan_only:'Fan Only', dry:'Dry', auto:'Auto', heat:'Heat', off:'Off'};
  const modeLabel = (sample, fresh = true) => fresh ? (sample?.ac_on === false ? 'Off' : observedModes[sample?.operating_mode] || 'Not reported') : 'Not reported';
  let nodes = [], registryDevices = [], stats = null, energy = null, history = [], loaded = false, available = false;
  let energySelection = '', snapshotKey = '';
  let initialLoadSettled = false, errorClearTimer = null, errorShownAt = 0, errorSignature = '';
  const ERROR_MIN_VISIBLE_MS = 5000;
  let dataVersion = null, dataGeneration = null, locationsChecked = 0;
  let heartbeatChannel = null, heartbeatChecked = 0, heartbeatScope = '', heartbeatAccount = '';
  let heartbeatController, heartbeatIDs = new Set();
  const heartbeats = new Map(), registryMetadata = new Map();
  const liveMeasurements = new Map(), liveNodeValues = new Map(), liveAircons = new Map();
  let heartbeatInFlight = false;
  let liveDetailId = null, airflowSaving = false;
  const registryFields = {nodes:['id','name','room_id','device_mode','monitoring_id','monitor_aircon_id','interval_val','interval_unit','wake_time','sleep_time','sensor_config'],aircons:['id','name','asset_tag','aircon_type','controller_node_id','node_id'],rooms:['id','name','floor_id'],floors:['id','name','building_id'],buildings:['id','name']};
  const registryFingerprint = (table,row) => JSON.stringify(registryFields[table].map(field => row?.[field] ?? null));
  const sessionKey = () => 'sensor-energy-v4:' + page + ':' + (page === 'telemetry' ? '' : query().toString()) + ':' + pageNumber;
  function ageCachedNodes() {
    nodes = nodes.map(node => {
      const age = (Date.now() - Date.parse(node.latest?.observed_at || '')) / 1000;
      const fresh = node.fresh && age >= -5 && age <= Math.max(15, 3 * node.expected_interval_seconds);
      return { ...node, fresh: Boolean(fresh), status: node.latest && !fresh ? 'Stale' : node.status };
    });
  }
  function restoreSnapshot() {
    const saved = window.EcoDataBus?.getCached(sessionKey());
    if (!saved || !Array.isArray(saved.nodes)) return;
    ({nodes, stats, energy, history, total, registryDevices, locationRegistry} = saved);
    dataVersion = saved.dataVersion ?? null; dataGeneration = saved.dataGeneration ?? null;
    lastRefreshAt = saved.lastRefreshAt || null;
    snapshotKey = sessionKey(); loaded = true; available = true;
    if (page === 'logs') energySelection = query().toString();
    ageCachedNodes();
    $('sensorConnection').textContent = 'Cached data · refreshing';
  }
  let consumersView = null;
  let controller, exportController, revision = 0, running = false, exporting = false, pageNumber = 1, total = 0, period = 'daily', locationFilter = null;
  const charts = new Map();
  let fleetPosition={location:null,top:0}, lastRefreshAt=null;
  const rememberedView = window.EcoTrackPageState?.read() || {};
  const urlView = new URLSearchParams(window.location.search);
  const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0,10) === value;
  const viewValue = (field, parameter = field) => urlView.has(parameter) ? urlView.get(parameter) : rememberedView[field];
  const restoredPeriod = viewValue('period');
  if (['daily','weekly','monthly'].includes(restoredPeriod)) period = restoredPeriod;
  const restoredDate = viewValue('observationDate','date');
  if (validDate(restoredDate)) observationDate = restoredDate;
  const restoredPage = Number(viewValue('pageNumber','page'));
  if (Number.isInteger(restoredPage) && restoredPage > 0 && restoredPage <= 100000) pageNumber = restoredPage;
  if (typeof rememberedView.locationFilter === 'string') locationFilter = rememberedView.locationFilter;
  if (rememberedView.fleetPosition && typeof rememberedView.fleetPosition.location === 'string' && Number.isFinite(rememberedView.fleetPosition.top) && rememberedView.fleetPosition.top >= 0) fleetPosition = rememberedView.fleetPosition;
  let pendingSensorId = viewValue('sensorSelect','node_id');
  if (typeof pendingSensorId !== 'string' || pendingSensorId.length > 200) pendingSensorId = '';
  function saveView() {
    window.EcoTrackPageState?.save({sensorSelect:pendingSensorId || $('sensorSelect')?.value || '',sensorFrom:$('sensorFrom')?.value || '',sensorThrough:$('sensorThrough')?.value || '',sensorTimeStart:$('sensorTimeStart')?.value || '',sensorTimeEnd:$('sensorTimeEnd')?.value || '',observationDate,period,pageNumber,locationFilter,fleetPosition});
  }
  let cloudRegistryTask, registrySyncAt = 0, registrySyncResult = null;
  function syncCloudRegistry({force = false} = {}) {
    if (!window.electron?.invoke) return Promise.resolve(null);
    if (cloudRegistryTask) return cloudRegistryTask;
    if (!force && Date.now() - registrySyncAt < 60000) return Promise.resolve(registrySyncResult);
    let timer;
    cloudRegistryTask=Promise.race([
      Promise.resolve().then(()=>window.electron.invoke('monitoring-sync-registry')),
      new Promise(resolve=>{timer=setTimeout(()=>resolve({success:false,error:'Registered AC devices took too long to sync. Retry the refresh.',code:'REGISTRY_SYNC_UNAVAILABLE',registry_preserved:true}),20000);})
    ]).then(result=>{
      registrySyncResult=result&&typeof result.success==='boolean'?result:{success:false,error:'The device registry sync was not confirmed. Retry the refresh.',code:'REGISTRY_SYNC_UNAVAILABLE',registry_preserved:true};
      return registrySyncResult;
    }).catch(failure=>{
      registrySyncResult={success:false,error:failure?.message || 'Registered AC devices could not be synced. Retry the refresh.',code:'REGISTRY_SYNC_UNAVAILABLE',registry_preserved:true};
      return registrySyncResult;
    }).finally(()=>{clearTimeout(timer);registrySyncAt=Date.now();cloudRegistryTask=null;});
    return cloudRegistryTask;
  }
  let locationRegistry = { buildings: [], floors: [], rooms: [] }, registryTask;
  for (const [field, key] of [['buildings', 'ecoTrack_buildings'], ['floors', 'ecoTrack_floors'], ['rooms', 'ecoTrack_rooms']]) {
    try { const stored = JSON.parse(localStorage.getItem(key) || '[]'); if (Array.isArray(stored)) locationRegistry[field] = stored; } catch (_) {}
  }

  function base() {
    const url = new URL(window.ECOTRACK_CONFIG?.backendUrl || window.electron?.env?.BACKEND_URL || 'http://localhost:5000');
    if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Sensor readings require the local EcoTrack backend.');
    return url.origin + '/api/monitoring';
  }
  async function request(path, { signal, blob = false } = {}) {
    const abort = new AbortController(), cancel = () => abort.abort();
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(cancel, 8000);
    try {
      const result = await fetch(base() + path, { signal: abort.signal, cache: 'no-store' });
      if (!result.ok) throw new Error((await result.json().catch(() => ({}))).error || 'Local sensor request failed.');
      return blob ? await result.blob() : await result.json();
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
  }
  function selected() { return nodes.filter(node => node.active && (!$('sensorSelect')?.value || node.id === $('sensorSelect').value) && (locationFilter === null || node.location === locationFilter)); }
  function sensorFutureCostContext(reference) {
    let label=observationDate;
    try {
      const params=query(),date=value=>new Date(value+8*3600000).toISOString().slice(0,10);
      label=date(Date.parse(params.get('from')))+' to '+date(Date.parse(params.get('to'))-1);
      if(reference===undefined)reference=available && energySelection===params.toString()?energy:null;
    } catch (_) { reference=null; }
    return {devices:window.EcoTrackFutureCost?.sensorDevices(selected(),reference) || [],tariff:tariff(),scope:'Selected monitored AC units',reference:label+' · recorded AC target setpoints',basis:'Historical estimated energy rate held constant over planned AC hours',limitation:'Conditional projection from covered recorded AC intervals. Future operation and physical consumption are unverified.'};
  }
  function telemetryDevices() {
    const measured=nodes.filter(node=>node.active), allowed=registryDevices.filter(node=>window.EcoTrackMode?.mode==='both' || ['monitoring','both'].includes(node.device_mode));
    const cards=measured.map(sensor=>{
      const registered=allowed.find(device=>device.monitoring_id===sensor.id);
      const cloudFirst=window.EcoTrackMode?.mode==='both' && registered?.device_mode==='both';
      const first=cloudFirst?registered.sensor_schedule:sensor.sensor_schedule,second=cloudFirst?sensor.sensor_schedule:registered?.sensor_schedule;
      return {...sensor,sensor_config:registered?.sensor_config ?? sensor.sensor_config,aircon_id:registered?.aircon_id || sensor.aircon_id,device_mode:registered?.device_mode || sensor.device_mode || 'monitoring',sensor_schedule:first || second ? Object.fromEntries(['wake_time','sleep_time','interval_seconds'].map(key=>[key,first?.[key]??second?.[key]??null])) : null};
    });
    return [...cards,...allowed.filter(node=>!measured.some(sensor=>sensor.id===node.monitoring_id))].map(presentLiveNode);
  }
  function readRegistryDevices(data) {
    for (const ac of data.aircons || []) rememberAirconObservation(ac);
    for (const table of Object.keys(registryFields)) for (const row of data[table] || []) if (row.id) registryMetadata.set(table + ':' + row.id, registryFingerprint(table,row));
    registryDevices=(data.nodes || []).map(node=>{
      const id=node.id || node.db_id || node.node_id;
      const room=locationRegistry.rooms.find(room=>room.id===node.room_id),floor=locationRegistry.floors.find(floor=>floor.id===room?.floor_id),building=locationRegistry.buildings.find(building=>building.id===floor?.building_id);
      const ac=(data.aircons || []).find(ac=>ac.id===node.monitor_aircon_id || ac.aircon_id===node.monitor_aircon_id || [id,node.node_id].filter(Boolean).some(value=>[ac.controller_node_id,ac.node_id].includes(value)));
      const parts=[building?.name,floor?.name,room?.name];
      const time=value=>typeof value==='string' && /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)?value.slice(0,5):null;
      const seconds=node.interval_val==null?NaN:Number(node.interval_val)*({seconds:1,minutes:60,hours:3600}[String(node.interval_unit || '').toLowerCase()] || NaN);
      const savedSchedule={wake_time:time(node.wake_time),sleep_time:time(node.sleep_time),interval_seconds:Number.isFinite(seconds) && seconds>=1 && seconds<=86400?seconds:null};
      return {id:'registry:'+id,sensor_config:node.sensor_config,registry_only:true,monitoring_id:node.monitoring_id,device_mode:node.device_mode || 'controller',active:true,fresh:false,latest:null,
        sensor_schedule:Object.values(savedSchedule).some(value=>value!==null)?savedSchedule:null,
        name:node.name || 'Device name unavailable',aircon_id:ac?.id,aircon_name:ac?.name || ac?.asset_tag || 'No aircon assigned',aircon_type:ac?.aircon_type || node.aircon_type,
        location:parts.every(Boolean)?parts.join(' · '):'',status:'Awaiting readings',
        readings:['temperature','rotation_rpm']};
    });
  }
  function query() {
    const params = new URLSearchParams();
    const sensorId = pendingSensorId || $('sensorSelect')?.value;
    if (sensorId) params.set('node_id', sensorId);
    let from = page === 'logs' ? observationDate : $('sensorFrom')?.value, through = $('sensorThrough')?.value || from;
    if (!from || !through || from > through) throw new Error('Choose a valid observation date range.');
    if (page === 'logs') {
      const day = new Date(from + 'T00:00:00Z');
      if (period === 'weekly') { day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7); from = day.toISOString().slice(0, 10); through = new Date(day.getTime() + 6 * 86400000).toISOString().slice(0, 10); }
      if (period === 'monthly') { from = from.slice(0, 7) + '-01'; const start = new Date(from + 'T00:00:00Z'); start.setUTCMonth(start.getUTCMonth() + 1); through = new Date(start.getTime() - 86400000).toISOString().slice(0, 10); }
    }
    params.set('from', new Date(from + 'T00:00:00+08:00').toISOString());
    params.set('to', new Date(Date.parse(through + 'T00:00:00+08:00') + 86400000).toISOString());
    if (page === 'logs') for (const [key, id] of [['start_time', 'sensorTimeStart'], ['end_time', 'sensorTimeEnd']]) if ($(id)?.value) params.set(key, $(id).value);
    return params;
  }
  function error(message = '', retry = false) {
    const panel = $('sensorError');
    clearTimeout(errorClearTimer); errorClearTimer = null;
    if (!message) {
      const clear = () => { panel.hidden = true; panel.textContent = ''; errorSignature = ''; errorClearTimer = null; };
      const remaining = ERROR_MIN_VISIBLE_MS - (performance.now() - errorShownAt);
      if (!panel.hidden && remaining > 0) errorClearTimer = setTimeout(clear, Math.ceil(remaining));
      else clear();
      return;
    }
    // Hold the most recent failure long enough to read without delaying recovered data.
    errorShownAt = performance.now();
    const signature = JSON.stringify([message, page === 'telemetry' && retry, loaded]);
    if (!panel.hidden && errorSignature === signature) return;
    errorSignature = signature; panel.hidden = false;
    if (page !== 'telemetry' || !retry) { panel.textContent = message; return; }
    const refocus = panel.contains(document.activeElement);
    panel.innerHTML = `<div><strong>${esc(message)}</strong><p>Check that the EcoTrack local service is running, then retry. ${loaded ? 'Previously loaded records are kept below; check their measurement times.' : 'No current readings could be loaded.'}</p></div><button type="button" class="sensor-button" data-sensor-retry>Retry</button>`;
    panel.querySelector('[data-sensor-retry]').addEventListener('click', () => refresh());
    if (refocus) panel.querySelector('button').focus();
  }
  // Live observations affect the open view only; local history remains authoritative for logs.
  function rememberCloudReading(table, event) {
    const row = event.new, id = table === 'nodes' ? row?.id : row?.node_id;
    if (event.eventType === 'DELETE' || !id || !heartbeatIDs.has(id)) return;
    if (!['temp', 'temperature', 'rotation_rpm'].some(key => Object.prototype.hasOwnProperty.call(row, key))) return;
    if (table === 'nodes') {
      const previous = liveNodeValues.get(id), time = Date.parse(row.updated || '');
      if (!Number.isFinite(time) || time > Date.now() + 5000 || time < Date.parse(previous?.updated || '')) return;
      liveNodeValues.set(id, { ...previous, ...row });
      if (page === 'telemetry' && loaded && !document.hidden) renderFleet();
      return;
    }
    const at = row.observed_at, time = Date.parse(at || '');
    const previous = liveMeasurements.get(id);
    if (!Number.isFinite(time) || time > Date.now() + 5000 || time < Date.parse(previous?.observed_at || '')) return;
    const temperature = table === 'nodes' ? row.temp : row.temperature;
    const sample = { observed_at: at,
      outlet_temperature_c: typeof temperature === 'number' && Number.isFinite(temperature) ? temperature : null,
      rotation_rpm: Number.isFinite(row.rotation_rpm) && row.rotation_rpm >= 0 ? row.rotation_rpm : null,
      rotation_quality: row.rotation_quality || (Number.isFinite(row.rotation_rpm) ? 'ok' : 'missing'),
      ac_on: typeof row.ac_on === 'boolean' ? row.ac_on : null, operating_mode: row.operating_mode || null };
    liveMeasurements.set(id, sample);
    if (row.aircon_id && row.control_snapshot) rememberAirconObservation({ id: row.aircon_id, ...window.EcoTrackAirconState?.parseAirconSnapshot(row.control_snapshot) });
    if (page === 'telemetry' && loaded && !document.hidden) renderFleet();
  }
  function rememberAirconObservation(row) {
    if (!row?.id) return;
    const api = window.EcoTrackAirconState, previous = liveAircons.get(row.id) || {}, next = { ...previous };
    const validTime = value => Number.isFinite(Date.parse(value || '')) && Date.parse(value) <= Date.now() + 5000;
    if (Object.hasOwn(row, 'configured_state') && (!previous.updated || validTime(row.updated) && Date.parse(row.updated) >= Date.parse(previous.updated))) next.configured_state = api?.parseAirconSnapshot(row.configured_state);
    if (validTime(row.updated) && Date.parse(row.updated) >= (Date.parse(previous.updated || '') || 0)) next.updated = row.updated;
    for (const [field, at] of [['desired_state', 'commanded_at'], ['reported_state', 'reported_at'], ['observed_remote_state', 'observed_remote_at']]) {
      if (Object.hasOwn(row, field) && validTime(row[at]) && (!previous[at] || Date.parse(row[at]) >= Date.parse(previous[at]))) {
        next[field] = api?.parseAirconSnapshot(row[field]); next[at] = row[at];
        if (field === 'observed_remote_state') next.observed_remote_field_at = row.observed_remote_field_at;
      }
    }
    liveAircons.set(row.id, next);
  }
  function controlSnapshot(node) {
    const api = window.EcoTrackAirconState;
    const recorded = api?.parseAirconSnapshot(node.latest?.control_snapshot);
    if (recorded && node.aircon_id) rememberAirconObservation({id:node.aircon_id, ...recorded});
    const identity = node.cloud_node_id || (node.registry_only ? node.id.replace(/^registry:/, '') : '');
    const hardware = heartbeats.get(identity), previous = liveAircons.get(node.aircon_id) || {};
    const snapshot = { ...previous, ...api?.remoteObservation(hardware?.latest_ir, hardware?.last_seen, previous) };
    if (node.aircon_id) liveAircons.set(node.aircon_id, snapshot);
    return snapshot;
  }
  function settingSource(source) {
    return ({requested:'Requested setting', reported:'Device-reported setting', remote:'Remote-observed setting', configured:'Configured setting', telemetry:'Recorded setting'})[source] || 'Setting not reported';
  }
  function settingLabel(source, field) {
    const prefix = ({requested:'Requested', reported:'Reported', remote:'Remote-observed', configured:'Configured', telemetry:'Recorded'})[source];
    return prefix ? prefix + ' ' + field : field[0].toUpperCase() + field.slice(1);
  }
  function targetSetting(node) {
    const snapshot = controlSnapshot(node), api = window.EcoTrackAirconState;
    const selected = api?.selectSettings(snapshot), value = selected?.state?.temp;
    const source = selected?.field_sources?.temp;
    const at = source === 'remote' ? snapshot.observed_remote_field_at?.temp || snapshot.observed_remote_at : source === 'reported' ? snapshot.reported_at : source === 'requested' ? snapshot.commanded_at : null;
    return {value:typeof value === 'number' && Number.isFinite(value) ? value : null, at, source};
  }
  function presentLiveNode(node) {
    const id = node.cloud_node_id || (node.registry_only ? node.id.replace(/^registry:/, '') : '');
    const rawConfig = liveNodeValues.get(id);
    if (rawConfig && Object.prototype.hasOwnProperty.call(rawConfig, 'sensor_config')) node = { ...node, sensor_config: rawConfig.sensor_config };
    const sample = liveMeasurements.get(id), localTime = Date.parse(node.latest?.observed_at || '');
    if (!sample || Date.parse(sample.observed_at) < localTime) {
      const raw = liveNodeValues.get(id);
      if (Number.isFinite(localTime) || !raw) return node;
      return { ...node, latest: { ...node.latest, observed_at: null, outlet_temperature_c: raw.temp,
        rotation_rpm: raw.rotation_rpm }, fresh: false, status: 'No measurement time' };
    }
    const age = (Date.now() - Date.parse(sample.observed_at)) / 1000;
    const interval = node.expected_interval_seconds || node.sensor_schedule?.interval_seconds;
    const fresh = age >= -5 && age <= (interval ? Math.max(15, interval * 3) : 45);
    return { ...node, latest: sample, fresh, live_cloud: true, status: fresh ? 'Reporting' : 'Stale' };
  }
  function modeSetting(node) {
    // A selected mode is a setting; independent power feedback remains separate.
    const selected = window.EcoTrackAirconState?.selectSettings(controlSnapshot(node));
    const normalize = value => typeof value === 'string' ? value.trim().toLowerCase().replace(/[ -]+/g, '_') : '';
    const labels = {cool:'Cool', fan:'Fan Only', fan_only:'Fan Only', heat:'Heat', dry:'Dry', auto:'Auto', off:'Off'};
    const value = labels[normalize(selected?.state?.mode)];
    if (value) return {value, source:selected.field_sources?.mode};
    const recorded = (available || node.live_cloud) && node.fresh ? labels[normalize(node.latest?.operating_mode)] : null;
    return {value:recorded || 'Not reported', source:recorded ? 'telemetry' : null};
  }
  function observedMode(node) { return modeSetting(node).value; }

  function empty(title, text) { return `<div class="sensor-empty"><strong>${esc(title)}</strong><p>${esc(text)}</p></div>`; }
  function chartMarkup(id, title, note) { return `<section class="sensor-panel glass-surface glass-card"><h2>${title}</h2><p>${note}</p><div class="sensor-chart"><canvas id="${id}" role="img" aria-label="${title}"></canvas><div id="${id}Empty" class="sensor-chart-empty">No measured readings in this window.</div></div></section>`; }
  function connection(node) {
    const identity = node.cloud_node_id || (node.registry_only ? node.id.replace(/^registry:/, '') : '');
    const heartbeat = heartbeats.get(identity), seen = Date.parse(heartbeat?.last_seen || '');
    const sleeping = Date.parse(heartbeat?.sleeping_until || '') > Date.now();
    return { heartbeat, label: sleeping ? 'Sleeping' : Number.isFinite(seen) ?
      (Date.now() - seen >= -5000 && Date.now() - seen <= 45000 ? 'Connected' : 'Offline') : 'Connection unverified' };
  }
  function registryEvent(table,event) {
    if (table === 'nodes') rememberCloudReading(table, event);
    if (table === 'aircons') { rememberAirconObservation(event.new); if (page === 'telemetry' && loaded && !document.hidden) renderFleet(); }
    const row = event.new, id = row?.id || event.old?.id;
    if (event.eventType !== 'DELETE' && id && registryMetadata.get(table + ':' + id) === registryFingerprint(table,row)) return;
    registrySyncAt = 0; locationsChecked = 0;
    if (!document.hidden) void refresh({poll:true});
  }
  async function refreshHeartbeats({force = false} = {}) {
    const client = window.supabaseClient;
    if (!client?.from) return;
    const ids = [...new Set([...nodes.map(node => node.cloud_node_id), ...registryDevices.map(node => node.id.replace(/^registry:/, ''))].filter(Boolean))].sort();
    const account = window.EcoDataBus?._sessionScope() || '';
    const scope = account + ':' + ids.join(',');
    if (scope === heartbeatScope && (heartbeatInFlight || !force && Date.now() - heartbeatChecked < 2000)) return;
    if (account !== heartbeatAccount) {
      heartbeats.clear(); liveMeasurements.clear(); liveNodeValues.clear(); liveAircons.clear();
      if (heartbeatChannel) client.removeChannel?.(heartbeatChannel);
      heartbeatChannel = null; heartbeatAccount = account;
    }
    heartbeatScope = scope; heartbeatChecked = Date.now(); heartbeatIDs = new Set(ids);
    for (const id of heartbeats.keys()) if (!heartbeatIDs.has(id)) heartbeats.delete(id);
    heartbeatController?.abort();
    const abort = new AbortController(); heartbeatController = abort;
    const timer = setTimeout(() => abort.abort(), 8000);
    if (!ids.length) { clearTimeout(timer); return; }
    heartbeatInFlight = true;
    try {
      for (let index = 0; index < ids.length; index += 100) {
        const batch = ids.slice(index, index + 100);
        const queries = [
          client.from('ecotrack_device_state').select('node_id,last_seen,sleeping_until,latest_ir').in('node_id', batch),
          client.from('nodes').select('id,temp,rotation_rpm,updated,sensor_config').in('id', batch),
          client.from('telemetry').select('node_id,aircon_id,temperature,rotation_rpm,rotation_quality,observed_at,ac_on,control_snapshot')
            .in('node_id', batch).not('observed_at', 'is', null).order('observed_at', {ascending:false}).limit(500),
          client.from('aircons').select('*').in('id', [...new Set([...nodes, ...registryDevices].filter(node => batch.includes(node.cloud_node_id || node.id.replace(/^registry:/,''))).map(node => node.aircon_id).filter(Boolean))]),
        ];
        const current = () => !abort.signal.aborted && heartbeatScope === scope && account === (window.EcoDataBus?._sessionScope() || '');
        await Promise.allSettled(queries.map(async (query, index) => {
          const result = await (query.abortSignal ? query.abortSignal(abort.signal) : query);
          if (!current() || result.error) return;
          const rows = result.data || [];
          if (index === 0) for (const row of rows) {
            if (heartbeatIDs.has(row.node_id) && Date.parse(row.last_seen || '') >= (Date.parse(heartbeats.get(row.node_id)?.last_seen || '') || 0)) heartbeats.set(row.node_id, row);
          }
          if (index === 1) for (const row of rows) rememberCloudReading('nodes', {new:row});
          if (index === 3) for (const row of rows) rememberAirconObservation(row);
          if (index !== 2) return;
          const seen = new Set();
          for (const row of rows) if (!seen.has(row.node_id)) { seen.add(row.node_id); rememberCloudReading('telemetry', {new:row}); }
          const missing = batch.filter(id => !seen.has(id));
          for (let start = 0; start < missing.length; start += 10) {
            const recovered = await Promise.allSettled(missing.slice(start, start + 10).map(id => {
              const query = client.from('telemetry').select('node_id,aircon_id,temperature,rotation_rpm,rotation_quality,observed_at,ac_on,control_snapshot')
                .eq('node_id', id).not('observed_at', 'is', null).order('observed_at', {ascending:false}).limit(1);
              return query.abortSignal ? query.abortSignal(abort.signal) : query;
            }));
            if (!current()) return;
            for (const result of recovered) if (result.status === 'fulfilled' && !result.value.error) {
              for (const row of result.value.data || []) rememberCloudReading('telemetry', {new:row});
            }
          }
        }));
        if (!current()) return;
      }
      if (page === 'telemetry' && loaded) renderFleet();
    } catch (_) { /* Preserve original heartbeat times; an unavailable read is not a new heartbeat. */ }
    finally { clearTimeout(timer); if (heartbeatController === abort) heartbeatInFlight = false; }
    if (abort.signal.aborted || heartbeatScope !== scope || account !== (window.EcoDataBus?._sessionScope() || '')) return;
    if (!heartbeatChannel && client.channel) {
      heartbeatChannel = client.channel('sensor-heartbeats-' + page)
        .on('postgres_changes', {event:'*',schema:'public',table:'ecotrack_device_state'}, event => {
          const row = event.new;
          if (account !== (window.EcoDataBus?._sessionScope() || '')) return;
          if (row?.node_id && heartbeatIDs.has(row.node_id)) heartbeats.set(row.node_id, row);
          if (event.eventType === 'DELETE' && event.old?.node_id) heartbeats.delete(event.old.node_id);
          if (page === 'telemetry' && loaded && !document.hidden) renderFleet();
        })
        .on('postgres_changes', {event:'*',schema:'public',table:'nodes'}, event => { if (account === (window.EcoDataBus?._sessionScope() || '')) registryEvent('nodes',event); })
        .on('postgres_changes', {event:'*',schema:'public',table:'telemetry'}, event => { if (account === (window.EcoDataBus?._sessionScope() || '')) rememberCloudReading('telemetry',event); })
        .on('postgres_changes', {event:'*',schema:'public',table:'aircons'}, event => { if (account === (window.EcoDataBus?._sessionScope() || '')) registryEvent('aircons',event); })
        .on('postgres_changes', {event:'*',schema:'public',table:'rooms'}, event => { if (account === (window.EcoDataBus?._sessionScope() || '')) registryEvent('rooms',event); })
        .on('postgres_changes', {event:'*',schema:'public',table:'floors'}, event => { if (account === (window.EcoDataBus?._sessionScope() || '')) registryEvent('floors',event); })
        .on('postgres_changes', {event:'*',schema:'public',table:'buildings'}, event => { if (account === (window.EcoDataBus?._sessionScope() || '')) registryEvent('buildings',event); })
        .subscribe(status => { if (status === 'SUBSCRIBED') { heartbeatChecked = 0; } });
    }
  }
  function build() {
    if (page === 'analytics') {
      const from = viewValue('sensorFrom','from'), through = viewValue('sensorThrough','through');
      $('sensorFrom').value = validDate(from) ? from : today(); $('sensorThrough').value = validDate(through) ? through : $('sensorFrom').value;
      if ($('sensorThrough').value < $('sensorFrom').value) $('sensorThrough').value = $('sensorFrom').value;
      $('sensorApp').innerHTML = '<div class="sensor-snapshots" id="sensorSnapshots"></div><div class="sensor-chart-grid">' + chartMarkup('sensorTempChart', 'Temperature Trend', 'Recorded AC target setpoint · °C') + chartMarkup('sensorRotationChart', 'Airflow Indicator Trend', 'Measured wheel rotation · RPM') + '</div>' + chartMarkup('sensorStateChart', 'Aircon State & Power History', 'Reported mode · confirmed power');
    } else if (page === 'logs') {
      for (const [id,param] of [['sensorTimeStart','start_time'],['sensorTimeEnd','end_time']]) {
        const value = viewValue(id,param); if (typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)) $(id).value = value;
      }
      populateObservationDates();
      $('sensorApp').innerHTML = '<div class="sensor-forecast-space">' + $('sensorForecastTemplate').innerHTML + '</div><section class="eco-data-panel sensor-log-panel" aria-labelledby="sensorLogTitle"><div class="eco-table-toolbar"><h2 id="sensorLogTitle">Daily Sensor Logs</h2><p>Temperature uses recorded AC target setpoints · AC feedback and hardware readings · UTC+08:00</p></div><div id="sensorLogTable"></div><div class="sensor-pagination eco-table-footer"><span class="sensor-status" id="sensorPageInfo"></span><div class="sensor-actions"><button type="button" class="sensor-button" id="sensorPrevious">Previous</button><button type="button" class="sensor-button primary" id="sensorNext">Next</button></div></div></section><p class="sensor-status sensor-export-status" id="sensorExportStatus" role="status" aria-live="polite"></p>';
    } else {
      $('sensorApp').innerHTML = `<div class="sensor-telemetry-layout"><aside class="eco-location-panel sensor-panel sensor-cabinet"><h2 class="eco-location-title">${sensorIcon('location')}Location</h2><label class="sensor-location-picker">Location<select id="sensorLocationSelect" aria-label="Choose location"></select></label><div id="sensorLocations" class="eco-location-tree sensor-tree"></div></aside><section class="sensor-panel sensor-interface"><div class="sensor-panel-head"><h2 id="sensorInterfaceTitle">${sensorIcon('node')}AC Sensor Interface</h2><span class="sensor-status" id="sensorCount"></span></div><div id="sensorFleet" class="sensor-interface-grid" tabindex="0" role="region" aria-label="AC devices"></div></section></div>`;
    }
    $('sensorLocationSelect')?.addEventListener('change', event => {
      if (event.target.value === '-1') { locationFilter = null; renderLocations(); renderFleet(); }
      else $('sensorLocations').querySelector('[data-location-index="' + event.target.value + '"]')?.click();
    });
    for (const id of ['sensorSelect', 'sensorFrom', 'sensorThrough', 'sensorTimeStart', 'sensorTimeEnd']) $(id)?.addEventListener('change', () => {
      if (id === 'sensorSelect') pendingSensorId = '';
      if (page === 'logs' && id === 'sensorFrom' && $('sensorFrom').value) { observationDate = $('sensorFrom').value; populateObservationDates(); }
      pageNumber = 1; locationFilter = null; refresh();
    });
    $('sensorDateSelect')?.addEventListener('change', () => { observationDate = $('sensorDateSelect').value; $('sensorFrom').value = ''; pageNumber = 1; refresh(); });
    $('sensorClearTime')?.addEventListener('click', () => { $('sensorTimeStart').value = ''; $('sensorTimeEnd').value = ''; pageNumber = 1; refresh(); });
    document.querySelectorAll('[data-period]').forEach(button => button.addEventListener('click', () => {
      period = button.dataset.period; pageNumber = 1;
      document.querySelectorAll('[data-period]').forEach(item => { item.setAttribute('aria-pressed', String(item === button)); item.classList.toggle('active', item === button); });
      $('sensorLogTitle').textContent = period[0].toUpperCase() + period.slice(1) + ' Sensor Logs'; populateObservationDates(); refresh();
    }));
    $('sensorPrevious')?.addEventListener('click', () => { if (pageNumber > 1) { pageNumber--; refresh(); } });
    $('sensorNext')?.addEventListener('click', () => { if (pageNumber * 50 < total) { pageNumber++; refresh(); } });
    document.querySelectorAll('[data-export]').forEach(button => button.addEventListener('click', () => exportLogs(button.dataset.export)));
    document.querySelectorAll('[data-period]').forEach(button => { const active = button.dataset.period === period; button.setAttribute('aria-pressed',String(active)); button.classList.toggle('active',active); });
    if (page === 'logs') $('sensorLogTitle').textContent = period[0].toUpperCase() + period.slice(1) + ' Sensor Logs';
  }
  function populateObservationDates() {
    const select = $('sensorDateSelect'); if (!select) return;
    const choices = new Map();
    for (let i = 0; i < 7; i++) { const date = new Date(today() + 'T12:00:00Z'); if (period === 'monthly') date.setUTCMonth(date.getUTCMonth() - i, 1); else date.setUTCDate(date.getUTCDate() - i * (period === 'weekly' ? 7 : 1)); const key = date.toISOString().slice(0, 10); choices.set(key, key); }
    choices.set(observationDate, observationDate);
    const label = key => {
      const value = new Date(key + 'T12:00:00Z'), format = { month: 'long', year: 'numeric', timeZone: 'UTC' };
      if (period === 'daily') format.day = 'numeric';
      if (period === 'weekly') { value.setUTCDate(value.getUTCDate() - (value.getUTCDay() + 6) % 7); format.day = 'numeric'; return 'Week of ' + value.toLocaleDateString('en-US', format); }
      return value.toLocaleDateString('en-US', format);
    };
    const seen = new Set();
    select.innerHTML = [...choices.keys()].sort().reverse().filter(key => { const name = label(key); if (key !== observationDate && name === label(observationDate) || seen.has(name)) return false; seen.add(name); return true; }).map(key => `<option value="${key}">${esc(label(key))}</option>`).join('');
    select.value = observationDate;
  }
  function populate() {
    const select = $('sensorSelect'); if (!select) return;
    const previous = pendingSensorId || select.value;
    const missing = previous && !nodes.some(node => node.id === previous && node.active);
    const previousLabel = select.selectedOptions[0]?.textContent?.replace(/ \(Unavailable\)$/, '') || 'Selected AC device';
    const options = '<option value="">All AC Devices</option>' + nodes.filter(node => node.active).map(node => `<option value="${esc(node.id)}">${esc(deviceLabel(node.name))} · ${esc(node.aircon_name)}</option>`).join('')
      + (missing && !pendingSensorId ? `<option value="${esc(previous)}">${esc(previousLabel)} (Unavailable)</option>` : '');
    if (select.dataset.sensorOptions !== options) { select.innerHTML = options; select.dataset.sensorOptions = options; }
    select.value = missing && pendingSensorId ? '' : previous;
    if ($('sensorActiveCount')) $('sensorActiveCount').textContent = available ? String(nodes.filter(node => node.fresh && node.active).length) : '—';
  }
  function renderLocations() {
    const container = $('sensorLocations'); if (!container) return;
    const groups = new Map();
    locationRegistry.rooms.forEach(room => {
      const floor = locationRegistry.floors.find(item => item.id === room.floor_id), building = locationRegistry.buildings.find(item => item.id === (floor?.building_id || room.building_id));
      if (room.name && floor?.name && building?.name) groups.set([building.name, floor.name, room.name].join(' · '), 0);
    });
    telemetryDevices().forEach(node => groups.set(node.location || '', (groups.get(node.location || '') || 0) + 1));
    if (loaded && locationFilter !== null && !groups.has(locationFilter)) locationFilter = null;
    const tree = new Map();
    [...groups].forEach(([location, count], index) => {
      const parts = location.split('·').map(part => part.trim()).filter(Boolean);
      if (!parts.length) return;
      let branch = tree;
      parts.forEach((part, depth) => { if (!branch.has(part)) branch.set(part, { children: new Map(), leaves: [] }); const item = branch.get(part); if (depth === parts.length - 1) item.leaves.push({ location, count, index }); branch = item.children; });
    });
    const draw = (branch, depth = 0) => [...branch].map(([name, item]) => item.children.size ? `<details class="sensor-location-level-${depth} ${depth === 0 ? 'eco-location-building-group' : 'eco-location-floor'}" open><summary class="${depth === 0 ? 'eco-location-building' : 'eco-location-floor-heading'}">${depth === 0 ? sensorIcon('building') : sensorIcon('floor')}${esc(name)}</summary><div class="${depth === 0 ? 'eco-location-floors' : 'eco-location-rooms'}">${item.leaves.map(leaf => locationButton(name, leaf)).join('')}${draw(item.children, depth + 1)}</div></details>` : item.leaves.map(leaf => locationButton(name, leaf)).join('')).join('');
    const locationButton = (name, leaf) => `<button type="button" class="eco-location-room" data-location-index="${leaf.index}" aria-pressed="${locationFilter === leaf.location}"><span>${esc(name)}</span><small>${leaf.count} AC device node${leaf.count === 1 ? '' : 's'}</small></button>`;
    container.innerHTML = draw(tree) + (!tree.size ? '<p class="sensor-note">No locations yet</p>' : '');
    const locationSelect = $('sensorLocationSelect');
    if (locationSelect) {
      locationSelect.innerHTML = '<option value="-1">All locations</option>' + [...groups.keys()].map((location, index) => `<option value="${index}">${esc(location || 'Unassigned location')}</option>`).join('');
      locationSelect.value = String(locationFilter === null ? -1 : [...groups.keys()].indexOf(locationFilter));
    }
    container.querySelectorAll('button').forEach(button => button.addEventListener('click', () => {
      locationFilter = button.dataset.locationIndex === '-1' ? null : [...groups.keys()][Number(button.dataset.locationIndex)];
      if ($('sensorSelect')) $('sensorSelect').value = ''; renderLocations(); renderFleet();
    }));
  }
  function refreshLocations({ renderNow = true } = {}) {
    if (registryTask || !window.electron?.invoke) return registryTask;
    let timer;
    registryTask = Promise.race([window.electron.invoke('scheduler-fetch-data'), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Location registry unavailable')), 5000); })])
      .then(result => { if (!result?.success) return; for (const field of ['buildings', 'floors', 'rooms']) if (Array.isArray(result[field])) locationRegistry[field] = result[field]; readRegistryDevices(result);if(renderNow){if(page==='telemetry'){renderLocations(); renderFleet();}else render();} })
      .catch(() => {}).finally(() => { clearTimeout(timer); registryTask = null; });
    return registryTask;
  }
  function sensorIcon(name) {
    const paths = { location: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="3"/>', node: '<rect x="5" y="3" width="14" height="18" rx="3"/><path d="M9 7h6M9 11h6M11 17h2"/>', temperature: '<path d="M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0Z"/><path d="M12 9v9"/>', rotation: '<path d="M4 19a10 10 0 1 1 16 0M12 13l4-4M5 19h14"/>', cool: '<path d="M12 2v20M3 7l18 10M3 17 21 7M8 4l4 4 4-4M8 20l4-4 4 4"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>' };
    paths.building = '<path d="M3 21V8l9-6 9 6v13H3Z"/><path d="M9 21V11h6v10"/>';
    paths.floor = '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 12h16"/>';
    return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.node}</svg>`;
  }
  function attentionReason(node) {
    const transport = connection(node).label;
    if (transport === 'Sleeping') return '';
    if (transport === 'Offline') return 'Device offline';
    if (node.device_mode === 'controller') return '';
    if (!available) return 'Readings unavailable';
    if (!node.latest) return 'Awaiting readings';
    if (!node.fresh) return 'No recent readings';
    if (['fault','missing','out_of_range'].includes(node.latest.temperature_quality) || ['fault','missing','out_of_range'].includes(node.latest.rotation_quality)) return 'Sensor reading needs checking';
    return '';
  }
  function intervalLabel(seconds) {
    if (!Number.isFinite(seconds)) return 'Not set';
    return seconds < 60 ? num(seconds, 0) + ' sec' : num(seconds / 60, 2).replace(/\.?0+$/, '') + ' min';
  }
  function airflowConfigs() {
    const configs = Object.create(null);
    for (const node of nodes) {
      const registered = registryDevices.find(item => item.monitoring_id === node.id || node.cloud_node_id && item.id === 'registry:' + node.cloud_node_id);
      const live = liveNodeValues.get(node.cloud_node_id || registered?.id?.replace(/^registry:/, ''));
      configs[node.id] = live && Object.prototype.hasOwnProperty.call(live, 'sensor_config') ? live.sensor_config : registered ? registered.sensor_config : node.sensor_config;
    }
    return configs;
  }
  function airflowAverage(groups) {
    return window.EcoTrackAirflowPressure?.airflowRpmAverage(groups) ?? null;
  }
  function historicalAirflow(row) {
    return window.EcoTrackAirflowPressure?.airflowRpmText(rotationValue(row), row.rotation_quality) || '—';
  }
  function recordedRotation(node) {
    const sample = node.latest, observed = Date.parse(sample?.observed_at || '');
    return Number.isFinite(observed) && observed <= Date.now() + 5000 ? rotationValue(sample) : null;
  }
  function airflowReading(node) {
    const value = recordedRotation(node);
    return value === null ? '—' : window.EcoTrackAirflowPressure.airflowRpmText(value, node.latest?.rotation_quality);
  }
  function airflowMeasurementNote(node, live) {
    const observed = Date.parse(node.latest?.observed_at || '');
    if (!Number.isFinite(observed) || observed > Date.now() + 5000) return 'No RPM reading received';
    if (recordedRotation(node) === null) return 'RPM reading unavailable';
    return 'Measured wheel rotation' + (live ? '' : ' · Last recorded');
  }
  function blowerDetail(node) {
    const selected = window.EcoTrackAirconState?.selectSettings(controlSnapshot(node));
    const fan = typeof selected?.state?.fan === 'string' ? selected.state.fan.trim() : '';
    if (!fan) return 'Fan setting not reported';
    return settingLabel(selected.field_sources?.fan, 'fan') + ': ' + fan[0].toUpperCase() + fan.slice(1).toLowerCase();
  }
  function referenceIdentity(node) { return node.cloud_node_id || (node.registry_only ? node.id.replace(/^registry:/, '') : ''); }
  function canReference(node) {
    return Boolean(referenceIdentity(node) && window.EcoTrackAirflowPressure?.canSetAirflowReference(node.latest?.rotation_rpm, node.latest?.rotation_quality, node.latest?.observed_at, node.expected_interval_seconds || node.sensor_schedule?.interval_seconds));
  }
  function sensorCard(node) {
    const live = (available || node.live_cloud) && node.fresh, sample = node.latest, transport = connection(node), monitoring = node.device_mode !== 'controller', attention = attentionReason(node);
    const target = targetSetting(node), mode = modeSetting(node);
    const temperature = Number.isFinite(target.value) ? `<strong><span>${num(target.value, 0)}</span><small>°C</small></strong>` : '<strong class="sensor-unavailable">Unavailable</strong>';
    return `<article class="sensor-node sensor-telemetry-card" data-needs-attention="${Boolean(attention)}">
      <div class="sensor-node-top">
        <h3>${esc(deviceLabel(node.name))}</h3>
        <p class="sensor-node-asset">${esc(node.aircon_name)}</p>
        <div class="sensor-node-badges">${badge(transport.label, transport.label === 'Connected' ? 'good' : transport.label === 'Offline' ? 'warn' : '')}${badge(monitoring ? 'Measurements: ' + (available ? node.status : 'Unavailable') : 'Controlling only', monitoring && !live ? 'warn' : '')}</div>
        ${monitoring ? `<div class="sensor-mode-tile"><span class="sensor-setting-label">${esc(settingLabel(mode.source, 'mode'))}</span><b>${esc(mode.value)}</b></div>` : ''}
      </div>
      <div class="sensor-reading-status"><p class="sensor-measured">${sensorIcon('clock')}Measured: ${esc(stamp(sample?.observed_at))}</p>${attention && attention !== node.status && attention !== 'Device offline' ? `<p class="sensor-attention-reason">${esc(attention)}</p>` : ''}</div>
      <div class="sensor-node-metrics"><div class="sensor-metric temperature">${sensorIcon('temperature')}<span>AC target setpoint</span>${temperature}<small class="sensor-note">${esc(settingSource(target.source))}</small></div>${monitoring ? `<div class="sensor-metric rotation">${sensorIcon('rotation')}<span>Airflow Indicator (RPM)</span><strong>${esc(airflowReading(node))}</strong><small class="sensor-note">${esc(blowerDetail(node))}<br>${esc(airflowMeasurementNote(node, live))}</small></div>` : ''}</div>
      ${monitoring ? `<div class="sensor-power-row"><span>AC Power</span>${state(sample, live)}</div>` : '<p class="sensor-controller-note sensor-note">This device controls the AC. Sensor readings are not expected.</p>'}
      <footer><button type="button" class="sensor-detail-button" data-sensor-detail="${esc(node.id)}" aria-label="View details for ${esc(deviceLabel(node.name))}">Details →</button></footer>
    </article>`;
  }
  function renderFleet() {
    const scoped = telemetryDevices().filter(node => locationFilter === null || node.location === locationFilter);
    const list = scoped.sort((a,b) => Boolean(attentionReason(b)) - Boolean(attentionReason(a)));
    $('sensorCount').textContent = loaded ? `${list.length} device${list.length === 1 ? '' : 's'}` : '';
    $('sensorCount').title = 'Devices in this location';
    const fleet = $('sensorFleet'), location = locationFilter || '';
    const scrollTop = fleetPosition.location === location ? fleetPosition.top : 0;
    fleetPosition = {location, top:scrollTop};
    fleet.dataset.location = location; fleet.classList.toggle('has-devices', list.length > 0);
    $('sensorInterfaceTitle').innerHTML = sensorIcon('node') + esc(locationFilter ? locationFilter.split('·').at(-1).trim() : 'All devices');
    let noDevices;
    if (!loaded && !available) noDevices = empty('Local readings unavailable', 'Start or reconnect the EcoTrack local service, then retry.') + '<button type="button" class="sensor-button" data-sensor-retry>Retry</button>';
    else noDevices = empty(locationFilter ? 'No devices in this location' : 'No registered devices', 'Register an AC device, assign it to this location, or choose another room.') + '<div class="sensor-empty-actions"><a class="sensor-button primary" href="nodes.html">Register AC device</a>' + (locationFilter ? '<button type="button" class="sensor-button" data-show-all-locations>Show all locations</button>' : '') + '</div>';
    fleet.innerHTML = list.length ? list.map(sensorCard).join('') : '<div class="sensor-fleet-empty">' + noDevices + '</div>';
    fleet.scrollTop = scrollTop;
    fleet.querySelectorAll('[data-sensor-detail]').forEach(button => button.addEventListener('click', () => openSensorDetails(button.dataset.sensorDetail)));
    fleet.querySelector('[data-show-all-locations]')?.addEventListener('click', () => { locationFilter = null; renderLocations(); renderFleet(); });
    fleet.querySelector('[data-sensor-retry]')?.addEventListener('click', () => refresh());
    refreshOpenSensorDetails();
  }
  function sensorDetailsContent(node) {
    const sample = node.latest, live = (available || node.live_cloud) && node.fresh;
    const target = targetSetting(node), mode = modeSetting(node);
    const deviceType=({monitoring:'Monitoring Only',controller:'Controlling Only',both:'Monitoring and Controlling'})[node.device_mode] || 'Monitoring Only';
    const rows = [['Aircon', node.aircon_name], ['Type', node.aircon_type || 'Unavailable'], ['Location', node.location || 'Unassigned'], ['AC target setpoint', Number.isFinite(target.value) ? num(target.value, 0) + ' °C' : 'Unavailable'], ['Setpoint source', settingSource(target.source)], ['Setpoint updated', stamp(target.at)], ['Airflow Indicator (RPM)', airflowReading(node) + ' · ' + airflowMeasurementNote(node, live)], ['Fan setting', blowerDetail(node)], [settingLabel(mode.source, 'mode'), mode.value], ['Power feedback', !live || sample?.ac_on == null ? 'Unknown' : sample.ac_on ? 'Confirmed ON' : 'Confirmed OFF'], ['Device connection', connection(node).label], ['Last heartbeat', stamp(connection(node).heartbeat?.last_seen)], ['Measurement updated', stamp(sample?.observed_at)], ['Signal', live && Number.isFinite(sample?.rssi_dbm) ? num(sample.rssi_dbm, 0) + ' dBm' : 'Unavailable'], ['Battery', live && Number.isFinite(sample?.battery_voltage) ? num(sample.battery_voltage, 2) + ' V' : 'Unavailable'], ['Requested wake time', node.sensor_schedule?.wake_time || 'Not set'], ['Requested sleep time', node.sensor_schedule?.sleep_time || 'Not set'], ['Requested interval', intervalLabel(node.sensor_schedule?.interval_seconds)], ['Device type', deviceType], ['Device ID', deviceLabel(node.id.replace(/^registry:/,''))]];
    return '<dl class="sensor-detail-list">' + rows.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('') + '</dl>';
  }
  function openSensorDetails(id) {
    const node = telemetryDevices().find(item => item.id === id); if (!node) return;
    const reference = node.device_mode !== 'controller' ? '<section class="sensor-reference-panel"><p class="sensor-note">% of saved reference · based on wheel rotation. Keep the wheel in the same position and run the aircon at your normal setting before saving 100%.</p><button type="button" class="sensor-button" id="sensorAirflowReference">Use current reading as 100%</button><p class="sensor-note" id="sensorReferenceStatus" role="status"></p></section>' : '';
    openDialog(node.name, sensorDetailsContent(node) + reference, null); liveDetailId = id;
    const button = $('sensorAirflowReference');
    if (button) {
      button.disabled = !canReference(node) || airflowSaving;
      button.addEventListener('click', () => saveCurrentAirflowReference(id));
    }
  }
  function refreshOpenSensorDetails() {
    if (!liveDetailId || !$('sensorDialog')?.open) return;
    const node = telemetryDevices().find(item => item.id === liveDetailId);
    const list = $('sensorDialog').querySelector('.sensor-detail-list');
    if (node && list) { list.outerHTML = sensorDetailsContent(node); $('sensorDialogTitle').textContent = node.name; }
    const button = $('sensorAirflowReference'); if (button && node) button.disabled = airflowSaving || !canReference(node);
  }
  async function saveCurrentAirflowReference(id) {
    const node = telemetryDevices().find(item => item.id === id); if (airflowSaving || !node || !canReference(node)) return;
    const account = window.EcoDataBus?._sessionScope() || '', current = () => liveDetailId === id && account === (window.EcoDataBus?._sessionScope() || '');
    const button = $('sensorAirflowReference'); airflowSaving = true; button.disabled = true; button.textContent = 'Saving…';
    $('sensorReferenceStatus').textContent = '';
    try {
      const config = await window.EcoTrackAirflowPressure.saveAirflowReference(window.supabaseClient, referenceIdentity(node), node.latest.rotation_rpm, node.latest.rotation_quality, node.latest.observed_at, node.expected_interval_seconds || node.sensor_schedule?.interval_seconds, current);
      if (!current()) return;
      const key = referenceIdentity(node); liveNodeValues.set(key, { ...liveNodeValues.get(key), sensor_config: config, updated: config.airflow_reference.saved_at });
      registryDevices = registryDevices.map(item => referenceIdentity(item) === key ? { ...item, sensor_config: config } : item);
      renderFleet(); if ($('sensorReferenceStatus')) $('sensorReferenceStatus').textContent = 'Reference saved.';
    } catch (error) { if (current() && $('sensorReferenceStatus')) $('sensorReferenceStatus').textContent = error.message || 'Unable to save the reference.'; }
    finally { airflowSaving = false; if (current()) { button.textContent = 'Use current reading as 100%'; refreshOpenSensorDetails(); } }
  }
  function stat(label, value, note) { return `<section class="sensor-stat glass-surface glass-card"><h2>${label}</h2><strong>${esc(value)}</strong><small>${esc(note)}</small></section>`; }
  function renderStats() {
    $('sensorSnapshots').innerHTML = stat('Avg Temp', num(stats?.target_temperature_avg, 0) + (stats?.target_temperature_avg == null ? '' : ' °C'), 'Recorded AC target setpoint')
      + stat('Avg Airflow Indicator (RPM)', num(airflowAverage(stats?.rotation_by_node), 0) + (airflowAverage(stats?.rotation_by_node) == null ? '' : ' RPM'), 'Measured wheel rotation · valid readings')
      + stat('Confirmed Operation', stats?.confirmed_state_count ? num(stats.confirmed_unit_hours, 0) + ' h' : 'Unknown', 'AC unit-hours · independent power feedback')
      + stat('Recorded Samples', stats ? String(stats.sample_count) : 'Unavailable', 'Timestamped observations in this period')
      + stat('Observed Intervals', stats?.sample_count ? num(stats.observed_unit_hours, 0) + ' h' : 'Unavailable', 'Recorded cadence · missing gaps excluded');
  }
  function tariff() { const value = localStorage.getItem('ecoTrack_tariff_rate'); const rate = value === null ? NaN : Number(value); return Number.isFinite(rate) && rate >= 0 ? rate : null; }
  function renderEnergy() {
    const set = (id, value) => { if ($(id)) $(id).textContent = value; };
    const rate = tariff(), dataReady = available && stats;
    const usable = energy?.available && Number.isFinite(energy.energy_kwh), cost = usable && rate !== null ? energy.energy_kwh * rate : null;
    const missing = !available ? 'Reconnect to the local backend.' : energy?.reason || 'Waiting for eligible recorded AC readings.';
    set('kpiEnergyLabel', 'ESTIMATED ENERGY'); set('kpiEnergyVal', usable ? num(energy.energy_kwh, 3) : '—'); $('kpiEnergyVal').style.fontSize = usable ? '' : '23px'; $('kpiEnergyUnit').hidden = !usable;
    set('kpiEnergyTrend', 'Experimental'); set('kpiEnergyTrendLabel', usable ? num(energy.estimated_unit_hours,0)+' h covered' : 'Awaiting readings');
    $('kpiEnergyVal').title = energy?.reason || 'Waiting for eligible recorded AC readings.';
    set('kpiAvgLoad', usable ? num(energy.average_power_kw,3)+' kW / AC' : '—'); set('kpiCostLabel', 'ESTIMATED COST'); set('kpiCostVal', cost === null ? '—' : '₱'+num(cost,2)); $('kpiCostVal').style.fontSize = cost === null ? '23px' : '';
    set('kpiCostTrend', rate === null ? 'Set tariff' : ''); set('kpiCostTrendLabel', rate === null ? '' : 'Energy × tariff');
    set('kpiCostRate', rate === null ? 'Not configured' : `₱${num(rate, 2)} / kWh`);
    set('headerTariffDisplay', rate === null ? 'Not configured' : `₱${num(rate, 2)} / kWh`);
    set('kpiRuntimeLabel', 'CONFIRMED HOURS'); set('kpiRuntimeVal', dataReady?.confirmed_state_count ? num(stats.confirmed_unit_hours, 0) : 'Unknown'); $('kpiRuntimeVal').style.fontSize = '27px';
    set('kpiRuntimeUnit', 'unit-hours'); set('kpiRuntimeTrend', 'Power feedback'); set('kpiRuntimeTrendLabel', '');
    set('kpiUtilizationLabel', 'Observed hours'); set('kpiUtilization', dataReady?.sample_count ? num(stats.observed_unit_hours, 0) + ' h' : '—');
    const fresh = selected().filter(node => available && node.fresh), known = fresh.filter(node => node.latest?.ac_on != null), on = known.filter(node => node.latest.ac_on).length;
    set('kpiActiveLabel', 'CONFIRMED ACTIVE'); set('kpiActiveUnits', known.length ? String(on) : 'Unknown'); $('kpiActiveUnits').style.fontSize = known.length ? '' : '27px';
    set('kpiTotalUnits', loaded ? '/' + selected().length : ''); set('kpiCapacityPct', ''); set('kpiFleetStatusLabel', loaded ? `${known.length} reporting power` : 'Awaiting feedback');
    set('kpiIdleLabel', 'Confirmed OFF'); set('kpiIdleUnits', known.length ? String(known.length - on) : 'Unknown');
    set('energyTrendSubtitle', 'Estimated AC energy · covered recorded intervals · ' + ($('sensorSelect').selectedOptions[0]?.textContent || 'All AC Devices'));
    set('trendBaselineLegend', 'Previous period: —'); set('estimatedCostSubtitle', 'Experimental energy estimate × selected rate'); set('costTodayCost', cost === null ? '—' : '₱'+num(cost,2)); set('costCurrentCycle', cost === null ? '—' : '₱'+num(cost,2)); set('costPrevPeriod', '—'); set('costVariance', '—');
    set('costCardRate', rate === null ? 'Not configured' : `₱${num(rate, 2)} / kWh`); set('correlationScore', '—');
    const points=usable ? energy.points || [] : [], values=points.map(point=>point.energy_kwh).filter(Number.isFinite);
    for(const [id,label] of [['trendLowPrefix','Covered interval low'],['trendPeakPrefix','Covered interval peak'],['trendTotalPrefix','Covered total']])set(id,label);
    set('trendLow', values.length ? num(Math.min(...values),3)+' kWh' : '—'); set('trendPeak', values.length ? num(Math.max(...values),3)+' kWh' : '—'); set('trendTotal', usable ? num(energy.energy_kwh,3)+' kWh' : '—'); set('dualAxisPeriodBadge', 'Experimental · '+period+' covered intervals');
    for (const id of ['energyTrendChart', 'estimatedCostChart', 'dualAxisChart']) {
      const empty = $(id === 'energyTrendChart' ? 'energyTrendEmpty' : id === 'estimatedCostChart' ? 'estimatedCostEmpty' : 'dualAxisEmpty');
      const show=usable && (id==='energyTrendChart' || rate!==null);
      empty.classList.add('sensor-forecast-empty'); empty.style.display = show ? 'none' : 'flex';
      empty.querySelector('strong').textContent=usable ? 'Set electricity rate' : 'No estimate available';
      const detail = empty.querySelector('span'); if (detail) detail.textContent = usable ? 'Add a tariff to show estimated cost.' : missing;
      empty.title=energy?.reason || missing;
      $(id).style.visibility=show?'visible':'hidden'; $(id).setAttribute('aria-hidden',String(!show));
      if (typeof Chart !== 'function') continue;
      const dark = document.documentElement.classList.contains('dark'), color = dark ? '#94a3b8' : '#64748b';
      const dataset=(label,data,color,yAxisID='y')=>({label,data,borderColor:color,backgroundColor:color,pointRadius:1,borderWidth:2,spanGaps:false,yAxisID});
      const energyValues=points.map(point=>point.energy_kwh), costValues=energyValues.map(value=>Number.isFinite(value)&&rate!==null ? value*rate : null);
      const datasets=!show?[]:id==='energyTrendChart'?[dataset('Experimental energy (kWh)',energyValues,'#10b981')]:id==='estimatedCostChart'?[dataset('Experimental cost (₱)',costValues,'#06b6d4')]:[dataset('Experimental energy (kWh)',energyValues,'#10b981'),dataset('Experimental cost (₱)',costValues,'#06b6d4','cost')];
      const options = { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color,maxTicksLimit:6 }, grid: { display: false } }, y: { beginAtZero:true, ticks: { color }, grid: { color: dark ? '#ffffff0c' : '#0f172a0c' }, title:{display:true,text:id==='estimatedCostChart'?'PHP':'kWh',color} } } };
      if(id==='dualAxisChart')options.scales.cost={position:'right',beginAtZero:true,grid:{drawOnChartArea:false},ticks:{color},title:{display:true,text:'PHP',color}};
      const data={labels:show?points.map(point=>new Date(point.observed_at).toLocaleString('en-SG',{timeZone:'Asia/Singapore',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false})):[],datasets};
      if (!charts.has(id)) charts.set(id, new Chart($(id), { type: 'line', data, options }));
      else { const instance = charts.get(id); instance.data=data;instance.options = options; instance.update('none'); }
    }
  }
  function openReferenceDialog(templateId, titleId) {
    consumersView?.dispose();
    $('sensorDialog')?.remove(); const prior=document.activeElement;
    const dialog=document.createElement('dialog');dialog.id='sensorDialog';dialog.className='sensor-reference-dialog';dialog.setAttribute('aria-labelledby',titleId);
    dialog.append($(templateId).content.cloneNode(true));$('sensorDialogs').append(dialog);
    const close=()=>{dialog.close();dialog.remove();prior?.focus?.();};
    dialog.querySelectorAll('[data-close-reference]').forEach(button=>button.addEventListener('click',close));
    dialog.addEventListener('cancel',event=>{event.preventDefault();close();});dialog.showModal();return {dialog,close};
  }
  function openTariff() {
    const {close}=openReferenceDialog('sensorTariffTemplate','tariffModalTitle');
    $('tariffRateInput').value=tariff() ?? ''; $('utilityProviderInput').value=localStorage.getItem('ecoTrack_utility_provider') || '';
    const preview=()=>{const rate=Number($('tariffRateInput').value);$('tariffPreviewBill').textContent=energy?.available && $('tariffRateInput').value!=='' && Number.isFinite(rate) && rate>=0 ? '₱'+num(energy.energy_kwh*rate,2)+' · experimental' : 'Unavailable';};
    preview();$('tariffRateInput').addEventListener('input',preview);
    $('resetTariffDefaultBtn').addEventListener('click',()=>{ for(const key of ['ecoTrack_tariff_rate','ecoTrack_target_budget','ecoTrack_utility_provider'])localStorage.removeItem(key);close();renderEnergy(); });
    $('tariffConfigForm').addEventListener('submit',event=>{
      event.preventDefault();if(!$('tariffConfigForm').reportValidity())return;
      localStorage.setItem('ecoTrack_tariff_rate',Number($('tariffRateInput').value).toFixed(2));
      const provider=$('utilityProviderInput').value.trim();if(provider)localStorage.setItem('ecoTrack_utility_provider',provider);else localStorage.removeItem('ecoTrack_utility_provider');
      close();renderEnergy();
    });
  }
  const logHeadings = ['Timestamp (UTC+08:00)', 'AC Device Name', 'Building', 'Floor', 'Room', 'Attached Aircon Type', 'AC State', 'Temperature (°C)', 'Blower Fan Speed', 'Battery (V)', 'RSSI (dBm)', 'Recorded Status'];
  function logValues(row) {
    const node = nodes.find(item => item.id === row.node_id), location = (row.location || node?.location || '').split('·').map(value => value.trim());
    const settings = window.EcoTrackAirconState?.displaySettings(row.control_snapshot, row.observed_at || '');
    const fan = settings && settings.fanLabel !== '—' ? settings.fanLabel + (settings.state?.turbo === true ? ' · TURBO' : '') : '—';
    return [stamp(row.observed_at), row.sensor_name || node?.name || '—', location[0] || '—', location[1] || '—', location[2] || '—', row.aircon_type || '—', row.ac_on == null ? 'Unknown' : row.ac_on ? 'Confirmed ON' : 'Confirmed OFF', row.target_temperature_c ?? '—', fan, row.battery_voltage ?? '—', row.rssi_dbm ?? '—', row.connection_status || '—'].map(value => value === 'Unavailable' ? '—' : value);
  }
  function chart(id, field, color, unit) {
    const points = (stats?.points || []).map(point => field === 'rotation_rpm' ? {...point, rotation_rpm:airflowAverage(point.rotation_by_node)} : point), isMode = field === 'operating_mode', values = points.map(point => point[field]).filter(Number.isFinite);
    const hasReadings = points.some(point => isMode ? ['cool','fan_only','dry','auto','off'].includes(point.operating_mode) || point.ac_on != null : Number.isFinite(point[field]));
    $(id + 'Empty').hidden = hasReadings;
    $(id + 'Empty').textContent = isMode ? 'No mode or power readings in this window.' : field === 'target_temperature_c' ? 'No recorded target setpoints in this window.' : 'No measured readings in this window.';
    if (typeof Chart !== 'function') return;
    const datasets = isMode ? [{label:'Cold',field:'operating_mode',value:'cool',y:4,color:'#06b6d4'}, {label:'Dry',field:'operating_mode',value:'dry',y:5,color:'#eab308'}, {label:'Auto',field:'operating_mode',value:'auto',y:6,color:'#14b8a6'}, {label:'Fan Only',field:'operating_mode',value:'fan_only',y:3,color:'#818cf8'}, {label:'Off (reported mode)',field:'operating_mode',value:'off',y:2,color:'#64748b'}, {label:'Confirmed ON',field:'ac_on',value:1,y:1,color:'#10b981'}, {label:'Confirmed OFF',field:'ac_on',value:0,y:0,color:'#94a3b8'}].map(item => ({ label: item.label, data: points.map(point => point[item.field] === item.value ? item.y : null), borderColor: item.color, backgroundColor: item.color, showLine: false, pointRadius: 4 })) : [{ label: unit, data: points.map(point => point[field]), borderColor: color, borderWidth: 2, pointRadius: 2, spanGaps: false, tension: .1 }];
    const dark = document.documentElement.classList.contains('dark'), text = dark ? '#94a3b8' : '#64748b';
    const options = { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: isMode, labels: { color: text, boxWidth: 10 } }, tooltip: { callbacks: { label: context => isMode ? context.dataset.label : field === 'rotation_rpm' ? num(context.parsed.y, 0) + ' RPM' : `${field === 'target_temperature_c' ? num(context.parsed.y, 0) : context.formattedValue} ${unit}` } } }, scales: { x: { grid: { display: false }, ticks: { color: text, maxTicksLimit: 6, maxRotation: 0 } }, y: { grid: { color: dark ? '#ffffff0c' : '#0f172a0c' }, ticks: { color: text }, title: { display: !!unit, text: unit, color: text } } } };
    if (isMode) Object.assign(options.scales.y, { min: -.2, max: 6.2, ticks: { color: text, stepSize: 1, callback: value => ({0:'Confirmed OFF',1:'Confirmed ON',2:'Off (mode)',3:'Fan Only',4:'Cold',5:'Dry',6:'Auto'}[value] || '') } });
    if (field === 'target_temperature_c') {
      // Chart.js defaults to 0–1 without readings. Use °C bounds, with real data
      // allowed to include negative values and temperatures outside a typical room range.
      const minimum = values.length ? Math.min(...values) : 0, maximum = values.length ? Math.max(...values) : 40;
      const padding = values.length ? Math.max(2, (maximum - minimum) * .1) : 0;
      Object.assign(options.scales.y, { min: Math.floor((minimum - padding) / 5) * 5, max: Math.ceil((maximum + padding) / 5) * 5, ticks: { color: text, precision: 0 } });
    }
    const data = { labels: points.map(point => new Date(point.observed_at).toLocaleString('en-SG', { timeZone: 'Asia/Singapore', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })), datasets };
    let instance = charts.get(id);
    if (!instance) { instance = new Chart($(id), { type: 'line', data, options }); charts.set(id, instance); }
    else { instance.data = data; instance.options = options; instance.update('none'); }
  }
  function renderHistory() {
    const rows = history.length ? history.map(row => '<tr>' + logValues(row).map((value, column) => `<td>${esc(column === 7 ? num(row.target_temperature_c, 0) : value)}</td>`).join('') + '</tr>').join('') : `<tr><td colspan="${logHeadings.length}" class="sensor-log-empty"><div class="sensor-log-empty-content" role="status"><div class="sensor-log-empty-icon" aria-hidden="true"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12h5l3-9 4 18 3-9h5"/></svg></div><strong>${available ? 'No Sensor Readings for This Interval' : 'Sensor Readings Unavailable'}</strong><p>${available ? 'No sensor readings match these filters.' : 'Refresh after the local backend reconnects.'}</p></div></td></tr>`;
    $('sensorLogTable').innerHTML = '<div class="sensor-table-wrap eco-table-frame" tabindex="0" role="region" aria-label="Sensor data logs, scroll to view all columns"><table class="sensor-table eco-data-table"><caption class="sr-only">Recorded sensor readings in the selected observation period</caption><thead><tr>' + logHeadings.map(label => `<th scope="col">${esc(label)}</th>`).join('') + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
    $('sensorPageInfo').textContent = total ? `${(pageNumber - 1) * 50 + 1}–${Math.min(pageNumber * 50, total)} of ${total}` : 'No readings';
    $('sensorPrevious').disabled = pageNumber <= 1; $('sensorNext').disabled = pageNumber * 50 >= total;
    document.querySelectorAll('[data-export]').forEach(button => { button.disabled = exporting; });
  }
  function render() {
    populate();
    if (page === 'analytics') renderStats();
    if (page === 'logs') renderEnergy();
    if (page === 'analytics') { chart('sensorTempChart', 'target_temperature_c', '#06b6d4', '°C'); chart('sensorRotationChart', 'rotation_rpm', '#10b981', 'RPM'); chart('sensorStateChart', 'operating_mode', '', ''); }
    else if (page === 'logs') renderHistory();
    else { renderLocations(); renderFleet(); }
  }
  function showSensorLoading() {
    if (!window.EcoTrackSkeletons) return;
    $('sensorLoading')?.remove();
    const loading = document.createElement('div'); loading.id = 'sensorLoading'; loading.setAttribute('role', 'status'); loading.setAttribute('aria-label', 'Loading sensor data');
    if (page === 'telemetry') {
      const line = width => `<div class="eco-skeleton sensor-skeleton-line" style="width:${width}" aria-hidden="true"></div>`;
      const card = `<article class="sensor-node sensor-telemetry-card" aria-hidden="true"><div class="sensor-node-top"><div>${line('130px')}${line('90px')}</div><div class="sensor-mode-tile">${line('74px')}</div></div><div class="sensor-node-asset">${line('100px')}</div><div class="sensor-node-metrics">${[0,1].map(()=>'<div class="sensor-metric">'+line('22px')+line('76px')+line('90px')+'</div>').join('')}</div><div class="sensor-hardware-metrics">${[0,1].map(()=>'<div>'+line('60px')+line('80px')+'</div>').join('')}</div><div class="sensor-power-row">${line('64px')}${line('80px')}</div><div class="sensor-schedule-preview">${[0,1,2].map(()=>'<div>'+line('46px')+line('54px')+'</div>').join('')}</div><footer>${line('80px')}${line('55px')}</footer></article>`;
      loading.innerHTML = `<div class="sensor-telemetry-layout"><aside class="eco-location-panel sensor-panel sensor-cabinet"><h2 class="eco-location-title">${sensorIcon('location')}Location</h2><div id="sensorLoadingLocations" class="eco-location-tree"></div></aside><section class="sensor-panel sensor-interface"><div class="sensor-panel-head">${line('130px')}${line('70px')}</div><div id="sensorLoadingFleet" class="sensor-interface-grid has-devices" aria-hidden="true">${card}${card}</div></section></div>`;
    } else {
      loading.innerHTML = '<div id="sensorLoadingMetrics" class="sensor-loading-metrics" aria-hidden="true"></div><div class="sensor-chart-grid" aria-hidden="true"><div id="sensorLoadingChartA"></div><div id="sensorLoadingChartB"></div></div><div id="sensorLoadingChartC" aria-hidden="true"></div>';
    }
    $('sensorApp').before(loading); $('sensorApp').hidden = true;
    if (page === 'telemetry') { EcoTrackSkeletons.renderRoomListSkeleton('sensorLoadingLocations', { count: 3 }); }
    else { EcoTrackSkeletons.renderKpiStripSkeleton('sensorLoadingMetrics', { count: page === 'analytics' ? 5 : 4 }); for (const id of ['sensorLoadingChartA', 'sensorLoadingChartB', 'sensorLoadingChartC']) EcoTrackSkeletons.renderChartSkeleton(id); }
  }
  function hideSensorLoading() { initialLoadSettled = true; $('sensorLoading')?.remove(); $('sensorApp').hidden = false; }
  async function refresh({ poll = false } = {}) {
    saveView();
    if (poll && running) return;
    let key;
    try { key = sessionKey(); } catch (failure) { error(failure.message); return; }
    const cache = window.EcoDataBus, accountScope = cache?._sessionScope();
    if(page==='telemetry' && loaded && !running && $('sensorFleet') && !$('sensorApp').hidden)fleetPosition={location:locationFilter || '',top:$('sensorFleet').scrollTop};
    const id = ++revision; controller?.abort(); controller = new AbortController(); running = true;
    $('sensorRefresh').disabled = true; $('sensorRefresh').setAttribute('aria-busy', 'true');
    document.querySelectorAll('[data-sensor-retry]').forEach(button => { button.disabled = true; });
    $('sensorApp').setAttribute('aria-busy', 'true');
    if(page==='logs')window.EcoTrackFutureCost?.notify();
    if (loaded && snapshotKey !== key) { stats = null; energy = null; history = []; total = 0; available = false; render(); }
    if (!loaded && !initialLoadSettled) showSensorLoading();
    let registry = Promise.resolve();
    try {
      // Registry work shares this loading phase; it cannot replace an already rendered
      // empty state later. Keep polling renders until both metadata and readings settle.
      registry = (!poll || Date.now() - locationsChecked >= 60000) ? refreshLocations({renderNow:false}) : Promise.resolve();
      if (!poll || Date.now() - locationsChecked >= 60000) locationsChecked = Date.now();
      const sync = syncCloudRegistry({force:!poll});
      let delta = poll && loaded && Number.isInteger(dataVersion) && dataGeneration;
      let data = await request(delta ? '/changes?since=' + dataVersion + '&generation=' + encodeURIComponent(dataGeneration) : '/devices', {signal:controller.signal});
      await registry;
      const synced = poll && loaded ? registrySyncResult : await sync;
      if (id !== revision || cache && accountScope !== cache._sessionScope()) return;
      if (synced?.success && synced.data?.changed) { data = await request('/devices', {signal:controller.signal}); delta = false; }
      const changed = !delta || data.reset || data.items.length || data.removed?.length;
      if (delta && !data.reset) {
        const replacements = new Map(data.items.map(node => [node.id,node])), removed = new Set(data.removed || []);
        nodes = nodes.filter(node => !removed.has(node.id)).map(node => replacements.get(node.id) || node);
        for (const node of data.items) if (!nodes.some(item => item.id === node.id)) nodes.push(node);
      } else nodes = data.items;
      dataVersion = Number.isInteger(data.version) ? data.version : null; dataGeneration = data.generation || null;
      if (pendingSensorId) {
        const select = $('sensorSelect');
        if (select) select.value = '';
        if (select && nodes.some(node=>node.active && node.id === pendingSensorId)) { const option = document.createElement('option'); option.value = pendingSensorId; option.textContent = 'Selected AC device'; select.appendChild(option); select.value = pendingSensorId; }
        pendingSensorId = '';
        key = sessionKey();
      }
      if (changed && (page === 'analytics' || page === 'logs')) {
        const params = query(), tasks = [request('/analytics?' + params, {signal:controller.signal})];
        if (page === 'logs') tasks.push(request('/telemetry?' + params + `&page=${pageNumber}&per_page=50`, {signal:controller.signal}), request('/energy?' + params, {signal:controller.signal}).catch(() => ({available:false,code:'SENSOR_MODEL_UNAVAILABLE'})));
        const [analytics, rows, forecast] = await Promise.all(tasks);
        if (id !== revision || cache && accountScope !== cache._sessionScope()) return;
        stats = analytics || null; energy = forecast || null; history = rows?.items || []; total = rows?.total || 0;
      }
      loaded = true; available = true; lastRefreshAt = new Date().toISOString(); ageCachedNodes();
      snapshotKey = key;
      window.EcoDataBus?.mutate(key, {nodes, stats, energy, history, total, registryDevices, locationRegistry, dataVersion, dataGeneration, lastRefreshAt});
      void refreshHeartbeats();
      if(page==='logs')energySelection=query().toString();
      if(page==='logs')window.EcoTrackFutureCost?.notify();
      if (pageNumber > 1 && !history.length) { pageNumber = 1; running = false; refresh(); return; }
      const syncWarning=synced?.success===false?'Device registry sync unavailable. '+(synced.error || 'Retry the refresh.')+' Local sensor readings are still shown.':'';
      $('sensorConnection').textContent = (syncWarning ? 'Local backend connected · Registry sync unavailable' : 'Local backend connected') + ' · Last successful refresh: ' + stamp(lastRefreshAt); hideSensorLoading(); error(syncWarning, Boolean(syncWarning)); render();
    } catch (failure) {
      await registry;
      if (id !== revision || cache && accountScope !== cache._sessionScope()) return;
      if (!loaded || snapshotKey !== key) { available = false; stats = null; energy = null; history = []; total = 0; }
      else ageCachedNodes();
      if(page==='telemetry')void refreshHeartbeats();
      if(page==='logs')window.EcoTrackFutureCost?.notify();
      $('sensorConnection').textContent = loaded && snapshotKey === key ? 'Cached data · refresh unavailable' + (lastRefreshAt ? ' · Last successful refresh: ' + stamp(lastRefreshAt) : '') : 'Local readings unavailable';
      hideSensorLoading(); error(failure.name === 'AbortError' ? 'The local readings service did not respond.' : failure.message, true); render();
    } finally { if (id === revision) { running = false; $('sensorApp').setAttribute('aria-busy', 'false'); $('sensorRefresh').disabled = false; $('sensorRefresh').setAttribute('aria-busy', 'false'); document.querySelectorAll('[data-sensor-retry]').forEach(button => { button.disabled = false; }); } }
  }
  function openDialog(title, content, submitLabel, submit) {
    liveDetailId = null;
    consumersView?.dispose();
    $('sensorDialog')?.remove(); const prior = document.activeElement;
    $('sensorDialogs').innerHTML = `<dialog class="sensor-dialog" id="sensorDialog" aria-labelledby="sensorDialogTitle"><form id="sensorForm"><h2 id="sensorDialogTitle">${esc(title)}</h2>${content}<p class="sensor-form-error" id="sensorFormError" role="alert"></p><div class="sensor-dialog-footer"><button type="button" class="sensor-button" id="sensorDialogClose">Close</button>${submitLabel ? `<button type="submit" class="sensor-button primary" id="sensorSubmit">${esc(submitLabel)}</button>` : ''}</div></form></dialog>`;
    const dialog = $('sensorDialog');
    const close = () => { liveDetailId = null; dialog.close(); dialog.remove(); prior?.focus?.(); };
    $('sensorDialogClose').addEventListener('click', close);
    dialog.addEventListener('cancel', event => { event.preventDefault(); if (!$('sensorSubmit')?.disabled) close(); });
    $('sensorForm').addEventListener('submit', async event => {
      event.preventDefault(); if (!submit || $('sensorSubmit').disabled) return;
      const button = $('sensorSubmit'); button.disabled = true; button.textContent = 'Saving…'; $('sensorDialogClose').disabled = true; $('sensorFormError').textContent = '';
      try { await submit(close); } catch (failure) { if ($('sensorFormError')) $('sensorFormError').textContent = failure.message; }
      finally { if ($('sensorSubmit') === button) { button.disabled = false; button.textContent = submitLabel; $('sensorDialogClose').disabled = false; } }
    }); dialog.showModal();
  }
  async function ipc(channel, input) {
    if (!window.electron?.invoke) throw new Error('Open the EcoTrack desktop app and sign in as an administrator to save sensor settings.');
    let timer;
    try {
      const result = await Promise.race([window.electron.invoke(channel, input), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('The request has not been confirmed. Refresh the registry before retrying.')), 15000); })]);
      if (!result?.success) throw new Error(result?.error || 'The sensor request was not confirmed.');
      return result.data;
    } finally { clearTimeout(timer); }
  }
  function download(blob, name) { const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  function openTopConsumers() {
    if (consumersView?.dialog.open) return;
    const names={buildings:'Building Name',floors:'Floor Level',rooms:'Room / Facility Name',sensors:'AC Sensor Unit',airconTypes:'Aircon Equipment Type'};
    const {dialog}=openReferenceDialog('sensorConsumersTemplate','topConsumersModalTitle');dialog.classList.add('sensor-reference-consumers');
    const content=dialog.querySelector('#sensorConsumerContent'),status=dialog.querySelector('#sensorConsumerState');
    let abort=null,loadRevision=0,disposed=false,category='buildings',totalEnergy=null,rate=null;
    let rankings={buildings:[],floors:[],rooms:[],sensors:[],airconTypes:[]};
    const dispose=()=>{disposed=true;++loadRevision;abort?.abort();if(consumersView?.dialog===dialog)consumersView=null;};
    consumersView={dialog,dispose};dialog.addEventListener('close',dispose,{once:true});
    const active=()=>!disposed&&dialog.open&&dialog.isConnected;
    const showState=(phase,title,message,action='')=>{
      content.hidden=true;status.hidden=false;status.dataset.phase=phase;status.setAttribute('role',phase==='error'?'alert':'status');
      dialog.setAttribute('aria-busy',String(phase==='loading'));
      status.innerHTML=(phase==='loading'?'<span class="sensor-consumer-spinner" aria-hidden="true"></span>':'')+'<h3>'+esc(title)+'</h3><p>'+esc(message)+'</p>'+(action?'<p class="sensor-consumer-action">'+esc(action)+'</p>':'')+(phase!=='loading'?'<button type="button" class="sensor-button primary" data-consumer-retry>Retry</button>':'');
      status.querySelector('[data-consumer-retry]')?.addEventListener('click',()=>void load({force:true}));
      $('modalScopeTotalKwh').textContent=phase==='loading'?'Loading…':'—';$('modalScopeTotalCost').textContent='—';
    };
    function scope(params){
      const date=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
      const from=date(params.get('from')),through=date(Date.parse(params.get('to'))-1);
      $('modalScopePeriod').textContent=period+' · '+(from===through?from:from+' to '+through)+' · '+($('sensorSelect').selectedOptions[0]?.textContent || 'All AC Devices')+' · '+(params.get('start_time') || '00:00')+'–'+(params.get('end_time') || '24:00')+' (UTC+08:00)';
      rate=tariff();$('modalScopeTariff').textContent=rate===null?'Not configured':'₱'+num(rate,2)+' / kWh';
    }
    function renderRankings(result){
      totalEnergy=result.energy_kwh;
      const devices=(Array.isArray(result.devices)?result.devices:[]).filter(device=>device&&device.node_id&&Number.isFinite(device.energy_kwh)&&device.energy_kwh>=0);
      if(!devices.length){showState('empty','No eligible energy rankings',result.reason || 'No device has covered energy readings in this selection.','Choose a period with continuous eligible sensor readings, then retry.');return;}
      rankings={buildings:[],floors:[],rooms:[],sensors:[],airconTypes:[]};
      for(const category of Object.keys(rankings)){
        const groups=new Map();for(const device of devices){
          const parts=(device.location || '').split(/[·•]/).map(part=>part.trim()).filter(Boolean);
          const key=category==='sensors'?device.node_id:category==='airconTypes'?device.aircon_type || 'Type unavailable':parts.length===3?parts.slice(0,{buildings:1,floors:2,rooms:3}[category]).join(' / '):'Location unavailable';
          const label=category==='sensors'?device.sensor_name || 'AC device name unavailable':key;
          const value=groups.get(key) || {name:label,energy:0};value.energy+=device.energy_kwh;groups.set(key,value);
        }rankings[category]=[...groups.values()].sort((a,b)=>b.energy-a.energy || a.name.localeCompare(b.name));
      }
      status.hidden=true;content.hidden=false;dialog.setAttribute('aria-busy','false');
      $('modalScopeTotalKwh').textContent=num(totalEnergy,3)+' kWh · experimental';$('modalScopeTotalCost').textContent=rate===null?'Tariff unavailable':'₱'+num(totalEnergy*rate,2);
      for(const [category,key] of Object.entries({buildings:'Building',floors:'Floor',rooms:'Room',sensors:'Control',airconTypes:'AirconType'})){
        const top=rankings[category][0];if(!top)continue;$('top'+key+'Name').textContent=top.name;$('top'+key+'Name').title=top.name;$('top'+key+'Kwh').textContent=num(top.energy,3);$('top'+key+'Kwh').nextElementSibling.hidden=false;
        $('top'+key+'Cost').textContent=rate===null?'Tariff unavailable':'₱'+num(top.energy*rate,2);$('top'+key+'Share').textContent=totalEnergy>0?num(top.energy/totalEnergy*100,1)+'%':'Share unavailable';$('top'+key+'Share').hidden=false;
      }
      $('sensorConsumerNote').textContent=result.reason || 'Estimates use eligible recorded AC intervals; physical accuracy is unverified.';
      activate(buttons.find(button=>button.dataset.category===category)||buttons[0]);
    }
    async function load({force=false}={}){
      abort?.abort();abort=new AbortController();const signal=abort.signal,id=++loadRevision;
      showState('loading','Loading energy rankings…','Please wait while energy estimates for the selected devices and period are checked.');
      try{
        const params=query(),selection=params.toString();scope(params);
        const cached=!force&&!running&&available&&energySelection===selection&&energy&&typeof energy.reason==='string';
        const result=cached?energy:await request('/energy?'+params,{signal});
        if(!active()||id!==loadRevision)return;
        if(query().toString()!==selection){void load({force:true});return;}
        if(!result?.available||!Number.isFinite(result.energy_kwh)||result.energy_kwh<0){
          const action=({SENSOR_REFERENCE_DISABLED:'Ask your administrator about enabling experimental sensor estimates, then retry.',SENSOR_MODEL_UNAVAILABLE:'Restart the local backend, then retry.',SENSOR_WINDOW_TOO_LARGE:'Choose a shorter date range, then reopen Top Consumers.',SENSOR_REFERENCE_NO_COVERAGE:'Choose a period with continuous eligible sensor readings, then retry.',SENSOR_REFERENCE_HISTORY_UNAVAILABLE:'Choose a period with at least one minute of recorded settings, then retry.',CONTROL_HISTORY_UNAVAILABLE:'Choose a period with one minute of continuous eligible recorded AC readings, then retry.',ENERGY_MODEL_UNAVAILABLE:'Restart the local backend to load the controls model, then retry.'})[result?.code] || 'Check the selected devices and date range, then retry.';
          showState('empty','Energy rankings are not ready',result?.reason || 'No valid energy estimates are available for this selection.',action);return;
        }
        renderRankings(result);
      }catch(failure){
        if(!active()||id!==loadRevision||signal.aborted)return;
        showState('error','Could not load energy rankings',failure.name==='AbortError'?'The local backend took too long to respond.':failure.message,'Check the local backend connection, then retry.');
      }
    }
    const buttons=[...dialog.querySelectorAll('[data-category]')],panel=$('topConsumersTableBody').closest('.eco-table-frame');
    panel.id='sensorConsumerPanel';panel.setAttribute('role','tabpanel');panel.tabIndex=0;$('consumersTabContainer').setAttribute('role','tablist');$('consumersTabContainer').setAttribute('aria-label','Consumer categories');
    const activate=button=>{category=button.dataset.category;buttons.forEach(item=>{const active=item===button;item.classList.toggle('active',active);item.setAttribute('aria-selected',String(active));item.tabIndex=active?0:-1;});$('leaderboardNameHeader').textContent=names[category];panel.setAttribute('aria-labelledby',button.id);
      $('topConsumersTableBody').innerHTML=rankings[category].slice(0,50).map((item,index)=>'<tr><td>'+(index+1)+'</td><td>'+esc(item.name)+'</td><td>'+(totalEnergy>0?num(item.energy/totalEnergy*100,1)+'%':'—')+'</td><td>'+num(item.energy,3)+'</td><td>'+(rate===null?'Tariff unavailable':'₱'+num(item.energy*rate,2))+'</td><td>Experimental</td></tr>').join('');};
    buttons.forEach((button,index)=>{
      button.id='sensorConsumerTab-'+button.dataset.category;button.setAttribute('role','tab');button.setAttribute('aria-controls',panel.id);
      button.addEventListener('click',()=>activate(button));button.addEventListener('keydown',event=>{const offset=event.key==='ArrowRight'?1:event.key==='ArrowLeft'?-1:null;const next=event.key==='Home'?buttons[0]:event.key==='End'?buttons.at(-1):offset===null?null:buttons[(index+offset+buttons.length)%buttons.length];if(next){event.preventDefault();activate(next);next.focus();}});
    });activate(buttons[0]);void load();
  }
  function showExportProgress(format, abort) {
    const prior=document.activeElement, dialog=document.createElement('dialog');
    dialog.id='downloadModal';dialog.className='sensor-download-dialog';dialog.setAttribute('aria-labelledby','downloadModalTitle');dialog.setAttribute('aria-describedby','downloadModalSubtitle');
    dialog.innerHTML='<div class="sensor-download-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2"><polyline points="8 17 12 21 16 17"/><path d="M12 12v9M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"/></svg></div><h3 id="downloadModalTitle"></h3><p id="downloadModalSubtitle" aria-live="polite">Reading selected sensor logs…</p><div class="sensor-download-divider"></div><div class="sensor-download-label"><span>Progress</span><strong id="downloadProgressPercent">0%</strong></div><div class="sensor-download-track" role="progressbar" aria-label="Export preparation" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div id="downloadProgressBar" style="width:0%"></div></div><button type="button" id="cancelDownloadBtn">Cancel</button>';
    dialog.querySelector('h3').textContent=format==='pdf'?'Generating PDF':'Generating Excel';
    const cancel=()=>abort.abort();dialog.querySelector('button').addEventListener('click',cancel);dialog.addEventListener('cancel',event=>{event.preventDefault();cancel();});
    document.body.append(dialog);dialog.showModal();let last=0;
    return {
      update(value,text){last=Math.max(last,Math.min(100,value));dialog.querySelector('#downloadProgressBar').style.width=last+'%';dialog.querySelector('#downloadProgressPercent').textContent=last+'%';dialog.querySelector('[role="progressbar"]').setAttribute('aria-valuenow',last);dialog.querySelector('#downloadModalSubtitle').textContent=text;},
      close(){dialog.close();dialog.remove();prior?.focus?.();}
    };
  }
  async function readExportRows(params, signal, onProgress) {
    const rows = [], seen = new Set(); let total = null, snapshot = null;
    for (let page = 1; ; page++) {
      if (signal.aborted) throw new DOMException('Export cancelled.', 'AbortError');
      const batch = await request('/telemetry?' + params + `&page=${page}&per_page=200`, {signal});
      if (!Array.isArray(batch.items) || !Number.isSafeInteger(batch.total) || batch.total < 0) throw new Error('Invalid sensor history response. Refresh and retry the export.');
      if (total !== null && total !== batch.total) throw new Error('Sensor history changed during export. Refresh and retry.');
      total = batch.total;
      if (page === 1 && batch.snapshot != null) { snapshot = String(batch.snapshot); params.set('snapshot', snapshot); }
      else if (snapshot !== null && String(batch.snapshot) !== snapshot) throw new Error('Sensor history snapshot changed. Refresh and retry the export.');
      for (const row of batch.items) {
        if (typeof row.id !== 'string' || !row.id || seen.has(row.id)) throw new Error('Sensor history contains missing or duplicate records. Refresh and retry the export.');
        seen.add(row.id); rows.push(row);
      }
      if (rows.length > total || !batch.items.length && rows.length < total) throw new Error('Sensor history is incomplete. Refresh and retry the export.');
      onProgress(total ? 10 + Math.round(40 * rows.length / total) : 50);
      if (rows.length === total) return rows;
    }
  }
  async function exportLogs(format) {
    if (exporting || !['pdf', 'xlsx'].includes(format)) return;
    exporting = true; let exportedCount = 0;
    const abort=new AbortController();exportController=abort;
    const buttons = [...document.querySelectorAll('[data-export]')]; buttons.forEach(button => { button.disabled = true; });
    const progress=showExportProgress(format,abort), signal=abort.signal;
    const checkCancelled=()=>{if(signal.aborted)throw new DOMException('Export cancelled.','AbortError');};
    const yieldUI=()=>new Promise(resolve=>setTimeout(resolve,32));
    progress.update(5,'Reading selected sensor logs…');
    $('sensorExportStatus').textContent = 'Preparing recorded sensor logs…';
    try {
      const params = query(), selection = params.toString();
      {
        const rows = await readExportRows(params, signal, value => progress.update(value, 'Reading selected sensor logs…'));
        const [reportStats,reportEnergy]=await Promise.all([request('/analytics?'+params,{signal}),request('/energy?'+params,{signal}).catch(failure=>{checkCancelled();return {available:false,reason:'The energy estimator was unavailable when this report was generated.'};})]);
        checkCancelled();progress.update(65,'Preparing report summary…');await yieldUI();checkCancelled();
        if (query().toString() !== selection) throw new Error('Selection changed. Export the current selection again.');
        exportedCount = rows.length;
        const headings = logHeadings, body = rows.map(logValues);
        const report={rows,headings,values:body,stats:reportStats,energy:reportEnergy,generated:new Date(),date:observationDate,period,
          scope:$('sensorSelect').selectedOptions[0]?.textContent || 'All AC Devices',
          time:[$('sensorTimeStart')?.value || 'Start of day',$('sensorTimeEnd')?.value || 'End of day'].join(' to '),
          rate:tariff(),provider:localStorage.getItem('ecoTrack_utility_provider')?.trim() || 'Not configured',
          filters:Object.fromEntries(params),devices:selected().map(node=>({id:node.id,device_id:node.device_id||node.aircon_device_id||null,name:node.name,aircon_name:node.aircon_name,aircon_id:node.aircon_id,created_at:node.created_at,sensor_config:airflowConfigs()[node.id]}))};
        if(period!=='daily'){
          const dateLabel=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
          report.date=dateLabel(params.get('from'))+' to '+dateLabel(Date.parse(params.get('to'))-1);
        }
        if (!window.EcoTrackSensorReports) throw new Error('The sensor report library is unavailable. Reload and retry.');
        report.futureCost=await window.EcoTrackFutureCost?.capture({context:sensorFutureCostContext(reportEnergy),signal:abort.signal});
        progress.update(72,'Reading Rules Management results…');
        report.ruleAudit=window.EcoTrackReportRules?await window.EcoTrackReportRules.load(report,{signal}):{available:false,reason:'Reload the page to load Rules Management reporting.',rules:[],events:[],rooms:[],ruleRanking:[]};
        if(query().toString()!==selection)throw new Error('Selection changed. Export the current selection again.');
        let blob;progress.update(80,format==='pdf'?'Creating your monitoring report…':'Building spreadsheet logs…');await yieldUI();checkCancelled();
        if (format === 'pdf') {
          if (!window.jspdf?.jsPDF) throw new Error('Local PDF library unavailable.');
          blob=window.EcoTrackSensorReports.pdf(report).output('blob');
        } else {
          if (!window.ExcelJS?.Workbook) throw new Error('Local Excel library unavailable.');
          const workbook=window.EcoTrackSensorReports.excel(report);
          blob=new Blob([await workbook.xlsx.writeBuffer()],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
        }
        checkCancelled();progress.update(100,'Ready to download');await yieldUI();checkCancelled();
        download(blob,`EcoTrack_AC_Energy_Report_${report.date.replace(/ to /g,'_to_')}.${format}`);
      }
      $('sensorExportStatus').textContent = exportedCount ? 'Export prepared from recorded measurements.' : 'Export prepared with column headers. No sensor readings in this period.';
    } catch (failure) { $('sensorExportStatus').textContent = signal.aborted ? 'Export cancelled.' : failure.message; }
    finally { abort.abort();exportController=null;exporting = false; buttons.forEach(button => { button.disabled = false; });progress.close(); }
  }
  document.addEventListener('DOMContentLoaded', () => {
    build();
    // Analytics can paint cached data before its optional chart renderer arrives.
    document.querySelector('script[data-sensor-charts]')?.addEventListener('load', render, { once: true });
    if(page==='logs')window.EcoTrackFutureCost?.configure({source:'sensor',context:sensorFutureCostContext});
    $('sensorFleet')?.addEventListener('scroll',()=>{if(loaded && !running && !$('sensorApp').hidden)fleetPosition={location:locationFilter || '',top:$('sensorFleet').scrollTop};},{passive:true});
    $('sensorTariff')?.addEventListener('click', openTariff);
    $('openTopConsumersModalBtn')?.addEventListener('click', openTopConsumers);
    restoreSnapshot(); render(); refresh();
    $('sensorRefresh').addEventListener('click', () => refresh());
    window.initializeResponsiveSidebar?.();
    let timer;
    const startPolling = () => { clearInterval(timer); timer = setInterval(() => { if (!document.hidden) refresh({ poll: true }); }, page === 'telemetry' ? 2000 : 5000); };
    startPolling();
    window.addEventListener('pagehide', () => { saveView(); revision++; running = false; clearInterval(timer); clearTimeout(errorClearTimer); heartbeatController?.abort(); if (heartbeatChannel) window.supabaseClient?.removeChannel?.(heartbeatChannel); heartbeatChannel = null; heartbeatScope = ''; heartbeatChecked = 0; heartbeatInFlight = false; controller?.abort();exportController?.abort();consumersView?.dispose(); consumersView = null; charts.forEach(chart => chart.destroy()); charts.clear(); $('sensorDialog')?.remove(); });
    window.addEventListener('pageshow', event => { if (event.persisted) { startPolling(); render(); refresh(); } });
    const resume = () => { if (!document.hidden) { heartbeatChecked = 0; refresh({ poll: true }); } };
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('theme:changed', render);
  });
})();
