import { describe, expect, test } from 'vitest';
import { BUILTIN_OFFERS, offersFor } from '../../src/catalog/catalog';
import { buildQuote } from '../../src/cost/quote';
import { fillFace } from '../../src/domain/layout-edit';
import { addInstances } from '../../src/domain/project';
import { addAcLoad, addPumpBranch, ALL_DAY, atHour, replaceComponent } from '../../src/domain/presets';
import { buildSampleHouse, SAMPLE_WEATHER_ID } from '../../src/domain/seed';
import { compileSim } from '../../src/engine/sim-compile';
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
