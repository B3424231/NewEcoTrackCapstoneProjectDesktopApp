# Cloud hardware connection implementation

Implemented authenticated Bluetooth Wi-Fi provisioning and a Supabase transport for IR capture, device diagnostics, schedules, and future full-state AC requests. Receiver-only actuation is rejected. The existing firmware directory was not edited; the matching standalone Arduino sketch is in this report folder for copying into Arduino IDE.

## Runtime behavior

- Node discovery reads the ESP32 hardware identity over GATT. Device selection is explicit, has a discovery timeout, and validates responses from the trusted main renderer. Credentials are written only over a characteristic requiring authenticated encryption.
- Each registered node receives a separate random cloud credential. The database stores its SHA-256 hash in a private schema; device exchange checks that credential and scopes all command claims, receipts, telemetry and IR captures to its registered node. Administrator requests use the existing administrator authentication. The public browser/device key is not administrative authority.
- Cloud requests have unique IDs, expiration, claim/retry behavior, and explicit acknowledgements. New configuration/control requests supersede older queued settings. No receiver action is reported as IR transmission. A successful IR learn needs actual captured data; a schedule acknowledgement must match its requested interval and clocks.
- Status uses server heartbeats and declared sleep deadlines. Cached status expires without fresh heartbeats. Cloud Ping measures a matching device response; metadata edits and manual reconnects cannot invent device health.
- The selected integer interval value/unit survives a reload. The ESP32 receives seconds, persists schedules locally, captures real IR timings, and uploads actual Wi-Fi history at that interval with duplicate protection. Other sensor/AC/battery measurements remain null.
- The new UI's hardware paths use Supabase rather than local IP endpoints. Legacy backend/firmware local endpoints remain in their existing files but are not used by this updated transport. Matching SQL and sketch deployment are required before using it.

## Verification

- Cloud migration/database: 28 checks passed on PGlite PostgreSQL, including repeat migration, wrong/revoked credentials, non-admin denial, cross-device denial, RLS, duplicate requests/acknowledgements, expiry, receiver restrictions, validated schedule receipts, preserved units, and real connectivity/IR persistence.
- Actual cloud client: 17 checks passed with simulated BLE and Supabase responses, including GATT reads/writes, chunked Unicode configuration, password privacy, verified registration heartbeat, measured acknowledgements, timeout/failure handling, sleep, and missing deployment errors.
- UI/IPC: 10 checks passed for trusted selection/pairing, one-use callbacks, schedule validation and failure preservation, queued/applied labels that require matching receipts, and inline script syntax.
- Cloud receipt/history sync: 6 checks passed, including cross-controller denial, permission failure preservation, expired requests, receipt/read races, and prevention of browser-generated sensor history.
- Control engine: 38 checks passed. Dedicated hardware control passed for complete mode/fan/temperature/power requests (including IR Studio selections together), cloud-only delivery, receiver rejection and unchanged state on failed writes.
- Maintenance save/deletion, database cleanup, analytics reset, logs stability, telemetry cadence, and existing Python database/cloud sync/schedule/state regressions passed. Mock-removal audit: 34 checks passed; Supabase integration audit: 33 checks passed.
- Final ESP32-S3 build passed using installed ESP32 core 3.3.12, ArduinoJson 7.4.3 and IRremoteESP8266 2.9.0. Huge APP partition: 1,403,048 program bytes of 3,145,728; 50,196 global variable bytes. The build did not flash hardware.

## Deployment and limits

Live deployment is BLOCKED by unavailable SQL execution access: the available REST credentials cannot execute schema migrations, no Supabase management connector is installed, and browser automation failed to initialize. Read-only API inspection confirms the existing admin helper exists and the new RPCs/tables are not yet present. No live Supabase data/schema was modified.

Physical Bluetooth pairing, actual IR capture, cross-network device operation, deep sleep/wake on a board, and browser visual behavior remain NOT RUN. Firmware compiles and isolated transport/security tests pass; those results do not establish a physical end-to-end test.

Follow SETUP.md to run the migration, upload the separate sketch, restart EcoTrack, and provision the ESP32. The source backup location is recorded in source-backup.json. Control-page and node-page diagnostics plus background receipts now all use Supabase. Legacy local endpoints remain only in backend/firmware files and are not the new UI transport.

No application runtime dependency was added; PGlite is isolated in ignored scratch/cloud-db-test-runtime for database tests.
