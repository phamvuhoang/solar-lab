import { expect, test, type Locator, type Page } from '@playwright/test';
import { tab } from './nav';

const saved = (page: Page) => expect(page.locator('#status')).toContainText('Đã lưu: revision');
const rev = async (page: Page) => Number(((await page.locator('#status').textContent()) ?? '').match(/revision (\d+)/)?.[1] ?? 0);
const canvas = (page: Page) => page.locator('canvas');
const pos = async (page: Page, i: number) => {
  await canvas(page).scrollIntoViewIfNeeded(); // positions are relative to the canvas; the view area can scroll
  const ids = (await canvas(page).getAttribute('data-panel-ids'))!.split(',');
  const p = JSON.parse((await canvas(page).getAttribute('data-panel-pos'))!);
  return { id: ids[i], x: p[ids[i]][0] as number, y: p[ids[i]][1] as number };
};
const cell = (page: Page, id: string, col: number) => page.locator(`#panel-table tr[data-id="${id}"] td`).nth(col);

async function openRoof(page: Page) {
  await page.goto('/#/');
  await page.getByRole('button', { name: 'Mở mẫu Lâm Hà' }).click();
  await tab(page, 'mai');
  await page.locator('#add-demo-roof').click();
  await saved(page);
  await page.locator('#fill-face').click();
  await expect(page.locator('#place-tools')).toContainText('Đã đặt 8/8');
}

test('W06: mái minh họa → điền 8 tấm → 3D cùng 8 ID → chọn/kéo/xoay/hoàn tác; mỗi lần di chuyển là một revision layout', async ({ page }) => {
  await openRoof(page);
  await expect(page.locator('#layout-issues')).toContainText('Mọi vị trí hợp lệ');
  await expect(canvas(page)).toBeVisible({ timeout: 20000 });
  await expect.poll(async () => canvas(page).getAttribute('data-panels')).toBe('8');
  // cùng 8 ID trên 2D (mặt bằng), danh sách và 3D
  const ids3d = (await canvas(page).getAttribute('data-panel-ids'))!.split(',').sort();
  const idsTable = (await page.locator('#panel-table tbody tr').evaluateAll((rs) => rs.map((r) => (r as HTMLElement).dataset.id))).sort();
  await page.locator('#view-mode-plan').click();
  const idsPlan = (await page.locator('svg[id^="plan-"] g.panel').evaluateAll((gs) => gs.map((g) => (g as SVGElement).dataset.id))).sort();
  expect(ids3d).toHaveLength(8);
  expect(idsTable).toEqual(ids3d);
  expect(idsPlan).toEqual(ids3d);

  // chọn bằng click trong 3D → bảng và mặt bằng đồng bộ
  await page.locator('#view-mode-3d').click();
  const p0 = await pos(page, 0);
  await canvas(page).click({ position: { x: p0.x, y: p0.y } });
  await expect.poll(async () => canvas(page).getAttribute('data-selected')).toBe(p0.id);
  await expect(page.locator(`#panel-table tr[data-id="${p0.id}"]`)).toHaveAttribute('aria-selected', 'true');
  await page.locator('#view-mode-plan').click();
  await expect(page.locator(`svg g.panel[data-id="${p0.id}"]`)).toHaveClass(/selected/);
  await expect(page.locator('#sel-info')).toContainText('8 chiếc cùng loại'); // BOM không đổi vì đặt tấm
  await page.locator('#view-mode-3d').click();

  // kéo trong 3D → revision mới, cùng ID, a thay đổi
  const before = await rev(page), a0 = await cell(page, p0.id, 3).textContent();
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.move(box.x + p0.x, box.y + p0.y);
  await page.mouse.down();
  await page.mouse.move(box.x + p0.x + 30, box.y + p0.y, { steps: 5 });
  await page.mouse.move(box.x + p0.x + 60, box.y + p0.y, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => rev(page)).toBeGreaterThan(before);
  expect(await cell(page, p0.id, 3).textContent()).not.toBe(a0);
  await expect.poll(async () => canvas(page).getAttribute('data-panels')).toBe('8');

  // xoay 90° làm tấm đè lên hàng xóm → báo lỗi, hoàn tác về hợp lệ
  await page.locator('#rotate-sel').click();
  await expect(page.locator('#layout-issues')).toContainText(/PANEL_(OVERLAP|OUT_OF_BOUNDS)/);
  await page.locator('#undo').click();
  await page.locator('#undo').click();
  await expect(page.locator('#layout-issues')).toContainText('Mọi vị trí hợp lệ');

  // Đo FPS và ghi lại
  await page.locator('#measure-fps').click();
  await expect(page.locator('#fps-result')).toContainText('FPS (8 tấm', { timeout: 15000 });
  console.log('FPS 8 tấm:', await page.locator('#fps-result').textContent());
});

