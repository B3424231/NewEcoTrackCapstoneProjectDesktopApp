import { Platform, PermissionsAndroid } from 'react-native';
import type { NetInfoWifiState } from '@react-native-community/netinfo';
import { fetchAccessibleRows, type ReadScope } from './query-utils';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, DbNode, DbRoom, DbFloor, DbBuilding } from './supabase';
import { CapabilityEngine } from './ac-controller-service';
import { probeController, requestControllerJson } from './device-transport';

export interface Esp32Device {
  id: string;                 // Supabase Primary Key e.g. "node_1234567890abcdef"
  deviceId: string;           // Display identifier e.g. "ESP32-S3-001" or node ID
  name: string;               // e.g. "AC Controller Node 001"
  status: 'connected' | 'offline';
  temp?: number | null;
  pressure?: number | null;
  rssi?: number | null;
  battery?: number | null;
  wifiStatus: 'connected' | 'disconnected' | 'connecting';
  wifiSsid?: string;
  ipAddress?: string;
  lastSeen: string;
  dateAdded: string;
  macAddress?: string;
  firmwareVersion?: string;
  building?: string;
  floor?: string;
  room?: string;
  roomId?: string | null;
  airconType?: string;
  brand?: string;
  associatedAc?: string;
  wakeTime?: string;
  sleepTime?: string;
  intervalVal?: number;
  intervalUnit?: string;
  created?: string;
  updated?: string;
  addedByUserId?: string;
  addedByUserEmail?: string;
  addedByUserName?: string;
}

export interface AvailableRoomOption {
  id: string;
  name: string;
  floorName: string;
  buildingName: string;
  fullPath: string; // e.g. "Main Building • 2nd Floor • Lab 204"
  airconBrand?: string;
  airconType?: string;
  airconName?: string;
  nodeName?: string;
}

export interface BleDiscoveredDevice {
  id: string;
  bleId?: string;             // Native BLE identifier; deviceId remains the logical node identity.
  deviceId: string;
  name: string;
  pingMs: number | null;      // Null until response time has actually been measured.
  macAddress: string;
  isEcoTrackDevice: boolean;
}

export interface WifiNetwork {
  ssid: string;
  isSecure: boolean;
  signalStrength?: number;
  signalLevel?: 1 | 2 | 3 | 4;
  frequency?: string;
  isSaved?: boolean;
  isConnectedPhone?: boolean;
}

export interface ConnectedPhoneWifi {
  ssid: string | null;
  isWifi: boolean;
  details?: NetInfoWifiState['details'];
  error?: 'unsupported' | 'location-disabled' | 'permission-denied' | 'precise-location-required' | 'unavailable';
}

let iosWifiSsidEnabled = false;

export interface StoredDeviceMeta {
  wifiSsid?: string;
  ipAddress?: string;
  macAddress?: string;
  brand?: string;
  addedByUserId?: string;
  addedByUserEmail?: string;
  addedByUserName?: string;
}

