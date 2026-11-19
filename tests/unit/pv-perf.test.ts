import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { simulatePv } from '../../src/engine/pv';
import { parseWeatherCsv } from '../../src/weather/csv';
import { input, model, panel } from './pv-helpers';

// Target (docs/04 §Kiểm thử ứng dụng): full-year simulation with weather loaded and geometry unchanged ≤ 5 s on the dev machine.
test('8.760 giờ × 2 chuỗi: mô phỏng cả năm ≤ 5 s (đo 5 lượt sau warm-up)', async () => {
  const r = parseWeatherCsv(readFileSync(new URL('../../data/weather/lam-ha-2023-pvgis-era5.csv', import.meta.url), 'utf8'));
  if (!r.ok) throw new Error('weather');
  const strings = ['A', 'B'].map((id, k) => ({ id, label: id, panels: Array.from({ length: 4 }, () => panel()), trackerId: `T${k}` }));
  const trackers = [0, 1].map((k) => ({ id: `T${k}`, label: `T${k}`, inverterId: 'I', maxPowerW: 4800, maxCurrentA: 17 }));
  const i = input(r.series, model({ tiltDeg: 10, azimuthDeg: 180, cellModel: 'faiman', applyLimits: true }), strings, trackers, [{ id: 'I', label: 'I', maxPvPowerW: 9600 }]);
  const t0 = performance.now();
  await simulatePv(i, 'h'); // lần đầu (lạnh)
  const cold = performance.now() - t0;
  const warm: number[] = [];
  for (let k = 0; k < 6; k++) { const s = performance.now(); await simulatePv(i, 'h'); warm.push(performance.now() - s); }
  const w = warm.slice(1).sort((a, b) => a - b);
  console.log(`pv-year-perf cold=${cold.toFixed(0)}ms p50=${w[2].toFixed(0)}ms p95=${w[4].toFixed(0)}ms n=${w.length}`);
  expect(w[4]).toBeLessThanOrEqual(5000);
}, 60000);

// W05 target: year-long run with weather loaded must stay within 5 s (PV + dispatch in one job).
test('hệ thống cả năm (PV + dispatch, cấu hình A Lâm Hà): ≤ 5 s, đo 5 lượt sau warm-up', async () => {
  const { BUILTIN_OFFERS, offersFor } = await import('../../src/catalog/catalog');
  const { buildLamHaConfig } = await import('../../src/domain/presets');
  const { openLamHa } = await import('../../src/domain/project');
  const { compileSim } = await import('../../src/engine/sim-compile');
  const { simulateSystem } = await import('../../src/engine/system');
  const { catalog } = await import('./helpers');
  const r = parseWeatherCsv(readFileSync(new URL('../../data/weather/lam-ha-2023-pvgis-era5.csv', import.meta.url), 'utf8'));
  if (!r.ok) throw new Error('weather');
  const parts = { inverter: catalog('luxpower-sna6000wpv'), battery: catalog('used-battery'), home: catalog('sample-home-load'), pump: catalog('sample-pump-load'), controller: catalog('sample-pump-controller') };
  const p = { ...buildLamHaConfig(openLamHa(), 'shared8', parts, (c) => offersFor(BUILTIN_OFFERS, c)), pv: { tiltDeg: 10, azimuthDeg: 180 } };
  const c = await compileSim(p, r.series);
  const t0 = performance.now();
  await simulateSystem(c.input!, c.hash!);
  const cold = performance.now() - t0;
  const warm: number[] = [];
  for (let k = 0; k < 6; k++) { const s = performance.now(); await simulateSystem(c.input!, c.hash!); warm.push(performance.now() - s); }
  const w = warm.slice(1).sort((a, b) => a - b);
  console.log(`system-year-perf cold=${cold.toFixed(0)}ms p50=${w[2].toFixed(0)}ms p95=${w[4].toFixed(0)}ms n=${w.length}`);
  expect(w[4]).toBeLessThanOrEqual(5000);
}, 120000);
