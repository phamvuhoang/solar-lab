import { BUILTIN_COMPONENTS, BUILTIN_OFFERS } from '../catalog/catalog';
import { diff } from '../domain/diff';
import { refKey, type Component, type Offer, type Project } from '../domain/types';
import { buildQuote } from '../cost/quote';
import { exportProject } from '../persistence/exchange';
import { exportAll } from '../persistence/backup';
import { ConflictError, type ProjectRepository } from '../persistence/repository';
import { isQuotaError } from '../persistence/import';
import { History } from '../app/history';
import { ALL_LAYERS } from '../scene/three-view';
import { BUNDLED_WEATHER, loadBundledWeather } from '../weather/bundled';
import type { PvResult } from '../engine/pv';
import { renderCatalog } from './catalog';
import { renderDesign } from './design';
import { download, h } from './dom';
import { healthOf, renderHealth } from './health';
import { freshImported, renderImported } from './imported';
import { renderPv } from './pv';
import { renderQuote } from './quote';
import { freshReport, renderReport } from './report';
import { renderRoof, releaseRoofView, type RoofState } from './roof';
import { formatRoute, STEPS, stepOfTab, type Step, type Tab, type Target } from './route';
import { renderShade, releaseShadeView, type ShadeState } from './shade';
import { renderSim, type SimState } from './sim';

export interface WorkspaceDeps {
  root: HTMLElement; repo: ProjectRepository;
  say(m: string): void; message(): string; reloadNeeded(): boolean; reloadNote(): HTMLElement;
}
export interface Workspace { readonly projectId: string; show(step: Step, tab: Tab): Promise<void>; dispose(): void }

const vnd = (minor: string) => Number(minor).toLocaleString('vi-VN') + ' đ';

/** Bundled datasets load from the app, imported ones from the store. */
export const weatherLoader = (repo: ProjectRepository) => async (id: string) => {
  if (BUNDLED_WEATHER.some((b) => b.id === id)) { const r = await loadBundledWeather(id); return r?.ok ? r.series : undefined; }
  return repo.getWeather(id);
};

/**
 * One project = one screen: top bar, step bar, tabs, the panel that runs the current tab's screen, and the health bar.
 * Navigation goes through the hash (the router calls show); an edit repaints only the panel, the top bar and the health bar.
 */
