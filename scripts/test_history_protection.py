"""History protection and incremental reads against temporary SQLite only."""
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path
import os
import shutil
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
import test_monitoring as fixture
from backend.history_health import HistoryHealth


class HistoryProtectionTests(unittest.TestCase):
    setUp = fixture.MonitoringTests.setUp
    create = fixture.MonitoringTests.create
    sample = fixture.MonitoringTests.sample
    upload = fixture.MonitoringTests.upload

    def manager(self, **extra):
        folder = tempfile.TemporaryDirectory(prefix='ecotrack-backup-test-')
        self.addCleanup(folder.cleanup)
        with patch.dict(os.environ, {'ECOTRACK_BACKUP_DIR': folder.name, 'ECOTRACK_BACKUP_KEEP': '2',
                'ECOTRACK_BACKUP_ENABLED': '1', 'ECOTRACK_DISK_WARNING_BYTES': '0'}):
            manager = HistoryHealth(fixture.backend.SQLITE_DB_PATH, fixture.backend.get_db_connection,
                lambda: {'running': True, 'last_success': None, 'error': None}, **extra)
        with closing(fixture.backend.get_db_connection()) as conn:
            conn.execute('UPDATE telemetry_backup_state SET last_success=NULL,completed_epoch=NULL,filename=NULL,error=NULL WHERE id=1')
            conn.commit()
        return manager

    def test_invalid_backup_configuration_keeps_safe_defaults(self):
        with patch.dict(os.environ, {'ECOTRACK_BACKUP_INTERVAL_SECONDS': 'invalid',
                'ECOTRACK_BACKUP_KEEP': 'invalid', 'ECOTRACK_DISK_WARNING_BYTES': 'invalid'}):
            manager = HistoryHealth(fixture.backend.SQLITE_DB_PATH, fixture.backend.get_db_connection, lambda: {})
        self.assertEqual(manager.interval, 86400)
        self.assertEqual(manager.keep, 7)
        self.assertEqual(manager.min_free, 512 * 1024 * 1024)

    def test_online_snapshot_restores_committed_wal_data_and_preserves_original(self):
        manager = self.manager()
        writer = fixture.backend.get_db_connection()
        self.addCleanup(writer.close)
        writer.execute('PRAGMA journal_mode=WAL')
        writer.execute("INSERT OR REPLACE INTO telemetry(id,temperature,rotation_rpm,created) VALUES('backup-zero',18.25,0,'2026-10-23T00:00:00Z')")
        writer.commit()  # Keep the connection open so a raw .db copy would miss WAL content.
        self.assertTrue(manager.backup())
        files = list(manager.folder.glob('ecotrack-auto-*.sqlite3'))
        self.assertEqual(len(files), 1)
        with closing(sqlite3.connect(files[0])) as saved:
            self.assertEqual(saved.execute("SELECT temperature,rotation_rpm FROM telemetry WHERE id='backup-zero'").fetchone(), (18.25, 0))
            self.assertEqual(saved.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
        self.assertEqual(writer.execute("SELECT temperature FROM telemetry WHERE id='backup-zero'").fetchone()[0], 18.25)
        self.assertTrue(manager.status()['backup']['available'])

    def test_schedule_survives_restart_and_rotates_only_owned_backups(self):
        moment = [1000000]
        manager = self.manager(clock=lambda: moment[0], cloud_count=lambda: 12)
        precious = manager.folder / 'manual-important.sqlite3'
        precious.write_bytes(b'User-owned file; never rotate')
        manager.tick()
        self.assertEqual(manager.status()['cloud']['pending'], 12)
        first = set(manager.folder.glob('ecotrack-auto-*.sqlite3'))
        manager.tick()
        self.assertEqual(set(manager.folder.glob('ecotrack-auto-*.sqlite3')), first)
        for _ in range(3):
            moment[0] += manager.interval + 1
            manager.tick()
        self.assertEqual(len(list(manager.folder.glob('ecotrack-auto-*.sqlite3'))), 2)
        self.assertTrue(precious.exists())
        self.assertIsNotNone(manager.status()['backup']['next_due_at'])
        self.assertEqual(list(manager.folder.glob('*.partial')), [])

    def test_low_disk_retains_previous_snapshot_and_cloud_failure_is_unknown(self):
        manager = self.manager(cloud_count=lambda: (_ for _ in ()).throw(RuntimeError('secret must never appear')))
        self.assertTrue(manager.backup())
        before = manager.status()['backup']['last_success']
        with patch('backend.history_health.shutil.disk_usage', return_value=shutil._ntuple_diskusage(1000, 1000, 0)):
            self.assertFalse(manager.backup())
            self.assertTrue(manager.status()['storage']['low_space'])
        self.assertEqual(manager.status()['backup']['last_success'], before)
        self.assertTrue(manager.status()['backup']['available'])
        manager.tick()
        self.assertIsNone(manager.status()['cloud']['pending'])
        self.assertNotIn('secret', str(manager.status()))
        self.assertFalse(manager._backup_lock.locked())

    def test_incremental_device_reads_cover_changes_deletions_and_generation_reset(self):
        first = self.create()
        self.create(aircon_id='other-ac', name='Other device')
        initial = self.api.get('/api/monitoring/devices').json
        query = {'since': initial['version'], 'generation': initial['generation']}
        self.assertEqual(self.api.get('/api/monitoring/changes', query_string=query).json['items'], [])
        old = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        self.assertEqual(self.upload(first, [self.sample(observed_at=old)]).status_code, 200)
        changed = self.api.get('/api/monitoring/changes', query_string=query).json
        self.assertEqual([item['id'] for item in changed['items']], [first['id']])
        self.assertEqual(changed['items'][0]['latest']['observed_at'], old)
        self.assertFalse(changed['items'][0]['fresh'], 'Receiving a queued reading does not make its old measurement live')
        current = {'since': changed['version'], 'generation': changed['generation']}
        self.assertEqual(self.api.get('/api/monitoring/changes', query_string=current).json['items'], [])
        with fixture.service.connection() as conn:
            conn.execute('DELETE FROM monitor_samples WHERE node_id=?', (first['id'],))
        self.assertIsNone(self.api.get('/api/monitoring/changes', query_string=current).json['items'][0]['latest'])
        reset = self.api.get('/api/monitoring/changes', query_string={**current, 'generation': 'old-session'}).json
        self.assertTrue(reset['reset'])
        self.assertEqual(len(reset['items']), 2)
        self.assertEqual(self.api.get('/api/monitoring/changes?since=invalid').status_code, 422)

    def test_history_health_is_local_and_exposes_no_credentials(self):
        local = self.api.get('/api/telemetry/health')
        self.assertEqual(local.status_code, 200)
        self.assertIn('pending_cleanup', local.json)
        self.assertIn('free_bytes', local.json['storage'])
        self.assertNotIn('token', str(local.json))
        for url in ['/api/telemetry/health', '/api/monitoring/history-health']:
            self.assertEqual(self.api.get(url, environ_overrides={'REMOTE_ADDR': '192.168.1.25'}).status_code, 403)


if __name__ == '__main__':
    unittest.main(verbosity=2)
