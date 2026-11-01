'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const calls=[],network=[];let pending=false,missingHandler=false;
const context={URL,URLSearchParams,Request,Response,AbortController,DOMException,console,setInterval(){},clearInterval(){},setTimeout,clearTimeout,location:{href:'file:///app/public/telemetry.html'},localStorage:{getItem(){return null;},setItem(){}},electron:{env:{BACKEND_URL:'http://localhost:5000'},invoke:async(channel,input)=>{calls.push({channel,input});if(missingHandler)throw new Error("Error invoking remote method 'local-api-read': Error: No handler registered for 'local-api-read'");if(pending)return new Promise(()=>{});return {success:true,status:200,body:'{"items":[{"temperature":0}]}',contentType:'application/json'};}},fetch:async(url)=>{network.push(String(url));return new Response('{}');}};
context.window=context;vm.createContext(context);vm.runInContext(fs.readFileSync('public/js/supabase-client.js','utf8'),context);
(async()=>{
 const response=await context.fetch('http://localhost:5000/api/telemetry');assert.equal((await response.json()).items[0].temperature,0);assert.equal(calls[0].channel,'local-api-read');assert.equal(network.length,0);
 await context.fetch('https://cloud.example/rest/v1/nodes');assert.equal(network.length,1);
 missingHandler=true;await assert.rejects(context.fetch('http://localhost:5000/api/monitoring/energy'),/Restart EcoTrack.*page reload/i);missingHandler=false;
 pending=true;const abort=new AbortController();const work=context.fetch('http://localhost:5000/api/monitoring/devices',{signal:abort.signal});abort.abort();await assert.rejects(work,/abort/i);
 console.log('PASS local reads use credential-free renderer IPC, retain cloud transport and honor cancellation');
})().catch(error=>{console.error(error);process.exitCode=1;});
