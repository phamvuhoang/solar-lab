import { sunPosition, pressureAt } from './solar';
import type { Issue } from '../domain/validate';
import type { ShadeField } from '../shade/sampler';
import type { WeatherSeries } from '../weather/series';

export const ENGINE_VERSION = 'pv-1.3.0';
const D2R = Math.PI / 180;

export interface PvModel {
  irradianceInput: 'auto' | 'components' | 'poa';
  tiltDeg: number; azimuthDeg: number; albedo: number;
  cellModel: 'faiman' | 'fixed'; faimanU0: number; faimanU1: number; fixedCellTempC: number | null; windFallbackMs: number | null;
  /** Lumped soiling + wiring + mismatch + other DC loss, 0..1. Reported as its own stage. */
  lossRatio: number;
  /** false = ignore tracker/inverter limits (reference and STC fixtures). */
  applyLimits: boolean;
  /**
   * With per-panel shading: 'sum' adds panel powers (bypass diodes assumed ideal, an upper bound);
   * 'weakest' makes every panel of a string produce what its weakest panel does (no bypass at all, a lower bound).
   */
  stringMode?: 'sum' | 'weakest';
}
/** id and shadeIdx tie a panel to its row in the shade field; panels without them are never shaded. */
export interface PvPanel { pstcW: number; gamma: number; vmpV: number | null; id?: string; shadeIdx?: number }
/** tiltDeg/azimuthDeg override the model's: a string on a roof face takes that face's orientation. */
export interface PvString { id: string; label: string; panels: PvPanel[]; trackerId: string; tiltDeg?: number; azimuthDeg?: number }
export interface PvTracker {
  id: string; label: string; inverterId: string | null;
  /** null = unknown, so the limit is not applied and the result says so. */
  maxPowerW: number | null; maxCurrentA: number | null;
}
export interface PvInverter { id: string; label: string; maxPvPowerW: number | null }
export interface PvInput {
  weather: WeatherSeries; weatherHash: string; model: PvModel;
  strings: PvString[]; trackers: PvTracker[]; inverters: PvInverter[];
  /** Direct-beam access per panel and step. Optional: no field means no shading. */
  shade?: ShadeField | null;
}
export interface PvSeries {
  t: number[]; poaWm2: number[]; tcellC: number[]; zenithDeg: number[]; azimuthDeg: number[];
  pIdealW: number[]; pLossedW: number[]; pTrackerW: number[]; pInverterW: number[];
}
export interface PvTotals {
  kWp: number; eIdealWh: number; lossWh: number; eLossedWh: number; clippedTrackerWh: number; eTrackerWh: number; clippedInverterWh: number; eInverterWh: number;
  peakW: number; specificYieldKWhPerKWp: number | null;
}
export interface PvShadeReport {
  key: string; modelVersion: string; mode: 'preview' | 'standard'; samplesPerPanel: number; stringMode: 'sum' | 'weakest';
  /** Per panel, at the ideal stage (before DC loss and limits): energy with and without the shadow, and direct-weighted access. */
  panels: { id: string; eIdealWh: number; eIdealNoShadeWh: number; directAccess: number | null }[];
  notes: string[];
}
export interface PvResult {
  engineVersion: string; inputHash: string;
  models: Record<'solarPosition' | 'transposition' | 'cellTemperature' | 'dc' | 'limits' | 'irradianceInput', string>;
  period: { startUtc: string; endUtc: string; stepSeconds: number; n: number };
  series: PvSeries;
  /** One entry per distinct plane orientation in the system; series.poaWm2 is orientations[0]. */
  orientations: { tiltDeg: number; azimuthDeg: number; poaWm2: number[] }[];
  strings: { id: string; label: string; panelCount: number; pstcW: number; orientation: number; trackerId: string; inverterId: string | null; pIdealW: number[]; pLossedW: number[]; pTrackerW: number[] }[];
  /** After tracker and inverter limits: the PV power each inverter's DC bus receives. */
  inverters: { id: string; label: string; pW: number[]; pLossedW: number[] }[];
  /** Trackers with no inverter (pump controllers): power after the tracker limit, and before it (after DC loss). */
  branches: { trackerId: string; label: string; pW: number[]; pLossedW: number[] }[];
  /** Present when shading was applied. */
  shade: PvShadeReport | null;
  totals: PvTotals; assumptions: string[]; limitsApplied: string[]; limitsSkipped: string[]; issues: Issue[];
}

