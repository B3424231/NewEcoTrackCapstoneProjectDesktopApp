BEGIN;
SET LOCAL lock_timeout='5s';
CREATE OR REPLACE FUNCTION ecotrack_private.evaluate_cloud_rule_sample()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n public.nodes; r public.rules; e ecotrack_private.rule_evidence;
 sample_at timestamptz:=NEW.observed_at; checked_at timestamptz:=clock_timestamp();
 cadence numeric:=NEW.interval_seconds; threshold numeric; measured numeric; violated boolean;
 signature_value jsonb; window_day date; reason text; event text; message_text text; duration_seconds numeric;
BEGIN
 IF sample_at IS NULL OR sample_at<'1970-01-01'::timestamptz OR sample_at>checked_at+interval '5 minutes'
  OR NEW.status='schedule' OR NEW.event_type='schedule_updated' THEN RETURN NEW; END IF;
 SELECT * INTO n FROM public.nodes WHERE id=NEW.node_id;
 IF NOT FOUND THEN RETURN NEW; END IF;
 -- This one bounded latest snapshot survives removal of archived queue records.
 UPDATE public.nodes SET temp=NEW.temperature,rotation_rpm=NEW.rotation_rpm,rotation_quality=NEW.rotation_quality,
  last_measurement_at=sample_at,last_measurement_report_id=CASE WHEN left(NEW.id,6)='cloud_' THEN substring(NEW.id FROM 7) ELSE NEW.id END
 WHERE id=n.id AND (last_measurement_at IS NULL OR last_measurement_at<sample_at);
 IF nullif(n.room_id,'') IS NULL OR cadence IS NULL OR cadence NOT BETWEEN 1 AND 86400
  OR sample_at>checked_at+interval '5 seconds' OR extract(epoch FROM checked_at-sample_at)>greatest(15,3*cadence)
  OR NOT EXISTS(SELECT 1 FROM public.ecotrack_device_state h WHERE h.node_id=n.id
   AND h.last_seen BETWEEN checked_at-interval '45 seconds' AND checked_at+interval '5 seconds'
   AND (h.sleeping_until IS NULL OR h.sleeping_until<=checked_at)) THEN
  UPDATE ecotrack_private.rule_evidence SET started_at=NULL,last_alert_at=NULL,observed_at=sample_at
   WHERE node_id=n.id AND observed_at<sample_at;
  RETURN NEW;
 END IF;
 FOR r IN SELECT * FROM public.rules WHERE enabled IS TRUE AND type IN ('temperature','battery')
  AND (nullif(room_id,'') IS NULL OR room_id=n.room_id)
  AND (NOT EXISTS(SELECT 1 FROM public.rule_nodes t WHERE t.rule_id=rules.id)
   OR EXISTS(SELECT 1 FROM public.rule_nodes t WHERE t.rule_id=rules.id AND t.node_id=n.id))
 LOOP
  -- Edits/reassignment/reboots and distinct operating windows restart duration evidence.
  window_day:=CASE WHEN nullif(r.start_time,'') IS NOT NULL OR nullif(r.end_time,'') IS NOT NULL THEN (sample_at AT TIME ZONE 'Asia/Singapore')::date ELSE NULL END;
  IF r.start_time>r.end_time AND to_char(sample_at AT TIME ZONE 'Asia/Singapore','HH24:MI')<=r.end_time THEN window_day:=window_day-1; END IF;
  signature_value:=jsonb_build_array(to_jsonb(r)-'created',n.room_id,NEW.boot_id,window_day);
  INSERT INTO ecotrack_private.rule_evidence(rule_id,node_id,signature,observed_at)
   VALUES(r.id,n.id,signature_value,'-infinity') ON CONFLICT DO NOTHING;
  SELECT * INTO e FROM ecotrack_private.rule_evidence WHERE rule_id=r.id AND node_id=n.id FOR UPDATE;
  IF sample_at<=e.observed_at THEN CONTINUE; END IF;
  measured:=CASE WHEN r.type='temperature' THEN NEW.temperature ELSE NEW.battery END;
  threshold:=r.value; violated:=false;
  IF r.type='temperature' AND r.unit='°F' THEN threshold:=(threshold-32)*5/9; END IF;
  IF r.type='battery' AND measured<=5 THEN measured:=round(measured/4.2*100); END IF;
  IF measured IS NOT NULL AND threshold IS NOT NULL AND sample_at>=greatest(r.created,r.updated)
   AND ecotrack_private.rule_schedule_allows(r,sample_at) AND ecotrack_private.rule_schedule_allows(r,checked_at) THEN
   violated:=CASE r.condition WHEN 'above' THEN r.type='temperature' AND measured>threshold
    WHEN 'below' THEN measured<threshold WHEN 'equals' THEN abs(measured-threshold)<CASE WHEN r.type='temperature' THEN 0.2 ELSE 2 END ELSE false END;
  END IF;
  IF NOT violated THEN
   UPDATE ecotrack_private.rule_evidence SET observed_at=sample_at,started_at=NULL,last_alert_at=NULL,
    signature=signature_value,interval_seconds=cadence WHERE rule_id=r.id AND node_id=n.id;
   CONTINUE;
  END IF;
  IF e.started_at IS NULL OR e.signature IS DISTINCT FROM signature_value OR e.interval_seconds IS NULL
   OR extract(epoch FROM sample_at-e.observed_at)>1.5*least(cadence,e.interval_seconds) THEN
   e.started_at:=sample_at; e.last_alert_at:=NULL;
  END IF;
  duration_seconds:=greatest(coalesce(r.duration,0),0)*60;
  IF extract(epoch FROM sample_at-e.started_at)>=duration_seconds
   AND (e.last_alert_at IS NULL OR extract(epoch FROM sample_at-e.last_alert_at)>=greatest(duration_seconds,60)) THEN
   event:='cloud-rule:'||md5(r.id||':'||n.id||':'||e.started_at::text||':'||sample_at::text);
   reason:=CASE WHEN r.type='temperature' THEN 'Temperature '||r.condition||' '||r.value::text||coalesce(r.unit,'°C')
    ||' (was '||round(measured)::text||'°C)' ELSE 'Battery dropped to '||measured::text||'%' END;
   message_text:=n.name||'|||'||reason||'. '||coalesce(nullif(r.message,''),'Environmental threshold exceeded');
   INSERT INTO public.notifications(id,date,time,content,triggered,room_id,rule_id,node_id,type,event_key)
    VALUES('rule_'||md5(event),to_char(checked_at AT TIME ZONE 'Asia/Singapore','YYYY-MM-DD'),
     to_char(checked_at AT TIME ZONE 'Asia/Singapore','HH12:MI:SS AM'),message_text,true,n.room_id,r.id,n.id,r.type,event)
    ON CONFLICT DO NOTHING;
   -- Admin-visible event plus explicitly assigned recipients; never broadcast other rooms' data.
   INSERT INTO public.mobile_notifications(id,event_key,staff_id,staff_name,is_broadcast,title,message,type,priority,category,aircon_name,location)
    VALUES('mob_'||md5(event),event,NULL,'Administrators',false,'Sensor Rule Alert',message_text,'sensor_alert','high','sensor',n.name,n.room_id)
    ON CONFLICT DO NOTHING;
   INSERT INTO public.mobile_notifications(id,event_key,staff_id,staff_name,is_broadcast,title,message,type,priority,category,aircon_name,location)
    SELECT 'mob_'||md5(event||':'||s.id),event||':'||s.id,s.id,s.name,false,'Sensor Rule Alert',message_text,'sensor_alert','high','sensor',n.name,n.room_id
    FROM public.staff s WHERE s.room_id=n.room_id AND NOT coalesce(s.is_archived,false) AND NOT coalesce(s.force_logout,false)
     AND lower(coalesce(s.status,'')) NOT IN ('archived','deactivated','disabled') ON CONFLICT DO NOTHING;
   e.last_alert_at:=sample_at;
  END IF;
  UPDATE ecotrack_private.rule_evidence SET signature=signature_value,observed_at=sample_at,started_at=e.started_at,
   interval_seconds=cadence,last_alert_at=e.last_alert_at WHERE rule_id=r.id AND node_id=n.id;
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION ecotrack_private.evaluate_cloud_rule_sample() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS ecotrack_cloud_rule_sample ON public.telemetry;
CREATE TRIGGER ecotrack_cloud_rule_sample AFTER INSERT ON public.telemetry FOR EACH ROW EXECUTE FUNCTION ecotrack_private.evaluate_cloud_rule_sample();

COMMIT;
