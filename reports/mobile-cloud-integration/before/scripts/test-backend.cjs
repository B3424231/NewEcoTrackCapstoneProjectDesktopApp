const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Execute the actual TypeScript services with controlled database/storage boundaries.
// These are regression/contract tests, not a replacement for deployed RLS tests.
function harness(respond = () => ({ data: [], error: null }), initial = {}, readImage = async () => { throw Error('Unexpected network request'); }) {
  const calls = [], cache = new Map(), stored = new Map(Object.entries(initial));
  let clientOptions, uploadError = null;
  const storage = {
    getItem: async key => stored.get(key) ?? null,
    setItem: async (key, value) => { stored.set(key, value); },
    removeItem: async key => { stored.delete(key); },
    getAllKeys: async () => [...stored.keys()],
    multiRemove: async keys => keys.forEach(key => stored.delete(key)),
  };
  const client = {
    from(table) {
      const call = { table, ops: [] }; calls.push(call);
      const query = new Proxy({}, { get(_, method) {
        if (method === 'then') return (resolve, reject) => Promise.resolve().then(() => { const result = respond(call); const cursor = call.ops.find(x => x[0] === 'gt' && x[1] === 'id'); return cursor && Array.isArray(result.data) ? { ...result, data: result.data.filter(row => row.id > cursor[2]) } : result; }).then(resolve, reject);
        return (...args) => { call.ops.push([method, ...args]); return query; };
      } });
      return query;
    },
    rpc: async (name, args) => { const call = { rpc: name, args, ops: [] }; calls.push(call); return respond(call); },
    auth: { getUser: async () => ({ data: { user: { id: 'auth-s1' } }, error: null }), signOut: async () => { calls.push({ signOut: true }); return { error: null }; } },
    storage: { from: bucket => ({
      upload: async (file, bytes, options) => { calls.push({ upload: { bucket, file, bytes, options } }); return { error: uploadError }; },
      createSignedUrl: async file => ({ data: { signedUrl: `https://test.invalid/storage/v1/object/sign/${bucket}/${file}?token=test` }, error: null }),
    }) },
  };
  function load(name) {
    const filename = path.resolve(name);
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    const source = fs.readFileSync(filename, 'utf8');
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const mockRequire = spec => {
      if (spec === '@react-native-async-storage/async-storage') return storage;
      if (spec === '@supabase/supabase-js') return { createClient: (_url, _key, options) => { clientOptions = options; return client; } };
      if (spec === 'react-native') return { Platform: { OS: 'android' } };
      if (spec === '@/utils/notification-emitter') return { NotificationEmitter: { trigger: (...args) => calls.push({ notification: args }) } };
      if (spec.startsWith('.')) return load(path.resolve(path.dirname(filename), spec + '.ts'));
      throw Error(`Unexpected dependency ${spec}`);
    };
    vm.runInNewContext(js, {
      require: mockRequire, module, exports: module.exports, process: { env: { EXPO_PUBLIC_SUPABASE_URL: 'https://test.invalid', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'public-test-key' } },
      console: { log() {}, warn() {}, error() {} }, Date, Uint8Array, ArrayBuffer, Response, Blob, URL,
      setTimeout, clearTimeout, fetch: readImage,
    }, { filename });
    return module.exports;
  }
  return { load, calls, stored, get clientOptions() { return clientOptions; }, failUpload: () => { uploadError = { message: 'denied' }; } };
}
const service = h => h.load('src/services/supabase.ts');
const op = (call, name) => call.ops?.find(entry => entry[0] === name);
const item = (overrides = {}) => ({ id: '1', title: 'Inspect filter', description: '', status: 'Completed', ...overrides });
const report = (overrides = {}) => ({ id: 'MR-1', status: 'In Progress', updated: '2026-09-30T00:00:00Z', tasks: [{ id: '1', status: 'Completed' }], timeline: [{ title: 'Existing history' }], ...overrides });

