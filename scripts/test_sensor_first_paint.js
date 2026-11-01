"use strict";
// Real pages before DOMContentLoaded, isolated storage and API fixtures only.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.ECOTRACK_PLAYWRIGHT||'playwright');
const root=path.resolve(__dirname,'../public');let browser,server,site;
before(async()=>{
 server=http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/api/')){res.setHeader('content-type','application/json');return res.end(JSON.stringify({items:[],sample_count:0,points:[]}));}
  const file=path.resolve(root,'.'+url.pathname);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}
  res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));site='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
});
after(async()=>{await browser?.close();if(server)await new Promise(r=>server.close(r));});
async function context(theme){
 const ctx=await browser.newContext({viewport:{width:1460,height:1000}});
 await ctx.route('**/*',route=>route.request().url().startsWith(site+'/')?route.continue():route.abort());await ctx.routeWebSocket(/.*/,socket=>socket.close());
 await ctx.route('**/js/supabase-client.js',route=>route.fulfill({contentType:'text/javascript',body:`window.ECOTRACK_CONFIG={backendUrl:${JSON.stringify(site)}};window.supabaseClient={auth:{onAuthStateChange(fn){fn('INITIAL_SESSION',{user:{id:'paint-fixture'}});return {data:{subscription:{unsubscribe(){}}}};}},channel(){return {on(){return this;},subscribe(){return this;}};}};`}));
 await ctx.addInitScript(({site,theme})=>{localStorage.setItem('ecoTrackTheme',theme);localStorage.setItem('ecoTrack_profile_user',JSON.stringify({id:'paint-fixture'}));localStorage.setItem('ecoTrack_workspace_mode','both');
  window.electron={env:{BACKEND_URL:site},on(){},invoke:async()=>({success:true,data:[],nodes:[],aircons:[],buildings:[],floors:[],rooms:[]})};
 },{site,theme});return ctx;
}
for(const theme of ['dark','light'])for(const route of ['analytics','telemetry']){
 test(`${route} ${theme}: theme and canvas exist before the blocking style library finishes`,async()=>{
  const ctx=await context(theme);let release;const gate=new Promise(r=>{release=r;});
  await ctx.route('**/vendor/tailwindcss.js',async route=>{await gate;await route.continue().catch(()=>{});});
  try{const page=await ctx.newPage();await page.goto(site+'/'+route+'.html',{waitUntil:'commit'});await page.waitForFunction(()=>window.EcoTrackMode, null, {polling:25,timeout:3000});
   assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('dark')),theme==='dark','Apply saved theme before deferred scripts');
   assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).backgroundColor),theme==='dark'?'rgb(11, 18, 32)':'rgb(248, 250, 252)','First paint uses the app canvas rather than transparent white');
  }finally{release();await ctx.close();}
 });
 test(`${route} ${theme}: optional libraries cannot block return navigation or cached content`,async()=>{
  const ctx=await context(theme);let release;const gate=new Promise(r=>{release=r;});let blocked=0;
  try{
   const page=await ctx.newPage();await page.goto(site+'/'+route+'.html');await page.waitForFunction(()=>document.getElementById('sensorRefresh')?.getAttribute('aria-busy')==='false');
   await ctx.route(/\/vendor\/(?:chart\.umd|jspdf[^/]*|exceljs\.min)\.js/,async route=>{blocked++;await gate;await route.continue().catch(()=>{});});
   await page.goto(site+'/'+route+'.html',{waitUntil:'commit'});
   await page.waitForFunction(()=>window.EcoDataBus && document.getElementById('sidebar') && document.getElementById('sensorApp')?.getAttribute('aria-busy')==='false',{},{timeout:1800});
   assert.equal(await page.locator('main').evaluate(el=>getComputedStyle(el).opacity),'1','The page must not fade in from invisible on each navigation');
   assert.equal(await page.locator('#sensorApp').isVisible(),true);assert.equal(await page.locator('#sensorLoading').count(),0);
   assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('dark')),theme==='dark');
   release();await page.waitForLoadState('load');
   if(route==='analytics')await page.waitForFunction(()=>Boolean(window.Chart?.getChart('sensorTempChart')));
   else assert.equal(blocked,0,'Telemetry does not fetch graph or export libraries');
  }finally{release();await ctx.close();}
 });
}
