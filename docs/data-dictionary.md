# EcoTrack Data Dictionary

The Data Dictionary serves as a reference for the fields used in the EcoTrack system. It lists each database table and its fields, along with their data types, constraints, and descriptions. Following the sample capstone format, this section explains how each table contributes to the system's data structure and helps maintain consistency during development, testing, and maintenance.

Based on the schema inspected on 30 October 2026, this dictionary contains **42 application tables and 457 fields**: 26 shared Supabase tables with 339 fields, and 16 desktop SQLite tables with 118 fields. Administrators use the desktop app; staff use the mobile app. Mobile does not connect directly to desktop SQLite.

**Notation:** PK = primary key; FK = declared foreign key; UK = unique constraint; NN = NOT NULL; NULL = nullable; REF = application reference without a declared foreign key. Composite keys apply to the listed combination. Partial/expression unique indexes apply only under their defined expressions and conditions. CHECK names identify database validation constraints. `timestamptz` means timestamp with time zone, and `double` means double precision.

SQLite TEXT primary keys retain the nullable behavior of their captured declarations; INTEGER primary keys are non-null row identifiers. The managed Supabase Auth schema is external to these 42 application tables.

Historical temperature and battery columns remain in the database. They do not imply that the maintained cloud firmware still measures those values.

**1. public.administrators**

| Field | Type | Constraints | Description |
|---|---|---|---|
| id | text | PK; NN | Primary identifier of the record. |
| username | text | UK; NN | Administrator sign-in/display username. |
| email | text | UK; NN; Partial/expression UK: admin_normalized_email_unique | Account email address. |
| password | text | NULL | Legacy application credential column. |
| role | text | NN | Application/profile role label. |
| is_active | boolean | NN | Whether the account is enabled. |
| last_login | timestamptz | NULL | Timestamp of the most recently recorded login. |
| created | timestamptz | NN | Record creation timestamp. |
| updated | timestamptz | NN | Record update timestamp. |
| avatar | text | NULL | Profile avatar reference retained for compatibility. |
| photo_url | text | NULL | Photo URL/reference. |
| phone | text | NULL | Account phone number in its supplied display format. |
| auth_user_id | uuid | UK; NULL; FK → auth.users.id | Associated Supabase Auth user identifier. |
| is_archived | boolean | NN | Whether the profile is archived. |
| auth_valid_after | timestamptz | NN | Session-validity cutoff used to invalidate older authentication sessions. |
| phone_digits | text | NULL | Normalized phone digits used for account identity/contact matching. |
| location | text | NULL | Human-readable location text or snapshot. |
| session_timeout | integer | NULL | Configured administrator session timeout value used by account/session handling. |

**2. public.staff**

| Field | Type | Constraints | Description |
|---|---|---|---|
| id | text | PK; NN | Primary identifier of the record. |
| name | text | NN | Human-readable display name. |
| email | text | NULL; Partial/expression UK: staff_normalized_email_unique | Account email address. |
| phone | text | NULL; Partial/expression UK: staff_normalized_phone_unique | Account phone number in its supplied display format. |
| status | text | NN | Workflow, record, or device status label. |
| last_active | timestamptz | NULL | Most recently recorded staff activity timestamp. |
| created | timestamptz | NN | Record creation timestamp. |
| updated | timestamptz | NN | Record update timestamp. |
| avatar | text | NULL | Profile avatar reference retained for compatibility. |
| photo_url | text | NULL | Photo URL/reference. |
| avatar_url | text | NULL | Profile avatar URL/reference retained for compatibility. |
| role | text | NULL | Application/profile role label. |
| building_name | text | NULL | Building-name snapshot stored with the event/measurement/profile. |
| floor_name | text | NULL | Floor-name snapshot stored with the event/measurement/profile. |
| room_name | text | NULL | Room-name snapshot stored with the event/measurement/profile. |
| assignment | text | NULL | Human-readable staff location assignment text. |
| room_id | text | NULL; REF → public.rooms.id (logical; no FK) | Logical assigned public.rooms.id. |
| is_archived | boolean | NULL | Whether the profile is archived. |
| archive_reason | text | NULL | Reason for archiving the staff profile. |
| archive_notes | text | NULL | Additional staff archive notes. |
| archived_at | timestamptz | NULL | Timestamp when a profile/notification state was archived. |
| is_online | boolean | NULL | Recorded account presence flag. |
| is_active | boolean | NULL | Whether the account is enabled. |
| online_status | text | NULL | Staff account presence/status label. |
| password | text | NULL | Legacy application credential column. |
| auth_user_id | uuid | UK; NULL; FK → auth.users.id | Associated Supabase Auth user identifier. |
| force_logout | boolean | NN | Whether the staff session must be invalidated. |
| auth_valid_after | timestamptz | NN | Session-validity cutoff used to invalidate older authentication sessions. |
| phone_digits | text | NULL | Normalized phone digits used for account identity/contact matching. |
| assignment_scope | text | NN; CHECK: staff_assignment_scope_check | Staff assignment level: room, floor, building, or all. |
| assigned_floor_id | text | NULL; FK → floors.id | Assigned floor for floor-scope staff access. |
| assigned_building_id | text | NULL; FK → buildings.id | Assigned building for building-scope staff access. |

**3. public.buildings**

| Field | Type | Constraints | Description |
|---|---|---|---|
| id | text | PK; NN | Primary identifier of the record. |
| name | text | NN | Human-readable display name. |
| admin_id | text | NULL; FK → administrators.id | Associated desktop administrator profile identifier. |
| created | timestamptz | NN | Record creation timestamp. |
| updated | timestamptz | NN | Record update timestamp. |

