-- Monitoring-only registrations use the same verified installation inbox as controls.
-- Preserve existing authentication, history snapshots, room routing and retry keys.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

DO $migration$
DECLARE definition text;
 old_binding text:='SELECT * INTO ac FROM public.aircons WHERE controller_node_id=n.id AND room_id=r.id;';
 new_binding text:=$binding$SELECT a.* INTO ac FROM public.aircons a WHERE a.room_id=r.id AND
  CASE WHEN coalesce(p_setup->>'device_mode','controller')='monitoring'
   THEN a.id=n.monitor_aircon_id ELSE a.controller_node_id=n.id END;$binding$;
 final_return text:='RETURN result||jsonb_build_object(''node'',to_jsonb(n));';
BEGIN
 definition:=pg_get_functiondef('public.ecotrack_record_controller_installation(text,text,jsonb)'::regprocedure);
 IF position(old_binding IN definition)>0 THEN
  EXECUTE replace(definition,old_binding,new_binding);
 ELSIF position(new_binding IN definition)=0 THEN
  RAISE EXCEPTION 'Unrecognized installation assignment lookup; review before applying';
 END IF;

 definition:=pg_get_functiondef('public.ecotrack_finish_ac_device_registration(text,text,jsonb,jsonb)'::regprocedure);
 IF position('PERFORM public.ecotrack_record_controller_installation(' IN definition)=0 THEN
  IF position(final_return IN definition)=0 OR position('pg_advisory_xact_lock' IN definition)=0
   OR position('ecotrack_validate_ac_device_assignment' IN definition)=0
   OR position('45 seconds' IN definition)=0 THEN
   RAISE EXCEPTION 'Unrecognized AC device finalizer; review before applying';
  END IF;
  EXECUTE replace(definition,final_return,
   'IF role_name=''monitoring'' THEN'||chr(10)||
   '  PERFORM public.ecotrack_record_controller_installation(p_node_id,p_device_id,p_setup);'||chr(10)||
   ' END IF;'||chr(10)||' '||final_return);
 END IF;
END $migration$;

-- Recover only registrations whose actor, time, credential and exact room/AC
-- assignment are already saved. Never recreate dismissed/deleted inbox records
-- when installation history exists, and never infer an installer or timestamp.
WITH recovered AS (
 INSERT INTO public.controller_installations(node_id,device_id,attempt_id,request_setup,
  installer_auth_user_id,installer_profile_id,installer_name,installer_account_role,installer_role,
  controller_name,room_id,room_name,floor_id,floor_name,building_id,building_name,
  aircon_id,aircon_name,aircon_type,installed_at,event_kind)
 SELECT n.id,c.device_id,'recovery:'||n.id||':'||extract(epoch FROM n.deployment_saved_at)::text,
  jsonb_build_object('recovery_source','verified_registration'),n.admin_verified_by,
  actor.profile->>'id',coalesce(nullif(btrim(actor.profile->>'name'),''),nullif(btrim(actor.profile->>'username'),'')),
  actor.account_role,actor.profile->>'role',n.name,r.id,r.name,f.id,f.name,b.id,b.name,
  a.id,coalesce(a.name,a.asset_tag),a.aircon_type,n.deployment_saved_at,'installation'
 FROM public.nodes n
 JOIN ecotrack_private.device_credentials c ON c.node_id=n.id
 JOIN public.ecotrack_device_state live ON live.node_id=n.id AND live.device_id=c.device_id
 JOIN public.aircons a ON a.id=n.monitor_aircon_id AND a.room_id=n.room_id
 JOIN public.rooms r ON r.id=n.room_id
 JOIN public.floors f ON f.id=r.floor_id
 JOIN public.buildings b ON b.id=f.building_id
 JOIN LATERAL (
  SELECT to_jsonb(p) AS profile,'administrator'::text AS account_role
   FROM public.administrators p WHERE p.auth_user_id=n.admin_verified_by
  UNION ALL
  SELECT to_jsonb(p),'staff'::text FROM public.staff p WHERE p.auth_user_id=n.admin_verified_by
  LIMIT 1
 ) actor ON true
 WHERE n.device_mode='monitoring' AND n.admin_verified_at IS NOT NULL
  AND n.deployment_saved_at IS NOT NULL AND n.admin_verified_at<=n.deployment_saved_at
  AND n.deployment_saved_at<=clock_timestamp()
  AND NOT EXISTS(SELECT 1 FROM public.controller_installations e WHERE e.node_id=n.id)
 ON CONFLICT(node_id,attempt_id) DO NOTHING
 RETURNING *
)
INSERT INTO public.notifications(id,date,time,content,triggered,room_id,node_id,type,event_key,
 installation_id,installation,created,updated)
SELECT 'installation_'||e.id::text,to_char(e.installed_at AT TIME ZONE 'Asia/Singapore','YYYY-MM-DD'),
 to_char(e.installed_at AT TIME ZONE 'Asia/Singapore','HH24:MI:SS'),
 'AC device Installed: '||e.controller_name||' at '||e.building_name||' / '||e.floor_name||' / '||e.room_name,
 true,e.room_id,e.node_id,'controller_installation','controller_installation:'||e.id::text,
 e.id,to_jsonb(e)-'request_setup'-'attempt_id',e.installed_at,e.installed_at
FROM recovered e;

NOTIFY pgrst,'reload schema';
COMMIT;
