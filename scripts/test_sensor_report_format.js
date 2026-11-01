'use strict';
// Actual desktop exporters, isolated data and bundled PDF/Excel libraries; no live services.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {chromium}=require(process.env.ECOTRACK_PLAYWRIGHT||'playwright');
const root=path.resolve(process.env.ECOTRACK_APP_ROOT||path.join(__dirname,'..')),out=process.env.ECOTRACK_AUDIT_ARTIFACTS || path.resolve(process.env.ECOTRACK_AUDIT_ARTIFACTS||process.env.ECOTRACK_REPORT_FORMAT_DIR||path.join(root,'reports/workspace-modes/report-format'));
(async()=>{
 fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const page=await browser.newPage({timezoneId:'Asia/Singapore'}),networkAttempts=[],pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
  await page.route('**/*',route=>{networkAttempts.push(route.request().url());return route.abort();});await page.setContent('<!doctype html><title>Current report layout checks</title>');
  for(const file of ['vendor/jspdf.umd.min.js','vendor/jspdf.plugin.autotable.min.js','vendor/exceljs.min.js','js/future-cost.js','js/report-rules.js','js/airflow-pressure.js','js/sensor-reports.js'])await page.addScriptTag({path:path.join(root,'public',file)});
  await page.evaluate(()=>{
   window.reportFixture={period:'daily',date:'2026-10-19',time:'All times',scope:'Fixture AC devices',rate:13.24,provider:'Fixture Utility',generated:new Date('2026-10-19T07:00:00Z'),
    headings:['Timestamp (UTC+08:00)','AC Device Name','Building','Floor','Room','Attached Aircon Type','AC State','Temperature (°C)','Airflow Indicator (RPM)','Battery (V)','RSSI (dBm)','Recorded Status'],
    rows:Array.from({length:4},(_,i)=>({id:'reading-'+i,node_id:'sensor-one',sensor_name:'Monitoring Fixture',location:'Building · Floor · Room',aircon_type:'Window Type',observed_at:new Date(Date.parse('2026-10-19T00:00:00Z')+[0,60,120,1200][i]*1000).toISOString(),outlet_temperature_c:[18,19,null,21][i],target_temperature_c:[24,25,null,26][i],rotation_rpm:[0,null,30,40][i],battery_voltage:[3.7,0,null,3.6][i],rssi_dbm:[-61,-60,null,-62][i],ac_on:[true,false,null,null][i],interval_seconds:60,connection_status:'offline'})),
    stats:{sample_count:4,temperature_avg:58/3,target_temperature_avg:25,rotation_avg:70/3,confirmed_state_count:2,confirmed_unit_hours:1/60,observed_unit_hours:2/60},
    energy:{available:true,energy_kwh:.25,estimated_unit_hours:1/60,devices:[{node_id:'sensor-one',energy_kwh:.25,estimated_seconds:60}],points:[{observed_at:'2026-10-19T00:00:00Z',energy_kwh:.25},{observed_at:'2026-10-19T00:01:00Z',energy_kwh:null},{observed_at:'2026-10-19T00:20:00Z',energy_kwh:0}]},
    devices:[{id:'sensor-one',device_id:'AC-esp32s3-9cd20604a7ac',aircon_name:'Fixture AC',created_at:'2026-10-01T00:00:00Z',sensor_config:{airflow_reference:{rpm:100}}}]};
   window.valuesFor=rows=>rows.map(row=>[row.observed_at,row.sensor_name,'Building','Floor','Room',row.aircon_type,row.ac_on===true?'Confirmed ON':row.ac_on===false?'Confirmed OFF':'Not reported',row.target_temperature_c??'Unavailable',row.rotation_rpm??'Unavailable',row.battery_voltage??'Unavailable',row.rssi_dbm??'Unavailable',row.connection_status]);
   reportFixture.values=valuesFor(reportFixture.rows);
  });
  const cases=['selected','empty','zero-tariff','missing-tariff','zero-energy','missing-energy','weekly-scope','three-devices','many-devices','duplicate-names','long-labels','changed-location','invalid-quality','with-ac-plan','with-missing-ac-plan','percent-reference','missing-reference','blower-fan-speed'],checks=[];
  for(const scenario of cases){
   await page.evaluate(async scenario=>{
    window.currentReport={...reportFixture};
    currentReport.controllerData={name:'FOREIGN_CONTROLLER_SENTINEL',energy_kwh:876543.21,target_c:47};
    currentReport.devices=reportFixture.devices.map(device=>({...device,controller_name:'FOREIGN_CONTROLLER_SENTINEL',controller_energy_kwh:876543.21}));
    if(scenario==='changed-location'){currentReport.rows=reportFixture.rows.map((row,index)=>({...row,location:index===0?'Original Building · Floor 1 · Original Room':'New Building · Floor 2 · New Room'}));currentReport.values=valuesFor(currentReport.rows);}
    if(scenario==='invalid-quality'){currentReport.rows=reportFixture.rows.map((row,index)=>index===0?{...row,outlet_temperature_c:9999.99,temperature_quality:'fault',rotation_rpm:9999.99,rotation_quality:'fault'}:row);currentReport.values=valuesFor(currentReport.rows);}
    if(scenario.startsWith('with-'))currentReport.futureCost=await EcoTrackFutureCost.calculate({from:'2026-10-20',to:'2026-10-26',hours:8,days:'everyday'},{source:'sensor',scope:'Selected Fixture AC',tariff:13.24,reference:'Selected AC history',devices:[{id:'sensor-one',name:'Fixture AC',referenceKwh:scenario==='with-ac-plan'?.25:null,referenceSeconds:60}]},{now:Date.parse('2026-10-19T07:00:00Z')});
    if(['percent-reference','missing-reference'].includes(scenario)){
     currentReport.rows=[{...reportFixture.rows[0],rotation_rpm:600}];currentReport.values=valuesFor(currentReport.rows);
     currentReport.devices=reportFixture.devices.map(device=>({...device,sensor_config:scenario==='percent-reference'?{airflow_reference:{rpm:1200}}:null}));
    }
    if(scenario==='blower-fan-speed'){
     currentReport.headings=[...reportFixture.headings];currentReport.headings[8]='Blower Fan Speed';
     currentReport.values=reportFixture.values.map((cells,index)=>cells.map((value,column)=>column===8?['AUTO','LOW','MEDIUM','HIGH'][index]:value));
    }
    if(scenario==='empty')Object.assign(currentReport,{rows:[],values:[],stats:{sample_count:0,confirmed_state_count:0},energy:{available:false,points:[],devices:[]}});
    if(scenario==='zero-tariff')currentReport.rate=0;if(scenario==='missing-tariff')currentReport.rate=null;
    if(scenario==='zero-energy')currentReport.energy={...reportFixture.energy,energy_kwh:0,devices:[{node_id:'sensor-one',energy_kwh:0,estimated_seconds:60}],points:reportFixture.energy.points.map(point=>({...point,energy_kwh:point.energy_kwh===null?null:0}))};
    if(scenario==='missing-energy')currentReport.energy={available:false,reason:'Eligible continuous temperature history is unavailable.',devices:[],points:[]};
    if(scenario==='weekly-scope')Object.assign(currentReport,{period:'weekly',date:'2026-10-19 to 2026-10-25',time:'09:00 to 17:00',scope:'Selected Fixture AC'});
    if(['many-devices','duplicate-names','three-devices'].includes(scenario)){
     const count=scenario==='many-devices'?18:scenario==='three-devices'?3:2;
     currentReport.rows=Array.from({length:count},(_,index)=>reportFixture.rows.map(row=>({...row,id:row.id+'-'+index,node_id:'sensor-'+index,sensor_name:scenario==='duplicate-names'?'Same Device Name':scenario==='three-devices'?'Room AC '+index:'AC '+index+' with a long registered name and full measurement history',location:'Building '+index+' · Floor '+index+' · Room '+index}))).flat();
     currentReport.values=valuesFor(currentReport.rows);currentReport.devices=Array.from({length:count},(_,i)=>({id:'sensor-'+i,device_id:'AC-full-device-'+i,aircon_name:scenario==='duplicate-names'?'Same Device Name':scenario==='three-devices'?'Room AC '+i:'AC '+i+' with a long registered name and full measurement history'}));
     currentReport.energy={...reportFixture.energy,energy_kwh:.25*count,estimated_unit_hours:count/60,devices:Array.from({length:count},(_,i)=>({node_id:'sensor-'+i,energy_kwh:.25,estimated_seconds:60})),points:reportFixture.energy.points.map(point=>({...point,energy_kwh:point.energy_kwh===null?null:point.energy_kwh*count}))};
    }
    if(scenario==='long-labels'){
     currentReport.scope='All registered air conditioners in the administration and academic building - selected daily observation period';
     currentReport.provider='Utility provider with a complete legal name and regional service designation';
     currentReport.devices=[{id:'sensor-one',device_id:'AC-esp32s3-9cd20604a7ac',aircon_name:'Conference Room Air Conditioner with a long saved registered equipment name'}];
     currentReport.rows=reportFixture.rows.map(row=>({...row,location:'Long Academic Building Name · Third Floor With A Long Name · Faculty Conference Room With Full Location Details'}));
    }
   },scenario);
   const pdf=await page.evaluate(()=>Array.from(new Uint8Array(EcoTrackSensorReports.pdf(currentReport).output('arraybuffer'))));fs.writeFileSync(path.join(out,'sensor-'+scenario+'.pdf'),Buffer.from(pdf));
   const xlsx=await page.evaluate(async()=>Array.from(new Uint8Array(await EcoTrackSensorReports.excel(currentReport).xlsx.writeBuffer())));fs.writeFileSync(path.join(out,'sensor-'+scenario+'.xlsx'),Buffer.from(xlsx));
   const inspected=await page.evaluate(async()=>{
    const book=new ExcelJS.Workbook();await book.xlsx.load(await EcoTrackSensorReports.excel(currentReport).xlsx.writeBuffer());const summary=book.getWorksheet('AC Device Analysis'),logs=book.getWorksheet('Sensor Telemetry Logs');
    let totalEnergy=0,totalCost=0;summary.eachRow((row,index)=>{if(index<8)return;const energy=row.getCell(5).value,cost=row.getCell(6).value;if(typeof energy==='number')totalEnergy+=energy;if(typeof cost?.result==='number')totalCost+=cost.result;});
    return {sheets:book.worksheets.map(s=>s.name),energy:summary.getCell('E8').value??'Unavailable',cost:summary.getCell('F8').value??'Unavailable',totalEnergy,totalCost,preciseHours:summary.getCell('G8').value,hourFormat:summary.getCell('G8').numFmt,columns:logs.columnCount,rows:logs.rowCount,rawHeadings:logs.getRow(4).values.slice(1),pressureZero:logs.getCell('I5').value,batteryZero:logs.getCell('J6').value,missingTemp:logs.getCell('H7').value,missingPower:logs.getCell('G7').value,scope:summary.getCell('A3').value,filter:logs.autoFilter,freeze:logs.views[0]};
   });
   assert.deepEqual(inspected.sheets,['AC Device Analysis','Energy Intervals','Rule Violations','Rule Settings',...(scenario.startsWith('with-')?['Future Plan']:[]),'Sensor Telemetry Logs']);assert.equal(inspected.columns,12);assert.equal(inspected.rawHeadings[8],scenario==='blower-fan-speed'?'Blower Fan Speed':'Airflow Indicator (RPM)');
   if(scenario==='blower-fan-speed')assert.equal(inspected.pressureZero,'AUTO');assert.equal(inspected.freeze.ySplit,4);assert.equal(inspected.freeze.xSplit,2);
   if(scenario==='percent-reference')assert.equal(inspected.pressureZero,600);
   if(scenario==='missing-reference')assert.equal(inspected.pressureZero,600);
   if(scenario==='selected'){assert.equal(inspected.rawHeadings[7],'Temperature (°C)');assert.equal(inspected.energy,.25);assert.equal(inspected.cost.result,3.31);assert.equal(inspected.preciseHours,1/60);assert.equal(inspected.pressureZero,0);assert.equal(inspected.batteryZero,0);assert.equal(inspected.missingTemp,'Unavailable');assert.equal(inspected.missingPower,'Not reported');assert.equal(inspected.rows,8);}
   if(['empty','missing-energy'].includes(scenario)){assert.equal(inspected.energy,scenario==='empty'?'Unavailable':'—');assert.equal(inspected.cost,scenario==='empty'?'Unavailable':'—');}
   if(['zero-tariff','zero-energy'].includes(scenario))assert.equal(inspected.cost.formula,'E8*$B$4');
   if(scenario==='missing-tariff')assert.equal(inspected.cost,'—');
   if(scenario==='weekly-scope')assert.match(inspected.scope,/2026-10-19 to 2026-10-25.*Selected Fixture AC.*09:00 to 17:00/);
   if(scenario==='many-devices'){assert.equal(inspected.rows,76);assert.equal(inspected.totalEnergy,4.5);assert(Math.abs(inspected.totalCost-59.58)<1e-8);}
   if(scenario==='duplicate-names'){assert.equal(inspected.rows,12);assert.equal(inspected.totalEnergy,.5);}
   checks.push({scenario,status:'PASS',...inspected});
  }
  const rejected=await page.evaluate(()=>{const failures=[];for(const method of ['pdf','excel'])for(const change of [{futureCost:{source:'controller',kwh:876543.21}},{energy:{workspace:'controller',available:true,energy_kwh:876543.21}}]){try{EcoTrackSensorReports[method]({...reportFixture,...change});failures.push(method);}catch(error){if(!/require AC monitoring data/.test(error.message))failures.push(error.message);}}return failures;});assert.deepEqual(rejected,[]);
  const python=process.env.ECOTRACK_PYTHON||'C:/Users/reygay/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
  execFileSync(python,['-c',`from pathlib import Path
from openpyxl import load_workbook
from pypdf import PdfReader
import pdfplumber
import sys,json
folder=Path(sys.argv[1]);result=[]
for name in ['zero-tariff','zero-energy']:
 book=load_workbook(folder/('sensor-'+name+'.xlsx'),data_only=True)
 assert book['AC Device Analysis']['F8'].value==0,name
book=load_workbook(folder/'sensor-selected.xlsx',data_only=True)
assert book['Sensor Telemetry Logs']['A5'].value.hour==8
assert book['AC Device Analysis']['G8'].value==1/60
assert book['Sensor Telemetry Logs']['I5'].value==0
assert book['Sensor Telemetry Logs']['J6'].value==0
for file in folder.glob('sensor-*.pdf'):
 reader=PdfReader(file);text=' '.join(page.extract_text() or '' for page in reader.pages)
 assert all(title in text for title in ['AC Energy Report','AC device comparison','Recorded measurements','Airflow Indicator (RPM)','Previous-period energy','Unavailable']),file
 assert all(title in text for title in ['AC Device Directory','Initial & Final AC Readings','AC Measurement Aggregation','Energy Consumption Ranking','Energy and Cost by Interval','AC Energy & Utility Cost Analytics','Recorded Power and AC Availability','AC Predictive Analytics and Executive Summary']),file
 assert all(title not in text for title in ['FOREIGN_CONTROLLER_SENTINEL','876,543.21','Target Temperature']),file
 assert 'Recorded AC energy estimate' in text,file
 assert all(name not in text for name in ['Histogram Gradient Boosting','Random Forest','XGBoost']),file
 assert 'AC Energy Forecast Report' in (reader.pages[0].extract_text() or ''),file
 assert all(label in (reader.pages[0].extract_text() or '') for label in ['MONITORING REPORT','Selected AC scope','Observation period','Generated']),file
 assert 'AC device comparison' not in (reader.pages[0].extract_text() or ''),file
 assert 'Combined device report' in (reader.pages[1].extract_text() or ''),file
 assert 'AC device comparison' in (reader.pages[2].extract_text() or ''),file
 with pdfplumber.open(file) as toc_document:
  contents=next(table for table in toc_document.pages[1].extract_tables() if table and table[0]==['Report section','Starts on page'])
  starts=dict(contents[1:])
  assert int(starts['Combined device report'])==3,file
  rules_page=int(starts['Rules Management and temperature violations'])
  assert 'Rules Management Results' in (reader.pages[rules_page-1].extract_text() or ''),file
  individual=next(value for label,value in starts.items() if label.startswith('Individual reports'))
  if individual!='No selected devices':
   first,last=[int(n) for n in ([individual,individual] if ' - ' not in individual else individual.split(' - '))]
   assert all('Individual AC Device Report' in (reader.pages[n-1].extract_text() or '') for n in [first,last]),file
  future=starts['AC future-cost plan']
  if future!='No future plan selected':assert 'Future Cost Projection - Recorded history' in (reader.pages[int(future)-1].extract_text() or ''),file
 assert 'Individual AC Device Report' in text,file
 assert 'Rules Management Results' in text and 'Most Violated Temperature' in text,file
 with pdfplumber.open(file) as document:
  for page in document.pages:
   assert all(3<char['x0']<char['x1']<page.width-3 and 3<char['top']<char['bottom']<page.height-3 for char in page.chars if char['text'].strip()),file
 workbook=load_workbook(file.with_suffix('.xlsx'),data_only=True)
 cells=' '.join(str(cell.value) for sheet in workbook for row in sheet for cell in row)
 assert all(title not in cells for title in ['AC Device Directory','Initial & Final AC Readings','AC Measurement Aggregation','Energy Consumption Ranking','AC Predictive Analytics and Executive Summary']),file
 assert workbook['AC Device Analysis'].auto_filter.ref.startswith('A7:O')
 assert 'FOREIGN_CONTROLLER_SENTINEL' not in cells and 'Histogram Gradient Boosting' not in cells,file
 if file.stem=='sensor-changed-location':assert 'Multiple recorded locations' in cells and 'Unallocated' in text
 if file.stem=='sensor-invalid-quality':assert '9999.99' not in text
 if file.stem in ['sensor-with-ac-plan','sensor-with-missing-ac-plan']:
  assert 'Future Cost Projection - Recorded history' in text
  plan=workbook['Future Plan']
  if file.stem=='sensor-with-ac-plan':assert abs(sum(plan.cell(row,6).value for row in range(8,15))-840)<1e-8 and abs(sum(plan.cell(row,7).value for row in range(8,15))-11121.6)<1e-8
  else:assert plan['F8'].value=='—' and plan['G8'].value=='—'
 if file.stem=='sensor-many-devices':
  assert len(reader.pages)>1
  assert all(('AC-full-device-'+str(i)) in text for i in range(18))
 if file.stem=='sensor-duplicate-names':assert all(('AC-full-device-'+str(i)) in text for i in range(2))
 if file.stem=='sensor-selected':assert 'AC-esp32s3-9cd20604a7ac' in text
 result.append(dict(file=file.name,pages=len(reader.pages),status='PASS'))
(folder/'independent-verification.json').write_text(json.dumps(result,indent=2))
`,out],{stdio:'pipe'});
  assert.deepEqual(networkAttempts,[]);assert.deepEqual(pageErrors,[]);fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({status:'PASS',checks,networkAttempts,pageErrors,rejectedControllerSources:true},null,2));console.log('PASS '+cases.length+' combined AC PDF/XLSX cases, controller-source rejection, AC-only analysis, raw records, numeric formulas, native dates and pagination.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
