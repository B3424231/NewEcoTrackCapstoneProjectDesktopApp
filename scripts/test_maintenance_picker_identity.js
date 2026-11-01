'use strict';
// Isolated maintenance picker checks; never contact Supabase or mutate application storage.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8').replace(/\r\n/g,'\n');
const source=read('public/js/maintenance-modal.js');
function section(start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert(a>=0&&b>a,start);return source.slice(a,b);}
function picker(profiles=[],nodes=[],extra={}){
 const values=new Map();
 const context=vm.createContext({_nodesAirconCache:[],_maintenanceInventoryReady:false,
  localStorage:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)},
  maintenanceControllerDiagnostics:()=>({state:'Offline',controls:{}}),
  window:{EcoTrackMode:{mode:'both'},EcoTrackAirconSystem:{AirconProfileManager:{getAll:()=>profiles},NodeService:{getNode:id=>nodes.find(n=>[n.db_id,n.pb_id,n.id,n.node_id,n.name].includes(id))||null}}},...extra});
 vm.runInContext(section('  function currentMaintenanceControllers(','  function maintenanceDisplayText('),context);
 vm.runInContext(section('  function maintenanceDeviceLabel(','  function maintenanceAirconType('),context);
 vm.runInContext(section('  function getAirconsDatabase(','  async function readMaintenanceSensors('),context);
 vm.runInContext(section('  function getAirconsForStaff(','  function formatAcLocation('),context);
 return {context,values,get:()=>context.getAirconsDatabase()};
}
const originalAssets=[
 {aircon_id:'original-ac-one',device_id:'Aircon Matrix',name:'Aircon Matrix',room_id:'original-room',controller_node_id:null,node_id:null},
 {aircon_id:'original-ac-two',device_id:'Matriz',name:'Matriz',room_id:'original-room',controller_node_id:null,node_id:null}
];
test('unbound original AC assets never become unnamed installed devices',()=>{
 const before=JSON.stringify(originalAssets),p=picker(originalAssets);assert.equal(p.get().length,0);assert.equal(JSON.stringify(originalAssets),before);
});
test('stale controller links cannot fall back to asset names',()=>{
 const p=picker([{...originalAssets[0],controller_node_id:'deleted-node',node_id:'deleted-hardware'}]);assert.equal(p.get().length,0);
});
test('a registered device keeps its stable node ID, name, AC identity and assigned location',()=>{
 const profile={...originalAssets[0],controller_node_id:'node-one',building:'IC building',floor:'Floor 1',room_name:'Room 1'};
 const p=picker([profile],[{db_id:'node-one',node_id:'hardware-one',name:'Room Controller',device_mode:'both'}]);const [row]=p.get();
 assert.equal(row.nodeId,'node-one');assert.equal(row.airconId,'original-ac-one');assert.equal(row.id,'Aircon Matrix');assert.equal(row.airconName,'Aircon Matrix');
 assert.equal(p.context.maintenanceControllerName(row),'Room Controller');assert.equal(row.roomId,'original-room');assert.equal(row.building,'IC building');assert.equal(row.floor,'Floor 1');assert.equal(row.room,'Room 1');
});
test('verified monitoring devices retain monitoring mode and staff room scoping',()=>{
 const p=picker([{...originalAssets[0],controller_node_id:'sensor-node'}],[{db_id:'sensor-node',node_id:'sensor-hardware',name:'Room Sensor',device_mode:'monitoring'}]);
 p.context.window.EcoTrackMode.mode='monitoring';const rows=p.get();assert.equal(rows.length,1);assert.equal(rows[0].deviceMode,'monitoring');
 assert.equal(p.context.getAirconsForStaff({room_id:'another-room'},rows).length,0);assert.equal(p.context.getAirconsForStaff({room_id:'original-room'},rows).length,1);
});
test('authoritative empty registry cannot be resurrected from stale local or profile fallbacks',()=>{
 const p=picker(originalAssets,[],{_maintenanceInventoryReady:true});p.values.set('ecoTrack_aircons_cache',JSON.stringify([{id:'old-device',nodeId:'old-node'}]));
 p.context.window.activeNodesData=[{id:'old-node',name:'Old device',room_id:'original-room'}];assert.equal(p.get().length,0);
});
test('cached equipment cannot cross an authenticated account change',()=>{
 const callbacks=[];const client={auth:{onAuthStateChange:callback=>callbacks.push(callback)}};
 const p=picker(originalAssets,[],{reportReadClient:client,reportAuthVersion:1,reportRowsRead:{},confirmedReportWrites:new Map(),reportsFetchPromise:null,reportsFetchPending:false});
 p.context._nodesAirconCache=[{id:'prior-account-device',nodeId:'prior-node'}];p.context._maintenanceInventoryReady=true;p.values.set('ecoTrack_aircons_cache','[{"id":"prior-account-device"}]');
 vm.runInContext(section('  function clearMaintenanceInventory(','  function formatBatteryDisplay('),p.context);
 vm.runInContext(section('  function ensureReportReadSession(','  function readMaintenanceRows('),p.context);
 p.context.reportReadClient=null;p.context.ensureReportReadSession(client);callbacks[0]('SIGNED_IN',{});
 assert.equal(p.context._nodesAirconCache.length,0);assert.equal(p.values.has('ecoTrack_aircons_cache'),false);assert.equal(p.get().length,0);
});
test('staff picker uses an escaped name, separate status badge and accessible listbox controls',()=>{
 assert.match(source,/id="modalStaffDropdownTrigger"[\s\S]*?class="eco-maintenance-staff-trigger"/);
 assert.match(source,/aria-controls="modalStaffDropdownMenu"/);assert.match(source,/id="modalStaffDropdownMenu"[\s\S]*?role="listbox"/);
 assert.match(source,/class="eco-maintenance-staff-name"[^>]*>\$\{maintenanceDisplayText\(selectedStaff\?\.name/);
 assert.match(source,/class="eco-maintenance-staff-status"/);assert.match(source,/role="option" aria-selected=/);
 assert.doesNotMatch(source,/selectedStaff\.name\} \(\$\{selectedStaff\.status/);
});
test('staff status honors explicit presence without treating an active account as online',()=>{
 const context=vm.createContext({});vm.runInContext(section('  function maintenanceStaffPresence(','  function getStaffList('),context);
 assert.equal(context.maintenanceStaffPresence({name:'Technician',status:'Active',is_online:false}).label,'Offline');
 assert.equal(context.maintenanceStaffPresence({status:'Offline',is_online:true}).label,'Online');
 assert.equal(context.maintenanceStaffPresence({status:'Active'}).label,'Active');assert.equal(context.maintenanceStaffPresence({status:'Active'}).online,false);
});
function cloudPicker(nodes,hold=false){
 const callbacks=[];let release;
 const delayed=hold?new Promise(resolve=>release=resolve):Promise.resolve(nodes);
 const client={auth:{onAuthStateChange:callback=>callbacks.push(callback)},from:table=>({select:async()=>({data:table==='nodes'?await delayed:table==='aircons'?originalAssets:[],error:null})})};
 const p=picker(originalAssets,[],{getSb:()=>client,reportReadClient:null,reportAuthVersion:0,reportRowsRead:null,confirmedReportWrites:new Map(),reportsFetchPromise:null,reportsFetchPending:false,
  setTimeout(){},readMaintenanceSensors:async()=>[],updateStaffLocationHierarchy(){},CustomEvent:class{},console:{warn(){}},});
 p.context.window.dispatchEvent=()=>{};
 vm.runInContext(section('  function clearMaintenanceInventory(','  function formatBatteryDisplay('),p.context);
 vm.runInContext(section('  function ensureReportReadSession(','  function readMaintenanceRows('),p.context);
 vm.runInContext(section('  async function fetchAirconsFromSupabase(','  // Filter AC controls strictly matching'),p.context);
 return {...p,callbacks,release};
}
test('a successful empty cloud read remains authoritative with original AC assets still present',async()=>{
 const p=cloudPicker([]);await p.context.fetchAirconsFromSupabase();assert.equal(p.context._maintenanceInventoryReady,true);assert.equal(p.get().length,0);
});
test('an inventory read from the old account cannot populate the new account after sign-in',async()=>{
 const p=cloudPicker([{id:'old-account-node',name:'Old controller',room_id:'old-room'}],true);const pending=p.context.fetchAirconsFromSupabase();
 p.callbacks[0]('SIGNED_IN',{});p.release([{id:'old-account-node',name:'Old controller',room_id:'old-room'}]);await pending;
 assert.equal(p.context._maintenanceInventoryReady,false);assert.equal(p.context._nodesAirconCache.length,0);assert.equal(p.get().length,0);
});
