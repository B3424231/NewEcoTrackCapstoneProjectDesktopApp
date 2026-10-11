import type { SensorData } from './supabase';
import { connectionStatus, type CloudDeviceState } from './cloud-hardware';
import { remoteObservation, selectSettings } from './receiver-state';

const enabled = (value: unknown) => value === true || value === 'on' || value === 1;
export function applyHomeControllerState(item: SensorData, row?: CloudDeviceState | null, now = Date.now()): SensorData {
  if (row && row.node_id !== item.id) return item;
  if (row && Date.parse(row.last_seen || '') < Date.parse(item.lastSeen || '')) return item;
  const snapshot = row ? { ...item.settingsSnapshot, ...remoteObservation(row.latest_ir, row.last_seen, item.settingsSnapshot) } : item.settingsSnapshot;
  const settings = selectSettings(snapshot || null).state;
  const connection = row ? connectionStatus(row, now) : item.lastSeen
    ? connectionStatus({ node_id: item.id, device_id: item.serialNumber || '', last_seen: item.lastSeen, sleeping_until: item.sleepingUntil }, now)
    : 'unavailable';
  const power = settings?.power === true || settings?.power === 'on' ? 'on' : settings?.power === false || settings?.power === 'off' ? 'off' : undefined;
  const functions = [
    ['Vertical swing', settings?.swing_vertical ?? settings?.swing],
    ['Horizontal swing', settings?.swing_horizontal],
    ['Turbo', settings?.turbo], ['Eco', settings?.eco], ['Quiet', settings?.quiet],
    ['Sleep', settings?.sleep], ['Display', settings?.display], ['Clean', settings?.clean], ['I Feel', settings?.i_feel],
  ].filter(([, value]) => enabled(value)).map(([label]) => String(label));
  const summary = [power?.toUpperCase(), settings?.mode?.toUpperCase(), settings?.fan ? String(settings.fan).toUpperCase() + ' FAN' : undefined].filter(Boolean).join(' · ') || '—';
  return { ...item, connectionState: connection, statusLabel: connection === 'unavailable' ? 'Status unavailable' : connection[0].toUpperCase() + connection.slice(1),
    settingsSnapshot: snapshot, lastSeen: row?.last_seen || item.lastSeen, sleepingUntil: row ? row.sleeping_until : item.sleepingUntil,
    serialNumber: row?.device_id || item.serialNumber, model: row?.firmware_version ? item.model : item.model,
    powerSetting: power, operatingMode: settings?.mode, fanMode: settings?.fan,
    setpoint: typeof settings?.temp === 'number' && Number.isFinite(settings.temp) ? settings.temp : undefined,
    specialFunctions: functions, airconState: summary, aircon: summary,
    rssi: row?.rssi ?? item.rssi,
    battery: typeof row?.battery === 'number' && Number.isFinite(row.battery) && row.battery >= 0 && row.battery <= 100 ? Math.round(row.battery) + '%' : item.battery,
  };
}
export function mergeHomeControllerFetch(fetched: SensorData[], current: SensorData[]): SensorData[] {
  return fetched.map(item => {
    const latest = current.find(previous => previous.id === item.id && previous.roomId === item.roomId);
    return latest && Date.parse(latest.lastSeen || '') > Date.parse(item.lastSeen || '')
      ? applyHomeControllerState({ ...item, ...Object.fromEntries(Object.entries(latest).filter(([key]) =>
        ['lastSeen','sleepingUntil','settingsSnapshot'].includes(key))) })
      : item;
  });
}
