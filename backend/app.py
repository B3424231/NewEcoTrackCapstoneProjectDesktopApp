"""
EcoTrack Python Backend - Machine Learning Microservice
Dedicated strictly to HVAC energy consumption machine learning predictions.
Models supported: Random Forest, Decision Tree, XGBoost Regression.
"""
from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_restful import Api, Resource
from datetime import datetime
import os
import sys
import uuid
import sqlite3
import warnings
import joblib
import pandas as pd
import numpy as np

warnings.filterwarnings('ignore')

app = Flask(__name__)
CORS(app)
api = Api(app)

# ===== NATIVE SQLITE3 SENSOR LOGS DATABASE =====
SQLITE_DB_PATH = os.path.join(os.path.dirname(__file__), 'telemetry.db')

def get_db_connection():
    """Create a thread-safe connection to the SQLite3 database."""
    conn = sqlite3.connect(SQLITE_DB_PATH, timeout=20.0)
    conn.row_factory = sqlite3.Row
    return conn

def init_sqlite_db():
    """Initialize the SQLite3 database schema for high-frequency sensor logs."""
    conn = get_db_connection()
    try:
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
        print(f"[*] SQLite3 Sensor Logs Database initialized at: {SQLITE_DB_PATH}")
    finally:
        conn.close()

# Initialize SQLite3 database on startup
init_sqlite_db()

# ===== MACHINE LEARNING MODEL CACHE =====
_model_cache = {}

MODEL_FILES = {
    'random_forest': 'hvac_consumption_model_randomforestregressionFinal.pkl',
    'decision_tree': 'hvac_decision_tree_model_decision_tree_regression Final.pkl',
    'xgboost': 'hvac_xgboost_final_XGBoost_RegressionFinal.pkl'
}

def _load_model(model_type: str):
    """Load a model from disk, using an in-memory cache to avoid repeated I/O."""
    if model_type in _model_cache:
        return _model_cache[model_type]
    filename = MODEL_FILES.get(model_type)
    if not filename:
        return None
    filepath = os.path.join(os.path.dirname(__file__), 'ml', filename)
    if not os.path.exists(filepath):
        return None
    model = joblib.load(filepath)
    _model_cache[model_type] = model
    return model


# ===== REST API ENDPOINTS (MACHINE LEARNING ONLY) =====

class HealthResource(Resource):
    """Health check for ML Backend"""
    def get(self):
        return {
            'status': 'healthy',
            'service': 'EcoTrack Machine Learning Backend',
            'timestamp': datetime.now().isoformat(),
            'version': '2.0.0',
            'models_available': list(MODEL_FILES.keys())
        }, 200


class PredictionFeaturesResource(Resource):
    """Introspect a model to see what features it expects."""
    def get(self):
        model_type = request.args.get('model', 'random_forest')
        model = _load_model(model_type)
        if model is None:
            return {"error": f"Model '{model_type}' not found"}, 404
        features = list(model.feature_names_in_) if hasattr(model, 'feature_names_in_') else []
        n_features = model.n_features_in_ if hasattr(model, 'n_features_in_') else len(features)
        return {"model": model_type, "features": features, "n_features": n_features}, 200


class PredictionMetricsResource(Resource):
    """Return benchmark training/evaluation metrics for a chosen model."""
    def get(self):
        model_type = request.args.get('model', 'random_forest')
        
        metrics_db = {
            'random_forest': {'r2': 0.7804, 'mse': 64.4390, 'rmse': 8.0274, 'mae': 6.1165, 'evs': 0.7805},
            'decision_tree': {'r2': 0.7327, 'mse': 78.4289, 'rmse': 8.8560, 'mae': 6.6305, 'evs': 0.7328},
            'xgboost':       {'r2': 0.8082, 'mse': 56.2669, 'rmse': 7.5011, 'mae': 5.7755, 'evs': 0.8083},
        }
        
        if model_type not in metrics_db:
            return {"error": "Model metrics not found"}, 404
            
        return {"model": model_type, "metrics": metrics_db[model_type]}, 200


