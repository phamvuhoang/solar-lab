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

