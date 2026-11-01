# Local telemetry health and verified online SQLite snapshots.
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
import os
import re
import shutil
import sqlite3
import threading
import time
import uuid


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def configured_int(name, default, minimum):
    try:
        return max(minimum, int(os.getenv(name, str(default))))
    except (TypeError, ValueError):
        return default


class HistoryHealth:
    def __init__(self, database, connect, sync_status, *, cloud_count=None, clock=time.time):
        self.database = Path(database).resolve()
        self.connect, self.sync_status, self.cloud_count, self.clock = connect, sync_status, cloud_count, clock
        self.folder = Path(os.getenv('ECOTRACK_BACKUP_DIR') or self.database.parent / 'backups' / 'automatic').resolve()
        self.enabled = os.getenv('ECOTRACK_BACKUP_ENABLED', '1').lower() not in {'0', 'false'}
        self.interval = configured_int('ECOTRACK_BACKUP_INTERVAL_SECONDS', 86400, 60)
        self.keep = configured_int('ECOTRACK_BACKUP_KEEP', 7, 2)
        self.min_free = configured_int('ECOTRACK_DISK_WARNING_BYTES', 512 * 1024 * 1024, 0)
        self.stop = threading.Event()
        self.thread = None
        self._backup_lock = threading.Lock()
        self._lock = threading.Lock()
        self._cloud = {'pending': None, 'checked_at': None, 'error': None}
        with closing(connect()) as conn:
            conn.execute('''CREATE TABLE IF NOT EXISTS telemetry_backup_state (
                id INTEGER PRIMARY KEY CHECK(id=1), last_success TEXT, completed_epoch REAL,
                filename TEXT, error TEXT)''')
            conn.execute('INSERT OR IGNORE INTO telemetry_backup_state(id) VALUES(1)')
            conn.commit()

    def storage(self):
        usage = shutil.disk_usage(self.database.parent)
        database_bytes = sum(path.stat().st_size for path in
            [self.database, Path(str(self.database) + '-wal'), Path(str(self.database) + '-shm')] if path.exists())
        return {'database_bytes': database_bytes, 'free_bytes': usage.free, 'total_bytes': usage.total,
                'low_space': usage.free < self.min_free or usage.free < usage.total * 0.05}

    def backup(self):
        if not self._backup_lock.acquire(blocking=False):
            return False
        temporary = None
        try:
            self.folder.mkdir(parents=True, exist_ok=True)
            usage = shutil.disk_usage(self.folder)
            if usage.free < self.database.stat().st_size + self.min_free:
                raise OSError('Insufficient backup space')
            stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
            final = self.folder / ('ecotrack-auto-' + stamp + '-' + uuid.uuid4().hex[:8] + '.sqlite3')
            temporary = final.with_suffix('.partial')
            # Online backup includes committed WAL content without an unsafe file copy.
            with closing(sqlite3.connect(self.database.as_uri() + '?mode=ro', uri=True, timeout=20)) as source:
                with closing(sqlite3.connect(temporary)) as target:
                    source.backup(target, pages=128, sleep=0.05)
                    if target.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                        raise OSError('Backup integrity check failed')
            with temporary.open('rb+') as stream:
                os.fsync(stream.fileno())
            os.replace(temporary, final)
            with closing(self.connect()) as conn:
                conn.execute('UPDATE telemetry_backup_state SET last_success=?,completed_epoch=?,filename=?,error=NULL WHERE id=1',
                             (utc_now(), self.clock(), final.name))
                conn.commit()
            # Rotate only this service's completed files. Source history is retained.
            owned = sorted((item for item in self.folder.iterdir() if not item.is_symlink() and item.is_file() and
                re.fullmatch(r'ecotrack-auto-\d{8}T\d{6}Z-[a-f0-9]{8}\.sqlite3', item.name)),
                key=lambda item: (item.stat().st_mtime_ns, item.name), reverse=True)
            for stale in owned[self.keep:]:
                if stale.resolve().parent == self.folder:
                    stale.unlink()
            return True
        except (OSError, sqlite3.Error):
            with closing(self.connect()) as conn:
                conn.execute('UPDATE telemetry_backup_state SET error=? WHERE id=1',
                             ('History backup failed. Check available disk space and the backup folder.',))
                conn.commit()
            return False
        finally:
            try:
                if temporary is not None and temporary.exists():
                    temporary.unlink()
            finally:
                self._backup_lock.release()

    def tick(self):
        if self.cloud_count is not None:
            try:
                count = self.cloud_count()
                if not isinstance(count, int) or isinstance(count, bool) or count < 0:
                    raise ValueError('Unknown bridge backlog')
                cloud = {'pending': count, 'checked_at': utc_now(), 'error': None}
            except Exception:
                cloud = {'pending': None, 'checked_at': utc_now(), 'error': 'Cloud backlog could not be checked.'}
            with self._lock:
                self._cloud = cloud
        with closing(self.connect()) as conn:
            state = conn.execute('SELECT completed_epoch,filename FROM telemetry_backup_state WHERE id=1').fetchone()
        last = state[0]
        if self.enabled and (last is None or not state[1] or not (self.folder / state[1]).is_file() or self.clock() - last >= self.interval):
            self.backup()

    def status(self):
        with closing(self.connect()) as conn:
            backup = dict(conn.execute('SELECT last_success,completed_epoch,filename,error FROM telemetry_backup_state WHERE id=1').fetchone())
            cleanup = conn.execute('SELECT COUNT(*) FROM telemetry_cloud_receipts r JOIN telemetry t ON t.id=r.id WHERE r.cleaned_at IS NULL').fetchone()[0]
            pending_backup = conn.execute('SELECT COUNT(*) FROM monitor_sync_outbox').fetchone()[0]
        with self._lock:
            cloud = dict(self._cloud)
        return {'checked_at': utc_now(), 'sync': dict(self.sync_status()), 'cloud': cloud,
                'pending_cleanup': cleanup, 'pending_monitor_backup': pending_backup,
                'storage': self.storage(), 'backup': {'enabled': self.enabled,
                'interval_seconds': self.interval, 'keep': self.keep, 'last_success': backup['last_success'],
                'next_due_at': datetime.fromtimestamp(backup['completed_epoch'] + self.interval, timezone.utc).isoformat()
                    if self.enabled and backup['completed_epoch'] is not None else None,
                'error': backup['error'], 'available': bool(backup['filename'] and (self.folder / backup['filename']).is_file())}}

    def start(self):
        if self.thread and self.thread.is_alive():
            return
        def run():
            while not self.stop.is_set():
                try:
                    self.tick()
                except (OSError, sqlite3.Error):
                    pass  # Health/backup failure must never stop ingestion.
                self.stop.wait(60)
        self.thread = threading.Thread(target=run, name='ecotrack-history-health', daemon=True)
        self.thread.start()
