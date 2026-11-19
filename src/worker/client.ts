import { newRunId } from '../domain/ids';
import type { Issue } from '../domain/validate';
import type { PvInput, PvResult } from '../engine/pv';
import type { RunEvent, WorkerIn } from './protocol';

export type RunOutcome = { status: 'result'; result: PvResult } | { status: 'failure'; issues: Issue[] } | { status: 'cancelled' };

/** One worker per run so a stuck run can simply be terminated. The result is accepted only if runId and inputHash match. */
export function runPvInWorker(input: PvInput, inputHash: string, onProgress: (done: number, total: number) => void = () => {}): { runId: string; promise: Promise<RunOutcome>; cancel(): void } {
  const runId = newRunId();
  const worker = new Worker(new URL('./pv.worker.ts', import.meta.url), { type: 'module' });
  let finish!: (o: RunOutcome) => void;
  const promise = new Promise<RunOutcome>((ok) => { finish = ok; });
  const end = (o: RunOutcome) => { worker.terminate(); finish(o); };
  worker.onmessage = (ev: MessageEvent<RunEvent>) => {
    const m = ev.data;
    if (m.runId !== runId) return; // stale message from another run
    if (m.type === 'progress') onProgress(m.completedSteps, m.totalSteps);
    else if (m.type === 'result') {
      if (m.inputHash !== inputHash) end({ status: 'failure', issues: [{ code: 'STALE_RESULT', severity: 'error', field: '/', message: 'Kết quả không khớp đầu vào hiện tại' }] });
      else end({ status: 'result', result: m.result });
    } else if (m.type === 'failure') end({ status: 'failure', issues: m.issues });
    else end({ status: 'cancelled' });
  };
  worker.onerror = (e) => end({ status: 'failure', issues: [{ code: 'WORKER_ERROR', severity: 'error', field: '/', message: e.message || 'Worker lỗi' }] });
  worker.postMessage({ type: 'run', runId, inputHash, input } satisfies WorkerIn);
  return {
    runId, promise,
    cancel() {
      worker.postMessage({ type: 'cancel', runId } satisfies WorkerIn);
      setTimeout(() => end({ status: 'cancelled' }), 500); // hard stop if the worker does not answer within 500 ms
    },
  };
}
