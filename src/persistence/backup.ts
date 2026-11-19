import { hashOf } from '../domain/hash';
import { newId, nowIso } from '../domain/ids';
import type { Project } from '../domain/types';
import { stageImport } from './exchange';
import type { Issue } from '../domain/validate';
import { DB_NAME, DB_VERSION, wrap } from './db';
import type { ProjectRepository, RevisionRow } from './repository';

/**
 * Before the database is upgraded, everything the user wrote (projects, every revision, their own components and offers) is copied
 * to a separate database. The upgrade itself only adds stores, but a copy the upgrade cannot touch is the recovery path if it ever
 * does something unexpected. Weather is left out: it can be imported again from its source file.
 */
export const BACKUP_PREFIX = 'mekoniq-solar-lab-backup-v';
const COPY = ['projects', 'revisions', 'components', 'offers'] as const;
const KEY_PATH: Record<(typeof COPY)[number], string | string[]> = { projects: 'projectId', revisions: ['projectId', 'revision'], components: ['modelId', 'revision'], offers: 'offerId' };

const openAt = (factory: IDBFactory, name: string, version?: number, upgrade?: (db: IDBDatabase, tx: IDBTransaction) => void) =>
  new Promise<IDBDatabase>((ok, no) => {
    const r = version === undefined ? factory.open(name) : factory.open(name, version);
    if (upgrade) r.onupgradeneeded = () => upgrade(r.result, r.transaction!);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error);
    r.onblocked = () => no(new Error('DB_BLOCKED'));
  });

/** Opens a database only if it exists. A plain open would create an empty one, so that creation is aborted. Needs no indexedDB.databases() (Firefox < 126). */
async function openExisting(factory: IDBFactory, name: string): Promise<IDBDatabase | null> {
  try { return await openAt(factory, name, undefined, (_db, tx) => tx.abort()); }
  catch (e) { if ((e as DOMException | null)?.name === 'AbortError') return null; throw e; }
}

export interface BackupResult { backedUp: boolean; fromVersion: number | null; projects: number; error?: string }

export async function backupBeforeUpgrade(factory: IDBFactory = indexedDB, name = DB_NAME, target = DB_VERSION): Promise<BackupResult> {
  try {
    const src = await openExisting(factory, name);
    if (!src || src.version >= target) { src?.close(); return { backedUp: false, fromVersion: src?.version ?? null, projects: 0 }; }
    const from = src.version, backupName = `${BACKUP_PREFIX}${from}`;
    let data: Record<string, unknown[]>;
    try {
      const stores = COPY.filter((s) => src.objectStoreNames.contains(s));
      if (!stores.includes('projects')) return { backedUp: false, fromVersion: from, projects: 0 };
      // one backup per source version; a copy without its completion mark (tab closed mid-copy by an older build) is made again
      const prev = await openExisting(factory, backupName);
      if (prev) {
        const complete = prev.objectStoreNames.contains('meta') && (await wrap(prev.transaction('meta').objectStore('meta').get('complete'))) !== undefined;
        prev.close();
        if (complete) return { backedUp: false, fromVersion: from, projects: 0 };
        await deleteBackup(backupName, factory);
      }
      const tx = src.transaction(stores);
      data = Object.fromEntries(await Promise.all(stores.map(async (s) => [s, await wrap<unknown[]>(tx.objectStore(s).getAll())] as const)));
    } finally { src.close(); }
    // Rows and the completion mark go into the backup's creating transaction: it exists complete, or not at all.
    (await openAt(factory, backupName, 1, (db, tx) => {
      for (const s of COPY) db.createObjectStore(s, { keyPath: KEY_PATH[s] });
      db.createObjectStore('meta', { keyPath: 'key' });
      for (const [s, rows] of Object.entries(data)) for (const r of rows) tx.objectStore(s).put(r);
      tx.objectStore('meta').put({ key: 'complete', fromVersion: from, projects: data.projects.length });
    })).close();
    return { backedUp: true, fromVersion: from, projects: data.projects.length };
  } catch (e) { return { backedUp: false, fromVersion: null, projects: 0, error: (e as Error | null)?.message ?? String(e) }; }
}

