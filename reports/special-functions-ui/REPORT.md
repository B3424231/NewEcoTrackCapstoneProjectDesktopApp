# Special functions UI

Implemented the three requested display changes:

- Removed FILTER from the Dynamic Aircon Control special-function row.
- Changed the generic Swing button to Vertical Swing, retaining the separate Horizontal Swing button. Their visibility follows the selected protocol/model capabilities. Vertical actions keep the legacy swing and explicit swing_vertical fields consistent; horizontal actions keep their separate state.
- Added Special Functions to the Aircon Control State & Setpoint panel. Supported function states appear as ON/OFF values and update through the existing render/event flow.
- Added a Special Functions column to Daily Logs and corresponding Excel/PDF reading exports. It reads only the receiver/reported state saved with that historical record, respects per-field timestamps, and excludes FILTER. Missing historical evidence displays Unavailable.
- Preserved the existing AC OFF logging guard, earlier ON history, control enablement rules and command/IR audit flow.

## Validation actually run

| Check | Observed result |
| --- | --- |
| Hidden Electron scripts/test_multi_brand_control_render.js | PASS: 10 scenario groups, including separate vertical/horizontal actions, consistent legacy vertical flags, unchanged other swing direction, FILTER removal, current-settings updates without reload, multi-brand transitions, command failure handling and saved controller names |
| node scripts/test_logs_climate_modes.js | PASS: 7 historical mode/fan/special-function scenario groups, including production Excel/PDF row values |
| Hidden Electron scripts/test_logs_climate_modes_render.js | PASS: 3 viewport/theme scenarios, thirteen aligned columns, special-function values and OFF empty state without reload |
| node scripts/test_ac_recording_ui.js | PASS: 4 scenario groups; OFF and unknown-power history remain excluded from the table and exports |
| node scripts/test_logs_stability.js | PASS: background refresh, scroll preservation and chart/prediction behavior |
| venv/Scripts/python.exe -X utf8 scripts/generate_ac_capabilities.py --check | PASS: generated registry/state remains consistent for 18 exact protocols |
| JavaScript syntax checks | PASS |
| npm test | PASS: 34 data-integrity checks |

The older scripts/test_hardware_control.js still fails its DAIKIN2 Sleep assertion: it expects sleep='on' although the existing exact capability profile does not enable Sleep. The same failure was reproduced using reports/special-functions-ui/before/public/js/aircon-system.js. This change does not alter the capability registry or Sleep behavior.

## Evidence and limits

- control-native-results.json and control-stdout.log record the native control scenarios.
- native-results.json and logs-stdout.log record native history rendering.
- table-light-1460.png, table-dark-1460.png and table-light-390.png show the new historical column. Narrow layouts retain horizontal table scrolling.
- current-settings.png captures the new summary in the isolated desktop fixture.
- before/ contains the pre-change source files.
- No live Supabase data or firmware was changed. Physical louver movement has not been tested here. Older records without saved receiver/reported function values cannot reconstruct them from today's UI.
- The prior AC OFF recording SQL patch remains a separate deployment step; this UI change needs no additional SQL migration.

## Application files

- public/control.html: button labels, FILTER removal, current summary and script cache version.
- public/js/aircon-system.js: consistent vertical swing aliases.
- public/js/logs.js: saved special-function formatter and thirteen-column table/Excel/PDF displays.
- public/logs.html: new column header and script cache versions.
