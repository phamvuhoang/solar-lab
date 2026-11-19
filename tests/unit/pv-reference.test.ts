import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { simulatePv } from '../../src/engine/pv';
import { parseWeatherCsv } from '../../src/weather/csv';
import { input, model, wx } from './pv-helpers';

const fx = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/reference/${name}`, import.meta.url), 'utf8'));
const root = (p: string) => new URL(`../../${p}`, import.meta.url);

interface Ref { apparentZenithDeg: number[]; azimuthDeg: number[]; poaWm2: number[]; tcellC: number[]; pdcW: number[] }
interface Model { tiltDeg: number; azimuthDeg: number; albedo: number; faimanU0: number; faimanU1: number; gamma: number; pstcW: number; nPanels: number }

// Targets from docs/04-implementation.md §"Kiểm thử số học" (same model, same parameters):
//   PV power ≤1 % where P > 10 % Pstc, else absolute ≤1 % Pstc; total kWh ≤2 %.
const TOL = { zenithDeg: 0.05, azimuthDeg: 0.05, poaRel: 0.01, tcellC: 0.05, energyRel: 0.02 };

async function compare(weathers: ReturnType<typeof wx>[], loc: Model, ref: Ref) {
  const panels = Array.from({ length: loc.nPanels }, () => ({ pstcW: loc.pstcW, gamma: loc.gamma, vmpV: null }));
  const m = model({ tiltDeg: loc.tiltDeg, azimuthDeg: loc.azimuthDeg, albedo: loc.albedo, cellModel: 'faiman', faimanU0: loc.faimanU0, faimanU1: loc.faimanU1, applyLimits: false });
  // Non-contiguous days are separate regular series; results are concatenated in the same order as the reference.
  const runs = await Promise.all(weathers.map((w) => simulatePv(input(w, m, [{ id: 'S', label: 'S', panels, trackerId: 'T1' }]), 'ref')));
  runs.forEach((x) => expect(x!.issues).toEqual([]));
  const cat = (k: 'zenithDeg' | 'azimuthDeg' | 'poaWm2' | 'tcellC' | 'pIdealW') => runs.flatMap((x) => x!.series[k]);
  const r = { series: { zenithDeg: cat('zenithDeg'), azimuthDeg: cat('azimuthDeg'), poaWm2: cat('poaWm2'), tcellC: cat('tcellC'), pIdealW: cat('pIdealW') } };
  const pTotal = loc.pstcW * loc.nPanels;
  let zen = 0, az = 0, poa = 0, tc = 0, pRel = 0, pAbs = 0, pFail = 0;
  const n = ref.pdcW.length;
  for (let i = 0; i < n; i++) {
    zen = Math.max(zen, Math.abs(r.series.zenithDeg[i] - ref.apparentZenithDeg[i]));
    if (ref.apparentZenithDeg[i] < 85) az = Math.max(az, Math.abs(r.series.azimuthDeg[i] - ref.azimuthDeg[i]));
    if (ref.poaWm2[i] > 50) poa = Math.max(poa, Math.abs(r.series.poaWm2[i] - ref.poaWm2[i]) / ref.poaWm2[i]);
    if (ref.poaWm2[i] > 0) tc = Math.max(tc, Math.abs(r.series.tcellC[i] - ref.tcellC[i]));
    const d = Math.abs(r.series.pIdealW[i] - ref.pdcW[i]);
    if (ref.pdcW[i] > 0.1 * pTotal) { pRel = Math.max(pRel, d / ref.pdcW[i]); if (d / ref.pdcW[i] > 0.01) pFail++; }
    else { pAbs = Math.max(pAbs, d / pTotal); if (d > 0.01 * pTotal) pFail++; }
  }
  const eRef = ref.pdcW.reduce((a, b) => a + b, 0), eTs = r.series.pIdealW.reduce((a, b) => a + b, 0);
  return { steps: n, maxZenithErrDeg: zen, maxAzimuthErrDeg: az, maxPoaRelErr: poa, maxTcellErrC: tc, maxPowerRelErrAbove10pct: pRel, maxPowerAbsErrBelow10pctOfPstc: pAbs, powerChecksFailed: pFail, energyRelErr: Math.abs(eTs - eRef) / eRef, eTsWh: eTs, eRefWh: eRef };
}

const report: Record<string, unknown> = {};

describe('đối chiếu pvlib (cùng fixture, cùng tham số)', () => {
  const synth = fx('synthetic.json');
  test('metadata phiên bản được lưu cùng fixture', () => {
    expect(synth.meta).toMatchObject({ pvlib: '0.13.0', numpy: '2.0.2', pandas: '2.3.3' });
    expect(synth.meta.models.transposition).toBe('isotropic');
    report.versions = synth.meta;
  });
  for (const c of synth.cases) {
    test(`${c.id}: vị trí mặt trời, POA, Tcell và công suất trong ngưỡng`, async () => {
      const ws = c.segments.map((g: Record<string, number[]> & { t0: number }) => wx({ n: g.ghi.length, t0: g.t0, stepSeconds: 3600, ghi: g.ghi, dni: g.dni, dhi: g.dhi, tempAirC: g.tempAirC, windMs: g.windMs, location: c.location }));
      const s = await compare(ws, c.model, c.reference);
      report[c.id] = s;
      expect(s.maxZenithErrDeg).toBeLessThanOrEqual(TOL.zenithDeg);
      expect(s.maxAzimuthErrDeg).toBeLessThanOrEqual(TOL.azimuthDeg);
      expect(s.maxPoaRelErr).toBeLessThanOrEqual(TOL.poaRel);
      expect(s.maxTcellErrC).toBeLessThanOrEqual(TOL.tcellC);
      expect(s.powerChecksFailed).toBe(0);
      expect(s.energyRelErr).toBeLessThanOrEqual(TOL.energyRel);
    });
  }
  test('Lâm Hà 2023 (PVGIS-ERA5, 8.760 giờ): cùng file CSV, kWh năm ≤2 %, công suất ≤1 %', async () => {
    const y = fx('lam-ha-2023.json');
    const bytes = readFileSync(root(y.inputFile));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(y.inputSha256); // fixture was made from exactly this file
    const parsed = parseWeatherCsv(bytes.toString('utf8'));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const s = await compare([parsed.series], y.model, y.reference);
    report.lamha_2023 = { ...s, annualKWhPvlib: y.reference.annualKWh, annualKWhTs: s.eTsWh / 1000 };
    expect(s.maxZenithErrDeg).toBeLessThanOrEqual(TOL.zenithDeg);
    expect(s.maxAzimuthErrDeg).toBeLessThanOrEqual(TOL.azimuthDeg);
    expect(s.maxPoaRelErr).toBeLessThanOrEqual(TOL.poaRel);
    expect(s.powerChecksFailed).toBe(0);
    expect(s.energyRelErr).toBeLessThanOrEqual(TOL.energyRel);
    expect(Math.abs(s.eTsWh / 1000 - y.reference.annualKWh) / y.reference.annualKWh).toBeLessThanOrEqual(0.02);
  });
  test.runIf(process.env.W04_EVIDENCE)('ghi bảng đối chiếu cho evidence', () => {
    const dir = process.env.W04_EVIDENCE!;
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/reference-comparison.json`, JSON.stringify({ tolerances: TOL, ...report }, null, 2) + '\n');
  });
});
