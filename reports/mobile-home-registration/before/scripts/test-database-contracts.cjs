const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

// Disposable, embedded PostgreSQL with a synthetic legacy schema. This exercises
// actual SQL/RLS but cannot certify the unidentified deployed desktop schema.
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const admin = '33333333-3333-4333-8333-333333333333';
const outsider = '44444444-4444-4444-8444-444444444444';
let db;
const fixture = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}');
create table auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claim.role',true) $$;
create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('sub',auth.uid(),'role',current_user,'session_id',auth.uid(),'iat',nullif(current_setting('request.jwt.claim.iat',true),'')::bigint) $$;
grant usage on schema auth to anon,authenticated,service_role;
grant execute on all functions in schema auth to anon,authenticated,service_role;
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean default false,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid,owner_id text,metadata jsonb);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name,'/') $$;
create table public.staff(id text primary key,name text,email text,phone text,password text,role text,status text default 'active',room_id text,room_name text,assignment text,is_online boolean default false,updated timestamptz,created timestamptz,avatar_url text);
create table public.administrators(id text primary key,username text,email text,password text,role text,status text default 'active',created timestamptz,updated timestamptz,avatar_url text);
create table public.buildings(id text primary key,name text,created timestamptz,updated timestamptz);
create table public.floors(id text primary key,name text,building_id text,created timestamptz,updated timestamptz);
create table public.rooms(id text primary key,name text,floor_id text,node_limit integer,created timestamptz,updated timestamptz);
create table public.nodes(id text primary key,name text,room_id text,aircon_type text,brand text,mac_address text,ip_address text,wifi_ssid text,protocol_name text,status text,install_date text,wake_time text,sleep_time text,interval_val numeric,interval_unit text,created timestamptz,updated timestamptz);
create table public.aircons(id text primary key default gen_random_uuid()::text,asset_tag text unique,brand text,model text,aircon_type text,room_id text,node_id text,protocol text,protocol_name text,status text,created_at timestamptz default now(),updated_at timestamptz default now());
create table public.telemetry(id text primary key,node_id text,temperature numeric,status text,created timestamptz default clock_timestamp());
create table public.maintenance_reports(id text primary key,staff_name text,aircon_id text,aircon_name text,aircon_type text,room_id text,room_name text,due_date text,description text,type text,priority text,status text,tasks jsonb,issue jsonb,timeline jsonb default '[]',parent_report_id text,linked_repair_id text,verification_remarks text,created timestamptz default now(),updated timestamptz default now());
create table public.mobile_notifications(id text primary key,staff_id text,staff_name text default 'All Staff',title text not null,message text not null,type text not null default 'task_reminder',priority text not null default 'medium',category text not null default 'maintenance',related_report_id text,aircon_id text,aircon_name text,location text,due_date text,is_read boolean default false,is_snoozed boolean default false,snooze_until timestamptz,created_at timestamptz default now(),updated_at timestamptz default now());
create table public.notifications(id text primary key,content text,type text,created timestamptz,read boolean default false);
grant usage on schema public,storage to anon,authenticated;
grant all on all tables in schema public,storage to anon,authenticated;
insert into public.rooms(id,name) values ('r1','Room One'),('r2','Room Two');
insert into public.staff(id,name,email,room_id) values ('s1','Alice','alice@example.test','r1'),('s2','Bob','bob@example.test','r2');
insert into public.administrators(id,username,email,role) values ('a1','Admin','admin@example.test','admin');
insert into auth.users(id,email) values ('${alice}','alice@example.test'),('${bob}','bob@example.test'),('${admin}','admin@example.test'),('${outsider}','outsider@example.test');
`;

async function owner(sql,params=[]) {
  await db.exec('reset role');
  return db.query(sql,params);
}
async function asUser(id,sql,params=[]) {
  await db.exec('reset role');
  if(id)await db.query("insert into auth.sessions(id,user_id,created_at) values($1,$1,clock_timestamp()+interval '1 hour') on conflict do nothing",[id]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);
  await db.query("select set_config('request.jwt.claim.role',$1,false)",[id?'authenticated':'anon']);
  await db.query("select set_config('request.jwt.claim.iat',$1,false)",[String(Math.floor(Date.now()/1000)+2)]);
  await db.exec(id ? 'set role authenticated' : 'set role anon');
  return db.query(sql,params);
}
async function rpc(id,name,args=[],casts=[]) {
  return (await asUser(id,`select public.${name}(${args.map((_,i)=>`$${i+1}${casts[i]?'::'+casts[i]:''}`).join(',')}) as result`,args)).rows[0].result;
}

before(async()=>{
  db=new PGlite();
  await db.exec(fixture);
  const migrations=fs.readdirSync('supabase/migrations').filter(n=>n.endsWith('.sql')).sort();
  assert.ok(migrations.some(n=>n.startsWith('202609300001')),'Authentication migration is required');
  for (const name of migrations) await db.exec(fs.readFileSync(path.join('supabase/migrations',name),'utf8'));
  await owner('update public.staff set auth_user_id = case id when $1 then $2::uuid else $3::uuid end',['s1',alice,bob]);
  await owner('update public.administrators set auth_user_id=$1::uuid where id=$2',[admin,'a1']);
});
after(async()=>{ await db?.close(); });

test('profile identity comes from Auth and plaintext credentials are unreadable',async()=>{
  const profile=await rpc(alice,'ecotrack_my_profile');
  assert.equal(profile.id,'s1'); assert.equal(profile.authUserId,alice);
  assert.equal(profile.userType,'staff'); assert.equal(profile.password,undefined);
  await assert.rejects(asUser(alice,'select password from public.staff'),/permission denied/);
  await assert.rejects(asUser(admin,'select password from public.administrators'),/permission denied/);
  assert.equal((await asUser(alice,"update public.staff set role='admin' where id='s1' returning id")).rows.length,0);
  await assert.rejects(rpc(outsider,'ecotrack_my_profile'),/Active account/);
  await owner("update public.staff set force_logout=true where id='s1'");
  await assert.rejects(rpc(alice,'ecotrack_my_profile'),/Active account/);
  await owner("update public.staff set force_logout=false where id='s1'");
});

test('clearing forced logout does not revive a previously issued token',async()=>{
  const oldIssued=Math.floor(Date.now()/1000)-10;
  await asUser(bob,'select 1');
  await owner("update auth.sessions set created_at=clock_timestamp()-interval '1 minute' where user_id=$1",[bob]);
  await owner("update public.staff set force_logout=true where id='s2'");
  await owner("update public.staff set force_logout=false where id='s2'");
  await asUser(bob,'select 1');
  await db.query("select set_config('request.jwt.claim.iat',$1,false)",[String(oldIssued)]);
  await assert.rejects(db.query('select public.ecotrack_my_profile()'),/Active account/);
  assert.equal((await db.query('select public.ecotrack_staff_id() id')).rows[0].id,null);
  // A refresh updates JWT issuance but keeps the original, revoked session.
  await assert.rejects(rpc(bob,'ecotrack_my_profile'),/Active account/);
  await owner("update auth.sessions set created_at=clock_timestamp()+interval '1 hour' where user_id=$1",[bob]);
  assert.equal((await rpc(bob,'ecotrack_my_profile')).id,'s2');
});

test('public signup cannot claim an existing account or request an admin role',async()=>{
  const newId='55555555-5555-4555-8555-555555555555';
  await owner('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[newId,'new@example.test',{full_name:'New Worker',phone:'09123456789',role:'admin',ecotrack_profile_id:'a1',ecotrack_account_type:'admin'}]);
  const p=await rpc(newId,'ecotrack_my_profile');
  assert.equal(p.userType,'staff'); assert.equal(p.assignment,'Unassigned');
  await assert.rejects(owner('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',['66666666-6666-4666-8666-666666666666','admin@example.test',{full_name:'Admin',phone:'09876543210'}]),/already exists/);
  await assert.rejects(owner('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',['66666666-6666-4666-8666-666666666666','alice@example.test',{full_name:'Impersonator',phone:'09876543210'}]),/unique/);
  await assert.rejects(owner('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',['66666666-6666-4666-8666-666666666666','another@example.test',{full_name:'Duplicate',phone:'+09 123 456 789'}]),/unique/);
});

test('Auth provisioning reads trusted app metadata applied after insertion in the same transaction',async()=>{
  const id='77777777-7777-4777-8777-777777777777';
  await owner("insert into public.staff(id,name,email,phone) values('stf_delayed_metadata','Provisioned','provisioned@example.test','09111222333')");
  await owner('select 1');
  await db.transaction(async tx=>{
    await tx.query('insert into auth.users(id,email) values($1,$2)',[id,'provisioned@example.test']);
    await tx.query('update auth.users set raw_app_meta_data=$1 where id=$2',[{ecotrack_profile_id:'stf_delayed_metadata',ecotrack_account_type:'staff'},id]);
  });
  assert.equal((await owner("select auth_user_id from public.staff where id='stf_delayed_metadata'")).rows[0].auth_user_id,id);
  assert.equal((await rpc(id,'ecotrack_my_profile')).id,'stf_delayed_metadata');
});

test('private storage guards survive legacy allow-all policies without breaking unrelated buckets',async()=>{
  await owner('create policy legacy_allow_all on storage.objects for all to anon,authenticated using(true) with check(true)');
  const owned=`${alice}/avatar.png`,foreign=`${bob}/avatar.png`;
  await asUser(alice,'insert into storage.objects(bucket_id,name) values($1,$2)',['avatars',owned]);
  await assert.rejects(asUser(alice,'insert into storage.objects(bucket_id,name) values($1,$2)',['avatars',foreign]),/row-level security/);
  await assert.rejects(asUser(null,'insert into storage.objects(bucket_id,name) values($1,$2)',['avatars','public.png']),/row-level security/);
  assert.equal((await asUser(bob,'select * from storage.objects where name=$1',[owned])).rows.length,0);
  assert.equal((await asUser(null,'select * from storage.objects where name=$1',[owned])).rows.length,0);
  assert.equal((await asUser(alice,'update storage.objects set name=$1 where name=$2 returning id',[`${alice}/changed.png`,owned])).rows.length,0);
  await asUser(null,"insert into storage.objects(bucket_id,name) values('other-app','legacy.txt')");
  assert.equal((await asUser(null,"select * from storage.objects where bucket_id='other-app'")).rows.length,1);
  const profile=await rpc(alice,'ecotrack_update_profile',['Alice','09111111111','custom',`storage://avatars/${owned}`]);
  assert.equal(profile.photoUrl,`storage://avatars/${owned}`);
  await assert.rejects(rpc(alice,'ecotrack_update_profile',['Alice','09111111111','custom',`storage://avatars/${foreign}`]),/owned storage/);
  await assert.rejects(rpc(alice,'ecotrack_update_profile',['Alice','09111111111','custom',`storage://avatars/${alice}/missing.png`]),/owned storage/);
});

