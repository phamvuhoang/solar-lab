import { describe, expect, test } from 'vitest';
import { BUILTIN_COMPONENTS, BUILTIN_OFFERS, findComponent, offersFor } from '../../src/catalog/catalog';
import { addPumpBranch, buildLamHaConfig } from '../../src/domain/presets';
import { stringsOf } from '../../src/domain/graph';
import { setQuantity } from '../../src/cost/edit';
import { openLamHa } from '../../src/domain/project';
import type { Project } from '../../src/domain/types';
import { hasErrors, validateProject } from '../../src/domain/validate';
import { validateDesign } from '../../src/validation/strings';
import { compileSim, formatHours, parseHours } from '../../src/engine/sim-compile';
import { simHash, simulateSystem } from '../../src/engine/system';
import { loadBundledWeather } from '../../src/weather/bundled';
import { createPvHandler } from '../../src/worker/pv-handler';
import type { RunEvent } from '../../src/worker/protocol';
import { wx } from './pv-helpers';
import { catalog } from './helpers';

const parts = () => ({ inverter: catalog('luxpower-sna6000wpv'), battery: catalog('used-battery'), home: catalog('sample-home-load'), pump: catalog('sample-pump-load'), controller: catalog('sample-pump-controller') });
const offers = (c: ReturnType<typeof catalog>) => offersFor(BUILTIN_OFFERS, c);
const config = (k: 'shared8' | 'split6+2', extra: Partial<Project> = {}) => ({ ...buildLamHaConfig(openLamHa(), k, parts(), offers), pv: { tiltDeg: 10, azimuthDeg: 180 }, ...extra }) as Project;
const w = () => wx({ n: 48, t0: Date.UTC(2023, 5, 1) / 1000, poa: Array.from({ length: 48 }, (_, i) => Math.max(0, 900 * Math.sin((Math.PI * ((i % 24) - 6)) / 12))), tempAirC: Array(48).fill(25), windMs: Array(48).fill(1) });

describe('lịch giờ', () => {
  test('đọc và in lại: 11 · 6-8,18-22 · 18-20@0,5', () => {
    const f = (t: string) => { const r = parseHours(t); if (!r.ok) throw new Error(r.message); return r.fractions; };
    expect(f('11').map((x, h) => (x ? h : -1)).filter((h) => h >= 0)).toEqual([11]);
    expect(f('6-8,18-22').filter(Boolean)).toHaveLength(8);
    expect(f('18-20@0,5')[19]).toBe(0.5);
    expect(formatHours(f('6-8,18-22@0,5'))).toBe('6-8,18-22@0,5');
    expect(formatHours(f(''))).toBe('');
  });
  test('báo lỗi rõ: giờ ngoài 0–23, ngược chiều, tỉ lệ sai, chữ', () => {
    for (const bad of ['24', '8-6', '5@0', '5@2', 'abc', '5-']) expect(parseHours(bad).ok, bad).toBe(false);
    expect(parseHours('8-6')).toMatchObject({ ok: false, message: expect.stringContaining('tăng dần') });
  });
});