test('native image uploads infer missing MIME metadata from bytes, including extensionless content URIs', async () => {
  const images = [
    ['image/jpeg', 'jpg', [255, 216, 255, 224]],
    ['image/png', 'png', [137, 80, 78, 71, 13, 10, 26, 10]],
    ['image/gif', 'gif', [71, 73, 70, 56, 57, 97]],
    ['image/webp', 'webp', [82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]],
  ];
  for (const [mime, extension, bytes] of images) {
    for (const type of ['', 'application/octet-stream']) {
      for (const uri of ['content://media/42', 'file:///cache/photo']) {
        const h = harness(undefined, {}, async () => new Response(new Blob([Uint8Array.from(bytes)], { type })));
        await service(h).uploadImageToSupabase(uri);
        const upload = h.calls.find(call => call.upload).upload;
        assert.equal(upload.options.contentType, mime);
        assert.ok(upload.file.endsWith('.' + extension));
        assert.deepEqual(Array.from(new Uint8Array(upload.bytes)), bytes);
      }
    }
  }
});

test('image MIME fallback rejects empty, non-image and conflicting content before storage writes', async () => {
  for (const [bytes, type] of [
    [[], ''],
    [[60, 115, 118, 103, 62], 'application/octet-stream'],
    [[137, 80, 78, 71, 13, 10, 26, 10], 'image/jpeg'],
    [[60, 115, 118, 103, 62], 'image/svg+xml'],
  ]) {
    const h = harness(undefined, {}, async () => new Response(new Blob([Uint8Array.from(bytes)], { type })));
    await assert.rejects(service(h).uploadImageToSupabase('file:///cache/photo.jpg'));
    assert.ok(!h.calls.some(call => call.upload));
  }
});

test('native session storage works without window.localStorage', async () => {
  const h = harness(); service(h);
  assert.equal(h.clientOptions.auth.persistSession, true);
  await h.clientOptions.auth.storage.setItem('token', 'sample');
  assert.equal(await h.clientOptions.auth.storage.getItem('token'), 'sample');
});
test('unconfigured admin password cannot be claimed at login', async () => {
  const h = harness(q => ({ data: q.table === 'administrators' ? [{ id: 'admin', email: 'a@example.com', password: null }] : [], error: null }));
  assert.equal((await service(h).authenticateUser('a@example.com', 'anything')).success, false);
  assert.equal(h.calls.some(q => op(q, 'update')), false);
  assert.equal(h.stored.size, 0);
});
test('cached plaintext password cannot authenticate an account without a database credential', async () => {
  const h = harness(q => ({ data: q.table === 'staff' ? [{ id: 's1', password: null }] : [], error: null }), { ecotrack_staff_pwd_s1: 'password' });
  assert.equal((await service(h).authenticateUser('staff', 'password')).success, false);
});

test('passwordless and invalid registrations never reach the database', async () => {
  const h = harness();
  assert.equal((await service(h).registerStaffMember('', '123', 'invalid', '')).success, false);
  assert.equal(h.calls.length, 0);
});

test('public profile attributes and arbitrary IDs cannot authorize password reset', async () => {
  const h = harness(), s = service(h);
  assert.equal((await s.verifyUserForPasswordReset('Admin', '1234567')).success, false);
  assert.equal((await s.resetUserPassword('a1', 'admin', 'newpassword')).success, false);
  assert.ok(!h.calls.some(q => op(q, 'update')));
});

test('logout clears the local session despite a failed presence update', async () => {
  const h = harness(() => { throw Error('offline'); }, { ecotrack_session_user: JSON.stringify({ id: 's1', userType: 'staff' }), ecotrack_staff_pwd_s1: 'old' });
  await service(h).clearSession('s1');
  assert.equal(h.stored.size, 0);
  assert.ok(h.calls.some(q => q.signOut));
});
test('deleted administrator cannot restore a cached session', async () => {
  const h = harness(() => ({ data: null, error: null }), { ecotrack_session_user: JSON.stringify({ id: 'a1', userType: 'admin' }) });
  assert.equal(await service(h).getSavedSession(), null);
  assert.equal(h.stored.has('ecotrack_session_user'), false);
});
test('assignment lookup never clears database assignments when related tables fail', async () => {
  const h = harness(q => q.table === 'staff' ? { data: [{ id: 's1', room_id: 'r1', assignment: 'Assigned' }], error: null } : { data: null, error: { message: 'offline' } });
  await service(h).resolveWorkerAssignment('s1');
  assert.equal(h.calls.some(q => op(q, 'update')), false);
});
test('blank assignment identifier cannot read a random staff account', async () => {
  const h = harness(); await service(h).resolveWorkerAssignment('');
  assert.equal(h.calls.length, 0);
});
test('profile failures discard unverified cache and never write profile data', async () => {
  const original = JSON.stringify({ id: 's1', name: 'Old', userType: 'staff' });
  const h = harness(() => ({ data: null, error: { message: 'denied' } }), { ecotrack_session_user: original });
  assert.equal(await service(h).updateStaffProfile('s1', 'New', '09123456789'), false);
  assert.equal(h.stored.has('ecotrack_session_user'), false);
  assert.equal(h.calls.some(q => q.rpc === 'ecotrack_update_profile' || op(q, 'update')), false);
});

