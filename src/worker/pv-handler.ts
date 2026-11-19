import { simulatePv } from '../engine/pv';
import { simulateSystem } from '../engine/system';
import { LedgerError } from '../engine/dispatch';
import type { RunEvent, WorkerIn } from './protocol';

/** The worker's whole logic, with `post` injected so Node tests can drive it without a Worker. */
export function createPvHandler(post: (e: RunEvent) => void) {
  const cancelled = new Set<string>();
  return async function handle(msg: WorkerIn): Promise<void> {
    if (msg.type === 'cancel') { cancelled.add(msg.runId); return; }
    const { runId, inputHash } = msg;
    const hooks = {
      onProgress: (done: number, total: number) => post({ type: 'progress', runId, completedSteps: Math.round(done), totalSteps: total }),
      isCancelled: () => cancelled.has(runId),
    };
    try {
      if (msg.type === 'run') {
        const result = await simulatePv(msg.input, inputHash, hooks);
        if (result === null) post({ type: 'cancelled', runId });
        else if (result.issues.length) post({ type: 'failure', runId, issues: result.issues });
        else post({ type: 'result', runId, inputHash, result });
      } else {
        const out = await simulateSystem(msg.input, inputHash, hooks);
        if (out === null) post({ type: 'cancelled', runId });
        else if (!out.ok) post({ type: 'failure', runId, issues: out.issues });
        else post({ type: 'sim-result', runId, inputHash, result: out.result });
      }
    } catch (e) {
      // A broken ledger or any engine fault is reported, never turned into a result.
      post({ type: 'failure', runId, issues: [{ code: e instanceof LedgerError ? 'LEDGER_IMBALANCE' : 'ENGINE_ERROR', severity: 'error', field: '/', message: e instanceof Error ? e.message : String(e) }] });
    } finally {
      cancelled.delete(runId);
    }
  };
}
