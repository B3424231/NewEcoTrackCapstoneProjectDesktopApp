'use strict';
// Public signup through the real renderer module and trusted IPC handler. No live accounts or network.
const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const registration=require('../public/js/admin-registration');
const receipt={adminId:'admin_new_fixture',authUserId:'22222222-2222-4222-8222-222222222222'};
const input={username:'  Second Administrator  ',email:' SECOND@EXAMPLE.INVALID ',password:'CaseSensitive-fixture-password'};
const normalized={username:'Second Administrator',email:'second@example.invalid',password:'CaseSensitive-fixture-password'};
const payload={body:{profile:normalized},timeout:20000};

function fixture({signedIn=false,result,invokeError}={}){
 const calls={functions:[],unsafe:[]},session=signedIn?{access_token:'primary-fixture',refresh_token:'primary-refresh',user:{id:'existing-dashboard-user'}}:null,before=JSON.stringify(session);
 const forbidden=name=>{calls.unsafe.push(name);throw Error('Public signup must not access '+name);};
 const client={
  get auth(){return forbidden('auth');},rpc(){return forbidden('rpc');},from(){return forbidden('from');},
  functions:{async invoke(name,options){calls.functions.push({name,options});if(invokeError)throw invokeError;return result||{data:{success:true,...receipt},error:null};}}
 };
 return{client,calls,session,unchanged(){assert.equal(JSON.stringify(session),before);assert.deepEqual(calls.unsafe,[]);}};
}

test('signed-out signup creates through the public function without prior account credentials',async()=>{
 const value=fixture();assert.deepEqual(await registration.registerAdministrator(value.client,input),receipt);assert.deepEqual(value.calls.functions,[{name:'provision-admin',options:payload}]);value.unchanged();
});
test('signed-in signup preserves the existing dashboard identity without Auth or role checks',async()=>{
 const value=fixture({signedIn:true});assert.deepEqual(await registration.registerAdministrator(value.client,input),receipt);assert.deepEqual(value.calls.functions,[{name:'provision-admin',options:payload}]);value.unchanged();
});
test('provisionAdministrator supports a public function client with no Auth dependency',async()=>{
 const value=fixture();assert.deepEqual(await registration.provisionAdministrator(value.client,input),receipt);value.unchanged();
});
test('new profile is normalized, passwords stay exact and supplied authority or approval fields are stripped',async()=>{
 const value=fixture();await registration.registerAdministrator(value.client,{...input,id:'injected',authUserId:'injected',role:'super-admin',userType:'admin',is_active:true,is_archived:false,approvalSession:{access_token:'not-forwarded'},approvalEmail:'existing@example.invalid',approvalPassword:'not-forwarded'});
 assert.deepEqual(value.calls.functions,[{name:'provision-admin',options:payload}]);assert.deepEqual(Object.keys(value.calls.functions[0].options.body.profile).sort(),['email','password','username']);value.unchanged();
});
test('invalid profile fields are rejected before a function request',async()=>{
 const value=fixture();for(const profile of [undefined,{...input,username:'ab'},{...input,username:'x'.repeat(121)},{...input,email:'username'},{...input,email:'09123456789'},{...input,email:'a@b'},{...input,password:'short'},{...input,password:'x'.repeat(1025)}])await assert.rejects(registration.registerAdministrator(value.client,profile),error=>error.code==='INVALID_PROFILE');
 assert.equal(value.calls.functions.length,0);value.unchanged();
});
test('confirmed receipts retain administrator ID and linked UUID requirements',()=>{
 assert.deepEqual(registration.confirmedReceipt({success:true,...receipt}),receipt);
 for(const result of [{},{adminId:receipt.adminId},{authUserId:receipt.authUserId},{...receipt,success:false},{...receipt,adminId:'staff_fixture'},{...receipt,adminId:'admin_'},{...receipt,authUserId:'invented-user'}])assert.throws(()=>registration.confirmedReceipt(result),error=>error.code==='UNCONFIRMED');
});
test('failed or incomplete service receipts never claim account creation',async()=>{
 for(const data of [{},{adminId:receipt.adminId},{...receipt,success:false},{...receipt,authUserId:'invented-user'},{...receipt,error:'Fixture account creation denied'}]){const value=fixture({result:{data}});await assert.rejects(registration.registerAdministrator(value.client,input));value.unchanged();}
});
test('function conflict details and missing deployment failures remain actionable',async()=>{
 const conflict=fixture({result:{error:{context:{status:409,json:async()=>({error:'This administrator email already exists'})}}}});await assert.rejects(registration.registerAdministrator(conflict.client,input),/email already exists/);conflict.unchanged();
 const absent=fixture({result:{error:{context:{status:404}}}});await assert.rejects(registration.registerAdministrator(absent.client,input),/provision-admin.*deploy/i);absent.unchanged();
});
test('rate and configuration failures do not request an existing administrator login',async()=>{
 for(const status of [401,403,404,429,503]){const value=fixture({result:{error:{context:{status}}}});await assert.rejects(registration.registerAdministrator(value.client,input),error=>{assert.doesNotMatch(error.message,/existing administrator|administrator approval|must approve/i);if(status===429)assert.match(error.message,/too many|rate|wait|later/i);if(status===401||status===403)assert.match(error.message,/unavailable.*provision-admin/i);if(status===404)assert.match(error.message,/provision-admin.*deploy/i);return true;});value.unchanged();}
 for(const status of [401,403]){const value=fixture({result:{error:{context:{status,json:async()=>({error:'Existing administrator approval required'})}}}});await assert.rejects(registration.registerAdministrator(value.client,input),error=>{assert.match(error.message,/unavailable.*provision-admin/i);assert.doesNotMatch(error.message,/existing administrator|administrator approval/i);return true;});value.unchanged();}
});
test('unreadable function error bodies and network failure cannot mutate the current session',async()=>{
 const broken=fixture({result:{error:{context:{status:503,json:async()=>{throw Error('Unreadable body');}}}}});await assert.rejects(registration.registerAdministrator(broken.client,input));broken.unchanged();
 const offline=fixture({invokeError:Error('Fixture network unavailable')});await assert.rejects(registration.registerAdministrator(offline.client,input),/network unavailable|registration|connection/i);offline.unchanged();
});
test('Electron signup sends the new profile without awaiting authentication or reading approval options',async()=>{
 const value=fixture(),calls=[];
 const options={get authReady(){throw Error('Public signup must not await Auth mirroring');},get approvalEmail(){throw Error('Approval email is retired');},get approvalPassword(){throw Error('Approval password is retired');},get createApprovalClient(){throw Error('Approval client is retired');},async invoke(channel,profile){calls.push({channel,profile});return{success:true,...receipt};}};
 assert.deepEqual(await registration.registerAdministrator(value.client,input,options),receipt);assert.deepEqual(calls,[{channel:'auth-register-admin',profile:normalized}]);assert.equal(value.calls.functions.length,0);value.unchanged();
});
test('Electron signed-in signup also retains the current identity',async()=>{
 const value=fixture({signedIn:true});assert.deepEqual(await registration.registerAdministrator(value.client,input,{invoke:async()=>({success:true,...receipt})}),receipt);value.unchanged();
});
test('Electron errors and incomplete receipts never report success',async()=>{
 for(const result of [{success:false,error:'Fixture rate limit',code:'RATE_LIMITED'},{success:true,adminId:receipt.adminId},{success:true,...receipt,authUserId:'invalid-id'}]){const value=fixture();await assert.rejects(registration.registerAdministrator(value.client,input,{invoke:async()=>result}));assert.equal(value.calls.functions.length,0);value.unchanged();}
});

