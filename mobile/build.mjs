// Prepara www/ per Capacitor partendo dalla web app: stessi file, librerie in locale
// (vendor/, l'app parte anche senza CDN) e API assolute (nell'app l'origine è capacitor://localhost).
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const WWW = path.join(import.meta.dirname, 'www');
const API_BASE = process.env.LAWNLY_API_BASE || 'https://lawnly-app.vercel.app';
const FILES = ['index.html', 'productCatalog.js', 'native.js', 'lawnly-logo.png', 'padana-logo.png', 'privacy.html', 'termini.html'];

fs.rmSync(WWW, { recursive: true, force: true });
fs.mkdirSync(WWW, { recursive: true });
for (const f of FILES) fs.copyFileSync(path.join(ROOT, f), path.join(WWW, f));

// Librerie (vendor/, versioni fisse), foto della Home (hero/) e foto dei prodotti (products/) si copiano così come sono.
for (const d of ['vendor', 'hero', 'products']) fs.cpSync(path.join(ROOT, d), path.join(WWW, d), { recursive: true });
let html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
const head = '<head>';
if (html.split(head).length !== 2) throw new Error('<head> non trovato');
html = html.replace(head, `${head}\n<script>window.LAWNLY_API_BASE=${JSON.stringify(API_BASE)};</script>`);
fs.writeFileSync(path.join(WWW, 'index.html'), html);
console.log(`www/ pronto · API ${API_BASE} · librerie da vendor/`);
