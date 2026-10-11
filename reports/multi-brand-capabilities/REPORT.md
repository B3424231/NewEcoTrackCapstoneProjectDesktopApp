# EcoTrack implementation and verification report

Prepared October 10, 2026. Changes are saved in the workspace. The live Supabase database was not modified and the ESP32 was not flashed.

## Result and current deployment state

AC display names are now independent of controller display names. In registration Step 3, **Available air conditioner** offers **+ Add custom Air conditioner name**. For an already assigned controller, this renames the existing AC instead of creating another record. New AC registration asks the admin to enter its name explicitly. The Edit Controller modal has separate **Display Name** and **Air conditioner Name** inputs. Saved AC names feed the shared profile used by details, Control, Dashboard, and IR pages; controller identifiers and assignments remain stable.

The SQL contains a targeted data correction for controller `esp32s3-9cd20604a7ac`: its generated/empty AC name becomes **Matrix**, and its previously inferred TCL/unspecified manufacturer becomes **Matrix**. This is persisted user data, not a frontend or firmware default. TCL112AC remains the IR protocol. Another existing custom name or manufacturer is preserved.

The tested delivery is [APPLY_SUPABASE.sql](./APPLY_SUPABASE.sql). It still needs to be run by the project owner in the live project's SQL Editor. No suitable Supabase management connector was available; the browser control runtime also failed to initialize. No credentials were inspected, exposed or changed.

## Supabase deployment

1. Open the existing EcoTrack project in Supabase SQL Editor.
2. Temporarily unplug the ESP32 and close EcoTrack/other cloud writers. Execute the entire updated `reports/multi-brand-capabilities/APPLY_SUPABASE.sql`. Its prerequisite guard requires the existing EcoTrack schema/cloud hardware migration. Reconnect the device after success.
3. Restart the desktop app to load the updated page scripts.
4. For the existing controller, check that its assigned AC name is Matrix. Use the custom-name option or Edit Controller to choose another name.
5. Upload the updated copy-paste sketch only when ready to enable the new multi-brand decoder/transmitter behavior. This report does not claim that upload has happened.

The delivery concatenates these five sections in order:

| Section | Purpose |
| --- | --- |
| `supabase_ir_realtime_migration.sql` | Immediate observations and scoped private Broadcast, with Postgres Changes fallback. |
| `supabase_controller_registration_migration.sql` | Existing validated, repeatable registration and reconnection RPCs. |
| `supabase_controller_details_migration.sql` | Actual admin verification/deployment timestamps. |
| `supabase_aircon_names_migration.sql` | Independent AC name, atomic admin controller/AC edit, targeted Matrix data correction. |
| `supabase_ac_capabilities_migration.sql` | Capability persistence, physical verification, dynamic command validation and partial observations. |

The revised delivery uses one transaction for all five sections and acquires required table locks with NOWAIT before DDL. A busy table produces a retry message without waiting while other migration locks are held. A failure rolls back this whole run; rerunning over already committed sections of the older delivery is supported. Pause ESP32/cloud writers and close the desktop app before applying it. Existing command-retention triggers and scheduled cleanup are preserved. The delivery does not reinstall the base device-exchange RPC, reset devices, rotate credentials or delete valid pending commands. See ../migration-deadlock/REPORT.md for the lock-conflict correction and tests.

## Capability architecture

The original implementation relied on brand-family inference, a TCL-only receiver capability manifest, universal temperature limits and generic control fallback. Those assumptions lost exact protocol/model restrictions and could label unsupported functions as available.

`config/ac-capabilities.json` now holds 18 exact audited protocol definitions from the locally installed IRremoteESP8266 2.9.0 library:

TCL112AC, TEKNOPOINT, DAIKIN, DAIKIN2, DAIKIN64, DAIKIN216, GREE, MIDEA, PANASONIC_AC, SAMSUNG_AC, MITSUBISHI_AC, CARRIER_AC64, FUJITSU_AC, HAIER_AC, TOSHIBA_AC, SHARP_AC, HITACHI_AC and WHIRLPOOL_AC.

The generator embeds the same registry in the existing browser engine, PostgreSQL resolver and copy-paste ESP32 sketch. Resolution uses the observed/configured exact protocol, the decoder's remote model when available, matching model rules and explicitly saved physical results. Physical manufacturer is retained separately. Unrecognized protocols do not inherit TCL or Midea structured controls.

Temperature ranges, steps, mode restrictions and native fan mappings are protocol/model specific. Direct controls reject invalid temperatures instead of silently clamping. Presets explicitly show the actual valid setpoint. Full packets can retain a valid stored temperature in modes where temperature adjustment is unavailable. Backend commands contain a capability revision and registry version, so stale clients are rejected. Firmware validates the protocol/model and server-narrowed temperature constraints again.