class EnergyPredictionResource(Resource):
    """
    Predict energy consumption using the pre-trained ML models.

    POST body JSON:
        model       : 'random_forest' | 'decision_tree' | 'xgboost'
        avg_temp    : float   - average temperature (°C)
        avg_pressure: float   - average airflow pressure (kPa)
        period      : 'daily' | 'weekly' | 'monthly'
        ac_on_ratio : float   - fraction of time AC is ON (0.0 to 1.0)
        hours_used  : float   - optional custom runtime hours
    """
    def post(self):
        data = request.get_json() or {}
        model_type   = data.get('model', 'random_forest')
        avg_temp     = data.get('avg_temp')
        avg_pressure = data.get('avg_pressure')
        period       = data.get('period', 'daily')
        ac_on_ratio  = data.get('ac_on_ratio', 0.5)
        hours_used   = data.get('hours_used')

        if avg_temp is None or avg_pressure is None:
            return {"error": "avg_temp and avg_pressure are required"}, 400

        avg_temp     = float(avg_temp)
        avg_pressure = float(avg_pressure)
        ac_on_ratio  = float(ac_on_ratio)

        model = _load_model(model_type)
        if model is None:
            return {"error": f"Model '{model_type}' not found"}, 404

        try:
            if hasattr(model, 'feature_names_in_'):
                features = list(model.feature_names_in_)
            else:
                n = model.n_features_in_ if hasattr(model, 'n_features_in_') else 3
                features = [f'f{i}' for i in range(n)]

            row_values = []
            now = datetime.now()

            for feat in features:
                fl = feat.lower().strip()
                val = 0.0

                if fl == 'day':
                    val = float(now.day)
                elif fl == 'week':
                    val = float(now.isocalendar()[1])
                elif fl == 'month':
                    val = float(now.month)
                elif fl == 'hour':
                    val = float(now.hour)
                elif fl == 'day_of_week':
                    val = float(now.weekday())
                elif fl == 'pressure_diff':
                    val = 2.0 if ac_on_ratio > 0.8 else 0.5
                elif fl == 'damper':
                    val = 100.0 if ac_on_ratio > 0.5 else 0.0
                elif 'temp' in fl:
                    val = avg_temp
                elif 'press' in fl:
                    val = avg_pressure
                elif fl == 'status_mode':
                    val = 2.0 if ac_on_ratio > 0.8 else (1.0 if ac_on_ratio > 0.2 else 0.0)
                elif fl.startswith('status_'):
                    try:
                        status_val = float(fl.replace('status_', ''))
                    except ValueError:
                        row_values.append(0.0)
                        continue
                    if status_val == 0.0:
                        val = 1.0 - ac_on_ratio
                    else:
                        val = ac_on_ratio
                elif 'energy_' in fl:
                    val = 0.001 + (ac_on_ratio * 0.015)

                row_values.append(val)

            df = pd.DataFrame([row_values], columns=features)
            ml_prediction = float(model.predict(df)[0])

            if hours_used is not None:
                period_hours = float(hours_used)
            else:
                period_hours = {'daily': 24, 'weekly': 168, 'monthly': 720}.get(period, 24)

            base_kwh = ml_prediction * 1000.0
            kwh = abs(base_kwh) * period_hours

            return {
                "model": model_type,
                "period": period,
                "kwh": round(kwh, 4),
                "avg_temp": avg_temp,
                "avg_pressure": avg_pressure,
                "ac_on_ratio": round(ac_on_ratio, 3),
                "hours_eval": round(period_hours, 4)
            }, 200

        except Exception as e:
            import traceback
            traceback.print_exc()
            return {"error": str(e)}, 500


# ===== SQLITE3 TELEMETRY SENSOR LOGS ENDPOINTS =====

def row_to_dict(row):
    """Convert a sqlite3.Row object to a dictionary with proper types."""
    if row is None:
        return None
    d = dict(row)
    # Ensure numerical fields are floats
    for field in ('temperature', 'pressure', 'battery', 'rssi'):
        if field in d and d[field] is not None:
            try:
                d[field] = float(d[field])
            except (ValueError, TypeError):
                pass
    return d


