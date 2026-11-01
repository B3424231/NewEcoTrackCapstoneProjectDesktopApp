-- Supabase is a transient telemetry bridge. Only the backend may acknowledge archived rows.
-- Calling this function with an empty array never deletes data.
BEGIN;
CREATE OR REPLACE FUNCTION public.ecotrack_ack_telemetry(p_records jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp AS $$
DECLARE deleted_ids jsonb; acknowledged_ids jsonb; changed_ids jsonb;
BEGIN
  IF jsonb_typeof(p_records) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid telemetry acknowledgement records';
  END IF;
  IF jsonb_array_length(p_records)>500 OR octet_length(p_records::text)>2097152 THEN
    RAISE EXCEPTION 'Too many telemetry acknowledgement records';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_records) r
    WHERE jsonb_typeof(r) IS DISTINCT FROM 'object'
      OR jsonb_typeof(r->'id') IS DISTINCT FROM 'string' OR length(r->>'id') NOT BETWEEN 1 AND 512) THEN
    RAISE EXCEPTION 'Invalid telemetry acknowledgement record';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_records) r GROUP BY r->>'id' HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Duplicate telemetry acknowledgement IDs';
  END IF;
  -- Match all fields and their SQL types. Concurrently changed rows remain in the bridge.
  WITH removed AS (
    DELETE FROM public.telemetry t USING jsonb_array_elements(p_records) e(payload)
    WHERE t.id=e.payload->>'id'
      AND ARRAY(SELECT k FROM jsonb_object_keys(to_jsonb(t)) k ORDER BY k)
        = ARRAY(SELECT k FROM jsonb_object_keys(e.payload) k ORDER BY k)
      AND to_jsonb(t)=to_jsonb(jsonb_populate_record(NULL::public.telemetry,e.payload))
    RETURNING t.id
  ) SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb) INTO deleted_ids FROM removed;
  -- Missing rows are safe retries after a prior successful delete and a lost HTTP response.
  SELECT coalesce(jsonb_agg(r->>'id' ORDER BY r->>'id'),'[]'::jsonb) INTO acknowledged_ids
    FROM jsonb_array_elements(p_records) r
    WHERE NOT EXISTS(SELECT 1 FROM public.telemetry t WHERE t.id=r->>'id');
  SELECT coalesce(jsonb_agg(r->>'id' ORDER BY r->>'id'),'[]'::jsonb) INTO changed_ids
    FROM jsonb_array_elements(p_records) r
    WHERE EXISTS(SELECT 1 FROM public.telemetry t WHERE t.id=r->>'id');
  RETURN jsonb_build_object('acknowledged_ids',acknowledged_ids,'deleted_ids',deleted_ids,'changed_ids',changed_ids);
END $$;
REVOKE ALL ON FUNCTION public.ecotrack_ack_telemetry(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ecotrack_ack_telemetry(jsonb) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
