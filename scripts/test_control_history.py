"""Actual trained model and temporary monitoring database. No external data writes."""
from pathlib import Path
import sys,copy,json,unittest
from datetime import datetime,timedelta,timezone
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT),str(ROOT/'scripts')]
import test_monitoring as fixture
from backend.control_energy import ControlHistoryEstimator,recorded_settings,target_temperature

class ControlHistoryTests(unittest.TestCase):
    def setUp(self):
        self.start=datetime(2026,10,18,tzinfo=timezone.utc)
        self.estimator=ControlHistoryEstimator(ROOT/'backend/ml/control_extra_trees')
        self.snapshot={'configured_state':{'temp':22,'fan':'high','mode':'cool'},'desired_state':{'temp':24},'commanded_at':self.at(-10)}
        self.rows=[dict(id=str(i),node_id='sensor',aircon_id='ac',sensor_name='AC sensor',aircon_name='AC',location='Building · Floor · Room',boot_id='boot',calibration_id='cal',clock_quality='synchronized',interval_seconds=5,observed_at=self.at(i*5),outlet_temperature_c=18,temperature_quality='ok',ac_on=None,rotation_rpm=600,control_snapshot=copy.deepcopy(self.snapshot)) for i in range(13)]
    def at(self,seconds):return (self.start+timedelta(seconds=seconds)).isoformat()
    def estimate(self,rows=None,start=0,end=120,clocks=(None,None)):
        return self.estimator.estimate(self.rows if rows is None else rows,self.at(start),self.at(end),clocks)
    def test_target_is_distinct_and_event_ordered(self):
        snapshot={**self.snapshot,'reported_state':{'temp':23},'reported_at':self.at(-20),'observed_remote_state':{'temp':25,'fan':'low'},'observed_remote_at':self.at(-5),'observed_remote_field_at':{'temp':self.at(-30),'fan':self.at(-5)}}
        self.assertEqual(target_temperature(snapshot,self.at(0)),24)
        self.assertEqual(recorded_settings(snapshot,self.at(0))['fan_command'],'low')
        snapshot['desired_state']['temp']=29;snapshot['commanded_at']=self.at(10)
        self.assertEqual(target_temperature(snapshot,self.at(0)),23)
        for value in [None,{},'broken',{'configured_state':{'temp':False}},{'configured_state':{'temp':'invalid'}}]:self.assertIsNone(target_temperature(value,self.at(0)))
    def test_exact_one_minute_is_ready_and_59_seconds_is_not(self):
        result=self.estimate();rate=self.estimator.predictor.predict_recorded({'settings':{'temp':24,'fan':'high','mode':'cool'}})['kwh']
        self.assertTrue(result['available'],result)
        self.assertEqual(result['history_seconds'],60)
        self.assertAlmostEqual(result['energy_kwh'],rate/60,places=10)
        self.assertAlmostEqual(result['estimated_unit_hours'],1/60)
        self.assertFalse(result['runtime_confirmed']);self.assertIsNone(result['physically_confirmed_ac_on'])
        short=[{**row,'interval_seconds':1,'observed_at':self.at(i)} for i,row in enumerate(self.rows*5) if i<60]
        self.assertFalse(self.estimate(short)['available'])
    def test_elapsed_timestamps_change_estimated_energy_for_the_same_reading_count(self):
        baseline = self.estimate()
        longer = [{**row, 'observed_at':self.at(i*10), 'interval_seconds':10} for i,row in enumerate(self.rows)]
        stretched = self.estimate(longer, end=121)
        self.assertTrue(stretched['available'])
        self.assertAlmostEqual(stretched['estimated_unit_hours'], 120/3600)
        self.assertAlmostEqual(stretched['energy_kwh'], 2*baseline['energy_kwh'])
        self.assertIsNone(stretched['measured_energy_kwh'])
        self.assertFalse(stretched['runtime_confirmed'])

    def test_raw_temperature_faults_and_rotation_do_not_change_control_estimate(self):
        expected=self.estimate()['energy_kwh']
        rows=[{**row,'outlet_temperature_c':None,'temperature_quality':'fault','rotation_rpm':0,'ac_on':False} for row in self.rows]
        self.assertEqual(self.estimate(rows)['energy_kwh'],expected)
    def test_missing_settings_gap_reboot_calibration_and_bad_cadence_reset_history(self):
        for field,value in [('control_snapshot',None),('clock_quality','unsynchronized'),('interval_seconds',3600)]:
            rows=copy.deepcopy(self.rows);rows[6][field]=value
            self.assertFalse(self.estimate(rows)['available'],field)
        for field in ['boot_id','calibration_id']:
            rows=copy.deepcopy(self.rows)
            for row in rows[6:]:row[field]='new'
            self.assertFalse(self.estimate(rows)['available'],field)
        self.assertFalse(self.estimate(self.rows[:6]+self.rows[7:])['available'])
        for settings in [{'temp':24},{'temp':24,'fan':'high'},{'fan':'high','mode':'cool'}]:
            self.assertFalse(self.estimate([{**row,'control_snapshot':{'configured_state':settings}} for row in self.rows])['available'])
    def test_filters_and_multiple_units_do_not_double_count(self):
        full=self.estimate();clipped=self.estimate(start=30,end=60)
        self.assertAlmostEqual(clipped['energy_kwh'],full['energy_kwh']/2)
        other=[{**row,'node_id':'other','aircon_id':'ac-2'} for row in self.rows]
        self.assertAlmostEqual(self.estimate(self.rows+other)['energy_kwh'],full['energy_kwh']*2)
        duplicate=[{**row,'node_id':'other'} for row in self.rows]
        self.assertFalse(self.estimate(self.rows+duplicate)['available'])
        self.assertFalse(self.estimate(clocks=('09:00','10:00'))['available'])

