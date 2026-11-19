import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ENGINE_VERSION } from '../../src/engine/pv';

const pick = async (select: Locator, text: RegExp) => select.selectOption((await select.locator('option', { hasText: text }).first().getAttribute('value')) as string);
const saved = (page: Page) => expect(page.locator('#status')).toContainText('Đã lưu: revision');
/** Revision gần nhất trước bản hiện tại (cuối danh sách A). */
const pickLastA = async (page: Page) => { await expect(page.locator('#rp-a')).toBeVisible(); await expect(page.locator('#rp-a option')).not.toHaveCount(1); const n = await page.locator('#rp-a option').count(); await page.locator('#rp-a').selectOption({ index: n - 1 }); };
const pumpCard = (page: Page) => page.locator('.card[data-load]', { hasText: 'Bơm nước' });

/** Lâm Hà, thời tiết đóng gói, cấu hình A (8 tấm vào inverter), hai revision: bơm 18h rồi bơm 11h. Dừng ở màn dự án. */
async function setup(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Mở mẫu Lâm Hà' }).click();
  await page.locator('#pv-btn').click();
  await pick(page.locator('#wx-select'), /PVGIS-ERA5/);
  await saved(page);
  await page.locator('#pv-tilt').fill('10');
  await page.locator('#pv-az').fill('180');
  await page.locator('#pv-save').click();
  await saved(page);
  await page.getByRole('button', { name: 'Quay lại dự án' }).click();
  await page.locator('#sim-btn').click();
  await page.locator('#cfg-shared8').click();
  await saved(page);
  await pumpCard(page).locator('input[id^="lp-hours-"]').fill('11');
  await pumpCard(page).getByRole('button', { name: 'Lưu lịch' }).click();
  await saved(page);
  await page.getByRole('button', { name: 'Quay lại dự án' }).click();
}
const download = async (page: Page, button: string) => { const [dl] = await Promise.all([page.waitForEvent('download'), page.locator(button).click()]); return readFile((await dl.path())!, 'utf8'); };

