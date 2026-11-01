"""Recorded AC targets and conditional energy, independent of measured temperatures/power."""
from datetime import datetime, timezone
import json
import math

from backend.energy_prediction import EnergyPredictor, FLAGS, PredictionError
from backend.sensor_energy import selected_spans

HISTORY_SECONDS = 60
MAX_CADENCE_SECONDS = 60
SOURCE = 'recorded_ac_control_settings'
ALIASES = {'temp':'setpoint_c', 'temperature':'setpoint_c', 'fan':'fan_command',
           'mode':'operating_mode', 'swing_vertical':'swing', 'swing_horizontal':'horizontal_swing'}


def snapshot_object(value):
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (ValueError, TypeError):
            return None
    return value if isinstance(value, dict) else None


def epoch(value):
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return parsed.timestamp() if parsed.tzinfo is not None else None
    except (ValueError, TypeError, AttributeError, OverflowError, OSError):
        return None


def recorded_settings(snapshot, observed_at):
    """Merge fields as Control does, excluding events after the recorded observation."""
    cutoff = epoch(observed_at)
    snapshot = snapshot_object(snapshot)
    if snapshot is None or cutoff is None:
        return {}
    state, times = {}, {}
    for kind, time_key in [('configured_state',None), ('desired_state','commanded_at'),
                           ('reported_state','reported_at'), ('observed_remote_state','observed_remote_at')]:
        values = snapshot_object(snapshot.get(kind))
        if not values:
            continue
        stamp = epoch(snapshot.get(time_key)) if time_key else 0
        for key, value in values.items():
            canonical = ALIASES.get(key, key)
            if value is None or canonical not in {'setpoint_c','operating_mode','fan_command',*FLAGS}:
                continue
            at = stamp
            if kind == 'observed_remote_state':
                fields = snapshot_object(snapshot.get('observed_remote_field_at')) or {}
                at = epoch(fields.get(key) or fields.get(canonical) or snapshot.get(time_key))
            at = at or 0
            if at > cutoff + 5:
                continue
            if canonical not in times or at >= times[canonical]:
                state[canonical], times[canonical] = value, at
    return state


def target_temperature(snapshot, observed_at):
    value = recorded_settings(snapshot, observed_at).get('setpoint_c')
    if value is None or isinstance(value, bool) or value == '':
        return None
    try:
        value = float(value)
        return value if math.isfinite(value) else None
    except (ValueError, TypeError, OverflowError):
        return None


