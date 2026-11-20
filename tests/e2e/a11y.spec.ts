import { expect, test, type Page } from '@playwright/test';
import { COACH_KEY } from '../../src/ui/coach';
import { asEngineer, tab } from './nav';

const noCoach = (page: Page) => page.addInitScript((k) => { try { localStorage.setItem(k, '1'); } catch { /* about:blank */ } }, COACH_KEY);
/** The sample house without its first-look callouts. */
async function openSample(page: Page) {
  await noCoach(page);
  await page.goto('/#/mau');
  await expect(page.locator('canvas[data-panels="8"]')).toBeVisible({ timeout: 20000 });
}
/** Where keyboard focus is: the workspace area around it, its id, and whether it shows a focus ring. */
const focused = (page: Page) => page.evaluate(() => {
  const a = document.activeElement as HTMLElement | null;
  if (!a || a === document.body) return null;
  const cs = getComputedStyle(a);
  return {
    area: a.closest('#ws-top, #ws-steps, #ws-add, #ws-view, #ws-tabs, #ws-panel, #ws-sheets, #ws-health')?.id ?? null,
    what: a.id || a.getAttribute('aria-label') || a.tagName,
    ring: a.matches(':focus-visible') && cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2,
  };
});

test('Tab: thanh trên → các bước → Thêm → khung nhìn → thẻ → bảng bước → thanh sức khỏe, mỗi điểm có viền focus', async ({ page }) => {
  await openSample(page);
  await expect(page.locator('#ws-steps [aria-current="step"]')).toHaveCount(1);
  const tabs = page.locator('#ws-tabs > *');
  for (const t of await tabs.all()) { await expect(t).toHaveAttribute('role', 'tab'); await expect(t).toHaveAttribute('aria-selected', /^(true|false)$/); }
  await expect(page.locator('#ws-tabs [aria-selected="true"]')).toHaveCount(1);

  const stops: NonNullable<Awaited<ReturnType<typeof focused>>>[] = [];
  for (let i = 0; i < 400; i++) {
    await page.keyboard.press('Tab');
    const f = await focused(page);
    if (!f || (stops.at(-1)?.area === 'ws-health' && f.area !== 'ws-health')) break; // past the health bar
    stops.push(f);
  }
  const areas = stops.map((s) => s.area).filter((a, i, all) => a !== all[i - 1]);
  expect(areas).toEqual(['ws-top', 'ws-steps', 'ws-add', 'ws-view', 'ws-tabs', 'ws-panel', 'ws-health']);
  expect(stops.filter((s) => !s.ring).map((s) => s.what)).toEqual([]);
  expect(stops.find((s) => s.area === 'ws-view')?.what).toBe('skip-panel'); // the view starts with the way past it
});

test('lối tắt "Tới bảng bước" chỉ hiện khi có focus và đưa focus vào bảng bước', async ({ page }) => {
  await openSample(page);
  const skip = page.locator('#skip-panel');
  expect((await skip.boundingBox())?.width ?? 0).toBeLessThanOrEqual(1);
  await skip.focus();
  expect((await skip.boundingBox())!.width).toBeGreaterThan(40);
  await expect(skip).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(page.locator('#ws-panel')).toBeFocused();
  await page.keyboard.press('Tab');
  expect((await focused(page))?.area).toBe('ws-panel');
});

test('giảm chuyển động: phát lại không tự chạy, camera không trôi', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await asEngineer(page);
  await openSample(page);
  await expect(page.locator('canvas[data-damping="false"]')).toBeVisible();
  await tab(page, 'bong');
  await expect(page.locator('#sh-play')).toBeDisabled();
  const time = page.locator('#sh-time'), t0 = await time.textContent();
  await page.waitForTimeout(1000);
  await expect(time).toHaveText(t0!);
  await tab(page, 'he-thong');
  const replay = page.locator('#replay-time');
  await expect(replay).toBeVisible({ timeout: 30000 });
  const r0 = await replay.textContent();
  await page.waitForTimeout(1000);
  await expect(replay).toHaveText(r0!);
});

