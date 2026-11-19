import type { Obstacle, RoofFace } from './types';

// Roof geometry. World = ENU metres (East, North, Up). Azimuth = clockwise from North. Face frame: a = along the eave
// (to the viewer's right when facing the roof from outside), b = up the slope. All polygon work is 2D in the face frame.
export type Pt = [number, number];
export interface V3 { e: number; n: number; up: number }
const D2R = Math.PI / 180;
const EPS = 1e-9;

export function faceBasis(f: Pick<RoofFace, 'tiltDeg' | 'azimuthDeg'>): { u: V3; v: V3; normal: V3 } {
  const b = f.tiltDeg * D2R, g = f.azimuthDeg * D2R;
  return {
    u: { e: -Math.cos(g), n: Math.sin(g), up: 0 },
    v: { e: -Math.sin(g) * Math.cos(b), n: -Math.cos(g) * Math.cos(b), up: Math.sin(b) },
    normal: { e: Math.sin(b) * Math.sin(g), n: Math.sin(b) * Math.cos(g), up: Math.cos(b) },
  };
}

/** Face-frame point (a, b), lifted h metres along the outward normal, to world ENU. */
export function toWorld(f: RoofFace, [a, b]: Pt, h = 0): V3 {
  const { u, v, normal: n } = faceBasis(f);
  return { e: f.origin.e + a * u.e + b * v.e + h * n.e, n: f.origin.n + a * u.n + b * v.n + h * n.n, up: f.origin.up + a * u.up + b * v.up + h * n.up };
}

/** Vertical projection of a world point onto the face frame (what a plan view sees). Needs a face that is not vertical. */
export function toLocalHorizontal(f: RoofFace, p: { e: number; n: number }): Pt {
  const { u, v } = faceBasis(f);
  const dx = p.e - f.origin.e, dy = p.n - f.origin.n;
  const vv = v.e * v.e + v.n * v.n;
  return [dx * u.e + dy * u.n, (dx * v.e + dy * v.n) / vv];
}

/** Adapter for Three.js (x = East, y = Up, z = −North). Nothing else in the domain knows about it. */
export const enuToThree = (p: V3): [number, number, number] => [p.e, p.up, -p.n];

// ---- polygons ----------------------------------------------------------------------------------------------
export const signedArea = (r: Pt[]) => r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + (p[0] * q[1] - q[0] * p[1]); }, 0) / 2;
export const ccw = (r: Pt[]): Pt[] => (signedArea(r) < 0 ? [...r].reverse() : r);
const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** Interiors of segments p1p2 and p3p4 cross at a single interior point (touching or collinear overlap is not a crossing). */
export function segmentsCross(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2), d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4);
  return ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) && ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS));
}
const onSeg = (p: Pt, a: Pt, b: Pt) => Math.abs(cross(a, b, p)) <= 1e-9 && p[0] >= Math.min(a[0], b[0]) - 1e-9 && p[0] <= Math.max(a[0], b[0]) + 1e-9 && p[1] >= Math.min(a[1], b[1]) - 1e-9 && p[1] <= Math.max(a[1], b[1]) + 1e-9;

export type Where = 'in' | 'on' | 'out';
/** Point against a simple polygon (any winding): strictly inside, on the boundary, or outside. */
export function locate(p: Pt, ring: Pt[]): Where {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    if (onSeg(p, ring[j], ring[i])) return 'on';
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside ? 'in' : 'out';
}

/** No two non-adjacent edges cross or touch, no repeated vertex, area > 0. */
export function isSimplePolygon(r: Pt[]): boolean {
  const n = r.length;
  if (n < 3 || Math.abs(signedArea(r)) < 1e-9) return false;
  for (let i = 0; i < n; i++) {
    if (r.some((q, j) => j > i && Math.abs(q[0] - r[i][0]) < 1e-12 && Math.abs(q[1] - r[i][1]) < 1e-12)) return false;
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      const a = r[i], b = r[(i + 1) % n], c = r[j], d = r[(j + 1) % n];
      if (segmentsCross(a, b, c, d) || onSeg(c, a, b) || onSeg(d, a, b) || onSeg(a, c, d) || onSeg(b, c, d)) return false;
    }
  }
  return true;
}

