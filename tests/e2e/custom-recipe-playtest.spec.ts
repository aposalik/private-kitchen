import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { pickFirstCharacter } from "./char-select.js";

test.use({ trace: "off" });

test("custom recipe 3-player playtest: create, publish, launch, and complete a 1-carrot recipe", async ({ browser, page }) => {
  test.setTimeout(180_000);
  const suffix = Date.now();
  const ownerUsername = `recipe-chef-${suffix}`;
  const SLUG = `carrot-crunch-${suffix}`;
  const TITLE = "Carrot Crunch";
  const PASSWORD = "correct horse battery staple";

  // Register owner
  await page.goto("/");
  await page.locator("[name=username]").fill(ownerUsername);
  await page.locator("[data-auth-form] [name=displayName]").fill("Chef");
  await page.locator("[name=password]").fill(PASSWORD);
  await page.locator('[data-auth-action="register"]').click();
  await expect(page.locator("[data-authenticated-account]")).toHaveText("Chef", { timeout: 10_000 });

  // Create a 1-carrot recipe
  await page.locator("[name=recipeSlug]").fill(SLUG);
  await page.locator("[name=recipeTitle]").fill(TITLE);
  await page.locator("[name=ingredient-carrot]").fill("1");
  await page.locator("[data-studio-action=save]").click();
  await expect(page.locator("[data-owned-recipes]")).toContainText(TITLE, { timeout: 10_000 });

  const recipeId = await page.evaluate(async () => {
    const res = await fetch("/api/account/recipes", { credentials: "include" });
    const json = (await res.json()) as { recipes: Array<{ id: string }> };
    return json.recipes[0]?.id ?? "";
  });
  expect(recipeId).not.toBe("");

  // Validate then publish with CC0
  await page.locator(`[data-validate-recipe="${recipeId}"]`).click();
  await expect(page.locator(".studio-feedback[role=status]")).toContainText("valid", { timeout: 10_000 });
  await page.locator("[name=recipeLicense]").selectOption("CC0_1_0");
  await page.locator(`[data-publish-recipe="${recipeId}"]`).click();
  await expect(page.locator(".studio-feedback[role=status]")).toContainText("published", { timeout: 10_000 });

  // Discover the published recipe and select Launch
  await page.locator("[name=recipeSearch]").fill(TITLE);
  await page.locator("[data-studio-action=search]").click();
  await expect(page.locator("[data-discovery-status]")).toContainText("1 published recipe", { timeout: 10_000 });
  await page.locator(`[data-launch-public="${recipeId}"]`).click();
  await expect(page.locator("[data-selected-recipe]")).toContainText(TITLE, { timeout: 5_000 });

  // Owner creates the room
  await page.locator(".join-panel [name=displayName]").fill("Chef");
  await page.locator("[data-action=create]").click();
  await pickFirstCharacter(page);
  await expect(page.locator("[data-field=room]")).not.toHaveText("—", { timeout: 30_000 });
  const roomId = (await page.locator("[data-field=room]").textContent())!.trim();

  const guestContexts: BrowserContext[] = [];
  try {
    const guestTwo = await joinGuest(browser, guestContexts, roomId, "Guest Two");
    const guestThree = await joinGuest(browser, guestContexts, roomId, "Guest Three");
    const players = [page, guestTwo, guestThree];

    await Promise.all(players.map((p) => expect(p.locator("[data-field=players]")).toHaveText("3 / 3")));

    const roles = await Promise.all(players.map((p) => p.locator("[data-field=role]").textContent()));
    const blind = players[roles.indexOf("Blind Cook")]!;

    // Complete a 6-step 1-carrot recipe: CHOP + ADD_TO_POT + SEASON + BOIL + MIX + PLATE
    await completeCarrotRecipe(blind, players);

    await expect(page.locator("[data-round-status]")).toHaveText("Won");
  } finally {
    await Promise.allSettled(guestContexts.map((c) => c.close()));
  }
});

async function joinGuest(browser: Browser, contexts: BrowserContext[], roomId: string, player: string): Promise<Page> {
  const context = await browser.newContext();
  contexts.push(context);
  const p = await context.newPage();
  await p.goto(`/?${new URLSearchParams({ room: roomId, player })}`);
  await pickFirstCharacter(p);
  return p;
}

async function completeCarrotRecipe(blind: Page, players: Page[]): Promise<void> {
  let progress = 0;
  const TOTAL = 6;

  const carrot = blind
    .locator("[data-object-id]")
    .filter({ hasText: "Carrot (" })
    .filter({ hasText: "Raw · Counter · Available" })
    .first();
  await expect(carrot).toBeVisible();
  const carrotId = (await carrot.getAttribute("data-object-id"))!;

  // CHOP
  await carrot.locator("[data-pick-up]").dispatchEvent("click");
  const carrotRow = blind.locator(`[data-object-id="${carrotId}"]`);
  await expect(carrotRow).toContainText("Held by you");
  await carrotRow.locator('[data-cook-action="CHOP"]').dispatchEvent("click");
  await expect(carrotRow).toContainText("Chopped · Counter · Held by you");
  await expectProgress(players, ++progress, TOTAL);
  await carrotRow.locator("[data-drop]").dispatchEvent("click");
  await expect(carrotRow).toContainText("Chopped · Counter · Available");

  // ADD_TO_POT
  await carrotRow.locator("[data-pick-up]").dispatchEvent("click");
  await expect(carrotRow).toContainText("Chopped · Counter · Held by you");
  await carrotRow.locator('[data-cook-action="ADD_TO_POT"]').dispatchEvent("click");
  await expect(carrotRow).toContainText("Chopped · Pot · Available");
  await expectProgress(players, ++progress, TOTAL);

  // Station steps
  for (const action of ["SEASON", "BOIL", "MIX", "PLATE"] as const) {
    await blind.locator(`[data-station-controls] [data-cook-action="${action}"]`).dispatchEvent("click");
    await expectProgress(players, ++progress, TOTAL);
  }
}

async function expectProgress(players: Page[], progress: number, total: number): Promise<void> {
  await Promise.all(
    players.map((p) =>
      expect(p.locator("[data-round-progress]")).toContainText(`${progress} / ${total}`, { timeout: 15_000 }),
    ),
  );
}
