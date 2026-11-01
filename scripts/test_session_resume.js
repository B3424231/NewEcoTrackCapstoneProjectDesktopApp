'use strict';

// Isolated Auth, IPC and DOM fixtures. No live credentials, accounts or network.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(process.env.ECOTRACK_SESSION_ROOT || path.join(__dirname, '..'));
const loginSource = fs.readFileSync(path.join(root, 'public/js/login.js'), 'utf8');
const sidebarSource = fs.readFileSync(path.join(root, 'public/js/sidebar.js'), 'utf8');
const identity = { id: 'fixture-auth-admin', email: 'admin@example.invalid', user_metadata: {} };
const session = { access_token: 'fixture-only-access', refresh_token: 'fixture-only-refresh', user: identity };
const profile = { id: 'admin-fixture', authUserId: identity.id, userType: 'admin', name: 'Fixture Administrator', email: identity.email, role: 'Administrator' };
const event = { preventDefault() {}, stopPropagation() {} };

function element() {
  const handlers = new Map(), attributes = new Map();
  return {
    value: '', innerHTML: 'Sign in', textContent: '', disabled: false, style: {}, checked: false,
    classList: { add() {}, remove() {} },
    addEventListener: (name, handler) => handlers.set(name, handler),
    emit: name => handlers.get(name)?.(event),
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: name => attributes.delete(name),
    appendChild(child) { this.textContent = child.textContent; }, focus() {}
  };
}

function harness(options = {}) {
  const values = new Map(Object.entries(options.storage || {})), calls = [], readyHandlers = [];
  const deadlineTimers = new Map();
  const loginButton = element(), loginForm = element(), email = element(), password = element(), alert = element();
  loginForm.querySelector = () => loginButton;
  email.value = identity.email; password.value = 'fixture-password';
  const nodes = { 'login-form': loginForm, 'email': email, 'password': password, 'auth-alert': alert };
  for (const id of ['logoutButton', 'logoutModal', 'logoutCancel', 'logoutConfirm']) nodes[id] = element();
  const localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
  const location = { search: options.search ?? '?resume=1', href: 'login.html', replace(url) { calls.push(['redirect', url]); this.href = url; } };
  const client = {
    auth: {
      async getSession() { calls.push(['session']); await options.sessionGate; return { data: { session: options.session === undefined ? session : options.session }, error: options.sessionError }; },
      async getUser() { calls.push(['identity']); return { data: { user: options.user === undefined ? identity : options.user }, error: options.userError }; },
      async signInWithPassword(payload) { calls.push(['password', payload]); return { data: { session, user: identity }, error: null }; },
      async signOut() { calls.push(['signOut']); if (options.signOutError) throw options.signOutError; return { error: null }; }
    },
    async rpc(name) { calls.push(['profile', name]); await options.profileGate; return { data: { ...profile, ...options.profile }, error: options.profileError }; }
  };
  const context = vm.createContext({
    document: {
      getElementById: id => nodes[id] || null, querySelectorAll: () => [], createElement: element,
      addEventListener: (name, handler) => { if (name === 'DOMContentLoaded') readyHandlers.push(handler); }
    },
    localStorage, location, URLSearchParams, navigator: { userAgent: 'Windows Chrome' }, console: { log() {}, warn() {}, error() {} },
    sessionStorage: { clear() { calls.push(['clearSessionStorage']); } },
    fetch: async () => { calls.push(['snapshot', localStorage.getItem('ecoTrack_require_login')]); return {}; },
    setTimeout(fn, delay) { if (delay === 15000) { deadlineTimers.set(1, fn); return 1; } fn(); },
    clearTimeout: id => deadlineTimers.delete(id),
    electron: { async invoke(channel, value) { calls.push(['ipc', channel, value]); return options.ipcResult || { success: true }; } },
    supabaseClient: client, ecotrackAuthReady: options.authReady || Promise.resolve(),
    EcoTrackMode: { home: () => options.home || 'dashboard.html' }
  });
  context.window = context;
  vm.runInContext(loginSource, context);
  return {
    context, values, calls, location, loginButton, alert, client,
    ready: readyHandlers[0](),
    expireRestore: () => deadlineTimers.get(1)?.(),
    submit: () => loginForm.emit('submit'),
    async logout() { vm.runInContext(sidebarSource, context); context.initializeLogout(); await nodes.logoutConfirm.emit('click'); }
  };
}