test('new checklist photos must exist and belong to the submitting Auth subject',async()=>{
  await owner("insert into public.maintenance_reports(id,staff_id,status,tasks) values('MR-PHOTO','s1','In Progress',$1)",[[{id:'t1',status:'Not Started'}]]);
  const version=(await owner("select updated::text as v from public.maintenance_reports where id='MR-PHOTO'")).rows[0].v;
  const bad=`storage://maintenance-photos/${bob}/proof.png`;
  await owner('insert into storage.objects(bucket_id,name) values($1,$2)',['maintenance-photos',`${bob}/proof.png`]);
  const task={id:'t1',status:'Completed',photoUri:bad,photoUris:[bad]};
  await assert.rejects(rpc(alice,'ecotrack_update_maintenance_report',['MR-PHOTO',version,'foreign-photo','In Progress',[task]],['text','timestamptz','text','text','jsonb']),/private storage/);
  const own=`storage://maintenance-photos/${alice}/proof.png`;
  await asUser(alice,'insert into storage.objects(bucket_id,name) values($1,$2)',['maintenance-photos',`${alice}/proof.png`]);
  assert.equal((await rpc(alice,'ecotrack_update_maintenance_report',['MR-PHOTO',version,'owned-photo','In Progress',[{...task,photoUri:own,photoUris:[own]}]],['text','timestamptz','text','text','jsonb'])).success,true);
});

