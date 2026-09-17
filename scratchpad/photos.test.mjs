import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const photo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL1sAAAAASUVORK5CYII=';
let token='A',calls=[],fail=false,quota=false,beforeResponse;
const state=new Map();
const ctx=vm.createContext({console,Blob,Uint8Array,atob,
  _lwToken:()=>token,_lwSession:()=>({access_token:token,user:{id:token}}),_lwLastSyncedAt:null,
  S:{get:(k,d)=>structuredClone(state.get(k)??d)},
  localStorage:{setItem(k,v){if(quota)throw new Error('QuotaExceededError');state.set(k,JSON.parse(v));}},
  window:{dispatchEvent(){}},CustomEvent:class {},
  FileReader:class {readAsDataURL(){this.result=photo;queueMicrotask(()=>this.onload());}},
  fetch:async(url,opts)=>{calls.push({url,...opts});beforeResponse?.();return {ok:!fail,status:503,json:async()=>fail?{error:{message:'offline'}}:{id:'remote-1'},blob:async()=>new Blob()};}
});
vm.runInContext(source.slice(source.indexOf('const _zonePhotoCache='),source.indexOf('function useZonePhotoRefresh()')),ctx);
const legacy={id:7,b64:photo,dt:'2026-07-01',name:'prato.png',aiAnalysis:{score:80}};
assert.equal(await ctx.readZonePhoto(legacy),photo);
assert.equal(calls.length,0,'foto vecchia leggibile offline senza richieste');
assert.equal(await ctx.readZonePhoto({...legacy,b64:photo.split(',')[1],mediaType:'image/png'}),photo);
state.set('dss_zone_photos',{A:[legacy]});
const migrated=await ctx.prepareZonePhotos({A:[legacy]});
assert.equal(migrated.A[0].remoteId,'remote-1');
assert.ok(!JSON.stringify(migrated).includes('base64'));
assert.ok(!('b64' in migrated.A[0]));
assert.deepEqual(state.get('dss_zone_photos').A[0],{id:7,dt:legacy.dt,name:legacy.name,aiAnalysis:legacy.aiAnalysis,remoteId:'remote-1'});
assert.equal(JSON.parse(calls[0].body).b64,photo);
assert.equal(calls[0].headers.Authorization,'Bearer A');
assert.equal(await ctx.readZonePhoto(migrated.A[0]),photo);
assert.equal(calls.length,1,'lettura dalla cache dopo upload');
vm.runInContext('_zonePhotoCache.clear()',ctx);
await Promise.all([ctx.readZonePhoto(migrated.A[0]),ctx.readZonePhoto(migrated.A[0])]);
assert.equal(calls.length,2,'GET deduplicata, byte caricati su richiesta');
assert.equal(calls[1].method,'GET');
assert.ok(calls[1].url.endsWith('?id=remote-1'));
state.set('dss_zone_photos',{A:[legacy]});fail=true;
await assert.rejects(()=>ctx.prepareZonePhotos({A:[legacy]}),/offline/);
assert.equal(state.get('dss_zone_photos').A[0].b64,photo,'upload fallito conserva legacy');
fail=false;quota=true;
await assert.rejects(()=>ctx.prepareZonePhotos({A:[legacy]}),/Quota/);
assert.equal(state.get('dss_zone_photos').A[0].b64,photo,'quota non nasconde perdita dati');
quota=false;beforeResponse=()=>{token='B';};
await assert.rejects(()=>ctx.prepareZonePhotos({A:[legacy]}),/Sessione cambiata/);
assert.equal(state.get('dss_zone_photos').A[0].b64,photo);
beforeResponse=undefined;token='A';
// Una modifica concorrente all'analisi non deve essere sovrascritta dalla migrazione.
beforeResponse=()=>state.set('dss_zone_photos',{A:[{...legacy,aiAnalysis:{score:90}}]});
await ctx.prepareZonePhotos({A:[legacy]});
assert.equal(state.get('dss_zone_photos').A[0].aiAnalysis.score,90);
beforeResponse=()=>state.set('dss_zone_photos',{A:[]});
await ctx.prepareZonePhotos({A:[legacy]});
assert.equal(state.get('dss_zone_photos').A.length,0,'migrazione non resuscita eliminazione locale');

