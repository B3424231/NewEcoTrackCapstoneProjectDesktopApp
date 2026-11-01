"""Retirement, old-schema compatibility and replay protection on temporary databases."""
from pathlib import Path
from contextlib import closing
import json
import sqlite3
import tempfile
import unittest
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from flask import Flask
from backend.monitoring import Monitoring, SCHEMA
from retire_monitoring_pressure import retire, RETIRED


class RetirementTests(unittest.TestCase):
    def test_old_schema_retirement_preserves_other_data_and_recoverable_backup(self):
        with tempfile.TemporaryDirectory(prefix='ecotrack-retirement-') as directory:
            database=Path(directory)/'fixture.db'
            def connect():
                conn=sqlite3.connect(database);conn.row_factory=sqlite3.Row;return conn
            with closing(connect()) as conn, conn:
                conn.executescript(SCHEMA)
                conn.execute('CREATE TABLE telemetry(id TEXT PRIMARY KEY,temperature REAL,pressure REAL)')
                conn.execute("INSERT INTO telemetry VALUES('kept',18.5,123)")
                kinds={'temperature_sensor':"TEXT NOT NULL DEFAULT ''",'pressure_sensor':"TEXT NOT NULL DEFAULT ''",'pressure_min_pa':'REAL NOT NULL DEFAULT 0','pressure_max_pa':'REAL NOT NULL DEFAULT 0','pressure_offset_pa':'REAL NOT NULL DEFAULT 0','pressure_scale':'REAL NOT NULL DEFAULT 1','airflow_threshold_pa':'REAL','raw_pressure_pa':'REAL','differential_pressure_pa':'REAL','pressure_quality':"TEXT NOT NULL DEFAULT 'missing'"}
                for table,fields in RETIRED.items():
                    if table=='telemetry':continue
                    for field in fields:conn.execute('ALTER TABLE '+table+' ADD COLUMN '+field+' '+kinds[field])
            service=Monitoring(connect,Path(directory)/'admin.key')
            node=service.save_node(dict(name='Fixture',aircon_id='ac',aircon_name='AC',expected_interval_seconds=5))
            app=Flask(__name__)
            payload={'device_id':node['id'],'samples':[dict(boot_id='boot',sequence=1,observed_at='2026-10-18T00:00:00Z',clock_quality='synchronized',interval_seconds=5,outlet_temperature_c=18,rotation_rpm=0,ac_on=None)]}
            with app.test_request_context(headers={'Authorization':'Bearer '+node['device_token']}):
                self.assertEqual(service.ingest(payload)['inserted'],1)
                # A historical hash included the removed sensor; still-active values determine replay equivalence.
                with closing(connect()) as conn,conn:conn.execute("UPDATE monitor_samples SET payload_hash='retired-fingerprint',raw_pressure_pa=125,differential_pressure_pa=125")
                self.assertEqual(service.ingest(payload)['duplicates'],1)
                changed=json.loads(json.dumps(payload));changed['samples'][0]['rotation_rpm']=100
                with self.assertRaisesRegex(ValueError,'different readings'):service.ingest(changed)
            self.assertFalse(retire(database)['applied'])
            before={}
            with closing(connect()) as conn,conn:
                for table in RETIRED:
                    remaining=[row[1] for row in conn.execute('PRAGMA table_info('+table+')') if row[1] not in RETIRED[table]]
                    before[table]=(remaining,[tuple(row) for row in conn.execute('SELECT '+','.join(remaining)+' FROM '+table)])
            result=retire(database,apply=True)
            self.assertTrue(result['applied'])
            with closing(connect()) as conn,conn:
                for table,(fields,rows) in before.items():
                    self.assertEqual([tuple(row) for row in conn.execute('SELECT '+','.join(fields)+' FROM '+table)],rows)
                    self.assertFalse(set(RETIRED[table]) & {row[1] for row in conn.execute('PRAGMA table_info('+table+')')})
                self.assertTrue(all(not any('pressure' in key for key in json.loads(row[0])) for row in conn.execute('SELECT payload FROM monitor_sync_outbox')))
            with closing(sqlite3.connect(result['backup'])) as backup:
                self.assertEqual(backup.execute('SELECT differential_pressure_pa FROM monitor_samples').fetchone()[0],125)
            self.assertTrue(retire(database,apply=True)['already_retired'])


if __name__=='__main__':unittest.main(verbosity=2)
