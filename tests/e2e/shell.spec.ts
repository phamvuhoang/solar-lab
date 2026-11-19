import { expect, test } from '@playwright/test';

test('shell: tạo dự án, mở mẫu Lâm Hà, không có request ngoài origin', async ({ page, baseURL }) => {
  const external: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith(baseURL!) && !r.url().startsWith('data:')) external.push(r.url());
  });

  await page.goto('/');
  await page.getByLabel('Tên dự án').fill('Nhà vườn');
  await page.getByRole('button', { name: 'Tạo dự án' }).click();
  await expect(page.getByRole('heading', { name: 'Nhà vườn' })).toBeVisible();
  await expect(page.getByText('Bản nháp')).toBeVisible();

  await page.getByRole('button', { name: 'Quay lại' }).click();
  await page.getByRole('button', { name: 'Mở mẫu Lâm Hà' }).click();
  await expect(page.getByRole('heading', { name: 'Lâm Hà' })).toBeVisible();
  await expect(page.locator('#bom-total')).toContainText('31.872.000');

  expect(external).toEqual([]);
});
