import { newId, nowIso } from '../domain/ids';
import { refKey, type Category, type CostLine, type Offer, type Project, type Ref } from '../domain/types';

/** Pure project edits used by the quote screen. Each returns a new project; saving makes the revision. */
export function setQuantity(p: Project, ref: Ref, n: number): Project {
  if (!Number.isInteger(n) || n < 0) throw new Error('INVALID_QUANTITY');
  const next = structuredClone(p);
  const c = next.snapshots.components.find((x) => refKey(x) === refKey(ref));
  if (!c) throw new Error('UNKNOWN_COMPONENT');
  const have = next.instances.filter((i) => i.componentRef && refKey(i.componentRef) === refKey(ref));
  if (n > have.length) {
    const sameKind = next.instances.filter((i) => i.kind === c.kind).length;
    for (let k = 0; k < n - have.length; k++)
      next.instances.push({ instanceId: newId('ins'), kind: c.kind, label: `${c.name} #${sameKind + k + 1}`, componentRef: { modelId: ref.modelId, revision: ref.revision } });
  } else {
    const drop = new Set(have.slice(n).map((i) => i.instanceId));
    next.instances = next.instances.filter((i) => !drop.has(i.instanceId));
  }
  return next;
}

export function selectOffer(p: Project, offer: Offer): Project {
  const next = structuredClone(p);
  if (!next.snapshots.offers.some((o) => o.offerId === offer.offerId)) next.snapshots.offers.push(structuredClone(offer));
  next.priceSelections = next.priceSelections.filter((s) => refKey(s.componentRef) !== refKey(offer.componentRef));
  next.priceSelections.push({ componentRef: offer.componentRef, offerId: offer.offerId });
  return next;
}

export function addCostLine(p: Project, line: Omit<CostLine, 'lineId'>): Project {
  const next = structuredClone(p);
  next.costLines = [...(next.costLines ?? []), { ...line, lineId: newId('lin') }];
  return next;
}
export function removeCostLine(p: Project, lineId: string): Project {
  const next = structuredClone(p);
  next.costLines = (next.costLines ?? []).filter((l) => l.lineId !== lineId);
  return next;
}
export function setQuoteSettings(p: Project, patch: { vatRateBp?: number; waived?: Category[] }): Project {
  return { ...structuredClone(p), quote: { ...p.quote, ...patch } };
}
export const today = () => nowIso().slice(0, 10);
