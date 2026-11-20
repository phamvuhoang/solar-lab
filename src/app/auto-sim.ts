import type { Project } from '../domain/types';
import { compileSim } from '../engine/sim-compile';
import type { SimResult } from '../engine/system';
import type { Runner } from '../reports/replay';
import { buildShadeSpec, shadeSettingsOf, type ShadeField } from '../shade/sampler';
import { shadeCache } from '../shade/usage';
import type { Target } from '../ui/route';
import type { WeatherSeries } from '../weather/series';
import type { Lru } from './autorun';

/** What the automatic run knows about the current design: nothing yet, a run under way, why it cannot run, or its result. */
export type AutoState =
  | { kind: 'idle' } | { kind: 'running' }
  | { kind: 'blocked'; message: string; target: Target }
  | { kind: 'done'; hash: string; result: SimResult; shadePreview: boolean };

const SYSTEM: Target = { step: 'chay-thu', tab: 'he-thong' };
const IDLE: AutoState = { kind: 'idle' };
const blocked = (message: string, target: Target = SYSTEM): AutoState => ({ kind: 'blocked', message, target });

/** The field of the system screen (sim.ts) an issue's path points at: a load's hours, or the dispatch policy. */
const POLICY_FIELD: Record<string, string> = { '/sim/minSoc': 's-min', '/sim/soc0': 's-soc0', '/sim/inverterEfficiency': 's-ei' };
/** Where a compile issue is fixed: orientation on the PV screen, strings in the design, everything else on the system screen. */
function targetOf({ code, field }: { code: string; field: string }): Target {
  if (code === 'ORIENTATION_MISSING') return { step: 'chay-thu', tab: 'pv', focusId: 'pv-tilt' };
  if (code === 'NO_STRINGS' || code === 'INVERTER_COUNT' || code.startsWith('STRING_')) return { step: 'dau-noi', tab: 'thiet-ke' };
  const focusId = field.startsWith('/loadPlans/') ? `lp-hours-${field.slice('/loadPlans/'.length)}` : POLICY_FIELD[field];
  return focusId ? { ...SYSTEM, focusId } : SYSTEM;
}

/**
 * Shade (with the project's own settings) + PV + dispatch for the design as it is, the same inputs a manual "Chạy" uses.
 * Results are kept by input hash; a cancelled run returns idle and keeps nothing.
 */
export async function runAuto(p: Project, deps: { loadWeather(id: string): Promise<WeatherSeries | undefined>; runner: Runner; cache: Lru<SimResult>; signal: AbortSignal }): Promise<AutoState> {
  const { signal, runner } = deps;
  const weather = p.pv?.weatherId ? await deps.loadWeather(p.pv.weatherId) : undefined;
  if (signal.aborted) return IDLE;
  if (!weather) return blocked('chưa đủ dữ liệu: thiếu thời tiết', { step: 'chay-thu', tab: 'pv', focusId: 'wx-select' });
  const st = shadeSettingsOf(p);
  let field: ShadeField | null = null;
  if (st.enabled) {
    const spec = await buildShadeSpec(p, weather, st);
    if (!spec.panels.length) return blocked('Đã bật bóng che nhưng chưa có tấm nào được đặt lên mái: đặt tấm ở màn Mái 3D hoặc tắt bóng che', { step: 'bo-tri', tab: 'mai' });
    field = shadeCache.missing(spec.key, spec.n, 0, spec.n) ? ((await runner.shade?.(spec)) ?? null) : shadeCache.get(spec.key);
    if (signal.aborted) return IDLE;
    if (!field) return blocked('Không tính được bóng che', { step: 'bo-tri', tab: 'bong' });
    shadeCache.put(field); // the manual runs on the PV and system screens read it from here
  }
  const c = await compileSim(p, weather, { shade: field });
  if (signal.aborted) return IDLE;
  if (!c.input || !c.hash) return blocked(c.issues[0].message, targetOf(c.issues[0]));
  const shadePreview = st.enabled && st.mode === 'preview';
  const hit = deps.cache.get(c.hash);
  if (hit) return { kind: 'done', hash: c.hash, result: hit, shadePreview };
  const r = await runner.sim(c.input, c.hash);
  if (signal.aborted) return IDLE;
  if (!r) return blocked('Không tính được: lần chạy trong worker không trả kết quả');
  deps.cache.set(c.hash, r);
  return { kind: 'done', hash: c.hash, result: r, shadePreview };
}
