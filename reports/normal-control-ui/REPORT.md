# Normal control UI cleanup

Date: October 10, 2026 (Asia/Singapore).

## Authorized scope

The user asked to remove the protocol/model physical-verification summary, Verify AC Features button and transmitter-enabled banner, then simplify unknown/requested/transmitted feedback into ordinary control UI. The user explicitly chose to remove verification UI everywhere and keep Command & IR Audit Trail with Command & IR Dispatch and result details.

Skills applied: prompt-enhancer before edits, ui-spec-enforcer, web-app-builder and debug-and-rebuild. The clarified prompt and execution decision were presented before implementation. No additional dependencies or data-model changes were introduced.

## Changes

- Removed the frontend verification component, script imports, mount calls and control annotations from Control, Dashboard, controller details and IR pages.
- Added displaySettings() to the shared state helper. It presents selected power, temperature, mode and fan plainly while leaving the received/requested/reported sources, timestamps, confirmation flags and command status unchanged.
- Normal Control and Dashboard use ON/OFF labels. Missing readings use an em dash. Schedule summaries no longer append REMOTE, REQUESTED or (remote).
- Temperature ranges still come from the dynamic protocol/model registry; the library/verification prose is removed.
- Successful control requests display Settings saved after the service accepts/persists the settings. Updating settings appears while waiting. Real errors remain visible, and a failed setting is not applied.
- The transmitter-enabled banner is removed. Receiver-only and unsupported controls remain disabled with ordinary availability guidance.
- Dashboard command totals remain available with simpler captions.
- Updated the shared engine asset version to 22 and the schedule script version to 23.

The audit formatter, table renderers, modal, filters, clear actions, dispatch columns and result details are identical to the saved baseline. The complete dashboard source from formatStatusBadge() onward was compared byte-for-byte after newline normalization.

Stored capability profiles and existing backend verification/validation APIs remain intact. Removing the UI does not erase stored physical results or automatically mark features verified. The firmware artifact was compared against the pre-edit snapshot and is unchanged. The Supabase delivery generator check confirms the SQL bundle is unchanged.

## Observed validation

| Check | Result |
| --- | --- |
| Native ordinary controls | 6 scenario groups passed: normal labels, half/quarter-degree steps, errors without applying failed settings, mode-specific restrictions, safe missing data and dashboard quick controls. |
| Retained capability backend | 5 native/PostgreSQL scenarios passed: UI absent, real command validation, stored capability updates, honest backend failures and atomic controller/AC naming. |
| Native Realtime | 4 checks passed; received ON/OFF and temperature/mode/fan/Turbo update without a reload or full database fetch. |
| Native Turbo | 9 checks passed, including independent Turbo/fan behavior and automatic changes. |
| Page integration | 41 checks passed. |
| Immediate IR events | 14 checks passed. |
| Receiver capabilities | 17 checks passed. |
| Capability registry | 4 scenario groups passed. |
| Registration progress | 27 checks passed. |
| Project npm test | 34 passed, zero failures. |
| Syntax/generation | 15 inline scripts/modules parsed; shared registry/state and SQL bundle drift checks passed. |
| Audit preservation | Renderers, filters/actions and dispatch/results were unchanged. |

Earlier fixture runs expected the intentionally removed labels such as Remote ON, OFF sent and the verification panel. Those UI expectations were updated. Internal source/status and validation assertions remain. A native fixture initially lacked the production dropdown renderer needed by the full command handler; adding that renderer resolved the fixture error. These were retested successfully.

Evidence: control-desktop.png, control/backend/realtime/turbo stdout and stderr logs, audit-preservation.json and implementation-review.diff. Result JSON files are in the existing multi-brand-capabilities, ir-latency and tcl-turbo report directories.

## Files

Runtime files: public/control.html, public/dashboard.html, public/ir-library.html, public/ir-profiles.html, public/nodes.html, public/scheduler.html, public/js/scheduler.js, public/js/aircon-state.js and regenerated public/js/aircon-system.js. Shared-engine cache versions also changed in public/aircons.html, public/logs.html, public/staff.html and public/telemetry.html. Removed public/js/ac-capability-verification.js, retaining its pre-edit copy in before/.

Existing tests updated: test_multi_brand_control_render.js, test_capability_verification_render.js, test_page_connections.js, test_ir_realtime.js, test_ir_capabilities.js, test_ir_realtime_render.js and test_ir_capabilities_render.js.

## Runtime limitation

Tests used actual Chromium and isolated fixtures/PostgreSQL, not the user's live physical AC or Supabase project. Reopen the desktop app once to load the revised frontend. Subsequent hardware updates remain automatic. No hardware upload or live database action was performed.