describe('cấu hình mẫu Lâm Hà và biên dịch', () => {
  test('A: 8 tấm vào inverter (4+4), pin cũ nối BAT, nhà và bơm AC; không có lỗi thiết kế', () => {
    const p = config('shared8');
    expect(p.strings!.map((s) => s.panelIds.length)).toEqual([4, 4]);
    expect(p.instances.filter((i) => i.kind === 'battery')).toHaveLength(1); // dùng pin cũ có sẵn, không thêm bản thứ hai
    expect(validateDesign({ ...p, design: { coldCellTempC: 5, hotCellTempC: 70 } }).filter((f) => f.status === 'fail' && f.severity === 'error')).toEqual([]);
    expect(hasErrors(validateProject(p))).toBe(false);
    expect(p.loadPlans!.map((l) => l.priority)).toEqual([1, 2]);
  });
  test('B: 6 tấm vào inverter (một chuỗi 6: chia 3 + 3 thì Vmp sát đáy MPPT), 2 tấm vào controller, bơm DC; dựng lại hai lần cho cùng thiết kế', () => {
    const p = config('split6+2');
    expect(p.strings!.map((s) => [s.panelIds.length, s.target?.port])).toEqual([[6, 'M1'], [2, 'PV']]);
    expect(p.instances.filter((i) => i.kind === 'controller')).toHaveLength(1);
    const again = buildLamHaConfig(p, 'split6+2', parts(), offers);
    expect(again.instances.map((i) => i.label)).toEqual(p.instances.map((i) => i.label));
    const back = buildLamHaConfig(p, 'shared8', parts(), offers); // đổi A/B qua lại không để sót thiết bị
    expect(back.instances.some((i) => i.kind === 'controller')).toBe(false);
  });
  test('compile A: giới hạn từ datasheet, SoH chưa đo ghi là giả định', async () => {
    const r = await compileSim(config('shared8'), w());
    expect(r.issues).toEqual([]);
    const s = r.input!.spec;
    expect(s.inverter).toMatchObject({ acRatedW: 6000, efficiency: 0.93, surgeW: 12000, maxChargeW: 140 * 51.2, maxDischargeW: 140 * 51.2 });
    expect(s.bank).toMatchObject({ nominalWh: 8448, sohRatio: 1, socMin: 0.2, socMax: 1, maxChargeW: null, maxDischargeW: 100 * 51.2 });
    expect(s.loads.map((l) => [l.label, l.feed, l.priority])).toEqual([['Tải sinh hoạt 300 W (tải mẫu)', 'inverter', 1], ['Bơm nước 750 W (tải mẫu)', 'inverter', 2]]);
    expect(r.notes.join()).toContain('SoH chưa đo');
    expect(s.branchTrackerId).toBeNull();
  });
  test('compile B: bơm DC cấp từ nhánh controller', async () => {
    const r = await compileSim(config('split6+2'), w());
    expect(r.issues).toEqual([]);
    expect(r.input!.spec.loads.find((l) => l.label.startsWith('Bơm'))?.feed).toBe('controller');
    expect(r.input!.spec.branchTrackerId).toMatch(/:PV$/);
  });
  test('thiếu lịch tải, thiếu hiệu suất, pin thiếu thông số, hai pin, thiếu inverter: từ chối kèm trường', async () => {
    const noPlan = config('shared8'); noPlan.loadPlans = noPlan.loadPlans!.slice(0, 1);
    expect((await compileSim(noPlan, w())).issues.map((i) => i.code)).toEqual(['LOAD_PLAN_MISSING']);
    const noEff = config('shared8');
    noEff.snapshots.components.find((c) => c.modelId === 'luxpower-sna6000wpv')!.specs.efficiencyMax.v = null;
    expect((await compileSim(noEff, w())).issues[0]).toMatchObject({ code: 'INVERTER_EFFICIENCY_MISSING', field: '/sim/inverterEfficiency' });
    expect((await compileSim({ ...noEff, sim: { inverterEfficiency: 0.9 } }, w())).issues).toEqual([]); // người dùng khai hiệu suất thì chạy được
    const noBat = config('shared8');
    noBat.snapshots.components.find((c) => c.modelId === 'used-battery')!.specs.nominalV.v = null;
    expect((await compileSim(noBat, w())).issues[0].code).toBe('BATTERY_SPEC_MISSING');
    const two = config('shared8');
    const inv = two.instances.find((i) => i.kind === 'inverter')!;
    two.instances.push({ ...two.instances.find((i) => i.kind === 'battery')!, instanceId: 'bat2' });
    two.edges.push({ edgeId: 'e2', from: { instanceId: 'bat2', port: 'DC' }, to: { instanceId: inv.instanceId, port: 'BAT' } });
    expect((await compileSim(two, w())).issues.map((i) => i.code)).toContain('BATTERY_COUNT');
    expect((await compileSim({ ...openLamHa(), pv: { tiltDeg: 10, azimuthDeg: 180 } }, w())).issues[0].code).toBe('NO_STRINGS');
  });
  test('Dyness: dải dùng được 90 % DoD chung cơ sở với dự phòng, không trừ hai lần', async () => {
    const p = config('shared8');
    const dy = catalog('dyness-dl5-0c');
    p.snapshots.components.push(dy);
    p.instances.find((i) => i.kind === 'battery')!.componentRef = { modelId: dy.modelId, revision: 1 };
    expect((await compileSim({ ...p, sim: { minSoc: 0.05 } }, w())).input!.spec.bank).toMatchObject({ nominalWh: 5120, socMin: expect.closeTo(0.1, 9), maxChargeW: 75 * 51.2, maxDischargeW: 100 * 51.2 });
    expect((await compileSim(p, w())).input!.spec.bank!.socMin).toBe(0.2); // dự phòng thiết kế 20 % cao hơn mức phần cứng 10 %
  });
});

