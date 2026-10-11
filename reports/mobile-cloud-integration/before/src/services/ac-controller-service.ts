import { exactMatchFilter, fetchAccessibleRows } from './query-utils';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, DbNode, DbRoom, DbFloor } from './supabase';
import { probeController, requestControllerJson } from './device-transport';

export interface ProtocolCapability {
  protocolName: string;
  brand: string;
  label: string;
  minTemp: number;
  maxTemp: number;
  modes: string[];
  fans: string[];
  swing: boolean;
  turbo: boolean;
  eco: boolean;
  sleep: boolean;
  timer: boolean;
}

export const SUPPORTED_IR_PROTOCOLS: Record<string, ProtocolCapability> = {
  midea_ir: {
    protocolName: 'midea_ir',
    brand: 'Midea',
    label: 'Midea / Carrier / Comfee (climate_ir: midea)',
    minTemp: 16,
    maxTemp: 30,
    modes: ['cool', 'dry', 'fan', 'auto', 'heat'],
    fans: ['low', 'medium', 'high', 'auto'],
    swing: true,
    turbo: true,
    eco: true,
    sleep: true,
    timer: true,
  },
  gree: {
    protocolName: 'gree',
    brand: 'Gree',
    label: 'Gree Electric / Tosot (climate_ir: gree)',
    minTemp: 16,
    maxTemp: 30,
    modes: ['cool', 'dry', 'fan', 'auto', 'heat'],
    fans: ['low', 'medium', 'high', 'auto', 'turbo'],
    swing: true,
    turbo: true,
    eco: true,
    sleep: true,
    timer: true,
  },
  daikin: {
    protocolName: 'daikin',
    brand: 'Daikin',
    label: 'Daikin ARC433 / ARC4xx (climate_ir: daikin)',
    minTemp: 18,
    maxTemp: 32,
    modes: ['cool', 'dry', 'fan', 'auto', 'heat'],
    fans: ['low', 'medium', 'high', 'auto', 'quiet'],
    swing: true,
    turbo: true,
    eco: true,
    sleep: true,
    timer: true,
  },
  carrier: {
    protocolName: 'carrier',
    brand: 'Carrier',
    label: 'Carrier Inverter / Optima (climate_ir: carrier)',
    minTemp: 17,
    maxTemp: 30,
    modes: ['cool', 'dry', 'fan', 'auto'],
    fans: ['low', 'medium', 'high', 'auto'],
    swing: true,
    turbo: true,
    eco: true,
    sleep: true,
    timer: true,
  },
  panasonic: {
    protocolName: 'panasonic',
    brand: 'Panasonic',
    label: 'Panasonic CS Series (climate_ir: panasonic)',
    minTemp: 16,
    maxTemp: 30,
    modes: ['cool', 'dry', 'fan', 'auto', 'heat'],
    fans: ['low', 'medium', 'high', 'auto'],
    swing: true,
    turbo: true,
    eco: true,
    sleep: true,
    timer: true,
  },
  koppel_ir: {
    protocolName: 'koppel_ir',
    brand: 'Koppel',
    label: 'Koppel Split / Window (climate_ir: koppel)',
    minTemp: 16,
    maxTemp: 30,
    modes: ['cool', 'dry', 'fan', 'auto'],
    fans: ['low', 'medium', 'high', 'auto'],
    swing: true,
    turbo: true,
    eco: true,
    sleep: true,
    timer: true,
  },
  mitsubishi: {
    protocolName: 'mitsubishi',
    brand: 'Mitsubishi',
    label: 'Mitsubishi Heavy / Electric (climate_ir: mitsubishi)',
    minTemp: 16,
    maxTemp: 31,
    modes: ['cool', 'dry', 'fan', 'auto', 'heat'],
    fans: ['low', 'medium', 'high', 'auto', 'silent'],
    swing: true,
    turbo: true,
    eco: true,
    sleep: true,
    timer: true,
  },
  samsung: {
    protocolName: 'samsung',
    brand: 'Samsung',
    label: 'Samsung WindFree / Digital (climate_ir: samsung)',
    minTemp: 16,
    maxTemp: 30,
    modes: ['cool', 'dry', 'fan', 'auto', 'heat'],
    fans: ['low', 'medium', 'high', 'auto', 'turbo'],
    swing: true,
    turbo: true,
    eco: true,
    sleep: true,
    timer: true,
  },
  generic_ac: {
    protocolName: 'generic_ac',
    brand: 'Generic',
    label: 'Universal Generic AC (climate_ir: generic)',
    minTemp: 16,
    maxTemp: 30,
    modes: ['cool', 'dry', 'fan', 'auto'],
    fans: ['low', 'medium', 'high', 'auto'],
    swing: true,
    turbo: false,
    eco: true,
    sleep: true,
    timer: true,
  },
};

