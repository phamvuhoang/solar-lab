import { newId } from './ids';
import { fitsFace, layoutOf, panelDims, panelRing } from './placement';
import { bbox, toWorld, type Pt } from './roof';
import type { Obstacle, Placement, Project, RoofFace } from './types';

// Pure layout edits. Each returns a new project; saving it is what makes the "layout revision".
const clone = (p: Project) => structuredClone(p);
const rect = (w: number, h: number): Pt[] => [[0, 0], [w, 0], [w, h], [0, h]];
export const FACE_SETBACK_ASSUMPTION = 0.3;

export function addRoofFace(p: Project, f: Omit<RoofFace, 'roofFaceId'>): Project {
  const next = clone(p);
  next.roofFaces = [...next.roofFaces, { ...f, roofFaceId: newId('roof') }];
  return next;
}
export const faceRect = (label: string, widthM: number, slopeM: number, tiltDeg: number, azimuthDeg: number, origin: RoofFace['origin']): Omit<RoofFace, 'roofFaceId'> =>
  ({ label, outline: rect(widthM, slopeM), holes: [], tiltDeg, azimuthDeg, origin, setbackM: FACE_SETBACK_ASSUMPTION, setbackSource: 'assumption' });

export function updateFace(p: Project, id: string, patch: Partial<Omit<RoofFace, 'roofFaceId'>>): Project {
  const next = clone(p);
  const f = next.roofFaces.find((x) => x.roofFaceId === id);
  if (!f) throw new Error('UNKNOWN_FACE');
  Object.assign(f, patch);
  return next;
}
export function addHole(p: Project, faceId: string, ring: Pt[]): Project {
  const next = clone(p);
  const f = next.roofFaces.find((x) => x.roofFaceId === faceId);
  if (!f) throw new Error('UNKNOWN_FACE');
  f.holes.push(ring);
  return next;
}
/** Removing a face drops the placements on it (the panels stay in the design, unplaced) and detaches its obstacles. */
export function removeFace(p: Project, faceId: string): Project {
  const next = clone(p);
  next.roofFaces = next.roofFaces.filter((f) => f.roofFaceId !== faceId);
  next.placements = (next.placements ?? []).filter((pl) => pl.roofFaceId !== faceId);
  next.obstacles = (next.obstacles ?? []).map((o) => (o.roofFaceId === faceId ? { ...o, roofFaceId: null } : o));
  return next;
}
export function addObstacle(p: Project, o: Omit<Obstacle, 'obstacleId'>): Project {
  const next = clone(p);
  next.obstacles = [...(next.obstacles ?? []), { ...o, obstacleId: newId('obs') }];
  return next;
}
export function removeObstacle(p: Project, id: string): Project {
  const next = clone(p);
  next.obstacles = (next.obstacles ?? []).filter((o) => o.obstacleId !== id);
  return next;
}

export function moveObstacle(p: Project, id: string, dE: number, dN: number): Project {
  const next = clone(p);
  const o = (next.obstacles ?? []).find((x) => x.obstacleId === id);
  if (!o) throw new Error('UNKNOWN_OBSTACLE');
  const q = (x: number) => Math.round(x * 1e6) / 1e6; // micrometres: nudging out and back must give back exactly the same geometry
  o.center = { e: q(o.center.e + dE), n: q(o.center.n + dN) };
  return next;
}

/**
 * The demo water tank: a Ø1,2 × 1,8 m cylinder at roof level, 0,9 m beyond the eave of the first face (down-slope side), mid-width.
 * Moves the obstacle called "Bồn nước" if there is one, otherwise adds it. Illustrative position, not a measurement.
 */
