import type { ProgressItem } from '../app/progress';
import { h } from './dom';
import type { Target } from './route';

const STATUS: Record<ProgressItem['status'], string> = { done: 'đã xong', todo: 'chưa xong', optional: 'chưa có' };

/** The nine steps at the top of the panel; each step not done yet has one button that goes where it is done. */
export function renderChecklist(items: ProgressItem[], go: (t: Target) => void, open: boolean): HTMLElement {
  return h('details', { id: 'checklist', open },
    h('summary', {}, `Còn ${items.filter((i) => i.status === 'todo').length} bước`),
    h('ol', {}, ...items.map((i) => h('li', { 'data-progress': i.id, 'data-status': i.status },
      `${i.label} · `, h('span', { className: 'checklist-status' }, STATUS[i.status]), ' ',
      i.status !== 'done' && h('button', { id: `do-${i.id}`, type: 'button', onClick: () => go(i.action) }, i.action.label)))));
}
