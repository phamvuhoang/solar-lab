import type { AutoState } from '../app/auto-sim';
import type { Project } from '../domain/types';
import { formatKWh } from '../domain/units';
import { buildQuote } from '../cost/quote';
import { simPolicyOf } from '../engine/sim-compile';
import { simMetrics } from '../reports/package';
import { validateDesign, type Status } from '../validation/strings';
import { h } from './dom';
import type { Target } from './route';

export type CellKey = 'electric' | 'pv' | 'supply' | 'money';
export interface HealthCell { key: CellKey; state: Status; text: string; missing: string | null; target: Target }

export const STATE_LABEL: Record<Status, string> = { pass: 'đạt', fail: 'có lỗi', limited: 'bị giới hạn', unknown: 'chưa đủ dữ liệu' };

const NOT_RUN = 'chưa chạy thử';

function electric(p: Project): HealthCell {
  let target: Target = { step: 'dau-noi', tab: 'thiet-ke', focusId: 'findings' };
  if (!p.instances.length) return { key: 'electric', state: 'unknown', text: 'Điện: chưa có thiết bị', missing: null, target };
  const fs = validateDesign(p), worst = fs.find((f) => f.status !== 'pass'); // sorted worst first
  // one click to the worst check's detail: its formula and the source of every number (Kỹ sư lines)
  if (worst) target = { ...target, focusId: 'finding-detail', select: worst.objectIds[0] };
  const err = fs.filter((f) => f.status === 'fail' && f.severity === 'error').length;
  const lim = fs.filter((f) => f.status === 'limited').length;
  const unknowns = fs.filter((f) => f.status === 'unknown' || (f.status === 'fail' && f.severity !== 'error'));
  const state: Status = err ? 'fail' : lim ? 'limited' : unknowns.length ? 'unknown' : 'pass';
  return {
    key: 'electric', state, target,
    text: `Điện: ${err} lỗi · ${lim} giới hạn · ${unknowns.length} chưa đủ dữ liệu`,
    missing: state === 'unknown' ? unknowns[0].message : null,
  };
}

function money(p: Project): HealthCell {
  const target: Target = { step: 'chi-phi', tab: 'du-toan', focusId: ['quote-lines', 'quote-total'] }; // the lines with seller and date; Cơ bản: what is missing
  if (!p.instances.length) return { key: 'money', state: 'unknown', text: 'Tiền: chưa có thiết bị', missing: null, target };
  const q = buildQuote(p);
  const n = q.missing.lineKeys.length + q.missing.scope.length;
  return {
    key: 'money', state: n ? 'unknown' : 'pass', target, missing: null,
    text: `${Number(q.knownSubtotalMinor).toLocaleString('vi-VN')} đ đã biết${n ? ` · thiếu ${n} giá` : ''}`,
  };
}

const PV: Target = { step: 'chay-thu', tab: 'pv' }, SYSTEM: Target = { step: 'chay-thu', tab: 'he-thong' };
/** Where a finished run's numbers come from: the run's assumptions; the energy ledger (Kỹ sư), else "Đủ điện …" (every depth). */
const PV_SOURCE: Target = { ...SYSTEM, focusId: 'sim-assumptions' }, SUPPLY_SOURCE: Target = { ...SYSTEM, focusId: ['sim-ledger', 'sim-days'] };

/** PV and supply from the automatic run: never an old number while a new one is being computed. */
function live(p: Project, auto: AutoState): [HealthCell, HealthCell] {
  const cells = (state: Status, pv: string, supply: string, missing: string | null, at?: Target): [HealthCell, HealthCell] => [
    { key: 'pv', state, text: `☀ ${pv}`, missing, target: at ?? PV },
    { key: 'supply', state, text: `Cấp điện: ${supply}`, missing, target: at ?? SYSTEM }];
  if (auto.kind === 'idle') return cells('unknown', 'chưa chạy', 'chưa chạy', NOT_RUN);
  if (auto.kind === 'running') return cells('unknown', 'đang tính lại…', 'đang tính lại…', null);
  if (auto.kind === 'blocked') return cells('unknown', auto.message, auto.message, auto.message, auto.target);
  const m = simMetrics(auto.result), hours = m['metrics.hoursShort'] ?? 0;
  const mwh = ((m['pv.eInverterWh'] ?? 0) / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 2 });
  const grid = simPolicyOf(p).gridAvailable ? ` · mua lưới ${formatKWh(m['dispatch.gridImportWh'] ?? 0)} kWh` : '';
  return [
    { key: 'pv', state: 'pass', text: `☀ ${mwh} MWh/năm${auto.shadePreview ? ' (bóng: xem trước)' : ''}`, missing: null, target: PV_SOURCE },
    { key: 'supply', state: hours > 0 ? 'limited' : 'pass', text: `Cấp điện: thiếu ${hours.toLocaleString('vi-VN', { maximumFractionDigits: 1 })} giờ/năm${grid}`, missing: null, target: SUPPLY_SOURCE }];
}

/** Always four cells: electric, pv, supply, money. Without `auto` PV and supply have not run. */
export function healthOf(p: Project, auto: AutoState = { kind: 'idle' }): HealthCell[] {
  return [electric(p), ...live(p, auto), money(p)];
}

export function renderHealth(cells: HealthCell[], go: (t: Target) => void): HTMLElement {
  return h('footer', { id: 'ws-health', 'aria-live': 'polite' }, ...cells.map((c) =>
    h('button', { id: `health-${c.key}`, type: 'button', 'data-state': c.state, title: c.missing ?? undefined, onclick: () => go(c.target) },
      h('span', { className: 'health-text' }, c.text),
      h('span', { className: 'health-state' }, STATE_LABEL[c.state]))));
}
