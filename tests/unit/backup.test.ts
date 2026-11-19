import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, test } from 'vitest';
import { hashOf } from '../../src/domain/hash';
import { createProject } from '../../src/domain/project';
import { backupBeforeUpgrade, contentKeys, deleteBackup, explainStartupError, exportAll, exportUnopenable, listBackups, readBackup, restoreBackup, stageBackup } from '../../src/persistence/backup';
import { DB_NAME } from '../../src/persistence/db';
import { ProjectRepository } from '../../src/persistence/repository';

/** A live DB at schema N−1 (v2) holding two projects, one with two revisions. */
async function v2(factory = new IDBFactory()) {
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
    expect(await f.databases()).toEqual([]); // dò phiên bản không được tạo ra DB rỗng
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
    expect(r).toEqual({ restored: 2, copies: 1, skipped: 0 });
    const names = (await live.listProjects()).map((p) => p.name).sort();
    expect(names).toEqual(['Nhà A (sửa tiếp sau nâng cấp)', 'Nhà A (sửa) (khôi phục)', 'Nhà B']);
    await deleteBackup('mekoniq-solar-lab-backup-v2', factory);
    expect(await listBackups(factory)).toEqual([]);
  });
  test('xuất tất cả → nhập lại trên máy trống cho đúng nội dung; dự án hỏng được liệt kê kèm vị trí, dự án khác vẫn nhập', async () => {
    const { factory, a, b } = await v2();
    const live = await ProjectRepository.open({ factory });
    const text = await exportAll(live);
    const staged = await stageBackup(text, new Map());
    expect(staged.ok && staged.items.length).toBe(2);
    const fresh = await ProjectRepository.open({ factory: new IDBFactory() });
    if (staged.ok) for (const it of staged.items) await fresh.createProject(it.project);
    const same = async (id: string) => { const x = (await fresh.loadRevision(id))!, y = (await live.loadRevision(id))!; return hashOf({ ...x, revision: 0, updatedAt: '' }).then(async (h1) => h1 === (await hashOf({ ...y, revision: 0, updatedAt: '' }))); };
    expect(await same(b.projectId)).toBe(true); expect(await same(a.projectId)).toBe(true);
    // một dự án hỏng không kéo theo cả file: các dự án còn lại vẫn nhập được, dự án hỏng được liệt kê kèm vị trí
    const bad = JSON.parse(text); bad.projects[1].project.instances = [{ instanceId: 'x', kind: 'khong-co', label: 'x', componentRef: null }];
    const r = await stageBackup(JSON.stringify(bad), new Map());
    expect(r.ok && r.items.map((i) => i.project.projectId)).toEqual([bad.projects[0].project.projectId]);
    expect(r.ok && r.rejected[0].field).toContain('/projects/1/project/instances/0');
    // cùng ID nhưng nội dung trong máy đã khác: nhập thành bản sao
    const dup = await stageBackup(text, new Map([[a.projectId, 'noi-dung-khac']]));
    expect(dup.ok && dup.items.filter((i) => i.renamed).length).toBe(1);
    expect((await stageBackup('{"format":"x"}', new Map())).ok).toBe(false);
  });
  test('rollback: bản app cũ mở DB do bản mới nâng cấp gặp VersionError, dữ liệu không đổi, thông báo nói cách lấy lại việc', async () => {
    const { factory, a } = await v2();
    const live = await ProjectRepository.open({ factory }); live.close(); // đã nâng lên v3
    const err = await ProjectRepository.open({ factory, version: 2 }).catch((e) => e);
    expect((err as Error).name).toBe('VersionError');
    const msg = explainStartupError(err);
    expect(msg).toContain('MỚI HƠN'); expect(msg).toContain('không có gì bị xóa');
    // bản này không mở được kho nên không có ô nhập file: không được khuyên "nhập file"; phải cảnh báo xóa dữ liệu trang là mất cả bản mới
    expect(msg).not.toContain('nhập file');
    expect(msg).toContain('Xuất dữ liệu ra file'); expect(msg).toContain('xóa dữ liệu trang');
    expect((await (await ProjectRepository.open({ factory })).loadRevision(a.projectId))?.name).toBe('Nhà A (sửa)');
    expect(explainStartupError(new Error('DB_BLOCKED: x'))).toContain('tab Solar Lab khác');
  });

  test('bản sao lưu bị ngắt giữa chừng (còn DB sao lưu rỗng) không làm tắt sao lưu: lần sau làm lại đủ', async () => {
    const { factory } = await v2();
    // trạng thái bản trước để lại khi tab bị đóng giữa hai bước: DB sao lưu đã có kho nhưng chưa có dữ liệu
    await new Promise((ok) => { const r = factory.open('mekoniq-solar-lab-backup-v2', 1); r.onupgradeneeded = () => { for (const s of ['projects', 'revisions', 'components', 'offers']) r.result.createObjectStore(s); }; r.onsuccess = () => { r.result.close(); ok(null); }; });
    expect(await backupBeforeUpgrade(factory)).toMatchObject({ backedUp: true, fromVersion: 2, projects: 2 });
    expect((await readBackup('mekoniq-solar-lab-backup-v2', factory)).map((p) => p.name).sort()).toEqual(['Nhà A (sửa)', 'Nhà B']);
  });
  test('trình duyệt không có indexedDB.databases() (Firefox < 126): vẫn sao lưu, vẫn liệt kê bản sao lưu, không báo lỗi sai', async () => {
    const factory = new IDBFactory();
    Object.defineProperty(factory, 'databases', { value: undefined });
    await v2(factory);
    expect(await backupBeforeUpgrade(factory)).toEqual({ backedUp: true, fromVersion: 2, projects: 2 });
    (await ProjectRepository.open({ factory })).close();
    expect(await backupBeforeUpgrade(factory)).toEqual({ backedUp: false, fromVersion: 3, projects: 0 });
    expect(await listBackups(factory)).toEqual([{ name: 'mekoniq-solar-lab-backup-v2', fromVersion: 2 }]);
  });
  test('khôi phục bản sao lưu đã bị xóa ở tab khác: báo rõ, không tạo ra DB sao lưu rỗng', async () => {
    const { factory } = await v2();
    await backupBeforeUpgrade(factory);
    await deleteBackup('mekoniq-solar-lab-backup-v2', factory);
    const err = await readBackup('mekoniq-solar-lab-backup-v2', factory).catch((e) => e);
    expect((err as Error).name).toBe('BackupGone');
    expect(await listBackups(factory)).toEqual([]);
  });

  test('khôi phục chạy lại (sau lỗi giữa chừng, hoặc bấm hai lần) không tạo bản trùng', async () => {
    const { factory } = await v2();
    await backupBeforeUpgrade(factory);
    const fresh = await ProjectRepository.open({ factory: new IDBFactory() }); // máy mất hết dự án
    expect(await restoreBackup(fresh, 'mekoniq-solar-lab-backup-v2', factory)).toEqual({ restored: 2, copies: 0, skipped: 0 });
    expect(await restoreBackup(fresh, 'mekoniq-solar-lab-backup-v2', factory)).toEqual({ restored: 0, copies: 0, skipped: 2 });
    expect((await fresh.listProjects()).map((p) => p.name).sort()).toEqual(['Nhà A (sửa)', 'Nhà B']);
  });
  test('nhập lại cùng file "Xuất tất cả" (sau lần nhập dở) chỉ nhập phần còn thiếu, không tạo bản trùng', async () => {
    const { factory } = await v2();
    const text = await exportAll(await ProjectRepository.open({ factory }));
    const fresh = await ProjectRepository.open({ factory: new IDBFactory() });
    const first = await stageBackup(text, await contentKeys(fresh));
    if (!first.ok) throw new Error('stage');
    await fresh.createProject(first.items[0].project); // lần đầu hết chỗ sau dự án thứ nhất
    const again = await stageBackup(text, await contentKeys(fresh));
    expect(again.ok && again.items.map((i) => i.renamed)).toEqual([false]);
    expect(again.ok && again.skipped).toBe(1);
  });
  test('file sao lưu có mục null: báo đúng vị trí, không sập', async () => {
    const r = await stageBackup('{"format":"mekoniq-solar-lab/backup","formatVersion":1,"projects":[null]}', new Map());
    expect(r.ok && r.items).toEqual([]);
    expect(r.ok && r.rejected.map((i) => i.field)).toEqual(['/projects/0']);
  });

  test('bản app cũ gặp kho do bản mới hơn tạo: vẫn xuất được dữ liệu ra file (chỉ đọc), kho không bị đổi', async () => {
    const factory = new IDBFactory();
    const live = await ProjectRepository.open({ factory });
    const a = await live.createProject(createProject('Nhà A'));
    live.close();
    await new Promise((ok) => { const r = factory.open(DB_NAME, 4); r.onsuccess = () => { r.result.close(); ok(null); }; }); // bản mới hơn nâng kho lên v4
    expect((await ProjectRepository.open({ factory }).catch((e) => e) as Error).name).toBe('VersionError');
    const text = await exportUnopenable(factory);
    const staged = await stageBackup(text, new Map());
    expect(staged.ok && staged.items.map((i) => i.project.projectId)).toEqual([a.projectId]);
    expect((await factory.databases()).find((d) => d.name === DB_NAME)?.version).toBe(4);
  });
});
