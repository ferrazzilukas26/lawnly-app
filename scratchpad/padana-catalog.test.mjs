import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { PRODUCT_CATALOG } from '../productCatalog.js';

const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('index.html', root), 'utf8');
const inline = html.match(/try\{window\.__LAWNLY_CATALOG__=(\[[\s\S]*?\n\]);window\.dispatchEvent/);
assert.ok(inline, 'Fallback file:// presente');
assert.deepEqual(JSON.parse(JSON.stringify(vm.runInNewContext(inline[1]))), PRODUCT_CATALOG);
assert.equal(new Set(PRODUCT_CATALOG.map(p => p.id)).size, PRODUCT_CATALOG.length);
assert.ok(!html.includes('var PADANA='), 'Nessun catalogo parallelo aggiunto a runtime');
const padana = PRODUCT_CATALOG.filter(p => p.brand === 'Padana Sementi');
assert.equal(padana.length, 38);
const types = new Set(['concime', 'biostimolante', 'bioattivato', 'surfattante', 'correttore', 'speciale', 'tracciante', 'colorante']);
const subtypes = new Set(['granulare', 'microgranulare', 'liquido', 'polvere', 'pellet']);
const doseUnits = new Set(['g/m2', 'g/1000m2', 'kg/1000m2', 'ml/1000m2', 'ml/100m2', 'kg/ha', 'ml/m2']);
const skus = new Set();
for (const p of padana) {
  assert.match(p.id, /^padana-[a-z0-9-]+$/);
  assert.ok(types.has(p.type), p.id);
  assert.ok(p.subtype === null || subtypes.has(p.subtype), p.id);
  assert.ok(p.organic === null || typeof p.organic === 'boolean', p.id);
  if (p.npk) for (const key of ['n', 'p', 'k']) assert.ok(Number.isFinite(p.npk[key]), `${p.id}: ${key}`);
  if (p.dose) {
    assert.ok(doseUnits.has(p.dose.unit), p.id);
    assert.ok(p.dose.min > 0 && p.dose.max >= p.dose.min, p.id);
  }
  for (const f of p.formats) {
    assert.ok(f.sku && !skus.has(f.sku), p.id);
    skus.add(f.sku);
    assert.ok(f.size > 0 && ['kg', 'g', 'L', 'ml'].includes(f.unit), p.id);
  }
  if (p.image) {
    assert.match(p.image, /^products\/padana\/[a-z0-9-]+\.(jpg|png|webp)$/);
    assert.ok(existsSync(new URL(p.image, root)), p.image);
  }
  for (const field of ['url', 'sheetUrl', 'imageUrl', 'sourceUrl']) {
    if (p[field]) assert.equal(new URL(p[field]).hostname, 'www.padanasementi.com');
  }
}
// Non confondere metodi d'impiego, unità o dati assenti con valori di default.
assert.equal(padana.find(p => p.id === 'padana-rooting-plus').npk, null);
assert.equal(padana.find(p => p.id === 'padana-ferti-3a').dose, null);
assert.equal(padana.find(p => p.id === 'padana-ferti-energy-wet').durationDays, null);
assert.equal(padana.find(p => p.id === 'padana-fertizon').temperatureRange, null);
assert.ok(padana.every(p => p.seasonMicro === null && p.seasonMacro === null));
console.log('Padana: ID, schema, unità, fonti, immagini locali e parità completa modulo/inline OK');
