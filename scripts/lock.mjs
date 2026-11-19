// Input/reference lock: sha256 of every file whose bytes decide what the product computes or says (catalog, preset, weather,
// schemas, reference fixtures, golden numbers). `node scripts/lock.mjs` verifies; `node scripts/lock.mjs --write` re-locks.
// Re-locking is a deliberate act: read the diff of the locked files first (a changed number is a changed claim to the user).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const GROUPS = { catalog: 'data/catalog', preset: 'data/presets', weather: 'data/weather', schemas: 'schemas', reference: 'tests/fixtures/reference', golden: 'tests/fixtures/golden' };
const sha = (b) => createHash('sha256').update(b).digest('hex');

export function computeLock(root) {
  const files = {};
  for (const [group, dir] of Object.entries(GROUPS)) {
    for (const f of readdirSync(join(root, dir)).sort()) if (/\.(json|csv)$/.test(f)) files[`${dir}/${f}`] = { group, sha256: sha(readFileSync(join(root, dir, f))) };
  }
  return { lockVersion: 1, files };
}

/** Returns the list of problems: changed, missing and unlisted files. Empty = the inputs are exactly the locked ones. */
export function checkLock(root, lockPath = join(root, 'docs/release/input-lock.json')) {
  if (!existsSync(lockPath)) return ['docs/release/input-lock.json chưa có: chạy node scripts/lock.mjs --write'];
  const want = JSON.parse(readFileSync(lockPath, 'utf8')).files, have = computeLock(root).files, out = [];
  for (const [f, v] of Object.entries(want)) { if (!have[f]) out.push(`thiếu: ${f}`); else if (have[f].sha256 !== v.sha256) out.push(`đã đổi: ${f}`); }
  for (const f of Object.keys(have)) if (!want[f]) out.push(`chưa khóa: ${f}`);
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  if (process.argv.includes('--write')) { const l = computeLock(root); writeFileSync(join(root, 'docs/release/input-lock.json'), JSON.stringify(l, null, 2) + '\n'); console.log(`locked ${Object.keys(l.files).length} files`); }
  else { const p = checkLock(root); if (p.length) { console.error(p.join('\n')); process.exit(1); } console.log('input lock ok'); }
}
