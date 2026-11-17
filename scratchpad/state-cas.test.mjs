// Salvataggi ripetuti su /api/state: il secondo e i successivi devono passare (prima: 409 per precisione µs).
const O = process.argv[2]; const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok', m); };
const j = r => r.json();
const su = await j(await fetch(O + '/api/auth', { method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': '198.51.100.' + (Date.now() % 250) }, body: JSON.stringify({ action: 'signup', email: `cas-${Date.now()}@example.invalid`, password: 'provaprova123' }) }));
const H = { authorization: 'Bearer ' + su.token, 'content-type': 'application/json' };
const put = (data, base) => fetch(O + '/api/state', { method: 'PUT', headers: H, body: JSON.stringify({ data, baseUpdatedAt: base }) });
let r = await put({ n: 1 }); ok(r.status === 200, 'primo salvataggio'); let base = (await j(r)).updatedAt;
for (let i = 2; i <= 4; i++) { r = await put({ n: i }, base); ok(r.status === 200, `salvataggio ${i} (stato ${r.status})`); if (r.ok) base = (await j(r)).updatedAt; }
const g = await j(await fetch(O + '/api/state', { headers: H })); ok(g.data?.n === 4, 'dato finale = 4');
const par = await Promise.all([put({ a: 1 }, base), put({ b: 2 }, base)]); ok(par.every(x => x.status === 200), 'due salvataggi paralleli ' + par.map(x => x.status));
const g2 = await j(await fetch(O + '/api/state', { headers: H })); ok(g2.data?.a === 1 && g2.data?.b === 2, 'parallelo: nessuno perso ' + JSON.stringify(g2.data));
