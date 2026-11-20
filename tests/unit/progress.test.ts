import { describe, expect, test } from 'vitest';
import { progressComplete, progressOf } from '../../src/app/progress';
import { buildSampleHouse } from '../../src/domain/seed';
import { createProject, openLamHa } from '../../src/domain/project';
import type { Project } from '../../src/domain/types';

const st = (p: Project, simRan = false) => progressOf(p, { simRan }).map((i) => i.status);
const step = (p: Project, n: number) => progressOf(p, { simRan: false })[n - 1];

describe('progressOf', () => {
  test('dự án trống: mọi bước còn làm, pin bỏ qua được', () => {
    expect(st(createProject('x'))).toEqual(['todo', 'todo', 'todo', 'todo', 'optional', 'todo', 'todo', 'todo', 'todo']);
  });
  test('Nhà mẫu: xong 7 bước đầu; còn chạy thử và giá', () => {
    expect(st(buildSampleHouse())).toEqual(['done', 'done', 'done', 'done', 'done', 'done', 'done', 'todo', 'todo']);
    expect(st(buildSampleHouse(), true)[7]).toBe('done');
  });
  test('Lâm Hà rc.2 vừa mở cũng có danh sách: có pin, còn lại chưa xong', () => {
    expect(st(openLamHa())).toEqual(['todo', 'todo', 'todo', 'todo', 'done', 'todo', 'todo', 'todo', 'todo']);
  });
  test('bước 3 đổi nút theo trạng thái: chưa có tấm → Thêm tấm; có tấm chưa đặt → Đặt tấm', () => {
    const a = step(createProject('x'), 3).action;
    expect([a.focusId, a.label]).toEqual(['add-panel', 'Thêm tấm']);
    const full = buildSampleHouse();
    const unplaced = { ...full, placements: [] } as Project;
    const b = step(unplaced, 3).action;
    expect([b.step, b.tab, b.focusId, b.label]).toEqual(['bo-tri', 'mai', 'fill-face', 'Đặt tấm']);
  });
  test('bước 3–6 trên dự án trống trỏ tới khối của cột Thêm (có ở mọi độ sâu), không tới form của ②', () => {
    const p = createProject('x');
    expect([3, 4, 5, 6].map((n) => step(p, n).action.focusId)).toEqual(['add-panel', 'add-inverter', 'add-battery', 'add-load']);
  });
  test('bước 6: có tải chưa lịch → Đặt lịch tải ③ he-thong; progressComplete bỏ qua optional', () => {
    const s = buildSampleHouse();
    const p = { ...s, loadPlans: [] } as Project;
    const a = step(p, 6).action;
    expect([a.step, a.tab, a.focusId, a.label]).toEqual(['chay-thu', 'he-thong', undefined, 'Đặt lịch tải']);
    expect(progressComplete(progressOf(createProject('x'), { simRan: false }))).toBe(false);
  });
});
