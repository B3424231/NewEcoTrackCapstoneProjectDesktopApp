-- REVIEW AND APPLY EXPLICITLY. Add real rotation fields; never backfill readings.
-- No RLS, authorization, ownership or device identity changes.
BEGIN;
ALTER TABLE public.telemetry ADD COLUMN IF NOT EXISTS rotation_rpm double precision CHECK(rotation_rpm>=0);
ALTER TABLE public.telemetry ADD COLUMN IF NOT EXISTS rotation_quality text CHECK(rotation_quality IN ('ok','missing','fault'));
ALTER TABLE public.telemetry ADD COLUMN IF NOT EXISTS observed_at timestamptz;
ALTER TABLE public.telemetry ADD COLUMN IF NOT EXISTS boot_id text;
ALTER TABLE public.telemetry ADD COLUMN IF NOT EXISTS sequence bigint;
ALTER TABLE public.nodes ADD COLUMN IF NOT EXISTS rotation_rpm double precision CHECK(rotation_rpm>=0);
ALTER TABLE IF EXISTS public.monitor_samples ADD COLUMN IF NOT EXISTS rotation_rpm double precision CHECK(rotation_rpm>=0);
ALTER TABLE IF EXISTS public.monitor_samples ADD COLUMN IF NOT EXISTS rotation_quality text NOT NULL DEFAULT 'missing'
 CHECK(rotation_quality IN ('ok','missing','fault'));
-- Permit safe transitional writes before the explicit retirement migration.
DO $$
DECLARE item record;
BEGIN
 FOR item IN SELECT table_name,column_name FROM information_schema.columns
  WHERE table_schema='public' AND (
   (table_name='monitor_nodes' AND column_name IN ('temperature_sensor','pressure_sensor','pressure_min_pa','pressure_max_pa')) OR
   (table_name='monitor_calibrations' AND column_name IN ('pressure_offset_pa','pressure_scale')) OR
   (table_name='monitor_samples' AND column_name='pressure_quality'))
 LOOP EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I DROP NOT NULL',item.table_name,item.column_name); END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.ecotrack_validate_ac_device_assignment(p_device_id text,p_setup jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE role_name text; target text; n public.nodes; ac public.aircons; config jsonb;