export function openWorkspace(deps: WorkspaceDeps, initial: Project): Workspace {
  const { root, repo, say } = deps;
  const message = () => deps.message();
  const loadWeather = weatherLoader(repo);
  let project = initial;
  let userComponents: Component[] = [];
  let userOffers: Offer[] = [];
  const history = new History<Project>();
  let selected: string | null = null;
  let pendingFocus: string[] = [];
  let selection: string[] = []; // selected panel instance ids, shared by the diagram, the roof views and the BOM
  const roofState: RoofState = { layers: ALL_LAYERS, faceId: null, angle: 0, stepCm: 5, fps: null };
  const shadeState: ShadeState = { date: null, step: 0, scenes: [], dayEnergy: null, stepLabel: '' };
  let lastPvResult: PvResult | null = null;
  const reportState = freshReport();
  let importedState = freshImported();
  const simState: SimState = { runs: [], side: 0, step: 0, progress: {} };
  let recordedOpen = false; // the "Dự án" tab shows the package's recorded results instead of the summary
  let step: Step = 'bo-tri', tab: Tab | null = null, seq = 0;

  const reload = async () => { [userComponents, userOffers] = [await repo.listComponents(), await repo.listOffers()]; };
  const save = async (next: Project): Promise<boolean> => {
    if (deps.reloadNeeded()) { say(`${deps.reloadNote().textContent} Thay đổi này chưa được lưu.`); return false; }
    try { project = await repo.saveRevision(project!.revision, next); say(''); return true; }
    catch (e) {
      if (!(e instanceof ConflictError)) {
        say(isQuotaError(e) ? 'Hết dung lượng lưu trữ của trình duyệt nên thay đổi này CHƯA được lưu. Giải phóng dung lượng (xóa dự án hoặc dữ liệu thời tiết cũ, hoặc bấm "Xuất tất cả" rồi xóa bớt) rồi làm lại.' : `Không lưu được thay đổi: ${(e as Error).message}. Thay đổi này chưa được lưu.`);
        return false;
      }
      say(`Dự án đã được sửa ở tab khác (revision ${e.head.headRevision}). Bấm "Mở bản mới nhất" để xem; thay đổi của bạn chưa được lưu.`);
      return false;
    }
  };
  /** Every edit is a new stored revision; undo restores the previous content as another new revision. */
  const mutate = async (next: Project) => { const prev = project!; if (await save(next)) history.record(prev); };

  const stringOfPanel = (id: string) => project?.strings?.find((x) => x.panelIds.includes(id))?.stringId ?? null;
  /** Roof/plan/list selection → the diagram's selected object (a string if all chosen panels share one). */
  const setSelection = (ids: string[]) => {
    selection = [...new Set(ids)];
    const owners = new Set(selection.map(stringOfPanel).filter(Boolean));
    selected = owners.size === 1 ? [...owners][0]! : null;
  };
  const historyFor = (refresh: () => Promise<void>) => ({
    canUndo: history.canUndo, canRedo: history.canRedo,
    undo: () => { const cur = project!; const prev = history.undo(cur); void (async () => { if (prev) { if (await save(prev)) say(`Đã lưu: revision ${project!.revision}`); else history.redo(prev); } await refresh(); })(); },
    redo: () => { const cur = project!; const nxt = history.redo(cur); void (async () => { if (nxt) { if (await save(nxt)) say(`Đã lưu: revision ${project!.revision}`); else history.undo(nxt); } await refresh(); })(); },
  });
  /** Selector for the control that has keyboard focus, so it can get focus back when the screen is rebuilt (every edit rebuilds it). */
  const focusKey = (): string | null => {
    const a = document.activeElement as HTMLElement | SVGElement | null;
    if (!a || !root.contains(a)) return null;
    if (a.id) return `#${CSS.escape(a.id)}`;
    const id = (a as HTMLElement).dataset?.id;
    return id ? `[data-id="${CSS.escape(id)}"]` : null;
  };

  // ---- navigation: a new step is a new history entry, a tab inside the step replaces it ---------------------------
  const navigate = (s: Step, t: Tab) => {
    const url = formatRoute({ kind: 'project', projectId: project.projectId, step: s, tab: t });
    if (s === step) location.replace(url); else location.hash = url;
  };
  const go = (t: Tab) => navigate(stepOfTab(t), t);
  const goTarget = (t: Target) => { pendingFocus = t.focusId ? [t.focusId] : []; if (t.tab === tab) applyFocus(); else navigate(t.step, t.tab); };
  const applyFocus = () => {
    const target = pendingFocus.map((id) => document.getElementById(id)).find(Boolean);
    pendingFocus = [];
    target?.focus();
    target?.scrollIntoView({ block: 'nearest' });
  };

  // ---- chrome -------------------------------------------------------------------------------------------------------
  const top = h('header', { id: 'ws-top' });
  const steps = h('nav', { id: 'ws-steps', 'aria-label': 'Các bước' });
  const tabs = h('div', { id: 'ws-tabs', role: 'tablist' });
  const panel = h('section', { id: 'ws-panel', role: 'tabpanel' });
  let health = h('footer', { id: 'ws-health' });
  const ws = h('div', { id: 'ws' }, top, steps, tabs, panel, health);
  const help = h('details', { id: 'ws-help' }, h('summary', {}, 'Trợ giúp'),
    h('button', { id: 'lessons-btn', type: 'button', onClick: () => { location.hash = formatRoute({ kind: 'help', page: 'bai-hoc' }); } }, 'Bài học'),
    h('button', { id: 'ws-about', type: 'button', onClick: () => { location.hash = formatRoute({ kind: 'help', page: 'phien-ban' }); } }, 'Phiên bản và phạm vi kiểm chứng'),
    h('button', { id: 'ws-export-all', type: 'button', onClick: async () => { download('mekoniq-tat-ca-du-an.json', await exportAll(repo)); } }, 'Xuất tất cả dự án (sao lưu)'));
  help.addEventListener('click', (e) => { if ((e.target as Element).closest('button')) help.open = false; }); // a picked item closes the menu
  const home = h('button', { id: 'ws-home', type: 'button', onClick: () => { say(''); location.hash = formatRoute({ kind: 'home' }); } }, 'Danh sách dự án');

  function paintChrome() {
    const hist = historyFor(edited);
    top.replaceChildren(...[
      h('h1', {}, 'Mekoniq Solar Lab'), home, h('h2', { id: 'ws-name' }, project.name), h('span', { id: 'ws-rev' }, `Đã lưu · r${project.revision}`),
      h('button', { id: 'ws-undo', type: 'button', disabled: !hist.canUndo, onClick: hist.undo }, 'Hoàn tác'),
      h('button', { id: 'ws-redo', type: 'button', disabled: !hist.canRedo, onClick: hist.redo }, 'Làm lại'),
      help,
      message().includes('Mở bản mới nhất') && h('button', { id: 'ws-latest', type: 'button', onClick: async () => { project = (await repo.loadRevision(project.projectId))!; say(''); await renderPanel(); } }, 'Mở bản mới nhất'),
      h('p', { id: 'status', role: 'status' }, message())].filter(Boolean) as Node[]);
    const next = renderHealth(healthOf(project), goTarget);
    health.replaceWith(next);
    health = next;
  }
  function paintNav() {
    const def = STEPS.find((s) => s.id === step)!;
    steps.replaceChildren(...STEPS.map((s) => h('button', { id: `step-${s.id}`, type: 'button', 'aria-current': s.id === step ? 'step' : undefined, onClick: () => { if (s.id !== step) navigate(s.id, s.tabs[0]!.id); } }, `${s.n} ${s.label}`)));
    tabs.setAttribute('aria-label', def.label);
    tabs.replaceChildren(...def.tabs.map((x) => h('button', { id: x.elId, type: 'button', role: 'tab', 'aria-selected': String(x.id === tab), 'aria-controls': 'ws-panel', onClick: () => navigate(step, x.id) }, x.label)));
    panel.setAttribute('aria-labelledby', def.tabs.find((x) => x.id === tab)!.elId);
  }

  /** Renders the current tab into the panel. Screens are async: only the latest render paints. */
  async function renderPanel(keep = focusKey()): Promise<void> {
    const my = ++seq, t = tab!;
    // a screen's own re-render (selection, progress, results) is dropped once its tab is left: it must not wipe the open tab's input
    const again = async () => { if (tab === t) await renderPanel(); };
    const nodes = await SCREENS[t](again);
    if (my !== seq) return;
    panel.replaceChildren(...nodes);
    paintChrome();
    if (keep) root.querySelector<HTMLElement | SVGElement>(keep)?.focus({ preventScroll: true }); // synchronous: no key can arrive in between
    applyFocus();
  }
  /** An edit always repaints the open tab, whichever tab made it, so no screen keeps editing a stale copy of the project. */
  const saved = async (next: Project) => { await mutate(next); if (!message()) say(`Đã lưu: revision ${project!.revision}`); await renderPanel(); };
  const edited = () => renderPanel();

  const SCREENS: Record<Tab, (again: () => Promise<void>) => Promise<Node[]>> = {
    mai: async (again) => renderRoof({
      project, selection, state: roofState,
      apply: saved,
      setSelection: (ids) => { setSelection(ids); void again(); }, rerender: () => { void again(); },
      history: historyFor(edited), go,
    }),
    bong: async (again) => renderShade({
      project, revisions: await repo.listRevisions(project.projectId), selection, state: shadeState, loadRevision: (n) => repo.loadRevision(project.projectId, n), loadWeather,
      apply: saved,
      setSelection: (ids) => { setSelection(ids); void again(); }, rerender: () => { void again(); }, go,
    }),
    'thiet-ke': async (again) => {
      await reload();
      const undoStep = async (to: Project | undefined, revert: () => void) => {
        if (to) { if (await save(to)) say(`Đã lưu: revision ${project!.revision}`); else revert(); }
        await edited();
      };
      return renderDesign({
        project, components: [...BUILTIN_COMPONENTS, ...userComponents], offers: [...BUILTIN_OFFERS, ...userOffers], selected,
        select: (id, focusIds = []) => { selected = id; const st = id ? project!.strings?.find((x) => x.stringId === id) : undefined; if (st) selection = [...st.panelIds]; pendingFocus = focusIds; void again(); },
        apply: saved,
        history: {
          canUndo: history.canUndo, canRedo: history.canRedo,
          undo: () => { const cur = project!; const prev = history.undo(cur); undoStep(prev, () => history.redo(prev!)); },
          redo: () => { const cur = project!; const nxt = history.redo(cur); undoStep(nxt, () => history.undo(nxt!)); },
        },
        go,
      });
    },
    pv: async (again) => {
      const stored = await repo.listWeather();
      return renderPv({
        project,
        choices: [...BUNDLED_WEATHER.map((b) => ({ id: b.id, label: b.label, origin: 'bundled' as const })), ...stored.map((s) => ({ id: s.seriesId, label: s.name, origin: 'stored' as const }))],
        loadWeather, saveWeather: (s) => repo.saveWeather(s),
        apply: saved,
        lastResult: lastPvResult, setResult: (r) => { lastPvResult = r; }, rerender: () => { void again(); },
      });
    },
    'he-thong': async (again) => {
      await reload();
      return renderSim({
        project, components: [...BUILTIN_COMPONENTS, ...userComponents], offers: [...BUILTIN_OFFERS, ...userOffers], revisions: await repo.listRevisions(project.projectId),
        loadRevision: (n) => repo.loadRevision(project.projectId, n), loadWeather,
        apply: saved,
        state: simState, rerender: () => { void again(); }, go,
      });
    },
    'du-toan': async () => {
      await reload();
      const p = project;
      return renderQuote({
        project: p, offers: [...BUILTIN_OFFERS, ...userOffers], revisions: await repo.listRevisions(p.projectId),
        loadRevision: (n) => repo.loadRevision(p.projectId, n), saveOffer: (o) => repo.saveOffer(o),
        apply: async (next) => { await mutate(next); await edited(); },
        selectedKeys: selection.flatMap((id) => { const r = p.instances.find((i) => i.instanceId === id)?.componentRef; return r ? [`design:${refKey(r)}`] : []; }),
      });
    },
    'thiet-bi': async () => renderCatalog({ project, repo, mutate, rerender: () => { void edited(); }, say }),
    'bao-cao': async (again) => renderReport({
      project, revisions: await repo.listRevisions(project.projectId), state: reportState, buildId: __BUILD_ID__, loadRevision: (n) => repo.loadRevision(project.projectId, n), loadWeather,
      apply: saved, rerender: () => { void again(); }, go,
    }),
    'du-an': async (again) => {
      const p = project;
      const recorded = await repo.getRecorded(p.projectId);
      if (recordedOpen && recorded) return renderImported({ project: p, recorded, loadWeather, state: importedState, rerender: () => { void again(); }, open: () => { recordedOpen = false; void again(); } });
      if (recordedOpen) { recordedOpen = false; say('Dự án này không có kết quả đã ghi từ gói.'); }
      const q = buildQuote(p);
      const revs = await repo.listRevisions(p.projectId);
      const labelOf = (key: string) => p.snapshots.components.find((c) => `${c.modelId}@${c.revision}` === key)?.name ?? key;
      const diffOut = h('div', { id: 'diff' });
      return [
        h('section', { 'aria-label': 'Bản thiết kế nháp' },
          h('p', {}, `Bản nháp · revision ${p.revision}`),
          h('ul', { id: 'devices' }, ...Object.entries(q.deviceCounts).map(([k, n]) => h('li', {}, `${n} × ${labelOf(k)}`))),
          h('p', { id: 'bom-total' }, p.instances.length ? `Tổng phần đã biết (chưa VAT): ${vnd(q.knownSubtotalMinor)}${q.complete ? '' : ' · tổng hoàn chỉnh: chưa đủ'}` : 'Chưa có linh kiện.')),
        !!recorded && h('button', { id: 'recorded-btn', onClick: () => { importedState = freshImported(); recordedOpen = true; void again(); } }, 'Kết quả đã ghi từ gói'),
        h('button', { onClick: async () => download(`${p.name}.json`, await exportProject(p)) }, 'Xuất JSON'),
        h('button', { onClick: async () => { const c = await repo.cloneProject(p.projectId); say('Đã nhân bản dự án.'); location.hash = formatRoute({ kind: 'project', projectId: c.projectId, step: stepOfTab('du-an'), tab: 'du-an' }); } }, 'Nhân bản dự án'),
        h('h3', {}, 'Lịch sử revision'),
        h('ol', { id: 'revisions' }, ...revs.map((r, i) => h('li', {}, `revision ${r.revision} · ${r.savedAt} `,
          i > 0 && h('button', { onClick: async () => {
            const [a, b] = await Promise.all([repo.loadRevision(p.projectId, revs[i - 1].revision), repo.loadRevision(p.projectId, r.revision)]);
            const changes = diff(a, b).filter((c) => !c.path.endsWith('/updatedAt') && c.path !== '/revision');
            diffOut.replaceChildren(h('ul', {}, ...changes.slice(0, 50).map((c) => h('li', {}, `${c.path}: ${JSON.stringify(c.before)} → ${JSON.stringify(c.after)}`))));
          } }, `So với revision ${revs[i - 1].revision}`)))),
        diffOut,
      ].filter(Boolean) as Node[];
    },
  };

  return {
    projectId: initial.projectId,
    async show(s, t) {
      if (!ws.isConnected) root.replaceChildren(...(deps.reloadNeeded() ? [deps.reloadNote()] : []), ws);
      const keep = focusKey();
      if (t !== tab) {
        if (tab === 'mai') releaseRoofView();
        if (tab === 'bong') releaseShadeView();
        if (tab === 'du-an') recordedOpen = false;
        panel.replaceChildren(); // never show the previous tab's controls under the new tab
      }
      step = s; tab = t;
      paintNav();
      await renderPanel(keep);
    },
    dispose() { seq++; releaseRoofView(); releaseShadeView(); },
  };
}
