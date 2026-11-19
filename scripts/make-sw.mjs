// Writes dist/sw.js from scripts/sw-template.js: the list of every built file with its sha256, and a version derived from them.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
function walk(dir) {
  return readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
}

export function buildSw(distDir, template, buildId) {
  const skip = new Set(['sw.js', 'build-meta.json']);
  const assets = walk(distDir).map((p) => relative(distDir, p).split(sep).join('/')).filter((p) => !skip.has(p)).sort()
    .map((p) => [p, sha256(readFileSync(join(distDir, p)))]);
  if (!assets.some(([p]) => p === 'index.html')) throw new Error('dist/index.html missing: run vite build first');
  const version = sha256(assets.map(([p, h]) => `${p}:${h}`).join('\n')).slice(0, 12);
  return { version, assets, code: template.replace('__VERSION__', version).replace('__BUILD__', buildId.replace(/[^\w.-]/g, '_')).replace('__ASSETS__', JSON.stringify(assets)) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = new URL('../', import.meta.url);
  const dist = fileURLToPath(new URL('dist/', root));
  const r = buildSw(dist, readFileSync(new URL('scripts/sw-template.js', root), 'utf8'), process.env.BUILD_ID ?? 'dev');
  writeFileSync(join(dist, 'sw.js'), r.code);
  console.log(`dist/sw.js version ${r.version}, ${r.assets.length} files`);
}
