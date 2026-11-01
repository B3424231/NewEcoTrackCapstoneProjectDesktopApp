/* Email recovery uses a disposable Auth client; it never replaces the dashboard session. */
(function(root){
  'use strict';
  const RECEIPT='If this email belongs to an account, a recovery code has been sent. Check your inbox and spam folder.';
  const emailValue=value=>typeof value==='string'?value.trim().toLowerCase():'';
  const validEmail=value=>value.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  const fail=(error,code)=>({success:false,error,code});
  const cancelled=()=>fail('Recovery was closed. Request a new code to continue.','CANCELLED');
  let clientSequence=0;
  function isRateLimited(error){return error?.status===429||/rate|over_email_send|over_request/.test(String(error?.code||''));}
  function inactive(value){return value?.is_active===false||value?.isActive===false||value?.active===false||value?.isArchived===true||value?.is_archived===true||value?.archived===true||['inactive','archived','disabled','deleted','blocked'].includes(String(value?.status||'').toLowerCase());}
  function memoryStorage(){const values=new Map();return{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};}

  function createService({createClient,fetch:fetcher=root.fetch?.bind(root),timeoutMs=15000,cleanupTimeoutMs=2000}={}){
    timeoutMs=Number.isFinite(timeoutMs)&&timeoutMs>0?timeoutMs:15000;
    cleanupTimeoutMs=Number.isFinite(cleanupTimeoutMs)&&cleanupTimeoutMs>0?cleanupTimeoutMs:2000;
    let current=null,revision=0,inFlight=null,disposed=false;
    const live=context=>!!context&&!disposed&&current===context&&context.revision===revision&&!context.cancelled;
    const unconfirmed=()=>fail('The password update was sent but its final status could not be confirmed. Try signing in with the new password, or request a new recovery code.','RESET_UNCONFIRMED');
    function abortTransport(context){context?.transport.controllers.forEach(controller=>controller.abort());context?.transport.controllers.clear();}
    function retireUnconfirmed(context){context.subject=null;context.requested=false;context.cancelled=true;abortTransport(context);if(current===context){current=null;++revision;}void cleanup(context);return unconfirmed();}
    async function bounded(value,milliseconds){let timer;try{return await Promise.race([value,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(Error('Recovery request timed out.'),{code:'RECOVERY_TIMEOUT'})),milliseconds);})]);}finally{clearTimeout(timer);}}
    async function cleanup(context,afterAuthReply=false){
      if(!context)return;
      if(context.cleanup){
        // A late verify/update reply can create a session after an earlier logout started.
        if(afterAuthReply)context.cleanup.then(()=>{void cleanup(context);});
        return context.cleanup;
      }
      context.subject=null;context.transport.cleaning=true;
      context.cleanup=(async()=>{
        try{await bounded(Promise.allSettled([Promise.resolve().then(()=>context.client.auth.signOut({scope:'local'})),Promise.resolve().then(()=>context.client.auth.stopAutoRefresh?.())]),cleanupTimeoutMs);}catch(_){}
        context.transport.controllers.forEach(controller=>controller.abort());context.transport.controllers.clear();
        context.transport.cleaning=false;
      })().finally(()=>{context.cleanup=null;});
      return context.cleanup;
    }
    function cancel(){
      ++revision;const previous=current;current=null;inFlight=null;
      if(previous){previous.cancelled=true;previous.subject=null;abortTransport(previous);}
      return cleanup(previous);
    }
    function clientFor(email){
      if(typeof createClient!=='function')throw Error('Recovery is unavailable. Reload the app and try again.');
      const transport={controllers:new Set(),cleaning:false};
      const isolatedFetch=async(input,init={})=>{
        if(typeof fetcher!=='function')throw Error('Recovery transport unavailable');
        const controller=new AbortController(),signal=init.signal||input?.signal,cancel=()=>controller.abort();
        transport.controllers.add(controller);if(signal?.aborted)controller.abort();else signal?.addEventListener('abort',cancel,{once:true});
        const deadline=transport.cleaning?cleanupTimeoutMs:timeoutMs;
        try{return await bounded(Promise.resolve().then(()=>fetcher(input,{...init,signal:controller.signal})),deadline);}
        catch(error){controller.abort();throw error;}
        finally{signal?.removeEventListener('abort',cancel);}
      };
      const client=createClient({global:{fetch:isolatedFetch},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false,storageKey:'ecoTrack-recovery-'+Date.now()+'-'+(++clientSequence),storage:memoryStorage()}});
      if(!client?.auth||typeof client.rpc!=='function')throw Error('Recovery is unavailable. Reload the app and try again.');
      return{client,email,revision,subject:null,requested:false,cancelled:false,transport,cleanup:null};
    }
    function perform(key,task){
      if(disposed)return Promise.resolve(cancelled());
      if(inFlight)return inFlight.key===key?inFlight.promise:Promise.resolve(fail('Wait for the current recovery request to finish.','BUSY'));
      const entry={key,promise:null,revision,context:current,updateSent:false};let timer;
      const work=Promise.resolve().then(()=>disposed||entry.revision!==revision?cancelled():task());
      const deadline=new Promise(resolve=>{timer=setTimeout(()=>{
        const context=entry.context;
        if(context){context.cancelled=true;context.subject=null;abortTransport(context);void cleanup(context);}
        if(inFlight===entry){if(current===context)current=null;++revision;}
        resolve(entry.updateSent?unconfirmed():fail('Recovery took too long to respond. Check your connection and request a new code.','REQUEST_TIMEOUT'));
      },timeoutMs);});
      entry.promise=Promise.race([work,deadline]).finally(()=>{clearTimeout(timer);if(inFlight===entry)inFlight=null;});
      inFlight=entry;return entry.promise;
    }
    async function administrator(context,subject){
      const identity=await context.client.auth.getUser(),user=identity?.data?.user;
      if(!live(context))return null;
      if(identity?.error||!user?.id||!validEmail(emailValue(user.email))||emailValue(user.email)!==context.email||inactive(user)||(subject&&user.id!==subject))return null;
      const [allowed,result]=await Promise.all([context.client.rpc('ecotrack_is_admin'),context.client.rpc('ecotrack_my_profile')]);
      const profile=result?.data;
      if(!live(context)||allowed?.error||allowed?.data!==true||result?.error||!profile?.id||profile.userType!=='admin'||profile.authUserId!==user.id||inactive(profile)||(profile.email&&emailValue(profile.email)!==context.email))return null;
      // The mutable local session must still belong to the server-verified subject.
      const session=await context.client.auth.getSession(),value=session?.data?.session;
      if(!live(context)||session?.error||!value?.access_token||!value?.refresh_token||value.user?.id!==user.id||emailValue(value.user?.email)!==context.email)return null;
      return user.id;
    }
    function request(email){
      const normalized=emailValue(email);
      if(!validEmail(normalized))return Promise.resolve(fail('Enter your account email address.','INVALID_EMAIL'));
      return perform('request:'+normalized,async()=>{
        const previous=current,startRevision=revision;
        if(previous){previous.cancelled=true;previous.subject=null;current=null;abortTransport(previous);await cleanup(previous);}
        if(disposed||revision!==startRevision)return cancelled();
        const requestRevision=++revision;
        let context;
        try{
          context=clientFor(normalized);context.revision=requestRevision;current=context;if(inFlight)inFlight.context=context;
          const result=await context.client.auth.resetPasswordForEmail(normalized);
          if(!live(context))return cancelled();
          if(result?.error){
            if(isRateLimited(result.error))return fail('Too many recovery requests. Wait a minute before trying again.','RATE_LIMITED');
            // Account existence is never disclosed by the send-code stage.
            if(!['user_not_found','email_not_found','identity_not_found'].includes(result.error.code))return fail('Recovery could not be sent. Check your connection and try again later.','REQUEST_FAILED');
          }
          context.requested=true;return{success:true,email:normalized,message:RECEIPT};
        }catch(_){return live(context)?fail('Recovery is temporarily unavailable. Check your connection and retry.','REQUEST_FAILED'):context?cancelled():fail('Recovery is unavailable. Reload the app and try again.','UNAVAILABLE');}
        finally{if(context&&!live(context))void cleanup(context);}
      });
    }
    function verify(email,code){
      const normalized=emailValue(email),token=typeof code==='string'?code.trim():'';
      if(!validEmail(normalized)||!/^\d{6,10}$/.test(token))return Promise.resolve(fail('Enter your account email and the 6–10 digit recovery code.','INVALID_CODE'));
      return perform('verify:'+normalized+':'+token,async()=>{
        const context=current;
        if(!context||!live(context)||!context.requested||context.email!==normalized)return fail('Request a code for this email before verifying it.','REQUEST_REQUIRED');
        context.subject=null;
        try{
          const result=await context.client.auth.verifyOtp({email:normalized,token,type:'recovery'});
          if(!live(context))return cancelled();
          const session=result?.data?.session,user=result?.data?.user;
          if(result?.error||!session?.access_token||!session?.refresh_token||!user?.id||session.user?.id!==user.id||emailValue(user.email)!==normalized){
            await cleanup(context);
            return isRateLimited(result?.error)?fail('Too many verification attempts. Wait a minute and try again.','RATE_LIMITED'):fail('The recovery code is invalid or expired. Request a new code and try again.','INVALID_CODE');
          }
          const subject=await administrator(context,user.id);
          if(!live(context))return cancelled();
          if(!subject){await cleanup(context);return fail('Recovery requires an active administrator account. Contact your administrator if access has changed.','ADMIN_REQUIRED');}
          context.subject=subject;return{success:true,email:normalized};
        }catch(_){await cleanup(context);return live(context)?fail('Unable to verify the code. Check your connection and try again.','VERIFICATION_FAILED'):cancelled();}
        finally{if(!live(context))void cleanup(context,true);}
      });
    }
    function reset(password,confirmation){
      if(typeof password!=='string'||password.length<8||password.length>1024)return Promise.resolve(fail('Use a password between 8 and 1024 characters.','INVALID_PASSWORD'));
      if(password!==confirmation)return Promise.resolve(fail('The passwords do not match.','PASSWORD_MISMATCH'));
      return perform('reset',async()=>{
        const context=current,subject=context?.subject;
        if(!context||!subject||!live(context))return fail('Verify a recovery code before changing your password.','VERIFICATION_REQUIRED');
        let updateSent=false;const entry=inFlight;
        try{
          const verified=await administrator(context,subject);
          if(!live(context))return cancelled();
          if(verified!==subject){context.subject=null;await cleanup(context);return fail('Your recovery verification expired or account access changed. Request a new code.','VERIFICATION_REQUIRED');}
          updateSent=true;entry.updateSent=true;
          const result=await context.client.auth.updateUser({password});
          if(!live(context))return unconfirmed();
          if(result?.error)return result.error.status===0||result.error.code==='RECOVERY_TIMEOUT'?retireUnconfirmed(context):fail('The password could not be updated. Request a new code or try a different password.','RESET_FAILED');
          const email=context.email;context.subject=null;context.requested=false;
          current=null;++revision;context.cancelled=true;abortTransport(context);void cleanup(context);
          return{success:true,email};
        }catch(_){return updateSent?retireUnconfirmed(context):live(context)?fail('The password could not be updated. Check your connection and try again.','RESET_FAILED'):cancelled();}
        finally{if(!live(context))void cleanup(context,true);}
      });
    }
    return Object.freeze({request,verify,reset,cancel,dispose(){disposed=true;return cancel();}});
  }

  function mount({onSuccess=()=>{},getInitialEmail=()=>''}={}){
    const doc=root.document,dialog=doc?.getElementById('forgot-modal'),opener=doc?.getElementById('forgot-password-btn');
    if(!dialog||!opener||dialog.dataset.recoveryMounted)return null;
    dialog.dataset.recoveryMounted='true';
    const $=id=>doc.getElementById(id),config=root.ECOTRACK_CONFIG;
    const visibilityButtons=[...dialog.querySelectorAll('.password-toggle-btn')].map(button=>({button,html:button.innerHTML,label:button.getAttribute('aria-label')}));
    const service=createService({createClient:options=>{
      if(!root.supabase?.createClient||!config?.supabaseUrl||!config?.supabaseKey||config.isSupabaseConfigured?.()===false)throw Error('Recovery configuration unavailable');
      return root.supabase.createClient(config.supabaseUrl,config.supabaseKey,options);
    }});
    let generation=0,pending=false,email='',step='email',cooldownUntil=0,ticker=null,prior=null,completionEmail=null;
    const alert=$('recovery-alert'),status=$('recovery-status');
    const notice=(message='',error=false)=>{alert.textContent=error?message:'';alert.hidden=!error||!message;status.textContent=error?'':message;status.hidden=error||!message;};
    function cooldown(){const seconds=Math.max(0,Math.ceil((cooldownUntil-Date.now())/1000)),button=$('recovery-resend-code');if(button){button.disabled=pending||seconds>0;button.textContent=seconds?'Resend code in '+seconds+'s':'Resend code';}if(!seconds&&ticker){clearInterval(ticker);ticker=null;}}
    function show(value){step=value;dialog.dataset.recoveryStep=value;dialog.querySelectorAll('[data-recovery-step]').forEach(node=>{node.hidden=node.dataset.recoveryStep!==value;});
      const number=value==='email'?1:value==='code'?2:value==='password'?3:4;dialog.querySelectorAll('[data-recovery-progress]').forEach(node=>{const item=Number(node.dataset.recoveryProgress),current=item===number;node.classList.toggle('is-active',current);node.classList.toggle('is-complete',item<number);if(current)node.setAttribute('aria-current','step');else node.removeAttribute('aria-current');});
      dialog.querySelectorAll('[data-recovery-email]').forEach(node=>{node.textContent=email;});
      const target={email:'recovery-email',code:'recovery-code',password:'recovery-password',success:'recovery-back-login'}[value];$(target)?.focus({preventScroll:true});
    }
    function resetView(){pending=false;email='';completionEmail=null;cooldownUntil=0;clearInterval(ticker);ticker=null;dialog.querySelectorAll('form').forEach(form=>form.reset());for(const id of ['recovery-password','recovery-confirm-password'])if($(id))$(id).type='password';visibilityButtons.forEach(({button,html,label})=>{button.innerHTML=html;if(label===null)button.removeAttribute('aria-label');else button.setAttribute('aria-label',label);});notice();show('email');setBusy(false);}
    function setBusy(value,button){pending=value;dialog.setAttribute('aria-busy',String(value));dialog.querySelectorAll('form input,form button,#recovery-resend-code,#recovery-change-email').forEach(node=>{node.disabled=value;});
      if($('close-forgot-modal'))$('close-forgot-modal').disabled=value&&step==='password';
      if(value&&step==='password')notice('Updating your password…');
      dialog.querySelectorAll('.recovery-button-spinner').forEach(node=>node.remove());dialog.querySelectorAll('[data-recovery-busy]').forEach(node=>{node.removeAttribute('data-recovery-busy');node.removeAttribute('aria-busy');});
      if(value&&button){button.dataset.recoveryBusy='true';button.setAttribute('aria-busy','true');const spinner=doc.createElement('span');spinner.className='recovery-button-spinner';spinner.setAttribute('aria-hidden','true');button.prepend(spinner);}cooldown();
    }
    async function action(button,task,success){if(pending)return;const id=generation;notice();setBusy(true,button);try{const result=await task();if(id!==generation||!dialog.open)return;if(result.success){setBusy(false);success(result);}else notice(result.error,true);}catch(_){if(id===generation&&dialog.open)notice('Recovery is temporarily unavailable. Please try again.',true);}finally{if(id===generation&&dialog.open)setBusy(false);}}
    function close(){if(pending&&step==='password'){notice('Your password update is being confirmed. Please wait before closing.');return;}const completed=completionEmail;completionEmail=null;++generation;void service.cancel();dialog.close();resetView();prior?.focus?.();if(completed)onSuccess(completed);}
    opener.addEventListener('click',event=>{event.preventDefault();if(dialog.open)return;++generation;void service.cancel();resetView();$('recovery-email').value=emailValue(getInitialEmail());prior=doc.activeElement;dialog.showModal();show('email');});
    $('close-forgot-modal')?.addEventListener('click',close);$('recovery-back-login')?.addEventListener('click',close);
    dialog.addEventListener('close',()=>{if(dialog.open)return;const completed=completionEmail;completionEmail=null;++generation;void service.cancel();resetView();prior?.focus?.();if(completed)onSuccess(completed);});
    dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
    dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const box=dialog.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)close();});
    function startCooldown(){cooldownUntil=Date.now()+60000;clearInterval(ticker);ticker=setInterval(cooldown,1000);cooldown();}
    $('recovery-email-form')?.addEventListener('submit',event=>{event.preventDefault();if(!$('recovery-email-form').reportValidity())return;const value=$('recovery-email').value;void action($('recovery-send-code'),()=>service.request(value),result=>{email=result.email;show('code');notice(result.message);startCooldown();});});
    $('recovery-code-form')?.addEventListener('submit',event=>{event.preventDefault();void action($('recovery-verify-code'),()=>service.verify(email,$('recovery-code').value),()=>{show('password');notice('Code verified. Choose a new password.');});});
    $('recovery-password-form')?.addEventListener('submit',event=>{event.preventDefault();void action($('recovery-save-password'),()=>service.reset($('recovery-password').value,$('recovery-confirm-password').value),()=>{completionEmail=email;$('recovery-code').value='';$('recovery-password').value='';$('recovery-confirm-password').value='';show('success');notice('Your password has been updated. Sign in with your email and new password.');});});
    $('recovery-resend-code')?.addEventListener('click',()=>{if(Date.now()<cooldownUntil)return;void action($('recovery-resend-code'),()=>service.request(email),result=>{show('code');$('recovery-code').value='';notice(result.message);startCooldown();});});
    $('recovery-change-email')?.addEventListener('click',()=>{if(pending)return;++generation;void service.cancel();resetView();show('email');});
    root.addEventListener?.('pagehide',()=>{++generation;clearInterval(ticker);void service.dispose();},{once:true});
    resetView();return Object.freeze({close,dispose(){++generation;clearInterval(ticker);return service.dispose();}});
  }
  const api=Object.freeze({createService,mount});
  if(typeof module==='object'&&module.exports)module.exports=api;else root.EcoTrackPasswordRecovery=api;
})(typeof window==='object'?window:globalThis);
