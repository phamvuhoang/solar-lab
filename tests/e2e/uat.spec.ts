import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { ENGINE_VERSION } from '../../src/engine/pv';
import { DISPATCH_VERSION } from '../../src/engine/dispatch';
import { SHADE_MODEL_VERSION } from '../../src/shade/geometry';
import { readFileSync } from 'node:fs';
import { asEngineer, tab } from './nav';

/**
 * Role journeys written as scripts a person can also follow (docs/uat/). These run the SAME steps by machine, which proves the flow
 * works end to end; it is not the user testing the plan asks for (a homeowner, a tradesperson, a newcomer, an electrical engineer).
 */
const pick = async (select: Locator, text: RegExp) => select.selectOption((await select.locator('option', { hasText: text }).first().getAttribute('value')) as string);
const saved = (page: Page) => expect(page.locator('#status')).toContainText('Đã lưu: revision');
const BAD = /NaN|undefined|Infinity|\[object|(^|[^\p{L}])null([^\p{L}]|$)/u;

/** Lâm Hà, configuration A, reserve 25 %: set up at Kỹ sư (dispatch policy). */
async function toSim(page: Page) {
  await asEngineer(page);
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

// ---- "Đo thành công" (docs/05-experience-v2.md, docs/uat/protocol.md): the machine version of each criterion -------------------
// Each records what a person's attempt is judged on (numbers, action count, elapsed time) as test annotations. It shows the path
// exists and fits the limit; whether a person finds it unaided is the real-user UAT, still to do.
const RUN = { timeout: 60_000 }; // shade preview + a year of dispatch in the worker
/** "1.234,5" → 1234.5 */
const vi = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));
/** Known money and yearly grid purchase as the health bar writes them, once the automatic run is done. */
async function bar(page: Page) {
  const supply = page.locator('#health-supply');
  await expect(supply).toContainText('giờ/năm', RUN);
  const money = (await page.locator('#health-money').textContent())!, grid = (await supply.textContent())!;
  return { money: vi(/([\d.]+) đ đã biết/.exec(money)![1]), grid: vi(/mua lưới ([\d.,]+) kWh/.exec(grid)![1]), moneyText: money, gridText: grid };
}
const note = (info: TestInfo, type: string, v: unknown) => info.annotations.push({ type, description: typeof v === 'string' ? v : JSON.stringify(v) });

