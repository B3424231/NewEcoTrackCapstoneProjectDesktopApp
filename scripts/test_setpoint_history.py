"""Recorded setpoints and one-minute conditional estimates; temporary SQLite only."""
import copy
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import test_monitoring as fixture
from backend.energy_prediction import EnergyPredictor


class SetpointTests(fixture.MonitoringTests):
    def setUp(self):
        super().setUp()
        with fixture.service.connection() as conn:
            for table in ['telemetry_cloud_receipts','telemetry_monitor_sources','telemetry']:
                conn.execute('DELETE FROM ' + table)

    # Do not rerun the imported fixture suite through this subclass.
    def registry(self, identity='11111111-1111-4111-8111-111111111111', aircon='recorded-ac'):
        response = self.api.post('/api/monitoring/registry/reconcile', headers=self.headers, json={'devices':[{
            'id': identity, 'registry_node_id': identity, 'device': {'name': identity, 'aircon_id': aircon,
            'aircon_name': aircon, 'expected_interval_seconds': 5}}]})
        self.assertEqual(response.status_code, 200, response.json)
        return identity

    @staticmethod
    def snapshot(temp=24):
        return {'configured_state': {'temp': temp, 'mode': 'cool', 'fan': 'auto'}}

    def records(self, seconds=60, node='11111111-1111-4111-8111-111111111111', snapshot=None, start=None):
        start = start or datetime(2026, 10, 18, tzinfo=timezone.utc)
        return [dict(id=f'{node}-{i}',node_id=node,observed_at=(start+timedelta(seconds=i)).isoformat(),
            created=(start+timedelta(seconds=i)).isoformat(),interval_seconds=5,temperature=18,
            boot_id='boot',sequence=i,control_snapshot=copy.deepcopy(snapshot or self.snapshot()))
            for i in range(0, seconds + 1, 5)]

    def energy(self, **query):
        return self.api.get('/api/monitoring/energy', query_string={'from':'2026-10-18T00:00:00Z',
            'to':'2026-10-18T00:01:01Z', **query})

    def test_recorded_target_analytics_keep_raw_and_missing_history_separate(self):
        self.registry()
        rows = self.records(10)
        rows[1]['control_snapshot'] = self.snapshot(26)
        rows[2].pop('control_snapshot')
        fixture.backend.import_cloud_telemetry(rows, verified_cloud=True)
        stats = self.analytics()
        self.assertEqual(stats.get('target_temperature_count'), 2)
        self.assertEqual(stats['target_temperature_avg'], 25)
        self.assertEqual(stats['temperature_avg'], 18)
        self.assertEqual(stats['confirmed_unit_hours'], 0)
        samples = self.api.get('/api/monitoring/telemetry', query_string={
            'from':'2026-10-18T00:00:00Z','to':'2026-10-19T00:00:00Z'}).json['items']
        self.assertEqual([row['target_temperature_c'] for row in samples], [None, 26, 24])
        self.assertIsNone(samples[0]['ac_on'])
        self.assertTrue(any(point['target_temperature_c'] == 25 for point in stats['points']))

    def test_future_field_and_partial_remote_merge_follow_recorded_observation(self):
        self.registry()
        snapshot = self.snapshot(22)
        snapshot.update(desired_state={'temp':24,'mode':'heat','fan':'low'}, commanded_at='2026-10-17T23:59:00Z',
            reported_state={'temp':25},reported_at='2026-10-18T00:03:00Z',
            observed_remote_state={'temp':26,'fan':'high'},observed_remote_at='2026-10-18T00:00:00Z',
            observed_remote_field_at={'temp':'2026-10-17T23:58:00Z','fan':'2026-10-18T00:00:00Z'})
        fixture.backend.import_cloud_telemetry(self.records(0,snapshot=snapshot), verified_cloud=True)
        stats = self.analytics()
        self.assertEqual(stats.get('target_temperature_avg'), 24)
        from backend.control_energy import recorded_settings
        self.assertEqual(recorded_settings(snapshot, '2026-10-18T00:00:00Z'),
                         {'setpoint_c':24,'operating_mode':'heat','fan_command':'high'})
        self.assertEqual(recorded_settings({'configured_state':{'temperature':23,'mode':'cool','fan':'low'}},
                         '2026-10-18T00:00:00Z')['setpoint_c'],23)

    def test_exact_duplicate_can_retain_snapshot_but_untrusted_transfer_cannot(self):
        self.registry()
        rows = self.records(0)
        untrusted = copy.deepcopy(rows)
        fixture.backend.import_cloud_telemetry(untrusted)
        self.assertEqual(self.analytics().get('target_temperature_count'), 0)
        without = copy.deepcopy(rows)
        without[0].pop('control_snapshot')
        fixture.backend.import_cloud_telemetry(without, verified_cloud=True)
        with fixture.service.connection() as conn:
            before = fixture.service.revision(conn)['version']
        fixture.backend.import_cloud_telemetry(rows, verified_cloud=True)
        self.assertEqual(self.analytics()['sample_count'], 1)
        self.assertEqual(self.analytics().get('target_temperature_avg'), 24)
        with fixture.service.connection() as conn:
            self.assertGreater(fixture.service.revision(conn)['version'], before)
            conn.execute('UPDATE monitor_samples SET control_snapshot=NULL')
            projected = json.loads(conn.execute('SELECT payload FROM telemetry_monitor_sources').fetchone()[0])
            projected.pop('control_snapshot', None)
            conn.execute('UPDATE telemetry_monitor_sources SET payload=?',(json.dumps(projected),))
        fixture.service.bridge_registered_history()
        self.assertEqual(self.analytics()['target_temperature_avg'], 24, 'Verified archived exact source recovers old projection')

    def test_target_only_history_does_not_invent_model_feedback(self):
        node = self.create()
        recorded = []
        for second in range(0, 61, 5):
            sample = self.sample(sequence=second, observed_at=(datetime(2026,10,18,tzinfo=timezone.utc)+timedelta(seconds=second)).isoformat())
            sample['control_snapshot'] = self.snapshot(21)
            recorded.append(sample)
        fixture.service.ingest({'device_id':node['id'],'samples':recorded}, trusted=True)
        result = self.energy()
        self.assertEqual(result.status_code, 200, result.json)
        data = result.json
        self.assertTrue(data['available'])
        self.assertGreater(data['energy_kwh'], 0)
        self.assertEqual(data['model'], 'extra_trees')
        self.assertEqual(data['history_seconds'], 60)
        self.assertIsNone(data['measured_energy_kwh'])
        self.assertIsNone(data['physically_confirmed_ac_on'])
        self.assertFalse(data['runtime_confirmed'])
        self.assertEqual(self.analytics()['confirmed_unit_hours'], 0)
        status = self.api.get('/api/monitoring/energy-model').json
        self.assertEqual(status['model'], 'extra_trees')
        self.assertTrue(status['loaded'])

    def test_missing_controls_gap_and_multiple_sensor_overlap_are_unavailable(self):
        self.registry()
        from backend.control_energy import ControlHistoryEstimator
        estimator = ControlHistoryEstimator(Path(__file__).resolve().parents[1] / 'backend/ml/control_extra_trees')
        base = self.records(60)
        # Direct estimator rows mirror the actual stored identity and snapshot columns.
        def stored(source):
            return [dict(row,node_id=row['node_id'],aircon_id='recorded-ac',sensor_name='sensor',aircon_name='AC',
                clock_quality='synchronized',calibration_id='cal') for row in source]
        start,end='2026-10-18T00:00:00Z','2026-10-18T00:01:01Z'
        for rows in [base[:1],base[:6]+base[7:]]:
            self.assertFalse(estimator.estimate(stored(rows),start,end)['available'])
        for field in ['temp','mode','fan']:
            rows=copy.deepcopy(base)
            for row in rows: row['control_snapshot']['configured_state'].pop(field)
            self.assertFalse(estimator.estimate(stored(rows),start,end)['available'])
        rows=stored(base)
        self.assertFalse(estimator.estimate(rows+[{**row,'node_id':'other'} for row in rows],start,end)['available'])
        other=[{**row,'node_id':'other','aircon_id':'other-ac'} for row in rows]
        double=estimator.estimate(rows+other,start,end)
        self.assertTrue(double['available'])
        self.assertAlmostEqual(double['energy_kwh'],2*estimator.estimate(rows,start,end)['energy_kwh'])
        clipped=estimator.estimate(rows,'2026-10-18T00:00:20Z','2026-10-18T00:00:40Z')
        self.assertAlmostEqual(clipped['estimated_unit_hours'],20/3600)
        self.assertFalse(estimator.estimate(rows,start,end,('09:00','10:00'))['available'])


# Only the focused new tests are selected; the fixture suite is run separately.
if __name__ == '__main__':
    suite=unittest.TestSuite(SetpointTests(name) for name in SetpointTests.__dict__ if name.startswith('test_'))
    result=unittest.TextTestRunner(verbosity=2).run(suite)
    sys.exit(not result.wasSuccessful())
