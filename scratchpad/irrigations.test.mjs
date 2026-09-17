import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
process.env.TZ='Europe/Rome';
const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const extract=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const raw=[{timestamp:'2026-07-05T22:30:00Z',totalLiters:400,zones:[{liters:200},{liters:200}]}];
const garden={totalArea:200,gardenCreatedAt:'2026-07-01',hasShallowWaterTable:false};
const data=new Map([['dss_irrigation_history',raw]]);
const ctx=vm.createContext({Date,console:{log(){}},S:{get:(k,d)=>data.get(k)??d,set:(k,v)=>data.set(k,v)},
  getLayerParams:()=>({rainCoeff:.8,drainRate:.2,surface:{depth:.1,fc:.3,wp:.1},root:{depth:.3,fc:.3,wp:.1,wpFloor:.1}}),
  getStoredThetaDual:()=>({thetaSurface:.12,thetaRoot:.16}),thetaToVwcUserScale:t=>t*100,getVwcZone:()=>({label:'test'})});
vm.runInContext(extract('function normalizeIrrigations(', '\nfunction sameDay('),ctx);
const norm=raw=>JSON.parse(JSON.stringify(ctx.normalizeIrrigations(raw,garden)));
const expected=[{date:'2026-07-06',mm:2,liters:400}];
for(const input of [raw,expected,[{date:'2026-07-06',liters:'400'}],[{ts:Date.parse(raw[0].timestamp),amount:400}],[{dt:'2026-07-06',zones:[{liters:150},{liters:250}]}],[{date:'2026-07-06',mm:2}]])assert.deepEqual(norm(input),expected);
assert.deepEqual(norm(norm(raw)),expected,'normalizzazione idempotente');
assert.deepEqual(norm([null,{}, {date:'no',totalLiters:100},{date:'2026-06-30',mm:2},{date:'2026-07-06',mm:-1},{date:'2026-07-06',totalLiters:'NaN'}]),[]);
assert.equal(norm([{date:'2026-07-06',mm:3,totalLiters:400}])[0].mm,3,'mm espliciti preservati come in Oggi');
const wx={history:[{date:'2026-07-06',et0:3,precipitation_sum:0}]};
const balance=history=>JSON.parse(JSON.stringify(ctx.calcWaterBalance({wxData:wx,gardenData:{...garden,...(history===undefined?{}:{irrigationHistory:history})},soilData:[],persistTheta:false})));
const oggi=balance(raw);
assert.deepEqual(balance(expected),oggi,'chat/riepilogo normalizzati e Oggi grezzo hanno lo stesso bilancio');
assert.deepEqual(balance(undefined),oggi,'chiamanti senza storico esplicito usano lo stesso storico');
assert.notEqual(balance([]).layers.surface.theta,oggi.layers.surface.theta,'il test rileva un apporto idrico perso');
// Conservazione: più di 100 eventi recenti, stagione corrente e date illeggibili restano.
vm.runInContext(extract('const IRRIG_FLOW_LMIN=', '/* Centralina virtuale:'),Object.assign(ctx,{window:{dispatchEvent(){}},CustomEvent:class {}}));
const now=new Date();
data.set('dss_irrigation_history',[...Array.from({length:150},(_,id)=>({id,timestamp:now.toISOString()})),{id:'old',timestamp:'2000-01-01'},{id:'unknown',timestamp:'bad'}]);
ctx.appendIrrigationHistoryEntry({zonesDetail:[{liters:10}]});
assert.equal(data.get('dss_irrigation_history').length,152);
assert.ok(data.get('dss_irrigation_history').some(h=>h.id==='unknown'));
console.log('OK: normalizzazione, stesso bilancio da tutti i formati/percorsi, conservazione per età');
