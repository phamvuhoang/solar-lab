import { expect, test, type Page } from '@playwright/test';

const open = async (page: Page, id: string) => { await page.getByRole('button', { name: 'Bài học' }).click(); await page.locator(`#ls-start-${id}`).click(); await expect(page.locator('#ls-before')).toBeVisible({ timeout: 30000 }); };

test('W08 bài 1: dự đoán V → đổi sang song song → đồng hồ đổi; reset dựng bản sao mới; kỹ sư thêm công thức', async ({ page }) => {
  await page.goto('/');
  await open(page, 'series-parallel');
  await expect(page.locator('#ls-before')).toContainText('82,46 V');
  await expect(page.locator('#ls-act')).toBeDisabled(); // phải dự đoán trước
  await page.locator('#ls-commit').click();
  await expect(page.locator('#ls-hint')).toContainText('dự đoán trước');
  await page.locator('#ls-answer').fill('82,5');
  await page.locator('#ls-commit').click();
  await expect(page.locator('#ls-answer')).toBeDisabled();
  await page.locator('#ls-act').click();
  await expect(page.locator('#ls-verdict')).toHaveAttribute('data-correct', 'true');
  await expect(page.locator('#ls-compare')).toContainText('41,23 V');
  await expect(page.locator('#ls-compare')).toContainText('2 chuỗi');
  const basic = await page.locator('#ls-explain li').count();
  await page.locator('#ls-mode-engineer').check();
  await expect(page.locator('#ls-explain li')).toHaveCount(basic + 1);
  await expect(page.locator('#ls-engineer')).toBeVisible();
  await expect(page.locator('details[data-term="soc"], details[data-term="mppt"]').first()).toBeVisible();
  await page.locator('#ls-reset').click();
  await expect(page.locator('#ls-result')).toHaveCount(0);
  await expect(page.locator('#ls-before')).toContainText('82,46 V');
  await expect(page.locator('#ls-act')).toBeDisabled();
});

test('W08 bài 2: đoán sai vẫn được giải thích; bảng số thay cho biểu đồ; không có project nào bị tạo', async ({ page }) => {
  await page.goto('/');
  await open(page, 'pump-hour');
  await page.locator('input[name="ls-pick"][value="lower"]').check();
  await page.locator('#ls-commit').click();
  await page.locator('#ls-act').click();
  await expect(page.locator('#ls-verdict')).toHaveAttribute('data-correct', 'false', { timeout: 30000 });
  await expect(page.locator('#ls-verdict')).toContainText('cao hơn');
  await expect(page.locator('#ls-explain')).toContainText('chỉ đúng cho 72 giờ');
  await expect(page.locator('#ls-result svg')).toBeVisible();
  await page.locator('#ls-tables summary').click();
  await expect(page.locator('#ls-tables')).toContainText('ngày 1, 12h');
  await page.getByRole('button', { name: 'Về danh sách' }).click();
  await expect(page.locator('#saved')).toHaveCount(0); // bài học không lưu dự án
});

test('W08 bài 3: số tấm bị che lúc 8h, chuỗi liên quan, dịch bồn xong hết che', async ({ page }) => {
  await page.goto('/');
  await open(page, 'tank-shade');
  await expect(page.locator('#ls-before')).toContainText('chuỗi');
  await page.locator('#ls-answer').fill('2');
  await page.locator('#ls-commit').click();
  await page.locator('#ls-act').click();
  await expect(page.locator('#ls-result')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('#ls-compare')).toContainText('không có'); // sau khi dịch: không tấm nào bị che
  await expect(page.locator('#ls-explain')).toContainText('cận trên');
  await page.locator('#ls-tables summary').click();
  await expect(page.locator('#ls-tables table').first().locator('tbody tr')).toHaveCount(8);
});