BEGIN
 IF to_regprocedure('public.ecotrack_require_controller_registration(text,jsonb)') IS NOT NULL THEN
  EXECUTE 'SELECT public.ecotrack_require_controller_registration($1,$2)' USING p_device_id,p_setup;
 ELSIF auth.uid() IS NULL OR public.ecotrack_is_admin() IS NOT TRUE THEN
  RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501';
 END IF;
 IF coalesce(p_device_id,'') !~ '^esp32s3-[a-f0-9]{12}$' OR jsonb_typeof(p_setup) IS DISTINCT FROM 'object'
  OR octet_length(p_setup::text)>4000 THEN RAISE EXCEPTION 'Invalid AC device setup'; END IF;
 role_name:=p_setup->>'device_mode';
 IF role_name IS NULL OR role_name NOT IN ('monitoring','controller','both') THEN RAISE EXCEPTION 'Choose an AC device type'; END IF;
 IF p_setup ? 'aircon_name' AND p_setup->'aircon_name'<>'null'::jsonb AND
  (jsonb_typeof(p_setup->'aircon_name')<>'string' OR length(btrim(p_setup->>'aircon_name')) NOT BETWEEN 1 AND 100 OR p_setup->>'aircon_name' ~ '[<>[:cntrl:]]') THEN RAISE EXCEPTION 'Enter a valid air conditioner name'; END IF;
 SELECT node_id INTO target FROM ecotrack_private.device_credentials WHERE device_id=p_device_id;
 IF target IS NULL THEN SELECT node_id INTO target FROM public.ecotrack_device_state WHERE device_id=p_device_id; END IF;
 SELECT * INTO n FROM public.nodes WHERE id=target;
 IF role_name<>'monitoring' THEN
  PERFORM public.ecotrack_validate_controller_assignment(p_device_id,p_setup);
 ELSE
  IF length(btrim(coalesce(p_setup->>'controller_name',''))) NOT BETWEEN 1 AND 100 OR p_setup->>'controller_name' ~ '[<>[:cntrl:]]'
   OR length(btrim(coalesce(p_setup->>'aircon_type',''))) NOT BETWEEN 1 AND 100 OR p_setup->>'aircon_type' ~ '[<>[:cntrl:]]'
   OR length(coalesce(p_setup->>'brand',''))>80 OR p_setup->>'brand' ~ '[<>[:cntrl:]]' THEN RAISE EXCEPTION 'Enter a valid device name, AC type and manufacturer'; END IF;
  IF EXISTS(SELECT 1 FROM public.nodes WHERE name=btrim(p_setup->>'controller_name') AND id IS DISTINCT FROM target) THEN RAISE EXCEPTION 'This device name already exists'; END IF;
  IF nullif(p_setup->>'room_id','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.rooms WHERE id=p_setup->>'room_id') THEN RAISE EXCEPTION 'Choose an existing room'; END IF;
  IF EXISTS(SELECT 1 FROM public.aircons WHERE controller_node_id=target OR node_id IN(target,p_device_id,n.name)) THEN
   RAISE EXCEPTION 'Unassign this device from AC control before registering it for monitoring only'; END IF;
  IF p_setup->>'assignment_mode'='existing' THEN
   SELECT * INTO ac FROM public.aircons WHERE id=p_setup->>'aircon_id';
   IF ac.id IS NULL THEN RAISE EXCEPTION 'Select an existing AC'; END IF;
  ELSIF p_setup->>'assignment_mode'='new' THEN
   IF length(btrim(coalesce(p_setup->>'asset_tag',''))) NOT BETWEEN 1 AND 64 OR p_setup->>'asset_tag' ~ '[<>[:cntrl:]]' THEN RAISE EXCEPTION 'Enter an AC name'; END IF;
   IF EXISTS(SELECT 1 FROM public.aircons WHERE lower(asset_tag)=lower(btrim(p_setup->>'asset_tag')) AND id IS DISTINCT FROM n.monitor_aircon_id) THEN RAISE EXCEPTION 'This AC exists. Select its existing profile'; END IF;
  ELSE RAISE EXCEPTION 'Assign an air conditioner'; END IF;
 END IF;
 IF role_name IN ('monitoring','both') THEN
  config:=p_setup->'sensor_config';
  IF jsonb_typeof(config) IS DISTINCT FROM 'object'
   OR config->'temperature' IS DISTINCT FROM 'true'::jsonb
   OR config->'rotation_rpm' IS DISTINCT FROM 'true'::jsonb
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(config) field WHERE field NOT IN ('temperature','rotation_rpm'))
   THEN RAISE EXCEPTION 'Enable temperature and rotation monitoring'; END IF;
  IF EXISTS(SELECT 1 FROM public.nodes WHERE monitor_aircon_id=p_setup->>'aircon_id' AND id IS DISTINCT FROM target AND device_mode IN ('monitoring','both')) THEN
   RAISE EXCEPTION 'This AC already has a monitoring device'; END IF;
 END IF;
 RETURN jsonb_build_object('valid',true,'node_id',target,'device_mode',role_name);
