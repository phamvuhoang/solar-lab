import { createPvHandler } from './pv-handler';
import type { WorkerIn } from './protocol';

const handle = createPvHandler((e) => self.postMessage(e));
self.onmessage = (ev: MessageEvent<WorkerIn>) => { void handle(ev.data); };
