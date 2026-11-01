"use strict";
// Actual renderer pages; isolated session storage and local fixture APIs only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.ECOTRACK_PLAYWRIGHT||'playwright');
let browser,server;const root=path.resolve(__dirname,'../public');
(async()=>{
  let offline=false,delay=450,fixtureNodes=[];
  server=http.createServer((req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(pathname.startsWith('/api/'))return setTimeout(()=>{res.setHeader('Content-Type','application/json');if(offline){res.writeHead(503);return res.end('{"error":"Fixture offline"}');}res.end(JSON.stringify({items:pathname==='/api/monitoring/devices'?fixtureNodes:[],summary:{},sync:{enabled:false},sample_count:0,series:[]}));},delay);
    const file=path.resolve(root,'.'+pathname);
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}
    res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const site='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  for(const theme of ['light','dark']){
    const context=await browser.newContext({viewport:{width:1460,height:1000}});
 await require('./helpers/browser-local-api').installLocalApiBridge(context,{backendUrl:site,routeFixtures:true});
    await context.route('**/*',r=>r.request().url().startsWith(site+'/')?r.continue():/tailwind/.test(r.request().url())?r.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(root,'vendor/tailwindcss.js'),'utf8')}):r.abort());await context.routeWebSocket(/.*/,s=>s.close());
    await context.route('**/js/supabase-client.js',r=>r.fulfill({contentType:'text/javascript',body:`window.ECOTRACK_CONFIG={backendUrl:${JSON.stringify(site)}};window.supabaseClient={auth:{onAuthStateChange(fn){fn('INITIAL_SESSION',{user:{id:'isolated-account'}});return {data:{subscription:{unsubscribe(){}}}};}},channel(){return {on(){return this;},subscribe(){return this;}};}};`}));
    await context.addInitScript(({site,theme})=>{
      localStorage.setItem('ecoTrack_profile_user',JSON.stringify({id:'isolated-account'}));localStorage.setItem('ecoTrackTheme',theme);localStorage.setItem('ecoTrack_workspace_mode','both');
      window.electron={env:{BACKEND_URL:site},invoke:async()=>{await new Promise(resolve=>setTimeout(resolve,350));return {success:true,data:[],nodes:[],aircons:[],rooms:[],floors:[],buildings:[],rules:[],ruleNodes:[]};},on(){}};
      window.skeletonSeen=false;
      new MutationObserver(()=>{if(document.getElementById('sensorLoading'))window.skeletonSeen=true;
        if(document.querySelector('#schedulerTableBody .eco-skeleton, #rulesLoadingState:not(.hidden) .eco-skeleton'))window.otherSkeletonSeen=true;
      }).observe(document,{childList:true,subtree:true});
    },{site,theme});
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    for(const route of ['analytics','telemetry']){
      await page.goto(site+'/'+route+'.html',{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>window.skeletonSeen);await page.waitForFunction(()=>document.getElementById('sensorRefresh')?.getAttribute('aria-busy')==='false');
    }
    delay=900;
    for(const route of ['analytics','telemetry']){
      await page.goto(site+'/'+route+'.html',{waitUntil:'domcontentloaded'});
      assert.equal(await page.evaluate(()=>window.skeletonSeen),false,'Return '+route+' never replaces content with skeleton');
      assert.equal(await page.locator('#sensorApp').isVisible(),true);
      await page.waitForFunction(()=>document.getElementById('sensorRefresh')?.getAttribute('aria-busy')==='false');
      assert.equal(await page.evaluate(()=>window.skeletonSeen),false);
      await page.locator('#sensorRefresh').click();assert.equal(await page.locator('#sensorApp').isVisible(),true);
      await page.waitForFunction(()=>document.getElementById('sensorRefresh')?.getAttribute('aria-busy')==='false');
      assert.equal(await page.evaluate(()=>window.skeletonSeen),false,'Manual refresh keeps content');
    }
    for(const route of ['scheduler.html','rules.html']){
      await page.goto(site+'/'+route,{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>window.otherSkeletonSeen===true);
      await page.waitForFunction(()=>!document.querySelector('#schedulerTableBody .eco-skeleton, #rulesLoadingState:not(.hidden) .eco-skeleton'));
      await page.goto(site+'/'+route,{waitUntil:'domcontentloaded'});
      await page.waitForTimeout(1000);
      assert.equal(await page.evaluate(()=>Boolean(window.otherSkeletonSeen)),false,route+' return uses cached content');
    }
    fixtureNodes=[{id:'session-sensor',name:'Session Fixture Sensor',aircon_name:'Session Fixture AC',active:true,fresh:true,status:'Reporting',expected_interval_seconds:30,location:'Fixture Building · Fixture Floor · Fixture Room',latest:{observed_at:new Date().toISOString(),outlet_temperature_c:23.4,rotation_rpm:321,rotation_quality:'ok',ac_on:false}}];
    await page.goto(site+'/telemetry.html');await page.waitForFunction(()=>document.getElementById('sensorRefresh')?.getAttribute('aria-busy')==='false');
    assert.match(await page.locator('#sensorFleet').textContent(),/321 RPM/);
    await page.goto(site+'/telemetry.html',{waitUntil:'domcontentloaded'});
    assert.match(await page.locator('#sensorFleet').textContent(),/321 RPM/,'Saved measured value is restored before network response');
    await page.waitForFunction(()=>document.getElementById('sensorRefresh')?.getAttribute('aria-busy')==='false');
    await page.evaluate(()=>{const key=[...window.EcoDataBus.cache.keys()].find(key=>key.startsWith('sensor-energy-v4:telemetry:')&&window.EcoDataBus.getCached(key)?.nodes?.length);const saved=window.EcoDataBus.getCached(key);saved.nodes[0].latest.observed_at=new Date(Date.now()-120000).toISOString();window.EcoDataBus.mutate(key,saved);});
    await page.goto(site+'/telemetry.html',{waitUntil:'domcontentloaded'});
    assert.doesNotMatch(await page.locator('#sensorFleet').textContent(),/321 RPM/,'An aged snapshot is not presented as a live measurement');
    assert.match(await page.locator('#sensorFleet').textContent(),/Stale/);
    fixtureNodes=[];
    offline=true;await page.goto(site+'/analytics.html',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.getElementById('sensorRefresh')?.getAttribute('aria-busy')==='false');
    assert.equal(await page.evaluate(()=>window.skeletonSeen),false);assert.match(await page.locator('#sensorConnection').textContent(),/cached|previously/i);
    assert.deepEqual(errors,[]);offline=false;delay=450;await context.close();console.log('PASS '+theme+': first visit, return visit, refresh and failed refresh');
  }
})().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(async()=>{await browser?.close();if(server)await new Promise(r=>server.close(r));});
