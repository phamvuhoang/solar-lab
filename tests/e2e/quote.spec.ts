import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { asEngineer, tab } from './nav';

test.beforeEach(async ({ page }) => { await asEngineer(page); }); // these use controls shown from Thợ or Kỹ sư up

test('W02: Dự án → Dự toán → đổi số lượng/báo giá → xem phần chênh → xuất CSV', async ({ page }) => {
  await page.goto('/#/');
  await page.getByRole('button', { name: 'Mở mẫu Lâm Hà' }).click();
  await tab(page, 'du-toan');

  await expect(page.locator('#quote-known')).toContainText('31.872.000');
  await expect(page.locator('#quote-total')).toContainText('chưa đủ để báo');
  await expect(page.locator('#quote-total')).toContainText('Khung, Dây, Thiết bị bảo vệ, Công lắp');
  await expect(page.locator('tr[data-key="design:vsun-620@1"]')).toContainText('8 × 620 W × 3.200 đ/W');

  // bớt hai tấm → giảm 3.968.000
  const panel = page.locator('[data-device="vsun-620@1"]');
  await panel.getByLabel(/Số lượng/).fill('6');
  await panel.getByRole('button', { name: 'Cập nhật SL' }).click();
  await expect(page.locator('#quote-known')).toContainText('27.904.000');
  await page.locator('#cmp-rev').selectOption('1');
  await page.locator('#cmp-run').click();
  await expect(page.locator('#cmp-known')).toContainText('-3.968.000');
  await expect(page.locator('#cmp-total')).toContainText('không công bố');

  // dây 12,5 m × 18.000 đ/m = 225.000
  await page.locator('#x-cat').selectOption('cable');
  await page.locator('#x-label').fill('Dây DC 4 mm²');
  await page.locator('#x-qty').fill('12,5 m');
  await page.locator('#x-price').fill('18.000');
  await page.getByRole('button', { name: 'Thêm dòng' }).click();
  const cable = page.locator('tr[data-key^="extra:"]');
  await expect(cable).toContainText('12,5 m × 18.000 đ/m');
  await expect(cable).toContainText('225.000');
  await expect(page.locator('#quote-total')).not.toContainText('Dây,');

  // báo giá mới cho pin cũ, đã gồm VAT
  const battery = page.locator('[data-device="used-battery@1"]');
  await battery.getByRole('button', { name: 'Thêm báo giá' }).click();
  await page.locator('#o-seller').fill('Kho B');
  await page.locator('#o-price').fill('15.500.000');
  await page.locator('#o-vat').selectOption('included');
  await page.getByRole('button', { name: 'Lưu báo giá' }).click();
  await expect(page.locator('tr[data-key="design:used-battery@1"]')).toContainText('15.500.000');
  await expect(page.locator('tr[data-key="design:used-battery@1"]')).toContainText('đã gồm VAT');

  // giá sai khuôn dạng bị chặn tại form
  await battery.getByRole('button', { name: 'Thêm báo giá' }).click();
  await page.locator('#o-seller').fill('Kho C');
  await page.locator('#o-price').fill('1,5');
  await page.getByRole('button', { name: 'Lưu báo giá' }).click();
  await expect(page.locator('#offer-error')).toContainText('không phải số tiền nguyên');

  // CSV
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#export-csv').click()]);
  expect(dl.suggestedFilename()).toMatch(/\.csv$/);
  const csv = await readFile((await dl.path())!, 'utf8');
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  expect(csv).toContain('225000');
  expect(csv).toContain('Chưa đủ để báo tổng');
});

test('chọn một thiết bị khi đang gõ dở báo giá hay dòng bổ sung: chữ đã gõ còn nguyên, chỉ dòng được tô đổi', async ({ page }) => {
  await page.goto('/#/');
  await page.getByRole('button', { name: 'Mở mẫu Lâm Hà' }).click();
  await tab(page, 'du-toan');
  await page.locator('[data-device="used-battery@1"]').getByRole('button', { name: 'Thêm báo giá' }).click();
  await page.locator('#o-seller').fill('Cửa hàng đang gõ');
  await page.locator('#x-label').fill('Khung nhôm');
  const panels = page.locator('tr[data-key="design:vsun-620@1"]'), battery = page.locator('tr[data-key="design:used-battery@1"]');
  await panels.locator('button.bom-pick').click();
  await expect(page.locator('#inspector')).toContainText('8 món');
  await expect(panels).toHaveAttribute('aria-selected', 'true');
  await expect(battery).toHaveAttribute('aria-selected', 'false');
  await battery.locator('button.bom-pick').click();
  await expect(battery).toHaveAttribute('aria-selected', 'true');
  await expect(battery).toHaveClass(/selected/);
  await expect(panels).toHaveAttribute('aria-selected', 'false');
  await expect(page.locator('#o-seller')).toHaveValue('Cửa hàng đang gõ');
  await expect(page.locator('#x-label')).toHaveValue('Khung nhôm');
});
