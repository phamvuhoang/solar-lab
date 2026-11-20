import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { asEngineer, tab } from './nav';

test.beforeEach(async ({ page }) => { await asEngineer(page); }); // these use controls shown from Thợ or Kỹ sư up

const pick = async (select: Locator, text: RegExp) => select.selectOption((await select.locator('option', { hasText: text }).first().getAttribute('value')) as string);
const saved = (page: Page) => expect(page.locator('#status')).toContainText('Đã lưu: revision');

async function setupPv(page: Page) {
  await page.goto('/#/');
  await page.getByRole('button', { name: 'Mở mẫu Lâm Hà' }).click();
  await tab(page, 'pv');
  await pick(page.locator('#wx-select'), /PVGIS-ERA5/);
  await saved(page);
  await page.locator('#pv-tilt').fill('10');
  await page.locator('#pv-az').fill('180');
  await page.locator('#pv-save').click();
  await saved(page);
  await tab(page, 'he-thong');
}
const pumpCard = (page: Page) => page.locator('.card[data-load]', { hasText: 'Bơm nước' });

test('W05: dựng A → chạy → đổi giờ bơm về 11h → so A/B → replay tới lần thiếu điện → CSV', async ({ page }) => {
  await setupPv(page);
  await expect(page.locator('#sim-weather')).toContainText('PVGIS');

  // chưa có inverter/chuỗi: từ chối và nói rõ
  await page.locator('#sim-run').click();
  await expect(page.locator('#sim-messages')).toContainText('không chạy được');

  await page.locator('#cfg-shared8').click();
  await saved(page);
  await expect(pumpCard(page)).toBeVisible();
  await page.locator('#s-min').fill('25');
  await page.locator('#s-save').click();
  await saved(page);

  await page.locator('#sim-run').click();
  await expect(page.locator('#sim-result')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('#sim-scope')).toContainText('chỉ đúng cho dữ liệu đã chọn');
  await expect(page.locator('#sim-table')).toContainText('Tỉ lệ đáp ứng');
  await expect(page.locator('#sim-table')).toContainText('ngưỡng đạt');
  await expect(page.locator('#reason-table')).toContainText('PV_TO_LOAD');

  // đổi lịch bơm → kết quả cũ không còn khớp → bị ẩn
  await pumpCard(page).locator('input[id^="lp-hours-"]').fill('11');
  await pumpCard(page).getByRole('button', { name: 'Lưu lịch' }).click();
  await saved(page);
  await expect(page.locator('#sim-stale')).toBeVisible();
  await expect(page.locator('#sim-result')).toHaveCount(0);

  // A = revision trước (bơm 18h), B = hiện tại (bơm 11h)
  await page.locator('#sim-ab').click();
  await expect(page.locator('#sim-table thead')).toContainText('Chênh B − A', { timeout: 30000 }); // the A/B itself, not the automatic run of B
  const discharge = page.locator('#sim-table tbody tr', { hasText: 'Pin: điện năng xả' }).locator('td').last();
  await expect(discharge).toHaveText(/^-\d/); // dời bơm về trưa giảm Wh xả trên dữ liệu này
  await expect(page.locator('#sim-cost')).toContainText('Chênh chi phí B − A');

  // replay
  const before = await page.locator('#replay-time').textContent();
  await page.locator('#jump-short').click();
  await expect(page.locator('#replay-reasons')).toContainText('UNSERVED_LOAD');
  expect(await page.locator('#replay-time').textContent()).not.toBe(before);
  await expect(page.locator('svg[aria-label^="Dòng công suất ngày"]')).toBeVisible();
  await expect(page.locator('svg[aria-label^="SoC pin ngày"]')).toBeVisible();
  await page.getByRole('button', { name: 'Xem A' }).click();
  await expect(page.locator('#replay-time')).toContainText('A · revision');

  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#sim-csv').click()]);
  const csv = await readFile((await dl.path())!, 'utf8');
  expect(csv).toContain('# dispatch: dispatch-1.0.0');
  expect(csv).toMatch(/# input_hash: [0-9a-f]{64}/);
  expect(csv).toContain('reasons');
  expect(csv.split('\r\n').filter((l) => /^\d{4}-\d{2}-\d{2}T/.test(l))).toHaveLength(8760);
});

test('W05: cấu hình B (6+2) bơm DC: thiếu đường cong thì ghi thiếu, nhập đường cong thì tính m³; lịch sai bị chặn', async ({ page }) => {
  await setupPv(page);
  await page.locator('#cfg-split6\\+2').click();
  await saved(page);

  // lịch sai
  await pumpCard(page).locator('input[id^="lp-hours-"]').fill('25');
  await pumpCard(page).getByRole('button', { name: 'Lưu lịch' }).click();
  await expect(page.locator('#sim-messages')).toContainText('phải trong 0–23');
  await pumpCard(page).locator('input[id^="lp-hours-"]').fill('11');
  await pumpCard(page).getByRole('button', { name: 'Lưu lịch' }).click();
  await saved(page);

  await page.locator('#sim-run').click();
  await expect(page.locator('#sim-result')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('#sim-table tbody tr', { hasText: 'Bơm: thể tích' })).toContainText('Thiếu đường cong Q–H của bơm');
  await expect(page.locator('#reason-table')).toContainText('PUMP_BRANCH_CURTAILED');

  await pumpCard(page).locator('input[id^="lp-head-"]').fill('10');
  await pumpCard(page).locator('input[id^="lp-fric-"]').fill('0,2');
  await pumpCard(page).locator('textarea[id^="lp-curve-"]').fill('0: 30\n2: 26\n4: 18\n6: 6');
  await pumpCard(page).getByRole('button', { name: 'Lưu lịch' }).click();
  await saved(page);
  await page.locator('#sim-run').click();
  await expect(page.locator('#sim-table tbody tr', { hasText: 'Bơm: thể tích' })).toContainText(/Bơm nước 750 W \(tải mẫu\): [\d.]+ m³/, { timeout: 30000 });
});

test('W13: kéo thanh phát lại → mũi tên công suất và Mặt Trời trên hình, số có "kW"; rời màn thì tắt', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/#/mau');
  await page.locator('#coach-skip').click();
  await expect(page.locator('#health-pv')).toHaveAttribute('data-state', 'pass', { timeout: 60_000 }); // the automatic run of the sample
  await tab(page, 'he-thong');
  await expect(page.locator('#sim-result')).toBeVisible({ timeout: 30000 });
  const canvas = page.locator('#ws-view canvas');
  await expect(canvas).toBeVisible({ timeout: 20000 });

  await page.locator('#replay-slider').fill('4325'); // 12h giờ địa phương, cuối tháng 6
  await expect.poll(async () => canvas.getAttribute('data-flows')).toMatch(/^\[\{"wireId":"wire:/);
  const flows = JSON.parse((await canvas.getAttribute('data-flows'))!) as { wireId: string; w: number; dir: number }[];
  expect(flows.some((f) => f.w > 0)).toBe(true);
  await expect(page.locator('#view-flows')).toContainText('PV vào inverter');
  await expect(page.locator('#view-flows')).toContainText('kW');
  await expect(page.locator('#view-flows')).toBeInViewport({ ratio: 1 }); // 1280 × 720: under the canvas, no scrolling
  expect(await canvas.getAttribute('data-sun')).toMatch(/^\[/); // cùng con trỏ thời gian đặt Mặt Trời

  await tab(page, 'pv');
  await expect.poll(async () => canvas.getAttribute('data-flows')).toBe('');
  expect(await canvas.getAttribute('data-sun')).toBe('');
  await expect(page.locator('#view-flows')).toBeHidden();
});
