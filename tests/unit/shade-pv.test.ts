import { describe, expect, test } from 'vitest';
import { applyPreset } from '../../src/domain/presets';
import { openLamHa } from '../../src/domain/project';
import { compilePv, hashPvInput } from '../../src/engine/compile';
import { isotropicPoa, simulatePv, type PvInput } from '../../src/engine/pv';
import { pressureAt, sunPosition } from '../../src/engine/solar';
import type { ShadeField } from '../../src/shade/sampler';
import { catalog } from './helpers';
import { input, model, panel, wx } from './pv-helpers';

const T0 = Date.UTC(2023, 11, 21, 4) / 1000; // 11:00 giờ địa phương, Mặt Trời gần thiên đỉnh phía Nam
const field = (access: number[][], over: Partial<ShadeField> = {}): ShadeField => ({
  key: 'k1', geometryHash: 'g', modelVersion: 'shade-raycast-1.0.0', mode: 'standard', grid: 4, samplesPerPanel: 16, rayOffsetM: 0.001,
  panelIds: access.map((_, k) => `P${k + 1}`), t0: T0, stepSeconds: 3600, n: access[0].length, access: access.map((a) => Float32Array.from(a)), done: new Uint8Array(access[0].length).fill(1), obstacles: [], computeMs: 0, ...over,
});
/** One hour with DNI chosen so that the direct component on a horizontal plane is exactly 800 W/m²; DHI 200, albedo 0 → sky 200, ground 0. */
const sunny = () => {
  const sp = sunPosition(T0 + 1800, 11.87, 108.2, { pressurePa: pressureAt(0) });
  const cz = Math.cos((sp.apparentZenithDeg * Math.PI) / 180);
  const dni = 800 / cz, dhi = 200;
  return wx({ n: 1, t0: T0, stepSeconds: 3600, ghi: [dni * cz + dhi], dni: [dni], dhi: [dhi], location: { latitude: 11.87, longitude: 108.2, elevationM: 0 } });
};
const flatModel = model({ tiltDeg: 0, azimuthDeg: 180, albedo: 0, cellModel: 'fixed', fixedCellTempC: 25, applyLimits: false });
const withIds = (n: number) => Array.from({ length: n }, (_, k) => ({ ...panel(), id: `P${k + 1}`, shadeIdx: k }));
const run = async (i: PvInput) => (await simulatePv(i, 'h'))!;
const mk = (n: number, f: ShadeField | null, m = flatModel) => ({ ...input(sunny(), m, [{ id: 'S', label: 'S', panels: withIds(n), trackerId: 'T1' }]), shade: f });

describe('POA hiệu dụng khi có bóng (nghiệm thu)', () => {
  test('trực xạ 800, khuếch tán 200, ground 0, direct access 0,5 → POA hiệu dụng 600 W/m²: tấm 620 W phát 372 W (không bóng: 620 W)', async () => {
    const check = isotropicPoa(800, 200, 800, 1, 0, 0);
    expect([check.direct, check.sky, check.ground]).toEqual([800, 200, 0]);
    const r = await run(mk(1, field([[0.5]])));
    expect(r.issues).toEqual([]);
    expect(r.series.pIdealW[0]).toBeCloseTo(372, 6);
    expect((await run(mk(1, null))).series.pIdealW[0]).toBeCloseTo(620, 6);
    expect(r.shade!.panels[0]).toMatchObject({ id: 'P1', directAccess: 0.5 });
    expect(r.shade!.panels[0].eIdealWh).toBeCloseTo(372, 6);
    expect(r.shade!.panels[0].eIdealNoShadeWh).toBeCloseTo(620, 6);
  });
  test('tấm bị che hoàn toàn vẫn còn khuếch tán: 200 W/m² → 124 W, không phải 0', async () => {
    const r = await run(mk(1, field([[0]])));
    expect(r.series.pIdealW[0]).toBeCloseTo(124, 6);
    expect(r.shade!.panels[0].directAccess).toBe(0);
  });
  test('ban đêm không có trực xạ nên access không có tác dụng và directAccess là null (không chia cho 0)', async () => {
    const w = wx({ n: 1, t0: Date.UTC(2023, 11, 21, 16) / 1000, ghi: [0], dni: [0], dhi: [0], location: { latitude: 11.87, longitude: 108.2, elevationM: 0 } });
    const r = await run({ ...input(w, flatModel, [{ id: 'S', label: 'S', panels: withIds(1), trackerId: 'T1' }]), shade: field([[0]], { t0: w.t0 }) });
    expect(r.series.pIdealW[0]).toBe(0);
    expect(r.shade!.panels[0].directAccess).toBeNull();
  });
});

