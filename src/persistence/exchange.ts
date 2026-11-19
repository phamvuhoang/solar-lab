import { hashOf } from '../domain/hash';
import { newId, nowIso } from '../domain/ids';
import type { Project } from '../domain/types';
import { hasErrors, validateProject, type Issue } from '../domain/validate';

export const FORMAT = 'mekoniq-solar-lab/project';
export const MAX_IMPORT_BYTES = 5_000_000;

export async function exportProject(project: Project, exportedAt = nowIso()): Promise<string> {
  return JSON.stringify({ format: FORMAT, formatVersion: 1, exportedAt, hash: await hashOf(project), project }, null, 2);
}

export type Staged =
  | { ok: true; project: Project; issues: Issue[]; renamed: boolean }
  | { ok: false; issues: Issue[] };

const bad = (code: string, field: string, message: string): Staged => ({ ok: false, issues: [{ code, severity: 'error', field, message }] });

/**
 * Parse + validate in memory only. Nothing is written until the caller commits the staged project,
 * so a failed import leaves the current draft alone. A colliding project ID imports as a new copy.
 */
export async function stageImport(text: string, existingIds: ReadonlySet<string>): Promise<Staged> {
  if (new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) return bad('TOO_LARGE', '/', `File lớn hơn ${MAX_IMPORT_BYTES / 1e6} MB`);
  let doc: { format?: string; formatVersion?: number; hash?: string; project?: unknown };
  try { doc = JSON.parse(text); } catch (e) { return bad('INVALID_JSON', '/', `Không đọc được JSON: ${(e as Error).message}`); }
  if (doc?.format !== FORMAT) return bad('WRONG_FORMAT', '/format', `Cần format "${FORMAT}"`);
  if (doc.formatVersion !== 1) return bad('UNSUPPORTED_VERSION', '/formatVersion', `Chưa hỗ trợ formatVersion ${doc.formatVersion}`);
  const issues = validateProject(doc.project);
  if (hasErrors(issues)) return { ok: false, issues };
  const project = doc.project as Project;
  // Hand-edited files legitimately differ from the recorded hash; report it, do not block.
  if (doc.hash !== (await hashOf(project))) issues.push({ code: 'HASH_MISMATCH', severity: 'warning', field: '/hash', message: 'Nội dung khác mã băm ghi trong file (file đã bị sửa tay?)' });
  if (!existingIds.has(project.projectId)) return { ok: true, project, issues, renamed: false };
  const now = nowIso();
  return { ok: true, renamed: true, issues, project: { ...project, projectId: newId('prj'), name: `${project.name} (bản nhập)`, createdAt: now, updatedAt: now } };
}