Only audited decoded fields become observations. Per-field timestamps preserve known values across partial frames without presenting a retained field as freshly measured. Fujitsu short packets, Toshiba swing-only packets and toggle-power decoders receive conservative handling. TCL OFF/Turbo safeguards remain in place; native maximum fan and Turbo are separate values.

## Physical capability verification

The optional Verify AC Features dialog distinguishes **library supported but unverified**, **verified supported**, **verified unsupported**, and **unknown**.

An admin can test a real queued command, watch the physical AC, then explicitly record the result. A queued or transmitted receipt never verifies support automatically. Saved results include exact protocol/model, revision, source, confidence, admin identity and server time in the existing AC's `capability_profile` JSON document. Manufacturer, assignment and AC identity remain intact.

The verification RPC uses authorization, a row lock and expected-revision checking. It rejects unrecognized keys, credentials in the profile, unsupported encoder overrides and temperature constraints outside the audited encoder. Lower-confidence receiver metadata cannot overwrite confirmed results. Confirmation immediately updates the shared cache/events instead of waiting for a full database refetch.

## Other requested UI changes

- Removed the manual Add Message dialog and Create New Broadcast actions. Automatic rule alerts, scheduled delivery, room inbox, read state, filtering and details continue to work. No notification records were deleted.
- Controller details now show a dynamic battery percentage. With no reported reading the display is 0%, with a tooltip explaining that no battery reading was reported; a real valid percentage replaces it automatically.
- Details rows align and wrap long firmware versions, locations and AC names. Light/dark desktop and narrow layouts were checked.
- Deployment shows saved date, time and timezone. Successful Save & Verify stamps a server/admin timestamp; actual admin location changes stamp deployment time. Heartbeats and schedule updates do not rewrite verification time. Older records remain Not recorded instead of receiving an invented historical date.
- All shared-engine consumers use version 21. Schedules recognize the audited MAX fan value without confusing it with Turbo.

## Exact implementation files

Runtime/frontend files changed or added:

- `public/js/aircon-system.js`, `public/js/aircon-state.js`
- `public/js/ac-capability-registry.source.js`, `public/js/ac-capability-verification.js`
- `public/js/controller-registration.js`, `public/js/controller-details.js`
- `public/css/controller-details.css`
- `public/nodes.html`, `public/control.html`, `public/dashboard.html`
- `public/ir-library.html`, `public/ir-profiles.html`
- `public/Notification.html`, `public/js/notifications.js`
- `public/scheduler.html`, `public/js/scheduler.js`
- `public/aircons.html`, `public/logs.html`, `public/staff.html`, `public/telemetry.html` (shared-engine cache version only)

Registry, generation and database files:

- `config/ac-capabilities.json`
- `config/ac-capabilities.sql.source`
- `config/ac-capabilities.firmware.source.h`
- `config/ac-capability-engine.source.js`
- `scripts/generate_ac_capabilities.py`
- `scripts/generate_aircon_names_migration.py`
- `scripts/generate_supabase_delivery.py`
- `scripts/audit_ac_decoder_fields.py`
- `supabase_ac_capabilities_migration.sql`
- `supabase_controller_details_migration.sql`
- `supabase_aircon_names_migration.sql`

Firmware artifact: `reports/cloud-hardware/EcoTrackCloudReceiver.ino.txt`, version `cloud-ir-controller-1.8-capabilities`. The `firmware/` directory was not changed by this work.

New or updated relevant test scripts:

- `test_multi_brand_capabilities.js`, `test_multi_brand_database.js`, `test_multi_brand_control_render.js`
- `test_capability_verification_render.js`, `test_controller_details_render.js`
- `test_controller_registration_render.js`, `test_controller_workflow_render.js`
- `test_ir_capabilities_render.js`, `test_ir_realtime.js`, `test_ir_realtime_render.js`
- `test_notification_removal_render.js`
- `test_supabase_delivery_safety.js`

A scoped diff against saved task snapshots is in `implementation-review.diff`. Earlier unrelated workspace changes remain present and were excluded from this review. One-time mutation helpers are retained as text in `implementation-provenance/` rather than executable generators.

## Tests observed

Fixture tests never reported simulated success to the real application. Native UI tests used real Chromium with isolated local fixtures; database tests executed actual PostgreSQL functions in PGlite. No live Supabase or physical AC test is implied.