const issue = (code: string, field: string, message: string): Issue => ({ code, severity: 'error', field, message });

/** Complete missing irradiance components: DNI = (GHI − DHI)/cos z etc. Uses the apparent zenith, as documented in the result. */
export function completeIrradiance(ghi: number | null, dni: number | null, dhi: number | null, cosZ: number): { ghi: number; dni: number; dhi: number } | null {
  const z = Math.max(cosZ, 0);
  if (ghi !== null && dni !== null && dhi !== null) return { ghi, dni, dhi };
  if (ghi !== null && dhi !== null) return { ghi, dhi, dni: z > 0.0872 ? Math.max(0, (ghi - dhi) / z) : 0 }; // > 5° elevation, else noise
  if (dni !== null && dhi !== null) return { dni, dhi, ghi: dni * z + dhi };
  if (ghi !== null && dni !== null) return { ghi, dni, dhi: Math.max(0, ghi - dni * z) };
  return null;
}

/** Isotropic sky transposition (Liu–Jordan) from a horizontal-plane components to the tilted plane. */
export function isotropicPoa(dni: number, dhi: number, ghi: number, cosAoi: number, tiltDeg: number, albedo: number) {
  const c = Math.cos(tiltDeg * D2R);
  const direct = dni * Math.max(0, cosAoi), sky = (dhi * (1 + c)) / 2, ground = (ghi * albedo * (1 - c)) / 2;
  return { poa: direct + sky + ground, direct, sky, ground };
}

/** Faiman cell temperature: Tc = Ta + G / (u0 + u1·ws). */
export const faimanTcell = (tAir: number, poa: number, ws: number, u0: number, u1: number) => tAir + poa / (u0 + u1 * ws);

/** Linear temperature model: P = Pstc · G/1000 · [1 + γ (Tc − 25)], never negative. */
export const panelDcW = (p: PvPanel, geff: number, tcell: number) => (geff <= 0 ? 0 : Math.max(0, p.pstcW * (geff / 1000) * (1 + p.gamma * (tcell - 25))));

export interface RunHooks { onProgress?(done: number, total: number): void; isCancelled?(): boolean; yieldEvery?: number }

