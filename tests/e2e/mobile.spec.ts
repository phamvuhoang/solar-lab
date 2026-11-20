import { expect, test, type Page } from '@playwright/test';
import { STEPS } from '../../src/ui/route';

test.use({ viewport: { width: 360, height: 740 }, hasTouch: true });

const width = (page: Page) => page.evaluate(() => document.scrollingElement!.scrollWidth);

test('điện thoại: Thêm và bảng bước là tấm kéo từ dưới lên; thêm 2 tấm; mỗi bước vừa 360 px; chạm chọn thiết bị trong 3D', async ({ page }) => {
  await page.goto('/#/mau');
  await page.locator('#coach-skip').tap();
  const addSheet = page.locator('#sheet-add'), stepSheet = page.locator('#sheet-panel'), health = page.locator('#ws-health');
  await expect(addSheet).toHaveAttribute('aria-expanded', 'false');
  await expect(stepSheet).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#ws-add')).toBeHidden();
  await expect(page.locator('#ws-panel')).toBeHidden();
  const view = page.locator('canvas[data-devices]');
  await expect(view).toBeVisible({ timeout: 20000 });

  // Thêm → 2 tấm (the count the palette suggests) → the health bar follows; the sheet stays open and never covers the bar
  const money = page.locator('#health-money'), before = (await money.textContent())!;
  await addSheet.tap();
  await expect(addSheet).toHaveAttribute('aria-expanded', 'true');
  await page.locator('#add-panel').tap();
  await page.locator('#add-confirm').tap();
  await expect(page.locator('#status')).toContainText('Đã lưu: revision');
  await expect(view).toHaveAttribute('data-panels', '10');
  await expect(money).not.toHaveText(before);
  await expect(page.locator('#add-panel')).toBeVisible();
  const [sheet, bar] = [(await page.locator('#ws-add').boundingBox())!, (await health.boundingBox())!];
  expect(sheet.y + sheet.height).toBeLessThanOrEqual(bar.y + 1);
  expect(sheet.height).toBeLessThanOrEqual(740 * 0.7 + 1);
  await expect(health).toBeInViewport({ ratio: 1 });

  // a step opens its panel as the other sheet; the sheet scrolls on its own; nothing is wider than the phone
  for (const s of STEPS) {
    await page.locator(`#step-${s.id}`).tap();
    await expect(page.locator(`#step-${s.id}`)).toHaveAttribute('aria-current', 'step');
    await expect(stepSheet).toHaveAttribute('aria-expanded', 'true');
    await expect(addSheet).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#ws-panel > *').first()).toBeVisible();
    expect(await width(page), s.id).toBeLessThanOrEqual(360);
    await expect(health).toBeInViewport({ ratio: 1 });
  }
  await page.locator('#step-bo-tri').tap();
  expect(await page.locator('#ws-panel').evaluate((e) => getComputedStyle(e).overflowY === 'auto' && e.scrollHeight > e.clientHeight)).toBe(true);

  // close the sheet, tap a device in 3D: it is selected and the step panel opens on "Đang chọn"
  await stepSheet.tap();
  await expect(stepSheet).toHaveAttribute('aria-expanded', 'false');
  const id = (await view.getAttribute('data-devices'))!.split(',')[0]!;
  await view.scrollIntoViewIfNeeded(); // touchscreen.tap uses viewport coordinates and does not scroll
  const [x, y] = JSON.parse((await view.getAttribute('data-device-pos'))!)[id] as [number, number];
  const box = (await view.boundingBox())!;
  await page.touchscreen.tap(box.x + x, box.y + y);
  await expect.poll(() => view.getAttribute('data-selected')).toBe(id);
  await expect(stepSheet).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#inspector')).toBeInViewport();
});
