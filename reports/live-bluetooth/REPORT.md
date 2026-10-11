# Live Bluetooth recovery and metadata

The user confirmed that pressing Reconnect ESP32 brought back the warning after successful remote detection. The previous reconnect action called connect(), which deliberately disconnected the existing GATT session before opening the device chooser.

Other UI issues were verified in the source: every GATT failure was labelled disconnected even if gatt.connected was true; successful device-info reads did not clear stale Bluetooth errors; the firmware field always displayed the editable placeholder v2.4.2-WiFi.

## Corrections

- Reconnect now uses the selected authorized device and reads the existing link first. It does not disconnect a healthy connection or open the chooser.
- If a connected device-info read fails, discovery is retried once on the existing link. No provisioning writes are replayed.
- Choose ESP32 again is a separate explicit action, available when Bluetooth needs attention.
- Errors retain the original native message, operation, code and cause. A connected request failure and an actual disconnect use different UI states.
- Successful device-info reads publish a live event. Step 3 clears stale Bluetooth warnings after a fresh reply while preserving genuine cloud failures and keeping Supabase unverified until registration acknowledgement.
- Firmware and hardware role fields are read-only reports from the device. They no longer display a fixed firmware placeholder.
- Form details and current-network credentials are preserved; a changed SSID still requires its own password.
- Primary pages load hardware-cloud.js version 8.

## Observed checks

Cloud hardware client: 40 checks passed.
Registration progress: 27 checks passed.
Connection recovery wizard: 12 checks passed.
Six-page integration: 27 checks passed.
Device setup feedback: 11 checks passed.
Native Chromium production-component fixtures: 54 checks passed across light and dark.
JavaScript syntax and task-added whitespace checks passed.

Screenshots and renderer evidence are in this directory. Test fixtures mock Bluetooth and block HTTP(S). No board upload, Windows pairing removal or live Supabase registration was performed. Physical recovery remains unverified.

Fully close and reopen EcoTrack, then use Reconnect ESP32. If discovery still fails, the warning includes the actual failed operation and native error for further diagnosis. Choose ESP32 again is available as an explicit fallback.
