'use strict';
// Load real workspace functions; isolate only DOM, rendering and network boundaries.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'../..'),source=fs.readFileSync(path.join(root,'public/js/sensor-workspace.js'),'utf8');
function section(start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert(a>=0&&b>a,start);return source.slice(a,b);}
function declaration(name){const match=source.match(new RegExp('^  const '+name+' =[^\r\n]+;','m'));assert(match,name);return match[0];}
function createSensorHarness(){
 const elements=new Map(),created=[],charts=new Map();
 const $=id=>{if(!elements.has(id))elements.set(id,{id,hidden:false,textContent:''});return elements.get(id);};
 const context=vm.createContext({Date,console,window:{},nodes:[],registryDevices:[],available:true,stats:null,charts,$,
  heartbeats:new Map(),liveAircons:new Map(),liveNodeValues:new Map(),liveMeasurements:new Map(),
  document:{documentElement:{classList:{contains:()=>false}}},Chart:class{constructor(canvas,config){Object.assign(this,config);created.push(this);}update(){this.updated=true;}}});
 for(const file of ['aircon-state.js','airflow-pressure.js'])vm.runInContext(fs.readFileSync(path.join(root,'public/js',file),'utf8'),context);
 const helpers=['esc','deviceLabel','num','rotationValue','stamp','badge','state','observedModes','modeLabel'].map(declaration).join('\n');
 vm.runInContext(helpers+section('  function rememberAirconObservation(','  function empty(')+
  section('  function connection(','  function registryEvent(')+section('  function sensorIcon(','  function renderFleet(')+
  section('  function logValues(','  function renderHistory(')+'\nthis.api={state,modeLabel,rotationValue};',context);
 return {context,api:context.api,$,created};
}
function createRefreshHarness(){
 const elements=new Map(),requests=[],errors=[],renders=[],loading=[];
 const $=id=>{if(!elements.has(id))elements.set(id,{value:'',hidden:false,disabled:false,textContent:'',attributes:{},setAttribute(k,v){this.attributes[k]=v;}});return elements.get(id);};
 const fixture={devices:{items:[{id:'fixture-device',active:true}]},analytics:{sample_count:1},rows:{items:[{id:'old-record'}],total:1},energy:{available:true,energy_kwh:1},fail:null,hold:null,sync:{success:true,data:{changed:0}}};
 const context=vm.createContext({Date,URL,URLSearchParams,AbortController,console,DOMException,setTimeout,clearTimeout,
  page:'logs',observationDate:'2026-10-19',period:'daily',pageNumber:1,nodes:[],registryDevices:[],locationRegistry:{},stats:null,energy:null,energySelection:'',history:[],total:0,
  loaded:false,available:false,revision:0,running:false,controller:null,fleetPosition:{},locationFilter:null,snapshotKey:'',initialLoadSettled:false,
  locationsChecked:0,dataVersion:null,dataGeneration:null,lastRefreshAt:null,registrySyncResult:null,$,
  document:{querySelectorAll:()=>[]},window:{EcoTrackFutureCost:{notify(){}}},
  showSensorLoading:()=>loading.push('show'),hideSensorLoading:()=>{context.initialLoadSettled=true;loading.push('hide');},
  error:message=>errors.push(message),render:()=>renders.push({available:context.available,rows:context.history.length}),
  refreshLocations:async()=>{},refreshHeartbeats:async()=>{},
  syncCloudRegistry:async()=>{context.registrySyncResult=fixture.sync;return fixture.sync;},
  request:async(url,{signal}={})=>{requests.push({url,signal});if(fixture.fail)throw Error(fixture.fail);const value=url.startsWith('/devices')?fixture.devices:url.startsWith('/analytics')?fixture.analytics:url.startsWith('/telemetry')?fixture.rows:fixture.energy;const snapshot=structuredClone(value);if(fixture.hold)await fixture.hold.promise;return snapshot;}});
 vm.runInContext(declaration('stamp')+declaration('sessionKey')+section('  function ageCachedNodes()','  function restoreSnapshot()')+
  section('  function query()','  function error(')+section('  async function refresh({ poll = false } = {})','  function openDialog('),context);
 return {context,fixture,requests,errors,renders,loading,$};
}
module.exports={createSensorHarness,createRefreshHarness};
