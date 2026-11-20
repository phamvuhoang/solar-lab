import { beforeAll, expect, test } from 'vitest';
import { buildSampleHouse, SAMPLE_WEATHER_ID } from '../../src/domain/seed';
import { compileSim } from '../../src/engine/sim-compile';
import { simulateSystem, type SimResult } from '../../src/engine/system';
import { flowsAt } from '../../src/scene/flows';
import { buildSceneModel } from '../../src/scene/model';
import { buildShadeSpec, computeShade, shadeSettingsOf } from '../../src/shade/sampler';
import { loadBundledWeather } from '../../src/weather/bundled';
import { localHour } from '../../src/weather/series';

const p = buildSampleHouse('2026-11-20T00:00:00.000Z'), m = buildSceneModel(p), tz = p.location?.timezone ?? 'Asia/Ho_Chi_Minh';
let r: SimResult;
beforeAll(async () => {
  const w = await loadBundledWeather(SAMPLE_WEATHER_ID);
  if (!w?.ok) throw new Error('weather');
  const field = (await computeShade(await buildShadeSpec(p, w.series, shadeSettingsOf(p)), null))!.field;
  const c = await compileSim(p, w.series, { shade: field });
  const o = await simulateSystem(c.input!, c.hash!);
  if (!o || !o.ok) throw new Error('sim');
  r = o.result;
}, 120000);

const stepsAt = (hour: number) => r.dispatch.series.t.flatMap((t, i) => (localHour(t, tz) === hour ? [i] : []));
/** 11h of the sunniest day: the 11h step with the most PV before limits. */
const sunny11 = () => stepsAt(11).reduce((a, i) => (r.dispatch.series.pvPotentialWh[i] > r.dispatch.series.pvPotentialWh[a] ? i : a));
const pv = (step: number) => flowsAt(m, r, step).flows.filter((f) => m.wires.find((w) => w.id === f.wireId)!.kind === 'dc-pv');

test('11h ngày nắng: hai dây dc-pv có công suất, chiều từ tấm vào inverter', () => {
  const f = pv(sunny11());
  expect(f).toHaveLength(2);
  expect(f.every((x) => x.w > 0 && x.dir === 1)).toBe(true);
});

test('0h: dc-pv bằng 0', () => {
  const f = pv(stepsAt(0)[0]);
  expect(f).toHaveLength(2);
  expect(f.every((x) => x.w === 0)).toBe(true);
});

test('mọi dòng chữ có số và "kW", không có NaN', () => {
  for (const step of [sunny11(), stepsAt(0)[0], stepsAt(18)[100], r.dispatch.period.n - 1]) {
    const { flows, text } = flowsAt(m, r, step);
    expect(text.length).toBeGreaterThanOrEqual(4);
    for (const t of text) { expect(t).toMatch(/\d kW$/); expect(t).not.toContain('NaN'); }
    const s = r.dispatch.series;
    expect(text.some((t) => t.startsWith('PV dư bị cắt '))).toBe(s.curtailedWh[step] - s.clipWh[step] > 0.5); // a limit is said, never hidden
    expect(flows.every((f) => Number.isFinite(f.w) && f.w >= 0)).toBe(true);
  }
});

test('mũi tên chỉ đúng chiều: sạc thì về pin, xả thì về inverter, AC thì về tải', () => {
  const s = r.dispatch.series, kind = (v: { e: number; n: number; up: number }) => m.devices.find((d) => d.center.e === v.e && d.center.n === v.n && d.center.up === v.up)?.kind;
  const head = (f: { wireId: string; dir: 1 | -1 }) => { const w = m.wires.find((x) => x.id === f.wireId)!; return kind(f.dir === 1 ? w.to : w.from); };
  const charging = s.t.findIndex((_, i) => s.chargeBusWh[i] > 100), discharging = s.t.findIndex((_, i) => s.dischargeBusWh[i] > 100);
  const bat = (step: number) => flowsAt(m, r, step).flows.find((f) => m.wires.find((w) => w.id === f.wireId)!.kind === 'dc-bat')!;
  expect(head(bat(charging))).toBe('battery');
  expect(head(bat(discharging))).toBe('inverter');
  const { flows, text } = flowsAt(m, r, charging);
  expect(text.some((t) => t.startsWith('Pin: sạc '))).toBe(true);
  expect(flowsAt(m, r, discharging).text.some((t) => t.startsWith('Pin: xả '))).toBe(true);
  const ac = flows.filter((f) => m.wires.find((w) => w.id === f.wireId)!.kind === 'ac');
  expect(ac).toHaveLength(2);
  expect(ac.every((f) => head(f) === 'load')).toBe(true);
});
