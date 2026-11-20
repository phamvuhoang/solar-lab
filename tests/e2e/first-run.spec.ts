import { expect, test, type Page } from '@playwright/test';
import { routeOf } from './nav';

// every Playwright test gets a new browser context, so IndexedDB starts empty: this is a first visit
const idOf = (page: Page) => { const r = routeOf(page); if (r?.kind !== 'project') throw new Error(`not a project address: ${page.url()}`); return r.projectId; };
const edit = async (page: Page) => {
  await page.locator('#add-box').click();
  await expect(page).toHaveURL(/#\/p\/prj-[^/]+\/bo-tri\/mai$/);
};

test('lần đầu mở: thấy Nhà mẫu ngay, có nhãn mẫu, không lưu gì', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/#\/mau$/);
  await expect(page.locator('#ws-name')).toContainText('Nhà mẫu');
  await expect(page.locator('#ws-badge')).toContainText('minh họa');
  await expect(page.locator('#ws-rev')).toContainText('chưa lưu');
  await expect(page.locator('canvas[data-panels="8"]')).toBeVisible();
  await expect(page.locator('#health-electric[data-state="limited"]')).toContainText('0 lỗi');
  await expect(page.locator('#health-money')).toContainText('15.872.000');
  await expect(page.locator('#health-money')).toContainText('thiếu 6 giá');
  await page.goto('/#/');
  await expect(page.locator('#saved')).toContainText('Chưa có dự án');
});

test('sửa lần đầu thì mới lưu', async ({ page }) => {
  await page.goto('/#/mau');
  await expect(page.locator('#ws-rev')).toContainText('chưa lưu');
  await edit(page);
  await expect(page.locator('#ws-rev')).toHaveText('Đã lưu · r1');
  await page.locator('#ws-undo').click(); // the sample as it was, as the next revision
  await expect(page.locator('#ws-rev')).toHaveText('Đã lưu · r2');
  await page.goto('/#/');
  await expect(page.locator('#saved li')).toHaveCount(1);
  await expect(page.locator('#saved li')).toContainText('8 tấm · 4,96 kWp · 15.872.000 đ đã biết · sửa ');
});

