import { addEdge, addString, suggestGrouping, stringsOf, type PortRef } from './graph';
import { addInstances } from './project';
import { refKey, type Component, type Offer, type Project } from './types';

export type PresetKind = 'one-string' | 'two-strings-one-tracker' | 'two-trackers';
export const PRESET_LABEL: Record<PresetKind, string> = {
  'one-string': '1 chuỗi vào MPPT 1', 'two-strings-one-tracker': '2 chuỗi song song trên MPPT 1', 'two-trackers': '2 tracker độc lập (MPPT 1 và MPPT 2)',
};

const firstOf = (p: Project, kind: string) => p.instances.find((i) => i.kind === kind);
const panelIds = (p: Project) => p.instances.filter((i) => i.kind === 'panel').map((i) => i.instanceId);

/** Replace all strings by a standard grouping of the project's panels. Adds the inverter if there is none. */
export function applyPreset(p: Project, kind: PresetKind, inverter: Component, offers: readonly Offer[] = []): Project {
  let next = firstOf(p, 'inverter') ? p : addInstances(p, inverter, 1, offers);
  const inv = firstOf(next, 'inverter')!;
  const panels = panelIds(next);
  if (!panels.length) throw new Error('NO_PANELS');
  const port = (n: number): PortRef => ({ instanceId: inv.instanceId, port: `M${n}` });
  const sizes = kind === 'one-string' ? [panels.length] : suggestGrouping(panels.length, 2);
  const targets = kind === 'two-trackers' ? [port(1), port(2)] : [port(1), port(1)];
  next = { ...structuredClone(next), strings: [] };
  let at = 0;
  sizes.forEach((n, i) => { next = addString(next, { label: `Chuỗi ${i + 1}`, panelIds: panels.slice(at, at + n), target: targets[i] }); at += n; });
  return next;
}

/** Battery bank on the inverter's BAT port. */
export function addBatteryBranch(p: Project, battery: Component, offers: readonly Offer[] = []): Project {
  const inv = firstOf(p, 'inverter');
  if (!inv) throw new Error('NO_INVERTER');
  const next = addInstances(p, battery, 1, offers);
  const bank = next.instances[next.instances.length - 1];
  return addEdge(next, { instanceId: bank.instanceId, port: 'DC' }, { instanceId: inv.instanceId, port: 'BAT' });
}

/** AC load on the inverter's AC output. */
export function addAcLoad(p: Project, load: Component, offers: readonly Offer[] = []): Project {
  const inv = firstOf(p, 'inverter');
  if (!inv) throw new Error('NO_INVERTER');
  const next = addInstances(p, load, 1, offers);
  const l = next.instances[next.instances.length - 1];
  return addEdge(next, { instanceId: inv.instanceId, port: 'AC' }, { instanceId: l.instanceId, port: 'AC' });
}

/** Separate PV pump branch: given panels → controller PV, controller OUT → pump load DC. */
export function addPumpBranch(p: Project, controller: Component, pump: Component, panels: string[], offers: readonly Offer[] = []): Project {
  let next = addInstances(addInstances(p, controller, 1, offers.filter((o) => refKey(o.componentRef) === refKey(controller))), pump, 1, offers.filter((o) => refKey(o.componentRef) === refKey(pump)));
  const ctl = next.instances[next.instances.length - 2], load = next.instances[next.instances.length - 1];
  next = addString(next, { label: `Chuỗi bơm ${stringsOf(next).length + 1}`, panelIds: panels, target: { instanceId: ctl.instanceId, port: 'PV' } });
  return addEdge(next, { instanceId: ctl.instanceId, port: 'OUT' }, { instanceId: load.instanceId, port: 'DC' });
}

/** "Thêm N tấm": add the panels and propose strings spread over the first inverter's trackers (or unconnected if none). */
export function addPanelBatch(p: Project, panel: Component, n: number, invComp: Component | undefined, offers: readonly Offer[] = []): Project {
  const before = new Set(p.instances.map((i) => i.instanceId));
  let next = addInstances(p, panel, n, offers);
  const ids = next.instances.filter((i) => !before.has(i.instanceId)).map((i) => i.instanceId);
  const inv = firstOf(next, 'inverter');
  const trackers = inv ? Math.max(1, Math.round(invComp?.specs.mpptCount?.v ?? 1)) : 1;
  let at = 0;
  suggestGrouping(n, trackers).forEach((size, i) => {
    next = addString(next, { panelIds: ids.slice(at, at + size), target: inv ? { instanceId: inv.instanceId, port: `M${i + 1}` } : null });
    at += size;
  });
  return next;
}