test('W06: bàn phím trên mặt bằng, dịch bằng nút, bỏ chọn; layout lưu và mở lại sau khi tải lại trang', async ({ page }) => {
  await openRoof(page);
  await page.locator('#view-mode-plan').click();
  const first = page.locator('svg[id^="plan-"] g.panel').first();
  const id = (await first.getAttribute('data-id'))!;
  const a0 = Number(((await cell(page, id, 3).textContent()) ?? '').replace(',', '.'));
  await first.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator(`#panel-table tr[data-id="${id}"]`)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => Number(((await cell(page, id, 3).textContent()) ?? '').replace(',', '.'))).toBeCloseTo(a0 + 0.05, 2);
  await page.locator('#nudge-step').selectOption('10');
  await page.locator('#nudge-up').click();
  await expect.poll(async () => Number(((await cell(page, id, 4).textContent()) ?? '').replace(',', '.'))).toBeGreaterThan(1.5);
  await page.locator('svg[id^="plan-"] g.panel').first().focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('#panel-table tr[aria-selected="true"]')).toHaveCount(0);

  const savedA = await cell(page, id, 3).textContent();
  await page.reload(); // the address keeps the project and tab open
  await tab(page, 'mai');
  await expect(page.locator('#place-tools')).toContainText('Đã đặt 8/8');
  expect(await cell(page, id, 3).textContent()).toBe(savedA);
});

test('W06: chọn đồng bộ giữa sơ đồ điện, mái 3D và BOM; chuỗi lấy hướng từ mặt mái cho PV', async ({ page }) => {
  await openRoof(page);
  await page.locator('#to-design').click();
  await page.locator('#preset').selectOption('two-trackers');
  await page.locator('#apply-preset').click();
  await expect(page.locator('#status')).toContainText('Đã lưu: revision');
  // chọn chuỗi 1 ở sơ đồ → mở mái: 4 tấm của chuỗi được chọn
  await page.locator('#view-mode-diagram').click();
  await page.locator('svg.diagram g.node[data-id^="str-"]').first().click();
  await page.locator('#open-roof').click();
  await expect(page.locator('#panel-table tr[aria-selected="true"]')).toHaveCount(4);
  await expect.poll(async () => (await canvas(page).getAttribute('data-selected'))?.split(',').length).toBe(4);
  await expect(page.locator('#routes-table')).toContainText('ước lượng khái niệm');
  // chọn một tấm ở mái → sơ đồ điện chọn đúng chuỗi của nó
  await page.locator('#clear-sel').click();
  await page.locator('#panel-table tbody tr button').nth(5).click();
  await page.locator('#to-design').click();
  await expect(page.locator('svg.diagram g.node.selected')).toHaveCount(1);
  await expect(page.locator('svg.diagram g.node.selected')).toContainText('Chuỗi 2');
  // BOM: dòng thiết bị của tấm đang chọn được tô sáng
  await page.locator('#open-roof').click();
  await tab(page, 'du-toan');
  await expect(page.locator('#quote-table tr[data-key="design:vsun-620@1"]')).toHaveAttribute('aria-selected', 'true');
});

