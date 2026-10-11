import { imageReference, displayImage, clearImageCache, isImageSignature } from './private-images';
import { createAuthService } from './auth-service';
import { updateMaintenanceReportRpc, submitRepairRpc, type MaintenanceUpdateParams, type MaintenanceMutationContext } from './maintenance-rpc';
import { Platform } from 'react-native';
import { exactMatchFilter, fetchAccessibleRows, type ReadScope } from './query-utils';
import { isChecklistItemComplete, isRepairDone, isRepairAwaitingVerification } from './maintenance-status';
import { describeAirconState } from './aircon-state';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

// AC Controller & Telemetry Data Model
export interface SensorData {
  id: string;
  name: string;
  value: string;
  status: 'optimal' | 'warning' | 'critical';
  statusLabel: string;
  details: string;
  location: string;
  aircon?: string;
  ventTemp?: string;
  pressure?: string;
  battery?: string;
  building?: string;
  floor?: string;
  room?: string;
  sensorName?: string;
  acType?: string;
  acId?: string;
  activeReportId?: string;
  maintenanceStatus?: string;
  maintenancePriority?: 'High' | 'Medium' | 'Low';
  // Desktop middle telemetry properties
  wakeTime?: string;
  sleepTime?: string;
  interval?: string;
  rssi?: number | null;
  signalStrengthLabel?: string;
  signalStrengthDbm?: string;
  airconState?: string;
  updatedTime?: string;
  roomId?: string | null;
  isAssignedToRoom?: boolean;
  // Admin Desktop Parity
  brand?: string;
  airconBrand?: string;
  associatedAc?: string;
  model?: string;
  serialNumber?: string;
  pirOccupancy?: string;
  dailySchedule?: string;
}

export type AcControllerData = SensorData;

// Supabase Connection Credentials
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn(
    '[Supabase] Warning: EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY is missing. Ensure your .env file is properly configured.'
  );
}

// Native AsyncStorage works without a browser window; SSR must not fabricate one.
const isClient = Platform.OS !== 'web' || typeof window !== 'undefined';
const ssrSafeAuthStorage = {
  getItem: (key: string) => isClient ? AsyncStorage.getItem(key) : Promise.resolve(null),
  setItem: (key: string, value: string) => isClient ? AsyncStorage.setItem(key, value) : Promise.resolve(),
  removeItem: (key: string) => isClient ? AsyncStorage.removeItem(key) : Promise.resolve(),
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: ssrSafeAuthStorage,
    autoRefreshToken: isClient,
    persistSession: isClient,
    detectSessionInUrl: false,
  },
});

supabase.auth.onAuthStateChange?.(() => clearImageCache(supabase));

const STAFF_PROFILE_COLUMNS = 'id,name,email,phone,role,status,room_id,room_name,floor_name,building_name,assignment,is_archived,force_logout,avatar,photo_url,avatar_url,updated';

// Database Models
export interface DbNode {
  id: string;
  name: string;
  status: string;
  temp: number | null;
  pressure: number | null;
  rssi: number | null;
  battery: number | null;
  wake_time: string | null;
  sleep_time: string | null;
  interval_val: number | null;
  interval_unit: string | null;
  room_id: string | null;
  aircon_type: string | null;
  brand?: string | null;
  mac_address?: string | null;
  ip_address?: string | null;
  wifi_ssid?: string | null;
  protocol_name?: string | null;
  install_date: string | null;
  created: string;
  updated: string;
  photo_url?: string | null;
  image_url?: string | null;
}

export interface DbAircon {
  id: string;
  asset_tag: string;
  brand: string;
  model?: string | null;
  aircon_type?: string | null;
  room_id?: string | null;
  node_id?: string | null;
  protocol?: string | null;
  protocol_name?: string | null;
  status: string;
  created_at?: string;
  updated_at?: string;
}

export interface DbRoom {
  id: string;
  name: string;
  node_limit: number | null;
  floor_id: string | null;
  admin_id: string | null;
  created: string;
  updated: string;
}

export interface DbFloor {
  id: string;
  name: string;
  building_id: string | null;
  created: string;
  updated: string;
}

export interface DbBuilding {
  id: string;
  name: string;
  admin_id: string | null;
  created: string;
  updated: string;
}

export interface DbNotification {
  id: string;
  date: string;
  time: string;
  content: string;
  triggered: boolean;
  room_id: string | null;
  rule_id: string | null;
  admin_id: string | null;
  created: string;
  updated: string;
}

export interface DbStaff {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  password?: string | null;
  role?: string | null;
  building_name?: string | null;
  floor_name?: string | null;
  room_name?: string | null;
  room_id?: string | null;
  status: string | null;
  is_archived?: boolean | null;
  archive_reason?: string | null;
  archive_notes?: string | null;
  archived_at?: string | null;
  last_active: string | null;
  created: string;
  updated: string;
}

// Helper to reliably detect if a staff account has been archived by the administrator
export function isStaffArchived(staff: any): boolean {
  if (!staff) return false;
  const isExplicitlyArchived = staff.is_archived === true || staff.is_archived === 'true';
  const hasArchivedAt =
    typeof staff.archived_at === 'string' &&
    staff.archived_at.trim().length > 0 &&
    staff.archived_at !== 'null';
  const hasArchiveReason =
    typeof staff.archive_reason === 'string' &&
    staff.archive_reason.trim().length > 0 &&
    staff.archive_reason !== 'null';
  const hasArchivedStatus =
    staff.status?.toLowerCase() === 'archived' ||
    staff.status?.toLowerCase() === 'deactivated';

  return Boolean(isExplicitlyArchived || hasArchivedAt || hasArchiveReason || hasArchivedStatus);
}

export interface DbTelemetry {
  id: string;
  node_id?: string | null;
  sensor_name: string;
  room_name?: string | null;
  floor_name?: string | null;
  building_name?: string | null;
  aircon_type?: string | null;
  temperature: number;
  pressure: number;
  battery: number;
  rssi: number;
  status: string;
  created: string;
}

export interface DbAdministrator {
  id: string;
  username: string;
  email: string;
  password?: string;
  role: string;
  is_active: boolean;
  last_login: string | null;
  created: string;
  updated: string;
}

export interface AppUser {
  authUserId?: string;
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  userType: 'admin' | 'staff';
  assignment?: string;
  avatar?: 'default' | 'male' | 'female' | 'custom';
  photoUrl?: string | null;
  buildingName?: string;
  floorName?: string;
  roomName?: string;
  isArchived?: boolean;
  archiveReason?: string | null;
  archiveNotes?: string | null;
  archivedAt?: string | null;
}

// Convert Battery Voltage (e.g. 4.08V, 4.15V, 4.2V) or raw value to percentage string matching desktop
function formatBatteryPercent(battery: number | null | undefined): string {
  if (battery == null) return '—';
  if (battery <= 5) {
    // Desktop battery formula: percentage of 4.2V max voltage (e.g. 4.08V -> 97%, 4.15V -> 99%, 4.18V -> 100%)
    const pct = Math.min(100, Math.max(0, Math.round((battery / 4.2) * 100)));
    return `${pct}%`;
  }
  return `${Math.min(100, Math.max(0, Math.round(battery)))}%`;
}

// Format temperature string for display matching desktop (e.g. '24.5 °C')
function formatTemperature(tempC: number | null | undefined): { fahrenheit: string; celsius: string } {
  if (tempC == null) return { fahrenheit: '—', celsius: '—' };
  const f = ((tempC * 9) / 5 + 32).toFixed(1);
  const c = typeof tempC === 'number' ? `${tempC.toFixed(1)} °C` : `${tempC} °C`;
  return { fahrenheit: `${f} °F`, celsius: c };
}

