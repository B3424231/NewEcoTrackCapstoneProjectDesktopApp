# EcoTrack authenticated monitoring and IR control

This is the current BLE/cloud provisioning sketch from `reports/cloud-hardware/EcoTrackCloudReceiver.ino.txt`, with 20-notch GPIO40 rotation measurement and no temperature sensor. It preserves the existing IR mapping (RX4/TX5), BLE identity, private device-token validation, command acknowledgments, capture and scheduling. The old circuit's IR6/7 mapping must be reconciled with actual wiring before flashing; do not assume a successful build verifies the wiring.

The current sensor/IR pin mapping is listed below. GPIO47/48 are unused; no I2C temperature sensor is required. Apply the reviewed rotation cloud migration first. No pressure sensor is read or converted. Build using the installed ESP32-S3 huge_app partition. Physical testing and flashing are separate steps.

## Durable delivery (cloud-ir-device-1.9-outbox)

Apply `../../supabase/migrations/202610230001_measurement_outbox.sql` after the existing cloud-hardware and rotation migrations, then flash this sketch. The new upload RPC validates each device token and returns explicit reading IDs; a missing migration leaves readings queued rather than dropping them. The desktop importer still commits to SQLite before removing only confirmed cloud rows.

While awake, measurements use the AC Device Scheduler send interval. Each reading keeps its actual observation time, original device/boot/sequence ID and recorded interval. LittleFS holds up to 1,024 pending readings, subject to available flash and a 32 KiB reserve. FIFO retries resume after reconnecting and rebooting; acknowledged IDs alone are removed. A queue that fills retains unconfirmed readings, reports the problem and counts samples it could not store. It cannot retain unlimited outage history.

The board must have synchronized its clock before creating timestamped history. A cold boot without a usable clock reports that condition and waits for NTP; it does not invent observation times. Sampling pauses while the configured device sleeps. Network operations share the main loop, so the actual observation timestamp remains authoritative if a request delays a sample.

Device heartbeats expose the last reported buffer count, capacity, error and clock status in `applied_config`. A heartbeat never changes the original measurement time. Existing cloud-only telemetry remains compatible. Use the same self-contained sketch in the mobile repository's firmware directory.

Build: `arduino-cli compile --fqbn esp32:esp32:esp32s3:PartitionScheme=huge_app firmware/ecotrack_cloud_measurements`. Verify reconnect, power loss during append, queue-full behavior, sensor readings and wiring on physical hardware before deployment. Compilation alone does not verify those behaviors.

## Combined monitoring and control

This is the combined version of the supplied `cloud-ir-controller-1.8-capabilities` control sketch and the maintained sensor/outbox additions. Bluetooth provisioning, HTTPS, IR capability profiles, encoding/decoding, command handling, scheduling and reconnect/sleep routines match the supplied control code. Measurement capture and acknowledged uploads run separately from heartbeats.

| Connection | Configured pin/value |
| --- | --- |
| LM393-based optical module digital output | GPIO40 |
| Encoder wheel | 20 pulses per revolution; one falling edge per notch |
| AC remote IR receiver | GPIO4 |
| AC command IR transmitter | GPIO5 |

Use the previously supplied 3.3 V sensor circuit and common ground. The optical rotation input is separate from the AC remote IR receiver. Match the pin constants and pulses-per-revolution constant to the physical wiring/wheel before flashing. Temperature sensing, its Wire dependency and GPIO47/48 initialization have been removed. New outlet-temperature fields are explicitly null; startup RPM remains null until a measurement window completes. Zero pulses cannot distinguish a stopped wheel from a disconnected or misaligned module.

The current `ecotrack_cloud_measurements.ino` embeds its persistent queue and needs no custom header. The old `telemetry-outbox.h` is retained as a reference for the previous version. Preserve saved Wi-Fi/device credentials; neither the source nor the downloadable package embeds credentials. The cloud measurement migration must be applied before the new upload RPC can acknowledge stored readings. Hardware flashing and physical sensor verification are separate from compilation.

## Current version: battery and temperature sensing excluded (cloud-ir-device-2.2-no-temperature)

The user excluded battery-voltage measurement. This single-file sketch performs no ADC battery reads and no blue/full or red/20-percent LED control. Leave GPIO2, GPIO6 and GPIO7 disconnected; omit the raw battery tap, voltage divider, charge LEDs, ADC filter capacitor and any isolation IC. The battery holder still supplies regulated power to the device. 20-notch RPM, IR reception/transmission, Bluetooth/cloud provisioning, FIFO delivery and AC Device Scheduler behavior remain in place.

New telemetry explicitly reports battery as null. Heartbeats explicitly clear battery_voltage and battery_percent_estimate to null so stale status values are not presented as current measurements. Existing queued readings keep their original contents and are not edited or erased. No battery data or history is deleted.

No new migration is required for this removal. The authenticated outbox upload RPC remains necessary for RPM delivery; the optional battery migration is not required for newly captured null battery readings. Existing database schema and prior migrations are preserved.

Use the current connection table above and the maintained firmware source. Older report packages and wiring tables are historical and may still contain excluded temperature/battery hardware. The external three-pin switch is used only in the regulated 5V power path and must have an adequate DC load rating; no switch GPIO or raw-battery connection is needed.

## Temperature removal (30 October 2026)

MCP9808 support has been removed from the maintained cloud sketch and the local firmware in both application projects. The cloud version is `cloud-ir-device-2.2-no-temperature`. New readings keep `outlet_temperature_c: null` for schema compatibility. Existing queued readings retain their original temperature values and timestamps, and existing database history is not deleted. AC target-temperature commands still work; a target is not a measured temperature.

The temperature-based sensor-energy estimator cannot use new rotation-only readings. No target-temperature or RPM value is substituted for the missing measurement. Other control-history estimates retain their existing requirements. No schema migration is needed for this removal, but the firmware must be flashed separately before a board changes behavior.
