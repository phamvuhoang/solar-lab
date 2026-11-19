import { localHour } from '../weather/series';
import { operatingPoint, type PumpCurve } from './pump';
import type { SimPolicy } from '../domain/types';

export const DISPATCH_VERSION = 'dispatch-1.0.0';

/** Bit i of a step's `reasons` word means REASONS[i] applied in that step. */
export const REASONS = [
  'PV_TO_LOAD', 'BATTERY_CHARGE', 'BATTERY_DISCHARGE', 'BATTERY_FULL', 'RESERVE_REACHED', 'CHARGE_LIMIT_BMS', 'CHARGE_LIMIT_INVERTER', 'DISCHARGE_LIMIT_BMS',
  'DISCHARGE_LIMIT_INVERTER', 'INVERTER_AC_LIMIT', 'GRID_IMPORT', 'GRID_OUTAGE', 'EXPORT', 'EXPORT_FORBIDDEN', 'CURTAILED_PV', 'CLIPPED_PV', 'START_BLOCKED',
  'UNSERVED_LOAD', 'STANDBY', 'NO_BATTERY', 'PUMP_BRANCH_CURTAILED',
] as const;
export type Reason = (typeof REASONS)[number];
const BIT = Object.fromEntries(REASONS.map((r, i) => [r, 1 << i])) as Record<Reason, number>;
export const reasonsOf = (mask: number): Reason[] => REASONS.filter((_, i) => mask & (1 << i));

export interface Bank { nominalWh: number; sohRatio: number; socMin: number; socMax: number; nominalV: number; maxChargeW: number | null; maxDischargeW: number | null }
export interface DispatchInverter { acRatedW: number; surgeW: number | null; efficiency: number; maxChargeW: number | null; maxDischargeW: number | null }
export interface DispatchLoad {
  id: string; label: string; powerW: number; startupW: number | null; priority: number; fractions: number[]; feed: 'inverter' | 'controller';
  pump: { staticHeadM: number | null; frictionK: number | null; curve: PumpCurve | null } | null;
}
export interface DispatchInput {
  t: number[]; stepSeconds: number; timeZone: string;
  bus: { pvPotentialW: number[]; pvBusW: number[] };
  branch: { pvPotentialW: number[]; pvW: number[] } | null;
  inverter: DispatchInverter; bank: Bank | null; policy: SimPolicy; loads: DispatchLoad[];
}

export interface StartCheck { loadId: string; step: number; requiredW: number; availableW: number | null; ok: boolean | null }
export interface DispatchLoadTotals { id: string; label: string; feed: 'inverter' | 'controller'; requestedWh: number; servedWh: number; gridWh: number; unservedWh: number; hoursShort: number;
  starts: number; startsBlocked: number; volumeM3: number | null; volumeNote: string | null }
export interface DispatchSeries {
  t: number[]; pvPotentialWh: number[]; clipWh: number[]; pvBusWh: number[];
  loadRequestedWh: number[]; loadServedWh: number[]; gridImportWh: number[]; unservedWh: number[];
  chargeBusWh: number[]; dischargeBusWh: number[]; eEndWh: number[]; socEnd: number[];
  exportWh: number[]; curtailedWh: number[]; inverterLossWh: number[]; chargeLossWh: number[]; dischargeLossWh: number[]; standbyWh: number[];
  branchPotentialWh: number[]; branchServedWh: number[]; branchCurtailedWh: number[];
  residualWh: number[]; reasons: number[];
}
export interface DispatchTotals {
  pvPotentialWh: number; clipWh: number; pvBusWh: number; branchPotentialWh: number; branchServedWh: number; branchCurtailedWh: number;
  loadRequestedWh: number; loadServedWh: number; gridImportWh: number; unservedWh: number; exportWh: number; curtailedWh: number;
  chargeBusWh: number; dischargeBusWh: number; inverterLossWh: number; chargeLossWh: number; dischargeLossWh: number; standbyWh: number;
  eStartWh: number; eEndWh: number; storedDeltaWh: number;
}
export interface DispatchMetrics {
  servedRatio: number | null; servedRatioNote: string | null; hoursShort: number;
  pvUtilization: number | null; autonomy: number | null; minSoc: number | null; minSocAt: number | null; firstReserveAt: number | null; firstShortageAt: number | null;
  lowestSunMonth: { month: string; pvKWh: number } | null; socStart: number | null; socEnd: number | null;
}
export interface DispatchResult {
  version: string; inputHash: string; period: { startUtc: string; endUtc: string; stepSeconds: number; n: number };
  series: DispatchSeries; totals: DispatchTotals; metrics: DispatchMetrics; loads: DispatchLoadTotals[];
  reasonTotals: Record<string, { steps: number; wh: number | null }>; startChecks: StartCheck[]; startCheckCount: number;
  ledger: { maxResidualWh: number; toleranceOk: boolean; worstStep: number }; assumptions: string[]; skipped: string[];
}

