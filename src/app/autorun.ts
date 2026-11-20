export const AUTORUN_DELAY_MS = 1000; // tune on dev machine + mid-range Android

export function createScheduler(
  delayMs: number,
  onError: (e: unknown) => void = (e) => console.error(e),
): {
  schedule(task: (signal: AbortSignal) => Promise<void>): void;
  cancel(): void;
} {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ctl: AbortController | undefined;
  const cancel = (): void => {
    clearTimeout(timer);
    timer = undefined;
    ctl?.abort();
    ctl = undefined;
  };
  return {
    cancel,
    schedule(task) {
      cancel();
      const mine = (ctl = new AbortController());
      timer = setTimeout(() => {
        timer = undefined;
        // Promise.resolve().then also catches synchronous throws; aborts are expected, not errors.
        Promise.resolve()
          .then(() => task(mine.signal))
          .catch((e) => {
            if (!mine.signal.aborted) onError(e);
          });
      }, delayMs);
    },
  };
}

export class Lru<V> {
  private m = new Map<string, V>();
  constructor(private max: number) {}
  get(key: string): V | undefined {
    if (!this.m.has(key)) return undefined;
    const v = this.m.get(key) as V;
    this.m.delete(key);
    this.m.set(key, v);
    return v;
  }
  set(key: string, v: V): void {
    this.m.delete(key);
    this.m.set(key, v);
    if (this.m.size > this.max) this.m.delete(this.m.keys().next().value as string);
  }
}
