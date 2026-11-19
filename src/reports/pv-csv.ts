import type { PvResult } from '../engine/pv';
import { formatUtc, localDate, localHour } from '../weather/series';

const clean = (s: string) => s.replace(/[\r\n]+/g, ' ');

/** Hourly export for cross-checking: power (W, interval mean) and energy (Wh = W × step/3600) are separate columns. */
export function pvResultToCsv(r: PvResult, meta: { weatherName: string; source: string; timeZone: string }): string {
  const step = r.period.stepSeconds, f = (x: number) => x.toFixed(3);
  const head = [
    '# mekoniq-solar-lab pv result v1',
    `# engine: ${r.engineVersion}`, `# input_hash: ${r.inputHash}`,
    `# weather: ${clean(meta.weatherName)}`, `# weather_source: ${clean(meta.source)}`,
    `# step_seconds: ${step}`, '# timestamp_utc: start of interval; sun position evaluated at the midpoint',
    ...Object.entries(r.models).map(([k, v]) => `# model.${k}: ${clean(v)}`),
    ...r.assumptions.map((a) => `# assumption: ${clean(a)}`), ...r.limitsApplied.map((a) => `# limit_applied: ${clean(a)}`), ...r.limitsSkipped.map((a) => `# limit_skipped: ${clean(a)}`),
    `timestamp_utc,local_date_${meta.timeZone.replace(/\W/g, '_')},local_hour,poa_wm2,tcell_c,apparent_zenith_deg,azimuth_deg,p_ideal_w,p_after_loss_w,p_after_tracker_w,p_after_inverter_w,e_after_inverter_wh`,
  ];
  const s = r.series;
  const rows = s.t.map((t, i) => [formatUtc(t), localDate(t + step / 2, meta.timeZone), localHour(t + step / 2, meta.timeZone), f(s.poaWm2[i]), f(s.tcellC[i]), f(s.zenithDeg[i]), f(s.azimuthDeg[i]),
    f(s.pIdealW[i]), f(s.pLossedW[i]), f(s.pTrackerW[i]), f(s.pInverterW[i]), f((s.pInverterW[i] * step) / 3600)].join(','));
  return '﻿' + head.join('\r\n') + '\r\n' + rows.join('\r\n') + '\r\n';
}
