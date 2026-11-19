import { reasonsOf } from '../engine/dispatch';
import type { SimResult } from '../engine/system';
import { formatUtc, localDate, localHour } from '../weather/series';

const clean = (s: string) => s.replace(/[\r\n]+/g, ' ');

/** Per-step export of one run: energies in Wh for the step, reason codes joined by '|'. */
export function simResultToCsv(r: SimResult, meta: { projectName: string; weatherName: string; timeZone: string; label: string }): string {
  const d = r.dispatch, s = d.series, step = d.period.stepSeconds, f = (x: number) => x.toFixed(3);
  const head = [
    '# mekoniq-solar-lab system result v1', `# run: ${clean(meta.label)}`, `# project: ${clean(meta.projectName)}`, `# weather: ${clean(meta.weatherName)}`,
    `# pv_engine: ${r.pv.engineVersion}`, `# dispatch: ${d.version}`, `# input_hash: ${r.inputHash}`, `# step_seconds: ${step}`,
    '# timestamp_utc: start of interval; energies are Wh over the step (AC for loads/export/grid, DC bus for PV and battery)',
    `# ledger_max_residual_wh: ${d.ledger.maxResidualWh}`, ...d.assumptions.map((a) => `# assumption: ${clean(a)}`), ...d.skipped.map((a) => `# not_applied: ${clean(a)}`),
    `timestamp_utc,local_date,local_hour,pv_potential_wh,pv_clipped_wh,pv_bus_wh,load_requested_wh,load_served_wh,unserved_wh,grid_import_wh,export_wh,curtailed_wh,charge_bus_wh,discharge_bus_wh,soc_end,inverter_loss_wh,charge_loss_wh,discharge_loss_wh,standby_wh,branch_potential_wh,branch_served_wh,ledger_residual_wh,reasons`,
  ];
  const rows = s.t.map((t, i) => [formatUtc(t), localDate(t + step / 2, meta.timeZone), localHour(t + step / 2, meta.timeZone), f(s.pvPotentialWh[i]), f(s.clipWh[i]), f(s.pvBusWh[i]), f(s.loadRequestedWh[i]),
    f(s.loadServedWh[i]), f(s.unservedWh[i]), f(s.gridImportWh[i]), f(s.exportWh[i]), f(s.curtailedWh[i]), f(s.chargeBusWh[i]), f(s.dischargeBusWh[i]), s.socEnd[i].toFixed(5), f(s.inverterLossWh[i]),
    f(s.chargeLossWh[i]), f(s.dischargeLossWh[i]), f(s.standbyWh[i]), f(s.branchPotentialWh[i]), f(s.branchServedWh[i]), s.residualWh[i].toExponential(2), reasonsOf(s.reasons[i]).join('|')].join(','));
  return '﻿' + head.join('\r\n') + '\r\n' + rows.join('\r\n') + '\r\n';
}