**4. public.floors**

| Field | Type | Constraints | Description |
|---|---|---|---|
| id | text | PK; NN | Primary identifier of the record. |
| name | text | NN | Human-readable display name. |
| building_id | text | NULL; FK → buildings.id | Associated building identifier. |
| created | timestamptz | NN | Record creation timestamp. |
| updated | timestamptz | NN | Record update timestamp. |

**5. public.rooms**

| Field | Type | Constraints | Description |
|---|---|---|---|
| id | text | PK; NN | Primary identifier of the record. |
| name | text | NN | Human-readable display name. |
| node_limit | integer | NN | Configured maximum number of nodes for the room. |
| floor_id | text | NULL; FK → floors.id | Associated floor identifier. |
| admin_id | text | NULL; FK → administrators.id | Associated desktop administrator profile identifier. |
| created | timestamptz | NN | Record creation timestamp. |
| updated | timestamptz | NN | Record update timestamp. |

**6. public.nodes**

| Field | Type | Constraints | Description |
|---|---|---|---|
| id | text | PK; NN | Primary identifier of the record. |
| name | text | UK; NN; Partial/expression UK: ecotrack_hardware_identity_idx | Human-readable display name. |
| status | text | NN | Workflow, record, or device status label. |
| temp | numeric | NULL | Historical temperature value. |
| rssi | numeric | NULL | Received signal strength. |
| battery | numeric | NULL | Historical battery value. |
| wake_time | text | NULL | Configured daily wake time in application time-of-day text format. |
| sleep_time | text | NULL | Configured daily sleep time in application time-of-day text format. |
| interval_val | integer | NULL | Configured reporting-interval magnitude, interpreted with interval_unit. |
| interval_unit | text | NULL | Unit of the configured reporting interval. |
| room_id | text | NULL; FK → rooms.id | Room identifier associated with the record. |
| aircon_type | text | NULL | Air-conditioner type/category label or historical snapshot. |
| install_date | text | NULL | Recorded installation date. |
| created | timestamptz | NN | Record creation timestamp. |
| updated | timestamptz | NN | Record update timestamp. |
| photo_url | text | NULL | Photo URL/reference. |
| aircon_id | text | UK; NULL; FK → aircons.id | Optional unique FK to public.aircons.id. |
| maintainer_id | text | NULL; FK → staff.id | Assigned mobile staff maintainer profile identifier. |
| mac_address | text | NULL | Reported hardware network MAC address. |
| ip_address | text | NULL | Reported/local device IP address. |
| wifi_ssid | text | NULL | Wi-Fi network name reported for the device. |
| ble_uuid | text | NULL | Bluetooth Low Energy service/device identifier. |
| protocol_name | text | NULL | Named IR protocol associated with the equipment/device. |
| brand | text | NULL | Air-conditioner manufacturer/brand label. |
| admin_verified_at | timestamptz | NULL | Timestamp of administrator deployment verification. |
| admin_verified_by | uuid | NULL; REF → auth.users.id (logical; no FK) | Authenticated verifying administrator user ID. |
| deployment_saved_at | timestamptz | NULL | Time deployment/setup information was saved. |
| device_mode | text | NN; CHECK: nodes_device_mode_check; Partial/expression UK: ecotrack_one_monitor_device_per_ac | Device role: monitoring, controller, or both. |
| monitor_aircon_id | text | NULL; FK → aircons.id; Partial/expression UK: ecotrack_one_monitor_device_per_ac | Air conditioner observed by the device monitoring role. |
| monitoring_id | uuid | UK; NULL | Unique optional monitoring registry UUID. |
| sensor_config | jsonb | NULL | Monitoring/configuration settings as JSON. |
| rotation_rpm | double | NULL; CHECK: nodes_rotation_rpm_check | Measured rotation speed in revolutions per minute. |
| last_measurement_at | timestamptz | NULL | Timestamp of the latest accepted measurement. |
| last_measurement_report_id | text | NULL | Identifier of the last measurement report. |
| rotation_quality | text | NULL | Rotation measurement quality label. |

**7. public.aircons**

| Field | Type | Constraints | Description |
|---|---|---|---|
| id | text | PK; NN | Primary identifier of the record. |
| asset_tag | text | UK; NN | Unique inventory/asset tag for the air conditioner. |
| brand | text | NN | Air-conditioner manufacturer/brand label. |
| model | text | NN | Air-conditioner model label. |
| cooling_capacity_hp | numeric | NULL | Rated cooling capacity recorded in horsepower. |
| aircon_type | text | NN | Air-conditioner type/category label or historical snapshot. |
| room_id | text | NULL; FK → rooms.id | Room identifier associated with the record. |
| node_id | text | UK; NULL; FK → nodes.id | Optional unique FK to public.nodes.id. |
| status | text | NN | Workflow, record, or device status label. |
| protocol | text | NULL | IR protocol identifier. |
| install_date | date | NULL | Recorded installation date. |
| created_at | timestamptz | NN | Record creation timestamp. |
| updated_at | timestamptz | NN | Record update timestamp. |
| protocol_name | text | NULL | Named IR protocol associated with the equipment/device. |
| controller_node_id | text | NULL; FK → nodes.id | Controller-role node associated with this air conditioner. |
| desired_state | jsonb | NULL | Requested climate-control state as JSON. A request does not prove that the physical AC is on. |
| command_id | uuid | NULL | Identifier for the current/most recent equipment control command. |
| command_status | text | NULL | Status of the associated control command. |
| command_status_at | timestamptz | NULL | Timestamp of the recorded command status. |
| commanded_at | timestamptz | NULL | Timestamp when a control request was issued. |
| reported_state | jsonb | NULL | Device-reported control-state JSON. |
| reported_at | timestamptz | NULL | Timestamp associated with the reported state. |
| name | text | NULL | Human-readable display name. |
| capability_profile | jsonb | NN | Supported equipment/IR control capabilities as JSON. |

