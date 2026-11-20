import { beforeAll, expect, test } from 'vitest';
import { BUILTIN_OFFERS, offersFor } from '../../src/catalog/catalog';
import { buildLamHaConfig } from '../../src/domain/presets';
import { openLamHa } from '../../src/domain/project';
import { buildSampleHouse, SAMPLE_WEATHER_ID } from '../../src/domain/seed';
import type { Project } from '../../src/domain/types';
import { compileSim } from '../../src/engine/sim-compile';
import { simulateSystem, type SimResult } from '../../src/engine/system';
import { flowsAt } from '../../src/scene/flows';
import { buildSceneModel } from '../../src/scene/model';
import type { ShadeField } from '../../src/shade/sampler';
import { buildShadeSpec, computeShade, shadeSettingsOf } from '../../src/shade/sampler';
import { loadBundledWeather } from '../../src/weather/bundled';
import type { WeatherSeries } from '../../src/weather/series';
import { localHour } from '../../src/weather/series';
import { catalog } from './helpers';

const tz = 'Asia/Ho_Chi_Minh';
const p = buildSampleHouse('2026-11-20T00:00:00.000Z'), m = buildSceneModel(p);
const exporting: Project = { ...p, sim: { ...p.sim, exportAllowed: true } };
const split = { ...buildLamHaConfig(openLamHa(), 'split6+2', { inverter: catalog('luxpower-sna6000wpv'), battery: catalog('used-battery'), home: catalog('sample-home-load'), pump: catalog('sample-pump-load'), controller: catalog('sample-pump-controller') }, (c) => offersFor(BUILTIN_OFFERS, c)), pv: { tiltDeg: 10, azimuthDeg: 180 } } as Project;
let r: SimResult, rx: SimResult, rs: SimResult;
const run = async (q: Project, w: WeatherSeries, shade: ShadeField | null) => {
  const c = await compileSim(q, w, { shade });
  expect(c.issues).toEqual([]);
  const o = await simulateSystem(c.input!, c.hash!);
  if (!o || !o.ok) throw new Error('sim');
  return o.result;
};
beforeAll(async () => {
  const w = await loadBundledWeather(SAMPLE_WEATHER_ID);
  if (!w?.ok) throw new Error('weather');
  const field = (await computeShade(await buildShadeSpec(p, w.series, shadeSettingsOf(p)), null))!.field;
  r = await run(p, w.series, field);
  rx = await run(exporting, w.series, field);
  rs = await run(split, w.series, null);
}, 180000);

const stepsAt = (x: SimResult, hour: number) => x.dispatch.series.t.flatMap((t, i) => (localHour(t, tz) === hour ? [i] : []));
/** `hour` of the sunniest day: the step at that hour with the most PV before limits. */
const sunny = (x: SimResult, hour: number) => stepsAt(x, hour).reduce((a, i) => (x.dispatch.series.pvPotentialWh[i] > x.dispatch.series.pvPotentialWh[a] ? i : a));
const kind = (mm: typeof m, id: string) => mm.wires.find((w) => w.id === id)!.kind;
const pv = (step: number) => flowsAt(m, r, step, p).flows.filter((f) => kind(m, f.wireId) === 'dc-pv');
const kw = (wh: number) => `${(wh / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} kW`; // hourly steps: Wh = W
const NOTE = 'Mũi tên AC là tổng các tải, không chia theo từng tải';

test('11h ngày nắng: hai dây dc-pv có công suất, chiều từ tấm vào inverter', () => {
  const f = pv(sunny(r, 11));
  expect(f).toHaveLength(2);
  expect(f.every((x) => x.w > 0 && x.dir === 1)).toBe(true);
});

test('0h: dc-pv bằng 0', () => {
  const f = pv(stepsAt(r, 0)[0]);
  expect(f).toHaveLength(2);
  expect(f.every((x) => x.w === 0)).toBe(true);
});

test('mọi dòng chữ có số và "kW", không có NaN', () => {
  for (const step of [sunny(r, 11), stepsAt(r, 0)[0], stepsAt(r, 18)[100], r.dispatch.period.n - 1]) {
    const { flows, text } = flowsAt(m, r, step, p);
    expect(text.length).toBeGreaterThanOrEqual(4);
    for (const t of text.filter((x) => x !== NOTE)) { expect(t).toMatch(/\d kW$/); expect(t).not.toContain('NaN'); }
    const s = r.dispatch.series;
    expect(text.some((t) => t.startsWith('PV dư bị cắt '))).toBe(s.curtailedWh[step] - s.clipWh[step] > 0.5); // a limit is said, never hidden
    expect(flows.every((f) => Number.isFinite(f.w) && f.w >= 0)).toBe(true);
  }
});

