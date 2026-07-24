import { expect, test, type BrowserContext } from "@playwright/test";

test("browser engine loads production assets and preserves authoritative identity after reload", async ({ browser, baseURL }) => {
  let context: BrowserContext | undefined;
  try {
    context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    const failures: string[] = [];
    page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") failures.push(`console: ${message.text()}`);
    });

    await page.goto("/");
    await expect(page.locator("[data-action=create]")).toBeEnabled();
    await page.locator(".join-panel [name=displayName]").fill("Engine Smoke");
    await page.locator("[data-action=create]").click();
    const room = page.locator('[data-field="room"]');
    const role = page.locator('[data-field="role"]');
    await expect(room).not.toHaveText("—");
    const roomId = (await room.textContent())!.trim();
    const roleName = (await role.textContent())!.trim();

    await page.reload();

    await expect(room).toHaveText(roomId);
    await expect(role).toHaveText(roleName);
    expect(failures).toEqual([]);
  } finally {
    await context?.close();
  }
});
