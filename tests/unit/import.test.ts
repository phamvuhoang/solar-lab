import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, test } from 'vitest';
import { createProject } from '../../src/domain/project';
import { commitPackage } from '../../src/persistence/import';
import { ProjectRepository } from '../../src/persistence/repository';
import { buildPackage, stagePackage } from '../../src/reports/package';
import { CURRENT_ENGINES } from '../../src/reports/replay';
import { wx } from './pv-helpers';

const quota = () => Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
async function staged(withWeather = true) {
  const p = { ...createProject('Gói thử'), pv: { weatherId: 'wx-a' } };
  const w = wx({ n: 24, seriesId: 'wx-a', poa: Array(24).fill(100), tempAirC: Array(24).fill(25), windMs: Array(24).fill(1) });
  const text = await buildPackage({ kind: 'full', project: p, runs: [], weather: withWeather ? w : undefined, includeContact: true, includeSeries: false, app: { buildId: 't', engines: CURRENT_ENGINES } });
  const s = await stagePackage(text, new Set());
  if (!s.ok) throw new Error('stage');
  return s;
}

describe('ghi gói vào kho: hết dung lượng, hoàn tác, nháp cũ', () => {
  test('thành công: dự án, thời tiết và kết quả đã ghi cùng vào kho; DB v2 cũ nâng lên v3 không mất dữ liệu', async () => {
    const factory = new IDBFactory();
    const old = await ProjectRepository.open({ factory, version: 2 });
    const draft = await old.createProject(createProject('Nháp cũ'));
    old.close();
    const repo = await ProjectRepository.open({ factory });
    const out = await commitPackage(repo, await staged());
    expect(out).toMatchObject({ ok: true, weatherStored: true });
    expect((await repo.getWeather('wx-a'))?.n).toBe(24);
    expect(await repo.getRecorded((out as { project: { projectId: string } }).project.projectId)).toMatchObject({ kind: 'full', runs: [] });
    expect((await repo.loadRevision(draft.projectId))?.name).toBe('Nháp cũ');
    expect(await repo.listProjects()).toHaveLength(2);
  });
  test('hết dung lượng khi ghi dự án: báo STORAGE_FULL, bỏ thời tiết vừa thêm, nháp cũ nguyên vẹn', async () => {
    const repo = await ProjectRepository.open({ factory: new IDBFactory() });
    const draft = await repo.createProject(createProject('Nháp cũ'));
    const failing = { createProject: async () => { throw quota(); }, saveWeather: repo.saveWeather.bind(repo), getWeather: repo.getWeather.bind(repo), deleteWeather: repo.deleteWeather.bind(repo), saveRecorded: repo.saveRecorded.bind(repo) };
    const out = await commitPackage(failing, await staged());
    expect(out.ok).toBe(false);
    expect(!out.ok && out.issues[0]).toMatchObject({ code: 'STORAGE_FULL', field: '/' });
    expect(await repo.getWeather('wx-a')).toBeUndefined(); // đã hoàn tác
    expect(await repo.listProjects()).toHaveLength(1);
    expect((await repo.loadRevision(draft.projectId))?.name).toBe('Nháp cũ');
  });
  test('hết dung lượng khi ghi thời tiết: dự án vẫn nhập, cảnh báo WEATHER_NOT_STORED; thời tiết đã có thì không ghi lại', async () => {
    const repo = await ProjectRepository.open({ factory: new IDBFactory() });
    const noWeather = { ...repo, createProject: repo.createProject.bind(repo), getWeather: repo.getWeather.bind(repo), deleteWeather: repo.deleteWeather.bind(repo), saveRecorded: repo.saveRecorded.bind(repo), saveWeather: async () => { throw quota(); } };
    const out = await commitPackage(noWeather, await staged());
    expect(out.ok && out.weatherStored).toBe(false);
    expect(out.ok && out.issues.map((i) => i.code)).toContain('WEATHER_NOT_STORED');
    expect(await repo.listProjects()).toHaveLength(1);
    await repo.saveWeather(wx({ n: 24, seriesId: 'wx-a' }));
    let writes = 0;
    const counting = { createProject: repo.createProject.bind(repo), getWeather: repo.getWeather.bind(repo), deleteWeather: repo.deleteWeather.bind(repo), saveRecorded: repo.saveRecorded.bind(repo), saveWeather: async () => { writes++; } };
    const again = await commitPackage(counting, await staged());
    expect(again.ok && again.weatherStored).toBe(true);
    expect(writes).toBe(0);
  });
  test('lỗi khác dung lượng cũng không làm hỏng dữ liệu hiện có; ghi kết quả đã ghi lỗi chỉ cảnh báo', async () => {
    const repo = await ProjectRepository.open({ factory: new IDBFactory() });
    const boom = { createProject: async () => { throw new Error('disk lỗi'); }, saveWeather: repo.saveWeather.bind(repo), getWeather: repo.getWeather.bind(repo), deleteWeather: repo.deleteWeather.bind(repo), saveRecorded: repo.saveRecorded.bind(repo) };
    const out = await commitPackage(boom, await staged());
    expect(!out.ok && out.issues[0].code).toBe('STORAGE_ERROR');
    const soft = { ...boom, createProject: repo.createProject.bind(repo), saveRecorded: async () => { throw quota(); } };
    const ok = await commitPackage(soft, await staged());
    expect(ok.ok && ok.issues.map((i) => i.code)).toContain('RECORDED_NOT_STORED');
  });
});