**8. public.ecotrack_device_state**

| Field | Type | Constraints | Description |
|---|---|---|---|
| node_id | text | PK; NN; FK → nodes.id | Associated device/monitoring node identifier. |
| device_id | text | UK; NN | Stable hardware device identity. |
| last_seen | timestamptz | NULL | Most recently recorded device contact timestamp. |
| sleeping_until | timestamptz | NULL | Expected end of the device sleep interval. |
| firmware_version | text | NULL | Reported device firmware version. |
| wifi_ssid | text | NULL | Wi-Fi network name reported for the device. |
| ip_address | text | NULL | Reported/local device IP address. |
| rssi | integer | NULL | Received signal strength. |
| capabilities | jsonb | NN | Reported hardware/device capabilities as JSON. |
| latest_ir | jsonb | NULL | Latest observed IR frame and decoded metadata as JSON. |
| applied_config | jsonb | NULL | Last device-applied configuration JSON. |

**9. public.ecotrack_device_commands**

| Field | Type | Constraints | Description |
|---|---|---|---|
| id | uuid | PK; NN | Primary identifier of the record. |
| node_id | text | NN; FK → nodes.id | Associated device/monitoring node identifier. |
| kind | text | NN; CHECK: ecotrack_device_commands_kind_check | Hardware command kind. |
| payload | jsonb | NN | Serialized request/record payload. |
| status | text | NN; CHECK: ecotrack_device_commands_status_check | Workflow, record, or device status label. |
| created_by | uuid | NN; REF → auth.users.id (logical; no FK) | Authenticated user ID that created the command/code. |
| created_at | timestamptz | NN | Record creation timestamp. |
| expires_at | timestamptz | NN | Expiry timestamp after which the record/command/token is no longer valid. |
| claimed_at | timestamptz | NULL | Timestamp when a device/worker claimed the command. |
| acknowledged_at | timestamptz | NULL | Timestamp of the device acknowledgment. |
| result | jsonb | NULL | Stored operation/command result JSON. |
| finished_at | timestamptz | NULL | Timestamp when command processing finished. |

**10. public.ecotrack_ir_codes**

| Field | Type | Constraints | Description |
|---|---|---|---|
| id | uuid | PK; NN | Primary identifier of the record. |
| aircon_id | text | UK (aircon_id, command_type); NN; FK → aircons.id | Associated air-conditioner identifier. |
| command_type | text | UK (aircon_id, command_type); NN; CHECK: ecotrack_ir_codes_command_type_check | Captured IR command label, such as a supported climate command. |
| protocol | text | NN; CHECK: ecotrack_ir_codes_protocol_check | IR protocol identifier. |
| raw_data | text | NN; CHECK: ecotrack_ir_codes_raw_data_check | Stored captured IR data representation. |
| capture | jsonb | NN | Full IR-capture metadata JSON. |
| source_platform | text | NN; CHECK: ecotrack_ir_codes_source_platform_check | Application platform that captured/saved the IR code. |
| created_by | uuid | NN; REF → auth.users.id (logical; no FK) | Authenticated user ID that created the command/code. |
| updated_by | uuid | NN; REF → auth.users.id (logical; no FK) | Authenticated user ID that last updated the IR code. |
| created_at | timestamptz | NN | Record creation timestamp. |
| updated_at | timestamptz | NN | Record update timestamp. |

**11. public.controller_installations**

| Field | Type | Constraints | Description |
|---|---|---|---|
| id | uuid | PK; NN | Primary identifier of the record. |
| node_id | text | UK (node_id, attempt_id); NN; REF → public.nodes.id (logical; no FK) | Installed cloud node ID snapshot. |
| device_id | text | NN | Stable hardware device identity. |
| attempt_id | text | UK (node_id, attempt_id); NN | Installation/setup attempt identifier used for duplicate protection. |
| request_setup | jsonb | NN | Original accepted installation/setup request JSON. |
| installer_auth_user_id | uuid | NN; REF → auth.users.id (logical; no FK) | Authenticated installer user ID captured in the event. |
| installer_profile_id | text | NULL | Application installer profile ID snapshot. |
| installer_name | text | NULL | Installer display-name snapshot. |
| installer_account_role | text | NN | Installer account category captured when the event occurred. |
| installer_role | text | NULL | Installer staff/job role snapshot. |
| controller_name | text | NN | Controller display-name snapshot. |
| room_id | text | NN; REF → public.rooms.id (logical; no FK) | Room ID snapshot at installation time. |
| room_name | text | NN | Room-name snapshot stored with the event/measurement/profile. |
| floor_id | text | NN; REF → public.floors.id (logical; no FK) | Floor ID snapshot at installation time. |
| floor_name | text | NN | Floor-name snapshot stored with the event/measurement/profile. |
| building_id | text | NN; REF → public.buildings.id (logical; no FK) | Building ID snapshot at installation time. |
| building_name | text | NN | Building-name snapshot stored with the event/measurement/profile. |
| aircon_id | text | NN; REF → public.aircons.id (logical; no FK) | Air-conditioner asset ID snapshot. |
| aircon_name | text | NULL | Air-conditioner display-name snapshot. |
| aircon_type | text | NULL | Air-conditioner type/category label or historical snapshot. |
| installed_at | timestamptz | NN | Installation/reinstallation event timestamp. |
| event_kind | text | NN; CHECK: controller_installations_event_kind_check | Installation event category. |

