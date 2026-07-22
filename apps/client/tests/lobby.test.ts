// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from "vitest";

import type {
  LobbyConnection,
  LobbySnapshot,
} from "../src/network/RoomClient.js";
import type { PrivateRecipePayload, VoiceRelayEnvelope } from "@cooking-game/shared";
import { Lobby } from "../src/ui/Lobby.js";

describe("Lobby", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
  });

  test("scopes player fields and errors to the lobby when another form shares their names", async () => {
    const connection = new FakeConnection();
    const root = document.createElement("main");
    document.body.replaceChildren(root);
    new Lobby(root, connection).mount();
    await vi.waitFor(() =>
      expect(actionButtons(root).every((button) => button.disabled)).toBe(false),
    );
    root.querySelector<HTMLElement>("[data-auth-root]")!.innerHTML = `
      <input name="displayName" value="" />
      <p class="error">Account error</p>`;

    root.querySelector<HTMLInputElement>(".join-panel [name=displayName]")!.value = "Player One";
    root.querySelector<HTMLButtonElement>("[data-action=create]")!.click();

    await vi.waitFor(() => expect(connection.create).toHaveBeenCalledWith("Player One"));
    expect(root.querySelector<HTMLElement>("[data-auth-root] .error")!.textContent).toBe("Account error");
  });

  test("a restored account fills only an empty player name", () => {
    const connection = new FakeConnection();
    const root = document.createElement("main");
    document.body.replaceChildren(root);
    const lobby = new Lobby(root, connection);
    lobby.mount();

    lobby.restoreDisplayName("Saved Cook");
    expect(root.querySelector<HTMLInputElement>("[name=displayName]")!.value).toBe("Saved Cook");
    root.querySelector<HTMLInputElement>("[name=displayName]")!.value = "Explicit Invite Name";
    lobby.restoreDisplayName("Must Not Replace");
    expect(root.querySelector<HTMLInputElement>("[name=displayName]")!.value).toBe("Explicit Invite Name");
  });

  test("account controls cannot shadow lobby fields or lobby errors", async () => {
    const connection = new FakeConnection();
    const root = document.createElement("main");
    document.body.replaceChildren(root);
    new Lobby(root, connection).mount();
    root.querySelector<HTMLElement>("[data-auth-root]")!.innerHTML = `
      <input name="displayName" value="Account Field" />
      <p class="error" role="alert"></p>`;
    root.querySelector<HTMLInputElement>(".join-panel [name=displayName]")!.value = "Guest Cook";
    await vi.waitFor(() => expect(root.querySelector<HTMLButtonElement>("[data-action=create]")!.disabled).toBe(false));
    root.querySelector<HTMLButtonElement>("[data-action=create]")!.click();

    await vi.waitFor(() => expect(connection.create).toHaveBeenCalledWith("Guest Cook"));
    expect(root.querySelector<HTMLElement>("[data-auth-root] .error")!.textContent).toBe("");
  });

  test("an explicit invite joins directly instead of resuming another room", async () => {
    window.history.replaceState({}, "", "/?room=INVITE123&player=Invited%20Player");
    const connection = new FakeConnection();
    const root = document.createElement("main");
    document.body.replaceChildren(root);

    new Lobby(root, connection).mount();

    await vi.waitFor(() =>
      expect(connection.join).toHaveBeenCalledWith("INVITE123", "Invited Player"),
    );
    expect(connection.resume).not.toHaveBeenCalled();
  });

  test("an invite without a player name waits instead of resuming another room", () => {
    window.history.replaceState({}, "", "/?room=INVITE123");
    const connection = new FakeConnection();
    const root = document.createElement("main");
    document.body.replaceChildren(root);

    new Lobby(root, connection).mount();

    expect(connection.resume).not.toHaveBeenCalled();
    expect(connection.join).not.toHaveBeenCalled();
    expect(root.querySelector<HTMLInputElement>("[name=roomId]")!.value).toBe(
      "INVITE123",
    );
    expect(actionButtons(root).every((button) => button.disabled)).toBe(false);
  });

  test("disables create and join during initial resume", async () => {
    const resume = deferred<boolean>();
    const connection = new FakeConnection();
    connection.resume.mockImplementation(() => resume.promise);
    const root = document.createElement("main");
    document.body.replaceChildren(root);
    new Lobby(root, connection).mount();

    expect(actionButtons(root).every((button) => button.disabled)).toBe(true);

    resume.resolve(false);
    await vi.waitFor(() =>
      expect(actionButtons(root).every((button) => button.disabled)).toBe(false),
    );
  });

  test.each(["CONNECTING", "RECONNECTING", "CONNECTED"] as const)(
    "keeps actions disabled while the connection is %s",
    async (connectionStatus) => {
      const attempt = deferred<void>();
      const connection = new FakeConnection();
      connection.create.mockImplementation(() => attempt.promise);
      const root = document.createElement("main");
      document.body.replaceChildren(root);
      new Lobby(root, connection).mount();
      await vi.waitFor(() => expect(connection.resume).toHaveBeenCalled());

      const name = root.querySelector<HTMLInputElement>("[name=displayName]")!;
      name.value = "Player One";
      root.querySelector<HTMLButtonElement>("[data-action=create]")!.click();
      connection.emit({ connectionStatus });
      attempt.resolve();

      await vi.waitFor(() => expect(connection.create).toHaveBeenCalled());
      expect(actionButtons(root).every((button) => button.disabled)).toBe(true);

      connection.emit({ connectionStatus: "DISCONNECTED" });
      expect(actionButtons(root).every((button) => button.disabled)).toBe(false);
    },
  );

  test("creates a room and renders authoritative connection state", async () => {
    const connection = new FakeConnection();
    const root = document.createElement("main");
    document.body.replaceChildren(root);
    new Lobby(root, connection).mount();
    await vi.waitFor(() =>
      expect(actionButtons(root).every((button) => button.disabled)).toBe(false),
    );

    const name = root.querySelector<HTMLInputElement>("[name=displayName]")!;
    name.value = "Player One";
    root.querySelector<HTMLButtonElement>("[data-action=create]")!.click();
    await vi.waitFor(() => expect(connection.create).toHaveBeenCalledWith("Player One"));

    connection.emit({
      connectionStatus: "CONNECTED",
      roomId: "ROOM123",
      role: "BLIND_COOK",
      connectedCount: 3,
      roomStatus: "READY",
    });

    expect(root.textContent).toContain("ROOM123");
    expect(root.textContent).toContain("Blind Cook");
    expect(root.textContent).toContain("3 / 3");
    expect(root.textContent).toContain("Ready");
  });

  test("mounts an accessible authoritative round HUD and formats server values", () => {
    const connection = new FakeConnection();
    const root = document.createElement("main");
    document.body.replaceChildren(root);
    new Lobby(root, connection).mount();

    const round = root.querySelector<HTMLElement>("[data-round-section]")!;
    expect(round).not.toBeNull();
    expect(round.getAttribute("aria-labelledby")).toBeTruthy();

    connection.emit({
      connectionStatus: "CONNECTED",
      roomStatus: "READY",
      roundStatus: "RUNNING",
      remainingMs: 61_001,
      completedStepCount: 4,
      totalStepCount: 10,
    });

    expect(root.querySelector("[data-round-status]")!.textContent).toBe("Running");
    expect(root.querySelector("[data-round-timer]")!.textContent).toBe("01:02");
    expect(root.querySelector("[data-round-progress]")!.textContent).toContain("4 / 10");
    const progress = root.querySelector<HTMLProgressElement>("[data-round-progress] progress")!;
    expect(progress.value).toBe(4);
    expect(progress.max).toBe(10);
  });

  test("timer-only snapshots update the HUD without replacing object controls", () => {
    const connection = new FakeConnection();
    const root = document.createElement("main");
    document.body.replaceChildren(root);
    new Lobby(root, connection).mount();
    const base = {
      connectionStatus: "CONNECTED" as const,
      roomId: "room",
      sessionId: "blind",
      role: "BLIND_COOK" as const,
      roomStatus: "READY" as const,
      roundStatus: "RUNNING" as const,
      completedStepCount: 0,
      totalStepCount: 10,
      objects: [{ id: "tomato", kind: "TOMATO" as const, label: "Tomato", x: 24, y: 18, preparation: "RAW" as const, location: "COUNTER" as const }],
    };
    connection.emit({ ...base, remainingMs: 61_000 });
    const row = root.querySelector('[data-object-id="tomato"]');
    const pickUp = root.querySelector('[data-pick-up="tomato"]');

    connection.emit({ ...base, remainingMs: 60_000 });

    expect(root.querySelector('[data-object-id="tomato"]')).toBe(row);
    expect(root.querySelector('[data-pick-up="tomato"]')).toBe(pickUp);
    expect(root.querySelector("[data-round-timer]")!.textContent).toBe("01:00");
  });

  test.each([
    ["PAUSED", "Waiting for all players to reconnect."],
    ["NOT_STARTED", "Waiting for the round to start."],
  ] as const)("shows authoritative %s round waiting guidance", (roundStatus, message) => {
    const connection = new FakeConnection();
    const root = document.createElement("main");
    document.body.replaceChildren(root);
    new Lobby(root, connection).mount();

    connection.emit({
      connectionStatus: "CONNECTED",
      roomStatus: "READY",
      roundStatus,
      remainingMs: 300_000,
      completedStepCount: 0,
      totalStepCount: 10,
    });

    expect(root.querySelector("[data-round-status]")!.textContent).toBe(
      roundStatus === "PAUSED" ? "Paused" : "Not started",
    );
    expect(root.textContent).toContain(message);
  });

  test("Recipe Keeper sees the private recipe with exact counts and finite step labels", () => {
    const connection = new FakeConnection();
    const root = document.createElement("main");
    document.body.replaceChildren(root);
    new Lobby(root, connection).mount();

    connection.emit({
      connectionStatus: "CONNECTED",
      role: "RECIPE_KEEPER",
      privateRecipe: privateRecipe(),
    });

    const panel = root.querySelector<HTMLElement>("[data-private-recipe]")!;
    expect(panel).not.toBeNull();
    expect(panel.getAttribute("aria-labelledby")).toBeTruthy();
    expect(panel.textContent).toContain("Tomato Soup");
    expect(panel.textContent).toContain("2 × Tomato");
    expect(panel.textContent).toContain("1 × Onion");
    expect(Array.from(panel.querySelectorAll("[data-recipe-step]"), (step) => step.textContent)).toEqual([
      "Chop Tomato",
      "Add Tomato to pot",
      "Season",
      "Boil",
      "Mix",
      "Plate",
    ]);
  });

  test.each(["BLIND_COOK", "DEAF_KITCHEN_GUIDE"] as const)(
    "%s never renders a forged private recipe payload",
    (role) => {
      const connection = new FakeConnection();
      const root = document.createElement("main");
      document.body.replaceChildren(root);
      new Lobby(root, connection).mount();

      connection.emit({
        connectionStatus: "CONNECTED",
        role,
        privateRecipe: privateRecipe(),
      });

      expect(root.querySelector("[data-private-recipe]")).toBeNull();
      expect(root.textContent).not.toContain("Tomato Soup");
      expect(root.textContent).not.toContain("Chop Tomato");
    },
  );

  test("Recipe Keeper waits safely when no private recipe has arrived", () => {
    const connection = new FakeConnection();
    const root = document.createElement("main");
    document.body.replaceChildren(root);
    new Lobby(root, connection).mount();

    connection.emit({ connectionStatus: "CONNECTED", role: "RECIPE_KEEPER" });

    expect(root.querySelector("[data-private-recipe]")).toBeNull();
    expect(root.querySelector("[data-recipe-root]")!.textContent).toBe(
      "Waiting for private recipe.",
    );
  });

  test("Blind Cook sees synchronized objects and usable pickup/drop controls", async () => {
    const connection = new FakeConnection();
    const root = document.createElement("main");
    document.body.replaceChildren(root);
    new Lobby(root, connection).mount();

    connection.emit({
      connectionStatus: "CONNECTED",
      roomId: "ROOM123",
      role: "BLIND_COOK",
      connectedCount: 3,
      roomStatus: "READY",
      objects: [
        { id: "ingredient-1", kind: "TOMATO", label: "Tomato", x: 24, y: 18, preparation: "RAW", location: "COUNTER" },
      ],
    });

    expect(root.textContent).toContain("Tomato");
    expect(root.textContent).toContain("(24, 18)");
    root.querySelector<HTMLButtonElement>('[data-pick-up="ingredient-1"]')!.click();
    expect(connection.pickUp).toHaveBeenCalledWith("ingredient-1");

    connection.emit({
      connectionStatus: "CONNECTED",
      roomId: "ROOM123",
      role: "BLIND_COOK",
      connectedCount: 3,
      roomStatus: "READY",
      objects: [
        {
          id: "ingredient-1",
          kind: "TOMATO",
          label: "Tomato",
          x: 24,
          y: 18,
          heldBy: "self",
          heldByMe: true,
          preparation: "RAW",
          location: "COUNTER",
        },
      ],
    });
    root.querySelector<HTMLButtonElement>('[data-drop="ingredient-1"]')!.click();
    expect(connection.drop).toHaveBeenCalledWith("ingredient-1", 50, 30);
  });

  test("Blind Cook object rows show authoritative context and exclude POT and RUINED pickup", () => {
    const connection = new FakeConnection();
    const root = document.createElement("main");
    document.body.replaceChildren(root);
    new Lobby(root, connection).mount();
    connection.emit({
      connectionStatus: "CONNECTED",
      role: "BLIND_COOK",
      roomStatus: "READY",
      roundStatus: "RUNNING",
      objects: [
        { id: "raw", kind: "TOMATO", label: "Tomato", x: 24, y: 18, preparation: "RAW", location: "COUNTER" },
        { id: "pot", kind: "ONION", label: "Onion", x: 50, y: 30, preparation: "CHOPPED", location: "POT" },
        { id: "ruined", kind: "CARROT", label: "Carrot", x: 25, y: 30, preparation: "RUINED", location: "COUNTER", heldBy: "other" },
      ],
    });

    expect(root.querySelector('[data-object-id="raw"]')!.textContent).toContain("Raw · Counter · Available");
    expect(root.querySelector('[data-object-id="pot"]')!.textContent).toContain("Chopped · Pot · Available");
    expect(root.querySelector('[data-object-id="ruined"]')!.textContent).toContain("Ruined · Counter · Held by another player");
    expect(root.querySelector('[data-pick-up="raw"]')).not.toBeNull();
    expect(root.querySelector('[data-pick-up="pot"]')).toBeNull();
    expect(root.querySelector('[data-pick-up="ruined"]')).toBeNull();
  });

  test("held RAW and CHOPPED counter objects expose only finite contextual controls", () => {
    const connection = new FakeConnection();
    const root = document.createElement("main");
    document.body.replaceChildren(root);
    new Lobby(root, connection).mount();
    connection.emit({
      connectionStatus: "CONNECTED",
      role: "BLIND_COOK",
      roomStatus: "READY",
      roundStatus: "RUNNING",
      objects: [
        { id: "raw", kind: "TOMATO", label: "Tomato", x: 24, y: 18, heldBy: "self", heldByMe: true, preparation: "RAW", location: "COUNTER" },
        { id: "chopped", kind: "ONION", label: "Onion", x: 25, y: 18, heldBy: "self", heldByMe: true, preparation: "CHOPPED", location: "COUNTER" },
      ],
    });

    const raw = root.querySelector<HTMLElement>('[data-object-id="raw"]')!;
    expect(Array.from(raw.querySelectorAll("button"), (button) => button.textContent)).toEqual(["Point", "Drop", "Chop"]);
    raw.querySelector<HTMLButtonElement>('[data-cook-action="CHOP"]')!.click();
    expect(connection.chop).toHaveBeenCalledWith("raw");

    const chopped = root.querySelector<HTMLElement>('[data-object-id="chopped"]')!;
    expect(Array.from(chopped.querySelectorAll("button"), (button) => button.textContent)).toEqual([
      "Point",
      "Drop",
      "Add to pot",
      "Chop again (ruins)",
    ]);
    chopped.querySelector<HTMLButtonElement>('[data-cook-action="ADD_TO_POT"]')!.click();
    chopped.querySelectorAll<HTMLButtonElement>('[data-cook-action="CHOP"]')[0]!.click();
    expect(connection.addToPot).toHaveBeenCalledWith("chopped");
    expect(connection.chop).toHaveBeenCalledWith("chopped");
    expect(chopped.querySelector('[data-cook-action="CHOP"]')!.classList).toContain("danger-action");
    expect(root.querySelectorAll('input[data-cook-action], textarea[data-cook-action]')).toHaveLength(0);
  });

  test("station exposes exactly the authoritative next terminal action", () => {
    const connection = new FakeConnection();
    const root = document.createElement("main");
    document.body.replaceChildren(root);
    new Lobby(root, connection).mount();
    const cases = [
      [6, "SEASON"],
      [7, "BOIL"],
      [8, "MIX"],
      [9, "PLATE"],
    ] as const;

    for (const [completedStepCount, action] of cases) {
      connection.emit({
        connectionStatus: "CONNECTED",
        role: "BLIND_COOK",
        roomStatus: "READY",
        roundStatus: "RUNNING",
        completedStepCount,
        totalStepCount: 10,
      });
      const buttons = root.querySelectorAll<HTMLButtonElement>("[data-station-controls] [data-cook-action]");
      expect(buttons).toHaveLength(1);
      expect(buttons[0]!.dataset.cookAction).toBe(action);
      buttons[0]!.click();
    }
    expect(connection.season).toHaveBeenCalledTimes(1);
    expect(connection.boil).toHaveBeenCalledTimes(1);
    expect(connection.mix).toHaveBeenCalledTimes(1);
    expect(connection.plate).toHaveBeenCalledTimes(1);

    connection.emit({
      connectionStatus: "CONNECTED",
      role: "BLIND_COOK",
      roomStatus: "READY",
      roundStatus: "RUNNING",
      completedStepCount: 5,
      totalStepCount: 10,
    });
    expect(root.querySelectorAll("[data-station-controls] [data-cook-action]")).toHaveLength(0);
  });

  test.each(["PAUSED", "WON", "LOST"] as const)(
    "%s removes cooking manipulation and disables pointing",
    (roundStatus) => {
      const connection = new FakeConnection();
      const root = document.createElement("main");
      document.body.replaceChildren(root);
      new Lobby(root, connection).mount();
      connection.emit({
        connectionStatus: "CONNECTED",
        role: "BLIND_COOK",
        roomStatus: "READY",
        roundStatus,
        completedStepCount: 6,
        totalStepCount: 10,
        objects: [{ id: "raw", kind: "TOMATO", label: "Tomato", x: 24, y: 18, preparation: "RAW", location: "COUNTER" }],
      });

      expect(root.querySelectorAll("[data-pick-up], [data-drop], [data-cook-action]")).toHaveLength(0);
      expect(Array.from(root.querySelectorAll<HTMLButtonElement>("[data-point-object], [data-point-location]"))).toSatisfy(
        (buttons: HTMLButtonElement[]) => buttons.length > 0 && buttons.every((button) => button.disabled),
      );
    },
  );

  test("undefined round status preserves Phase 2 READY interactions and cooking errors stay text", () => {
    const connection = new FakeConnection();
    const root = document.createElement("main");
    document.body.replaceChildren(root);
    new Lobby(root, connection).mount();
    connection.emit({
      connectionStatus: "CONNECTED",
      role: "BLIND_COOK",
      roomStatus: "READY",
      cookingError: '<img src=x onerror="alert(1)">Rejected',
      objects: [{ id: "raw", kind: "TOMATO", label: "Tomato", x: 24, y: 18, preparation: "RAW", location: "COUNTER" }],
    });

    expect(root.querySelector('[data-pick-up="raw"]')).not.toBeNull();
    expect(root.querySelector<HTMLButtonElement>('[data-point-object="raw"]')!.disabled).toBe(false);
    expect(root.querySelector(".cooking-error")!.textContent).toBe('<img src=x onerror="alert(1)">Rejected');
    expect(root.querySelector(".cooking-error img")).toBeNull();
  });

  test("WON renders an accessible authoritative success result without interactions", () => {
    const connection = new FakeConnection();
    const root = document.createElement("main");
    document.body.replaceChildren(root);
    new Lobby(root, connection).mount();
    connection.emit({
      connectionStatus: "CONNECTED",
      role: "BLIND_COOK",
      roomStatus: "READY",
      roundStatus: "WON",
      remainingMs: 42_000,
      completedStepCount: 10,
      totalStepCount: 10,
      objects: [{ id: "raw", kind: "TOMATO", label: "Tomato", x: 24, y: 18, preparation: "RAW", location: "COUNTER" }],
    });

    const result = root.querySelector<HTMLElement>("[data-round-result]")!;
    expect(result).not.toBeNull();
    expect(result.getAttribute("aria-labelledby")).toBeTruthy();
    expect(result.querySelector("h2")!.textContent).toBe("Round won!");
    expect(result.textContent).toContain("10 / 10 steps completed");
    expect(root.querySelectorAll("[data-pick-up], [data-drop], [data-cook-action]")).toHaveLength(0);
    expect(Array.from(root.querySelectorAll<HTMLButtonElement>("[data-point-object], [data-point-location]")).every((button) => button.disabled)).toBe(true);
  });

  test("LOST TIME_EXPIRED renders a clear authoritative failure result", () => {
    const connection = new FakeConnection();
    const root = document.createElement("main");
    document.body.replaceChildren(root);
    new Lobby(root, connection).mount();
    connection.emit({
      connectionStatus: "CONNECTED",
      role: "BLIND_COOK",
      roomStatus: "READY",
      roundStatus: "LOST",
      outcomeReason: "TIME_EXPIRED",
      remainingMs: 0,
      completedStepCount: 7,
      totalStepCount: 10,
    });

    const result = root.querySelector<HTMLElement>("[data-round-result]")!;
    expect(result.querySelector("h2")!.textContent).toBe("Time's up");
    expect(result.textContent).toContain("The round ended because time expired.");
    expect(result.textContent).toContain("7 / 10 steps completed");
    expect(root.querySelector("[data-round-timer]")!.textContent).toBe("00:00");
    expect(root.querySelectorAll("[data-pick-up], [data-drop], [data-cook-action]")).toHaveLength(0);
  });

  test("does not infer a result and removes an old result on a nonterminal snapshot", () => {
    const connection = new FakeConnection();
    const root = document.createElement("main");
    document.body.replaceChildren(root);
    new Lobby(root, connection).mount();

    connection.emit({
      connectionStatus: "CONNECTED",
      roundStatus: "WON",
      remainingMs: 1,
      completedStepCount: 10,
      totalStepCount: 10,
    });
    expect(root.querySelector("[data-round-result]")).not.toBeNull();

    connection.emit({
      connectionStatus: "CONNECTED",
      roundStatus: "RUNNING",
      remainingMs: 0,
      completedStepCount: 10,
      totalStepCount: 10,
    });
    expect(root.querySelector("[data-round-result]")).toBeNull();
  });

  test("other roles are read-only and sanitized interaction errors are displayed", () => {
    const connection = new FakeConnection();
    const root = document.createElement("main");
    document.body.replaceChildren(root);
    new Lobby(root, connection).mount();

    connection.emit({
      connectionStatus: "CONNECTED",
      role: "RECIPE_KEEPER",
      connectedCount: 3,
      roomStatus: "READY",
      objects: [
        { id: "ingredient-1", kind: "TOMATO", label: "Tomato", x: 24, y: 18, preparation: "RAW", location: "COUNTER" },
      ],
      interactionError: "That interaction was rejected.",
    });

    expect(root.textContent).toContain("Only the Blind Cook can pick up and drop objects.");
    expect(root.querySelectorAll("[data-pick-up], [data-drop]")).toHaveLength(0);
    expect(root.getElementsByClassName("interaction-error")[0]?.textContent).toBe(
      "That interaction was rejected.",
    );
  });

  test.each(["BLIND_COOK", "RECIPE_KEEPER", "DEAF_KITCHEN_GUIDE"] as const)("%s can point at objects and fixed kitchen locations without freeform coordinates", (role) => {
    const connection = new FakeConnection();
    const root = document.createElement("main");
    document.body.replaceChildren(root);
    new Lobby(root, connection).mount();
    connection.emit({
      connectionStatus: "CONNECTED",
      roomId: "ROOM123",
      sessionId: "self",
      role,
      connectedCount: 3,
      roomStatus: "READY",
      objects: [{ id: "ingredient-1", kind: "TOMATO", label: "Tomato", x: 24, y: 18, preparation: "RAW", location: "COUNTER" }],
    });

    root.querySelector<HTMLButtonElement>('[data-point-object="ingredient-1"]')!.click();
    root.querySelector<HTMLButtonElement>('[data-point-location="STOVE"]')!.click();
    expect(connection.pointAtObject).toHaveBeenCalledWith("ingredient-1");
    expect(connection.pointAtLocation).toHaveBeenCalledWith(50, 30);
    expect(root.querySelectorAll('input[type="number"], [data-point-controls] input')).toHaveLength(0);
  });
});