test('W08: báo cáo A4 có giả định, cấp độ kiểm tra, ngày giá, biểu đồ, nguồn thời tiết, A/B; in ra PDF A4; CSV BOM; bỏ liên hệ khi chia sẻ', async ({ page }) => {
  await setup(page);
  await page.locator('#report-btn').click();
  await page.locator('#rp-o-name').fill('Anh Hùng');
  // ô liên hệ không nhận dài hơn schema cho phép (nếu nhận, dự án lưu được nhưng file "Xuất tất cả" không nhập lại được)
  await page.locator('#rp-o-phone').pressSequentially('0909 123 456 (anh Hùng) / 0912 345 678 (chị Lan)');
  expect((await page.locator('#rp-o-phone').inputValue()).length).toBe(40);
  await page.locator('#rp-o-phone').fill('0909 123 456');
  await page.locator('#rp-o-save').click();
  await saved(page);
  await expect(page.locator('#rp-owner')).toContainText('đã bỏ'); // mặc định bỏ liên hệ

  await pickLastA(page);
  await page.locator('#rp-compute').click();
  await expect(page.locator('#rp-ab')).toBeVisible({ timeout: 60000 });
  await expect(page.locator('#rp-messages')).toContainText('Đã tính xong');

  // nội dung bắt buộc của báo cáo
  await expect(page.locator('#rp-scope')).toContainText('chỉ đúng cho dữ liệu thời tiết');
  await expect(page.locator('#rp-price-date')).toContainText('Ngày giá:');
  await expect(page.locator('#rp-cost')).toContainText('Tổng hoàn chỉnh');
  await expect(page.locator('#rp-cost')).toContainText('chưa đủ để báo tổng'); // thiếu inverter/khung/dây/công vẫn là thiếu
  await expect(page.locator('#rp-lines')).toContainText('CHƯA CÓ GIÁ');
  await expect(page.locator('#rp-levels')).toContainText('Thi công và an toàn');
  await expect(page.locator('#rp-levels')).toContainText('ngoài phạm vi công cụ');
  await expect(page.locator('#rp-levels')).toContainText(ENGINE_VERSION);
  await expect(page.locator('#rp-assumptions')).toContainText('SoC đầu');
  await expect(page.locator('#rp-weather')).toContainText('PVGIS');
  await expect(page.locator('#rp-weather')).toContainText('Giấy phép');
  await expect(page.locator('#rp-chart-month svg')).toBeVisible();
  await expect(page.locator('#rp-month-table tbody tr')).toHaveCount(13); // 12 tháng + vài giờ đầu 01/2024 theo giờ Việt Nam (dữ liệu UTC bắt đầu 00h 01/01/2023)
  await expect(page.locator('#rp-chart-day svg')).toBeVisible();
  await expect(page.locator('#rp-chart-soc svg')).toBeVisible();
  await expect(page.locator('#rp-ab thead')).toContainText(/A · revision \d+/);
  await expect(page.locator('#rp-ab thead')).toContainText('B · hiện tại');
  await expect(page.locator('#rp-ab-scope')).toContainText('Chỉ kết luận cho dữ liệu đã chọn');
  await expect(page.locator('#rp-cost-delta')).toContainText('Chênh chi phí B − A');
  await expect(page.locator('#rp-attached')).toContainText('Thông tin liên hệ');
  await expect(page.locator('#report')).not.toContainText('0909 123 456');

  // in: chỉ còn trang báo cáo, khổ A4
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('#report')).toBeVisible();
  await expect(page.locator('#rp-compute')).toBeHidden();
  await expect(page.locator('h1')).toBeHidden();
  const pdf = await page.pdf({ preferCSSPageSize: true });
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  const box = pdf.toString('latin1').match(/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/);
  expect(box).not.toBeNull();
  expect(Math.abs(Number(box![1]) - 595.28)).toBeLessThan(1); // A4 = 210 × 297 mm = 595,28 × 841,89 pt
  expect(Math.abs(Number(box![2]) - 841.89)).toBeLessThan(1);
  await page.emulateMedia({ media: 'screen' });

  // CSV BOM: giá thiếu vẫn thiếu
  const bom = await download(page, '#rp-csv-bom');
  expect(bom).toContain('Tổng hoàn chỉnh');
  expect(bom).toContain('chưa có giá');
  expect(bom).toContain('Chưa đủ để báo tổng');
  const pvCsv = await download(page, '#rp-csv-pv');
  expect(pvCsv).toContain(`# engine: ${ENGINE_VERSION}`);
  expect(pvCsv.split('\r\n').filter((l) => /^\d{4}-\d{2}-\d{2}T/.test(l))).toHaveLength(8760);

  // gói đầy đủ, bỏ liên hệ
  const full = JSON.parse(await download(page, '#rp-pack-full'));
  expect(full.attached).toMatchObject({ weatherData: true, recordedMetrics: true, recordedSeries: true, variants: true, contact: false });
  expect(full.project.owner).toBeUndefined();
  expect(JSON.stringify(full)).not.toContain('0909 123 456');
  expect(full.runs.map((r: { label: string; kind: string }) => `${r.label}:${r.kind}`).sort()).toEqual(['A:sim', 'B:pv', 'B:sim']);
  expect(full.weather.data.n).toBe(8760);
  const light = JSON.parse(await download(page, '#rp-pack-report'));
  expect(light.attached).toMatchObject({ weatherData: false, recordedSeries: false, recordedMetrics: true });
  expect(light.weather.ref.bundled).toBe(true);

  // bật liên hệ: báo cáo và gói mang liên hệ
  await page.locator('#rp-contact').check();
  await expect(page.locator('#rp-owner')).toContainText('0909 123 456');
  expect(JSON.parse(await download(page, '#rp-pack-report')).project.owner.phone).toBe('0909 123 456');

  // đổi thiết kế → kết quả cũ bị bỏ khỏi báo cáo
  await page.locator('#rp-o-name').fill('Chị Lan');
  await page.locator('#rp-o-save').click();
  await saved(page);
  await expect(page.locator('#rp-ab')).toHaveCount(0);
  await expect(page.locator('#rp-messages')).toContainText('kết quả cũ đã bị bỏ');
});

