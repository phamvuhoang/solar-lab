import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { addObstacle, addRoofFace, faceRect, fillFace } from '../../src/domain/layout-edit';
import { addInstances, createProject } from '../../src/domain/project';
import type { Project } from '../../src/domain/types';
import { buildShadeSpec, computeShade, ShadeCache } from '../../src/shade/sampler';
import type { RunEvent } from '../../src/worker/protocol';
import { createPvHandler } from '../../src/worker/pv-handler';
import { catalog } from './helpers';
import { input, model, panel, wx } from './pv-helpers';

const weatherYear = (n = 8760, t0 = Date.UTC(2023, 0, 1) / 1000) => ({ t0, stepSeconds: 3600, n, location: { latitude: 11.87, longitude: 108.2, elevationM: 978 } });

/** 40 VSUN 620 on a 12,5 × 10,5 m face at 15° facing South, 10 obstacles (water tanks and boxes) around the roof. */
function scene40(): Project {
  let p = addInstances(createProject('bench'), catalog('vsun-620'), 40);
  p = addRoofFace(p, faceRect('Mái 40', 12.5, 10.5, 15, 180, { e: 0, n: 0, up: 3 }));
  p = fillFace(p, p.roofFaces[0].roofFaceId, p.instances.map((i) => i.instanceId)).project;
  for (let k = 0; k < 10; k++) {
    p = k % 2
      ? addObstacle(p, { label: `Bồn ${k}`, kind: 'cylinder', roofFaceId: null, center: { e: 1 + k * 1.2, n: -1.2 }, baseUp: 3, angleDeg: 0, size: { x: 1.2, y: 1.2, z: 1.8 } })
      : addObstacle(p, { label: `Hộp ${k}`, kind: 'box', roofFaceId: null, center: { e: 1 + k * 1.2, n: 12.5 }, baseUp: 3, angleDeg: 20, size: { x: 0.8, y: 0.6, z: 2.5 } });
  }
  return p;
}

describe('worker: job bóng và job nhiều lần chạy PV', () => {
  test('shade: trả field đúng key; chạy lại với field cũ dùng lại hết; hủy giữa chừng', async () => {
    const p = scene40();
    const spec = await buildShadeSpec(p, weatherYear(72), { mode: 'standard', grid: 4 });
    const ev: RunEvent[] = [];
    await createPvHandler((e) => ev.push(e))({ type: 'shade', runId: 's1', inputHash: spec.key, spec, existing: null, range: [0, 48] });
    const res = ev.at(-1)!;
    expect(res).toMatchObject({ type: 'shade-result', runId: 's1', inputHash: spec.key, computed: 48, reused: 0 });
    const field = (res as Extract<RunEvent, { type: 'shade-result' }>).field;
    expect(field.panelIds).toHaveLength(40);
    expect(field.done.slice(0, 48).every((x) => x === 1) && field.done[48] === 0).toBe(true);
    const ev2: RunEvent[] = [];
    await createPvHandler((e) => ev2.push(e))({ type: 'shade', runId: 's2', inputHash: spec.key, spec, existing: field, range: [0, 48] });
    expect(ev2.at(-1)).toMatchObject({ type: 'shade-result', computed: 0, reused: 48 });
    const ev3: RunEvent[] = [];
    const h = createPvHandler((e) => { ev3.push(e); if (e.type === 'progress' && e.completedSteps >= 12) void h({ type: 'cancel', runId: 's3' }); });
    await h({ type: 'shade', runId: 's3', inputHash: spec.key, spec, existing: null, range: [0, 72] });
    expect(ev3.at(-1)).toEqual({ type: 'cancelled', runId: 's3' });
  });
  test('pv-batch: ba lần chạy trên cùng thời tiết, tiến độ tăng đều, kết quả đúng thứ tự', async () => {
    const w = wx({ n: 24, ghi: Array(24).fill(300), dni: Array(24).fill(300), dhi: Array(24).fill(100), tempAirC: Array(24).fill(25), windMs: Array(24).fill(1) });
    const mk = (n: number) => input(w, model({ cellModel: 'faiman' }), [{ id: 'S', label: 'S', panels: Array.from({ length: n }, () => panel()), trackerId: 'T1' }]);
    const ev: RunEvent[] = [];
    await createPvHandler((e) => ev.push(e))({ type: 'pv-batch', runId: 'b1', inputHash: 'H', inputs: [mk(1), mk(2), mk(4)] });
    const done = ev.at(-1) as Extract<RunEvent, { type: 'batch-result' }>;
    expect(done.type).toBe('batch-result');
    expect(done.results.map((r) => r.strings[0].panelCount)).toEqual([1, 2, 4]);
    const prog = ev.filter((e) => e.type === 'progress').map((e) => (e as { completedSteps: number }).completedSteps);
    expect(prog.every((v, i) => i === 0 || v >= prog[i - 1])).toBe(true);
    const bad = await (async () => { const e: RunEvent[] = []; await createPvHandler((x) => e.push(x))({ type: 'pv-batch', runId: 'b2', inputHash: 'H', inputs: [{ ...mk(1), model: model({ cellModel: 'faiman' }), weather: wx({ n: 1, ghi: [0], dni: [0], dhi: [0] }) }] }); return e.at(-1); })();
    expect(bad).toMatchObject({ type: 'failure' });
  });
});

