import { hashOf } from '../domain/hash';
import { newId, nowIso } from '../domain/ids';
import type { Project } from '../domain/types';
import { stageImport } from './exchange';
import type { Issue } from '../domain/validate';
import { DB_NAME, DB_VERSION, done, wrap } from './db';
import type { ProjectRepository, RevisionRow } from './repository';

/**
 * Before the database is upgraded, everything the user wrote (projects, every revision, their own components and offers) is copied
 * to a separate database. The upgrade itself only adds stores, but a copy the upgrade cannot touch is the recovery path if it ever
 * does something unexpected. Weather is left out: it can be imported again from its source file.
 */
export const BACKUP_PREFIX = 'mekoniq-solar-lab-backup-v';
const COPY = ['projects', 'revisions', 'components', 'offers'] as const;

const openAt = (factory: IDBFactory, name: string, version?: number, upgrade?: (db: IDBDatabase) => void) =>
  new Promise<IDBDatabase>((ok, no) => {
    const r = version === undefined ? factory.open(name) : factory.open(name, version);
    if (upgrade) r.onupgradeneeded = () => upgrade(r.result);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error);
    r.onblocked = () => no(new Error('DB_BLOCKED'));
  });

export interface BackupResult { backedUp: boolean; fromVersion: number | null; projects: number; error?: string }

export async function backupBeforeUpgrade(factory: IDBFactory = indexedDB, name = DB_NAME, target = DB_VERSION): Promise<BackupResult> {
  try {
    const existing = (await factory.databases()).find((d) => d.name === name);
    if (!existing?.version || existing.version >= target) return { backedUp: false, fromVersion: existing?.version ?? null, projects: 0 };
    const from = existing.version, backupName = `${BACKUP_PREFIX}${from}`;
    if ((await factory.databases()).some((d) => d.name === backupName)) return { backedUp: false, fromVersion: from, projects: 0 }; // one backup per source version
    const src = await openAt(factory, name, from);
    let data: Record<string, unknown[]>;
    try {
      const stores = COPY.filter((s) => src.objectStoreNames.contains(s));
      if (!stores.includes('projects')) return { backedUp: false, fromVersion: from, projects: 0 };
      const tx = src.transaction(stores);
      data = Object.fromEntries(await Promise.all(stores.map(async (s) => [s, await wrap<unknown[]>(tx.objectStore(s).getAll())] as const)));
    } finally { src.close(); }
    const dst = await openAt(factory, backupName, 1, (db) => { for (const s of COPY) db.createObjectStore(s, { keyPath: s === 'projects' ? 'projectId' : s === 'revisions' ? ['projectId', 'revision'] : s === 'components' ? ['modelId', 'revision'] : 'offerId' }); });
    try {
      const tx = dst.transaction(Object.keys(data), 'readwrite');
      for (const [s, rows] of Object.entries(data)) for (const r of rows) tx.objectStore(s).put(r);
      await done(tx);
    } catch (e) { dst.close(); await new Promise((ok) => { const r = factory.deleteDatabase(backupName); r.onsuccess = r.onerror = () => ok(null); }); throw e; }
    dst.close();
    return { backedUp: true, fromVersion: from, projects: data.projects.length };
  } catch (e) { return { backedUp: false, fromVersion: null, projects: 0, error: (e as Error).message }; }
}

export async function listBackups(factory: IDBFactory = indexedDB): Promise<{ name: string; fromVersion: number }[]> {
  try { return (await factory.databases()).filter((d) => d.name?.startsWith(BACKUP_PREFIX)).map((d) => ({ name: d.name!, fromVersion: Number(d.name!.slice(BACKUP_PREFIX.length)) })); } catch { return []; }
}

/** Head revision of every project in a backup. */
export async function readBackup(name: string, factory: IDBFactory = indexedDB): Promise<Project[]> {
  const db = await openAt(factory, name);
  try {
    const tx = db.transaction(['projects', 'revisions']);
    const heads = await wrap<{ projectId: string; headRevision: number }[]>(tx.objectStore('projects').getAll());
    const rows = await Promise.all(heads.map((h) => wrap<RevisionRow | undefined>(tx.objectStore('revisions').get([h.projectId, h.headRevision]))));
    return rows.filter((r): r is RevisionRow => !!r).map((r) => r.project);
  } finally { db.close(); }
}