test('image storage failure rejects instead of persisting a device-only URI', async () => {
  const h = harness(); h.failUpload();
  await assert.rejects(service(h).uploadImageToSupabase('data:image/png;base64,iVBORw0KGgo='), /upload failed/);
});
test('uploaded PNG keeps its MIME type and extension', async () => {
  const h = harness(); const url = await service(h).uploadImageToSupabase('data:image/png;base64,iVBORw0KGgo=');
  assert.match(url, /\.png\?token=/);
  assert.equal(h.calls.find(q => q.upload).upload.options.contentType, 'image/png');
  assert.equal(h.calls.find(q => q.upload).upload.options.upsert, false);
});
test('SVG and invalid buckets are rejected before upload', async () => {
  const h = harness(), s = service(h);
  await assert.rejects(s.uploadImageToSupabase('data:image/svg+xml;base64,PHN2Zz4='));
  await assert.rejects(s.uploadImageToSupabase('data:image/png;base64,aA==', '../private'));
  assert.equal(h.calls.length, 0);
});
test('checklists reject duplicate IDs, local photos and incomplete defect notes', () => {
  const s = service(harness());
  assert.ok(s.validateLiveMaintenanceItems([item(), item()]));
  assert.ok(s.validateLiveMaintenanceItems([item({ photoUri: 'file:///phone/image.jpg' })]));
  assert.ok(s.validateLiveMaintenanceItems([item({ status: 'Needs Repair' })]));
  assert.equal(s.validateLiveMaintenanceItems([item()]), null);
});
test('failed report updates never insert/upsert replacement records', async () => {
  const h = harness(q => op(q, 'update') ? { data: null, error: { message: 'denied' } } : { data: report(), error: null });
  assert.equal((await service(h).updateLiveMaintenanceReport('MR-1', { status: 'In Progress', items: [item()] })).success, false);
  assert.equal(h.calls.some(q => op(q, 'upsert') || op(q, 'insert')), false);
});

test('workers cannot self-approve or submit incomplete checklists', async () => {
  const h = harness(() => ({ data: report(), error: null })), s = service(h);
  assert.equal((await s.updateLiveMaintenanceReport('MR-1', { status: 'Completed', items: [item()] })).success, false);
  assert.equal((await s.updateLiveMaintenanceReport('MR-1', { status: 'For Verification', items: [item({ status: 'Not Started' })] })).success, false);
  assert.equal(h.calls.some(q => op(q, 'update')), false);
});
test('incomplete repairs cannot auto-complete their tasks on submit', async () => {
  const h = harness(() => ({ data: report({ tasks: [{ id: '1', status: 'Not Started' }] }), error: null }));
  assert.equal((await service(h).submitRepairAndSyncParent('REP-1')).success, false);
  assert.equal(h.calls.some(q => op(q, 'update')), false);
});
test('filter syntax is quoted for names containing punctuation', () => {
  const h = harness(); const { exactMatchFilter } = h.load('src/services/query-utils.ts');
  assert.equal(exactMatchFilter(['name'], 'Doe, Jane'), 'name.eq."Doe, Jane"');
  assert.equal(exactMatchFilter(['name'], 'x"),id.gt.0'), 'name.eq."x\\"),id.gt.0"');
});


test('AC save failure never creates a locally successful controller', async () => {
  const h = harness(() => ({ data: null, error: { message: 'denied' } }));
  await assert.rejects(h.load('src/services/ac-controller-service.ts').AcControllerService.saveAircon({ brand: 'Daikin', nodeId: 'node-1' }));
  assert.equal(h.stored.has('@ecotrack_aircons'), false);
});

