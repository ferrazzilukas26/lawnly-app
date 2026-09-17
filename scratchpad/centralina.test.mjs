#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';

process.env.TZ='Europe/Rome';
const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const temp=mkdtempSync(join(tmpdir(),'lawnly-controller-'));
try {
  let count=0;
  for(const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)){
    if(/\bsrc\s*=/.test(match[1])||!match[2].trim())continue;
    const type=match[1].match(/\btype\s*=\s*["']([^"']+)/i)?.[1];
    if(type&&!['module','text/javascript','application/javascript'].includes(type))continue;
    const file=join(temp,`script-${++count}.${type==='module'?'mjs':'cjs'}`);
    writeFileSync(file,match[2]);
    const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
  }
  console.log(`OK: node --check su ${count} blocchi script inline`);
} finally {rmSync(temp,{recursive:true,force:true});}

// Esegue la funzione reale e l'helper reale estratti dall'HTML, senza convertirlo in modulo.
const engine=source.slice(source.indexOf('const IRRIG_FLOW_LMIN='),source.indexOf('function soilEntrySideEffects(entry)'));
assert.ok(engine.includes('window.__LAWNLY_CTRL__=runControllerCatchup;'));
const NativeDate=Date;
let clock, onEvent;
const toasts=[];
class FakeDate extends NativeDate {
  constructor(...args){super(...(args.length?args:[clock]));}
  static now(){return new NativeDate(clock).getTime();}
}
const data=new Map();
const S={get:(key,fallback)=>structuredClone(data.has(key)?data.get(key):fallback),set:(key,value)=>data.set(key,structuredClone(value))};
const window={dispatchEvent(event){onEvent?.(event);}};
const ctx=vm.createContext({S,window,Date:FakeDate,showGlobalToast:message=>toasts.push(message),CustomEvent:class {constructor(type){this.type=type;}}});
vm.runInContext(engine,ctx);
const run=window.__LAWNLY_CTRL__;
const program=(patch={})=>({id:'p1',name:'Mattina',zones:['A','B'],days:[0,1,2,3,4,5,6],time:'06:30',minutes:20,...patch});
function reset({now='2026-07-06T08:00:00+02:00',lastRun='2026-07-06T00:00:00+02:00',programs=[program()],forecast=[{date:'2026-07-06',precipitation:0}],controller={},profile={}}={}){
  clock=now;onEvent=null;data.clear();toasts.length=0;
  S.set('dss_profile',{zones:[{id:'A',name:'Davanti'},{id:'B',name:'Dietro'}],flowRateLpm:10,controller:{on:true,rainSkipMm:5,lastRun,programs,...controller},...profile});
  window.__LAWNLY_WX__={forecast7:forecast};
}
const history=()=>S.get('dss_irrigation_history',[]);
const ctrl=()=>S.get('dss_profile').controller;

reset({programs:[program(),program({id:'future',time:'09:00'})]});
assert.equal(run().registered,1,'non registra occorrenze future');
assert.equal(history()[0].totalLiters,400);
assert.equal(history()[0].auto,true);
assert.equal(history()[0].note,'Centralina · Mattina');
assert.equal(history()[0].zones[1].id,'B');
assert.equal(run().registered,0,'doppia esecuzione idempotente');
assert.equal(history().length,1);
assert.equal(toasts.length,1,'nessun toast duplicato senza nuove irrigazioni');
assert.equal(toasts[0],'1 irrigazione registrata dalla centralina');
// Dedup anche con cursore arretrato e ledger assente (es. profilo da altro device).
S.set('dss_profile',{...S.get('dss_profile'),controller:{...ctrl(),lastRun:'2026-07-06T00:00:00+02:00',runs:[]}});
assert.equal(run().registered,0);
assert.equal(history().length,1);

reset({forecast:[{date:'2026-07-04',precipitation:0},{date:'2026-07-05',precipitation:0},{date:'2026-07-06',precipitation:5}]});
assert.equal(run().skipped,1,'soglia inclusiva e ricerca per data esatta');
assert.equal(history().length,0,'la pioggia non aggiunge acqua allo storico');
assert.equal(ctrl().runs[0].status,'skipped');
assert.equal(run().skipped,0);
reset({forecast:[{date:'2026-07-04',precipitation:50},{date:'2026-07-06',precipitation:0}]});
assert.equal(run().registered,1,'non usa forecast7[0]');

reset({now:'2026-07-07T00:30:00+02:00',lastRun:'2026-07-06T23:00:00+02:00',programs:[program({id:'yesterday',days:[1],time:'23:45'}),program({id:'today',days:[2],time:'00:15'}),program({id:'later',days:[2],time:'00:45'})],forecast:[{date:'2026-07-06',precipitation:9},{date:'2026-07-07',precipitation:0}]});
assert.equal(new FakeDate().getTimezoneOffset(),-120,'test realmente alle 00:30 CEST');
const midnight=run();assert.equal(midnight.registered,1);assert.equal(midnight.skipped,1);
assert.equal(history()[0].programId,'today');
assert.equal(history()[0].timestamp,'2026-07-06T22:15:00.000Z');
assert.equal(history()[0].date,'2026-07-07','data locale conservata');
assert.equal(run().registered,0);

reset({lastRun:'2026-06-01T00:00:00+02:00'});
assert.equal(run().registered,7,'recupero limitato a 7 giorni');
assert.equal(new Set(history().map(h=>h.id)).size,7,'ID diversi anche nello stesso millisecondo');
assert.ok(history().every(h=>Date.parse(h.timestamp)>=FakeDate.now()-7*864e5&&Date.parse(h.timestamp)<=FakeDate.now()));
reset({now:'2026-10-26T08:00:00+01:00',lastRun:'2026-10-24T00:00:00+02:00'});
assert.equal(run().registered,3,'giorni locali attraverso il ritorno all’ora solare');
assert.ok(history().every(h=>new NativeDate(h.timestamp).getHours()===6));

reset({forecast:[{date:'2026-07-06',precipitation:10}],controller:{forceRuns:[{programId:'p1',timestamp:'2026-07-06T04:30:00.000Z'}]}});
assert.equal(run().registered,1,'forzatura della sola occorrenza');
assert.equal(ctrl().forceRuns.length,0);
clock='2026-07-07T08:00:00+02:00';window.__LAWNLY_WX__.forecast7.push({date:'2026-07-07',precipitation:10});
assert.equal(run().skipped,1,'forzatura non permanente');

reset({controller:{on:false}});assert.equal(run().registered,0);assert.equal(history().length,0);
reset({programs:[]});assert.equal(run().registered,0);
reset({forecast:[]});assert.equal(run().pending,true);assert.equal(ctrl().lastRun,'2026-07-06T00:00:00+02:00');
window.__LAWNLY_WX__={forecast7:[{date:'2026-07-06',precipitation:0}]};assert.equal(run().registered,1);
reset({profile:{flowRateLpm:0}});run();assert.equal(history()[0].totalLiters,0,'nullish flow conserva zero');
reset();onEvent=event=>{if(event.type==='lawnly:irrigation-changed'){const fresh=S.get('dss_profile');S.set('dss_profile',{...fresh,zones:[...fresh.zones,{id:'C',name:'Nuova'}],gardenName:'Aggiornato'});}};
run();assert.equal(S.get('dss_profile').zones.length,3,'non sovrascrive il profilo con una copia stantia');assert.equal(S.get('dss_profile').gardenName,'Aggiornato');onEvent=null;

// Le vere azioni Oggi modificano e cancellano una sessione auto multi-zona.
reset({programs:[program(),program({id:'p2'})]});run();
ctx.prof=S.get('dss_profile');ctx.editIrr=history()[0];ctx.editMin='30';
ctx.setEditIrr=()=>{};ctx.setHistTick=()=>{};
const editSource=source.match(/  const saveIrrEdit=\(\)=>\{[^\n]+/)[0];
vm.runInContext(editSource+'\nsaveIrrEdit();',ctx);
assert.equal(history()[0].totalLiters,600);assert.equal(history()[0].zones.length,2);
assert.equal(history()[0].auto,true);assert.equal(history()[0].programId,'p2');
const deleteSource=source.match(/  const delIrr=\(id\)=>\{[^\n]+/)[0];
vm.runInContext(deleteSource+'\ndelIrr(editIrr.id);',ctx);
assert.equal(history().length,1,'cancella soltanto la sessione selezionata');assert.equal(history()[0].programId,'p1');
assert.equal(run().registered,0,'non ricrea irrigazioni cancellate');
S.set('dss_profile',{...S.get('dss_profile'),controller:{...ctrl(),lastRun:'2026-07-06T00:00:00+02:00'}});
assert.equal(run().registered,0,'ledger protegge le cancellazioni anche con lastRun arretrato');
console.log('OK: futuro, dedup, pioggia, mezzanotte CEST, 7 giorni, DST, override, storage fresco, modifica e cancellazione');

// Cadenze locali: ignora days, non anticipa anchor, attraversa mese/anno e DST.
const scheduleCases=[
  {repeat:'every2',anchor:'2026-01-29',lastRun:'2026-01-28T00:00:00+01:00',now:'2026-02-04T08:00:00+01:00',dates:['2026-01-29','2026-01-31','2026-02-02','2026-02-04']},
  {repeat:'every3',anchor:'2025-12-28',lastRun:'2025-12-28T00:00:00+01:00',now:'2026-01-03T08:00:00+01:00',dates:['2025-12-28','2025-12-31','2026-01-03']},
  {repeat:'every2',anchor:'2026-03-27',lastRun:'2026-03-27T00:00:00+01:00',now:'2026-04-02T08:00:00+02:00',dates:['2026-03-27','2026-03-29','2026-03-31','2026-04-02']},
  {repeat:'every3',anchor:'2026-03-27',lastRun:'2026-03-27T00:00:00+01:00',now:'2026-04-02T08:00:00+02:00',dates:['2026-03-27','2026-03-30','2026-04-02']},
  {repeat:'every2',anchor:'2026-10-23',lastRun:'2026-10-23T00:00:00+02:00',now:'2026-10-29T08:00:00+01:00',dates:['2026-10-23','2026-10-25','2026-10-27','2026-10-29']},
  {repeat:'every3',anchor:'2026-10-23',lastRun:'2026-10-23T00:00:00+02:00',now:'2026-10-29T08:00:00+01:00',dates:['2026-10-23','2026-10-26','2026-10-29']},
];
for(const c of scheduleCases){
  reset({...c,programs:[program({repeat:c.repeat,anchor:c.anchor,days:[]})]});
  assert.equal(run().registered,c.dates.length,c.repeat+' '+c.anchor);
  assert.deepEqual(history().map(h=>h.date).sort(),c.dates);
  assert.ok(history().every(h=>new NativeDate(h.timestamp).getHours()===6&&new NativeDate(h.timestamp).getMinutes()===30),'06:30 sempre locale');
  assert.ok(history().every(h=>h.id==='controller:'+h.programId+':'+h.timestamp),'formato ID invariato');
  assert.equal(run().registered,0,'nessun doppione con cadenza '+c.repeat);
  assert.equal(history().length,c.dates.length);
  const next=ctx.nextControllerRun(ctrl(),new NativeDate(c.now));
  const expected=new NativeDate(c.now);expected.setDate(expected.getDate()+(c.repeat==='every2'?2:3));expected.setHours(6,30,0,0);
  assert.equal(next.at.toISOString(),expected.toISOString(),'next e catchup seguono la stessa cadenza');
}
reset({programs:[program({days:[1,3,5]})],lastRun:'2026-07-01T00:00:00+02:00'});
run();const legacyDates=history().map(h=>h.timestamp);
assert.equal('repeat' in ctrl().programs[0],false,'nessuna migrazione in scrittura');
assert.equal('anchor' in ctrl().programs[0],false);
reset({programs:[program({days:[1,3,5],repeat:'days',anchor:'2026-07-06'})],lastRun:'2026-07-01T00:00:00+02:00'});
run();assert.deepEqual(history().map(h=>h.timestamp),legacyDates,'default days esattamente retrocompatibile');
for(const repeat of ['every2','every3']){
  reset({programs:[program({repeat,anchor:'2026-07-06',days:[]})],forecast:[{date:'2026-07-06',precipitation:5}]});
  assert.equal(run().skipped,1,'pioggia uguale alla soglia, '+repeat);assert.equal(history().length,0);
  assert.equal(run().skipped,0,'salto pioggia deduplicato');
}

const summaryAt=new NativeDate('2026-07-06T00:00:00+02:00');
const summaryPrograms=[program({days:[1,3,5],zones:['A','B','A']}),program({id:'p2',repeat:'every2',anchor:'2026-07-06',days:[],zones:['B'],minutes:10}),program({id:'p3',repeat:'every3',anchor:'2026-07-06',days:[],zones:['A'],minutes:30})];
const sum=ctx.controllerSummary(summaryPrograms,10,summaryAt);
assert.equal(sum.cyclesPerWeek,10,'3 + 4 + 3 esecuzioni nei prossimi sette giorni');
assert.equal(sum.litersPerWeek,2500,'zone distinte: 3*400 + 4*100 + 3*300');
assert.equal(sum.litersPerCycle,250,'media pesata per esecuzione');
assert.equal(ctx.controllerSummary(summaryPrograms,0,summaryAt).litersPerWeek,0,'portata zero conservata');
assert.equal(ctx.controllerSummary([program({days:[1],zones:['A']})],undefined,summaryAt).litersPerWeek,160,'fallback IRRIG_FLOW_LMIN');
assert.equal(ctx.controllerSummary([],10,summaryAt).litersPerCycle,0,'riepilogo vuoto senza NaN');
for(const c of scheduleCases.filter(c=>c.anchor.includes('03-27')||c.anchor.includes('10-23'))){
  const at=new NativeDate(c.lastRun), p=program({repeat:c.repeat,anchor:c.anchor,days:[]});
  assert.equal(ctx.controllerSummary([p],10,at).cyclesPerWeek,c.dates.length,'settimana di calendario attraverso DST');
}
reset();ctx.toggleController();assert.equal(history().length,1,'toggle recupera prima dello spegnimento');assert.equal(ctrl().on,false);
clock='2026-07-07T08:00:00+02:00';ctx.toggleController();assert.equal(ctrl().on,true);assert.equal(run().registered,0,'riaccensione non recupera il periodo spento');
console.log('OK: every2/every3, cambio mese/anno, DST primaverile/autunnale, next, default senza migrazione, litri e toggle condiviso');

// Esegue le azioni vere del componente con hook minimi, senza dipendenze DOM.
const component=source.slice(source.indexOf('function Centralina('),source.indexOf('\nfunction Profilo2('));
const actions=component.slice(0,component.indexOf('  return html`<section'))+'  return {edit,save,remove,saveController};\n}';
let hookValues=[], hookIndex=0;
ctx.useState=initial=>{const i=hookIndex++;if(!(i in hookValues))hookValues[i]=initial;return [hookValues[i],value=>{hookValues[i]=typeof value==='function'?value(hookValues[i]):value;}];};
ctx.useEffect=()=>{};
vm.runInContext(actions,ctx);
const renderActions=()=>{hookIndex=0;return ctx.Centralina({wx:window.__LAWNLY_WX__,editor:true});};
const submit={preventDefault(){}};
reset();hookValues=[];
renderActions().edit(null);
assert.equal(hookValues[1].repeat,'days');assert.equal(hookValues[1].anchor,'2026-07-06');
hookValues[1]={...hookValues[1],name:'  Alternata  ',repeat:'every2',days:[]};
renderActions().save(submit);
assert.equal(ctrl().programs[1].name,'Alternata');assert.equal(ctrl().programs[1].repeat,'every2');assert.equal(ctrl().programs[1].anchor,'2026-07-06');
assert.equal(hookValues[1],null,'editor chiuso dopo salvataggio');
renderActions().edit(ctrl().programs[0]);hookValues[1]={...hookValues[1],days:[]};
renderActions().save(submit);assert.ok(hookValues[2],'giorni obbligatori per days');assert.equal(ctrl().programs[0].days.length,7);
hookValues[1]={...hookValues[1],days:[1],minutes:0};renderActions().save(submit);assert.equal(ctrl().programs[0].minutes,20,'validazione minuti invariata');
hookValues[1]={...hookValues[1],minutes:20,zones:['inesistente']};renderActions().save(submit);assert.deepEqual(ctrl().programs[0].zones,['A','B'],'validazione zona invariata');
reset();hookValues=[];renderActions();hookValues[3]={p1:{repeat:'every3',days:[],anchor:'2026-07-06'}};
assert.equal(ctrl().programs[0].repeat,undefined,'selezioni attendono Salva centralina');
renderActions().saveController();assert.equal(history().length,1,'prima di applicare la modifica recupera col programma precedente');
assert.equal(ctrl().programs[0].repeat,'every3');assert.equal(hookValues[2],'');
hookValues[3]={p1:{repeat:'days',days:[]}};renderActions().saveController();assert.equal(ctrl().programs[0].repeat,'every3','impedisce giorni scelti vuoti');
reset({programs:Array.from({length:8},(_,i)=>program({id:'p'+i}))});hookValues=[];
renderActions().edit(null);assert.equal(hookValues[1],null,'limite otto anche su edit(null)');
// Concorrenza: la nona aggiunta deve essere respinta anche se il form era già aperto.
hookValues[1]=program({id:'ninth',repeat:'days',anchor:'2026-07-06'});renderActions().save(submit);
assert.equal(ctrl().programs.length,8);assert.match(hookValues[2],/8 programmi/);
reset({controller:{forceRuns:[{programId:'p1',timestamp:'2026-07-07T04:30:00.000Z'}]}});hookValues=[];
renderActions().remove('p1');assert.equal(ctrl().programs.length,0);assert.equal(ctrl().forceRuns.length,0);
console.log('OK: azioni editor, salvataggio differito, validazione giorni/zone/minuti, limite 8 e rimozione forceRuns');

// Il controllo appartiene alla card irrigazione, non ad altre card con la stessa chevron.
const oggi=source.slice(source.indexOf('function Oggi('),source.indexOf('/* ===== fine Sezione OGGI'));
const irrigationCard=oggi.slice(oggi.indexOf("<div class=${'card verdict '"),oggi.indexOf('<div class="card next-card'));
assert.ok(irrigationCard.includes('class="virr-right"'));
assert.ok(irrigationCard.includes('e.stopPropagation();toggleController();'));
assert.ok(irrigationCard.includes('role="switch" aria-checked=${!!controller.on} aria-label="Centralina virtuale"'));
assert.equal(oggi.split('class="virr-right"').length-1,1);
assert.ok(!oggi.includes('<${Centralina} wx=${wx} setPg=${setPg}/>'));
assert.ok(oggi.includes("if(id==='sh-irrig')setIrrigTab('um')"));
console.log('OK: interruttore nella card irrigazione, accessibilità, reset tab e rimozione della vecchia card');
