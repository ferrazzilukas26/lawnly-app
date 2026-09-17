import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const extract=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
const plain=x=>JSON.parse(JSON.stringify(x));
const data=new Map();let allowWarnings=true;
const S={get:(k,d)=>structuredClone(data.get(k)??d),set:(k,v)=>data.set(k,plain(v))};
const window={dispatchEvent(){},__LAWNLY_CATALOG__:[{id:'fert',name:'Concime prato',type:'concime',npk:{n:20,k:5}}]};
class FixedDate extends Date{constructor(...args){super(...(args.length?args:['2026-09-13T12:00:00Z']));}static now(){return Date.parse('2026-09-13T12:00:00Z');}}
const ctx=vm.createContext({Date:FixedDate,S,window,CustomEvent:class{},confirm:()=>allowWarnings,alert(){}});
vm.runInContext(extract('const MONTH_NAME_TO_NUM=', 'function generateFallbackPlan('),ctx);
vm.runInContext(extract('function toBase(', '/* ── Adapter: shape nuovo catalogo'),ctx);
const seed={id:'plan',name:'Concime prato autunno',type:'trattamento',category:'concimazione',week:37,year:2026,status:'programmato',product:'Concime prato',finalProductId:'fert',doses:[{amount:2,unit:'kg'},{amount:500,unit:'g'}]};
const initialStock=[{id:'wh-fert',productId:'fert',name:'Concime prato',unit:'kg',packages:[{id:'bag',unit:'kg',original_qty:25,remaining_qty:25,added_date:'2026-01-01'}]}];
function reset(events=[seed],stock=initialStock){data.clear();S.set('dss_calendar_events',events);S.set('dss_warehouse_v2',stock);window.__LAWNLY_WX__=null;allowWarnings=true;}
const stock=()=>S.get('dss_warehouse_v2');
const calendar=()=>S.get('dss_calendar_events');
const comparable=()=>({events:calendar().map(({chatUndo,from_chat,...op})=>op),stock:stock()});
reset();assert.equal(ctx.applyCalendarOperation({...seed,status:'completato'}).ok,true);
const manual=comparable();assert.equal(stock()[0].packages[0].remaining_qty,22.5);
reset();const chat=ctx.applyChatCalendarOperation({name:seed.name,week:37,year:2026,status:'completato'});
assert.equal(chat.ok,true);assert.equal(chat.operation.id,'plan');
assert.deepEqual(comparable(),manual,'manuale e matching chat producono calendario e magazzino identici');
ctx.applyChatCalendarOperation({name:seed.name,week:37,year:2026,status:'completato'});
assert.equal(stock()[0].packages[0].remaining_qty,22.5,'conferma ripetuta non scarica due volte');
assert.equal(ctx.applyCalendarOperation({id:'plan'},{undo:true}).ok,true);
assert.equal(calendar()[0].status,'programmato');assert.deepEqual(stock(),initialStock);
assert.equal(S.get('dss_warehouse_log',[]).length,0);
reset([]);assert.equal(ctx.applyChatCalendarOperation({...seed,status:'completato'}).ok,true);
ctx.applyCalendarOperation({id:'plan'},{undo:true});assert.deepEqual(calendar(),[]);assert.deepEqual(stock(),initialStock);
// Il ripiego di conferma usa lo stesso ingresso e resta annullabile anche senza dosi.
reset([]);assert.equal(ctx.applyChatCalendarOperation({...seed,doses:[],status:'programmato'}).ok,true);
assert.deepEqual(stock(),initialStock);ctx.applyCalendarOperation({id:'plan'},{undo:true});assert.deepEqual(calendar(),[]);
const mechanical={id:'scarif',name:'Scarificatura',type:'meccanico',week:36,year:2026,status:'programmato'};
const blocked={id:'air',name:'Arieggiatura',type:'trattamento',week:37,year:2026,status:'completato'};
for(const apply of [ctx.applyCalendarOperation,ctx.applyChatCalendarOperation]){
 reset([mechanical]);const before=plain([...data]);const result=apply(blocked);
 assert.equal(result.ok,false);assert.match(result.reason,/21 giorni/);assert.deepEqual(plain([...data]),before,'rifiuto senza scritture o scarico');
 reset([]);window.__LAWNLY_WX__={todayData:{tmin:0,tmax:2}};
 assert.match(apply({...seed,status:'completato'}).reason,/GP:/,'stesso blocco stagionale anche per completamento chat');
 reset([{...seed,id:'nearby',week:36}]);allowWarnings=false;
 assert.match(apply({...seed,id:'another',name:'Altra concimazione',status:'programmato'}).reason,/non confermata/);
 reset([]);const bad=apply({...seed,status:'completato',doses:[{amount:1,unit:'kg'},{amount:1,unit:'L'}]});
 assert.equal(bad.ok,false);assert.deepEqual(stock(),initialStock);
}
reset([], [{...initialStock[0],unit:'conf',packages:[{id:'unknown',unit:'conf',remaining_qty:1}]}]);
const uncertain=ctx.applyChatCalendarOperation({...seed,status:'completato'});
assert.equal(uncertain.ok,true);assert.match(uncertain.operation.stockWarning,/incompatibili/);assert.equal(stock()[0].packages[0].remaining_qty,1);
// Rimozione manuale usa gli stessi dati di scarico dell'annullamento chat.
reset();ctx.applyCalendarOperation({...seed,status:'completato'});ctx.saveCalendarEvents([]);assert.deepEqual(stock(),initialStock);
assert.equal((source.match(/S\.set\('dss_calendar_events',/g)||[]).length,1,'un solo writer applicativo');
assert.ok(!extract('      if(calUpdateMatch){','      persistChat(upd);').includes('saveCalendarEvents('),'blocco e ripieghi chat non hanno un writer separato');
console.log('OK: parità manuale/chat, matching, rifiuti, conferme, scarico unico, annullamento e ripristino');
