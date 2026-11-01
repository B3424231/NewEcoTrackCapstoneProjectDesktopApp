'use strict';
// Pure display regressions only: no registry, network, database or hardware operations.
const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const context=vm.createContext({window:{}});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/js/device-labels.js'),'utf8'),context);
const {ecoDeviceIdentifier:identifier,ecoDeviceDisplayName:friendly}=context.window;
const raw='esp32s3-9cd20604a7ac',canonical='AC-'+raw;
const node=Object.freeze({node_id:raw,db_id:'registered-node',name:'AcController1'});

test('identifier fields show the complete canonical ID from a uniquely linked AC profile',()=>{
  assert.equal(identifier(node,[{device_id:canonical,node_id:raw,controller_node_id:node.db_id}]),canonical);
  assert.equal(identifier(node,[{device_id:canonical,controller_node_id:node.db_id}]),canonical);
});
test('missing profile IDs fall back to the full raw registered identifier without invented prefixes',()=>{
  assert.equal(identifier(node,[]),raw);
  assert.equal(identifier(node,[{node_id:raw,device_id:''}]),raw);
  assert.equal(identifier(node,[{node_id:'other-controller',device_id:'Other AC'}]),raw);
});
test('ambiguous profile assignments never choose an arbitrary canonical ID',()=>{
  assert.equal(identifier(node,[{device_id:canonical,node_id:raw},{device_id:'Other AC',controller_node_id:node.db_id}]),raw);
  assert.equal(identifier(node,[{device_id:canonical,node_id:raw},{device_id:canonical,node_id:raw}]),raw);
});
test('explicit monitoring assignment resolves its linked saved profile only',()=>{
  assert.equal(identifier({...node,monitor_aircon_id:'registered-ac'},[{aircon_id:'registered-ac',device_id:canonical}]),canonical);
});
test('names retain their friendly presentation while identifier data remains unchanged',()=>{
  const profiles=Object.freeze([Object.freeze({device_id:canonical,node_id:raw,controller_node_id:node.db_id})]);
  const before=JSON.stringify({node,profiles});
  assert.equal(identifier(node,profiles),canonical);assert.equal(friendly(raw),'AC device 04A7AC');assert.equal(friendly(node.name),'AcController1');
  assert.equal(JSON.stringify({node,profiles}),before);
});

test('detail battery display distinguishes an absent reading from a reported zero',()=>{
  const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,{dataset:{},setAttribute(){},removeAttribute(){}});return elements.get(id);};
  const details=vm.createContext({window:{},document:{getElementById:get}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/js/controller-details.js'),'utf8'),details);
  details.window.EcoTrackControllerDetails.render({});assert.equal(get('viewBattery').textContent,'Not reported');assert.equal(get('viewBattery').dataset.reported,'false');
  details.window.EcoTrackControllerDetails.render({battery_percent:0});assert.equal(get('viewBattery').textContent,'0%');assert.equal(get('viewBattery').dataset.reported,'true');
  details.window.EcoTrackControllerDetails.render({cloud_state:{battery_percent:67}});assert.equal(get('viewBattery').textContent,'67%');
});

test('modified page inline scripts remain valid JavaScript',()=>{
  for(const filename of ['nodes.html','ir-library.html']){
    const html=fs.readFileSync(path.join(__dirname,'../public',filename),'utf8');
    for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))new vm.Script(match[1],{filename});
  }
});