export const CapabilityEngine = {
  resolveProtocolName(brandOrProtocol?: string): string {
    if (!brandOrProtocol) return 'unverified';
    const raw = brandOrProtocol.toLowerCase().trim();
    if (raw === 'daikin2') return 'daikin';
    if (SUPPORTED_IR_PROTOCOLS[raw]) return raw;
    const profile = Object.values(SUPPORTED_IR_PROTOCOLS).find(candidate => candidate.brand.toLowerCase() === raw);
    return profile?.protocolName || 'unverified';
  },

  getCapabilities(brandOrProtocol?: string): ProtocolCapability {
    const proto = this.resolveProtocolName(brandOrProtocol);
    const profile = SUPPORTED_IR_PROTOCOLS[proto] || { ...SUPPORTED_IR_PROTOCOLS.generic_ac, protocolName: 'unverified', brand: 'Unverified', label: 'Protocol verification required' };
    // The supplied firmware encoders are placeholders; these are registration
    // profiles, not evidence that a physical unit supports any command.
    return { ...profile, modes: [], fans: [], swing: false, turbo: false, eco: false, sleep: false, timer: false };
  },

  isSupported(brandOrProtocol: string, feature: string, value?: any): boolean {
    return false;
  },

  clampTemperature(brandOrProtocol: string, temp: number): number {
    const caps = this.getCapabilities(brandOrProtocol);
    return Math.max(caps.minTemp, Math.min(caps.maxTemp, temp));
  },

  getSupportedProtocols(): ProtocolCapability[] {
    return [];
  }
};

export interface AcControllerDevice {
  id: string; // e.g. "AC-001" or node ID
  deviceId: string; // Unique AC unit identifier e.g. "AC-001"
  name: string; // e.g. "Server Room A AC (node-1)"
  brand: string; // e.g. "Daikin", "Carrier", "Koppel", "Panasonic", "LG", etc.
  model: string; // e.g. "FTKC25TVM"
  nodeId: string; // Bound ESP32 AC Controller node name e.g. "node-1"
  nodeIp?: string;
  roomId?: string | null;
  roomName: string;
  location: string;
  airconType: string; // "Split Type (Inverter)", etc.
  protocol: string; // "midea_ir", "daikin", "gree", "carrier", etc.
  protocolName?: string;
  status: 'online' | 'offline' | 'standby';
  temp?: number;
  setTemp?: number;
  power?: 'ON' | 'OFF';
  desiredState?: Record<string, any>;
  registeredBy?: string;
  created?: string;
  updated?: string;
  irCommandsCount?: number;
}

export interface IrCommand {
  id: string;
  deviceId: string;
  commandType: string;
  protocol: string;
  rawData: string;
  decodedData: string;
  createdAt: string;
}

export const STANDARD_IR_FUNCTIONS = [
  { type: 'POWER_ON', label: 'Power ON', icon: 'power' },
  { type: 'POWER_OFF', label: 'Power OFF', icon: 'power-off' },
  { type: 'TEMP_UP', label: 'Temp +', icon: 'arrow-up' },
  { type: 'TEMP_DOWN', label: 'Temp -', icon: 'arrow-down' },
  { type: 'MODE_COOL', label: 'Mode: Cool', icon: 'snowflake' },
  { type: 'FAN_AUTO', label: 'Fan: Auto', icon: 'fan' },
];

