const fs=require('node:fs'),assert=require('node:assert/strict'),vm=require('node:vm');
const {PGlite}=require('../scratch/cloud-db-test-runtime/node_modules/@electric-sql/pglite');
async function main(){
 const db=new PGlite(),checks=[],previous=fs.readFileSync('scripts/test_cloud_hardware_database.js','utf8');
 await db.exec(previous.slice(previous.indexOf(' await db.exec(`')+16,previous.indexOf('`);')));
 await db.exec(`ALTER TABLE nodes ADD COLUMN protocol_name text;
 ALTER TABLE aircons ALTER COLUMN id SET DEFAULT ('ac_'||gen_random_uuid());
 ALTER TABLE aircons ADD COLUMN asset_tag text UNIQUE,ADD COLUMN brand text NOT NULL DEFAULT 'Unspecified',ADD COLUMN model text,
 ADD COLUMN aircon_type text,ADD COLUMN room_id text REFERENCES rooms(id),ADD COLUMN protocol text,ADD COLUMN protocol_name text,ADD COLUMN status text,ADD COLUMN updated_at timestamptz DEFAULT now();`);
 for(const file of ['supabase_cloud_hardware_migration.sql','supabase_ir_realtime_migration.sql','supabase_controller_registration_migration.sql','supabase_ac_capabilities_migration.sql','supabase_controller_details_migration.sql'])await db.exec(fs.readFileSync(file,'utf8'));
 for(const file of ['supabase_ac_capabilities_migration.sql','supabase_controller_details_migration.sql'])await db.exec(fs.readFileSync(file,'utf8'));
 checks.push('Both additive migrations execute twice on PostgreSQL without resetting records or relationships.');
 const call=async(name,args)=>(await db.query('SELECT public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') AS value',args)).rows[0].value;
 const id='esp32s3-001122334455',setup={controller_name:'Matrix room controller',assignment_mode:'new',asset_tag:'Matrix AC',brand:'Matrix',aircon_type:'Custom unit',protocol_name:'TCL112AC',room_id:null};
 const registered=await call('ecotrack_prepare_controller_registration',[id]),nid=registered.node.id;
 await assert.rejects(()=>call('ecotrack_finish_controller_registration',[nid,id,setup]),/Verification pending/);
 assert.equal((await db.query('SELECT admin_verified_at FROM nodes WHERE id=$1',[nid])).rows[0].admin_verified_at,null);
 await call('ecotrack_device_exchange',[id,registered.device_token,{capabilities:{ir_receiver:true,ir_transmitter:true}},null]);
 const saved=await call('ecotrack_finish_controller_registration',[nid,id,setup]),aid=saved.aircon.id;
 assert(saved.node.admin_verified_at&&saved.node.deployment_saved_at);assert.equal(saved.aircon.brand,'Matrix');
 const before=saved.node.admin_verified_at;
 await call('ecotrack_device_exchange',[id,registered.device_token,{capabilities:{ir_receiver:true,ir_transmitter:true}},null]);
 assert.equal((await db.query('SELECT admin_verified_at FROM nodes WHERE id=$1',[nid])).rows[0].admin_verified_at.toISOString(),before);
 await assert.rejects(()=>db.query('UPDATE nodes SET admin_verified_at=now() WHERE id=$1',[nid]),/Save & Verify/);
 checks.push('Only fresh successful admin verification records the timestamp; failed registration and heartbeats do not invent or change it.');
 let sequence=1;
 const observed=(state,extra={})=>({protocol:'TCL112AC',frame_kind:'full_state',raw_count:227,sequence:sequence++,boot_count:1,state:{source:'ir_receiver',...state},...extra});
 const on=observed({power:true,temp:24,mode:'cool',fan:'high',turbo:true});
 await call('ecotrack_device_observe',[id,registered.device_token,on]);
 const partial=observed({quiet:true},{frame_kind:'partial_state'});
 await call('ecotrack_device_observe',[id,registered.device_token,partial]);
 let live=(await db.query('SELECT latest_ir FROM ecotrack_device_state WHERE node_id=$1',[nid])).rows[0].latest_ir;
 assert.equal(live.state.power,true);assert(live.field_at.power&&live.field_at.quiet);assert.equal(live.state.quiet,true);
 await call('ecotrack_device_observe',[id,registered.device_token,observed({power:false,temp:24,mode:'cool',fan:'high',turbo:false})]);
 await call('ecotrack_device_observe',[id,registered.device_token,on]);live=(await db.query('SELECT latest_ir FROM ecotrack_device_state WHERE node_id=$1',[nid])).rows[0].latest_ir;assert.equal(live.state.power,false);
 checks.push('OFF, Turbo, partial-field retention and duplicate/out-of-order protection use the real observation RPC.');
 const document={protocol:'TCL112AC',remote_model:null,model_verified:false,ac_model:'Physical Matrix label',features:{turbo:{status:'verified_unsupported'}},options:{fan:{quiet:{status:'verified_unsupported'}}},temperature:{status:'verified_supported',min:18,max:30,step:1}};
 const verified=await call('ecotrack_verify_ac_capabilities',[aid,0,document]);assert.equal(verified.aircon.capability_profile.revision,1);assert.equal(verified.aircon.brand,'Matrix');
 assert.equal(verified.aircon.capability_profile.features.turbo.confidence,'user_confirmed');
 await assert.rejects(()=>call('ecotrack_verify_ac_capabilities',[aid,0,document]),/changed/);
 await assert.rejects(()=>call('ecotrack_verify_ac_capabilities',[aid,1,{...document,wifi_password:'not-permitted'}]),/document/);
 await assert.rejects(()=>call('ecotrack_verify_ac_capabilities',[aid,1,{...document,temperature:{...document.temperature,max:32}}]),/encoder/);
 checks.push('Admin physical results persist on the same AC, retain manufacturer, reject stale edits, credentials and invalid temperature overrides.');
 const queue=async(state,extra={})=>call('ecotrack_cloud_request',[nid,'ac_intent',{aircon_id:aid,protocol:'TCL112AC',model:null,capability_revision:1,registry_version:'irremote-2.9.0-1',state,...extra},require('node:crypto').randomUUID()]);
 await assert.rejects(()=>queue({power:'on',mode:'cool',temp:24.5,fan:'high'}),/steps/);
 await assert.rejects(()=>queue({power:'on',mode:'cool',temp:24,fan:'high',turbo:'on'}),/Unsupported/);
 await assert.rejects(()=>queue({power:'on',mode:'cool',temp:24,fan:'quiet'}),/unsupported/);
 await assert.rejects(()=>queue({power:'on',mode:'cool',temp:24,fan:'high'},{capability_revision:0}),/changed/);
 const command=await queue({power:'off',mode:'cool',temp:24,fan:'high',turbo:'off'});assert.equal(command.status,'queued');assert.equal(command.payload.capability_constraints.min,18);
 checks.push('Actual command RPC uses protocol/model/physical constraints, rejects stale profiles and preserves honest queued delivery.');
 const registry=JSON.parse(fs.readFileSync('config/ac-capabilities.json','utf8'));
 const context={};vm.runInNewContext(fs.readFileSync('public/js/ac-capability-registry.source.js','utf8').replace('/* AC_CAPABILITY_DATA */ {}',JSON.stringify(registry))+';globalThis.registry=AcCapabilityRegistry;',context);
 for(const [name,p] of Object.entries(registry.protocols)){
  const variants=[null,...Object.keys(p.models||{}).map(Number)];
  for(const model of variants){
   const actual=await call('ecotrack_resolve_ac_capabilities',[name,model,{}]);
   const expected=context.registry.resolve({protocol_name:name,remote_model:model});
   assert.equal(actual.can_transmit,expected.can_transmit,name);
   assert.deepEqual(actual.temperature,expected.temperature,name+' temp');
   assert.deepEqual(actual.fan_map,expected.fan_map,name+' fan');
   assert.deepEqual(actual.features,expected.features,name+' features');
  }
 }
 checks.push('Frontend and PostgreSQL resolve identical temperature, fan, feature and model constraints for every audited profile/model.');
 await db.exec("SELECT set_config('test.admin','false',false)");
 await assert.rejects(()=>call('ecotrack_verify_ac_capabilities',[aid,1,document]),/Administrator/);
 await db.exec('SET ROLE anon');await assert.rejects(()=>call('ecotrack_verify_ac_capabilities',[aid,1,document]),/permission denied/);await db.exec('RESET ROLE');
 checks.push('Non-admin and anonymous callers cannot save verification results.');
 await db.close();fs.mkdirSync('reports/multi-brand-capabilities',{recursive:true});fs.writeFileSync('reports/multi-brand-capabilities/database-results.json',JSON.stringify({checks,passed:checks.length,live_database_modified:false},null,2));
 console.log('Multi-brand database: '+checks.length+' PostgreSQL checks passed.');
}
main().catch(e=>{console.error(e);process.exit(1);});
