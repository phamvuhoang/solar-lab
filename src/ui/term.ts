import { GLOSSARY } from '../lessons/glossary';
import { h } from './dom';

/**
 * "… là gì?" for a glossary term: the plain words at every depth, the precise definition added at Kỹ sư. Like all detail the
 * depth is applied by the stylesheet (data-min-depth), so switching depth shows it without a repaint.
 */
export function term(id: string): HTMLElement {
  const t = GLOSSARY.find((x) => x.id === id);
  if (!t) throw new Error(`UNKNOWN_TERM ${id}`);
  return h('details', { className: 'term', 'data-term': id }, h('summary', {}, `${t.term} là gì?`),
    h('p', {}, t.basic), h('p', { 'data-min-depth': 'ky-su' }, t.engineer));
}
