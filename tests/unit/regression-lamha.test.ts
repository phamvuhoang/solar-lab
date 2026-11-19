import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { beforeAll, describe, expect, test } from 'vitest';
import { BUILTIN_OFFERS, offersFor } from '../../src/catalog/catalog';
import { buildQuote } from '../../src/cost/quote';
import { setQuantity } from '../../src/cost/edit';
import { demoGableRoof, fillFace, moveObstacle, addObstacle } from '../../src/domain/layout-edit';
import { buildLamHaConfig } from '../../src/domain/presets';
import { openLamHa } from '../../src/domain/project';
import type { Project } from '../../src/domain/types';
import { hasErrors, validateProject } from '../../src/domain/validate';
import { compilePv } from '../../src/engine/compile';
import { simulatePv } from '../../src/engine/pv';
import { compileSim } from '../../src/engine/sim-compile';
import { simulateSystem, type SimResult } from '../../src/engine/system';
import { simMetrics } from '../../src/reports/package';
import { buildShadeSpec, computeShade, type ShadeField } from '../../src/shade/sampler';
import { validateDesign } from '../../src/validation/strings';
import { loadBundledWeather } from '../../src/weather/bundled';
import type { WeatherSeries } from '../../src/weather/series';
import { catalog } from './helpers';

/**
 * Lâm Hà regression matrix: 6 panels and 8 panels × pump at 18h and at 11h, and the water tank next to the roof.
 * Numbers are frozen in tests/fixtures/golden/lamha-matrix.json (regenerate with UPDATE_GOLDEN=1 and READ the diff:
 * a change in a golden number is a change in what the product tells the user).
 */
const GOLDEN = new URL('../fixtures/golden/lamha-matrix.json', import.meta.url);
const parts = () => ({ inverter: catalog('luxpower-sna6000wpv'), battery: catalog('used-battery'), home: catalog('sample-home-load'), pump: catalog('sample-pump-load'), controller: catalog('sample-pump-controller') });
const offers = (c: ReturnType<typeof catalog>) => offersFor(BUILTIN_OFFERS, c);
const vsun = { modelId: 'vsun-620', revision: 1 };
const pumpAt = (p: Project, hour: number): Project => ({ ...p, loadPlans: p.loadPlans!.map((l) => (l.pump ? { ...l, fractions: l.fractions.map((_, k) => (k === hour ? 1 : 0)) } : l)) });
const design = { coldCellTempC: 5, hotCellTempC: 70 };
function lamHa(panels: 6 | 8, pumpHour: 11 | 18, tank: 'none' | 'near' | 'far' = 'none'): Project {
  let p = panels === 8 ? openLamHa() : setQuantity(openLamHa(), vsun, 6);
  p = { ...buildLamHaConfig(p, 'shared8', parts(), offers), design, pv: { tiltDeg: 10, azimuthDeg: 180, weatherId: 'lam-ha-2023-pvgis-era5' } } as Project;
  p = pumpAt(p, pumpHour);
  if (tank !== 'none') {
    p = demoGableRoof(p);
    p = fillFace(p, p.roofFaces[0].roofFaceId, p.instances.filter((i) => i.kind === 'panel').map((i) => i.instanceId)).project;
    p = addObstacle(p, { label: 'Bồn nước', kind: 'cylinder', roofFaceId: null, center: { e: 11, n: -1 }, baseUp: 3, angleDeg: 0, size: { x: 1.3, y: 1.3, z: 2.5 } });
    if (tank === 'far') p = moveObstacle(p, p.obstacles![0].obstacleId, 5, 0);
    p = { ...p, shade: { enabled: true, mode: 'standard', grid: 4 } };
  }
  return p;
}

let weather: WeatherSeries;
beforeAll(async () => { const w = await loadBundledWeather('lam-ha-2023-pvgis-era5'); if (!w?.ok) throw new Error('weather'); weather = w.series; });

async function run(p: Project): Promise<{ r: SimResult; shade: ShadeField | null }> {
  let field: ShadeField | null = null;
  if (p.shade?.enabled) { const spec = await buildShadeSpec(p, weather, { mode: 'standard', grid: 4 }); field = (await computeShade(spec, null))!.field; }
  const c = await compileSim(p, weather, { shade: field });
  if (!c.input) throw new Error(JSON.stringify(c.issues));
  const o = await simulateSystem(c.input, c.hash!);
  if (!o || !o.ok) throw new Error('sim');
  return { r: o.result, shade: field };
}
const pick = (r: SimResult) => { const m = simMetrics(r); return Object.fromEntries(['pv.eInverterWh', 'dispatch.loadServedWh', 'dispatch.unservedWh', 'dispatch.dischargeBusWh', 'dispatch.curtailedWh', 'metrics.hoursShort', 'metrics.minSoc', 'metrics.socEnd'].map((k) => [k, m[k]])); };

