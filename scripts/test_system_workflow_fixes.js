'use strict';
// Production functions with isolated clocks, storage and transports. No live writes.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=process.env.ECOTRACK_DESKTOP_ROOT||path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8').replace(/\r\n/g,'\n');
function rules({duration=0,browser=false,storage=new Map()}={}) {
 let now=Date.parse('2026-10-25T06:00:00Z'),response={success:true,data:{id:'saved-notification'}},attempts=0,release;
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 const shown=[],audit=[],node={id:'node',name:'AC device',room_id:'room',interval_val:10,interval_unit:'Seconds'},rule={id:'rule',type:'temperature',condition:'above',value:28,unit:'°C',duration,enabled:true};
 const c={Date:Clock,Intl,Math,Map,Set,URL,URLSearchParams,AbortController,AbortSignal,CustomEvent:class{},
  console:{log(){},warn(){},error(){}},document:{addEventListener(){},getElementById(){return null;},querySelector(){return null;},querySelectorAll(){return [];}},
  localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},
  addEventListener(){},dispatchEvent(){},setTimeout(){return 1;},clearTimeout(){},setInterval(){return 1;},clearInterval(){},saveViolationToAuditHistory:x=>audit.push(x)};
 const save=async()=>{attempts++;if(release)await release;if(response instanceof Error)throw response;return response;};
 if(browser)c.supabaseClient={from:()=>({insert:()=>({select:()=>({maybeSingle:async()=>{const r=await save();return {data:r.data,error:r.error};}})})})};
 else c.electron={invoke:save};
 c.window=c;vm.createContext(c);vm.runInContext(read('public/js/global-notifications.js'),c);
 c.getActiveRulesAndNodes=async()=>({rules:[rule],ruleNodes:[],nodes:[node],rooms:[{id:'room'}],nodeMap:{node}});
 c.getNotificationHardwareStates=async()=>({node:{last_seen:new Clock().toISOString()}});
 c.triggerGlobalNotification=(...x)=>shown.push(x);
 const sample=patch=>({id:'node',name:node.name,temperature:35,created:new Clock().toISOString(),interval_seconds:10,boot_id:'boot-one',calibration_id:'cal-one',...patch});
 return {c,rule,node,shown,audit,storage,sample,setResponse:x=>response=x,advance:ms=>now+=ms,hold:p=>release=p,get attempts(){return attempts;},evaluate:patch=>c.evaluateTelemetryAgainstRules(sample(patch))};
}
test('rejected or unconfirmed IPC saves cannot publish alerts, audit success or cooldown; retry succeeds',async()=>{
 for(const response of [{success:false,error:'Denied'},{success:true,data:null},{success:true,data:{id:''}},new Error('Disconnected')]){
  const f=rules();f.setResponse(response);await f.evaluate();assert.equal(f.shown.length,0);assert.equal(f.audit.length,0);assert(!f.storage.has('ecoTrack_alert_triggered_rule_node'));
  f.setResponse({success:true,data:{id:'real-receipt'}});await f.evaluate();assert.equal(f.shown.length,1);assert.equal(f.audit[0].id,'real-receipt');assert(f.storage.has('ecoTrack_alert_triggered_rule_node'));
 }
});
test('browser saves handle returned errors and malformed receipts before displaying success',async()=>{
 for(const response of [{data:null,error:{message:'Denied'}},{data:{id:'looks-valid'},error:{message:'Rejected'}},{data:null,error:null}]){
  const f=rules({browser:true});f.setResponse(response);await f.evaluate();assert.equal(f.shown.length,0);assert.equal(f.audit.length,0);
 }
 const f=rules({browser:true});f.setResponse({data:{id:'browser-saved'},error:null});await f.evaluate();assert.equal(f.audit[0].id,'browser-saved');
});
test('overlapping evaluations share a pending save and only one confirmed alert',async()=>{
 const f=rules();let finish;f.hold(new Promise(r=>finish=r));const one=f.evaluate(),two=f.evaluate();await new Promise(r=>setImmediate(r));assert.equal(f.attempts,1);finish();await Promise.all([one,two]);assert.equal(f.shown.length,1);
});
test('a gap restarts duration; consecutive fresh observations satisfy the new interval',async()=>{
 const f=rules({duration:1});await f.evaluate();f.advance(10*60000);await f.evaluate();assert.equal(f.attempts,0);
 for(let i=0;i<6;i++){f.advance(10000);await f.evaluate();}assert.equal(f.attempts,1);
});
test('unchanged packets and old wall-clock timers cannot supply continuous observed time',async()=>{
 const f=rules({duration:1});f.storage.set('ecoTrack_violation_start_rule_node','1');const packet=f.sample();await f.c.evaluateTelemetryAgainstRules(packet);
 for(let i=0;i<12;i++){f.advance(6000);await f.c.evaluateTelemetryAgainstRules(packet);}assert.equal(f.attempts,0);
});
test('reboots, calibration changes and changed rule thresholds restart observation evidence',async()=>{
 for(const change of ['boot','calibration','rule']){
  const f=rules({duration:1});for(let i=0;i<6;i++){await f.evaluate();f.advance(10000);}
  if(change==='rule')f.rule.value=29;
  await f.evaluate(change==='boot'?{boot_id:'new-boot'}:change==='calibration'?{calibration_id:'new-cal'}:{});assert.equal(f.attempts,0);
 }
});
test('normal, stale, missing and disabled evidence clears the continuity record',async()=>{
 for(const change of ['normal','stale','missing','disabled']){
  const f=rules({duration:1});await f.evaluate();assert(f.storage.has('ecoTrack_violation_start_rule_node_evidence'));
  if(change==='disabled')f.rule.enabled=false;
  await f.evaluate(change==='normal'?{temperature:20}:change==='stale'?{created:'2020-01-01T00:00:00Z'}:change==='missing'?{temperature:null}:{});
  assert(!f.storage.has('ecoTrack_violation_start_rule_node_evidence'));
 }
});
test('reopening after an observation gap resets persisted evidence, while out-of-order packets cannot advance it',async()=>{
 const first=rules({duration:1});await first.evaluate();const reopened=rules({duration:1,storage:first.storage});reopened.advance(10*60000);await reopened.evaluate();assert.equal(reopened.attempts,0);
 const before=reopened.storage.get('ecoTrack_violation_start_rule_node_evidence');await reopened.evaluate({created:new Date(reopened.c.Date.now()-5000).toISOString()});assert.equal(reopened.storage.get('ecoTrack_violation_start_rule_node_evidence'),before);
});
function maintenance(){
 const source=read('public/js/maintenance-modal.js'),c={Date,console,window:{},localStorage:{getItem(){return null;},setItem(){}},formatMaintenanceUpdateTime:(_value,fallback)=>fallback};vm.createContext(c);
 for(const [start,end] of [['  function isActualRepairTask(','  function getChildRepairReportsFor('],['  function getChildRepairReportsFor(','  function resolvePhotoUrl('],['  function syncReportsWithLinkedRepairs(','  function getReportsLocal(']])vm.runInContext(source.slice(source.indexOf(start),source.indexOf(end)),c);
 return c;
}
const report=(status='In Progress',type='Preventive Maintenance')=>({id:'report',status,type,tasks:[{id:'filter',name:'Filter',status:'Completed',verified:false}],timeline:[],created:'2026-10-25T00:00:00Z'});
test('complete but unsubmitted normal and repair reports remain in progress through normalization and reconciliation',()=>{
 const m=maintenance();for(const type of ['Preventive Maintenance','Corrective Repair']){
  const r=m.normalizeReport(report('In Progress',type));assert.equal(r.status,'In Progress');m.syncReportsWithLinkedRepairs([r]);assert.equal(r.status,'In Progress');assert.equal(m.isReportSubmittedForVerification(r),false);
 }
});
test('explicit submissions and approved reports retain their server status',()=>{
 const m=maintenance();for(const status of ['For Verification','Pending Verification','Awaiting Admin Verification']){const r=m.normalizeReport(report(status));assert.equal(r.status,'For Verification');m.syncReportsWithLinkedRepairs([r]);assert.equal(r.status,'For Verification');}
 assert.equal(m.normalizeReport(report('Completed')).status,'Completed');
});
test('unsubmitted corrective work does not make its parent ready for verification',()=>{
 const m=maintenance(),parent=report('Under Repair');parent.tasks[0].status='Under Repair';parent.tasks[0].linkedRepairId='repair';
 const child={...report('In Progress','Corrective Repair'),id:'repair',parentReportId:'report'};assert.equal(m.isRepairReportDone(child),false);m.syncReportsWithLinkedRepairs([parent,child]);assert.equal(parent.status,'Under Repair');assert.equal(parent.tasks[0].verified,false);
});
test('Maintenance table and counters use submission status independently of checklist percentage',()=>{
 const source=read('public/staff.html'),start=source.indexOf('      function getEffectiveReportStatus('),end=source.indexOf('\n      }\n',start)+9;
 assert(start>=0&&end>start);const c={window:{EcoTrackMaintenance:{getReports:()=>[]}}};vm.createContext(c);vm.runInContext(source.slice(start,end),c);
 for(const type of ['Preventive Maintenance','Corrective Repair'])assert.equal(c.getEffectiveReportStatus(report('In Progress',type)),'In Progress');
 assert.equal(c.getEffectiveReportStatus(report('For Verification')),'For Verification');assert.equal(c.getEffectiveReportStatus(report('Completed')),'Completed');
});
function forecast(){const c={window:{},Date,DOMException,AbortController,setTimeout,clearTimeout};vm.createContext(c);vm.runInContext(read('public/js/future-cost.js'),c);return c.window.EcoTrackFutureCost;}
function pdf(){return {tables:[],lastAutoTable:{finalY:50},internal:{pageSize:{getWidth:()=>297,getHeight:()=>210}},addPage(){},setFont(){},setFontSize(){},setTextColor(){},text(){},splitTextToSize:value=>[value],autoTable(value){this.tables.push(value);}};}
test('future PDF model source follows recorded-control or legacy sensor model metadata',async()=>{
 const f=forecast(),plan={from:'2026-10-26',to:'2026-10-26',hours:'1',days:'everyday'},now=Date.parse('2026-10-25T00:00:00Z');
 for(const [energy,expected] of [[{source:'recorded_ac_control_settings',model:'extra_trees'},'Extra Trees'],[{model:'xgboost'},'Recorded model-history average'],[{model:'random_forest',model_label:'Recorded AC energy estimate'},'Recorded model-history average']]){
  const devices=f.sensorDevices([{id:'monitor',aircon_id:'ac'}],{...energy,available:true,devices:[{node_id:'monitor',aircon_id:'ac',energy_kwh:1,estimated_seconds:3600}]});
  const result=await f.calculate(plan,{source:'sensor',tariff:10,devices},{now}),doc=pdf();f.appendPdf(doc,result);
  const label=doc.tables[0].body.find(row=>row[0]==='Source')[1];assert.match(label,new RegExp(expected));if(expected!=='XGBoost')assert.doesNotMatch(label,/XGBoost/);assert.equal(result.cost,10);
 }
 const doc=pdf();f.appendPdf(doc,{source:'sensor',devices:[],rows:[]});assert.equal(doc.tables[0].body.find(row=>row[0]==='Source')[1],'AC energy estimate');
});
