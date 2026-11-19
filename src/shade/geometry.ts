import { obstacleFootprint, toWorld, type Pt, type V3 } from '../domain/roof';
import type { Project } from '../domain/types';

// Occluders and ray primitives for direct-beam shading. ENU metres. Pure CPU code: nothing here reads pixels.
export const SHADE_MODEL_VERSION = 'shade-raycast-1.0.0';
export type Vec = [number, number, number]; // [east, north, up]

export const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const vec = (p: V3): Vec => [p.e, p.n, p.up];
const D2R = Math.PI / 180;

/** Unit vector pointing at the sun. azimuth: clockwise from North; zenith: from straight up. East = +e, North = +n. */
export function sunVector(azimuthDeg: number, zenithDeg: number): Vec {
  const z = zenithDeg * D2R, a = azimuthDeg * D2R;
  return [Math.sin(z) * Math.sin(a), Math.sin(z) * Math.cos(a), Math.cos(z)];
}

export interface OrientedBox { kind: 'box'; id: string; label: string; center: Vec; axes: [Vec, Vec, Vec]; half: Vec; min: Vec; max: Vec }
export interface Cylinder { kind: 'cylinder'; id: string; label: string; cx: number; cn: number; z0: number; z1: number; r: number; min: Vec; max: Vec }
export interface Tri { a: Vec; b: Vec; c: Vec; faceId: string }
export interface Occluders { boxes: OrientedBox[]; cylinders: Cylinder[]; tris: Tri[]; triBounds: { faceId: string; min: Vec; max: Vec }[] }

const EPS = 1e-9;

/** Slab test against an oriented box. A ray that only grazes a face, edge or corner does NOT count as blocked. */
export function rayHitsBox(o: Vec, d: Vec, b: OrientedBox): boolean {
  const rel = sub(o, b.center);
  let t0 = EPS, t1 = Infinity;
  for (let k = 0; k < 3; k++) {
    const ax = b.axes[k], po = dot(rel, ax), pd = dot(d, ax), h = b.half[k];
    if (Math.abs(pd) < 1e-12) { if (Math.abs(po) >= h - EPS) return false; continue; }
    let a = (-h - po) / pd, c = (h - po) / pd;
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, c);
    if (t0 >= t1 - EPS) return false; // empty or zero-thickness overlap: grazing
  }
  return true;
}

/** Vertical cylinder (true circle, not the 16-gon used for placement). Needs an upward ray (the sun is above the horizon). */
export function rayHitsCylinder(o: Vec, d: Vec, c: Cylinder): boolean {
  const dx = d[0], dy = d[1], ox = o[0] - c.cx, oy = o[1] - c.cn;
  const a = dx * dx + dy * dy;
  let tIn: number, tOut: number;
  if (a < 1e-12) { if (ox * ox + oy * oy >= c.r * c.r - EPS) return false; tIn = -Infinity; tOut = Infinity; } // straight up
  else {
    const b = 2 * (ox * dx + oy * dy), cc = ox * ox + oy * oy - c.r * c.r, disc = b * b - 4 * a * cc;
    if (disc <= EPS) return false; // misses or grazes the side
    const s = Math.sqrt(disc);
    tIn = (-b - s) / (2 * a); tOut = (-b + s) / (2 * a);
  }
  let z0 = -Infinity, z1 = Infinity;
  if (Math.abs(d[2]) < 1e-12) { if (o[2] <= c.z0 + EPS || o[2] >= c.z1 - EPS) return false; } // horizontal ray: only the height of the ray matters
  else { z0 = (c.z0 - o[2]) / d[2]; z1 = (c.z1 - o[2]) / d[2]; if (z0 > z1) [z0, z1] = [z1, z0]; }
  const lo = Math.max(tIn, z0, EPS), hi = Math.min(tOut, z1);
  return hi - lo > EPS;
}

/** Möller–Trumbore, two-sided, hits only in front of the origin. */
export function rayHitsTri(o: Vec, d: Vec, t: Tri): boolean {
  const e1 = sub(t.b, t.a), e2 = sub(t.c, t.a);
  const p: Vec = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
  const det = dot(e1, p);
  if (Math.abs(det) < 1e-12) return false;
  const inv = 1 / det, s = sub(o, t.a), u = dot(s, p) * inv;
  if (u < 1e-9 || u > 1 - 1e-9) return false;
  const q: Vec = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
  const v = dot(d, q) * inv;
  if (v < 1e-9 || u + v > 1 - 1e-9) return false;
  return dot(e2, q) * inv > 1e-6;
}

