# Automatic remote state and UI updates

Implemented in the shared desktop engine on 2026-10-09. All six connected pages use Supabase real-time changes and a five-second foreground read fallback. Returning to an inactive page requests a fresh read. Reads do not create telemetry or acknowledgements.

Dashboard cards display Remote ON/Remote OFF from decoded receiver state and distinguish UI requests from transmitted/failed commands. The shared state helper retains the last decoded observation across trailing unknown frames, keeps timestamps stable across heartbeats, respects newer commands, and clears observations when their cloud capture is removed. Failed cloud reads preserve the prior snapshot. Devices and Schedules use the same helper.

Schedules poll queued receipts when real-time delivery is missed, preserve unfinished edits until Apply succeeds, and keep wake/sleep cards aligned when the equal-time explanation is visible.

The separate Arduino copy-paste sketch is now cloud-ir-controller-1.4-rxtx. It preserves compact last_decoded metadata across undecoded frames and prints decoded remote power, setpoint, mode and fan. Only reports/cloud-hardware/EcoTrackCloudReceiver.ino.txt was updated for delivery; firmware files were not edited. No board was flashed.

Observed checks:
- Six-page integration: 37 grouped checks passed, including remote OFF/ON, automatic refresh, requested/sent state, missed receipts, cloud read failure and paused schedule drafts.
- Native live dashboard: 5 checks passed. A real five-second timer changed the fixture card from ON to OFF in 4,990 ms without real-time events or a reload. Cloud responses were mocked and HTTP(S) blocked.
- Native schedule row: 18 checks passed across both themes, including top alignment with the equal-time note visible.
- Core AC engine: 38 passed; hardware client: 40; cloud database: 30; hardware UI: 11; schedule times: 10; cloud receipt/history: 6. Hardware-control regression passed.
- npm test: 34 mock-data integrity checks passed.
- Heltec ESP32-S3 compilation passed: 1,540,628 / 3,342,336 program bytes; 50,900 / 327,680 static RAM bytes. Delivered sketch SHA-256 matches the compiled source.
- Embedded and standalone state helpers match; task-added whitespace checks passed.

Restart EcoTrack once from this project to load the updated scripts. Subsequent remote updates do not require page reloads. Upload the separate updated sketch through Arduino IDE to enable its capture-retention improvement.

Command auto-deletion is prepared separately in supabase_command_retention_migration.sql. Live deployment is pending: no SQL execution connector is available and browser access failed to initialize. Local database tests used PGlite; actual pg_cron scheduling, live Supabase and physical IR operation were not tested here.
