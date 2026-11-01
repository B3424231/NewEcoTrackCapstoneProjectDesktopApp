'use strict';
// Actual desktop login/recovery UI, isolated primary/recovery Supabase fixtures only.
// No external email, account, password, database or hardware changes are made.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
let playwright=process.env.ECOTRACK_PLAYWRIGHT;
if(!playwright){try{playwright=require.resolve('playwright');}catch(_){playwright=path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');}}
const {chromium}=require(playwright);
const root=path.resolve(__dirname,'..'),publicRoot=path.join(root,'public');
const out=path.resolve(process.env.ECOTRACK_RECOVERY_REPORT_DIR || path.join(root,'reports/password-recovery'));
const checks=[],runtimeErrors=[],externalRequests=[],unexpectedWrites=[];
let browser,server;
const fixtureScript=String.raw`(()=>{
 const f=window.fixture={clients:[],calls:[],ipc:[],gates:{},waiters:{},sendError:null,verifyError:null,updateError:null,loginError:null,profileError:null,profileThrows:false,profileType:'admin',inactive:false,archived:false,profileMismatch:false};
 const primaryId='primary-admin-user',recoveryId='recovered-admin-user';
 const identity=(id,email)=>({id,email,user_metadata:{full_name:'Fixture administrator'}});
 const session=(id,email)=>({access_token:id+'-access',refresh_token:id+'-refresh',user:identity(id,email)});
 const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
 f.release=operation=>{for(const release of f.waiters[operation] || [])release();f.waiters[operation]=[];f.gates[operation]=false;};
 async function gate(operation){if(f.gates[operation])await new Promise(resolve=>(f.waiters[operation] ||= []).push(resolve));}
 const failure=value=>value==='network'?Object.assign(new Error('Fixture network unavailable'),{code:'NETWORK_ERROR'}):value;
 window.supabase={createClient(url,key,options={}){
  const isolated=options.auth?.persistSession===false,record={isolated,options:clone(options),storageIsLocal:options.auth?.storage===window.localStorage,session:isolated?null:session(primaryId,'signedin@example.invalid'),verified:false};
  f.clients.push(record);const client={supabaseUrl:url,supabaseKey:key,auth:{
   getSession:async()=>({data:{session:clone(record.session)},error:null}),
   getUser:async()=>{f.calls.push({operation:'getUser',isolated});await gate('identity');return {data:{user:clone(record.session?.user || null)},error:null};},
   onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}};},
   setSession:async value=>{f.calls.push({operation:'setSession',isolated});record.session={...value,user:identity(primaryId,'signedin@example.invalid')};return {data:{session:clone(record.session),user:clone(record.session.user)},error:null};},
   signInWithPassword:async payload=>{
    f.calls.push({operation:'signInWithPassword',isolated,payload:clone(payload)});await gate('login');
    if(f.loginError)return {data:{session:null,user:null},error:failure(f.loginError)};
    record.session=session(primaryId,payload.email);return {data:{session:clone(record.session),user:clone(record.session.user)},error:null};
   },
   resetPasswordForEmail:async(email,options)=>{
    f.calls.push({operation:'resetPasswordForEmail',isolated,email,options:clone(options)});await gate('send');
    if(f.sendError==='network')throw failure(f.sendError);
    return {data:{},error:failure(f.sendError)};
   },
   verifyOtp:async payload=>{
    f.calls.push({operation:'verifyOtp',isolated,payload:clone(payload)});await gate('verify');
    if(f.verifyError==='network')throw failure(f.verifyError);
    if(f.verifyError || payload.token!=='345678')return {data:{session:null,user:null},error:failure(f.verifyError || {message:'Token has expired or is invalid',code:'otp_expired',status:403})};
    record.session=session(recoveryId,payload.email);record.verified=true;return {data:{session:clone(record.session),user:clone(record.session.user)},error:null};
   },
   updateUser:async payload=>{
    f.calls.push({operation:'updateUser',isolated,payload:clone(payload)});await gate('update');
    if(!isolated || !record.verified)throw Error('Fixture blocked an unverified/primary password mutation');
    if(f.updateError==='network')throw failure(f.updateError);
    return {data:{user:clone(record.session?.user)},error:failure(f.updateError)};
   },
   signOut:async options=>{f.calls.push({operation:'signOut',isolated,options:clone(options)});await gate('signOut');record.session=null;record.verified=false;return {error:null};},
   signUp:()=>{throw Error('Recovery must never create an account');}
  },rpc:async name=>{
   f.calls.push({operation:'rpc',name,isolated});
   const current=record.session?.user;
   if(name==='ecotrack_is_admin')return {data:!!current&&f.profileType==='admin'&&!f.inactive&&!f.archived,error:null};
   if(name==='ecotrack_my_profile'&&f.profileError){if(f.profileThrows)throw f.profileError;return {data:null,error:f.profileError};}
   if(name==='ecotrack_my_profile')return {data:current?{id:'fixture-admin-profile',authUserId:f.profileMismatch?'different-user':current.id,userType:f.profileType,role:f.profileType==='admin'?'Administrator':'Staff',name:'Fixture administrator',email:current.email,is_active:!f.inactive,isActive:!f.inactive,isArchived:f.archived}:null,error:null};
   return {data:[],error:null};
  }};return client;
 }};
 window.electron={env:{},on(){},invoke:async(channel,input)=>{f.ipc.push({channel,input:clone(input)});if(channel==='auth-set-session')return {success:true};throw Error('Unexpected credential lookup/IPC: '+channel);}};
})();`;
async function main(){
 fs.mkdirSync(out,{recursive:true});
 server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://fixture').pathname;
  if(pathname==='/dashboard.html'){res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><h1>Fixture signed-in dashboard</h1>');return;}
  const file=path.resolve(publicRoot,'.'+decodeURIComponent(pathname));
  if(!file.startsWith(publicRoot+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.ttf':'font/ttf'})[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const site='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({executablePath:process.env.ECOTRACK_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 async function pageFor({width=1460,height=1000,theme='dark',remember,legacy}={}){
  const context=await browser.newContext({viewport:{width,height},timezoneId:'Asia/Singapore'});
  await context.addInitScript(({theme,remember,legacy})=>{
   localStorage.setItem('ecoTrack_supabase_url','https://isolated-recovery.invalid');localStorage.setItem('ecoTrack_supabase_anon_key','sb_publishable_isolated_fixture');localStorage.setItem('ecoTrackTheme',theme);
   if(remember!==undefined)localStorage.setItem('ecoTrack_remember_email',remember);
   if(legacy!==undefined)localStorage.setItem('ecoTrack_remember_username',legacy);
  },{theme,remember,legacy});
  await context.route('**/*',route=>{
   const url=route.request().url(),method=route.request().method();
   if(!['GET','HEAD'].includes(method))unexpectedWrites.push({url,method});
   if(url===site+'/js/supabase.umd.js')return route.fulfill({status:200,body:fixtureScript,contentType:'text/javascript'});
   if(url.startsWith('https://cdn.tailwindcss.com'))return route.fulfill({path:path.join(publicRoot,'vendor/tailwindcss.js'),contentType:'text/javascript'});
   if(url.startsWith(site+'/'))return route.continue();
   externalRequests.push(url);return route.abort();
  });await context.routeWebSocket(/.*/,socket=>socket.close());
  const page=await context.newPage();page.on('pageerror',e=>runtimeErrors.push(e.message));await page.goto(site+'/login.html');
  await page.locator('#email').waitFor();await page.waitForFunction(()=>window.fixture?.clients.length>0);
  // Settle the finite intro animation before installing a clock for cooldown checks.
  // Otherwise the initial screenshot can freeze the real sign-in card at opacity zero.
  await page.evaluate(()=>document.getAnimations().forEach(animation=>{if(animation.effect?.getComputedTiming().iterations!==Infinity)animation.finish();}));
  return {context,page};
 }
 async function count(page,operation,isolated){return page.evaluate(({operation,isolated})=>fixture.calls.filter(call=>call.operation===operation&&(isolated===undefined||call.isolated===isolated)).length,{operation,isolated});}
 const check=(condition,label)=>{assert(condition,label);checks.push(label);};
 async function noCredentialStorage(page){
  const stored=await page.evaluate(()=>JSON.stringify({local:Object.fromEntries(Object.entries(localStorage)),session:Object.fromEntries(Object.entries(sessionStorage))}));
  check(!/345678|FreshRecovery#2026|OriginalCase#2026|primary-admin-user-password/.test(stored),'Passwords and OTP codes never enter browser storage');
 }
 async function open(page,email='Admin@Example.Invalid'){
  await page.locator('#email').fill(email);await page.locator('#forgot-password-btn').click();await page.locator('section[data-recovery-step="email"]').waitFor({state:'visible'});
  if(email.includes('@'))check((await page.locator('#recovery-email').inputValue()).toLowerCase()===email.toLowerCase(),'Recovery opens with the login email');
 }
 async function send(page){await page.locator('#recovery-email').fill('Admin@Example.Invalid');await page.locator('#recovery-send-code').click();await page.locator('section[data-recovery-step="code"]').waitFor({state:'visible'});}
 async function verify(page){await page.locator('#recovery-code').fill('345678');await page.locator('#recovery-verify-code').click();await page.locator('section[data-recovery-step="password"]').waitFor({state:'visible'});}
 async function unchangedPrimary(page,before){
  const after=await page.evaluate(()=>({session:fixture.clients.find(client=>!client.isolated).session,ipc:fixture.ipc.length,signIns:fixture.calls.filter(call=>call.operation==='signInWithPassword'&&!call.isolated).length,signOuts:fixture.calls.filter(call=>call.operation==='signOut'&&!call.isolated).length}));
  assert.deepEqual(after,before);checks.push('Recovery leaves the primary session, sign-in/out and desktop session IPC unchanged');
 }
 // Login accepts only email, calls Auth directly and preserves password casing/content.
 {
  const {page,context}=await pageFor();await page.clock.install();
  check(await page.locator('#email').getAttribute('type')==='email','Desktop sign-in uses input[type=email]');
  check(await page.locator('label[for="email"]').innerText()==='Email Address','Desktop sign-in is labelled Email Address');
  check(await page.locator('#username').count()===0,'Username/phone sign-in control is removed');
  check(!/master account recovery|admin \/ admin|admin@ecotrack\.local/i.test(await page.locator('#forgot-modal').textContent()),'Recovery dialog has no default credentials or manual database recovery instructions');
  for(const invalid of ['administrator','09123456789']){
   await page.locator('#email').fill(invalid);await page.locator('#password').fill('OriginalCase#2026');await page.locator('#login-form').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
   check(await count(page,'signInWithPassword',false)===0,'Invalid identifier '+invalid+' is rejected before Auth');
  }
  check(await page.evaluate(()=>fixture.ipc.every(call=>call.channel==='auth-set-session')),'Invalid identifiers never invoke username/phone lookup or fallback IPC');
  await page.locator('#email').fill('Admin@Example.Invalid');await page.locator('#password').fill('OriginalCase#2026');await page.locator('#remember-me').check();await page.evaluate(()=>fixture.gates.login=true);
  await page.locator('#login-form .submit-btn').click();await page.waitForFunction(()=>fixture.calls.some(call=>call.operation==='signInWithPassword'));
  check(await page.locator('#login-form .submit-btn').isDisabled(),'Login disables duplicate submissions while Auth is pending');
  await page.locator('#login-form').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  const submitted=await page.evaluate(()=>fixture.calls.filter(call=>call.operation==='signInWithPassword'));
  check(submitted.length===1&&submitted[0].payload.email==='admin@example.invalid'&&submitted[0].payload.password==='OriginalCase#2026','Email sign-in calls Auth once with normalized email and the unchanged original password');
  await page.evaluate(()=>fixture.release('login'));await page.waitForFunction(()=>JSON.parse(localStorage.getItem('ecoTrack_profile_user')||'{}').userType==='admin');
  check(await page.evaluate(()=>fixture.calls.some(call=>call.operation==='rpc'&&call.name==='ecotrack_my_profile')&&fixture.ipc.some(call=>call.channel==='auth-set-session'&&call.input?.access_token==='primary-admin-user-access')),'Successful sign-in verifies the profile and mirrors the authenticated primary session to the main process');
  const persisted=await page.evaluate(()=>({email:localStorage.getItem('ecoTrack_remember_email'),profile:JSON.parse(localStorage.getItem('ecoTrack_profile_user')||'{}')}));
  check(persisted.email==='admin@example.invalid'&&persisted.profile.userType==='admin','Valid email sign-in persists the verified administrator profile and remembered email');
  await noCredentialStorage(page);await page.clock.fastForward(1000);await page.waitForURL('**/dashboard.html');
  await context.close();
 }
 // Remembered emails migrate; old non-email identifiers are never restored.
 {
  const {page,context}=await pageFor();const before=await page.evaluate(()=>fixture.ipc.length);const label=await page.locator('#login-form .submit-btn').textContent();
  await page.evaluate(()=>fixture.loginError={message:'Invalid login credentials',code:'invalid_credentials'});await page.locator('#email').fill('admin@example.invalid');await page.locator('#password').fill('WrongOriginalCase#2026');await page.locator('#login-form .submit-btn').click();await page.locator('#auth-alert').waitFor({state:'visible'});
  const calls=await page.evaluate(()=>fixture.calls.filter(call=>call.operation==='signInWithPassword'));
  check(calls.length===1&&calls[0].payload.password==='WrongOriginalCase#2026','A rejected password is attempted once without first-letter case guessing');
  check(await page.evaluate(()=>fixture.ipc.length)===before,'Rejected email/password sign-in never invokes fallback or identifier IPC');
  check(await page.locator('#login-form .submit-btn').isEnabled()&&(await page.locator('#login-form .submit-btn').textContent())===label,'Authentication failure restores the original sign-in button');await context.close();
 }
 for(const failure of [
  {message:'TypeError: Failed to fetch',status:0},
  {message:'getaddrinfo ENOTFOUND isolated-recovery.invalid',code:'ENOTFOUND'},
  {message:'Service temporarily unavailable',status:503},
  {message:'Profile permission denied',code:'42501'},
  {message:'Network request failed',throwError:true}
 ]){
  const {page,context}=await pageFor();
  const beforeIpc=await page.evaluate(async()=>{await window.ecotrackAuthReady;return fixture.ipc.length;});
  await page.evaluate(failure=>{fixture.profileError=failure;fixture.profileThrows=!!failure.throwError;},failure);
  await page.locator('#email').fill('admin@example.invalid');await page.locator('#password').fill('FixtureCase#2026');
  await page.locator('#login-form .submit-btn').click();await page.locator('#auth-alert').waitFor({state:'visible'});
  const message=await page.locator('#auth-alert').innerText();
  check(!/active administrator/.test(message),'Profile lookup failures never become false administrator rejection: '+failure.message);
  check(failure.code==='42501'?/permission|profile/i.test(message):/connection|cloud|reach|temporar/i.test(message),'Profile failure shows its actual connection or verification cause');
  check(await page.evaluate(()=>localStorage.getItem('ecoTrack_profile_user'))===null,'Failed profile verification cannot save a dashboard profile');
  check(await page.evaluate(before=>!fixture.ipc.slice(before).some(call=>call.channel==='auth-set-session'&&call.input?.access_token),beforeIpc),'Failed profile verification cannot authorize native access');
  check(await page.evaluate(()=>!fixture.calls.some(call=>call.operation==='signOut')),'A failed profile lookup does not discard valid Auth credentials');
  await page.evaluate(()=>{fixture.profileError=null;fixture.profileThrows=false;});
  await page.locator('#login-form .submit-btn').click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('ecoTrack_profile_user')||'{}').userType==='admin');
  check(true,'Administrator sign-in recovers when the profile service returns');await context.close();
 }
 for(const denied of ['staff','inactive','archived','identity']){
  const {page,context}=await pageFor();await page.evaluate(mode=>{if(mode==='staff')fixture.profileType='staff';if(mode==='inactive')fixture.inactive=true;if(mode==='archived')fixture.archived=true;if(mode==='identity')fixture.profileMismatch=true;},denied);
  await page.locator('#email').fill('admin@example.invalid');await page.locator('#password').fill('OriginalCase#2026');await page.locator('#login-form .submit-btn').click();await page.locator('#auth-alert').waitFor({state:'visible'});
  check((await page.locator('#auth-alert').innerText()).includes('active administrator')&&page.url().endsWith('/login.html'),'Desktop sign-in rejects '+denied+' profile access');
  check(await page.evaluate(()=>localStorage.getItem('ecoTrack_profile_user'))===null,denied+' sign-in cannot persist an authenticated profile');await context.close();
 }
 for(const legacy of ['Admin@Example.Invalid','administrator','09123456789']){
  const {page,context}=await pageFor({legacy});const value=await page.locator('#email').inputValue();
  check(value===(legacy.includes('@')?'admin@example.invalid':''),'Remember-me migration handles '+(legacy.includes('@')?'a valid legacy email':'a legacy non-email identifier'));
  check(await page.evaluate(()=>localStorage.getItem('ecoTrack_remember_username'))===null,'Legacy remember-username key is retired');await context.close();
 }
 // Full real dialog journey, loading feedback, duplicate protection and isolated cleanup.
 for(const dimensions of [{width:1460,height:1000,theme:'light'},{width:390,height:844,theme:'dark'}]){
  const {page,context}=await pageFor(dimensions);await page.clock.install();
  check(await page.locator('#email').inputValue()===''&&await page.locator('#password').inputValue()==='','Initial email-only sign-in keeps both credentials empty');
  await page.screenshot({path:path.join(out,'email-only-login-'+dimensions.width+'.png'),fullPage:true});
  const primary=await page.evaluate(()=>({session:fixture.clients.find(client=>!client.isolated).session,ipc:fixture.ipc.length,signIns:0,signOuts:0}));
  await open(page);check(await page.evaluate(()=>document.documentElement.classList.contains('dark')),'Login retains its existing dark theme');
  await page.screenshot({path:path.join(out,'recovery-email-'+dimensions.width+'.png'),fullPage:true});
  await page.evaluate(()=>fixture.gates.send=true);await page.locator('#recovery-send-code').click();await page.waitForFunction(()=>fixture.calls.some(call=>call.operation==='resetPasswordForEmail'));
  check(await page.locator('#recovery-send-code').isDisabled(),'Send-code action disables while its request is pending');
  check(await page.locator('#recovery-send-code').getAttribute('aria-busy')==='true','Send-code action exposes aria-busy while loading');
  check(await page.locator('#recovery-send-code .recovery-button-spinner').count()===1,'A spinning indicator appears immediately on the pending recovery action');
  await page.screenshot({path:path.join(out,'recovery-sending-'+dimensions.width+'.png'),fullPage:true});
  await page.locator('#recovery-email-form').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  check(await count(page,'resetPasswordForEmail',true)===1,'Repeated send submissions share one email request');await page.evaluate(()=>fixture.release('send'));await page.locator('section[data-recovery-step="code"]').waitFor({state:'visible'});
  const sent=await page.evaluate(()=>fixture.calls.find(call=>call.operation==='resetPasswordForEmail'));check(sent.email==='admin@example.invalid'&&sent.isolated,'Recovery requests normalize the email and use an isolated client');
  check(await page.evaluate(()=>fixture.clients.filter(client=>client.isolated).every(client=>client.options.auth.persistSession===false&&client.options.auth.autoRefreshToken===false&&client.options.auth.detectSessionInUrl===false&&/^ecoTrack-recovery-/.test(client.options.auth.storageKey)&&!client.storageIsLocal)),'Recovery clients disable persistence, URL session detection and auto-refresh and use their own memory storage');
  await page.screenshot({path:path.join(out,'recovery-code-'+dimensions.width+'.png'),fullPage:true});
  check(await page.locator('#recovery-resend-code').isDisabled(),'Resend is disabled during its cooldown');
  await page.clock.fastForward(61000);check(await page.locator('#recovery-resend-code').isEnabled(),'Resend becomes available after the cooldown');
  await page.locator('#recovery-resend-code').click();check(await count(page,'resetPasswordForEmail',true)===2,'Resend issues exactly one new recovery email');
  await page.evaluate(()=>fixture.gates.verify=true);await page.locator('#recovery-code').fill('345678');await page.locator('#recovery-verify-code').click();await page.waitForFunction(()=>fixture.calls.some(call=>call.operation==='verifyOtp'));
  check(await page.locator('#recovery-verify-code').isDisabled(),'Code verification disables while pending');await page.locator('#recovery-code-form').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));check(await count(page,'verifyOtp',true)===1,'Repeated code submissions cannot duplicate verification');
  await page.evaluate(()=>fixture.release('verify'));await page.locator('section[data-recovery-step="password"]').waitFor({state:'visible'});
  await page.screenshot({path:path.join(out,'recovery-password-'+dimensions.width+'.png'),fullPage:true});
  const verified=await page.evaluate(()=>fixture.calls.find(call=>call.operation==='verifyOtp'));assert.deepEqual(verified.payload,{email:'admin@example.invalid',token:'345678',type:'recovery'});checks.push('OTP verification uses the recovery type and the requested email');
  await page.locator('#recovery-password').fill('short');await page.locator('#recovery-confirm-password').fill('short');await page.locator('#recovery-password-form').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));check(await count(page,'updateUser',true)===0,'Short passwords cannot reach the update request');
  await page.locator('#recovery-password').fill('FreshRecovery#2026');await page.locator('#recovery-confirm-password').fill('Different#2026');await page.locator('#recovery-password-form').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));check(await count(page,'updateUser',true)===0,'Mismatched passwords cannot reach the update request');
  await page.locator('#recovery-confirm-password').fill('FreshRecovery#2026');await page.evaluate(()=>fixture.gates.update=true);await page.locator('#recovery-save-password').click();await page.waitForFunction(()=>fixture.calls.some(call=>call.operation==='updateUser'));
  check(await page.locator('#recovery-save-password').isDisabled(),'Password update exposes pending state and blocks duplicate clicks');check(await page.locator('#close-forgot-modal').isDisabled(),'Closing is visibly disabled while a password update is being committed');await page.keyboard.press('Escape');check(await page.locator('#forgot-modal').isVisible(),'Escape keeps the password result visible while its update is pending');await page.locator('#recovery-password-form').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));check(await count(page,'updateUser',true)===1,'Repeated password submissions issue one update');
  await page.evaluate(()=>fixture.release('update'));await page.locator('section[data-recovery-step="success"]').waitFor({state:'visible'});
  check(await page.locator('#recovery-password').inputValue()===''&&await page.locator('#recovery-code').inputValue()==='','Successful recovery clears password and code fields');
  check(await page.evaluate(()=>fixture.clients.filter(client=>client.isolated).every(client=>client.session===null)),'Successful recovery signs out the isolated recovery session');
  await unchangedPrimary(page,primary);await noCredentialStorage(page);
  const layout=await page.locator('#forgot-modal').evaluate(el=>{const box=el.getBoundingClientRect();return {left:box.left,top:box.top,right:box.right,bottom:box.bottom,width:innerWidth,height:innerHeight,overflow:el.scrollWidth>el.clientWidth+1};});
  check(layout.left>=0&&layout.right<=layout.width&&layout.top>=0&&layout.bottom<=layout.height&&!layout.overflow,'Recovery dialog fits '+dimensions.width+'px without horizontal overflow');
  await page.screenshot({path:path.join(out,'recovery-success-'+dimensions.width+'.png'),fullPage:true});
  await page.locator('#recovery-back-login').click();await page.locator('#forgot-modal').waitFor({state:'hidden'});
  check(await page.locator('#email').inputValue()==='admin@example.invalid','Return to sign-in keeps the recovered email');check(await page.locator('#password').inputValue()==='','Return to sign-in requires the user to enter the new password');
  await context.close();
 }
 // Invalid/expired code, service failure and eligible administrator gates remain retryable.
 for(const mode of ['invalid','expired','network','staff','inactive','archived','identity']){
  const {page,context}=await pageFor();await open(page);await send(page);
  await page.evaluate(mode=>{if(mode==='invalid'||mode==='expired')fixture.verifyError={message:'Token has expired or is invalid',code:'otp_expired',status:403};if(mode==='network')fixture.verifyError='network';if(mode==='staff')fixture.profileType='staff';if(mode==='inactive')fixture.inactive=true;if(mode==='archived')fixture.archived=true;if(mode==='identity')fixture.profileMismatch=true;},mode);
  await page.locator('#recovery-code').fill('345678');await page.locator('#recovery-verify-code').click();await page.locator('#recovery-alert').waitFor({state:'visible'});
  check(await page.locator('section[data-recovery-step="password"]').isHidden()&&await count(page,'updateUser',true)===0,'Recovery rejects '+mode+' verification before password entry');
  check(await page.locator('#recovery-verify-code').isEnabled(),mode+' verification failure restores retry controls');
  check(await page.evaluate(()=>fixture.clients.filter(client=>client.isolated).every(client=>client.session===null)),mode+' verification cannot retain a recovered session');
  await page.evaluate(()=>{fixture.verifyError=null;fixture.profileType='admin';fixture.inactive=false;fixture.archived=false;fixture.profileMismatch=false;});
  await verify(page);check(await page.locator('section[data-recovery-step="password"]').isVisible(),mode+' verification can retry successfully');await context.close();
 }
 for(const failure of ['network','rate']){
  const {page,context}=await pageFor();await open(page);await page.evaluate(failure=>fixture.sendError=failure==='network'?'network':{message:'Email rate limit exceeded',code:'over_email_send_rate_limit',status:429},failure);
  await page.locator('#recovery-send-code').click();await page.locator('#recovery-alert').waitFor({state:'visible'});check(await page.locator('section[data-recovery-step="email"]').isVisible(),failure+' send error keeps the email step');check(await page.locator('#recovery-send-code').getAttribute('aria-busy')!=='true',failure+' send error clears loading');
  await page.screenshot({path:path.join(out,'recovery-'+failure+'-error.png'),fullPage:true});await context.close();
 }
 {
  const {page,context}=await pageFor();await open(page);await page.evaluate(()=>fixture.sendError={message:'User not found',code:'user_not_found'});await send(page);
  check((await page.locator('#recovery-status').textContent()).includes('If this email belongs to an account'),'An unknown account receives the same generic recovery request receipt');check(await page.locator('#recovery-alert').isHidden(),'The email request stage does not disclose account existence');await context.close();
 }
 // Invalid local code input, change-email and close controls never mutate an account.
 {
  const {page,context}=await pageFor();await open(page);await send(page);await page.locator('#recovery-code').fill('12');await page.locator('#recovery-code-form').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));await page.locator('#recovery-alert').waitFor({state:'visible'});
  check(await count(page,'verifyOtp',true)===0,'An incomplete code is rejected locally before OTP verification');await page.locator('#recovery-change-email').click();await page.locator('section[data-recovery-step="email"]').waitFor({state:'visible'});check(await page.locator('#recovery-code').inputValue()==='','Changing the email clears the prior recovery code');
  await page.locator('#close-forgot-modal').click();await page.locator('#forgot-modal').waitFor({state:'hidden'});check(await page.locator('#forgot-password-btn').evaluate(el=>el===document.activeElement),'The close button restores focus without authentication or password updates');check(await count(page,'updateUser',true)===0,'Changing email and closing recovery never changes a password');await context.close();
 }
 {
  const {page,context}=await pageFor();await open(page);await send(page);await verify(page);await page.locator('#recovery-password').fill('FreshRecovery#2026');await page.locator('#recovery-confirm-password').fill('FreshRecovery#2026');await page.evaluate(()=>fixture.updateError='network');await page.locator('#recovery-save-password').click();await page.locator('#recovery-alert').waitFor({state:'visible'});
  check(await page.locator('section[data-recovery-step="password"]').isVisible()&&await page.locator('#recovery-save-password').isEnabled(),'An unconfirmed password update restores its action and close control');check((await page.locator('#recovery-alert').textContent()).includes('final status could not be confirmed'),'A network failure after sending a password update explains its unconfirmed status');check(await page.locator('section[data-recovery-step="success"]').isHidden(),'An unconfirmed update never shows success');await page.evaluate(()=>fixture.updateError=null);await page.locator('#recovery-save-password').click();check(await count(page,'updateUser',true)===1,'An unconfirmed update retires the prior authorization before any retry');await page.locator('#close-forgot-modal').click();await open(page);await send(page);await verify(page);await page.locator('#recovery-password').fill('FreshRecovery#2026');await page.locator('#recovery-confirm-password').fill('FreshRecovery#2026');await page.locator('#recovery-save-password').click();await page.locator('section[data-recovery-step="success"]').waitFor({state:'visible'});check(await count(page,'updateUser',true)===2,'A new recovery verification permits an explicit password retry');await noCredentialStorage(page);await context.close();
 }
 {
  const {page,context}=await pageFor();await open(page);await send(page);await verify(page);await page.evaluate(()=>fixture.inactive=true);await page.locator('#recovery-password').fill('FreshRecovery#2026');await page.locator('#recovery-confirm-password').fill('FreshRecovery#2026');await page.locator('#recovery-save-password').click();await page.locator('#recovery-alert').waitFor({state:'visible'});
  check(await count(page,'updateUser',true)===0,'Administrator eligibility is rechecked immediately before a password update');check(await page.evaluate(()=>fixture.clients.filter(client=>client.isolated).every(client=>client.session===null)),'Revoked administrator access clears the isolated recovery session');await context.close();
 }
 // Recovery deadlines restore the UI, suppress late replies and distinguish an unconfirmed update.
 for(const operation of ['send','verify','identity','update']){
  const {page,context}=await pageFor();await page.clock.install();const primary=await page.evaluate(()=>({session:fixture.clients.find(client=>!client.isolated).session,ipc:fixture.ipc.length,signIns:0,signOuts:0}));await open(page);
  if(operation!=='send')await send(page);if(['identity','update'].includes(operation))await verify(page);
  await page.evaluate(operation=>fixture.gates[operation]=true,operation);
  const action=operation==='send'?'resetPasswordForEmail':operation==='verify'?'verifyOtp':operation==='identity'?'getUser':'updateUser';const before=await count(page,action,true);
  const button=operation==='send'?'#recovery-send-code':operation==='verify'?'#recovery-verify-code':'#recovery-save-password';
  if(operation==='verify')await page.locator('#recovery-code').fill('345678');if(['identity','update'].includes(operation)){await page.locator('#recovery-password').fill('FreshRecovery#2026');await page.locator('#recovery-confirm-password').fill('FreshRecovery#2026');}
  await page.locator(button).click();await page.waitForFunction(({action,before})=>fixture.calls.filter(call=>call.operation===action&&call.isolated).length>before,{action,before});await page.clock.fastForward(15001);await page.locator('#recovery-alert').waitFor({state:'visible'});
  check(await page.locator(button).isEnabled()&&await page.locator('#close-forgot-modal').isEnabled(),operation+' deadline restores controls and permits closing');check(await page.locator(button).getAttribute('aria-busy')!=='true'&&await page.locator(button+' .recovery-button-spinner').count()===0,operation+' deadline clears its pending spinner');
  check((await page.locator('#recovery-alert').textContent()).includes(operation==='update'?'final status could not be confirmed':'too long to respond'),operation+' deadline reports the actual request outcome');
  if(operation==='identity')check(await count(page,'updateUser',true)===0,'A stalled identity revalidation cannot send a password update after its deadline');
  if(operation==='update'){await page.screenshot({path:path.join(out,'recovery-update-timeout.png'),fullPage:true});await page.locator(button).click();check(await count(page,'updateUser',true)===1,'An expired pending update cannot reuse its earlier recovery authorization');}
  await page.evaluate(operation=>fixture.release(operation),operation);await page.waitForFunction(()=>fixture.clients.filter(client=>client.isolated).every(client=>client.session===null));
  check(await page.locator('section[data-recovery-step="success"]').isHidden(),'A late '+operation+' reply cannot show password-update success');if(operation==='verify')check(await page.locator('section[data-recovery-step="password"]').isHidden(),'A late verification cannot unlock password entry after its deadline');
  await unchangedPrimary(page,primary);await noCredentialStorage(page);await page.locator('#close-forgot-modal').click();await page.locator('#forgot-modal').waitFor({state:'hidden'});await context.close();
 }
 {
  const {page,context}=await pageFor();await page.clock.install();const primary=await page.evaluate(()=>({session:fixture.clients.find(client=>!client.isolated).session,ipc:fixture.ipc.length,signIns:0,signOuts:0}));await open(page);await send(page);await verify(page);await page.evaluate(()=>fixture.gates.signOut=true);await page.locator('#recovery-password').fill('FreshRecovery#2026');await page.locator('#recovery-confirm-password').fill('FreshRecovery#2026');await page.locator('#recovery-save-password').click();await page.locator('section[data-recovery-step="success"]').waitFor({state:'visible'});
  check(await count(page,'signOut',true)>0&&await page.locator('#recovery-back-login').isEnabled(),'Confirmed password success appears while isolated logout is still stalled');await page.clock.fastForward(2001);check(await page.locator('section[data-recovery-step="success"]').isVisible()&&await page.locator('#close-forgot-modal').isEnabled(),'Bounded cleanup cannot replace a confirmed password result or block closing');await unchangedPrimary(page,primary);await page.evaluate(()=>fixture.release('signOut'));await page.waitForFunction(()=>fixture.clients.filter(client=>client.isolated).every(client=>client.session===null));await noCredentialStorage(page);await context.close();
 }
 // Closing a pending verifier cannot resurrect a verified session or the hidden modal.
 {
  const {page,context}=await pageFor();const before=await page.evaluate(()=>fixture.ipc.length);await open(page);await send(page);await page.evaluate(()=>fixture.gates.verify=true);await page.locator('#recovery-code').fill('345678');await page.locator('#recovery-verify-code').click();await page.waitForFunction(()=>fixture.calls.some(call=>call.operation==='verifyOtp'));
  await page.keyboard.press('Escape');await page.locator('#forgot-modal').waitFor({state:'hidden'});await page.evaluate(()=>fixture.release('verify'));await page.waitForFunction(()=>fixture.clients.filter(client=>client.isolated).every(client=>client.session===null));
  check(await page.locator('#forgot-modal').isHidden(),'A late verification reply cannot reopen a closed recovery dialog');check(await page.evaluate(()=>fixture.ipc.length)===before,'A late verification reply cannot mirror recovery credentials into the desktop session');
  check(await page.locator('#forgot-password-btn').evaluate(el=>el===document.activeElement),'Escape restores focus to the Forgot password trigger');await noCredentialStorage(page);await context.close();
 }
 assert.deepEqual(runtimeErrors,[],'Actual login/recovery page runtime errors');assert.deepEqual(unexpectedWrites,[],'Browser fixtures must not issue real account/password network mutations');
 fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({status:'PASS',checks,runtimeErrors,externalRequests,unexpectedWrites,live_email_sent:false,live_account_modified:false},null,2));
 console.log('PASS '+checks.length+' desktop email login and isolated password recovery browser checks.');
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({status:'FAIL',error:error.stack,checks,runtimeErrors,externalRequests,unexpectedWrites,live_email_sent:false,live_account_modified:false},null,2));}).finally(async()=>{await browser?.close();await new Promise(resolve=>server?server.close(resolve):resolve());});
