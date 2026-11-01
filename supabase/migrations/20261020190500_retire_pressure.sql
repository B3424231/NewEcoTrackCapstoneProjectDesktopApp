-- EXPLICIT DATA RETIREMENT. Export a protected database backup before applying.
-- Removes only the obsolete sensor fields/configuration; never converts old values to RPM.
-- Existing records, IDs, temperature, timestamps, power evidence, auth and RLS remain.
-- No CASCADE: dependencies cause rollback and must be reviewed explicitly.
BEGIN;
ALTER TABLE public.telemetry DROP COLUMN IF EXISTS pressure;
ALTER TABLE public.nodes DROP COLUMN IF EXISTS pressure;
ALTER TABLE IF EXISTS public.monitor_nodes
 DROP COLUMN IF EXISTS temperature_sensor,
 DROP COLUMN IF EXISTS pressure_sensor,
 DROP COLUMN IF EXISTS pressure_min_pa,
 DROP COLUMN IF EXISTS pressure_max_pa;
ALTER TABLE IF EXISTS public.monitor_calibrations
 DROP COLUMN IF EXISTS pressure_offset_pa,
 DROP COLUMN IF EXISTS pressure_scale,
 DROP COLUMN IF EXISTS airflow_threshold_pa;
ALTER TABLE IF EXISTS public.monitor_samples
 DROP COLUMN IF EXISTS raw_pressure_pa,
 DROP COLUMN IF EXISTS differential_pressure_pa,
 DROP COLUMN IF EXISTS pressure_quality;
-- These keys describe retired hardware configuration, not actual measurements.
UPDATE public.nodes SET sensor_config = sensor_config - 'pressure_sensor' - 'pressure_min_pa' - 'pressure_max_pa'
 - 'pressure_offset_pa' - 'pressure_scale' - 'airflow_threshold_pa' - 'temperature_sensor'
 WHERE sensor_config IS NOT NULL;
-- Feature configuration enables measurements; it never fabricates a sensor value.
-- Controller-only null configuration remains null.
UPDATE public.nodes SET sensor_config=jsonb_build_object('temperature',true,'rotation_rpm',true)
 WHERE device_mode IN ('monitoring','both');
COMMIT;
