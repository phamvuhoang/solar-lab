/** In-memory undo/redo of whole-project states. Saving an undo is a new revision, so stored history stays append-only. */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  /** Call with the state being replaced. A new edit clears redo. */
  record(prev: T) { this.past.push(prev); this.future = []; }
  undo(current: T): T | undefined { const p = this.past.pop(); if (p === undefined) return undefined; this.future.push(current); return p; }
  redo(current: T): T | undefined { const n = this.future.pop(); if (n === undefined) return undefined; this.past.push(current); return n; }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  clear() { this.past = []; this.future = []; }
}
