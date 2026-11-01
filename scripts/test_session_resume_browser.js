'use strict';

// Real login controller and Supabase SDK, persisted between browser processes.
// All Auth/RPC/backend requests are fulfilled by isolated local fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
let playwright = process.env.ECOTRACK_PLAYWRIGHT;
if (!playwright) {
  try { playwright = require.resolve('playwright'); }
  catch (_) { playwright = path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'); }
}
const { chromium } = require(playwright);
const root = path.resolve(process.env.ECOTRACK_SESSION_ROOT || path.join(__dirname, '..'));
const stage = process.env.ECOTRACK_SESSION_STAGE;
const publicRoot = path.join(root, 'public');
const out = process.env.ECOTRACK_AUDIT_ARTIFACTS || path.resolve(process.env.ECOTRACK_SESSION_REPORT_DIR || path.join(root, 'reports/session-resume'));
const state = { passwordRequests: 0, refreshRequests: 0, userRequests: 0, active: true, revoked: false, logouts: 0 };
let profileGate = null;
const runtimeErrors = [], blockedRequests = [], checks = [];
const user = {
  id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated',
  email: 'fixture@example.invalid', app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {}, identities: [], created_at: '2026-01-01T00:00:00Z'
};
function fixtureSession(expiry = Math.floor(Date.now() / 1000) + 3600) {
  const encoded = data => Buffer.from(JSON.stringify(data)).toString('base64url');
  const access = encoded({ alg: 'HS256', typ: 'JWT' }) + '.' + encoded({ sub: user.id, aud: 'authenticated', role: 'authenticated', exp: expiry, iat: expiry - 3600 }) + '.fixture-signature';
  return { access_token: access, refresh_token: 'fixture-only-refresh', token_type: 'bearer', expires_in: 3600, expires_at: expiry, user };
}
let server, context, site, browserProfile;
const dashboard = `<!doctype html><html><body><h1>Fixture dashboard</h1>
<button id="logoutButton">Logout</button><div id="logoutModal" style="display:none"><button id="logoutCancel">Cancel</button><button id="logoutConfirm">Confirm logout</button></div>
<script src="/js/supabase.umd.js"></script><script src="/js/supabase-client.js"></script><script src="/js/shared.js"></script><script src="/js/sidebar.js"></script></body></html>`;

async function open({ clock = false } = {}) {
  context = await chromium.launchPersistentContext(browserProfile, {
    executablePath: process.env.ECOTRACK_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true, viewport: { width: 1460, height: 1000 }, timezoneId: 'Asia/Singapore'
  });
  await context.addInitScript(() => {
    localStorage.setItem('ecoTrack_supabase_url', 'https://isolated-session.invalid');
    localStorage.setItem('ecoTrack_supabase_anon_key', 'sb_publishable_isolated_fixture');
    window.electron = { env: {}, on() {}, invoke: async channel => {
      if (channel === 'auth-set-session') return { success: true };
      throw Error('Unexpected IPC in fixture: ' + channel);
    } };
  });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    const reply = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: status === 204 ? '' : JSON.stringify(body), headers: { 'access-control-allow-origin': '*' } });
    if (url.origin === 'https://isolated-session.invalid') {
      if (url.pathname === '/auth/v1/token') {
        if (url.searchParams.get('grant_type') === 'password') { state.passwordRequests++; state.revoked = false; return reply(fixtureSession()); }
        state.refreshRequests++;
        return state.revoked ? reply({ code: 'refresh_token_not_found', message: 'Fixture session revoked' }, 400) : reply(fixtureSession());
      }
      if (url.pathname === '/auth/v1/user') { state.userRequests++; return reply(user); }
      if (url.pathname === '/auth/v1/logout') { state.logouts++; state.revoked = true; return reply(null, 204); }
      if (url.pathname === '/rest/v1/rpc/ecotrack_my_profile') { await profileGate; return reply({
        id: 'admin-fixture', authUserId: user.id, name: 'Fixture administrator', email: user.email,
        userType: 'admin', role: 'Administrator', is_active: state.active, is_archived: false
      }); }
    }
    if (url.origin === site) return route.continue();
    if (url.hostname === 'cdn.tailwindcss.com') return route.fulfill({ path: path.join(publicRoot, 'vendor/tailwindcss.js'), contentType: 'text/javascript' });
    if (url.origin === 'http://127.0.0.1:5000' && url.pathname === '/api/analytics/snapshot') return reply({ success: true });
    blockedRequests.push(url.origin + url.pathname); return route.abort();
  });
  await context.routeWebSocket(/.*/, socket => socket.close());
  const page = context.pages()[0] || await context.newPage();
  page.on('pageerror', error => runtimeErrors.push(error.message));
  if(clock){await page.clock.install();await page.clock.pauseAt(new Date(Date.now()+1000));}
  await page.goto(site + '/login.html?resume=1',{waitUntil:'domcontentloaded'});
  return page;
}
async function signIn(page) {
  await page.locator('#email').fill(user.email);
  await page.locator('#password').fill('fixture-password-only');
  await page.locator('#login-form .submit-btn').click();
  await page.waitForURL('**/dashboard.html');
}
async function close() { await context.close(); context = null; }

