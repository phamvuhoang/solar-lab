import { expect, type Page } from '@playwright/test';
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
