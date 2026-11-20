import { expect, test, type Page } from '@playwright/test';
import { STEPS } from '../../src/ui/route';
import { tab } from './nav';

const openLamHa = async (page: Page) => {
  await page.goto('/#/');
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
  await page.goto('/#/');
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

test('nền tối: chữ trong hộp của sơ đồ điện vẫn đọc được', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openLamHa(page);
  await tab(page, 'thiet-ke');
  await page.locator('#view-mode-diagram').click();
  const node = page.locator('svg.diagram g.node').first();
  await expect(node).toBeVisible();
  const ratio = await node.evaluate((g) => {
    const lum = (c: string) => { const [r, gr, b] = c.match(/[\d.]+/g)!.slice(0, 3).map((v) => { const x = Number(v) / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * gr + 0.0722 * b; };
    const [a, b] = [lum(getComputedStyle(g.querySelector('rect')!).fill), lum(getComputedStyle(g.querySelector('text')!).fill)];
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
  expect(ratio).toBeGreaterThanOrEqual(4.5); // WCAG AA cho chữ thường
});

test('khung nhìn giữ nguyên canvas khi đổi bước', async ({ page }) => {
  await openLamHa(page);
  await page.locator('#add-demo-roof').click();
  await expect(page.locator('#status')).toContainText('Đã lưu: revision');
  await page.locator('#fill-face').click();
  const view = page.locator('canvas[data-panels="8"]');
  await expect(view).toBeVisible({ timeout: 20000 });
  await view.evaluate((c) => { (c as HTMLElement).dataset.mark = 'x'; });
  await tab(page, 'du-toan');
  await tab(page, 'bong');
  await expect(page.locator('canvas[data-mark="x"]')).toBeVisible();
  await expect(page.locator('canvas')).toHaveCount(1);
});

test('đóng dự án khi đang lưu: bản lưu xong muộn không dựng lại 3D', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext, w = window as unknown as { gl: number };
    w.gl = 0;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...a: unknown[]) { if (/webgl/i.test(type)) w.gl++; return (orig as (...x: unknown[]) => unknown).call(this, type, ...a); } as typeof orig;
  });
  const contexts = () => page.evaluate(() => (window as unknown as { gl: number }).gl);
  await openLamHa(page);
  await expect(page.locator('canvas')).toHaveCount(1, { timeout: 20000 });
  const before = await contexts();
  await page.evaluate(() => { document.getElementById('add-demo-roof')!.click(); location.hash = '#/'; }); // the save ends after the project is closed
  await expect(page.getByRole('button', { name: 'Mở mẫu Lâm Hà' })).toBeVisible();
  await page.waitForTimeout(1000); // let the save finish
  expect(await contexts()).toBe(before);
});

test('bấm chỗ trống trên 3D không xóa số đang gõ ở tab PV', async ({ page }) => {
  await openLamHa(page);
  await tab(page, 'pv');
  const view = page.locator('canvas');
  await expect(view).toBeVisible({ timeout: 20000 });
  await page.locator('#pv-albedo').fill('0,31');
  await view.click({ position: { x: 10, y: 10 } }); // empty ground: the 3D clears the selection
  await page.waitForTimeout(500); // a repaint would have replaced the form by now
  await expect(page.locator('#pv-albedo')).toHaveValue('0,31');
});

test('Nhà mẫu trong 3D có 4 thiết bị, chú giải bằng chữ, công tơ ghi minh họa', async ({ page }) => {
  await page.goto('/#/mau');
  const view = page.locator('canvas[data-devices]');
  await expect(view).toBeVisible({ timeout: 20000 });
  await expect(page.locator('#view-mode-3d')).toHaveAttribute('aria-pressed', 'true');
  const ids = (await view.getAttribute('data-devices'))!.split(',');
  expect(ids).toHaveLength(4);
  await expect(page.locator('#view-legend')).toContainText('AC');
  await expect(page.locator('#view-legend')).toContainText('minh họa');
  await expect(view).toHaveAttribute('data-props', /Công tơ \(minh họa\)/);
  // a device is picked like a panel: the inverter, first on the device wall
  await view.scrollIntoViewIfNeeded();
  const [x, y] = JSON.parse((await view.getAttribute('data-device-pos'))!)[ids[0]] as [number, number];
  await view.click({ position: { x, y } });
  await expect.poll(() => view.getAttribute('data-selected')).toBe(ids[0]);
});

test('WebGL tắt: khung nhìn là Mặt bằng, chọn tấm vẫn được', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...a: unknown[]) { return /webgl/i.test(type) ? null : (orig as (...x: unknown[]) => unknown).call(this, type, ...a); } as typeof orig;
  });
  await page.goto('/#/mau');
  await expect(page.locator('#webgl-fallback')).toContainText('vẫn đầy đủ');
  await expect(page.locator('#view-mode-3d')).toBeDisabled();
  await expect(page.locator('#view-mode-plan')).toHaveAttribute('aria-pressed', 'true');
  const panels = page.locator('#ws-view svg[id^="plan-"] g.panel');
  await expect(panels).toHaveCount(8);
  const id = (await panels.first().getAttribute('data-id'))!;
  await panels.first().click();
  await expect(page.locator(`#ws-view g.panel[data-id="${id}"]`)).toHaveClass(/selected/);
  await expect(page.locator(`#panel-table tr[data-id="${id}"]`)).toHaveAttribute('aria-selected', 'true');
  await page.locator('#view-mode-diagram').click(); // the diagram is the other 2D mode
  await expect(page.locator('#ws-view svg.diagram')).toBeVisible();
});

test('Three.js đang tải: Mặt bằng trước; chế độ người dùng chọn được giữ khi 3D sẵn sàng', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  await page.route(/three\.module/, async (route) => { await gate; await route.continue(); });
  await page.goto('/#/mau');
  await expect(page.locator('#ws-view svg[id^="plan-"]')).toHaveCount(2);
  await expect(page.locator('#view-mode-plan')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#view-mode-3d')).toBeDisabled();
  await expect(page.locator('#webgl-fallback')).toBeHidden(); // loading is not a failure
  await page.locator('#view-mode-diagram').click();
  release();
  await expect(page.locator('#view-mode-3d')).toBeEnabled({ timeout: 20000 });
  await expect(page.locator('#view-mode-diagram')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#ws-view svg.diagram')).toBeVisible();
  await page.locator('#view-mode-3d').click();
  await expect(page.locator('canvas[data-panels="8"]')).toBeVisible();
});
