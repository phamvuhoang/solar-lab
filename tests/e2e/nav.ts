import { expect, type Page } from '@playwright/test';
import { stepOfTab, tabDef, type Tab } from '../../src/ui/route';

/** Open a workspace tab the way a person does: its step, then the tab. */
export async function tab(page: Page, t: Tab): Promise<void> {
  const el = page.locator(`#${tabDef(t).elId}`);
  await page.locator(`#step-${stepOfTab(t)}`).click();
  await el.click();
  await expect(el).toHaveAttribute('aria-selected', 'true');
}
