"""Legacy API security checks; disposable SQLite and no live requests."""
import unittest
from contextlib import closing
import test_monitoring as fixture
backend = fixture.backend

class LocalApiAccessTests(unittest.TestCase):
    def setUp(self):
        self.api = backend.app.test_client()
        self.admin = {'Authorization': 'Bearer ' + backend.monitoring_service.admin_token}
        with closing(backend.get_db_connection()) as conn:
            conn.execute("INSERT OR REPLACE INTO telemetry(id,node_id,temperature) VALUES('access-fixture','node-fixture',20)")
            conn.commit()

    def test_lan_cannot_read_or_delete_history(self):
        for method in ('get', 'delete'):
            response = getattr(self.api, method)('/api/telemetry/access-fixture', environ_overrides={'REMOTE_ADDR':'192.0.2.10'}, headers=self.admin)
            self.assertEqual(response.status_code,403)
        with closing(backend.get_db_connection()) as conn:
            self.assertIsNotNone(conn.execute("SELECT id FROM telemetry WHERE id='access-fixture'").fetchone())

    def test_untrusted_origins_and_rebinding_hosts_are_rejected(self):
        for headers in ({'Origin':'https://untrusted.example'},{'Host':'untrusted.example:5000'}):
            self.assertEqual(self.api.get('/api/telemetry',headers=headers).status_code,403)

    def test_writes_require_the_existing_admin_credential(self):
        for method, route in [('delete','/api/telemetry/access-fixture'),('post','/api/telemetry'),('patch','/api/telemetry/access-fixture'),('post','/api/telemetry/transfer'),('post','/api/set-sleep')]:
            self.assertEqual(getattr(self.api,method)(route,json={}).status_code,401)
        self.assertEqual(self.api.delete('/api/telemetry/access-fixture',headers={'Authorization':'Bearer wrong'}).status_code,401)
        self.assertEqual(self.api.delete('/api/telemetry/access-fixture',headers=self.admin).status_code,200)

    def test_local_reads_and_read_only_prediction_remain_available(self):
        self.assertEqual(self.api.get('/api/telemetry/access-fixture',headers={'Origin':'null'}).status_code,401)
        self.assertEqual(self.api.get('/api/monitoring/devices',headers={'Origin':'null'}).status_code,401)
        self.assertEqual(self.api.get('/api/telemetry/access-fixture',headers={**self.admin,'Origin':'null'}).status_code,200)
        self.assertEqual(self.api.get('/api/health').status_code,200)
        self.assertNotIn(self.api.post('/api/predict-energy',json={}).status_code,(401,403))

    def test_lan_device_ingestion_uses_its_own_authentication(self):
        response=self.api.post('/api/monitoring/telemetry',json={},environ_overrides={'REMOTE_ADDR':'192.0.2.10'})
        self.assertIn(response.status_code,(400,401,404,422))

if __name__=='__main__': unittest.main()
