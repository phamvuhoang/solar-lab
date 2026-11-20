import { describe, expect, test } from 'vitest';
import { STEPS, formatRoute, parseRoute, stepOfTab } from '../../src/ui/route';

describe('địa chỉ theo hash', () => {
  test('hash rỗng là chưa quyết; #/ là trang đầu; lạ thì về trang đầu', () => {
    expect(parseRoute('')).toBeNull();
    expect(parseRoute('#')).toBeNull();
    expect(parseRoute('#/')).toEqual({ kind: 'home' });
    expect(parseRoute('#/linh-tinh')).toEqual({ kind: 'home' });
    expect(parseRoute('#/bai-hoc')).toEqual({ kind: 'help', page: 'bai-hoc' });
  });
  test('dự án: thiếu bước → bước 1; thiếu tab hoặc tab không thuộc bước → tab đầu của bước', () => {
    expect(parseRoute('#/p/prj-1')).toEqual({ kind: 'project', projectId: 'prj-1', step: 'bo-tri', tab: 'mai' });
    expect(parseRoute('#/p/prj-1/chay-thu')).toEqual({ kind: 'project', projectId: 'prj-1', step: 'chay-thu', tab: 'pv' });
    expect(parseRoute('#/p/prj-1/chay-thu/he-thong')).toEqual({ kind: 'project', projectId: 'prj-1', step: 'chay-thu', tab: 'he-thong' });
    expect(parseRoute('#/p/prj-1/dau-noi/pv')).toEqual({ kind: 'project', projectId: 'prj-1', step: 'dau-noi', tab: 'thiet-ke' });
    expect(parseRoute('#/p/prj-1/khong-co')).toEqual({ kind: 'project', projectId: 'prj-1', step: 'bo-tri', tab: 'mai' });
  });
  test('khứ hồi mọi bước/tab; id dự án có ký tự lạ được mã hóa', () => {
    for (const s of STEPS) for (const t of s.tabs) {
      const r = { kind: 'project' as const, projectId: 'prj-a/b c', step: s.id, tab: t.id };
      expect(parseRoute(formatRoute(r))).toEqual(r);
      expect(stepOfTab(t.id)).toBe(s.id);
    }
  });
  test('xem thử không lưu: #/mau là Nhà mẫu, #/moi là dự án trống; khứ hồi', () => {
    expect(parseRoute('#/mau')).toEqual({ kind: 'preview', what: 'mau' });
    expect(parseRoute('#/moi')).toEqual({ kind: 'preview', what: 'moi' });
    for (const what of ['mau', 'moi'] as const) expect(parseRoute(formatRoute({ kind: 'preview', what }))).toEqual({ kind: 'preview', what });
  });
  test('5 bước, tab và elId không trùng', () => {
    expect(STEPS.map((s) => s.n)).toEqual([1, 2, 3, 4, 5]);
    const tabs = STEPS.flatMap((s) => s.tabs);
    expect(new Set(tabs.map((t) => t.id)).size).toBe(tabs.length);
    expect(new Set(tabs.map((t) => t.elId)).size).toBe(tabs.length);
  });
});
