import { BUILTIN_COMPONENTS, BUILTIN_OFFERS } from '../catalog/catalog';
import { diff } from '../domain/diff';
import { unassignedPanels } from '../domain/graph';
import { isSample } from '../domain/seed';
import { refKey, type Component, type Offer, type Project } from '../domain/types';
import { buildQuote } from '../cost/quote';
import { exportProject } from '../persistence/exchange';
import { exportAll } from '../persistence/backup';
import { ConflictError, type ProjectRepository } from '../persistence/repository';
import { isQuotaError } from '../persistence/import';
import { AUTORUN_DELAY_MS, createScheduler, Lru } from '../app/autorun';
import { runAuto, type AutoState } from '../app/auto-sim';
import { History } from '../app/history';
import { progressComplete, progressOf, type ProgressItem } from '../app/progress';
import { BUNDLED_WEATHER, loadBundledWeather } from '../weather/bundled';
import type { PvResult } from '../engine/pv';
import type { SimResult } from '../engine/system';
import { renderCatalog } from './catalog';
import { renderChecklist } from './checklist';
import { startCoach } from './coach';
import { renderDesign } from './design';
import { download, h } from './dom';
import { healthOf, renderHealth } from './health';
import { freshImported, renderImported, workerRunner } from './imported';
import { renderInspector } from './inspector';
import { renderPalette } from './palette';
import { renderPv } from './pv';
import { renderQuote } from './quote';
import { freshReport, renderReport } from './report';
import { renderRoof, type RoofState } from './roof';
import { formatRoute, STEPS, stepOfTab, type Step, type Tab, type Target } from './route';
import { renderShade, stopShadePlayback, type ShadeState } from './shade';
import { renderSim, type SimState } from './sim';
import { createViewport } from './viewport';
import { validateDesign } from '../validation/strings';

export interface WorkspaceDeps {
  root: HTMLElement; repo: ProjectRepository;
  say(m: string): void; message(): string; reloadNeeded(): boolean; reloadNote(): HTMLElement;
}
/** `stored` is false for a preview (#/mau, #/moi) until its first save; `show()` with no arguments shows it again where it was. */
export interface Workspace { readonly projectId: string; readonly stored: boolean; show(step?: Step, tab?: Tab): Promise<void>; dispose(): void }

const UNSAVED = 'Xem thử · chưa lưu';
const vnd = (minor: string) => Number(minor).toLocaleString('vi-VN') + ' đ';
/** Tabs whose screen draws the shared selection (roof, shade, diagram, BOM highlight); the inspector on top of the panel shows it on every tab. */
const SHOWS_SELECTION: Tab[] = ['mai', 'bong', 'thiet-ke', 'du-toan'];

/** Bundled datasets load from the app, imported ones from the store. */
export const weatherLoader = (repo: ProjectRepository) => async (id: string) => {
  if (BUNDLED_WEATHER.some((b) => b.id === id)) { const r = await loadBundledWeather(id); return r?.ok ? r.series : undefined; }
  return repo.getWeather(id);
};

/**
 * One project = one screen: top bar, step bar, tabs, the panel that runs the current tab's screen, and the health bar.
 * Navigation goes through the hash (the router calls show); an edit repaints only the panel, the top bar and the health bar.
 */
