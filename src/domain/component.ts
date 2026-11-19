import { hashOf } from './hash';
import { CHECKS, SPEC_DEFS, type Kind } from './specs';
import { DIMS } from './units';
import type { Component, Ref, Technical } from './types';

/** Fields that define the technical revision. Authorship, review and notes do not. */
export function technicalOf(c: Component | Technical): Technical {
  const { schemaVersion, modelId, sku, brand, name, kind, condition, specs, attrs, datasheet } = c;
  return { schemaVersion, modelId, sku, brand, name, kind, condition, specs, attrs, datasheet };
}
export const technicalHash = (c: Component | Technical) => hashOf(technicalOf(c));

export interface CheckStatus { id: string; label: string; ok: boolean; missing: string[] }
/** Per check: runnable, or the exact spec fields still missing. */
export function capabilities(c: Component): CheckStatus[] {
  return CHECKS[c.kind].map((chk) => {
    const missing = chk.needs.filter((k) => c.specs[k]?.v == null);
    return { id: chk.id, label: chk.label, ok: missing.length === 0, missing };
  });
}

/** Blank spec map for a kind: every field present with v = null, provenance 'user'. */
export function blankSpecs(kind: Kind): Component['specs'] {
  return Object.fromEntries(Object.entries(SPEC_DEFS[kind]).map(([k, d]) => [k, { v: null, u: DIMS[d.dim].base, p: 'user' as const }]));
}

/** User-owned copy of any component: new model, revision 1, remembers where it came from. */
export function cloneForEdit(src: Component, modelId: string, author: string, now: string): Component {
  const c = structuredClone(src);
  const from: Ref = { modelId: src.modelId, revision: src.revision };
  return {
    ...c, modelId, revision: 1, name: `${src.name} (bản sao)`, review: 'unreviewed', author, editedAt: now,
    derivedFrom: from, datasheet: src.datasheet,
  };
}
