-- Run once as the project owner in Supabase SQL Editor.
-- Requires supabase_cloud_hardware_migration.sql. Does not delete pending valid commands.
-- Finished command receipts are kept for 1 hour; cleanup runs every 5 minutes.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $$ BEGIN
 IF to_regclass('public.ecotrack_device_commands') IS NULL THEN
  RAISE EXCEPTION 'Install the EcoTrack cloud hardware migration first';
 END IF;
END $$;

ALTER TABLE public.ecotrack_device_commands ADD COLUMN IF NOT EXISTS finished_at timestamptz;
UPDATE public.ecotrack_device_commands
 SET finished_at=coalesce(acknowledged_at,CASE WHEN status='expired' THEN expires_at ELSE created_at END)
 WHERE status IN ('completed','failed','expired','superseded') AND finished_at IS NULL;

CREATE OR REPLACE FUNCTION ecotrack_private.stamp_finished_command()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
 IF NEW.status IN ('completed','failed','expired','superseded') THEN
  IF TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status OR NEW.finished_at IS NULL THEN
   NEW.finished_at := now();
  END IF;
 ELSE NEW.finished_at := NULL;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION ecotrack_private.stamp_finished_command() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS ecotrack_stamp_finished_command ON public.ecotrack_device_commands;
CREATE TRIGGER ecotrack_stamp_finished_command
 BEFORE INSERT OR UPDATE OF status ON public.ecotrack_device_commands
 FOR EACH ROW EXECUTE FUNCTION ecotrack_private.stamp_finished_command();
CREATE INDEX IF NOT EXISTS ecotrack_finished_commands_cleanup_idx
 ON public.ecotrack_device_commands(finished_at)
 WHERE status IN ('completed','failed','expired','superseded');
CREATE INDEX IF NOT EXISTS ecotrack_expiring_commands_cleanup_idx
 ON public.ecotrack_device_commands(expires_at)
 WHERE status IN ('queued','claimed');

CREATE OR REPLACE FUNCTION ecotrack_private.cleanup_device_commands()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
SET lock_timeout = '2s' AS $$
DECLARE expired_count integer; deleted_count integer;
BEGIN
 -- Preserve a failure receipt first, including for a device that never reconnects.
 WITH overdue AS (
  SELECT id FROM public.ecotrack_device_commands
  WHERE status IN ('queued','claimed') AND expires_at<=now()
  ORDER BY expires_at,id LIMIT 5000 FOR UPDATE SKIP LOCKED
 ), expired AS (
  UPDATE public.ecotrack_device_commands c
  SET status='expired',result=jsonb_build_object('success',false,'command_id',c.id,'error','Command expired before completion')
  FROM overdue WHERE c.id=overdue.id RETURNING c.*
 ), affected_aircons AS (
  UPDATE public.aircons a SET command_status='failed',command_status_at=now()
  FROM expired c WHERE c.kind='ac_intent' AND a.id=c.payload->>'aircon_id'
  AND a.command_id::text=c.id::text AND a.command_status='queued'
  RETURNING a.id
 )
 SELECT count(*) INTO expired_count FROM expired;

 -- Keep the receipt long enough for UI polling, delayed notifications and acknowledgement retries.
 WITH stale AS (
  SELECT id FROM public.ecotrack_device_commands
  WHERE status IN ('completed','failed','expired','superseded')
  AND finished_at<now()-interval '1 hour'
  ORDER BY finished_at,id LIMIT 5000 FOR UPDATE SKIP LOCKED
 )
 DELETE FROM public.ecotrack_device_commands c USING stale WHERE c.id=stale.id;
 GET DIAGNOSTICS deleted_count=ROW_COUNT;

 -- Keep only seven days of this cleanup job's own run history.
 DELETE FROM cron.job_run_details d USING cron.job j
 WHERE d.jobid=j.jobid AND j.jobname='ecotrack-command-cleanup'
 AND d.end_time<now()-interval '7 days';
 RETURN jsonb_build_object('expired',expired_count,'deleted',deleted_count);
END $$;
REVOKE ALL ON FUNCTION ecotrack_private.cleanup_device_commands() FROM PUBLIC,anon,authenticated;

SELECT cron.schedule('ecotrack-command-cleanup','*/5 * * * *',
 'SELECT ecotrack_private.cleanup_device_commands();');
-- Remove already-old terminal rows now. The next runs do not depend on the desktop or ESP32.
SELECT ecotrack_private.cleanup_device_commands();
COMMIT;
