"""Independent local AC measurements and explicitly marked experimental energy estimates."""
import csv
import hashlib
import hmac
import io
import json
import math
import os
import re
from pathlib import Path
import secrets
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from ipaddress import ip_address
from urllib.parse import urlparse
import uuid
from contextlib import nullcontext

from flask import Blueprint, Response, jsonify, request, stream_with_context
import requests

from backend.control_energy import snapshot_object, target_temperature, epoch

SCHEMA = """
CREATE TABLE IF NOT EXISTS monitor_nodes (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, aircon_id TEXT NOT NULL, aircon_name TEXT NOT NULL,
 location TEXT NOT NULL DEFAULT '',
 state_source TEXT NOT NULL DEFAULT 'none', expected_interval_seconds REAL NOT NULL,
 active INTEGER NOT NULL DEFAULT 1, token_hash TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS monitor_one_active_per_ac ON monitor_nodes(aircon_id) WHERE active=1;
CREATE TABLE IF NOT EXISTS monitor_calibrations (
 id TEXT PRIMARY KEY, node_id TEXT NOT NULL REFERENCES monitor_nodes(id), valid_from TEXT NOT NULL,
 temperature_offset_c REAL NOT NULL, notes TEXT NOT NULL, field_calibrated INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS monitor_cal_node_time ON monitor_calibrations(node_id,valid_from);
CREATE TABLE IF NOT EXISTS monitor_samples (
 id TEXT PRIMARY KEY, node_id TEXT NOT NULL REFERENCES monitor_nodes(id), aircon_id TEXT NOT NULL,
 aircon_name TEXT NOT NULL, observed_at TEXT, received_at TEXT NOT NULL, boot_id TEXT NOT NULL,
 sequence INTEGER NOT NULL, uptime_ms INTEGER, interval_seconds REAL NOT NULL, clock_quality TEXT NOT NULL,
 raw_temperature_c REAL, outlet_temperature_c REAL, rotation_rpm REAL,
 ac_on INTEGER, state_source TEXT, temperature_quality TEXT NOT NULL, rotation_quality TEXT NOT NULL,
 calibration_id TEXT NOT NULL REFERENCES monitor_calibrations(id), payload_hash TEXT NOT NULL,
 UNIQUE(node_id,boot_id,sequence)
);
CREATE INDEX IF NOT EXISTS monitor_sample_ac_time ON monitor_samples(aircon_id,observed_at);
CREATE INDEX IF NOT EXISTS monitor_sample_node_time ON monitor_samples(node_id,observed_at);
CREATE INDEX IF NOT EXISTS monitor_sample_received ON monitor_samples(node_id,received_at);
CREATE TABLE IF NOT EXISTS monitor_sync_outbox (
 id INTEGER PRIMARY KEY AUTOINCREMENT, table_name TEXT NOT NULL, object_id TEXT NOT NULL, payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS monitor_sync_status (id INTEGER PRIMARY KEY CHECK(id=1),last_success TEXT,error TEXT);
CREATE TABLE IF NOT EXISTS sensor_schedules (
 node_id TEXT PRIMARY KEY REFERENCES monitor_nodes(id), wake_time TEXT NOT NULL,
 sleep_time TEXT NOT NULL, interval_seconds INTEGER NOT NULL, updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO monitor_sync_status(id) VALUES(1);
"""
STATE_SOURCES = {'none', 'power_meter', 'isolated_contact'}
SAMPLE_FIELDS = {'boot_id', 'sequence', 'uptime_ms', 'observed_at', 'interval_seconds', 'clock_quality',
                 'outlet_temperature_c', 'rotation_rpm', 'ac_on', 'state_source',
                 'temperature_quality', 'rotation_quality', 'battery_voltage', 'rssi_dbm', 'connection_status', 'operating_mode'}


# Read compatibility only. These retired values never enter outputs, calibration or models.
RETIRED_FIELDS = {'temperature_sensor', 'pressure_sensor', 'pressure_min_pa', 'pressure_max_pa',
                  'raw_pressure_pa', 'differential_pressure_pa', 'pressure_quality',
                  'pressure_offset_pa', 'pressure_scale', 'airflow_threshold_pa'}


def active_fields(row):
    return {key: value for key, value in dict(row).items() if key not in RETIRED_FIELDS}


def insert_record(conn, table, record):
    # Existing installations can run before the explicit retirement migration.
    # Neutral compatibility metadata satisfies old NOT NULL columns; no reading is invented.
    old_defaults = {'monitor_nodes': {'temperature_sensor': '', 'pressure_sensor': '', 'pressure_min_pa': 0, 'pressure_max_pa': 0},
                    'monitor_calibrations': {'pressure_offset_pa': 0, 'pressure_scale': 1},
                    'monitor_samples': {'pressure_quality': 'missing'}}
    columns = {row[1] for row in conn.execute('PRAGMA table_info(' + table + ')')}
    values = {key: value for key, value in old_defaults.get(table, {}).items() if key in columns}
    values.update(record)
    keys = list(values)
    conn.execute('INSERT INTO ' + table + '(' + ','.join(keys) + ') VALUES(' + ','.join('?' for _ in keys) + ')',
                 [values[key] for key in keys])


def now():
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


class Invalid(ValueError):
    def __init__(self, message, status=422):
        super().__init__(message)
        self.status = status


def text(value, name, maximum=160):
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > maximum:
        raise Invalid(f'{name} is required (maximum {maximum} characters).')
    return value.strip()


def number(value, name, minimum=None, maximum=None, nullable=False):
    if value is None and nullable:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise Invalid(f'{name} must be a finite number.')
    if (minimum is not None and value < minimum) or (maximum is not None and value > maximum):
        raise Invalid(f'{name} is outside its supported range.')
    return float(value)


def timestamp(value, name='observed_at'):
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if parsed.tzinfo is None:
            raise ValueError()
        if parsed.astimezone(timezone.utc).year < 1970:
            raise ValueError()
        return parsed.astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    except (ValueError, TypeError, AttributeError, OverflowError):
        raise Invalid(f'{name} must include a valid date, time and timezone at or after the Unix epoch.') from None


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


