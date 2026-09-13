// Lawnly per-user state — Vercel Function. One JSONB blob per user in Neon `app_state`.
//   GET   (Bearer token)                          -> { data: <blob>|null, updatedAt }
//   PUT   (Bearer token) { data, baseUpdatedAt? }  -> { ok:true, updatedAt, merged?, data? }
//
// G3 — MERGE PER-RECORD (stile IALC): se il server è cambiato dopo il `baseUpdatedAt` del client
// (= un altro device/tab ha scritto nel frattempo), invece di sovrascrivere il blob intero
// (last-write-wins → clobber), il server FONDE lo stato client con quello corrente:
//   - array di record con `id`  → unione per id (vince il record con stato terminale / più recente)
//   - array senza id (log)      → unione per valore (preserva append da entrambi i device)
//   - oggetti (mappe)           → merge shallow per chiave (client vince sulla foglia)
//   - scalari / nuove chiavi     → client
// Così edit su chiavi/record diversi da device diversi non si cancellano a vicenda.
import { cors, sql, readBody, authUser } from './_db.js';

const TERMINAL = new Set(['done', 'completato', 'confirmed', 'saltato', 'saltata', 'eseguita']);

function stateRank(o) {
  if (!o || typeof o !== 'object') return 0;
  const s = (o.status || '').toLowerCase();
  return (TERMINAL.has(s) || o.confirmed === true || o.done === true) ? 1 : 0;
}

// recency basata SOLO su campi di edit (non su `date`/scheduling — quello è futuro e falserebbe)
function recencyOf(o) {
  if (!o || typeof o !== 'object') return 0;
  const keys = ['updatedAt', 'updated_at', 'doneAt', 'completed_date', 'completedDate', 'ts', 'timestamp', 'savedAt'];
  let m = 0;
  for (const k of keys) {
    const v = o[k];
    if (v) { const t = new Date(v).getTime(); if (!isNaN(t)) m = Math.max(m, t); }
  }
  return m;
}

// Lapidi: { k: chiave, id, ts }. Un record cancellato su un device e' semplicemente assente
// nel suo array, quindi l'unione per id lo farebbe tornare dall'altro device. Con la lapide
// l'assenza diventa esplicita: l'id sparisce, a meno che il record sia stato ri-modificato
// DOPO la cancellazione (allora vince la modifica piu' recente).
function tombMap(...states) {
  const m = new Map();
  for (const st of states) {
    const list = st && Array.isArray(st.dss_tombstones) ? st.dss_tombstones : [];
    for (const t of list) {
      if (!t || t.id == null || !t.k) continue;
      const key = t.k + '|' + String(t.id);
      const ts = Number(t.ts) || 0;
      if (ts > (m.get(key) || 0)) m.set(key, ts);
    }
  }
  return m;
}

// Le lapidi si uniscono per coppia (chiave, id) tenendo la piu' recente: l'id da solo non
// basta, lo stesso id puo' esistere in liste diverse.
function mergeTombs(a, b) {
  const m = new Map();
  for (const t of [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]) {
    if (!t || t.id == null || !t.k) continue;
    const k = t.k + '|' + String(t.id);
    const prev = m.get(k);
    if (!prev || (Number(t.ts) || 0) > (Number(prev.ts) || 0)) m.set(k, t);
  }
  const cut = Date.now() - 90 * 864e5;
  return [...m.values()].filter(t => (Number(t.ts) || 0) > cut).slice(-300);
}

function mergeArray(serverArr, clientArr, tombs, key) {
  const sv = Array.isArray(serverArr) ? serverArr : [];
  const cv = Array.isArray(clientArr) ? clientArr : [];
  const all = [...sv, ...cv];
  const allHaveId = all.length > 0 && all.every(x => x && typeof x === 'object' && x.id != null);
  if (!allHaveId) {
    // log / array senza id → unione dedup per JSON (non perde gli append di nessun device)
    const seen = new Set(); const out = [];
    for (const x of all) { const k = JSON.stringify(x); if (!seen.has(k)) { seen.add(k); out.push(x); } }
    return out;
  }
  const byId = new Map();
  for (const x of sv) byId.set(String(x.id), x);
  for (const x of cv) {
    const k = String(x.id);
    const ex = byId.get(k);
    if (!ex) { byId.set(k, x); continue; }
    // stesso id su entrambi: vince lo stato terminale, poi la recency, altrimenti il client
    let winner;
    if (stateRank(x) !== stateRank(ex)) winner = stateRank(x) > stateRank(ex) ? x : ex;
    else winner = recencyOf(x) >= recencyOf(ex) ? x : ex;
    byId.set(k, winner);
  }
  const out = [...byId.values()];
  if (!tombs || !tombs.size) return out;
  return out.filter(x => {
    const ts = tombs.get(key + '|' + String(x.id));
    if (!ts) return true;
    return recencyOf(x) > ts; // modificato dopo la cancellazione: il record resta
  });
}