export function placeTankNearRoof(p: Project): Project {
  const f = p.roofFaces[0];
  if (!f) throw new Error('NO_FACE');
  const g = (f.azimuthDeg * Math.PI) / 180, a = (Math.min(...f.outline.map((q) => q[0])) + Math.max(...f.outline.map((q) => q[0]))) / 2;
  const eave = toWorld(f, [a, Math.min(...f.outline.map((q) => q[1]))]);
  const center = { e: eave.e + Math.sin(g) * 0.9, n: eave.n + Math.cos(g) * 0.9 };
  const next = clone(p);
  const ex = (next.obstacles ?? []).find((o) => o.label === 'Bồn nước');
  if (ex) { ex.center = center; ex.baseUp = f.origin.up; return next; }
  next.obstacles = [...(next.obstacles ?? []), { obstacleId: newId('obs'), label: 'Bồn nước', kind: 'cylinder', roofFaceId: null, center, baseUp: f.origin.up, angleDeg: 0, size: { x: 1.2, y: 1.2, z: 1.8 } }];
  return next;
}

export const placedIds = (p: Project) => new Set((p.placements ?? []).map((x) => x.instanceId));
export const unplacedPanels = (p: Project): string[] => p.instances.filter((i) => i.kind === 'panel' && !placedIds(p).has(i.instanceId)).map((i) => i.instanceId);

const extent = (d: { lengthM: number; widthM: number }, angleDeg: number): { pw: number; ph: number } => {
  const land = Math.round(angleDeg / 90) % 2 !== 0;
  return land ? { pw: d.lengthM, ph: d.widthM } : { pw: d.widthM, ph: d.lengthM };
};

/** A block of panels: `cols` per row, rows going up the slope, starting at (a0, b0) = lower-left corner of the block. Panels need known sizes. */
export function placeGrid(p: Project, faceId: string, ids: string[], o: { a0: number; b0: number; cols: number; angleDeg?: number; gapU?: number; gapV?: number }): Project {
  const next = clone(p);
  if (!next.roofFaces.some((f) => f.roofFaceId === faceId)) throw new Error('UNKNOWN_FACE');
  const gap = layoutOf(p).gapM, angle = o.angleDeg ?? 0;
  const placed = new Set(ids);
  next.placements = (next.placements ?? []).filter((x) => !placed.has(x.instanceId));
  ids.forEach((id, k) => {
    const d = panelDims(p, id);
    if (!d) throw new Error('DIMENSION_UNKNOWN');
    const { pw, ph } = extent(d, angle), col = k % o.cols, row = Math.floor(k / o.cols);
    next.placements!.push({ instanceId: id, roofFaceId: faceId, center: [o.a0 + col * (pw + (o.gapU ?? gap)) + pw / 2, o.b0 + row * (ph + (o.gapV ?? gap)) + ph / 2], angleDeg: angle });
  });
  return next;
}

/** Fill a face with as many of `ids` as fit at the face's setback, scanning row by row from the lower-left. Returns what could not be placed. */
export function fillFace(p: Project, faceId: string, ids: string[], angleDeg = 0): { project: Project; placed: string[]; left: string[] } {
  const face = p.roofFaces.find((f) => f.roofFaceId === faceId);
  if (!face) throw new Error('UNKNOWN_FACE');
  const gap = layoutOf(p).gapM, box = bbox(face.outline);
  const next = clone(p);
  next.placements = next.placements ?? [];
  const todo = [...ids], placed: string[] = [];
  const first = todo.length ? panelDims(p, todo[0]) : null;
  if (!first) return { project: next, placed, left: todo };
  const { pw, ph } = extent(first, angleDeg);
  for (let b = box.minB + face.setbackM + ph / 2; b + ph / 2 + face.setbackM <= box.maxB + 1e-9 && todo.length; b += ph + gap) {
    for (let a = box.minA + face.setbackM + pw / 2; a + pw / 2 + face.setbackM <= box.maxA + 1e-9 && todo.length; a += pw + gap) {
      const d = panelDims(p, todo[0]);
      if (!d) { todo.shift(); continue; }
      const pl: Placement = { instanceId: todo[0], roofFaceId: faceId, center: [a, b], angleDeg };
      const clear = panelRing(d, pl, face.setbackM);
      const tooClose = next.placements.some((q) => q.roofFaceId === faceId && (() => { const dq = panelDims(p, q.instanceId); return !!dq && Math.abs(q.center[0] - a) < (pw + extent(dq, q.angleDeg).pw) / 2 + gap - 1e-6 && Math.abs(q.center[1] - b) < (ph + extent(dq, q.angleDeg).ph) / 2 + gap - 1e-6; })());
      if (!tooClose && fitsFace(next, face, clear)) { next.placements.push(pl); placed.push(todo.shift()!); }
    }
  }
  return { project: next, placed, left: todo };
}

