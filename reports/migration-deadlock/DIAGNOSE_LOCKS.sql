-- Read-only: identify the two relations from the reported deadlock.
SELECT c.oid, n.nspname AS schema_name, c.relname AS table_name, c.relkind
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE c.oid IN (17441,18784);

-- Current relation locks/blockers, without exposing SQL text or device credentials.
SELECT l.pid, a.application_name, a.state, l.relation::regclass AS relation_name,
       l.mode, l.granted, pg_blocking_pids(l.pid) AS blocking_pids
FROM pg_locks l LEFT JOIN pg_stat_activity a ON a.pid=l.pid
WHERE l.database=(SELECT oid FROM pg_database WHERE datname=current_database())
  AND l.relation IN (
    to_regclass('public.nodes'),to_regclass('public.aircons'),
    to_regclass('public.ecotrack_device_state'),to_regclass('realtime.messages'),
    17441::oid,18784::oid
  )
ORDER BY l.granted,l.pid,l.relation,l.mode;
