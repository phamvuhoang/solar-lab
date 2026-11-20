import { hashOf } from '../domain/hash';
import { panelDims, panelRing } from '../domain/placement';
import { faceBasis, toWorld } from '../domain/roof';
import type { Project } from '../domain/types';
import { pressureAt, sunPosition } from '../engine/solar';
import { PANEL_LIFT_M } from '../scene/model';
import type { WeatherSeries } from '../weather/series';
import { blocked, buildOccluders, dot, SHADE_MODEL_VERSION, sunVector, type Occluders, type Vec } from './geometry';

export interface ShadeSettings { enabled: boolean; mode: 'preview' | 'standard'; grid: number }
export const SHADE_DEFAULTS: ShadeSettings = { enabled: false, mode: 'standard', grid: 4 };
export const shadeSettingsOf = (p: Project): ShadeSettings => ({ ...SHADE_DEFAULTS, ...p.shade });
/** Samples start this far above the panel plane so a ray never hits the panel's own surface. */
export const RAY_OFFSET_M = 0.001;

export interface ShadePanel { id: string; label: string; faceId: string; normal: Vec; samples: Vec[] }
export interface ShadeSpec {
  modelVersion: string; mode: 'preview' | 'standard'; grid: number; samplesPerPanel: number; rayOffsetM: number;
  panels: ShadePanel[]; occluders: Occluders; unplaced: string[];
  location: { latitude: number; longitude: number; elevationM: number }; t0: number; stepSeconds: number; n: number;
  geometryHash: string; key: string;
}
/** Direct-beam access per panel and step: fraction of sample points that see the sun (0 at night and when the sun is behind the panel). */
export interface ShadeField {
  key: string; geometryHash: string; modelVersion: string; mode: 'preview' | 'standard'; grid: number; samplesPerPanel: number; rayOffsetM: number;
  panelIds: string[]; t0: number; stepSeconds: number; n: number; access: Float32Array[]; done: Uint8Array;
  obstacles: { id: string; label: string; kind: 'box' | 'cylinder'; center: Vec; size: Vec }[]; computeMs: number;
}

/** Cell-centred n × n points on the panel (1 point at the centre for preview), lifted onto the panel plane. */
function samplePoints(p: Project, id: string, n: number): { faceId: string; normal: Vec; samples: Vec[] } | null {
  const pl = (p.placements ?? []).find((x) => x.instanceId === id), d = panelDims(p, id);
  const face = pl && p.roofFaces.find((f) => f.roofFaceId === pl.roofFaceId);
  if (!pl || !d || !face) return null;
  const { normal } = faceBasis(face);
  const ring = panelRing(d, pl);
  const [c0, c1, , c3] = ring; // corners: a−b−, a+b−, a+b+, a−b+ rotated with the panel
  const out: Vec[] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const s = (i + 0.5) / n, t = (j + 0.5) / n;
    const pt: [number, number] = [c0[0] + (c1[0] - c0[0]) * s + (c3[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * s + (c3[1] - c0[1]) * t];
    const w = toWorld(face, pt, PANEL_LIFT_M + RAY_OFFSET_M);
    out.push([w.e, w.n, w.up]);
  }
  return { faceId: face.roofFaceId, normal: [normal.e, normal.n, normal.up], samples: out };
}

/** Geometry and time grid in, a content-addressed spec out. The key changes iff the numbers could change: obstacles, panels, location, time grid, sampling, model version. */
export async function buildShadeSpec(p: Project, weather: Pick<WeatherSeries, 't0' | 'stepSeconds' | 'n' | 'location'>, settings: Pick<ShadeSettings, 'mode' | 'grid'>): Promise<ShadeSpec> {
  const grid = settings.mode === 'preview' ? 1 : Math.max(1, Math.round(settings.grid));
  const panels: ShadePanel[] = [], unplaced: string[] = [];
  for (const i of p.instances) if (i.kind === 'panel') {
    const s = samplePoints(p, i.instanceId, grid);
    if (s) panels.push({ id: i.instanceId, label: i.label, ...s }); else unplaced.push(i.instanceId);
  }
  const occluders = buildOccluders(p);
  // quantised to 1 µm so float noise (a nudge out and back) does not change the key
  const q = (v: unknown): unknown => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : Array.isArray(v) ? v.map(q) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, q(x)])) : v);
  const geometryHash = await hashOf(q({ panels: panels.map((x) => [x.id, x.samples]), boxes: occluders.boxes.map((b) => [b.center, b.axes, b.half]), cylinders: occluders.cylinders.map((c) => [c.cx, c.cn, c.z0, c.z1, c.r]), tris: occluders.tris.map((t) => [t.a, t.b, t.c, t.faceId]) }));
  const location = { latitude: weather.location.latitude, longitude: weather.location.longitude, elevationM: weather.location.elevationM ?? 0 };
  const spec: Omit<ShadeSpec, 'key'> = { modelVersion: SHADE_MODEL_VERSION, mode: settings.mode, grid, samplesPerPanel: grid * grid, rayOffsetM: RAY_OFFSET_M, panels, occluders, unplaced, location, t0: weather.t0, stepSeconds: weather.stepSeconds, n: weather.n, geometryHash };
  const key = await hashOf({ geometryHash, location, t0: spec.t0, stepSeconds: spec.stepSeconds, n: spec.n, samples: spec.samplesPerPanel, rayOffsetM: RAY_OFFSET_M, modelVersion: SHADE_MODEL_VERSION });
  return { ...spec, key };
}

