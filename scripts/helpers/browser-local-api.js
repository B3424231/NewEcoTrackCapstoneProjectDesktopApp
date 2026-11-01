'use strict';
const {requestLocalRead}=require('../../src/telemetry-local');
// Browser fixtures use the production authenticated main-process read transport.
// Other fixture channels are left to their existing handlers.
async function installLocalApiBridge(context,{backendUrl,adminToken='isolated-local-read-fixture-token-'.repeat(2),unavailable=()=>false,routeFixtures=false}){
 await context.exposeBinding('__testLocalApiRead',async(source,input)=>{
  if(unavailable())return {success:false,error:'Fixture local backend unavailable'};
  // Route-backed tests must send the validated request through their isolated
  // Playwright routes. Real backend tests retain the native Node transport.
  const fetcher=routeFixtures?async(url,options)=>{
   const result=await source.frame.evaluate(async({url,method,headers,body})=>{
    const response=await window.__fixtureNativeFetch(url,{method,headers,...(body===undefined?{}:{body})});
    return {status:response.status,body:await response.text(),contentType:response.headers.get('content-type')};
   },{url:String(url),method:options.method,headers:options.headers,body:options.body});
   return {status:result.status,text:async()=>result.body,headers:{get:()=>result.contentType}};
  }:undefined;
  try{return {success:true,...await requestLocalRead(input,{backendUrl,adminToken,fetcher})};}
  catch(error){return {success:false,error:error.message};}
 });
 await context.addInitScript(()=>{
  window.__fixtureNativeFetch=window.fetch.bind(window);
  let bridge;
  Object.defineProperty(window,'electron',{configurable:true,get:()=>bridge,set(value){
   bridge=new Proxy(value,{get(target,key){if(key!=='invoke')return Reflect.get(target,key);
    return (channel,input)=>channel==='local-api-read'?window.__testLocalApiRead(input):target.invoke?.(channel,input);
   }});
  }});
 });
}
module.exports={installLocalApiBridge};
