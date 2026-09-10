-- ===================================================================
-- ECOTRACK SUPABASE DATABASE SCHEMA
-- Run this SQL in your Supabase SQL Editor (Dashboard -> SQL Editor)
-- ===================================================================

-- Enable pgcrypto for UUID generation if needed
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. ADMINISTRATORS / USERS
CREATE TABLE IF NOT EXISTS administrators (
    id TEXT PRIMARY KEY DEFAULT ('admin_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 15)),
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL DEFAULT 'adminpassword123',
    role TEXT NOT NULL DEFAULT 'admin',
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_login TIMESTAMPTZ,
    created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. BUILDINGS
CREATE TABLE IF NOT EXISTS buildings (
    id TEXT PRIMARY KEY DEFAULT ('bld_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 15)),
    name TEXT NOT NULL,
    admin_id TEXT REFERENCES administrators(id) ON DELETE SET NULL,
    created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. FLOORS
CREATE TABLE IF NOT EXISTS floors (
    id TEXT PRIMARY KEY DEFAULT ('flr_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 15)),
    name TEXT NOT NULL,
    building_id TEXT REFERENCES buildings(id) ON DELETE CASCADE,
    created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. ROOMS
CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY DEFAULT ('rm_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 15)),
    name TEXT NOT NULL,
    node_limit INTEGER NOT NULL DEFAULT 5,
    floor_id TEXT REFERENCES floors(id) ON DELETE CASCADE,
    admin_id TEXT REFERENCES administrators(id) ON DELETE SET NULL,
    created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. NODES (Sensor Hardware Registry & AC Metadata)
CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY DEFAULT ('node_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 15)),
    name TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'offline',
    temp NUMERIC DEFAULT 0,
    pressure NUMERIC DEFAULT 0,
    rssi NUMERIC DEFAULT 0,
    battery NUMERIC DEFAULT 0,
    wake_time TEXT DEFAULT '00:00',
    sleep_time TEXT DEFAULT '00:00',
    interval_val INTEGER DEFAULT 15,
    interval_unit TEXT DEFAULT 'Minutes',
    room_id TEXT REFERENCES rooms(id) ON DELETE SET NULL,
    aircon_type TEXT DEFAULT 'Split Type (Inverter)',
    install_date TEXT DEFAULT '2026-01-15',
    created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. RULES (Automation & Alert Thresholds)
CREATE TABLE IF NOT EXISTS rules (
    id TEXT PRIMARY KEY DEFAULT ('rule_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 15)),
    type TEXT NOT NULL, -- 'temperature' | 'battery'
    condition TEXT NOT NULL, -- 'above' | 'below' | 'equals'
    value NUMERIC NOT NULL,
    unit TEXT NOT NULL, -- '°C' | '°F' | '%'
    enabled BOOLEAN NOT NULL DEFAULT true,
    message TEXT,
    duration INTEGER DEFAULT 5,
    start_date TEXT,
    start_time TEXT,
    end_date TEXT,
    end_time TEXT,
    room_id TEXT REFERENCES rooms(id) ON DELETE SET NULL,
    building_id TEXT REFERENCES buildings(id) ON DELETE SET NULL,
    floor_id TEXT REFERENCES floors(id) ON DELETE SET NULL,
    admin_id TEXT REFERENCES administrators(id) ON DELETE SET NULL,
    created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. RULE_NODES (Many-to-Many rule to node assignments)
CREATE TABLE IF NOT EXISTS rule_nodes (
    id TEXT PRIMARY KEY DEFAULT ('rn_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 15)),
    rule_id TEXT NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(rule_id, node_id)
);

-- 8. NOTIFICATIONS
CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY DEFAULT ('notif_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 15)),
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    content TEXT NOT NULL,
    triggered BOOLEAN NOT NULL DEFAULT false,
    room_id TEXT REFERENCES rooms(id) ON DELETE SET NULL,
    rule_id TEXT REFERENCES rules(id) ON DELETE SET NULL,
    admin_id TEXT REFERENCES administrators(id) ON DELETE SET NULL,
    created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. MAINTENANCE STAFF
CREATE TABLE IF NOT EXISTS staff (
    id TEXT PRIMARY KEY DEFAULT ('stf_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 15)),
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    phone TEXT,
    role TEXT DEFAULT 'HVAC / Aircon Technician',
    status TEXT NOT NULL DEFAULT 'Active', -- 'Online' | 'Offline' | 'Archived' | 'Active'
    is_online BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    is_archived BOOLEAN DEFAULT false,
    archive_reason TEXT,
    archive_notes TEXT,
    archived_at TIMESTAMPTZ,
    online_status TEXT DEFAULT 'offline',
    building_name TEXT DEFAULT 'Main Campus Building',
    floor_name TEXT DEFAULT '2nd Floor - IT Wing',
    room_name TEXT DEFAULT 'Server Room A',
    room_id TEXT REFERENCES rooms(id) ON DELETE SET NULL,
    avatar_url TEXT,
    photo_url TEXT,
    last_active TIMESTAMPTZ DEFAULT NOW(),
    created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure all staff table columns exist in existing Supabase databases
ALTER TABLE staff ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'HVAC / Aircon Technician';
ALTER TABLE staff ADD COLUMN IF NOT EXISTS is_online BOOLEAN DEFAULT false;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS archive_reason TEXT;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS archive_notes TEXT;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS online_status TEXT DEFAULT 'offline';
ALTER TABLE staff ADD COLUMN IF NOT EXISTS building_name TEXT DEFAULT 'Main Campus Building';
ALTER TABLE staff ADD COLUMN IF NOT EXISTS floor_name TEXT DEFAULT '2nd Floor - IT Wing';
ALTER TABLE staff ADD COLUMN IF NOT EXISTS room_name TEXT DEFAULT 'Server Room A';
ALTER TABLE staff ADD COLUMN IF NOT EXISTS room_id TEXT REFERENCES rooms(id) ON DELETE SET NULL;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS photo_url TEXT;

-- 10. SYSTEM CONFIGURATION
CREATE TABLE IF NOT EXISTS system_config (
    id TEXT PRIMARY KEY DEFAULT 'cfg_default',
    optimal_temp NUMERIC DEFAULT 24,
    ac_eco NUMERIC DEFAULT 22,
    ac_cool NUMERIC DEFAULT 25,
    ac_cold NUMERIC DEFAULT 28,
    diag_temp_critical NUMERIC DEFAULT 28,
    diag_temp_warning NUMERIC DEFAULT 26,
    diag_voltage_critical NUMERIC DEFAULT 3.3,
    diag_voltage_warning NUMERIC DEFAULT 3.5,
    diag_rssi_poor NUMERIC DEFAULT -80,
    power_sleep_hours NUMERIC DEFAULT 8,
    power_active_draw_ma NUMERIC DEFAULT 50,
    power_sleep_draw_ma NUMERIC DEFAULT 5,
    created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. ANALYTICS SNAPSHOTS (Daily Aggregate Summaries)
CREATE TABLE IF NOT EXISTS analytics_snapshots (
    id TEXT PRIMARY KEY DEFAULT ('snp_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 15)),
    date TEXT NOT NULL,
    room_id TEXT REFERENCES rooms(id) ON DELETE CASCADE,
    avg_temp NUMERIC DEFAULT 0,
    avg_pressure NUMERIC DEFAULT 0,
    avg_battery NUMERIC DEFAULT 0,
    alerts_count INTEGER DEFAULT 0,
    health_score NUMERIC DEFAULT 100,
    compliance_rate NUMERIC DEFAULT 100,
    created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(date, room_id)
);

-- 12. MAINTENANCE REPORTS (Preventive, Sensor Calibration, Cleaning, Repairs)
CREATE TABLE IF NOT EXISTS maintenance_reports (
    id TEXT PRIMARY KEY DEFAULT ('mr_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 15)),
    aircon_id TEXT REFERENCES nodes(id) ON DELETE SET NULL,
    aircon_name TEXT,
    aircon_type TEXT DEFAULT 'Split Type (Inverter)',
    room_id TEXT REFERENCES rooms(id) ON DELETE SET NULL,
    room_name TEXT,
    type TEXT NOT NULL DEFAULT 'Preventive Maintenance',
    priority TEXT NOT NULL DEFAULT 'Medium',
    staff_id TEXT REFERENCES staff(id) ON DELETE SET NULL,
    staff_name TEXT NOT NULL,
    due_date TEXT,
    created_date TEXT,
    status TEXT NOT NULL DEFAULT 'Pending',
    description TEXT,
    tasks JSONB DEFAULT '[]'::jsonb,
    issue JSONB,
    verification_remarks TEXT,
    timeline JSONB DEFAULT '[]'::jsonb,
    admin_id TEXT REFERENCES administrators(id) ON DELETE SET NULL,
    created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_maint_status ON maintenance_reports(status);
CREATE INDEX IF NOT EXISTS idx_maint_staff_id ON maintenance_reports(staff_id);
CREATE INDEX IF NOT EXISTS idx_maint_aircon_id ON maintenance_reports(aircon_id);
CREATE INDEX IF NOT EXISTS idx_maint_created ON maintenance_reports(created DESC);

-- ===================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- Enable RLS and grant full CRUD access for both anon and authenticated users
-- ===================================================================

DO $$ 
DECLARE 
    t text;
BEGIN
    FOR t IN 
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
          AND table_name IN ('administrators', 'buildings', 'floors', 'rooms', 'nodes', 'rules', 'rule_nodes', 'notifications', 'staff', 'system_config', 'analytics_snapshots', 'maintenance_reports')
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
        EXECUTE format('DROP POLICY IF EXISTS %I_all ON %I;', t, t);
        EXECUTE format('CREATE POLICY %I_all ON %I FOR ALL USING (true) WITH CHECK (true);', t, t);
    END LOOP;
END $$;

-- ===================================================================
-- INITIAL DEFAULT SEED DATA
-- ===================================================================

-- Default Administrator
INSERT INTO administrators (id, username, email, password, role, is_active)
VALUES ('admin_default_01', 'admin', 'admin@ecotrack.local', 'adminpassword123', 'admin', true)
ON CONFLICT (id) DO NOTHING;

-- Default Building & Floor
INSERT INTO buildings (id, name)
VALUES ('bld_main', 'Main Campus Building')
ON CONFLICT (id) DO NOTHING;

INSERT INTO floors (id, name, building_id)
VALUES ('flr_2nd_it', '2nd Floor - IT Wing', 'bld_main')
ON CONFLICT (id) DO NOTHING;

-- Default Rooms
INSERT INTO rooms (id, name, node_limit, floor_id)
VALUES 
    ('rm_svr_01', 'Server Room A', 5, 'flr_2nd_it'),
    ('rm_ofc_01', 'Main Office Area', 5, 'flr_2nd_it'),
    ('rm_lab_01', 'Laboratory A', 5, 'flr_2nd_it')
ON CONFLICT (id) DO NOTHING;

-- Default Nodes
INSERT INTO nodes (id, name, status, temp, pressure, battery, rssi, room_id, aircon_type)
VALUES 
    ('node_001', 'node-1', 'online', 23.5, 0.48, 4.15, -65, 'rm_svr_01', 'Split Type (Inverter)'),
    ('node_002', 'node-2', 'online', 24.1, 0.51, 4.08, -70, 'rm_svr_01', 'Split Type (Inverter)'),
    ('node_003', 'node-3', 'online', 22.8, 0.50, 4.20, -60, 'rm_ofc_01', 'Floor Standing'),
    ('node_004', 'node-4', 'online', 23.2, 0.49, 4.12, -68, 'rm_ofc_01', 'Floor Standing'),
    ('node_005', 'node-5', 'online', 25.4, 0.53, 3.95, -75, 'rm_ofc_01', 'Split Type (Inverter)'),
    ('node_006', 'node-6', 'online', 21.9, 0.47, 4.18, -62, 'rm_lab_01', 'Window Type')
ON CONFLICT (id) DO NOTHING;

-- Default Rules
INSERT INTO rules (id, type, condition, value, unit, enabled, message, room_id)
VALUES
    ('rule_svr_temp', 'temperature', 'above', 26.0, '°C', true, 'Server Room temperature exceeded safe operating threshold.', 'rm_svr_01'),
    ('rule_node_bat', 'battery', 'below', 20.0, '%', true, 'Sensor battery charge is critically low. Battery replacement advised.', NULL)
ON CONFLICT (id) DO NOTHING;

-- Default Config
INSERT INTO system_config (id, optimal_temp, ac_eco, ac_cool, ac_cold)
VALUES ('cfg_default', 24.0, 22.0, 25.0, 28.0)
ON CONFLICT (id) DO NOTHING;

-- ===================================================================
-- 13. SENSOR TELEMETRY LOGS (Replaces PocketBase sensor logs)
-- ===================================================================
CREATE TABLE IF NOT EXISTS public.telemetry (
    id TEXT PRIMARY KEY DEFAULT ('telem_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 15)),
    node_id TEXT,
    sensor_name TEXT NOT NULL,
    room_name TEXT DEFAULT 'Server Room A',
    floor_name TEXT DEFAULT '2nd Floor - IT Wing',
    building_name TEXT DEFAULT 'Main Campus Building',
    aircon_type TEXT DEFAULT 'Split Type (Inverter)',
    temperature NUMERIC NOT NULL DEFAULT 24.0,
    pressure NUMERIC NOT NULL DEFAULT 0.45,
    battery NUMERIC NOT NULL DEFAULT 4.0,
    rssi NUMERIC NOT NULL DEFAULT -60,
    status TEXT NOT NULL DEFAULT 'online',
    created TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.telemetry ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS telemetry_all ON public.telemetry;
CREATE POLICY telemetry_all ON public.telemetry FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_telemetry_created ON public.telemetry(created DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_sensor_name ON public.telemetry(sensor_name);
-- Safely add tables to Supabase Realtime publication if not already added
DO $$ 
DECLARE
    tbl text;
BEGIN
    FOR tbl IN 
        SELECT unnest(ARRAY['telemetry', 'maintenance_reports', 'nodes', 'notifications', 'staff', 'rooms', 'rules'])
    LOOP
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = tbl)
           AND NOT EXISTS (
               SELECT 1 FROM pg_publication_tables 
               WHERE pubname = 'supabase_realtime' 
                 AND schemaname = 'public' 
                 AND tablename = tbl
           ) THEN
            EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I;', tbl);
        END IF;
    END LOOP;
END $$;
