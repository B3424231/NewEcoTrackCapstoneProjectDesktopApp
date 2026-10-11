-- Read-only hardware status for active staff in their current admin-assigned room.
-- Cloud registration, commands, private Broadcast, and credentials remain admin-only.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '20s';
DO $$ BEGIN
 IF to_regclass('public.ecotrack_device_state') IS NULL
   OR to_regprocedure('public.ecotrack_staff_id()') IS NULL
   OR to_regprocedure('public.ecotrack_can_access_room(text)') IS NULL THEN
  RAISE EXCEPTION 'Install EcoTrack cloud hardware and authentication migrations first';
 END IF;
END $$;
DROP POLICY IF EXISTS ecotrack_device_state_assigned_staff_read ON public.ecotrack_device_state;
CREATE POLICY ecotrack_device_state_assigned_staff_read
 ON public.ecotrack_device_state FOR SELECT TO authenticated
 USING (
  public.ecotrack_staff_id() IS NOT NULL
  AND EXISTS (
   SELECT 1 FROM public.nodes n
   WHERE n.id = ecotrack_device_state.node_id
     AND public.ecotrack_can_access_room(n.room_id)
  )
 );
COMMIT;
SELECT policyname, cmd, roles, qual
FROM pg_policies
WHERE schemaname='public' AND tablename='ecotrack_device_state'
 AND policyname='ecotrack_device_state_assigned_staff_read';
