const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const root = 'C:/Users/reygay/Desktop/EcoTrackAppMobileNew-master-control/artifacts/mobile-ui-cleanup-web';
const output = path.resolve(__dirname, 'ui-startup.json');
app.setPath('userData', path.join(__dirname, 'browser-profile'));
let server, window, errors = [];
app.whenReady().then(async () => {
 server = http.createServer((req, res) => {
  let target = path.resolve(root, '.' + decodeURIComponent(req.url.split('?')[0]));
  if (!target.toLowerCase().startsWith(path.resolve(root).toLowerCase())) { res.writeHead(403); res.end(); return; }
  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) target = path.join(root, 'index.html');
  const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' }[path.extname(target)] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime }); fs.createReadStream(target).pipe(res);
 });
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
 window = new BrowserWindow({ show: false, width: 390, height: 844, webPreferences: { contextIsolation: true, nodeIntegration: false } });
 window.webContents.on('console-message', (event) => { if (event.level === 'error' || event.level === 3) errors.push(String(event.message)); });
 await window.loadURL('http://127.0.0.1:' + server.address().port);
 await new Promise(resolve => setTimeout(resolve, 4500));
 const text = await window.webContents.executeJavaScript('document.body.innerText');
 const screenshot = await window.webContents.capturePage();
 fs.writeFileSync(path.join(__dirname, 'mobile-startup.png'), screenshot.toPNG());
 const result = { bodyText: text.slice(0, 1200), errors, viewport: await window.webContents.executeJavaScript('({width: innerWidth, height: innerHeight})'), authenticatedDeviceFlows: 'Not exercised; no phone or admin credentials supplied' };
 fs.writeFileSync(output, JSON.stringify(result, null, 2));
 console.log(JSON.stringify(result));
 if (!text.trim()) process.exitCode = 1;
 window.destroy(); server.close(); app.quit();
}).catch(error => { console.error(error.message); app.exit(1); });
