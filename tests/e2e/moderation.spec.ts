import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const MOD_USERNAME = "e2e-moderator";
const PASSWORD = "correct horse battery staple";

test.use({ trace: "off" });

test("moderator drill: report, remove, and restore a published recipe", async ({ browser }) => {
  test.setTimeout(120_000);
  const suffix = Date.now();
  const ownerUsername = `owner-${suffix}`;
  const reporterUsername = `reporter-${suffix}`;
  const SLUG = `carrot-bisque-${suffix}`;
  const TITLE = "Carrot Bisque";

  const modCtx = await browser.newContext();
  const ownerCtx = await browser.newContext();
  const reporterCtx = await browser.newContext();
  const allContexts: BrowserContext[] = [modCtx, ownerCtx, reporterCtx];
  try {
    const modPage = await modCtx.newPage();
    const ownerPage = await ownerCtx.newPage();
    const reporterPage = await reporterCtx.newPage();
    await modPage.goto("/");
    await ownerPage.goto("/");
    await reporterPage.goto("/");

    await register(modPage, MOD_USERNAME, "Mod User", PASSWORD);
    await register(ownerPage, ownerUsername, "Recipe Owner", PASSWORD);
    await register(reporterPage, reporterUsername, "Reporter User", PASSWORD);

    // Owner creates and publishes a 1-carrot recipe
    await ownerPage.locator("[name=recipeSlug]").fill(SLUG);
    await ownerPage.locator("[name=recipeTitle]").fill(TITLE);
    await ownerPage.locator("[name=ingredient-carrot]").fill("1");
    await ownerPage.locator("[data-studio-action=save]").click();
    await expect(ownerPage.locator("[data-owned-recipes]")).toContainText(TITLE, { timeout: 10_000 });

    const recipeId = await ownerPage.evaluate(async () => {
      const res = await fetch("/api/account/recipes", { credentials: "include" });
      const json = (await res.json()) as { recipes: Array<{ id: string }> };
      return json.recipes[0]?.id ?? "";
    });
    expect(recipeId).not.toBe("");

    await ownerPage.locator(`[data-validate-recipe="${recipeId}"]`).click();
    await expect(ownerPage.locator(".studio-feedback[role=status]")).toContainText("valid", { timeout: 10_000 });

    await ownerPage.locator("[name=recipeLicense]").selectOption("CC0_1_0");
    await ownerPage.locator(`[data-publish-recipe="${recipeId}"]`).click();
    await expect(ownerPage.locator(".studio-feedback[role=status]")).toContainText("published", { timeout: 10_000 });

    // Reporter searches for the recipe and submits a report
    await reporterPage.locator("[name=recipeSearch]").fill("Carrot Bisque");
    await reporterPage.locator("[data-studio-action=search]").click();
    await expect(reporterPage.locator("[data-discovery-status]")).toContainText("1 published recipe", { timeout: 10_000 });

    await reporterPage.locator("[data-discovery-results] details summary").click();
    await reporterPage.locator(`[data-report-details="${recipeId}"]`).fill("E2E automated moderator drill — report details for review.");
    await reporterPage.locator(`[data-report-recipe="${recipeId}"]`).click();
    await expect(reporterPage.locator(".studio-feedback[role=status]")).toContainText("Report sent", { timeout: 10_000 });

    // Moderator reviews open reports
    const reports = await modPage.evaluate(async () => {
      const res = await fetch("/api/moderation/recipe-reports", { credentials: "include" });
      return (await res.json() as { reports: Array<{ recipeId: string }> }).reports;
    });
    expect(reports.some((r) => r.recipeId === recipeId)).toBe(true);

    // Moderator removes the recipe
    const removeStatus = await modPage.evaluate(async (id: string) => {
      const res = await fetch(`/api/moderation/recipes/${id}/remove`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "E2E drill removal — policy violation confirmed." }),
      });
      return res.status;
    }, recipeId);
    expect(removeStatus).toBe(204);

    // Recipe no longer discoverable
    await reporterPage.locator("[data-studio-action=search]").click();
    await expect(reporterPage.locator("[data-discovery-status]")).toContainText("0 published recipes", { timeout: 10_000 });

    // Moderator restores the recipe
    const restoreStatus = await modPage.evaluate(async (id: string) => {
      const res = await fetch(`/api/moderation/recipes/${id}/restore`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      return res.status;
    }, recipeId);
    expect(restoreStatus).toBe(204);

    // Recipe is discoverable again
    await reporterPage.locator("[data-studio-action=search]").click();
    await expect(reporterPage.locator("[data-discovery-status]")).toContainText("1 published recipe", { timeout: 10_000 });
  } finally {
    await Promise.allSettled(allContexts.map((c) => c.close()));
  }
});

async function register(page: Page, username: string, displayName: string, password: string): Promise<void> {
  await page.locator("[name=username]").fill(username);
  await page.locator("[data-auth-form] [name=displayName]").fill(displayName);
  await page.locator("[name=password]").fill(password);
  await page.locator('[data-auth-action="register"]').click();
  await expect(page.locator("[data-authenticated-account]")).toHaveText(displayName, { timeout: 10_000 });
}
