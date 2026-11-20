/**
 * How much detail the screens show: Cơ bản, Thợ, Kỹ sư. Remembered by the browser, never stored in the project, never changes a
 * number. Detail carries `data-min-depth="tho" | "ky-su"` and the stylesheet hides it below that depth; a status (finding, health
 * cell, checklist, assumptions) never carries it.
 */
export type Depth = 'co-ban' | 'tho' | 'ky-su';
export const DEPTH_KEY = 'solar-lab:depth';
export const DEPTH_LABEL: Record<Depth, string> = { 'co-ban': 'Cơ bản', tho: 'Thợ', 'ky-su': 'Kỹ sư' };

const isDepth = (v: unknown): v is Depth => typeof v === 'string' && Object.hasOwn(DEPTH_LABEL, v);

/** The remembered depth; nothing remembered, an unknown value or storage that cannot be read → Cơ bản. */
export function readDepth(store?: Pick<Storage, 'getItem'> | null): Depth {
  try {
    const v = (store === undefined ? localStorage : store)?.getItem(DEPTH_KEY);
    return isDepth(v) ? v : 'co-ban';
  } catch { return 'co-ban'; }
}

/** Remember the depth; storage that cannot be written is ignored (the depth then lasts for this page only). */
export function writeDepth(d: Depth, store?: Pick<Storage, 'setItem'> | null): void {
  try { (store === undefined ? localStorage : store)?.setItem(DEPTH_KEY, d); } catch { /* not remembered */ }
}

export function applyDepth(d: Depth): void { document.documentElement.dataset.depth = d; }

/** The depth the page shows now (what applyDepth set), which holds even when storage does not. */
export const currentDepth = (): Depth => { const v = document.documentElement.dataset.depth; return isDepth(v) ? v : 'co-ban'; };