/** Backups are named by the version they were taken from, so they are found by name. */
export async function listBackups(factory: IDBFactory = indexedDB): Promise<{ name: string; fromVersion: number }[]> {
  const out: { name: string; fromVersion: number }[] = [];
  for (let v = 1; v < DB_VERSION; v++) {
    const db = await openExisting(factory, `${BACKUP_PREFIX}${v}`).catch(() => null);
    if (db) { out.push({ name: db.name, fromVersion: v }); db.close(); }
  }
  return out;
}

/** Head revision of every project in a database with projects/revisions stores: a backup, or a live DB this build cannot upgrade. Read only. */
export async function readBackup(name: string, factory: IDBFactory = indexedDB): Promise<Project[]> {
  const db = await openExisting(factory, name);
  if (!db) throw Object.assign(new Error('Bản sao lưu không còn trên máy này (có thể đã bị xóa ở tab khác).'), { name: 'BackupGone' });
  try {
    const tx = db.transaction(['projects', 'revisions']);
    const heads = await wrap<{ projectId: string; headRevision: number }[]>(tx.objectStore('projects').getAll());
    const rows = await Promise.all(heads.map((h) => wrap<RevisionRow | undefined>(tx.objectStore('revisions').get([h.projectId, h.headRevision]))));
    return rows.filter((r): r is RevisionRow => !!r).map((r) => r.project);
  } finally { db.close(); }
}

/** Same work, same key, whatever revision number and save time it carries: a project restored or imported again matches its source. */
export const contentKey = (p: Project) => hashOf({ ...p, revision: undefined, updatedAt: undefined });
export async function contentKeys(repo: Pick<ProjectRepository, 'listProjects' | 'loadRevision'>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const h of await repo.listProjects()) { const p = await repo.loadRevision(h.projectId); if (p) out.set(h.projectId, await contentKey(p)); }
  return out;
}

/**
 * Restores each project of a backup into the live store. One already here with the same content is skipped, so running it again after a partial
 * failure (or a double click) adds nothing twice. One whose ID exists with other content comes back as a new copy; nothing is overwritten.
 */
export async function restoreBackup(repo: Pick<ProjectRepository, 'createProject' | 'listProjects' | 'loadRevision'>, name: string, factory: IDBFactory = indexedDB): Promise<{ restored: number; copies: number; skipped: number }> {
  const projects = await readBackup(name, factory), have = await contentKeys(repo);
  let restored = 0, copies = 0, skipped = 0;
  for (const p of projects) {
    const live = have.get(p.projectId);
    if (live === (await contentKey(p))) { skipped++; continue; }
    if (live !== undefined) { copies++; const now = nowIso(); await repo.createProject({ ...p, projectId: newId('prj'), name: `${p.name} (khôi phục)`, createdAt: now, updatedAt: now }); }
    else await repo.createProject(p);
    restored++;
  }
  return { restored, copies, skipped };
}

export const deleteBackup = (name: string, factory: IDBFactory = indexedDB) => new Promise<void>((ok, no) => { const r = factory.deleteDatabase(name); r.onsuccess = () => ok(); r.onerror = () => no(r.error); });

// ---- export / import of all projects as one file (a recovery path that does not depend on IndexedDB at all) --------------------
export const BACKUP_FORMAT = 'mekoniq-solar-lab/backup';
export async function exportAll(repo: Pick<ProjectRepository, 'listProjects' | 'loadRevision'>, exportedAt = nowIso()): Promise<string> {
  const heads = await repo.listProjects();
  return exportProjects((await Promise.all(heads.map((h) => repo.loadRevision(h.projectId)))).filter((p): p is Project => !!p), exportedAt);
}
/** For a build older than the data (rollback): it cannot open the store at its own version, but can read it as it is and write nothing. */
export const exportUnopenable = async (factory: IDBFactory = indexedDB, name = DB_NAME, exportedAt = nowIso()) => exportProjects(await readBackup(name, factory), exportedAt);
const exportProjects = async (projects: Project[], exportedAt: string) =>
  JSON.stringify({ format: BACKUP_FORMAT, formatVersion: 1, exportedAt, note: 'Bản mới nhất của từng dự án (không kèm lịch sử revision và dữ liệu thời tiết).', projects: await Promise.all(projects.map(async (project) => ({ hash: await hashOf(project), project }))) }, null, 2);

