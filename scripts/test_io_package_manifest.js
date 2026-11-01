'use strict';
// Ask the installed Electron builder which files its actual configuration includes.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {getMainFileMatchers}=require('app-builder-lib/out/fileMatcher');
const root=path.resolve(__dirname,'..'),config=require('../package.json').build;
function included(file){
  const output=path.join(root,'dist'),packager={info:{projectDir:root,buildResourcesDir:config.directories.buildResources,
    config,debugLogger:{isEnabled:false},isPrepackedAppAsar:false}};
  const matchers=getMainFileMatchers(root,path.join(output,'app'),value=>value,{},packager,output,false);
  const target=path.join(root,file),stat={isDirectory:()=>false};
  return matchers.some(matcher=>matcher.createFilter()(target,stat));
}
test('desktop packaging contains active page, preload, backend and sensor model resources',()=>{
  for(const file of ['src/main.js','src/preload.js','public/login.html','public/ir-library.html','public/js/sensor-workspace.js','backend/app.py','backend/ml/control_extra_trees/manifest.json','assets/ecoTrack.png','scripts/wlan_scan.ps1'])
    assert(included(file),'Missing packaged runtime resource: '+file);
});
test('desktop packaging excludes local credentials, device secrets, data and audit fixtures',()=>{
  for(const file of ['.env','backend/.env','backend/telemetry.db','backend/telemetry.db-wal','backend/.ecotrack-monitoring-admin.key','backend/backups/private.db','venv/pyvenv.cfg','scratch/profile/Local State','reports/io-workflow-validation-20261028/previous-REPORT.md','firmware/esp32s3_ecotrack_node/wifi-secrets.h'])
    assert(!included(file),'Private or non-runtime file would be packaged: '+file);
});
test('main-process startup imports are available as built-ins or production dependencies',()=>{
  const builtins=new Set(require('node:module').builtinModules.concat(['electron']));
  const dependencies=require('../package.json').dependencies;
  const main=fs.readFileSync(path.join(root,'src/main.js'),'utf8');
  for(const match of main.matchAll(/^\s*const[^\n]*require\(['"]([^'"]+)['"]\)/gm)){
    const name=match[1];if(name.startsWith('.')||builtins.has(name)||name.startsWith('node:'))continue;
    const packageName=name.startsWith('@')?name.split('/').slice(0,2).join('/'):name.split('/')[0];
    assert(Object.hasOwn(dependencies,packageName),'Unpackaged runtime startup dependency: '+packageName);
  }
});
