# Numeric Bluetooth error-code fix

The reported error was introduced by the Bluetooth recovery handler. It called error.code.startsWith even when error.code was a number. A native NetworkError DOMException reproduced the exact TypeError, masking the original Bluetooth failure.

## Correction

public/js/hardware-cloud.js now checks typeof error.code === 'string' before testing the BLE_ prefix. Numeric browser codes, zero, absent codes and unrelated numeric errors no longer cause a secondary exception. Existing application BLE codes keep their identity. Recognized Bluetooth failures retain the existing reconnect guidance.

The hardware-cloud script version is 7 on the six primary connected pages so they load the corrected handler.

## Observed verification

- Before the correction, the added DOMException regression failed with the exact reported startsWith TypeError.
- scripts/test_cloud_hardware_client.js: 37 checks passed, including numeric failures in connection, device-info reads, provisioning writes and IR capture reads.
- scripts/test_registration_progress.js: 22 checks passed.
- scripts/test_connection_recovery.js: 12 checks passed.
- scripts/test_cloud_hardware_ui.js: 11 checks passed.
- scripts/test_page_connections.js: 27 checks passed.
- scripts/test_controller_workflow_render.js: 46 checks passed across light and dark, including real Chromium DOMException numeric codes and the production Step 3 error status.
- JavaScript syntax checks passed.

The renderer fixture uses production code, mocked Bluetooth, and blocked HTTP(S). Its first new test run had an invalid async wrapper; this was corrected before the observed successful run. native-ui-tests.json is the current successful evidence. No real board connection, pairing changes, firmware upload or live Supabase writes were performed.

Windows "Paired" confirms pairing, while the app separately requires a live GATT session. The correction exposes the actionable Bluetooth failure; it does not establish that the physical device is connected.

Fully close and reopen EcoTrack, then select Reconnect ESP32 in Step 3.
