import { BUILTIN_COMPONENTS, BUILTIN_OFFERS, filterComponents, offersFor } from '../catalog/catalog';
import { capabilities, blankSpecs, cloneForEdit } from '../domain/component';
import { diff } from '../domain/diff';
import { newId, nowIso } from '../domain/ids';
import { addInstances, createProject, openLamHa } from '../domain/project';
import { KINDS, KIND_LABEL, SPEC_DEFS, type Kind } from '../domain/specs';
import { refKey, type Component, type Offer, type Project } from '../domain/types';
import { formatNumber } from '../domain/units';
import { buildQuote } from '../cost/quote';
import { exportProject, stageImport } from '../persistence/exchange';
import { commitPackage, isQuotaError, storageEstimate } from '../persistence/import';
import { isPackage, stagePackage } from '../reports/package';
import { backupBeforeUpgrade, deleteBackup, exportAll, listBackups, restoreBackup, stageBackup, BACKUP_FORMAT } from '../persistence/backup';
import { renderAbout } from './about';
import { freshLessons, renderLessons } from './lessons';
import { freshReport, renderReport } from './report';
import { freshImported, renderImported } from './imported';
import { renderQuote } from './quote';
import { renderDesign } from './design';
import { renderPv } from './pv';
import { renderSim, type SimState } from './sim';
import { renderRoof, releaseRoofView, type RoofState } from './roof';
import { renderShade, releaseShadeView, type ShadeState } from './shade';
import { ALL_LAYERS } from '../scene/three-view';
import { BUNDLED_WEATHER, loadBundledWeather } from '../weather/bundled';
import type { PvResult } from '../engine/pv';
import { History } from '../app/history';
import { ConflictError, ProjectRepository } from '../persistence/repository';
import { componentForm } from './component-form';
import { download, h } from './dom';

const vnd = (minor: string) => Number(minor).toLocaleString('vi-VN') + ' đ';
const HEADLINE: Record<Kind, string> = { panel: 'pstcW', inverter: 'acRatedW', battery: 'nominalWh', controller: 'ratedW', load: 'powerW' };
const AUTHOR = 'người dùng';

