-- EcoTrack reviewed delivery: live IR, registration, saved deployment dates,
-- independent custom AC/controller names and protocol/model capabilities.
-- Run the complete file as the project owner in Supabase SQL Editor.
-- Pause ESP32/cloud writers and close the desktop app for this short migration.
-- Prerequisite: the existing EcoTrack schema and cloud hardware migration are installed.
-- Does not recreate devices, rotate credentials or remove valid commands.
-- Existing command-retention triggers and scheduled cleanup remain installed.
-- All five sections commit together. A failure rolls back this entire run.
-- NOWAIT stops immediately if a required table is busy; retry the complete file.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
DO $$ BEGIN
 IF to_regclass('public.ecotrack_device_state') IS NULL
    OR to_regclass('public.aircons') IS NULL
    OR to_regclass('public.nodes') IS NULL
    OR to_regprocedure('public.ecotrack_is_admin()') IS NULL THEN
  RAISE EXCEPTION 'Install the existing EcoTrack schema and supabase_cloud_hardware_migration.sql first';
 END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('ecotrack:multi-brand-delivery',0)) THEN
  RAISE EXCEPTION 'Another EcoTrack migration is running; retry after it finishes'
   USING ERRCODE='55P03';
 END IF;
 -- Acquire the strongest required locks before any DDL. Never wait while
 -- holding one table and requesting another table used by a live device RPC.
 BEGIN
  LOCK TABLE public.aircons, public.ecotrack_device_state, public.nodes
   IN ACCESS EXCLUSIVE MODE NOWAIT;
  IF to_regclass('realtime.messages') IS NOT NULL
     AND to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NOT NULL
     AND to_regprocedure('realtime.topic()') IS NOT NULL THEN
   LOCK TABLE realtime.messages IN ACCESS EXCLUSIVE MODE NOWAIT;
  END IF;
 EXCEPTION WHEN lock_not_available THEN
  RAISE EXCEPTION 'EcoTrack tables are busy; migration stopped before changing data'
   USING ERRCODE='55P03',
    HINT='Pause ESP32/cloud writers, close the desktop app, then run this complete file again.';
 END;
END $$;

-- Section: supabase_ir_realtime_migration.sql
-- EcoTrack immediate IR observations and private hardware Broadcast.
-- Run after supabase_cloud_hardware_migration.sql. Safe to run again.
-- Existing heartbeat/command RPCs and old receiver sketches remain compatible.
DO $$ BEGIN
 IF to_regclass('public.ecotrack_device_state') IS NULL OR to_regprocedure('public.ecotrack_is_admin()') IS NULL THEN
  RAISE EXCEPTION 'Install supabase_cloud_hardware_migration.sql first';
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.ecotrack_device_observe(p_device_id text,p_token text,p_observation jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE target text; current_state public.ecotrack_device_state; latest jsonb; field text; seen timestamptz;
BEGIN
 SELECT node_id INTO target FROM ecotrack_private.device_credentials
 WHERE device_id=p_device_id AND p_token ~ '^[a-f0-9]{64}$' AND token_hash=sha256(convert_to(p_token,'UTF8'));
 IF target IS NULL THEN RAISE EXCEPTION 'Invalid device credential' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_observation) IS DISTINCT FROM 'object' OR octet_length(p_observation::text)>4000
  OR p_observation ? 'raw_data' OR p_observation ? 'last_decoded'
  OR coalesce(p_observation->>'protocol','') !~ '^[A-Z][A-Z0-9_]{1,48}$' OR p_observation->>'protocol'='UNKNOWN'
  OR p_observation->>'frame_kind' IS DISTINCT FROM 'full_state'
  OR jsonb_typeof(p_observation->'raw_count') IS DISTINCT FROM 'number'
  OR coalesce(p_observation->>'raw_count','') !~ '^[1-9][0-9]{0,3}$'
  OR jsonb_typeof(p_observation->'sequence') IS DISTINCT FROM 'number'
  OR coalesce(p_observation->>'sequence','') !~ '^[0-9]{1,10}$'
  OR jsonb_typeof(p_observation->'boot_count') IS DISTINCT FROM 'number'
  OR coalesce(p_observation->>'boot_count','') !~ '^[0-9]{1,10}$'
  OR jsonb_typeof(p_observation->'state') IS DISTINCT FROM 'object'
  OR jsonb_typeof(p_observation->'state'->'power') IS DISTINCT FROM 'boolean'
  OR jsonb_typeof(p_observation->'state'->'temp') IS DISTINCT FROM 'number'
  OR coalesce(p_observation->'state'->>'mode','') NOT IN ('cool','dry','fan','auto','heat')
  OR coalesce(p_observation->'state'->>'fan','') NOT IN ('auto','low','medium','high','quiet','silent','turbo')
  OR p_observation->'state'->>'source' IS DISTINCT FROM 'ir_receiver' THEN
  RAISE EXCEPTION 'Invalid decoded IR observation';
 END IF;
 IF (p_observation->'state'->>'temp')::numeric NOT BETWEEN 0 AND 50 THEN RAISE EXCEPTION 'Invalid IR temperature'; END IF;
 FOREACH field IN ARRAY ARRAY['turbo','swing','eco','sleep'] LOOP
  IF p_observation->'state' ? field AND jsonb_typeof(p_observation->'state'->field) IS DISTINCT FROM 'boolean' THEN
   RAISE EXCEPTION 'Invalid IR feature';
  END IF;
 END LOOP;
 IF p_observation ? 'captured_at_epoch_ms' AND
  (jsonb_typeof(p_observation->'captured_at_epoch_ms') IS DISTINCT FROM 'number' OR
   coalesce(p_observation->>'captured_at_epoch_ms','') !~ '^[0-9]{13}$') THEN RAISE EXCEPTION 'Invalid IR capture timestamp'; END IF;
 SELECT * INTO current_state FROM public.ecotrack_device_state WHERE node_id=target AND device_id=p_device_id FOR UPDATE;
 IF current_state.node_id IS NULL THEN RAISE EXCEPTION 'Register this controller first'; END IF;
 -- Capture time also rejects an old boot's delayed upload after a newer boot has reported.
 IF coalesce(current_state.latest_ir->>'captured_at_epoch_ms','') ~ '^[0-9]{13}$'
  AND coalesce(p_observation->>'captured_at_epoch_ms','') ~ '^[0-9]{13}$'
  AND (current_state.latest_ir->>'captured_at_epoch_ms')::numeric > (p_observation->>'captured_at_epoch_ms')::numeric THEN
  RETURN jsonb_build_object('success',true,'node_id',target,'duplicate',true,'server_time',clock_timestamp());
 END IF;
 -- Retried or reordered uploads from one boot cannot roll back newer receiver state.
 IF current_state.latest_ir->>'boot_count'=p_observation->>'boot_count'
  AND coalesce(current_state.latest_ir->>'sequence','') ~ '^[0-9]{1,10}$'
  AND (current_state.latest_ir->>'sequence')::numeric >= (p_observation->>'sequence')::numeric THEN
  RETURN jsonb_build_object('success',true,'node_id',target,'duplicate',true,'server_time',clock_timestamp());
 END IF;
 seen := clock_timestamp();
 latest := p_observation || jsonb_build_object('received_at',seen,'node_id',target);
 UPDATE public.ecotrack_device_state SET latest_ir=latest,last_seen=seen,sleeping_until=NULL WHERE node_id=target;
 RETURN jsonb_build_object('success',true,'node_id',target,'server_time',seen);
