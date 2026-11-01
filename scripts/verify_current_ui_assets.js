'use strict';
// Read-only local asset audit. No application, account, database, or network access.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), publicRoot = path.join(root, 'public');
const retired = ['public/renderer.js','public/js/router.js','public/js/analytics.js','public/js/telemetry-new.js','public/js/logs.js','public/js/energy-prediction.js','public/js/clear-logs-dialog.js','public/js/telemetry-history.js','public/logs.html','public/css/clear-logs-dialog.css','public/assets/ecoTrack-transparent.png','assets/ecoTrack-transparent.png','assets/login-bg.jpg'];
function verify() {
  for (const file of retired) assert.equal(fs.existsSync(path.join(root, file)), false, 'Retired file remains: ' + file);
  const checked = [], failures = [], cssFiles = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, {withFileTypes:true})) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (file.endsWith('.css')) cssFiles.push(file);
    }
  }
  function check(file, reference) {
    if (/^(?:[a-z]+:|\/\/|#)/i.test(reference) || !reference.trim()) return;
    const target = path.resolve(path.dirname(file), decodeURIComponent(reference.split(/[?#]/)[0]));
    if (!target.startsWith(root + path.sep)) return failures.push({file:path.relative(root,file),reference,reason:'outside project'});
    if (!fs.existsSync(target)) failures.push({file:path.relative(root,file),reference,reason:'missing'});
    checked.push({file:path.relative(root,file),reference,target:path.relative(root,target)});
  }
  const pages = fs.readdirSync(publicRoot).filter(file => file.endsWith('.html'));
  for (const name of pages) {
    const file = path.join(publicRoot, name), source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
      // Ignore attribute-shaped text inside script templates; the browser checks those dynamically.
      if (/[{}<>]|\$\(/.test(match[1])) continue;
      check(file, match[1]);
    }
  }
  visit(publicRoot);
  for (const file of cssFiles) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/gi)) check(file, match[1]);
  }
  assert.deepEqual(failures, [], 'Current HTML/CSS references must resolve');
  return {status:'PASS',retiredFilesAbsent:retired.length,pages:pages.length,localReferences:checked.length,failures};
}
module.exports = {verify, retired};
if (require.main === module) console.log(JSON.stringify(verify(), null, 2));