// Format 24-hour time to 12-hour AM/PM string (e.g. '06:00' -> '6:00 AM')
export function formatTimeAmPm(timeStr?: string | null): string {
  if (!timeStr) return '--:--';
  const parts = timeStr.split(':');
  if (parts.length < 2) return timeStr;
  let hours = parseInt(parts[0], 10);
  const minutes = parts[1];
  if (isNaN(hours)) return timeStr;
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  return `${hours}:${minutes} ${ampm}`;
}

// Format power-cycle timing cadence interval (e.g. 1, 'Hours' -> '1 hr')
export function formatInterval(val?: number | null, unit?: string | null): string {
  if (val == null) return '--';
  const cleanUnit = (unit || 'Minutes').toLowerCase();
  if (cleanUnit.startsWith('hour')) {
    return `${val} hr`;
  }
  return `${val} min`;
}

// Format signal strength label and dBm text from RSSI
export function formatSignalStrength(rssi?: number | null): { label: string; text: string; quality: 'weak' | 'fair' | 'strong' } {
  if (rssi == null) return { label: '—', text: '—', quality: 'weak' };
  const val = Number(rssi);
  let label = 'WEAK';
  let quality: 'weak' | 'fair' | 'strong' = 'weak';
  if (val >= -65) {
    label = 'STRONG';
    quality = 'strong';
  } else if (val >= -78) {
    label = 'GOOD';
    quality = 'fair';
  } else {
    label = 'WEAK';
    quality = 'weak';
  }
  return { label, text: `${val} dBm`, quality };
}

// Format ISO timestamp to local time string (e.g. '09:07:13 PM')
export function formatUpdatedTime(isoStr?: string | null): string {
  if (!isoStr) return '';
  try {
    const d = new Date(isoStr);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  } catch {
    return '';
  }
}

// Active Room Details interface for desktop middle panel sync
export interface ActiveRoomData {
  id: string;
  name: string;
  floorName: string;
  buildingName: string;
  nodeLimit: number;
  assignedCount: number;
  capacityPercentage: number;
}

// Worker Assignment Verification Result
export interface WorkerAssignmentResult {
  isAssigned: boolean;
  roomId: string | null;
  roomName: string;
  floorName: string;
  buildingName: string;
  assignmentText: string;
}

// Dynamically verify and resolve worker's room assignment against active database hierarchy.
// If the assigned room, floor, or building was erased/deleted by an admin, the worker is automatically assigned as "Unassigned".
export async function resolveWorkerAssignment(
  workerIdentifier?: string, scope?: ReadScope
): Promise<WorkerAssignmentResult> {
  try {
    const cleanId = (workerIdentifier || '').trim();
    if (!cleanId) return { isAssigned: false, roomId: null, roomName: 'Unassigned', floorName: '', buildingName: '', assignmentText: 'Unassigned' };

    const [staffRes, roomsRes, floorsRes, buildingsRes] = await Promise.all([
      cleanId
        ? supabase
          .from('staff')
          .select(STAFF_PROFILE_COLUMNS)
          .or(exactMatchFilter(['id', 'email', 'phone', 'name'], cleanId))
          .limit(1)
        : supabase.from('staff').select(STAFF_PROFILE_COLUMNS).order('created', { ascending: false }).limit(1),
      fetchAccessibleRows(supabase, 'rooms', '*', undefined, scope),
      fetchAccessibleRows(supabase, 'floors', '*', undefined, scope),
      fetchAccessibleRows(supabase, 'buildings', '*', undefined, scope),
    ]);

    scope?.recordError(staffRes.error);
    const staffMember = staffRes.data && staffRes.data.length > 0 ? staffRes.data[0] : null;
    const rooms: DbRoom[] = roomsRes.data || [];
    const floors: DbFloor[] = floorsRes.data || [];
    const buildings: DbBuilding[] = buildingsRes.data || [];

    const floorsMap = new Map<string, DbFloor>();
    floors.forEach((f) => floorsMap.set(f.id, f));

    const buildingsMap = new Map<string, DbBuilding>();
    buildings.forEach((b) => buildingsMap.set(b.id, b));

    // If staff member has no assignment or explicitly unassigned
    if (
      !staffMember ||
      (!staffMember.room_id && !staffMember.room_name && !staffMember.assignment) ||
      staffMember.assignment === 'Unassigned' ||
      staffMember.room_name?.toLowerCase() === 'unassigned'
    ) {
      return {
        isAssigned: false,
        roomId: null,
        roomName: 'Unassigned',
        floorName: '',
        buildingName: '',
        assignmentText: 'Unassigned',
      };
    }

    // Universal assignment check ("All Buildings", "All Floors", "All Rooms")
    const rawBld = (staffMember.building_name || '').trim();
    const rawFlr = (staffMember.floor_name || '').trim();
    const rawRm = (staffMember.room_name || '').trim();
    const rawAssign = (staffMember.assignment || '').trim();
    const rawRoomId = (staffMember.room_id || '').trim();

    const isAllBld = rawBld.toLowerCase().includes('all') || rawAssign.toLowerCase().includes('all building');
    const isAllFlr = rawFlr.toLowerCase().includes('all') || rawAssign.toLowerCase().includes('all floor');
    const isAllRm = rawRm.toLowerCase().includes('all') || rawAssign.toLowerCase().includes('all room') || rawRoomId === 'all_rooms' || rawRoomId === 'ALL';

    if (isAllBld || isAllFlr || isAllRm) {
      const displayBld = isAllBld ? 'All Buildings' : (rawBld || 'All Buildings');
      const displayFlr = isAllFlr ? 'All Floors' : (rawFlr || 'All Floors');
      const displayRm = isAllRm ? 'All Rooms' : (rawRm || 'All Rooms');
      const assignmentText = rawAssign && rawAssign.includes('•')
        ? rawAssign
        : `${displayBld} • ${displayFlr} • ${displayRm}`;

      return {
        isAssigned: true,
        roomId: 'ALL',
        roomName: displayRm,
        floorName: displayFlr,
        buildingName: displayBld,
        assignmentText,
      };
    }

    // Locate matching room in active rooms table
    let matchingRoom: DbRoom | undefined;
    if (staffMember.room_id) {
      matchingRoom = rooms.find((r) => r.id === staffMember.room_id);
    }
    if (!matchingRoom && staffMember.room_name) {
      matchingRoom = rooms.find((r) => r.name.toLowerCase() === staffMember.room_name.toLowerCase());
    }

    // If room does NOT exist (it was erased by admin on desktop)
    if (!matchingRoom) {
      // Missing or inaccessible related data is not evidence of a deleted assignment.
      return {
        isAssigned: false,
        roomId: null,
        roomName: 'Unassigned',
        floorName: '',
        buildingName: '',
        assignmentText: 'Unassigned',
      };
    }

    // Verify parent floor and building exist
    const floor = matchingRoom.floor_id ? floorsMap.get(matchingRoom.floor_id) : undefined;
    const building = floor?.building_id ? buildingsMap.get(floor.building_id) : undefined;

    if (!floor || !building) {
      // Floor or building was erased by admin on desktop
      // Missing or inaccessible related data is not evidence of a deleted assignment.
      return {
        isAssigned: false,
        roomId: null,
        roomName: 'Unassigned',
        floorName: '',
        buildingName: '',
        assignmentText: 'Unassigned',
      };
    }

    const assignmentText = `${building.name} • ${floor.name} • ${matchingRoom.name}`;
    return {
      isAssigned: true,
      roomId: matchingRoom.id,
      roomName: matchingRoom.name,
      floorName: floor.name,
      buildingName: building.name,
      assignmentText,
    };
  } catch (err) {
      scope?.recordError(err);
    console.error('Error resolving worker assignment:', err);
    return {
      isAssigned: false,
      roomId: null,
      roomName: 'Unassigned',
      floorName: '',
      buildingName: '',
      assignmentText: 'Unassigned',
    };
  }
}