test('BLE provisioning cannot report success without a BLE transport', async () => {
  const h = harness(); const result = await h.load('src/services/device-service.ts').BleDeviceService.configureWifi('node1', 'wifi', 'password');
  assert.equal(result.success, false);
  assert.equal(h.calls.length, 0);
});
test('historical approval cannot reapprove a reopened maintenance report', async () => {
  const h = harness(q => ({ data: q.table === 'maintenance_reports' ? [report({ timeline: [{ title: 'Verified and approved by admin' }] })] : [], error: null }));
  const reports = await service(h).fetchLiveMaintenanceReports();
  assert.equal(reports[0].isVerified, false);
  assert.equal(reports[0].status, 'For Verification');
});
test('zero-row notification mutations return failure', async () => {
  const h = harness(() => ({ data: null, error: null })), s = h.load('src/services/mobile-notifications.ts');
  assert.equal(await s.markMobileNotificationAsRead('missing'), false);
  assert.equal(await s.deleteMobileNotification('missing'), false);
  assert.equal(await s.snoozeMobileNotification('missing', 15), false);
  assert.equal(await s.unsnoozeMobileNotification('missing'), false);
});
test('malformed base64 image never reaches storage', async () => {
  const h = harness();
  await assert.rejects(service(h).uploadImageToSupabase('data:image/png;base64,a==='));
  assert.equal(h.calls.length, 0);
});


test('scoped parent report retains pending verification when its child is hidden by RLS', async () => {
 const h=harness(q=>({data:q.table==='maintenance_reports'?[report({status:'For Verification',tasks:[{id:'1',status:'For Verification',linkedRepairId:'REP-HIDDEN'}]})]:[],error:null}));
 const rows=await service(h).fetchLiveMaintenanceReports('Alice');
 assert.equal(rows.length,1);assert.equal(rows[0].items[0].status,'For Verification');assert.equal(rows[0].status,'For Verification');assert.equal(rows[0].isVerified,false);
});
test('a stale parent checklist uses only its exact visible approved repair and retains unavailable links', async () => {
 const h=harness(q=>({data:q.table==='maintenance_reports'?[
  report({id:'MR-parent',status:'UnderRepair',tasks:[
   {id:'1',status:'UnderRepair',linkedRepairId:'REP-4106',repaired:false},
   {id:'2',status:'UnderRepair',linkedRepairId:'REP-2879',repaired:false}]}),
  report({id:'REP-4106',type:'Corrective Repair',status:'Completed',parent_report_id:'MR-parent'})
 ]:[],error:null}));
 const rows=await service(h).fetchLiveMaintenanceReports();
 const parent=rows.find(row=>row.id==='MR-parent');
 assert.equal(parent.items[0].status,'Completed');assert.equal(parent.items[0].repaired,true);assert.equal(parent.items[0].verified,true);
 assert.equal(parent.items[1].status,'Under Repair');assert.equal(parent.items[1].repaired,false);assert.equal(parent.items[1].linkedRepairId,'REP-2879');
 assert.equal(parent.status,'Under Repair');assert.equal(parent.isVerified,false);
});
test('pagination follows server-shortened pages until no rows remain',async()=>{
 const h=harness(q=>({data:(op(q,'gt')?[{id:'b'}]:[{id:'a'}]).filter(row=>!op(q,'gt')||row.id>op(q,'gt')[2]),error:null}));
 const rows=await h.load('src/services/query-utils.ts').fetchAccessibleRows(service(h).supabase,'rooms');
 assert.equal(rows.error,null);assert.deepEqual(Array.from(rows.data,x=>x.id),['a','b']);assert.equal(h.calls.length,3);
});
test('foreign storage URLs and spoofed image content are rejected',async()=>{
 const h=harness();const images=h.load('src/services/private-images.ts');
 assert.throws(()=>images.imageReference('https://foreign.invalid/storage/v1/object/public/avatars/me.png','https://test.invalid'));
 assert.throws(()=>images.imageReference('storage://avatars/me/../other.png','https://test.invalid'));
 await assert.rejects(service(h).uploadImageToSupabase('data:image/png;base64,aGVsbG8='),/content does not match/);
 assert.equal(h.calls.some(q=>q.upload),false);
});
