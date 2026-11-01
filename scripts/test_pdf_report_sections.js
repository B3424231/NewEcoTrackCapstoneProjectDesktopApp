'use strict';
// Compatibility command: The retired controller-log PDF builder is no longer shipped. The current sensor PDF/Excel regression suite validates real exports, empty/zero/missing data and selected scope.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const env={...process.env,ELECTRON_RUN_AS_NODE:'1'};
if(!env.ECOTRACK_PLAYWRIGHT){
 try{env.ECOTRACK_PLAYWRIGHT=require.resolve('playwright');}
 catch(_){const bundled=path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');if(fs.existsSync(bundled))env.ECOTRACK_PLAYWRIGHT=bundled;}
}
const suites=["test_sensor_report_format.js"];
for(const suite of suites){
 const result=spawnSync(process.execPath,[path.join(__dirname,suite)],{env,stdio:'inherit',windowsHide:true});
 if(result.error)throw result.error;
 if(result.status!==0){process.exitCode=result.status || 1;break;}
}
if(process.versions.electron)require('electron').app.exit(process.exitCode || 0);
