-- Keep actual monitoring samples independently of requested/confirmed AC power.
-- Leave the existing controller-only recording gate and all ac_on values intact.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

CREATE OR REPLACE FUNCTION ecotrack_private.monitoring_measurement_aircon(sample public.telemetry)
RETURNS text LANGUAGE sql STABLE SET search_path='' AS $function$
 SELECT n.monitor_aircon_id FROM public.nodes n
 JOIN public.aircons a ON a.id=n.monitor_aircon_id
 WHERE n.id=sample.node_id AND n.device_mode IN ('monitoring','both')
  AND sample.observed_at>='1970-01-01'::timestamptz
  AND sample.observed_at<=now()+interval '5 minutes'
  AND sample.boot_id ~ '^[A-Za-z0-9_-]{1,80}$' AND sample.sequence>=0
  AND sample.interval_seconds BETWEEN 1 AND 86400
  AND (sample.temperature BETWEEN -40 AND 125 OR
   (sample.rotation_rpm BETWEEN 0 AND 1000000 AND sample.rotation_quality='ok'))
$function$;
REVOKE ALL ON FUNCTION ecotrack_private.monitoring_measurement_aircon(public.telemetry)
 FROM PUBLIC,anon,authenticated;

DO $migration$
DECLARE target regprocedure; marker text; definition text;
 prefix text:=$prefix$IF ecotrack_private.monitoring_measurement_aircon(NEW) IS NOT NULL THEN
  NEW.aircon_id:=ecotrack_private.monitoring_measurement_aircon(NEW);
  RETURN NEW;
 END IF;
 $prefix$;
BEGIN
 FOR target,marker IN SELECT * FROM (VALUES
  ('ecotrack_private.guard_ac_analytics_sample()'::regprocedure,
   '-- This trigger only gates routine telemetry, not management or command audits.'),
  ('public.ecotrack_snapshot_aircon_control()'::regprocedure,
   '-- Preserve the historical snapshot/IR fields supplied by ingestion or the earlier analytics guard.')
 ) AS changes(target,marker)
 LOOP
  definition:=pg_get_functiondef(target);
  IF position('ecotrack_private.monitoring_measurement_aircon(NEW)' IN definition)=0 THEN
   IF position(marker IN definition)=0 THEN
    RAISE EXCEPTION 'Unrecognized telemetry trigger %; review before applying',target;
   END IF;
   EXECUTE replace(definition,marker,prefix||marker);
  END IF;
 END LOOP;
END $migration$;

NOTIFY pgrst,'reload schema';
COMMIT;
