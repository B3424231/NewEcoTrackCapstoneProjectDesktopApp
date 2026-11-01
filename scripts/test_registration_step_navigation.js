"use strict";
// Actual step markup/navigation with isolated connection-state fixtures; no external service.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { chromium } = require(process.env.ECOTRACK_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/nodes.html'), 'utf8');
const out = path.join(root, 'reports/registration-steps');
const start = html.indexOf('      function updateNextButtonState() {');
const end = html.indexOf('      // Live summary input listeners', start);
assert(start >= 0 && end > start);
const navigation = html.slice(start, end);
let browser;
(async () => {
  fs.mkdirSync(out, { recursive: true });
  for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) if (script[1].trim()) new vm.Script(script[1]);
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const results = [];
  for (const theme of ['dark', 'light']) for (const width of [1460, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.abort());
    const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, '');
    await page.setContent(markup);
    await page.addStyleTag({ content: fs.readFileSync(path.join(root, 'public/styles.css'), 'utf8') + '\n' + fs.readFileSync(path.join(root, 'public/css/controller-registration.css'), 'utf8') });
    await page.addScriptTag({ path: path.join(root, 'public/vendor/tailwindcss.js') });
    await page.evaluate(theme => { tailwind.config = { darkMode: 'class' }; document.documentElement.classList.toggle('dark', theme === 'dark'); }, theme);
    await page.addScriptTag({ content: `
      var currentModalStep = 1, registrationSaving = false, registrationBluetoothLive = false, selectedBleDevice = null;
      var fixtureWifiReady = false, remoteCapture = {register:{busy:false}}, scannedWifiNetworks = ['isolated'], isWifiScanning = false;
      var stepTab1 = document.getElementById('nodeStepTab1'), stepTab2 = document.getElementById('nodeStepTab2'), stepTab3 = document.getElementById('nodeStepTab3');
      var nextStepBtn = document.getElementById('nodeNextStepBtn'), prevStepBtn = document.getElementById('nodePrevStepBtn');
      window.EcoToast = {show(){}};
      function confirmedWifiReady(){ return registrationBluetoothLive && fixtureWifiReady; }
      function updateRegistrationSave(){} function resetRemoteDetection(){} function refreshExistingWifiPanel(){} function updateConfigSummary(){}
      ${navigation}
      document.getElementById('nodeModal').classList.remove('hidden');
      setNodeModalStep(1);
    ` });
    assert.equal(await page.locator('#nodeStepTab1').isDisabled(), false);
    assert.equal(await page.locator('#nodeStepTab2').isDisabled(), true);
    assert.equal(await page.locator('#nodeStepTab3').isDisabled(), true);
    await page.evaluate(() => { document.getElementById('nodeStepTab3').click(); });
    assert.equal(await page.evaluate(() => currentModalStep), 1);
    await page.evaluate(() => {
      registrationBluetoothLive = true; selectedBleDevice = {nodeId:'isolated-device',info:{}};
      document.getElementById('nodeFormId').value = 'isolated-device';
      setNodeModalStep(2);
    });
    assert.equal(await page.locator('#nodeStepTab1').isDisabled(), true, 'Completed Bluetooth is locked');
    assert.equal(await page.locator('#nodeStepTab2').isDisabled(), false);
    assert.equal(await page.locator('#nodeStepTab3').isDisabled(), true);
    await page.evaluate(() => { fixtureWifiReady = true; updateNextButtonState(); });
    assert.equal(await page.locator('#nodeStepTab3').isDisabled(), false);
    await page.locator('#nodeStepTab3').click();
    assert.equal(await page.evaluate(() => currentModalStep), 3, 'Forward navigation remains available when ready');
    for (const step of [1, 2]) {
      const button = page.locator('#nodeStepTab' + step);
      assert.equal(await button.isDisabled(), true);
      assert.equal(await button.getAttribute('aria-disabled'), 'true');
      assert.equal(await page.locator('#nodeStepBadge' + step).innerText(), '\u2713');
      await page.waitForFunction(step => Number(getComputedStyle(document.getElementById('nodeStepTab' + step)).opacity) > .99, step);
      assert(await button.evaluate(element => Number(getComputedStyle(element).opacity) > .99), 'Completed status stays legible');
      await button.evaluate(element => { element.click(); element.dispatchEvent(new MouseEvent('click',{bubbles:true})); element.focus(); });
      assert.equal(await page.evaluate(() => currentModalStep), 3, 'Completed headers cannot reopen a previous step');
      assert.notEqual(await page.evaluate(() => document.activeElement.id), 'nodeStepTab' + step, 'Disabled headers cannot take keyboard focus');
    }
    await page.locator('#closeNodeModalBtn').focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'nodeStepTab3', 'Keyboard skips the completed steps');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => currentModalStep), 3);
    await page.evaluate(() => document.getAnimations().forEach(animation => animation.finish()));
    await page.locator('#nodeStepTab1').locator('..').screenshot({ path: path.join(out, `completed-${theme}-${width}.png`) });
    await page.evaluate(() => { registrationBluetoothLive = false; selectedBleDevice = null; fixtureWifiReady = false; setNodeModalStep(1); });
    assert.equal(await page.locator('#nodeStepTab1').isDisabled(), false, 'Starting again resets the completed state');
    assert.equal(await page.locator('#nodeStepTab1').getAttribute('data-step-complete'), 'false');
    assert.deepEqual(errors, []);
    results.push({ theme, width, status:'PASS', completedHeadersLocked:true, keyboardSkipsCompleted:true, forwardNavigation:true, reset:true });
    console.log(`PASS ${theme} ${width}: completed clicks blocked, keyboard skip, checkmarks, forward navigation and reset`);
    await page.close();
  }
  fs.writeFileSync(path.join(out, 'browser-results.json'), JSON.stringify({ passed: results.length, results, physicalHardwareTested:false }, null, 2));
})().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => { await browser?.close(); });
