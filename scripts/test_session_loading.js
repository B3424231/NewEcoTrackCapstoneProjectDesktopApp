"use strict";
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../public/js/eco-data-bus.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
function storage() { const data = new Map(); return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) }; }
function boot(session, local) {
  const window = { sessionStorage: session, localStorage: local, addEventListener() {} };
  vm.runInNewContext(source, { window, console, AbortController, Date, setTimeout, clearTimeout });
  return window.EcoDataBus;
}
function account(local, id) { local.setItem('ecoTrack_profile_user', JSON.stringify({ id })); }
test('return navigation restores successful empty results and refreshes them without a foreground loader', async () => {
  const session=storage(), local=storage(); account(local,'alice');
  await boot(session,local).query('nodes', async () => []);
  const returned=boot(session,local), events=[];
  returned.onQuery('nodes', {onStart: p=>events.push(p),onSuccess: p=>events.push(p)});
  assert.equal(returned.getCached('nodes')?.length, 0, 'empty success survives document navigation');
  let release;
  const rows=await returned.query('nodes',()=>new Promise(resolve=>{release=resolve;}));
  assert.equal(rows.length,0); await tick();
  assert.equal(events.find(p=>'isBackground' in p)?.isBackground,true);
  release([{id:'new'}]); await tick();
  assert.equal(returned.getCached('nodes')[0].id,'new');
});
test('a failed background refresh retains the previous snapshot across navigation',async()=>{
  const session=storage(),local=storage();account(local,'alice');
  await boot(session,local).query('rules',async()=>[{id:'saved'}]);
  const returned=boot(session,local);
  await returned.query('rules',async()=>{throw Error('offline');}); await tick();
  assert.equal(boot(session,local).getCached('rules')?.[0].id,'saved');
});
test('account changes, logout, invalidation and clear cannot restore old data or late reads',async()=>{
  const session=storage(),local=storage();account(local,'alice');
  const first=boot(session,local);await first.query('staff',async()=>['alice']);
  account(local,'bob'); assert.equal(boot(session,local).getCached('staff'),null);
  const b=boot(session,local);await b.query('staff',async()=>['bob']);b.invalidate('staff');
  assert.equal(boot(session,local).getCached('staff'),null);
  let release;const read=b.query('pending',()=>new Promise(resolve=>{release=resolve;}));await tick();
  b.clear();release(['late']);await read;
  assert.equal(boot(session,local).getCached('pending'),null);
  await b.query('staff',async()=>['bob']);local.removeItem('ecoTrack_profile_user');
  assert.equal(boot(session,local).getCached('staff'),null);
});
test('unavailable browser storage does not break the loading flow',async()=>{
  const broken={getItem(){throw Error('blocked');},setItem(){throw Error('full');},removeItem(){}};
  const b=boot(broken,broken);assert.equal(await b.query('count',async()=>0),0);
});
