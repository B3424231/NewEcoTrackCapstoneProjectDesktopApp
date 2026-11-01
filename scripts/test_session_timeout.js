'use strict';

// Local fixtures only: no application server, account, database, or real timers.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const profileSource = fs.readFileSync(path.join(root, 'public/js/profile.js'), 'utf8');
const sharedSource = fs.readFileSync(path.join(root, 'public/js/shared.js'), 'utf8');
const timeoutStart = sharedSource.indexOf('// ===== SESSION TIMEOUT & INACTIVITY WATCHER =====');
const timeoutEnd = sharedSource.indexOf('// Fix keyboard focus routing', timeoutStart);
assert(timeoutStart >= 0 && timeoutEnd > timeoutStart);
const timeoutSource = sharedSource.slice(timeoutStart, timeoutEnd);

function harness(initial = {}) {
  const values = new Map(Object.entries(initial)), readyHandlers = [], listeners = new Map();
  const timers = new Map(), selectHandlers = new Map(), messages = [];
  let timerId = 0, resolveProfile, sessionClears = 0;
  const profileReply = new Promise(resolve => { resolveProfile = resolve; });
  const localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
  const select = {value:'30 minutes', addEventListener:(event, handler)=>selectHandlers.set(event, handler)};
  const location = {pathname:'/profile.html', search:'', hash:'', href:'/profile.html'};
  const document = {
    readyState:'loading',
    getElementById:id => id === 'session-timeout-select' ? select : null,
    querySelectorAll:() => [],
    addEventListener:(event, handler) => { if (event === 'DOMContentLoaded') readyHandlers.push(handler); }
  };
  const context = vm.createContext({
    document, localStorage, location,
    console:{log(){},warn(){},error(){}},
    sessionStorage:{clear(){sessionClears++;}},
    setTimeout(fn, ms) {const id=timerId++;timers.set(id,{fn,ms});return id;},
    clearTimeout:id => timers.delete(id),
    setInterval:() => 1,
    showEcoTrackToast:(message, type) => messages.push({message,type}),
    addEventListener(event, handler) {if(!listeners.has(event))listeners.set(event,[]);listeners.get(event).push(handler);},
    supabaseClient:{rpc:async name => name === 'ecotrack_my_profile' ? profileReply : {data:true,error:null}}
  });
  context.window = context;
  vm.runInContext(timeoutSource, context);
  vm.runInContext(profileSource, context);
  context.showProfileToast = (message, type) => messages.push({message,type});
  readyHandlers[0]();
  const ready = readyHandlers[1]();
  return {
    context, select, timers, localStorage, values, messages, ready, location,
    sessionClears:() => sessionClears,
    choose(value) {select.value=value;selectHandlers.get('change')?.();},
    setting:() => context.getSessionTimeoutSetting(),
    milliseconds:() => context.getSessionTimeoutMs(),
    emit(event, detail={}) {for(const handler of listeners.get(event)||[])handler(detail);},
    async finish(profile={}) {
      resolveProfile({data:{id:'fixture-admin',name:'Fixture admin',userType:'admin',session_timeout:'30 minutes',...profile},error:null});
      await ready;
    }
  };
}

test('Never saves while the account request is pending and survives its delayed default', async () => {
  const app=harness({ecoTrack_profile_user:JSON.stringify({id:'existing-admin',username:'Existing name',email:'admin@example.invalid',location:'Existing location',role:'admin'}),ecoTrackTheme:'dark'});
  app.choose('Never');
  assert.equal(app.localStorage.getItem('ecoTrack_session_timeout'),'Never');
  assert.equal(JSON.parse(app.localStorage.getItem('ecoTrack_profile_user')).session_timeout,'Never');
  assert.deepEqual(JSON.parse(app.localStorage.getItem('ecoTrack_profile_user')),{id:'existing-admin',username:'Existing name',email:'admin@example.invalid',location:'Existing location',role:'admin',session_timeout:'Never'});
  assert.equal(app.localStorage.getItem('ecoTrackTheme'),'dark');
  assert.equal(app.milliseconds(),0);
  assert.equal(app.timers.size,0);
  await app.finish();
  assert.equal(app.select.value,'Never');
  assert.equal(vm.runInContext('currentUser.session_timeout',app.context),'Never');
});

for (const value of ['Never','15 minutes','30 minutes','60 minutes']) {
  test(value+' persists across page startup and profile refresh', async () => {
    const app=harness();app.choose(value);await app.finish();
    const reload=harness(Object.fromEntries(app.values));
    assert.equal(reload.select.value,value);
    await reload.finish();
    assert.equal(reload.select.value,value);
    assert.equal(reload.milliseconds(),value==='Never'?0:parseInt(value,10)*60000);
  });
}

test('timed sessions schedule the expected warning and expiry, and activity replaces both', async () => {
  const app=harness();await app.finish();app.choose('15 minutes');
  assert.deepEqual([...app.timers.values()].map(timer=>timer.ms),[14*60000,15*60000]);
  app.emit('mousemove');app.emit('keydown');
  assert.equal(app.timers.size,2);
  const [warning,expiry]=[...app.timers.values()];
  warning.fn();assert.match(app.messages.at(-1).message,/expire in 1 minute/);
  expiry.fn();assert.equal(app.location.href,'login.html?timeout=true');assert.equal(app.sessionClears(),1);
  assert.equal(app.localStorage.getItem('ecoTrack_require_login'),'timeout');
});

test('Never removes all existing timer handles including zero and activity cannot rearm them', async () => {
  const app=harness();assert(app.timers.has(0));
  app.choose('Never');assert.equal(app.timers.size,0);
  for(const event of ['mousemove','mousedown','keydown','touchstart','scroll'])app.emit(event);
  assert.equal(app.timers.size,0);assert.equal(app.location.href,'/profile.html');
  await app.finish();
});

test('missing settings default to 30 minutes while explicit numeric zero means Never', async () => {
  const missing=harness();assert.equal(missing.setting(),'30 minutes');assert.equal(missing.milliseconds(),30*60000);await missing.finish();
  const disabled=harness({ecoTrack_profile_user:JSON.stringify({session_timeout:0})});
  assert.equal(disabled.setting(),'Never');assert.equal(disabled.select.value,'Never');assert.equal(disabled.milliseconds(),0);assert.equal(disabled.timers.size,0);await disabled.finish();
});

test('changing Never in another window clears the current window inactivity timers', async () => {
  const app=harness();await app.finish();assert.equal(app.timers.size,2);
  app.localStorage.setItem('ecoTrack_session_timeout','Never');
  app.emit('storage',{key:'ecoTrack_session_timeout',newValue:'Never'});
  assert.equal(app.timers.size,0);assert.equal(app.milliseconds(),0);
});
