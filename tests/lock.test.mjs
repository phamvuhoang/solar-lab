import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkLock } from '../scripts/lock.mjs';

const here = new URL('../', import.meta.url).pathname;
function copy() {
  const d = mkdtempSync(join(tmpdir(), 'lock-'));
  for (const p of ['data', 'schemas', 'tests/fixtures', 'docs/release']) cpSync(join(here, p), join(d, p), { recursive: true });
  return d;
}
test('kho thật khớp khóa', () => assert.deepEqual(checkLock(here), []));
test('đổi một byte của catalog, thêm file lạ, đều bị báo', () => {
  const d = copy();
  appendFileSync(join(d, 'data/catalog/offers.json'), ' ');
  writeFileSync(join(d, 'tests/fixtures/golden/moi.json'), '{}');
  assert.deepEqual(checkLock(d).sort(), ['chưa khóa: tests/fixtures/golden/moi.json', 'đã đổi: data/catalog/offers.json']);
});
