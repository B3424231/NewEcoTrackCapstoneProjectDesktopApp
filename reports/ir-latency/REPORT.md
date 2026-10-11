# Immediate IR updates

Implemented locally: valid decoded remote states upload immediately, independently of heartbeat reporting. The desktop applies hardware events directly to the cached controller and linked AC profile. Existing Postgres Changes remains available alongside a private administrator Broadcast channel.

## Activation

1. Run [supabase_ir_realtime_migration.sql](/C:/Users/reygay/Desktop/EcoTrackDesktopDashboardNew-main-control/supabase_ir_realtime_migration.sql) in this project's Supabase SQL Editor. The existing cloud hardware migration must already be installed.
2. Copy [EcoTrackCloudReceiver.ino.txt](/C:/Users/reygay/Desktop/EcoTrackDesktopDashboardNew-main-control/reports/cloud-hardware/EcoTrackCloudReceiver.ino.txt) into Arduino IDE and upload to the Heltec Wireless Stick Lite V3. Version: cloud-ir-controller-1.7-live. Receiver GPIO 4 and transmitter GPIO 5 remain configurable. Wi-Fi credentials remain provisioned through Bluetooth.
3. Restart the desktop app once to load the updated shared scripts. Press the physical remote while the controller is awake. After the migration is available, Serial Monitor reports "Remote state uploaded | capture-to-ack ... ms". A running legacy fallback probes migration availability again after 60 seconds when another capture arrives.

The Supabase migration has **not** been applied here: no SQL deployment connection or database-management connector is configured. The sketch has **not** been uploaded to the physical board.

## Behavior

- The compact observation RPC validates the device credential and writes only its existing latest-state row; it does not insert telemetry/history rows or create controllers.
- Heartbeat reports and command polling retain their existing cadence. Their exchanges reuse the HTTPS connection, with reconnect recovery on failures.
- Normal state uploads omit raw timings. Learning requests still return actual raw captures; optional serial diagnostics remain configurable.
- The legacy exchange sends valid observations immediately when the new RPC is unavailable. It preserves compatibility but continues carrying full capture data until the migration is installed.
- Private Broadcast emits compact state from the database, with administrator-only reception and server-only publishing on the EcoTrack hardware topic. Existing broad policies cannot grant non-admin reception or client publishing on that topic.
- Broadcast failures leave persistence and Postgres Changes available. Duplicate and reordered uploads are ignored by capture identity; repeated physical commands with new capture identities still refresh observations.
- Realtime events update the dashboard, control panel, controller list, AC list, IR views and schedule labels from shared state. Schedule updates preserve unsaved wake/sleep and interval drafts.
- Connection-only node heartbeats no longer invalidate the full data-bus cache. Recovery polling remains available, with periodic reconciliation while live events are healthy.
- Events received during a database read cannot be overwritten by that earlier read. Fresh recovery reads still detect disconnected or deleted devices.

## Verification

- 14 fast-event integration checks: six independent page engines, production dashboard and scheduler handlers, zero additional database fetches on the fast path, duplicate delivery, ordering, fresh repeated commands and preserved schedule drafts.
- 14 PostgreSQL checks in isolated PGlite: migration repeatability, credential boundaries, compact OFF persistence, retries/order, private Broadcast policies, outages, legacy captures and absent Broadcast services.
- 4 native Chromium checks: actual production card/control rendering for compact Postgres ON and Broadcast OFF, zero extra reads, no page reload and no horizontal overflow.
- Related checks passed: 39 connected-page checks, 17 receiver-capability checks, 38 shared-control checks, 40 cloud-client checks, 30 existing cloud-database checks, 11 hardware UI/IPC checks, 10 schedule-time checks, cloud receipt/history sync, telemetry cadence, hardware control and 34 mock-data integrity checks.
- Final sketch compiled for esp32:esp32:heltec_wireless_stick_lite_V3, ESP32 core 3.3.12: 1,549,000 / 3,342,336 program bytes (46%); 57,692 / 327,680 static RAM bytes (17%). The delivered sketch and compiled source have identical SHA-256 hashes.

Native event-to-DOM timings in [native-realtime-tests.json](/C:/Users/reygay/Desktop/EcoTrackDesktopDashboardNew-main-control/reports/ir-latency/native-realtime-tests.json) measure **mocked event delivery and UI processing only**. Actual remote-to-hardware-to-cloud-to-UI latency remains unmeasured until deployment and a physical test.

Evidence: [ON capture](/C:/Users/reygay/Desktop/EcoTrackDesktopDashboardNew-main-control/reports/ir-latency/received-on.png), [OFF capture](/C:/Users/reygay/Desktop/EcoTrackDesktopDashboardNew-main-control/reports/ir-latency/received-off.png), [changes.patch](/C:/Users/reygay/Desktop/EcoTrackDesktopDashboardNew-main-control/reports/ir-latency/changes.patch). The firmware directory was not edited.
