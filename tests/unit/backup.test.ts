import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, test } from 'vitest';
import { hashOf } from '../../src/domain/hash';
import { createProject } from '../../src/domain/project';
import { backupBeforeUpgrade, deleteBackup, explainStartupError, exportAll, listBackups, readBackup, restoreBackup, stageBackup } from '../../src/persistence/backup';
import { ProjectRepository } from '../../src/persistence/repository';

/** A live DB at schema N−1 (v2) holding two projects, one with two revisions. */
async function v2() {
  const factory = new IDBFactory();
  const old = await ProjectRepository.open({ factory, version: 2 });
  const a = await old.createProject(createProject('Nhà A')), b = await old.createProject(createProject('Nhà B'));
  const a2 = await old.saveRevision(1, { ...a, name: 'Nhà A (sửa)' });
  old.close();
  return { factory, a: a2, b };
}

describe('nâng DB N−1 → N: sao lưu trước, khôi phục, xuất tất cả', () => {
  test('nâng v2 → v3: có bản sao lưu đủ dự án và mọi revision; dữ liệu sống nguyên vẹn sau nâng cấp', async () => {
    const { factory, a, b } = await v2();
    const r = await backupBeforeUpgrade(factory);
    expect(r).toMatchObject({ backedUp: true, fromVersion: 2, projects: 2 });
    const live = await ProjectRepository.open({ factory });
    expect((await live.loadRevision(a.projectId))?.name).toBe('Nhà A (sửa)');
    expect((await live.listRevisions(a.projectId)).map((x) => x.revision)).toEqual([1, 2]);
    expect((await live.loadRevision(b.projectId))?.name).toBe('Nhà B');
    expect(await live.getRecorded(a.projectId)).toBeUndefined(); // kho mới có mà trống
    expect(await listBackups(factory)).toEqual([{ name: 'mekoniq-solar-lab-backup-v2', fromVersion: 2 }]);
    expect((await readBackup('mekoniq-solar-lab-backup-v2', factory)).map((p) => p.name).sort()).toEqual(['Nhà A (sửa)', 'Nhà B']);
  });
  test('không sao lưu khi DB mới tạo, đã ở bản hiện tại, hoặc đã có sao lưu cho bản nguồn đó', async () => {
    const f = new IDBFactory();
    expect(await backupBeforeUpgrade(f)).toMatchObject({ backedUp: false });
    const { factory } = await v2();
    await backupBeforeUpgrade(factory);
    await (await ProjectRepository.open({ factory })).close();
    expect(await backupBeforeUpgrade(factory)).toMatchObject({ backedUp: false, fromVersion: 3 });
    const again = await v2();
    await backupBeforeUpgrade(again.factory);
    expect(await backupBeforeUpgrade(again.factory)).toMatchObject({ backedUp: false }); // đã có v2
  });
  test('khôi phục: dự án mất được lấy lại; dự án trùng ID thành bản sao, không ghi đè', async () => {
    const { factory, a, b } = await v2();
    await backupBeforeUpgrade(factory);
    const live = await ProjectRepository.open({ factory });
    await live.saveRevision(2, { ...a, revision: 2, name: 'Nhà A (sửa tiếp sau nâng cấp)' }); // người dùng đã sửa tiếp
    // mất Nhà B (giả lập xóa dữ liệu hỏng)
    const tx = (live as unknown as { db: IDBDatabase }).db.transaction(['projects', 'revisions'], 'readwrite');
    tx.objectStore('projects').delete(b.projectId); tx.objectStore('revisions').delete([b.projectId, 1]);
    await new Promise((ok) => { tx.oncomplete = () => ok(null); });
    expect((await live.listProjects()).map((p) => p.name)).toEqual(['Nhà A (sửa tiếp sau nâng cấp)']);
    const r = await restoreBackup(live, 'mekoniq-solar-lab-backup-v2', factory);
    expect(r).toEqual({ restored: 2, copies: 1 });
    const names = (await live.listProjects()).map((p) => p.name).sort();
    expect(names).toEqual(['Nhà A (sửa tiếp sau nâng cấp)', 'Nhà A (sửa) (khôi phục)', 'Nhà B']);
    await deleteBackup('mekoniq-solar-lab-backup-v2', factory);
    expect(await listBackups(factory)).toEqual([]);
  });
  test('xuất tất cả → nhập lại trên máy trống cho đúng nội dung; file hỏng bị từ chối trọn gói với vị trí', async () => {
    const { factory, a, b } = await v2();
    const live = await ProjectRepository.open({ factory });
    const text = await exportAll(live);
    const staged = await stageBackup(text, new Set());
    expect(staged.ok && staged.items.length).toBe(2);
    const fresh = await ProjectRepository.open({ factory: new IDBFactory() });
    if (staged.ok) for (const it of staged.items) await fresh.createProject(it.project);
    const same = async (id: string) => { const x = (await fresh.loadRevision(id))!, y = (await live.loadRevision(id))!; return hashOf({ ...x, revision: 0, updatedAt: '' }).then(async (h1) => h1 === (await hashOf({ ...y, revision: 0, updatedAt: '' }))); };
    expect(await same(b.projectId)).toBe(true); expect(await same(a.projectId)).toBe(true);
    const bad = JSON.parse(text); bad.projects[1].project.instances = [{ instanceId: 'x', kind: 'khong-co', label: 'x', componentRef: null }];
    const r = await stageBackup(JSON.stringify(bad), new Set());
    expect(r.ok).toBe(false);
    expect(!r.ok && r.issues[0].field).toContain('/projects/1/project/instances/0');
    const dup = await stageBackup(text, new Set([a.projectId]));
    expect(dup.ok && dup.items.filter((i) => i.renamed).length).toBe(1);
    expect((await stageBackup('{"format":"x"}', new Set())).ok).toBe(false);
  });
  test('rollback: bản app cũ mở DB do bản mới nâng cấp gặp VersionError, dữ liệu không đổi, thông báo nói cách lấy lại việc', async () => {
    const { factory, a } = await v2();
    const live = await ProjectRepository.open({ factory }); live.close(); // đã nâng lên v3
    const err = await ProjectRepository.open({ factory, version: 2 }).catch((e) => e);
    expect((err as Error).name).toBe('VersionError');
    const msg = explainStartupError(err);
    expect(msg).toContain('MỚI HƠN'); expect(msg).toContain('không có gì bị xóa'); expect(msg).toContain('Xuất tất cả');
    expect((await (await ProjectRepository.open({ factory })).loadRevision(a.projectId))?.name).toBe('Nhà A (sửa)');
    expect(explainStartupError(new Error('DB_BLOCKED: x'))).toContain('tab Solar Lab khác');
  });
});
