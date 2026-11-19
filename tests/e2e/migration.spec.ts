import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

/** Turns the app's live v3 database into a v2 one (what the previous release would have left on disk), then reloads. */
async function downgradeToV2(page: Page) {
  await page.evaluate(async () => {
    const open = (name: string, version?: number, up?: (db: IDBDatabase) => void) => new Promise<IDBDatabase>((ok, no) => { const r = version ? indexedDB.open(name, version) : indexedDB.open(name); if (up) r.onupgradeneeded = () => up(r.result); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
    const all = (db: IDBDatabase, s: string) => new Promise<unknown[]>((ok) => { const r = db.transaction(s).objectStore(s).getAll(); r.onsuccess = () => ok(r.result); });
    const live = await open('mekoniq-solar-lab');
    const rows = { projects: await all(live, 'projects'), revisions: await all(live, 'revisions') };
    live.close();
    await new Promise((ok) => { const r = indexedDB.deleteDatabase('mekoniq-solar-lab'); r.onsuccess = r.onerror = r.onblocked = () => ok(null); });
    const v2 = await open('mekoniq-solar-lab', 2, (db) => {
      db.createObjectStore('projects', { keyPath: 'projectId' }); db.createObjectStore('revisions', { keyPath: ['projectId', 'revision'] });
      db.createObjectStore('components', { keyPath: ['modelId', 'revision'] }).createIndex('byModel', 'modelId'); db.createObjectStore('offers', { keyPath: 'offerId' }); db.createObjectStore('weather', { keyPath: 'seriesId' });
    });
    await new Promise<void>((ok) => { const tx = v2.transaction(['projects', 'revisions'], 'readwrite'); for (const [s, rs] of Object.entries(rows)) for (const r of rs) tx.objectStore(s).put(r); tx.oncomplete = () => ok(); });
    v2.close();
  });
}

test('W09 migration N−1: mở bản mới trên DB v2 → sao lưu tự động trước khi nâng, dữ liệu còn nguyên, khôi phục thành bản sao; xuất tất cả nhập lại được', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Mở mẫu Lâm Hà' }).click();
  await page.getByRole('button', { name: 'Dự toán' }).click();
  await expect(page.locator('#quote-known')).toContainText('31.872.000');
  await page.getByRole('button', { name: 'Quay lại dự án' }).click();
  await downgradeToV2(page);
  await page.reload();
  await expect(page.locator('#status')).toContainText('Đã sao lưu 1 dự án trước khi nâng cấp kho dữ liệu (từ v2)');
  await expect(page.locator('#saved li')).toHaveCount(1);
  await page.getByRole('button', { name: /^Mở: / }).click();
  await expect(page.locator('#bom-total')).toContainText('31.872.000'); // dự án và giá nguyên vẹn sau khi nâng cấp
  await page.getByRole('button', { name: 'Quay lại' }).click();
  await expect(page.locator('.backup')).toContainText('từ v2');
  // dự án trong máy y hệt bản sao lưu: khôi phục không tạo bản trùng
  await page.locator('.restore-backup').click();
  await expect(page.locator('#status')).toContainText('Đã khôi phục 0 dự án (bản mới nhất của từng dự án, không kèm lịch sử revision; bản sao lưu vẫn giữ nguyên); 1 dự án đã có sẵn, bỏ qua');
  await expect(page.locator('#saved li')).toHaveCount(1);
  // người dùng sửa tiếp sau khi nâng cấp rồi mới khôi phục: bản sao lưu quay lại thành bản sao, không ghi đè
  await page.getByRole('button', { name: /^Mở: / }).click();
  await page.getByRole('button', { name: 'Dự toán' }).click();
  await page.locator('[data-device="vsun-620@1"]').getByLabel(/Số lượng/).fill('6');
  await page.locator('[data-device="vsun-620@1"]').getByRole('button', { name: 'Cập nhật SL' }).click();
  await expect(page.locator('#quote-known')).toContainText('27.904.000');
  await page.getByRole('button', { name: 'Quay lại dự án' }).click();
  await page.getByRole('button', { name: 'Quay lại' }).click();
  await page.locator('.restore-backup').click();
  await expect(page.locator('#status')).toContainText('Đã khôi phục 1 dự án (bản mới nhất của từng dự án, không kèm lịch sử revision; bản sao lưu vẫn giữ nguyên); 1 dự án trùng ID được khôi phục thành bản sao');
  await expect(page.locator('#saved li')).toHaveCount(2);

  // xuất tất cả → xóa sạch → nhập lại
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#export-all').click()]);
  const text = await readFile((await dl.path())!, 'utf8');
  expect(JSON.parse(text).projects).toHaveLength(2);
  await page.evaluate(async () => { await new Promise((ok) => { const r = indexedDB.deleteDatabase('mekoniq-solar-lab'); r.onsuccess = r.onerror = r.onblocked = () => ok(null); }); });
  await page.reload();
  await expect(page.locator('#saved')).toHaveCount(0);
  await page.locator('#import-file').setInputFiles({ name: 'all.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  await expect(page.locator('#status')).toContainText('Đã nhập 2 dự án từ file sao lưu');
  await expect(page.locator('#saved li')).toHaveCount(2);
});

test('W09 rollback: bản app cũ gặp DB mới hơn → thông báo rõ, không xóa gì; mở lại bản mới thì dữ liệu còn', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Mở mẫu Lâm Hà' }).click();
  // giả lập DB do bản tương lai (v9) tạo ra: bản này (DB v3) mở được tối đa v3 → VersionError
  await page.evaluate(async () => {
    const live = await new Promise<IDBDatabase>((ok) => { const r = indexedDB.open('mekoniq-solar-lab'); r.onsuccess = () => ok(r.result); });
    const rows = await new Promise<unknown[]>((ok) => { const r = live.transaction('projects').objectStore('projects').getAll(); r.onsuccess = () => ok(r.result); });
    live.close();
    (window as unknown as { __rows: unknown[] }).__rows = rows;
    await new Promise<void>((ok) => { const r = indexedDB.open('mekoniq-solar-lab', 9); r.onsuccess = () => { r.result.close(); ok(); }; });
  });
  // tab đang mở bị bản mới hơn lấy kho: báo ngay để người dùng tải lại, thay vì để các lần lưu sau hỏng với lỗi thô
  await expect(page.locator('#reload-needed')).toContainText('Tải lại trang');
  await page.reload();
  await expect(page.locator('#app')).toContainText('MỚI HƠN');
  await expect(page.locator('#app')).toContainText('không có gì bị xóa');
  await expect(page.locator('#app')).toContainText('Đừng xóa dữ liệu trang');
  // bản này không có ô nhập file khi gặp kho mới hơn; nó vẫn cho lấy một bản dữ liệu ra file mà không sửa gì
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Xuất dữ liệu ra file' }).click()]);
  const exported = JSON.parse(await readFile((await dl.path())!, 'utf8'));
  expect(exported.format).toBe('mekoniq-solar-lab/backup');
  expect(exported.projects.map((x: { project: { name: string } }) => x.project.name)).toEqual(['Lâm Hà']);
  const kept = await page.evaluate(async () => { const live = await new Promise<IDBDatabase>((ok) => { const r = indexedDB.open('mekoniq-solar-lab'); r.onsuccess = () => ok(r.result); }); const n = await new Promise<number>((ok) => { const r = live.transaction('projects').objectStore('projects').count(); r.onsuccess = () => ok(r.result); }); live.close(); return n; });
  expect(kept).toBe(1); // dữ liệu còn nguyên
});