const sumOf = (a: number[]) => a.reduce((x, y) => x + y, 0);
const tol = (maxEnergy: number) => Math.max(0.01, 1e-6 * maxEnergy);

export class LedgerError extends Error {
  constructor(public step: number, public residualWh: number) { super(`LEDGER_IMBALANCE at step ${step}: ${residualWh} Wh`); }
}

/**
 * DC-coupled dispatch, one inverter (AC out), one bank on its DC bus. Order each step: standby, then loads by priority (PV → battery → grid),
 * leftover PV → charge → export or curtail. The bank never charges and discharges in the same step. Every step is checked against
 *   PV_potential + grid_import + E_start = served + export + curtailed + losses + E_end   (Wh).
 */
export async function simulateDispatch(input: DispatchInput, inputHash: string, hooks: { onProgress?(d: number, t: number): void; isCancelled?(): boolean; yieldEvery?: number } = {}): Promise<DispatchResult | null> {
  const { t, stepSeconds, policy, inverter: inv, bank, loads } = input;
  const n = t.length, dt = stepSeconds / 3600, eta = inv.efficiency, etaC = policy.etaCharge, etaD = policy.etaDischarge;
  const assumptions: string[] = [], skipped: string[] = [];
  const cap = bank ? bank.nominalWh * bank.sohRatio : 0;
  const eMin = bank ? bank.socMin * cap : 0, eMax = bank ? bank.socMax * cap : 0;
  const chargeCapW = bank ? Math.min(bank.maxChargeW ?? Infinity, inv.maxChargeW ?? Infinity) : 0;
  const dischargeCapW = bank ? Math.min(bank.maxDischargeW ?? Infinity, inv.maxDischargeW ?? Infinity) : 0;
  const bmsCharge = bank?.maxChargeW ?? Infinity, invCharge = inv.maxChargeW ?? Infinity, bmsDis = bank?.maxDischargeW ?? Infinity, invDis = inv.maxDischargeW ?? Infinity;
  if (bank) {
    if (bank.maxChargeW === null && inv.maxChargeW === null) skipped.push('Không rõ giới hạn dòng sạc (pin và inverter): không giới hạn');
    if (bank.maxDischargeW === null && inv.maxDischargeW === null) skipped.push('Không rõ giới hạn dòng xả (pin và inverter): không giới hạn');
  }
  assumptions.push(`Hiệu suất inverter ${(eta * 100).toFixed(1)} % không đổi theo tải; sạc ${(etaC * 100).toFixed(0)} %, xả ${(etaD * 100).toFixed(0)} % (mỗi chiều)`);
  assumptions.push(bank ? `Dự phòng SoC ≥ ${(bank.socMin * 100).toFixed(0)} % của ${(cap / 1000).toFixed(2)} kWh (danh nghĩa × SoH ${bank.sohRatio}); SoC đầu ${(policy.soc0 * 100).toFixed(0)} %` : 'Không có pin nối vào inverter');
  assumptions.push(policy.gridAvailable ? `Lưới có: nhập ${policy.importAllowed ? 'được' : 'cấm'}, xuất ${policy.exportAllowed ? 'được' : 'cấm'}${policy.outageLocalHours.length ? `; mất lưới các giờ ${policy.outageLocalHours.join(', ')}` : ''}` : 'Không có lưới (độc lập): nhập và xuất bằng 0');
  if (policy.standbyW > 0) assumptions.push(`Inverter tự tiêu thụ ${policy.standbyW} W liên tục (phía DC)`);
  assumptions.push('Lịch tải theo giờ địa phương, mọi ngày giống nhau; công suất tải = công suất định mức × tỉ lệ giờ');
  if (inv.surgeW === null && loads.some((l) => l.startupW !== null && l.feed === 'inverter')) skipped.push('Không rõ công suất đỉnh khởi động của inverter: không kiểm điều kiện khởi động động cơ');

  const z = () => new Array<number>(n).fill(0);
  const s: DispatchSeries = { t, pvPotentialWh: z(), clipWh: z(), pvBusWh: z(), loadRequestedWh: z(), loadServedWh: z(), gridImportWh: z(), unservedWh: z(), chargeBusWh: z(), dischargeBusWh: z(),
    eEndWh: z(), socEnd: z(), exportWh: z(), curtailedWh: z(), inverterLossWh: z(), chargeLossWh: z(), dischargeLossWh: z(), standbyWh: z(),
    branchPotentialWh: z(), branchServedWh: z(), branchCurtailedWh: z(), residualWh: z(), reasons: z() };
  const lt = loads.map((l) => ({ l, requested: 0, served: 0, grid: 0, unserved: 0, short: 0, starts: 0, blocked: 0, vol: 0, op: l.pump ? operatingPoint(l.pump.curve, l.pump.staticHeadM, l.pump.frictionK) : null }));
  const order = lt.map((x, i) => i).sort((a, b) => loads[a].priority - loads[b].priority || a - b);
  const startChecks: StartCheck[] = [];
  let startCheckCount = 0;
  const outage = new Set(policy.outageLocalHours);
  const gridUp = (h: number) => policy.gridAvailable && !outage.has(h);

  let E = bank ? Math.min(Math.max(policy.soc0, 0), 1) * cap : 0;
  const eStart = E;
  let worst = 0, worstStep = 0;
  const yieldEvery = hooks.yieldEvery ?? 1000;

  for (let i = 0; i < n; i++) {
    if (i % yieldEvery === 0) {
      if (hooks.isCancelled?.()) return null;
      hooks.onProgress?.(i, n);
      await new Promise<void>((r) => setTimeout(r, 0));
    }
    let mask = 0;
    const hour = localHour(t[i], input.timeZone), E0 = E;
    const pot = input.bus.pvPotentialW[i] * dt, pvBus = input.bus.pvBusW[i] * dt, clip = Math.max(0, pot - pvBus);
    if (clip > 1e-9) mask |= BIT.CLIPPED_PV;
    let availPV = pvBus;
    const up = gridUp(hour);

    // battery capability this step, bus side (energy that can be delivered to the bus)
    let disAvail = 0, disReason = 0;
    if (bank) {
      const byPower = dischargeCapW * dt, byEnergy = Math.max(0, E - eMin) * etaD;
      disAvail = Math.min(byPower, byEnergy);
      // what stops the bank from giving more: the reserve, or a current limit (BMS or inverter, whichever is lower)
      disReason = byEnergy <= byPower ? BIT.RESERVE_REACHED : bmsDis <= invDis ? BIT.DISCHARGE_LIMIT_BMS : BIT.DISCHARGE_LIMIT_INVERTER;
    } else mask |= BIT.NO_BATTERY;
    let dischargeBus = 0;

    // 1. standby: PV first, then battery
    const standby = inv.efficiency > 0 ? policy.standbyW * dt : 0;
    const sbPV = Math.min(availPV, standby); availPV -= sbPV;
    const sbBat = Math.min(standby - sbPV, disAvail); disAvail -= sbBat; dischargeBus += sbBat;
    const standbyServed = sbPV + sbBat;
    if (standby > 0) mask |= BIT.STANDBY;

    // 2. loads by priority
    let acLeft = inv.acRatedW * dt, requestedTot = 0, servedTot = 0, gridTot = 0, unservedTot = 0, servedBusTot = 0, reqAll = 0, unservedBranch = 0;
    let branchPot = 0, branchLeft = 0, branchServed = 0;
    if (input.branch) { branchPot = input.branch.pvPotentialW[i] * dt; branchLeft = input.branch.pvW[i] * dt; }
    for (const k of order) {
      const L = lt[k], d = L.l, frac = d.fractions[hour];
      const req = d.powerW * frac * dt;
      L.requested += req; reqAll += req; requestedTot += d.feed === 'inverter' ? req : 0;
      if (req <= 0) continue;
      if (d.feed === 'controller') {
        const got = Math.min(req, branchLeft); branchLeft -= got; branchServed += got; L.served += got; L.unserved += req - got; unservedBranch += req - got;
        if (req - got > 1e-9) { mask |= BIT.UNSERVED_LOAD; L.short += dt; }
        if (L.op?.ok) L.vol += L.op.qM3h * dt * (got / req);
        continue;
      }
      // motor start: first active step after an idle step must be covered by the inverter's surge capability
      let blocked = false;
      const prev = i === 0 ? 0 : d.fractions[localHour(t[i - 1], input.timeZone)];
      if (d.startupW !== null && prev === 0) {
        startCheckCount++; L.starts++;
        const ok = inv.surgeW === null ? null : d.startupW <= inv.surgeW;
        if (startChecks.length < 500) startChecks.push({ loadId: d.id, step: i, requiredW: d.startupW, availableW: inv.surgeW, ok });
        if (ok === false) { blocked = true; L.blocked++; mask |= BIT.START_BLOCKED; }
      }
      let servedAC = 0, servedBus = 0;
      if (!blocked) {
        const want = Math.min(req, acLeft);
        if (want < req - 1e-9) mask |= BIT.INVERTER_AC_LIMIT;
        const needBus = want / eta, takePV = Math.min(availPV, needBus); availPV -= takePV;
        const takeBat = Math.min(needBus - takePV, disAvail); disAvail -= takeBat; dischargeBus += takeBat;
        servedBus = takePV + takeBat; servedAC = servedBus * eta; acLeft -= servedAC;
        if (takePV > 1e-9) mask |= BIT.PV_TO_LOAD;
        if (needBus - takePV - takeBat > 1e-9) mask |= disReason; // battery could not cover the rest
      }
      servedBusTot += servedBus;
      let grid = 0;
      if (req - servedAC > 1e-9) {
        if (up && policy.importAllowed) { grid = req - servedAC; mask |= BIT.GRID_IMPORT; }
        else if (policy.gridAvailable && !up) mask |= BIT.GRID_OUTAGE;
      }
      const unserved = req - servedAC - grid;
      if (unserved > 1e-9) { mask |= BIT.UNSERVED_LOAD; L.short += dt; }
      L.served += servedAC + grid; L.grid += grid; L.unserved += unserved;
      servedTot += servedAC; gridTot += grid; unservedTot += unserved;
      if (L.op?.ok) L.vol += L.op.qM3h * dt * ((servedAC + grid) / req);
    }
    const branchCurt = Math.max(0, branchPot - branchServed);
    if (input.branch && branchCurt > 1e-9) mask |= BIT.PUMP_BRANCH_CURTAILED;

    // 3. leftover PV: charge, then export or curtail. A bank that discharged this step does not charge.
    let chargeBus = 0, exportBus = 0, curtBus = 0;
    if (availPV > 1e-9) {
      if (bank && dischargeBus <= 1e-9) {
        const byPower = chargeCapW * dt, byRoom = Math.max(0, eMax - E) / etaC;
        chargeBus = Math.min(availPV, byPower, byRoom);
        if (availPV - chargeBus > 1e-9) {
          if (byRoom <= byPower + 1e-9 && chargeBus >= byRoom - 1e-9) mask |= BIT.BATTERY_FULL;
          else mask |= bmsCharge <= invCharge ? BIT.CHARGE_LIMIT_BMS : BIT.CHARGE_LIMIT_INVERTER;
        }
        if (chargeBus > 1e-9) mask |= BIT.BATTERY_CHARGE;
      }
      const left = availPV - chargeBus;
      if (left > 1e-9) {
        if (policy.gridAvailable && up && policy.exportAllowed) { exportBus = Math.min(left, Math.max(0, acLeft) / eta); if (exportBus > 1e-9) mask |= BIT.EXPORT; }
        else mask |= policy.gridAvailable && !up ? BIT.GRID_OUTAGE : BIT.EXPORT_FORBIDDEN;
        curtBus = left - exportBus;
        if (curtBus > 1e-9) mask |= BIT.CURTAILED_PV;
      }
    }
    if (dischargeBus > 1e-9) mask |= BIT.BATTERY_DISCHARGE;

    // 4. battery energy: E_end = E_start + ηc·charge − discharge/ηd
    const stored = etaC * chargeBus, drawn = dischargeBus / etaD;
    E = E + stored - drawn;
    const invLoss = (servedBusTot + exportBus) * (1 - eta), chLoss = chargeBus * (1 - etaC), disLoss = drawn - dischargeBus;
    const exportAC = exportBus * eta;
    const curtailedTotal = clip + curtBus + branchCurt;

    // 5. ledger
    const lhs = pot + branchPot + gridTot + E0;
    const rhs = servedTot + gridTot + branchServed + exportAC + curtailedTotal + invLoss + chLoss + disLoss + standbyServed + E;
    const residual = lhs - rhs;
    const m = Math.max(pot + branchPot, gridTot, E0, E, reqAll, 1);
    if (Math.abs(residual) > tol(m)) throw new LedgerError(i, residual);
    if (Math.abs(residual) > worst) { worst = Math.abs(residual); worstStep = i; }

    s.pvPotentialWh[i] = pot; s.clipWh[i] = clip; s.pvBusWh[i] = pvBus; s.loadRequestedWh[i] = reqAll; s.loadServedWh[i] = servedTot + gridTot + branchServed; s.gridImportWh[i] = gridTot; s.unservedWh[i] = unservedTot + unservedBranch;
    s.chargeBusWh[i] = chargeBus; s.dischargeBusWh[i] = dischargeBus; s.eEndWh[i] = E; s.socEnd[i] = cap > 0 ? E / cap : 0; s.exportWh[i] = exportAC; s.curtailedWh[i] = clip + curtBus;
    s.inverterLossWh[i] = invLoss; s.chargeLossWh[i] = chLoss; s.dischargeLossWh[i] = disLoss; s.standbyWh[i] = standbyServed;
    s.branchPotentialWh[i] = branchPot; s.branchServedWh[i] = branchServed; s.branchCurtailedWh[i] = branchCurt; s.residualWh[i] = residual; s.reasons[i] = mask;
  }
  hooks.onProgress?.(n, n);

  // ---- totals and metrics -----------------------------------------------------------------------------------
  const T: DispatchTotals = {
    pvPotentialWh: sumOf(s.pvPotentialWh), clipWh: sumOf(s.clipWh), pvBusWh: sumOf(s.pvBusWh), branchPotentialWh: sumOf(s.branchPotentialWh), branchServedWh: sumOf(s.branchServedWh), branchCurtailedWh: sumOf(s.branchCurtailedWh),
    loadRequestedWh: sumOf(s.loadRequestedWh), loadServedWh: sumOf(s.loadServedWh),
    gridImportWh: sumOf(s.gridImportWh), unservedWh: sumOf(s.unservedWh), exportWh: sumOf(s.exportWh), curtailedWh: sumOf(s.curtailedWh) + sumOf(s.branchCurtailedWh),
    chargeBusWh: sumOf(s.chargeBusWh), dischargeBusWh: sumOf(s.dischargeBusWh), inverterLossWh: sumOf(s.inverterLossWh), chargeLossWh: sumOf(s.chargeLossWh), dischargeLossWh: sumOf(s.dischargeLossWh), standbyWh: sumOf(s.standbyWh),
    eStartWh: eStart, eEndWh: E, storedDeltaWh: E - eStart,
  };
  const reasonTotals: DispatchResult['reasonTotals'] = {};
  REASONS.forEach((r, bit) => {
    const steps = s.reasons.filter((m) => m & (1 << bit)).length;
    if (!steps) return;
    const wh: Partial<Record<Reason, number>> = { PV_TO_LOAD: undefined, BATTERY_CHARGE: T.chargeBusWh, BATTERY_DISCHARGE: T.dischargeBusWh, GRID_IMPORT: T.gridImportWh, EXPORT: T.exportWh, CURTAILED_PV: T.curtailedWh - T.clipWh, CLIPPED_PV: T.clipWh, UNSERVED_LOAD: T.unservedWh, PUMP_BRANCH_CURTAILED: T.branchCurtailedWh };
    reasonTotals[r] = { steps, wh: wh[r] ?? null };
  });

  const pvTotal = T.pvPotentialWh + T.branchPotentialWh;
  const first = (pred: (i: number) => boolean) => { for (let i = 0; i < n; i++) if (pred(i)) return t[i]; return null; };
  let minSoc: number | null = null, minAt: number | null = null;
  if (bank) s.socEnd.forEach((v, i) => { if (minSoc === null || v < minSoc) { minSoc = v; minAt = t[i]; } });
  const mk = monthTotals(t, stepSeconds, input.timeZone, s.pvBusWh, s.branchPotentialWh.map((_, i) => s.branchServedWh[i]));
  const full = mk.filter((m) => m.steps >= m.expectedSteps * 0.9);
  const low = full.length ? full.reduce((a, b) => (b.wh < a.wh ? b : a)) : null;
  const metrics: DispatchMetrics = {
    servedRatio: T.loadRequestedWh > 0 ? T.loadServedWh / T.loadRequestedWh : null, servedRatioNote: T.loadRequestedWh > 0 ? null : 'Không có tải được yêu cầu: không tính được tỉ lệ đáp ứng',
    hoursShort: countShortSteps(s) * dt, pvUtilization: pvTotal > 0 ? (pvTotal - T.curtailedWh - T.exportWh) / pvTotal : null,
    autonomy: T.loadRequestedWh > 0 ? (T.loadServedWh - T.gridImportWh) / T.loadRequestedWh : null, minSoc, minSocAt: minAt,
    firstReserveAt: bank ? first((i) => s.socEnd[i] <= bank.socMin + 1e-9) : null, firstShortageAt: first((i) => s.unservedWh[i] > 1e-6 || (s.reasons[i] & BIT.UNSERVED_LOAD) !== 0),
    lowestSunMonth: low ? { month: low.month, pvKWh: low.wh / 1000 } : null, socStart: bank ? eStart / cap : null, socEnd: bank ? E / cap : null,
  };
  return {
    version: DISPATCH_VERSION, inputHash, period: { startUtc: new Date(t[0] * 1000).toISOString(), endUtc: new Date((t[n - 1] + stepSeconds) * 1000).toISOString(), stepSeconds, n },
    series: s, totals: T, metrics, reasonTotals, startChecks, startCheckCount,
    loads: lt.map((x) => ({ id: x.l.id, label: x.l.label, feed: x.l.feed, requestedWh: x.requested, servedWh: x.served, gridWh: x.grid, unservedWh: x.unserved, hoursShort: x.short, starts: x.starts, startsBlocked: x.blocked,
      volumeM3: x.l.pump ? (x.op?.ok ? x.vol : null) : null, volumeNote: x.l.pump ? (x.op?.ok ? `Q = ${x.op.qM3h.toFixed(2)} m³/h tại cột áp ${x.op.headM.toFixed(1)} m` : x.op?.message ?? null) : null })),
    ledger: { maxResidualWh: worst, toleranceOk: true, worstStep }, assumptions, skipped,
  };
}

const countShortSteps = (s: DispatchSeries) => s.reasons.filter((m) => m & BIT.UNSERVED_LOAD).length;

/** Per local calendar month: PV energy at the bus (+ served pump branch) and how many steps it covers, for "least sunny month". */
function monthTotals(t: number[], step: number, tz: string, pvBus: number[], branchServed: number[]) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' });
  const by = new Map<string, { month: string; wh: number; steps: number; expectedSteps: number }>();
  for (let i = 0; i < t.length; i++) {
    const [y, m] = fmt.format(new Date((t[i] + step / 2) * 1000)).split('-');
    const key = `${y}-${m}`;
    let r = by.get(key);
    if (!r) { r = { month: key, wh: 0, steps: 0, expectedSteps: new Date(Date.UTC(Number(y), Number(m), 0)).getUTCDate() * (86400 / step) }; by.set(key, r); }
    r.wh += pvBus[i] + branchServed[i]; r.steps++;
  }
  return [...by.values()];
}
