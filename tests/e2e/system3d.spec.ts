import { expect, test, type Locator, type Page } from '@playwright/test';
import { tab } from './nav';

/** Playwright's label option is exact-string only; match option text by regex instead. */
const pick = async (select: Locator, text: RegExp) => select.selectOption(await select.locator('option', { hasText: text }).first().getAttribute('value') as string);

/** The sample house with its 3D view ready; returns the canvas and its device ids (inverter, battery, then the loads). */
async function openSample(page: Page) {
  await page.goto('/#/mau');
  const view = page.locator('canvas[data-devices]');
  await expect(view).toBeVisible({ timeout: 20000 });
  await expect(page.locator('#view-mode-3d')).toHaveAttribute('aria-pressed', 'true');
  return { view, ids: (await view.getAttribute('data-devices'))!.split(',') };
}
/** Clicks a device where the canvas says it is drawn. */
async function clickDevice(view: Locator, id: string) {
  await view.scrollIntoViewIfNeeded();
  const [x, y] = JSON.parse((await view.getAttribute('data-device-pos'))!)[id] as [number, number];
  await view.click({ position: { x, y } });
  await expect.poll(() => view.getAttribute('data-selected')).toBe(id);
}

test('chọn pin trên 3D → đổi model → tiền đổi → hoàn tác', async ({ page }) => {
  const { view, ids } = await openSample(page);
  await expect(page.locator('#health-money')).toContainText('15.872.000');
  await clickDevice(view, ids[1]);
  await expect(page.locator('#inspector')).toContainText('Dyness');
  await page.locator('#insp-replace').click();
  await pick(page.locator('#insp-model'), /Bộ pin cũ/);
  await expect(page.locator('#insp-preview')).toContainText('Bộ pin cũ');
  await page.locator('#insp-confirm').click();
  await expect(page.locator('#health-money')).toContainText('31.872.000');
  await expect(page.locator('#inspector')).toContainText('Bộ pin cũ'); // same instance, still selected
  await page.locator('#ws-undo').click();
  await expect(page.locator('#health-money')).toContainText('15.872.000');
});

test('thêm 2 tấm từ bảng Thêm: xem trước nêu chuỗi đổi, 3D có 10 tấm, không lỗi đỏ', async ({ page }) => {
  await openSample(page);
  await page.locator('#add-panel').click();
  await expect(page.locator('#add-panel-n')).toHaveValue('2');
  await expect(page.locator('#add-preview')).toContainText('Chuỗi 1: 4 → 5 tấm');
  await page.locator('#add-confirm').click();
  await expect(page.locator('canvas[data-panels="10"]')).toBeVisible();
  await expect(page.locator('#health-electric')).toContainText('0 lỗi');
});

test('chỉ bàn phím: thêm tải, chọn trong danh sách, xóa có báo dây bị kéo theo', async ({ page }) => {
  const { view } = await openSample(page);
  const enter = async (l: Locator) => { await l.focus(); await l.press('Enter'); };
  await enter(page.locator('#add-load'));
  await expect(page.locator('#add-preview')).toContainText('Thêm Tải sinh hoạt');
  await enter(page.locator('#add-confirm'));
  await expect(view).toHaveAttribute('data-devices', /^([^,]+,){4}[^,]+$/); // 5 devices
  await enter(page.locator('#step-dau-noi'));
  await expect(page.locator('#design-btn')).toHaveAttribute('aria-selected', 'true');
  await enter(page.getByRole('button', { name: 'Chọn Tải sinh hoạt 300 W (tải mẫu) #3' }));
  await expect(page.locator('#inspector')).toContainText('Tải sinh hoạt 300 W (tải mẫu) #3');
  await enter(page.locator('#insp-delete'));
  await expect(page.locator('#insp-preview')).toContainText('Bỏ 1 dây nối');
  await enter(page.locator('#insp-confirm'));
  await expect(view).toHaveAttribute('data-devices', /^([^,]+,){3}[^,]+$/); // back to 4
  await expect(page.locator('#inspector')).toContainText('Chưa chọn gì');
});

