import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";

const ROLE_LABELS = ["Blind Cook", "Recipe Keeper", "Deaf Kitchen Guide"];
const ROLE_KEYS: Readonly<Record<string, string>> = {
  "Blind Cook": "BLIND_COOK",
  "Recipe Keeper": "RECIPE_KEEPER",
  "Deaf Kitchen Guide": "DEAF_KITCHEN_GUIDE",
};
const PLAYTEST_FEEDBACK_KEY = "cooperative-cooking:phase7:playtest-feedback";

test("three isolated players communicate under exact role policy and a fourth is rejected", async ({ browser }) => {
  test.setTimeout(180_000);
  const contexts: BrowserContext[] = [];
  try {
    const host = await newPlayerPage(browser, contexts);
    await host.goto("/");
    await host.locator(".join-panel [name=displayName]").fill("Player One");
    await host.locator("[data-action=create]").click();
    const roomField = host.locator('[data-field="room"]');
    await expect(roomField).not.toHaveText("—");
    const roomId = (await roomField.textContent())!.trim();

    const second = await newPlayerPage(browser, contexts);
    const third = await newPlayerPage(browser, contexts);
    await Promise.all([autoJoin(second, roomId, "Player Two"), autoJoin(third, roomId, "Player Three")]);
    const players = [host, second, third];
    await Promise.all(players.flatMap((page) => [
      expect(page.locator('[data-field="players"]')).toHaveText("3 / 3"),
      expect(page.locator('[data-field="status"]')).toHaveText("Ready"),
    ]));

    const assignedRoles = await Promise.all(players.map((page) => page.locator('[data-field="role"]').textContent()));
    expect(new Set(assignedRoles)).toEqual(new Set(ROLE_LABELS));
    await Promise.all(players.flatMap((page, index) => [
      expect(page.locator("#app")).toHaveAttribute("data-connection-state", "CONNECTED"),
      expect(page.locator("#app")).toHaveAttribute(
        "data-player-role",
        ROLE_KEYS[assignedRoles[index] ?? ""]!,
      ),
      expect(page.locator("[data-role-briefing]")).toContainText(assignedRoles[index]!),
      expect(page.locator("[data-role-objective]")).not.toHaveText(""),
      expect(page.locator("[data-setup-surface]")).toBeHidden(),
      expect(page.locator("[data-operate-surface]")).toBeVisible(),
      expect(page.locator("[data-kitchen-stage]")).toBeVisible(),
      expect(page.locator("[data-kitchen-world] canvas")).toHaveCount(1),
      expect(page.locator("[data-kitchen-avatar]")).toHaveCount(3),
    ]));
    await Promise.all(players.map((page) =>
      page.locator("[data-role-tools-drawer] > summary").click(),
    ));
    const blindIndex = assignedRoles.indexOf("Blind Cook");
    const recipeIndex = assignedRoles.indexOf("Recipe Keeper");
    const deafIndex = assignedRoles.indexOf("Deaf Kitchen Guide");
    const blindCook = players[blindIndex]!;
    const recipeKeeper = players[recipeIndex]!;
    const deafGuide = players[deafIndex]!;
    const nonBlind = players.find((_, index) => index !== blindIndex)!;

    await Promise.all(players.flatMap((page) => [
      expect(page.locator("[data-round-status]")).toHaveText("Running"),
      expect(page.locator("[data-round-progress]")).toContainText("0 / 10"),
      expect(page.locator("[data-round-timer]")).toHaveText(/^0[0-5]:[0-5]\d$/),
    ]));
    const initialRemaining = parseTimer(await blindCook.locator("[data-round-timer]").textContent());
    expect(initialRemaining).toBeGreaterThan(0);
    await expect.poll(
      async () => parseTimer(await blindCook.locator("[data-round-timer]").textContent()),
      { timeout: 3_000 },
    ).toBeLessThan(initialRemaining);

    const privateRecipe = recipeKeeper.locator("[data-private-recipe]");
    await expect(privateRecipe).toContainText("Tomato Soup");
    await expect(privateRecipe).toContainText("2 × Tomato");
    await expect(privateRecipe).toContainText("1 × Onion");
    await expect(privateRecipe.locator("[data-recipe-step]")).toHaveCount(8);
    await expect(privateRecipe).toContainText("Chop Tomato");
    await expect(privateRecipe).toContainText("Plate");
    await expectCountFor(blindCook.locator("[data-private-recipe]"), 0);
    await expectCountFor(deafGuide.locator("[data-private-recipe]"), 0);
    await expectCountFor(blindCook.getByText("Tomato Soup", { exact: true }), 0);
    await expectCountFor(deafGuide.getByText("Tomato Soup", { exact: true }), 0);

    await Promise.all(players.flatMap((page) => [
      expect(page.locator("[data-gesture]")).toHaveCount(5),
      expect(page.locator("[data-emote]")).toHaveCount(4),
      expect(page.locator("[data-point-object]")).not.toHaveCount(0),
      expect(page.locator("[data-point-location]")).toHaveCount(5),
    ]));
    await expect(blindCook.locator("[data-enable-voice]")).toHaveCount(1);
    await expect(recipeKeeper.locator("[data-enable-voice]")).toHaveCount(1);
    await expect(deafGuide.locator("[data-enable-voice]")).toHaveCount(0);
    await expect(recipeKeeper.locator("[data-card]")).toHaveCount(9);
    await expect(recipeKeeper.locator('canvas[data-drawing-board][data-editable="true"]')).toHaveCount(1);
    await expect(deafGuide.locator("[data-communication-feed], [data-visual-signal-stage]")).toHaveCount(2);
    await expect(deafGuide.locator('canvas[data-drawing-board][data-editable="false"]')).toHaveCount(1);
    await expect(deafGuide.locator("[data-card], [data-clear-drawing]")).toHaveCount(0);
    await expectCountFor(blindCook.locator("[data-communication-feed], [data-visual-signal-stage], canvas[data-drawing-board], [data-card], [data-clear-drawing]"), 0);

    await expect(blindCook.locator("[data-voice-policy]")).toContainText("Microphone on");
    await expect(recipeKeeper.locator("[data-voice-policy]")).toContainText("Microphone off");
    await expect(deafGuide.locator("[data-voice-policy]")).toHaveText("Microphone off · Voice output off");

    const pointObject = blindCook.locator("[data-point-object]").first();
    const pointedObjectId = await pointObject.getAttribute("data-point-object");
    expect(pointedObjectId).toBeTruthy();
    await pointObject.click();
    await Promise.all([
      expect(recipeKeeper.locator("[data-point-marker]")).toHaveAttribute("data-point-object", pointedObjectId!),
      expect(deafGuide.locator("[data-point-marker]")).toHaveAttribute("data-point-object", pointedObjectId!),
      expect(recipeKeeper.locator(`[data-object-id="${pointedObjectId!}"]`)).toHaveClass(/visual-point-target/),
      expect(deafGuide.locator(`[data-object-id="${pointedObjectId!}"]`)).toHaveClass(/visual-point-target/),
    ]);
    await expectCountFor(blindCook.locator("[data-point-marker], .visual-point-target"), 0);

    await deafGuide.locator('[data-point-location="STOVE"]').click();
    await Promise.all([
      expect(recipeKeeper.locator("[data-point-marker]")).toHaveAttribute("data-point-x", "50"),
      expect(deafGuide.locator("[data-point-marker]")).toHaveAttribute("data-point-x", "50"),
    ]);
    await expectCountFor(blindCook.locator("[data-point-marker]"), 0);

    await blindCook.locator('[data-gesture="NOD"]').click();
    await Promise.all([
      expect(recipeKeeper.locator("[data-head-motion]")).toHaveClass(/head-motion--nod/),
      expect(deafGuide.locator("[data-head-motion]")).toHaveClass(/head-motion--nod/),
    ]);
    await blindCook.locator('[data-emote="URGENT"]').click();
    await Promise.all([
      expect(recipeKeeper.locator('[data-emote-indicator="URGENT"]')).toContainText("Urgent"),
      expect(deafGuide.locator('[data-emote-indicator="URGENT"]')).toContainText("Urgent"),
    ]);
    await expectCountFor(blindCook.locator("[data-head-motion], [data-emote-indicator]"), 0);

    await recipeKeeper.locator('[data-card="CHOP"]').click();
    await expect(deafGuide.locator("[data-communication-feed]")).toContainText("CHOP");
    await expectCountFor(blindCook.locator("[data-communication-feed], [data-card]"), 0);

    const drawing = recipeKeeper.locator('canvas[data-drawing-board][data-editable="true"]');
    await drawing.scrollIntoViewIfNeeded();
    const box = await drawing.boundingBox();
    expect(box).not.toBeNull();
    await recipeKeeper.mouse.move(box!.x + 10, box!.y + 10);
    await recipeKeeper.mouse.down();
    await recipeKeeper.mouse.move(box!.x + box!.width - 10, box!.y + box!.height - 10, { steps: 4 });
    await recipeKeeper.mouse.up();
    await expect(deafGuide.locator("canvas[data-drawing-board]")).toHaveAttribute("data-stroke-count", "1");
    await expectCountFor(blindCook.locator("canvas[data-drawing-board]"), 0);

    await expect(nonBlind.locator("[data-pick-up], [data-drop]")).toHaveCount(0);
    await expect(nonBlind.locator('[data-field="interaction-guidance"]')).toHaveText("Only the Blind Cook can pick up and drop objects.");
    const pickUp = blindCook.locator("[data-pick-up]").first();
    const objectId = await pickUp.getAttribute("data-pick-up");
    expect(objectId).toBeTruthy();
    const rows = players.map((page) => page.locator(`[data-object-id="${objectId!}"]`));
    const initialText = await rows[blindIndex]!.textContent();
    await selectObject(blindCook, objectId!);
    await expect(pickUp).toBeVisible();
    await pickUp.click();
    await expect(rows[blindIndex]!).toContainText("Held by you");
    await Promise.all(rows.filter((_, index) => index !== blindIndex).map((row) => expect(row).toContainText("Held by another player")));
    await selectObject(blindCook, objectId!);
    await rows[blindIndex]!.locator("[data-drop]").click();
    await Promise.all(rows.map((row) => expect(row).toContainText("Available")));
    await expect.poll(() => rows[blindIndex]!.textContent()).not.toBe(initialText);

    let completedSteps = 0;
    const ingredientIds: string[] = [];
    for (const label of ["Tomato", "Tomato", "Onion"] as const) {
      const chopped = await chopIngredient(blindCook, players, label, completedSteps);
      ingredientIds.push(chopped.objectId);
      completedSteps = chopped.completedSteps;
    }
    for (const objectId of ingredientIds) {
      completedSteps = await addIngredientToPot(blindCook, players, objectId, completedSteps);
    }
    expect(completedSteps).toBe(6);

    for (const [action, expectedProgress] of [
      ["SEASON", 7],
      ["BOIL", 8],
      ["MIX", 9],
      ["PLATE", 10],
    ] as const) {
      const stationAction = blindCook.locator(`[data-station-controls] [data-cook-action="${action}"]`);
      await expect(stationAction).toHaveCount(1);
      await stationAction.click();
      await expectProgress(players, expectedProgress);
    }

    await Promise.all(players.flatMap((page) => [
      expect(page.locator("[data-round-status]")).toHaveText("Won"),
      expect(page.locator("[data-round-result]")).toContainText("Round won!"),
      expect(page.locator("[data-round-result]")).toContainText("10 / 10 steps completed"),
      expect(page.locator("[data-playtest-debrief]")).toBeVisible(),
      expect(page.locator("[data-pick-up], [data-drop], [data-cook-action]")).toHaveCount(0),
    ]));
    for (const page of players) {
      const pointButtons = page.locator(
        "button[data-point-object], button[data-point-location]",
      );
      await expect.poll(async () => {
        const disabled = await pointButtons.evaluateAll((buttons) =>
          buttons.length > 0 && buttons.every((button) => (button as HTMLButtonElement).disabled),
        );
        return disabled;
      }).toBe(true);
    }
    await expect(recipeKeeper.locator("[data-private-recipe]")).toContainText("Tomato Soup");
    await expectCountFor(blindCook.locator("[data-private-recipe]"), 0);
    await expectCountFor(deafGuide.locator("[data-private-recipe]"), 0);

    // Receiver-first order proves READY caching before the Blind Cook publisher enables.
    await recipeKeeper.locator("[data-enable-voice]").click();
    await blindCook.locator("[data-enable-voice]").click();
    await expect(recipeKeeper.locator("[data-voice-status]")).toHaveText("Enabled");
    await expect(blindCook.locator("[data-voice-status]")).toHaveText("Enabled");
    await expect(deafGuide.locator("[data-voice-status]")).toHaveText("Disabled");
    await Promise.all([
      expect(recipeKeeper.locator("[data-voice-stream-count]")).toHaveText("Remote streams: 1", { timeout: 15_000 }),
      expect(blindCook.locator("[data-voice-stream-count]")).toHaveText("Remote streams: 0", { timeout: 15_000 }),
      expect(deafGuide.locator("[data-voice-stream-count]")).toHaveText("Remote streams: 0", { timeout: 15_000 }),
    ]);
    await expectTextFor(deafGuide.locator("[data-voice-stream-count]"), "Remote streams: 0");

    await blindCook.reload();
    await expect(blindCook.locator('[data-field="role"]')).toHaveText("Blind Cook");
    await expect(blindCook.locator('[data-field="players"]')).toHaveText("3 / 3");
    await expect(blindCook.locator('[data-field="status"]')).toHaveText("Ready");

    const localKeysBefore = await blindCook.evaluate(() => Object.keys(localStorage));
    await blindCook.locator('select[name="participationRating"]').selectOption("5");
    await blindCook.locator('select[name="communicationClarity"]').selectOption("4");
    await blindCook.locator('select[name="frustration"]').selectOption("2");
    await blindCook.locator('select[name="replayIntent"]').selectOption("YES");
    await blindCook.locator('[name="misunderstoodSignals"][value="NONE"]').check();
    await blindCook.locator("[data-feedback-submit]").click();
    await expect(blindCook.locator("[data-feedback-confirmation]")).toContainText("saved locally");
    const localFeedback = await blindCook.evaluate((feedbackKey) => ({
      keys: Object.keys(localStorage),
      records: JSON.parse(localStorage.getItem(feedbackKey) ?? "[]"),
    }), PLAYTEST_FEEDBACK_KEY);
    expect(localFeedback.keys.filter((key) => !localKeysBefore.includes(key))).toEqual([
      PLAYTEST_FEEDBACK_KEY,
    ]);
    expect(localFeedback.records).toHaveLength(1);
    expect(Object.keys(localFeedback.records[0]).sort()).toEqual([
      "communicationClarity",
      "completedSteps",
      "frustration",
      "misunderstoodSignals",
      "observedDurationSeconds",
      "participationRating",
      "replayIntent",
      "role",
      "roundOutcome",
      "schemaVersion",
      "timestamp",
      "totalSteps",
    ]);

    const fourth = await newPlayerPage(browser, contexts);
    await autoJoin(fourth, roomId, "Player Four");
    await expect(fourth.getByRole("alert")).toContainText("Unable to connect");
    await expect(fourth.locator('[data-field="connection"]')).toHaveText("Disconnected");
    await Promise.all(players.map((page) => expect(page.locator('[data-field="players"]')).toHaveText("3 / 3")));
  } finally {
    await Promise.allSettled(contexts.map((context) => context.close()));
  }
});

