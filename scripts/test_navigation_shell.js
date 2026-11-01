'use strict';
// Actual shared shell assets in a streamed HTML document. All traffic stays on
// this disposable local server; no user profile, cloud or database is accessed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.ECOTRACK_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '..');
const publicRoot = path.join(root, 'public');
const out = process.env.ECOTRACK_AUDIT_ARTIFACTS || path.join(root, 'reports/navigation-shell-fixes-20261030');
const sidebar = fs.readFileSync(path.join(publicRoot, 'sidebar-template.html'), 'utf8');
const loader = fs.readFileSync(path.join(publicRoot, 'js/sidebar-loader.js'), 'utf8');
const cacheVersion = /const SIDEBAR_VERSION = '([^']+)'/.exec(loader)[1];
let server, browser;

(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/seed.html') {
      res.setHeader('Content-Type', 'text/html');
      return res.end('<!doctype html><title>Isolated shell test</title>');
    }
    if (url.pathname === '/case.html') {
      res.setHeader('Content-Type', 'text/html');
      // Stop parsing inside the header so cached sidebar insertion encounters
      // the same incomplete DOM that caused the excessive measured height.
      res.write(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
        <script src="/vendor/tailwindcss.js"></script><script>tailwind.config={darkMode:'class'};</script>
        <link rel="stylesheet" href="/styles.css"><style>main>header{min-height:84px;flex-shrink:0}</style>
        <script>window.EcoNetwork={};window.EcoDataBus={};window.EcoTrackSkeletons={};window.EcoTrackSelectControls={};window.EcoTrackMaintenance={};window.updateGlobalNotificationBadge=()=>{};</script>
        <script src="/js/sidebar.js"></script><script src="/js/sidebar-loader.js"></script></head>
        <body class="app-shell"><div class="flex h-screen"><main class="flex-1 flex flex-col"><header><h1>Page header</h1>`);
      return setTimeout(() => res.end('</header><section>Page content</section></main></div></body></html>'), 220);
    }
    const base = url.pathname.startsWith('/assets/') ? root : publicRoot;
    const file = path.resolve(base, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(base + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404); return res.end();
    }
    res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const site = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ executablePath: process.env.ECOTRACK_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const results = [];
  for (const [theme, cache, width] of [['dark', 'current', 1460], ['light', 'stale', 1460], ['dark', 'current', 390]]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.route('**/*', route => route.request().url().startsWith(site + '/') ? route.continue() : route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(site + '/seed.html');
    await page.evaluate(({ theme, cache, sidebar, cacheVersion }) => {
      localStorage.setItem('ecoTrackTheme', theme);
      localStorage.setItem('sidebarCollapsed', 'false');
      sessionStorage.setItem('ecoTrack_sidebar_html', sidebar);
      sessionStorage.setItem('ecoTrack_sidebar_ver', cache === 'current' ? cacheVersion : 'previous-template-version');
    }, { theme, cache, sidebar, cacheVersion });
    await page.addInitScript(() => {
      window.__shellFrames = [];
      const sample = () => {
        const main = document.querySelector('main'), nav = document.getElementById('sidebarNav'), sidebar = document.getElementById('sidebar');
        if (main && nav) window.__shellFrames.push({
          ready: document.readyState,
          opacity: Number(getComputedStyle(main).opacity),
          navHeight: nav.getBoundingClientRect().height,
          header: sidebar.style.getPropertyValue('--eco-page-header-height'),
          layoutTransitions: nav.getAnimations().map(animation => animation.transitionProperty).filter(Boolean)
        });
        if (performance.now() < 850) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await page.goto(site + '/case.html');
    await page.waitForTimeout(900);
    const state = await page.evaluate(() => ({
      frames: window.__shellFrames,
      header: document.querySelector('main>header').getBoundingClientRect().bottom,
      sidebarHeader: document.querySelector('#sidebar .sidebar-header').getBoundingClientRect().bottom,
      navLinks: document.querySelectorAll('#sidebarNav a').length,
      cache: sessionStorage.getItem('ecoTrack_sidebar_ver'),
      dark: document.documentElement.classList.contains('dark')
    }));
    assert(state.frames.length > 0, 'Sample actual rendered shell frames');
    assert(state.frames.every(frame => frame.opacity === 1), 'Main content is visible from its first sampled frame');
    assert(state.frames.every(frame => frame.layoutTransitions.length === 0), 'Sidebar layout never transitions from zero size');
    assert(state.frames.filter(frame => frame.ready === 'loading').every(frame => frame.header === ''), 'Do not save header dimensions while the header is incomplete');
    if (width > 760) assert(state.frames.every(frame => frame.navHeight > 200), 'Navigation is never clipped to a few pixels');
    assert(Math.abs(state.header - state.sidebarHeader) < 2, 'Settled header dividers remain aligned');
    assert.equal(state.navLinks, 11);
    assert.equal(state.cache, cacheVersion);
    assert.equal(state.dark, theme === 'dark');
    if (width > 760) {
      await page.locator('#sidebarToggle').click();
      assert.equal(await page.evaluate(() => localStorage.getItem('sidebarCollapsed')), 'true');
      await page.reload();
      await page.waitForTimeout(300);
      assert.equal(await page.locator('#sidebar').evaluate(el => el.classList.contains('collapsed')), true, 'Collapse preference survives navigation');
    } else {
      await page.locator('#ecoNavigationMenu').click();
      assert.equal(await page.locator('#sidebar').getAttribute('aria-modal'), 'true');
      assert.equal(await page.locator('main').evaluate(el => el.inert), true);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#ecoNavigationMenu').getAttribute('aria-expanded'), 'false');
      assert.equal(await page.locator('main').evaluate(el => el.inert), false);
    }
    assert.deepEqual(errors, []);
    const entry = { theme, cache, width, frames: state.frames.length, incompleteHeaderFrames: state.frames.filter(frame => frame.ready === 'loading').length, status: 'PASS' };
    results.push(entry); console.log('PASS navigation shell', JSON.stringify(entry));
    await context.close();
  }
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'navigation-shell-results.json'), JSON.stringify({ source: 'Actual shared assets, isolated local streamed HTML, no cloud or DB access', results }, null, 2));
})().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
