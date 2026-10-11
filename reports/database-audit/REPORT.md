# EcoTrack database audit

Implementation status: see [CLEANUP.md](CLEANUP.md). This inventory describes the state before cleanup.

Date: 8 October 2026 (Asia/Singapore).

The app has two active stores: Supabase and backend/telemetry.db. The PocketBase name now refers to a compatibility adapter, not a third database. Clear leftovers exist in code and configuration; several schema fields overlap, but cloud table removal requires a review of mobile and deployed server dependencies.

This audit created documentation/evidence files only. No application code, database records, schemas, or access policies were changed.

## Scope and confidence

Inspected desktop and firmware runtime source, SQL setup/migrations, tests, package configuration, and relevant scratch references. Retrieved REST metadata for 21 exposed Supabase tables and 267 columns. Used read-only exact row counts and schema probes; did not retrieve private record contents or password values. Opened SQLite files with mode=ro and inspected schema, counts, and indexes.

Evidence files: cloud-schema.json, cloud-counts.json, table-references.json, column-references.json, and read-only-probes.json.

The reference index is a text search, not a table-aware parser. A field hit may refer to another table. No literal reference does not prove a field unused by remote consumers. REST metadata does not expose deployed function/trigger/policy bodies or every private object. Mobile application source and deployed Edge Function implementations were not audited. Row counts are a point-in-time snapshot, not proof of long-term use.

## Database files and local tables

| Item | Evidence | Assessment |
| --- | --- | --- |
| Supabase | Registry, hierarchy, users, maintenance, automation, notifications, firmware telemetry | Keep |
| backend/telemetry.db | 539 telemetry rows across 12 distinct node identifiers | Active local history; keep unless history is deliberately moved to the cloud |
| backend/ecotrack.db | Zero bytes, no tables, no source/test/scratch references | Clear removal candidate in this checkout |
| SQLite telemetry | Logs, analytics, historical charts, automation and schedule records | Keep |
| SQLite schedule_dispatches | 3 rows; queue creation, dispatch updates and job status reads | Keep |
| SQLite cloud_sync_state | 0 rows; read/write cursor implementation in backend/app.py:335 and :357 | Keep despite being empty |
| SQLite telemetry_local_reset | 1 row; no creation/read/write source references found | Orphan candidate; establish its origin before dropping, because another version may have used it for reset semantics |

The SQLite file is 5,902,336 bytes, with 1,341 free pages at 4,096 bytes/page: 5,492,736 bytes are available for reuse. Its size is largely retained free space, not another hidden dataset. Its current indexes have distinct definitions; no duplicate local index was found. No compaction was performed.

## Cloud table inventory

| Table | Rows | Assessment |
| --- | ---: | --- |
| administrators | 2 | Active administrator profiles and Auth linkage; keep |
| aircons | 0 | Active AC asset and command state; keep |
| buildings | 3 | Active location hierarchy; keep |
| ecotrack_auth_attempts | 0 | Auth-attempt RPC exists; no direct desktop table reference is not evidence of disuse |
| ecotrack_maintenance_operations | 1 | Appears to support maintenance operation replay/idempotency; inspect deployed maintenance functions |
| ecotrack_push_deliveries | 0 | Push delivery claiming RPC is exposed; inspect server dependencies |
| ecotrack_push_wake_tokens | 0 | Worker authorization/wake RPCs are exposed; inspect server dependencies |
| floors | 2 | Active location hierarchy; keep |
| maintenance_reports | 1 | Active maintenance workflow; keep |
| mobile_notification_state | 0 | Appears to hold per-recipient state; inspect mobile/RPC dependencies |
| mobile_notifications | 0 | Referenced by notification trigger and report-deletion SQL; keep while mobile notifications are supported |
| nodes | 0 | Active controller registry; keep |
| notifications | 0 | Active desktop inbox/history; keep |
| registration_tasks | 0 | No desktop/firmware references; conditional mobile-workflow cleanup candidate |
| rooms | 0 | Active location hierarchy; keep |
| rule_nodes | 0 | Active rule/controller assignments; keep |
| rules | 0 | Active automation; keep |
| staff | 3 | Active staff profiles and maintenance assignment; keep |
| staff_locations | 0 | No desktop references; conditional candidate, pending room-access/assignment/mobile review |
| staff_push_tokens | 0 | Push registration/unregistration RPCs are exposed; inspect server/mobile dependencies |
| telemetry | 0 | Firmware uploads here; backend ingests it; keep |

## Classes, adapters and obsolete code