**12. public.telemetry**

| Field | Type | Constraints | Description |
|---|---|---|---|
| id | text | PK; NN | Primary identifier of the record. |
| node_id | text | NULL; REF → public.nodes.id (logical; no FK) | Logical cloud device identifier (public.nodes.id). |
| sensor_name | text | NULL | Device/sensor display-name snapshot. |
| room_name | text | NULL | Room-name snapshot stored with the event/measurement/profile. |
| floor_name | text | NULL | Floor-name snapshot stored with the event/measurement/profile. |
| building_name | text | NULL | Building-name snapshot stored with the event/measurement/profile. |
| aircon_type | text | NULL | Air-conditioner type/category label or historical snapshot. |
| temperature | numeric | NULL | Historical recorded temperature in degrees Celsius. |
| battery | numeric | NULL | Historical battery value. |
| rssi | integer | NULL | Received signal strength. |
| status | text | NULL | Workflow, record, or device status label. |
| created | timestamptz | NULL | Record creation timestamp. |
| interval_seconds | numeric | NULL | Reporting/measurement interval in seconds. |
| ac_on | boolean | NULL | Explicit recorded AC power-state evidence. |
| aircon_id | text | NULL; REF → public.aircons.id (logical; no FK) | Logical cloud asset identifier (public.aircons.id). |
| control_snapshot | jsonb | NULL | Captured climate-control/remote context as JSONB in cloud or JSON text locally. |
| rotation_rpm | double | NULL; CHECK: telemetry_rotation_rpm_check | Measured rotation speed in revolutions per minute. |
| rotation_quality | text | NULL; CHECK: telemetry_rotation_quality_check | Rotation measurement quality label. |
| observed_at | timestamptz | NULL | Device observation timestamp, distinct from ingestion/receipt time. |
| boot_id | text | NULL | Device boot/session identifier used with sequence for duplicate detection. |
| sequence | bigint | NULL | Monotonic sequence within a device boot/session. |

**13. public.rules**

| Field | Type | Constraints | Description |
|---|---|---|---|
| id | text | PK; NN | Primary identifier of the record. |
| type | text | NN | Record category: rule, maintenance request, or notification according to the table. |
| condition | text | NN | Rule comparison/operator or condition label. |
| value | numeric | NN | Configured numeric rule threshold. |
| unit | text | NN | Unit associated with the rule threshold. |
| enabled | boolean | NN | Whether the alert rule is enabled. |
| message | text | NULL | Notification/rule message text. |
| duration | integer | NULL | Configured rule duration/persistence value interpreted by rule evaluation. |
| start_date | text | NULL | Start-date text for the rule window. |
| start_time | text | NULL | Start-time text for the rule window. |
| end_date | text | NULL | End-date text for the rule window. |
| end_time | text | NULL | End-time text for the rule window. |
| room_id | text | NULL; FK → rooms.id | Room identifier associated with the record. |
| building_id | text | NULL; FK → buildings.id | Associated building identifier. |
| floor_id | text | NULL; FK → floors.id | Associated floor identifier. |
| admin_id | text | NULL; FK → administrators.id | Associated desktop administrator profile identifier. |
| created | timestamptz | NN | Record creation timestamp. |
| updated | timestamptz | NN | Record update timestamp. |

**14. public.rule_nodes**

| Field | Type | Constraints | Description |
|---|---|---|---|
| id | text | PK; NN | Primary identifier of the record. |
| rule_id | text | UK (rule_id, node_id); NN; FK → rules.id | Associated alert rule identifier. |
| node_id | text | UK (rule_id, node_id); NN; FK → nodes.id | Associated device/monitoring node identifier. |
| created | timestamptz | NN | Record creation timestamp. |
| updated | timestamptz | NN | Record update timestamp. |

**15. public.notifications**

| Field | Type | Constraints | Description |
|---|---|---|---|
| id | text | PK; NN | Primary identifier of the record. |
| date | text | NN | Desktop notification date text. |
| time | text | NN | Desktop notification time text. |
| content | text | NN | Desktop notification body text. |
| triggered | boolean | NN | Whether the notification was triggered. |
| room_id | text | NULL; FK → rooms.id | Room identifier associated with the record. |
| rule_id | text | NULL; FK → rules.id | Associated alert rule identifier. |
| admin_id | text | NULL; FK → administrators.id | Associated desktop administrator profile identifier. |
| created | timestamptz | NN | Record creation timestamp. |
| updated | timestamptz | NN | Record update timestamp. |
| is_dismissed_from_inbox | boolean | NN | Whether the desktop inbox event is dismissed. |
| node_id | text | NULL; REF → public.nodes.id (logical; no FK) | Associated device/monitoring node identifier. |
| report_id | text | NULL; REF → public.maintenance_reports.id (logical; no FK) | Logical associated maintenance report ID. |
| type | text | NN | Record category: rule, maintenance request, or notification according to the table. |
| event_key | text | NULL; Partial/expression UK: notifications_event_key_unique | Event deduplication key. |
| installation_id | uuid | NULL; REF → public.controller_installations.id (logical; no FK); Partial/expression UK: controller_installation_notification_unique | Logical installation event ID. |
| installation | jsonb | NULL | Saved installation-event context as JSON. |

**16. public.maintenance_reports**

