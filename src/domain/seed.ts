import lamHa from '../../data/presets/lam-ha.json';
import { BUILTIN_COMPONENTS, BUILTIN_OFFERS, findComponent, offersFor } from '../catalog/catalog';
import { addObstacle, addRoofFace, faceRect, fillFace } from './layout-edit';
import { buildLamHaConfig } from './presets';
import { addInstances, createProject } from './project';
import type { Component, Project } from './types';

export const SAMPLE_NAME = 'Nhà mẫu (minh họa)';
export const SAMPLE_WEATHER_ID = 'lam-ha-2023-pvgis-era5';
const pick = (id: string): Component => {
  const c = findComponent(BUILTIN_COMPONENTS, { modelId: id, revision: 1 });
  if (!c) throw new Error('SEED_CATALOG');
  return c;
};
const offersOf = (c: Component) => offersFor(BUILTIN_OFFERS, c);

export function buildSampleHouse(now?: string, id?: string): Project {
  const vsun = pick('vsun-620');
  let p = createProject(SAMPLE_NAME, now, id);
  p.location = lamHa.location;
  p = addInstances(p, vsun, 8, offersOf(vsun));
  p = buildLamHaConfig(p, 'shared8', { inverter: pick('luxpower-sna6000wpv'), battery: pick('dyness-dl5-0c'), home: pick('sample-home-load'), pump: pick('sample-pump-load'), controller: pick('sample-pump-controller') }, offersOf);
  p = addRoofFace(p, faceRect('Mái Nam (minh họa)', 15, 3.25, 10, 180, { e: 0, n: 0, up: 3 }));
  p = addRoofFace(p, faceRect('Mái Bắc (minh họa)', 15, 3.25, 10, 0, { e: 15, n: 6.4, up: 3 }));
  p = fillFace(p, p.roofFaces[0].roofFaceId, p.instances.filter((i) => i.kind === 'panel').map((i) => i.instanceId)).project;
  p = addObstacle(p, { label: 'Bồn nước', kind: 'cylinder', roofFaceId: null, center: { e: 10.5, n: -1 }, baseUp: 3, angleDeg: 0, size: { x: 1.2, y: 1.2, z: 1.8 } });
  return {
    ...p,
    design: { coldCellTempC: 5, hotCellTempC: 70, iscFactor: 1, betaVmpAssumption: null, source: 'Giả định minh họa (như bài học và golden Lâm Hà)' },
    pv: { weatherId: SAMPLE_WEATHER_ID },
    sim: { gridAvailable: true, importAllowed: true, exportAllowed: false },
    shade: { enabled: true, mode: 'preview' },
  } as Project;
}

export const isSample = (p: Project) => p.name.startsWith('Nhà mẫu'); // ponytail: nhận theo tên; cần cờ trong schema nếu người dùng đổi tên mà vẫn phải giữ nhãn