test('desktop launch requests restoration of a persisted session', () => {
  const source = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
  const declaration = source.match(/const startUrl = [^\n]+/)[0];
  const startUrl = vm.runInNewContext(declaration + '\nstartUrl', { path, __dirname: path.join(root, 'src') });
  assert.equal(new URL(startUrl).searchParams.get('resume'), '1');
});

test('reopening validates the saved identity and profile, mirrors the session, and enters the selected workspace', async () => {
  const previous = { ...profile, created: '2025-01-01T00:00:00Z', last_login: '2026-10-21T01:00:00Z', location: 'Existing location' };
  const history = JSON.stringify([{ id: 'existing-history' }]);
  const app = harness({ home: 'analytics.html', storage: { ecoTrack_profile_user: JSON.stringify(previous), ecoTrack_loginHistory: history } });
  await app.ready;
  assert.equal(app.location.href, 'analytics.html');
  assert.deepEqual(app.calls.map(call => call[0]), ['session', 'identity', 'profile', 'ipc', 'redirect']);
  assert.equal(app.values.get('ecoTrack_refresh_token'), session.refresh_token);
  assert.equal(app.values.get('ecoTrack_auth_token'), session.access_token);
  const saved = JSON.parse(app.values.get('ecoTrack_profile_user'));
  assert.equal(saved.id, profile.id); assert.equal(saved.created, previous.created);
  assert.equal(saved.last_login, previous.last_login); assert.equal(saved.location, previous.location);
  assert.equal(app.values.get('ecoTrack_loginHistory'), history, 'Reopening is not a new password sign-in');
  assert.equal(app.loginButton.disabled, false);
});

test('startup waits for session initialization and blocks duplicate password submissions', async () => {
  let release; const authReady = new Promise(resolve => { release = resolve; });
  const app = harness({ authReady });
  assert.equal(app.loginButton.disabled, true); assert.equal(app.calls.length, 0);
  await app.submit(); assert.equal(app.calls.length, 0);
  release(); await app.ready;
  assert.equal(app.location.href, 'dashboard.html');
});

test('no saved session and revoked sessions stay at the editable login form', async () => {
  for (const options of [{ session: null }, { sessionError: { message: 'Refresh token revoked' } }, { user: null }, { userError: { message: 'Invalid JWT' } }]) {
    const app = harness(options); await app.ready;
    assert.equal(app.location.href, 'login.html'); assert.equal(app.loginButton.disabled, false);
    assert.equal(app.calls.some(call => call[0] === 'password' || call[0] === 'redirect'), false);
  }
});

test('saved staff, inactive, archived and mismatched administrator profiles cannot enter the desktop', async () => {
  for (const changes of [{ userType: 'staff' }, { is_active: false }, { isActive: false }, { is_archived: true }, { isArchived: true }, { authUserId: 'other-auth-user' }]) {
    const app = harness({ profile: changes }); await app.ready;
    assert.equal(app.location.href, 'login.html'); assert.equal(app.values.has('ecoTrack_auth_token'), false);
    assert.equal(app.calls.some(call => call[0] === 'redirect'), false);
  }
  const mismatch = harness({ user: { ...identity, id: 'other-auth-user' } }); await mismatch.ready;
  assert.equal(mismatch.location.href, 'login.html');
});

