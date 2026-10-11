# Step 3 Bluetooth recovery

The wizard retained its previously read controller ID and Wi-Fi IP after the Bluetooth GATT session disconnected. Save then called readInfo against that disconnected session, and the common failure path described it as "Supabase: Setup incomplete".

## Changes

- Step 3 has an explicit Reconnect ESP32 action. It opens the normal Bluetooth picker and verifies that the live device matches the selected controller.
- Live disconnect events and Bluetooth failures display "Bluetooth: Reconnect required". The existing-network panel describes its SSID/IP as previously confirmed until a new live check succeeds.
- Reconnection preserves controller name, deployment location, manufacturer and current-network password. A different SSID discards the old password. Reconnect never saves automatically.
- Save attempts to reconnect the exact previously authorized device and verifies its identity and current Wi-Fi before location writes or cloud credential rotation. Registration checks the expected identity again.
- Missing Bluetooth IR capture characteristics display firmware/pairing instructions and the reported firmware version instead of a raw UUID error.
- Duplicate reconnect/save/detection actions are guarded. Closed-wizard reconnect replies cannot repopulate the form.
- The shared hardware transport cache version is 6 on the six primary connected pages.

## Verification observed

| Check | Result |
| --- | --- |
| scripts/test_cloud_hardware_client.js | 32 checks passed |
| scripts/test_registration_progress.js | 22 checks passed |
| scripts/test_connection_recovery.js | 12 checks passed |
| scripts/test_controller_workflow_render.js | 42 checks passed across light/dark |
| scripts/test_cloud_hardware_ui.js | 11 checks passed |
| scripts/test_page_connections.js | 27 checks passed |
| scripts/test_device_setup_feedback.js | 11 checks passed |
| JavaScript syntax and task-added whitespace | Passed |

The native renderer uses production form markup and helpers with mocked Bluetooth and HTTP(S) requests blocked. The page's existing Tailwind CDN dependency was cached for accurate isolated styling. Screenshots: registration-light.png and registration-dark.png. Functional fixture evidence: native-ui-tests.json.

No ESP32 was flashed, no pairing was removed, and no live Supabase registration or data deletion was performed. Physical Bluetooth communication and the board's currently installed sketch remain unverified.

## Use

Fully close and reopen EcoTrack from this project. In Step 3 select Reconnect ESP32, choose EcoTrack-esp32s3-9cd20604a7ac, and keep the board awake and nearby. If the live Wi-Fi check succeeds, the existing setup remains at Step 3. Select Save & Verify Controller explicitly to complete registration. The latest sketch must have uploaded successfully before its new Bluetooth IR capture feature can be used.

## Files

Production changes are public/nodes.html and public/js/hardware-cloud.js; the five other primary pages only update the hardware transport script version. Three existing regression scripts were extended. Task-specific before snapshots and diffs are under this directory.
