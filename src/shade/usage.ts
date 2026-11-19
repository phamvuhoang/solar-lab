import type { Project } from '../domain/types';
import type { Issue } from '../domain/validate';
import type { WeatherSeries } from '../weather/series';
import { buildShadeSpec, ShadeCache, shadeSettingsOf, type ShadeField, type ShadeSpec } from './sampler';

/** Main-thread cache shared by every screen: the shade screen fills it, PV and system runs read it. */
export const shadeCache = new ShadeCache();

export interface ShadeUse { spec: ShadeSpec | null; field: ShadeField | null; issues: Issue[]; unplaced: number }

/**
 * The shade field a PV or system run must use. Shading off → none. Shading on but not fully computed → the run is refused (never silently unshaded).
 * Panels without a placement have no geometry and stay unshaded; `unplaced` says how many, so the report can declare it.
 */
export async function shadeFor(p: Project, weather: WeatherSeries): Promise<ShadeUse> {
  const st = shadeSettingsOf(p);
  if (!st.enabled) return { spec: null, field: null, issues: [], unplaced: 0 };
  const spec = await buildShadeSpec(p, weather, st);
  const err = (code: string, message: string): Issue => ({ code, severity: 'error', field: '/shade', message });
  if (!spec.panels.length) return { spec, field: null, unplaced: spec.unplaced.length, issues: [err('SHADE_NO_PANELS', 'Đã bật bóng che nhưng chưa có tấm nào được đặt lên mái: đặt tấm ở màn Mái 3D hoặc tắt bóng che')] };
  const f = shadeCache.get(spec.key);
  const missing = shadeCache.missing(spec.key, spec.n, 0, spec.n);
  if (!f || missing) return { spec, field: null, unplaced: spec.unplaced.length, issues: [err('SHADE_NOT_COMPUTED', `Đã bật bóng che nhưng dữ liệu bóng chưa tính đủ (${spec.n - missing}/${spec.n} bước) cho thiết kế và dữ liệu thời tiết này: vào màn Bóng che → "Tính cả năm", hoặc tắt bóng che`)] };
  return { spec, field: f, issues: [], unplaced: spec.unplaced.length };
}
