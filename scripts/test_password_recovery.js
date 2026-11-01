'use strict';
// Pure disposable Auth fixtures: no SDK network, email delivery, persistence, IPC or account writes.
const assert=require('node:assert/strict'),{test}=require('node:test');
const {createService}=require('../public/js/password-recovery');
const email='admin@example.invalid',id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
function fixture(options={}){
 const calls=[],clients=[];
 const createClient=config=>{
  calls.push(['create',config]);
  const state={session:null,user:{id,email},profile:{id:'admin_fixture',authUserId:id,email,userType:'admin',is_active:true},admin:true};
  const client={state,auth:{
   async resetPasswordForEmail(value){calls.push(['request',value]);if(options.requestGate)await options.requestGate.promise;if(options.requestThrow)throw Error('Fixture unavailable');return{error:options.requestError||null};},
   async verifyOtp(value){calls.push(['verify',value]);if(options.verifyGate)await options.verifyGate.promise;state.session={access_token:'isolated-access',refresh_token:'isolated-refresh',user:{...state.user}};if(options.invalidSession)state.session=options.invalidSession;return{data:{session:state.session,user:{...state.user}},error:options.verifyError||null};},
   async getUser(){calls.push(['user']);if(options.userGate)await options.userGate.promise;return{data:{user:state.user},error:options.userError||null};},
   async getSession(){calls.push(['session']);return{data:{session:state.session},error:options.sessionError||null};},
   async updateUser(value){calls.push(['update',value]);if(options.updateGate)await options.updateGate.promise;return{data:{user:state.user},error:options.updateError||null};},
   async signOut(value){calls.push(['signOut',value,state.session?.user?.id]);if(options.signOutGate)await options.signOutGate.promise;state.session=null;return{error:null};},
   async stopAutoRefresh(){calls.push(['stop']);if(options.stopGate)await options.stopGate.promise;}
  },async rpc(name){calls.push(['rpc',name]);if(options.rpcGate)await options.rpcGate.promise;if(options.rpcThrow)throw Error('Fixture RPC error');return{name,data:name==='ecotrack_is_admin'?state.admin:state.profile,error:options.rpcError||null};}};
  clients.push(client);return client;
 };
 const service=createService({createClient,...options.serviceOptions});
 return{service,calls,clients,count:name=>calls.filter(call=>call[0]===name).length};
}
async function verified(value){assert.equal((await value.service.request(email)).success,true);const result=await value.service.verify(email,'123456');assert.equal(result.success,true,JSON.stringify(result));return value;}

