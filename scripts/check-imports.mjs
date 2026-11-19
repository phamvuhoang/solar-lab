// Fails when code imports outside the repo root or by absolute path.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKIP = new Set(['node_modules', 'dist', 'test-results', 'docs', '.git']);
const SPEC = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"])([^'"\n]+)\1/g;
const EXT = /\.(?:[cm]?[jt]s|tsx?)$/;

function* files(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (EXT.test(name)) yield p;
  }
}

export function findViolations(root) {
  const bad = [];
  for (const file of files(root)) {
    for (const [, , spec] of readFileSync(file, 'utf8').matchAll(SPEC)) {
      let why = null;
      if (spec.startsWith('/') || /^[a-z]:[\\/]/i.test(spec)) why = 'absolute path';
      else if (spec.startsWith('.') && relative(root, resolve(dirname(file), spec)).startsWith('..')) why = 'outside root';
      if (why) bad.push(`${relative(root, file)}: '${spec}' (${why})`);
    }
  }
  return bad;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const bad = findViolations(fileURLToPath(new URL('../', import.meta.url)));
  if (bad.length) { console.error(bad.join('\n')); process.exit(1); }
  console.log('imports ok');
}