END $$;
REVOKE ALL ON FUNCTION public.ecotrack_device_observe(text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ecotrack_device_observe(text,text,jsonb) TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.ecotrack_broadcast_hardware_state()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE compact jsonb; payload jsonb;
BEGIN
 compact := NEW.latest_ir - 'raw_data';
 IF jsonb_typeof(compact->'last_decoded')='object' THEN
  compact := jsonb_set(compact,'{last_decoded}',(compact->'last_decoded')-'raw_data');
 END IF;
 payload := jsonb_build_object('version',1,'row',
  (to_jsonb(NEW)-'latest_ir') || jsonb_build_object('latest_ir',compact));
 BEGIN
  PERFORM realtime.send(payload,'device_state','ecotrack:hardware',true);
 EXCEPTION WHEN OTHERS THEN
  -- Persistence and Postgres Changes still work during a Broadcast service/configuration failure.
  RAISE WARNING 'EcoTrack hardware Broadcast unavailable: %',SQLERRM;
 END;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.ecotrack_broadcast_hardware_state() FROM PUBLIC,anon,authenticated;

DO $$ BEGIN
 IF to_regclass('realtime.messages') IS NOT NULL AND
  to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NOT NULL AND
  to_regprocedure('realtime.topic()') IS NOT NULL THEN
  -- Supabase already owns/enables RLS on realtime.messages; only add scoped policies.
  DROP POLICY IF EXISTS ecotrack_hardware_broadcast_admin_read ON realtime.messages;
  CREATE POLICY ecotrack_hardware_broadcast_admin_read ON realtime.messages FOR SELECT TO authenticated
   USING (extension='broadcast' AND (select realtime.topic())='ecotrack:hardware' AND public.ecotrack_is_admin());
  DROP POLICY IF EXISTS ecotrack_hardware_broadcast_read_guard ON realtime.messages;
  CREATE POLICY ecotrack_hardware_broadcast_read_guard ON realtime.messages AS RESTRICTIVE FOR SELECT TO anon,authenticated
   USING ((select realtime.topic())<>'ecotrack:hardware' OR public.ecotrack_is_admin());
  DROP POLICY IF EXISTS ecotrack_hardware_broadcast_write_guard ON realtime.messages;
  CREATE POLICY ecotrack_hardware_broadcast_write_guard ON realtime.messages AS RESTRICTIVE FOR INSERT TO anon,authenticated
   WITH CHECK ((select realtime.topic())<>'ecotrack:hardware');
  DROP TRIGGER IF EXISTS ecotrack_hardware_broadcast ON public.ecotrack_device_state;
  CREATE TRIGGER ecotrack_hardware_broadcast AFTER INSERT OR UPDATE ON public.ecotrack_device_state
   FOR EACH ROW EXECUTE FUNCTION public.ecotrack_broadcast_hardware_state();
 ELSE
  RAISE NOTICE 'Supabase Broadcast is unavailable; immediate observations use Postgres Changes.';
 END IF;
END $$;
NOTIFY pgrst, 'reload schema';

-- Section: supabase_controller_registration_migration.sql
-- Registration modal: validated assignment, metadata-safe credential refresh, atomic final save.
-- Prerequisites: supabase_cloud_hardware_migration.sql, supabase_device_nodes_sync_migration.sql,
-- and supabase_aircons_protocol_migration.sql. Uses existing tables and columns. Repeatable.
DO $$ BEGIN
 IF to_regclass('ecotrack_private.device_credentials') IS NULL OR to_regclass('public.ecotrack_device_state') IS NULL THEN
  RAISE EXCEPTION 'Install the existing cloud hardware migration first';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='nodes' AND column_name='protocol_name')
  OR NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='aircons' AND column_name='controller_node_id') THEN
  RAISE EXCEPTION 'Install supabase_device_nodes_sync_migration.sql and supabase_aircons_protocol_migration.sql first';
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.ecotrack_validate_controller_assignment(p_device_id text,p_setup jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE target text; n public.nodes; ac public.aircons; mode text; tag text; kind text; brand text; proto text; owner public.aircons;
BEGIN
 IF auth.uid() IS NULL OR NOT public.ecotrack_is_admin() THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501'; END IF;
 IF coalesce(p_device_id,'') !~ '^esp32s3-[a-f0-9]{12}$' OR jsonb_typeof(p_setup) IS DISTINCT FROM 'object' OR octet_length(p_setup::text)>4000 THEN RAISE EXCEPTION 'Invalid controller setup'; END IF;
 IF length(btrim(coalesce(p_setup->>'controller_name',''))) NOT BETWEEN 1 AND 100 OR coalesce(p_setup->>'controller_name','') ~ '[[:cntrl:]<>]' THEN RAISE EXCEPTION 'Enter a valid controller name (1..100 characters)'; END IF;
 mode:=p_setup->>'assignment_mode'; tag:=btrim(coalesce(p_setup->>'asset_tag',''));
 kind:=btrim(coalesce(p_setup->>'aircon_type','')); brand:=btrim(coalesce(p_setup->>'brand','')); proto:=nullif(btrim(coalesce(p_setup->>'protocol_name','')),'');
 IF mode IS NULL OR mode NOT IN ('existing','new') THEN RAISE EXCEPTION 'Assign an air conditioner before saving'; END IF;
 IF length(kind) NOT BETWEEN 1 AND 100 OR kind='__custom__' OR kind ~ '[[:cntrl:]<>]' THEN RAISE EXCEPTION 'Enter a valid AC type (1..100 characters)'; END IF;
 IF length(brand)>80 OR brand ~ '[[:cntrl:]<>]' THEN RAISE EXCEPTION 'Invalid manufacturer'; END IF;
 IF proto IS NOT NULL AND proto !~ '^[A-Za-z0-9_]{1,64}$' THEN RAISE EXCEPTION 'Invalid IR protocol'; END IF;
 IF nullif(p_setup->>'room_id','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.rooms WHERE id=p_setup->>'room_id') THEN RAISE EXCEPTION 'The selected room is no longer available'; END IF;
 SELECT node_id INTO target FROM ecotrack_private.device_credentials WHERE device_id=p_device_id;
 IF target IS NULL THEN SELECT node_id INTO target FROM public.ecotrack_device_state WHERE device_id=p_device_id; END IF;
 IF target IS NULL THEN SELECT id INTO target FROM public.nodes WHERE name=p_device_id; END IF;
 SELECT * INTO n FROM public.nodes WHERE id=target;
 IF EXISTS(SELECT 1 FROM public.nodes WHERE name=btrim(p_setup->>'controller_name') AND id IS DISTINCT FROM target) THEN RAISE EXCEPTION 'This controller name already exists'; END IF;
 IF mode='existing' THEN
  SELECT * INTO ac FROM public.aircons WHERE id=p_setup->>'aircon_id';
  IF ac.id IS NULL THEN RAISE EXCEPTION 'Select an available AC profile'; END IF;
  IF (nullif(ac.node_id,'') IS NOT NULL AND ac.node_id IS DISTINCT FROM target AND ac.node_id IS DISTINCT FROM p_device_id AND ac.node_id IS DISTINCT FROM n.name)
   OR (nullif(ac.controller_node_id,'') IS NOT NULL AND ac.controller_node_id IS DISTINCT FROM target) THEN
   RAISE EXCEPTION 'This AC profile is assigned to another controller';
  END IF;
 ELSE
  IF length(tag) NOT BETWEEN 1 AND 64 OR tag ~ '[[:cntrl:]<>]' THEN RAISE EXCEPTION 'Enter an AC name of 1..64 characters'; END IF;
  SELECT * INTO ac FROM public.aircons WHERE lower(asset_tag)=lower(tag) LIMIT 1;
  IF ac.id IS NOT NULL AND (target IS NULL OR ac.controller_node_id IS DISTINCT FROM target OR ac.asset_tag<>tag) THEN
   RAISE EXCEPTION 'This AC name already exists. Choose its existing profile or use another name';
  END IF;
 END IF;
 IF target IS NOT NULL THEN
  SELECT * INTO owner FROM public.aircons WHERE controller_node_id=target OR node_id IN(target,p_device_id,n.name) LIMIT 1;
  IF owner.id IS NOT NULL AND owner.id IS DISTINCT FROM ac.id THEN RAISE EXCEPTION 'Keep the AC already assigned to this controller, or unassign it first'; END IF;
 END IF;
 RETURN jsonb_build_object('valid',true,'node_id',target,'aircon_id',ac.id);
END $$;

CREATE OR REPLACE FUNCTION public.ecotrack_prepare_controller_registration(p_device_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE n public.nodes; target text; token text;
BEGIN
 IF auth.uid() IS NULL OR NOT public.ecotrack_is_admin() THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501'; END IF;
 IF coalesce(p_device_id,'') !~ '^esp32s3-[a-f0-9]{12}$' THEN RAISE EXCEPTION 'Invalid controller identity'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_device_id,0));
 SELECT node_id INTO target FROM ecotrack_private.device_credentials WHERE device_id=p_device_id;
 IF target IS NULL THEN SELECT node_id INTO target FROM public.ecotrack_device_state WHERE device_id=p_device_id; END IF;
 IF target IS NULL THEN SELECT id INTO target FROM public.nodes WHERE name=p_device_id; END IF;
 IF target IS NULL THEN
  INSERT INTO public.nodes(name,status,room_id,brand,aircon_type,temp,rssi,battery,interval_val,interval_unit)
   VALUES(p_device_id,'offline',NULL,NULL,NULL,NULL,NULL,NULL,5,'Seconds') RETURNING * INTO n;
 ELSE SELECT * INTO n FROM public.nodes WHERE id=target FOR UPDATE;
 END IF;
 IF n.id IS NULL THEN RAISE EXCEPTION 'Controller registration was removed. Reconnect and retry'; END IF;
 token:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
 INSERT INTO ecotrack_private.device_credentials(device_id,node_id,token_hash)
  VALUES(p_device_id,n.id,sha256(convert_to(token,'UTF8')))
 ON CONFLICT(device_id) DO UPDATE SET token_hash=EXCLUDED.token_hash,issued_at=clock_timestamp();
 INSERT INTO public.ecotrack_device_state(node_id,device_id) VALUES(n.id,p_device_id) ON CONFLICT(node_id) DO NOTHING;
 RETURN jsonb_build_object('node',to_jsonb(n),'device_id',p_device_id,'device_token',token);
END $$;

CREATE OR REPLACE FUNCTION public.ecotrack_finish_controller_registration(p_node_id text,p_device_id text,p_setup jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE n public.nodes; ac public.aircons; state public.ecotrack_device_state; tag text; saved_brand text; kind text; proto text; owners integer;
BEGIN
 IF auth.uid() IS NULL OR NOT public.ecotrack_is_admin() THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501'; END IF;
 -- This is the same lock used by credential issuance; concurrent retries retain one identity.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_device_id,0));
 IF NOT EXISTS(SELECT 1 FROM ecotrack_private.device_credentials WHERE device_id=p_device_id AND node_id=p_node_id) THEN RAISE EXCEPTION 'The controller identity does not match its cloud registration'; END IF;
 SELECT * INTO n FROM public.nodes WHERE id=p_node_id FOR UPDATE;
 IF n.id IS NULL THEN RAISE EXCEPTION 'The controller registration was removed'; END IF;
 PERFORM public.ecotrack_validate_controller_assignment(p_device_id,p_setup);
 IF p_setup->>'assignment_mode'='existing' THEN
  SELECT * INTO ac FROM public.aircons WHERE id=p_setup->>'aircon_id' FOR UPDATE;
 ELSE
  tag:=btrim(p_setup->>'asset_tag');
  PERFORM pg_advisory_xact_lock(hashtextextended('ac-name:'||lower(tag),0));
  SELECT * INTO ac FROM public.aircons WHERE lower(asset_tag)=lower(tag) FOR UPDATE;
 END IF;
 -- Recheck eligibility after the AC row/name lock; another controller may have claimed it.
 PERFORM public.ecotrack_validate_controller_assignment(p_device_id,p_setup);
 SELECT count(*) INTO owners FROM public.aircons WHERE (controller_node_id=p_node_id OR node_id IN(p_node_id,p_device_id,n.name)) AND id IS DISTINCT FROM ac.id;
 IF owners>0 THEN RAISE EXCEPTION 'This controller already has an AC assignment'; END IF;
 SELECT * INTO state FROM public.ecotrack_device_state WHERE node_id=p_node_id AND device_id=p_device_id;
 IF state.last_seen IS NULL OR state.last_seen<clock_timestamp()-interval '45 seconds' OR state.last_seen>clock_timestamp()+interval '5 seconds'
  OR state.sleeping_until>clock_timestamp() THEN RAISE EXCEPTION 'Verification pending: the ESP32 is not reporting an active cloud connection'; END IF;
 kind:=btrim(p_setup->>'aircon_type'); saved_brand:=coalesce(nullif(btrim(p_setup->>'brand'),''),ac.brand,'Unspecified');
 proto:=coalesce(nullif(btrim(p_setup->>'protocol_name'),''),ac.protocol_name,ac.protocol,'generic_ac');
 IF ac.id IS NULL THEN
  INSERT INTO public.aircons(asset_tag,brand,model,aircon_type,room_id,node_id,controller_node_id,protocol,protocol_name,status)
   VALUES(tag,saved_brand,kind,kind,nullif(p_setup->>'room_id',''),p_node_id,p_node_id,proto,proto,'online') RETURNING * INTO ac;
 ELSE
  UPDATE public.aircons SET brand=saved_brand,model=kind,aircon_type=kind,room_id=nullif(p_setup->>'room_id',''),
   node_id=p_node_id,controller_node_id=p_node_id,protocol=proto,protocol_name=proto,status='online',updated_at=clock_timestamp()
   WHERE id=ac.id RETURNING * INTO ac;
 END IF;
 UPDATE public.nodes SET name=btrim(p_setup->>'controller_name'),room_id=ac.room_id,brand=ac.brand,
  aircon_type=ac.aircon_type,protocol_name=ac.protocol_name,updated=clock_timestamp() WHERE id=p_node_id RETURNING * INTO n;
 RETURN jsonb_build_object('success',true,'registered',true,'connected',true,'node',to_jsonb(n),'aircon',to_jsonb(ac),'cloud_state',to_jsonb(state));
