# Database cleanup implementation

Implemented 8 October 2026. The pre-cleanup inventory remains in REPORT.md. This file records the completed changes and exact limits of verification.

## Completed

- Removed the verified zero-byte backend/ecotrack.db, the unused in-memory data layer/demo tests, and the obsolete Node SQLite inspection script.
- Removed table-password/offline-login code, fabricated authStore state, and unused no-op methods.
- Removed PocketBase service configuration, port-8090 health checks, redundant metadata mirroring, same-backend write fallback, and the stale PocketBase SDK include.
- Removed the now-unused SupabaseTableCollection class and its filter parser. Cloud tables use the existing Supabase client directly. A small TelemetryClient keeps existing telemetry callers working through compatibility names; no PocketBase service is opened.
- Added actual SQLite PATCH updates, validated parameterized collection filters, safe sorting/pagination, and subscription notifications when the dataset becomes empty. Failed requests propagate errors rather than fabricating empty results.
- Preserved absent sensor measurements as null and consolidated the manual transfer command around the validated backend cloud importer.
- Corrected authenticated device/profile cache reconciliation, including empty results and partial deletions. Failed or unauthenticated reads preserve cached state; maintenance caches invalidate after authoritative sync.
- Removed duplicate client includes, the missing nodes.pressure select, writes to nonexistent system_logs, and the obsolete analytics snapshot UI/query/save path.
- Removed obsolete system_config/analytics_snapshots DDL from future bootstrap and moved demo inserts into explicit optional legacy seed files. Future administrator profile setup no longer assigns a default password.
- Added npm run test:database and focused frontend/API/database regressions. Updated README storage documentation.

## Verification

- 21 JavaScript/inline-script syntax checks passed; relative script assets in changed HTML resolve.
- 10 regression/verification commands passed: cleanup frontend/API, cadence, hardware, logs stability, Supabase integration, mock-data audit, cloud ingestion, scheduling, and AC state. The integration audit passed 33 checks and the mock-data audit passed 34. The Python commands passed 19 tests in total.
- Analytics, rules and telemetry pages returned HTTP 200 from a localhost test server. This verifies serving, not visual rendering.
- Browser rendering/interaction check: BLOCKED. The browser tool kernel failed twice with sandbox helper_unknown_error: setup refresh had errors. No screenshot or browser pass is claimed.
- Two existing broader checks remain failing: scripts/test_dashboard_workflows.js and scripts/test_runtime_engine.js. Both expect a 30-second fallback where the unchanged runtime code uses 15 minutes. The dashboard failure was present in the initial baseline; the focused runtime failure was also reproduced against the saved pre-cleanup logs source. Their expectations were preserved.
- Existing local telemetry remains at 539 records across 12 distinct node identifiers. Tests use temporary SQLite databases. No live Supabase schema/data operations were performed.

Raw check results: cleanup-verification.json. The task-only diff is cleanup.patch, which compares against source saved at the start of this cleanup rather than overwriting earlier user changes.

## Deferred schema changes

Profile password columns, duplicate controller bindings, protocol/image/presence/assignment fields, mobile/push tables, and the orphan telemetry_local_reset table were retained. Their deployed function/trigger/policy/Edge Function/mobile dependencies cannot be proven from the available REST metadata. dependency-review.sql contains read-only catalog queries for the next dependency review; it does not drop anything and was not executed.

Supabase and SQLite are both active. SQLite remains an independent history/archive; cloud deletion does not automatically delete this history. This cleanup fixes stale profile caches and data-access contracts, not retention policy or a full data reset.

## Recovery

Original source copies and retired files are saved at `C:\Users\reygay\AppData\Local\Temp\ecotrack-db-cleanup-before-9r028522`. cleanup-files.json lists the modified and retired files. Supabase credentials were neither copied into these artifacts nor printed; only the obsolete PB_URL entry was removed from the local environment file.

The Electron app loads these source files directly. Restart EcoTrack to load the cleanup. No packaged installer was built or published.

Diff totals: 641 added lines, 1983 removed lines compared with the task starting source, including new regression tests.

The full Git whitespace check also reports whitespace from pre-existing working changes; checks against the saved task baseline report 0 new whitespace issues.
