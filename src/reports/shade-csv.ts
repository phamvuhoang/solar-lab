import { formatUtc, localDate, localHour } from '../weather/series';
import type { ShadeField } from '../shade/sampler';

const clean = (s: string) => s.replace(/[\r\n]+/g, ' ');
const head = (f: ShadeField, extra: string[]) => [
  '# mekoniq-solar-lab shade v1', `# model: ${f.modelVersion}`, `# key: ${f.key}`, `# geometry_hash: ${f.geometryHash}`,
  `# samples_per_panel: ${f.samplesPerPanel} (${f.mode === 'preview' ? '1 point at the centre' : `${f.grid}x${f.grid} cell-centred grid`})`, `# ray_offset_m: ${f.rayOffsetM}`, `# step_seconds: ${f.stepSeconds}`,
  '# direct_access: share of sample points that see the sun (0 at night and when the sun is behind the panel). Diffuse and ground-reflected light are not reduced.',
  ...f.obstacles.map((o) => `# obstacle: ${clean(o.label)} ${o.kind} centre(e,n,up)=${o.center.map((x) => x.toFixed(3)).join(',')} size(x,y,z)=${o.size.map((x) => x.toFixed(3)).join(',')}`), ...extra,
];
const clamp4 = (x: number) => x.toFixed(4);

/** One row per panel and step of the chosen local day. The inspector shows exactly these numbers (4 decimals). */
export function shadeDayCsv(f: ShadeField, idx: number[], meta: { timeZone: string; panels: { id: string; label: string; stringIndex: number }[]; project: string; sun: Map<number, { az: number; el: number }> }): string {
  const rows: string[] = [];
  for (const i of idx) {
    const t = f.t0 + i * f.stepSeconds, sun = meta.sun.get(i);
    f.panelIds.forEach((id, k) => {
      const m = meta.panels.find((x) => x.id === id);
      rows.push([formatUtc(t), localDate(t + f.stepSeconds / 2, meta.timeZone), localHour(t + f.stepSeconds / 2, meta.timeZone), id, `"${(m?.label ?? id).replace(/"/g, '""')}"`, m?.stringIndex ? `S${m.stringIndex}` : '', clamp4(f.access[k][i]), sun ? sun.az.toFixed(2) : '', sun ? sun.el.toFixed(2) : ''].join(','));
    });
  }
  return '﻿' + [...head(f, [`# project: ${clean(meta.project)}`]), 'timestamp_utc,local_date,local_hour,panel_id,panel_label,string,direct_access,sun_azimuth_deg,sun_apparent_elevation_deg', ...rows].join('\r\n') + '\r\n';
}

export interface PanelYear { id: string; label: string; stringIndex: number; directAccess: number | null; eFreeWh: number; eShadedWh: number }
export function shadeYearCsv(f: ShadeField, panels: PanelYear[], meta: { project: string; scene: string; stringBounds: string }): string {
  const rows = panels.map((p) => [p.id, `"${p.label.replace(/"/g, '""')}"`, p.stringIndex ? `S${p.stringIndex}` : '', p.directAccess === null ? '' : clamp4(p.directAccess), p.eFreeWh.toFixed(1), p.eShadedWh.toFixed(1), (p.eFreeWh - p.eShadedWh).toFixed(1), p.eFreeWh > 0 ? (((p.eFreeWh - p.eShadedWh) / p.eFreeWh) * 100).toFixed(2) : ''].join(','));
  return '﻿' + [...head(f, [`# project: ${clean(meta.project)}`, `# scene: ${clean(meta.scene)}`, `# ${clean(meta.stringBounds)}`, '# energies are ideal DC at the panel (before DC loss and tracker/inverter limits), Wh over the whole weather series']),
    'panel_id,panel_label,string,direct_access_weighted,e_ideal_free_wh,e_ideal_shaded_wh,loss_wh,loss_pct', ...rows].join('\r\n') + '\r\n';
}
