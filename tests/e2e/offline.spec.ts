import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tab } from './nav';

const DIST = fileURLToPath(new URL('../../dist/', import.meta.url));
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.csv': 'text/csv' };
/** Serves dist/ on its own origin (so storage is fresh) and lets a test swap what /sw.js answers, like deploying a new build. */
async function deploy(): Promise<{ server: Server; url: string; swOverride: { body: string | null } }> {
  const swOverride = { body: null as string | null };
  const server = createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    if (path === '/sw.js' && swOverride.body !== null) { res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' }); return void res.end(swOverride.body); }
    const file = normalize(join(DIST, path === '/' ? 'index.html' : path));
    if (!file.startsWith(DIST)) { res.writeHead(403); return void res.end(); }
    try { const data = await readFile(file); res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', vary: 'Origin', 'cache-control': 'no-store' }); res.end(data); }
    catch { res.writeHead(404); res.end('not found'); }
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const { port } = server.address() as { port: number };
  return { server, url: `http://127.0.0.1:${port}`, swOverride };
}


const ready = (page: Page) => expect(page.locator('#offline-status')).toHaveAttribute('data-state', 'ready', { timeout: 30000 });
const cacheKeys = (page: Page) => page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith('mekoniq-shell-')).sort());
const bumped = (code: string, version: string, extraAsset?: [string, string]) => {
  let c = code.replace(/const VERSION = '[^']*';/, `const VERSION = '${version}';`);
  if (extraAsset) c = c.replace(/const ASSETS = (\[.*\]);/, (_m, a) => `const ASSETS = ${JSON.stringify([...JSON.parse(a), extraAsset])};`);
  return c;
};

test('W08: app tải đủ file, mở lại khi mất mạng, kể cả sau khi đóng và mở trang', async ({ page, context }) => {
  await page.goto('/#/');
  await ready(page);
  const keys = await cacheKeys(page);
  expect(keys).toHaveLength(1);
  const entries = await page.evaluate(async (k) => (await (await caches.open(k)).keys()).map((r) => new URL(r.url).pathname).sort(), keys[0]);
  expect(entries).toContain('/index.html');
  expect(entries.some((e) => /\/assets\/pv\.worker-.*\.js$/.test(e))).toBe(true); // worker
  expect(entries.some((e) => /\/assets\/lam-ha-2023-pvgis-era5-.*\.js$/.test(e))).toBe(true); // dữ liệu thời tiết đóng gói
  expect(entries.some((e) => /\/assets\/three\.module-.*\.js$/.test(e))).toBe(true); // chunk 3D lazy
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: 'Mở mẫu Lâm Hà' }).click();
  await tab(page, 'pv');
  await page.locator('#wx-select').selectOption({ index: 1 }); // thời tiết đóng gói nạp được khi không có mạng
  await expect(page.locator('#status')).toContainText('Đã lưu: revision');
  await tab(page, 'mai'); // chunk three lazy lấy từ cache
  await expect(page.locator('#add-demo-roof')).toBeVisible();
  await expect(page.locator('#offline-status')).toHaveAttribute('data-state', 'ready');
});

test('W08: bản cập nhật thiếu file thì bỏ, bản cũ vẫn chạy nguyên vẹn (ngoại tuyến vẫn mở được)', async ({ page, context }) => {
  const d = await deploy();
  await page.goto(d.url + '/#/');
  await ready(page);
  const [old] = await cacheKeys(page);
  const code = await readFile(join(DIST, 'sw.js'), 'utf8');
  d.swOverride.body = bumped(code, 'ban-hong', ['assets/khong-co-file-nay.js', 'f'.repeat(64)]);
  await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r!.update().catch(() => {}); });
  await expect(page.locator('#offline-status')).toHaveAttribute('data-state', 'update-failed', { timeout: 30000 });
  await expect(page.locator('#offline-status')).toContainText('bản cũ nguyên vẹn');
  expect(await cacheKeys(page)).toEqual([old]); // cache bản hỏng đã bị xóa, bản cũ còn nguyên
  await context.setOffline(true);
  d.swOverride.body = null;
  await page.reload();
  await expect(page.getByRole('button', { name: 'Mở mẫu Lâm Hà' })).toBeVisible();
  d.server.close();
});

test('W08: bản cập nhật đủ file chờ người dùng bấm Cập nhật; sau đó chỉ còn cache mới; dự án đang sửa vẫn còn', async ({ page }) => {
  const d = await deploy();
  await page.goto(d.url + '/#/');
  await ready(page);
  const [old] = await cacheKeys(page);
  await page.getByRole('button', { name: 'Mở mẫu Lâm Hà' }).click();
  await tab(page, 'du-an');
  await expect(page.locator('#devices')).toBeVisible(); // đã có bản nháp lưu trong kho
  const code = await readFile(join(DIST, 'sw.js'), 'utf8');
  d.swOverride.body = bumped(code, 'ban-moi');
  await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r!.update(); });
  await expect(page.locator('#offline-status')).toHaveAttribute('data-state', 'update-available', { timeout: 30000 });
  await expect(page.locator('#devices')).toBeVisible(); // không tự tải lại trang giữa chừng
  expect(await cacheKeys(page)).toEqual([old, 'mekoniq-shell-ban-moi'].sort()); // cả hai cùng có khi đang chờ
  const reloaded = page.waitForEvent('load'); // armed before the click: only the new document fires it
  await page.locator('#offline-update').click();
  await expect.poll(() => cacheKeys(page).catch(() => []), { timeout: 30000 }).toEqual(['mekoniq-shell-ban-moi']); // trang tải lại ngay sau khi bản mới nhận quyền
  await reloaded;
  await expect(page.locator('#offline-status')).toHaveAttribute('data-state', 'ready'); // trang cũ đang hiện "update-available"
  await expect(page.locator('#devices')).toBeVisible(); // bản nháp vẫn còn sau khi cập nhật (địa chỉ giữ dự án đang mở)
  d.server.close();
});
