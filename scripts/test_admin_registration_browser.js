'use strict';
// Real login page and controller, with isolated Auth/IPC transports. No real user creation.
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
const root = path.resolve(__dirname, '..'), publicRoot = path.join(root, 'public');
const out = path.resolve(process.env.ECOTRACK_ADMIN_TEST_OUTPUT || path.join(root, 'reports/admin-registration-20261020/browser'));
const results = [], errors = [], unexpectedWrites = [], checks = [];
let server, browser;
const mockClientScript = `(() => {
  window.fixture = { clients: [], provisionCalls: 0, currentSignIns: 0, currentSignOuts: 0, temporarySignOuts: 0, publicSignUps: 0, edgeCalls: 0, approvalRpcs: [], ipcCalls: [], gate: false, conflict: false };
  window.supabase = { createClient(_url, _key, options) {
    const temporary = options?.auth?.persistSession === false;
    const record = { temporary, active: !temporary && window.fixtureExistingAdmin };
    window.fixture.clients.push(record);
    const identity = '11111111-1111-4111-8111-111111111111';
    const session = () => record.active ? { access_token: 'fixture-only-access', refresh_token: 'fixture-only-refresh', user: { id: identity, email:'existing@example.invalid' } } : null;
    record.session = session;
    return {
      auth: {
        getSession: async () => ({ data: { session: session() } }),
        getUser: async () => ({ data: { user: record.active ? { id: identity, email:'existing@example.invalid' } : null } }),
        onAuthStateChange() {},
        signInWithPassword: async () => {
          if (!temporary) window.fixture.currentSignIns++;
          throw new Error('Adding an administrator must not sign in with inline approval credentials');
        },
        signOut: async () => { if (temporary) window.fixture.temporarySignOuts++; else window.fixture.currentSignOuts++; record.active = false; },
        signUp: () => { window.fixture.publicSignUps++; throw new Error('Use the provisioning endpoint without creating a client session'); }
      },
      rpc: async name => { window.fixture.approvalRpcs.push(name); throw new Error('Adding an administrator must not require approval RPCs'); },
      functions: { invoke: async () => { window.fixture.edgeCalls++; throw new Error('Desktop registration must use its guarded IPC route'); } }
    };
  }};
  window.electron = { env:{}, on(){}, invoke:async (channel,input) => {
    window.fixture.ipcCalls.push({channel,input});
    if(channel === 'auth-set-session') return {success:true};
    if(channel !== 'auth-register-admin') throw new Error('Unexpected IPC operation: '+channel);
    window.fixture.provisionCalls++;
    if(window.fixture.gate) await new Promise(resolve => window.fixtureRelease = resolve);
    if(window.fixture.conflict) return {success:false,error:'Duplicate email <img src=x onerror="window.fixtureInjected=true">'};
    return {success:true,adminId:'admin_second_fixture',authUserId:'22222222-2222-4222-8222-222222222222'};
  }};
})();`;

