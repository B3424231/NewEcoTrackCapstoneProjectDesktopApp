# Controller registration, editing and IR monitoring

Updated 2026-10-09. Changes are implemented in this workspace. Physical ESP32 validation remains outstanding.

## Result

- Registration and editing share a location picker that restores saved ancestors, restricts floors/rooms to their parents and validates a complete building/floor/room hierarchy. Custom locations use IDs returned by Supabase; stale or rejected rooms stop registration before hardware credentials are rotated.
- Step 3 requires an explicit Save & Verify click. Password Enter cannot submit the form. Completion follows the actual cloud heartbeat, controller metadata save and AC binding; failures retain visible errors and allow retry. Pending unbound setup IDs are tracked as nonsecret, project-scoped browser drafts and hidden from Devices and Schedules. Cloud registration necessarily creates a credential/controller row before it can verify the ESP32; this is not a transaction across tables or a server-wide draft feature.
- Bluetooth stays available for a failed metadata-save retry and disconnects only after explicit completion.
- Edit saves controller metadata and its linked AC without the redundant brand-profile write that blocked unspecified-brand edits. Existing AC identity, brand and exact protocol survive registration. The editable Status field is removed; real connection indicators remain. IP/SSID remain hardware-reported.
- Remote detection before registration reads fresh, encrypted Bluetooth capture metadata. It issues no cloud registration RPC. Registered Edit detection continues through Supabase. Shared/unknown protocols require manual manufacturer selection and keep the exact protocol.
- Decoded remote setpoint, mode, fan and power feed the same shared model across six pages, the controller list and the three Schedules columns. Captures are labeled observations and do not confirm physical AC operation. Missing decoded settings remain unknown. Older observations do not replace newer saved commands.
- Aircon Control, its simulated remote, and test-transmit buttons require an actual reported IR-transmitter capability. The user's receiver-only hardware remains suitable for monitoring and ESP32 wake/sleep schedules.

## Files

Production: public/nodes.html, public/control.html, public/scheduler.html, public/js/controller-locations.js, public/js/aircon-state.js, public/js/aircon-system.js, public/js/hardware-cloud.js and public/js/scheduler.js. Shared script cache versions were refreshed on all six connected pages.

The updated copy-paste sketch is reports/cloud-hardware/EcoTrackCloudReceiver.ino.txt, version cloud-ir-receiver-1.2-monitor. The firmware directory was not edited in this task. Default IR_RX_PIN is GPIO 4 and remains configurable. Bluetooth capture metadata and decoded fields use the existing latest_ir JSON; no new schema migration is required.

## Verification

| Check | Result |
| --- | --- |
| test_registration_progress.js | 15 passing checks |
| test_page_connections.js | 27 passing checks |
| test_cloud_hardware_client.js | 27 passing checks |
| test_controller_workflow_render.js | 28 passing native Chromium component checks across light/dark themes |
| test_aircon_system.js | 38 passing checks |
| test_connection_recovery.js | 12 passing checks |
| test_device_setup_feedback.js | 11 passing checks |
| test_cloud_hardware_ui.js | 11 passing checks |
| test_hardware_control.js | Passed |
| JavaScript syntax and embedded/standalone state helper consistency | Passed |
| Arduino compile for esp32:esp32:heltec_wireless_stick_lite_V3 | Passed |

Native tests exercised production form markup and handlers using isolated fixtures, blocked networking and a separate Electron user-data directory. They tested actual HTML constraint validation, cascade selection, optional brand, detection buttons and transmitter gating. Screenshot files are diagnostic component fixtures with partial utility styling, not a full desktop visual review.

The delivered sketch's SHA-256 matches the compiled sketch: 69b347b4f0db6666693eff7c344b3a61ec096faae1be2fe9d3dc4c4dbef9e9c6. Program: 1,451,216 / 3,342,336 bytes. Static RAM: 50,708 / 327,680 bytes. Build details are in ../cloud-hardware/arduino-build.json.

No live Supabase data was modified, no account session was used by the fixtures, and no board was flashed, paired or physically IR-tested. Existing unrelated workspace edits were preserved. Task-start backups and task-specific diffs are under before/ and diffs/.

## Hardware handoff

Restart EcoTrack from this project. Upload the updated receiver sketch to enable detection before registration and decoded remote settings; older sketches have an actionable error and can still use detection through registered Edit. Set the receiver pin to the actual wiring. Then select the ESP32, reuse its verified Wi-Fi, finish the deployment details, detect optionally and click Save & Verify Controller. Press a supported AC remote toward the receiver to populate monitoring values. Detailed steps are in ../cloud-hardware/SETUP.md.
