import { expect, type Page } from '@playwright/test';
import { DEPTH_KEY } from '../../src/ui/depth';
import { parseRoute, stepOfTab, tabDef, type Tab } from '../../src/ui/route';

/** Open a workspace tab the way a person does: its step, then the tab. */
export async function tab(page: Page, t: Tab): Promise<void> {
  const el = page.locator(`#${tabDef(t).elId}`);
  await page.locator(`#step-${stepOfTab(t)}`).click();
  await el.click();
  await expect(el).toHaveAttribute('aria-selected', 'true');
}

/** The app's own reading of the address bar, e.g. to get the project id after a save. */
export const routeOf = (page: Page) => parseRoute(new URL(page.url()).hash);

/** Start at depth Kỹ sư, where every control is shown (the default, Cơ bản, hides detail). Every page of the context, every load. */
export async function asEngineer(page: Page): Promise<void> {
  await page.context().addInitScript((key) => { try { localStorage.setItem(key, 'ky-su'); } catch { /* about:blank */ } }, DEPTH_KEY);
}