beforeResponse=undefined;calls=[];
vm.runInContext(source.slice(source.indexOf('async function _lwPutState('),source.indexOf('/* Snapshot dello stato locale')),ctx);
await ctx._lwPutState('A',{profile:{totalArea:100},dss_zone_photos:{A:[legacy]}});
const outgoing=JSON.parse(calls.find(c=>c.url.endsWith('/api/state')).body);
assert.equal(outgoing.data.profile.totalArea,100);
assert.equal(outgoing.data.dss_zone_photos.A[0].remoteId,'remote-1');
assert.ok(!JSON.stringify(outgoing).includes('base64'),'PUT reale del blob senza byte foto');
assert.ok(!('b64' in outgoing.data.dss_zone_photos.A[0]));

// Endpoint reale, solo SQL/auth sostituiti: isolamento utenti, MIME, limiti e cache privata.
const rows=new Map();
const sql=async(strings,...values)=>{
  const q=strings.join('?');
  if(q.includes('create table')||q.includes('select id from users'))return [];
  if(q.includes('insert into lawnly_zone_photos')){rows.set(values[0],{user:values[1],data:values[3]});return [];}
  if(q.includes('delete from lawnly_zone_photos')){if(rows.get(values[0])?.user===values[1])rows.delete(values[0]);return [];}
  if(q.includes('select data from lawnly_zone_photos')){const row=rows.get(values[0]);return row?.user===values[1]?[row]:[];}
  throw new Error(q);
};
sql.transaction=queries=>Promise.all(queries);
const api=vm.createContext({crypto,Buffer,sql,cors:()=>false,authUser:async req=>req.user?{uid:req.user}:null,readBody:async req=>req.body});
const endpoint=readFileSync(new URL('../api/photo.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export default async function handler','async function handler');
vm.runInContext(endpoint,api);
async function request(method,{user='A',body, id,headers={}}={}){
  const res={code:0,headers:{},setHeader(k,v){this.headers[k]=v;},getHeader(k){return this.headers[k];},status(c){this.code=c;return this;},json(v){this.body=v;return this;},send(v){this.body=v;return this;}};
  await api.handler({method,user,body,query:{id},headers},res);return res;
}
assert.equal((await request('POST',{user:null})).code,401);
assert.equal((await request('POST',{body:{zoneId:'A',b64:'data:text/html;base64,PGgxPng='}})).code,400);
assert.equal((await request('POST',{body:{zoneId:'A',b64:'data:image/png;base64,PGgxPng='}})).code,400);
assert.equal((await request('POST',{body:{zoneId:'A',b64:'x'.repeat(2500001)}})).code,413);
assert.equal((await request('POST',{headers:{'content-length':'2500001'}})).code,413);
const posted=await request('POST',{body:{zoneId:'A',b64:photo}});
assert.equal(posted.code,200);const id=posted.body.id;
const get=await request('GET',{id});
assert.equal(get.code,200);assert.equal(get.headers['Content-Type'],'image/png');
assert.equal(get.headers['Cache-Control'],'private, max-age=31536000');
assert.equal(get.body.toString('base64'),photo.split(',')[1]);
assert.equal((await request('GET',{id,user:'B'})).code,404);
await request('DELETE',{id,user:'B'});
assert.equal((await request('GET',{id})).code,200);
await request('DELETE',{id});
assert.equal((await request('GET',{id})).code,404);
console.log('OK: metadata, legacy, cache lazy, errori/quota/sessione, migrazione concorrente, endpoint privato e limiti');