test('email-only input rejects identifiers without constructing a client',async()=>{
 const value=fixture();for(const identifier of ['admin','09123456789','','a@b','not an@email.invalid']){const result=await value.service.request(identifier);assert.equal(result.code,'INVALID_EMAIL');}assert.equal(value.clients.length,0);
});
test('requests normalize email and create an isolated nonpersistent client with unique memory storage',async()=>{
 const value=fixture(),result=await value.service.request('  ADMIN@EXAMPLE.INVALID ');assert.equal(result.success,true);assert.equal(result.email,email);assert.match(result.message,/If this email belongs to an account/);
 const config=value.calls.find(call=>call[0]==='create')[1];assert.equal(config.auth.persistSession,false);assert.equal(config.auth.autoRefreshToken,false);assert.equal(config.auth.detectSessionInUrl,false);assert.match(config.auth.storageKey,/^ecoTrack-recovery-/);
 config.auth.storage.setItem('fixture','one');assert.equal(config.auth.storage.getItem('fixture'),'one');config.auth.storage.removeItem('fixture');assert.equal(config.auth.storage.getItem('fixture'),null);
 assert.deepEqual(value.calls.find(call=>call[0]==='request'),['request',email]);await value.service.request(email);const configs=value.calls.filter(call=>call[0]==='create').map(call=>call[1]);assert.notEqual(configs[0].auth.storageKey,configs[1].auth.storageKey);assert.notEqual(configs[0].auth.storage,configs[1].auth.storage);assert(value.count('signOut')>=1);
});
test('send responses do not enumerate missing account emails',async()=>{
 const success=await fixture().service.request(email),missing=await fixture({requestError:{status:400,code:'user_not_found'}}).service.request(email);assert.deepEqual(missing,success);
});
test('send rate limits and transport failures remain actionable',async()=>{
 assert.equal((await fixture({requestError:{status:429}}).service.request(email)).code,'RATE_LIMITED');assert.equal((await fixture({requestError:{code:'network_error'}}).service.request(email)).code,'REQUEST_FAILED');assert.equal((await fixture({requestThrow:true}).service.request(email)).code,'REQUEST_FAILED');
});
test('numeric recovery code is required for the same requested email',async()=>{
 const value=fixture();assert.equal((await value.service.verify(email,'123456')).code,'REQUEST_REQUIRED');await value.service.request(email);for(const token of ['12345','12345678901','abcdef','123 456'])assert.equal((await value.service.verify(email,token)).code,'INVALID_CODE');assert.equal((await value.service.verify('other@example.invalid','123456')).code,'REQUEST_REQUIRED');assert.equal(value.count('verify'),0);
});
test('valid recovery OTP verifies active admin RPCs and unchanged server identity',async()=>{
 const value=await verified(fixture());assert.deepEqual(value.calls.find(call=>call[0]==='verify')[1],{email,token:'123456',type:'recovery'});assert(value.calls.some(call=>call[0]==='rpc'&&call[1]==='ecotrack_is_admin'));assert(value.calls.some(call=>call[0]==='rpc'&&call[1]==='ecotrack_my_profile'));assert(value.count('user')>0);assert.equal(value.count('update'),0);
});
test('invalid and expired OTPs never authorize an update and clear temporary sessions',async()=>{
 const value=fixture({verifyError:{code:'otp_expired'}});await value.service.request(email);assert.equal((await value.service.verify(email,'123456')).code,'INVALID_CODE');assert.equal((await value.service.reset('new-password','new-password')).code,'VERIFICATION_REQUIRED');assert.equal(value.count('update'),0);assert.equal(value.clients[0].state.session,null);assert(value.count('signOut')>0);
});
test('staff, inactive, archived, mismatched and unauthorized profiles cannot recover',async()=>{
 for(const change of [state=>state.admin=false,state=>state.profile.userType='staff',state=>state.profile.is_active=false,state=>state.profile.active=false,state=>state.profile.isArchived=true,state=>state.profile.is_archived=true,state=>state.profile.status='disabled',state=>state.profile.authUserId='different',state=>state.profile.email='other@example.invalid',state=>state.profile.id=null,state=>state.user.email='other@example.invalid']){
  const value=fixture();await value.service.request(email);change(value.clients[0].state);const result=await value.service.verify(email,'123456');assert.equal(result.success,false);assert.equal((await value.service.reset('new-password','new-password')).success,false);assert.equal(value.count('update'),0);assert.equal(value.clients[0].state.session,null);
 }
});
test('missing session tokens, server identity errors and RPC errors fail closed',async()=>{
 for(const options of [{invalidSession:{user:{id,email}}},{userError:{status:401}},{rpcError:{code:'42501'}},{rpcThrow:true},{sessionError:{status:401}}]){
  const value=fixture(options);await value.service.request(email);assert.equal((await value.service.verify(email,'123456')).success,false);assert.equal(value.count('update'),0);assert.equal(value.clients[0].state.session,null);
 }
});
test('password checks happen before any update and reset requires verified recovery',async()=>{
 const value=fixture();assert.equal((await value.service.reset('new-password','new-password')).code,'VERIFICATION_REQUIRED');await verified(value);assert.equal((await value.service.reset('short','short')).code,'INVALID_PASSWORD');assert.equal((await value.service.reset('new-password','different')).code,'PASSWORD_MISMATCH');assert.equal(value.count('update'),0);
});
test('reset rechecks administrator status, linked profile and unchanged subject',async()=>{
 for(const change of [state=>state.admin=false,state=>state.profile.is_active=false,state=>state.profile.authUserId='different',state=>state.user.id='different',state=>state.session.user.id='different']){
  const value=await verified(fixture());change(value.clients[0].state);assert.equal((await value.service.reset('new-password','new-password')).code,'VERIFICATION_REQUIRED');assert.equal(value.count('update'),0);assert.equal(value.clients[0].state.session,null);
 }
});
test('successful reset updates only the isolated client, revokes its session and cannot repeat',async()=>{
 const primary={session:{user:{id:'existing-dashboard-admin'}},ipcCalls:0},before=JSON.stringify(primary),value=await verified(fixture());const result=await value.service.reset('new-password','new-password');assert.deepEqual(result,{success:true,email});assert.deepEqual(value.calls.find(call=>call[0]==='update'),['update',{password:'new-password'}]);assert.equal(value.clients[0].state.session,null);assert(value.calls.filter(call=>call[0]==='signOut').every(call=>call[1].scope==='local'));assert.equal((await value.service.reset('again-password','again-password')).code,'VERIFICATION_REQUIRED');assert.equal(value.count('update'),1);assert.equal(JSON.stringify(primary),before);
});
test('failed password update reports failure without claiming success',async()=>{
 const value=await verified(fixture({updateError:{code:'same_password'}}));assert.equal((await value.service.reset('new-password','new-password')).code,'RESET_FAILED');assert.equal(value.count('update'),1);await value.service.cancel();assert.equal(value.clients[0].state.session,null);
});
test('duplicate pending requests and OTP verification are deduplicated',async()=>{
 const gate=deferred(),value=fixture({requestGate:gate});const a=value.service.request(email),b=value.service.request(email);assert.equal(a,b);await Promise.resolve();assert.equal(value.count('request'),1);assert.equal((await value.service.verify(email,'123456')).code,'BUSY');gate.resolve();await a;
 const verifyGate=deferred();const second=fixture({verifyGate});await second.service.request(email);const c=second.service.verify(email,'123456'),d=second.service.verify(email,'123456');assert.equal(c,d);await Promise.resolve();assert.equal(second.count('verify'),1);verifyGate.resolve();assert.equal((await c).success,true);
});
test('cancel before queued work prevents email delivery and verification',async()=>{
 const value=fixture(),pending=value.service.request(email);await value.service.cancel();assert.equal((await pending).code,'CANCELLED');assert.equal(value.count('request'),0);
});
test('cancel during a late verification revokes the eventual isolated session',async()=>{
 const gate=deferred(),value=fixture({verifyGate:gate});await value.service.request(email);const pending=value.service.verify(email,'123456');await Promise.resolve();await value.service.cancel();gate.resolve();assert.equal((await pending).code,'CANCELLED');assert.equal(value.clients[0].state.session,null);assert.equal((await value.service.reset('new-password','new-password')).code,'VERIFICATION_REQUIRED');assert.equal(value.count('update'),0);assert(value.count('signOut')>=2);
});
test('a late old verification cannot replace a newly opened recovery identity',async()=>{
 const gate=deferred(),value=fixture({verifyGate:gate});await value.service.request(email);const old=value.service.verify(email,'123456');await Promise.resolve();await value.service.cancel();await value.service.request(email);gate.resolve();assert.equal((await old).code,'CANCELLED');assert.equal(value.clients[0].state.session,null);assert.equal(value.clients[1].state.session,null);assert.equal((await value.service.verify(email,'123456')).success,true);assert.equal((await value.service.reset('new-password','new-password')).success,true);assert.equal(value.count('update'),1);
});
test('disposed service never restarts or retains an authenticated recovery session',async()=>{
 const value=await verified(fixture());await value.service.dispose();assert.equal(value.clients[0].state.session,null);assert.equal((await value.service.request(email)).code,'CANCELLED');assert.equal((await value.service.verify(email,'123456')).code,'CANCELLED');assert.equal((await value.service.reset('new-password','new-password')).code,'CANCELLED');assert.equal(value.count('update'),0);
});
test('cancel during reset identity revalidation prevents password update',async()=>{
 const options={},value=await verified(fixture(options));options.userGate=deferred();const pending=value.service.reset('new-password','new-password');await Promise.resolve();await value.service.cancel();options.userGate.resolve();assert.equal((await pending).code,'CANCELLED');assert.equal(value.count('update'),0);assert.equal(value.clients[0].state.session,null);
});
test('cancel while an older send is pending cannot block a newly opened flow',async()=>{
 const gate=deferred(),value=fixture({requestGate:gate});const first=value.service.request(email);await Promise.resolve();await value.service.cancel();const second=value.service.request(email);await Promise.resolve();gate.resolve();assert.equal((await first).code,'CANCELLED');assert.equal((await second).success,true);assert.equal(value.clients[0].state.session,null);assert.equal(value.count('request'),2);
});
test('resending invalidates a previously verified subject until the new code is verified',async()=>{
 const value=await verified(fixture());assert.equal((await value.service.request(email)).success,true);assert.equal(value.clients[0].state.session,null);assert.equal((await value.service.reset('new-password','new-password')).code,'VERIFICATION_REQUIRED');assert.equal(value.count('update'),0);assert.equal((await value.service.verify(email,'1234567890')).success,true);assert.equal((await value.service.reset('new-password','new-password')).success,true);
});
test('missing configuration or a failing isolated client factory returns an unavailable result',async()=>{
 assert.equal((await createService().request(email)).code,'UNAVAILABLE');assert.equal((await createService({createClient(){throw Error('Fixture configuration missing');}}).request(email)).code,'UNAVAILABLE');
});
test('cancellation after update dispatch never claims the already-sent change was reverted',async()=>{
 const options={},value=await verified(fixture(options));options.updateGate=deferred();const pending=value.service.reset('new-password','new-password');while(value.count('update')===0)await Promise.resolve();await value.service.cancel();options.updateGate.resolve();assert.equal((await pending).code,'RESET_UNCONFIRMED');assert.equal(value.count('update'),1);assert.equal(value.clients[0].state.session,null);
});
test('hung email delivery reaches a bounded retryable request deadline',async()=>{
 const value=fixture({requestGate:deferred(),serviceOptions:{timeoutMs:25,cleanupTimeoutMs:10}}),start=Date.now();assert.equal((await value.service.request(email)).code,'REQUEST_TIMEOUT');assert(Date.now()-start<1000);assert.equal((await value.service.reset('new-password','new-password')).code,'VERIFICATION_REQUIRED');
});
test('hung OTP verification times out and its late session is still revoked',async()=>{
 const gate=deferred(),value=fixture({verifyGate:gate,serviceOptions:{timeoutMs:25,cleanupTimeoutMs:10}});await value.service.request(email);assert.equal((await value.service.verify(email,'123456')).code,'REQUEST_TIMEOUT');gate.resolve();await new Promise(resolve=>setImmediate(resolve));assert.equal(value.clients[0].state.session,null);assert.equal(value.count('update'),0);assert.equal((await value.service.reset('new-password','new-password')).code,'VERIFICATION_REQUIRED');
});
test('hung identity or authorization checks release reset without dispatching a password write',async()=>{
 for(const field of ['userGate','rpcGate']){
  const options={serviceOptions:{timeoutMs:25,cleanupTimeoutMs:10}},value=await verified(fixture(options));options[field]=deferred();assert.equal((await value.service.reset('new-password','new-password')).code,'REQUEST_TIMEOUT');assert.equal(value.count('update'),0);options[field].resolve();await new Promise(resolve=>setImmediate(resolve));assert.equal(value.clients[0].state.session,null);
 }
});
test('hung password transport returns unconfirmed and cannot reuse the recovery subject',async()=>{
 const options={serviceOptions:{timeoutMs:25,cleanupTimeoutMs:10}},value=await verified(fixture(options));options.updateGate=deferred();const result=await value.service.reset('new-password','new-password');assert.equal(result.code,'RESET_UNCONFIRMED');assert.match(result.error,/Try signing in/);assert.equal((await value.service.reset('new-password','new-password')).code,'VERIFICATION_REQUIRED');options.updateGate.resolve();await new Promise(resolve=>setImmediate(resolve));assert.equal(value.clients[0].state.session,null);assert.equal(value.count('update'),1);
});
test('confirmed password success does not wait for hung remote session cleanup',async()=>{
 const options={serviceOptions:{timeoutMs:100,cleanupTimeoutMs:200}},value=await verified(fixture(options));options.signOutGate=deferred();options.stopGate=deferred();
 let timer;const guard=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Confirmed update waited for cleanup')),50);});const result=await Promise.race([value.service.reset('new-password','new-password'),guard]);clearTimeout(timer);assert.equal(result.success,true);assert.equal((await value.service.reset('new-password','new-password')).code,'VERIFICATION_REQUIRED');options.signOutGate.resolve();options.stopGate.resolve();await new Promise(resolve=>setImmediate(resolve));assert.equal(value.clients[0].state.session,null);
});
test('cancel and dispose have bounded cleanup even when logout and refresh shutdown hang',async()=>{
 const options={serviceOptions:{timeoutMs:100,cleanupTimeoutMs:15}},value=await verified(fixture(options));options.signOutGate=deferred();options.stopGate=deferred();const start=Date.now();await value.service.dispose();assert(Date.now()-start<1000);assert.equal((await value.service.request(email)).code,'CANCELLED');options.signOutGate.resolve();options.stopGate.resolve();await new Promise(resolve=>setImmediate(resolve));assert.equal(value.clients[0].state.session,null);
});
test('isolated SDK transport aborts a hung fetch at its own deadline without network access',async()=>{
 let signal;const value=fixture({serviceOptions:{timeoutMs:25,cleanupTimeoutMs:10,fetch:(_input,init)=>{signal=init.signal;return new Promise(()=>{});}}});await value.service.request(email);const config=value.calls.find(call=>call[0]==='create')[1];assert.equal(typeof config.global.fetch,'function');await assert.rejects(config.global.fetch('https://isolated.example.invalid/auth/v1/user'),error=>error.code==='RECOVERY_TIMEOUT');assert.equal(signal.aborted,true);await value.service.cancel();
});
test('timing out while previous-session cleanup hangs cannot later send another email',async()=>{
 const options={serviceOptions:{timeoutMs:25,cleanupTimeoutMs:80}},value=await verified(fixture(options));options.signOutGate=deferred();assert.equal((await value.service.request(email)).code,'REQUEST_TIMEOUT');options.signOutGate.resolve();await new Promise(resolve=>setImmediate(resolve));assert.equal(value.count('request'),1);assert.equal(value.clients.length,1);
});
test('network-uncertain password responses retire verification and require fresh recovery',async()=>{
 const value=await verified(fixture({updateError:{status:0}}));assert.equal((await value.service.reset('new-password','new-password')).code,'RESET_UNCONFIRMED');assert.equal((await value.service.reset('new-password','new-password')).code,'VERIFICATION_REQUIRED');await new Promise(resolve=>setImmediate(resolve));assert.equal(value.clients[0].state.session,null);
});