// Fetch active room information for worker's assigned room
export async function fetchActiveRoom(assignedRoomId?: string | null, scope?: ReadScope): Promise<ActiveRoomData | null> {
  if (!assignedRoomId) return null;

  if (assignedRoomId === 'ALL' || assignedRoomId === 'all_rooms') {
    try {
      const [roomsRes, nodesRes] = await Promise.all([
        fetchAccessibleRows(supabase, 'rooms', '*', undefined, scope),
        fetchAccessibleRows(supabase, 'nodes', scope ? '*' : 'id, room_id', undefined, scope),
      ]);
      const rooms: DbRoom[] = roomsRes.data || [];
      const nodes: any[] = nodesRes.data || [];
      const totalNodeLimit = rooms.reduce((acc, r) => acc + (r.node_limit || 10), 0) || 50;
      const assignedCount = nodes.length;
      const capacityPercentage = Math.min(100, Math.round((assignedCount / Math.max(1, totalNodeLimit)) * 100));

      return {
        id: 'ALL',
        name: 'All Campus Rooms',
        floorName: 'All Floors',
        buildingName: 'All Buildings',
        nodeLimit: totalNodeLimit,
        assignedCount,
        capacityPercentage,
      };
    } catch (err) {
      scope?.recordError(err);
      console.error('Failed to fetch aggregate room data:', err);
      return {
        id: 'ALL',
        name: 'All Campus Rooms',
        floorName: 'All Floors',
        buildingName: 'All Buildings',
        nodeLimit: 50,
        assignedCount: 0,
        capacityPercentage: 0,
      };
    }
  }

  try {
    const [roomsRes, floorsRes, buildingsRes, nodesRes] = await Promise.all([
      scope
        ? fetchAccessibleRows(supabase, 'rooms', '*', undefined, scope).then(result => ({ ...result, data: result.data?.filter(room => room.id === assignedRoomId) ?? null }))
        : supabase.from('rooms').select('*').eq('id', assignedRoomId),
      fetchAccessibleRows(supabase, 'floors', '*', undefined, scope),
      fetchAccessibleRows(supabase, 'buildings', '*', undefined, scope),
      fetchAccessibleRows(supabase, 'nodes', scope ? '*' : 'id, room_id', scope ? query => query.eq('room_id', assignedRoomId) : undefined, scope, `room:${assignedRoomId}`),
    ]);

    const targetRoom: DbRoom | undefined = (roomsRes.data || [])[0];
    if (!targetRoom) return null;

    const floorsMap = new Map<string, DbFloor>();
    (floorsRes.data || []).forEach((f: DbFloor) => floorsMap.set(f.id, f));

    const buildingsMap = new Map<string, DbBuilding>();
    (buildingsRes.data || []).forEach((b: DbBuilding) => buildingsMap.set(b.id, b));

    const floor = targetRoom.floor_id ? floorsMap.get(targetRoom.floor_id) : undefined;
    const building = floor?.building_id ? buildingsMap.get(floor.building_id) : undefined;

    if (!floor || !building) return null; // Orphaned room whose floor or building was erased

    const assignedNodes = (nodesRes.data || []).filter((n: any) => n.room_id === targetRoom.id);
    const nodeLimit = targetRoom.node_limit || 10;
    const assignedCount = assignedNodes.length;
    const capacityPercentage = Math.min(100, Math.round((assignedCount / nodeLimit) * 100));

    return {
      id: targetRoom.id,
      name: targetRoom.name,
      floorName: floor.name,
      buildingName: building.name,
      nodeLimit,
      assignedCount,
      capacityPercentage,
    };
  } catch (err) {
      scope?.recordError(err);
    console.error('Failed to fetch active room data:', err);
    return null;
  }
}

// Map live Supabase tables (nodes, telemetry, rooms, floors, buildings) to frontend SensorData
// IMPORTANT: Only returns sensor nodes actively assigned to the worker's room.
// If the worker is Unassigned (roomId is null), returns an empty array.
export async function fetchLiveSensors(roomId?: string | null, scope?: ReadScope): Promise<SensorData[]> {
  if (!roomId) {
    return [];
  }
  const isUniversal = roomId === 'ALL' || roomId === 'all_rooms';
  try {
    const nodesQuery = fetchAccessibleRows(supabase, 'nodes', '*', isUniversal ? undefined : query => query.eq('room_id', roomId), scope, isUniversal ? undefined : `room:${roomId}`);
    const roomsQuery = scope
      ? fetchAccessibleRows(supabase, 'rooms', '*', undefined, scope)
      : fetchAccessibleRows(supabase, 'rooms', '*', query => isUniversal ? query : query.eq('id', roomId));
    const [nodesRes, roomsRes, floorsRes, buildingsRes, reportsRes, airconsRes] = await Promise.all([
      nodesQuery,
      roomsQuery,
      fetchAccessibleRows(supabase, 'floors', '*', undefined, scope),
      fetchAccessibleRows(supabase, 'buildings', '*', undefined, scope),
      fetchAccessibleRows(supabase, 'maintenance_reports', 'id, aircon_id, aircon_name, status, priority', undefined, scope),
      fetchAccessibleRows(supabase, 'aircons', '*', undefined, scope),
    ]);

    if (nodesRes.error) {
      console.warn('Error fetching nodes from Supabase:', nodesRes.error);
      return [];
    }

    const nodes: DbNode[] = nodesRes.data || [];
    const roomsMap = new Map<string, DbRoom>();
    (roomsRes.data || []).forEach((r: DbRoom) => roomsMap.set(r.id, r));

    const floorsMap = new Map<string, DbFloor>();
    (floorsRes.data || []).forEach((f: DbFloor) => floorsMap.set(f.id, f));

    const buildingsMap = new Map<string, DbBuilding>();
    (buildingsRes.data || []).forEach((b: DbBuilding) => buildingsMap.set(b.id, b));

    const dbReports = reportsRes.data || [];
    const dbAircons: any[] = airconsRes.data || [];

    return nodes.map((node, index) => {
      const room = node.room_id ? roomsMap.get(node.room_id) : undefined;
      const floor = room?.floor_id ? floorsMap.get(room.floor_id) : undefined;
      const building = floor?.building_id ? buildingsMap.get(floor.building_id) : undefined;

      const roomName = room?.name || 'Unassigned';
      const floorName = floor?.name || '';
      const buildingName = building?.name || '';
      const location = [buildingName, floorName].filter(Boolean).join(', ');

      const rawTemp = node.temp;
      const { fahrenheit, celsius } = formatTemperature(rawTemp);
      const batteryStr = formatBatteryPercent(node.battery);

      // Determine status from temperature and status field
      let status: 'optimal' | 'warning' | 'critical' = 'optimal';
      let statusLabel = 'Optimal';
      let details = 'Sensor measurements are within acceptable thresholds.';

      const tempVal = rawTemp ?? 0;
      const nodeStatus = (node.status || 'online').toLowerCase();
      if (nodeStatus === 'offline') {
        status = 'critical';
        statusLabel = 'Offline';
        details = 'Sensor node is currently offline and unreachable.';
      } else if (tempVal >= 28 || nodeStatus === 'critical') {
        status = 'critical';
        statusLabel = 'Critical Temp';
        details = 'High temperature threshold breached. Immediate vent and coil inspection required.';
      } else if (tempVal >= 25 || nodeStatus === 'warning') {
        status = 'warning';
        statusLabel = 'Checklist Due';
        details = 'Airflow restriction detected. Filter cleaning scheduled in maintenance checklist.';
      }

      // Check genuine maintenance report for this sensor node from database
      const matchedReport = dbReports.find(
        (r: any) =>
          (r.aircon_id === node.id || r.aircon_name === node.name) &&
          r.status !== 'Completed' &&
          r.status !== 'Verified'
      );
      const activeReportId = matchedReport ? matchedReport.id : undefined;
      const acId = `AC-${String(index + 2).padStart(3, '0')}`;

      // Pressure in kPa matching desktop (e.g. 0.5 kPa / 0.6 kPa)
      const rawPressure = node.pressure;
      const pressureStr = rawPressure != null ? `${Number(rawPressure).toFixed(1)} kPa` : '—';

      // Only exact, unambiguous controller bindings may supply this unit's state.
      const nodeKeys = [String(node.id || '').toLowerCase(), String(node.name || '').toLowerCase()].filter(Boolean);
      const matches = dbAircons.filter((ac: any) =>
        [ac.node_id, ac.controller_node_id].some(id => id && nodeKeys.includes(String(id).toLowerCase())));
      const matchedAc = matches.length === 1 ? matches[0] : undefined;
      const description = describeAirconState(matchedAc);
      const airconStateText = nodeStatus === 'offline' ? 'OFFLINE · ' + description.summary : description.summary;

      const airconBrand = matchedAc?.brand?.trim() || (node as any).brand?.trim() || (node as any).aircon_brand?.trim() || '';
      const airconModelType = matchedAc?.aircon_type || matchedAc?.model || node.aircon_type || '';
      const associatedAc = airconBrand ? `${airconBrand} ${airconModelType}`.trim() : (airconModelType || '');

      // Signal Strength & Schedule details from nodes table
      const signalInfo = formatSignalStrength(node.rssi);
      const wakeTimeFormatted = node.wake_time ? formatTimeAmPm(node.wake_time) : '';
      const sleepTimeFormatted = node.sleep_time ? formatTimeAmPm(node.sleep_time) : '';
      const intervalFormatted = node.interval_val ? formatInterval(node.interval_val, node.interval_unit || 'Hours') : '';
      const updatedTimeFormatted = formatUpdatedTime(node.updated);

      return {
        id: node.id,
        name: `${node.name} (${roomName})`,
        value: celsius,
        status,
        statusLabel,
        details,
        location,
        aircon: airconStateText,
        ventTemp: celsius,
        pressure: pressureStr,
        battery: batteryStr,
        building: buildingName || undefined,
        floor: floorName || undefined,
        room: roomName !== 'Unassigned' ? roomName : undefined,
        sensorName: node.name,
        acType: airconModelType || undefined,
        acId,
        activeReportId,
        maintenanceStatus: matchedReport
          ? (matchedReport.status || (status === 'optimal' ? 'In Progress' : 'Checklist Due'))
          : 'No Maintenance Yet',
        maintenancePriority: matchedReport
          ? ((matchedReport as any)?.priority || (status === 'critical' ? 'High' : status === 'warning' ? 'Medium' : 'Low'))
          : 'Low',
        // Desktop middle telemetry properties
        wakeTime: wakeTimeFormatted || undefined,
        sleepTime: sleepTimeFormatted || undefined,
        interval: intervalFormatted || undefined,
        rssi: node.rssi ?? null,
        signalStrengthLabel: signalInfo.label,
        signalStrengthDbm: signalInfo.text,
        airconState: airconStateText,
        updatedTime: updatedTimeFormatted,
        roomId: node.room_id,
        isAssignedToRoom: true,
        // Admin Desktop Configuration Parity
        brand: airconBrand || undefined,
        airconBrand: airconBrand || undefined,
        associatedAc: associatedAc || undefined,
        model: (node as any).model || matchedAc?.model || undefined,
        serialNumber: (node as any).mac_address || (node as any).serial || node.id || '—',
        pirOccupancy: (node as any).pir_status || (node as any).occupancy || undefined,
        dailySchedule: (wakeTimeFormatted && sleepTimeFormatted) ? `${wakeTimeFormatted} - ${sleepTimeFormatted}` : undefined,
      };
    });
  } catch (error) {
      scope?.recordError(error);
    console.error('Failed to fetch live sensors:', error);
    return [];
  }
}

