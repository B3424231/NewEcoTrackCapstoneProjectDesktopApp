import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase';
import { fetchAccessibleRows, type ReadScope } from './query-utils';
import { requestId } from './ble-protocol';

export interface CloudDeviceState {
  node_id: string;
  device_id: string;
  last_seen?: string;
  sleeping_until?: string | null;
  firmware_version?: string;
  capabilities?: Record<string, unknown>;
  latest_ir?: Record<string, any> | null;
  ip_address?: string;
  wifi_ssid?: string;
  rssi?: number;
  battery?: number;
}
export interface ControllerInfo {
  device_id: string;
  cloud_protocol: number;
  node_id?: string;
  wifi_status?: string;
  wifi_ssid?: string;
  ip_address?: string;
  cloud_status?: string;
  request_id?: string;
  error?: string;
  capabilities?: Record<string, unknown>;
}
export interface ControllerAssignment {
  controller_name: string;
  assignment_mode: 'existing' | 'new';
  aircon_id?: string;
  asset_tag?: string;
  aircon_name?: string;
  room_id: string | null;
  brand: string;
  aircon_type: string;
  protocol_name?: string;
}
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
export function connectionStatus(state?: CloudDeviceState | null, now = Date.now()): 'online' | 'offline' | 'sleeping' {
  if (Date.parse(state?.sleeping_until || '') > now) return 'sleeping';
  const seen = Date.parse(state?.last_seen || '');
  return Number.isFinite(seen) && seen <= now + 5000 && now - seen <= 45000 ? 'online' : 'offline';
}
export async function hardwareRpc(name: string, args: Record<string, unknown>): Promise<any> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.code === '42501' ? 'An administrator account is required for cloud hardware setup and commands.' : error.message);
  if (!data || typeof data !== 'object') throw new Error('Supabase did not confirm this hardware operation.');
  return data;
}
export const CloudHardware = {
  async list(scope?: ReadScope): Promise<CloudDeviceState[]> {
    const { data, error } = await fetchAccessibleRows(supabase, 'ecotrack_device_state', '*', undefined, scope);
    if (error) throw new Error('Unable to read live controller status. Refresh or sign in again.');
    return data || [];
  },
  async get(nodeId: string): Promise<CloudDeviceState> {
    const { data, error } = await supabase.from('ecotrack_device_state').select('*').eq('node_id', nodeId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error('Complete Bluetooth and cloud registration for this controller first.');
    return data;
  },
  async registrationStatus(info: ControllerInfo): Promise<any> {
    if (!/^esp32s3-[a-f0-9]{12}$/.test(info.device_id) || info.cloud_protocol !== 1)
      throw new Error('Use the current EcoTrack cloud controller sketch before registering this ESP32.');
    return hardwareRpc('ecotrack_controller_registration_status', { p_device_id: info.device_id });
  },
  async register(info: ControllerInfo, setup: ControllerAssignment, credentials: { ssid: string; pass: string },
    provision: (payload: Record<string, unknown>, cloud: boolean) => Promise<ControllerInfo>): Promise<any> {
    const checked = await hardwareRpc('ecotrack_validate_controller_assignment', { p_device_id: info.device_id, p_setup: setup });
    if (checked.valid !== true) throw new Error('AC assignment could not be validated.');
    const status = await this.registrationStatus(info);
    const refresh = status.requires_credentials === true || info.cloud_status === 'unconfigured' ||
      (!!info.node_id && info.node_id !== status.node?.id) ||
      (info.cloud_status === 'error' && /auth|credential|reprovision|registration|token/i.test(info.error || ''));
    let nodeId = status.node?.id;
    if (refresh) {
      if (!SUPABASE_URL.startsWith('https://') || !SUPABASE_ANON_KEY) throw new Error('Supabase public configuration is missing.');
      const prepared = await hardwareRpc('ecotrack_prepare_controller_registration', { p_device_id: info.device_id });
      if (!prepared.node?.id || !/^[a-f0-9]{64}$/.test(prepared.device_token || '')) throw new Error('Invalid cloud registration receipt.');
      nodeId = prepared.node.id;
      try {
        info = await provision({ ...credentials, device_id: info.device_id, supabase_url: SUPABASE_URL,
          supabase_key: SUPABASE_ANON_KEY, device_token: prepared.device_token }, true);
      } finally { delete prepared.device_token; }
    }
    if (!nodeId || info.cloud_status !== 'verified') throw new Error('The ESP32 has not verified its cloud connection. Keep it awake and retry.');
    const cloud = await this.get(nodeId);
    if (cloud.device_id !== info.device_id || connectionStatus(cloud) !== 'online')
      throw new Error('No recent heartbeat from this ESP32. Reconnect Bluetooth and keep it awake before saving.');
    const saved = await hardwareRpc('ecotrack_finish_controller_registration', {
      p_node_id: nodeId, p_device_id: info.device_id, p_setup: setup });
    if (saved.success !== true || saved.connected !== true || saved.node?.id !== nodeId || !saved.aircon?.id)
      throw new Error('Controller registration was not confirmed.');
    return saved;
  },
  async request(nodeId: string, kind: 'ping' | 'learn_ir' | 'configure' | 'ac_intent',
    payload: Record<string, unknown> = {}, timeoutMs = 25000): Promise<any> {
    const state = await this.get(nodeId);
    if (connectionStatus(state) !== 'online') throw new Error(connectionStatus(state) === 'sleeping'
      ? 'This controller is sleeping. Wake it before sending a command.' : 'This controller is offline. Wait for a fresh heartbeat.');
    const id = requestId();
    const started = Date.now();
    const queued = await hardwareRpc('ecotrack_cloud_request', { p_node_id: nodeId, p_kind: kind, p_payload: payload, p_request_id: id });
    if (queued.id !== id || queued.node_id !== nodeId || queued.kind !== kind) throw new Error('Hardware request identity was not confirmed.');
    while (Date.now() - started < timeoutMs) {
      const { data, error } = await supabase.from('ecotrack_device_commands').select('*').eq('id', id).maybeSingle();
      if (error) throw new Error(error.message);
      if (!data || data.node_id !== nodeId || data.kind !== kind) throw new Error('The hardware request is no longer available.');
      if (data.status === 'completed') {
        if (data.result?.success !== true || data.result.command_id !== id) throw new Error('Invalid ESP32 acknowledgement.');
        return { ...data.result, round_trip_ms: Date.now() - started };
      }
      if (['failed', 'expired', 'superseded'].includes(data.status)) throw new Error(data.result?.error || 'Hardware request ' + data.status + '.');
      await delay(500);
    }
    throw new Error('No ESP32 acknowledgement arrived. The command may still be queued; refresh before retrying.');
  },
  subscribe(onUpdate: (row?: CloudDeviceState) => void): () => void {
    const id = requestId();
    const channel = supabase.channel('mobile-hardware-' + id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ecotrack_device_state' }, event => onUpdate(event.new as CloudDeviceState))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'aircons' }, () => onUpdate())
      .subscribe(status => { if (status === 'SUBSCRIBED') onUpdate(); });
    const broadcast = supabase.channel('ecotrack:hardware', { config: { private: true } })
      .on('broadcast', { event: 'device_state' }, event => {
        const row = event.payload?.record || event.payload?.new || event.payload;
        if (row?.node_id) onUpdate(row);
      }).subscribe();
    // Ages an idle heartbeat even when no database change arrives.
    const timer = setInterval(() => onUpdate(), 15000);
    return () => { clearInterval(timer); void supabase.removeChannel(channel); void supabase.removeChannel(broadcast); };
  },
};