| Check | Observed result |
| --- | --- |
| Multi-brand resolver | 4 scenario groups passed, including all audited protocol/model variants, range/step restrictions and partial-state retention. |
| Multi-brand database / exact delivery bundle | 9 scenario groups passed: repeated migrations, fresh verification timestamps, separate names/same ID, atomic rollback, partial OFF/Turbo events, manual verification/CAS, command validation, JS/SQL parity, Matrix correction and authorization. |
| Delivery transaction safety | 5 actual PostgreSQL scenarios passed: late failure rolls back all changes, retries preserve identity/credentials, old committed prefixes are supported, and missing prerequisites stop before changes. True concurrent live contention remains untested. |
| Native dynamic Control/Dashboard | 5 scenarios passed: half/quarter-degree steps, exact model switching, Fan-mode gating, mode-specific presets, no old-profile leakage. |
| Native guided verification + PostgreSQL | 4 scenarios passed: real queue write without verification, explicit saved result, honest backend failure, atomic separate naming and rollback. |
| Native registration | 36 checks passed, including custom-name action/save/reopen and desktop/dark/mobile layouts. |
| Native controller workflow | 54 checks passed using production components and isolated fixtures. |
| Native controller details | 4 light/dark desktop/narrow scenarios passed for alignment, battery updates and actual/missing dates. |
| Native notification removal | 3 workflow groups passed; automatic delivery/inbox still work. |
| Native Turbo | 9 checks passed for independent fan/Turbo controls and received updates. |
| Native Realtime | 4 checks passed across Control, Dashboard and Schedules. Mocked event-to-DOM times were about 3.7 and 2.2 ms; these are not hardware-to-cloud latency measurements. |
| Page integration | 41 checks passed. |
| Receiver capabilities / immediate IR | 17 / 14 checks passed. |
| Cloud/Bluetooth client / registration progress | 47 / 27 checks passed. |
| Registration / realtime / cloud database | 14 / 14 / 30 checks passed. |
| Node schedule times / command retention | 10 / 10 PostgreSQL checks passed. |
| Project `npm test` | 34 checks passed, zero failures. |
| Final JS syntax review | 21 scripts/modules parsed. |
| Generator drift checks | Registry/state/SQL/firmware and deployment bundle matched. |
| Final Heltec compile | Success: 1,575,060 of 3,342,336 program bytes; 57,764 of 327,680 static RAM bytes. Source SHA matches compiled scratch copy. No upload. |

An older `scripts/test_dashboard_workflows.js` run stopped at an interval-value assertion (actual 0.25, expected 0.0083333) before reaching notification assertions. This interval conversion area was not changed by this task. It is not included among passing suites. Its failure must be reconciled separately before claiming that entire older suite is green.

Evidence: `registry-results.json`, `database-results.json`, `control-native-results.json`, `verification-native-results.json`, `arduino-build.json`, `arduino-compile.log`, plus registration/details/notification/realtime result files in their respective report directories.

## Remaining limitations and physical checks

- The live database migration and desktop runtime have not been deployed/verified in the user's running session. The updated atomic/NOWAIT delivery passed rollback/retry tests; live multi-session contention could not be tested from the available runtime.
- The new sketch compiled for `esp32:esp32:heltec_wireless_stick_lite_V3` with Arduino ESP32 core 3.3.12 and IRremoteESP8266 2.9.0. USB upload, BLE reconnection, Wi-Fi/cloud recovery and actual receiver/transmitter operation still require the device.
- Audit coverage is 18 protocols, not every codec in IRremoteESP8266. Other captured protocols remain raw-learning-only until their decoder/encoder semantics are audited.
- No physical model dataset was supplied. Prepopulated `verified_models` is empty. Current physical overrides are saved per AC through the guided verification workflow; populated cross-device model datasets require additional resolver parity validation before deployment.
- Raw learning/storage is preserved. A new raw-timing replay path was not added: the existing application has no authenticated replay command and receiver timing captures do not establish carrier frequency or physical AC compatibility. Replay needs a separate validated command/acknowledgement flow and hardware testing; it is not advertised as working.
- TCL Type2 Quiet-only packets remain excluded by the existing full-state OFF safeguard. Quiet is not fabricated from a later normal packet. Supporting this auxiliary field safely requires captured Quiet/OFF sequences and a separate validated partial-field path.
- Physical confirmation of OFF, Turbo, modes, all temperature steps, fan levels and special functions must be performed against the actual Matrix/TCL unit and additional target models. A transmitter acknowledgement proves IR transmission, not that the AC executed it.
- Real remote-to-hardware-to-Supabase-to-UI latency and network interruption behavior were not measured on the user's hardware.

The application preserves the existing received/requested/transmitted distinction and never uses a transmission receipt to claim physical AC execution.
