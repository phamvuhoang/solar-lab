import { indexProject } from '../domain/graph';
import type { Project } from '../domain/types';
import type { SimResult } from '../engine/system';
import { localHour } from '../weather/series';
import type { SceneModel } from './model';

/** Power on one drawn wire at a replay step: w ≥ 0 (W, step average); dir 1 = from → to as the wire is drawn. */
export interface Flow { wireId: string; w: number; dir: 1 | -1 }

const kw = (w: number) => `${(w / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} kW`;

/**
 * What each wire carries at `step` of a run of `p` (the project `model` was built from), read from the engine's series;
 * nothing here but a sign, a sum and the load schedule. PV wires carry the string's power after the tracker limit
 * (dispatch curtails at the bus, not per string); the text says what was cut.
 */
export function flowsAt(model: SceneModel, r: SimResult, step: number, p: Project): { flows: Flow[]; text: string[] } {
  const s = r.dispatch.series, dt = r.dispatch.period.stepSeconds / 3600, at = (wh: number) => Math.max(0, wh / dt);
  const net = (s.chargeBusWh[step] - s.dischargeBusWh[step]) / dt; // > 0: charging, inverter → battery
  // an AC load asks for power this hour as dispatch decides it (powerW × fraction of the local hour > 0); an idle one gets no arrow
  const hour = localHour(s.t[step], p.location?.timezone ?? 'Asia/Ho_Chi_Minh'), ix = indexProject(p), plans = new Map((p.loadPlans ?? []).map((l) => [l.instanceId, l]));
  const asks = (id: string) => (ix.inst.get(id)?.comp?.specs.powerW?.v ?? 0) * (plans.get(id)?.fractions[hour] ?? 0) > 0;
  const edges = new Map(p.edges.map((e) => [e.edgeId, e]));
  const acOn = new Set(model.wires.filter((w) => {
    const e = w.kind === 'ac' ? edges.get(w.refId) : undefined;
    return e && asks((w.fromKind === 'load' ? e.from : e.to).instanceId);
  }).map((w) => w.id));
  const flows: Flow[] = [];
  for (const w of model.wires) {
    const fwd = w.fromKind === 'panel' || w.fromKind === 'inverter' || w.fromKind === 'controller'; // drawn from the supplying end
    const push = (x: number, along: boolean) => flows.push({ wireId: w.id, w: x, dir: along ? 1 : -1 });
    if (w.kind === 'dc-pv') { const st = r.pv.strings.find((x) => x.id === w.refId); if (st) push(Math.max(0, st.pTrackerW[step]), true); }
    else if (w.kind === 'dc-bat') push(Math.abs(net), fwd === net >= 0);
    // ponytail: with two or more AC loads running, each active wire carries the AC total (the text says so); dispatch has no per-load series yet, split per load when the engine has one
    else if (w.kind === 'ac') push(acOn.has(w.id) ? at(s.loadServedWh[step] - s.branchServedWh[step]) : 0, fwd);
    else push(at(s.branchServedWh[step]), fwd); // dc-pump: what the pump got, not the branch PV (which is cut while it is off)
  }
  const has = (k: SceneModel['wires'][number]['kind']) => model.wires.some((w) => w.kind === k);
  const text = [
    `PV vào inverter ${kw(at(s.pvBusWh[step]))}`,
    ...(has('dc-bat') ? [`Pin: ${net >= 0 ? 'sạc' : 'xả'} ${kw(Math.abs(net))}`] : []),
    `Tải: ${kw(at(s.loadServedWh[step]))}`,
    ...(s.unservedWh[step] > 0 ? [`Thiếu ${kw(at(s.unservedWh[step]))}`] : []), // "Tải" is what was served: a shortage is said, never left out
    `Lưới nhập ${kw(at(s.gridImportWh[step]))}`,
    ...(s.exportWh[step] > 0.5 ? [`Lưới xuất ${kw(at(s.exportWh[step]))}`] : []),
    // the PV arrows show what the strings can give; what the bus had to cut is said, so the numbers add up (a limit is never hidden)
    ...(s.curtailedWh[step] - s.clipWh[step] > 0.5 ? [`PV dư bị cắt ${kw(at(s.curtailedWh[step] - s.clipWh[step]))}`] : []),
    ...(has('dc-pump') ? [`Nhánh bơm: PV ${kw(at(s.branchPotentialWh[step]))}, bơm nhận ${kw(at(s.branchServedWh[step]))}, bị cắt ${kw(at(s.branchCurtailedWh[step]))}`] : []),
    ...(acOn.size > 1 ? ['Mũi tên AC là tổng các tải, không chia theo từng tải'] : []),
  ];
  return { flows, text };
}