function ipcFixture(value,{trusted=true}={}){
 let handler,clientReads=0;const source=fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8'),start=source.indexOf("ipcMain.handle('auth-register-admin'"),end=source.indexOf('// Authenticated administrator staff management',start);assert(start>=0&&end>start);
 const globals={ipcMain:{handle(name,fn){assert.equal(name,'auth-register-admin');handler=fn;}},isTrustedDatabaseCaller:()=>trusted,getSupabaseAdmin:()=>{clientReads++;return value?.client||null;},provisionAdministrator:registration.provisionAdministrator,require(){throw Error('Public signup must not construct an approval client');}};
 Object.defineProperty(globals,'databaseSessionSync',{get(){throw Error('Public signup must not wait for session mirroring');}});
 vm.runInContext(source.slice(start,end),vm.createContext(globals));return{invoke:profile=>handler({},profile),clientReads:()=>clientReads};
}
test('trusted signed-out IPC signup invokes the public function with no Auth session',async()=>{
 const value=fixture(),ipc=ipcFixture(value),result=await ipc.invoke(input);assert.equal(result.success,true);assert.equal(result.adminId,receipt.adminId);assert.equal(result.authUserId,receipt.authUserId);assert.equal(ipc.clientReads(),1);assert.deepEqual(value.calls.functions,[{name:'provision-admin',options:payload}]);value.unchanged();
});
test('trusted IPC preserves an existing session and accepts the legacy profile envelope',async()=>{
 const value=fixture({signedIn:true}),result=await ipcFixture(value).invoke({profile:input});assert.equal(result.success,true);assert.deepEqual(value.calls.functions,[{name:'provision-admin',options:payload}]);value.unchanged();
});
test('untrusted IPC callers are denied before obtaining any function client',async()=>{
 const value=fixture(),ipc=ipcFixture(value,{trusted:false}),result=await ipc.invoke(input);assert.equal(result.success,false);assert.equal(result.code,'42501');assert.equal(ipc.clientReads(),0);assert.equal(value.calls.functions.length,0);value.unchanged();
});
test('IPC validation, configuration and service failures remain truthful',async()=>{
 const invalid=fixture();assert.equal((await ipcFixture(invalid).invoke({...input,email:'09123456789'})).success,false);assert.equal(invalid.calls.functions.length,0);invalid.unchanged();assert.equal((await ipcFixture(null).invoke(input)).success,false);
 const denied=fixture({result:{data:{success:false,error:'Fixture rate limit'}}}),result=await ipcFixture(denied).invoke(input);assert.equal(result.success,false);assert.match(result.error,/Fixture rate limit/);denied.unchanged();
});
test('renderer never embeds privileged service credentials or calls Auth administrator APIs',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../public/js/admin-registration.js'),'utf8');assert.doesNotMatch(source,/SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|sb_secret_[A-Za-z0-9_-]+|\.auth\.admin\./);assert.match(source,/functions\.invoke\('provision-admin'/);
});