const CASES: [string, Project][] = [];
describe('ma trận Lâm Hà: 6/8 tấm × bơm 18h/11h × bồn nước', () => {
  const results: Record<string, ReturnType<typeof pick>> = {};
  const raw: Record<string, SimResult> = {};
  beforeAll(async () => {
    for (const n of [6, 8] as const) for (const h of [18, 11] as const) { const k = `${n}tam-bom${h}h`; const { r } = await run(lamHa(n, h)); results[k] = pick(r); raw[k] = r; }
    for (const t of ['near', 'far'] as const) { const k = `8tam-bom11h-bon-${t}`; const { r } = await run(lamHa(8, 11, t)); results[k] = pick(r); raw[k] = r; }
    CASES.push(['x', lamHa(8, 11)]);
  }, 180000);

  test('mọi tổ hợp: dự án hợp lệ, thiết kế không có lỗi, sổ năng lượng cân từng bước, 8.760 bước', () => {
    for (const [k, r] of Object.entries(raw)) {
      expect(r.dispatch.period.n, k).toBe(8760);
      expect(r.dispatch.ledger.toleranceOk, k).toBe(true);
      expect(Math.max(...r.dispatch.series.residualWh.map(Math.abs)), k).toBeLessThan(0.01);
    }
    for (const n of [6, 8] as const) { const p = lamHa(n, 11); expect(hasErrors(validateProject(p))).toBe(false); expect(validateDesign(p).filter((f) => f.status === 'fail' && f.severity === 'error')).toEqual([]); }
  });
  test('giá: 8 tấm + bộ pin = 31.872.000 đ (thiếu 1.872.000 so với ngân sách 30 triệu); 6 tấm = 27.904.000 đ (vừa ngân sách); tổng hoàn chỉnh vẫn null', () => {
    const q8 = buildQuote(lamHa(8, 11)), q6 = buildQuote(lamHa(6, 11));
    expect(q8.knownSubtotalMinor).toBe('31872000'); expect(q6.knownSubtotalMinor).toBe('27904000');
    expect(BigInt(q8.knownSubtotalMinor) - 30_000_000n).toBe(1_872_000n);
    expect(BigInt(q6.knownSubtotalMinor) <= 30_000_000n).toBe(true);
    expect(q8.totalMinor).toBeNull(); expect(q6.totalMinor).toBeNull();
  });
  test('quan hệ vật lý: 6 tấm cho PV bằng 3/4 của 8 tấm; bơm 11h xả pin ít hơn 18h; bồn sát mái làm giảm PV, bồn xa thì không', () => {
    const e = (k: string) => raw[k].pv.totals.eInverterWh;
    expect(e('6tam-bom11h') / e('8tam-bom11h')).toBeCloseTo(0.75, 2);
    for (const n of [6, 8]) expect(results[`${n}tam-bom11h`]['dispatch.dischargeBusWh']!).toBeLessThan(results[`${n}tam-bom18h`]['dispatch.dischargeBusWh']!);
    expect(e('8tam-bom11h-bon-near')).toBeLessThan(e('8tam-bom11h-bon-far'));
    expect(e('8tam-bom11h-bon-far')).toBeLessThanOrEqual(e('8tam-bom11h') + 1e-6);
  });
  test('golden: kết quả khóa theo từng tổ hợp (sai lệch tương đối ≤ 1e-9)', () => {
    if (process.env.UPDATE_GOLDEN || !existsSync(GOLDEN)) { mkdirSync(new URL('./', GOLDEN), { recursive: true }); writeFileSync(GOLDEN, JSON.stringify({ engines: { pv: raw['8tam-bom11h'].pv.engineVersion, dispatch: raw['8tam-bom11h'].dispatch.version }, weather: weather.seriesId, cases: results }, null, 2) + '\n'); }
    const g = JSON.parse(readFileSync(GOLDEN, 'utf8'));
    expect(g.engines).toEqual({ pv: raw['8tam-bom11h'].pv.engineVersion, dispatch: raw['8tam-bom11h'].dispatch.version });
    for (const [k, m] of Object.entries(results)) for (const [name, v] of Object.entries(m)) {
      const want = g.cases[k][name] as number | null;
      if (v === null || want === null) expect(v, `${k} ${name}`).toBe(want);
      else expect(Math.abs(v - want) / Math.max(1, Math.abs(want)), `${k} ${name}`).toBeLessThanOrEqual(1e-9);
    }
  });
});
