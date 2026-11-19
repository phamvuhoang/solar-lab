import { hashOf } from '../domain/hash';
import { hashPvInput } from './compile';
import { simulateDispatch, type DispatchInput, type DispatchInverter, type Bank, type DispatchLoad, type DispatchResult } from './dispatch';
import { simulatePv, type PvInput, type PvResult } from './pv';
import type { SimPolicy } from '../domain/types';

/** Everything the dispatch needs except the PV series, which come from the PV run in the same job. */
export interface DispatchSpec {
  timeZone: string; inverterId: string; inverter: DispatchInverter; bank: Bank | null; policy: SimPolicy; loads: DispatchLoad[]; branchTrackerId: string | null; notes: string[];
}
export interface SimInput { pv: PvInput; spec: DispatchSpec }
export interface SimResult { pv: PvResult; dispatch: DispatchResult; inputHash: string }

export const simHash = async (i: SimInput) => hashOf({ pv: await hashPvInput(i.pv), spec: i.spec });

/** Join the PV result's inverter bus and pump-branch series with the static dispatch spec. */
export function buildDispatchInput(spec: DispatchSpec, pv: PvResult): DispatchInput | null {
  const inv = pv.inverters.find((v) => v.id === spec.inverterId);
  if (!inv) return null;
  const br = spec.branchTrackerId ? pv.branches.find((b) => b.trackerId === spec.branchTrackerId) : undefined;
  return {
    t: pv.series.t, stepSeconds: pv.period.stepSeconds, timeZone: spec.timeZone, bus: { pvPotentialW: inv.pLossedW, pvBusW: inv.pW },
    branch: br ? { pvPotentialW: br.pLossedW, pvW: br.pW } : null, inverter: spec.inverter, bank: spec.bank, policy: spec.policy, loads: spec.loads,
  };
}

/** PV then dispatch. Progress is 0–50 % for PV and 50–100 % for dispatch. Returns null if cancelled, a failure list if the PV input was refused. */
export async function simulateSystem(input: SimInput, inputHash: string, hooks: { onProgress?(done: number, total: number): void; isCancelled?(): boolean; yieldEvery?: number } = {}):
  Promise<{ ok: true; result: SimResult } | { ok: false; issues: PvResult['issues'] } | null> {
  const pv = await simulatePv(input.pv, inputHash, { ...hooks, onProgress: (d, t) => hooks.onProgress?.(d / 2, t) });
  if (pv === null) return null;
  if (pv.issues.length) return { ok: false, issues: pv.issues };
  const di = buildDispatchInput(input.spec, pv);
  if (!di) return { ok: false, issues: [{ code: 'INVERTER_NOT_IN_PV', severity: 'error', field: '/spec/inverterId', message: 'Inverter của dispatch không có chuỗi PV nào trong kết quả PV' }] };
  const total = pv.period.n;
  const dispatch = await simulateDispatch(di, inputHash, { ...hooks, onProgress: (d) => hooks.onProgress?.(total / 2 + d / 2, total) });
  if (dispatch === null) return null;
  hooks.onProgress?.(total, total);
  return { ok: true, result: { pv, dispatch, inputHash } };
}