test('W06: 40 tấm + 10 vật cản: cùng 40 ID, đo FPS; báo vượt biên trên mái lõm và vùng loại trừ', async ({ page }) => {
  await page.goto('/#/');
  await page.getByRole('button', { name: 'Mở mẫu Lâm Hà' }).click();
  await tab(page, 'du-toan');
  await page.locator('[data-device="vsun-620@1"]').getByLabel(/Số lượng/).fill('40');
  await page.locator('[data-device="vsun-620@1"]').getByRole('button', { name: 'Cập nhật SL' }).click();
  await expect(page.locator('#quote-known')).toContainText('95.360.000'); // 40 × 1.984.000 + pin cũ 16.000.000
  await tab(page, 'mai');
  await page.locator('#nr-w').fill('12,5');
  await page.locator('#nr-s').fill('10,5');
  await page.locator('#nr-t').fill('15');
  await page.locator('#add-rect').click();
  await saved(page);
  await page.locator('#fill-face').click();
  await expect(page.locator('#place-tools')).toContainText('Đã đặt 40/40');
  for (let k = 0; k < 10; k++) { const r = await rev(page); await page.locator('#add-tank').click(); await expect.poll(() => rev(page)).toBeGreaterThan(r); }
  await expect(page.locator('#obstacles li')).toHaveCount(10);
  await expect(canvas(page)).toBeVisible({ timeout: 20000 });
  await expect.poll(async () => canvas(page).getAttribute('data-panels')).toBe('40');
  expect((await canvas(page).getAttribute('data-panel-ids'))!.split(',')).toHaveLength(40);
  await page.locator('#view-mode-plan').click();
  await expect(page.locator('svg[id^="plan-"] g.panel')).toHaveCount(40);
  await expect(page.locator('#layout-issues')).toContainText('Mọi vị trí hợp lệ');
  await page.locator('#view-mode-3d').click();
  await page.locator('#measure-fps').click();
  await expect(page.locator('#fps-result')).toContainText('FPS (40 tấm, 10 vật cản)', { timeout: 15000 });
  const fps = Number(((await page.locator('#fps-result').textContent()) ?? '').match(/(\d+) FPS/)?.[1]);
  console.log('FPS 40 tấm + 10 vật cản:', fps);
  expect(fps).toBeGreaterThanOrEqual(30);

  // mái chữ L lõm và vùng loại trừ
  await page.locator('#add-l-roof').click();
  await saved(page);
  await page.locator('#place-face').selectOption({ index: 1 });
  await page.locator('#grid-cols').fill('1');
  await page.locator('#grid-a0').fill('5');
  await page.locator('#grid-b0').fill('3');
  await page.locator('#clear-all').click();
  await page.locator('#place-grid').click();
  await expect(page.locator('#layout-issues')).toContainText('PANEL_OUT_OF_BOUNDS'); // tấm đặt vào vùng khuyết của mái chữ L
});

test('W12: Nhà mẫu với 40 tấm + 10 vật cản + thiết bị: đo FPS', async ({ page }) => {
  await page.goto('/#/mau');
  await tab(page, 'du-toan');
  // tab() can leave a second render of the panel in flight that resets the typed quantity: retry the (idempotent) edit until it lands
  await expect(async () => {
    await page.locator('[data-device="vsun-620@1"]').getByLabel(/Số lượng/).fill('40');
    await page.locator('[data-device="vsun-620@1"]').getByRole('button', { name: 'Cập nhật SL' }).click();
    await expect(page.locator('#quote-known')).toContainText('79.360.000', { timeout: 3000 }); // 40 × 1.984.000; the sample's other prices are missing
  }).toPass({ timeout: 20000 });
  await tab(page, 'mai');
  await page.locator('#nr-w').fill('12,5');
  await page.locator('#nr-s').fill('10,5');
  await page.locator('#nr-t').fill('15');
  await page.locator('#add-rect').click();
  await saved(page);
  await page.locator('#place-face').selectOption({ index: 2 });
  await page.locator('#fill-face').click();
  await expect(page.locator('#place-tools')).toContainText('Đã đặt 40/40');
  for (let k = 0; k < 9; k++) { const r = await rev(page); await page.locator('#add-tank').click(); await expect.poll(() => rev(page)).toBeGreaterThan(r); } // + the sample's own tank
  await expect(page.locator('#obstacles li')).toHaveCount(10);
  await expect(canvas(page)).toBeVisible({ timeout: 20000 });
  await expect.poll(async () => canvas(page).getAttribute('data-panels')).toBe('40');
  expect((await canvas(page).getAttribute('data-devices'))!.split(',')).toHaveLength(4);
  await page.locator('#measure-fps').click();
  await expect(page.locator('#fps-result')).toContainText('FPS (40 tấm, 10 vật cản) · 4 thiết bị', { timeout: 15000 });
  const fps = Number(((await page.locator('#fps-result').textContent()) ?? '').match(/(\d+) FPS/)?.[1]);
  console.log('FPS Nhà mẫu 40 tấm + 10 vật cản + 4 thiết bị:', fps);
  expect(fps).toBeGreaterThanOrEqual(30);
});

