import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { describe, expect, test } from 'vitest';
import { BUILTIN_OFFERS, offersFor } from '../../src/catalog/catalog';
import { buildQuote } from '../../src/cost/quote';
import { setQuantity } from '../../src/cost/edit';
import { addObstacle, addRoofFace, faceRect, fillFace } from '../../src/domain/layout-edit';
import { applyPreset, buildLamHaConfig } from '../../src/domain/presets';
import { addInstances, createProject, openLamHa } from '../../src/domain/project';
import type { Project } from '../../src/domain/types';
import { validateProject } from '../../src/domain/validate';
import { simulatePv } from '../../src/engine/pv';
import { compileSim } from '../../src/engine/sim-compile';
import { simulateSystem } from '../../src/engine/system';
import { buildPackage, recordSim, stagePackage } from '../../src/reports/package';
import { CURRENT_ENGINES } from '../../src/reports/replay';
import { buildShadeSpec, computeShade } from '../../src/shade/sampler';
import { validateDesign } from '../../src/validation/strings';
import { parseWeatherCsv } from '../../src/weather/csv';
import { catalog } from './helpers';
import { input, model, panel } from './pv-helpers';

/**
 * Release benchmark (docs/04 §Kiểm thử ứng dụng): cold run measured on its own, then 5 warm runs; p50/p95, machine, peak memory.
 * Targets: 40-panel edit→BOM+validation p95 ≤ 150 ms; year simulation with weather loaded ≤ 5 s; shade year ≤ 120 s; cancel ≤ 500 ms.
 * Written to docs/evidence/W09/benchmark.json when W09_EVIDENCE is set.
 */
const pct = (a: number[], q: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * q))]; };
const stat = (cold: number, warm: number[]) => ({ coldMs: Math.round(cold * 10) / 10, warmRuns: warm.length, p50Ms: Math.round(pct(warm, 0.5) * 10) / 10, p95Ms: Math.round(pct(warm, 0.95) * 10) / 10 });
async function measure(f: () => unknown | Promise<unknown>, warmRuns = 5) {
  const t0 = performance.now(); await f(); const cold = performance.now() - t0;
  await f(); // warm-up, not counted
  const warm: number[] = [];
  for (let i = 0; i < warmRuns; i++) { const t = performance.now(); await f(); warm.push(performance.now() - t); }
  return stat(cold, warm);
}
const report: Record<string, unknown> = {};
const rssMb = () => Math.round(process.memoryUsage().rss / 1e6);

