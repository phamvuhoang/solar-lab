// Writes dist/build-meta.json: build id plus content hashes of the fixtures.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const sha256 = (p) => createHash('sha256').update(readFileSync(new URL(p, root))).digest('hex');
const meta = {
  buildId: process.env.BUILD_ID ?? 'dev',
  builtAt: new Date().toISOString(),
  node: process.version,
  fixtures: Object.fromEntries([
    'data/presets/lam-ha.json', 'data/catalog/components.json', 'data/catalog/offers.json',
    'schemas/project-v1.json', 'schemas/component-v1.json', 'schemas/offer-v1.json',
    'data/weather/lam-ha-2023-pvgis-era5.csv', 'tests/fixtures/reference/synthetic.json', 'tests/fixtures/reference/lam-ha-2023.json',
  ].map((f) => [f, sha256(f)])),
};
writeFileSync(new URL('dist/build-meta.json', root), JSON.stringify(meta, null, 2) + '\n');
console.log('dist/build-meta.json', meta.buildId);