test('historical submitted repairs move parent items to verification once without approval',async()=>{
  await owner("insert into public.maintenance_reports(id,staff_id,status,tasks) values('MR-OLD','s1','Under Repair',$1)",[[{id:'old-task',status:'Under Repair',linkedRepairId:'REP-OLD'}]]);
  await owner("insert into public.maintenance_reports(id,staff_id,status,parent_report_id,tasks) values('REP-OLD','s2','For Verification','MR-OLD',$1)",[[{id:'fix',status:'Completed'}]]);
  await owner('select 1');
  await db.exec(fs.readFileSync('supabase/migrations/202609300005_submitted_repair_backfill.sql','utf8'));
  const first=(await owner("select status,tasks,updated::text as version from public.maintenance_reports where id='MR-OLD'")).rows[0];
  assert.equal(first.status,'For Verification');assert.equal(first.tasks[0].status,'For Verification');assert.equal(first.tasks[0].verified,false);
  await db.exec(fs.readFileSync('supabase/migrations/202609300005_submitted_repair_backfill.sql','utf8'));
  const again=(await owner("select updated::text as version from public.maintenance_reports where id='MR-OLD'")).rows[0];
  assert.equal(first.version,again.version);
});

test('unmapped and anonymous identities cannot list notifications',async()=>{
  await assert.rejects(rpc(null,'ecotrack_list_notifications'));
  await assert.rejects(rpc(outsider,'ecotrack_list_notifications'),/Authenticated profile required/);
});

test('broadcast read, snooze and archive state stay isolated per authenticated recipient',async()=>{
  const id=await rpc(admin,'ecotrack_create_notification',[{event_key:'broadcast:1',is_broadcast:true,title:'Shared',message:'For everyone'}],['jsonb']);
  assert.equal(await rpc(alice,'ecotrack_set_notification_state',[[id],'read',null],['text[]','text','integer']),1);
  assert.equal(await rpc(alice,'ecotrack_set_notification_state',[[id],'snooze',60],['text[]','text','integer']),1);
  const a=await rpc(alice,'ecotrack_list_notifications');
  const b=await rpc(bob,'ecotrack_list_notifications');
  assert.equal(a.items.find(n=>n.id===id).is_read,true);
  assert.equal(a.items.find(n=>n.id===id).is_snoozed,true);
  assert.equal(b.items.find(n=>n.id===id).is_read,false);
  assert.equal(b.items.find(n=>n.id===id).is_snoozed,false);
  await rpc(alice,'ecotrack_set_notification_state',[[id],'archive',null],['text[]','text','integer']);
  assert.ok(!(await rpc(alice,'ecotrack_list_notifications')).items.some(n=>n.id===id));
  assert.ok((await rpc(bob,'ecotrack_list_notifications')).items.some(n=>n.id===id));
  const raw=(await owner('select is_read,is_snoozed from public.mobile_notifications where id=$1',[id])).rows[0];
  assert.deepEqual(raw,{is_read:false,is_snoozed:false});
});

test('staff cannot read or mutate another recipient, even when names change',async()=>{
  const id=await rpc(admin,'ecotrack_create_notification',[{event_key:'alice:1',staff_id:'s1',title:'Private',message:'Only Alice'}],['jsonb']);
  await owner("update public.staff set name='Renamed Alice' where id='s1'");
  assert.ok((await rpc(alice,'ecotrack_list_notifications')).items.some(n=>n.id===id));
  assert.ok(!(await rpc(bob,'ecotrack_list_notifications')).items.some(n=>n.id===id));
  await assert.rejects(rpc(bob,'ecotrack_set_notification_state',[[id],'archive',null],['text[]','text','integer']),/missing or inaccessible/);
  await assert.rejects(asUser(alice,'delete from public.mobile_notifications where id=$1',[id]),/permission denied/);
});

test('a mixed authorized/unauthorized bulk selection is rejected without partial state writes',async()=>{
  const shared=await rpc(admin,'ecotrack_create_notification',[{event_key:'shared:atomic',is_broadcast:true,title:'Shared',message:'Atomic'}],['jsonb']);
  const privateId=await rpc(admin,'ecotrack_create_notification',[{event_key:'bob:atomic',staff_id:'s2',title:'Private',message:'Atomic'}],['jsonb']);
  await assert.rejects(rpc(alice,'ecotrack_set_notification_state',[[shared,privateId],'archive',null],['text[]','text','integer']),/missing or inaccessible/);
  assert.ok((await rpc(alice,'ecotrack_list_notifications')).items.some(n=>n.id===shared));
  assert.equal((await owner('select count(*)::int n from public.mobile_notification_state where notification_id=$1',[shared])).rows[0].n,0);
});

test('notification retry is idempotent and rejects altered event content',async()=>{
  const payload={event_key:'retry:1',staff_id:'s1',title:'Retry',message:'Once'};
  const first=await rpc(admin,'ecotrack_create_notification',[payload],['jsonb']);
  assert.equal(await rpc(admin,'ecotrack_create_notification',[payload],['jsonb']),first);
  await assert.rejects(rpc(admin,'ecotrack_create_notification',[{...payload,priority:'critical'}],['jsonb']),/different content/);
  await assert.rejects(rpc(alice,'ecotrack_create_notification',[{...payload,event_key:'forged'}],['jsonb']),/Administrator required/);
});