test('tải lại #/mau vẫn là xem thử', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/#\/mau$/);
  await page.reload();
  await expect(page).toHaveURL(/#\/mau$/);
  await expect(page.locator('#ws-name')).toContainText('Nhà mẫu');
  await edit(page); // one saved project now
  await page.goto('/#/mau');
  await expect(page.locator('#ws-rev')).toContainText('chưa lưu');
  await page.reload();
  await expect(page).toHaveURL(/#\/mau$/);
  await expect(page.locator('#ws-rev')).toContainText('chưa lưu');
  await page.goto('/#/');
  await expect(page.locator('#saved li')).toHaveCount(1);
});

test('xem thử: mở Bài học rồi quay lại thì về đúng bước, vẫn chưa lưu', async ({ page }) => {
  await page.goto('/#/mau');
  await page.locator('#step-chay-thu').click();
  await expect(page.locator('#step-chay-thu')).toHaveAttribute('aria-current', 'step');
  await expect(page).toHaveURL(/#\/mau$/); // a preview has no project address yet
  await page.locator('#ws-help summary').click();
  await page.locator('#lessons-btn').click();
  await page.locator('#ls-back').click();
  await expect(page).toHaveURL(/#\/mau$/);
  await expect(page.locator('#step-chay-thu')).toHaveAttribute('aria-current', 'step'); // the same workspace, not a fresh copy
  await expect(page.locator('#ws-rev')).toContainText('chưa lưu');
});

test('lần sau mở lại dự án gần nhất', async ({ page }) => {
  await page.goto('/#/');
  await page.getByRole('button', { name: 'Mở mẫu Lâm Hà' }).click(); // saved at once, as in rc.2
  await expect(page.locator('#ws-name')).toContainText('Lâm Hà');
  const lamHa = idOf(page);
  await page.locator('#ws-home').click();
  await page.locator('#entry-sample').click();
  await expect(page).toHaveURL(/#\/mau$/);
  await edit(page);
  const sample = idOf(page);
  await page.goto('/');
  await expect(page).toHaveURL(new RegExp(`#/p/${sample}/bo-tri/mai$`));
  await page.goto('/#/');
  await page.getByRole('button', { name: 'Mở: Lâm Hà' }).click();
  await page.locator('#add-demo-roof').click(); // Lâm Hà is now the one worked on last
  await expect(page.locator('#ws-rev')).toHaveText('Đã lưu · r2');
  await page.goto('/');
  await expect(page).toHaveURL(new RegExp(`#/p/${lamHa}/bo-tri/mai$`));
});

test('trang đầu: ba lối vào; bắt đầu từ số 0 không lưu gì; đổi tên trong tab Dự án', async ({ page }) => {
  await page.goto('/#/');
  for (const id of ['#entry-sample', '#entry-new', '#entry-open']) await expect(page.locator(id)).toBeVisible();
  await expect(page.locator('#entry-open #import-file')).toBeAttached();
  await page.locator('#entry-new').click();
  await expect(page).toHaveURL(/#\/moi$/);
  await expect(page.locator('#ws-name')).toHaveText('Dự án mới');
  await expect(page.locator('#ws-badge')).toHaveCount(0);
  await page.locator('#step-bao-cao').click();
  await page.locator('#project-btn').click();
  await page.locator('#p-name').fill('Nhà anh Ba');
  await page.locator('#p-name-save').click();
  await expect(page.locator('#ws-name')).toHaveText('Nhà anh Ba');
  await expect(page).toHaveURL(/#\/p\/prj-[^/]+\/bao-cao\/du-an$/);
  await page.locator('#ws-home').click();
  await expect(page.getByRole('button', { name: 'Mở: Nhà anh Ba' })).toBeVisible();
});

test('ba chú thích lần đầu, bỏ qua được, không hiện lại', async ({ page }) => {
  await page.goto('/#/mau');
  const coach = page.locator('#coach'), next = page.locator('#coach-next');
  await expect(coach).toContainText('Đây là một hệ thống điện mặt trời hoàn chỉnh: mái, 8 tấm pin, inverter, pin lưu trữ, tải và lưới. Tất cả là mẫu minh họa, không phải báo giá.');
  await expect(coach).toHaveAttribute('data-at', 'view');
  await expect(next).toHaveText('Tiếp');
  await next.click();
  await expect(coach).toContainText('Bấm vào một món trên hình hoặc trong danh sách bên phải để xem nó là gì và đổi nó.');
  await expect(coach).toHaveAttribute('data-at', 'panel');
  await next.click();
  await expect(coach).toContainText('Sau mỗi lần sửa, nhìn thanh dưới cùng: lỗi điện, sản lượng, giờ thiếu điện và tiền thay đổi thế nào.');
  await expect(coach).toHaveAttribute('data-at', 'health');
  await expect(next).toHaveText('Xong');
  await next.click();
  await expect(coach).toHaveCount(0);
  await page.reload();
  await expect(page.locator('#ws-name')).toContainText('Nhà mẫu');
  await expect(coach).toHaveCount(0);

  // "Bỏ qua" ends it at once, and only the sample preview shows it
  await page.evaluate(() => localStorage.clear());
  await page.goto('/#/moi');
  await expect(page.locator('#ws-name')).toHaveText('Dự án mới');
  await expect(coach).toHaveCount(0);
  await page.goto('/#/mau');
  await expect(coach).toBeVisible();
  await page.locator('#coach-skip').click();
  await expect(coach).toHaveCount(0);
  await page.reload();
  await expect(page.locator('#ws-name')).toContainText('Nhà mẫu');
  await expect(coach).toHaveCount(0);
});
