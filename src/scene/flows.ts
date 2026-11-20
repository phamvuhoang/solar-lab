import type { SimResult } from '../engine/system';
import type { SceneModel } from './model';

/** Power on one drawn wire at a replay step: w ≥ 0 (W, step average); dir 1 = from → to as the wire is drawn. */
export interface Flow { wireId: string; w: number; dir: 1 | -1 }

const kw = (w: number) => `${(w / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} kW`;

/**
 * What each wire carries at `step` of a run, read from the engine's series; nothing here but a sign and a sum.
 * PV wires carry the string's power after the tracker limit (dispatch curtails at the bus, not per string).
 */
export function flowsAt(model: SceneModel, r: SimResult, step: number): { flows: Flow[]; text: string[] } {
  const s = r.dispatch.series, dt = r.dispatch.period.stepSeconds / 3600, at = (wh: number) => Math.max(0, wh / dt);
  const net = (s.chargeBusWh[step] - s.dischargeBusWh[step]) / dt; // > 0: charging, inverter → battery
  const flows: Flow[] = [];
  for (const w of model.wires) {
    const fwd = w.fromKind === 'panel' || w.fromKind === 'inverter' || w.fromKind === 'controller'; // drawn from the supplying end
    const push = (x: number, along: boolean) => flows.push({ wireId: w.id, w: x, dir: along ? 1 : -1 });
    if (w.kind === 'dc-pv') { const st = r.pv.strings.find((x) => x.id === w.refId); if (st) push(Math.max(0, st.pTrackerW[step]), true); }
    else if (w.kind === 'dc-bat') push(Math.abs(net), fwd === net >= 0);
    // ponytail: every AC wire carries the total AC load served; dispatch has no per-load series yet, split per load when the engine has one
    else if (w.kind === 'ac') push(at(s.loadServedWh[step] - s.branchServedWh[step]), fwd);
    else push(at(s.branchServedWh[step]), fwd); // dc-pump: what the pump got, not the branch PV (which is curtailed while it is off)
  }
  const has = (k: SceneModel['wires'][number]['kind']) => model.wires.some((w) => w.kind === k);
  const text = [
    `PV vào inverter ${kw(at(s.pvBusWh[step]))}`,
    ...(has('dc-bat') ? [`Pin: ${net >= 0 ? 'sạc' : 'xả'} ${kw(Math.abs(net))}`] : []),
    `Tải: ${kw(at(s.loadServedWh[step]))}`, `Lưới: ${kw(at(s.gridImportWh[step]))}`,
    // the PV arrows show what the strings can give; what the bus had to cut is said, so the numbers add up (a limit is never hidden)
    ...(s.curtailedWh[step] - s.clipWh[step] > 0.5 ? [`PV dư bị cắt ${kw(at(s.curtailedWh[step] - s.clipWh[step]))}`] : []),
    ...(has('dc-pump') ? [`Bơm (nhánh DC): ${kw(at(s.branchServedWh[step]))}`] : []),
  ];
  return { flows, text };
}
