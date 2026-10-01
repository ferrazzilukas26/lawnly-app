import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Il modulo è la fonte unica. Conserva commenti e formattazione del suo array.
const root = new URL('../', import.meta.url);
const moduleText = readFileSync(new URL('productCatalog.js', root), 'utf8');
const array = moduleText.match(/export const PRODUCT_CATALOG = (\[[\s\S]*?\n\]);/);
if (!array) throw new Error('Array PRODUCT_CATALOG non trovato');
const path = fileURLToPath(new URL('index.html', root));
const html = readFileSync(path, 'utf8');
const pattern = /try\{window\.__LAWNLY_CATALOG__=\[[\s\S]*?\n\];window\.dispatchEvent/;
if (!pattern.test(html)) throw new Error('Blocco inline non trovato');
const next = html.replace(pattern, () => `try{window.__LAWNLY_CATALOG__=${array[1]};window.dispatchEvent`);
if (process.argv.includes('--check')) {
  if (next !== html) throw new Error('Catalogo inline non sincronizzato');
  console.log('Catalogo inline identico al modulo');
} else {
  writeFileSync(path, next);
  console.log('Catalogo inline sincronizzato');
}
