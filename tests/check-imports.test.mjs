import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findViolations } from '../scripts/check-imports.mjs';

const imp = (spec) => 'import x from ' + JSON.stringify(spec);

function repo(files) {
  const root = mkdtempSync(join(tmpdir(), 'solar-imports-'));
  mkdirSync(join(root, 'src'));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(root, name), body);
  return root;
}

test('import hợp lệ trong root', () => {
  assert.deepEqual(findViolations(repo({ 'src/a.ts': imp('./b.ts'), 'src/b.ts': 'export default 1' })), []);
});
test('bắt import ra ngoài root và đường dẫn tuyệt đối', () => {
  const root = repo({
    'src/a.ts': imp('../../outside/src/x.ts'),
    'src/b.ts': imp('/abs/path.js'),
  });
  assert.equal(findViolations(root).length, 2);
});
