'use strict';
// Real PostgreSQL-compatible execution in disposable WASM; no live service.
const {test,before,after,beforeEach}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');let db,serial=0;
before(async()=>{
 db=new PGlite();await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA ecotrack_private;
 CREATE TABLE nodes(id text PRIMARY KEY,name text,room_id text,temp numeric,rotation_rpm numeric,rotation_quality text,last_measurement_at timestamptz,last_measurement_report_id text);
 CREATE TABLE ecotrack_device_state(node_id text PRIMARY KEY,last_seen timestamptz,sleeping_until timestamptz);
 CREATE TABLE rules(id text PRIMARY KEY,type text,condition text,value numeric,unit text,enabled boolean DEFAULT true,message text,duration integer DEFAULT 0,start_date text,end_date text,start_time text,end_time text,room_id text,created timestamptz DEFAULT now()-interval '1 day',updated timestamptz DEFAULT now()-interval '1 day');
 CREATE TABLE rule_nodes(rule_id text REFERENCES rules,node_id text REFERENCES nodes);
 CREATE TABLE telemetry(id text PRIMARY KEY,node_id text,temperature numeric,battery numeric,rotation_rpm numeric,rotation_quality text,observed_at timestamptz,interval_seconds numeric,boot_id text,sequence bigint,status text,event_type text);
 CREATE TABLE notifications(id text PRIMARY KEY,date text,time text,content text,triggered boolean,room_id text,rule_id text,node_id text,type text,event_key text UNIQUE);
 CREATE FUNCTION public.ecotrack_device_exchange(p_device_id text,p_token text,p_status jsonb,p_ack jsonb) RETURNS void LANGUAGE plpgsql AS $$
 DECLARE target text:=p_status->>'node_id';measured_t numeric:=(p_status->>'outlet_temperature_c')::numeric;measured_rpm numeric:=CASE WHEN p_status->>'rotation_quality' IN ('missing','fault') THEN NULL ELSE 0 END;rotation_quality text:='ok';measured_at timestamptz:=(p_status->>'observed_at')::timestamptz;
 BEGIN UPDATE public.nodes SET temp=measured_t,rotation_rpm=measured_rpm WHERE id=target; END $$;

 CREATE TABLE staff(id text PRIMARY KEY,name text,room_id text,is_archived boolean DEFAULT false,force_logout boolean DEFAULT false,status text DEFAULT 'Online');
 CREATE TABLE mobile_notifications(id text PRIMARY KEY,event_key text UNIQUE,staff_id text,staff_name text,is_broadcast boolean,title text,message text,type text,priority text,category text,aircon_name text,location text);
 INSERT INTO nodes(id,name,room_id) VALUES('n1','Lab controller','r1');INSERT INTO ecotrack_device_state VALUES('n1',now(),NULL);
 INSERT INTO staff(id,name,room_id) VALUES('assigned','Assigned','r1'),('foreign','Other room','r2');`);
 for(const name of ['20261026085912_cloud_rule_evidence_storage.sql','20261026090050_cloud_rule_measurement_processing.sql','20261026090112_cloud_rule_capability_and_legacy_delivery.sql']) await db.exec(fs.readFileSync('supabase/migrations/'+name,'utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/20261026091559_cloud_rule_notification_handoff_guard.sql','utf8'));
});
after(async()=>{if(db)await db.close();});
beforeEach(async()=>{await db.exec("DELETE FROM notifications;DELETE FROM mobile_notifications;DELETE FROM ecotrack_private.rule_evidence;DELETE FROM rule_nodes;DELETE FROM rules;DELETE FROM telemetry;UPDATE nodes SET room_id='r1',last_measurement_at=NULL;UPDATE ecotrack_device_state SET last_seen=clock_timestamp(),sleeping_until=NULL;INSERT INTO rules(id,type,condition,value,unit,duration) VALUES('r','temperature','above',28,'°C',0);");});
async function sample(secondsAgo=2,extra={}){const row={id:'sample-'+(++serial),node_id:'n1',temperature:30,rotation_rpm:0,rotation_quality:'ok',observed_at:new Date(Date.now()-secondsAgo*1000).toISOString(),interval_seconds:60,boot_id:'boot-1',sequence:serial,...extra};await db.query('INSERT INTO telemetry SELECT * FROM jsonb_populate_record(NULL::telemetry,$1::jsonb)',[JSON.stringify(row)]);return row;}
async function count(table='notifications'){return Number((await db.query('SELECT count(*) AS count FROM '+table)).rows[0].count);}

test('cloud ingestion creates one scoped desktop/mobile alert without a renderer',async()=>{
 const row=await sample();assert.equal(await count(),1);
 assert.deepEqual((await db.query('SELECT staff_id FROM mobile_notifications ORDER BY staff_id NULLS FIRST')).rows.map(x=>x.staff_id),[null,'assigned']);
 await sample(2,{observed_at:row.observed_at});assert.equal(await count(),1);
 await db.exec('DELETE FROM telemetry');const latest=(await db.query("SELECT * FROM nodes WHERE id='n1'")).rows[0];assert.equal(Number(latest.temp),30);assert.equal(new Date(latest.last_measurement_at).toISOString(),row.observed_at);
});
test('duration uses distinct continuous observations and repeated samples do not add time',async()=>{
 await db.exec("UPDATE rules SET duration=1");const first=await sample(90);assert.equal(await count(),0);
 await sample(2,{observed_at:first.observed_at});assert.equal(await count(),0);
 await sample(30);assert.equal(await count(),1);
});
test('gaps, missing measurements and newer normal readings reset evidence',async()=>{
 await db.exec("UPDATE rules SET duration=1");await sample(170);await sample(70);assert.equal(await count(),0);
 await sample(65,{temperature:null});await sample(60);await sample(5);assert.equal(await count(),0);
});
test('stale, future, sleeping, unassigned, disabled and foreign-target samples do not alert',async()=>{
 await sample(400);await sample(-20);assert.equal(await count(),0);
 await db.exec("UPDATE ecotrack_device_state SET sleeping_until=now()+interval '1 hour'");await sample();assert.equal(await count(),0);
 await db.exec("UPDATE ecotrack_device_state SET sleeping_until=NULL;UPDATE nodes SET room_id=NULL");await sample();assert.equal(await count(),0);
 await db.exec("UPDATE nodes SET room_id='r1';UPDATE rules SET enabled=false");await sample();assert.equal(await count(),0);
 await db.exec("UPDATE rules SET enabled=true;INSERT INTO nodes(id,name,room_id) VALUES('n2','Other','r1');INSERT INTO rule_nodes VALUES('r','n2')");await sample();assert.equal(await count(),0);
});
test('delayed samples cannot replace latest readings or resurrect cleared evidence',async()=>{
 await db.exec("UPDATE rules SET duration=1");await sample(90);await sample(30,{temperature:20});await sample(60);await sample(2);assert.equal(await count(),0);
 const latest=(await db.query("SELECT temp,last_measurement_at FROM nodes WHERE id='n1'")).rows[0];assert.equal(Number(latest.temp),30);
});
test('Fahrenheit, equality and overnight Singapore windows preserve rule semantics',async()=>{
 await db.exec("UPDATE rules SET condition='equals',value=86,unit='°F'");await sample();assert.equal(await count(),1);
 await db.exec("UPDATE rules SET start_time='20:00',end_time='06:00'");
 const check=async stamp=>(await db.query("SELECT ecotrack_private.rule_schedule_allows(r,$1::timestamptz) AS allowed FROM rules r",[stamp])).rows[0].allowed;
 assert.equal(await check('2026-10-26T21:00:00+08:00'),true);assert.equal(await check('2026-10-27T02:00:00+08:00'),true);assert.equal(await check('2026-10-27T12:00:00+08:00'),false);
});
test('internal evaluator/state are inaccessible to application roles',async()=>{
 for(const role of ['anon','authenticated']){await db.exec('SET ROLE '+role);await assert.rejects(db.query('SELECT * FROM ecotrack_private.rule_evidence'),/permission denied/);await assert.rejects(db.query('SELECT ecotrack_private.evaluate_cloud_rule_sample()'),/permission denied/);await db.exec('RESET ROLE');}
});

test('legacy exchanges cannot overwrite a newer persistent observation',async()=>{
 await sample(5);
 await db.query('SELECT public.ecotrack_device_exchange($1,$2,$3::jsonb,NULL)',['legacy','unused',JSON.stringify({node_id:'n1',outlet_temperature_c:10,observed_at:new Date(Date.now()-60000).toISOString(),report_id:'legacy-1'})]);
 assert.equal(Number((await db.query("SELECT temp FROM nodes WHERE id='n1'")).rows[0].temp),30);
});

test('legacy exchange preserves an explicit sensor fault',async()=>{
 await db.query('SELECT public.ecotrack_device_exchange($1,$2,$3::jsonb,NULL)',['legacy','unused',JSON.stringify({node_id:'n1',outlet_temperature_c:10,observed_at:new Date(Date.now()-1000).toISOString(),report_id:'legacy-2',rotation_quality:'fault'})]);
 assert.equal((await db.query("SELECT rotation_quality FROM nodes WHERE id='n1'")).rows[0].rotation_quality,'fault');
});

test('an older desktop or stale inventory cannot duplicate a cloud-owned rule event',async()=>{
 await sample();assert.equal(await count(),1);
 await db.exec("INSERT INTO notifications(id,date,time,content,rule_id,node_id,type) VALUES('old-desktop','2026-10-26','10:00','duplicate','r','n1','temperature')");
 assert.equal(await count(),1);
 await db.exec("UPDATE nodes SET last_measurement_report_id=NULL;INSERT INTO notifications(id,date,time,content,rule_id,node_id,type) VALUES('local-only','2026-10-26','10:00','local sensor','r','n1','temperature')");
 assert.equal(await count(),2);
});
