// Applica scratchpad/audit/fix-*.json a productCatalog.js: SOSTITUISCE formats e/o dose dei prodotti indicati (action != keep).
// Scrive solo unita' di dose scalabili; il resto viene saltato e segnalato. Uso: node apply-fix.mjs [--dry]
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const dir = new URL('audit/', import.meta.url);
const modUrl = new URL('productCatalog.js', root);
let text = readFileSync(modUrl, 'utf8');
const dry = process.argv.includes('--dry');
const OK_UNITS = ['g/m2', 'g/1000m2', 'kg/1000m2', 'kg/ha', 'ml/m2', 'ml/100m2', 'ml/1000m2'];
const log = { applied: 0, skipped: [] };
function range(id) {
  const m = new RegExp(`["']?id["']?:\\s*"${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).exec(text);
  if (!m) return null;
  let a = m.index; while (text[a] !== '{') a--;
  let d = 0, e = a;
  for (; e < text.length; e++) { if (text[e] === '{') d++; else if (text[e] === '}') { d--; if (d === 0) break; } }
  return [a, e + 1];
}
const close = (s, o) => { let d = 0; for (let i = o; i < s.length; i++) { if (s[i] === '[') d++; else if (s[i] === ']') { d--; if (!d) return i; } } return -1; };
for (const fn of readdirSync(dir).filter(n => n.startsWith('fix-') && n.endsWith('.json'))) {
  for (const r of JSON.parse(readFileSync(new URL(fn, dir), 'utf8'))) {
    if (r.action === 'keep') continue;
    const rg = range(r.id); if (!rg) { log.skipped.push(`${r.id}: non trovato`); continue; }
    let o = text.slice(rg[0], rg[1]); let ch = false;
    if (/format/.test(r.action) && r.formats && r.formats.length) {
      const fm = r.formats.filter(f => f.size > 0 && ['kg', 'g', 'L', 'ml'].includes(f.unit)).map(f => JSON.stringify({ sku: `${r.id}-${String(f.size).replace('.', '_')}${f.unit.toLowerCase()}`, size: f.size, unit: f.unit, label: f.label, verified: true, source: f.source }));
      const at = o.search(/["']?formats["']?\s*:/);
      if (at >= 0 && fm.length) { const op = o.indexOf('[', at); const c = close(o, op); o = o.slice(0, op) + '[\n      ' + fm.join(',\n      ') + '\n    ]' + o.slice(c + 1); ch = true; }
    }
    if (/dose/.test(r.action) && r.dose && (r.dose.min > 0 || r.dose.max > 0)) {
      if (!OK_UNITS.includes(r.dose.unit)) log.skipped.push(`${r.id}: unita' dose non scalabile ${r.dose.unit}`);
      else {
        const lit = JSON.stringify({ min: r.dose.min || r.dose.max, max: r.dose.max || r.dose.min, unit: r.dose.unit, source: r.dose.source || '' });
        if (/["']?dose["']?\s*:\s*(null|\{[^}]*\})/.test(o)) { o = o.replace(/["']?dose["']?\s*:\s*(null|\{[^}]*\})/, `"dose": ${lit}`); ch = true; }
        else log.skipped.push(`${r.id}: campo dose assente`);
      }
    }
    if (ch) { text = text.slice(0, rg[0]) + o + text.slice(rg[1]); log.applied++; }
  }
}
console.log(JSON.stringify(log, null, 1));
if (!dry) writeFileSync(modUrl, text);
