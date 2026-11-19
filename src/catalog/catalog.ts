import componentsJson from '../../data/catalog/components.json';
import offersJson from '../../data/catalog/offers.json';
import { capabilities } from '../domain/component';
import { refKey, type Component, type Offer, type Ref } from '../domain/types';
import type { Kind } from '../domain/specs';

/** Bundled, read-only catalog. User-made models live in IndexedDB, never here. */
export const BUILTIN_COMPONENTS = componentsJson as unknown as Component[];
export const BUILTIN_OFFERS = offersJson as unknown as Offer[];

export function filterComponents(list: readonly Component[], f: { kind?: Kind | 'all'; text?: string } = {}): Component[] {
  const t = f.text?.trim().toLowerCase();
  return list.filter((c) =>
    (!f.kind || f.kind === 'all' || c.kind === f.kind) &&
    (!t || `${c.brand} ${c.name} ${c.sku ?? ''}`.toLowerCase().includes(t)));
}

export const findComponent = (list: readonly Component[], r: Ref) => list.find((c) => refKey(c) === refKey(r));
export const offersFor = (list: readonly Offer[], r: Ref) => list.filter((o) => refKey(o.componentRef) === refKey(r));
export const summary = (c: Component) => capabilities(c).filter((s) => !s.ok);
