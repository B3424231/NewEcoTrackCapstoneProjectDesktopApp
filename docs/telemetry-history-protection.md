# Telemetry delivery and history protection

Implemented locally on 2026-10-23 in the desktop and mobile `-control` checkouts. No production records were removed or changed during testing.

## Resulting flow

Hardware records an actual observation, persists its original ID/time/interval in LittleFS, uploads to the authenticated Supabase RPC, and removes it from the board only after receiving matching acknowledgements. The desktop importer commits and verifies SQLite history before acknowledging removal of those exact cloud rows. Analytics and Telemetry continue to read SQLite. The existing delayed-row sweep also imports older measurements arriving after the normal import cursor.

A cloud replay watermark retains only each registered device's delivery position. It prevents an upload retried after cloud cleanup from recreating already archived readings. It contains no temperature/RPM history. Supabase remains a temporary bridge and a store for device configuration and other existing application entities.

## Desktop behavior

- A device heartbeat determines Connected/Sleeping/Disconnected independently from measurement freshness. Cards and details show the actual measurement timestamp; importing an old buffered reading cannot make it fresh.
- A SQLite change version identifies affected devices. Normal polling requests changes and avoids reloading history and analytics when nothing changed. Registry polling has a 60-second fallback and reacts to metadata events. Heartbeats use a separate realtime channel with a bounded fallback read.
- Sync health checks, cloud pending counts, cleanup status, disk checks and scheduled snapshots run in the backend. Analytics, Telemetry and AC Energy Forecast have no history-status panel and do not poll the diagnostic endpoint. Backend diagnostics remain available locally for troubleshooting.
- Health endpoints are local-only. Cloud credentials stay in the backend.

## Backups

While the Flask backend runs, the first health cycle makes a verified online SQLite snapshot. Subsequent snapshots run every 24 hours by default; seven completed automatic snapshots are retained. The SQLite backup API includes committed WAL data, then an integrity check and atomic rename publish the snapshot. Failed snapshots retain previous backups and never delete source history. Rotation touches only this service's completed snapshot names.

Defaults can be changed through the backend environment:

| Setting | Default |
| --- | --- |
| ECOTRACK_BACKUP_ENABLED | 1 |
| ECOTRACK_BACKUP_INTERVAL_SECONDS | 86400; minimum 60 |
| ECOTRACK_BACKUP_KEEP | 7; minimum 2 |
| ECOTRACK_BACKUP_DIR | database folder/backups/automatic |
| ECOTRACK_DISK_WARNING_BYTES | 536870912 |

Low disk space also warns below 5% free space. The service skips backup creation when the target lacks the database size plus the configured reserve. An invalid numeric setting uses the safe default. Use another drive or separately copied snapshots for protection against failure of the database drive; the default backup directory shares that drive. Backups run only while the backend runs. Permanent SQLite history continues to grow; disk warnings and snapshots do not create unlimited storage or automatically delete history. Pending cloud rows can also grow while the desktop is offline.

## Mobile behavior

Home, AC Devices, Maintenance and Notifications pause refresh tasks in the background and refresh on return. Events coalesce, and pre-background responses cannot replace a current screen snapshot. Heartbeat updates affect the matching visible device; local age timers do not reload related tables. Home fallback polling requests visible device IDs and an overlapping last_seen cursor, with a full inventory fallback after 60 seconds. Successful location-reference reads are reused for 60 seconds and invalidated by edits and authentication changes; failed reads are never cached. Generation checks prevent late reads from restoring invalidated account data. Measurement-only node events do not trigger metadata reloads.

The mobile app retains its registration/maintenance architecture. This change does not connect it to desktop SQLite history or add a new mobile telemetry pipeline.

## Hardware limits

The current cloud sketch and `telemetry-outbox.h` match in both repositories. The queue retains up to 1,024 readings, subject to available flash and a 32 KiB reserve. It never overwrites unconfirmed readings. A full or unreadable queue reports an error; sampling that cannot be persisted is counted. It is a bounded outage buffer, not unlimited storage.

