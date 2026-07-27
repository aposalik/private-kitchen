import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

const EVIDENCE_DIR = ".hermes/tmp/phasec-live";

interface PlayerPosition {
  readonly x: number;
  readonly z: number;
}

test("Phase C runs a fullscreen authoritative three-player Babylon custom-recipe prototype with Phaser rollback", async ({ browser, page }) => {
  test.setTimeout(300_000);
  const contexts: BrowserContext[] = [];
  const browserErrors: string[] = [];
  const watchErrors = (candidate: Page) => {
    candidate.on("pageerror", (error) => browserErrors.push(`pageerror: ${error.message}`));
    candidate.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(`console: ${message.text()}`);
    });
  };
  watchErrors(page);
  page.setDefaultTimeout(15_000);

  try {
    const username = `phase-c-${Date.now()}`;
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.locator("[name=username]").fill(username);
    await page.locator("[data-auth-form] [name=displayName]").fill("Phase C Blind");
    await page.locator("[name=password]").fill("correct horse battery staple");
    await page.locator('[data-auth-action="register"]').click();
    await expect(page.locator("[data-authenticated-account]")).toHaveText("Phase C Blind");
    await page.locator(".join-panel [name=displayName]").fill("Phase C Blind");

    await page.locator("[name=recipeSlug]").fill("phase-c-garden-soup");
    await page.locator("[name=recipeTitle]").fill("Phase C Garden Soup");
    await page.locator("[name=ingredient-tomato]").fill("2");
    await page.locator("[name=ingredient-onion]").fill("1");
    await page.locator('[data-studio-action="save"]').click();
    await expect(page.locator("[data-owned-recipes]")).toContainText("Phase C Garden Soup");
    const recipeId = await page.evaluate(async () => {
      const response = await fetch("/api/account/recipes", { credentials: "include" });
      return (await response.json()).recipes[0].id as string;
    });
    await page.locator(`[data-private-test-recipe="${recipeId}"]`).click();
    await expect(page.locator("[data-selected-recipe]")).toContainText("private test");

    await page.locator('[data-action="create"]').click();
    await expect(page.locator('[data-field="room"]')).not.toHaveText("—");
    const roomId = (await page.locator('[data-field="room"]').textContent())!.trim();

    const keeper = await guest(browser, contexts, roomId, "Phase C Keeper", watchErrors);
    const guide = await guest(browser, contexts, roomId, "Phase C Guide", watchErrors);
    const players = [page, keeper, guide];
    await Promise.all(players.flatMap((player) => [
      expect(player.locator('[data-field="players"]')).toHaveText("3 / 3"),
      expect(player.locator("[data-round-status]")).toHaveText("Running"),
      expect(player.locator('[data-kitchen-world][data-renderer="babylon"]')).toHaveAttribute("data-renderer-state", "ready", { timeout: 45_000 }),
      expect(player.locator("canvas.babylon-kitchen-canvas")).toBeVisible(),
      expect.poll(async () => Number(
        await player.locator("canvas.babylon-kitchen-canvas").getAttribute("data-scene-meshes"),
      ), { timeout: 45_000 }).toBeGreaterThan(20),
      expect.poll(async () =>
        await player.locator("canvas.babylon-kitchen-canvas").getAttribute("data-camera-position"),
      { timeout: 45_000 }).not.toContain("NaN"),
    ]));

    const roles = await Promise.all(players.map((player) => player.locator('[data-field="role"]').textContent()));
    expect(new Set(roles)).toEqual(new Set(["Blind Cook", "Recipe Keeper", "Deaf Kitchen Guide"]));
    const blind = players[roles.indexOf("Blind Cook")]!;
    const recipeKeeper = players[roles.indexOf("Recipe Keeper")]!;
    const deafGuide = players[roles.indexOf("Deaf Kitchen Guide")]!;

    await expect(recipeKeeper.locator("[data-private-recipe]")).toContainText("Phase C Garden Soup");
    await expect(blind.locator("[data-private-recipe]")).toHaveCount(0);
    await expect(deafGuide.locator("[data-private-recipe]")).toHaveCount(0);
    await expect(deafGuide.locator("[data-enable-voice]")).toHaveCount(0);

    for (const player of players) {
      expect(await player.evaluate(() => {
        const stage = document.querySelector<HTMLElement>("[data-kitchen-stage]")!;
        const bounds = stage.getBoundingClientRect();
        return {
          width: Math.round(bounds.width),
          height: Math.round(bounds.height),
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        };
      })).toEqual({ width: 1440, height: 900, viewportWidth: 1440, viewportHeight: 900, overflow: false });
    }
    console.log("BABYLON_DIAGNOSTICS", await Promise.all(players.map((player) =>
      player.locator("canvas.babylon-kitchen-canvas").evaluate((canvas) => ({
        activeMeshes: canvas.dataset.activeMeshes,
        activeMeshNames: canvas.dataset.activeMeshNames,
        cameraPosition: canvas.dataset.cameraPosition,
        cameraTarget: canvas.dataset.cameraTarget,
        renderWidth: canvas.dataset.renderWidth,
        renderHeight: canvas.dataset.renderHeight,
        sceneReady: canvas.dataset.sceneReady,
      })),
    )));

    const moves = [
      { page: blind, role: "BLIND_COOK", key: "s" },
      { page: recipeKeeper, role: "RECIPE_KEEPER", key: "a" },
      { page: deafGuide, role: "DEAF_KITCHEN_GUIDE", key: "d" },
    ] as const;
    const before = await Promise.all(moves.map(({ page: player, role }) => position(player, role)));
    await Promise.all(moves.map(async ({ page: player, key }) => {
      await player.keyboard.down(key);
      await player.waitForTimeout(350);
      await player.keyboard.up(key);
    }));
    const after = await Promise.all(moves.map(async ({ page: player, role }, index) => {
      await expect.poll(async () => position(player, role)).not.toEqual(before[index]);
      return position(player, role);
    }));
    for (let index = 0; index < moves.length; index += 1) {
      for (const observer of players) {
        await expect.poll(async () => position(observer, moves[index]!.role)).toEqual(after[index]);
      }
    }

    await Promise.all(players.map(waitForCameraToSettle));

    await Promise.all([
      blind.screenshot({ path: `${EVIDENCE_DIR}/phasec-blind-cook.png`, fullPage: false }),
      recipeKeeper.screenshot({ path: `${EVIDENCE_DIR}/phasec-recipe-keeper.png`, fullPage: false }),
      deafGuide.screenshot({ path: `${EVIDENCE_DIR}/phasec-deaf-guide.png`, fullPage: false }),
    ]);

    await test.step("complete the real custom recipe through authoritative actions", async () => {
      await completeCustomRecipe(blind, players);
    });
    await Promise.all(players.map((player) => expect(player.locator("[data-round-status]")).toHaveText("Won")));

    const rollbackContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    contexts.push(rollbackContext);
    const rollback = await rollbackContext.newPage();
    rollback.setDefaultTimeout(15_000);
    watchErrors(rollback);
    await rollback.goto("/?renderer=phaser");
    await rollback.locator(".join-panel [name=displayName]").fill("Rollback Cook");
    await rollback.locator('[data-action="create"]').click();
    await expect(rollback.locator('[data-kitchen-world][data-renderer="phaser"]'))
      .toHaveAttribute("data-renderer-state", "ready", { timeout: 45_000 });
    await expect(rollback.locator('[data-kitchen-world][data-renderer="phaser"] canvas')).toHaveCount(1);
    await rollback.screenshot({ path: `${EVIDENCE_DIR}/phasec-phaser-rollback.png`, fullPage: false });

    expect(browserErrors).toEqual([]);
  } finally {
    await Promise.allSettled(contexts.map((context) => context.close()));
  }
});

