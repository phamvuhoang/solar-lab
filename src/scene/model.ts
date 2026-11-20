import { indexProject, stringsOf } from '../domain/graph';
import { simPolicyOf } from '../engine/sim-compile';
import { badgeOf, type Finding } from '../validation/strings';
import { layoutOf, panelDims, panelRing, validateLayout, type PlacementIssue } from '../domain/placement';
import { faceBasis, obstacleFootprint, toWorld, type Pt, type V3 } from '../domain/roof';
import type { Project, RoofFace } from '../domain/types';

/** Everything the 3D view and the 2D plan draw, derived from a project snapshot and nothing else: no ids or prices are created here. */
export interface SceneModel {
  /** outlineLocal/holesLocal are in the face frame (for triangulation); frame maps (a, b) back to ENU: origin + a·u + b·v. */
  faces: { id: string; label: string; tiltDeg: number; azimuthDeg: number; outline: V3[]; holes: V3[][]; outlineLocal: Pt[]; holesLocal: Pt[][]; frame: { origin: V3; u: V3; v: V3 }; normal: V3; setbackM: number; setbackSource: RoofFace['setbackSource'] }[];
  panels: { instanceId: string; label: string; faceId: string; corners: V3[]; center: V3; normal: V3; stringId: string | null; stringIndex: number; seriesIndex: number; angleDeg: number; invalid: boolean; hasIssue: boolean }[];
  unplaced: { instanceId: string; label: string }[];
  obstacles: { id: string; label: string; kind: 'box' | 'cylinder'; footprint: V3[]; baseUp: number; height: number; center: V3; diameter: number; roofFaceId: string | null }[];
  rails: { faceId: string; from: V3; to: V3 }[];
  routes: { stringId: string; stringIndex: number; label: string; points: V3[]; lengthM: number; spansFaces: boolean }[];
  bounds: { min: V3; max: V3; center: V3; radius: number };
  issues: PlacementIssue[];
  /** Drawn boxes: pack size from the datasheet, everything else an illustrative default. Positions never enter a calculation. */
  devices: { instanceId: string; kind: 'inverter' | 'battery' | 'controller' | 'load'; label: string; center: V3; size: { x: number; y: number; z: number }; sizeSource: 'spec' | 'illustrative'; placed: boolean; status: 'fail' | 'limited' | null }[];
  /** Conceptual wires; refId is a stringId or an edgeId; fromKind: what stands at `from` (an edge may be drawn either way). */
  wires: { id: string; kind: 'dc-pv' | 'dc-bat' | 'dc-pump' | 'ac'; from: V3; to: V3; refId: string; fromKind: 'panel' | SceneModel['devices'][number]['kind'] }[];
  /** Illustration only: not computed by the engine, no numbers. */
  props: { kind: 'meter' | 'protection'; label: string; center: V3 }[];
}

const DEVICE_ORDER = ['inverter', 'battery', 'controller', 'load'] as const;
const DEFAULT_SIZE = { inverter: { x: 0.5, y: 0.2, z: 0.6 }, controller: { x: 0.3, y: 0.15, z: 0.4 }, load: { x: 0.6, y: 0.6, z: 0.9 }, battery: { x: 0.6, y: 0.3, z: 0.6 } };

export const PANEL_LIFT_M = 0.06; // panels stand this far above the roof surface (frame height), so they never z-fight with it
const dist = (a: V3, b: V3) => Math.hypot(a.e - b.e, a.n - b.n, a.up - b.up);

