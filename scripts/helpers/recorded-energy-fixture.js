'use strict';
// Seed only the caller's disposable database through the real trusted ingestion
// boundary. Synthetic independent feedback is explicit and never sent to hardware.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
function seedRecordedEnergyFixture({root,directory,deviceId,samples}){
 const file=path.join(directory,'recorded-energy-fixture.json');
 const recorded=samples.map(sample=>({...sample,ac_on:true,state_source:'power_meter',control_snapshot:{
  configured_state:{temp:21,fan:'auto',mode:'cool'},
  reported_state:{fan_setting_percent:80,fan_input_basis:'manufacturer_fan_setting'},reported_at:sample.observed_at
 }}));
 fs.writeFileSync(file,JSON.stringify({device_id:deviceId,samples:recorded}));
 execFileSync(path.join(root,'venv/Scripts/python.exe'),['-c','import json,sys;from backend.app import monitoring_service;monitoring_service.ingest(json.load(open(sys.argv[1],encoding="utf-8")),trusted=True)',file],{
  cwd:root,windowsHide:true,stdio:'pipe',env:{...process.env,PYTHONUTF8:'1',ECOTRACK_SQLITE_DB_PATH:path.join(directory,'telemetry.db'),ECOTRACK_TELEMETRY_SYNC:'0',ECOTRACK_MONITOR_SYNC:'0'}
 });
}
module.exports={seedRecordedEnergyFixture};