Clock synchronization is required before creating timestamped history. A cold boot without a usable clock waits rather than inventing times. Sampling follows the configured send interval while awake, and actual observation timestamps remain authoritative if network work delays a sample. Previously stored Wi-Fi settings and the existing private device-token authentication remain in use. Original node assignments are validated; changing an assignment does not relabel pending history.

## Activation

1. Review and apply `supabase/migrations/202610230001_measurement_outbox.sql` after the existing cloud-hardware/rotation migrations. It adds measurement metadata, private replay state and the authenticated upload RPC; it does not remove history. Existing firmware remains compatible.
2. Restart the desktop/backend to load the health worker and change-tracking API. Reload the desktop pages to load updated assets.
3. Build/install the updated mobile app for native use. A current web export is in the mobile repository under `artifacts/pipeline-resilience/web`.
4. Flash the current `firmware/ecotrack_cloud_measurements` sketch and header together after checking wiring. The tested target is ESP32-S3 with the `huge_app` partition. A missing RPC leaves readings queued and reports the required cloud update.
5. Verify an actual outage/reconnect and a power interruption on a test device. Check that original measurement times survive, cloud rows disappear only after desktop archival, SQLite history remains, and the local backend diagnostic endpoint reports backup success.

The migration was tested in disposable PostgreSQL-compatible PGlite, but was NOT applied to the live project: database migration credentials are not configured in this workspace. Firmware compiled successfully, but was NOT flashed. Physical power-loss, full-queue and sensor behavior are NOT RUN. The native APK was NOT rebuilt or installed. Source changes and a web export alone do not update installed apps or boards.

## Verification

- PASS: 6 temporary-SQLite history protection checks, including live-WAL restore, retention, low-space behavior, invalid settings, incremental device changes and local health access.
- PASS: 27 monitoring tests and 11 cloud importer/cleanup tests against temporary databases and mocked HTTP.
- PASS: isolated PostgreSQL-compatible migration checks: original timestamps/cadence, zero/null values, explicit acknowledgement, conflict rejection, FIFO validation, atomic rollback, replay after cloud cleanup and private bounded state.
- PASS: 71 focused mobile tests, including background lifecycle, cache invalidation/account races and scoped heartbeat queries.
- PASS: TypeScript validation and mobile web export.
- PASS: 16 existing desktop browser scenarios plus 11 focused priority/freshness/background-only scenarios; desktop and 390px layouts in dark/light themes.
- PASS: actual mobile web first/return visits, failed-refresh content retention, and background/resume behavior on all four screens in dark/light themes. The final account-cache guard additionally has an isolated regression test.
- PASS: maintenance equipment-table regression and 48 no-mock-data integrity checks.
- PASS: ESP32-S3 compile, 1,687,781 bytes program and 59,668 bytes static RAM.
- Existing failure: `scripts/test_maintenance_save.js` expects raw `Report changed`, while the implementation returns the existing friendly concurrency message. The identical assertion fails against saved pre-change source. It was not changed as part of this work.

Desktop UI evidence: `reports/pipeline-resilience/ui/verification.json` and screenshots. Existing broad browser evidence: `reports/pipeline-resilience/browser/browser-verification.json`. Firmware build: `reports/pipeline-resilience/firmware-build`. Tests use temporary databases and intercepted cloud requests, never live writes.

## Priority icon correction

The Maintenance priority dropdown's colored dots now use solid semantic colors rather than dark notice backgrounds. The selected check mark updates when a different option is chosen. The native form value and existing report save behavior are preserved. All four priorities were checked in light and dark themes.

## Background-only history status update (2026-10-23)

Removed the front-page history status panel, device buffer summary and diagnostic polling from all three sensor pages. The backend sync/retry and scheduled-backup workers, local diagnostic endpoints, and actual measurement/connection indicators remain enabled. Reload the desktop pages to pick up the updated assets.

Verification of the background-only update: PASS on Analytics, Telemetry and AC Energy Forecast at 1460px/390px in dark/light themes, with no history-status element and no diagnostic HTTP polling. PASS: six backup/history protection checks plus an actual background-thread run that created a verified snapshot and checked health without a UI request. PASS: 48 integrity checks. Evidence: `reports/background-history/verification.json`.