/** Restores each project of a backup into the live store. A project whose ID already exists comes back as a new copy; nothing is overwritten. */
export async function restoreBackup(repo: Pick<ProjectRepository, 'createProject' | 'listProjects'>, name: string, factory: IDBFactory = indexedDB): Promise<{ restored: number; copies: number }> {
  const projects = await readBackup(name, factory), have = new Set((await repo.listProjects()).map((p) => p.projectId));
  let copies = 0;
  for (const p of projects) {
    if (have.has(p.projectId)) { copies++; const now = nowIso(); await repo.createProject({ ...p, projectId: newId('prj'), name: `${p.name} (khôi phục)`, createdAt: now, updatedAt: now }); }
    else await repo.createProject(p);
  }
  return { restored: projects.length, copies };
}

export const deleteBackup = (name: string, factory: IDBFactory = indexedDB) => new Promise<void>((ok, no) => { const r = factory.deleteDatabase(name); r.onsuccess = () => ok(); r.onerror = () => no(r.error); });

// ---- export / import of all projects as one file (a recovery path that does not depend on IndexedDB at all) --------------------
export const BACKUP_FORMAT = 'mekoniq-solar-lab/backup';
export async function exportAll(repo: Pick<ProjectRepository, 'listProjects' | 'loadRevision'>, exportedAt = nowIso()): Promise<string> {
  const heads = await repo.listProjects();
  const projects = (await Promise.all(heads.map((h) => repo.loadRevision(h.projectId)))).filter((p): p is Project => !!p);
  return JSON.stringify({ format: BACKUP_FORMAT, formatVersion: 1, exportedAt, note: 'Bản mới nhất của từng dự án (không kèm lịch sử revision và dữ liệu thời tiết).', projects: await Promise.all(projects.map(async (project) => ({ hash: await hashOf(project), project }))) }, null, 2);
}

export type StagedBackup = { ok: true; items: { project: Project; issues: Issue[]; renamed: boolean }[] } | { ok: false; issues: Issue[] };
/** Every project in the file is checked before anything is written; one bad project rejects the whole file, with its position in the path. */
export async function stageBackup(text: string, existingIds: ReadonlySet<string>): Promise<StagedBackup> {
  let doc: { format?: string; formatVersion?: number; projects?: { project?: unknown }[] };
  try { doc = JSON.parse(text); } catch (e) { return { ok: false, issues: [{ code: 'INVALID_JSON', severity: 'error', field: '/', message: `Không đọc được JSON: ${(e as Error).message}` }] }; }
  if (doc?.format !== BACKUP_FORMAT) return { ok: false, issues: [{ code: 'WRONG_FORMAT', severity: 'error', field: '/format', message: `Cần format "${BACKUP_FORMAT}"` }] };
  if (doc.formatVersion !== 1) return { ok: false, issues: [{ code: 'UNSUPPORTED_VERSION', severity: 'error', field: '/formatVersion', message: `Chưa hỗ trợ formatVersion ${doc.formatVersion}` }] };
  if (!Array.isArray(doc.projects)) return { ok: false, issues: [{ code: 'BAD_PROJECTS', severity: 'error', field: '/projects', message: 'projects phải là mảng' }] };
  const items: Extract<StagedBackup, { ok: true }>['items'] = [], seen = new Set(existingIds);
  for (const [i, entry] of doc.projects.entries()) {
    const s = await stageImport(JSON.stringify({ format: 'mekoniq-solar-lab/project', formatVersion: 1, hash: (entry as { hash?: string }).hash, project: entry.project }), seen);
    if (!s.ok) return { ok: false, issues: s.issues.map((x) => ({ ...x, field: `/projects/${i}/project${x.field}` })) };
    seen.add(s.project.projectId);
    items.push({ project: s.project, issues: s.issues, renamed: s.renamed });
  }
  return { ok: true, items };
}

/** Message for a failure to open the database at startup. A build older than the data (rollback) cannot read it: say so and say how to get the work back. */
export function explainStartupError(e: unknown): string {
  const name = (e as { name?: string })?.name, msg = e instanceof Error ? e.message : String(e);
  if (name === 'VersionError') return 'Dữ liệu trên máy này do một bản app MỚI HƠN tạo ra nên bản này không đọc được (không có gì bị xóa hay sửa). Hãy mở lại bản app mới nhất. Nếu buộc phải dùng bản cũ, nhập file "Xuất tất cả" đã sao lưu trước đó hoặc file dự án .json.';
  if (msg.startsWith('DB_BLOCKED')) return 'Một tab Solar Lab khác đang giữ kho dữ liệu cũ. Đóng các tab khác rồi tải lại trang.';
  return `Không mở được kho lưu trữ cục bộ: ${msg}`;
}