export const POPULAR_AC_BRANDS = [
  'Daikin',
  'Carrier',
  'Koppel',
  'Panasonic',
  'LG',
  'Mitsubishi',
  'Samsung',
  'Kolin',
  'TCL',
  'Midea',
  'Haier',
  'Condura',
  'Fujidenzo',
  'Sharp',
  'Gree',
  'Other / Generic',
];

const STORAGE_KEYS = {
  AIRCONS: '@ecotrack_aircons',
  IR_COMMANDS: '@ecotrack_ir_commands',
  CUSTOM_FUNCS_PREFIX: '@ecotrack_custom_funcs_',
};

export const AcControllerService = {
  getProtocolForBrand(brand: string): string {
    return CapabilityEngine.resolveProtocolName(brand);
  },

  async sniffProtocol(nodeId: string, nodeIp?: string): Promise<{ success: boolean; protocol: string; brand: string; source: string }> {
    if (nodeIp && nodeId.trim()) {
      try {
        const { data: nodes, error } = await supabase.from('nodes').select('id,name')
          .or(exactMatchFilter(['id', 'name'], nodeId)).limit(2);
        if (error || nodes?.length !== 1) throw new Error('Registered controller could not be resolved.');
        await probeController(nodeIp, [nodes[0].id, nodes[0].name]);
        const data = await requestControllerJson(nodeIp, '/sniff-protocol');
        const decodedProtocols: Record<string, string> = {
          MIDEA: 'midea_ir', GREE: 'gree', DAIKIN: 'daikin', CARRIER_AC: 'carrier',
          PANASONIC_AC: 'panasonic', SAMSUNG_AC: 'samsung', MITSUBISHI_AC: 'mitsubishi',
        };
        // Firmware reports success even on timeout. Only accept an actual known
        // decoder result, never its configured-aircon or synthetic RAW fallback.
        const protocol = typeof data.raw_type === 'string' ? decodedProtocols[data.raw_type.toUpperCase()] : undefined;
        if (data.success === true && protocol && data.protocol === protocol && typeof data.hex === 'string' && /^[a-f\d]+$/i.test(data.hex)) {
          return { success: true, protocol, brand: SUPPORTED_IR_PROTOCOLS[protocol].brand, source: 'hardware' };
        }
      } catch (e) {
        console.warn('Node sniff request timed out or unreached:', e);
      }
    }
    return {
      success: false,
      protocol: '',
      brand: '',
      source: 'unreached',
    };
  },

  async getAllAircons(): Promise<AcControllerDevice[]> {
    try {
      const [nodesRes, roomsRes, floorsRes, airconsRes] = await Promise.all([
        fetchAccessibleRows(supabase, 'nodes', '*'),
        fetchAccessibleRows(supabase, 'rooms', '*'),
        fetchAccessibleRows(supabase, 'floors', '*'),
        fetchAccessibleRows(supabase, 'aircons', '*'),
      ]);

      if ([nodesRes, roomsRes, floorsRes, airconsRes].some(result => result.error)) throw new Error('Unable to load AC controllers.');

      const roomsMap = new Map<string, DbRoom>();
      (roomsRes.data || []).forEach((r: DbRoom) => roomsMap.set(r.id, r));

      const floorsMap = new Map<string, DbFloor>();
      (floorsRes.data || []).forEach((f: DbFloor) => floorsMap.set(f.id, f));

      const combined: AcControllerDevice[] = [];
      const seenIds = new Set<string>();

      // 1. Process real aircons from Supabase aircons table (master source of user-entered brands)
      if (airconsRes.data && airconsRes.data.length > 0) {
        airconsRes.data.forEach((ac: any) => {
          const devId = ac.asset_tag || ac.id;
          seenIds.add(devId);
          if (ac.node_id) seenIds.add(ac.node_id);

          const matchedNode = (nodesRes.data || []).find((n: DbNode) => ac.controller_node_id ? n.id === ac.controller_node_id : (n.name === ac.node_id || n.id === ac.node_id));
          const rId = ac.room_id || matchedNode?.room_id;
          const room = rId ? roomsMap.get(rId) : undefined;
          const floor = room?.floor_id ? floorsMap.get(room.floor_id) : undefined;
          const roomName = room?.name || 'Unassigned';
          const floorName = floor?.name || '';
          const location = floorName ? `${roomName} (${floorName})` : roomName;
          const proto = ac.protocol || (ac.brand ? CapabilityEngine.resolveProtocolName(ac.brand) : 'generic_ac');
          const isOnline = matchedNode ? ['online', 'connected'].includes(matchedNode.status) : false;

          combined.push({
            id: ac.id || devId,
            deviceId: devId,
            name: `${roomName} AC (${ac.node_id || devId})`,
            brand: ac.brand, // Exact dynamically entered brand from Admin or Mobile Staff!
            model: ac.model || ac.aircon_type || '',
            nodeId: ac.node_id || '',
            nodeIp: matchedNode?.ip_address || undefined,
            roomId: rId,
            roomName,
            location,
            airconType: ac.aircon_type || ac.model || '',
            protocol: proto,
            protocolName: ac.protocol_name || ac.protocol || proto,
            status: isOnline ? 'online' : 'offline',
            temp: matchedNode?.temp != null ? Number(matchedNode.temp) : undefined,
            setTemp: Number.isFinite(ac.desired_state?.temp) ? ac.desired_state.temp : undefined,
            desiredState: ac.desired_state || undefined,
            // Remote buttons reflect the last requested state; sensor badges use observed telemetry.
            power: ac.desired_state?.power === 'on' || ac.desired_state?.power === true ? 'ON' :
              ac.desired_state?.power === 'off' || ac.desired_state?.power === false ? 'OFF' : undefined,
            created: ac.created_at,
            updated: ac.updated_at,
          });
        });
      }

      return combined;
    } catch (err) {
      console.warn('Failed to load aircon controllers:', err);
      return [];
    }
  },

  async getAirconById(deviceId: string): Promise<AcControllerDevice | null> {
    const list = await this.getAllAircons();
    return list.find((a) => a.deviceId === deviceId || a.id === deviceId) || null;
  },

  async saveAircon(payload: Partial<AcControllerDevice>): Promise<AcControllerDevice> {
    const deviceId = payload.deviceId?.trim();
    const brand = payload.brand?.trim();
    if (!deviceId || !brand) throw new Error('Device ID and aircon brand are required.');
    const protocol = payload.protocolName || payload.protocol || CapabilityEngine.resolveProtocolName(brand);
    const { data, error } = await supabase.rpc('ecotrack_device_mutation', {
      p_operation: 'save_aircon',
      p_id: deviceId,
      p_payload: {
        brand, model: payload.model || null, aircon_type: payload.airconType || payload.model || null,
        room_id: payload.roomId || null, node_id: payload.nodeId?.trim() || null, protocol_name: protocol,
      },
    });
    if (error || !data?.aircon?.id) {
      throw new Error(error?.message || 'Unable to save the AC controller. The atomic device migration must be deployed.');
    }
    const saved = data.aircon;
    const fullDevice: AcControllerDevice = {
      id: saved.id, deviceId: saved.asset_tag, name: payload.name || `AC Unit (${saved.asset_tag})`,
      brand: saved.brand, model: saved.model || '', nodeId: saved.node_id || '', roomId: saved.room_id,
      roomName: payload.roomName || 'Unassigned', location: payload.location || payload.roomName || 'Unassigned',
      airconType: saved.aircon_type || '', protocol: saved.protocol_name, protocolName: saved.protocol_name,
      status: saved.status === 'online' ? 'online' : 'offline',
      created: saved.created_at, updated: saved.updated_at,
    };
    // Cache writes are optional after the server has committed both records.
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEYS.AIRCONS);
      const aircons: AcControllerDevice[] = stored ? JSON.parse(stored) : [];
      const filtered = aircons.filter(ac => ac.id !== fullDevice.id && ac.deviceId !== fullDevice.deviceId);
      await AsyncStorage.setItem(STORAGE_KEYS.AIRCONS, JSON.stringify([...filtered, fullDevice]));
    } catch (error) { console.warn('Unable to cache saved AC controller:', error); }
    return fullDevice;
  },

  async deleteAircon(deviceId: string): Promise<boolean> {
    if (!deviceId.trim()) return false;
    try {
      const { data, error } = await supabase.rpc('ecotrack_device_mutation', {
        p_operation: 'delete_aircon', p_id: deviceId, p_payload: {},
      });
      if (error || data?.deleted !== true) return false;
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEYS.AIRCONS);
        const aircons: AcControllerDevice[] = raw ? JSON.parse(raw) : [];
        await AsyncStorage.setItem(STORAGE_KEYS.AIRCONS, JSON.stringify(aircons.filter(ac => ac.deviceId !== deviceId && ac.id !== deviceId && ac.id !== data.id)));
      } catch (error) { console.warn('Unable to clear AC controller cache:', error); }
      return true;
    } catch { return false; }
  },

  // Legacy command stubs preserved to guarantee backward compatibility
  async getAllIrCommands(): Promise<IrCommand[]> {
    return [];
  },

  async getCommandsForDevice(deviceId: string): Promise<IrCommand[]> {
    return [];
  },

  async saveIrCommand(cmd: any): Promise<any> {
    throw new Error('IR command storage is unavailable until a verified hardware transport is configured.');
  },

  async deleteIrCommand(deviceId: string, commandType: string): Promise<boolean> {
    return false;
  },

  async getCustomFunctions(deviceId: string): Promise<string[]> {
    return [];
  },

  async addCustomFunction(deviceId: string, rawName: string): Promise<string | null> {
    throw new Error('Custom IR functions are not implemented.');
  },

  async deleteCustomFunction(deviceId: string, funcName: string): Promise<boolean> {
    return false;
  },

  async applyBrandPreset(deviceId: string, brand: string): Promise<any[]> {
    return [];
  },

  async captureIrSignal(deviceId: string, commandType: string, brand?: string): Promise<any> {
    throw new Error('IR signal capture is not implemented. No signal was recorded.');
  },

  async testTransmit(deviceId: string, commandType: string): Promise<{ success: boolean; message: string }> {
    return {
      success: false,
      message: 'No hardware transmission was performed. Configure a controller connection first.',
    };
  },

  async dispatchIntent(nodeIp: string, payload: { protocol: string; state: any }): Promise<boolean> {
    try {
      const capability = SUPPORTED_IR_PROTOCOLS[CapabilityEngine.resolveProtocolName(payload.protocol)];
      const state = payload.state;
      if (!capability || !state || !['on', 'off', true, false].includes(state.power) ||
          !Number.isFinite(state.temp) || state.temp < capability.minTemp || state.temp > capability.maxTemp ||
          !capability.modes.includes(state.mode) || !capability.fans.includes(state.fan)) return false;
      const { data: nodes, error } = await supabase.from('nodes').select('id,name,ip_address').eq('ip_address', nodeIp).limit(2);
      if (error || nodes?.length !== 1) return false;
      await probeController(nodeIp, [nodes[0].id, nodes[0].name]);
      const acknowledgement = await requestControllerJson(nodeIp, '/ir/intent', 8000, payload);
      // This confirms the controller acknowledged transmission, not measured AC power.
      return acknowledgement.success === true && acknowledgement.result === 'SUCCESS';
    } catch { return false; }
  },

  async saveDesiredState(deviceId: string, state: Record<string, unknown>, protocol?: string): Promise<void> {
    const { data, error } = await supabase.rpc('ecotrack_set_aircon_intent', { p_aircon_id: deviceId, p_state: state, p_protocol: protocol ?? null });
    if (error || data?.id !== deviceId) throw new Error('The command was transmitted, but its saved state could not be updated. Refresh before retrying.');
    if (!data.command_id) throw new Error('The shared controller-state migration is required.');
    const acknowledgement = await supabase.rpc('ecotrack_ack_aircon_intent', {
      p_aircon_id: deviceId, p_command_id: data.command_id, p_status: 'transmitted',
    });
    if (acknowledgement.error) throw new Error('IR was transmitted, but its delivery status could not be saved. Refresh before retrying.');
  }
};