class Monitoring:
    def __init__(self, connect, key_path):
        self.connect = connect
        self.stop = threading.Event()
        self.thread = None
        configured = os.getenv('ECOTRACK_MONITOR_ADMIN_TOKEN')
        if configured and len(configured) < 32:
            raise ValueError('ECOTRACK_MONITOR_ADMIN_TOKEN must contain at least 32 characters')
        if configured:
            self.admin_token = configured
        else:
            key = Path(key_path)
            try:
                with key.open('x', encoding='utf-8') as stream:
                    stream.write('eta_' + secrets.token_urlsafe(48))
                key.chmod(0o600)
            except FileExistsError:
                pass
            self.admin_token = key.read_text(encoding='utf-8').strip()
            if len(self.admin_token) < 32:
                raise ValueError('Monitoring administrator credential is invalid')
        with self.connection() as conn:
            conn.executescript(SCHEMA)
            # Additive sensor log fields; existing history remains null, never backfilled.
            additions = {'monitor_nodes': {'aircon_type': 'TEXT', 'registry_node_id': 'TEXT', 'registry_retired': 'INTEGER NOT NULL DEFAULT 0'}, 'monitor_samples': {
                'sensor_name': 'TEXT', 'location': 'TEXT', 'aircon_type': 'TEXT',
                'battery_voltage': 'REAL', 'rssi_dbm': 'REAL', 'connection_status': 'TEXT', 'operating_mode': 'TEXT',
                'rotation_rpm': 'REAL', 'rotation_quality': "TEXT NOT NULL DEFAULT 'missing'", 'control_snapshot': 'TEXT'}}
            for table, fields in additions.items():
                existing = {row[1] for row in conn.execute('PRAGMA table_info(' + table + ')')}
                for field, kind in fields.items():
                    if field not in existing:
                        conn.execute('ALTER TABLE ' + table + ' ADD COLUMN ' + field + ' ' + kind)

        # A bounded per-device change index avoids rereading unchanged histories.
        with self.connection() as conn:
            conn.executescript('''
                CREATE TABLE IF NOT EXISTS monitor_revision (
                    id INTEGER PRIMARY KEY CHECK(id=1), generation TEXT NOT NULL, version INTEGER NOT NULL);
                INSERT OR IGNORE INTO monitor_revision VALUES(1,lower(hex(randomblob(16))),0);
                CREATE TABLE IF NOT EXISTS monitor_changed_nodes (node_id TEXT PRIMARY KEY, version INTEGER NOT NULL);
            ''')
            for table in ('monitor_nodes', 'monitor_samples', 'monitor_calibrations', 'sensor_schedules'):
                for action in ('INSERT', 'UPDATE', 'DELETE'):
                    field = 'id' if table == 'monitor_nodes' else 'node_id'
                    reference = ('OLD.' if action == 'DELETE' else 'NEW.') + field
                    conn.execute(f'''CREATE TRIGGER IF NOT EXISTS {table}_changed_{action.lower()} AFTER {action} ON {table}
                        BEGIN
                        UPDATE monitor_revision SET version=version+1 WHERE id=1;
                        INSERT INTO monitor_changed_nodes(node_id,version) VALUES({reference},(SELECT version FROM monitor_revision WHERE id=1))
                        ON CONFLICT(node_id) DO UPDATE SET version=excluded.version;
                        END''')

    @staticmethod
    def revision(conn):
        return dict(conn.execute('SELECT generation,version FROM monitor_revision WHERE id=1').fetchone())

    def connection(self):
        # sqlite context managers commit/rollback but do not close their connection.
        from contextlib import contextmanager

        @contextmanager
        def managed():
            conn = self.connect()
            conn.execute('PRAGMA foreign_keys=ON')
            try:
                with conn:
                    yield conn
            finally:
                conn.close()
        return managed()

    def queue(self, conn, table, row):
        payload = {k: v for k, v in active_fields(row).items() if k not in {'token_hash', 'payload_hash', 'registry_node_id', 'registry_retired', 'control_snapshot'}}
        for key in ('active', 'field_calibrated', 'ac_on'):
            if payload.get(key) is not None:
                payload[key] = bool(payload[key])
        conn.execute('INSERT INTO monitor_sync_outbox(table_name,object_id,payload) VALUES(?,?,?)',
                     (table, payload['id'], json.dumps(payload, allow_nan=False)))

    def admin(self):
        if not ip_address(request.remote_addr or '0.0.0.0').is_loopback:
            raise Invalid('Device administration is available only from the desktop.', 403)
        if not hmac.compare_digest(request.headers.get('Authorization', ''), 'Bearer ' + self.admin_token):
            raise Invalid('Administrator authorization is required.', 401)

    def node(self, conn, node_id):
        row = conn.execute('SELECT * FROM monitor_nodes WHERE id=?', (node_id,)).fetchone()
        if row is None:
            raise Invalid('Monitoring device was not found.', 404)
        return row

    def save_node(self, data, node_id=None, *, imported_id=None, connection=None):
        allowed = {'name', 'aircon_id', 'aircon_name', 'location', 'state_source', 'expected_interval_seconds', 'active', 'aircon_type'}
        if isinstance(data, dict): data = active_fields(data)
        if not isinstance(data, dict) or set(data) - allowed:
            raise Invalid('Unsupported monitoring device field.')
        token = 'etm_' + secrets.token_urlsafe(32) if node_id is None else None
        with (nullcontext(connection) if connection is not None else self.connection()) as conn:
            previous = dict(self.node(conn, node_id)) if node_id else {}
            values = {**previous, **data}
            for field in ['name', 'aircon_id', 'aircon_name']:
                values[field] = text(values.get(field), field)
            values['location'] = str(values.get('location') or '').strip()[:240]
            values['aircon_type'] = text(values['aircon_type'], 'aircon_type') if values.get('aircon_type') else None
            values['expected_interval_seconds'] = number(values.get('expected_interval_seconds', 5), 'Expected interval', 1, 86400)
            values['state_source'] = values.get('state_source', 'none')
            if values['state_source'] not in STATE_SOURCES:
                raise Invalid('Select a supported independent power-feedback source.')
            if 'active' in values and values['active'] not in (True, False, 0, 1):
                raise Invalid('Active must be a boolean.')
            values['active'] = int(bool(values.get('active', True)))
            stamp = now()
            if node_id:
                fields = list(allowed)
                conn.execute('UPDATE monitor_nodes SET ' + ','.join(f'{field}=?' for field in fields) + ',updated_at=? WHERE id=?',
                             [values[field] for field in fields] + [stamp, node_id])
                if 'active' in data:
                    conn.execute('UPDATE monitor_nodes SET registry_retired=0 WHERE id=?', (node_id,))
            else:
                node_id = imported_id or str(uuid.uuid4())
                insert_record(conn, 'monitor_nodes', dict(id=node_id, name=values['name'], aircon_id=values['aircon_id'],
                    aircon_name=values['aircon_name'], location=values['location'], state_source=values['state_source'],
                    expected_interval_seconds=values['expected_interval_seconds'], active=values['active'], token_hash=digest(token),
                    created_at=stamp, updated_at=stamp, aircon_type=values['aircon_type']))
            self.queue(conn, 'monitor_nodes', self.node(conn, node_id))
            if token:
                self.calibrate(conn, node_id, {}, factory=True)
            result = self.public_node(conn, self.node(conn, node_id))
            if token and not imported_id:
                result['device_token'] = token  # Returned once; only its hash is persisted.
            return result

    def reconcile_registry(self, payload):
        """Apply one verified complete cloud snapshot atomically, keeping all history."""
        if not isinstance(payload, dict) or set(payload) != {'devices'} or not isinstance(payload['devices'], list):
            raise Invalid('Provide a complete verified device registry.')
        entries, identities, sources, aircons = [], set(), set(), set()
        allowed = {'name', 'aircon_id', 'aircon_name', 'aircon_type', 'location', 'expected_interval_seconds'}
        for entry in payload['devices']:
            if not isinstance(entry, dict) or set(entry) != {'id', 'registry_node_id', 'device'}:
                raise Invalid('Invalid registered sensor identity.')
            try:
                identity = str(uuid.UUID(entry['id']))
            except (ValueError, TypeError, AttributeError):
                raise Invalid('Invalid registered sensor identity.') from None
            source = text(entry['registry_node_id'], 'registry_node_id')
            device = active_fields(entry['device']) if isinstance(entry['device'], dict) else entry['device']
            if not isinstance(device, dict) or set(device) - allowed:
                raise Invalid('Unsupported registered sensor metadata.')
            ac = text(device.get('aircon_id'), 'aircon_id')
            if identity in identities or source in sources or ac in aircons:
                raise Invalid('The registry contains conflicting device assignments.', 409)
            identities.add(identity); sources.add(source); aircons.add(ac)
            entries.append((identity, source, device))
        changed = set()
        desired_devices = {identity: device for identity, _, device in entries}
        with self.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            existing = {row['id']: dict(row) for row in conn.execute('SELECT * FROM monitor_nodes')}
            # Retire only records explicitly adopted from verified cloud registration.
            # Deactivation frees the unique active-AC assignment without deleting samples.
            for identity, previous in existing.items():
                desired = desired_devices.get(identity)
                if previous['registry_node_id'] and previous['active'] and (
                        desired is None or desired['aircon_id'] != previous['aircon_id']):
                    conn.execute('UPDATE monitor_nodes SET active=0,registry_retired=1,updated_at=? WHERE id=?', (now(), identity))
                    self.queue(conn, 'monitor_nodes', self.node(conn, identity))
                    changed.add(identity)
            for identity, source, device in entries:
                previous = existing.get(identity)
                if previous and (previous['registry_node_id'] not in (None, source) or
                        previous['registry_node_id'] is None and previous['aircon_id'] != device['aircon_id']):
                    raise Invalid('The registry identity conflicts with an existing local monitor.', 409)
                active = not previous or bool(previous['active'] or previous['registry_retired'])
                same = previous and previous['registry_node_id'] == source and bool(previous['active']) == active and all(
                    previous.get(key) == value for key, value in device.items())
                if same:
                    continue
                self.save_node({**device, 'active': active}, identity if previous else None,
                               imported_id=None if previous else identity, connection=conn)
                conn.execute('UPDATE monitor_nodes SET registry_node_id=?,registry_retired=0 WHERE id=?', (source, identity))
                changed.add(identity)
        return {'changed': len(changed)}

    def calibrate(self, conn, node_id, data, factory=False):
        self.node(conn, node_id)
        fields = {'temperature_offset_c', 'notes'}
        if not isinstance(data, dict) or set(data) - fields:
            raise Invalid('Unsupported calibration field.')
        offset_t = number(data.get('temperature_offset_c', 0), 'Temperature offset', -20, 20)
        notes = 'Factory units; no field calibration recorded.' if factory else text(data.get('notes'), 'Calibration notes', 500)
        stamp, cal_id = now(), str(uuid.uuid4())
        insert_record(conn, 'monitor_calibrations', dict(id=cal_id, node_id=node_id,
            valid_from='1970-01-01T00:00:00.000Z' if factory else stamp, temperature_offset_c=offset_t,
            notes=notes, field_calibrated=int(not factory), created_at=stamp))
        row = conn.execute('SELECT * FROM monitor_calibrations WHERE id=?', (cal_id,)).fetchone()
        self.queue(conn, 'monitor_calibrations', row)
        return active_fields(row)

    def normalize_sample(self, raw, node):
        if isinstance(raw, dict): raw = active_fields(raw)
        if not isinstance(raw, dict) or set(raw) - SAMPLE_FIELDS:
            raise Invalid('Unsupported sample field. Monitoring does not accept control commands.')
        item = dict(raw)
        item['boot_id'] = text(item.get('boot_id'), 'boot_id', 80)
        for key in ['sequence', 'uptime_ms']:
            value = item.get(key)
            if key == 'uptime_ms' and value is None:
                continue
            if isinstance(value, bool) or not isinstance(value, int) or value < 0 or value > 9007199254740991:
                raise Invalid(f'{key} must be a nonnegative integer.')
        item['interval_seconds'] = number(item.get('interval_seconds'), 'Recorded interval', 0.1, 86400)
        quality = item.get('clock_quality')
        if quality not in {'synchronized', 'unsynchronized'}:
            raise Invalid('clock_quality must be synchronized or unsynchronized.')
        observed = item.get('observed_at')
        if quality == 'synchronized':
            observed = timestamp(observed)
            if datetime.fromisoformat(observed.replace('Z', '+00:00')) > datetime.now(timezone.utc) + timedelta(minutes=5):
                raise Invalid('Observation timestamp is too far in the future.')
        elif observed is not None:
            raise Invalid('Unsynchronized samples must leave observed_at null.')
        item['observed_at'] = observed
        for value_key, quality_key in [('outlet_temperature_c', 'temperature_quality'), ('rotation_rpm', 'rotation_quality')]:
            item[value_key] = number(item.get(value_key), value_key, minimum=0 if value_key == 'rotation_rpm' else None, nullable=True)
            sensor_quality = item.get(quality_key, 'ok' if item[value_key] is not None else 'missing')
            if sensor_quality not in {'ok', 'missing', 'fault'} or (sensor_quality == 'ok' and item[value_key] is None):
                raise Invalid(f'{quality_key} does not match the measurement.')
            item[quality_key] = sensor_quality
        power = item.get('ac_on')
        source = item.get('state_source')
        if power is not None:
            if not isinstance(power, bool) or source not in STATE_SOURCES - {'none'} or source != node['state_source']:
                raise Invalid('AC power requires a boolean and the configured independent feedback source.')
        elif source not in (None, 'none'):
            raise Invalid('Unknown AC power must leave state_source null.')
        item['ac_on'], item['state_source'] = power, source if power is not None else None
        item['uptime_ms'] = item.get('uptime_ms')
        if 'battery_voltage' in item:
            item['battery_voltage'] = number(item['battery_voltage'], 'battery_voltage', 0, 30, nullable=True)
        if 'rssi_dbm' in item:
            item['rssi_dbm'] = number(item['rssi_dbm'], 'rssi_dbm', -127, 0, nullable=True)
        if 'connection_status' in item and item['connection_status'] not in (None, 'online', 'offline', 'unknown'):
            raise Invalid('connection_status must be online, offline, unknown or null.')
        # Optional device-reported mode is independent of physical power feedback.
        # Do not insert a missing key into the fingerprint: old uploads must remain idempotent.
        if 'operating_mode' in item and item['operating_mode'] not in (None, 'cool', 'fan_only', 'dry', 'heat', 'auto', 'off'):
            raise Invalid('operating_mode must be cool, fan_only, dry, heat, auto, off or null.')
        return item

    def ingest(self, data, *, trusted=False):
        if not isinstance(data, dict):
            raise Invalid('Send a monitoring sample or a samples array.')
        node_id = text(data.get('device_id'), 'device_id')
        if 'samples' in data:
            if set(data) != {'device_id', 'samples'}:
                raise Invalid('Batch uploads accept only device_id and samples.')
            samples = data['samples']
        else:
            samples = [{key: value for key, value in data.items() if key != 'device_id'}]
        if not isinstance(samples, list) or not 1 <= len(samples) <= 500:
            raise Invalid('Upload between 1 and 500 samples per request.')
        inserted, duplicates = 0, 0
        with self.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            node = self.node(conn, node_id)
            supplied = '' if trusted else request.headers.get('Authorization', '').removeprefix('Bearer ')
            if not trusted and not hmac.compare_digest(digest(supplied), node['token_hash']):
                raise Invalid('Device authorization failed.', 401)
            if not node['active']:
                raise Invalid('This monitoring device is inactive.', 403)
            for raw in samples:
                # Only authenticated cloud provenance may attach historical controls.
                # Keep the old measurement fingerprint stable for exact duplicate retries.
                snapshot = snapshot_object(raw.get('control_snapshot')) if trusted and isinstance(raw,dict) else None
                recorded_snapshot = json.dumps(snapshot,sort_keys=True,allow_nan=False) if snapshot is not None else None
                measured = {key:value for key,value in raw.items() if key != 'control_snapshot'} if trusted and isinstance(raw,dict) else raw
                item = self.normalize_sample(measured, node)
                fingerprint = digest(json.dumps(item, sort_keys=True, allow_nan=False))
                existing = conn.execute('SELECT * FROM monitor_samples WHERE node_id=? AND boot_id=? AND sequence=?',
                                        (node_id, item['boot_id'], item['sequence'])).fetchone()
                if existing:
                    same = hmac.compare_digest(existing['payload_hash'], fingerprint)
                    if not same and 'raw_pressure_pa' in existing.keys():
                        # Old fingerprints included the retired inputs. Compare every
                        # still-active raw observation before accepting an old retry.
                        columns = {'outlet_temperature_c':'raw_temperature_c'}
                        keys = SAMPLE_FIELDS - {'boot_id','sequence'}
                        same = all(item.get(key) == existing[columns.get(key,key)]
                                   for key in keys if key not in {'temperature_quality'} and columns.get(key,key) in existing.keys())
                        same &= item['temperature_quality'] == existing['temperature_quality'] or (
                            existing['temperature_quality'] == 'out_of_range' and item['temperature_quality'] == 'ok')
                    if not same:
                        raise Invalid('A sample identity was reused with different readings.', 409)
                    if recorded_snapshot is not None and snapshot_object(existing['control_snapshot']) != snapshot:
                        conn.execute('UPDATE monitor_samples SET control_snapshot=? WHERE id=?',
                                     (recorded_snapshot,existing['id']))
                    duplicates += 1
                    continue
                calibration = conn.execute('''SELECT * FROM monitor_calibrations WHERE node_id=? AND valid_from<=?
                    ORDER BY valid_from DESC,rowid DESC LIMIT 1''', (node_id, item['observed_at'] or now())).fetchone()
                raw_t = item['outlet_temperature_c']
                t = raw_t + calibration['temperature_offset_c'] if raw_t is not None and item['temperature_quality'] == 'ok' else None
                rpm = item['rotation_rpm'] if item['rotation_quality'] == 'ok' else None
                if t is not None and not -40 <= t <= 125:
                    t, item['temperature_quality'] = None, 'out_of_range'
                sample_id = str(uuid.uuid4())
                insert_record(conn, 'monitor_samples', dict(id=sample_id, node_id=node_id, aircon_id=node['aircon_id'],
                    aircon_name=node['aircon_name'], observed_at=item['observed_at'], received_at=now(), boot_id=item['boot_id'],
                    sequence=item['sequence'], uptime_ms=item['uptime_ms'], interval_seconds=item['interval_seconds'],
                    clock_quality=item['clock_quality'], raw_temperature_c=raw_t, outlet_temperature_c=t, rotation_rpm=rpm,
                    ac_on=None if item['ac_on'] is None else int(item['ac_on']), state_source=item['state_source'],
                    temperature_quality=item['temperature_quality'], rotation_quality=item['rotation_quality'],
                    calibration_id=calibration['id'], payload_hash=fingerprint, sensor_name=node['name'], location=node['location'],
                    aircon_type=node['aircon_type'], battery_voltage=item.get('battery_voltage'), rssi_dbm=item.get('rssi_dbm'),
                    connection_status=item.get('connection_status'), operating_mode=item.get('operating_mode'), control_snapshot=recorded_snapshot))
                self.queue(conn, 'monitor_samples', conn.execute('SELECT * FROM monitor_samples WHERE id=?', (sample_id,)).fetchone())
                inserted += 1
        return {'inserted': inserted, 'duplicates': duplicates}

    def bridge_cloud(self, records):
        """Mirror measured samples matched by exact authenticated registry identity.

        Cloud row IDs define deduplication identity. Only explicit observation
        timestamps enter a timeline; server receipt times never become readings.
        """
        count = 0
        for item in records:
            identity = item.get('node_id')
            if not identity or not item.get('id') or not item.get('observed_at'):
                continue
            cadence = item.get('interval_seconds')
            if isinstance(cadence,bool) or not isinstance(cadence,(float,int)) or not math.isfinite(cadence) or not 0.1 <= cadence <= 86400:
                continue
            with self.connection() as conn:
                node = conn.execute('SELECT * FROM monitor_nodes WHERE registry_node_id=? AND active=1', (identity,)).fetchone()
            if node is None:
                continue
            stamp = timestamp(item['observed_at'])
            boot = item.get('boot_id')
            sequence = item.get('sequence')
            actual_identity = isinstance(boot,str) and 0<len(boot)<=80 and isinstance(sequence,int) and not isinstance(sequence,bool) and 0<=sequence<=9007199254740991
            sample = dict(boot_id=boot if actual_identity else 'cloud-' + digest(str(item['id'])), sequence=sequence if actual_identity else 0,
                observed_at=stamp, clock_quality='synchronized', interval_seconds=item.get('interval_seconds'),
                outlet_temperature_c=item.get('temperature'), rotation_rpm=item.get('rotation_rpm'), ac_on=None)
            if 'control_snapshot' in item:
                sample['control_snapshot'] = item['control_snapshot']
            if item.get('rotation_quality') is not None:
                sample['rotation_quality'] = item['rotation_quality']
            for source, destination in [('battery','battery_voltage'), ('rssi','rssi_dbm')]:
                if item.get(source) is not None: sample[destination] = item[source]
            # Connectivity remains transport metadata, never power or compressor evidence.
            if item.get('status') in {'online','offline','unknown'}: sample['connection_status'] = item['status']
            count += self.ingest({'device_id':node['id'], 'samples':[sample]}, trusted=True)['inserted']
        return count

    def bridge_registered_history(self):
        # Older projections omitted controls; recover only the exact verified archived source.
        with self.connection() as conn:
            if not conn.execute("SELECT 1 FROM sqlite_master WHERE name='telemetry_monitor_sources'").fetchone():
                return 0
            records = [json.loads(row['payload']) for row in conn.execute("""SELECT t.payload FROM telemetry_monitor_sources t
                JOIN monitor_nodes n ON n.registry_node_id=t.node_id AND n.active=1
                ORDER BY t.source_id""")]
            if conn.execute("SELECT 1 FROM sqlite_master WHERE name='telemetry_cloud_receipts'").fetchone():
                for source in records:
                    if snapshot_object(source.get('control_snapshot')) is not None:
                        continue
                    archived = conn.execute('SELECT payload FROM telemetry_cloud_receipts WHERE id=?',(source['id'],)).fetchone()
                    original = snapshot_object(archived['payload']) if archived else None
                    keys = ['id','node_id','interval_seconds','temperature','rotation_rpm','boot_id','sequence']
                    if original and all(original.get(key) == source.get(key) for key in keys) and epoch(original.get('observed_at')) == epoch(source.get('observed_at')):
                        source['control_snapshot'] = original.get('control_snapshot')
        return self.bridge_cloud(records)

    def public_node(self, conn, node):
        result = {key: value for key, value in active_fields(node).items() if key not in {'token_hash', 'registry_node_id', 'registry_retired'}}
        schedule = conn.execute('SELECT * FROM sensor_schedules WHERE node_id=?', (node['id'],)).fetchone()
        result['sensor_schedule'] = dict(schedule) if schedule else None
        result['cloud_node_id'] = node['registry_node_id']
        result['active'] = bool(result['active'])
        result['calibration'] = active_fields(conn.execute('SELECT * FROM monitor_calibrations WHERE node_id=? ORDER BY valid_from DESC,rowid DESC LIMIT 1',
                                                (node['id'],)).fetchone())
        latest = conn.execute('''SELECT * FROM monitor_samples WHERE node_id=? AND aircon_id=?
            ORDER BY observed_at DESC,received_at DESC,rowid DESC LIMIT 1''', (node['id'], node['aircon_id'])).fetchone()
        result['latest'] = self.public_sample(latest) if latest else None
        received = conn.execute('SELECT MAX(received_at) FROM monitor_samples WHERE node_id=?', (node['id'],)).fetchone()[0]
        result['last_received_at'] = received
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(latest['observed_at'].replace('Z', '+00:00'))).total_seconds() if latest and latest['observed_at'] else None
        result['fresh'] = bool(node['active'] and age is not None and -5 <= age <= max(15, 3 * node['expected_interval_seconds']))
        result['status'] = 'Inactive' if not node['active'] else 'Awaiting readings' if not latest else 'Time unavailable' if age is None else 'Reporting' if result['fresh'] else 'Stale'
        rpm = latest['rotation_rpm'] if latest and result['fresh'] else None
        result['rotation_status'] = 'Unknown' if rpm is None else 'Rotating' if rpm > 0 else 'Stationary'
        return result

    @staticmethod
    def public_sample(row):
        item = {key: value for key, value in active_fields(row).items() if key != 'payload_hash'}
        item['ac_on'] = None if item['ac_on'] is None else bool(item['ac_on'])
        item['control_snapshot'] = snapshot_object(item.get('control_snapshot'))
        item['target_temperature_c'] = target_temperature(item['control_snapshot'],item.get('observed_at'))
        return item

    def filters(self, include_time=True):
        clauses, params = ['1=1'], []
        for key in ['aircon_id', 'node_id']:
            if request.args.get(key):
                clauses.append(f'{key}=?')
                params.append(request.args[key])
        snapshot = request.args.get('snapshot')
        if snapshot is not None:
            if not re.fullmatch(r'[0-9]{1,19}', snapshot) or int(snapshot) > 9223372036854775807:
                raise Invalid('Invalid monitoring history snapshot.')
            clauses.append('id IN (SELECT id FROM monitor_samples WHERE rowid<=?)')
            params.append(int(snapshot))
        start_time, end_time = request.args.get('start_time'), request.args.get('end_time')
        for value in [start_time, end_time]:
            if value is not None and not re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d', value):
                raise Invalid('Time filters must use HH:MM in UTC+08:00.')
        if include_time and (start_time or end_time):
            clock = "strftime('%H:%M',observed_at,'+8 hours')"
            if start_time and end_time and start_time > end_time:
                clauses.append(f'({clock}>=? OR {clock}<=?)')
                params += [start_time, end_time]
            else:
                if start_time:
                    clauses.append(clock + '>=?')
                    params.append(start_time)
                if end_time:
                    clauses.append(clock + '<=?')
                    params.append(end_time)
        start = timestamp(request.args.get('from') or (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(), 'from')
        end = timestamp(request.args.get('to') or now(), 'to')
        if start >= end:
            raise Invalid('The end of the observation window must follow its start.')
        clauses += ['observed_at>=?', 'observed_at<?']
        return ' AND '.join(clauses), params + [start, end], start, end

    def analytics(self):
        where, params, start, end = self.filters()
        as_of = now()
        where += ' AND observed_at<=?'
        params.append(as_of)
        seconds = (datetime.fromisoformat(end.replace('Z', '+00:00')) - datetime.fromisoformat(start.replace('Z', '+00:00'))).total_seconds()
        bucket_seconds = max(1, math.ceil(seconds / 300))
        with self.connection() as conn:
            conn.create_function('recorded_target_temperature',2,target_temperature,deterministic=True)
            stats = dict(conn.execute(f'''SELECT COUNT(*) sample_count,COUNT(outlet_temperature_c) temperature_count,
                MIN(outlet_temperature_c) temperature_min,AVG(outlet_temperature_c) temperature_avg,MAX(outlet_temperature_c) temperature_max,
                COUNT(recorded_target_temperature(control_snapshot,observed_at)) target_temperature_count,
                MIN(recorded_target_temperature(control_snapshot,observed_at)) target_temperature_min,
                AVG(recorded_target_temperature(control_snapshot,observed_at)) target_temperature_avg,
                MAX(recorded_target_temperature(control_snapshot,observed_at)) target_temperature_max,
                COUNT(ac_on) confirmed_state_count,COUNT(rotation_rpm) rotation_count,MIN(rotation_rpm) rotation_min,
                AVG(rotation_rpm) rotation_avg,MAX(rotation_rpm) rotation_max,
                SUM(CASE WHEN ac_on IS NULL THEN 1 ELSE 0 END) unknown_state_samples FROM monitor_samples WHERE {where}''', params).fetchone())
            buckets = conn.execute(f'''SELECT CAST(strftime('%s',observed_at) AS INTEGER)/? AS bucket,
                AVG(outlet_temperature_c) temperature,AVG(recorded_target_temperature(control_snapshot,observed_at)) target_temperature_c,
                AVG(rotation_rpm) rotation_rpm,COUNT(*) sample_count,
                CASE WHEN COUNT(ac_on)=COUNT(*) AND MIN(ac_on)=MAX(ac_on) THEN MAX(ac_on) ELSE NULL END ac_on,
                CASE WHEN COUNT(operating_mode)=COUNT(*) AND MIN(operating_mode)=MAX(operating_mode)
                    THEN MAX(operating_mode) ELSE NULL END operating_mode
                FROM monitor_samples WHERE {where} GROUP BY bucket ORDER BY bucket''', [bucket_seconds] + params).fetchall()
            # Keep per-device measurements separate for percent-of-reference presentation.
            # Existing raw summaries stay unchanged; no reference or percentage is persisted.
            rotation_where = where + " AND rotation_rpm>=0 AND rotation_quality NOT IN ('fault','missing','out_of_range','invalid')"
            stats['rotation_by_node'] = [dict(row) for row in conn.execute(f'''SELECT node_id,
                COUNT(rotation_rpm) rotation_count,AVG(rotation_rpm) rotation_avg
                FROM monitor_samples WHERE {rotation_where} GROUP BY node_id''', params)]
            rotation_buckets = {}
            for row in conn.execute(f'''SELECT CAST(strftime('%s',observed_at) AS INTEGER)/? AS bucket,
                node_id,COUNT(rotation_rpm) rotation_count,AVG(rotation_rpm) rotation_avg
                FROM monitor_samples WHERE {rotation_where} GROUP BY bucket,node_id''', [bucket_seconds] + params):
                item = dict(row)
                rotation_buckets.setdefault(int(item.pop('bucket')), []).append(item)
            points = {int(row['bucket']): dict(row) for row in buckets}
            first_bucket = int(datetime.fromisoformat(start.replace('Z', '+00:00')).timestamp()) // bucket_seconds
            last_bucket = int((datetime.fromisoformat(end.replace('Z', '+00:00')).timestamp() - 0.001)) // bucket_seconds
            series = [{'observed_at': datetime.fromtimestamp(index * bucket_seconds, timezone.utc).isoformat().replace('+00:00', 'Z'),
                       'rotation_by_node': rotation_buckets.get(index, []),
                       **{key: points.get(index, {}).get(key) for key in ['temperature', 'target_temperature_c', 'rotation_rpm', 'sample_count', 'ac_on', 'operating_mode']}}
                      for index in range(first_bucket, last_bucket + 1)]
            # Stream records rather than retaining a second full history in memory. Bound each
            # reading by its recorded cadence and the next reading, including unknown states.
            runtime_where, prior_params, _, _ = self.filters(include_time=False)
            prior_params[-2] = (datetime.fromisoformat(start.replace('Z', '+00:00')) - timedelta(days=1)).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
            runtime_where += ' AND observed_at<=?'
            prior_params.append(as_of)
            rows = conn.execute(f'''WITH readings AS (
                SELECT s.*,CASE WHEN s.rotation_rpm IS NOT NULL THEN s.rotation_rpm>0 ELSE NULL END rotation
                FROM monitor_samples s
                ) SELECT aircon_id,observed_at,MIN(interval_seconds) interval_seconds,
                CASE WHEN COUNT(ac_on)=COUNT(*) AND MIN(ac_on)=MAX(ac_on) THEN MAX(ac_on) ELSE NULL END ac_on,
                CASE WHEN COUNT(rotation)=COUNT(*) AND MIN(rotation)=MAX(rotation) THEN MAX(rotation) ELSE NULL END rotation,
                MIN(state_source) state_source FROM readings WHERE {runtime_where}
                GROUP BY aircon_id,observed_at ORDER BY aircon_id,observed_at''', prior_params)
            previous, confirmed, covered, detected, flow_covered = None, 0.0, 0.0, 0.0, 0.0
            lower = datetime.fromisoformat(start.replace('Z', '+00:00')).timestamp()
            upper = min(datetime.fromisoformat(end.replace('Z', '+00:00')).timestamp(),
                        datetime.fromisoformat(as_of.replace('Z', '+00:00')).timestamp())

            def filtered_span(begin, finish):
                begin, finish = max(begin, lower), min(finish, upper)
                if finish <= begin:
                    return 0
                clocks = [request.args.get('start_time'), request.args.get('end_time')]
                if not any(clocks):
                    return finish - begin
                def clock_seconds(value, default):
                    return int(value[:2]) * 3600 + int(value[3:]) * 60 if value else default
                first = clock_seconds(clocks[0], 0)
                last = min(86400, clock_seconds(clocks[1], 86340) + 60)
                windows = [(first, last)] if first < last else [(first, 86400), (0, last)]
                # A recorded interval is at most one day; include both local days it can cross.
                return sum(max(0, min(finish, day * 86400 - 28800 + stop) - max(begin, day * 86400 - 28800 + start))
                           for day in range(int((begin + 28800) // 86400), int((finish + 28800) // 86400) + 1)
                           for start, stop in windows)

            def accumulate(row, next_stamp=None):
                if not row:
                    return 0.0, 0.0, 0.0, 0.0
                begin = datetime.fromisoformat(row['observed_at'].replace('Z', '+00:00')).timestamp()
                finish = min(begin + row['interval_seconds'], next_stamp if next_stamp is not None else upper, upper)
                span = filtered_span(begin, finish)
                return ((span if row['ac_on'] == 1 and row['state_source'] in STATE_SOURCES - {'none'} else 0), span,
                        span if row['rotation'] == 1 else 0, span if row['rotation'] is not None else 0)

            for row in rows:
                next_stamp = datetime.fromisoformat(row['observed_at'].replace('Z', '+00:00')).timestamp() if previous and row['aircon_id'] == previous['aircon_id'] else None
                power, coverage, flow, flow_span = accumulate(previous, next_stamp)
                confirmed += power
                covered += coverage
                detected += flow
                flow_covered += flow_span
                previous = row
            power, coverage, flow, flow_span = accumulate(previous)
            stats.update(confirmed_unit_hours=(confirmed + power) / 3600, observed_unit_hours=(covered + coverage) / 3600,
                         rotation_detected_unit_hours=(detected + flow) / 3600 if flow_covered + flow_span > 0 else None,
                         from_timestamp=start, to_timestamp=end, bucket_seconds=bucket_seconds, points=series)
        return stats

    def sync_status(self):
        with self.connection() as conn:
            row = dict(conn.execute('SELECT * FROM monitor_sync_status WHERE id=1').fetchone())
            count = conn.execute('SELECT COUNT(*) FROM monitor_sync_outbox').fetchone()[0]
        enabled = os.getenv('ECOTRACK_MONITOR_SYNC', '0') == '1'
        configured = bool(os.getenv('SUPABASE_URL') and os.getenv('SUPABASE_SERVICE_ROLE_KEY'))
        return {'enabled': enabled, 'configured': configured, 'pending': count, 'last_success': row['last_success'], 'error': row['error']}

    def sync_once(self):
        if not self.sync_status()['enabled'] or not self.sync_status()['configured']:
            return 0
        url, key = os.environ['SUPABASE_URL'].rstrip('/'), os.environ['SUPABASE_SERVICE_ROLE_KEY']
        if urlparse(url).scheme != 'https':
            raise Invalid('Cloud synchronization requires HTTPS.')
        with self.connection() as conn:
            pending = conn.execute('SELECT * FROM monitor_sync_outbox ORDER BY id LIMIT 100').fetchall()
        sent = 0
        for item in pending:
            response = requests.post(url + '/rest/v1/' + item['table_name'], params={'on_conflict': 'id'},
                headers={'apikey': key, 'Authorization': 'Bearer ' + key, 'Prefer': 'resolution=merge-duplicates'},
                json=active_fields(json.loads(item['payload'])), timeout=5)
            if not response.ok:
                raise Invalid(f'Cloud backup returned HTTP {response.status_code}; review the monitoring migration and permissions.')
            with self.connection() as conn:
                conn.execute('DELETE FROM monitor_sync_outbox WHERE id=?', (item['id'],))
                conn.execute('UPDATE monitor_sync_status SET last_success=?,error=NULL WHERE id=1', (now(),))
            sent += 1
        return sent

    def start_sync(self):
        if self.thread or os.getenv('ECOTRACK_MONITOR_SYNC', '0') != '1':
            return

        def run():
            while not self.stop.is_set():
                try:
                    self.sync_once()
                except Exception:
                    # Do not persist request objects, headers or credential-bearing exception strings.
                    with self.connection() as conn:
                        conn.execute('UPDATE monitor_sync_status SET error=? WHERE id=1', ('Cloud backup unavailable; local records are retained.',))
                self.stop.wait(15)
        self.thread = threading.Thread(target=run, name='ecotrack-monitor-backup', daemon=True)
        self.thread.start()


def register_monitoring(app, connect, key_path):
    service = Monitoring(connect, key_path)
    from backend.control_energy import ControlHistoryEstimator
    service.energy = ControlHistoryEstimator(Path(__file__).parent / 'ml' / 'control_extra_trees')
    service.bridge_registered_history()
    app.config['MONITORING_SERVICE'] = service
    bp = Blueprint('monitoring', __name__, url_prefix='/api/monitoring')

    @bp.before_request
    def boundary():
        origin = request.headers.get('Origin')
        if origin and origin != 'null' and urlparse(origin).hostname not in {'127.0.0.1', 'localhost', '::1'}:
            raise Invalid('This origin cannot access local monitoring.', 403)
        if request.method in {'GET', 'HEAD'} and not ip_address(request.remote_addr or '0.0.0.0').is_loopback:
            raise Invalid('Read monitoring through the local desktop.', 403)
        if request.method in {'GET', 'HEAD'}:
            if urlparse('//' + request.host).hostname not in {'127.0.0.1', 'localhost', '::1'}:
                raise Invalid('Read monitoring through the local desktop.', 403)
            if origin == 'null':
                service.admin()
        if request.content_length and request.content_length > 524288:
            raise Invalid('Monitoring request is too large.', 413)

    @bp.errorhandler(Invalid)
    def invalid(error):
        return jsonify(error=str(error)), error.status

    @bp.errorhandler(sqlite3.IntegrityError)
    def conflict(_error):
        return jsonify(error='This AC already has an active monitor, or the record conflicts with existing data.'), 409

    @bp.route('/devices', methods=['GET', 'POST'])
    def devices():
        if request.method == 'POST':
            service.admin()
            return jsonify(service.save_node(request.get_json(silent=True))), 201
        with service.connection() as conn:
            conn.execute('BEGIN')
            return jsonify(items=[service.public_node(conn, row) for row in conn.execute('SELECT * FROM monitor_nodes ORDER BY name')], sync=service.sync_status(), **service.revision(conn))

    @bp.route('/changes', methods=['GET'])
    def changes():
        try:
            since = int(request.args.get('since', '-1'))
            if since < 0:
                raise ValueError()
        except ValueError:
            raise Invalid('Provide a nonnegative change version.')
        with service.connection() as conn:
            conn.execute('BEGIN')
            revision = service.revision(conn)
            reset = request.args.get('generation') != revision['generation'] or since > revision['version']
            ids = [row[0] for row in conn.execute('SELECT node_id FROM monitor_changed_nodes WHERE version>?', (since,))]
            if reset or len(ids) > 200:
                reset = True
                records = conn.execute('SELECT * FROM monitor_nodes ORDER BY name').fetchall()
            elif ids:
                records = conn.execute('SELECT * FROM monitor_nodes WHERE id IN (' + ','.join('?' for _ in ids) + ') ORDER BY name', ids).fetchall()
            else:
                records = []
            items = [service.public_node(conn, row) for row in records]
            return jsonify(items=items, removed=[] if reset else sorted(set(ids) - {item['id'] for item in items}), reset=reset, **revision)

    @bp.route('/history-health', methods=['GET'])
    def history_health_status():
        health = app.config.get('HISTORY_HEALTH')
        if health is None:
            return jsonify(error='History health is not available.'), 503
        return jsonify(health.status())

    @bp.route('/devices/<node_id>', methods=['PATCH'])
    def edit(node_id):
        service.admin()
        return jsonify(service.save_node(request.get_json(silent=True), node_id))

    @bp.route('/registry/import', methods=['POST'])
    def import_registered_device():
        service.admin()
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict) or set(payload) != {'id', 'device'} or not isinstance(payload.get('device'), dict):
            raise Invalid('Provide a verified registered sensor identity.')
        payload['device'] = active_fields(payload['device'])
        if set(payload['device']) - {'name', 'aircon_id', 'aircon_name', 'aircon_type', 'location', 'expected_interval_seconds'}:
            raise Invalid('Unsupported registered sensor metadata.')
        try:
            node_id = str(uuid.UUID(payload['id']))
        except (ValueError, TypeError, AttributeError):
            raise Invalid('Invalid registered sensor identity.')
        with service.connection() as conn:
            previous = conn.execute('SELECT * FROM monitor_nodes WHERE id=?', (node_id,)).fetchone()
            if previous and previous['aircon_id'] != payload['device'].get('aircon_id'):
                raise Invalid('A registered sensor cannot be reassigned through registry import.', 409)
            if previous and all(previous[key] == value for key, value in payload['device'].items()):
                return jsonify(changed=False)
        service.save_node(payload['device'], node_id if previous else None, imported_id=None if previous else node_id)
        return jsonify(changed=True)

    @bp.route('/registry/reconcile', methods=['POST'])
    def reconcile_registered_devices():
        service.admin()
        result = service.reconcile_registry(request.get_json(silent=True))
        if result['changed']:
            service.bridge_registered_history()
        return jsonify(result)

    @bp.route('/devices/<node_id>/calibrations', methods=['GET', 'POST'])
    def calibrations(node_id):
        with service.connection() as conn:
            service.node(conn, node_id)
            if request.method == 'POST':
                service.admin()
                return jsonify(service.calibrate(conn, node_id, request.get_json(silent=True))), 201
            return jsonify(items=[active_fields(row) for row in conn.execute('SELECT * FROM monitor_calibrations WHERE node_id=? ORDER BY valid_from DESC', (node_id,))])

    @bp.route('/devices/<node_id>/schedule', methods=['PUT'])
    def sensor_schedule(node_id):
        service.admin()
        data = request.get_json(silent=True)
        if not isinstance(data, dict) or set(data) != {'wake_time', 'sleep_time', 'interval_seconds'}:
            raise Invalid('Provide wake time, sleep time and reporting interval.')
        for field in ['wake_time', 'sleep_time']:
            if not isinstance(data[field], str) or not re.fullmatch(r'(?:[01][0-9]|2[0-3]):[0-5][0-9]', data[field]):
                raise Invalid('Schedule times must use HH:MM.')
        interval = number(data['interval_seconds'], 'interval_seconds', 1, 86400)
        if interval != int(interval):
            raise Invalid('Reporting interval must be a whole number of seconds.')
        with service.connection() as conn:
            service.node(conn, node_id)
            conn.execute('''INSERT INTO sensor_schedules VALUES(?,?,?,?,?) ON CONFLICT(node_id) DO UPDATE SET
                wake_time=excluded.wake_time,sleep_time=excluded.sleep_time,
                interval_seconds=excluded.interval_seconds,updated_at=excluded.updated_at''',
                (node_id, data['wake_time'], data['sleep_time'], int(interval), now()))
        return jsonify(success=True, delivery_status='saved_locally', hardware_confirmed=False)

    @bp.route('/devices/<node_id>/rotate-token', methods=['POST'])
    def rotate(node_id):
        service.admin()
        token = 'etm_' + secrets.token_urlsafe(32)
        with service.connection() as conn:
            service.node(conn, node_id)
            conn.execute('UPDATE monitor_nodes SET token_hash=?,updated_at=? WHERE id=?', (digest(token), now(), node_id))
        return jsonify(device_id=node_id, device_token=token)

    @bp.route('/telemetry', methods=['POST', 'GET'])
    def telemetry():
        if request.method == 'POST':
            return jsonify(service.ingest(request.get_json(silent=True))), 200
        where, params, _, _ = service.filters()
        try:
            page, per_page = int(request.args.get('page', 1)), int(request.args.get('per_page', 50))
            if page < 1 or not 1 <= per_page <= 200:
                raise ValueError()
        except ValueError:
            raise Invalid('Invalid history pagination.') from None
        with service.connection() as conn:
            conn.execute('BEGIN')
            snapshot = request.args.get('snapshot')
            if snapshot is None:
                snapshot = str(conn.execute('SELECT COALESCE(MAX(rowid),0) FROM monitor_samples').fetchone()[0])
                where += ' AND rowid<=?'
                params.append(int(snapshot))
            count = conn.execute(f'SELECT COUNT(*) FROM monitor_samples WHERE {where}', params).fetchone()[0]
            items = conn.execute(f'SELECT * FROM monitor_samples WHERE {where} ORDER BY observed_at DESC,id DESC LIMIT ? OFFSET ?', params + [per_page, (page - 1) * per_page]).fetchall()
            return jsonify(items=[service.public_sample(row) for row in items], total=count, page=page, per_page=per_page, snapshot=snapshot)

    @bp.route('/analytics')
    def analytics():
        return jsonify(service.analytics())

    @bp.route('/energy-model')
    def energy_model():
        estimator = service.energy
        return jsonify(estimator.status())

    @bp.route('/energy')
    def sensor_energy():
        where, params, start, end = service.filters(include_time=False)
        estimator = service.energy
        # Read recorded context before the selection; integrate only within its filters.
        params[-2] = (datetime.fromisoformat(start.replace('Z', '+00:00')) - timedelta(seconds=420)).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        try:
            estimator.load()
        except Exception:
            return jsonify(model=service.energy.predictor.MODEL_ID, workspace='monitoring', available=False,
                           energy_kwh=None, average_power_kw=None, points=[],
                           code='ENERGY_MODEL_UNAVAILABLE', reason='The trained local energy artifact could not be verified or loaded.'), 503
        with service.connection() as conn:
            rows = conn.execute(f'SELECT * FROM monitor_samples WHERE {where} AND observed_at<=? ORDER BY aircon_id,node_id,observed_at LIMIT 500001', params + [now()]).fetchall()
        if len(rows) > 500000:
            return jsonify(model=service.energy.predictor.MODEL_ID,workspace='monitoring',available=False,energy_kwh=None,average_power_kw=None,points=[],
                           code='SENSOR_WINDOW_TOO_LARGE',reason='Choose a narrower date range; more than 500,000 sensor observations require estimation.')
        return jsonify(estimator.estimate(rows,start,end,(request.args.get('start_time'),request.args.get('end_time'))))

    @bp.route('/export.csv')
    def export():
        where, params, _, _ = service.filters()
        columns = ['aircon_id', 'aircon_name', 'node_id', 'observed_at', 'received_at', 'outlet_temperature_c',
                   'rotation_rpm', 'ac_on', 'state_source', 'temperature_quality', 'rotation_quality', 'interval_seconds', 'calibration_id']

        def stream():
            output = io.StringIO()
            writer = csv.writer(output)
            writer.writerow(columns)
            yield output.getvalue()
            with service.connection() as conn:
                for row in conn.execute(f'SELECT * FROM monitor_samples WHERE {where} ORDER BY observed_at,id', params):
                    output.seek(0)
                    output.truncate()
                    values = [row[key] if row[key] is not None else '' for key in columns]
                    # Spreadsheet exports must not interpret asset names as formulas.
                    values = ["'" + value if isinstance(value, str) and value.startswith(('=', '+', '-', '@')) else value for value in values]
                    writer.writerow(values)
                    yield output.getvalue()
        return Response(stream_with_context(stream()), mimetype='text/csv', headers={'Content-Disposition': 'attachment; filename=ac-monitoring.csv'})

    app.register_blueprint(bp)
    return service