test('W06: không có WebGL → mặt bằng 2D và danh sách vẫn sửa được, có thông báo', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...a: unknown[]) { return /webgl/i.test(type) ? null : (orig as (...x: unknown[]) => unknown).call(this, type, ...a); } as typeof orig;
  });
  await openRoof(page);
  await expect(page.locator('#webgl-fallback')).toContainText('vẫn đầy đủ');
  await expect(canvas(page)).toHaveCount(0);
  const first = page.locator('svg[id^="plan-"] g.panel').first();
  await expect(page.locator('svg[id^="plan-"] g.panel')).toHaveCount(8);
  const id = (await first.getAttribute('data-id'))!;
  await first.click();
  await expect(page.locator(`#panel-table tr[data-id="${id}"]`)).toHaveAttribute('aria-selected', 'true');
  const b = await rev(page);
  await page.locator('#nudge-right').click();
  await expect.poll(() => rev(page)).toBeGreaterThan(b);
});

test.describe('W06: cảm ứng và giảm chuyển động', () => {
  test.use({ hasTouch: true });
  test('chạm chọn tấm trong 3D; damping tắt khi người dùng chọn giảm chuyển động', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openRoof(page);
    await expect(canvas(page)).toBeVisible({ timeout: 20000 });
    await expect.poll(async () => canvas(page).getAttribute('data-panels')).toBe('8');
    expect(await canvas(page).getAttribute('data-damping')).toBe('false');
    await canvas(page).scrollIntoViewIfNeeded(); // touchscreen.tap uses viewport coordinates and does not scroll
    const p0 = await pos(page, 2), box = (await canvas(page).boundingBox())!;
    await page.touchscreen.tap(box.x + p0.x, box.y + p0.y);
    await expect.poll(async () => canvas(page).getAttribute('data-selected')).toBe(p0.id);
  });
});

test('W06: xoay camera và dịch tấm trong cùng mặt mái không làm kết quả PV bị stale; hướng PV lấy từ mặt mái', async ({ page }) => {
  await openRoof(page);
  await page.locator('#to-design').click();
  await page.locator('#preset').selectOption('two-trackers');
  await page.locator('#apply-preset').click();
  await expect(page.locator('#status')).toContainText('Đã lưu: revision');
  await tab(page, 'pv');
  await page.locator('#wx-select').selectOption({ index: 1 });
  await saved(page);
  // không khai độ nghiêng/hướng của dự án: mọi chuỗi đã nằm trên mặt mái nên lấy hướng từ mái
  await expect(page.locator('#compile-issues')).toHaveCount(0);
  await page.locator('#pv-run').click();
  await expect(page.locator('#pv-result')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('#pv-result')).toContainText('nghiêng 10°, azimuth 180°');

  await tab(page, 'mai');
  await expect(canvas(page)).toBeVisible({ timeout: 20000 });
  await expect.poll(async () => canvas(page).getAttribute('data-panels')).toBe('8');
  const cam0 = await canvas(page).getAttribute('data-camera');
  const box = (await canvas(page).boundingBox())!;
  await canvas(page).scrollIntoViewIfNeeded();
  const b2 = (await canvas(page).boundingBox())!;
  await page.mouse.move(b2.x + 20, b2.y + 20); // vùng trống: kéo là xoay camera
  await page.mouse.down();
  await page.mouse.move(b2.x + 140, b2.y + 60, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => canvas(page).getAttribute('data-camera')).not.toBe(cam0);
  void box;
  const before = await rev(page);
  await page.locator('#view-mode-plan').click();
  const first = page.locator('svg[id^="plan-"] g.panel').first();
  await first.click();
  await page.locator('#nudge-right').click();
  await expect.poll(() => rev(page)).toBeGreaterThan(before); // đã ghi revision layout mới

  await tab(page, 'pv');
  await expect(page.locator('#pv-result')).toBeVisible(); // kết quả cũ vẫn khớp đầu vào
  await expect(page.locator('#stale-result')).toHaveCount(0);
});