export function buildSceneModel(p: Project, findings: readonly Finding[] = []): SceneModel {
  const faces = new Map(p.roofFaces.map((f) => [f.roofFaceId, f]));
  const issues = validateLayout(p);
  const byPanel = new Map<string, PlacementIssue[]>();
  for (const i of issues) for (const id of [i.instanceId, i.otherId]) if (id) byPanel.set(id, [...(byPanel.get(id) ?? []), i]);
  const strings = stringsOf(p);
  const stringOf = new Map<string, { id: string; index: number; series: number }>();
  strings.forEach((s, si) => s.panelIds.forEach((id, k) => stringOf.set(id, { id: s.stringId, index: si + 1, series: k + 1 })));

  const out: SceneModel = { faces: [], panels: [], unplaced: [], obstacles: [], rails: [], routes: [], devices: [], wires: [], props: [], bounds: { min: { e: 0, n: 0, up: 0 }, max: { e: 0, n: 0, up: 0 }, center: { e: 0, n: 0, up: 0 }, radius: 1 }, issues };
  for (const f of p.roofFaces) {
    const { u, v, normal } = faceBasis(f);
    out.faces.push({ id: f.roofFaceId, label: f.label, tiltDeg: f.tiltDeg, azimuthDeg: f.azimuthDeg, outline: f.outline.map((q) => toWorld(f, q)), holes: f.holes.map((h) => h.map((q) => toWorld(f, q))), outlineLocal: f.outline, holesLocal: f.holes, frame: { origin: { ...f.origin }, u, v }, normal, setbackM: f.setbackM, setbackSource: f.setbackSource });
  }
  const placed = new Set<string>();
  for (const pl of p.placements ?? []) {
    const f = faces.get(pl.roofFaceId), d = panelDims(p, pl.instanceId), inst = p.instances.find((i) => i.instanceId === pl.instanceId);
    if (!f || !d || !inst || placed.has(pl.instanceId)) continue;
    placed.add(pl.instanceId);
    const own = byPanel.get(pl.instanceId) ?? [], s = stringOf.get(pl.instanceId);
    out.panels.push({ instanceId: pl.instanceId, label: inst.label, faceId: f.roofFaceId, corners: panelRing(d, pl).map((q) => toWorld(f, q, PANEL_LIFT_M)), center: toWorld(f, pl.center, PANEL_LIFT_M), normal: faceBasis(f).normal,
      stringId: s?.id ?? null, stringIndex: s?.index ?? 0, seriesIndex: s?.series ?? 0, angleDeg: pl.angleDeg, invalid: own.some((i) => i.severity === 'error'), hasIssue: own.length > 0 });
  }
  for (const i of p.instances) if (i.kind === 'panel' && !placed.has(i.instanceId)) out.unplaced.push({ instanceId: i.instanceId, label: i.label });

  for (const o of p.obstacles ?? []) {
    const fp = obstacleFootprint(o).map((q) => ({ e: q.e, n: q.n, up: o.baseUp }));
    out.obstacles.push({ id: o.obstacleId, label: o.label, kind: o.kind, footprint: fp, baseUp: o.baseUp, height: o.size.z, center: { e: o.center.e, n: o.center.n, up: o.baseUp }, diameter: o.size.x, roofFaceId: o.roofFaceId });
  }

  // rails: two per row of panels, along the eave direction, under the panels (conceptual)
  const layout = layoutOf(p);
  for (const f of p.roofFaces) {
    const rows: { b: number; amin: number; amax: number; ph: number }[] = [];
    for (const pl of (p.placements ?? []).filter((x) => x.roofFaceId === f.roofFaceId && placed.has(x.instanceId))) {
      const d = panelDims(p, pl.instanceId)!, land = Math.round(pl.angleDeg / 90) % 2 !== 0, pw = land ? d.lengthM : d.widthM, ph = land ? d.widthM : d.lengthM;
      const row = rows.find((r) => Math.abs(r.b - pl.center[1]) < ph / 4);
      if (row) { row.amin = Math.min(row.amin, pl.center[0] - pw / 2); row.amax = Math.max(row.amax, pl.center[0] + pw / 2); } else rows.push({ b: pl.center[1], amin: pl.center[0] - pw / 2, amax: pl.center[0] + pw / 2, ph });
    }
    for (const r of rows) for (const k of [-0.25, 0.25]) out.rails.push({ faceId: f.roofFaceId, from: toWorld(f, [r.amin - layout.gapM, r.b + k * r.ph], 0.02), to: toWorld(f, [r.amax + layout.gapM, r.b + k * r.ph], 0.02) });
  }

  // conceptual string routes: through the placed panels in series order
  strings.forEach((s, si) => {
    const pts = s.panelIds.map((id) => out.panels.find((q) => q.instanceId === id)).filter(Boolean) as SceneModel['panels'];
    if (pts.length < 1) return;
    const points = pts.map((q) => ({ ...q.center, up: q.center.up + 0.03 }));
    out.routes.push({ stringId: s.stringId, stringIndex: si + 1, label: s.label, points, lengthM: points.slice(1).reduce((a, q, k) => a + dist(points[k], q), 0), spansFaces: new Set(pts.map((q) => q.faceId)).size > 1 });
  });

  // devices: stored position, else a wall just east of the roof, in kind order then instance order
  const ix = indexProject(p), at = new Map((p.devicePlacements ?? []).map((d) => [d.instanceId, d]));
  const ground = [...out.faces.flatMap((f) => f.outline), ...out.obstacles.flatMap((o) => o.footprint)];
  const wallE = Math.max(0, ...ground.map((q) => q.e)) + 1.5, minN = ground.length ? Math.min(...ground.map((q) => q.n)) : 0;
  let k = 0;
  for (const kind of DEVICE_ORDER) for (const inst of p.instances.filter((i) => i.kind === kind)) {
    const c = ix.inst.get(inst.instanceId)?.comp, sp = (key: string) => c?.specs[key]?.v;
    const spec = kind === 'battery' && [sp('lengthM'), sp('widthM'), sp('thicknessM')].every((x) => typeof x === 'number');
    const size = spec ? { x: sp('lengthM') as number, y: sp('widthM') as number, z: sp('thicknessM') as number } : DEFAULT_SIZE[kind];
    const pl = at.get(inst.instanceId), slot = k++;
    const b = badgeOf(findings, inst.instanceId);
    out.devices.push({ instanceId: inst.instanceId, kind, label: inst.label, size, sizeSource: spec ? 'spec' : 'illustrative', placed: !!pl,
      center: pl ? { e: pl.e, n: pl.n, up: pl.up } : { e: wallE, n: minN + slot * 1.2, up: size.z / 2 }, status: b.exceedsLimit ? 'fail' : b.powerLimited ? 'limited' : null });
  }
  const dev = new Map(out.devices.map((d) => [d.instanceId, d]));
  for (const s of strings) {
    const last = out.panels.find((q) => q.instanceId === s.panelIds[s.panelIds.length - 1]), to = s.target && dev.get(s.target.instanceId);
    if (last && to) out.wires.push({ id: `wire:${s.stringId}`, kind: 'dc-pv', from: { ...last.center }, to: { ...to.center }, refId: s.stringId, fromKind: 'panel' });
  }
  for (const e of p.edges) {
    const a = dev.get(e.from.instanceId), z = dev.get(e.to.instanceId), t = ix.port(e.from)?.type, u = ix.port(e.to)?.type;
    if (!a || !z) continue;
    const kind = t === 'battery-dc' || u === 'battery-dc' ? 'dc-bat' : t === 'pump-dc-out' || u === 'pump-dc-out' ? 'dc-pump' : t === 'ac-out' || u === 'ac-out' ? 'ac' : null;
    if (kind) out.wires.push({ id: `wire:${e.edgeId}`, kind, from: { ...a.center }, to: { ...z.center }, refId: e.edgeId, fromKind: a.kind });
  }
  const inv = out.devices.find((d) => d.kind === 'inverter');
  if (inv && simPolicyOf(p).gridAvailable) out.props.push({ kind: 'meter', label: 'Công tơ (minh họa)', center: { e: inv.center.e, n: inv.center.n + inv.size.y / 2 + 0.4, up: inv.center.up } });
  if (inv && (p.costLines ?? []).some((l) => l.category === 'protection')) out.props.push({ kind: 'protection', label: 'Tủ bảo vệ (minh họa)', center: { e: inv.center.e, n: inv.center.n - inv.size.y / 2 - 0.5, up: inv.center.up } });

  const all = [...out.faces.flatMap((f) => f.outline), ...out.obstacles.flatMap((o) => [...o.footprint, { ...o.center, up: o.baseUp + o.height }]), ...out.devices.flatMap((d) => [{ ...d.center, up: d.center.up - d.size.z / 2 }, { ...d.center, up: d.center.up + d.size.z / 2 }]), ...out.props.map((q) => q.center)];
  if (all.length) {
    const min = { e: Math.min(...all.map((q) => q.e)), n: Math.min(...all.map((q) => q.n)), up: Math.min(...all.map((q) => q.up)) }, max = { e: Math.max(...all.map((q) => q.e)), n: Math.max(...all.map((q) => q.n)), up: Math.max(...all.map((q) => q.up)) };
    const center = { e: (min.e + max.e) / 2, n: (min.n + max.n) / 2, up: (min.up + max.up) / 2 };
    out.bounds = { min, max, center, radius: Math.max(1, dist(min, max) / 2) };
  }
  return out;
}
