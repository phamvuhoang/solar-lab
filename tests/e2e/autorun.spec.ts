import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { tab } from './nav';

const RUN = { timeout: 60_000 }; // shade preview + a year of dispatch in the worker, with other tests sharing the CPU
/** "1.234,5" → 1234.5 */
const vi = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));
/** The grid purchase the supply cell shows, as written there. */
const gridText = async (page: Page) => /mua lưới ([\d.,]+) kWh/.exec((await page.locator('#health-supply').textContent()) ?? '')![1];

async function openSample(page: Page) {
  await page.goto('/#/mau');
  await page.locator('#coach-skip').click();
  await expect(page.locator('#health-pv')).toHaveAttribute('data-state', 'pass', RUN);
}
async function addTwoPanels(page: Page) {
  await page.locator('#add-panel').click();
  await expect(page.locator('#add-panel-n')).toHaveValue('2');
  await page.locator('#add-confirm').click();
}

test('sửa một tấm: bốn ô cập nhật mà không bấm chạy', async ({ page }) => {
  test.setTimeout(150_000);
  await openSample(page);
  const pv = page.locator('#health-pv'), supply = page.locator('#health-supply'), money = page.locator('#health-money');
  await expect(pv).toContainText('(bóng: xem trước)');
  await expect(supply).toContainText('thiếu 0 giờ/năm');
  const [pvBefore, gridBefore, moneyBefore] = [await pv.textContent(), vi(await gridText(page)), await money.textContent()];

  await addTwoPanels(page);
  await expect(pv).toContainText('đang tính lại…');
  await expect(supply).toContainText('đang tính lại…');
  await expect(money).not.toHaveText(moneyBefore!); // money and electric are synchronous
  await expect(page.locator('#health-electric')).toContainText('0 lỗi');
  await expect(pv).toHaveAttribute('data-state', 'pass', RUN);
  await expect(pv).not.toHaveText(pvBefore!);
  expect(vi(await gridText(page))).toBeLessThan(gridBefore);
});

test('số trên thanh bằng màn Hệ thống và CSV', async ({ page }) => {
  test.setTimeout(120_000);
  await openSample(page);
  const kwh = await gridText(page);
  await tab(page, 'he-thong');
  await expect(page.locator('#shade-standard')).toHaveText('Tính bóng chuẩn (cho báo cáo)'); // the sample's shade is the preview
  await expect(page.locator('#sim-table tbody tr', { hasText: 'Nhập / xuất lưới' })).toContainText(`${kwh} / `);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#sim-csv').click()]);
  const lines = (await readFile((await dl.path())!, 'utf8')).split('\r\n');
  const head = lines.findIndex((l) => l.startsWith('timestamp_utc')), col = lines[head].split(',').indexOf('grid_import_wh');
  const sum = lines.slice(head + 1).filter(Boolean).reduce((s, l) => s + Number(l.split(',')[col]), 0);
  expect(Math.abs(sum / 1000 - vi(kwh))).toBeLessThanOrEqual(0.05);
});

test('đang gõ dở thì kết quả mới không xóa ô nhập', async ({ page }) => {
  test.setTimeout(150_000);
  await openSample(page);
  await addTwoPanels(page);
  await expect(page.locator('#health-pv')).toContainText('đang tính lại…');
  await tab(page, 'he-thong');
  await page.locator('#s-min').fill('25'); // typed, not saved
  await expect(page.locator('#health-pv')).toHaveAttribute('data-state', 'pass', RUN);
  await expect(page.locator('#s-min')).toHaveValue('25');
  await expect(page.locator('#s-min')).toBeFocused();
  await expect(page.locator('#ws-fresh')).toHaveText('Có kết quả mới · Hiện');
  await page.locator('#ws-fresh').click(); // the person asks for the repaint
  await expect(page.locator('#sim-result')).toBeVisible();
  await expect(page.locator('#ws-fresh')).toHaveCount(0);
});
