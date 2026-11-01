'use strict';
// Installed Supabase SDK and the production recovery service, with an in-memory
// HTTP transport. No real request, email, database or account mutation is allowed.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createClient } = require('@supabase/supabase-js');
const { createService } = require('../public/js/password-recovery');

test('installed SDK recovery REST flow stays isolated and sends the expected authenticated requests', async () => {
  const origin = 'https://recovery-sdk-fixture.invalid';
  const email = 'admin@example.invalid';
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const user = { id, email, aud: 'authenticated', role: 'authenticated', user_metadata: {}, app_metadata: {}, identities: [] };
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: id, email, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.fixture-signature`;
  const calls = [], clients = [], events = [];
  let confirmSignedOut;
  const signedOut = new Promise(resolve => { confirmSignedOut = resolve; });
  const response = (body, status = 200) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  async function fixtureFetch(input, init = {}) {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    assert.equal(url.origin, origin, 'All SDK traffic must remain on the disposable fixture origin');
    const method = init.method || input.method || 'GET';
    const headers = new Headers(init.headers || input.headers);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path: url.pathname, query: url.search, method, body, authorization: headers.get('authorization') });
    if (url.pathname === '/auth/v1/recover' && method === 'POST') return response({});
    if (url.pathname === '/auth/v1/verify' && method === 'POST') return response({ access_token: token, refresh_token: 'fixture-refresh', token_type: 'bearer', expires_in: 3600, user });
    if (url.pathname === '/auth/v1/user' && method === 'GET') return response(user);
    if (url.pathname === '/auth/v1/user' && method === 'PUT') return response(user);
    if (url.pathname === '/rest/v1/rpc/ecotrack_is_admin' && method === 'POST') return response(true);
    if (url.pathname === '/rest/v1/rpc/ecotrack_my_profile' && method === 'POST') return response({ id: 'admin_fixture', authUserId: id, userType: 'admin', email, is_active: true });
    if (url.pathname === '/auth/v1/logout' && method === 'POST') return response(undefined, 204);
    assert.fail(`Unexpected SDK fixture request: ${method} ${url.pathname}`);
  }
  const service = createService({ fetch: fixtureFetch, createClient: options => {
    assert.equal(options.auth.persistSession, false);
    assert.equal(options.auth.autoRefreshToken, false);
    assert.equal(options.auth.detectSessionInUrl, false);
    assert.equal(typeof options.global.fetch, 'function');
    const client = createClient(origin, 'sb_publishable_isolated_sdk_fixture', options);
    client.auth.onAuthStateChange(event => { events.push(event); if (event === 'SIGNED_OUT') confirmSignedOut(); });
    clients.push(client);
    return client;
  }});
  try {
    assert.equal((await service.request('  ADMIN@EXAMPLE.INVALID  ')).success, true);
    assert.equal((await service.verify(email, '345678')).success, true);
    assert.equal((await service.reset('FixtureNewPassword#2026', 'FixtureNewPassword#2026')).success, true);
    const recover = calls.find(call => call.path === '/auth/v1/recover');
    assert.equal(recover.body.email, email);
    const verification = calls.find(call => call.path === '/auth/v1/verify');
    assert.equal(verification.body.email, email);
    assert.equal(verification.body.token, '345678');
    assert.equal(verification.body.type, 'recovery');
    const updates = calls.filter(call => call.path === '/auth/v1/user' && call.method === 'PUT');
    assert.equal(updates.length, 1);
    assert.equal(updates[0].body.password, 'FixtureNewPassword#2026');
    for (const call of calls.filter(call => call.path.startsWith('/rest/v1/') || call.path === '/auth/v1/user')) {
      assert.equal(call.authorization, `Bearer ${token}`, 'Profile reads and password update use only the verified recovery session');
    }
    assert.equal(calls.filter(call => call.path === '/rest/v1/rpc/ecotrack_is_admin').length, 2);
    assert.equal(calls.filter(call => call.path === '/rest/v1/rpc/ecotrack_my_profile').length, 2);
    assert(calls.some(call => call.path === '/auth/v1/logout' && call.query === '?scope=local'));
    assert(events.includes('PASSWORD_RECOVERY'));
    // Confirmed password success need not wait for remote sign-out; observe its
    // completion separately rather than assuming that asynchronous work is done.
    let timer;
    try {
      await Promise.race([signedOut, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Fixture recovery session was not cleared')), 1000); })]);
    } finally { clearTimeout(timer); }
    assert.equal((await clients[0].auth.getSession()).data.session, null);
    assert(events.includes('SIGNED_OUT'));
    assert.equal((await service.reset('FixtureNewPassword#2026', 'FixtureNewPassword#2026')).success, false);
  } finally {
    await service.dispose();
  }
});
