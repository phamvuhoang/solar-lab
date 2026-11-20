import { BUILTIN_COMPONENTS, BUILTIN_OFFERS } from '../catalog/catalog';
import { diff } from '../domain/diff';
import { unassignedPanels } from '../domain/graph';
import { isSample, SAMPLE_TAG } from '../domain/seed';
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
import { applyDepth, currentDepth, DEPTH_LABEL, writeDepth, type Depth } from './depth';
import { download, h } from './dom';
import { healthOf, paintHealthBar } from './health';
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
/**
 * Tabs whose screen draws the shared selection (roof, shade, diagram); the inspector on top of the panel shows it on every tab.
 * The quote only highlights rows, in place (markQuoteRows), so a pick never drops a half-typed offer or extra line.
 */
const SHOWS_SELECTION: Tab[] = ['mai', 'bong', 'thiet-ke'];

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
  let selectedCode: string | null = null; // the check picked in the list: one object can have several (a battery port: charge and discharge)
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
  let sheet: 'add' | 'panel' | null = null; // phones: the bottom sheet that is open (Thêm or the step panel); the stylesheet ignores it from 720 px
  const addFold = { open: true }; // "Thêm" expanded or collapsed, as the person left it

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
  /**
   * Every edit is a new stored revision; undo restores the previous content as another new revision. An edit made from a copy older
   * than the project (a form still on screen while its repaint after another save is on the way) is refused, never saved over that save.
   */
  const mutate = async (next: Project) => {
    if (next.revision !== project.revision || next.updatedAt !== project.updatedAt) {
      say(`Màn hình vừa được cập nhật (revision ${project.revision}) trong lúc bạn sửa, nên thay đổi này chưa được lưu. Hãy làm lại trên màn hình mới.`);
      return;
    }
    const prev = project!; if (await save(next)) history.record(prev);
  };

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
   * The one selection, from any view. The diagram's object: the id itself when one non-panel id (string, device, port, edge) or one
   * panel outside every string is picked (its check is "tấm chưa thuộc chuỗi"), else the string all chosen panels share. Returns false when nothing changed.
   */
  const choose = (ids: string[]): boolean => {
    const sel = [...new Set(ids.flatMap(resolve))], owners = new Set(sel.map(stringOfPanel).filter(Boolean));
    const obj = ids.length === 1 && (!isPanel(ids[0]) || !stringOfPanel(ids[0])) ? ids[0] : owners.size === 1 ? [...owners][0]! : null;
    const coded = selectedCode !== null; selectedCode = null; // any other pick shows the object's worst check again
    if (!coded && obj === selected && sel.join(',') === selection.join(',')) return false;
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
    if (!stored) { if (s !== step || t !== tab) void show(s, t); return; } // a preview keeps its #/mau or #/moi address until the first save; the open tab stays as typed
    const url = formatRoute({ kind: 'project', projectId: project.projectId, step: s, tab: t });
    if (s === step) location.replace(url); else location.hash = url;
  };
  const go = (t: Tab) => navigate(stepOfTab(t), t);
  const goTarget = (t: Target) => {
    setSheet('panel'); // a target is in the panel, or in Thêm (applyFocus switches)
    pendingFocus = [t.focusId ?? []].flat();
    const picked = !!t.select && choose([t.select]); // the finding detail shows what is selected
    if (t.tab !== tab) navigate(t.step, t.tab); else if (picked) void renderPanel(null); else applyFocus();
  };
  const applyFocus = () => {
    // the first target shown at this depth; one in a closed <details> (Thêm collapsed) or a closed sheet (phones) opens it
    const els = pendingFocus.map((id) => document.getElementById(id)), was = sheet;
    const target = els.find((el) => {
      const fold = el?.closest('details:not([open])') as HTMLDetailsElement | null;
      if (fold) fold.open = true;
      if (el?.closest('#ws-add')) setSheet('add'); else if (el?.closest('#ws-panel')) setSheet('panel');
      if (el && (el.checkVisibility?.() ?? el.getClientRects().length > 0)) return true; // checkVisibility: Safari 17.4+, Chrome 105+
      if (fold) fold.open = false;
      setSheet(was);
      return false;
    });
    pendingFocus = [];
    const gated = target ? undefined : els.find(depthFor);
    if (gated) return depthHint(gated, depthFor(gated)!);
    target?.focus();
    target?.scrollIntoView({ block: 'nearest' });
  };
  /** The depth that shows `el` when it is deeper than the current one; null when it is shown here or hidden for another reason. */
  const depthFor = (el: HTMLElement | null): Depth | null => {
    const d = currentDepth();
    if (el?.closest('[data-min-depth="ky-su"]') && d !== 'ky-su') return 'ky-su';
    return el?.closest('[data-min-depth]') && d === 'co-ban' ? 'tho' : null;
  };
  /**
   * Every target of a fix is detail of a deeper depth (a load plan for Thợ, the dispatch policy for Kỹ sư): say so at the top of the
   * panel with a button that switches, instead of doing nothing. After the switch the target takes the focus.
   */
  const depthHint = (el: HTMLElement, need: Depth) => {
    const hint = h('p', { id: 'depth-hint', role: 'status' }, `Mục này sửa ở chế độ ${DEPTH_LABEL[need]}. `,
      h('button', { id: `to-${need}`, type: 'button', onClick: () => { setDepth(need); hint.remove(); document.getElementById(el.id)?.focus(); } }, `Chuyển sang ${DEPTH_LABEL[need]}`));
    panel.querySelector('#depth-hint')?.remove();
    panel.prepend(hint);
    hint.querySelector('button')!.focus();
  };

  // ---- chrome -------------------------------------------------------------------------------------------------------
  const top = h('header', { id: 'ws-top' });
  const steps = h('nav', { id: 'ws-steps', 'aria-label': 'Các bước' });
  const tabs = h('div', { id: 'ws-tabs', role: 'tablist' });
  const panel = h('section', { id: 'ws-panel', role: 'tabpanel', tabIndex: -1 }); // "Tới bảng bước" focuses it
  // the two live regions (status line, health bar) are built once and only their text changes: one inserted already filled is usually not read out
  const status = h('p', { id: 'status', role: 'status' });
  const health = h('footer', { id: 'ws-health', 'aria-live': 'polite' });
  // one 3D view for the whole workspace: it outlives step and tab changes; selecting or dragging in it works on every tab
  // only tabs that show the selection repaint; any other tab keeps what is being typed into it and swaps just the inspector
  const selectionChanged = () => { if (tab && SHOWS_SELECTION.includes(tab)) void renderPanel(); else repaintSelection(); };
  const pick = (ids: string[]) => { if (choose(ids)) selectionChanged(); }; // equal selection (e.g. empty ground clicked twice): nothing repaints
  /** A pick in the view shows "Đang chọn" on top of the panel; on a phone the step panel opens over the view to show it, unless it came with a drag. */
  const viewPick = (ids: string[], shown = true) => {
    if (!choose(ids)) return;
    if (shown && selection.length) { setSheet('panel'); panel.scrollTop = 0; }
    selectionChanged();
  };
  const view = createViewport({
    project: () => project, selection: () => selection, apply: (next) => saved(next), selected: () => selected,
    setSelection: viewPick, select: (id) => viewPick([id]), remove: (ids) => { void requestDelete(ids); },
    replay: () => simState.runs.find((r) => r.source.kind === 'current')?.result ?? null,
  });

  // ---- "Đang chọn" on top of the panel; kept while project and selection stay, so an open preview survives other repaints ----
  let insp: { el: HTMLElement; project: Project; key: string } | null = null, inspOpen: 'delete' | undefined;
  // the one live region for "Đang chọn": built once, never repainted (a region inserted already filled is usually not read out)
  const said = h('p', { id: 'ws-said', className: 'sr-only', 'aria-live': 'polite' });
  let spoken: string | null = null; // what it would say now; the first paint is not news
  const speak = (el: HTMLElement) => {
    const status = el.querySelector('#insp-status')?.textContent ?? '', name = el.querySelector('h2 + p:not(#insp-status)')?.textContent;
    const text = name ? `Đang chọn ${name}. ${status}` : status;
    if (spoken !== null && text !== spoken) said.textContent = text;
    spoken = text;
  };
  const inspector = (): HTMLElement => {
    const key = selection.join(',');
    if (insp?.project !== project || insp.key !== key || inspOpen) {
      insp = { project, key, el: renderInspector({
        project, selection, findings: validateDesign(project), components: [...BUILTIN_COMPONENTS, ...userComponents], offers: [...BUILTIN_OFFERS, ...userOffers],
        apply: saved, select: pick, go: goTarget, open: inspOpen,
      }) };
      inspOpen = undefined;
      speak(insp.el);
    }
    return insp.el;
  };
  const paintInspector = () => panel.querySelector('#inspector')?.replaceWith(inspector());
  /** The quote's rows of the selected models, highlighted where they are (the same keys renderQuote gets as selectedKeys). */
  const quoteKeys = () => selection.flatMap((id) => { const r = project.instances.find((i) => i.instanceId === id)?.componentRef; return r ? [`design:${refKey(r)}`] : []; });
  const markQuoteRows = () => {
    const keys = new Set(quoteKeys());
    for (const tr of panel.querySelectorAll<HTMLElement>('#quote-table tr[data-key]')) {
      const on = keys.has(tr.dataset.key!.replace(/:kit$/, ''));
      tr.classList.toggle('selected', on);
      tr.setAttribute('aria-selected', String(on));
    }
  };
  /** A new selection on a tab that does not draw it: the view, the inspector and the quote's highlight; nothing being typed is touched. */
  const repaintSelection = () => { view.refresh(); paintInspector(); markQuoteRows(); };
  /** Select `ids` and show what deleting them takes along, focus on its confirm button (the Delete key in 3D, "Xóa" in the device list). */
  const requestDelete = async (ids: string[]) => {
    choose(ids); inspOpen = 'delete'; setSheet('panel');
    if (tab && SHOWS_SELECTION.includes(tab)) await renderPanel(null); else repaintSelection();
    document.getElementById('insp-confirm')?.focus();
  };
  // the add palette: rebuilt only when the project or the user's catalog changed (a model just made is offered), so its preview is
  // never stale and an open block survives other repaints
  let palette = h('aside', { id: 'ws-add' }), paletteOf: Project | null = null, paletteCat = '';
  const paintPalette = () => {
    const cat = JSON.stringify([userComponents, userOffers]);
    if (paletteOf === project && paletteCat === cat) return;
    const next = renderPalette({ project, components: [...BUILTIN_COMPONENTS, ...userComponents], offers: [...BUILTIN_OFFERS, ...userOffers], apply: saved, fold: addFold });
    palette.replaceWith(next); palette = next; paletteOf = project; paletteCat = cat;
  };
  /** The design's "Mái nhà 3D" and the roof's "Sơ đồ điện" also switch the view to what they name. */
  const goView = (t: Tab) => { if (t === 'mai') view.setMode('3d'); else if (t === 'thiet-ke') view.setMode('diagram'); go(t); };
  // phones: Thêm and the step panel are sheets over the view, above the health bar; tap to open or close
  // ponytail: tap only, no drag gesture; add dragging if UAT asks for it
  const sheetButton = (s: 'add' | 'panel', label: string) => h('button', { id: `sheet-${s}`, type: 'button', 'aria-expanded': 'false', 'aria-controls': s === 'add' ? 'ws-add' : 'ws-panel',
    onClick: () => { if (s === 'add') addFold.open = palette.querySelector('details')!.open = true; setSheet(sheet === s ? null : s); } }, `${label} `, h('span', { 'aria-hidden': 'true' }, '▲'));
  const sheets = h('div', { id: 'ws-sheets' }, sheetButton('add', 'Thêm'), sheetButton('panel', 'Bảng bước'));
  function setSheet(s: typeof sheet) {
    sheet = s;
    ws.dataset.sheet = s ?? '';
    for (const b of sheets.children) b.setAttribute('aria-expanded', String(b.id === `sheet-${s}`));
  }
  // focus order: top bar, steps, Thêm, view, tabs, panel, health bar; the view starts with a way past its controls
  view.el.prepend(h('button', { id: 'skip-panel', type: 'button', className: 'skip', onClick: () => { setSheet('panel'); panel.focus(); } }, 'Tới bảng bước'));
  top.append(status);
  const ws = h('div', { id: 'ws' }, top, steps, h('div', { id: 'ws-main' }, palette, view.el, tabs, panel), sheets, health, said);
  // phones: Esc in an open sheet (or on its button) closes it; focus goes back to the button
  ws.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !sheet || !narrow.matches || !(e.target as Element).closest('#ws-add, #ws-panel, #ws-sheets')) return;
    const b = document.getElementById(`sheet-${sheet}`);
    setSheet(null);
    b?.focus();
  });
  const help = h('details', { id: 'ws-help' }, h('summary', {}, 'Trợ giúp'),
    h('button', { id: 'lessons-btn', type: 'button', onClick: () => { location.hash = formatRoute({ kind: 'help', page: 'bai-hoc' }); } }, 'Bài học'),
    h('button', { id: 'ws-about', type: 'button', onClick: () => { location.hash = formatRoute({ kind: 'help', page: 'phien-ban' }); } }, 'Phiên bản và phạm vi kiểm chứng'),
    h('button', { id: 'ws-export-all', type: 'button', onClick: async () => { download('mekoniq-tat-ca-du-an.json', await exportAll(repo)); } }, 'Xuất tất cả dự án (sao lưu)'));
  help.addEventListener('click', (e) => { if ((e.target as Element).closest('button')) help.open = false; }); // a picked item closes the menu
  const home = h('button', { id: 'ws-home', type: 'button', onClick: () => { say(''); location.hash = formatRoute({ kind: 'home' }); } }, 'Danh sách dự án');
  /** Cơ bản · Thợ · Kỹ sư: the stylesheet hides detail by depth, so nothing repaints; only the pressed button changes. */
  const setDepth = (d: Depth) => {
    applyDepth(d); writeDepth(d);
    for (const b of top.querySelectorAll('#ws-depth button')) b.setAttribute('aria-pressed', String(b.id === `depth-${d}`));
  };
  const depthSwitch = () => h('div', { id: 'ws-depth', role: 'group', 'aria-label': 'Mức chi tiết' },
    ...(Object.keys(DEPTH_LABEL) as Depth[]).map((d) => h('button', { id: `depth-${d}`, type: 'button', 'aria-pressed': String(d === currentDepth()), onClick: () => setDepth(d) }, DEPTH_LABEL[d])));

  // phones: the top bar is one row (name, revision, "⋯"); home, undo/redo, depth and help go in the "⋯" menu, built once so it stays open
  const narrow = matchMedia('(max-width: 719px)');
  const moreItems = h('div', { className: 'more-items' });
  const moreSummary = h('summary', { 'aria-label': 'Tùy chọn' }, '⋯');
  const more = h('details', { id: 'ws-more' }, moreSummary, moreItems);
  const closeMore = () => { more.open = false; moreSummary.focus(); };
  more.addEventListener('keydown', (e) => { if (e.key === 'Escape' && more.open) closeMore(); });
  // focus leaving the open menu closes it, so it never covers what gets focus next. Focus going nowhere (a click on the page, or
  // a repaint replacing the focused item) is checked after the repaint has put it back
  const shut = () => { if (!more.contains(document.activeElement)) more.open = false; };
  more.addEventListener('focusout', (e) => { const to = e.relatedTarget as Node | null; if (!to) setTimeout(shut); else if (!more.contains(to)) more.open = false; });
  moreItems.addEventListener('click', (e) => { if ((e.target as Element).closest('button')) closeMore(); }); // a used item closes the menu
  narrow.addEventListener('change', paintChrome);
  function paintChrome() {
    const hist = historyFor(edited);
    const name = h('h2', { id: 'ws-name' }, project.name), rev = h('span', { id: 'ws-rev' }, stored ? `Đã lưu · r${project.revision}` : UNSAVED);
    const badge = isSample(project) && h('span', { id: 'ws-badge' }, SAMPLE_TAG);
    const tools = [home,
      h('button', { id: 'ws-undo', type: 'button', disabled: !hist.canUndo, onClick: hist.undo }, 'Hoàn tác'),
      h('button', { id: 'ws-redo', type: 'button', disabled: !hist.canRedo, onClick: hist.redo }, 'Làm lại'),
      depthSwitch(), help];
    moreItems.replaceChildren(...(narrow.matches ? tools : []));
    // the other tab's revision: this tab's undo steps are older copies, and undoing one would quietly save it over that work
    const latest = async () => { project = (await repo.loadRevision(project.projectId))!; history.clear(); say(''); await renderPanel(); };
    for (const c of [...top.childNodes]) if (c !== status) c.remove(); // the status line stays the same node, last
    status.before(...[
      h('h1', {}, 'Mekoniq Solar Lab'),
      ...(narrow.matches ? [name, rev, more, badge] : [home, name, badge, rev, ...tools.slice(1)]),
      message().includes('Mở bản mới nhất') && h('button', { id: 'ws-latest', type: 'button', onClick: latest }, 'Mở bản mới nhất')].filter(Boolean) as Node[]);
    if (status.textContent !== message()) status.textContent = message();
    paintHealth();
  }
  function paintHealth() {
    paintHealthBar(health, healthOf(project, auto), goTarget);
    const shown = health.querySelector('#ws-fresh');
    if (fresh && !shown) health.append(h('button', { id: 'ws-fresh', type: 'button', onClick: () => { void renderPanel(); } }, 'Có kết quả mới · Hiện'));
    else if (!fresh) shown?.remove();
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
   * The bar shows the run at once. Of the panel only the progress list, the system screen and a PV screen that could not run (its
   * shade was still being computed) show it: they repaint, unless a field in the panel is being typed into or a manual run is going
   * there; then "Hiện" offers the repaint.
   */
  const autoDone = () => {
    const a = document.activeElement, shows = tab === 'he-thong' || (tab === 'pv' && !!panel.querySelector('#compile-issues'));
    fresh = shows && (simState.busy || (!!a && panel.contains(a) && a.matches('input, select, textarea')));
    paintHealth();
    if (shows && !fresh) return void renderPanel();
    const items = progressItems();
    panel.querySelector('#checklist')?.replaceWith(...(progressComplete(items) ? [] : [checklist(items)]));
  };
  const progressItems = () => progressOf(project, { simRan: auto.kind === 'done' }); // done is always for the current project
  function paintNav() {
    const def = STEPS.find((s) => s.id === step)!;
    steps.replaceChildren(...STEPS.map((s) => h('button', { id: `step-${s.id}`, type: 'button', 'aria-current': s.id === step ? 'step' : undefined, onClick: () => { setSheet('panel'); if (s.id !== step) navigate(s.id, s.tabs[0]!.id); } }, `${s.n} ${s.label}`)));
    tabs.setAttribute('aria-label', def.label);
    tabs.replaceChildren(...def.tabs.map((x) => h('button', { id: x.elId, type: 'button', role: 'tab', 'aria-selected': String(x.id === tab), 'aria-controls': 'ws-panel', onClick: () => { setSheet('panel'); navigate(step, x.id); } }, x.label)));
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
        project, components: [...BUILTIN_COMPONENTS, ...userComponents], offers: [...BUILTIN_OFFERS, ...userOffers], selected, selectedCode,
        select: (id, focusIds = [], code) => { choose(id ? [id] : []); selectedCode = code ?? null; pendingFocus = focusIds; void again(); },
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
        onReplayStep: (st) => { if (tab === 'he-thong') view.setReplay(st); }, // a late render must not paint flows over another tab
      });
    },
    'du-toan': async () => {
      await reload();
      const p = project;
      return renderQuote({
        project: p, offers: [...BUILTIN_OFFERS, ...userOffers], revisions: await repo.listRevisions(p.projectId),
        loadRevision: (n) => repo.loadRevision(p.projectId, n), saveOffer: (o) => repo.saveOffer(o),
        apply: async (next) => { await mutate(next); await edited(); },
        selectedKeys: quoteKeys(),
        select: pick,
      });
    },
    'thiet-bi': async () => { await reload(); return renderCatalog({ project, repo, mutate, rerender: () => { void edited(); }, say }); },
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
      if (tab === 'he-thong') view.setReplay(null); // the replay's sun and flows belong to the system screen
      if (tab === 'du-an') recordedOpen = false;
      panel.replaceChildren(); // never show the previous tab's controls under the new tab
    }
    step = s; tab = t;
    await reload();
    paintNav();
    if (coach) { coach = false; startCoach({ view: view.el, panel, health }, () => tabs.querySelector<HTMLElement>('[aria-selected="true"]')?.focus()); }
    await renderPanel(keep);
  }

  return {
    projectId: initial.projectId,
    get stored() { return stored; },
    show,
    dispose() { disposed = true; seq++; autorun.cancel(); stopShadePlayback(); view.dispose(); narrow.removeEventListener('change', paintChrome); },
  };
}
