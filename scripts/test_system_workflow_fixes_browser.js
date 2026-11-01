'use strict';
// Full maintenance module and real PDF libraries; all state is isolated browser storage.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.ECOTRACK_PLAYWRIGHT||'playwright');
const root=process.env.ECOTRACK_DESKTOP_ROOT||path.resolve(__dirname,'..'),out=process.env.ECOTRACK_WORKFLOW_FIX_OUT||path.join(require('node:os').tmpdir(),'ecotrack-workflow-fix-browser');
fs.mkdirSync(out,{recursive:true});let browser,server;
(async()=>{
 server=http.createServer((req,res)=>{
  const name=new URL(req.url,'http://localhost').pathname;
  if(name==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end('<!doctype html><html><head><meta charset="utf-8"><title>Isolated maintenance regression</title></head><body></body></html>');}
  const file=path.resolve(root,'public','.'+decodeURIComponent(name)),base=path.join(root,'public');
  if(!file.startsWith(base+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.woff2':'font/woff2'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const site='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const results=[],errors=[];
 for(const repair of [false,true])for(const submitted of [false,true]){
  const context=await browser.newContext({viewport:{width:1460,height:1000},timezoneId:'Asia/Singapore'});
  await context.route('**/*',route=>route.request().url().startsWith(site)?route.continue():route.abort());
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',msg=>{if(msg.type()==='error'&&/render error|Uncaught/.test(msg.text()))errors.push(msg.text());});
  await page.goto(site);
  await page.evaluate(({repair,submitted})=>{
   localStorage.setItem('ecoTrack_maintenance_reports',JSON.stringify([{id:repair?'REP-1001':'MR-1001',status:submitted?'For Verification':'In Progress',type:repair?'Corrective Repair':'Preventive Maintenance',aircon_name:'Isolated AC',room_name:'Isolated room',staff_name:'Isolated technician',created:'2026-10-25T00:00:00Z',tasks:[{id:'filter',name:'Inspect filter',status:'Completed',verified:false}],timeline:submitted?[{title:'Submitted for admin verification'}]:[]}]));
   window.EcoTrackMode={mode:'both'};
  },{repair,submitted});
  await page.addScriptTag({path:path.join(root,'scratch/step3-qa-tailwind.js')});await page.addStyleTag({url:site+'/styles.css'});
  await page.addScriptTag({url:site+'/js/maintenance-modal.js'});
  const staff=fs.readFileSync(path.join(root,'public/staff.html'),'utf8').replace(/\r\n/g,'\n'),start=staff.indexOf('      function getEffectiveReportStatus('),end=staff.indexOf('\n      }\n',start)+9;
  await page.addScriptTag({content:staff.slice(start,end)});
  assert.equal(await page.evaluate(()=>getEffectiveReportStatus(EcoTrackMaintenance.getReports()[0])),submitted?'For Verification':'In Progress');
  const id=repair?'REP-1001':'MR-1001';await page.evaluate(id=>EcoTrackMaintenance.openDetailModal(id),id);
  const modal=page.locator('#ecoReportDetailModal');await modal.waitFor({state:'visible'});
  const header=await page.locator('#ecoDetailModalHeader').innerText();
  if(submitted)assert.match(header,/For Verification/);else assert.doesNotMatch(header,/For Verification/);
  assert.equal(await page.evaluate(()=>EcoTrackMaintenance.getReports()[0].status),submitted?'For Verification':'In Progress');
  if(repair)assert.equal(await page.locator('#btnVerifyRepOrder').count(),submitted?1:0);
  if(!submitted)assert.equal(await modal.getByRole('button',{name:/^Verify Report/}).count(),0);
  await page.waitForTimeout(350);await page.screenshot({path:path.join(out,(repair?'repair':'maintenance')+'-'+(submitted?'submitted':'progress')+'.png'),fullPage:true});
  await page.evaluate(id=>EcoTrackMaintenance.openChecklistItemModal(id,'filter'),id);
  assert.equal(await page.locator('#btnVerifyChecklistItem').count(),submitted?1:0,'Checklist approval requires explicit report submission');
  results.push((repair?'Repair':'Maintenance')+' '+(submitted?'submission enables review':'complete checklist stays in progress without review'));
  await context.close();
 }
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(site);
 for(const script of ['vendor/jspdf.umd.min.js','vendor/jspdf.plugin.autotable.min.js','js/future-cost.js'])await page.addScriptTag({url:site+'/'+script});
 for(const source of ['recorded_ac_control_settings','legacy_sensor']){
  const encoded=await page.evaluate(async source=>{
   const devices=EcoTrackFutureCost.sensorDevices([{id:'monitor',aircon_id:'ac',aircon_name:'Isolated AC'}],{source,model:source==='recorded_ac_control_settings'?'extra_trees':'xgboost',available:true,devices:[{node_id:'monitor',aircon_id:'ac',energy_kwh:1,estimated_seconds:3600}]});
   const result=await EcoTrackFutureCost.calculate({from:'2026-10-26',to:'2026-10-26',hours:'1',days:'everyday'},{source:'sensor',devices,tariff:13.24},{now:Date.parse('2026-10-25T00:00:00Z')});
   const doc=new jspdf.jsPDF();EcoTrackFutureCost.appendPdf(doc,result);return doc.output('datauristring').split(',')[1];
  },source);
  const data=Buffer.from(encoded,'base64');assert(data.subarray(0,4).equals(Buffer.from('%PDF')));
  assert(data.includes(Buffer.from(source==='recorded_ac_control_settings'?'Extra Trees':'Recorded model-history average')));
  if(source==='recorded_ac_control_settings')assert(!data.includes(Buffer.from('XGBoost')));
  fs.writeFileSync(path.join(out,source+'.pdf'),data);
 }
 results.push('Real future-cost PDFs identify the controls model and explicit legacy sensor model separately');
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({status:'PASS',results,errors},null,2));console.log(JSON.stringify({status:'PASS',results},null,2));
})().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(async()=>{await browser?.close();if(server)await new Promise(r=>server.close(r));});
