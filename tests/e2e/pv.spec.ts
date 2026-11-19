import { expect, test, type Locator } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const pick = async (select: Locator, text: RegExp) => select.selectOption((await select.locator('option', { hasText: text }).first().getAttribute('value')) as string);

test('W04: chọn dataset → khai hướng → chạy PV trong worker → công suất, nguồn, CSV; đổi thiết lập thì kết quả cũ không còn hiển thị', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Mở mẫu Lâm Hà' }).click();
  await page.locator('#design-btn').click();
  await page.locator('#preset').selectOption('two-trackers');
  await page.locator('#apply-preset').click();
  await expect(page.locator('#status')).toContainText('Đã lưu: revision 2');
  await page.getByRole('button', { name: 'Quay lại dự án' }).click();
  await page.locator('#pv-btn').click();

  await pick(page.locator('#wx-select'), /PVGIS-ERA5/);
  await expect(page.locator('#wx-info')).toContainText('PVGIS (PVGIS-ERA5');
  await expect(page.locator('#wx-info')).toContainText('8760 bước × 60 phút');
  await expect(page.locator('#wx-info')).toContainText('NOT yet confirmed'); // giấy phép chưa xác nhận hiện rõ
  await expect(page.locator('#wx-info')).toContainText('Dịch timestamp');

  // chưa khai hướng: từ chối, nêu trường
  await expect(page.locator('#compile-issues')).toContainText('ORIENTATION_MISSING tại /pv/tiltDeg');
  await page.locator('#pv-run').click();
  await expect(page.locator('#pv-messages')).toContainText('ORIENTATION_MISSING');

  await page.locator('#pv-tilt').fill('10');
  await page.locator('#pv-az').fill('180');
  await page.locator('#pv-save').click();
  await expect(page.locator('#status')).toContainText('Đã lưu: revision');
  await expect(page.locator('#compile-issues')).toHaveCount(0);

  await page.locator('#pv-run').click();
  await expect(page.locator('#pv-result')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('#pv-result')).toContainText('Faiman');
  await expect(page.locator('#pv-result')).toContainText('isotropic');
  await expect(page.locator('#pv-result')).toContainText('Bị cắt bởi tracker');
  await expect(page.locator('#pv-totals')).toContainText('4,96 kWp');
  await expect(page.locator('#pv-totals')).toContainText(/8\.9\d\d,\d kWh/); // khớp pvlib 8.915,6 kWh (mô hình lý tưởng, chưa tổn hao)
  await expect(page.locator('svg[aria-label^="Công suất PV ngày"]')).toBeVisible();
  await expect(page.locator('#pv-day-energy')).toContainText('kWh');
  await expect(page.locator('svg[aria-label="Điện năng theo tháng"]')).toContainText('24-01'); // 7 giờ UTC cuối năm 2023 là 1/1/2024 giờ Việt Nam
  await expect(page.locator('svg[aria-label="Điện năng theo tháng"] text')).toHaveCount(27); // 13 tháng × (giá trị + nhãn) + tiêu đề trục

  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#pv-csv').click()]);
  const csv = await readFile((await dl.path())!, 'utf8');
  expect(csv).toContain('# engine: pv-1.3.0');
  expect(csv).toMatch(/# input_hash: [0-9a-f]{64}/);
  expect(csv).toContain('# model.transposition: isotropic (Liu–Jordan)');
  expect(csv.split('\r\n').filter((l) => /^\d{4}-\d{2}-\d{2}T/.test(l))).toHaveLength(8760);

  // đổi độ nghiêng → mã đầu vào đổi → kết quả cũ không được hiển thị
  await page.locator('#pv-tilt').fill('25');
  await page.locator('#pv-save').click();
  await expect(page.locator('#stale-result')).toBeVisible();
  await expect(page.locator('#pv-result')).toHaveCount(0);
});

test('W04: nhập CSV sai báo đúng dòng và giữ nguyên lựa chọn; nhập CSV đúng thì dùng được', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Mở mẫu Lâm Hà' }).click();
  await page.locator('#pv-btn').click();
  const meta = '# latitude: 11.87\n# longitude: 108.2\n# source: thử\n# method: synthetic\n# timestamp_convention: start\n# step_seconds: 3600\n';
  const head = 'timestamp_utc,ghi_wm2,dni_wm2,dhi_wm2,temp_air_c,wind_ms\n';
  const bad = meta + head + '2023-06-01T00:00:00Z,0,0,0,20,1\n2023-06-01T01:00:00Z,0,0,0,20,1\n2023-06-01T01:00:00Z,0,0,0,20,1\n';
  await page.locator('#wx-file').setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from(bad) });
  await expect(page.locator('#pv-messages')).toContainText('Không nhập được file thời tiết');
  await expect(page.locator('#pv-messages')).toContainText('DUPLICATE_TIMESTAMP tại /rows/');
  expect(await page.locator('#wx-select').inputValue()).toBe('');

  const rows = Array.from({ length: 24 }, (_, h) => `2023-06-01T${String(h).padStart(2, '0')}:00:00Z,${h >= 3 && h <= 10 ? 600 : 0},${h >= 3 && h <= 10 ? 700 : 0},${h >= 3 && h <= 10 ? 80 : 0},25,2`).join('\n');
  await page.locator('#wx-file').setInputFiles({ name: 'ok.csv', mimeType: 'text/csv', buffer: Buffer.from(meta + head + rows + '\n') });
  await expect(page.locator('#wx-info')).toContainText('thử · phương pháp: synthetic');
  await expect(page.locator('#wx-info')).toContainText('24 bước × 60 phút');
  await expect(page.locator('#wx-select option', { hasText: 'đã nhập' })).toHaveCount(1);
});
