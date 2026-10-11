# Supabase migration deadlock correction

Date: October 10, 2026 (Asia/Singapore).

## Request and execution scope

Goal: correct the supplied APPLY_SUPABASE.sql after PostgreSQL reported SQLSTATE 40P01.
Preserve the existing schema changes, Matrix data correction, registered device identities, credentials, assignments and command cleanup. No UI or firmware change is part of this fix.

Inspected evidence: the original generator concatenated five independently committed transactions. Device exchange writes device state, nodes and AC/command rows, while the migrations change those same relations. The Broadcast section also changes policies on realtime.messages and a trigger on device state. These operations can acquire table locks in opposing order.

The two live relation OIDs (17441 and 18784) have not been mapped to table names from this session. The exact blocking RPC and live transaction state remain unverified. Read-only diagnostics are provided separately.

Enhanced implementation prompt: make the combined delivery atomic, acquire its strongest required table locks before DDL without waiting, preserve all migration content and existing application behavior, fail clearly before changes when tables are busy, and verify rollback plus repeatable execution. No dependencies, APIs or data-model changes are authorized or required for this correction.

Execution decision: READY_TO_IMPLEMENT under the existing authorization to fix the delivered migration.

## Correction

- Updated scripts/generate_supabase_delivery.py and regenerated reports/multi-brand-capabilities/APPLY_SUPABASE.sql.
- One BEGIN/COMMIT now covers all five sections. The source migrations remain independently usable.
- A transaction-scoped advisory guard stops another copy of this delivery from running concurrently.
- Required aircons, device-state and nodes locks use ACCESS EXCLUSIVE NOWAIT before schema/data changes. When the Broadcast objects are available, realtime.messages is locked with NOWAIT too.
- A busy relation stops the run with SQLSTATE 55P03 and an explicit retry hint. No sessions are canceled or terminated.
- LOCAL timeouts bound other lock waits and total execution; they expire at transaction end.
- Any failure in this revised run rolls back its complete schema/function/data changes. Earlier committed sections of the old file are not undone; the revised file supports rerunning over them.

## Live retry

1. Close the EcoTrack desktop app and pause other EcoTrack writers.
2. Temporarily unplug the ESP32 so its cloud heartbeat/IR uploads stop.
3. Run the entire updated APPLY_SUPABASE.sql as the project owner in Supabase SQL Editor, including its BEGIN and final COMMIT.
4. After success, reconnect the ESP32 and reopen EcoTrack.

If the guard reports that tables are busy, pause remaining writers and retry the entire file. Do not run only the middle sections. If an SQL session reports that its transaction is already aborted, execute ROLLBACK in that session before retrying.

The read-only DIAGNOSE_LOCKS.sql maps the reported OIDs and lists current relevant locks/blockers without selecting SQL text or device credentials.

## Observed checks

- node scripts/test_multi_brand_database.js: 9 actual PostgreSQL scenario groups passed with the revised bundle, including repeat runs, naming, validation, identity preservation and authorization.
- node scripts/test_supabase_delivery_safety.js: 5 actual PostgreSQL scenarios passed. A deliberate division-by-zero near the end rolled back schema additions, RPC replacements and Matrix updates. Retry/repeat execution worked on fresh and partially installed databases, with credentials and AC assignment retained. Missing prerequisites stopped before installing functions.
- Generator drift and syntax checks were run against the final delivery.

PGlite provides real isolated PostgreSQL execution but this test runtime has no independent concurrent database sessions. Live multi-session contention testing is BLOCKED by the unavailable live Supabase SQL connection and local multi-session PostgreSQL runtime. No live database was modified and the user's deadlock was not reproduced against production.

Evidence: transaction-results.json; scripts/test_supabase_delivery_safety.js; before/ saved copies of the original generator and delivery.

## Reference

PostgreSQL documents the conflicting-lock cycle and recommends consistent lock acquisition with the strongest mode acquired first:
https://www.postgresql.org/docs/current/explicit-locking.html

NOWAIT fails instead of waiting when a lock cannot be acquired:
https://www.postgresql.org/docs/current/sql-lock.html
