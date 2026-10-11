'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('public/js/logs.js','utf8'),checks=[];
const section=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
let rows=[],rendered=[],predicted,warningCount=0;const elements=new Map();
const body={closest:()=>null,replaceChildren:fragment=>{rendered=fragment.rows},set innerHTML(value){rendered=[];this.empty=value}};
const context=vm.createContext({window:{EcoToast:{warning(){warningCount++}}},console:{log(){},error(){}},Date,
 currentPeriod:'daily',currentPage:1,PAGE_SIZE:20,nodeDataLogs:[],controlNameMap:{},locationMap:{},globalAirconMap:{},
 document:{getElementById:id=>id==='logsTableBody'?body:elements.get(id)||elements.set(id,{}).get(id),
 createDocumentFragment:()=>({rows:[],appendChild(row){this.rows.push(row)}}),createElement:()=>({})},
 populateDateRangeOptions(){},getFilteredLogs:()=>rows,calculateStats:()=>({totalRecords:rows.length,avgTemp:'--',onlineNodes:1}),
 updateActiveFilterBadge(){},predictEnergyConsumption(_stats,history){predicted=history},
 getBatteryPercentage:()=>0,getSignalIcon:()=>'-55 dBm'});
vm.runInContext(fs.readFileSync('public/js/aircon-state.js','utf8'),context);
vm.runInContext(section('function getAnalyticsRecordingPower(','function getRuntimeIntervalMs('),context);
vm.runInContext(section('function render({','// ── REDESIGNED EXECUTIVE EXCEL'),context);
vm.runInContext(section('async function exportExcelLogs()','async function exportLogs()'),context);
vm.runInContext(section('async function exportLogs()','async function addExtraPdfSections('),context);
const time=n=>'2026-10-10T09:00:0'+n+'Z',row=(name,snapshot,extra={})=>({nodeId:name,controlName:name,status:'online',
 timestamp:new Date(time(1)),temperature:null,controlSnapshot:snapshot,...extra});
async function main(){
 const on=row('Earlier ON reading',{observed_remote_state:{power:true,mode:'cool',fan:'auto'},observed_remote_at:time(1)});
 const off=row('OFF remote',{desired_state:{power:true},commanded_at:time(1),observed_remote_state:{power:false},observed_remote_at:time(2)},{acOn:true});
 const heartbeat=row('Connectivity only',null);
 rows=[on,off,heartbeat];context.render();
 assert.equal(rendered.length,1);assert(rendered[0].innerHTML.includes('Earlier ON reading'));
 assert.equal(elements.get('pageInfo').textContent,'Showing 1-1 of 1');
 assert.equal(elements.get('totalRecords').textContent,1);
 assert.equal(predicted.length,3,'Keep historical OFF anchors available to energy/runtime calculations.');
 checks.push('The table and counters show ON history only, while energy calculations retain their existing history inputs.');
 rows=[off,heartbeat];context.render({preserveScroll:true});
 assert.equal(rendered.length,0);assert(body.empty.includes('colspan="12"'));
 assert.equal(elements.get('pageInfo').textContent,'Showing 0 of 0 logs');
 assert.equal(elements.get('totalRecords').textContent,0);
 await context.exportExcelLogs();await context.exportLogs();
 assert.equal(warningCount,2);
 checks.push('OFF and connectivity-only rows disappear without reload and cannot be exported as operating readings.');
 rows=[on];context.render({preserveScroll:true});assert.equal(rendered.length,1);
 assert.equal(on.controlSnapshot.observed_remote_state.power,true);
 checks.push('Earlier valid ON readings remain visible when the controller later turns OFF; history is never rewritten.');
 const newest={desired_state:{power:false},commanded_at:time(1),observed_remote_state:{power:true},observed_remote_at:time(2)};
 assert.equal(context.getAnalyticsRecordingPower(row('Remote ON',newest)),true);
 assert.equal(context.getAnalyticsRecordingPower(row('Old power field',{...newest,observed_remote_field_at:{power:time(0)}})),false);
 assert.equal(context.getAnalyticsRecordingPower(row('Serialized',JSON.stringify(newest))),true);
 assert.equal(context.getAnalyticsRecordingPower(row('Legacy explicit ON',null,{acOn:true})),true);
 checks.push('Receiver power timestamps, serialized snapshots and explicit legacy ON readings use the same gate.');
 fs.writeFileSync('reports/ac-off-recording/ui-tests.json',JSON.stringify({passed:checks.length,checks,live_hardware_tested:false},null,2));
 console.log('AC recording UI: '+checks.length+' scenario groups passed.');
}
main().catch(error=>{console.error(error);process.exitCode=1});
