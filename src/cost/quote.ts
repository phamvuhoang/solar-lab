import { calculateBom } from './bom';
import { refKey, type Category, type CostLine, type Offer, type Project, type QuoteSettings, type Ref, type VatMode } from '../domain/types';
import type { Issue } from '../domain/validate';

/**
 * Quote = design lines (instances × selected offer) + kits + extra lines + per-offer delivery.
 * Money is VND whole đồng as BigInt. Every line is rounded half-up to đồng on its own, before summing
 * (policy recorded in `policy.rounding`). Summing the known lines goes through `calculateBom` (src/cost/bom.ts).
 */
export const DEFAULT_SETTINGS: QuoteSettings = { vatRateBp: 1000, requiredCategories: ['frame', 'cable', 'protection', 'labor'], waived: [] };
export const settingsOf = (p: Project): QuoteSettings => ({ ...DEFAULT_SETTINGS, ...p.quote });

export type LineStatus = 'known' | 'missing' | 'included-in-kit';
export type MissingReason = 'NO_OFFER' | 'NO_PRICE' | 'NO_WATTAGE' | 'OFFER_MISMATCH' | 'UNSUPPORTED_UNIT';
export interface QuoteLine {
  key: string; source: 'design' | 'kit' | 'extra' | 'offer-shipping'; category: Category; label: string;
  qty: number; qtyUnit: 'piece' | 'mm'; priceUnit: 'piece' | 'W' | 'm' | 'set'; unitPriceMinor: string | null;
  basis: string; /** non-negative; the sign is `sign` */ totalMinor: string | null; sign: 1 | -1;
  status: LineStatus; reason?: MissingReason; vat: VatMode; seller: string | null; recordedAt: string | null; note: string;
  kitId?: string; offerId?: string;
}
export interface Quote {
  policy: { rounding: 'half-up per line to whole đồng'; vatRateBp: number; currency: 'VND' };
  lines: QuoteLine[];
  deviceCounts: Record<string, number>;
  knownSubtotalMinor: string; vatMinor: string; shippingMinor: string; byCategory: Partial<Record<Category, string>>;
  missing: { lineKeys: string[]; scope: Category[]; unknownVatKeys: string[] };
  complete: boolean; totalMinor: string | null; issues: Issue[];
}

const WATT_KEY: Partial<Record<string, string>> = { panel: 'pstcW', inverter: 'acRatedW', controller: 'ratedW', load: 'powerW' };
/** Half-up division; negatives round by magnitude. */
export const roundDiv = (n: bigint, d: bigint): bigint => (n < 0n ? -((-n * 2n + d) / (2n * d)) : (n * 2n + d) / (2n * d));
export const signed = (l: Pick<QuoteLine, 'totalMinor' | 'sign'>) => (l.totalMinor === null ? 0n : BigInt(l.totalMinor) * BigInt(l.sign));

/** Which price applies: the highest tier whose minQty ≤ qty, else the list price. Separate from summing. */
export function selectTier(o: Pick<Offer, 'priceMinor' | 'tiers'>, qty: number): { priceMinor: string | null; tierMinQty: number | null } {
  const tier = [...o.tiers].sort((a, b) => b.minQty - a.minQty).find((t) => t.minQty <= qty);
  return tier ? { priceMinor: tier.priceMinor, tierMinQty: tier.minQty } : { priceMinor: o.priceMinor, tierMinQty: null };
}

const vnd = (n: string | bigint) => Number(n).toLocaleString('vi-VN');
const blank = (): Pick<QuoteLine, 'sign' | 'note' | 'seller' | 'recordedAt'> => ({ sign: 1, note: '', seller: null, recordedAt: null });

