# Mobile UI cleanup and Android rebuild

Status: verification passed; Expo Android preview build **FINISHED successfully**. APK downloaded and checked.

## Requested scope

Remove the separate mobile Aircon Control screen and its menu/tab entries. Keep the Home aircon cards and their existing detail sheet. Preserve the current mobile design while fixing Device Management registration layout and interactions. Rebuild the installable Android APK through Expo.

## Findings and changes

- Aircon Control lived in `src/app/explore.tsx`. It included a separate registration/editor modal and hardware command UI. The sidebar exposed “AC Remote Controls”; native tabs also contained an Explore entry.
- The control screen is removed. The old `/explore` route now renders only an Expo Router redirect to Home, so existing links cannot reopen the removed UI. Both navigation entries and the unused `add-ac-controller-modal.tsx` component are removed.
- Home's `src/app/index.tsx`, `sensor-card.tsx`, and `sensor-detail-sheet.tsx` are byte-for-byte identical to the source archive of the previous verified APK. Home aircon cards, readings, and details remain.
- Registration's available-air-conditioner selector used unthemed pills with no selected styling. It now reuses the existing light/dark pill styles, highlights the selected item, and exposes selection state to accessibility tools.
- Tapping “Add custom air conditioner name” again previously cleared the typed name even when that option was already selected. The entered draft is now retained. Switching from an existing profile to custom naming still clears the existing profile's name.
- The registration sheet now handles keyboard resizing and scroll taps. Its header title can shrink/wrap beside Cancel on narrow screens.
- Lint found an existing synchronous state update in the sidebar open effect. The update is now deferred with cancellation when the sidebar closes, preserving its navigation behavior.
- Cloud registration, hardware identities, Supabase contracts, realtime receiver updates, and desktop source were preserved. No new dependencies or database changes were introduced.

## Verification

- Final focused run: **71 passed, 0 failed**. Includes removal-route rendering, absence of control navigation, Home card render behavior, custom-name draft retention, existing profile selection, registration/cloud hardware integration, remote state merging, room scope, and device UI interactions.
- Disposable database contract suite: **34 passed, 0 failed**.
- `npm run typecheck`: passed.
- ESLint on all four modified UI files: **0 errors**, 20 existing warnings.
- Android Metro/Hermes export: passed.
- Web export: passed.
- Isolated Electron browser startup: passed; login rendered at a CSS viewport of 378 × 762; **0 runtime errors**. Screenshot: [mobile-startup.png](mobile-startup.png).
- EAS archive: all seven checked source files matched the tested checkout; deleted control modal absent; private `.env` excluded.
- Home files matched the previous APK upload archive exactly.
- The broader backend suite was not repeated for this UI-only change. Its previous run had 41 pre-existing failures, documented in the integration report; no backend source changed here.

## Expo build

- Build ID: `9b51031b-910b-4f30-9faf-e7ee2d2a7e80`
- [Expo build](https://expo.dev/accounts/rey12345/projects/ecotrackapp/builds/9b51031b-910b-4f30-9faf-e7ee2d2a7e80)
- Profile: preview; Android APK; internal distribution; existing remote signing credentials.
- Completed: October 11, 2026, 03:28 AM (Asia/Singapore).
- [Download APK](https://expo.dev/artifacts/eas/46xjwuqypqi78mnCodKtiuUF3MBb3AhRDXUpf9IfZyA.apk)
- Local APK: `C:\Users\reygay\Desktop\EcoTrackAppMobileNew-master-control\artifacts\EcoTrack-mobile-ui-cleanup-20261011.apk`
- Size: 112,401,890 bytes.
- SHA-256: `55989f9c7dbc3a4e0a1955407cf2d834dae613c18ac424667e1b7fa7bc931bee`.
- ZIP integrity passed; package com.ecotrack.app, Android manifest and DEX present; APK signing block present; all four Android ABIs included.
- Bluetooth Scan/Connect and location permissions are present.
- The downloaded APK's Hermes bundle contains registration/cloud/receiver markers and contains none of the three checked labels from the removed Aircon Control screen.

## Limits

No connected Android phone or admin login credentials were supplied. Authenticated on-phone registration, native keyboard behavior, live Bluetooth, and ESP32 command delivery were not exercised. Browser startup and local interaction tests do not establish physical hardware success. Existing server cloud registration and hardware command permissions remain admin-only.

## Evidence

Mobile artifacts in `C:/Users/reygay/Desktop/EcoTrackAppMobileNew-master-control/artifacts/` use the `mobile-ui-cleanup-` prefix: focused test log, database log, TypeScript log, ESLint JSON, Android/web exports, inspected upload source, source hashes, and EAS status.

Before-change copies are saved in this report's before/ folder. CHANGES.diff records only this task's changes against those copies. The prior completed integration report remains at `reports/mobile-cloud-integration/REPORT.md`.