class TargetApiTests(unittest.TestCase):
    def setUp(self):
        self.fixture=fixture.MonitoringTests();self.fixture.setUp();self.api=self.fixture.api
        self.node=self.fixture.create();self.snapshot={'configured_state':{'temp':24,'fan':'high','mode':'cool'}}
    def test_historical_analytics_raw_and_target_are_separate_and_never_confirm_runtime(self):
        samples=[self.fixture.sample(sequence=i,observed_at=(datetime(2026,10,18,tzinfo=timezone.utc)+timedelta(seconds=5*i)).isoformat(),control_snapshot=self.snapshot) for i in range(13)]
        fixture.service.ingest({'device_id':self.node['id'],'samples':samples},trusted=True)
        stats=self.fixture.analytics()
        self.assertEqual(stats['temperature_avg'],18);self.assertEqual(stats['target_temperature_avg'],24)
        self.assertEqual(stats['target_temperature_count'],13);self.assertEqual(stats['confirmed_state_count'],0)
        self.assertTrue(all(p['target_temperature_c']==24 for p in stats['points'] if p['sample_count']))
        sample=self.api.get('/api/monitoring/telemetry',query_string={'from':'2026-10-18T00:00:00Z','to':'2026-10-19T00:00:00Z'}).json['items'][0]
        self.assertEqual(sample['outlet_temperature_c'],18);self.assertEqual(sample['target_temperature_c'],24)
        energy=self.api.get('/api/monitoring/energy',query_string={'from':'2026-10-18T00:00:00Z','to':'2026-10-19T00:00:00Z'}).json
        self.assertTrue(energy['available']);self.assertEqual(energy['history_seconds'],60)
        self.assertGreater(energy['energy_kwh'],0)
        self.assertEqual(energy['model'],'extra_trees')
        self.assertIsNone(energy['measured_energy_kwh'])
        self.assertIsNone(energy['physically_confirmed_ac_on'])
        self.assertEqual(stats['confirmed_unit_hours'],0)
    def test_untrusted_upload_rejects_controls_and_duplicate_enrichment_keeps_raw_measurement(self):
        raw=self.fixture.sample()
        self.assertEqual(self.fixture.upload(self.node,[{**raw,'control_snapshot':self.snapshot}]).status_code,422)
        self.assertEqual(self.fixture.upload(self.node,[raw]).status_code,200)
        with fixture.service.connection() as conn:before=fixture.service.revision(conn)['version']
        fixture.service.ingest({'device_id':self.node['id'],'samples':[{**raw,'control_snapshot':self.snapshot}]},trusted=True)
        with fixture.service.connection() as conn:
            self.assertGreater(fixture.service.revision(conn)['version'],before)
            row=conn.execute('SELECT * FROM monitor_samples').fetchone();self.assertEqual(row['outlet_temperature_c'],18)
        self.assertEqual(self.fixture.analytics()['target_temperature_avg'],24)
    def test_exact_verified_cloud_archive_restores_recorded_target_only(self):
        backend=fixture.backend
        with fixture.service.connection() as conn:
            conn.execute('UPDATE monitor_nodes SET registry_node_id=? WHERE id=?',('cloud-target-node',self.node['id']))
        row={'id':'target-archive-record','node_id':'cloud-target-node','created':'2026-10-18T00:00:00Z',
             'updated':'2026-10-18T00:00:00Z','observed_at':'2026-10-18T00:00:00Z','interval_seconds':5,
             'temperature':18,'rotation_rpm':0,'rotation_quality':'ok','boot_id':'archive-boot','sequence':1,
             'control_snapshot':self.snapshot}
        backend.import_cloud_telemetry([row],verified_cloud=True)
        self.assertEqual(self.fixture.analytics()['target_temperature_avg'],24)
        with fixture.service.connection() as conn:
            # Reproduce an older projection which dropped controls; keep the verified receipt.
            conn.execute('UPDATE monitor_samples SET control_snapshot=NULL WHERE node_id=?',(self.node['id'],))
            archived=conn.execute('SELECT payload FROM telemetry_monitor_sources WHERE source_id=?',(row['id'],)).fetchone()
            source=json.loads(archived['payload']);source.pop('control_snapshot',None)
            conn.execute('UPDATE telemetry_monitor_sources SET payload=? WHERE source_id=?',(json.dumps(source),row['id']))
        fixture.service.bridge_registered_history()
        stats=self.fixture.analytics();self.assertEqual(stats['target_temperature_avg'],24);self.assertEqual(stats['temperature_avg'],18)
        with fixture.service.connection() as conn:
            conn.execute('UPDATE monitor_samples SET control_snapshot=NULL WHERE node_id=?',(self.node['id'],))
            wrong={**row,'node_id':'different-device'}
            conn.execute('UPDATE telemetry_cloud_receipts SET payload=? WHERE id=?',(json.dumps(wrong),row['id']))
        fixture.service.bridge_registered_history()
        self.assertIsNone(self.fixture.analytics()['target_temperature_avg'],'A mismatched archive cannot provide historical settings')
    def test_missing_snapshot_does_not_use_measured_temperature(self):
        self.fixture.upload(self.node,[self.fixture.sample()])
        stats=self.fixture.analytics();self.assertEqual(stats['temperature_avg'],18);self.assertIsNone(stats['target_temperature_avg'])

if __name__=='__main__':unittest.main()
