import { indexProject, isStringTarget, portKey, stringsOf } from '../domain/graph';
import { hashOf } from '../domain/hash';
import type { Component, Project, PvSettings } from '../domain/types';
import type { Issue } from '../domain/validate';
import type { WeatherSeries } from '../weather/series';
import type { ShadeField } from '../shade/sampler';
import { ENGINE_VERSION, type PvInput, type PvInverter, type PvModel, type PvPanel, type PvString, type PvTracker } from './pv';

export const PV_DEFAULTS = { albedo: 0.2, lossRatio: 0, cellModel: 'faiman', faimanU0: 25, faimanU1: 6.84, fixedCellTempC: null, windFallbackMs: null, irradianceInput: 'auto', weatherId: null } as const;
const err = (code: string, field: string, message: string): Issue => ({ code, severity: 'error', field, message });

export const pvSettingsOf = (p: Project): Partial<PvSettings> => ({ ...PV_DEFAULTS, ...p.pv });
export const weatherHash = (w: WeatherSeries) => hashOf(w);

/** Project strings + weather → pure engine input. Missing data is refused here by field, not guessed. */
export function compilePv(p: Project, weather: WeatherSeries, opts: { applyLimits?: boolean; shade?: ShadeField | null; stringMode?: 'sum' | 'weakest' } = {}): { input: PvInput | null; issues: Issue[] } {
  const issues: Issue[] = [];
  const st = pvSettingsOf(p);
  const ix = indexProject(p);
  // A string whose panels are all placed on one roof face takes that face's tilt and azimuth. Otherwise the project's declared orientation is used.
  const placement = new Map((p.placements ?? []).map((x) => [x.instanceId, x.roofFaceId]));
  const faces = new Map(p.roofFaces.map((f) => [f.roofFaceId, f]));
  let usesDefault = false;

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
      const idx = opts.shade ? opts.shade.panelIds.indexOf(id) : -1;
      panels.push({ pstcW: pstc, gamma, vmpV: c.specs.vmpV?.v ?? null, betaVmp: c.specs.betaVmp?.v ?? null, id, ...(idx >= 0 ? { shadeIdx: idx } : {}) });
    }
    if (panels.length !== s.panelIds.length) continue;
    const on = s.panelIds.map((id) => placement.get(id));
    const placed = on.filter((x): x is string => !!x), roofIds = [...new Set(placed)];
    let orient: { tiltDeg: number; azimuthDeg: number } | null = null;
    if (placed.length === 0) usesDefault = true;
    else if (placed.length < s.panelIds.length) { issues.push(err('STRING_PARTLY_PLACED', `/strings/${s.stringId}`, `${s.label}: ${placed.length}/${s.panelIds.length} tấm đã đặt lên mái; đặt hết hoặc bỏ hết vị trí để biết hướng của chuỗi`)); continue; }
    else if (roofIds.length > 1) { issues.push(err('STRING_MIXED_FACES', `/strings/${s.stringId}`, `${s.label}: tấm nằm trên ${roofIds.length} mặt mái khác hướng; một chuỗi chỉ được ở một mặt mái (nối tiếp tấm khác hướng gây mismatch)`)); continue; }
    else { const f = faces.get(roofIds[0]); if (!f) { issues.push(err('STRING_FACE_MISSING', `/strings/${s.stringId}`, `${s.label}: mặt mái ${roofIds[0]} không tồn tại`)); continue; } orient = { tiltDeg: f.tiltDeg, azimuthDeg: f.azimuthDeg }; }
    const key = portKey(s.target);
    if (!trackers.has(key)) {
      const c = target.comp, v = (k: string) => c?.specs[k]?.v ?? null;
      if (target.inst.kind === 'inverter') {
        const total = v('pvMaxPowerW'), count = v('mpptCount');
        trackers.set(key, { id: key, label: `${target.inst.label.replace(/ #\d+$/, '')} · ${port.label}`, inverterId: target.inst.instanceId,
          maxPowerW: total !== null && count ? total / count : null, maxCurrentA: v('pvImaxPerMpptA'), mpptVminV: v('mpptVminV') });
        if (!inverters.has(target.inst.instanceId)) inverters.set(target.inst.instanceId, { id: target.inst.instanceId, label: target.inst.label.replace(/ #\d+$/, ''), maxPvPowerW: total });
      } else {
        trackers.set(key, { id: key, label: `${target.inst.label.replace(/ #\d+$/, '')} · ${port.label}`, inverterId: null, maxPowerW: v('ratedW'), maxCurrentA: null });
      }
    }
    strings.push({ id: s.stringId, label: s.label, panels, trackerId: key, ...(orient ?? {}) });
  }
  if (!strings.length && !issues.length) issues.push(err('NO_STRINGS', '/strings', 'Chưa có chuỗi nào nối vào MPPT hoặc controller: vào Thiết kế để tạo chuỗi'));
  if (usesDefault && st.tiltDeg === undefined) issues.push(err('ORIENTATION_MISSING', '/pv/tiltDeg', 'Chưa khai độ nghiêng của tấm (chuỗi chưa đặt lên mái cần độ nghiêng của dự án)'));
  if (usesDefault && st.azimuthDeg === undefined) issues.push(err('ORIENTATION_MISSING', '/pv/azimuthDeg', 'Chưa khai azimuth của tấm (Bắc = 0°, theo chiều kim đồng hồ)'));
  if (issues.length) return { input: null, issues };

  const model: PvModel = {
    irradianceInput: st.irradianceInput!, tiltDeg: st.tiltDeg ?? strings.find((x) => x.tiltDeg !== undefined)?.tiltDeg ?? 0, azimuthDeg: st.azimuthDeg ?? strings.find((x) => x.azimuthDeg !== undefined)?.azimuthDeg ?? 180, albedo: st.albedo!, cellModel: st.cellModel!, faimanU0: st.faimanU0!, faimanU1: st.faimanU1!,
    fixedCellTempC: st.fixedCellTempC ?? null, windFallbackMs: st.windFallbackMs ?? null, lossRatio: st.lossRatio!, applyLimits: opts.applyLimits ?? true,
    betaVmpAssumption: p.design?.betaVmpAssumption ?? null,
    ...(opts.stringMode ? { stringMode: opts.stringMode } : {}),
  };
  return { input: { weather, weatherHash: '', model, strings, trackers: [...trackers.values()], inverters: [...inverters.values()], shade: opts.shade ?? null }, issues };
}

/** Identity of one run: engine version + everything that changes the numbers. Camera, prices and run time are not in it. */
export async function hashPvInput(input: PvInput): Promise<string> {
  const wh = input.weatherHash || (await weatherHash(input.weather));
  return hashOf({ engine: ENGINE_VERSION, weather: wh, model: input.model, strings: input.strings, trackers: input.trackers, inverters: input.inverters, shade: input.shade?.key ?? null });
}
