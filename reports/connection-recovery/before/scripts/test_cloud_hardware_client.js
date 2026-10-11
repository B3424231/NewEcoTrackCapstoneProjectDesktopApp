const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
let now = Date.parse('2026-10-08T16:00:00Z');
class TestDate extends Date { static now() { return now; } }
let bluetoothInfo={device_id:'esp32s3-001122334455',cloud_protocol:1,wifi_status:'unconfigured',cloud_status:'unconfigured',firmware_version:'cloud-ir-receiver-1.0',capabilities:{ir_receiver:true,ir_transmitter:false}};
let hardwareStatus={node_id:'node-real',device_id:bluetoothInfo.device_id,last_seen:new Date(now).toISOString(),capabilities:{ir_receiver:true,ir_transmitter:false},latest_ir:null};
let rpcError=null, readError=null, responseMode='complete', wireParts=[], provisioned=[], requests=[], disconnected=false, queued=null;
const storage={ecoTrack_nodes:JSON.stringify([{node_id:'old',wifi_password:'must-remove',device_token:'must-remove'}])};
const checkList=[];
const infoChar={readValue:async()=>new DataView(new TextEncoder().encode(JSON.stringify(bluetoothInfo)).buffer)};
const writeChar={writeValueWithResponse:async bytes=>{
 const packet=Buffer.from(bytes); const text=packet.toString('utf8'); const header=text.match(/^([^:]+):(\d+):(\d+):/);
 assert(header); const index=Number(header[2]), total=Number(header[3]);
 if(index===0)wireParts=[];
 assert.equal(index,wireParts.length); wireParts.push(packet.subarray(Buffer.byteLength(header[0])));
 if(wireParts.length===total){
  const config=JSON.parse(Buffer.concat(wireParts).toString('utf8')); provisioned.push(config);
  bluetoothInfo={...bluetoothInfo,request_id:config.request_id,wifi_status:'connected',cloud_status:config.supabase_url?'verified':'unconfigured',ip_address:'10.2.3.4',wifi_ssid:config.ssid,rssi:-71};
  hardwareStatus.last_seen=new Date(now).toISOString();
 }
}};
const service={getCharacteristic:async id=>id.startsWith('beb5483e')?infoChar:writeChar};
const device={name:'EcoTrack-'+bluetoothInfo.device_id,addEventListener(){},gatt:{connected:true,connect:async()=>({getPrimaryService:async()=>service}),disconnect(){disconnected=true;this.connected=false;}}};
const sb={
 rpc:async(name,args)=>{
  requests.push({name,args:structuredClone(args)}); if(rpcError)return {data:null,error:rpcError};
  if(name==='ecotrack_register_cloud_device')return {data:{node:{id:'node-real'},device_token:'a'.repeat(64)},error:null};
  assert.equal(name,'ecotrack_cloud_request');
  queued={id:args.p_request_id,node_id:args.p_node_id,kind:args.p_kind,payload:args.p_payload,status:'queued',created_at:new Date(now).toISOString()};
  return {data:queued,error:null};
 },
 from(table){
  let key,value;
  const query={select(){return query;},eq(k,v){key=k;value=v;return query;},
   maybeSingle:async()=>{
    if(readError)return {data:null,error:readError};
    if(table==='nodes')return {data:{id:'node-real'},error:null};
    if(table==='ecotrack_device_state')return {data:hardwareStatus,error:null};
    if(table==='ecotrack_device_commands'){
     assert.equal(value,queued.id);
     const result=responseMode==='wrong-id'?{command_id:'other',success:true}:{command_id:queued.id,success:true,rssi:-71,protocol:'DAIKIN2',raw_data:'3500,1750,450,1300',hex:'0x1234'};
     return {data:{...queued,status:responseMode==='pending'?'queued':responseMode==='failed'?'failed':'completed',result:responseMode==='failed'?{error:'Receiver rejected request'}:result},error:null};
    }
    throw new Error('Unexpected table '+table);
   },then(resolve,reject){return Promise.resolve({data:[hardwareStatus],error:readError}).then(resolve,reject);}
  }; return query;
 }
};
const root={supabaseClient:sb,crypto:crypto.webcrypto,navigator:{bluetooth:{requestDevice:async options=>{assert.equal(options.filters[0].namePrefix,'EcoTrack-');return device;}}},performance:{now:()=>now},ECOTRACK_CONFIG:{supabaseUrl:'https://test.supabase.co',supabaseKey:'sb_publishable_fixture'},localStorage:{getItem:k=>storage[k]||null,setItem:(k,v)=>storage[k]=v}};
const context=vm.createContext({window:root,Date:TestDate,TextEncoder,TextDecoder,Uint8Array,atob,console,setTimeout:(callback,ms)=>{now+=ms;queueMicrotask(callback);}});
vm.runInContext(fs.readFileSync('public/js/hardware-cloud.js','utf8'),context);
const cloud=root.EcoTrackHardwareCloud;
async function main(){
 assert(!storage.ecoTrack_nodes.includes('must-remove'));checkList.push('Legacy passwords and device credentials removed from node cache');
 assert.equal((await cloud.connect()).device_id,bluetoothInfo.device_id);checkList.push('Actual BLE GATT identity is read');
 await cloud.provision({ssid:'Campus network',pass:'  spaced-password  '});
 assert.equal(provisioned[0].pass,'  spaced-password  ');checkList.push('Credentials are written to BLE and whitespace is preserved');
 const longSSID='Campus-'+ '\u7f51'.repeat(6);
 const registration=await cloud.register({room_id:null,brand:null},{ssid:longSSID,pass:'secure-password'});
 assert.equal(provisioned.at(-1).ssid,longSSID);assert(wireParts.length>1);assert(disconnected);assert(registration.cloud_state);checkList.push('Chunked Unicode provisioning verifies a cloud heartbeat then disconnects BLE');
 const cloudArgs=requests.find(item=>item.name==='ecotrack_register_cloud_device').args;
 assert(!JSON.stringify(cloudArgs).includes('secure-password')); assert(!JSON.stringify(storage).includes('secure-password'));checkList.push('Wi-Fi password is never sent to a Supabase registration RPC or localStorage');
 let pong=await cloud.ping('node-real');assert.equal(pong.success,true);assert.equal(pong.source,'supabase');assert.equal(pong.rssi,-71);assert(Number.isInteger(pong.round_trip_ms));checkList.push('Ping requires a matching device acknowledgement and measured round trip');
 responseMode='wrong-id';await assert.rejects(()=>cloud.ping('node-real'),/Invalid hardware acknowledgement/);checkList.push('Mismatched acknowledgement rejected');
 responseMode='failed';await assert.rejects(()=>cloud.learn('node-real'),/Receiver rejected request/);checkList.push('Device failures are surfaced');
 responseMode='pending';await assert.rejects(()=>cloud.request('node-real','ping',{}, {timeoutMs:1500}),error=>error.code==='ACK_TIMEOUT');checkList.push('Queue persistence alone never becomes a successful ping');
 responseMode='complete';hardwareStatus.sleeping_until=new Date(now+60000).toISOString();await assert.rejects(()=>cloud.ping('node-real'),error=>error.code==='DEVICE_SLEEPING');checkList.push('Deep-sleep status prevents false online diagnostics');
 const config=await cloud.request('node-real','configure',{interval_seconds:30,wake_time:'06:00',sleep_time:'22:00'},{wait:false});assert.equal(config.status,'queued');checkList.push('Schedule queue is explicit while the device sleeps');
 delete hardwareStatus.sleeping_until;
 await assert.rejects(()=>cloud.control('node-real',{state:{temp:22}}),error=>error.code==='RECEIVER_ONLY');checkList.push('Receiver-only device rejects AC control');
 hardwareStatus.capabilities.ir_transmitter=true;
 const control=await cloud.control('node-real',{aircon_id:'ac-real',protocol:'DAIKIN2',state:{power:'on',temp:22,mode:'cool',fan:'auto'}});assert.equal(control.command_status,'queued');checkList.push('Transmitter command remains queued until hardware acknowledges');
 await assert.rejects(()=>cloud.latest('node-real'),/No actual IR capture/);
 hardwareStatus.latest_ir={raw_data:'3500,1750,450,1300',protocol:'DAIKIN2',sequence:4};assert.equal((await cloud.latest('node-real')).sequence,4);checkList.push('Latest IR capture comes from the cloud device record');
 hardwareStatus.last_seen=new Date(now-60000).toISOString();assert.equal((await cloud.getStatus('node-real')).connection_status,'offline');checkList.push('Old heartbeat is offline even when its database row still exists');
 rpcError={code:'PGRST202',message:'Function missing'};await assert.rejects(()=>cloud.request('node-real','ping'),/supabase_cloud_hardware_migration/);checkList.push('Missing cloud deployment produces actionable setup error');
 rpcError=null;readError={code:'42501',message:'Access denied'};await assert.rejects(()=>cloud.getStatus('node-real'),/Access denied/);checkList.push('Database permission failures remain failures');
 fs.writeFileSync('reports/cloud-hardware/client-tests.json',JSON.stringify({checks:checkList,passed:checkList.length,physical_hardware_tested:false},null,2));
 console.log(`Cloud hardware client: ${checkList.length} checks passed.`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
