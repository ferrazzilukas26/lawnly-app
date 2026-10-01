import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { PRODUCT_CATALOG } from '../productCatalog.js';

// Ripresa del download quando la rete è disponibile. Usa solo URL già verificati;
// non registra un percorso nel catalogo finché il file non è stato validato.
const root = new URL('../', import.meta.url);
const path = new URL('productCatalog.js', root);
let source = readFileSync(path, 'utf8');
let failures = 0;
mkdirSync(new URL('products/padana/', root), { recursive: true });
for (const p of PRODUCT_CATALOG.filter(p => p.brand === 'Padana Sementi' && p.imageUrl && !p.image)) {
  const temp = mkdtempSync(join(tmpdir(), 'lawnly-padana-'));
  try {
    const url = new URL(p.imageUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'www.padanasementi.com') throw new Error('Origine non valida');
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok || !/^image\/(png|jpeg|webp)(;|$)/i.test(res.headers.get('content-type') || '')) throw new Error(`Immagine non disponibile: HTTP ${res.status}`);
    const input = join(temp, 'download');
    writeFileSync(input, new Uint8Array(await res.arrayBuffer()));
    const info = execFileSync('sips', ['-g', 'format', '-g', 'pixelWidth', '-g', 'pixelHeight', input], { encoding: 'utf8' });
    const format = info.match(/format: (jpeg|png|webp)/)?.[1];
    const width = Number(info.match(/pixelWidth: (\d+)/)?.[1]);
    const height = Number(info.match(/pixelHeight: (\d+)/)?.[1]);
    if (!format || !width || !height) throw new Error('File immagine non valido');
    const image = `products/padana/${p.id}.${format === 'jpeg' ? 'jpg' : format}`;
    if (Math.max(width, height) > 600) execFileSync('sips', ['-Z', '600', input]);
    const before = JSON.stringify(p, null, 2).replace(/\n/g, '\n  ');
    const after = JSON.stringify({ ...p, image }, null, 2).replace(/\n/g, '\n  ');
    if (!source.includes(before)) throw new Error('Record modificato: rigenerare il download dal catalogo attuale');
    writeFileSync(new URL(image, root), readFileSync(input));
    source = source.replace(before, after);
    console.log(`${p.id}: ${image}`);
  } catch (error) {
    failures++;
    console.error(`${p.id}: ${error.message}`);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
writeFileSync(path, source);
await import('./sync-catalog-inline.mjs');
if (failures) process.exitCode = 1;