async function newPlayerPage(browser: Browser, contexts: BrowserContext[]): Promise<Page> {
  const context = await browser.newContext();
  await context.grantPermissions(["microphone"], { origin: "http://127.0.0.1:4173" });
  contexts.push(context);
  return context.newPage();
}

async function autoJoin(page: Page, roomId: string, player: string): Promise<void> {
  const query = new URLSearchParams({ room: roomId, player });
  await page.goto(`/?${query.toString()}`);
}

async function expectCountFor(locator: Locator, count: number, durationMs = 300): Promise<void> {
  const deadline = Date.now() + durationMs;
  do {
    expect(await locator.count()).toBe(count);
    await new Promise((resolve) => setTimeout(resolve, 25));
  } while (Date.now() < deadline);
}

async function expectTextFor(locator: Locator, expected: string, durationMs = 300): Promise<void> {
  const deadline = Date.now() + durationMs;
  do {
    expect((await locator.textContent())?.trim()).toBe(expected);
    await new Promise((resolve) => setTimeout(resolve, 25));
  } while (Date.now() < deadline);
}


async function chopIngredient(
  blindCook: Page,
  players: readonly Page[],
  label: "Tomato" | "Onion",
  completedSteps: number,
): Promise<{ objectId: string; completedSteps: number }> {
  const candidate = blindCook
    .locator("[data-object-id]")
    .filter({ hasText: `${label} (` })
    .filter({ hasText: "Raw · Counter · Available" })
    .first();
  const objectId = await candidate.getAttribute("data-object-id");
  expect(objectId).toBeTruthy();
  const row = blindCook.locator(`[data-object-id="${objectId!}"]`);

  await selectObject(blindCook, objectId!);
  await row.locator("[data-pick-up]").click();
  await expect(row).toContainText("Held by you");
  await selectObject(blindCook, objectId!);
  await row.locator('[data-cook-action="CHOP"]').click();
  await expect(row).toContainText("Chopped · Counter · Held by you");
  completedSteps += 1;
  await expectProgress(players, completedSteps);
  await selectObject(blindCook, objectId!);
  await row.locator("[data-drop]").click();
  await expect(row).toContainText("Chopped · Counter · Available");
  return { objectId: objectId!, completedSteps };
}

async function addIngredientToPot(
  blindCook: Page,
  players: readonly Page[],
  objectId: string,
  completedSteps: number,
): Promise<number> {
  const row = blindCook.locator(`[data-object-id="${objectId}"]`);
  await selectObject(blindCook, objectId);
  await row.locator("[data-pick-up]").click();
  await expect(row).toContainText("Chopped · Counter · Held by you");
  await selectObject(blindCook, objectId);
  await row.locator('[data-cook-action="ADD_TO_POT"]').click();
  await expect(row).toContainText("Chopped · Pot · Available");
  completedSteps += 1;
  await expectProgress(players, completedSteps);
  return completedSteps;
}

async function selectObject(page: Page, objectId: string): Promise<void> {
  await page.locator(
    `[data-kitchen-hotspot][data-point-object="${objectId}"]`,
  ).click();
}

async function expectProgress(players: readonly Page[], completedSteps: number): Promise<void> {
  await Promise.all(players.map((page) =>
    expect(page.locator("[data-round-progress]")).toContainText(`${completedSteps} / 10`),
  ));
}

function parseTimer(value: string | null): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value?.trim() ?? "");
  if (!match) return -1;
  return Number(match[1]) * 60 + Number(match[2]);
}
