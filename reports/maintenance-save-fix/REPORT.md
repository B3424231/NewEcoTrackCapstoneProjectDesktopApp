# Maintenance save retry fix

The reported logs come from two failed save paths. The transactional `ecotrack_admin_save_report` RPC rejects a room reference that no longer exists. The desktop then retries via a direct table upsert with an `update_progress` key, although that key is not a stored column. Every successful report fetch also attempted to create any locally cached report missing from the cloud, repeating the failures and potentially restoring intentionally deleted data.

Read-only live verification: rooms=0, nodes=0, aircons=0, maintenance_reports=1. The save RPC exists; `maintenance_reports.update_progress` does not. No cloud rows or schema objects were modified.

## Fix

- `src/main.js` saves through the transactional RPC only. Validation, permission, conflict, missing-function and malformed-response failures return to the caller without direct table writes.
- Renderer saves preserve the returned error and existing report state. Only an unavailable IPC transport can call the same validating RPC directly. The existing progress flag remains RPC JSON metadata; it is never sent to a table upsert.
- Room and controller references are resolved by actual database IDs or an unambiguous exact name. Removed hardcoded legacy ID maps and prefix-based assumptions. Deleted references fail before saving, with a message to refresh and select an existing resource.
- Removed automatic cache backfill. Successful authenticated full reads reconcile cloud deletions and empty lists. Failed or malformed reads and signed-out states preserve the previous successful cache. Confirmed saves that finish after a read starts are retained to prevent a read/save race.

## Verification

- `node scripts/test_maintenance_save.js`: PASS. Covers the exact selected-room rejection, permission/conflict/missing RPC failures, no direct-table writes, malformed confirmations, actual UUID references, deleted/ambiguous rooms, cache preservation, authenticated empty reads, transport-only RPC fallback and read/save races.
- `node scripts/test_report_deletion.js`: PASS.
- `node scripts/test_database_cleanup.js`: PASS.
- JavaScript syntax: PASS for both changed runtime files.
- Existing mock-removal and data integration source checks were run separately. They do not prove a live report can be saved with deleted resources.
- No live save was attempted: no valid room/controller remains in the cloud, and a production save would require an actual report and valid selections. Deleted rows were not recreated to make a test pass.
- Browser automation remains unavailable in this environment. This task was verified through source-level regression tests and read-only live database checks.

Close and reopen EcoTrack to load the Electron main-process change. New report creation requires registering real rooms/controllers first. Existing server reports were preserved.

Source backup: `C:\Users\reygay\AppData\Local\Temp\ecotrack-maintenance-save-before-2roc1oq8`. Task-specific changes: `maintenance-save-fix.patch`.
