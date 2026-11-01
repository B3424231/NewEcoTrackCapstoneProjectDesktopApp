-- Apply after 202610230001_measurement_outbox.sql. Battery is measured volts, never percentage.
BEGIN;
CREATE OR REPLACE FUNCTION public.ecotrack_upload_measurements(p_device_id text,p_token text,p_readings jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE target text; credential_hash bytea; n public.nodes; cursor_row ecotrack_private.measurement_delivery_cursor;
 item jsonb; report text; boot_identity text; boot_number bigint; sample_sequence bigint;
 observed timestamptz; cadence numeric; temperature_value numeric; rpm_value numeric; quality text; battery_value numeric;
 acknowledged jsonb:='[]'::jsonb; stored public.telemetry; prior_boot bigint:=-1; prior_sequence bigint:=-1;
BEGIN
 SELECT d.node_id,d.token_hash INTO target,credential_hash FROM ecotrack_private.device_credentials d
 WHERE d.device_id=p_device_id AND p_token ~ '^[a-f0-9]{64}$' AND d.token_hash=sha256(convert_to(p_token,'UTF8')) FOR UPDATE;
 IF target IS NULL THEN RAISE EXCEPTION 'Invalid device credential' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_readings) IS DISTINCT FROM 'array' OR jsonb_array_length(p_readings) NOT BETWEEN 1 AND 20
    OR octet_length(p_readings::text)>16384 THEN RAISE EXCEPTION 'Invalid measurement batch'; END IF;
 INSERT INTO ecotrack_private.measurement_delivery_cursor(device_id,token_hash) VALUES(p_device_id,credential_hash)
 ON CONFLICT(device_id) DO UPDATE SET token_hash=EXCLUDED.token_hash,
  boot=CASE WHEN measurement_delivery_cursor.token_hash=EXCLUDED.token_hash THEN measurement_delivery_cursor.boot ELSE -1 END,
  sequence=CASE WHEN measurement_delivery_cursor.token_hash=EXCLUDED.token_hash THEN measurement_delivery_cursor.sequence ELSE -1 END;
 SELECT * INTO cursor_row FROM ecotrack_private.measurement_delivery_cursor WHERE device_id=p_device_id FOR UPDATE;
 SELECT * INTO n FROM public.nodes WHERE id=target;
 FOR item IN SELECT value FROM jsonb_array_elements(p_readings) LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid stored measurement'; END IF;
  report:=item->>'report_id'; boot_identity:=item->>'boot_id';
  IF boot_identity IS NULL OR left(boot_identity,length(p_device_id)+1)<>p_device_id||'-'
    OR substring(boot_identity from length(p_device_id)+2) !~ '^[0-9]{1,10}$'
    OR jsonb_typeof(item->'sequence') IS DISTINCT FROM 'number' OR (item->>'sequence') !~ '^[0-9]{1,10}$'
    THEN RAISE EXCEPTION 'Invalid measurement identity'; END IF;
  boot_number:=substring(boot_identity from length(p_device_id)+2)::bigint;
  sample_sequence:=(item->>'sequence')::bigint;
  IF boot_number>4294967295 OR sample_sequence>4294967295 OR report IS DISTINCT FROM boot_identity||'-'||sample_sequence::text
    THEN RAISE EXCEPTION 'Invalid measurement report ID'; END IF;
  IF (boot_number,sample_sequence)<=(prior_boot,prior_sequence) THEN RAISE EXCEPTION 'Measurement delivery must be FIFO without duplicates'; END IF;
  prior_boot:=boot_number; prior_sequence:=sample_sequence;
  IF item->>'node_id' IS DISTINCT FROM target THEN RAISE EXCEPTION 'Stored measurement belongs to a different device assignment'; END IF;
  IF jsonb_typeof(item->'observed_at') IS DISTINCT FROM 'string' OR (item->>'observed_at') !~ 'Z$|[+-][0-9]{2}:[0-9]{2}$'
    THEN RAISE EXCEPTION 'An original synchronized measurement timestamp is required'; END IF;
  observed:=(item->>'observed_at')::timestamptz;
  IF observed<'1970-01-01'::timestamptz OR observed>now()+interval '5 minutes' THEN RAISE EXCEPTION 'Invalid observation time'; END IF;
  IF jsonb_typeof(item->'interval_seconds') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Original measurement interval required'; END IF;
  cadence:=(item->>'interval_seconds')::numeric;
  IF cadence NOT BETWEEN 1 AND 86400 THEN RAISE EXCEPTION 'Invalid original measurement interval'; END IF;
  temperature_value:=NULL; rpm_value:=NULL;
  IF item->'outlet_temperature_c' IS NOT NULL AND item->'outlet_temperature_c'<>'null'::jsonb THEN
   IF jsonb_typeof(item->'outlet_temperature_c')<>'number' THEN RAISE EXCEPTION 'Invalid measured temperature'; END IF;
   temperature_value:=(item->>'outlet_temperature_c')::numeric;
   IF temperature_value NOT BETWEEN -40 AND 125 THEN RAISE EXCEPTION 'Invalid measured temperature'; END IF;
  END IF;
  quality:=item->>'rotation_quality';
  IF quality IS NULL OR quality NOT IN ('ok','missing','fault') THEN RAISE EXCEPTION 'Invalid rotation quality'; END IF;
  IF item->'rotation_rpm' IS NOT NULL AND item->'rotation_rpm'<>'null'::jsonb THEN
   IF jsonb_typeof(item->'rotation_rpm')<>'number' THEN RAISE EXCEPTION 'Invalid measured rotation'; END IF;
   rpm_value:=(item->>'rotation_rpm')::numeric;
   IF rpm_value NOT BETWEEN 0 AND 1000000 THEN RAISE EXCEPTION 'Invalid measured rotation'; END IF;
  END IF;
  IF quality IN ('missing','fault') THEN rpm_value:=NULL; END IF;
  IF quality='ok' AND rpm_value IS NULL THEN RAISE EXCEPTION 'Rotation quality requires a measurement'; END IF;
  battery_value:=NULL;
  IF item->'battery' IS NOT NULL AND item->'battery'<>'null'::jsonb THEN
   IF jsonb_typeof(item->'battery')<>'number' THEN RAISE EXCEPTION 'Battery voltage must be numeric'; END IF;
   battery_value:=(item->>'battery')::numeric;
   IF battery_value NOT BETWEEN 2.50 AND 4.35 THEN RAISE EXCEPTION 'Invalid raw single-cell battery voltage'; END IF;
  END IF;
  SELECT * INTO stored FROM public.telemetry WHERE id='cloud_'||report;
  IF FOUND AND (stored.node_id IS DISTINCT FROM target OR stored.observed_at IS DISTINCT FROM observed
     OR stored.boot_id IS DISTINCT FROM boot_identity OR stored.sequence IS DISTINCT FROM sample_sequence
     OR stored.temperature::numeric IS DISTINCT FROM temperature_value OR stored.rotation_rpm::numeric IS DISTINCT FROM rpm_value
     OR stored.battery::numeric IS DISTINCT FROM battery_value
     OR stored.rotation_quality IS DISTINCT FROM quality OR stored.interval_seconds::numeric IS DISTINCT FROM cadence)
     THEN RAISE EXCEPTION 'An existing measurement has different contents'; END IF;
  IF (boot_number,sample_sequence)>(cursor_row.boot,cursor_row.sequence) THEN
   INSERT INTO public.telemetry(id,node_id,sensor_name,room_name,aircon_type,temperature,rotation_rpm,rotation_quality,
       observed_at,boot_id,sequence,battery,rssi,status,created,interval_seconds,ac_on)
    VALUES('cloud_'||report,target,n.name,(SELECT name FROM public.rooms WHERE id=n.room_id),n.aircon_type,
       temperature_value,rpm_value,quality,observed,boot_identity,sample_sequence,battery_value,
       CASE WHEN jsonb_typeof(item->'rssi')='number' THEN (item->>'rssi')::numeric ELSE NULL END,
       'online',observed,cadence,NULL) ON CONFLICT(id) DO NOTHING;
   cursor_row.boot:=boot_number; cursor_row.sequence:=sample_sequence;
   UPDATE public.nodes SET temp=temperature_value,rotation_rpm=rpm_value,rotation_quality=quality,
       last_measurement_at=observed,last_measurement_report_id=report
     WHERE id=target AND (last_measurement_at IS NULL OR last_measurement_at<=observed);
  END IF;
  acknowledged:=acknowledged||jsonb_build_array(report);
 END LOOP;
 UPDATE ecotrack_private.measurement_delivery_cursor SET boot=cursor_row.boot,sequence=cursor_row.sequence WHERE device_id=p_device_id;
 RETURN jsonb_build_object('success',true,'node_id',target,'acknowledged_ids',acknowledged);
END $$;
REVOKE ALL ON FUNCTION public.ecotrack_upload_measurements(text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ecotrack_upload_measurements(text,text,jsonb) TO anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
