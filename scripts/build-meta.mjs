// Writes dist/build-meta.json: build id plus content hashes of the fixtures.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const sha256 = (p) => createHash('sha256').update(readFileSync(new URL(p, root))).digest('hex');
const meta = {
  buildId: process.env.BUILD_ID ?? 'dev',
  builtAt: new Date().toISOString(),
  node: process.version,
  fixtures: { 'data/presets/lam-ha.json': sha256('data/presets/lam-ha.json') },
};
writeFileSync(new URL('dist/build-meta.json', root), JSON.stringify(meta, null, 2) + '\n');
console.log('dist/build-meta.json', meta.buildId);
