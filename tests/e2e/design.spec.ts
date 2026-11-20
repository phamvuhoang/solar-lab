import { expect, test, type Locator } from '@playwright/test';
import { tab } from './nav';

/** Playwright's label option is exact-string only; match option text by regex instead. */
const pick = async (select: Locator, text: RegExp) => select.selectOption(await select.locator('option', { hasText: text }).first().getAttribute('value') as string);

test('W03: preset 2 chuỗi cùng tracker → lỗi Isc → bấm lỗi → chuyển sang MPPT 2 → hết lỗi; BOM giữ nguyên; undo/redo', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Mở mẫu Lâm Hà' }).click();
  await tab(page, 'thiet-ke');

  // thiết lập nhiệt độ thiết kế
  await page.locator('#d-cold').fill('5');
  await page.locator('#d-hot').fill('70');
  await page.getByRole('button', { name: 'Lưu thiết lập' }).click();
  await expect(page.locator('#status')).toContainText('Đã lưu: revision 2'); // wait for the re-render before touching the form again

  await page.locator('#preset').selectOption('two-strings-one-tracker');
  await page.locator('#apply-preset').click();
  await expect(page.locator('#status')).toContainText('Đã lưu: revision 3');
  await expect(page.locator('#findings-summary')).toContainText('1 lỗi thiết kế');
  const isc = page.locator('button.finding[data-code="ISC_TRACKER"]');
  await expect(isc).toContainText('31,9 A');
  await expect(page.locator('svg.diagram')).toContainText('vượt giới hạn thiết kế');

  await tab(page, 'du-an');
  const bomBefore = await page.locator('#bom-total').textContent();
  await tab(page, 'thiet-ke');

  // bấm lỗi → focus vào cổng của chuỗi; đổi bằng bàn phím/form
  await page.locator('button.finding[data-code="ISC_TRACKER"]').click();
  await expect(page.locator('#finding-detail')).toContainText('Σ_chuỗi min(Isc)');
  await expect(page.locator('#finding-detail')).toContainText('Hậu quả');
  await expect(page.locator('select[id^="str-target-"]:focus')).toHaveCount(1);
  await pick(page.locator('tr[data-string]').nth(1).locator('select'), /MPPT 2/);
  await expect(page.locator('#findings-summary')).toContainText('0 lỗi thiết kế');
  await expect(page.locator('button.finding.fail[data-code="ISC_TRACKER"]')).toHaveCount(0);

  // chỉ chuyển cổng: giá/BOM không đổi
  await tab(page, 'du-an');
  expect(await page.locator('#bom-total').textContent()).toBe(bomBefore);
  await tab(page, 'thiet-ke');

  // undo / redo
  await page.locator('#undo').click();
  await expect(page.locator('#findings-summary')).toContainText('1 lỗi thiết kế');
  await page.locator('#redo').click();
  await expect(page.locator('#findings-summary')).toContainText('0 lỗi thiết kế');

  // kết nối sai loại: Pin ↔ Ra tải AC, bấm lỗi, xóa bằng bàn phím
  await pick(page.locator('#edge-from'), /· Pin \(Pin DC\)/);
  await pick(page.locator('#edge-to'), /Ra tải AC/);
  await page.getByRole('button', { name: 'Nối', exact: true }).click();
  const mismatch = page.locator('button.finding[data-code="PORT_TYPE_MISMATCH"]');
  await expect(mismatch).toBeVisible();
  await mismatch.click();
  await expect(page.locator('button[id^="edge-del-"]:focus')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(mismatch).toHaveCount(0);
});

test('W03: thêm theo lô có preview và xác nhận; thiếu dữ liệu hiển thị là chưa đủ dữ liệu, không phải đạt', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Mở mẫu Lâm Hà' }).click();
  await tab(page, 'thiet-ke');
  await page.locator('#preset').selectOption('two-trackers');
  await page.locator('#apply-preset').click();

  // chưa nhập nhiệt độ thiết kế → Voc lạnh unknown
  await expect(page.locator('button.finding[data-code="VOC_COLD_ABS"]').first()).toContainText('chưa đủ dữ liệu');
  await expect(page.locator('svg.diagram')).toContainText('chưa đủ dữ liệu');

  await pick(page.locator('#b-model'), /Hestia 650/);
  await page.locator('#b-count').fill('2');
  await expect(page.locator('#b-preview')).toContainText('2 chuỗi (1 + 1 tấm)');
  await expect(page.locator('svg.diagram [data-id^="str-"]')).toHaveCount(2);
  await page.getByRole('button', { name: 'Xác nhận thêm' }).click();
  await expect(page.locator('svg.diagram [data-id^="str-"]')).toHaveCount(4);

  // số tấm sai bị chặn
  await page.locator('tr[data-string]').first().getByLabel(/Số tấm/).fill('99');
  await page.locator('tr[data-string]').first().getByRole('button', { name: 'Đặt số tấm' }).click();
  await expect(page.locator('#design-error')).toContainText('Không đủ tấm chưa gán');
});
