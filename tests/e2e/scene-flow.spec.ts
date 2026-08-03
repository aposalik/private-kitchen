import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { pickFirstCharacter } from "./char-select.js";

// ─── helpers ─────────────────────────────────────────────────────────────────

async function newPlayerPage(browser: Browser, contexts: BrowserContext[]): Promise<Page> {
  const context = await browser.newContext();
  await context.grantPermissions(["microphone"], { origin: "http://127.0.0.1:4173" });
  contexts.push(context);
  return context.newPage();
}

async function autoJoin(page: Page, roomId: string, player: string): Promise<void> {
  const query = new URLSearchParams({ room: roomId, player });
  await page.goto(`/?${query.toString()}`);
  await pickFirstCharacter(page);
}

// ─── waiting room ─────────────────────────────────────────────────────────────

test("waiting room appears while fewer than 3 players are present", async ({ browser }) => {
  test.setTimeout(60_000);
  const contexts: BrowserContext[] = [];
  try {
    const host = await newPlayerPage(browser, contexts);
    await host.goto("/");
    await host.locator(".join-panel [name=displayName]").fill("Solo");
    await host.locator("[data-action=create]").click();
    await pickFirstCharacter(host);

    const roomField = host.locator('[data-field="room"]');
    await expect(roomField).not.toHaveText("—", { timeout: 20_000 });

    // Waiting room should be visible with 1 of 3 players
    await expect(host.locator("[data-waiting-room]")).toBeVisible({ timeout: 10_000 });
    await expect(host.locator("[data-waiting-player-count]")).toHaveText("1 / 3 players ready");

    // Second player joins
    const second = await newPlayerPage(browser, contexts);
    const roomId = (await roomField.textContent())!.trim();
    await autoJoin(second, roomId, "Second");
    await expect(host.locator("[data-waiting-player-count]")).toHaveText("2 / 3 players ready", { timeout: 10_000 });
    await expect(host.locator("[data-waiting-room]")).toBeVisible();

    // Waiting room hides once all 3 players are in
    const third = await newPlayerPage(browser, contexts);
    await autoJoin(third, roomId, "Third");
    await expect(host.locator("[data-waiting-room]")).toBeHidden({ timeout: 10_000 });
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});

// ─── role intro gate ──────────────────────────────────────────────────────────

test("role intro gate appears for every player and hides after acknowledgement", async ({ browser }) => {
  test.setTimeout(120_000);
  const contexts: BrowserContext[] = [];
  try {
    const host = await newPlayerPage(browser, contexts);
    await host.goto("/");
    await host.locator(".join-panel [name=displayName]").fill("Player One");
    await host.locator("[data-action=create]").click();
    await pickFirstCharacter(host);
    const roomField = host.locator('[data-field="room"]');
    await expect(roomField).not.toHaveText("—", { timeout: 20_000 });
    const roomId = (await roomField.textContent())!.trim();

    const second = await newPlayerPage(browser, contexts);
    const third = await newPlayerPage(browser, contexts);
    await Promise.all([autoJoin(second, roomId, "Player Two"), autoJoin(third, roomId, "Player Three")]);

    const players = [host, second, third];
    // Wait for room to be ready (3/3)
    await Promise.all(players.map((p) =>
      expect(p.locator('[data-field="players"]')).toHaveText("3 / 3", { timeout: 30_000 }),
    ));

    // Role intro gate should be visible for every player
    for (const page of players) {
      await expect(page.locator("[data-role-intro-gate]")).toBeVisible({ timeout: 10_000 });
      const gateTitle = await page.locator("#role-intro-title").textContent();
      expect(["Blind Cook", "Recipe Keeper", "Deaf Kitchen Guide"]).toContain(gateTitle?.trim());
    }

    // Gate hides immediately after acknowledgement
    for (const page of players) {
      await page.locator("[data-action=acknowledge-role]").click();
      await expect(page.locator("[data-role-intro-gate]")).toBeHidden();
    }

    // Gate does not reappear on subsequent server ticks
    await expect(host.locator("[data-role-intro-gate]")).toBeHidden({ timeout: 3_000 });

    // Setup surface is gone, operate surface is visible
    await Promise.all(players.map((p) => expect(p.locator("[data-operate-surface]")).toBeVisible()));
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});

// ─── reconnection overlay ─────────────────────────────────────────────────────

test("reconnection overlay is hidden during normal connected play", async ({ browser }) => {
  test.setTimeout(120_000);
  const contexts: BrowserContext[] = [];
  try {
    const host = await newPlayerPage(browser, contexts);
    await host.goto("/");
    await host.locator(".join-panel [name=displayName]").fill("Player One");
    await host.locator("[data-action=create]").click();
    await pickFirstCharacter(host);
    const roomField = host.locator('[data-field="room"]');
    await expect(roomField).not.toHaveText("—", { timeout: 20_000 });
    const roomId = (await roomField.textContent())!.trim();

    const second = await newPlayerPage(browser, contexts);
    const third = await newPlayerPage(browser, contexts);
    await Promise.all([autoJoin(second, roomId, "Player Two"), autoJoin(third, roomId, "Player Three")]);

    await Promise.all([host, second, third].map((p) =>
      expect(p.locator('[data-field="players"]')).toHaveText("3 / 3", { timeout: 30_000 }),
    ));

    // Overlay must not be visible during normal connected state
    for (const page of [host, second, third]) {
      await expect(page.locator("[data-reconnection-overlay]")).toBeHidden();
    }
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});

// ─── pause settings persistence ───────────────────────────────────────────────

test("pause settings persist to localStorage and apply reduced-motion class", async ({ browser }) => {
  test.setTimeout(60_000);
  const contexts: BrowserContext[] = [];
  try {
    const host = await newPlayerPage(browser, contexts);
    await host.goto("/");
    await host.locator(".join-panel [name=displayName]").fill("Settings Player");
    await host.locator("[data-action=create]").click();
    await pickFirstCharacter(host);

    // Get to operate surface (need 3 players — skip round-start by joining all 3)
    const roomField = host.locator('[data-field="room"]');
    await expect(roomField).not.toHaveText("—", { timeout: 20_000 });
    const roomId = (await roomField.textContent())!.trim();
    const second = await newPlayerPage(browser, contexts);
    const third = await newPlayerPage(browser, contexts);
    await Promise.all([autoJoin(second, roomId, "P2"), autoJoin(third, roomId, "P3")]);
    await expect(host.locator('[data-field="players"]')).toHaveText("3 / 3", { timeout: 30_000 });

    // Acknowledge role gate to clear the modal
    await host.locator("[data-action=acknowledge-role]").click();
    await expect(host.locator("[data-role-intro-gate]")).toBeHidden();

    // Open pause overlay with Escape
    await host.keyboard.press("Escape");
    await expect(host.locator("[data-pause-overlay]")).toBeVisible({ timeout: 5_000 });

    // Toggle reduced motion
    const checkbox = host.locator('[data-pause-setting="reducedMotion"]');
    await expect(checkbox).not.toBeChecked();
    await checkbox.click();
    await expect(checkbox).toBeChecked();

    // Check localStorage written
    const stored = await host.evaluate(() => localStorage.getItem("ck:settings:reducedMotion"));
    expect(stored).toBe("1");

    // Check data-reduce-motion attribute applied to <html>
    await expect(host.locator("html")).toHaveAttribute("data-reduce-motion", "");

    // Uncheck reduces motion
    await checkbox.click();
    await expect(checkbox).not.toBeChecked();
    const stored2 = await host.evaluate(() => localStorage.getItem("ck:settings:reducedMotion"));
    expect(stored2).toBe("0");
    await expect(host.locator("html")).not.toHaveAttribute("data-reduce-motion");

    // Volume slider stores value
    const volumeSlider = host.locator('[data-pause-setting="masterVolume"]');
    await volumeSlider.fill("0.5");
    await volumeSlider.dispatchEvent("input");
    const storedVol = await host.evaluate(() => localStorage.getItem("ck:settings:masterVolume"));
    expect(storedVol).toBe("0.5");
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});

// ─── round countdown ──────────────────────────────────────────────────────────

test("round countdown appears briefly when the round starts", async ({ browser }) => {
  test.setTimeout(120_000);
  const contexts: BrowserContext[] = [];
  try {
    const host = await newPlayerPage(browser, contexts);
    await host.goto("/");
    await host.locator(".join-panel [name=displayName]").fill("P1");
    await host.locator("[data-action=create]").click();
    await pickFirstCharacter(host);
    const roomField = host.locator('[data-field="room"]');
    await expect(roomField).not.toHaveText("—", { timeout: 20_000 });
    const roomId = (await roomField.textContent())!.trim();

    const second = await newPlayerPage(browser, contexts);
    const third = await newPlayerPage(browser, contexts);
    await Promise.all([autoJoin(second, roomId, "P2"), autoJoin(third, roomId, "P3")]);
    await expect(host.locator('[data-field="players"]')).toHaveText("3 / 3", { timeout: 30_000 });

    // Acknowledge role gate so the modal isn't blocking
    await Promise.all([host, second, third].map((p) =>
      p.locator("[data-action=acknowledge-role]").click().catch(() => { /* gate may already be hidden */ }),
    ));

    // Countdown should appear (briefly showing "3") then vanish within 5s
    await expect(host.locator("[data-round-countdown]")).toBeVisible({ timeout: 15_000 });
    await expect(host.locator("[data-countdown-digit]")).toHaveText("3");
    await expect(host.locator("[data-round-countdown]")).toBeHidden({ timeout: 5_000 });
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
