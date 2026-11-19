import type { Issue } from '../domain/validate';
import type { PvInput, PvResult } from '../engine/pv';

/** Messages between the UI and the PV worker (docs/02-domain-engine.md §Hợp đồng worker). */
export type RunRequest = { type: 'run'; runId: string; inputHash: string; input: PvInput };
export type Cancel = { type: 'cancel'; runId: string };
export type WorkerIn = RunRequest | Cancel;
export type RunEvent =
  | { type: 'progress'; runId: string; completedSteps: number; totalSteps: number }
  | { type: 'result'; runId: string; inputHash: string; result: PvResult }
  | { type: 'failure'; runId: string; issues: Issue[] }
  | { type: 'cancelled'; runId: string };