test('mũi tên chỉ đúng chiều: sạc thì về pin, xả thì về inverter, AC thì về tải', () => {
  const s = r.dispatch.series, at = (v: { e: number; n: number; up: number }) => m.devices.find((d) => d.center.e === v.e && d.center.n === v.n && d.center.up === v.up)?.kind;
  const head = (f: { wireId: string; dir: 1 | -1 }) => { const w = m.wires.find((x) => x.id === f.wireId)!; return at(f.dir === 1 ? w.to : w.from); };
  const charging = s.t.findIndex((_, i) => s.chargeBusWh[i] > 100), discharging = s.t.findIndex((_, i) => s.dischargeBusWh[i] > 100);
  const bat = (step: number) => flowsAt(m, r, step, p).flows.find((f) => kind(m, f.wireId) === 'dc-bat')!;
  expect(head(bat(charging))).toBe('battery');
  expect(head(bat(discharging))).toBe('inverter');
  const { flows, text } = flowsAt(m, r, charging, p);
  expect(text.some((t) => t.startsWith('Pin: sạc '))).toBe(true);
  expect(flowsAt(m, r, discharging, p).text.some((t) => t.startsWith('Pin: xả '))).toBe(true);
  const ac = flows.filter((f) => kind(m, f.wireId) === 'ac');
  expect(ac).toHaveLength(2);
  expect(ac.every((f) => head(f) === 'load')).toBe(true);
});

test('tải AC không chạy giờ này thì dây của nó bằng 0; hai tải cùng chạy thì chữ nói mũi tên là tổng', () => {
  const s = r.dispatch.series, plan = (h: number) => p.loadPlans!.find((l) => l.fractions[12] === 0 && l.fractions[h] > 0)!; // the pump: 18h only
  const wireOf = (id: string) => `wire:${p.edges.find((e) => e.from.instanceId === id || e.to.instanceId === id)!.edgeId}`;
  const pump = wireOf(plan(18).instanceId), home = wireOf(p.loadPlans!.find((l) => l.fractions.every((x) => x > 0))!.instanceId);
  const noon = sunny(r, 12), acW = (i: number) => s.loadServedWh[i] - s.branchServedWh[i];
  const a = flowsAt(m, r, noon, p);
  expect(a.flows.find((f) => f.wireId === pump)!.w).toBe(0);
  expect(a.flows.find((f) => f.wireId === home)!.w).toBeCloseTo(acW(noon), 9); // the one load running carries the AC total
  expect(a.text).not.toContain(NOTE);
  const eve = stepsAt(r, 18)[100], b = flowsAt(m, r, eve, p);
  expect(b.flows.filter((f) => f.wireId === pump || f.wireId === home).map((f) => f.w)).toEqual([acW(eve), acW(eve)].map((x) => expect.closeTo(x, 9)));
  expect(b.text).toContain(NOTE);
});

test('cấu hình 6+2: nhánh bơm nói PV, phần bơm nhận và phần bị cắt, đúng chuỗi của engine', () => {
  const ms = buildSceneModel(split), s = rs.dispatch.series, i = sunny(rs, 12);
  expect(ms.wires.some((w) => w.kind === 'dc-pump')).toBe(true);
  const { flows, text } = flowsAt(ms, rs, i, split);
  expect(s.branchCurtailedWh[i]).toBeGreaterThan(0); // the pump runs at 18h: at noon the branch PV is cut
  expect(text).toContain(`Nhánh bơm: PV ${kw(s.branchPotentialWh[i])}, bơm nhận ${kw(s.branchServedWh[i])}, bị cắt ${kw(s.branchCurtailedWh[i])}`);
  expect(flows.find((f) => kind(ms, f.wireId) === 'dc-pump')!.w).toBe(s.branchServedWh[i]);
});

test('cho xuất lưới: chữ có "Lưới xuất" đúng số của engine, cạnh "Lưới nhập"', () => {
  const s = rx.dispatch.series, i = s.exportWh.reduce((a, x, k) => (x > s.exportWh[a] ? k : a), 0);
  expect(s.exportWh[i]).toBeGreaterThan(0.5);
  const { text } = flowsAt(m, rx, i, exporting);
  expect(text).toContain(`Lưới xuất ${kw(s.exportWh[i])}`);
  expect(text).toContain(`Lưới nhập ${kw(s.gridImportWh[i])}`);
  expect(flowsAt(m, r, i, p).text.some((t) => t.startsWith('Lưới xuất'))).toBe(false); // the sample does not export
});

test('bước thiếu điện: chữ nói "Thiếu x kW" (Tải là phần đã cấp); bước đủ điện thì không', () => {
  const s = rs.dispatch.series, i = s.unservedWh.findIndex((x) => x > 0), ok = s.unservedWh.findIndex((x) => x === 0);
  expect(i).toBeGreaterThanOrEqual(0); // Lâm Hà 6+2 không có lưới: có giờ thiếu
  const { text } = flowsAt(buildSceneModel(split), rs, i, split);
  expect(text).toContain(`Thiếu ${kw(s.unservedWh[i])}`);
  expect(text).toContain(`Tải: ${kw(s.loadServedWh[i])}`);
  expect(flowsAt(buildSceneModel(split), rs, ok, split).text.some((t) => t.startsWith('Thiếu'))).toBe(false);
});
