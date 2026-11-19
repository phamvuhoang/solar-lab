import { hashOf } from '../domain/hash';
import type { Project } from '../domain/types';
import { compilePv, hashPvInput } from '../engine/compile';
import { DISPATCH_VERSION } from '../engine/dispatch';
import { ENGINE_VERSION, type PvInput, type PvResult } from '../engine/pv';
import { asRunFor, compileSim } from '../engine/sim-compile';
import type { SimInput, SimResult } from '../engine/system';
import { buildShadeSpec, SHADE_DEFAULTS, shadeSettingsOf, type ShadeField, type ShadeSpec } from '../shade/sampler';
import { SHADE_MODEL_VERSION } from '../shade/geometry';
import type { WeatherSeries } from '../weather/series';
import { pvMetrics, simMetrics, type Metrics, type RecordedRun } from './package';

/** Where runs execute: browser workers in the app, direct calls in tests. */
export interface Runner {
  pv(input: PvInput, hash: string): Promise<PvResult | null>;
  sim(input: SimInput, hash: string): Promise<SimResult | null>;
  shade?(spec: ShadeSpec): Promise<ShadeField | null>;
}

/**
 * reproduced      same engine versions: hash and every metric came out the same.
 * engine-changed  the engine is not the one that wrote the file; numbers are a NEW run, the recorded ones stay as recorded.
 * mismatch        same engine versions but different hash or metrics: something in the inputs differs (file edited, weather replaced).
 * cannot          the run could not be repeated (no weather, no shade support, inputs refused).
 */
export type ReplayStatus = 'reproduced' | 'engine-changed' | 'mismatch' | 'cannot';
export interface ReplayOutcome {
  runId: string; status: ReplayStatus; reason: string; hashNow: string | null; metricsNow: Metrics | null;
  maxRelDiff: number | null; diffs: { key: string; recorded: number | null; now: number | null }[];
}

export const CURRENT_ENGINES = { pv: ENGINE_VERSION, dispatch: DISPATCH_VERSION, shade: SHADE_MODEL_VERSION };
/** Relative tolerance for "same number": one part in 10⁹ (float summation order is fixed, so same-engine runs agree far better). */
export const METRIC_TOL = 1e-9;

export function compareMetrics(a: Metrics, b: Metrics): { maxRelDiff: number; diffs: ReplayOutcome['diffs'] } {
  let max = 0;
  const diffs: ReplayOutcome['diffs'] = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[k] ?? null, y = b[k] ?? null;
    const d = x === null || y === null ? (x === y ? 0 : Infinity) : Math.abs(x - y) / Math.max(1, Math.abs(x), Math.abs(y));
    if (d > METRIC_TOL) diffs.push({ key: k, recorded: x, now: y });
    max = Math.max(max, d);
  }
  return { maxRelDiff: max, diffs };
}

const cannot = (run: RecordedRun, reason: string): ReplayOutcome => ({ runId: run.runId, status: 'cannot', reason, hashNow: null, metricsNow: null, maxRelDiff: null, diffs: [] });

export async function replayRun(run: RecordedRun, ctx: { project: Project; variants?: Record<string, Project>; weather: WeatherSeries | undefined }, runner: Runner): Promise<ReplayOutcome> {
  const base = run.source === 'current' ? ctx.project : ctx.variants?.[run.label];
  if (!base) return cannot(run, `Gói không đính kèm thiết kế ${run.label} nên không chạy lại được (chỉ còn kết quả đã ghi).`);
  if (!ctx.weather) return cannot(run, 'Thiếu dữ liệu thời tiết; nạp lại đúng file thời tiết đã dùng rồi chạy lại.');
  const wh = await hashOf(ctx.weather);
  if (wh !== run.weatherHash) return cannot(run, 'Dữ liệu thời tiết hiện có khác bản đã dùng lúc ghi (mã băm khác); không so được.');
  const p = run.kind === 'sim' ? asRunFor(base, ctx.project) : base;
  let field: ShadeField | null = null;
  const st = shadeSettingsOf(p);
  if (st.enabled) {
    if (!runner.shade) return cannot(run, 'Thiết kế bật bóng che nhưng nơi chạy này không tính được bóng.');
    const spec = await buildShadeSpec(p, ctx.weather, { ...SHADE_DEFAULTS, ...st });
    field = await runner.shade(spec);
    if (!field) return cannot(run, 'Tính bóng bị hủy hoặc lỗi.');
  }
  let hash: string, metrics: Metrics;
  if (run.kind === 'pv') {
    const c = compilePv(p, ctx.weather, { shade: field });
    if (!c.input) return cannot(run, `Biên dịch thất bại: ${c.issues.map((i) => `${i.code} tại ${i.field}`).join('; ')}`);
    hash = await hashPvInput(c.input);
    const r = await runner.pv(c.input, hash);
    if (!r) return cannot(run, 'Chạy bị hủy.');
    if (r.issues.length) return cannot(run, r.issues.map((i) => i.message).join('; '));
    metrics = pvMetrics(r);
  } else {
    const c = await compileSim(p, ctx.weather, { shade: field });
    if (!c.input || !c.hash) return cannot(run, `Biên dịch thất bại: ${c.issues.map((i) => `${i.code} tại ${i.field}`).join('; ')}`);
    hash = c.hash;
    const r = await runner.sim(c.input, hash);
    if (!r) return cannot(run, 'Chạy bị hủy.');
    metrics = simMetrics(r);
  }
  const sameEngine = run.engines.pv === CURRENT_ENGINES.pv && (run.engines.dispatch ?? null) === (run.kind === 'sim' ? CURRENT_ENGINES.dispatch : null) && (run.engines.shade ?? null) === (st.enabled ? CURRENT_ENGINES.shade : null);
  const { maxRelDiff, diffs } = compareMetrics(run.metrics, metrics);
  const base_ = { runId: run.runId, hashNow: hash, metricsNow: metrics, maxRelDiff, diffs };
  if (!sameEngine) return { ...base_, status: 'engine-changed', reason: `Gói ghi bằng engine ${run.engines.pv}${run.engines.dispatch ? ` + ${run.engines.dispatch}` : ''}; app này là ${CURRENT_ENGINES.pv}${run.kind === 'sim' ? ` + ${CURRENT_ENGINES.dispatch}` : ''}. Kết quả bên dưới là lần chạy MỚI, không phải bản đã ghi.` };
  if (hash === run.inputHash && !diffs.length) return { ...base_, status: 'reproduced', reason: 'Cùng engine, cùng mã đầu vào, mọi chỉ số trùng.' };
  return { ...base_, status: 'mismatch', reason: hash !== run.inputHash ? 'Cùng engine nhưng mã đầu vào khác: thiết kế, thời tiết hoặc chính sách trong gói không còn là bản đã chạy.' : `Cùng mã đầu vào nhưng ${diffs.length} chỉ số lệch.` };
}