export function openWorkspace(deps: WorkspaceDeps, initial: Project, opts: { stored: boolean }): Workspace {
  const { root, repo, say } = deps;
  const message = () => deps.message();
  const loadWeather = weatherLoader(repo);
  let project = initial;
  let userComponents: Component[] = [];
  let userOffers: Offer[] = [];
  const history = new History<Project>();
  let selected: string | null = null; // what the diagram and the finding detail show: a string, device, port or edge id
  let pendingFocus: string[] = [];
  let selection: string[] = []; // instance and obstacle ids of every kind, shared by 3D, diagram, plan, lists, BOM and the inspector
  const roofState: RoofState = { faceId: null, angle: 0, stepCm: 5 };
  const shadeState: ShadeState = { date: null, step: 0, scenes: [], dayEnergy: null, stepLabel: '' };
  let lastPvResult: PvResult | null = null;
  const reportState = freshReport();
  let importedState = freshImported();
  const simState: SimState = { runs: [], side: 0, step: 0, progress: {}, busy: false };
  let auto: AutoState = { kind: 'idle' }, autoOf: Project | null = null; // the automatic run and the project it is for
  let fresh = false; // a run finished while a field in the panel was being typed into: the panel waits for "Hiện"
  const simCache = new Lru<SimResult>(8);
  let recordedOpen = false; // the "Dự án" tab shows the package's recorded results instead of the summary
  let step: Step = 'bo-tri', tab: Tab | null = null, seq = 0, disposed = false, stored = opts.stored;
  let checklistOpen: boolean | null = null; // what the person chose by clicking its summary; null = open only while the project is empty
  let coach = !opts.stored && isSample(initial); // the first-look callouts belong to the sample preview (#/mau)

  const reload = async () => { [userComponents, userOffers] = [await repo.listComponents(), await repo.listOffers()]; };
  const save = async (next: Project): Promise<boolean> => {
    if (deps.reloadNeeded()) { say(`${deps.reloadNote().textContent} Thay đổi này chưa được lưu.`); return false; }
    try {
      if (stored) project = await repo.saveRevision(project!.revision, next);
      else { // a preview becomes a project on its first edit; the address follows without a hashchange (nothing to re-route)
        project = await repo.createProject(next);
        stored = true;
        if (ws.isConnected) window.history.replaceState(null, '', formatRoute({ kind: 'project', projectId: project.projectId, step, tab: tab! }));
      }
      say(''); return true;
    }
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
  const isPanel = (id: string) => project.instances.some((i) => i.instanceId === id && i.kind === 'panel');
  /** Any picked id → the instance or obstacle ids it stands for: a string → its panels, "instance:port" → its device, an edge → nothing. */
  const resolve = (id: string): string[] => {
    const st = project.strings?.find((x) => x.stringId === id);
    if (st) return [...st.panelIds];
    if (id === 'unassigned') return unassignedPanels(project); // the diagram's "n tấm chưa gán" box
    const base = id.split(':')[0];
    return project.instances.some((i) => i.instanceId === base) || project.obstacles?.some((o) => o.obstacleId === base) ? [base] : [];
  };
  /**
   * The one selection, from any view. The diagram's object: the id itself when one non-panel id is picked (string, device, port, edge),
   * else the string all chosen panels share. Returns false when nothing changed.
   */
  const choose = (ids: string[]): boolean => {
    const sel = [...new Set(ids.flatMap(resolve))], owners = new Set(sel.map(stringOfPanel).filter(Boolean));
    const obj = ids.length === 1 && !isPanel(ids[0]) ? ids[0] : owners.size === 1 ? [...owners][0]! : null;
    if (obj === selected && sel.join(',') === selection.join(',')) return false;
    selection = sel; selected = obj;
    return true;
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
    if (!stored) return void show(s, t); // a preview keeps its #/mau or #/moi address until the first save
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
  // one 3D view for the whole workspace: it outlives step and tab changes; selecting or dragging in it works on every tab
  // only tabs that show the selection repaint; any other tab keeps what is being typed into it and swaps just the inspector
  const selectionChanged = () => { if (tab && SHOWS_SELECTION.includes(tab)) void renderPanel(); else { view.refresh(); paintInspector(); } };
  const pick = (ids: string[]) => { if (choose(ids)) selectionChanged(); }; // equal selection (e.g. empty ground clicked twice): nothing repaints
  const view = createViewport({
    project: () => project, selection: () => selection, apply: (next) => saved(next), selected: () => selected,
    setSelection: pick, select: (id) => pick([id]), remove: () => { void requestDelete(selection); },
  });

  // ---- "Đang chọn" on top of the panel; kept while project and selection stay, so an open preview survives other repaints ----
  let insp: { el: HTMLElement; project: Project; key: string } | null = null, inspOpen: 'delete' | undefined;
  const inspector = (): HTMLElement => {
    const key = selection.join(',');
    if (insp?.project !== project || insp.key !== key || inspOpen) {
      insp = { project, key, el: renderInspector({
        project, selection, findings: validateDesign(project), components: [...BUILTIN_COMPONENTS, ...userComponents], offers: [...BUILTIN_OFFERS, ...userOffers],
        apply: saved, select: pick, go: goTarget, open: inspOpen,
      }) };
      inspOpen = undefined;
    }
    return insp.el;
  };
  const paintInspector = () => panel.querySelector('#inspector')?.replaceWith(inspector());
  /** Select `ids` and show what deleting them takes along, focus on its confirm button (the Delete key in 3D, "Xóa" in the device list). */
  const requestDelete = async (ids: string[]) => {
    choose(ids); inspOpen = 'delete';
    if (tab && SHOWS_SELECTION.includes(tab)) await renderPanel(null); else { view.refresh(); paintInspector(); }
    document.getElementById('insp-confirm')?.focus();
  };
  // the add palette: rebuilt only when the project changed, so its preview is never stale and an open block survives other repaints
  let palette = h('aside', { id: 'ws-add' }), paletteOf: Project | null = null;
  const paintPalette = () => {
    if (paletteOf === project) return;
    const next = renderPalette({ project, components: [...BUILTIN_COMPONENTS, ...userComponents], offers: [...BUILTIN_OFFERS, ...userOffers], apply: saved });
    palette.replaceWith(next); palette = next; paletteOf = project;
  };
  /** The design's "Mái nhà 3D" and the roof's "Sơ đồ điện" also switch the view to what they name. */
  const goView = (t: Tab) => { if (t === 'mai') view.setMode('3d'); else if (t === 'thiet-ke') view.setMode('diagram'); go(t); };
  const ws = h('div', { id: 'ws' }, top, steps, h('div', { id: 'ws-main' }, view.el, palette, tabs, panel), health);
  const help = h('details', { id: 'ws-help' }, h('summary', {}, 'Trợ giúp'),
    h('button', { id: 'lessons-btn', type: 'button', onClick: () => { location.hash = formatRoute({ kind: 'help', page: 'bai-hoc' }); } }, 'Bài học'),
    h('button', { id: 'ws-about', type: 'button', onClick: () => { location.hash = formatRoute({ kind: 'help', page: 'phien-ban' }); } }, 'Phiên bản và phạm vi kiểm chứng'),
    h('button', { id: 'ws-export-all', type: 'button', onClick: async () => { download('mekoniq-tat-ca-du-an.json', await exportAll(repo)); } }, 'Xuất tất cả dự án (sao lưu)'));
  help.addEventListener('click', (e) => { if ((e.target as Element).closest('button')) help.open = false; }); // a picked item closes the menu
  const home = h('button', { id: 'ws-home', type: 'button', onClick: () => { say(''); location.hash = formatRoute({ kind: 'home' }); } }, 'Danh sách dự án');

  function paintChrome() {
    const hist = historyFor(edited);
    top.replaceChildren(...[
      h('h1', {}, 'Mekoniq Solar Lab'), home, h('h2', { id: 'ws-name' }, project.name),
      isSample(project) && h('span', { id: 'ws-badge' }, 'Mẫu minh họa · không phải báo giá'),
      h('span', { id: 'ws-rev' }, stored ? `Đã lưu · r${project.revision}` : UNSAVED),
      h('button', { id: 'ws-undo', type: 'button', disabled: !hist.canUndo, onClick: hist.undo }, 'Hoàn tác'),
      h('button', { id: 'ws-redo', type: 'button', disabled: !hist.canRedo, onClick: hist.redo }, 'Làm lại'),
      help,
      message().includes('Mở bản mới nhất') && h('button', { id: 'ws-latest', type: 'button', onClick: async () => { project = (await repo.loadRevision(project.projectId))!; say(''); await renderPanel(); } }, 'Mở bản mới nhất'),
      h('p', { id: 'status', role: 'status' }, message())].filter(Boolean) as Node[]);
    paintHealth();
  }
  function paintHealth() {
    const next = renderHealth(healthOf(project, auto), goTarget);
    if (fresh) next.append(h('button', { id: 'ws-fresh', type: 'button', onClick: () => { void renderPanel(); } }, 'Có kết quả mới · Hiện'));
    health.replaceWith(next);
    health = next;
  }

  // ---- automatic run: shade + PV + dispatch about a second after the design stops changing ---------------------------
  const autorun = createScheduler(AUTORUN_DELAY_MS, (e) => { // a failure is shown, never left as "đang tính lại…"
    auto = { kind: 'blocked', message: `Không tính được: ${e instanceof Error ? e.message : String(e)}`, target: { step: 'chay-thu', tab: 'he-thong' } };
    paintHealth();
  });
  /** A new project: its PV and supply are unknown until its own run finishes; a run still going for the old one is cancelled. */
  const startAuto = () => {
    if (autoOf === project) return;
    const p = autoOf = project;
    auto = { kind: 'running' };
    paintHealth();
    autorun.schedule(async (signal) => {
      const next = await runAuto(p, { loadWeather, runner: workerRunner(signal), cache: simCache, signal });
      if (signal.aborted || disposed) return;
      auto = next;
      autoDone();
    });
  };
  /**
   * The bar shows the run at once. Of the panel only the progress list and the system screen show it: the system screen
   * repaints, unless a field in the panel is being typed into or a manual run is going there; then "Hiện" offers the repaint.
   */
  const autoDone = () => {
    const a = document.activeElement;
    fresh = tab === 'he-thong' && (simState.busy || (!!a && panel.contains(a) && a.matches('input, select, textarea')));
    paintHealth();
    if (tab === 'he-thong' && !fresh) return void renderPanel();
    const items = progressItems();
    panel.querySelector('#checklist')?.replaceWith(...(progressComplete(items) ? [] : [checklist(items)]));
  };
  const progressItems = () => progressOf(project, { simRan: auto.kind === 'done' }); // done is always for the current project
  function paintNav() {
    const def = STEPS.find((s) => s.id === step)!;
    steps.replaceChildren(...STEPS.map((s) => h('button', { id: `step-${s.id}`, type: 'button', 'aria-current': s.id === step ? 'step' : undefined, onClick: () => { if (s.id !== step) navigate(s.id, s.tabs[0]!.id); } }, `${s.n} ${s.label}`)));
    tabs.setAttribute('aria-label', def.label);
    tabs.replaceChildren(...def.tabs.map((x) => h('button', { id: x.elId, type: 'button', role: 'tab', 'aria-selected': String(x.id === tab), 'aria-controls': 'ws-panel', onClick: () => navigate(step, x.id) }, x.label)));
    panel.setAttribute('aria-labelledby', def.tabs.find((x) => x.id === tab)!.elId);
  }

  /** Renders the current tab into the panel. Screens are async: only the latest render paints. */
  async function renderPanel(keep: string | null = focusKey()): Promise<void> {
    if (disposed) return; // a save that finishes after the project was closed repaints nothing
    const my = ++seq, t = tab!;
    startAuto();
    // a screen's own re-render (selection, progress, results) is dropped once its tab is left: it must not wipe the open tab's input
    const again = async () => { if (tab === t) await renderPanel(); };
    const nodes = await SCREENS[t](again);
    if (my !== seq) return;
    const items = progressItems();
    fresh = false;
    panel.replaceChildren(inspector(), ...(progressComplete(items) ? [] : [checklist(items)]), ...nodes);
    view.refresh();
    paintChrome();
    paintPalette();
    if (keep) root.querySelector<HTMLElement | SVGElement>(keep)?.focus({ preventScroll: true }); // synchronous: no key can arrive in between
    applyFocus();
  }
  /** The steps still to do; open while the project is empty, unless the person opened or closed it. */
  const checklist = (items: ProgressItem[]) => {
    const el = renderChecklist(items, goTarget, checklistOpen ?? !project.instances.length);
    el.querySelector('summary')!.addEventListener('click', () => { checklistOpen = !el.hasAttribute('open'); }); // kept across the repaint every edit makes
    return el;
  };
  /** An edit always repaints the open tab, whichever tab made it, so no screen keeps editing a stale copy of the project. */
  const saved = async (next: Project) => { await mutate(next); if (!message()) say(`Đã lưu: revision ${project!.revision}`); await renderPanel(); };
  const edited = () => renderPanel();

  const SCREENS: Record<Tab, (again: () => Promise<void>) => Promise<Node[]>> = {
    mai: async (again) => renderRoof({
      project, selection, state: roofState,
      apply: saved,
      setSelection: (ids) => { choose(ids); void again(); }, rerender: () => { void again(); },
      history: historyFor(edited), go: goView,
    }),
    bong: async (again) => renderShade({
      project, revisions: await repo.listRevisions(project.projectId), selection, state: shadeState, loadRevision: (n) => repo.loadRevision(project.projectId, n), loadWeather,
      apply: saved,
      setSelection: (ids) => { choose(ids); void again(); }, rerender: () => { void again(); }, go,
      setOverlay: (o) => { if (tab === 'bong') view.setOverlay(o); }, // a late shade render must not paint its sun over another tab
    }),
    'thiet-ke': async (again) => {
      await reload();
      const undoStep = async (to: Project | undefined, revert: () => void) => {
        if (to) { if (await save(to)) say(`Đã lưu: revision ${project!.revision}`); else revert(); }
        await edited();
      };
      return renderDesign({
        project, components: [...BUILTIN_COMPONENTS, ...userComponents], offers: [...BUILTIN_OFFERS, ...userOffers], selected,
        select: (id, focusIds = []) => { choose(id ? [id] : []); pendingFocus = focusIds; void again(); },
        remove: (id) => { void requestDelete([id]); },
        apply: saved,
        history: {
          canUndo: history.canUndo, canRedo: history.canRedo,
          undo: () => { const cur = project!; const prev = history.undo(cur); undoStep(prev, () => history.redo(prev!)); },
          redo: () => { const cur = project!; const nxt = history.redo(cur); undoStep(nxt, () => history.undo(nxt!)); },
        },
        go: goView,
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
      // the automatic run is the current design's run, unless a run of it (alone or the B of an A/B) is already there
      const a = auto;
      if (a.kind === 'done' && !simState.runs.some((r) => r.source.kind === 'current' && r.hash === a.hash))
        simState.runs = [{ label: 'B', source: { kind: 'current' }, title: `Hiện tại (revision ${project.revision})`, hash: a.hash, result: a.result, projectName: project.name }];
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
        select: pick,
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
      const name = h('input', { id: 'p-name', value: p.name, required: true });
      return [
        h('p', {}, h('label', {}, 'Tên dự án ', name),
          h('button', { id: 'p-name-save', type: 'button', onClick: () => { const n = name.value.trim(); if (n && n !== p.name) void saved({ ...project, name: n }); } }, 'Đổi tên')),
        h('section', { 'aria-label': 'Bản thiết kế nháp' },
          h('p', {}, stored ? `Bản nháp · revision ${p.revision}` : UNSAVED),
          h('ul', { id: 'devices' }, ...Object.entries(q.deviceCounts).map(([k, n]) => h('li', {}, `${n} × ${labelOf(k)}`))),
          h('p', { id: 'bom-total' }, p.instances.length ? `Tổng phần đã biết (chưa VAT): ${vnd(q.knownSubtotalMinor)}${q.complete ? '' : ' · tổng hoàn chỉnh: chưa đủ'}` : 'Chưa có linh kiện.')),
        !!recorded && h('button', { id: 'recorded-btn', onClick: () => { importedState = freshImported(); recordedOpen = true; void again(); } }, 'Kết quả đã ghi từ gói'),
        h('button', { onClick: async () => download(`${p.name}.json`, await exportProject(p)) }, 'Xuất JSON'),
        stored && h('button', { onClick: async () => { const c = await repo.cloneProject(p.projectId); say('Đã nhân bản dự án.'); location.hash = formatRoute({ kind: 'project', projectId: c.projectId, step: stepOfTab('du-an'), tab: 'du-an' }); } }, 'Nhân bản dự án'),
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

  async function show(s: Step = step, t: Tab = tab ?? STEPS[0]!.tabs[0]!.id) {
    if (!ws.isConnected) root.replaceChildren(...(deps.reloadNeeded() ? [deps.reloadNote()] : []), ws);
    const keep = focusKey();
    if (t !== tab) {
      insp = null; // user-made models may have changed: "Đổi model" lists them
      if (tab === 'bong') { stopShadePlayback(); view.setOverlay({ sun: null, heat: null }); }
      if (tab === 'du-an') recordedOpen = false;
      panel.replaceChildren(); // never show the previous tab's controls under the new tab
    }
    step = s; tab = t;
    await reload();
    paintNav();
    if (coach) { coach = false; startCoach({ view: view.el, panel, health }); }
    await renderPanel(keep);
  }

  return {
    projectId: initial.projectId,
    get stored() { return stored; },
    show,
    dispose() { disposed = true; seq++; autorun.cancel(); stopShadePlayback(); view.dispose(); },
  };
}