| Field | Type | Constraints | Description |
|---|---|---|---|
| id | text | PK; NN | Primary identifier of the record. |
| aircon_id | text | NULL; FK → nodes.id | Despite its name, the actual database FK targets public.nodes.id, not public.aircons.id. |
| aircon_name | text | NULL | Air-conditioner display-name snapshot. |
| room_id | text | NULL; FK → rooms.id | Room identifier associated with the record. |
| room_name | text | NULL | Room-name snapshot stored with the event/measurement/profile. |
| type | text | NN | Record category: rule, maintenance request, or notification according to the table. |
| priority | text | NN | Maintenance/notification priority label. |
| staff_id | text | NULL; FK → staff.id | Assigned/recipient mobile staff profile identifier. |
| staff_name | text | NN | Staff display-name snapshot. |
| due_date | text | NULL | Due-date text retained in the application format. |
| created_date | text | NULL | Creation-date text retained separately from the database timestamp. |
| status | text | NN | Workflow, record, or device status label. |
| description | text | NULL | Maintenance work description. |
| tasks | jsonb | NULL | Maintenance task/checklist JSON. |
| issue | jsonb | NULL | Reported maintenance issue JSON. |
| verification_remarks | text | NULL | Administrator/staff maintenance verification remarks. |
| timeline | jsonb | NULL | Maintenance workflow/history entries as JSON. |
| admin_id | text | NULL; FK → administrators.id | Associated desktop administrator profile identifier. |
| created | timestamptz | NN | Record creation timestamp. |
| updated | timestamptz | NN | Record update timestamp. |
| photo_url | text | NULL | Photo URL/reference. |
| attachment_url | text | NULL | Maintenance attachment URL/reference retained for compatibility. |
| photos | jsonb | NULL | Maintenance photo references/metadata as JSON. |
| aircon_type | text | NULL | Air-conditioner type/category label or historical snapshot. |
| parent_report_id | text | NULL; REF → public.maintenance_reports.id (logical; no FK) | Logical parent maintenance report identifier. |
| linked_repair_id | text | NULL; REF → public.maintenance_reports.id (logical; no FK) | Logical related repair report identifier. |

**17. public.mobile_notifications**

| Field | Type | Constraints | Description |
|---|---|---|---|
| id | text | PK; NN | Primary identifier of the record. |
| staff_id | text | NULL; FK → staff.id | Assigned/recipient mobile staff profile identifier. |
| staff_name | text | NULL | Staff display-name snapshot. |
| title | text | NN | Mobile notification title. |
| message | text | NN | Notification/rule message text. |
| type | text | NN | Record category: rule, maintenance request, or notification according to the table. |
| priority | text | NN | Maintenance/notification priority label. |
| category | text | NN | Notification category label. |
| related_report_id | text | NULL; REF → public.maintenance_reports.id (logical; no FK) | Logical related maintenance report identifier. |
| aircon_id | text | NULL | Equipment/device identifier snapshot carried by the notification payload. |
| aircon_name | text | NULL | Air-conditioner display-name snapshot. |
| location | text | NULL | Human-readable location text or snapshot. |
| due_date | text | NULL | Due-date text retained in the application format. |
| is_read | boolean | NULL | Legacy shared read flag. |
| is_snoozed | boolean | NULL | Legacy shared snooze flag. |
| snooze_until | timestamptz | NULL | Timestamp through which the notification is snoozed. |
| created_at | timestamptz | NN | Record creation timestamp. |
| updated_at | timestamptz | NULL | Record update timestamp. |
| aircon_type | text | NULL | Air-conditioner type/category label or historical snapshot. |
| verification_remarks | text | NULL | Administrator/staff maintenance verification remarks. |
| event_key | text | NN; Index UK: mobile_notifications_event_key_unique | Event deduplication key. |
| event_payload | jsonb | NULL | Structured notification event context as JSON. |
| is_broadcast | boolean | NN | Whether the mobile notification is a broadcast event. |

**18. public.mobile_notification_state**

| Field | Type | Constraints | Description |
|---|---|---|---|
| notification_id | text | PK (notification_id, recipient_auth_user_id); NN; FK → mobile_notifications.id | Related mobile notification identifier. |
| recipient_auth_user_id | uuid | PK (notification_id, recipient_auth_user_id); NN; FK → auth.users.id | Authenticated user whose per-notification state is stored. |
| read_at | timestamptz | NULL | Time the recipient marked/opened the notification as read. |
| snooze_until | timestamptz | NULL | Timestamp through which the notification is snoozed. |
| archived_at | timestamptz | NULL | Timestamp when a profile/notification state was archived. |
| updated_at | timestamptz | NN | Record update timestamp. |

**19. public.staff_push_tokens**

| Field | Type | Constraints | Description |
|---|---|---|---|
| token | text | PK; NN | Primary mobile push token value. |
| auth_user_id | uuid | NN; FK → auth.users.id | Associated Supabase Auth user identifier. |
| staff_id | text | NN; FK → staff.id | Assigned/recipient mobile staff profile identifier. |
| platform | text | NN; CHECK: staff_push_tokens_platform_check | Mobile operating platform associated with the push token. |
| critical_enabled | boolean | NN | Whether critical push notifications are enabled for this token. |
| maintenance_enabled | boolean | NN | Whether maintenance push notifications are enabled for this token. |
| updated_at | timestamptz | NN | Record update timestamp. |

**20. public.ecotrack_push_deliveries**

| Field | Type | Constraints | Description |
|---|---|---|---|
| id | uuid | PK; NN | Primary identifier of the record. |
| notification_id | text | UK (notification_id, token); NN; FK → mobile_notifications.id | Related mobile notification identifier. |
| token | text | UK (notification_id, token); NN; FK → staff_push_tokens.token | Recipient push token, with an enforced FK to staff_push_tokens.token. |
| status | text | NN; CHECK: ecotrack_push_deliveries_status_check | Workflow, record, or device status label. |
| attempts | integer | NN | Number of attempts in the current authentication/delivery cycle. |
| next_attempt_at | timestamptz | NN | Earliest time for the next push delivery attempt. |
| lease_until | timestamptz | NULL | Worker lease expiry for the current delivery attempt. |
| ticket_id | text | NULL | Push-provider ticket/reference for delivery receipt processing. |
| last_error | text | NULL | Most recently recorded push delivery error. |

