"use strict";
// Real Electron file:// navigation, preload and isolated local API; no production profile or writes.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=process.env.ECOTRACK_AUDIT_ARTIFACTS || path.join(root,'reports/sensor-navigation-flash');
if(!process.versions.electron){
 const {spawn}=require('node:child_process');const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ecotrack-paint-'));
 const env={...process.env,ECOTRACK_PAINT_PROFILE:temp};delete env.ELECTRON_RUN_AS_NODE;
 const child=spawn(require('electron'),[__filename,'--noerrdialogs'],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 let output='';for(const stream of [child.stdout,child.stderr])stream.on('data',value=>{output+=value;});
 const timer=setTimeout(()=>child.kill(),45000);
 child.on('exit',(code,signal)=>{clearTimeout(timer);fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'native.log'),output);console.log(output.slice(-3000));process.exitCode=code || (signal?1:0);});
}else{
 const {app,BrowserWindow,session,ipcMain}=require('electron');const http=require('node:http');
 app.setPath('userData',process.env.ECOTRACK_PAINT_PROFILE);
 let window,server;
 app.whenReady().then(async()=>{
  server=http.createServer((_req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({items:[],sample_count:0,points:[]}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));process.env.BACKEND_URL='http://127.0.0.1:'+server.address().port;
  for(const channel of ['auth-set-session','monitoring-sync-registry','scheduler-fetch-data','notifications-fetch-all','maintenance-fetch-reports','locations-fetch-all'])ipcMain.handle(channel,()=>({success:true,data:[],nodes:[],aircons:[],rooms:[],floors:[],buildings:[]}));
  session.defaultSession.webRequest.onBeforeRequest((details,callback)=>{
   if(/^file:/.test(details.url)&&/\/vendor\/(?:chart\.umd|jspdf[^/]*|exceljs\.min)\.js/.test(details.url))return setTimeout(()=>callback({cancel:false}),2100);
   callback({cancel:/^(https?|wss?):/.test(details.url)&&!details.url.startsWith(process.env.BACKEND_URL+'/')});
  });
  window=new BrowserWindow({show:false,width:1460,height:1000,webPreferences:{preload:path.join(root,'src/preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:false,backgroundThrottling:false}});
  window.webContents.debugger.attach('1.3');fs.mkdirSync(out,{recursive:true});
  await window.loadFile(path.join(root,'public/telemetry.html'));
  const failures=[];window.webContents.on('console-message',event=>{if(/Uncaught|ReferenceError|TypeError/.test(event.message))failures.push(event.message);});
  const evaluate=async expression=>{const result=await window.webContents.debugger.sendCommand('Runtime.evaluate',{expression:'JSON.stringify('+expression+')',returnByValue:true});assert(!result.exceptionDetails);return JSON.parse(result.result.value);};
  for(const theme of ['dark','light'])for(const name of ['analytics','telemetry']){
   await window.webContents.executeJavaScript(`localStorage.setItem('ecoTrackTheme',${JSON.stringify(theme)});localStorage.setItem('ecoTrack_workspace_mode','both');`);
   const domReady=new Promise(resolve=>window.webContents.once('dom-ready',resolve));
   const started=Date.now();const navigation=window.loadFile(path.join(root,'public',name+'.html'));
   await Promise.race([domReady,new Promise((_resolve,reject)=>setTimeout(()=>reject(Error(name+' startup waits for optional libraries')),1500))]);
   let state;
   for(let i=0;i<30;i++){
    state=await evaluate(`({dark:document.documentElement.classList.contains('dark'),title:document.querySelector('main h1')?.textContent,sidebar:!!document.getElementById('sidebar'),hidden:document.getElementById('sensorApp')?.hidden,chart:typeof Chart,isolated:typeof require==='undefined',bridge:typeof window.electron?.invoke,opacity:getComputedStyle(document.querySelector('main')).opacity})`);
    if(state.sidebar&&!state.hidden)break;await new Promise(resolve=>setTimeout(resolve,25));
   }
   assert.equal(state.dark,theme==='dark');assert.equal(state.title,name==='analytics'?'Analytics':'Telemetry');assert(state.sidebar&&!state.hidden);assert(state.isolated);assert.equal(state.bridge,'function');
   const shellReadyMs=Date.now()-started;
   assert.equal(state.opacity,'1','Content must be fully visible on the first rendered frame');
   if(name==='analytics')assert.equal(state.chart,'undefined','Actual file renderer paints before the delayed chart library');
   await window.webContents.debugger.sendCommand('Runtime.evaluate',{expression:'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))',awaitPromise:true});
   fs.writeFileSync(path.join(out,name+'-'+theme+'.png'),(await window.webContents.capturePage()).toPNG());
   console.log('PASS Electron '+name+' '+theme+': visible shell before optional libraries ('+shellReadyMs+' ms)');
   await navigation;
   if(name==='analytics')assert.equal(await evaluate(`Boolean(window.Chart?.getChart('sensorTempChart'))`),true);
  }
  assert.deepEqual(failures,[]);window.destroy();server.close();app.exit(0);
 }).catch(error=>{console.error(error.stack);window?.destroy();server?.close();app.exit(1);});
}
