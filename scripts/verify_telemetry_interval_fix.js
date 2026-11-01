'use strict';
// Current interval persistence and requested-schedule previews; no live service or simulated measurements.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
async function main(){
  const shared=read('public/js/shared.js');assert(!shared.includes("connected: true, port: 'COM3'"));assert(!shared.includes('MockPocketBase'));
  const writes=[],window={dispatchEvent(){},electron:{invoke:async(channel,input)=>{
    assert.equal(channel,'telemetry-admin-request');writes.push(input.data);
    return {success:true,data:{id:'isolated-reading'}};
  }}};
  const context=vm.createContext({window,document:{readyState:'loading',addEventListener(){}},console,AbortController,clearTimeout,setTimeout,setInterval(){},CustomEvent:class{constructor(type,args){this.type=type;this.detail=args.detail;}},fetch:async(_url,options)=>{writes.push(JSON.parse(options.body));return {ok:true,json:async()=>({id:'isolated-reading'})};}});
  vm.runInContext(read('public/js/node-sync.js'),context);
  const save=window.EcoTrackNodeSync.saveNodeTelemetryToSqlite;
  const packet={status:'online',room_name:'Room',floor_name:'Floor',building_name:'Building',temp:24};
  for(const [id,intervalVal,intervalUnit,expected] of [['seconds',30,'Seconds',30],['minutes',5,'Minutes',300],['hours',2,'Hours',7200]]){
    await save({...packet,id:'interval-'+id,intervalVal,intervalUnit});assert.equal(writes.at(-1).interval_seconds,expected);
  }
  await save({...packet,id:'explicit-recorded-cadence',interval_seconds:12,intervalVal:5,intervalUnit:'Minutes'});assert.equal(writes.at(-1).interval_seconds,12,'Recorded sample cadence wins over configured interval');
  await save({...packet,id:'missing-cadence'});assert(!Object.hasOwn(writes.at(-1),'interval_seconds'),'Missing cadence is not replaced with a fabricated default');
  const source=read('public/js/sensor-workspace.js'),begin=source.indexOf('  function readRegistryDevices('),end=source.indexOf('  function query()',begin);assert(begin>=0&&end>begin);
  const view=vm.createContext({registryFields:{nodes:['id']},registryMetadata:new Map(),registryDevices:[],locationRegistry:{rooms:[],floors:[],buildings:[]}});vm.runInContext(source.slice(source.indexOf('  const registryFields ='),source.indexOf('  const sessionKey ='))+source.slice(begin,end),view);
  view.readRegistryDevices({nodes:[{id:'registered',wake_time:'05:00:00',sleep_time:'17:00:00',interval_val:5,interval_unit:'Minutes'},{id:'unknown'}]});
  assert.equal(view.registryDevices[0].sensor_schedule.interval_seconds,300);assert.equal(view.registryDevices[0].sensor_schedule.wake_time,'05:00');assert.equal(view.registryDevices[1].sensor_schedule,null);
  const html=read('public/telemetry.html');assert(html.includes('sensor-workspace.js'));assert(!html.includes('nodeDetailIntervalVal'),'Telemetry does not offer duplicate schedule mutation controls');
  console.log('PASS telemetry intervals: actual packet cadence, Seconds/Minutes/Hours, no fabricated defaults, and current registry schedule previews.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