export function emptyField(spec: ShadeSpec): ShadeField {
  return {
    key: spec.key, geometryHash: spec.geometryHash, modelVersion: spec.modelVersion, mode: spec.mode, grid: spec.grid, samplesPerPanel: spec.samplesPerPanel, rayOffsetM: spec.rayOffsetM,
    panelIds: spec.panels.map((x) => x.id), t0: spec.t0, stepSeconds: spec.stepSeconds, n: spec.n, access: spec.panels.map(() => new Float32Array(spec.n)), done: new Uint8Array(spec.n),
    obstacles: [...spec.occluders.boxes.map((b) => ({ id: b.id, label: b.label, kind: 'box' as const, center: b.center, size: [b.half[0] * 2, b.half[1] * 2, b.half[2] * 2] as Vec })),
      ...spec.occluders.cylinders.map((c) => ({ id: c.id, label: c.label, kind: 'cylinder' as const, center: [c.cx, c.cn, (c.z0 + c.z1) / 2] as Vec, size: [c.r * 2, c.r * 2, c.z1 - c.z0] as Vec }))], computeMs: 0,
  };
}

/** Direct access of one panel at one instant: fraction of its sample points whose ray to the sun is not blocked. */
export function directAccess(panel: ShadePanel, sun: Vec, occ: Occluders): number {
  if (dot(sun, panel.normal) <= 1e-6) return 0; // sun behind the panel: no direct beam at all
  let seen = 0;
  for (const s of panel.samples) if (!blocked(s, sun, occ, panel.faceId)) seen++;
  return seen / panel.samples.length;
}

export interface ShadeHooks { onProgress?(done: number, total: number): void; isCancelled?(): boolean; batch?: number }
export interface ShadeRun { field: ShadeField; computed: number; reused: number }

/**
 * Fill `field` for steps [from, to). Steps already done are reused (cache hits); the rest are computed.
 * Returns null if cancelled. Completed steps stay valid (the `done` mask is honest), so a cancelled run never poisons the cache.
 */
export async function computeShade(spec: ShadeSpec, existing: ShadeField | null, range: [number, number] | null = null, hooks: ShadeHooks = {}): Promise<ShadeRun | null> {
  const field = existing && existing.key === spec.key ? existing : emptyField(spec);
  const [from, to] = range ? [Math.max(0, range[0]), Math.min(spec.n, range[1])] : [0, spec.n];
  const pressure = pressureAt(spec.location.elevationM);
  const batch = hooks.batch ?? 12;
  let computed = 0, reused = 0;
  const t0 = performance.now();
  for (let i = from; i < to; i++) {
    if (field.done[i]) { reused++; continue; }
    if ((i - from) % batch === 0) {
      if (hooks.isCancelled?.()) return null;
      hooks.onProgress?.(i - from, to - from);
      await new Promise<void>((r) => setTimeout(r, 0));
    }
    const sp = sunPosition(spec.t0 + (i + 0.5) * spec.stepSeconds, spec.location.latitude, spec.location.longitude, { pressurePa: pressure });
    if (sp.apparentElevationDeg > 0) {
      const sun = sunVector(sp.azimuthDeg, sp.apparentZenithDeg);
      spec.panels.forEach((pn, k) => { field.access[k][i] = directAccess(pn, sun, spec.occluders); });
    }
    field.done[i] = 1;
    computed++;
  }
  hooks.onProgress?.(to - from, to - from);
  field.computeMs += performance.now() - t0;
  return { field, computed, reused };
}

/** In-memory cache of shade fields by key. A hit needs every requested step already done. */
export class ShadeCache {
  private map = new Map<string, ShadeField>();
  hits = 0; misses = 0;
  get(key: string) { return this.map.get(key) ?? null; }
  /**
   * Keeps every step either field has done: a day computed from an older copy, finishing after a full-year run, must not
   * throw the year away. Same key = same panels, steps and inputs, so a done step holds the same values in both.
   */
  put(f: ShadeField) {
    const old = this.map.get(f.key);
    if (old && old !== f) for (let i = 0; i < f.n; i++) if (old.done[i] && !f.done[i]) { f.done[i] = 1; for (let k = 0; k < f.access.length; k++) f.access[k][i] = old.access[k][i]; }
    this.map.delete(f.key); // re-inserted last: the newest is evicted last
    this.map.set(f.key, f);
    if (this.map.size > 8) this.map.delete(this.map.keys().next().value!);
  }
  /** Steps in [from, to) not yet done for this key (all of them if the key is unknown). */
  missing(key: string, n: number, from: number, to: number): number {
    const f = this.map.get(key);
    let m = 0;
    for (let i = Math.max(0, from); i < Math.min(n, to); i++) if (!f || !f.done[i]) m++;
    return m;
  }
  note(hit: boolean) { if (hit) this.hits++; else this.misses++; }
  clear() { this.map.clear(); this.hits = 0; this.misses = 0; }
}

/** Direct component after shading, plus sky and ground diffuse, which keep their value (a documented assumption of this model). */
export const shadedPoa = (direct: number, sky: number, ground: number, access: number) => direct * access + sky + ground;
