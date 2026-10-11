(function(root){
 'use strict';
 let dialog=null;
 const labels={power:'Power',temperature:'Temperature',turbo:'Turbo',quiet:'Quiet',eco:'Eco',swing_vertical:'Vertical swing',swing_horizontal:'Horizontal swing',sleep:'Sleep',display:'Display',filter:'Filter',clean:'Clean',beep:'Beep',timer:'Timer',i_feel:'I Feel'};
 function element(tag,text,className){const el=document.createElement(tag);if(text!=null)el.textContent=text;if(className)el.className=className;return el;}
 function field(label,el,parent){const row=element('label',null,'ac-verify-field');row.append(element('span',label),el);parent.append(row);return el;}
 function summary(device){
  const caps=root.EcoTrackAirconSystem.CapabilityEngine.getCapabilities(device);
  if(!caps.can_transmit)return caps.protocol_name==='UNKNOWN'?'Protocol not identified · raw learning available':'Choose the exact remote model before transmitting.';
  const verified=Object.values(caps.feature_status).filter(f=>f.status.startsWith('verified_')).length;
  return caps.protocol_name+(caps.model_name?' · '+caps.model_name:'')+' · '+verified+' physically verified feature results. Other available controls are library supported and unverified.';
 }
 function mount(device,anchor){
  if(!anchor)return;
  let panel=anchor.parentElement.querySelector('.ac-capability-summary');
  if(!panel){panel=element('div',null,'ac-capability-summary');const note=element('p');note.setAttribute('role','status');const button=element('button','Verify AC features');button.type='button';panel.append(note,button);anchor.insertAdjacentElement('afterend',panel);}
  panel.querySelector('p').textContent=summary(device);
  const button=panel.querySelector('button');button.onclick=()=>open(device.device_id);
  button.disabled=!device.aircon_id;
 }
 function annotate(button,status){
  if(!status)return;
  button.dataset.capabilityStatus=status.status;
  button.title=(button.title?button.title+' · ':'')+(status.status==='verified_supported'?'Physically verified':status.status==='verified_unsupported'?'Physically unsupported':status.status==='library_unverified'?'Library supported · physical operation unverified':'Capability unknown');
 }
 function open(deviceId){
  const system=root.EcoTrackAirconSystem,device=system.AirconProfileManager.getById(deviceId);
  if(!device)return;
  if(dialog?.open){dialog.focus();return;}
  const caps=system.AcCapabilityRegistry.resolve(device),previous=device.capability_profile||{},revision=previous.revision||0;
  dialog=element('dialog',null,'ac-verify-dialog');dialog.setAttribute('aria-labelledby','acVerifyTitle');
  const heading=element('h2','Verify AC features');heading.id='acVerifyTitle';
  const intro=element('p','Test one feature at a time and watch the physical AC. A queued or transmitted command is not physical confirmation. Results are optional and can be corrected later.','ac-verify-help');
  const form=element('form'),status=element('p',null,'ac-verify-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const identity=element('fieldset'),legend=element('legend',device.name+' · '+device.brand+' · '+caps.protocol);identity.append(legend);
  const models=element('select');models.append(new Option('Decoder / existing model',caps.remote_model||''));
  for(const [id,name] of Object.entries(caps.models||{}))if(Number(id)!==caps.remote_model)models.append(new Option(name,id));
  field('Remote model',models,identity);models.value=String(caps.remote_model||'');
  const modelConfirm=element('input');modelConfirm.type='checkbox';modelConfirm.checked=previous.model_verified===true;
  field('I checked the remote’s printed model',modelConfirm,identity);
  const physical=element('input');physical.maxLength=100;physical.value=previous.ac_model||'';field('Physical AC model (optional)',physical,identity);
  form.append(identity);
  const results=element('fieldset');results.append(element('legend','Physical test results'));
  const selections={},optionSelections={mode:{},fan:{}};
  function resultRow(label,result,feature,kind,option){
    const row=element('div',null,'ac-verify-result'),select=element('select');
    for(const [value,label] of [['','Not physically verified'],['verified_supported','Works on this AC'],['verified_unsupported','Does not work on this AC']])select.append(new Option(label,value));
    select.value=['verified_supported','verified_unsupported'].includes(result?.status)?result.status:'';
    field(label,select,row);
    if(feature && feature!=='temperature'){
      const test=element('button','Test ON'),off=element('button','Test OFF');
      for(const [btn,value] of [[test,true],[off,false]]){btn.type='button';btn.disabled=!caps.features[feature]||!caps.can_transmit;btn.addEventListener('click',async()=>{
        btn.disabled=true;status.textContent='Sending test request…';
        try{const res=await system.CommandManager.dispatch({device_id:deviceId,command:feature==='swing_vertical'?'SWING':feature.toUpperCase(),value});status.textContent=res.success?res.message+' Watch the AC, then select a physical result.':res.message;}
        catch(error){status.textContent=error.message;}finally{btn.disabled=false;}
      });}
      row.append(test,off);
    }else if(kind){
      const btn=element('button','Test '+option);btn.type='button';btn.disabled=!caps.can_transmit;
      btn.addEventListener('click',async()=>{btn.disabled=true;try{const res=await system.CommandManager.dispatch({device_id:deviceId,command:kind.toUpperCase(),value:option});status.textContent=res.message+' Record a result only after watching the AC.';}catch(error){status.textContent=error.message;}finally{btn.disabled=false;}});row.append(btn);
    }
    const note=element('small',result?.status==='verified_supported'?'Physically verified':result?.status==='verified_unsupported'?'Physically unsupported':result?.status==='library_unverified'?'Library supported · unverified':'Unknown / encoder unavailable');
    row.append(note);results.append(row);return select;
  }
  for(const feature of system.AcCapabilityRegistry.data.features)selections[feature]=resultRow(labels[feature]||feature,caps.feature_status[feature],feature);
  for(const [kind,options] of [['mode',caps.modes],['fan',Object.keys(caps.fan_map)]])
    for(const option of options)optionSelections[kind][option]=resultRow(kind.toUpperCase()+' · '+option,caps.option_status[kind]?.[option],null,kind,option);
  form.append(results);
  const temperatures=element('fieldset');temperatures.append(element('legend','Verified temperature constraints'));
  const min=element('input'),max=element('input'),step=element('input'),rangeConfirm=element('input');rangeConfirm.type='checkbox';rangeConfirm.checked=previous.temperature?.status==='verified_supported';
  for(const [el,key,label] of [[min,'min','Minimum °C'],[max,'max','Maximum °C'],[step,'step','Increment °C']]){
    el.type='number';el.step=caps.temperature?.step||'any';el.value=previous.temperature?.[key]??caps.temperature?.[key]??'';el.disabled=!caps.temperature;
    field(label,el,temperatures);
  }
  field('I physically checked this range and increment',rangeConfirm,temperatures);form.append(temperatures);
  const footer=element('div',null,'ac-verify-footer'),cancel=element('button','Close'),save=element('button','Save verified results');
  cancel.type='button';cancel.onclick=()=>dialog.close();save.type='submit';footer.append(cancel,save);form.append(status,footer);
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    const profile={protocol:caps.protocol,remote_model:models.value?Number(models.value):null,model_verified:modelConfirm.checked,ac_model:physical.value.trim(),features:{},options:{mode:{},fan:{}}};
    for(const [key,select] of Object.entries(selections))if(select.value)profile.features[key]={status:select.value};
    for(const [kind,values] of Object.entries(optionSelections))for(const [name,select] of Object.entries(values))if(select.value)profile.options[kind][name]={status:select.value};
    if(rangeConfirm.checked)profile.temperature={status:'verified_supported',min:Number(min.value),max:Number(max.value),step:Number(step.value)};
    if(rangeConfirm.checked&&(!min.value||!max.value||!step.value)){status.textContent='Enter the verified minimum, maximum and step.';return;}
    save.disabled=true;cancel.disabled=true;status.textContent='Saving verified results to Supabase…';
    try{await system.CapabilityEngine.verify(deviceId,profile,revision);status.textContent='Verified results saved.';root.EcoToast?.show('AC verification results saved.','success');dialog.close();}
    catch(error){status.textContent=error.message||'Results were not saved.';}
    finally{save.disabled=false;cancel.disabled=false;}
  });
  dialog.append(heading,intro,form);document.body.append(dialog);dialog.addEventListener('close',()=>{dialog.remove();dialog=null;},{once:true});dialog.showModal();
 }
 const style=element('style',`
 .ac-capability-summary{font-size:11px;line-height:1.5;margin-top:8px;color:#64748b;display:flex;flex-wrap:wrap;align-items:center;gap:8px}.ac-capability-summary p{flex:1;min-width:160px}.ac-capability-summary button,.ac-verify-dialog button{border:1px solid #14b8a6;border-radius:8px;padding:6px 10px;font-weight:600;color:#0f766e;background:#f0fdfa;cursor:pointer}.ac-verify-dialog{border:1px solid #14b8a6;border-radius:20px;padding:24px;width:min(700px,calc(100vw - 32px));max-height:90vh;overflow-y:auto;background:#fff;color:#18392b}.ac-verify-dialog::backdrop{background:#020617ad;backdrop-filter:blur(4px)}.ac-verify-dialog h2{font-size:20px;font-weight:700}.ac-verify-help,.ac-verify-status{font-size:12px;line-height:1.6;margin:8px 0 16px}.ac-verify-dialog fieldset{border:1px solid #e2e8f0;border-radius:12px;padding:12px;margin:12px 0}.ac-verify-dialog legend{font-weight:600;font-size:12px}.ac-verify-field{display:grid;grid-template-columns:minmax(150px,1fr) minmax(100px,1fr);align-items:center;gap:10px;font-size:12px;margin:8px 0}.ac-verify-dialog select,.ac-verify-dialog input:not([type=checkbox]){background:#f8fafc;color:inherit;border:1px solid #cbd5e1;border-radius:8px;padding:7px;min-width:0;width:100%}.ac-verify-result{padding:8px 0;border-bottom:1px solid #e2e8f0}.ac-verify-result button{font-size:11px;margin:0 6px 6px 0}.ac-verify-result small{display:block;font-size:10px;color:#64748b}.ac-verify-footer{display:flex;justify-content:flex-end;gap:10px;position:sticky;bottom:-24px;background:inherit;padding:12px 0}.ac-verify-dialog button:disabled{opacity:.45;cursor:not-allowed}.dark .ac-verify-dialog{background:#0c1427;color:#e2e8f0}.dark .ac-verify-dialog input,.dark .ac-verify-dialog select{background:#0f172a;border-color:#334155}.dark .ac-verify-dialog button{background:#134e4a;color:#99f6e4}.dark .ac-verify-result,.dark .ac-verify-dialog fieldset{border-color:#334155}@media(max-width:500px){.ac-verify-field{grid-template-columns:1fr}.ac-verify-dialog{padding:16px}}
 `);document.head.append(style);
 root.EcoTrackCapabilityVerification={open,mount,annotate,summary};
})(window);