describe('chạy hệ thống, worker và A/B trên dữ liệu Lâm Hà 2023', () => {
  const run = async (p: Project, soc0 = 0.5) => {
    const weather = (await loadBundledWeather('lam-ha-2023-pvgis-era5'))!;
    if (!weather.ok) throw new Error('weather');
    const c = await compileSim({ ...p, sim: { ...p.sim, soc0 } }, weather.series);
    expect(c.issues).toEqual([]);
    const out = await simulateSystem(c.input!, c.hash!);
    if (!out || !out.ok) throw new Error('simulate failed');
    return out.result;
  };
  const withPumpHour = (p: Project, hour: number): Project => ({ ...p, loadPlans: p.loadPlans!.map((l) => (l.pump ? { ...l, fractions: l.fractions.map((_, h) => (h === hour ? 1 : 0)) } : l)) });
  test('cả năm 8.760 giờ cho cấu hình A: ledger cân từng bước, mọi bước có mã lý do hợp lệ', async () => {
    const r = await run(config('shared8'));
    expect(r.dispatch.period.n).toBe(8760);
    expect(Math.max(...r.dispatch.series.residualWh.map(Math.abs))).toBeLessThan(0.01);
    expect(r.dispatch.totals.loadRequestedWh).toBeCloseTo((300 * 24 + 750) * 365, 3);
    expect(r.dispatch.metrics.lowestSunMonth).not.toBeNull();
    expect(Object.keys(r.dispatch.reasonTotals).length).toBeGreaterThan(3);
  }, 60000);
  test('dời bơm từ 18h về 11h (cấu hình A) giảm Wh xả pin trên dữ liệu đã chọn, cùng thời tiết và SoC đầu', async () => {
    const evening = await run(withPumpHour(config('shared8'), 18)), noon = await run(withPumpHour(config('shared8'), 11));
    expect(noon.dispatch.totals.dischargeBusWh).toBeLessThan(evening.dispatch.totals.dischargeBusWh);
    expect(noon.pv.inputHash).not.toBe(evening.pv.inputHash); // hai phương án là hai đầu vào khác nhau
    expect(noon.dispatch.totals.pvPotentialWh).toBeCloseTo(evening.dispatch.totals.pvPotentialWh, 6); // cùng PV
  }, 60000);
  test('cấu hình B (6+2): bơm DC chạy theo PV nhánh; sổ năng lượng nhánh gộp vào tổng', async () => {
    const r = await run(withPumpHour(config('split6+2'), 11));
    expect(r.dispatch.totals.branchPotentialWh).toBeGreaterThan(0);
    expect(r.dispatch.loads.find((l) => l.feed === 'controller')!.servedWh).toBeGreaterThan(0);
    expect(Math.max(...r.dispatch.series.residualWh.map(Math.abs))).toBeLessThan(0.01);
  }, 60000);
  test('worker: simulate trả sim-result đúng runId/inputHash; hủy giữa chừng; thiếu dữ liệu thành failure', async () => {
    const weather = (await loadBundledWeather('lam-ha-2023-pvgis-era5'))!;
    if (!weather.ok) throw new Error('weather');
    const c = await compileSim(config('shared8'), weather.series);
    const evs: RunEvent[] = [];
    await createPvHandler((e) => evs.push(e))({ type: 'simulate', runId: 'r1', inputHash: c.hash!, input: c.input! });
    expect(evs.at(-1)).toMatchObject({ type: 'sim-result', runId: 'r1', inputHash: c.hash });
    const progress = evs.filter((e) => e.type === 'progress').map((e) => (e as { completedSteps: number }).completedSteps);
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(8760);
    expect(progress.every((v, i) => i === 0 || v >= progress[i - 1])).toBe(true);
    const evs2: RunEvent[] = [];
    const h = createPvHandler((e) => { evs2.push(e); if (e.type === 'progress' && e.completedSteps >= 1000) void h({ type: 'cancel', runId: 'r2' }); });
    await h({ type: 'simulate', runId: 'r2', inputHash: 'x', input: c.input! });
    expect(evs2.at(-1)).toEqual({ type: 'cancelled', runId: 'r2' });
    expect(evs2.some((e) => e.type === 'sim-result')).toBe(false);
    const bad = structuredClone(c.input!); bad.pv.model.cellModel = 'faiman'; bad.pv.weather.tempAirC = null;
    const evs3: RunEvent[] = [];
    await createPvHandler((e) => evs3.push(e))({ type: 'simulate', runId: 'r3', inputHash: 'x', input: bad });
    expect(evs3.at(-1)).toMatchObject({ type: 'failure', issues: [expect.objectContaining({ code: 'AIR_TEMP_MISSING' })] });
  }, 60000);
  test('mã đầu vào đổi khi đổi lịch bơm hoặc chính sách, không đổi khi chỉ đổi giá', async () => {
    const weather = (await loadBundledWeather('lam-ha-2023-pvgis-era5'))!;
    if (!weather.ok) throw new Error('weather');
    const hash = async (p: Project) => (await compileSim(p, weather.series)).hash;
    const base = config('shared8');
    expect(await hash(withPumpHour(base, 11))).not.toBe(await hash(base));
    expect(await hash({ ...base, sim: { etaCharge: 0.9 } })).not.toBe(await hash(base));
    const repriced = structuredClone(base); repriced.snapshots.offers[0].priceMinor = '1';
    expect(await hash(repriced)).toBe(await hash(base));
    expect(await simHash((await compileSim(base, weather.series)).input!)).toBe(await hash(base));
  }, 60000);
});

