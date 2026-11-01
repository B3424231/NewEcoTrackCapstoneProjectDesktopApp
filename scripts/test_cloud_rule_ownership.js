'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const values=new Map(),storage={getItem:key=>values.get(key)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
let calls=0,available=true;
const window={addEventListener(){},localStorage:storage,supabaseClient:{rpc:async name=>{assert.equal(name,'ecotrack_cloud_rule_evaluation');calls++;return available?{data:true,error:null}:{data:null,error:{code:'PGRST202'}};}}};
const context=vm.createContext({window,localStorage:storage,document:{addEventListener(){}},console,Date,setTimeout,clearTimeout,setInterval(){},URL,Intl,AbortSignal});
vm.runInContext(fs.readFileSync('public/js/global-notifications.js','utf8'),context);
(async()=>{
 const owns=vm.runInContext('cloudOwnsRuleSample',context);
 assert.equal(await owns({id:'local-only'}),false);assert.equal(calls,0);
 const client=window.supabaseClient;window.supabaseClient=null;assert.equal(await owns({id:'cloud',last_measurement_report_id:'boot-1',last_measurement_at:new Date().toISOString()}),false);window.supabaseClient=client;
 assert.equal(await owns({id:'cloud',last_measurement_report_id:'boot-1',last_measurement_at:new Date().toISOString()}),true);
 assert.equal(await owns({id:'cloud',last_measurement_report_id:'boot-2',last_measurement_at:new Date().toISOString()}),true);assert.equal(calls,1);
 available=false;vm.runInContext('cloudRuleCapabilityUntil=0',context);assert.equal(await owns({id:'cloud',last_measurement_report_id:'boot-3',last_measurement_at:new Date().toISOString()}),true);
 console.log('PASS cloud-owned observations skip desktop generation while local-only sensors retain their evaluator');
})().catch(error=>{console.error(error);process.exitCode=1;});
