// Il test importa questo modulo: le due variabili finte servono solo a far caricare _db.js.
// Merge di /api/state: una voce cancellata su un device non deve tornare dall'altro.
process.env.DATABASE_URL=process.env.DATABASE_URL||'postgres://test:test@localhost/test';
process.env.JWT_SECRET=process.env.JWT_SECRET||'test';
const { mergeState, mergeTombs } = await import('../api/state.js');
const ok=(c,m)=>{if(!c){console.error('FALLITO:',m);process.exit(1);}};
const ora=Date.now();

// server ha ancora la voce 2 (device B, stantio); il client l'ha cancellata e ha lasciato la lapide
const server={dss_irrigation_history:[{id:1,timestamp:'2026-09-10T06:30:00Z'},{id:2,timestamp:'2026-09-11T06:30:00Z'}]};
const client={dss_irrigation_history:[{id:1,timestamp:'2026-09-10T06:30:00Z'}],
              dss_tombstones:[{k:'dss_irrigation_history',id:'2',ts:ora}]};
const m=mergeState(server,client);
ok(m.dss_irrigation_history.length===1,'la voce cancellata e\' tornata: '+JSON.stringify(m.dss_irrigation_history));
ok(m.dss_irrigation_history[0].id===1,'e\' rimasta la voce sbagliata');

// senza lapide il comportamento di prima resta: unione (nessuna perdita accidentale)
const m2=mergeState(server,{dss_irrigation_history:[{id:1,timestamp:'2026-09-10T06:30:00Z'}]});
ok(m2.dss_irrigation_history.length===2,'senza lapide non deve cancellare nulla');

// record ri-modificato DOPO la cancellazione: vince la modifica
const m3=mergeState({dss_calendar_events:[{id:'a',updatedAt:new Date(ora+60000).toISOString()}]},
  {dss_calendar_events:[],dss_tombstones:[{k:'dss_calendar_events',id:'a',ts:ora}]});
ok(m3.dss_calendar_events.length===1,'una modifica successiva alla cancellazione deve sopravvivere');

// stesso id in liste diverse: le lapidi non si mangiano a vicenda
const t=mergeTombs([{k:'dss_calendar_events',id:'5',ts:ora}],[{k:'dss_warehouse_v2',id:'5',ts:ora}]);
ok(t.length===2,'lapidi con stesso id in chiavi diverse collassate: '+JSON.stringify(t));

// la lapide non deve cancellare la stessa chiave in un altro array
const m4=mergeState({dss_warehouse_v2:[{id:'5'}]},{dss_warehouse_v2:[{id:'5'}],
  dss_tombstones:[{k:'dss_calendar_events',id:'5',ts:ora}]});
ok(m4.dss_warehouse_v2.length===1,'lapide applicata alla chiave sbagliata');

// lapidi vecchie (oltre 90 giorni) si potano
const vecchie=mergeTombs([{k:'x',id:'1',ts:ora-100*864e5}],[]);
ok(vecchie.length===0,'le lapidi scadute restano');
console.log('OK: lapidi — cancellazione rispettata, unione preservata, chiavi separate, potatura');