/** Check model/input combination before any step runs. Weather problems are reported by the weather parser, model problems here. */
export function checkPvInput(input: PvInput): Issue[] {
  const { weather: w, model: m } = input;
  const out: Issue[] = [];
  const comps = (w.ghi !== null && w.dhi !== null) || (w.dni !== null && w.dhi !== null) || (w.ghi !== null && w.dni !== null);
  if (m.irradianceInput === 'poa' && !w.poa) out.push(issue('POA_MISSING', '/weather/poa', 'Chọn nguồn POA nhưng chuỗi thời tiết không có cột poa_wm2'));
  if (m.irradianceInput === 'components' && !comps) out.push(issue('COMPONENTS_MISSING', '/weather', 'Cần GHI+DHI, DNI+DHI hoặc GHI+DNI để chuyển sang mặt phẳng tấm'));
  if (m.irradianceInput === 'auto' && !comps && !w.poa) out.push(issue('IRRADIANCE_MISSING', '/weather', 'Chuỗi thời tiết không có bức xạ dùng được'));
  if (m.cellModel === 'faiman') {
    if (!w.tempAirC) out.push(issue('AIR_TEMP_MISSING', '/weather/temp_air_c', 'Mô hình Faiman cần nhiệt độ không khí; nhập chuỗi có temp_air_c hoặc dùng nhiệt độ cell cố định'));
    if (!w.windMs && m.windFallbackMs === null) out.push(issue('WIND_MISSING', '/weather/wind_ms', 'Chuỗi không có tốc độ gió: khai "gió dự phòng" có tên hoặc dùng nhiệt độ cell cố định'));
  } else if (m.fixedCellTempC === null) out.push(issue('CELL_TEMP_MISSING', '/model/fixedCellTempC', 'Nhiệt độ cell cố định chưa khai'));
  if (!(m.albedo >= 0 && m.albedo <= 1)) out.push(issue('ALBEDO_RANGE', '/model/albedo', 'Albedo phải trong [0, 1]'));
  if (!(m.lossRatio >= 0 && m.lossRatio < 1)) out.push(issue('LOSS_RANGE', '/model/lossRatio', 'Tổn hao phải trong [0, 1)'));
  if (!(m.tiltDeg >= 0 && m.tiltDeg <= 90)) out.push(issue('TILT_RANGE', '/model/tiltDeg', 'Độ nghiêng phải trong [0°, 90°]'));
  if (!(m.azimuthDeg >= 0 && m.azimuthDeg < 360)) out.push(issue('AZIMUTH_RANGE', '/model/azimuthDeg', 'Azimuth phải trong [0°, 360°) tính từ Bắc theo chiều kim đồng hồ'));
  for (const st of input.strings) {
    if (st.tiltDeg !== undefined && !(st.tiltDeg >= 0 && st.tiltDeg <= 90)) out.push(issue('TILT_RANGE', `/strings/${st.id}/tiltDeg`, `${st.label}: độ nghiêng phải trong [0°, 90°]`));
    if (st.azimuthDeg !== undefined && !(st.azimuthDeg >= 0 && st.azimuthDeg < 360)) out.push(issue('AZIMUTH_RANGE', `/strings/${st.id}/azimuthDeg`, `${st.label}: azimuth phải trong [0°, 360°)`));
  }
  if (input.shade) {
    const f = input.shade;
    if (m.irradianceInput === 'poa' || (m.irradianceInput === 'auto' && !comps)) out.push(issue('SHADE_NEEDS_COMPONENTS', '/shade', 'Bóng che chỉ áp được lên thành phần trực xạ: cần GHI/DNI/DHI, không dùng được POA có sẵn'));
    if (f.t0 !== w.t0 || f.stepSeconds !== w.stepSeconds || f.n !== w.n) out.push(issue('SHADE_GRID_MISMATCH', '/shade', 'Lưới thời gian của dữ liệu bóng không khớp chuỗi thời tiết'));
    else { const miss = f.done.reduce((a, d) => a + (d ? 0 : 1), 0); if (miss) out.push(issue('SHADE_INCOMPLETE', '/shade', `Dữ liệu bóng còn thiếu ${miss} bước: tính đủ khoảng thời gian trước khi chạy`)); }
  }
  if (!input.strings.length) out.push(issue('NO_STRINGS', '/strings', 'Chưa có chuỗi nào nối vào MPPT hoặc controller'));
  return out;
}

/**
 * Hourly (or any regular step) PV. Pure and deterministic: same input → same bytes. Runs in Node and in a Web Worker.
 * Each interval uses the interval-mean irradiance with the sun at the interval midpoint. P is the interval-average power in W;
 * energy is Σ P · step / 3600 in Wh. Returns null if cancelled; nothing partial is ever returned.
 */
