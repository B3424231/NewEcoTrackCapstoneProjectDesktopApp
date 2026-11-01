'use strict';
// Actual mobile components rendered with React Native Web; fixture readings only.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const {chromium}=require(process.env.ECOTRACK_PLAYWRIGHT||'playwright');
const mobile=process.env.ECOTRACK_MOBILE_ROOT||path.resolve('..','EcoTrackAppMobileNew-master-control');
const out=path.resolve(process.env.ECOTRACK_BLOWER_SCREENSHOTS || 'reports/connected-blower-20261026/mobile');
const fixtures=process.env.ECOTRACK_BLOWER_VISUAL_DIR || path.join(mobile,'artifacts/connected-blower');
(async()=>{
 fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const page=await browser.newPage();
  await page.route(/^https?:/,route=>route.abort());
  for(const width of [320,390])for(const kind of ['card','details']){
   await page.setViewportSize({width,height:844});
   const name='blower-'+kind+'-'+width;
   await page.goto(pathToFileURL(path.join(fixtures,name+'.html')).href);
   const text=await page.locator('body').innerText();
   assert.match(text,/Airflow Indicator \(RPM\)/);assert.match(text,/600 RPM/);assert.match(text,/Auto/);assert.match(text,/Dry/);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,name+' horizontal overflow');
   await page.screenshot({path:path.join(out,name+'.png'),fullPage:true});
  }
  console.log('PASS mobile card/details at 320px and 390px: measured RPM, fan setting, operation mode, and no page overflow.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