/** Snap a centre to nearby panel edges (gap apart or flush) on the same face, else to the grid. Only for axis-aligned panels. */
export function snapCenter(p: Project, id: string, center: Pt, o: { grid?: boolean; tolM?: number } = {}): Pt {
  const me = (p.placements ?? []).find((x) => x.instanceId === id), d = panelDims(p, id);
  if (!me || !d) return center;
  const { gridM, gapM } = layoutOf(p), tol = o.tolM ?? 0.08, mine = extent(d, me.angleDeg);
  const snapAxis = (axis: 0 | 1) => {
    const half = (axis === 0 ? mine.pw : mine.ph) / 2;
    let best = center[axis], bestD = tol;
    for (const q of p.placements ?? []) {
      if (q.instanceId === id || q.roofFaceId !== me.roofFaceId) continue;
      const dq = panelDims(p, q.instanceId);
      if (!dq) continue;
      const e = extent(dq, q.angleDeg), qh = (axis === 0 ? e.pw : e.ph) / 2, qc = q.center[axis];
      for (const c of [qc + qh + gapM + half, qc - qh - gapM - half, qc, qc + qh - half, qc - qh + half]) if (Math.abs(c - center[axis]) < bestD) { bestD = Math.abs(c - center[axis]); best = c; }
    }
    return best === center[axis] && o.grid !== false ? Math.round(center[axis] / gridM) * gridM : best;
  };
  return [snapAxis(0), snapAxis(1)];
}

/** Move panels by (da, db) in the face frame. With `snap`, each panel is snapped to neighbours or the grid. Placements of other faces are untouched. */
export function movePanels(p: Project, ids: string[], [da, db]: Pt, o: { snap?: boolean } = {}): Project {
  const next = clone(p), set = new Set(ids);
  next.placements = (next.placements ?? []).map((pl) => (set.has(pl.instanceId) ? { ...pl, center: [pl.center[0] + da, pl.center[1] + db] as Pt } : pl));
  if (o.snap && ids.length === 1) {
    const pl = next.placements.find((x) => x.instanceId === ids[0])!;
    pl.center = snapCenter(next, ids[0], pl.center);
  } else if (o.snap) {
    const g = layoutOf(p).gridM;
    next.placements = next.placements.map((pl) => (set.has(pl.instanceId) ? { ...pl, center: [Math.round(pl.center[0] / g) * g, Math.round(pl.center[1] / g) * g] as Pt } : pl));
  }
  return next;
}
/** Portrait ↔ landscape for each selected panel, about its centre. */
export function rotate90(p: Project, ids: string[]): Project {
  const next = clone(p), set = new Set(ids);
  next.placements = (next.placements ?? []).map((pl) => (set.has(pl.instanceId) ? { ...pl, angleDeg: (pl.angleDeg + 90) % 180 } : pl));
  return next;
}
export function removePlacements(p: Project, ids: string[]): Project {
  const next = clone(p), set = new Set(ids);
  next.placements = (next.placements ?? []).filter((x) => !set.has(x.instanceId));
  return next;
}
export const clearPlacements = (p: Project): Project => ({ ...clone(p), placements: [] });

/** The illustrative gable roof used by the demo: two faces of 10 × 3,25 m at 10°, ridge along East–West. Replace with measured numbers. */
export function demoGableRoof(p: Project): Project {
  let next = addRoofFace(p, faceRect('Mái Nam (minh họa)', 10, 3.25, 10, 180, { e: 0, n: 0, up: 3 }));
  next = addRoofFace(next, faceRect('Mái Bắc (minh họa)', 10, 3.25, 10, 0, { e: 10, n: 6.4, up: 3 }));
  return next;
}
