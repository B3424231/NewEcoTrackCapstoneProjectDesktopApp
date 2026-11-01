-- Enforce the cloud handoff even for old desktop builds or stale metadata caches.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE OR REPLACE FUNCTION ecotrack_private.guard_cloud_rule_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.rule_id IS NOT NULL AND NEW.node_id IS NOT NULL
  AND EXISTS(SELECT 1 FROM public.nodes n WHERE n.id=NEW.node_id AND n.last_measurement_report_id IS NOT NULL)
  AND (pg_trigger_depth()<=1 OR coalesce(NEW.event_key,'') NOT LIKE 'cloud-rule:%') THEN
  RETURN NULL;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION ecotrack_private.guard_cloud_rule_notification() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS ecotrack_cloud_rule_notification_guard ON public.notifications;
CREATE TRIGGER ecotrack_cloud_rule_notification_guard BEFORE INSERT ON public.notifications
 FOR EACH ROW EXECUTE FUNCTION ecotrack_private.guard_cloud_rule_notification();
COMMIT;
