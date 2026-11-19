import { newRunId } from '../domain/ids';
import type { Issue } from '../domain/validate';
import type { PvInput, PvResult } from '../engine/pv';
import type { SimInput, SimResult } from '../engine/system';
import type { RunEvent, WorkerIn } from './protocol';

export type RunOutcome = { status: 'result'; result: PvResult } | { status: 'failure'; issues: Issue[] } | { status: 'cancelled' };
export type SimOutcome = { status: 'result'; result: SimResult } | { status: 'failure'; issues: Issue[] } | { status: 'cancelled' };
export interface Job<O> { runId: string; promise: Promise<O>; cancel(): void }

/** One worker per run so a stuck run can simply be terminated. A result is accepted only if runId and inputHash match this run. */
function runJob<O extends { status: string }>(request: (runId: string) => WorkerIn, inputHash: string, onProgress: (d: number, t: number) => void, take: (m: RunEvent) => O | null): Job<O> {
  const runId = newRunId();
  const worker = new Worker(new URL('./pv.worker.ts', import.meta.url), { type: 'module' });
  let finish!: (o: O) => void;
  const promise = new Promise<O>((ok) => { finish = ok; });
  const end = (o: O) => { worker.terminate(); finish(o); };
  const fail = (code: string, message: string) => ({ status: 'failure', issues: [{ code, severity: 'error', field: '/', message }] }) as unknown as O;
  worker.onmessage = (ev: MessageEvent<RunEvent>) => {
    const m = ev.data;
    if (m.runId !== runId) return; // stale message from another run
    if (m.type === 'progress') return onProgress(m.completedSteps, m.totalSteps);
    if ((m.type === 'result' || m.type === 'sim-result') && m.inputHash !== inputHash) return end(fail('STALE_RESULT', 'Kết quả không khớp đầu vào hiện tại'));
    if (m.type === 'failure') return end({ status: 'failure', issues: m.issues } as unknown as O);
    if (m.type === 'cancelled') return end({ status: 'cancelled' } as O);
    const o = take(m);
    if (o) end(o);
  };
  worker.onerror = (e) => end(fail('WORKER_ERROR', e.message || 'Worker lỗi'));
  worker.postMessage(request(runId));
  return {
    runId, promise,
    cancel() {
      worker.postMessage({ type: 'cancel', runId } satisfies WorkerIn);
      setTimeout(() => end({ status: 'cancelled' } as O), 500); // hard stop if the worker does not answer within 500 ms
    },
  };
}

export const runPvInWorker = (input: PvInput, inputHash: string, onProgress: (d: number, t: number) => void = () => {}): Job<RunOutcome> =>
  runJob<RunOutcome>((runId) => ({ type: 'run', runId, inputHash, input }), inputHash, onProgress, (m) => (m.type === 'result' ? { status: 'result', result: m.result } : null));

export const runSimInWorker = (input: SimInput, inputHash: string, onProgress: (d: number, t: number) => void = () => {}): Job<SimOutcome> =>
  runJob<SimOutcome>((runId) => ({ type: 'simulate', runId, inputHash, input }), inputHash, onProgress, (m) => (m.type === 'sim-result' ? { status: 'result', result: m.result } : null));