test('Đo thành công (a) người mới, Cơ bản, ≤ 5 phút: Nhà mẫu 8 → 10 tấm; đọc tiền đã biết và kWh mua lưới/năm trước và sau', async ({ page }, info) => {
  test.setTimeout(180_000);
  let actions = 0;
  const act = async (l: Locator) => { actions++; await l.click(); };
  const t0 = Date.now();
  await page.goto('/');
  await expect(page).toHaveURL(/#\/mau$/);
  await expect(page.locator('html')).toHaveAttribute('data-depth', 'co-ban');
  for (let i = 0; i < 3; i++) await act(page.locator('#coach-next')); // reads the three first-look notes; the last points at the health bar
  await expect(page.locator('canvas[data-panels="8"]')).toBeVisible({ timeout: 20_000 });
  const before = await bar(page);

  await act(page.locator('#add-panel'));
  await expect(page.locator('#add-panel-n')).toBeHidden(); // Cơ bản: the block adds the 2 it suggests, nothing to type
  await act(page.locator('#add-confirm'));
  await expect(page.locator('canvas[data-panels="10"]')).toBeVisible();
  await expect.poll(async () => (await bar(page)).grid, RUN).not.toBe(before.grid); // the bar follows the edit by itself
  const after = await bar(page);
  const ms = Date.now() - t0;

  expect(after.money).toBeGreaterThan(before.money); // two more panels with a known price
  expect(after.grid).toBeLessThan(before.grid); // more PV, less bought from the grid
  await expect(page.locator('html')).toHaveAttribute('data-depth', 'co-ban'); // never left Cơ bản
  expect(actions).toBe(5);
  expect(ms).toBeLessThan(5 * 60_000);
  // the bar reads right: its money is the estimate's known part (checked by the script, not part of the person's task)
  await page.locator('#step-chi-phi').click();
  await expect(page.locator('#quote-known')).toContainText(after.money.toLocaleString('vi-VN'));
  note(info, 'a-before', { money: before.moneyText, grid: before.gridText });
  note(info, 'a-after', { money: after.moneyText, grid: after.gridText });
  note(info, 'a-actions', actions);
  note(info, 'a-ms', ms);
});

test('Đo thành công (b) thợ, Thợ, ≤ 10 phút: từ số 0 dựng 6 tấm + inverter + pin + 1 tải, "0 lỗi", in báo giá', async ({ page }, info) => {
  test.setTimeout(180_000);
  const rev = async () => Number(/r(\d+)/.exec((await page.locator('#ws-rev').textContent()) ?? '')?.[1] ?? 0);
  /** A block of the Thêm column: open, set its fields, confirm; one revision. */
  const add = async (id: string, set?: () => Promise<void>) => {
    const r = await rev();
    await page.locator(`#${id}`).click();
    await set?.();
    await page.locator('#add-confirm').click();
    await expect.poll(rev).toBeGreaterThan(r);
  };
  const t0 = Date.now();
  await page.goto('/#/');
  await page.locator('#entry-new').click();
  await expect(page).toHaveURL(/#\/moi$/);
  await page.locator('#depth-tho').click();
  await expect(page.locator('#depth-tho')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#add-rect').click(); // a roof face for the panels
  await expect(page.locator('#ws-rev')).toContainText('r1');
  await add('add-panel', () => page.locator('#add-panel-n').fill('6'));
  await add('add-inverter');
  await add('add-battery');
  await add('add-load');
  const electric = page.locator('#health-electric');
  await expect(electric).toContainText('Điện: 0 lỗi');
  await expect(electric).not.toHaveAttribute('data-state', 'fail');
  await page.locator('#step-dau-noi').click();
  await expect(page.locator('#findings-summary')).toContainText('0 lỗi thiết kế');
  await expect(page.locator('#findings .finding.fail')).toHaveCount(0); // no red line anywhere in the list
  // nothing left unwired either: a structural warning reads "chưa đủ dữ liệu" (not red), so it is caught by its code
  const unwired = ['PANEL_UNASSIGNED', 'PANEL_DUPLICATE', 'STRING_EMPTY', 'STRING_UNCONNECTED', 'BATTERY_UNCONNECTED', 'LOAD_UNCONNECTED'];
  await expect(page.locator(unwired.map((c) => `#findings [data-code="${c}"]`).join(', '))).toHaveCount(0);

  await page.evaluate(() => { (window as { printed?: number }).printed = 0; window.print = () => { (window as { printed?: number }).printed! += 1; }; });
  await page.locator('#step-bao-cao').click();
  await page.locator('#rp-print').click();
  expect(await page.evaluate(() => (window as { printed?: number }).printed)).toBe(1);
  const ms = Date.now() - t0;
  // what the print dialog gets: the A4 page with the estimate, every device on a line, a missing price still missing
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('#report')).toBeVisible();
  await expect(page.locator('#rp-compute')).toBeHidden();
  await expect(page.locator('#rp-cost')).toBeVisible();
  const lines = page.locator('#rp-lines tbody tr');
  await expect(lines.filter({ has: page.locator('td:nth-of-type(2)', { hasText: /^6$/ }) })).toHaveCount(1); // SL: the 6 panels on one line
  const pdf = await page.pdf({ preferCSSPageSize: true });
  const box = pdf.toString('latin1').match(/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/)!;
  expect(Math.abs(Number(box[1]) - 595.28)).toBeLessThan(1); // A4
  expect(Math.abs(Number(box[2]) - 841.89)).toBeLessThan(1);
  await page.emulateMedia({ media: 'screen' });
  expect(ms).toBeLessThan(10 * 60_000);
  note(info, 'b-electric', (await electric.textContent()) ?? '');
  note(info, 'b-lines', await lines.allInnerTexts());
  note(info, 'b-ms', ms);
});

// (c) covers computed checks: a structural one (not connected, wrong port type or direction) has no formula or data source by
// nature, its detail names the broken rule and the fix
test('Đo thành công (c) kỹ sư: từ mỗi lỗi tới công thức và nguồn số liệu trong ≤ 2 thao tác', async ({ page }, info) => {
  await asEngineer(page);
  await page.goto('/#/mau');
  await page.locator('#coach-skip').click();
  const detail = page.locator('#finding-detail');
  const formulaAndSource = async (what: string) => {
    await expect(detail.getByText(/^Công thức: /), what).toBeVisible();
    await expect(detail.getByText(/^.+ · \w+ = .+ \([\w-]+\)$/).first(), what).toBeVisible(); // "<device> · <field> = <value> (<provenance>)"
  };
  // from the health bar: one action to the worst check
  await page.locator('#health-electric').click();
  await formulaAndSource('ô Điện');
  // any check in the list, starting from another step: the step, then the check
  await page.locator('#step-dau-noi').click();
  const items = page.locator('#findings button.finding');
  const n = await items.count();
  expect(n).toBeGreaterThan(0);
  const counts: number[] = [];
  for (let i = 0; i < n; i++) {
    await page.locator('#step-bo-tri').click(); // where the person happens to be
    let actions = 0;
    await page.locator('#step-dau-noi').click(); actions++;
    const item = items.nth(i), title = (await item.innerText()).trim();
    await item.click(); actions++;
    await expect(detail.locator('h3'), title).toHaveText(title);
    await formulaAndSource(title);
    counts.push(actions);
  }
  expect(Math.max(...counts)).toBeLessThanOrEqual(2);
  // a check picked in the list does not stick to its object: the Điện cell still opens the worst check (here: the same port)
  const worst = (await items.first().innerText()).trim();
  await items.nth(1).click();
  await expect(detail.locator('h3')).not.toHaveText(worst);
  await page.locator('#health-electric').click();
  await expect(detail.locator('h3')).toHaveText(worst);

  // a red error: Lâm Hà with two strings on one tracker (set up here; the person starts once the error is in view)
  await page.goto('/#/');
  await page.getByRole('button', { name: 'Mở mẫu Lâm Hà' }).click();
  await tab(page, 'thiet-ke');
  await page.locator('#preset').selectOption('two-strings-one-tracker');
  await page.locator('#apply-preset').click();
  await saved(page);
  const red = page.locator('#findings button.finding.fail[data-code="ISC_TRACKER"]');
  await expect(red).toContainText(/^Có lỗi: /);
  const redTitle = (await red.innerText()).trim();
  await expect(page.locator('#health-electric')).toHaveAttribute('data-state', 'fail');
  await page.locator('#step-bo-tri').click();
  await page.locator('#health-electric').click(); // 1 action: the worst check is this error
  await expect(detail.locator('h3')).toHaveText(redTitle);
  await formulaAndSource('ô Điện, lỗi đỏ');
  await page.locator('#step-bo-tri').click();
  await page.locator('#step-dau-noi').click(); // 2 actions from the list
  await red.click();
  await expect(detail.locator('h3')).toHaveText(redTitle);
  await expect(detail).toContainText('Σ_chuỗi min(Isc)');
  await formulaAndSource('danh sách, lỗi đỏ');
  note(info, 'c-checks', n);
  note(info, 'c-actions', { healthCell: 1, list: counts, redError: { code: 'ISC_TRACKER', healthCell: 1, list: 2 } });
});

test('Đo thành công (d) lần đầu mở: thấy Nhà mẫu, 2D ngay, 3D khi Three.js tải xong, không một thao tác', async ({ page }, info) => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  await page.route(/three\.module/, async (route) => { await gate; await route.continue(); }); // Three.js held back: what a slow line shows first
  const t0 = Date.now();
  await page.goto('/');
  await expect(page).toHaveURL(/#\/mau$/);
  await expect(page.locator('#ws-name')).toContainText('Nhà mẫu');
  await expect(page.locator('#ws-badge')).toContainText('Mẫu minh họa');
  await expect(page.locator('#ws-view svg[id^="plan-"] g.panel')).toHaveCount(8); // the 2D plan while 3D is on its way
  await expect(page.locator('#ws-view svg[id^="plan-"]').first()).toBeVisible();
  await expect(page.locator('#view-mode-3d')).toHaveText('3D · đang tải');
  const ms2d = Date.now() - t0;
  release();
  await expect(page.locator('canvas[data-panels="8"]')).toBeVisible({ timeout: 20_000 }); // 3D takes over by itself
  await expect(page.locator('#view-2d')).toBeHidden();
  const ms3d = Date.now() - t0;
  await expect(page.locator('#health-supply')).toContainText('giờ/năm', RUN); // and the numbers, with no click
  note(info, 'd-ms', { plan2d: ms2d, view3dAfterRelease: ms3d });
});

// the homeowner works at the default depth, Cơ bản; only building the electrical system is a thợ's job, done at Thợ
test('UAT chủ nhà: nhập lại một báo giá, thấy tổng đổi và còn thiếu gì, rồi chỉ ra giờ thiếu điện', async ({ page }) => {
  await page.goto('/#/');
  await expect(page.locator('html')).toHaveAttribute('data-depth', 'co-ban');
  await page.getByRole('button', { name: 'Mở mẫu Lâm Hà' }).click();
  await tab(page, 'du-toan');
  await expect(page.locator('#quote-known')).toContainText('31.872.000');
  const battery = page.locator('[data-device="used-battery@1"]');
  await battery.getByRole('button', { name: 'Thêm báo giá' }).click();
  await page.locator('#o-seller').fill('Kho B');
  await page.locator('#o-price').fill('15.500.000');
  await page.locator('#o-vat').selectOption('included');
  await page.getByRole('button', { name: 'Lưu báo giá' }).click();
  await expect(battery.locator('select[aria-label^="Báo giá"] option:checked')).toContainText('15.500.000'); // the card shows the price in use
  await expect(page.locator('#quote-known')).toContainText('31.372.000'); // 15.872.000 + 15.500.000
  await expect(page.locator('#quote-total')).toContainText('chưa đủ để báo'); // vẫn thiếu khung, dây, bảo vệ, công
  await expect(page.locator('#quote-total')).toContainText('Khung, Dây, Thiết bị bảo vệ, Công lắp');

  await tab(page, 'pv');
  await pick(page.locator('#wx-select'), /PVGIS-ERA5/);
  await saved(page);
  await page.locator('#pv-tilt').fill('10');
  await page.locator('#pv-az').fill('180');
  await page.locator('#pv-save').click();
  await saved(page);
  await tab(page, 'he-thong');
  await page.locator('#depth-tho').click(); // the thợ builds configuration A
  await page.locator('#cfg-shared8').click();
  await saved(page);
  await page.locator('#depth-co-ban').click(); // back to the homeowner
  await expect(page.locator('#cfg-shared8')).toBeHidden();
  await page.locator('#sim-run').click();
  await expect(page.locator('#sim-result')).toBeVisible({ timeout: 30000 });
  await page.locator('#jump-short').click();
  await expect(page.locator('#replay-reasons')).toContainText('Tải thiếu điện');
  await expect(page.locator('#replay-time')).toContainText(/\d{1,2}[:h]\d{2}|\d{2}\/\d{2}/); // một thời điểm cụ thể theo giờ Việt Nam
  const when = await page.locator('#replay-time').textContent();
  expect(when).toBeTruthy();
});

test('UAT thợ: tạo một SKU, đọc giải thích lỗi MPPT (công thức, nguồn, hậu quả) rồi sửa', async ({ page }) => {
  await asEngineer(page); // the formula and sources of a finding are shown at Kỹ sư
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
  await expect(detail.locator('h3')).toHaveText(/^Có lỗi: .+ · MPPT 1 — Dòng ngắn mạch vượt giới hạn cổng/); // trạng thái, cổng, hậu quả
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
