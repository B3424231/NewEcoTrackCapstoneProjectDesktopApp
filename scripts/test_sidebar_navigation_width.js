"use strict";
// Actual Maintenance and Forecast renderers; isolated storage, no live cloud/database/hardware.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.ECOTRACK_PLAYWRIGHT||'playwright');
const root=path.resolve(__dirname,'..'),out=process.env.ECOTRACK_AUDIT_ARTIFACTS || path.join(root,'reports/sidebar-navigation');let browser,server;
fs.mkdirSync(out,{recursive:true});const results=[];
(async()=>{
 server=http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/api/')){res.setHeader('content-type','application/json');return res.end(JSON.stringify({items:[],total:0,totalItems:0,points:[],sample_count:0,available:false,code:'SENSOR_MODEL_UNAVAILABLE'}));}
  const file=path.resolve(root,'public','.'+url.pathname);if(!file.startsWith(path.join(root,'public')+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}
  res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'})[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const site='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const failures=[];
 for(const theme of ['dark','light'])for(const collapsed of [false,true]){
  const context=await browser.newContext({viewport:{width:1460,height:1000}}),errors=[];
  await context.route('**/*',r=>r.request().url().startsWith(site+'/')?r.continue():r.request().url().startsWith('https://cdn.tailwindcss.com')?r.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(root,'public/vendor/tailwindcss.js'),'utf8')}):r.abort());
  await context.routeWebSocket(/.*/,socket=>socket.close());
  // Delay page work, not the sidebar cache, to inspect frames before DOMContentLoaded.
  await context.route(/\/(?:js\/staff\.js|vendor\/exceljs\.min\.js)(?:\?|$)/,async route=>{await new Promise(resolve=>setTimeout(resolve,650));await route.continue();});
  await context.route('**/js/supabase-client.js',r=>r.fulfill({contentType:'text/javascript',body:`window.ECOTRACK_CONFIG={backendUrl:${JSON.stringify(site)}};const query={select(){return this},order(){return this},eq(){return this},limit(){return this},maybeSingle(){return this},abortSignal(){return this},then(resolve){resolve({data:[],error:null})}};window.supabaseClient={from(){return query},rpc:async()=>({data:[],error:null}),auth:{getSession:async()=>({data:{session:{user:{id:'sidebar-fixture'}}}}),onAuthStateChange(fn){fn('INITIAL_SESSION',{user:{id:'sidebar-fixture'}});return {data:{subscription:{unsubscribe(){}}}}}},channel(){return {on(){return this},subscribe(){return this}}}};`}));
  await context.addInitScript(({site,theme,collapsed,template,templateVersion})=>{
   localStorage.setItem('ecoTrackTheme',theme);localStorage.setItem('ecoTrack_workspace_mode','both');localStorage.setItem('ecoTrack_profile_user',JSON.stringify({id:'sidebar-fixture'}));localStorage.setItem('ecoTrack_backend_url',site);localStorage.setItem('sidebarCollapsed',String(collapsed));
   sessionStorage.setItem('ecoTrack_sidebar_ver',templateVersion);sessionStorage.setItem('ecoTrack_sidebar_html',template);
   window.electron={env:{BACKEND_URL:site},on(){},invoke:async()=>({success:true,data:[],nodes:[],aircons:[],rooms:[],floors:[],buildings:[],rules:[],ruleNodes:[]})};
   window.sidebarWidths=[];const sample=()=>{const el=document.getElementById('sidebar');if(el){const css=getComputedStyle(el);window.sidebarWidths.push({width:el.getBoundingClientRect().width,collapsed:el.classList.contains('collapsed'),transition:css.transitionProperty,time:Math.round(performance.now())});}else if(document.querySelector('main')){window.sidebarWidths.push({width:0,missing:true,time:Math.round(performance.now())});}requestAnimationFrame(sample);};requestAnimationFrame(sample);
  },{site,theme,collapsed,template:fs.readFileSync(path.join(root,'public/sidebar-template.html'),'utf8'),templateVersion:fs.readFileSync(path.join(root,'public/js/sidebar-loader.js'),'utf8').match(/const SIDEBAR_VERSION = '([^']+)'/)[1]});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  for(const route of ['staff.html','sensor-logs.html']){
   await page.goto(site+'/'+route,{waitUntil:'domcontentloaded'});await page.locator('#sidebar').waitFor();await page.waitForTimeout(1300);
   const frames=await page.evaluate(()=>window.sidebarWidths),min=Math.min(...frames.map(f=>f.width)),max=Math.max(...frames.map(f=>f.width));
   console.log(JSON.stringify({route,theme,collapsed,min,max,first:frames.slice(0,4),last:frames.slice(-1)}));
   try{assert(frames.length>5);assert(frames.every(frame=>!frame.missing),'The sidebar is present while page content is visible, before delayed page scripts finish');assert(frames.every(frame=>frame.collapsed===collapsed),'Saved state remains unchanged');assert(frames.every(frame=>Math.abs(frame.width-(collapsed?100:256))<1),'Sidebar stays at its saved width from the first rendered frame');}catch(error){failures.push({route,theme,collapsed,error:error.message,min,max});}
   results.push({route,theme,collapsed,frames:frames.length,min,max,missingFrames:frames.filter(frame=>frame.missing).length});
   await page.screenshot({path:path.join(out,`${route.replace('.html','')}-${theme}-${collapsed?'collapsed':'expanded'}.png`)});
   // Early shell initialization must keep each control connected only once.
   await page.evaluate(()=>{initSidebarModules();initSidebarModules();});
   await page.locator('#sidebarToggle').click();
   assert.equal(await page.locator('#sidebar').evaluate(el=>el.classList.contains('collapsed')),!collapsed,'One click changes state once');
   assert.equal(await page.evaluate(()=>localStorage.getItem('sidebarCollapsed')),String(!collapsed));
   await page.locator('#sidebarToggle').click();
   assert.equal(await page.locator('#sidebar').evaluate(el=>el.classList.contains('collapsed')),collapsed);
   await page.locator('#logoutButton').click();await page.locator('#logoutModal').waitFor({state:'visible'});
   await page.locator('#logoutCancel').click();await page.locator('#logoutModal').waitFor({state:'hidden'});
  }
  if(errors.length)console.log(JSON.stringify({theme,collapsed,rendererErrors:errors}));
  assert.deepEqual(errors,[],'No renderer errors');
  await context.close();
 }
 fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify({results,failures},null,2));
 assert.deepEqual(failures,[],'No transient sidebar collapse/expansion during navigation');
})().catch(error=>{console.error(error.stack);process.exitCode=1;}).finally(async()=>{await browser?.close();if(server)await new Promise(r=>server.close(r));});
