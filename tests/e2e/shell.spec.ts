import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { asEngineer, tab } from './nav';

test.beforeEach(async ({ page }) => { await asEngineer(page); }); // these use controls shown from Thợ or Kỹ sư up

const card = (page: Page, name: string | RegExp) => page.locator('article', { has: page.getByRole('heading', { name }) });

test('W01: mở mẫu → chọn thiết bị → nhân bản → sửa Ah → lưu → reload → mở lại; không request ngoài origin', async ({ page, baseURL }) => {
  const external: string[] = [];
  page.on('request', (r) => { if (!r.url().startsWith(baseURL!) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url()); });

  await page.goto('/#/');
  await page.getByRole('button', { name: 'Mở mẫu Lâm Hà' }).click();
  await expect(page.locator('#ws-name')).toContainText('Lâm Hà');
  await tab(page, 'du-an');
  await expect(page.locator('#bom-total')).toContainText('31.872.000');

  await tab(page, 'thiet-bi');
  await page.locator('#filter-kind').selectOption('battery');
  await expect(card(page, /Dyness/)).toBeVisible();
  await expect(card(page, /Bộ pin cũ/)).toContainText('8.448');

  await card(page, /Bộ pin cũ/).getByRole('button', { name: 'Nhân bản' }).click();
  await page.locator('#s-capacityAh').fill('180');
  await page.locator('#s-nominalWh').fill('9,216 kWh');
  await page.getByRole('button', { name: 'Lưu thiết bị' }).click();
  await expect(page.locator('#status')).toContainText('Đã lưu');

  const copy = card(page, /bản sao/);
  await expect(copy).toContainText('9.216');
  await expect(card(page, /^Bộ pin cũ 51,2 V × 165 Ah \(người dùng khai\)$/)).toContainText('8.448'); // original untouched
  await copy.getByRole('button', { name: 'Thêm vào dự án' }).click();
  await expect(page.locator('#ws-rev')).toHaveText('Đã lưu · r2');
  await tab(page, 'du-an');
  await expect(page.getByText('Bản nháp · revision 2')).toBeVisible();

  await page.reload(); // the address keeps the project and tab open
  await expect(page.getByText('Bản nháp · revision 2')).toBeVisible();
  await expect(page.locator('#devices')).toContainText('bản sao');
  expect(external).toEqual([]);
});

test('W01: nhập sai đơn vị báo lỗi tại form, không lưu gì', async ({ page }) => {
  await page.goto('/#/');
  await page.getByRole('button', { name: 'Mở mẫu Lâm Hà' }).click();
  await tab(page, 'thiet-bi');
  await page.locator('#new-kind').selectOption('battery');
  await page.getByRole('button', { name: 'Tạo thiết bị từ đầu' }).click();
  await page.locator('#f-name').fill('Pin thử');
  await page.locator('#f-brand').fill('Thử');
  await page.locator('#s-capacityAh').fill('165 V');
  await page.getByRole('button', { name: 'Lưu thiết bị' }).click();
  await expect(page.locator('#s-capacityAh-err')).toContainText('Đơn vị "V" không hợp lệ');
  await expect(page.getByRole('heading', { name: /Tạo thiết bị/ })).toBeVisible();
});

test('W01: xuất rồi nhập lại; file sai đơn vị báo đúng trường và giữ nguyên nháp; chạy được khi offline', async ({ page, context }) => {
  await page.goto('/#/');
  await context.setOffline(true); // everything below must work without network
  await page.getByRole('button', { name: 'Mở mẫu Lâm Hà' }).click();
  await tab(page, 'du-an');

  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Xuất JSON' }).click()]);
  const doc = JSON.parse(await readFile((await dl.path())!, 'utf8'));
  await page.locator('#ws-home').click();

  await page.locator('#import-file').setInputFiles({ name: 'p.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) });
  await expect(page.locator('#status')).toContainText('bản sao mới'); // same projectId → imported as copy
  await page.locator('#ws-home').click();
  await expect(page.locator('#saved li')).toHaveCount(2);

  const i = doc.project.snapshots.components.findIndex((c: { modelId: string }) => c.modelId === 'used-battery');
  doc.project.snapshots.components[i].specs.nominalWh.u = 'kWh';
  await page.locator('#import-file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) });
  await expect(page.locator('#issues')).toContainText(`UNIT_MISMATCH tại /snapshots/components/${i}/specs/nominalWh/u`);
  await page.getByRole('button', { name: 'Quay lại' }).click();
  await expect(page.locator('#saved li')).toHaveCount(2); // draft list unchanged
});
