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
export interface Project {
  schemaVersion: 1; projectId: string; revision: number; name: string; createdAt: string; updatedAt: string;
  location: { latitude: number; longitude: number; timezone: string } | null;
  instances: Instance[]; edges: { edgeId: string; from: { instanceId: string; port: string }; to: { instanceId: string; port: string } }[];
  roofFaces: object[]; priceSelections: { componentRef: Ref; offerId: string }[];
  snapshots: { components: Component[]; offers: Offer[] };
}
export type Technical = Omit<Component, 'revision' | 'author' | 'editedAt' | 'review' | 'derivedFrom' | 'notes'>;
export const refKey = (r: Ref) => `${r.modelId}@${r.revision}`;
