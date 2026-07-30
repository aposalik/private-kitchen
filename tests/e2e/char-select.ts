import type { Page } from "@playwright/test";

export async function pickFirstCharacter(page: Page): Promise<void> {
  await page.locator("#character-select .cs-char").first().click();
  await page.locator("#cs-confirm").click();
}
