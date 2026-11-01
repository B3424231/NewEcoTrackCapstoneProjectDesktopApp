"""Boundary regressions against real Flask/SQLite; all data and networking isolated."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from contextlib import closing
from unittest.mock import patch
from unittest.mock import Mock

ROOT=Path(__file__).resolve().parents[1]
temporary=tempfile.TemporaryDirectory(prefix='ecotrack-io-contracts-')
os.environ['ECOTRACK_SQLITE_DB_PATH']=str(Path(temporary.name)/'telemetry.db')
os.environ['ECOTRACK_TELEMETRY_SYNC']='0'
os.environ['ECOTRACK_MONITOR_SYNC']='0'
spec=importlib.util.spec_from_file_location('io_workflow_backend',ROOT/'backend/app.py')
backend=importlib.util.module_from_spec(spec)
spec.loader.exec_module(backend)


class InputOutputContracts(unittest.TestCase):
    def setUp(self):
        self.api=backend.app.test_client()
        self.api.environ_base['HTTP_AUTHORIZATION']='Bearer '+backend.monitoring_service.admin_token
        with closing(backend.get_db_connection()) as conn:
            conn.execute('DELETE FROM telemetry')
            conn.commit()

    def count(self):
        return self.api.get('/api/telemetry').json['totalItems']

    def test_non_object_schedule_payloads_are_validation_errors(self):
        with patch.object(backend._schedule_executor,'submit') as submit:
            for value in [[{'node_id':'fixture'}],['fixture'],True,123,'fixture']:
                with self.subTest(value=value):
                    response=self.api.post('/api/set-sleep',json=value)
                    self.assertEqual(response.status_code,400,response.json)
                    self.assertIn('error',response.json)
            submit.assert_not_called()
        self.assertEqual(self.count(),0)

    def test_explicit_invalid_schedule_clocks_are_not_replaced_with_defaults(self):
        with patch.object(backend._schedule_executor,'submit') as submit:
            for field in ['wake_time','sleep_time']:
                for value in ['',None,False,[],{}]:
                    with self.subTest(field=field,value=value):
                        response=self.api.post('/api/set-sleep',json={'node_id':'fixture',field:value})
                        self.assertEqual(response.status_code,400,response.json)
            submit.assert_not_called()
        self.assertEqual(self.count(),0)

    def test_omitted_schedule_clocks_keep_existing_defaults_and_boundaries(self):
        with patch.object(backend._schedule_executor,'submit') as submit:
            for interval in [1,4294967]:
                result=self.api.post('/api/set-sleep',json={'node_id':'fixture','sleep_seconds':interval})
                self.assertEqual(result.status_code,202,result.json)
                self.assertEqual(submit.call_args.args[-2:],('06:00','22:00'))

    def test_schedule_snapshot_cannot_change_the_selected_target_or_bypass_validation(self):
        with patch.object(backend._schedule_executor,'submit') as submit:
            for snapshot in [{'node_id':'different-device'},{'temperature':True},{'battery':[]},{'room_name':{}},
                             {'rssi':'NaN'},{'node_id':17}]:
                with self.subTest(snapshot=snapshot):
                    result=self.api.post('/api/set-sleep',json={'node_id':'fixture','node_snapshot':snapshot})
                    self.assertEqual(result.status_code,400,result.json)
            submit.assert_not_called()
        self.assertEqual(self.count(),0)

    def test_boolean_temperature_is_invalid_through_both_field_names(self):
        for field in ['temperature','temp']:
            for value in [True,False]:
                with self.subTest(field=field,value=value):
                    result=self.api.post('/api/telemetry',json={'node_id':'fixture',field:value})
                    self.assertEqual(result.status_code,400,result.json)
        self.assertEqual(self.count(),0)

    def test_malformed_telemetry_identity_and_text_cannot_reach_sqlite(self):
        for field in ['id','node_id','sensor_name','room_name','floor_name','building_name','aircon_type','status','aircon_id']:
            for value in [True,17,[],{}]:
                with self.subTest(field=field,value=value):
                    result=self.api.post('/api/telemetry',json={'node_id':'fixture',field:value})
                    self.assertEqual(result.status_code,400,result.json)
        for field in ['id','node_id']:
            result=self.api.post('/api/telemetry',json={'node_id':'fixture',field:'   '})
            self.assertEqual(result.status_code,400,result.json)
        self.assertEqual(self.count(),0)

    def test_bad_batch_rolls_back_all_records_and_zero_stays_zero(self):
        valid={'id':'io-correlation-001','node_id':'fixture','temperature':0,'rotation_rpm':0,'battery':0,'rssi':0}
        result=self.api.post('/api/telemetry',json=[valid,{'node_id':'fixture','temp':True}])
        self.assertEqual(result.status_code,400,result.json)
        self.assertEqual(self.count(),0)
        result=self.api.post('/api/telemetry',json=valid)
        self.assertEqual(result.status_code,201,result.json)
        stored=self.api.get('/api/telemetry/io-correlation-001').json
        for field in ['temperature','rotation_rpm','battery','rssi']:
            self.assertEqual(stored[field],0)
        self.assertIsNone(stored['ac_on'])
        self.assertEqual(stored['id'],'io-correlation-001')

    def test_missing_and_nonfinite_measurements_remain_unknown_or_rejected(self):
        result=self.api.post('/api/telemetry',json={'node_id':'fixture'})
        self.assertEqual(result.status_code,201)
        for field in ['temperature','rotation_rpm','battery','rssi','ac_on']:
            self.assertIsNone(result.json[field])
        for field in ['temperature','temp','rotation_rpm','battery','rssi']:
            for value in ['NaN','Infinity',[],{}]:
                with self.subTest(field=field,value=value):
                    self.assertEqual(self.api.post('/api/telemetry',json={'node_id':'fixture',field:value}).status_code,400)
        self.assertEqual(self.count(),1)

    def test_boolean_cadence_is_rejected_and_oversized_measurements_are_validation_errors(self):
        for field,value in [('interval_seconds',True),('interval_seconds',False),('temperature',10**400),('temp',10**400)]:
            with self.subTest(field=field):
                result=self.api.post('/api/telemetry',json={'node_id':'fixture',field:value})
                self.assertEqual(result.status_code,400,result.json)
        self.assertEqual(self.count(),0)

    def test_snapshot_numeric_input_is_normalized_before_storage(self):
        with patch.object(backend._schedule_executor,'submit'):
            result=self.api.post('/api/set-sleep',json={'node_id':'fixture','node_snapshot':{'temperature':'1_000','battery':'3.70','rssi':'-6.2e1'}})
        self.assertEqual(result.status_code,202,result.json)
        stored=self.api.get('/api/telemetry/'+result.json['telemetry_id']).json
        self.assertEqual(stored['temperature'],1000)
        self.assertEqual(stored['battery'],3.7)
        self.assertEqual(stored['rssi'],-62)

    def test_patch_cannot_erase_node_identity_and_rejected_updates_preserve_records(self):
        self.assertEqual(self.api.post('/api/telemetry',json={'id':'io-patch','node_id':'fixture'}).status_code,201)
        for value in ['',None,'   ',17,False]:
            with self.subTest(value=value):
                result=self.api.patch('/api/telemetry/io-patch',json={'node_id':value})
                self.assertEqual(result.status_code,400,result.json)
                self.assertEqual(self.api.get('/api/telemetry/io-patch').json['node_id'],'fixture')

    def test_invalid_explicit_timestamps_never_become_current_or_missing_times(self):
        for field in ['observed_at','created','updated']:
            for value in [False,{},[],123,20261028,'0001-01-01T00:00:00+08:00','9999-12-31T23:59:59-08:00']:
                with self.subTest(field=field,value=value):
                    result=self.api.post('/api/telemetry',json={'node_id':'fixture',field:value})
                    self.assertEqual(result.status_code,400,result.json)
        self.assertEqual(self.count(),0)

    def test_schedule_ip_must_be_an_explicit_string(self):
        with patch.object(backend._schedule_executor,'submit') as submit:
            for field in ['ip','ip_address']:
                for value in [True,False,17,{},[]]:
                    with self.subTest(field=field,value=value):
                        result=self.api.post('/api/set-sleep',json={'node_id':'fixture',field:value})
                        self.assertEqual(result.status_code,400,result.json)
            submit.assert_not_called()
        self.assertEqual(self.count(),0)

    def test_cross_node_record_id_collision_returns_conflict_and_rolls_back_batch(self):
        original={'id':'io-duplicate','node_id':'original','temperature':0}
        self.assertEqual(self.api.post('/api/telemetry',json=original).status_code,201)
        self.assertEqual(self.api.post('/api/telemetry',json=original).status_code,201)
        result=self.api.post('/api/telemetry',json=[{'id':'must-rollback','node_id':'second'},
            {'id':'io-duplicate','node_id':'second','temperature':99}])
        self.assertEqual(result.status_code,409,result.json)
        self.assertEqual(self.count(),1)
        self.assertEqual(self.api.get('/api/telemetry/io-duplicate').json['node_id'],'original')

    def test_non_object_hardware_acknowledgments_fail_the_dispatch_explicitly(self):
        for acknowledgement in [[],True,None,'success']:
            with self.subTest(acknowledgement=acknowledgement):
                with patch.object(backend._schedule_executor,'submit'):
                    queued=self.api.post('/api/set-sleep',json={'node_id':'fixture','ip':'192.168.1.44'})
                job_id=queued.json['job_id']
                reply=Mock();reply.json.return_value=acknowledgement
                with patch.object(backend.requests,'post',return_value=reply):
                    backend.forward_schedule_interval(job_id,'fixture',30,'192.168.1.44')
                state=self.api.get('/api/set-sleep?job_id='+job_id).json
                self.assertEqual(state['status'],'failed',state)

    def test_patch_rejects_invalid_created_time_without_corrupting_history(self):
        self.api.post('/api/telemetry',json={'id':'io-date-patch','node_id':'fixture'})
        before=self.api.get('/api/telemetry/io-date-patch').json['created']
        for value in [None,'not-a-date','9999-12-31T23:59:59-08:00']:
            result=self.api.patch('/api/telemetry/io-date-patch',json={'created':value})
            self.assertEqual(result.status_code,400,result.json)
            self.assertEqual(self.api.get('/api/telemetry/io-date-patch').json['created'],before)

    def test_unrepresentable_schedule_interval_is_a_validation_error(self):
        with patch.object(backend._schedule_executor,'submit') as submit:
            result=self.api.post('/api/set-sleep',json={'node_id':'fixture','sleep_seconds':10**400})
            self.assertEqual(result.status_code,400,result.json)
            submit.assert_not_called()
        self.assertEqual(self.count(),0)


if __name__=='__main__':
    unittest.main(verbosity=2)
