import type { SimPolicy } from '../../src/domain/types';
import type { Bank, DispatchInput, DispatchInverter, DispatchLoad } from '../../src/engine/dispatch';

export const policy = (o: Partial<SimPolicy> = {}): SimPolicy => ({
  minSoc: 0.2, soc0: 0.5, etaCharge: 0.95, etaDischarge: 0.95, inverterEfficiency: null, standbyW: 0,
  gridAvailable: false, importAllowed: false, exportAllowed: false, outageLocalHours: [], ...o,
});
export const bank = (o: Partial<Bank> = {}): Bank => ({ nominalWh: 10000, sohRatio: 1, socMin: 0.2, socMax: 1, nominalV: 51.2, maxChargeW: null, maxDischargeW: null, ...o });
export const inverter = (o: Partial<DispatchInverter> = {}): DispatchInverter => ({ acRatedW: 6000, surgeW: 12000, efficiency: 0.9, maxChargeW: null, maxDischargeW: null, ...o });
export const flat = (v: number) => new Array<number>(24).fill(v);
export const load = (o: Partial<DispatchLoad> & { id?: string } = {}): DispatchLoad => ({
  id: 'L', label: 'L', powerW: 900, startupW: null, priority: 1, fractions: flat(1), feed: 'inverter', pump: null, ...o,
});
export const at = (hour: number, v = 1, base = 0) => { const a = flat(base); a[hour] = v; return a; };

/** n steps starting 2023-01-01 00:00 UTC (timeZone 'UTC' so local hour = UTC hour). */
export function mk(o: { pvBusW: number[]; potentialW?: number[]; stepSeconds?: number; t0?: number; loads?: DispatchLoad[]; bank?: Bank | null; inverter?: DispatchInverter; policy?: Partial<SimPolicy>;
  branch?: { pvPotentialW: number[]; pvW: number[] } | null }): DispatchInput {
  const step = o.stepSeconds ?? 3600, t0 = o.t0 ?? Date.UTC(2023, 0, 1) / 1000;
  return {
    t: o.pvBusW.map((_, i) => t0 + i * step), stepSeconds: step, timeZone: 'UTC',
    bus: { pvPotentialW: o.potentialW ?? o.pvBusW, pvBusW: o.pvBusW }, branch: o.branch ?? null,
    inverter: o.inverter ?? inverter(), bank: o.bank === undefined ? bank() : o.bank, policy: policy(o.policy), loads: o.loads ?? [load()],
  };
}
