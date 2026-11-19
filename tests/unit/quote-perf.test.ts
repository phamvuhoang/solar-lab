import { expect, test } from 'vitest';
import { buildQuote } from '../../src/cost/quote';
import { setQuantity } from '../../src/cost/edit';
import { openLamHa } from '../../src/domain/project';
import { validateProject } from '../../src/domain/validate';
import { applyPreset } from '../../src/domain/presets';
import { validateDesign } from '../../src/validation/strings';
import { catalog } from './helpers';

// W02/W03 target: 40 panels, a quantity change updates quote + project and electrical validation with p95 <= 150 ms (dev machine).
test('40 tấm: đổi số lượng → dự toán + validation + kiểm tra điện, p95 ≤ 150 ms', () => {
  const base = { ...applyPreset(setQuantity(openLamHa(), { modelId: 'vsun-620', revision: 1 }, 40), 'two-trackers', catalog('luxpower-sna6000wpv')), design: { coldCellTempC: 5, hotCellTempC: 70 } };
  const times: number[] = [];
  for (let i = 0; i < 25; i++) {
    const t0 = performance.now();
    const p = setQuantity(base, { modelId: 'vsun-620', revision: 1 }, 40 - (i % 5));
    buildQuote(p);
    validateProject(p);
    validateDesign(p);
    times.push(performance.now() - t0);
  }
  const warm = times.slice(5).sort((a, b) => a - b);
  const p50 = warm[Math.floor(warm.length * 0.5)], p95 = warm[Math.floor(warm.length * 0.95)];
  console.log(`quote-perf p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms n=${warm.length}`);
  expect(p95).toBeLessThanOrEqual(150);
});
