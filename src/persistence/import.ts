import { hashOf } from '../domain/hash';
import type { Issue } from '../domain/validate';
import { nowIso } from '../domain/ids';
import type { Project } from '../domain/types';
import type { StagedPackage } from '../reports/package';
import type { ProjectRepository } from './repository';

export const isQuotaError = (e: unknown) => !!e && typeof e === 'object' && ((e as { name?: string }).name === 'QuotaExceededError' || (e as { code?: number }).code === 22);
const issue = (code: string, severity: Issue['severity'], field: string, message: string): Issue => ({ code, severity, field, message });

export type Commit = { ok: true; project: Project; weatherStored: boolean; issues: Issue[] } | { ok: false; issues: Issue[] };

/**
 * Writes a staged package. Order matters: the weather goes first because it can be re-imported and is the first thing to drop
 * when storage is short; the project goes second. If the project cannot be written, the weather this import added is removed again,
 * so a failed import leaves storage exactly as it was (existing drafts are never touched either way).
 */
export async function commitPackage(repo: Pick<ProjectRepository, 'createProject' | 'saveWeather' | 'getWeather' | 'deleteWeather' | 'saveRecorded'>, staged: Extract<StagedPackage, { ok: true }>): Promise<Commit> {
  const issues = [...staged.issues];
  let weatherAdded = false, weatherStored = false;
  // Bundled datasets ship with the app; storing a second copy would only spend quota.
  const w = staged.doc.weather.ref?.bundled ? null : staged.weather;
  if (w) {
    try {
      const had = await repo.getWeather(w.seriesId);
      if (!had) { await repo.saveWeather(w); weatherAdded = true; }
      else if ((await hashOf(had)) !== (await hashOf(w))) issues.push(issue('WEATHER_ID_CONFLICT', 'warning', '/weather/data', `Máy này đã có dữ liệu thời tiết cùng mã "${w.seriesId}" nhưng nội dung khác dữ liệu trong gói. Giữ bản đã có (không ghi đè); chạy PV sẽ dùng dữ liệu trong máy, không phải dữ liệu trong gói.`));
      weatherStored = true;
    } catch (e) {
      issues.push(isQuotaError(e)
        ? issue('WEATHER_NOT_STORED', 'warning', '/weather/data', 'Hết dung lượng lưu trữ nên chưa lưu được dữ liệu thời tiết; dự án vẫn nhập. Giải phóng dung lượng rồi nhập lại gói để chạy lại được.')
        : issue('WEATHER_NOT_STORED', 'warning', '/weather/data', `Không lưu được dữ liệu thời tiết: ${(e as Error).message}`));
    }
  }
  let saved: Project;
  try { saved = await repo.createProject(staged.project); }
  catch (e) {
    if (weatherAdded) await repo.deleteWeather(w!.seriesId).catch(() => {});
    return { ok: false, issues: [isQuotaError(e)
      ? issue('STORAGE_FULL', 'error', '/', 'Hết dung lượng lưu trữ của trình duyệt nên chưa nhập được dự án. Dự án hiện có không bị thay đổi. Xóa bớt dự án hoặc dữ liệu thời tiết cũ rồi thử lại.')
      : issue('STORAGE_ERROR', 'error', '/', `Không ghi được dự án: ${(e as Error).message}. Dự án hiện có không bị thay đổi.`)] };
  }
  try {
    await repo.saveRecorded({ projectId: saved.projectId, importedAt: nowIso(), exportedAt: staged.doc.exportedAt, kind: staged.doc.kind, app: staged.doc.app, runs: staged.doc.runs, variants: staged.doc.variants, weatherRef: staged.doc.weather.ref });
  } catch (e) {
    issues.push(issue('RECORDED_NOT_STORED', 'warning', '/runs', isQuotaError(e) ? 'Hết dung lượng nên chưa lưu được kết quả đã ghi trong gói.' : `Không lưu được kết quả đã ghi: ${(e as Error).message}`));
  }
  return { ok: true, project: saved, weatherStored, issues };
}

/** Free and total bytes the browser reports for this origin, or null when it does not say. */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    return e && typeof e.quota === 'number' ? { usage: e.usage ?? 0, quota: e.quota } : null;
  } catch { return null; }
}
