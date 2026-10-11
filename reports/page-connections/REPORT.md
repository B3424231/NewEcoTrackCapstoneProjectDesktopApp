# EcoTrack page connection verification

Checked 2026-10-09 (Asia/Singapore). Source integration is verified in isolated fixtures. Visual and physical hardware acceptance remain pending.

## Connected pages

| Page | Shared connection |
| --- | --- |
| Control Dashboard | Reads the same persisted AC profiles, controller binding, heartbeat, selected protocol, and reported/desired state as Control. Links to the actual selected AC. |
| Aircon Control | Saves actual controller IDs and exact protocols; explicit Unassigned clears both controller links. Protocol Studio links include the selected AC ID. |
| Control Schedules | Maps controllers by actual room and database ID; shows unassigned controllers; retains midnight and millisecond settings. Applied requires the matching hardware acknowledgement. |
| IR Remote Profiles | Retains exact variants such as DAIKIN64. Save/delete errors remain errors until Supabase confirms persistence. |
| AC Controller Devices | Registration creates or explicitly attaches an existing unassigned AC profile. Locations must have actual Supabase IDs. Edit persists custom location hierarchy before binding. |
| AC Protocol Studio | Opens the linked AC, preserves its unsaved draft during refresh, clears deleted/missing targets, and submits the selected protocol and complete state to the cloud. |

All six load the shared `aircon-system.js` and `hardware-cloud.js`. Supabase nodes/aircons provide persistence, the shared registry provides immediate UI access, and events/BroadcastChannel plus database refresh propagate changes between pages. Hardware communication uses Supabase cloud requests and device acknowledgements.

## Corrected causes

- Database reads no longer recreate deleted AC profiles from cached entries or remaining controllers.
- Profile saves require a real Supabase confirmation and actual controller identity. No local-success fallback or invented AC database ID.
- One controller cannot be silently assigned to a second AC profile.
- Device display no longer invents a node-10 / room 1 AC or a minimum attached-unit count.
- Display-only location labels are no longer offered as unsaved room IDs.
- Location creation confirms the database write before entering the shared cache; rejected writes can be retried.
- Controller metadata edits preserve actual heartbeat and receiver/transmitter capability.
- Protocol selection survives refresh across Devices, Profiles, Control, and Studio.
- Unknown dashboard settings and measurements remain empty; diagnostics no longer display invented ACK latency or transmitter readiness.
- Schedule queue acceptance is separate from actual device application. Late receipts must match the controller, request, interval, wake time, and sleep time.
- Controller removal refuses linked profiles and requires explicit unassignment first. No linked-profile cascade was added.

## Executed checks

| Check | Observed result |
| --- | --- |
| `node scripts/test_page_connections.js` | PASS: 23 scenarios, including production Dashboard/Profile/Studio handlers and six independent page engines with shared storage/events. |
| `node scripts/test_registration_progress.js` | PASS: 17 scenarios, including denied locations, retries, existing-AC attachment, exact protocols, and the controller Edit handler. |
| `node scripts/test_aircon_system.js` | PASS: 38 checks. |
| `node scripts/test_hardware_control.js` | PASS: cloud-only full-state dispatch, receiver-only rejection, failed requests, captures, and metadata heartbeat preservation. |
| `node scripts/test_cloud_hardware_ui.js` | PASS: 10 checks. |
| `node scripts/test_cloud_hardware_client.js` | PASS: 17 checks. |
| `node scripts/test_cloud_hardware_database.js` | PASS: 28 checks against isolated PGlite/PostgreSQL. |
| `node scripts/test_cloud_hardware_sync.js` | PASS: 6 checks. |
| `venv\\Scripts\\python.exe scripts/test_schedule_pipeline.py` | PASS: 5 tests using temporary databases. |
| Shared/inline syntax compilation | PASS: 3 shared scripts and 12 inline scripts across the six pages. |
| `node scripts/test_dashboard_workflows.js` | Existing failure at line 75: unknown-device runtime fallback returns 0.25 hours (15 minutes); the older test expects 0.008333333333333333 hours (30 seconds). This logs/analytics expectation was not changed by this repair. |

These tests use isolated database/hardware fixtures. They do not prove a live authenticated write, physical IR reception, AC transmission, or real wake/sleep behaviour.

## Live Supabase read-only audit

The available schema includes the cloud registration, cloud request, device exchange, and device mutation functions. See `live-schema.json`.

The last count check at 2026-10-08T19:05:41Z shows **0 controllers, 0 AC profiles, 0 cloud-state rows, and 0 rooms**. An earlier read had one unbound AC profile; the later read found none. This audit made no live database changes. See `live-registry.json`.

Restart EcoTrack, register the ESP32 through Bluetooth/Wi-Fi, and complete Save & Verify Controller. Registration persists its AC binding for the six pages. A receiver-only board can capture IR and apply reporting/wake/sleep configuration; AC power, temperature, mode, and fan actuation require an IR transmitter.

## Remaining verification limits

- Browser automation could not start: `node_repl kernel exited unexpectedly`, caused by Windows sandbox `helper_unknown_error: setup refresh had errors`. No visual/browser test was completed.
- Physical hardware testing was not performed; no controller is currently present in the live registry.
- Node metadata and AC profile updates are separate Supabase writes. A rejected second write is reported as incomplete and can be retried; they are not a single atomic database transaction.
- Codex listed this as the only active chat. No other active project chat was available to pause. The state of an external editor could not be confirmed.

Automatic approval review rejected an earlier proposed controller-deletion cascade because it could permanently delete linked AC profiles. The implemented safeguard requires unassignment instead.

## Review artifacts

- `integration-tests.json`: all cross-page assertions.
- `source-changes.patch`: task-specific changes against saved pre-audit source copies.
- `source-fingerprints.json`: source hashes for concurrency/stability checking.
- `scratch/page-connections-before/`: pre-audit source copies. Unrelated workspace edits were preserved.
