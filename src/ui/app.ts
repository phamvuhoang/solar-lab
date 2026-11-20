import { createProject, openLamHa } from '../domain/project';
import { buildSampleHouse } from '../domain/seed';
import type { Project } from '../domain/types';
import { stageImport } from '../persistence/exchange';
import { commitPackage, isQuotaError } from '../persistence/import';
import { isPackage, stagePackage } from '../reports/package';
import { backupBeforeUpgrade, contentKeys, stageBackup, BACKUP_FORMAT } from '../persistence/backup';
import { renderAbout } from './about';
import { freshLessons, renderLessons } from './lessons';
import { freshImported, renderImported } from './imported';
import { ProjectRepository } from '../persistence/repository';
import { h } from './dom';
import { renderHome } from './home';
import { formatRoute, parseRoute } from './route';
import { openWorkspace, weatherLoader, type Workspace } from './workspace';

export async function startApp(root: HTMLElement) {
  const upgrade = await backupBeforeUpgrade(); // copy of the user's work BEFORE the schema moves
  // another tab opened a newer build that upgraded the store: this tab's connection is gone, so say so now and refuse to pretend to save
  const RELOAD = 'Solar Lab vừa được cập nhật ở một tab khác nên tab này đã ngắt kho dữ liệu. Tải lại trang để làm tiếp (dự án đã lưu vẫn còn nguyên).';
  let reloadNeeded = false;
  const reloadNote = () => h('p', { id: 'reload-needed', role: 'alert' }, RELOAD);
  const repo = await ProjectRepository.open({ onClosed: () => { reloadNeeded = true; if (!document.getElementById('reload-needed')) root.prepend(reloadNote()); } });
  let message = upgrade.backedUp ? `Đã sao lưu ${upgrade.projects} dự án trước khi nâng cấp kho dữ liệu (từ v${upgrade.fromVersion}).` : upgrade.error ? `Không sao lưu được trước khi nâng cấp kho dữ liệu: ${upgrade.error}. Hãy bấm "Xuất tất cả" để giữ một bản.` : '';
  let workspace: Workspace | null = null;
  const lessonState = freshLessons();
  let importedState = freshImported();
  let importIssues: { code: string; severity: string; field: string; message: string }[] = [];
  let routing = 0; // each route() and each home/about paint takes a number; a slower one that finishes late paints nothing
  let preview: 'mau' | 'moi' | null = null; // what the unsaved workspace shows, so Back from a help page finds it again

  const say = (m: string) => { message = m; };
  const paint = (...kids: Node[]) => { root.replaceChildren(...(reloadNeeded ? [reloadNote()] : []), h('h1', {}, 'Mekoniq Solar Lab'), ...kids); };
  const show = (...kids: (Node | false)[]) => paint(...[message && h('p', { role: 'status', id: 'status' }, message), ...kids].filter(Boolean) as Node[]);
  const deps = { root, repo, say, message: () => message, reloadNeeded: () => reloadNeeded, reloadNote };
  const openProject = (projectId: string) => { location.hash = formatRoute({ kind: 'project', projectId, step: 'bo-tri', tab: 'mai' }); };
  const open = (p: Project, stored: boolean) => { workspace?.dispose(); return (workspace = openWorkspace(deps, p, { stored })); };

  // ---- router -------------------------------------------------------------------------------------------------------
  async function route() {
    const my = ++routing;
    const r = parseRoute(location.hash);
    if (!r) { // the bare address: the project worked on last, or (first visit) the sample house, unsaved
      const last = (await repo.listProjects())[0];
      if (my === routing) location.replace(formatRoute(last ? { kind: 'project', projectId: last.projectId, step: 'bo-tri', tab: 'mai' } : { kind: 'preview', what: 'mau' }));
      return;
    }
    if (r.kind === 'home') return home(my);
    if (r.kind === 'help') return r.page === 'bai-hoc' ? lessonsScreen() : aboutScreen(my); // the workspace, if any, waits detached for Back
    if (r.kind === 'preview') {
      if (workspace && !workspace.stored && preview === r.what) return workspace.show();
      preview = r.what; // a reload or a new visit builds a fresh copy: nothing of a preview is stored
      return open(r.what === 'mau' ? buildSampleHouse() : createProject('Dự án mới'), false).show('bo-tri', 'mai');
    }
    if (workspace?.projectId === r.projectId) return workspace.show(r.step, r.tab);
    const p = await repo.loadRevision(r.projectId);
    if (my !== routing) return;
    if (!p) { say('Không tìm thấy dự án này trong trình duyệt (có thể đã bị xóa hoặc đang mở trên máy khác).'); location.replace('#/'); return; }
    await open(p, true).show(r.step, r.tab);
  }
  let moved = false; // the app has changed the address at least once: Back from a help page stays in the app
  window.addEventListener('hashchange', () => { moved = true; void route(); });
  /** Back from a help page: to where it was opened from; opened by its address in a fresh tab, there is nothing behind it: home. */
  const back = () => { if (moved) history.back(); else location.hash = formatRoute({ kind: 'home' }); };

  // ---- home ---------------------------------------------------------------------------------
  async function home(my = ++routing) {
    workspace?.dispose(); workspace = null; importedState = freshImported();
    const nodes = await renderHome({
      repo, say, message: () => message, importFile,
      openLamHa: async () => { const p = await repo.createProject(openLamHa()); say(''); openProject(p.projectId); },
    });
    if (my === routing) paint(...nodes);
  }

  async function importFile(f: File) {
    const text = await f.text(), ids = new Set((await repo.listProjects()).map((x) => x.projectId));
    if (isPackage(text)) return void (await importPackage(text, ids));
    if (text.slice(0, 500).includes(BACKUP_FORMAT)) return void (await importBackupFile(text));
    const staged = await stageImport(text, ids);
    if (!staged.ok) {
      say('Không nhập được file; dự án hiện có không bị thay đổi.');
      show(...issueList(staged.issues), h('button', { onClick: () => home() }, 'Quay lại'));
      return;
    }
    let project: Project;
    try { project = await repo.createProject(staged.project); }
    catch (e) {
      say('Không nhập được file; dự án hiện có không bị thay đổi.');
      show(...issueList([{ code: isQuotaError(e) ? 'STORAGE_FULL' : 'STORAGE_ERROR', severity: 'error', field: '/', message: isQuotaError(e) ? 'Hết dung lượng lưu trữ của trình duyệt. Xóa bớt dự án hoặc dữ liệu cũ rồi thử lại.' : (e as Error).message }]), h('button', { onClick: () => home() }, 'Quay lại'));
      return;
    }
    say(staged.renamed ? 'ID trùng: đã nhập thành bản sao mới.' : 'Đã nhập dự án.');
    // a hand-edited file (hash differs) or other warnings must be seen before the work starts, not dropped
    if (staged.issues.length) show(...issueList(staged.issues), h('button', { id: 'open-imported', onClick: () => openProject(project.projectId) }, 'Mở dự án'));
    else openProject(project.projectId);
  }

  async function importPackage(text: string, ids: ReadonlySet<string>) {
    const staged = await stagePackage(text, ids);
    if (!staged.ok) { say('Không nhập được gói; dự án hiện có không bị thay đổi.'); show(...issueList(staged.issues), h('button', { onClick: () => home() }, 'Quay lại')); return; }
    const done = await commitPackage(repo, staged);
    if (!done.ok) { say('Không nhập được gói; dự án hiện có không bị thay đổi.'); show(...issueList(done.issues), h('button', { onClick: () => home() }, 'Quay lại')); return; }
    importIssues = done.issues; importedState = freshImported();
    say(staged.renamed ? 'ID trùng: đã nhập thành bản sao mới.' : 'Đã nhập gói.');
    await importedScreen(done.project);
  }

  async function importBackupFile(text: string) {
    const staged = await stageBackup(text, await contentKeys(repo));
    if (!staged.ok) { say('Không nhập được file sao lưu; dự án hiện có không bị thay đổi.'); show(...issueList(staged.issues), h('button', { onClick: () => home() }, 'Quay lại')); return; }
    try { for (const it of staged.items) await repo.createProject(it.project); }
    catch (e) { say(`${isQuotaError(e) ? 'Hết dung lượng lưu trữ.' : 'Lỗi lưu trữ.'} Nhập dở: ${(e as Error)?.message}. Các dự án đã nhập trước đó vẫn còn; nhập lại cùng file sau khi giải phóng chỗ sẽ chỉ thêm phần còn thiếu.`); return void (await home()); }
    say(`Đã nhập ${staged.items.length} dự án từ file sao lưu${staged.items.some((i) => i.renamed) ? ' (ID trùng được nhập thành bản sao)' : ''}${staged.skipped ? `; ${staged.skipped} dự án đã có sẵn, bỏ qua` : ''}${staged.rejected.length ? '; có dự án hỏng không nhập được (xem bên dưới)' : ''}.`);
    const warn = [...staged.rejected, ...staged.items.flatMap((i) => i.issues.map((x) => ({ ...x, message: `${i.project.name}: ${x.message}` })))];
    if (warn.length) show(...issueList(warn), h('button', { id: 'back-home', onClick: () => home() }, 'Tiếp tục'));
    else await home();
  }

  const issueList = (issues: { code: string; severity: string; field: string; message: string }[]) =>
    [h('ul', { id: 'issues' }, ...issues.map((i) => h('li', {}, `${i.severity === 'error' ? 'Lỗi' : 'Cảnh báo'} ${i.code} tại ${i.field || '/'}: ${i.message}`)))];

  /** Right after a package import, before its project opens: what was recorded, and replay. */
  async function importedScreen(p: Project) {
    const recorded = await repo.getRecorded(p.projectId);
    if (!recorded) { say('Dự án này không có kết quả đã ghi từ gói.'); return openProject(p.projectId); }
    show(...(importIssues.length ? issueList(importIssues) : []), ...(await renderImported({
      project: p, recorded, loadWeather: weatherLoader(repo), state: importedState,
      rerender: () => { if (!workspace) void importedScreen(p); }, open: () => openProject(p.projectId), back: () => { say(''); void home(); },
    })));
  }

  // ---- help: full screen, Back returns to wherever it was opened from ---------------------------------------------------
  async function lessonsScreen() {
    show(...renderLessons({ state: lessonState, rerender: () => { if (location.hash === formatRoute({ kind: 'help', page: 'bai-hoc' })) void lessonsScreen(); }, back, backLabel: 'Quay lại' }));
  }
  async function aboutScreen(my = ++routing) {
    const nodes = await renderAbout(back);
    if (my === routing) show(...nodes);
  }

  await route();
}
