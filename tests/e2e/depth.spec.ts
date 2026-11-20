import { expect, test, type Page } from '@playwright/test';

// No asEngineer here: these start at the default depth, Cơ bản, as a first visit does.
const setDepth = async (page: Page, d: 'co-ban' | 'tho' | 'ky-su') => {
  await page.locator(`#depth-${d}`).click();
  await expect(page.locator(`#depth-${d}`)).toHaveAttribute('aria-pressed', 'true');
};
const ran = (page: Page) => expect(page.locator('#health-supply')).toContainText('giờ/năm', { timeout: 60_000 }); // the automatic run is done

test('cùng dự án, ba độ sâu cho cùng số', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto('/#/mau');
  await page.locator('#coach-skip').click();
  await expect(page.locator('#depth-co-ban')).toHaveAttribute('aria-pressed', 'true'); // mặc định Cơ bản
  await ran(page);
  const health = page.locator('#ws-health');
  const basic = await health.innerText();
  for (const d of ['tho', 'ky-su'] as const) {
    await setDepth(page, d);
    expect(await health.innerText(), d).toBe(basic);
  }
  await page.reload(); // nhớ theo trình duyệt; bản xem thử dựng lại và tự chạy lại ra đúng số cũ
  await expect(page.locator('#depth-ky-su')).toHaveAttribute('aria-pressed', 'true');
  await ran(page);
  expect(await health.innerText()).toBe(basic);
});

test('Cơ bản không ẩn trạng thái nào', async ({ page }) => {
  await page.goto('/#/mau');
  await page.locator('#coach-skip').click();
  await page.locator('#step-dau-noi').click();
  await expect(page.locator('#findings-summary')).toBeVisible();
  const shown = () => Promise.all(['fail', 'limited', 'unknown'].map((s) => page.locator(`#ws-panel .finding.${s}:visible`).count()));
  const basic = await shown();
  expect(basic[1], 'giới hạn').toBeGreaterThan(0); // Nhà mẫu: 2 giới hạn, 4 chưa đủ dữ liệu
  expect(basic[2], 'chưa đủ dữ liệu').toBeGreaterThan(0);
  await expect(page.locator('#ws-health [data-state]:visible')).toHaveCount(4);
  await expect(page.locator('#checklist')).toBeVisible();
  await expect(page.locator('#inspector')).toBeVisible();
  await setDepth(page, 'ky-su');
  expect(await shown()).toEqual(basic);
});