export async function simulatePv(input: PvInput, inputHash: string, hooks: RunHooks = {}): Promise<PvResult | null> {
  const issues = checkPvInput(input);
  const { weather: w, model: m } = input;
  const n = w.n, dtH = w.stepSeconds / 3600;
  const hasComponents = (w.ghi !== null && w.dhi !== null) || (w.dni !== null && w.dhi !== null) || (w.ghi !== null && w.dni !== null);
  const mode: 'components' | 'poa' = m.irradianceInput === 'auto' ? (hasComponents ? 'components' : 'poa') : m.irradianceInput;
  if (issues.length) return { ...emptyResult(input, inputHash, mode), issues };

  const lat = w.location.latitude, lon = w.location.longitude, pressure = pressureAt(w.location.elevationM ?? 0);
  const assumptions = [`Vị trí mặt trời tính tại điểm giữa mỗi bước; khúc xạ ở 12 °C và ${(pressure / 100).toFixed(0)} hPa (cao độ ${w.location.elevationM ?? 0} m)`];
  // one entry per distinct plane; the first string's plane is orientations[0]
  const shade = input.shade ?? null, stringMode = m.stringMode ?? 'sum';
  const orients: { tiltDeg: number; azimuthDeg: number; poaWm2: number[] }[] = [];
  const orientOf = input.strings.map((st) => {
    const tilt = st.tiltDeg ?? m.tiltDeg, az = st.azimuthDeg ?? m.azimuthDeg;
    let k = orients.findIndex((o) => o.tiltDeg === tilt && o.azimuthDeg === az);
    if (k < 0) { orients.push({ tiltDeg: tilt, azimuthDeg: az, poaWm2: new Array(n).fill(0) }); k = orients.length - 1; }
    return k;
  });
  if (mode === 'components') assumptions.push(`Bầu trời đẳng hướng (isotropic), albedo ${m.albedo}; ${orients.map((o) => `mặt phẳng nghiêng ${o.tiltDeg}°, azimuth ${o.azimuthDeg}°`).join(' · ')} (Bắc = 0, theo chiều kim đồng hồ)`);
  else assumptions.push('POA lấy trực tiếp từ file thời tiết, coi là đúng mặt phẳng đã khai; không chuyển mặt phẳng');
  if (m.cellModel === 'faiman') assumptions.push(`Faiman u0=${m.faimanU0}, u1=${m.faimanU1}${w.windMs ? '' : `; gió dự phòng ${m.windFallbackMs} m/s (giả định)`}`);
  else assumptions.push(`Nhiệt độ cell cố định ${m.fixedCellTempC} °C`);
  assumptions.push('Không tính tổn hao do góc tới (IAM), phổ hay che bóng; bức xạ hữu hiệu = POA');
  if (m.lossRatio > 0) assumptions.push(`Tổn hao DC ${(m.lossRatio * 100).toFixed(1)} % áp dụng sau bước lý tưởng`);

  const s: PvSeries = { t: new Array(n), poaWm2: new Array(n), tcellC: new Array(n), zenithDeg: new Array(n), azimuthDeg: new Array(n),
    pIdealW: new Array(n).fill(0), pLossedW: new Array(n).fill(0), pTrackerW: new Array(n).fill(0), pInverterW: new Array(n).fill(0) };
  const perInverter = input.inverters.map(() => ({ pW: new Array<number>(n).fill(0), lossed: new Array<number>(n).fill(0) }));
  const freeTrackers = input.trackers.filter((t) => t.inverterId === null);
  const perBranch = freeTrackers.map(() => ({ pW: new Array<number>(n).fill(0), lossed: new Array<number>(n).fill(0) }));
  const stat = new Map<string, { shaded: number; free: number; dir: number; dirAcc: number }>();
  if (shade) for (const st of input.strings) for (const pn of st.panels) if (pn.id && pn.shadeIdx !== undefined) stat.set(pn.id, { shaded: 0, free: 0, dir: 0, dirAcc: 0 });
  const perString = input.strings.map((st) => ({ ideal: new Array<number>(n).fill(0), lossed: new Array<number>(n).fill(0), tracker: new Array<number>(n).fill(0) }));
  const trackerIdx = new Map(input.trackers.map((t, i) => [t.id, i]));
  const inverterIdx = new Map(input.inverters.map((v, i) => [v.id, i]));
  const applied: string[] = [], skipped: string[] = [];
  const yieldEvery = hooks.yieldEvery ?? 1000;

  // Limits are fixed for the whole run: work them out once. An unknown limit is not applied, and the result says so.
  const trackerCap = input.trackers.map((t) => {
    if (!m.applyLimits) return Infinity;
    let cap = Infinity;
    if (t.maxPowerW !== null) { cap = t.maxPowerW; applied.push(`${t.label}: công suất vào tối đa ${t.maxPowerW} W`); } else skipped.push(`${t.label}: không rõ công suất vào tối đa, không giới hạn`);
    const vops = input.strings.filter((st) => st.trackerId === t.id).map((st) => (st.panels.every((q) => q.vmpV !== null) ? st.panels.reduce((a, q) => a + q.vmpV!, 0) : null));
    if (t.maxCurrentA !== null && vops.length && vops.every((v) => v !== null)) {
      const byCurrent = t.maxCurrentA * Math.min(...(vops as number[]));
      cap = Math.min(cap, byCurrent);
      applied.push(`${t.label}: dòng vào tối đa ${t.maxCurrentA} A tại Vmp danh định (≈ ${Math.round(byCurrent)} W)`);
    } else skipped.push(`${t.label}: thiếu dòng tối đa hoặc Vmp, không giới hạn theo dòng`);
    return cap;
  });
  const inverterCap = input.inverters.map((v) => {
    if (!m.applyLimits) return Infinity;
    if (v.maxPvPowerW === null) { skipped.push(`${v.label}: không rõ PV vào tối đa, không giới hạn`); return Infinity; }
    applied.push(`${v.label}: PV vào tối đa ${v.maxPvPowerW} W`);
    return v.maxPvPowerW;
  });

  for (let i = 0; i < n; i++) {
    if (i % yieldEvery === 0) {
      if (hooks.isCancelled?.()) return null;
      hooks.onProgress?.(i, n);
      await new Promise<void>((r) => setTimeout(r, 0));
    }
    const t0 = w.t0 + i * w.stepSeconds, mid = t0 + w.stepSeconds / 2;
    const sun = sunPosition(mid, lat, lon, { pressurePa: pressure });
    // POA and cell temperature per plane orientation; a POA taken from the file is the same for all strings
    const tcellO: number[] = new Array(orients.length), dirO: number[] = new Array(orients.length).fill(0), ndO: number[] = new Array(orients.length).fill(0);
    const comps = mode === 'poa' ? null : completeIrradiance(w.ghi?.[i] ?? null, w.dni?.[i] ?? null, w.dhi?.[i] ?? null, Math.cos(sun.apparentZenithDeg * D2R))!;
    orients.forEach((o, oi) => {
      let poa: number;
      if (comps === null) { poa = Math.max(0, w.poa![i]); ndO[oi] = poa; }
      else {
        const cz = Math.cos(sun.apparentZenithDeg * D2R);
        const cosAoi = cz * Math.cos(o.tiltDeg * D2R) + Math.sin(sun.apparentZenithDeg * D2R) * Math.sin(o.tiltDeg * D2R) * Math.cos((sun.azimuthDeg - o.azimuthDeg) * D2R);
        const r = sun.apparentZenithDeg >= 90 ? isotropicPoa(0, comps.dhi, comps.ghi, 0, o.tiltDeg, m.albedo) : isotropicPoa(comps.dni, comps.dhi, comps.ghi, cosAoi, o.tiltDeg, m.albedo);
        poa = r.poa; dirO[oi] = r.direct; ndO[oi] = r.sky + r.ground; // sky and ground diffuse are never reduced by obstacles in this model
      }
      o.poaWm2[i] = poa;
      tcellO[oi] = m.cellModel === 'fixed' ? m.fixedCellTempC! : faimanTcell(w.tempAirC![i], poa, w.windMs ? w.windMs[i] : m.windFallbackMs!, m.faimanU0, m.faimanU1);
    });
    s.t[i] = t0; s.poaWm2[i] = orients[0].poaWm2[i]; s.tcellC[i] = tcellO[0]; s.zenithDeg[i] = sun.apparentZenithDeg; s.azimuthDeg[i] = sun.azimuthDeg;

    const trackerSum = input.trackers.map(() => 0);
    input.strings.forEach((st, k) => {
      const oi = orientOf[k];
      let ideal: number;
      if (!shade && stringMode === 'sum') ideal = st.panels.reduce((a, p) => a + panelDcW(p, orients[oi].poaWm2[i], tcellO[oi]), 0);
      else {
        // per-panel POA: direct × access + sky + ground. One shared cell temperature is wrong for a shaded panel, so each panel gets its own.
        let sum = 0, weakest = Infinity;
        for (const pn of st.panels) {
          const f = shade && pn.shadeIdx !== undefined ? shade.access[pn.shadeIdx][i] : 1;
          const poaP = f === 1 ? orients[oi].poaWm2[i] : dirO[oi] * f + ndO[oi];
          const tc = f === 1 ? tcellO[oi] : m.cellModel === 'fixed' ? m.fixedCellTempC! : faimanTcell(w.tempAirC![i], poaP, w.windMs ? w.windMs[i] : m.windFallbackMs!, m.faimanU0, m.faimanU1);
          const pw = panelDcW(pn, poaP, tc);
          sum += pw; weakest = Math.min(weakest, pw);
          if (shade && pn.id && pn.shadeIdx !== undefined) {
            const st2 = stat.get(pn.id)!;
            st2.shaded += pw * dtH; st2.free += panelDcW(pn, orients[oi].poaWm2[i], tcellO[oi]) * dtH;
            if (dirO[oi] > 0) { st2.dir += dirO[oi]; st2.dirAcc += dirO[oi] * f; }
          }
        }
        ideal = stringMode === 'weakest' ? st.panels.length * weakest : sum;
      }
      const lossed = ideal * (1 - m.lossRatio);
      perString[k].ideal[i] = ideal; perString[k].lossed[i] = lossed;
      s.pIdealW[i] += ideal; s.pLossedW[i] += lossed;
      trackerSum[trackerIdx.get(st.trackerId)!] += lossed;
    });
    const inverterSum = input.inverters.map(() => 0);
    input.trackers.forEach((t, ti) => {
      const p = Math.min(trackerSum[ti], trackerCap[ti]);
      s.pTrackerW[i] += p;
      if (t.inverterId !== null) { inverterSum[inverterIdx.get(t.inverterId)!] += p; perInverter[inverterIdx.get(t.inverterId)!].lossed[i] += trackerSum[ti]; }
      else { s.pInverterW[i] += p; const b = perBranch[freeTrackers.indexOf(t)]; b.pW[i] = p; b.lossed[i] = trackerSum[ti]; } // pump controller branch
      // a clipped tracker gives each string back its proportional share
      input.strings.forEach((st, k) => { if (st.trackerId === t.id) perString[k].tracker[i] = trackerSum[ti] > 0 ? (p * perString[k].lossed[i]) / trackerSum[ti] : 0; });
    });
    input.inverters.forEach((_, vi) => { const p = Math.min(inverterSum[vi], inverterCap[vi]); s.pInverterW[i] += p; perInverter[vi].pW[i] = p; });
  }
  hooks.onProgress?.(n, n);

  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0) * dtH;
  const kWp = input.strings.reduce((a, st) => a + st.panels.reduce((b, p) => b + p.pstcW, 0), 0) / 1000;
  const eIdeal = sum(s.pIdealW), eLossed = sum(s.pLossedW), eTracker = sum(s.pTrackerW), eInv = sum(s.pInverterW);
  return {
    engineVersion: ENGINE_VERSION, inputHash, models: modelNames(mode, m), period: periodOf(w), series: s, orientations: orients,
    shade: shade ? { key: shade.key, modelVersion: shade.modelVersion, mode: shade.mode, samplesPerPanel: shade.samplesPerPanel, stringMode,
      panels: [...stat].map(([id, v]) => ({ id, eIdealWh: v.shaded, eIdealNoShadeWh: v.free, directAccess: v.dir > 0 ? v.dirAcc / v.dir : null })),
      notes: ['Chỉ trực xạ bị bóng che; khuếch tán trời và phản xạ đất giữ nguyên (vật cản không làm giảm góc nhìn bầu trời)', 'Không giải bypass diode, IV từng cell hay hotspot: cận trên = cộng công suất từng tấm, cận dưới = tấm yếu nhất quyết định cả chuỗi', 'Chỉ vật cản và mặt mái khác che; tấm không che nhau'] } : null,
    strings: input.strings.map((st, k) => ({ id: st.id, label: st.label, panelCount: st.panels.length, pstcW: st.panels.reduce((a, p) => a + p.pstcW, 0), orientation: orientOf[k], trackerId: st.trackerId, inverterId: input.trackers.find((t) => t.id === st.trackerId)!.inverterId, pIdealW: perString[k].ideal, pLossedW: perString[k].lossed, pTrackerW: perString[k].tracker })),
    inverters: input.inverters.map((v, vi) => ({ id: v.id, label: v.label, pW: perInverter[vi].pW, pLossedW: perInverter[vi].lossed })),
    branches: freeTrackers.map((t, bi) => ({ trackerId: t.id, label: t.label, pW: perBranch[bi].pW, pLossedW: perBranch[bi].lossed })),
    totals: { kWp, eIdealWh: eIdeal, lossWh: eIdeal - eLossed, eLossedWh: eLossed, clippedTrackerWh: eLossed - eTracker, eTrackerWh: eTracker, clippedInverterWh: eTracker - eInv, eInverterWh: eInv,
      peakW: Math.max(0, ...s.pInverterW), specificYieldKWhPerKWp: kWp > 0 ? eInv / 1000 / kWp : null },
    assumptions, limitsApplied: applied, limitsSkipped: skipped, issues,
  };
}

