import { describe, expect, test } from 'vitest';
import { buildSampleHouse } from '../../src/domain/seed';
import { buildLamHaConfig } from '../../src/domain/presets';
import { openLamHa } from '../../src/domain/project';
import { BUILTIN_OFFERS, offersFor } from '../../src/catalog/catalog';
import { validateDesign } from '../../src/validation/strings';
import { buildSceneModel } from '../../src/scene/model';
import { catalog } from './helpers';

const house = () => buildSampleHouse('2026-11-20T00:00:00.000Z');
const count = <T,>(xs: T[], f: (x: T) => string) => xs.reduce<Record<string, number>>((a, x) => ({ ...a, [f(x)]: (a[f(x)] ?? 0) + 1 }), {});

describe('thiết bị, dây, minh họa', () => {
  test('nhà mẫu', () => {
    const p = house(), m = buildSceneModel(p);
    expect(m.devices.map((d) => d.kind).sort()).toEqual(['battery', 'inverter', 'load', 'load']);
    const bat = m.devices.find((d) => d.kind === 'battery')!;
    expect(bat.sizeSource).toBe('spec');
    expect(bat.size).toEqual({ x: 0.558, y: 0.545, z: 0.15 });
    expect(m.devices.find((d) => d.kind === 'inverter')!.sizeSource).toBe('illustrative');
    expect(m.devices.every((d) => d.center.e > 15 && !d.placed && d.status === null)).toBe(true);
    expect(count(m.wires, (w) => w.kind)).toEqual({ 'dc-pv': 2, 'dc-bat': 1, ac: 2 });
    expect(m.props.map((x) => x.kind)).toEqual(['meter']);
    expect(m.props[0].label).toBe('Công tơ (minh họa)');
  });
  test('findings đặt trạng thái giới hạn', () => {
    const p = house(), m = buildSceneModel(p, validateDesign(p));
    expect(m.devices.filter((d) => d.kind === 'inverter' || d.kind === 'battery').map((d) => d.status)).toEqual(['limited', 'limited']);
  });
  test('vị trí đã lưu', () => {
    const p = house(), inv = p.instances.find((i) => i.kind === 'inverter')!.instanceId;
    const m = buildSceneModel({ ...p, devicePlacements: [{ instanceId: inv, e: 20, n: 2, up: 1 }] });
    const d = m.devices.find((x) => x.instanceId === inv)!;
    expect(d.center).toEqual({ e: 20, n: 2, up: 1 });
    expect(d.placed).toBe(true);
  });
  test('xác định, không tạo id', () => {
    const p = house(), a = buildSceneModel(p), ids = new Set([...p.instances.map((i) => i.instanceId), ...p.edges.map((e) => e.edgeId), ...(p.strings ?? []).map((s) => s.stringId)]);
    expect(JSON.stringify(buildSceneModel(p))).toBe(JSON.stringify(a));
    expect(a.devices.every((d) => ids.has(d.instanceId))).toBe(true);
    expect(a.wires.every((w) => ids.has(w.refId))).toBe(true);
  });
  test('Lâm Hà shared8 không có devicePlacements', () => {
    const p = buildLamHaConfig(openLamHa(), 'shared8', { inverter: catalog('luxpower-sna6000wpv'), battery: catalog('used-battery'), home: catalog('sample-home-load'), pump: catalog('sample-pump-load'), controller: catalog('sample-pump-controller') }, (c) => offersFor(BUILTIN_OFFERS, c));
    const m = buildSceneModel(p);
    expect(m.devices.length).toBe(p.instances.filter((i) => ['inverter', 'battery', 'controller', 'load'].includes(i.kind)).length);
    expect(m.devices.length).toBeGreaterThanOrEqual(4);
  });
});
