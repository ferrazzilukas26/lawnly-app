// Applica a productCatalog.js i risultati scratchpad/audit/result-*.json (confezioni e dosi da fonti ufficiali).
// Unione prudente: le confezioni gia' nel catalogo restano; quelle trovate in piu' si aggiungono con verified:true e la fonte;
// una confezione non verificata gia' presente e riconfermata diventa verified:true. La dose si scrive SOLO se manca nel catalogo.
// Uso: node apply-audit.mjs [--dry]
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const dir = new URL('audit/', import.meta.url);
const modUrl = new URL('productCatalog.js', root);
let text = readFileSync(modUrl, 'utf8');
const dry = process.argv.includes('--dry');
const { PRODUCT_CATALOG } = await import(modUrl.href + '?t=' + Date.now());
const byId = new Map(PRODUCT_CATALOG.map(p => [p.id, p]));
const retail = f => !(/tank|cisterna|big ?bag|bancale|pallet/i.test(f.label || '') || (['kg', 'L'].includes(f.unit) && f.size >= 500));
const same = (a, b) => a.unit === b.unit && Math.abs(a.size - b.size) < 1e-9;
const DOSE_UNITS = ['g/m2', 'g/1000m2', 'kg/1000m2', 'kg/ha', 'L/ha', 'ml/m2', 'ml/100m2', 'ml/1000m2'];
const normUnit = u => {
  const x = String(u || '').replace('m²', 'm2').replace(/\s+/g, '');
  return DOSE_UNITS.find(d => d.toLowerCase() === x.toLowerCase()) || x;
};

function objRange(id) {
  const m = new RegExp(`["']?id["']?:\\s*"${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).exec(text);
  if (!m) return null;
  const k = m.index;
  let s = k; while (text[s] !== '{') s--;
  let d = 0, e = s;
  for (; e < text.length; e++) { const c = text[e]; if (c === '{') d++; else if (c === '}') { d--; if (d === 0) break; } }
  return [s, e + 1];
}
function matchBracket(str, open) {
  let d = 0; for (let i = open; i < str.length; i++) { if (str[i] === '[') d++; else if (str[i] === ']') { d--; if (d === 0) return i; } } return -1;
}
const q = s => JSON.stringify(s);
const fmtJson = f => JSON.stringify({ sku: f.sku, size: f.size, unit: f.unit, label: f.label, verified: f.verified, ...(f.source ? { source: f.source } : {}) });
const fmtLiteral = f => `{ sku: ${q(f.sku)}, size: ${f.size}, unit: ${q(f.unit)}, label: ${q(f.label)}, verified: ${f.verified}${f.source ? `, source: ${q(f.source)}` : ''} }`;

const log = { formatsAdded: 0, formatsVerified: 0, dosesAdded: 0, productsTouched: 0, skipped: [] };
for (const fn of readdirSync(dir).filter(n => n.startsWith('result-'))) {
  const res = JSON.parse(readFileSync(new URL(fn, dir), 'utf8'));
  for (const r of res.products) {
    const p = byId.get(r.id);
    if (!p) { log.skipped.push(`${r.id}: id sconosciuto`); continue; }
    const rng = objRange(r.id); if (!rng) { log.skipped.push(`${r.id}: oggetto non trovato`); continue; }
    let obj = text.slice(rng[0], rng[1]); let changed = false;
    const found = (r.formats || []).filter(retail).filter(f => f.size > 0 && ['kg', 'g', 'L', 'ml'].includes(f.unit));
    const cls = u => (u === 'kg' || u === 'g') ? 'massa' : 'volume';
    const exCls = new Set((p.formats || []).map(f => cls(f.unit)));
    const conflict = found.length && exCls.size && found.some(f => !exCls.has(cls(f.unit)));
    if (conflict) { log.skipped.push(`${r.id}: DISCREPANZA massa/volume tra catalogo (${[...exCls]}) e fonte: da verificare a mano`); }
    if (!conflict && r.status !== 'non_trovato' && found.length) {
      const cur = (p.formats || []).map(f => ({ ...f }));
      let fchanged = false;
      for (const f of found) {
        const hit = cur.find(c => same(c, f));
        if (hit) { if (!hit.verified) { hit.verified = true; hit.source = f.source; log.formatsVerified++; fchanged = true; } }
        else { cur.push({ sku: `${r.id}-${String(f.size).replace('.', '_')}${f.unit.toLowerCase()}`, size: f.size, unit: f.unit, label: f.label, verified: true, source: f.source }); log.formatsAdded++; fchanged = true; }
      }
      if (fchanged) {
        cur.sort((a, b) => (a.unit === b.unit ? a.size - b.size : 0));
        const jsonStyle = /"id"\s*:/.test(obj);
        const at = obj.search(/["']?formats["']?\s*:/);
        const lit = '[\n      ' + cur.map(jsonStyle ? fmtJson : fmtLiteral).join(',\n      ') + '\n    ]';
        if (at >= 0) { const o = obj.indexOf('[', at); const c = matchBracket(obj, o); obj = obj.slice(0, o) + lit + obj.slice(c + 1); }
        else { const close = obj.lastIndexOf('}'); obj = obj.slice(0, close).replace(/,?\s*$/, ',') + `\n    ${jsonStyle ? '"formats"' : 'formats'}: ${lit}\n  }`; }
        changed = true;
      }
    }
    if (!p.dose && r.dose && (r.dose.max > 0 || r.dose.min > 0) && !DOSE_UNITS.includes(normUnit(r.dose.unit))) log.skipped.push(`${r.id}: dose non scritta, unita' non scalabile (${r.dose.unit})`);
    else if (!p.dose && r.dose && (r.dose.max > 0 || r.dose.min > 0)) {
      const unit = normUnit(r.dose.unit);
      const jsonStyle2 = /"id"\s*:/.test(obj);
      const lit = jsonStyle2 ? `"dose": ${JSON.stringify({ min: r.dose.min || r.dose.max, max: r.dose.max || r.dose.min, unit, source: r.dose.source || '' })}` : `dose: { min: ${r.dose.min || r.dose.max}, max: ${r.dose.max || r.dose.min}, unit: ${q(unit)}, source: ${q(r.dose.source || '')} }`;
      if (/["']?dose["']?\s*:\s*null/.test(obj)) { obj = obj.replace(/["']?dose["']?\s*:\s*null/, lit); log.dosesAdded++; changed = true; }
      else if (!/["']?dose["']?\s*:/.test(obj)) { const close = obj.lastIndexOf('}'); obj = obj.slice(0, close).replace(/,?\s*$/, ',') + `\n    ${lit}\n  }`; log.dosesAdded++; changed = true; }
      if (!DOSE_UNITS.includes(unit)) log.skipped.push(`${r.id}: dose in unita' non scalabile (${unit}): mostrata, senza calcolo`);
    }
    if (changed) { text = text.slice(0, rng[0]) + obj + text.slice(rng[1]); log.productsTouched++; }
  }
}
console.log(JSON.stringify(log, null, 1));
if (!dry) writeFileSync(modUrl, text);