test('temporary network errors preserve the session for a later retry and IPC rejection cannot open the dashboard', async () => {
  for (const options of [{ userError: { message: 'Network unavailable' } }, { profileError: { message: 'Network unavailable' } }, { ipcResult: { success: false, error: 'Session rejected' } }]) {
    const app = harness({ ...options, storage: { ecoTrack_refresh_token: session.refresh_token } }); await app.ready;
    assert.equal(app.location.href, 'login.html'); assert.equal(app.loginButton.disabled, false);
    assert.equal(app.values.get('ecoTrack_refresh_token'), session.refresh_token);
    assert.equal(app.calls.some(call => call[0] === 'signOut'), false);
  }
});

test('ordinary login and recovery/registration visits do not auto-redirect an existing session', async () => {
  for (const search of ['', '?timeout=true', '?resume=1&timeout=true']) {
    const app = harness({ search }); await app.ready;
    assert.equal(app.calls.length, 0); assert.equal(app.location.href, 'login.html');
  }
});

test('explicit logout and inactivity timeout block auto-login across launches', async () => {
  for (const reason of ['logout', 'timeout']) {
    const app = harness({ storage: { ecoTrack_require_login: reason } }); await app.ready;
    assert.equal(app.calls.length, 0); assert.equal(app.location.href, 'login.html');
  }
});

test('logout blocks restoration before network work and clears both token copies even if signOut fails', async () => {
  const app = harness({ search: '', signOutError: new Error('Offline'), storage: {
    userToken: session.access_token, ecoTrack_auth_token: session.access_token,
    ecoTrack_refresh_token: session.refresh_token, ecoTrack_profile_user: JSON.stringify(profile),
    'ecoTrack_avatar:admin-fixture': 'fixture-photo'
  } });
  await app.ready; await app.logout();
  assert.equal(app.values.get('ecoTrack_require_login'), 'logout');
  assert.equal(app.calls.find(call => call[0] === 'snapshot')[1], 'logout');
  for (const key of ['userToken', 'ecoTrack_auth_token', 'ecoTrack_refresh_token', 'ecoTrack_profile_user']) assert.equal(app.values.has(key), false);
  assert.equal(app.values.get('ecoTrack_avatar:admin-fixture'), 'fixture-photo');
  const reopen = harness({ storage: Object.fromEntries(app.values) }); await reopen.ready;
  assert.equal(reopen.location.href, 'login.html'); assert.equal(reopen.calls.length, 0);
});

test('a successful manual sign-in permits restoration again without saving the password', async () => {
  const app = harness({ storage: { ecoTrack_require_login: 'timeout' } }); await app.ready; await app.submit();
  assert.equal(app.values.has('ecoTrack_require_login'), false);
  assert.equal(app.location.href, 'dashboard.html');
  assert.equal(JSON.stringify(Object.fromEntries(app.values)).includes('fixture-password'), false);
  const reopen = harness({ storage: Object.fromEntries(app.values) }); await reopen.ready;
  assert.equal(reopen.location.href, 'dashboard.html');
});

test('logout during verification prevents a late automatic redirect', async () => {
  let release; const profileGate = new Promise(resolve => { release = resolve; });
  const app = harness({ profileGate });
  await Promise.resolve(); app.values.set('ecoTrack_require_login', 'logout');
  release(); await app.ready;
  assert.equal(app.location.href, 'login.html'); assert.equal(app.values.has('ecoTrack_auth_token'), false);
});

test('a hung restore reaches its deadline, re-enables login and ignores late verification', async () => {
  let release; const profileGate = new Promise(resolve => { release = resolve; });
  const app = harness({ profileGate });
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(app.loginButton.disabled, true);
  app.expireRestore();
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(app.loginButton.disabled, false);
  assert.equal(app.location.href, 'login.html');
  release(); await app.ready;
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(app.location.href, 'login.html');
  assert.equal(app.values.has('ecoTrack_auth_token'), false);
  assert.equal(app.calls.some(call => call[0] === 'ipc' || call[0] === 'redirect'), false);
});
