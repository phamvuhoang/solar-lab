// Writes dist/release-manifest.json: what this build is made of (app, formats, engines, catalog, weather, verification status).
// No timestamps: building the same sources twice must give the same file (the service worker version is derived from dist contents).
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root));
const constant = (file, name) => { const m = new RegExp(`${name}\\s*=\\s*'([^']+)'`).exec(read(file).toString('utf8')); if (!m) throw new Error(`${name} not found in ${file}`); return m[1]; };

export function buildManifest(env = process.env) {
  const pkg = JSON.parse(read('package.json'));
  const components = JSON.parse(read('data/catalog/components.json')), offers = JSON.parse(read('data/catalog/offers.json'));
  const dbVersion = Number(/DB_VERSION\s*=\s*(\d+)/.exec(read('src/persistence/db.ts').toString('utf8'))[1]);
  const weather = [{ id: 'lam-ha-2023-pvgis-era5', file: 'data/weather/lam-ha-2023-pvgis-era5.csv' }].map((w) => { const b = read(w.file); return { id: w.id, sha256: sha(b), rows: b.toString('utf8').split('\n').filter((l) => /^\d{4}-/.test(l)).length }; });
  return {
    manifestVersion: 1,
    app: { name: pkg.name, version: pkg.version, buildId: env.BUILD_ID ?? 'dev', commit: env.GIT_COMMIT ?? null },
    formats: { project: 1, package: Number(/PACKAGE_VERSION\s*=\s*(\d+)/.exec(read('src/reports/package.ts').toString('utf8'))[1]), indexedDb: dbVersion },
    engines: { pv: constant('src/engine/pv.ts', 'ENGINE_VERSION'), dispatch: constant('src/engine/dispatch.ts', 'DISPATCH_VERSION'), shade: constant('src/shade/geometry.ts', 'SHADE_MODEL_VERSION') },
    catalog: {
      components: components.length, offers: offers.length, sha256: { components: sha(read('data/catalog/components.json')), offers: sha(read('data/catalog/offers.json')) },
      unreviewed: components.filter((c) => c.review !== 'reviewed').map((c) => c.modelId),
    },
    weather,
    schemas: Object.fromEntries(['project-v1', 'component-v1', 'offer-v1'].map((n) => [n, sha(read(`schemas/${n}.json`))])),
    verification: {
      model: 'đã đối chiếu mô hình: PV so pvlib (fixture đóng băng), sổ năng lượng dispatch cân từng bước, bóng so lời giải hình học',
      field: 'chưa đối chiếu thực địa: không có phép đo công trình thật',
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const m = buildManifest();
  writeFileSync(new URL('dist/release-manifest.json', root), JSON.stringify(m, null, 2) + '\n');
  console.log(`dist/release-manifest.json ${m.app.version} ${m.engines.pv} ${m.engines.dispatch} ${m.engines.shade}`);
}
