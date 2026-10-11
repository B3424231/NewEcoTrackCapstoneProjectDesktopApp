# AC OFF recording fix

The screenshots show the air conditioner power setting is OFF while the ESP32 remains connected. Connectivity reports were still being inserted into telemetry, which created an analytics row without a recorded mode, fan or temperature.

## Implemented behavior

- Routine local telemetry requires an ON power setting. OFF, unknown-power and sleeping/offline packets produce no new operating-history row.
- The Supabase patch adds the same guard to telemetry inserts. The latest requested, reported or received remote power field is selected by timestamp; partial receiver frames retain the time their power field was actually decoded.
- When recording is allowed, cloud rows store their assigned AC and a snapshot of the saved/received state. Requested or received remote ON does not fabricate physically confirmed `ac_on`, temperature or battery measurements.
- The analytics table, record counter and Excel/PDF reading lists show ON history only. OFF/connectivity-only rows are excluded.
- Existing history is not deleted or rewritten. Earlier ON readings remain visible after switching OFF. Existing history inputs and OFF anchors are still available to energy/runtime calculations.
- Heartbeats, latest IR observations, ping/configuration traffic and command/IR dispatch acknowledgements continue through their existing tables. Administrative schedule audit events keep their existing local path.
- Existing profile bindings by database node ID, stable ESP32 ID or saved controller name remain compatible.
- No Arduino sketch change is required for this fix.

## Deployment still required

**The live Supabase database has not been modified.** This workspace has no SQL deployment connection.

1. Open Supabase SQL Editor as the project owner.
2. Paste and run the complete `reports/ac-off-recording/APPLY_SUPABASE.sql`.
3. Restart the desktop app from this updated project once, including its Python backend.
4. With the AC OFF, confirm the ESP32 connection still updates and the telemetry row count stops increasing. Turn ON and verify routine rows resume.

The patch is transactional and repeatable. It takes a NOWAIT lock on telemetry before altering that table. If SQL Editor reports “Analytics table is busy”, retry the complete file. It does not delete existing rows or alter command-retention rules.

Do not run only selected statements from the patch: the functions, columns and trigger belong to one transaction.

## Observed validation

| Check | Result |
| --- | --- |
| `node scripts/test_ac_recording_database.js` | PASS: 13 scenario groups against isolated PGlite PostgreSQL, including real device RPCs, OFF/ON transitions, timestamp precedence, sleeping reports, cloud profile snapshots, legacy bindings, ping and IR acknowledgements, repeatable installation and credential checks |
| `venv/Scripts/python.exe -X utf8 scripts/test_cloud_telemetry_sync.py` | PASS: 10 tests using temporary SQLite; OFF/unknown rejection, remote ON/OFF selection, saved snapshots, import idempotence and reset boundaries |
| `venv/Scripts/python.exe -X utf8 scripts/test_aircon_state.py` | PASS: 1 state round-trip/idempotence test |
| `node scripts/test_ac_recording_ui.js` | PASS: 4 scenario groups covering the table, counters, OFF-only export rejection, earlier ON history and timestamp selection |
| Hidden Electron `scripts/test_logs_climate_modes_render.js` | PASS: 3 viewport/theme scenarios, including OFF transition without reloading, twelve-column empty state, light/dark themes and narrow-screen horizontal scrolling |
| `node scripts/test_telemetry_cadence.js` | PASS: ON cadence, OFF/unknown/sleeping rejection, remote ON resumption, no duplicate desktop rows in cloud mode, failed-save handling and historical refresh filters |
| `node scripts/test_logs_stability.js` | PASS: background refresh, scroll preservation, chart reuse and prediction race handling |
| `node scripts/test_logs_climate_modes.js` | PASS: 6 historical mode/fan scenario groups |
| `node scripts/test_analytics_reset.js` | PASS: reset, deletion refresh and historical persistence |
| `npm test` | PASS: 34 data-integrity checks |
| JavaScript syntax checks and Python compilation | PASS |

### Existing regression failure

`node scripts/test_runtime_engine.js` still fails its missing-cadence assertion: the test expects 30 seconds, while the existing implementation uses 15 minutes (0.25 hours versus 0.008333 hours). Running the same test against `reports/ac-off-recording/before/public/js/logs.js` produces the identical failure. This task does not change that default or the runtime calculation functions.

### Evidence and limits

- `database-tests.json`: actual isolated PostgreSQL outcomes.
- `ui-tests.json`: table/export scenarios.
- `native-results.json`, `native-stdout.log`, `native-stderr.log`: native rendering outcomes.
- `off-light-1460.png`, `off-dark-1460.png`, `off-light-390.png`: settled OFF-state rendering captures. The narrow view retains the existing horizontal table scroll.
- `before/`: pre-task source snapshots.
- Physical AC/ESP32 behavior after applying the live SQL patch has not been tested here.

## Changed application files

- `backend/app.py`: local API routine-write guard and preserved idempotent responses.
- `public/js/node-sync.js`: local sender gate.
- `public/js/logs.js`: operating-history display/export gate and counter/empty-state update.
- `public/logs.html`: updated script cache versions.
- `supabase_ac_recording_migration.sql`: cloud telemetry trigger and timestamp selection.
- `reports/ac-off-recording/APPLY_SUPABASE.sql`: identical ready-to-run copy of the patch.