export function buildQuote(p: Project): Quote {
  const st = settingsOf(p);
  const comps = new Map(p.snapshots.components.map((c) => [refKey(c), c]));
  const offers = new Map(p.snapshots.offers.map((o) => [o.offerId, o]));
  const issues: Issue[] = [];
  const lines: QuoteLine[] = [];

  const groups = new Map<string, { ref: Ref; n: number }>();
  for (const i of p.instances) if (i.componentRef) {
    const k = refKey(i.componentRef);
    groups.set(k, { ref: i.componentRef, n: (groups.get(k)?.n ?? 0) + 1 });
  }
  const deviceCounts = Object.fromEntries([...groups].map(([k, g]) => [k, g.n]));

  // Kits take devices first; what they do not cover is priced individually.
  const left = new Map([...groups].map(([k, g]) => [k, g.n]));
  const inKit = new Map<string, { qty: number; kitId: string }>();
  (p.kits ?? []).forEach((kit, ki) => kit.parts.forEach((part, pi) => {
    const k = refKey(part.componentRef);
    const need = part.qty * kit.count, take = Math.min(need, left.get(k) ?? 0);
    left.set(k, (left.get(k) ?? 0) - take);
    if (take > 0) inKit.set(k, { qty: (inKit.get(k)?.qty ?? 0) + take, kitId: inKit.get(k)?.kitId ?? kit.kitId });
    if (take < need) issues.push({ code: 'KIT_PART_NOT_IN_DESIGN', severity: 'warning', field: `/kits/${ki}/parts/${pi}`,
      message: `Kit "${kit.label}" gồm ${need} × ${k} nhưng thiết kế chỉ có ${take}` });
  }));

  const usedOffers = new Set<string>();
  for (const [k, g] of groups) {
    const c = comps.get(k);
    const name = c?.name ?? g.ref.modelId;
    const kit = inKit.get(k);
    if (kit) lines.push({ ...blank(), key: `design:${k}:kit`, source: 'design', category: 'equipment', label: name, qty: kit.qty, qtyUnit: 'piece',
      priceUnit: 'piece', unitPriceMinor: null, basis: 'đã tính trong kit', totalMinor: '0', status: 'included-in-kit', vat: 'included', kitId: kit.kitId });
    const paid = left.get(k) ?? 0;
    if (paid === 0) continue;
    const sel = p.priceSelections.find((s) => refKey(s.componentRef) === k);
    const offer = sel && offers.get(sel.offerId);
    const base = { ...blank(), key: `design:${k}`, source: 'design' as const, category: 'equipment' as const, label: name, qty: paid, qtyUnit: 'piece' as const };
    const missing = (reason: MissingReason, priceUnit: QuoteLine['priceUnit'] = 'piece', extra: Partial<QuoteLine> = {}) =>
      lines.push({ ...base, priceUnit, unitPriceMinor: null, basis: '', totalMinor: null, status: 'missing', reason, vat: 'unknown', ...extra });
    if (!offer) { missing('NO_OFFER'); continue; }
    if (refKey(offer.componentRef) !== k) { missing('OFFER_MISMATCH', offer.unit === 'm' ? 'm' : offer.unit); continue; }
    usedOffers.add(offer.offerId);
    const common = { vat: offer.vat, seller: offer.seller, recordedAt: offer.recordedAt, note: offer.notes ?? '', offerId: offer.offerId };
    const { priceMinor, tierMinQty } = selectTier(offer, paid);
    if (priceMinor === null) { missing('NO_PRICE', offer.unit as QuoteLine['priceUnit'], common); continue; }
    const price = BigInt(priceMinor);
    const tierNote = tierMinQty ? ` (bậc ≥${tierMinQty})` : '';
    if (offer.unit === 'piece' || offer.unit === 'set') {
      lines.push({ ...base, ...common, priceUnit: offer.unit, unitPriceMinor: priceMinor, status: 'known',
        basis: `${paid} × ${vnd(priceMinor)} đ${tierNote}`, totalMinor: String(BigInt(paid) * price) });
    } else if (offer.unit === 'W') {
      const watts = c?.specs[WATT_KEY[c.kind] ?? '']?.v ?? null;
      if (watts === null) { missing('NO_WATTAGE', 'W', common); continue; }
      const milli = BigInt(Math.round(watts * 1000));
      lines.push({ ...base, ...common, priceUnit: 'W', unitPriceMinor: priceMinor, status: 'known',
        basis: `${paid} × ${watts} W × ${vnd(priceMinor)} đ/W${tierNote}`, totalMinor: String(roundDiv(BigInt(paid) * milli * price, 1000n)) });
    } else missing('UNSUPPORTED_UNIT', 'm', common);
  }

  (p.kits ?? []).forEach((kit) => {
    const known = kit.priceMinor !== null;
    lines.push({ key: `kit:${kit.kitId}`, source: 'kit', category: 'equipment', label: `Kit: ${kit.label}`, qty: kit.count, qtyUnit: 'piece', priceUnit: 'set',
      unitPriceMinor: kit.priceMinor, basis: known ? `${kit.count} × ${vnd(kit.priceMinor!)} đ` : '', totalMinor: known ? String(BigInt(kit.count) * BigInt(kit.priceMinor!)) : null,
      sign: 1, status: known ? 'known' : 'missing', reason: known ? undefined : 'NO_PRICE', vat: kit.vat, seller: kit.seller, recordedAt: kit.recordedAt,
      note: [kit.note, kit.parts.map((x) => `${x.qty}× ${refKey(x.componentRef)}`).join(', ')].filter(Boolean).join('; '), kitId: kit.kitId });
  });

  for (const l of p.costLines ?? []) lines.push(extraLine(l));

  for (const id of usedOffers) {
    const o = offers.get(id)!;
    if (o.shippingMinor === null) continue;
    lines.push({ ...blank(), key: `ship:${o.offerId}`, source: 'offer-shipping', category: 'shipping', label: `Giao hàng: ${o.seller}`, qty: 1, qtyUnit: 'piece',
      priceUnit: 'set', unitPriceMinor: o.shippingMinor, basis: `${vnd(o.shippingMinor)} đ`, totalMinor: o.shippingMinor, status: 'known',
      vat: o.vat, seller: o.seller, recordedAt: o.recordedAt, offerId: o.offerId });
  }

  return summarize(p, st, lines, deviceCounts, issues);
}