test('keyset pagination returns each tied-timestamp event once and filters archived items',async()=>{
  for(let i=0;i<5;i++) await rpc(admin,'ecotrack_create_notification',[{event_key:`page:${i}`,staff_id:'s2',title:'Page',message:String(i)}],['jsonb']);
  await owner("update public.mobile_notifications set created_at='2026-09-30T01:00:00Z' where event_key like 'manual:page:%'");
  let cursor=null,seen=new Set();
  do {
    const page=await rpc(bob,'ecotrack_list_notifications',[2,cursor?.created_at||null,cursor?.id||null],['integer','timestamptz','text']);
    for(const item of page.items) { assert.ok(!seen.has(item.id)); seen.add(item.id); }
    cursor=page.next_cursor;
  } while(cursor);
  const expected=(await owner("select id from public.mobile_notifications where event_key like 'manual:page:%'")).rows;
  assert.ok(expected.every(row=>seen.has(row.id)));
});

test('mark-all updates broadcasts only for the current user and preserves snooze',async()=>{
  const id=await rpc(admin,'ecotrack_create_notification',[{event_key:'mark-all',is_broadcast:true,title:'All',message:'Read'}],['jsonb']);
  await rpc(alice,'ecotrack_set_notification_state',[[id],'snooze',30],['text[]','text','integer']);
  await rpc(alice,'ecotrack_mark_all_notifications_read');
  const a=(await rpc(alice,'ecotrack_list_notifications')).items.find(n=>n.id===id);
  const b=(await rpc(bob,'ecotrack_list_notifications')).items.find(n=>n.id===id);
  assert.equal(a.is_read,true); assert.equal(a.is_snoozed,true); assert.equal(b.is_read,false);
});

async function seedReport(id,options={}) {
  const tasks=options.tasks||[{id:'1',name:'Filter',status:'Not Started'}];
  await owner(`insert into public.maintenance_reports(id,staff_id,staff_name,status,tasks,parent_report_id,type,updated)
    values ($1,$2,$3,$4,$5::jsonb,$6,$7,$8::timestamptz)`,[
    id,options.staffId||'s1',options.staffName||'Renamed Alice',options.status||'Pending',JSON.stringify(tasks),
    options.parent||null,options.type||'Preventive Maintenance','2026-09-30T00:00:00Z',
  ]);
}
const taskInput=(status='Completed')=>[{id:'1',status,notes:'',problemDescription:'',photoUri:null,photoUris:[]}];
const version='2026-09-30T00:00:00Z';
async function updateReport(user,id,op,status='In Progress',tasks=taskInput(),expected=version) {
  return rpc(user,'ecotrack_update_maintenance_report',[id,expected,op,status,tasks],['text','timestamptz','text','text','jsonb']);
}

test('maintenance uses original screen version and idempotent operation keys',async()=>{
  await seedReport('MR-version');
  const result=await updateReport(alice,'MR-version','edit-1');
  assert.equal(result.success,true);
  assert.equal(result.status,'For Verification');
  assert.deepEqual(await updateReport(alice,'MR-version','edit-1'),result);
  const row=(await owner("select timeline,updated::text from public.maintenance_reports where id='MR-version'")).rows[0];
  assert.equal(row.timeline.length,1);
  await assert.rejects(updateReport(alice,'MR-version','stale-edit'),error=>error.code==='40001');
  await assert.rejects(updateReport(alice,'MR-version','edit-1','In Progress',taskInput('In Progress')),error=>error.code==='22023');
  assert.equal((await owner("select timeline from public.maintenance_reports where id='MR-version'")).rows[0].timeline.length,1);
  assert.equal((await owner("select count(*)::int n from public.mobile_notifications where related_report_id='MR-version'")).rows[0].n,2);
});

test('maintenance rejects foreign staff, self approval and direct writes',async()=>{
  await seedReport('MR-access');
  await assert.rejects(updateReport(bob,'MR-access','foreign'),error=>error.code==='42501');
  await assert.rejects(updateReport(null,'MR-access','anon'),error=>error.code==='42501');
  await assert.rejects(updateReport(alice,'MR-access','approve','Completed'),error=>error.code==='22023');
  await assert.rejects(updateReport(alice,'MR-access','forged-link','Under Repair',taskInput('Under Repair')),error=>error.code==='22023');
  await assert.rejects(asUser(alice,"update public.maintenance_reports set status='Completed' where id='MR-access'"),/permission denied/);
  await assert.rejects(rpc(alice,'ecotrack_verify_maintenance',['MR-access',version,'verify-forged',true,null],['text','timestamptz','text','boolean','text']),error=>error.code==='42501');
  assert.equal((await owner("select status from public.maintenance_reports where id='MR-access'")).rows[0].status,'Pending');
});

test('repair submission and administrator approval synchronize child and parent atomically',async()=>{
  await seedReport('MR-parent',{staffId:'s2',status:'Under Repair',tasks:[{id:'1',name:'Filter',status:'Under Repair',linkedRepairId:'REP-child'}]});
  await seedReport('REP-child',{parent:'MR-parent',type:'Corrective Repair',status:'In Progress',tasks:[{id:'1',name:'Repair Filter',status:'Completed'}]});
  const result=await rpc(alice,'ecotrack_submit_repair',['REP-child',version,'submit-child'],['text','timestamptz','text']);
  assert.equal(result.status,'For Verification');
  let parent=(await owner("select * from public.maintenance_reports where id='MR-parent'")).rows[0];
  assert.equal(parent.tasks[0].status,'For Verification');
  assert.equal(parent.tasks[0].repaired,false);
  assert.equal(parent.tasks[0].verified,false);
  await assert.rejects(rpc(admin,'ecotrack_verify_maintenance',['MR-parent',result.parentUpdated,'premature-parent',true,null],['text','timestamptz','text','boolean','text']),/Approve every linked/);
  const approved=await rpc(admin,'ecotrack_verify_maintenance',['REP-child',result.updated,'approve-child',true,'Passed inspection'],['text','timestamptz','text','boolean','text']);
  assert.equal(approved.status,'Completed');
  parent=(await owner("select * from public.maintenance_reports where id='MR-parent'")).rows[0];
  assert.equal(parent.tasks[0].status,'Completed');
  assert.equal(parent.tasks[0].repaired,true);
  assert.equal(parent.status,'For Verification');
});