/** Ear clipping for a simple polygon (face outline); holes are ignored: a roof is treated as solid. */
export function triangulate(ring: Pt[]): [number, number, number][] {
  const idx = ring.map((_, i) => i);
  const area = ring.reduce((s, p, i) => { const q = ring[(i + 1) % ring.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0);
  if (area < 0) idx.reverse();
  const cross = (a: Pt, b: Pt, c: Pt) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inside = (p: Pt, a: Pt, b: Pt, c: Pt) => cross(a, b, p) >= -1e-12 && cross(b, c, p) >= -1e-12 && cross(c, a, p) >= -1e-12;
  const out: [number, number, number][] = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let k = 0; k < idx.length; k++) {
      const i0 = idx[(k + idx.length - 1) % idx.length], i1 = idx[k], i2 = idx[(k + 1) % idx.length];
      const a = ring[i0], b = ring[i1], c = ring[i2];
      if (cross(a, b, c) <= 1e-12) continue;
      if (idx.some((j) => j !== i0 && j !== i1 && j !== i2 && inside(ring[j], a, b, c))) continue;
      out.push([i0, i1, i2]); idx.splice(k, 1); clipped = true; break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) out.push([idx[0], idx[1], idx[2]]);
  return out;
}

const aabb = (pts: Vec[]) => ({ min: [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.min(...pts.map((p) => p[2]))] as Vec, max: [Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[2]))] as Vec });

/** Everything that can cast a shadow: obstacles (exact box / cylinder) and roof faces. `exceptFace` is the face a panel sits on. */
export function buildOccluders(p: Project): Occluders {
  const boxes: OrientedBox[] = [], cylinders: Cylinder[] = [], tris: Tri[] = [], triBounds: Occluders['triBounds'] = [];
  for (const o of p.obstacles ?? []) {
    if (o.kind === 'box') {
      const al = o.angleDeg * D2R, ex: Vec = [Math.sin(al), Math.cos(al), 0], ey: Vec = [-Math.cos(al), Math.sin(al), 0], ez: Vec = [0, 0, 1];
      const center: Vec = [o.center.e, o.center.n, o.baseUp + o.size.z / 2];
      const corners = obstacleFootprint(o).flatMap((q) => [[q.e, q.n, o.baseUp] as Vec, [q.e, q.n, o.baseUp + o.size.z] as Vec]);
      boxes.push({ kind: 'box', id: o.obstacleId, label: o.label, center, axes: [ex, ey, ez], half: [o.size.x / 2, o.size.y / 2, o.size.z / 2], ...aabb(corners) });
    } else {
      const r = o.size.x / 2;
      cylinders.push({ kind: 'cylinder', id: o.obstacleId, label: o.label, cx: o.center.e, cn: o.center.n, z0: o.baseUp, z1: o.baseUp + o.size.z, r,
        min: [o.center.e - r, o.center.n - r, o.baseUp], max: [o.center.e + r, o.center.n + r, o.baseUp + o.size.z] });
    }
  }
  for (const f of p.roofFaces) {
    const w = f.outline.map((q) => vec(toWorld(f, q)));
    for (const [a, b, c] of triangulate(f.outline)) {
      const t: Tri = { a: w[a], b: w[b], c: w[c], faceId: f.roofFaceId };
      tris.push(t);
    }
    triBounds.push({ faceId: f.roofFaceId, ...aabb(w) });
  }
  return { boxes, cylinders, tris, triBounds };
}

/** Does the segment of a sun ray from `o` along `d` (unit) intersect this AABB? Cheap reject before the exact tests. */
export function rayHitsAabb(o: Vec, d: Vec, min: Vec, max: Vec): boolean {
  let t0 = 0, t1 = Infinity;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d[k]) < 1e-12) { if (o[k] < min[k] - 1e-9 || o[k] > max[k] + 1e-9) return false; continue; }
    let a = (min[k] - o[k]) / d[k], b = (max[k] - o[k]) / d[k];
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t0 > t1) return false;
  }
  return true;
}

/** True if any occluder blocks the ray. Triangles of `ownFace` are skipped (a panel never shades itself or its own roof). */
export function blocked(o: Vec, d: Vec, occ: Occluders, ownFace: string): boolean {
  for (const b of occ.boxes) if (rayHitsAabb(o, d, b.min, b.max) && rayHitsBox(o, d, b)) return true;
  for (const c of occ.cylinders) if (rayHitsAabb(o, d, c.min, c.max) && rayHitsCylinder(o, d, c)) return true;
  for (const t of occ.tris) if (t.faceId !== ownFace && rayHitsTri(o, d, t)) return true;
  return false;
}

