import type { Project } from '../domain/types';
import { buildQuote } from '../cost/quote';
import { validateDesign, type Status } from '../validation/strings';
import { h } from './dom';
import type { Target } from './route';

export type CellKey = 'electric' | 'pv' | 'supply' | 'money';
export interface HealthCell { key: CellKey; state: Status; text: string; missing: string | null; target: Target }

export const STATE_LABEL: Record<Status, string> = { pass: 'đạt', fail: 'có lỗi', limited: 'bị giới hạn', unknown: 'chưa đủ dữ liệu' };

const NOT_RUN = 'chưa chạy thử';

function electric(p: Project): HealthCell {
  const target: Target = { step: 'dau-noi', tab: 'thiet-ke', focusId: 'findings' };
  if (!p.instances.length) return { key: 'electric', state: 'unknown', text: 'Điện: chưa có thiết bị', missing: null, target };
  const fs = validateDesign(p);
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
  const target: Target = { step: 'chi-phi', tab: 'du-toan' };
  if (!p.instances.length) return { key: 'money', state: 'unknown', text: 'Tiền: chưa có thiết bị', missing: null, target };
  const q = buildQuote(p);
  const n = q.missing.lineKeys.length + q.missing.scope.length;
  return {
    key: 'money', state: n ? 'unknown' : 'pass', target, missing: null,
    text: `${Number(q.knownSubtotalMinor).toLocaleString('vi-VN')} đ đã biết${n ? ` · thiếu ${n} giá` : ''}`,
  };
}

/** Always four cells: electric, pv, supply, money. */
export function healthOf(p: Project): HealthCell[] {
  return [
    electric(p),
    { key: 'pv', state: 'unknown', text: '☀ chưa chạy', missing: NOT_RUN, target: { step: 'chay-thu', tab: 'pv' } },
    { key: 'supply', state: 'unknown', text: 'Cấp điện: chưa chạy', missing: NOT_RUN, target: { step: 'chay-thu', tab: 'he-thong' } },
    money(p),
  ];
}

export function renderHealth(cells: HealthCell[], go: (t: Target) => void): HTMLElement {
  return h('footer', { id: 'ws-health', 'aria-live': 'polite' }, ...cells.map((c) =>
    h('button', { id: `health-${c.key}`, type: 'button', 'data-state': c.state, title: c.missing ?? undefined, onclick: () => go(c.target) },
      h('span', { className: 'health-text' }, c.text),
      h('span', { className: 'health-state' }, STATE_LABEL[c.state]))));
}
