import { hashOf } from '../domain/hash';
import { newId, newRunId, nowIso } from '../domain/ids';
import type { Project } from '../domain/types';
import { refKey } from '../domain/types';
import { hasErrors, validateProject, type Issue } from '../domain/validate';
import type { PvResult } from '../engine/pv';
import type { SimResult } from '../engine/system';
import type { WeatherSeries } from '../weather/series';

export const PACKAGE_FORMAT = 'mekoniq-solar-lab/package';
export const PACKAGE_VERSION = 1;
/** A year of hourly weather plus recorded series is a few MB; anything near this is not a package from this app. */
export const MAX_PACKAGE_BYTES = 40_000_000;

export type PackageKind = 'full' | 'report';
export type Metrics = Record<string, number | null>;

/** One run as it was recorded. `inputHash` + `metrics` are what a re-run on another machine must reproduce. */
export interface RecordedRun {
  runId: string; label: string; title: string; kind: 'pv' | 'sim';
  /** 'current' = the project in the package; 'variant' = `variants[label]` (the A side of an A/B). */
  source: 'current' | 'variant';
  engines: { pv: string; dispatch: string | null; shade: string | null };
  inputHash: string; weatherHash: string; recordedAt: string;
  metrics: Metrics; assumptions: string[];
  period: { t0: number; stepSeconds: number; n: number };
  /** Selected per-step series (rounded). Only in full packages that asked for them. */
  series?: Record<string, number[]>;
}

export interface WeatherRef { id: string; name: string; contentHash: string; n: number; stepSeconds: number; source: WeatherSeries['source']; bundled: boolean }
export interface PackageDoc {
  format: typeof PACKAGE_FORMAT; formatVersion: number; kind: PackageKind; exportedAt: string;
  app: { buildId: string; engines: { pv: string; dispatch: string; shade: string } };
  /** What this file carries, spelled out so the reader does not have to guess. */
  attached: { project: true; weatherData: boolean; recordedMetrics: boolean; recordedSeries: boolean; variants: boolean; contact: boolean };
  project: Project; projectHash: string;
  /** Catalog and offer versions the design was priced and checked against (the snapshots inside `project` are the data). */
  manifest: { components: { key: string; sku: string | null; review: string }[]; offers: { offerId: string; recordedAt: string | null; validUntil: string | null; priceKnown: boolean }[]; geometryHash: string };
  weather: { ref: WeatherRef | null; data?: WeatherSeries };
  variants?: Record<string, Project>;
  runs: RecordedRun[];
}

