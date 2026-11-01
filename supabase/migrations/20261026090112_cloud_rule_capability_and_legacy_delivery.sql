BEGIN;
SET LOCAL lock_timeout='5s';
CREATE OR REPLACE FUNCTION public.ecotrack_cloud_rule_evaluation()
RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$ SELECT true $$;
REVOKE ALL ON FUNCTION public.ecotrack_cloud_rule_evaluation() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ecotrack_cloud_rule_evaluation() TO authenticated;

-- Keep the supported pre-outbox exchange from overwriting newer buffered samples.
DO $compatibility$
DECLARE target regprocedure:=to_regprocedure('public.ecotrack_device_exchange(text,text,jsonb,jsonb)'); definition text;
 old_statement text:='UPDATE public.nodes SET temp=measured_t,rotation_rpm=measured_rpm WHERE id=target;';
 new_statement text:='UPDATE public.nodes SET temp=measured_t,rotation_rpm=measured_rpm,
 rotation_quality=coalesce(p_status->>''rotation_quality'',CASE WHEN measured_rpm IS NULL THEN ''missing'' ELSE ''ok'' END),
 last_measurement_at=measured_at,last_measurement_report_id=p_status->>''report_id''
 WHERE id=target AND measured_at IS NOT NULL AND (last_measurement_at IS NULL OR last_measurement_at<=measured_at);';
BEGIN
 IF target IS NOT NULL THEN
  definition:=pg_get_functiondef(target);
  IF position(old_statement IN definition)>0 THEN
   EXECUTE replace(definition,old_statement,new_statement);
  ELSIF position('last_measurement_at=measured_at' IN definition)=0 THEN
   RAISE EXCEPTION 'Unrecognized legacy measurement exchange; review before applying';
  END IF;
 END IF;
END $compatibility$;
NOTIFY pgrst,'reload schema';
COMMIT;

