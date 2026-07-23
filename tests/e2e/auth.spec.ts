import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { TOMATO_SOUP_RECIPE } from "@cooking-game/recipe-schema";

test("account persists, owns data and history, signs out, while guests still join", async ({ browser, page }) => {
  const username = `cook-${Date.now()}`;
  await page.goto("/");
  await page.locator("[name=username]").fill(username);
  await page.locator("[data-auth-form] [name=displayName]").fill("Saved Cook");
  await page.locator("[name=password]").fill("correct horse battery staple");
  await page.locator('[data-auth-action="register"]').click();
  await expect(page.locator("[data-authenticated-account]")).toHaveText("Saved Cook");
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });

  await page.reload();
  await expect(page.locator("[data-authenticated-account]")).toHaveText("Saved Cook");
  await expect(page.locator(".join-panel [name=displayName]")).toHaveValue("Saved Cook");

  const restartedContext = await browser.newContext({ storageState: await page.context().storageState() });
  try {
    const restartedPage = await restartedContext.newPage();
    await restartedPage.goto("/");
    await expect(restartedPage.locator("[data-authenticated-account]")).toHaveText("Saved Cook");
    await expect(restartedPage.locator(".join-panel [name=displayName]")).toHaveValue("Saved Cook");
  } finally {
    await restartedContext.close();
  }

  await page.locator("[name=reducedMotion]").check();
  await page.locator("[name=masterVolume]").fill("35");
  await page.locator('[data-auth-action="save-preferences"]').click();
  await expect.poll(() => page.evaluate(async () => {
    const response = await fetch("/api/account/preferences", { credentials: "include" });
    return (await response.json()).preferences.masterVolume;
  })).toBe(35);

  await page.locator("[name=recipeDocument]").fill(JSON.stringify(TOMATO_SOUP_RECIPE));
  await page.locator('[data-auth-action="create-recipe"]').click();
  await expect(page.locator("[data-owned-recipes]")).toContainText("Tomato Soup");
  const recipeId = await page.evaluate(async () => {
    const response = await fetch("/api/account/recipes", { credentials: "include" });
    return (await response.json()).recipes[0].id as string;
  });

  await page.locator('[data-action="create"]').click();
  await expect(page.locator('[data-field="room"]')).not.toHaveText("—");
  const roomId = (await page.locator('[data-field="room"]').textContent())!.trim();
  expect(roomId).not.toBe("—");
  const guestContexts: BrowserContext[] = [];
  try {
    const guestTwo = await guest(browser, guestContexts, roomId, "Guest Two");
    const guestThree = await guest(browser, guestContexts, roomId, "Guest Three");
    const players = [page, guestTwo, guestThree];
    await Promise.all(players.map((player) => expect(player.locator('[data-field="players"]')).toHaveText("3 / 3")));
    const roles = await Promise.all(players.map((player) => player.locator('[data-field="role"]').textContent()));
    const blind = players[roles.indexOf("Blind Cook")]!;
    await completeRecipe(blind, players);
    await expect(page.locator("[data-round-status]")).toHaveText("Won");

    await page.reload();
    await expect(page.locator("[data-authenticated-account]")).toHaveText("Saved Cook");
    await expect(page.locator("[data-history]")).toContainText("WON");

    const stranger = await browser.newContext();
    guestContexts.push(stranger);
    const strangerPage = await stranger.newPage();
    await strangerPage.goto("/");
    await strangerPage.locator("[name=username]").fill(`${username}-other`);
    await strangerPage.locator("[data-auth-form] [name=displayName]").fill("Other Cook");
    await strangerPage.locator("[name=password]").fill("another correct battery staple");
    await strangerPage.locator('[data-auth-action="register"]').click();
    await expect(strangerPage.locator("[data-authenticated-account]")).toHaveText("Other Cook");
    expect(await strangerPage.evaluate(async (id) => {
      const response = await fetch(`/api/account/recipes/${id}`, { credentials: "include" });
      return response.status;
    }, recipeId)).toBe(404);

    await page.locator('[data-auth-action="logout"]').click();
    await expect(page.locator("[data-auth-form]")).toBeVisible();
    await page.reload();
    await expect(page.locator("[data-auth-form]")).toBeVisible();
    const freshGuest = await browser.newContext();
    guestContexts.push(freshGuest);
    const freshGuestPage = await freshGuest.newPage();
    await freshGuestPage.goto("/");
    await expect(freshGuestPage.locator('[data-action="create"]')).toBeEnabled();
  } finally {
    await Promise.allSettled(guestContexts.map((context) => context.close()));
  }
});

async function guest(browser: Browser, contexts: BrowserContext[], roomId: string, player: string): Promise<Page> {
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  await page.goto(`/?${new URLSearchParams({ room: roomId, player })}`);
  return page;
}

async function completeRecipe(blind: Page, players: Page[]): Promise<void> {
  let progress = 0;
  const ids: string[] = [];
  for (const label of ["Tomato", "Tomato", "Onion"] as const) {
    const candidate = blind.locator("[data-object-id]").filter({ hasText: `${label} (` }).filter({ hasText: "Raw · Counter · Available" }).first();
    await expect(candidate).toBeVisible();
    const id = (await candidate.getAttribute("data-object-id"))!;
    ids.push(id);
    await candidate.locator("[data-pick-up]").click();
    const row = blind.locator(`[data-object-id="${id}"]`);
    await expect(row).toContainText("Held by you");
    await row.locator('[data-cook-action="CHOP"]').click();
    await expect(row).toContainText("Chopped · Counter · Held by you");
    await expectProgress(players, ++progress);
    await row.locator("[data-drop]").click();
    await expect(row).toContainText("Chopped · Counter · Available");
  }
  for (const id of ids) {
    const row = blind.locator(`[data-object-id="${id}"]`);
    await row.locator("[data-pick-up]").click();
    await expect(row).toContainText("Chopped · Counter · Held by you");
    await row.locator('[data-cook-action="ADD_TO_POT"]').click();
    await expect(row).toContainText("Chopped · Pot · Available");
    await expectProgress(players, ++progress);
  }
  for (const action of ["SEASON", "BOIL", "MIX", "PLATE"] as const) {
    await blind.locator(`[data-station-controls] [data-cook-action="${action}"]`).click();
    await expectProgress(players, ++progress);
  }
}

async function expectProgress(players: Page[], progress: number): Promise<void> {
  await Promise.all(players.map((player) => expect(player.locator("[data-round-progress]")).toContainText(`${progress} / 10`)));
}