**21. public.ecotrack_maintenance_operations**

| Field | Type | Constraints | Description |
|---|---|---|---|
| actor_id | uuid | PK (actor_id, operation_id); NN; FK → auth.users.id | Supabase Auth identity that performed the maintenance operation. |
| operation_id | text | PK (actor_id, operation_id); NN; CHECK: ecotrack_maintenance_operations_operation_id_check | Client-supplied idempotency identifier, unique together with the actor. |
| request | jsonb | NN | Original maintenance operation request JSON. |
| result | jsonb | NN | Stored operation/command result JSON. |
| created_at | timestamptz | NN | Record creation timestamp. |

**22. public.ecotrack_auth_attempts**

| Field | Type | Constraints | Description |
|---|---|---|---|
| key | text | PK; NN | Authentication-attempt bucket key. |
| started_at | timestamptz | NN | Start of the current time/evidence window. |
| attempts | integer | NN | Number of attempts in the current authentication/delivery cycle. |

**23. public.ecotrack_push_wake_tokens**

| Field | Type | Constraints | Description |
|---|---|---|---|
| nonce | uuid | PK; NN | Unique wake-up token/nonce. |
| expires_at | timestamptz | NN | Expiry timestamp after which the record/command/token is no longer valid. |

**24. ecotrack_private.device_credentials**

| Field | Type | Constraints | Description |
|---|---|---|---|
| device_id | text | PK; NN; CHECK: device_credentials_device_id_check | Stable hardware device identity. |
| node_id | text | UK; NN; FK → nodes.id | Associated device/monitoring node identifier. |
| token_hash | bytea | NN | Credential/token digest. |
| issued_at | timestamptz | NN | Timestamp when the device credential was issued. |

**25. ecotrack_private.measurement_delivery_cursor**

| Field | Type | Constraints | Description |
|---|---|---|---|
| device_id | text | PK; NN; FK → private.device_credentials.device_id | Stable hardware device identity. |
| token_hash | bytea | NN | Credential/token digest. |
| boot | bigint | NN | Last accepted numeric boot counter for measurement delivery. |
| sequence | bigint | NN | Monotonic sequence within a device boot/session. |

**26. ecotrack_private.rule_evidence**

| Field | Type | Constraints | Description |
|---|---|---|---|
| rule_id | text | PK (rule_id, node_id); NN; FK → rules.id | Associated alert rule identifier. |
| node_id | text | PK (rule_id, node_id); NN; FK → nodes.id | Associated device/monitoring node identifier. |
| signature | jsonb | NN | Rule configuration/evidence signature JSON used to reset stale evaluation state. |
| observed_at | timestamptz | NN | Timestamp of the latest observation evaluated for this rule/node pair. |
| started_at | timestamptz | NULL | Start of the current contiguous matching-evidence interval. |
| interval_seconds | numeric | NULL | Measurement cadence retained while evaluating continuous rule evidence. |
| last_alert_at | timestamptz | NULL | Timestamp when the most recent alert for this rule/node pair was emitted. |

**27. sqlite.monitor_nodes**

| Field | Type | Constraints | Description |
|---|---|---|---|
| id | TEXT | PK; NULL (SQLite declaration) | Primary identifier of the record. |
| name | TEXT | NN | Human-readable display name. |
| aircon_id | TEXT | NN; REF → public.aircons.id (logical; no FK); Partial/expression UK: monitor_one_active_per_ac | Logical public.aircons.id. |
| aircon_name | TEXT | NN | Air-conditioner display-name snapshot. |
| location | TEXT | NN | Human-readable location text or snapshot. |
| state_source | TEXT | NN | Source of AC power-state evidence. |
| expected_interval_seconds | REAL | NN | Expected reporting cadence in seconds. |
| active | INTEGER | NN; Partial/expression UK: monitor_one_active_per_ac | Integer boolean indicating an active monitoring registration. |
| token_hash | TEXT | NN | Credential/token digest. |
| created_at | TEXT | NN | Record creation timestamp. |
| updated_at | TEXT | NN | Record update timestamp. |
| aircon_type | TEXT | NULL (SQLite declaration) | Air-conditioner type/category label or historical snapshot. |
| registry_node_id | TEXT | NULL (SQLite declaration); REF → public.nodes.id (logical; no FK) | Logical public.nodes ID connecting the local monitoring registry to the cloud device registry. |
| registry_retired | INTEGER | NN | Integer boolean indicating that the corresponding cloud registration is retired. |

**28. sqlite.monitor_calibrations**

| Field | Type | Constraints | Description |
|---|---|---|---|
| id | TEXT | PK; NULL (SQLite declaration) | Primary identifier of the record. |
| node_id | TEXT | NN; FK → sqlite.monitor_nodes.id | Associated device/monitoring node identifier. |
| valid_from | TEXT | NN | Timestamp from which this calibration applies. |
| temperature_offset_c | REAL | NN | Stored historical temperature calibration offset in degrees Celsius. |
| notes | TEXT | NN | Calibration notes. |
| field_calibrated | INTEGER | NN | Integer boolean indicating field calibration. |
| created_at | TEXT | NN | Record creation timestamp. |

**29. sqlite.monitor_samples**