END $$;
REVOKE ALL ON FUNCTION public.ecotrack_validate_ac_device_assignment(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ecotrack_validate_ac_device_assignment(text,jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.ecotrack_device_exchange(p_device_id text,p_token text,p_status jsonb,p_ack jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE target text; n public.nodes; c public.ecotrack_device_commands; ack_id uuid; sleep_until timestamptz; latest jsonb; cfg jsonb; seconds numeric; ack_status text; measured_t numeric; measured_rpm numeric; measured_at timestamptz; rotation_quality text; boot_identity text; sample_sequence bigint; measured_interval numeric;
BEGIN
 SELECT node_id INTO target FROM ecotrack_private.device_credentials WHERE device_id=p_device_id AND p_token ~ '^[a-f0-9]{64}$' AND token_hash=sha256(convert_to(p_token,'UTF8'));
 IF target IS NULL THEN RAISE EXCEPTION 'Invalid device credential' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_status) IS DISTINCT FROM 'object' OR jsonb_typeof(p_status->'capabilities') IS DISTINCT FROM 'object' OR jsonb_typeof(p_status->'capabilities'->'ir_receiver') IS DISTINCT FROM 'boolean' OR jsonb_typeof(p_status->'capabilities'->'ir_transmitter') IS DISTINCT FROM 'boolean' OR octet_length(p_status::text)>16000 THEN RAISE EXCEPTION 'Invalid device status'; END IF;
 IF p_status->'applied_config'->'interval_seconds' IS NOT NULL AND p_status->'applied_config'->'interval_seconds'<>'null'::jsonb THEN
  IF jsonb_typeof(p_status->'applied_config'->'interval_seconds')<>'number' THEN RAISE EXCEPTION 'Invalid observed reporting interval'; END IF;
  measured_interval:=(p_status->'applied_config'->>'interval_seconds')::numeric;
  IF measured_interval NOT BETWEEN 1 AND 86400 THEN RAISE EXCEPTION 'Invalid observed reporting interval'; END IF;
 END IF;
 -- Measurements are optional, strictly typed, and independent of connectivity/AC commands.
 IF p_status->'outlet_temperature_c' IS NOT NULL AND p_status->'outlet_temperature_c'<>'null'::jsonb THEN
  IF jsonb_typeof(p_status->'outlet_temperature_c')<>'number' THEN RAISE EXCEPTION 'Invalid measured temperature'; END IF;
  measured_t:=(p_status->>'outlet_temperature_c')::numeric;
  IF measured_t NOT BETWEEN -40 AND 125 THEN RAISE EXCEPTION 'Invalid measured temperature'; END IF;
 END IF;
 IF p_status->'rotation_rpm' IS NOT NULL AND p_status->'rotation_rpm'<>'null'::jsonb THEN
  IF jsonb_typeof(p_status->'rotation_rpm')<>'number' THEN RAISE EXCEPTION 'Invalid measured rotation'; END IF;
  measured_rpm:=(p_status->>'rotation_rpm')::numeric;
  IF measured_rpm<0 OR measured_rpm>1000000 THEN RAISE EXCEPTION 'Invalid measured rotation'; END IF;
 END IF;
 rotation_quality:=p_status->>'rotation_quality';
 IF rotation_quality IS NOT NULL AND rotation_quality NOT IN ('ok','missing','fault') THEN RAISE EXCEPTION 'Invalid rotation quality'; END IF;
 IF rotation_quality IN ('missing','fault') THEN measured_rpm:=NULL; END IF;
 IF rotation_quality='ok' AND measured_rpm IS NULL THEN RAISE EXCEPTION 'Rotation quality requires a measurement'; END IF;
 IF p_status->>'observed_at' IS NOT NULL THEN
  IF p_status->>'observed_at' !~ 'Z$|[+-][0-9]{2}:[0-9]{2}$' THEN RAISE EXCEPTION 'Observation time requires timezone'; END IF;
  measured_at:=(p_status->>'observed_at')::timestamptz;
  IF measured_at<'1970-01-01'::timestamptz OR measured_at>now()+interval '5 minutes' THEN RAISE EXCEPTION 'Invalid observation time'; END IF;
 END IF;
 IF measured_at IS NULL THEN measured_t:=NULL; measured_rpm:=NULL; rotation_quality:='missing'; END IF;
 boot_identity:=p_status->>'boot_id';
 IF boot_identity IS NOT NULL AND (length(boot_identity) NOT BETWEEN 1 AND 80 OR boot_identity !~ '^[A-Za-z0-9_-]+$') THEN RAISE EXCEPTION 'Invalid observation boot identity'; END IF;
 IF p_status->>'sequence' IS NOT NULL THEN
  IF jsonb_typeof(p_status->'sequence')<>'number' OR (p_status->>'sequence') !~ '^[0-9]{1,10}$' THEN RAISE EXCEPTION 'Invalid observation sequence'; END IF;
  sample_sequence:=(p_status->>'sequence')::bigint;
 END IF;
 sleep_until := nullif(p_status->>'sleeping_until','')::timestamptz;
 IF sleep_until IS NOT NULL AND (sleep_until<now()-interval '5 seconds' OR sleep_until>now()+interval '1 day 5 minutes') THEN RAISE EXCEPTION 'Invalid sleep deadline'; END IF;
 IF p_status ? 'latest_ir' THEN
  latest := p_status->'latest_ir';
  IF jsonb_typeof(latest) IS DISTINCT FROM 'object' OR coalesce(latest->>'raw_data','') !~ '^[0-9]+(,[0-9]+)+$' OR coalesce(latest->>'protocol','')='' OR octet_length(latest::text)>12000 THEN RAISE EXCEPTION 'Invalid IR capture'; END IF;
  latest := latest || jsonb_build_object('received_at',now(),'node_id',target);
 END IF;
 IF p_ack IS NOT NULL AND p_ack<>'null'::jsonb THEN
  IF jsonb_typeof(p_ack) IS DISTINCT FROM 'object' OR jsonb_typeof(p_ack->'success') IS DISTINCT FROM 'boolean' OR octet_length(p_ack::text)>14000 THEN RAISE EXCEPTION 'Invalid device acknowledgement'; END IF;
  ack_id := (p_ack->>'command_id')::uuid;
  SELECT * INTO c FROM public.ecotrack_device_commands WHERE id=ack_id AND node_id=target FOR UPDATE;
  IF ack_id IS NULL THEN RAISE EXCEPTION 'Invalid device acknowledgement'; END IF;
  IF c.id IS NULL AND EXISTS(SELECT 1 FROM public.ecotrack_device_commands WHERE id=ack_id) THEN
   RAISE EXCEPTION 'Command does not belong to this device' USING ERRCODE='42501';
  END IF;
  -- A valid device may retry an old ACK after its terminal row was cleaned.
  -- An absent row is ignored; it cannot recreate a command or update an AC result.
  IF c.status='queued' THEN RAISE EXCEPTION 'Command has not been claimed'; END IF;
  IF c.status='claimed' AND c.expires_at>now() THEN
   IF c.kind='learn_ir' AND (p_ack->>'success')::boolean AND (coalesce(p_ack->>'raw_data','') !~ '^[0-9]+(,[0-9]+)+$' OR coalesce(p_ack->>'protocol','')='' OR coalesce(p_ack->>'hex','')='') THEN RAISE EXCEPTION 'Actual IR capture acknowledgement required'; END IF;
   IF c.kind='configure' AND (p_ack->>'success')::boolean AND (jsonb_typeof(p_ack->'interval_ms') IS DISTINCT FROM 'number' OR (p_ack->>'interval_ms')::numeric<>(c.payload->>'interval_seconds')::numeric*1000 OR p_ack->>'wake_time' IS DISTINCT FROM c.payload->>'wake_time' OR p_ack->>'sleep_time' IS DISTINCT FROM c.payload->>'sleep_time') THEN RAISE EXCEPTION 'Applied schedule acknowledgement does not match request'; END IF;
   IF c.kind='ac_intent' AND (p_ack->>'success')::boolean AND coalesce(p_ack->>'delivery_status','')<>'transmitted' THEN RAISE EXCEPTION 'IR transmission acknowledgement required'; END IF;
   ack_status := CASE WHEN (p_ack->>'success')::boolean THEN 'completed' ELSE 'failed' END;
   UPDATE public.ecotrack_device_commands SET status=ack_status,result=p_ack,acknowledged_at=now() WHERE id=c.id;
   IF c.kind='ac_intent' THEN
    UPDATE public.aircons SET command_status=CASE WHEN ack_status='completed' THEN 'transmitted' ELSE 'failed' END,command_status_at=now() WHERE id=c.payload->>'aircon_id' AND command_id::text=c.id::text;
   END IF;
  END IF;
 END IF;
 INSERT INTO public.ecotrack_device_state(node_id,device_id,last_seen,sleeping_until,firmware_version,wifi_ssid,ip_address,rssi,capabilities,latest_ir,applied_config)
 VALUES(target,p_device_id,now(),sleep_until,left(p_status->>'firmware_version',80),left(p_status->>'wifi_ssid',32),left(p_status->>'ip_address',64),(p_status->>'rssi')::integer,coalesce(p_status->'capabilities','{}'),latest,p_status->'applied_config')
 ON CONFLICT(node_id) DO UPDATE SET last_seen=now(),sleeping_until=EXCLUDED.sleeping_until,firmware_version=EXCLUDED.firmware_version,wifi_ssid=EXCLUDED.wifi_ssid,ip_address=EXCLUDED.ip_address,rssi=EXCLUDED.rssi,capabilities=EXCLUDED.capabilities,latest_ir=coalesce(EXCLUDED.latest_ir,ecotrack_device_state.latest_ir),applied_config=EXCLUDED.applied_config;
 UPDATE public.nodes SET status=CASE WHEN sleep_until IS NULL THEN 'online' ELSE 'offline' END,rssi=(p_status->>'rssi')::numeric,ip_address=nullif(p_status->>'ip_address',''),wifi_ssid=nullif(p_status->>'wifi_ssid',''),updated=now() WHERE id=target;
 UPDATE public.ecotrack_device_commands SET status='expired',result=jsonb_build_object('success',false,'error','Command expired before completion') WHERE node_id=target AND status IN ('queued','claimed') AND expires_at<=now();
 UPDATE public.aircons a SET command_status='failed',command_status_at=now() FROM public.ecotrack_device_commands d WHERE d.node_id=target AND d.kind='ac_intent' AND d.status='expired' AND a.id=d.payload->>'aircon_id' AND a.command_id::text=d.id::text AND a.command_status='queued';
 SELECT * INTO n FROM public.nodes WHERE id=target;
 seconds := n.interval_val * CASE lower(n.interval_unit) WHEN 'seconds' THEN 1 WHEN 'minutes' THEN 60 WHEN 'hours' THEN 3600 ELSE 0 END;
 IF seconds IS NULL OR seconds<1 OR seconds>86400 THEN seconds:=5; END IF;
 cfg := jsonb_build_object('interval_seconds',seconds::integer,'wake_time',n.wake_time,'sleep_time',n.sleep_time,'timezone_offset_seconds',28800);
 IF p_status ? 'report_id' THEN
  IF coalesce(p_status->>'report_id','') !~ ('^' || p_device_id || '-[0-9]{1,10}-[0-9]{1,10}$') THEN RAISE EXCEPTION 'Invalid connectivity report ID'; END IF;
  INSERT INTO public.telemetry(id,node_id,sensor_name,room_name,aircon_type,temperature,rotation_rpm,rotation_quality,observed_at,boot_id,sequence,battery,rssi,status,created,interval_seconds,ac_on)
  VALUES('cloud_' || (p_status->>'report_id'),target,n.name,(SELECT name FROM public.rooms WHERE id=n.room_id),n.aircon_type,
   measured_t,measured_rpm,coalesce(rotation_quality,CASE WHEN measured_rpm IS NULL THEN 'missing' ELSE 'ok' END),measured_at,boot_identity,sample_sequence,
   NULL,(p_status->>'rssi')::numeric,'online',coalesce(measured_at,now()),measured_interval,NULL)
  ON CONFLICT(id) DO NOTHING;
  UPDATE public.nodes SET temp=measured_t,rotation_rpm=measured_rpm WHERE id=target;

 END IF;
 c := NULL;
 IF sleep_until IS NULL THEN
  -- A single in-flight command per device; re-deliver after a reconnect until acknowledged.
  SELECT * INTO c FROM public.ecotrack_device_commands WHERE node_id=target AND status='claimed' ORDER BY created_at,id LIMIT 1 FOR UPDATE;
  IF c.id IS NULL THEN
   SELECT * INTO c FROM public.ecotrack_device_commands WHERE node_id=target AND status='queued' AND expires_at>now() ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED;
   IF c.id IS NOT NULL THEN UPDATE public.ecotrack_device_commands SET status='claimed',claimed_at=now() WHERE id=c.id RETURNING * INTO c; END IF;
  END IF;
 END IF;
 RETURN jsonb_build_object('success',true,'node_id',target,'server_time',now(),'config',cfg,'command',CASE WHEN c.id IS NULL THEN NULL ELSE to_jsonb(c) || jsonb_build_object('created_at_epoch_ms',(extract(epoch FROM c.created_at)*1000)::bigint) END);
END $$;
REVOKE ALL ON FUNCTION public.ecotrack_device_exchange(text,text,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ecotrack_device_exchange(text,text,jsonb,jsonb) TO anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