describe('chuỗi: cận trên và cận dưới, bóng tách khỏi clipping', () => {
  const access = [[1], [1], [1], [0]];
  test('cộng công suất (cận trên) so với tấm yếu nhất quyết định chuỗi (cận dưới)', async () => {
    const up = await run(mk(4, field(access)));
    const low = await run(mk(4, field(access), { ...flatModel, stringMode: 'weakest' }));
    expect(up.series.pIdealW[0]).toBeCloseTo(3 * 620 + 124, 6);
    expect(low.series.pIdealW[0]).toBeCloseTo(4 * 124, 6);
    expect(up.shade!.stringMode).toBe('sum');
    expect(low.shade!.stringMode).toBe('weakest');
    expect(up.shade!.notes.join()).toContain('bypass diode');
  });
  test('hiệu ứng bóng ở bước lý tưởng là riêng; clipping của tracker không bị lẫn vào', async () => {
    const lim = { ...flatModel, applyLimits: true };
    const i = (f: ShadeField | null): PvInput => ({ ...mk(4, f, lim), trackers: [{ id: 'T1', label: 'T1', inverterId: null, maxPowerW: 1000, maxCurrentA: null }] });
    const free = await run(i(null)), shaded = await run(i(field(access)));
    expect(shaded.totals.eIdealWh).toBeLessThan(free.totals.eIdealWh); // bóng làm giảm ở bước lý tưởng
    expect(shaded.totals.eTrackerWh).toBeCloseTo(free.totals.eTrackerWh, 6); // nhưng cả hai đều bị tracker cắt về 1.000 W: bóng bị clipping che khuất
    expect(shaded.totals.clippedTrackerWh).toBeLessThan(free.totals.clippedTrackerWh); // phần bị cắt khác nhau nên không thể suy hiệu ứng bóng từ clipping
  });
  test('tấm không có dữ liệu bóng (chưa đặt lên mái) không bị che; thống kê chỉ gồm tấm có dữ liệu', async () => {
    const panels = [{ ...panel(), id: 'P1', shadeIdx: 0 }, { ...panel(), id: 'PX' }];
    const r = await run({ ...input(sunny(), flatModel, [{ id: 'S', label: 'S', panels, trackerId: 'T1' }]), shade: field([[0]]) });
    expect(r.shade!.panels.map((p) => p.id)).toEqual(['P1']);
    expect(r.series.pIdealW[0]).toBeCloseTo(124 + 620, 6);
  });
});

describe('kiểm tra đầu vào bóng', () => {
  test('lưới thời gian lệch, thiếu bước, nguồn POA: từ chối kèm lý do', async () => {
    expect((await run(mk(1, field([[0.5]], { t0: T0 + 3600 })))).issues.map((i) => i.code)).toEqual(['SHADE_GRID_MISMATCH']);
    const half = field([[0.5]]); half.done = new Uint8Array([0]);
    expect((await run(mk(1, half))).issues[0]).toMatchObject({ code: 'SHADE_INCOMPLETE' });
    const poaW = wx({ n: 1, t0: T0, poa: [800], tempAirC: [25], windMs: [1] });
    const r = await run({ ...input(poaW, model({ irradianceInput: 'poa' }), [{ id: 'S', label: 'S', panels: withIds(1), trackerId: 'T1' }]), shade: field([[0.5]]) });
    expect(r.issues.map((i) => i.code)).toContain('SHADE_NEEDS_COMPONENTS');
  });
  test('mã đầu vào đổi khi đổi dữ liệu bóng hoặc chế độ chuỗi; giữ nguyên khi không đổi', async () => {
    const h = (f: ShadeField | null, m = flatModel) => hashPvInput({ ...mk(1, f, m), weatherHash: 'w' });
    const base = await h(field([[0.5]]));
    expect(await h(field([[0.5]]))).toBe(base);
    expect(await h(field([[0.5]], { key: 'k2' }))).not.toBe(base);
    expect(await h(null)).not.toBe(base);
    expect(await h(field([[0.5]]), { ...flatModel, stringMode: 'weakest' })).not.toBe(base);
  });
  test('compile gắn dòng dữ liệu bóng cho đúng tấm theo ID; hướng không đổi', () => {
    const p = { ...applyPreset(openLamHa(), 'two-trackers', catalog('luxpower-sna6000wpv')), pv: { tiltDeg: 10, azimuthDeg: 180 } };
    const ids = p.instances.filter((i) => i.kind === 'panel').map((i) => i.instanceId);
    const f = field(ids.slice(0, 3).map(() => [1]), { panelIds: ids.slice(0, 3) });
    const c = compilePv(p, wx({ n: 1, poa: [1] }), { shade: f });
    expect(c.issues).toEqual([]);
    const pan = c.input!.strings.flatMap((s) => s.panels);
    expect(pan.filter((x) => x.shadeIdx !== undefined)).toHaveLength(3);
    expect(pan.find((x) => x.id === ids[1])!.shadeIdx).toBe(1);
    expect(c.input!.shade).toBe(f);
  });
});
