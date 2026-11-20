import Ajv, { type ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';
import componentSchema from '../../schemas/component-v1.json';
import offerSchema from '../../schemas/offer-v1.json';
import projectSchema from '../../schemas/project-v1.json';
import { RANGE_PAIRS, SPEC_DEFS } from './specs';
import { DIMS } from './units';
import { refKey, type Component, type Project, type Offer } from './types';

export interface Issue { code: string; severity: 'error' | 'warning' | 'info'; field: string; message: string }

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
ajv.addSchema(componentSchema);
ajv.addSchema(offerSchema);
const vProject = ajv.compile(projectSchema);
const vComponent = ajv.getSchema(componentSchema.$id)!;
const vOffer = ajv.getSchema(offerSchema.$id)!;

const fromAjv = (errs: ErrorObject[] | null | undefined, prefix = ''): Issue[] =>
  (errs ?? []).map((e) => ({
    code: 'SCHEMA', severity: 'error', field: prefix + e.instancePath,
    message: `${e.message}${e.params && 'additionalProperty' in e.params ? ': ' + e.params.additionalProperty : ''}`,
  }));

/** Electrical sanity of one component: units, ranges, cross-checks. Field is a JSON pointer. */
export function checkComponent(c: Component, prefix = ''): Issue[] {
  const out: Issue[] = [];
  const err = (code: string, field: string, message: string, severity: Issue['severity'] = 'error') =>
    out.push({ code, severity, field: prefix + field, message });
  const defs = SPEC_DEFS[c.kind];
  const val = (k: string) => c.specs[k]?.v ?? null;
  for (const [k, cell] of Object.entries(c.specs)) {
    const def = defs[k];
    if (!def) { err('UNKNOWN_SPEC', `/specs/${k}`, `Trường "${k}" không thuộc loại ${c.kind}`); continue; }
    if (cell.u !== DIMS[def.dim].base) err('UNIT_MISMATCH', `/specs/${k}/u`, `${def.label}: đơn vị lưu là "${DIMS[def.dim].base}", file ghi "${cell.u}"`);
    if (cell.v === null) continue;
    if (!Number.isFinite(cell.v)) err('NOT_FINITE', `/specs/${k}/v`, `${def.label}: không phải số hữu hạn`);
    else if (cell.v < 0 && !def.allowNegative) err('NEGATIVE', `/specs/${k}/v`, `${def.label}: không được âm`);
    else if (def.dim === 'count' && !Number.isInteger(cell.v)) err('NOT_INTEGER', `/specs/${k}/v`, `${def.label}: cần số nguyên`);
    else if (def.dim === 'ratio' && cell.v > 1) err('RATIO_RANGE', `/specs/${k}/v`, `${def.label}: tỉ lệ phải trong 0..1 (đang ${cell.v})`);
    else if (def.dim === 'coef' && Math.abs(cell.v) > 0.05) err('COEF_RANGE', `/specs/${k}/v`, `${def.label}: |hệ số| > 5%/°C, kiểm tra đơn vị`);
  }
  for (const [kind, lo, hi] of RANGE_PAIRS) {
    if (kind !== c.kind) continue;
    const a = val(lo), b = val(hi);
    if (a !== null && b !== null && a > b) err('RANGE_INVERTED', `/specs/${lo}/v`, `${defs[lo].label} (${a}) lớn hơn ${defs[hi].label} (${b})`);
  }
  if (c.kind === 'panel') {
    const [voc, vmp, isc, imp, p] = ['vocV', 'vmpV', 'iscA', 'impA', 'pstcW'].map(val);
    if (voc !== null && vmp !== null && voc <= vmp) err('VOC_NOT_ABOVE_VMP', '/specs/vocV/v', `Voc (${voc}) phải lớn hơn Vmp (${vmp})`);
    if (isc !== null && imp !== null && isc < imp) err('ISC_BELOW_IMP', '/specs/iscA/v', `Isc (${isc}) phải ≥ Imp (${imp})`);
    if (p && vmp && imp && Math.abs(vmp * imp - p) / p > 0.03)
      err('PMP_MISMATCH', '/specs/pstcW/v', `Vmp×Imp = ${(vmp * imp).toFixed(1)} W lệch Pmax ${p} W quá 3%`, 'warning');
  }
  if (c.kind === 'battery') {
    const [v, ah, wh] = ['nominalV', 'capacityAh', 'nominalWh'].map(val);
    if (v && ah && wh && Math.abs(v * ah - wh) / wh > 0.01)
      err('ENERGY_MISMATCH', '/specs/nominalWh/v', `V×Ah = ${(v * ah).toFixed(0)} Wh lệch năng lượng ghi ${wh} Wh quá 1%`, 'warning');
  }
  return out;
}

export function validateComponent(c: unknown): Issue[] {
  if (!vComponent(c)) return fromAjv(vComponent.errors);
  return checkComponent(c as Component);
}
export function validateOffer(o: unknown): Issue[] {
  return vOffer(o) ? [] : fromAjv(vOffer.errors);
}

/** Schema + per-snapshot component checks + reference integrity. */
export function validateProject(p: unknown): Issue[] {
  if (!vProject(p)) return fromAjv(vProject.errors);
  const proj = p as unknown as Project;
  const out: Issue[] = [];
  if (proj.location) { try { new Intl.DateTimeFormat('en', { timeZone: proj.location.timezone }); } catch { out.push({ code: 'INVALID_TIMEZONE', severity: 'error', field: '/location/timezone', message: `Múi giờ "${proj.location.timezone}" không hợp lệ (cần dạng IANA như Asia/Ho_Chi_Minh)` }); } }
  proj.snapshots.components.forEach((c, i) => out.push(...checkComponent(c, `/snapshots/components/${i}`)));
  const comps = new Set(proj.snapshots.components.map(refKey));
  const offers = new Map(proj.snapshots.offers.map((o: Offer) => [o.offerId, o]));
  const dup = (code: string, field: string, ids: string[]) => {
    const seen = new Set<string>();
    ids.forEach((id, i) => { if (seen.has(id)) out.push({ code, severity: 'error', field: `/${field}/${i}`, message: `ID trùng: ${id}` }); seen.add(id); });
  };
  dup('DUPLICATE_ID', 'instances', proj.instances.map((x) => x.instanceId));
  dup('DUPLICATE_ID', 'costLines', (proj.costLines ?? []).map((l) => l.lineId));
  dup('DUPLICATE_ID', 'kits', (proj.kits ?? []).map((k) => k.kitId));
  dup('DUPLICATE_ID', 'snapshots/offers', proj.snapshots.offers.map((o) => o.offerId));
  dup('DUPLICATE_ID', 'snapshots/components', proj.snapshots.components.map(refKey));
  const bad = (code: string, field: string, message: string) => out.push({ code, severity: 'error', field, message });
  proj.instances.forEach((x, i) => {
    if (x.componentRef && !comps.has(refKey(x.componentRef))) bad('BROKEN_REF', `/instances/${i}/componentRef`, `Không có bản chụp linh kiện ${refKey(x.componentRef)}`);
  });
  const ids = new Set(proj.instances.map((x) => x.instanceId));
  proj.edges.forEach((e, i) => (['from', 'to'] as const).forEach((end) => {
    if (!ids.has(e[end].instanceId)) bad('BROKEN_REF', `/edges/${i}/${end}/instanceId`, `Không có instance ${e[end].instanceId}`);
  }));
  dup('DUPLICATE_ID', 'strings', (proj.strings ?? []).map((x) => x.stringId));
  const kindOf = new Map(proj.instances.map((x) => [x.instanceId, x.kind]));
  (proj.strings ?? []).forEach((st, i) => {
    st.panelIds.forEach((id, j) => { if (!ids.has(id)) bad('BROKEN_REF', `/strings/${i}/panelIds/${j}`, `Không có instance ${id}`); else if (kindOf.get(id) !== 'panel') bad('NOT_A_PANEL', `/strings/${i}/panelIds/${j}`, `${id} không phải tấm pin`); });
    if (st.target && !ids.has(st.target.instanceId)) bad('BROKEN_REF', `/strings/${i}/target/instanceId`, `Không có instance ${st.target.instanceId}`);
  });
  dup('DUPLICATE_ID', 'loadPlans', (proj.loadPlans ?? []).map((l) => l.instanceId));
  (proj.loadPlans ?? []).forEach((l, i) => {
    if (kindOf.get(l.instanceId) !== 'load') bad('NOT_A_LOAD', `/loadPlans/${i}/instanceId`, `${l.instanceId} không phải tải`);
    const c = l.pump?.curve;
    if (c && c.qM3h.length !== c.headM.length) bad('CURVE_LENGTH', `/loadPlans/${i}/pump/curve`, 'Q và H phải cùng số điểm');
    if (c && c.qM3h.some((q, k) => k > 0 && q <= c.qM3h[k - 1])) bad('CURVE_ORDER', `/loadPlans/${i}/pump/curve/qM3h`, 'Q phải tăng dần');
  });
  dup('DUPLICATE_ID', 'roofFaces', proj.roofFaces.map((f) => f.roofFaceId));
  dup('DUPLICATE_ID', 'obstacles', (proj.obstacles ?? []).map((o) => o.obstacleId));
  dup('DUPLICATE_ID', 'devicePlacements', (proj.devicePlacements ?? []).map((d) => d.instanceId));
  (proj.devicePlacements ?? []).forEach((d, i) => {
    if (!ids.has(d.instanceId)) bad('BROKEN_REF', `/devicePlacements/${i}/instanceId`, `Không có instance ${d.instanceId}`);
    else if (kindOf.get(d.instanceId) === 'panel') bad('NOT_A_DEVICE', `/devicePlacements/${i}/instanceId`, `${d.instanceId} là tấm pin, đặt trên mặt mái chứ không đặt như thiết bị`);
  });
  const faceIds = new Set(proj.roofFaces.map((f) => f.roofFaceId));
  (proj.placements ?? []).forEach((pl, i) => {
    if (!ids.has(pl.instanceId)) bad('BROKEN_REF', `/placements/${i}/instanceId`, `Không có instance ${pl.instanceId}`);
    else if (kindOf.get(pl.instanceId) !== 'panel') bad('NOT_A_PANEL', `/placements/${i}/instanceId`, `${pl.instanceId} không phải tấm pin`);
    if (!faceIds.has(pl.roofFaceId)) bad('BROKEN_REF', `/placements/${i}/roofFaceId`, `Không có mặt mái ${pl.roofFaceId}`);
  });
  (proj.obstacles ?? []).forEach((o, i) => { if (o.roofFaceId && !faceIds.has(o.roofFaceId)) bad('BROKEN_REF', `/obstacles/${i}/roofFaceId`, `Không có mặt mái ${o.roofFaceId}`); });
  proj.snapshots.offers.forEach((o, i) => {
    if (!comps.has(refKey(o.componentRef))) bad('BROKEN_REF', `/snapshots/offers/${i}/componentRef`, `Báo giá ${o.offerId} trỏ tới linh kiện thiếu`);
  });
  proj.priceSelections.forEach((s, i) => {
    const o = offers.get(s.offerId);
    if (!o) bad('BROKEN_REF', `/priceSelections/${i}/offerId`, `Không có báo giá ${s.offerId}`);
    else if (refKey(o.componentRef) !== refKey(s.componentRef)) bad('OFFER_COMPONENT_MISMATCH', `/priceSelections/${i}/offerId`, `Báo giá ${s.offerId} không thuộc ${refKey(s.componentRef)}`);
  });
  return out;
}

export const hasErrors = (issues: Issue[]) => issues.some((i) => i.severity === 'error');