class FakeConnection implements LobbyConnection {
  create = vi.fn(async (_displayName: string) => undefined);
  join = vi.fn(async (_roomId: string, _displayName: string) => undefined);
  resume = vi.fn(async () => false);
  pickUp = vi.fn((_objectId: string) => undefined);
  drop = vi.fn((_objectId: string, _x: number, _y: number) => undefined);
  chop = vi.fn((_objectId: string) => undefined);
  addToPot = vi.fn((_objectId: string) => undefined);
  season = vi.fn(() => undefined);
  boil = vi.fn(() => undefined);
  mix = vi.fn(() => undefined);
  plate = vi.fn(() => undefined);
  pointAtObject = vi.fn((_objectId: string) => undefined);
  pointAtLocation = vi.fn((_x: number, _y: number) => undefined);
  sendGesture = vi.fn();
  sendEmote = vi.fn();
  sendRecipeCard = vi.fn();
  sendDrawingStroke = vi.fn();
  clearDrawing = vi.fn();
  sendVoiceSignal = vi.fn();
  private listeners = new Set<(snapshot: LobbySnapshot) => void>();

  subscribe(listener: (snapshot: LobbySnapshot) => void): () => void {
    this.listeners.add(listener);
    listener({ connectionStatus: "DISCONNECTED" });
    return () => {
      this.listeners.delete(listener);
    };
  }

  subscribeVoice(_listener: (relay: VoiceRelayEnvelope) => void): () => void { return () => undefined; }

  emit(snapshot: LobbySnapshot): void {
    for (const listener of this.listeners) listener(snapshot);
  }
}

function actionButtons(root: HTMLElement): HTMLButtonElement[] {
  return Array.from(root.querySelectorAll<HTMLButtonElement>("[data-action]"));
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function privateRecipe(): PrivateRecipePayload {
  return {
    id: "tomato-soup",
    title: "Tomato Soup",
    ingredients: [
      { kind: "TOMATO", count: 2 },
      { kind: "ONION", count: 1 },
    ],
    steps: [
      { action: "CHOP", ingredientKind: "TOMATO" },
      { action: "ADD_TO_POT", ingredientKind: "TOMATO" },
      { action: "SEASON" },
      { action: "BOIL" },
      { action: "MIX" },
      { action: "PLATE" },
    ],
  };
}
