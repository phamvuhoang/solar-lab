import { simulatePv } from '../engine/pv';
import type { RunEvent, WorkerIn } from './protocol';

/** The worker's whole logic, with `post` injected so Node tests can drive it without a Worker. */
export function createPvHandler(post: (e: RunEvent) => void) {
  const cancelled = new Set<string>();
  return async function handle(msg: WorkerIn): Promise<void> {
    if (msg.type === 'cancel') { cancelled.add(msg.runId); return; }
    const { runId, inputHash, input } = msg;
    try {
      const result = await simulatePv(input, inputHash, {
        onProgress: (done, total) => post({ type: 'progress', runId, completedSteps: done, totalSteps: total }),
        isCancelled: () => cancelled.has(runId),
      });
      if (result === null) post({ type: 'cancelled', runId });
      else if (result.issues.length) post({ type: 'failure', runId, issues: result.issues });
      else post({ type: 'result', runId, inputHash, result });
    } catch (e) {
      post({ type: 'failure', runId, issues: [{ code: 'ENGINE_ERROR', severity: 'error', field: '/', message: e instanceof Error ? e.message : String(e) }] });
    } finally {
      cancelled.delete(runId);
    }
  };
}