| Component | Finding | Recommendation |
| --- | --- | --- |
| Sqlite3TelemetryCollection | public/js/supabase-client.js:226; active telemetry collection callers | Keep functionality; make the SQLite role explicit |
| SupabaseTableCollection | supabase-client.js:366; active metadata collection callers in node-sync | Keep until callers use explicit Supabase operations |
| DualDatabaseClient / window.PocketBase / window.pb | supabase-client.js:557 and :590; routes telemetry to SQLite and everything else to Supabase | Used compatibility adapter, not another database. Removing it now breaks active pages |
| authWithPassword() | supabase-client.js:495; definition only, no callers; table-password comparison and offline admin fallback remain | Remove unused legacy login path; current login uses Supabase Auth/account-login |
| authStore | supabase-client.js:560; definition only, no consumers; creates a valid/default admin identity | Remove unused fabricated auth state |
| autoCancellation() | supabase-client.js:576; unused no-op | Remove |
| getPocketBase() real-PocketBase branches | node-sync.js:30; realPocketBase, port 8090 and missing pocketbase/cjs package remain | Remove obsolete real-PocketBase fallbacks after retaining current router access |
| syncSupabaseNodesToPocketBase() | node-sync.js:49; reads Supabase nodes/rooms, then mirrors metadata through pb, which routes back to the same Supabase tables | Retire redundant metadata mirroring. Preserve any needed local telemetry enrichment through a correct update API |
| saveNodeTelemetryToPocketBase() | node-sync.js:254; active local telemetry writer and live-node update path | Keep and rename. Its fallback retries the same local backend through the adapter |
| EcoTrackDataLayer | data-logic.js:6; in-memory rooms/nodes/rules/history. Only obsolete data-tests imports it; no HTML loads it | Retire demo/test data layer from production assets |
| data-schemas.js / data-tests.js | Generator now returns empty arrays; old test still expects four rooms/five rules/sample history | Retire or replace obsolete demo tests |
| ACControllerDeviceService / AirconProfileManager | Active controller/profile services and local caches | Keep; correct authoritative empty-result reconciliation |
| CentralLogService | Active local audit log, plus a write to missing system_logs | Keep audit behavior; choose a working persistence destination |
| getSupabaseAdmin() | src/main.js:317; despite name, uses a public key and mirrored user session | Separate renderer/main clients support process boundaries. Rename for clarity rather than deleting |
| Flask telemetry/schedule resource classes | Routes and consumers exist | Keep |

Other cleanup candidates:

- public/js/shared.js:160 still probes port 8090 for PocketBase. It can misreport connection health now that control logs use Flask/SQLite.
- PB_URL remains in src/preload.js:12 and .env.example. Remove it with the obsolete fallback paths.
- scripts/check_telemetry_db.js requires sqlite3, which is neither declared nor resolvable. The Python backend already provides SQLite access.
- scripts/transfer_supabase_to_sqlite.py duplicates backend/app.py:295 ingestion and schema setup. It ignores ECOTRACK_SQLITE_DB_PATH, omits newer interval/AC/snapshot fields, and supplies invented default measurements. Consolidate around one validated importer; retain a thin manual entry point only if needed.
- public/rules.html loads supabase-client.js at lines 17 and 837; public/telemetry.html loads it at lines 23 and 456. Remove duplicate includes to prevent client/subscription reinitialization.

## Column consolidation candidates

These need migrations and consumer updates rather than immediate DROP COLUMN operations.

| Columns | Finding and target |
| --- | --- |
| administrators.password, staff.password | Current desktop login/password changes use Supabase Auth. The unused adapter still checks administrators.password. Both administrator rows and all three staff rows have non-null password fields; their format was not inspected. Review deployed login/provisioning dependencies, then remove profile-table password storage |
| aircons.node_id, aircons.controller_node_id, nodes.aircon_id | Three controller/asset bindings, with foreign keys in both directions. Choose one authoritative mapping and enforce intended cardinality. Firmware currently queries aircons by node_id; migrate firmware/RPC/mobile consumers together |
| aircons.protocol, protocol_name | Compatibility migration adds both. Live defaults differ: DAIKIN216 versus midea_ir. Standardize on protocol_name after migrating old consumers and values |
| staff.avatar/photo_url/avatar_url; equivalent administrator image fields | Multiple representations of one profile image. Staff editing writes identical image values to photo_url and avatar_url (staff.js:1084). Keep one canonical storage reference after backfill |
| nodes.image_url/photo_url | Parallel image names; verify mobile/controller consumers and retain one canonical reference |
| staff.status/is_online/online_status | Presence stored in three forms; status also contains account lifecycle labels. Separate lifecycle from presence and keep one authoritative presence value plus last_active |
| staff.is_active/is_archived | Related but not necessarily interchangeable: disabled need not mean archived. Preserve semantics until Auth/archive consumers are audited |
| staff.assignment, building_name/floor_name/room_name, room_id, assignment_scope, assigned_floor_id/assigned_building_id, plus staff_locations | Old string/label assignments and relational scope assignments coexist. Desktop edits still write older fields. Standardize on the model used by room-access/maintainer functions and derive display labels |
| brand/aircon_type/protocol_name on both nodes and aircons | Asset metadata overlaps controller configuration. Prefer AC asset metadata on aircons and hardware/network/schedule on nodes, retaining a defined firmware projection where required |
| aircons.model/aircon_type | Code sometimes puts category/type text into model. Keep distinct if model contains a real manufacturer model; remove fallback duplication |
| nodes.install_date/ble_uuid/maintainer_id; aircons.install_date/cooling_capacity_hp | No literal references in inspected runtime. Low-confidence removal candidates; mobile may use these asset/assignment fields |
| aircons.command_status_at | No local literal reference, but command acknowledgement/reporting RPCs exist. Verify server consumers |
| maintenance_reports.aircon_id | Live FK points to nodes.id, and normal report creation writes a controller ID (maintenance-modal.js:1553 and :3795). Column name implies an AC asset. Consider an AC FK plus explicit controller reference so maintenance follows the asset when hardware changes |

