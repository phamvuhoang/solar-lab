import { describe, expect, test } from 'vitest';
import { BUILTIN_OFFERS, offersFor } from '../../src/catalog/catalog';
import { buildQuote } from '../../src/cost/quote';
import { describeChange } from '../../src/domain/change';
import { fillFace, moveDevice } from '../../src/domain/layout-edit';
import { dropInstances, setStringTarget } from '../../src/domain/graph';
import { addInstances } from '../../src/domain/project';
import { addAcLoad, addPumpBranch, ALL_DAY, atHour, replaceComponent } from '../../src/domain/presets';
import { buildSampleHouse, SAMPLE_WEATHER_ID } from '../../src/domain/seed';
import { compileSim } from '../../src/engine/sim-compile';
import { buildSceneModel } from '../../src/scene/model';
import { validateDesign } from '../../src/validation/strings';
import { loadBundledWeather } from '../../src/weather/bundled';
import { catalog } from './helpers';

const seed = () => buildSampleHouse('2026-11-20T00:00:00.000Z');
describe('replaceComponent', () => {
  test('đổi pin Dyness → bộ pin cũ: giữ id, dây; dự toán biết tăng 16.000.000 đ', () => {
    const p = seed(), bat = p.instances.find((i) => i.kind === 'battery')!, used = catalog('used-battery');
    const q = replaceComponent(p, [bat.instanceId], used, offersFor(BUILTIN_OFFERS, used));
    expect(q.instances.map((i) => i.instanceId)).toEqual(p.instances.map((i) => i.instanceId));
    expect(q.edges).toEqual(p.edges);
    expect(q.instances.find((i) => i.instanceId === bat.instanceId)!.label).toBe(`${used.name} #1`);
    expect(buildQuote(p).knownSubtotalMinor).toBe('15872000');
    expect(buildQuote(q).knownSubtotalMinor).toBe('31872000');
  });
  test('đổi 4 tấm của Chuỗi 1 sang Hestia 650: chuỗi và vị trí giữ nguyên, nhãn theo model mới', () => {
    const p = seed(), hes = catalog('hestia-650'), ids = p.strings![0].panelIds;
    const q = replaceComponent(p, ids, hes);
    expect(q.strings).toEqual(p.strings);
    expect(q.placements).toEqual(p.placements);
    expect(ids.map((id) => q.instances.find((i) => i.instanceId === id)!.label)).toEqual(ids.map((id) => `${hes.name} #${p.instances.find((i) => i.instanceId === id)!.label.split('#')[1]}`));
    expect(describeChange(p, q)).toContain(`Đổi model: 4 × ${catalog('vsun-620').name} → ${hes.name}`); // one line for the swap, not one per panel
  });
  test('đổi sang revision mới cùng tên, cùng giá: bản xem trước vẫn nêu, không phải "Không có gì thay đổi"', () => {
    const p = seed(), bat = p.instances.find((i) => i.kind === 'battery')!, old = catalog(bat.componentRef!.modelId);
    const r2 = { ...structuredClone(old), revision: old.revision + 1 }; // new specs under the old name; offers point at revision 1
    const q = replaceComponent(p, [bat.instanceId], r2);
    expect(q.instances.find((i) => i.instanceId === bat.instanceId)!.label).toBe(bat.label);
    expect(describeChange(p, q)).toContain(`Đổi model: ${old.name} revision ${old.revision} → ${old.revision + 1}`);
  });
  test('khác loại → KIND_MISMATCH; id lạ → UNKNOWN_INSTANCE', () => {
    const p = seed();
    expect(() => replaceComponent(p, [p.instances.find((i) => i.kind === 'battery')!.instanceId], catalog('hestia-650'))).toThrow('KIND_MISMATCH');
    expect(() => replaceComponent(p, ['nope'], catalog('hestia-650'))).toThrow('UNKNOWN_INSTANCE');
  });
});
describe('lịch mặc định', () => {
  test('addAcLoad có lịch thì có loadPlan; không có lịch thì như cũ', () => {
    const home = catalog('sample-home-load'), p = seed();
    const a = addAcLoad(p, home, [], { fractions: ALL_DAY, priority: 1 });
    const id = a.instances[a.instances.length - 1].instanceId;
    expect(a.loadPlans!.find((l) => l.instanceId === id)).toEqual({ instanceId: id, fractions: ALL_DAY, priority: 1 });
    expect(addAcLoad(p, home).loadPlans).toEqual(p.loadPlans);
  });
  test('Nhà mẫu + nhánh bơm PV riêng (2 tấm mới, controller, bơm 11h): không lỗi đỏ, compileSim không lỗi', async () => {
    let p = { ...seed(), shade: { enabled: false } } as ReturnType<typeof seed>;
    const before = new Set(p.instances.map((i) => i.instanceId));
    p = addInstances(p, catalog('vsun-620'), 2);
    const fresh = p.instances.filter((i) => !before.has(i.instanceId)).map((i) => i.instanceId);
    p = fillFace(p, p.roofFaces.find((f) => f.label.startsWith('Mái Nam'))!.roofFaceId, fresh).project;
    p = addPumpBranch(p, catalog('sample-pump-controller'), catalog('sample-pump-load'), fresh, [], { fractions: atHour(11), priority: 2, pump: { staticHeadM: null, frictionK: null, curve: null } });
    expect(atHour(11).reduce((a, b) => a + b)).toBe(1);
    expect(validateDesign(p).filter((f) => f.status === 'fail')).toEqual([]);
    const w = await loadBundledWeather(SAMPLE_WEATHER_ID);
    if (!w?.ok) throw new Error('weather');
    expect((await compileSim(p, w.series)).issues).toEqual([]);
  });
});
describe('moveDevice', () => {
  test('moveDevice cộng dồn từ vị trí hiện tại', () => {
    const p = seed(), id = p.instances.find((i) => i.kind === 'battery')!.instanceId;
    const q = (x: number) => Math.round(x * 1e6) / 1e6;
    const at = (x: typeof p) => buildSceneModel(x).devices.find((d) => d.instanceId === id)!;
    const from = at(p).center;
    const a = moveDevice(p, id, 0.1, 0, from);
    expect(p.devicePlacements).toBeUndefined(); // pure
    expect(a.devicePlacements).toEqual([{ instanceId: id, e: q(from.e + 0.1), n: q(from.n), up: q(from.up) }]);
    expect(at(a).placed).toBe(true);
    // a second nudge starts from the stored position, even when the caller passes the old one
    const b = moveDevice(a, id, 0.1, -0.1, from);
    expect(b.devicePlacements).toEqual([{ instanceId: id, e: q(from.e + 0.2), n: q(from.n - 0.1), up: q(from.up) }]);
    // out and back gives exactly the same numbers; other devices stay where the wall puts them
    const c = moveDevice(moveDevice(b, id, -0.1, 0.1, at(b).center), id, -0.1, 0, from);
    expect(c.devicePlacements).toEqual(a.devicePlacements!.map((d) => ({ ...d, e: q(from.e) })));
    expect(buildSceneModel(c).devices.filter((d) => d.instanceId !== id).every((d) => !d.placed)).toBe(true);
    expect(() => moveDevice(p, 'nope', 0.1, 0, from)).toThrow('UNKNOWN_INSTANCE');
  });
});
describe('describeChange: chuỗi bị tháo hoặc chuyển cổng', () => {
  const unplugged = (lines: string[]) => lines.filter((l) => l.includes('tháo khỏi'));
  test('xóa inverter: hai chuỗi tháo khỏi MPPT, nói rõ không phát điện', () => {
    const p = seed(), inv = p.instances.find((i) => i.kind === 'inverter')!;
    const lines = describeChange(p, dropInstances(p, new Set([inv.instanceId])));
    expect(unplugged(lines)).toEqual(['Chuỗi 1: tháo khỏi MPPT 1 (4 tấm, không phát điện)', 'Chuỗi 2: tháo khỏi MPPT 2 (4 tấm, không phát điện)']);
  });
  test('xóa controller của nhánh bơm PV: một chuỗi tháo; đổi cổng: chuyển sang', () => {
    let p = seed();
    const before = new Set(p.instances.map((i) => i.instanceId));
    p = addInstances(p, catalog('vsun-620'), 2);
    p = addPumpBranch(p, catalog('sample-pump-controller'), catalog('sample-pump-load'), p.instances.filter((i) => !before.has(i.instanceId)).map((i) => i.instanceId));
    const ctl = p.instances.find((i) => i.kind === 'controller')!, pump = p.strings!.find((s) => s.target?.instanceId === ctl.instanceId)!;
    expect(unplugged(describeChange(p, dropInstances(p, new Set([ctl.instanceId]))))).toEqual([`${pump.label}: tháo khỏi PV vào (2 tấm, không phát điện)`]);
    const s2 = p.strings![1];
    expect(describeChange(p, setStringTarget(p, s2.stringId, { ...s2.target!, port: 'M1' }))).toContain('Chuỗi 2: chuyển sang MPPT 1');
  });
});