test('hàng bật/tắt lớp 3D cao ≥ 44 px', async ({ page }) => {
  await openSample(page);
  for (const k of ['roof', 'frame', 'panels', 'wires', 'labels']) {
    const row = page.locator(`label:has(#layer-${k})`);
    expect((await row.boundingBox())!.height, k).toBeGreaterThanOrEqual(44);
  }
});

test('focus giữ nguyên chỗ sau khi bảng vẽ lại: nút chọn dòng dự toán, nút chọn vật cản', async ({ page }) => {
  await asEngineer(page);
  await openSample(page);
  await page.locator('#step-chi-phi').click(); // its first tab, Dự toán: one render (a second click on the tab would repaint it again)
  const pick = page.locator('button.bom-pick').first(), row = page.locator('tr:has(button.bom-pick)').first();
  await pick.focus();
  await page.keyboard.press('Enter');
  await expect(row).toHaveAttribute('aria-selected', 'true'); // repainted
  await expect(pick).toBeFocused();

  await page.locator('#step-bo-tri').click(); // Mái nhà 3D
  await page.locator('#add-tank').click();
  await expect(page.locator('#status')).toContainText('Đã lưu: revision');
  const obs = page.locator('#obstacles button[aria-label^="Chọn"]').first();
  await obs.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#inspector')).toContainText('Bồn nước'); // repainted with the obstacle selected
  await expect(obs).toBeFocused();
});

test('"Đang chọn" được đọc lên qua một vùng live duy nhất, không bị vẽ lại', async ({ page }) => {
  await openSample(page);
  const said = page.locator('#ws-said');
  await expect(said).toHaveAttribute('aria-live', 'polite');
  await expect(page.locator('#inspector, #inspector [aria-live]')).toHaveCount(1); // the repainted inspector has no live region of its own
  await expect(page.locator('#inspector')).not.toHaveAttribute('aria-live');
  const node = await said.elementHandle();
  const rows = page.locator('#panel-table button');
  await rows.nth(0).click();
  await expect(said).toContainText(`Đang chọn ${await rows.nth(0).textContent()}`);
  await expect(said).toContainText(((await page.locator('#insp-status').textContent()) ?? '').trim());
  const first = await said.textContent();
  await rows.nth(1).click();
  await expect(said).toContainText(`Đang chọn ${await rows.nth(1).textContent()}`);
  expect(await said.textContent()).not.toBe(first);
  expect(await node!.evaluate((el) => el.isConnected && el === document.getElementById('ws-said'))).toBe(true); // the same node all along
});

test('chú thích lần đầu: Esc như "Bỏ qua"; đóng thì focus về thẻ đang mở', async ({ page }) => {
  await page.goto('/#/mau');
  const coach = page.locator('#coach');
  await page.locator('#coach-next').focus();
  await page.keyboard.press('Escape');
  await expect(coach).toHaveCount(0);
  await expect(page.locator('#ws-tabs [aria-selected="true"]')).toBeFocused();
  expect(await page.evaluate((k) => localStorage.getItem(k), COACH_KEY)).toBe('1');

  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator('#coach-skip').click();
  await expect(coach).toHaveCount(0);
  await expect(page.locator('#ws-tabs [aria-selected="true"]')).toBeFocused();
});

test('không có WebGL: lý do bằng tiếng Việt, lỗi gốc của trình duyệt chỉ ở phần chi tiết', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...a: unknown[]) { return /webgl/i.test(type) ? null : (orig as (...x: unknown[]) => unknown).call(this, type, ...a); } as typeof orig;
  });
  await asEngineer(page);
  await noCoach(page);
  await page.goto('/#/mau');
  const fb = page.locator('#webgl-fallback');
  await expect(fb).toContainText('vẫn đầy đủ');
  await expect(fb.locator('p')).not.toContainText(/error|webgl context/i);
  await expect(fb.locator('p')).toContainText('trình duyệt hoặc máy này không mở được đồ họa 3D');
  await fb.locator('summary').click();
  await expect(fb.locator('details')).toContainText(/Error creating WebGL context/i);
});