class ControlHistoryEstimator:
    def __init__(self, directory):
        self.predictor = EnergyPredictor(directory)

    def load(self):
        return self.predictor.features(EnergyPredictor.MODEL_ID)

    def status(self):
        health = self.predictor.health()
        return {**health, 'model':EnergyPredictor.MODEL_ID, 'model_id':'recorded_extra_trees_history_v1',
                'workspace':'monitoring', 'source':SOURCE, 'history_seconds':HISTORY_SECONDS,
                'max_cadence_seconds':MAX_CADENCE_SECONDS, 'output_unit':'kWh', 'horizon_hours':1,
                'estimation_available':health.get('prediction_status') != 'unavailable',
                'loaded':health.get('prediction_status') != 'unavailable',
                'experimental':True, 'physical_accuracy_validated':False, 'runtime_confirmed':False,
                'task':'conditional_control_energy_estimation', 'forecast_available':False,
                'required_features':['setpoint_c','fan_command','operating_mode','observed_at','interval_seconds'],
                'timestamp_role':'Observed timestamps determine elapsed intervals, filtering, grouping and gaps; no learned time-of-day effect.',
                'reason':'Conditional control-model estimate after one minute of recorded settings; no measured consumption or confirmed runtime.'}

    def estimate(self, rows, start, end, clocks=(None,None)):
        response = dict(model=EnergyPredictor.MODEL_ID,model_id='recorded_extra_trees_history_v1',workspace='monitoring',
            source=SOURCE,history_seconds=HISTORY_SECONDS,available=False,experimental=True,
            physical_accuracy_validated=False,runtime_confirmed=False,forecast_available=False,
            task='conditional_control_energy_estimation',horizon_hours=1,energy_kwh=None,average_power_kw=None,
            measured_energy_kwh=None,physically_confirmed_ac_on=None,estimated_unit_hours=0,
            estimated_sample_count=0,missing_features=[],points=[],devices=[])
        lower, upper = epoch(start), epoch(end)
        groups, rejected, rates, intervals = {}, 0, {}, []
        for original in rows:
            row = dict(original)
            groups.setdefault((row['aircon_id'],row['node_id']),[]).append(row)
        for group in groups.values():
            segment = []
            def finish_segment():
                if len(segment) > 1 and segment[-1]['_time'] - segment[0]['_time'] >= HISTORY_SECONDS:
                    for previous, current in zip(segment,segment[1:]):
                        intervals.append(dict(row=current,begin=previous['_time'],end=current['_time'],
                                              p0=previous['_rate'],p1=current['_rate'],valid=True))
            for row in sorted(group, key=lambda value: value.get('observed_at') or ''):
                stamp, cadence = epoch(row.get('observed_at')), row.get('interval_seconds')
                settings = recorded_settings(row.get('control_snapshot'),row.get('observed_at'))
                good = stamp is not None and row.get('clock_quality') == 'synchronized'
                good &= isinstance(cadence,(float,int)) and not isinstance(cadence,bool) and math.isfinite(cadence) and 0 < cadence <= MAX_CADENCE_SECONDS
                rate = None
                if good:
                    try:
                        # JSON keys also handle malformed structured input without uncaught TypeError.
                        key = json.dumps(settings,sort_keys=True,allow_nan=False)
                        if key not in rates:
                            rates[key] = self.predictor.predict_recorded({'settings':settings})['kwh']
                        rate = rates[key]
                    except PredictionError as error:
                        if error.status >= 500:
                            raise
                    except (ValueError,TypeError):
                        pass
                if rate is None:
                    finish_segment(); segment=[]; rejected+=1; continue
                row['_time'], row['_rate'] = stamp, rate
                if segment:
                    prior = segment[-1]
                    elapsed = stamp - prior['_time']
                    if elapsed <= 0 or elapsed > 1.5 * min(cadence,prior['interval_seconds']) or any(row.get(field) != prior.get(field) for field in ['boot_id','calibration_id']):
                        finish_segment(); segment=[]
                segment.append(row)
            finish_segment()
        # Conflicting historical sensors cannot count the same AC interval twice.
        active, ambiguous = {}, 0
        for item in sorted(intervals,key=lambda value:value['begin']):
            ac = item['row']['aircon_id']
            live = [other for other in active.get(ac,[]) if other['end'] > item['begin']]
            for other in live:
                other['valid'] = item['valid'] = False
                ambiguous += 1
            active[ac] = [*live,item]
        devices,buckets,total,covered,count = {},{},0.,0.,0
        bucket_seconds = max(60,math.ceil((upper-lower)/300))
        for item in intervals:
            if not item['valid']:
                continue
            row,begin,finish = item['row'],item['begin'],item['end']
            for left,right in selected_spans(begin,finish,lower,upper,clocks):
                count += 1
                device = devices.setdefault(row['node_id'],dict(node_id=row['node_id'],aircon_id=row['aircon_id'],
                    sensor_name=row.get('sensor_name') or '',aircon_name=row.get('aircon_name') or '',
                    location=row.get('location') or '',aircon_type=row.get('aircon_type'),energy_kwh=0.,estimated_seconds=0.))
                while right > left:
                    bucket = int(left//bucket_seconds)
                    stop = min(right,(bucket+1)*bucket_seconds)
                    def rate_at(stamp):
                        return item['p0']+(item['p1']-item['p0'])*(stamp-begin)/(finish-begin)
                    span = stop-left
                    # The model's conditional one-hour kWh is a kWh/hour reference rate,
                    # not an electrical power reading or proof that the AC operated.
                    kwh = (rate_at(left)+rate_at(stop))*.5*span/3600
                    value=buckets.setdefault(bucket,dict(energy_kwh=0.,estimated_seconds=0.))
                    value['energy_kwh']+=kwh; value['estimated_seconds']+=span
                    device['energy_kwh']+=kwh; device['estimated_seconds']+=span
                    total+=kwh; covered+=span; left=stop
        if covered <= 0:
            return {**response,'code':'CONTROL_HISTORY_UNAVAILABLE','rejected_readings':rejected,'ambiguous_intervals':ambiguous,
                'reason':'Requires one minute of continuous recorded target, fan and mode with cadence at most 60 seconds. Missing settings, gaps and reboots restart history; no sensor-temperature fallback.'}
        points=[]
        for bucket in range(int(lower//bucket_seconds),int((upper-.001)//bucket_seconds)+1):
            value=buckets.get(bucket)
            points.append(dict(observed_at=datetime.fromtimestamp(bucket*bucket_seconds,timezone.utc).isoformat().replace('+00:00','Z'),
                energy_kwh=value['energy_kwh'] if value else None,estimated_seconds=value['estimated_seconds'] if value else 0,
                average_power_kw=value['energy_kwh']/(value['estimated_seconds']/3600) if value else None))
        return {**response,'available':True,'code':'CONDITIONAL_CONTROL_ESTIMATE','energy_kwh':total,
            'average_power_kw':total/(covered/3600),'estimated_unit_hours':covered/3600,
            'estimated_sample_count':count,'rejected_readings':rejected,'ambiguous_intervals':ambiguous,
            'points':points,'devices':list(devices.values()),'bucket_seconds':bucket_seconds,
            'integration':'Conditional one-hour control-model rates integrated over consecutive observed timestamps; clipped to filters; no gap extrapolation.',
            'reason':'Conditional research estimate from recorded AC controls. Missing function flags are averaged over supported model variants. No measured energy or confirmed AC runtime.'}
