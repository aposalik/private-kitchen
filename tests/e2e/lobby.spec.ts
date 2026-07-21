import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

const ROLE_LABELS = ["Blind Cook", "Recipe Keeper", "Deaf Kitchen Guide"];

test("three isolated players become ready and a fourth is rejected", async ({
  browser,
}) => {
  const contexts: BrowserContext[] = [];

  try {
    const host = await newPlayerPage(browser, contexts);
    await host.goto("/");
    await host.locator("[name=displayName]").fill("Player One");
    await host.locator("[data-action=create]").click();

    const roomField = host.locator('[data-field="room"]');
    await expect(roomField).not.toHaveText("—");
    const roomId = (await roomField.textContent())!.trim();

    const second = await newPlayerPage(browser, contexts);
    const third = await newPlayerPage(browser, contexts);
    await Promise.all([
      autoJoin(second, roomId, "Player Two"),
      autoJoin(third, roomId, "Player Three"),
    ]);

    const players = [host, second, third];
    await Promise.all(
      players.flatMap((page) => [
        expect(page.locator('[data-field="players"]')).toHaveText("3 / 3"),
        expect(page.locator('[data-field="status"]')).toHaveText("Ready"),
      ]),
    );

    const assignedRoles = await Promise.all(
      players.map((page) => page.locator('[data-field="role"]').textContent()),
    );
    expect(new Set(assignedRoles)).toEqual(new Set(ROLE_LABELS));

    const blindIndex = assignedRoles.indexOf("Blind Cook");
    expect(blindIndex).toBeGreaterThanOrEqual(0);
    const blindCook = players[blindIndex]!;
    const nonBlind = players.find((_, index) => index !== blindIndex)!;

    await blindCook.reload();
    await expect(blindCook.locator('[data-field="role"]')).toHaveText("Blind Cook");
    await expect(blindCook.locator('[data-field="players"]')).toHaveText("3 / 3");
    await expect(blindCook.locator('[data-field="status"]')).toHaveText("Ready");

    await expect(nonBlind.locator("[data-pick-up], [data-drop]")).toHaveCount(0);
    await expect(nonBlind.locator('[data-field="interaction-guidance"]')).toHaveText(
      "Only the Blind Cook can pick up and drop objects.",
    );

    const pickUp = blindCook.locator("[data-pick-up]").first();
    const objectId = await pickUp.getAttribute("data-pick-up");
    expect(objectId).toBeTruthy();
    const rows = players.map((page) =>
      page.locator(`[data-object-id="${objectId!}"]`),
    );
    const initialText = await rows[blindIndex]!.textContent();
    await pickUp.click();
    await expect(rows[blindIndex]!).toContainText("Held by you");
    await Promise.all(
      rows
        .filter((_, index) => index !== blindIndex)
        .map((row) => expect(row).toContainText("Held by another player")),
    );

    await rows[blindIndex]!.locator("[data-drop]").click();
    await Promise.all(rows.map((row) => expect(row).toContainText("Available")));
    await expect.poll(() => rows[blindIndex]!.textContent()).not.toBe(initialText);

    const fourth = await newPlayerPage(browser, contexts);
    await autoJoin(fourth, roomId, "Player Four");
    await expect(fourth.getByRole("alert")).toContainText("Unable to connect");
    await expect(fourth.locator('[data-field="connection"]')).toHaveText(
      "Disconnected",
    );

    await Promise.all(
      players.map((page) =>
        expect(page.locator('[data-field="players"]')).toHaveText("3 / 3"),
      ),
    );
  } finally {
    await Promise.allSettled(contexts.map((context) => context.close()));
  }
});

async function newPlayerPage(
  browser: Browser,
  contexts: BrowserContext[],
): Promise<Page> {
  const context = await browser.newContext();
  contexts.push(context);
  return context.newPage();
}

async function autoJoin(page: Page, roomId: string, player: string): Promise<void> {
  const query = new URLSearchParams({ room: roomId, player });
  await page.goto(`/?${query.toString()}`);
}
