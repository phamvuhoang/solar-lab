import { describe, expect, test } from 'vitest';
import { addString } from '../../src/domain/graph';
import { addInstances, createProject } from '../../src/domain/project';
import { addFirstInverter, addPanelBatch, addPanels, restringPanels } from '../../src/domain/presets';
import { describeChange } from '../../src/domain/change';
import { buildSampleHouse } from '../../src/domain/seed';
import { validateLayout } from '../../src/domain/placement';
import { validateDesign } from '../../src/validation/strings';
import { refKey, type Project } from '../../src/domain/types';
import { BUILTIN_OFFERS, offersFor } from '../../src/catalog/catalog';
import { buildLamHaConfig } from '../../src/domain/presets';
import { demoGableRoof } from '../../src/domain/layout-edit';
import { openLamHa } from '../../src/domain/project';
import { catalog } from './helpers';

const seed = () => buildSampleHouse('2026-11-20T00:00:00.000Z');
const sizes = (p: Project) => (p.strings ?? []).map((s) => [s.panelIds.length, s.target?.port]);
const check = (n: number, want: unknown[]) => {
  const { project: p, left } = addPanels(seed(), catalog('vsun-620'), n);
  expect(left).toBe(0);
  expect(sizes(p)).toEqual(want);
  expect(validateDesign(p).filter((f) => f.status === 'fail')).toEqual([]);
  expect(validateLayout(p)).toEqual([]);
  expect(new Set(p.placements!.map((x) => x.roofFaceId)).size).toBe(1);
  expect(p.placements).toHaveLength(8 + n);
};
describe('addPanels', () => {
  test('Nhà mẫu + 2 tấm: chia lại 5+5 vào M1/M2, không lỗi đỏ, 10 tấm trên Mái Nam', () => check(2, [[5, 'M1'], [5, 'M2']]));
  test('Nhà mẫu + 4 tấm: 6+6, 12 tấm trên Mái Nam, không lỗi đỏ', () => check(4, [[6, 'M1'], [6, 'M2']]));
  test('addPanelBatch cũ vẫn xâu riêng tấm mới', () => {
    const s = seed(), inv = s.instances.find((i) => i.kind === 'inverter')!;
    const invComp = s.snapshots.components.find((c) => refKey(c) === refKey(inv.componentRef!));
    expect(addPanelBatch(s, catalog('vsun-620'), 2, invComp).strings).toHaveLength(4);
  });
  test('xem trước nêu rõ chuỗi nào đổi', () => {
    const before = seed(), after = addPanels(before, catalog('vsun-620'), 2).project;
    expect(describeChange(before, after)).toEqual(expect.arrayContaining(['Chuỗi 1: 4 → 5 tấm, Voc lạnh 255,2/480 V', 'Chuỗi 2: 4 → 5 tấm, Voc lạnh 255,2/480 V']));
  });
  test('chuỗi model khác trên cùng inverter giữ nguyên; hết cổng tự do thì NO_FREE_MPPT', () => {
    const hes = catalog('hestia-650'), vs = catalog('vsun-620');
    let p = addInstances(addInstances(addInstances(createProject('x'), hes, 4), vs, 4), seed().snapshots.components.find((c) => c.kind === 'inverter')!, 1);
    const ids = p.instances.map((i) => i.instanceId), inv = ids[8];
    p = addString(p, { panelIds: ids.slice(0, 4), target: { instanceId: inv, port: 'M2' } });
    p = addString(p, { panelIds: ids.slice(4, 8), target: { instanceId: inv, port: 'M1' } });
    const q = addPanels(p, vs, 2).project;
    expect(q.strings!.map((s) => [s.panelIds.length, s.target!.port])).toEqual([[4, 'M2'], [6, 'M1']]);
    expect(q.strings![0].panelIds).toEqual(ids.slice(0, 4));
    // both ports held by Hestia strings: no free port for VSUN
    const blocked = { ...p, strings: [p.strings![0], { ...p.strings![1], panelIds: ids.slice(0, 4) }] };
    expect(() => restringPanels(blocked, inv, refKey(vs))).toThrow('NO_FREE_MPPT');
  });

  test('inverter đầu tiên, 8 VSUN + 4 Hestia: mỗi model một MPPT, không NO_FREE_MPPT, không lỗi, không giới hạn', () => {
    const vs = catalog('vsun-620'), hes = catalog('hestia-650'), lux = catalog('luxpower-sna6000wpv');
    const p = addInstances(addInstances(createProject('x'), vs, 8), hes, 4);
    const q = addFirstInverter(p, lux);
    const model = (id: string) => refKey(q.instances.find((i) => i.instanceId === id)!.componentRef!);
    expect(q.strings!.map((s) => [s.panelIds.length, new Set(s.panelIds.map(model)).size, s.target!.port])).toEqual([[8, 1, 'M1'], [4, 1, 'M2']]);
    expect(validateDesign(q).filter((f) => f.status === 'fail' || f.status === 'limited')).toEqual([]);
    // one model keeps every port (the sample's 4 + 4)
    expect(sizes(addFirstInverter(addInstances(createProject('y'), vs, 8), lux))).toEqual([[4, 'M1'], [4, 'M2']]);
    // more models than ports: said, never a model left out silently
    expect(() => addFirstInverter(addInstances(p, { ...vs, modelId: 'third-panel' }, 2), lux)).toThrow('NO_FREE_MPPT');
  });

  const lamha = () => buildLamHaConfig(openLamHa(), 'split6+2', { inverter: catalog('luxpower-sna6000wpv'), battery: catalog('used-battery'), home: catalog('sample-home-load'), pump: catalog('sample-pump-load'), controller: catalog('sample-pump-controller') }, (c) => offersFor(BUILTIN_OFFERS, c));
  test('Lâm Hà split6+2 + 2 tấm: nhãn chuỗi được giữ, chuỗi bơm không bị đụng', () => {
    const b = lamha(), panel = b.snapshots.components.find((c) => c.kind === 'panel')!;
    const labels0 = b.strings!.map((s) => s.label);
    const a = addPanels(b, panel, 2).project;
    const lab = a.strings!.map((s) => s.label);
    expect(new Set(lab).size).toBe(lab.length);
    expect(lab).toEqual(expect.arrayContaining(labels0));
    expect(a.strings!.find((s) => s.label === labels0[0])!.target!.port).toBe('M1');
    expect(describeChange(b, a).some((l) => l.endsWith(': bỏ'))).toBe(false);
  });
  test('nhãn đổi tay được giữ, không trùng nhãn', () => {
    const hes = catalog('hestia-650'), vs = catalog('vsun-620');
    let p = addInstances(addInstances(createProject('x'), vs, 4), seed().snapshots.components.find((c) => c.kind === 'inverter')!, 1);
    const ids = p.instances.map((i) => i.instanceId), inv = ids[4];
    p = addString(p, { label: 'Dãy trước', panelIds: ids.slice(0, 4), target: { instanceId: inv, port: 'M1' } });
    p = addPanels(p, hes, 2).project;
    p = addPanels(p, vs, 2).project;
    const lab = p.strings!.map((s) => s.label);
    expect(new Set(lab).size).toBe(lab.length);
    expect(lab).toContain('Dãy trước');
  });
  test('Lâm Hà + mặt mái minh họa + 2 tấm: đặt đủ 10 tấm, không dòng đặt dở', () => {
    const o = openLamHa(), panel = o.snapshots.components.find((c) => c.kind === 'panel')!;
    const b = demoGableRoof(buildLamHaConfig(o, 'shared8', { inverter: catalog('luxpower-sna6000wpv'), battery: catalog('used-battery'), home: catalog('sample-home-load'), pump: catalog('sample-pump-load'), controller: catalog('sample-pump-controller') }, (c) => offersFor(BUILTIN_OFFERS, c)));
    const { project: a, left } = addPanels(b, panel, 2);
    expect(left).toBe(0);
    expect(a.placements).toHaveLength(10);
    expect(describeChange(b, a).some((l) => l.includes('tấm đã đặt lên mái'))).toBe(false);
  });
  test('Nhà mẫu + 6 tấm: có dòng chuỗi nằm trên 2 mặt mái', () => {
    const b = seed(), a = addPanels(b, catalog('vsun-620'), 6).project;
    expect(describeChange(b, a).some((l) => l.includes('nằm trên 2 mặt mái'))).toBe(true);
  });
});
