import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Lru, createScheduler } from '../../src/app/autorun';

describe('autorun', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('gom nhiều lần sửa trong 1 giây thành một lượt', async () => {
    const s = createScheduler(1000);
    const ran: string[] = [];
    s.schedule(async () => { ran.push('A'); });
    await vi.advanceTimersByTimeAsync(300);
    s.schedule(async () => { ran.push('B'); });
    await vi.advanceTimersByTimeAsync(999);
    expect(ran).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(ran).toEqual(['B']);
  });

  it('sửa mới hủy lượt đang chạy', async () => {
    const s = createScheduler(1000);
    let sigA!: AbortSignal;
    s.schedule((signal) => {
      sigA = signal;
      return new Promise<void>((res) => signal.addEventListener('abort', () => res()));
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(sigA.aborted).toBe(false);
    s.schedule(async () => {});
    expect(sigA.aborted).toBe(true);
  });

  it('cancel() hủy lượt đang chờ', async () => {
    const s = createScheduler(1000);
    const task = vi.fn(async () => {});
    s.schedule(task);
    s.cancel();
    await vi.advanceTimersByTimeAsync(2000);
    expect(task).not.toHaveBeenCalled();
  });

  it('Lru bỏ mục cũ nhất, get làm mới thứ tự', () => {
    const c = new Lru<number>(2);
    c.set('a', 1); c.set('b', 2);
    c.get('a');
    c.set('c', 3);
    expect(c.get('b')).toBeUndefined();
    expect(c.get('a')).toBe(1);
    expect(c.get('c')).toBe(3);
  });
});
