'use strict';

// Actual profile markup/controller with local fixtures and all external requests blocked.
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
const root = path.resolve(process.env.ECOTRACK_PROFILE_ROOT || path.join(__dirname, '..'));
const publicRoot = path.join(root, 'public');
const profileSource = process.env.ECOTRACK_PROFILE_JS || path.join(publicRoot, 'js/profile.js');
const out = path.resolve(process.env.ECOTRACK_AVATAR_REPORT_DIR || path.join(root, 'reports/profile-avatar'));
const svg = letter => `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="#059669"/><text x="64" y="85" text-anchor="middle" font-size="64" fill="white">${letter}</text></svg>`;
const photoA = 'data:image/svg+xml;base64,' + Buffer.from(svg('A')).toString('base64');
const profile = id => ({ id, name: id === 'admin-b' ? 'New administrator' : 'Previous administrator', email: id + '@example.invalid', role: 'admin', userType: 'admin' });
const errors = [], checks = [];
let browser, server;

(async () => {
  fs.mkdirSync(out, { recursive: true });
  server = http.createServer((req, res) => {
    const filename = path.resolve(publicRoot, '.' + new URL(req.url, 'http://fixture').pathname);
    if (!filename.startsWith(publicRoot + path.sep) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
      res.writeHead(404); return res.end();
    }
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[path.extname(filename)] || 'application/octet-stream');
    fs.createReadStream(filename).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const site = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ executablePath: process.env.ECOTRACK_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 1460, height: 1000 }, timezoneId: 'Asia/Singapore' });
    await context.addInitScript(({ theme, photoA, initialProfile }) => {
      if (!localStorage.getItem('fixtureInitialized')) {
        localStorage.setItem('ecoTrack_profile_user', JSON.stringify(initialProfile));
        localStorage.setItem('ecoTrack_avatar', photoA);
        localStorage.setItem('ecoTrack_avatar:admin-a', photoA);
        localStorage.setItem('fixtureInitialized', 'true');
      }
      window.getSessionTimeoutSetting = () => 'Never';
      window.resetSessionTimeoutTimer = () => {};
      window.EcoToast = { success() {}, error(message) { throw Error(message); } };
      window.supabaseClient = {
        rpc: async name => ({ data: name === 'ecotrack_my_profile' ? JSON.parse(localStorage.getItem('ecoTrack_profile_user')) : true, error: null }),
        from: () => ({ select: async () => ({ data: [], error: null }) })
      };
      document.addEventListener('DOMContentLoaded', () => document.documentElement.classList.toggle('dark', theme === 'dark'));
    }, { theme, photoA, initialProfile: profile('admin-b') });
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (!request.url().startsWith(site + '/') || !['GET', 'HEAD'].includes(request.method())) return route.abort();
      if (url.pathname === '/js/profile.js') return route.fulfill({ path: profileSource, contentType: 'text/javascript' });
      if (url.pathname.endsWith('.js') && url.pathname !== '/vendor/tailwindcss.js') return route.fulfill({ body: '', contentType: 'text/javascript' });
      return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(site + '/profile.html');
    await page.waitForFunction(() => document.getElementById('profile-name').textContent === 'New administrator');
    assert(await page.locator('#profileAvatarImg').isHidden(), 'New account must not show the old administrator photo');
    assert(await page.locator('#profileAvatarSvg').isVisible());
    await page.locator('#avatarContainer').screenshot({ path: path.join(out, `new-admin-${theme}.png`) });
    checks.push(theme + ': new administrator uses default icon despite legacy shared image');

    await page.locator('#avatarFileInput').setInputFiles({ name: 'new-admin.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg('B')) });
    await page.waitForFunction(() => document.getElementById('profileAvatarImg').complete && document.getElementById('profileAvatarImg').naturalWidth > 0);
    assert(await page.locator('#profileAvatarImg').isVisible());
    const photoB = await page.locator('#profileAvatarImg').getAttribute('src');
    assert.notEqual(photoB, photoA);
    await page.reload();
    await page.waitForFunction(() => document.getElementById('profileAvatarImg').naturalWidth > 0);
    assert.equal(await page.locator('#profileAvatarImg').getAttribute('src'), photoB);
    checks.push(theme + ': uploaded photo renders immediately and survives page reload');

    for (const [id, expected] of [['admin-a', photoA], ['admin-b', photoB]]) {
      await page.evaluate(async next => {
        localStorage.setItem('ecoTrack_profile_user', JSON.stringify(next));
        await loadProfileWithSWR(true);
      }, profile(id));
      assert.equal(await page.locator('#profileAvatarImg').getAttribute('src'), expected);
    }
    await page.evaluate(async () => {
      localStorage.setItem('ecoTrack_profile_user', JSON.stringify({ id: 'admin-c', name: 'No photo', role: 'admin' }));
      await loadProfileWithSWR(true);
    });
    assert(await page.locator('#profileAvatarImg').isHidden());
    assert.equal(await page.locator('#profileAvatarImg').getAttribute('src'), null);
    assert(await page.locator('#profileAvatarSvg').isVisible());
    checks.push(theme + ': switching accounts restores their own image and clears it for accounts without photos');
    assert.equal(await page.evaluate(() => localStorage.getItem('ecoTrack_avatar:admin-a')), photoA);
    assert.equal(await page.evaluate(() => localStorage.getItem('ecoTrack_avatar')), photoA);
    await context.close();
  }
  assert.deepEqual(errors, [], 'No profile runtime errors');
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ status: 'PASS', checks, runtime_errors: errors, live_data_changed: false }, null, 2));
  console.log(JSON.stringify({ status: 'PASS', checks, runtime_errors: errors }, null, 2));
})().catch(error => {
  console.error(error); process.exitCode = 1;
}).finally(async () => {
  await browser?.close();
  await new Promise(resolve => server ? server.close(resolve) : resolve());
});