function check(condition, label) { assert(condition, label); checks.push(label); }
async function state(page) {
  return page.evaluate(() => ({
    calls:fixture.provisionCalls, currentSignIns:fixture.currentSignIns, currentSignOuts:fixture.currentSignOuts,
    temporarySignOuts:fixture.temporarySignOuts, publicSignUps:fixture.publicSignUps, edgeCalls:fixture.edgeCalls, approvalRpcs:fixture.approvalRpcs,
    temporaryClients:fixture.clients.filter(client => client.temporary).length,
    primarySession:fixture.clients.find(client => !client.temporary)?.session(),
    mirroredSessions:fixture.ipcCalls.filter(call => call.channel === 'auth-set-session'),
    storedProfile:localStorage.getItem('ecoTrack_profile_user'), storedToken:localStorage.getItem('ecoTrack_auth_token'),
    redirected:!location.pathname.endsWith('login.html')
  }));
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  server = http.createServer((req, res) => {
    const filename = path.resolve(publicRoot, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!filename.startsWith(publicRoot + path.sep) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) { res.writeHead(404); return res.end(); }
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' })[path.extname(filename)] || 'application/octet-stream');
    fs.createReadStream(filename).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const site = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ executablePath: process.env.ECOTRACK_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  for (const [width, height, existing] of [[1460, 1000, false], [390, 844, false], [1460, 1000, true], [390, 844, true]]) {
    const context = await browser.newContext({ viewport: { width, height }, timezoneId: 'Asia/Singapore' });
    await context.addInitScript(({ existing }) => {
      window.fixtureExistingAdmin = existing;
      localStorage.setItem('ecoTrack_supabase_url', 'https://isolated-fixture.invalid');
      localStorage.setItem('ecoTrack_supabase_anon_key', 'sb_publishable_isolated_fixture');
      if (existing) {
        localStorage.setItem('ecoTrack_profile_user', JSON.stringify({ id: 'admin_existing_fixture', userType: 'admin' }));
        localStorage.setItem('ecoTrack_auth_token', 'fixture-only-access');
      }
    }, { existing });
    await context.route('**/*', route => {
      const url = route.request().url();
      if (!['GET','HEAD'].includes(route.request().method())) unexpectedWrites.push({ url, method:route.request().method() });
      if (url.startsWith('https://cdn.tailwindcss.com')) return route.fulfill({ path: path.join(publicRoot, 'vendor/tailwindcss.js'), contentType: 'text/javascript' });
      if (url === site + '/js/supabase.umd.js') return route.fulfill({ body: mockClientScript, contentType: 'text/javascript' });
      if (url.startsWith(site + '/')) return route.continue();
      return route.abort();
    });
    await context.routeWebSocket(/.*/, socket => socket.close());
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(site + '/login.html');
    await page.evaluate(() => window.ecotrackAuthReady);
    const before = await state(page);
    await page.evaluate(() => { window.ecotrackAuthReady = new Promise(() => {}); });
    await page.locator('#show-register-btn').click();
    await page.waitForFunction(() => document.getElementById('card-main-title').textContent === 'Register as an Administrator');
    await page.evaluate(() => document.getAnimations().forEach(animation => { if (animation.effect?.getComputedTiming().iterations !== Infinity) animation.finish(); }));
    check(await page.locator('#admin-approval-fields,#approval-email,#approval-password').count() === 0, `${width}px registration has no existing-administrator approval fieldset or inputs`);
    check(!(await page.locator('#register-form').textContent()).includes('Existing administrator approval'), `${width}px registration has no retired approval prompt`);
    check(!/sign in as an administrator|approval from an existing/i.test(await page.locator('#form-subtitle').textContent()), `${width}px registration does not require prior administrator sign-in`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px registration has no horizontal overflow`);
    await page.screenshot({ path:path.join(out,`registration-${width}-${existing ? 'signed-in' : 'signed-out'}.png`), fullPage:true });
    await page.locator('#reg-username').fill('Second Administrator');
    await page.locator('#reg-email').fill('second@example.invalid');
    await page.locator('#reg-password').fill('fixture-password');
    await page.locator('#reg-password-confirm').fill('fixture-password');
    for (const invalid of [
      {id:'reg-username',value:'ab',error:'Username must be at least 3 characters long.'},
      {id:'reg-email',value:'invalid-email',error:'Please enter a valid email address.'},
      {id:'reg-password',value:'short',error:'Password must be at least 8 characters long.'},
      {id:'reg-password-confirm',value:'different-password',error:'Passwords do not match. Please check and try again.'}
    ]) {
      const input=page.locator('#'+invalid.id),original=await input.inputValue();
      await input.fill(invalid.value);
      await page.locator('#register-form').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
      await page.getByText(invalid.error,{exact:true}).waitFor();
      check(await page.evaluate(()=>fixture.provisionCalls) === 0, `${width}px ${existing ? 'signed-in' : 'signed-out'} invalid ${invalid.id} is rejected before provisioning`);
      await input.fill(original);
    }
    await page.evaluate(() => { window.fixture.conflict = true; });
    await page.locator('#register-form .submit-btn').click();
    await page.waitForFunction(() => document.getElementById('auth-alert').textContent.includes('Duplicate email'));
    check(await page.locator('#auth-alert img').count() === 0 && !await page.evaluate(() => Boolean(window.fixtureInjected)), `${width}px registration renders conflict HTML as escaped text`);
    check(await page.locator('#register-form').isVisible() && await page.locator('#register-form .submit-btn').isEnabled(), `${width}px duplicate-account failure restores an editable registration form`);
    check(await page.locator('#reg-email').inputValue() === 'second@example.invalid', `${width}px registration preserves entered details after conflict`);
    await page.screenshot({ path:path.join(out,`registration-conflict-${width}-${existing ? 'signed-in' : 'signed-out'}.png`), fullPage:true });
    await page.evaluate(() => { window.fixture.conflict = false; window.fixture.gate = true; const form = document.getElementById('register-form'); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await page.waitForFunction(() => typeof window.fixtureRelease === 'function');
    check(await page.locator('#register-form .submit-btn').isDisabled() && await page.locator('#register-form .submit-btn .animate-spin').count() === 1, `${width}px ${existing ? 'signed-in' : 'signed-out'} creation shows a spinner and disables duplicate submits`);
    check(await page.evaluate(() => window.fixture.provisionCalls) === 2, `${width}px repeated submissions issue exactly one pending creation request after conflict`);
    const requests = await page.evaluate(() => fixture.ipcCalls.filter(call => call.channel === 'auth-register-admin').map(call => call.input));
    assert.deepEqual(requests,[1,2].map(() => ({username:'Second Administrator',email:'second@example.invalid',password:'fixture-password'})),'Desktop registration uses the trusted provisioning IPC route without approval credentials');
    checks.push(`${width}px ${existing ? 'signed-in' : 'signed-out'} creation uses the provisioning route without approval credentials or waiting for authentication`);
    await page.evaluate(() => window.fixtureRelease());
    await page.getByText('Administrator account created. The new administrator can now sign in with their email and password.', { exact: true }).waitFor();
    check(await page.locator('#login-form').isVisible() && await page.locator('#register-form').isHidden(), `${width}px ${existing ? 'signed-in' : 'signed-out'} confirmed creation returns to sign-in`);
    check(await page.locator('#email').inputValue() === 'second@example.invalid' && await page.locator('#password').inputValue() === '', `${width}px confirmed creation prefills the new email and keeps the login password empty`);
    check((await page.locator('#register-form input').evaluateAll(inputs => inputs.map(input => input.value))).every(value => value === ''), `${width}px confirmed creation resets all registration fields`);
    const after = await state(page);
    assert.deepEqual({...after,calls:before.calls},before,'Account creation must preserve the primary session, local credentials, main-process mirror and current page');
    checks.push(`${width}px ${existing ? 'signed-in' : 'signed-out'} creation preserves its primary and main-process sessions without automatic sign-in`);
    check(after.approvalRpcs.length === 0 && after.currentSignIns === 0 && after.currentSignOuts === 0 && after.temporaryClients === 0, `${width}px ${existing ? 'signed-in' : 'signed-out'} registration never requests an approving identity or temporary authentication`);
    const storage=await page.evaluate(()=>JSON.stringify({local:Object.fromEntries(Object.entries(localStorage)),session:Object.fromEntries(Object.entries(sessionStorage))}));
    check(!storage.includes('fixture-password'), `${width}px registration never persists the new password in browser storage`);
    await page.screenshot({ path:path.join(out,`registration-success-${width}-${existing ? 'signed-in' : 'signed-out'}.png`), fullPage:true });
    await page.locator('#show-register-btn').click();
    check((await page.locator('#register-form input').evaluateAll(inputs => inputs.map(input => input.value))).every(value => value === '') && await page.locator('#admin-approval-fields,#approval-email,#approval-password').count() === 0, `${width}px reopened registration remains reset without approval controls`);
    results.push({ width,height,existing_admin_session:existing,status:'PASS',state:after });
    await context.close();
  }
  assert.deepEqual(errors, [], 'Actual login/registration runtime errors');
  assert.deepEqual(unexpectedWrites, [], 'Browser fixtures must never issue real account network writes');
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ status:'PASS',isolated_transports:true,real_accounts_created:0,checks:results,assertions:checks,runtime_errors:errors,unexpected_writes:unexpectedWrites },null,2));
  console.log(JSON.stringify({ status:'PASS',layouts:results.length,assertions:checks.length,real_accounts_created:0,checks:['approval fieldset and inputs absent','signed-out and signed-in registration succeeds without approval RPCs','input validation prevents invalid provisioning','primary session and main-process mirror preserved','conflict stays editable','error HTML rendered as text','double submit coalesced with spinner','verified receipt success','email prefilled and registration reset','no automatic sign-in or redirect','no horizontal overflow'] },null,2));
})().catch(error => {
  console.error(error);process.exitCode=1;fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({status:'FAIL',error:error.stack,checks:results,assertions:checks,runtime_errors:errors,unexpected_writes:unexpectedWrites,real_accounts_created:0},null,2));
}).finally(async () => { await browser?.close(); await new Promise(resolve => server ? server.close(resolve) : resolve()); });