test('phím Delete trên 3D mở xem trước xóa', async ({ page }) => {
  const { view, ids } = await openSample(page);
  await clickDevice(view, ids[1]);
  await view.press('Delete');
  await expect(page.locator('#insp-preview')).toContainText('Bỏ Dyness');
  await expect(page.locator('#insp-preview')).toContainText('Bỏ 1 dây nối');
  await expect(page.locator('#insp-confirm')).toBeFocused();
  await expect(view).toHaveAttribute('data-devices', ids.join(',')); // nothing removed before the confirm
  await page.keyboard.press('Enter');
  await expect(view).toHaveAttribute('data-devices', ids.filter((x) => x !== ids[1]).join(','));
  await page.locator('#ws-undo').click();
  await expect(view).toHaveAttribute('data-devices', ids.join(','));
});

test('dự án trống: lỗi miền thành câu thường, không lưu; Inverter nối cả tấm của chuỗi chưa nối', async ({ page }) => {
  await page.goto('/#/moi');
  await page.locator('#add-battery').click();
  await expect(page.locator('#add-preview')).toContainText('Cần có inverter trước');
  await expect(page.locator('#add-confirm')).toBeHidden();
  await expect(page.locator('#ws-rev')).toContainText('chưa lưu');
  // the batch form without an inverter makes one unconnected string of 8 (as rc.2 projects have)
  await tab(page, 'thiet-ke');
  await page.getByRole('button', { name: 'Xác nhận thêm' }).click();
  await expect(page.locator('select[id^="str-target-"]')).toHaveValue('');
  await page.locator('#add-inverter').click();
  await expect(page.locator('#add-preview')).toContainText('Chuỗi 1: 8 → 4 tấm');
  await expect(page.locator('#add-preview')).toContainText('Chuỗi 2: 0 → 4 tấm');
  await page.locator('#add-confirm').click();
  await expect(page.locator('select[id^="str-target-"]')).toHaveCount(2);
  for (const s of await page.locator('select[id^="str-target-"]').all()) await expect(s).not.toHaveValue('');
});

test('bấm dòng BOM chọn mọi instance của model; Vì sao? mở đúng kiểm tra; Mái nhà 3D bật 3D', async ({ page }) => {
  const { view } = await openSample(page);
  await tab(page, 'du-toan');
  await page.locator('tr[data-key="design:vsun-620@1"] button.bom-pick').click();
  await expect(page.locator('tr[data-key="design:vsun-620@1"]')).toHaveAttribute('aria-selected', 'true');
  await expect.poll(async () => (await view.getAttribute('data-selected'))?.split(',').length).toBe(8);
  await expect(page.locator('#inspector')).toContainText('8 món');
  await page.locator('tr[data-key="design:dyness-dl5-0c@1"] button.bom-pick').click();
  await expect(page.locator('#inspector')).toContainText('2 bị giới hạn công suất');
  await page.locator('#insp-why').click();
  await expect(page.locator('#design-btn')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#finding-detail')).toContainText('BATTERY_CHARGE_LIMIT');
  await page.locator('#view-mode-diagram').click();
  await page.locator('#open-roof').click();
  await expect(page.locator('#view-mode-3d')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#to-design').click();
  await expect(page.locator('#view-mode-diagram')).toHaveAttribute('aria-pressed', 'true');
});

test('vật cản và thiết bị: chọn trong danh sách, dịch 0,1 m (một revision, hoàn tác được), xem trước xóa vật cản', async ({ page }) => {
  const { view, ids } = await openSample(page);
  await page.getByRole('button', { name: 'Chọn Bồn nước' }).click();
  await expect(page.locator('#inspector')).toContainText('Trụ 1,2 × 1,2 × 1,8 m');
  await page.locator('#insp-move-right').click();
  await expect(page.locator('#ws-rev')).toContainText('r1');
  await expect(page.locator('#obstacles')).toContainText('tại (10,6, -1)');
  await page.locator('#insp-delete').click();
  await expect(page.locator('#insp-preview')).toContainText('Bỏ vật cản Bồn nước');
  await page.locator('#insp-cancel').click();
  await expect(page.locator('#insp-preview')).toBeEmpty();
  // a device: nudged north, the 3D draws it elsewhere; undo puts it back on the device wall
  await tab(page, 'thiet-ke');
  await page.locator(`#dev-sel-${ids[0]}`).click();
  const at = async () => JSON.parse((await view.getAttribute('data-device-pos'))!)[ids[0]];
  const before = await at();
  await page.locator('#insp-move-up').click();
  await expect.poll(at).not.toEqual(before);
  await page.locator('#ws-undo').click();
  await expect.poll(at).toEqual(before);
});
