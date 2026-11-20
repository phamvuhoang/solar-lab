import type { AutoState } from '../app/auto-sim';
import type { Project } from '../domain/types';
import { formatKWh } from '../domain/units';
import { buildQuote } from '../cost/quote';
import { simPolicyOf } from '../engine/sim-compile';
import { simMetrics } from '../reports/package';
import { displayStatus, STATUS_LABEL, validateDesign, type Status } from '../validation/strings';
import { h } from './dom';
import type { Target } from './route';

export type CellKey = 'electric' | 'pv' | 'supply' | 'money';
export interface HealthCell { key: CellKey; state: Status; text: string; missing: string | null; target: Target }

const NOT_RUN = 'chưa chạy thử';

function electric(p: Project): HealthCell {
  let target: Target = { step: 'dau-noi', tab: 'thiet-ke', focusId: 'findings' };
  if (!p.instances.length) return { key: 'electric', state: 'unknown', text: 'Điện: chưa có thiết bị', missing: null, target };
  const fs = validateDesign(p), of = (st: Status) => fs.filter((f) => displayStatus(f) === st);
  const err = of('fail').length, lim = of('limited').length, unknowns = of('unknown');
  const state: Status = err ? 'fail' : lim ? 'limited' : unknowns.length ? 'unknown' : 'pass';
  // one click to the worst check's detail (its formula and the source of every number, Kỹ sư lines): the first with the cell's status
  const worst = fs.find((f) => f.status !== 'pass' && displayStatus(f) === state);
  if (worst) target = { ...target, focusId: 'finding-detail', select: worst.objectIds[0] };
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
  // "đạt" only when the quote can state its full total; every reason it cannot is in the text (Cơ bản has no line table)
  const n = q.missing.lineKeys.length + q.missing.scope.length, vat = q.missing.unknownVatKeys.length;
  const kitOver = q.issues.some((i) => i.code === 'KIT_PART_NOT_IN_DESIGN');
  return {
    key: 'money', state: q.complete ? 'pass' : 'unknown', target, missing: null,
    text: `${Number(q.knownSubtotalMinor).toLocaleString('vi-VN')} đ đã biết${n ? ` · thiếu ${n} giá` : ''}${vat ? ` · ${vat} dòng chưa rõ VAT` : ''}${kitOver ? ' · kit ghi nhiều linh kiện hơn thiết kế có' : ''}${q.lines.length ? '' : ' · chưa có dòng nào'}`,
  };
}

const PV: Target = { step: 'chay-thu', tab: 'pv' }, SYSTEM: Target = { step: 'chay-thu', tab: 'he-thong' };
/** Where a finished run's numbers are on the system screen: the same ☀ number (every depth); the energy ledger (Kỹ sư), else "Đủ điện …". */
const PV_SOURCE: Target = { ...SYSTEM, focusId: 'sim-pv-total' }, SUPPLY_SOURCE: Target = { ...SYSTEM, focusId: ['sim-ledger', 'sim-days'] };

/** A run's PV energy for the year as the bar and the system screen (#sim-pv-total) both write it: every string, the pump branch's too. */
export const pvYear = (wh: number) => `${(wh / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} MWh/năm`;

/** PV and supply from the automatic run: never an old number while a new one is being computed. */
function live(p: Project, auto: AutoState): [HealthCell, HealthCell] {
  const cells = (state: Status, pv: string, supply: string, missing: string | null, at?: Target): [HealthCell, HealthCell] => [
    { key: 'pv', state, text: `☀ ${pv}`, missing, target: at ?? PV },
    { key: 'supply', state, text: `Cấp điện: ${supply}`, missing, target: at ?? SYSTEM }];
  if (auto.kind === 'idle') return cells('unknown', 'chưa chạy', 'chưa chạy', NOT_RUN);
  if (auto.kind === 'running') return cells('unknown', 'đang tính lại…', 'đang tính lại…', null);
  if (auto.kind === 'blocked') return cells('unknown', auto.message, auto.message, auto.message, auto.target);
  const m = simMetrics(auto.result), hours = m['metrics.hoursShort'] ?? 0;
  const grid = simPolicyOf(p).gridAvailable ? ` · mua lưới ${formatKWh(m['dispatch.gridImportWh'] ?? 0)} kWh` : '';
  return [
    { key: 'pv', state: 'pass', text: `☀ ${pvYear(m['pv.eInverterWh'] ?? 0)}${auto.shadePreview ? ' (bóng: xem trước)' : ''}`, missing: null, target: PV_SOURCE },
    { key: 'supply', state: hours > 0 ? 'limited' : 'pass', text: `Cấp điện: thiếu ${hours.toLocaleString('vi-VN', { maximumFractionDigits: 1 })} giờ/năm${grid}`, missing: null, target: SUPPLY_SOURCE }];
}

/** Always four cells: electric, pv, supply, money. Without `auto` PV and supply have not run. */
export function healthOf(p: Project, auto: AutoState = { kind: 'idle' }): HealthCell[] {
  return [electric(p), ...live(p, auto), money(p)];
}

/**
 * The bar is one live region, built once by the workspace: a paint creates the four cells the first time, then changes only
 * text that changed, so a screen reader hears the news and not the whole bar again.
 */
export function paintHealthBar(bar: HTMLElement, cells: HealthCell[], go: (t: Target) => void): void {
  const set = (el: Element, text: string) => { if (el.textContent !== text) el.textContent = text; };
  for (const c of cells) {
    let b = bar.querySelector<HTMLButtonElement>(`#health-${c.key}`);
    if (!b) bar.append(b = h('button', { id: `health-${c.key}`, type: 'button' }, h('span', { className: 'health-text' }), h('span', { className: 'health-state' })));
    b.dataset.state = c.state;
    if (c.missing) b.title = c.missing; else b.removeAttribute('title');
    b.onclick = () => go(c.target);
    set(b.children[0], c.text); set(b.children[1], STATUS_LABEL[c.state]);
  }
}