export async function startApp(root: HTMLElement) {
  const upgrade = await backupBeforeUpgrade(); // copy of the user's work BEFORE the schema moves
  const repo = await ProjectRepository.open();
  let project: Project | null = null;
  let userComponents: Component[] = [];
  let userOffers: Offer[] = [];
  let message = upgrade.backedUp ? `Đã sao lưu ${upgrade.projects} dự án trước khi nâng cấp kho dữ liệu (từ v${upgrade.fromVersion}).` : upgrade.error ? `Không sao lưu được trước khi nâng cấp kho dữ liệu: ${upgrade.error}. Hãy bấm "Xuất tất cả" để giữ một bản.` : '';
  const history = new History<Project>();
  let selected: string | null = null;
  let pendingFocus: string[] = [];
  let selection: string[] = []; // selected panel instance ids, shared by the diagram, the roof views and the BOM
  let roofState: RoofState = { layers: ALL_LAYERS, faceId: null, angle: 0, stepCm: 5, fps: null };
  let roofActive = false;
  let shadeActive = false;
  let shadeState: ShadeState = { date: null, step: 0, scenes: [], dayEnergy: null, stepLabel: '' };
  let lastPvResult: PvResult | null = null;
  let lessonState = freshLessons();
  let reportState = freshReport();
  let importedState = freshImported();
  let importIssues: { code: string; severity: string; field: string; message: string }[] = [];
  let simState: SimState = { runs: [], side: 0, step: 0, progress: {} };
  let filter: { kind: Kind | 'all'; text: string } = { kind: 'all', text: '' };

  const say = (m: string) => { message = m; };
  const reload = async () => { [userComponents, userOffers] = [await repo.listComponents(), await repo.listOffers()]; };
  const save = async (next: Project): Promise<boolean> => {
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
  const show = (...kids: (Node | false)[]) => {
    if (!roofActive) releaseRoofView();
    if (!shadeActive) releaseShadeView();
    roofActive = false; shadeActive = false;
    root.replaceChildren(h('h1', {}, 'Mekoniq Solar Lab'), message && h('p', { role: 'status', id: 'status' }, message), ...kids.filter(Boolean) as Node[]);
  };

  // ---- home ---------------------------------------------------------------------------------
  async function home() {
    history.clear(); selected = null; selection = []; shadeState = { date: null, step: 0, scenes: [], dayEnergy: null, stepLabel: '' }; reportState = freshReport(); importedState = freshImported(); lastPvResult = null; simState = { runs: [], side: 0, step: 0, progress: {} };
    const heads = await repo.listProjects(), backups = await listBackups();
    const name = h('input', { name: 'name', value: 'Dự án mới', required: true });
    const file = h('input', { type: 'file', accept: 'application/json,.json', id: 'import-file' });
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      if (!f) return;
      const text = await f.text(), ids = new Set((await repo.listProjects()).map((x) => x.projectId));
      if (isPackage(text)) return void (await importPackage(text, ids));
      if (text.slice(0, 500).includes(BACKUP_FORMAT)) return void (await importBackupFile(text, ids));
      const staged = await stageImport(text, ids);
      if (!staged.ok) {
        say('Không nhập được file; dự án hiện có không bị thay đổi.');
        show(...issueList(staged.issues), h('button', { onClick: () => home() }, 'Quay lại'));
        return;
      }
      try { project = await repo.createProject(staged.project); }
      catch (e) {
        say('Không nhập được file; dự án hiện có không bị thay đổi.');
        show(...issueList([{ code: isQuotaError(e) ? 'STORAGE_FULL' : 'STORAGE_ERROR', severity: 'error', field: '/', message: isQuotaError(e) ? 'Hết dung lượng lưu trữ của trình duyệt. Xóa bớt dự án hoặc dữ liệu cũ rồi thử lại.' : (e as Error).message }]), h('button', { onClick: () => home() }, 'Quay lại'));
        return;
      }
      say(staged.renamed ? 'ID trùng: đã nhập thành bản sao mới.' : 'Đã nhập dự án.');
      // a hand-edited file (hash differs) or other warnings must be seen before the work starts, not dropped
      if (staged.issues.length) show(...issueList(staged.issues), h('button', { id: 'open-imported', onClick: () => projectScreen() }, 'Mở dự án'));
      else projectScreen();
    });
    show(
      h('form', { onSubmit: async (e: Event) => { e.preventDefault(); project = await repo.createProject(createProject(name.value)); say(''); projectScreen(); } },
        h('label', {}, 'Tên dự án ', name), h('button', { type: 'submit' }, 'Tạo dự án')),
      h('button', { type: 'button', onClick: async () => { project = await repo.createProject(openLamHa()); say(''); projectScreen(); } }, 'Mở mẫu Lâm Hà'),
      h('label', {}, 'Nhập dự án hoặc gói (JSON) ', file), h('p', { id: 'storage-note' }),
      h('button', { id: 'export-all', type: 'button', onClick: async () => { download('mekoniq-tat-ca-du-an.json', await exportAll(repo)); } }, 'Xuất tất cả dự án (sao lưu)'),
      ...backups.map((b) => h('p', { className: 'backup', 'data-backup': b.name }, `Có bản sao lưu tự động trước khi nâng cấp kho từ v${b.fromVersion}. `,
        h('button', { className: 'restore-backup', onClick: async () => { try { const r = await restoreBackup(repo, b.name); say(`Đã khôi phục ${r.restored} dự án (bản mới nhất của từng dự án, không kèm lịch sử revision; bản sao lưu vẫn giữ nguyên)${r.copies ? `; ${r.copies} dự án trùng ID được khôi phục thành bản sao` : ''}.`); } catch (e) { say(`${isQuotaError(e) ? 'Hết dung lượng.' : 'Lỗi lưu trữ.'} Khôi phục dở: ${(e as Error).message}. Bản sao lưu vẫn còn nguyên.`); } await home(); } }, 'Khôi phục'),
        h('button', { className: 'delete-backup', onClick: async () => { await deleteBackup(b.name); await home(); } }, 'Xóa bản sao lưu'))),
      h('button', { id: 'about-btn', type: 'button', onClick: async () => show(...(await renderAbout(() => { void home(); }))) }, 'Phiên bản và phạm vi kiểm chứng'),
      h('button', { id: 'lessons-home-btn', type: 'button', onClick: () => lessonsScreen(() => home(), 'Về danh sách') }, 'Bài học'),
      h('h2', {}, 'Dự án đã lưu'),
      heads.length ? h('ul', { id: 'saved' }, ...heads.map((p) => h('li', {},
        h('button', { onClick: async () => { project = (await repo.loadRevision(p.projectId))!; say(''); projectScreen(); } }, `Mở: ${p.name}`),
        ` · bản nháp, revision ${p.headRevision}`))) : h('p', {}, 'Chưa có dự án.'));
    void storageEstimate().then((e) => { const n = document.getElementById('storage-note'); if (n && e) n.textContent = `Bộ nhớ trình duyệt: đã dùng ${(e.usage / 1e6).toFixed(1)} MB trên ${(e.quota / 1e6).toFixed(0)} MB.`; });
  }

  async function importPackage(text: string, ids: ReadonlySet<string>) {
    const staged = await stagePackage(text, ids);
    if (!staged.ok) { say('Không nhập được gói; dự án hiện có không bị thay đổi.'); show(...issueList(staged.issues), h('button', { onClick: () => home() }, 'Quay lại')); return; }
    const done = await commitPackage(repo, staged);
    if (!done.ok) { say('Không nhập được gói; dự án hiện có không bị thay đổi.'); show(...issueList(done.issues), h('button', { onClick: () => home() }, 'Quay lại')); return; }
    project = done.project; importIssues = done.issues; importedState = freshImported();
    say(staged.renamed ? 'ID trùng: đã nhập thành bản sao mới.' : 'Đã nhập gói.');
    await importedScreen();
  }

  async function importBackupFile(text: string, ids: ReadonlySet<string>) {
    const staged = await stageBackup(text, ids);
    if (!staged.ok) { say('Không nhập được file sao lưu; dự án hiện có không bị thay đổi.'); show(...issueList(staged.issues), h('button', { onClick: () => home() }, 'Quay lại')); return; }
    try { for (const it of staged.items) await repo.createProject(it.project); }
    catch (e) { say(`${isQuotaError(e) ? 'Hết dung lượng lưu trữ.' : 'Lỗi lưu trữ.'} Nhập dở: ${(e as Error).message}. Các dự án đã nhập trước đó vẫn còn; dự án hiện có không bị thay đổi.`); return void (await home()); }
    say(`Đã nhập ${staged.items.length} dự án từ file sao lưu${staged.items.some((i) => i.renamed) ? ' (ID trùng được nhập thành bản sao)' : ''}.`);
    const warn = staged.items.flatMap((i) => i.issues.map((x) => ({ ...x, message: `${i.project.name}: ${x.message}` })));
    if (warn.length) show(...issueList(warn), h('button', { id: 'back-home', onClick: () => home() }, 'Tiếp tục'));
    else await home();
  }

  const issueList = (issues: { code: string; severity: string; field: string; message: string }[]) =>
    [h('ul', { id: 'issues' }, ...issues.map((i) => h('li', {}, `${i.severity === 'error' ? 'Lỗi' : 'Cảnh báo'} ${i.code} tại ${i.field || '/'}: ${i.message}`)))];

  // ---- project --------------------------------------------------------------------------------
  async function projectScreen() {
    const p = project!;
    const q = buildQuote(p);
    const revs = await repo.listRevisions(p.projectId);
    const recorded = await repo.getRecorded(p.projectId);
    const labelOf = (key: string) => p.snapshots.components.find((c) => `${c.modelId}@${c.revision}` === key)?.name ?? key;
    const diffOut = h('div', { id: 'diff' });
    show(
      h('section', { 'aria-label': 'Bản thiết kế nháp' },
        h('h2', {}, p.name), h('p', {}, `Bản nháp · revision ${p.revision}`),
        h('ul', { id: 'devices' }, ...Object.entries(q.deviceCounts).map(([k, n]) => h('li', {}, `${n} × ${labelOf(k)}`))),
        h('p', { id: 'bom-total' }, p.instances.length ? `Tổng phần đã biết (chưa VAT): ${vnd(q.knownSubtotalMinor)}${q.complete ? '' : ' · tổng hoàn chỉnh: chưa đủ'}` : 'Chưa có linh kiện.')),
      h('button', { id: 'design-btn', onClick: () => designScreen() }, 'Thiết kế'),
      h('button', { id: 'roof-btn', onClick: () => roofScreen() }, 'Mái nhà 3D'),
      h('button', { id: 'shade-btn', onClick: () => shadeScreen() }, 'Bóng che'),
      h('button', { id: 'pv-btn', onClick: () => pvScreen() }, 'Mô phỏng PV'),
      h('button', { id: 'sim-btn', onClick: () => simScreen() }, 'Hệ thống (pin, tải, bơm)'),
      h('button', { id: 'report-btn', onClick: () => reportScreen() }, 'Báo cáo và chia sẻ'),
      h('button', { id: 'lessons-btn', onClick: () => lessonsScreen(() => projectScreen(), 'Quay lại dự án') }, 'Bài học'),
      !!recorded && h('button', { id: 'recorded-btn', onClick: () => { importIssues = []; void importedScreen(); } }, 'Kết quả đã ghi từ gói'),
      h('button', { onClick: () => quoteScreen() }, 'Dự toán'),
      h('button', { onClick: () => catalogScreen() }, 'Thiết bị'),
      h('button', { onClick: async () => download(`${p.name}.json`, await exportProject(p)) }, 'Xuất JSON'),
      h('button', { onClick: async () => { project = await repo.cloneProject(p.projectId); say('Đã nhân bản dự án.'); projectScreen(); } }, 'Nhân bản dự án'),
      message.includes('Mở bản mới nhất') && h('button', { onClick: async () => { project = (await repo.loadRevision(p.projectId))!; say(''); projectScreen(); } }, 'Mở bản mới nhất'),
      h('button', { onClick: () => { say(''); home(); } }, 'Quay lại'),
      h('h3', {}, 'Lịch sử revision'),
      h('ol', { id: 'revisions' }, ...revs.map((r, i) => h('li', {}, `revision ${r.revision} · ${r.savedAt} `,
        i > 0 && h('button', { onClick: async () => {
          const [a, b] = await Promise.all([repo.loadRevision(p.projectId, revs[i - 1].revision), repo.loadRevision(p.projectId, r.revision)]);
          const changes = diff(a, b).filter((c) => !c.path.endsWith('/updatedAt') && c.path !== '/revision');
          diffOut.replaceChildren(h('ul', {}, ...changes.slice(0, 50).map((c) => h('li', {}, `${c.path}: ${JSON.stringify(c.before)} → ${JSON.stringify(c.after)}`))));
        } }, `So với revision ${revs[i - 1].revision}`)))),
      diffOut);
  }

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
  async function shadeScreen() {
    const p = project!;
    const loadWeather = async (id: string) => {
      if (BUNDLED_WEATHER.some((b) => b.id === id)) { const r = await loadBundledWeather(id); return r?.ok ? r.series : undefined; }
      return repo.getWeather(id);
    };
    const nodes = await renderShade({
      project: p, revisions: await repo.listRevisions(p.projectId), selection, state: shadeState, loadRevision: (n) => repo.loadRevision(p.projectId, n), loadWeather,
      apply: async (next) => { await mutate(next); if (!message) say(`Đã lưu: revision ${project!.revision}`); await shadeScreen(); },
      setSelection: (ids) => { setSelection(ids); void shadeScreen(); }, rerender: () => { void shadeScreen(); },
      back: () => projectScreen(), goRoof: () => roofScreen(), goPv: () => pvScreen(),
    });
    shadeActive = true;
    show(...nodes);
  }

  const weatherLoader = async (id: string) => {
    if (BUNDLED_WEATHER.some((b) => b.id === id)) { const r = await loadBundledWeather(id); return r?.ok ? r.series : undefined; }
    return repo.getWeather(id);
  };
  async function importedScreen() {
    const p = project!, recorded = await repo.getRecorded(p.projectId);
    if (!recorded) { say('Dự án này không có kết quả đã ghi từ gói.'); return projectScreen(); }
    show(...(importIssues.length ? issueList(importIssues) : []), ...(await renderImported({
      project: p, recorded, loadWeather: weatherLoader, state: importedState, rerender: () => { void importedScreen(); }, open: () => projectScreen(), back: () => { say(''); void home(); },
    })));
  }
  async function reportScreen() {
    const p = project!;
    show(...(await renderReport({
      project: p, revisions: await repo.listRevisions(p.projectId), state: reportState, buildId: __BUILD_ID__, loadRevision: (n) => repo.loadRevision(p.projectId, n), loadWeather: weatherLoader,
      apply: async (next) => { await mutate(next); if (!message) say(`Đã lưu: revision ${project!.revision}`); await reportScreen(); }, rerender: () => { void reportScreen(); }, back: () => projectScreen(), goPv: () => pvScreen(),
    })));
  }
  async function lessonsScreen(back: () => void, backLabel: string) {
    show(...renderLessons({ state: lessonState, rerender: () => { void lessonsScreen(back, backLabel); }, back, backLabel }));
  }

  async function roofScreen() {
    roofActive = true;
    const p = project!;
    const keep = focusKey();
    show(...renderRoof({
      project: p, selection, state: roofState,
      apply: async (next) => { await mutate(next); if (!message) say(`Đã lưu: revision ${project!.revision}`); await roofScreen(); },
      setSelection: (ids) => { setSelection(ids); void roofScreen(); }, rerender: () => { void roofScreen(); },
      history: historyFor(roofScreen), back: () => projectScreen(), goDesign: () => designScreen(), goShade: () => shadeScreen(),
    }));
    if (keep) root.querySelector<HTMLElement | SVGElement>(keep)?.focus({ preventScroll: true }); // synchronous: no key can arrive in between
  }

  async function designScreen() {
    await reload();
    const p = project!;
    const step = async (to: Project | undefined, revert: () => void) => {
      if (to) { if (await save(to)) say(`Đã lưu: revision ${project!.revision}`); else revert(); }
      await designScreen();
    };
    show(...renderDesign({
      project: p, components: [...BUILTIN_COMPONENTS, ...userComponents], offers: [...BUILTIN_OFFERS, ...userOffers], selected,
      select: (id, focusIds = []) => { selected = id; const st = id ? project!.strings?.find((x) => x.stringId === id) : undefined; if (st) selection = [...st.panelIds]; pendingFocus = focusIds; designScreen(); },
      openRoof: () => roofScreen(),
      apply: async (next) => { await mutate(next); if (!message) say(`Đã lưu: revision ${project!.revision}`); await designScreen(); },
      history: {
        canUndo: history.canUndo, canRedo: history.canRedo,
        undo: () => { const cur = project!; const prev = history.undo(cur); step(prev, () => history.redo(prev!)); },
        redo: () => { const cur = project!; const nxt = history.redo(cur); step(nxt, () => history.undo(nxt!)); },
      },
      back: () => projectScreen(),
    }));
    const target = pendingFocus.map((id) => document.getElementById(id)).find(Boolean);
    pendingFocus = [];
    target?.focus();
  }

  async function pvScreen() {
    const p = project!;
    const stored = await repo.listWeather();
    const loadWeather = async (id: string) => {
      if (BUNDLED_WEATHER.some((b) => b.id === id)) { const r = await loadBundledWeather(id); return r?.ok ? r.series : undefined; }
      return repo.getWeather(id);
    };
    show(...(await renderPv({
      project: p,
      choices: [...BUNDLED_WEATHER.map((b) => ({ id: b.id, label: b.label, origin: 'bundled' as const })), ...stored.map((s) => ({ id: s.seriesId, label: s.name, origin: 'stored' as const }))],
      loadWeather, saveWeather: (s) => repo.saveWeather(s),
      apply: async (next) => { await mutate(next); if (!message) say(`Đã lưu: revision ${project!.revision}`); await pvScreen(); },
      lastResult: lastPvResult, setResult: (r) => { lastPvResult = r; }, rerender: () => { void pvScreen(); }, back: () => projectScreen(),
    })));
  }

  async function simScreen() {
    await reload();
    const p = project!;
    const loadWeather = async (id: string) => {
      if (BUNDLED_WEATHER.some((b) => b.id === id)) { const r = await loadBundledWeather(id); return r?.ok ? r.series : undefined; }
      return repo.getWeather(id);
    };
    show(...(await renderSim({
      project: p, components: [...BUILTIN_COMPONENTS, ...userComponents], offers: [...BUILTIN_OFFERS, ...userOffers], revisions: await repo.listRevisions(p.projectId),
      loadRevision: (n) => repo.loadRevision(p.projectId, n), loadWeather,
      apply: async (next) => { await mutate(next); if (!message) say(`Đã lưu: revision ${project!.revision}`); await simScreen(); },
      state: simState, rerender: () => { void simScreen(); }, back: () => projectScreen(), goPv: () => pvScreen(),
    })));
  }

  async function quoteScreen() {
    await reload();
    const p = project!;
    show(...renderQuote({
      project: p, offers: [...BUILTIN_OFFERS, ...userOffers], revisions: await repo.listRevisions(p.projectId),
      loadRevision: (n) => repo.loadRevision(p.projectId, n), saveOffer: (o) => repo.saveOffer(o),
      apply: async (next) => { await mutate(next); await quoteScreen(); }, back: () => projectScreen(),
      selectedKeys: selection.flatMap((id) => { const r = p.instances.find((i) => i.instanceId === id)?.componentRef; return r ? [`design:${refKey(r)}`] : []; }),
    }));
  }

  // ---- catalog ----------------------------------------------------------------------------------
  async function catalogScreen() {
    await reload();
    const all = [...BUILTIN_COMPONENTS, ...userComponents];
    const kindSel = h('select', { id: 'filter-kind', 'aria-label': 'Loại' }, h('option', { value: 'all' }, 'Tất cả'),
      ...KINDS.map((k) => h('option', { value: k }, KIND_LABEL[k])));
    kindSel.value = filter.kind;
    const text = h('input', { id: 'filter-text', value: filter.text, placeholder: 'Tìm hãng, tên, SKU', 'aria-label': 'Tìm' });
    const apply = () => { filter = { kind: kindSel.value as Kind | 'all', text: text.value }; catalogScreen(); };
    kindSel.addEventListener('change', apply);
    text.addEventListener('change', apply);
    const newKind = h('select', { id: 'new-kind', 'aria-label': 'Loại thiết bị mới' }, ...KINDS.map((k) => h('option', { value: k }, KIND_LABEL[k])));

    const card = (c: Component) => {
      const hl = c.specs[HEADLINE[c.kind]]?.v;
      const missing = capabilities(c).filter((s) => !s.ok);
      const qty = h('input', { type: 'number', min: 1, value: 1, 'aria-label': `Số lượng ${c.name}`, style: 'width:4rem' });
      const mine = userComponents.includes(c);
      return h('article', { className: 'card', 'data-model': c.modelId },
        h('h3', {}, c.name),
        h('p', {}, `${c.brand} · ${KIND_LABEL[c.kind]} · ${c.condition === 'used' ? 'đã dùng' : 'mới'} · ${c.sku ?? 'chưa rõ SKU'} · revision ${c.revision}` +
          (hl != null ? ` · ${SPEC_DEFS[c.kind][HEADLINE[c.kind]].label} ${formatNumber(hl)} ${c.specs[HEADLINE[c.kind]].u}` : '') +
          (c.review === 'unreviewed' ? ' · chưa kiểm datasheet' : '')),
        missing.length ? h('p', { className: 'missing' }, 'Chưa kiểm được: ' + missing.map((s) => `${s.label} (thiếu ${s.missing.map((k) => SPEC_DEFS[c.kind][k].label).join(', ')})`).join('; '))
          : h('p', {}, 'Đủ thông số cho mọi kiểm tra hiện có.'),
        project && h('label', {}, 'Số lượng ', qty),
        project && h('button', { onClick: async () => {
          await mutate(addInstances(project!, c, Math.max(1, Number(qty.value) | 0), [...BUILTIN_OFFERS, ...userOffers].filter((o) => refKey(o.componentRef) === refKey(c))));
          projectScreen();
        } }, 'Thêm vào dự án'),
        h('button', { onClick: () => formScreen(cloneForEdit(c, newId('mdl'), AUTHOR, nowIso())) }, 'Nhân bản'),
        mine && h('button', { onClick: () => formScreen({ ...c, derivedFrom: c.derivedFrom, editedAt: nowIso() }) }, 'Sửa'));
    };
    show(h('h2', {}, 'Thiết bị'), h('div', {}, kindSel, text),
      h('div', {}, newKind, h('button', { onClick: () => {
        const kind = newKind.value as Kind;
        formScreen({ schemaVersion: 1, modelId: newId('mdl'), sku: null, brand: '', name: '', kind, condition: 'new', specs: blankSpecs(kind), attrs: {},
          datasheet: null, review: 'unreviewed', author: AUTHOR, editedAt: nowIso(), derivedFrom: null });
      } }, 'Tạo thiết bị từ đầu')),
      ...filterComponents(all, filter).map(card),
      h('button', { onClick: () => (project ? projectScreen() : home()) }, 'Quay lại'));
  }

  function formScreen(base: Omit<Component, 'revision'>) {
    show(componentForm(base, async ({ draft }) => {
      const r = await repo.saveComponent({ ...draft, editedAt: nowIso(), author: AUTHOR });
      say(r.created ? `Đã lưu ${draft.name} (revision ${r.ref.revision}).` : `Nội dung kỹ thuật không đổi, giữ revision ${r.ref.revision}.`);
      catalogScreen();
    }, () => catalogScreen()));
  }

  await reload();
  home();
}