test('missing parent checklist relationship rolls back report, history and event writes',async()=>{
  await seedReport('MR-unlinked',{status:'Under Repair',tasks:[{id:'different',name:'Unrelated',status:'Under Repair'}]});
  await seedReport('REP-unlinked',{parent:'MR-unlinked',type:'Corrective Repair',status:'In Progress',tasks:[{id:'1',name:'Repair',status:'Completed'}]});
  await assert.rejects(rpc(alice,'ecotrack_submit_repair',['REP-unlinked',version,'bad-link'],['text','timestamptz','text']),/explicit parent checklist link/);
  const child=(await owner("select status,timeline from public.maintenance_reports where id='REP-unlinked'")).rows[0];
  assert.equal(child.status,'In Progress'); assert.equal(child.timeline.length,0);
  assert.equal((await owner("select count(*)::int n from public.mobile_notifications where related_report_id='REP-unlinked'")).rows[0].n,1);
  assert.equal((await owner("select count(*)::int n from public.ecotrack_maintenance_operations where operation_id='bad-link'")).rows[0].n,0);
});

test('administrator rejection moves submitted repair and its parent back into repair',async()=>{
  await seedReport('MR-reject',{status:'Under Repair',tasks:[{id:'1',status:'Under Repair',linkedRepairId:'REP-reject'}]});
  await seedReport('REP-reject',{parent:'MR-reject',type:'Corrective Repair',status:'In Progress',tasks:[{id:'1',status:'Completed'}]});
  const submitted=await rpc(alice,'ecotrack_submit_repair',['REP-reject',version,'submit-reject'],['text','timestamptz','text']);
  const rejected=await rpc(admin,'ecotrack_verify_maintenance',['REP-reject',submitted.updated,'reject-child',false,'Still leaking'],['text','timestamptz','text','boolean','text']);
  assert.equal(rejected.status,'In Progress');
  const parent=(await owner("select tasks from public.maintenance_reports where id='MR-reject'")).rows[0];
  assert.equal(parent.tasks[0].status,'Under Repair');
  assert.equal(parent.tasks[0].repaired,false);
});

async function device(user,operation,id,payload={}) {
  return rpc(user,'ecotrack_device_mutation',[operation,id,payload],['text','text','jsonb']);
}

test('device transaction enforces immutable room access and rejects fabricated hardware state',async()=>{
  await assert.rejects(device(null,'save_node','node-anon',{name:'Anon',room_id:'r1'}),error=>error.code==='42501');
  await assert.rejects(device(alice,'save_node','node-foreign',{name:'Foreign',room_id:'r2'}),error=>error.code==='42501');
  await assert.rejects(device(alice,'save_node','node-null',{name:'Null',room_id:null}),error=>error.code==='42501');
  await assert.rejects(device(alice,'save_node','node-custom',{name:'Custom',room_id:'custom:Forbidden new room'}),error=>error.code==='42501');
  await assert.rejects(device(alice,'save_node','node-forged',{name:'Forged',room_id:'r1',status:'online'}),/Unsupported device fields/);
  assert.equal((await owner('select count(*)::int n from public.nodes')).rows[0].n,0);
});

test('node creation, rename and deletion preserve synchronized AC inventory',async()=>{
  const saved=await device(alice,'save_node','node-one',{name:'Node One',room_id:'r1',brand:'Daikin',aircon_type:'Split',asset_tag:'AC-one'});
  assert.equal(saved.node.id,'node-one'); assert.equal(saved.aircon.controller_node_id,'node-one');
  await device(alice,'update_node','node-one',{name:'Renamed Node'});
  const renamed=(await owner("select node_id,controller_node_id from public.aircons where asset_tag='AC-one'")).rows[0];
  assert.deepEqual(renamed,{node_id:'Renamed Node',controller_node_id:'node-one'});
  await assert.rejects(asUser(alice,"update public.nodes set name='Bypass' where id='node-one'"),/permission denied/);
  await device(alice,'delete_node','node-one');
  const detached=(await owner("select node_id,controller_node_id,status from public.aircons where asset_tag='AC-one'")).rows[0];
  assert.deepEqual(detached,{node_id:null,controller_node_id:null,status:'offline'});
});

test('late asset conflict rolls back newly created node and custom room',async()=>{
  await assert.rejects(device(admin,'save_node','node-rollback',{name:'Rollback',room_id:'custom:Rollback Room',brand:'Brand',asset_tag:'AC-one'}),/asset tag is already registered/);
  assert.equal((await owner("select count(*)::int n from public.nodes where id='node-rollback'")).rows[0].n,0);
  assert.equal((await owner("select count(*)::int n from public.rooms where name='Rollback Room'")).rows[0].n,0);
  await assert.rejects(device(alice,'save_aircon','AC-phantom',{brand:'Brand',room_id:'r1',node_id:'missing'}),/exactly one registered controller/);
  assert.equal((await owner("select count(*)::int n from public.aircons where asset_tag='AC-phantom'")).rows[0].n,0);
});