export const fetchLiveAcControllers = fetchLiveSensors;

// Real-time subscription to nodes, rooms, floors, buildings, and staff
export function subscribeToNodes(onUpdate: () => void) {
  const channelId = `nodes_rooms_staff_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const channel = supabase
    .channel(channelId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'nodes' }, () => {
      onUpdate();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, () => {
      onUpdate();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'floors' }, () => {
      onUpdate();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'buildings' }, () => {
      onUpdate();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'staff' }, () => {
      onUpdate();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'aircons' }, () => {
      onUpdate();
    })
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

// Real-time subscription to a specific staff member record (for archival and remote logout)
export function subscribeToStaffMember(staffId: string, onUpdate: (staff: DbStaff) => void) {
  if (!staffId) return () => { };
  const channelId = `staff_user_${staffId.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`;
  const channel = supabase
    .channel(channelId)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'staff',
        filter: `id=eq.${staffId}`,
      },
      (payload) => {
        if (payload.new) {
          onUpdate(payload.new as DbStaff);
        }
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

// Fetch real notifications from Supabase
export interface AppNotificationItem {
  id: string;
  subject: string;
  message: string;
  time: string;
  read: boolean;
  type: 'critical' | 'warning' | 'info' | 'optimal';
  category: 'temp' | 'pressure' | 'report' | 'hvac';
  building?: string;
  floor?: string;
  room?: string;
  sensorName?: string;
}

export async function fetchLiveNotifications(): Promise<AppNotificationItem[]> {
  try {
    const [notifRes, roomsRes, floorsRes, buildingsRes] = await Promise.all([
      supabase.from('notifications').select('*').order('created', { ascending: false }).limit(50),
      fetchAccessibleRows(supabase, 'rooms', '*'),
      fetchAccessibleRows(supabase, 'floors', '*'),
      fetchAccessibleRows(supabase, 'buildings', '*'),
    ]);

    if (notifRes.error) {
      console.warn('Error fetching notifications:', notifRes.error);
      return [];
    }

    const roomsMap = new Map<string, DbRoom>();
    (roomsRes.data || []).forEach((r: DbRoom) => roomsMap.set(r.id, r));

    const floorsMap = new Map<string, DbFloor>();
    (floorsRes.data || []).forEach((f: DbFloor) => floorsMap.set(f.id, f));

    const buildingsMap = new Map<string, DbBuilding>();
    (buildingsRes.data || []).forEach((b: DbBuilding) => buildingsMap.set(b.id, b));

    const rawNotifs: DbNotification[] = notifRes.data || [];

    return rawNotifs.map((item) => {
      const room = item.room_id ? roomsMap.get(item.room_id) : undefined;
      const floor = room?.floor_id ? floorsMap.get(room.floor_id) : undefined;
      const building = floor?.building_id ? buildingsMap.get(floor.building_id) : undefined;

      const content = item.content || 'System notification alert';
      let type: 'critical' | 'warning' | 'info' | 'optimal' = 'info';
      let category: 'temp' | 'pressure' | 'report' | 'hvac' = 'hvac';

      const lower = content.toLowerCase();
      if (lower.includes('critical') || lower.includes('danger') || lower.includes('hot')) {
        type = 'critical';
      } else if (lower.includes('warning') || lower.includes('threshold') || lower.includes('exceeded')) {
        type = 'warning';
      } else if (lower.includes('optimal') || lower.includes('normal') || lower.includes('restored')) {
        type = 'optimal';
      }

      if (lower.includes('temp') || lower.includes('hot') || lower.includes('cold')) {
        category = 'temp';
      } else if (lower.includes('pressure') || lower.includes('bar')) {
        category = 'pressure';
      } else if (lower.includes('report') || lower.includes('shift')) {
        category = 'report';
      }

      const timeStr = item.date && item.time ? `${item.date} ${item.time}` : 'Recently';

      return {
        id: item.id,
        subject: content.split('.')[0] || 'System Alert',
        message: content,
        time: timeStr,
        read: !item.triggered,
        type,
        category,
        building: building?.name,
        floor: floor?.name,
        room: room?.name,
        sensorName: room ? `${room.name} Sensor` : undefined,
      };
    });
  } catch (error) {
    console.error('Failed to fetch live notifications:', error);
    return [];
  }
}

// Real-time subscription to notifications
export function subscribeToNotifications(onUpdate: () => void) {
  const channelId = `notifications_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const channel = supabase
    .channel(channelId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, () => {
      onUpdate();
    })
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

// Create Notification
export async function createNotification(content: string, roomId?: string): Promise<boolean> {
  try {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toTimeString().split(' ')[0];
    const id = `notif_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const { error } = await supabase.from('notifications').insert({
      id,
      date: dateStr,
      time: timeStr,
      content,
      triggered: true,
      room_id: roomId || null,
      admin_id: null,
      created: now.toISOString(),
      updated: now.toISOString(),
    });

    if (error) {
      console.warn('Failed to insert notification:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('Error inserting notification:', e);
    return false;
  }
}

// All authentication is verified by Supabase Auth plus a server-owned profile.
const accountAuth = createAuthService(supabase, AsyncStorage);
export const authenticateUser = accountAuth.authenticateUser;
export const registerStaffMember = accountAuth.registerStaffMember;
export const verifyUserForPasswordReset = accountAuth.verifyUserForPasswordReset;
export const requestPasswordRecovery = accountAuth.requestPasswordRecovery;
export const resetUserPassword = accountAuth.resetUserPassword;
export const changeUserPassword = accountAuth.changeUserPassword;
export type VerifyUserResetResult = Awaited<ReturnType<typeof verifyUserForPasswordReset>>;
export async function requestUserEmailChange(email: string): Promise<boolean> {
  const { data } = await supabase.auth.getUser();
  if (!data.user || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return false;
  const { error } = await supabase.auth.updateUser({ email: email.trim().toLowerCase() });
  return !error;
}

export async function getRememberedCredentials(): Promise<{ identifier: string; rememberMe: boolean } | null> {
  try {
    const raw = await AsyncStorage.getItem('ecotrack_remembered_creds');
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (e) { }
  return null;
}

export async function saveRememberedCredentials(identifier: string, rememberMe: boolean): Promise<void> {
  try {
    if (rememberMe) {
      await AsyncStorage.setItem(
        'ecotrack_remembered_creds',
        JSON.stringify({ identifier: identifier.trim(), rememberMe: true })
      );
    } else {
      await AsyncStorage.removeItem('ecotrack_remembered_creds');
    }
  } catch (e) { }
}

export async function clearRememberedCredentials(): Promise<void> {
  try {
    await AsyncStorage.removeItem('ecotrack_remembered_creds');
  } catch (e) { }
}

// Robust pure-JS base64 to Uint8Array converter (compatible with Hermes and all JS engines)
function base64ToUint8Array(base64: string): Uint8Array {
  const base64Data = (base64.includes(',') ? base64.split(',')[1] : base64).replace(/\s/g, '');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64Data)) {
    throw new Error('Invalid base64 image data.');
  }
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Uint8Array(256);
  for (let i = 0; i < chars.length; i++) {
    lookup[chars.charCodeAt(i)] = i;
  }

  let bufferLength = base64Data.length * 0.75;
  const len = base64Data.length;
  if (base64Data[len - 1] === '=') bufferLength--;
  if (base64Data[len - 2] === '=') bufferLength--;

  const bytes = new Uint8Array(Math.floor(bufferLength));
  let p = 0;
  for (let i = 0; i < len; i += 4) {
    const encoded1 = lookup[base64Data.charCodeAt(i)];
    const encoded2 = lookup[base64Data.charCodeAt(i + 1)];
    const encoded3 = lookup[base64Data.charCodeAt(i + 2)];
    const encoded4 = lookup[base64Data.charCodeAt(i + 3)];

    bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
    if (base64Data[i + 2] !== '=' && p < bytes.length) {
      bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
    }
    if (base64Data[i + 3] !== '=' && p < bytes.length) {
      bytes[p++] = ((encoded3 & 3) << 6) | (encoded4 & 63);
    }
  }
  return bytes;
}

// Only return a durable URL after a successful upload.
export async function uploadImageToSupabase(
  uriOrBase64: string, bucketName: string = 'avatars', fileNamePrefix: string = 'img'
): Promise<string> {
  if (!uriOrBase64) return '';
  if (/^(https?:\/\/|storage:\/\/)/i.test(uriOrBase64)) {
    const signed = await resolveImageUrl(uriOrBase64);
    if (!signed) throw new Error('Image is unavailable. Please select it again.');
    return signed;
  }
  if (!['avatars', 'photos', 'maintenance-photos'].includes(bucketName)) throw new Error('Unsupported image bucket.');
  const { data: identity, error: identityError } = await supabase.auth.getUser();
  if (identityError || !identity.user) throw new Error('Sign in before uploading an image.');
  let bytes: Uint8Array;
  let mime: string;
  const dataMatch = uriOrBase64.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/);
  if (dataMatch) {
    mime = dataMatch[1];
    bytes = base64ToUint8Array(dataMatch[2]);
  } else {
    if (!/^(file:|content:|blob:)/.test(uriOrBase64)) throw new Error('Unsupported image format. Select a JPEG, PNG, WebP or GIF image.');
    const response = await fetch(uriOrBase64);
    if (!response.ok) throw new Error('Unable to read the selected image.');
    const blob = await response.blob();
    mime = blob.type;
    bytes = new Uint8Array(await new Response(blob).arrayBuffer());
  }
  const extensions: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
  // Native file/content URIs may omit MIME metadata. Keep signature validation
  // authoritative rather than trusting a filename or assuming every photo is JPEG.
  if (!mime || mime === 'application/octet-stream') {
    mime = Object.keys(extensions).find(type => isImageSignature(bytes, type)) || '';
  }
  if (!extensions[mime] || !bytes.length) throw new Error('Unsupported or empty image.');
  const maxBytes = (bucketName === 'avatars' ? 10 : 20) * 1024 * 1024;
  if (bytes.length > maxBytes) throw new Error('Image exceeds the storage size limit.');
  if (!isImageSignature(bytes, mime)) throw new Error('Image content does not match its file type.');
  const prefix = fileNamePrefix.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
  const filePath = identity.user.id + '/' + prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10) + '.' + extensions[mime];
  const { error } = await supabase.storage.from(bucketName).upload(filePath, bytes.buffer as ArrayBuffer, { contentType: mime, upsert: false });
  if (error) throw new Error('Image upload failed. Please try again.');
  const signed = await resolveImageUrl(`storage://${bucketName}/${filePath}`);
  if (!signed) throw new Error('Uploaded image is unavailable.');
  return signed;
}

// Update Staff profile in Supabase & Local Session
export async function updateStaffProfile(
  userId: string,
  name: string,
  phone: string,
  email?: string,
  role?: string,
  avatar?: 'default' | 'male' | 'female' | 'custom',
  photoUrl?: string | null,
  assignment?: string
): Promise<boolean> {
  try {
    if (!userId || !name.trim() || !phone.trim()) return false;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return false;
    const currentUser = await accountAuth.getSavedSession();
    if (!currentUser || currentUser.id !== userId) return false;
    // Email changes go through verified Auth email confirmation separately.
    const { data, error } = await supabase.rpc('ecotrack_update_profile', {
      p_name: name.trim(), p_phone: phone.trim(),
      p_avatar: avatar || currentUser.avatar || 'default',
      p_photo_url: imageReference(photoUrl === undefined ? currentUser.photoUrl : photoUrl, SUPABASE_URL),
    });
    if (error || !data || data.authUserId !== currentUser.authUserId) return false;
    await AsyncStorage.setItem('ecotrack_session_user', JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export async function fetchLiveLocations(): Promise<string[]> {
  try {
    const [roomsRes, floorsRes, buildingsRes] = await Promise.all([
      fetchAccessibleRows(supabase, 'rooms', '*'),
      fetchAccessibleRows(supabase, 'floors', '*'),
      fetchAccessibleRows(supabase, 'buildings', '*'),
    ]);

    const buildingsMap = new Map<string, DbBuilding>();
    (buildingsRes.data || []).forEach((b: DbBuilding) => buildingsMap.set(b.id, b));

    const floorsMap = new Map<string, DbFloor>();
    (floorsRes.data || []).forEach((f: DbFloor) => floorsMap.set(f.id, f));

    const rooms: DbRoom[] = roomsRes.data || [];
    if (rooms.length > 0) {
      const locations = rooms.map((room) => {
        const floor = room.floor_id ? floorsMap.get(room.floor_id) : undefined;
        const building = floor?.building_id ? buildingsMap.get(floor.building_id) : undefined;
        const bName = building?.name || '';
        const fName = floor?.name || '';
        const rName = room.name || '';
        return [bName, fName, rName].filter(Boolean).join(' • ');
      }).filter(Boolean);
      return Array.from(new Set(locations));
    }
  } catch (e) {
    // safe fallback
  }

  return [];
}

// Restore saved user session from AsyncStorage or real staff from Supabase
// IMPORTANT: Does NOT auto-login if no active session was previously saved.
export const resolveImageUrl = (value: string | null | undefined) => displayImage(supabase, value, SUPABASE_URL);
export async function getSavedSession(): Promise<AppUser | null> {
  const user = await accountAuth.getSavedSession();
  return user ? { ...user, photoUrl: await resolveImageUrl(user.photoUrl) } : null;
}

// Clear user session and set user status to Offline in Supabase
export async function clearSession(_userId?: string): Promise<void> {
  try {
    const token = await AsyncStorage.getItem('ecotrack_expo_push_token');
    if (token) await supabase.rpc('ecotrack_unregister_push_token', { p_token: token });
    await AsyncStorage.removeItem('ecotrack_expo_push_token');
  } catch {}
  await AsyncStorage.removeItem('ecotrack_session_user');
  try { const keys=await AsyncStorage.getAllKeys(); await AsyncStorage.multiRemove(keys.filter(key=>/^ecotrack_(staff|admin)_pwd_/.test(key))); } catch {}
  try { await supabase.rpc('ecotrack_set_presence', { p_online: false }); } catch {}
  await supabase.auth.signOut({ scope: 'local' });
}

// Explicitly update staff member online/offline status in Supabase
export async function updateStaffOnlineStatus(_workerIdOrEmail: string, isOnline: boolean): Promise<void> {
  await supabase.rpc('ecotrack_set_presence', { p_online: isOnline });
}

// Live Aircon Units for explore.tsx
export interface LiveAirconUnit {
  id: string;
  name: string;
  location: string;
  type: string;
  status: 'Normal' | 'Maintenance Due' | 'Warning';
  temp: string;
  setTemp: string;
  power: 'ON' | 'OFF' | 'STANDBY';
  lastService: string;
  activeReportId?: string;
}

export async function fetchLiveAircons(): Promise<LiveAirconUnit[]> {
  try {
    const [nodesRes, roomsRes, floorsRes, reportsRes] = await Promise.all([
      fetchAccessibleRows(supabase, 'nodes', '*'),
      fetchAccessibleRows(supabase, 'rooms', '*'),
      fetchAccessibleRows(supabase, 'floors', '*'),
      fetchAccessibleRows(supabase, 'maintenance_reports', 'id, aircon_id, aircon_name, status'),
    ]);

    if (nodesRes.error || !nodesRes.data) return [];

    const roomsMap = new Map<string, DbRoom>();
    (roomsRes.data || []).forEach((r: DbRoom) => roomsMap.set(r.id, r));

    const floorsMap = new Map<string, DbFloor>();
    (floorsRes.data || []).forEach((f: DbFloor) => floorsMap.set(f.id, f));

    const dbReports = reportsRes.data || [];

    return nodesRes.data.map((node: DbNode, idx: number) => {
      const room = node.room_id ? roomsMap.get(node.room_id) : undefined;
      const floor = room?.floor_id ? floorsMap.get(room.floor_id) : undefined;
      const roomName = room?.name || 'Room';
      const floorName = floor?.name || '';
      const location = floorName ? `${roomName}, ${floorName}` : roomName;

      let status: 'Normal' | 'Maintenance Due' | 'Warning' = 'Normal';
      const tempVal = node.temp ?? 23;
      if (tempVal >= 28 || node.status === 'critical') {
        status = 'Warning';
      } else if (tempVal >= 25 || node.status === 'warning') {
        status = 'Maintenance Due';
      }

      // Check genuine maintenance report for this unit
      const matchedReport = dbReports.find(
        (r: any) =>
          (r.aircon_id === node.id || r.aircon_name === node.name) &&
          r.status !== 'Completed' &&
          r.status !== 'Verified'
      );
      const activeReportId = matchedReport ? matchedReport.id : undefined;

      const formattedTemp = `${tempVal.toFixed(1)}°C`;
      const powerState: 'ON' | 'OFF' | 'STANDBY' =
        node.status === 'offline' ? 'OFF' : node.status === 'standby' ? 'STANDBY' : 'ON';

      return {
        id: `AC-${String(idx + 1).padStart(3, '0')}`,
        name: `${roomName} Unit (${node.name})`,
        location,
        type: node.aircon_type || '—',
        status,
        temp: formattedTemp,
        setTemp: '—',
        power: powerState,
        lastService: node.install_date || '—',
        activeReportId,
      };
    });
  } catch (e) {
    console.error('Error fetching live aircon units:', e);
    return [];
  }
}

// Live Maintenance Reports for Maintenance.tsx
export interface LiveMaintenanceItem {
  id: string;
  title: string;
  description: string;
  status: 'Not Started' | 'In Progress' | 'Completed' | 'Needs Repair' | 'Under Repair' | 'For Verification';
  remarks?: string;
  problemDescription?: string;
  photoUri?: string | null;
  photoUris?: string[];
  repaired?: boolean;
  isRepaired?: boolean;
  verified?: boolean;
  verifiedAt?: string | null;
  updatedAt?: string | null;
  linkedRepairId?: string | null;
}

export interface LiveMaintenanceReport {
  updatedAt?: string | null;
  id: string;
  airconId: string;
  airconName?: string;
  airconType?: string;
  roomId?: string;
  location: string;
  title: string;
  description?: string;
  type: string;
  assignedWorker: string;
  staffId?: string;
  priority: 'Critical' | 'High' | 'Medium' | 'Low';
  dueDate: string;
  createdDate?: string;
  status: 'Pending' | 'In Progress' | 'Completed' | 'Needs Repair' | 'Under Repair' | 'For Verification';
  lastUpdated?: string;
  items: LiveMaintenanceItem[];
  issue?: {
    component?: string;
    notes?: string;
    photoUri?: string | null;
    reported_by?: string;
    reported_at?: string;
  } | null;
  verificationRemarks?: string | null;
  timeline?: any[];
  parentReportId?: string | null;
  linkedRepairId?: string | null;
  isRepaired?: boolean;
  isVerified?: boolean;
  allChildRepairsDone?: boolean;
}

const VALID_MAINTENANCE_ITEM_STATUSES = new Set([
  'For Verification',
  'Not Started',
  'In Progress',
  'Completed',
  'Needs Repair',
  'Under Repair',
]);

/**
 * Keep validation beside the persistence boundary so updates remain safe even
 * when this service is called from a new mobile screen in the future.
 */
export function validateLiveMaintenanceItems(items: LiveMaintenanceItem[]): string | null {
  if (!Array.isArray(items) || items.length === 0) {
    return 'This maintenance report has no checklist items to update.';
  }

  const ids = new Set<string>();
  for (const item of items) {
    if (!item?.id || !item?.title || !VALID_MAINTENANCE_ITEM_STATUSES.has(item.status)) {
      return 'Each checklist item must have a valid status before it can be submitted.';
    }
    if (ids.has(String(item.id))) return 'Checklist item IDs must be unique.';
    ids.add(String(item.id));
    if (item.photoUris?.some(uri => !/^(https?:\/\/|storage:\/\/)/i.test(uri)) || (item.photoUri && !/^(https?:\/\/|storage:\/\/)/i.test(item.photoUri))) return 'Upload checklist photos before saving the report.';
    if (item.status === 'Needs Repair' && !(item.problemDescription || item.remarks || '').trim()) {
      return `Add a problem description or note for "${item.title}" before marking it Needs Repair.`;
    }
  }

  return null;
}

export async function fetchLiveMaintenanceReports(workerName?: string, scope?: ReadScope): Promise<LiveMaintenanceReport[]> {
  try {
    const [reportsRes, roomsRes, floorsRes, buildingsRes] = await Promise.all([
      fetchAccessibleRows(supabase, 'maintenance_reports', '*', undefined, scope),
      fetchAccessibleRows(supabase, 'rooms', '*', undefined, scope),
      fetchAccessibleRows(supabase, 'floors', '*', undefined, scope),
      fetchAccessibleRows(supabase, 'buildings', '*', undefined, scope),
    ]);

    const roomsMap = new Map<string, DbRoom>();
    (roomsRes.data || []).forEach((rm: DbRoom) => roomsMap.set(rm.id, rm));

    const floorsMap = new Map<string, DbFloor>();
    (floorsRes.data || []).forEach((f: DbFloor) => floorsMap.set(f.id, f));

    const buildingsMap = new Map<string, DbBuilding>();
    (buildingsRes.data || []).forEach((b: DbBuilding) => buildingsMap.set(b.id, b));

    const resolveLocation = (roomId?: string | null) => {
      if (!roomId) return 'Assigned Area';
      const room = roomsMap.get(roomId);
      const floor = room?.floor_id ? floorsMap.get(room.floor_id) : undefined;
      const building = floor?.building_id ? buildingsMap.get(floor.building_id) : undefined;
      return [building?.name, floor?.name, room?.name].filter(Boolean).join(' • ') || room?.name || 'Assigned Area';
    };

    const reportsMap = new Map<string, LiveMaintenanceReport>();

    let rawReportsData = reportsRes.data;
    if (!rawReportsData || !Array.isArray(rawReportsData) || rawReportsData.length === 0) {
      try {
        const { data: directReports } = await supabase
          .from('maintenance_reports')
          .select('*')
          .order('created', { ascending: false });
        if (directReports && Array.isArray(directReports) && directReports.length > 0) {
          rawReportsData = directReports;
        }
      } catch (err) {
      scope?.recordError(err);
        console.warn('Direct maintenance reports fallback failed:', err);
      }
    }

    // 1. Process genuine database rows from Supabase maintenance_reports table
    if (rawReportsData && Array.isArray(rawReportsData)) {
      rawReportsData.forEach((r: any) => {
        // Only map tasks that actually exist in the database — NO hardcoded fallbacks.
        const rawTasks = Array.isArray(r.tasks) ? r.tasks : [];
        let items: LiveMaintenanceItem[] = [];
        if (rawTasks.length > 0) {
          items = rawTasks.map((t: any, idx: number) => {
            const taskId = String(t.id || idx + 1);
            const taskTitle = t.name || t.title || `Task #${idx + 1}`;
            const isSpecificIssueTask = r.issue && (
              (r.issue.taskId && String(r.issue.taskId) === taskId) ||
              (r.issue.component && taskTitle.toLowerCase().trim() === String(r.issue.component).toLowerCase().trim())
            );

            // Guard against photo spreading: each task owns its own photoUri.
            let taskPhoto = t.photoUri || t.photo || t.photo_url || t.imageUrl || null;
            if (taskPhoto && r.issue?.photoUri && taskPhoto === r.issue.photoUri && !isSpecificIssueTask && t.status !== 'Needs Repair') {
              taskPhoto = null;
            }

            const rawPhotoUris = Array.isArray(t.photoUris)
              ? t.photoUris
              : (Array.isArray(t.photos) ? t.photos : (taskPhoto ? [taskPhoto] : []));

            const rawStatus = typeof t.status === 'string' ? t.status.trim() : '';
            const statusLower = rawStatus.toLowerCase();
            const itemLinkedRepairId: string | null =
              t.linkedRepairId ||
              t.linked_repair_id ||
              t.repairId ||
              t.repair_id ||
              null;

            let resolvedItemStatus: LiveMaintenanceItem['status'] = 'Not Started';
            if (statusLower === 'completed') {
              resolvedItemStatus = 'Completed';
            } else if (statusLower === 'for verification' || statusLower === 'for_verification') {
              resolvedItemStatus = 'For Verification';
            } else if (statusLower === 'in progress' || statusLower === 'in_progress') {
              resolvedItemStatus = 'In Progress';
            } else if (statusLower === 'under repair' || statusLower === 'under_repair' || (itemLinkedRepairId && statusLower !== 'completed')) {
              resolvedItemStatus = 'Under Repair';
            } else if (statusLower === 'needs repair' || statusLower === 'needs_repair') {
              resolvedItemStatus = 'Needs Repair';
            } else {
              resolvedItemStatus = 'Not Started';
            }

            return {
              id: taskId,
              title: taskTitle,
              description: t.description || '',
              status: resolvedItemStatus,
              remarks: t.notes || t.remarks || '',
              problemDescription: t.problemDescription || (isSpecificIssueTask ? r.issue?.notes : '') || '',
              photoUri: taskPhoto,
              photoUris: rawPhotoUris,
              repaired: Boolean(t.repaired),
              isRepaired: Boolean(t.repaired || t.isRepaired),
              verified: Boolean(t.verified),
              verifiedAt: t.verifiedAt || null,
              updatedAt: t.updatedAt || t.updated_at || t.updated || r.updated || r.created || null,
              linkedRepairId: itemLinkedRepairId,
            };
          });
        }
        // If the desktop hasn't sent any tasks yet, items stays as an empty array [].
        // The mobile UI will show a "No tasks dispatched yet" state.

        const lastUpdatedStr = r.updated
          ? new Date(r.updated).toLocaleString([], {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
          : r.created_date || undefined;

        const loc = r.room_name || resolveLocation(r.room_id);

        // Detect linked repair or parent report strictly from explicit database properties
        const extractedParentReportId: string | null =
          r.parent_report_id ||
          r.parentReportId ||
          r.issue?.parent_report_id ||
          r.issue?.parentReportId ||
          null;

        const extractedLinkedRepairId: string | null =
          r.linked_repair_id ||
          r.linkedRepairId ||
          r.issue?.linked_repair_id ||
          r.issue?.linkedRepairId ||
          null;

        // Check if report has been verified by Admin
        // Historical approval text must not approve a subsequently reopened report.
        const rawAdminVerified = r.status === 'Verified' || r.status === 'Completed';

        const hasTasks = items.length > 0;
        const allTasksDone = hasTasks && items.every(isChecklistItemComplete);
        const anyNeedsRepair = items.some((it) => it.status === 'Needs Repair' || it.status === 'Under Repair');
        const anyActive = items.some((it) => it.status === 'In Progress' || it.status === 'Completed' || it.status === 'Needs Repair' || it.status === 'Under Repair');

        // Completion & Verification Invariant:
        // A report CANNOT become Completed or Verified while its own required tasks are unfinished!
        let normalizedStatus: 'Pending' | 'In Progress' | 'Completed' | 'Needs Repair' | 'Under Repair' | 'For Verification' = 'Pending';
        let isReportVerified = false;

        if (r.status === 'For Verification' && hasTasks && items.every(item => isChecklistItemComplete(item) || item.status === 'For Verification')) {
          normalizedStatus = 'For Verification';
        } else if (hasTasks && !allTasksDone) {
          // Required tasks exist but are NOT all done -> CANNOT be Completed or Verified
          isReportVerified = false;
          if (anyNeedsRepair || r.status === 'Needs Repair' || r.status === 'Under Repair') {
            normalizedStatus = 'Needs Repair';
          } else if (anyActive || r.status === 'In Progress' || r.status === 'Completed' || r.status === 'Verified' || r.status === 'For Verification') {
            normalizedStatus = 'In Progress';
          } else {
            normalizedStatus = 'Pending';
          }
        } else if (allTasksDone) {
          // All required tasks are complete (100%)
          if (rawAdminVerified || r.status === 'Verified' || r.status === 'Completed') {
            normalizedStatus = 'Completed';
            isReportVerified = true;
          } else {
            normalizedStatus = 'For Verification';
            isReportVerified = false;
          }
        } else {
          // No tasks dispatched yet: preserve clean status
          if (rawAdminVerified || r.status === 'Verified' || r.status === 'Completed') {
            normalizedStatus = 'Completed';
            isReportVerified = Boolean(rawAdminVerified || r.status === 'Verified');
          } else if (r.status === 'For Verification') {
            normalizedStatus = 'For Verification';
            isReportVerified = false;
          } else if (r.status === 'Needs Repair') {
            normalizedStatus = 'Needs Repair';
            isReportVerified = false;
          } else if (r.status === 'In Progress') {
            normalizedStatus = 'In Progress';
            isReportVerified = false;
          } else {
            normalizedStatus = 'Pending';
            isReportVerified = false;
          }
        }

        const isRepairOrder = /^REP-/i.test(r.id) || /repair|corrective/i.test(r.type || '');
        if (isRepairOrder && ['completed', 'verified'].includes(String(r.status).trim().toLowerCase())) {
          normalizedStatus = 'Completed';
          isReportVerified = true;
          items.forEach(item => {
            if (!item.linkedRepairId) {
              item.status = 'Completed';
              item.repaired = true;
              item.isRepaired = true;
              item.verified = true;
            }
          });
        }

        reportsMap.set(r.id, {
          id: r.id,
          updatedAt: r.updated ?? null,
          airconId: r.aircon_name || r.aircon_id || 'AC Unit',
          airconName: r.aircon_name || r.aircon_id || 'AC Unit',
          airconType: r.aircon_type || '—',
          roomId: r.room_id || undefined,
          location: loc,
          title: r.type || `${r.aircon_name || 'AC'} Maintenance`,
          description: r.description || (r.issue?.notes) || '',
          type: r.type || 'Preventive Maintenance',
          assignedWorker: r.staff_name || workerName || 'Maintenance Staff',
          staffId: r.staff_id || undefined,
          priority: (r.priority as any) || 'Medium',
          dueDate: r.due_date || '—',
          createdDate: r.created_date || (r.created ? new Date(r.created).toLocaleDateString() : undefined),
          status: normalizedStatus,
          lastUpdated: lastUpdatedStr,
          items,
          issue: r.issue || null,
          verificationRemarks: r.verification_remarks || null,
          timeline: Array.isArray(r.timeline) ? r.timeline : [],
          parentReportId: extractedParentReportId,
          linkedRepairId: extractedLinkedRepairId,
          isVerified: isReportVerified,
          isRepaired: (r.id.startsWith('REP-') || (r.type && r.type.toLowerCase().includes('repair'))) ? isReportVerified : false,
        });
      });
    }

    // 2. Link child repair reports created by Admin to parent maintenance reports
    for (const rep of reportsMap.values()) {
      if (rep.parentReportId) {
        const parentReport = reportsMap.get(rep.parentReportId);
        if (parentReport && !parentReport.linkedRepairId && (rep.id.startsWith('REP-') || rep.type?.toLowerCase().includes('repair'))) {
          parentReport.linkedRepairId = rep.id;
        }
      }
    }

    // Reconcile only visible, explicitly linked children. Keep backend flags for children hidden by RLS.
    for (const report of reportsMap.values()) {
      let reconciled = false;
      for (const item of report.items) {
        const child = item.linkedRepairId
          ? Array.from(reportsMap.values()).find(rep => rep.id.toLowerCase() === item.linkedRepairId?.toLowerCase())
          : undefined;
        if (!child) continue;
        reconciled = true;
        const done = isRepairDone(child);
        item.status = done ? 'Completed' : isRepairAwaitingVerification(child) ? 'For Verification' : 'Under Repair';
        item.repaired = done;
        item.isRepaired = done;
        item.verified = done;
        if (!done) item.verifiedAt = null;
      }
      if (reconciled) {
        const approved = rawReportsData?.find((row: any) => row.id === report.id);
        const allDone = report.items.length > 0 && report.items.every(isChecklistItemComplete);
        report.isVerified = allDone && ['Completed', 'Verified'].includes(approved?.status);
        report.status = report.items.some(item => item.status === 'Under Repair') ? 'Under Repair'
          : report.items.some(item => item.status === 'Needs Repair') ? 'Needs Repair'
          : allDone ? report.isVerified ? 'Completed' : 'For Verification'
          : report.items.every(item => isChecklistItemComplete(item) || item.status === 'For Verification')
            ? 'For Verification' : 'In Progress';
      }
    }
    const synchronizedReports = Array.from(reportsMap.values());
    const signedImages = new Map<string, Promise<string | null>>();
    const sign = (uri: string) => {
      if (!signedImages.has(uri)) signedImages.set(uri, resolveImageUrl(uri));
      return signedImages.get(uri)!;
    };
    await Promise.all(synchronizedReports.flatMap(report => report.items.map(async item => {
      // Keep unavailable references for persistence; image requests remain private.
      if (item.photoUri) item.photoUri = await sign(item.photoUri) || item.photoUri;
      if (item.photoUris) item.photoUris = await Promise.all(item.photoUris.map(async uri => await sign(uri) || uri));
    })));
    const reportsList = synchronizedReports.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    return reportsList;
  } catch (e) {
      scope?.recordError(e);
    console.error('Error fetching live maintenance reports:', e);
    return [];
  }
}

export async function updateLiveMaintenanceReport(reportId: string, params: MaintenanceUpdateParams) {
  if (params.items) {
    const error = validateLiveMaintenanceItems(params.items);
    if (error) return { success: false, error, status: undefined, updated: undefined };
  }
  try {
    const items = params.items?.map(item => ({ ...item,
      photoUri: imageReference(item.photoUri, SUPABASE_URL),
      photoUris: item.photoUris?.map(uri => imageReference(uri, SUPABASE_URL)!).filter(Boolean),
    }));
    return updateMaintenanceReportRpc(supabase, reportId, { ...params, items });
  } catch {
    return { success: false, error: 'A photo is unavailable. Upload it again before saving.' };
  }
}

export async function submitRepairAndSyncParent(repairId: string, _workerName?: string, context: Partial<MaintenanceMutationContext> = {}) {
  return submitRepairRpc(supabase, repairId, context);
}

export function subscribeToMaintenanceReports(callback: () => void) {
  const channelId = `maint_reports_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const channel = supabase
    .channel(channelId)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'maintenance_reports',
      },
      () => {
        callback();
      }
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'mobile_notifications',
      },
      () => {
        callback();
      }
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'nodes',
      },
      () => {
        callback();
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
