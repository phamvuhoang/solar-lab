import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { tab } from './nav';

const saved = (page: Page) => expect(page.locator('#status')).toContainText('Đã lưu: revision');
const rev = async (page: Page) => Number(((await page.locator('#status').textContent()) ?? '').match(/revision (\d+)/)?.[1] ?? 0);

/** Lâm Hà: weather chosen, 2 strings (preset), demo gable roof, 8 panels filled on the south face, then the shading screen. */
async function openShade(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Mở mẫu Lâm Hà' }).click();
  await tab(page, 'pv');
  await page.locator('#wx-select').selectOption({ index: 1 });
  await saved(page);
  await tab(page, 'thiet-ke');
  await page.locator('#preset').selectOption('two-trackers');
  await page.locator('#apply-preset').click();
  await saved(page);
  await page.locator('#open-roof').click();
  await page.locator('#add-demo-roof').click();
  await saved(page);
  await page.locator('#fill-face').click();
  await expect(page.locator('#place-tools')).toContainText('Đã đặt 8/8');
  await page.locator('#to-shade').click();
}
const accessNow = (page: Page) => page.locator('#sh-table td[data-cell="now"]').evaluateAll((tds) => tds.map((t) => (t as HTMLElement).dataset.access));

test('W07: bồn nước sát mái → tính ngày → trượt giờ → chọn tấm bị che → inspector khớp CSV; hai cảnh A/B cả năm', async ({ page }) => {
  await openShade(page);
  await expect(page.locator('#sh-obstacles')).toHaveCount(0);
  await page.locator('#tank-near').click();
  await saved(page);
  await expect(page.locator('#sh-obstacles')).toContainText('Bồn nước');

  // chưa tính: ô "giờ này" trống, không bịa số
  await expect(page.locator('#sh-day-status')).toContainText('chưa tính');
  expect((await accessNow(page)).every((v) => v === '')).toBe(true);
  await page.locator('#sh-compute-day').click();
  await expect(page.locator('#sh-day-status')).toContainText('đã tính', { timeout: 20000 });

  // tìm giờ có tấm bị che bằng thanh trượt
  const max = Number(await page.locator('#sh-slider').getAttribute('max'));
  let found = -1;
  for (let k = 0; k <= max && found < 0; k++) {
    await page.locator('#sh-slider').fill(String(k));
    if ((await accessNow(page)).some((v) => v !== '' && Number(v) < 1)) found = k;
  }
  expect(found).toBeGreaterThanOrEqual(0); // bồn nước che ít nhất một tấm vào một giờ nào đó trong ngày gần đông chí
  const vals = (await accessNow(page)).map(Number);
  const shaded = vals.findIndex((v) => v < 1);
  const row = page.locator('#sh-table tbody tr').nth(shaded);
  const id = (await row.getAttribute('data-id'))!;
  await expect(page.locator('canvas')).toBeVisible({ timeout: 20000 });
  await expect.poll(async () => page.locator('canvas').getAttribute('data-heat')).toContain(id);
  expect(await page.locator('canvas').getAttribute('data-sun')).toMatch(/^\[/); // có Mặt Trời trong cảnh

  await row.getByRole('button').click();
  await expect(page.locator('#sh-inspector')).toContainText('Thấy nắng trực tiếp tại giờ đang xem');
  await expect.poll(async () => page.locator('canvas').getAttribute('data-selected')).toBe(id);
  const inspector = await page.locator('#sh-insp-now').getAttribute('data-access');
  expect(Number(inspector)).toBeLessThan(1);
  await expect(page.locator('#sh-inspector')).toContainText('PV giảm trong ngày'); // ngày đã tính nên có số, không phải lời nhắc

  // CSV ngày: giá trị của đúng tấm, đúng giờ, bằng inspector
  const when = (await page.locator('#sh-time').textContent())!.match(/(\d{4}-\d{2}-\d{2}) (\d{2})h/)!;
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#sh-csv-day').click()]);
  const csv = await readFile((await dl.path())!, 'utf8');
  expect(csv).toContain('# model: shade-raycast-1.0.0');
  expect(csv).toContain('# samples_per_panel: 16 (4x4 cell-centred grid)');
  expect(csv).toMatch(/# obstacle: Bồn nước cylinder centre\(e,n,up\)=/);
  const line = csv.split('\r\n').find((l) => l.split(',')[1] === when[1] && Number(l.split(',')[2]) === Number(when[2]) && l.split(',')[3] === id)!;
  expect(line.split(',')[6]).toBe(inspector);

  // dời bồn nước → khóa cache đổi → ngày phải tính lại (miss), không dùng nhầm bóng cũ
  const r0 = await rev(page);
  await page.locator('button[id^="ob-south-"]').click();
  await expect.poll(() => rev(page)).toBeGreaterThan(r0);
  await expect(page.locator('#sh-day-status')).toContainText('chưa tính');
  await page.locator('button[id^="ob-north-"]').click(); // trả lại chỗ cũ: hình học giống hệt → cache hit
  await expect(page.locator('#sh-day-status')).toContainText('đã tính');
  await expect.poll(() => rev(page)).toBeGreaterThan(r0 + 1);
});

test('W07: so sánh hai cảnh cả năm A (không vật cản) và B (bồn nước sát mái): B ít điện hơn, báo hai cận và giới hạn; kết quả cũ bị ẩn khi dời bồn', async ({ page }) => {
  await openShade(page);
  await page.locator('#tank-near').click();
  await saved(page);
  await page.locator('#sh-ab').click();
  await expect(page.locator('#sh-results')).toBeVisible({ timeout: 40000 });
  await expect(page.locator('#sh-scope')).toContainText('Chỉ đúng cho dữ liệu thời tiết');
  await expect(page.locator('#sh-results thead')).toContainText('Chênh B − A');
  const delta = page.locator('#sh-results tbody tr', { hasText: 'PV có bóng: cận trên' }).locator('td').last();
  await expect(delta).toHaveText(/^-\d/); // B ít hơn A
  const free = page.locator('#sh-results tbody tr', { hasText: 'PV không bóng' }).locator('td').last();
  await expect(free).toHaveText(/^0 kWh$/); // cùng thời tiết, cùng tấm: chưa có bóng thì không chênh
  await expect(page.locator('#sh-results tbody tr', { hasText: 'Tổn thất do bóng' })).toContainText('0–0 kWh'); // cảnh A không vật cản
  await expect(page.locator('#sh-results')).toContainText('shade-raycast-1.0.0');
  await expect(page.locator('#sh-results')).toContainText('16 mẫu mỗi tấm');
  await expect(page.locator('#sh-bypass')).toContainText('3 diode bypass');
  await expect(page.locator('#sh-bypass')).toContainText('cận dưới giả định không có bypass');

  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#sh-csv-year').click()]);
  const csv = await readFile((await dl.path())!, 'utf8');
  expect(csv).toContain('panel_id,panel_label,string,direct_access_weighted,e_ideal_free_wh,e_ideal_shaded_wh,loss_wh,loss_pct');
  expect(csv.split('\r\n').filter((l) => /^ins-/.test(l))).toHaveLength(8);

  // dời bồn nước: kết quả cả năm cũ không còn khớp nên bị ẩn
  await page.locator('button[id^="ob-south-"]').click();
  await expect(page.locator('#sh-stale')).toBeVisible();
  await expect(page.locator('#sh-results')).toHaveCount(0);
});

test('W07: bật bóng che mà chưa tính thì PV từ chối; tính xong thì PV chạy với bóng, ghi rõ giới hạn', async ({ page }) => {
  await openShade(page);
  await page.locator('#tank-near').click();
  await saved(page);
  await page.locator('#sh-enabled').check();
  await page.locator('#sh-save').click();
  await saved(page);
  await page.locator('button', { hasText: 'Thời tiết và PV' }).click();
  await expect(page.locator('#compile-issues')).toContainText('SHADE_NOT_COMPUTED');
  await page.locator('#pv-run').click();
  await expect(page.locator('#pv-messages')).toContainText('SHADE_NOT_COMPUTED');
  await expect(page.locator('#pv-result')).toHaveCount(0);

  await tab(page, 'bong');
  await page.locator('#sh-year').click();
  await expect(page.locator('#sh-results')).toBeVisible({ timeout: 40000 });
  await page.locator('button', { hasText: 'Thời tiết và PV' }).click();
  await expect(page.locator('#compile-issues')).toHaveCount(0);
  await page.locator('#pv-run').click();
  await expect(page.locator('#pv-result')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('#pv-shade-note')).toContainText('Có bóng che: shade-raycast-1.0.0');
  await expect(page.locator('#pv-shade-note')).toContainText('lưới 4×4');
  await expect(page.locator('#pv-shade-note')).toContainText('cộng công suất tấm (cận trên)');
});

test('W07: phát chuyển động Mặt Trời đổi giờ; bật giảm chuyển động thì không tự phát; không có WebGL vẫn xem được bảng', async ({ page }) => {
  await openShade(page);
  await page.locator('#tank-near').click();
  await saved(page);
  await page.locator('#sh-compute-day').click();
  await expect(page.locator('#sh-day-status')).toContainText('đã tính', { timeout: 20000 });
  const t0 = await page.locator('#sh-time').textContent();
  await page.locator('#sh-play').click();
  await expect.poll(async () => page.locator('#sh-time').textContent(), { timeout: 5000 }).not.toBe(t0);
  await page.locator('#sh-play').click(); // dừng
  const stopped = await page.locator('#sh-time').textContent();
  await page.waitForTimeout(900);
  expect(await page.locator('#sh-time').textContent()).toBe(stopped);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload(); // the address keeps the project and tab open
  await tab(page, 'bong');
  await expect(page.locator('#sh-play')).toBeDisabled();
});

test('W07: không có WebGL: bảng phần trăm thấy nắng và CSV vẫn dùng được', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...a: unknown[]) { return /webgl/i.test(type) ? null : (orig as (...x: unknown[]) => unknown).call(this, type, ...a); } as typeof orig;
  });
  await openShade(page);
  await page.locator('#tank-near').click();
  await saved(page);
  await expect(page.locator('#sh-fallback')).toContainText('vẫn đầy đủ');
  await page.locator('#sh-compute-day').click();
  await expect(page.locator('#sh-day-status')).toContainText('đã tính', { timeout: 20000 });
  expect((await accessNow(page)).some((v) => v !== '')).toBe(true);
  await expect(page.locator('#sh-csv-day')).toBeEnabled();
});