test('desktop staff listing is administrator-only and excludes credentials',async()=>{
  const rows=await rpc(admin,'ecotrack_admin_list_staff');
  assert.ok(rows.some(row=>row.id==='s1'));
  assert.ok(rows.every(row=>!Object.hasOwn(row,'password')));
  await assert.rejects(rpc(alice,'ecotrack_admin_list_staff'),error=>error.code==='42501');
  await assert.rejects(asUser(null,'select id from public.staff'),/permission denied/);
});

test('desktop save is versioned, idempotent and preserves worker proofs',async()=>{
  const record={id:'desktop-contract-report',staff_id:'s1',room_id:'r1',status:'Pending',tasks:[{id:'filter',name:'Filter',status:'Completed'}],description:'Inspect'};
  const casts=['jsonb','timestamptz','timestamptz','text','boolean'];
  await assert.rejects(rpc(alice,'ecotrack_admin_save_report',[record,null,null,'desktop-create',true],casts),error=>error.code==='42501');
  const created=await rpc(admin,'ecotrack_admin_save_report',[record,null,null,'desktop-create',true],casts);
  assert.equal(created.report.tasks[0].status,'Not Started');
  assert.deepEqual(await rpc(admin,'ecotrack_admin_save_report',[record,null,null,'desktop-create',true],casts),created);
  const edited={...record,description:'Revised',type:'Control Maintenance',room_id:'r2',room_name:'Room Two',tasks:[{id:'filter',name:'Renamed filter',status:'Completed',photoUri:'forged'},{id:'new-task',name:'New task',status:'Completed'}]};
  const result=await rpc(admin,'ecotrack_admin_save_report',[edited,created.report.updated,null,'desktop-edit',false],casts);
  assert.equal(result.report.description,'Revised'); assert.equal(result.report.tasks[0].status,'Not Started'); assert.equal(result.report.tasks[0].photoUri,undefined);
  assert.equal(result.report.type,'Control Maintenance');assert.equal(result.report.room_id,'r2');
  assert.equal(result.report.tasks[0].name,'Renamed filter');assert.equal(result.report.tasks[1].status,'Not Started');
  await assert.rejects(rpc(admin,'ecotrack_admin_save_report',[edited,created.report.updated,null,'desktop-stale',false],casts),error=>error.code==='40001');
  await assert.rejects(asUser(admin,"update public.maintenance_reports set status='Completed' where id='desktop-contract-report'"),/permission denied/);
});

test('desktop edits retain evidence and reject removing progressed tasks',async()=>{
  await owner("insert into public.maintenance_reports(id,staff_id,status,tasks) values('desktop-proof-edit','s1','In Progress',$1)",[[{id:'proof',name:'Inspect',status:'Completed',photoUri:'storage://maintenance-photos/proof',verified:false},{id:'unused',name:'Unused',status:'Not Started'}]]);
  const version=(await owner("select updated::text v from public.maintenance_reports where id='desktop-proof-edit'")).rows[0].v;
  const record={id:'desktop-proof-edit',staff_id:'s1',tasks:[{id:'proof',name:'Inspect filter',status:'Not Started'}]};
  const casts=['jsonb','timestamptz','timestamptz','text','boolean'];
  const result=await rpc(admin,'ecotrack_admin_save_report',[record,version,null,'desktop-proof-rename',false],casts);
  assert.equal(result.report.tasks.length,1);assert.equal(result.report.tasks[0].photoUri,'storage://maintenance-photos/proof');
  assert.equal(result.report.tasks[0].status,'Completed');
  await assert.rejects(rpc(admin,'ecotrack_admin_save_report',[{...record,tasks:[{id:'replacement',name:'Replacement'}]},result.report.updated,null,'desktop-proof-remove',false],casts),/must be retained/);
});

test('desktop checklist progress uses the validated workflow without overwriting evidence',async()=>{
  await owner("insert into public.maintenance_reports(id,staff_id,status,tasks) values('desktop-progress','s1','Pending',$1)",[[{id:'step',name:'Inspect',status:'Not Started',photoUri:null,photoUris:[]}]]);
  const version=(await owner("select updated::text v from public.maintenance_reports where id='desktop-progress'")).rows[0].v;
  const record={id:'desktop-progress',staff_id:'s1',status:'In Progress',update_progress:true,tasks:[{id:'step',name:'Inspect',status:'In Progress',notes:'Working'}]};
  const casts=['jsonb','timestamptz','timestamptz','text','boolean'];
  const result=await rpc(admin,'ecotrack_admin_save_report',[record,version,null,'desktop-progress-begin',false],casts);
  assert.equal(result.report.tasks[0].status,'In Progress');assert.equal(result.report.status,'In Progress');
  await assert.rejects(rpc(admin,'ecotrack_admin_save_report',[{...record,tasks:[{...record.tasks[0],photoUri:'storage://maintenance-photos/foreign/new'}]},result.report.updated,null,'desktop-progress-forged',false],casts),/private storage/);
});

test('desired AC commands enforce room access and preserve configured protocol',async()=>{
  await owner("insert into public.aircons(id,asset_tag,room_id,protocol,status) values('intent-ac','INTENT','r1','DAIKIN2','offline')");
  const state={power:'on',temp:23,mode:'cool',fan:'auto'};
  await assert.rejects(rpc(bob,'ecotrack_set_aircon_intent',['intent-ac',state],['text','jsonb']),error=>error.code==='42501');
  await assert.rejects(rpc(alice,'ecotrack_set_aircon_intent',['intent-ac',{...state,status:'online'}],['text','jsonb']),/Invalid controller state/);
  await rpc(alice,'ecotrack_set_aircon_intent',['intent-ac',state,'DAIKIN2'],['text','jsonb','text']);
  const row=(await owner("select desired_state,protocol,protocol_name,status from public.aircons where id='intent-ac'")).rows[0];
  assert.deepEqual(row,{desired_state:state,protocol:'DAIKIN2',protocol_name:'DAIKIN2',status:'offline'});
});

