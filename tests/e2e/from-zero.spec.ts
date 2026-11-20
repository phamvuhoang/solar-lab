import { expect, test, type Page } from '@playwright/test';
import { tab } from './nav';

// A fresh browser context per test, so this starts with no saved project.
const item = (page: Page, id: string) => page.locator(`#checklist li[data-progress="${id}"]`);
const done = (page: Page, id: string) => expect(item(page, id)).toHaveAttribute('data-status', 'done');
const rev = async (page: Page) => Number(/r(\d+)/.exec((await page.locator('#ws-rev').textContent()) ?? '')?.[1] ?? 0);

/** The step's own button in the checklist; the list folds once the project has a device, so open it first. */
async function doStep(page: Page, id: string) {
  const list = page.locator('#checklist');
  if ((await list.getAttribute('open')) === null) await list.locator('summary').click();
  await page.locator(`#do-${id}`).click();
}

test('đi hết 9 bước từ số 0', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/#/');
  await page.locator('#entry-new').click();
  await expect(page).toHaveURL(/#\/moi$/);
  const list = page.locator('#checklist');
  await expect(list).toHaveAttribute('open', '');
  await expect(list.locator('li[data-status="todo"]')).toHaveCount(8);
  await expect(list.locator('li[data-status="optional"]')).toHaveCount(1);
  await expect(list.locator('summary')).toHaveText('Còn 8 bước');

  // ① nơi lắp: tọa độ gần Lâm Hà chọn luôn bộ thời tiết đóng gói
  await doStep(page, 'noi-lap');
  await expect(page.locator('#loc-lat')).toBeFocused();
  await page.locator('#loc-lat').fill('11,87');
  await page.locator('#loc-lon').fill('108,2');
  await page.locator('#loc-save').click();
  await done(page, 'noi-lap');
  await expect(list.locator('summary')).toHaveText('Còn 7 bước');

  // ② mặt mái
  await doStep(page, 'mai');
  await expect(page.locator('#add-rect')).toBeFocused();
  await page.locator('#add-rect').click();
  await done(page, 'mai');

  // ③ tấm: thêm 8 tấm theo lô (chưa có chỗ), rồi điền lên mái
  await doStep(page, 'dat-tam');
  await expect(page.locator('#b-count')).toBeFocused();
  await page.locator('#b-count').fill('8');
  await page.getByRole('button', { name: 'Xác nhận thêm' }).click();
  await expect(page.locator('#do-dat-tam')).toHaveText('Đặt tấm');
  await doStep(page, 'dat-tam');
  await page.locator('#fill-face').click();
  await done(page, 'dat-tam');

  // ④ inverter qua preset: hai chuỗi vào hai MPPT, nên bước ⑦ (nối chuỗi, không lỗi đỏ) cũng xong
  await doStep(page, 'inverter');
  await page.locator('#preset').selectOption('two-trackers');
  await page.locator('#apply-preset').click();
  await done(page, 'inverter');
  await done(page, 'loi-do');

  // ⑤ pin
  await doStep(page, 'pin');
  await page.getByRole('button', { name: 'Thêm pin vào inverter' }).click();
  await done(page, 'pin');

  // ⑥ tải, rồi lịch chạy của nó
  await doStep(page, 'tai');
  await page.locator('#p-load').selectOption('sample-home-load@1');
  await page.getByRole('button', { name: 'Thêm tải AC' }).click();
  await expect(page.locator('#do-tai')).toHaveText('Đặt lịch tải');
  await doStep(page, 'tai');
  const load = page.locator('.card[data-load]');
  await load.locator('input[id^="lp-hours-"]').fill('6-22');
  await load.getByRole('button', { name: 'Lưu lịch' }).click();
  await done(page, 'tai');

  // ⑨ giá; ⑧ chạy thử tự chạy sau mỗi lần sửa, nên không cần bấm "Chạy"
  await doStep(page, 'gia');
  for (const [key, price] of [['vsun-620@1', '1.900.000'], ['luxpower-sna6000wpv@1', '14.500.000'], ['dyness-dl5-0c@1', '17.000.000']] as const) {
    await page.locator(`[data-device="${key}"]`).getByRole('button', { name: 'Thêm báo giá' }).click();
    await page.locator('#o-seller').fill('Cửa hàng A');
    await page.locator('#o-price').fill(price);
    await page.locator('#o-vat').selectOption('included');
    await page.getByRole('button', { name: 'Lưu báo giá' }).click();
    await expect(page.locator(`tr[data-key="design:${key}"]`)).toContainText('đã gồm VAT');
  }
  for (const c of ['frame', 'cable', 'protection', 'labor']) {
    const r = await rev(page);
    await page.locator(`#waive-${c}`).check();
    await expect.poll(() => rev(page)).toBeGreaterThan(r); // the screen is rebuilt from the saved project before the next box
    await expect(page.locator(`#waive-${c}`)).toBeChecked();
  }
  await done(page, 'gia');
  await expect(page.locator('#quote-total')).not.toContainText('chưa đủ');

  // ⑧ the automatic run of the last edit: once it is done all 9 steps are, and the list goes away by itself
  await expect(list).toHaveCount(0, { timeout: 60_000 });
  await tab(page, 'he-thong');
  await expect(page.locator('#sim-result')).toBeVisible(); // the automatic run is the current design's result
});

test('chạy thử chỉ được tính cho đúng bản thiết kế hiện tại: sửa thì thành chưa chạy tới khi lần tự chạy của bản mới xong', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto('/#/mau');
  await page.locator('#coach-skip').click();
  await expect(item(page, 'chay-thu')).toHaveAttribute('data-status', 'done', { timeout: 60_000 }); // shade preview + PV + dispatch, no click
  await tab(page, 'he-thong');
  // the first edit stores the preview as revision 1; the run of the preview is not a run of it
  await page.locator('#s-min').fill('30');
  await page.locator('#s-save').click();
  await expect(page.locator('#ws-rev')).toHaveText('Đã lưu · r1');
  await expect(item(page, 'chay-thu')).toHaveAttribute('data-status', 'todo');
  await expect(page.locator('#health-supply')).toContainText('đang tính lại…');
  await expect(item(page, 'chay-thu')).toHaveAttribute('data-status', 'done', { timeout: 60_000 });
});
