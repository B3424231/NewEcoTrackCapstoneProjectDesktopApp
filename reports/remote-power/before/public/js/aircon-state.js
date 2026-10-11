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
function remoteObservation(capture, receivedAt) {
    const frame = parseAirconSnapshot(capture);
    const decoded = parseAirconSnapshot(frame?.state);
    if (!decoded || (!frame.raw_data && !(Number(frame.raw_count) > 0))) return {};
    const power = powerValue(decoded.power);
    const temp = decoded.temp !== null && decoded.temp !== undefined && decoded.temp !== '' && Number.isFinite(Number(decoded.temp)) ? Number(decoded.temp) : null;
    const mode = ['cool','heat','dry','fan','auto'].includes(decoded.mode) ? decoded.mode : null;
    const fan = ['auto','low','medium','high','quiet','silent','turbo'].includes(decoded.fan) ? decoded.fan : null;
    if (power === null && temp === null && mode === null && fan === null) return {};
    const epoch = Number(frame.captured_at_epoch_ms);
    const observedAt = Number.isFinite(epoch) && epoch > 0 ? new Date(epoch).toISOString() : receivedAt || null;
    return {observed_remote_state:{power,temp,mode,fan,source:'ir_receiver'}, observed_remote_at:observedAt};
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
        return {label,fanLabel,commandStatus:'',confirmed:false,power:null,remoteObserved:true,observedPower:state.power,summary:[label,fanLabel].filter(Boolean).join(' · ')};
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