test('telemetry snapshots retain mode/fan and stale acknowledgements cannot settle a newer command',async()=>{
  await owner("insert into public.nodes(id,name,room_id) values('state-node','State Node','r1')");
  await owner("insert into public.aircons(id,asset_tag,room_id,node_id,controller_node_id) values('state-ac','STATE','r1','State Node','state-node')");
  const quiet={power:'on',temp:24,mode:'cool',fan:'quiet'};
  const first=await rpc(alice,'ecotrack_set_aircon_intent',['state-ac',quiet],['text','jsonb']);
  assert.equal(first.command_status,'queued'); assert.ok(first.command_id);
  await owner("insert into public.telemetry(id,node_id,temperature) values('state-queued','state-node',30)");
  await assert.rejects(rpc(bob,'ecotrack_ack_aircon_intent',['state-ac',first.command_id,'transmitted'],['text','uuid','text']),error=>error.code==='42501');
  await rpc(alice,'ecotrack_ack_aircon_intent',['state-ac',first.command_id,'transmitted'],['text','uuid','text']);
  await owner("insert into public.telemetry(id,node_id,temperature) values('state-transmitted','State Node',27)");
  let rows=(await owner("select id,aircon_id,control_snapshot from public.telemetry where id like 'state-%' order by id")).rows;
  assert.equal(rows[0].aircon_id,'state-ac'); assert.deepEqual(rows[0].control_snapshot.desired_state,quiet);
  assert.equal(rows[0].control_snapshot.command_status,'queued'); assert.equal(rows[1].control_snapshot.command_status,'transmitted');
  const next=await rpc(alice,'ecotrack_set_aircon_intent',['state-ac',{...quiet,mode:'fan',fan:'high'}],['text','jsonb']);
  await assert.rejects(rpc(alice,'ecotrack_ack_aircon_intent',['state-ac',first.command_id,'failed'],['text','uuid','text']),error=>error.code==='40001');
  await rpc(alice,'ecotrack_ack_aircon_intent',['state-ac',next.command_id,'failed'],['text','uuid','text']);
  rows=(await owner("select control_snapshot from public.telemetry where id='state-transmitted'")).rows;
  assert.deepEqual(rows[0].control_snapshot.desired_state,quiet,'Existing log snapshots are not rewritten');
  await assert.rejects(asUser(admin,"update public.aircons set reported_state='{}' where id='state-ac'"),/permission denied/);
});

test('late, unmatched and ambiguous telemetry never borrow current settings from another unit',async()=>{
  await owner("insert into public.telemetry(id,node_id,created) values('state-old','state-node','2025-01-01T00:00:00Z'),('state-unmatched','other-node',clock_timestamp())");
  let rows=(await owner("select id,aircon_id,control_snapshot from public.telemetry where id in ('state-old','state-unmatched') order by id")).rows;
  assert.deepEqual(rows[0].control_snapshot,{}); assert.equal(rows[1].control_snapshot,null); assert.equal(rows[1].aircon_id,null);
  await owner("insert into public.aircons(id,asset_tag,room_id,node_id,controller_node_id) values('state-duplicate','STATE-DUP','r1','State Node','state-node')");
  await owner("insert into public.telemetry(id,node_id) values('state-ambiguous','state-node')");
  assert.equal((await owner("select control_snapshot from public.telemetry where id='state-ambiguous'")).rows[0].control_snapshot,null);
  await owner("delete from public.aircons where id='state-duplicate'");
});

test('actual operating feedback requires ingestion authority and older feedback cannot overwrite it',async()=>{
  const state={power:'on',mode:'cool',fan:'quiet',compressor_active:true};
  await assert.rejects(rpc(admin,'ecotrack_report_aircon_state',['state-ac',state,new Date().toISOString()],['text','jsonb','timestamptz']),error=>error.code==='42501');
  await owner('select 1');
  await db.query("select set_config('request.jwt.claim.role','service_role',false)");
  await db.exec('set role service_role');
  await db.query('select public.ecotrack_report_aircon_state($1,$2::jsonb,clock_timestamp())',['state-ac',state]);
  await db.query("select public.ecotrack_report_aircon_state($1,$2::jsonb,'2025-01-01T00:00:00Z')",['state-ac',{power:'off'}]);
  await owner("insert into public.telemetry(id,node_id) values('state-feedback','state-node')");
  assert.deepEqual((await owner("select control_snapshot from public.telemetry where id='state-feedback'")).rows[0].control_snapshot.reported_state,state);
});

test('remote push binds Auth recipients, preferences, leases and logout cleanup',async()=>{
  const token='ExpoPushToken[synthetic_token_alice]';
  await assert.rejects(rpc(null,'ecotrack_register_push_token',[token,'android']),error=>error.code==='42501');
  await rpc(alice,'ecotrack_register_push_token',[token,'android',true,false],['text','text','boolean','boolean']);
  await assert.rejects(asUser(alice,'select * from public.staff_push_tokens'),/permission denied/);
  const quiet=await rpc(admin,'ecotrack_create_notification',[{event_key:'push-quiet',staff_id:'s1',title:'Quiet',message:'Disabled maintenance'}],['jsonb']);
  const foreign=await rpc(admin,'ecotrack_create_notification',[{event_key:'push-foreign',staff_id:'s2',priority:'high',title:'Foreign',message:'Other staff'}],['jsonb']);
  const urgent=await rpc(admin,'ecotrack_create_notification',[{event_key:'push-urgent',staff_id:'s1',priority:'high',title:'Urgent',message:'Own staff'}],['jsonb']);
  let queued=(await owner('select notification_id from public.ecotrack_push_deliveries where token=$1',[token])).rows;
  assert.deepEqual(queued.map(row=>row.notification_id),[urgent]);
  assert.ok(!queued.some(row=>[quiet,foreign].includes(row.notification_id)));
  await assert.rejects(rpc(alice,'ecotrack_claim_push_deliveries'),error=>error.code==='42501');
  await owner('select 1');
  await db.query("select set_config('request.jwt.claim.role','service_role',false)");
  await db.exec('set role service_role');
  const first=(await db.query('select * from public.ecotrack_claim_push_deliveries(100)')).rows;
  assert.equal(first.length,1); assert.equal(first[0].attempts,1);
  assert.equal((await db.query('select * from public.ecotrack_claim_push_deliveries(100)')).rows.length,0);
  await rpc(bob,'ecotrack_register_push_token',[token,'ios'],['text','text']);
  assert.equal((await owner('select count(*)::int n from public.ecotrack_push_deliveries where token=$1',[token])).rows[0].n,0);
  await rpc(alice,'ecotrack_unregister_push_token',[token],['text']);
  assert.equal((await owner('select count(*)::int n from public.staff_push_tokens where token=$1',[token])).rows[0].n,1);
  await rpc(bob,'ecotrack_unregister_push_token',[token],['text']);
  assert.equal((await owner('select count(*)::int n from public.staff_push_tokens where token=$1',[token])).rows[0].n,0);
});

