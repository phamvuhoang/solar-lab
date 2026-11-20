import { describe, expect, test } from 'vitest';
import { addString } from '../../src/domain/graph';
import { addInstances, createProject } from '../../src/domain/project';
import { addPanelBatch, addPanels, restringPanels } from '../../src/domain/presets';
import { describeChange } from '../../src/domain/change';
import { buildSampleHouse } from '../../src/domain/seed';
import { validateLayout } from '../../src/domain/placement';
import { validateDesign } from '../../src/validation/strings';
import { refKey, type Project } from '../../src/domain/types';
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
});
