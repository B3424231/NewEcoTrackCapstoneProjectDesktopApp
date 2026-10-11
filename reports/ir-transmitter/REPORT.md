# IR transmitter extension

Updated 2026-10-09. Added support for the user's 3-pin IR transmitter module to the copy-paste sketch, without editing firmware/.

## Implemented

- Receiver GPIO 4 and transmitter signal GPIO 5 are configurable. IR_TX_ENABLED defaults to true, with an active-low inversion option. Both pins must differ.
- Bluetooth and Supabase advertise the configured transmitter capability. Registration now uses the received capability instead of forcing a receiver-only hardware role.
- ac_intent commands validate the full climate payload and send through IRremoteESP8266 IRac. Exact supported variants such as DAIKIN64 are preserved. Existing family aliases map to their known encoders; unsupported/generic families return a failed acknowledgement.
- Power, temperature, mode and fan are included in every command. Optional swing, turbo, eco and AC sleep flags are forwarded when applicable; the desktop previously omitted its selected AC sleep flag.
- A successful library send produces a matching command_id and delivery_status=transmitted receipt. It does not create physical reported_state or measured AC power.
- The receiver is paused during transmission and briefly afterward, keeping emitted signals out of physical-remote monitoring.
- Previous logical IR state is persisted across resets and updated from decoded remote captures, supporting protocol toggle semantics. The transmitter output is held inactive during scheduled deep sleep.
- Wi-Fi provisioning, PINless encrypted Bluetooth, cloud credentials and ESP32 wake/sleep schedules remain available. No battery support or hardcoded Wi-Fi credentials were added.
- All six connected pages load shared engine version 15.

## Verification

| Check | Observed result |
| --- | --- |
| Final Heltec Wireless Stick Lite(V3) Arduino build | Passed |
| Registration integration | 16 checks passed, including transmitter capability registration |
| Local PostgreSQL migration/command integration | 30 checks passed |
| Six-page integration | 27 checks passed |
| Cloud Bluetooth/client integration | 27 checks passed |
| Cloud receipt/history synchronization | 6 checks passed |
| UI/IPC regression | 11 checks passed |
| Shared AC engine | 38 checks passed |
| Hardware control fixtures | Passed, including AC sleep flag on/off |
| Native Chromium production-component checks | 28 passed across light/dark themes |
| Changed JavaScript syntax | Passed |

The PostgreSQL tests execute the existing migration in isolated PGlite. They verify full-state delivery, capability gating, required transmission receipts, idempotent receipts, explicit failure and absence of fabricated reported AC state. No live Supabase rows were modified.

The delivered source matches the compiled sketch. SHA-256: 86300c2cda8ff3c08b5c87d6bee139f4d471702d1db7198c0b1447a175558be4. Program: 1,539,696 / 3,342,336 bytes; static RAM: 50,884 / 327,680 bytes. See arduino-build.json and heltec-build.log.

Physical hardware was not wired, flashed or IR-tested. A configured capability cannot electrically detect a connected module; a transmission receipt confirms an encoder/send attempt rather than AC execution. The existing whole-workspace git diff check also reported unrelated pre-existing whitespace issues in other files; those files were preserved.

## Handoff

Read WIRING.md, connect the 3-pin module's S/IN to GPIO 5, share ground and use its rated supply with a 3.3V-compatible signal input. Upload the whole updated reports/cloud-hardware/EcoTrackCloudReceiver.ino.txt in Arduino IDE. Restart EcoTrack, wait for its online capability heartbeat, and use a supported saved/detected protocol. No new Supabase migration is required. Point the emitter at the AC to physically test commands.

Task-start backups and source diffs are under before/ and diffs/.
