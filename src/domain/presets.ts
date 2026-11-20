import { addEdge, addString, dropInstances, indexProject, portsOf, suggestGrouping, stringsOf, unassignedPanels, type PortRef } from './graph';
import { addInstances, snapshotInto } from './project';
import { fillFace } from './layout-edit';
import { refKey, type Component, type LoadPlan, type Offer, type Project } from './types';

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
export function addAcLoad(p: Project, load: Component, offers: readonly Offer[] = [], plan?: Omit<LoadPlan, 'instanceId'>): Project {
  const inv = firstOf(p, 'inverter');
  if (!inv) throw new Error('NO_INVERTER');
  const next = addInstances(p, load, 1, offers);
  const l = next.instances[next.instances.length - 1];
  return withPlan(addEdge(next, { instanceId: inv.instanceId, port: 'AC' }, { instanceId: l.instanceId, port: 'AC' }), l.instanceId, plan);
}

/** Separate PV pump branch: given panels → controller PV, controller OUT → pump load DC. */
export function addPumpBranch(p: Project, controller: Component, pump: Component, panels: string[], offers: readonly Offer[] = [], plan?: Omit<LoadPlan, 'instanceId'>): Project {
  let next = addInstances(addInstances(p, controller, 1, offers.filter((o) => refKey(o.componentRef) === refKey(controller))), pump, 1, offers.filter((o) => refKey(o.componentRef) === refKey(pump)));
  const ctl = next.instances[next.instances.length - 2], load = next.instances[next.instances.length - 1];
  next = addString(next, { label: `Chuỗi bơm ${stringsOf(next).length + 1}`, panelIds: panels, target: { instanceId: ctl.instanceId, port: 'PV' } });
  return withPlan(addEdge(next, { instanceId: ctl.instanceId, port: 'OUT' }, { instanceId: load.instanceId, port: 'DC' }), load.instanceId, plan);
}

const flat = (v: number) => new Array<number>(24).fill(v);
export const ALL_DAY: number[] = flat(1);
export const atHour = (h: number): number[] => { const a = flat(0); a[h] = 1; return a; };
const withPlan = (p: Project, instanceId: string, plan?: Omit<LoadPlan, 'instanceId'>): Project =>
  plan ? { ...p, loadPlans: [...(p.loadPlans ?? []), { ...structuredClone(plan), instanceId }] } : p;

