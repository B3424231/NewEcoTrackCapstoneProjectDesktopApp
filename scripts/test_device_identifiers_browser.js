'use strict';
// Actual IR Studio with isolated profiles and a recorded adapter; never reaches hardware or a database.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.ECOTRACK_PLAYWRIGHT||'playwright');
const root=path.resolve(__dirname,'..'),publicRoot=path.join(root,'public');
const out=process.env.ECOTRACK_DEVICE_ID_REPORT||path.join(root,'reports/device-identifiers');
const raw='esp32s3-9cd20604a7ac',canonical='AC-'+raw;
let server,browser;
(async()=>{
  fs.mkdirSync(out,{recursive:true});
  server=http.createServer((req,res)=>{
    const file=path.resolve(publicRoot,'.'+new URL(req.url,'http://localhost').pathname);
    if(!file.startsWith(publicRoot+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}
    res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'})[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const site='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({executablePath:process.env.ECOTRACK_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const checks=[];
  for(const width of [320,768,1024,1440])for(const theme of ['light','dark']){
    const context=await browser.newContext({viewport:{width,height:1000}}),errors=[],writes=[];
    await context.addInitScript(({theme,width})=>{
      localStorage.setItem('ecoTrack_workspace_mode','both');localStorage.setItem('ecoTrackTheme',theme);localStorage.setItem('sidebarCollapsed',String(width<760));
      window.electron={env:{},on(){},invoke:async()=>({success:false,error:'Isolated fixture'})};
    },{theme,width});
    const fixture=`(()=>{
      const node={node_id:${JSON.stringify(raw)},db_id:'fixture-controller',name:'AcController1',status:'Offline',device_mode:'both'};
      const profile={device_id:${JSON.stringify(canonical)},aircon_id:'fixture-ac',node_id:node.node_id,controller_node_id:node.db_id,name:'Matrix',protocol_name:'TCL112AC'};
      const orphans=[{device_id:'Aircon Matrix',aircon_id:'orphan-one',name:'Aircon Matrix',node_id:null,controller_node_id:null},
        {device_id:'Matrix',aircon_id:'orphan-two',name:'Matrix',node_id:'deleted-device',controller_node_id:'deleted-controller'}];
      window.fixtureIR={node,profile,orphans,profiles:[...orphans,profile],nodes:[node],commands:[],emit(event){
        localStorage.setItem('ecoTrack_nodes',JSON.stringify(this.nodes));
        localStorage.setItem('ecoTrack_aircons',JSON.stringify(this.profiles));
        window.EcoTrackAirconSystem?.AirconEvents.emit(event,{},false);
      }};
      window.fixtureIR.emit('devices:synced');
    })();\n`+fs.readFileSync(path.join(publicRoot,'js/aircon-system.js'),'utf8')+`\n(()=>{
      Object.assign(window.EcoTrackAirconSystem.ProtocolAdapter,{
        getStorageStatus:()=>({ready:true,error:null}),
        sniffProtocol:async id=>{window.fixtureIR.commands.push({kind:'sniff',id});return {success:false,message:'Isolated receiver: no remote frame'};},
        getLatestLearned:async id=>{window.fixtureIR.commands.push({kind:'latest',id});return {success:false,message:'No fixture frame'};}
      });
    })();`;
    await context.route('**/*',route=>{
      const request=route.request(),url=request.url();
      if(!['GET','HEAD'].includes(request.method())){writes.push({method:request.method(),url});return route.abort();}
      if(url==='https://cdn.tailwindcss.com/')return route.fulfill({path:path.join(publicRoot,'vendor/tailwindcss.js'),contentType:'text/javascript'});
      if(url.startsWith(site+'/js/supabase.umd.js')||url.startsWith(site+'/js/supabase-client.js'))return route.fulfill({body:'/* Isolated fixture has no cloud client. */',contentType:'text/javascript'});
      if(url.startsWith(site+'/js/aircon-system.js'))return route.fulfill({body:fixture,contentType:'text/javascript'});
      if(url.startsWith(site+'/'))return route.continue();return route.abort();
    });
    await context.routeWebSocket(/.*/,socket=>socket.close());
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    await page.goto(site+'/ir-library.html?id='+encodeURIComponent(canonical));
    await page.waitForFunction(id=>document.getElementById('targetNodeBadge')?.textContent===id,canonical);
    assert(await page.getByText('Controller Node ID',{exact:true}).isVisible());
    const select=page.locator('#targetDeviceSelect');assert.equal(await select.inputValue(),canonical);
    assert.equal((await select.locator('option:checked').innerText()).trim(),'AcController1 | AC unit: Matrix');
    assert.equal(await select.locator('option').count(),1,'Saved assets without a registered controller must not appear as unnamed IR targets');
    assert(!(await select.innerText()).includes('Controller ID:'),'The target selector shows names; the separate badge retains the full ID');
    const trigger=page.locator('[data-select-id="targetDeviceSelect"]');
    await trigger.focus();await trigger.press('ArrowDown');
    assert(await page.getByRole('listbox').isVisible());
    assert.equal(await page.getByRole('option').count(),1);
    await trigger.press('Enter');assert.equal(await select.inputValue(),canonical);
    await trigger.click();
    const bounds=await page.getByRole('listbox').boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=width,'The open target dropdown fits the viewport');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'The page has no horizontal overflow');
    await page.screenshot({path:path.join(out,`ir-controller-id-${width}-${theme}.png`),fullPage:true});
    await trigger.press('Escape');assert.equal(await trigger.getAttribute('aria-expanded'),'false');
    const before=await page.evaluate(()=>JSON.stringify({node:window.fixtureIR.node,profile:window.fixtureIR.profile}));
    await page.locator('#autoDetectBtn').click();await page.waitForFunction(()=>!document.getElementById('autoDetectBtn').disabled);
    await page.locator('#latestLearnedFrameBtn').click();await page.waitForFunction(()=>window.fixtureIR.commands.length===2);
    assert.deepEqual(await page.evaluate(()=>window.fixtureIR.commands),[{kind:'sniff',id:raw},{kind:'latest',id:raw}]);
    assert.equal(await page.evaluate(()=>JSON.stringify({node:window.fixtureIR.node,profile:window.fixtureIR.profile})),before,'Displaying canonical IDs never mutates stored identities or protocols');
    await page.evaluate(()=>{fixtureIR.node.name='Renamed controller';fixtureIR.emit('node:updated');});
    assert.equal((await select.locator('option:checked').innerText()).trim(),'Renamed controller | AC unit: Matrix');
    await page.evaluate(()=>{fixtureIR.profile.controller_node_id=null;fixtureIR.profile.node_id=fixtureIR.node.name;fixtureIR.emit('devices:synced');});
    assert.equal((await select.locator('option:checked').innerText()).trim(),'Renamed controller | AC unit: Matrix','Legacy controller-name links resolve the saved display name');
    await page.evaluate(()=>{fixtureIR.profile.node_id=fixtureIR.node.node_id;fixtureIR.profile.controller_node_id='retired-controller';fixtureIR.emit('devices:synced');});
    assert.equal(await select.inputValue(),'','A stale authoritative assignment must not fall back to a different registered controller');
    assert(await page.locator('#autoDetectBtn').isDisabled());assert(await page.locator('#latestLearnedFrameBtn').isDisabled());
    await page.evaluate(()=>{fixtureIR.profile.controller_node_id=fixtureIR.node.db_id;fixtureIR.emit('devices:synced');});
    assert.equal(await select.inputValue(),canonical,'Restoring a valid offline assignment makes it selectable again');
    await page.evaluate(()=>{fixtureIR.nodes=[];fixtureIR.emit('devices:synced');});
    assert.equal(await select.inputValue(),'','Deleting the controller immediately clears the current target');
    assert(await page.locator('#autoDetectBtn').isDisabled());assert(await page.locator('#latestLearnedFrameBtn').isDisabled());
    assert(await page.locator('#learnedFramePanel').isHidden());
    assert(await trigger.isDisabled());
    assert(!(await select.innerText()).includes('Unnamed controller'));
    assert.match(await select.innerText(),/No AC units linked to registered controllers/);
    const emptyBounds=await trigger.boundingBox();assert(emptyBounds.x>=0&&emptyBounds.x+emptyBounds.width<=width,'The empty-state target field fits the viewport');
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('ecoTrack_aircons')).length),3,'Filtering targets preserves the saved AC assets');
    await page.locator('#toastContainer').evaluate(element=>element.replaceChildren());
    await page.screenshot({path:path.join(out,`ir-no-registered-controller-${width}-${theme}.png`),fullPage:true});
    assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
    checks.push({width,theme,status:'PASS',canonical_id:true,target_selector_names_only:true,keyboard_dropdown:true,viewport_fit:true,orphan_assets_excluded:true,legacy_names:true,offline_controller:true,stale_assignment_excluded:true,deleted_controller_clears_target:true,saved_assets_preserved:true,raw_command_destinations:true,runtime_errors:errors,external_writes:writes.length});
    await context.close();
  }
  fs.writeFileSync(path.join(out,'ir-device-identifiers.json'),JSON.stringify({status:'PASS',checks},null,2));console.log(JSON.stringify({status:'PASS',checks},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();await new Promise(resolve=>server?server.close(resolve):resolve());});
