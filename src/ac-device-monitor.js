'use strict';
// Mirror authenticated registration metadata only. No status, sample or power feedback is synthesized.
const { requestMonitoring } = require('./monitoring-local');
const REGISTRY_COLUMNS = {
  nodes:'id,name,device_mode,monitoring_id,monitor_aircon_id,room_id,interval_unit,interval_val',
  aircons:'id,name,asset_tag,aircon_type', rooms:'id,name,floor_id',
  floors:'id,name,building_id', buildings:'id,name'
};
function registryError(message, code) { return Object.assign(new Error(message), {code}); }
async function readRegistryTable(client, table, signal, {ids, roles} = {}) {
  if (ids && !ids.length) return [];
  if (ids?.length > 100) {
    const records = [];
    for (let offset = 0; offset < ids.length; offset += 100)
      records.push(...await readRegistryTable(client, table, signal, {ids:ids.slice(offset, offset + 100), roles}));
    return records;
  }
  const records = [], seen = new Set();
  let expected;
  do {
    if (signal.aborted) throw signal.reason;
    // Registry reconciliation never needs IR frames, photos, telemetry or profile state.
    let query = client.from(table).select(REGISTRY_COLUMNS[table], { count: 'exact' });
    // The dashboard retries on its polling cadence; SDK backoff must not consume this deadline.
    if (typeof query.retry === 'function') query = query.retry(false);
    if (typeof query.in === 'function') {
      if (roles) query = query.in('device_mode', roles);
      if (ids) query = query.in('id', ids);
    }
    const paged = typeof query.range === 'function';
    if (paged) query = query.order('id', { ascending: true }).range(records.length, records.length + 499);
    if (typeof query.abortSignal === 'function') query = query.abortSignal(signal);
    const result = await query;
    if (signal.aborted) throw signal.reason;
    if (result.error || !Array.isArray(result.data)) throw registryError('Registered AC device metadata is unavailable ('+table+'). Check the connection and retry.', 'REGISTRY_METADATA_UNAVAILABLE');
    if (paged && (!Number.isInteger(result.count) || result.count < 0 || expected !== undefined && expected !== result.count))
      throw registryError('The registered AC device snapshot was incomplete or changed. Retry the refresh.', 'REGISTRY_SNAPSHOT_INCOMPLETE');
    expected = paged ? result.count : result.data.length;
    for (const row of result.data) {
      if (!row.id || seen.has(row.id)) throw registryError('The registered AC device snapshot contains conflicting identities.', 'REGISTRY_SNAPSHOT_INCOMPLETE');
      seen.add(row.id); records.push(row);
    }
    if (records.length > expected || !result.data.length && records.length < expected)
      throw registryError('The registered AC device snapshot was incomplete. Retry the refresh.', 'REGISTRY_SNAPSHOT_INCOMPLETE');
  } while (records.length < expected);
  return records;
}
const pendingSyncs = new WeakMap();
function syncRegisteredMonitors(client, options = {}) {
  if (!client || typeof client.from !== 'function')
    return Promise.reject(registryError('Registered AC device metadata is unavailable. Sign in and check the database connection before retrying.', 'REGISTRY_METADATA_UNAVAILABLE'));
  if (pendingSyncs.has(client)) return pendingSyncs.get(client);
  const task = reconcileRegisteredMonitors(client, options).finally(() => pendingSyncs.delete(client));
  pendingSyncs.set(client, task);
  return task;
}
async function reconcileRegisteredMonitors(client, options) {
  const controller = new AbortController();
  let timeout;
  const timeoutMs = Math.min(8000, Math.max(1, Number(options.metadataTimeoutMs) || 8000));
  const deadline = new Promise((_, reject) => { timeout = setTimeout(() => {
    const error = registryError('Registered AC device metadata timed out. Previously recorded devices remain available; check the connection and refresh to retry.', 'REGISTRY_METADATA_TIMEOUT');
    controller.abort(error); reject(error);
  }, timeoutMs); });
  const loadSnapshot = async () => {
    const devices = (await readRegistryTable(client, 'nodes', controller.signal, {roles:['monitoring','both']}))
      .filter(node => ['monitoring','both'].includes(node.device_mode));
    // A verified empty monitoring selection is authoritative; unrelated tables cannot delay it.
    if (!devices.length) return [[],[],[],[],[]];
    const ids = field => [...new Set(devices.map(node => node[field]).filter(Boolean))];
    const roomIds = ids('room_id');
    const [aircons,rooms,floors,buildings] = await Promise.all([
      readRegistryTable(client, 'aircons', controller.signal, {ids:ids('monitor_aircon_id')}),
      readRegistryTable(client, 'rooms', controller.signal, {ids:roomIds}),
      roomIds.length ? readRegistryTable(client, 'floors', controller.signal) : [],
      roomIds.length ? readRegistryTable(client, 'buildings', controller.signal) : []
    ]);
    return [devices,aircons,rooms,floors,buildings];
  };
  let tables;
  try {
    tables = await Promise.race([loadSnapshot(), deadline]);
  } catch (error) {
    // Stop sibling requests as soon as this snapshot cannot be trusted. Never reconcile it.
    controller.abort(error);
    throw error;
  } finally { clearTimeout(timeout); }
  const [devices, aircons, rooms, floors, buildings] = tables;
  const entries = [];
  for (const node of devices.filter(node => ['monitoring','both'].includes(node.device_mode))) {
    if (!node.monitoring_id || !node.monitor_aircon_id) throw new Error('Registered sensor configuration is incomplete.');
    const ac = aircons.find(ac => ac.id === node.monitor_aircon_id);
    if (!ac) throw new Error('Registered sensor configuration is incomplete.');
    const room = rooms.find(room => room.id === node.room_id), floor = floors.find(floor => floor.id === room?.floor_id), building = buildings.find(building => building.id === floor?.building_id);
    const path = [building?.name, floor?.name, room?.name];
    const data = {name:node.name,aircon_id:ac.id,aircon_name:ac.name || ac.asset_tag || ac.id,aircon_type:ac.aircon_type || null,location:path.every(Boolean) ? path.join(' · ') : ''};
    const multiplier = {seconds:1,minutes:60,hours:3600}[String(node.interval_unit || '').toLowerCase()];
    const seconds = Number(node.interval_val) * multiplier;
    if (Number.isFinite(seconds) && seconds >= 1 && seconds <= 86400) data.expected_interval_seconds = seconds;
    entries.push({ id: node.monitoring_id, registry_node_id: node.id, device: data });
  }
  const result = await requestMonitoring({action:'reconcile',data:{devices:entries}}, {...options,trustedImport:true});
  return {success:true,data:{changed:result.data.changed}};
}
module.exports = { syncRegisteredMonitors };
