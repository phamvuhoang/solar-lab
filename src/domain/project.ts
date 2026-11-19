import lamHa from '../../data/presets/lam-ha.json';
import { BUILTIN_COMPONENTS, BUILTIN_OFFERS, findComponent, offersFor } from '../catalog/catalog';
import { newId, nowIso } from './ids';
import { refKey, type Component, type Offer, type Project, type Ref } from './types';
import type { Kind } from './specs';

export function createProject(name: string, now = nowIso(), id = newId('prj')): Project {
  return {
    schemaVersion: 1, projectId: id, revision: 1, name: name.trim() || 'Dự án mới', createdAt: now, updatedAt: now,
    location: null, instances: [], edges: [], roofFaces: [], priceSelections: [],
    snapshots: { components: [], offers: [] },
  };
}

/** Snapshot a component (and its offers) into the project so old quotes reopen unchanged. */
export function snapshotInto(p: Project, c: Component, offers: readonly Offer[]): void {
  if (!findComponent(p.snapshots.components, c)) p.snapshots.components.push(structuredClone(c));
  for (const o of offers) if (!p.snapshots.offers.some((x) => x.offerId === o.offerId)) p.snapshots.offers.push(structuredClone(o));
}

export function addInstances(p: Project, c: Component, count: number, offers: readonly Offer[] = []): Project {
  const next = structuredClone(p);
  snapshotInto(next, c, offers);
  const ref: Ref = { modelId: c.modelId, revision: c.revision };
  const label = next.instances.filter((i) => i.kind === c.kind).length;
  for (let n = 0; n < count; n++)
    next.instances.push({ instanceId: newId('ins'), kind: c.kind as Kind, label: `${c.name} #${label + n + 1}`, componentRef: ref });
  if (!next.priceSelections.some((s) => refKey(s.componentRef) === refKey(ref)) && offers[0])
    next.priceSelections.push({ componentRef: ref, offerId: offers[0].offerId });
  return next;
}

export function openLamHa(now = nowIso()): Project {
  let p = createProject(lamHa.name, now);
  p.location = lamHa.location;
  for (const line of lamHa.instances) {
    const c = findComponent(BUILTIN_COMPONENTS, { modelId: line.modelId, revision: 1 })!;
    p = addInstances(p, c, line.count, offersFor(BUILTIN_OFFERS, c));
  }
  // Exact preset selection wins over "first offer".
  p.priceSelections = lamHa.priceSelections.map((s) => ({ componentRef: { modelId: s.modelId, revision: 1 }, offerId: s.offerId }));
  return p;
}
