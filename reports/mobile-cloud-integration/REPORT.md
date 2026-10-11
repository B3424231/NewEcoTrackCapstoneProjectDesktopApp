# Mobile and desktop controller integration

Status: code verified; Expo Android preview build **FINISHED successfully**. APK downloaded and verified.

## Findings and fixes

Both repositories and the Expo preview profile use the same Supabase project. The mobile app previously sent an older single-write BLE JSON format and tried local HTTP routes that are absent from the current desktop cloud sketch. Mobile inventory also used formatted IDs and metadata timestamps instead of cloud hardware identities and heartbeat times. Its wizard attempted to save a second AC profile after the atomic device save.

Mobile now sends the same UUID-indexed UTF-8 BLE chunks as desktop, reads `ip_address`, checks the stable `device_id`, and uses the deployed validate/prepare/finish/status registration functions. Already connected Wi-Fi skips the Wi-Fi form. A verified registration reuses its existing node and AC, and only an invalid/deleted credential is refreshed. The current Wi-Fi password is requested when fresh credentials must be delivered. The admin's controller name and custom AC name are separate. Existing available AC profiles can be selected. Cloud registration completes only after a matching recent heartbeat and confirmed binding. No device token is written to persistent app storage.

Controller status comes from `ecotrack_device_state`, including firmware, stable hardware identity, last seen, and announced sleep. Hardware pagination uses `node_id`, the actual primary key. Administrators see all accessible controllers by default; staff see controllers in their current server-backed admin-assigned room, without depending on phone-local ownership records.

Control and diagnostics use `ecotrack_cloud_request` and wait for a matching ESP32 acknowledgement. The client no longer marks its own command transmitted. Cloud commands can operate across different Wi-Fi networks. Exact protocol and model capabilities reuse desktop's registry. Physical remote state merges power, temperature, mode, fan and feature flags per field and timestamp. Hardware events update their affected AC directly; Postgres changes, private Broadcast and periodic heartbeat ageing refresh the UI without a manual reload. An older fetch cannot overwrite a newer receiver observation.

The dashboard uses the same hardware heartbeat and selected IR state. Profile/node selection uses canonical database IDs. AC profile names are read from saved data, and controller display names appear on control cards. Offline/unknown hardware is never presented as a verified connection.

## Verification

- `node --test scripts/test-cloud-hardware-integration.cjs scripts/test-device-integration.cjs`: **56 passed, 0 failed**. Covers BLE chunks and receipts, Unicode and credential limits, registration reuse/refresh/failed confirmation, cloud command ACK/error/timeout/access denial, partial remote OFF state and timestamps, exact multi-brand capabilities, live mapping and targeted realtime updates, legacy diagnostics and Wi-Fi discovery.
- `npm run test:database`: **34 passed, 0 failed**, using disposable PGlite databases; includes identity, auth, room access, canonical bindings, atomic node/profile mutation and AC intent contracts.
- `npm run typecheck`: passed.
- ESLint on the changed app files: **0 errors**, 31 existing warnings. Relevant React effect/ref errors were corrected.
- Android Metro/Hermes export: passed after final source changes. Web export: passed.
- Existing mobile render regressions: 3 passed, 0 failed.
- Staff visibility regression: desktop-created controllers appear only in the server-backed assigned room; reassignment refreshes visibility; removal hides the inventory.
- Broad `npm run test:backend`: **156 passed, 41 failed** out of 197. All remaining failure names reproduce against the preserved pre-change sources; no new broad-suite failure remains. These include old desktop telemetry, energy/power semantics, scheduler fixture extraction, Electron startup expectations and maintenance mock contracts. Full suite is not claimed green. Baseline had 42 distinct failures before obsolete hardware expectations were updated.
- Live Supabase read-only check: all 5 required RPCs present; 1 controller, 1 AC profile and 1 hardware-state row; canonical link and hardware identity valid. **No production writes performed.**
- EAS archive inspection: required source/config file hashes match the local source in both inspections, including the final staff room guard. Private `.env` files and local build/test folders are excluded. Existing Expo project, Android package, preview profile and remote signing credentials reused.

## Remaining limits

The existing server restricts hardware-state reads, cloud registration and hardware commands to administrators. Staff can see metadata for devices in their trusted assigned room, but the current admin-only hardware policies do not provide staff live cloud status or cloud control. These privileges were not broadened. Use an administrator account for the verified cloud hardware flow. Room-scoped metadata mutations remain governed by existing Supabase authorization. Native Bluetooth, phone installation, ESP32 flashing, real remote capture and physical AC response cannot be certified by isolated tests or a cloud compilation. Use the current desktop cloud controller sketch, not the mobile repository's older local-HTTP firmware.

The native computer-use tool could not initialize its Windows sandbox. A fallback hidden Electron browser loaded the exported mobile app at 390×844: login rendered correctly and no browser errors were observed. The startup screenshot and JSON evidence are saved beside this report. Authenticated native-device UI checks were not performed.

## Expo cloud build

Build ID: `0f630d5b-f34e-41d6-b880-78438403dcfb`
Profile: Android `preview`, internal APK, existing signing credentials frozen.
[Build and logs](https://expo.dev/accounts/rey12345/projects/ecotrackapp/builds/0f630d5b-f34e-41d6-b880-78438403dcfb)

Final build status: **FINISHED**. Completed at 2026-10-10T18:45:45.720Z.
[Download the APK](https://expo.dev/artifacts/eas/XkL1sk0fCShzUnQ9tX4wKuLKiMJSejltFuJh-38a8Kw.apk)
Android package: `com.ecotrack.app`; app version/build version: `1.0.0` / `1`.

The first submitted build `2295c73a-70c2-4368-b9bd-fe84015e18fd` was canceled and replaced before delivery to include explicit staff-room filtering. A regression covers assignment changes and assignment removal. Generated inspection artifacts are excluded from TypeScript, lint and EAS uploads.

References consulted before implementation: [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/), [Expo EAS build setup](https://docs.expo.dev/build/setup/), [Android APK builds](https://docs.expo.dev/build-reference/apk/).

## Final APK verification

[Local APK](C:/Users/reygay/Desktop/EcoTrackAppMobileNew-master-control/artifacts/EcoTrack-mobile-desktop-cloud-20261011.apk)

Size: 112437718 bytes. SHA-256: `4ff63137eecae6efb866bbc8d9cc937f2bfc3b2a921b1183a95782988d063d3a`. ZIP integrity passed; Android manifest, dex and APK signing block are present. Package `com.ecotrack.app` and Bluetooth scan/connect plus location permissions were confirmed. Embedded Hermes bundle contains the cloud registration/command RPCs, current IR capture characteristic and hardware-state mapping. Native architectures: arm64-v8a, armeabi-v7a, x86, x86_64.

No dependency versions were changed, no commit/push or production database mutation was performed. Expo upload, native compilation and APK assembly completed. Physical installation and hardware behavior remain untested.
