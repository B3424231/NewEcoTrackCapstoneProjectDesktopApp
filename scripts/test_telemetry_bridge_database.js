'use strict';
// Actual PostgreSQL execution in isolated PGlite; no live database calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
(async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE public.telemetry(id text PRIMARY KEY, node_id text, temperature double precision,
        rotation_rpm double precision, interval_seconds integer, observed_at timestamptz, extra jsonb);
      GRANT SELECT,DELETE ON public.telemetry TO service_role;`);
    const migration = 'supabase_telemetry_bridge_migration.sql';
    if (fs.existsSync(migration)) await db.exec(fs.readFileSync(migration, 'utf8'));
    const insert = async (id, temperature = 18.25) => db.query(
      `INSERT INTO telemetry VALUES($1,'node-1',$2,600,5,'2026-10-22T01:00:00Z','{"revision":1}')`, [id, temperature]);
    const snapshot = async id => (await db.query('SELECT to_jsonb(t) AS value FROM telemetry t WHERE id=$1', [id])).rows[0].value;
    const ack = async rows => (await db.query('SELECT public.ecotrack_ack_telemetry($1::jsonb) AS value', [JSON.stringify(rows)])).rows[0].value;
    await insert('saved'); await insert('uncollected');
    const saved = await snapshot('saved'); saved.observed_at = '2026-10-22T01:00:00Z';
    let result = await ack([saved]);
    assert.deepEqual(result.acknowledged_ids, ['saved']); assert.deepEqual(result.deleted_ids, ['saved']);
    assert.equal((await db.query('SELECT id FROM telemetry ORDER BY id')).rows[0].id, 'uncollected');
    result = await ack([saved]); assert.deepEqual(result.acknowledged_ids, ['saved']); assert.deepEqual(result.deleted_ids, []);
    const changed = await snapshot('uncollected'); await db.exec("UPDATE telemetry SET rotation_rpm=900 WHERE id='uncollected'");
    result = await ack([changed]); assert.deepEqual(result.changed_ids, ['uncollected']); assert.deepEqual(result.deleted_ids, []);
    const partial = {id:'uncollected'}; result = await ack([partial]); assert.deepEqual(result.changed_ids, ['uncollected']);
    await insert('duplicate'); const duplicate = await snapshot('duplicate');
    await assert.rejects(() => ack([duplicate,duplicate]), /duplicate|unique/i);
    assert(await snapshot('duplicate'));
    await assert.rejects(() => ack([duplicate,{}]), /invalid|record/i);
    assert(await snapshot('duplicate'));
    for (const role of ['anon','authenticated']) {
      await db.exec('SET ROLE ' + role);
      await assert.rejects(() => ack([duplicate]), /permission denied/i);
      await db.exec('RESET ROLE');
    }
    await db.exec('SET ROLE service_role');
    result = await ack([duplicate]); assert.deepEqual(result.deleted_ids, ['duplicate']);
    await db.exec('RESET ROLE');
    assert.deepEqual((await ack([])).acknowledged_ids, []);
    console.log('PASS PostgreSQL: exact snapshots, unchanged timestamps, uncollected/changed rows, retry after delete, malformed/duplicate IDs, service-only permissions');
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
