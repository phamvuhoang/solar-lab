import { describe, expect, test } from 'vitest';
import { DEPTH_KEY, readDepth, writeDepth } from '../../src/ui/depth';

const store = (v: string | null) => ({ getItem: (k: string) => (k === DEPTH_KEY ? v : null) });
const broken = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('QuotaExceededError'); } };

describe('readDepth', () => {
  test('đọc giá trị đã lưu', () => {
    expect(readDepth(store('tho'))).toBe('tho');
    expect(readDepth(store('ky-su'))).toBe('ky-su');
  });
  test('giá trị lạ, chưa lưu, không có kho, kho ném lỗi → Cơ bản', () => {
    expect(readDepth(store('x'))).toBe('co-ban');
    expect(readDepth(store('toString'))).toBe('co-ban'); // not a key inherited from Object
    expect(readDepth(store(null))).toBe('co-ban');
    expect(readDepth(null)).toBe('co-ban');
    expect(readDepth(broken)).toBe('co-ban');
  });
});

describe('writeDepth', () => {
  test('ghi vào khóa riêng; kho lỗi thì bỏ qua', () => {
    const kept = new Map<string, string>();
    writeDepth('ky-su', { setItem: (k: string, v: string) => { kept.set(k, v); } });
    expect(kept.get(DEPTH_KEY)).toBe('ky-su');
    expect(() => writeDepth('tho', broken)).not.toThrow();
    expect(() => writeDepth('tho', null)).not.toThrow();
  });
});