describe('benchmark bóng (40 tấm, 10 vật cản, lưới 4×4)', () => {
  const report: Record<string, unknown> = {};
  test('một ngày ≤ 2 s; cả năm ≤ 120 s; hủy trong ≤ 500 ms; cache lần hai dùng lại hết', async () => {
    const p = scene40();
    const spec = await buildShadeSpec(p, weatherYear(), { mode: 'standard', grid: 4 });
    expect(spec.panels).toHaveLength(40);
    expect(spec.occluders.boxes.length + spec.occluders.cylinders.length).toBe(10);
    const cache = new ShadeCache();

    // một ngày (giữa năm, 24 bước), đo 3 lượt trên field mới mỗi lần
    const day: number[] = [];
    for (let k = 0; k < 3; k++) { const t = performance.now(); await computeShade(spec, null, [24 * 180, 24 * 181]); day.push(performance.now() - t); }
    const dayMs = day.sort((a, b) => a - b)[1];

    // cả năm
    const t0 = performance.now();
    const year = (await computeShade(spec, null))!;
    const yearMs = performance.now() - t0;
    const fieldMb = year.field.access.reduce((a, x) => a + x.byteLength, 0) / 1e6;
    cache.put(year.field);
    const rays = spec.panels.length * spec.samplesPerPanel * year.field.done.length;

    // hủy: cờ bật sau 240 bước, đo thời gian từ lúc bật cờ tới khi hàm trả về
    let flagAt = 0;
    const cancelled = await computeShade(spec, null, null, { onProgress: (d) => { if (d >= 240 && !flagAt) flagAt = performance.now(); }, isCancelled: () => flagAt > 0 });
    const cancelMs = performance.now() - flagAt;
    expect(cancelled).toBeNull();

    // cache lần hai
    const again = (await computeShade(spec, cache.get(spec.key), [0, 8760]))!;
    report.shade = { panels: 40, obstacles: 10, samplesPerPanel: 16, steps: 8760, dayMsMedian: Math.round(dayMs), yearMs: Math.round(yearMs), yearRaysPerS: Math.round(rays / (yearMs / 1000)), fieldMb: +fieldMb.toFixed(2),
      cancelMs: Math.round(cancelMs), cacheSecondRun: { computed: again.computed, reused: again.reused }, node: process.version };
    console.log('shade-benchmark', JSON.stringify(report.shade));
    expect(dayMs).toBeLessThanOrEqual(2000);
    expect(yearMs).toBeLessThanOrEqual(120000);
    expect(cancelMs).toBeLessThanOrEqual(500);
    expect([again.computed, again.reused]).toEqual([0, 8760]);
  }, 300000);
  test.runIf(process.env.W07_EVIDENCE)('ghi benchmark cho evidence', () => {
    const dir = process.env.W07_EVIDENCE!;
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/benchmark.json`, JSON.stringify(report, null, 2) + '\n');
  });
});