| Field | Type | Constraints | Description |
|---|---|---|---|
| id | TEXT | PK; NULL (SQLite declaration) | Primary identifier of the record. |
| node_id | TEXT | UK (node_id, boot_id, sequence); NN; FK → sqlite.monitor_nodes.id | Associated device/monitoring node identifier. |
| aircon_id | TEXT | NN; REF → public.aircons.id (logical; no FK) | Cloud air-conditioner ID snapshot. |
| aircon_name | TEXT | NN | Air-conditioner display-name snapshot. |
| observed_at | TEXT | NULL (SQLite declaration) | Device observation timestamp, distinct from ingestion/receipt time. |
| received_at | TEXT | NN | Local timestamp when the measurement was received. |
| boot_id | TEXT | UK (node_id, boot_id, sequence); NN | Device boot/session identifier used with sequence for duplicate detection. |
| sequence | INTEGER | UK (node_id, boot_id, sequence); NN | Monotonic sequence within a device boot/session. |
| uptime_ms | INTEGER | NULL (SQLite declaration) | Device uptime in milliseconds when the measurement was taken. |
| interval_seconds | REAL | NN | Reporting/measurement interval in seconds. |
| clock_quality | TEXT | NN | Quality/source of the device observation timestamp. |
| raw_temperature_c | REAL | NULL (SQLite declaration) | Historical uncalibrated temperature in degrees Celsius. |
| outlet_temperature_c | REAL | NULL (SQLite declaration) | Historical calibrated outlet temperature in degrees Celsius. |
| ac_on | INTEGER | NULL (SQLite declaration) | Explicit recorded AC power-state evidence. |
| state_source | TEXT | NULL (SQLite declaration) | Source of AC power-state evidence. |
| temperature_quality | TEXT | NN | Quality/availability label retained for historical temperature records. |
| calibration_id | TEXT | NN; FK → sqlite.monitor_calibrations.id | Calibration record associated with this measurement. |
| payload_hash | TEXT | NN | Digest of the accepted measurement payload for duplicate/conflict checks. |
| sensor_name | TEXT | NULL (SQLite declaration) | Device/sensor display-name snapshot. |
| location | TEXT | NULL (SQLite declaration) | Human-readable location text or snapshot. |
| aircon_type | TEXT | NULL (SQLite declaration) | Air-conditioner type/category label or historical snapshot. |
| battery_voltage | REAL | NULL (SQLite declaration) | Historical battery voltage. |
| rssi_dbm | REAL | NULL (SQLite declaration) | Reported wireless received signal strength in dBm. |
| connection_status | TEXT | NULL (SQLite declaration) | Recorded device connectivity status. |
| operating_mode | TEXT | NULL (SQLite declaration) | Recorded operating-mode label. |
| rotation_rpm | REAL | NULL (SQLite declaration) | Measured rotation speed in revolutions per minute. |
| rotation_quality | TEXT | NN | Rotation measurement quality label. |
| control_snapshot | TEXT | NULL (SQLite declaration) | Captured climate-control/remote context as JSONB in cloud or JSON text locally. |

**30. sqlite.sensor_schedules**

| Field | Type | Constraints | Description |
|---|---|---|---|
| node_id | TEXT | PK; NULL (SQLite declaration); FK → sqlite.monitor_nodes.id | Associated device/monitoring node identifier. |
| wake_time | TEXT | NN | Configured daily wake time in application time-of-day text format. |
| sleep_time | TEXT | NN | Configured daily sleep time in application time-of-day text format. |
| interval_seconds | INTEGER | NN | Reporting/measurement interval in seconds. |
| updated_at | TEXT | NN | Record update timestamp. |

**31. sqlite.telemetry**

| Field | Type | Constraints | Description |
|---|---|---|---|
| id | TEXT | PK; NULL (SQLite declaration) | Primary identifier of the record. |
| node_id | TEXT | NULL (SQLite declaration); REF → public.nodes.id (logical; no FK) | Logical cloud device identifier (public.nodes.id). |
| sensor_name | TEXT | NULL (SQLite declaration) | Device/sensor display-name snapshot. |
| room_name | TEXT | NULL (SQLite declaration) | Room-name snapshot stored with the event/measurement/profile. |
| floor_name | TEXT | NULL (SQLite declaration) | Floor-name snapshot stored with the event/measurement/profile. |
| building_name | TEXT | NULL (SQLite declaration) | Building-name snapshot stored with the event/measurement/profile. |
| aircon_type | TEXT | NULL (SQLite declaration) | Air-conditioner type/category label or historical snapshot. |
| temperature | REAL | NULL (SQLite declaration) | Historical recorded temperature in degrees Celsius. |
| battery | REAL | NULL (SQLite declaration) | Historical battery value. |
| rssi | REAL | NULL (SQLite declaration) | Received signal strength. |
| status | TEXT | NULL (SQLite declaration) | Workflow, record, or device status label. |
| created | TEXT | NULL (SQLite declaration) | Record creation timestamp. |
| updated | TEXT | NULL (SQLite declaration) | Record update timestamp. |
| event_type | TEXT | NULL (SQLite declaration) | Local telemetry/control event category. |
| interval_seconds | INTEGER | NULL (SQLite declaration) | Reporting/measurement interval in seconds. |
| wake_time | TEXT | NULL (SQLite declaration) | Configured daily wake time in application time-of-day text format. |
| sleep_time | TEXT | NULL (SQLite declaration) | Configured daily sleep time in application time-of-day text format. |
| ac_on | INTEGER | NULL (SQLite declaration) | Explicit recorded AC power-state evidence. |
| aircon_id | TEXT | NULL (SQLite declaration); REF → public.aircons.id (logical; no FK) | Logical cloud asset identifier (public.aircons.id). |
| control_snapshot | TEXT | NULL (SQLite declaration) | Captured climate-control/remote context as JSONB in cloud or JSON text locally. |
| ac_state | TEXT | NULL (SQLite declaration) | Legacy serialized AC control-state representation. |
| rotation_rpm | REAL | NULL (SQLite declaration) | Measured rotation speed in revolutions per minute. |
| rotation_quality | TEXT | NULL (SQLite declaration) | Rotation measurement quality label. |
| observed_at | TEXT | NULL (SQLite declaration) | Device observation timestamp, distinct from ingestion/receipt time. |
| boot_id | TEXT | NULL (SQLite declaration) | Device boot/session identifier used with sequence for duplicate detection. |
| sequence | INTEGER | NULL (SQLite declaration) | Monotonic sequence within a device boot/session. |