test.describe('điện thoại', () => {
  test.use({ viewport: { width: 360, height: 740 }, hasTouch: true });

  test('Esc đóng tấm Thêm/bảng bước và menu "⋯"; menu đóng sau khi dùng một mục; lối tắt mở bảng bước', async ({ page }) => {
    await openSample(page);
    const ws = page.locator('#ws'), sheetPanel = page.locator('#sheet-panel');
    await sheetPanel.click();
    await expect(ws).toHaveAttribute('data-sheet', 'panel');
    await page.locator('#ws-panel button').first().focus();
    await page.keyboard.press('Escape');
    await expect(ws).not.toHaveAttribute('data-sheet', 'panel');
    await expect(sheetPanel).toHaveAttribute('aria-expanded', 'false');
    await expect(sheetPanel).toBeFocused();
    await page.locator('#sheet-add').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('#sheet-add')).toHaveAttribute('aria-expanded', 'false');

    const more = page.locator('#ws-more'), summary = more.locator('> summary');
    await summary.click();
    await expect(more).toHaveAttribute('open', '');
    await page.keyboard.press('Escape');
    await expect(more).not.toHaveAttribute('open');
    await expect(summary).toBeFocused();
    await summary.click();
    await page.locator('#depth-tho').click();
    await expect(more).not.toHaveAttribute('open');
    await expect(summary).toBeFocused();

    await page.locator('#skip-panel').focus();
    await page.keyboard.press('Enter');
    await expect(ws).toHaveAttribute('data-sheet', 'panel');
    await expect(page.locator('#ws-panel')).toBeFocused();
  });

  test('menu "⋯" đóng khi Tab ra khỏi nó; ô nhận focus không bị menu che', async ({ page }) => {
    await openSample(page);
    const more = page.locator('#ws-more'), summary = more.locator('> summary');
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(more).toHaveAttribute('open', '');
    await page.keyboard.press('Tab'); // into its items: it stays open
    expect(await page.evaluate(() => !!document.activeElement?.closest('#ws-more .more-items'))).toBe(true);
    await expect(more).toHaveAttribute('open', '');
    for (let i = 0; i < 20 && (await page.evaluate(() => !!document.activeElement?.closest('#ws-more'))); i++) await page.keyboard.press('Tab');
    await expect(more).not.toHaveAttribute('open');
    const hidden = await page.evaluate(() => {
      const a = document.activeElement as HTMLElement, r = a.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { what: a.id, hidden: !hit || !a.contains(hit) };
    });
    expect(hidden).toEqual({ what: 'step-bo-tri', hidden: false });
    await summary.focus(); // Shift+Tab out of it too
    await page.keyboard.press('Enter');
    await page.keyboard.press('Shift+Tab');
    await expect(more).not.toHaveAttribute('open');
  });

  test('tấm đang mở: Tab không dừng ở điều khiển của khung nhìn nằm dưới tấm', async ({ page }) => {
    await openSample(page);
    for (const s of ['#sheet-panel', '#sheet-add', null]) {
      if (s) await page.locator(s).click();
      const cover = s ? (await page.locator(s === '#sheet-add' ? '#ws-add' : '#ws-panel').boundingBox())!.y : Infinity;
      await page.locator('#step-bao-cao').focus(); // the last step: Thêm (when open), then the view, then the tabs
      const seen: string[] = [];
      for (let i = 0; i < 120; i++) {
        await page.keyboard.press('Tab');
        const at = await page.evaluate(() => {
          const a = document.activeElement as HTMLElement, r = a.getBoundingClientRect();
          return { area: a.closest('#ws-view, #ws-tabs')?.id, what: a.id || a.tagName, top: r.top, bottom: r.bottom };
        });
        if (at.area === 'ws-tabs') break;
        if (at.area !== 'ws-view') continue;
        seen.push(at.what);
        // the canvas is taller than the strip of view left in sight: its top edge is
        expect(at.what === 'CANVAS' ? at.top : at.bottom, `${s}: ${at.what}`).toBeLessThanOrEqual(cover + 1);
      }
      expect(seen, String(s)).toContain('CANVAS');
      if (!s) expect(seen).toContain('cam-overview'); // closed: every view control is reachable
      if (s) await page.locator(s).click();
    }
  });
});
