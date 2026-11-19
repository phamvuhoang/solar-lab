import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, test } from 'vitest';
import { createProject } from '../../src/domain/project';
import { ProjectRepository } from '../../src/persistence/repository';
import { BUNDLED_WEATHER, loadBundledWeather } from '../../src/weather/bundled';
import { createPvHandler } from '../../src/worker/pv-handler';
import type { RunEvent } from '../../src/worker/protocol';
import { input, model, wx } from './pv-helpers';

describe('kho thời tiết và nâng DB v1 → v2', () => {
  test('DB v1 có project; mở lại ở v2 giữ nguyên dữ liệu cũ và có kho weather', async () => {
    const factory = new IDBFactory();
    const v1 = await ProjectRepository.open({ factory, version: 1 });
    const p = await v1.createProject(createProject('cũ'));
    await expect(v1.saveWeather(wx({ n: 1, poa: [1] }))).rejects.toBeTruthy(); // v1 chưa có kho weather
    v1.close();
    const v2 = await ProjectRepository.open({ factory });
    expect((await v2.loadRevision(p.projectId))?.name).toBe('cũ');
    const series = wx({ n: 3, poa: [1, 2, 3], seriesId: 'wx-a' });
    await v2.saveWeather(series);
    expect(await v2.getWeather('wx-a')).toEqual(series);
    expect((await v2.listWeather()).map((s) => s.seriesId)).toEqual(['wx-a']);
    await v2.deleteWeather('wx-a');
    expect(await v2.getWeather('wx-a')).toBeUndefined();
  });
  test('dataset đóng gói nạp được, đúng id và nguồn', async () => {
    const r = await loadBundledWeather(BUNDLED_WEATHER[0].id);
    expect(r?.ok && r.series).toMatchObject({ seriesId: BUNDLED_WEATHER[0].id, n: 8760 });
    expect(await loadBundledWeather('không-có')).toBeNull();
  });
});

describe('worker handler: run / progress / cancel / result / failure', () => {
  const collect = () => { const ev: RunEvent[] = []; return { ev, post: (e: RunEvent) => ev.push(e) }; };
  const ok = input(wx({ n: 2500, poa: Array(2500).fill(500) }), model({ irradianceInput: 'poa' }));
  test('chạy xong: có progress rồi result mang đúng runId và inputHash', async () => {
    const { ev, post } = collect();
    await createPvHandler(post)({ type: 'run', runId: 'r1', inputHash: 'H', input: ok });
    expect(ev.map((e) => e.type)).toEqual(['progress', 'progress', 'progress', 'progress', 'result']);
    expect(ev.at(-1)).toMatchObject({ type: 'result', runId: 'r1', inputHash: 'H' });
    expect(ev.filter((e) => e.type === 'progress').map((e) => (e as { completedSteps: number }).completedSteps)).toEqual([0, 1000, 2000, 2500]);
  });
  test('hủy giữa chừng: cancelled, không có result', async () => {
    const { ev, post } = collect();
    const h = createPvHandler((e) => { post(e); if (e.type === 'progress' && e.completedSteps === 0) void h({ type: 'cancel', runId: 'r2' }); });
    await h({ type: 'run', runId: 'r2', inputHash: 'H', input: ok });
    expect(ev.at(-1)).toEqual({ type: 'cancelled', runId: 'r2' });
    expect(ev.some((e) => e.type === 'result')).toBe(false);
  });
  test('đầu vào thiếu dữ liệu: failure kèm issue, không chạy bước nào', async () => {
    const { ev, post } = collect();
    await createPvHandler(post)({ type: 'run', runId: 'r3', inputHash: 'H', input: input(wx({ n: 2, ghi: [0, 0], dni: [0, 0], dhi: [0, 0] }), model({ cellModel: 'faiman' })) });
    expect(ev).toEqual([{ type: 'failure', runId: 'r3', issues: expect.arrayContaining([expect.objectContaining({ code: 'AIR_TEMP_MISSING' })]) }]);
  });
});
