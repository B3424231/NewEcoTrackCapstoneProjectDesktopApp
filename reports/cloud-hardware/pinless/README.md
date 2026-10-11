# Bluetooth pairing without a PIN

Use the complete updated sketch at ../EcoTrackCloudReceiver.ino.txt. In Arduino IDE, replace the old sketch with that file's contents and upload it. For the pasted sketch only, BluetoothReplacement.txt contains the exact replacement for the SecurityCallbacks class and beginBluetooth() function.

The sketch uses LE Secure Connections with bonding and no input/output capability (Just Works). Wi-Fi provisioning writes require encryption but no PIN/MITM authentication. The sketch no longer generates, prints, or requests a six-digit Bluetooth code.

Windows/EcoTrack may still show a normal Pair confirmation. If it asks for the old PIN after uploading the new sketch, remove the existing EcoTrack device from Windows Bluetooth settings and reconnect.

Wi-Fi names and passwords are still supplied through the UI and saved on the ESP32. Supabase provisioning, device tokens, IR receiving, wake/sleep schedules, GPIO selection, and saved network reconnection were preserved. No firmware-directory edit, physical upload, or live database mutation was performed.

The PIN no longer verifies the nearby pairing peer. Encryption remains, but this method does not provide MITM protection. Espressif reference: https://docs.espressif.com/projects/esp-idf/en/latest/esp32s31/api-guides/ble/smp.html

Verification:
- The actual renderer/main-process Just Works flow confirms pairing without creating a PIN input (11 UI/IPC checks passed).
- BLE Wi-Fi/cloud provisioning regression suite passed (17 checks).
- The Wi-Fi/cloud/IR/schedule section matches the user's pasted sketch exactly.
- Both builds passed on ESP32 core 3.3.12: Heltec Wireless Stick Lite(V3), 1,403,256 / 3,342,336 program bytes; ESP32S3 Dev Module with Huge APP, 1,403,232 / 3,145,728 program bytes. Each uses 50,196 bytes of static RAM. See build-results.json.
- Physical Bluetooth pairing on the user's board has not been tested.
