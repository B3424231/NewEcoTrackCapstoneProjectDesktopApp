"""Durable Supabase handoff: real temporary SQLite, isolated HTTP, no live data."""
import importlib.util
import json
import os
import sqlite3
from pathlib import Path
import tempfile
import unittest
from contextlib import closing
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock, patch

storage = tempfile.TemporaryDirectory(prefix='ecotrack-bridge-test-')
os.environ['ECOTRACK_SQLITE_DB_PATH'] = str(Path(storage.name) / 'telemetry.db')
os.environ['ECOTRACK_TELEMETRY_SYNC'] = '0'
os.environ['ECOTRACK_MONITOR_SYNC'] = '0'
spec = importlib.util.spec_from_file_location('bridge_backend', Path(__file__).resolve().parents[1] / 'backend/app.py')
backend = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backend)


class TelemetryBridgeTests(unittest.TestCase):
    def setUp(self):
        with closing(backend.get_db_connection()) as conn:
            for table in ('monitor_samples', 'sensor_schedules', 'monitor_calibrations', 'monitor_nodes', 'monitor_sync_outbox', 'telemetry', 'telemetry_monitor_sources', 'cloud_sync_state', 'telemetry_local_reset'):
                conn.execute('DELETE FROM ' + table)
            if conn.execute("SELECT 1 FROM sqlite_master WHERE name='telemetry_cloud_receipts'").fetchone():
                conn.execute('DELETE FROM telemetry_cloud_receipts')
            conn.commit()
        self.cloud = []
        self.rpc_records = []
        self.env = patch.dict(os.environ, {'SUPABASE_URL': 'https://isolated.invalid', 'SUPABASE_SERVICE_ROLE_KEY': 'isolated-service-key'})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.get = patch.object(backend.requests, 'get', side_effect=lambda *a, **k: self.response(list(self.cloud))).start()
        self.post = patch.object(backend.requests, 'post', side_effect=self.acknowledge).start()
        self.addCleanup(patch.stopall)

    @staticmethod
    def response(value):
        result = Mock()
        result.json.return_value = value
        return result

    def row(self, identifier='sample-1', **values):
        stamp = (datetime.now(timezone.utc) - timedelta(seconds=2)).isoformat()
        return {'id': identifier, 'node_id': 'bridge-node', 'created': stamp, 'updated': stamp,
                'observed_at': stamp, 'temperature': 18.25, 'rotation_rpm': 600,
                'rotation_quality': 'ok', 'interval_seconds': 5, 'boot_id': 'boot-1',
                'sequence': 1, 'status': 'online', **values}

    def acknowledge(self, url, **options):
        self.assertTrue(url.endswith('/rest/v1/rpc/ecotrack_ack_telemetry'))
        records = options['json']['p_records']
        with closing(backend.get_db_connection()) as conn:
            for row in records:
                # A separate connection must see the committed archive before cloud deletion.
                archived = conn.execute('SELECT payload FROM telemetry_cloud_receipts WHERE id=?', (row['id'],)).fetchone()
                self.assertIsNotNone(archived)
                self.assertEqual(json.loads(archived['payload']), row)
                self.assertIsNotNone(conn.execute('SELECT id FROM telemetry WHERE id=?', (row['id'],)).fetchone())
        self.rpc_records.extend(records)
        ids = {row['id'] for row in records}
        removed = {row['id'] for row in self.cloud} & ids
        self.cloud = [row for row in self.cloud if row['id'] not in ids]
        return self.response({'acknowledged_ids': sorted(ids), 'deleted_ids': sorted(removed), 'changed_ids': []})

    def test_commit_preserves_interval_and_measurements_before_exact_cloud_ack(self):
        first = self.row(rotation_rpm=0)
        second = self.row('sample-2', interval_seconds=30, sequence=2)
        self.cloud = [first, second]
        result = backend.sync_cloud_telemetry_once()
        self.assertEqual(result['transferred'], 2)
        self.assertEqual({row['id'] for row in self.rpc_records}, {'sample-1', 'sample-2'})
        self.assertEqual(self.cloud, [])
        with closing(backend.get_db_connection()) as conn:
            rows = conn.execute('SELECT id,temperature,rotation_rpm,interval_seconds FROM telemetry ORDER BY id').fetchall()
            self.assertEqual([tuple(row) for row in rows], [('sample-1', 18.25, 0, 5), ('sample-2', 18.25, 600, 30)])
            self.assertTrue(all(row[0] for row in conn.execute('SELECT cleaned_at FROM telemetry_cloud_receipts')))
        self.assertEqual(backend.app.test_client().get('/api/telemetry').get_json()['totalItems'], 2)

    def test_failed_cloud_cleanup_retries_after_reinitialization_without_duplicate_history(self):
        self.cloud = [self.row()]
        self.post.side_effect = backend.requests.ConnectionError('Isolated cleanup outage')
        result = backend.sync_cloud_telemetry_once()
        self.assertEqual(result['transferred'], 1)
        self.assertTrue(result['cleanup_error'])
        self.assertEqual(len(self.cloud), 1)
        backend.init_sqlite_db()
        self.post.side_effect = self.acknowledge
        backend.sync_cloud_telemetry_once()
        with closing(backend.get_db_connection()) as conn:
            self.assertEqual(conn.execute('SELECT count(*) FROM telemetry').fetchone()[0], 1)
        self.assertEqual(self.cloud, [])

    def test_invalid_page_never_deletes_or_commits_partial_archive(self):
        self.cloud = [self.row(), self.row('invalid', temperature='broken')]
        with self.assertRaises(ValueError):
            backend.sync_cloud_telemetry_once()
        self.post.assert_not_called()
        with closing(backend.get_db_connection()) as conn:
            self.assertEqual(conn.execute('SELECT count(*) FROM telemetry').fetchone()[0], 0)

    def test_existing_local_id_with_different_measurements_never_acknowledges_cloud(self):
        row = self.row()
        backend.import_cloud_telemetry([{**row, 'temperature': 99}])
        self.cloud = [row]
        result = backend.sync_cloud_telemetry_once()
        self.assertIn('conflict', result['import_conflict'])
        self.post.assert_not_called()
        self.assertEqual(self.cloud, [row])

    def test_local_transfer_cannot_create_cloud_cleanup_eligibility(self):
        backend.import_cloud_telemetry([self.row()])
        with closing(backend.get_db_connection()) as conn:
            self.assertEqual(conn.execute('SELECT count(*) FROM telemetry_cloud_receipts').fetchone()[0], 0)
        self.post.assert_not_called()

    def test_full_source_survives_cleanup_and_unmapped_registry(self):
        row = self.row(extra_hardware_metadata={'sensor_revision': 2})
        self.cloud = [row]
        backend.sync_cloud_telemetry_once()
        with closing(backend.get_db_connection()) as conn:
            self.assertEqual(json.loads(conn.execute('SELECT payload FROM telemetry_cloud_receipts').fetchone()[0]), row)
            self.assertEqual(conn.execute('SELECT count(*) FROM telemetry_monitor_sources').fetchone()[0], 1)
        self.assertEqual(self.cloud, [])

    def test_unexpected_acknowledgement_cannot_mark_other_records_cleaned(self):
        self.cloud = [self.row()]
        self.post.side_effect = lambda *a, **k: self.response({'acknowledged_ids': ['not-requested'], 'deleted_ids': [], 'changed_ids': []})
        result = backend.sync_cloud_telemetry_once()
        self.assertTrue(result['cleanup_error'])
        with closing(backend.get_db_connection()) as conn:
            self.assertIsNone(conn.execute('SELECT cleaned_at FROM telemetry_cloud_receipts').fetchone()[0])

    def test_backlog_scan_collects_late_rows_without_regressing_main_cursor(self):
        newer = self.row('newer')
        backend.import_cloud_telemetry([newer], (newer['created'], newer['id']), verified_cloud=True)
        older = self.row('late', created='2026-10-01T00:00:00+00:00')
        self.get.side_effect = [self.response([]), self.response([older])]
        backend.sync_cloud_telemetry_once()
        with closing(backend.get_db_connection()) as conn:
            self.assertIsNotNone(conn.execute("SELECT id FROM telemetry WHERE id='late'").fetchone())
            self.assertEqual(conn.execute("SELECT cursor_id FROM cloud_sync_state WHERE source='telemetry'").fetchone()[0], 'newer')
        self.assertIn('late', {row['id'] for row in self.rpc_records})

    def test_no_service_role_keeps_cloud_rows_and_durable_local_archive(self):
        self.cloud = [self.row()]
        with patch.dict(os.environ, {'SUPABASE_SERVICE_ROLE_KEY': '', 'SUPABASE_ANON_KEY': 'isolated-public-key'}):
            result = backend.sync_cloud_telemetry_once()
        self.assertEqual(result['transferred'], 1)
        self.assertTrue(result['cleanup_error'])
        self.post.assert_not_called()
        self.assertEqual(len(self.cloud), 1)



    def test_cloud_cleanup_waits_for_an_actual_sqlite_commit(self):
        self.cloud = [self.row()]
        with closing(backend.get_db_connection()) as conn:
            conn.execute("CREATE TRIGGER fail_bridge_save BEFORE INSERT ON telemetry BEGIN SELECT RAISE(ABORT,'Simulated save failure'); END")
            conn.commit()
        try:
            with self.assertRaises(sqlite3.IntegrityError):
                backend.sync_cloud_telemetry_once()
            self.post.assert_not_called()
            with closing(backend.get_db_connection()) as conn:
                self.assertEqual(conn.execute('SELECT count(*) FROM telemetry_cloud_receipts').fetchone()[0], 0)
        finally:
            with closing(backend.get_db_connection()) as conn:
                conn.execute('DROP TRIGGER fail_bridge_save')
                conn.commit()

    def test_lost_delete_response_is_safe_to_retry(self):
        self.cloud = [self.row()]
        def lose_response(*args, **options):
            self.acknowledge(*args, **options)
            raise backend.requests.ReadTimeout('Delete succeeded but response was lost')
        self.post.side_effect = lose_response
        self.assertTrue(backend.sync_cloud_telemetry_once()['cleanup_error'])
        self.assertEqual(self.cloud, [])
        self.post.side_effect = self.acknowledge
        result = backend.sync_cloud_telemetry_once()
        self.assertEqual(result['cleanup_pending'], 0)
        with closing(backend.get_db_connection()) as conn:
            self.assertEqual(conn.execute('SELECT count(*) FROM telemetry').fetchone()[0], 1)

    def test_monitoring_ui_can_rebuild_from_sqlite_after_cloud_cleanup(self):
        self.cloud = [self.row()]
        backend.sync_cloud_telemetry_once()
        self.assertEqual(self.cloud, [])
        backend.monitoring_service.reconcile_registry({'devices': [{
            'id': '11111111-1111-4111-8111-111111111111', 'registry_node_id': 'bridge-node',
            'device': {'name': 'Actual Sensor', 'aircon_id': 'ac-bridge', 'aircon_name': 'Actual AC',
                       'expected_interval_seconds': 5, 'location': 'Building / Room'}}]})
        backend.monitoring_service.bridge_registered_history()
        response = backend.app.test_client().get('/api/monitoring/devices')
        self.assertEqual(response.status_code, 200)
        latest = response.get_json()['items'][0]['latest']
        self.assertEqual(latest['outlet_temperature_c'], 18.25)
        self.assertEqual(latest['rotation_rpm'], 600)
        self.assertEqual(latest['interval_seconds'], 5)
        self.assertIsNone(latest['ac_on'])
        backend.monitoring_service.bridge_registered_history()
        with closing(backend.get_db_connection()) as conn:
            self.assertEqual(conn.execute('SELECT count(*) FROM monitor_samples').fetchone()[0], 1)

    def test_cleanup_failure_does_not_stop_new_readings(self):
        old = self.row()
        self.cloud = [old]
        self.post.side_effect = backend.requests.ConnectionError('Cleanup unavailable')
        backend.sync_cloud_telemetry_once()
        self.cloud.append(self.row('new-sample', sequence=2, interval_seconds=30))
        result = backend.sync_cloud_telemetry_once()
        self.assertEqual(result['transferred'], 1)
        with closing(backend.get_db_connection()) as conn:
            self.assertEqual(conn.execute('SELECT count(*) FROM telemetry').fetchone()[0], 2)
        self.assertEqual(len(self.cloud), 2)

    def test_reset_excluded_rows_are_not_acknowledged(self):
        row = self.row()
        backend.import_cloud_telemetry([row], verified_cloud=True)
        backend.app.test_client().delete('/api/telemetry', headers={'Authorization': 'Bearer ' + backend.monitoring_service.admin_token})
        self.cloud = [row]
        backend.sync_cloud_telemetry_once()
        self.post.assert_not_called()
        self.assertEqual(self.cloud, [row])

    def test_conflicting_backlog_row_does_not_block_other_old_readings(self):
        conflict = self.row('conflict')
        good = self.row('good', sequence=2)
        backend.import_cloud_telemetry([{**conflict, 'temperature': 99}])
        self.cloud = [conflict, good]
        self.get.side_effect = [self.response([]), self.response(list(self.cloud))]
        result = backend.sync_cloud_telemetry_once()
        self.assertTrue(result['backlog_error'])
        self.assertEqual(self.cloud, [conflict])
        with closing(backend.get_db_connection()) as conn:
            self.assertIsNotNone(conn.execute("SELECT id FROM telemetry WHERE id='good'").fetchone())


    def test_reappearing_hardware_retry_is_cleaned_without_duplicate_history(self):
        row = self.row()
        self.cloud = [row]
        backend.sync_cloud_telemetry_once()
        self.assertEqual(self.cloud, [])
        self.cloud = [dict(row)]  # A lost hardware response can recreate its old cloud ID.
        backend.sync_cloud_telemetry_once()
        self.assertEqual(self.cloud, [])
        with closing(backend.get_db_connection()) as conn:
            self.assertEqual(conn.execute('SELECT count(*) FROM telemetry').fetchone()[0], 1)
        self.assertEqual(len(self.rpc_records), 2)


    def test_highwater_conflict_does_not_starve_later_readings_or_cleanup(self):
        conflict = self.row('conflict')
        good = self.row('new-good', sequence=2)
        backend.import_cloud_telemetry([{**conflict, 'temperature': 99}])
        self.cloud = [conflict, good]
        result = backend.sync_cloud_telemetry_once()
        self.assertIn('conflict', result['import_conflict'])
        self.assertEqual(result['transferred'], 1)
        self.assertEqual(self.cloud, [conflict])
        with closing(backend.get_db_connection()) as conn:
            self.assertEqual(conn.execute("SELECT temperature FROM telemetry WHERE id='conflict'").fetchone()[0], 99)
            self.assertEqual(conn.execute("SELECT temperature FROM telemetry WHERE id='new-good'").fetchone()[0], 18.25)
            self.assertEqual(conn.execute("SELECT cursor_id FROM cloud_sync_state WHERE source='telemetry'").fetchone()[0], 'new-good')


if __name__ == '__main__':
    try:
        unittest.main()
    finally:
        storage.cleanup()
