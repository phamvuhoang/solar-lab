import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, expect, test } from 'vitest';
// @ts-expect-error plain .mjs build script
import { buildSw } from '../../scripts/make-sw.mjs';

const template = readFileSync(new URL('../../scripts/sw-template.js', import.meta.url), 'utf8');
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

function makeDist(files: Record<string, string>) {
  const d = mkdtempSync(join(tmpdir(), 'sw-dist-'));
  for (const [p, c] of Object.entries(files)) { mkdirSync(join(d, p, '..'), { recursive: true }); writeFileSync(join(d, p), c); }
  return d;
}

/** In-memory Cache Storage shared by "versions" of the worker, like the browser shares it for one origin. */
class Store {
  m = new Map<string, Map<string, Response>>();
  caches = {
    open: async (n: string) => {
      if (!this.m.has(n)) this.m.set(n, new Map());
      const c = this.m.get(n)!;
      return {
        put: async (k: string | Request, r: Response) => { c.set(typeof k === 'string' ? k : k.url, r); },
        match: async (k: string | Request, o?: { ignoreSearch?: boolean }) => { let u = typeof k === 'string' ? k : k.url; if (o?.ignoreSearch) u = u.split('?')[0]; return c.get(u)?.clone(); },
      };
    },
    keys: async () => [...this.m.keys()],
    delete: async (n: string) => this.m.delete(n),
  };
}

type Net = Record<string, { status?: number; body: string }>;
function load(code: string, store: Store, net: () => Net) {
  const handlers: Record<string, (e: any) => void> = {};
  const log = { skipped: false, claimed: false, fetched: [] as string[] };
  const origin = 'https://app.test';
  const self = {
    registration: { scope: `${origin}/` }, location: { origin }, clients: { claim: async () => { log.claimed = true; } }, skipWaiting: () => { log.skipped = true; },
    addEventListener: (t: string, f: (e: any) => void) => { handlers[t] = f; },
  };
  const fetch = async (req: Request | string) => {
    const url = typeof req === 'string' ? req : req.url;
    log.fetched.push(url);
    const hit = net()[url.replace(origin + '/', '')];
    if (!hit) throw new TypeError('offline');
    return new Response(hit.body, { status: hit.status ?? 200 });
  };
  vm.runInNewContext(code, { self, caches: store.caches, fetch, Request, Response, URL, crypto, Promise });
  const wait = async (ev: string) => { let p: Promise<unknown> | undefined; handlers[ev]({ waitUntil: (x: Promise<unknown>) => { p = x; } }); await p; };
  const get = async (url: string, mode = 'cors') => { let p: Promise<Response> | undefined; handlers.fetch({ request: { method: 'GET', url: `${origin}/${url}`, mode }, respondWith: (x: Promise<Response>) => { p = x; } }); return p ? await p : null; };
  const intercepts = (req: object) => { let did = false; handlers.fetch({ request: req, respondWith: (x: Promise<unknown>) => { did = true; x.catch(() => {}); } }); return did; };
  return { intercepts, install: () => wait('install'), activate: () => wait('activate'), get, log, message: (data: unknown) => handlers.message({ data, source: { postMessage: () => {} } }) };
}

const v1 = { 'index.html': '<html>v1</html>', 'assets/app-aaa.js': 'console.log(1)', 'assets/chunk-1.js': 'chunk-v1' };
const v2 = { 'index.html': '<html>v2</html>', 'assets/app-bbb.js': 'console.log(2)', 'assets/chunk-1.js': 'chunk-v2' };

