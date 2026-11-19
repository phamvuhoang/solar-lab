import { newId } from './ids';
import { refKey, type Component, type Instance, type Project, type StringDef } from './types';

// Connectivity only. Screen coordinates live in src/diagrams, never here.

export type PortType = 'mppt-in' | 'ctrl-pv-in' | 'battery-dc' | 'ac-out' | 'ac-in' | 'pump-dc-out' | 'pump-dc-in';
export interface PortDef { id: string; type: PortType; label: string }
export interface PortRef { instanceId: string; port: string }
export type Edge = Project['edges'][number];

export const PORT_TYPE_LABEL: Record<PortType, string> = {
  'mppt-in': 'Đầu vào MPPT', 'ctrl-pv-in': 'Đầu vào PV của controller', 'battery-dc': 'Pin DC', 'ac-out': 'Ra AC', 'ac-in': 'Vào AC', 'pump-dc-out': 'Ra DC bơm', 'pump-dc-in': 'Vào DC bơm',
};
export const portKey = (r: PortRef) => `${r.instanceId}:${r.port}`;

export function portsOf(inst: Pick<Instance, 'kind'>, comp: Component | undefined): PortDef[] {
  switch (inst.kind) {
    case 'inverter': {
      const n = Math.max(1, Math.round(comp?.specs.mpptCount?.v ?? 1));
      return [
        ...Array.from({ length: n }, (_, i) => ({ id: `M${i + 1}`, type: 'mppt-in' as const, label: `MPPT ${i + 1}` })),
        { id: 'BAT', type: 'battery-dc', label: 'Pin' }, { id: 'AC', type: 'ac-out', label: 'Ra tải AC' },
      ];
    }
    case 'battery': return [{ id: 'DC', type: 'battery-dc', label: 'DC' }];
    case 'controller': return [{ id: 'PV', type: 'ctrl-pv-in', label: 'PV vào' }, { id: 'OUT', type: 'pump-dc-out', label: 'Ra bơm DC' }];
    case 'load': return [{ id: 'AC', type: 'ac-in', label: 'AC' }, { id: 'DC', type: 'pump-dc-in', label: 'DC bơm' }];
    default: return [];
  }
}

/** Direction matters for AC and pump DC (source → sink); battery DC joins two like ports. */
export type EdgeVerdict = 'ok' | 'reversed' | 'mismatch';
export function edgeVerdict(from: PortType, to: PortType): EdgeVerdict {
  const ok = (a: PortType, b: PortType) => (a === 'ac-out' && b === 'ac-in') || (a === 'pump-dc-out' && b === 'pump-dc-in') || (a === 'battery-dc' && b === 'battery-dc');
  return ok(from, to) ? 'ok' : ok(to, from) ? 'reversed' : 'mismatch';
}
export const isStringTarget = (t: PortType) => t === 'mppt-in' || t === 'ctrl-pv-in';

export interface Indexed {
  p: Project;
  inst: Map<string, { inst: Instance; comp: Component | undefined; ports: PortDef[] }>;
  comp(i: Instance): Component | undefined;
  port(r: PortRef): PortDef | undefined;
  stringsAt(r: PortRef): StringDef[];
  edgesAt(r: PortRef): Edge[];
}
export function indexProject(p: Project): Indexed {
  const comps = new Map(p.snapshots.components.map((c) => [refKey(c), c]));
  const comp = (i: Instance) => (i.componentRef ? comps.get(refKey(i.componentRef)) : undefined);
  const inst = new Map(p.instances.map((i) => [i.instanceId, { inst: i, comp: comp(i), ports: portsOf(i, comp(i)) }]));
  return {
    p, inst, comp,
    port: (r) => inst.get(r.instanceId)?.ports.find((x) => x.id === r.port),
    stringsAt: (r) => (p.strings ?? []).filter((s) => s.target && portKey(s.target) === portKey(r)),
    edgesAt: (r) => p.edges.filter((e) => portKey(e.from) === portKey(r) || portKey(e.to) === portKey(r)),
  };
}

export const stringsOf = (p: Project) => p.strings ?? [];
export const unassignedPanels = (p: Project): string[] => {
  const used = new Set(stringsOf(p).flatMap((s) => s.panelIds));
  return p.instances.filter((i) => i.kind === 'panel' && !used.has(i.instanceId)).map((i) => i.instanceId);
};

/** Split n panels over k trackers as evenly as possible: 8,2 → [4,4]; 7,2 → [4,3]. */
export function suggestGrouping(n: number, trackers: number): number[] {
  const k = Math.max(1, Math.min(trackers, n));
  return Array.from({ length: k }, (_, i) => Math.floor(n / k) + (i < n % k ? 1 : 0)).filter((x) => x > 0);
}

// ---- edits (pure; each returns a new project) --------------------------------------------------------------
const clone = (p: Project) => structuredClone(p);

export function addString(p: Project, def: { label?: string; panelIds: string[]; target: PortRef | null }): Project {
  const next = clone(p);
  const n = stringsOf(next).length + 1;
  next.strings = [...stringsOf(next), { stringId: newId('str'), label: def.label ?? `Chuỗi ${n}`, panelIds: [...def.panelIds], target: def.target }];
  return next;
}
export function setStringTarget(p: Project, stringId: string, target: PortRef | null): Project {
  const next = clone(p);
  const s = stringsOf(next).find((x) => x.stringId === stringId);
  if (!s) throw new Error('UNKNOWN_STRING');
  s.target = target;
  return next;
}
export function removeString(p: Project, stringId: string): Project {
  const next = clone(p);
  next.strings = stringsOf(next).filter((s) => s.stringId !== stringId);
  return next;
}
/** Grow a string from unassigned panels or release its tail. Throws NOT_ENOUGH_PANELS if there are too few. */
export function setStringSize(p: Project, stringId: string, n: number): Project {
  if (!Number.isInteger(n) || n < 0) throw new Error('INVALID_SIZE');
  const free = unassignedPanels(p);
  const next = clone(p);
  const s = stringsOf(next).find((x) => x.stringId === stringId);
  if (!s) throw new Error('UNKNOWN_STRING');
  if (n > s.panelIds.length) {
    const need = n - s.panelIds.length;
    if (free.length < need) throw new Error('NOT_ENOUGH_PANELS');
    s.panelIds.push(...free.slice(0, need));
  } else s.panelIds.length = n;
  return next;
}
export function addEdge(p: Project, from: PortRef, to: PortRef): Project {
  const next = clone(p);
  next.edges.push({ edgeId: newId('edg'), from, to });
  return next;
}
export function removeEdge(p: Project, edgeId: string): Project {
  const next = clone(p);
  next.edges = next.edges.filter((e) => e.edgeId !== edgeId);
  return next;
}

/** Remove instances and everything that points at them (edges, string members, string targets). */
export function dropInstances(p: Project, ids: ReadonlySet<string>): Project {
  const next = clone(p);
  next.instances = next.instances.filter((i) => !ids.has(i.instanceId));
  next.edges = next.edges.filter((e) => !ids.has(e.from.instanceId) && !ids.has(e.to.instanceId));
  if (next.loadPlans) next.loadPlans = next.loadPlans.filter((l) => !ids.has(l.instanceId));
  if (next.strings) next.strings = next.strings.map((s) => ({ ...s, panelIds: s.panelIds.filter((x) => !ids.has(x)), target: s.target && ids.has(s.target.instanceId) ? null : s.target }));
  return next;
}
