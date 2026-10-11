The AC Energy Analytics history table replaces Aircon State with Operating Mode and Blower Fan Mode. Each row derives these values from its saved reported/IR receiver snapshot. Newer requested or configured settings do not rewrite historical readings. Recorded Turbo is shown alongside the fan value. Missing or invalid observations display Unavailable; older records cannot be retroactively populated from current settings.

The table now has twelve aligned columns and a twelve-column empty state. Excel and PDF reading exports use the same mode/fan projection. Excel banner spans, status styling and column positions were adjusted. The logs script cache version is 40. Power/energy runtime functions and command audit data are unchanged.

Observed validation:
- Historical mode/fan, table and export data: 6 scenario groups passed.
- Hidden Chromium: desktop light/dark and narrow-screen scenarios passed, including rendering updates without reload, horizontal scrolling and empty-state alignment.
- Saved snapshot round trip through temporary SQLite: 1 test passed.
- Logs refresh stability, telemetry cadence and analytics reset suites passed.
- JavaScript syntax passed.

Existing limitation: scripts/test_runtime_engine.js fails on missing-cadence defaults (expected 30 seconds, existing fallback 15 minutes). The exact failure occurs on the saved pre-change logs.js. Runtime functions were verified unchanged by this task.

Native screenshots use local fixtures. No live Supabase data or connected hardware was modified. Export field mapping was exercised in production code; downloadable binaries were not generated in this check.