async function exportFull(page: Page, dir: string, name = 'goi.json') {
  await setup(page);
  await page.locator('#report-btn').click();
  await pickLastA(page);
  await page.locator('#rp-compute').click();
  await expect(page.locator('#rp-ab')).toBeVisible({ timeout: 60000 });
  const text = await download(page, '#rp-pack-full');
  await mkdir(dir, { recursive: true });
  const file = join(dir, name);
  await writeFile(file, text);
  return { file, text };
}
async function machineB(browser: Browser, baseURL: string | undefined) {
  const ctx = await browser.newContext({ baseURL });
  const page = await ctx.newPage();
  await page.goto('/');
  await expect(page.locator('#offline-status')).toHaveAttribute('data-state', 'ready', { timeout: 30000 }); // đã tải đủ file để dùng ngoại tuyến
  return { ctx, page };
}

test('W08 máy B: cache rỗng → thiết lập app → ngoại tuyến → nhập gói → tái lập mã đầu vào và chỉ số; giá thiếu vẫn thiếu', async ({ page, browser, baseURL }, info) => {
  const { file, text } = await exportFull(page, info.outputDir);
  const doc = JSON.parse(text);
  const { ctx, page: b } = await machineB(browser, baseURL);
  const keys = await b.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith('mekoniq-shell-')));
  expect(keys).toHaveLength(1);
  expect(await b.evaluate(async (k) => (await (await caches.open(k)).keys()).length, keys[0])).toBeGreaterThanOrEqual(5);
  await ctx.setOffline(true);
  await b.reload(); // trang mở được khi không có mạng
  await expect(b.getByRole('button', { name: 'Mở mẫu Lâm Hà' })).toBeVisible();
  await b.locator('#import-file').setInputFiles(file);
  await expect(b.locator('#im-meta')).toContainText('đầy đủ');
  await expect(b.locator('#im-table tbody tr')).toHaveCount(3);
  await expect(b.locator('.rec-hash').first()).toBeVisible();
  for (const s of await b.locator('.rep-status').all()) await expect(s).toHaveAttribute('data-status', 'none'); // chưa chạy lại: chỉ có số đã ghi
  await b.locator('#im-replay').click();
  await expect(b.locator('.rep-status[data-status="reproduced"]')).toHaveCount(3, { timeout: 90000 });
  const recorded = await b.locator('.rec-hash').allTextContents(), again = await b.locator('.rep-hash').allTextContents();
  expect(again).toEqual(recorded); // cùng mã đầu vào với bản đã ghi
  expect(recorded[0]).toBe(doc.runs[0].inputHash.slice(0, 12));
  // chỉ số trùng từng cặp: đã ghi (cột 4–7) và chạy lại (cột 10–13) giống hệt nhau
  const cells = (n: number) => b.locator(`#im-table tbody tr td:nth-child(${n})`).allTextContents();
  for (const [rec, now] of [[4, 10], [5, 11], [6, 12], [7, 13]] as const) expect(await cells(now)).toEqual(await cells(rec));
  expect((await cells(4)).some((x) => /kWh/.test(x))).toBe(true);
  await b.locator('#im-open').click();
  await expect(b.locator('#bom-total')).toContainText('tổng hoàn chỉnh: chưa đủ'); // giá thiếu vẫn thiếu sau khi nhập
  await ctx.close();
});

