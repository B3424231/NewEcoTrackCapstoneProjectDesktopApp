# EcoTrack Entity Relationship Diagrams and Data Dictionary

The Data Dictionary serves as a reference for the fields used in the EcoTrack system. It lists each database table and its fields, along with their data types, constraints, and descriptions. Following the sample capstone format, this section explains how each table contributes to the system’s data structure and helps maintain consistency during development, testing, and maintenance.

## Scope and interpretation

- Schema snapshot: 30 October 2026. Scope is 26 EcoTrack-owned cloud tables (23 public + 3 ecotrack_private) and 16 desktop SQLite tables. Supabase Auth users are an external reference, documented only for id and email; its full provider schema is outside this dictionary.
- Both applications use the same cloud schema. Administrator access is desktop-only; staff access is mobile-only. These role restrictions are application access boundaries, not separate databases. Mobile does not connect directly to desktop SQLite.
- PK = primary key; FK = declared database foreign key; UNIQUE/UK = uniqueness constraint; REF = application association without a declared FK. A composite key applies to the entire listed tuple, not each member independently. Partial/expression unique indexes apply only under their exact predicates.
- Null means unavailable/unknown where applicable. The current firmware excludes MCP9808 temperature sensing and battery measurement. Existing nullable temperature/battery history columns are preserved exactly as found; they do not imply current sensors or new readings.
- Cloud schedules are embedded in nodes.wake_time, sleep_time, interval_val/interval_unit and device configuration JSON. There is no dedicated cloud schedules table in the captured schema. Desktop sensor_schedules is a separate local table.
- public.telemetry supplies a temporary cloud bridge/live measurement stream; desktop services import and retain permanent telemetry history in SQLite. The two tables named telemetry are distinct physical stores, and no cross-database FK exists.
- A desired state, queued command, IR transmission, acknowledgment, or online device does not prove physical AC operation. Runtime must use trustworthy explicit AC-on evidence and observed timestamps/cadence.
- The actual maintenance_reports.aircon_id foreign key points to public.nodes.id. Telemetry node_id/aircon_id and staff.room_id have no database FK. The reciprocal equipment/device keys do not enforce that both directions agree. aircons.controller_node_id is not unique; nodes.monitor_aircon_id has conditional uniqueness for monitoring/both devices.
- PostgreSQL types, nullability, keys, defaults, checks, and index DDL come from read-only catalog metadata. SQLite definitions come from the actual local file schema. Field meanings are explanatory summaries inferred from inspected schema and application code, not database comments or additional constraints.
- SQLite TEXT primary keys may report notnull=0 and can accept null in ordinary rowid tables; declarations are reported as captured. INTEGER PRIMARY KEY identifies the non-null rowid. SQLite stores boolean flags as INTEGER and JSON/timestamps as TEXT here; no extra type/JSON validation is implied. The monitoring connection enables PRAGMA foreign_keys=ON; SQLite FK enforcement remains connection-specific.
- This is a table/column dictionary and relationship model, not a full security or behavioral specification: RLS, grants, trigger bodies, function bodies, storage buckets, and JSON member schemas are not exhaustively documented. No application records or credential values were queried for this documentation.

## ERD artifacts

- [Shared cloud core ERD](diagrams/erd-shared-cloud.png) ([editable SVG](diagrams/erd-shared-cloud.svg)).
- [Shared cloud control and notification ERD](diagrams/erd-cloud-operations.png) ([editable SVG](diagrams/erd-cloud-operations.svg)).
- [Desktop local ERD](diagrams/erd-desktop-local.png) ([editable SVG](diagrams/erd-desktop-local.svg)).
- [Complete cloud model, editable Mermaid](diagrams/erd-cloud-full.mmd) and [complete local model](diagrams/erd-local-full.mmd). These include every captured application table and declared FK; dashed links are selected documented logical associations.
- [Standalone HTML dictionary](../reports/erd-20261030/data-dictionary.html), [all field rows as CSV](../reports/erd-20261030/data-dictionary.csv), and [table inventory CSV](../reports/erd-20261030/table-inventory.csv).

The cloud images are readable projections of the core facility/equipment schema and the control/notification workflows, with selected attributes and relationships. Secondary scope/ownership links and operational helper tables remain in the full editable model and the complete dictionary. Repeated reference boxes depict the same physical tables. The local image includes every local table, with concise attributes. Numeric labels state endpoint cardinality (0..1, 1, or 0..*); a solid line is a declared FK, while a dashed line is a logical association.

## Table inventory

