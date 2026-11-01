'use strict';
// Run the existing mobile PostgreSQL contract suite with the new desktop
// migration inserted into its disposable fixture. Mobile sources stay untouched.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const root=path.resolve(__dirname,'..'),mobile=path.resolve(root,'../EcoTrackAppMobileNew-master-control');
const file=path.join(mobile,'scripts/test-database-contracts.cjs');
let source=fs.readFileSync(file,'utf8');
const anchor="  await owner('update public.staff set auth_user_id";
if(source.split(anchor).length!==2)throw Error('Existing contract fixture entry point changed; inspect before running');
const setup=`  await db.exec('alter table public.nodes add column if not exists photo_url text;alter table public.nodes add column if not exists image_url text;');
  await db.exec(fs.readFileSync(${JSON.stringify(path.join(root,'scripts/fixtures/photo-alias-profile-functions.sql'))},'utf8'));
  await db.exec(fs.readFileSync(${JSON.stringify(path.join(root,'supabase/migrations/20261019182804_consolidate_unused_photo_aliases.sql'))},'utf8'));
`;
source=source.replace("  const migrations=fs.readdirSync",`  // Hardware bootstrap precedes mobile measurement migrations in deployed schemas.
  await db.exec('create schema if not exists ecotrack_private;create table if not exists ecotrack_private.device_credentials(device_id text primary key,node_id text references public.nodes(id),token_hash bytea);');
  await db.exec('alter table public.telemetry add column if not exists observed_at timestamptz;alter table public.telemetry add column if not exists event_type text;alter table public.telemetry add column if not exists interval_seconds numeric;alter table public.telemetry add column if not exists rotation_rpm numeric;alter table public.telemetry add column if not exists rotation_quality text;alter table public.telemetry add column if not exists boot_id text;alter table public.telemetry add column if not exists sequence bigint;alter table public.telemetry add column if not exists sensor_name text;alter table public.telemetry add column if not exists room_name text;alter table public.telemetry add column if not exists aircon_type text;alter table public.telemetry add column if not exists battery numeric;alter table public.telemetry add column if not exists rssi numeric;');
  // Production baseline columns used by the catalog-hygiene migration.
  await db.exec('alter table public.buildings add column if not exists admin_id text;alter table public.maintenance_reports add column if not exists admin_id text;alter table public.nodes add column if not exists maintainer_id text;alter table public.rooms add column if not exists admin_id text;create table if not exists public.rules(id text primary key,admin_id text,building_id text,floor_id text,room_id text);create table if not exists public.rule_nodes(rule_id text,node_id text);create or replace function public.sync_staff_online_status() returns trigger language plpgsql as $f$ begin return NEW; end $f$;create or replace function public.update_nodes_updated_column() returns trigger language plpgsql as $f$ begin return NEW; end $f$;');
  const migrations=fs.readdirSync`);
source=source.replace("for (const name of migrations) await db.exec",`for (const name of migrations) {if(name.includes('data_flow_database_hygiene'))await db.exec('alter table public.notifications add column if not exists admin_id text;alter table public.notifications add column if not exists rule_id text;alter table public.notifications add column if not exists room_id text;'); await db.exec`);
source=source.replace("path.join('supabase/migrations',name),'utf8'));", "path.join('supabase/migrations',name),'utf8'));}");
source=source.replace(anchor,setup+anchor);
process.chdir(mobile);
const compiled=new Module(file,module);compiled.filename=file;compiled.paths=Module._nodeModulePaths(path.dirname(file));compiled._compile(source,file);