describe('service worker: cập nhật nguyên tử và dùng offline', () => {
  test('bản build: danh sách mọi file kèm sha256, phiên bản đổi khi nội dung đổi, giữ nguyên khi build lại y hệt', () => {
    const a = buildSw(makeDist(v1), template, 'b1'), b = buildSw(makeDist(v1), template, 'b2'), c = buildSw(makeDist(v2), template, 'b3');
    expect(a.assets.map(([p]: string[]) => p)).toEqual(['assets/app-aaa.js', 'assets/chunk-1.js', 'index.html']);
    expect(a.version).toBe(b.version); expect(a.version).not.toBe(c.version);
    expect(a.assets[2][1]).toBe(sha(v1['index.html']));
    expect(() => buildSw(makeDist({ 'x.js': '1' }), template, 'b')).toThrow('index.html');
  });
  test('cài lần đầu: tải đủ vào cache riêng, kích hoạt, mở trang offline (điều hướng → index.html) và các chunk', async () => {
    const store = new Store(), b = buildSw(makeDist(v1), template, 'b1');
    const online = load(b.code, store, () => Object.fromEntries(Object.entries(v1).map(([k, body]) => [k, { body }])));
    await online.install(); await online.activate();
    expect(online.log.claimed).toBe(true);
    expect([...store.m.keys()]).toEqual([`mekoniq-shell-${b.version}`]);
    const offline = load(b.code, store, () => ({})); // mất mạng: fetch ném lỗi
    expect(await (await offline.get('some/route', 'navigate'))!.text()).toBe('<html>v1</html>');
    expect(await (await offline.get('assets/chunk-1.js?x=1'))!.text()).toBe('chunk-v1');
    await expect(offline.get('khong-co.png')).rejects.toThrow('offline'); // thứ không có trong cache: lỗi mạng thật, không bịa
  });
  test('cập nhật thiếu file: cài thất bại, cache mới bị xóa, bản cũ vẫn phục vụ nguyên vẹn', async () => {
    const store = new Store(), b1 = buildSw(makeDist(v1), template, 'b1'), b2 = buildSw(makeDist(v2), template, 'b2');
    const old = load(b1.code, store, () => Object.fromEntries(Object.entries(v1).map(([k, body]) => [k, { body }])));
    await old.install(); await old.activate();
    const partial: Net = { 'index.html': { body: v2['index.html'] }, 'assets/app-bbb.js': { body: v2['assets/app-bbb.js'] } }; // thiếu chunk-1.js
    const next = load(b2.code, store, () => partial);
    await expect(next.install()).rejects.toThrow('chunk-1.js');
    expect([...store.m.keys()]).toEqual([`mekoniq-shell-${b1.version}`]); // chỉ còn bản cũ
    const still = load(b1.code, store, () => ({}));
    expect(await (await still.get('x', 'navigate'))!.text()).toBe('<html>v1</html>');
    expect(await (await still.get('assets/chunk-1.js'))!.text()).toBe('chunk-v1');
  });
  test('trả về trang đăng nhập wifi (200 nhưng sai nội dung) cũng bị từ chối; lỗi HTTP 404/500 cũng vậy', async () => {
    const store = new Store(), b = buildSw(makeDist(v1), template, 'b1');
    const portal = Object.fromEntries(Object.keys(v1).map((k) => [k, { body: '<html>Đăng nhập wifi</html>' }]));
    await expect(load(b.code, store, () => portal).install()).rejects.toThrow('không khớp');
    const flaky: Net = { ...Object.fromEntries(Object.entries(v1).map(([k, body]) => [k, { body }])), 'assets/app-aaa.js': { status: 500, body: 'x' } };
    await expect(load(b.code, store, () => flaky).install()).rejects.toThrow('HTTP 500');
    expect(store.m.size).toBe(0);
  });
  test('cập nhật đủ file: bản mới chờ, không tự chiếm; chỉ khi trang yêu cầu mới skipWaiting; cache cũ xóa sau khi kích hoạt', async () => {
    const store = new Store(), b1 = buildSw(makeDist(v1), template, 'b1'), b2 = buildSw(makeDist(v2), template, 'b2');
    const net = (v: Record<string, string>) => () => Object.fromEntries(Object.entries(v).map(([k, body]) => [k, { body }]));
    const old = load(b1.code, store, net(v1)); await old.install(); await old.activate();
    const next = load(b2.code, store, net(v2)); await next.install();
    expect(next.log.skipped).toBe(false);
    expect([...store.m.keys()].sort()).toEqual([`mekoniq-shell-${b1.version}`, `mekoniq-shell-${b2.version}`].sort()); // cả hai cùng tồn tại khi chờ
    expect(await (await old.get('x', 'navigate'))!.text()).toBe('<html>v1</html>'); // bản cũ vẫn chạy, chunk cũ vẫn có
    next.message({ type: 'SKIP_WAITING' });
    expect(next.log.skipped).toBe(true);
    await next.activate();
    expect([...store.m.keys()]).toEqual([`mekoniq-shell-${b2.version}`]);
    expect(await (await next.get('x', 'navigate'))!.text()).toBe('<html>v2</html>');
  });
  test('chỉ bắt GET cùng nguồn: POST và tài nguyên nơi khác đi thẳng ra mạng', async () => {
    const b = buildSw(makeDist(v1), template, 'b1'), sw = load(b.code, new Store(), () => ({}));
    expect(sw.intercepts({ method: 'GET', url: 'https://app.test/assets/a.js', mode: 'cors' })).toBe(true);
    expect(sw.intercepts({ method: 'POST', url: 'https://app.test/api', mode: 'cors' })).toBe(false);
    expect(sw.intercepts({ method: 'GET', url: 'https://cdn.example/x.js', mode: 'cors' })).toBe(false);
  });
});
