'use strict';
// The main process calls this only through its verified administrator IPC guard.
const fs = require('node:fs');
async function requestTelemetry(input, options) {
  const base = new URL(options.backendUrl || 'http://localhost:5000');
  if (!['http:', 'https:'].includes(base.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)
      || base.username || base.password || !['', '/'].includes(base.pathname) || base.search || base.hash)
    throw new Error('Telemetry administration requires the local desktop backend.');
  if (!input || !['POST', 'PATCH', 'DELETE'].includes(input.method) || typeof input.path !== 'string'
      || !/^\/api\/(?:telemetry(?:\/[A-Za-z0-9_-]+)?|set-sleep)(?:\?[^#]*)?$/.test(input.path))
    throw new Error('Unsupported telemetry administration request.');
  const token = options.adminToken || fs.readFileSync(options.keyPath, 'utf8').trim();
  if (typeof token !== 'string' || token.length < 32) throw new Error('Restart the local backend to initialize telemetry administration.');
  const response = await (options.fetcher || fetch)(new URL(input.path, base), {
    method: input.method, signal: AbortSignal.timeout(15000),
    headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + token},
    ...(input.data === undefined ? {} : {body: JSON.stringify(input.data)})
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Local telemetry request failed.');
  return {success: true, data};
}
async function requestLocalRead(input, options) {
  const base = new URL(options.backendUrl || 'http://localhost:5000');
  if (!['http:', 'https:'].includes(base.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)
      || base.username || base.password || !['', '/'].includes(base.pathname) || base.search || base.hash)
    throw new Error('Local reads require the desktop backend.');
  if (!input || typeof input.path !== 'string' || !/^\/api\/[A-Za-z0-9_/-]+(?:\.csv)?(?:\?[^#]*)?$/.test(input.path)
      || !(input.method === 'GET' || input.method === 'POST' && ['/api/predict-energy', '/api/predict-recorded-energy'].includes(input.path)))
    throw new Error('Unsupported local read request.');
  const token = options.adminToken || fs.readFileSync(options.keyPath, 'utf8').trim();
  if (typeof token !== 'string' || token.length < 32) throw new Error('Restart the desktop backend.');
  const response = await (options.fetcher || fetch)(new URL(input.path, base), {
    method: input.method, signal: AbortSignal.timeout(15000),
    headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + token},
    ...(input.data === undefined ? {} : {body: JSON.stringify(input.data)})
  });
  return {status: response.status, body: await response.text(), contentType: response.headers.get('content-type') || 'application/json'};
}
module.exports = {requestTelemetry, requestLocalRead};
