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

test('trình duyệt chưa có checkVisibility (Safari < 17.4): bấm lỗi vẫn đưa focus tới chi tiết, không lỗi', async ({ page }) => {
  await page.addInitScript(() => { delete (Element.prototype as Partial<Element>).checkVisibility; });
  await page.goto('/#/mau');
  await page.locator('#coach-skip').click();
  await page.locator('#step-dau-noi').click();
  await page.locator('#ws-panel .finding.limited').first().click(); // at Cơ bản its controls are hidden: the detail takes the focus
  await expect(page.locator('#finding-detail')).toBeFocused();
  await expect(page.locator('#fatal')).toHaveCount(0);
});

test('chỗ sửa nằm ở độ sâu cao hơn: nói rõ "sửa ở chế độ Thợ" và chuyển được, không im lặng', async ({ page }) => {
  await page.goto('/#/mau');
  await page.locator('#coach-skip').click();
  await page.locator('#step-dau-noi').click();
  await setDepth(page, 'tho'); // thêm một tải chưa có lịch bằng form của ② (chỉ có từ Thợ)
  await page.getByRole('button', { name: 'Thêm tải AC' }).click();
  await expect(page.locator('#ws-rev')).toContainText('Đã lưu');
  await setDepth(page, 'co-ban');
  const supply = page.locator('#health-supply');
  await expect(supply).toContainText('chưa đặt lịch chạy', { timeout: 60_000 });

  await supply.click(); // lịch tải ở ③ chỉ hiện từ Thợ
  await expect(page.locator('#sim-btn')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#ws-panel > #depth-hint')).toContainText('Mục này sửa ở chế độ Thợ.');
  await expect(page.locator('#to-tho')).toBeFocused();
  await page.locator('#to-tho').click();
  await expect(page.locator('#depth-tho')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#depth-co-ban')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#depth-hint')).toHaveCount(0);
  await expect(page.locator('.card[data-load]', { hasText: 'chưa đặt lịch' }).locator('input[id^="lp-hours-"]')).toBeFocused();

  await supply.click(); // ở Thợ ô đó hiện sẵn: tới thẳng, không nhắc
  await expect(page.locator('.card[data-load]', { hasText: 'chưa đặt lịch' }).locator('input[id^="lp-hours-"]')).toBeFocused();
  await expect(page.locator('#depth-hint')).toHaveCount(0);
});

test('lời một kiểm tra và "… là gì?" theo độ sâu; đổi độ sâu không vẽ lại', async ({ page }) => {
  await page.goto('/#/mau');
  await page.locator('#coach-skip').click();
  await page.locator('#step-dau-noi').click();
  await page.locator('#ws-panel .finding.limited').first().click();
  const detail = page.locator('#finding-detail');
  await expect(detail.locator('h3')).toHaveText(/^Bị giới hạn: /); // trạng thái mở đầu, cả ở Cơ bản
  await expect(detail.getByText('Hỏi thợ lắp đặt về mục này')).toBeVisible(); // không có sửa nhanh
  const value = detail.getByText(/^Giá trị /), code = detail.getByText(/^Mã: /);
  await expect(value).toBeHidden();
  await expect(code).toBeHidden();
  const what = detail.locator('details.term').first();
  await what.locator('summary').click(); // "… là gì?": lời thường ở mọi độ sâu
  await expect(what.locator('p').first()).toBeVisible();
  await expect(what.locator('p').nth(1)).toBeHidden();

  await setDepth(page, 'tho');
  await expect(value).toBeVisible();
  await expect(code).toBeHidden();
  await setDepth(page, 'ky-su');
  await expect(code).toBeVisible();
  await expect(detail.getByText(/^Công thức: /)).toBeVisible();
  await expect(what.locator('p').nth(1)).toBeVisible(); // vẫn mở: không vẽ lại, chỉ thêm lời kỹ sư
});
