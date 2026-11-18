// Scarica le foto ufficiali dei prodotti trovate in un file JSON { id: { imageUrl } },
// le valida, le riduce a max 600 px e registra `image` nel catalogo.
// Uso: node scratchpad/download-product-images.mjs <product-images.json>
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { PRODUCT_CATALOG } from '../productCatalog.js';

// Solo i siti dei produttori (e loro sottodomini/CDN).
const ORIGINS = { 'Bottos': /(^|\.)bottos1848\.com$/, 'Barenbrug': /(^|\.)barenbrug\.[a-z.]+$/, 'ICL': /(^|\.)icl-(sf|group)\.com$/, 'Padana Sementi': /(^|\.)padanasementi\.com$/ };
const SLUG = { 'Bottos': 'bottos', 'Barenbrug': 'barenbrug', 'ICL': 'icl', 'Padana Sementi': 'padana' };

const found = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const root = new URL('../', import.meta.url);
const catPath = new URL('productCatalog.js', root);
let source = readFileSync(catPath, 'utf8');
let ok = 0, failures = 0;

// Sostituisce o aggiunge la riga image dentro il record del prodotto, senza toccare il resto.
function setImage(src, id, image) {
  const idLine = new RegExp(`^(\\s*)"?id"?: "${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}",\\n`, 'm');
  const m = idLine.exec(src);
  if (!m) throw new Error('record non trovato nel catalogo');
  const start = m.index, end = src.indexOf('\n  }', start);
  const rec = src.slice(start, end);
  const quoted = rec.includes('"id":');
  const line = `${m[1]}${quoted ? '"image"' : 'image'}: ${JSON.stringify(image)},`;
  const next = /^\s*"?image"?: .*,?$/m.test(rec)
    ? rec.replace(/^\s*"?image"?: .*?(,?)$/m, (_, c) => line.replace(/,$/, c || ''))
    : rec.replace(m[0], m[0] + line + '\n');
  return src.slice(0, start) + next + src.slice(end);
}

for (const p of PRODUCT_CATALOG.filter(p => !p.image && found[p.id]?.imageUrl)) {
  const temp = mkdtempSync(join(tmpdir(), 'lawnly-img-'));
  try {
    const url = new URL(found[p.id].imageUrl);
    if (url.protocol !== 'https:' || !ORIGINS[p.brand]?.test(url.hostname)) throw new Error(`origine non ammessa: ${url.hostname}`);
    const res = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { 'user-agent': 'Mozilla/5.0 (Lawnly catalogo)' } });
    if (!res.ok || !/^image\/(png|jpeg|webp)(;|$)/i.test(res.headers.get('content-type') || '')) throw new Error(`HTTP ${res.status} ${res.headers.get('content-type')}`);
    const input = join(temp, 'download');
    writeFileSync(input, new Uint8Array(await res.arrayBuffer()));
    const info = execFileSync('sips', ['-g', 'format', '-g', 'pixelWidth', '-g', 'pixelHeight', input], { encoding: 'utf8' });
    const format = info.match(/format: (jpeg|png|webp)/)?.[1];
    const w = Number(info.match(/pixelWidth: (\d+)/)?.[1]), h = Number(info.match(/pixelHeight: (\d+)/)?.[1]);
    if (!format || !(w >= 120 && h >= 120)) throw new Error(`immagine non valida o troppo piccola (${w}x${h})`);
    if (Math.max(w, h) > 600) execFileSync('sips', ['-Z', '600', input], { stdio: 'ignore' });
    const dir = `products/${SLUG[p.brand]}`;
    mkdirSync(new URL(dir + '/', root), { recursive: true });
    const image = `${dir}/${p.id}.${format === 'jpeg' ? 'jpg' : format}`;
    source = setImage(source, p.id, image);
    writeFileSync(new URL(image, root), readFileSync(input));
    ok++;
    console.log(`${p.id}: ${image}${found[p.id].match === 'family' ? ' (foto della linea)' : ''}`);
  } catch (error) {
    failures++;
    console.error(`${p.id}: ${error.message}`);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
writeFileSync(catPath, source);
console.log(`scaricate ${ok}, errori ${failures}`);
if (failures) process.exitCode = 1;