describe('sau review W09: topology ngoài phạm vi phải bị từ chối, không cho số sai', () => {
  test('hai controller bơm cùng có PV: từ chối (BRANCH_COUNT) thay vì ghép hai bơm vào một nhánh và bỏ PV nhánh kia khỏi sổ', async () => {
    const vsun = { modelId: 'vsun-620', revision: 1 };
    let p = buildLamHaConfig(setQuantity(openLamHa(), vsun, 10), 'split6+2', parts(), offers);
    p = setQuantity(p, vsun, 12);
    const used = new Set(stringsOf(p).flatMap((s) => s.panelIds));
    p = addPumpBranch(p, catalog('sample-pump-controller'), catalog('sample-pump-load'), p.instances.filter((i) => i.kind === 'panel' && !used.has(i.instanceId)).map((i) => i.instanceId));
    const pump2 = p.instances[p.instances.length - 1].instanceId;
    p = { ...p, pv: { tiltDeg: 10, azimuthDeg: 180 }, loadPlans: [...p.loadPlans!, { instanceId: pump2, fractions: Array.from({ length: 24 }, (_, h) => (h === 11 ? 1 : 0)), priority: 3 }] } as Project;
    const r = await compileSim(p, w());
    expect(r.input).toBeNull();
    expect(r.issues.map((i) => i.code)).toContain('BRANCH_COUNT');
  });
});
