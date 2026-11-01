'use strict';
// Real card rendering and CSS; all records stay inside isolated in-memory/browser fixtures.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createSensorHarness}=require('./helpers/sensor-workspace-harness');
const root=path.resolve(__dirname,'..');
function setup(snapshot={},latest=null,options={}){
 const harness=createSensorHarness();
 const node={id:'card-fixture-'+(options.id||'one'),cloud_node_id:'node-fixture-'+(options.id||'one'),aircon_id:'ac-fixture-'+(options.id||'one'),name:options.name||'Isolated card fixture',aircon_name:'Isolated AC profile',device_mode:'both',expected_interval_seconds:5,fresh:Boolean(options.fresh),status:latest?'Stale':'Awaiting readings',latest,sensor_config:{rotation_rpm:true}};
 harness.context.liveAircons.set(node.aircon_id,snapshot);harness.context.fixtureNode=node;
 return {...harness,node,render:()=>vm.runInContext('sensorCard(fixtureNode)',harness.context)};
}
const at=seconds=>new Date(Date.now()+seconds*1000).toISOString();
const requested=()=>({desired_state:{power:'on',temp:24,mode:'cool',fan:'medium'},commanded_at:at(-2),command_status:'queued'});

test('requested settings are labelled individually and never confirm physical power',()=>{
 const h=setup(requested());const html=h.render();
 assert.match(html,/Requested mode<\/span><b>Cool<\/b>/);assert.match(html,/Requested fan: Medium/);
 assert.match(html,/AC target setpoint/);assert.match(html,/Requested setting/);assert.match(html,/>24<\/span>/);
 assert.match(html,/AC Power/);assert.match(html,/Not reported/);assert.doesNotMatch(html,/Confirmed ON|Aircon state|>Cold</);
});
test('partial device reports preserve the source of each individual field',()=>{
 const h=setup({...requested(),reported_state:{fan:'high'},reported_at:at(-1)});const html=h.render();
 assert.match(html,/Requested mode/);assert.match(html,/Requested setting/);assert.match(html,/Reported fan: High/);
 assert.doesNotMatch(html,/Confirmed ON/);
});
test('configured and remote-observed settings keep distinct provenance',()=>{
 for(const [stateKey,timeKey,prefix] of [['configured_state',null,'Configured'],['observed_remote_state','observed_remote_at','Remote-observed']]){
  const snapshot={[stateKey]:{temp:25,mode:'dry',fan:'low'}};if(timeKey)snapshot[timeKey]=at(-1);
  const html=setup(snapshot).render();assert.match(html,new RegExp(prefix+' mode'));assert.match(html,new RegExp(prefix+' fan: Low'));
  assert.match(html,new RegExp(prefix+' setting'));assert.doesNotMatch(html,/Confirmed ON|Confirmed OFF/);
 }
});
test('missing or untimed RPM does not claim a last recorded measurement',()=>{
 for(const latest of [null,{rotation_rpm:650,rotation_quality:'ok',observed_at:null},{rotation_rpm:650,rotation_quality:'ok',observed_at:at(60)}]){
  const html=setup({},latest).render();assert.match(html,/No RPM reading received/);assert.doesNotMatch(html,/Last recorded|650 RPM/);
 }
});
test('a timestamped zero remains zero; a stale valid RPM is clearly historical',()=>{
 let html=setup({}, {rotation_rpm:0,rotation_quality:'ok',observed_at:at(-1)},{fresh:true}).render();
 assert.match(html,/>0 RPM</);assert.match(html,/Measured wheel rotation/);assert.doesNotMatch(html,/Last recorded/);
 html=setup({}, {rotation_rpm:650,rotation_quality:'ok',observed_at:at(-180)}).render();
 assert.match(html,/>650 RPM</);assert.match(html,/Measured wheel rotation · Last recorded/);
});
test('faulted RPM remains unavailable instead of retaining a numeric value',()=>{
 const html=setup({}, {rotation_rpm:650,rotation_quality:'fault',observed_at:at(-1)},{fresh:true}).render();
 assert.match(html,/RPM reading unavailable/);assert.doesNotMatch(html,/650 RPM|Last recorded/);
});
test('real card CSS aligns mixed-length cards and fits desktop and narrow viewports',async()=>{
 const {chromium}=require(process.env.ECOTRACK_PLAYWRIGHT||'C:/Users/reygay/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
 const browser=await chromium.launch({executablePath:process.env.ECOTRACK_QA_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const cards=[setup(requested(),null,{name:'Fixture Both Device',id:'one'}).render(),setup({},null,{name:'Fixture Monitoring Device with a much longer controller name for wrapping',id:'two'}).render()].join('');
  const css=fs.readFileSync(path.join(root,'public/styles.css'),'utf8')+'\n'+fs.readFileSync(path.join(root,'public/css/sensor-workspace.css'),'utf8');
  const page=await browser.newPage();await page.route('**/*',route=>route.abort());
  for(const theme of ['dark','light'])for(const width of [1100,390,320]){
   await page.setViewportSize({width,height:1000});
   await page.setContent('<html class="'+(theme==='dark'?'dark':'')+'"><head><style>'+css+'</style></head><body class="app-shell" data-sensor-page="telemetry"><div class="sensor-interface" style="container-type:inline-size"><div class="sensor-interface-grid">'+cards+'</div></div></body></html>');
   const measured=await page.locator('.sensor-telemetry-card').evaluateAll(cards=>cards.map(card=>{const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,height:r.height};};return {card:rect(card),metric:rect(card.querySelector('.sensor-node-metrics')),footer:rect(card.querySelector('footer')),scrollWidth:card.scrollWidth,clientWidth:card.clientWidth};}));
   for(const item of measured){assert(item.card.x>=0 && item.card.right<=width+.5,theme+' '+width+' card stays inside viewport');assert(item.scrollWidth<=item.clientWidth+1,theme+' '+width+' card has no horizontal overflow');}
   if(width===1100){assert(Math.abs(measured[0].card.height-measured[1].card.height)<=1,'paired cards share their row height');assert(Math.abs(measured[0].metric.y-measured[1].metric.y)<=1,'paired metrics align');assert(Math.abs(measured[0].footer.y-measured[1].footer.y)<=1,'paired footers align');}
   else assert(measured[1].card.y>measured[0].card.y,'narrow card layout has one column');
   if(process.env.ECOTRACK_CARD_ARTIFACTS){fs.mkdirSync(process.env.ECOTRACK_CARD_ARTIFACTS,{recursive:true});await page.screenshot({path:path.join(process.env.ECOTRACK_CARD_ARTIFACTS,'telemetry-cards-'+theme+'-'+width+'.png'),fullPage:true});}
  }
 }finally{await browser.close();}
});