**32. sqlite.telemetry_cloud_receipts**

| Field | Type | Constraints | Description |
|---|---|---|---|
| id | TEXT | PK; NULL (SQLite declaration); REF → sqlite.telemetry.id (logical; no FK) | Source telemetry record ID. |
| payload | TEXT | NN | Serialized request/record payload. |
| cleaned_at | TEXT | NULL (SQLite declaration) | Timestamp when the retained cloud receipt was cleaned/processed. |

**33. sqlite.telemetry_monitor_sources**

| Field | Type | Constraints | Description |
|---|---|---|---|
| source_id | TEXT | PK; NULL (SQLite declaration); REF → sqlite.telemetry.id (logical; no FK) | Logical source telemetry identifier used by the local monitor bridge. |
| node_id | TEXT | NN; REF → public.nodes.id (logical; no FK) | Cloud device ID from the verified telemetry source. |
| payload | TEXT | NN | Serialized request/record payload. |

**34. sqlite.cloud_sync_state**

| Field | Type | Constraints | Description |
|---|---|---|---|
| source | TEXT | PK; NULL (SQLite declaration) | Synchronization source identifier. |
| cursor_created | TEXT | NN | Timestamp portion of the durable cloud-import cursor. |
| cursor_id | TEXT | NN | Record-ID tie-breaker of the durable cloud-import cursor. |

**35. sqlite.schedule_dispatches**

| Field | Type | Constraints | Description |
|---|---|---|---|
| id | TEXT | PK; NULL (SQLite declaration) | Primary identifier of the record. |
| node_id | TEXT | NULL (SQLite declaration) | Cloud/local device identifier used for forwarding. |
| ip | TEXT | NULL (SQLite declaration) | Device IP address used for schedule forwarding. |
| interval_seconds | INTEGER | NULL (SQLite declaration) | Reporting/measurement interval in seconds. |
| status | TEXT | NULL (SQLite declaration) | Workflow, record, or device status label. |
| error | TEXT | NULL (SQLite declaration) | Most recently recorded operation error text. |
| created | TEXT | NULL (SQLite declaration) | Record creation timestamp. |
| updated | TEXT | NULL (SQLite declaration) | Record update timestamp. |

**36. sqlite.monitor_sync_outbox**

| Field | Type | Constraints | Description |
|---|---|---|---|
| id | INTEGER | PK; NN | Autoincrementing local outbox sequence identifier. |
| table_name | TEXT | NN | Logical target table/category for an outbox record. |
| object_id | TEXT | NN | Logical object identifier in the outbox payload. |
| payload | TEXT | NN | Serialized request/record payload. |

**37. sqlite.monitor_sync_status**

| Field | Type | Constraints | Description |
|---|---|---|---|
| id | INTEGER | PK; NN; CHECK (id = 1) | Singleton row key constrained to 1. |
| last_success | TEXT | NULL (SQLite declaration) | Timestamp of the last successful synchronization/backup. |
| error | TEXT | NULL (SQLite declaration) | Most recently recorded operation error text. |

**38. sqlite.monitor_revision**

| Field | Type | Constraints | Description |
|---|---|---|---|
| id | INTEGER | PK; NN; CHECK (id = 1) | Singleton row key constrained to 1. |
| generation | TEXT | NN | Generation token invalidating prior monitoring revisions. |
| version | INTEGER | NN | Monotonic local change revision. |

**39. sqlite.monitor_changed_nodes**

| Field | Type | Constraints | Description |
|---|---|---|---|
| node_id | TEXT | PK; NULL (SQLite declaration); REF → sqlite.monitor_nodes.id (logical; no FK) | Changed local monitoring-node ID. |
| version | INTEGER | NN | Monotonic local change revision. |

**40. sqlite.telemetry_backup_state**

| Field | Type | Constraints | Description |
|---|---|---|---|
| id | INTEGER | PK; NN; CHECK (id = 1) | Singleton row key constrained to 1. |
| last_success | TEXT | NULL (SQLite declaration) | Timestamp of the last successful synchronization/backup. |
| completed_epoch | REAL | NULL (SQLite declaration) | Epoch timestamp for the completed backup. |
| filename | TEXT | NULL (SQLite declaration) | Backup output filename/path metadata. |
| error | TEXT | NULL (SQLite declaration) | Most recently recorded operation error text. |

**41. sqlite.telemetry_history_generation**

| Field | Type | Constraints | Description |
|---|---|---|---|
| id | INTEGER | PK; NN; CHECK (id = 1) | Singleton row key constrained to 1. |
| token | TEXT | NN | Random generation token invalidating prior telemetry-history snapshots. |

**42. sqlite.telemetry_local_reset**

| Field | Type | Constraints | Description |
|---|---|---|---|
| id | INTEGER | PK; NN; CHECK (id = 1) | Singleton row key constrained to 1. |
| deleted_through | TEXT | NN | Time watermark through which locally deleted history must remain excluded. |