function mergeState(server, client) {
  const s = (server && typeof server === 'object') ? server : {};
  const c = (client && typeof client === 'object') ? client : {};
  const out = { ...s };
  const tombs = tombMap(s, c);
  for (const k of Object.keys(c)) {
    const cv = c[k], svv = s[k];
    if (k === 'dss_tombstones') { out[k] = mergeTombs(svv, cv); continue; }
    if (Array.isArray(cv) || Array.isArray(svv)) {
      out[k] = mergeArray(svv, cv, tombs, k);
    } else if (cv && svv && typeof cv === 'object' && typeof svv === 'object') {
      out[k] = { ...svv, ...cv }; // mappe (foto, meta, help flags, profile): client vince per chiave
    } else {
      out[k] = cv; // scalare / nuova chiave
    }
  }
  return out;
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  const payload = await authUser(req);
  if (!payload) { res.status(401).json({ error: { message: 'unauthorized' } }); return; }
  const uid = payload.uid;

  try {
    if (req.method === 'GET') {
      const rows = await sql`select data, updated_at from app_state where user_id = ${uid}`;
      res.status(200).json({
        data: rows.length ? rows[0].data : null,
        updatedAt: rows.length ? rows[0].updated_at : null
      });
      return;
    }
    if (req.method === 'PUT' || req.method === 'POST') {
      const body = await readBody(req);
      const data = body && body.data !== undefined ? body.data : {};
      const baseUpdatedAt = body && body.baseUpdatedAt ? new Date(body.baseUpdatedAt) : null;

      // Scrittura compare-and-set: leggere e poi scrivere in due passaggi lascia passare
      // due PUT paralleli (due tab, o un retry che rientra) e l'ultimo cancella l'altro.
      // Qui si scrive solo se updated_at è ancora quello letto; altrimenti si rifonde e si riprova.
      let finalData = data;
      let merged = false;
      let saved = null;

      for (let attempt = 0; attempt < 4 && !saved; attempt++) {
        const cur = await sql`select data, updated_at from app_state where user_id = ${uid}`;

        if (!cur.length) {
          const ins = await sql`
            insert into app_state (user_id, data, updated_at)
            values (${uid}, ${JSON.stringify(finalData)}::jsonb, now())
            on conflict (user_id) do nothing
            returning updated_at`;
          if (ins.length) { saved = ins[0].updated_at; break; }
          continue; // qualcuno ha inserito nel frattempo: rileggi e fondi
        }

        const serverUpdatedAt = new Date(cur[0].updated_at);
        // conflitto: il server è cambiato dopo il base del client (margine 1s per jitter)
        const changedSinceBase = !baseUpdatedAt || serverUpdatedAt.getTime() > baseUpdatedAt.getTime() + 1000;
        if (changedSinceBase) {
          finalData = mergeState(cur[0].data || {}, data);
          merged = true;
        } else {
          finalData = data;
        }

        const upd = await sql`
          update app_state set data = ${JSON.stringify(finalData)}::jsonb, updated_at = now()
          where user_id = ${uid} and updated_at = ${cur[0].updated_at}
          returning updated_at`;
        if (upd.length) saved = upd[0].updated_at;
        // 0 righe = un'altra scrittura è passata in mezzo: si rilegge e si rifonde
      }

      if (!saved) { res.status(409).json({ error: { message: 'conflitto di scrittura, riprova' } }); return; }

      res.status(200).json({
        ok: true,
        merged,
        updatedAt: saved,
        // ritorna il blob fuso SOLO in caso di merge, così il client adotta lo stato riconciliato
        data: merged ? finalData : undefined
      });
      return;
    }
    res.status(405).json({ error: { message: 'method not allowed' } });
  } catch (e) {
    // 23503 = utente non più esistente (account eliminato con un token ancora in giro): è un 401, non un guasto
    res.status(e.code === '23503' ? 401 : 500).json({ error: { message: e.code === '23503' ? 'unauthorized' : e.message } });
  }
}

export { mergeState, mergeTombs }; // esportati per il test in scratchpad/merge.test.mjs
