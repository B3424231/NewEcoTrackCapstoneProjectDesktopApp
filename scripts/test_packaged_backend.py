"""Real frozen backend acceptance with a temporary SQLite DB and no cloud traffic."""
import hashlib
import json
import math
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'reports/packaging-20261030/backend'
EXE = ROOT / 'artifacts/packaging/backend/ecotrack-backend/ecotrack-backend.exe'


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    results = []
    sandbox = Path(tempfile.mkdtemp(prefix='ecotrack-frozen-backend-'))
    database = sandbox / 'data/telemetry.db'
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
    env = os.environ.copy()
    for key in list(env):
        if key.startswith(('SUPABASE_', 'EXPO_PUBLIC_SUPABASE_', 'PYTHON')):
            env.pop(key)
    env.update(ECOTRACK_SQLITE_DB_PATH=str(database), PORT=str(port),
        ECOTRACK_TELEMETRY_SYNC='0', ECOTRACK_MONITOR_SYNC='0', ECOTRACK_BACKUP_ENABLED='0',
        SUPABASE_URL='https://isolated-frozen-backend.invalid', SUPABASE_KEY='',
        SUPABASE_ANON_KEY='', SUPABASE_SERVICE_ROLE_KEY='',
        PATH=os.pathsep.join([os.path.join(os.environ['SystemRoot'], 'System32'), os.environ['SystemRoot']]))
    base = f'http://127.0.0.1:{port}'
    token = None

    def call(method, endpoint, payload=None, authorized=True):
        headers = {'Content-Type': 'application/json'}
        if authorized and token:
            headers['Authorization'] = 'Bearer ' + token
        req = urllib.request.Request(base + endpoint,
            data=None if payload is None else json.dumps(payload).encode(), headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=15) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            return error.code, json.load(error)

    def record(name, status, detail):
        results.append({'name': name, 'status': 'PASS' if status else 'FAIL', 'actual': detail})
        if not status:
            raise AssertionError(name + ': ' + str(detail)[:500])

    child = None
    log = (OUT / 'frozen-runtime.log').open('wb')
    try:
        child = subprocess.Popen([str(EXE)], cwd=sandbox, env=env, stdout=log, stderr=subprocess.STDOUT,
                                 creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        deadline = time.monotonic() + 60
        health = None
        while time.monotonic() < deadline:
            if child.poll() is not None:
                raise RuntimeError('Frozen backend exited before readiness; see frozen-runtime.log')
            try:
                status, health = call('GET', '/api/health', authorized=False)
                if status == 200:
                    break
            except (OSError, TimeoutError):
                time.sleep(.25)
        record('Executable starts without development Python on PATH', health is not None,
               {'port': port, 'pid': child.pid, 'python_on_path': False})
        record('Packaged Extra Trees model loads with verified metadata and checksums',
               health.get('prediction_status') == 'research_estimate_ready' and
               health.get('models_available') == ['extra_trees'], health)
        token = (database.parent / '.ecotrack-monitoring-admin.key').read_text().strip()
        record('SQLite and local administrator credential are created outside installed resources',
               database.is_file() and len(token) >= 32 and sandbox in database.parents,
               {'sqlite_exists': database.is_file(), 'credential_generated': len(token) >= 32})
        settings = {'setpoint_c': 24, 'fan_command': 'medium', 'operating_mode': 'cool',
                    'eco': False, 'turbo': False, 'swing': True, 'quiet': False,
                    'horizontal_swing': False, 'display': True}
        status, prediction = call('POST', '/api/predict-energy', {'model': 'extra_trees', 'settings': settings})
        record('Frozen model produces a finite research estimate', status == 200 and
               math.isfinite(prediction.get('kwh', math.nan)) and prediction.get('measured_energy_kwh') is None
               and prediction.get('physical_accuracy_validated') is False, {'http': status, 'body': prediction})
        sys.path.insert(0, str(ROOT))
        from backend.energy_prediction import EnergyPredictor
        expected = EnergyPredictor(ROOT / 'backend/ml/control_extra_trees').predict({'settings': settings})
        record('Frozen prediction matches the original trained pipeline numerically',
               math.isclose(prediction['kwh'], expected['kwh'], rel_tol=1e-12, abs_tol=1e-12),
               {'frozen_kwh': prediction['kwh'], 'source_pipeline_kwh': expected['kwh']})
        status, partial = call('POST', '/api/predict-recorded-energy', {'settings': {
            'setpoint_c': 24, 'fan_command': 'medium', 'operating_mode': 'cool'}})
        record('Recorded-control forecast uses real bundled reference support', status == 200 and
               math.isfinite(partial.get('kwh', math.nan)), {'http': status, 'body': partial})
        status, invalid = call('POST', '/api/predict-energy', {'settings': {**settings, 'setpoint_c': 99}})
        record('Unsupported model input is rejected', status == 422, {'http': status, 'body': invalid})
        status, missing = call('POST', '/api/predict-energy', {})
        record('Missing model settings are rejected', status == 400, {'http': status, 'body': missing})
        status, unauthorized = call('POST', '/api/telemetry', {'id': 'isolated-must-not-save'}, authorized=False)
        record('Packaged telemetry mutation still requires local authorization', status == 401,
               {'http': status, 'body': unauthorized})
        row = {'id': 'isolated-packaged-observation', 'node_id': 'isolated-node',
            'sensor_name': 'Isolated packaged fixture', 'created': '2026-10-30T12:00:00+00:00',
            'observed_at': '2026-10-30T12:00:00+00:00', 'interval_seconds': 5,
            'rotation_rpm': 450, 'rotation_quality': 'ok', 'ac_on': None,
            'control_snapshot': {'desired_state': {'power': 'on', 'temp': 24, 'mode': 'cool', 'fan': 'medium'},
                                 'commanded_at': '2026-10-30T11:59:00+00:00'}}
        status, inserted = call('POST', '/api/telemetry', row)
        record('Actual frozen HTTP API persists isolated telemetry in real SQLite',
               status == 201 and inserted.get('rotation_rpm') == 450 and inserted.get('ac_on') is None,
               {'http': status, 'body': inserted})
        status, repeated = call('POST', '/api/telemetry', row)
        with sqlite3.connect(database) as conn:
            total = conn.execute('SELECT COUNT(*) FROM telemetry').fetchone()[0]
            preserved = conn.execute('SELECT rotation_rpm,ac_on FROM telemetry WHERE id=?', (row['id'],)).fetchone()
        record('Duplicate observation is not duplicated and unknown AC power stays unknown',
               status == 201 and total == 1 and preserved == (450.0, None), {'http': status, 'rows': total, 'sqlite_row': preserved})
        status, listing = call('GET', '/api/telemetry?perPage=5')
        record('Telemetry read API returns the SQLite observation', status == 200 and
               listing.get('totalItems') == 1, {'http': status, 'body': listing})
        status, model = call('GET', '/api/monitoring/energy-model')
        record('Monitoring energy model is packaged and ready too', status == 200 and model.get('loaded') is True,
               {'http': status, 'body': model})
        child.terminate()
        child.wait(timeout=15)
        child = subprocess.Popen([str(EXE)], cwd=sandbox, env=env, stdout=log, stderr=subprocess.STDOUT,
                                 creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        deadline = time.monotonic() + 30
        listing = None
        while time.monotonic() < deadline:
            try:
                status, listing = call('GET', '/api/telemetry?perPage=5')
                if status == 200:
                    break
            except (OSError, TimeoutError):
                time.sleep(.25)
        record('Application restart preserves the same SQLite history', listing is not None and
               listing.get('totalItems') == 1, {'http': status, 'totalItems': listing.get('totalItems') if listing else None})
        report = {'status': 'PASS', 'frozen_executable': str(EXE),
            'exe_sha256': hashlib.sha256(EXE.read_bytes()).hexdigest(),
            'runtime_bytes': sum(p.stat().st_size for p in EXE.parent.rglob('*') if p.is_file()),
            'temporary_sqlite_only': True, 'live_cloud_access': False,
            'physical_hardware_tested': False, 'results': results}
    except Exception as error:
        report = {'status': 'FAIL', 'error': str(error), 'results': results}
        raise
    finally:
        if child is not None and child.poll() is None:
            child.terminate()
            child.wait(timeout=15)
        log.close()
        (OUT / 'results.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print('Frozen backend acceptance:', report['status'], len(results), 'checks')


if __name__ == '__main__':
    main()
