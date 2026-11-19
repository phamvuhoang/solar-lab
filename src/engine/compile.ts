import { indexProject, isStringTarget, portKey, stringsOf } from '../domain/graph';
import { hashOf } from '../domain/hash';
import type { Component, Project, PvSettings } from '../domain/types';
import type { Issue } from '../domain/validate';
import type { WeatherSeries } from '../weather/series';
import { ENGINE_VERSION, type PvInput, type PvInverter, type PvModel, type PvPanel, type PvString, type PvTracker } from './pv';

export const PV_DEFAULTS = { albedo: 0.2, lossRatio: 0, cellModel: 'faiman', faimanU0: 25, faimanU1: 6.84, fixedCellTempC: null, windFallbackMs: null, irradianceInput: 'auto', weatherId: null } as const;
const err = (code: string, field: string, message: string): Issue => ({ code, severity: 'error', field, message });

export const pvSettingsOf = (p: Project): Partial<PvSettings> => ({ ...PV_DEFAULTS, ...p.pv });
export const weatherHash = (w: WeatherSeries) => hashOf(w);

/** Project strings + weather → pure engine input. Missing data is refused here by field, not guessed. */
export function compilePv(p: Project, weather: WeatherSeries, opts: { applyLimits?: boolean } = {}): { input: PvInput | null; issues: Issue[] } {
  const issues: Issue[] = [];
  const st = pvSettingsOf(p);
  if (st.tiltDeg === undefined) issues.push(err('ORIENTATION_MISSING', '/pv/tiltDeg', 'Chưa khai độ nghiêng của tấm'));
  if (st.azimuthDeg === undefined) issues.push(err('ORIENTATION_MISSING', '/pv/azimuthDeg', 'Chưa khai azimuth của tấm (Bắc = 0°, theo chiều kim đồng hồ)'));
  const ix = indexProject(p);

  const strings: PvString[] = [];
  const trackers = new Map<string, PvTracker>();
  const inverters = new Map<string, PvInverter>();
  const owners = new Map<string, number>();
  for (const s of stringsOf(p)) for (const id of s.panelIds) owners.set(id, (owners.get(id) ?? 0) + 1);
  for (const [id, n] of owners) if (n > 1) issues.push(err('PANEL_DUPLICATE', `/strings`, `Tấm ${id} nằm trong ${n} chuỗi: sản lượng sẽ bị đếm lặp`));

  for (const s of stringsOf(p)) {
    if (!s.target || !s.panelIds.length) continue; // W03 already reports unconnected / empty strings
    const target = ix.inst.get(s.target.instanceId), port = ix.port(s.target);
    if (!target || !port || !isStringTarget(port.type)) { issues.push(err('STRING_TARGET_INVALID', `/strings/${s.stringId}`, `${s.label} nối vào cổng không hợp lệ`)); continue; }
    const panels: PvPanel[] = [];
    for (const id of s.panelIds) {
      const c: Component | undefined = ix.inst.get(id)?.comp;
      const pstc = c?.specs.pstcW?.v ?? null, gamma = c?.specs.betaPmax?.v ?? null;
      if (!c || pstc === null || gamma === null) {
        issues.push(err('PANEL_SPEC_MISSING', `/strings/${s.stringId}`, `${s.label}: ${c?.name ?? id} thiếu ${[pstc === null && 'Pmax (pstcW)', gamma === null && 'hệ số nhiệt Pmax (betaPmax)'].filter(Boolean).join(' và ')}`));
        continue;
      }
      panels.push({ pstcW: pstc, gamma, vmpV: c.specs.vmpV?.v ?? null });
    }
    if (panels.length !== s.panelIds.length) continue;
    const key = portKey(s.target);
    if (!trackers.has(key)) {
      const c = target.comp, v = (k: string) => c?.specs[k]?.v ?? null;
      if (target.inst.kind === 'inverter') {
        const total = v('pvMaxPowerW'), count = v('mpptCount');
        trackers.set(key, { id: key, label: `${target.inst.label.replace(/ #\d+$/, '')} · ${port.label}`, inverterId: target.inst.instanceId,
          maxPowerW: total !== null && count ? total / count : null, maxCurrentA: v('pvImaxPerMpptA') });
        if (!inverters.has(target.inst.instanceId)) inverters.set(target.inst.instanceId, { id: target.inst.instanceId, label: target.inst.label.replace(/ #\d+$/, ''), maxPvPowerW: total });
      } else {
        trackers.set(key, { id: key, label: `${target.inst.label.replace(/ #\d+$/, '')} · ${port.label}`, inverterId: null, maxPowerW: v('ratedW'), maxCurrentA: null });
      }
    }
    strings.push({ id: s.stringId, label: s.label, panels, trackerId: key });
  }
  if (!strings.length && !issues.length) issues.push(err('NO_STRINGS', '/strings', 'Chưa có chuỗi nào nối vào MPPT hoặc controller: vào Thiết kế để tạo chuỗi'));
  if (issues.length) return { input: null, issues };

  const model: PvModel = {
    irradianceInput: st.irradianceInput!, tiltDeg: st.tiltDeg!, azimuthDeg: st.azimuthDeg!, albedo: st.albedo!, cellModel: st.cellModel!, faimanU0: st.faimanU0!, faimanU1: st.faimanU1!,
    fixedCellTempC: st.fixedCellTempC ?? null, windFallbackMs: st.windFallbackMs ?? null, lossRatio: st.lossRatio!, applyLimits: opts.applyLimits ?? true,
  };
  return { input: { weather, weatherHash: '', model, strings, trackers: [...trackers.values()], inverters: [...inverters.values()] }, issues };
}

/** Identity of one run: engine version + everything that changes the numbers. Camera, prices and run time are not in it. */
export async function hashPvInput(input: PvInput): Promise<string> {
  const wh = input.weatherHash || (await weatherHash(input.weather));
  return hashOf({ engine: ENGINE_VERSION, weather: wh, model: input.model, strings: input.strings, trackers: input.trackers, inverters: input.inverters });
}