class TelemetryListResource(Resource):
    """
    CRUD & Querying for Sensor Data Logs in SQLite3.
    Supports pagination, filtering by node, room, date, and time.
    """
    def get(self):
        page = int(request.args.get('page', 1))
        per_page = int(request.args.get('perPage', request.args.get('limit', 50)))
        sort = request.args.get('sort', '-created')
        node_id = request.args.get('node_id', request.args.get('node', None))
        sensor_name = request.args.get('sensor_name', None)
        date_key = request.args.get('date', None)
        start_time = request.args.get('start_time', None)
        end_time = request.args.get('end_time', None)
        filter_str = request.args.get('filter', None)

        query = "SELECT * FROM telemetry WHERE 1=1"
        count_query = "SELECT COUNT(*) FROM telemetry WHERE 1=1"
        params = []
        count_params = []

        if node_id:
            query += " AND (node_id = ? OR sensor_name = ?)"
            count_query += " AND (node_id = ? OR sensor_name = ?)"
            params.extend([node_id, node_id])
            count_params.extend([node_id, node_id])

        if sensor_name:
            query += " AND sensor_name = ?"
            count_query += " AND sensor_name = ?"
            params.append(sensor_name)
            count_params.append(sensor_name)

        if date_key and date_key != 'all':
            query += " AND created LIKE ?"
            count_query += " AND created LIKE ?"
            params.append(f"{date_key}%")
            count_params.append(f"{date_key}%")

        if start_time and end_time:
            # Filter by time substring (HH:MM)
            query += " AND strftime('%H:%M', created) >= ? AND strftime('%H:%M', created) <= ?"
            count_query += " AND strftime('%H:%M', created) >= ? AND strftime('%H:%M', created) <= ?"
            params.extend([start_time, end_time])
            count_params.extend([start_time, end_time])

        # Sorting
        if sort.startswith('-'):
            col = sort[1:]
            query += f" ORDER BY {col} DESC"
        else:
            col = sort
            query += f" ORDER BY {col} ASC"

        conn = get_db_connection()
        try:
            total_items = conn.execute(count_query, count_params).fetchone()[0]

            if per_page > 0:
                offset = (page - 1) * per_page
                query += " LIMIT ? OFFSET ?"
                params.extend([per_page, offset])

            rows = conn.execute(query, params).fetchall()
            items = [row_to_dict(r) for r in rows]

            total_pages = 1 if per_page == 0 else max(1, (total_items + per_page - 1) // per_page)

            return {
                "items": items,
                "totalItems": total_items,
                "page": page,
                "perPage": per_page,
                "totalPages": total_pages
            }, 200
        except Exception as e:
            return {"error": str(e)}, 500
        finally:
            conn.close()

    def post(self):
        """Insert single or multiple telemetry sensor logs into SQLite3."""
        payload = request.get_json() or {}
        if isinstance(payload, list):
            items_to_insert = payload
        else:
            items_to_insert = [payload]

        now_iso = datetime.now().isoformat()
        inserted_items = []

        conn = get_db_connection()
        try:
            with conn:
                for item in items_to_insert:
                    record_id = item.get('id') or f"telem_{uuid.uuid4().hex[:12]}"
                    node_id = item.get('node_id') or item.get('id') or 'node-1'
                    sensor_name = item.get('sensor_name') or item.get('name') or node_id
                    room_name = item.get('room_name') or 'Unassigned'
                    floor_name = item.get('floor_name') or 'Unassigned'
                    building_name = item.get('building_name') or 'Main Campus Building'
                    aircon_type = item.get('aircon_type') or 'Split Type (Inverter)'
                    temperature = float(item.get('temperature', item.get('temp', 24.0)))
                    pressure = float(item.get('pressure', 0.45))
                    battery = float(item.get('battery', 4.0))
                    rssi = float(item.get('rssi', -60.0))
                    status = item.get('status', 'online')
                    created = item.get('created') or now_iso
                    updated = item.get('updated') or now_iso

                    conn.execute("""
                        INSERT OR REPLACE INTO telemetry (
                            id, node_id, sensor_name, room_name, floor_name, building_name,
                            aircon_type, temperature, pressure, battery, rssi, status, created, updated
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (
                        record_id, node_id, sensor_name, room_name, floor_name, building_name,
                        aircon_type, temperature, pressure, battery, rssi, status, created, updated
                    ))

                    inserted_items.append({
                        "id": record_id,
                        "node_id": node_id,
                        "sensor_name": sensor_name,
                        "room_name": room_name,
                        "floor_name": floor_name,
                        "building_name": building_name,
                        "aircon_type": aircon_type,
                        "temperature": temperature,
                        "pressure": pressure,
                        "battery": battery,
                        "rssi": rssi,
                        "status": status,
                        "created": created,
                        "updated": updated
                    })

            if len(inserted_items) == 1 and not isinstance(payload, list):
                return inserted_items[0], 201
            return {"items": inserted_items, "count": len(inserted_items)}, 201
        except Exception as e:
            return {"error": str(e)}, 500
        finally:
            conn.close()

    def delete(self):
        """Clear all or filtered telemetry sensor logs."""
        node_id = request.args.get('node_id')
        conn = get_db_connection()
        try:
            with conn:
                if node_id:
                    conn.execute("DELETE FROM telemetry WHERE node_id = ? OR sensor_name = ?", (node_id, node_id))
                else:
                    conn.execute("DELETE FROM telemetry")
            return {"success": True}, 200
        except Exception as e:
            return {"error": str(e)}, 500
        finally:
            conn.close()


class TelemetryItemResource(Resource):
    """Retrieve, update, or delete a single sensor log record by ID."""
    def get(self, item_id):
        conn = get_db_connection()
        try:
            row = conn.execute("SELECT * FROM telemetry WHERE id = ?", (item_id,)).fetchone()
            if not row:
                return {"error": f"Record {item_id} not found"}, 404
            return row_to_dict(row), 200
        finally:
            conn.close()

    def delete(self, item_id):
        conn = get_db_connection()
        try:
            with conn:
                conn.execute("DELETE FROM telemetry WHERE id = ?", (item_id,))
            return {"success": True}, 200
        finally:
            conn.close()


class TelemetryTransferResource(Resource):
    """
    Bulk transfer endpoint to ingest records from Supabase into SQLite3.
    """
    def post(self):
        data = request.get_json() or {}
        records = data.get('records', []) if isinstance(data, dict) else (data if isinstance(data, list) else [])
        if not records:
            return {"transferred": 0, "skipped": 0, "message": "No records provided"}, 200

        conn = get_db_connection()
        transferred = 0
        skipped = 0
        try:
            with conn:
                for r in records:
                    rec_id = r.get('id') or f"telem_{uuid.uuid4().hex[:12]}"
                    node_id = r.get('node_id') or r.get('sensor_name') or 'node-1'
                    sensor_name = r.get('sensor_name') or node_id
                    room_name = r.get('room_name') or 'Unassigned'
                    floor_name = r.get('floor_name') or 'Unassigned'
                    building_name = r.get('building_name') or 'Main Campus Building'
                    aircon_type = r.get('aircon_type') or 'Split Type (Inverter)'
                    temp = float(r.get('temperature', r.get('temp', 24.0)))
                    press = float(r.get('pressure', 0.45))
                    batt = float(r.get('battery', 4.0))
                    rssi = float(r.get('rssi', -60.0))
                    status = r.get('status', 'online')
                    created = r.get('created') or datetime.now().isoformat()
                    updated = r.get('updated') or created

                    # Check for duplicate by id or (sensor_name + timestamp)
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

            return {
                "success": True,
                "transferred": transferred,
                "skipped": skipped,
                "total_in_db": conn.execute("SELECT COUNT(*) FROM telemetry").fetchone()[0]
            }, 200
        except Exception as e:
            return {"error": str(e)}, 500
        finally:
            conn.close()


class HistoricalResource(Resource):
    """Returns historical time-series telemetry data for charts."""
    def get(self):
        conn = get_db_connection()
        try:
            rows = conn.execute("SELECT temperature, pressure, created FROM telemetry ORDER BY created ASC LIMIT 500").fetchall()
            return {
                "temperatures": [float(r['temperature']) for r in rows],
                "pressures": [float(r['pressure']) for r in rows],
                "timestamps": [r['created'] for r in rows]
            }, 200
        finally:
            conn.close()


# Register Endpoints
api.add_resource(HealthResource, '/api/health')
api.add_resource(EnergyPredictionResource, '/api/predict-energy')
api.add_resource(PredictionFeaturesResource, '/api/prediction-features')
api.add_resource(PredictionMetricsResource, '/api/prediction-metrics')
api.add_resource(TelemetryListResource, '/api/telemetry')
api.add_resource(TelemetryItemResource, '/api/telemetry/<string:item_id>')
api.add_resource(TelemetryTransferResource, '/api/telemetry/transfer')
api.add_resource(HistoricalResource, '/api/historical')


# ===== ENTRY POINT =====
if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    debug = os.environ.get('FLASK_DEBUG', 'False').lower() in ('true', '1')

    print(f"[*] EcoTrack Microservice starting on port {port}")
    print(f"[*] SQLite3 Database : {SQLITE_DB_PATH}")
    print(f"[*] ML models        : {', '.join(MODEL_FILES.keys())}")
    print(f"[*] Telemetry API    : http://localhost:{port}/api/telemetry")
    print(f"[*] Prediction API   : http://localhost:{port}/api/predict-energy")

    app.run(host='0.0.0.0', port=port, debug=debug)