const modelNames = (mode: 'components' | 'poa', m: PvModel): PvResult['models'] => ({
  solarPosition: 'Astronomical Almanac low-precision + SPA refraction (≈0.01°)',
  transposition: mode === 'poa' ? 'POA from file (none)' : 'isotropic (Liu–Jordan)',
  cellTemperature: m.cellModel === 'faiman' ? 'Faiman' : 'fixed',
  dc: 'linear: Pstc·G/1000·[1+γ(Tc−25)]',
  limits: m.applyLimits ? 'tracker power/current, inverter PV input power' : 'none',
  irradianceInput: mode,
});
const periodOf = (w: WeatherSeries) => ({ startUtc: new Date(w.t0 * 1000).toISOString(), endUtc: new Date((w.t0 + w.n * w.stepSeconds) * 1000).toISOString(), stepSeconds: w.stepSeconds, n: w.n });
function emptyResult(input: PvInput, inputHash: string, mode: 'components' | 'poa'): PvResult {
  const z = { t: [], poaWm2: [], tcellC: [], zenithDeg: [], azimuthDeg: [], pIdealW: [], pLossedW: [], pTrackerW: [], pInverterW: [] };
  return { engineVersion: ENGINE_VERSION, inputHash, models: modelNames(mode, input.model), period: periodOf(input.weather), series: z, orientations: [], shade: null, strings: [], inverters: [], branches: [],
    totals: { kWp: 0, eIdealWh: 0, lossWh: 0, eLossedWh: 0, clippedTrackerWh: 0, eTrackerWh: 0, clippedInverterWh: 0, eInverterWh: 0, peakW: 0, specificYieldKWhPerKWp: null },
    assumptions: [], limitsApplied: [], limitsSkipped: [], issues: [] };
}
