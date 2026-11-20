import { expect, test, type Page } from '@playwright/test';
import { tabDef } from '../../src/ui/route';
import { asEngineer, tab } from './nav';

test.beforeEach(async ({ page }) => { await asEngineer(page); }); // the PV model fields and the device list are shown from Thợ or Kỹ sư up

const RUN = { timeout: 60_000 }; // shade preview + a year of dispatch in the worker, with other tests sharing the CPU
async function openSample(page: Page) {
  await page.goto('/#/mau');
  await page.locator('#coach-skip').click();
}
/** window.__slowWeather = ms delays the stored-weather list (IndexedDB) the PV screen waits on, so its repaint is still on the way. */
const SLOW_WEATHER = () => {
  const orig = IDBObjectStore.prototype.getAll;
  IDBObjectStore.prototype.getAll = function (this: IDBObjectStore, ...a: Parameters<typeof orig>) {
    const req = orig.apply(this, a), ms = (window as unknown as { __slowWeather?: number }).__slowWeather;
    if (this.name !== 'weather' || !ms) return req;
    let cb: (() => void) | null = null;
    req.addEventListener('success', () => setTimeout(() => cb?.(), ms));
    return new Proxy(req, {
      set: (t, k, v) => (k === 'onsuccess' ? ((cb = v), true) : Reflect.set(t, k, v)),
      get: (t, k) => { const v = Reflect.get(t, k, t); return typeof v === 'function' ? v.bind(t) : v; },
    });
  };
};

test('form cũ còn trên màn hình khi màn đang dựng lại: không lưu đè thay đổi vừa lưu', async ({ page }) => {
  await page.addInitScript(SLOW_WEATHER);
  await openSample(page);
  await tab(page, 'pv');
  await expect(page.locator('#pv-loss')).toBeVisible();
  await page.evaluate(() => { (window as unknown as { __slowWeather: number }).__slowWeather = 3000; });
  await page.locator('#add-panel').click();
  await page.locator('#add-confirm').click(); // saved: 10 panels; the PV screen's repaint waits on the weather list
  await page.locator('#pv-loss').fill('3'); // the old form, painted from the 8-panel copy
  await page.locator('#pv-save').click();
  await expect(page.locator('#status')).toContainText('thay đổi này chưa được lưu');
  await page.evaluate(() => { (window as unknown as { __slowWeather: number }).__slowWeather = 0; });
  await tab(page, 'du-an');
  await expect(page.locator('#devices')).toContainText('10 ×'); // the added panels are still there
});

test('mở PV khi bóng còn đang tính: tự chạy xong thì màn PV chạy được, không phải chuyển tab', async ({ page }) => {
  test.setTimeout(150_000);
  await openSample(page);
  await tab(page, 'pv'); // before the automatic run (≥ 1 s debounce, then shade) has filled the shade cache
  await expect(page.locator('#compile-issues')).toContainText('SHADE_NOT_COMPUTED');
  await expect(page.locator('#health-pv')).toHaveAttribute('data-state', 'pass', RUN);
  await expect(page.locator('#compile-issues')).toHaveCount(0);
  await page.locator('#pv-run').click();
  await expect(page.locator('#pv-result')).toBeVisible(RUN);
});

test('model vừa tạo trong Thiết bị có ngay trong bảng Thêm, không cần tải lại', async ({ page }) => {
  await page.goto('/#/');
  await page.getByRole('button', { name: 'Mở mẫu Lâm Hà' }).click();
  await tab(page, 'thiet-bi');
  await page.locator('article[data-model="luxpower-sna6000wpv"]').getByRole('button', { name: 'Nhân bản' }).click();
  await page.getByRole('button', { name: 'Lưu thiết bị' }).click();
  await expect(page.locator('#status')).toContainText('Đã lưu');
  await page.locator('#add-inverter').click();
  await expect(page.locator('#add-inverter-model option', { hasText: '(bản sao)' })).toHaveCount(1);
  await tab(page, 'du-an'); // and after a step change
  await page.locator('#add-inverter').click();
  await expect(page.locator('#add-inverter-model option', { hasText: '(bản sao)' })).toHaveCount(1);
});

test('Mặt bằng: Delete khi tấm và thiết bị cùng được chọn mở xem trước xóa, như trên 3D', async ({ page }) => {
  await openSample(page);
  await page.locator('#view-mode-plan').click();
  await tab(page, 'thiet-ke');
  await page.locator('[id^="dev-sel-"]').first().click(); // a device
  await tab(page, 'du-an'); // a tab that does not redraw the selection, so focus stays in the plan
  const g = page.locator('#view-2d g[data-id]').first();
  await g.focus();
  await page.keyboard.press('Control+Enter'); // + a panel
  await page.keyboard.press('Delete');
  await expect(page.locator('#insp-confirm')).toBeVisible();
  await expect(page.locator('#insp-preview')).toContainText('Bỏ');
  await expect(page.locator('#view-2d g[data-id]')).toHaveCount(8); // nothing taken off the roof before the confirm
});

test('Lâm Hà: ô Điện mở chi tiết kiểm tra "tấm chưa thuộc chuỗi"', async ({ page }) => {
  await page.goto('/#/');
  await page.getByRole('button', { name: 'Mở mẫu Lâm Hà' }).click();
  await page.locator('#health-electric').click();
  await expect(page.locator('#finding-detail')).toContainText('chưa thuộc chuỗi');
});

test('xem thử: bấm lại tab đang mở không xóa chữ đang gõ', async ({ page }) => {
  await openSample(page);
  await tab(page, 'du-an');
  await page.locator('#p-name').fill('Nhà chị Tư');
  await page.locator(`#${tabDef('du-an').elId}`).click();
  await expect(page.locator('#p-name')).toHaveValue('Nhà chị Tư');
});
