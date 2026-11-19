export const DB_NAME = 'mekoniq-solar-lab';
export const DB_VERSION = 3;

/** One entry per version: migrations[n] upgrades the DB from n-1 to n. Never edit a shipped one. */
const migrations: Record<number, (db: IDBDatabase, tx: IDBTransaction) => void> = {
  1: (db) => {
    db.createObjectStore('projects', { keyPath: 'projectId' });
    db.createObjectStore('revisions', { keyPath: ['projectId', 'revision'] });
    const comps = db.createObjectStore('components', { keyPath: ['modelId', 'revision'] });
    comps.createIndex('byModel', 'modelId');
    comps.createIndex('byContent', 'contentKey');
    const offers = db.createObjectStore('offers', { keyPath: 'offerId' });
    offers.createIndex('byModel', 'componentRef.modelId');
  },
  // v2: imported weather series (large arrays, recreatable from the source file, so first to go when storage is short)
  2: (db) => { db.createObjectStore('weather', { keyPath: 'seriesId' }); },
  // v3: results recorded inside an imported package (read-only history; the engine re-run is a separate, new result)
  3: (db) => { db.createObjectStore('recorded', { keyPath: 'projectId' }); },
};

export function openDb(factory: IDBFactory = indexedDB, name = DB_NAME, version = DB_VERSION): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(name, version);
    req.onupgradeneeded = (ev) => {
      for (let v = ev.oldVersion + 1; v <= version; v++) migrations[v](req.result, req.transaction!);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('DB_BLOCKED: đóng các tab Solar Lab khác rồi thử lại'));
  });
}

export const wrap = <T>(r: IDBRequest<T>) =>
  new Promise<T>((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });

export const done = (tx: IDBTransaction) =>
  new Promise<void>((ok, no) => {
    tx.oncomplete = () => ok();
    tx.onerror = () => no(tx.error);
    tx.onabort = () => no(tx.error ?? new Error('TX_ABORTED'));
  });