END $$;
REVOKE ALL ON FUNCTION public.ecotrack_validate_controller_assignment(text,jsonb),public.ecotrack_prepare_controller_registration(text),
 public.ecotrack_finish_controller_registration(text,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ecotrack_validate_controller_assignment(text,jsonb),public.ecotrack_prepare_controller_registration(text),
 public.ecotrack_finish_controller_registration(text,text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.ecotrack_controller_registration_status(p_device_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, ecotrack_private AS $$
DECLARE device ecotrack_private.device_credentials%ROWTYPE; controller public.nodes%ROWTYPE;
  cloud public.ecotrack_device_state%ROWTYPE; assigned public.aircons%ROWTYPE; target text; needs_credentials boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT public.ecotrack_is_admin() THEN RAISE EXCEPTION 'Admin access required'; END IF;
  IF coalesce(p_device_id,'') !~ '^esp32s3-[a-f0-9]{12}$' THEN RAISE EXCEPTION 'Invalid controller identity'; END IF;
  SELECT * INTO device FROM ecotrack_private.device_credentials WHERE device_id=p_device_id;
  needs_credentials:=NOT FOUND;target:=device.node_id;
  IF target IS NULL THEN SELECT node_id INTO target FROM public.ecotrack_device_state WHERE device_id=p_device_id; END IF;
  IF target IS NULL THEN SELECT id INTO target FROM public.nodes WHERE name=p_device_id; END IF;
  SELECT * INTO controller FROM public.nodes WHERE id=target;
  IF NOT FOUND THEN RETURN jsonb_build_object('requires_credentials',true); END IF;
  SELECT * INTO cloud FROM public.ecotrack_device_state WHERE node_id=target AND device_id=p_device_id;
  SELECT * INTO assigned FROM public.aircons WHERE controller_node_id=target OR node_id IN(target,p_device_id,controller.name) LIMIT 1;
  RETURN jsonb_build_object('requires_credentials',needs_credentials,'node',to_jsonb(controller),'cloud_state',to_jsonb(cloud),'aircon',to_jsonb(assigned));
END $$;
REVOKE ALL ON FUNCTION public.ecotrack_controller_registration_status(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ecotrack_controller_registration_status(text) TO authenticated;

NOTIFY pgrst,'reload schema';

-- Section: supabase_controller_details_migration.sql
-- Add after supabase_controller_registration_migration.sql. Idempotent and additive.
-- Existing devices retain NULL until an admin actually saves/verifies them.
ALTER TABLE public.nodes ADD COLUMN IF NOT EXISTS admin_verified_at timestamptz;
ALTER TABLE public.nodes ADD COLUMN IF NOT EXISTS admin_verified_by uuid;
ALTER TABLE public.nodes ADD COLUMN IF NOT EXISTS deployment_saved_at timestamptz;

CREATE OR REPLACE FUNCTION public.ecotrack_stamp_controller_deployment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.admin_verified_at IS NOT NULL OR NEW.admin_verified_by IS NOT NULL OR NEW.deployment_saved_at IS NOT NULL THEN
   RAISE EXCEPTION 'Use Save & Verify to record admin verification' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
 END IF;
 IF (NEW.admin_verified_at IS DISTINCT FROM OLD.admin_verified_at OR NEW.admin_verified_by IS DISTINCT FROM OLD.admin_verified_by)
    AND coalesce(current_setting('ecotrack.registration_verify',true),'')<>'on' THEN
   RAISE EXCEPTION 'Use Save & Verify to record admin verification' USING ERRCODE='42501';
 END IF;
 IF coalesce(current_setting('ecotrack.registration_verify',true),'')<>'on' THEN
   NEW.deployment_saved_at:=OLD.deployment_saved_at;
   IF NEW.room_id IS DISTINCT FROM OLD.room_id AND auth.uid() IS NOT NULL AND public.ecotrack_is_admin() THEN
     NEW.deployment_saved_at:=clock_timestamp();
   END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.ecotrack_stamp_controller_deployment() FROM PUBLIC;
DROP TRIGGER IF EXISTS ecotrack_controller_deployment_stamp ON public.nodes;
CREATE TRIGGER ecotrack_controller_deployment_stamp BEFORE INSERT OR UPDATE ON public.nodes
 FOR EACH ROW EXECUTE FUNCTION public.ecotrack_stamp_controller_deployment();
CREATE OR REPLACE FUNCTION public.ecotrack_finish_controller_registration(p_node_id text,p_device_id text,p_setup jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE n public.nodes; ac public.aircons; state public.ecotrack_device_state; tag text; saved_brand text; kind text; proto text; owners integer;
BEGIN
 IF auth.uid() IS NULL OR NOT public.ecotrack_is_admin() THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501'; END IF;
 -- This is the same lock used by credential issuance; concurrent retries retain one identity.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_device_id,0));
 IF NOT EXISTS(SELECT 1 FROM ecotrack_private.device_credentials WHERE device_id=p_device_id AND node_id=p_node_id) THEN RAISE EXCEPTION 'The controller identity does not match its cloud registration'; END IF;
 SELECT * INTO n FROM public.nodes WHERE id=p_node_id FOR UPDATE;
 IF n.id IS NULL THEN RAISE EXCEPTION 'The controller registration was removed'; END IF;
 PERFORM public.ecotrack_validate_controller_assignment(p_device_id,p_setup);
 IF p_setup->>'assignment_mode'='existing' THEN
  SELECT * INTO ac FROM public.aircons WHERE id=p_setup->>'aircon_id' FOR UPDATE;
 ELSE
  tag:=btrim(p_setup->>'asset_tag');
  PERFORM pg_advisory_xact_lock(hashtextextended('ac-name:'||lower(tag),0));
  SELECT * INTO ac FROM public.aircons WHERE lower(asset_tag)=lower(tag) FOR UPDATE;
 END IF;
 -- Recheck eligibility after the AC row/name lock; another controller may have claimed it.
 PERFORM public.ecotrack_validate_controller_assignment(p_device_id,p_setup);
 SELECT count(*) INTO owners FROM public.aircons WHERE (controller_node_id=p_node_id OR node_id IN(p_node_id,p_device_id,n.name)) AND id IS DISTINCT FROM ac.id;
 IF owners>0 THEN RAISE EXCEPTION 'This controller already has an AC assignment'; END IF;
 SELECT * INTO state FROM public.ecotrack_device_state WHERE node_id=p_node_id AND device_id=p_device_id;
 IF state.last_seen IS NULL OR state.last_seen<clock_timestamp()-interval '45 seconds' OR state.last_seen>clock_timestamp()+interval '5 seconds'
  OR state.sleeping_until>clock_timestamp() THEN RAISE EXCEPTION 'Verification pending: the ESP32 is not reporting an active cloud connection'; END IF;
 kind:=btrim(p_setup->>'aircon_type'); saved_brand:=coalesce(nullif(btrim(p_setup->>'brand'),''),ac.brand,'Unspecified');
 proto:=coalesce(nullif(btrim(p_setup->>'protocol_name'),''),ac.protocol_name,ac.protocol,'generic_ac');
 IF ac.id IS NULL THEN
  INSERT INTO public.aircons(asset_tag,brand,model,aircon_type,room_id,node_id,controller_node_id,protocol,protocol_name,status)
   VALUES(tag,saved_brand,kind,kind,nullif(p_setup->>'room_id',''),p_node_id,p_node_id,proto,proto,'online') RETURNING * INTO ac;
 ELSE
  UPDATE public.aircons SET brand=saved_brand,model=kind,aircon_type=kind,room_id=nullif(p_setup->>'room_id',''),
   node_id=p_node_id,controller_node_id=p_node_id,protocol=proto,protocol_name=proto,status='online',updated_at=clock_timestamp()
   WHERE id=ac.id RETURNING * INTO ac;
 END IF;
 PERFORM set_config('ecotrack.registration_verify','on',true);
 UPDATE public.nodes SET admin_verified_at=clock_timestamp(),admin_verified_by=auth.uid(),deployment_saved_at=clock_timestamp(),name=btrim(p_setup->>'controller_name'),room_id=ac.room_id,brand=ac.brand,
  aircon_type=ac.aircon_type,protocol_name=ac.protocol_name,updated=clock_timestamp() WHERE id=p_node_id RETURNING * INTO n;
 RETURN jsonb_build_object('success',true,'registered',true,'connected',true,'node',to_jsonb(n),'aircon',to_jsonb(ac),'cloud_state',to_jsonb(state));
END $$;
REVOKE ALL ON FUNCTION public.ecotrack_finish_controller_registration(text,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ecotrack_finish_controller_registration(text,text,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';

-- Section: supabase_aircon_names_migration.sql
-- Apply after supabase_controller_details_migration.sql. Display name does not change IDs or assignments.
ALTER TABLE public.aircons ADD COLUMN IF NOT EXISTS name text;
CREATE OR REPLACE FUNCTION public.ecotrack_validate_aircon_display_name()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.name IS NOT NULL AND (length(btrim(NEW.name)) NOT BETWEEN 1 AND 100 OR NEW.name ~ '[<>[:cntrl:]]') THEN RAISE EXCEPTION 'Enter a valid air conditioner name'; END IF;
 IF TG_OP='UPDATE' AND NEW.name IS DISTINCT FROM OLD.name AND auth.uid() IS NOT NULL AND NOT public.ecotrack_is_admin() THEN
  RAISE EXCEPTION 'Administrator required to rename an AC' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ecotrack_aircon_name_validate ON public.aircons;
CREATE TRIGGER ecotrack_aircon_name_validate BEFORE INSERT OR UPDATE ON public.aircons FOR EACH ROW EXECUTE FUNCTION public.ecotrack_validate_aircon_display_name();
CREATE OR REPLACE FUNCTION public.ecotrack_finish_controller_registration(p_node_id text,p_device_id text,p_setup jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE n public.nodes; ac public.aircons; state public.ecotrack_device_state; tag text; saved_brand text; kind text; proto text; owners integer;
BEGIN
 IF auth.uid() IS NULL OR NOT public.ecotrack_is_admin() THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501'; END IF;
 -- This is the same lock used by credential issuance; concurrent retries retain one identity.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_device_id,0));
 IF NOT EXISTS(SELECT 1 FROM ecotrack_private.device_credentials WHERE device_id=p_device_id AND node_id=p_node_id) THEN RAISE EXCEPTION 'The controller identity does not match its cloud registration'; END IF;
 SELECT * INTO n FROM public.nodes WHERE id=p_node_id FOR UPDATE;
 IF n.id IS NULL THEN RAISE EXCEPTION 'The controller registration was removed'; END IF;
 IF p_setup ? 'aircon_name' AND p_setup->'aircon_name'<>'null'::jsonb AND
   (jsonb_typeof(p_setup->'aircon_name')<>'string' OR length(btrim(p_setup->>'aircon_name')) NOT BETWEEN 1 AND 100 OR p_setup->>'aircon_name' ~ '[<>[:cntrl:]]') THEN RAISE EXCEPTION 'Enter a valid air conditioner name (1..100 characters)'; END IF;
 PERFORM public.ecotrack_validate_controller_assignment(p_device_id,p_setup);
 IF p_setup->>'assignment_mode'='existing' THEN
  SELECT * INTO ac FROM public.aircons WHERE id=p_setup->>'aircon_id' FOR UPDATE;
 ELSE
  tag:=btrim(p_setup->>'asset_tag');
  PERFORM pg_advisory_xact_lock(hashtextextended('ac-name:'||lower(tag),0));
  SELECT * INTO ac FROM public.aircons WHERE lower(asset_tag)=lower(tag) FOR UPDATE;
 END IF;
 -- Recheck eligibility after the AC row/name lock; another controller may have claimed it.
 PERFORM public.ecotrack_validate_controller_assignment(p_device_id,p_setup);
 SELECT count(*) INTO owners FROM public.aircons WHERE (controller_node_id=p_node_id OR node_id IN(p_node_id,p_device_id,n.name)) AND id IS DISTINCT FROM ac.id;
 IF owners>0 THEN RAISE EXCEPTION 'This controller already has an AC assignment'; END IF;
 SELECT * INTO state FROM public.ecotrack_device_state WHERE node_id=p_node_id AND device_id=p_device_id;
 IF state.last_seen IS NULL OR state.last_seen<clock_timestamp()-interval '45 seconds' OR state.last_seen>clock_timestamp()+interval '5 seconds'
  OR state.sleeping_until>clock_timestamp() THEN RAISE EXCEPTION 'Verification pending: the ESP32 is not reporting an active cloud connection'; END IF;
 kind:=btrim(p_setup->>'aircon_type'); saved_brand:=coalesce(nullif(btrim(p_setup->>'brand'),''),ac.brand,'Unspecified');
 proto:=coalesce(nullif(btrim(p_setup->>'protocol_name'),''),ac.protocol_name,ac.protocol,'generic_ac');
 IF ac.id IS NULL THEN
  INSERT INTO public.aircons(asset_tag,name,brand,model,aircon_type,room_id,node_id,controller_node_id,protocol,protocol_name,status)
   VALUES(tag,coalesce(nullif(btrim(p_setup->>'aircon_name'),''),tag),saved_brand,kind,kind,nullif(p_setup->>'room_id',''),p_node_id,p_node_id,proto,proto,'online') RETURNING * INTO ac;
 ELSE
  UPDATE public.aircons SET name=coalesce(nullif(btrim(p_setup->>'aircon_name'),''),ac.name,ac.asset_tag),brand=saved_brand,model=kind,aircon_type=kind,room_id=nullif(p_setup->>'room_id',''),
   node_id=p_node_id,controller_node_id=p_node_id,protocol=proto,protocol_name=proto,status='online',updated_at=clock_timestamp()
   WHERE id=ac.id RETURNING * INTO ac;
 END IF;
 PERFORM set_config('ecotrack.registration_verify','on',true);
 UPDATE public.nodes SET admin_verified_at=clock_timestamp(),admin_verified_by=auth.uid(),deployment_saved_at=clock_timestamp(),name=btrim(p_setup->>'controller_name'),room_id=ac.room_id,brand=ac.brand,
  aircon_type=ac.aircon_type,protocol_name=ac.protocol_name,updated=clock_timestamp() WHERE id=p_node_id RETURNING * INTO n;
 RETURN jsonb_build_object('success',true,'registered',true,'connected',true,'node',to_jsonb(n),'aircon',to_jsonb(ac),'cloud_state',to_jsonb(state));
END $$;
CREATE OR REPLACE FUNCTION public.ecotrack_admin_edit_controller(p_node_id text,p_changes jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE n public.nodes; saved jsonb; linked_count integer; label text; proto text; state public.ecotrack_device_state;
BEGIN
 IF auth.uid() IS NULL OR NOT public.ecotrack_is_admin() THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_changes) IS DISTINCT FROM 'object' OR octet_length(p_changes::text)>2000 OR
  EXISTS(SELECT 1 FROM jsonb_object_keys(p_changes) AS keys(item) WHERE item NOT IN ('name','room_id','brand','aircon_type','protocol_name','aircon_name')) THEN RAISE EXCEPTION 'Invalid controller changes'; END IF;
 SELECT * INTO n FROM public.nodes WHERE id=p_node_id FOR UPDATE;
 IF n.id IS NULL THEN RAISE EXCEPTION 'Controller no longer exists'; END IF;
 label:=btrim(p_changes->>'name');proto:=btrim(p_changes->>'protocol_name');
 IF length(label) NOT BETWEEN 1 AND 100 OR label ~ '[<>[:cntrl:]]' THEN RAISE EXCEPTION 'Enter a valid controller display name'; END IF;
 IF EXISTS(SELECT 1 FROM public.nodes WHERE name=label AND id<>n.id) THEN RAISE EXCEPTION 'Controller display name already exists'; END IF;
 IF nullif(p_changes->>'room_id','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.rooms WHERE id=p_changes->>'room_id') THEN RAISE EXCEPTION 'Selected room no longer exists'; END IF;
 IF length(coalesce(p_changes->>'brand',''))>80 OR coalesce(p_changes->>'brand','') ~ '[<>[:cntrl:]]' OR
  length(btrim(coalesce(p_changes->>'aircon_type',''))) NOT BETWEEN 1 AND 100 OR p_changes->>'aircon_type' ~ '[<>[:cntrl:]]' OR
  coalesce(proto,'') !~ '^[A-Za-z0-9_]{1,64}$' THEN RAISE EXCEPTION 'Invalid manufacturer, AC type or protocol'; END IF;
 IF nullif(p_changes->>'aircon_name','') IS NOT NULL AND
  (length(btrim(p_changes->>'aircon_name'))>100 OR p_changes->>'aircon_name' ~ '[<>[:cntrl:]]') THEN RAISE EXCEPTION 'Invalid air conditioner name'; END IF;
 SELECT * INTO state FROM public.ecotrack_device_state WHERE node_id=n.id;
 IF nullif(state.latest_ir->>'protocol','UNKNOWN') IS NOT NULL AND proto IS DISTINCT FROM n.protocol_name AND proto IS DISTINCT FROM state.latest_ir->>'protocol' THEN RAISE EXCEPTION 'Protocol differs from the actual receiver'; END IF;
 PERFORM 1 FROM public.aircons WHERE controller_node_id=n.id OR node_id IN(n.id,n.name,state.device_id) FOR UPDATE;
 SELECT count(*) INTO linked_count FROM public.aircons WHERE controller_node_id=n.id OR node_id IN(n.id,n.name,state.device_id);
 IF linked_count>1 AND nullif(p_changes->>'aircon_name','') IS NOT NULL THEN RAISE EXCEPTION 'Choose an individual AC profile before renaming multiple assigned units'; END IF;
 UPDATE public.aircons SET node_id=n.id,controller_node_id=n.id,name=coalesce(nullif(btrim(p_changes->>'aircon_name'),''),name,asset_tag),
  room_id=nullif(p_changes->>'room_id',''),brand=coalesce(nullif(btrim(p_changes->>'brand'),''),'Unspecified'),
  model=btrim(p_changes->>'aircon_type'),aircon_type=btrim(p_changes->>'aircon_type'),
  protocol=proto,protocol_name=proto,updated_at=clock_timestamp()
 WHERE controller_node_id=n.id OR node_id IN(n.id,n.name,state.device_id);
 SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]') INTO saved FROM public.aircons a WHERE controller_node_id=n.id OR node_id IN(n.id,n.name,state.device_id);
 UPDATE public.nodes SET name=label,room_id=nullif(p_changes->>'room_id',''),brand=nullif(btrim(p_changes->>'brand'),''),
  aircon_type=btrim(p_changes->>'aircon_type'),protocol_name=proto,updated=clock_timestamp()
 WHERE id=n.id RETURNING * INTO n;
 RETURN jsonb_build_object('success',true,'node',to_jsonb(n),'aircons',saved);
END $$;
REVOKE ALL ON FUNCTION public.ecotrack_admin_edit_controller(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ecotrack_admin_edit_controller(text,jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.ecotrack_finish_controller_registration(text,text,jsonb),public.ecotrack_validate_aircon_display_name() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ecotrack_finish_controller_registration(text,text,jsonb) TO authenticated;
-- User-requested data correction for this registered controller only. This is data, not a UI default.
UPDATE public.aircons a SET name='Matrix',brand=CASE WHEN a.brand IS NULL OR a.brand IN('TCL','Unspecified','') THEN 'Matrix' ELSE a.brand END WHERE (a.name IS NULL OR a.name=a.asset_tag OR a.name='Matrix')
 AND EXISTS(SELECT 1 FROM public.ecotrack_device_state s JOIN public.nodes n ON n.id=s.node_id
 WHERE s.device_id='esp32s3-9cd20604a7ac' AND (a.controller_node_id=n.id OR a.node_id IN(n.id,n.name,s.device_id)));
NOTIFY pgrst,'reload schema';

-- Section: supabase_ac_capabilities_migration.sql
-- Generated from config/ac-capabilities.json. Apply after cloud, realtime and registration migrations.
-- Adds one capability document to each existing AC; no profiles or assignments are recreated.
ALTER TABLE public.aircons ADD COLUMN IF NOT EXISTS capability_profile jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE OR REPLACE FUNCTION public.ecotrack_ac_registry()
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $registry$
 SELECT $data${"schema_version":1,"registry_version":"irremote-2.9.0-1","library_version":"2.9.0","reference":"https://github.com/crankyoldgit/IRremoteESP8266/tree/v2.9.0/src","features":["power","temperature","turbo","quiet","eco","swing_vertical","swing_horizontal","sleep","display","filter","clean","beep","timer","i_feel"],"aliases":{"MIDEA_IR":"MIDEA","MITSUBISHI":"MITSUBISHI_AC","PANASONIC":"PANASONIC_AC","SAMSUNG":"SAMSUNG_AC","CARRIER":"CARRIER_AC64","HAIER":"HAIER_AC","HITACHI":"HITACHI_AC","FUJITSU":"FUJITSU_AC","TOSHIBA":"TOSHIBA_AC","SHARP":"SHARP_AC","WHIRLPOOL":"WHIRLPOOL_AC"},"protocols":{"TCL112AC":{"protocol":"TCL112AC","source":"IRremoteESP8266 2.9.0","confidence":"library","features":{"power":true,"temperature":true,"turbo":true,"quiet":true,"eco":true,"swing_vertical":true,"swing_horizontal":true,"sleep":false,"display":true,"filter":true,"clean":false,"beep":false,"timer":false,"i_feel":false},"temperature":{"min":16,"max":31,"step":0.5,"unit":"C","modes":["auto","cool","heat","dry"]},"modes":["auto","cool","heat","dry","fan"],"fan_map":{"auto":0,"low":2,"medium":3,"high":4,"quiet":1},"fan_decode_aliases":{"1":"quiet","5":"high"},"mode_rules":{"fan":{"temperature_control":false}},"models":{"1":"TAC09CHSD","2":"GZ055BE1"},"model_rules":{},"decode_fields":["power","temp","mode","fan","turbo","eco","display","filter","swing_vertical","swing_horizontal"]},"DAIKIN":{"protocol":"DAIKIN","source":"IRremoteESP8266 2.9.0","confidence":"library","features":{"power":true,"temperature":true,"turbo":true,"quiet":true,"eco":true,"swing_vertical":true,"swing_horizontal":true,"sleep":false,"display":false,"filter":false,"clean":true,"beep":false,"timer":false,"i_feel":false},"temperature":{"min":10,"max":32,"step":0.5,"unit":"C","modes":["auto","cool","heat","dry"]},"modes":["auto","cool","heat","dry","fan"],"fan_map":{"auto":0,"low":2,"medium":3,"high":4,"quiet":1,"max":5},"fan_decode_aliases":{"1":"quiet","5":"max"},"mode_rules":{"fan":{"temperature_control":false}},"models":{},"model_rules":{},"decode_fields":["power","temp","mode","fan","turbo","quiet","eco","clean","swing_vertical","swing_horizontal"]},"DAIKIN2":{"protocol":"DAIKIN2","source":"IRremoteESP8266 2.9.0","confidence":"library","features":{"power":true,"temperature":true,"turbo":true,"quiet":true,"eco":true,"swing_vertical":true,"swing_horizontal":true,"sleep":false,"display":true,"filter":true,"clean":true,"beep":true,"timer":false,"i_feel":false},"temperature":{"min":10,"max":32,"step":1,"unit":"C","modes":["auto","cool","heat","dry"]},"modes":["auto","cool","heat","dry","fan"],"fan_map":{"auto":0,"low":2,"medium":3,"high":4,"quiet":1,"max":5},"fan_decode_aliases":{"1":"quiet","5":"max"},"mode_rules":{"fan":{"temperature_control":false},"cool":{"min":18}},"models":{},"model_rules":{},"decode_fields":["power","temp","mode","fan","turbo","quiet","eco","display","filter","clean","beep","sleep","swing_vertical","swing_horizontal"]},"DAIKIN64":{"protocol":"DAIKIN64","source":"IRremoteESP8266 2.9.0","confidence":"library","features":{"power":true,"temperature":true,"turbo":true,"quiet":true,"eco":false,"swing_vertical":true,"swing_horizontal":false,"sleep":true,"display":false,"filter":false,"clean":false,"beep":false,"timer":false,"i_feel":false},"temperature":{"min":16,"max":30,"step":1,"unit":"C","modes":["cool","heat","dry"]},"modes":["cool","heat","dry","fan"],"fan_map":{"auto":0,"low":2,"medium":3,"high":4,"quiet":1,"max":5},"fan_decode_aliases":{"1":"quiet","5":"max"},"mode_rules":{"fan":{"temperature_control":false}},"models":{},"model_rules":{},"power_toggle":true,"decode_fields":["temp","mode","fan","turbo","quiet","sleep","swing_vertical"]},"DAIKIN216":{"protocol":"DAIKIN216","source":"IRremoteESP8266 2.9.0","confidence":"library","features":{"power":true,"temperature":true,"turbo":true,"quiet":true,"eco":false,"swing_vertical":true,"swing_horizontal":true,"sleep":false,"display":false,"filter":false,"clean":false,"beep":false,"timer":false,"i_feel":false},"temperature":{"min":10,"max":32,"step":1,"unit":"C","modes":["auto","cool","heat","dry"]},"modes":["auto","cool","heat","dry","fan"],"fan_map":{"auto":0,"low":2,"medium":3,"high":4,"quiet":1,"max":5},"fan_decode_aliases":{"1":"quiet","5":"max"},"mode_rules":{"fan":{"temperature_control":false}},"models":{},"model_rules":{},"decode_fields":["power","temp","mode","fan","turbo","quiet","swing_vertical","swing_horizontal"]},"GREE":{"protocol":"GREE","source":"IRremoteESP8266 2.9.0","confidence":"library","features":{"power":true,"temperature":true,"turbo":true,"quiet":false,"eco":true,"swing_vertical":true,"swing_horizontal":true,"sleep":true,"display":true,"filter":false,"clean":true,"beep":false,"timer":false,"i_feel":true},"temperature":{"min":16,"max":30,"step":1,"unit":"C","modes":["auto","cool","heat","dry"]},"modes":["auto","cool","heat","dry","fan"],"fan_map":{"auto":0,"low":1,"medium":3,"high":4},"fan_decode_aliases":{"1":"low","2":"medium","5":"high"},"mode_rules":{"fan":{"temperature_control":false},"auto":{"temperature_control":false,"fixed_temp":25},"dry":{"fixed_fan":"low"}},"models":{"1":"YAW1F","2":"YBOFB","3":"YX1FSF"},"model_rules":{},"decode_fields":["power","temp","mode","fan","turbo","eco","display","clean","sleep","swing_vertical","swing_horizontal","i_feel"]},"MIDEA":{"protocol":"MIDEA","source":"IRremoteESP8266 2.9.0","confidence":"library","features":{"power":true,"temperature":true,"turbo":true,"quiet":true,"eco":true,"swing_vertical":true,"swing_horizontal":false,"sleep":true,"display":true,"filter":false,"clean":true,"beep":false,"timer":false,"i_feel":true},"temperature":{"min":17,"max":30,"step":1,"unit":"C","modes":["auto","cool","heat","dry"]},"modes":["auto","cool","heat","dry","fan"],"fan_map":{"auto":0,"low":2,"medium":3,"high":4},"fan_decode_aliases":{"1":"low","5":"high"},"mode_rules":{"fan":{"temperature_control":false}},"models":{},"model_rules":{},"decode_fields":["power","temp","mode","fan","eco","sleep","swing_vertical"]},"PANASONIC_AC":{"protocol":"PANASONIC_AC","source":"IRremoteESP8266 2.9.0","confidence":"library","features":{"power":true,"temperature":true,"turbo":true,"quiet":true,"eco":false,"swing_vertical":true,"swing_horizontal":true,"sleep":false,"display":false,"filter":true,"clean":false,"beep":false,"timer":false,"i_feel":false},"temperature":{"min":16,"max":30,"step":1,"unit":"C","modes":["auto","cool","heat","dry"]},"modes":["auto","cool","heat","dry","fan"],"fan_map":{"auto":0,"low":2,"medium":3,"high":4,"quiet":1,"max":5},"fan_decode_aliases":{"1":"quiet","5":"max"},"mode_rules":{"fan":{"temperature_control":false}},"models":{"1":"kPanasonicLke","2":"kPanasonicNke","3":"kPanasonicDke","4":"kPanasonicJke","5":"kPanasonicCkp","6":"kPanasonicRkr"},"model_rules":{},"decode_fields":["power","temp","mode","fan","turbo","quiet","filter","swing_vertical","swing_horizontal"]},"SAMSUNG_AC":{"protocol":"SAMSUNG_AC","source":"IRremoteESP8266 2.9.0","confidence":"library","features":{"power":true,"temperature":true,"turbo":true,"quiet":true,"eco":true,"swing_vertical":true,"swing_horizontal":true,"sleep":false,"display":true,"filter":true,"clean":true,"beep":true,"timer":false,"i_feel":false},"temperature":{"min":16,"max":30,"step":1,"unit":"C","modes":["auto","cool","heat","dry"]},"modes":["auto","cool","heat","dry","fan"],"fan_map":{"auto":0,"low":2,"medium":3,"high":4,"max":5},"fan_decode_aliases":{"1":"low","5":"max"},"mode_rules":{"fan":{"temperature_control":false},"auto":{"fixed_fan":"auto"}},"models":{},"model_rules":{},"notes":["Sleep requires a duration; boolean sleep is not encoded by this profile."],"decode_fields":["power","temp","mode","fan","turbo","quiet","eco","display","filter","clean","beep","sleep","swing_vertical","swing_horizontal"]},"MITSUBISHI_AC":{"protocol":"MITSUBISHI_AC","source":"IRremoteESP8266 2.9.0","confidence":"library","features":{"power":true,"temperature":true,"turbo":false,"quiet":true,"eco":false,"swing_vertical":true,"swing_horizontal":true,"sleep":false,"display":false,"filter":false,"clean":false,"beep":false,"timer":false,"i_feel":false},"temperature":{"min":16,"max":31,"step":0.5,"unit":"C","modes":["auto","cool","heat","dry"]},"modes":["auto","cool","heat","dry","fan"],"fan_map":{"auto":0,"low":2,"medium":3,"high":4,"quiet":1,"max":5},"fan_decode_aliases":{"1":"quiet","5":"max"},"mode_rules":{"fan":{"temperature_control":false}},"models":{},"model_rules":{},"decode_fields":["power","temp","mode","fan","quiet","swing_vertical","swing_horizontal"]},"CARRIER_AC64":{"protocol":"CARRIER_AC64","source":"IRremoteESP8266 2.9.0","confidence":"library","features":{"power":true,"temperature":true,"turbo":false,"quiet":false,"eco":false,"swing_vertical":true,"swing_horizontal":false,"sleep":true,"display":false,"filter":false,"clean":false,"beep":false,"timer":false,"i_feel":false},"temperature":{"min":16,"max":30,"step":1,"unit":"C","modes":["cool","heat"]},"modes":["cool","heat","fan"],"fan_map":{"auto":0,"low":2,"medium":3,"high":4},"fan_decode_aliases":{"1":"low","5":"high"},"mode_rules":{"fan":{"temperature_control":false}},"models":{},"model_rules":{},"decode_fields":["power","temp","mode","fan","sleep","swing_vertical"]},"FUJITSU_AC":{"protocol":"FUJITSU_AC","source":"IRremoteESP8266 2.9.0","confidence":"library","features":{"power":true,"temperature":true,"turbo":false,"quiet":true,"eco":false,"swing_vertical":true,"swing_horizontal":false,"sleep":false,"display":false,"filter":false,"clean":false,"beep":false,"timer":false,"i_feel":false},"temperature":{"min":16,"max":30,"step":1,"unit":"C","modes":["auto","cool","heat","dry"]},"modes":["auto","cool","heat","dry","fan"],"fan_map":{"auto":0,"low":2,"medium":3,"high":4,"quiet":1},"fan_decode_aliases":{"1":"quiet","5":"high"},"mode_rules":{"fan":{"temperature_control":false}},"models":{"1":"ARRAH2E","2":"ARDB1","3":"ARREB1E","4":"ARJW2","5":"ARRY4","6":"ARREW4E"},"model_rules":{"1":{"temperature":{"step":0.25},"features":{"turbo":false,"eco":false,"swing_horizontal":true},"full_state_min_bits":128},"2":{"temperature":{"step":0.25},"features":{"turbo":false,"eco":false,"swing_horizontal":false},"full_state_min_bits":120},"3":{"temperature":{"step":0.25},"features":{"turbo":true,"eco":true,"swing_horizontal":false},"full_state_min_bits":128},"4":{"temperature":{"step":0.25},"features":{"turbo":false,"eco":false,"swing_horizontal":true},"full_state_min_bits":120},"5":{"temperature":{"step":0.25},"features":{"turbo":false,"eco":false,"swing_horizontal":true},"full_state_min_bits":128},"6":{"temperature":{"step":0.5},"features":{"turbo":false,"eco":false,"swing_horizontal":true},"full_state_min_bits":128}},"requires_model":true,"full_state_min_bits":128,"decode_fields":["power","temp","mode","fan","turbo","quiet","eco","filter","clean","swing_vertical","swing_horizontal"]},"HAIER_AC":{"protocol":"HAIER_AC","source":"IRremoteESP8266 2.9.0","confidence":"library","features":{"power":true,"temperature":true,"turbo":false,"quiet":false,"eco":false,"swing_vertical":true,"swing_horizontal":false,"sleep":true,"display":false,"filter":true,"clean":false,"beep":false,"timer":false,"i_feel":false},"temperature":{"min":16,"max":30,"step":1,"unit":"C","modes":["auto","cool","heat","dry"]},"modes":["auto","cool","heat","dry","fan"],"fan_map":{"auto":0,"low":2,"medium":3,"high":4},"fan_decode_aliases":{"1":"low","5":"high"},"mode_rules":{"fan":{"temperature_control":false}},"models":{},"model_rules":{},"decode_fields":["temp","mode","fan","filter","sleep","swing_vertical"]},"TOSHIBA_AC":{"protocol":"TOSHIBA_AC","source":"IRremoteESP8266 2.9.0","confidence":"library","features":{"power":true,"temperature":true,"turbo":true,"quiet":false,"eco":true,"swing_vertical":true,"swing_horizontal":false,"sleep":false,"display":false,"filter":true,"clean":false,"beep":false,"timer":false,"i_feel":false},"temperature":{"min":17,"max":30,"step":1,"unit":"C","modes":["auto","cool","heat","dry"]},"modes":["auto","cool","heat","dry","fan"],"fan_map":{"auto":0,"low":2,"medium":3,"high":4,"max":5},"fan_decode_aliases":{"1":"low","5":"max"},"mode_rules":{"fan":{"temperature_control":false}},"models":{"1":"kToshibaGenericRemote_B"},"model_rules":{},"decode_fields":["power","temp","mode","fan","turbo","eco","filter"]},"SHARP_AC":{"protocol":"SHARP_AC","source":"IRremoteESP8266 2.9.0","confidence":"library","features":{"power":true,"temperature":true,"turbo":true,"quiet":false,"eco":false,"swing_vertical":true,"swing_horizontal":false,"sleep":false,"display":true,"filter":true,"clean":true,"beep":false,"timer":false,"i_feel":false},"temperature":{"min":15,"max":30,"step":1,"unit":"C","modes":["cool","heat"]},"modes":["auto","cool","heat","dry"],"fan_map":{"auto":0,"low":2,"medium":3,"high":4,"max":5},"fan_decode_aliases":{"1":"low","5":"max"},"mode_rules":{"fan":{"temperature_control":false},"auto":{"temperature_control":false},"dry":{"temperature_control":false}},"models":{"1":"A907","2":"A705","3":"A903"},"model_rules":{},"decode_fields":["power","temp","mode","fan","turbo","eco","display","filter","clean","swing_vertical"]},"HITACHI_AC":{"protocol":"HITACHI_AC","source":"IRremoteESP8266 2.9.0","confidence":"library","features":{"power":true,"temperature":true,"turbo":false,"quiet":false,"eco":false,"swing_vertical":true,"swing_horizontal":true,"sleep":false,"display":false,"filter":false,"clean":false,"beep":false,"timer":false,"i_feel":false},"temperature":{"min":16,"max":32,"step":1,"unit":"C","modes":["auto","cool","heat","dry"]},"modes":["auto","cool","heat","dry","fan"],"fan_map":{"auto":0,"low":2,"medium":3,"high":4,"max":5},"fan_decode_aliases":{"1":"low","5":"max"},"mode_rules":{"fan":{"temperature_control":false}},"models":{},"model_rules":{},"decode_fields":["power","temp","mode","fan","swing_vertical","swing_horizontal"]},"WHIRLPOOL_AC":{"protocol":"WHIRLPOOL_AC","source":"IRremoteESP8266 2.9.0","confidence":"library","features":{"power":true,"temperature":true,"turbo":true,"quiet":false,"eco":false,"swing_vertical":true,"swing_horizontal":false,"sleep":true,"display":true,"filter":false,"clean":false,"beep":false,"timer":false,"i_feel":false},"temperature":{"min":18,"max":30,"step":1,"unit":"C","modes":["auto","cool","heat","dry"]},"modes":["auto","cool","heat","dry","fan"],"fan_map":{"auto":0,"low":2,"medium":3,"high":4},"fan_decode_aliases":{"1":"low","5":"high"},"mode_rules":{"fan":{"temperature_control":false},"auto":{"temperature_control":false,"fixed_fan":"auto"}},"models":{"1":"DG11J13A","2":"DG11J191"},"model_rules":{"1":{"temperature":{"min":18,"max":32}},"2":{"temperature":{"min":16,"max":30}}},"power_toggle":true,"decode_fields":["power","temp","mode","fan","turbo","display","sleep","swing_vertical"]},"TEKNOPOINT":{"protocol":"TEKNOPOINT","source":"IRremoteESP8266 2.9.0","confidence":"library","features":{"power":true,"temperature":true,"turbo":true,"quiet":true,"eco":true,"swing_vertical":true,"swing_horizontal":true,"sleep":false,"display":true,"filter":true,"clean":false,"beep":false,"timer":false,"i_feel":false},"temperature":{"min":16,"max":31,"step":0.5,"unit":"C","modes":["auto","cool","heat","dry"]},"modes":["auto","cool","heat","dry","fan"],"fan_map":{"auto":0,"low":2,"medium":3,"high":4,"quiet":1},"fan_decode_aliases":{"1":"quiet","5":"high"},"mode_rules":{"fan":{"temperature_control":false}},"models":{"1":"TAC09CHSD","2":"GZ055BE1"},"model_rules":{},"decode_fields":["power","temp","mode","fan","turbo","eco","display","filter","swing_vertical","swing_horizontal"]}},"verified_models":{}}$data$::jsonb
$registry$;
CREATE OR REPLACE FUNCTION public.ecotrack_resolve_ac_capabilities(p_protocol text,p_model integer,p_saved jsonb DEFAULT '{}',p_receiver jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE registry jsonb:=public.ecotrack_ac_registry(); name text:=upper(btrim(p_protocol)); base jsonb; rule jsonb; k text; v jsonb; matching boolean;
BEGIN
 name:=coalesce(registry->'aliases'->>name,name);
 base:=registry->'protocols'->name;
 IF base IS NULL THEN RETURN jsonb_build_object('protocol','UNKNOWN','can_transmit',false,'features','{}'::jsonb,'modes','[]'::jsonb,'fan_map','{}'::jsonb); END IF;
 rule:=base->'model_rules'->p_model::text;
 IF rule IS NOT NULL THEN
  FOR k,v IN SELECT key,value FROM jsonb_each(rule) LOOP
   base:=jsonb_set(base,ARRAY[k],CASE WHEN jsonb_typeof(v)='object' THEN coalesce(base->k,'{}')||v ELSE v END);
  END LOOP;
 END IF;
 matching:=p_saved->>'protocol'=name AND (p_saved->'remote_model' IS NULL OR p_saved->'remote_model'='null'::jsonb OR p_saved->>'remote_model'=p_model::text);
 FOR k IN SELECT jsonb_array_elements_text(registry->'features') LOOP
  IF p_receiver->k='false'::jsonb OR (k='swing_vertical' AND p_receiver->'swing'='false'::jsonb) THEN
    IF NOT (matching AND p_saved->'features'->k->>'status'='verified_supported') THEN base:=jsonb_set(base,ARRAY['features',k],'false'); END IF;
  END IF;
  IF matching AND p_saved->'features'->k->>'status'='verified_unsupported' THEN base:=jsonb_set(base,ARRAY['features',k],'false'); END IF;
 END LOOP;
 IF matching THEN
  FOR k,v IN SELECT key,value FROM jsonb_each(coalesce(p_saved->'options'->'fan','{}')) LOOP
   IF v->>'status'='verified_unsupported' THEN base:=jsonb_set(base,ARRAY['fan_map'],(base->'fan_map')-k); END IF;
  END LOOP;
  base:=jsonb_set(base,ARRAY['modes'],coalesce((SELECT jsonb_agg(value) FROM jsonb_array_elements(base->'modes') WHERE coalesce(p_saved->'options'->'mode'->(value#>>'{}')->>'status','')<>'verified_unsupported'),'[]'));
  IF p_saved->'temperature'->>'status'='verified_supported' THEN
   base:=jsonb_set(base,ARRAY['temperature'],(base->'temperature')||jsonb_build_object('min',p_saved->'temperature'->'min','max',p_saved->'temperature'->'max','step',p_saved->'temperature'->'step'));
  END IF;
 END IF;
 RETURN base||jsonb_build_object('protocol',name,'remote_model',p_model,'can_transmit',coalesce((base->>'requires_model')::boolean,false)=false OR coalesce(base->'models' ? p_model::text,false));
END $$;

CREATE OR REPLACE FUNCTION public.ecotrack_validate_ac_intent(p_ac public.aircons,p_live jsonb,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE registry jsonb:=public.ecotrack_ac_registry(); name text; model integer; caps jsonb; state jsonb:=p_payload->'state'; rule jsonb; temp numeric; lo numeric; hi numeric; step numeric; k text; feat text;
BEGIN
 name:=coalesce(nullif(p_live->>'protocol','UNKNOWN'),p_ac.protocol_name,p_ac.protocol,'UNKNOWN');
 name:=coalesce(registry->'aliases'->>upper(name),upper(name));
 IF coalesce(registry->'aliases'->>upper(p_payload->>'protocol'),upper(p_payload->>'protocol')) IS DISTINCT FROM name THEN RAISE EXCEPTION 'Protocol differs from the active receiver/profile'; END IF;
 IF p_ac.capability_profile->>'protocol'=name AND p_ac.capability_profile->'model_verified'='true'::jsonb THEN
  model:=(p_ac.capability_profile->>'remote_model')::integer;
 ELSE model:=coalesce((p_live->>'remote_model')::integer,(p_ac.capability_profile->>'remote_model')::integer); END IF;
 IF p_payload->'model' IS NOT NULL AND p_payload->'model'<>'null'::jsonb AND (jsonb_typeof(p_payload->'model')<>'number' OR (p_payload->>'model')::numeric IS DISTINCT FROM model) THEN RAISE EXCEPTION 'Remote model differs from the active profile'; END IF;
 IF p_payload ? 'capability_revision' AND (jsonb_typeof(p_payload->'capability_revision') IS DISTINCT FROM 'number' OR coalesce(p_payload->>'capability_revision','') !~ '^[0-9]{1,9}$' OR (p_payload->>'capability_revision')::integer<>coalesce((p_ac.capability_profile->>'revision')::integer,0)) THEN RAISE EXCEPTION 'Capabilities changed; refresh this AC before sending'; END IF;
 IF p_payload ? 'registry_version' AND p_payload->>'registry_version' IS DISTINCT FROM registry->>'registry_version' THEN RAISE EXCEPTION 'Capability registry version differs; refresh the application'; END IF;
 caps:=public.ecotrack_resolve_ac_capabilities(name,model,p_ac.capability_profile,p_live->'ac_capabilities');
 IF caps->'can_transmit'<>'true'::jsonb THEN RAISE EXCEPTION 'Choose a supported exact protocol/model'; END IF;
 IF jsonb_typeof(state) IS DISTINCT FROM 'object' OR coalesce(state->>'power','') NOT IN ('on','off') OR
  NOT (caps->'modes' ? coalesce(state->>'mode','')) OR NOT(caps->'fan_map' ? coalesce(state->>'fan','')) OR jsonb_typeof(state->'temp') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Invalid full AC state or unsupported mode/fan'; END IF;
 IF p_payload ? 'requested_feature' THEN
  k:=lower(p_payload->>'requested_feature');feat:=CASE WHEN k='temp' THEN 'temperature' WHEN k='swing' THEN 'swing_vertical' ELSE k END;
  IF k NOT IN ('mode','fan') AND (NOT(registry->'features' ? feat) OR caps->'features'->feat IS DISTINCT FROM 'true'::jsonb) THEN RAISE EXCEPTION 'Requested feature is unsupported: %',k; END IF;
  IF feat='temperature' AND (coalesce(caps->'mode_rules'->(state->>'mode')->'temperature_control','true')<>'true'::jsonb OR NOT(caps->'temperature'->'modes' ? (state->>'mode'))) THEN RAISE EXCEPTION 'Temperature is not adjustable in this mode'; END IF;
 END IF;
 rule:=coalesce(caps->'mode_rules'->(state->>'mode'),'{}');
 lo:=greatest((caps->'temperature'->>'min')::numeric,(rule->>'min')::numeric);
 hi:=least((caps->'temperature'->>'max')::numeric,(rule->>'max')::numeric);
 lo:=coalesce((rule->>'fixed_temp')::numeric,lo);hi:=coalesce((rule->>'fixed_temp')::numeric,hi);
 step:=(caps->'temperature'->>'step')::numeric;temp:=(state->>'temp')::numeric;
 IF lo IS NULL OR hi IS NULL OR step IS NULL OR temp<lo OR temp>hi OR abs((temp-lo)/step-round((temp-lo)/step))>0.000001 THEN RAISE EXCEPTION 'Temperature must be %..% C in % degree steps',lo,hi,step; END IF;
 IF rule ? 'fixed_fan' AND state->>'fan'<>rule->>'fixed_fan' THEN RAISE EXCEPTION 'This mode requires % fan',rule->>'fixed_fan'; END IF;
 FOR k IN SELECT jsonb_object_keys(state) LOOP
  IF k IN ('power','temp','mode','fan') THEN CONTINUE; END IF;
  feat:=CASE WHEN k='swing' THEN 'swing_vertical' ELSE k END;
  IF NOT(registry->'features' ? feat) OR coalesce(state->>k,'') NOT IN ('on','off') OR (state->>k='on' AND caps->'features'->feat IS DISTINCT FROM 'true'::jsonb) THEN RAISE EXCEPTION 'Unsupported or invalid AC setting: %',k; END IF;
 END LOOP;
 RETURN jsonb_build_object('resolved_model',model,'capability_constraints',jsonb_build_object('protocol',name,'model',model,'min',lo,'max',hi,'step',step,'revision',coalesce((p_ac.capability_profile->>'revision')::integer,0)));
END $$;

CREATE OR REPLACE FUNCTION public.ecotrack_verify_ac_capabilities(p_aircon_id text,p_expected_revision integer,p_profile jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE ac public.aircons; live jsonb; registry jsonb:=public.ecotrack_ac_registry(); caps jsonb; clean jsonb; kind text; k text; v jsonb; status text; model integer; t jsonb; b jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.ecotrack_is_admin() THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501'; END IF;
 SELECT * INTO ac FROM public.aircons WHERE id=p_aircon_id FOR UPDATE;
 IF ac.id IS NULL THEN RAISE EXCEPTION 'AC profile no longer exists'; END IF;
 IF p_expected_revision IS NULL OR p_expected_revision<0 THEN RAISE EXCEPTION 'Invalid capability revision'; END IF;
 IF coalesce((ac.capability_profile->>'revision')::integer,0)<>p_expected_revision THEN RAISE EXCEPTION 'Capabilities changed; reopen verification before saving'; END IF;
 IF jsonb_typeof(p_profile) IS DISTINCT FROM 'object' OR octet_length(p_profile::text)>12000 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_profile) AS keys(item) WHERE keys.item NOT IN ('protocol','remote_model','model_verified','ac_model','features','options','temperature')) THEN RAISE EXCEPTION 'Invalid capability document'; END IF;
 SELECT s.latest_ir INTO live FROM public.ecotrack_device_state s JOIN public.nodes n ON n.id=s.node_id
  WHERE ac.controller_node_id=n.id OR ac.node_id IN(n.id,n.name) LIMIT 1;
 IF coalesce(live->>'protocol','UNKNOWN')<>'UNKNOWN' AND p_profile->>'protocol' IS DISTINCT FROM live->>'protocol' THEN RAISE EXCEPTION 'Protocol differs from this controller receiver'; END IF;
 IF NOT(registry->'protocols' ? coalesce(p_profile->>'protocol','')) THEN RAISE EXCEPTION 'Select an audited exact protocol'; END IF;
 IF p_profile->'remote_model' IS NOT NULL AND p_profile->'remote_model'<>'null'::jsonb THEN
  IF jsonb_typeof(p_profile->'remote_model')<>'number' OR (p_profile->>'remote_model') !~ '^[1-9][0-9]{0,4}$' THEN RAISE EXCEPTION 'Invalid remote model'; END IF;
  model:=(p_profile->>'remote_model')::integer;
  IF NOT(registry->'protocols'->(p_profile->>'protocol')->'models' ? model::text) THEN RAISE EXCEPTION 'Remote model is not defined by this protocol'; END IF;
 END IF;
 IF p_profile ? 'model_verified' AND jsonb_typeof(p_profile->'model_verified')<>'boolean' THEN RAISE EXCEPTION 'Invalid model confirmation'; END IF;
 IF coalesce(p_profile->>'ac_model','') ~ '[<>[:cntrl:]]' OR length(coalesce(p_profile->>'ac_model',''))>100 THEN RAISE EXCEPTION 'Invalid physical AC model'; END IF;
 caps:=public.ecotrack_resolve_ac_capabilities(p_profile->>'protocol',model,'{}');
 clean:=jsonb_build_object('protocol',p_profile->>'protocol','remote_model',model,'model_verified',coalesce(p_profile->'model_verified','false'::jsonb),'ac_model',p_profile->>'ac_model','features','{}'::jsonb,'options',jsonb_build_object('mode','{}'::jsonb,'fan','{}'::jsonb));
 IF p_profile ? 'features' AND jsonb_typeof(p_profile->'features')<>'object' THEN RAISE EXCEPTION 'Invalid feature results'; END IF;
 FOR k,v IN SELECT key,value FROM jsonb_each(coalesce(p_profile->'features','{}')) LOOP
  status:=v->>'status';
  IF NOT(registry->'features' ? k) OR coalesce(status,'') NOT IN ('verified_supported','verified_unsupported','unknown','library_unverified') THEN RAISE EXCEPTION 'Invalid feature result'; END IF;
  IF status LIKE 'verified_%' THEN clean:=jsonb_set(clean,ARRAY['features',k],jsonb_build_object('status',status,'source','physical_test','confidence','user_confirmed','verified_by',auth.uid(),'verified_at',clock_timestamp())); END IF;
 END LOOP;
 IF p_profile ? 'options' AND (jsonb_typeof(p_profile->'options')<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_profile->'options') AS keys(item) WHERE keys.item NOT IN ('mode','fan'))) THEN RAISE EXCEPTION 'Invalid option results'; END IF;
 FOREACH kind IN ARRAY ARRAY['mode','fan'] LOOP
  FOR k,v IN SELECT key,value FROM jsonb_each(coalesce(p_profile->'options'->kind,'{}')) LOOP
   status:=v->>'status';
   IF NOT(CASE WHEN kind='mode' THEN caps->'modes' ELSE caps->'fan_map' END ? k) OR coalesce(status,'') NOT IN ('verified_supported','verified_unsupported','unknown','library_unverified') THEN RAISE EXCEPTION 'Invalid mode/fan result'; END IF;
   IF status LIKE 'verified_%' THEN clean:=jsonb_set(clean,ARRAY['options',kind,k],jsonb_build_object('status',status,'source','physical_test','confidence','user_confirmed','verified_by',auth.uid(),'verified_at',clock_timestamp())); END IF;
  END LOOP;
 END LOOP;
 t:=p_profile->'temperature';b:=caps->'temperature';
 IF t IS NOT NULL AND t<>'null'::jsonb THEN
  IF t->>'status' IS DISTINCT FROM 'verified_supported' OR jsonb_typeof(t->'min')<>'number' OR jsonb_typeof(t->'max')<>'number' OR jsonb_typeof(t->'step')<>'number' THEN RAISE EXCEPTION 'Invalid verified temperature range'; END IF;
  IF (t->>'min')::numeric<(b->>'min')::numeric OR (t->>'max')::numeric>(b->>'max')::numeric OR (t->>'min')::numeric>(t->>'max')::numeric OR (t->>'step')::numeric<(b->>'step')::numeric OR mod((t->>'step')::numeric,(b->>'step')::numeric)<>0 OR mod((t->>'min')::numeric-(b->>'min')::numeric,(b->>'step')::numeric)<>0 THEN RAISE EXCEPTION 'Verified range must fit the encoder range and steps'; END IF;
  clean:=clean||jsonb_build_object('temperature',jsonb_build_object('status','verified_supported','min',t->'min','max',t->'max','step',t->'step','unit','C','source','physical_test','confidence','user_confirmed','verified_at',clock_timestamp(),'verified_by',auth.uid()));
 END IF;
 clean:=clean||jsonb_build_object('revision',p_expected_revision+1,'updated_at',clock_timestamp(),'registry_version',registry->>'registry_version');
 PERFORM set_config('ecotrack.capability_write','on',true);
 UPDATE public.aircons SET capability_profile=clean WHERE id=ac.id RETURNING * INTO ac;
 RETURN jsonb_build_object('success',true,'aircon',to_jsonb(ac));
END $$;
CREATE OR REPLACE FUNCTION public.ecotrack_guard_ac_capabilities()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.capability_profile<>'{}'::jsonb AND coalesce(current_setting('ecotrack.capability_write',true),'')<>'on' THEN
   RAISE EXCEPTION 'Use the admin capability verification action' USING ERRCODE='42501';
  END IF;
 ELSIF NEW.capability_profile IS DISTINCT FROM OLD.capability_profile AND coalesce(current_setting('ecotrack.capability_write',true),'')<>'on' THEN
  RAISE EXCEPTION 'Use the admin capability verification action' USING ERRCODE='42501';
 END IF;RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ecotrack_ac_capabilities_guard ON public.aircons;
CREATE TRIGGER ecotrack_ac_capabilities_guard BEFORE INSERT OR UPDATE ON public.aircons FOR EACH ROW EXECUTE FUNCTION public.ecotrack_guard_ac_capabilities();
REVOKE ALL ON FUNCTION public.ecotrack_verify_ac_capabilities(text,integer,jsonb),public.ecotrack_validate_ac_intent(public.aircons,jsonb,jsonb),public.ecotrack_guard_ac_capabilities() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ecotrack_verify_ac_capabilities(text,integer,jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.ecotrack_cloud_request(p_node_id text,p_kind text,p_payload jsonb,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n public.nodes; s public.ecotrack_device_state; c public.ecotrack_device_commands; ac public.aircons; seconds numeric; state jsonb; life interval; chosen_value numeric; chosen_unit text;
BEGIN
 IF auth.uid() IS NULL OR NOT public.ecotrack_is_admin() THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_kind IS NULL OR p_kind NOT IN ('ping','learn_ir','configure','ac_intent') OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid hardware request'; END IF;
 SELECT * INTO n FROM public.nodes WHERE id=p_node_id FOR UPDATE;
 SELECT * INTO s FROM public.ecotrack_device_state WHERE node_id=p_node_id;
 IF n.id IS NULL OR s.node_id IS NULL THEN RAISE EXCEPTION 'Provision this controller through Bluetooth first'; END IF;
 SELECT * INTO c FROM public.ecotrack_device_commands WHERE id=p_request_id;
 IF c.id IS NOT NULL THEN
  IF c.node_id<>p_node_id OR c.kind<>p_kind OR (c.payload-'resolved_model'-'capability_constraints')<>p_payload OR c.created_by<>auth.uid() THEN RAISE EXCEPTION 'Request ID conflict'; END IF;
  RETURN to_jsonb(c);
 END IF;
 IF p_kind='configure' THEN
  IF jsonb_typeof(p_payload->'interval_seconds') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Invalid report interval'; END IF;
  seconds := (p_payload->>'interval_seconds')::numeric;
  IF seconds<1 OR seconds>86400 OR seconds<>trunc(seconds) THEN RAISE EXCEPTION 'Report interval must be 1..86400 seconds'; END IF;
  IF coalesce(p_payload->>'wake_time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR coalesce(p_payload->>'sleep_time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN RAISE EXCEPTION 'Invalid wake/sleep time'; END IF;
  chosen_value := seconds; chosen_unit := 'Seconds';
  IF p_payload ? 'interval_val' OR p_payload ? 'interval_unit' THEN
   IF jsonb_typeof(p_payload->'interval_val') IS DISTINCT FROM 'number' OR coalesce(p_payload->>'interval_unit','') NOT IN ('Seconds','Minutes','Hours') THEN RAISE EXCEPTION 'Invalid interval unit/value'; END IF;
   chosen_value := (p_payload->>'interval_val')::numeric; chosen_unit := p_payload->>'interval_unit';
   IF chosen_value<=0 OR chosen_value<>trunc(chosen_value) OR chosen_value * (CASE chosen_unit WHEN 'Seconds' THEN 1 WHEN 'Minutes' THEN 60 ELSE 3600 END) <> seconds THEN RAISE EXCEPTION 'Interval unit/value does not match seconds'; END IF;
  END IF;
  UPDATE public.nodes SET interval_val=chosen_value,interval_unit=chosen_unit,wake_time=p_payload->>'wake_time',sleep_time=p_payload->>'sleep_time',updated=now() WHERE id=n.id;
  life := interval '1 day';
 ELSIF p_kind='ac_intent' THEN
  IF coalesce((s.capabilities->>'ir_transmitter')::boolean,false) IS NOT TRUE THEN RAISE EXCEPTION 'This device is receiver-only; an IR transmitter is required'; END IF;
  SELECT * INTO ac FROM public.aircons WHERE id=p_payload->>'aircon_id' AND (node_id=n.id OR controller_node_id=n.id OR node_id=n.name) FOR UPDATE;
  state := p_payload->'state';
  IF ac.id IS NULL THEN RAISE EXCEPTION 'AC is not assigned to this controller'; END IF;
  p_payload:=p_payload||public.ecotrack_validate_ac_intent(ac,s.latest_ir,p_payload);
  UPDATE public.aircons SET desired_state=state,command_id=p_request_id,command_status='queued',command_status_at=now(),commanded_at=now() WHERE id=ac.id;
  life := interval '2 minutes';
 ELSIF p_kind='learn_ir' THEN
  IF coalesce((s.capabilities->>'ir_receiver')::boolean,false) IS NOT TRUE THEN RAISE EXCEPTION 'IR receiver capability has not been reported'; END IF;
  life := interval '30 seconds';
 ELSE life := interval '20 seconds';
 END IF;
 IF p_kind IN ('configure','ac_intent') THEN
  UPDATE public.ecotrack_device_commands SET status='superseded',result=jsonb_build_object('error','Replaced by newer settings') WHERE node_id=n.id AND kind=p_kind AND status IN ('queued','claimed');
 END IF;
 INSERT INTO public.ecotrack_device_commands(id,node_id,kind,payload,created_by,expires_at) VALUES(p_request_id,n.id,p_kind,p_payload,auth.uid(),now()+life) RETURNING * INTO c;
 RETURN to_jsonb(c);
END $$;
CREATE OR REPLACE FUNCTION public.ecotrack_device_observe(p_device_id text,p_token text,p_observation jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE target text; current_state public.ecotrack_device_state; latest jsonb; field text; seen timestamptz;
BEGIN
 SELECT node_id INTO target FROM ecotrack_private.device_credentials
 WHERE device_id=p_device_id AND p_token ~ '^[a-f0-9]{64}$' AND token_hash=sha256(convert_to(p_token,'UTF8'));
 IF target IS NULL THEN RAISE EXCEPTION 'Invalid device credential' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_observation) IS DISTINCT FROM 'object' OR octet_length(p_observation::text)>4000
  OR p_observation ? 'raw_data' OR p_observation ? 'last_decoded'
  OR coalesce(p_observation->>'protocol','') !~ '^[A-Z][A-Z0-9_]{1,48}$' OR p_observation->>'protocol'='UNKNOWN'
  OR coalesce(p_observation->>'frame_kind','') NOT IN ('full_state','partial_state')
  OR jsonb_typeof(p_observation->'raw_count') IS DISTINCT FROM 'number'
  OR coalesce(p_observation->>'raw_count','') !~ '^[1-9][0-9]{0,3}$'
  OR jsonb_typeof(p_observation->'sequence') IS DISTINCT FROM 'number'
  OR coalesce(p_observation->>'sequence','') !~ '^[0-9]{1,10}$'
  OR jsonb_typeof(p_observation->'boot_count') IS DISTINCT FROM 'number'
  OR coalesce(p_observation->>'boot_count','') !~ '^[0-9]{1,10}$'
  OR jsonb_typeof(p_observation->'state') IS DISTINCT FROM 'object'
  OR (p_observation->'state' ? 'power' AND jsonb_typeof(p_observation->'state'->'power') IS DISTINCT FROM 'boolean')
  OR (p_observation->'state' ? 'temp' AND jsonb_typeof(p_observation->'state'->'temp') IS DISTINCT FROM 'number')
  OR (p_observation->'state' ? 'mode' AND coalesce(p_observation->'state'->>'mode','') NOT IN ('cool','dry','fan','auto','heat'))
  OR (p_observation->'state' ? 'fan' AND coalesce(p_observation->'state'->>'fan','') NOT IN ('auto','low','medium','high','max','quiet','silent','turbo'))
  OR p_observation->'state'->>'source' IS DISTINCT FROM 'ir_receiver' THEN
  RAISE EXCEPTION 'Invalid decoded IR observation';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_object_keys(p_observation->'state') f WHERE f<>'source') THEN RAISE EXCEPTION 'No decoded fields'; END IF;
 IF p_observation ? 'remote_model' AND p_observation->'remote_model'<>'null'::jsonb AND (jsonb_typeof(p_observation->'remote_model')<>'number' OR (p_observation->>'remote_model') !~ '^[1-9][0-9]{0,4}$') THEN RAISE EXCEPTION 'Invalid decoded model'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_observation->'state') f WHERE f NOT IN ('source','power','temp','mode','fan','turbo','swing','eco','sleep','quiet','swing_vertical','swing_horizontal','display','filter','clean','beep','i_feel')) THEN RAISE EXCEPTION 'Unknown decoded field'; END IF;
 IF (p_observation->'state'->>'temp')::numeric NOT BETWEEN 0 AND 50 THEN RAISE EXCEPTION 'Invalid IR temperature'; END IF;
 FOREACH field IN ARRAY ARRAY['turbo','swing','eco','sleep','quiet','swing_vertical','swing_horizontal','display','filter','clean','beep','i_feel'] LOOP
  IF p_observation->'state' ? field AND jsonb_typeof(p_observation->'state'->field) IS DISTINCT FROM 'boolean' THEN
   RAISE EXCEPTION 'Invalid IR feature';
  END IF;
 END LOOP;
 IF p_observation ? 'captured_at_epoch_ms' AND
  (jsonb_typeof(p_observation->'captured_at_epoch_ms') IS DISTINCT FROM 'number' OR
   coalesce(p_observation->>'captured_at_epoch_ms','') !~ '^[0-9]{13}$') THEN RAISE EXCEPTION 'Invalid IR capture timestamp'; END IF;
 SELECT * INTO current_state FROM public.ecotrack_device_state WHERE node_id=target AND device_id=p_device_id FOR UPDATE;
 IF current_state.node_id IS NULL THEN RAISE EXCEPTION 'Register this controller first'; END IF;
 -- Capture time also rejects an old boot's delayed upload after a newer boot has reported.
 IF coalesce(current_state.latest_ir->>'captured_at_epoch_ms','') ~ '^[0-9]{13}$'
  AND coalesce(p_observation->>'captured_at_epoch_ms','') ~ '^[0-9]{13}$'
  AND (current_state.latest_ir->>'captured_at_epoch_ms')::numeric > (p_observation->>'captured_at_epoch_ms')::numeric THEN
  RETURN jsonb_build_object('success',true,'node_id',target,'duplicate',true,'server_time',clock_timestamp());
 END IF;
 -- Retried or reordered uploads from one boot cannot roll back newer receiver state.
 IF current_state.latest_ir->>'boot_count'=p_observation->>'boot_count'
  AND coalesce(current_state.latest_ir->>'sequence','') ~ '^[0-9]{1,10}$'
  AND (current_state.latest_ir->>'sequence')::numeric >= (p_observation->>'sequence')::numeric THEN
  RETURN jsonb_build_object('success',true,'node_id',target,'duplicate',true,'server_time',clock_timestamp());
 END IF;
 seen := clock_timestamp();
 latest := p_observation || jsonb_build_object('received_at',seen,'node_id',target);
 -- Carry known fields across partial frames, retaining the time each field was actually decoded.
 IF current_state.latest_ir->>'protocol'=p_observation->>'protocol' THEN
  latest:=jsonb_set(latest,ARRAY['state'],coalesce(current_state.latest_ir->'state','{}')||(p_observation->'state'));
 END IF;
 latest:=jsonb_set(latest,ARRAY['field_at'],coalesce(CASE WHEN current_state.latest_ir->>'protocol'=p_observation->>'protocol' THEN current_state.latest_ir->'field_at' END,'{}')||
   (SELECT jsonb_object_agg(f,coalesce(to_jsonb(to_timestamp((p_observation->>'captured_at_epoch_ms')::numeric/1000)),to_jsonb(seen))) FROM jsonb_object_keys(p_observation->'state') f WHERE f<>'source'));
 UPDATE public.ecotrack_device_state SET latest_ir=latest,last_seen=seen,sleeping_until=NULL WHERE node_id=target;
 RETURN jsonb_build_object('success',true,'node_id',target,'server_time',seen);
END $$;
NOTIFY pgrst,'reload schema';

COMMIT;