describe('benchmark phát hành', () => {
  test('máy đo', () => {
    report.machine = { cpu: os.cpus()[0].model, cores: os.cpus().length, memGB: Math.round(os.totalmem() / 1e9), platform: `${os.platform()} ${os.release()}`, node: process.version, rssMbStart: rssMb() };
    expect(os.cpus().length).toBeGreaterThan(0);
  });
  test('40 tấm: đổi số lượng → BOM + validation + kiểm tra điện, p95 ≤ 150 ms', async () => {
    const base = { ...applyPreset(setQuantity(openLamHa(), { modelId: 'vsun-620', revision: 1 }, 40), 'two-trackers', catalog('luxpower-sna6000wpv')), design: { coldCellTempC: 5, hotCellTempC: 70 } };
    let i = 0;
    const r = await measure(() => { const p = setQuantity(base, { modelId: 'vsun-620', revision: 1 }, 40 - (i++ % 5)); buildQuote(p); validateProject(p); validateDesign(p); }, 25);
    report.edit40 = r; expect(r.p95Ms).toBeLessThanOrEqual(150);
  });
  test('PV cả năm (2 chuỗi, 8.760 bước): ≤ 5 s', async () => {
    const w = parseWeatherCsv(readFileSync(new URL('../../data/weather/lam-ha-2023-pvgis-era5.csv', import.meta.url), 'utf8'));
    if (!w.ok) throw new Error('weather');
    const strings = ['A', 'B'].map((id, k) => ({ id, label: id, panels: Array.from({ length: 4 }, () => panel()), trackerId: `T${k}` }));
    const trackers = [0, 1].map((k) => ({ id: `T${k}`, label: `T${k}`, inverterId: 'I', maxPowerW: 4800, maxCurrentA: 17 }));
    const i = input(w.series, model({ tiltDeg: 10, azimuthDeg: 180, cellModel: 'faiman', applyLimits: true }), strings, trackers, [{ id: 'I', label: 'I', maxPvPowerW: 9600 }]);
    const r = await measure(() => simulatePv(i, 'h')); report.pvYear = r; expect(r.p95Ms).toBeLessThanOrEqual(5000);
  }, 60000);
  test('hệ thống cả năm (PV + dispatch, Lâm Hà cấu hình A): ≤ 5 s; gói đầy đủ dựng + nhập + kích thước', async () => {
    const { loadBundledWeather } = await import('../../src/weather/bundled');
    const w = await loadBundledWeather('lam-ha-2023-pvgis-era5'); if (!w?.ok) throw new Error('weather');
    const parts = { inverter: catalog('luxpower-sna6000wpv'), battery: catalog('used-battery'), home: catalog('sample-home-load'), pump: catalog('sample-pump-load'), controller: catalog('sample-pump-controller') };
    const p = { ...buildLamHaConfig(openLamHa(), 'shared8', parts, (c) => offersFor(BUILTIN_OFFERS, c)), pv: { tiltDeg: 10, azimuthDeg: 180, weatherId: w.series.seriesId } } as Project;
    const c = await compileSim(p, w.series);
    const r = await measure(async () => { const o = await simulateSystem(c.input!, c.hash!); if (!o || !o.ok) throw new Error('sim'); });
    report.systemYear = r; expect(r.p95Ms).toBeLessThanOrEqual(5000);
    const o = await simulateSystem(c.input!, c.hash!); if (!o || !o.ok) throw new Error('sim');
    const run = recordSim(o.result, { label: 'B', title: 'x', source: 'current', weatherHash: 'h'.repeat(64), series: true });
    let text = '';
    const build = await measure(async () => { text = await buildPackage({ kind: 'full', project: p, runs: [run], weather: w.series, includeContact: false, includeSeries: true, app: { buildId: 'b', engines: CURRENT_ENGINES } }); });
    const stage = await measure(async () => { const s = await stagePackage(text, new Set()); if (!s.ok) throw new Error('stage'); });
    report.package = { build, stage, fullBytes: text.length };
  }, 120000);
  test('bóng cả năm (40 tấm, 10 vật cản, lưới 4×4): ≤ 120 s; hủy ≤ 500 ms', async () => {
    let p = addInstances(createProject('bench'), catalog('vsun-620'), 40);
    p = addRoofFace(p, faceRect('Mái 40', 12.5, 10.5, 15, 180, { e: 0, n: 0, up: 3 }));
    p = fillFace(p, p.roofFaces[0].roofFaceId, p.instances.map((x) => x.instanceId)).project;
    for (let k = 0; k < 10; k++) p = addObstacle(p, { label: `v${k}`, kind: k % 2 ? 'cylinder' : 'box', roofFaceId: null, center: { e: 1 + k * 1.2, n: k % 2 ? -1.2 : 12.5 }, baseUp: 3, angleDeg: 20, size: { x: 1, y: 1, z: 2 } });
    const weather = { t0: Date.UTC(2023, 0, 1) / 1000, stepSeconds: 3600, n: 8760, location: { latitude: 11.87, longitude: 108.2, elevationM: 978 } };
    const spec = await buildShadeSpec(p, weather, { mode: 'standard', grid: 4 });
    const r = await measure(async () => { await computeShade(spec, null); });
    let flag = 0;
    await computeShade(spec, null, null, { onProgress: (d) => { if (d >= 240 && !flag) flag = performance.now(); }, isCancelled: () => flag > 0 });
    const cancelMs = performance.now() - flag;
    report.shadeYear = { ...r, panels: 40, obstacles: 10, samplesPerPanel: 16, steps: 8760, cancelMs: Math.round(cancelMs * 10) / 10 };
    expect(r.p95Ms).toBeLessThanOrEqual(120000); expect(cancelMs).toBeLessThanOrEqual(500);
  }, 300000);
  test.runIf(process.env.W09_EVIDENCE)('ghi benchmark cho evidence', () => {
    const dir = process.env.W09_EVIDENCE!;
    mkdirSync(dir, { recursive: true });
    (report.machine as Record<string, unknown>).rssMbEnd = rssMb();
    (report.machine as Record<string, unknown>).maxRssKb = process.resourceUsage().maxRSS;
    writeFileSync(`${dir}/benchmark.json`, JSON.stringify(report, null, 2) + '\n');
  });
});
