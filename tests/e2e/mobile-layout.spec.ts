import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

test("touch landscape creates, reconnects, and performs authoritative Blind Cook pickup/drop", async ({ browser, page, baseURL }) => {
  test.setTimeout(90_000);
  const helpers: BrowserContext[] = [];
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const gate = page.locator("[data-orientation-gate]");
    await expect(gate).toBeVisible();
    await expect(gate.getByRole("button")).toBeVisible();
    await expect(gate.getByRole("button", { name: "Use landscape" })).toBeFocused();

    await page.setViewportSize({ width: 844, height: 390 });
    await expect(gate).toBeHidden();
    await expect(page.locator("#app")).not.toHaveAttribute("inert", "");
    await expectNoDocumentOverflow(page);
    await expectTouchTargets(page);

    await page.locator(".join-panel [name=displayName]").fill("Mobile Host");
    await page.locator("[data-action=create]").tap();
    const room = page.locator('[data-field="room"]');
    const role = page.locator('[data-field="role"]');
    await expect(room).not.toHaveText("—");
    await expect(role).toHaveText("Blind Cook");
    const roomId = (await room.textContent())!.trim();

    await page.reload();
    await expect(room).toHaveText(roomId);
    await expect(role).toHaveText("Blind Cook");

    const second = await helper(browser, helpers, baseURL!, roomId, "Helper Two");
    const third = await helper(browser, helpers, baseURL!, roomId, "Helper Three");
    const players = [page, second, third];
    await Promise.all(players.map((player) =>
      expect(player.locator('[data-field="players"]')).toHaveText("3 / 3"),
    ));

    const pickup = page.locator("[data-pick-up]").first();
    await expect(page.locator("[data-role-briefing]")).toContainText("Blind Cook");
    await expect(page.locator("[data-hud-role]")).toHaveText("Blind Cook");
    await expect(page.locator("[data-hud-role]")).toBeVisible();
    await expect(page.locator("[data-round-timer]")).toBeVisible();
    await expect(page.locator("[data-round-progress]")).toBeVisible();
    await expect(page.locator("[data-kitchen-stage]")).toBeVisible();
    await expect(page.locator("[data-kitchen-world] canvas")).toHaveCount(1);
    const objectId = (await pickup.getAttribute("data-pick-up"))!;
    await page.locator(
      `[data-kitchen-hotspot][data-point-object="${objectId}"]`,
    ).tap({ timeout: 5_000 });
    await expect(pickup).toBeVisible();
    await expect.poll(() => page.evaluate(() => {
      const selectors = [
        "[data-round-timer]",
        "[data-round-progress]",
        "[data-kitchen-stage]",
        "[data-pick-up]",
      ];
      return selectors.every((selector) => {
        const bounds = document.querySelector(selector)?.getBoundingClientRect();
        return bounds !== undefined
          && bounds.top >= 0
          && bounds.bottom <= window.innerHeight;
      });
    })).toBe(true);
    const rows = players.map((player) => player.locator(`[data-object-id="${objectId}"]`));
    await pickup.tap({ timeout: 5_000 });
    await expect(rows[0]!).toContainText("Held by you");
    await Promise.all(rows.slice(1).map((row) => expect(row).toContainText("Held by another player")));

    await page.locator(
      `[data-kitchen-hotspot][data-point-object="${objectId}"]`,
    ).tap({ timeout: 5_000 });
    await rows[0]!.locator("[data-drop]").tap({ timeout: 5_000 });
    await Promise.all(rows.map((row) => expect(row).toContainText("Available")));
    await expectNoDocumentOverflow(page);
    await expectTouchTargets(page);
  } finally {
    await Promise.allSettled(helpers.map((context) => context.close()));
  }
});

test("unsupported fullscreen remains recoverable through manual rotation", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Element.prototype, "requestFullscreen", {
      configurable: true,
      value: undefined,
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const gate = page.locator("[data-orientation-gate]");
  await gate.getByRole("button").tap();
  await expect(gate).toContainText("Rotate manually");

  await page.setViewportSize({ width: 844, height: 390 });
  await expect(gate).toBeHidden();
  await expect(page.locator("[data-action=create]")).toBeEnabled();
});

async function helper(
  browser: Browser,
  contexts: BrowserContext[],
  baseURL: string,
  roomId: string,
  playerName: string,
): Promise<Page> {
  const context = await browser.newContext({ baseURL });
  contexts.push(context);
  const page = await context.newPage();
  const query = new URLSearchParams({ room: roomId, player: playerName });
  await page.goto(`/?${query.toString()}`);
  return page;
}

async function expectNoDocumentOverflow(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  )).toBe(true);
}

async function expectTouchTargets(page: Page): Promise<void> {
  const undersized = await page.locator(
    'button:visible:enabled, input:visible:enabled, textarea:visible:enabled, select:visible:enabled, [role="button"]:visible',
  ).evaluateAll((elements) => elements.flatMap((element) => {
    const bounds = element.getBoundingClientRect();
    return bounds.width >= 44 && bounds.height >= 44
      ? []
      : [`${element.tagName.toLowerCase()} ${Math.round(bounds.width)}x${Math.round(bounds.height)}`];
  }));
  expect(undersized).toEqual([]);
}
