import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { ENGINE_VERSION } from '../../src/engine/pv';
import { DISPATCH_VERSION } from '../../src/engine/dispatch';
import { SHADE_MODEL_VERSION } from '../../src/shade/geometry';
import { readFileSync } from 'node:fs';
import { asEngineer, tab } from './nav';

test.beforeEach(async ({ page }) => { await asEngineer(page); }); // these use controls shown from Thợ or Kỹ sư up

/**
 * Role journeys written as scripts a person can also follow (docs/uat/). These run the SAME steps by machine, which proves the flow
 * works end to end; it is not the user testing the plan asks for (a homeowner, a tradesperson, a newcomer, an electrical engineer).
 */
const pick = async (select: Locator, text: RegExp) => select.selectOption((await select.locator('option', { hasText: text }).first().getAttribute('value')) as string);
const saved = (page: Page) => expect(page.locator('#status')).toContainText('Đã lưu: revision');
const BAD = /NaN|undefined|Infinity|\[object|(^|[^\p{L}])null([^\p{L}]|$)/u;

async function toSim(page: Page) {
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
  await page.locator('#cfg-shared8').click();
  await saved(page);
  await page.locator('#s-min').fill('25');
  await page.locator('#s-save').click();
  await saved(page);
}

test('UAT chủ nhà: nhập lại một báo giá, thấy tổng đổi và còn thiếu gì, rồi chỉ ra giờ thiếu điện', async ({ page }) => {
  await page.goto('/#/');
  await page.getByRole('button', { name: 'Mở mẫu Lâm Hà' }).click();
  await tab(page, 'du-toan');
  await expect(page.locator('#quote-known')).toContainText('31.872.000');
  const battery = page.locator('[data-device="used-battery@1"]');
  await battery.getByRole('button', { name: 'Thêm báo giá' }).click();
  await page.locator('#o-seller').fill('Kho B');
  await page.locator('#o-price').fill('15.500.000');
  await page.locator('#o-vat').selectOption('included');
  await page.getByRole('button', { name: 'Lưu báo giá' }).click();
  await expect(page.locator('tr[data-key="design:used-battery@1"]')).toContainText('15.500.000');
  await expect(page.locator('#quote-known')).toContainText('31.372.000'); // 15.872.000 + 15.500.000
  await expect(page.locator('#quote-total')).toContainText('chưa đủ để báo'); // vẫn thiếu khung, dây, bảo vệ, công

  await tab(page, 'pv');
  await pick(page.locator('#wx-select'), /PVGIS-ERA5/);
  await saved(page);
  await page.locator('#pv-tilt').fill('10');
  await page.locator('#pv-az').fill('180');
  await page.locator('#pv-save').click();
  await saved(page);
  await tab(page, 'he-thong');
  await page.locator('#cfg-shared8').click();
  await saved(page);
  await page.locator('#s-min').fill('25');
  await page.locator('#s-save').click();
  await saved(page);
  await page.locator('#sim-run').click();
  await expect(page.locator('#sim-result')).toBeVisible({ timeout: 30000 });
  await page.locator('#jump-short').click();
  await expect(page.locator('#replay-reasons')).toContainText('Tải thiếu điện');
  await expect(page.locator('#replay-time')).toContainText(/\d{1,2}[:h]\d{2}|\d{2}\/\d{2}/); // một thời điểm cụ thể theo giờ Việt Nam
  const when = await page.locator('#replay-time').textContent();
  expect(when).toBeTruthy();
});

test('UAT thợ: tạo một SKU, đọc giải thích lỗi MPPT (công thức, nguồn, hậu quả) rồi sửa', async ({ page }) => {
  await page.goto('/#/');
  await page.getByRole('button', { name: 'Mở mẫu Lâm Hà' }).click();
  await tab(page, 'thiet-bi');
  await page.locator('#new-kind').selectOption('battery');
  await page.getByRole('button', { name: 'Tạo thiết bị từ đầu' }).click();
  await page.locator('#f-name').fill('Pin thợ nhập 100Ah');
  await page.locator('#f-brand').fill('Cơ sở A');
  await page.locator('#s-nominalV').fill('51,2 V');
  await page.locator('#s-capacityAh').fill('100 Ah');
  await page.getByRole('button', { name: 'Lưu thiết bị' }).click();
  await expect(page.locator('#status')).toContainText('Đã lưu Pin thợ nhập 100Ah (revision 1)');
  await expect(page.locator('article.card', { hasText: 'Pin thợ nhập 100Ah' })).toContainText('chưa kiểm datasheet');

  await tab(page, 'thiet-ke');
  await page.locator('#d-cold').fill('5'); await page.locator('#d-hot').fill('70');
  await page.getByRole('button', { name: 'Lưu thiết lập' }).click();
  await saved(page);
  await page.locator('#preset').selectOption('two-strings-one-tracker');
  await page.locator('#apply-preset').click();
  await saved(page);
  await expect(page.locator('#findings-summary')).toContainText('1 lỗi thiết kế');
  await page.locator('button.finding[data-code="ISC_TRACKER"]').click();
  const detail = page.locator('#finding-detail');
  await expect(detail).toContainText('Σ_chuỗi min(Isc)'); // công thức
  await expect(detail).toContainText('Hậu quả');
  await expect(detail).toContainText('manufacturer'); // nguồn của số liệu (hãng sản xuất)
  await pick(page.locator('tr[data-string]').nth(1).locator('select'), /MPPT 2/);
  await expect(page.locator('#findings-summary')).toContainText('0 lỗi thiết kế');
});

test('Kiểm số liệu: không màn hình hay CSV nào có NaN/undefined/null; giá thiếu để trống chứ không thành 0; mọi cột có đơn vị', async ({ page }) => {
  await toSim(page);
  await page.locator('#sim-run').click();
  await expect(page.locator('#sim-result')).toBeVisible({ timeout: 30000 });
  const text = async () => page.locator('#app').innerText();
  const scan = async (where: string) => { const t = await text(); expect(t.match(BAD), `${where}: ${t.match(BAD)?.[0]}`).toBeNull(); };
  await scan('hệ thống');
  const dl = async (sel: string) => { const [d] = await Promise.all([page.waitForEvent('download'), page.locator(sel).click()]); return readFile((await d.path())!, 'utf8'); };
  const simCsv = await dl('#sim-csv');
  expect(simCsv.match(BAD)).toBeNull();
  const header = simCsv.split('\r\n').find((l) => l.startsWith('timestamp_utc'))!.split(',');
  expect(header.filter((c) => !/(_wh|_utc|_date|_hour|soc_end|reasons|residual)/.test(c) && !/^local_/.test(c))).toEqual([]); // cột năng lượng đều ghi Wh trong tên
  await tab(page, 'du-toan');
  await scan('dự toán');
  const q = await dl('#export-csv');
  expect(q.match(BAD)).toBeNull();
  expect(q).toContain('Đơn giá (đ)'); expect(q).toContain('Thành tiền (đ)'); expect(q).toContain('Ngày báo giá'); expect(q).toContain('Nhà bán');
  const cells = (l: string) => l.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  const missing = q.split('\r\n').map(cells).filter((c) => c[8] === 'chưa có giá'); // cột Trạng thái
  expect(missing.length).toBeGreaterThan(0);
  for (const c of missing) expect(c[7], c.join(',')).toBe(''); // Thành tiền để trống, không phải 0
  await tab(page, 'pv');
  await page.locator('#pv-run').click();
  await expect(page.locator('#pv-result')).toBeVisible({ timeout: 30000 });
  await scan('PV');
  const pv = await dl('#pv-csv');
  expect(pv.match(BAD)).toBeNull();
  expect(pv).toMatch(/poa_wm2,tcell_c,apparent_zenith_deg,azimuth_deg,p_ideal_w,p_after_loss_w,p_after_tracker_w,p_after_inverter_w,e_after_inverter_wh/);
  await tab(page, 'bao-cao');
  await page.locator('#rp-compute').click();
  await expect(page.locator('#rp-ab')).toBeVisible({ timeout: 60000 });
  await scan('báo cáo');
  const report = await page.locator('#report').innerText();
  expect(report).toMatch(/kWh/); expect(report).toMatch(/\d+ đ/); expect(report).toContain('CHƯA đối chiếu thực địa');
  expect(report).toContain('Ngày giá:');
});

test('máy yếu (giả lập CPU chậm 6 lần trong Chrome): chạy hệ thống cả năm vẫn xong, ghi thời gian', async ({ page, context }, info) => {
  await toSim(page);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  const t0 = Date.now();
  await page.locator('#sim-run').click();
  await expect(page.locator('#sim-result')).toBeVisible({ timeout: 120000 });
  const ms = Date.now() - t0;
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  expect(ms).toBeLessThan(60000);
  if (process.env.W09_EVIDENCE) { await mkdir(process.env.W09_EVIDENCE, { recursive: true }); await writeFile(`${process.env.W09_EVIDENCE}/throttle.json`, JSON.stringify({ emulation: 'Chrome DevTools Emulation.setCPUThrottlingRate=6 (KHÔNG phải thiết bị Android thật)', flow: 'Lâm Hà cấu hình A, mô phỏng hệ thống 8.760 giờ, từ bấm chạy tới có kết quả', ms, workerCount: 1 }, null, 2) + '\n'); }
  info.annotations.push({ type: 'throttle-6x-ms', description: String(ms) });
});

test('Phiên bản: màn About đọc release-manifest, nói rõ đã/chưa đối chiếu; dùng được cả khi offline', async ({ page, context }) => {
  await page.goto('/#/');
  await expect(page.locator('#offline-status')).toHaveAttribute('data-state', 'ready', { timeout: 30000 });
  await context.setOffline(true);
  await page.reload();
  await page.locator('#about-btn').click();
  const t = page.locator('#about-table');
  await expect(t).toContainText(JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version);
  await expect(t).toContainText(`${ENGINE_VERSION} · ${DISPATCH_VERSION} · ${SHADE_MODEL_VERSION}`);
  await expect(t).toContainText('11/11 thiết bị');
  await expect(t).toContainText('đã đối chiếu mô hình');
  await expect(t).toContainText('chưa đối chiếu thực địa');
});

test('Soát: file dự án bị sửa tay (mã băm lệch) vẫn nhập được nhưng hiện cảnh báo trước khi mở', async ({ page }) => {
  await page.goto('/#/');
  await page.getByRole('button', { name: 'Mở mẫu Lâm Hà' }).click();
  await tab(page, 'du-an');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Xuất JSON' }).click()]);
  const doc = JSON.parse(await readFile((await dl.path())!, 'utf8'));
  doc.project.snapshots.offers[0].priceMinor = '1';
  await page.locator('#ws-home').click();
  await page.locator('#import-file').setInputFiles({ name: 'sua-tay.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) });
  await expect(page.locator('#issues')).toContainText('HASH_MISMATCH');
  await page.locator('#open-imported').click();
  await tab(page, 'du-an');
  await expect(page.locator('#devices')).toBeVisible();
});

test('Soát: dựng lại cấu hình khi đã có thiết kế điện cần bấm lần hai; lịch bơm đã đặt được giữ', async ({ page }) => {
  await toSim(page); // đã dựng cấu hình A
  const card = page.locator('.card[data-load]', { hasText: 'Bơm nước' });
  await expect(card.locator('input[id^="lp-hours-"]')).toHaveValue('18');
  await page.waitForTimeout(500); // màn hình dựng xong, không còn lần lưu nào đang chạy
  const rev = async () => Number(((await page.locator('#status').textContent().catch(() => '')) ?? '').match(/revision (\d+)/)?.[1] ?? 0);
  const r0 = await rev();
  await card.locator('input[id^="lp-hours-"]').fill('6-9');
  await card.getByRole('button', { name: 'Lưu lịch' }).click();
  await expect.poll(rev).toBeGreaterThan(r0);
  await page.waitForTimeout(500); // để mọi lần lưu đang chạy xong
  const before = await rev();
  await page.locator('#cfg-split6\\+2').click();
  await expect(page.locator('#sim-messages')).toContainText('THAY inverter');
  await expect(page.locator('#cfg-split6\\+2')).toContainText('Bấm lần nữa');
  expect(await rev()).toBe(before); // chưa đổi gì
  await page.locator('#cfg-split6\\+2').click();
  await saved(page);
  await expect(page.locator('.card[data-load]', { hasText: 'Bơm nước' }).locator('input[id^="lp-hours-"]')).toHaveValue('6-9');
});
