import { expect, test } from 'vitest';
import { Lru } from '../../src/app/autorun';
import { runAuto } from '../../src/app/auto-sim';
import { buildSampleHouse } from '../../src/domain/seed';
import { simulateSystem, type SimResult } from '../../src/engine/system';
import type { Runner } from '../../src/reports/replay';
import { computeShade } from '../../src/shade/sampler';
import { loadBundledWeather } from '../../src/weather/bundled';

const T = '2026-11-20T00:00:00.000Z';
const loadWeather = async (id: string) => { const r = await loadBundledWeather(id); return r?.ok ? r.series : undefined; };
/** In-process runner that counts its calls; `beforeSim` runs just before the dispatch (to cancel mid-run). */
function counting(beforeSim: () => void = () => {}) {
  const calls = { shade: 0, sim: 0 };
  const runner: Runner = {
    pv: async () => null,
    shade: async (spec) => { calls.shade++; return (await computeShade(spec, null))?.field ?? null; },
    sim: async (input, hash) => { calls.sim++; beforeSim(); const o = await simulateSystem(input, hash); return o?.ok ? o.result : null; },
  };
  return { calls, runner };
}
const live = () => new AbortController().signal;

test('Nhà mẫu: ra kết quả, lần hai trúng cache không chạy lại', async () => {
  const p = buildSampleHouse(T), cache = new Lru<SimResult>(4), { calls, runner } = counting();
  const a = await runAuto(p, { loadWeather, runner, cache, signal: live() });
  if (a.kind !== 'done') throw new Error(JSON.stringify(a));
  expect(a.shadePreview).toBe(true);
  expect(a.result.dispatch.metrics.hoursShort).toBe(0);
  expect(a.result.dispatch.totals.gridImportWh).toBeGreaterThan(300_000);
  expect(calls).toEqual({ shade: 1, sim: 1 });
  const b = await runAuto(p, { loadWeather, runner, cache, signal: live() });
  expect(b).toEqual(a);
  expect(calls).toEqual({ shade: 1, sim: 1 }); // shade from the shared shade cache, dispatch from the LRU
}, 120_000);

test('thiếu thời tiết → blocked, chỉ tới ③ chọn thời tiết', async () => {
  const p = buildSampleHouse(T), { calls, runner } = counting();
  const s = await runAuto({ ...p, pv: { ...p.pv, weatherId: null } }, { loadWeather, runner, cache: new Lru(4), signal: live() });
  expect(s).toEqual({ kind: 'blocked', message: 'chưa đủ dữ liệu: thiếu thời tiết', target: { step: 'chay-thu', tab: 'pv', focusId: 'wx-select' } });
  expect(calls).toEqual({ shade: 0, sim: 0 });
});

test('bỏ lịch tải → blocked, message LOAD_PLAN_MISSING', async () => {
  const p = buildSampleHouse(T), { calls, runner } = counting();
  const s = await runAuto({ ...p, loadPlans: [] }, { loadWeather, runner, cache: new Lru(4), signal: live() });
  if (s.kind !== 'blocked') throw new Error(s.kind);
  expect(s.message).toContain('chưa đặt lịch chạy'); // the LOAD_PLAN_MISSING issue's own words
  expect(s.target).toEqual({ step: 'chay-thu', tab: 'he-thong' });
  expect(calls.sim).toBe(0);
}, 60_000);

test('hủy giữa chừng → idle, không ghi cache', async () => {
  const p = buildSampleHouse(T), cache = new Lru<SimResult>(4), ctl = new AbortController();
  const { calls, runner } = counting(() => ctl.abort());
  expect(await runAuto(p, { loadWeather, runner, cache, signal: ctl.signal })).toEqual({ kind: 'idle' });
  const again = counting();
  expect((await runAuto(p, { loadWeather, runner: again.runner, cache, signal: live() })).kind).toBe('done');
  expect([calls.sim, again.calls.sim]).toEqual([1, 1]); // the cancelled result was not kept: the next run computes it
}, 120_000);
