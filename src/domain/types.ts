import type { Kind, Provenance } from './specs';

export interface Ref { modelId: string; revision: number }
export interface SpecCell { v: number | null; u: string; p: Provenance; src?: string }
export interface Component {
  schemaVersion: 1; modelId: string; revision: number; sku: string | null; brand: string; name: string;
  kind: Kind; condition: 'new' | 'used'; specs: Record<string, SpecCell>; attrs: Record<string, string>;
  datasheet: { url: string; page: number | null; checkedAt: string | null } | null;
  review: 'unreviewed' | 'reviewed'; author: string; editedAt: string; derivedFrom: Ref | null; notes?: string;
}
export interface Offer {
  schemaVersion: 1; offerId: string; componentRef: Ref; seller: string; recordedAt: string | null; region: string | null;
  priceMinor: string | null; currency: 'VND'; unit: 'piece' | 'W' | 'm' | 'set';
  tiers: { minQty: number; priceMinor: string }[]; vat: 'included' | 'excluded' | 'unknown';
  condition: 'new' | 'used'; shippingMinor: string | null; warrantyMonths: number | null; validUntil: string | null;
  label: string; notes?: string;
}
export interface Instance { instanceId: string; kind: Kind; label: string; componentRef: Ref | null }
export const CATEGORIES = ['equipment', 'frame', 'cable', 'protection', 'labor', 'shipping', 'discount', 'other'] as const;
export type Category = (typeof CATEGORIES)[number];
export type VatMode = 'included' | 'excluded' | 'unknown';
/** Extra cost line not derived from the diagram. qty is pieces, or millimetres when qtyUnit = 'mm' (price is then per metre). */
export interface CostLine {
  lineId: string; category: Category; label: string; qty: number; qtyUnit: 'piece' | 'mm';
  unitPriceMinor: string | null; vat: VatMode; seller: string | null; recordedAt: string | null; note?: string;
}
/** A kit prices a bundle: its parts still count as devices, but the kit price replaces their own prices. */
export interface Kit {
  kitId: string; label: string; count: number; parts: { componentRef: Ref; qty: number }[];
  priceMinor: string | null; vat: VatMode; seller: string | null; recordedAt: string | null; covers: Category[]; note?: string;
}
/** A series string of panels. `target` is an MPPT input (inverter) or PV input (controller). Order of panelIds is the series order. */
export interface StringDef { stringId: string; label: string; panelIds: string[]; target: { instanceId: string; port: string } | null }
/** Design assumptions behind the electrical checks. null = not decided, so dependent checks stay unknown. */
export interface DesignSettings {
  coldCellTempC: number | null; hotCellTempC: number | null; iscFactor: number;
  /** Used only when a panel has no βVmp. Never derived from βPmax. */
  betaVmpAssumption: number | null; source: string;
}
export interface QuoteSettings { vatRateBp: number; requiredCategories: Category[]; waived: Category[] }

export interface Project {
  schemaVersion: 1; projectId: string; revision: number; name: string; createdAt: string; updatedAt: string;
  location: { latitude: number; longitude: number; timezone: string } | null;
  instances: Instance[]; edges: { edgeId: string; from: { instanceId: string; port: string }; to: { instanceId: string; port: string } }[];
  roofFaces: object[]; priceSelections: { componentRef: Ref; offerId: string }[];
  snapshots: { components: Component[]; offers: Offer[] };
  costLines?: CostLine[]; kits?: Kit[]; quote?: Partial<QuoteSettings>;
  strings?: StringDef[]; design?: Partial<DesignSettings>;
}
export type Technical = Omit<Component, 'revision' | 'author' | 'editedAt' | 'review' | 'derivedFrom' | 'notes'>;
export const refKey = (r: Ref) => `${r.modelId}@${r.revision}`;