function extraLine(l: CostLine): QuoteLine {
  const known = l.unitPriceMinor !== null;
  let total: bigint | null = null;
  if (known) total = l.qtyUnit === 'mm' ? roundDiv(BigInt(l.qty) * BigInt(l.unitPriceMinor!), 1000n) : BigInt(l.qty) * BigInt(l.unitPriceMinor!);
  const qtyText = l.qtyUnit === 'mm' ? `${(l.qty / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 3 })} m` : String(l.qty);
  return {
    key: `extra:${l.lineId}`, source: 'extra', category: l.category, label: l.label, qty: l.qty, qtyUnit: l.qtyUnit, priceUnit: l.qtyUnit === 'mm' ? 'm' : 'piece',
    unitPriceMinor: l.unitPriceMinor, basis: known ? `${qtyText} × ${vnd(l.unitPriceMinor!)} đ${l.qtyUnit === 'mm' ? '/m' : ''}` : '',
    totalMinor: total === null ? null : String(total), sign: l.category === 'discount' ? -1 : 1, status: known ? 'known' : 'missing', reason: known ? undefined : 'NO_PRICE',
    vat: l.vat, seller: l.seller, recordedAt: l.recordedAt, note: l.note ?? '',
  };
}

function summarize(p: Project, st: QuoteSettings, lines: QuoteLine[], deviceCounts: Record<string, number>, issues: Issue[]): Quote {
  const known = lines.filter((l) => l.totalMinor !== null);
  // `calculateBom` does the summing (and rejects non-digit amounts); discounts are subtracted after.
  const plus = calculateBom(known.filter((l) => l.sign === 1).map((l) => ({ id: l.key, quantity: 1, priceMinor: l.totalMinor, currency: 'VND' })), 'VND');
  const minus = known.filter((l) => l.sign === -1).reduce((a, l) => a + BigInt(l.totalMinor!), 0n);
  const subtotal = BigInt(plus.totalMinor!) - minus;
  const rate = BigInt(st.vatRateBp);
  const vat = known.filter((l) => l.vat === 'excluded').reduce((a, l) => a + roundDiv(BigInt(l.totalMinor!) * rate, 10000n) * BigInt(l.sign), 0n);
  const byCat: Partial<Record<Category, bigint>> = {};
  for (const l of known) byCat[l.category] = (byCat[l.category] ?? 0n) + signed(l);

  const covered = new Set<Category>([...st.waived, ...lines.filter((l) => l.source === 'extra' && l.status === 'known').map((l) => l.category)]);
  (p.kits ?? []).filter((k) => k.priceMinor !== null).forEach((k) => k.covers.forEach((c) => covered.add(c)));
  const missing = {
    lineKeys: lines.filter((l) => l.status === 'missing').map((l) => l.key),
    scope: st.requiredCategories.filter((c) => !covered.has(c)),
    unknownVatKeys: known.filter((l) => l.vat === 'unknown' && l.totalMinor !== '0').map((l) => l.key),
  };
  // a kit that claims more parts than the design has would be charged in full for parts that do not exist: never report a total then
  const kitOver = issues.some((i) => i.code === 'KIT_PART_NOT_IN_DESIGN');
  const complete = !missing.lineKeys.length && !missing.scope.length && !missing.unknownVatKeys.length && lines.length > 0 && !kitOver;
  return {
    policy: { rounding: 'half-up per line to whole đồng', vatRateBp: st.vatRateBp, currency: 'VND' }, lines, deviceCounts,
    knownSubtotalMinor: String(subtotal), vatMinor: String(vat), shippingMinor: String(byCat.shipping ?? 0n),
    byCategory: Object.fromEntries(Object.entries(byCat).map(([k, v]) => [k, String(v)])), missing, complete,
    totalMinor: complete ? String(subtotal + vat) : null, issues,
  };
}

