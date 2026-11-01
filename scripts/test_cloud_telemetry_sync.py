"""Exercise cloud ingestion against real temporary SQLite and mocked Supabase HTTP."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from datetime import datetime, timedelta
from contextlib import closing
from unittest.mock import Mock, patch

temporary_db = tempfile.TemporaryDirectory(prefix='ecotrack-cloud-test-')
os.environ['ECOTRACK_SQLITE_DB_PATH'] = str(Path(temporary_db.name) / 'telemetry.db')
spec = importlib.util.spec_from_file_location('cloud_test_backend', Path(__file__).resolve().parents[1] / 'backend/app.py')
backend = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backend)


class CloudTelemetryTests(unittest.TestCase):
    def setUp(self):
        self.api = backend.app.test_client()
        self.api.environ_base['HTTP_AUTHORIZATION'] = 'Bearer ' + backend.monitoring_service.admin_token
        with closing(backend.get_db_connection()) as conn:
            conn.execute('DELETE FROM telemetry')
            conn.execute('DELETE FROM cloud_sync_state')
            conn.execute('DELETE FROM telemetry_local_reset')
            conn.execute('DELETE FROM telemetry_cloud_receipts')
            conn.execute('DELETE FROM telemetry_monitor_sources')
            conn.commit()
        self.env = patch.dict(os.environ, {'SUPABASE_URL': 'https://cloud.test', 'SUPABASE_SERVICE_ROLE_KEY': 'test-key'})
        self.env.start()
        self.addCleanup(self.env.stop)
        cleanup = patch.object(backend.requests, 'post', side_effect=lambda *args, **options: self.response({
            'acknowledged_ids': [row['id'] for row in options['json']['p_records']],
            'deleted_ids': [row['id'] for row in options['json']['p_records']], 'changed_ids': []}))
        cleanup.start()
        self.addCleanup(cleanup.stop)

    def row(self, identifier='telem_a', **overrides):
        return {'id': identifier, 'node_id': 'node-6', 'created': '2026-10-02T10:00:00+00:00',
                'battery': 3.91, 'rssi': -61, 'interval_seconds': 30, **overrides}

    def response(self, rows):
        result = Mock()
        result.json.return_value = rows
        return result

    def test_idempotence_and_unknown_measurements(self):
        rows = [self.row(), self.row('telem_b', ac_on=False, temperature=25.2, pressure=0.4)]
        self.assertEqual(backend.import_cloud_telemetry(rows)['transferred'], 2)
        self.assertEqual(backend.import_cloud_telemetry(rows)['skipped'], 2)
        unknown = self.api.get('/api/telemetry/telem_a').get_json()
        self.assertIsNone(unknown['temperature'])
        self.assertNotIn('pressure', unknown)
        self.assertIsNone(unknown['ac_on'])
        self.assertEqual(unknown['interval_seconds'], 30)
        self.assertEqual(self.api.get('/api/telemetry/telem_b').get_json()['ac_on'], 0)
        self.assertNotIn('pressure', self.api.get('/api/telemetry/telem_b').get_json())

    def test_cursor_with_equal_timestamps_survives_restart(self):
        with patch.object(backend.requests, 'get', return_value=self.response([self.row()])) as get:
            self.assertEqual(backend.sync_cloud_telemetry_once()['transferred'], 1)
            self.assertNotIn('or', get.call_args.kwargs['params'])
        with patch.object(backend.requests, 'get', return_value=self.response([self.row('telem_b')])) as get:
            self.assertEqual(backend.sync_cloud_telemetry_once()['transferred'], 1)
            self.assertIn('id.gt."telem_a"', get.call_args.kwargs['params']['or'])
        with closing(backend.get_db_connection()) as conn:
            self.assertEqual(conn.execute('SELECT cursor_id FROM cloud_sync_state').fetchone()[0], 'telem_b')

    def test_invalid_page_rolls_back_rows_and_cursor(self):
        backend.import_cloud_telemetry([self.row()], ('2026-10-02T10:00:00+00:00', 'telem_a'))
        with patch.object(backend.requests, 'get', return_value=self.response([
            self.row('telem_b'), self.row('telem_c', temperature='not-a-reading')])):
            with self.assertRaises(ValueError):
                backend.sync_cloud_telemetry_once()
        with closing(backend.get_db_connection()) as conn:
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM telemetry').fetchone()[0], 1)
            self.assertEqual(conn.execute('SELECT cursor_id FROM cloud_sync_state').fetchone()[0], 'telem_a')

    def test_http_failure_never_advances_cursor(self):
        result = self.response([])
        result.raise_for_status.side_effect = backend.requests.HTTPError('403')
        with patch.object(backend.requests, 'get', return_value=result):
            with self.assertRaises(backend.requests.HTTPError):
                backend.sync_cloud_telemetry_once()
        with closing(backend.get_db_connection()) as conn:
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM cloud_sync_state').fetchone()[0], 0)

    def test_transfer_endpoint_preserves_ac_evidence_and_nulls(self):
        response = self.api.post('/api/telemetry/transfer', json={'records': [self.row(ac_on=True)]})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['transferred'], 1)
        saved = self.api.get('/api/telemetry/telem_a').get_json()
        self.assertEqual(saved['ac_on'], 1)
        self.assertIsNone(saved['temperature'])
        self.assertEqual(self.api.get('/api/historical').get_json()['temperatures'], [])

    def test_read_timeout_preserves_checkpoint_and_retries_without_skipping_feedback(self):
        backend.import_cloud_telemetry([self.row()], ('2026-10-02T10:00:00+00:00', 'telem_a'))
        with patch.object(backend.requests, 'get', side_effect=backend.requests.ReadTimeout('Isolated read timeout')):
            with self.assertRaises(backend.requests.ReadTimeout):
                backend.sync_cloud_telemetry_once()
        with closing(backend.get_db_connection()) as conn:
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM telemetry').fetchone()[0], 1)
            self.assertEqual(conn.execute('SELECT cursor_id FROM cloud_sync_state').fetchone()[0], 'telem_a')
        with patch.object(backend.requests, 'get', return_value=self.response([self.row('telem_b', ac_on=True)])):
            self.assertEqual(backend.sync_cloud_telemetry_once()['transferred'], 1)
        with closing(backend.get_db_connection()) as conn:
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM telemetry').fetchone()[0], 2)
            self.assertEqual(conn.execute('SELECT cursor_id FROM cloud_sync_state').fetchone()[0], 'telem_b')
        self.assertEqual(self.api.get('/api/telemetry/telem_b').get_json()['ac_on'], 1)

    def test_reset_blocks_old_imports_and_accepts_new_readings(self):
        backend.import_cloud_telemetry([self.row()])
        response = self.api.delete('/api/telemetry')
        self.assertEqual(response.status_code, 200)
        reset = response.get_json()
        self.assertEqual(reset['deleted_count'], 1)
        self.assertEqual(self.api.get('/api/telemetry').get_json()['reset_at'], reset['reset_at'])
        backend.init_sqlite_db()  # The boundary persists across backend initialization.
        self.assertEqual(backend.import_cloud_telemetry([self.row()])['transferred'], 0)
        self.assertEqual(self.api.get('/api/telemetry').get_json()['totalItems'], 0)
        at_reset = {**self.row('old_post'), 'created': reset['reset_at']}
        self.assertEqual(self.api.post('/api/telemetry', json=at_reset).status_code, 400)
        new_time = (datetime.fromisoformat(reset['reset_at']) + timedelta(seconds=1)).isoformat()
        self.assertEqual(backend.import_cloud_telemetry([self.row('new_cloud', created=new_time)])['transferred'], 1)
        self.assertEqual(self.api.post('/api/telemetry', json=self.row('new_post', created=new_time, ac_on=True)).status_code, 201)
        with patch.object(backend.requests, 'get', return_value=self.response([self.row()])) as get:
            self.assertEqual(backend.sync_cloud_telemetry_once()['transferred'], 0)
            self.assertEqual(get.call_args.kwargs['params']['created'], 'gt.' + reset['reset_at'])
        self.assertEqual(self.api.get('/api/telemetry').get_json()['totalItems'], 2)

    def test_received_off_and_unknown_power_are_preserved(self):
        for row in [self.row('off', ac_on=False), self.row('unknown'),
                    self.row('sleeping', ac_on=True, status='sleeping')]:
            response = self.api.post('/api/telemetry', json=row)
            self.assertEqual(response.status_code, 201)
            self.assertEqual(response.get_json()['ac_on'], row.get('ac_on'))
            self.assertEqual(response.get_json()['status'], row.get('status', 'unknown'))
        self.assertEqual(self.api.get('/api/telemetry').get_json()['totalItems'], 3)

    def test_remote_commands_do_not_override_measured_power_or_suppress_rows(self):
        snapshot = {'desired_state': {'power': True}, 'commanded_at': '2026-10-10T09:00:00Z',
                    'observed_remote_state': {'power': False}, 'observed_remote_at': '2026-10-10T09:01:00Z'}
        response = self.api.post('/api/telemetry', json=self.row('remote_off', ac_on=True, control_snapshot=snapshot))
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.get_json()['ac_on'], True)
        snapshot['desired_state']['power'] = False
        snapshot['observed_remote_state']['power'] = True
        response = self.api.post('/api/telemetry', json=self.row('remote_on', control_snapshot=snapshot))
        self.assertEqual(response.status_code, 201)
        self.assertIsNone(response.get_json()['ac_on'])
        self.assertEqual(response.get_json()['control_snapshot'], snapshot)
        snapshot['observed_remote_field_at'] = {'power': '2026-10-10T08:00:00Z'}
        response = self.api.post('/api/telemetry', json=self.row('old_remote', control_snapshot=snapshot))
        self.assertEqual(response.status_code, 201)
        self.assertIsNone(response.get_json()['ac_on'])
        self.assertEqual(self.api.get('/api/telemetry').get_json()['totalItems'], 3)

    def test_node_delete_does_not_reset_the_whole_history(self):
        backend.import_cloud_telemetry([self.row(), self.row('other', node_id='node-7')])
        self.assertEqual(self.api.delete('/api/telemetry?node_id=node-6').status_code, 200)
        result = self.api.get('/api/telemetry').get_json()
        self.assertEqual(result['totalItems'], 1)
        self.assertIsNone(result['reset_at'])

    def test_dns_interruption_recovers_quickly_without_losing_the_checkpoint(self):
        self.assertEqual(backend.import_cloud_telemetry([self.row()], ('2026-10-02T10:00:00+00:00', 'telem_a'))['transferred'], 1)
        waits, snapshots, messages = [], [], []
        class Stop:
            stopped = False
            def clear(self): self.stopped = False
            def is_set(self): return self.stopped
            def wait(self, seconds):
                waits.append(seconds)
                with closing(backend.get_db_connection()) as conn:
                    snapshots.append((conn.execute('SELECT COUNT(*) FROM telemetry').fetchone()[0], conn.execute("SELECT cursor_id FROM cloud_sync_state WHERE source='telemetry'").fetchone()[0], backend._telemetry_sync_status['error']))
                if len(waits) == 2: self.stopped = True
        class Thread:
            def __init__(self, target, **kwargs): self.target = target
            def start(self): self.target()
            def is_alive(self): return False
        error = backend.requests.ConnectionError('HTTPSConnectionPool: NameResolutionError: getaddrinfo failed')
        with patch.dict(os.environ, {'ECOTRACK_TELEMETRY_SYNC':'1'}), patch.object(backend, '_telemetry_sync_thread', None), patch.object(backend, '_telemetry_sync_stop', Stop()), patch.object(backend.threading, 'Thread', Thread), patch.object(backend.requests, 'get', side_effect=[error, self.response([self.row('telem_b', created='2026-10-02T10:00:30+00:00', ac_on=True)]), self.response([])]), patch('builtins.print', side_effect=lambda *args: messages.append(' '.join(map(str,args)))):
            backend.start_telemetry_sync()
        self.assertLessEqual(waits[0], 2)
        self.assertEqual(waits[1], 15)
        self.assertEqual(snapshots[0][:2], (1, 'telem_a'))
        self.assertEqual(snapshots[1][:2], (2, 'telem_b'))
        self.assertIsNone(snapshots[1][2])
        self.assertNotIn('HTTPSConnectionPool', ' '.join(messages))
        self.assertTrue(any('restored' in line.lower() for line in messages))

    def test_repeated_network_failure_uses_bounded_backoff_and_preserves_rows(self):
        waits = []
        class Stop:
            stopped = False
            def clear(self): self.stopped = False
            def is_set(self): return self.stopped
            def wait(self, seconds):
                waits.append(seconds)
                if len(waits) == 10: self.stopped = True
        class Thread:
            def __init__(self, target, **kwargs): self.target = target
            def start(self): self.target()
            def is_alive(self): return False
        with patch.dict(os.environ, {'ECOTRACK_TELEMETRY_SYNC':'1'}), patch.object(backend, '_telemetry_sync_thread', None), patch.object(backend, '_telemetry_sync_stop', Stop()), patch.object(backend.threading, 'Thread', Thread), patch.object(backend.requests, 'get', side_effect=backend.requests.ConnectionError('getaddrinfo failed')), patch('builtins.print'):
            backend.start_telemetry_sync()
        self.assertEqual(waits[:3], [2,4,8])
        self.assertEqual(waits[-1], 300)
        self.assertTrue(all(0 < delay <= 300 for delay in waits))
        self.assertFalse(backend._telemetry_sync_status['running'])
        self.assertEqual(self.api.get('/api/telemetry').get_json()['totalItems'], 0)

    def test_forwarding_includes_operating_window(self):
        with patch.object(backend._schedule_executor, 'submit'):
            response = self.api.post('/api/set-sleep', json={'node_id': 'node-6', 'sleep_seconds': 30,
                'wake_time': '22:00', 'sleep_time': '06:00', 'ip': '192.168.1.6'})
        job = response.get_json()['job_id']
        ack = self.response({'success': True, 'interval_ms': 30000})
        with patch.object(backend.requests, 'post', return_value=ack) as post:
            backend.forward_schedule_interval(job, 'node-6', 30, '192.168.1.6', '22:00', '06:00')
            self.assertEqual(post.call_args.kwargs['json'],
                {'interval_seconds': 30, 'wake_time': '22:00', 'sleep_time': '06:00'})


if __name__ == '__main__':
    try:
        unittest.main()
    finally:
        temporary_db.cleanup()
