# Automatic command retention

Prepared on 2026-10-09. Run the complete [migration](C:/Users/reygay/Desktop/EcoTrackDesktopDashboardNew-main-control/supabase_command_retention_migration.sql) once as project owner in Supabase SQL Editor, after the existing cloud hardware migration. It creates/uses pg_cron and schedules ecotrack-command-cleanup every five minutes. Supabase's [Cron installation](https://supabase.com/docs/guides/cron/install) and [job setup](https://supabase.com/docs/guides/cron/quickstart) document the database scheduler.

The command queue keeps fresh completed, failed, expired and superseded receipts for one hour from completion. This permits UI polling and acknowledgement retries. The cleanup removes older terminal rows in batches of at most 5,000, expires overdue queued/claimed rows even while the ESP32 is offline, and marks only the matching current AC request Failed. Unexpired queued/claimed commands remain available. Current AC settings, transmitted/failed result status, latest IR observations, registrations, telemetry and other history are preserved.

A valid device's acknowledgement for an already-deleted command is ignored without recreating it or changing an AC result. Credentials, cross-device checks, claimed-command checks and actual receipt validation remain enforced. This avoids a delayed ACK being mistaken for a cloud authentication failure. The migration updates the existing device exchange function and reloads the schema cache.

Only this cleanup job's completed run history older than seven days is pruned. The cleanup routine is private and is not executable by anonymous devices or authenticated browser users.

Ten PostgreSQL checks passed using PGlite: repeated installation with a cron catalog fixture, fresh receipt/retry preservation, four terminal status deletions, retained current AC/IR state, late ACK handling, cross-device/missing-ID denial, valid pending command retention, offline expiry/current-request safety, owner-only access, scoped cron history and bounded backlog deletion. PGlite does not run pg_cron; the schedule catalog and registration were fixtures.

Live cleanup is NOT active from these local edits alone. Browser access failed to initialize; no SQL execution connector is available. No live rows were deleted. Run the migration in Supabase to activate it; the first run removes already-old terminal rows and reports expired/deleted counts.

To inspect activation after installation:
```sql
SELECT jobid, jobname, schedule, active
FROM cron.job WHERE jobname = 'ecotrack-command-cleanup';

SELECT status, count(*) FROM public.ecotrack_device_commands GROUP BY status;

SELECT start_time, end_time, status, return_message
FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'ecotrack-command-cleanup')
ORDER BY start_time DESC LIMIT 10;
```

This bounds command retention. Other database tables have their own storage requirements.
