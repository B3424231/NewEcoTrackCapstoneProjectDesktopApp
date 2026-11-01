'use strict';
const assert=require('node:assert/strict');
const {requestTelemetry,requestLocalRead}=require('../src/telemetry-local');
(async()=>{
 const calls=[],token='isolated-admin-credential-'.repeat(2);
 const options={backendUrl:'http://localhost:5000',adminToken:token,fetcher:async(url,init)=>{calls.push({url:String(url),init});return {ok:true,json:async()=>({id:'saved'})};}};
 const result=await requestTelemetry({method:'POST',path:'/api/telemetry',data:{temperature:0}},options);
 assert.equal(result.data.id,'saved');assert.equal(calls[0].init.headers.Authorization,'Bearer '+token);assert.equal(JSON.parse(calls[0].init.body).temperature,0);
 for(const path of ['https://outside.invalid/api/telemetry','/api/monitoring/devices','/api/telemetry/../health','/api/telemetry/%2e%2e','/api/telemetry/a/b'])await assert.rejects(requestTelemetry({method:'DELETE',path},options));
 await assert.rejects(requestTelemetry({method:'GET',path:'/api/telemetry'},options));
 await assert.rejects(requestTelemetry({method:'DELETE',path:'/api/telemetry'},{...options,backendUrl:'https://outside.invalid'}));
 await assert.rejects(requestTelemetry({method:'DELETE',path:'/api/telemetry'},{...options,adminToken:'short'}));
 assert.equal(calls.length,1);
 const readOptions={...options,fetcher:async(url,init)=>{assert.equal(init.headers.Authorization,'Bearer '+token);return {status:200,text:async()=> 'observed_at,temperature\n2026-10-26,0',headers:{get:()=> 'text/csv'}};}};
 const csv=await requestLocalRead({method:'GET',path:'/api/monitoring/export.csv?node_id=fixture'},readOptions);assert.equal(csv.contentType,'text/csv');assert.match(csv.body,/temperature/);
 await assert.rejects(requestLocalRead({method:'POST',path:'/api/telemetry'},readOptions));
 console.log('PASS authenticated loopback telemetry transport, safe read/export paths and restricted writes');
})().catch(error=>{console.error(error);process.exitCode=1;});
