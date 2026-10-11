const fs = require('node:fs'), path = require('node:path');
const root = path.resolve('C:/Users/reygay/Desktop/EcoTrackAppMobileNew-master-control');
const backup = path.resolve('C:/Users/reygay/Desktop/EcoTrackDesktopDashboardNew-main-control/reports/mobile-cloud-integration/before');
const read = fs.readFileSync.bind(fs), exists = fs.existsSync.bind(fs);
function baseline(file) {
 if (typeof file !== 'string') return file;
 const full = path.resolve(file);
 if (!full.toLowerCase().startsWith((root + path.sep).toLowerCase())) return file;
 const candidate = path.join(backup, path.relative(root, full));
 return exists(candidate) ? candidate : file;
}
fs.readFileSync = (file, ...args) => read(baseline(file), ...args);
