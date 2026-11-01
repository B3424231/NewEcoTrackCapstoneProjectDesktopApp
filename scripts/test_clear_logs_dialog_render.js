'use strict';
// Compatibility command: The obsolete controller-only Clear All Logs dialog was removed with its page. Validate authoritative empty history/reset and current non-destructive desktop loading/error states.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const env={...process.env,ELECTRON_RUN_AS_NODE:'1'};
if(!env.ECOTRACK_PLAYWRIGHT){
 try{env.ECOTRACK_PLAYWRIGHT=require.resolve('playwright');}
 catch(_){const bundled=path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');if(fs.existsSync(bundled))env.ECOTRACK_PLAYWRIGHT=bundled;}
}
const suites=["test_analytics_reset.js","test_desktop_cleanup_browser.js"];
for(const suite of suites){
 const result=spawnSync(process.execPath,[path.join(__dirname,suite)],{env,stdio:'inherit',windowsHide:true});
 if(result.error)throw result.error;
 if(result.status!==0){process.exitCode=result.status || 1;break;}
}
if(process.versions.electron)require('electron').app.exit(process.exitCode || 0);