export type StagedBackup =
  | { ok: true; items: { project: Project; issues: Issue[]; renamed: boolean }[]; rejected: Issue[]; skipped: number }
  | { ok: false; issues: Issue[] };
/**
 * Every project in the file is checked before anything is written. A bad one is listed with its position and the others still import.
 * One already here with the same content (`existing`: projectId → contentKey) is skipped, so a second try after a partial import adds only what is missing.
 */
export async function stageBackup(text: string, existing: ReadonlyMap<string, string>): Promise<StagedBackup> {
  let doc: { format?: string; formatVersion?: number; projects?: unknown[] };
  try { doc = JSON.parse(text); } catch (e) { return { ok: false, issues: [{ code: 'INVALID_JSON', severity: 'error', field: '/', message: `Không đọc được JSON: ${(e as Error).message}` }] }; }
  if (doc?.format !== BACKUP_FORMAT) return { ok: false, issues: [{ code: 'WRONG_FORMAT', severity: 'error', field: '/format', message: `Cần format "${BACKUP_FORMAT}"` }] };
  if (doc.formatVersion !== 1) return { ok: false, issues: [{ code: 'UNSUPPORTED_VERSION', severity: 'error', field: '/formatVersion', message: `Chưa hỗ trợ formatVersion ${doc.formatVersion}` }] };
  if (!Array.isArray(doc.projects)) return { ok: false, issues: [{ code: 'BAD_PROJECTS', severity: 'error', field: '/projects', message: 'projects phải là mảng' }] };
  const items: Extract<StagedBackup, { ok: true }>['items'] = [], rejected: Issue[] = [], seen = new Set(existing.keys());
  let skipped = 0;
  for (const [i, entry] of doc.projects.entries()) {
    if (typeof entry !== 'object' || entry === null) { rejected.push({ code: 'BAD_ENTRY', severity: 'error', field: `/projects/${i}`, message: 'Mục này không phải một dự án' }); continue; }
    const { hash, project } = entry as { hash?: string; project?: Project };
    const id = project?.projectId;
    if (typeof id === 'string' && existing.get(id) === (await contentKey(project!))) { skipped++; continue; }
    const s = await stageImport(JSON.stringify({ format: 'mekoniq-solar-lab/project', formatVersion: 1, hash, project }), seen);
    if (!s.ok) { rejected.push(...s.issues.map((x) => ({ ...x, field: `/projects/${i}/project${x.field}` }))); continue; }
    seen.add(s.project.projectId);
    items.push({ project: s.project, issues: s.issues, renamed: s.renamed });
  }
  return { ok: true, items, rejected, skipped };
}

/** Message for a failure to open the database at startup. A build older than the data (rollback) cannot read it: say so and say how to get the work back. */
export function explainStartupError(e: unknown): string {
  const name = (e as { name?: string })?.name, msg = e instanceof Error ? e.message : String(e);
  if (name === 'VersionError') return 'Dữ liệu trên máy này do một bản app MỚI HƠN tạo ra nên bản này không dùng được (không có gì bị xóa hay sửa). Hãy mở lại bản app mới nhất: mọi dự án vẫn còn ở đó. Cần giữ một bản ngay bây giờ thì bấm "Xuất dữ liệu ra file" bên dưới (chỉ đọc). Đừng xóa dữ liệu trang để dùng bản này: việc đó xóa luôn mọi dự án và bản sao lưu tự động.';
  if (msg.startsWith('DB_BLOCKED')) return 'Một tab Solar Lab khác đang giữ kho dữ liệu cũ. Đóng các tab khác rồi tải lại trang.';
  return `Không mở được kho lưu trữ cục bộ: ${msg}`;
}