test('push worker wake tokens are private, single-use and expire',async()=>{
  const token='aaaa1111-1111-4111-8111-111111111111',expired='bbbb2222-2222-4222-8222-222222222222';
  await owner('insert into public.ecotrack_push_wake_tokens(nonce) values($1::uuid)',[token]);
  await owner("insert into public.ecotrack_push_wake_tokens(nonce,expires_at) values($1::uuid,clock_timestamp()-interval '1 minute')",[expired]);
  await assert.rejects(asUser(alice,'select * from public.ecotrack_push_wake_tokens'),/permission denied/);
  await assert.rejects(rpc(alice,'ecotrack_authorize_push_worker',[token],['uuid']),error=>error.code==='42501');
  await owner("select set_config('request.jwt.claim.role','service_role',false)");await db.exec('set role service_role');
  assert.equal((await db.query('select public.ecotrack_authorize_push_worker($1::uuid) accepted',[token])).rows[0].accepted,true);
  assert.equal((await db.query('select public.ecotrack_authorize_push_worker($1::uuid) accepted',[token])).rows[0].accepted,false);
  assert.equal((await db.query('select public.ecotrack_authorize_push_worker($1::uuid) accepted',[expired])).rows[0].accepted,false);
});

test('push worker rejects a missing role without consuming its wake token',async()=>{
 const token='cccc3333-3333-4333-8333-333333333333';
 await owner('insert into public.ecotrack_push_wake_tokens(nonce) values($1::uuid)',[token]);
 const definition=(await owner("select pg_get_functiondef('auth.role()'::regprocedure) definition")).rows[0].definition;
 try {
   await owner('create or replace function auth.role() returns text language sql stable as $$ select null::text $$');
   await assert.rejects(owner('select public.ecotrack_authorize_push_worker($1::uuid)',[token]),error=>error.code==='42501');
   await assert.rejects(owner('select * from public.ecotrack_claim_push_deliveries(100)'),error=>error.code==='42501');
   assert.equal((await owner('select count(*)::int n from public.ecotrack_push_wake_tokens where nonce=$1::uuid',[token])).rows[0].n,1);
 } finally {
   await owner(definition);
   await owner('delete from public.ecotrack_push_wake_tokens where nonce=$1::uuid',[token]);
 }
});

test('notification insertion wakes the configured project worker and preserves its URL on setup retries',async()=>{
 await owner('select 1');
 await db.exec(`create schema net; create table net.sent_requests(id bigint generated always as identity,url text,headers jsonb,body jsonb);
 create function net.http_post(url text,headers jsonb,body jsonb) returns bigint language plpgsql as $$ declare result bigint; begin insert into net.sent_requests(url,headers,body) values(url,headers,body) returning id into result; return result; end $$;
 create schema vault; create table vault.decrypted_secrets(name text unique,decrypted_secret text);
 create schema cron; create table cron.job(jobid bigint generated always as identity,jobname text,schedule text,command text);
 create function cron.schedule(jobname text,schedule text,command text) returns bigint language plpgsql as $$ declare result bigint; begin insert into cron.job(jobname,schedule,command) values(jobname,schedule,command) returning jobid into result; return result; end $$;`);
 const activation=fs.readFileSync('supabase/push-delivery-setup.sql','utf8').replace(/create extension[^;]+;/g,'');
 await assert.rejects(db.exec(activation),/Configure ecotrack_push_worker_url/);
 await db.exec('rollback');
 const workerUrl='http://local-ecotrack:8000/functions/v1/deliver-mobile-push';
 await owner("insert into vault.decrypted_secrets(name,decrypted_secret) values('ecotrack_push_worker_url',$1)",[workerUrl]);
 await db.exec(activation);
 await rpc(alice,'ecotrack_register_push_token',['ExpoPushToken[activation_fixture]','android'],['text','text']);
 await rpc(admin,'ecotrack_create_notification',[{event_key:'push-activation-test',staff_id:'s1',title:'Activation',message:'Worker wake'}],['jsonb']);
 const requests=(await owner('select * from net.sent_requests')).rows;
 assert.equal(requests.length,1);assert.equal(requests[0].url,workerUrl);assert.match(requests[0].headers.Authorization,/^Bearer [0-9a-f-]{36}$/);
 assert.deepEqual(requests[0].body,{});assert.equal((await owner('select count(*)::int n from public.ecotrack_push_wake_tokens')).rows[0].n,1);
 await db.exec(activation);assert.equal((await owner('select count(*)::int n from cron.job')).rows[0].n,1);
 await rpc(admin,'ecotrack_create_notification',[{event_key:'push-activation-retry',staff_id:'s1',title:'Retry',message:'Configured worker retained'}],['jsonb']);
 assert.equal((await owner('select url from net.sent_requests order by id desc limit 1')).rows[0].url,workerUrl);
});
