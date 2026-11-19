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
/** Site/array settings for the PV run. Orientation has no default: it must be declared. */
export interface PvSettings {
  tiltDeg: number; azimuthDeg: number; albedo: number; lossRatio: number;
  cellModel: 'faiman' | 'fixed'; fixedCellTempC: number | null; faimanU0: number; faimanU1: number; windFallbackMs: number | null;
  irradianceInput: 'auto' | 'components' | 'poa'; weatherId: string | null;
}
/** Dispatch policy. Every number here is a modelling choice and is echoed back in the result as an assumption. */
export interface SimPolicy {
  /** Reserve: the bank is never discharged below this SoC (ratio of nominal × SoH). */
  minSoc: number; soc0: number; etaCharge: number; etaDischarge: number;
  /** null = use the inverter's efficiencyMax from its datasheet. */
  inverterEfficiency: number | null; standbyW: number;
  gridAvailable: boolean; importAllowed: boolean; exportAllowed: boolean;
  /** Local clock hours (0–23) in which the grid is down every day. */
  outageLocalHours: number[];
}
/** When a load runs: fractions[h] = share of local hour h it is on. Power = component powerW × fraction. */
export interface LoadPlan {
  instanceId: string; fractions: number[]; priority: number;
  pump?: { staticHeadM: number | null; frictionK: number | null; curve: { qM3h: number[]; headM: number[] } | null };
}
/**
 * One planar roof face. World data is ENU in metres (East, North, Up). The face has its own frame (a, b):
 *   a = along the eave, to the viewer's right when looking at the face from outside;
 *   b = up the slope, along the surface.
 * `azimuthDeg` is the direction the face looks (down-slope), clockwise from North; `tiltDeg` its slope from horizontal.
 */
export interface RoofFace {
  roofFaceId: string; label: string;
  outline: [number, number][]; holes: [number, number][][];
  tiltDeg: number; azimuthDeg: number; origin: { e: number; n: number; up: number };
  /** Required clearance between a panel and the outline or a hole. */
  setbackM: number; setbackSource: 'assumption' | 'user';
}
/** A panel instance placed on a face: centre in the face frame, angleDeg 0 = long side up the slope (portrait), 90 = landscape. */
export interface Placement { instanceId: string; roofFaceId: string; center: [number, number]; angleDeg: number }
/** box: size = {x, y, z} footprint and height; cylinder: x = y = diameter, z = height. Free-standing unless roofFaceId is set. */
export interface Obstacle {
  obstacleId: string; label: string; kind: 'box' | 'cylinder'; roofFaceId: string | null;
  center: { e: number; n: number }; baseUp: number; angleDeg: number; size: { x: number; y: number; z: number };
}
export interface LayoutSettings { gridM: number; gapM: number }
export interface QuoteSettings { vatRateBp: number; requiredCategories: Category[]; waived: Category[] }

export interface Project {
  schemaVersion: 1; projectId: string; revision: number; name: string; createdAt: string; updatedAt: string;
  location: { latitude: number; longitude: number; timezone: string } | null;
  instances: Instance[]; edges: { edgeId: string; from: { instanceId: string; port: string }; to: { instanceId: string; port: string } }[];
  roofFaces: RoofFace[]; priceSelections: { componentRef: Ref; offerId: string }[];
  snapshots: { components: Component[]; offers: Offer[] };
  costLines?: CostLine[]; kits?: Kit[]; quote?: Partial<QuoteSettings>;
  strings?: StringDef[]; design?: Partial<DesignSettings>; pv?: Partial<PvSettings>;
  sim?: Partial<SimPolicy>; loadPlans?: LoadPlan[];
  placements?: Placement[]; obstacles?: Obstacle[]; layout?: Partial<LayoutSettings>;
}
export type Technical = Omit<Component, 'revision' | 'author' | 'editedAt' | 'review' | 'derivedFrom' | 'notes'>;
export const refKey = (r: Ref) => `${r.modelId}@${r.revision}`;
