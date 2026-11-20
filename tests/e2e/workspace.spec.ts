import { expect, test, type Page } from '@playwright/test';
import { STEPS } from '../../src/ui/route';
import { tab } from './nav';

const openLamHa = async (page: Page) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Mở mẫu Lâm Hà' }).click();
  await expect(page.locator('#ws-name')).toContainText('Lâm Hà');
};
const rev = async (page: Page) => Number(((await page.locator('#ws-rev').textContent()) ?? '').match(/r(\d+)$/)?.[1]);

test('tải lại trang giữ đúng dự án, bước và tab; Back của trình duyệt về tab trước', async ({ page }) => {
  await openLamHa(page);
  await tab(page, 'he-thong');
  await page.reload();
  await expect(page.locator('#ws-name')).toContainText('Lâm Hà');
  await expect(page.locator('#step-chay-thu')).toHaveAttribute('aria-current', 'step');
  await expect(page.locator('#sim-btn')).toHaveAttribute('aria-selected', 'true');
  await page.goBack();
  await expect(page.locator('#step-bo-tri')).toHaveAttribute('aria-current', 'step');
});

test('360 px: không cuộn ngang ở trang đầu và workspace', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  const width = () => page.evaluate(() => document.scrollingElement!.scrollWidth);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Mở mẫu Lâm Hà' })).toBeVisible();
  expect(await width()).toBeLessThanOrEqual(360);
  await page.getByRole('button', { name: 'Mở mẫu Lâm Hà' }).click();
  for (const s of STEPS) {
    await page.locator(`#step-${s.id}`).click();
    await expect(page.locator(`#step-${s.id}`)).toHaveAttribute('aria-current', 'step');
    await expect(page.locator('#ws-panel > *').first()).toBeVisible();
    expect(await width(), s.id).toBeLessThanOrEqual(360);
    await expect(page.locator('#ws-health')).toBeVisible();
  }
});

test('hash tới dự án không có → về trang đầu kèm lời giải thích', async ({ page }) => {
  await page.goto('/#/p/prj-khong-co/bo-tri');
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.locator('#status')).toContainText('Không tìm thấy dự án');
});

test('hai tab cùng sửa: tab sau báo xung đột và mở được bản mới nhất', async ({ page, context }) => {
  await openLamHa(page);
  const other = await context.newPage();
  await other.goto(page.url());
  await expect(other.locator('#ws-name')).toContainText('Lâm Hà');
  await page.locator('#add-demo-roof').click();
  await expect(page.locator('#status')).toContainText('Đã lưu: revision');
  const first = await rev(page);
  expect(await rev(other)).toBeLessThan(first);
  await other.locator('#add-demo-roof').click();
  await expect(other.locator('#status')).toContainText('đã được sửa ở tab khác');
  await other.locator('#ws-latest').click();
  await expect(other.locator('#ws-rev')).toHaveText(`Đã lưu · r${first}`);
  await expect(other.locator('#ws-latest')).toHaveCount(0);
});

test('thanh sức khỏe: Lâm Hà chưa đủ dữ liệu, bấm ô tiền tới Dự toán', async ({ page }) => {
  await openLamHa(page);
  await expect(page.locator('#health-electric[data-state="unknown"]')).toContainText('chưa đủ dữ liệu');
  const money = page.locator('#health-money');
  await expect(money).toContainText('31.872.000');
  await expect(money).toContainText('thiếu 4 giá');
  await money.click();
  await expect(page.locator('#quote-known')).toBeVisible();
});
