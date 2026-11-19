import { BUILTIN_COMPONENTS, findComponent } from '../../src/catalog/catalog';
import { addString, type PortRef } from '../../src/domain/graph';
import { addInstances, createProject } from '../../src/domain/project';
import type { Component, Project } from '../../src/domain/types';

export const catalog = (id: string) => structuredClone(findComponent(BUILTIN_COMPONENTS, { modelId: id, revision: 1 })!);
export const withSpecs = (c: Component, over: Record<string, number | null>): Component => {
  const n = structuredClone(c);
  for (const [k, v] of Object.entries(over)) n.specs[k] = { v, u: c.specs[k]?.u ?? (k.startsWith('beta') ? '1/°C' : 'V'), p: 'manufacturer' };
  return n;
};

export interface Rig { p: Project; panels: string[]; inv: string }
/** n panels (given component), one inverter (given component), no strings yet. */
export function rig(panel: Component, inverter: Component, n: number, design: Project['design'] = { coldCellTempC: -5, hotCellTempC: 70 }): Rig {
  let p = addInstances(createProject('rig'), panel, n);
  const panels = p.instances.map((i) => i.instanceId);
  p = addInstances(p, inverter, 1);
  return { p: { ...p, design }, panels, inv: p.instances[p.instances.length - 1].instanceId };
}
export const withStrings = (r: Rig, defs: { n: number; port: string | null }[]): Project => {
  let p = r.p, at = 0;
  for (const d of defs) {
    p = addString(p, { panelIds: r.panels.slice(at, at + d.n), target: d.port ? ({ instanceId: r.inv, port: d.port } as PortRef) : null });
    at += d.n;
  }
  return p;
};