// ---- A/B -----------------------------------------------------------------------------------------------
export interface CompareRow { key: string; label: string; a: QuoteLine | null; b: QuoteLine | null; deltaMinor: string | null }
export interface Comparison {
  rows: CompareRow[];
  summary: Record<'knownSubtotal' | 'vat' | 'shipping', { a: string; b: string }>;
  missingCount: { a: number; b: number };
  /** B − A over known lines. Only published when both sides leave the same things unpriced. */
  knownDeltaMinor: string | null; knownDeltaReason?: 'SCOPE_DIFFERS';
  /** B − A of the full total. Only when both totals are complete. */
  totalDeltaMinor: string | null; totalDeltaReason?: 'INCOMPLETE';
}

export function compareQuotes(a: Quote, b: Quote): Comparison {
  const byKey = (q: Quote) => new Map(q.lines.map((l) => [l.key, l]));
  const [ma, mb] = [byKey(a), byKey(b)];
  const rows: CompareRow[] = [...new Set([...ma.keys(), ...mb.keys()])].map((key) => {
    const [la, lb] = [ma.get(key) ?? null, mb.get(key) ?? null];
    const unpriced = la?.status === 'missing' || lb?.status === 'missing';
    return { key, label: (lb ?? la)!.label, a: la, b: lb, deltaMinor: unpriced ? null : String((lb ? signed(lb) : 0n) - (la ? signed(la) : 0n)) };
  });
  const same = (x: string[], y: string[]) => x.length === y.length && [...x].sort().join('|') === [...y].sort().join('|');
  const sameScope = same(a.missing.lineKeys, b.missing.lineKeys) && same(a.missing.scope, b.missing.scope) && same(a.missing.unknownVatKeys, b.missing.unknownVatKeys);
  const pair = (f: (q: Quote) => string) => ({ a: f(a), b: f(b) });
  return {
    rows, missingCount: { a: a.missing.lineKeys.length, b: b.missing.lineKeys.length },
    summary: { knownSubtotal: pair((q) => q.knownSubtotalMinor), vat: pair((q) => q.vatMinor), shipping: pair((q) => q.shippingMinor) },
    knownDeltaMinor: sameScope ? String(BigInt(b.knownSubtotalMinor) - BigInt(a.knownSubtotalMinor)) : null,
    ...(sameScope ? {} : { knownDeltaReason: 'SCOPE_DIFFERS' as const }),
    totalDeltaMinor: a.totalMinor !== null && b.totalMinor !== null ? String(BigInt(b.totalMinor) - BigInt(a.totalMinor)) : null,
    ...(a.totalMinor !== null && b.totalMinor !== null ? {} : { totalDeltaReason: 'INCOMPLETE' as const }),
  };
}
