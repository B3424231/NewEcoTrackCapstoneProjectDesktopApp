# Existing ESP32 Wi-Fi and Supabase registration recovery

Wi-Fi connectivity and Supabase authentication are checked separately. Deleting the controller's cloud registration invalidates the ESP32's previously saved device credential while its Wi-Fi connection can remain active.

The registration wizard now attempts to resume a previously authorized Bluetooth device, reads its live identity and network status, and goes directly to Controller Info when Bluetooth and Wi-Fi are verified. If there is no usable previous Bluetooth authorization, the user chooses the ESP32 once. A cached database row or IP cannot bypass discovery. Multiple authorized devices require explicit selection.

Test Connection first reads the selected ESP32's actual status. It reuses a confirmed connection to the selected Wi-Fi network without writing Wi-Fi settings. An unconfigured device or a different selected network still goes through provisioning and waits for the device reply. Read Device IP can also recognize a completed Wi-Fi connection and advance the wizard.

Diagnostics start as pending. Checking, connected, and error text reflects the actual operation. Successful checks show Wi-Fi Connected; failed checks show Retry Connection and an actionable error. Closing setup, changing controllers, or changing network settings invalidates stale confirmations and replies.

The current receiver sketch requires the Wi-Fi password when receiving a fresh cloud credential. For skipped Wi-Fi setup, this password is collected on Controller Info rather than reopening steps 1 and 2. Hidden Wi-Fi fields no longer block native browser validation. Save & Verify Controller refreshes Supabase registration, sends the new device credential over Bluetooth, and waits for cloud acknowledgement and an online heartbeat before reporting success. The password is excluded from the registration RPC and browser persistence.

Bluetooth reads and writes are serialized to prevent overlapping GATT operations. Raw GATT errors include reconnect guidance. Registration validates credentials before calling the RPC that rotates the cloud credential.

Changed application files:
- public/nodes.html
- public/js/hardware-cloud.js
- public/styles.css

Observed verification:
- Connection recovery wizard: 12 checks passed.
- Registration progress: 18 checks passed, including the skipped-setup save path.
- Cloud hardware client: 24 checks passed, including fresh credential delivery, heartbeat verification, serialized reads, invalid credentials before RPC, and authorized-device resumption.
- Existing device/profile feedback: 11 checks passed.
- Hardware UI/IPC: 11 checks passed.
- Six-page integration: 23 checks passed.
- Hardware control regression passed.
- Native Chromium form validation passed in both themes. Only the visible recovery password is invalid before entry; the form validates after entry without hidden-field errors.
- Bluetooth picker rendering and interaction passed in four desktop/narrow light/dark views.
- Changed standalone JavaScript and nodes.html inline scripts passed syntax checks.

These checks use isolated production components and in-memory device/database fixtures. No real ESP32 pairing, live Supabase writes, or hardware commands were performed. The existing receiver sketch and firmware directory were not changed; receiver sketch SHA-256 remains 8e50dc7e7e7e5049bb4e7e03f693ec1d92e728b4c85702e0583b7002461768c1.

To recover the physical device: reload EcoTrack, open Register, allow it to resume the device or select the nearby ESP32 once, enter the current Wi-Fi password on Controller Info, and click Save & Verify Controller. The old serial authentication errors will stop only after fresh provisioning succeeds. No Arduino reupload is needed for these UI changes.
