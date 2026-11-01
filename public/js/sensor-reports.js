/* Compact desktop reports. Values come only from the selected monitoring snapshot. */
(function(root){
 'use strict';
 const finite=Number.isFinite,numeric=value=>finite(value)?value:'—';
 const fmt=(value,digits=2)=>finite(value)?value.toLocaleString('en-US',{minimumFractionDigits:digits,maximumFractionDigits:digits}):'—';
 const energyText=value=>fmt(value,finite(value)&&value!==0&&Math.abs(value)<1?4:2);
 const hours=value=>!finite(value)?'—':value>0&&value<1?'<1':fmt(value,0);
 const safe=value=>String(value??'—').replace(/₱/g,'PHP ').replace(/°/g,' deg ').replace(/[·•—–]/g,'-');
 const validDate=value=>value!=null&&value!==''&&finite(new Date(value).getTime());
 const stamp=value=>validDate(value)?new Date(value).toLocaleString('en-GB',{timeZone:'Asia/Singapore',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}):'—';
 const excelDate=value=>validDate(value)?new Date(new Date(value).getTime()+8*3600000):'—';
 const parts=value=>String(value||'').split('·').map(part=>part.trim());
 const power=row=>row.ac_on===true?'Confirmed ON':row.ac_on===false?'Confirmed OFF':'Not reported';
 const measured=(row,field)=>(field==='target_temperature_c'||!['fault','missing','out_of_range','invalid'].includes(row[field==='rotation_rpm'?'rotation_quality':'temperature_quality']))&&finite(row[field])&&(field!=='rotation_rpm'||row[field]>=0)?row[field]:null;
 function statistics(rows,field){
  const values=rows.map(row=>measured(row,field)).filter(finite);
  return {count:values.length,mean:values.length?values.reduce((a,b)=>a+b,0)/values.length:null,min:values.length?values.reduce((a,b)=>Math.min(a,b),Infinity):null,max:values.length?values.reduce((a,b)=>Math.max(a,b),-Infinity):null};
 }
 function rotationReport(report){
  const rows=report.rows.map(row=>({...row,rotation_rpm:measured(row,'rotation_rpm')}));
  const values=(report.values||[]).map((cells,index)=>{const result=[...cells],value=rows[index].rotation_rpm;if(report.headings[8]!=='Blower Fan Speed')result[8]=finite(value)?Math.round(value):'—';return result;});
  return {...report,rows,values,headings:report.headings.map(label=>label.replace(/Airflow (?:pressure|Indicator) \((?:RPM|%)\)/gi,'Airflow Indicator (RPM)'))};
 }
 function snapshot(report){
  if(report.energy?.workspace&&report.energy.workspace!=='monitoring'||report.futureCost&&report.futureCost.source!=='sensor')throw new Error('AC Energy Forecast exports require AC monitoring data.');
  const energy=report.energy?.available&&finite(report.energy.energy_kwh)?report.energy:null,rate=finite(report.rate)&&report.rate>=0?report.rate:null;
  const estimates=new Map((energy?.devices||[]).map(item=>[item.node_id,item])),registry=new Map((report.devices||[]).map(item=>[item.id,item])),groups=new Map();
  report.rows.forEach((row,index)=>{if(!groups.has(row.node_id))groups.set(row.node_id,{id:row.node_id,readings:[],cells:report.values?.[index]||[]});groups.get(row.node_id).readings.push(row);});
  const sensors=[...groups.values()].map(group=>{
   const readings=[...group.readings].sort((a,b)=>Date.parse(a.observed_at)-Date.parse(b.observed_at)),last=readings.at(-1),node=registry.get(group.id),estimate=estimates.get(group.id);
   const locations=[...new Set(readings.map(row=>row.location||''))],location=locations.length>1?'Multiple recorded locations':parts(last.location).filter(Boolean).join(' / ')||'Unassigned';
   const kwh=finite(estimate?.energy_kwh)&&estimate.energy_kwh>=0?estimate.energy_kwh:null,coverage=finite(estimate?.estimated_seconds)&&estimate.estimated_seconds>=0?estimate.estimated_seconds/3600:null;
   return {id:group.id,displayId:node?.device_id||last.device_id||group.id,name:node?.aircon_name||last.aircon_name||last.sensor_name||node?.name||group.cells[1]||group.id,
    location,readings,kwh,cost:kwh!==null&&rate!==null?kwh*rate:null,coverage,first:readings[0],last,
    path:parts(last.location),locationChanged:locations.length>1,type:last.aircon_type||'—',registered:node?.created_at||null,status:last.connection_status||'—',
    temperature:statistics(readings,'target_temperature_c'),rotation:statistics(readings,'rotation_rpm'),on:readings.filter(row=>row.ac_on===true).length,off:readings.filter(row=>row.ac_on===false).length,unknown:readings.filter(row=>typeof row.ac_on!=='boolean').length};
  });
  return {energy,rate,sensors,kwh:energy?.energy_kwh??null,cost:energy&&rate!==null?energy.energy_kwh*rate:null,
   confirmed:report.stats?.confirmed_state_count&&finite(report.stats.confirmed_unit_hours)?report.stats.confirmed_unit_hours:null,
   unknown:report.rows.filter(row=>typeof row.ac_on!=='boolean').length,coverage:energy?.estimated_unit_hours??null};
 }
 function ruleSections(report){
  const audit=report.ruleAudit||{available:false,reason:'Rules Management history was not loaded.',events:[],rules:[],rooms:[],ruleRanking:[]},events=audit.events||[],temperature=events.filter(event=>event.type==='temperature');
  const count=value=>audit.available?value:value?value+' recorded (partial)':'—';
  const most=ranking=>ranking?.length?ranking.filter(row=>row.count===ranking[0].count).map(row=>row.name+' ('+row.count+')').join('; '):audit.available?'No recorded temperature violations':'—';
  return [
   {key:'rule-summary',title:'Rules Management Results',head:['Recorded compliance result','Selected report value'],widths:[92,181],rows:[['Recorded rule violations',count(events.length)],['Recorded temperature violations',count(temperature.length)],['Most violated temperature location',most(audit.rooms)],['Most violated temperature rule',most(audit.ruleRanking)],['History availability',audit.available?'Complete saved history snapshot':'Unavailable or incomplete'],['Source / limitations',audit.reason||'Saved Rules Management notifications and retained audit history.']],note:'Counts use recorded events within the selected dates, time filter and AC scope. Disabled rules and dismissed notifications retain their history. Live rule evaluation is not run during export.'},
   {key:'configured-rules',title:'Applicable Saved Rules',head:['Rule ID','Type','Current condition','Enabled now','Duration (min)','Assigned location'],widths:[37,31,43,25,29,108],rows:(audit.rules||[]).map(rule=>[rule.id,rule.type,(rule.condition||'—')+' '+(rule.value??'—')+(rule.unit||''),rule.enabled?'Yes':'No',rule.duration??'—',rule.location]),note:'This table shows current saved configuration. Historical incident conditions below come from each saved event, and may differ after a rule is edited.'},
   {key:'temperature-ranking',title:'Most Violated Temperature Locations',head:['Rank','Recorded location','Temperature violations'],widths:[23,205,45],rows:(audit.rooms||[]).slice(0,10).map((room,index)=>[index+1,room.name,room.count]),note:'Locations are ranked by the count of recorded temperature-rule violations, not by their highest measured temperature. Top ten locations are shown; complete events are provided in Excel.'},
   {key:'rule-history',title:'Recent Recorded Rule Violations',head:['Event time (UTC+08:00)','AC device / attribution','Recorded location','Recorded condition','Recorded temperature','Saved event detail'],dates:[0],widths:[36,41,43,35,30,88],rows:events.slice(0,10).map(event=>[event.time,event.device,event.location,event.condition,event.recordedValue,event.message]),note:`Showing ${Math.min(10,events.length)} of ${events.length} available recorded violations. The Excel violation dataset contains every available event. Missing recorded temperatures stay unavailable; thresholds and live readings are not used as substitutes.`}
  ];
 }
 function analysisSections(report,data){
  const identity=sensor=>sensor.name+'\n'+sensor.displayId,rooms=new Map(),statuses=new Map();
  for(const sensor of data.sensors){
   const path=sensor.locationChanged?['Multiple recorded locations','Unallocated','Unallocated']:sensor.path.map(value=>value||'Unassigned');
   while(path.length<3)path.push('Unassigned');
   const key=JSON.stringify(path);if(!rooms.has(key))rooms.set(key,{path,kwh:0,missing:0});const room=rooms.get(key);
   if(sensor.kwh===null||sensor.locationChanged)room.missing++;else room.kwh+=sensor.kwh;
   statuses.set(sensor.status,(statuses.get(sensor.status)||0)+1);
  }
  const ranking=[...rooms.values()].sort((a,b)=>(b.missing?-1:b.kwh)-(a.missing?-1:a.kwh));
  const temperature=statistics(report.rows,'target_temperature_c'),rotation=statistics(report.rows,'rotation_rpm');
  return [
   {key:'directory',title:'AC Device Directory',head:['AC device / Device ID','Building','Floor','Room','AC type','Local registry date','Latest recorded status'],dates:[5],widths:[56,34,22,30,43,43,30],rows:data.sensors.map(sensor=>[identity(sensor),sensor.path[0]||'Unassigned',sensor.path[1]||'Unassigned',sensor.path[2]||'Unassigned',sensor.type,sensor.registered,sensor.status]),note:'Locations and connectivity come from the last selected reading. Multiple recorded locations are left unallocated in room energy rankings.'},
   {key:'audit',title:'Installation Audit Availability',head:['Audit section','AC data availability'],widths:[75,198],rows:[['Verified installation history','Unavailable - this AC forecasting snapshot contains no linked installation events.']],note:'Unavailable installation history does not establish that no installations occurred.'},
   ...ruleSections(report),
   {key:'readings',title:'Initial & Final AC Readings',head:['AC device / Device ID','Reading','Timestamp (UTC+08:00)','Recorded location','Temperature (C)','Airflow Indicator (RPM)','Battery (V)','RSSI (dBm)','Physical power'],dates:[2],widths:[55,17,39,43,23,26,20,20,30],rows:data.sensors.flatMap(sensor=>[['First',sensor.first],['Last',sensor.last]].map(([label,row])=>[identity(sensor),label,row.observed_at,parts(row.location).join(' / ')||'Unassigned',measured(row,'target_temperature_c'),measured(row,'rotation_rpm'),row.battery_voltage,row.rssi_dbm,power(row)])),note:'First and last readings are selected independently for each AC device. Recorded feedback establishes physical power; commands and connectivity do not.'},
   {key:'aggregation',title:'AC Measurement Aggregation',head:['AC device / Device ID','Readings','Mean temperature (C)','Min temperature (C)','Max temperature (C)','Mean Airflow Indicator (RPM)','Confirmed ON','Confirmed OFF','Unconfirmed power'],widths:[55,22,26,26,26,32,29,29,28],rows:data.sensors.map(sensor=>[identity(sensor),sensor.readings.length,sensor.temperature.mean,sensor.temperature.min,sensor.temperature.max,sensor.rotation.mean,sensor.on,sensor.off,sensor.unknown]),note:'Power columns count feedback readings. They are not continuous runtime or scheduled operating hours.'},
   {key:'ranking',title:'Energy Consumption Ranking',head:['Rank','Building','Floor','Room','Energy (kWh)','Cost (PHP)','Coverage'],widths:[17,49,28,48,35,35,61],rows:ranking.map((room,index)=>[room.missing?'-':index+1,...room.path,room.missing?null:room.kwh,room.missing||data.rate===null?null:room.kwh*data.rate,room.missing?'Unavailable / incomplete allocation':'Available AC estimate']),note:'Rankings use the selected AC model intervals and saved reading locations. Missing estimates and changed locations are not converted into zero consumption.'},
   {key:'status',title:'Recorded Power and AC Availability',head:['Recorded measure','Count','Unit'],widths:[135,55,83],rows:[['Confirmed ON feedback',data.sensors.reduce((sum,sensor)=>sum+sensor.on,0),'readings'],['Confirmed OFF feedback',data.sensors.reduce((sum,sensor)=>sum+sensor.off,0),'readings'],['Unconfirmed physical power',data.unknown,'readings'],...[...statuses].map(([status,count])=>['Latest recorded connectivity: '+status,count,'AC devices'])],note:'Connectivity is historical status from the final selected record, not a live availability check or evidence of AC power.'},
   {key:'thermal',title:'Thermal and Airflow Indicator Analysis',head:['Recorded measurement','Valid readings','Minimum','Mean','Maximum','Unit'],widths:[85,35,35,35,35,48],rows:[['Temperature',temperature.count,temperature.min,temperature.mean,temperature.max,'C'],['Airflow Indicator (RPM)',rotation.count,rotation.min,rotation.mean,rotation.max,'RPM']],note:'Temperature uses recorded AC target setpoints. Airflow indicators use validated recorded wheel rotation in RPM. Missing and invalid readings are excluded; historical readings are not overwritten.'},
   {key:'model',title:'AC Predictive Analytics and Executive Summary',head:['Prediction metric','AC Energy Forecast value'],widths:[77,196],rows:[['Model',report.energy?.model==='extra_trees'?'Extra Trees':'Recorded AC energy estimate'],['Model inputs','Recorded target temperature, blower fan setting, operating mode and timestamps'],['Energy basis','Covered recorded AC control intervals'],['Estimated energy (kWh)',data.kwh],['Estimated cost (PHP)',data.cost],['Modeled interval coverage (unit-hours)',data.coverage],['Confirmed AC operation (unit-hours)',data.confirmed],['Previous-period energy','—'],['Selected readings / AC devices',report.rows.length+' readings / '+data.sensors.length+' devices'],['Estimate availability',report.energy?.reason||'Only covered intervals contribute to the experimental estimate.']],note:'Temperature values are recorded AC target setpoints. Reference energy estimates are not utility-meter readings. Future cost is conditional on the entered AC plan; recorded AC operation is reported separately.'}
  ];
 }
 function numberFormat(section,column,index){
  if(section.key==='device-profile'&&index===2)return column===1?'#,##0.0000':column===3?'#,##0.00':'#,##0';
  if(section.key==='intervals')return column===1?'#,##0.0000':column===2?'#,##0.00':column===3?'[>=1]0;[>0]"<1";0':'#,##0';
  if(section.key==='readings')return column===4?'0.0':column===6?'0.000':'#,##0';
  if(section.key==='aggregation')return column>=2&&column<=4?'0.0':'#,##0';
  if(section.key==='ranking')return column===4?'#,##0.0000':column===5?'#,##0.00':'#,##0';
  if(section.key==='thermal')return column>=2&&column<=4&&index===0?'0.0':'#,##0';
  if(section.key==='model')return index===3?'#,##0.0000':index===4?'#,##0.00':index===5||index===6?'[>=1]0;[>0]"<1";0':'#,##0';
  return '#,##0';
 }
 function intervalSection(report,data){
  return {key:'intervals',title:'Energy and Cost by Interval',head:['Timestamp (UTC+08:00)','Energy (kWh)','Cost (PHP)','Coverage (unit-hours)','Estimate status'],dates:[0],widths:[60,42,42,45,84],rows:(data.energy?.points||[]).map(point=>{
   const kwh=finite(point.energy_kwh)&&point.energy_kwh>=0?point.energy_kwh:null;
   return [point.observed_at,kwh,kwh!==null&&data.rate!==null?kwh*data.rate:null,finite(point.estimated_seconds)&&point.estimated_seconds>=0?point.estimated_seconds/3600:null,kwh===null?'No covered AC estimate':'Covered AC model interval'];
  }),note:'All returned AC energy intervals are included. Gaps remain unavailable; interval costs use the selected tariff.'};
 }
 function excel(report){
  report=rotationReport(report);
  const data=snapshot(report),book=new root.ExcelJS.Workbook(),audit=report.ruleAudit||{available:false,rules:[],events:[]};
  book.creator='EcoTrack';book.created=report.generated;book.calcProperties.fullCalcOnLoad=true;
  const ink='FF194D34',pale='FFF5F8F5',line='FFE0E7E2',muted='FF65796C',font={name:'Aptos',size:10,color:{argb:ink}},hourFormat='[>=1]0;[>0]"<1";0';
  const deviceSheet=book.addWorksheet('AC Device Analysis'),intervals=book.addWorksheet('Energy Intervals'),violations=book.addWorksheet('Rule Violations'),settings=book.addWorksheet('Rule Settings'),plan=report.futureCost?book.addWorksheet('Future Plan'):null,logs=book.addWorksheet('Sensor Telemetry Logs');
  function row(sheet,index,values,header=false){const r=sheet.getRow(index);r.values=values;r.height=header?40:28;r.eachCell({includeEmpty:true},cell=>{cell.font={...font,bold:header,color:{argb:header?'FFFFFFFF':ink}};cell.alignment={vertical:'middle',horizontal:header?'left':typeof cell.value==='number'||cell.value?.formula?'right':'left',wrapText:true,indent:1};cell.border={bottom:{style:'hair',color:{argb:line}}};if(header||index%2===0)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:header?ink:pale}};});return r;}
  function begin(sheet,title,widths,headerRow=4){sheet.columns=widths.map(width=>({width}));sheet.mergeCells(2,1,2,widths.length);sheet.getCell('A2').value=title;sheet.getCell('A2').font={...font,bold:true,size:16};sheet.getRow(2).height=34;sheet.mergeCells(3,1,3,widths.length);sheet.getCell('A3').value=`${report.date} | ${report.scope} | ${report.time} | UTC+08:00`;sheet.getCell('A3').font={...font,size:9,color:{argb:muted}};sheet.getCell('A3').alignment={wrapText:true};sheet.getRow(3).height=28;sheet.views=[{state:'frozen',ySplit:headerRow,xSplit:2,showGridLines:false}];}
  function finish(sheet,header,last){const end=String.fromCharCode(64+sheet.columns.length);sheet.autoFilter={from:`A${header}`,to:`${end}${Math.max(header,last)}`};sheet.pageSetup={orientation:'landscape',paperSize:9,fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:`1:${header}`,printArea:`A1:${end}${Math.max(header+1,last)}`,margins:{left:.3,right:.3,top:.4,bottom:.4}};sheet.headerFooter.oddFooter='&LEcoTrack AC analysis&RPage &P of &N';}
  function fit(sheet,index,values){sheet.getRow(index).height=Math.max(28,...values.map((value,column)=>String(value??'').split('\n').reduce((n,part)=>n+Math.max(1,Math.ceil(part.length/Math.max(12,sheet.columns[column].width-4))),0)*13+8));}
  begin(deviceSheet,'AC Device Analysis',[34,25,43,14,19,19,21,18,18,18,20,18,18,20,24],7);
  row(deviceSheet,4,['Tariff (PHP / kWh)',numeric(data.rate),null,'Utility provider',report.provider]);deviceSheet.getCell('B4').numFmt='0.00';
  deviceSheet.mergeCells('A5:O5');deviceSheet.getCell('A5').value='Loaded event counts include saved history only. Rule data: '+(audit.available?'complete snapshot':audit.reason||'unavailable or partial')+'. Coverage hours retain numeric precision.';deviceSheet.getCell('A5').alignment={wrapText:true};deviceSheet.getRow(5).height=32;
  row(deviceSheet,7,['AC Device ID','AC unit','Recorded location','Readings','Energy (kWh)','Cost (PHP)','Model coverage (h)','Mean temperature (C)','Min temperature (C)','Max temperature (C)','Mean Airflow Indicator (RPM)','Confirmed ON samples','Confirmed OFF samples','Unconfirmed samples','Loaded temperature violations'],true);
  const eventLast=Math.max(5,(audit.events||[]).length+4);
  data.sensors.forEach((sensor,index)=>{const r=index+8;const values=[sensor.displayId,sensor.name,sensor.location,sensor.readings.length,numeric(sensor.kwh),sensor.cost===null?'—':{formula:`E${r}*$B$4`,result:sensor.cost},numeric(sensor.coverage),numeric(sensor.temperature.mean),numeric(sensor.temperature.min),numeric(sensor.temperature.max),numeric(sensor.rotation.mean),sensor.on,sensor.off,sensor.unknown,{formula:`COUNTIFS('Rule Violations'!$B$5:$B$${eventLast},"${String(sensor.id).replace(/"/g,'""')}",'Rule Violations'!$F$5:$F$${eventLast},"temperature")`,result:(audit.events||[]).filter(event=>event.nodeId===sensor.id&&event.type==='temperature').length}];row(deviceSheet,r,values);for(const col of ['E'])deviceSheet.getCell(`${col}${r}`).numFmt='#,##0.0000';deviceSheet.getCell(`F${r}`).numFmt='#,##0.00';deviceSheet.getCell(`G${r}`).numFmt=hourFormat;for(const col of ['H','I','J'])deviceSheet.getCell(`${col}${r}`).numFmt='0.0';fit(deviceSheet,r,values);});
  if(!data.sensors.length){row(deviceSheet,8,['No recorded AC observations in this selection.']);}
  finish(deviceSheet,7,Math.max(8,7+data.sensors.length));
  begin(intervals,'AC Energy Interval Data',[28,24,24,26,40]);row(intervals,4,['Timestamp (UTC+08:00)','Energy (kWh)','Cost (PHP)','Coverage (unit-hours)','Estimate status'],true);
  const intervalRows=intervalSection(report,data).rows;
  intervalRows.forEach((values,index)=>{const r=index+5;row(intervals,r,[excelDate(values[0]),numeric(values[1]),finite(values[2])?{formula:`B${r}*'AC Device Analysis'!$B$4`,result:values[2]}:'—',numeric(values[3]),values[4]]);intervals.getCell(`A${r}`).numFmt='mmm d, yyyy h:mm AM/PM';intervals.getCell(`B${r}`).numFmt='#,##0.0000';intervals.getCell(`C${r}`).numFmt='#,##0.00';intervals.getCell(`D${r}`).numFmt=hourFormat;});finish(intervals,4,intervalRows.length+4);
  begin(violations,'Recorded Rule Violation Dataset',[28,35,25,43,25,20,27,21,14,72,18,16,37]);violations.getCell('A3').value+=audit.available?' | Complete Rules Management snapshot':' | Partial/unavailable cloud history; retained events only';
  row(violations,4,['Event timestamp (UTC+08:00)','Monitoring ID','AC unit / attribution','Recorded location','Rule ID','Rule type','Recorded condition','Recorded temperature','Unit','Saved event message','Inbox dismissed','Archived locally','Event ID'],true);
  (audit.events||[]).forEach((event,index)=>{const r=index+5,values=[excelDate(event.time),event.nodeId||'Unattributed room event',event.device,event.location,event.ruleId,event.type,event.condition,numeric(event.value),event.unit,event.message,Boolean(event.dismissed),Boolean(event.archived),String(event.id)];row(violations,r,values);violations.getCell(`A${r}`).numFmt='mmm d, yyyy h:mm:ss AM/PM';violations.getCell(`H${r}`).numFmt='0.0';fit(violations,r,values);});finish(violations,4,4+(audit.events||[]).length);
  begin(settings,'Saved Rule Settings Dataset',[28,20,20,16,14,17,22,22,22,22,22,45,48]);row(settings,4,['Rule ID','Rule type','Comparator','Value','Unit','Enabled now','Duration (min)','Start date','End date','Start time','End time','Assigned location','Target monitoring IDs'],true);
  (audit.rules||[]).forEach((rule,index)=>{const r=index+5,value=rule.value===null||rule.value===''?null:Number(rule.value),values=[String(rule.id),rule.type,rule.condition,numeric(value),rule.unit||'—',Boolean(rule.enabled),rule.duration??'—',rule.start_date?new Date(rule.start_date+'T00:00:00Z'):'Not set',rule.end_date?new Date(rule.end_date+'T00:00:00Z'):'Not set',rule.start_time||'Not set',rule.end_time||'Not set',rule.location,(rule.deviceIds||[]).join(', ')];row(settings,r,values);for(const col of ['H','I'])settings.getCell(`${col}${r}`).numFmt='mmm d, yyyy';fit(settings,r,values);});finish(settings,4,4+(audit.rules||[]).length);
  if(plan){const future=report.futureCost;begin(plan,'AC Future Plan Calculation Data',[23,35,28,22,26,25,24,40],7);row(plan,4,['Tariff (PHP / kWh)',numeric(future.tariff)]);if(finite(future.tariff)&&future.tariff===data.rate)plan.getCell('B4').value={formula:"'AC Device Analysis'!$B$4",result:future.tariff};plan.getCell('B4').numFmt='0.00';plan.mergeCells('A5:H5');plan.getCell('A5').value='Conditional AC history-based plan. These rows are separate from recorded telemetry. Missing historical rates stay unavailable.';plan.getCell('A5').alignment={wrapText:true};plan.getRow(5).height=32;row(plan,7,['Planned date','AC reference ID','AC unit','Planned hours','Historical kWh per hour','Planned energy (kWh)','Planned cost (PHP)','Rate availability'],true);let r=8;
   for(const day of future.rows||[])for(const device of future.devices||[]){const kwh=day.hours===0?0:finite(device.rate)?device.rate*day.hours:null,cost=kwh!==null&&finite(future.tariff)?kwh*future.tariff:null;row(plan,r,[new Date(day.date+'T00:00:00Z'),String(device.id),device.name,day.hours,numeric(device.rate),kwh===null?'—':finite(device.rate)?{formula:`D${r}*E${r}`,result:kwh}:0,cost===null?'—':{formula:`F${r}*$B$4`,result:cost},device.reason||'Covered AC history']);plan.getCell(`A${r}`).numFmt='mmm d, yyyy';plan.getCell(`D${r}`).numFmt=hourFormat;for(const col of ['E','F'])plan.getCell(`${col}${r}`).numFmt='#,##0.0000';plan.getCell(`G${r}`).numFmt='#,##0.00';r++;}finish(plan,7,r-1);
  }
  begin(logs,'Complete Recorded Sensor Telemetry',[25,27,22,14,19,26,20,20,22,15,15,22]);row(logs,4,report.headings,true);
  report.values.forEach((values,index)=>{const r=index+5;row(logs,r,[excelDate(report.rows[index].observed_at),...values.slice(1)]);logs.getCell(`A${r}`).numFmt='mmm d, yyyy h:mm:ss AM/PM';for(const col of ['H','I','J'])logs.getCell(`${col}${r}`).numFmt='0.000';logs.getCell(`I${r}`).numFmt='0';logs.getCell(`K${r}`).numFmt='0';fit(logs,r,values);});if(!report.rows.length)row(logs,5,['No recorded sensor observations in this selection.']);finish(logs,4,report.rows.length+4);
  return book;
 }

 function buckets(report,points){
  const daily=report.period==='daily',groups=new Map();
  for(const point of points||[]){
   const date=validDate(point.observed_at)?new Date(new Date(point.observed_at).getTime()+8*3600000).toISOString():null;
   const key=date?date.slice(0,daily?13:10):'—',label=date?(daily?date.slice(11,13)+':00':date.slice(5,10)):'—';
   if(!groups.has(key))groups.set(key,{key,label,value:null,partial:false});const item=groups.get(key);
   if(finite(point.energy_kwh)&&point.energy_kwh>=0)item.value=(item.value??0)+point.energy_kwh;else item.partial=true;
  }
  const sorted=[...groups.values()].sort((a,b)=>a.key.localeCompare(b.key)),stride=Math.max(1,Math.ceil(sorted.length/12)),result=[];
  for(let i=0;i<sorted.length;i+=stride){const group=sorted.slice(i,i+stride),values=group.map(item=>item.value).filter(finite);result.push({label:group.length===1?group[0].label:group[0].label+'-'+group.at(-1).label,value:values.length?values.reduce((a,b)=>a+b,0):null,partial:group.some(item=>item.partial||item.value===null)});}
  return {items:result,title:stride>1?'Estimated energy by interval':daily?'Estimated energy by hour':'Estimated energy by day'};
 }
 function appendAnalysisPdf(doc,report,data){
  const W=doc.internal.pageSize.getWidth(),H=doc.internal.pageSize.getHeight(),M=12,C=W-M*2,ink=[25,77,52],muted=[101,121,108],green=[17,149,108],line=[224,232,226];let y=30,pageTitle='';
  function text(value,x,top,size=8,bold=false,color=ink,options={}){doc.setFont('helvetica',bold?'bold':'normal');doc.setFontSize(size);doc.setTextColor(...color);doc.text(Array.isArray(value)?value.map(safe):safe(value),x,top,options);}
  function header(title){text(title,M,17,14,true);text(report.date,W-M,24,7,false,muted,{align:'right'});}
  function page(title){doc.addPage();pageTitle=title;header(title);y=33;}
  function note(value){doc.setFont('helvetica','normal');doc.setFontSize(7);const lines=doc.splitTextToSize(safe(value),C);if(y+lines.length*3.4>H-19){page(pageTitle+' (continued)');}text(lines,M,y,7,false,muted);y+=lines.length*3.4+7;}
  function display(section,value,column,index){
   if((section.dates||[]).includes(column))return stamp(value);
   if(!finite(value))return value??'—';
   const format=numberFormat(section,column,index);if(format.includes('<1'))return hours(value);
   return fmt(value,format.includes('0.0000')?4:format.includes('0.000')?3:format.includes('0.00')?2:format.includes('0.0')?1:0);
  }
  function table(section,showTitle=true){
   const widths=section.widths||section.head.map(()=>1),sum=widths.reduce((a,b)=>a+b,0),columnStyles=Object.fromEntries(widths.map((width,index)=>[index,{cellWidth:C*width/sum}]));
   let required=35;
   if(section.rows.length<=3){
    const fontSize=section.head.length>6?7.3:8,padding=section.key==='intervals'?2:2.4;
    doc.setFont('helvetica','normal');doc.setFontSize(fontSize);
    const height=values=>Math.max(...values.map((value,column)=>doc.splitTextToSize(safe(value),Math.max(8,columnStyles[column].cellWidth-padding*2)).length))*fontSize*.41+padding*2;
    required=height(section.head)+(section.rows.length?section.rows.reduce((total,values,index)=>total+height(values.map((value,column)=>display(section,value,column,index))),0):9);
    doc.setFontSize(7);required+=doc.splitTextToSize(safe(section.note),C).length*3+13;
   }
   if(y+required>H-19)page(section.title);else if(showTitle){text(section.title,M,y,10,true);y+=6;}
   if(section.key==='intervals'){columnStyles[1].halign='right';columnStyles[2].halign='right';columnStyles[3].halign='right';}
   const rows=section.rows.length?section.rows.map((values,index)=>values.map((value,column)=>display(section,value,column,index))):[[{content:'No AC records in this selection.',colSpan:section.head.length}]];
   doc.autoTable({startY:y,margin:{left:M,right:M,top:32,bottom:20},head:[section.head.map(safe)],body:rows,foot:[[{content:safe(section.note),colSpan:section.head.length}]],showFoot:'lastPage',footStyles:{fontStyle:'normal',fontSize:7,fillColor:[255,255,255],textColor:muted,cellPadding:{top:4,right:0,bottom:2,left:0}},theme:'striped',rowPageBreak:'avoid',styles:{font:'helvetica',fontSize:section.head.length>6?7.3:8,cellPadding:section.key==='intervals'?2:2.4,overflow:'linebreak',valign:'middle',textColor:ink},columnStyles,headStyles:{fillColor:ink,textColor:[255,255,255],fontStyle:'bold'},alternateRowStyles:{fillColor:[245,248,245]},didDrawPage(hook){if(hook.pageNumber>1)header(section.title+' (continued)');}});
   y=doc.lastAutoTable.finalY+7;
  }
  function profile(title,items,unit,color){
   if(y+65>H-19)page(pageTitle+' (continued)');text(title,M,y,10,true);text(unit,W-M,y,7,false,muted,{align:'right'});y+=8;
   const valid=items.filter(item=>finite(item.value));
   if(!valid.length){text('No valid AC data in this selection.',M,y+16,9,false,muted);y+=47;return;}
   const x=M+15,top=y,width=C-20,height=34,min=Math.min(0,...valid.map(item=>item.value)),max=Math.max(0,...valid.map(item=>item.value)),span=max-min||1,upper=max+span*.15;
   const position=value=>top+height-(value-min)/(upper-min)*height;
   for(let tick=0;tick<=3;tick++){const value=min+(upper-min)*tick/3,py=position(value);doc.setDrawColor(...line);doc.setLineWidth(.2);doc.line(x,py,x+width,py);text(fmt(value,upper<1?3:1),x-2,py+1,6,false,muted,{align:'right'});}
   const step=width/items.length,barW=Math.min(12,step*.55);
   items.forEach((item,index)=>{const cx=x+step*(index+.5);text(item.label,cx,top+height+5,items.length>9?5.5:6.5,false,muted,{align:'center'});if(!finite(item.value)){text('n/a',cx,top+height-2,6,false,muted,{align:'center'});return;}const py=position(item.value),zero=position(0);doc.setFillColor(...color);if(item.value===0)doc.circle(cx,zero,.5,'F');else doc.rect(cx-barW/2,Math.min(py,zero),barW,Math.abs(zero-py),'F');text(fmt(item.value,unit==='kWh'&&Math.abs(item.value)<1?4:unit==='%'?0:unit==='C'?1:2),cx,Math.max(top-1,Math.min(py,zero)-2),6,false,ink,{align:'center'});});y+=52;
  }
  const sections=new Map(analysisSections(report,data).map(section=>[section.key,section]));
  page('AC Device Directory');table(sections.get('directory'),false);table(sections.get('audit'));
  const rulesPage=doc.internal.getNumberOfPages();
  page('Rules Management Results');for(const key of ['rule-summary','configured-rules','temperature-ranking','rule-history'])table(sections.get(key),key!=='rule-summary');
  page('Initial & Final AC Readings');table(sections.get('readings'),false);table(sections.get('aggregation'));
  page('AC Energy Ranking and Interval Audit');table(sections.get('ranking'));const intervals=intervalSection(report,data),summarized=buckets(report,data.energy?.points).items;table({...intervals,dates:[],head:['Local interval','Energy (kWh)','Cost (PHP)','Coverage'],widths:[60,50,50,113],rows:summarized.map(item=>[item.label,item.value,finite(item.value)&&data.rate!==null?item.value*data.rate:null,item.partial?'Partial AC estimate':item.value===null?'—':'Covered AC intervals']),note:'This PDF summarizes local hourly/daily intervals. Complete native timestamps, interval values, coverage and calculation formulas are supplied in Excel.'});
  page('AC Energy & Utility Cost Analytics');const energy=buckets(report,data.energy?.points).items;profile('Estimated AC Energy Profile',energy,'kWh',green);profile('Estimated AC Electricity Cost Profile',energy.map(item=>({...item,value:finite(item.value)&&data.rate!==null?item.value*data.rate:null})),'PHP',[185,112,25]);note('Gaps remain unavailable. Cost uses AC estimated energy multiplied by the selected electricity tariff. Previous-period energy remains unavailable.');
  page('Visual Analytics - AC Measurements');
  for(const [field,title,unit,color] of [['target_temperature_c','Recorded Temperature Trend','C',green],['rotation_rpm','Recorded Airflow Indicator Trend','RPM',[51,117,164]]]){
   const groups=new Map(),daily=report.period==='daily';
   for(const row of report.rows){if(!validDate(row.observed_at))continue;const local=new Date(Date.parse(row.observed_at)+8*3600000).toISOString(),key=local.slice(0,daily?13:10);if(!groups.has(key))groups.set(key,{key,sum:0,count:0});const item=groups.get(key),value=measured(row,field);if(value!==null){item.sum+=value;item.count++;}}
   const ordered=[...groups.values()].sort((a,b)=>a.key.localeCompare(b.key)),step=Math.max(1,Math.ceil(ordered.length/12)),items=[];
   for(let i=0;i<ordered.length;i+=step){const group=ordered.slice(i,i+step),count=group.reduce((sum,item)=>sum+item.count,0),label=item=>daily?item.key.slice(11)+':00':item.key.slice(5);items.push({label:group.length===1?label(group[0]):label(group[0])+'-'+label(group.at(-1)),value:count?group.reduce((sum,item)=>sum+item.sum,0)/count:null});}
   profile(title,items,unit,color);
  }
  note('Temperature profiles show recorded AC target setpoints; airflow profiles show validated measured wheel rotation in RPM, by local hour/day. Aggregated intervals retain their original dates; missing measurements are not interpolated.');
  page('AC Thermal and Power Analysis');table(sections.get('thermal'),false);table(sections.get('status'));
  page('AC Predictive Analytics and Executive Summary');table(sections.get('model'),false);
  const deviceMap=new Map((report.devices||[]).map(device=>[device.id,device]));for(const sensor of data.sensors)if(!deviceMap.has(sensor.id))deviceMap.set(sensor.id,{id:sensor.id,name:sensor.name});
  const devicePages=[];
  for(const device of deviceMap.values()){
   const sensor=data.sensors.find(item=>item.id===device.id),name=sensor?.name||device.aircon_name||device.name||device.id,identity=sensor?.displayId||device.device_id||device.id;
   page('Individual AC Device Report');devicePages.push({id:device.id,name,page:doc.internal.getNumberOfPages()});
   table({key:'device-profile',title:name,head:['Device measure','Selected AC value','Device measure','Selected AC value'],widths:[46,91,46,90],rows:[['AC unit',name,'AC Device ID',identity],['Recorded location',sensor?.location||device.location||'No recorded location','Selected readings',sensor?.readings.length||0],['Estimated energy (kWh)',sensor?.kwh??null,'Estimated cost (PHP)',sensor?.cost??null],['Model coverage (hours)',finite(sensor?.coverage)?hours(sensor.coverage):'—','Latest recorded connectivity',sensor?.status||'—'],['Mean temperature (C)',finite(sensor?.temperature.mean)?fmt(sensor.temperature.mean,1):'—','Mean Airflow Indicator (RPM)',finite(sensor?.rotation.mean)?fmt(sensor.rotation.mean,0):'—'],['Confirmed ON / OFF samples',sensor?sensor.on+' / '+sensor.off:'—','Unconfirmed samples',sensor?.unknown??'—']],note:'Only this AC device contributes to these values. Recorded feedback counts are observations, not continuous runtime.'},false);
   const readings=sections.get('readings');table({...readings,title:'Device First and Last Readings',rows:readings.rows.filter(row=>row[0]===name+'\n'+identity)});
   const audit=root.EcoTrackReportRules?.forDevice(report.ruleAudit,device.id)||{available:false,events:[],rules:[],rooms:[],ruleRanking:[],reason:'Device rule attribution unavailable.'};
   if(audit.events.length){const history=ruleSections({...report,ruleAudit:audit}).find(section=>section.key==='rule-history');table({...history,title:'Recorded Violations for This Device',rows:history.rows.slice(0,5),note:`${audit.events.length} available violations are explicitly linked to this device; showing up to five recent records. Room-only events remain in the combined report and are not assigned to an individual AC. `+(audit.available?'':audit.reason||'Cloud history is incomplete.')});}
   else note(audit.available?'No recorded violations are explicitly linked to this AC in the selected period. Room-only events are included in the combined report.':'Device rule history is incomplete: '+(audit.reason||'Cloud history unavailable.'));
  }
  return {rulesPage:rulesPage+1,devicePages};
 }
 function pdf(report){
  report=rotationReport(report);
  const data=snapshot(report),doc=new root.jspdf.jsPDF({orientation:'landscape',unit:'mm',format:'a4'}),W=doc.internal.pageSize.getWidth(),H=doc.internal.pageSize.getHeight(),M=12,C=W-2*M;
  const ink=[25,77,52],muted=[101,121,108],green=[17,149,108],pale=[243,248,245],line=[224,232,226];
  const text=(content,x,y,size=9,bold=false,color=ink,options={})=>{doc.setFont('helvetica',bold?'bold':'normal');doc.setFontSize(size);doc.setTextColor(...color);doc.text(safe(content),x,y,options);};
  function wrapped(content,x,y,width,size=8,color=muted){doc.setFont('helvetica','normal');doc.setFontSize(size);doc.setTextColor(...color);const lines=doc.splitTextToSize(safe(content),width);doc.text(lines,x,y);return y+lines.length*size*.36;}
  const money=value=>finite(value)?'PHP '+fmt(value):'—';
  // Reserve a dedicated cover and contents page before the combined report.
  doc.addPage();doc.addPage();
  text('EcoTrack',M,13,13,true,green);text('AC Energy Report',M,23,21,true);text(`${report.period.charAt(0).toUpperCase()+report.period.slice(1)} monitoring summary - ${report.date}`,M,30,9,false,muted);
  doc.setFont('helvetica','bold');doc.setFontSize(9);const scope=doc.splitTextToSize(safe(report.scope),76);doc.setTextColor(...ink);doc.text(scope,W-M,15,{align:'right'});
  const rightBottom=15+scope.length*3.5;text(report.time+' | UTC+08:00',W-M,rightBottom+3,8,false,muted,{align:'right'});text('Generated '+stamp(report.generated),W-M,rightBottom+8,7.5,false,muted,{align:'right'});
  let y=Math.max(37,rightBottom+13);doc.setDrawColor(...line);doc.line(M,y-4,W-M,y-4);
  y=wrapped(`${data.sensors.length} AC devices | Tariff ${data.rate===null?'—':'PHP '+fmt(data.rate)+' / kWh'} | Utility provider ${report.provider}`,M,y,C,8)+5;
  const cardW=(C-12)/3,cards=[['ESTIMATED ENERGY',data.kwh===null?'—':energyText(data.kwh)+' kWh','Covered recorded AC intervals'],['ESTIMATED COST',money(data.cost),'Energy x selected tariff'],['CONFIRMED AC OPERATION',data.confirmed===null?'—':hours(data.confirmed)+' unit-hours','Combined across selected AC devices']];
  cards.forEach(([label,value,note],index)=>{const x=M+index*(cardW+6);doc.setFillColor(...pale);doc.rect(x,y,cardW,25,'F');doc.setFillColor(...green);doc.rect(x,y,.8,25,'F');text(label,x+5,y+6,7,true,muted);let size=19;doc.setFont('helvetica','bold');while(size>10){doc.setFontSize(size);if(doc.getTextWidth(safe(value))<cardW-10)break;size-=.5;}text(value,x+5,y+15,size,true);text(note,x+5,y+21,6.5,false,muted);});
  y+=32;text('AC device comparison',M,y,11,true);text('Energy and cost are estimates',W-M,y,7,false,muted,{align:'right'});y+=4;
  const body=data.sensors.map(sensor=>[sensor.name+'\n'+sensor.displayId,sensor.location,energyText(sensor.kwh),money(sensor.cost),finite(sensor.coverage)?hours(sensor.coverage)+' h':'—']);
  if(!body.length)body.push([{content:'No sensor readings in this period.',colSpan:5,styles:{halign:'left',fontStyle:'normal'}}]);
  body.push([{content:'Total',colSpan:2,styles:{fontStyle:'bold'}},energyText(data.kwh),money(data.cost),finite(data.coverage)?hours(data.coverage)+' h':'—']);
  doc.autoTable({startY:y,margin:{top:28,bottom:18,left:M,right:M},head:[['AC device / Device ID','Location','Energy (kWh)','Est. cost','Estimate coverage']],body,theme:'plain',rowPageBreak:'avoid',styles:{font:'helvetica',fontSize:8,cellPadding:{top:2,right:3,bottom:2,left:3},textColor:ink,overflow:'linebreak',valign:'middle',lineWidth:0},headStyles:{fillColor:ink,textColor:[255,255,255],fontStyle:'bold',fontSize:7.5},alternateRowStyles:{fillColor:[246,249,246]},columnStyles:{0:{cellWidth:69},1:{cellWidth:82},2:{cellWidth:35,halign:'right'},3:{cellWidth:40,halign:'right'},4:{cellWidth:C-226,halign:'right'}},
   didParseCell(hook){if(hook.section==='body'&&hook.row.index===body.length-1){hook.cell.styles.fillColor=[237,245,239];hook.cell.styles.fontStyle='bold';}},
   didDrawPage(hook){if(hook.pageNumber>1){text('AC Energy Report - Device comparison (continued)',M,15,13,true);text(report.date,W-M,21,8,false,muted,{align:'right'});}}
  });
  y=doc.lastAutoTable.finalY+7;
  if(y+55>H-18){doc.addPage();text('AC Energy Report - Trend and measurements',M,16,13,true);text(report.date,W-M,22,8,false,muted,{align:'right'});y=32;}
  const chartW=168,gap=8,rightX=M+chartW+gap,rightW=C-chartW-gap,chart=buckets(report,data.energy?.points);
  text(chart.title,M,y,10,true);text('kWh',M+chartW,y,7,false,muted,{align:'right'});text('Recorded measurements',rightX+4,y,10,true);
  const entries=chart.items,valid=entries.filter(item=>finite(item.value));
  if(!valid.length){text('No energy estimate available',M+chartW/2,y+23,10,false,muted,{align:'center'});wrapped(report.energy?.reason||'No eligible estimated intervals in this selection.',M+8,y+30,chartW-16,7.5);}
  else{
   const x=M+10,top=y+9,width=chartW-13,height=30,max=Math.max(...valid.map(item=>item.value))*1.15||1;
   for(let i=0;i<=3;i++){const py=top+height-i*height/3;doc.setDrawColor(...line);doc.setLineWidth(.2);doc.line(x,py,x+width,py);text(fmt(max*i/3,max<1?3:1),x-2,py+1,6,false,muted,{align:'right'});}
   const step=width/entries.length,barW=Math.min(11,step*.55);
   entries.forEach((item,index)=>{const cx=x+step*(index+.5);text(item.label,cx,top+height+5,entries.length>8?5.5:6.5,false,muted,{align:'center'});if(item.value===null){text('n/a',cx,top+height-3,6,false,muted,{align:'center'});return;}const bh=item.value/max*height;doc.setFillColor(...(item.partial?[134,179,155]:green));if(bh>0)doc.roundedRect(cx-barW/2,top+height-bh,barW,bh,.6,.6,'F');else{doc.setFillColor(...green);doc.circle(cx,top+height,.5,'F');}text(energyText(item.value),cx,top+height-bh-2,6,false,ink,{align:'center'});});
  }
  doc.setDrawColor(...line);doc.line(rightX,y-3,rightX,y+47);
  const measurements=[['Telemetry readings',fmt(report.rows.length,0)],['Average temperature',finite(report.stats?.target_temperature_avg)?fmt(report.stats.target_temperature_avg,1)+' deg C':'—'],['Airflow Indicator (RPM)',finite(statistics(report.rows,'rotation_rpm').mean)?fmt(statistics(report.rows,'rotation_rpm').mean,0)+' RPM':'—'],['Unconfirmed power readings',fmt(data.unknown,0)],['Previous-period energy','—']];
  measurements.forEach(([label,value],index)=>{const py=y+10+index*8;if(index===4){doc.setFillColor(...pale);doc.rect(rightX+3,py-4,rightW-3,8,'F');}text(label,rightX+5,py,7,false,muted);text(value,W-M-2,py,7,true,ink,{align:'right'});doc.setDrawColor(...line);doc.line(rightX+4,py+3,W-M,py+3);});
  const lastY=y+53;wrapped('Only covered intervals contribute to estimated energy. Detailed readings are available in Export Excel.',M,lastY,C,6.8);
  const reportIndex=appendAnalysisPdf(doc,report,data),futurePage=report.futureCost?doc.internal.getNumberOfPages()+1:null;
  root.EcoTrackFutureCost?.appendPdf(doc,report.futureCost);
  doc.setPage(1);doc.setFillColor(...pale);doc.rect(0,0,W,70,'F');doc.setFillColor(...green);doc.rect(0,0,W,5,'F');
  text('EcoTrack',M,25,17,true,green);text('MONITORING REPORT',W-M,25,8,true,muted,{align:'right'});
  text('AC Energy Forecast Report',M,48,25,true);text('Combined and Individual AC Device Reports',M,60,11,false,muted);
  const selectedCount=reportIndex.devicePages.length;
  doc.autoTable({startY:82,margin:{left:M,right:M,top:25,bottom:35},theme:'plain',styles:{font:'helvetica',fontSize:10,cellPadding:4,textColor:ink,overflow:'linebreak'},columnStyles:{0:{cellWidth:65,fontStyle:'bold',textColor:muted}},body:[['Selected AC scope',report.scope],['Observation period',report.date+' | '+report.time+' | UTC+08:00'],['Devices / recorded observations',selectedCount+' selected devices / '+report.rows.length+' readings'],['Tariff / utility provider',(data.rate===null?'—':'PHP '+fmt(data.rate)+' / kWh')+' | '+report.provider],['Generated',stamp(report.generated)]].map(row=>row.map(safe))});
  wrapped('Selected monitoring history, recorded rules and conditional AC energy estimates. The report contents and page guide follow on the next page.',M,doc.lastAutoTable.finalY+12,C,9);
  doc.setPage(2);text('EcoTrack',M,21,14,true,green);text('Report contents',M,39,23,true);text('Guide to the combined analysis, recorded evidence and individual AC reports',M,49,10,false,muted);
  const firstDevice=reportIndex.devicePages[0]?.page,lastDevice=reportIndex.devicePages.at(-1)?.page;
  doc.autoTable({startY:62,margin:{left:M,right:M,top:25,bottom:23},theme:'striped',styles:{font:'helvetica',fontSize:10,cellPadding:4,textColor:ink},headStyles:{fillColor:ink,textColor:[255,255,255]},head:[['Report section','Starts on page']],body:[['Combined device report','3'],['Rules Management and temperature violations',String(reportIndex.rulesPage)],['Individual reports for '+selectedCount+' AC devices',firstDevice?String(firstDevice)+(lastDevice!==firstDevice?' - '+lastDevice:''):'No selected devices'],['AC future-cost plan',futurePage?String(futurePage):'No future plan selected']]});
  wrapped('The PDF presents findings and recent evidence. Excel supplies the complete sortable datasets, interval calculations, saved rule settings and full violation history.',M,doc.lastAutoTable.finalY+9,C,8);
  const count=doc.internal.getNumberOfPages();
  for(let page=1;page<=count;page++){doc.setPage(page);doc.setDrawColor(...line);doc.setLineWidth(.2);doc.line(M,H-14,W-M,H-14);text('Experimental energy estimates. Confirmed operation uses recorded power feedback.',M,H-9,6.5,false,muted);text('EcoTrack | '+page+' / '+count,W-M,H-9,6.5,false,muted,{align:'right'});}
  doc.setProperties({title:'EcoTrack AC Energy Report',subject:report.date+' - '+report.scope,author:'EcoTrack',creator:'EcoTrack'});return doc;
 }
 root.EcoTrackSensorReports=Object.freeze({pdf,excel});
})(window);
