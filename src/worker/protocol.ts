import type { Issue } from '../domain/validate';
import type { PvInput, PvResult } from '../engine/pv';
import type { SimInput, SimResult } from '../engine/system';
import type { ShadeField, ShadeSpec } from '../shade/sampler';

/** Messages between the UI and the worker (docs/02-domain-engine.md §Hợp đồng worker). */
export type RunRequest = { type: 'run'; runId: string; inputHash: string; input: PvInput };
export type SimRequest = { type: 'simulate'; runId: string; inputHash: string; input: SimInput };
/** Fill the missing steps of range [from, to) of a shade field. `existing` carries what is already computed (the cache lives on the main thread). */
export type ShadeRequest = { type: 'shade'; runId: string; inputHash: string; spec: ShadeSpec; existing: ShadeField | null; range: [number, number] };
/** Several PV runs over the same weather in one worker (shaded / unshaded / both string bounds). */
export type BatchRequest = { type: 'pv-batch'; runId: string; inputHash: string; inputs: PvInput[] };
export type Cancel = { type: 'cancel'; runId: string };
export type WorkerIn = RunRequest | SimRequest | ShadeRequest | BatchRequest | Cancel;
export type RunEvent =
  | { type: 'progress'; runId: string; completedSteps: number; totalSteps: number }
  | { type: 'result'; runId: string; inputHash: string; result: PvResult }
  | { type: 'sim-result'; runId: string; inputHash: string; result: SimResult }
  | { type: 'shade-result'; runId: string; inputHash: string; field: ShadeField; computed: number; reused: number }
  | { type: 'batch-result'; runId: string; inputHash: string; results: PvResult[] }
  | { type: 'failure'; runId: string; issues: Issue[] }
  | { type: 'cancelled'; runId: string };