Repeated information that should be preserved:

- telemetry sensor/location/type names are historical snapshots, preserving context after moves/deletions.
- nodes.temp/battery/rssi/status serve latest-reading/connectivity views; history serves a different purpose.
- aircons.desired_state and reported_state distinguish requested settings from observed feedback; command ID/status/timestamps support delivery tracking.
- telemetry.ac_on and control_snapshot distinguish explicit operating feedback from command/configuration context.
- Local event_type/wake_time/sleep_time/ac_state/ac_on are all unpopulated in the 539 current rows, but current APIs accept them and schedule recording writes event/schedule fields (app.py:746). Empty columns are not automatically unused.
- parent_report_id/linked_repair_id support report relationships and deletion.
- auth_user_id/auth_valid_after/force_logout/phone_digits/admin_id may be consumed by deployed Auth/access functions or policies despite no direct desktop field references.

## Schema drift and incorrect persistence

1. analytics_snapshots returns HTTP 404, but analytics.js:1030 still reads it. The save button targets /api/analytics/snapshot (line 1008), absent from backend routes. Retire the feature/DDL together or implement its store and endpoint.
2. system_logs returns 404, but aircon-system.js:315 attempts cloud inserts. Choose cloud audit storage or an explicitly local log and remove the failed write.
3. nodes.pressure is absent from live schema; scheduler.js:709 still selects it. The exact select returns HTTP 400. Repair that query. Telemetry pressure remains used by history/prediction code.
4. system_config has no runtime table references and returns 404. Retire obsolete bootstrap DDL if configuration continues to live elsewhere; there is no exposed live table to drop.
5. supabase_schema.sql seeds sample administrator/location/node/rule records; supabase_mobile_notifications_setup.sql seeds demonstration notifications. Re-running setup can reintroduce data. Separate optional demo seeds from schema migrations.
6. aircon-system.js:409 exits on empty nodes/aircons without clearing caches; line 578 also retains cached profiles lacking matching cloud nodes. Verified empty results should reconcile caches; request/Auth errors need separate treatment.
7. app.py:348 uses creation-cursor ingestion with insert-ignore, not deletion reconciliation. Cloud deletion does not remove local history. Choose an explicit archive/mirror and reset policy.
8. SQLite adapter update() posts to an insert-ignore endpoint, so existing records are not updated. It forwards PocketBase filter strings which the backend reads but never applies. Its polling subscription only invokes callbacks when items exist and cannot announce an empty dataset. Repair these contracts during adapter cleanup.

## Suggested order

1. Repair missing-table/column calls and empty-result reconciliation.
2. Remove unused login/fake-auth/no-op code, obsolete demo assets/tests, duplicate script includes, port-8090 configuration, and the empty ecotrack.db file.
3. Simplify redundant metadata sync and share one validated importer while retaining active hardware telemetry, schedules and cloud ingestion.
4. Inspect deployed function bodies, triggers, policies, Edge Functions and mobile code for every proposed schema removal.
5. Define and backfill canonical controller, assignment, image and presence fields; update all consumers before dropping compatibility columns. Address profile-table password storage early.
6. Decide whether local history is an intentional archive/offline store or a cloud mirror, then implement matching retention/deletion behavior.

No cloud table is certified safe to drop from the available evidence. Immediate cleanup is strongest in dead code and obsolete configuration; schema cleanup requires targeted migrations.