/** Corners of a rotated rectangle: centre, half-extent along a (hu) and along b (hv), rotated CCW by angleDeg in the face frame. */
export function rectRing([ca, cb]: Pt, hu: number, hv: number, angleDeg = 0): Pt[] {
  const c = Math.cos(angleDeg * D2R), s = Math.sin(angleDeg * D2R);
  return ([[-hu, -hv], [hu, -hv], [hu, hv], [-hu, hv]] as Pt[]).map(([x, y]) => [ca + x * c - y * s, cb + x * s + y * c] as Pt);
}

/** True if the rectangle lies within the polygon (boundary allowed). Handles concave polygons. */
export function ringContainsRing(outer: Pt[], inner: Pt[]): boolean {
  if (inner.some((p) => locate(p, outer) === 'out')) return false;
  for (let i = 0; i < inner.length; i++) for (let j = 0; j < outer.length; j++) if (segmentsCross(inner[i], inner[(i + 1) % inner.length], outer[j], outer[(j + 1) % outer.length])) return false;
  return !outer.some((p) => locate(p, inner) === 'in'); // a notch poking into the rectangle
}

const isConvex = (r: Pt[]) => { let sign = 0; for (let i = 0; i < r.length; i++) { const c = cross(r[i], r[(i + 1) % r.length], r[(i + 2) % r.length]); if (Math.abs(c) < 1e-12) continue; if (!sign) sign = Math.sign(c); else if (Math.sign(c) !== sign) return false; } return true; };

/** Subject clipped by a convex polygon (Sutherland–Hodgman). The result may carry zero-width bridges for a concave subject; its area is still right. */
function clipByConvex(subject: Pt[], clip: Pt[]): Pt[] {
  const c = ccw(clip);
  let out = subject;
  for (let i = 0; i < c.length && out.length; i++) {
    const a = c[i], b = c[(i + 1) % c.length], inside = (q: Pt) => cross(a, b, q) >= -1e-12;
    const next: Pt[] = [];
    out.forEach((cur, k) => {
      const prev = out[(k + out.length - 1) % out.length], ci = inside(cur), pi = inside(prev);
      if (ci !== pi) {
        const d1 = cross(a, b, prev), d2 = cross(a, b, cur), t = d1 / (d1 - d2);
        next.push([prev[0] + t * (cur[0] - prev[0]), prev[1] + t * (cur[1] - prev[1])]);
      }
      if (ci) next.push(cur);
    });
    out = next;
  }
  return out;
}

/** Overlap area in m² of two polygons, at least one of them convex (panels and obstacle footprints are). */
export function overlapArea(a: Pt[], b: Pt[]): number {
  if (isConvex(b)) return Math.abs(signedArea(clipByConvex(a, b)));
  if (isConvex(a)) return Math.abs(signedArea(clipByConvex(b, a)));
  throw new Error('overlapArea needs one convex polygon');
}
/** True if the polygons share area (touching edges or corners does not count). Robust to collinear edges: a 1 cm overlap in a row counts. */
export const ringsOverlap = (a: Pt[], b: Pt[]): boolean => overlapArea(a, b) > 1e-8;

export const bbox = (r: Pt[]) => ({ minA: Math.min(...r.map((p) => p[0])), maxA: Math.max(...r.map((p) => p[0])), minB: Math.min(...r.map((p) => p[1])), maxB: Math.max(...r.map((p) => p[1])) });

// ---- obstacles ---------------------------------------------------------------------------------------------
/** Footprint in ENU. Box: x side runs along bearing angleDeg (clockwise from North). Cylinder: 16-gon circumscribed about the circle (never smaller than the real one). */
export function obstacleFootprint(o: Obstacle): { e: number; n: number }[] {
  const al = o.angleDeg * D2R, ex = { e: Math.sin(al), n: Math.cos(al) }, ey = { e: -Math.cos(al), n: Math.sin(al) };
  const corner = (x: number, y: number) => ({ e: o.center.e + x * ex.e + y * ey.e, n: o.center.n + x * ex.n + y * ey.n });
  if (o.kind === 'box') return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => corner((sx * o.size.x) / 2, (sy * o.size.y) / 2));
  const r = o.size.x / 2 / Math.cos(Math.PI / 16);
  return Array.from({ length: 16 }, (_, k) => ({ e: o.center.e + r * Math.cos((k * Math.PI) / 8), n: o.center.n + r * Math.sin((k * Math.PI) / 8) }));
}
/** Obstacle footprint seen from above, in a face's frame. */
export const footprintOnFace = (o: Obstacle, f: RoofFace): Pt[] => obstacleFootprint(o).map((p) => toLocalHorizontal(f, p));
