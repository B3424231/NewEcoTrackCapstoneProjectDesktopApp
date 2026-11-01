'use strict';
// Execute actual old and forward trigger SQL in disposable PostgreSQL-compatible WASM.
// No hosted writes, hardware or application data are used.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const {PGlite} = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '..');
const migration = '20261030150000_rule_measurement_optional_event_type.sql';
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const checks = [];
(async () => {
 const db = new PGlite();
 try {
  const source = read('scripts/test_cloud_rule_evaluation.js');
  const fixture = source.match(/await db\.exec\(`([\s\S]*?)`\);/)[1].replace(',event_type text', '');
  await db.exec(fixture);
  await db.exec(`CREATE TABLE rooms(id text PRIMARY KEY,name text);
   INSERT INTO rooms VALUES('r1','Isolated test room');
   ALTER TABLE nodes ADD COLUMN aircon_type text;
   ALTER TABLE telemetry ADD COLUMN sensor_name text,ADD COLUMN room_name text,ADD COLUMN aircon_type text,
    ADD COLUMN rssi numeric,ADD COLUMN created timestamptz,ADD COLUMN ac_on boolean;
   CREATE TABLE ecotrack_private.device_credentials(device_id text PRIMARY KEY,node_id text REFERENCES nodes(id),token_hash bytea);
   INSERT INTO ecotrack_private.device_credentials VALUES('esp32s3-001122334455','n1',sha256(convert_to(repeat('a',64),'UTF8')));`);
  await db.exec(read('supabase/migrations/202610230001_measurement_outbox.sql'));
  for (const file of ['20261026085912_cloud_rule_evidence_storage.sql', '20261026090050_cloud_rule_measurement_processing.sql'])
   await db.exec(read('supabase/migrations/' + file));
  const insert = async (id, overrides = {}) => db.query('INSERT INTO telemetry SELECT * FROM jsonb_populate_record(NULL::telemetry,$1::jsonb)', [JSON.stringify({
   id, node_id:'n1', temperature:30, rotation_rpm:0, rotation_quality:'ok', interval_seconds:5,
   observed_at:new Date().toISOString(), boot_id:'isolated-boot', sequence:1, status:'online', ...overrides
  })]);
  await assert.rejects(insert('before'), error => error.code === '42703' && /event_type/.test(error.message));
  checks.push('Reproduced deployed missing-field 42703 using real trigger execution without event_type.');
  const original = (await db.query("SELECT pg_get_functiondef('ecotrack_private.evaluate_cloud_rule_sample()'::regprocedure) AS definition")).rows[0].definition;
  await db.exec(read('supabase/migrations/' + migration)); await db.exec(read('supabase/migrations/' + migration));
  const after = (await db.query("SELECT pg_get_functiondef('ecotrack_private.evaluate_cloud_rule_sample()'::regprocedure) AS definition")).rows[0].definition;
  assert.equal(after.replace("(to_jsonb(NEW)->>'event_type')", 'NEW.event_type').replace(/\r\n/g,'\n'), original.replace(/\r\n/g,'\n'));
  checks.push('Forward migration applies twice and changes only optional-field access; all other function/security text stays identical.');
  assert.equal((await db.query("SELECT count(*)::int n FROM information_schema.columns WHERE table_name='telemetry' AND column_name='event_type'")).rows[0].n, 0);
  await insert('after');
  let node = (await db.query("SELECT * FROM nodes WHERE id='n1'")).rows[0];
  assert.equal(Number(node.rotation_rpm), 0); assert.equal(Number(node.temp), 30); assert(node.last_measurement_at);
  checks.push('Measurement insert succeeds on the deployed schema; real zero and observed timestamp are retained without adding a column.');
  const at = node.last_measurement_at;
  await insert('schedule', {status:'schedule', temperature:12, rotation_rpm:900});
  node = (await db.query("SELECT * FROM nodes WHERE id='n1'")).rows[0];
  assert.equal(Number(node.temp),30); assert.equal(String(node.last_measurement_at),String(at));
  checks.push('Schedule-status events remain excluded from measurement snapshots.');
  await db.exec("ALTER TABLE telemetry ADD COLUMN event_type text");
  await insert('legacy-schedule', {event_type:'schedule_updated',temperature:13,rotation_rpm:910});
  assert.equal(Number((await db.query("SELECT temp FROM nodes WHERE id='n1'")).rows[0].temp),30);
  await db.exec('ALTER TABLE telemetry DROP COLUMN event_type');
  checks.push('Legacy schema event_type=schedule_updated remains excluded when that optional field exists.');
  await db.exec("INSERT INTO rules(id,type,condition,value,unit,duration) VALUES('test-rule','temperature','above',28,'°C',0)");
  await insert('alert');
  assert.equal((await db.query('SELECT count(*)::int n FROM notifications')).rows[0].n,1);
  assert.deepEqual((await db.query('SELECT staff_id FROM mobile_notifications ORDER BY staff_id NULLS FIRST')).rows.map(row=>row.staff_id),[null,'assigned']);
  checks.push('Normal measurements still generate one desktop alert and only the assigned mobile recipient plus administrator event.');
  for (const role of ['anon','authenticated']) {
   await db.exec('SET ROLE '+role); await assert.rejects(db.query('SELECT ecotrack_private.evaluate_cloud_rule_sample()'),/permission denied/); await db.exec('RESET ROLE');
  }
  checks.push('Internal trigger execution remains denied to application roles.');
  const observed = new Date().toISOString();
  const report = 'esp32s3-001122334455-1-1';
  const reading = {node_id:'n1',report_id:report,boot_id:'esp32s3-001122334455-1',sequence:1,
   observed_at:observed,interval_seconds:5,outlet_temperature_c:24.5,rotation_rpm:600,rotation_quality:'ok'};
  const upload = async (token, sample) => (await db.query(
   'SELECT public.ecotrack_upload_measurements($1,$2,$3::jsonb) AS result',
   ['esp32s3-001122334455',token,JSON.stringify([sample])])).rows[0].result;
  await db.exec('SET ROLE anon');
  await assert.rejects(upload('b'.repeat(64),reading),error=>error.code==='42501');
  await assert.rejects(upload('a'.repeat(64),{...reading,node_id:'other-node'}),/different device assignment/);
  const uploaded = await upload('a'.repeat(64),reading);
  assert.deepEqual(uploaded.acknowledged_ids,[report]);
  assert.deepEqual((await upload('a'.repeat(64),reading)).acknowledged_ids,[report]);
  await db.exec('RESET ROLE');
  const stored = (await db.query('SELECT * FROM telemetry WHERE id=$1',['cloud_'+report])).rows[0];
  assert.equal(Number(stored.temperature),24.5); assert.equal(Number(stored.rotation_rpm),600);
  assert.equal(new Date(stored.observed_at).toISOString(),observed);
  assert.equal((await db.query('SELECT count(*)::int n FROM telemetry WHERE id=$1',['cloud_'+report])).rows[0].n,1);
  checks.push('Credential-checked device upload executes the repaired trigger through anon RPC, preserves temperature/RPM/timestamp, retries once, and rejects wrong credentials/assignments.');
  const out = path.join(root,'reports/packaging-20261030/integration'); fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(path.join(out,'rule-optional-field-tests.json'),JSON.stringify({status:'PASS',migration,checks,physical_hardware_tested:false,live_database_modified:false},null,2));
  console.log('PASS optional telemetry field migration: '+checks.length+' PostgreSQL checks; no hosted data changed.');
 } finally {await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
