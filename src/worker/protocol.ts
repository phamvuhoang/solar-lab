import type { Issue } from '../domain/validate';
import type { PvInput, PvResult } from '../engine/pv';
import type { SimInput, SimResult } from '../engine/system';

/** Messages between the UI and the worker (docs/02-domain-engine.md §Hợp đồng worker). */
export type RunRequest = { type: 'run'; runId: string; inputHash: string; input: PvInput };
export type SimRequest = { type: 'simulate'; runId: string; inputHash: string; input: SimInput };
export type Cancel = { type: 'cancel'; runId: string };
export type WorkerIn = RunRequest | SimRequest | Cancel;
export type RunEvent =
  | { type: 'progress'; runId: string; completedSteps: number; totalSteps: number }
  | { type: 'result'; runId: string; inputHash: string; result: PvResult }
  | { type: 'sim-result'; runId: string; inputHash: string; result: SimResult }
  | { type: 'failure'; runId: string; issues: Issue[] }
  | { type: 'cancelled'; runId: string };
