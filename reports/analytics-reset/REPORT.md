# AC Energy Analytics reset and hardcoded-data review

Reset performed at 2026-10-08T13:12:52.905322+00:00. Removed 539 local telemetry rows from `backend/telemetry.db`. Supabase telemetry contained 0 rows, so no cloud delete was required.

A consistent SQLite backup was verified with `PRAGMA integrity_check`: `C:\Users\reygay\Desktop\EcoTrackDesktopDashboardNew-main-control\backend\backups\telemetry-before-analytics-reset-20261008T131251Z.db`. Schedule dispatches were preserved (3 rows). No user, building, room, staff, maintenance, or AC registry data was deleted.

## Why deleted cloud data remained visible

`public/logs.html` (AC Energy Analytics) reads the independent SQLite history. Cloud deletion does not delete SQLite rows. Its loader previously returned without clearing loaded logs on an empty response, and attempted to load cloud records again. Failed model requests also generated energy from a fixed 1.5 kW formula, despite the backend reporting that model output units are unverified.

## Implemented changes

- A successful empty local response clears logs, predictions and chart data immediately. Failures preserve the last successful snapshot.
- Reset detection refreshes historical date selections while retaining the selected date. The full-history DELETE endpoint atomically records a persistent UTC reset boundary and clears history. Cloud imports and direct POSTs cannot restore telemetry at or before that boundary; future readings remain enabled.
- Removed the preset tariff, provider and hidden budget. Valid user-saved settings remain supported; an unset tariff produces unavailable costs rather than zero-cost electricity. Removed writes to the absent `system_settings` table.
- Removed guessed model temperatures, the fixed-power fallback, fabricated consumer power ratings, invented flat comparison baselines and the static anomaly-free report claim. Rankings and export charts use successful per-controller estimates and actual previous-period data.
- Missing telemetry measurements remain null. Raw packets are saved without borrowing cached readings, and their explicit AC feedback is preserved. Sample building/floor/type metadata no longer becomes telemetry.

## Search coverage and remaining candidates

Scanned 59 application/firmware/SQL files. The before inventory contains 172 pattern matches; the after inventory contains 119. These are candidates, not counts of proven fake records. Comment text, random IDs, validation thresholds, model/IR catalogs and hardware calibration constants can be legitimate. Bundled Supabase library matches are library internals.

| Area | Finding | Status |
|---|---|---|
| AC Energy Analytics and telemetry ingestion | Preset costs, guessed readings/locations, synthetic energy and rankings | Removed from the targeted paths |
| Control/dashboard pages | Sample IP addresses, simulated ping output and default selected AC setpoints | Inventoried for separate review; these pages were not part of the analytics reset |
| General telemetry analytics / scheduler / maintenance | Missing-reading substitutions and compliance inputs | Inventoried; not all belong to AC Energy Analytics |
| Staff and database bootstrap SQL | Sample building/room defaults | Inventoried; no deployed schema or staff records changed |
| Firmware | Default site labels and initial battery voltage | Inventoried; firmware was not flashed or changed |
| Optional legacy SQL demo files | Explicit example rows | Retained under `scripts/demo-seeds`; not automatically executed |
| Catalogs, IDs and thresholds | Device capabilities, UUID/random identifiers, calibration and UI values | Retained when they are configuration or algorithms rather than records |

See `hardcoded-candidates.json` and `hardcoded-candidates-after.json` for individual file/line matches. The search is a source audit with heuristic patterns; it cannot prove the absence of every possible hardcoded value. The prior cloud schema audit is in `reports/database-audit`.

## Verification

- `node scripts/test_analytics_reset.js`: PASS (authoritative empty state, failed/malformed response preservation, historical reset refresh, unconfigured tariffs, estimate-based rankings and raw telemetry persistence).
- `node scripts/test_logs_stability.js`: PASS (prediction races, bounded requests, unavailable failed estimates, missing-input handling, valid zero estimates and chart reuse).
- `python scripts/test_cloud_telemetry_sync.py`: PASS (8 isolated tests, including durable reset/import boundaries and acceptance of new data).
- Database cleanup: PASS (7 Python tests plus JavaScript adapter/cache regressions).
- Schedule pipeline: PASS (5 tests); AC state: PASS (1 test); telemetry cadence and hardware control: PASS.
- Integration checks: PASS (33 source checks); existing mock-removal checks: PASS (34 targeted source checks). These source checks do not certify all remaining hardcoded candidates as absent.
- JavaScript syntax and Python compilation: PASS for changed runtime sources.
- Live backend: health 200, telemetry 200 with 0 rows and reset boundary, historical arrays empty, cloud sync running with no error and 0 transferred rows. Cloud telemetry count 0.
- Browser visual verification: BLOCKED. The browser tool failed with `trusted Node process exited unexpectedly; kernel reset`.
- Two broader runtime tests were already failing before this task (missing cadence expectations); their unrelated behavior was not changed.

Reload the desktop page/application to load the updated JavaScript. New real readings can populate analytics again after this reset. The original HVAC model still needs verified features and output units before nonzero energy predictions are available; no invented fallback replaces that limitation.

Source backup: `C:\Users\reygay\AppData\Local\Temp\ecotrack-analytics-source-before-cz_ngdcr`. Review the task-specific changes in `analytics-reset.patch`; existing unrelated workspace changes were preserved.
