import { simulatePv } from '../engine/pv';
import { simulateSystem } from '../engine/system';
import { LedgerError } from '../engine/dispatch';
import { computeShade } from '../shade/sampler';
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
      } else if (msg.type === 'shade') {
        const run = await computeShade(msg.spec, msg.existing, msg.range, { onProgress: hooks.onProgress, isCancelled: hooks.isCancelled });
        if (run === null) post({ type: 'cancelled', runId });
        else post({ type: 'shade-result', runId, inputHash, field: run.field, computed: run.computed, reused: run.reused });
      } else if (msg.type === 'pv-batch') {
        const results = [];
        for (let k = 0; k < msg.inputs.length; k++) {
          const r = await simulatePv(msg.inputs[k], `${inputHash}#${k}`, { isCancelled: hooks.isCancelled, onProgress: (d, t) => hooks.onProgress((k + d / t) * 1000, msg.inputs.length * 1000) });
          if (r === null) { post({ type: 'cancelled', runId }); return; }
          if (r.issues.length) { post({ type: 'failure', runId, issues: r.issues }); return; }
          results.push(r);
        }
        post({ type: 'batch-result', runId, inputHash, results });
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
