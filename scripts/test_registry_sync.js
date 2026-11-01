'use strict';
// Installed Supabase SDK over isolated HTTP responses; no live services or records.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createClient}=require('@supabase/supabase-js');
const {syncRegisteredMonitors}=require('../src/ac-device-monitor');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const node={id:'cloud-monitor',name:'Fixture device',device_mode:'both',monitoring_id:'11111111-1111-4111-8111-111111111111',monitor_aircon_id:'fixture-ac',room_id:'fixture-room',interval_val:1,interval_unit:'Minutes'};
function fixture(extra={}) {
  const tables={nodes:[node,{id:'controller-only',device_mode:'controller',ir_payload:'unneeded'}],aircons:[{id:'fixture-ac',name:'Fixture AC',asset_tag:'AC1',aircon_type:'Split',photo:'unneeded',desired_state:{power:true}}],rooms:[{id:'fixture-room',name:'Room',floor_id:'fixture-floor'}],floors:[{id:'fixture-floor',name:'Floor',building_id:'fixture-building'}],buildings:[{id:'fixture-building',name:'Building'}],...extra};
  const requests=[],writes=[],control={stall:null,fail:null,delay:0,status:403};
  const client=createClient('https://isolated-registry.invalid','sb_publishable_isolated_fixture',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(input,init)=>{
    const url=new URL(input),table=url.pathname.split('/').pop(),signal=init.signal;
    const request={table,columns:url.searchParams.get('select'),filter:url.searchParams.get('id'),roles:url.searchParams.get('device_mode'),signal,aborted:false};requests.push(request);
    signal.addEventListener('abort',()=>{request.aborted=true;},{once:true});
    if(control.stall===table)return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
    if(control.delay)await pause(control.delay);
    if(control.fail===table)return new Response(JSON.stringify({message:'Fixture metadata unavailable',code:'FIXTURE_UNAVAILABLE'}),{status:control.status,headers:{'Content-Type':'application/json'}});
    let rows=tables[table]||[];
    for(const field of ['id','device_mode'])if(url.searchParams.has(field)){
      const values=url.searchParams.get(field).slice(4,-1).split(',').map(value=>value.replace(/^"|"$/g,''));
      rows=rows.filter(row=>values.includes(row[field]));
    }
    const count=rows.length,offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||500);
    rows=rows.slice(offset,offset+limit).map(row=>Object.fromEntries(request.columns.split(',').filter(field=>Object.hasOwn(row,field)).map(field=>[field,row[field]])));
    return new Response(JSON.stringify(rows),{status:200,headers:{'Content-Type':'application/json','Content-Range':rows.length?`${offset}-${offset+rows.length-1}/${count}`:'*/0'}});
  }}});
  const options={metadataTimeoutMs:1000,adminToken:'isolated-registry-token-not-a-real-credential',fetcher:async(url,init)=>{
    assert.equal(url.hostname,'localhost');writes.push(JSON.parse(init.body));return {ok:true,json:async()=>({changed:1})};
  }};
  return {client,options,control,requests,writes,tables};
}
test('registry reads only required columns, monitored roles and linked assets before reconciling',async()=>{
  const f=fixture();await syncRegisteredMonitors(f.client,f.options);
  assert(f.requests.every(request=>request.columns&&!request.columns.includes('*')));
  assert.equal(f.requests[0].roles,'in.(monitoring,both)');
  assert.equal(f.requests.find(request=>request.table==='aircons').filter,'in.(fixture-ac)');
  assert.equal(f.requests.find(request=>request.table==='rooms').filter,'in.(fixture-room)');
  assert.deepEqual(f.writes,[{devices:[{id:node.monitoring_id,registry_node_id:node.id,device:{name:'Fixture device',aircon_id:'fixture-ac',aircon_name:'Fixture AC',aircon_type:'Split',location:'Building · Floor · Room',expected_interval_seconds:60}}]}]);
});
test('an unavailable client fails explicitly before creating snapshot work or weak-map entries',async()=>{
  for(const client of [null,undefined,{},'unavailable'])
    await assert.rejects(syncRegisteredMonitors(client,{}),error=>error.code==='REGISTRY_METADATA_UNAVAILABLE');
  await pause(0); // Node's test runner also rejects any orphaned/unhandled task rejection.
});
test('controller-only registries do not wait for unrelated metadata tables',async()=>{
  const f=fixture({nodes:[{id:'controller',device_mode:'controller'}]});f.control.stall='aircons';
  await syncRegisteredMonitors(f.client,f.options);assert.equal(f.requests.length,1);assert.deepEqual(f.writes,[{devices:[]}]);
});
test('slow successful metadata stays in flight once and completes without a duplicate reconcile',async()=>{
  const f=fixture();f.control.delay=20;
  const first=syncRegisteredMonitors(f.client,f.options),second=syncRegisteredMonitors(f.client,f.options);assert.equal(first,second);
  await pause(10);assert.equal(f.writes.length,0);await Promise.all([first,second]);assert.equal(f.requests.length,5);assert.equal(f.writes.length,1);
});
test('stalled metadata aborts by its deadline, leaves local records untouched and can retry',async()=>{
  const f=fixture();f.control.stall='aircons';f.options.metadataTimeoutMs=30;
  const existingRegistry=[{id:'already-recorded',active:true}],before=structuredClone(existingRegistry);
  const started=Date.now();await assert.rejects(syncRegisteredMonitors(f.client,f.options),error=>error.code==='REGISTRY_METADATA_TIMEOUT');
  assert(Date.now()-started<1000);assert(f.requests.find(request=>request.table==='aircons').aborted);
  assert.equal(f.writes.length,0);assert.deepEqual(existingRegistry,before);
  f.control.stall=null;await syncRegisteredMonitors(f.client,f.options);assert.equal(f.writes.length,1);
});
test('one failed metadata query aborts pending siblings and never retires a partial snapshot',async()=>{
  const f=fixture();f.control.stall='rooms';f.control.fail='aircons';
  await assert.rejects(syncRegisteredMonitors(f.client,f.options),error=>error.code==='REGISTRY_METADATA_UNAVAILABLE');
  assert(f.requests.find(request=>request.table==='rooms').aborted);assert.equal(f.writes.length,0);
});
test('transient cloud failure returns once without SDK backoff before the dashboard polling retry',async()=>{
  const f=fixture();f.control.fail='nodes';f.control.status=503;
  const started=Date.now();await assert.rejects(syncRegisteredMonitors(f.client,f.options),error=>error.code==='REGISTRY_METADATA_UNAVAILABLE');
  assert(Date.now()-started<500);assert.equal(f.requests.length,1);assert.equal(f.writes.length,0);
  f.control.fail=null;await syncRegisteredMonitors(f.client,f.options);assert.equal(f.writes.length,1);
});
test('large linked metadata lists are bounded per URL and still reconcile every device',async()=>{
  const f=fixture({nodes:Array.from({length:201},(_,i)=>({...node,id:'cloud-'+i,monitoring_id:i+'-fixture',monitor_aircon_id:'ac-'+i,room_id:null})),aircons:Array.from({length:201},(_,i)=>({id:'ac-'+i,name:'AC '+i}))});
  await syncRegisteredMonitors(f.client,f.options);
  const assets=f.requests.filter(request=>request.table==='aircons');assert.equal(assets.length,3);assert(assets.every(request=>request.filter.length<2000));assert.equal(f.writes[0].devices.length,201);
});
test('an incomplete counted node snapshot is rejected before reading any linked metadata',async()=>{
  let writes=0;const client={from:()=>({select(){return {order(){return this;},range(){return this;},abortSignal(){return this;},then(resolve){resolve({data:[],count:2});}};}})};
  await assert.rejects(syncRegisteredMonitors(client,{adminToken:'isolated-fixture-token',fetcher:async()=>{writes++;}}),error=>error.code==='REGISTRY_SNAPSHOT_INCOMPLETE');assert.equal(writes,0);
});
test('monitoring IPC returns explicit preserved-registry failures instead of throwing or logging handler errors',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8');
  const start=source.indexOf("registerDatabaseHandler('monitoring-sync-registry'");
  const end=source.indexOf("registerDatabaseHandler('sensor-create-asset'",start);let handle;
  const context=vm.createContext({path,__dirname:path.join(__dirname,'../src'),process:{env:{}},getSupabaseAdmin:()=>({}),registerDatabaseHandler:(_name,fn)=>{handle=fn;},require:()=>({syncRegisteredMonitors:async()=>{throw Object.assign(new Error('Fixture metadata timed out'),{code:'REGISTRY_METADATA_TIMEOUT'});}})});
  vm.runInContext(source.slice(start,end),context);
  const result=await handle();assert.equal(result.success,false);assert.equal(result.code,'REGISTRY_METADATA_TIMEOUT');assert.equal(result.registry_preserved,true);assert.match(result.error,/timed out/);assert(!result.data);
});
