'use strict';
// Current AC Energy Forecast header; the retired controller page has been removed.
require('./verify_header.js');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'public/sensor-logs.html'),'utf8');
for(const period of ['daily','weekly','monthly'])assert(html.includes('data-period="'+period+'"'),'Forecast period '+period);
assert(html.includes('AC Future Cost'),'Current forecast launcher label');
assert(html.includes('aria-describedby="sensorExportStatus"'),'Export announces progress');
assert(html.includes('js/sensor-workspace.js'),'Current local sensor data controller');
assert(html.includes('js/future-cost.js') && html.includes('js/sensor-reports.js'),'Current forecast and report engines');
const css=fs.readFileSync(path.join(root,'public/css/sensor-forecast.css'),'utf8');
assert(css.includes('sensor-forecast-filters') && css.includes('@container'),'Responsive filter layout');
const assets=require('./verify_current_ui_assets.js').verify();
console.log('PASS current forecast header periods, filters, actions, accessibility and '+assets.localReferences+' local asset references.');
