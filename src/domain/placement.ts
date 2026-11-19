import { footprintOnFace, isSimplePolygon, rectRing, ringContainsRing, ringsOverlap, type Pt } from './roof';
import { refKey, type Component, type LayoutSettings, type Placement, type Project, type RoofFace } from './types';

export const LAYOUT_DEFAULTS: LayoutSettings = { gridM: 0.05, gapM: 0.02 };
export const layoutOf = (p: Project): LayoutSettings => ({ ...LAYOUT_DEFAULTS, ...p.layout });

export interface PlacementIssue {
  code: string; severity: 'error' | 'warning'; instanceId: string | null; otherId?: string; faceId?: string; field: string; message: string;
}

/** Panel size from its component revision: length is the long side. null = unknown, never a guess. */
export function panelDims(p: Project, instanceId: string): { lengthM: number; widthM: number } | null {
  const inst = p.instances.find((i) => i.instanceId === instanceId);
  const c: Component | undefined = inst?.componentRef ? p.snapshots.components.find((x) => refKey(x) === refKey(inst.componentRef!)) : undefined;
  const l = c?.specs.lengthM?.v ?? null, w = c?.specs.widthM?.v ?? null;
  return l !== null && w !== null && l > 0 && w > 0 ? { lengthM: l, widthM: w } : null;
}

/** Footprint of a placed panel in its face frame; `margin` grows it on every side. */
export const panelRing = (d: { lengthM: number; widthM: number }, pl: Pick<Placement, 'center' | 'angleDeg'>, margin = 0): Pt[] =>
  rectRing(pl.center, d.widthM / 2 + margin, d.lengthM / 2 + margin, pl.angleDeg);

const bb = (r: Pt[]) => [Math.min(...r.map((q) => q[0])), Math.max(...r.map((q) => q[0])), Math.min(...r.map((q) => q[1])), Math.max(...r.map((q) => q[1]))];
const bbHit = (a: number[], b: number[]) => a[0] < b[1] && b[0] < a[1] && a[2] < b[3] && b[2] < a[3];

/** Does a candidate rectangle fit on a face at this clearance (inside outline, outside holes and obstacles)? Used by placement tools. */
export function fitsFace(p: Project, face: RoofFace, ring: Pt[]): boolean {
  if (!ringContainsRing(face.outline, ring)) return false;
  if (face.holes.some((h) => ringsOverlap(ring, h))) return false;
  return !(p.obstacles ?? []).some((o) => o.roofFaceId === face.roofFaceId && ringsOverlap(ring, footprintOnFace(o, face)));
}