async function guest(
  browser: Browser,
  contexts: BrowserContext[],
  roomId: string,
  player: string,
  watchErrors: (page: Page) => void,
): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  contexts.push(context);
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  watchErrors(page);
  await page.goto(`/?${new URLSearchParams({ room: roomId, player })}`);
  return page;
}

async function position(page: Page, role: string): Promise<PlayerPosition> {
  const marker = page.locator(`[data-kitchen-avatar="${role}"]`);
  return {
    x: Number(await marker.getAttribute("data-world-x")),
    z: Number(await marker.getAttribute("data-world-z")),
  };
}

async function waitForCameraToSettle(page: Page): Promise<void> {
  const canvas = page.locator("canvas.babylon-kitchen-canvas");
  let previous: string | null = null;
  let stableSamples = 0;
  await expect.poll(async () => {
    const current = [
      await canvas.getAttribute("data-camera-position"),
      await canvas.getAttribute("data-camera-target"),
    ].join("|");
    stableSamples = current === previous ? stableSamples + 1 : 0;
    previous = current;
    return stableSamples;
  }, {
    timeout: 10_000,
    intervals: [100, 100, 100, 100, 100, 100, 100, 100],
  }).toBeGreaterThanOrEqual(3);
}

async function completeCustomRecipe(blind: Page, players: readonly Page[]): Promise<void> {
  let progress = 0;
  const ids: string[] = [];
  for (const label of ["Tomato", "Tomato", "Onion"] as const) {
    const candidate = blind.locator("[data-object-id]")
      .filter({ hasText: `${label} (` })
      .filter({ hasText: "Raw · Counter · Available" })
      .first();
    const id = await candidate.getAttribute("data-object-id");
    expect(id).toBeTruthy();
    ids.push(id!);
    await selectObject(blind, id!);
    await blind.locator(`[data-object-id="${id}"] [data-pick-up]`).dispatchEvent("click");
    await expect(blind.locator(`[data-object-id="${id}"]`)).toContainText("Held by you");
    await selectObject(blind, id!);
    await blind.locator(`[data-object-id="${id}"] [data-cook-action="CHOP"]`).dispatchEvent("click");
    await expectProgress(players, ++progress);
    await selectObject(blind, id!);
    await blind.locator(`[data-object-id="${id}"] [data-drop]`).dispatchEvent("click");
  }
  for (const id of ids) {
    const row = blind.locator(`[data-object-id="${id}"]`);
    await selectObject(blind, id);
    await row.locator("[data-pick-up]").dispatchEvent("click");
    await selectObject(blind, id);
    await row.locator('[data-cook-action="ADD_TO_POT"]').dispatchEvent("click");
    await expectProgress(players, ++progress);
  }
  for (const action of ["SEASON", "BOIL", "MIX", "PLATE"] as const) {
    await blind.locator(`[data-station-controls] [data-cook-action="${action}"]`).dispatchEvent("click");
    await expectProgress(players, ++progress);
  }
}

async function selectObject(page: Page, objectId: string): Promise<void> {
  await page.locator(`[data-kitchen-hotspot][data-point-object="${objectId}"]`).dispatchEvent("click");
}

async function expectProgress(players: readonly Page[], progress: number): Promise<void> {
  await Promise.all(players.map((player) =>
    expect(player.locator("[data-round-progress]")).toContainText(`${progress} / 10`),
  ));
}
