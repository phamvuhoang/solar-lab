// Recorded while the code was still the rc.2 format: git diff 86394dc HEAD -- src/persistence src/engine src/domain/types.ts schemas src/reports/package.ts was empty.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import { BUILTIN_OFFERS, offersFor } from '../../src/catalog/catalog';
import { addObstacle, demoGableRoof, fillFace } from '../../src/domain/layout-edit';
import { buildLamHaConfig } from '../../src/domain/presets';
import { dropInstances } from '../../src/domain/graph';
import { openLamHa } from '../../src/domain/project';
import type { Project } from '../../src/domain/types';
import { hasErrors, validateProject } from '../../src/domain/validate';
import { compileSim } from '../../src/engine/sim-compile';
import { exportProject, stageImport } from '../../src/persistence/exchange';
import { buildShadeSpec, computeShade } from '../../src/shade/sampler';
import { loadBundledWeather } from '../../src/weather/bundled';
import type { WeatherSeries } from '../../src/weather/series';
import { catalog } from './helpers';

const JSON_F = new URL('../fixtures/rc2/lamha-8-tank.json', import.meta.url);
const HASH_F = new URL('../fixtures/rc2/lamha-8-tank.hash.txt', import.meta.url);

/** Same build as lamHa(8, 11, 'near') in regression-lamha.test.ts. */
function build(): Project {
  const c = (id: string) => catalog(id);
  const parts = { inverter: c('luxpower-sna6000wpv'), battery: c('used-battery'), home: c('sample-home-load'), pump: c('sample-pump-load'), controller: c('sample-pump-controller') };
  let p = buildLamHaConfig(openLamHa(), 'shared8', parts, (x) => offersFor(BUILTIN_OFFERS, x));
  p = { ...p, design: { coldCellTempC: 5, hotCellTempC: 70 }, pv: { tiltDeg: 10, azimuthDeg: 180, weatherId: 'lam-ha-2023-pvgis-era5' } } as Project;
  p = { ...p, loadPlans: p.loadPlans!.map((l) => (l.pump ? { ...l, fractions: l.fractions.map((_, k) => (k === 11 ? 1 : 0)) } : l)) };
  p = demoGableRoof(p);
  p = fillFace(p, p.roofFaces[0].roofFaceId, p.instances.filter((i) => i.kind === 'panel').map((i) => i.instanceId)).project;
  p = addObstacle(p, { label: 'Bồn nước', kind: 'cylinder', roofFaceId: null, center: { e: 11, n: -1 }, baseUp: 3, angleDeg: 0, size: { x: 1.3, y: 1.3, z: 2.5 } });
  return { ...p, shade: { enabled: true, mode: 'standard', grid: 4 } };
}

let weather: WeatherSeries;
beforeAll(async () => { const w = await loadBundledWeather('lam-ha-2023-pvgis-era5'); if (!w?.ok) throw new Error('weather'); weather = w.series; }, 120000);
// the shade field is computed from the very project being hashed (panel ids are random per build)
const hashOfSim = async (p: Project) => {
  const shade = (await computeShade(await buildShadeSpec(p, weather, { mode: 'standard', grid: 4 }), null))!.field;
  const r = await compileSim(p, weather, { shade }); if (!r.hash) throw new Error(JSON.stringify(r.issues)); return r.hash;
};

test('fixture rc.2 có mặt (ghi bằng WRITE_RC2_FIXTURE=1 khi code còn là rc.2)', async () => {
  if (process.env.WRITE_RC2_FIXTURE === '1') {
    const p = build();
    writeFileSync(JSON_F, await exportProject(p, '2026-11-20T00:00:00.000Z') + '\n');
    writeFileSync(HASH_F, (await hashOfSim(p)) + '\n');
  }
  expect(existsSync(JSON_F) && existsSync(HASH_F)).toBe(true);
}, 120000);

const inverterId = (p: Project) => p.instances.find((i) => i.kind === 'inverter')!.instanceId;
const withDev = (p: Project, extra: { instanceId: string; e: number; n: number; up: number }[]): Project => ({ ...p, devicePlacements: extra });

test('file rc.2 nhập lại được, không cảnh báo, hash kết quả bằng hash đã ghi lúc rc.2', async () => {
  const s = await stageImport(readFileSync(JSON_F, 'utf8'), new Set());
  if (!s.ok) throw new Error(JSON.stringify(s.issues));
  expect(s.issues).toEqual([]);
  expect(await hashOfSim(s.project)).toBe(readFileSync(HASH_F, 'utf8').trim());
}, 120000);
test('devicePlacements và sample không vào phép tính', async () => {
  const p = build(), p2 = withDev(p, [{ instanceId: inverterId(p), e: 20, n: 1, up: 0 }]);
  expect(hasErrors(validateProject(p2))).toBe(false);
  expect(await hashOfSim(p2)).toBe(await hashOfSim(p));
  expect(await hashOfSim({ ...p, sample: true })).toBe(await hashOfSim(p));
}, 120000);
test('xóa thiết bị kéo theo vị trí của nó', () => {
  const p = build(), id = inverterId(p);
  expect(dropInstances(withDev(p, [{ instanceId: id, e: 20, n: 1, up: 0 }]), new Set([id])).devicePlacements).toEqual([]);
});
test('kiểm tham chiếu: id lạ → BROKEN_REF; trỏ vào tấm → NOT_A_DEVICE; trùng → DUPLICATE_ID', () => {
  const p = build(), id = inverterId(p), panel = p.instances.find((i) => i.kind === 'panel')!.instanceId, pos = { e: 1, n: 1, up: 0 };
  const find = (q: Project, code: string) => validateProject(q).find((x) => x.code === code);
  expect(find(withDev(p, [{ instanceId: 'ins-nope', ...pos }]), 'BROKEN_REF')?.field).toBe('/devicePlacements/0/instanceId');
  expect(find(withDev(p, [{ instanceId: panel, ...pos }]), 'NOT_A_DEVICE')?.field).toBe('/devicePlacements/0/instanceId');
  expect(find(withDev(p, [{ instanceId: id, ...pos }, { instanceId: id, ...pos }]), 'DUPLICATE_ID')?.field).toBe('/devicePlacements/1');
});