| Storage | Schema/table | Fields | Purpose |
|---|---|---:|---|
| Supabase PostgreSQL | [ecotrack_private.device_credentials](#1-ecotrack-private-device-credentials) | 4 | Private device-to-node credential binding for authenticated ESP32-S3 requests; stores a token digest, never a plaintext device secret. |
| Supabase PostgreSQL | [ecotrack_private.measurement_delivery_cursor](#2-ecotrack-private-measurement-delivery-cursor) | 4 | Private per-device boot/sequence cursor used to reject duplicate or out-of-order measurement delivery. |
| Supabase PostgreSQL | [ecotrack_private.rule_evidence](#3-ecotrack-private-rule-evidence) | 7 | Private per-rule, per-node measurement evidence and alert timing used by cloud rule evaluation. |
| Supabase PostgreSQL | [public.administrators](#4-public-administrators) | 18 | Administrator profiles for the desktop dashboard, linked to Supabase Auth identities. Administrators use the desktop application only. |
| Supabase PostgreSQL | [public.aircons](#5-public-aircons) | 24 | Air-conditioner asset registry, device associations, capability data, and desired/reported control state. |
| Supabase PostgreSQL | [public.buildings](#6-public-buildings) | 5 | Building records forming the top level of the facility location hierarchy. |
| Supabase PostgreSQL | [public.controller_installations](#7-public-controller-installations) | 22 | Installation/reinstallation audit events, including saved setup and installer/location/equipment snapshots. |
| Supabase PostgreSQL | [public.ecotrack_auth_attempts](#8-public-ecotrack-auth-attempts) | 3 | Authentication attempt counters and time windows used by application authentication controls. |
| Supabase PostgreSQL | [public.ecotrack_device_commands](#9-public-ecotrack-device-commands) | 12 | Cloud command queue with claim, expiry, acknowledgment, and result lifecycle for hardware devices. |
| Supabase PostgreSQL | [public.ecotrack_device_state](#10-public-ecotrack-device-state) | 11 | Latest per-node device connectivity, capabilities, IR observation, and applied configuration. |
| Supabase PostgreSQL | [public.ecotrack_ir_codes](#11-public-ecotrack-ir-codes) | 11 | Captured IR command definitions associated with an air-conditioner asset and command type. |
| Supabase PostgreSQL | [public.ecotrack_maintenance_operations](#12-public-ecotrack-maintenance-operations) | 5 | Per-actor operation idempotency ledger retaining maintenance requests and their results. |
| Supabase PostgreSQL | [public.ecotrack_push_deliveries](#13-public-ecotrack-push-deliveries) | 9 | Push-delivery queue and retry/receipt status for a notification and recipient token. |
| Supabase PostgreSQL | [public.ecotrack_push_wake_tokens](#14-public-ecotrack-push-wake-tokens) | 2 | Expiring wake-up nonces used by the push-processing workflow. |
| Supabase PostgreSQL | [public.floors](#15-public-floors) | 5 | Floors associated with buildings in the facility hierarchy. |
| Supabase PostgreSQL | [public.maintenance_reports](#16-public-maintenance-reports) | 26 | Maintenance work orders, assignments, findings, tasks, evidence, verification, and repair links. |
| Supabase PostgreSQL | [public.mobile_notification_state](#17-public-mobile-notification-state) | 6 | Per-authenticated-recipient read, snooze, and archive state for mobile notifications. |
| Supabase PostgreSQL | [public.mobile_notifications](#18-public-mobile-notifications) | 23 | Staff mobile notification events and maintenance-related message payloads. |
| Supabase PostgreSQL | [public.nodes](#19-public-nodes) | 35 | ESP32-S3 device registry: deployment, location, equipment role, schedule/configuration, and latest measurement metadata. |
| Supabase PostgreSQL | [public.notifications](#20-public-notifications) | 17 | Administrator desktop inbox events, including rule, report, and installation context. |
| Supabase PostgreSQL | [public.rooms](#21-public-rooms) | 7 | Rooms associated with floors; contains configured node capacity and administrator ownership. |
| Supabase PostgreSQL | [public.rule_nodes](#22-public-rule-nodes) | 5 | Junction between rules and device nodes, with a unique rule/node pair. |
| Supabase PostgreSQL | [public.rules](#23-public-rules) | 18 | Configured alert rules, thresholds, duration/time windows, and facility scope. |
| Supabase PostgreSQL | [public.staff](#24-public-staff) | 32 | Staff profiles and maintenance assignment scope for the mobile application. Staff use the mobile application only. |
| Supabase PostgreSQL | [public.staff_push_tokens](#25-public-staff-push-tokens) | 7 | Mobile push tokens, authenticated staff identity, platform, and notification preferences. |
| Supabase PostgreSQL | [public.telemetry](#26-public-telemetry) | 21 | Temporary cloud telemetry bridge and live measurements with device/equipment identifiers and captured control context. Permanent telemetry history is retained in desktop SQLite. Device/equipment links are logical, not declared foreign keys. |
| Desktop SQLite | [sqlite.cloud_sync_state](#27-sqlite-cloud-sync-state) | 3 | Durable cloud-import cursor for each synchronization source. |
| Desktop SQLite | [sqlite.monitor_calibrations](#28-sqlite-monitor-calibrations) | 7 | Dated calibration records associated with a local monitoring node; temperature calibration columns remain for historical compatibility. |
| Desktop SQLite | [sqlite.monitor_changed_nodes](#29-sqlite-monitor-changed-nodes) | 2 | Latest change revision for each monitoring node, used by incremental refresh. |
| Desktop SQLite | [sqlite.monitor_nodes](#30-sqlite-monitor-nodes) | 14 | Desktop local monitoring registry, cloud registry association, measurement cadence, activation state, and credential digest. |
| Desktop SQLite | [sqlite.monitor_revision](#31-sqlite-monitor-revision) | 3 | Singleton generation/version used to detect changes in local monitoring data. |
| Desktop SQLite | [sqlite.monitor_samples](#32-sqlite-monitor-samples) | 28 | Desktop local measurements with boot/sequence duplicate protection, quality metadata, and calibration references. |
| Desktop SQLite | [sqlite.monitor_sync_outbox](#33-sqlite-monitor-sync-outbox) | 4 | Ordered pending synchronization records for the local monitoring subsystem. |
| Desktop SQLite | [sqlite.monitor_sync_status](#34-sqlite-monitor-sync-status) | 3 | Singleton local monitoring synchronization success/error state. |
| Desktop SQLite | [sqlite.schedule_dispatches](#35-sqlite-schedule-dispatches) | 8 | Local schedule-forwarding dispatch attempts and transport outcomes. |
| Desktop SQLite | [sqlite.sensor_schedules](#36-sqlite-sensor-schedules) | 5 | One local wake/sleep and reporting-cadence schedule per monitoring node. |
| Desktop SQLite | [sqlite.telemetry](#37-sqlite-telemetry) | 26 | Desktop Daily Logs telemetry history, including imported cloud rows and local control/measurement context. |
| Desktop SQLite | [sqlite.telemetry_backup_state](#38-sqlite-telemetry-backup-state) | 5 | Singleton history-backup result and output-file metadata. |
| Desktop SQLite | [sqlite.telemetry_cloud_receipts](#39-sqlite-telemetry-cloud-receipts) | 3 | Retained cloud-import receipt payloads and cleanup status for telemetry history. |
| Desktop SQLite | [sqlite.telemetry_history_generation](#40-sqlite-telemetry-history-generation) | 2 | Singleton invalidation token for incremental telemetry-history snapshots. |
| Desktop SQLite | [sqlite.telemetry_local_reset](#41-sqlite-telemetry-local-reset) | 2 | Singleton deletion watermark used to preserve the effect of local history resets during synchronization. |
| Desktop SQLite | [sqlite.telemetry_monitor_sources](#42-sqlite-telemetry-monitor-sources) | 3 | Retained source payloads linking telemetry imports with the local monitor bridge. |

Total: **42 application tables; 457 application fields**. The external Auth reference below adds 2 selected fields and is excluded from these totals.

## External provider reference: auth.users

Supabase Auth manages this table. Only the referenced identity key and email are shown; this is not its full schema.

| Field | Data type | Constraints | Description |
|---|---|---|---|
| id | uuid | PK; NOT NULL | Supabase Auth user identity referenced by application profiles and recipient state. |
| email | character varying | Nullable | Provider-managed account email address. |

## 1. ecotrack_private.device_credentials

Private device-to-node credential binding for authenticated ESP32-S3 requests; stores a token digest, never a plaintext device secret.

| Field | Data type | Constraints | Default | Description |
|---|---|---|---|---|
| device_id | text | PK; NOT NULL; CHECK: device_credentials_device_id_check | — | Stable hardware device identity. |
| node_id | text | UNIQUE; NOT NULL; FK → public.nodes.id | — | Associated device/monitoring node identifier; the constraint column specifies whether a database FK exists. |
| token_hash | bytea | NOT NULL | — | Credential/token digest; actual digests and secrets are excluded from this documentation. |
| issued_at | timestamp with time zone | NOT NULL | now() | Timestamp when the device credential was issued. |

**Keys, checks, and references**

- UNIQUE device_credentials_node_id_key (node_id)
- PRIMARY KEY device_credentials_pkey (device_id)
- FOREIGN KEY device_credentials_node_id_fkey (node_id) → public.nodes (id); ON DELETE CASCADE; ON UPDATE NO ACTION
- device_credentials_device_id_check: CHECK (device_id ~ '^esp32s3-[a-f0-9]{12}$'::text)

**Indexes (captured definitions)**

```sql
CREATE UNIQUE INDEX device_credentials_pkey ON ecotrack_private.device_credentials USING btree (device_id)
CREATE UNIQUE INDEX device_credentials_node_id_key ON ecotrack_private.device_credentials USING btree (node_id)
```

## 2. ecotrack_private.measurement_delivery_cursor

Private per-device boot/sequence cursor used to reject duplicate or out-of-order measurement delivery.

| Field | Data type | Constraints | Default | Description |
|---|---|---|---|---|
| device_id | text | PK; NOT NULL; FK → ecotrack_private.device_credentials.device_id | — | Stable hardware device identity. |
| token_hash | bytea | NOT NULL | — | Credential/token digest; actual digests and secrets are excluded from this documentation. |
| boot | bigint | NOT NULL | '-1'::integer | Last accepted numeric boot counter for measurement delivery. |
| sequence | bigint | NOT NULL | '-1'::integer | Monotonic sequence within a device boot/session. |

**Keys, checks, and references**

- PRIMARY KEY measurement_delivery_cursor_pkey (device_id)
- FOREIGN KEY measurement_delivery_cursor_device_id_fkey (device_id) → ecotrack_private.device_credentials (device_id); ON DELETE CASCADE; ON UPDATE NO ACTION

**Indexes (captured definitions)**

```sql
CREATE UNIQUE INDEX measurement_delivery_cursor_pkey ON ecotrack_private.measurement_delivery_cursor USING btree (device_id)
```

## 3. ecotrack_private.rule_evidence

Private per-rule, per-node measurement evidence and alert timing used by cloud rule evaluation.

| Field | Data type | Constraints | Default | Description |
|---|---|---|---|---|
| rule_id | text | PK (rule_id, node_id); NOT NULL; FK → public.rules.id | — | Associated alert rule identifier. |
| node_id | text | PK (rule_id, node_id); NOT NULL; FK → public.nodes.id | — | Associated device/monitoring node identifier; the constraint column specifies whether a database FK exists. |
| signature | jsonb | NOT NULL | — | Rule configuration/evidence signature JSON used to reset stale evaluation state. |
| observed_at | timestamp with time zone | NOT NULL | — | Timestamp of the latest observation evaluated for this rule/node pair. |
| started_at | timestamp with time zone | Nullable | — | Start of the current contiguous matching-evidence interval. |
| interval_seconds | numeric | Nullable | — | Measurement cadence retained while evaluating continuous rule evidence. |
| last_alert_at | timestamp with time zone | Nullable | — | Timestamp when the most recent alert for this rule/node pair was emitted. |

**Keys, checks, and references**

- PRIMARY KEY rule_evidence_pkey (rule_id, node_id)
- FOREIGN KEY rule_evidence_node_id_fkey (node_id) → public.nodes (id); ON DELETE CASCADE; ON UPDATE NO ACTION
- FOREIGN KEY rule_evidence_rule_id_fkey (rule_id) → public.rules (id); ON DELETE CASCADE; ON UPDATE NO ACTION

**Indexes (captured definitions)**

```sql
CREATE UNIQUE INDEX rule_evidence_pkey ON ecotrack_private.rule_evidence USING btree (rule_id, node_id)
CREATE INDEX rule_evidence_node_idx ON ecotrack_private.rule_evidence USING btree (node_id)
```

## 4. public.administrators

Administrator profiles for the desktop dashboard, linked to Supabase Auth identities. Administrators use the desktop application only.

| Field | Data type | Constraints | Default | Description |
|---|---|---|---|---|
| id | text | PK; NOT NULL | ('admin_'::text \|\| substr(replace((gen_random_uuid())::text, '-'::text, ''::text), 1, 15)) | Primary identifier of the record. |
| username | text | UNIQUE; NOT NULL | — | Administrator sign-in/display username. |
| email | text | UNIQUE; NOT NULL; Partial/expression UNIQUE: admin_normalized_email_unique | — | Account email address. |
| password | text | Nullable | — | Legacy application credential column; nullable. Supabase Auth owns current identity authentication; no credential values are documented. |
| role | text | NOT NULL | 'admin'::text | Application/profile role label; staff job roles do not create desktop administrator access. |
| is_active | boolean | NOT NULL | true | Whether the account is enabled. |
| last_login | timestamp with time zone | Nullable | — | Timestamp of the most recently recorded login. |
| created | timestamp with time zone | NOT NULL | now() | Record creation timestamp; SQLite stores it as text. |
| updated | timestamp with time zone | NOT NULL | now() | Record update timestamp; SQLite stores it as text. |
| avatar | text | Nullable | 'default'::text | Profile avatar reference retained for compatibility. |
| photo_url | text | Nullable | — | Photo URL/reference; profile, device, or maintenance evidence according to the table. |
| phone | text | Nullable | — | Account phone number in its supplied display format. |
| auth_user_id | uuid | UNIQUE; Nullable; FK → auth.users.id | — | Associated Supabase Auth user identifier. |
| is_archived | boolean | NOT NULL | false | Whether the profile is archived. |
| auth_valid_after | timestamp with time zone | NOT NULL | '-infinity'::timestamp with time zone | Session-validity cutoff used to invalidate older authentication sessions. |
| phone_digits | text | Nullable | — | Normalized phone digits used for account identity/contact matching. |
| location | text | Nullable | ''::text | Human-readable location text or snapshot. |
| session_timeout | integer | Nullable | 30 | Configured administrator session timeout value used by account/session handling. |

**Keys, checks, and references**

- UNIQUE administrators_auth_user_id_key (auth_user_id)
- UNIQUE administrators_email_key (email)
- PRIMARY KEY administrators_pkey (id)
- UNIQUE administrators_username_key (username)
- FOREIGN KEY administrators_auth_user_id_fkey (auth_user_id) → auth.users (id); ON DELETE SET NULL; ON UPDATE NO ACTION

**Indexes (captured definitions)**

```sql
CREATE UNIQUE INDEX administrators_pkey ON public.administrators USING btree (id)
CREATE UNIQUE INDEX administrators_username_key ON public.administrators USING btree (username)
CREATE UNIQUE INDEX administrators_email_key ON public.administrators USING btree (email)
CREATE UNIQUE INDEX administrators_auth_user_id_key ON public.administrators USING btree (auth_user_id)
CREATE UNIQUE INDEX admin_normalized_email_unique ON public.administrators USING btree (lower(btrim(email))) WHERE (NULLIF(btrim(email), ''::text) IS NOT NULL)
```

## 5. public.aircons

Air-conditioner asset registry, device associations, capability data, and desired/reported control state.

| Field | Data type | Constraints | Default | Description |
|---|---|---|---|---|
| id | text | PK; NOT NULL | ('ac_'::text \|\| substr(replace((gen_random_uuid())::text, '-'::text, ''::text), 1, 15)) | Primary identifier of the record. |
| asset_tag | text | UNIQUE; NOT NULL | — | Unique inventory/asset tag for the air conditioner. |
| brand | text | NOT NULL | — | Air-conditioner manufacturer/brand label. |
| model | text | NOT NULL | — | Air-conditioner model label. |
| cooling_capacity_hp | numeric | Nullable | 1.5 | Rated cooling capacity recorded in horsepower. |
| aircon_type | text | NOT NULL | 'Split Type (Inverter)'::text | Air-conditioner type/category label or historical snapshot. |
| room_id | text | Nullable; FK → public.rooms.id | — | Room identifier associated with the record. |
| node_id | text | UNIQUE; Nullable; FK → public.nodes.id | — | Optional unique FK to public.nodes.id; separate from controller_node_id and reverse nodes.aircon_id. |
| status | text | NOT NULL | 'unlinked'::text | Workflow, record, or device status label. |
| protocol | text | Nullable | 'DAIKIN216'::text | IR protocol identifier. |
| install_date | date | Nullable | CURRENT_DATE | Recorded installation date; nodes retain the supplied text representation. |
| created_at | timestamp with time zone | NOT NULL | now() | Record creation timestamp; SQLite stores it as text. |
| updated_at | timestamp with time zone | NOT NULL | now() | Record update timestamp; SQLite stores it as text. |
| protocol_name | text | Nullable | 'midea_ir'::text | Named IR protocol associated with the equipment/device. |
| controller_node_id | text | Nullable; FK → public.nodes.id | — | Controller-role node associated with this air conditioner. |
| desired_state | jsonb | Nullable | — | Requested climate-control state as JSON. A request does not prove that the physical AC is on. |
| command_id | uuid | Nullable | — | Identifier for the current/most recent equipment control command. |
| command_status | text | Nullable | — | Status of the associated control command. |
| command_status_at | timestamp with time zone | Nullable | — | Timestamp of the recorded command status. |
| commanded_at | timestamp with time zone | Nullable | — | Timestamp when a control request was issued. |
| reported_state | jsonb | Nullable | — | Device-reported control-state JSON; physical power requires a trustworthy confirmation source. |
| reported_at | timestamp with time zone | Nullable | — | Timestamp associated with the reported state. |
| name | text | Nullable | — | Human-readable display name. |
| capability_profile | jsonb | NOT NULL | '{}'::jsonb | Supported equipment/IR control capabilities as JSON. |

**Keys, checks, and references**

- UNIQUE aircons_asset_tag_key (asset_tag)
- UNIQUE aircons_node_id_key (node_id)
- PRIMARY KEY aircons_pkey (id)
- FOREIGN KEY aircons_controller_node_id_fkey (controller_node_id) → public.nodes (id); ON DELETE SET NULL; ON UPDATE NO ACTION
- FOREIGN KEY aircons_node_id_fkey (node_id) → public.nodes (id); ON DELETE SET NULL; ON UPDATE NO ACTION
- FOREIGN KEY aircons_room_id_fkey (room_id) → public.rooms (id); ON DELETE RESTRICT; ON UPDATE NO ACTION

**Indexes (captured definitions)**

```sql
CREATE UNIQUE INDEX aircons_pkey ON public.aircons USING btree (id)
CREATE UNIQUE INDEX aircons_asset_tag_key ON public.aircons USING btree (asset_tag)
CREATE UNIQUE INDEX aircons_node_id_key ON public.aircons USING btree (node_id)
CREATE INDEX idx_aircons_protocol_name ON public.aircons USING btree (protocol_name)
CREATE INDEX idx_aircons_asset_tag ON public.aircons USING btree (asset_tag)
CREATE INDEX idx_aircons_node_id ON public.aircons USING btree (node_id)
CREATE INDEX idx_aircons_room_id ON public.aircons USING btree (room_id)
CREATE INDEX aircons_controller_node_idx ON public.aircons USING btree (controller_node_id)
```

## 6. public.buildings

Building records forming the top level of the facility location hierarchy.

| Field | Data type | Constraints | Default | Description |
|---|---|---|---|---|
| id | text | PK; NOT NULL | ('bld_'::text \|\| substr(replace((gen_random_uuid())::text, '-'::text, ''::text), 1, 15)) | Primary identifier of the record. |
| name | text | NOT NULL | — | Human-readable display name. |
| admin_id | text | Nullable; FK → public.administrators.id | — | Associated desktop administrator profile identifier. |
| created | timestamp with time zone | NOT NULL | now() | Record creation timestamp; SQLite stores it as text. |
| updated | timestamp with time zone | NOT NULL | now() | Record update timestamp; SQLite stores it as text. |

**Keys, checks, and references**

- PRIMARY KEY buildings_pkey (id)
- FOREIGN KEY buildings_admin_id_fkey (admin_id) → public.administrators (id); ON DELETE SET NULL; ON UPDATE NO ACTION

**Indexes (captured definitions)**

```sql
CREATE INDEX ecotrack_fk_buildings_admin_id ON public.buildings USING btree (admin_id)
CREATE UNIQUE INDEX buildings_pkey ON public.buildings USING btree (id)
```

## 7. public.controller_installations

Installation/reinstallation audit events, including saved setup and installer/location/equipment snapshots.

| Field | Data type | Constraints | Default | Description |
|---|---|---|---|---|
| id | uuid | PK; NOT NULL | gen_random_uuid() | Primary identifier of the record. |
| node_id | text | UNIQUE (node_id, attempt_id); NOT NULL; REF → public.nodes.id (logical; no FK) | — | Installed cloud node ID snapshot; no declared database FK. |
| device_id | text | NOT NULL | — | Stable hardware device identity. |
| attempt_id | text | UNIQUE (node_id, attempt_id); NOT NULL | — | Installation/setup attempt identifier used for duplicate protection. |
| request_setup | jsonb | NOT NULL | — | Original accepted installation/setup request JSON. |
| installer_auth_user_id | uuid | NOT NULL; REF → auth.users.id (logical; no FK) | — | Authenticated installer user ID captured in the event; no declared FK in the captured schema. |
| installer_profile_id | text | Nullable | — | Application installer profile ID snapshot; no declared FK. |
| installer_name | text | Nullable | — | Installer display-name snapshot. |
| installer_account_role | text | NOT NULL | — | Installer account category captured when the event occurred. |
| installer_role | text | Nullable | — | Installer staff/job role snapshot. |
| controller_name | text | NOT NULL | — | Controller display-name snapshot. |
| room_id | text | NOT NULL; REF → public.rooms.id (logical; no FK) | — | Room ID snapshot at installation time; no declared database FK. |
| room_name | text | NOT NULL | — | Room-name snapshot stored with the event/measurement/profile. |
| floor_id | text | NOT NULL; REF → public.floors.id (logical; no FK) | — | Floor ID snapshot at installation time; no declared database FK. |
| floor_name | text | NOT NULL | — | Floor-name snapshot stored with the event/measurement/profile. |
| building_id | text | NOT NULL; REF → public.buildings.id (logical; no FK) | — | Building ID snapshot at installation time; no declared database FK. |
| building_name | text | NOT NULL | — | Building-name snapshot stored with the event/measurement/profile. |
| aircon_id | text | NOT NULL; REF → public.aircons.id (logical; no FK) | — | Air-conditioner asset ID snapshot; no declared database FK. |
| aircon_name | text | Nullable | — | Air-conditioner display-name snapshot. |
| aircon_type | text | Nullable | — | Air-conditioner type/category label or historical snapshot. |
| installed_at | timestamp with time zone | NOT NULL | — | Installation/reinstallation event timestamp. |
| event_kind | text | NOT NULL; CHECK: controller_installations_event_kind_check | — | Installation event category. |

**Keys, checks, and references**

- UNIQUE controller_installations_node_id_attempt_id_key (node_id, attempt_id)
- PRIMARY KEY controller_installations_pkey (id)
- controller_installations_event_kind_check: CHECK (event_kind = ANY (ARRAY['installation'::text, 'reinstallation'::text]))
- LOGICAL REF node_id → public.nodes.id; no declared FK
- LOGICAL REF aircon_id → public.aircons.id; no declared FK
- LOGICAL REF room_id → public.rooms.id; no declared FK
- LOGICAL REF floor_id → public.floors.id; no declared FK
- LOGICAL REF building_id → public.buildings.id; no declared FK
- LOGICAL REF installer_auth_user_id → auth.users.id; no declared FK

**Indexes (captured definitions)**

```sql
CREATE UNIQUE INDEX controller_installations_pkey ON public.controller_installations USING btree (id)
CREATE UNIQUE INDEX controller_installations_node_id_attempt_id_key ON public.controller_installations USING btree (node_id, attempt_id)
CREATE INDEX controller_installations_room_time ON public.controller_installations USING btree (room_id, installed_at DESC)
```

## 8. public.ecotrack_auth_attempts

Authentication attempt counters and time windows used by application authentication controls.

| Field | Data type | Constraints | Default | Description |
|---|---|---|---|---|
| key | text | PK; NOT NULL | — | Authentication-attempt bucket key. |
| started_at | timestamp with time zone | NOT NULL | — | Start of the current time/evidence window. |
| attempts | integer | NOT NULL | — | Number of attempts in the current authentication/delivery cycle. |

**Keys, checks, and references**

- PRIMARY KEY ecotrack_auth_attempts_pkey (key)

**Indexes (captured definitions)**

```sql
CREATE UNIQUE INDEX ecotrack_auth_attempts_pkey ON public.ecotrack_auth_attempts USING btree (key)
```

## 9. public.ecotrack_device_commands

Cloud command queue with claim, expiry, acknowledgment, and result lifecycle for hardware devices.

| Field | Data type | Constraints | Default | Description |
|---|---|---|---|---|
| id | uuid | PK; NOT NULL | gen_random_uuid() | Primary identifier of the record. |
| node_id | text | NOT NULL; FK → public.nodes.id | — | Associated device/monitoring node identifier; the constraint column specifies whether a database FK exists. |
| kind | text | NOT NULL; CHECK: ecotrack_device_commands_kind_check | — | Hardware command kind. |
| payload | jsonb | NOT NULL | '{}'::jsonb | Serialized request/record payload; JSONB in cloud tables and JSON text locally. |
| status | text | NOT NULL; CHECK: ecotrack_device_commands_status_check | 'queued'::text | Workflow, record, or device status label. |
| created_by | uuid | NOT NULL; REF → auth.users.id (logical; no FK) | — | Authenticated user ID that created the command/code; not a declared FK in these tables. |
| created_at | timestamp with time zone | NOT NULL | now() | Record creation timestamp; SQLite stores it as text. |
| expires_at | timestamp with time zone | NOT NULL | — | Expiry timestamp after which the record/command/token is no longer valid. |
| claimed_at | timestamp with time zone | Nullable | — | Timestamp when a device/worker claimed the command. |
| acknowledged_at | timestamp with time zone | Nullable | — | Timestamp of the device acknowledgment; not confirmation of physical AC operation. |
| result | jsonb | Nullable | — | Stored operation/command result JSON. |
| finished_at | timestamp with time zone | Nullable | — | Timestamp when command processing finished. |

**Keys, checks, and references**

- PRIMARY KEY ecotrack_device_commands_pkey (id)
- FOREIGN KEY ecotrack_device_commands_node_id_fkey (node_id) → public.nodes (id); ON DELETE CASCADE; ON UPDATE NO ACTION
- ecotrack_device_commands_kind_check: CHECK (kind = ANY (ARRAY['ping'::text, 'learn_ir'::text, 'configure'::text, 'ac_intent'::text]))
- ecotrack_device_commands_status_check: CHECK (status = ANY (ARRAY['queued'::text, 'claimed'::text, 'completed'::text, 'failed'::text, 'expired'::text, 'superseded'::text]))
- LOGICAL REF created_by → auth.users.id; no declared FK

**Indexes (captured definitions)**

```sql
CREATE UNIQUE INDEX ecotrack_device_commands_pkey ON public.ecotrack_device_commands USING btree (id)
CREATE INDEX ecotrack_device_commands_poll_idx ON public.ecotrack_device_commands USING btree (node_id, created_at) WHERE (status = ANY (ARRAY['queued'::text, 'claimed'::text]))
CREATE INDEX ecotrack_finished_commands_cleanup_idx ON public.ecotrack_device_commands USING btree (finished_at) WHERE (status = ANY (ARRAY['completed'::text, 'failed'::text, 'expired'::text, 'superseded'::text]))
CREATE INDEX ecotrack_expiring_commands_cleanup_idx ON public.ecotrack_device_commands USING btree (expires_at) WHERE (status = ANY (ARRAY['queued'::text, 'claimed'::text]))
```

## 10. public.ecotrack_device_state

Latest per-node device connectivity, capabilities, IR observation, and applied configuration.

| Field | Data type | Constraints | Default | Description |
|---|---|---|---|---|
| node_id | text | PK; NOT NULL; FK → public.nodes.id | — | Associated device/monitoring node identifier; the constraint column specifies whether a database FK exists. |
| device_id | text | UNIQUE; NOT NULL | — | Stable hardware device identity. |
| last_seen | timestamp with time zone | Nullable | — | Most recently recorded device contact timestamp. |
| sleeping_until | timestamp with time zone | Nullable | — | Expected end of the device sleep interval. |
| firmware_version | text | Nullable | — | Reported device firmware version. |
| wifi_ssid | text | Nullable | — | Wi-Fi network name reported for the device. |
| ip_address | text | Nullable | — | Reported/local device IP address. |
| rssi | integer | Nullable | — | Received signal strength; dBm where supplied by the device. |
| capabilities | jsonb | NOT NULL | '{}'::jsonb | Reported hardware/device capabilities as JSON. |
| latest_ir | jsonb | Nullable | — | Latest observed IR frame and decoded metadata as JSON. |
| applied_config | jsonb | Nullable | — | Last device-applied configuration JSON; may include embedded schedule settings. |

**Keys, checks, and references**

- UNIQUE ecotrack_device_state_device_id_key (device_id)
- PRIMARY KEY ecotrack_device_state_pkey (node_id)
- FOREIGN KEY ecotrack_device_state_node_id_fkey (node_id) → public.nodes (id); ON DELETE CASCADE; ON UPDATE NO ACTION

**Indexes (captured definitions)**

```sql
CREATE UNIQUE INDEX ecotrack_device_state_pkey ON public.ecotrack_device_state USING btree (node_id)
CREATE UNIQUE INDEX ecotrack_device_state_device_id_key ON public.ecotrack_device_state USING btree (device_id)
```

## 11. public.ecotrack_ir_codes

Captured IR command definitions associated with an air-conditioner asset and command type.

| Field | Data type | Constraints | Default | Description |
|---|---|---|---|---|
| id | uuid | PK; NOT NULL | gen_random_uuid() | Primary identifier of the record. |
| aircon_id | text | UNIQUE (aircon_id, command_type); NOT NULL; FK → public.aircons.id | — | Associated air-conditioner identifier; see the constraint column for the actual target. |
| command_type | text | UNIQUE (aircon_id, command_type); NOT NULL; CHECK: ecotrack_ir_codes_command_type_check | — | Captured IR command label, such as a supported climate command. |
| protocol | text | NOT NULL; CHECK: ecotrack_ir_codes_protocol_check | — | IR protocol identifier. |
| raw_data | text | NOT NULL; CHECK: ecotrack_ir_codes_raw_data_check | — | Stored captured IR data representation. |
| capture | jsonb | NOT NULL | '{}'::jsonb | Full IR-capture metadata JSON. |
| source_platform | text | NOT NULL; CHECK: ecotrack_ir_codes_source_platform_check | — | Application platform that captured/saved the IR code. |
| created_by | uuid | NOT NULL; REF → auth.users.id (logical; no FK) | — | Authenticated user ID that created the command/code; not a declared FK in these tables. |
| updated_by | uuid | NOT NULL; REF → auth.users.id (logical; no FK) | — | Authenticated user ID that last updated the IR code; no declared FK. |
| created_at | timestamp with time zone | NOT NULL | clock_timestamp() | Record creation timestamp; SQLite stores it as text. |
| updated_at | timestamp with time zone | NOT NULL | clock_timestamp() | Record update timestamp; SQLite stores it as text. |

**Keys, checks, and references**

- UNIQUE ecotrack_ir_codes_aircon_id_command_type_key (aircon_id, command_type)
- PRIMARY KEY ecotrack_ir_codes_pkey (id)
- FOREIGN KEY ecotrack_ir_codes_aircon_id_fkey (aircon_id) → public.aircons (id); ON DELETE CASCADE; ON UPDATE NO ACTION
- ecotrack_ir_codes_command_type_check: CHECK (command_type ~ '^[A-Z][A-Z0-9_]{0,63}$'::text)
- ecotrack_ir_codes_protocol_check: CHECK (protocol ~ '^[A-Z][A-Z0-9_]{1,48}$'::text)
- ecotrack_ir_codes_raw_data_check: CHECK (length(raw_data) >= 5 AND length(raw_data) <= 32768)
- ecotrack_ir_codes_source_platform_check: CHECK (source_platform = ANY (ARRAY['mobile'::text, 'desktop'::text]))
- LOGICAL REF created_by → auth.users.id; no declared FK
- LOGICAL REF updated_by → auth.users.id; no declared FK

**Indexes (captured definitions)**

```sql
CREATE UNIQUE INDEX ecotrack_ir_codes_pkey ON public.ecotrack_ir_codes USING btree (id)
CREATE UNIQUE INDEX ecotrack_ir_codes_aircon_id_command_type_key ON public.ecotrack_ir_codes USING btree (aircon_id, command_type)
```

## 12. public.ecotrack_maintenance_operations

Per-actor operation idempotency ledger retaining maintenance requests and their results.

| Field | Data type | Constraints | Default | Description |
|---|---|---|---|---|
| actor_id | uuid | PK (actor_id, operation_id); NOT NULL; FK → auth.users.id | — | Supabase Auth identity that performed the maintenance operation. |
| operation_id | text | PK (actor_id, operation_id); NOT NULL; CHECK: ecotrack_maintenance_operations_operation_id_check | — | Client-supplied idempotency identifier, unique together with the actor. |
| request | jsonb | NOT NULL | — | Original maintenance operation request JSON. |
| result | jsonb | NOT NULL | — | Stored operation/command result JSON. |
| created_at | timestamp with time zone | NOT NULL | now() | Record creation timestamp; SQLite stores it as text. |

**Keys, checks, and references**

- PRIMARY KEY ecotrack_maintenance_operations_pkey (actor_id, operation_id)
- FOREIGN KEY ecotrack_maintenance_operations_actor_id_fkey (actor_id) → auth.users (id); ON DELETE CASCADE; ON UPDATE NO ACTION
- ecotrack_maintenance_operations_operation_id_check: CHECK (length(operation_id) >= 1 AND length(operation_id) <= 128)

**Indexes (captured definitions)**

```sql
CREATE UNIQUE INDEX ecotrack_maintenance_operations_pkey ON public.ecotrack_maintenance_operations USING btree (actor_id, operation_id)
```

## 13. public.ecotrack_push_deliveries

Push-delivery queue and retry/receipt status for a notification and recipient token.

| Field | Data type | Constraints | Default | Description |
|---|---|---|---|---|
| id | uuid | PK; NOT NULL | gen_random_uuid() | Primary identifier of the record. |
| notification_id | text | UNIQUE (notification_id, token); NOT NULL; FK → public.mobile_notifications.id | — | Related mobile notification identifier. |
| token | text | UNIQUE (notification_id, token); NOT NULL; FK → public.staff_push_tokens.token | — | Recipient push token, with an enforced FK to staff_push_tokens.token. |
| status | text | NOT NULL; CHECK: ecotrack_push_deliveries_status_check | 'pending'::text | Workflow, record, or device status label. |
| attempts | integer | NOT NULL | 0 | Number of attempts in the current authentication/delivery cycle. |
| next_attempt_at | timestamp with time zone | NOT NULL | now() | Earliest time for the next push delivery attempt. |
| lease_until | timestamp with time zone | Nullable | — | Worker lease expiry for the current delivery attempt. |
| ticket_id | text | Nullable | — | Push-provider ticket/reference for delivery receipt processing. |
| last_error | text | Nullable | — | Most recently recorded push delivery error. |

**Keys, checks, and references**

- UNIQUE ecotrack_push_deliveries_notification_id_token_key (notification_id, token)
- PRIMARY KEY ecotrack_push_deliveries_pkey (id)
- FOREIGN KEY ecotrack_push_deliveries_notification_id_fkey (notification_id) → public.mobile_notifications (id); ON DELETE CASCADE; ON UPDATE NO ACTION
- FOREIGN KEY ecotrack_push_deliveries_token_fkey (token) → public.staff_push_tokens (token); ON DELETE CASCADE; ON UPDATE NO ACTION
- ecotrack_push_deliveries_status_check: CHECK (status = ANY (ARRAY['pending'::text, 'receipt'::text, 'delivered'::text, 'failed'::text]))

**Indexes (captured definitions)**

```sql
CREATE INDEX ecotrack_fk_ecotrack_push_deliveries_token ON public.ecotrack_push_deliveries USING btree (token)
CREATE UNIQUE INDEX ecotrack_push_deliveries_pkey ON public.ecotrack_push_deliveries USING btree (id)
CREATE UNIQUE INDEX ecotrack_push_deliveries_notification_id_token_key ON public.ecotrack_push_deliveries USING btree (notification_id, token)
CREATE INDEX push_deliveries_pending ON public.ecotrack_push_deliveries USING btree (next_attempt_at) WHERE (status = ANY (ARRAY['pending'::text, 'receipt'::text]))
```

## 14. public.ecotrack_push_wake_tokens

Expiring wake-up nonces used by the push-processing workflow.

| Field | Data type | Constraints | Default | Description |
|---|---|---|---|---|
| nonce | uuid | PK; NOT NULL | gen_random_uuid() | Unique wake-up token/nonce. |
| expires_at | timestamp with time zone | NOT NULL | (now() + '00:10:00'::interval) | Expiry timestamp after which the record/command/token is no longer valid. |

**Keys, checks, and references**

- PRIMARY KEY ecotrack_push_wake_tokens_pkey (nonce)

**Indexes (captured definitions)**

```sql
CREATE UNIQUE INDEX ecotrack_push_wake_tokens_pkey ON public.ecotrack_push_wake_tokens USING btree (nonce)
```

## 15. public.floors

Floors associated with buildings in the facility hierarchy.

| Field | Data type | Constraints | Default | Description |
|---|---|---|---|---|
| id | text | PK; NOT NULL | ('flr_'::text \|\| substr(replace((gen_random_uuid())::text, '-'::text, ''::text), 1, 15)) | Primary identifier of the record. |
| name | text | NOT NULL | — | Human-readable display name. |
| building_id | text | Nullable; FK → public.buildings.id | — | Associated building identifier. |
| created | timestamp with time zone | NOT NULL | now() | Record creation timestamp; SQLite stores it as text. |
| updated | timestamp with time zone | NOT NULL | now() | Record update timestamp; SQLite stores it as text. |

**Keys, checks, and references**

- PRIMARY KEY floors_pkey (id)
- FOREIGN KEY floors_building_id_fkey (building_id) → public.buildings (id); ON DELETE CASCADE; ON UPDATE NO ACTION

**Indexes (captured definitions)**

```sql
CREATE INDEX ecotrack_fk_floors_building_id ON public.floors USING btree (building_id)
CREATE UNIQUE INDEX floors_pkey ON public.floors USING btree (id)
```

## 16. public.maintenance_reports

Maintenance work orders, assignments, findings, tasks, evidence, verification, and repair links.

| Field | Data type | Constraints | Default | Description |
|---|---|---|---|---|
| id | text | PK; NOT NULL | ('mr_'::text \|\| substr(replace((gen_random_uuid())::text, '-'::text, ''::text), 1, 15)) | Primary identifier of the record. |
| aircon_id | text | Nullable; FK → public.nodes.id | — | Despite its name, the actual database FK targets public.nodes.id, not public.aircons.id. |
| aircon_name | text | Nullable | — | Air-conditioner display-name snapshot. |
| room_id | text | Nullable; FK → public.rooms.id | — | Room identifier associated with the record. |
| room_name | text | Nullable | — | Room-name snapshot stored with the event/measurement/profile. |
| type | text | NOT NULL | 'Preventive Maintenance'::text | Record category: rule, maintenance request, or notification according to the table. |
| priority | text | NOT NULL | 'Medium'::text | Maintenance/notification priority label. |
| staff_id | text | Nullable; FK → public.staff.id | — | Assigned/recipient mobile staff profile identifier. |
| staff_name | text | NOT NULL | — | Staff display-name snapshot. |
| due_date | text | Nullable | — | Due-date text retained in the application format; not a SQL DATE column. |
| created_date | text | Nullable | — | Creation-date text retained separately from the database timestamp. |
| status | text | NOT NULL | 'Pending'::text | Workflow, record, or device status label. |
| description | text | Nullable | — | Maintenance work description. |
| tasks | jsonb | Nullable | '[]'::jsonb | Maintenance task/checklist JSON. |
| issue | jsonb | Nullable | — | Reported maintenance issue JSON. |
| verification_remarks | text | Nullable | — | Administrator/staff maintenance verification remarks. |
| timeline | jsonb | Nullable | '[]'::jsonb | Maintenance workflow/history entries as JSON. |
| admin_id | text | Nullable; FK → public.administrators.id | — | Associated desktop administrator profile identifier. |
| created | timestamp with time zone | NOT NULL | now() | Record creation timestamp; SQLite stores it as text. |
| updated | timestamp with time zone | NOT NULL | now() | Record update timestamp; SQLite stores it as text. |
| photo_url | text | Nullable | — | Photo URL/reference; profile, device, or maintenance evidence according to the table. |
| attachment_url | text | Nullable | — | Maintenance attachment URL/reference retained for compatibility. |
| photos | jsonb | Nullable | '[]'::jsonb | Maintenance photo references/metadata as JSON. |
| aircon_type | text | Nullable | 'Split Type (Inverter)'::text | Air-conditioner type/category label or historical snapshot. |
| parent_report_id | text | Nullable; REF → public.maintenance_reports.id (logical; no FK) | — | Logical parent maintenance report identifier; no declared FK. |
| linked_repair_id | text | Nullable; REF → public.maintenance_reports.id (logical; no FK) | — | Logical related repair report identifier; no declared FK. |

**Keys, checks, and references**

- PRIMARY KEY maintenance_reports_pkey (id)
- FOREIGN KEY maintenance_reports_admin_id_fkey (admin_id) → public.administrators (id); ON DELETE SET NULL; ON UPDATE NO ACTION
- FOREIGN KEY maintenance_reports_aircon_id_fkey (aircon_id) → public.nodes (id); ON DELETE SET NULL; ON UPDATE NO ACTION
- FOREIGN KEY maintenance_reports_room_id_fkey (room_id) → public.rooms (id); ON DELETE SET NULL; ON UPDATE NO ACTION
- FOREIGN KEY maintenance_reports_staff_id_fkey (staff_id) → public.staff (id); ON DELETE RESTRICT; ON UPDATE NO ACTION
- LOGICAL REF parent_report_id → public.maintenance_reports.id; no declared FK
- LOGICAL REF linked_repair_id → public.maintenance_reports.id; no declared FK

**Indexes (captured definitions)**

```sql
CREATE INDEX ecotrack_fk_maintenance_reports_admin_id ON public.maintenance_reports USING btree (admin_id)
CREATE INDEX ecotrack_fk_maintenance_reports_room_id ON public.maintenance_reports USING btree (room_id)
CREATE UNIQUE INDEX maintenance_reports_pkey ON public.maintenance_reports USING btree (id)
CREATE INDEX idx_maint_status ON public.maintenance_reports USING btree (status)
CREATE INDEX idx_maint_staff_id ON public.maintenance_reports USING btree (staff_id)
CREATE INDEX idx_maint_aircon_id ON public.maintenance_reports USING btree (aircon_id)
CREATE INDEX idx_maint_created ON public.maintenance_reports USING btree (created DESC)
CREATE INDEX idx_maint_parent_report_id ON public.maintenance_reports USING btree (parent_report_id)
CREATE INDEX idx_maint_linked_repair_id ON public.maintenance_reports USING btree (linked_repair_id)
```

## 17. public.mobile_notification_state

Per-authenticated-recipient read, snooze, and archive state for mobile notifications.

| Field | Data type | Constraints | Default | Description |
|---|---|---|---|---|
| notification_id | text | PK (notification_id, recipient_auth_user_id); NOT NULL; FK → public.mobile_notifications.id | — | Related mobile notification identifier. |
| recipient_auth_user_id | uuid | PK (notification_id, recipient_auth_user_id); NOT NULL; FK → auth.users.id | — | Authenticated user whose per-notification state is stored. |
| read_at | timestamp with time zone | Nullable | — | Time the recipient marked/opened the notification as read. |
| snooze_until | timestamp with time zone | Nullable | — | Timestamp through which the notification is snoozed. |
| archived_at | timestamp with time zone | Nullable | — | Timestamp when a profile/notification state was archived. |
| updated_at | timestamp with time zone | NOT NULL | now() | Record update timestamp; SQLite stores it as text. |

**Keys, checks, and references**

- PRIMARY KEY mobile_notification_state_pkey (notification_id, recipient_auth_user_id)
- FOREIGN KEY mobile_notification_state_notification_id_fkey (notification_id) → public.mobile_notifications (id); ON DELETE CASCADE; ON UPDATE NO ACTION
- FOREIGN KEY mobile_notification_state_recipient_auth_user_id_fkey (recipient_auth_user_id) → auth.users (id); ON DELETE CASCADE; ON UPDATE NO ACTION

**Indexes (captured definitions)**

```sql
CREATE UNIQUE INDEX mobile_notification_state_pkey ON public.mobile_notification_state USING btree (notification_id, recipient_auth_user_id)
CREATE INDEX mobile_notification_state_recipient ON public.mobile_notification_state USING btree (recipient_auth_user_id, notification_id)
```

## 18. public.mobile_notifications

Staff mobile notification events and maintenance-related message payloads.

| Field | Data type | Constraints | Default | Description |
|---|---|---|---|---|
| id | text | PK; NOT NULL | — | Primary identifier of the record. |
| staff_id | text | Nullable; FK → public.staff.id | — | Assigned/recipient mobile staff profile identifier. |
| staff_name | text | Nullable | 'All Staff'::text | Staff display-name snapshot. |
| title | text | NOT NULL | — | Mobile notification title. |
| message | text | NOT NULL | — | Notification/rule message text. |
| type | text | NOT NULL | 'task_reminder'::text | Record category: rule, maintenance request, or notification according to the table. |
| priority | text | NOT NULL | 'medium'::text | Maintenance/notification priority label. |
| category | text | NOT NULL | 'maintenance'::text | Notification category label. |
| related_report_id | text | Nullable; REF → public.maintenance_reports.id (logical; no FK) | — | Logical related maintenance report identifier; no declared FK. |
| aircon_id | text | Nullable | — | Equipment/device identifier snapshot carried by the notification payload; no declared FK fixes its target. |
| aircon_name | text | Nullable | — | Air-conditioner display-name snapshot. |
| location | text | Nullable | — | Human-readable location text or snapshot. |
| due_date | text | Nullable | — | Due-date text retained in the application format; not a SQL DATE column. |
| is_read | boolean | Nullable | false | Legacy shared read flag; per-recipient state is stored in mobile_notification_state. |
| is_snoozed | boolean | Nullable | false | Legacy shared snooze flag; per-recipient state is stored in mobile_notification_state. |
| snooze_until | timestamp with time zone | Nullable | — | Timestamp through which the notification is snoozed. |
| created_at | timestamp with time zone | NOT NULL | now() | Record creation timestamp; SQLite stores it as text. |
| updated_at | timestamp with time zone | Nullable | now() | Record update timestamp; SQLite stores it as text. |
| aircon_type | text | Nullable | — | Air-conditioner type/category label or historical snapshot. |
| verification_remarks | text | Nullable | — | Administrator/staff maintenance verification remarks. |
| event_key | text | NOT NULL; Index UNIQUE: mobile_notifications_event_key_unique | — | Event deduplication key. |
| event_payload | jsonb | Nullable | — | Structured notification event context as JSON. |
| is_broadcast | boolean | NOT NULL | false | Whether the mobile notification is a broadcast event. |

**Keys, checks, and references**

- PRIMARY KEY mobile_notifications_pkey (id)
- FOREIGN KEY mobile_notifications_staff_id_fkey (staff_id) → public.staff (id); ON DELETE RESTRICT; ON UPDATE NO ACTION
- LOGICAL REF related_report_id → public.maintenance_reports.id; no declared FK

**Indexes (captured definitions)**

```sql
CREATE UNIQUE INDEX mobile_notifications_pkey ON public.mobile_notifications USING btree (id)
CREATE INDEX idx_mobile_notif_staff_name ON public.mobile_notifications USING btree (staff_name)
CREATE INDEX idx_mobile_notif_is_read ON public.mobile_notifications USING btree (is_read)
CREATE INDEX idx_mobile_notif_created_at ON public.mobile_notifications USING btree (created_at DESC)
CREATE INDEX idx_mobile_notif_type ON public.mobile_notifications USING btree (type)
CREATE INDEX idx_mobile_notif_report ON public.mobile_notifications USING btree (related_report_id)
CREATE INDEX idx_mobile_notif_recipient_created ON public.mobile_notifications USING btree (staff_name, created_at DESC)
CREATE UNIQUE INDEX mobile_notifications_event_key_unique ON public.mobile_notifications USING btree (event_key)
CREATE INDEX mobile_notifications_recipient_page ON public.mobile_notifications USING btree (staff_id, created_at DESC, id DESC)
CREATE INDEX mobile_notifications_broadcast_page ON public.mobile_notifications USING btree (created_at DESC, id DESC) WHERE is_broadcast
```

## 19. public.nodes

ESP32-S3 device registry: deployment, location, equipment role, schedule/configuration, and latest measurement metadata.

| Field | Data type | Constraints | Default | Description |
|---|---|---|---|---|
| id | text | PK; NOT NULL | ('node_'::text \|\| substr(replace((gen_random_uuid())::text, '-'::text, ''::text), 1, 15)) | Primary identifier of the record. |
| name | text | UNIQUE; NOT NULL; Partial/expression UNIQUE: ecotrack_hardware_identity_idx | — | Human-readable display name. |
| status | text | NOT NULL | 'offline'::text | Workflow, record, or device status label. |
| temp | numeric | Nullable | 0 | Historical temperature value; nullable and not produced by the current MCP9808-free firmware. |
| rssi | numeric | Nullable | 0 | Received signal strength; dBm where supplied by the device. |
| battery | numeric | Nullable | 0 | Historical battery value; nullable and not produced by the current firmware. |
| wake_time | text | Nullable | '00:00'::text | Configured daily wake time in application time-of-day text format. |
| sleep_time | text | Nullable | '00:00'::text | Configured daily sleep time in application time-of-day text format. |
| interval_val | integer | Nullable | 15 | Configured reporting-interval magnitude, interpreted with interval_unit. |
| interval_unit | text | Nullable | 'Minutes'::text | Unit of the configured reporting interval. |
| room_id | text | Nullable; FK → public.rooms.id | — | Room identifier associated with the record. |
| aircon_type | text | Nullable | 'Split Type (Inverter)'::text | Air-conditioner type/category label or historical snapshot. |
| install_date | text | Nullable | '2026-01-15'::text | Recorded installation date; nodes retain the supplied text representation. |
| created | timestamp with time zone | NOT NULL | now() | Record creation timestamp; SQLite stores it as text. |
| updated | timestamp with time zone | NOT NULL | now() | Record update timestamp; SQLite stores it as text. |
| photo_url | text | Nullable | — | Photo URL/reference; profile, device, or maintenance evidence according to the table. |
| aircon_id | text | UNIQUE; Nullable; FK → public.aircons.id | — | Optional unique FK to public.aircons.id; separate from monitor_aircon_id and from reverse aircons.node_id. |
| maintainer_id | text | Nullable; FK → public.staff.id | — | Assigned mobile staff maintainer profile identifier. |
| mac_address | text | Nullable | — | Reported hardware network MAC address. |
| ip_address | text | Nullable | — | Reported/local device IP address. |
| wifi_ssid | text | Nullable | — | Wi-Fi network name reported for the device. |
| ble_uuid | text | Nullable | — | Bluetooth Low Energy service/device identifier. |
| protocol_name | text | Nullable | 'midea_ir'::text | Named IR protocol associated with the equipment/device. |
| brand | text | Nullable | — | Air-conditioner manufacturer/brand label. |
| admin_verified_at | timestamp with time zone | Nullable | — | Timestamp of administrator deployment verification. |
| admin_verified_by | uuid | Nullable; REF → auth.users.id (logical; no FK) | — | Authenticated verifying administrator user ID; no declared FK. |
| deployment_saved_at | timestamp with time zone | Nullable | — | Time deployment/setup information was saved. |
| device_mode | text | NOT NULL; CHECK: nodes_device_mode_check; Partial/expression UNIQUE: ecotrack_one_monitor_device_per_ac | 'controller'::text | Device role: monitoring, controller, or both. |
| monitor_aircon_id | text | Nullable; FK → public.aircons.id; Partial/expression UNIQUE: ecotrack_one_monitor_device_per_ac | — | Air conditioner observed by the device monitoring role; partial uniqueness applies for monitoring/both devices. |
| monitoring_id | uuid | UNIQUE; Nullable | — | Unique optional monitoring registry UUID. |
| sensor_config | jsonb | Nullable | — | Monitoring/configuration settings as JSON. |
| rotation_rpm | double precision | Nullable; CHECK: nodes_rotation_rpm_check | — | Measured rotation speed in revolutions per minute; null means unavailable. |
| last_measurement_at | timestamp with time zone | Nullable | — | Timestamp of the latest accepted measurement. |
| last_measurement_report_id | text | Nullable | — | Identifier of the last measurement report; logical reference without a declared FK. |
| rotation_quality | text | Nullable | — | Rotation measurement quality label. |

**Keys, checks, and references**

- UNIQUE nodes_aircon_id_key (aircon_id)
- UNIQUE nodes_monitoring_id_key (monitoring_id)
- UNIQUE nodes_name_key (name)
- PRIMARY KEY nodes_pkey (id)
- FOREIGN KEY nodes_aircon_id_fkey (aircon_id) → public.aircons (id); ON DELETE SET NULL; ON UPDATE NO ACTION
- FOREIGN KEY nodes_maintainer_id_fkey (maintainer_id) → public.staff (id); ON DELETE SET NULL; ON UPDATE NO ACTION
- FOREIGN KEY nodes_monitor_aircon_id_fkey (monitor_aircon_id) → public.aircons (id); ON DELETE SET NULL; ON UPDATE NO ACTION
- FOREIGN KEY nodes_room_id_fkey (room_id) → public.rooms (id); ON DELETE SET NULL; ON UPDATE NO ACTION
- nodes_device_mode_check: CHECK (device_mode = ANY (ARRAY['monitoring'::text, 'controller'::text, 'both'::text]))
- nodes_rotation_rpm_check: CHECK (rotation_rpm >= 0::double precision)
- LOGICAL REF admin_verified_by → auth.users.id; no declared FK

**Indexes (captured definitions)**

```sql
CREATE UNIQUE INDEX nodes_pkey ON public.nodes USING btree (id)
CREATE UNIQUE INDEX nodes_name_key ON public.nodes USING btree (name)
CREATE INDEX ecotrack_fk_nodes_maintainer_id ON public.nodes USING btree (maintainer_id)
CREATE UNIQUE INDEX nodes_monitoring_id_key ON public.nodes USING btree (monitoring_id)
CREATE UNIQUE INDEX ecotrack_one_monitor_device_per_ac ON public.nodes USING btree (monitor_aircon_id) WHERE ((monitor_aircon_id IS NOT NULL) AND (device_mode = ANY (ARRAY['monitoring'::text, 'both'::text])))
CREATE INDEX idx_nodes_room_id ON public.nodes USING btree (room_id)
CREATE INDEX idx_nodes_status ON public.nodes USING btree (status)
CREATE INDEX idx_nodes_updated ON public.nodes USING btree (updated DESC)
CREATE UNIQUE INDEX ecotrack_hardware_identity_idx ON public.nodes USING btree (name) WHERE (name ~ '^esp32s3-[a-f0-9]{12}$'::text)
CREATE UNIQUE INDEX nodes_aircon_id_key ON public.nodes USING btree (aircon_id)
CREATE INDEX idx_nodes_brand ON public.nodes USING btree (brand)
```

## 20. public.notifications

Administrator desktop inbox events, including rule, report, and installation context.

| Field | Data type | Constraints | Default | Description |
|---|---|---|---|---|
| id | text | PK; NOT NULL | ('notif_'::text \|\| substr(replace((gen_random_uuid())::text, '-'::text, ''::text), 1, 15)) | Primary identifier of the record. |
| date | text | NOT NULL | — | Desktop notification date text. |
| time | text | NOT NULL | — | Desktop notification time text. |
| content | text | NOT NULL | — | Desktop notification body text. |
| triggered | boolean | NOT NULL | false | Whether the notification was triggered. |
| room_id | text | Nullable; FK → public.rooms.id | — | Room identifier associated with the record. |
| rule_id | text | Nullable; FK → public.rules.id | — | Associated alert rule identifier. |
| admin_id | text | Nullable; FK → public.administrators.id | — | Associated desktop administrator profile identifier. |
| created | timestamp with time zone | NOT NULL | now() | Record creation timestamp; SQLite stores it as text. |
| updated | timestamp with time zone | NOT NULL | now() | Record update timestamp; SQLite stores it as text. |
| is_dismissed_from_inbox | boolean | NOT NULL | false | Whether the desktop inbox event is dismissed. |
| node_id | text | Nullable; REF → public.nodes.id (logical; no FK) | — | Associated device/monitoring node identifier; the constraint column specifies whether a database FK exists. |
| report_id | text | Nullable; REF → public.maintenance_reports.id (logical; no FK) | — | Logical associated maintenance report ID; no declared FK. |
| type | text | NOT NULL | 'standard'::text | Record category: rule, maintenance request, or notification according to the table. |
| event_key | text | Nullable; Partial/expression UNIQUE: notifications_event_key_unique | — | Event deduplication key. |
| installation_id | uuid | Nullable; REF → public.controller_installations.id (logical; no FK); Partial/expression UNIQUE: controller_installation_notification_unique | — | Logical installation event ID; unique when present, without a declared FK. |
| installation | jsonb | Nullable | — | Saved installation-event context as JSON. |

**Keys, checks, and references**

- PRIMARY KEY notifications_pkey (id)
- FOREIGN KEY notifications_admin_id_fkey (admin_id) → public.administrators (id); ON DELETE SET NULL; ON UPDATE NO ACTION
- FOREIGN KEY notifications_room_id_fkey (room_id) → public.rooms (id); ON DELETE SET NULL; ON UPDATE NO ACTION
- FOREIGN KEY notifications_rule_id_fkey (rule_id) → public.rules (id); ON DELETE SET NULL; ON UPDATE NO ACTION
- LOGICAL REF node_id → public.nodes.id; no declared FK
- LOGICAL REF report_id → public.maintenance_reports.id; no declared FK
- LOGICAL REF installation_id → public.controller_installations.id; no declared FK

**Indexes (captured definitions)**

```sql
CREATE UNIQUE INDEX notifications_pkey ON public.notifications USING btree (id)
CREATE INDEX ecotrack_fk_notifications_admin_id ON public.notifications USING btree (admin_id)
CREATE INDEX ecotrack_fk_notifications_room_id ON public.notifications USING btree (room_id)
CREATE INDEX ecotrack_fk_notifications_rule_id ON public.notifications USING btree (rule_id)
CREATE UNIQUE INDEX notifications_event_key_unique ON public.notifications USING btree (event_key) WHERE (event_key IS NOT NULL)
CREATE UNIQUE INDEX controller_installation_notification_unique ON public.notifications USING btree (installation_id) WHERE (installation_id IS NOT NULL)
```

## 21. public.rooms

Rooms associated with floors; contains configured node capacity and administrator ownership.

| Field | Data type | Constraints | Default | Description |
|---|---|---|---|---|
| id | text | PK; NOT NULL | ('rm_'::text \|\| substr(replace((gen_random_uuid())::text, '-'::text, ''::text), 1, 15)) | Primary identifier of the record. |
| name | text | NOT NULL | — | Human-readable display name. |
| node_limit | integer | NOT NULL | 5 | Configured maximum number of nodes for the room. |
| floor_id | text | Nullable; FK → public.floors.id | — | Associated floor identifier. |
| admin_id | text | Nullable; FK → public.administrators.id | — | Associated desktop administrator profile identifier. |
| created | timestamp with time zone | NOT NULL | now() | Record creation timestamp; SQLite stores it as text. |
| updated | timestamp with time zone | NOT NULL | now() | Record update timestamp; SQLite stores it as text. |

**Keys, checks, and references**

- PRIMARY KEY rooms_pkey (id)
- FOREIGN KEY rooms_admin_id_fkey (admin_id) → public.administrators (id); ON DELETE SET NULL; ON UPDATE NO ACTION
- FOREIGN KEY rooms_floor_id_fkey (floor_id) → public.floors (id); ON DELETE CASCADE; ON UPDATE NO ACTION

**Indexes (captured definitions)**

```sql
CREATE UNIQUE INDEX rooms_pkey ON public.rooms USING btree (id)
CREATE INDEX ecotrack_fk_rooms_admin_id ON public.rooms USING btree (admin_id)
CREATE INDEX ecotrack_fk_rooms_floor_id ON public.rooms USING btree (floor_id)
```

## 22. public.rule_nodes

Junction between rules and device nodes, with a unique rule/node pair.

| Field | Data type | Constraints | Default | Description |
|---|---|---|---|---|
| id | text | PK; NOT NULL | ('rn_'::text \|\| substr(replace((gen_random_uuid())::text, '-'::text, ''::text), 1, 15)) | Primary identifier of the record. |
| rule_id | text | UNIQUE (rule_id, node_id); NOT NULL; FK → public.rules.id | — | Associated alert rule identifier. |
| node_id | text | UNIQUE (rule_id, node_id); NOT NULL; FK → public.nodes.id | — | Associated device/monitoring node identifier; the constraint column specifies whether a database FK exists. |
| created | timestamp with time zone | NOT NULL | now() | Record creation timestamp; SQLite stores it as text. |
| updated | timestamp with time zone | NOT NULL | now() | Record update timestamp; SQLite stores it as text. |

**Keys, checks, and references**

- PRIMARY KEY rule_nodes_pkey (id)
- UNIQUE rule_nodes_rule_id_node_id_key (rule_id, node_id)
- FOREIGN KEY rule_nodes_node_id_fkey (node_id) → public.nodes (id); ON DELETE CASCADE; ON UPDATE NO ACTION
- FOREIGN KEY rule_nodes_rule_id_fkey (rule_id) → public.rules (id); ON DELETE CASCADE; ON UPDATE NO ACTION

**Indexes (captured definitions)**

```sql
CREATE UNIQUE INDEX rule_nodes_pkey ON public.rule_nodes USING btree (id)
CREATE UNIQUE INDEX rule_nodes_rule_id_node_id_key ON public.rule_nodes USING btree (rule_id, node_id)
CREATE INDEX ecotrack_fk_rule_nodes_node_id ON public.rule_nodes USING btree (node_id)
```

## 23. public.rules

Configured alert rules, thresholds, duration/time windows, and facility scope.

| Field | Data type | Constraints | Default | Description |
|---|---|---|---|---|
| id | text | PK; NOT NULL | ('rule_'::text \|\| substr(replace((gen_random_uuid())::text, '-'::text, ''::text), 1, 15)) | Primary identifier of the record. |
| type | text | NOT NULL | — | Record category: rule, maintenance request, or notification according to the table. |
| condition | text | NOT NULL | — | Rule comparison/operator or condition label. |
| value | numeric | NOT NULL | — | Configured numeric rule threshold. |
| unit | text | NOT NULL | — | Unit associated with the rule threshold. |
| enabled | boolean | NOT NULL | true | Whether the alert rule is enabled. |
| message | text | Nullable | — | Notification/rule message text. |
| duration | integer | Nullable | 5 | Configured rule duration/persistence value interpreted by rule evaluation. |
| start_date | text | Nullable | — | Start-date text for the rule window. |
| start_time | text | Nullable | — | Start-time text for the rule window. |
| end_date | text | Nullable | — | End-date text for the rule window. |
| end_time | text | Nullable | — | End-time text for the rule window. |
| room_id | text | Nullable; FK → public.rooms.id | — | Room identifier associated with the record. |
| building_id | text | Nullable; FK → public.buildings.id | — | Associated building identifier. |
| floor_id | text | Nullable; FK → public.floors.id | — | Associated floor identifier. |
| admin_id | text | Nullable; FK → public.administrators.id | — | Associated desktop administrator profile identifier. |
| created | timestamp with time zone | NOT NULL | now() | Record creation timestamp; SQLite stores it as text. |
| updated | timestamp with time zone | NOT NULL | now() | Record update timestamp; SQLite stores it as text. |

**Keys, checks, and references**

- PRIMARY KEY rules_pkey (id)
- FOREIGN KEY rules_admin_id_fkey (admin_id) → public.administrators (id); ON DELETE SET NULL; ON UPDATE NO ACTION
- FOREIGN KEY rules_building_id_fkey (building_id) → public.buildings (id); ON DELETE SET NULL; ON UPDATE NO ACTION
- FOREIGN KEY rules_floor_id_fkey (floor_id) → public.floors (id); ON DELETE SET NULL; ON UPDATE NO ACTION
- FOREIGN KEY rules_room_id_fkey (room_id) → public.rooms (id); ON DELETE SET NULL; ON UPDATE NO ACTION

**Indexes (captured definitions)**

```sql
CREATE UNIQUE INDEX rules_pkey ON public.rules USING btree (id)
CREATE INDEX ecotrack_fk_rules_admin_id ON public.rules USING btree (admin_id)
CREATE INDEX ecotrack_fk_rules_building_id ON public.rules USING btree (building_id)
CREATE INDEX ecotrack_fk_rules_floor_id ON public.rules USING btree (floor_id)
CREATE INDEX ecotrack_fk_rules_room_id ON public.rules USING btree (room_id)
```

## 24. public.staff

Staff profiles and maintenance assignment scope for the mobile application. Staff use the mobile application only.

| Field | Data type | Constraints | Default | Description |
|---|---|---|---|---|
| id | text | PK; NOT NULL | ('stf_'::text \|\| substr(replace((gen_random_uuid())::text, '-'::text, ''::text), 1, 15)) | Primary identifier of the record. |
| name | text | NOT NULL | — | Human-readable display name. |
| email | text | Nullable; Partial/expression UNIQUE: staff_normalized_email_unique | — | Account email address. |
| phone | text | Nullable; Partial/expression UNIQUE: staff_normalized_phone_unique | — | Account phone number in its supplied display format. |
| status | text | NOT NULL | 'Offline'::text | Workflow, record, or device status label. |
| last_active | timestamp with time zone | Nullable | now() | Most recently recorded staff activity timestamp. |
| created | timestamp with time zone | NOT NULL | now() | Record creation timestamp; SQLite stores it as text. |
| updated | timestamp with time zone | NOT NULL | now() | Record update timestamp; SQLite stores it as text. |
| avatar | text | Nullable | 'default'::text | Profile avatar reference retained for compatibility. |
| photo_url | text | Nullable | — | Photo URL/reference; profile, device, or maintenance evidence according to the table. |
| avatar_url | text | Nullable | — | Profile avatar URL/reference retained for compatibility. |
| role | text | Nullable | 'HVAC / Aircon Technician'::text | Application/profile role label; staff job roles do not create desktop administrator access. |
| building_name | text | Nullable | 'Main Campus Building'::text | Building-name snapshot stored with the event/measurement/profile. |
| floor_name | text | Nullable | '2nd Floor - IT Wing'::text | Floor-name snapshot stored with the event/measurement/profile. |
| room_name | text | Nullable | 'Server Room A'::text | Room-name snapshot stored with the event/measurement/profile. |
| assignment | text | Nullable | 'Main Campus Building • 2nd Floor - IT Wing • Server Room A'::text | Human-readable staff location assignment text. |
| room_id | text | Nullable; REF → public.rooms.id (logical; no FK) | — | Logical assigned public.rooms.id; no declared database FK in the captured schema. |
| is_archived | boolean | Nullable | false | Whether the profile is archived. |
| archive_reason | text | Nullable | — | Reason for archiving the staff profile. |
| archive_notes | text | Nullable | — | Additional staff archive notes. |
| archived_at | timestamp with time zone | Nullable | — | Timestamp when a profile/notification state was archived. |
| is_online | boolean | Nullable | false | Recorded account presence flag; not hardware/AC operating evidence. |
| is_active | boolean | Nullable | true | Whether the account is enabled. |
| online_status | text | Nullable | 'offline'::text | Staff account presence/status label. |
| password | text | Nullable | — | Legacy application credential column; nullable. Supabase Auth owns current identity authentication; no credential values are documented. |
| auth_user_id | uuid | UNIQUE; Nullable; FK → auth.users.id | — | Associated Supabase Auth user identifier. |
| force_logout | boolean | NOT NULL | false | Whether the staff session must be invalidated. |
| auth_valid_after | timestamp with time zone | NOT NULL | '-infinity'::timestamp with time zone | Session-validity cutoff used to invalidate older authentication sessions. |
| phone_digits | text | Nullable | — | Normalized phone digits used for account identity/contact matching. |
| assignment_scope | text | NOT NULL; CHECK: staff_assignment_scope_check | 'room'::text | Staff assignment level: room, floor, building, or all. |
| assigned_floor_id | text | Nullable; FK → public.floors.id | — | Assigned floor for floor-scope staff access. |
| assigned_building_id | text | Nullable; FK → public.buildings.id | — | Assigned building for building-scope staff access. |

**Keys, checks, and references**

- UNIQUE staff_auth_user_id_key (auth_user_id)
- PRIMARY KEY staff_pkey (id)
- FOREIGN KEY staff_assigned_building_id_fkey (assigned_building_id) → public.buildings (id); ON DELETE SET NULL; ON UPDATE NO ACTION
- FOREIGN KEY staff_assigned_floor_id_fkey (assigned_floor_id) → public.floors (id); ON DELETE SET NULL; ON UPDATE NO ACTION
- FOREIGN KEY staff_auth_user_id_fkey (auth_user_id) → auth.users (id); ON DELETE SET NULL; ON UPDATE NO ACTION
- staff_assignment_scope_check: CHECK (assignment_scope = ANY (ARRAY['room'::text, 'floor'::text, 'building'::text, 'all'::text]))
- LOGICAL REF room_id → public.rooms.id; no declared FK

**Indexes (captured definitions)**

```sql
CREATE UNIQUE INDEX staff_pkey ON public.staff USING btree (id)
CREATE INDEX ecotrack_fk_staff_assigned_building_id ON public.staff USING btree (assigned_building_id)
CREATE INDEX ecotrack_fk_staff_assigned_floor_id ON public.staff USING btree (assigned_floor_id)
CREATE UNIQUE INDEX staff_auth_user_id_key ON public.staff USING btree (auth_user_id)
CREATE UNIQUE INDEX staff_normalized_email_unique ON public.staff USING btree (lower(btrim(email))) WHERE (NULLIF(btrim(email), ''::text) IS NOT NULL)
CREATE UNIQUE INDEX staff_normalized_phone_unique ON public.staff USING btree (regexp_replace(phone, '[^0-9]'::text, ''::text, 'g'::text)) WHERE (NULLIF(regexp_replace(phone, '[^0-9]'::text, ''::text, 'g'::text), ''::text) IS NOT NULL)
```

## 25. public.staff_push_tokens

Mobile push tokens, authenticated staff identity, platform, and notification preferences.

| Field | Data type | Constraints | Default | Description |
|---|---|---|---|---|
| token | text | PK; NOT NULL | — | Primary mobile push token value. |
| auth_user_id | uuid | NOT NULL; FK → auth.users.id | — | Associated Supabase Auth user identifier. |
| staff_id | text | NOT NULL; FK → public.staff.id | — | Assigned/recipient mobile staff profile identifier. |
| platform | text | NOT NULL; CHECK: staff_push_tokens_platform_check | — | Mobile operating platform associated with the push token. |
| critical_enabled | boolean | NOT NULL | true | Whether critical push notifications are enabled for this token. |
| maintenance_enabled | boolean | NOT NULL | true | Whether maintenance push notifications are enabled for this token. |
| updated_at | timestamp with time zone | NOT NULL | now() | Record update timestamp; SQLite stores it as text. |

**Keys, checks, and references**

- PRIMARY KEY staff_push_tokens_pkey (token)
- FOREIGN KEY staff_push_tokens_auth_user_id_fkey (auth_user_id) → auth.users (id); ON DELETE CASCADE; ON UPDATE NO ACTION
- FOREIGN KEY staff_push_tokens_staff_id_fkey (staff_id) → public.staff (id); ON DELETE CASCADE; ON UPDATE NO ACTION
- staff_push_tokens_platform_check: CHECK (platform = ANY (ARRAY['android'::text, 'ios'::text]))

**Indexes (captured definitions)**

```sql
CREATE INDEX ecotrack_fk_staff_push_tokens_auth_user_id ON public.staff_push_tokens USING btree (auth_user_id)
CREATE INDEX ecotrack_fk_staff_push_tokens_staff_id ON public.staff_push_tokens USING btree (staff_id)
CREATE UNIQUE INDEX staff_push_tokens_pkey ON public.staff_push_tokens USING btree (token)
```

## 26. public.telemetry

Temporary cloud telemetry bridge and live measurements with device/equipment identifiers and captured control context. Permanent telemetry history is retained in desktop SQLite. Device/equipment links are logical, not declared foreign keys.

| Field | Data type | Constraints | Default | Description |
|---|---|---|---|---|
| id | text | PK; NOT NULL | ('telem_'::text \|\| substr(md5((random())::text), 1, 12)) | Primary identifier of the record. |
| node_id | text | Nullable; REF → public.nodes.id (logical; no FK) | — | Logical cloud device identifier (public.nodes.id); no declared FK in either cloud telemetry or SQLite telemetry. |
| sensor_name | text | Nullable | — | Device/sensor display-name snapshot. |
| room_name | text | Nullable | — | Room-name snapshot stored with the event/measurement/profile. |
| floor_name | text | Nullable | — | Floor-name snapshot stored with the event/measurement/profile. |
| building_name | text | Nullable | — | Building-name snapshot stored with the event/measurement/profile. |
| aircon_type | text | Nullable | — | Air-conditioner type/category label or historical snapshot. |
| temperature | numeric | Nullable | — | Historical recorded temperature in degrees Celsius; nullable and not produced by the current MCP9808-free firmware. |
| battery | numeric | Nullable | — | Historical battery value; nullable and not produced by the current firmware. |
| rssi | integer | Nullable | — | Received signal strength; dBm where supplied by the device. |
| status | text | Nullable | 'online'::text | Workflow, record, or device status label. |
| created | timestamp with time zone | Nullable | now() | Record creation timestamp; SQLite stores it as text. |
| interval_seconds | numeric | Nullable | — | Reporting/measurement interval in seconds. |
| ac_on | boolean | Nullable | — | Explicit recorded AC power-state evidence; unknown stays null. Commands, online status, or IR transmission alone do not prove power. |
| aircon_id | text | Nullable; REF → public.aircons.id (logical; no FK) | — | Logical cloud asset identifier (public.aircons.id); no declared FK in either cloud telemetry or SQLite telemetry. |
| control_snapshot | jsonb | Nullable | — | Captured climate-control/remote context as JSONB in cloud or JSON text locally; keep distinct from measured power. |
| rotation_rpm | double precision | Nullable; CHECK: telemetry_rotation_rpm_check | — | Measured rotation speed in revolutions per minute; null means unavailable. |
| rotation_quality | text | Nullable; CHECK: telemetry_rotation_quality_check | — | Rotation measurement quality label. |
| observed_at | timestamp with time zone | Nullable | — | Device observation timestamp, distinct from ingestion/receipt time. |
| boot_id | text | Nullable | — | Device boot/session identifier used with sequence for duplicate detection. |
| sequence | bigint | Nullable | — | Monotonic sequence within a device boot/session. |

**Keys, checks, and references**

- PRIMARY KEY telemetry_pkey (id)
- telemetry_rotation_quality_check: CHECK (rotation_quality = ANY (ARRAY['ok'::text, 'missing'::text, 'fault'::text]))
- telemetry_rotation_rpm_check: CHECK (rotation_rpm >= 0::double precision)
- LOGICAL REF node_id → public.nodes.id; no declared FK
- LOGICAL REF aircon_id → public.aircons.id; no declared FK

**Indexes (captured definitions)**

```sql
CREATE UNIQUE INDEX telemetry_pkey ON public.telemetry USING btree (id)
CREATE INDEX idx_telemetry_created ON public.telemetry USING btree (created DESC)
CREATE INDEX idx_telemetry_node_created ON public.telemetry USING btree (node_id, created DESC)
CREATE INDEX telemetry_cloud_cursor_idx ON public.telemetry USING btree (created, id)
```

## 27. sqlite.cloud_sync_state

Durable cloud-import cursor for each synchronization source.

| Field | Data type | Constraints | Default | Description |
|---|---|---|---|---|
| source | TEXT | PK; Nullable (SQLite declaration) | — | Synchronization source identifier. |
| cursor_created | TEXT | NOT NULL | — | Timestamp portion of the durable cloud-import cursor. |
| cursor_id | TEXT | NOT NULL | — | Record-ID tie-breaker of the durable cloud-import cursor. |

**Keys, checks, and references**

- PRIMARY KEY PRIMARY KEY (source)

**Indexes (captured definitions)**

```sql
sqlite_autoindex_cloud_sync_state_1: UNIQUE (source); implicit pk index
```

**SQLite table declaration**

```sql
CREATE TABLE cloud_sync_state (
                source TEXT PRIMARY KEY, cursor_created TEXT NOT NULL, cursor_id TEXT NOT NULL
            );
```

## 28. sqlite.monitor_calibrations

Dated calibration records associated with a local monitoring node; temperature calibration columns remain for historical compatibility.

| Field | Data type | Constraints | Default | Description |
|---|---|---|---|---|
| id | TEXT | PK; Nullable (SQLite declaration) | — | Primary identifier of the record. |
| node_id | TEXT | NOT NULL; FK → sqlite.monitor_nodes.id | — | Associated device/monitoring node identifier; the constraint column specifies whether a database FK exists. |
| valid_from | TEXT | NOT NULL | — | Timestamp from which this calibration applies. |
| temperature_offset_c | REAL | NOT NULL | — | Stored historical temperature calibration offset in degrees Celsius; retained without implying a current temperature sensor. |
| notes | TEXT | NOT NULL | — | Calibration notes. |
| field_calibrated | INTEGER | NOT NULL | — | Integer boolean indicating field calibration. |
| created_at | TEXT | NOT NULL | — | Record creation timestamp; SQLite stores it as text. |

**Keys, checks, and references**

- PRIMARY KEY PRIMARY KEY (id)
- FOREIGN KEY FK_monitor_calibrations_node_id (node_id) → sqlite.monitor_nodes (id); ON DELETE NO ACTION; ON UPDATE NO ACTION

**Indexes (captured definitions)**

```sql
CREATE INDEX monitor_cal_node_time ON monitor_calibrations(node_id,valid_from)
sqlite_autoindex_monitor_calibrations_1: UNIQUE (id); implicit pk index
```

**SQLite table declaration**

```sql
CREATE TABLE monitor_calibrations (
 id TEXT PRIMARY KEY, node_id TEXT NOT NULL REFERENCES monitor_nodes(id), valid_from TEXT NOT NULL,
 temperature_offset_c REAL NOT NULL, notes TEXT NOT NULL, field_calibrated INTEGER NOT NULL, created_at TEXT NOT NULL
);
```

## 29. sqlite.monitor_changed_nodes

Latest change revision for each monitoring node, used by incremental refresh.

| Field | Data type | Constraints | Default | Description |
|---|---|---|---|---|
| node_id | TEXT | PK; Nullable (SQLite declaration); REF → sqlite.monitor_nodes.id (logical; no FK) | — | Changed local monitoring-node ID; a logical reference without a declared FK. |
| version | INTEGER | NOT NULL | — | Monotonic local change revision. |

**Keys, checks, and references**

- PRIMARY KEY PRIMARY KEY (node_id)
- LOGICAL REF node_id → sqlite.monitor_nodes.id; no declared FK

**Indexes (captured definitions)**

```sql
sqlite_autoindex_monitor_changed_nodes_1: UNIQUE (node_id); implicit pk index
```

**SQLite table declaration**

```sql
CREATE TABLE monitor_changed_nodes (node_id TEXT PRIMARY KEY, version INTEGER NOT NULL);
```

## 30. sqlite.monitor_nodes

Desktop local monitoring registry, cloud registry association, measurement cadence, activation state, and credential digest.

| Field | Data type | Constraints | Default | Description |
|---|---|---|---|---|
| id | TEXT | PK; Nullable (SQLite declaration) | — | Primary identifier of the record. |
| name | TEXT | NOT NULL | — | Human-readable display name. |
| aircon_id | TEXT | NOT NULL; REF → public.aircons.id (logical; no FK); Partial/expression UNIQUE: monitor_one_active_per_ac | — | Logical public.aircons.id; no cross-database FK. A partial unique index permits one active local monitor per asset. |
| aircon_name | TEXT | NOT NULL | — | Air-conditioner display-name snapshot. |
| location | TEXT | NOT NULL | '' | Human-readable location text or snapshot. |
| state_source | TEXT | NOT NULL | 'none' | Source of AC power-state evidence; only trustworthy measured/isolated feedback confirms operation. |
| expected_interval_seconds | REAL | NOT NULL | — | Expected reporting cadence in seconds. |
| active | INTEGER | NOT NULL; Partial/expression UNIQUE: monitor_one_active_per_ac | 1 | Integer boolean indicating an active monitoring registration. |
| token_hash | TEXT | NOT NULL | — | Credential/token digest; actual digests and secrets are excluded from this documentation. |
| created_at | TEXT | NOT NULL | — | Record creation timestamp; SQLite stores it as text. |
| updated_at | TEXT | NOT NULL | — | Record update timestamp; SQLite stores it as text. |
| aircon_type | TEXT | Nullable (SQLite declaration) | — | Air-conditioner type/category label or historical snapshot. |
| registry_node_id | TEXT | Nullable (SQLite declaration); REF → public.nodes.id (logical; no FK) | — | Logical public.nodes ID connecting the local monitoring registry to the cloud device registry. |
| registry_retired | INTEGER | NOT NULL | 0 | Integer boolean indicating that the corresponding cloud registration is retired. |

**Keys, checks, and references**

- PRIMARY KEY PRIMARY KEY (id)
- LOGICAL REF aircon_id → public.aircons.id; no declared FK
- LOGICAL REF registry_node_id → public.nodes.id; no declared FK

**Indexes (captured definitions)**

```sql
CREATE UNIQUE INDEX monitor_one_active_per_ac ON monitor_nodes(aircon_id) WHERE active=1
sqlite_autoindex_monitor_nodes_1: UNIQUE (id); implicit pk index
```

**SQLite table declaration**

```sql
CREATE TABLE monitor_nodes (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, aircon_id TEXT NOT NULL, aircon_name TEXT NOT NULL,
 location TEXT NOT NULL DEFAULT '', state_source TEXT NOT NULL DEFAULT 'none', expected_interval_seconds REAL NOT NULL,
 active INTEGER NOT NULL DEFAULT 1, token_hash TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
, aircon_type TEXT, registry_node_id TEXT, registry_retired INTEGER NOT NULL DEFAULT 0);
```

## 31. sqlite.monitor_revision

Singleton generation/version used to detect changes in local monitoring data.

| Field | Data type | Constraints | Default | Description |
|---|---|---|---|---|
| id | INTEGER | PK; NOT NULL; CHECK (id = 1) | — | Singleton row key constrained to 1. |
| generation | TEXT | NOT NULL | — | Generation token invalidating prior monitoring revisions. |
| version | INTEGER | NOT NULL | — | Monotonic local change revision. |

**Keys, checks, and references**

- PRIMARY KEY PRIMARY KEY (id)

**SQLite table declaration**

```sql
CREATE TABLE monitor_revision (
                    id INTEGER PRIMARY KEY CHECK(id=1), generation TEXT NOT NULL, version INTEGER NOT NULL);
```

## 32. sqlite.monitor_samples

Desktop local measurements with boot/sequence duplicate protection, quality metadata, and calibration references.

| Field | Data type | Constraints | Default | Description |
|---|---|---|---|---|
| id | TEXT | PK; Nullable (SQLite declaration) | — | Primary identifier of the record. |
| node_id | TEXT | UNIQUE (node_id, boot_id, sequence); NOT NULL; FK → sqlite.monitor_nodes.id | — | Associated device/monitoring node identifier; the constraint column specifies whether a database FK exists. |
| aircon_id | TEXT | NOT NULL; REF → public.aircons.id (logical; no FK) | — | Cloud air-conditioner ID snapshot; no declared FK. |
| aircon_name | TEXT | NOT NULL | — | Air-conditioner display-name snapshot. |
| observed_at | TEXT | Nullable (SQLite declaration) | — | Device observation timestamp, distinct from ingestion/receipt time. |
| received_at | TEXT | NOT NULL | — | Local timestamp when the measurement was received. |
| boot_id | TEXT | UNIQUE (node_id, boot_id, sequence); NOT NULL | — | Device boot/session identifier used with sequence for duplicate detection. |
| sequence | INTEGER | UNIQUE (node_id, boot_id, sequence); NOT NULL | — | Monotonic sequence within a device boot/session. |
| uptime_ms | INTEGER | Nullable (SQLite declaration) | — | Device uptime in milliseconds when the measurement was taken. |
| interval_seconds | REAL | NOT NULL | — | Reporting/measurement interval in seconds. |
| clock_quality | TEXT | NOT NULL | — | Quality/source of the device observation timestamp. |
| raw_temperature_c | REAL | Nullable (SQLite declaration) | — | Historical uncalibrated temperature in degrees Celsius; nullable and not produced by current firmware. |
| outlet_temperature_c | REAL | Nullable (SQLite declaration) | — | Historical calibrated outlet temperature in degrees Celsius; nullable and not produced by current firmware. |
| ac_on | INTEGER | Nullable (SQLite declaration) | — | Explicit recorded AC power-state evidence; unknown stays null. Commands, online status, or IR transmission alone do not prove power. |
| state_source | TEXT | Nullable (SQLite declaration) | — | Source of AC power-state evidence; only trustworthy measured/isolated feedback confirms operation. |
| temperature_quality | TEXT | NOT NULL | — | Quality/availability label retained for historical temperature records. |
| calibration_id | TEXT | NOT NULL; FK → sqlite.monitor_calibrations.id | — | Calibration record associated with this measurement. |
| payload_hash | TEXT | NOT NULL | — | Digest of the accepted measurement payload for duplicate/conflict checks. |
| sensor_name | TEXT | Nullable (SQLite declaration) | — | Device/sensor display-name snapshot. |
| location | TEXT | Nullable (SQLite declaration) | — | Human-readable location text or snapshot. |
| aircon_type | TEXT | Nullable (SQLite declaration) | — | Air-conditioner type/category label or historical snapshot. |
| battery_voltage | REAL | Nullable (SQLite declaration) | — | Historical battery voltage; nullable and not produced by current firmware. |
| rssi_dbm | REAL | Nullable (SQLite declaration) | — | Reported wireless received signal strength in dBm. |
| connection_status | TEXT | Nullable (SQLite declaration) | — | Recorded device connectivity status. |
| operating_mode | TEXT | Nullable (SQLite declaration) | — | Recorded operating-mode label. |
| rotation_rpm | REAL | Nullable (SQLite declaration) | — | Measured rotation speed in revolutions per minute; null means unavailable. |
| rotation_quality | TEXT | NOT NULL | 'missing' | Rotation measurement quality label. |
| control_snapshot | TEXT | Nullable (SQLite declaration) | — | Captured climate-control/remote context as JSONB in cloud or JSON text locally; keep distinct from measured power. |

**Keys, checks, and references**

- PRIMARY KEY PRIMARY KEY (id)
- UNIQUE sqlite_autoindex_monitor_samples_2 (node_id, boot_id, sequence)
- FOREIGN KEY FK_monitor_samples_calibration_id (calibration_id) → sqlite.monitor_calibrations (id); ON DELETE NO ACTION; ON UPDATE NO ACTION
- FOREIGN KEY FK_monitor_samples_node_id (node_id) → sqlite.monitor_nodes (id); ON DELETE NO ACTION; ON UPDATE NO ACTION
- LOGICAL REF aircon_id → public.aircons.id; no declared FK

**Indexes (captured definitions)**

```sql
CREATE INDEX monitor_sample_received ON monitor_samples(node_id,received_at)
CREATE INDEX monitor_sample_node_time ON monitor_samples(node_id,observed_at)
CREATE INDEX monitor_sample_ac_time ON monitor_samples(aircon_id,observed_at)
sqlite_autoindex_monitor_samples_2: UNIQUE (node_id, boot_id, sequence); implicit u index
sqlite_autoindex_monitor_samples_1: UNIQUE (id); implicit pk index
```

**SQLite table declaration**

```sql
CREATE TABLE monitor_samples (
 id TEXT PRIMARY KEY, node_id TEXT NOT NULL REFERENCES monitor_nodes(id), aircon_id TEXT NOT NULL,
 aircon_name TEXT NOT NULL, observed_at TEXT, received_at TEXT NOT NULL, boot_id TEXT NOT NULL,
 sequence INTEGER NOT NULL, uptime_ms INTEGER, interval_seconds REAL NOT NULL, clock_quality TEXT NOT NULL,
 raw_temperature_c REAL, outlet_temperature_c REAL, ac_on INTEGER, state_source TEXT, temperature_quality TEXT NOT NULL, calibration_id TEXT NOT NULL REFERENCES monitor_calibrations(id), payload_hash TEXT NOT NULL, sensor_name TEXT, location TEXT, aircon_type TEXT, battery_voltage REAL, rssi_dbm REAL, connection_status TEXT, operating_mode TEXT, rotation_rpm REAL, rotation_quality TEXT NOT NULL DEFAULT 'missing', control_snapshot TEXT,
 UNIQUE(node_id,boot_id,sequence)
);
```

## 33. sqlite.monitor_sync_outbox

Ordered pending synchronization records for the local monitoring subsystem.

| Field | Data type | Constraints | Default | Description |
|---|---|---|---|---|
| id | INTEGER | PK; NOT NULL | — | Autoincrementing local outbox sequence identifier. |
| table_name | TEXT | NOT NULL | — | Logical target table/category for an outbox record; not a database FK. |
| object_id | TEXT | NOT NULL | — | Logical object identifier in the outbox payload; not a database FK. |
| payload | TEXT | NOT NULL | — | Serialized request/record payload; JSONB in cloud tables and JSON text locally. |

**Keys, checks, and references**

- PRIMARY KEY PRIMARY KEY (id)

**SQLite table declaration**

```sql
CREATE TABLE monitor_sync_outbox (
 id INTEGER PRIMARY KEY AUTOINCREMENT, table_name TEXT NOT NULL, object_id TEXT NOT NULL, payload TEXT NOT NULL
);
```

## 34. sqlite.monitor_sync_status

Singleton local monitoring synchronization success/error state.

| Field | Data type | Constraints | Default | Description |
|---|---|---|---|---|
| id | INTEGER | PK; NOT NULL; CHECK (id = 1) | — | Singleton row key constrained to 1. |
| last_success | TEXT | Nullable (SQLite declaration) | — | Timestamp of the last successful synchronization/backup. |
| error | TEXT | Nullable (SQLite declaration) | — | Most recently recorded operation error text. |

**Keys, checks, and references**

- PRIMARY KEY PRIMARY KEY (id)

**SQLite table declaration**

```sql
CREATE TABLE monitor_sync_status (id INTEGER PRIMARY KEY CHECK(id=1),last_success TEXT,error TEXT);
```

## 35. sqlite.schedule_dispatches

Local schedule-forwarding dispatch attempts and transport outcomes.

| Field | Data type | Constraints | Default | Description |
|---|---|---|---|---|
| id | TEXT | PK; Nullable (SQLite declaration) | — | Primary identifier of the record. |
| node_id | TEXT | Nullable (SQLite declaration) | — | Cloud/local device identifier used for forwarding; no declared FK. |
| ip | TEXT | Nullable (SQLite declaration) | — | Device IP address used for schedule forwarding. |
| interval_seconds | INTEGER | Nullable (SQLite declaration) | — | Reporting/measurement interval in seconds. |
| status | TEXT | Nullable (SQLite declaration) | — | Workflow, record, or device status label. |
| error | TEXT | Nullable (SQLite declaration) | — | Most recently recorded operation error text. |
| created | TEXT | Nullable (SQLite declaration) | — | Record creation timestamp; SQLite stores it as text. |
| updated | TEXT | Nullable (SQLite declaration) | — | Record update timestamp; SQLite stores it as text. |

**Keys, checks, and references**

- PRIMARY KEY PRIMARY KEY (id)

**Indexes (captured definitions)**

```sql
sqlite_autoindex_schedule_dispatches_1: UNIQUE (id); implicit pk index
```

**SQLite table declaration**

```sql
CREATE TABLE schedule_dispatches (
                id TEXT PRIMARY KEY, node_id TEXT, ip TEXT, interval_seconds INTEGER,
                status TEXT, error TEXT, created TEXT, updated TEXT
            );
```

## 36. sqlite.sensor_schedules

One local wake/sleep and reporting-cadence schedule per monitoring node.

| Field | Data type | Constraints | Default | Description |
|---|---|---|---|---|
| node_id | TEXT | PK; Nullable (SQLite declaration); FK → sqlite.monitor_nodes.id | — | Associated device/monitoring node identifier; the constraint column specifies whether a database FK exists. |
| wake_time | TEXT | NOT NULL | — | Configured daily wake time in application time-of-day text format. |
| sleep_time | TEXT | NOT NULL | — | Configured daily sleep time in application time-of-day text format. |
| interval_seconds | INTEGER | NOT NULL | — | Reporting/measurement interval in seconds. |
| updated_at | TEXT | NOT NULL | — | Record update timestamp; SQLite stores it as text. |

**Keys, checks, and references**

- PRIMARY KEY PRIMARY KEY (node_id)
- FOREIGN KEY FK_sensor_schedules_node_id (node_id) → sqlite.monitor_nodes (id); ON DELETE NO ACTION; ON UPDATE NO ACTION

**Indexes (captured definitions)**

```sql
sqlite_autoindex_sensor_schedules_1: UNIQUE (node_id); implicit pk index
```

**SQLite table declaration**

```sql
CREATE TABLE sensor_schedules (
 node_id TEXT PRIMARY KEY REFERENCES monitor_nodes(id), wake_time TEXT NOT NULL,
 sleep_time TEXT NOT NULL, interval_seconds INTEGER NOT NULL, updated_at TEXT NOT NULL
);
```

## 37. sqlite.telemetry

Desktop Daily Logs telemetry history, including imported cloud rows and local control/measurement context.

| Field | Data type | Constraints | Default | Description |
|---|---|---|---|---|
| id | TEXT | PK; Nullable (SQLite declaration) | — | Primary identifier of the record. |
| node_id | TEXT | Nullable (SQLite declaration); REF → public.nodes.id (logical; no FK) | — | Logical cloud device identifier (public.nodes.id); no declared FK in either cloud telemetry or SQLite telemetry. |
| sensor_name | TEXT | Nullable (SQLite declaration) | — | Device/sensor display-name snapshot. |
| room_name | TEXT | Nullable (SQLite declaration) | — | Room-name snapshot stored with the event/measurement/profile. |
| floor_name | TEXT | Nullable (SQLite declaration) | — | Floor-name snapshot stored with the event/measurement/profile. |
| building_name | TEXT | Nullable (SQLite declaration) | — | Building-name snapshot stored with the event/measurement/profile. |
| aircon_type | TEXT | Nullable (SQLite declaration) | — | Air-conditioner type/category label or historical snapshot. |
| temperature | REAL | Nullable (SQLite declaration) | — | Historical recorded temperature in degrees Celsius; nullable and not produced by the current MCP9808-free firmware. |
| battery | REAL | Nullable (SQLite declaration) | — | Historical battery value; nullable and not produced by the current firmware. |
| rssi | REAL | Nullable (SQLite declaration) | — | Received signal strength; dBm where supplied by the device. |
| status | TEXT | Nullable (SQLite declaration) | — | Workflow, record, or device status label. |
| created | TEXT | Nullable (SQLite declaration) | — | Record creation timestamp; SQLite stores it as text. |
| updated | TEXT | Nullable (SQLite declaration) | — | Record update timestamp; SQLite stores it as text. |
| event_type | TEXT | Nullable (SQLite declaration) | — | Local telemetry/control event category. |
| interval_seconds | INTEGER | Nullable (SQLite declaration) | — | Reporting/measurement interval in seconds. |
| wake_time | TEXT | Nullable (SQLite declaration) | — | Configured daily wake time in application time-of-day text format. |
| sleep_time | TEXT | Nullable (SQLite declaration) | — | Configured daily sleep time in application time-of-day text format. |
| ac_on | INTEGER | Nullable (SQLite declaration) | — | Explicit recorded AC power-state evidence; unknown stays null. Commands, online status, or IR transmission alone do not prove power. |
| aircon_id | TEXT | Nullable (SQLite declaration); REF → public.aircons.id (logical; no FK) | — | Logical cloud asset identifier (public.aircons.id); no declared FK in either cloud telemetry or SQLite telemetry. |
| control_snapshot | TEXT | Nullable (SQLite declaration) | — | Captured climate-control/remote context as JSONB in cloud or JSON text locally; keep distinct from measured power. |
| ac_state | TEXT | Nullable (SQLite declaration) | — | Legacy serialized AC control-state representation. |
| rotation_rpm | REAL | Nullable (SQLite declaration) | — | Measured rotation speed in revolutions per minute; null means unavailable. |
| rotation_quality | TEXT | Nullable (SQLite declaration) | — | Rotation measurement quality label. |
| observed_at | TEXT | Nullable (SQLite declaration) | — | Device observation timestamp, distinct from ingestion/receipt time. |
| boot_id | TEXT | Nullable (SQLite declaration) | — | Device boot/session identifier used with sequence for duplicate detection. |
| sequence | INTEGER | Nullable (SQLite declaration) | — | Monotonic sequence within a device boot/session. |

**Keys, checks, and references**

- PRIMARY KEY PRIMARY KEY (id)
- LOGICAL REF node_id → public.nodes.id; no declared FK
- LOGICAL REF aircon_id → public.aircons.id; no declared FK

**Indexes (captured definitions)**

```sql
CREATE INDEX idx_telem_node ON telemetry (node_id)
CREATE INDEX idx_telem_sensor ON telemetry (sensor_name)
CREATE INDEX idx_telem_created ON telemetry (created DESC)
sqlite_autoindex_telemetry_1: UNIQUE (id); implicit pk index
```

**SQLite table declaration**

```sql
CREATE TABLE telemetry (
                    id TEXT PRIMARY KEY,
                    node_id TEXT,
                    sensor_name TEXT,
                    room_name TEXT,
                    floor_name TEXT,
                    building_name TEXT,
                    aircon_type TEXT,
                    temperature REAL,
                    battery REAL,
                    rssi REAL,
                    status TEXT,
                    created TEXT,
                    updated TEXT
                , event_type TEXT, interval_seconds INTEGER, wake_time TEXT, sleep_time TEXT, ac_on INTEGER, aircon_id TEXT, control_snapshot TEXT, ac_state TEXT, rotation_rpm REAL, rotation_quality TEXT, observed_at TEXT, boot_id TEXT, sequence INTEGER);
```

## 38. sqlite.telemetry_backup_state

Singleton history-backup result and output-file metadata.

| Field | Data type | Constraints | Default | Description |
|---|---|---|---|---|
| id | INTEGER | PK; NOT NULL; CHECK (id = 1) | — | Singleton row key constrained to 1. |
| last_success | TEXT | Nullable (SQLite declaration) | — | Timestamp of the last successful synchronization/backup. |
| completed_epoch | REAL | Nullable (SQLite declaration) | — | Epoch timestamp for the completed backup. |
| filename | TEXT | Nullable (SQLite declaration) | — | Backup output filename/path metadata. |
| error | TEXT | Nullable (SQLite declaration) | — | Most recently recorded operation error text. |

**Keys, checks, and references**

- PRIMARY KEY PRIMARY KEY (id)

**SQLite table declaration**

```sql
CREATE TABLE telemetry_backup_state (
                id INTEGER PRIMARY KEY CHECK(id=1), last_success TEXT, completed_epoch REAL,
                filename TEXT, error TEXT);
```

## 39. sqlite.telemetry_cloud_receipts

Retained cloud-import receipt payloads and cleanup status for telemetry history.

| Field | Data type | Constraints | Default | Description |
|---|---|---|---|---|
| id | TEXT | PK; Nullable (SQLite declaration); REF → sqlite.telemetry.id (logical; no FK) | — | Source telemetry record ID; logical association to local telemetry.id without a declared FK. |
| payload | TEXT | NOT NULL | — | Serialized request/record payload; JSONB in cloud tables and JSON text locally. |
| cleaned_at | TEXT | Nullable (SQLite declaration) | — | Timestamp when the retained cloud receipt was cleaned/processed. |

**Keys, checks, and references**

- PRIMARY KEY PRIMARY KEY (id)
- LOGICAL REF id → sqlite.telemetry.id; no declared FK

**Indexes (captured definitions)**

```sql
CREATE INDEX telemetry_cloud_pending ON telemetry_cloud_receipts(id) WHERE cleaned_at IS NULL
sqlite_autoindex_telemetry_cloud_receipts_1: UNIQUE (id); implicit pk index
```

**SQLite table declaration**

```sql
CREATE TABLE telemetry_cloud_receipts (
                id TEXT PRIMARY KEY, payload TEXT NOT NULL, cleaned_at TEXT
            );
```

## 40. sqlite.telemetry_history_generation

Singleton invalidation token for incremental telemetry-history snapshots.

| Field | Data type | Constraints | Default | Description |
|---|---|---|---|---|
| id | INTEGER | PK; NOT NULL; CHECK (id = 1) | — | Singleton row key constrained to 1. |
| token | TEXT | NOT NULL | — | Random generation token invalidating prior telemetry-history snapshots. |

**Keys, checks, and references**

- PRIMARY KEY PRIMARY KEY (id)

**SQLite table declaration**

```sql
CREATE TABLE telemetry_history_generation (
                id INTEGER PRIMARY KEY CHECK (id = 1), token TEXT NOT NULL
            );
```

## 41. sqlite.telemetry_local_reset

Singleton deletion watermark used to preserve the effect of local history resets during synchronization.

| Field | Data type | Constraints | Default | Description |
|---|---|---|---|---|
| id | INTEGER | PK; NOT NULL; CHECK (id = 1) | — | Singleton row key constrained to 1. |
| deleted_through | TEXT | NOT NULL | — | Time watermark through which locally deleted history must remain excluded. |

**Keys, checks, and references**

- PRIMARY KEY PRIMARY KEY (id)

**SQLite table declaration**

```sql
CREATE TABLE telemetry_local_reset (
            id INTEGER PRIMARY KEY CHECK(id=1), deleted_through TEXT NOT NULL
        );
```

## 42. sqlite.telemetry_monitor_sources

Retained source payloads linking telemetry imports with the local monitor bridge.

| Field | Data type | Constraints | Default | Description |
|---|---|---|---|---|
| source_id | TEXT | PK; Nullable (SQLite declaration); REF → sqlite.telemetry.id (logical; no FK) | — | Logical source telemetry identifier used by the local monitor bridge. |
| node_id | TEXT | NOT NULL; REF → public.nodes.id (logical; no FK) | — | Cloud device ID from the verified telemetry source; matched against monitor_nodes.registry_node_id during bridging, not monitor_nodes.id. |
| payload | TEXT | NOT NULL | — | Serialized request/record payload; JSONB in cloud tables and JSON text locally. |

**Keys, checks, and references**

- PRIMARY KEY PRIMARY KEY (source_id)
- LOGICAL REF source_id → sqlite.telemetry.id; no declared FK
- LOGICAL REF node_id → public.nodes.id; no declared FK

**Indexes (captured definitions)**

```sql
sqlite_autoindex_telemetry_monitor_sources_1: UNIQUE (source_id); implicit pk index
```

**SQLite table declaration**

```sql
CREATE TABLE telemetry_monitor_sources (
                source_id TEXT PRIMARY KEY, node_id TEXT NOT NULL, payload TEXT NOT NULL
            );
```

## Evidence and reproducibility

- Cloud catalog snapshots: `reports/erd-20261030/cloud-schema.json` and `cloud-constraints.json`.
- Actual SQLite schema snapshots: `reports/erd-20261030/sqlite-schema.json` and `sqlite-constraints.json`.
- Meaning/reference cross-checks: `backend/app.py`, `backend/monitoring.py`, `backend/telemetry_schema.py`, desktop `public/js/` account/control/maintenance/notification modules, mobile shared Supabase access, and `supabase/migrations/`.
- `reports/erd-20261030/build-erd-dictionary.py` rebuilds these artifacts exclusively from retained metadata. `render-erd.cjs` rasterizes the editable SVGs through an existing Electron canvas; it does not connect to the app or databases.
- Mermaid source is checked using the installed Mermaid skill static validator. The hand-authored SVG layout and rasterized PNG are independent of Mermaid host rendering; static lint does not prove renderer compatibility.
