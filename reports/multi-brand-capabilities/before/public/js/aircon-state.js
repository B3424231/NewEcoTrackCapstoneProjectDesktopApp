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
// Only use a complete, checksummed TCL normal packet for legacy feature flags.
function legacyTclFeatures(frame, protocol) {
    if (protocol !== 'TCL112AC') return {};
    const hex = String(frame.hex || '').replace(/^0x/i, '');
    if (!/^[0-9a-f]{28}$/i.test(hex)) return {};
    const bytes = hex.match(/../g).map(byte => parseInt(byte, 16));
    if (bytes[0] !== 0x23 || bytes[1] !== 0xcb || bytes[2] !== 0x26 || (bytes[3] & 3) !== 1 ||
        (bytes.slice(0, 13).reduce((sum, byte) => sum + byte, 0) & 255) !== bytes[13]) return {};
    return {turbo:!!(bytes[6] & 0x20), swing:!!(bytes[8] & 0x38) || !!(bytes[12] & 8), eco:!!(bytes[5] & 0x80)};
}
function receiverCapabilities(value) {
    const data = parseAirconSnapshot(value);
    if (!data) return null;
    const caps = {};
    for (const feature of ['power','temperature','swing','turbo','eco','sleep','timer'])
        if (typeof data[feature] === 'boolean') caps[feature] = data[feature];
    for (const [key, allowed] of [['modes',['cool','heat','dry','fan','auto']], ['fans',['auto','low','medium','high','quiet','silent','turbo']]])
        if (Array.isArray(data[key]) && data[key].length && data[key].every(item => allowed.includes(item)))
            caps[key] = [...new Set(data[key])];
    if (typeof data.min_temp === 'number' && typeof data.max_temp === 'number' &&
        data.min_temp >= 10 && data.max_temp <= 40 && data.min_temp <= data.max_temp) {
        caps.min_temp = caps.temperature_min = data.min_temp;
        caps.max_temp = caps.temperature_max = data.max_temp;
    }
    return Object.keys(caps).length ? caps : null;
}
function remoteObservation(capture, receivedAt, previous) {
    const frame = parseAirconSnapshot(capture);
    if (!frame) return {};
    const saved = parseAirconSnapshot(previous) || {};
    const retained = saved.observed_remote_state ? {
        observed_remote_state:saved.observed_remote_state,
        observed_remote_at:saved.observed_remote_at,
        observed_remote_frame:saved.observed_remote_frame,
        observed_remote_protocol:saved.observed_remote_protocol,
        observed_remote_capabilities:saved.observed_remote_capabilities
    } : {};
    const decodedFrame = frame.frame_kind !== 'settings_only' && parseAirconSnapshot(frame.state) ? frame : parseAirconSnapshot(frame.last_decoded);
    const decoded = decodedFrame?.frame_kind === 'settings_only' ? null : parseAirconSnapshot(decodedFrame?.state);
    if (!decoded || (!decodedFrame.raw_data && !(Number(decodedFrame.raw_count) > 0)))
        return frame.raw_data || Number(frame.raw_count) > 0 ? retained : {};
    const power = powerValue(decoded.power);
    const temp = decoded.temp !== null && decoded.temp !== undefined && decoded.temp !== '' && Number.isFinite(Number(decoded.temp)) ? Number(decoded.temp) : null;
    const mode = ['cool','heat','dry','fan','auto'].includes(decoded.mode) ? decoded.mode : null;
    const receivedProtocol = String(decodedFrame.protocol || decodedFrame.raw_type || '').trim().toUpperCase();
    const protocol = /^[A-Z][A-Z0-9_]{1,48}$/.test(receivedProtocol) && receivedProtocol !== 'UNKNOWN' ? receivedProtocol : null;
    // Older sketches called stdAc::kMax "turbo"; TCL's kMax means High, independently of its Turbo bit.
    const fan = protocol === 'TCL112AC' && decoded.fan === 'turbo' ? 'high' :
        ['auto','low','medium','high','quiet','silent','turbo'].includes(decoded.fan) ? decoded.fan : null;
    const legacy = legacyTclFeatures(decodedFrame, protocol);
    const features = {};
    for (const key of ['turbo','swing','eco','sleep']) features[key] = powerValue(decoded[key]) ?? legacy[key] ?? null;
    const capabilities = receiverCapabilities(decodedFrame.ac_capabilities);
    if (power === null && temp === null && mode === null && fan === null) return retained;
    const identity = JSON.stringify([decodedFrame.boot_count,decodedFrame.sequence,decodedFrame.captured_at_epoch_ms,
        decodedFrame.captured_at_ms,decodedFrame.protocol,decodedFrame.hex,power,temp,mode,fan,features,capabilities]);
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
    return {observed_remote_state:{power,temp,mode,fan,...features,source:'ir_receiver'},
        observed_remote_at:observedAt,observed_remote_frame:identity,observed_remote_protocol:protocol,
        observed_remote_capabilities:capabilities};
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
        return {label,fanLabel,commandStatus:'',confirmed:false,power:null,remoteObserved:true,observedPower:state.power,summary:[label,fanLabel,state.turbo === true ? 'TURBO ON' : ''].filter(Boolean).join(' · ')};
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

