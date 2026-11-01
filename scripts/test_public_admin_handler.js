'use strict';
// Disposable HTTP/database/Auth fixtures; this suite cannot create real accounts.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const handlerModule = import(pathToFileURL(path.join(__dirname, '../supabase/functions/provision-admin/handler.mjs')).href);
const authId = '11111111-1111-4111-8111-111111111111';
const profile = { username: '  New Administrator  ', email: '  NEW@EXAMPLE.INVALID  ', password: 'FixturePassword#2026' };
async function fixture(options = {}) {
  const { createRegistrationHandler } = await handlerModule;
  const calls = [];
  const admin = {
    async rpc(name, data) { calls.push(['rpc', name, data]); assert.equal(name, 'ecotrack_auth_attempt'); return { data: options.limited !== true, error: options.rateError || null }; },
    from(table) {
      assert.equal(table, 'administrators');
      return {
        async insert(record) { calls.push(['insert', record]); return { error: options.insertError || null }; },
        delete() { calls.push(['delete']); return { eq(column, id) { calls.push(['eq', column, id]); return { async is(column, value) { calls.push(['is', column, value]); return { error: null }; } }; } }; }
      };
    },
    auth: { admin: { async createUser(value) { calls.push(['createUser', value]); if (options.transportFailure) throw Error('Fixture transport failed'); return options.creation || { data: { user: { id: authId } }, error: null }; } } }
  };
  const handler = createRegistrationHandler({
    env: { get: name => options.unconfigured ? undefined : ({ SUPABASE_URL: 'https://isolated.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture-server-only' })[name] },
    createClient(url, key, config) { calls.push(['client', url, key, config]); return admin; }
  });
  const send = (body = { profile }, method = 'POST') => handler(new Request('https://isolated.invalid/register', { method, ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) }));
  return { calls, send };
}
test('public signup succeeds without Authorization or an existing administrator session', async () => {
  const value = await fixture(); const response = await value.send(); const result = await response.json();
  assert.equal(response.status, 200); assert.match(result.adminId, /^admin_[0-9a-f]{32}$/); assert.equal(result.authUserId, authId);
  assert(!('access_token' in result)); assert.equal(value.calls.filter(call => call[0] === 'createUser').length, 1);
});
test('normalization and trusted server metadata prevent injected IDs, roles and sessions', async () => {
  const value = await fixture(); const response = await value.send({ profile: { ...profile, id: 'existing', role: 'owner', authUserId: 'existing' }, approvalSession: { access_token: 'untrusted' } });
  const result = await response.json(); const record = value.calls.find(call => call[0] === 'insert')[1]; const user = value.calls.find(call => call[0] === 'createUser')[1];
  assert.equal(response.status, 200); assert.equal(record.username, 'New Administrator'); assert.equal(record.email, 'new@example.invalid'); assert.equal(record.role, 'admin');
  assert.equal(record.id, result.adminId); assert.equal(record.auth_user_id, undefined);
  assert.deepEqual(user, { email: 'new@example.invalid', password: profile.password, email_confirm: true, app_metadata: { ecotrack_profile_id: result.adminId, ecotrack_account_type: 'admin' } });
  assert.equal(value.calls.find(call => call[0] === 'client')[3].auth.persistSession, false);
});
test('invalid and oversized input is rejected before account access', async () => {
  for (const body of ['bad json', '{}', 'null', 'x'.repeat(4097), { profile: { ...profile, username: 'a' } }, { profile: { ...profile, email: 'invalid' } }, { profile: { ...profile, password: 'short' } }]) {
    const value = await fixture(); assert.equal((await value.send(body)).status, 400); assert.equal(value.calls.length, 0);
  }
});
test('preflight and unsupported methods do not access credentials or accounts', async () => {
  const value = await fixture(); const preflight = await value.send(undefined, 'OPTIONS'); assert.equal(preflight.status, 200); assert.match(preflight.headers.get('access-control-allow-methods'), /POST/);
  assert.equal((await value.send(undefined, 'GET')).status, 405); assert.equal(value.calls.length, 0);
});
test('rate limits hash identifiers and stop before creating accounts', async () => {
  const limited = await fixture({ limited: true }); const response = await limited.send(); assert.equal(response.status, 429); assert.equal(response.headers.get('retry-after'), '900'); assert.equal(limited.calls.filter(call => call[0] === 'insert' || call[0] === 'createUser').length, 0);
  const value = await fixture(); await value.send(); const keys = value.calls.filter(call => call[0] === 'rpc').map(call => call[2].p_key); assert.equal(keys.length, 2); for (const key of keys) assert.match(key, /^[a-f0-9]{64}$/); assert.notEqual(keys[0], keys[1]);
});
test('unavailable rate limiting fails without creating accounts', async () => {
  const value = await fixture({ rateError: { message: 'Fixture unavailable' } }); assert.equal((await value.send()).status, 503); assert.equal(value.calls.filter(call => call[0] === 'insert' || call[0] === 'createUser').length, 0);
});
test('duplicate profiles fail without provisioning another Auth user', async () => {
  const value = await fixture({ insertError: { code: '23505' } }); assert.equal((await value.send()).status, 409); assert.equal(value.calls.filter(call => call[0] === 'createUser').length, 0);
});
test('definite Auth rejection removes only this unlinked new profile', async () => {
  const value = await fixture({ creation: { data: { user: null }, error: { status: 422 } } }); assert.equal((await value.send()).status, 409);
  const insertedId = value.calls.find(call => call[0] === 'insert')[1].id; assert.deepEqual(value.calls.find(call => call[0] === 'eq'), ['eq', 'id', insertedId]); assert.deepEqual(value.calls.find(call => call[0] === 'is'), ['is', 'auth_user_id', null]);
});
test('uncertain Auth transport does not delete a potentially committed profile or claim success', async () => {
  const value = await fixture({ transportFailure: true }); const response = await value.send(); assert.equal(response.status, 503); assert.match((await response.json()).error, /could not be confirmed/i); assert.equal(value.calls.filter(call => call[0] === 'delete').length, 0);
});
test('missing server configuration never returns a false receipt', async () => {
  const value = await fixture({ unconfigured: true }); assert.equal((await value.send()).status, 503); assert.equal(value.calls.length, 0);
});
test('installed Supabase SDK uses only the intended service RPC, profile insert and Auth creation contracts', async () => {
  const { createRegistrationHandler } = await handlerModule;
  const { createClient } = require('@supabase/supabase-js');
  const requests = [];
  const handler = createRegistrationHandler({
    env: { get: name => ({ SUPABASE_URL: 'https://sdk-registration-fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'server-fixture-key' })[name] },
    createClient: (url, key, options) => createClient(url, key, { ...options, global: { fetch: async (input, init) => {
      const target = new URL(String(input)); assert.equal(target.origin, 'https://sdk-registration-fixture.invalid');
      const body = JSON.parse(init.body); requests.push({ path: target.pathname, method: init.method, body });
      assert.equal(new Headers(init.headers).get('authorization'), 'Bearer server-fixture-key');
      if (target.pathname === '/rest/v1/rpc/ecotrack_auth_attempt') return new Response('true', { headers: { 'Content-Type': 'application/json' } });
      if (target.pathname === '/rest/v1/administrators' && init.method === 'POST') return new Response(null, { status: 201 });
      if (target.pathname === '/auth/v1/admin/users') return new Response(JSON.stringify({ id: authId, email: 'new@example.invalid' }), { headers: { 'Content-Type': 'application/json' } });
      assert.fail('Unexpected SDK request: ' + target.pathname);
    } } })
  });
  const response = await handler(new Request('https://function-fixture.invalid', { method: 'POST', body: JSON.stringify({ profile }) }));
  assert.equal(response.status, 200); const result = await response.json(); assert.equal(result.authUserId, authId);
  assert.equal(requests.length, 4); assert.equal(requests.filter(call => call.path === '/rest/v1/rpc/ecotrack_auth_attempt').length, 2);
  const inserted = requests.find(call => call.path === '/rest/v1/administrators').body;
  const created = requests.find(call => call.path === '/auth/v1/admin/users').body;
  assert.equal(created.app_metadata.ecotrack_profile_id, inserted.id); assert.equal(inserted.id, result.adminId); assert.equal(created.password, profile.password);
});
