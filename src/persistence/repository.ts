import { technicalHash } from '../domain/component';
import { hashOf } from '../domain/hash';
import { newId, nowIso } from '../domain/ids';
import type { Component, Offer, Project, Ref } from '../domain/types';
import type { PackageDoc } from '../reports/package';
import type { WeatherSeries } from '../weather/series';
import { done, openDb, wrap } from './db';

export interface ProjectHead { projectId: string; name: string; headRevision: number; updatedAt: string }
export interface RevisionRow { projectId: string; revision: number; hash: string; savedAt: string; project: Project }

/** What a package said about its runs when it was imported. Kept apart from the project so a re-run never overwrites it. */
export interface RecordedSet { projectId: string; importedAt: string; exportedAt: string; kind: PackageDoc['kind']; app: PackageDoc['app']; runs: PackageDoc['runs']; variants?: PackageDoc['variants']; weatherRef: PackageDoc['weather']['ref'] }

export class ConflictError extends Error {
  constructor(public readonly head: ProjectHead) { super('REVISION_CONFLICT'); }
}

export class ProjectRepository {
  private constructor(private db: IDBDatabase, private now: () => string) {}
  static async open(opts: { factory?: IDBFactory; name?: string; now?: () => string; version?: number } = {}) {
    return new ProjectRepository(await openDb(opts.factory, opts.name, opts.version), opts.now ?? nowIso);
  }
  close() { this.db.close(); }

  // ---- projects -------------------------------------------------------------------------
  /** First revision of a new project. Fails if the ID exists. */
  async createProject(p: Project): Promise<Project> {
    const saved = { ...p, revision: 1, updatedAt: this.now() };
    const row = await this.row(saved); // hash before the transaction: IDB closes a tx that awaits non-IDB work
    const tx = this.db.transaction(['projects', 'revisions'], 'readwrite');
    if (await wrap(tx.objectStore('projects').getKey(p.projectId)) !== undefined) { tx.abort(); throw new Error('PROJECT_EXISTS'); }
    this.write(tx, row);
    await done(tx);
    return saved;
  }

  /** Compare-and-swap: only succeeds if the head is still `expected`. Head and revision commit together. */
  async saveRevision(expected: number, p: Project): Promise<Project> {
    const saved = { ...p, revision: expected + 1, updatedAt: this.now() };
    const row = await this.row(saved);
    const tx = this.db.transaction(['projects', 'revisions'], 'readwrite');
    const head = await wrap<ProjectHead | undefined>(tx.objectStore('projects').get(p.projectId));
    if (!head) { tx.abort(); throw new Error('PROJECT_NOT_FOUND'); }
    if (head.headRevision !== expected) { tx.abort(); throw new ConflictError(head); }
    this.write(tx, row);
    await done(tx);
    return saved;
  }

  private async row(p: Project): Promise<RevisionRow> {
    return { projectId: p.projectId, revision: p.revision, hash: await hashOf(p), savedAt: p.updatedAt, project: p };
  }
  private write(tx: IDBTransaction, row: RevisionRow) {
    const p = row.project;
    tx.objectStore('revisions').put(row);
    tx.objectStore('projects').put({ projectId: p.projectId, name: p.name, headRevision: p.revision, updatedAt: p.updatedAt } satisfies ProjectHead);
  }

  async listProjects(): Promise<ProjectHead[]> {
    const all = await wrap<ProjectHead[]>(this.db.transaction('projects').objectStore('projects').getAll());
    return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async loadRevision(projectId: string, revision?: number): Promise<Project | undefined> {
    const tx = this.db.transaction(['projects', 'revisions']);
    const rev = revision ?? (await wrap<ProjectHead | undefined>(tx.objectStore('projects').get(projectId)))?.headRevision;
    if (rev === undefined) return undefined;
    return (await wrap<RevisionRow | undefined>(tx.objectStore('revisions').get([projectId, rev])))?.project;
  }
  async listRevisions(projectId: string): Promise<{ revision: number; savedAt: string; hash: string }[]> {
    const range = IDBKeyRange.bound([projectId, 0], [projectId, Infinity]);
    const rows = await wrap<RevisionRow[]>(this.db.transaction('revisions').objectStore('revisions').getAll(range));
    return rows.map(({ revision, savedAt, hash }) => ({ revision, savedAt, hash }));
  }

  /** Copy of the head under a new project ID. The original is untouched. */
  async cloneProject(projectId: string, name?: string): Promise<Project> {
    const src = await this.loadRevision(projectId);
    if (!src) throw new Error('PROJECT_NOT_FOUND');
    const now = this.now();
    return this.createProject({ ...structuredClone(src), projectId: newId('prj'), name: name ?? `${src.name} (bản sao)`, createdAt: now, updatedAt: now });
  }

  // ---- components and offers --------------------------------------------------------------
  /**
   * Stores a technical revision. If this model already has a revision with identical technical
   * content, that revision is returned and nothing is written: re-quoting the same SKU
   * does not mint a new revision.
   */
  async saveComponent(draft: Omit<Component, 'revision'>): Promise<{ ref: Ref; created: boolean; component: Component }> {
    const contentKey = `${draft.modelId}|${await technicalHash(draft as Component)}`;
    const tx = this.db.transaction('components', 'readwrite');
    const store = tx.objectStore('components');
    const existing = await wrap<(Component & { contentKey: string }) | undefined>(store.index('byContent').get(contentKey));
    if (existing) return { ref: { modelId: existing.modelId, revision: existing.revision }, created: false, component: existing };
    const all = await wrap<Component[]>(store.index('byModel').getAll(draft.modelId));
    const revision = all.reduce((m, c) => Math.max(m, c.revision), 0) + 1;
    const component: Component = { ...draft, revision };
    store.put({ ...component, contentKey });
    await done(tx);
    return { ref: { modelId: component.modelId, revision }, created: true, component };
  }
  async listComponents(): Promise<Component[]> {
    const rows = await wrap<(Component & { contentKey?: string })[]>(this.db.transaction('components').objectStore('components').getAll());
    return rows.map(({ contentKey: _k, ...c }) => c);
  }
  async saveOffer(o: Offer): Promise<void> {
    const tx = this.db.transaction('offers', 'readwrite');
    tx.objectStore('offers').put(o);
    await done(tx);
  }
  // ---- weather ---------------------------------------------------------------------------------------
  async saveWeather(series: WeatherSeries): Promise<void> {
    const tx = this.db.transaction('weather', 'readwrite');
    tx.objectStore('weather').put(series);
    await done(tx);
  }
  async getWeather(seriesId: string): Promise<WeatherSeries | undefined> {
    return wrap(this.db.transaction('weather').objectStore('weather').get(seriesId));
  }
  async listWeather(): Promise<WeatherSeries[]> {
    return wrap(this.db.transaction('weather').objectStore('weather').getAll());
  }
  async deleteWeather(seriesId: string): Promise<void> {
    const tx = this.db.transaction('weather', 'readwrite');
    tx.objectStore('weather').delete(seriesId);
    await done(tx);
  }
  async saveRecorded(r: RecordedSet): Promise<void> {
    const tx = this.db.transaction('recorded', 'readwrite');
    tx.objectStore('recorded').put(r);
    await done(tx);
  }
  async getRecorded(projectId: string): Promise<RecordedSet | undefined> {
    return wrap(this.db.transaction('recorded').objectStore('recorded').get(projectId));
  }
  async listOffers(): Promise<Offer[]> {
    return wrap(this.db.transaction('offers').objectStore('offers').getAll());
  }
}
