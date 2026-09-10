"""
EcoTrack Sensor Logs Transfer: Supabase -> Native SQLite3 (backend/telemetry.db)
Fetches all telemetry records from Supabase and transfers them into the local SQLite3 database.
"""
import os
import sys
import uuid
import sqlite3
from datetime import datetime

# Configure UTF-8 encoding for Windows terminals
if sys.platform == 'win32' and hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

try:
    # pyrefly: ignore [missing-import]
    from supabase import create_client, Client
except ImportError:
    # Graceful fallback if supabase-py is not installed in the active environment
    create_client = None
    Client = None

try:
    import requests
except ImportError:
    requests = None

def safe_float(val, default=0.0):
    """Safely parse float value avoiding NoneType crashes."""
    if val is None:
        return default
    try:
        return float(val)
    except (ValueError, TypeError):
        return default

def load_env():
    env = {}
    env_path = os.path.join(os.path.dirname(__file__), '..', '.env')
    if os.path.exists(env_path):
        with open(env_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, v = line.split('=', 1)
                    env[k.strip()] = v.strip()
    return env

env = load_env()
SUPABASE_URL = os.environ.get('SUPABASE_URL') or env.get('SUPABASE_URL', '')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY') or os.environ.get('SUPABASE_KEY') or env.get('SUPABASE_SERVICE_ROLE_KEY') or env.get('SUPABASE_KEY', '')

SQLITE_DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'backend', 'telemetry.db')

def get_db():
    conn = sqlite3.connect(SQLITE_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db(conn):
    with conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS telemetry (
                id TEXT PRIMARY KEY,
                node_id TEXT,
                sensor_name TEXT,
                room_name TEXT,
                floor_name TEXT,
                building_name TEXT,
                aircon_type TEXT,
                temperature REAL,
                pressure REAL,
                battery REAL,
                rssi REAL,
                status TEXT,
                created TEXT,
                updated TEXT
            );
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_telem_created ON telemetry (created DESC);")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_telem_sensor ON telemetry (sensor_name);")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_telem_node ON telemetry (node_id);")

def fetch_supabase_telemetry():
    """
    Fetch all telemetry records from Supabase.
    First tries the official Supabase Python client (create_client),
    then falls back to direct REST API via requests or urllib.
    """
    # 1. Try official Supabase client if available
    if create_client and SUPABASE_URL and SUPABASE_KEY:
        try:
            supabase_client: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
            res = supabase_client.table('telemetry').select('*').order('created', desc=False).execute()
            if hasattr(res, 'data') and res.data is not None:
                return res.data
        except Exception as e:
            print(f"âš ï¸ Supabase SDK query failed ({e}). Falling back to REST API...")

    url = f"{SUPABASE_URL}/rest/v1/telemetry?select=*&order=created.asc"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}"
    }

    # 2. Try requests library
    if requests:
        try:
            res = requests.get(url, headers=headers, timeout=30)
            if res.status_code == 200:
                return res.json()
            else:
                print(f"âš ï¸ Supabase REST query status {res.status_code}: {res.text}")
                return []
        except Exception as e:
            print(f"âš ï¸ requests fetch failed: {e}")

    # 3. Native standard library fallback (urllib)
    try:
        import urllib.request
        import json
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=30) as resp:
            if resp.status == 200:
                return json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        print(f"âš ï¸ Native urllib fetch failed: {e}")

    return []

def transfer():
    print("====================================================")
    print("ðŸš€ Transferring Sensor Logs: Supabase -> Native SQLite3")
    print(f"   Source Supabase : {SUPABASE_URL}")
    print(f"   Target SQLite3  : {SQLITE_DB_PATH}")
    print("====================================================\n")

    conn = get_db()
    init_db(conn)

    print("ðŸ“¡ Fetching sensor logs from Supabase...")
    records = fetch_supabase_telemetry()
    print(f"ðŸ“¦ Found {len(records)} records in Supabase.\n")

    if not records:
        print("â„¹ï¸ No records to transfer.")
        conn.close()
        return

    transferred = 0
    skipped = 0

    with conn:
        for r in records:
            rec_id = r.get('id') or f"telem_{uuid.uuid4().hex[:12]}"
            node_id = r.get('node_id') or r.get('sensor_name') or 'node-1'
            sensor_name = r.get('sensor_name') or node_id
            room_name = r.get('room_name') or 'Unassigned'
            floor_name = r.get('floor_name') or 'Unassigned'
            building_name = r.get('building_name') or 'Main Campus Building'
            aircon_type = r.get('aircon_type') or 'Split Type (Inverter)'
            temp = safe_float(r.get('temperature', r.get('temp', 24.0)), 24.0)
            press = safe_float(r.get('pressure', 0.45), 0.45)
            batt = safe_float(r.get('battery', 4.0), 4.0)
            rssi = safe_float(r.get('rssi', -60.0), -60.0)
            status = r.get('status', 'online')
            created = r.get('created') or datetime.now().isoformat()
            updated = r.get('updated') or created

            # Deduplicate by ID or (sensor_name + timestamp)
            existing = conn.execute(
                "SELECT id FROM telemetry WHERE id = ? OR (sensor_name = ? AND created = ?)",
                (rec_id, sensor_name, created)
            ).fetchone()

            if existing:
                skipped += 1
                continue

            conn.execute("""
                INSERT INTO telemetry (
                    id, node_id, sensor_name, room_name, floor_name, building_name,
                    aircon_type, temperature, pressure, battery, rssi, status, created, updated
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                rec_id, node_id, sensor_name, room_name, floor_name, building_name,
                aircon_type, temp, press, batt, rssi, status, created, updated
            ))
            transferred += 1

    total_in_db = conn.execute("SELECT COUNT(*) FROM telemetry").fetchone()[0]
    conn.close()

    print("====================================================")
    print(f"âœ… Transfer Complete!")
    print(f"   Transferred : {transferred} records")
    print(f"   Skipped     : {skipped} duplicate records")
    print(f"   Total in DB : {total_in_db} records in SQLite3")
    print("====================================================\n")

if __name__ == '__main__':
    transfer()

