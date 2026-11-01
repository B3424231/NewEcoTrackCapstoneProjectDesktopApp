/* Read-only Rules Management snapshots for AC reports. Never evaluates or saves rules. */
(function(root){
 'use strict';
 const columns={rules:'id,type,condition,value,unit,enabled,message,duration,start_date,end_date,start_time,end_time,room_id',rule_nodes:'id,rule_id,node_id',nodes:'id,name,monitoring_id,monitor_aircon_id,aircon_id,room_id',rooms:'id,name,floor_id',floors:'id,name,building_id',buildings:'id,name',notifications:'id,date,time,content,triggered,room_id,rule_id,node_id,created,is_dismissed_from_inbox,type,event_key'};
 async function fetchSource(client,signal){
  const entries=await Promise.all(Object.entries(columns).map(async([table,select])=>{
   const records=[],seen=new Set();let expected;
   do{
    if(signal?.aborted)throw new DOMException('Export cancelled.','AbortError');
    let query=client.from(table).select(select,{count:'exact'}).order('id',{ascending:true}).range(records.length,records.length+499);
    if(query.abortSignal)query=query.abortSignal(signal);if(query.retry)query=query.retry(false);
    const result=await query;
    if(result.error||!Array.isArray(result.data)||!Number.isSafeInteger(result.count)||result.count<0)throw Error('Rules Management data unavailable ('+table+').');
    if(expected!==undefined&&expected!==result.count)throw Error('Rules Management history changed during export. Retry.');expected=result.count;
    for(const record of result.data){if(!record.id||seen.has(String(record.id)))throw Error('Rules Management snapshot contains duplicate or missing identities.');seen.add(String(record.id));records.push(record);}
    if(records.length>expected||!result.data.length&&records.length<expected)throw Error('Rules Management snapshot is incomplete.');
   }while(records.length<expected);
   return [table==='rule_nodes'?'ruleNodes':table,records];
  }));
  return {...Object.fromEntries(entries),complete:true};
 }
 const key=value=>String(value??'').trim().toLowerCase();
 const content=event=>String(event.rawContent||event.content||event.message||'').replace(/^__INBOX_DISMISSED__\|\|\|/,'').trim();
 function timestamp(event){
  const saved=event.created||event.created_at;if(saved&&Number.isFinite(Date.parse(saved)))return new Date(saved).toISOString();
  const match=/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i.exec(String(event.time||'').trim());
  if(!/^\d{4}-\d{2}-\d{2}$/.test(event.date||'')||!match)return null;
  let hour=Number(match[1]);if(match[4])hour=hour%12+(/PM/i.test(match[4])?12:0);
  const parsed=Date.parse(event.date+'T'+String(hour).padStart(2,'0')+':'+match[2]+':'+(match[3]||'00')+'+08:00');
  return Number.isFinite(parsed)?new Date(parsed).toISOString():null;
 }
 function ranks(events,field,label){
  const grouped=new Map();for(const event of events.filter(event=>event.type==='temperature')){const id=event[field]||event[label];if(!grouped.has(id))grouped.set(id,{id,name:event[label],count:0});grouped.get(id).count++;}
  return [...grouped.values()].sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name));
 }
 function forDevice(audit,nodeId){
  const events=(audit?.events||[]).filter(event=>event.nodeId===nodeId);
  return {...audit,events,rules:(audit?.rules||[]).filter(rule=>rule.deviceIds.includes(nodeId)),rooms:ranks(events,'roomId','location'),ruleRanking:ranks(events,'ruleId','ruleName'),deviceOnly:true};
 }
 function prepare(report,source={}){
  const observations=report.rows||[],deviceMap=new Map((report.devices||[]).map(device=>[device.id,device]));
  for(const row of observations)if(!deviceMap.has(row.node_id))deviceMap.set(row.node_id,{id:row.node_id,aircon_id:row.aircon_id,name:row.sensor_name,aircon_name:row.aircon_name});
  const devices=[...deviceMap.values()],rules=source.rules||[],rooms=source.rooms||[],nodes=source.nodes||[],floors=source.floors||[],buildings=source.buildings||[];
  const paths=new Map(rooms.map(room=>{const floor=floors.find(item=>item.id===room.floor_id),building=buildings.find(item=>item.id===floor?.building_id);return [String(room.id),[building?.name,floor?.name,room.name].filter(Boolean).join(' / ')];}));
  const targets=devices.map(device=>{
   const linked=nodes.filter(node=>node.monitoring_id===device.id||node.id===device.id||device.aircon_id&&[node.monitor_aircon_id,node.aircon_id].includes(device.aircon_id)||device.device_id&&'AC-'+node.id===device.device_id);
   const aliases=new Set([device.id,device.device_id,device.name,device.aircon_name,...linked.flatMap(node=>[node.id,node.name])].filter(Boolean).map(key));
   const historical=observations.filter(row=>row.node_id===device.id).map(row=>String(row.location||'').split('·').map(s=>s.trim()).join(' / '));
   const roomIds=new Set([...linked.map(node=>String(node.room_id||'')),...rooms.filter(room=>historical.includes(paths.get(String(room.id)))).map(room=>String(room.id))].filter(Boolean));
   return {id:device.id,name:device.aircon_name||device.name||device.id,aliases,roomIds};
  });
  const resolve=value=>{const matches=targets.filter(target=>target.aliases.has(key(value)));return matches.length===1?matches[0]:null;};
  const selectedRooms=new Set(targets.flatMap(target=>[...target.roomIds]));
  const scopedRules=rules.map(rule=>{
   const links=(source.ruleNodes||[]).filter(link=>link.rule_id===rule.id).map(link=>link.node_id);
   const deviceIds=targets.filter(target=>links.length?links.some(link=>target.aliases.has(key(link))):rule.room_id?target.roomIds.has(String(rule.room_id)):true).map(target=>target.id);
   return {...rule,deviceIds,location:paths.get(String(rule.room_id))||'All assigned devices'};
  }).filter(rule=>rule.deviceIds.length);
  const filters=report.filters||{},dates=String(report.date||'').match(/\d{4}-\d{2}-\d{2}/g)||[];
  const from=Date.parse(filters.from||dates[0]+'T00:00:00+08:00'),end=filters.to?Date.parse(filters.to):Date.parse((dates.at(-1)||'')+'T00:00:00+08:00')+86400000;
  const asOf=report.generated&&Number.isFinite(Date.parse(report.generated))?Date.parse(report.generated):Infinity;
  const events=[],ids=new Set(),fingerprints=new Set();let omitted=0;
  if(!Number.isFinite(from)||!Number.isFinite(end)||from>=end)return {available:false,reason:'The report observation window is unavailable.',rules:scopedRules,events:[],rooms:[],ruleRanking:[]};
  const notifications=(Array.isArray(source.notifications)?source.notifications:[]).map(event=>({...event,_local:false})),audit=(Array.isArray(source.audit)?source.audit:[]).map(event=>({...event,_local:true}));
  for(const event of [...notifications,...audit]){
   const text=content(event),rule=rules.find(rule=>String(rule.id)===String(event.rule_id||event.ruleId)),type=key(rule?.type||event.rule_type);
   if(event.triggered===false||event.type==='controller_installation'||/battery|\bwake\b|\bsleep\b|schedul|interval|maintenance/i.test(text)||type==='battery')continue;
   if(!rule&&!/temperature|\btemp\b|threshold|breach|went (?:above|below)|condition:/i.test(text))continue;
   const time=timestamp(event),epoch=Date.parse(time);if(!time){omitted++;continue;}
   if(epoch<from||epoch>=end||epoch>asOf)continue;
   const clock=new Date(epoch+28800000).toISOString().slice(11,16),startClock=filters.start_time,endClock=filters.end_time;
   if(startClock&&endClock&&startClock>endClock?clock<startClock&&clock>endClock:startClock&&clock<startClock||endClock&&clock>endClock)continue;
   const prefix=text.includes('|||')?text.split('|||')[0].trim():null,explicit=event.node_id||event.node||event.control,device=resolve(explicit)||resolve(prefix);
   if(explicit&&!device)continue;
   const roomId=String(event.room_id||event.roomId||event.room||rule?.room_id||'');
   if(!device&&!selectedRooms.has(roomId))continue;
   if(prefix&&!device&&nodes.some(node=>key(node.name)===key(prefix)||key(node.id)===key(prefix)))continue;
   const id=String(event.pbId||event.id||event.event_key||''),fingerprint=JSON.stringify([event.date||time.slice(0,10),event.time||time,roomId,event.rule_id||'',text]);
   if(id&&ids.has(id)||event._local&&fingerprints.has(fingerprint))continue;if(id)ids.add(id);fingerprints.add(fingerprint);
   const message=text.includes('|||')?text.split('|||').slice(1).join('|||').trim():text;
   const actual=/(?:was|actual\s*[:=]?|recorded\s*[:=]?)\s*(-?\d+(?:\.\d+)?)\s*(°?\s*[CF])/i.exec(message);
   const condition=/(?:went|is)\s+(above|below|equals?)\s+(-?\d+(?:\.\d+)?)\s*(°?\s*[CF])?/i.exec(message)||/\(Condition:\s*([^)]+)\)/i.exec(message);
   const recordedCondition=condition?(condition.length>2?condition[1]+' '+condition[2]+(condition[3]||''):condition[1]):'Unavailable';
   events.push({id:id||fingerprint,time,nodeId:device?.id||null,device:device?.name||'Room-level event (device not recorded)',roomId,location:paths.get(roomId)||'Location unavailable',ruleId:rule?.id||event.rule_id||'Historical rule unavailable',ruleName:rule?(rule.type==='temperature'?'Temperature rule ':'Rule ')+rule.id:'Historical temperature violation',type:type||'temperature',condition:recordedCondition,value:actual?Number(actual[1]):null,unit:actual?actual[2].replace(/\s/g,''):'Unavailable',recordedValue:actual?actual[1]+actual[2].replace(/\s/g,''):'Unavailable',message,dismissed:event.is_dismissed_from_inbox===true||String(event.content||'').startsWith('__INBOX_DISMISSED__|||'),archived:Boolean(event.archived)});
  }
  events.sort((a,b)=>Date.parse(b.time)-Date.parse(a.time));
  return {available:source.complete===true,reason:source.reason|| (source.complete?'Recorded Rules Management notifications and retained violation audit history.':'Rules Management cloud history is unavailable; retained local events may be incomplete.'),rules:scopedRules,events,rooms:ranks(events,'roomId','location'),ruleRanking:ranks(events,'ruleId','ruleName'),omitted};
 }
 async function load(report,{signal}={}){
  const abort=new AbortController(),cancel=()=>abort.abort();signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)abort.abort();
  const timer=setTimeout(cancel,15000);let source={complete:false};
  try{
   const task=root.electron?.invoke?root.electron.invoke('rules-fetch-data',{report:true}):fetchSource(root.supabaseClient||root.sb,abort.signal).then(data=>({success:true,data}));
   const result=await Promise.race([task,new Promise((_,reject)=>{if(abort.signal.aborted)reject(Error('Rules Management export was cancelled or timed out.'));else abort.signal.addEventListener('abort',()=>reject(Error('Rules Management export was cancelled or timed out.')),{once:true});})]);
   if(!result?.success||!result.data?.complete)throw Error(result?.error||'A complete Rules Management snapshot was not returned.');source=result.data;
  }catch(error){if(signal?.aborted)throw new DOMException('Export cancelled.','AbortError');source={complete:false,reason:error.message};}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
  try{source.audit=root.getStoredViolationAuditHistory?root.getStoredViolationAuditHistory():JSON.parse(root.localStorage?.getItem('ecoTrack_violation_audit_history')||root.localStorage?.getItem('ecoTrack_violationAuditHistory')||'[]');}catch(_){source.audit=[];}
  return prepare(report,source);
 }
 const api=Object.freeze({fetchSource,prepare,forDevice,load});if(typeof module==='object'&&module.exports)module.exports=api;else root.EcoTrackReportRules=api;
})(typeof window==='object'?window:globalThis);