(async () => {
  fs.mkdirSync(out, { recursive: true });
  // A distinct profile on every run, so reruns never inherit old fixture state.
  const run = fs.mkdtempSync(path.join(out, 'run-'));
  browserProfile = path.join(run, 'browser-profile');
  server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://fixture').pathname);
    if (pathname === '/dashboard.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(dashboard); }
    const relative = 'public' + pathname.replaceAll('/', path.sep);
    const prepared = stage ? path.resolve(stage, relative) : null;
    const filename = prepared && prepared.startsWith(path.resolve(stage) + path.sep) && fs.existsSync(prepared) ? prepared : path.resolve(publicRoot, '.' + pathname);
    if ((!filename.startsWith(publicRoot + path.sep) && !(stage && filename.startsWith(path.resolve(stage) + path.sep))) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' })[path.extname(filename)] || 'application/octet-stream' });
    fs.createReadStream(filename).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  site = 'http://127.0.0.1:' + server.address().port;

  let page = await open();
  await page.waitForFunction(() => !document.querySelector('#login-form .submit-btn').disabled);
  assert(page.url().includes('/login.html?resume=1'));
  assert(await page.locator('#sessionStartupLoader').isHidden());
  assert(await page.locator('#login-form').isVisible());
  await signIn(page); assert.equal(state.passwordRequests, 1);
  const history = await page.evaluate(() => localStorage.getItem('ecoTrack_loginHistory'));
  await close();

  state.active = false;
  let releaseProfile;
  profileGate = new Promise(resolve => { releaseProfile = resolve; });
  page = await open({ clock: true });
  await page.locator('#sessionStartupLoader').waitFor({ state: 'visible' });
  assert(await page.locator('#login-form').isHidden());
  await page.waitForTimeout(1700);
  assert(await page.locator('#sessionStartupLoader').isVisible());
  assert(await page.locator('#login-form').isHidden());
  await page.screenshot({ path: path.join(out, 'restoring-session.png') });
  checks.push('Startup shows a loading screen instead of flashing Login while saved-session verification is pending');
  await page.clock.fastForward(15001);
  await page.locator('#auth-alert').filter({ hasText: 'saved session could not be restored' }).waitFor();
  assert(page.url().includes('login.html'));
  assert(await page.locator('#sessionStartupLoader').isHidden());
  assert(await page.locator('#login-form').isVisible());
  profileGate = null; releaseProfile();
  checks.push('A hung verification returns to an editable login form at its deadline and late results cannot reopen the dashboard');
  await page.reload();
  await page.locator('#auth-alert').filter({ hasText: 'saved session could not be restored' }).waitFor();
  checks.push('Reopening verifies current administrator status and refuses a disabled account');
  state.active = true;
  await page.reload(); await page.waitForURL('**/dashboard.html');
  assert.equal(state.passwordRequests, 1);
  assert.equal(await page.evaluate(() => localStorage.getItem('ecoTrack_loginHistory')), history);
  checks.push('Closing the browser process without logout preserves login and reopens the dashboard without a password request');
  await page.goto(site + '/login.html');
  await page.locator('#show-register-btn').click(); assert(await page.locator('#register-form').isVisible());
  await page.locator('#show-login-btn').click(); assert(await page.locator('#forgot-password-btn').isVisible());
  checks.push('Direct login visits keep registration and password recovery accessible with an existing session');

  const expired = fixtureSession(Math.floor(Date.now() / 1000) - 3600);
  await page.evaluate(expired => {
    const key = Object.keys(localStorage).find(key => key.startsWith('sb-') && key.endsWith('-auth-token'));
    if (!key) throw Error('SDK did not persist a session');
    localStorage.setItem(key, JSON.stringify(expired));
  }, expired);
  await close();
  page = await open(); await page.waitForURL('**/dashboard.html');
  assert(state.refreshRequests > 0); assert.equal(state.passwordRequests, 1);
  checks.push('Expired access token refreshes through the real SDK on reopen without saving or resubmitting a password');

  await page.evaluate(() => localStorage.setItem('ecoTrack_require_login', 'timeout'));
  await close(); page = await open();
  await page.waitForFunction(() => !document.querySelector('#login-form .submit-btn').disabled);
  assert(page.url().includes('login.html'));
  checks.push('An inactivity timeout continues to require sign-in after the app is closed and reopened');
  await signIn(page); assert.equal(state.passwordRequests, 2);
  assert.equal(await page.evaluate(() => localStorage.getItem('ecoTrack_require_login')), null);
  await page.locator('#logoutButton').click(); await page.locator('#logoutConfirm').click();
  await page.waitForURL('**/login.html');
  assert.equal(await page.evaluate(() => localStorage.getItem('ecoTrack_refresh_token')), null);
  assert.equal(await page.evaluate(() => localStorage.getItem('ecoTrack_auth_token')), null);
  assert.equal(await page.evaluate(() => localStorage.getItem('ecoTrack_require_login')), 'logout');
  assert(state.logouts > 0);
  await close(); page = await open();
  await page.waitForFunction(() => !document.querySelector('#login-form .submit-btn').disabled);
  assert(page.url().includes('login.html')); assert.equal(state.passwordRequests, 2);
  checks.push('Explicit logout clears both token copies and the next process launch stays at the login screen');
  const storage = await page.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(localStorage))));
  assert(!storage.includes('fixture-password-only'));
  assert.deepEqual(runtimeErrors, []);
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ status: 'PASS', checks, fixture_requests: state, runtime_errors: runtimeErrors, live_data_changed: false }, null, 2));
  console.log(JSON.stringify({ status: 'PASS', checks, fixture_requests: state, runtime_errors: runtimeErrors }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await context?.close(); await new Promise(resolve => server ? server.close(resolve) : resolve());
});