test('W08: gói hỏng chỉ rõ vị trí và giữ nháp cũ; engine khác phiên bản tách "đã ghi" khỏi "chạy lại"; hết dung lượng không làm mất nháp', async ({ page, browser, baseURL }, info) => {
  const { text } = await exportFull(page, info.outputDir);
  const ctx = await browser.newContext({ baseURL });
  const b = await ctx.newPage();
  await b.goto('/');
  await b.getByRole('button', { name: 'Mở mẫu Lâm Hà' }).click();
  await b.getByRole('button', { name: 'Quay lại' }).first().click();
  await expect(b.locator('#saved li')).toHaveCount(1);

  // 1. dữ liệu thời tiết bị sửa: báo đúng trường, nháp cũ còn nguyên
  const bad = JSON.parse(text); bad.weather.data.ghi[5] = 'x';
  const badFile = join(info.outputDir, 'hong.json'); await writeFile(badFile, JSON.stringify(bad));
  await b.locator('#import-file').setInputFiles(badFile);
  await expect(b.locator('#issues')).toContainText('/weather/data/ghi/5');
  await expect(b.locator('#status')).toContainText('dự án hiện có không bị thay đổi');
  await b.getByRole('button', { name: 'Quay lại' }).click();
  await expect(b.locator('#saved li')).toHaveCount(1);

  // 2. phiên bản định dạng mới hơn
  const newer = JSON.parse(text); newer.formatVersion = 9;
  const newerFile = join(info.outputDir, 'moi.json'); await writeFile(newerFile, JSON.stringify(newer));
  await b.locator('#import-file').setInputFiles(newerFile);
  await expect(b.locator('#issues')).toContainText('NEWER_FORMAT');
  await b.getByRole('button', { name: 'Quay lại' }).click();

  // 3. engine ghi bằng phiên bản cũ: số đã ghi giữ nguyên, chạy lại là kết quả MỚI
  const old = JSON.parse(text); old.runs = old.runs.filter((r: { kind: string }) => r.kind === 'pv'); old.runs[0].engines.pv = 'pv-1.0.0';
  const oldFile = join(info.outputDir, 'cu.json'); await writeFile(oldFile, JSON.stringify(old));
  await b.locator('#import-file').setInputFiles(oldFile);
  await expect(b.locator('#im-table tbody tr')).toHaveCount(1);
  const recordedPv = await b.locator('#im-table tbody tr td:nth-child(4)').textContent();
  await b.locator('#im-replay').click();
  await expect(b.locator('.rep-status[data-status="engine-changed"]')).toContainText('kết quả MỚI', { timeout: 60000 });
  await expect(b.locator('#im-reasons')).toContainText('pv-1.0.0');
  expect(await b.locator('#im-table tbody tr td:nth-child(4)').textContent()).toBe(recordedPv); // phần đã ghi không bị ghi đè
  await b.getByRole('button', { name: 'Về danh sách' }).click();

  // 3b. gói báo cáo không kèm thời tiết tự tải được: editor và BOM vẫn dùng, PV nói rõ thiếu gì
  const lite = JSON.parse(text); lite.kind = 'report'; delete lite.weather.data; lite.weather.ref.bundled = false; lite.weather.ref.id = 'wx-khong-co'; lite.project.pv.weatherId = 'wx-khong-co';
  lite.runs = []; const liteFile = join(info.outputDir, 'nhe.json'); await writeFile(liteFile, JSON.stringify(lite));
  await b.locator('#import-file').setInputFiles(liteFile);
  await expect(b.locator('#issues')).toContainText('WEATHER_NOT_ATTACHED');
  await expect(b.locator('#im-weather')).toContainText('CHƯA có trong máy này');
  await b.locator('#im-open').click();
  await expect(b.locator('#bom-total')).toBeVisible();
  await b.locator('#design-btn').click();
  await expect(b.getByRole('heading', { name: /Thiết kế|Sơ đồ/ }).first()).toBeVisible();
  await b.getByRole('button', { name: 'Quay lại dự án' }).click();
  await b.locator('#pv-btn').click();
  await expect(b.getByRole('heading', { name: /Mô phỏng PV/ })).toBeVisible();
  await b.getByRole('button', { name: 'Quay lại dự án' }).click();
  await b.getByRole('button', { name: 'Quay lại' }).click();
  await expect(b.locator('#saved li')).toHaveCount(3);

  // 4. hết dung lượng: giả lập tại lớp lưu trữ, dự án đang có không bị đụng
  await b.evaluate(() => {
    const orig = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, v: unknown, k?: IDBValidKey) { if (this.name === 'projects') throw new DOMException('quota', 'QuotaExceededError'); return orig.call(this, v, k); };
  });
  await expect(b.locator('#saved li')).toHaveCount(3);
  const before = 3; // nháp Lâm Hà + gói cũ + gói nhẹ
  const quotaFile = join(info.outputDir, 'day.json'); await writeFile(quotaFile, text);
  await b.locator('#import-file').setInputFiles(quotaFile);
  await expect(b.locator('#issues')).toContainText('STORAGE_FULL');
  await b.getByRole('button', { name: 'Quay lại' }).click();
  await expect(b.locator('#saved li')).toHaveCount(before);
  await ctx.close();
});
