export type Step = 'bo-tri' | 'dau-noi' | 'chay-thu' | 'chi-phi' | 'bao-cao';
export type Tab = 'mai' | 'bong' | 'thiet-ke' | 'pv' | 'he-thong' | 'du-toan' | 'thiet-bi' | 'bao-cao' | 'du-an';
export interface StepDef { id: Step; n: number; label: string; tabs: { id: Tab; label: string; elId: string }[] }

export const STEPS: readonly StepDef[] = [
  { id: 'bo-tri', n: 1, label: 'Bố trí', tabs: [
    { id: 'mai', label: 'Mái nhà 3D', elId: 'roof-btn' },
    { id: 'bong', label: 'Bóng che', elId: 'shade-btn' },
  ] },
  { id: 'dau-noi', n: 2, label: 'Đấu nối', tabs: [
    { id: 'thiet-ke', label: 'Thiết kế', elId: 'design-btn' },
  ] },
  { id: 'chay-thu', n: 3, label: 'Chạy thử', tabs: [
    { id: 'pv', label: 'Mô phỏng PV', elId: 'pv-btn' },
    { id: 'he-thong', label: 'Hệ thống (pin, tải, bơm)', elId: 'sim-btn' },
  ] },
  { id: 'chi-phi', n: 4, label: 'Chi phí', tabs: [
    { id: 'du-toan', label: 'Dự toán', elId: 'quote-btn' },
    { id: 'thiet-bi', label: 'Thiết bị', elId: 'catalog-btn' },
  ] },
  { id: 'bao-cao', n: 5, label: 'Báo cáo', tabs: [
    { id: 'bao-cao', label: 'Báo cáo và chia sẻ', elId: 'report-btn' },
    { id: 'du-an', label: 'Dự án', elId: 'project-btn' },
  ] },
];

export interface Target { step: Step; tab: Tab; focusId?: string }
export type Route =
  | { kind: 'home' }
  | { kind: 'project'; projectId: string; step: Step; tab: Tab }
  | { kind: 'help'; page: 'bai-hoc' | 'phien-ban' };

export function parseRoute(hash: string): Route | null {
  const path = hash.replace(/^#/, '');
  if (path === '') return null;
  const [root, id, stepSeg, tabSeg] = path.split('/').slice(1);
  if (root === 'bai-hoc' || root === 'phien-ban') return { kind: 'help', page: root };
  if (root !== 'p' || !id) return { kind: 'home' };
  let projectId: string;
  try { projectId = decodeURIComponent(id); } catch { return { kind: 'home' }; }
  const def = STEPS.find((s) => s.id === stepSeg) ?? STEPS[0]!;
  const tab = def.tabs.find((t) => t.id === tabSeg) ?? def.tabs[0]!;
  return { kind: 'project', projectId, step: def.id, tab: tab.id };
}

export function formatRoute(r: Route): string {
  if (r.kind === 'home') return '#/';
  if (r.kind === 'help') return `#/${r.page}`;
  return `#/p/${encodeURIComponent(r.projectId)}/${r.step}/${r.tab}`;
}

export function stepOfTab(t: Tab): Step {
  return STEPS.find((s) => s.tabs.some((x) => x.id === t))!.id;
}

export function tabDef(t: Tab): { id: Tab; label: string; elId: string } {
  return STEPS.flatMap((s) => s.tabs).find((x) => x.id === t)!;
}
