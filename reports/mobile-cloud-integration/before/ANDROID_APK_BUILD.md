# EcoTrack Android APK

For the latest APK, including removal of temperature from both mobile device cards and View Device, see [DEVICE_CARD_AND_DESKTOP_IR_REPORT.md](C:/Users/reygay/Desktop/EcoTrackAppMobileNew-master-control/DEVICE_CARD_AND_DESKTOP_IR_REPORT.md).

The earlier [Device Management APK](C:/Users/reygay/Desktop/EcoTrackAppMobileNew-master-control/artifacts/EcoTrack-device-ui-fixed-20261005.apk) and its [report](C:/Users/reygay/Desktop/EcoTrackAppMobileNew-master-control/DEVICE_MANAGEMENT_FIX_REPORT.md) remain available separately. The details below describe the earlier scoped-fix build.

The earlier Android preview build completed successfully on 5 October 2026 at 15:09 Singapore time. Bluetooth is retained, and that APK contains the previously completed scoped mobile fixes. The initial read-only fetching review introduced no app code changes; the later authorized fetching improvements are included in the newer APK above.

- [Local APK](C:/Users/reygay/Desktop/EcoTrackAppMobileNew-master-control/artifacts/EcoTrack-fixed-20261005.apk)
- [Download APK on your phone](https://expo.dev/artifacts/eas/rUnYjVMoA8m4VzZybXQJJcyMpFHxidi8PSulrXxPg3g.apk)
- [EAS build and logs](https://expo.dev/accounts/rey12345/projects/ecotrackapp/builds/6678c21d-b1ea-4118-ab8c-91a94ca64c92)

| Item | Result |
| --- | --- |
| Build ID | `6678c21d-b1ea-4118-ab8c-91a94ca64c92` |
| Distribution/profile | Internal / preview APK |
| Android package | `com.ecotrack.app` |
| Version / version code | `1.0.0` / `1` |
| Expo SDK / Android target SDK | `57` / `36` |
| Size | 112,382,438 bytes |
| Signing | Existing remote Android keystore; credential changes frozen |
| Native architectures | arm64-v8a, armeabi-v7a, x86, x86_64 |
| EAS artifact expiration | 19 October 2026; keep the local copy |

SHA-256:

```text
E436182342FDF46668B5A411D417F919C3B395600AAD5D9B121E3DE22D6B180A
```

## Verification

The inspected upload archive contained the fixed services and screens. Its hashes matched the app source, app.json, eas.json, package.json and package-lock.json snapshots at the time of that build. Private environment files and credential folders were excluded; the required Firebase client configuration was included.

Android Metro/Hermes export succeeded. EAS completed native compilation and APK assembly using the existing signing credentials. The downloaded APK was inspected: valid ZIP/manifest structure, expected package/version, embedded Android bundle, Android dex, APK signing block, all four native architectures, and Bluetooth scan/connect plus location permission declarations. The Bluetooth native library compiled successfully.

The source regression results and their existing limitations are recorded in [SCOPED_BUG_FIX_REPORT.md](C:/Users/reygay/Desktop/EcoTrackAppMobileNew-master-control/SCOPED_BUG_FIX_REPORT.md). Dependency versions and build configuration were not changed for this build.

## Installation and device verification

Download the APK on the Android phone and open it to install. Grant the requested Nearby devices/Bluetooth and location permissions, enable Bluetooth, and scan while the ESP32 is powered and advertising.

Wi-Fi provisioning also requires the updated [ESP32 firmware](C:/Users/reygay/Desktop/EcoTrackAppMobileNew-master-control/firmware/ecotrack_esp32_s3/ecotrack_esp32_s3.ino). The APK cannot update the ESP32 firmware by itself. The new app waits for the matching Wi-Fi connection receipt; firmware without that handler cannot complete the new provisioning flow.

No physical-phone installation, ESP32 flashing, Bluetooth discovery, real Wi-Fi connection, or AC operation was performed during this build. These need verification on the actual devices.
