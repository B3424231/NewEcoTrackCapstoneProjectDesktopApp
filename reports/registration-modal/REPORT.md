# Register AC Controller Device improvements

Implemented locally on 2026-10-10 using the project's web-app-builder, ui-spec-enforcer, debug-and-rebuild, api-database-tester and browser-qa-tester skills.

## Deploy before using the new registration flow

Run [supabase_controller_registration_migration.sql](/C:/Users/reygay/Desktop/EcoTrackDesktopDashboardNew-main-control/supabase_controller_registration_migration.sql) in the project's Supabase SQL Editor, then restart the desktop app.

The migration uses existing tables and columns. Its prerequisites are the existing cloud hardware, device/node synchronization and AC protocol migrations. It checks prerequisites and runs in a transaction; it can be run again safely. It adds four administrator-only RPCs for registration lookup, assignment validation, credential recovery and atomic final save.

**Live deployment is not performed:** no SQL deployment connection or Supabase management connector is configured. Database checks below used isolated PostgreSQL, and browser/hardware responses used explicit fixtures. A physical Bluetooth/ESP32 registration has not been tested here. No firmware was changed or uploaded.

## Changed production files

| File | Change |
| --- | --- |
| [nodes.html](/C:/Users/reygay/Desktop/EcoTrackDesktopDashboardNew-main-control/public/nodes.html) | Compact wizard, sticky actions, truthful connection feedback, explicit AC assignment, conditional credential entry, restoration and save workflow. Preserves a saved custom type in the existing Edit selector. |
| [controller-registration.js](/C:/Users/reygay/Desktop/EcoTrackDesktopDashboardNew-main-control/public/js/controller-registration.js) | Required assignment/name/type validation, custom type, accessible password toggle and searchable, alphabetical, deduplicated manufacturer choices. |
| [controller-registration.css](/C:/Users/reygay/Desktop/EcoTrackDesktopDashboardNew-main-control/public/css/controller-registration.css) | Scoped light/dark/mobile modal styling, compact connection card, field errors, responsive stepper and visible footer. |
| [hardware-cloud.js](/C:/Users/reygay/Desktop/EcoTrackDesktopDashboardNew-main-control/public/js/hardware-cloud.js) | Read-only registration checks; credential refresh only when required; metadata-safe provisioning option; picker cancellation preserves the previous device; bounded registration API requests. |
| [aircon-system.js](/C:/Users/reygay/Desktop/EcoTrackDesktopDashboardNew-main-control/public/js/aircon-system.js) | Opt-in atomic registration RPC and confirmed shared controller/AC cache updates. Existing callers retain their save path. |
| [registration migration](/C:/Users/reygay/Desktop/EcoTrackDesktopDashboardNew-main-control/supabase_controller_registration_migration.sql) | Backend field/assignment validation, identity recovery, metadata preservation, authorization and atomic final controller/AC association. |

No unrelated page was redesigned. Existing location services, Bluetooth UUIDs, secure provisioning format, IR capture/learning and hardware capability reporting remain in use.

## Corrected workflow

- Opening the modal attempts to resume one previously authorized ESP32. Steps 1 and 2 are skipped only after its actual Bluetooth reply confirms identity and connected Wi-Fi. Stored IP/configuration alone cannot prove connectivity.
- Reconnect checks the selected hardware and rediscoveries characteristic handles when needed. It does not issue credentials or send Wi-Fi settings. Draft inputs remain available; changing the selected SSID discards the old network password.
- Registration lookup loads the existing controller and AC, including recovery when only its private credential has been deleted.
- A verified live registration is reused without a Wi-Fi password or token rotation. Missing/erased credentials, an identity mismatch or an actual authentication failure require credential recovery. Transient network errors and stale/sleeping heartbeats remain verification-pending.
- The recovery password is hidden by default and can be shown accessibly without clearing it. It stays in form memory and the existing Bluetooth provisioning exchange; it is not sent to the database or written to browser storage. Closing or completing registration clears it.
- Existing AC and New AC are explicit choices. New profiles need an AC profile name; custom types need a trimmed value. Existing compatible assignments remain eligible. Manufacturer remains optional, as in the original flow; previous saved values are supported.
- Save validates eligibility before issuing a credential or resolving new locations. The final RPC locks and checks the controller/AC relationship, requires a current cloud heartbeat, and saves controller metadata and AC association in one transaction.
- Retries reuse the same identity and profile. Failed final saves leave previous controller/AC metadata intact and retain the form. A credential exchange may already have completed before a final save fails; retry checks the real registration and reuses those credentials.
- Custom deployment locations use the existing confirmed hierarchy service. Successfully created hierarchy rows remain available for a retry if a later operation fails.
- Registration success requires the actual final RPC result. Shared caches/events expose the same AC identity, type and exact IR protocol to Control, Schedules, Dashboard and IR pages.

## Observed verification

| Check | Result |
| --- | --- |
| New native full-page registration tests | 32 checks passed: assignment validation, custom type, flexible names, brand search/keyboard/deduplication, password visibility, reconnect success/failure, backend failure, duplicate submits, credential reuse/recovery, reopening, offline device and viewport/action bounds. |
| New isolated PostgreSQL registration tests | 14 check groups passed: repeatability, required fields, offline rejection, atomic binding, retry identity, custom type persistence, read-only lookup, metadata-safe recovery, conflicts, rollback and admin/anonymous boundaries. |
| Cloud/Bluetooth client | 47 checks passed, including migration errors, unchanged credentials on reconnect/cancel, recovery and request timeout. |
| Existing registration progress | 27 checks passed, including remote detection, exact protocol, failed saves, edit/location recovery and late/disconnected Bluetooth replies. |
| Six-page integration | 41 checks passed, including atomic registration linkage/custom type across six engines and failed-save preservation. |
| Focused connection recovery | 12 checks passed. |
| Existing native controller workflow | 54 component checks passed across light and dark themes. |
| Focused native form validation | 2 themes passed. |
| Shared AC control | 38 checks passed. |
| Immediate IR events | 14 checks passed. |
| Hardware UI/IPC | 11 checks passed. |
| Node schedules | 10 checks passed. |
| Project npm test | 34 source-integrity checks passed. |
| Production syntax / obsolete copy / encoding | Passed. |

These are local fixture and database integration checks; they do not establish live Bluetooth compatibility, production deployment success or physical hardware latency.

Evidence: [native results](/C:/Users/reygay/Desktop/EcoTrackDesktopDashboardNew-main-control/reports/registration-modal/native-results.json), [database results](/C:/Users/reygay/Desktop/EcoTrackDesktopDashboardNew-main-control/reports/registration-modal/database-results.json), [desktop preview](/C:/Users/reygay/Desktop/EcoTrackDesktopDashboardNew-main-control/reports/registration-modal/registration-light.png), [dark preview](/C:/Users/reygay/Desktop/EcoTrackDesktopDashboardNew-main-control/reports/registration-modal/registration-dark.png), [mobile preview](/C:/Users/reygay/Desktop/EcoTrackDesktopDashboardNew-main-control/reports/registration-modal/registration-mobile.png).

Task-local source backups are in reports/registration-modal/before. [changes.patch](/C:/Users/reygay/Desktop/EcoTrackDesktopDashboardNew-main-control/reports/registration-modal/changes.patch) compares this task's production changes with those backups; the new migration/module/style are represented as new files. Existing unrelated workspace changes were preserved.