/** Face geometry plus every placement: out of bounds, exclusion zones, overlaps, setbacks, obstacles, unknown sizes. */
export function validateLayout(p: Project): PlacementIssue[] {
  const out: PlacementIssue[] = [];
  const layout = layoutOf(p);
  const faces = new Map(p.roofFaces.map((f) => [f.roofFaceId, f]));
  p.roofFaces.forEach((f, i) => {
    if (!isSimplePolygon(f.outline)) out.push({ code: 'FACE_OUTLINE_INVALID', severity: 'error', instanceId: null, faceId: f.roofFaceId, field: `/roofFaces/${i}/outline`, message: `${f.label}: đường biên tự cắt hoặc có diện tích 0` });
    f.holes.forEach((h, k) => {
      if (!isSimplePolygon(h)) out.push({ code: 'HOLE_INVALID', severity: 'error', instanceId: null, faceId: f.roofFaceId, field: `/roofFaces/${i}/holes/${k}`, message: `${f.label}: vùng loại trừ ${k + 1} không hợp lệ` });
      else if (!ringContainsRing(f.outline, h)) out.push({ code: 'HOLE_OUTSIDE', severity: 'warning', instanceId: null, faceId: f.roofFaceId, field: `/roofFaces/${i}/holes/${k}`, message: `${f.label}: vùng loại trừ ${k + 1} chạm hoặc vượt biên mái` });
    });
  });

  const seen = new Map<string, number>();
  const rows: { pl: Placement; i: number; face: RoofFace; d: { lengthM: number; widthM: number }; ring: Pt[]; box: number[] }[] = [];
  (p.placements ?? []).forEach((pl, i) => {
    const field = `/placements/${i}`;
    const label = p.instances.find((x) => x.instanceId === pl.instanceId)?.label ?? pl.instanceId;
    const inst = p.instances.find((x) => x.instanceId === pl.instanceId);
    if (!inst || inst.kind !== 'panel') return void out.push({ code: 'PLACEMENT_NOT_A_PANEL', severity: 'error', instanceId: pl.instanceId, field, message: `${pl.instanceId} không phải tấm pin trong dự án` });
    if (seen.has(pl.instanceId)) return void out.push({ code: 'PANEL_DUPLICATE_PLACEMENT', severity: 'error', instanceId: pl.instanceId, field, message: `${label} được đặt hai lần (một tấm chỉ có một vị trí)` });
    seen.set(pl.instanceId, i);
    const face = faces.get(pl.roofFaceId);
    if (!face) return void out.push({ code: 'PANEL_FACE_MISSING', severity: 'error', instanceId: pl.instanceId, field, message: `${label}: mặt mái ${pl.roofFaceId} không tồn tại` });
    const d = panelDims(p, pl.instanceId);
    if (!d) return void out.push({ code: 'DIMENSION_UNKNOWN', severity: 'error', instanceId: pl.instanceId, faceId: face.roofFaceId, field, message: `${label}: thiếu kích thước (lengthM/widthM) trong linh kiện, không kiểm được vị trí` });
    const ring = panelRing(d, pl);
    rows.push({ pl, i, face, d, ring, box: bb(ring) });
    const f = `${field}`, add = (code: string, severity: 'error' | 'warning', message: string, other?: string) => out.push({ code, severity, instanceId: pl.instanceId, otherId: other, faceId: face.roofFaceId, field: f, message: `${label}: ${message}` });
    if (!ringContainsRing(face.outline, ring)) add('PANEL_OUT_OF_BOUNDS', 'error', `vượt biên ${face.label}`);
    else if (!ringContainsRing(face.outline, panelRing(d, pl, face.setbackM))) add('PANEL_SETBACK', 'warning', `cách mép ${face.label} dưới ${face.setbackM} m (khoảng cách ${face.setbackSource === 'assumption' ? 'giả định' : 'người dùng khai'})`);
    face.holes.forEach((h, k) => {
      if (ringsOverlap(ring, h)) add('PANEL_IN_HOLE', 'error', `chồng lên vùng loại trừ ${k + 1}`);
      else if (ringsOverlap(panelRing(d, pl, face.setbackM), h)) add('PANEL_SETBACK', 'warning', `cách vùng loại trừ ${k + 1} dưới ${face.setbackM} m`);
    });
    (p.obstacles ?? []).filter((o) => o.roofFaceId === face.roofFaceId).forEach((o) => {
      const fp = footprintOnFace(o, face);
      if (ringsOverlap(ring, fp)) add('PANEL_ON_OBSTACLE', 'error', `chồng lên vật cản "${o.label}"`);
      else if (ringsOverlap(panelRing(d, pl, face.setbackM), fp)) add('PANEL_SETBACK', 'warning', `cách vật cản "${o.label}" dưới ${face.setbackM} m`);
    });
  });
  // pairs on the same face (bounding-box prefilter keeps 40+ panels cheap)
  for (let x = 0; x < rows.length; x++) for (let y = x + 1; y < rows.length; y++) {
    const A = rows[x], B = rows[y];
    if (A.face.roofFaceId !== B.face.roofFaceId) continue;
    const g = layout.gapM / 2;
    if (!bbHit(A.box.map((v, k) => v + (k % 2 ? g : -g)), B.box.map((v, k) => v + (k % 2 ? g : -g)))) continue;
    const labelA = p.instances.find((i) => i.instanceId === A.pl.instanceId)?.label ?? A.pl.instanceId, labelB = p.instances.find((i) => i.instanceId === B.pl.instanceId)?.label ?? B.pl.instanceId;
    if (ringsOverlap(A.ring, B.ring)) out.push({ code: 'PANEL_OVERLAP', severity: 'error', instanceId: A.pl.instanceId, otherId: B.pl.instanceId, faceId: A.face.roofFaceId, field: `/placements/${A.i}`, message: `${labelA} giao nhau với ${labelB}` });
    else if (ringsOverlap(panelRing(A.d, A.pl, g), panelRing(B.d, B.pl, g))) out.push({ code: 'PANEL_GAP', severity: 'warning', instanceId: A.pl.instanceId, otherId: B.pl.instanceId, faceId: A.face.roofFaceId, field: `/placements/${A.i}`, message: `${labelA} và ${labelB} cách nhau dưới ${layout.gapM} m` });
  }
  return out;
}