export const UserDeviceStorage = {
  async getUserNodeIds(userKey?: string | null): Promise<string[]> {
    if (!userKey || !userKey.trim()) return [];
    try {
      const sanitizedKey = userKey.trim().toLowerCase().replace(/[^a-z0-9_@.-]/g, '_');
      const raw = await AsyncStorage.getItem(`@ecotrack_user_nodes_${sanitizedKey}`);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  },

  async recordUserNode(userKey: string | null | undefined, nodeId: string): Promise<void> {
    if (!userKey || !userKey.trim() || !nodeId) return;
    try {
      const sanitizedKey = userKey.trim().toLowerCase().replace(/[^a-z0-9_@.-]/g, '_');
      const current = await this.getUserNodeIds(sanitizedKey);
      if (!current.includes(nodeId)) {
        current.push(nodeId);
        await AsyncStorage.setItem(`@ecotrack_user_nodes_${sanitizedKey}`, JSON.stringify(current));
      }
    } catch {
      // ignore
    }
  },

  async removeUserNode(userKey: string | null | undefined, nodeId: string): Promise<void> {
    if (!userKey || !userKey.trim() || !nodeId) return;
    try {
      const sanitizedKey = userKey.trim().toLowerCase().replace(/[^a-z0-9_@.-]/g, '_');
      const current = await this.getUserNodeIds(sanitizedKey);
      const filtered = current.filter((id) => id !== nodeId);
      await AsyncStorage.setItem(`@ecotrack_user_nodes_${sanitizedKey}`, JSON.stringify(filtered));
    } catch {
      // ignore
    }
  },
};

async function getStoredDeviceMeta(nodeId: string): Promise<StoredDeviceMeta | null> {
  try {
    const raw = await AsyncStorage.getItem(`@ecotrack_node_meta_${nodeId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function setStoredDeviceMeta(nodeId: string, meta: StoredDeviceMeta) {
  try {
    const existing = await getStoredDeviceMeta(nodeId);
    await AsyncStorage.setItem(`@ecotrack_node_meta_${nodeId}`, JSON.stringify({ ...existing, ...meta }));
  } catch {
    // ignore
  }
}

/**
 * Format ISO timestamp to friendly relative time string (e.g. "Just now", "5 mins ago", "Yesterday")
 */
function formatLastSeen(isoStr?: string | null): string {
  if (!isoStr) return 'Offline';
  try {
    const diffMs = Date.now() - new Date(isoStr).getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHours = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSec < 45) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'Yesterday';
    return `${diffDays}d ago`;
  } catch {
    return 'Recently';
  }
}

/**
 * Format ISO or date string to readable date (e.g. "Sep 03, 2026")
 */
function formatDateAdded(dateStr?: string | null): string {
  if (!dateStr) return 'Recent';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: '2-digit',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

export const DeviceService = {
  /** Detect a brand from a real decoded capture, including before node registration. */
  async sniffRemoteBrand(ipAddress: string, expectedDeviceId?: string): Promise<{
    success: boolean; brand?: string; protocol?: string; rawType?: string; error?: string;
  }> {
    const address = ipAddress.trim();
    if (!address || address === '0.0.0.0') {
      return { success: false, error: 'Device local IP address is not available.' };
    }
    try {
      if (expectedDeviceId?.trim()) await probeController(address, [expectedDeviceId.trim()]);
      const data = await requestControllerJson(address, '/sniff-protocol', 8000);
      const rawType = typeof data.raw_type === 'string' ? data.raw_type.trim().toUpperCase() : '';
      // Accept known AC decoder families, not the firmware's timeout or synthetic RAW defaults.
      const decoders = [
        { pattern: /^MIDEA(?:24)?$/, protocol: 'midea_ir' },
        { pattern: /^GREE$/, protocol: 'gree' },
        { pattern: /^DAIKIN(?:2|64|128|152|160|176|200|216|312)?$/, protocol: 'daikin' },
        { pattern: /^CARRIER_AC(?:40|64|84|128)?$/, protocol: 'carrier' },
        { pattern: /^PANASONIC_AC(?:32)?$/, protocol: 'panasonic' },
        { pattern: /^SAMSUNG_AC$/, protocol: 'samsung' },
        { pattern: /^(?:MITSUBISHI_AC|MITSUBISHI112|MITSUBISHI136|MITSUBISHI_HEAVY_88|MITSUBISHI_HEAVY_152)$/, protocol: 'mitsubishi' },
      ];
      const decoded = decoders.find(candidate => candidate.pattern.test(rawType));
      if (data.success !== true || !decoded || data.protocol !== decoded.protocol ||
          typeof data.hex !== 'string' || !/^(?:0x)?[a-f\d]+$/i.test(data.hex.trim())) {
        return { success: false, error: 'No recognizable AC remote signal was captured.' };
      }
      return { success: true, brand: CapabilityEngine.getCapabilities(decoded.protocol).brand, protocol: decoded.protocol, rawType };
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') {
        return { success: false, error: 'Listening timed out. No IR remote signal was detected.' };
      }
      const message = error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
        ? error.message : 'Unable to communicate with the ESP32 local server.';
      return { success: false, error: message };
    }
  },

  /**
   * Fetch all registered AC controller devices directly from Supabase `nodes` table
   * joined with `rooms`, `floors`, and `buildings`.
   * Metadata mutations may supply their confirmed row to reuse the same mapping.
   */
  async getDevices(scope?: ReadScope, committedNode?: DbNode): Promise<Esp32Device[]> {
    try {
      const [nodesRes, roomsRes, floorsRes, buildingsRes, airconsRes] = await Promise.all([
        committedNode ? Promise.resolve({ data: [committedNode], error: null }) : fetchAccessibleRows(supabase, 'nodes', '*', undefined, scope),
        fetchAccessibleRows(supabase, 'rooms', '*', undefined, scope),
        fetchAccessibleRows(supabase, 'floors', '*', undefined, scope),
        fetchAccessibleRows(supabase, 'buildings', '*', undefined, scope),
        fetchAccessibleRows(supabase, 'aircons', '*', undefined, scope),
      ]);

      if (nodesRes.error) {
        console.warn('Error fetching nodes from Supabase:', nodesRes.error);
        return [];
      }

      const nodes: DbNode[] = nodesRes.data || [];
      const rooms: DbRoom[] = roomsRes.data || [];
      const floors: DbFloor[] = floorsRes.data || [];
      const buildings: DbBuilding[] = buildingsRes.data || [];

      const roomsMap = new Map<string, DbRoom>();
      rooms.forEach((r) => roomsMap.set(r.id, r));

      const floorsMap = new Map<string, DbFloor>();
      floors.forEach((f) => floorsMap.set(f.id, f));

      const buildingsMap = new Map<string, DbBuilding>();
      buildings.forEach((b) => buildingsMap.set(b.id, b));

      const metaPromises = nodes.map((node) => getStoredDeviceMeta(node.id));
      const metas = await Promise.all(metaPromises);

      return nodes.map((node, idx) => {
        const room = node.room_id ? roomsMap.get(node.room_id) : undefined;
        const floor = room?.floor_id ? floorsMap.get(room.floor_id) : undefined;
        const building = floor?.building_id ? buildingsMap.get(floor.building_id) : undefined;
        const storedMeta = metas[idx];

        // Parse owner metadata from photo_url or storedMeta
        let addedByUserId: string | undefined = undefined;
        let addedByUserEmail: string | undefined = undefined;
        let addedByUserName: string | undefined = undefined;

        if (node.photo_url) {
          try {
            const parsed = JSON.parse(node.photo_url);
            if (parsed && typeof parsed === 'object') {
              addedByUserId = parsed.addedByUserId;
              addedByUserEmail = parsed.addedByUserEmail;
              addedByUserName = parsed.addedByUserName || parsed.addedBy;
            }
          } catch {
            // Not a JSON string
          }
        }

        if (!addedByUserId && storedMeta?.addedByUserId) addedByUserId = storedMeta.addedByUserId;
        if (!addedByUserEmail && storedMeta?.addedByUserEmail) addedByUserEmail = storedMeta.addedByUserEmail;
        if (!addedByUserName && storedMeta?.addedByUserName) addedByUserName = storedMeta.addedByUserName;

        const isOnline = (node.status || '').toLowerCase() === 'online' || (node.status || '').toLowerCase() === 'connected';

        const airconsList = (airconsRes && airconsRes.data) ? airconsRes.data : [];
        const matchedAc = airconsList.find((a: any) => a.controller_node_id ? a.controller_node_id === node.id :
          (a.node_id && (a.node_id === node.name || a.node_id === node.id)));

        const resolvedBrand = (node.brand && node.brand.trim()) || 
          (matchedAc?.brand && matchedAc.brand.trim()) || 
          (node as any).aircon_brand || 
          storedMeta?.brand || 
          undefined;

        const resolvedMac = node.mac_address || storedMeta?.macAddress || undefined;
        const resolvedIp = node.ip_address || storedMeta?.ipAddress || undefined;
        const resolvedSsid = node.wifi_ssid || storedMeta?.wifiSsid || undefined;

        return {
          id: node.id,
          deviceId: node.id.startsWith('node_') ? `ESP32-${node.id.substring(5, 8).toUpperCase()}` : node.id,
          name: node.name,
          status: isOnline ? 'connected' : 'offline',
          temp: node.temp,
          pressure: node.pressure,
          rssi: node.rssi,
          battery: node.battery,
          wifiStatus: isOnline ? 'connected' : 'disconnected',
          wifiSsid: resolvedSsid,
          ipAddress: resolvedIp,
          lastSeen: formatLastSeen(node.updated || node.created),
          dateAdded: formatDateAdded(node.install_date || node.created),
          macAddress: resolvedMac,
          firmwareVersion: (node as any).firmware_version || undefined,
          building: building?.name,
          floor: floor?.name,
          room: room?.name,
          roomId: node.room_id,
          airconType: node.aircon_type || matchedAc?.aircon_type || undefined,
          brand: resolvedBrand,
          wakeTime: node.wake_time || undefined,
          sleepTime: node.sleep_time || undefined,
          intervalVal: node.interval_val ?? undefined,
          intervalUnit: node.interval_unit || undefined,
          created: node.created,
          updated: node.updated,
          addedByUserId,
          addedByUserEmail,
          addedByUserName,
        };
      });
    } catch (e) {
      scope?.recordError(e);
      console.error('Failed to get devices from Supabase:', e);
      return [];
    }
  },

  /**
   * Get single device by ID directly from Supabase
   */
  async getDeviceById(id: string): Promise<Esp32Device | null> {
    const devices = await this.getDevices();
    return devices.find((d) => d.id === id || d.deviceId === id) || null;
  },

  /**
   * Fetch all active rooms formatted for picker selection in Add/Edit device wizard
   */
  async fetchAvailableRooms(scope?: ReadScope): Promise<AvailableRoomOption[]> {
    try {
      const [roomsRes, floorsRes, buildingsRes, airconsRes, nodesRes, rawLocalAircons] = await Promise.all([
        fetchAccessibleRows(supabase, 'rooms', '*', undefined, scope),
        fetchAccessibleRows(supabase, 'floors', '*', undefined, scope),
        fetchAccessibleRows(supabase, 'buildings', '*', undefined, scope),
        fetchAccessibleRows(supabase, 'aircons', '*', undefined, scope),
        fetchAccessibleRows(supabase, 'nodes', '*', undefined, scope),
        AsyncStorage.getItem('@ecotrack_aircons_v1').catch(() => null),
      ]);

      const rooms: DbRoom[] = roomsRes.data || [];
      const floors: DbFloor[] = floorsRes.data || [];
      const buildings: DbBuilding[] = buildingsRes.data || [];
      const aircons: any[] = airconsRes.data || [];
      const nodes: any[] = nodesRes.data || [];

      let localAircons: any[] = [];
      if (rawLocalAircons) {
        try {
          localAircons = JSON.parse(rawLocalAircons);
        } catch {}
      }

      // Merge remote aircons and local aircons
      const allAircons = [...aircons, ...localAircons];

      const floorsMap = new Map<string, DbFloor>();
      floors.forEach((f) => floorsMap.set(f.id, f));

      const buildingsMap = new Map<string, DbBuilding>();
      buildings.forEach((b) => buildingsMap.set(b.id, b));

      return rooms.map((r) => {
        const floor = r.floor_id ? floorsMap.get(r.floor_id) : undefined;
        const building = floor?.building_id ? buildingsMap.get(floor.building_id) : undefined;

        const buildingName = building?.name || '';
        const floorName = floor?.name || '';
        const roomName = (r.name || '').trim();
        const rIdStr = String(r.id || '').trim().toLowerCase();

        // 1. Match Node from Supabase nodes table
        const matchedNode = nodes.find((n: any) => {
          if (!n) return false;
          if (n.room_id && String(n.room_id).trim().toLowerCase() === rIdStr) return true;
          if (n.room && n.room.trim().toLowerCase() === roomName.toLowerCase()) return true;
          if (n.room_name && n.room_name.trim().toLowerCase() === roomName.toLowerCase()) return true;
          if (n.name && roomName && n.name.trim().toLowerCase().includes(roomName.toLowerCase())) return true;
          if (n.name && roomName && roomName.toLowerCase().includes(n.name.trim().toLowerCase())) return true;
          return false;
        });

        // 2. Match Aircon from Admin Desktop aircons table
        const matchedAc = allAircons.find((a: any) => {
          if (!a) return false;
          const aRoomId = a.room_id ? String(a.room_id).trim().toLowerCase() : '';
          if (aRoomId && aRoomId === rIdStr) return true;

          // Match by node linking
          if (matchedNode) {
            const mNodeName = (matchedNode.name || '').trim().toLowerCase();
            const mNodeId = (matchedNode.id || '').trim().toLowerCase();
            const aNodeId = (a.node_id || '').trim().toLowerCase();
            if (aNodeId && (aNodeId === mNodeName || aNodeId === mNodeId)) return true;
          }

          // Match by room text in name or location
          const aName = (a.name || '').trim().toLowerCase();
          const aLoc = (a.location || a.roomName || a.room_name || '').trim().toLowerCase();
          const rLower = roomName.toLowerCase();
          if (rLower && (aName.includes(rLower) || aLoc.includes(rLower))) return true;

          return false;
        });

        // Derive aircon brand if already registered in aircons table or node
        const airconBrand =
          matchedAc?.brand?.trim() ||
          (matchedNode as any)?.brand?.trim() ||
          (matchedNode as any)?.aircon_brand?.trim() ||
          undefined;

        const airconType =
          matchedAc?.aircon_type ||
          matchedAc?.model ||
          matchedNode?.aircon_type ||
          undefined;

        const airconName = matchedAc?.name || (matchedNode ? `${roomName} AC` : undefined);
        const nodeName = matchedNode?.name || matchedNode?.id || undefined;

        return {
          id: r.id,
          name: roomName,
          floorName,
          buildingName,
          fullPath: [buildingName, floorName, roomName].filter(Boolean).join(' • ') || roomName,
          airconBrand,
          airconType,
          airconName,
          nodeName,
        };
      });
    } catch (e) {
      scope?.recordError(e);
      console.error('Failed to fetch rooms for device assignment:', e);
      return [];
    }
  },

  /**
   * Resolve room ID from an existing room ID or a custom typed room name.
   * If the custom room does not exist in Supabase, automatically create it.
   */
  async resolveRoomId(roomIdOrCustomName: string | null | undefined): Promise<string | null> {
    const value = roomIdOrCustomName?.trim();
    if (!value || value === 'unassigned') return null;
    // Keep custom names as tokens. The mutation RPC resolves/creates the room
    // together with the node and AC; a failed save cannot leave an orphan room.
    if (value.startsWith('custom:')) return value;
    const { data, error } = await supabase.from('rooms').select('id').eq('id', value).limit(1);
    if (error || !data?.length) throw new Error('Selected room could not be resolved. Refresh and select an existing room.');
    return data[0].id;
  },

  /**
   * Save a newly provisioned AC controller device directly into Supabase `nodes` table
   */
  async saveDevice(newDevice: {
    name: string;
    deviceId?: string;
    roomId?: string | null;
    airconType?: string;
    brand?: string;
    wifiSsid?: string;
    ipAddress?: string;
    macAddress?: string;
    temp?: number;
    pressure?: number;
    battery?: number;
    rssi?: number;
    addedByUserId?: string;
    addedByUserEmail?: string;
    addedByUserName?: string;
  }): Promise<Esp32Device> {
    const now = new Date().toISOString();
    const dateStr = now.split('T')[0];
    const name = newDevice.name.trim();
    if (!name) throw new Error('Device name is required.');
    const nodeId = newDevice.deviceId?.startsWith('node_') ? newDevice.deviceId :
      `node_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    const effectiveBrand = newDevice.brand?.trim() || '';
    const assetTag = newDevice.deviceId && !newDevice.deviceId.startsWith('node_') ? newDevice.deviceId : `AC-${nodeId}`;
    const { data: result, error } = await supabase.rpc('ecotrack_device_mutation', {
      p_operation: 'save_node', p_id: nodeId,
      p_payload: {
        name, room_id: newDevice.roomId || null, brand: effectiveBrand || null,
        aircon_type: newDevice.airconType?.trim() || null,
        mac_address: newDevice.macAddress || null, ip_address: newDevice.ipAddress || null,
        wifi_ssid: newDevice.wifiSsid || null, asset_tag: assetTag,
        protocol_name: CapabilityEngine.resolveProtocolName(effectiveBrand),
      },
    });
    if (error || !result?.node?.id || !result?.aircon?.id) {
      throw new Error(error?.message || 'Unable to save the node and AC. The atomic device migration must be deployed.');
    }
    const resolvedRoomId = result.node.room_id;
    // Persist real metadata
    await setStoredDeviceMeta(nodeId, {
      wifiSsid: newDevice.wifiSsid,
      ipAddress: newDevice.ipAddress,
      macAddress: newDevice.macAddress,
      brand: effectiveBrand || undefined,
      addedByUserId: newDevice.addedByUserId,
      addedByUserEmail: newDevice.addedByUserEmail,
      addedByUserName: newDevice.addedByUserName,
    });

    if (newDevice.addedByUserId) {
      await UserDeviceStorage.recordUserNode(newDevice.addedByUserId, nodeId);
    }
    if (newDevice.addedByUserEmail) {
      await UserDeviceStorage.recordUserNode(newDevice.addedByUserEmail, nodeId);
    }

    if (newDevice.wifiSsid) {
      await BleDeviceService.saveWifiSsid(newDevice.wifiSsid);
    }

    const createdDevice = await this.getDeviceById(nodeId);
    if (!createdDevice) {
      return {
        id: nodeId,
        name: newDevice.name.trim(),
        deviceId: nodeId,
        room: 'Unassigned',
        building: undefined,
        floor: undefined,
        status: 'offline',
        wifiStatus: 'disconnected',
        dateAdded: formatDateAdded(dateStr),
        roomId: resolvedRoomId,
        ipAddress: newDevice.ipAddress,
        macAddress: newDevice.macAddress,
        wifiSsid: newDevice.wifiSsid,
        temp: newDevice.temp,
        pressure: newDevice.pressure,
        battery: newDevice.battery,
        rssi: newDevice.rssi,
        firmwareVersion: undefined,
        lastSeen: 'Unverified',
        airconType: newDevice.airconType,
        brand: effectiveBrand,
        addedByUserId: newDevice.addedByUserId,
        addedByUserEmail: newDevice.addedByUserEmail,
        addedByUserName: newDevice.addedByUserName,
      };
    }
    return createdDevice;
  },

  /**
   * Update existing device metadata, room assignment, or name in Supabase
   */
  async updateDevice(id: string, updates: Partial<Esp32Device>): Promise<Esp32Device | null> {
    try {
      const dbUpdates: Record<string, unknown> = {};
      if (updates.name !== undefined) dbUpdates.name = updates.name.trim();
      if (updates.roomId !== undefined) dbUpdates.room_id = updates.roomId;
      if (updates.airconType !== undefined) dbUpdates.aircon_type = updates.airconType.trim();
      if (updates.brand !== undefined) {
        dbUpdates.brand = updates.brand.trim();
        dbUpdates.protocol_name = CapabilityEngine.resolveProtocolName(updates.brand);
      }
      if (updates.ipAddress !== undefined) dbUpdates.ip_address = updates.ipAddress;
      if (updates.macAddress !== undefined) dbUpdates.mac_address = updates.macAddress;
      if (updates.wifiSsid !== undefined) dbUpdates.wifi_ssid = updates.wifiSsid;
      if (updates.wakeTime !== undefined) dbUpdates.wake_time = updates.wakeTime;
      if (updates.sleepTime !== undefined) dbUpdates.sleep_time = updates.sleepTime;
      if (updates.intervalVal !== undefined) dbUpdates.interval_val = updates.intervalVal;
      if (updates.intervalUnit !== undefined) dbUpdates.interval_unit = updates.intervalUnit;
      // Observed status/telemetry belong to the hardware ingestion service.
      const { data, error } = await supabase.rpc('ecotrack_device_mutation', {
        p_operation: 'update_node', p_id: id, p_payload: dbUpdates,
      });
      if (error || data?.node?.id !== id) return null;
      if (updates.wifiSsid || updates.ipAddress || updates.brand) {
        await setStoredDeviceMeta(id, { wifiSsid: updates.wifiSsid, ipAddress: updates.ipAddress, brand: updates.brand });
      }
      // Use the row confirmed by the atomic transaction: a second node read can
      // fail after reassignment and must not turn a committed save into failure.
      return (await this.getDevices(undefined, data.node))[0] || null;
    } catch (error) {
      console.warn('Unable to update device:', error);
      return null;
    }
  },

  /** Atomically detach linked AC records before deleting a registered node. */
  async removeDevice(id: string, userKey?: string): Promise<boolean> {
    try {
      const { data, error } = await supabase.rpc('ecotrack_device_mutation', {
        p_operation: 'delete_node', p_id: id, p_payload: {},
      });
      if (error || data?.deleted !== true) return false;
      if (userKey) await UserDeviceStorage.removeUserNode(userKey, id);
      try { await AsyncStorage.removeItem(`@ecotrack_node_meta_${id}`); } catch { /* optional cache */ }
      return true;
    } catch { return false; }
  },

  /**
   * Real-time Postgres subscription to changes in `nodes`, `rooms`, `floors`, `buildings`
   */
  subscribeToDeviceChanges(onUpdate: () => void): () => void {
    const channelId = `device_mgmt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
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
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  },
};

// EcoTrack Hardware GATT UUIDs (matching firmware/ecotrack_esp32_s3/ecotrack_esp32_s3.ino)
export const ECOTRACK_BLE_SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
export const ECOTRACK_CHAR_DEVICE_INFO_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';
export const ECOTRACK_CHAR_WIFI_CONFIG_UUID = '1c95d5e3-d8f7-413a-bf3d-7a2e5d7be87e';
export const ECOTRACK_CHAR_IR_TRIGGER_UUID = 'd7c2b4e1-2294-4d89-980b-8d085df7c7e9';

let bleManagerInstance: any = null;

function getBleManager() {
  if (!bleManagerInstance) {
    try {
      const { BleManager } = require('react-native-ble-plx');
      bleManagerInstance = new BleManager();
    } catch {
      bleManagerInstance = null;
    }
  }
  return bleManagerInstance;
}

function toBase64(str: string): string {
  if (typeof btoa === 'function') {
    return btoa(str);
  }
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  let output = '';
  for (
    let block = 0, charCode, i = 0, map = chars;
    str.charAt(i | 0) || ((map = '='), i % 1);
    output += map.charAt(63 & (block >> (8 - (i % 1) * 8)))
  ) {
    charCode = str.charCodeAt((i += 3 / 4));
    if (charCode > 0xff) {
      throw new Error("'toBase64' failed: The string contains characters outside of the Latin1 range.");
    }
    block = (block << 8) | charCode;
  }
  return output;
}

function fromBase64(input: string): string {
  if (typeof atob === 'function') {
    return atob(input);
  }
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  let str = input.replace(/=+$/, '');
  let output = '';
  if (str.length % 4 === 1) {
    throw new Error("'fromBase64' failed: The string to be decoded is not correctly encoded.");
  }
  for (
    let bc = 0, bs = 0, buffer, i = 0;
    (buffer = str.charAt(i++));
    ~buffer && ((bs = bc % 4 ? bs * 64 + buffer : buffer), bc++ % 4)
      ? (output += String.fromCharCode(255 & (bs >> ((-2 * bc) & 6))))
      : 0
  ) {
    buffer = chars.indexOf(buffer);
  }
  return output;
}

async function requestBlePermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;

  try {
    if (Platform.Version >= 31) {
      const granted = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
      ]);

      const scanGranted = granted[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] === PermissionsAndroid.RESULTS.GRANTED;
      const connectGranted = granted[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] === PermissionsAndroid.RESULTS.GRANTED;
      const locationGranted = granted[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] === PermissionsAndroid.RESULTS.GRANTED;
      return scanGranted && connectGranted && locationGranted;
    } else {
      const granted = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
      ]);
      return granted[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] === PermissionsAndroid.RESULTS.GRANTED;
    }
  } catch {
    return false;
  }
}

/**
 * Service for ESP32 Bluetooth Low Energy (BLE) & Wi-Fi Provisioning
 */
export const BleDeviceService = {
  /**
   * Scan for actual nearby ESP32-S3 EcoTrack Nodes over physical BLE or unassigned nodes in Supabase
   */
  async scanNearbyDevices(): Promise<BleDiscoveredDevice[]> {
    const discoveredMap = new Map<string, BleDiscoveredDevice>();
    const manager = getBleManager();

    // A failed physical scan must not be disguised by the database fallback.
    if (Platform.OS === 'web') throw new Error('Bluetooth scanning requires the installed EcoTrack app.');
    if (!manager) throw new Error('Bluetooth could not initialize. Install an EcoTrack APK built with Bluetooth support.');
    {
      const hasPerms = await requestBlePermissions();
      if (!hasPerms) throw new Error('Bluetooth and precise location permissions are required to scan for devices.');
      {
        try {
          let state = await manager.state();
          if (state === 'Unknown' || state === 'Resetting') {
            state = await new Promise<string>((resolve) => {
              const timer = setTimeout(() => { subscription.remove(); resolve('Unknown'); }, 4000);
              const subscription = manager.onStateChange((next: string) => {
                if (next !== 'Unknown' && next !== 'Resetting') {
                  clearTimeout(timer); subscription.remove(); resolve(next);
                }
              }, false);
            });
          }
          if (state === 'PoweredOff') throw new Error('Bluetooth is disabled. Turn Bluetooth on and scan again.');
          if (state === 'Unauthorized') throw new Error('Bluetooth permission is required to scan for devices.');
          if (state !== 'PoweredOn') throw new Error('Bluetooth is unavailable or has not finished initializing.');
          if (state === 'PoweredOn') {
            await new Promise<void>((resolve, reject) => {
              const timeout = setTimeout(() => {
                try { manager.stopDeviceScan(); } catch { /* ignore */ }
                resolve();
              }, 8000);

              manager.startDeviceScan(
                null,
                { allowDuplicates: true },
                (error: any, device: any) => {
                  if (error) {
                    clearTimeout(timeout);
                    try { manager.stopDeviceScan(); } catch { /* ignore */ }
                    const message = error.errorCode === 601
                      ? 'Location services are disabled. Turn Location on and scan again.'
                      : 'Bluetooth scan failed. Check Bluetooth and location permissions, then retry.';
                    reject(new Error(message));
                    return;
                  }

                  if (device) {
                    const devName = (device.name || device.localName || '').trim();
                    const devId = device.id || '';
                    const isEcoService =
                      Array.isArray(device.serviceUUIDs) &&
                      device.serviceUUIDs.some(
                        (u: string) => u.toLowerCase() === ECOTRACK_BLE_SERVICE_UUID.toLowerCase()
                      );
                    const isEcoName =
                      devName.toLowerCase().includes('ecotrack') ||
                      devName.toLowerCase().includes('esp32') ||
                      devName.toLowerCase().startsWith('node');

                    if (isEcoService || isEcoName || devName.length > 0) {
                      const cleanId = devName ? devName.replace(/^EcoTrack-?/i, '') : devId;
                      discoveredMap.set(devId, {
                        id: devId,
                        bleId: devId,
                        deviceId: cleanId,
                        name: devName || `EcoTrack Node (${devId.slice(-5)})`,
                        pingMs: null,
                        macAddress: devId,
                        isEcoTrackDevice: isEcoService || isEcoName,
                      });
                    }
                  }
                }
              );
            });
          }
        } catch (error) {
          try { manager.stopDeviceScan(); } catch { /* scan already stopped */ }
          if (error instanceof Error) throw error;
          throw new Error('Bluetooth scan failed. Restart Bluetooth and retry.');
        }
      }
    }

    // 2. Discover unassigned nodes from Supabase
    try {
      const { data: unassignedNodes } = await supabase
        .from('nodes')
        .select('*')
        .is('room_id', null);

      if (unassignedNodes && unassignedNodes.length > 0) {
        unassignedNodes.forEach((node) => {
          if (!discoveredMap.has(node.id)) {
            discoveredMap.set(node.id, {
              id: node.id,
              bleId: node.mac_address || undefined,
              deviceId: node.id,
              name: node.name || `Node ${node.id}`,
              pingMs: null,
              macAddress: node.mac_address || '',
              isEcoTrackDevice: true,
            });
          }
        });
      }
    } catch {
      // ignore
    }

    return Array.from(discoveredMap.values());
  },

  /** Resolve legacy/manual node identities by discovery, never by shortening a name. */
  async resolveBleIdentifier(device: { bleId?: string; macAddress?: string; id?: string; deviceId?: string; name?: string }): Promise<string> {
    const nativeId = device.bleId || device.macAddress || device.id || '';
    if (/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(nativeId) || /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(nativeId)) return nativeId;
    const nearby = await this.scanNearbyDevices();
    const match = nearby.find(candidate => candidate.bleId &&
      [candidate.id, candidate.deviceId, candidate.name].some(value =>
        [device.id, device.deviceId, device.name].includes(value)));
    if (!match?.bleId) throw new Error('Controller Bluetooth identifier is unavailable. Rescan near the powered ESP32 and select it.');
    return match.bleId;
  },

  /**
   * Connect to an ESP32 device over physical BLE GATT service
   */
  async connectBle(deviceId: string): Promise<boolean> {
    const manager = getBleManager();
    if (!manager) return false;

    try {
      const device = await manager.connectToDevice(deviceId, { autoConnect: false, timeout: 8000 });
      await device.discoverAllServicesAndCharacteristics();
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Get remembered / saved facility Wi-Fi networks from AsyncStorage (No fake mock data)
   */
  async getSavedWifiNetworks(): Promise<WifiNetwork[]> {
    try {
      const raw = await AsyncStorage.getItem('@ecotrack_saved_wifi_ssids');
      if (raw) {
        const list: string[] = JSON.parse(raw);
        return list.map((ssid) => ({ ssid, isSecure: true }));
      }
    } catch {
      // ignore
    }
    return [];
  },

  /**
   * Save a newly configured Wi-Fi network SSID into local storage
   */
  async saveWifiSsid(ssid: string): Promise<void> {
    if (!ssid || !ssid.trim()) return;
    try {
      const trimmed = ssid.trim();
      const raw = await AsyncStorage.getItem('@ecotrack_saved_wifi_ssids');
      const list: string[] = raw ? JSON.parse(raw) : [];
      if (!list.includes(trimmed)) {
        list.unshift(trimmed);
        await AsyncStorage.setItem('@ecotrack_saved_wifi_ssids', JSON.stringify(list.slice(0, 10)));
      }
    } catch {
      // ignore
    }
  },

  /**
   * Remove a saved Wi-Fi network SSID from local storage
   */
  async removeSavedWifiSsid(ssid: string): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem('@ecotrack_saved_wifi_ssids');
      const list: string[] = raw ? JSON.parse(raw) : [];
      const filtered = list.filter((s) => s !== ssid);
      await AsyncStorage.setItem('@ecotrack_saved_wifi_ssids', JSON.stringify(filtered));
    } catch {
      // ignore
    }
  },

  /** Read the connected phone network; browsers cannot expose Wi-Fi SSIDs. */
  async getConnectedPhoneWifi(): Promise<ConnectedPhoneWifi> {
    if (Platform.OS === 'web') {
      return { ssid: null, isWifi: false, error: 'unsupported' };
    }
    try {
      /* eslint-disable @typescript-eslint/no-require-imports -- Lazy native modules preserve manual entry in older builds. */
      if (Platform.OS === 'ios' && require('expo-constants').default.appOwnership === 'expo') {
        return { ssid: null, isWifi: false, error: 'unsupported' };
      }
      // Keep manual provisioning available on web and installations without these native modules.
      const NetInfo: typeof import('@react-native-community/netinfo').default = require('@react-native-community/netinfo').default;
      const Location: typeof import('expo-location') = require('expo-location');
      /* eslint-enable @typescript-eslint/no-require-imports */
      let permissionError: ConnectedPhoneWifi['error'];
      if (!await Location.hasServicesEnabledAsync()) {
        permissionError = 'location-disabled';
      } else {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (!permission.granted) permissionError = 'permission-denied';
        else if (permission.android?.accuracy === 'coarse' || permission.ios?.accuracy === 'reduced') {
          permissionError = 'precise-location-required';
        }
      }
      // Only enable Apple's SSID API with the entitlement and precise foreground permission.
      // Repeated configure() calls reset NetInfo listeners, so configure only when this changes.
      if (Platform.OS === 'ios' && iosWifiSsidEnabled !== !permissionError) {
        iosWifiSsidEnabled = !permissionError;
        NetInfo.configure({ shouldFetchWiFiSSID: iosWifiSsidEnabled });
      }
      if (permissionError) return { ssid: null, isWifi: false, error: permissionError };

      // Refresh the actual connection type; fetch('wifi') can label cellular as Wi-Fi on Android.
      const state = await NetInfo.refresh();
      if (state.type !== 'wifi' || state.isConnected !== true) return { ssid: null, isWifi: false };
      const ssid = state.details.ssid?.replace(/^"(.*)"$/, '$1').trim() || null;
      return {
        ssid: ssid && ssid.toLowerCase() !== '<unknown ssid>' ? ssid : null,
        isWifi: true,
        details: state.details,
      };
    } catch {
      return { ssid: null, isWifi: false, error: 'unavailable' };
    }
  },

  /** Connected phone Wi-Fi followed by known saved and registered facility SSIDs. */
  async scanWifiNetworks(phoneWifi?: ConnectedPhoneWifi): Promise<WifiNetwork[]> {
    const list: WifiNetwork[] = [];
    const seen = new Set<string>();
    const phone = phoneWifi ?? await this.getConnectedPhoneWifi();
    if (phone.isWifi && phone.ssid) {
      const mhz = phone.details?.frequency;
      const frequency = mhz && mhz >= 2400 && mhz < 2500 ? '2.4 GHz'
        : mhz && mhz >= 4900 && mhz < 5925 ? '5 GHz'
        : mhz && mhz >= 5925 && mhz <= 7125 ? '6 GHz' : undefined;
      seen.add(phone.ssid);
      list.push({ ssid: phone.ssid, isConnectedPhone: true, isSaved: false, isSecure: true, frequency });
    }

    // 1. Saved facility networks from local storage
    try {
      const saved = await this.getSavedWifiNetworks();
      for (const net of saved) {
        if (net.ssid === phone.ssid && list[0]?.isConnectedPhone) list[0].isSaved = true;
        if (net.ssid && !seen.has(net.ssid)) {
          seen.add(net.ssid);
          list.push({
            ...net,
            isSaved: true,
            frequency: '2.4 GHz',
            isSecure: true,
          });
        }
      }
    } catch {
      // ignore
    }

    // 2. Discover SSIDs from registered facility nodes in Supabase
    try {
      const { data } = await supabase
        .from('nodes')
        .select('wifi_ssid')
        .not('wifi_ssid', 'is', null)
        .limit(20);

      if (data && Array.isArray(data)) {
        for (const item of data) {
          const ssid = (item.wifi_ssid || '').trim();
          if (ssid && !seen.has(ssid)) {
            seen.add(ssid);
            list.push({
              ssid,
              isSaved: false,
              isSecure: true,
              frequency: '2.4 GHz',
            });
          }
        }
      }
    } catch {
      // ignore
    }

    return list;
  },

  /**
   * Send Wi-Fi credentials to ESP32 over physical BLE GATT characteristic
   */
  async configureWifi(
    deviceId: string,
    ssid: string,
    password: string,
    onProgress?: (step: number, message: string) => void
  ): Promise<{ success: boolean; ipAddress: string; error?: string }> {
    const manager = getBleManager();
    if (!manager) {
      return {
        success: false,
        ipAddress: '',
        error: 'Bluetooth hardware transport is not available. Please verify Bluetooth is enabled.',
      };
    }

    try {
      if (!ssid.trim() || encodeURIComponent(ssid).replace(/%[0-9A-F]{2}/g, 'x').length > 32 ||
          (password.length !== 0 && (password.length < 8 || password.length > 64 ||
          (password.length === 64 && !/^[0-9a-f]+$/i.test(password))))) {
        throw new Error('Enter a valid Wi-Fi SSID and WPA password.');
      }
      onProgress?.(0, 'Connecting to ESP32 over BLE...');
      const existing = await manager.isDeviceConnected(deviceId);
      const device = existing ? (await manager.devices([deviceId]))[0]
        : await manager.connectToDevice(deviceId, { autoConnect: false, timeout: 10000 });
      await device.discoverAllServicesAndCharacteristics();
      if (Platform.OS === 'android') await device.requestMTU(512);
      onProgress?.(1, 'ESP32 Bluetooth connection confirmed.');

      const requestId = `wifi-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
      const payload = JSON.stringify({ ssid, pass: password, request_id: requestId });
      const base64Data = toBase64(encodeURIComponent(payload).replace(/%([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))));

      await device.writeCharacteristicWithResponseForService(
        ECOTRACK_BLE_SERVICE_UUID,
        ECOTRACK_CHAR_WIFI_CONFIG_UUID,
        base64Data
      );

      onProgress?.(2, 'Credentials transmitted; awaiting ESP32 Wi-Fi confirmation.');
      let assignedIp = '';
      const deadline = Date.now() + 45000;
      while (Date.now() < deadline && !assignedIp) {
        let parsed: any = null;
        try {
          const infoChar = await device.readCharacteristicForService(
            ECOTRACK_BLE_SERVICE_UUID,
            ECOTRACK_CHAR_DEVICE_INFO_UUID
          );
          if (infoChar?.value) {
            const jsonStr = decodeURIComponent(Array.from(fromBase64(infoChar.value), char => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''));
            parsed = JSON.parse(jsonStr);
          }
        } catch { /* The controller may still be updating its response. */ }
        if (parsed?.request_id === requestId && parsed?.wifi_ssid === ssid) {
          if (parsed.wifi_status === 'error') throw new Error('ESP32 could not connect to Wi-Fi. Check the password, 2.4 GHz network and signal.');
          if (parsed.wifi_status === 'connected' && typeof parsed.ip === 'string' &&
              /^(?:\d{1,3}\.){3}\d{1,3}$/.test(parsed.ip) && parsed.ip !== '0.0.0.0' &&
              parsed.ip.split('.').every((part: string) => Number(part) <= 255)) assignedIp = parsed.ip;
        }
        if (!assignedIp) await new Promise(resolve => setTimeout(resolve, 500));
      }
      if (!assignedIp) throw new Error('ESP32 did not confirm this Wi-Fi connection. Check the controller firmware and retry.');
      onProgress?.(3, 'ESP32 Wi-Fi connected. Internet/backend access has not been verified.');

      await this.saveWifiSsid(ssid);
      onProgress?.(4, 'Confirmed network profile saved.');

      return {
        success: true,
        ipAddress: assignedIp,
      };
    } catch (err: any) {
      const message = String(err?.message || '');
      return {
        success: false,
        ipAddress: '',
        error: /^(Enter a valid Wi-Fi|ESP32 could not connect|ESP32 did not confirm)/.test(message)
          ? message : 'Bluetooth communication failed during Wi-Fi setup. Reconnect to the ESP32 and retry.',
      };
    }
  },

  /**
   * Run live connection and diagnostics test on a device
   */
  async testDeviceConnection(deviceId: string): Promise<{
    online: boolean;
    pingMs: number;
    wifiSignal: string;
  }> {
    try {
      const { data, error } = await supabase.from('nodes').select('id,name,ip_address').eq('id', deviceId).limit(1);
      if (error || !data?.[0]?.ip_address) throw new Error('No registered local address.');
      const node = data[0];
      const probe = await probeController(node.ip_address, [node.id, node.name]);
      return { online: true, pingMs: probe.pingMs, wifiSignal: probe.rssi === undefined ? 'Local controller reached' : `${probe.rssi} dBm · Local controller reached` };
    } catch {
      return { online: false, pingMs: 0, wifiSignal: 'Local controller unreachable or identity unverified' };
    }
  },
};
