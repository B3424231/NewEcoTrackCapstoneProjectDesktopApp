# ESP32-S3 hardware pipeline

Install ArduinoJson 7.x and IRremoteESP8266 2.9.0 or later. Select **ESP32S3 Dev Module** and **Huge APP (3MB No OTA/1MB SPIFFS)** on a board with at least 4MB flash. The complete IR encoder/receiver exceeds the default 1.25MB application partition.

The checked build uses Arduino ESP32 3.3.11:

```powershell
arduino-cli compile --fqbn esp32:esp32:esp32s3:PartitionScheme=huge_app firmware/esp32s3_ecotrack_node
```

Before uploading, set the node name and location constants in the sketch. Provision Wi-Fi through the existing BLE workflow; those saved NVS settings take priority. If fallback networks are needed, copy `wifi-secrets.example.h` to `wifi-secrets.h` and enter their credentials there. This private header is ignored by Git; keep passwords out of the sketch and commits. Without the private header, fallback credentials are empty. Register the exact node name in Supabase `nodes.name`; assign one aircon to its database `nodes.id`. Apply `supabase_hardware_pipeline_migration.sql` in the project database.

The dashboard writes full climate commands to `aircons.desired_state` and attempts immediate LAN delivery. Firmware polls that same state every 15 seconds, backing off to five minutes after network failures. Select the real protocol supported by the AC model. Captured variants such as `DAIKIN2` are preserved. An unsupported protocol returns an error instead of sending a fabricated default frame. A successful IR transmission does not confirm the AC received it or turned on.

`GET /ir/latest-learned` exposes the most recent actual capture since boot; `/sniff-protocol` waits up to six seconds for a new capture. IR Studio displays the captured timings. `/ir/test` accepts real `raw_data` timings for replay.

The controller publishes its LAN IP at startup and every minute. Telemetry includes measured battery voltage, RSSI and the active data interval. Temperature sensing was removed on 30 October 2026: this sketch does not initialize I2C or use GPIO47/48, and new temperature fields remain null. AC target-temperature commands remain supported. Physical AC power remains unconfirmed unless measured independently; no command state is written into `ac_on`.

Wake/sleep clocks and data intervals survive reboot in NVS. The sketch uses UTC+8 (Asia/Singapore); change `NODE_TIMEZONE_OFFSET_SECONDS` if the installation uses another timezone. It requires a synchronized clock before entering deep sleep. Overnight schedules are supported, and equal wake/sleep clocks mean continuous operation. Outside the operating window it sleeps until the next wake boundary or a 15-minute schedule recheck, whichever comes first. LAN/BLE commands cannot reach a sleeping node; a cloud schedule change is picked up at its next recheck. The operating window stays responsive with Wi-Fi modem power saving.

Start the Flask backend normally (`venv\Scripts\python.exe backend/app.py`). It imports cloud telemetry into SQLite automatically every 15 seconds, with a durable cursor and duplicate protection. `/api/telemetry/sync` reports sync status. Unknown sensor readings and AC state remain null. Battery measurement uses calibrated millivolts; verify the divider ratio and battery-board topology against the actual hardware. Board regulators and LEDs also affect standby consumption.


## Passive rotation measurements (updated 30 October 2026)

The maintained sketch uses the previously supplied circuit: optical digital output through its 1 kohm series resistor to GPIO40, common ground, and 3.3 V module supply/pull-up. Count one falling edge per notch; the printed disc has **20 notches**. RPM = pulses x 60,000,000 / (20 x elapsed microseconds), with a minimum one-second observation window. Startup remains null. Zero means no edges observed, and cannot distinguish a stopped wheel from a disconnected/misaligned optical module. Verify the module and opaque teeth physically. Rotation is not air pressure, calibrated airspeed, AC power feedback or confirmed compressor runtime.

MCP9808 support, its I2C driver and outlet-temperature reads have been removed from both the local and maintained cloud sketches. Leave GPIO47/48 unconnected for this configuration. Existing temperature history is retained, but new readings contain no measured temperature. No generated readings are sent.

Cloud telemetry includes nullable `rotation_rpm`, `rotation_quality`, and an explicit `observed_at` only after clock synchronization. Apply the reviewed `20261020190000_rotation_monitoring.sql` migration before using these fields; no migration or flashing is performed automatically. The existing authenticated local registry maps actual cloud records into Monitoring/Both by the exact node ID. Legacy records without explicit observation time are not backfilled. Sensor-energy estimates requiring measured outlet temperature are unavailable for new rotation-only readings. A commanded setpoint is not a measured temperature. Prefer `../ecotrack_cloud_measurements` for the shared desktop/mobile cloud system; its current wiring and transport limitations are documented in its README.
