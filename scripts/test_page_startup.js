'use strict';
// Startup must work without public CDNs or invented values before data is loaded.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '../public');
const pages = ['analytics', 'telemetry', 'dashboard', 'control', 'nodes', 'ir-library',
  'scheduler', 'rules', 'Notification', 'staff', 'sensor-logs', 'profile'];

test('every sidebar destination boots with local script dependencies', () => {
  const external = [];
  for (const page of pages) {
    const html = fs.readFileSync(path.join(root, page + '.html'), 'utf8');
    // Strip inline script bodies: dormant SDK fallback strings are not parser-loaded tags.
    const markup = html.replace(/(<script\b[^>]*>)[\s\S]*?<\/script>/gi, '$1</script>');
    for (const match of markup.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)/gi)) {
      if (/^(?:https?:)?\/\//i.test(match[1])) external.push(page + ': ' + match[1]);
      else assert(fs.existsSync(path.resolve(root, match[1].split(/[?#]/)[0])), page + ': ' + match[1]);
    }
  }
  assert.deepEqual(external, [], 'Page transitions must not wait for a public script CDN');
});

test('dashboard first paint never claims counts before records are known', () => {
  const html = fs.readFileSync(path.join(root, 'dashboard.html'), 'utf8');
  const counters = [...html.matchAll(/<span\b[^>]*\bid="(kpi(?:TotalUnits|OnlineUnits|ActivePower|Standby|NodesOnline|CommandsSent|CommandsSuccess|CommandsFailed))"[^>]*>([^<]*)<\/span>/g)];
  assert.equal(counters.length, 8);
  for (const [, id, value] of counters) assert.equal(value.trim(), '—', id + ' needs an unknown placeholder before records load');
});
