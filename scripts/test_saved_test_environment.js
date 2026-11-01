'use strict';
// Current sensor-history forecasts and charts, isolated from live HTTP/storage.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=process.env.ECOTRACK_PROJECT_ROOT||path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const environment={scenario_id:'lab_hot',indoor_c:30,outdoor_c:35,relative_humidity_percent:60,source:'explicit_test_assumption'};
let passed=0;
(async()=>{
  const window={},client=vm.createContext({window,AbortController,DOMException,setTimeout,clearTimeout});vm.runInContext(read('public/js/future-cost.js'),client);
  const plan={from:'2026-10-22',to:'2026-10-22',hours:2,days:'everyday'},now=Date.parse('2026-10-21T00:00:00Z');
  const mutations={
    'Synthetic fixture metadata is ignored':state=>{state.test_fixture={synthetic:true,batch:'test',environment:{...environment}};},
    'Missing environment has no effect':state=>{state.test_fixture={synthetic:true,batch:'test'};},
    'Conflicting batches have no effect':state=>{state.test_fixture={synthetic:true,batches:['one','two'],environment:{...environment}};},
    'Nonfinite sensor assumptions are not inputs':state=>{state.test_fixture={environment:{...environment,indoor_c:null}};},
    'Undocumented scenarios have no effect':state=>{state.test_fixture={environment:{...environment,scenario_id:'unrecognized'}};},
    'Temperature and humidity assumptions have no effect':state=>{Object.assign(state,{indoor_c:99,outdoor_c:-99,relative_humidity_percent:0});state.test_fixture={environment:{...environment}};}
  };
  for(const [name,mutate] of Object.entries(mutations)){
    const state={id:'ac-fixture',name:'Fixture AC',referenceKwh:1,referenceSeconds:3600};mutate(state);const before=JSON.stringify(state);
    const result=await window.EcoTrackFutureCost.calculate(plan,{source:'sensor',devices:[state],tariff:13.24},{now});
    assert.equal(result.kwh,2,name);assert.equal(result.cost,26.48);assert.equal(result.source,'sensor');assert.equal(JSON.stringify(state),before);
    assert.equal(result.devices[0].rate,1);assert.equal(result.devices[0].model,'Recorded model-history average');
    for(const key of ['indoor_c','outdoor_c','relative_humidity_percent','test_fixture'])assert.equal(result.devices[0][key],undefined);
    passed++;
  }
  const elements=new Map(),charts=new Map();
  const get=id=>{if(!elements.has(id))elements.set(id,{style:{},hidden:false,textContent:'',value:'',selectedOptions:[],classList:{add(){}},setAttribute(){},querySelector:()=>({textContent:''})});return elements.get(id);};
  const context=vm.createContext({console,available:true,stats:{sample_count:0,confirmed_state_count:0},energy:{available:false,code:'SENSOR_REFERENCE_NO_COVERAGE'},loaded:true,period:'daily',selected:()=>[],num:(value,digits=1)=>Number.isFinite(value)?value.toFixed(digits):'Unavailable',$:get,charts,
    localStorage:{getItem:()=> '13.24'},document:{documentElement:{classList:{contains:()=>false}}},
    Chart:class{constructor(canvas,config){this.data=config.data;this.options=config.options;}update(){}}
  });
  const source=read('public/js/sensor-workspace.js'),begin=source.indexOf('  function tariff()'),end=source.indexOf('  function openReferenceDialog(',begin);assert(begin>=0&&end>begin);
  vm.runInContext(source.slice(begin,end),context);context.renderEnergy();
  assert.equal(get('kpiEnergyVal').textContent,'—');assert.equal(get('kpiCostVal').textContent,'—');
  for(const chart of charts.values())assert.equal(chart.data.datasets.length,0,'Missing estimates do not produce fabricated zero chart points');
  context.energy={available:true,energy_kwh:0,estimated_unit_hours:0,average_power_kw:0,points:[{observed_at:'2026-10-18T00:00:00Z',energy_kwh:0}]};context.renderEnergy();
  assert.equal(get('kpiEnergyVal').textContent,'0.000');assert.equal(get('kpiCostVal').textContent,'₱0.00');
  assert.equal(charts.get('energyTrendChart').data.datasets[0].data[0],0);assert.equal(charts.get('estimatedCostChart').data.datasets[0].data[0],0);passed++;
  console.log('PASS '+passed+' current sensor-history assumption and missing/zero energy display checks');
})().catch(error=>{console.error(error);process.exitCode=1;});