/** Same kind only. Keeps instance ids, so strings, edges, placements and load plans stay. Relabels "<new name> #k" keeping k. Throws KIND_MISMATCH, UNKNOWN_INSTANCE. */
export function replaceComponent(p: Project, instanceIds: string[], next: Component, offers: readonly Offer[] = []): Project {
  const out = structuredClone(p);
  const ref = { modelId: next.modelId, revision: next.revision };
  for (const id of instanceIds) {
    const i = out.instances.find((x) => x.instanceId === id);
    if (!i) throw new Error('UNKNOWN_INSTANCE');
    if (i.kind !== next.kind) throw new Error('KIND_MISMATCH');
    i.componentRef = ref;
    i.label = i.label.replace(/^.*?(\s#\d+)?$/, `${next.name}$1`);
  }
  snapshotInto(out, next, offers);
  if (!out.priceSelections.some((s) => refKey(s.componentRef) === refKey(ref)) && offers[0]) out.priceSelections.push({ componentRef: ref, offerId: offers[0].offerId });
  return out;
}

/**
 * Proposed string sizes for n panels of one model on an inverter: spread over its trackers, but never into strings whose Vmp at STC sits within
 * 20 % of the MPPT floor. A hot cell (≈ 70 °C) takes about that much off Vmp, and below the floor the inverter cannot hold the maximum power
 * point. Fewer, longer strings are proposed instead, while one tracker still takes them (power, Vmp ceiling, Voc at STC). Without specs: even split.
 * ponytail: a fixed 20 % margin for the proposal only; the validator checks the real hot Vmp once βVmp and the hot cell temperature are declared.
 */
export function proposeStrings(n: number, panel: Component, inverter: Component | undefined): number[] {
  const trackers = inverter ? Math.max(1, Math.round(inverter.specs.mpptCount?.v ?? 1)) : 1;
  const v = (c: Component | undefined, k: string) => c?.specs[k]?.v ?? null;
  const vmp = v(panel, 'vmpV'), vmin = v(inverter, 'mpptVminV'), even = suggestGrouping(n, trackers);
  if (vmp === null || vmin === null) return even;
  const cap = (x: number | null, per: number) => (x === null ? Infinity : x / per);
  const fits = (s: number[]) => { const m = Math.max(...s);
    return m * (v(panel, 'pstcW') ?? 0) <= cap(v(inverter, 'pvMaxPowerW'), trackers) && m * vmp <= cap(v(inverter, 'mpptVmaxV'), 1) && m * (v(panel, 'vocV') ?? 0) <= cap(v(inverter, 'pvVocMaxV'), 1); };
  for (let k = Math.min(trackers, n); k >= 1; k--) { const s = suggestGrouping(n, k); if (Math.min(...s) * vmp >= vmin * 1.2 && fits(s)) return s; }
  return even;
}

/** "Thêm N tấm": add the panels and propose strings spread over the first inverter's trackers (or unconnected if none). */
export function addPanelBatch(p: Project, panel: Component, n: number, invComp: Component | undefined, offers: readonly Offer[] = []): Project {
  const before = new Set(p.instances.map((i) => i.instanceId));
  let next = addInstances(p, panel, n, offers);
  const ids = next.instances.filter((i) => !before.has(i.instanceId)).map((i) => i.instanceId);
  const inv = firstOf(next, 'inverter');
  let at = 0;
  proposeStrings(n, panel, inv ? invComp : undefined).forEach((size, i) => {
    next = addString(next, { panelIds: ids.slice(at, at + size), target: inv ? { instanceId: inv.instanceId, port: `M${i + 1}` } : null });
    at += size;
  });
  return next;
}

/** Strings on this inverter made only of `modelKey` panels, plus unassigned panels of that model, re-split by proposeStrings over the MPPT ports no other string uses. Series order kept (existing strings in order, then unassigned in instance order). Throws NO_INVERTER, NO_FREE_MPPT. */
export function restringPanels(p: Project, inverterId: string, modelKey: string): Project {
  const ix = indexProject(p), inv = ix.inst.get(inverterId);
  if (!inv || inv.inst.kind !== 'inverter') throw new Error('NO_INVERTER');
  const isModel = (id: string) => { const r = ix.inst.get(id)?.inst.componentRef; return !!r && refKey(r) === modelKey; };
  const mine = stringsOf(p).filter((s) => s.target?.instanceId === inverterId && s.panelIds.length > 0 && s.panelIds.every(isModel));
  const mineIds = new Set(mine.map((s) => s.stringId));
  const taken = new Set(stringsOf(p).filter((s) => !mineIds.has(s.stringId) && s.target?.instanceId === inverterId).map((s) => s.target!.port));
  const free = portsOf(inv.inst, inv.comp).filter((x) => x.type === 'mppt-in' && !taken.has(x.id));
  if (!free.length) throw new Error('NO_FREE_MPPT');
  const ids = [...mine.flatMap((s) => s.panelIds), ...unassignedPanels(p).filter(isModel)];
  if (!ids.length) return p;
  const panel = ix.inst.get(ids[0])?.comp;
  // ponytail: free-port trick - proposeStrings sees an inverter copy with mpptCount = free ports, so its per-tracker power cap is also divided by the free count
  const probe = inv.comp && structuredClone(inv.comp);
  if (probe) probe.specs.mpptCount = { ...(probe.specs.mpptCount ?? { u: '', p: 'assumption' }), v: free.length };
  let next: Project = { ...structuredClone(p), strings: stringsOf(p).filter((s) => !mineIds.has(s.stringId)) };
  let at = 0;
  (panel ? proposeStrings(ids.length, panel, probe) : suggestGrouping(ids.length, free.length)).forEach((size, i) => {
    const used = new Set(stringsOf(next).map((x) => x.label));
    let k = 1; while (used.has(`Chuỗi ${k}`)) k++;
    next = addString(next, { label: mine[i]?.label ?? `Chuỗi ${k}`, panelIds: ids.slice(at, at + size), target: { instanceId: inverterId, port: free[i].id } });
    at += size;
  });
  return next;
}

/** Bảng Thêm "Tấm pin": addInstances, restring trên inverter đầu tiên (nếu có), đặt tấm mới lên mặt mái còn chỗ (mặt đang có tấm cùng model trước). */
export function addPanels(p: Project, panel: Component, n: number, offers: readonly Offer[] = []): { project: Project; left: number } {
  const old = new Set(p.instances.map((i) => i.instanceId));
  let next = addInstances(p, panel, n, offers);
  const added = next.instances.filter((i) => !old.has(i.instanceId)).map((i) => i.instanceId);
  const inv = firstOf(next, 'inverter');
  if (inv) next = restringPanels(next, inv.instanceId, refKey(panel));
  const sameModel = new Set((next.placements ?? []).filter((x) => { const r = next.instances.find((i) => i.instanceId === x.instanceId)?.componentRef; return !!r && refKey(r) === refKey(panel); }).map((x) => x.roofFaceId));
  const faces = [...next.roofFaces].sort((a, b) => Number(sameModel.has(b.roofFaceId)) - Number(sameModel.has(a.roofFaceId)));
  const isModel = (id: string) => { const r = next.instances.find((i) => i.instanceId === id)?.componentRef; return !!r && refKey(r) === refKey(panel); };
  // every unplaced panel of the model (old strings' panels that were off the roof, plus the new ones), so a string is never half on the roof
  let todo = next.instances.filter((i) => i.kind === 'panel' && isModel(i.instanceId) && !(next.placements ?? []).some((x) => x.instanceId === i.instanceId)).map((i) => i.instanceId);
  for (const f of faces) { if (!todo.length) break; const r = fillFace(next, f.roofFaceId, todo); next = r.project; todo = r.left; }
  return { project: next, left: todo.length };
}

export type LamHaConfig = 'shared8' | 'split6+2';
export const LAMHA_CONFIG_LABEL: Record<LamHaConfig, string> = { shared8: 'A · tất cả tấm vào inverter, bơm AC', 'split6+2': 'B · 6 tấm vào inverter + 2 tấm cấp bơm DC riêng' };

/**
 * Rebuilds the electrical part of a project into one of the two Lâm Hà layouts, keeping its panels and its first battery.
 * Everything else (inverter, controllers, loads, strings, edges, load plans) is replaced, so applying it twice gives the same design.
 * Default schedule: home load all day, pump one hour at 18h; both are assumptions the user edits.
 */
export function buildLamHaConfig(p: Project, kind: LamHaConfig, c: { inverter: Component; battery: Component; home: Component; pump: Component; controller: Component }, offers: (x: Component) => readonly Offer[] = () => []): Project {
  // schedules and pump data the user already set survive a rebuild. Instance IDs change, so a plan is found through its device: the first
  // instance of the home/pump component. Not by plan order or the pump flag: "Lưu lịch" moves a saved plan to the end and can drop the flag.
  const planOf = (comp: Component) => { const inst = p.instances.find((i) => i.componentRef && refKey(i.componentRef) === refKey(comp)); return inst && p.loadPlans?.find((l) => l.instanceId === inst.instanceId); };
  const oldPump = planOf(c.pump), oldHome = planOf(c.home);
  const keep = new Set<string>();
  const battery = p.instances.find((i) => i.kind === 'battery');
  for (const i of p.instances) if (i.kind === 'panel' || i === battery) keep.add(i.instanceId);
  let next = dropInstances(p, new Set(p.instances.filter((i) => !keep.has(i.instanceId)).map((i) => i.instanceId)));
  next = { ...next, strings: [], edges: [], loadPlans: [] };
  const panels = next.instances.filter((i) => i.kind === 'panel').map((i) => i.instanceId);
  if (panels.length < 3) throw new Error('NO_PANELS');
  next = addInstances(next, c.inverter, 1, offers(c.inverter));
  const inv = next.instances[next.instances.length - 1];
  const onInverter = kind === 'shared8' ? panels : panels.slice(0, panels.length - 2);
  let at = 0;
  const panelComp = indexProject(next).inst.get(onInverter[0])?.comp;
  (panelComp ? proposeStrings(onInverter.length, panelComp, c.inverter) : suggestGrouping(onInverter.length, 2)).forEach((size, k) => {
    next = addString(next, { label: `Chuỗi ${k + 1}`, panelIds: onInverter.slice(at, at + size), target: { instanceId: inv.instanceId, port: `M${k + 1}` } });
    at += size;
  });
  if (battery) next = addEdge(next, { instanceId: battery.instanceId, port: 'DC' }, { instanceId: inv.instanceId, port: 'BAT' });
  else next = addBatteryBranch(next, c.battery, offers(c.battery));
  next = addAcLoad(next, c.home, offers(c.home));
  const home = next.instances[next.instances.length - 1];
  let pumpId: string;
  if (kind === 'shared8') { next = addAcLoad(next, c.pump, offers(c.pump)); pumpId = next.instances[next.instances.length - 1].instanceId; }
  else { next = addPumpBranch(next, c.controller, c.pump, panels.slice(-2), [...offers(c.controller), ...offers(c.pump)]); pumpId = next.instances[next.instances.length - 1].instanceId; }
  const at18 = atHour(18);
  next.loadPlans = [
    { instanceId: home.instanceId, fractions: oldHome ? [...oldHome.fractions] : flat(1), priority: oldHome?.priority ?? 1 },
    { instanceId: pumpId, fractions: oldPump ? [...oldPump.fractions] : at18, priority: oldPump?.priority ?? 2, pump: oldPump?.pump ? structuredClone(oldPump.pump) : { staticHeadM: null, frictionK: null, curve: null } },
  ];
  return next;
}
