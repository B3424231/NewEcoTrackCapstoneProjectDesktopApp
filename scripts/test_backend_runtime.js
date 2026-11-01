'use strict';
// Disposable configuration fixtures. Real Windows encryption is exercised by the packaged smoke test.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {readRuntimeConfig,freePort}=require('../src/backend-runtime');
test('private configuration precedes bundled defaults while explicit process settings win',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ecotrack-config-')),oldResources=process.resourcesPath;
  const previous={};for(const key of ['ECOTRACK_RUNTIME_HOME','SUPABASE_URL','SUPABASE_ANON_KEY']){previous[key]=process.env[key];delete process.env[key];}
  process.resourcesPath=temp;process.env.ECOTRACK_RUNTIME_HOME=path.join(temp,'runtime');
  const configPath=path.join(temp,'import.json');let configureFrom=configPath;
  const app={getPath:()=>temp,commandLine:{getSwitchValue:()=>configureFrom}};
  const safe={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};
  fs.writeFileSync(path.join(temp,'ecotrack-public.json'),JSON.stringify({SUPABASE_URL:'https://default.invalid',SUPABASE_ANON_KEY:'sb_publishable_default'}));
  fs.writeFileSync(configPath,JSON.stringify({SUPABASE_URL:'https://imported.invalid',SUPABASE_ANON_KEY:'sb_publishable_imported',UNSAFE_FIELD:'omitted'}));
  try{
    const folder=readRuntimeConfig(app,safe);assert.equal(process.env.SUPABASE_URL,'https://imported.invalid');
    assert.equal(process.env.SUPABASE_ANON_KEY,'sb_publishable_imported');
    assert(!JSON.parse(fs.readFileSync(path.join(folder,'runtime-config.bin'),'utf8')).UNSAFE_FIELD);
    configureFrom='';process.env.SUPABASE_URL='https://explicit.invalid';readRuntimeConfig(app,safe);assert.equal(process.env.SUPABASE_URL,'https://explicit.invalid');
    configureFrom=configPath;fs.writeFileSync(configPath,JSON.stringify({SUPABASE_URL:'http://invalid.invalid',SUPABASE_ANON_KEY:'secret'}));assert.throws(()=>readRuntimeConfig(app,safe),/HTTPS/);
    fs.writeFileSync(configPath,JSON.stringify({SUPABASE_URL:'https://invalid.invalid',SUPABASE_ANON_KEY:'private-secret'}));assert.throws(()=>readRuntimeConfig(app,safe),/server credential/);
  }finally{process.resourcesPath=oldResources;for(const [key,value]of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
test('backend port selection does not require the development port5000',async()=>{const port=await freePort();assert(port>0&&port<65536);});

test('unreadable settings stay intact and give a recovery instruction without leaking values',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ecotrack-locked-config-'));
  const previous=process.env.ECOTRACK_RUNTIME_HOME;process.env.ECOTRACK_RUNTIME_HOME=temp;
  const encrypted=path.join(temp,'runtime-config.bin'),original=Buffer.from('encrypted-under-another-profile');fs.writeFileSync(encrypted,original);
  try{
    const app={getPath:()=>temp,commandLine:{getSwitchValue:()=>''}};
    const safe={isEncryptionAvailable:()=>true,decryptString:()=>{throw Error('ciphertext failure');}};
    assert.throws(()=>readRuntimeConfig(app,safe),error=>error.code==='ECOTRACK_CONFIG_LOCKED'&&/--configure-cloud/.test(error.message)&&!/ciphertext failure/.test(error.message));
    assert.deepEqual(fs.readFileSync(encrypted),original);
  }finally{if(previous===undefined)delete process.env.ECOTRACK_RUNTIME_HOME;else process.env.ECOTRACK_RUNTIME_HOME=previous;}
});

test('reimport replaces incompatible settings and preserves the previous encrypted file',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ecotrack-reimport-'));
  const keys=['ECOTRACK_RUNTIME_HOME','SUPABASE_URL','SUPABASE_ANON_KEY'],previous=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  for(const key of keys)delete process.env[key];process.env.ECOTRACK_RUNTIME_HOME=temp;
  const encrypted=path.join(temp,'runtime-config.bin'),original=Buffer.from('other-profile-ciphertext');fs.writeFileSync(encrypted,original);
  const input=path.join(temp,'input.json');fs.writeFileSync(input,JSON.stringify({SUPABASE_URL:'https://recovered.invalid',SUPABASE_ANON_KEY:'sb_publishable_recovered'}));
  const oldResources=process.resourcesPath;process.resourcesPath=temp;
  try{
    const app={getPath:()=>temp,commandLine:{getSwitchValue:()=>input}};
    const safe={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};
    readRuntimeConfig(app,safe);
    assert.equal(process.env.SUPABASE_URL,'https://recovered.invalid');
    assert.deepEqual(fs.readFileSync(encrypted+'.previous'),original);
  }finally{process.resourcesPath=oldResources;for(const [key,value]of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
