// Prepara www/ per Capacitor partendo dalla web app: stessi file, librerie in locale
// (l'app parte anche senza CDN) e API assolute (nell'app l'origine è capacitor://localhost).
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const WWW = path.join(import.meta.dirname, 'www');
const API_BASE = process.env.LAWNLY_API_BASE || 'https://lawnly-app.vercel.app';
const FILES = ['index.html', 'productCatalog.js', 'waterEngine.js', 'native.js', 'lawnly-logo.png', 'padana-logo.png', 'privacy.html', 'termini.html'];
const VENDOR = [
  'https://cdn.jsdelivr.net/npm/preact@10/dist/preact.umd.js',
  'https://cdn.jsdelivr.net/npm/preact@10/hooks/dist/hooks.umd.js',
  'https://cdn.jsdelivr.net/npm/htm@3/dist/htm.umd.js',
  'https://cdn.jsdelivr.net/npm/preact@10/compat/dist/compat.umd.js',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js',
];

fs.rmSync(WWW, { recursive: true, force: true });
fs.mkdirSync(path.join(WWW, 'vendor'), { recursive: true });
for (const f of FILES) fs.copyFileSync(path.join(ROOT, f), path.join(WWW, f));

let html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
for (const url of VENDOR) {
  const name = url.split('/').slice(-3).join('-').replace(/[^a-z0-9.\-]/gi, '_');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download fallito ${url}: ${res.status}`);
  fs.writeFileSync(path.join(WWW, 'vendor', name), Buffer.from(await res.arrayBuffer()));
  const tag = `src="${url}"`;
  if (html.split(tag).length !== 2) throw new Error(`script non trovato una sola volta: ${url}`);
  html = html.replace(tag, `src="vendor/${name}"`);
}
const head = '<head>';
if (html.split(head).length !== 2) throw new Error('<head> non trovato');
html = html.replace(head, `${head}\n<script>window.LAWNLY_API_BASE=${JSON.stringify(API_BASE)};</script>`);
fs.writeFileSync(path.join(WWW, 'index.html'), html);
console.log(`www/ pronto · API ${API_BASE} · ${VENDOR.length} librerie in locale`);
