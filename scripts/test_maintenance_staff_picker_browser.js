'use strict';
// Render the actual maintenance staff template and handlers with isolated local fixtures.
// External requests are blocked; this script has no application/database credentials.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.ECOTRACK_PLAYWRIGHT||'C:/Users/reygay/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'..'),publicDir=path.join(root,'public');
const out=process.env.ECOTRACK_AUDIT_ARTIFACTS||path.join(root,'reports/ui-repairs-20261030/maintenance-staff-picker');
const source=fs.readFileSync(path.join(publicDir,'js/maintenance-modal.js'),'utf8').replace(/\r\n/g,'\n');
function section(a,b){const start=source.indexOf(a),end=source.indexOf(b,start+a.length);assert(start>=0&&end>start,a);return source.slice(start,end);}
const template=section('            <label id="modalStaffPickerLabel"','          <div class="md:col-span-2">');
const helpers=section('  function maintenanceDisplayText(','  function maintenanceDeviceLabel(')+section('  function maintenanceStaffPresence(','  function getStaffList(');
const dropdown=section("    const dropdownPrefixes = ['modalStaff'",'    // 1. Aircon Selection Event');
const selection=section('    // 2. Staff Selection Event (Technician)','    // 3. Maintenance Type Events');
let browser,server;
(async()=>{
 fs.mkdirSync(out,{recursive:true});
 server=http.createServer((req,res)=>{const requestPath=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const filename=path.resolve(publicDir,'.'+requestPath);
  if(!filename.startsWith(publicDir+path.sep)||!fs.existsSync(filename)||!fs.statSync(filename).isFile()){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',({'.css':'text/css','.js':'text/javascript','.woff2':'font/woff2','.woff':'font/woff','.png':'image/png'})[path.extname(filename)]||'application/octet-stream');fs.createReadStream(filename).pipe(res);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});const results=[];
 for(const theme of ['light','dark'])for(const width of [320,1460]){
  const page=await browser.newPage({viewport:{width,height:700}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>route.request().url().startsWith(base+'/')?route.continue():route.abort());
  await page.setContent(`<!doctype html><html class="${theme==='dark'?'dark':''}"><head><base href="${base}/"><script src="vendor/tailwindcss.js"></script><script>tailwind.config={darkMode:'class'}</script><link rel="stylesheet" href="styles.css"></head><body class="app-shell"><div id="ecoCreateReportModal" style="position:relative;display:block;padding:16px"><div style="max-width:440px;margin:auto"><div id="picker"></div></div></div></body></html>`);
  await page.addScriptTag({content:helpers+`
   const staffList=[{id:'staff-one',name:'Office <Technician> with a longer name',status:'Online',is_online:true,role:'HVAC Technician',room_id:'room-one'},
    {id:'staff-two',name:'Second Technician',status:'Active',is_online:false,role:'HVAC Technician',room_id:'room-two'}];
   const allAircons=[{id:'installed-one',roomId:'room-one'},{id:'installed-two',roomId:'room-two'}];
   const createFormState={staffId:'staff-one',staffName:staffList[0].name,airconId:'installed-one'};
   const resolveStaffAvatar=()=>'',resolveStaffLocation=s=>s.room_id;
   const getAirconsForStaff=(staff,rows)=>rows.filter(row=>row.roomId===staff.room_id);
   function renderCreateModalContent(){
    const selectedStaff=staffList.find(row=>row.id===createFormState.staffId);
    document.getElementById('picker').innerHTML='<div class="relative">'+${'`'+template+'`'};
    ${dropdown}
    ${selection}
   }
   renderCreateModalContent();
  `});
  const trigger=page.locator('#modalStaffDropdownTrigger');await trigger.waitFor();await page.waitForTimeout(350);
  const state=await trigger.evaluate(el=>{const style=getComputedStyle(el),rect=el.getBoundingClientRect();return {height:rect.height,border:style.borderTopWidth,name:el.querySelector('.eco-maintenance-staff-name').textContent,status:el.querySelector('.eco-maintenance-staff-status').textContent,overflow:el.scrollWidth>el.clientWidth+1};});
  assert(state.height>=40);assert.equal(state.border,'1px');assert.equal(state.name,'Office <Technician> with a longer name');assert.equal(state.status,'Online');assert.equal(state.overflow,false);
  await trigger.focus();await page.keyboard.press('ArrowDown');assert.equal(await trigger.getAttribute('aria-expanded'),'true');assert.equal(await page.locator('#modalStaffDropdownMenu [role="option"]').first().evaluate(el=>document.activeElement===el),true);
  await page.screenshot({path:path.join(out,`staff-open-${theme}-${width}.png`)});
  await page.keyboard.press('End');await page.keyboard.press('Enter');
  assert.equal(await page.locator('#modalStaffSelectedName').innerText(),'Second Technician');assert.equal(await trigger.getAttribute('aria-expanded'),'false');
  assert.equal(await trigger.locator('.eco-maintenance-staff-status').innerText(),'Offline');
  assert.deepEqual(await page.evaluate(()=>({staff:createFormState.staffId,aircon:createFormState.airconId})),{staff:'staff-two',aircon:'installed-two'});
  assert.equal(await trigger.evaluate(el=>document.activeElement===el),true);await page.keyboard.press('ArrowDown');await page.keyboard.press('Escape');assert.equal(await trigger.getAttribute('aria-expanded'),'false');assert.equal(await trigger.evaluate(el=>document.activeElement===el),true);
  assert.deepEqual(errors,[]);results.push({theme,width,status:'PASS',checks:['40px minimum trigger','1px token border','escaped separate name/status','no horizontal overflow','keyboard open, End, Enter and Escape','unchanged staff/room assignment selection','focus restored','no runtime errors']});console.log('PASS maintenance staff picker',theme,width);await page.close();
 }
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({status:'PASS',isolated_fixtures:true,live_writes:false,results},null,2));
})().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(async()=>{await browser?.close();server?.close();});
