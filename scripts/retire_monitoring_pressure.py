"""Explicit retirement of unused stored fields. Dry-run unless --apply is supplied.

Stop EcoTrack and its local backend first. A full recoverable pre-change backup
is retained; it contains the retired fields and is not silently deleted.
"""
import argparse
from contextlib import closing
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
import uuid

RETIRED = {
    'telemetry': ['pressure'],
    'monitor_nodes': ['temperature_sensor','pressure_sensor','pressure_min_pa','pressure_max_pa'],
    'monitor_calibrations': ['pressure_offset_pa','pressure_scale','airflow_threshold_pa'],
    'monitor_samples': ['raw_pressure_pa','differential_pressure_pa','pressure_quality'],
}


def retirement_plan(conn):
    return {table:[field for field in fields if field in {row[1] for row in conn.execute('PRAGMA table_info('+table+')')}]
            for table,fields in RETIRED.items()}


def retire(database, backup_dir=None, *, apply=False):
    database=Path(database).resolve(strict=True)
    if not apply:
        with closing(sqlite3.connect(database.as_uri()+'?mode=ro',uri=True)) as conn:
            return {'applied':False,'database':str(database),'columns':retirement_plan(conn)}
    if sqlite3.sqlite_version_info < (3,35,0): raise RuntimeError('SQLite 3.35 or later is required')
    backup_dir=Path(backup_dir).resolve() if backup_dir else database.parent/'backups'
    backup_dir.mkdir(parents=True,exist_ok=True)
    backup=backup_dir/(database.stem+'-before-monitor-retirement-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+uuid.uuid4().hex[:8]+'.db')
    with closing(sqlite3.connect(database,timeout=20)) as conn:
        conn.execute('BEGIN IMMEDIATE')
        plan=retirement_plan(conn)
        if not any(plan.values()):
            conn.rollback()
            return {'applied':False,'database':str(database),'columns':plan,'already_retired':True}
        backup.touch(exist_ok=False)
        with closing(sqlite3.connect(database.as_uri()+'?mode=ro',uri=True)) as source, closing(sqlite3.connect(backup)) as saved:
            source.backup(saved)
            if saved.execute('PRAGMA integrity_check').fetchone()[0]!='ok': raise RuntimeError('Backup integrity check failed')
        try:
            conn.execute('PRAGMA secure_delete=ON')
            for table,fields in plan.items():
                for field in fields: conn.execute('ALTER TABLE '+table+' DROP COLUMN '+field)
            if conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='monitor_sync_outbox'").fetchone():
                removed={field for fields in RETIRED.values() for field in fields}
                for identity,payload in conn.execute('SELECT id,payload FROM monitor_sync_outbox').fetchall():
                    value=json.loads(payload)
                    value={key:item for key,item in value.items() if key not in removed}
                    conn.execute('UPDATE monitor_sync_outbox SET payload=? WHERE id=?',(json.dumps(value,allow_nan=False),identity))
            if conn.execute('PRAGMA foreign_key_check').fetchone(): raise RuntimeError('Foreign-key check failed')
            if conn.execute('PRAGMA integrity_check').fetchone()[0]!='ok': raise RuntimeError('Integrity check failed')
            if conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='telemetry_history_generation'").fetchone():
                conn.execute('UPDATE telemetry_history_generation SET token=lower(hex(randomblob(16))) WHERE id=1')
            conn.commit()
            conn.execute('VACUUM')
        except Exception:
            conn.rollback()
            raise
    return {'applied':True,'database':str(database),'backup':str(backup),'removed_columns':plan}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database',type=Path,required=True)
    parser.add_argument('--backup-dir',type=Path)
    parser.add_argument('--apply',action='store_true')
    arguments=parser.parse_args()
    print(json.dumps(retire(arguments.database,arguments.backup_dir,apply=arguments.apply),indent=2))