// ---- contact removal ------------------------------------------------------------------------------------------------
const PHONE = /(?<![\w.])(?:\+?84|0)[\s.-]?\d{2,3}[\s.-]?\d{3}[\s.-]?\d{3,4}(?![\w])/g;
const EMAIL = /[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+/g;
const MASK = '[đã ẩn]';
export const redact = (s: string) => s.replace(EMAIL, MASK).replace(PHONE, MASK);

/** Drops `owner` and masks phone numbers and e-mail addresses typed into free-text fields. Nothing a calculation reads is touched. */
export function stripContact(p: Project): Project {
  const q = structuredClone(p);
  delete q.owner;
  const r = (o: Record<string, unknown> | undefined, ...keys: string[]) => { if (o) for (const k of keys) if (typeof o[k] === 'string') o[k] = redact(o[k] as string); };
  r(q as unknown as Record<string, unknown>, 'name');
  for (const l of q.costLines ?? []) r(l as unknown as Record<string, unknown>, 'note', 'seller', 'label');
  for (const k of q.kits ?? []) r(k as unknown as Record<string, unknown>, 'note', 'seller', 'label');
  for (const o of q.snapshots.offers) r(o as unknown as Record<string, unknown>, 'notes', 'seller', 'label');
  for (const c of q.snapshots.components) r(c as unknown as Record<string, unknown>, 'notes');
  return q;
}

// ---- recording a run -------------------------------------------------------------------------------------------------
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const flat = (prefix: string, o: object, out: Metrics) => { for (const [k, v] of Object.entries(o)) { const n = num(v); if (n !== null || v === null) out[`${prefix}.${k}`] = n; } };
const round = (a: ArrayLike<number>, d: number) => Array.from(a, (x) => Number(x.toFixed(d)));

export function pvMetrics(r: PvResult): Metrics { const m: Metrics = {}; flat('pv', r.totals, m); return m; }
export function simMetrics(r: SimResult): Metrics {
  const m: Metrics = {}, d = r.dispatch;
  flat('pv', r.pv.totals, m); flat('dispatch', d.totals, m);
  flat('metrics', { ...d.metrics, lowestSunMonth: null, servedRatioNote: null }, m);
  m['metrics.lowestSunMonthKWh'] = d.metrics.lowestSunMonth?.pvKWh ?? null;
  m['ledger.maxResidualWh'] = d.ledger.maxResidualWh;
  return m;
}

export function recordPv(r: PvResult, o: { label: string; title: string; source: RecordedRun['source']; weatherHash: string; series: boolean; at?: string }): RecordedRun {
  return {
    runId: newRunId(), label: o.label, title: o.title, kind: 'pv', source: o.source, engines: { pv: r.engineVersion, dispatch: null, shade: r.shade?.modelVersion ?? null },
    inputHash: r.inputHash, weatherHash: o.weatherHash, recordedAt: o.at ?? nowIso(), metrics: pvMetrics(r), assumptions: [...r.assumptions],
    period: { t0: r.series.t[0], stepSeconds: r.period.stepSeconds, n: r.period.n },
    ...(o.series ? { series: { pInverterW: round(r.series.pInverterW, 3), poaWm2: round(r.series.poaWm2, 2) } } : {}),
  };
}
export function recordSim(r: SimResult, o: { label: string; title: string; source: RecordedRun['source']; weatherHash: string; series: boolean; at?: string }): RecordedRun {
  const s = r.dispatch.series;
  return {
    runId: newRunId(), label: o.label, title: o.title, kind: 'sim', source: o.source, engines: { pv: r.pv.engineVersion, dispatch: r.dispatch.version, shade: r.pv.shade?.modelVersion ?? null },
    inputHash: r.inputHash, weatherHash: o.weatherHash, recordedAt: o.at ?? nowIso(), metrics: simMetrics(r), assumptions: [...r.pv.assumptions, ...r.dispatch.assumptions],
    period: { t0: r.pv.series.t[0], stepSeconds: r.pv.period.stepSeconds, n: r.pv.period.n },
    ...(o.series ? { series: { socEnd: round(s.socEnd, 5), pvBusWh: round(s.pvBusWh, 3), loadServedWh: round(s.loadServedWh, 3), unservedWh: round(s.unservedWh, 3), gridImportWh: round(s.gridImportWh, 3) } } : {}),
  };
}

// ---- building ------------------------------------------------------------------------------------------------------
export const geometryHash = (p: Project) => hashOf({ roofFaces: p.roofFaces, placements: p.placements ?? [], obstacles: p.obstacles ?? [], layout: p.layout ?? null });

export interface BuildOptions {
  kind: PackageKind; project: Project; runs: RecordedRun[]; weather?: WeatherSeries; weatherBundled?: boolean;
  /** A-side project of an A/B, so a full package can re-run both. */
  variants?: Record<string, Project>; includeContact: boolean; includeSeries: boolean;
  app: { buildId: string; engines: { pv: string; dispatch: string; shade: string } }; exportedAt?: string;
}

export async function buildPackage(o: BuildOptions): Promise<string> {
  const full = o.kind === 'full';
  const clean = (p: Project) => (o.includeContact ? p : stripContact(p));
  const project = clean(o.project);
  const variants = full && o.variants ? Object.fromEntries(Object.entries(o.variants).map(([k, v]) => [k, clean(v)])) : undefined;
  const runs = o.runs.map((r: RecordedRun) => { const { series, ...rest } = r; return full && o.includeSeries && series ? { ...rest, series } : rest; });
  const wref: WeatherRef | null = o.weather ? { id: o.weather.seriesId, name: o.weather.name, contentHash: await hashOf(o.weather), n: o.weather.n, stepSeconds: o.weather.stepSeconds, source: o.weather.source, bundled: !!o.weatherBundled } : null;
  const doc: PackageDoc = {
    format: PACKAGE_FORMAT, formatVersion: PACKAGE_VERSION, kind: o.kind, exportedAt: o.exportedAt ?? nowIso(), app: o.app,
    attached: { project: true, weatherData: full && !!o.weather, recordedMetrics: runs.length > 0, recordedSeries: full && o.includeSeries && runs.some((r) => 'series' in r), variants: !!variants && Object.keys(variants).length > 0, contact: o.includeContact && !!o.project.owner },
    project, projectHash: await hashOf(project),
    manifest: {
      components: project.snapshots.components.map((c) => ({ key: refKey(c), sku: c.sku, review: c.review })),
      offers: project.snapshots.offers.map((x) => ({ offerId: x.offerId, recordedAt: x.recordedAt, validUntil: x.validUntil, priceKnown: x.priceMinor !== null || x.tiers.length > 0 })),
      geometryHash: await geometryHash(project),
    },
    weather: { ref: wref, ...(full && o.weather ? { data: o.weather } : {}) },
    ...(variants && Object.keys(variants).length ? { variants } : {}),
    runs,
  };
  return JSON.stringify(doc);
}

// ---- reading -------------------------------------------------------------------------------------------------------
export type StagedPackage =
  | { ok: true; doc: PackageDoc; project: Project; weather: WeatherSeries | null; issues: Issue[]; renamed: boolean }
  | { ok: false; issues: Issue[] };

const err = (code: string, field: string, message: string): Issue => ({ code, severity: 'error', field, message });
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const prefixed = (prefix: string, issues: Issue[]) => issues.map((i) => ({ ...i, field: prefix + i.field }));

function checkWeather(w: unknown, base: string): Issue[] {
  if (!isObj(w)) return [err('WEATHER_SHAPE', base, 'Dữ liệu thời tiết phải là một đối tượng')];
  const out: Issue[] = [];
  for (const k of ['t0', 'stepSeconds', 'n'] as const) if (!Number.isInteger(w[k]) || (w[k] as number) <= 0 && k !== 't0') out.push(err('WEATHER_FIELD', `${base}/${k}`, `${k} phải là số nguyên${k === 't0' ? '' : ' dương'}`));
  if (out.length) return out;
  for (const k of ['ghi', 'dni', 'dhi', 'poa', 'tempAirC', 'windMs'] as const) {
    const a = w[k];
    if (a === null) continue;
    if (!Array.isArray(a) || a.length !== w.n) { out.push(err('WEATHER_LENGTH', `${base}/${k}`, `Cột ${k} phải có đúng ${w.n} giá trị (đang có ${Array.isArray(a) ? a.length : 'không phải mảng'})`)); continue; }
    const at = a.findIndex((v) => typeof v !== 'number' || !Number.isFinite(v));
    if (at >= 0) out.push(err('WEATHER_VALUE', `${base}/${k}/${at}`, `Giá trị thứ ${at} của ${k} không phải số hữu hạn`));
  }
  if (typeof w.seriesId !== 'string' || !isObj(w.location) || !isObj(w.source)) out.push(err('WEATHER_SHAPE', base, 'Thiếu seriesId, location hoặc source'));
  return out;
}
function checkRuns(runs: unknown): Issue[] {
  if (!Array.isArray(runs)) return [err('RUNS_SHAPE', '/runs', 'runs phải là mảng')];
  const out: Issue[] = [];
  runs.forEach((r, i) => {
    if (!isObj(r)) return void out.push(err('RUN_SHAPE', `/runs/${i}`, 'Mỗi lần chạy phải là một đối tượng'));
    if (r.kind !== 'pv' && r.kind !== 'sim') out.push(err('RUN_KIND', `/runs/${i}/kind`, 'kind phải là "pv" hoặc "sim"'));
    if (typeof r.inputHash !== 'string' || !/^[0-9a-f]{64}$/.test(r.inputHash)) out.push(err('RUN_HASH', `/runs/${i}/inputHash`, 'inputHash phải là SHA-256 dạng hex 64 ký tự'));
    if (!isObj(r.metrics)) out.push(err('RUN_METRICS', `/runs/${i}/metrics`, 'Thiếu metrics'));
    else for (const [k, v] of Object.entries(r.metrics)) if (v !== null && (typeof v !== 'number' || !Number.isFinite(v))) out.push(err('RUN_METRIC_VALUE', `/runs/${i}/metrics/${k}`, `Chỉ số ${k} phải là số hoặc null`));
    if (!isObj(r.engines) || typeof r.engines.pv !== 'string') out.push(err('RUN_ENGINES', `/runs/${i}/engines`, 'Thiếu phiên bản engine'));
    if (r.series !== undefined) {
      const n = isObj(r.period) ? r.period.n : NaN;
      if (!isObj(r.series)) out.push(err('RUN_SERIES', `/runs/${i}/series`, 'series phải là đối tượng'));
      else for (const [k, a] of Object.entries(r.series)) if (!Array.isArray(a) || a.length !== n) out.push(err('RUN_SERIES_LENGTH', `/runs/${i}/series/${k}`, `Chuỗi ${k} phải có ${n} giá trị`));
    }
  });
  return out;
}

/**
 * Parse and validate in memory only; nothing is written. Every error carries the JSON path of the offending field.
 * A project ID that already exists is imported as a new copy (the existing draft is never overwritten).
 */
export async function stagePackage(text: string, existingIds: ReadonlySet<string>): Promise<StagedPackage> {
  if (new TextEncoder().encode(text).length > MAX_PACKAGE_BYTES) return { ok: false, issues: [err('TOO_LARGE', '/', `File lớn hơn ${MAX_PACKAGE_BYTES / 1e6} MB`)] };
  let doc: Record<string, unknown>;
  try { doc = JSON.parse(text); } catch (e) { return { ok: false, issues: [err('INVALID_JSON', '/', `Không đọc được JSON: ${(e as Error).message}`)] }; }
  if (!isObj(doc) || doc.format !== PACKAGE_FORMAT) return { ok: false, issues: [err('WRONG_FORMAT', '/format', `Cần format "${PACKAGE_FORMAT}"`)] };
  if (typeof doc.formatVersion !== 'number' || !Number.isInteger(doc.formatVersion) || doc.formatVersion < 1) return { ok: false, issues: [err('BAD_VERSION', '/formatVersion', 'formatVersion phải là số nguyên từ 1')] };
  if (doc.formatVersion > PACKAGE_VERSION) return { ok: false, issues: [err('NEWER_FORMAT', '/formatVersion', `Gói này ghi bằng định dạng phiên bản ${doc.formatVersion}, bản app này chỉ đọc đến ${PACKAGE_VERSION}. Cập nhật app rồi nhập lại.`)] };
  if (doc.kind !== 'full' && doc.kind !== 'report') return { ok: false, issues: [err('BAD_KIND', '/kind', 'kind phải là "full" hoặc "report"')] };

  const issues: Issue[] = [];
  const pi = validateProject(doc.project);
  issues.push(...prefixed('/project', pi));
  const variants = isObj(doc.variants) ? doc.variants : {};
  for (const [k, v] of Object.entries(variants)) issues.push(...prefixed(`/variants/${k}`, validateProject(v)));
  const w = isObj(doc.weather) ? doc.weather : {};
  if (w.data !== undefined) issues.push(...checkWeather(w.data, '/weather/data'));
  issues.push(...checkRuns(doc.runs));
  if (hasErrors(issues)) return { ok: false, issues };

  const weather = (w.data as WeatherSeries | undefined) ?? null;
  const ref = isObj(w.ref) ? (w.ref as unknown as WeatherRef) : null;
  if (weather && ref && (await hashOf(weather)) !== ref.contentHash) return { ok: false, issues: [err('WEATHER_HASH_MISMATCH', '/weather/data', 'Dữ liệu thời tiết không khớp mã băm ghi trong gói (file hỏng hoặc bị sửa)')] };
  let project = doc.project as Project;
  if (doc.projectHash !== (await hashOf(project))) issues.push({ code: 'HASH_MISMATCH', severity: 'warning', field: '/projectHash', message: 'Nội dung dự án khác mã băm ghi trong gói (file đã bị sửa tay?)' });
  if (doc.kind === 'report' || !weather) {
    if (ref && !ref.bundled) issues.push({ code: 'WEATHER_NOT_ATTACHED', severity: 'warning', field: '/weather', message: `Gói không đính kèm dữ liệu thời tiết "${ref.name}". Editor, BOM và dự toán dùng được; muốn chạy lại cần nạp lại đúng file thời tiết đó (mã băm ${ref.contentHash.slice(0, 12)}).` });
  }
  let renamed = false;
  if (existingIds.has(project.projectId)) {
    const now = nowIso();
    project = { ...project, projectId: newId('prj'), name: `${project.name} (bản nhập)`, createdAt: now, updatedAt: now };
    renamed = true;
  }
  return { ok: true, doc: doc as unknown as PackageDoc, project, weather, issues, renamed };
}

/** Cheap peek (the format key is written first); anything else falls through to the project importer, which reports WRONG_FORMAT. */
export const isPackage = (text: string) => text.slice(0, 500).includes(PACKAGE_FORMAT);
